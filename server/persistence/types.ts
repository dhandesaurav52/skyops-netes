import {
  Cluster,
  Incident,
  IncidentNote,
  KubernetesResource,
  Organization,
  OrgInvitation,
  OrgMember,
  Role,
  RemediationAction,
  RemediationPolicy,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  SupportTicket,
  TimelineEvent,
  User,
  UserNotificationSettings,
  Subscription,
  Invoice,
  StoredArtifact,
  StoredArtifactFilters,
  StoredArtifactLifecycleStatus,
  StorageUsageSummary
} from '../../src/types/index';
import {
  AuditEvent,
  AuditQueryFilters,
  PaginatedResult,
  WebhookConfig,
  WebhookDeliveryRecord,
  OrgUsageSummary
} from '../repositories/types';

export interface ClusterTokenRecord {
  id: string;
  tokenHash: string;
  clusterId: string;
  orgId: string;
  createdAt: number;
  revokedAt?: number;
  lastUsedAt?: number;
}

export interface ClusterResourcesRecord {
  clusterId: string;
  orgId: string;
  resources: KubernetesResource[];
  updatedAt: number;
}

export interface IPersistenceStore {
  readonly providerName: 'firestore' | 'memory';

  // --- Initialization & Health ---
  init(): Promise<void>;
  close(): Promise<void>;
  isHealthy(): Promise<boolean>;

  // --- Users ---
  getUser(userId: string): Promise<User | null>;
  upsertUser(user: User): Promise<User>;
  listUsers(): Promise<User[]>;

  // --- User Notification Settings ---
  getUserNotificationSettings(userId: string): Promise<UserNotificationSettings | null>;
  saveUserNotificationSettings(userId: string, settings: UserNotificationSettings): Promise<void>;

  // --- Organizations ---
  getOrganization(orgId: string): Promise<Organization | null>;
  upsertOrganization(org: Organization): Promise<Organization>;
  listOrganizations(): Promise<Organization[]>;
  deleteOrganization(orgId: string): Promise<boolean>;

  // --- Organization Memberships ---
  getOrgMembers(orgId: string): Promise<OrgMember[]>;
  setOrgMembers(orgId: string, members: OrgMember[]): Promise<void>;
  addOrgMember(orgId: string, member: OrgMember): Promise<OrgMember>;
  removeOrgMember(orgId: string, userId: string): Promise<boolean>;
  getUserOrganizations(userId: string, email?: string): Promise<Organization[]>;

  // --- Invitations ---
  getInvitation(invitationId: string): Promise<OrgInvitation | null>;
  getInvitationByToken(token: string): Promise<OrgInvitation | null>;
  listOrgInvitations(orgId: string): Promise<OrgInvitation[]>;
  saveInvitation(invitation: OrgInvitation): Promise<OrgInvitation>;
  deleteInvitation(invitationId: string): Promise<boolean>;

  // --- Support Tickets ---
  getSupportTicket(ticketId: string): Promise<SupportTicket | null>;
  listSupportTickets(orgId: string): Promise<SupportTicket[]>;
  saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket>;

  // --- Clusters ---
  getCluster(clusterId: string, orgId?: string): Promise<Cluster | null>;
  listClusters(orgId?: string): Promise<Cluster[]>;
  upsertCluster(cluster: Cluster): Promise<Cluster>;
  deleteCluster(clusterId: string, orgId: string): Promise<boolean>;

  // --- Cluster Tokens ---
  getClusterTokenByHash(tokenHash: string): Promise<ClusterTokenRecord | null>;
  saveClusterToken(record: ClusterTokenRecord): Promise<void>;
  deleteClusterToken(tokenHash: string): Promise<boolean>;

  // --- Cluster Resources ---
  getClusterResources(clusterId: string, orgId?: string): Promise<KubernetesResource[]>;
  saveClusterResources(clusterId: string, orgId: string, resources: KubernetesResource[]): Promise<void>;

  // --- Incidents ---
  getIncident(incidentId: string, orgId?: string): Promise<Incident | null>;
  listIncidents(orgId?: string, clusterId?: string): Promise<Incident[]>;
  upsertIncident(incident: Incident): Promise<Incident>;
  deleteIncident(incidentId: string, orgId: string): Promise<boolean>;

  // --- Incident Timeline ---
  getIncidentTimeline(incidentId: string, orgId?: string): Promise<TimelineEvent[]>;
  addTimelineEvent(incidentId: string, event: TimelineEvent, orgId: string): Promise<TimelineEvent>;
  setIncidentTimeline(incidentId: string, events: TimelineEvent[], orgId: string): Promise<void>;

  // --- Incident Notes ---
  getIncidentNotes(incidentId: string, orgId?: string): Promise<IncidentNote[]>;
  addIncidentNote(incidentId: string, note: IncidentNote, orgId: string): Promise<IncidentNote>;
  deleteIncidentNote(incidentId: string, noteId: string, orgId: string): Promise<boolean>;

  // --- Remediations ---
  getRemediation(incidentId: string, orgId?: string): Promise<StructuredRemediation | null>;
  saveRemediation(incidentId: string, remediation: StructuredRemediation, orgId: string): Promise<void>;

  // --- Remediation Actions ---
  getRemediationAction(actionId: string, orgId?: string): Promise<RemediationAction | null>;
  listRemediationActions(orgId?: string, incidentId?: string): Promise<RemediationAction[]>;
  saveRemediationAction(action: RemediationAction): Promise<RemediationAction>;

  // --- AI Analyses ---
  getAIAnalysis(incidentId: string, orgId?: string): Promise<SkyOpsAIAnalysis | null>;
  saveAIAnalysis(incidentId: string, analysis: SkyOpsAIAnalysis, orgId: string): Promise<void>;

  // --- Policies ---
  getPolicy(policyId: string, orgId?: string): Promise<RemediationPolicy | null>;
  listPolicies(orgId: string): Promise<RemediationPolicy[]>;
  savePolicy(policy: RemediationPolicy): Promise<RemediationPolicy>;
  deletePolicy(policyId: string, orgId: string): Promise<boolean>;

  // --- Audit Events ---
  recordAuditEvent(event: AuditEvent): Promise<AuditEvent>;
  queryAuditEvents(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEvent>>;

  // --- Webhooks ---
  getWebhook(webhookId: string, orgId?: string): Promise<WebhookConfig | null>;
  listWebhooks(orgId: string): Promise<WebhookConfig[]>;
  saveWebhook(webhook: WebhookConfig): Promise<WebhookConfig>;
  deleteWebhook(webhookId: string, orgId: string): Promise<boolean>;

  // --- Webhook Deliveries ---
  recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord>;
  listWebhookDeliveries(orgId: string, webhookId?: string, limit?: number): Promise<WebhookDeliveryRecord[]>;

  // --- Subscriptions & Invoices ---
  getSubscription(orgId: string): Promise<Subscription | null>;
  saveSubscription(subscription: Subscription): Promise<Subscription>;
  getInvoice(invoiceId: string, orgId?: string): Promise<Invoice | null>;
  listInvoices(orgId: string): Promise<Invoice[]>;
  saveInvoice(invoice: Invoice): Promise<Invoice>;

  // --- Usage Summaries ---
  getUsage(orgId: string, period: string): Promise<OrgUsageSummary | null>;
  saveUsage(summary: OrgUsageSummary): Promise<void>;

  // --- Processed Webhook IDs (Idempotency) ---
  isWebhookProcessed(webhookId: string): Promise<boolean>;
  markWebhookProcessed(webhookId: string): Promise<void>;

  // --- Telemetry batch idempotency ---
  claimTelemetryBatch(batchKey: string, metadata?: Record<string, unknown>): Promise<boolean>;

  // --- Stored Artifacts (Firebase Cloud Storage metadata & references) ---
  saveStoredArtifact(artifact: StoredArtifact): Promise<StoredArtifact>;
  getStoredArtifact(orgId: string, id: string): Promise<StoredArtifact | null>;
  listStoredArtifacts(orgId: string, filters?: StoredArtifactFilters): Promise<PaginatedResult<StoredArtifact>>;
  updateStoredArtifactStatus(orgId: string, id: string, status: StoredArtifactLifecycleStatus): Promise<StoredArtifact | null>;
  deleteStoredArtifact(orgId: string, id: string): Promise<boolean>;
  getStorageUsageSummary(orgId: string): Promise<StorageUsageSummary>;
}
