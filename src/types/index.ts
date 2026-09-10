export type Role = 'OWNER' | 'ADMIN' | 'ENGINEER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
  membersCount: number;
}

export interface OrgMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  joinedAt: number;
}

export type ClusterStatus =
  | 'pending'
  | 'installing'
  | 'agent_detected'
  | 'waiting_for_confirmation'
  | 'connected'
  | 'offline'
  | 'error'
  | 'HEALTHY'
  | 'WARNING'
  | 'CRITICAL'
  | 'AGENT_OFFLINE'
  | 'UNKNOWN';

export type AgentStatus = 'PENDING' | 'AGENT_DETECTED' | 'WAITING_CONFIRMATION' | 'CONNECTED' | 'DEGRADED' | 'OFFLINE' | 'ERROR';
export type ConnectionState = 'pending' | 'installing' | 'agent_detected' | 'waiting_for_confirmation' | 'connected' | 'offline' | 'error';
export type ConnectionStatus = 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface Cluster {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  status: ClusterStatus;
  agentStatus: AgentStatus;
  connectionState?: ConnectionState;
  connectionStatus?: ConnectionStatus;
  connectionCode?: string;
  connectionCodeExpiresAt?: number;
  agentDetectedAt?: number;
  agentVersion?: string;
  k8sVersion?: string;
  nodeCount: number;
  podCount: number;
  openIncidentCount: number;
  lastHeartbeat?: number;
  lastHeartbeatAt?: number;
  lastSeenAt?: number;
  createdAt: number;
  connectedAt?: number;
  agentToken?: string;
  installKey?: string;
  installKeyExpiresAt?: number;
  isSimulated?: boolean;
}

export type IncidentSeverity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type IncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export type IncidentType =
  | 'CrashLoopBackOff'
  | 'ImagePullBackOff'
  | 'ErrImagePull'
  | 'InvalidImageName'
  | 'CreateContainerConfigError'
  | 'CreateContainerError'
  | 'OOMKilled'
  | 'PodPending'
  | 'PodFailed'
  | 'ExcessiveRestarts'
  | 'ContainerCreatingStuck'
  | 'NodeNotReady'
  | 'NodeMemoryPressure'
  | 'NodeDiskPressure'
  | 'NodePIDPressure'
  | 'DeploymentDegraded'
  | 'DeploymentRolloutStuck'
  | 'StatefulSetDegraded'
  | 'DaemonSetDegraded'
  | 'JobFailed'
  | 'CronJobFailed'
  | 'ServiceNoEndpoints'
  | 'ReadinessProbeFailed'
  | 'LivenessProbeFailed'
  | 'StartupProbeFailed'
  | 'PVCPending'
  | 'PVFailed'
  | 'StorageProvisioningFailed'
  | 'ContainerTerminated'
  | 'PodSchedulingFailed'
  | 'PodPending'
  | 'VolumeMountFailed'
  | 'ServiceNoEndpoints'
  | 'ServiceSelectorMismatch'
  | 'NodeNetworkUnavailable'
  | 'MissingConfigMap'
  | 'MissingSecret';

export interface ContainerDiagnostic {
  name: string;
  image: string;
  restartCount: number;
  ready: boolean;
  state: string;
  waitingReason?: string;
  waitingMessage?: string;
  terminationReason?: string;
  terminationMessage?: string;
  exitCode?: number;
  signal?: number;
  imageId?: string;
  lastTerminationReason?: string;
  lastExitCode?: number;
  memoryLimit?: string;
  memoryRequest?: string;
  cpuLimit?: string;
  cpuRequest?: string;
  memoryUsage?: string;
  cpuUsage?: string;
}

export interface ConditionDiagnostic {
  type: string;
  status: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface TechnicalDetails {
  podName?: string;
  containerName?: string;
  image?: string;
  imageTag?: string;
  restartCount?: number;
  exitCode?: number;
  reason?: string;
  message?: string;
  nodeName?: string;
  containers?: ContainerDiagnostic[];
  conditions?: ConditionDiagnostic[];
  desiredReplicas?: number;
  availableReplicas?: number;
  readyReplicas?: number;
  updatedReplicas?: number;
  events?: K8sEvent[];
  pvcPhase?: string;
  storageClass?: string;
  capacity?: string;
  resourceUid?: string;
  observedState?: string;
  rootCause?: string;
  rootCauseCategory?: string;
  impact?: string;
  recommendation?: string;
  /** Preferred explicit RCA action field; recommendation remains for stored legacy incidents. */
  recommendedAction?: string;
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  relatedResources?: Array<{ kind: string; namespace: string; name: string; uid?: string; relationship: string }>;
  evidence?: Array<{ source: string; reason: string; message: string; timestamp?: number }>;
}

export interface Incident {
  id: string; // e.g. "SKY-0001"
  fingerprint: string;
  orgId: string;
  clusterId: string;
  clusterName: string;
  namespace: string;
  resourceKind: string; // "Pod", "Deployment", "Node", "PVC", etc.
  resourceName: string;
  incidentType: IncidentType;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurrenceCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
  resolvedAt?: number | null;
  technicalDetails: TechnicalDetails;
  assignee?: {
    userId: string;
    name: string;
    email: string;
  };
  updatedAt: number;
  aiAnalysis?: SkyOpsAIAnalysis;
  intelligence?: IntelligenceAnalysis;
  resolutionSource?: 'MANUAL' | 'AUTOMATIC_VERIFIED';
  resolution?: {
    source: 'MANUAL' | 'AUTOMATIC_VERIFIED';
    resolvedAt: number;
    resolvedBy?: {
      id: string;
      name: string;
      email?: string;
    };
    reason?: string;
    verificationDetails?: string;
  };
  confidence?: 'LOW' | 'MEDIUM' | 'HIGH';
  summary?: string;
  rootCauseAnalysis?: string;
}

export type RemediationActionStatus =
  | 'PROPOSED'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'QUEUED'
  | 'DELIVERED'
  | 'ACKNOWLEDGED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'VERIFIED_RESOLVED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'DELIVERY_FAILED'
  | 'EXECUTION_FAILED'
  | 'VERIFICATION_FAILED'
  | 'CANCELLED'
  | 'STALE'
  | 'PENDING'
  | 'DISPATCHED'
  | 'SUCCEEDED'
  | 'FAILED';

export type RemediationMode = 'MANUAL_ONLY' | 'APPROVAL_REQUIRED' | 'CONTROLLED_AUTONOMOUS';

export interface RemediationPolicy {
  orgId: string;
  clusterId?: string;
  remediationMode: RemediationMode;
  allowedActionTypes: string[];
  allowedNamespaces?: string[];
  maxRiskLevel: AIRiskLevel;
  requireHighConfidence: boolean;
  minConfidenceThreshold: number;
  maxAttemptsPerIncident: number;
  maxActionsPerHourPerCluster: number;
  telemetryFreshnessThresholdMs: number;
  actionExpirationMs: number;
  leaseTimeoutMs: number;
  updatedAt: number;
  updatedBy?: { id: string; name: string };
}

/** Canonical Remediation Action Model */
export interface RemediationAction {
  id: string;
  incidentId: string;
  orgId: string;
  clusterId: string;
  clusterName?: string;
  actionType: 'ReplacePodImage' | AIRemediationActionType;
  type: 'ReplacePodImage';
  target: { kind: 'Pod' | string; namespace: string; name: string; container: string };
  fieldPath: string;
  expectedCurrentValue: string;
  proposedValue: string;
  parameters?: {
    containerName: string;
    currentImage: string;
    proposedImage: string;
    [key: string]: unknown;
  };
  groundingEvidence?: Array<{
    source: string;
    reason: string;
    message: string;
    timestamp?: number;
  }>;
  requestedBy?: {
    type: 'AI' | 'USER' | 'SYSTEM' | 'AUTONOMOUS_POLICY';
    id?: string;
    name: string;
  };
  approvingUserId?: string;
  approvingUserName?: string;
  approvedBy?: {
    userId: string;
    name: string;
    email?: string;
  };
  approvedAt?: number;
  status: RemediationActionStatus;
  createdAt: number;
  expiresAt: number;
  executionId: string;
  idempotencyKey: string;
  verificationPlan: {
    expectedState: string;
    conditions?: Array<{ type: string; status: string; description?: string }>;
    observationWindowSeconds: number;
    timeoutSeconds: number;
  };
  rollbackPlan: {
    supported: boolean;
    strategy: string;
    rollbackValue?: string;
  };
  riskLevel: AIRiskLevel;
  isExecutable: boolean;
  unexecutableReason?: string;
  deliveredAt?: number;
  leaseExpiresAt?: number;
  acknowledgedAt?: number;
  executingAt?: number;
  completedAt?: number;
  verifiedAt?: number;
  executionResult?: {
    success: boolean;
    message: string;
    errorCategory?: 'TARGET_NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONTROLLER_OWNED' | 'INVALID_FIELD' | 'K8S_API_ERROR' | 'UNKNOWN';
    details?: string;
    executionId?: string;
  };
  verificationResult?: {
    success: boolean;
    observedState: string;
    evidence?: string[];
    verifiedAt?: number;
    failureReason?: string;
  };
}

export type TimelineEventType =
  | 'DETECTION'
  | 'OCCURRENCE'
  | 'STATE_CHANGE'
  | 'SEVERITY_CHANGE'
  | 'ASSIGNMENT'
  | 'NOTE_ADDED'
  | 'RECOVERY'
  | 'MANUAL_UPDATE'
  | 'REMEDIATION_PROPOSED'
  | 'REMEDIATION_APPROVED'
  | 'REMEDIATION_QUEUED'
  | 'REMEDIATION_LEASED'
  | 'REMEDIATION_EXECUTING'
  | 'REMEDIATION_EXECUTED'
  | 'REMEDIATION_FAILED'
  | 'REMEDIATION_VERIFYING'
  | 'REMEDIATION_VERIFIED'
  | 'REMEDIATION_VERIFICATION_FAILED'
  | 'REMEDIATION_CANCELLED'
  | 'REMEDIATION_EXPIRED'
  | 'CIRCUIT_BREAKER_TRIPPED'
  | 'AUTOMATIC_ACTION';

export interface TimelineEvent {
  id: string;
  incidentId: string;
  type: TimelineEventType;
  timestamp: number;
  actor: {
    type: 'SYSTEM' | 'AGENT' | 'USER';
    id?: string;
    name: string;
  };
  description: string;
  metadata?: Record<string, unknown>;
}

export interface IncidentNote {
  id: string;
  incidentId: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
  content: string;
  createdAt: number;
}

export interface K8sEvent {
  id: string;
  timestamp: number;
  type: 'Normal' | 'Warning';
  reason: string;
  objectKind: string;
  objectName: string;
  namespace: string;
  message: string;
  count?: number;
}

export interface KubernetesResource {
  id: string;
  clusterId: string;
  clusterName?: string;
  kind: string;
  namespace: string;
  name: string;
  status: string;
  health: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  createdAt: number;
  updatedAt: number;
  specSummary: Record<string, unknown>;
  statusSummary: Record<string, unknown>;
  conditions?: ConditionDiagnostic[];
  containers?: ContainerDiagnostic[];
  events?: K8sEvent[];
  uid?: string;
  apiVersion?: string;
  nodeName?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: Array<{ uid?: string; kind?: string; name?: string; controller?: boolean }>;
  metrics?: ResourceMetrics;
  observedAt?: number;
  ingestedAt?: number;
}

// ==========================================
// Deep Observability & Resource Metrics Model
// ==========================================

export interface ResourceMetricValue {
  value: number; // millicores for CPU, bytes for memory
  unit: 'millicores' | 'bytes';
  formatted: string; // e.g. "250m" or "512 MiB"
}

export interface ContainerResourceMetrics {
  name: string;
  cpu?: {
    request?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    usage?: ResourceMetricValue;
  };
  memory?: {
    request?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    usage?: ResourceMetricValue;
  };
  isUsageAvailable: boolean;
}

export type MetricsFreshnessStatus = 'FRESH' | 'DELAYED' | 'STALE' | 'UNAVAILABLE';

export interface ResourceMetrics {
  clusterId: string;
  resourceKind: 'Cluster' | 'Node' | 'Workload' | 'Pod';
  resourceName: string;
  namespace?: string;
  cpu: {
    capacity?: ResourceMetricValue;
    allocatable?: ResourceMetricValue;
    request?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    usage?: ResourceMetricValue;
    utilizationPercent?: number; // Calculated only when real usage and allocatable (or limit) exist
  };
  memory: {
    capacity?: ResourceMetricValue;
    allocatable?: ResourceMetricValue;
    request?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    usage?: ResourceMetricValue;
    utilizationPercent?: number;
  };
  containers?: ContainerResourceMetrics[];
  observedAt: number;
  ingestedAt: number;
  freshnessStatus: MetricsFreshnessStatus;
  metricsSource?: 'METRICS_SERVER' | 'KUBELET' | 'SPEC_STATUS_ONLY';
  isUsageAvailable: boolean;
  unavailableReason?: string;
}

export interface NodeMetricsSummary extends ResourceMetrics {
  nodeName: string;
  kubeletVersion?: string;
  ready: boolean;
  podCount: number;
  podCapacity: number;
  conditions: {
    memoryPressure: boolean;
    diskPressure: boolean;
    pidPressure: boolean;
    ready: boolean;
  };
}

export interface WorkloadMetricsSummary extends ResourceMetrics {
  workloadKind: string;
  desiredReplicas: number;
  readyReplicas: number;
  childPodCount: number;
}

export interface ClusterObservabilityMetrics {
  clusterId: string;
  clusterName: string;
  observedAt: number;
  ingestedAt: number;
  freshnessStatus: MetricsFreshnessStatus;
  isUsageAvailable: boolean;
  metricsSource?: 'METRICS_SERVER' | 'SPEC_STATUS_ONLY';
  unavailableReason?: string;
  nodeCount: number;
  podCount: number;
  cpu: {
    capacity: ResourceMetricValue;
    allocatable: ResourceMetricValue;
    request: ResourceMetricValue;
    limit: ResourceMetricValue;
    usage?: ResourceMetricValue;
    utilizationPercent?: number;
  };
  memory: {
    capacity: ResourceMetricValue;
    allocatable: ResourceMetricValue;
    request: ResourceMetricValue;
    limit: ResourceMetricValue;
    usage?: ResourceMetricValue;
    utilizationPercent?: number;
  };
  nodes: NodeMetricsSummary[];
  workloads: WorkloadMetricsSummary[];
}

export interface MetricHistoryPoint {
  timestamp: number;
  cpuUsageMillicores?: number;
  cpuRequestMillicores: number;
  cpuCapacityMillicores: number;
  memoryUsageBytes?: number;
  memoryRequestBytes: number;
  memoryCapacityBytes: number;
  isUsageAvailable: boolean;
}

export interface OverviewMetrics {
  totalClusters: number;
  healthyClusters: number;
  warningClusters: number;
  criticalClusters: number;
  offlineClusters: number;
  openIncidents: number;
  criticalIncidents: number;
  highIncidents: number;
  mediumIncidents: number;
  lowIncidents: number;
  resolvedTodayCount: number;
  totalNodes?: number;
  totalPods?: number;
  totalWorkloads?: number;
  degradedWorkloads?: number;
  crashingPods?: number;
  connectedAgents?: number;
  offlineAgents?: number;
}

export interface AgentManifestsResponse {
  clusterId: string;
  clusterName: string;
  token: string;
  connectionCode?: string;
  installKey?: string;
  serverUrl: string;
  agentVersion: string;
  namespace: string;
  kubectlManifest: string;
  oneCommandInstall?: string;
  helmCommand: string;
  installCommand?: string;
  manifestDownloadUrl?: string;
}

// ==========================================
// SkyOps AI Intelligence & Controlled Remediation Layer Types
// ==========================================

export type AIRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AIAnalysisStatus = 'SUCCESS' | 'UNAVAILABLE' | 'FAILED' | 'CACHED' | 'RATE_LIMITED';

export type AIRemediationActionType =
  | 'UPDATE_CONTAINER_IMAGE'
  | 'REVERT_TAG'
  | 'ROLLOUT_RESTART'
  | 'RESOURCE_RESIZING'
  | 'SCALE_REPLICAS'
  | 'CONFIG_REVISION'
  | 'MANUAL_INSPECTION'
  | 'UNSPECIFIED'
  | 'ReplacePodImage';

export type RemediationStatus =
  | 'PROPOSED'
  | 'APPROVED'
  | 'REJECTED'
  | 'DISPATCHED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'VERIFYING'
  | 'VERIFIED_RESOLVED'
  | 'VERIFICATION_FAILED'
  | 'FAILED';

export interface RemediationApproval {
  approvedBy: {
    userId: string;
    name: string;
    email?: string;
  };
  approvedAt: number;
  comments?: string;
  overrides?: Record<string, unknown>;
}

export interface RemediationExecution {
  dispatchedAt?: number;
  executedAt?: number;
  agentVersion?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  message?: string;
  appliedChanges?: Record<string, unknown>;
}

export interface RemediationVerification {
  verifiedAt?: number;
  status: 'PENDING' | 'VERIFIED_RESOLVED' | 'VERIFICATION_FAILED';
  observedState?: string;
  details?: string;
  checkCount?: number;
}

export type AIEvidenceCategory = 'OBSERVED_FACT' | 'AI_INFERENCE' | 'PROPOSED_CHANGE';

export interface AIEvidenceItem {
  source: string;
  detail: string;
  category?: AIEvidenceCategory;
}

export interface AIAffectedResource {
  kind: string;
  namespace: string;
  name: string;
  uid?: string;
}

export interface AIChangePreview {
  resource: string; // e.g. "Deployment", "Pod", "StatefulSet"
  namespace: string; // e.g. "default", "production"
  object: string; // e.g. "frontend-checkout", "api-gateway"
  container?: string; // e.g. "checkout-api", "nginx"
  field: string; // e.g. "spec.template.spec.containers[0].image"
  currentValue: string; // e.g. "registry.internal.corp/checkout:v2.4.1-typo"
  proposedValue: string; // e.g. "registry.internal.corp/checkout:v2.4.0"
}

export interface AIVerificationCondition {
  type: string; // e.g. "Ready", "ContainersReady", "PodScheduled"
  status: string; // e.g. "True"
  description?: string;
}

export interface AIVerificationCriteria {
  expectedState: string; // e.g. "Pod phase Running and all container ready probes passing"
  conditions: AIVerificationCondition[];
  observationWindowSeconds?: number; // e.g. 30
}

export interface AIRemediationAction {
  type: AIRemediationActionType;
  targetResource?: AIAffectedResource;
  parameters?: Record<string, unknown>;
}

export interface AIRecommendedFix {
  description: string;
  reason: string;
  risk: AIRiskLevel;
  expectedImpact: string;
  rollback: string;
  action?: AIRemediationAction;
}

export interface AISaferAlternative {
  description: string;
  reason: string;
}

export interface StructuredRemediation {
  id: string; // e.g. "REM-SKY-0001-1"
  incidentId: string;
  orgId: string;
  clusterId: string;
  clusterName: string;
  status: RemediationStatus;
  actionType: AIRemediationActionType;
  targetResource: AIAffectedResource;
  parameters: {
    containerName: string;
    currentImage: string;
    proposedImage: string;
    [key: string]: unknown;
  };
  isExecutable?: boolean;
  unexecutableReason?: string;
  changePreview?: AIChangePreview;
  verificationCriteria?: AIVerificationCriteria;
  reasoning: {
    summary: string;
    rootCause: string;
    whyRecommended: string;
    risk: AIRiskLevel;
    riskExplanation?: string;
    expectedImpact: string;
    rollbackStrategy: string;
    saferAlternative?: string;
    confidence: number;
    confidenceExplanation?: string;
    explanation?: string;
    rollbackPlan?: string;
  };
  approval?: RemediationApproval;
  execution?: RemediationExecution;
  verification?: RemediationVerification;
  createdAt: number;
  updatedAt: number;
}

export interface AITimingMetrics {
  requestReceivedAt: number;
  contextConstructedAt: number;
  geminiRequestStartedAt?: number;
  geminiResponseReceivedAt?: number;
  structuredParsedAt?: number;
  safetyValidatedAt?: number;
  responseReturnedAt: number;
  durations: {
    contextConstructionMs: number;
    geminiCallMs?: number;
    parsingMs?: number;
    safetyValidationMs: number;
    totalMs: number;
  };
}

export interface SkyOpsAIAnalysis {
  incidentId: string;
  summary: string; // 1. What happened? Observable failure
  rootCause: string; // 2. Root cause based on evidence
  confidence: number; // 3. Confidence score 0.0 to 1.0
  confidenceExplanation?: string; // 3. Explanation of confidence & supporting evidence
  evidence: AIEvidenceItem[]; // 4. Corroborating evidence (OBSERVED FACT / AI INFERENCE / PROPOSED CHANGE)
  affectedResources: AIAffectedResource[];
  recommendedFix: AIRecommendedFix; // 5. Recommended safest fix
  changePreview?: AIChangePreview; // 6. Exact change preview (resource -> namespace -> object -> container -> field -> current -> proposed)
  expectedImpact?: string; // 7. Expected impact (downtime/restarts, affected resources)
  riskExplanation?: string; // 8. Risk classification & explanation
  rollback?: string; // 9. Rollback procedure
  verificationCriteria?: AIVerificationCriteria; // 10. Verification Kubernetes conditions
  saferAlternative: AISaferAlternative;
  structuredRemediation?: StructuredRemediation;
  requiresApproval: boolean;
  additionalEvidenceNeeded: string[];
  analyzedAt: number;
  provider: string;
  model: string;
  status: AIAnalysisStatus;
  errorMessage?: string;
  executionSafe: boolean; // Flag verifying deterministic safety policy was applied
  timing?: AITimingMetrics; // Millisecond latency breakdown across all pipeline stages
  intelligence?: IntelligenceAnalysis; // Deterministic intelligence engine analysis
}

// ==========================================
// SkyOps Structured Intelligence Engine Types
// ==========================================

export type SignalCategory =
  | 'FACT'
  | 'DERIVED_FACT'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'RECOMMENDATION'
  | 'EXECUTABLE_ACTION'
  | 'VERIFIED_RESULT';

export type HypothesisStatus =
  | 'CONFIRMED'
  | 'PLAUSIBLE'
  | 'REFUTED'
  | 'INSUFFICIENT_EVIDENCE';

export interface CorrelatedSignal {
  id: string;
  category: SignalCategory;
  source: 'kubelet' | 'events' | 'metrics' | 'spec' | 'status' | 'engine';
  resourceKind: string;
  resourceName: string;
  namespace?: string;
  property: string;
  value: unknown;
  description: string;
  timestamp: number;
  weight?: number; // 1 to 5 relative significance
}

export type ResourceRelationType =
  | 'OWNED_BY'
  | 'SCHEDULED_ON'
  | 'MOUNTS_PVC'
  | 'BACKED_BY_STORAGE_CLASS'
  | 'EXPOSED_BY_SERVICE'
  | 'CONTROLS_POD'
  | 'PEER_ON_NODE';

export interface ResourceRelationship {
  source: {
    kind: string;
    name: string;
    namespace?: string;
    status?: string;
  };
  target: {
    kind: string;
    name: string;
    namespace?: string;
    status?: string;
  };
  relation: ResourceRelationType;
  details?: string;
  isImpacted?: boolean;
}

export interface EvidencePoint {
  id: string;
  signalId?: string;
  description: string;
  source: string;
  weight: number;
  timestamp?: number;
}

export interface RootCauseHypothesis {
  id: string;
  title: string;
  category: string;
  description: string;
  score: number; // 0 to 100
  status: HypothesisStatus;
  supportingEvidence: EvidencePoint[];
  contradictingEvidence: EvidencePoint[];
  whySelectedOrRejected: string;
}

export interface CorrelatedTimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  category: SignalCategory;
  description: string;
  source: string;
  resourceKind: string;
  resourceName: string;
}

export interface ExplainabilityReport {
  whySelected: string;
  rejectedAlternatives: Array<{
    id: string;
    title: string;
    reason: string;
    score: number;
  }>;
  evidenceSummary: {
    factCount: number;
    derivedFactCount: number;
    inferenceCount: number;
    supportingScore: number;
    contradictingScore: number;
  };
  missingEvidence?: string[];
}

export interface ExecutableActionProposal {
  actionType: string;
  targetResource: {
    kind: string;
    name: string;
    namespace: string;
    container?: string;
  };
  fieldPath: string;
  currentValue: string;
  proposedValue: string;
  isExecutable: boolean;
  reason: string;
}

export interface IntelligenceAnalysis {
  incidentId: string;
  incidentType: IncidentType;
  fingerprint: string;
  clusterId: string;
  clusterName: string;
  analyzedAt: number;
  rootCause: string;
  rootCauseCategory: string;
  confidence: number; // 0.0 to 1.0
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  confidenceExplanation: string;
  primaryHypothesis: RootCauseHypothesis | null;
  evaluatedHypotheses: RootCauseHypothesis[];
  signals: CorrelatedSignal[];
  relationships: ResourceRelationship[];
  correlatedTimeline: CorrelatedTimelineEvent[];
  explainability: ExplainabilityReport;
  recommendation: string;
  executableProposal?: ExecutableActionProposal;
  isUnknownOrInconclusive: boolean;
}



