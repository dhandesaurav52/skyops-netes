import crypto from 'crypto';
import {
  RemediationAction,
  RemediationActionStatus,
  RemediationPolicy,
  RemediationMode,
  CanonicalRemediationActionType,
  AIRiskLevel,
  Incident,
  KubernetesResource
} from '../../src/types/index';

/**
 * Strict allowed state machine transitions for SkyOps canonical remediation lifecycle.
 */
export const ALLOWED_TRANSITIONS: Record<RemediationActionStatus, RemediationActionStatus[]> = {
  PROPOSED: ['AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'STALE'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'STALE'],
  APPROVED: ['QUEUED', 'DELIVERED', 'DISPATCHED', 'CANCELLED', 'EXPIRED', 'STALE'],
  DISPATCHED: ['QUEUED', 'DELIVERED', 'EXECUTING', 'EXECUTED', 'SUCCEEDED', 'FAILED', 'EXECUTION_FAILED', 'CANCELLED', 'EXPIRED'],
  QUEUED: ['DELIVERED', 'CANCELLED', 'EXPIRED', 'DELIVERY_FAILED'],
  DELIVERED: [
    'ACKNOWLEDGED',
    'EXECUTING',
    'EXECUTED',
    'SUCCEEDED',
    'FAILED',
    'TIMEOUT',
    'EXECUTION_FAILED',
    'DELIVERY_FAILED',
    'EXPIRED',
    'QUEUED' // lease timeout re-queue
  ],
  ACKNOWLEDGED: ['EXECUTING', 'EXECUTED', 'SUCCEEDED', 'FAILED', 'TIMEOUT', 'EXECUTION_FAILED', 'EXPIRED'],
  EXECUTING: ['EXECUTED', 'SUCCEEDED', 'FAILED', 'TIMEOUT', 'EXECUTION_FAILED', 'VERIFYING', 'EXPIRED'],
  EXECUTED: ['VERIFYING', 'VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED', 'ROLLING_BACK', 'ROLLED_BACK'],
  VERIFYING: ['VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED', 'ROLLING_BACK', 'ROLLED_BACK', 'FAILED', 'TIMEOUT', 'EXPIRED'],
  VERIFIED: [],
  VERIFIED_RESOLVED: [],
  REJECTED: [],
  EXPIRED: [],
  DELIVERY_FAILED: [],
  EXECUTION_FAILED: [],
  VERIFICATION_FAILED: ['ROLLING_BACK', 'ROLLED_BACK', 'FAILED'],
  ROLLING_BACK: ['ROLLED_BACK', 'FAILED', 'TIMEOUT'],
  ROLLED_BACK: [],
  TIMEOUT: [],
  CANCELLED: [],
  STALE: [],
  PENDING: ['DELIVERED', 'QUEUED', 'DISPATCHED', 'CANCELLED', 'EXPIRED'],
  SUCCEEDED: ['VERIFYING', 'VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED', 'ROLLING_BACK', 'ROLLED_BACK'],
  FAILED: [],
  ACTION_REJECTED: [],
  ACTION_EXPIRED: [],
  TARGET_NOT_FOUND: [],
  STALE_TARGET: [],
  POLICY_DENIED: [],
  RBAC_DENIED: [],
  VERIFICATION_TIMEOUT: [],
  NO_ROLLBACK_AVAILABLE: [],
  SCALING_NOT_FEASIBLE: [],
  AGENT_UNAVAILABLE: []
};

// Actions that can be executed autonomously under CONTROLLED_AUTONOMOUS mode
export const AUTONOMOUS_ACTION_ALLOWLIST: CanonicalRemediationActionType[] = [
  'RestartPod',
  'RolloutRestart',
  'ReplacePodImage',
  'RollbackDeployment'
];

export function normalizeRemediationMode(mode?: string): 'MANUAL_ONLY' | 'APPROVAL_REQUIRED' | 'CONTROLLED_AUTONOMOUS' {
  const upper = (mode || '').toUpperCase().trim();
  if (upper === 'OFF' || upper === 'MANUAL_ONLY' || upper === 'MANUAL') return 'MANUAL_ONLY';
  if (upper === 'APPROVAL_REQUIRED' || upper === 'APPROVAL') return 'APPROVAL_REQUIRED';
  if (upper === 'AUTONOMOUS' || upper === 'CONTROLLED_AUTONOMOUS' || upper === 'AUTO') return 'CONTROLLED_AUTONOMOUS';
  return 'MANUAL_ONLY';
}

export function extractResourceContainers(liveResource: KubernetesResource): Array<{
  name: string;
  image?: string;
  state?: string;
  ready?: boolean;
  waitingReason?: string;
  waitingMessage?: string;
  terminationReason?: string;
  terminationMessage?: string;
  exitCode?: number;
  restartCount?: number;
}> {
  const map = new Map<string, any>();

  // 1. Base from containers array if present
  if (Array.isArray(liveResource.containers)) {
    for (const c of liveResource.containers) {
      if (c && c.name) {
        map.set(c.name, { ...c });
      }
    }
  }

  // 2. Overlay / populate from specSummary.containers
  const specContainers = Array.isArray((liveResource.specSummary as any)?.containers)
    ? (liveResource.specSummary as any).containers
    : [];
  for (const c of specContainers) {
    if (c && c.name) {
      const existing = map.get(c.name) || { name: c.name };
      map.set(c.name, {
        ...existing,
        image: c.image || existing.image
      });
    }
  }

  // 3. Overlay / populate from statusSummary.containerStates
  const statusStates = Array.isArray((liveResource.statusSummary as any)?.containerStates)
    ? (liveResource.statusSummary as any).containerStates
    : [];
  for (const s of statusStates) {
    if (s && s.name) {
      const existing = map.get(s.name) || { name: s.name };
      const isRunning = s.state === 'running' || s.ready === true;
      const waitingReason = s.waiting?.reason || s.waitingReason || (isRunning ? undefined : existing.waitingReason);
      const waitingMessage = s.waiting?.message || s.waitingMessage || (isRunning ? undefined : existing.waitingMessage);
      const exitCode = s.exitCode !== undefined ? s.exitCode : (isRunning ? 0 : existing.exitCode);
      const terminationReason = s.terminationReason || (isRunning ? undefined : existing.terminationReason);

      map.set(s.name, {
        ...existing,
        image: s.image || existing.image,
        state: s.state || existing.state,
        ready: s.ready ?? existing.ready,
        waitingReason,
        waitingMessage,
        exitCode,
        terminationReason
      });
    }
  }

  return Array.from(map.values());
}

export class RemediationPolicyEngine {
  /**
   * Validates whether a state machine transition is structurally legal.
   */
  public static isValidTransition(current: RemediationActionStatus, next: RemediationActionStatus): boolean {
    if (current === next) return true;
    const allowed = ALLOWED_TRANSITIONS[current] || [];
    return allowed.includes(next);
  }

  /**
   * Asserts valid transition, throwing a descriptive error if illegal.
   */
  public static assertValidTransition(current: RemediationActionStatus, next: RemediationActionStatus, actionId?: string): void {
    if (!this.isValidTransition(current, next)) {
      throw new Error(
        `Illegal remediation state transition: ${current} -> ${next}${actionId ? ` for action ${actionId}` : ''}`
      );
    }
  }

  /**
   * Generates default remediation policy for an organization or cluster.
   */
  public static getDefaultPolicy(orgId: string, clusterId?: string): RemediationPolicy {
    return {
      orgId,
      clusterId,
      remediationMode: 'MANUAL_ONLY', // Default is safe manual approval boundary
      allowedActionTypes: ['RestartPod', 'RolloutRestart', 'RollbackDeployment', 'ReplacePodImage', 'ScaleDeployment'],
      maxRiskLevel: 'LOW',
      requireHighConfidence: true,
      minConfidenceThreshold: 0.85,
      maxAttemptsPerIncident: 3,
      maxActionsPerHourPerCluster: 10,
      telemetryFreshnessThresholdMs: 60 * 1000, // 60 seconds
      actionExpirationMs: 15 * 60 * 1000, // 15 minutes
      leaseTimeoutMs: 2 * 60 * 1000, // 2 minutes lease
      updatedAt: Date.now()
    };
  }

  /**
   * Generates a stable deterministic idempotency key for an action target and proposed mutation.
   */
  public static generateIdempotencyKey(
    clusterId: string,
    namespace: string,
    kind: string,
    name: string,
    container: string,
    fieldPath: string,
    proposedValue: string
  ): string {
    const raw = `${clusterId}:${kind.toLowerCase()}:${namespace.toLowerCase()}:${name.toLowerCase()}:${container.toLowerCase()}:${fieldPath}:${proposedValue}`;
    return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  /**
   * Evaluates an action proposal against the organization/cluster policy.
   */
  public static evaluatePolicy(
    action: RemediationAction,
    incident: Incident,
    policy: RemediationPolicy,
    context: {
      recentClusterActionsCount?: number;
      incidentFailureCount?: number;
      hasActiveTargetLock?: boolean;
      telemetryAgeMs?: number;
      isStandalonePod?: boolean;
    } = {}
  ): {
    allowed: boolean;
    decision: 'ALLOW' | 'DENY' | 'REQUIRES_APPROVAL' | 'CIRCUIT_BREAKER_TRIPPED' | 'RATE_LIMITED' | 'TARGET_BUSY' | 'STALE_TELEMETRY' | 'CONTROLLER_OWNED';
    reason: string;
  } {
    const failureCount = context.incidentFailureCount ?? 0;
    const hasLock = context.hasActiveTargetLock ?? false;
    const recentActions = context.recentClusterActionsCount ?? 0;
    const isStandalone = context.isStandalonePod ?? true;
    const telemetryAge = context.telemetryAgeMs ?? 0;
    const actionType = (action.actionType || action.type) as CanonicalRemediationActionType;

    // 1. Permanent Safety Invariant: Scale-to-zero is forbidden autonomously
    if (actionType === 'ScaleDeployment') {
      const val = parseInt(action.proposedValue || '0', 10);
      if (val <= 0) {
        return {
          allowed: false,
          decision: 'DENY',
          reason: 'Scale-to-zero is permanently prohibited by SkyOps safety policy.'
        };
      }
    }

    // 2. Circuit breaker: max failed attempts on this incident
    if (failureCount >= policy.maxAttemptsPerIncident) {
      return {
        allowed: false,
        decision: 'CIRCUIT_BREAKER_TRIPPED',
        reason: `Circuit breaker tripped: incident ${incident.id} exceeded maximum remediation failure threshold (${failureCount}/${policy.maxAttemptsPerIncident}). Operator manual investigation required.`
      };
    }

    // 3. Concurrency lock on the same target
    if (hasLock) {
      return {
        allowed: false,
        decision: 'TARGET_BUSY',
        reason: `Target ${action.target.kind} ${action.target.namespace}/${action.target.name}:${action.target.container || 'main'} already has an active remediation in progress.`
      };
    }

    // 4. Cluster rate limiting
    if (recentActions >= policy.maxActionsPerHourPerCluster) {
      return {
        allowed: false,
        decision: 'RATE_LIMITED',
        reason: `Cluster hourly remediation rate limit reached (${recentActions}/${policy.maxActionsPerHourPerCluster} actions in the past hour).`
      };
    }

    // 5. Ephemeral Pod direct mutation restriction
    // Only ReplacePodImage targeting an ephemeral Pod directly without owner Deployment is blocked if controller-owned
    if (actionType === 'ReplacePodImage' && action.target.kind.toLowerCase() === 'pod' && !isStandalone) {
      return {
        allowed: false,
        decision: 'CONTROLLER_OWNED',
        reason: `Target ${action.target.kind} is managed by a Kubernetes controller. Direct mutation of ephemeral pods is forbidden; target the parent Deployment workload instead.`
      };
    }

    // 6. Action type allowlist check in policy
    if (!policy.allowedActionTypes.includes(actionType) && !policy.allowedActionTypes.includes(action.type)) {
      return {
        allowed: false,
        decision: 'DENY',
        reason: `Action type "${actionType}" is not allowed by organization remediation policy.`
      };
    }

    // 7. Allowed namespaces
    if (policy.allowedNamespaces && policy.allowedNamespaces.length > 0) {
      if (!policy.allowedNamespaces.includes(action.target.namespace)) {
        return {
          allowed: false,
          decision: 'DENY',
          reason: `Namespace "${action.target.namespace}" is excluded from automated remediation.`
        };
      }
    }

    // 8. Telemetry Freshness check
    if (telemetryAge > policy.telemetryFreshnessThresholdMs) {
      return {
        allowed: false,
        decision: 'STALE_TELEMETRY',
        reason: `Authoritative cluster telemetry is stale (${Math.round(telemetryAge / 1000)}s old > threshold ${policy.telemetryFreshnessThresholdMs / 1000}s). Remediation cannot proceed without fresh live telemetry.`
      };
    }

    // 9. Proposed value grounding check
    if (actionType === 'ReplacePodImage') {
      if (!action.proposedValue || action.proposedValue.trim() === '' || action.proposedValue === 'unknown') {
        return {
          allowed: false,
          decision: 'DENY',
          reason: 'Proposed image is empty or ungrounded. SkyOps refuses to execute ungrounded image tags.'
        };
      }
    }

    // 10. Per-incident override: if operator disabled auto-healing for this specific incident
    if (incident.autoHealingDisabled) {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: 'Auto-Healing is explicitly disabled by an operator for this specific incident.'
      };
    }

    // 11. Remediation mode check
    const normalizedMode = normalizeRemediationMode(policy.remediationMode);
    if (normalizedMode === 'MANUAL_ONLY') {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: 'Cluster auto-healing policy is OFF. Manual operator action is required.'
      };
    }

    if (normalizedMode === 'APPROVAL_REQUIRED') {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: 'Cluster auto-healing policy requires operator approval before executing any changes.'
      };
    }

    // 12. CONTROLLED_AUTONOMOUS mode checks
    // ScaleDeployment is never executed autonomously without approval
    if (!AUTONOMOUS_ACTION_ALLOWLIST.includes(actionType)) {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: `Action type "${actionType}" is not permitted for autonomous auto-healing; operator review required.`
      };
    }

    if (policy.lowRiskOnly && action.riskLevel !== 'LOW') {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: `Cluster policy restricts autonomous execution to LOW-RISK actions only (action risk: ${action.riskLevel}).`
      };
    }

    // Enforce risk ceiling
    const riskRanks: Record<AIRiskLevel, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    if (riskRanks[action.riskLevel] > riskRanks[policy.maxRiskLevel]) {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: `Action risk (${action.riskLevel}) exceeds autonomous policy ceiling (${policy.maxRiskLevel}); human approval required.`
      };
    }

    // Enforce confidence threshold if required
    const rawConfidence = incident.confidence || (incident.technicalDetails as any)?.confidence;
    const confidenceScore = incident.intelligence?.primaryHypothesis?.score ?? (rawConfidence === 'HIGH' ? 90 : rawConfidence === 'MEDIUM' ? 70 : rawConfidence === 'LOW' ? 40 : 85);
    const threshold = policy.minConfidenceThreshold > 1 ? policy.minConfidenceThreshold : policy.minConfidenceThreshold * 100;
    if (policy.requireHighConfidence && confidenceScore < threshold) {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: `Root cause confidence (${confidenceScore}/100) is below autonomous threshold (${Math.round(threshold)}/100). Operator review required.`
      };
    }

    return {
      allowed: true,
      decision: 'ALLOW',
      reason: 'All safety policy criteria satisfied for controlled autonomous dispatch.'
    };
  }

  /**
   * Revalidates an action immediately before approval or dispatch.
   * Ensures cluster state has not shifted underneath the proposal.
   */
  public static revalidateAction(
    action: RemediationAction,
    incident: Incident,
    liveResource: KubernetesResource | null,
    telemetryAgeMs: number,
    policy: RemediationPolicy
  ): { valid: boolean; reason?: string; errorCategory?: 'TARGET_NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONTROLLER_OWNED' | 'STALE' | 'EXPIRED' | 'STALE_TARGET' | 'NO_ROLLBACK_AVAILABLE' | 'SCALING_NOT_FEASIBLE' } {
    const now = Date.now();
    const actionType = (action.actionType || action.type) as CanonicalRemediationActionType;

    // Check expiration
    if (action.expiresAt && now > action.expiresAt) {
      return { valid: false, reason: 'Remediation action proposal has expired', errorCategory: 'EXPIRED' };
    }

    // Check incident status
    if (incident.status === 'RESOLVED' || incident.status === 'CLOSED') {
      return { valid: false, reason: 'Incident is already resolved or closed', errorCategory: 'STALE' };
    }

    // Check cluster identity
    if (action.clusterId && incident.clusterId && action.clusterId !== incident.clusterId) {
      return {
        valid: false,
        reason: `Cluster identity mismatch: action cluster "${action.clusterId}" does not match incident cluster "${incident.clusterId}"`,
        errorCategory: 'PRECONDITION_FAILED'
      };
    }

    // Check protected namespace
    const protectedNamespaces = ['kube-system', 'kube-public', 'kube-node-lease', 'skyops'];
    if (protectedNamespaces.includes((action.target.namespace || '').toLowerCase())) {
      return {
        valid: false,
        reason: `Namespace "${action.target.namespace}" is protected against automated remediation`,
        errorCategory: 'PRECONDITION_FAILED'
      };
    }

    // Check target exists
    if (!liveResource) {
      return {
        valid: false,
        reason: `Target ${action.target.kind} ${action.target.namespace}/${action.target.name} no longer exists in cluster telemetry`,
        errorCategory: 'TARGET_NOT_FOUND'
      };
    }

    // Check target UID where available
    if (action.target.uid && liveResource.uid && action.target.uid !== liveResource.uid) {
      return {
        valid: false,
        reason: `Target UID changed (expected ${action.target.uid}, got ${liveResource.uid}). Stale action rejected.`,
        errorCategory: 'PRECONDITION_FAILED'
      };
    }

    // Check controller ownership and target kind for Pod image mutations
    if (actionType === 'ReplacePodImage') {
      if (action.target.kind.toLowerCase() !== 'pod') {
        return {
          valid: false,
          reason: `Only Pods can be mutated safely by direct container image replacement (got ${action.target.kind})`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
      if (liveResource.ownerReferences && liveResource.ownerReferences.length > 0) {
        return {
          valid: false,
          reason: `Target ${action.target.kind} is controller-managed by ${liveResource.ownerReferences.map((o) => `${o.kind}/${o.name}`).join(', ')}. Direct pod mutation is prohibited; target the parent workload instead.`,
          errorCategory: 'CONTROLLER_OWNED'
        };
      }
    }

    // Target UID validation (recreated resource check)
    if (action.target.uid && liveResource.uid && action.target.uid !== liveResource.uid) {
      return {
        valid: false,
        reason: `STALE_TARGET: Target resource UID has changed (expected ${action.target.uid}, live ${liveResource.uid}). Workload was recreated after incident detection.`,
        errorCategory: 'STALE_TARGET'
      };
    }

    // ResourceVersion protection (Section 19: stale target check)
    if (action.targetResourceVersion && liveResource.resourceVersion && action.targetResourceVersion !== liveResource.resourceVersion) {
      return {
        valid: false,
        reason: `STALE_TARGET: ResourceVersion changed from ${action.targetResourceVersion} to ${liveResource.resourceVersion}. Workload was modified after incident detection.`,
        errorCategory: 'STALE_TARGET'
      };
    }

    // Workload kind validations
    if (actionType === 'RestartPod') {
      if (action.target.kind.toLowerCase() !== 'pod' && action.target.kind.toLowerCase() !== 'deployment') {
        return {
          valid: false,
          reason: `RestartPod target kind must be Pod or Deployment (got ${action.target.kind})`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
    } else if (actionType === 'RolloutRestart') {
      const allowedKinds = ['deployment', 'statefulset', 'daemonset'];
      if (!allowedKinds.includes(action.target.kind.toLowerCase())) {
        return {
          valid: false,
          reason: `RolloutRestart target kind must be Deployment, StatefulSet, or DaemonSet (got ${action.target.kind})`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
    } else if (actionType === 'RollbackDeployment') {
      if (action.target.kind.toLowerCase() !== 'deployment') {
        return {
          valid: false,
          reason: `RollbackDeployment target kind must be Deployment (got ${action.target.kind})`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
      const currentRevStr = liveResource.annotations?.['deployment.kubernetes.io/revision'] || (liveResource.statusSummary as any)?.revision;
      const currentRev = currentRevStr ? parseInt(currentRevStr, 10) : 0;
      if (currentRev === 1) {
        return {
          valid: false,
          reason: 'NO_ROLLBACK_AVAILABLE: Deployment is currently at revision 1. No previous revision exists in history.',
          errorCategory: 'NO_ROLLBACK_AVAILABLE'
        };
      }
    } else if (actionType === 'ScaleDeployment') {
      const targetReplicas = parseInt(action.proposedValue || '1', 10);
      if (Number.isNaN(targetReplicas) || targetReplicas < 1 || targetReplicas > 20) {
        return {
          valid: false,
          reason: `Cannot scale deployment: Target replicas must be between 1 and 20 (got ${targetReplicas}).`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
    }

    // Check expected state precondition
    if (actionType === 'ReplacePodImage') {
      const containers = extractResourceContainers(liveResource);
      const container = containers.find((c) => c.name === action.target.container);
      if (!container) {
        return {
          valid: false,
          reason: `Target container "${action.target.container}" not found in live workload spec`,
          errorCategory: 'TARGET_NOT_FOUND'
        };
      }
      if (action.expectedCurrentValue && container.image !== action.expectedCurrentValue) {
        return {
          valid: false,
          reason: `Live container image ("${container.image}") does not match expected current value ("${action.expectedCurrentValue}"). State has changed since proposal.`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
    } else if (actionType === 'ScaleDeployment') {
      const liveReplicas = liveResource.statusSummary?.replicas ?? (liveResource as any).spec?.replicas;
      if (action.expectedCurrentValue && liveReplicas !== undefined && String(liveReplicas) !== action.expectedCurrentValue) {
        return {
          valid: false,
          reason: `Live deployment replicas ("${liveReplicas}") do not match expected current value ("${action.expectedCurrentValue}").`,
          errorCategory: 'PRECONDITION_FAILED'
        };
      }
    }

    // Check telemetry freshness
    if (telemetryAgeMs > policy.telemetryFreshnessThresholdMs * 2) {
      return {
        valid: false,
        reason: `Cluster telemetry is too stale (${Math.round(telemetryAgeMs / 1000)}s) to safely verify live state preconditions`,
        errorCategory: 'STALE'
      };
    }

    return { valid: true };
  }

  /**
   * Evaluates fresh telemetry to determine whether an executed action is verified or failing.
   */
  public static verifyTelemetry(
    action: RemediationAction,
    liveResource: KubernetesResource | null,
    now = Date.now()
  ): {
    status: 'VERIFIED' | 'VERIFYING' | 'VERIFICATION_FAILED';
    observedState: string;
    evidence: string[];
    failureReason?: string;
  } {
    if (!liveResource) {
      return {
        status: 'VERIFICATION_FAILED',
        observedState: 'Target resource disappeared from Kubernetes cluster',
        evidence: ['Target resource was deleted or not reported in fresh telemetry snapshot'],
        failureReason: 'Target resource deleted during verification'
      };
    }

    const actionType = (action.actionType || action.type) as CanonicalRemediationActionType;

    // Authoritative verification MUST be grounded in telemetry observed AFTER action completion
    const completedAt = action.completedAt || action.approvedAt || 0;
    if (liveResource.updatedAt <= completedAt) {
      return {
        status: 'VERIFYING',
        observedState: 'Awaiting fresh telemetry scrape observed after mutation completion',
        evidence: [
          `Resource observation timestamp (${new Date(liveResource.updatedAt).toISOString()}) is prior to or equal to action execution completion (${new Date(completedAt).toISOString()})`
        ]
      };
    }

    // --- Action-specific Verification Logic ---

    // 1. RestartPod
    if (actionType === 'RestartPod') {
      const isPod = liveResource.kind.toLowerCase() === 'pod';
      const isRunning = liveResource.status === 'Running';
      const isHealthy = liveResource.health === 'HEALTHY' || (liveResource.readyReplicas !== undefined && liveResource.readyReplicas > 0);

      // Check container ready states
      const containers = extractResourceContainers(liveResource);
      const hasErrors = containers.some((c) =>
        c.waitingReason === 'CrashLoopBackOff' ||
        c.waitingReason === 'ImagePullBackOff' ||
        c.waitingReason === 'ErrImagePull' ||
        (c.state === 'waiting' && (c.restartCount || 0) > 10)
      );

      if (hasErrors) {
        const elapsedMs = now - completedAt;
        const timeoutMs = (action.verificationPlan?.timeoutSeconds || 300) * 1000;
        if (elapsedMs > timeoutMs) {
          return {
            status: 'VERIFICATION_FAILED',
            observedState: 'Pod restarted but persistent error state detected',
            evidence: ['Containers entered CrashLoopBackOff or waiting state after restart'],
            failureReason: 'Restart failed to clear persistent error condition'
          };
        }
        return {
          status: 'VERIFYING',
          observedState: 'Pod restarted; observing container readiness...',
          evidence: ['Containers restarting']
        };
      }

      // If action targeted a specific pod UID, ensure the live resource is the new replacement pod or healthy controller
      if (isPod && action.target.uid && liveResource.uid === action.target.uid && liveResource.status !== 'Running') {
        return {
          status: 'VERIFYING',
          observedState: 'Awaiting termination of old pod and scheduling of replacement pod',
          evidence: [`Old pod UID ${action.target.uid} still present in cluster telemetry`]
        };
      }

      if ((isPod && isRunning && containers.length > 0 && containers.every((c) => c.ready)) || (!isPod && isHealthy)) {
        return {
          status: 'VERIFIED',
          observedState: `Workload ${liveResource.name} is Running & Ready after pod recreation`,
          evidence: [
            'All containers passed readiness probes',
            'Zero active restart loops detected',
            'Target phase is Running'
          ]
        };
      }

      return {
        status: 'VERIFYING',
        observedState: 'Waiting for pod containers to pass readiness probes',
        evidence: [`Current status: ${liveResource.status}`]
      };
    }

    // 2. RolloutRestart and RollbackDeployment
    if (actionType === 'RolloutRestart' || actionType === 'RollbackDeployment') {
      const specReplicas = liveResource.specReplicas ?? (liveResource as any).spec?.replicas ?? 1;
      const readyReplicas = liveResource.readyReplicas ?? (liveResource as any).status?.readyReplicas ?? 0;
      const availableReplicas = liveResource.availableReplicas ?? (liveResource as any).status?.availableReplicas ?? readyReplicas;
      const updatedReplicas = (liveResource as any).status?.updatedReplicas ?? readyReplicas;
      const unavailableReplicas = (liveResource as any).status?.unavailableReplicas ?? 0;

      // Check for roll-out failure conditions in containers
      const containers = liveResource.containers || [];
      const hasCrash = containers.some((c) => c.waitingReason === 'CrashLoopBackOff' || c.waitingReason === 'ImagePullBackOff');

      if (hasCrash) {
        const elapsedMs = now - completedAt;
        const timeoutMs = (action.verificationPlan?.timeoutSeconds || 300) * 1000;
        if (elapsedMs > timeoutMs) {
          return {
            status: 'VERIFICATION_FAILED',
            observedState: `Rollout verification failed: container error detected during rollout`,
            evidence: ['Container in new rollout entered error state'],
            failureReason: 'Rollout failed: containers entered crash loop or pull error'
          };
        }
        return {
          status: 'VERIFYING',
          observedState: 'Observing rollout progress across pods...',
          evidence: ['Waiting on container readiness']
        };
      }

      if (readyReplicas >= specReplicas && availableReplicas >= specReplicas && updatedReplicas >= specReplicas && unavailableReplicas === 0) {
        return {
          status: 'VERIFIED',
          observedState: `Rollout complete: ${readyReplicas}/${specReplicas} replicas available with 0 unavailable`,
          evidence: [
            `Updated replicas reached desired count (${readyReplicas}/${specReplicas})`,
            'Zero unavailable replicas reported in fresh telemetry',
            'All pods Ready=True'
          ]
        };
      }

      return {
        status: 'VERIFYING',
        observedState: `Rollout in progress: ${readyReplicas}/${specReplicas} replicas ready`,
        evidence: [`Available: ${availableReplicas}, Desired: ${specReplicas}`]
      };
    }

    // 3. ScaleDeployment
    if (actionType === 'ScaleDeployment') {
      const targetReplicas = parseInt(action.proposedValue || '1', 10);
      const specReplicas = liveResource.specReplicas ?? (liveResource as any).spec?.replicas ?? targetReplicas;
      const readyReplicas = liveResource.readyReplicas ?? (liveResource as any).status?.readyReplicas ?? 0;
      const availableReplicas = liveResource.availableReplicas ?? (liveResource as any).status?.availableReplicas ?? readyReplicas;
      const updatedReplicas = (liveResource as any).status?.updatedReplicas ?? readyReplicas;
      const unavailableReplicas = (liveResource as any).status?.unavailableReplicas ?? 0;

      if (
        specReplicas === targetReplicas &&
        updatedReplicas === targetReplicas &&
        readyReplicas === targetReplicas &&
        availableReplicas === targetReplicas &&
        unavailableReplicas === 0
      ) {
        return {
          status: 'VERIFIED',
          observedState: `Deployment scaled successfully to ${availableReplicas} available replicas (desired=${specReplicas}, ready=${readyReplicas})`,
          evidence: [
            `Target replicas matches desired count (${targetReplicas})`,
            `Updated replicas (${updatedReplicas}) and ready replicas (${readyReplicas}) match target`,
            'Zero unavailable replicas reported in fresh telemetry'
          ]
        };
      }
      return {
        status: 'VERIFYING',
        observedState: `Scaling deployment: ${availableReplicas}/${targetReplicas} replicas available (ready: ${readyReplicas}, updated: ${updatedReplicas})`,
        evidence: [`Current available: ${availableReplicas}, ready: ${readyReplicas}, target: ${targetReplicas}`]
      };
    }

    // 4. ReplacePodImage
    const containers = extractResourceContainers(liveResource);
    const container = containers.find((c) => c.name === action.target.container);
    if (!container) {
      return {
        status: 'VERIFICATION_FAILED',
        observedState: `Target container "${action.target.container}" missing from updated workload`,
        evidence: ['Container not found in fresh live workload spec'],
        failureReason: 'Target container not found'
      };
    }

    // Did the image actually update to proposedValue?
    if (container.image !== action.proposedValue) {
      return {
        status: 'VERIFYING',
        observedState: `Container image is ${container.image} (expected ${action.proposedValue})`,
        evidence: [`Current image "${container.image}" does not match proposed target image "${action.proposedValue}"`]
      };
    }

    // Negative Verification: Check for image pull errors or crash loops
    const waitingReason = container.waitingReason || '';
    const termReason = container.terminationReason || '';
    const hasImagePullError =
      waitingReason === 'ImagePullBackOff' ||
      waitingReason === 'ErrImagePull' ||
      /imagepull|errimagepull/i.test(waitingReason) ||
      /imagepull|errimagepull/i.test(container.waitingMessage || '');

    const hasCrashLoop =
      waitingReason === 'CrashLoopBackOff' ||
      termReason === 'Error' ||
      (container.exitCode !== undefined && container.exitCode !== 0);

    if (hasImagePullError || hasCrashLoop) {
      return {
        status: 'VERIFICATION_FAILED',
        observedState: `Negative verification triggered: container entered failure condition ${waitingReason || termReason || 'Error'}`,
        evidence: [
          `Container state is waiting with reason "${waitingReason || termReason}"`,
          `Message: "${container.waitingMessage || container.terminationMessage || 'Exit code ' + container.exitCode}"`
        ],
        failureReason: `Negative verification: Container entered failure condition "${waitingReason || termReason}"`
      };
    }

    // Deployment-specific rollout health check
    if (liveResource.kind.toLowerCase() === 'deployment') {
      const specReplicas = liveResource.specReplicas ?? (liveResource as any).spec?.replicas ?? 1;
      const readyReplicas = liveResource.readyReplicas ?? (liveResource as any).status?.readyReplicas ?? 0;
      const availableReplicas = liveResource.availableReplicas ?? (liveResource as any).status?.availableReplicas ?? readyReplicas;
      const updatedReplicas = (liveResource as any).status?.updatedReplicas ?? readyReplicas;
      const unavailableReplicas = (liveResource as any).status?.unavailableReplicas ?? 0;

      if (readyReplicas >= specReplicas && availableReplicas >= specReplicas && updatedReplicas >= specReplicas && unavailableReplicas === 0) {
        return {
          status: 'VERIFIED',
          observedState: `Deployment rollout verified: container "${container.name}" running verified image "${container.image}" with ${availableReplicas}/${specReplicas} replicas ready`,
          evidence: [
            `Container image verified as "${action.proposedValue}"`,
            `Rollout completed: updated=${updatedReplicas}, ready=${readyReplicas}, available=${availableReplicas}`,
            'Zero unavailable replicas in fresh telemetry'
          ]
        };
      }

      return {
        status: 'VERIFYING',
        observedState: `Deployment image updated to "${action.proposedValue}"; rollout in progress (${availableReplicas}/${specReplicas} ready)...`,
        evidence: [`Updated replicas: ${updatedReplicas}/${specReplicas}, available: ${availableReplicas}/${specReplicas}`]
      };
    }

    // Positive Verification for Pod: Container is running and ready, Pod is healthy
    const isRunning = container.state === 'running' || liveResource.status === 'Running';
    const isReady = container.ready === true;

    if (isRunning && isReady) {
      return {
        status: 'VERIFIED',
        observedState: `Workload is Running and container "${container.name}" is Ready with verified image "${container.image}"`,
        evidence: [
          `Authoritative telemetry confirms container image matches proposed "${action.proposedValue}"`,
          `Container status is running and ready probe passing`,
          `Zero active error events or restart loops detected`
        ]
      };
    }

    // If running but not ready yet, still verifying
    return {
      status: 'VERIFYING',
      observedState: `Container image updated to ${container.image}; awaiting container readiness probe pass`,
      evidence: [`Container state: ${container.state}`, `Ready: ${container.ready}`]
    };
  }
}
