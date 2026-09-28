import {
  Cluster,
  Incident,
  IncidentNote,
  KubernetesResource,
  Organization,
  OrgInvitation,
  OrgMember,
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
  StorageUsageSummary,
  StorageCategory
} from '../../src/types/index';
import {
  AuditEvent,
  AuditQueryFilters,
  PaginatedResult,
  WebhookConfig,
  WebhookDeliveryRecord,
  OrgUsageSummary
} from '../repositories/types';
import { ClusterResourcesRecord, ClusterTokenRecord, IPersistenceStore } from './types';

export class InMemoryStore implements IPersistenceStore {
  public readonly providerName = 'memory';

  private users: Map<string, User> = new Map();
  private userNotificationSettings: Map<string, UserNotificationSettings> = new Map();
  private organizations: Map<string, Organization> = new Map();
  private members: Map<string, OrgMember[]> = new Map(); // orgId -> members
  private invitations: Map<string, OrgInvitation> = new Map(); // id -> OrgInvitation
  private supportTickets: Map<string, SupportTicket> = new Map(); // id -> SupportTicket
  private clusters: Map<string, Cluster> = new Map(); // clusterId -> Cluster
  private clusterTokens: Map<string, ClusterTokenRecord> = new Map(); // tokenHash -> Record
  private clusterResources: Map<string, ClusterResourcesRecord> = new Map(); // clusterId -> Record
  private incidents: Map<string, Incident> = new Map(); // incidentId -> Incident
  private incidentTimeline: Map<string, TimelineEvent[]> = new Map(); // incidentId -> events
  private incidentNotes: Map<string, IncidentNote[]> = new Map(); // incidentId -> notes
  private remediations: Map<string, { incidentId: string; orgId: string; remediation: StructuredRemediation }> = new Map();
  private remediationActions: Map<string, RemediationAction> = new Map(); // actionId -> action
  private aiAnalyses: Map<string, { incidentId: string; orgId: string; analysis: SkyOpsAIAnalysis }> = new Map();
  private policies: Map<string, RemediationPolicy> = new Map(); // policyId -> Policy
  private auditEvents: AuditEvent[] = [];
  private webhooks: Map<string, WebhookConfig> = new Map(); // webhookId -> WebhookConfig
  private webhookDeliveries: WebhookDeliveryRecord[] = [];
  private subscriptions: Map<string, Subscription> = new Map(); // orgId -> Subscription
  private invoices: Map<string, Invoice> = new Map(); // invoiceId -> Invoice
  private usage: Map<string, OrgUsageSummary> = new Map(); // `${orgId}_${period}` -> Summary
  private processedWebhookIds: Set<string> = new Set();
  private processedTelemetryBatches: Set<string> = new Set();
  private storedArtifacts: Map<string, StoredArtifact> = new Map(); // artifactId -> StoredArtifact

  public async init(): Promise<void> {
    // In-memory initialized cleanly
  }

  public async close(): Promise<void> {
    // No-op for in-memory
  }

  public async isHealthy(): Promise<boolean> {
    return true;
  }

  // --- Users ---
  public async getUser(userId: string): Promise<User | null> {
    return this.users.get(userId) || null;
  }

  public async upsertUser(user: User): Promise<User> {
    const existing = this.users.get(user.id);
    const updated: User = {
      ...existing,
      ...user
    };
    this.users.set(user.id, updated);
    return updated;
  }

  public async listUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  // --- User Notification Settings ---
  public async getUserNotificationSettings(userId: string): Promise<UserNotificationSettings | null> {
    return this.userNotificationSettings.get(userId) || null;
  }

  public async saveUserNotificationSettings(userId: string, settings: UserNotificationSettings): Promise<void> {
    this.userNotificationSettings.set(userId, { ...settings });
  }

  // --- Organizations ---
  public async getOrganization(orgId: string): Promise<Organization | null> {
    return this.organizations.get(orgId) || null;
  }

  public async upsertOrganization(org: Organization): Promise<Organization> {
    const existing = this.organizations.get(org.id);
    const updated: Organization = {
      ...existing,
      ...org,
      createdAt: existing?.createdAt || org.createdAt || Date.now()
    };
    this.organizations.set(org.id, updated);
    return updated;
  }

  public async listOrganizations(): Promise<Organization[]> {
    return Array.from(this.organizations.values());
  }

  public async deleteOrganization(orgId: string): Promise<boolean> {
    const deleted = this.organizations.delete(orgId);
    this.members.delete(orgId);
    return deleted;
  }

  // --- Organization Memberships ---
  public async getOrgMembers(orgId: string): Promise<OrgMember[]> {
    return this.members.get(orgId) || [];
  }

  public async setOrgMembers(orgId: string, members: OrgMember[]): Promise<void> {
    this.members.set(orgId, [...members]);
  }

  public async addOrgMember(orgId: string, member: OrgMember): Promise<OrgMember> {
    const current = this.members.get(orgId) || [];
    const index = current.findIndex((m) => m.userId === member.userId);
    if (index >= 0) {
      current[index] = member;
    } else {
      current.push(member);
    }
    this.members.set(orgId, current);
    return member;
  }

  public async removeOrgMember(orgId: string, userId: string): Promise<boolean> {
    const current = this.members.get(orgId) || [];
    const filtered = current.filter((m) => m.userId !== userId);
    if (filtered.length === current.length) return false;
    this.members.set(orgId, filtered);
    return true;
  }

  public async getUserOrganizations(userId: string, email?: string): Promise<Organization[]> {
    const orgIds = new Set<string>();
    for (const [orgId, members] of this.members.entries()) {
      if (
        members.some(
          (m) => m.userId === userId || (email && m.email.toLowerCase() === email.toLowerCase())
        )
      ) {
        orgIds.add(orgId);
      }
    }
    const result: Organization[] = [];
    for (const id of orgIds) {
      const org = this.organizations.get(id);
      if (org) result.push(org);
    }
    return result;
  }

  // --- Invitations ---
  public async getInvitation(invitationId: string): Promise<OrgInvitation | null> {
    return this.invitations.get(invitationId) || null;
  }

  public async getInvitationByToken(token: string): Promise<OrgInvitation | null> {
    for (const inv of this.invitations.values()) {
      if (inv.token === token) return inv;
    }
    return null;
  }

  public async listOrgInvitations(orgId: string): Promise<OrgInvitation[]> {
    return Array.from(this.invitations.values()).filter((i) => i.orgId === orgId);
  }

  public async saveInvitation(invitation: OrgInvitation): Promise<OrgInvitation> {
    this.invitations.set(invitation.id, { ...invitation });
    return invitation;
  }

  public async deleteInvitation(invitationId: string): Promise<boolean> {
    return this.invitations.delete(invitationId);
  }

  // --- Support Tickets ---
  public async getSupportTicket(ticketId: string): Promise<SupportTicket | null> {
    return this.supportTickets.get(ticketId) || null;
  }

  public async listSupportTickets(orgId: string): Promise<SupportTicket[]> {
    return Array.from(this.supportTickets.values()).filter((t) => t.orgId === orgId);
  }

  public async saveSupportTicket(ticket: SupportTicket): Promise<SupportTicket> {
    this.supportTickets.set(ticket.id, { ...ticket });
    return ticket;
  }

  // --- Clusters ---
  public async getCluster(clusterId: string, orgId?: string): Promise<Cluster | null> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return null;
    if (orgId && cluster.orgId !== orgId) return null;
    return cluster;
  }

  public async listClusters(orgId?: string): Promise<Cluster[]> {
    const all = Array.from(this.clusters.values());
    if (orgId) return all.filter((c) => c.orgId === orgId);
    return all;
  }

  public async upsertCluster(cluster: Cluster): Promise<Cluster> {
    this.clusters.set(cluster.id, { ...cluster });
    return cluster;
  }

  public async deleteCluster(clusterId: string, orgId: string): Promise<boolean> {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) return false;
    this.clusters.delete(clusterId);
    this.clusterResources.delete(clusterId);
    // Delete corresponding cluster tokens
    for (const [hash, record] of this.clusterTokens.entries()) {
      if (record.clusterId === clusterId) {
        this.clusterTokens.delete(hash);
      }
    }
    return true;
  }

  // --- Cluster Tokens ---
  public async getClusterTokenByHash(tokenHash: string): Promise<ClusterTokenRecord | null> {
    return this.clusterTokens.get(tokenHash) || null;
  }

  public async saveClusterToken(record: ClusterTokenRecord): Promise<void> {
    this.clusterTokens.set(record.tokenHash, { ...record });
  }

  public async deleteClusterToken(tokenHash: string): Promise<boolean> {
    return this.clusterTokens.delete(tokenHash);
  }

  // --- Cluster Resources ---
  public async getClusterResources(clusterId: string, orgId?: string): Promise<KubernetesResource[]> {
    const record = this.clusterResources.get(clusterId);
    if (!record) return [];
    if (orgId && record.orgId !== orgId) return [];
    return record.resources;
  }

  public async saveClusterResources(clusterId: string, orgId: string, resources: KubernetesResource[]): Promise<void> {
    this.clusterResources.set(clusterId, {
      clusterId,
      orgId,
      resources: [...resources],
      updatedAt: Date.now()
    });
  }

  // --- Incidents ---
  public async getIncident(incidentId: string, orgId?: string): Promise<Incident | null> {
    const inc = this.incidents.get(incidentId);
    if (!inc) return null;
    if (orgId && inc.orgId !== orgId) return null;
    return inc;
  }

  public async listIncidents(orgId?: string, clusterId?: string): Promise<Incident[]> {
    let list = Array.from(this.incidents.values());
    if (orgId) list = list.filter((i) => i.orgId === orgId);
    if (clusterId) list = list.filter((i) => i.clusterId === clusterId);
    return list;
  }

  public async upsertIncident(incident: Incident): Promise<Incident> {
    this.incidents.set(incident.id, { ...incident });
    return incident;
  }

  public async deleteIncident(incidentId: string, orgId: string): Promise<boolean> {
    const inc = this.incidents.get(incidentId);
    if (!inc || inc.orgId !== orgId) return false;
    this.incidents.delete(incidentId);
    this.incidentTimeline.delete(incidentId);
    this.incidentNotes.delete(incidentId);
    this.remediations.delete(incidentId);
    this.aiAnalyses.delete(incidentId);
    return true;
  }

  // --- Incident Timeline ---
  public async getIncidentTimeline(incidentId: string, _orgId?: string): Promise<TimelineEvent[]> {
    return this.incidentTimeline.get(incidentId) || [];
  }

  public async addTimelineEvent(incidentId: string, event: TimelineEvent, _orgId: string): Promise<TimelineEvent> {
    const current = this.incidentTimeline.get(incidentId) || [];
    current.push(event);
    this.incidentTimeline.set(incidentId, current);
    return event;
  }

  public async setIncidentTimeline(incidentId: string, events: TimelineEvent[], _orgId: string): Promise<void> {
    this.incidentTimeline.set(incidentId, [...events]);
  }

  // --- Incident Notes ---
  public async getIncidentNotes(incidentId: string, _orgId?: string): Promise<IncidentNote[]> {
    return this.incidentNotes.get(incidentId) || [];
  }

  public async addIncidentNote(incidentId: string, note: IncidentNote, _orgId: string): Promise<IncidentNote> {
    const current = this.incidentNotes.get(incidentId) || [];
    current.push(note);
    this.incidentNotes.set(incidentId, current);
    return note;
  }

  public async deleteIncidentNote(incidentId: string, noteId: string, _orgId: string): Promise<boolean> {
    const current = this.incidentNotes.get(incidentId) || [];
    const filtered = current.filter((n) => n.id !== noteId);
    if (filtered.length === current.length) return false;
    this.incidentNotes.set(incidentId, filtered);
    return true;
  }

  // --- Remediations ---
  public async getRemediation(incidentId: string, orgId?: string): Promise<StructuredRemediation | null> {
    const rec = this.remediations.get(incidentId);
    if (!rec) return null;
    if (orgId && rec.orgId !== orgId) return null;
    return rec.remediation;
  }

  public async saveRemediation(incidentId: string, remediation: StructuredRemediation, orgId: string): Promise<void> {
    this.remediations.set(incidentId, { incidentId, orgId, remediation: { ...remediation } });
  }

  // --- Remediation Actions ---
  public async getRemediationAction(actionId: string, orgId?: string): Promise<RemediationAction | null> {
    const act = this.remediationActions.get(actionId);
    if (!act) return null;
    if (orgId && act.orgId !== orgId) return null;
    return act;
  }

  public async listRemediationActions(orgId?: string, incidentId?: string): Promise<RemediationAction[]> {
    let list = Array.from(this.remediationActions.values());
    if (orgId) list = list.filter((a) => a.orgId === orgId);
    if (incidentId) list = list.filter((a) => a.incidentId === incidentId);
    return list;
  }

  public async saveRemediationAction(action: RemediationAction): Promise<RemediationAction> {
    this.remediationActions.set(action.id, { ...action });
    return action;
  }

  // --- AI Analyses ---
  public async getAIAnalysis(incidentId: string, orgId?: string): Promise<SkyOpsAIAnalysis | null> {
    const rec = this.aiAnalyses.get(incidentId);
    if (!rec) return null;
    if (orgId && rec.orgId !== orgId) return null;
    return rec.analysis;
  }

  public async saveAIAnalysis(incidentId: string, analysis: SkyOpsAIAnalysis, orgId: string): Promise<void> {
    this.aiAnalyses.set(incidentId, { incidentId, orgId, analysis: { ...analysis } });
  }

  // --- Policies ---
  public async getPolicy(policyId: string, orgId?: string): Promise<RemediationPolicy | null> {
    const pol = this.policies.get(policyId);
    if (!pol) return null;
    if (orgId && pol.orgId !== orgId) return null;
    return pol;
  }

  public async listPolicies(orgId: string): Promise<RemediationPolicy[]> {
    return Array.from(this.policies.values()).filter((p) => p.orgId === orgId);
  }

  public async savePolicy(policy: RemediationPolicy): Promise<RemediationPolicy> {
    const policyId = (policy as any).id || (policy.clusterId ? `${policy.orgId}_${policy.clusterId}` : policy.orgId);
    this.policies.set(policyId, { ...policy });
    return policy;
  }

  public async deletePolicy(policyId: string, orgId: string): Promise<boolean> {
    const pol = this.policies.get(policyId);
    if (!pol || pol.orgId !== orgId) return false;
    return this.policies.delete(policyId);
  }

  // --- Audit Events ---
  public async recordAuditEvent(event: AuditEvent): Promise<AuditEvent> {
    this.auditEvents.push({ ...event });
    return event;
  }

  public async queryAuditEvents(filters: AuditQueryFilters): Promise<PaginatedResult<AuditEvent>> {
    let list = this.auditEvents.filter((e) => e.orgId === filters.orgId);
    if (filters.actorId) list = list.filter((e) => e.actorId === filters.actorId);
    if (filters.actorType) {
      const targetType = filters.actorType.toUpperCase();
      list = list.filter((e) => {
        const itemType = (e.actorType || '').toUpperCase();
        if (targetType === 'USER' || targetType === 'HUMAN') {
          return itemType === 'USER' || itemType === 'HUMAN';
        }
        return itemType === targetType;
      });
    }
    if (filters.action) list = list.filter((e) => e.action.toLowerCase() === filters.action?.toLowerCase());
    if (filters.resourceType) list = list.filter((e) => e.resourceType.toUpperCase() === filters.resourceType?.toUpperCase());
    if (filters.resourceId) list = list.filter((e) => e.resourceId === filters.resourceId);
    if (filters.result) list = list.filter((e) => e.result === filters.result);
    if (filters.fromTimestamp) list = list.filter((e) => e.timestamp >= filters.fromTimestamp!);
    if (filters.toTimestamp) list = list.filter((e) => e.timestamp <= filters.toTimestamp!);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.action && e.action.toLowerCase().includes(q)) ||
          (e.actorName && e.actorName.toLowerCase().includes(q)) ||
          (e.actorId && e.actorId.toLowerCase().includes(q)) ||
          (e.resourceId && e.resourceId.toLowerCase().includes(q)) ||
          (e.resourceType && e.resourceType.toLowerCase().includes(q)) ||
          (e.details && JSON.stringify(e.details).toLowerCase().includes(q))
      );
    }

    // Newest first
    list.sort((a, b) => b.timestamp - a.timestamp);

    const total = list.length;
    const page = Math.max(1, filters.page || 1);
    const limit = Math.max(1, Math.min(100, filters.limit || 50));
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const items = list.slice(startIndex, startIndex + limit);

    return { items, total, page, totalPages, limit };
  }

  // --- Webhooks ---
  public async getWebhook(webhookId: string, orgId?: string): Promise<WebhookConfig | null> {
    const wh = this.webhooks.get(webhookId);
    if (!wh) return null;
    if (orgId && wh.orgId !== orgId) return null;
    return wh;
  }

  public async listWebhooks(orgId: string): Promise<WebhookConfig[]> {
    return Array.from(this.webhooks.values()).filter((w) => w.orgId === orgId);
  }

  public async saveWebhook(webhook: WebhookConfig): Promise<WebhookConfig> {
    this.webhooks.set(webhook.id, { ...webhook });
    return webhook;
  }

  public async deleteWebhook(webhookId: string, orgId: string): Promise<boolean> {
    const wh = this.webhooks.get(webhookId);
    if (!wh || wh.orgId !== orgId) return false;
    return this.webhooks.delete(webhookId);
  }

  // --- Webhook Deliveries ---
  public async recordWebhookDelivery(delivery: WebhookDeliveryRecord): Promise<WebhookDeliveryRecord> {
    this.webhookDeliveries.push({ ...delivery });
    if (this.webhookDeliveries.length > 5000) {
      this.webhookDeliveries.splice(0, this.webhookDeliveries.length - 5000);
    }
    return delivery;
  }

  public async listWebhookDeliveries(orgId: string, webhookId?: string, limit = 100): Promise<WebhookDeliveryRecord[]> {
    let list = this.webhookDeliveries.filter((d) => d.orgId === orgId);
    if (webhookId) list = list.filter((d) => d.webhookId === webhookId);
    list.sort((a, b) => b.timestamp - a.timestamp);
    return list.slice(0, limit);
  }

  // --- Subscriptions & Invoices ---
  public async getSubscription(orgId: string): Promise<Subscription | null> {
    return this.subscriptions.get(orgId) || null;
  }

  public async saveSubscription(subscription: Subscription): Promise<Subscription> {
    const orgId = subscription.organizationId || (subscription as any).orgId;
    this.subscriptions.set(orgId, { ...subscription });
    return subscription;
  }

  public async getInvoice(invoiceId: string, orgId?: string): Promise<Invoice | null> {
    const inv = this.invoices.get(invoiceId);
    if (!inv) return null;
    const invOrg = inv.organizationId || (inv as any).orgId;
    if (orgId && invOrg !== orgId) return null;
    return inv;
  }

  public async listInvoices(orgId: string): Promise<Invoice[]> {
    return Array.from(this.invoices.values()).filter((i) => {
      const invOrg = i.organizationId || (i as any).orgId;
      return invOrg === orgId;
    });
  }

  public async saveInvoice(invoice: Invoice): Promise<Invoice> {
    this.invoices.set(invoice.id, { ...invoice });
    return invoice;
  }

  // --- Usage Summaries ---
  public async getUsage(orgId: string, period: string): Promise<OrgUsageSummary | null> {
    const key = `${orgId}_${period}`;
    return this.usage.get(key) || null;
  }

  public async saveUsage(summary: OrgUsageSummary): Promise<void> {
    const key = `${summary.orgId}_${summary.period}`;
    this.usage.set(key, { ...summary });
  }

  // --- Processed Webhook IDs ---
  public async isWebhookProcessed(webhookId: string): Promise<boolean> {
    return this.processedWebhookIds.has(webhookId);
  }

  public async markWebhookProcessed(webhookId: string): Promise<void> {
    this.processedWebhookIds.add(webhookId);
  }

  public async claimTelemetryBatch(batchKey: string, _metadata?: Record<string, unknown>): Promise<boolean> {
    if (this.processedTelemetryBatches.has(batchKey)) return false;
    this.processedTelemetryBatches.add(batchKey);
    return true;
  }

  // --- Stored Artifacts ---
  public async saveStoredArtifact(artifact: StoredArtifact): Promise<StoredArtifact> {
    this.storedArtifacts.set(artifact.id, { ...artifact });
    return artifact;
  }

  public async getStoredArtifact(orgId: string, id: string): Promise<StoredArtifact | null> {
    const artifact = this.storedArtifacts.get(id);
    if (!artifact || artifact.orgId !== orgId) {
      return null;
    }
    return { ...artifact };
  }

  public async listStoredArtifacts(
    orgId: string,
    filters?: StoredArtifactFilters
  ): Promise<PaginatedResult<StoredArtifact>> {
    let list = Array.from(this.storedArtifacts.values()).filter((a) => a.orgId === orgId);

    if (filters?.category) {
      list = list.filter((a) => a.category === filters.category);
    }
    if (filters?.lifecycleStatus) {
      list = list.filter((a) => a.lifecycleStatus === filters.lifecycleStatus);
    }
    if (filters?.fromTimestamp) {
      list = list.filter((a) => a.createdAt >= filters.fromTimestamp!);
    }
    if (filters?.toTimestamp) {
      list = list.filter((a) => a.createdAt <= filters.toTimestamp!);
    }
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (a) =>
          a.filename.toLowerCase().includes(q) ||
          a.storagePath.toLowerCase().includes(q) ||
          (a.tags && a.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }

    // Newest first
    list.sort((a, b) => b.createdAt - a.createdAt);

    const total = list.length;
    const offset = filters?.offset || 0;
    const limit = filters?.limit || 50;
    const items = list.slice(offset, offset + limit);

    return {
      items,
      total,
      page: Math.floor(offset / limit) + 1,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  public async updateStoredArtifactStatus(
    orgId: string,
    id: string,
    status: StoredArtifactLifecycleStatus
  ): Promise<StoredArtifact | null> {
    const artifact = this.storedArtifacts.get(id);
    if (!artifact || artifact.orgId !== orgId) {
      return null;
    }
    const updated: StoredArtifact = {
      ...artifact,
      lifecycleStatus: status,
      updatedAt: Date.now()
    };
    this.storedArtifacts.set(id, updated);
    return updated;
  }

  public async deleteStoredArtifact(orgId: string, id: string): Promise<boolean> {
    const artifact = this.storedArtifacts.get(id);
    if (!artifact || artifact.orgId !== orgId) {
      return false;
    }
    return this.storedArtifacts.delete(id);
  }

  public async getStorageUsageSummary(orgId: string): Promise<StorageUsageSummary> {
    const artifacts = Array.from(this.storedArtifacts.values()).filter(
      (a) => a.orgId === orgId && a.lifecycleStatus !== 'DELETED'
    );

    const categories: StorageCategory[] = [
      'audit-exports',
      'incident-artifacts',
      'remediation-manifests',
      'cluster-snapshots',
      'ai-diagnostics',
      'user-uploads',
      'logs'
    ];

    const categoryBreakdown: Record<StorageCategory, { sizeBytes: number; count: number }> = {
      'audit-exports': { sizeBytes: 0, count: 0 },
      'incident-artifacts': { sizeBytes: 0, count: 0 },
      'remediation-manifests': { sizeBytes: 0, count: 0 },
      'cluster-snapshots': { sizeBytes: 0, count: 0 },
      'ai-diagnostics': { sizeBytes: 0, count: 0 },
      'user-uploads': { sizeBytes: 0, count: 0 },
      'logs': { sizeBytes: 0, count: 0 }
    };

    let totalSizeBytes = 0;
    let totalArtifactsCount = 0;

    for (const art of artifacts) {
      totalSizeBytes += art.sizeBytes;
      totalArtifactsCount += 1;
      if (categoryBreakdown[art.category]) {
        categoryBreakdown[art.category].sizeBytes += art.sizeBytes;
        categoryBreakdown[art.category].count += 1;
      }
    }

    return {
      orgId,
      totalSizeBytes,
      totalArtifactsCount,
      categoryBreakdown,
      lastUpdatedAt: Date.now()
    };
  }
}
