import {
  AIChangePreview,
  AIEvidenceCategory,
  AIEvidenceItem,
  AIRemediationActionType,
  AIRiskLevel,
  AIVerificationCriteria,
  IncidentContext,
  SkyOpsAIAnalysis,
  StructuredRemediation
} from './types';

// Actions that inherently carry high or critical operational risk in Kubernetes
export const HIGH_RISK_KEYWORDS = [
  'delete pod',
  'delete deployment',
  'delete namespace',
  'delete pvc',
  'delete pv',
  'delete service',
  'delete node',
  'drain node',
  'cordon node',
  'restart node',
  'reboot',
  'scale --replicas=0',
  'scale to 0',
  'drop database',
  'rm -rf',
  'force delete',
  '--grace-period=0',
  'clusterrole',
  'clusterrolebinding',
  'wipe'
];

export const MEDIUM_RISK_KEYWORDS = [
  'kubectl edit',
  'rollout restart',
  'patch deployment',
  'scale deployment',
  'increase memory',
  'increase cpu',
  'change storageclass',
  'modify secret',
  'modify configmap'
];

const VALID_RISK_LEVELS = new Set<AIRiskLevel>(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const VALID_EVIDENCE_CATEGORIES = new Set<AIEvidenceCategory>(['OBSERVED_FACT', 'AI_INFERENCE', 'PROPOSED_CHANGE']);

export interface SafetyValidationResult {
  validatedAnalysis: SkyOpsAIAnalysis;
  safetyViolations: string[];
  enforcedRequiresApproval: boolean;
}

/**
 * Deterministic Safety Policy Engine (outside the LLM)
 *
 * Authoritative Remediation Autonomy Policy:
 * 1. MANUAL_ONLY: All remediations require explicit manual operator initiation.
 * 2. APPROVAL_REQUIRED: Remediations proposed by AI/intelligence engine mandate human operator sign-off before dispatch.
 * 3. CONTROLLED_AUTONOMOUS: Only allowlisted, low-risk, deterministic actions (e.g. ReplacePodImage on standalone
 *    pods with verified target image, high confidence, fresh telemetry, and valid target lease) may execute
 *    autonomously within strict rate limits. All other actions require human approval.
 *
 * Universal Safety Invariants (enforced across ALL modes):
 * - Under NO circumstances does the platform allow arbitrary shell commands, arbitrary kubectl execution,
 *   scripts, or unrestricted Kubernetes exec.
 * - High-risk operations (deletions, node drains, scale-to-zero, RBAC modifications) are permanently forbidden
 *   from autonomous execution and strictly require human authorization.
 * - Confidence intervals are normalized and clamped between 0.0 and 1.0.
 * - Evidence is categorized into OBSERVED_FACT, AI_INFERENCE, and PROPOSED_CHANGE.
 * - Change preview is exact (resource -> namespace -> object -> container -> field -> current -> proposed).
 * - Authoritative Kubernetes verification criteria (pod recreation, container readiness, error absence) are mandatory.
 */
export class SafetyPolicyEngine {
  /**
   * Evaluates raw AI analysis against deterministic safety rules and returns a secured analysis.
   */
  public static validateAndEnforce(
    raw: Partial<SkyOpsAIAnalysis> | null | undefined,
    incidentId: string,
    context?: Partial<IncidentContext>
  ): SkyOpsAIAnalysis {
    const rawSafe = raw && typeof raw === 'object' ? raw : {};
    const safetyViolations: string[] = [];

    const fixDesc = (rawSafe.recommendedFix?.description || '').toLowerCase();
    const fixReason = (rawSafe.recommendedFix?.reason || '').toLowerCase();
    const combinedText = `${fixDesc} ${fixReason}`;

    // 1. Validate raw risk enum
    let rawRisk: AIRiskLevel = 'LOW';
    if (rawSafe.recommendedFix?.risk && VALID_RISK_LEVELS.has(rawSafe.recommendedFix.risk)) {
      rawRisk = rawSafe.recommendedFix.risk;
    }

    // 2. Determine deterministic risk level based on content
    let assessedRisk: AIRiskLevel = rawRisk;
    const hasHighRiskMatch = HIGH_RISK_KEYWORDS.some((kw) => combinedText.includes(kw));
    const hasMediumRiskMatch = MEDIUM_RISK_KEYWORDS.some((kw) => combinedText.includes(kw));

    if (hasHighRiskMatch) {
      assessedRisk = 'HIGH';
      safetyViolations.push('Detected potentially destructive Kubernetes action in recommendation.');
    } else if (hasMediumRiskMatch && assessedRisk === 'LOW') {
      assessedRisk = 'MEDIUM';
    }

    // 3. High and Critical risk actions MUST mandate approval.
    // In SkyOps architecture, ALL remediations strictly require human review (no autonomous execution).
    const requiresApproval = true;

    // 4. Normalize and clamp confidence between 0.0 and 1.0
    let confidence = typeof rawSafe.confidence === 'number' && !isNaN(rawSafe.confidence) ? rawSafe.confidence : 0.85;
    if (confidence > 1 && confidence <= 100) {
      confidence = confidence / 100; // normalize percentage (e.g. 98 -> 0.98)
    }
    confidence = Math.max(0.0, Math.min(1.0, confidence));

    // 5. Ensure evidence items are categorized into OBSERVED_FACT, AI_INFERENCE, PROPOSED_CHANGE
    const safeEvidence: AIEvidenceItem[] = [];

    if (Array.isArray(rawSafe.evidence) && rawSafe.evidence.length > 0) {
      for (const e of rawSafe.evidence) {
        if (!e || typeof e !== 'object') continue;
        const source = String(e.source || 'Kubernetes Telemetry').slice(0, 150);
        const detail = String(e.detail || 'Observed failure condition').slice(0, 500);

        let category: AIEvidenceCategory = 'OBSERVED_FACT';
        if (e.category && VALID_EVIDENCE_CATEGORIES.has(e.category)) {
          category = e.category;
        } else {
          // Infer category heuristics
          const lowerDetail = detail.toLowerCase();
          const lowerSource = source.toLowerCase();
          if (lowerDetail.includes('propose') || lowerDetail.includes('recommend') || lowerDetail.includes('patch with') || lowerSource.includes('proposal')) {
            category = 'PROPOSED_CHANGE';
          } else if (lowerDetail.includes('deduce') || lowerDetail.includes('infer') || lowerDetail.includes('indicates') || lowerDetail.includes('likely') || lowerSource.includes('ai') || lowerSource.includes('inference')) {
            category = 'AI_INFERENCE';
          } else {
            category = 'OBSERVED_FACT';
          }
        }

        safeEvidence.push({ source, detail, category });
      }
    }

    if (safeEvidence.length === 0) {
      safeEvidence.push({
        source: 'SkyOps Incident Detection Engine',
        detail: rawSafe.rootCause || 'Observed failure condition',
        category: 'OBSERVED_FACT'
      });
    }

    // 6. Ensure affected resources are validated
    const safeAffected = Array.isArray(rawSafe.affectedResources) && rawSafe.affectedResources.length > 0
      ? rawSafe.affectedResources
          .filter((r) => r && (typeof r.kind === 'string' || typeof r.name === 'string'))
          .map((r) => ({
            kind: String(r.kind || context?.resourceKind || 'Pod').slice(0, 50),
            namespace: String(r.namespace || context?.namespace || 'default').slice(0, 100),
            name: String(r.name || context?.resourceName || 'target').slice(0, 100)
          }))
      : [
          {
            kind: context?.resourceKind || 'Pod',
            namespace: context?.namespace || 'default',
            name: context?.resourceName || 'target-resource'
          }
        ];

    if (safeAffected.length === 0) {
      safeAffected.push({
        kind: context?.resourceKind || 'Pod',
        namespace: context?.namespace || 'default',
        name: context?.resourceName || 'target-resource'
      });
    }

    // 7. Structured typed action inference for forward compatibility
    const isProviderFailure = rawSafe.status === 'UNAVAILABLE' || rawSafe.status === 'FAILED';
    let actionType: AIRemediationActionType = 'UNSPECIFIED';

    if (isProviderFailure || confidence < 0.6) {
      actionType = 'MANUAL_INSPECTION';
    } else {
      const isImageFailure =
        context?.incidentType === 'ImagePullBackOff' ||
        context?.incidentType === 'ErrImagePull' ||
        context?.incidentType === 'InvalidImageName' ||
        combinedText.includes('image pull') ||
        combinedText.includes('errimagepull') ||
        combinedText.includes('imagepullbackoff');

      if (isImageFailure || combinedText.includes('revert') || combinedText.includes('rollback') || combinedText.includes('image tag') || combinedText.includes('update image')) {
        actionType = isImageFailure ? 'UPDATE_CONTAINER_IMAGE' : 'REVERT_TAG';
      } else if (combinedText.includes('memory') || combinedText.includes('cpu') || combinedText.includes('limit') || combinedText.includes('request') || combinedText.includes('resource')) {
        actionType = 'RESOURCE_RESIZING';
      } else if (combinedText.includes('rollout restart')) {
        actionType = 'ROLLOUT_RESTART';
      } else if (combinedText.includes('scale')) {
        actionType = 'SCALE_REPLICAS';
      } else if (combinedText.includes('manifest') || combinedText.includes('config') || combinedText.includes('yaml') || combinedText.includes('patch')) {
        actionType = 'CONFIG_REVISION';
      } else if (combinedText.includes('describe') || combinedText.includes('logs') || combinedText.includes('inspect')) {
        actionType = 'MANUAL_INSPECTION';
      }
    }

    // 8. Construct change preview and verification criteria
    let changePreview: AIChangePreview | undefined = undefined;
    const rawChange = rawSafe.changePreview;

    if (rawChange && typeof rawChange === 'object') {
      const pResource = String(rawChange.resource || context?.resourceKind || 'Deployment').trim();
      const pNamespace = String(rawChange.namespace || context?.namespace || 'default').trim();
      const pObject = String(rawChange.object || context?.resourceName || 'workload').trim();
      const pContainer = rawChange.container ? String(rawChange.container).trim() : context?.targetContainer;
      const pField = String(rawChange.field || 'spec.template.spec.containers[0].image').trim();
      const pCurrent = String(rawChange.currentValue || context?.targetImage || 'unknown').trim();
      const pProposed = String(rawChange.proposedValue || '').trim();

      if (pProposed && pProposed !== 'unknown' && pProposed !== 'N/A' && pProposed !== pCurrent) {
        changePreview = {
          resource: pResource,
          namespace: pNamespace,
          object: pObject,
          container: pContainer,
          field: pField,
          currentValue: pCurrent,
          proposedValue: pProposed
        };
      }
    }

    // Verification criteria
    let verificationCriteria: AIVerificationCriteria = {
      expectedState: rawSafe.verificationCriteria?.expectedState || 'Pod phase Running and Container status Ready=True with 0 restart count increase',
      conditions: Array.isArray(rawSafe.verificationCriteria?.conditions) && rawSafe.verificationCriteria.conditions.length > 0
        ? rawSafe.verificationCriteria.conditions.map((c) => ({
            type: String(c.type || 'Ready'),
            status: String(c.status || 'True'),
            description: c.description ? String(c.description) : undefined
          }))
        : [
            { type: 'PodScheduled', status: 'True', description: 'Pod successfully scheduled on healthy node' },
            { type: 'Initialized', status: 'True', description: 'All init containers completed' },
            { type: 'ContainersReady', status: 'True', description: 'All application containers passing readiness probes' },
            { type: 'Ready', status: 'True', description: 'Workload fully ready to accept live traffic' }
          ],
      observationWindowSeconds: rawSafe.verificationCriteria?.observationWindowSeconds || 30
    };

    // 9. Construct deterministic StructuredRemediation proposal
    // STRICT SAFETY RULE: If AI is unavailable, failed, or returns no valid proposal, NEVER generate executable remediation.
    let structuredRemediation: StructuredRemediation | undefined = undefined;

    const rawRemediation = rawSafe.structuredRemediation;
    const targetKind = safeAffected[0].kind;
    const targetNs = safeAffected[0].namespace;
    const targetName = safeAffected[0].name;
    const effectiveIncId = incidentId || rawSafe.incidentId || 'SKY-0000';

    const isTargetPod = targetKind.toLowerCase() === 'pod';
    const ownerRefs = context?.ownerReferences || [];
    const isControllerOwned = ownerRefs.length > 0;
    const isStandalonePod = isTargetPod && !isControllerOwned;

    if (!isProviderFailure && confidence >= 0.6 && rawRemediation) {
      const containerName = String(
        rawRemediation?.parameters?.containerName ||
          context?.targetContainer ||
          (context?.containers && context.containers[0]?.name) ||
          targetName
      ).slice(0, 100);

      const currentImage = String(
        rawRemediation?.parameters?.currentImage ||
          context?.targetImage ||
          (context?.containers && context.containers[0]?.image) ||
          ''
      ).slice(0, 250);

      const rawProposed = String(rawRemediation?.parameters?.proposedImage || '').trim();

      // Only accept proposedImage if explicitly provided by AI reasoning and not a placeholder or fake tag
      const isValidImageString =
        rawProposed.length > 0 &&
        rawProposed !== 'unknown' &&
        rawProposed !== 'N/A' &&
        rawProposed !== currentImage &&
        !rawProposed.includes(' ') &&
        (rawProposed.includes(':') || rawProposed.includes('/') || /^[a-z0-9_.-]+$/i.test(rawProposed));

      // Grounding check: prevent inventing ungrounded generic tags
      const genericTags = [':latest', ':previous', ':stable', ':fixed', ':prod', ':v1', ':test', ':tag', ':some-tag'];
      const hasGenericTag = genericTags.some((gt) => rawProposed.toLowerCase().endsWith(gt));
      const contextDump = JSON.stringify({
        events: context?.recentEvents,
        containers: context?.containers,
        spec: context?.specSummary,
        status: context?.statusSummary,
        notes: context?.additionalNotes,
        evidence: rawSafe.evidence
      }).toLowerCase();
      const isGroundedInEvidence = !hasGenericTag || contextDump.includes(rawProposed.toLowerCase());

      const canExecuteAutomated =
        isStandalonePod &&
        (actionType === 'UPDATE_CONTAINER_IMAGE' || actionType === 'REVERT_TAG') &&
        isValidImageString &&
        isGroundedInEvidence &&
        currentImage &&
        currentImage !== 'unknown';

      let unexecutableReason: string | undefined = undefined;
      if (!canExecuteAutomated) {
        if (!isTargetPod) {
          unexecutableReason = `Automated in-cluster mutation is strictly restricted to standalone Pods. Resource kind "${targetKind}" requires declarative configuration updates in version control or manifests.`;
        } else if (isControllerOwned) {
          const controllerTypes = ownerRefs.map((o) => o.kind).join(', ') || 'Controller';
          unexecutableReason = `Automated mutation is restricted to standalone Pods. Target Pod is managed by controller (${controllerTypes}); update the parent controller manifest instead.`;
        } else if (!isValidImageString || !isGroundedInEvidence) {
          unexecutableReason = `A verified replacement image tag could not be grounded with certainty from cluster telemetry. Automated execution requires a verified image tag.`;
        } else if (!currentImage || currentImage === 'unknown') {
          unexecutableReason = `Authoritative current container image could not be verified from live cluster telemetry.`;
        } else {
          unexecutableReason = `Remediation action type "${actionType}" requires manual execution or operator verification.`;
        }
      }

      if (canExecuteAutomated) {
        // If changePreview wasn't provided directly, derive it deterministically
        if (!changePreview) {
          changePreview = {
            resource: targetKind,
            namespace: targetNs,
            object: targetName,
            container: containerName,
            field: `spec.template.spec.containers[name=${containerName}].image`,
            currentValue: currentImage,
            proposedValue: rawProposed
          };
        }

        structuredRemediation = {
          id: `REM-${effectiveIncId}-1`,
          incidentId: effectiveIncId,
          orgId: context?.orgId || '',
          clusterId: context?.clusterId || '',
          clusterName: context?.clusterName || 'Kubernetes Cluster',
          status: 'PROPOSED',
          actionType,
          targetResource: {
            kind: targetKind,
            namespace: targetNs,
            name: targetName
          },
          parameters: {
            containerName,
            currentImage,
            proposedImage: rawProposed
          },
          isExecutable: true,
          changePreview,
          verificationCriteria,
          reasoning: {
            summary: rawSafe.summary || `Remediation proposed for ${effectiveIncId}`,
            rootCause: rawSafe.rootCause || 'Underlying root cause determined from telemetry',
            whyRecommended: rawSafe.recommendedFix?.reason || 'Addresses the failure condition safely with minimal operational risk.',
            risk: assessedRisk,
            riskExplanation: rawSafe.riskExplanation || `Assessed as ${assessedRisk} risk. Change replaces failing image reference with valid tag.`,
            expectedImpact: rawSafe.recommendedFix?.expectedImpact || rawSafe.expectedImpact || 'Restores healthy workload status with a rolling pod replacement.',
            rollbackStrategy: `Re-apply previous container image: ${currentImage}`,
            saferAlternative: rawSafe.saferAlternative?.description,
            confidence: Number(confidence.toFixed(2)),
            confidenceExplanation: rawSafe.confidenceExplanation || 'Correlated live Kubernetes event streams and container waiting reasons.'
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      } else {
        // Non-executable structured proposal for manual operator guidance
        structuredRemediation = {
          id: `REM-${effectiveIncId}-1`,
          incidentId: effectiveIncId,
          orgId: context?.orgId || '',
          clusterId: context?.clusterId || '',
          clusterName: context?.clusterName || 'Kubernetes Cluster',
          status: 'PROPOSED',
          actionType: 'MANUAL_INSPECTION',
          targetResource: {
            kind: targetKind,
            namespace: targetNs,
            name: targetName
          },
          parameters: {
            containerName,
            currentImage: currentImage || 'unknown',
            proposedImage: isValidImageString && isGroundedInEvidence ? rawProposed : ''
          },
          isExecutable: false,
          unexecutableReason,
          verificationCriteria,
          reasoning: {
            summary: rawSafe.summary || `Remediation analysis for ${effectiveIncId}`,
            rootCause: rawSafe.rootCause || 'Root cause identified from cluster telemetry',
            whyRecommended: isControllerOwned
              ? `Workload is managed by ${ownerRefs[0]?.kind || 'controller'}; declarative manifest update required.`
              : !isTargetPod
              ? `Resource kind "${targetKind}" requires declarative manifest update.`
              : 'Manual inspection required to verify image and configuration.',
            risk: assessedRisk,
            riskExplanation: rawSafe.riskExplanation || `Assessed as ${assessedRisk} risk. Manual procedure recommended.`,
            expectedImpact: 'No automated cluster mutation executed.',
            rollbackStrategy: isControllerOwned || !isTargetPod
              ? (targetKind === 'Deployment' || targetKind === 'StatefulSet' || targetKind === 'DaemonSet'
                ? `kubectl rollout undo ${targetKind.toLowerCase()}/${targetName} -n ${targetNs}`
                : 'Revert declarative manifest changes in version control.')
              : 'No automated changes applied; no rollback required.',
            saferAlternative: rawSafe.saferAlternative?.description,
            confidence: Number(confidence.toFixed(2)),
            confidenceExplanation: rawSafe.confidenceExplanation
          },
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
      }
    }

    // Determine accurate rollback description based on actual remediation scope
    let accurateRollback: string;
    if (structuredRemediation && structuredRemediation.isExecutable) {
      const prevImage = structuredRemediation.parameters.currentImage || 'prior image';
      accurateRollback = `Re-apply previous container image: ${prevImage}`;
    } else if (targetKind.toLowerCase() === 'deployment' || targetKind.toLowerCase() === 'statefulset' || targetKind.toLowerCase() === 'daemonset') {
      accurateRollback = `kubectl rollout undo ${targetKind.toLowerCase()}/${targetName} -n ${targetNs}`;
    } else if (isControllerOwned) {
      const owningKind = ownerRefs[0]?.kind || 'Deployment';
      const owningName = ownerRefs[0]?.name || targetName;
      accurateRollback = `kubectl rollout undo ${owningKind.toLowerCase()}/${owningName} -n ${targetNs}`;
    } else {
      accurateRollback = 'No automated cluster mutation was applied; no rollback required.';
    }

    // Recommended fix description
    let recommendedDescription = rawSafe.recommendedFix?.description || 'Review the failing workload configuration and resolve observed resource discrepancies.';
    if (structuredRemediation && !structuredRemediation.isExecutable) {
      if (isControllerOwned) {
        recommendedDescription = `Update the container image in the owning ${ownerRefs[0]?.kind || 'controller'} manifest (${ownerRefs[0]?.name || targetName}) and allow the controller to roll out healthy pods.`;
      } else if (!isTargetPod) {
        recommendedDescription = `Review and update the ${targetKind} configuration in version control or manifests.`;
      } else if (!structuredRemediation.parameters.proposedImage) {
        recommendedDescription = `Inspect container image repository and specify a verified replacement image tag.`;
      }
    }

    const validated: SkyOpsAIAnalysis = {
      incidentId: effectiveIncId,
      summary: rawSafe.summary || 'Root cause and remediation analysis for Kubernetes incident.',
      rootCause: rawSafe.rootCause || 'Underlying root cause determined from Kubernetes error telemetry and events.',
      confidence: Number(confidence.toFixed(2)),
      confidenceExplanation: rawSafe.confidenceExplanation || 'Analysis based on live cluster telemetry, container states, and Kubernetes events.',
      evidence: safeEvidence,
      affectedResources: safeAffected,
      recommendedFix: {
        description: recommendedDescription,
        reason: rawSafe.recommendedFix?.reason || 'Addresses the direct cause of the pod/workload failure.',
        risk: assessedRisk,
        expectedImpact: structuredRemediation?.isExecutable
          ? (rawSafe.recommendedFix?.expectedImpact || rawSafe.expectedImpact || 'Restores normal workload pod readiness without service interruption.')
          : 'Manual inspection and declarative manifest update.',
        rollback: accurateRollback,
        action: structuredRemediation
          ? {
              type: structuredRemediation.actionType,
              targetResource: safeAffected[0],
              parameters: structuredRemediation.parameters
            }
          : actionType !== 'UNSPECIFIED'
          ? {
              type: actionType,
              targetResource: safeAffected[0],
              parameters: {}
            }
          : undefined
      },
      changePreview: structuredRemediation?.isExecutable ? changePreview : undefined,
      expectedImpact: structuredRemediation?.isExecutable
        ? (rawSafe.expectedImpact || rawSafe.recommendedFix?.expectedImpact || 'Rolling update of affected workload pod replicas without downtime.')
        : 'Manual configuration update; no automated cluster impact.',
      riskExplanation: rawSafe.riskExplanation || `Risk classified as ${assessedRisk} based on operational impact.`,
      rollback: accurateRollback,
      verificationCriteria,
      saferAlternative: {
        description: rawSafe.saferAlternative?.description || 'Apply declarative configuration updates to the parent Deployment/StatefulSet rather than imperatively modifying running Pods.',
        reason: rawSafe.saferAlternative?.reason || 'Prevents configuration drift and ensures replica controllers maintain intended state.'
      },
      structuredRemediation,
      requiresApproval,
      additionalEvidenceNeeded: Array.isArray(rawSafe.additionalEvidenceNeeded)
        ? rawSafe.additionalEvidenceNeeded.map((s) => String(s)).filter((s) => s.length > 0)
        : [],
      analyzedAt: rawSafe.analyzedAt || Date.now(),
      provider: rawSafe.provider || 'SkyOps AI',
      model: rawSafe.model || 'skyops-ai-engine',
      status: rawSafe.status || 'SUCCESS',
      errorMessage: rawSafe.errorMessage,
      executionSafe: true
    };

    return validated;
  }
}


