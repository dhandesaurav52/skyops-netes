import {
  AIAffectedResource,
  AIAnalysisStatus,
  AIChangePreview,
  AIEvidenceCategory,
  AIEvidenceItem,
  AIRecommendedFix,
  AIRemediationAction,
  AIRemediationActionType,
  AIRiskLevel,
  AISaferAlternative,
  AITimingMetrics,
  AIVerificationCondition,
  AIVerificationCriteria,
  Incident,
  IncidentSeverity,
  IncidentType,
  IntelligenceAnalysis,
  KubernetesResource,
  RemediationApproval,
  RemediationExecution,
  RemediationStatus,
  RemediationVerification,
  SkyOpsAIAnalysis,
  StructuredRemediation
} from '../../src/types/index';

/**
 * Complete, filtered, and sanitized Kubernetes context extracted from
 * live telemetry and incident records without leaking sensitive credentials/secrets.
 */
export interface IncidentContext {
  incidentId: string;
  fingerprint: string;
  orgId?: string;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  clusterId: string;
  clusterName: string;
  namespace: string;
  resourceKind: string;
  resourceName: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  targetPod?: string;
  targetContainer?: string;
  targetImage?: string;
  imageTag?: string;
  restartCount?: number;
  exitCode?: number;
  terminationReason?: string;
  waitingReason?: string;
  nodeName?: string;
  observedState?: string;
  k8sStatus?: string;
  ownerReferences?: Array<{
    kind: string;
    name: string;
    controller?: boolean;
  }>;
  replicaCounts?: {
    desired?: number;
    available?: number;
    ready?: number;
    updated?: number;
  };
  pvcDiagnostics?: {
    pvcPhase?: string;
    storageClass?: string;
    capacity?: string;
  };
  recentEvents: Array<{
    type: string;
    reason: string;
    message: string;
    count?: number;
    ageSeconds?: number;
  }>;
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  containers: Array<{
    name: string;
    image: string;
    state: string;
    restartCount: number;
    ready: boolean;
    waitingReason?: string;
    waitingMessage?: string;
    terminationReason?: string;
    exitCode?: number;
  }>;
  relatedResources: Array<{
    kind: string;
    name: string;
    namespace: string;
    relationship: string;
  }>;
  specSummary: Record<string, unknown>;
  statusSummary: Record<string, unknown>;
  additionalNotes?: string[];
  intelligence?: IntelligenceAnalysis;
}

/**
 * Abstract AI Provider interface allowing seamless swapping
 * between Gemini, OpenAI, Claude, or self-hosted LLMs.
 */
export interface AIProvider {
  readonly name: string;
  readonly model: string;
  isAvailable(): boolean;
  analyzeIncident(context: IncidentContext): Promise<SkyOpsAIAnalysis>;
}

export type {
  AIAffectedResource,
  AIAnalysisStatus,
  AIChangePreview,
  AIEvidenceCategory,
  AIEvidenceItem,
  AIRecommendedFix,
  AIRemediationAction,
  AIRemediationActionType,
  AIRiskLevel,
  AISaferAlternative,
  AIVerificationCondition,
  AIVerificationCriteria,
  RemediationApproval,
  RemediationExecution,
  RemediationStatus,
  RemediationVerification,
  SkyOpsAIAnalysis,
  StructuredRemediation
};

