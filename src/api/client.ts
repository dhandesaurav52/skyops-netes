import { auth } from '../firebase';
import {
  AgentManifestsResponse,
  Cluster,
  Incident,
  IncidentNote,
  IncidentSeverity,
  IncidentStatus,
  IntelligenceAnalysis,
  KubernetesResource,
  Organization,
  OrganizationSettings,
  OrgInvitation,
  OrgMember,
  OrgMemberStatus,
  OverviewMetrics,
  Role,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  SupportTicket,
  TicketCategory,
  TicketSeverity,
  TimelineEvent,
  User,
  ClusterObservabilityMetrics,
  MetricHistoryPoint,
  NodeMetricsSummary,
  WorkloadMetricsSummary,
  K8sEvent,
  PodLogsResponse,
  TelemetryResponse,
  TelemetryQueryOptions,
  ResourceBaseline,
  TelemetryAnomaly,
  InvestigationQuestionResult,
  MetricsServerStatus,
  BillingInterval,
  Invoice,
  OrgBillingOverview,
  Plan,
  PlanId,
  Subscription
} from '../types/index';

/**
 * Normalizes and validates cluster resources API responses.
 *
 * Requirements:
 * - Preserves valid resource arrays unchanged (e.g. { resources: [...] } or direct [...]).
 * - Normalizes missing resource collections (null, undefined, { resources: null/undefined }, {}) to [].
 * - Surfaces an explicit telemetry error when the response is malformed (e.g. non-array resources, primitive payload).
 * - Does not hide real backend errors.
 */
export function normalizeClusterResourcesResponse(data: unknown): KubernetesResource[] {
  // 1. Missing payload -> normalize to empty collection []
  if (data === null || data === undefined) {
    return [];
  }

  // 2. Direct array response [...] -> preserve valid array unchanged
  if (Array.isArray(data)) {
    return data as KubernetesResource[];
  }

  // 3. Non-object primitive payload (string, number, boolean) -> malformed
  if (typeof data !== 'object') {
    throw new Error(`Malformed cluster resources response: received unexpected ${typeof data} payload`);
  }

  const record = data as Record<string, unknown>;

  // 4. Preserve explicit backend errors without swallowing
  if (record.error && typeof record.error === 'string') {
    throw new Error(record.error);
  }

  // 5. Standard wrapped shape: { resources: [...] }
  if ('resources' in record) {
    const resCollection = record.resources;
    if (resCollection === null || resCollection === undefined) {
      return [];
    }
    if (Array.isArray(resCollection)) {
      return resCollection as KubernetesResource[];
    }
    throw new Error('Malformed cluster resources response: "resources" field is not an array');
  }

  // 6. Alternative collection wrappers: { data: [...] } or { items: [...] }
  if (Array.isArray(record.data)) {
    return record.data as KubernetesResource[];
  }
  if (Array.isArray(record.items)) {
    return record.items as KubernetesResource[];
  }

  // 7. Empty object {} -> normalize to empty collection []
  const keys = Object.keys(record);
  if (keys.length === 0) {
    return [];
  }

  // 8. Unexpected object structure without any resource array -> malformed
  throw new Error('Malformed cluster resources response: expected a resource collection array');
}

class ApiClient {
  private async getHeaders(): Promise<HeadersInit> {
    const savedOrg = localStorage.getItem('skyops_active_org_id');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (savedOrg) {
      headers['x-org-id'] = savedOrg;
    }

    // Attach real Firebase ID token
    if (auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      } catch (err) {
        console.warn('Failed to retrieve Firebase ID token:', err);
      }
    }

    return headers;
  }

  /**
   * Safe centralized request executor that gracefully handles Firebase Auth, JSON parsing, and HTTP errors
   */
  private async request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const dynamicHeaders = await this.getHeaders();
    const headers = {
      ...dynamicHeaders,
      ...(options.headers || {})
    };

    let res: Response;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (netErr: any) {
      throw new Error(`Network connection error: ${netErr?.message || 'Failed to communicate with SkyOps server'}`);
    }

    // If unauthorized and a real Firebase user is logged in, attempt a one-time force-refresh of the ID token
    if (res.status === 401 && auth.currentUser && !(options as any)?._isAuthRetry) {
      try {
        const freshToken = await auth.currentUser.getIdToken(true);
        if (freshToken) {
          const retryHeaders = {
            ...headers,
            Authorization: `Bearer ${freshToken}`
          };
          res = await fetch(url, {
            ...options,
            headers: retryHeaders,
            ...({ _isAuthRetry: true } as any)
          });
        }
      } catch (refreshErr) {
        console.warn('[SkyOps API] Token auto-refresh on 401 error:', refreshErr);
      }
    }

    const text = await res.text();
    let data: any;

    if (text.trim().startsWith('<') || text.includes('<!DOCTYPE') || text.includes('<!doctype')) {
      if (!res.ok) {
        throw new Error(`API error (${res.status} ${res.statusText})`);
      }
      throw new Error(`Received unexpected HTML response from ${url}`);
    }

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      if (!res.ok) {
        throw new Error(`API error (${res.status} ${res.statusText})`);
      }
      throw new Error(`Malformed JSON response from ${url}`);
    }

    if (!res.ok) {
      const errMsg = data?.error || `API request failed with status ${res.status}`;
      const err = new Error(errMsg) as any;
      err.status = res.status;
      err.code = data?.code;
      err.data = data;
      throw err;
    }

    return data as T;
  }

  // --- Auth & Session ---
  async getUsdInrRate(): Promise<{ rate: number; fetchedAt: number; source: string }> {
    return this.request('/api/v1/billing/exchange-rate');
  }

  async getSession(): Promise<{
    user: User;
    currentOrg: Organization;
    organizations: Organization[];
    role: Role;
    members: OrgMember[];
  }> {
    const session = await this.request<{
      user: User;
      currentOrg: Organization;
      organizations: Organization[];
      role: Role;
      members: OrgMember[];
    }>('/api/v1/auth/session', { method: 'POST' });
    if (session?.currentOrg?.id) {
      localStorage.setItem('skyops_active_org_id', session.currentOrg.id);
    }
    return session;
  }

  // --- Organizations ---
  async getOrganizations(): Promise<Organization[]> {
    const data = await this.request<{ organizations: Organization[] }>('/api/v1/orgs');
    return data.organizations;
  }

  async getCurrentOrganization(): Promise<{ organization: Organization; role: Role }> {
    return this.request<{ organization: Organization; role: Role }>('/api/v1/orgs/current');
  }

  async getOrganization(orgId: string): Promise<{ organization: Organization; role?: Role }> {
    return this.request<{ organization: Organization; role?: Role }>(`/api/v1/orgs/${orgId}`);
  }

  async createOrganization(name: string): Promise<Organization> {
    const data = await this.request<{ organization: Organization }>('/api/v1/orgs', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    return data.organization;
  }

  async updateOrganization(
    orgId: string,
    updates: { name?: string; settings?: OrganizationSettings }
  ): Promise<{ organization: Organization }> {
    return this.request<{ organization: Organization }>(`/api/v1/orgs/${orgId}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
  }

  async getOrgMembers(options?: {
    search?: string;
    role?: Role;
    status?: OrgMemberStatus;
  }): Promise<OrgMember[]> {
    const params = new URLSearchParams();
    if (options?.search) params.append('search', options.search);
    if (options?.role) params.append('role', options.role);
    if (options?.status) params.append('status', options.status);
    const query = params.toString() ? `?${params.toString()}` : '';
    const data = await this.request<{ members: OrgMember[] }>(`/api/v1/orgs/members${query}`);
    return data.members;
  }

  async inviteMember(
    email: string,
    role: Role
  ): Promise<{ success: boolean; invitation: OrgInvitation }> {
    return this.request<{ success: boolean; invitation: OrgInvitation }>('/api/v1/orgs/members/invite', {
      method: 'POST',
      body: JSON.stringify({ email, role })
    });
  }

  async updateMemberRole(
    userId: string,
    role: Role
  ): Promise<{ success: boolean; member: OrgMember }> {
    return this.request<{ success: boolean; member: OrgMember }>(`/api/v1/orgs/members/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role })
    });
  }

  async updateMemberStatus(
    userId: string,
    status: OrgMemberStatus
  ): Promise<{ success: boolean; member: OrgMember }> {
    return this.request<{ success: boolean; member: OrgMember }>(`/api/v1/orgs/members/${userId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
  }

  async removeMember(userId: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/api/v1/orgs/members/${userId}`, {
      method: 'DELETE'
    });
  }

  // --- Invitations ---
  async getOrgInvitations(): Promise<OrgInvitation[]> {
    const data = await this.request<{ invitations: OrgInvitation[] }>('/api/v1/orgs/invitations');
    return data.invitations;
  }

  async revokeInvitation(invitationId: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/api/v1/orgs/invitations/${invitationId}`, {
      method: 'DELETE'
    });
  }

  async resendInvitation(invitationId: string): Promise<{ success: boolean; invitation: OrgInvitation }> {
    return this.request<{ success: boolean; invitation: OrgInvitation }>(
      `/api/v1/orgs/invitations/${invitationId}/resend`,
      { method: 'POST' }
    );
  }

  async verifyInvitation(token: string): Promise<{
    valid: boolean;
    email: string;
    role: Role;
    orgName: string;
    expiresAt: number;
    status: string;
  }> {
    return this.request<{
      valid: boolean;
      email: string;
      role: Role;
      orgName: string;
      expiresAt: number;
      status: string;
    }>(`/api/v1/invitations/verify?token=${encodeURIComponent(token)}`);
  }

  async acceptInvitation(token: string): Promise<{ success: boolean; organization: Organization; role: Role }> {
    return this.request<{ success: boolean; organization: Organization; role: Role }>('/api/v1/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token })
    });
  }

  // --- Support ---
  async createSupportTicket(data: {
    subject: string;
    category: TicketCategory;
    severity: TicketSeverity;
    description: string;
    clusterId?: string;
    incidentId?: string;
  }): Promise<{ success: boolean; ticket: SupportTicket }> {
    return this.request<{ success: boolean; ticket: SupportTicket }>('/api/v1/support/tickets', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getSupportTickets(): Promise<SupportTicket[]> {
    const data = await this.request<{ tickets: SupportTicket[] }>('/api/v1/support/tickets');
    return data.tickets;
  }

  // --- Clusters ---
  async getClusters(): Promise<Cluster[]> {
    const data = await this.request<{ clusters: Cluster[] }>('/api/v1/clusters');
    return data.clusters;
  }

  async createCluster(
    name: string,
    description?: string
  ): Promise<{ cluster: Cluster; token: string; connectionCode?: string; installKey?: string }> {
    return this.request<{ cluster: Cluster; token: string; connectionCode?: string; installKey?: string }>(
      '/api/v1/clusters',
      {
        method: 'POST',
        body: JSON.stringify({ name, description })
      }
    );
  }

  async connectCluster(clusterId: string, connectionCode: string): Promise<{ success: boolean; cluster: Cluster }> {
    return this.request<{ success: boolean; cluster: Cluster }>(`/api/v1/clusters/${clusterId}/connect`, {
      method: 'POST',
      body: JSON.stringify({ connectionCode })
    });
  }

  async regenerateClusterToken(
    clusterId: string
  ): Promise<{ success: boolean; cluster: Cluster; token: string; connectionCode: string; installKey: string }> {
    return this.request<{ success: boolean; cluster: Cluster; token: string; connectionCode: string; installKey: string }>(
      `/api/v1/clusters/${clusterId}/regenerate-token`,
      { method: 'POST' }
    );
  }

  async disconnectCluster(clusterId: string): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(`/api/v1/clusters/${clusterId}/disconnect`, {
      method: 'POST'
    });
  }

  async getCluster(id: string): Promise<Cluster> {
    const data = await this.request<{ cluster: Cluster }>(`/api/v1/clusters/${id}`);
    return data.cluster;
  }

  async deleteCluster(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/v1/clusters/${id}`, {
      method: 'DELETE'
    });
  }

  async getClusterManifests(clusterId: string): Promise<AgentManifestsResponse> {
    return this.request<AgentManifestsResponse>(`/api/v1/clusters/${clusterId}/manifests`);
  }

  async getClusterResources(clusterId: string): Promise<KubernetesResource[]> {
    const data = await this.request<unknown>(`/api/v1/clusters/${clusterId}/resources`);
    return normalizeClusterResourcesResponse(data);
  }

  async getAllResources(filters?: {
    clusterId?: string;
    kind?: string;
    namespace?: string;
    health?: string;
    status?: string;
    nodeName?: string;
    search?: string;
    incidentId?: string;
    timeRange?: string;
    since?: number;
    until?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<KubernetesResource[]> {
    const params = new URLSearchParams();
    if (filters?.clusterId) params.set('clusterId', filters.clusterId);
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.namespace) params.set('namespace', filters.namespace);
    if (filters?.health) params.set('health', filters.health);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.nodeName) params.set('nodeName', filters.nodeName);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.incidentId) params.set('incidentId', filters.incidentId);
    if (filters?.timeRange) params.set('timeRange', filters.timeRange);
    if (filters?.since) params.set('since', String(filters.since));
    if (filters?.until) params.set('until', String(filters.until));
    if (filters?.sortBy) params.set('sortBy', filters.sortBy);
    if (filters?.sortOrder) params.set('sortOrder', filters.sortOrder);
    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.limit) params.set('limit', String(filters.limit));

    const url = `/api/v1/resources${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await this.request<unknown>(url);
    return normalizeClusterResourcesResponse(data);
  }

  async queryResources(filters?: {
    clusterId?: string;
    kind?: string;
    namespace?: string;
    health?: string;
    status?: string;
    nodeName?: string;
    search?: string;
    incidentId?: string;
    timeRange?: string;
    since?: number;
    until?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }): Promise<{
    resources: KubernetesResource[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const params = new URLSearchParams();
    if (filters?.clusterId) params.set('clusterId', filters.clusterId);
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.namespace) params.set('namespace', filters.namespace);
    if (filters?.health) params.set('health', filters.health);
    if (filters?.status) params.set('status', filters.status);
    if (filters?.nodeName) params.set('nodeName', filters.nodeName);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.incidentId) params.set('incidentId', filters.incidentId);
    if (filters?.timeRange) params.set('timeRange', filters.timeRange);
    if (filters?.since) params.set('since', String(filters.since));
    if (filters?.until) params.set('until', String(filters.until));
    if (filters?.sortBy) params.set('sortBy', filters.sortBy);
    if (filters?.sortOrder) params.set('sortOrder', filters.sortOrder);
    if (filters?.page) params.set('page', String(filters.page));
    if (filters?.limit) params.set('limit', String(filters.limit));

    const url = `/api/v1/resources${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await this.request<{
      resources: KubernetesResource[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(url);
    return {
      resources: Array.isArray(data?.resources) ? data.resources : [],
      total: typeof data?.total === 'number' ? data.total : (Array.isArray(data?.resources) ? data.resources.length : 0),
      page: data?.page || 1,
      limit: data?.limit || 50,
      totalPages: data?.totalPages || 1
    };
  }

  // --- Observability & Resource Metrics Foundation ---
  async getClusterMetrics(clusterId: string): Promise<ClusterObservabilityMetrics> {
    const data = await this.request<{ metrics: ClusterObservabilityMetrics }>(`/api/v1/clusters/${clusterId}/metrics`);
    return data.metrics;
  }

  async getNodeMetrics(clusterId: string): Promise<NodeMetricsSummary[]> {
    const data = await this.request<{ nodes: NodeMetricsSummary[] }>(`/api/v1/clusters/${clusterId}/metrics/nodes`);
    return data.nodes;
  }

  async getWorkloadMetrics(clusterId: string): Promise<WorkloadMetricsSummary[]> {
    const data = await this.request<{ workloads: WorkloadMetricsSummary[] }>(`/api/v1/clusters/${clusterId}/metrics/workloads`);
    return data.workloads;
  }

  async getClusterMetricHistory(clusterId: string, range?: string): Promise<MetricHistoryPoint[]> {
    const query = range ? `?range=${encodeURIComponent(range)}` : '';
    const data = await this.request<{ history: MetricHistoryPoint[] }>(`/api/v1/clusters/${clusterId}/metrics/history${query}`);
    return data.history;
  }

  async getTelemetryHistory(clusterId: string, options?: TelemetryQueryOptions): Promise<TelemetryResponse> {
    const params = new URLSearchParams();
    if (options?.range) params.set('range', options.range);
    if (options?.resolution) params.set('resolution', options.resolution);
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.includeRaw !== undefined) params.set('includeRaw', String(options.includeRaw));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<TelemetryResponse>(`/api/v1/clusters/${clusterId}/telemetry${qs}`);
  }

  async getTelemetryBaseline(clusterId: string, range = '24h'): Promise<{ baseline: ResourceBaseline }> {
    return this.request<{ baseline: ResourceBaseline }>(`/api/v1/clusters/${clusterId}/telemetry/baseline?range=${encodeURIComponent(range)}`);
  }

  async getTelemetryAnomalies(clusterId: string): Promise<TelemetryAnomaly[]> {
    const data = await this.request<{ anomalies: TelemetryAnomaly[] }>(`/api/v1/clusters/${clusterId}/telemetry/anomalies`);
    return Array.isArray(data.anomalies) ? data.anomalies : [];
  }

  // --- Metrics Server Enablement & Verification ---
  async getMetricsServerStatus(clusterId: string): Promise<MetricsServerStatus> {
    const data = await this.request<{ status: MetricsServerStatus }>(`/api/v1/clusters/${clusterId}/metrics-server`);
    return data.status;
  }

  async verifyMetricsServer(clusterId: string): Promise<{ success: boolean; status: MetricsServerStatus; message: string }> {
    return this.request<{ success: boolean; status: MetricsServerStatus; message: string }>(
      `/api/v1/clusters/${clusterId}/metrics-server/verify`,
      { method: 'POST' }
    );
  }

  // --- First-Class Kubernetes Events Observability ---
  async getClusterEvents(
    clusterId: string,
    filters?: {
      type?: string;
      namespace?: string;
      kind?: string;
      resourceName?: string;
      search?: string;
      limit?: number;
    }
  ): Promise<K8sEvent[]> {
    const params = new URLSearchParams();
    if (filters?.type) params.set('type', filters.type);
    if (filters?.namespace) params.set('namespace', filters.namespace);
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.resourceName) params.set('resourceName', filters.resourceName);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.limit) params.set('limit', filters.limit.toString());

    const url = `/api/v1/clusters/${clusterId}/events${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await this.request<{ events: K8sEvent[] }>(url);
    return Array.isArray(data.events) ? data.events : [];
  }

  // --- Real Kubernetes Pod/Container Log Access ---
  async getPodLogs(
    clusterId: string,
    namespace: string,
    podName: string,
    options?: {
      container?: string;
      tailLines?: number;
      previous?: boolean;
      sinceSeconds?: number;
      timestamps?: boolean;
      filter?: string;
    }
  ): Promise<PodLogsResponse> {
    const params = new URLSearchParams();
    if (options?.container) params.set('container', options.container);
    if (options?.tailLines) params.set('tailLines', options.tailLines.toString());
    if (options?.previous) params.set('previous', 'true');
    if (options?.sinceSeconds) params.set('sinceSeconds', options.sinceSeconds.toString());
    if (options?.timestamps !== undefined) params.set('timestamps', options.timestamps ? 'true' : 'false');
    if (options?.filter) params.set('filter', options.filter);

    const url = `/api/v1/clusters/${clusterId}/pods/${encodeURIComponent(namespace)}/${encodeURIComponent(podName)}/logs${params.toString() ? `?${params.toString()}` : ''}`;
    return await this.request<PodLogsResponse>(url);
  }

  // --- Incidents ---
  async getIncidents(filters?: {
    status?: IncidentStatus;
    severity?: IncidentSeverity;
    clusterId?: string;
    namespace?: string;
    search?: string;
  }): Promise<Incident[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.severity) params.set('severity', filters.severity);
    if (filters?.clusterId) params.set('clusterId', filters.clusterId);
    if (filters?.namespace) params.set('namespace', filters.namespace);
    if (filters?.search) params.set('search', filters.search);

    const url = `/api/v1/incidents${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await this.request<{ incidents: Incident[] }>(url);
    return data.incidents;
  }

  async getIncident(id: string): Promise<{
    incident: Incident;
    timeline: TimelineEvent[];
    notes: IncidentNote[];
    aiAnalysis?: SkyOpsAIAnalysis | null;
    remediation?: StructuredRemediation | null;
    intelligence?: IntelligenceAnalysis | null;
  }> {
    return this.request<{
      incident: Incident;
      timeline: TimelineEvent[];
      notes: IncidentNote[];
      aiAnalysis?: SkyOpsAIAnalysis | null;
      remediation?: StructuredRemediation | null;
      intelligence?: IntelligenceAnalysis | null;
    }>(`/api/v1/incidents/${id}`);
  }

  async getIncidentIntelligence(id: string): Promise<{ intelligence: IntelligenceAnalysis }> {
    return this.request<{ intelligence: IntelligenceAnalysis }>(`/api/v1/incidents/${id}/intelligence`);
  }

  async investigateIncident(
    id: string,
    question: string
  ): Promise<{ result: InvestigationQuestionResult; intelligence: IntelligenceAnalysis }> {
    return this.request<{ result: InvestigationQuestionResult; intelligence: IntelligenceAnalysis }>(
      `/api/v1/incidents/${id}/investigate`,
      {
        method: 'POST',
        body: JSON.stringify({ question })
      }
    );
  }

  async getIncidentAIAnalysis(id: string): Promise<{ analysis: SkyOpsAIAnalysis; remediation?: StructuredRemediation }> {
    return this.request<{ analysis: SkyOpsAIAnalysis; remediation?: StructuredRemediation }>(`/api/v1/incidents/${id}/ai-analysis`);
  }

  async triggerIncidentAIAnalysis(id: string, force = false): Promise<{ analysis: SkyOpsAIAnalysis; remediation?: StructuredRemediation }> {
    return this.request<{ analysis: SkyOpsAIAnalysis; remediation?: StructuredRemediation }>(`/api/v1/incidents/${id}/ai-analysis`, {
      method: 'POST',
      body: JSON.stringify({ force })
    });
  }

  async getIncidentRemediation(id: string): Promise<{ remediation: StructuredRemediation }> {
    return this.request<{ remediation: StructuredRemediation }>(`/api/v1/incidents/${id}/remediation`);
  }

  async approveRemediation(
    id: string,
    options?: { proposedImage?: string; comments?: string }
  ): Promise<{ success: boolean; message: string; remediation: StructuredRemediation }> {
    return this.request<{ success: boolean; message: string; remediation: StructuredRemediation }>(
      `/api/v1/incidents/${id}/remediation/approve`,
      {
        method: 'POST',
        body: JSON.stringify(options || {})
      }
    );
  }

  async rejectRemediation(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; remediation: StructuredRemediation }> {
    return this.request<{ success: boolean; message: string; remediation: StructuredRemediation }>(
      `/api/v1/incidents/${id}/remediation/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ reason })
      }
    );
  }

  async rollbackRemediation(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; message: string; remediation: StructuredRemediation }> {
    return this.request<{ success: boolean; message: string; remediation: StructuredRemediation }>(
      `/api/v1/incidents/${id}/remediation/rollback`,
      {
        method: 'POST',
        body: JSON.stringify({ reason })
      }
    );
  }

  async explainArchitecture(payload: any): Promise<{ explanation: any }> {
    return this.request<{ explanation: any }>('/api/v1/architecture/explain', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async updateIncident(
    id: string,
    updates: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      title?: string;
      assignee?: { userId: string; name: string; email: string };
      resolutionReason?: string;
    }
  ): Promise<Incident> {
    const data = await this.request<{ incident: Incident }>(`/api/v1/incidents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    return data.incident;
  }

  async addIncidentNote(incidentId: string, content: string): Promise<IncidentNote> {
    const data = await this.request<{ note: IncidentNote }>(`/api/v1/incidents/${incidentId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
    return data.note;
  }

  async deleteIncident(id: string): Promise<void> {
    await this.request<{ status: string; id: string }>(`/api/v1/incidents/${id}`, {
      method: 'DELETE'
    });
  }

  async clearAllIncidents(): Promise<number> {
    const data = await this.request<{ status: string; count: number }>(`/api/v1/incidents`, {
      method: 'DELETE'
    });
    return data.count;
  }

  // --- Overview ---
  async getOverview(): Promise<{
    metrics: OverviewMetrics;
    clusters: Cluster[];
    recentIncidents: Incident[];
    recentActivity: Array<{
      id: string;
      type: string;
      timestamp: number;
      title: string;
      description: string;
      incidentId?: string;
      clusterId?: string;
    }>;
  }> {
    return this.request<{
      metrics: OverviewMetrics;
      clusters: Cluster[];
      recentIncidents: Incident[];
      recentActivity: Array<{
        id: string;
        type: string;
        timestamp: number;
        title: string;
        description: string;
        incidentId?: string;
        clusterId?: string;
      }>;
    }>('/api/v1/overview');
  }

  // --- Development & QA Testing Simulation ---
  async simulateScenario(
    clusterId: string,
    scenario:
      | 'CrashLoopBackOff'
      | 'ImagePullBackOff'
      | 'OOMKilled'
      | 'NodeNotReady'
      | 'DeploymentDegraded'
      | 'PVCPending'
      | 'HighCPUPayments'
      | 'HighCPU'
      | 'RecoverAll'
  ): Promise<{ success: boolean; message: string; incidentId?: string }> {
    return this.request<{ success: boolean; message: string; incidentId?: string }>('/api/v1/dev/simulate-scenario', {
      method: 'POST',
      body: JSON.stringify({ clusterId, scenario })
    });
  }

  // --- Enterprise Audit Center ---
  async getAuditLogs(params?: {
    page?: number;
    limit?: number;
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    result?: string;
    search?: string;
    fromTimestamp?: number;
    toTimestamp?: number;
  }): Promise<{
    items: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const query = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          query.set(key, String(val));
        }
      });
    }
    const qStr = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/api/v1/audit${qStr}`);
  }

  async getAuditStats(): Promise<{
    total: number;
    actorCounts: Record<string, number>;
    actionCategories: Record<string, number>;
    lastEventTime: number | null;
    autonomousCount: number;
    securityCount: number;
    verified: boolean;
  }> {
    return this.request('/api/v1/audit/stats');
  }

  async verifyAuditIntegrity(): Promise<{
    verified: boolean;
    totalChecked: number;
    tampered: boolean;
    tamperedCount: number;
    latestHash: string;
    details: string;
  }> {
    return this.request('/api/v1/audit/integrity');
  }

  // --- Integrations & Webhooks ---
  async getWebhooks(): Promise<{ webhooks: any[] }> {
    return this.request('/api/v1/integrations/webhooks');
  }

  async createWebhook(data: { name: string; url: string; secret?: string; enabledEvents?: string[] }): Promise<{ webhook: any }> {
    return this.request('/api/v1/integrations/webhooks', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateWebhook(id: string, data: any): Promise<{ webhook: any }> {
    return this.request(`/api/v1/integrations/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteWebhook(id: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/v1/integrations/webhooks/${id}`, {
      method: 'DELETE'
    });
  }

  async testWebhook(id: string): Promise<{ success: boolean; statusCode?: number; latencyMs?: number; responseBody?: string; error?: string }> {
    return this.request(`/api/v1/integrations/webhooks/${id}/test`, {
      method: 'POST'
    });
  }

  async getWebhookDeliveries(id: string): Promise<{ deliveries: any[] }> {
    return this.request(`/api/v1/integrations/webhooks/${id}/deliveries`);
  }

  // --- Organization Usage & Quotas ---
  async getOrgUsage(): Promise<{ usage: any }> {
    return this.request('/api/v1/orgs/usage');
  }

  // --- System Health & Platform Metrics ---
  async getSystemHealth(): Promise<any> {
    return this.request('/api/v1/system/health');
  }

  async getSystemMetrics(): Promise<any> {
    return this.request('/api/v1/system/metrics');
  }

  // --- Cluster Token Rotation & Revocation ---
  async rotateClusterToken(clusterId: string): Promise<{
    success: boolean;
    cluster: Cluster;
    token: string;
    connectionCode: string;
    installKey: string;
  }> {
    return this.request(`/api/v1/clusters/${clusterId}/rotate-token`, {
      method: 'POST'
    });
  }

  async revokeClusterToken(clusterId: string): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/v1/clusters/${clusterId}/revoke-token`, {
      method: 'POST'
    });
  }

  // --- Incident Email Notifications Settings ---
  async getNotificationSettings(): Promise<{
    incidentEmailEnabled: boolean;
    email: string;
    updatedAt?: number;
    sender: string;
  }> {
    return this.request('/api/v1/settings/notifications');
  }

  async updateNotificationSettings(incidentEmailEnabled: boolean): Promise<{
    incidentEmailEnabled: boolean;
    email: string;
    updatedAt?: number;
    sender: string;
  }> {
    return this.request('/api/v1/settings/notifications', {
      method: 'PUT',
      body: JSON.stringify({ incidentEmailEnabled })
    });
  }

  async sendTestNotification(): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    recipient: string;
    sender: string;
    timestamp: number;
  }> {
    return this.request('/api/v1/settings/notifications/test', {
      method: 'POST'
    });
  }

  async getNotificationDeliveries(): Promise<{ deliveries: any[] }> {
    return this.request('/api/v1/settings/notifications/deliveries');
  }

  // --- SaaS Subscriptions, Plans & Billing ---
  async getBillingPlans(): Promise<{
    plans: Plan[];
    intervals: any[];
    defaultTrialDays: number;
  }> {
    return this.request('/api/v1/billing/plans');
  }

  async getBillingConfig(): Promise<{ provider: 'razorpay' | 'mock'; keyId: string | null; currency: string }> {
    return this.request('/api/v1/billing/config');
  }

  async getSubscriptionOverview(): Promise<OrgBillingOverview> {
    return this.request('/api/v1/billing/subscription');
  }

  async createCheckout(planId: PlanId, interval: BillingInterval, returnUrl?: string): Promise<{
    session: {
      id: string;
      sessionId: string;
      orderId?: string;
      subscriptionId?: string;
      keyId?: string;
      checkoutUrl: string;
      provider: string;
      amount: number;
      currency: string;
      planId: PlanId;
      billingInterval: BillingInterval;
    };
    planName?: string;
    intervalLabel?: string;
    totalPrice?: number;
    currency?: string;
    savings?: string;
  }> {
    return this.request('/api/v1/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, interval, returnUrl })
    });
  }

  async confirmCheckout(
    planId: PlanId,
    interval: BillingInterval,
    sessionId?: string,
    razorpayVerification?: {
      razorpayOrderId?: string;
      razorpaySubscriptionId?: string;
      razorpayPaymentId?: string;
      razorpaySignature?: string;
    }
  ): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/checkout/confirm', {
      method: 'POST',
      body: JSON.stringify({
        planId,
        interval,
        sessionId,
        ...(razorpayVerification || {})
      })
    });
  }

  async upgradePlan(planId: PlanId, interval: BillingInterval): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/upgrade', {
      method: 'POST',
      body: JSON.stringify({ planId, interval })
    });
  }

  async downgradePlan(planId: PlanId, interval: BillingInterval = 'MONTHLY'): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/downgrade', {
      method: 'POST',
      body: JSON.stringify({ planId, interval })
    });
  }

  async cancelSubscription(): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/cancel', {
      method: 'POST'
    });
  }

  async resumeSubscription(): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/resume', {
      method: 'POST'
    });
  }

  async getInvoices(): Promise<{ invoices: Invoice[] }> {
    return this.request('/api/v1/billing/invoices');
  }

  async simulateSubscriptionState(state: string, planId?: PlanId, interval?: BillingInterval): Promise<{
    success: boolean;
    subscription: Subscription;
    overview: OrgBillingOverview;
  }> {
    return this.request('/api/v1/billing/dev/simulate-state', {
      method: 'POST',
      body: JSON.stringify({ state, planId, interval })
    });
  }
}

export const api = new ApiClient();
