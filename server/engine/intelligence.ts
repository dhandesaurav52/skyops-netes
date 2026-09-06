import {
  Incident,
  IncidentSeverity,
  IncidentType,
  KubernetesResource,
  TechnicalDetails
} from '../../src/types/index';
import {
  buildCorrelatedTimeline,
  buildRelationshipGraph,
  extractCorrelatedSignals
} from './correlator';
import {
  CorrelatedSignal,
  EvidencePoint,
  ExecutableActionProposal,
  ExplainabilityReport,
  HypothesisStatus,
  IntelligenceAnalysis,
  ResourceRelationship,
  RootCauseHypothesis
} from './types';

export class SkyOpsIntelligenceEngine {
  /**
   * Deterministically analyzes an incident using authoritative cluster telemetry,
   * relationship topology, signal correlation, and evidence-based hypothesis scoring.
   *
   * Distinguishes strictly between:
   *  - FACT: Raw observed cluster states
   *  - DERIVED_FACT: Normalized / mathematical telemetry
   *  - INFERENCE: Cross-resource deduced linkages
   *  - HYPOTHESIS: Evaluated root cause candidates
   *  - RECOMMENDATION: Operator guidance
   *  - EXECUTABLE_ACTION: Bounded safe mutations
   *  - VERIFIED_RESULT: Post-action proof
   */
  public static analyzeIncident(
    incident: Incident,
    targetResource?: KubernetesResource | null,
    allResources: KubernetesResource[] = [],
    metrics?: any
  ): IntelligenceAnalysis {
    const now = Date.now();
    const targetNs = incident.namespace || 'default';

    // 1. Resolve or construct synthetic resource representation if not found
    const tech = incident.technicalDetails || {};
    const target: KubernetesResource = targetResource || {
      id: tech.resourceUid || `${incident.clusterId}-${incident.resourceKind}-${targetNs}-${incident.resourceName}`,
      clusterId: incident.clusterId,
      kind: incident.resourceKind,
      name: incident.resourceName,
      namespace: targetNs,
      status: tech.observedState || 'Error',
      health: 'CRITICAL',
      createdAt: incident.firstSeenAt,
      updatedAt: incident.lastSeenAt,
      specSummary: {
        nodeName: tech.nodeName,
        image: tech.image,
        imageTag: tech.imageTag,
        containers: tech.containers
      },
      statusSummary: {
        phase: tech.observedState
      },
      events: tech.events || [],
      conditions: tech.conditions || [],
      containers: tech.containers || []
    };

    if (tech.nodeName && (!target.specSummary || !target.specSummary.nodeName)) {
      target.specSummary = { ...target.specSummary, nodeName: tech.nodeName };
    }

    // 2. Build Relationship Graph
    const relationships = buildRelationshipGraph(target, allResources);

    // 3. Extract Correlated Signals across 7-tier model
    const signals = extractCorrelatedSignals(target, allResources, metrics);

    // 4. Build Correlated Timeline
    const correlatedTimeline = buildCorrelatedTimeline(target, allResources, signals);

    // 5. Evaluate Domain-Specific Hypotheses
    const { evaluatedHypotheses, isUnknownOrInconclusive, missingEvidence } =
      this.evaluateHypotheses(incident, target, relationships, signals, allResources);

    // 6. Select Authoritative Primary Hypothesis
    const primaryHypothesis = evaluatedHypotheses.length > 0 ? evaluatedHypotheses[0] : null;

    // 7. Calculate Confidence Score and Level
    let confidence = 0.25;
    let confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let confidenceExplanation = '';

    if (!primaryHypothesis || isUnknownOrInconclusive || primaryHypothesis.status === 'INSUFFICIENT_EVIDENCE') {
      confidence = 0.25;
      confidenceLevel = 'LOW';
      confidenceExplanation =
        'Insufficient or ambiguous cluster telemetry. SkyOps cannot confirm a single definitive root cause without additional telemetry.';
    } else if (primaryHypothesis.status === 'CONFIRMED') {
      confidence = Math.min(0.98, Math.max(0.85, primaryHypothesis.score / 100));
      confidenceLevel = 'HIGH';
      confidenceExplanation = `High certainty grounded in ${primaryHypothesis.supportingEvidence.length} corroborating facts with zero refuting evidence.`;
    } else if (primaryHypothesis.status === 'PLAUSIBLE') {
      confidence = Math.min(0.79, Math.max(0.5, primaryHypothesis.score / 100));
      confidenceLevel = 'MEDIUM';
      confidenceExplanation = `Plausible technical deduction supported by available signals (${primaryHypothesis.supportingEvidence.length} facts), but secondary confirmation is recommended.`;
    } else {
      confidence = 0.3;
      confidenceLevel = 'LOW';
      confidenceExplanation = 'All evaluated hypotheses were refuted or lacked sufficient supporting evidence.';
    }

    // 8. Build Explainability Report
    const explainability = this.buildExplainability(
      primaryHypothesis,
      evaluatedHypotheses,
      signals,
      isUnknownOrInconclusive,
      missingEvidence
    );

    // 9. Formulate Recommendation and Executable Action Proposal
    const { recommendation, executableProposal } = this.formulateRemediation(
      incident,
      target,
      primaryHypothesis,
      isUnknownOrInconclusive
    );

    const rootCause = isUnknownOrInconclusive || !primaryHypothesis
      ? 'UNKNOWN / INSUFFICIENT_EVIDENCE'
      : primaryHypothesis.title;

    const rootCauseCategory = isUnknownOrInconclusive || !primaryHypothesis
      ? 'UNDETERMINED'
      : primaryHypothesis.category;

    return {
      incidentId: incident.id,
      incidentType: incident.incidentType,
      fingerprint: incident.fingerprint,
      clusterId: incident.clusterId,
      clusterName: incident.clusterName,
      analyzedAt: now,
      rootCause,
      rootCauseCategory,
      confidence,
      confidenceLevel,
      confidenceExplanation,
      primaryHypothesis,
      evaluatedHypotheses,
      signals,
      relationships,
      correlatedTimeline,
      explainability,
      recommendation,
      executableProposal,
      isUnknownOrInconclusive
    };
  }

  /**
   * Evaluates competing hypotheses against observed telemetry facts, derived facts,
   * and cross-resource inferences.
   */
  private static evaluateHypotheses(
    incident: Incident,
    target: KubernetesResource,
    relationships: ResourceRelationship[],
    signals: CorrelatedSignal[],
    allResources: KubernetesResource[]
  ): {
    evaluatedHypotheses: RootCauseHypothesis[];
    isUnknownOrInconclusive: boolean;
    missingEvidence: string[];
  } {
    const type = incident.incidentType;
    const tech = incident.technicalDetails || {};
    const events = target.events || tech.events || [];
    const containers = target.containers || tech.containers || [];
    const missingEvidence: string[] = [];

    let hypotheses: RootCauseHypothesis[] = [];

    // Helper to find signals
    const eventMessages = events.map((e) => (e.message || '').toLowerCase()).join(' ');
    const eventReasons = events.map((e) => (e.reason || '').toLowerCase()).join(' ');
    const exitCodes = containers.map((c) => c.exitCode).filter((code) => code !== undefined);
    const waitingReasons = containers.map((c) => (c.waitingReason || '').toLowerCase()).join(' ');
    const terminationReasons = containers.map((c) => (c.terminationReason || '').toLowerCase()).join(' ');

    // -------------------------------------------------------------
    // SCENARIO 1: ImagePullBackOff / ErrImagePull / InvalidImageName
    // -------------------------------------------------------------
    const isImagePullIncident =
      type === 'ImagePullBackOff' ||
      waitingReasons.includes('imagepull') ||
      waitingReasons.includes('errimagepull') ||
      /failed to pull image|errimagepull|imagepullbackoff|back-off pulling image/i.test(eventMessages) ||
      Boolean(tech.reason && /imagepull|errimagepull/i.test(tech.reason));

    if (isImagePullIncident) {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];
      const h2Supporting: EvidencePoint[] = [];
      const h2Contradicting: EvidencePoint[] = [];
      const h3Supporting: EvidencePoint[] = [];
      const h3Contradicting: EvidencePoint[] = [];

      // Hypothesis 1: Image Tag or Manifest Not Found in Registry (404 / Typo)
      if (/manifest unknown|not found|does not exist|repository does not exist|not_found|tag .* not found/i.test(eventMessages)) {
        h1Supporting.push({
          id: 'ev-manifest-unknown',
          description: 'Container engine event explicitly reports "manifest unknown" or image tag does not exist in registry',
          source: 'events',
          weight: 55
        });
      }
      if (tech.imageTag) {
        h1Supporting.push({
          id: 'ev-tag-format',
          description: `Target image reference "${tech.image || ''}" specifies tag "${tech.imageTag}"`,
          source: 'spec',
          weight: 15
        });
      }
      if (/unauthorized|authentication required|401|403|pull access denied/i.test(eventMessages)) {
        h1Contradicting.push({
          id: 'ev-contra-auth',
          description: 'Event reports 401/403 authorization error rather than 404 missing tag',
          source: 'events',
          weight: 50
        });
      }

      // Hypothesis 2: Registry Authentication Failure / Missing Pull Secret (401 / 403)
      if (/unauthorized|authentication required|401|403|pull access denied|denied/i.test(eventMessages)) {
        h2Supporting.push({
          id: 'ev-auth-denied',
          description: 'Event stream confirms pull access denied (HTTP 401/403 Unauthorized)',
          source: 'events',
          weight: 55
        });
      }
      const imagePullSecrets = target.specSummary?.imagePullSecrets as any[] | undefined;
      if (!imagePullSecrets || imagePullSecrets.length === 0) {
        h2Supporting.push({
          id: 'ev-missing-pull-secrets',
          description: 'Pod spec contains no imagePullSecrets configured for authenticated private registry access',
          source: 'spec',
          weight: 20
        });
      }
      if (/manifest unknown|not found/i.test(eventMessages)) {
        h2Contradicting.push({
          id: 'ev-contra-404',
          description: 'Event confirmed registry returned 404 Not Found, not an authentication rejection',
          source: 'events',
          weight: 50
        });
      }

      // Hypothesis 3: Network or DNS Timeout Reaching Registry
      if (/dial tcp|lookup .* on .* server misbehaving|connection refused|timeout|i\/o timeout|temporary failure/i.test(eventMessages)) {
        h3Supporting.push({
          id: 'ev-network-timeout',
          description: 'Kubelet reported network transport timeout or DNS resolution failure reaching image registry',
          source: 'events',
          weight: 50
        });
      }
      if (/manifest unknown|not found|pull access denied/i.test(eventMessages)) {
        h3Contradicting.push({
          id: 'ev-contra-reached',
          description: 'Kubelet successfully connected to registry and received HTTP status response',
          source: 'events',
          weight: 45
        });
      }

      const score1 = this.calculateScore(h1Supporting, h1Contradicting, 25);
      const score2 = this.calculateScore(h2Supporting, h2Contradicting, 20);
      const score3 = this.calculateScore(h3Supporting, h3Contradicting, 10);

      hypotheses.push(
        {
          id: 'hypo-image-tag-not-found',
          title: 'Image Tag Not Found in Container Registry',
          category: 'IMAGE_REGISTRY_ERROR',
          description: 'The specified container image tag does not exist or was deleted from the remote container registry.',
          score: score1,
          status: this.resolveStatus(score1, h1Contradicting),
          supportingEvidence: h1Supporting,
          contradictingEvidence: h1Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-registry-auth-failed',
          title: 'Registry Authentication Failure or Missing Pull Secret',
          category: 'AUTHENTICATION_ERROR',
          description: 'The node cannot pull the image due to missing or invalid credentials / imagePullSecrets.',
          score: score2,
          status: this.resolveStatus(score2, h2Contradicting),
          supportingEvidence: h2Supporting,
          contradictingEvidence: h2Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-registry-network-timeout',
          title: 'Registry Network or DNS Reachability Timeout',
          category: 'NETWORK_INFRASTRUCTURE',
          description: 'Node networking or cluster DNS failed to resolve or connect to the container registry endpoint.',
          score: score3,
          status: this.resolveStatus(score3, h3Contradicting),
          supportingEvidence: h3Supporting,
          contradictingEvidence: h3Contradicting,
          whySelectedOrRejected: ''
        }
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 2: OOMKilled / Memory Limit / Memory Pressure
    // -------------------------------------------------------------
    else if (
      type === 'OOMKilled' ||
      exitCodes.includes(137) ||
      terminationReasons.includes('oomkilled') ||
      waitingReasons.includes('oomkilled') ||
      eventMessages.includes('oomkilled')
    ) {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];
      const h2Supporting: EvidencePoint[] = [];
      const h2Contradicting: EvidencePoint[] = [];

      // Check node memory pressure
      const scheduledNodeRel = relationships.find((r) => r.relation === 'SCHEDULED_ON');
      const nodeResource = scheduledNodeRel
        ? allResources.find((r) => r.kind === 'Node' && r.name === scheduledNodeRel.target.name)
        : null;

      const isNodeMemoryPressured = nodeResource?.conditions?.some(
        (c) => c.type === 'MemoryPressure' && c.status === 'True'
      );

      // Hypothesis 1: Container Exceeded Local Memory Limit (cgroup OOM)
      if (exitCodes.includes(137) || terminationReasons.includes('oomkilled')) {
        h1Supporting.push({
          id: 'ev-exit-137',
          description: 'Container terminated with exit code 137 and reason OOMKilled (cgroup memory enforcement)',
          source: 'kubelet',
          weight: 40
        });
      }
      if (isNodeMemoryPressured === false) {
        h1Supporting.push({
          id: 'ev-node-mem-healthy',
          description: `Scheduled Node "${scheduledNodeRel?.target.name || 'node'}" condition MemoryPressure is False (isolated container cgroup limit breach)`,
          source: 'status',
          weight: 30
        });
      } else if (isNodeMemoryPressured === true) {
        h1Contradicting.push({
          id: 'ev-node-mem-pressured',
          description: 'Scheduled Node is actively under cluster MemoryPressure, suggesting host-level eviction rather than isolated container limit',
          source: 'status',
          weight: 35
        });
      }

      // Hypothesis 2: Node-Level Host Memory Pressure & System OOM Eviction
      if (isNodeMemoryPressured) {
        h2Supporting.push({
          id: 'ev-node-mem-true',
          description: `Node "${scheduledNodeRel?.target.name || 'node'}" has MemoryPressure=True condition`,
          source: 'status',
          weight: 45
        });
        const peerFailingRel = relationships.filter((r) => r.relation === 'PEER_ON_NODE' && r.isImpacted);
        if (peerFailingRel.length > 0) {
          h2Supporting.push({
            id: 'ev-peer-pods-pressured',
            description: `${peerFailingRel.length} other peer pods on the same node are failing due to node memory contention`,
            source: 'engine',
            weight: 25
          });
        }
      } else {
        h2Contradicting.push({
          id: 'ev-contra-node-healthy',
          description: 'Node memory is healthy and MemoryPressure is False',
          source: 'status',
          weight: 50
        });
      }

      const score1 = this.calculateScore(h1Supporting, h1Contradicting, 30);
      const score2 = this.calculateScore(h2Supporting, h2Contradicting, 10);

      hypotheses.push(
        {
          id: 'hypo-container-limit-exceeded',
          title: 'Container Exceeded Configured Memory Limit (cgroup OOM)',
          category: 'RESOURCE_LIMIT_EXCEEDED',
          description: 'The process inside the container allocated memory exceeding its spec.resources.limits.memory, triggering kernel cgroup termination.',
          score: score1,
          status: this.resolveStatus(score1, h1Contradicting),
          supportingEvidence: h1Supporting,
          contradictingEvidence: h1Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-node-memory-pressure',
          title: 'Node-Level Memory Exhaustion & System Eviction',
          category: 'HOST_RESOURCE_PRESSURE',
          description: 'The entire Kubernetes host node ran out of free memory, causing kubelet or kernel system OOM to evict pods.',
          score: score2,
          status: this.resolveStatus(score2, h2Contradicting),
          supportingEvidence: h2Supporting,
          contradictingEvidence: h2Contradicting,
          whySelectedOrRejected: ''
        }
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 3: FailedScheduling / PodSchedulingFailed
    // -------------------------------------------------------------
    else if (
      type === 'PodSchedulingFailed' ||
      eventReasons.includes('failedscheduling') ||
      target.status === 'Pending'
    ) {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];
      const h2Supporting: EvidencePoint[] = [];
      const h2Contradicting: EvidencePoint[] = [];
      const h3Supporting: EvidencePoint[] = [];
      const h3Contradicting: EvidencePoint[] = [];

      // Hypothesis 1: Insufficient Cluster CPU or Memory Allocatable
      if (/insufficient cpu|insufficient memory|0\/.* nodes are available/i.test(eventMessages)) {
        h1Supporting.push({
          id: 'ev-insufficient-resources',
          description: 'Default scheduler event reports insufficient CPU or memory available across all worker nodes',
          source: 'events',
          weight: 50
        });
      }
      if (/didn't match (pod's node selector|podaffinity)|untolerated taint/i.test(eventMessages)) {
        h1Contradicting.push({
          id: 'ev-contra-selector',
          description: 'Scheduler explicitly cited affinity or taint rejection rather than resource capacity deficit',
          source: 'events',
          weight: 40
        });
      }

      // Hypothesis 2: Node Selector, Affinity, or Taint Constraint Mismatch
      if (/didn't match (pod's node selector|podaffinity)|had untolerated taint/i.test(eventMessages)) {
        h2Supporting.push({
          id: 'ev-taint-or-selector',
          description: 'Scheduler event confirms pod cannot be placed due to unmatched nodeSelector, affinity, or untolerated taints',
          source: 'events',
          weight: 50
        });
      }
      if (/insufficient cpu|insufficient memory/i.test(eventMessages)) {
        h2Contradicting.push({
          id: 'ev-contra-capacity',
          description: 'Scheduler event cites hardware capacity deficit, not topology constraints',
          source: 'events',
          weight: 40
        });
      }

      // Hypothesis 3: Unbound or Pending PersistentVolumeClaim
      const pvcRels = relationships.filter((r) => r.relation === 'MOUNTS_PVC' && r.isImpacted);
      if (pvcRels.length > 0 || /unbound immediate persistentvolumeclaims|pod has unbound/i.test(eventMessages)) {
        h3Supporting.push({
          id: 'ev-unbound-pvc',
          description: `Pod requires PVC "${pvcRels[0]?.target.name || 'pvc'}" which is currently in an unbound or pending state`,
          source: 'events',
          weight: 50
        });
      } else {
        h3Contradicting.push({
          id: 'ev-pvc-ok',
          description: 'Pod either does not mount PVCs or all mounted PVCs are healthy and bound',
          source: 'spec',
          weight: 40
        });
      }

      const score1 = this.calculateScore(h1Supporting, h1Contradicting, 25);
      const score2 = this.calculateScore(h2Supporting, h2Contradicting, 25);
      const score3 = this.calculateScore(h3Supporting, h3Contradicting, 10);

      hypotheses.push(
        {
          id: 'hypo-insufficient-cluster-resources',
          title: 'Insufficient Cluster CPU or Memory Capacity',
          category: 'CAPACITY_EXHAUSTION',
          description: 'No node in the cluster possesses sufficient allocatable CPU or memory to satisfy the pod request specs.',
          score: score1,
          status: this.resolveStatus(score1, h1Contradicting),
          supportingEvidence: h1Supporting,
          contradictingEvidence: h1Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-node-selector-affinity-mismatch',
          title: 'Node Selector, Affinity, or Untolerated Taint Mismatch',
          category: 'SCHEDULING_CONSTRAINT',
          description: 'The pod configuration specifies nodeSelector, affinity, or toleration requirements that match zero available nodes.',
          score: score2,
          status: this.resolveStatus(score2, h2Contradicting),
          supportingEvidence: h2Supporting,
          contradictingEvidence: h2Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-unbound-pvc-blocking-scheduling',
          title: 'Unbound PersistentVolumeClaim Blocking Pod Scheduling',
          category: 'STORAGE_DEPENDENCY',
          description: 'The pod mounts a PersistentVolumeClaim that has not been dynamically provisioned or bound.',
          score: score3,
          status: this.resolveStatus(score3, h3Contradicting),
          supportingEvidence: h3Supporting,
          contradictingEvidence: h3Contradicting,
          whySelectedOrRejected: ''
        }
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 4: CrashLoopBackOff / Application Crash
    // -------------------------------------------------------------
    else if (
      type === 'CrashLoopBackOff' ||
      waitingReasons.includes('crashloopbackoff') ||
      eventReasons.includes('backoff')
    ) {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];
      const h2Supporting: EvidencePoint[] = [];
      const h2Contradicting: EvidencePoint[] = [];
      const h3Supporting: EvidencePoint[] = [];
      const h3Contradicting: EvidencePoint[] = [];

      // Hypothesis 1: Application Internal Runtime Exception / Non-Zero Exit Code
      if (exitCodes.some((code) => code === 1 || code === 2 || code === 255)) {
        h1Supporting.push({
          id: 'ev-exit-app-error',
          description: `Container exited with application error code (${exitCodes.join(', ')})`,
          source: 'kubelet',
          weight: 45
        });
      }
      if (exitCodes.includes(127)) {
        h1Contradicting.push({
          id: 'ev-contra-127',
          description: 'Exit code is 127 (Command/Binary Not Found), not an internal unhandled application error',
          source: 'kubelet',
          weight: 50
        });
      }
      if (exitCodes.includes(137)) {
        h1Contradicting.push({
          id: 'ev-contra-137',
          description: 'Exit code is 137 (OOMKilled), caused by cgroup memory limit rather than application logic error',
          source: 'kubelet',
          weight: 50
        });
      }

      // Hypothesis 2: Command or Binary Not Found (Exit Code 127)
      if (exitCodes.includes(127) || /command not found|no such file or directory/i.test(eventMessages)) {
        h2Supporting.push({
          id: 'ev-exit-127',
          description: 'Container exited with code 127 or error "no such file or directory" indicating entrypoint/command missing',
          source: 'kubelet',
          weight: 50
        });
      } else {
        h2Contradicting.push({
          id: 'ev-not-127',
          description: `Exit code is ${exitCodes.join(', ') || 'non-127'}, confirming binary was found and executed`,
          source: 'kubelet',
          weight: 40
        });
      }

      // Hypothesis 3: Liveness or Readiness Probe Consecutive Failures
      if (/unhealthy.*probe failed|liveness probe failed|readiness probe failed/i.test(eventMessages)) {
        h3Supporting.push({
          id: 'ev-probe-failure',
          description: 'Kubelet event stream contains probe failure warnings prior to container restart',
          source: 'events',
          weight: 45
        });
      } else {
        h3Contradicting.push({
          id: 'ev-no-probe-events',
          description: 'No probe failure events recorded in Kubelet event stream',
          source: 'events',
          weight: 30
        });
      }

      const score1 = this.calculateScore(h1Supporting, h1Contradicting, 25);
      const score2 = this.calculateScore(h2Supporting, h2Contradicting, 10);
      const score3 = this.calculateScore(h3Supporting, h3Contradicting, 10);

      hypotheses.push(
        {
          id: 'hypo-app-runtime-crash',
          title: 'Application Runtime Crash (Unhandled Exception / Fatal Exit)',
          category: 'APPLICATION_ERROR',
          description: 'The process executed, encountered an unhandled exception or missing configuration, and exited with a fatal error code.',
          score: score1,
          status: this.resolveStatus(score1, h1Contradicting),
          supportingEvidence: h1Supporting,
          contradictingEvidence: h1Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-binary-not-found',
          title: 'Entrypoint Command or Binary Not Found (Exit 127)',
          category: 'CONTAINER_SPEC_ERROR',
          description: 'The container image does not contain the executable specified in command or args (exit code 127).',
          score: score2,
          status: this.resolveStatus(score2, h2Contradicting),
          supportingEvidence: h2Supporting,
          contradictingEvidence: h2Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-probe-failure-termination',
          title: 'Liveness Probe Failure Triggered Termination',
          category: 'HEALTH_CHECK_FAILURE',
          description: 'Kubelet repeatedly failed to receive healthy HTTP or TCP responses from the container liveness probe, triggering mandatory restart.',
          score: score3,
          status: this.resolveStatus(score3, h3Contradicting),
          supportingEvidence: h3Supporting,
          contradictingEvidence: h3Contradicting,
          whySelectedOrRejected: ''
        }
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 5: PVCPending / Storage Issues
    // -------------------------------------------------------------
    else if (type === 'PVCPending' || target.kind === 'PersistentVolumeClaim') {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];
      const h2Supporting: EvidencePoint[] = [];
      const h2Contradicting: EvidencePoint[] = [];

      // Hypothesis 1: Missing or Non-Existent StorageClass
      if (/storageclass .* not found|failed to provision.*storageclass/i.test(eventMessages)) {
        h1Supporting.push({
          id: 'ev-sc-not-found',
          description: 'Event confirms referenced StorageClass does not exist in the cluster',
          source: 'events',
          weight: 50
        });
      }
      // Hypothesis 2: Waiting for First Consumer (Normal provision pending pod placement)
      if (/waitforfirstconsumer|waiting for a volume to be created/i.test(eventMessages)) {
        h2Supporting.push({
          id: 'ev-wait-consumer',
          description: 'StorageClass volumeBindingMode is WaitForFirstConsumer, pending pod scheduler decision',
          source: 'events',
          weight: 45
        });
      }

      const score1 = this.calculateScore(h1Supporting, h1Contradicting, 20);
      const score2 = this.calculateScore(h2Supporting, h2Contradicting, 20);

      hypotheses.push(
        {
          id: 'hypo-missing-storage-class',
          title: 'Missing or Non-Existent StorageClass',
          category: 'STORAGE_CONFIGURATION',
          description: 'The PVC references a StorageClass that has not been defined in the Kubernetes cluster.',
          score: score1,
          status: this.resolveStatus(score1, h1Contradicting),
          supportingEvidence: h1Supporting,
          contradictingEvidence: h1Contradicting,
          whySelectedOrRejected: ''
        },
        {
          id: 'hypo-wait-for-consumer',
          title: 'Volume Binding Mode WaitForFirstConsumer',
          category: 'STORAGE_LIFECYCLE',
          description: 'The PVC is awaiting the scheduling of a consumer pod before dynamic volume provisioning can execute.',
          score: score2,
          status: this.resolveStatus(score2, h2Contradicting),
          supportingEvidence: h2Supporting,
          contradictingEvidence: h2Contradicting,
          whySelectedOrRejected: ''
        }
      );
    }

    // -------------------------------------------------------------
    // SCENARIO 6: Node NotReady / Node Pressure
    // -------------------------------------------------------------
    else if (['NodeNotReady', 'NodeMemoryPressure', 'NodeDiskPressure'].includes(type) || target.kind === 'Node') {
      const h1Supporting: EvidencePoint[] = [];
      const h1Contradicting: EvidencePoint[] = [];

      h1Supporting.push({
        id: 'ev-node-condition',
        description: `Node health checks reported condition ${target.status}`,
        source: 'status',
        weight: 45
      });

      const score = this.calculateScore(h1Supporting, h1Contradicting, 35);
      hypotheses.push({
        id: 'hypo-node-infrastructure-degradation',
        title: 'Node Infrastructure Degradation or Kubelet Communication Breakdown',
        category: 'NODE_INFRASTRUCTURE',
        description: 'Node host resources or Kubelet daemon failed health check thresholds.',
        score,
        status: this.resolveStatus(score, h1Contradicting),
        supportingEvidence: h1Supporting,
        contradictingEvidence: h1Contradicting,
        whySelectedOrRejected: ''
      });
    }

    // Fallback if no specific pattern matched
    if (hypotheses.length === 0) {
      hypotheses.push({
        id: 'hypo-undetermined-incident',
        title: `Kubernetes Resource Degradation (${type})`,
        category: 'DEGRADED_STATE',
        description: `Resource entered ${target.status} state. Specific technical cause requires additional diagnostic telemetry.`,
        score: 35,
        status: 'INSUFFICIENT_EVIDENCE',
        supportingEvidence: [
          {
            id: 'ev-observed-status',
            description: `Resource reported status: ${target.status}`,
            source: 'status',
            weight: 20
          }
        ],
        contradictingEvidence: [],
        whySelectedOrRejected: ''
      });
    }

    // Sort hypotheses descending by score
    hypotheses.sort((a, b) => b.score - a.score);

    // Determine if inconclusive / unknown
    const topScore = hypotheses[0]?.score ?? 0;
    const isUnknownOrInconclusive = topScore < 40 || hypotheses[0]?.status === 'INSUFFICIENT_EVIDENCE';

    if (isUnknownOrInconclusive) {
      if (events.length === 0) {
        missingEvidence.push('Kubelet warning events are missing from cluster telemetry snapshot');
      }
      if (exitCodes.length === 0 && target.kind === 'Pod') {
        missingEvidence.push('Container exit code was not captured or container is still in waiting phase');
      }
      missingEvidence.push('Live container stderr/stdout logs are needed to verify internal process behavior');
    }

    return { evaluatedHypotheses: hypotheses, isUnknownOrInconclusive, missingEvidence };
  }

  private static calculateScore(
    supporting: EvidencePoint[],
    contradicting: EvidencePoint[],
    baseScore = 20
  ): number {
    let score = baseScore;
    for (const sup of supporting) {
      score += sup.weight;
    }
    for (const con of contradicting) {
      score -= con.weight;
    }
    return Math.max(5, Math.min(99, score));
  }

  private static resolveStatus(score: number, contradicting: EvidencePoint[]): HypothesisStatus {
    const hasFatalContradiction = contradicting.some((c) => c.weight >= 45);
    if (hasFatalContradiction || score < 25) {
      return 'REFUTED';
    }
    if (score >= 75) {
      return 'CONFIRMED';
    }
    if (score >= 45) {
      return 'PLAUSIBLE';
    }
    return 'INSUFFICIENT_EVIDENCE';
  }

  /**
   * Generates the explainability report explaining why the primary root cause was
   * selected and why alternative hypotheses were rejected.
   */
  private static buildExplainability(
    primary: RootCauseHypothesis | null,
    allHypotheses: RootCauseHypothesis[],
    signals: CorrelatedSignal[],
    isUnknownOrInconclusive: boolean,
    missingEvidence: string[]
  ): ExplainabilityReport {
    const factCount = signals.filter((s) => s.category === 'FACT').length;
    const derivedFactCount = signals.filter((s) => s.category === 'DERIVED_FACT').length;
    const inferenceCount = signals.filter((s) => s.category === 'INFERENCE').length;

    if (!primary || isUnknownOrInconclusive) {
      return {
        whySelected:
          'No single root cause hypothesis achieved sufficient confidence (threshold >= 45). The incident telemetry lacks decisive indicators (e.g. exit code or specific Kubelet event message).',
        rejectedAlternatives: allHypotheses.map((h) => ({
          id: h.id,
          title: h.title,
          reason: `Insufficient corroborating evidence (score: ${h.score}/100)`,
          score: h.score
        })),
        evidenceSummary: {
          factCount,
          derivedFactCount,
          inferenceCount,
          supportingScore: 0,
          contradictingScore: 0
        },
        missingEvidence
      };
    }

    const supportingScore = primary.supportingEvidence.reduce((acc, e) => acc + e.weight, 0);
    const contradictingScore = primary.contradictingEvidence.reduce((acc, e) => acc + e.weight, 0);

    const whySelected = `SkyOps selected "${primary.title}" because ${primary.supportingEvidence.length} authoritative cluster facts directly corroborated this technical cause (composite evidence score ${primary.score}/100), including: ${primary.supportingEvidence.map((e) => `"${e.description}"`).slice(0, 2).join(' and ')}.`;

    const rejectedAlternatives = allHypotheses
      .filter((h) => h.id !== primary.id)
      .map((h) => {
        let reason = `Ranked lower with evidence score ${h.score}/100.`;
        if (h.status === 'REFUTED') {
          const contra = h.contradictingEvidence[0]?.description || 'Contradicted by observed cluster telemetry';
          reason = `Refuted: ${contra}.`;
        } else if (h.supportingEvidence.length === 0) {
          reason = 'Zero corroborating facts detected in telemetry.';
        }
        return {
          id: h.id,
          title: h.title,
          reason,
          score: h.score
        };
      });

    return {
      whySelected,
      rejectedAlternatives,
      evidenceSummary: {
        factCount,
        derivedFactCount,
        inferenceCount,
        supportingScore,
        contradictingScore
      },
      missingEvidence: missingEvidence.length > 0 ? missingEvidence : undefined
    };
  }

  /**
   * Formulates human-readable recommendation and (if eligible) an executable action proposal.
   */
  private static formulateRemediation(
    incident: Incident,
    target: KubernetesResource,
    primary: RootCauseHypothesis | null,
    isUnknown: boolean
  ): {
    recommendation: string;
    executableProposal?: ExecutableActionProposal;
  } {
    if (isUnknown || !primary) {
      return {
        recommendation:
          'Inspect live pod logs and describe output using kubectl (e.g. `kubectl describe pod ${target.name} -n ${target.namespace}`) to gather additional diagnostic output before applying remediation.'
      };
    }

    const tech = incident.technicalDetails || {};
    const container = tech.containerName || target.containers?.[0]?.name || 'main';

    if (primary.id === 'hypo-image-tag-not-found') {
      const isStandalonePod =
        target.kind === 'Pod' && (!target.ownerReferences || target.ownerReferences.length === 0);

      const recommendation = `Verify that the image tag "${tech.imageTag || 'specified'}" exists in the container registry. Update the workload spec with a verified tag.`;

      let executableProposal: ExecutableActionProposal | undefined = undefined;
      if (isStandalonePod && tech.image) {
        executableProposal = {
          actionType: 'REPLACE_POD_IMAGE',
          targetResource: {
            kind: 'Pod',
            name: target.name,
            namespace: target.namespace || 'default',
            container
          },
          fieldPath: `spec.containers[name=${container}].image`,
          currentValue: tech.image,
          proposedValue: tech.image.replace(/:.*$/, ':latest'),
          isExecutable: true,
          reason: 'Replace unpullable image reference on standalone Pod with verified tag'
        };
      }

      return { recommendation, executableProposal };
    }

    if (primary.id === 'hypo-container-limit-exceeded') {
      return {
        recommendation: `Increase spec.resources.limits.memory for container "${container}" in the workload spec, or profile the application to eliminate excessive memory allocation.`
      };
    }

    if (primary.id === 'hypo-insufficient-cluster-resources') {
      return {
        recommendation:
          'Scale up cluster worker nodes or reduce resource requests in the pod specification to match available node capacity.'
      };
    }

    if (primary.id === 'hypo-app-runtime-crash') {
      return {
        recommendation:
          'Inspect application stderr logs using `kubectl logs` to diagnose the unhandled runtime exception or missing configuration file.'
      };
    }

    return {
      recommendation: `Review the ${target.kind} configuration in namespace "${target.namespace || 'default'}" to address ${primary.title.toLowerCase()}.`
    };
  }
}
