import { KubernetesResource, Incident, Cluster } from '../../types/index';
import {
  ArchitectureDomainId,
  ArchitectureDomainSummary,
  ArchitectureTelemetryState,
  SchedulingTelemetrySummary,
  ScalingTelemetrySummary,
  SecurityTelemetrySummary
} from './types';

// Helper to create resource key for indexing
export function getResourceKey(r: { clusterId?: string; kind?: string; namespace?: string; name?: string }): string {
  return `${r.clusterId || '*'}/${r.kind || '*'}/${r.namespace || '*'}/${r.name || '*'}`;
}

export function buildArchitectureTelemetry(
  resources: KubernetesResource[],
  clusters: Cluster[] = [],
  incidents: Incident[] = [],
  lastPolledAt?: number
): ArchitectureTelemetryState {
  const safeResources = Array.isArray(resources) ? resources.filter((r): r is KubernetesResource => !!r && typeof r === 'object') : [];
  const safeClusters = Array.isArray(clusters) ? clusters.filter(Boolean) : [];
  const safeIncidents = Array.isArray(incidents) ? incidents.filter(Boolean) : [];

  // Map incidents by resource for quick lookup
  const incidentsByResourceKey = new Map<string, Incident[]>();
  for (const inc of safeIncidents) {
    const key = `${inc.clusterId}/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const list = incidentsByResourceKey.get(key) || [];
    list.push(inc);
    incidentsByResourceKey.set(key, list);

    // Also match cluster-agnostic or namespace-agnostic if needed
    const wildcardKey = `*/${inc.resourceKind}/${inc.namespace || ''}/${inc.resourceName}`;
    const wlist = incidentsByResourceKey.get(wildcardKey) || [];
    wlist.push(inc);
    incidentsByResourceKey.set(wildcardKey, wlist);
  }

  // Calculate telemetry freshness
  let latestTs = 0;
  for (const r of safeResources) {
    const ts = r.observedAt || r.updatedAt || r.createdAt || 0;
    if (ts > latestTs) latestTs = ts;
  }
  for (const c of safeClusters) {
    if (c.lastHeartbeatAt && c.lastHeartbeatAt > latestTs) latestTs = c.lastHeartbeatAt;
    if (c.updatedAt && c.updatedAt > latestTs) latestTs = c.updatedAt;
  }
  if (lastPolledAt && lastPolledAt > latestTs) {
    latestTs = lastPolledAt;
  }

  const now = Date.now();
  let freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE' = 'UNAVAILABLE';
  let ageSeconds: number | null = null;

  if (safeResources.length === 0 && safeClusters.length === 0) {
    freshness = 'UNAVAILABLE';
  } else if (latestTs > 0) {
    ageSeconds = Math.max(0, Math.floor((now - latestTs) / 1000));
    if (ageSeconds <= 90) {
      freshness = 'LIVE';
    } else {
      freshness = 'STALE';
    }
  } else {
    freshness = 'UNAVAILABLE';
  }

  // Group resources by kind
  const resourcesByKind = new Map<string, KubernetesResource[]>();
  for (const r of safeResources) {
    const list = resourcesByKind.get(r.kind) || [];
    list.push(r);
    resourcesByKind.set(r.kind, list);
  }

  const getResources = (kinds: string[]): KubernetesResource[] => {
    const results: KubernetesResource[] = [];
    for (const k of kinds) {
      const match = resourcesByKind.get(k);
      if (match) results.push(...match);
    }
    return results;
  };

  const getHealthBreakdown = (items: KubernetesResource[]) => {
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    let unknown = 0;
    for (const item of items) {
      if (item.health === 'HEALTHY') healthy++;
      else if (item.health === 'WARNING') warning++;
      else if (item.health === 'CRITICAL') critical++;
      else unknown++;
    }
    return { healthy, warning, critical, unknown };
  };

  // 1. COMPUTE DOMAIN (Nodes, Pods, Containers)
  const nodes = getResources(['Node']);
  const pods = getResources(['Pod']);
  const computeResources = [...nodes, ...pods];
  let totalContainers = 0;
  for (const p of pods) {
    if (Array.isArray(p.containers) && p.containers.length > 0) {
      totalContainers += p.containers.length;
    } else {
      const statusSummary = (p.statusSummary || {}) as any;
      const specSummary = (p.specSummary || {}) as any;
      const count =
        (Array.isArray(statusSummary.containerStatuses) ? statusSummary.containerStatuses.length : 0) ||
        (Array.isArray(specSummary.containers) ? specSummary.containers.length : 1);
      totalContainers += count;
    }
  }
  const readyNodesCount = nodes.filter((n) => n.status === 'Ready').length;
  const computeHighlights = [
    `${nodes.length} Node${nodes.length === 1 ? '' : 's'} (${readyNodesCount} Ready)`,
    `${pods.length} Pod${pods.length === 1 ? '' : 's'} running across fleet`,
    `${totalContainers} Container${totalContainers === 1 ? '' : 's'} active`
  ];
  const computeCategories = [
    { kind: 'Node', count: nodes.length, resources: nodes },
    { kind: 'Pod', count: pods.length, resources: pods }
  ];

  // 2. APPLICATION MANAGEMENT DOMAIN (Workloads)
  const workloadKinds = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Rollout'];
  const workloads = getResources(workloadKinds);
  const deployments = getResources(['Deployment']);
  const statefulSets = getResources(['StatefulSet']);
  const daemonSets = getResources(['DaemonSet']);
  const replicaSets = getResources(['ReplicaSet']);
  const jobs = getResources(['Job']);
  const cronJobs = getResources(['CronJob']);

  const appHighlights = [
    `${deployments.length} Deployment${deployments.length === 1 ? '' : 's'}`,
    `${statefulSets.length} StatefulSet${statefulSets.length === 1 ? '' : 's'}`,
    `${daemonSets.length} DaemonSet${daemonSets.length === 1 ? '' : 's'}`,
    `${jobs.length + cronJobs.length} Batch Job${jobs.length + cronJobs.length === 1 ? '' : 's'}`
  ];

  const appCategories = [
    { kind: 'Deployment', count: deployments.length, resources: deployments },
    { kind: 'StatefulSet', count: statefulSets.length, resources: statefulSets },
    { kind: 'DaemonSet', count: daemonSets.length, resources: daemonSets },
    { kind: 'ReplicaSet', count: replicaSets.length, resources: replicaSets },
    { kind: 'Job', count: jobs.length, resources: jobs },
    { kind: 'CronJob', count: cronJobs.length, resources: cronJobs }
  ].filter((c) => c.count > 0 || ['Deployment', 'StatefulSet', 'DaemonSet'].includes(c.kind));

  // 3. NETWORKING DOMAIN (Services, EndpointSlices, Ingress, NetworkPolicies, Gateways)
  const networkKinds = ['Service', 'EndpointSlice', 'Ingress', 'NetworkPolicy', 'Gateway', 'HTTPRoute', 'Endpoints'];
  const networkResources = getResources(networkKinds);
  const services = getResources(['Service']);
  const endpointSlices = getResources(['EndpointSlice']);
  const ingresses = getResources(['Ingress']);
  const networkPolicies = getResources(['NetworkPolicy']);

  const netHighlights = [
    `${services.length} Service${services.length === 1 ? '' : 's'} routed`,
    `${endpointSlices.length} EndpointSlice${endpointSlices.length === 1 ? '' : 's'} synced`,
    `${ingresses.length} Ingress Controller${ingresses.length === 1 ? '' : 's'}`,
    networkPolicies.length > 0 ? `${networkPolicies.length} NetworkPolic${networkPolicies.length === 1 ? 'y' : 'ies'} active` : 'No NetworkPolicies detected'
  ];

  const netCategories = [
    { kind: 'Service', count: services.length, resources: services },
    { kind: 'EndpointSlice', count: endpointSlices.length, resources: endpointSlices },
    { kind: 'Ingress', count: ingresses.length, resources: ingresses },
    { kind: 'NetworkPolicy', count: networkPolicies.length, resources: networkPolicies }
  ];

  // 4. STORAGE DOMAIN (PV, PVC, StorageClass)
  const storageKinds = ['PersistentVolumeClaim', 'PersistentVolume', 'StorageClass'];
  const storageResources = getResources(storageKinds);
  const pvcs = getResources(['PersistentVolumeClaim']);
  const pvs = getResources(['PersistentVolume']);
  const storageClasses = getResources(['StorageClass']);
  const boundPvcs = pvcs.filter((p) => p.status === 'Bound').length;

  const storageHighlights = [
    `${pvcs.length} PVC${pvcs.length === 1 ? '' : 's'} (${boundPvcs} Bound)`,
    `${pvs.length} PersistentVolume${pvs.length === 1 ? '' : 's'}`,
    storageClasses.length > 0 ? `${storageClasses.length} StorageClass${storageClasses.length === 1 ? '' : 'es'} provisioned` : 'Default StorageClass'
  ];

  const storageCategories = [
    { kind: 'PersistentVolumeClaim', count: pvcs.length, resources: pvcs },
    { kind: 'PersistentVolume', count: pvs.length, resources: pvs },
    { kind: 'StorageClass', count: storageClasses.length, resources: storageClasses }
  ];

  // 5. CONFIGURATION DOMAIN (ConfigMaps, Secrets - metadata only!, ServiceAccounts)
  const configKinds = ['ConfigMap', 'Secret', 'ServiceAccount'];
  const configResources = getResources(configKinds);
  const configMaps = getResources(['ConfigMap']);
  const secrets = getResources(['Secret']);
  const serviceAccounts = getResources(['ServiceAccount']);

  const configHighlights = [
    `${configMaps.length} ConfigMap${configMaps.length === 1 ? '' : 's'}`,
    `${secrets.length} Secret${secrets.length === 1 ? '' : 's'} (metadata only)`,
    `${serviceAccounts.length} ServiceAccount${serviceAccounts.length === 1 ? '' : 's'}`
  ];

  const configCategories = [
    { kind: 'ConfigMap', count: configMaps.length, resources: configMaps },
    { kind: 'Secret', count: secrets.length, resources: secrets },
    { kind: 'ServiceAccount', count: serviceAccounts.length, resources: serviceAccounts }
  ];

  // 6. SCHEDULING DOMAIN (Taints, Tolerations, NodeSelectors, Affinities, TopologySpread)
  const schedulingSummary: SchedulingTelemetrySummary = {
    nodesWithTaints: 0,
    podsWithNodeSelector: 0,
    podsWithAffinity: 0,
    podsWithTolerations: 0,
    podsWithTopologySpread: 0,
    taints: [],
    nodeSelectors: [],
    affinities: [],
    tolerations: [],
    topologySpreadConstraints: []
  };

  for (const n of nodes) {
    const spec = (n.specSummary || {}) as any;
    const taintsList = Array.isArray(spec.taints) ? spec.taints : Array.isArray((n as any).taints) ? (n as any).taints : [];
    if (taintsList.length > 0) {
      schedulingSummary.nodesWithTaints++;
      for (const t of taintsList) {
        schedulingSummary.taints.push({
          nodeName: n.name,
          key: String(t.key || ''),
          value: t.value ? String(t.value) : undefined,
          effect: String(t.effect || 'NoSchedule')
        });
      }
    }
  }

  for (const p of pods) {
    const spec = (p.specSummary || {}) as any;
    if (spec.nodeSelector && Object.keys(spec.nodeSelector).length > 0) {
      schedulingSummary.podsWithNodeSelector++;
      schedulingSummary.nodeSelectors.push({
        podName: p.name,
        namespace: p.namespace,
        selectors: spec.nodeSelector as Record<string, string>
      });
    }
    if (spec.affinity) {
      let hasAff = false;
      if (spec.affinity.nodeAffinity) {
        schedulingSummary.affinities.push({ podName: p.name, namespace: p.namespace, kind: 'nodeAffinity' });
        hasAff = true;
      }
      if (spec.affinity.podAffinity) {
        schedulingSummary.affinities.push({ podName: p.name, namespace: p.namespace, kind: 'podAffinity' });
        hasAff = true;
      }
      if (spec.affinity.podAntiAffinity) {
        schedulingSummary.affinities.push({ podName: p.name, namespace: p.namespace, kind: 'podAntiAffinity' });
        hasAff = true;
      }
      if (hasAff) schedulingSummary.podsWithAffinity++;
    }
    if (Array.isArray(spec.tolerations) && spec.tolerations.length > 0) {
      schedulingSummary.podsWithTolerations++;
      for (const tol of spec.tolerations.slice(0, 3)) {
        schedulingSummary.tolerations.push({
          podName: p.name,
          namespace: p.namespace,
          key: tol.key,
          effect: tol.effect
        });
      }
    }
    if (Array.isArray(spec.topologySpreadConstraints) && spec.topologySpreadConstraints.length > 0) {
      schedulingSummary.podsWithTopologySpread++;
      for (const tsc of spec.topologySpreadConstraints) {
        schedulingSummary.topologySpreadConstraints.push({
          podName: p.name,
          namespace: p.namespace,
          topologyKey: String(tsc.topologyKey || 'kubernetes.io/hostname'),
          maxSkew: tsc.maxSkew
        });
      }
    }
  }

  const activeSchedulingFeatures: string[] = [];
  const undetectedSchedulingFeatures: string[] = [];

  if (schedulingSummary.nodesWithTaints > 0) activeSchedulingFeatures.push(`Node Taints (${schedulingSummary.taints.length} active)`);
  else undetectedSchedulingFeatures.push('Node Taints');

  if (schedulingSummary.podsWithNodeSelector > 0) activeSchedulingFeatures.push(`nodeSelector (${schedulingSummary.podsWithNodeSelector} pods)`);
  else undetectedSchedulingFeatures.push('nodeSelector');

  if (schedulingSummary.podsWithAffinity > 0) activeSchedulingFeatures.push(`Affinity / Anti-Affinity (${schedulingSummary.podsWithAffinity} pods)`);
  else undetectedSchedulingFeatures.push('Affinity / Anti-Affinity');

  if (schedulingSummary.podsWithTolerations > 0) activeSchedulingFeatures.push(`Tolerations (${schedulingSummary.podsWithTolerations} pods)`);
  else undetectedSchedulingFeatures.push('Tolerations');

  if (schedulingSummary.podsWithTopologySpread > 0) activeSchedulingFeatures.push(`Topology Spread Constraints (${schedulingSummary.podsWithTopologySpread} pods)`);
  else undetectedSchedulingFeatures.push('Topology Spread Constraints');

  const schedulingHighlights = activeSchedulingFeatures.length > 0
    ? activeSchedulingFeatures.slice(0, 3)
    : ['Default kube-scheduler placement', 'No taints or topology constraints detected'];

  // 7. SCALING DOMAIN (HPA, VPA, Replicas, Cluster Autoscaler)
  const hpas = getResources(['HorizontalPodAutoscaler']);
  const vpas = getResources(['VerticalPodAutoscaler']);

  // Detect cluster autoscaler with evidence
  let clusterAutoscalerDetected = false;
  let clusterAutoscalerEvidence: string | undefined = undefined;

  // Check pods or deployments for cluster-autoscaler
  const autoscalerPod = pods.find((p) => p.name.includes('cluster-autoscaler') || (p.namespace === 'kube-system' && p.name.includes('autoscaler')));
  const autoscalerWorkload = workloads.find((w) => w.name.includes('cluster-autoscaler'));
  if (autoscalerPod) {
    clusterAutoscalerDetected = true;
    clusterAutoscalerEvidence = `Observed active controller pod: ${autoscalerPod.namespace}/${autoscalerPod.name}`;
  } else if (autoscalerWorkload) {
    clusterAutoscalerDetected = true;
    clusterAutoscalerEvidence = `Observed workload: ${autoscalerWorkload.namespace}/${autoscalerWorkload.name}`;
  } else {
    // Check node annotations
    for (const n of nodes) {
      if (n.annotations && Object.keys(n.annotations).some((k) => k.includes('cluster-autoscaler.kubernetes.io'))) {
        clusterAutoscalerDetected = true;
        clusterAutoscalerEvidence = `Observed node annotation on ${n.name}`;
        break;
      }
    }
  }

  let totalDesiredReplicas = 0;
  let totalReadyReplicas = 0;
  let totalAvailableReplicas = 0;
  const workloadReplicas: ScalingTelemetrySummary['workloadReplicas'] = [];

  for (const w of workloads) {
    const spec = (w.specSummary || {}) as any;
    const status = (w.statusSummary || {}) as any;
    const desired = typeof spec.replicas === 'number' ? spec.replicas : 1;
    const ready = typeof status.readyReplicas === 'number' ? status.readyReplicas : typeof status.numberReady === 'number' ? status.numberReady : desired;
    const available = typeof status.availableReplicas === 'number' ? status.availableReplicas : ready;

    totalDesiredReplicas += desired;
    totalReadyReplicas += ready;
    totalAvailableReplicas += available;

    workloadReplicas.push({
      name: w.name,
      kind: w.kind,
      namespace: w.namespace,
      desired,
      ready,
      available,
      status: w.status
    });
  }

  const scalingSummary: ScalingTelemetrySummary = {
    hpas,
    vpas,
    clusterAutoscalerDetected,
    clusterAutoscalerEvidence,
    totalDesiredReplicas,
    totalReadyReplicas,
    totalAvailableReplicas,
    workloadReplicas
  };

  const activeScalingFeatures: string[] = [];
  const undetectedScalingFeatures: string[] = [];

  if (hpas.length > 0) activeScalingFeatures.push(`${hpas.length} HorizontalPodAutoscaler${hpas.length === 1 ? '' : 's'}`);
  else undetectedScalingFeatures.push('HorizontalPodAutoscaler (HPA)');

  if (vpas.length > 0) activeScalingFeatures.push(`${vpas.length} VerticalPodAutoscaler${vpas.length === 1 ? '' : 's'}`);
  else undetectedScalingFeatures.push('VerticalPodAutoscaler (VPA)');

  if (clusterAutoscalerDetected) activeScalingFeatures.push('Cluster Autoscaler (Detected)');
  else undetectedScalingFeatures.push('Cluster Autoscaler (Not observed)');

  activeScalingFeatures.push(`${totalReadyReplicas}/${totalDesiredReplicas} Replicas Ready`);

  const scalingHighlights = [
    hpas.length > 0 ? `${hpas.length} HPA${hpas.length === 1 ? '' : 's'} active` : 'No HPAs configured',
    clusterAutoscalerDetected ? 'Cluster Autoscaler detected' : 'Fixed cluster capacity (No Autoscaler observed)',
    `${totalReadyReplicas}/${totalDesiredReplicas} Workload replicas running`
  ];

  // 8. SECURITY DOMAIN (Roles, RoleBindings, ClusterRoles, ServiceAccounts, NetworkPolicies, SecurityContext)
  const roles = getResources(['Role']);
  const roleBindings = getResources(['RoleBinding']);
  const clusterRoles = getResources(['ClusterRole']);
  const clusterRoleBindings = getResources(['ClusterRoleBinding']);

  let runAsNonRootCount = 0;
  let privilegedCount = 0;
  let readOnlyRootFilesystemCount = 0;
  let allowPrivilegeEscalationFalseCount = 0;

  for (const p of pods) {
    const spec = (p.specSummary || {}) as any;
    const podSec = spec.securityContext || {};
    let isNonRoot = podSec.runAsNonRoot === true;

    const containersList = Array.isArray(spec.containers) ? spec.containers : [];
    for (const c of containersList) {
      const cSec = c.securityContext || {};
      if (cSec.runAsNonRoot === true) isNonRoot = true;
      if (cSec.privileged === true) privilegedCount++;
      if (cSec.readOnlyRootFilesystem === true) readOnlyRootFilesystemCount++;
      if (cSec.allowPrivilegeEscalation === false) allowPrivilegeEscalationFalseCount++;
    }
    if (isNonRoot) runAsNonRootCount++;
  }

  const securitySummary: SecurityTelemetrySummary = {
    roles,
    roleBindings,
    clusterRoles,
    clusterRoleBindings,
    serviceAccounts,
    networkPolicies,
    podSecurityHighlights: {
      runAsNonRootCount,
      privilegedCount,
      readOnlyRootFilesystemCount,
      allowPrivilegeEscalationFalseCount,
      totalInspected: pods.length
    }
  };

  const activeSecFeatures: string[] = [];
  const undetectedSecFeatures: string[] = [];

  if (networkPolicies.length > 0) activeSecFeatures.push(`${networkPolicies.length} NetworkPolicies`);
  else undetectedSecFeatures.push('NetworkPolicies');

  if (serviceAccounts.length > 0) activeSecFeatures.push(`${serviceAccounts.length} ServiceAccounts`);
  if (roles.length + clusterRoles.length > 0) activeSecFeatures.push(`${roles.length + clusterRoles.length} RBAC Roles`);
  else undetectedSecFeatures.push('Custom RBAC Roles');

  if (runAsNonRootCount > 0) activeSecFeatures.push(`${runAsNonRootCount} non-root pods`);
  if (privilegedCount > 0) activeSecFeatures.push(`${privilegedCount} privileged container(s)`);

  const securityHighlights = [
    `${serviceAccounts.length} ServiceAccounts detected`,
    networkPolicies.length > 0 ? `${networkPolicies.length} NetworkPolic${networkPolicies.length === 1 ? 'y' : 'ies'} enforcing traffic` : 'Open network perimeter (0 NetworkPolicies)',
    runAsNonRootCount > 0 ? `${runAsNonRootCount}/${pods.length} Pods enforce non-root execution` : 'Pod security contexts unconstrained'
  ];

  const securityCategories = [
    { kind: 'ServiceAccount', count: serviceAccounts.length, resources: serviceAccounts },
    { kind: 'NetworkPolicy', count: networkPolicies.length, resources: networkPolicies },
    { kind: 'Role', count: roles.length, resources: roles },
    { kind: 'RoleBinding', count: roleBindings.length, resources: roleBindings },
    { kind: 'ClusterRole', count: clusterRoles.length, resources: clusterRoles },
    { kind: 'ClusterRoleBinding', count: clusterRoleBindings.length, resources: clusterRoleBindings }
  ].filter((c) => c.count > 0 || ['ServiceAccount', 'NetworkPolicy', 'Role'].includes(c.kind));

  // Assemble the 8 Architecture Domains
  const domains: Record<ArchitectureDomainId, ArchitectureDomainSummary> = {
    compute: {
      id: 'compute',
      title: 'Compute Infrastructure',
      shortTitle: 'Compute',
      description: 'Physical/virtual Nodes, scheduled Pod instances, and container execution engines.',
      resourceCount: computeResources.length,
      healthCounts: getHealthBreakdown(computeResources),
      detectedHighlights: computeHighlights,
      categories: computeCategories,
      activeFeatures: [`${nodes.length} Nodes`, `${pods.length} Pods`, `${totalContainers} Containers`],
      undetectedFeatures: nodes.length === 0 ? ['Nodes telemetry unavailable'] : [],
      allResources: computeResources
    },
    workloads: {
      id: 'workloads',
      title: 'Application Management',
      shortTitle: 'Workloads',
      description: 'Declarative controller abstractions including Deployments, StatefulSets, DaemonSets, and Jobs.',
      resourceCount: workloads.length,
      healthCounts: getHealthBreakdown(workloads),
      detectedHighlights: appHighlights,
      categories: appCategories,
      activeFeatures: appCategories.filter((c) => c.count > 0).map((c) => `${c.count} ${c.kind}${c.count === 1 ? '' : 's'}`),
      undetectedFeatures: workloads.length === 0 ? ['No workloads observed in current filter'] : [],
      allResources: workloads
    },
    networking: {
      id: 'networking',
      title: 'Cluster Networking',
      shortTitle: 'Networking',
      description: 'Ingress entry points, Service virtual IPs, EndpointSlice target addresses, and packet filtering.',
      resourceCount: networkResources.length,
      healthCounts: getHealthBreakdown(networkResources),
      detectedHighlights: netHighlights,
      categories: netCategories,
      activeFeatures: netCategories.filter((c) => c.count > 0).map((c) => `${c.count} ${c.kind}${c.count === 1 ? '' : 's'}`),
      undetectedFeatures: networkPolicies.length === 0 ? ['NetworkPolicies'] : [],
      allResources: networkResources
    },
    storage: {
      id: 'storage',
      title: 'Persistent Storage',
      shortTitle: 'Storage',
      description: 'StorageClasses, dynamically or statically allocated PersistentVolumes, and workload claims (PVC).',
      resourceCount: storageResources.length,
      healthCounts: getHealthBreakdown(storageResources),
      detectedHighlights: storageHighlights,
      categories: storageCategories,
      activeFeatures: storageCategories.filter((c) => c.count > 0).map((c) => `${c.count} ${c.kind}${c.count === 1 ? '' : 's'}`),
      undetectedFeatures: storageResources.length === 0 ? ['No persistent volumes or claims detected'] : [],
      allResources: storageResources
    },
    configuration: {
      id: 'configuration',
      title: 'Configuration & Secrets',
      shortTitle: 'Configuration',
      description: 'Externalized ConfigMaps, cryptographic Secret metadata, and execution ServiceAccounts.',
      resourceCount: configResources.length,
      healthCounts: getHealthBreakdown(configResources),
      detectedHighlights: configHighlights,
      categories: configCategories,
      activeFeatures: configCategories.filter((c) => c.count > 0).map((c) => `${c.count} ${c.kind}${c.count === 1 ? '' : 's'}`),
      undetectedFeatures: configResources.length === 0 ? ['No configuration items detected'] : [],
      allResources: configResources
    },
    scheduling: {
      id: 'scheduling',
      title: 'Pod Placement & Scheduling',
      shortTitle: 'Scheduling',
      description: 'Kube-scheduler constraints including nodeSelector, affinity/anti-affinity, taints, and tolerations.',
      resourceCount: schedulingSummary.taints.length + schedulingSummary.podsWithNodeSelector + schedulingSummary.podsWithAffinity,
      healthCounts: { healthy: nodes.length, warning: schedulingSummary.taints.length > 0 ? 1 : 0, critical: 0, unknown: 0 },
      detectedHighlights: schedulingHighlights,
      categories: [
        { kind: 'Node Taints', count: schedulingSummary.taints.length, resources: [] },
        { kind: 'nodeSelector', count: schedulingSummary.podsWithNodeSelector, resources: [] },
        { kind: 'Affinity Rules', count: schedulingSummary.podsWithAffinity, resources: [] },
        { kind: 'Tolerations', count: schedulingSummary.podsWithTolerations, resources: [] }
      ],
      activeFeatures: activeSchedulingFeatures,
      undetectedFeatures: undetectedSchedulingFeatures,
      allResources: nodes
    },
    scaling: {
      id: 'scaling',
      title: 'Autoscaling & Capacity',
      shortTitle: 'Scaling',
      description: 'Horizontal and Vertical Pod Autoscalers, cluster node pool elasticity, and workload replica state.',
      resourceCount: hpas.length + vpas.length + (clusterAutoscalerDetected ? 1 : 0),
      healthCounts: getHealthBreakdown([...hpas, ...vpas]),
      detectedHighlights: scalingHighlights,
      categories: [
        { kind: 'HorizontalPodAutoscaler', count: hpas.length, resources: hpas },
        { kind: 'VerticalPodAutoscaler', count: vpas.length, resources: vpas },
        { kind: 'Workload Replicas', count: workloadReplicas.length, resources: [] }
      ],
      activeFeatures: activeScalingFeatures,
      undetectedFeatures: undetectedScalingFeatures,
      allResources: [...hpas, ...vpas]
    },
    security: {
      id: 'security',
      title: 'Security & Access Control',
      shortTitle: 'Security',
      description: 'Role-Based Access Control (RBAC), ServiceAccounts, NetworkPolicies, and Pod securityContexts.',
      resourceCount: roles.length + roleBindings.length + clusterRoles.length + serviceAccounts.length + networkPolicies.length,
      healthCounts: getHealthBreakdown([...networkPolicies, ...roles, ...serviceAccounts]),
      detectedHighlights: securityHighlights,
      categories: securityCategories,
      activeFeatures: activeSecFeatures,
      undetectedFeatures: undetectedSecFeatures,
      allResources: [...networkPolicies, ...roles, ...roleBindings, ...serviceAccounts]
    }
  };

  return {
    domains,
    totalResourceCount: safeResources.length,
    freshness,
    lastTelemetryTimestamp: latestTs > 0 ? latestTs : null,
    ageSeconds,
    schedulingSummary,
    scalingSummary,
    securitySummary,
    activeIncidents: safeIncidents,
    incidentsByResourceKey
  };
}
