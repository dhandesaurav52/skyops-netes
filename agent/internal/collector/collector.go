package collector

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/skyops-io/skyops/agent/internal/config"
	"github.com/skyops-io/skyops/agent/internal/queue"
	"github.com/skyops-io/skyops/agent/internal/transport"
)

// StateUpdater receives live telemetry updates (node count, pod count, live K8s version)
type StateUpdater interface {
	UpdateTelemetryState(nodes, pods int, k8sVersion string)
}

// Collector coordinates scraping of Kubernetes resources and dispatching telemetry
type Collector struct {
	cfg                  *config.Config
	client               *transport.Client
	queue                *queue.BoundedQueue
	k8sClient            *InClusterK8sClient
	stateUpdater         StateUpdater
	lastCollectionStatus map[string]CollectionStatusItem
	lastObservedAt       int64
	lastSnapshotComplete bool
}

func NewCollector(cfg *config.Config, client *transport.Client, q *queue.BoundedQueue, kClient *InClusterK8sClient) *Collector {
	if kClient == nil {
		var err error
		kClient, err = NewInClusterK8sClient()
		if err != nil {
			slog.Warn("Running in standalone observation mode (in-cluster K8s API client disabled)", "reason", err.Error())
		} else {
			slog.Info("Successfully initialized Kubernetes in-cluster API client")
		}
	}

	return &Collector{
		cfg:                  cfg,
		client:               client,
		queue:                q,
		k8sClient:            kClient,
		lastCollectionStatus: make(map[string]CollectionStatusItem),
	}
}

func (c *Collector) SetStateUpdater(updater StateUpdater) {
	c.stateUpdater = updater
}

// Start begins the scrape loop and periodic telemetry dispatcher
func (c *Collector) Start(ctx context.Context) {
	ticker := time.NewTicker(c.cfg.TelemetryInterval)
	defer ticker.Stop()

	slog.Info("Kubernetes resource collector started", "interval", c.cfg.TelemetryInterval.String())

	// Execute initial immediate scrape
	c.collectFromKubernetes(ctx)
	c.flushQueue(ctx)

	for {
		select {
		case <-ctx.Done():
			slog.Info("Resource collector shutting down")
			return
		case <-ticker.C:
			c.collectFromKubernetes(ctx)
			c.flushQueue(ctx)
		}
	}
}

func (c *Collector) RecordObservation(res ResourceObservation) {
	c.queue.Push(queue.Item{
		Type:    "RESOURCE_UPDATE",
		Payload: res,
	})
}

// collectFromKubernetes executes a structured collection run across all Kubernetes resource categories
func (c *Collector) collectFromKubernetes(ctx context.Context) {
	if c.k8sClient == nil {
		return
	}

	cycleStart := time.Now().UnixMilli()
	c.lastObservedAt = cycleStart
	collectionStatus := make(map[string]CollectionStatusItem)

	// 1. Fetch Events first to correlate with pods, nodes, and workloads
	eventsMap, totalEvents := c.collectEvents(ctx)

	// Fetch real metrics from Metrics Server (/apis/metrics.k8s.io/v1beta1) if available
	nodeMetricsMap := make(map[string]*K8sNodeMetrics)
	if nodeMetricsList, err := c.k8sClient.GetNodeMetrics(ctx); err == nil && nodeMetricsList != nil {
		for i := range nodeMetricsList.Items {
			item := &nodeMetricsList.Items[i]
			nodeMetricsMap[item.Metadata.Name] = item
		}
		slog.Debug("Real node metrics collected from Metrics Server", "nodesWithMetrics", len(nodeMetricsMap))
	} else {
		slog.Debug("Kubernetes Metrics Server node metrics not available", "notice", err)
	}

	podMetricsMap := make(map[string]*K8sPodMetrics)
	if podMetricsList, err := c.k8sClient.GetPodMetrics(ctx); err == nil && podMetricsList != nil {
		for i := range podMetricsList.Items {
			item := &podMetricsList.Items[i]
			key := fmt.Sprintf("%s/%s", item.Metadata.Namespace, item.Metadata.Name)
			podMetricsMap[key] = item
		}
		slog.Debug("Real pod metrics collected from Metrics Server", "podsWithMetrics", len(podMetricsMap))
	} else {
		slog.Debug("Kubernetes Metrics Server pod metrics not available", "notice", err)
	}

	// 2. Nodes
	nodeObservations, detectedK8sVer, nodeStat := c.collectNodes(ctx, eventsMap, nodeMetricsMap)
	collectionStatus["nodes"] = nodeStat
	for _, obs := range nodeObservations {
		c.RecordObservation(obs)
	}

	// 3. Pods
	podObservations, podStat := c.collectPods(ctx, eventsMap, podMetricsMap)
	collectionStatus["pods"] = podStat
	for _, obs := range podObservations {
		c.RecordObservation(obs)
	}

	// 4. Deployments
	deploymentObservations, depStat := c.collectDeployments(ctx, eventsMap)
	collectionStatus["deployments"] = depStat
	for _, obs := range deploymentObservations {
		c.RecordObservation(obs)
	}

	// 5. StatefulSets
	statefulSetObservations, ssStat := c.collectStatefulSets(ctx, eventsMap)
	collectionStatus["statefulsets"] = ssStat
	for _, obs := range statefulSetObservations {
		c.RecordObservation(obs)
	}

	// 6. DaemonSets
	daemonSetObservations, dsStat := c.collectDaemonSets(ctx, eventsMap)
	collectionStatus["daemonsets"] = dsStat
	for _, obs := range daemonSetObservations {
		c.RecordObservation(obs)
	}

	// 7. ReplicaSets
	replicaSetObservations, rsStat := c.collectReplicaSets(ctx, eventsMap)
	collectionStatus["replicasets"] = rsStat
	for _, obs := range replicaSetObservations {
		c.RecordObservation(obs)
	}

	// 8. Jobs
	jobObservations, jobStat := c.collectJobs(ctx, eventsMap)
	collectionStatus["jobs"] = jobStat
	for _, obs := range jobObservations {
		c.RecordObservation(obs)
	}

	// 9. CronJobs
	cronJobObservations, cjStat := c.collectCronJobs(ctx, eventsMap)
	collectionStatus["cronjobs"] = cjStat
	for _, obs := range cronJobObservations {
		c.RecordObservation(obs)
	}

	// 10. Networking: Services, Ingresses, Endpoints
	serviceObservations, svcStat := c.collectServices(ctx, eventsMap)
	collectionStatus["services"] = svcStat
	for _, obs := range serviceObservations {
		c.RecordObservation(obs)
	}

	ingressObservations, ingStat := c.collectIngresses(ctx, eventsMap)
	collectionStatus["ingresses"] = ingStat
	for _, obs := range ingressObservations {
		c.RecordObservation(obs)
	}

	endpointObservations, epStat := c.collectEndpoints(ctx)
	collectionStatus["endpoints"] = epStat
	for _, obs := range endpointObservations {
		c.RecordObservation(obs)
	}

	// 11. Storage: PVCs, PVs, StorageClasses
	pvcObservations, pvcStat := c.collectPVCs(ctx, eventsMap)
	collectionStatus["pvcs"] = pvcStat
	for _, obs := range pvcObservations {
		c.RecordObservation(obs)
	}

	pvObservations, pvStat := c.collectPersistentVolumes(ctx, eventsMap)
	collectionStatus["persistentvolumes"] = pvStat
	for _, obs := range pvObservations {
		c.RecordObservation(obs)
	}

	scObservations, scStat := c.collectStorageClasses(ctx)
	collectionStatus["storageclasses"] = scStat
	for _, obs := range scObservations {
		c.RecordObservation(obs)
	}

	// 12. Config & Secrets Metadata (Strictly zero sensitive values!)
	cmObservations, cmStat := c.collectConfigMaps(ctx)
	collectionStatus["configmaps"] = cmStat
	for _, obs := range cmObservations {
		c.RecordObservation(obs)
	}

	secObservations, secStat := c.collectSecrets(ctx)
	collectionStatus["secrets"] = secStat
	for _, obs := range secObservations {
		c.RecordObservation(obs)
	}

	// 13. Cluster Governance: Namespaces, ResourceQuotas, LimitRanges
	nsObservations, nsStat := c.collectNamespaces(ctx)
	collectionStatus["namespaces"] = nsStat
	for _, obs := range nsObservations {
		c.RecordObservation(obs)
	}

	rqObservations, rqStat := c.collectResourceQuotas(ctx)
	collectionStatus["resourcequotas"] = rqStat
	for _, obs := range rqObservations {
		c.RecordObservation(obs)
	}

	lrObservations, lrStat := c.collectLimitRanges(ctx)
	collectionStatus["limitranges"] = lrStat
	for _, obs := range lrObservations {
		c.RecordObservation(obs)
	}

	// 14. RBAC: ServiceAccounts, RoleBindings, ClusterRoleBindings
	saObservations, saStat := c.collectServiceAccounts(ctx)
	collectionStatus["serviceaccounts"] = saStat
	for _, obs := range saObservations {
		c.RecordObservation(obs)
	}

	rbObservations, rbStat := c.collectRoleBindings(ctx)
	collectionStatus["rolebindings"] = rbStat
	for _, obs := range rbObservations {
		c.RecordObservation(obs)
	}

	crbObservations, crbStat := c.collectClusterRoleBindings(ctx)
	collectionStatus["clusterrolebindings"] = crbStat
	for _, obs := range crbObservations {
		c.RecordObservation(obs)
	}

	// 15. Helm Discovery (Metadata ONLY)
	helmObservations, helmStat := c.collectHelmReleases(ctx)
	collectionStatus["helm"] = helmStat
	for _, obs := range helmObservations {
		c.RecordObservation(obs)
	}

	// Snapshot is complete if core infrastructure (nodes, pods, deployments) succeeded
	c.lastSnapshotComplete = nodeStat.Success && podStat.Success && depStat.Success
	c.lastCollectionStatus = collectionStatus

	nodeCount := len(nodeObservations)
	podCount := len(podObservations)

	// Update heartbeat state if registered
	if c.stateUpdater != nil {
		c.stateUpdater.UpdateTelemetryState(nodeCount, podCount, detectedK8sVer)
	}

	slog.Info("Kubernetes telemetry collected",
		"nodes", nodeCount,
		"pods", podCount,
		"deployments", len(deploymentObservations),
		"services", len(serviceObservations),
		"ingresses", len(ingressObservations),
		"helmReleases", len(helmObservations),
		"events", totalEvents,
		"k8sVersion", detectedK8sVer,
		"snapshotComplete", c.lastSnapshotComplete,
	)
}

func (c *Collector) collectEvents(ctx context.Context) (map[string][]EventObservation, int) {
	eventsMap := make(map[string][]EventObservation)
	var eventList K8sEventList
	if err := c.k8sClient.GetJSON(ctx, "/api/v1/events?limit=300", &eventList); err != nil {
		slog.Debug("Event collection notice", "error", err)
		return eventsMap, 0
	}

	for _, evt := range eventList.Items {
		key := fmt.Sprintf("%s/%s/%s", evt.InvolvedObject.Kind, evt.InvolvedObject.Namespace, evt.InvolvedObject.Name)
		ts := time.Now().UnixMilli()
		if evt.LastTimestamp != "" {
			if t, err := time.Parse(time.RFC3339, evt.LastTimestamp); err == nil {
				ts = t.UnixMilli()
			}
		} else if evt.EventTime != "" {
			if t, err := time.Parse(time.RFC3339, evt.EventTime); err == nil {
				ts = t.UnixMilli()
			}
		}

		eventsMap[key] = append(eventsMap[key], EventObservation{
			ID:         evt.Metadata.UID,
			Timestamp:  ts,
			Type:       evt.Type,
			Reason:     evt.Reason,
			ObjectKind: evt.InvolvedObject.Kind,
			ObjectName: evt.InvolvedObject.Name,
			Namespace:  evt.InvolvedObject.Namespace,
			Message:    evt.Message,
		})
	}

	return eventsMap, len(eventList.Items)
}

func (c *Collector) collectNodes(ctx context.Context, eventsMap map[string][]EventObservation, nodeMetricsMap map[string]*K8sNodeMetrics) ([]ResourceObservation, string, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation
	var detectedK8sVer string

	var nodeList K8sNodeList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/nodes", &nodeList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes nodes", "error", err)
		return results, detectedK8sVer, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, node := range nodeList.Items {
		conditions := make([]ConditionStatus, 0)
		isReady := false
		for _, cond := range node.Status.Conditions {
			conditions = append(conditions, ConditionStatus{
				Type:               cond.Type,
				Status:             cond.Status,
				Reason:             cond.Reason,
				Message:            cond.Message,
				LastTransitionTime: cond.LastTransitionTime,
			})
			if cond.Type == "Ready" && cond.Status == "True" {
				isReady = true
			}
		}

		nodeStatus := "NotReady"
		health := "CRITICAL"
		if isReady {
			nodeStatus = "Ready"
			health = "HEALTHY"
		}

		createdTs := parseCreationTimestamp(node.Metadata.CreationTimestamp)

		if node.Status.NodeInfo.KubeletVersion != "" && detectedK8sVer == "" {
			detectedK8sVer = node.Status.NodeInfo.KubeletVersion
		}

		nodeEvents := eventsMap[fmt.Sprintf("Node//%s", node.Metadata.Name)]

		statusSummary := map[string]interface{}{
			"kubeletVersion": node.Status.NodeInfo.KubeletVersion,
			"osImage":        node.Status.NodeInfo.OSImage,
			"architecture":   node.Status.NodeInfo.Architecture,
			"capacity":       node.Status.Capacity,
			"allocatable":    node.Status.Allocatable,
		}

		nodeMetric := nodeMetricsMap[node.Metadata.Name]
		if nodeMetric != nil {
			statusSummary["metricsAvailable"] = true
			statusSummary["metricsObservedAt"] = nodeMetric.Timestamp
			statusSummary["metricsWindow"] = nodeMetric.Window
			statusSummary["usage"] = nodeMetric.Usage
		} else {
			statusSummary["metricsAvailable"] = false
		}

		taintsSummary := make([]map[string]string, 0, len(node.Spec.Taints))
		for _, t := range node.Spec.Taints {
			taintsSummary = append(taintsSummary, map[string]string{
				"key":    t.Key,
				"value":  t.Value,
				"effect": t.Effect,
			})
		}

		results = append(results, ResourceObservation{
			ID:              node.Metadata.UID,
			Kind:            "Node",
			Namespace:       "",
			Name:            node.Metadata.Name,
			Status:          nodeStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          node.Metadata.Labels,
			Annotations:     sanitizeAnnotations(node.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(node.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"podCIDR": node.Spec.PodCIDR,
				"taints":  taintsSummary,
			},
			StatusSummary: statusSummary,
			Conditions:    conditions,
			Events:        nodeEvents,
		})
	}

	if detectedK8sVer == "" && c.k8sClient != nil {
		if ver, err := c.k8sClient.GetServerVersion(ctx); err == nil && ver != "" {
			detectedK8sVer = ver
		}
	}

	return results, detectedK8sVer, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectPods(ctx context.Context, eventsMap map[string][]EventObservation, podMetricsMap map[string]*K8sPodMetrics) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var podList K8sPodList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/pods", &podList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes pods", "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, pod := range podList.Items {
		containers := make([]ContainerStatus, 0)
		conditions := make([]ConditionStatus, 0)

		for _, cond := range pod.Status.Conditions {
			conditions = append(conditions, ConditionStatus{
				Type:               cond.Type,
				Status:             cond.Status,
				Reason:             cond.Reason,
				Message:            cond.Message,
				LastTransitionTime: cond.LastTransitionTime,
			})
		}

		hasCrashLoop := false
		hasImagePull := false
		allReady := true

		podMetricKey := fmt.Sprintf("%s/%s", pod.Metadata.Namespace, pod.Metadata.Name)
		podMetric := podMetricsMap[podMetricKey]

		for _, cs := range pod.Status.ContainerStatuses {
			memoryLimit := ""
			memoryRequest := ""
			cpuLimit := ""
			cpuRequest := ""
			var probes *ProbesSummary

			for _, specContainer := range pod.Spec.Containers {
				if specContainer.Name == cs.Name {
					if specContainer.Resources.Limits != nil {
						memoryLimit = specContainer.Resources.Limits["memory"]
						cpuLimit = specContainer.Resources.Limits["cpu"]
					}
					if specContainer.Resources.Requests != nil {
						memoryRequest = specContainer.Resources.Requests["memory"]
						cpuRequest = specContainer.Resources.Requests["cpu"]
					}
					// Extract probes
					probes = &ProbesSummary{
						Liveness:  parseProbe(specContainer.LivenessProbe),
						Readiness: parseProbe(specContainer.ReadinessProbe),
						Startup:   parseProbe(specContainer.StartupProbe),
					}
					break
				}
			}

			cpuUsage := ""
			memoryUsage := ""
			if podMetric != nil {
				for _, cm := range podMetric.Containers {
					if cm.Name == cs.Name {
						cpuUsage = cm.Usage["cpu"]
						memoryUsage = cm.Usage["memory"]
						break
					}
				}
			}

			cStat := ContainerStatus{
				Name:          cs.Name,
				Image:         cs.Image,
				RestartCount:  cs.RestartCount,
				Ready:         cs.Ready,
				MemoryLimit:   memoryLimit,
				MemoryRequest: memoryRequest,
				CpuLimit:      cpuLimit,
				CpuRequest:    cpuRequest,
				MemoryUsage:   memoryUsage,
				CpuUsage:      cpuUsage,
				Probes:        probes,
			}

			if !cs.Ready {
				allReady = false
			}

			if cs.State.Waiting != nil {
				cStat.State = "waiting"
				cStat.WaitingReason = cs.State.Waiting.Reason
				cStat.WaitingMessage = cs.State.Waiting.Message
				if cs.State.Waiting.Reason == "CrashLoopBackOff" {
					hasCrashLoop = true
				}
				if cs.State.Waiting.Reason == "ImagePullBackOff" || cs.State.Waiting.Reason == "ErrImagePull" {
					hasImagePull = true
				}
			} else if cs.State.Running != nil {
				cStat.State = "running"
			} else if cs.State.Terminated != nil {
				cStat.State = "terminated"
				cStat.TerminationReason = cs.State.Terminated.Reason
				cStat.ExitCode = cs.State.Terminated.ExitCode
			}
			if cs.LastState.Terminated != nil {
				cStat.LastTerminationReason = cs.LastState.Terminated.Reason
				cStat.LastExitCode = cs.LastState.Terminated.ExitCode
			}

			containers = append(containers, cStat)
		}

		health := "HEALTHY"
		if hasCrashLoop || hasImagePull || pod.Status.Phase == "Failed" {
			health = "CRITICAL"
		} else if !allReady || pod.Status.Phase == "Pending" {
			health = "WARNING"
		}

		createdTs := parseCreationTimestamp(pod.Metadata.CreationTimestamp)
		podEvents := eventsMap[fmt.Sprintf("Pod/%s/%s", pod.Metadata.Namespace, pod.Metadata.Name)]

		statusSummary := map[string]interface{}{
			"podIP":             pod.Status.PodIP,
			"hostIP":            pod.Status.HostIP,
			"phase":             pod.Status.Phase,
			"qosClass":          pod.Status.QOSClass,
			"nominatedNodeName": pod.Status.NominatedNodeName,
			"startTime":         pod.Status.StartTime,
		}
		if podMetric != nil {
			statusSummary["metricsAvailable"] = true
			statusSummary["metricsObservedAt"] = podMetric.Timestamp
			statusSummary["metricsWindow"] = podMetric.Window
		} else {
			statusSummary["metricsAvailable"] = false
		}

		tolerationsSummary := make([]map[string]interface{}, 0, len(pod.Spec.Tolerations))
		for _, t := range pod.Spec.Tolerations {
			tolerationsSummary = append(tolerationsSummary, map[string]interface{}{
				"key":               t.Key,
				"operator":          t.Operator,
				"value":             t.Value,
				"effect":            t.Effect,
				"tolerationSeconds": t.TolerationSeconds,
			})
		}

		results = append(results, ResourceObservation{
			ID:              pod.Metadata.UID,
			Kind:            "Pod",
			Namespace:       pod.Metadata.Namespace,
			Name:            pod.Metadata.Name,
			NodeName:        pod.Spec.NodeName,
			Status:          pod.Status.Phase,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          pod.Metadata.Labels,
			Annotations:     sanitizeAnnotations(pod.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(pod.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"nodeName":           pod.Spec.NodeName,
				"nodeSelector":       pod.Spec.NodeSelector,
				"tolerations":        tolerationsSummary,
				"affinity":           pod.Spec.Affinity,
				"priorityClassName":  pod.Spec.PriorityClassName,
				"restartPolicy":      pod.Spec.RestartPolicy,
				"serviceAccountName": pod.Spec.ServiceAccountName,
			},
			StatusSummary: statusSummary,
			Containers:    containers,
			Conditions:    conditions,
			Events:        podEvents,
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectDeployments(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var deploymentList K8sDeploymentList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/apps/v1/deployments", &deploymentList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes deployments", "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, dep := range deploymentList.Items {
		conditions := make([]ConditionStatus, 0)
		for _, cond := range dep.Status.Conditions {
			conditions = append(conditions, ConditionStatus{
				Type:               cond.Type,
				Status:             cond.Status,
				Reason:             cond.Reason,
				Message:            cond.Message,
				LastTransitionTime: cond.LastTransitionTime,
			})
		}

		health := "HEALTHY"
		displayStatus := "Available"
		desired := dep.Spec.Replicas
		ready := dep.Status.ReadyReplicas
		available := dep.Status.AvailableReplicas

		if desired > 0 && ready == 0 && available == 0 {
			health = "CRITICAL"
			displayStatus = "Unavailable"
		} else if desired > 0 && (ready < desired || available < desired) {
			health = "WARNING"
			displayStatus = "Progressing"
		}

		createdTs := parseCreationTimestamp(dep.Metadata.CreationTimestamp)
		depEvents := eventsMap[fmt.Sprintf("Deployment/%s/%s", dep.Metadata.Namespace, dep.Metadata.Name)]

		results = append(results, ResourceObservation{
			ID:              dep.Metadata.UID,
			Kind:            "Deployment",
			Namespace:       dep.Metadata.Namespace,
			Name:            dep.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          dep.Metadata.Labels,
			Annotations:     sanitizeAnnotations(dep.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(dep.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"replicas": dep.Spec.Replicas,
			},
			StatusSummary: map[string]interface{}{
				"replicas":            dep.Status.Replicas,
				"readyReplicas":       dep.Status.ReadyReplicas,
				"availableReplicas":   dep.Status.AvailableReplicas,
				"updatedReplicas":     dep.Status.UpdatedReplicas,
				"unavailableReplicas": dep.Status.UnavailableReplicas,
			},
			Conditions: conditions,
			Events:     depEvents,
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectStatefulSets(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var statefulSetList K8sStatefulSetList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/apps/v1/statefulsets", &statefulSetList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes statefulsets", "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, sts := range statefulSetList.Items {
		health := "HEALTHY"
		displayStatus := "Ready"
		desired := sts.Spec.Replicas
		ready := sts.Status.ReadyReplicas

		if desired > 0 && ready == 0 {
			health = "CRITICAL"
			displayStatus = "Unavailable"
		} else if desired > 0 && ready < desired {
			health = "WARNING"
			displayStatus = "Progressing"
		}

		createdTs := parseCreationTimestamp(sts.Metadata.CreationTimestamp)
		stsEvents := eventsMap[fmt.Sprintf("StatefulSet/%s/%s", sts.Metadata.Namespace, sts.Metadata.Name)]

		results = append(results, ResourceObservation{
			ID:              sts.Metadata.UID,
			Kind:            "StatefulSet",
			Namespace:       sts.Metadata.Namespace,
			Name:            sts.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          sts.Metadata.Labels,
			Annotations:     sanitizeAnnotations(sts.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(sts.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"replicas": sts.Spec.Replicas,
			},
			StatusSummary: map[string]interface{}{
				"replicas":        sts.Status.Replicas,
				"readyReplicas":   sts.Status.ReadyReplicas,
				"currentReplicas": sts.Status.CurrentReplicas,
				"updatedReplicas": sts.Status.UpdatedReplicas,
			},
			Events: stsEvents,
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectDaemonSets(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var daemonSetList K8sDaemonSetList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/apps/v1/daemonsets", &daemonSetList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes daemonsets", "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, ds := range daemonSetList.Items {
		health := "HEALTHY"
		displayStatus := "Ready"
		desired := ds.Status.DesiredNumberScheduled
		ready := ds.Status.NumberReady

		if desired > 0 && ready == 0 {
			health = "CRITICAL"
			displayStatus = "Unavailable"
		} else if desired > 0 && ready < desired {
			health = "WARNING"
			displayStatus = "Progressing"
		}

		createdTs := parseCreationTimestamp(ds.Metadata.CreationTimestamp)
		dsEvents := eventsMap[fmt.Sprintf("DaemonSet/%s/%s", ds.Metadata.Namespace, ds.Metadata.Name)]

		results = append(results, ResourceObservation{
			ID:              ds.Metadata.UID,
			Kind:            "DaemonSet",
			Namespace:       ds.Metadata.Namespace,
			Name:            ds.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          ds.Metadata.Labels,
			Annotations:     sanitizeAnnotations(ds.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(ds.Metadata.OwnerReferences),
			SpecSummary:     map[string]interface{}{},
			StatusSummary: map[string]interface{}{
				"desiredNumberScheduled": ds.Status.DesiredNumberScheduled,
				"currentNumberScheduled": ds.Status.CurrentNumberScheduled,
				"numberReady":            ds.Status.NumberReady,
				"numberAvailable":        ds.Status.NumberAvailable,
				"numberMisscheduled":     ds.Status.NumberMisscheduled,
			},
			Events: dsEvents,
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectReplicaSets(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var rsList K8sReplicaSetList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/apps/v1/replicasets", &rsList)
	if err != nil {
		slog.Debug("ReplicaSets collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, rs := range rsList.Items {
		createdTs := parseCreationTimestamp(rs.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("ReplicaSet/%s/%s", rs.Metadata.Namespace, rs.Metadata.Name)

		desired := int32(1)
		if rs.Spec.Replicas != nil {
			desired = *rs.Spec.Replicas
		}

		health := "HEALTHY"
		displayStatus := fmt.Sprintf("%d/%d", rs.Status.ReadyReplicas, desired)
		if desired > 0 && rs.Status.ReadyReplicas == 0 {
			health = "CRITICAL"
		} else if desired > 0 && rs.Status.ReadyReplicas < desired {
			health = "WARNING"
		}

		results = append(results, ResourceObservation{
			ID:              rs.Metadata.UID,
			Kind:            "ReplicaSet",
			Namespace:       rs.Metadata.Namespace,
			Name:            rs.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          rs.Metadata.Labels,
			Annotations:     sanitizeAnnotations(rs.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(rs.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"replicas": desired,
			},
			StatusSummary: map[string]interface{}{
				"replicas":             rs.Status.Replicas,
				"readyReplicas":        rs.Status.ReadyReplicas,
				"availableReplicas":    rs.Status.AvailableReplicas,
				"fullyLabeledReplicas": rs.Status.FullyLabeledReplicas,
			},
			Events: eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectJobs(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var jobList K8sJobList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/batch/v1/jobs", &jobList)
	if err != nil {
		slog.Debug("Jobs collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, job := range jobList.Items {
		createdTs := parseCreationTimestamp(job.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("Job/%s/%s", job.Metadata.Namespace, job.Metadata.Name)

		displayStatus := "Running"
		health := "HEALTHY"

		completions := int32(1)
		if job.Spec.Completions != nil {
			completions = *job.Spec.Completions
		}

		if job.Status.Failed > 0 {
			displayStatus = "Failed"
			health = "CRITICAL"
		} else if job.Status.Succeeded >= completions {
			displayStatus = "Complete"
			health = "HEALTHY"
		} else if job.Status.Active > 0 {
			displayStatus = "Running"
			health = "HEALTHY"
		}

		conditions := make([]ConditionStatus, 0, len(job.Status.Conditions))
		for _, cond := range job.Status.Conditions {
			conditions = append(conditions, ConditionStatus{
				Type:               cond.Type,
				Status:             cond.Status,
				Reason:             cond.Reason,
				Message:            cond.Message,
				LastTransitionTime: cond.LastTransitionTime,
			})
			if cond.Type == "Failed" && cond.Status == "True" {
				displayStatus = "Failed"
				health = "CRITICAL"
			} else if cond.Type == "Complete" && cond.Status == "True" {
				displayStatus = "Complete"
				health = "HEALTHY"
			}
		}

		results = append(results, ResourceObservation{
			ID:              job.Metadata.UID,
			Kind:            "Job",
			Namespace:       job.Metadata.Namespace,
			Name:            job.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          job.Metadata.Labels,
			Annotations:     sanitizeAnnotations(job.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(job.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"parallelism":           job.Spec.Parallelism,
				"completions":           job.Spec.Completions,
				"activeDeadlineSeconds": job.Spec.ActiveDeadlineSeconds,
				"backoffLimit":          job.Spec.BackoffLimit,
			},
			StatusSummary: map[string]interface{}{
				"active":         job.Status.Active,
				"succeeded":      job.Status.Succeeded,
				"failed":         job.Status.Failed,
				"startTime":      job.Status.StartTime,
				"completionTime": job.Status.CompletionTime,
			},
			Conditions: conditions,
			Events:     eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectCronJobs(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var cjList K8sCronJobList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/batch/v1/cronjobs", &cjList)
	if err != nil {
		slog.Debug("CronJobs collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, cj := range cjList.Items {
		createdTs := parseCreationTimestamp(cj.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("CronJob/%s/%s", cj.Metadata.Namespace, cj.Metadata.Name)

		displayStatus := "Active"
		health := "HEALTHY"
		isSuspended := false
		if cj.Spec.Suspend != nil && *cj.Spec.Suspend {
			isSuspended = true
			displayStatus = "Suspended"
			health = "WARNING"
		}

		results = append(results, ResourceObservation{
			ID:              cj.Metadata.UID,
			Kind:            "CronJob",
			Namespace:       cj.Metadata.Namespace,
			Name:            cj.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          cj.Metadata.Labels,
			Annotations:     sanitizeAnnotations(cj.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(cj.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"schedule":                   cj.Spec.Schedule,
				"suspend":                    isSuspended,
				"concurrencyPolicy":          cj.Spec.ConcurrencyPolicy,
				"successfulJobsHistoryLimit": cj.Spec.SuccessfulJobsHistoryLimit,
				"failedJobsHistoryLimit":     cj.Spec.FailedJobsHistoryLimit,
			},
			StatusSummary: map[string]interface{}{
				"activeJobsCount":    len(cj.Status.Active),
				"lastScheduleTime":   cj.Status.LastScheduleTime,
				"lastSuccessfulTime": cj.Status.LastSuccessfulTime,
			},
			Events: eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectServices(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var serviceList K8sServiceList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/services", &serviceList)
	if err != nil {
		slog.Debug("Services collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, svc := range serviceList.Items {
		createdTs := parseCreationTimestamp(svc.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("Service/%s/%s", svc.Metadata.Namespace, svc.Metadata.Name)

		health := "HEALTHY"
		portsSummary := make([]map[string]interface{}, 0, len(svc.Spec.Ports))
		for _, p := range svc.Spec.Ports {
			portsSummary = append(portsSummary, map[string]interface{}{
				"name":        p.Name,
				"protocol":    p.Protocol,
				"port":        p.Port,
				"targetPort":  p.TargetPort,
				"nodePort":    p.NodePort,
				"appProtocol": p.AppProtocol,
			})
		}

		ingressSummary := make([]map[string]string, 0, len(svc.Status.LoadBalancer.Ingress))
		for _, ing := range svc.Status.LoadBalancer.Ingress {
			ingressSummary = append(ingressSummary, map[string]string{
				"ip":       ing.IP,
				"hostname": ing.Hostname,
			})
		}

		results = append(results, ResourceObservation{
			ID:              svc.Metadata.UID,
			Kind:            "Service",
			Namespace:       svc.Metadata.Namespace,
			Name:            svc.Metadata.Name,
			Status:          svc.Spec.Type,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          svc.Metadata.Labels,
			Annotations:     sanitizeAnnotations(svc.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(svc.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"type":                  svc.Spec.Type,
				"clusterIP":             svc.Spec.ClusterIP,
				"clusterIPs":            svc.Spec.ClusterIPs,
				"selector":              svc.Spec.Selector,
				"ports":                 portsSummary,
				"sessionAffinity":       svc.Spec.SessionAffinity,
				"externalTrafficPolicy": svc.Spec.ExternalTrafficPolicy,
			},
			StatusSummary: map[string]interface{}{
				"loadBalancer": map[string]interface{}{
					"ingress": ingressSummary,
				},
			},
			Events: eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectIngresses(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var ingressList K8sIngressList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/networking.k8s.io/v1/ingresses", &ingressList)
	if err != nil {
		slog.Debug("Ingresses collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, ing := range ingressList.Items {
		createdTs := parseCreationTimestamp(ing.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("Ingress/%s/%s", ing.Metadata.Namespace, ing.Metadata.Name)

		rulesSummary := make([]map[string]interface{}, 0, len(ing.Spec.Rules))
		for _, r := range ing.Spec.Rules {
			paths := make([]map[string]interface{}, 0)
			if r.HTTP != nil {
				for _, p := range r.HTTP.Paths {
					pathMap := map[string]interface{}{
						"path":     p.Path,
						"pathType": p.PathType,
					}
					if p.Backend.Service != nil {
						pathMap["serviceName"] = p.Backend.Service.Name
						if p.Backend.Service.Port.Number != 0 {
							pathMap["servicePort"] = p.Backend.Service.Port.Number
						} else {
							pathMap["servicePort"] = p.Backend.Service.Port.Name
						}
					}
					paths = append(paths, pathMap)
				}
			}
			rulesSummary = append(rulesSummary, map[string]interface{}{
				"host":  r.Host,
				"paths": paths,
			})
		}

		tlsSummary := make([]map[string]interface{}, 0, len(ing.Spec.TLS))
		for _, t := range ing.Spec.TLS {
			tlsSummary = append(tlsSummary, map[string]interface{}{
				"hosts":      t.Hosts,
				"secretName": t.SecretName,
			})
		}

		lbSummary := make([]map[string]string, 0, len(ing.Status.LoadBalancer.Ingress))
		for _, lbi := range ing.Status.LoadBalancer.Ingress {
			lbSummary = append(lbSummary, map[string]string{
				"ip":       lbi.IP,
				"hostname": lbi.Hostname,
			})
		}

		results = append(results, ResourceObservation{
			ID:              ing.Metadata.UID,
			Kind:            "Ingress",
			Namespace:       ing.Metadata.Namespace,
			Name:            ing.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          ing.Metadata.Labels,
			Annotations:     sanitizeAnnotations(ing.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(ing.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"ingressClassName": ing.Spec.IngressClassName,
				"rules":            rulesSummary,
				"tls":              tlsSummary,
			},
			StatusSummary: map[string]interface{}{
				"loadBalancer": map[string]interface{}{
					"ingress": lbSummary,
				},
			},
			Events: eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectEndpoints(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var epList K8sEndpointsList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/endpoints", &epList)
	if err != nil {
		slog.Debug("Endpoints collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, ep := range epList.Items {
		createdTs := parseCreationTimestamp(ep.Metadata.CreationTimestamp)

		readyCount := 0
		notReadyCount := 0
		for _, s := range ep.Subsets {
			readyCount += len(s.Addresses)
			notReadyCount += len(s.NotReadyAddresses)
		}

		results = append(results, ResourceObservation{
			ID:              ep.Metadata.UID,
			Kind:            "Endpoints",
			Namespace:       ep.Metadata.Namespace,
			Name:            ep.Metadata.Name,
			Status:          fmt.Sprintf("%d ready", readyCount),
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          ep.Metadata.Labels,
			Annotations:     sanitizeAnnotations(ep.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(ep.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"readyCount":    readyCount,
				"notReadyCount": notReadyCount,
				"subsetsCount":  len(ep.Subsets),
			},
			StatusSummary: map[string]interface{}{
				"readyAddresses":    readyCount,
				"notReadyAddresses": notReadyCount,
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectPVCs(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var pvcList K8sPVCList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/persistentvolumeclaims", &pvcList)
	if err != nil {
		slog.Warn("Failed to list Kubernetes PVCs", "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, pvc := range pvcList.Items {
		health := "HEALTHY"
		if pvc.Status.Phase == "Lost" {
			health = "CRITICAL"
		} else if pvc.Status.Phase == "Pending" {
			health = "WARNING"
		}

		createdTs := parseCreationTimestamp(pvc.Metadata.CreationTimestamp)
		pvcEvents := eventsMap[fmt.Sprintf("PersistentVolumeClaim/%s/%s", pvc.Metadata.Namespace, pvc.Metadata.Name)]

		results = append(results, ResourceObservation{
			ID:              pvc.Metadata.UID,
			Kind:            "PersistentVolumeClaim",
			Namespace:       pvc.Metadata.Namespace,
			Name:            pvc.Metadata.Name,
			Status:          pvc.Status.Phase,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          pvc.Metadata.Labels,
			Annotations:     sanitizeAnnotations(pvc.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(pvc.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"storageClassName": pvc.Spec.StorageClassName,
				"volumeName":       pvc.Spec.VolumeName,
				"accessModes":      pvc.Spec.AccessModes,
				"requests":         pvc.Spec.Resources.Requests,
			},
			StatusSummary: map[string]interface{}{
				"phase":    pvc.Status.Phase,
				"capacity": pvc.Status.Capacity,
			},
			Events: pvcEvents,
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectPersistentVolumes(ctx context.Context, eventsMap map[string][]EventObservation) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var pvList K8sPersistentVolumeList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/persistentvolumes", &pvList)
	if err != nil {
		slog.Debug("PersistentVolumes collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, pv := range pvList.Items {
		createdTs := parseCreationTimestamp(pv.Metadata.CreationTimestamp)
		eventKey := fmt.Sprintf("PersistentVolume//%s", pv.Metadata.Name)

		health := "HEALTHY"
		if pv.Status.Phase == "Failed" {
			health = "CRITICAL"
		} else if pv.Status.Phase == "Released" {
			health = "WARNING"
		}

		var claimSummary map[string]string
		if pv.Spec.ClaimRef != nil {
			claimSummary = map[string]string{
				"kind":      pv.Spec.ClaimRef.Kind,
				"namespace": pv.Spec.ClaimRef.Namespace,
				"name":      pv.Spec.ClaimRef.Name,
				"uid":       pv.Spec.ClaimRef.UID,
			}
		}

		results = append(results, ResourceObservation{
			ID:              pv.Metadata.UID,
			Kind:            "PersistentVolume",
			Namespace:       pv.Metadata.Namespace,
			Name:            pv.Metadata.Name,
			Status:          pv.Status.Phase,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          pv.Metadata.Labels,
			Annotations:     sanitizeAnnotations(pv.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(pv.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"capacity":                      pv.Spec.Capacity,
				"accessModes":                   pv.Spec.AccessModes,
				"persistentVolumeReclaimPolicy": pv.Spec.PersistentVolumeReclaimPolicy,
				"storageClassName":              pv.Spec.StorageClassName,
				"volumeMode":                    pv.Spec.VolumeMode,
				"claimRef":                      claimSummary,
			},
			StatusSummary: map[string]interface{}{
				"phase":   pv.Status.Phase,
				"message": pv.Status.Message,
				"reason":  pv.Status.Reason,
			},
			Events: eventsMap[eventKey],
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectStorageClasses(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var scList K8sStorageClassList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/storage.k8s.io/v1/storageclasses", &scList)
	if err != nil {
		slog.Debug("StorageClasses collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, sc := range scList.Items {
		createdTs := parseCreationTimestamp(sc.Metadata.CreationTimestamp)

		isDefault := false
		if sc.Metadata.Annotations != nil {
			if sc.Metadata.Annotations["storageclass.kubernetes.io/is-default-class"] == "true" ||
				sc.Metadata.Annotations["storageclass.beta.kubernetes.io/is-default-class"] == "true" {
				isDefault = true
			}
		}

		results = append(results, ResourceObservation{
			ID:              sc.Metadata.UID,
			Kind:            "StorageClass",
			Namespace:       sc.Metadata.Namespace,
			Name:            sc.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          sc.Metadata.Labels,
			Annotations:     sanitizeAnnotations(sc.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(sc.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"provisioner":          sc.Provisioner,
				"reclaimPolicy":        sc.ReclaimPolicy,
				"volumeBindingMode":    sc.VolumeBindingMode,
				"allowVolumeExpansion": sc.AllowVolumeExpansion,
				"isDefault":            isDefault,
			},
			StatusSummary: map[string]interface{}{
				"provisioner": sc.Provisioner,
				"isDefault":   isDefault,
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectConfigMaps(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var cmList K8sConfigMapList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/configmaps", &cmList)
	if err != nil {
		slog.Debug("ConfigMaps collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, cm := range cmList.Items {
		createdTs := parseCreationTimestamp(cm.Metadata.CreationTimestamp)

		// Strict security: NEVER store or read configuration values or file contents!
		// ONLY extract key names for discovery.
		keys := make([]string, 0, len(cm.Data)+len(cm.BinaryData))
		for k := range cm.Data {
			keys = append(keys, k)
		}
		for k := range cm.BinaryData {
			keys = append(keys, k)
		}
		sort.Strings(keys)

		isImmutable := false
		if cm.Immutable != nil {
			isImmutable = *cm.Immutable
		}

		results = append(results, ResourceObservation{
			ID:              cm.Metadata.UID,
			Kind:            "ConfigMap",
			Namespace:       cm.Metadata.Namespace,
			Name:            cm.Metadata.Name,
			Status:          fmt.Sprintf("%d keys", len(keys)),
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          cm.Metadata.Labels,
			Annotations:     sanitizeAnnotations(cm.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(cm.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"keys":      keys,
				"keyCount":  len(keys),
				"immutable": isImmutable,
			},
			StatusSummary: map[string]interface{}{
				"keyCount": len(keys),
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectSecrets(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var secList K8sSecretList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/secrets", &secList)
	if err != nil {
		slog.Debug("Secrets collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, sec := range secList.Items {
		createdTs := parseCreationTimestamp(sec.Metadata.CreationTimestamp)

		// Strict security: NEVER store or read secret contents, passwords, or tokens!
		// ONLY count the number of keys and record type.
		keyCount := len(sec.Data) + len(sec.StringData)

		isImmutable := false
		if sec.Immutable != nil {
			isImmutable = *sec.Immutable
		}

		results = append(results, ResourceObservation{
			ID:              sec.Metadata.UID,
			Kind:            "Secret",
			Namespace:       sec.Metadata.Namespace,
			Name:            sec.Metadata.Name,
			Status:          sec.Type,
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          sec.Metadata.Labels,
			Annotations:     sanitizeAnnotations(sec.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(sec.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"type":      sec.Type,
				"keyCount":  keyCount,
				"immutable": isImmutable,
			},
			StatusSummary: map[string]interface{}{
				"type":     sec.Type,
				"keyCount": keyCount,
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectNamespaces(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var nsList K8sNamespaceList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/namespaces", &nsList)
	if err != nil {
		slog.Debug("Namespaces collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, ns := range nsList.Items {
		createdTs := parseCreationTimestamp(ns.Metadata.CreationTimestamp)

		health := "HEALTHY"
		displayStatus := ns.Status.Phase
		if displayStatus == "" {
			displayStatus = "Active"
		}
		if displayStatus == "Terminating" {
			health = "WARNING"
		}

		results = append(results, ResourceObservation{
			ID:              ns.Metadata.UID,
			Kind:            "Namespace",
			Namespace:       "",
			Name:            ns.Metadata.Name,
			Status:          displayStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          ns.Metadata.Labels,
			Annotations:     sanitizeAnnotations(ns.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(ns.Metadata.OwnerReferences),
			SpecSummary:     map[string]interface{}{},
			StatusSummary: map[string]interface{}{
				"phase": displayStatus,
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectResourceQuotas(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var rqList K8sResourceQuotaList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/resourcequotas", &rqList)
	if err != nil {
		slog.Debug("ResourceQuotas collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, rq := range rqList.Items {
		createdTs := parseCreationTimestamp(rq.Metadata.CreationTimestamp)

		results = append(results, ResourceObservation{
			ID:              rq.Metadata.UID,
			Kind:            "ResourceQuota",
			Namespace:       rq.Metadata.Namespace,
			Name:            rq.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          rq.Metadata.Labels,
			Annotations:     sanitizeAnnotations(rq.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(rq.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"hard": rq.Spec.Hard,
			},
			StatusSummary: map[string]interface{}{
				"hard": rq.Status.Hard,
				"used": rq.Status.Used,
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectLimitRanges(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var lrList K8sLimitRangeList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/limitranges", &lrList)
	if err != nil {
		slog.Debug("LimitRanges collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, lr := range lrList.Items {
		createdTs := parseCreationTimestamp(lr.Metadata.CreationTimestamp)

		limitsSummary := make([]map[string]interface{}, 0, len(lr.Spec.Limits))
		for _, l := range lr.Spec.Limits {
			limitsSummary = append(limitsSummary, map[string]interface{}{
				"type":           l.Type,
				"max":            l.Max,
				"min":            l.Min,
				"default":        l.Default,
				"defaultRequest": l.DefaultRequest,
			})
		}

		results = append(results, ResourceObservation{
			ID:              lr.Metadata.UID,
			Kind:            "LimitRange",
			Namespace:       lr.Metadata.Namespace,
			Name:            lr.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          lr.Metadata.Labels,
			Annotations:     sanitizeAnnotations(lr.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(lr.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"limits": limitsSummary,
			},
			StatusSummary: map[string]interface{}{
				"limitsCount": len(limitsSummary),
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectServiceAccounts(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var saList K8sServiceAccountList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/serviceaccounts", &saList)
	if err != nil {
		slog.Debug("ServiceAccounts collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, sa := range saList.Items {
		createdTs := parseCreationTimestamp(sa.Metadata.CreationTimestamp)

		isAutoMount := true
		if sa.AutomountServiceAccountToken != nil {
			isAutoMount = *sa.AutomountServiceAccountToken
		}

		results = append(results, ResourceObservation{
			ID:              sa.Metadata.UID,
			Kind:            "ServiceAccount",
			Namespace:       sa.Metadata.Namespace,
			Name:            sa.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          sa.Metadata.Labels,
			Annotations:     sanitizeAnnotations(sa.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(sa.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"secretsCount":                 len(sa.Secrets),
				"imagePullSecretsCount":        len(sa.ImagePullSecrets),
				"automountServiceAccountToken": isAutoMount,
			},
			StatusSummary: map[string]interface{}{
				"secretsCount": len(sa.Secrets),
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectRoleBindings(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var rbList K8sRoleBindingList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/rbac.authorization.k8s.io/v1/rolebindings", &rbList)
	if err != nil {
		slog.Debug("RoleBindings collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, rb := range rbList.Items {
		createdTs := parseCreationTimestamp(rb.Metadata.CreationTimestamp)

		subjectsSummary := make([]map[string]string, 0, len(rb.Subjects))
		for _, s := range rb.Subjects {
			subjectsSummary = append(subjectsSummary, map[string]string{
				"kind":      s.Kind,
				"name":      s.Name,
				"namespace": s.Namespace,
				"apiGroup":  s.APIGroup,
			})
		}

		results = append(results, ResourceObservation{
			ID:              rb.Metadata.UID,
			Kind:            "RoleBinding",
			Namespace:       rb.Metadata.Namespace,
			Name:            rb.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          rb.Metadata.Labels,
			Annotations:     sanitizeAnnotations(rb.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(rb.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"roleRef": map[string]string{
					"apiGroup": rb.RoleRef.APIGroup,
					"kind":     rb.RoleRef.Kind,
					"name":     rb.RoleRef.Name,
				},
				"subjects": subjectsSummary,
			},
			StatusSummary: map[string]interface{}{
				"subjectsCount": len(subjectsSummary),
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectClusterRoleBindings(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	var results []ResourceObservation

	var crbList K8sClusterRoleBindingList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/apis/rbac.authorization.k8s.io/v1/clusterrolebindings", &crbList)
	if err != nil {
		slog.Debug("ClusterRoleBindings collection notice", "status", status, "error", err)
		return results, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	for _, crb := range crbList.Items {
		createdTs := parseCreationTimestamp(crb.Metadata.CreationTimestamp)

		subjectsSummary := make([]map[string]string, 0, len(crb.Subjects))
		for _, s := range crb.Subjects {
			subjectsSummary = append(subjectsSummary, map[string]string{
				"kind":      s.Kind,
				"name":      s.Name,
				"namespace": s.Namespace,
				"apiGroup":  s.APIGroup,
			})
		}

		results = append(results, ResourceObservation{
			ID:              crb.Metadata.UID,
			Kind:            "ClusterRoleBinding",
			Namespace:       "",
			Name:            crb.Metadata.Name,
			Status:          "Active",
			Health:          "HEALTHY",
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          crb.Metadata.Labels,
			Annotations:     sanitizeAnnotations(crb.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(crb.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"roleRef": map[string]string{
					"apiGroup": crb.RoleRef.APIGroup,
					"kind":     crb.RoleRef.Kind,
					"name":     crb.RoleRef.Name,
				},
				"subjects": subjectsSummary,
			},
			StatusSummary: map[string]interface{}{
				"subjectsCount": len(subjectsSummary),
			},
		})
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) collectHelmReleases(ctx context.Context) ([]ResourceObservation, CollectionStatusItem) {
	now := time.Now().UnixMilli()
	// Helm stores releases in Secrets with label owner=helm
	var secList K8sSecretList
	status, err := c.k8sClient.GetJSONWithStatus(ctx, "/api/v1/secrets?labelSelector=owner%3Dhelm", &secList)
	if err != nil {
		slog.Debug("Helm release query notice", "status", status, "error", err)
		return nil, CollectionStatusItem{
			Success:    false,
			ObservedAt: now,
			StatusCode: status,
			Error:      err.Error(),
		}
	}

	type helmReleaseKey struct {
		Namespace string
		Name      string
	}
	latestReleases := make(map[helmReleaseKey]ResourceObservation)

	for _, sec := range secList.Items {
		releaseName := sec.Metadata.Labels["name"]
		if releaseName == "" {
			parts := strings.Split(sec.Metadata.Name, ".")
			if len(parts) >= 5 && parts[0] == "sh" && parts[1] == "helm" && parts[2] == "release" {
				releaseName = parts[4]
			}
		}
		if releaseName == "" {
			continue
		}

		helmStatus := sec.Metadata.Labels["status"]
		if helmStatus == "" {
			helmStatus = "deployed"
		}

		revisionStr := sec.Metadata.Labels["version"]
		revision := 1
		if revisionStr != "" {
			fmt.Sscanf(revisionStr, "%d", &revision)
		}

		chartName := ""
		description := ""
		firstDeployed := ""
		lastDeployed := ""
		if sec.Metadata.Annotations != nil {
			chartName = sec.Metadata.Annotations["chart"]
			description = sec.Metadata.Annotations["description"]
			firstDeployed = sec.Metadata.Annotations["firstDeployed"]
			lastDeployed = sec.Metadata.Annotations["lastDeployed"]
		}

		health := "HEALTHY"
		switch strings.ToLower(helmStatus) {
		case "deployed":
			health = "HEALTHY"
		case "failed":
			health = "CRITICAL"
		case "pending-install", "pending-upgrade", "uninstalling":
			health = "WARNING"
		default:
			health = "HEALTHY"
		}

		createdTs := parseCreationTimestamp(sec.Metadata.CreationTimestamp)
		key := helmReleaseKey{Namespace: sec.Metadata.Namespace, Name: releaseName}

		if existing, exists := latestReleases[key]; exists {
			if existingRev, ok := existing.SpecSummary["revision"].(int); ok && revision <= existingRev {
				continue
			}
		}

		latestReleases[key] = ResourceObservation{
			ID:              sec.Metadata.UID,
			Kind:            "HelmRelease",
			Namespace:       sec.Metadata.Namespace,
			Name:            releaseName,
			Status:          helmStatus,
			Health:          health,
			CreatedAt:       createdTs,
			UpdatedAt:       now,
			ObservedAt:      now,
			Labels:          sec.Metadata.Labels,
			Annotations:     sanitizeAnnotations(sec.Metadata.Annotations),
			OwnerReferences: convertOwnerReferences(sec.Metadata.OwnerReferences),
			SpecSummary: map[string]interface{}{
				"chart":      chartName,
				"revision":   revision,
				"secretName": sec.Metadata.Name,
			},
			StatusSummary: map[string]interface{}{
				"status":        helmStatus,
				"firstDeployed": firstDeployed,
				"lastDeployed":  lastDeployed,
				"description":   description,
			},
		}
	}

	results := make([]ResourceObservation, 0, len(latestReleases))
	for _, obs := range latestReleases {
		results = append(results, obs)
	}

	return results, CollectionStatusItem{
		Success:    true,
		Count:      len(results),
		ObservedAt: now,
		StatusCode: status,
	}
}

func (c *Collector) flushQueue(ctx context.Context) {
	items := c.queue.PopAll()
	if len(items) == 0 {
		return
	}

	payload := map[string]interface{}{
		"clusterId":        c.cfg.ClusterID,
		"timestamp":        time.Now().UnixMilli(),
		"observedAt":       c.lastObservedAt,
		"transmittedAt":    time.Now().UnixMilli(),
		"items":            items,
		"collectionStatus": c.lastCollectionStatus,
		"snapshotComplete": c.lastSnapshotComplete,
	}

	if err := c.client.SendTelemetry(ctx, payload); err != nil {
		c.queue.RequeueFront(items)
		slog.Warn("Failed to dispatch telemetry batch", "error", err, "itemCount", len(items))
	} else {
		slog.Info("Dispatched telemetry batch", "itemCount", len(items), "clusterId", c.cfg.ClusterID, "snapshotComplete", c.lastSnapshotComplete)
	}
}

// Helper methods

func parseProbe(probe *K8sProbe) *ProbeInfo {
	if probe == nil {
		return nil
	}
	info := &ProbeInfo{
		InitialDelaySeconds: probe.InitialDelaySeconds,
		PeriodSeconds:       probe.PeriodSeconds,
		TimeoutSeconds:      probe.TimeoutSeconds,
		FailureThreshold:    probe.FailureThreshold,
		SuccessThreshold:    probe.SuccessThreshold,
	}
	if probe.HTTPGet != nil {
		info.Type = "httpGet"
		info.Path = probe.HTTPGet.Path
		info.Port = fmt.Sprintf("%v", probe.HTTPGet.Port)
	} else if probe.TCPSocket != nil {
		info.Type = "tcpSocket"
		info.Port = fmt.Sprintf("%v", probe.TCPSocket.Port)
	} else if probe.Exec != nil {
		info.Type = "exec"
		info.Path = strings.Join(probe.Exec.Command, " ")
	} else if probe.GRPC != nil {
		info.Type = "grpc"
		info.Port = fmt.Sprintf("%d", probe.GRPC.Port)
	}
	return info
}

func sanitizeAnnotations(annotations map[string]string) map[string]string {
	if len(annotations) == 0 {
		return nil
	}
	sanitized := make(map[string]string, len(annotations))
	for k, v := range annotations {
		lowerK := strings.ToLower(k)
		// Strictly avoid storing any tokens, passwords, secrets, or credentials
		if strings.Contains(lowerK, "token") ||
			strings.Contains(lowerK, "secret") ||
			strings.Contains(lowerK, "password") ||
			strings.Contains(lowerK, "authorization") ||
			strings.Contains(lowerK, "credential") ||
			strings.Contains(lowerK, "private-key") {
			continue
		}
		if len(v) > 512 {
			v = v[:512] + "..."
		}
		sanitized[k] = v
	}
	return sanitized
}

func convertOwnerReferences(owners []struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	UID        string `json:"uid"`
	Controller *bool  `json:"controller"`
}) []OwnerReference {
	if len(owners) == 0 {
		return nil
	}
	res := make([]OwnerReference, 0, len(owners))
	for _, o := range owners {
		isCtrl := false
		if o.Controller != nil {
			isCtrl = *o.Controller
		}
		res = append(res, OwnerReference{
			APIVersion: o.APIVersion,
			Kind:       o.Kind,
			Name:       o.Name,
			UID:        o.UID,
			Controller: isCtrl,
		})
	}
	return res
}

func parseCreationTimestamp(ts string) int64 {
	if ts == "" {
		return time.Now().UnixMilli()
	}
	if t, err := time.Parse(time.RFC3339, ts); err == nil {
		return t.UnixMilli()
	}
	return time.Now().UnixMilli()
}
