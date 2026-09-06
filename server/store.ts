import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AgentStatus,
  Cluster,
  ClusterStatus,
  Incident,
  IncidentNote,
  IncidentSeverity,
  IncidentStatus,
  IncidentType,
  KubernetesResource,
  Organization,
  OrgMember,
  OverviewMetrics,
  Role,
  RemediationAction,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  TimelineEvent,
  User,
  ClusterObservabilityMetrics,
  MetricHistoryPoint,
  NodeMetricsSummary,
  WorkloadMetricsSummary
} from '../src/types/index';
import { AGENT_VERSION } from '../src/config/version';
import { IncidentDetector } from './engine/detector';
import { generateIncidentFingerprint } from './engine/fingerprint';
import {
  buildClusterObservabilityMetrics,
  buildNodeMetricsSummary,
  buildWorkloadMetricsSummary
} from './metrics';

export class DataStore {
  private users: Map<string, User> = new Map();
  private orgs: Map<string, Organization> = new Map();
  private members: Map<string, OrgMember[]> = new Map(); // orgId -> members
  private clusters: Map<string, Cluster> = new Map(); // clusterId -> cluster
  private clusterTokens: Map<string, { clusterId: string; orgId: string }> = new Map(); // tokenHash -> info
  private resources: Map<string, KubernetesResource[]> = new Map(); // clusterId -> resources
  private clusterMetrics: Map<string, ClusterObservabilityMetrics> = new Map(); // clusterId -> ClusterObservabilityMetrics
  private clusterMetricHistory: Map<string, MetricHistoryPoint[]> = new Map(); // clusterId -> MetricHistoryPoint[]
  private incidents: Map<string, Incident> = new Map(); // incidentId -> incident
  private incidentTimeline: Map<string, TimelineEvent[]> = new Map(); // incidentId -> events
  private incidentNotes: Map<string, IncidentNote[]> = new Map(); // incidentId -> notes
  private remediationActions: Map<string, RemediationAction> = new Map();
  private remediations: Map<string, StructuredRemediation> = new Map(); // incidentId -> StructuredRemediation
  private aiAnalyses: Map<string, SkyOpsAIAnalysis> = new Map(); // incidentId -> SkyOpsAIAnalysis
  private incidentCounter = 1001;
  private storagePath = path.join(process.cwd(), 'data', 'skyops_store.json');
  private saveTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.loadSnapshot();
    if (this.orgs.size === 0 && process.env.NODE_ENV !== 'production') {
      this.seedDevFixtures();
    }
    this.startHeartbeatMonitor();
  }

  private loadSnapshot() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const data = JSON.parse(raw);
        if (data.users) this.users = new Map(Object.entries(data.users));
        if (data.orgs) this.orgs = new Map(Object.entries(data.orgs));
        if (data.members) this.members = new Map(Object.entries(data.members));
        if (data.clusters) this.clusters = new Map(Object.entries(data.clusters));
        if (data.clusterTokens) this.clusterTokens = new Map(Object.entries(data.clusterTokens));
        if (data.resources) this.resources = new Map(Object.entries(data.resources));
        if (data.incidents) this.incidents = new Map(Object.entries(data.incidents));
        if (data.incidentTimeline) this.incidentTimeline = new Map(Object.entries(data.incidentTimeline));
        if (data.incidentNotes) this.incidentNotes = new Map(Object.entries(data.incidentNotes));
        if (data.remediationActions) this.remediationActions = new Map(Object.entries(data.remediationActions));
        if (data.remediations) this.remediations = new Map(Object.entries(data.remediations));
        if (data.aiAnalyses) this.aiAnalyses = new Map(Object.entries(data.aiAnalyses));
        if (data.incidentCounter) this.incidentCounter = data.incidentCounter;

        // Clean up any historical false-positive incidents generated against the SkyOps telemetry agent
        for (const [id, inc] of Array.from(this.incidents.entries())) {
          const resName = (inc.resourceName || '').toLowerCase();
          const ns = (inc.namespace || '').toLowerCase();
          if (
            ns === 'skyops-system' ||
            ns === 'skyops' ||
            resName === 'skyops-agent' ||
            resName.startsWith('skyops-agent-')
          ) {
            this.incidents.delete(id);
            this.incidentTimeline.delete(id);
            this.incidentNotes.delete(id);
            this.remediations.delete(id);
            this.aiAnalyses.delete(id);
          }
        }
      }
    } catch (err) {
      console.warn('[DataStore] Notice: Unable to load store snapshot, starting clean:', err);
    }
  }

  public saveSnapshot() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      try {
        const dir = path.dirname(this.storagePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const data = {
          users: Object.fromEntries(this.users),
          orgs: Object.fromEntries(this.orgs),
          members: Object.fromEntries(this.members),
          clusters: Object.fromEntries(this.clusters),
          clusterTokens: Object.fromEntries(this.clusterTokens),
          resources: Object.fromEntries(this.resources),
          incidents: Object.fromEntries(this.incidents),
          incidentTimeline: Object.fromEntries(this.incidentTimeline),
          incidentNotes: Object.fromEntries(this.incidentNotes),
          remediationActions: Object.fromEntries(this.remediationActions),
          remediations: Object.fromEntries(this.remediations),
          aiAnalyses: Object.fromEntries(this.aiAnalyses),
          incidentCounter: this.incidentCounter
        };
        fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        console.warn('[DataStore] Snapshot save notice:', err);
      }
    }, 100);
    if (typeof this.saveTimeout.unref === 'function') {
      this.saveTimeout.unref();
    }
  }

  /**
   * Seed optional non-production developer fixtures if running locally
   */
  private seedDevFixtures() {
    // Only in explicit development mode
    if (process.env.NODE_ENV === 'production') return;

    const devOrgId = 'org-production-sre';
    const devOrg: Organization = {
      id: devOrgId,
      name: 'Acme Platform Engineering',
      slug: 'acme-platform',
      createdAt: Date.now() - 30 * 86400000,
      membersCount: 3
    };
    this.orgs.set(devOrgId, devOrg);
    this.saveSnapshot();
  }

  // --- Heartbeat & Connection Monitoring ---
  private startHeartbeatMonitor() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const cluster of this.clusters.values()) {
        // If the cluster is in initial pending or awaiting confirmation, do not mark it offline
        if (cluster.connectionState === 'pending' || cluster.connectionState === 'agent_detected') {
          continue;
        }

        if (!cluster.lastHeartbeat) {
          cluster.agentStatus = 'OFFLINE';
          cluster.status = 'AGENT_OFFLINE';
          continue;
        }

        const elapsedSeconds = (now - cluster.lastHeartbeat) / 1000;
        if (elapsedSeconds > 180) {
          // Grace period: mark offline after 3 minutes without heartbeat
          cluster.agentStatus = 'OFFLINE';
          cluster.status = 'AGENT_OFFLINE';
          cluster.connectionState = 'offline';
        } else if (elapsedSeconds > 90) {
          cluster.agentStatus = 'DEGRADED';
          if (cluster.status === 'HEALTHY') cluster.status = 'WARNING';
        } else {
          cluster.agentStatus = 'CONNECTED';
          cluster.connectionState = 'connected';
          // Re-evaluate health based on incidents
          const openIncidents = Array.from(this.incidents.values()).filter(
            (i) => i.clusterId === cluster.id && (i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED')
          );
          const hasCritical = openIncidents.some((i) => i.severity === 'CRITICAL');
          const hasWarning = openIncidents.some((i) => i.severity === 'HIGH' || i.severity === 'MEDIUM');

          if (hasCritical) cluster.status = 'CRITICAL';
          else if (hasWarning) cluster.status = 'WARNING';
          else cluster.status = 'HEALTHY';
        }
      }
    }, 15000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  // --- Auth & User / Organization Management ---
  public upsertUser(userData: { id: string; email: string; name: string }): User {
    const existing = this.users.get(userData.id);
    if (existing) {
      existing.email = userData.email;
      existing.name = userData.name;
      this.saveSnapshot();
      return existing;
    }

    const newUser: User = {
      id: userData.id,
      email: userData.email,
      name: userData.name
    };
    this.users.set(newUser.id, newUser);
    this.saveSnapshot();
    return newUser;
  }

  public getUser(userId: string): User | null {
    return this.users.get(userId) || null;
  }

  public getOrganizationsForUser(userId: string): Organization[] {
    const userOrgs: Organization[] = [];
    for (const [orgId, members] of this.members.entries()) {
      if (members.some((m) => m.userId === userId)) {
        const org = this.orgs.get(orgId);
        if (org) userOrgs.push(org);
      }
    }
    return userOrgs;
  }

  public createOrganization(name: string, ownerUserId: string): Organization {
    const orgId = `org-${crypto.randomBytes(6).toString('hex')}`;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 30);

    const org: Organization = {
      id: orgId,
      name,
      slug,
      createdAt: Date.now(),
      membersCount: 1
    };
    this.orgs.set(orgId, org);

    const user = this.users.get(ownerUserId);
    this.members.set(orgId, [
      {
        userId: ownerUserId,
        email: user?.email || '',
        name: user?.name || 'Workspace Owner',
        role: 'OWNER',
        joinedAt: Date.now()
      }
    ]);

    this.saveSnapshot();
    return org;
  }

  public getOrgMembers(orgId: string): OrgMember[] {
    return this.members.get(orgId) || [];
  }

  public checkUserOrgAccess(userId: string, orgId: string): { hasAccess: boolean; role?: Role } {
    const orgMembers = this.members.get(orgId) || [];
    const member = orgMembers.find((m) => m.userId === userId);
    if (!member) return { hasAccess: false };
    return { hasAccess: true, role: member.role };
  }

  // --- Cluster Management ---
  public getClusters(orgId: string): Cluster[] {
    return Array.from(this.clusters.values())
      .filter((c) => c.orgId === orgId)
      .map((c) => {
        // Do not expose raw agentToken in generic cluster list
        const { agentToken, ...sanitized } = c;
        return sanitized as Cluster;
      });
  }

  public getCluster(clusterId: string, orgId: string, includeToken = false): Cluster | null {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) return null;
    if (includeToken) return cluster;
    const { agentToken, ...sanitized } = cluster;
    return sanitized as Cluster;
  }

  public getClusterByIdInternal(clusterId: string): Cluster | null {
    return this.clusters.get(clusterId) || null;
  }

  /**
   * Generates a cryptographically random, human-friendly connection key e.g. SKYOPS-7K4M-92PX
   */
  private generatePairingCode(): string {
    const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Base32 unambiguous charset (no 0, 1, I, O)
    const bytes = crypto.randomBytes(8);
    let part1 = '';
    let part2 = '';
    for (let i = 0; i < 4; i++) {
      part1 += alphabet[bytes[i] % alphabet.length];
      part2 += alphabet[bytes[i + 4] % alphabet.length];
    }
    return `SKYOPS-${part1}-${part2}`;
  }

  public getClusterByInstallKey(installKey: string): Cluster | null {
    if (!installKey) return null;
    for (const cluster of this.clusters.values()) {
      if (cluster.installKey === installKey) {
        return cluster;
      }
    }
    return null;
  }

  public createCluster(
    orgId: string,
    name: string,
    description?: string
  ): { cluster: Cluster; rawToken: string; connectionCode: string; installKey: string } {
    const clusterId = `cls-${crypto.randomBytes(6).toString('hex')}`;
    const rawToken = `sky_agent_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Generate single-use, 15-minute connection pairing key (e.g. 8F4K-29XM)
    const connectionCode = this.generatePairingCode();
    const connectionCodeExpiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes validity

    // Generate separate short-lived installation session for secure automated download
    const installKey = `sky_inst_${crypto.randomBytes(20).toString('hex')}`;
    const installKeyExpiresAt = Date.now() + 60 * 60 * 1000; // 60 minutes validity

    const cluster: Cluster = {
      id: clusterId,
      orgId,
      name,
      description: description || '',
      status: 'pending',
      agentStatus: 'PENDING',
      connectionState: 'pending',
      connectionCode,
      connectionCodeExpiresAt,
      installKey,
      installKeyExpiresAt,
      nodeCount: 0,
      podCount: 0,
      openIncidentCount: 0,
      createdAt: Date.now(),
      agentToken: rawToken
    };

    this.clusters.set(clusterId, cluster);
    this.clusterTokens.set(tokenHash, { clusterId, orgId });
    this.resources.set(clusterId, []);
    this.saveSnapshot();

    return { cluster, rawToken, connectionCode, installKey };
  }

  public verifyClusterConnection(clusterId: string, orgId: string, providedCode: string): Cluster {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) {
      throw new Error('Cluster not found in active organization');
    }

    if (cluster.connectionState === 'connected' && cluster.agentStatus === 'CONNECTED') {
      return cluster;
    }

    if (!cluster.connectionCode) {
      throw new Error('This connection key has already been consumed or is invalid. Generate a new connection key.');
    }

    if (cluster.connectionCodeExpiresAt && Date.now() > cluster.connectionCodeExpiresAt) {
      throw new Error('This connection key has expired. Generate a new connection key.');
    }

    // Strip whitespace, hyphens, and optional SKYOPS- prefix
    const cleanProvided = providedCode.trim().toUpperCase().replace(/^SKYOPS-?/, '').replace(/[\s-]+/g, '');
    const cleanStored = cluster.connectionCode.trim().toUpperCase().replace(/^SKYOPS-?/, '').replace(/[\s-]+/g, '');

    if (cleanProvided !== cleanStored) {
      throw new Error('That connection key is incorrect.');
    }

    // Success: Activate connection and permanently invalidate the single-use pairing code and installKey
    cluster.status = 'HEALTHY';
    cluster.agentStatus = 'CONNECTED';
    cluster.connectionState = 'connected';
    cluster.connectedAt = Date.now();
    cluster.lastHeartbeat = cluster.lastHeartbeat || Date.now();
    cluster.lastHeartbeatAt = cluster.lastHeartbeatAt || Date.now();
    cluster.connectionCode = undefined;
    cluster.connectionCodeExpiresAt = undefined;
    cluster.installKey = undefined;
    cluster.installKeyExpiresAt = undefined;
    this.saveSnapshot();

    return cluster;
  }

  public regenerateClusterCredentials(
    clusterId: string,
    orgId: string
  ): { cluster: Cluster; rawToken: string; connectionCode: string; installKey: string } {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) {
      throw new Error('Cluster not found in active organization');
    }

    // Invalidate existing tokens for this cluster
    for (const [hash, info] of this.clusterTokens.entries()) {
      if (info.clusterId === clusterId) {
        this.clusterTokens.delete(hash);
      }
    }

    // Generate new credentials
    const rawToken = `sky_agent_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const connectionCode = this.generatePairingCode();
    const connectionCodeExpiresAt = Date.now() + 15 * 60 * 1000;

    const installKey = `sky_inst_${crypto.randomBytes(20).toString('hex')}`;
    const installKeyExpiresAt = Date.now() + 60 * 60 * 1000;

    cluster.agentToken = rawToken;
    cluster.connectionCode = connectionCode;
    cluster.connectionCodeExpiresAt = connectionCodeExpiresAt;
    cluster.installKey = installKey;
    cluster.installKeyExpiresAt = installKeyExpiresAt;
    cluster.status = 'pending';
    cluster.agentStatus = 'PENDING';
    cluster.connectionState = 'pending';
    cluster.agentDetectedAt = undefined;

    this.clusterTokens.set(tokenHash, { clusterId, orgId });
    this.saveSnapshot();

    return { cluster, rawToken, connectionCode, installKey };
  }

  public disconnectCluster(clusterId: string, orgId: string): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) return false;

    // Revoke token hash to reject future agent requests
    for (const [hash, info] of this.clusterTokens.entries()) {
      if (info.clusterId === clusterId) {
        this.clusterTokens.delete(hash);
      }
    }

    cluster.agentToken = undefined;
    cluster.status = 'AGENT_OFFLINE';
    cluster.agentStatus = 'OFFLINE';
    cluster.connectionState = 'offline';
    this.saveSnapshot();
    return true;
  }

  public deleteCluster(clusterId: string, orgId: string): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster || cluster.orgId !== orgId) return false;

    // Delete token hash
    for (const [hash, info] of this.clusterTokens.entries()) {
      if (info.clusterId === clusterId) {
        this.clusterTokens.delete(hash);
      }
    }

    this.clusters.delete(clusterId);
    this.resources.delete(clusterId);

    // Delete associated incidents
    for (const [incId, inc] of this.incidents.entries()) {
      if (inc.clusterId === clusterId) {
        this.incidents.delete(incId);
        this.incidentTimeline.delete(incId);
        this.incidentNotes.delete(incId);
      }
    }

    this.saveSnapshot();
    return true;
  }

  // --- Agent Authentication & Ingestion ---
  public authenticateAgentToken(rawToken: string): { clusterId: string; orgId: string } | null {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const entry = this.clusterTokens.get(tokenHash);
    return entry || null;
  }

  public registerAgent(
    clusterId: string,
    agentVersion?: string,
    k8sVersion?: string
  ): { status: string; clusterId: string; connectionCode?: string; serverTime: number } {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) {
      throw new Error('Cluster not found for this agent token');
    }

    const now = Date.now();
    cluster.lastSeenAt = now;
    cluster.lastHeartbeat = now;
    cluster.lastHeartbeatAt = now;
    cluster.agentDetectedAt = cluster.agentDetectedAt || now;
    cluster.connectedAt = cluster.connectedAt || now;
    if (agentVersion) cluster.agentVersion = agentVersion;
    if (k8sVersion) cluster.k8sVersion = k8sVersion;

    cluster.agentStatus = 'CONNECTED';
    cluster.connectionState = 'connected';
    cluster.connectionStatus = 'connected';
    if (cluster.status === 'pending' || cluster.status === 'installing' || cluster.status === 'agent_detected') {
      cluster.status = 'HEALTHY';
    }

    return {
      status: 'REGISTERED',
      clusterId,
      connectionCode: cluster.connectionCode,
      serverTime: now
    };
  }

  public recordAgentHeartbeat(
    clusterId: string,
    agentVersion?: string,
    k8sVersion?: string,
    nodeCount?: number,
    podCount?: number
  ): boolean {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return false;

    const now = Date.now();
    cluster.lastHeartbeat = now;
    cluster.lastHeartbeatAt = now;
    cluster.lastSeenAt = now;
    cluster.connectedAt = cluster.connectedAt || now;
    if (agentVersion && agentVersion.trim() !== '') {
      cluster.agentVersion = agentVersion;
    }

    // Preserve real live Kubernetes version; reject outdated dummy fallback v1.31.2 if real version exists
    if (k8sVersion && k8sVersion.trim() !== '' && k8sVersion !== 'v1.31.2') {
      cluster.k8sVersion = k8sVersion;
    } else if (k8sVersion && !cluster.k8sVersion) {
      cluster.k8sVersion = k8sVersion;
    }

    const existingResources = this.resources.get(clusterId) || [];
    const calculatedNodes = existingResources.filter((r) => r.kind === 'Node').length;
    const calculatedPods = existingResources.filter((r) => r.kind === 'Pod').length;

    if (typeof nodeCount === 'number' && nodeCount > 0) {
      cluster.nodeCount = nodeCount;
    } else if (calculatedNodes > 0 || cluster.nodeCount === undefined) {
      cluster.nodeCount = calculatedNodes;
    }

    if (typeof podCount === 'number' && podCount > 0) {
      cluster.podCount = podCount;
    } else if (calculatedPods > 0 || cluster.podCount === undefined) {
      cluster.podCount = calculatedPods;
    }

    // Derive K8s version from Node resources if cluster version is still missing or outdated
    if ((!cluster.k8sVersion || cluster.k8sVersion === 'v1.31.2') && calculatedNodes > 0) {
      const firstNode = existingResources.find((r) => r.kind === 'Node');
      const kubeletVer = (firstNode?.statusSummary?.kubeletVersion as string) || (firstNode?.specSummary?.kubeletVersion as string);
      if (kubeletVer) {
        cluster.k8sVersion = kubeletVer;
      }
    }

    cluster.agentStatus = 'CONNECTED';
    cluster.connectionState = 'connected';
    cluster.connectionStatus = 'connected';

    // Refresh cluster health status based on open incidents
    const openIncidents = Array.from(this.incidents.values()).filter(
      (i) => i.clusterId === clusterId && (i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED')
    );
    const hasCritical = openIncidents.some((i) => i.severity === 'CRITICAL');
    const hasWarning = openIncidents.some((i) => i.severity === 'HIGH' || i.severity === 'MEDIUM');

    if (hasCritical) cluster.status = 'CRITICAL';
    else if (hasWarning) cluster.status = 'WARNING';
    else cluster.status = 'HEALTHY';

    cluster.openIncidentCount = openIncidents.length;

    return true;
  }

  public syncClusterResources(clusterId: string, incomingResources: KubernetesResource[], snapshotComplete = false): void {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;

    this.resources.set(clusterId, incomingResources);

    // Update counts
    const nodes = incomingResources.filter((r) => r.kind === 'Node');
    const pods = incomingResources.filter((r) => r.kind === 'Pod');
    cluster.nodeCount = nodes.length;
    cluster.podCount = pods.length;

    // Detect K8s Version from Node telemetry if present
    if (nodes.length > 0) {
      const firstNode = nodes[0];
      const kubeletVer = (firstNode.statusSummary?.kubeletVersion as string) || (firstNode.specSummary?.kubeletVersion as string);
      if (kubeletVer) {
        cluster.k8sVersion = kubeletVer;
      }
    }

    // Attach Node Metrics Summary to nodes
    const podsByNode = new Map<string, KubernetesResource[]>();
    for (const pod of pods) {
      const nodeName = pod.nodeName || ((pod.specSummary?.nodeName as string) || '').trim() || 'unassigned';
      if (!podsByNode.has(nodeName)) podsByNode.set(nodeName, []);
      podsByNode.get(nodeName)!.push(pod);
    }
    for (const node of nodes) {
      node.metrics = buildNodeMetricsSummary(node, podsByNode.get(node.name) || []);
    }

    // Compute and record cluster observability metrics
    const clusterObservability = buildClusterObservabilityMetrics(cluster, incomingResources);
    this.clusterMetrics.set(clusterId, clusterObservability);

    const history = this.clusterMetricHistory.get(clusterId) || [];
    const newPoint: MetricHistoryPoint = {
      timestamp: clusterObservability.observedAt,
      cpuUsageMillicores: clusterObservability.cpu.usage?.value,
      cpuRequestMillicores: clusterObservability.cpu.request.value,
      cpuCapacityMillicores: clusterObservability.cpu.capacity.value,
      memoryUsageBytes: clusterObservability.memory.usage?.value,
      memoryRequestBytes: clusterObservability.memory.request.value,
      memoryCapacityBytes: clusterObservability.memory.capacity.value,
      isUsageAvailable: clusterObservability.isUsageAvailable
    };
    history.push(newPoint);
    if (history.length > 60) {
      history.shift();
    }
    this.clusterMetricHistory.set(clusterId, history);

    // Ensure agent infrastructure components do not leave legacy incident tickets
    for (const [id, inc] of Array.from(this.incidents.entries())) {
      if (inc.clusterId === clusterId) {
        const resName = (inc.resourceName || '').toLowerCase();
        const ns = (inc.namespace || '').toLowerCase();
        if (
          ns === 'skyops-system' ||
          ns === 'skyops' ||
          resName === 'skyops-agent' ||
          resName.startsWith('skyops-agent-')
        ) {
          this.incidents.delete(id);
          this.incidentTimeline.delete(id);
          this.incidentNotes.delete(id);
          this.remediations.delete(id);
          this.aiAnalyses.delete(id);
        }
      }
    }

    // Run deterministic incident detection & auto-recovery on each resource
    for (const res of incomingResources) {
      this.evaluateResourceObservation(cluster.orgId, clusterId, cluster.name, res);
    }

    // Auto-clean any false positive Deployment/DaemonSet/Pod incidents where the resource is currently healthy
    for (const inc of this.incidents.values()) {
      if (inc.clusterId === clusterId && (inc.status === 'OPEN' || inc.status === 'IN_PROGRESS' || inc.status === 'ACKNOWLEDGED')) {
        const matchingResource = incomingResources.find(
          (r) =>
            r.kind.toLowerCase() === inc.resourceKind.toLowerCase() &&
            (r.namespace || 'default').toLowerCase() === inc.namespace.toLowerCase() &&
            r.name.toLowerCase() === inc.resourceName.toLowerCase()
        );

        if (matchingResource) {
          const recovery = IncidentDetector.evaluateRecovery(matchingResource, inc.incidentType);
          if (recovery.recovered && this.canResolveFromTelemetry(inc, matchingResource)) {
            inc.status = 'RESOLVED';
            inc.resolvedAt = Date.now();
            inc.updatedAt = Date.now();
            inc.resolutionSource = 'AUTOMATIC_VERIFIED';
            inc.resolution = {
              source: 'AUTOMATIC_VERIFIED',
              resolvedAt: inc.resolvedAt,
              reason: recovery.reason,
              verificationDetails: 'Authoritative telemetry verified healthy workload state'
            };
            this.addTimelineEvent(inc.id, {
              type: 'RECOVERY',
              actor: { type: 'AGENT', name: 'SkyOps Telemetry Engine' },
              description: `Auto-resolved: ${recovery.reason}`,
              metadata: { resolutionSource: 'AUTOMATIC_VERIFIED' }
            });
          }
        } else if (snapshotComplete) {
          const actions = [...this.remediationActions.values()].filter((a) => a.incidentId === inc.id);
          const hasInFlightAction = actions.some((a) => a.status === 'PENDING' || a.status === 'DELIVERED');
          const isControllerOwnedPod =
            inc.resourceKind === 'Pod' &&
            Array.isArray((inc.technicalDetails as any)?.ownerReferences) &&
            (inc.technicalDetails as any).ownerReferences.length > 0;
          if (!hasInFlightAction && !isControllerOwnedPod) {
            // A standalone resource absent from an explicitly complete snapshot was deleted.
            // Never infer deletion from a partial/failed scrape, and do not resolve controller-managed pods simply because failing pod was terminated.
            inc.status = 'RESOLVED';
            inc.resolvedAt = Date.now();
            inc.updatedAt = Date.now();
            inc.resolutionSource = 'AUTOMATIC_VERIFIED';
            inc.resolution = {
              source: 'AUTOMATIC_VERIFIED',
              resolvedAt: inc.resolvedAt,
              reason: 'Resource no longer exists in a complete Kubernetes snapshot',
              verificationDetails: 'Confirmed absent from complete cluster telemetry snapshot'
            };
            this.addTimelineEvent(inc.id, {
              type: 'RECOVERY',
              actor: { type: 'AGENT', name: 'SkyOps Telemetry Engine' },
              description: 'Auto-resolved: resource no longer exists in a complete Kubernetes snapshot',
              metadata: { resolutionSource: 'AUTOMATIC_VERIFIED' }
            });
          }
        }
      }
    }

    // Closed-Loop AI Remediation Verification from live Kubernetes telemetry
    for (const rem of this.remediations.values()) {
      if (
        rem.clusterId === clusterId &&
        (rem.status === 'DISPATCHED' || rem.status === 'EXECUTED' || rem.status === 'VERIFYING')
      ) {
        const action = [...this.remediationActions.values()].find((a) => a.incidentId === rem.incidentId);
        if (action?.status === 'FAILED') {
          rem.status = 'FAILED';
          rem.updatedAt = Date.now();
          continue;
        }

        const matchingResource = incomingResources.find(
          (r) =>
            r.kind.toLowerCase() === rem.targetResource.kind.toLowerCase() &&
            (r.namespace || 'default').toLowerCase() === rem.targetResource.namespace.toLowerCase() &&
            r.name.toLowerCase() === rem.targetResource.name.toLowerCase()
        );

        // Verification strictly requires that the Agent has completed execution AND the incoming telemetry
        // was observed after the action completion timestamp.
        if (
          matchingResource &&
          action &&
          action.status === 'SUCCEEDED' &&
          action.completedAt &&
          matchingResource.updatedAt > action.completedAt
        ) {
          const containerStates =
            (matchingResource.statusSummary?.containerStates as Array<{
              name: string;
              state: string;
              ready: boolean;
              image?: string;
              waiting?: { reason: string; message?: string };
            }>) ||
            (matchingResource.containers as any) ||
            [];

          const targetContainer =
            containerStates.find((c) => c.name === rem.parameters.containerName) ||
            containerStates[0];

          const hasPullError =
            targetContainer?.waiting &&
            (targetContainer.waiting.reason === 'ImagePullBackOff' ||
              targetContainer.waiting.reason === 'ErrImagePull' ||
              targetContainer.waiting.reason === 'InvalidImageName');

          const isHealthy =
            !hasPullError &&
            (targetContainer?.ready === true ||
              targetContainer?.state === 'running' ||
              matchingResource.status === 'Running' ||
              matchingResource.health === 'HEALTHY');

          if (isHealthy) {
            rem.status = 'VERIFIED_RESOLVED';
            rem.updatedAt = Date.now();
            rem.verification = {
              verifiedAt: Date.now(),
              status: 'VERIFIED_RESOLVED',
              observedState: `Workload ${rem.targetResource.name} container ${rem.parameters.containerName} is healthy and running with verified image ${rem.parameters.proposedImage}.`,
              details: 'Authoritative telemetry verified zero ImagePull errors and normal ready state.',
              checkCount: (rem.verification?.checkCount || 0) + 1
            };

            // Automatically resolve the associated incident with explicit AUTOMATIC_VERIFIED provenance
            const inc = this.incidents.get(rem.incidentId);
            if (inc && (inc.status === 'OPEN' || inc.status === 'IN_PROGRESS' || inc.status === 'ACKNOWLEDGED')) {
              inc.status = 'RESOLVED';
              inc.resolvedAt = Date.now();
              inc.updatedAt = Date.now();
              inc.resolutionSource = 'AUTOMATIC_VERIFIED';
              inc.resolution = {
                source: 'AUTOMATIC_VERIFIED',
                resolvedAt: inc.resolvedAt,
                reason: `Remediation verified: ${rem.targetResource.kind} ${rem.targetResource.name} container image patched to ${rem.parameters.proposedImage}. Workload is Running & Ready.`,
                verificationDetails: 'Observed healthy Running/Ready state from live cluster telemetry after agent execution.'
              };
              this.addTimelineEvent(inc.id, {
                type: 'RECOVERY',
                actor: { type: 'AGENT', name: 'SkyOps Verification Engine' },
                description: `Remediation verified: ${rem.targetResource.kind} ${rem.targetResource.name} container image patched to ${rem.parameters.proposedImage}. Workload is Running & Ready.`,
                metadata: { resolutionSource: 'AUTOMATIC_VERIFIED', actionId: action.id }
              });
            }
          } else {
            rem.status = 'VERIFYING';
            rem.updatedAt = Date.now();
            rem.verification = {
              status: 'PENDING',
              checkCount: (rem.verification?.checkCount || 0) + 1,
              observedState: `Workload observation pending: container state is currently ${targetContainer?.state || 'waiting'}`
            };
          }
        } else if (rem.status === 'EXECUTED' || (action && action.status === 'SUCCEEDED')) {
          rem.status = 'VERIFYING';
          rem.updatedAt = Date.now();
          rem.verification = {
            status: 'PENDING',
            checkCount: (rem.verification?.checkCount || 0) + 1,
            observedState: 'Awaiting fresh telemetry observation after agent execution'
          };
        }
      }
    }

    this.updateClusterIncidentCount(clusterId);
    this.saveSnapshot();
  }

  // --- AI Analysis & Remediation Layer ---
  public getAIAnalysis(incidentId: string): SkyOpsAIAnalysis | null {
    return this.aiAnalyses.get(incidentId) || null;
  }

  public saveAIAnalysis(incidentId: string, analysis: SkyOpsAIAnalysis): void {
    this.aiAnalyses.set(incidentId, analysis);
    if (analysis.structuredRemediation && analysis.status === 'SUCCESS') {
      this.remediations.set(incidentId, analysis.structuredRemediation);
    } else {
      // Clear any previous unverified remediation proposal when AI is unavailable or failed
      const existing = this.remediations.get(incidentId);
      if (existing && existing.status === 'PROPOSED') {
        this.remediations.delete(incidentId);
      }
    }
    this.saveSnapshot();
  }

  public getRemediation(incidentId: string, orgId?: string): StructuredRemediation | null {
    const rem = this.remediations.get(incidentId);
    if (!rem) return null;
    if (orgId && rem.orgId !== orgId) {
      // Find incident to check orgId
      const inc = this.incidents.get(incidentId);
      if (!inc || inc.orgId !== orgId) return null;
    }
    return rem;
  }

  public saveRemediation(remediation: StructuredRemediation): void {
    this.remediations.set(remediation.incidentId, remediation);
    this.saveSnapshot();
  }

  public approveRemediation(
    incidentId: string,
    orgId: string,
    approver: { id: string; name: string; email?: string },
    overrides?: { proposedImage?: string; comments?: string }
  ): StructuredRemediation {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.orgId !== orgId) {
      throw new Error('Incident not found or unauthorized');
    }

    let rem = this.remediations.get(incidentId);
    if (!rem) {
      throw new Error(`No remediation proposal found for incident ${incidentId}`);
    }

    if (rem.status !== 'PROPOSED' && rem.status !== 'REJECTED') {
      throw new Error(`Remediation is already in status ${rem.status}`);
    }

    if (rem.isExecutable === false) {
      throw new Error(rem.unexecutableReason || 'Remediation proposal is marked as non-executable. Review recommended manual inspection steps.');
    }

    // Automated execution is strictly constrained to supported Kubernetes mutation: ReplacePodImage
    if (incident.resourceKind !== 'Pod') {
      throw new Error(`Cannot execute automated remediation: Resource kind "${incident.resourceKind}" is not supported for automated mutation. Only Pods can be mutated safely.`);
    }

    // Strictly forbid automated mutations on controller-managed Pods
    const clusterRes = this.resources.get(incident.clusterId) || [];
    const targetRes = clusterRes.find(
      (r) =>
        r.kind.toLowerCase() === 'pod' &&
        (r.namespace || 'default').toLowerCase() === incident.namespace.toLowerCase() &&
        r.name.toLowerCase() === incident.resourceName.toLowerCase()
    );
    const ownerRefs =
      (targetRes?.ownerReferences && targetRes.ownerReferences.length > 0)
        ? targetRes.ownerReferences
        : (Array.isArray((incident.technicalDetails as any)?.ownerReferences) && (incident.technicalDetails as any).ownerReferences.length > 0)
        ? (incident.technicalDetails as any).ownerReferences
        : [];

    if (ownerRefs.length > 0) {
      const ownerList = ownerRefs.map((o: any) => o.kind || 'Controller').join(', ');
      throw new Error(`Cannot execute automated remediation: Pod "${incident.resourceName}" is managed by controller (${ownerList}). In-cluster agent strictly refuses to mutate controller-managed pods directly. Update the parent controller manifest instead.`);
    }

    if (rem.actionType !== 'UPDATE_CONTAINER_IMAGE' && rem.actionType !== 'REVERT_TAG') {
      throw new Error(`Cannot execute automated remediation: Action type "${rem.actionType}" is not supported for automated agent execution.`);
    }

    const containerName = rem.parameters.containerName || incident.resourceName;
    const effectiveImage = (overrides?.proposedImage !== undefined ? overrides.proposedImage : rem.parameters.proposedImage || '').trim();
    if (!effectiveImage || effectiveImage === 'unknown' || effectiveImage === 'N/A') {
      throw new Error('Cannot approve remediation: No valid target container image specified');
    }

    // Enforce grounding: generic tags are blocked unless explicitly grounded in telemetry context
    const genericTags = [':latest', ':previous', ':stable', ':fixed', ':prod', ':v1', ':test', ':tag', ':some-tag'];
    if (!overrides?.proposedImage && genericTags.some((gt) => effectiveImage.toLowerCase().endsWith(gt))) {
      const contextText = JSON.stringify(incident.technicalDetails || {}).toLowerCase();
      if (!contextText.includes(effectiveImage.toLowerCase())) {
        throw new Error(`Cannot execute automated remediation: Proposed image tag "${effectiveImage}" is not grounded in cluster telemetry. Please specify an exact verified replacement image tag.`);
      }
    }

    const observedContainer = (incident.technicalDetails?.containers || []).find((c) => c.name === containerName);
    const expectedCurrentValue = observedContainer?.image || rem.parameters.currentImage || '';
    if (!expectedCurrentValue || expectedCurrentValue === effectiveImage) {
      throw new Error('Cannot approve remediation: Expected current image is invalid or identical to proposed value');
    }

    const cluster = this.clusters.get(incident.clusterId);
    const now = Date.now();

    // Apply any operator overrides (e.g. customized image tag)
    rem.parameters.proposedImage = effectiveImage;
    rem.parameters.currentImage = expectedCurrentValue;
    rem.parameters.containerName = containerName;
    if (rem.changePreview) {
      rem.changePreview.proposedValue = effectiveImage;
      rem.changePreview.currentValue = expectedCurrentValue;
      rem.changePreview.container = containerName;
    }

    // Register canonical RemediationAction for the SkyOps Agent to poll and execute
    const action: RemediationAction = {
      id: `act-${crypto.randomBytes(12).toString('hex')}`,
      incidentId,
      clusterId: incident.clusterId,
      type: 'ReplacePodImage',
      target: {
        kind: 'Pod',
        namespace: incident.namespace,
        name: incident.resourceName,
        container: containerName
      },
      fieldPath: `/spec/containers/${containerName}/image`,
      expectedCurrentValue,
      proposedValue: effectiveImage,
      approvingUserId: approver.id,
      approvingUserName: approver.name,
      approvedAt: now,
      status: 'PENDING'
    };
    this.remediationActions.set(action.id, action);

    rem.status = 'DISPATCHED';
    rem.orgId = orgId;
    rem.clusterId = incident.clusterId;
    rem.clusterName = cluster?.name || incident.clusterName;
    rem.updatedAt = now;
    rem.approval = {
      approvedBy: {
        userId: approver.id,
        name: approver.name,
        email: approver.email
      },
      approvedAt: now,
      comments: overrides?.comments,
      overrides: overrides?.proposedImage ? { proposedImage: overrides.proposedImage } : undefined
    };

    rem.execution = {
      dispatchedAt: now,
      status: 'PENDING',
      message: `Dispatched ReplacePodImage action to SkyOps Agent on cluster "${cluster?.name || incident.clusterName}"`
    };

    incident.status = 'IN_PROGRESS';
    incident.updatedAt = now;

    this.addTimelineEvent(incidentId, {
      type: 'REMEDIATION_APPROVED',
      actor: { type: 'USER', id: approver.id, name: approver.name },
      description: `AI Remediation Approved by ${approver.name}: Dispatched ReplacePodImage (target image: ${effectiveImage}) to SkyOps Agent on cluster "${cluster?.name || incident.clusterName}".`,
      metadata: {
        actionId: action.id,
        fieldPath: action.fieldPath,
        before: action.expectedCurrentValue,
        proposed: action.proposedValue
      }
    });

    this.saveSnapshot();
    return rem;
  }

  public rejectRemediation(
    incidentId: string,
    orgId: string,
    rejecter: { id: string; name: string },
    reason?: string
  ): StructuredRemediation {
    const incident = this.incidents.get(incidentId);
    if (!incident || incident.orgId !== orgId) {
      throw new Error('Incident not found or unauthorized');
    }

    const rem = this.remediations.get(incidentId);
    if (!rem) {
      throw new Error(`No remediation proposal found for incident ${incidentId}`);
    }

    rem.status = 'REJECTED';
    rem.updatedAt = Date.now();

    this.addTimelineEvent(incidentId, {
      type: 'STATE_CHANGE',
      actor: { type: 'USER', id: rejecter.id, name: rejecter.name },
      description: `AI Remediation Declined by ${rejecter.name}${reason ? `: ${reason}` : '.'}`
    });

    this.saveSnapshot();
    return rem;
  }

  public getPendingAgentActions(clusterId: string): StructuredRemediation[] {
    return Array.from(this.remediations.values()).filter(
      (rem) => rem.clusterId === clusterId && (rem.status === 'APPROVED' || rem.status === 'DISPATCHED')
    );
  }

  public recordAgentActionResult(
    clusterId: string,
    remediationIdOrIncidentId: string,
    result: { status: 'SUCCESS' | 'FAILED'; message?: string; appliedChanges?: Record<string, unknown>; agentVersion?: string }
  ): StructuredRemediation {
    // Find remediation by incidentId or id
    let rem = this.remediations.get(remediationIdOrIncidentId);
    if (!rem) {
      rem = Array.from(this.remediations.values()).find((r) => r.id === remediationIdOrIncidentId);
    }

    if (!rem || rem.clusterId !== clusterId) {
      throw new Error('Remediation action not found for this cluster');
    }

    const now = Date.now();
    rem.updatedAt = now;

    if (result.status === 'SUCCESS') {
      rem.status = 'EXECUTED';
      rem.execution = {
        dispatchedAt: rem.execution?.dispatchedAt || now - 5000,
        executedAt: now,
        agentVersion: result.agentVersion || AGENT_VERSION,
        status: 'SUCCESS',
        message: result.message || 'Strategic merge patch applied successfully to Kubernetes resource',
        appliedChanges: result.appliedChanges || { image: rem.parameters.proposedImage }
      };
      rem.verification = {
        status: 'PENDING',
        checkCount: 0,
        observedState: 'Awaiting next telemetry cycle for workload readiness'
      };

      this.addTimelineEvent(rem.incidentId, {
        type: 'STATE_CHANGE',
        actor: { type: 'AGENT', name: 'SkyOps Agent' },
        description: `SkyOps Agent successfully executed ${rem.actionType}: patched ${rem.targetResource.kind} ${rem.targetResource.name} to ${rem.parameters.proposedImage}. Awaiting verification.`
      });
    } else {
      rem.status = 'FAILED';
      rem.execution = {
        dispatchedAt: rem.execution?.dispatchedAt || now - 5000,
        executedAt: now,
        agentVersion: result.agentVersion || AGENT_VERSION,
        status: 'FAILED',
        message: result.message || 'Agent execution failed'
      };

      this.addTimelineEvent(rem.incidentId, {
        type: 'STATE_CHANGE',
        actor: { type: 'AGENT', name: 'SkyOps Agent' },
        description: `SkyOps Agent failed to execute ${rem.actionType}: ${result.message || 'Unknown execution error'}`
      });
    }

    this.saveSnapshot();
    return rem;
  }

  public deleteIncident(incidentId: string, orgId: string): boolean {
    const inc = this.incidents.get(incidentId);
    if (!inc || inc.orgId !== orgId) return false;

    this.incidents.delete(incidentId);
    this.incidentTimeline.delete(incidentId);
    this.incidentNotes.delete(incidentId);
    this.remediations.delete(incidentId);
    this.aiAnalyses.delete(incidentId);
    this.updateClusterIncidentCount(inc.clusterId);
    this.saveSnapshot();
    return true;
  }

  public clearAllIncidents(orgId: string): number {
    let count = 0;
    for (const [id, inc] of Array.from(this.incidents.entries())) {
      if (inc.orgId === orgId) {
        this.incidents.delete(id);
        this.incidentTimeline.delete(id);
        this.incidentNotes.delete(id);
        this.remediations.delete(id);
        this.aiAnalyses.delete(id);
        count++;
      }
    }
    for (const cluster of this.clusters.values()) {
      if (cluster.orgId === orgId) {
        this.updateClusterIncidentCount(cluster.id);
      }
    }
    this.saveSnapshot();
    return count;
  }

  public getClusterResources(clusterId: string, orgId: string): KubernetesResource[] {
    const cluster = this.getCluster(clusterId, orgId);
    if (!cluster) return [];
    const list = this.resources.get(clusterId) || [];
    return list.map((r) => ({ ...r, clusterName: cluster.name }));
  }

  public getAllResources(orgId: string): KubernetesResource[] {
    const clusters = this.getClusters(orgId);
    const result: KubernetesResource[] = [];
    for (const cluster of clusters) {
      const list = this.resources.get(cluster.id) || [];
      for (const r of list) {
        result.push({ ...r, clusterName: cluster.name });
      }
    }
    return result;
  }

  // --- Observability & Metrics Foundation Query Methods ---
  public getClusterObservabilityMetrics(clusterId: string, orgId: string): ClusterObservabilityMetrics | null {
    const cluster = this.getCluster(clusterId, orgId);
    if (!cluster) return null;
    const cached = this.clusterMetrics.get(clusterId);
    if (cached) return cached;
    const res = this.resources.get(clusterId) || [];
    const computed = buildClusterObservabilityMetrics(cluster, res);
    this.clusterMetrics.set(clusterId, computed);
    return computed;
  }

  public getNodeMetrics(clusterId: string, orgId: string): NodeMetricsSummary[] {
    const metrics = this.getClusterObservabilityMetrics(clusterId, orgId);
    return metrics ? metrics.nodes : [];
  }

  public getWorkloadMetrics(clusterId: string, orgId: string): WorkloadMetricsSummary[] {
    const metrics = this.getClusterObservabilityMetrics(clusterId, orgId);
    return metrics ? metrics.workloads : [];
  }

  public getClusterMetricHistory(clusterId: string, orgId: string): MetricHistoryPoint[] {
    const cluster = this.getCluster(clusterId, orgId);
    if (!cluster) return [];
    return this.clusterMetricHistory.get(clusterId) || [];
  }

  // --- Deterministic Incident Engine & Deduplication ---
  public evaluateResourceObservation(
    orgId: string,
    clusterId: string,
    clusterName: string,
    resource: KubernetesResource
  ): Incident | null {
    // 0. Do not create customer incident tickets for the SkyOps agent platform itself
    if (IncidentDetector.isAgentInfrastructure(resource)) {
      return null;
    }

    // 1. Evaluate Detection Rules
    const detection = IncidentDetector.evaluateResource(resource);

    if (detection && detection.detected) {
      const fingerprint = generateIncidentFingerprint(
        clusterId,
        resource.namespace || 'default',
        resource.kind,
        resource.name,
        detection.incidentType,
        detection.technicalDetails.containerName || '',
        detection.technicalDetails.rootCauseCategory || ''
      );

      // Deduplication: Look for existing active incident with same fingerprint
      const existingIncident = Array.from(this.incidents.values()).find(
        (inc) =>
          inc.fingerprint === fingerprint &&
          (inc.status === 'OPEN' || inc.status === 'ACKNOWLEDGED' || inc.status === 'IN_PROGRESS')
      );

      if (existingIncident) {
        // Active incident: update last seen, updated at, and technical details.
        // DO NOT increment occurrenceCount on repeated telemetry observations of the same active failure.
        existingIncident.lastSeenAt = Date.now();
        existingIncident.updatedAt = Date.now();
        existingIncident.technicalDetails = {
          ...existingIncident.technicalDetails,
          ...detection.technicalDetails
        };

        return existingIncident;
      }

      // Check if there was a previously resolved incident with the same fingerprint
      const resolvedIncident = Array.from(this.incidents.values()).find(
        (inc) => inc.fingerprint === fingerprint && inc.status === 'RESOLVED'
      );

      if (resolvedIncident) {
        // Same failure recurred after being resolved: reopen and increment occurrence counter
        resolvedIncident.status = 'OPEN';
        resolvedIncident.occurrenceCount += 1;
        resolvedIncident.lastSeenAt = Date.now();
        resolvedIncident.resolvedAt = null;
        resolvedIncident.updatedAt = Date.now();
        resolvedIncident.technicalDetails = {
          ...resolvedIncident.technicalDetails,
          ...detection.technicalDetails
        };

        this.addTimelineEvent(resolvedIncident.id, {
          type: 'OCCURRENCE',
          actor: { type: 'AGENT', name: 'SkyOps Agent' },
          description: `Incident recurred: failure condition detected again on ${resource.kind} ${resource.name} (Occurrence #${resolvedIncident.occurrenceCount})`,
          metadata: { occurrenceCount: resolvedIncident.occurrenceCount }
        });

        this.updateClusterIncidentCount(clusterId);
        return resolvedIncident;
      }

      // Create brand-new Incident with atomic SKY-XXXX sequence
      const nextNum = this.incidentCounter++;
      const incidentId = `SKY-${String(nextNum).padStart(4, '0')}`;

      const newIncident: Incident = {
        id: incidentId,
        fingerprint,
        orgId,
        clusterId,
        clusterName,
        namespace: resource.namespace || 'default',
        resourceKind: resource.kind,
        resourceName: resource.name,
        incidentType: detection.incidentType,
        title: detection.title,
        severity: detection.severity,
        status: 'OPEN',
        occurrenceCount: 1,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        technicalDetails: detection.technicalDetails,
        updatedAt: Date.now()
      };

      this.incidents.set(incidentId, newIncident);
      this.incidentTimeline.set(incidentId, []);
      this.incidentNotes.set(incidentId, []);

      // Timeline entry: DETECTION
      this.addTimelineEvent(incidentId, {
        type: 'DETECTION',
        actor: { type: 'SYSTEM', name: 'SkyOps Engine' },
        description: `Incident created: ${detection.title}`
      });

      this.updateClusterIncidentCount(clusterId);
      return newIncident;
    }

    // 2. Evaluate Auto-Recovery for any active incidents regarding this resource
    const activeIncidentsForResource = Array.from(this.incidents.values()).filter(
      (inc) =>
        inc.clusterId === clusterId &&
        inc.namespace.toLowerCase() === (resource.namespace || 'default').toLowerCase() &&
        inc.resourceKind.toLowerCase() === resource.kind.toLowerCase() &&
        inc.resourceName.toLowerCase() === resource.name.toLowerCase() &&
        (inc.status === 'OPEN' || inc.status === 'ACKNOWLEDGED' || inc.status === 'IN_PROGRESS')
    );

    for (const activeInc of activeIncidentsForResource) {
      const recovery = IncidentDetector.evaluateRecovery(resource, activeInc.incidentType);
      if (recovery.recovered && this.canResolveFromTelemetry(activeInc, resource)) {
        activeInc.status = 'RESOLVED';
        activeInc.resolvedAt = Date.now();
        activeInc.updatedAt = Date.now();
        activeInc.resolutionSource = 'AUTOMATIC_VERIFIED';
        activeInc.resolution = {
          source: 'AUTOMATIC_VERIFIED',
          resolvedAt: activeInc.resolvedAt,
          reason: recovery.reason,
          verificationDetails: 'Authoritative telemetry verified healthy workload state'
        };

        this.addTimelineEvent(activeInc.id, {
          type: 'RECOVERY',
          actor: { type: 'AGENT', name: 'SkyOps Agent' },
          description: `Automatic recovery detected: ${recovery.reason}`,
          metadata: { resolutionSource: 'AUTOMATIC_VERIFIED' }
        });

        this.updateClusterIncidentCount(clusterId);
      }
    }

    return null;
  }

  /** Evidence that closes an action-backed incident must be an observation received after the Agent result. */
  private canResolveFromTelemetry(incident: Incident, resource: KubernetesResource): boolean {
    const actions = [...this.remediationActions.values()].filter(a => a.incidentId === incident.id);
    if (actions.length === 0) return true;
    const action = actions.find(a => a.status === 'SUCCEEDED' && a.completedAt && resource.updatedAt > a.completedAt!);
    if (!action) return false;
    if (action) {
      this.addTimelineEvent(incident.id, {
        type: 'RECOVERY', actor: { type: 'AGENT', name: 'SkyOps Telemetry Engine' },
        description: 'Verification passed from fresh Agent telemetry observed after remediation execution',
        metadata: { actionId: action.id, actionCompletedAt: action.completedAt, telemetryObservedAt: resource.updatedAt, verificationResult: 'PASSED' }
      });
    }
    return true;
  }

  private updateClusterIncidentCount(clusterId: string) {
    const cluster = this.clusters.get(clusterId);
    if (!cluster) return;

    const openCount = Array.from(this.incidents.values()).filter(
      (i) => i.clusterId === clusterId && (i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED')
    ).length;

    cluster.openIncidentCount = openCount;

    if (cluster.agentStatus === 'CONNECTED') {
      const hasCritical = Array.from(this.incidents.values()).some(
        (i) => i.clusterId === clusterId && i.severity === 'CRITICAL' && i.status !== 'RESOLVED' && i.status !== 'CLOSED'
      );
      const hasWarning = Array.from(this.incidents.values()).some(
        (i) => i.clusterId === clusterId && (i.severity === 'HIGH' || i.severity === 'MEDIUM') && i.status !== 'RESOLVED' && i.status !== 'CLOSED'
      );

      if (hasCritical) cluster.status = 'CRITICAL';
      else if (hasWarning) cluster.status = 'WARNING';
      else cluster.status = 'HEALTHY';
    }
  }

  // --- Incident Queries & Mutations ---
  public getIncidents(
    orgId: string,
    filters?: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      clusterId?: string;
      namespace?: string;
      search?: string;
    }
  ): Incident[] {
    let list = Array.from(this.incidents.values()).filter((i) => i.orgId === orgId);

    if (filters?.status) list = list.filter((i) => i.status === filters.status);
    if (filters?.severity) list = list.filter((i) => i.severity === filters.severity);
    if (filters?.clusterId) list = list.filter((i) => i.clusterId === filters.clusterId);
    if (filters?.namespace) list = list.filter((i) => i.namespace.toLowerCase() === filters.namespace?.toLowerCase());
    if (filters?.search) {
      const q = filters.search.toLowerCase();
      list = list.filter(
        (i) =>
          i.id.toLowerCase().includes(q) ||
          i.title.toLowerCase().includes(q) ||
          i.resourceName.toLowerCase().includes(q) ||
          i.namespace.toLowerCase().includes(q) ||
          i.clusterName.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  public getIncident(incidentId: string, orgId: string): Incident | null {
    if (!incidentId) return null;
    let inc = this.incidents.get(incidentId);
    if (!inc) {
      const target = incidentId.toLowerCase();
      inc = Array.from(this.incidents.values()).find((i) => i.id.toLowerCase() === target);
    }
    if (!inc || inc.orgId !== orgId) return null;
    return inc;
  }

  public updateIncident(
    incidentId: string,
    orgId: string,
    updates: {
      status?: IncidentStatus;
      severity?: IncidentSeverity;
      title?: string;
      resolutionReason?: string;
      assignee?: { userId: string; name: string; email: string };
    },
    userActor: { id: string; name: string }
  ): Incident | null {
    const inc = this.getIncident(incidentId, orgId);
    if (!inc) return null;

    if (updates.status && updates.status !== inc.status) {
      if (updates.status === 'RESOLVED') {
        const pendingOrUnverifiedActions = [...this.remediationActions.values()].filter(
          (a) => a.incidentId === inc.id && (a.status === 'PENDING' || a.status === 'DELIVERED' || a.status === 'SUCCEEDED')
        );
        const rem = this.remediations.get(inc.id);
        const hasActiveRemediation =
          pendingOrUnverifiedActions.length > 0 ||
          (rem && (rem.status === 'DISPATCHED' || rem.status === 'EXECUTED' || rem.status === 'VERIFYING'));

        if (hasActiveRemediation) {
          throw new Error('Remediation-backed incidents require authoritative telemetry verification before resolution');
        }

        inc.resolutionSource = 'MANUAL';
        inc.resolution = {
          source: 'MANUAL',
          resolvedAt: Date.now(),
          resolvedBy: { id: userActor.id, name: userActor.name },
          reason: updates.resolutionReason || 'Manual resolution by operator'
        };
      } else if (updates.status !== 'CLOSED') {
        inc.resolutionSource = undefined;
        inc.resolution = undefined;
      }

      const oldStatus = inc.status;
      inc.status = updates.status;
      if (updates.status === 'RESOLVED' && !inc.resolvedAt) {
        inc.resolvedAt = Date.now();
      } else if (updates.status !== 'RESOLVED' && updates.status !== 'CLOSED') {
        inc.resolvedAt = null;
      }

      const desc =
        updates.status === 'RESOLVED'
          ? `Status changed to RESOLVED by ${userActor.name} (Manual resolution${updates.resolutionReason ? ': ' + updates.resolutionReason : ''})`
          : `Status changed from ${oldStatus} to ${updates.status}`;

      this.addTimelineEvent(incidentId, {
        type: 'STATE_CHANGE',
        actor: { type: 'USER', id: userActor.id, name: userActor.name },
        description: desc,
        metadata:
          updates.status === 'RESOLVED'
            ? { resolutionSource: 'MANUAL', reason: updates.resolutionReason || 'Manual operator resolution' }
            : undefined
      });
      this.updateClusterIncidentCount(inc.clusterId);
    }

    if (updates.severity && updates.severity !== inc.severity) {
      const oldSeverity = inc.severity;
      inc.severity = updates.severity;
      this.addTimelineEvent(incidentId, {
        type: 'SEVERITY_CHANGE',
        actor: { type: 'USER', id: userActor.id, name: userActor.name },
        description: `Severity adjusted from ${oldSeverity} to ${updates.severity}`
      });
      this.updateClusterIncidentCount(inc.clusterId);
    }

    if (updates.title && updates.title !== inc.title) {
      inc.title = updates.title;
      this.addTimelineEvent(incidentId, {
        type: 'MANUAL_UPDATE',
        actor: { type: 'USER', id: userActor.id, name: userActor.name },
        description: `Title updated to: ${updates.title}`
      });
    }

    if (updates.assignee) {
      inc.assignee = updates.assignee;
      this.addTimelineEvent(incidentId, {
        type: 'ASSIGNMENT',
        actor: { type: 'USER', id: userActor.id, name: userActor.name },
        description: `Assigned investigation to ${updates.assignee.name} (${updates.assignee.email})`
      });
    }

    inc.updatedAt = Date.now();
    return inc;
  }

  public getIncidentTimeline(incidentId: string, orgId: string): TimelineEvent[] {
    const inc = this.getIncident(incidentId, orgId);
    if (!inc) return [];
    return (this.incidentTimeline.get(incidentId) || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  }

  public addTimelineEvent(incidentId: string, event: Omit<TimelineEvent, 'id' | 'incidentId' | 'timestamp'>): TimelineEvent {
    const newEvent: TimelineEvent = {
      id: `evt-${crypto.randomBytes(6).toString('hex')}`,
      incidentId,
      timestamp: Date.now(),
      ...event
    };
    const list = this.incidentTimeline.get(incidentId) || [];
    list.push(newEvent);
    this.incidentTimeline.set(incidentId, list);
    return newEvent;
  }

  public getIncidentNotes(incidentId: string, orgId: string): IncidentNote[] {
    const inc = this.getIncident(incidentId, orgId);
    if (!inc) return [];
    return (this.incidentNotes.get(incidentId) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Queue only a narrow, reviewed mutation. This is the human approval boundary. */
  public approvePodImageReplacement(
    incidentId: string,
    orgId: string,
    approval: { container: string; expectedCurrentValue: string; proposedValue: string },
    user: { id: string; name: string }
  ): RemediationAction {
    const incident = this.getIncident(incidentId, orgId);
    if (!incident) throw new Error('Incident not found');
    if (incident.resourceKind !== 'Pod') throw new Error('Only Pod image replacement is supported');
    if (!approval.container || !approval.expectedCurrentValue || !approval.proposedValue) throw new Error('Container and both image values are required');
    if (approval.expectedCurrentValue === approval.proposedValue) throw new Error('Proposed image must differ from the current image');
    const observed = (incident.technicalDetails.containers || []).find(c => c.name === approval.container);
    if (!observed || observed.image !== approval.expectedCurrentValue) throw new Error('Expected current image does not match authoritative Agent telemetry');
    const now = Date.now();
    const action: RemediationAction = {
      id: `act-${crypto.randomBytes(12).toString('hex')}`,
      incidentId,
      clusterId: incident.clusterId,
      type: 'ReplacePodImage',
      target: { kind: 'Pod', namespace: incident.namespace, name: incident.resourceName, container: approval.container },
      fieldPath: `/spec/containers/${approval.container}/image`,
      expectedCurrentValue: approval.expectedCurrentValue,
      proposedValue: approval.proposedValue,
      approvingUserId: user.id,
      approvingUserName: user.name,
      approvedAt: now,
      status: 'PENDING'
    };
    this.remediationActions.set(action.id, action);
    incident.status = 'IN_PROGRESS';
    incident.updatedAt = now;

    // Keep any StructuredRemediation proposal in sync
    const rem = this.remediations.get(incidentId);
    if (rem) {
      rem.status = 'DISPATCHED';
      rem.updatedAt = now;
      rem.parameters.containerName = approval.container;
      rem.parameters.currentImage = approval.expectedCurrentValue;
      rem.parameters.proposedImage = approval.proposedValue;
      rem.approval = {
        approvedBy: { userId: user.id, name: user.name, email: '' },
        approvedAt: now
      };
      rem.execution = {
        dispatchedAt: now,
        status: 'PENDING',
        message: `Dispatched ReplacePodImage action to SkyOps Agent on cluster "${incident.clusterName}".`
      };
    }

    this.addTimelineEvent(incidentId, {
      type: 'REMEDIATION_APPROVED',
      actor: { type: 'USER', id: user.id, name: user.name },
      description: `Approved ReplacePodImage for ${incident.namespace}/${incident.resourceName}:${approval.container}`,
      metadata: { actionId: action.id, fieldPath: action.fieldPath, before: action.expectedCurrentValue, proposed: action.proposedValue }
    });
    this.saveSnapshot();
    return action;
  }

  public claimPendingRemediationActions(clusterId: string): RemediationAction[] {
    const CLAIM_RETRY_TIMEOUT_MS = 2 * 60 * 1000;
    const now = Date.now();
    const actions = [...this.remediationActions.values()].filter(
      (a) =>
        a.clusterId === clusterId &&
        (a.status === 'PENDING' || (a.status === 'DELIVERED' && (!a.deliveredAt || now - a.deliveredAt > CLAIM_RETRY_TIMEOUT_MS)))
    );
    for (const action of actions) {
      action.status = 'DELIVERED';
      action.deliveredAt = now;
    }
    if (actions.length) this.saveSnapshot();
    return actions;
  }

  public recordRemediationResult(
    clusterId: string,
    actionId: string,
    result: { success: boolean; message: string }
  ): RemediationAction | null {
    const action = this.remediationActions.get(actionId);
    if (!action || action.clusterId !== clusterId) return null;

    // Idempotent reporting: if already reported, return existing action
    if (action.status === 'SUCCEEDED' || action.status === 'FAILED') {
      return action;
    }

    if (action.status !== 'DELIVERED' && action.status !== 'PENDING') {
      return null;
    }

    const now = Date.now();
    action.status = result.success ? 'SUCCEEDED' : 'FAILED';
    action.completedAt = now;
    action.executionResult = result;

    const incident = this.incidents.get(action.incidentId);
    if (incident) {
      incident.updatedAt = now;
      this.addTimelineEvent(incident.id, {
        type: 'REMEDIATION_EXECUTED',
        actor: { type: 'AGENT', name: 'SkyOps Agent' },
        description: result.success
          ? 'Agent executed approved remediation; awaiting fresh telemetry verification'
          : `Agent rejected or failed remediation: ${result.message}`,
        metadata: { actionId, ...result }
      });
    }

    // Keep StructuredRemediation in sync
    const rem = this.remediations.get(action.incidentId);
    if (rem) {
      rem.updatedAt = now;
      if (result.success) {
        rem.status = 'EXECUTED';
        rem.execution = {
          dispatchedAt: action.approvedAt,
          executedAt: now,
          agentVersion: AGENT_VERSION,
          status: 'SUCCESS',
          message: result.message
        };
        rem.verification = {
          status: 'PENDING',
          checkCount: 0,
          observedState: 'Awaiting fresh telemetry from Kubernetes cluster'
        };
      } else {
        rem.status = 'FAILED';
        rem.execution = {
          dispatchedAt: action.approvedAt,
          executedAt: now,
          agentVersion: AGENT_VERSION,
          status: 'FAILED',
          message: result.message
        };
      }
    }

    this.saveSnapshot();
    return action;
  }

  public addIncidentNote(
    incidentId: string,
    orgId: string,
    author: { id: string; name: string; email: string },
    content: string
  ): IncidentNote | null {
    const inc = this.getIncident(incidentId, orgId);
    if (!inc) return null;

    const note: IncidentNote = {
      id: `note-${crypto.randomBytes(6).toString('hex')}`,
      incidentId,
      authorId: author.id,
      authorName: author.name,
      authorEmail: author.email,
      content: content.trim(),
      createdAt: Date.now()
    };

    const list = this.incidentNotes.get(incidentId) || [];
    list.push(note);
    this.incidentNotes.set(incidentId, list);

    this.addTimelineEvent(incidentId, {
      type: 'NOTE_ADDED',
      actor: { type: 'USER', id: author.id, name: author.name },
      description: `Added investigation note (${content.slice(0, 60)}${content.length > 60 ? '...' : ''})`
    });

    inc.updatedAt = Date.now();
    return note;
  }

  // --- Overview Metrics ---
  public getOverviewMetrics(orgId: string): OverviewMetrics {
    const clusters = this.getClusters(orgId);
    const incidents = Array.from(this.incidents.values()).filter((i) => i.orgId === orgId);

    const openIncidents = incidents.filter(
      (i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED'
    );

    const todayStart = new Date().setHours(0, 0, 0, 0);
    const resolvedToday = incidents.filter((i) => i.status === 'RESOLVED' && i.resolvedAt && i.resolvedAt >= todayStart);

    let totalNodes = 0;
    let totalPods = 0;
    let totalWorkloads = 0;
    let degradedWorkloads = 0;
    let crashingPods = 0;

    for (const cluster of clusters) {
      totalNodes += cluster.nodeCount || 0;
      totalPods += cluster.podCount || 0;
      const resList = this.resources.get(cluster.id) || [];
      for (const r of resList) {
        const k = (r.kind || '').toLowerCase();
        if (k === 'deployment' || k === 'statefulset' || k === 'daemonset' || k === 'job' || k === 'cronjob') {
          totalWorkloads++;
          if (r.health === 'CRITICAL' || r.health === 'WARNING') {
            degradedWorkloads++;
          }
        }
        if (k === 'pod') {
          if (
            r.health === 'CRITICAL' ||
            r.status === 'CrashLoopBackOff' ||
            r.status === 'ImagePullBackOff' ||
            r.status === 'ErrImagePull' ||
            r.status === 'OOMKilled' ||
            r.status === 'Failed'
          ) {
            crashingPods++;
          }
        }
      }
    }

    const connectedAgents = clusters.filter((c) => c.agentStatus === 'CONNECTED').length;
    const offlineAgents = clusters.filter((c) => c.agentStatus === 'OFFLINE' || c.status === 'AGENT_OFFLINE').length;

    return {
      totalClusters: clusters.length,
      healthyClusters: clusters.filter((c) => c.status === 'HEALTHY').length,
      warningClusters: clusters.filter((c) => c.status === 'WARNING').length,
      criticalClusters: clusters.filter((c) => c.status === 'CRITICAL').length,
      offlineClusters: clusters.filter((c) => c.status === 'AGENT_OFFLINE').length,
      openIncidents: openIncidents.length,
      criticalIncidents: openIncidents.filter((i) => i.severity === 'CRITICAL').length,
      highIncidents: openIncidents.filter((i) => i.severity === 'HIGH').length,
      mediumIncidents: openIncidents.filter((i) => i.severity === 'MEDIUM').length,
      lowIncidents: openIncidents.filter((i) => i.severity === 'LOW' || i.severity === 'INFO').length,
      resolvedTodayCount: resolvedToday.length,
      totalNodes,
      totalPods,
      totalWorkloads,
      degradedWorkloads,
      crashingPods,
      connectedAgents,
      offlineAgents
    };
  }

  public getRecentActivity(orgId: string, limit = 15): Array<{
    id: string;
    type: string;
    timestamp: number;
    title: string;
    description: string;
    incidentId?: string;
    clusterId?: string;
  }> {
    const activity: Array<{
      id: string;
      type: string;
      timestamp: number;
      title: string;
      description: string;
      incidentId?: string;
      clusterId?: string;
    }> = [];

    const orgIncidents = Array.from(this.incidents.values()).filter((i) => i.orgId === orgId);

    for (const inc of orgIncidents) {
      const timeline = this.incidentTimeline.get(inc.id) || [];
      for (const evt of timeline) {
        activity.push({
          id: evt.id,
          type: evt.type,
          timestamp: evt.timestamp,
          title: `${inc.id}: ${evt.type}`,
          description: evt.description,
          incidentId: inc.id,
          clusterId: inc.clusterId
        });
      }
    }

    return activity.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
  }

  // --- Development & QA Scenario Simulation ---
  public simulateScenario(
    orgId: string,
    clusterId: string,
    scenario:
      | 'CrashLoopBackOff'
      | 'ImagePullBackOff'
      | 'OOMKilled'
      | 'NodeNotReady'
      | 'DeploymentDegraded'
      | 'PVCPending'
      | 'RecoverAll'
  ): { success: boolean; message: string; incidentId?: string } {
    const cluster = this.getCluster(clusterId, orgId);
    if (!cluster) return { success: false, message: 'Cluster not found' };

    // Ensure cluster is connected
    this.recordAgentHeartbeat(clusterId, AGENT_VERSION, cluster.k8sVersion || 'v1.35.1', cluster.nodeCount || 2, cluster.podCount || 10);

    let resources = this.resources.get(clusterId) || [];

    if (scenario === 'RecoverAll') {
      // Revert all resources to healthy
      resources = resources.map((r) => {
        if (r.kind === 'Pod') {
          return {
            ...r,
            status: 'Running',
            containers: r.containers?.map((c) => ({
              ...c,
              ready: true,
              state: 'running',
              waitingReason: undefined,
              waitingMessage: undefined,
              restartCount: c.restartCount
            }))
          };
        }
        if (r.kind === 'Node') {
          return {
            ...r,
            conditions: r.conditions?.map((c) =>
              c.type === 'Ready' ? { ...c, status: 'True', reason: 'KubeletReady', message: 'kubelet is posting ready status' } : c
            )
          };
        }
        if (r.kind === 'Deployment') {
          const desired = Number(r.specSummary?.replicas || 3);
          return {
            ...r,
            statusSummary: { availableReplicas: desired, readyReplicas: desired, updatedReplicas: desired }
          };
        }
        if (r.kind === 'PersistentVolumeClaim' || r.kind === 'PVC') {
          return { ...r, status: 'Bound' };
        }
        return r;
      });

      this.syncClusterResources(clusterId, resources);
      return { success: true, message: 'Simulated recovery applied across all cluster resources.' };
    }

    if (scenario === 'CrashLoopBackOff') {
      const podName = 'skyops-api-gateway-7f89d4b6-kx92z';
      const failingPod: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'Pod',
        namespace: 'production',
        name: podName,
        status: 'Running',
        health: 'CRITICAL',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now(),
        specSummary: { nodeName: 'k8s-node-worker-02', restartPolicy: 'Always' },
        statusSummary: { phase: 'Running', podIP: '10.244.2.89' },
        containers: [
          {
            name: 'api-server',
            image: 'registry.acme.corp/skyops/api:v2.8.1',
            restartCount: 7,
            ready: false,
            state: 'waiting',
            waitingReason: 'CrashLoopBackOff',
            waitingMessage: 'back-off 5m0s restarting failed container=api-server pod=skyops-api-gateway-7f89d4b6-kx92z',
            exitCode: 1
          }
        ],
        conditions: [
          { type: 'Initialized', status: 'True' },
          { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
          { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady' },
          { type: 'PodScheduled', status: 'True' }
        ],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 120000,
            type: 'Warning',
            reason: 'BackOff',
            objectKind: 'Pod',
            objectName: podName,
            namespace: 'production',
            message: 'Back-off restarting failed container api-server in pod skyops-api-gateway-7f89d4b6-kx92z'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === podName && r.namespace === 'production');
      if (existingIndex >= 0) resources[existingIndex] = failingPod;
      else resources.push(failingPod);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingPod);
      return { success: true, message: 'Injected CrashLoopBackOff on Pod skyops-api-gateway', incidentId: inc?.id };
    }

    if (scenario === 'ImagePullBackOff') {
      const podName = 'auth-service-v3-84f9cc964-m7x8q';
      const failingPod: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'Pod',
        namespace: 'auth-layer',
        name: podName,
        status: 'Pending',
        health: 'CRITICAL',
        createdAt: Date.now() - 1800000,
        updatedAt: Date.now(),
        specSummary: { nodeName: 'k8s-node-worker-01' },
        statusSummary: { phase: 'Pending', podIP: '10.244.1.45' },
        containers: [
          {
            name: 'auth-daemon',
            image: 'registry.acme.corp/auth/service:v3.9.0-rc.2',
            restartCount: 0,
            ready: false,
            state: 'waiting',
            waitingReason: 'ImagePullBackOff',
            waitingMessage: 'Back-off pulling image "registry.acme.corp/auth/service:v3.9.0-rc.2": ErrImagePull: manifest unknown'
          }
        ],
        conditions: [
          { type: 'Initialized', status: 'True' },
          { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
          { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady' }
        ],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 60000,
            type: 'Warning',
            reason: 'Failed',
            objectKind: 'Pod',
            objectName: podName,
            namespace: 'auth-layer',
            message: 'Failed to pull image "registry.acme.corp/auth/service:v3.9.0-rc.2": rpc error: code = NotFound desc = failed to pull and unpack image'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === podName && r.namespace === 'auth-layer');
      if (existingIndex >= 0) resources[existingIndex] = failingPod;
      else resources.push(failingPod);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingPod);
      return { success: true, message: 'Injected ImagePullBackOff on Pod auth-service-v3', incidentId: inc?.id };
    }

    if (scenario === 'OOMKilled') {
      const podName = 'data-pipeline-worker-5bc674d-90plk';
      const failingPod: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'Pod',
        namespace: 'data-processing',
        name: podName,
        status: 'Running',
        health: 'CRITICAL',
        createdAt: Date.now() - 2400000,
        updatedAt: Date.now(),
        specSummary: { nodeName: 'k8s-node-worker-03' },
        statusSummary: { phase: 'Running', podIP: '10.244.3.12' },
        containers: [
          {
            name: 'etl-transformer',
            image: 'registry.acme.corp/pipeline/transformer:v1.14',
            restartCount: 4,
            ready: false,
            state: 'terminated',
            terminationReason: 'OOMKilled',
            exitCode: 137,
            waitingReason: 'CrashLoopBackOff',
            waitingMessage: 'Container etl-transformer was killed by Linux Out-Of-Memory killer (memory limit: 2048Mi exceeded)'
          }
        ],
        conditions: [{ type: 'Ready', status: 'False', reason: 'ContainersNotReady' }],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 30000,
            type: 'Warning',
            reason: 'OOMKilled',
            objectKind: 'Pod',
            objectName: podName,
            namespace: 'data-processing',
            message: 'Container etl-transformer in pod data-pipeline-worker-5bc674d-90plk exceeded memory limits and was OOMKilled.'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === podName && r.namespace === 'data-processing');
      if (existingIndex >= 0) resources[existingIndex] = failingPod;
      else resources.push(failingPod);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingPod);
      return { success: true, message: 'Injected OOMKilled condition on Pod data-pipeline-worker', incidentId: inc?.id };
    }

    if (scenario === 'NodeNotReady') {
      const nodeName = 'k8s-node-worker-02';
      const failingNode: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'Node',
        namespace: '',
        name: nodeName,
        status: 'NotReady',
        health: 'CRITICAL',
        createdAt: Date.now() - 86400000 * 7,
        updatedAt: Date.now(),
        specSummary: { osImage: 'Ubuntu 22.04.4 LTS', kernelVersion: '5.15.0-105-generic', kubeletVersion: 'v1.35.1' },
        statusSummary: { capacityCpu: '16', capacityMemory: '64Gi', allocatableCpu: '15.6', allocatableMemory: '60Gi' },
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            reason: 'KubeletNotReady',
            message: 'runtime network not ready: NetworkReady=false reason:NetworkPluginNotReady message:docker: network plugin is not ready: cni plugin not initialized'
          },
          { type: 'MemoryPressure', status: 'False' },
          { type: 'DiskPressure', status: 'False' },
          { type: 'PIDPressure', status: 'False' }
        ],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 180000,
            type: 'Warning',
            reason: 'NodeNotReady',
            objectKind: 'Node',
            objectName: nodeName,
            namespace: '',
            message: 'Node k8s-node-worker-02 status is now: NodeNotReady'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === nodeName && r.kind === 'Node');
      if (existingIndex >= 0) resources[existingIndex] = failingNode;
      else resources.push(failingNode);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingNode);
      return { success: true, message: 'Injected Node NotReady condition on k8s-node-worker-02', incidentId: inc?.id };
    }

    if (scenario === 'DeploymentDegraded') {
      const depName = 'order-processing-service';
      const failingDep: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'Deployment',
        namespace: 'checkout-prod',
        name: depName,
        status: 'Degraded',
        health: 'CRITICAL',
        createdAt: Date.now() - 86400000 * 3,
        updatedAt: Date.now(),
        specSummary: { replicas: 5, strategy: 'RollingUpdate' },
        statusSummary: { replicas: 5, updatedReplicas: 2, readyReplicas: 0, availableReplicas: 0, unavailableReplicas: 5 },
        conditions: [
          { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable', message: 'Deployment has minimum availability violations' },
          { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'ReplicaSet "order-processing-service-89f4b" has timed out progressing.' }
        ],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 90000,
            type: 'Warning',
            reason: 'FailedCreate',
            objectKind: 'Deployment',
            objectName: depName,
            namespace: 'checkout-prod',
            message: 'Deployment does not have minimum availability (0/5 replicas available).'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === depName && r.kind === 'Deployment');
      if (existingIndex >= 0) resources[existingIndex] = failingDep;
      else resources.push(failingDep);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingDep);
      return { success: true, message: 'Injected Deployment Degraded on order-processing-service (0/5 replicas)', incidentId: inc?.id };
    }

    if (scenario === 'PVCPending') {
      const pvcName = 'postgres-data-vol-claim';
      const failingPvc: KubernetesResource = {
        id: `res-${crypto.randomBytes(4).toString('hex')}`,
        clusterId,
        kind: 'PersistentVolumeClaim',
        namespace: 'database',
        name: pvcName,
        status: 'Pending',
        health: 'WARNING',
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now(),
        specSummary: { storageClassName: 'ssd-premium-replicated', capacity: '250Gi', accessModes: ['ReadWriteOnce'] },
        statusSummary: { phase: 'Pending' },
        conditions: [],
        events: [
          {
            id: `evt-${crypto.randomBytes(4).toString('hex')}`,
            timestamp: Date.now() - 600000,
            type: 'Warning',
            reason: 'ProvisioningFailed',
            objectKind: 'PersistentVolumeClaim',
            objectName: pvcName,
            namespace: 'database',
            message: 'storageclass.storage.k8s.io "ssd-premium-replicated" not found: failed to provision volume'
          }
        ]
      };

      const existingIndex = resources.findIndex((r) => r.name === pvcName && (r.kind === 'PersistentVolumeClaim' || r.kind === 'PVC'));
      if (existingIndex >= 0) resources[existingIndex] = failingPvc;
      else resources.push(failingPvc);

      this.syncClusterResources(clusterId, resources);
      const inc = this.evaluateResourceObservation(orgId, clusterId, cluster.name, failingPvc);
      return { success: true, message: 'Injected PVC Pending condition on postgres-data-vol-claim', incidentId: inc?.id };
    }

    return { success: false, message: 'Unknown scenario' };
  }
}

export const store = new DataStore();
