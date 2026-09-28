import { Cluster, Incident, KubernetesResource } from '../../../types/index';
import { ArchitectureDomainId } from '../types';
import {
  TopologyEdge,
  TopologyFilterState,
  TopologyGraphData,
  TopologyNode,
  TopologyRelationshipType,
  TopologyViewMode
} from './types';

interface BuilderOptions {
  resources: KubernetesResource[];
  cluster: Cluster | null;
  incidents: Incident[];
  filters: TopologyFilterState;
  expandedNodeIds: Set<string>;
  viewMode?: TopologyViewMode;
}

// Helper to create consistent unique resource keys
export function getResourceKey(r: { clusterId?: string; kind?: string; namespace?: string; name?: string }): string {
  return `${r.clusterId || '*'}/${r.kind || '*'}/${r.namespace || '*'}/${r.name || '*'}`;
}

export function buildTopologyGraph(options: BuilderOptions): TopologyGraphData {
  if (options.viewMode === 'grouped_namespace') {
    return buildNamespaceGroupedGraph(options);
  }
  if (options.viewMode === 'grouped_domain') {
    return buildDomainGroupedGraph(options);
  }
  return buildStandardTopologyGraph(options);
}

function buildStandardTopologyGraph({
  resources,
  cluster,
  incidents,
  filters,
  expandedNodeIds
}: BuilderOptions): TopologyGraphData {
  const safeResources = Array.isArray(resources)
    ? resources.filter((r): r is KubernetesResource => !!r && typeof r === 'object')
    : [];
  const safeIncidents = Array.isArray(incidents) ? incidents.filter(Boolean) : [];

  // Index incidents by resource key
  const incidentsByResource = new Map<string, Incident[]>();
  for (const inc of safeIncidents) {
    const key = `${inc.clusterId}/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const list = incidentsByResource.get(key) || [];
    list.push(inc);
    incidentsByResource.set(key, list);

    const wildcard = `*/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const wlist = incidentsByResource.get(wildcard) || [];
    wlist.push(inc);
    incidentsByResource.set(wildcard, wlist);
  }

  // Quick lookup of incidents for a resource
  const getResourceIncidents = (r: KubernetesResource): Incident[] => {
    const specific = incidentsByResource.get(`${r.clusterId}/${r.kind}/${r.namespace || ''}/${r.name}`);
    if (specific && specific.length > 0) return specific;
    const wildcard = incidentsByResource.get(`*/${r.kind}/${r.namespace || ''}/${r.name}`);
    return wildcard || [];
  };

  // Group resources by kind
  const resourcesByKind = new Map<string, KubernetesResource[]>();
  for (const r of safeResources) {
    const list = resourcesByKind.get(r.kind) || [];
    list.push(r);
    resourcesByKind.set(r.kind, list);
  }

  const getByKinds = (kinds: string[]): KubernetesResource[] => {
    const res: KubernetesResource[] = [];
    for (const k of kinds) {
      const match = resourcesByKind.get(k);
      if (match) res.push(...match);
    }
    return res;
  };

  // Filter application by namespace and search
  const matchesFilter = (r: KubernetesResource): boolean => {
    if (filters.namespace !== 'all' && r.namespace && r.namespace !== filters.namespace) {
      return false;
    }
    if (filters.health !== 'all' && r.health !== filters.health) {
      return false;
    }
    if (filters.incidentsOnly) {
      const incs = getResourceIncidents(r);
      if (incs.length === 0) return false;
    }
    if (filters.search.trim()) {
      const query = filters.search.toLowerCase().trim();
      const matchName = r.name.toLowerCase().includes(query);
      const matchKind = r.kind.toLowerCase().includes(query);
      const matchNs = r.namespace ? r.namespace.toLowerCase().includes(query) : false;
      const matchLabel = r.labels
        ? Object.entries(r.labels).some(
            ([k, v]) => k.toLowerCase().includes(query) || v.toLowerCase().includes(query)
          )
        : false;
      if (!matchName && !matchKind && !matchNs && !matchLabel) return false;
    }
    return true;
  };

  // Collect domain resources
  const allNodes = getByKinds(['Node']);
  const allPods = getByKinds(['Pod']);
  const allWorkloads = getByKinds([
    'Deployment',
    'StatefulSet',
    'DaemonSet',
    'Job',
    'CronJob',
    'Rollout'
  ]);
  const allReplicaSets = getByKinds(['ReplicaSet']);
  const allServices = getByKinds(['Service']);
  const allIngresses = getByKinds(['Ingress', 'Gateway']);
  const allEndpointSlices = getByKinds(['EndpointSlice']);
  const allPVCs = getByKinds(['PersistentVolumeClaim']);
  const allPVs = getByKinds(['PersistentVolume']);
  const allStorageClasses = getByKinds(['StorageClass']);
  const allConfigMaps = getByKinds(['ConfigMap']);
  const allSecrets = getByKinds(['Secret']);
  const allServiceAccounts = getByKinds(['ServiceAccount']);
  const allRoles = getByKinds(['Role', 'ClusterRole']);
  const allRoleBindings = getByKinds(['RoleBinding', 'ClusterRoleBinding']);
  const allHPAs = getByKinds(['HorizontalPodAutoscaler', 'VerticalPodAutoscaler']);

  // Helper to map workload to its child pods (Phase 18: strict ownerReferences first)
  const getWorkloadPods = (workload: KubernetesResource): KubernetesResource[] => {
    return allPods.filter((p) => {
      if (p.namespace !== workload.namespace) return false;

      // 1. Direct ownerReferences
      if (p.ownerReferences && p.ownerReferences.length > 0) {
        for (const o of p.ownerReferences) {
          if (!o) continue;
          if (o.kind === workload.kind && (o.uid && workload.uid ? o.uid === workload.uid : o.name === workload.name)) {
            return true;
          }
          // Deployment -> ReplicaSet -> Pod
          if (workload.kind === 'Deployment' && o.kind === 'ReplicaSet') {
            const rs = allReplicaSets.find(
              (r) => r.namespace === workload.namespace && (o.uid ? r.uid === o.uid : r.name === o.name)
            );
            if (
              rs?.ownerReferences?.some(
                (ro) =>
                  ro.kind === 'Deployment' &&
                  (ro.uid && workload.uid ? ro.uid === workload.uid : ro.name === workload.name)
              )
            ) {
              return true;
            }
            if (o.name && o.name.startsWith(`${workload.name}-`)) {
              return true;
            }
          }
        }
        // If ownerReferences are present on this Pod but did not match this workload, do not fall back to loose prefix matching
        return false;
      }

      // 2. Strict bounded fallback ONLY when ownerReferences are completely absent
      const prefix = `${workload.name}-`;
      if (!p.name.startsWith(prefix)) return false;
      const suffix = p.name.slice(prefix.length);
      return /^[a-z0-9]+(-[a-z0-9]+)*$/i.test(suffix);
    });
  };

  // Helper to find pods scheduled on a node
  const getNodePods = (node: KubernetesResource): KubernetesResource[] => {
    return allPods.filter((p) => {
      const nodeName =
        p.nodeName ||
        (p.specSummary?.nodeName as string) ||
        ((p as any).spec?.nodeName as string);
      return nodeName === node.name;
    });
  };

  // Helper to find Pods backing a Service
  const getServicePods = (service: KubernetesResource): KubernetesResource[] => {
    const selector =
      (service.specSummary?.selector as Record<string, string>) ||
      ((service as any).spec?.selector as Record<string, string>);
    if (!selector || typeof selector !== 'object' || Object.keys(selector).length === 0) {
      return [];
    }
    return allPods.filter((p) => {
      if (p.namespace !== service.namespace || !p.labels) return false;
      return Object.entries(selector).every(([k, v]) => p.labels?.[k] === v);
    });
  };

  // Helper to find Services routed by an Ingress
  const getIngressServices = (ingress: KubernetesResource): KubernetesResource[] => {
    const backendNames = new Set<string>();
    const spec = (ingress.specSummary || (ingress as any).spec || {}) as any;
    if (spec.rules && Array.isArray(spec.rules)) {
      for (const rule of spec.rules) {
        if (rule?.http?.paths && Array.isArray(rule.http.paths)) {
          for (const p of rule.http.paths) {
            const svcName = p?.backend?.service?.name || p?.backend?.serviceName;
            if (svcName) backendNames.add(svcName);
          }
        }
      }
    }
    if (spec.defaultBackend?.service?.name) {
      backendNames.add(spec.defaultBackend.service.name);
    }
    return allServices.filter(
      (s) => s.namespace === ingress.namespace && backendNames.has(s.name)
    );
  };

  // Helper to find PVCs attached to a Pod
  const getPodPVCs = (pod: KubernetesResource): KubernetesResource[] => {
    const volumes = (pod.specSummary?.volumes as any[]) || (pod as any).spec?.volumes || [];
    const claimNames = new Set<string>();
    for (const v of volumes) {
      if (v?.persistentVolumeClaim?.claimName) {
        claimNames.add(v.persistentVolumeClaim.claimName);
      }
    }
    if (claimNames.size === 0) return [];
    return allPVCs.filter((pvc) => pvc.namespace === pod.namespace && claimNames.has(pvc.name));
  };

  // Helper to find ConfigMaps / Secrets attached to a Pod
  const getPodConfigs = (pod: KubernetesResource): { configMaps: KubernetesResource[]; secrets: KubernetesResource[] } => {
    const volumes = (pod.specSummary?.volumes as any[]) || (pod as any).spec?.volumes || [];
    const cmNames = new Set<string>();
    const secretNames = new Set<string>();
    for (const v of volumes) {
      if (v?.configMap?.name) cmNames.add(v.configMap.name);
      if (v?.secret?.secretName) secretNames.add(v.secret.secretName);
    }
    const configMaps = allConfigMaps.filter((cm) => cm.namespace === pod.namespace && cmNames.has(cm.name));
    const secrets = allSecrets.filter((s) => s.namespace === pod.namespace && secretNames.has(s.name));
    return { configMaps, secrets };
  };

  // Nodes to construct
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // ==========================================
  // 1. ROOT CLUSTER NODE (Top-Center)
  // ==========================================
  const clusterId = cluster?.id || 'cluster-root';
  const clusterName = cluster?.name || 'Kubernetes Cluster';
  const clusterIncidents = safeIncidents.filter((i) => !cluster?.id || i.clusterId === cluster.id);
  const clusterDegraded = safeResources.some((r) => r.health === 'CRITICAL');
  const clusterWarning = safeResources.some((r) => r.health === 'WARNING');
  const clusterHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL' = clusterDegraded
    ? 'CRITICAL'
    : clusterWarning
    ? 'WARNING'
    : 'HEALTHY';

  const clusterRootNode: TopologyNode = {
    id: `cluster-${clusterId}`,
    type: 'cluster',
    kind: 'Cluster',
    name: clusterName,
    clusterId: cluster?.id,
    cluster: cluster || undefined,
    health: clusterHealth,
    statusText: clusterHealth === 'HEALTHY' ? 'Healthy' : clusterHealth === 'CRITICAL' ? 'Degraded' : 'Warning',
    badgeText: `${allNodes.length} Nodes  ${allPods.length} Pods  ${allServices.length} Services`,
    incidents: clusterIncidents,
    domainId: 'cluster',
    x: 520,
    y: 40,
    width: 280,
    height: 90
  };
  nodes.push(clusterRootNode);

  // Helper to determine if an architectural domain should be displayed
  const isDomainVisible = (dId: ArchitectureDomainId) => filters.domain === 'all' || filters.domain === dId;

  // Prioritize resources with active incidents and degraded states so critical issues are never hidden
  const prioritizeIssues = (resourceList: KubernetesResource[]): KubernetesResource[] => {
    return [...resourceList].sort((a, b) => {
      const aInc = getResourceIncidents(a).length;
      const bInc = getResourceIncidents(b).length;
      if (aInc !== bInc) return bInc - aInc;
      const healthWeight = (h?: string) => (h === 'CRITICAL' ? 3 : h === 'WARNING' ? 2 : 1);
      const hwDiff = healthWeight(b.health) - healthWeight(a.health);
      if (hwDiff !== 0) return hwDiff;
      return a.name.localeCompare(b.name);
    });
  };

  const renderedNodeIds = new Set<string>();
  const renderedWorkloadMap = new Map<string, TopologyNode>();
  const renderedServiceMap = new Map<string, TopologyNode>();
  const renderedPVCMap = new Map<string, TopologyNode>();

  // ==========================================
  // 2. ARCHITECTURAL DOMAIN GROUPS & RESOURCES
  // ==========================================
  // Column 1: Compute (x: 80)
  // Column 2: Workloads (x: 370)
  // Column 3: Networking (x: 670)
  // Column 4: Storage (x: 970)
  // Connected Bottom/Peripheral Domains: Configuration (x: 200), Security (x: 520), Scheduling (x: 840)

  // ------------------------------------------
  // COMPUTE DOMAIN
  // ------------------------------------------
  const filteredComputeNodes = prioritizeIssues(allNodes.filter(matchesFilter));
  let computeOffsetY = 305;

  if (isDomainVisible('compute')) {
    const computeHealth = filteredComputeNodes.some((n) => n.health === 'CRITICAL')
      ? 'CRITICAL'
      : filteredComputeNodes.some((n) => n.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

    const computeGroupNode: TopologyNode = {
      id: 'domain-compute',
      type: 'domain_group',
      kind: 'Compute',
      name: 'Compute',
      health: computeHealth,
      statusText: `${filteredComputeNodes.length} Nodes`,
      badgeText: computeHealth === 'HEALTHY' ? 'Healthy' : 'Issues Detected',
      incidents: [],
      domainId: 'compute',
      x: 80,
      y: 200,
      width: 230,
      height: 75
    };
    nodes.push(computeGroupNode);
    renderedNodeIds.add(computeGroupNode.id);
    edges.push({
      id: `edge-cluster-compute`,
      source: clusterRootNode.id,
      target: computeGroupNode.id,
      type: 'ownership'
    });

    // Render individual Nodes under Compute
    filteredComputeNodes.slice(0, 12).forEach((node) => {
      const nodeIncidents = getResourceIncidents(node);
      const scheduledPods = getNodePods(node);
      const hasExpanded = expandedNodeIds.has(`node-${node.id}`);

      // Real CPU/Memory metrics check
      const metricsAvailable = !!node.metrics || typeof node.cpuUsage === 'number' || typeof node.memoryUsage === 'number';
      let cpuText = 'UNAVAILABLE';
      let memText = 'UNAVAILABLE';
      if (metricsAvailable) {
        if (typeof node.cpuUsage === 'number') cpuText = `${Math.round(node.cpuUsage)}%`;
        if (typeof node.memoryUsage === 'number') memText = `${Math.round(node.memoryUsage)}%`;
      }

      const nodeNode: TopologyNode = {
        id: `node-${node.id}`,
        type: 'resource',
        kind: 'Node',
        name: node.name,
        namespace: node.namespace,
        clusterId: node.clusterId,
        resource: node,
        health: node.health || 'HEALTHY',
        statusText: node.status || 'Ready',
        metrics: {
          cpu: cpuText,
          memory: memText,
          isAvailable: metricsAvailable
        },
        incidents: nodeIncidents,
        subResourcesCount: scheduledPods.length,
        isExpanded: hasExpanded,
        canExpand: scheduledPods.length > 0,
        backingPods: scheduledPods,
        domainId: 'compute',
        x: 80,
        y: computeOffsetY,
        width: 230,
        height: 78
      };
      nodes.push(nodeNode);
      renderedNodeIds.add(nodeNode.id);

      edges.push({
        id: `edge-compute-${node.id}`,
        source: computeGroupNode.id,
        target: nodeNode.id,
        type: 'ownership'
      });

      computeOffsetY += 92;

      // If node is expanded by user, render its scheduled Pods!
      if (hasExpanded && scheduledPods.length > 0) {
        scheduledPods.slice(0, 12).forEach((p) => {
          const pIncidents = getResourceIncidents(p);
          const podNode: TopologyNode = {
            id: `pod-${p.id}`,
            type: 'pod_leaf',
            kind: 'Pod',
            name: p.name,
            namespace: p.namespace,
            clusterId: p.clusterId,
            resource: p,
            health: p.health || 'HEALTHY',
            statusText: p.status || 'Running',
            incidents: pIncidents,
            domainId: 'compute',
            x: 95,
            y: computeOffsetY,
            width: 200,
            height: 52
          };
          nodes.push(podNode);
          renderedNodeIds.add(podNode.id);
          edges.push({
            id: `edge-node-pod-${p.id}`,
            source: nodeNode.id,
            target: podNode.id,
            type: 'ownership'
          });
          computeOffsetY += 62;
        });
      }
    });
  }

  // ------------------------------------------
  // WORKLOADS DOMAIN
  // ------------------------------------------
  const filteredWorkloads = prioritizeIssues(allWorkloads.filter(matchesFilter));
  let workloadOffsetY = 305;

  if (isDomainVisible('workloads')) {
    const workloadsHealth = filteredWorkloads.some((w) => w.health === 'CRITICAL')
      ? 'CRITICAL'
      : filteredWorkloads.some((w) => w.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

    const workloadsGroupNode: TopologyNode = {
      id: 'domain-workloads',
      type: 'domain_group',
      kind: 'Workloads',
      name: 'Workloads',
      health: workloadsHealth,
      statusText: `${filteredWorkloads.length} Workloads`,
      badgeText: `${allWorkloads.filter((w) => w.kind === 'Deployment').length} Deployments`,
      incidents: [],
      domainId: 'workloads',
      x: 350,
      y: 200,
      width: 240,
      height: 75
    };
    nodes.push(workloadsGroupNode);
    renderedNodeIds.add(workloadsGroupNode.id);
    edges.push({
      id: `edge-cluster-workloads`,
      source: clusterRootNode.id,
      target: workloadsGroupNode.id,
      type: 'ownership'
    });

    filteredWorkloads.slice(0, 12).forEach((workload) => {
      const workloadIncidents = getResourceIncidents(workload);
      const childPods = getWorkloadPods(workload);
      const readyPods = childPods.filter((p) => p.status === 'Running' || p.health === 'HEALTHY');
      const isExpanded = expandedNodeIds.has(`workload-${workload.id}`);

      const workloadNode: TopologyNode = {
        id: `workload-${workload.id}`,
        type: 'resource',
        kind: workload.kind,
        name: workload.name,
        namespace: workload.namespace,
        clusterId: workload.clusterId,
        resource: workload,
        health: workload.health || 'HEALTHY',
        statusText: childPods.length > 0 ? `${readyPods.length}/${childPods.length} pods ready` : workload.status || 'Active',
        replicas: {
          ready: readyPods.length,
          desired: childPods.length || 1
        },
        incidents: workloadIncidents,
        subResourcesCount: childPods.length,
        isExpanded: isExpanded,
        canExpand: childPods.length > 0,
        backingPods: childPods,
        domainId: 'workloads',
        x: 350,
        y: workloadOffsetY,
        width: 240,
        height: 76
      };
      nodes.push(workloadNode);
      renderedNodeIds.add(workloadNode.id);
      renderedWorkloadMap.set(workload.name, workloadNode);

      edges.push({
        id: `edge-workload-group-${workload.id}`,
        source: workloadsGroupNode.id,
        target: workloadNode.id,
        type: 'ownership'
      });

      workloadOffsetY += 88;

      // Expand pods under workload if requested
      if (isExpanded && childPods.length > 0) {
        childPods.slice(0, 10).forEach((cp) => {
          const cpIncidents = getResourceIncidents(cp);
          const cpNode: TopologyNode = {
            id: `pod-${cp.id}`,
            type: 'pod_leaf',
            kind: 'Pod',
            name: cp.name,
            namespace: cp.namespace,
            clusterId: cp.clusterId,
            resource: cp,
            health: cp.health || 'HEALTHY',
            statusText: cp.status || 'Running',
            incidents: cpIncidents,
            domainId: 'workloads',
            x: 370,
            y: workloadOffsetY,
            width: 205,
            height: 52
          };
          nodes.push(cpNode);
          renderedNodeIds.add(cpNode.id);
          edges.push({
            id: `edge-workload-pod-${cp.id}`,
            source: workloadNode.id,
            target: cpNode.id,
            type: 'ownership'
          });
          workloadOffsetY += 62;
        });
      }
    });
  }

  // ------------------------------------------
  // NETWORKING DOMAIN
  // ------------------------------------------
  const filteredServices = prioritizeIssues(allServices.filter(matchesFilter));
  const filteredIngresses = prioritizeIssues(allIngresses.filter(matchesFilter));
  let netOffsetY = 305;

  if (isDomainVisible('networking')) {
    const netHealth = filteredServices.some((s) => s.health === 'CRITICAL') || filteredIngresses.some((i) => i.health === 'CRITICAL')
      ? 'CRITICAL'
      : filteredServices.some((s) => s.health === 'WARNING') || filteredIngresses.some((i) => i.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

    const networkingGroupNode: TopologyNode = {
      id: 'domain-networking',
      type: 'domain_group',
      kind: 'Networking',
      name: 'Networking',
      health: netHealth,
      statusText: `${filteredServices.length} Services`,
      badgeText: `${filteredIngresses.length} Ingress`,
      incidents: [],
      domainId: 'networking',
      x: 630,
      y: 200,
      width: 230,
      height: 75
    };
    nodes.push(networkingGroupNode);
    renderedNodeIds.add(networkingGroupNode.id);
    edges.push({
      id: `edge-cluster-networking`,
      source: clusterRootNode.id,
      target: networkingGroupNode.id,
      type: 'ownership'
    });

    // Ingresses first
    filteredIngresses.slice(0, 4).forEach((ingress) => {
      const ingIncidents = getResourceIncidents(ingress);
      const ingNode: TopologyNode = {
        id: `ingress-${ingress.id}`,
        type: 'resource',
        kind: ingress.kind,
        name: ingress.name,
        namespace: ingress.namespace,
        clusterId: ingress.clusterId,
        resource: ingress,
        health: ingress.health || 'HEALTHY',
        statusText: ingress.kind,
        incidents: ingIncidents,
        domainId: 'networking',
        x: 630,
        y: netOffsetY,
        width: 230,
        height: 68
      };
      nodes.push(ingNode);
      renderedNodeIds.add(ingNode.id);
      edges.push({
        id: `edge-net-ingress-${ingress.id}`,
        source: networkingGroupNode.id,
        target: ingNode.id,
        type: 'ownership'
      });
      netOffsetY += 80;

      // Traffic Flow: Ingress -> Services it routes to!
      const targetSvcs = getIngressServices(ingress);
      targetSvcs.forEach((ts) => {
        edges.push({
          id: `edge-traffic-${ingress.id}-${ts.id}`,
          source: ingNode.id,
          target: `service-${ts.id}`,
          type: 'traffic',
          animated: true,
          label: 'HTTP'
        });
      });
    });

    // Services
    filteredServices.slice(0, 10).forEach((service) => {
      const svcIncidents = getResourceIncidents(service);
      const backingPods = getServicePods(service);
      const svcType = (service.specSummary?.type as string) || (service as any).spec?.type || 'ClusterIP';

      const svcNode: TopologyNode = {
        id: `service-${service.id}`,
        type: 'resource',
        kind: 'Service',
        name: service.name,
        namespace: service.namespace,
        clusterId: service.clusterId,
        resource: service,
        health: service.health || 'HEALTHY',
        statusText: svcType,
        badgeText: backingPods.length > 0 ? `${backingPods.length} endpoints` : undefined,
        incidents: svcIncidents,
        backingPods: backingPods,
        domainId: 'networking',
        x: 630,
        y: netOffsetY,
        width: 230,
        height: 72
      };
      nodes.push(svcNode);
      renderedNodeIds.add(svcNode.id);
      renderedServiceMap.set(service.name, svcNode);

      edges.push({
        id: `edge-net-service-${service.id}`,
        source: networkingGroupNode.id,
        target: svcNode.id,
        type: 'ownership'
      });

      netOffsetY += 84;

      // Traffic Flow: Service -> Backing Workloads / Pods!
      // Connect service to the corresponding workloads via label selector matches
      for (const [wName, wNode] of renderedWorkloadMap.entries()) {
        if (wNode.resource?.namespace === service.namespace) {
          const selector =
            (service.specSummary?.selector as Record<string, string>) ||
            ((service as any).spec?.selector as Record<string, string>);
          if (selector && wNode.resource.labels) {
            const isSelected = Object.entries(selector).every(
              ([k, v]) => wNode.resource?.labels?.[k] === v
            );
            if (isSelected) {
              edges.push({
                id: `edge-traffic-svc-workload-${service.id}-${wNode.id}`,
                source: svcNode.id,
                target: wNode.id,
                type: 'traffic',
                animated: true
              });
            }
          }
        }
      }
    });
  }

  // ------------------------------------------
  // STORAGE DOMAIN
  // ------------------------------------------
  const filteredPVCs = prioritizeIssues(allPVCs.filter(matchesFilter));
  const filteredSCs = prioritizeIssues(allStorageClasses.filter(matchesFilter));
  const storageEmpty = allPVCs.length === 0 && allPVs.length === 0 && allStorageClasses.length === 0;
  let storageOffsetY = 305;

  if (isDomainVisible('storage')) {
    const storageGroupNode: TopologyNode = {
      id: 'domain-storage',
      type: 'domain_group',
      kind: 'Storage',
      name: 'Storage',
      health: storageEmpty ? 'UNKNOWN' : filteredPVCs.some((p) => p.health === 'CRITICAL') ? 'CRITICAL' : 'HEALTHY',
      statusText: storageEmpty ? 'No storage resources detected' : `${filteredPVCs.length} PVCs`,
      badgeText: storageEmpty ? undefined : `${filteredSCs.length} StorageClass`,
      incidents: [],
      domainId: 'storage',
      x: 900,
      y: 200,
      width: 230,
      height: 75
    };
    nodes.push(storageGroupNode);
    renderedNodeIds.add(storageGroupNode.id);
    edges.push({
      id: `edge-cluster-storage`,
      source: clusterRootNode.id,
      target: storageGroupNode.id,
      type: 'ownership'
    });

    if (!storageEmpty) {
      // StorageClasses
      filteredSCs.slice(0, 3).forEach((sc) => {
        const scNode: TopologyNode = {
          id: `sc-${sc.id}`,
          type: 'resource',
          kind: 'StorageClass',
          name: sc.name,
          clusterId: sc.clusterId,
          resource: sc,
          health: 'HEALTHY',
          statusText: 'StorageClass',
          incidents: [],
          domainId: 'storage',
          x: 900,
          y: storageOffsetY,
          width: 230,
          height: 66
        };
        nodes.push(scNode);
        renderedNodeIds.add(scNode.id);
        edges.push({
          id: `edge-storage-sc-${sc.id}`,
          source: storageGroupNode.id,
          target: scNode.id,
          type: 'ownership'
        });
        storageOffsetY += 78;
      });

      // PVCs
      filteredPVCs.slice(0, 8).forEach((pvc) => {
        const pvcIncidents = getResourceIncidents(pvc);
        const phase = (pvc.statusSummary?.phase as string) || pvc.status || 'Bound';
        const pvcNode: TopologyNode = {
          id: `pvc-${pvc.id}`,
          type: 'resource',
          kind: 'PersistentVolumeClaim',
          name: pvc.name,
          namespace: pvc.namespace,
          clusterId: pvc.clusterId,
          resource: pvc,
          health: pvc.health || 'HEALTHY',
          statusText: phase,
          incidents: pvcIncidents,
          domainId: 'storage',
          x: 900,
          y: storageOffsetY,
          width: 230,
          height: 70
        };
        nodes.push(pvcNode);
        renderedNodeIds.add(pvcNode.id);
        renderedPVCMap.set(pvc.name, pvcNode);

        edges.push({
          id: `edge-storage-pvc-${pvc.id}`,
          source: storageGroupNode.id,
          target: pvcNode.id,
          type: 'ownership'
        });
        storageOffsetY += 82;

        // Link Workloads/Pods to PVCs they use (Uses relationship)
        for (const [wName, wNode] of renderedWorkloadMap.entries()) {
          if (wNode.resource?.namespace === pvc.namespace) {
            const backing = wNode.backingPods || [];
            const usesPvc = backing.some((bp) => getPodPVCs(bp).some((cpvc) => cpvc.name === pvc.name));
            if (usesPvc) {
              edges.push({
                id: `edge-uses-workload-pvc-${wNode.id}-${pvc.id}`,
                source: wNode.id,
                target: pvcNode.id,
                type: 'uses'
              });
            }
          }
        }
      });
    }
  }

  // ==========================================
  // 3. CONNECTED ARCHITECTURAL DOMAINS (Bottom Tier)
  // ==========================================
  // Positioned cleanly around the lower canvas
  const bottomTierY = Math.max(computeOffsetY, workloadOffsetY, netOffsetY, storageOffsetY, 560) + 40;

  // CONFIGURATION DOMAIN (x: 180)
  if (isDomainVisible('configuration')) {
    const configGroupNode: TopologyNode = {
      id: 'domain-configuration',
      type: 'domain_group',
      kind: 'Configuration',
      name: 'Configuration',
      health: 'HEALTHY',
      statusText: `${allConfigMaps.length} ConfigMaps`,
      badgeText: `${allSecrets.length} Secrets (Metadata)`,
      incidents: [],
      domainId: 'configuration',
      x: 180,
      y: bottomTierY,
      width: 250,
      height: 80
    };
    nodes.push(configGroupNode);
    renderedNodeIds.add(configGroupNode.id);
    edges.push({
      id: `edge-workload-config`,
      source: 'domain-workloads',
      target: configGroupNode.id,
      type: 'uses'
    });
  }

  // SECURITY DOMAIN (x: 470)
  if (isDomainVisible('security')) {
    const secHealth = allRoles.some((r) => r.health === 'CRITICAL') ? 'CRITICAL' : 'HEALTHY';
    const securityGroupNode: TopologyNode = {
      id: 'domain-security',
      type: 'domain_group',
      kind: 'Security',
      name: 'Security',
      health: secHealth,
      statusText: `${allServiceAccounts.length} ServiceAccounts`,
      badgeText: `${allRoles.length} Roles  ${allRoleBindings.length} Bindings`,
      incidents: [],
      domainId: 'security',
      x: 470,
      y: bottomTierY,
      width: 260,
      height: 80
    };
    nodes.push(securityGroupNode);
    renderedNodeIds.add(securityGroupNode.id);
    edges.push({
      id: `edge-cluster-security`,
      source: clusterRootNode.id,
      target: securityGroupNode.id,
      type: 'ownership'
    });
  }

  // SCHEDULING DOMAIN (x: 720)
  if (isDomainVisible('scheduling')) {
    const schedTaintsCount = allNodes.filter((n) => ((n.specSummary?.taints as any[]) || []).length > 0).length;
    const schedGroupNode: TopologyNode = {
      id: 'domain-scheduling',
      type: 'domain_group',
      kind: 'Scheduling',
      name: 'Scheduling',
      health: 'HEALTHY',
      statusText: `${schedTaintsCount} Nodes with Taints`,
      badgeText: 'Affinity & Tolerations',
      incidents: [],
      domainId: 'scheduling',
      x: 720,
      y: bottomTierY,
      width: 250,
      height: 80
    };
    nodes.push(schedGroupNode);
    renderedNodeIds.add(schedGroupNode.id);
    edges.push({
      id: `edge-compute-scheduling`,
      source: 'domain-compute',
      target: schedGroupNode.id,
      type: 'depends_on'
    });
  }

  // SCALING DOMAIN (x: 1000)
  if (isDomainVisible('scaling')) {
    const scaleHealth = allHPAs.some((h) => h.health === 'CRITICAL')
      ? 'CRITICAL'
      : allHPAs.some((h) => h.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';
    const scalingGroupNode: TopologyNode = {
      id: 'domain-scaling',
      type: 'domain_group',
      kind: 'Scaling',
      name: 'Scaling',
      health: allHPAs.length > 0 ? scaleHealth : 'UNKNOWN',
      statusText: allHPAs.length > 0 ? `${allHPAs.length} HPA / Autoscalers` : 'No HPA configured',
      badgeText: allHPAs.length > 0 ? `${allHPAs.filter((h) => h.health === 'HEALTHY').length} Active` : undefined,
      incidents: [],
      domainId: 'scaling',
      x: 1000,
      y: bottomTierY,
      width: 250,
      height: 80
    };
    nodes.push(scalingGroupNode);
    renderedNodeIds.add(scalingGroupNode.id);
    edges.push({
      id: `edge-cluster-scaling`,
      source: clusterRootNode.id,
      target: scalingGroupNode.id,
      type: 'ownership'
    });

    let scalingOffsetY = bottomTierY + 95;
    allHPAs.slice(0, 4).forEach((hpa) => {
      const hpaNode: TopologyNode = {
        id: `hpa-${hpa.id}`,
        type: 'resource',
        kind: 'HorizontalPodAutoscaler',
        name: hpa.name,
        namespace: hpa.namespace,
        clusterId: hpa.clusterId,
        resource: hpa,
        health: hpa.health || 'HEALTHY',
        statusText: (hpa.specSummary?.targetRef as string) || 'Autoscaler',
        badgeText: 'HPA',
        incidents: getResourceIncidents(hpa),
        domainId: 'scaling',
        x: 1000,
        y: scalingOffsetY,
        width: 250,
        height: 66
      };
      nodes.push(hpaNode);
      renderedNodeIds.add(hpaNode.id);
      edges.push({
        id: `edge-scaling-hpa-${hpa.id}`,
        source: scalingGroupNode.id,
        target: hpaNode.id,
        type: 'ownership'
      });

      // Target deployment/workload edge
      const targetWorkload =
        renderedWorkloadMap.get(hpa.name) ||
        Array.from(renderedWorkloadMap.values()).find(
          (w) => w.name.includes(hpa.name) || hpa.name.includes(w.name)
        );
      if (targetWorkload) {
        edges.push({
          id: `edge-hpa-scale-${hpa.id}-${targetWorkload.id}`,
          source: hpaNode.id,
          target: targetWorkload.id,
          type: 'depends_on',
          label: 'Scales'
        });
      }
      scalingOffsetY += 78;
    });
  }

  return finalizeGraphData(nodes, edges);
}

// Calculate bounding box and adjacency indices
export function finalizeGraphData(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyGraphData {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const nodeMap = new Map<string, TopologyNode>();
  const adjacency = new Map<string, Set<string>>();
  const outgoingEdges = new Map<string, TopologyEdge[]>();
  const incomingEdges = new Map<string, TopologyEdge[]>();

  for (const n of nodes) {
    nodeMap.set(n.id, n);
    adjacency.set(n.id, new Set<string>());
    outgoingEdges.set(n.id, []);
    incomingEdges.set(n.id, []);

    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }

  // Filter out any edges referencing nonexistent nodes
  const validEdges = edges.filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target));

  for (const e of validEdges) {
    adjacency.get(e.source)?.add(e.target);
    adjacency.get(e.target)?.add(e.source);
    outgoingEdges.get(e.source)?.push(e);
    incomingEdges.get(e.target)?.push(e);
  }

  // Bounding box padding
  minX -= 60;
  minY -= 60;
  maxX += 60;
  maxY += 80;

  return {
    nodes,
    edges: validEdges,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: Math.max(maxX - minX, 1200),
      height: Math.max(maxY - minY, 800)
    },
    nodeMap,
    adjacency,
    outgoingEdges,
    incomingEdges
  };
}

function buildNamespaceGroupedGraph({
  resources,
  cluster,
  incidents,
  filters
}: BuilderOptions): TopologyGraphData {
  const safeResources = Array.isArray(resources)
    ? resources.filter((r): r is KubernetesResource => !!r && typeof r === 'object')
    : [];
  const safeIncidents = Array.isArray(incidents) ? incidents.filter(Boolean) : [];

  const incidentsByResource = new Map<string, Incident[]>();
  for (const inc of safeIncidents) {
    const key = `${inc.clusterId}/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const list = incidentsByResource.get(key) || [];
    list.push(inc);
    incidentsByResource.set(key, list);

    const wildcard = `*/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const wlist = incidentsByResource.get(wildcard) || [];
    wlist.push(inc);
    incidentsByResource.set(wildcard, wlist);
  }

  const getResourceIncidents = (r: KubernetesResource): Incident[] => {
    const specific = incidentsByResource.get(`${r.clusterId}/${r.kind}/${r.namespace || ''}/${r.name}`);
    if (specific && specific.length > 0) return specific;
    const wildcard = incidentsByResource.get(`*/${r.kind}/${r.namespace || ''}/${r.name}`);
    return wildcard || [];
  };

  const matchesFilter = (r: KubernetesResource): boolean => {
    if (filters.namespace !== 'all' && r.namespace && r.namespace !== filters.namespace) {
      return false;
    }
    if (filters.health !== 'all' && r.health !== filters.health) {
      return false;
    }
    if (filters.incidentsOnly) {
      const incs = getResourceIncidents(r);
      if (incs.length === 0) return false;
    }
    if (filters.search.trim()) {
      const query = filters.search.toLowerCase().trim();
      const matchName = r.name.toLowerCase().includes(query);
      const matchKind = r.kind.toLowerCase().includes(query);
      const matchNs = r.namespace ? r.namespace.toLowerCase().includes(query) : false;
      if (!matchName && !matchKind && !matchNs) return false;
    }
    return true;
  };

  const filteredResources = safeResources.filter(matchesFilter);
  const clusterId = cluster?.id || 'cluster-root';
  const clusterName = cluster?.name || 'Kubernetes Cluster';
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  // Cluster Root Node
  const clusterHealth = filteredResources.some((r) => r.health === 'CRITICAL')
    ? 'CRITICAL'
    : filteredResources.some((r) => r.health === 'WARNING')
    ? 'WARNING'
    : 'HEALTHY';

  // Group resources by namespace
  const namespaceMap = new Map<string, KubernetesResource[]>();
  for (const r of filteredResources) {
    const ns = r.namespace || 'cluster-scoped';
    const list = namespaceMap.get(ns) || [];
    list.push(r);
    namespaceMap.set(ns, list);
  }

  const sortedNamespaces = Array.from(namespaceMap.keys()).sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    if (a === 'cluster-scoped') return 1;
    if (b === 'cluster-scoped') return -1;
    return a.localeCompare(b);
  });

  const columnWidth = 320;
  const columnGap = 40;
  const totalWidth = Math.max(1200, sortedNamespaces.length * (columnWidth + columnGap) + 120);

  const clusterRootNode: TopologyNode = {
    id: `cluster-${clusterId}`,
    type: 'cluster',
    kind: 'Cluster',
    name: clusterName,
    clusterId: cluster?.id,
    cluster: cluster || undefined,
    health: clusterHealth,
    statusText: clusterHealth === 'HEALTHY' ? 'Healthy' : 'Issues Detected',
    badgeText: `${filteredResources.length} Total Resources  ${sortedNamespaces.length} Namespaces`,
    incidents: safeIncidents.filter((i) => !cluster?.id || i.clusterId === cluster.id),
    domainId: 'cluster',
    x: Math.max(200, totalWidth / 2 - 140),
    y: 40,
    width: 280,
    height: 90
  };
  nodes.push(clusterRootNode);

  const renderedWorkloads = new Map<string, TopologyNode>();
  const renderedServices = new Map<string, TopologyNode>();
  const renderedPods = new Map<string, TopologyNode>();

  sortedNamespaces.forEach((ns, colIdx) => {
    const colX = 60 + colIdx * (columnWidth + columnGap);
    const nsResources = namespaceMap.get(ns) || [];
    const nsHealth = nsResources.some((r) => r.health === 'CRITICAL')
      ? 'CRITICAL'
      : nsResources.some((r) => r.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

    const nsGroupNode: TopologyNode = {
      id: `ns-group-${ns}`,
      type: 'domain_group',
      kind: 'Namespace',
      name: ns === 'cluster-scoped' ? 'Cluster Scoped' : `Namespace: ${ns}`,
      namespace: ns === 'cluster-scoped' ? undefined : ns,
      health: nsHealth,
      statusText: `${nsResources.length} Resources`,
      badgeText: nsHealth === 'HEALTHY' ? 'Healthy' : 'Attention',
      incidents: [],
      domainId: 'workloads',
      x: colX,
      y: 190,
      width: columnWidth,
      height: 75
    };
    nodes.push(nsGroupNode);

    edges.push({
      id: `edge-cluster-ns-${ns}`,
      source: clusterRootNode.id,
      target: nsGroupNode.id,
      type: 'ownership'
    });

    let currentY = 285;
    // Sort resources: Workloads -> Pods -> Services -> Storage -> Config
    const priorityKinds: Record<string, number> = {
      Deployment: 1,
      StatefulSet: 2,
      DaemonSet: 3,
      Job: 4,
      Pod: 5,
      Service: 6,
      Ingress: 7,
      PersistentVolumeClaim: 8,
      ConfigMap: 9,
      Secret: 10
    };

    const sortedRes = [...nsResources].sort((a, b) => {
      const pa = priorityKinds[a.kind] || 20;
      const pb = priorityKinds[b.kind] || 20;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });

    sortedRes.slice(0, 14).forEach((r) => {
      const rIncidents = getResourceIncidents(r);
      const rNode: TopologyNode = {
        id: `res-${r.id}`,
        type: 'resource',
        kind: r.kind,
        name: r.name,
        namespace: r.namespace,
        clusterId: r.clusterId,
        resource: r,
        health: r.health || 'HEALTHY',
        statusText: r.kind,
        badgeText: rIncidents.length > 0 ? `${rIncidents.length} alert` : undefined,
        incidents: rIncidents,
        domainId: 'workloads',
        x: colX,
        y: currentY,
        width: columnWidth,
        height: 68
      };
      nodes.push(rNode);

      edges.push({
        id: `edge-ns-${ns}-res-${r.id}`,
        source: nsGroupNode.id,
        target: rNode.id,
        type: 'ownership'
      });

      if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(r.kind)) {
        renderedWorkloads.set(`${r.namespace}/${r.name}`, rNode);
      } else if (r.kind === 'Service') {
        renderedServices.set(`${r.namespace}/${r.name}`, rNode);
      } else if (r.kind === 'Pod') {
        renderedPods.set(`${r.namespace}/${r.name}`, rNode);
      }

      currentY += 80;
    });
  });

  // Inter-resource edges (traffic and workload ownership)
  for (const [, podNode] of renderedPods.entries()) {
    for (const [, wNode] of renderedWorkloads.entries()) {
      if (podNode.namespace === wNode.namespace && podNode.name.startsWith(`${wNode.name}-`)) {
        edges.push({
          id: `edge-workload-pod-${wNode.id}-${podNode.id}`,
          source: wNode.id,
          target: podNode.id,
          type: 'ownership'
        });
      }
    }
  }

  return finalizeGraphData(nodes, edges);
}

function buildDomainGroupedGraph({
  resources,
  cluster,
  incidents,
  filters
}: BuilderOptions): TopologyGraphData {
  const safeResources = Array.isArray(resources)
    ? resources.filter((r): r is KubernetesResource => !!r && typeof r === 'object')
    : [];
  const safeIncidents = Array.isArray(incidents) ? incidents.filter(Boolean) : [];

  const incidentsByResource = new Map<string, Incident[]>();
  for (const inc of safeIncidents) {
    const key = `${inc.clusterId}/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const list = incidentsByResource.get(key) || [];
    list.push(inc);
    incidentsByResource.set(key, list);

    const wildcard = `*/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const wlist = incidentsByResource.get(wildcard) || [];
    wlist.push(inc);
    incidentsByResource.set(wildcard, wlist);
  }

  const getResourceIncidents = (r: KubernetesResource): Incident[] => {
    const specific = incidentsByResource.get(`${r.clusterId}/${r.kind}/${r.namespace || ''}/${r.name}`);
    if (specific && specific.length > 0) return specific;
    const wildcard = incidentsByResource.get(`*/${r.kind}/${r.namespace || ''}/${r.name}`);
    return wildcard || [];
  };

  const matchesFilter = (r: KubernetesResource): boolean => {
    if (filters.namespace !== 'all' && r.namespace && r.namespace !== filters.namespace) {
      return false;
    }
    if (filters.health !== 'all' && r.health !== filters.health) {
      return false;
    }
    if (filters.incidentsOnly) {
      const incs = getResourceIncidents(r);
      if (incs.length === 0) return false;
    }
    if (filters.search.trim()) {
      const query = filters.search.toLowerCase().trim();
      const matchName = r.name.toLowerCase().includes(query);
      const matchKind = r.kind.toLowerCase().includes(query);
      const matchNs = r.namespace ? r.namespace.toLowerCase().includes(query) : false;
      if (!matchName && !matchKind && !matchNs) return false;
    }
    return true;
  };

  const filteredResources = safeResources.filter(matchesFilter);
  const clusterId = cluster?.id || 'cluster-root';
  const clusterName = cluster?.name || 'Kubernetes Cluster';
  const nodes: TopologyNode[] = [];
  const edges: TopologyEdge[] = [];

  const clusterHealth = filteredResources.some((r) => r.health === 'CRITICAL')
    ? 'CRITICAL'
    : filteredResources.some((r) => r.health === 'WARNING')
    ? 'WARNING'
    : 'HEALTHY';

  const clusterRootNode: TopologyNode = {
    id: `cluster-${clusterId}`,
    type: 'cluster',
    kind: 'Cluster',
    name: clusterName,
    clusterId: cluster?.id,
    cluster: cluster || undefined,
    health: clusterHealth,
    statusText: clusterHealth === 'HEALTHY' ? 'Healthy' : 'Issues Detected',
    badgeText: `${filteredResources.length} Resources in 8 Domains`,
    incidents: safeIncidents.filter((i) => !cluster?.id || i.clusterId === cluster.id),
    domainId: 'cluster',
    x: 520,
    y: 40,
    width: 280,
    height: 90
  };
  nodes.push(clusterRootNode);

  const domains: Array<{ id: ArchitectureDomainId; name: string; kinds: string[]; col: number; row: number }> = [
    { id: 'compute', name: 'Compute', kinds: ['Node', 'Pod'], col: 0, row: 0 },
    { id: 'workloads', name: 'Workloads', kinds: ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Rollout'], col: 1, row: 0 },
    { id: 'networking', name: 'Networking', kinds: ['Service', 'Ingress', 'Gateway', 'EndpointSlice'], col: 2, row: 0 },
    { id: 'storage', name: 'Storage', kinds: ['PersistentVolumeClaim', 'PersistentVolume', 'StorageClass'], col: 3, row: 0 },
    { id: 'configuration', name: 'Configuration', kinds: ['ConfigMap', 'Secret', 'ServiceAccount'], col: 0, row: 1 },
    { id: 'security', name: 'Security', kinds: ['Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding'], col: 1, row: 1 },
    { id: 'scheduling', name: 'Scheduling', kinds: [], col: 2, row: 1 },
    { id: 'scaling', name: 'Scaling', kinds: ['HorizontalPodAutoscaler', 'VerticalPodAutoscaler'], col: 3, row: 1 }
  ];

  const colWidth = 280;
  const colGap = 40;
  const startX = 60;

  domains.forEach((dom) => {
    if (filters.domain !== 'all' && filters.domain !== dom.id) return;

    const domX = startX + dom.col * (colWidth + colGap);
    const domBaseY = dom.row === 0 ? 190 : 620;
    const domResources = filteredResources.filter((r) => dom.kinds.includes(r.kind));

    const domHealth = domResources.some((r) => r.health === 'CRITICAL')
      ? 'CRITICAL'
      : domResources.some((r) => r.health === 'WARNING')
      ? 'WARNING'
      : 'HEALTHY';

    const domGroupNode: TopologyNode = {
      id: `domain-${dom.id}`,
      type: 'domain_group',
      kind: dom.name,
      name: dom.name,
      health: domResources.length > 0 ? domHealth : 'HEALTHY',
      statusText: dom.id === 'scheduling' ? 'Kube-Scheduler' : `${domResources.length} Resources`,
      badgeText: domResources.length > 0 ? `${domResources.length} Active` : 'None',
      incidents: [],
      domainId: dom.id,
      x: domX,
      y: domBaseY,
      width: colWidth,
      height: 75
    };
    nodes.push(domGroupNode);

    edges.push({
      id: `edge-cluster-dom-${dom.id}`,
      source: clusterRootNode.id,
      target: domGroupNode.id,
      type: 'ownership'
    });

    let currentY = domBaseY + 95;
    domResources.slice(0, 5).forEach((r) => {
      const rIncidents = getResourceIncidents(r);
      const rNode: TopologyNode = {
        id: `res-${r.id}`,
        type: 'resource',
        kind: r.kind,
        name: r.name,
        namespace: r.namespace,
        clusterId: r.clusterId,
        resource: r,
        health: r.health || 'HEALTHY',
        statusText: r.kind,
        incidents: rIncidents,
        domainId: dom.id,
        x: domX,
        y: currentY,
        width: colWidth,
        height: 66
      };
      nodes.push(rNode);

      edges.push({
        id: `edge-dom-${dom.id}-res-${r.id}`,
        source: domGroupNode.id,
        target: rNode.id,
        type: 'ownership'
      });

      currentY += 76;
    });
  });

  return finalizeGraphData(nodes, edges);
}
