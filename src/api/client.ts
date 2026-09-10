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
  OrgMember,
  OverviewMetrics,
  Role,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  TimelineEvent,
  User,
  ClusterObservabilityMetrics,
  MetricHistoryPoint,
  NodeMetricsSummary,
  WorkloadMetricsSummary
} from '../types/index';

class ApiClient {
  private async getHeaders(): Promise<HeadersInit> {
    const savedOrg = localStorage.getItem('skyops_active_org_id');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (savedOrg) {
      headers['x-org-id'] = savedOrg;
    }

    // Attach real Firebase ID token or demo token
    if (auth.currentUser) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        headers['Authorization'] = `Bearer ${idToken}`;
      } catch (err) {
        console.warn('Failed to retrieve Firebase ID token:', err);
      }
    } else {
      const demoToken = localStorage.getItem('skyops_demo_token');
      if (demoToken) {
        headers['Authorization'] = `Bearer ${demoToken}`;
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
      throw new Error(errMsg);
    }

    return data as T;
  }

  // --- Auth & Session ---
  async getSession(): Promise<{
    user: User;
    currentOrg: Organization;
    organizations: Organization[];
    role: Role;
    members: OrgMember[];
  }> {
    return this.request('/api/v1/auth/session', { method: 'POST' });
  }

  // --- Organizations ---
  async getOrganizations(): Promise<Organization[]> {
    const data = await this.request<{ organizations: Organization[] }>('/api/v1/orgs');
    return data.organizations;
  }

  async createOrganization(name: string): Promise<Organization> {
    const data = await this.request<{ organization: Organization }>('/api/v1/orgs', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    return data.organization;
  }

  async getOrgMembers(): Promise<OrgMember[]> {
    const data = await this.request<{ members: OrgMember[] }>('/api/v1/orgs/members');
    return data.members;
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
    const data = await this.request<{ resources: KubernetesResource[] }>(`/api/v1/clusters/${clusterId}/resources`);
    return data.resources;
  }

  async getAllResources(filters?: {
    clusterId?: string;
    kind?: string;
    namespace?: string;
    health?: string;
    search?: string;
  }): Promise<KubernetesResource[]> {
    const params = new URLSearchParams();
    if (filters?.clusterId) params.set('clusterId', filters.clusterId);
    if (filters?.kind) params.set('kind', filters.kind);
    if (filters?.namespace) params.set('namespace', filters.namespace);
    if (filters?.health) params.set('health', filters.health);
    if (filters?.search) params.set('search', filters.search);

    const url = `/api/v1/resources${params.toString() ? `?${params.toString()}` : ''}`;
    const data = await this.request<{ resources: KubernetesResource[] }>(url);
    return data.resources;
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

  async getClusterMetricHistory(clusterId: string): Promise<MetricHistoryPoint[]> {
    const data = await this.request<{ history: MetricHistoryPoint[] }>(`/api/v1/clusters/${clusterId}/metrics/history`);
    return data.history;
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
    action?: string;
    resourceType?: string;
    resourceId?: string;
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
}

export const api = new ApiClient();
