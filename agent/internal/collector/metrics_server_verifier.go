package collector

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/skyops-io/skyops/agent/internal/transport"
)

// VerifyMetricsServer performs a comprehensive read-only check of the Metrics Server
func VerifyMetricsServer(ctx context.Context, kClient *InClusterK8sClient, clusterID, requestID string) transport.MetricsServerVerificationResult {
	res := transport.MetricsServerVerificationResult{
		RequestID:  requestID,
		ClusterID:  clusterID,
		VerifiedAt: time.Now().UnixMilli(),
	}

	if kClient == nil {
		res.Status = "UNKNOWN"
		res.WhatHappened = "SkyOps agent has no Kubernetes API client available."
		res.Why = "Agent is running without in-cluster credentials or API client configuration."
		res.Impact = "Cannot verify Metrics Server status from within the cluster."
		res.NextAction = "Check agent pod service account and in-cluster config."
		res.Diagnostics = []string{"Agent in-cluster Kubernetes client is nil."}
		return res
	}

	// 1. Check Metrics Server Deployment in kube-system (and fallback cluster-wide)
	var depList K8sDeploymentList
	err := kClient.GetJSON(ctx, "/apis/apps/v1/namespaces/kube-system/deployments", &depList)
	if err != nil {
		_ = kClient.GetJSON(ctx, "/apis/apps/v1/deployments", &depList)
	}

	for _, d := range depList.Items {
		if strings.Contains(strings.ToLower(d.Metadata.Name), "metrics-server") {
			res.DeploymentFound = true
			res.DeploymentName = d.Metadata.Name
			res.DeploymentNamespace = d.Metadata.Namespace
			res.ExpectedReplicas = d.Status.Replicas
			res.ReadyReplicas = d.Status.ReadyReplicas
			if d.Status.ReadyReplicas > 0 {
				res.DeploymentReady = true
			}
			break
		}
	}

	// 2. Check Metrics Server Pods
	nsToCheck := res.DeploymentNamespace
	if nsToCheck == "" {
		nsToCheck = "kube-system"
	}
	var podList K8sPodList
	_ = kClient.GetJSON(ctx, fmt.Sprintf("/api/v1/namespaces/%s/pods", nsToCheck), &podList)
	for _, p := range podList.Items {
		if strings.Contains(strings.ToLower(p.Metadata.Name), "metrics-server") {
			res.PodName = p.Metadata.Name
			res.PodPhase = p.Status.Phase
			if !res.DeploymentFound {
				res.DeploymentFound = true
				res.DeploymentName = "metrics-server"
				res.DeploymentNamespace = nsToCheck
			}
			for _, cond := range p.Status.Conditions {
				if cond.Type == "Ready" && cond.Status == "True" {
					res.PodReady = true
					break
				}
			}
			break
		}
	}

	// 3. Check metrics.k8s.io API reachability
	code, apiErr := kClient.GetJSONWithStatus(ctx, "/apis/metrics.k8s.io/v1beta1", nil)
	if code == http.StatusOK {
		res.APIReachable = true
	} else if apiErr != nil {
		res.RawError = apiErr.Error()
	}

	// 4. Try retrieving Node Metrics
	nodeMetrics, nodeErr := kClient.GetNodeMetrics(ctx)
	if nodeErr == nil && nodeMetrics != nil && len(nodeMetrics.Items) > 0 {
		res.NodeMetricsAvailable = true
		res.NodeMetricsCount = len(nodeMetrics.Items)
	} else if nodeErr != nil && res.RawError == "" {
		res.RawError = nodeErr.Error()
	}

	// 5. Try retrieving Pod Metrics
	podMetrics, podErr := kClient.GetPodMetrics(ctx)
	if podErr == nil && podMetrics != nil && len(podMetrics.Items) > 0 {
		res.PodMetricsAvailable = true
		res.PodMetricsCount = len(podMetrics.Items)
	} else if podErr != nil && res.RawError == "" {
		res.RawError = podErr.Error()
	}

	// 6. Evaluate Evidence and Determine Truthful Status
	rawLower := strings.ToLower(res.RawError)
	isTlsError := strings.Contains(rawLower, "x509") || strings.Contains(rawLower, "certificate") || strings.Contains(rawLower, "tls")
	isForbidden := code == http.StatusForbidden || strings.Contains(rawLower, "forbidden") || strings.Contains(rawLower, "permission denied")

	if !res.DeploymentFound && !res.PodReady && !res.APIReachable && !res.NodeMetricsAvailable {
		res.Status = "NOT_INSTALLED"
		res.WhatHappened = "Metrics Server is not installed in this cluster."
		res.Why = "No deployment or pod matching 'metrics-server' was detected in the kube-system namespace or across the cluster."
		res.Impact = "Cluster and pod telemetry usage graphs are unavailable. Core observability (workloads, pod logs, events, alerts) continues operating normally."
		res.NextAction = "Install Metrics Server via kubectl or Helm if CPU and memory usage graphs are needed."
		res.Diagnostics = []string{
			"No metrics-server deployment found in kube-system.",
			"metrics.k8s.io API service is not registered.",
		}
	} else if res.DeploymentFound && (!res.DeploymentReady || !res.PodReady) {
		res.Status = "INSTALLED_NOT_READY"
		res.WhatHappened = "Metrics Server is installed in the cluster, but its workload is not ready."
		res.Why = fmt.Sprintf("Deployment %s has %d/%d ready replicas. Pod %s phase is %s.", res.DeploymentName, res.ReadyReplicas, res.ExpectedReplicas, res.PodName, res.PodPhase)
		res.Impact = "Metrics Server is unable to serve metrics because the pod is not in Ready state."
		res.NextAction = fmt.Sprintf("Run 'kubectl describe pod -n %s %s' or view pod logs in SkyOps to inspect why the pod is not ready.", res.DeploymentNamespace, res.PodName)
		res.Diagnostics = []string{
			fmt.Sprintf("Deployment %s/%s readiness: %d/%d", res.DeploymentNamespace, res.DeploymentName, res.ReadyReplicas, res.ExpectedReplicas),
			fmt.Sprintf("Pod %s status: %s (Ready: %t)", res.PodName, res.PodPhase, res.PodReady),
		}
	} else if isForbidden {
		res.Status = "PERMISSION_DENIED"
		res.WhatHappened = "SkyOps agent lacks permission to access the metrics.k8s.io API."
		res.Why = fmt.Sprintf("Kubernetes API returned Forbidden (403): %s", res.RawError)
		res.Impact = "SkyOps cannot retrieve node and pod metrics even if Metrics Server is running."
		res.NextAction = "Add RBAC rules granting the skyops-agent ClusterRole 'get' and 'list' verbs on 'metrics.k8s.io' API group."
		res.Diagnostics = []string{
			"RBAC authorization check failed on /apis/metrics.k8s.io/v1beta1.",
			"Raw error: " + res.RawError,
		}
	} else if !res.APIReachable && res.NodeMetricsCount == 0 && res.PodMetricsCount == 0 {
		res.Status = "API_UNAVAILABLE"
		res.WhatHappened = "The metrics.k8s.io API is not available or unreachable in the cluster."
		if isTlsError {
			res.Why = fmt.Sprintf("TLS certificate validation error between Metrics Server and kubelets: %s", res.RawError)
			res.Impact = "Metrics Server cannot scrape kubelet endpoints."
			res.NextAction = "If using a local or development cluster (Kind, Minikube, K3s, Docker Desktop), pass the --kubelet-insecure-tls flag to Metrics Server."
		} else {
			res.Why = fmt.Sprintf("Failed to query /apis/metrics.k8s.io/v1beta1 (HTTP %d): %s", code, res.RawError)
			res.Impact = "Kubernetes API server cannot proxy requests to Metrics Server."
			res.NextAction = "Inspect 'kubectl get apiservice v1beta1.metrics.k8s.io' and check Metrics Server logs."
		}
		res.Diagnostics = []string{
			fmt.Sprintf("APIService /apis/metrics.k8s.io/v1beta1 returned HTTP %d", code),
			"Raw error: " + res.RawError,
		}
	} else if res.APIReachable && res.NodeMetricsCount == 0 && res.PodMetricsCount == 0 {
		res.Status = "READY_NO_METRICS"
		res.WhatHappened = "Metrics Server is running and reachable, but has not returned any node or pod metrics."
		if isTlsError {
			res.Why = "Kubelet communication failed with TLS certificate error: " + res.RawError
			res.Impact = "Metrics Server cannot collect telemetry from cluster nodes."
			res.NextAction = "If this is a development cluster with self-signed kubelet certificates, patch Metrics Server with --kubelet-insecure-tls."
		} else {
			res.Why = "Metrics Server may have recently started and is waiting for its initial scrape interval (15-60s)."
			res.Impact = "Usage metrics are momentarily empty."
			res.NextAction = "Wait 30-60 seconds for the first scrape cycle to complete, then click 'Verify Installation' again."
		}
		res.Diagnostics = []string{
			"metrics.k8s.io reachable, but node/pod metrics list returned 0 items.",
		}
	} else {
		res.Status = "READY_WITH_METRICS"
		res.WhatHappened = "Metrics Server is active and returning real CPU and memory metrics."
		res.Why = fmt.Sprintf("Successfully retrieved metrics for %d nodes and %d pods from metrics.k8s.io.", res.NodeMetricsCount, res.PodMetricsCount)
		res.Impact = "Real-time and historical CPU/memory usage, cluster capacity charts, and workload sizing recommendations are fully operational."
		res.NextAction = "No action required. Telemetry is healthy."
		res.Diagnostics = []string{
			fmt.Sprintf("Verified %d node metrics items", res.NodeMetricsCount),
			fmt.Sprintf("Verified %d pod metrics items", res.PodMetricsCount),
			"API endpoint /apis/metrics.k8s.io/v1beta1 is healthy.",
		}
	}

	return res
}
