import crypto from 'crypto';
import {
  RemediationAction,
  RemediationActionStatus,
  RemediationPolicy,
  RemediationMode,
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
  DISPATCHED: ['QUEUED', 'DELIVERED', 'EXECUTED', 'SUCCEEDED', 'FAILED', 'EXECUTION_FAILED', 'CANCELLED', 'EXPIRED'],
  QUEUED: ['DELIVERED', 'CANCELLED', 'EXPIRED', 'DELIVERY_FAILED'],
  DELIVERED: [
    'ACKNOWLEDGED',
    'EXECUTING',
    'EXECUTED',
    'SUCCEEDED',
    'FAILED',
    'EXECUTION_FAILED',
    'DELIVERY_FAILED',
    'EXPIRED',
    'QUEUED' // lease timeout re-queue
  ],
  ACKNOWLEDGED: ['EXECUTING', 'EXECUTED', 'SUCCEEDED', 'FAILED', 'EXECUTION_FAILED', 'EXPIRED'],
  EXECUTING: ['EXECUTED', 'SUCCEEDED', 'FAILED', 'EXECUTION_FAILED', 'EXPIRED'],
  EXECUTED: ['VERIFYING', 'VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED'],
  VERIFYING: ['VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED', 'EXPIRED'],
  VERIFIED: [],
  VERIFIED_RESOLVED: [],
  REJECTED: [],
  EXPIRED: [],
  DELIVERY_FAILED: [],
  EXECUTION_FAILED: [],
  VERIFICATION_FAILED: [],
  CANCELLED: [],
  STALE: [],
  PENDING: ['DELIVERED', 'QUEUED', 'DISPATCHED', 'CANCELLED', 'EXPIRED'],
  SUCCEEDED: ['VERIFYING', 'VERIFIED', 'VERIFIED_RESOLVED', 'VERIFICATION_FAILED'],
  FAILED: []
};

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
      allowedActionTypes: ['ReplacePodImage'],
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

    // 1. Circuit breaker: max failed attempts on this incident
    if (failureCount >= policy.maxAttemptsPerIncident) {
      return {
        allowed: false,
        decision: 'CIRCUIT_BREAKER_TRIPPED',
        reason: `Circuit breaker tripped: incident ${incident.id} exceeded maximum remediation failure threshold (${failureCount}/${policy.maxAttemptsPerIncident}). Operator manual investigation required.`
      };
    }

    // 2. Concurrency lock on the same target
    if (hasLock) {
      return {
        allowed: false,
        decision: 'TARGET_BUSY',
        reason: `Target ${action.target.kind} ${action.target.namespace}/${action.target.name}:${action.target.container} already has an active remediation in progress.`
      };
    }

    // 3. Cluster rate limiting
    if (recentActions >= policy.maxActionsPerHourPerCluster) {
      return {
        allowed: false,
        decision: 'RATE_LIMITED',
        reason: `Cluster hourly remediation rate limit reached (${recentActions}/${policy.maxActionsPerHourPerCluster} actions in the past hour).`
      };
    }

    // 4. Controller-managed resource check
    if (!isStandalone) {
      return {
        allowed: false,
        decision: 'CONTROLLER_OWNED',
        reason: `Target ${action.target.kind} is managed by a Kubernetes controller (Deployment/StatefulSet/DaemonSet/ReplicaSet). Ephemeral pods must not be directly mutated; update the owning workload specification instead.`
      };
    }

    // 5. Action type allowlist
    if (!policy.allowedActionTypes.includes(action.type) && !policy.allowedActionTypes.includes(action.actionType)) {
      return {
        allowed: false,
        decision: 'DENY',
        reason: `Action type "${action.actionType || action.type}" is not allowed by organization remediation policy.`
      };
    }

    // 6. Allowed namespaces
    if (policy.allowedNamespaces && policy.allowedNamespaces.length > 0) {
      if (!policy.allowedNamespaces.includes(action.target.namespace)) {
        return {
          allowed: false,
          decision: 'DENY',
          reason: `Namespace "${action.target.namespace}" is excluded from automated remediation.`
        };
      }
    }

    // 7. Telemetry Freshness check
    if (telemetryAge > policy.telemetryFreshnessThresholdMs) {
      return {
        allowed: false,
        decision: 'STALE_TELEMETRY',
        reason: `Authoritative cluster telemetry is stale (${Math.round(telemetryAge / 1000)}s old > threshold ${policy.telemetryFreshnessThresholdMs / 1000}s). Remediation cannot proceed without fresh live telemetry.`
      };
    }

    // 8. Grounding check: Proposed image must be grounded
    if (!action.proposedValue || action.proposedValue.trim() === '' || action.proposedValue === 'unknown') {
      return {
        allowed: false,
        decision: 'DENY',
        reason: 'Proposed image is empty or ungrounded. SkyOps refuses to execute ungrounded image tags.'
      };
    }

    // 9. Remediation mode check
    if (policy.remediationMode === 'MANUAL_ONLY') {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: 'Organization policy requires explicit human operator authorization for all remediation actions.'
      };
    }

    if (policy.remediationMode === 'APPROVAL_REQUIRED') {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: 'Policy mode is APPROVAL_REQUIRED; human confirmation is mandatory.'
      };
    }

    // CONTROLLED_AUTONOMOUS mode
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
    if (policy.requireHighConfidence && confidenceScore < policy.minConfidenceThreshold * 100) {
      return {
        allowed: false,
        decision: 'REQUIRES_APPROVAL',
        reason: `Root cause confidence (${confidenceScore}/100) is below autonomous threshold (${Math.round(policy.minConfidenceThreshold * 100)}/100). Operator review required.`
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
  ): { valid: boolean; reason?: string; errorCategory?: 'TARGET_NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONTROLLER_OWNED' | 'STALE' | 'EXPIRED' } {
    const now = Date.now();

    // Check expiration
    if (action.expiresAt && now > action.expiresAt) {
      return { valid: false, reason: 'Remediation action proposal has expired', errorCategory: 'EXPIRED' };
    }

    // Check incident status
    if (incident.status === 'RESOLVED' || incident.status === 'CLOSED') {
      return { valid: false, reason: 'Incident is already resolved or closed', errorCategory: 'STALE' };
    }

    // Check target exists
    if (!liveResource) {
      return {
        valid: false,
        reason: `Target ${action.target.kind} ${action.target.namespace}/${action.target.name} no longer exists in cluster telemetry`,
        errorCategory: 'TARGET_NOT_FOUND'
      };
    }

    // Check controller ownership
    if (liveResource.ownerReferences && liveResource.ownerReferences.length > 0) {
      return {
        valid: false,
        reason: `Target ${action.target.kind} is controller-managed by ${liveResource.ownerReferences.map((o) => `${o.kind}/${o.name}`).join(', ')}. Ephemeral pod cannot be directly mutated.`,
        errorCategory: 'CONTROLLER_OWNED'
      };
    }

    // Check expected state precondition
    if (action.type === 'ReplacePodImage') {
      const container = (liveResource.containers || []).find((c) => c.name === action.target.container);
      if (!container) {
        return {
          valid: false,
          reason: `Target container "${action.target.container}" not found in live pod spec`,
          errorCategory: 'TARGET_NOT_FOUND'
        };
      }
      if (container.image !== action.expectedCurrentValue) {
        return {
          valid: false,
          reason: `Live container image ("${container.image}") does not match expected current value ("${action.expectedCurrentValue}"). State has changed since proposal.`,
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

    // Authoritative verification MUST be grounded in telemetry observed AFTER action completion
    const completedAt = action.completedAt || action.approvedAt;
    if (liveResource.updatedAt <= completedAt) {
      return {
        status: 'VERIFYING',
        observedState: 'Awaiting fresh telemetry scrape observed after mutation completion',
        evidence: [
          `Resource observation timestamp (${new Date(liveResource.updatedAt).toISOString()}) is prior to or equal to action execution completion (${new Date(completedAt).toISOString()})`
        ]
      };
    }

    const container = (liveResource.containers || []).find((c) => c.name === action.target.container);
    if (!container) {
      return {
        status: 'VERIFICATION_FAILED',
        observedState: `Target container "${action.target.container}" missing from updated Pod`,
        evidence: ['Container not found in fresh live pod spec'],
        failureReason: 'Target container not found'
      };
    }

    // 1. Did the image actually update to proposedValue?
    if (container.image !== action.proposedValue) {
      return {
        status: 'VERIFYING',
        observedState: `Container image is ${container.image} (expected ${action.proposedValue})`,
        evidence: [`Current image "${container.image}" does not match proposed target image "${action.proposedValue}"`]
      };
    }

    // 2. Negative Verification: Check for image pull errors or crash loops
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
      const elapsedMs = now - completedAt;
      const timeoutMs = (action.verificationPlan?.timeoutSeconds || 300) * 1000;

      if (elapsedMs > timeoutMs) {
        return {
          status: 'VERIFICATION_FAILED',
          observedState: `Negative verification triggered: container entered failure condition ${waitingReason || termReason || 'Error'}`,
          evidence: [
            `Container state is waiting with reason "${waitingReason || termReason}"`,
            `Message: "${container.waitingMessage || container.terminationMessage || 'Exit code ' + container.exitCode}"`,
            `Verification timed out after ${Math.round(elapsedMs / 1000)}s`
          ],
          failureReason: `Negative verification: Container entered failure condition "${waitingReason || termReason}"`
        };
      }

      return {
        status: 'VERIFYING',
        observedState: `Observing failure condition (${waitingReason || termReason}); checking for transient resolution...`,
        evidence: [`Waiting reason: ${waitingReason}`, `Waiting message: ${container.waitingMessage}`]
      };
    }

    // 3. Positive Verification: Container is running and ready, Pod is healthy
    const isRunning = container.state === 'running' || liveResource.status === 'Running';
    const isReady = container.ready === true;

    if (isRunning && isReady) {
      return {
        status: 'VERIFIED',
        observedState: `Pod is Running and container "${container.name}" is Ready with verified image "${container.image}"`,
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
