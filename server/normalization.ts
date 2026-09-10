import { ConditionDiagnostic, ContainerDiagnostic, K8sEvent, KubernetesResource } from '../src/types/index';
import { buildPodResourceMetrics } from './metrics';

type RecordValue = Record<string, unknown>;
const FAILURE_WAITING = new Set(['ErrImagePull', 'ImagePullBackOff', 'InvalidImageName', 'CreateContainerConfigError', 'CreateContainerError', 'CrashLoopBackOff']);
const asObject = (value: unknown): RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asString = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;
const asNumber = (value: unknown, fallback = 0): number => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** Identity is intentionally independent of Kubernetes UID: recreation of a workload is still the same monitored object. */
export function resourceIdentity(clusterId: string, kind: string, namespace: string, name: string): string {
  return [clusterId, kind.toLowerCase(), namespace.toLowerCase(), name.toLowerCase()].join('/');
}

function normalizeConditions(value: unknown): ConditionDiagnostic[] {
  return asList(value).map((item: unknown): ConditionDiagnostic => {
    const condition = asObject(item);
    return { type: asString(condition.type), status: asString(condition.status), reason: asString(condition.reason) || undefined, message: asString(condition.message) || undefined, lastTransitionTime: asString(condition.lastTransitionTime) || undefined };
  }).filter(condition => condition.type.length > 0);
}

function normalizeContainers(value: unknown, specContainers: unknown[] = []): ContainerDiagnostic[] {
  const specByName = new Map(asList(specContainers).map(item => {
    const container = asObject(item);
    const resources = asObject(container.resources);
    const limits = asObject(resources.limits);
    const requests = asObject(resources.requests);
    return [
      asString(container.name),
      {
        memoryLimit: asString(limits.memory),
        cpuLimit: asString(limits.cpu),
        memoryRequest: asString(requests.memory),
        cpuRequest: asString(requests.cpu)
      }
    ];
  }));
  return asList(value).map(item => {
    const container = asObject(item); const state = asObject(container.state); const waiting = asObject(state.waiting); const terminated = asObject(state.terminated); const lastState = asObject(container.lastState); const lastTerminated = asObject(lastState.terminated);
    const suppliedState = asString(container.state);
    const name = asString(container.name, 'container');
    const specRes = specByName.get(name);
    return {
      name, image: asString(container.image), imageId: asString(container.imageID, asString(container.imageId)) || undefined,
      restartCount: asNumber(container.restartCount), ready: container.ready === true,
      state: suppliedState || (Object.keys(waiting).length > 0 ? 'waiting' : Object.keys(terminated).length > 0 ? 'terminated' : Object.keys(state.running).length > 0 ? 'running' : 'unknown'),
      waitingReason: asString(container.waitingReason, asString(waiting.reason)) || undefined,
      waitingMessage: asString(container.waitingMessage, asString(waiting.message)) || undefined,
      terminationReason: asString(container.terminationReason, asString(terminated.reason)) || undefined,
      exitCode: typeof container.exitCode === 'number' ? container.exitCode : typeof terminated.exitCode === 'number' ? terminated.exitCode : undefined,
      signal: typeof terminated.signal === 'number' ? terminated.signal : undefined,
      lastTerminationReason: asString(container.lastTerminationReason, asString(lastTerminated.reason)) || undefined,
      lastExitCode: typeof container.lastExitCode === 'number' ? container.lastExitCode : typeof lastTerminated.exitCode === 'number' ? lastTerminated.exitCode : undefined,
      memoryLimit: asString(container.memoryLimit) || specRes?.memoryLimit || undefined,
      memoryRequest: asString(container.memoryRequest) || specRes?.memoryRequest || undefined,
      cpuLimit: asString(container.cpuLimit) || specRes?.cpuLimit || undefined,
      cpuRequest: asString(container.cpuRequest) || specRes?.cpuRequest || undefined,
      memoryUsage: asString(container.memoryUsage) || undefined,
      cpuUsage: asString(container.cpuUsage) || undefined
    };
  });
}

function normalizeEvents(value: unknown): K8sEvent[] {
  return asList(value).map((item: unknown): K8sEvent => {
    const event = asObject(item);
    const type: K8sEvent['type'] = asString(event.type) === 'Warning' ? 'Warning' : 'Normal';
    return { id: asString(event.id, asString(asObject(event.metadata).uid)), timestamp: asNumber(event.timestamp), type, reason: asString(event.reason), objectKind: asString(event.objectKind), objectName: asString(event.objectName), namespace: asString(event.namespace), message: asString(event.message), count: typeof event.count === 'number' ? event.count : undefined };
  }).filter(event => event.reason || event.message);
}

/** Converts Kubernetes API objects and typed agent observations into one loss-minimising investigation model. */
export function normalizeResource(value: unknown, authenticatedClusterId: string, now = Date.now()): KubernetesResource | null {
  const raw = asObject(value);
  // Unwrap payload wrapper if item is structured as { payload: ... }
  const payloadObj = asObject(raw.payload);
  const target = Object.keys(payloadObj).length > 0 && (payloadObj.kind || payloadObj.metadata) ? payloadObj : raw;

  const metadata = asObject(target.metadata);
  const kind = asString(target.kind).trim();
  const name = asString(metadata.name, asString(target.name)).trim();
  if (!kind || !name) return null;
  const namespace = asString(metadata.namespace, asString(target.namespace)).trim();
  const suppliedSpec = asObject(target.specSummary);
  const suppliedStatus = asObject(target.statusSummary);
  const spec = Object.keys(suppliedSpec).length > 0 ? suppliedSpec : asObject(target.spec);
  const status = Object.keys(suppliedStatus).length > 0 ? suppliedStatus : asObject(target.status);
  const conditions = normalizeConditions(target.conditions ?? status.conditions);

  const templateSpec = asObject(asObject(spec.template).spec);
  const containerCandidates = asList(target.containers).length > 0
    ? target.containers
    : [...asList(status.initContainerStatuses), ...asList(status.containerStatuses)];
  const specContainers = asList(spec.containers).length > 0
    ? asList(spec.containers)
    : asList(templateSpec.containers);
  const containers = normalizeContainers(containerCandidates, specContainers);

  const phase = asString(status.phase, asString(target.status, 'Unknown'));
  let displayStatus = phase || 'Unknown';
  let health: KubernetesResource['health'] = target.health === 'HEALTHY' || target.health === 'WARNING' || target.health === 'CRITICAL' ? target.health : 'HEALTHY';

  if (kind === 'Pod') {
    const waitingFailure = containers.find(container => container.waitingReason && FAILURE_WAITING.has(container.waitingReason));
    const terminalFailure = containers.find(container => container.terminationReason && container.terminationReason !== 'Completed');
    const ready = conditions.find(condition => condition.type === 'Ready')?.status === 'True';
    displayStatus = waitingFailure?.waitingReason || terminalFailure?.terminationReason || phase || 'Unknown';
    health = waitingFailure || terminalFailure || phase === 'Failed' ? 'CRITICAL' : phase === 'Running' && (ready || containers.every(container => container.ready || container.state === 'running')) ? 'HEALTHY' : 'WARNING';
  } else if (kind === 'Node') {
    const ready = conditions.find(condition => condition.type === 'Ready')?.status === 'True';
    const memoryPressure = conditions.find(condition => condition.type === 'MemoryPressure')?.status === 'True';
    const diskPressure = conditions.find(condition => condition.type === 'DiskPressure')?.status === 'True';
    const pidPressure = conditions.find(condition => condition.type === 'PIDPressure')?.status === 'True';
    displayStatus = ready ? 'Ready' : 'NotReady';
    health = !ready ? 'CRITICAL' : (memoryPressure || diskPressure || pidPressure) ? 'WARNING' : 'HEALTHY';
  } else if (kind === 'PersistentVolumeClaim') {
    displayStatus = asString(status.phase, displayStatus);
    health = displayStatus === 'Bound' ? 'HEALTHY' : displayStatus === 'Lost' ? 'CRITICAL' : 'WARNING';
  } else if (kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet') {
    const desired = asNumber(spec.replicas, asNumber(status.replicas, 1));
    const ready = asNumber(status.readyReplicas, asNumber(status.numberReady, 0));
    const available = asNumber(status.availableReplicas, asNumber(status.numberAvailable, ready));
    const unavailable = asNumber(status.unavailableReplicas, asNumber(status.numberUnavailable, 0));
    displayStatus = `${ready}/${desired}`;
    if (desired === 0) {
      health = 'HEALTHY';
    } else if (unavailable > 0 || ready === 0) {
      health = 'CRITICAL';
    } else if (ready < desired) {
      health = 'WARNING';
    } else {
      health = 'HEALTHY';
    }
  } else if (kind === 'Job' || kind === 'CronJob') {
    const succeeded = asNumber(status.succeeded, 0);
    const failed = asNumber(status.failed, 0);
    displayStatus = failed > 0 ? 'Failed' : succeeded > 0 ? 'Completed' : 'Running';
    health = failed > 0 ? 'CRITICAL' : 'HEALTHY';
  }

  const createdAt = Date.parse(asString(metadata.creationTimestamp));
  const uid = asString(metadata.uid) || asString(target.uid) || asString(target.id) || undefined;
  const observedAt = asNumber(target.observedAt, asNumber(status.metricsObservedAt, now));
  const res: KubernetesResource = {
    id: uid || resourceIdentity(authenticatedClusterId, kind, namespace, name),
    uid,
    apiVersion: asString(target.apiVersion) || undefined,
    clusterId: authenticatedClusterId,
    kind,
    namespace,
    name,
    nodeName: asString(target.nodeName, asString(spec.nodeName)) || undefined,
    labels: Object.keys(asObject(metadata.labels ?? target.labels)).length > 0 ? (asObject(metadata.labels ?? target.labels) as Record<string, string>) : undefined,
    annotations: Object.keys(asObject(metadata.annotations ?? target.annotations)).length > 0 ? (asObject(metadata.annotations ?? target.annotations) as Record<string, string>) : undefined,
    status: displayStatus,
    health,
    createdAt: Number.isNaN(createdAt) ? asNumber(target.createdAt, now) : createdAt,
    updatedAt: now,
    observedAt,
    ingestedAt: now,
    specSummary: spec,
    statusSummary: status,
    conditions,
    containers,
    events: normalizeEvents(target.events),
    ownerReferences: asList(metadata.ownerReferences ?? target.ownerReferences).map(reference => {
      const owner = asObject(reference);
      return {
        uid: asString(owner.uid) || undefined,
        kind: asString(owner.kind) || undefined,
        name: asString(owner.name) || undefined,
        controller: owner.controller === true
      };
    })
  };

  if (kind === 'Pod') {
    res.metrics = buildPodResourceMetrics(res, now);
  }

  return res;
}

export function normalizeTelemetry(payload: unknown, clusterId: string): KubernetesResource[] | null {
  const body = asObject(payload);
  const rawList = asObject(body.rawK8sList);
  const rawK8s = asObject(body.rawK8s);

  let candidates: unknown[] | null = null;

  if (Array.isArray(payload)) {
    candidates = payload;
  } else if (Array.isArray(body.resources)) {
    candidates = body.resources;
  } else if (Array.isArray(body.items)) {
    candidates = body.items.map((item) => {
      const obj = asObject(item);
      return obj.payload ? obj.payload : item;
    });
  } else if (Array.isArray(rawList.items)) {
    candidates = rawList.items;
  } else if (body.kind === 'List' && Array.isArray(body.items)) {
    candidates = body.items;
  } else if (Object.keys(rawK8s).length > 0) {
    candidates = [];
    for (const key of Object.keys(rawK8s)) {
      const sub = rawK8s[key];
      if (sub && Array.isArray((sub as any).items)) {
        candidates.push(...(sub as any).items);
      }
    }
  }

  if (candidates === null) return null;

  const resources = new Map<string, KubernetesResource>();
  for (const candidate of candidates) {
    const resource = normalizeResource(candidate, clusterId);
    if (resource) {
      resources.set(resourceIdentity(clusterId, resource.kind, resource.namespace, resource.name), resource);
    }
  }
  return [...resources.values()];
}
