export type Role = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'ENGINEER' | 'VIEWER';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface UserNotificationSettings {
  incidentEmailEnabled: boolean;
  email: string;
  updatedAt?: number;
}

export interface NotificationDeliveryRecord {
  id: string;
  incidentId: string;
  recipient: string;
  subject: string;
  status: 'SENT' | 'FAILED' | 'DUPLICATE_SUPPRESSED';
  messageId?: string;
  error?: string;
  timestamp: number;
}

export interface OrganizationSettings {
  general?: {
    name?: string;
    timezone?: string;
  };
  notifications?: {
    incidentEmailEnabled?: boolean;
    digestEmailEnabled?: boolean;
    alertSeverityThreshold?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    webhookUrl?: string;
  };
  security?: {
    enforceMfa?: boolean;
    sessionTimeoutMinutes?: number;
  };
}

export type OrgStatus = 'ACTIVE' | 'SUSPENDED';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status?: OrgStatus;
  createdAt: number;
  updatedAt?: number;
  membersCount: number;
  ownerUserId?: string;
  settings?: OrganizationSettings;
}

export type OrgMemberStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';

// --- Subscription, Plans, Billing & Entitlements ---
export type PlanId = 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';

export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'GRACE_PERIOD'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED';

export interface PlanLimits {
  clusters: number;
  nodes: number;
  workloads: number;
  members: number;
  dataRetentionDays: number;
  telemetryRetentionDays?: number;
  aiInvestigationsMonthly: number;
  aiMonthlyAllowance?: number;
  remediationsMonthly: number;
  auditLogsDays: number;
  auditRetentionDays?: number;
  storageGb?: number;
}

export interface PlanFeatures {
  incidentDetection: boolean;
  metrics: boolean;
  events: boolean;
  logs: 'basic' | 'standard' | 'full' | 'custom';
  incidentCorrelation: 'basic' | 'advanced' | 'custom';
  rca: 'basic' | 'advanced' | 'custom';
  remediationRecommendations: 'limited' | 'enabled' | 'custom';
  automatedRemediation: boolean | 'disabled' | 'limited' | 'enabled' | 'full' | 'custom';
  notifications: 'basic' | 'advanced' | 'custom';
  webhooks: boolean;
  rbac: 'basic' | 'standard' | 'advanced' | 'custom';
  support: 'community' | 'standard' | 'priority' | 'dedicated_sla';
  geminiRootCauseAnalysis?: boolean;
  autonomousRemediation?: boolean;
  customWebhooks?: boolean;
  auditLogExport?: boolean;
  emailAlerts?: boolean;
  ssoSaml?: boolean;
}

export interface PlanIntervalPricing {
  interval: BillingInterval;
  label: string;
  durationMonths: number;
  totalPrice: number; // in INR
  monthlyEquivalent: number;
  savings: number;
  savingsPercentage: number;
  currency: string;
}

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  description: string;
  badge?: string;
  recommended?: boolean;
  currency?: string;
  razorpayPlanIds?: Partial<Record<BillingInterval, string>>;
  pricing: Record<BillingInterval, PlanIntervalPricing>;
  limits: PlanLimits;
  features: PlanFeatures;
  highlights: string[];
}

export interface Subscription {
  id: string;
  organizationId: string;
  planId: PlanId;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  startedAt: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialStartedAt?: number;
  trialEndsAt?: number;
  cancelAtPeriodEnd: boolean;
  canceledAt?: number;
  provider: string; // 'mock' | 'stripe' | 'razorpay'
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerPlanId?: string;
  latestPaymentId?: string;
  latestInvoiceId?: string;
  nextBillingAt?: number;
  paidAt?: number;
  activatedAt?: number;
  customLimits?: Partial<PlanLimits>;
  createdAt: number;
  updatedAt: number;
}

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export interface Invoice {
  id: string;
  organizationId: string;
  subscriptionId: string;
  providerInvoiceId?: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: number;
  dueAt: number;
  paidAt?: number;
  invoiceUrl?: string;
  description: string;
  planId: PlanId;
  billingInterval: BillingInterval;
  createdAt: number;
}

export interface PlanLimitError {
  code: 'PLAN_LIMIT_REACHED';
  error: string;
  resource: string;
  current: number;
  limit: number;
  plan: PlanId;
  upgradeRequired: boolean;
}

export interface OrgBillingOverview {
  subscription: Subscription;
  plan: Plan;
  entitlements: {
    limits: PlanLimits;
    features: PlanFeatures;
  };
  usage: {
    clusters: { current: number; limit: number; percentage: number };
    nodes: { current: number; limit: number; percentage: number };
    workloads: { current: number; limit: number; percentage: number };
    members: { current: number; limit: number; percentage: number };
    aiInvestigations: { current: number; limit: number; percentage: number };
    remediations: { current: number; limit: number; percentage: number };
    retentionDays: number;
  };
  invoices: Invoice[];
  isTrial: boolean;
  trialDaysRemaining?: number;
}

export interface OrgMember {
  userId: string;
  orgId?: string;
  email: string;
  name: string;
  role: Role;
  status?: OrgMemberStatus;
  joinedAt: number;
  createdAt?: number;
  updatedAt?: number;
  lastActiveAt?: number;
}

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export interface OrgInvitation {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  token: string;
  status: InvitationStatus;
  invitedByUserId: string;
  invitedByEmail: string;
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  revokedAt?: number;
}

export type TicketCategory = 'INCIDENT' | 'AGENT' | 'PLATFORM' | 'BILLING_QUERY' | 'GENERAL';
export type TicketSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface SupportTicket {
  id: string;
  orgId: string;
  userId: string;
  userName: string;
  userEmail: string;
  subject: string;
  category: TicketCategory;
  severity: TicketSeverity;
  description: string;
  clusterId?: string;
  incidentId?: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
}

export interface OrgUsageMetrics {
  orgId: string;
  calculatedAt: number;
  periodStart: number;
  periodEnd: number;
  clusters: {
    total: number;
    connected: number;
    disconnected: number;
  };
  nodes: {
    total: number;
    ready: number;
  };
  pods: {
    total: number;
    running: number;
  };
  incidents: {
    active: number;
    resolvedLast30Days: number;
    totalDetected: number;
  };
  remediations: {
    proposalsGenerated: number;
    proposalsExecuted: number;
    proposalsRejected: number;
  };
  telemetry: {
    dataPointsIngested: number;
    storageUsageBytes: number;
  };
  auditLogs: {
    totalEvents: number;
  };
  team: {
    activeMembers: number;
    pendingInvitations: number;
  };
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

export type AgentStatus = 'PENDING' | 'AGENT_DETECTED' | 'WAITING_CONFIRMATION' | 'CONNECTED' | 'RECONNECTING' | 'STALE' | 'DEGRADED' | 'OFFLINE' | 'ERROR';
export type ConnectionState = 'pending' | 'installing' | 'agent_detected' | 'waiting_for_confirmation' | 'connected' | 'reconnecting' | 'stale' | 'offline' | 'error';
export type ConnectionStatus = 'pending' | 'connecting' | 'connected' | 'reconnecting' | 'stale' | 'disconnected' | 'error';

export interface Cluster {
  id: string;
  orgId: string;
  name: string;
  description?: string;
  environment?: string;
  region?: string;
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
  updatedAt?: number;
  connectedAt?: number;
  agentToken?: string;
  installKey?: string;
  installKeyExpiresAt?: number;
  isSimulated?: boolean;
  isLastKnownState?: boolean;
  lastTelemetrySnapshot?: number;
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
  | 'HighCPU'
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
  | 'ServiceBackingPodsNotReady'
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
  logs?: string;
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
  selector?: Record<string, string>;
  matchingPodsCount?: number;
  unreadyBackingPodsCount?: number;
  unreadyPods?: Array<{ name: string; phase: string; reason?: string; waitingReason?: string }>;
  [key: string]: unknown;
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
  affectedPodNames?: string[];
  createdAt?: number;
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
  | 'FAILED'
  | 'ROLLED_BACK';

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
  | 'REMEDIATION_ROLLBACK_DISPATCHED'
  | 'REMEDIATION_ROLLED_BACK'
  | 'REMEDIATION_ROLLBACK_FAILED'
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
  source?: string;
  firstObserved?: number;
  lastObserved?: number;
  lastTimestamp?: number;
  involvedObject?: {
    kind?: string;
    namespace?: string;
    name?: string;
    uid?: string;
    apiVersion?: string;
  };
}

export interface PodLogLine {
  timestamp?: string;
  message: string;
  raw: string;
}

export interface PodLogsResponse {
  clusterId: string;
  namespace: string;
  podName: string;
  container: string;
  previous: boolean;
  timestamps: boolean;
  lines: PodLogLine[];
  rawText: string;
  totalLines: number;
  source: string;
  retrievedAt: number;
  isTruncated?: boolean;
  unavailableReason?: string;
  statusCategory?:
    | 'SUCCESS'
    | 'EMPTY_LOGS'
    | 'NO_LOGS'
    | 'AGENT_DISCONNECTED'
    | 'PERMISSION_DENIED'
    | 'POD_NOT_FOUND'
    | 'CONTAINER_NOT_FOUND'
    | 'CONTAINER_WAITING'
    | 'POD_INITIALIZING'
    | 'PREVIOUS_LOGS_UNAVAILABLE'
    | 'K8S_API_ERROR'
    | 'KUBERNETES_API_UNAVAILABLE'
    | 'TIMEOUT'
    | 'UNKNOWN_ERROR';
  waitingReason?: string;
  waitingMessage?: string;
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
  specSummary?: Record<string, unknown>;
  statusSummary?: Record<string, unknown>;
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
  cpuUsage?: number;
  memoryUsage?: number;
  restartCount?: number;
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
  name?: string;
  kubeletVersion?: string;
  ready: boolean;
  podCount: number;
  podCapacity: number;
  conditions: any;
  conditionFlags?: any;
  cpuUsage?: string;
  cpuPercent?: number;
  memoryUsage?: string;
  memoryPercent?: number;
  cpu: {
    capacity?: ResourceMetricValue;
    allocatable?: ResourceMetricValue;
    request?: ResourceMetricValue;
    requests?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    limits?: ResourceMetricValue;
    usage?: ResourceMetricValue;
    requestedPercent?: number;
    utilizationPercent?: number;
  };
  memory: {
    capacity?: ResourceMetricValue;
    allocatable?: ResourceMetricValue;
    request?: ResourceMetricValue;
    requests?: ResourceMetricValue;
    limit?: ResourceMetricValue;
    limits?: ResourceMetricValue;
    usage?: ResourceMetricValue;
    requestedPercent?: number;
    utilizationPercent?: number;
  };
}

export interface WorkloadMetricsSummary extends ResourceMetrics {
  workloadKind: string;
  kind?: string;
  name?: string;
  desiredReplicas: number;
  readyReplicas: number;
  childPodCount: number;
  podCount?: number;
  hasPodsWithoutLimits?: boolean;
  isNearMemoryLimit?: boolean;
  usageAvailable?: boolean;
  totalCpuRequests?: ResourceMetricValue;
  totalCpuLimits?: ResourceMetricValue;
  totalCpuUsage?: ResourceMetricValue;
  totalMemoryRequests?: ResourceMetricValue;
  totalMemoryLimits?: ResourceMetricValue;
  totalMemoryUsage?: ResourceMetricValue;
}

export interface ClusterObservabilityMetrics {
  clusterId: string;
  clusterName: string;
  observedAt: number;
  ingestedAt: number;
  freshnessStatus: MetricsFreshnessStatus;
  isUsageAvailable: boolean;
  metricsSource?: 'METRICS_SERVER' | 'SPEC_STATUS_ONLY';
  source?: string;
  unavailableReason?: string;
  nodeCount: number;
  podCount: number;
  commitmentRatios?: {
    cpuRequestedPercent?: number;
    cpuLimitPercent?: number;
    cpuUsagePercent?: number;
    memoryRequestedPercent?: number;
    memoryLimitPercent?: number;
    memoryUsagePercent?: number;
  };
  cpu: {
    capacity: ResourceMetricValue;
    allocatable: ResourceMetricValue;
    request: ResourceMetricValue;
    limit: ResourceMetricValue;
    usage?: ResourceMetricValue;
    totalCapacity?: ResourceMetricValue;
    totalAllocatable?: ResourceMetricValue;
    totalRequests?: ResourceMetricValue;
    totalLimits?: ResourceMetricValue;
    totalUsage?: ResourceMetricValue;
    usageAvailable?: boolean;
    utilizationPercent?: number;
  };
  memory: {
    capacity: ResourceMetricValue;
    allocatable: ResourceMetricValue;
    request: ResourceMetricValue;
    limit: ResourceMetricValue;
    usage?: ResourceMetricValue;
    totalCapacity?: ResourceMetricValue;
    totalAllocatable?: ResourceMetricValue;
    totalRequests?: ResourceMetricValue;
    totalLimits?: ResourceMetricValue;
    totalUsage?: ResourceMetricValue;
    usageAvailable?: boolean;
    utilizationPercent?: number;
  };
  nodes: NodeMetricsSummary[];
  workloads: WorkloadMetricsSummary[];
}

export interface MetricHistoryPoint {
  timestamp: number;
  cpuUsageMillicores?: number;
  cpuRequestMillicores?: number;
  cpuCapacityMillicores: number;
  cpuAllocatableMillicores?: number;
  cpuLimitMillicores?: number;
  cpuRequestedPercent?: number;
  cpuLimitPercent?: number;
  cpuUsagePercent?: number;
  memoryUsageBytes?: number;
  memoryRequestBytes?: number;
  memoryCapacityBytes: number;
  memoryAllocatableBytes?: number;
  memoryLimitBytes?: number;
  memoryRequestedPercent?: number;
  memoryLimitPercent?: number;
  memoryUsagePercent?: number;
  isUsageAvailable: boolean;
  source?: string;
  // Phase 2 smart rollups & intelligence annotations:
  cpuUsageMinMillicores?: number;
  cpuUsageMaxMillicores?: number;
  cpuUsageAvgMillicores?: number;
  memoryUsageMinBytes?: number;
  memoryUsageMaxBytes?: number;
  memoryUsageAvgBytes?: number;
  sampleCount?: number;
  resolution?: 'raw' | '1m' | '5m' | '1h';
  incidentId?: string;
  pinned?: boolean;
}

export interface SpecChangePoint {
  timestamp: number;
  cpuRequestMillicores: number;
  cpuLimitMillicores?: number;
  cpuAllocatableMillicores?: number;
  cpuCapacityMillicores: number;
  memoryRequestBytes: number;
  memoryLimitBytes?: number;
  memoryAllocatableBytes?: number;
  memoryCapacityBytes: number;
  nodeCount: number;
  podCount: number;
  changeReason?: string;
}

export interface TelemetryQueryOptions {
  range?: '15m' | '1h' | '6h' | '24h' | '7d';
  resolution?: 'auto' | 'raw' | '1m' | '5m' | '1h';
  limit?: number;
  includeRaw?: boolean;
}

export interface TelemetrySummary {
  dataPointsCount: number;
  rawObservationsCount: number;
  specChangesCount: number;
  avgCpuUsagePercent?: number;
  peakCpuUsagePercent?: number;
  avgMemoryUsagePercent?: number;
  peakMemoryUsagePercent?: number;
  currentCpuRequestPercent?: number;
  currentCpuLimitPercent?: number;
  currentMemoryRequestPercent?: number;
  currentMemoryLimitPercent?: number;
  unavailableReason?: string;
}

export interface TelemetryResponse {
  clusterId: string;
  timeRange: string;
  resolution: string;
  isUsageAvailable: boolean;
  metricsSource: 'METRICS_SERVER' | 'SPEC_STATUS_ONLY' | 'UNAVAILABLE';
  runtimeStatus: 'LIVE' | 'UNAVAILABLE' | 'STALE';
  unavailableReason?: string;
  summary: TelemetrySummary;
  points: MetricHistoryPoint[];
  rawObservations?: MetricHistoryPoint[];
  specHistory?: SpecChangePoint[];
  anomalies?: TelemetryAnomaly[];
}

export interface ResourceBaseline {
  clusterId: string;
  calculatedAt: number;
  windowRange: string;
  sampleSize: number;
  status?: 'AVAILABLE' | 'INSUFFICIENT_EVIDENCE' | 'UNAVAILABLE';
  quality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INSUFFICIENT_HISTORY';
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  explanation?: string;
  cpu: {
    avgPercent?: number;
    p95Percent?: number;
    maxPercent?: number;
    minPercent?: number;
    stdDevPercent?: number;
    expectedPercent?: number;
    normalRange?: [number, number];
  };
  memory: {
    avgPercent?: number;
    p95Percent?: number;
    maxPercent?: number;
    minPercent?: number;
    stdDevPercent?: number;
    expectedPercent?: number;
    normalRange?: [number, number];
  };
}

export interface TelemetryAnomaly {
  id?: string;
  type: 'CPU_SPIKE' | 'MEMORY_LEAK_TREND' | 'NEAR_SATURATION' | 'SPEC_OVERCOMMITMENT' | 'STALE_METRICS' | 'RESTART_ACCELERATION' | 'NODE_PRESSURE' | 'WORKLOAD_DEGRADATION';
  status?: 'NORMAL' | 'ANOMALOUS' | 'UNKNOWN' | 'INSUFFICIENT_EVIDENCE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  detectedAt: number;
  metric: 'cpu' | 'memory' | 'restarts' | 'nodes' | 'all';
  currentValue?: number;
  observedValue?: number | string;
  expectedValue?: number | string;
  threshold?: number;
  deviationReason?: string;
  timeWindow?: string;
  source?: string;
  confidence?: number;
  evidenceReferences?: string[];
  resource?: {
    kind: string;
    name: string;
    namespace?: string;
  };
}

export type MetricsServerStateType =
  | 'ACTIVE'
  | 'INSTALLED_NOT_REPORTING'
  | 'NOT_INSTALLED'
  | 'INSTALLED_NOT_READY'
  | 'READY_NO_METRICS'
  | 'READY_WITH_METRICS'
  | 'PERMISSION_DENIED'
  | 'API_UNAVAILABLE'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface MetricsServerVerificationEvidence {
  deploymentFound: boolean;
  deploymentName?: string;
  deploymentNamespace?: string;
  deploymentReady: boolean;
  readyReplicas?: number;
  expectedReplicas?: number;
  podReady: boolean;
  podPhase?: string;
  podName?: string;
  apiReachable: boolean;
  nodeMetricsAvailable: boolean;
  nodeMetricsCount?: number;
  podMetricsAvailable: boolean;
  podMetricsCount?: number;
  lastVerifiedAt?: number;
  verifiedAt?: number | string;
  rawError?: string;
  category?: string;
  whatHappened?: string;
  why?: string;
  impact?: string;
  nextAction?: string;
}

export interface MetricsServerStatus {
  clusterId: string;
  clusterName: string;
  isInstalled: boolean;
  isActive: boolean;
  status: MetricsServerStateType;
  clusterVersion: string;
  preflight: {
    connected: boolean;
    versionCompatible: boolean;
    rbacReady: boolean;
  };
  commands: {
    kubectl: string;
    kubectlInsecureTls: string;
    helm: string;
    helmInsecureTls?: string;
  };
  diagnostics: string[];
  verification?: MetricsServerVerificationEvidence;
  whatHappened?: string;
  why?: string;
  impact?: string;
  nextAction?: string;
  rawError?: string;
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
  | 'FAILED'
  | 'ROLLED_BACK';

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
  expectedStatus?: string;
  conditions: AIVerificationCondition[];
  observationWindowSeconds?: number; // e.g. 30
  observationPeriodSeconds?: number;
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
  rollbackPlan?: {
    supported: boolean;
    strategy?: string;
    rollbackValue?: string;
  };
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
  // --- Enhanced Investigation System Fields ---
  investigation?: StructuredInvestigation;
  investigationEvidence?: InvestigationEvidenceItem[];
  investigationTimeline?: InvestigationTimelineEvent[];
  rootCauseProbabilities?: RootCauseProbability[];
  ruledOutCauses?: RuledOutCause[];
  blastRadius?: BlastRadiusScope;
  recommendedCommands?: Array<{
    command: string;
    description: string;
    stage?: 'pre-check' | 'remediate' | 'verify' | 'rollback';
  }>;
}

// ==========================================
// SkyOps Structured Investigation Engine Types
// ==========================================

export type InvestigationEvidenceType = 'FACT' | 'INFERENCE' | 'HYPOTHESIS' | 'UNKNOWN';
export type EvidenceSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface InvestigationEvidenceItem {
  id: string; // e.g. "EV-001"
  type: InvestigationEvidenceType;
  source: string; // e.g. "pod_status", "container_logs", "kubernetes_event", "metrics", "controller_spec", "node_condition"
  timestamp: number;
  description: string;
  severity?: EvidenceSeverity;
  rawValue?: any;
  confidence: number; // 0 to 100
  supportingHypotheses?: string[];
  refutingHypotheses?: string[];
}

export type TimelineCausalRelation = 'TRIGGER' | 'SYMPTOM' | 'CONSEQUENCE' | 'RECOVERY_ATTEMPT' | 'UNKNOWN';

export interface InvestigationTimelineEvent {
  id: string;
  timestamp: number;
  title: string;
  description: string;
  category: SignalCategory;
  source: string;
  resourceKind: string;
  resourceName: string;
  namespace?: string;
  temporalDistance?: string; // e.g. "-2m 14s before onset"
  causalRelation: TimelineCausalRelation;
  correlationScore: number; // 0 to 100
}

export interface RootCauseProbability {
  cause: string;
  probabilityPercent: number; // 0 to 100
  explanation: string;
  isPrimary: boolean;
  citedEvidenceIds: string[];
}

export interface RuledOutCause {
  cause: string;
  reasonRuledOut: string;
  contradictingEvidenceIds: string[];
}

export type BlastRadiusScope = 'ISOLATED_CONTAINER' | 'SINGLE_POD' | 'WORKLOAD_ROLLOUT' | 'NAMESPACE_WIDE' | 'CLUSTER_WIDE';

export interface InvestigationActionPlan {
  title: string;
  description: string;
  actionType: AIRemediationActionType;
  targetResource: AIAffectedResource;
  blastRadius: BlastRadiusScope;
  blastRadiusExplanation: string;
  prerequisites: string[];
  riskAssessment: {
    level: AIRiskLevel;
    rationale: string;
  };
  verificationCriteria: AIVerificationCriteria;
  rollbackPlan: string;
  recommendedCommands?: Array<{
    command: string;
    description: string;
    stage: 'pre-check' | 'remediate' | 'verify' | 'rollback';
  }>;
}

export interface StructuredInvestigation {
  investigationId: string;
  incidentId: string;
  executiveSummary: string;
  primaryRootCause: string;
  rootCauseProbabilities: RootCauseProbability[];
  contributingFactors: string[];
  ruledOutCauses: RuledOutCause[];
  evidenceMatrix: InvestigationEvidenceItem[];
  chronologicalTimeline: InvestigationTimelineEvent[];
  actionPlan: InvestigationActionPlan;
  unknownsAndGaps: string[];
  investigationConfidence: number; // 0 to 1.0
  investigatedAt: number;
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
  | 'ROUTES_TO_POD'
  | 'BACKED_BY_ENDPOINTS'
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
  temporalDistance?: string; // e.g. "-12m before incident", "+15s after detection"
  relationship?: 'OBSERVED' | 'CORRELATED' | 'LIKELY_RELATED' | 'PLAUSIBLE' | 'UNKNOWN';
  evidenceConfidence?: number;
  confidence?: number;
}

export interface DetectedResourceChange {
  changeId: string;
  changeType?: string;
  resourceKind: string;
  resourceName: string;
  namespace?: string;
  field: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  timestamp: number;
  confidence: number;
  evidence: string;
}

export interface InvestigationQuestionResult {
  question: string;
  answer: string;
  category: string;
  confidence: number;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  supportingEvidence: EvidencePoint[];
  facts: string[];
  inferences: string[];
  unknowns: string[];
  recommendedNextSteps: string[];
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
  changes?: DetectedResourceChange[];
  explainability: ExplainabilityReport;
  recommendation: string;
  executableProposal?: ExecutableActionProposal;
  isUnknownOrInconclusive: boolean;
  customerImpact?: string;
  whatRemainsUnknown?: string[];
  whatShouldHappenNext?: string[];
}

// --- Firebase Cloud Storage & Stored Artifacts Foundation ---

export type StorageCategory =
  | 'audit-exports'
  | 'incident-artifacts'
  | 'remediation-manifests'
  | 'cluster-snapshots'
  | 'ai-diagnostics'
  | 'user-uploads';

export type StoredArtifactLifecycleStatus = 'ACTIVE' | 'ARCHIVED' | 'EXPIRED' | 'DELETED';

export interface StoredArtifactActor {
  id: string;
  email?: string;
  name?: string;
  actorType: 'HUMAN' | 'AGENT' | 'AI' | 'SYSTEM' | 'AUTOMATION';
}

export interface StoredArtifact {
  id: string;
  orgId: string;
  category: StorageCategory;
  storagePath: string;
  storageBucket: string;
  filename: string;
  sizeBytes: number;
  mimeType: string;
  checksumSha256: string;
  uploadedBy: StoredArtifactActor;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  lifecycleStatus: StoredArtifactLifecycleStatus;
  tags?: string[];
  metadata?: Record<string, string | number | boolean>;
  downloadUrl?: string;
}

export interface StoredArtifactFilters {
  category?: StorageCategory;
  lifecycleStatus?: StoredArtifactLifecycleStatus;
  search?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
  offset?: number;
}

export interface StorageUsageSummary {
  orgId: string;
  totalSizeBytes: number;
  totalArtifactsCount: number;
  categoryBreakdown: Record<StorageCategory, { sizeBytes: number; count: number }>;
  lastUpdatedAt: number;
}

export * from './billing';

