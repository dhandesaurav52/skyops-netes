import { Incident, IntelligenceAnalysis, KubernetesResource } from '../../src/types/index';
import { IncidentContext } from './types';

// Normal operational keys that should NEVER be redacted by key-name matches
export const OPERATIONAL_KEY_SAFE_LIST = new Set([
  'image',
  'imagetag',
  'namespace',
  'pod',
  'podname',
  'container',
  'containername',
  'containers',
  'initcontainers',
  'deployment',
  'deploymentname',
  'statefulset',
  'daemonset',
  'replicaset',
  'job',
  'cronjob',
  'service',
  'ingress',
  'node',
  'nodename',
  'status',
  'phase',
  'health',
  'reason',
  'message',
  'exitcode',
  'restartcount',
  'ready',
  'state',
  'kind',
  'name',
  'type',
  'count',
  'timestamp',
  'ageseconds',
  'duration',
  'resources',
  'limits',
  'requests',
  'cpu',
  'memory',
  'ports',
  'protocol',
  'targetport',
  'port',
  'hostport',
  'hostip',
  'podip',
  'restartpolicy',
  'dnspolicy',
  'schedulername',
  'priority',
  'priorityclassname',
  'selector',
  'matchlabels',
  'replicas',
  'availablereplicas',
  'readyreplicas',
  'updatedreplicas',
  'unavailableplicas',
  'observedgeneration',
  'storageclass',
  'storageclassname',
  'accessmodes',
  'capacity',
  'volumename',
  'volumemounts',
  'mountpath',
  'subpath',
  'readonly',
  'waitingreason',
  'waitingmessage',
  'terminationreason'
]);

// Sensitive keys to strip from any spec/status objects before AI ingestion
export const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /auth/i,
  /credential/i,
  /bearer/i,
  /private.*key/i,
  /api.*key/i,
  /access.*key/i,
  /secret.*key/i,
  /jwt/i,
  /session.*id/i,
  /certificate/i,
  /(?:^|[_.-])key(?:$|[_.-])/i,
  /private/i,
  /id_rsa/i,
  /ssh_key/i,
  /tls\.crt/i,
  /tls\.key/i,
  /client\.crt/i,
  /client\.key/i,
  /ca\.crt/i,
  /\.dockercfg/i,
  /\.dockerconfigjson/i
];

// String-level signatures for raw API keys, tokens, and private keys
export const SENSITIVE_STRING_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/i,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /ghp_[A-Za-z0-9]{36}/,
  /xox[baprs]-[A-Za-z0-9-]+/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z-_]{35}/
];

/**
 * Sanitizes a string value, checking for sensitive patterns or excessive length.
 */
export function sanitizeStringValue(str: string): string {
  if (SENSITIVE_STRING_PATTERNS.some((pattern) => pattern.test(str))) {
    return '[REDACTED_SENSITIVE_TOKEN]';
  }
  if (str.length > 500) {
    return `${str.slice(0, 500)}... [TRUNCATED]`;
  }
  return str;
}

/**
 * Recursively sanitizes any spec or status objects to prevent credentials,
 * certificates, or API tokens from entering the AI model context.
 */
export function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 5 || obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return sanitizeStringValue(obj);
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.slice(0, 15).map((item) => {
      // Handle Kubernetes environment variable structure: { name: '...', value: '...' }
      if (item && typeof item === 'object' && typeof item.name === 'string') {
        const isEnvSensitive = SENSITIVE_KEY_PATTERNS.some((p) => p.test(item.name));
        if (isEnvSensitive) {
          return {
            ...item,
            value: '[REDACTED_SENSITIVE_DATA]',
            valueFrom: item.valueFrom ? '[REDACTED_SECRET_REF]' : undefined
          };
        }
      }
      return sanitizeObject(item, depth + 1);
    });
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[-_.]/g, '');
    const isOperational = OPERATIONAL_KEY_SAFE_LIST.has(normalizedKey);
    const isSensitiveKey = !isOperational && SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));

    // Handle Kubernetes Secret-like data dictionaries (e.g. data: { ... }, stringData: { ... })
    if (key === 'data' || key === 'stringData') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const secretDict: Record<string, string> = {};
        for (const subKey of Object.keys(value)) {
          secretDict[subKey] = '[REDACTED_SECRET_PAYLOAD]';
        }
        sanitized[key] = secretDict;
        continue;
      }
    }

    if (isSensitiveKey) {
      sanitized[key] = '[REDACTED_SENSITIVE_DATA]';
    } else if (typeof value === 'string') {
      sanitized[key] = sanitizeStringValue(value);
    } else if (typeof value === 'object') {
      sanitized[key] = sanitizeObject(value, depth + 1);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Builds a compact, high-signal, token-efficient IncidentContext
 * from an active SkyOps Incident and its associated cluster resources.
 */
export function buildIncidentContext(
  incident: Incident,
  associatedResource?: KubernetesResource | null,
  additionalNotes?: string[],
  intelligence?: IntelligenceAnalysis
): IncidentContext {
  const tech = incident.technicalDetails || {};

  // Extract and limit events to max 10 most recent, formatted cleanly
  const rawEvents = tech.events || associatedResource?.events || [];
  const recentEvents = rawEvents
    .slice(0, 10)
    .map((e) => ({
      type: e.type || 'Normal',
      reason: e.reason || 'Unknown',
      message: (e.message || '').slice(0, 300),
      count: e.count || 1,
      ageSeconds: Math.max(0, Math.round((Date.now() - (e.timestamp || incident.lastSeenAt)) / 1000))
    }));

  // Extract conditions
  const rawConditions = tech.conditions || associatedResource?.conditions || [];
  const conditions = rawConditions.slice(0, 10).map((c) => ({
    type: c.type || '',
    status: c.status || '',
    reason: c.reason,
    message: (c.message || '').slice(0, 300)
  }));

  // Extract container diagnostics
  const rawContainers = tech.containers || associatedResource?.containers || [];
  const containers = rawContainers.slice(0, 8).map((c) => ({
    name: c.name,
    image: c.image,
    state: c.state,
    restartCount: c.restartCount || 0,
    ready: Boolean(c.ready),
    waitingReason: c.waitingReason,
    waitingMessage: (c.waitingMessage || '').slice(0, 300),
    terminationReason: c.terminationReason,
    exitCode: c.exitCode
  }));

  // Related resources
  const relatedResources = (tech.relatedResources || []).slice(0, 8).map((r) => ({
    kind: r.kind,
    name: r.name,
    namespace: r.namespace || incident.namespace,
    relationship: r.relationship
  }));

  // Build spec/status summaries safely
  const specSummary = sanitizeObject(associatedResource?.specSummary || {});
  const statusSummary = sanitizeObject(associatedResource?.statusSummary || {});

  // Extract owner references
  const rawOwnerRefs = (associatedResource?.ownerReferences && associatedResource.ownerReferences.length > 0)
    ? associatedResource.ownerReferences
    : Array.isArray((tech as any).ownerReferences)
    ? (tech as any).ownerReferences
    : [];
  const ownerReferences = rawOwnerRefs.map((ref: any) => ({
    kind: ref.kind || 'Unknown',
    name: ref.name || 'Unknown',
    controller: ref.controller
  }));

  // Extract replica counts if applicable
  const replicaCounts = (tech.desiredReplicas !== undefined || tech.availableReplicas !== undefined || tech.readyReplicas !== undefined)
    ? {
        desired: tech.desiredReplicas,
        available: tech.availableReplicas,
        ready: tech.readyReplicas,
        updated: tech.updatedReplicas
      }
    : undefined;

  // Extract PVC diagnostics if applicable
  const pvcDiagnostics = (tech.pvcPhase || tech.storageClass || tech.capacity)
    ? {
        pvcPhase: tech.pvcPhase,
        storageClass: tech.storageClass,
        capacity: tech.capacity
      }
    : undefined;

  // Extract waiting reason if present on any target container
  const waitingReason = containers.find((c) => c.waitingReason)?.waitingReason || tech.reason;

  return {
    incidentId: incident.id,
    fingerprint: incident.fingerprint,
    orgId: incident.orgId,
    incidentType: incident.incidentType,
    severity: incident.severity,
    clusterId: incident.clusterId,
    clusterName: incident.clusterName,
    namespace: incident.namespace || 'default',
    resourceKind: incident.resourceKind,
    resourceName: incident.resourceName,
    occurrenceCount: incident.occurrenceCount,
    firstSeenAt: new Date(incident.firstSeenAt).toISOString(),
    lastSeenAt: new Date(incident.lastSeenAt).toISOString(),
    targetPod: tech.podName,
    targetContainer: tech.containerName,
    targetImage: tech.image,
    imageTag: tech.imageTag,
    restartCount: tech.restartCount,
    exitCode: tech.exitCode,
    terminationReason: tech.reason,
    waitingReason,
    nodeName: tech.nodeName,
    observedState: tech.observedState,
    k8sStatus: associatedResource?.status,
    ownerReferences: ownerReferences.length > 0 ? ownerReferences : undefined,
    replicaCounts,
    pvcDiagnostics,
    recentEvents,
    conditions,
    containers,
    relatedResources,
    specSummary,
    statusSummary,
    additionalNotes: additionalNotes && additionalNotes.length > 0 ? additionalNotes.slice(0, 5) : undefined,
    intelligence
  };
}
