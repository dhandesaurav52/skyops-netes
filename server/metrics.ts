import {
  Cluster,
  ClusterObservabilityMetrics,
  ContainerDiagnostic,
  ContainerResourceMetrics,
  KubernetesResource,
  MetricsFreshnessStatus,
  NodeMetricsSummary,
  ResourceMetrics,
  ResourceMetricValue,
  WorkloadMetricsSummary
} from '../src/types/index';

/**
 * Parses a Kubernetes CPU quantity string into integer millicores.
 * Examples:
 *   "2"           -> 2000
 *   "0.5"         -> 500
 *   "250m"        -> 250
 *   "500000u"     -> 500
 *   "500000000n"  -> 500
 * Returns null if missing, undefined, or unparseable. NEVER fabricates a default.
 */
export function parseCpuQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw * 1000);
  }
  const str = String(raw).trim();
  if (!str) return null;

  // Nanocores: e.g. "500000000n"
  if (str.endsWith('n')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) && num >= 0 ? Math.round(num / 1_000_000) : null;
  }

  // Microcores: e.g. "500000u"
  if (str.endsWith('u')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) && num >= 0 ? Math.round(num / 1_000) : null;
  }

  // Millicores: e.g. "250m"
  if (str.endsWith('m')) {
    const num = parseFloat(str.slice(0, -1));
    return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
  }

  // Plain core count: e.g. "2", "0.5", "4.0"
  const num = parseFloat(str);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 1000) : null;
}

/**
 * Parses a Kubernetes Memory quantity string into exact integer bytes.
 * Handles binary SI suffixes (Ki, Mi, Gi, Ti, Pi, Ei) and decimal suffixes (k, M, G, T, P, E).
 * Examples:
 *   "128Mi"       -> 134217728
 *   "4Gi"         -> 4294967296
 *   "1048576"     -> 1048576
 *   "100M"        -> 100000000
 * Returns null if missing, undefined, or unparseable. NEVER fabricates a default.
 */
export function parseMemoryQuantity(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.round(raw);
  }
  const str = String(raw).trim();
  if (!str) return null;

  const binaryUnits: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6
  };

  for (const [suffix, mult] of Object.entries(binaryUnits)) {
    if (str.endsWith(suffix)) {
      const num = parseFloat(str.slice(0, -suffix.length));
      return Number.isFinite(num) && num >= 0 ? Math.round(num * mult) : null;
    }
  }

  const decimalUnits: Record<string, number> = {
    k: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6
  };

  for (const [suffix, mult] of Object.entries(decimalUnits)) {
    if (str.endsWith(suffix)) {
      const num = parseFloat(str.slice(0, -suffix.length));
      return Number.isFinite(num) && num >= 0 ? Math.round(num * mult) : null;
    }
  }

  const num = parseFloat(str);
  return Number.isFinite(num) && num >= 0 ? Math.round(num) : null;
}

/** Formats integer millicores into display string (e.g. "250m" or "4 cores") */
export function formatCpuMillicores(millicores: number | null | undefined): string {
  if (millicores === null || millicores === undefined || !Number.isFinite(millicores)) {
    return 'Unavailable';
  }
  if (millicores < 1000) {
    return `${millicores}m`;
  }
  const cores = millicores / 1000;
  return Number.isInteger(cores) ? `${cores} cores` : `${cores.toFixed(2)} cores`;
}

/** Formats byte count into display string using binary units (e.g. "512 MiB", "16.0 GiB") */
export function formatMemoryBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return 'Unavailable';
  }
  const kib = bytes / 1024;
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${Math.round(mib)} MiB`;
  const gib = mib / 1024;
  if (gib < 1024) return `${gib.toFixed(1)} GiB`;
  const tib = gib / 1024;
  return `${tib.toFixed(2)} TiB`;
}

export function createCpuMetricValue(millicores: number | null | undefined): ResourceMetricValue | undefined {
  if (millicores === null || millicores === undefined || !Number.isFinite(millicores)) return undefined;
  return {
    value: millicores,
    unit: 'millicores',
    formatted: formatCpuMillicores(millicores)
  };
}

export function createMemoryMetricValue(bytes: number | null | undefined): ResourceMetricValue | undefined {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return undefined;
  return {
    value: bytes,
    unit: 'bytes',
    formatted: formatMemoryBytes(bytes)
  };
}

/**
 * Evaluates telemetry freshness based on observedAt timestamp.
 */
export function evaluateFreshness(observedAt: number | undefined, now = Date.now()): MetricsFreshnessStatus {
  if (!observedAt || observedAt <= 0) return 'UNAVAILABLE';
  const ageMs = now - observedAt;
  if (ageMs < 90_000) return 'FRESH'; // < 1.5 min
  if (ageMs < 300_000) return 'DELAYED'; // 1.5 - 5 min
  return 'STALE'; // > 5 min
}

/**
 * Builds container resource metrics from a container diagnostic or spec.
 */
export function buildContainerMetrics(container: ContainerDiagnostic): ContainerResourceMetrics {
  const cpuReq = parseCpuQuantity(container.cpuRequest);
  const cpuLim = parseCpuQuantity(container.cpuLimit);
  const cpuUsg = parseCpuQuantity(container.cpuUsage);

  const memReq = parseMemoryQuantity(container.memoryRequest);
  const memLim = parseMemoryQuantity(container.memoryLimit);
  const memUsg = parseMemoryQuantity(container.memoryUsage);

  const isUsageAvailable = cpuUsg !== null || memUsg !== null;

  return {
    name: container.name,
    cpu: {
      request: createCpuMetricValue(cpuReq),
      limit: createCpuMetricValue(cpuLim),
      usage: createCpuMetricValue(cpuUsg)
    },
    memory: {
      request: createMemoryMetricValue(memReq),
      limit: createMemoryMetricValue(memLim),
      usage: createMemoryMetricValue(memUsg)
    },
    isUsageAvailable
  };
}

/**
 * Builds Pod-level resource metrics from container specs and actual usages.
 */
export function buildPodResourceMetrics(pod: KubernetesResource, now = Date.now()): ResourceMetrics {
  const containers = pod.containers || [];
  const containerMetrics: ContainerResourceMetrics[] = containers.map(buildContainerMetrics);

  let totalCpuReq: number | null = null;
  let totalCpuLim: number | null = null;
  let totalCpuUsg: number | null = null;

  let totalMemReq: number | null = null;
  let totalMemLim: number | null = null;
  let totalMemUsg: number | null = null;

  for (const cm of containerMetrics) {
    if (cm.cpu?.request) totalCpuReq = (totalCpuReq ?? 0) + cm.cpu.request.value;
    if (cm.cpu?.limit) totalCpuLim = (totalCpuLim ?? 0) + cm.cpu.limit.value;
    if (cm.cpu?.usage) totalCpuUsg = (totalCpuUsg ?? 0) + cm.cpu.usage.value;

    if (cm.memory?.request) totalMemReq = (totalMemReq ?? 0) + cm.memory.request.value;
    if (cm.memory?.limit) totalMemLim = (totalMemLim ?? 0) + cm.memory.limit.value;
    if (cm.memory?.usage) totalMemUsg = (totalMemUsg ?? 0) + cm.memory.usage.value;
  }

  // Also check if pod statusSummary has direct metrics from metrics.k8s.io
  const statusSummary = (pod.statusSummary || {}) as Record<string, unknown>;
  if (totalCpuUsg === null && statusSummary.cpuUsage) {
    totalCpuUsg = parseCpuQuantity(statusSummary.cpuUsage);
  }
  if (totalMemUsg === null && statusSummary.memoryUsage) {
    totalMemUsg = parseMemoryQuantity(statusSummary.memoryUsage);
  }

  const isUsageAvailable = totalCpuUsg !== null || totalMemUsg !== null;
  const observedAt = pod.observedAt || (statusSummary.metricsObservedAt as number) || pod.updatedAt || now;
  const ingestedAt = pod.ingestedAt || now;

  let cpuUtilPercent: number | undefined = undefined;
  if (totalCpuUsg !== null && totalCpuLim !== null && totalCpuLim > 0) {
    cpuUtilPercent = Math.min(100, Math.round((totalCpuUsg / totalCpuLim) * 100));
  }

  let memUtilPercent: number | undefined = undefined;
  if (totalMemUsg !== null && totalMemLim !== null && totalMemLim > 0) {
    memUtilPercent = Math.min(100, Math.round((totalMemUsg / totalMemLim) * 100));
  }

  return {
    clusterId: pod.clusterId,
    resourceKind: 'Pod',
    resourceName: pod.name,
    namespace: pod.namespace,
    cpu: {
      request: createCpuMetricValue(totalCpuReq),
      limit: createCpuMetricValue(totalCpuLim),
      usage: createCpuMetricValue(totalCpuUsg),
      utilizationPercent: cpuUtilPercent
    },
    memory: {
      request: createMemoryMetricValue(totalMemReq),
      limit: createMemoryMetricValue(totalMemLim),
      usage: createMemoryMetricValue(totalMemUsg),
      utilizationPercent: memUtilPercent
    },
    containers: containerMetrics,
    observedAt,
    ingestedAt,
    freshnessStatus: evaluateFreshness(observedAt, now),
    isUsageAvailable,
    unavailableReason: isUsageAvailable ? undefined : 'Live usage unavailable (metrics.k8s.io not reporting for this pod)'
  };
}

/**
 * Builds Node-level metrics summary by combining node capacity/allocatable with scheduled pods and metrics.k8s.io usage.
 */
export function buildNodeMetricsSummary(
  node: KubernetesResource,
  scheduledPods: KubernetesResource[],
  now = Date.now()
): NodeMetricsSummary {
  const statusSummary = (node.statusSummary || {}) as Record<string, unknown>;
  const capacityMap = (statusSummary.capacity || {}) as Record<string, string>;
  const allocatableMap = (statusSummary.allocatable || {}) as Record<string, string>;

  // Node capacities & allocatables
  const cpuCapacity = parseCpuQuantity(capacityMap.cpu);
  const cpuAllocatable = parseCpuQuantity(allocatableMap.cpu);
  const memCapacity = parseMemoryQuantity(capacityMap.memory);
  const memAllocatable = parseMemoryQuantity(allocatableMap.memory);
  const podCapacity = parseInt(capacityMap.pods || '110', 10);

  // Sum requests and limits of all pods scheduled on this node
  let requestedCpu = 0;
  let limitedCpu = 0;
  let requestedMem = 0;
  let limitedMem = 0;

  for (const pod of scheduledPods) {
    const podMetrics = buildPodResourceMetrics(pod, now);
    if (podMetrics.cpu.request) requestedCpu += podMetrics.cpu.request.value;
    if (podMetrics.cpu.limit) limitedCpu += podMetrics.cpu.limit.value;
    if (podMetrics.memory.request) requestedMem += podMetrics.memory.request.value;
    if (podMetrics.memory.limit) limitedMem += podMetrics.memory.limit.value;
  }

  // Actual usage from metrics.k8s.io if available
  const cpuUsage = parseCpuQuantity(statusSummary.cpuUsage);
  const memUsage = parseMemoryQuantity(statusSummary.memoryUsage);
  const isUsageAvailable = cpuUsage !== null || memUsage !== null;

  let cpuUtilPercent: number | undefined = undefined;
  if (cpuUsage !== null && cpuAllocatable !== null && cpuAllocatable > 0) {
    cpuUtilPercent = Math.min(100, Math.round((cpuUsage / cpuAllocatable) * 100));
  }

  let memUtilPercent: number | undefined = undefined;
  if (memUsage !== null && memAllocatable !== null && memAllocatable > 0) {
    memUtilPercent = Math.min(100, Math.round((memUsage / memAllocatable) * 100));
  }

  // Node conditions
  const conditions = node.conditions || [];
  const readyCond = conditions.find((c) => c.type === 'Ready');
  const memPressureCond = conditions.find((c) => c.type === 'MemoryPressure');
  const diskPressureCond = conditions.find((c) => c.type === 'DiskPressure');
  const pidPressureCond = conditions.find((c) => c.type === 'PIDPressure');

  const observedAt = node.observedAt || (statusSummary.metricsObservedAt as number) || node.updatedAt || now;
  const ingestedAt = node.ingestedAt || now;

  const nodeConditions: any = [
    { type: 'Ready', status: (readyCond?.status === 'True' || node.status === 'Ready') ? 'True' : 'False' },
    { type: 'MemoryPressure', status: memPressureCond?.status === 'True' ? 'True' : 'False' },
    { type: 'DiskPressure', status: diskPressureCond?.status === 'True' ? 'True' : 'False' },
    { type: 'PIDPressure', status: pidPressureCond?.status === 'True' ? 'True' : 'False' }
  ];
  nodeConditions.ready = readyCond?.status === 'True' || node.status === 'Ready';
  nodeConditions.memoryPressure = memPressureCond?.status === 'True';
  nodeConditions.diskPressure = diskPressureCond?.status === 'True';
  nodeConditions.pidPressure = pidPressureCond?.status === 'True';

  return {
    clusterId: node.clusterId,
    resourceKind: 'Node',
    resourceName: node.name,
    nodeName: node.name,
    name: node.name,
    kubeletVersion: (statusSummary.kubeletVersion as string) || undefined,
    ready: readyCond?.status === 'True' || node.status === 'Ready',
    podCount: scheduledPods.length,
    podCapacity: Number.isFinite(podCapacity) ? podCapacity : 110,
    conditions: nodeConditions,
    conditionFlags: {
      ready: readyCond?.status === 'True' || node.status === 'Ready',
      memoryPressure: memPressureCond?.status === 'True',
      diskPressure: diskPressureCond?.status === 'True',
      pidPressure: pidPressureCond?.status === 'True'
    },
    cpu: {
      capacity: createCpuMetricValue(cpuCapacity),
      allocatable: createCpuMetricValue(cpuAllocatable),
      request: createCpuMetricValue(requestedCpu),
      requests: createCpuMetricValue(requestedCpu),
      limit: createCpuMetricValue(limitedCpu),
      limits: createCpuMetricValue(limitedCpu),
      usage: createCpuMetricValue(cpuUsage),
      requestedPercent: cpuAllocatable > 0 ? Math.round((requestedCpu / cpuAllocatable) * 100) : 0,
      utilizationPercent: cpuUtilPercent
    },
    memory: {
      capacity: createMemoryMetricValue(memCapacity),
      allocatable: createMemoryMetricValue(memAllocatable),
      request: createMemoryMetricValue(requestedMem),
      requests: createMemoryMetricValue(requestedMem),
      limit: createMemoryMetricValue(limitedMem),
      limits: createMemoryMetricValue(limitedMem),
      usage: createMemoryMetricValue(memUsage),
      requestedPercent: memAllocatable > 0 ? Math.round((requestedMem / memAllocatable) * 100) : 0,
      utilizationPercent: memUtilPercent
    },
    observedAt,
    ingestedAt,
    freshnessStatus: evaluateFreshness(observedAt, now),
    metricsSource: isUsageAvailable ? 'METRICS_SERVER' : 'SPEC_STATUS_ONLY',
    isUsageAvailable,
    unavailableReason: isUsageAvailable ? undefined : 'Live usage unavailable (metrics.k8s.io not reporting for this node)'
  };
}

/**
 * Builds Workload-level metrics summary by aggregating its child pods.
 */
export function buildWorkloadMetricsSummary(
  workload: KubernetesResource,
  childPods: KubernetesResource[],
  now = Date.now()
): WorkloadMetricsSummary {
  let totalCpuReq = 0;
  let totalCpuLim = 0;
  let totalCpuUsg: number | null = null;

  let totalMemReq = 0;
  let totalMemLim = 0;
  let totalMemUsg: number | null = null;

  let anyUsageAvailable = false;

  for (const pod of childPods) {
    const podMetrics = buildPodResourceMetrics(pod, now);
    if (podMetrics.cpu.request) totalCpuReq += podMetrics.cpu.request.value;
    if (podMetrics.cpu.limit) totalCpuLim += podMetrics.cpu.limit.value;
    if (podMetrics.cpu.usage) {
      totalCpuUsg = (totalCpuUsg ?? 0) + podMetrics.cpu.usage.value;
      anyUsageAvailable = true;
    }

    if (podMetrics.memory.request) totalMemReq += podMetrics.memory.request.value;
    if (podMetrics.memory.limit) totalMemLim += podMetrics.memory.limit.value;
    if (podMetrics.memory.usage) {
      totalMemUsg = (totalMemUsg ?? 0) + podMetrics.memory.usage.value;
      anyUsageAvailable = true;
    }
  }

  const specSummary = (workload.specSummary || {}) as Record<string, unknown>;
  const statusSummary = (workload.statusSummary || {}) as Record<string, unknown>;
  const desiredReplicas = Number(specSummary.replicas ?? 1);
  const readyReplicas = Number(statusSummary.readyReplicas ?? statusSummary.availableReplicas ?? 0);

  let cpuUtilPercent: number | undefined = undefined;
  if (totalCpuUsg !== null && totalCpuLim > 0) {
    cpuUtilPercent = Math.min(100, Math.round((totalCpuUsg / totalCpuLim) * 100));
  }

  let memUtilPercent: number | undefined = undefined;
  if (totalMemUsg !== null && totalMemLim > 0) {
    memUtilPercent = Math.min(100, Math.round((totalMemUsg / totalMemLim) * 100));
  }

  const observedAt = workload.observedAt || workload.updatedAt || now;
  const ingestedAt = workload.ingestedAt || now;

  return {
    clusterId: workload.clusterId,
    resourceKind: 'Workload',
    resourceName: workload.name,
    name: workload.name,
    namespace: workload.namespace,
    workloadKind: workload.kind,
    kind: workload.kind,
    desiredReplicas,
    readyReplicas,
    childPodCount: childPods.length,
    podCount: childPods.length,
    hasPodsWithoutLimits: totalCpuLim === 0 || totalMemLim === 0,
    isNearMemoryLimit: memUtilPercent !== undefined && memUtilPercent > 85,
    usageAvailable: anyUsageAvailable,
    totalCpuRequests: createCpuMetricValue(totalCpuReq),
    totalCpuLimits: createCpuMetricValue(totalCpuLim),
    totalCpuUsage: createCpuMetricValue(totalCpuUsg),
    totalMemoryRequests: createMemoryMetricValue(totalMemReq),
    totalMemoryLimits: createMemoryMetricValue(totalMemLim),
    totalMemoryUsage: createMemoryMetricValue(totalMemUsg),
    cpu: {
      request: createCpuMetricValue(totalCpuReq),
      limit: createCpuMetricValue(totalCpuLim),
      usage: createCpuMetricValue(totalCpuUsg),
      utilizationPercent: cpuUtilPercent
    },
    memory: {
      request: createMemoryMetricValue(totalMemReq),
      limit: createMemoryMetricValue(totalMemLim),
      usage: createMemoryMetricValue(totalMemUsg),
      utilizationPercent: memUtilPercent
    },
    observedAt,
    ingestedAt,
    freshnessStatus: evaluateFreshness(observedAt, now),
    isUsageAvailable: anyUsageAvailable,
    unavailableReason: anyUsageAvailable ? undefined : 'Live usage unavailable (metrics.k8s.io not reporting for child pods)'
  };
}

/**
 * Builds cluster-wide deep observability metrics aggregating all nodes and workloads.
 */
export function buildClusterObservabilityMetrics(
  cluster: Cluster,
  allResources: KubernetesResource[],
  now = Date.now()
): ClusterObservabilityMetrics {
  const nodes = allResources.filter((r) => r.kind === 'Node');
  const pods = allResources.filter((r) => r.kind === 'Pod');
  const workloads = allResources.filter((r) =>
    ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(r.kind)
  );

  // Map pods to scheduled nodes
  const podsByNode = new Map<string, KubernetesResource[]>();
  for (const pod of pods) {
    const nodeName =
      pod.nodeName ||
      ((pod.specSummary?.nodeName as string) || '').trim() ||
      'unassigned';
    if (!podsByNode.has(nodeName)) podsByNode.set(nodeName, []);
    podsByNode.get(nodeName)!.push(pod);
  }

  const nodeSummaries: NodeMetricsSummary[] = nodes.map((node) =>
    buildNodeMetricsSummary(node, podsByNode.get(node.name) || [], now)
  );

  // Map child pods to workloads
  const workloadSummaries: WorkloadMetricsSummary[] = workloads.map((w) => {
    const childPods = pods.filter((p) => {
      if (p.namespace !== w.namespace) return false;
      if (p.ownerReferences && p.ownerReferences.length > 0) {
        return p.ownerReferences.some(
          (o) =>
            (o.kind === w.kind && o.name === w.name) ||
            (w.kind === 'Deployment' && o.kind === 'ReplicaSet' && o.name?.startsWith(w.name)) ||
            (w.kind === 'CronJob' && o.kind === 'Job' && o.name?.startsWith(w.name))
        );
      }
      return p.name.startsWith(`${w.name}-`);
    });
    return buildWorkloadMetricsSummary(w, childPods, now);
  });

  // Aggregate totals
  let totalCpuCapacity = 0;
  let totalCpuAllocatable = 0;
  let totalCpuRequest = 0;
  let totalCpuLimit = 0;
  let totalCpuUsage: number | null = null;

  let totalMemCapacity = 0;
  let totalMemAllocatable = 0;
  let totalMemRequest = 0;
  let totalMemLimit = 0;
  let totalMemUsage: number | null = null;

  let anyUsageAvailable = false;
  let newestObservedAt = 0;

  for (const ns of nodeSummaries) {
    if (ns.cpu.capacity) totalCpuCapacity += ns.cpu.capacity.value;
    if (ns.cpu.allocatable) totalCpuAllocatable += ns.cpu.allocatable.value;
    if (ns.cpu.request) totalCpuRequest += ns.cpu.request.value;
    if (ns.cpu.limit) totalCpuLimit += ns.cpu.limit.value;
    if (ns.cpu.usage) {
      totalCpuUsage = (totalCpuUsage ?? 0) + ns.cpu.usage.value;
      anyUsageAvailable = true;
    }

    if (ns.memory.capacity) totalMemCapacity += ns.memory.capacity.value;
    if (ns.memory.allocatable) totalMemAllocatable += ns.memory.allocatable.value;
    if (ns.memory.request) totalMemRequest += ns.memory.request.value;
    if (ns.memory.limit) totalMemLimit += ns.memory.limit.value;
    if (ns.memory.usage) {
      totalMemUsage = (totalMemUsage ?? 0) + ns.memory.usage.value;
      anyUsageAvailable = true;
    }

    if (ns.observedAt > newestObservedAt) newestObservedAt = ns.observedAt;
  }

  // If node summaries didn't have usage, check if pods had usage
  if (!anyUsageAvailable) {
    for (const pod of pods) {
      const pm = buildPodResourceMetrics(pod, now);
      if (pm.cpu.usage) {
        totalCpuUsage = (totalCpuUsage ?? 0) + pm.cpu.usage.value;
        anyUsageAvailable = true;
      }
      if (pm.memory.usage) {
        totalMemUsage = (totalMemUsage ?? 0) + pm.memory.usage.value;
        anyUsageAvailable = true;
      }
      if (pm.observedAt > newestObservedAt) newestObservedAt = pm.observedAt;
    }
  }

  const observedAt = newestObservedAt > 0 ? newestObservedAt : cluster.lastHeartbeat || now;
  const ingestedAt = now;

  let clusterCpuUtil: number | undefined = undefined;
  if (totalCpuUsage !== null && totalCpuAllocatable > 0) {
    clusterCpuUtil = Math.min(100, Math.round((totalCpuUsage / totalCpuAllocatable) * 100));
  }

  let clusterMemUtil: number | undefined = undefined;
  if (totalMemUsage !== null && totalMemAllocatable > 0) {
    clusterMemUtil = Math.min(100, Math.round((totalMemUsage / totalMemAllocatable) * 100));
  }

  const cpuReqPercent = totalCpuAllocatable > 0 ? Math.round((totalCpuRequest / totalCpuAllocatable) * 100) : 0;
  const cpuLimitPercent = totalCpuAllocatable > 0 ? Math.round((totalCpuLimit / totalCpuAllocatable) * 100) : 0;
  const memReqPercent = totalMemAllocatable > 0 ? Math.round((totalMemRequest / totalMemAllocatable) * 100) : 0;
  const memLimitPercent = totalMemAllocatable > 0 ? Math.round((totalMemLimit / totalMemAllocatable) * 100) : 0;

  return {
    clusterId: cluster.id,
    clusterName: cluster.name,
    observedAt,
    ingestedAt,
    freshnessStatus: evaluateFreshness(observedAt, now),
    isUsageAvailable: anyUsageAvailable,
    metricsSource: anyUsageAvailable ? 'METRICS_SERVER' : 'SPEC_STATUS_ONLY',
    source: anyUsageAvailable ? 'metrics.k8s.io' : 'spec-derived',
    unavailableReason: anyUsageAvailable
      ? undefined
      : 'Metrics Server (metrics.k8s.io) is not available or not reporting in this cluster',
    nodeCount: nodes.length,
    podCount: pods.length,
    commitmentRatios: {
      cpuRequestedPercent: cpuReqPercent,
      cpuLimitPercent: cpuLimitPercent,
      cpuUsagePercent: clusterCpuUtil,
      memoryRequestedPercent: memReqPercent,
      memoryLimitPercent: memLimitPercent,
      memoryUsagePercent: clusterMemUtil
    },
    cpu: {
      capacity: createCpuMetricValue(totalCpuCapacity)!,
      allocatable: createCpuMetricValue(totalCpuAllocatable)!,
      request: createCpuMetricValue(totalCpuRequest)!,
      limit: createCpuMetricValue(totalCpuLimit)!,
      usage: createCpuMetricValue(totalCpuUsage),
      totalCapacity: createCpuMetricValue(totalCpuCapacity)!,
      totalAllocatable: createCpuMetricValue(totalCpuAllocatable)!,
      totalRequests: createCpuMetricValue(totalCpuRequest)!,
      totalLimits: createCpuMetricValue(totalCpuLimit)!,
      totalUsage: createCpuMetricValue(totalCpuUsage),
      usageAvailable: anyUsageAvailable,
      utilizationPercent: clusterCpuUtil
    },
    memory: {
      capacity: createMemoryMetricValue(totalMemCapacity)!,
      allocatable: createMemoryMetricValue(totalMemAllocatable)!,
      request: createMemoryMetricValue(totalMemRequest)!,
      limit: createMemoryMetricValue(totalMemLimit)!,
      usage: createMemoryMetricValue(totalMemUsage),
      totalCapacity: createMemoryMetricValue(totalMemCapacity)!,
      totalAllocatable: createMemoryMetricValue(totalMemAllocatable)!,
      totalRequests: createMemoryMetricValue(totalMemRequest)!,
      totalLimits: createMemoryMetricValue(totalMemLimit)!,
      totalUsage: createMemoryMetricValue(totalMemUsage),
      usageAvailable: anyUsageAvailable,
      utilizationPercent: clusterMemUtil
    },
    nodes: nodeSummaries,
    workloads: workloadSummaries
  };
}
