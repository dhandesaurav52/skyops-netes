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
  BlastRadiusScope,
  EvidenceSeverity,
  Incident,
  IncidentSeverity,
  IncidentType,
  IntelligenceAnalysis,
  InvestigationActionPlan,
  InvestigationEvidenceItem,
  InvestigationEvidenceType,
  InvestigationTimelineEvent,
  KubernetesResource,
  RemediationApproval,
  RemediationExecution,
  RemediationStatus,
  RemediationVerification,
  RootCauseProbability,
  RuledOutCause,
  SkyOpsAIAnalysis,
  StructuredInvestigation,
  StructuredRemediation,
  TimelineCausalRelation
} from '../../src/types/index';

/**
 * Cluster Topology and Node State
 */
export interface ClusterTopologyContext {
  nodeName?: string;
  nodeStatus?: string;
  nodeConditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  capacity?: {
    cpu?: string;
    memory?: string;
    pods?: string;
  };
  allocatable?: {
    cpu?: string;
    memory?: string;
    pods?: string;
  };
  podDensity?: number;
  isUnschedulable?: boolean;
}

/**
 * Container Diagnostic State including Probes and OOM indicators
 */
export interface ContainerDiagnosticState {
  name: string;
  image: string;
  imagePullPolicy?: string;
  state: string;
  restartCount: number;
  ready: boolean;
  oomKilled?: boolean;
  exitCode?: number;
  terminationReason?: string;
  waitingReason?: string;
  waitingMessage?: string;
  lastTerminationDetails?: {
    exitCode?: number;
    reason?: string;
    message?: string;
    finishedAt?: string;
  };
  probes?: {
    liveness?: { httpPath?: string; port?: number | string; initialDelaySeconds?: number; failureThreshold?: number };
    readiness?: { httpPath?: string; port?: number | string; initialDelaySeconds?: number; failureThreshold?: number };
    startup?: { httpPath?: string; port?: number | string; initialDelaySeconds?: number; failureThreshold?: number };
  };
}

/**
 * Recent Log context and error frequency
 */
export interface IncidentLogsContext {
  recentErrorLogs: string[];
  tailLogs?: string[];
  previousTerminatedLogs?: string[];
  errorRatePerMinute?: number;
}

/**
 * Metrics trends, limits, and resource saturation indicators
 */
export interface MetricsTrendsContext {
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  cpuRequestLimitRatio?: string;
  memoryRequestLimitRatio?: string;
  saturationWarning?: string;
  thresholdBreached?: boolean;
}

/**
 * Configuration and Rollout Changes
 */
export interface ConfigStateChangesContext {
  recentRolloutRevision?: number;
  specChanges?: string[];
  configmapSecretChecksumChanges?: boolean;
}

/**
 * Network and Ingress context
 */
export interface NetworkContext {
  serviceEndpointsReady?: number;
  endpointsTotal?: number;
  ingressActive?: boolean;
  dnsFailureDetected?: boolean;
}

/**
 * Related Incidents and Historical Patterns
 */
export interface RelatedIncidentsContext {
  concurrentIncidentsOnSameNode?: number;
  concurrentIncidentsInNamespace?: number;
  historicalRecurrenceCount?: number;
  averageMttrMinutes?: number;
}

/**
 * Temporal context and flapping indicators
 */
export interface TemporalContext {
  durationSeconds: number;
  firstSeenAt: string;
  lastSeenAt: string;
  isFlapping: boolean;
  oscillationRatePerHour?: number;
}

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

  // --- Extended Incident Investigation Fields ---
  clusterTopology?: ClusterTopologyContext;
  containerDiagnostics?: ContainerDiagnosticState[];
  logsContext?: IncidentLogsContext;
  metricsTrends?: MetricsTrendsContext;
  configStateChanges?: ConfigStateChangesContext;
  networkContext?: NetworkContext;
  relatedIncidents?: RelatedIncidentsContext;
  temporalContext?: TemporalContext;
  investigationEvidence?: InvestigationEvidenceItem[];
  investigationTimeline?: InvestigationTimelineEvent[];
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
  AITimingMetrics,
  AIVerificationCondition,
  AIVerificationCriteria,
  BlastRadiusScope,
  EvidenceSeverity,
  Incident,
  IncidentSeverity,
  IncidentType,
  IntelligenceAnalysis,
  InvestigationActionPlan,
  InvestigationEvidenceItem,
  InvestigationEvidenceType,
  InvestigationTimelineEvent,
  KubernetesResource,
  RemediationApproval,
  RemediationExecution,
  RemediationStatus,
  RemediationVerification,
  RootCauseProbability,
  RuledOutCause,
  SkyOpsAIAnalysis,
  StructuredInvestigation,
  StructuredRemediation,
  TimelineCausalRelation
};

