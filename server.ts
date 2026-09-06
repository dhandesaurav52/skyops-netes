import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import {
  AuthenticatedAgentRequest,
  AuthenticatedUserRequest,
  requireAgentAuth,
  requireOrgMembership,
  requireRole,
  requireUserAuth
} from './server/auth';
import {
  generateHelmCommand,
  generateInstallScript,
  generateKubernetesManifest,
  generateOneCommandInstall
} from './server/manifestGenerator';
import { normalizeTelemetry } from './server/normalization';
import { store } from './server/store';
import { skyOpsAIService } from './server/ai/service';
import { SkyOpsIntelligenceEngine } from './server/engine/intelligence';
import { AGENT_DEFAULT_NAMESPACE, AGENT_VERSION } from './src/config/version';
import { KubernetesResource } from './src/types/index';

dotenv.config();

const app = express();
const PORT = 3000;

// Security & Parsing Middlewares
app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id']
  })
);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// --- Structured Request Logging ---
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api/')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

// Helper to resolve public API / SaaS endpoint URL for remote Kubernetes agents
function getPublicServerUrl(req?: Request): string {
  if (
    process.env.SKYOPS_SERVER_URL &&
    process.env.SKYOPS_SERVER_URL.startsWith('http') &&
    !process.env.SKYOPS_SERVER_URL.includes('localhost')
  ) {
    return process.env.SKYOPS_SERVER_URL.replace(/\/+$/, '');
  }
  if (
    process.env.SKYOPS_API_URL &&
    process.env.SKYOPS_API_URL.startsWith('http') &&
    !process.env.SKYOPS_API_URL.includes('localhost') &&
    process.env.SKYOPS_API_URL !== 'https://skyops.ai.studio'
  ) {
    return process.env.SKYOPS_API_URL.replace(/\/+$/, '');
  }
  if (process.env.APP_URL && process.env.APP_URL.startsWith('http') && !process.env.APP_URL.includes('localhost')) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  if (req) {
    const forwardedHost = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string);
    const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    if (forwardedHost && !forwardedHost.includes('localhost')) {
      return `${forwardedProto}://${forwardedHost}`.replace(/\/+$/, '');
    }
  }
  return process.env.APP_URL || 'https://ais-dev-ippvl3vbmeyhxnyp4m36nk-811563557432.asia-southeast1.run.app';
}

// ==========================================
// API ROUTES (/api/v1/...)
// ==========================================

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SkyOps Central Ingestion API',
    version: AGENT_VERSION,
    timestamp: Date.now()
  });
});

// --- Auth & Session ---
app.post('/api/v1/auth/session', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const user = req.user!;
  const orgs = store.getOrganizationsForUser(user.id);
  const currentOrg = orgs.find((o) => o.id === req.orgId) || orgs[0];
  const members = currentOrg ? store.getOrgMembers(currentOrg.id) : [];

  res.json({
    user,
    currentOrg,
    organizations: orgs,
    role: req.userRole || 'OWNER',
    members
  });
});

app.get('/api/v1/auth/me', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const user = req.user!;
  const orgs = store.getOrganizationsForUser(user.id);
  const currentOrg = orgs.find((o) => o.id === req.orgId) || orgs[0];

  res.json({
    user,
    currentOrg,
    role: req.userRole || 'OWNER'
  });
});

// --- Organizations ---
app.get('/api/v1/orgs', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const orgs = store.getOrganizationsForUser(req.user!.id);
  res.json({ organizations: orgs });
});

const CreateOrgSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(60)
});

app.post('/api/v1/orgs', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const parsed = CreateOrgSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid organization payload' });
  }

  const org = store.createOrganization(parsed.data.name.trim(), req.user!.id);
  res.status(201).json({ organization: org });
});

app.get('/api/v1/orgs/members', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const members = store.getOrgMembers(req.orgId!);
  res.json({ members });
});

// --- Clusters ---
app.get('/api/v1/clusters', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const clusters = store.getClusters(req.orgId!);
  res.json({ clusters });
});

const CreateClusterSchema = z.object({
  name: z.string().min(2, 'Cluster name must be at least 2 characters').max(60),
  description: z.string().max(300).optional()
});

app.post('/api/v1/clusters', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const parsed = CreateClusterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid cluster payload' });
  }

  const { cluster, rawToken, connectionCode, installKey } = store.createCluster(
    req.orgId!,
    parsed.data.name.trim(),
    parsed.data.description
  );
  res.status(201).json({ cluster, token: rawToken, connectionCode, installKey });
});

app.get('/api/v1/clusters/:id', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const cluster = store.getCluster(req.params.id, req.orgId!);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }
  res.json({ cluster });
});

// Connect cluster using connection code handshake (single-use pairing key)
const ConnectClusterSchema = z.object({
  connectionCode: z.string().min(4, 'Connection code is required')
});

app.post('/api/v1/clusters/:id/connect', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const parsed = ConnectClusterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid connection code' });
  }

  try {
    const updated = store.verifyClusterConnection(req.params.id, req.orgId!, parsed.data.connectionCode);
    res.json({ success: true, cluster: updated });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to verify connection code' });
  }
});

// Regenerate credentials for cluster
app.post(
  '/api/v1/clusters/:id/regenerate-token',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const { cluster, rawToken, connectionCode, installKey } = store.regenerateClusterCredentials(req.params.id, req.orgId!);
      res.json({ success: true, cluster, token: rawToken, connectionCode, installKey });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Cluster not found' });
    }
  }
);

// Disconnect agent from cluster
app.post(
  '/api/v1/clusters/:id/disconnect',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const success = store.disconnectCluster(req.params.id, req.orgId!);
    if (!success) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    res.json({ success: true, message: 'Cluster agent disconnected successfully' });
  }
);

app.delete(
  '/api/v1/clusters/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const deleted = store.deleteCluster(req.params.id, req.orgId!);
    if (!deleted) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    res.json({ success: true, message: 'Cluster and associated telemetry deleted' });
  }
);

// Get manifests for cluster
app.get('/api/v1/clusters/:id/manifests', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const cluster = store.getCluster(req.params.id, req.orgId!, true);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const serverUrl = getPublicServerUrl(req);
  const token = cluster.agentToken || 'sky_agent_configured_token';

  const manifest = generateKubernetesManifest({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl
  });

  const helmCommand = generateHelmCommand({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl
  });

  const installKeyParam = cluster.installKey ? `?key=${cluster.installKey}` : '';
  const oneCommandInstall = cluster.installKey
    ? generateOneCommandInstall(serverUrl, cluster.installKey)
    : `curl -fsSL "${serverUrl}/api/v1/clusters/${cluster.id}/install.sh" | bash`;
  const installCommand = cluster.installKey
    ? `kubectl apply -f "${serverUrl}/api/v1/install/${cluster.installKey}/manifest.yaml"`
    : `kubectl apply -f "${serverUrl}/api/v1/clusters/${cluster.id}/manifest.yaml"`;
  const manifestDownloadUrl = cluster.installKey
    ? `${serverUrl}/api/v1/install/${cluster.installKey}/manifest.yaml`
    : `${serverUrl}/api/v1/clusters/${cluster.id}/manifest.yaml${installKeyParam}`;

  res.json({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    connectionCode: cluster.connectionCode,
    installKey: cluster.installKey,
    serverUrl,
    agentVersion: AGENT_VERSION,
    namespace: AGENT_DEFAULT_NAMESPACE,
    kubectlManifest: manifest,
    oneCommandInstall,
    helmCommand,
    installCommand,
    manifestDownloadUrl
  });
});

// Single-command bash installer endpoint:
// curl -fsSL "https://<SKYOPS-HOST>/api/v1/install/<SESSION_KEY>" | bash
const handleScriptInstall = (req: Request, res: Response) => {
  const { sessionKey } = req.params;
  const cluster = store.getClusterByInstallKey(sessionKey);
  if (!cluster) {
    return res
      .status(404)
      .type('text/plain')
      .send('# Error 404: Invalid or expired SkyOps installation session.\n# Please generate a new connection command from the SkyOps Dashboard.\n');
  }

  if (cluster.installKeyExpiresAt && Date.now() > cluster.installKeyExpiresAt) {
    return res
      .status(403)
      .type('text/plain')
      .send('# Error 403: SkyOps installation session has expired (valid for 60 minutes).\n# Please generate a new connection command from the SkyOps Dashboard.\n');
  }

  const serverUrl = getPublicServerUrl(req);
  const token = cluster.agentToken || 'sky_agent_configured_token';

  const script = generateInstallScript({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl,
    installKey: cluster.installKey
  });

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="skyops-install-${cluster.id}.sh"`);
  res.status(200).send(script);
};

// Raw YAML manifest endpoint for:
// kubectl apply -f "https://<SKYOPS-HOST>/api/v1/install/<SESSION_KEY>/manifest.yaml"
const handleManifestBySession = (req: Request, res: Response) => {
  const { sessionKey } = req.params;
  const cluster = store.getClusterByInstallKey(sessionKey);
  if (!cluster) {
    return res
      .status(404)
      .type('text/plain')
      .send('# Error 404: Invalid or expired SkyOps installation session.\n# Please generate a new connection command from the SkyOps Dashboard.\n');
  }

  if (cluster.installKeyExpiresAt && Date.now() > cluster.installKeyExpiresAt) {
    return res
      .status(403)
      .type('text/plain')
      .send('# Error 403: SkyOps installation session has expired (valid for 60 minutes).\n# Please generate a new connection command from the SkyOps Dashboard.\n');
  }

  const serverUrl = getPublicServerUrl(req);
  const token = cluster.agentToken || 'sky_agent_configured_token';

  const manifest = generateKubernetesManifest({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl
  });

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="skyops-agent-${cluster.id}.yaml"`);
  res.status(200).send(manifest);
};

app.get('/api/v1/install/:sessionKey', handleScriptInstall);
app.get('/api/v1/install/:sessionKey/install.sh', handleScriptInstall);
app.get('/api/v1/install/:sessionKey/manifest.yaml', handleManifestBySession);

// Cluster-specific direct installer script handler
app.get('/api/v1/clusters/:id/install.sh', (req: Request, res: Response) => {
  const { id } = req.params;
  const providedKey = (req.query.key as string) || (req.query.installToken as string) || (req.query.token as string);
  const authHeader = req.headers.authorization;

  const cluster = store.getClusterByIdInternal(id);
  if (!cluster) {
    return res.status(404).type('text/plain').send('# Error 404: Kubernetes cluster not found in SkyOps\n');
  }

  let isAuthorized = false;
  if (providedKey && cluster.installKey && cluster.installKey === providedKey) {
    if (!cluster.installKeyExpiresAt || Date.now() <= cluster.installKeyExpiresAt) {
      isAuthorized = true;
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    const verified = store.authenticateAgentToken(bearer);
    if (verified && verified.clusterId === id) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return res
      .status(403)
      .type('text/plain')
      .send(
        '# Error 403 Forbidden: Invalid, missing, or expired installation key.\n# Please generate a new install command from the SkyOps Dashboard.\n'
      );
  }

  const serverUrl = getPublicServerUrl(req);
  const token = cluster.agentToken || 'sky_agent_configured_token';

  const script = generateInstallScript({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl,
    installKey: cluster.installKey
  });

  res.setHeader('Content-Type', 'text/x-shellscript; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="skyops-install-${cluster.id}.sh"`);
  res.status(200).send(script);
});

// Direct raw YAML manifest stream for direct kubectl apply
const handleManifestDownload = (req: Request, res: Response) => {
  const { id } = req.params;
  const providedKey = (req.query.key as string) || (req.query.installToken as string) || (req.query.token as string);
  const authHeader = req.headers.authorization;

  const cluster = store.getClusterByIdInternal(id);
  if (!cluster) {
    return res.status(404).type('text/plain').send('# Error 404: Kubernetes cluster not found in SkyOps\n');
  }

  // Security Verification:
  // 1. Verify if request provides a valid, unexpired short-lived installation key
  // 2. OR verify if request provides valid Agent Bearer Token
  let isAuthorized = false;

  if (providedKey && cluster.installKey && cluster.installKey === providedKey) {
    if (!cluster.installKeyExpiresAt || Date.now() <= cluster.installKeyExpiresAt) {
      isAuthorized = true;
    }
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.substring(7).trim();
    const verified = store.authenticateAgentToken(bearer);
    if (verified && verified.clusterId === id) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    return res
      .status(403)
      .type('text/plain')
      .send(
        '# Error 403 Forbidden: Invalid, missing, or expired manifest installation key.\n# Please generate a new install command from the SkyOps Dashboard.\n'
      );
  }

  const serverUrl = getPublicServerUrl(req);
  const token = cluster.agentToken || 'sky_agent_configured_token';

  const manifest = generateKubernetesManifest({
    clusterId: cluster.id,
    clusterName: cluster.name,
    token,
    serverUrl
  });

  res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
  res.setHeader('Content-Disposition', `inline; filename="skyops-agent-${cluster.id}.yaml"`);
  res.status(200).send(manifest);
};

app.get('/api/v1/clusters/:id/manifest.yaml', handleManifestDownload);
app.get('/api/v1/clusters/:id/manifests/download', handleManifestDownload);

app.get('/api/v1/clusters/:id/resources', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const resources = store.getClusterResources(req.params.id, req.orgId!);
  res.json({ resources });
});

// --- Observability & Metrics Foundation Endpoints ---
app.get('/api/v1/clusters/:id/metrics', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const metrics = store.getClusterObservabilityMetrics(req.params.id, req.orgId!);
  if (!metrics) {
    return res.status(404).json({ error: 'Cluster not found or metrics unavailable' });
  }
  res.json({ metrics });
});

app.get('/api/v1/clusters/:id/metrics/nodes', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const nodes = store.getNodeMetrics(req.params.id, req.orgId!);
  res.json({ nodes });
});

app.get('/api/v1/clusters/:id/metrics/workloads', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const workloads = store.getWorkloadMetrics(req.params.id, req.orgId!);
  res.json({ workloads });
});

app.get('/api/v1/clusters/:id/metrics/history', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const history = store.getClusterMetricHistory(req.params.id, req.orgId!);
  res.json({ history });
});

app.get('/api/v1/resources', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const { clusterId, kind, namespace, health, search } = req.query as Record<string, string | undefined>;
  let resources = store.getAllResources(req.orgId!);

  if (clusterId) {
    resources = resources.filter((r) => r.clusterId === clusterId);
  }
  if (kind) {
    const kinds = kind.split(',').map((k) => k.trim().toLowerCase());
    resources = resources.filter((r) => kinds.includes(r.kind.toLowerCase()));
  }
  if (namespace) {
    resources = resources.filter((r) => (r.namespace || 'default').toLowerCase() === namespace.toLowerCase());
  }
  if (health) {
    resources = resources.filter((r) => r.health.toLowerCase() === health.toLowerCase());
  }
  if (search) {
    const q = search.toLowerCase();
    resources = resources.filter(
      (r) => r.name.toLowerCase().includes(q) || (r.namespace && r.namespace.toLowerCase().includes(q))
    );
  }

  res.json({ resources });
});

// --- Agent Ingestion Endpoints (Separately Authenticated via requireAgentAuth) ---
app.post('/api/v1/agent/register', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const { agentVersion, k8sVersion } = req.body;
  try {
    const result = store.registerAgent(req.clusterId!, agentVersion, k8sVersion);
    const cluster = store.getClusterByIdInternal(req.clusterId!);
    console.log(
      `[AGENT_REGISTER] clusterId=${req.clusterId} agentVersion=${cluster?.agentVersion || agentVersion} k8sVersion=${cluster?.k8sVersion || k8sVersion || 'unknown'} timestamp=${Date.now()}`
    );
    res.json(result);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Cluster registration failed' });
  }
});

app.post('/api/v1/agent/heartbeat', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const { agentVersion, k8sVersion, nodeCount, podCount } = req.body;
  const recorded = store.recordAgentHeartbeat(
    req.clusterId!,
    agentVersion || AGENT_VERSION,
    k8sVersion,
    nodeCount,
    podCount
  );

  if (!recorded) {
    return res.status(404).json({ error: 'Cluster associated with agent token not found' });
  }

  const cluster = store.getClusterByIdInternal(req.clusterId!);
  console.log(
    `[AGENT_HEARTBEAT] clusterId=${req.clusterId} agentVersion=${cluster?.agentVersion} nodes=${cluster?.nodeCount ?? 0} pods=${cluster?.podCount ?? 0} k8sVersion=${cluster?.k8sVersion ?? 'unknown'} timestamp=${Date.now()}`
  );

  res.json({
    status: 'ACK',
    clusterId: req.clusterId,
    timestamp: Date.now(),
    nextHeartbeatSeconds: 30
  });
});

app.post('/api/v1/agent/telemetry', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const { items, resources, rawK8sList, rawK8s } = req.body;
  let extractedResources: KubernetesResource[] = [];

  // Helper to map raw K8s resource object to SkyOps KubernetesResource
  const mapRawK8sItem = (item: any): KubernetesResource | null => {
    if (!item || !item.kind) return null;
    const kind = item.kind;
    const name = item.metadata?.name || item.name || 'unnamed';
    const namespace = item.metadata?.namespace || item.namespace || '';
    const createdTs = item.metadata?.creationTimestamp ? Date.parse(item.metadata.creationTimestamp) : Date.now();
    const clusterId = req.clusterId!;
    const id = item.metadata?.uid || `${clusterId}-${kind}-${namespace}-${name}`;

    let status = 'Active';
    let health: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    let conditions: any[] | undefined = undefined;
    let containers: any[] | undefined = undefined;

    if (Array.isArray(item.status?.conditions)) {
      conditions = item.status.conditions.map((c: any) => ({
        type: String(c.type || ''),
        status: String(c.status || ''),
        reason: c.reason ? String(c.reason) : undefined,
        message: c.message ? String(c.message) : undefined,
        lastTransitionTime: c.lastTransitionTime ? String(c.lastTransitionTime) : undefined
      }));
    }

    if (kind === 'Node') {
      const readyCond = conditions?.find((c) => c.type === 'Ready');
      status = readyCond?.status === 'True' ? 'Ready' : 'NotReady';
      health = status === 'Ready' ? 'HEALTHY' : 'CRITICAL';
    } else if (kind === 'Pod') {
      const rawContainers = [
        ...(Array.isArray(item.status?.initContainerStatuses) ? item.status.initContainerStatuses : []),
        ...(Array.isArray(item.status?.containerStatuses) ? item.status.containerStatuses : [])
      ];

      containers = rawContainers.map((cs: any) => {
        let state = 'running';
        let waitingReason: string | undefined;
        let waitingMessage: string | undefined;
        let terminationReason: string | undefined;
        let exitCode: number | undefined;

        if (cs.state?.waiting) {
          state = 'waiting';
          waitingReason = cs.state.waiting.reason;
          waitingMessage = cs.state.waiting.message;
        } else if (cs.state?.terminated) {
          state = 'terminated';
          terminationReason = cs.state.terminated.reason;
          exitCode = cs.state.terminated.exitCode;
          waitingMessage = cs.state.terminated.message;
        } else if (cs.state?.running) {
          state = 'running';
        }

        if (!waitingReason && cs.lastState?.terminated) {
          terminationReason = terminationReason || cs.lastState.terminated.reason;
          if (exitCode === undefined) exitCode = cs.lastState.terminated.exitCode;
        }

        return {
          name: String(cs.name || 'main'),
          image: String(cs.image || item.spec?.containers?.find((c: any) => c.name === cs.name)?.image || ''),
          restartCount: Number(cs.restartCount || 0),
          ready: Boolean(cs.ready),
          state,
          waitingReason,
          waitingMessage,
          terminationReason,
          exitCode
        };
      });

      // Calculate displayed Pod status exactly like kubectl
      let podStatus = item.status?.phase || 'Running';
      let hasError = false;

      for (const c of containers) {
        if (c.waitingReason) {
          podStatus = c.waitingReason;
          hasError = true;
          break;
        }
        if (c.terminationReason && c.terminationReason !== 'Completed') {
          podStatus = c.terminationReason;
          hasError = true;
          break;
        }
        if (c.exitCode !== undefined && c.exitCode !== 0) {
          podStatus = 'Error';
          hasError = true;
          break;
        }
      }

      status = podStatus;
      if (!hasError && (podStatus === 'Running' || podStatus === 'Succeeded')) {
        health = 'HEALTHY';
      } else if (podStatus === 'Pending' || podStatus === 'ContainerCreating') {
        health = 'WARNING';
      } else {
        health = 'CRITICAL';
      }
    } else if (kind === 'Deployment') {
      const desired = Number(item.spec?.replicas ?? 1);
      const ready = Number(item.status?.readyReplicas ?? item.status?.availableReplicas ?? 0);
      const available = Number(item.status?.availableReplicas ?? item.status?.readyReplicas ?? 0);
      status = ready >= desired || available >= desired ? 'Available' : 'Progressing';
      health = ready >= desired || available >= desired ? 'HEALTHY' : ready === 0 && available === 0 ? 'CRITICAL' : 'WARNING';
    } else if (kind === 'DaemonSet') {
      const desired = Number(item.status?.desiredNumberScheduled ?? 1);
      const ready = Number(item.status?.numberReady ?? 0);
      status = ready >= desired ? 'Ready' : 'Progressing';
      health = ready >= desired ? 'HEALTHY' : 'WARNING';
    } else if (kind === 'StatefulSet') {
      const desired = Number(item.spec?.replicas ?? 1);
      const ready = Number(item.status?.readyReplicas ?? 0);
      status = ready >= desired ? 'Ready' : 'Progressing';
      health = ready >= desired ? 'HEALTHY' : 'WARNING';
    } else if (kind === 'PersistentVolumeClaim') {
      status = item.status?.phase || 'Bound';
      health = status === 'Bound' ? 'HEALTHY' : 'WARNING';
    } else if (kind === 'Event') {
      status = item.type || 'Normal';
      health = item.type === 'Warning' ? 'WARNING' : 'HEALTHY';
    }

    return {
      id,
      clusterId,
      kind,
      name,
      namespace,
      status,
      health,
      createdAt: isNaN(createdTs) ? Date.now() : createdTs,
      updatedAt: Date.now(),
      specSummary: item.spec || { message: item.message, reason: item.reason },
      statusSummary: item.status || { source: item.source?.component },
      conditions,
      containers
    };
  };

  if (Array.isArray(resources)) {
    extractedResources = resources as KubernetesResource[];
  } else if (rawK8sList && Array.isArray(rawK8sList.items)) {
    for (const rawItem of rawK8sList.items) {
      const mapped = mapRawK8sItem(rawItem);
      if (mapped) extractedResources.push(mapped);
    }
  } else if (req.body && req.body.kind === 'List' && Array.isArray(req.body.items)) {
    for (const rawItem of req.body.items) {
      const mapped = mapRawK8sItem(rawItem);
      if (mapped) extractedResources.push(mapped);
    }
  } else if (rawK8s && typeof rawK8s === 'object') {
    for (const key of Object.keys(rawK8s)) {
      const sub = rawK8s[key];
      if (sub && Array.isArray(sub.items)) {
        for (const rawItem of sub.items) {
          const mapped = mapRawK8sItem(rawItem);
          if (mapped) extractedResources.push(mapped);
        }
      }
    }
  } else if (Array.isArray(items)) {
    for (const item of items) {
      if (item.payload && item.payload.kind && item.payload.name) {
        extractedResources.push(item.payload as KubernetesResource);
      } else if (item.kind && item.metadata) {
        const mapped = mapRawK8sItem(item);
        if (mapped) extractedResources.push(mapped);
      }
    }
  }

  // The authenticated token, never a client-provided clusterId, defines resource ownership.
  const normalized = normalizeTelemetry(req.body, req.clusterId!);
  if (normalized === null) return res.status(400).json({ error: 'Telemetry must contain resources or items arrays' });
  extractedResources = normalized;
  // Only a collector that explicitly confirms a complete snapshot may cause
  // deletion reconciliation. Older agents retain backwards-compatible updates.
  store.syncClusterResources(req.clusterId!, extractedResources, req.body?.snapshotComplete === true);

  const cluster = store.getClusterByIdInternal(req.clusterId!);
  console.log(
    `[TELEMETRY_INGESTION] clusterId=${req.clusterId} observations=${extractedResources.length} nodes=${cluster?.nodeCount ?? 0} pods=${cluster?.podCount ?? 0} k8sVersion=${cluster?.k8sVersion ?? 'unknown'} timestamp=${Date.now()}`
  );

  res.json({
    status: 'PROCESSED',
    clusterId: req.clusterId,
    timestamp: Date.now(),
    resourceCount: extractedResources.length
  });
});

const ApproveImageReplacementSchema = z.object({
  container: z.string().min(1).max(253),
  expectedCurrentValue: z.string().min(1).max(1024),
  proposedValue: z.string().min(1).max(1024)
});

// Approval intentionally requires an authenticated engineer/admin/owner. It never mutates Kubernetes from the backend.
app.post('/api/v1/incidents/:id/remediations/replace-pod-image/approve', requireUserAuth, requireOrgMembership, requireRole(['OWNER', 'ADMIN', 'ENGINEER']), (req: AuthenticatedUserRequest, res) => {
  const parsed = ApproveImageReplacementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid remediation approval' });
  try { res.status(201).json({ action: store.approvePodImageReplacement(req.params.id, req.orgId!, parsed.data, { id: req.user!.id, name: req.user!.name }) }); }
  catch (err: any) { res.status(400).json({ error: err?.message || 'Unable to approve remediation' }); }
});

app.get('/api/v1/agent/actions', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  res.json({ actions: store.claimPendingRemediationActions(req.clusterId!) });
});

const ActionResultSchema = z.object({
  actionId: z.string().min(1).optional(),
  success: z.boolean(),
  message: z.string().min(1).max(4096)
});

app.post('/api/v1/agent/actions/:actionId/result', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const parsed = ActionResultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid action result' });
  }

  const actionId = req.params.actionId || parsed.data.actionId;
  if (!actionId) {
    return res.status(400).json({ error: 'Action ID is required' });
  }

  const action = store.recordRemediationResult(req.clusterId!, actionId, parsed.data);
  if (!action) {
    return res.status(404).json({ error: 'Action not found or is not deliverable' });
  }

  res.json({ status: 'ACK', success: true, action });
});

// --- Incidents Management ---
app.get('/api/v1/incidents', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const { status, severity, clusterId, namespace, search } = req.query;

  const incidents = store.getIncidents(req.orgId!, {
    status: status as any,
    severity: severity as any,
    clusterId: clusterId as string,
    namespace: namespace as string,
    search: search as string
  });

  res.json({ incidents });
});

app.get('/api/v1/incidents/:id', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const timeline = store.getIncidentTimeline(incident.id, req.orgId!);
  const notes = store.getIncidentNotes(incident.id, req.orgId!);
  const aiAnalysis = skyOpsAIService.getCachedAnalysis(incident.id) || store.getAIAnalysis(incident.id);
  const remediation = store.getRemediation(incident.id, req.orgId!);

  // Compute or reuse authoritative deterministic intelligence analysis
  const clusterResources = store.getClusterResources(incident.clusterId, req.orgId!);
  const associatedResource = clusterResources.find(
    (r) =>
      r.kind.toLowerCase() === incident.resourceKind.toLowerCase() &&
      r.name.toLowerCase() === incident.resourceName.toLowerCase() &&
      (r.namespace || 'default').toLowerCase() === (incident.namespace || 'default').toLowerCase()
  );
  const intelligence =
    aiAnalysis?.intelligence ||
    SkyOpsIntelligenceEngine.analyzeIncident(incident, associatedResource, clusterResources);
  incident.intelligence = intelligence;

  res.json({ incident, timeline, notes, aiAnalysis, remediation, intelligence });
});

// --- SkyOps Deterministic Intelligence Endpoint ---
app.get('/api/v1/incidents/:id/intelligence', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const clusterResources = store.getClusterResources(incident.clusterId, req.orgId!);
  const associatedResource = clusterResources.find(
    (r) =>
      r.kind.toLowerCase() === incident.resourceKind.toLowerCase() &&
      r.name.toLowerCase() === incident.resourceName.toLowerCase() &&
      (r.namespace || 'default').toLowerCase() === (incident.namespace || 'default').toLowerCase()
  );
  const intelligence = SkyOpsIntelligenceEngine.analyzeIncident(incident, associatedResource, clusterResources);
  res.json({ intelligence });
});

// --- SkyOps AI Incident Root-Cause Analysis Endpoints ---
app.get('/api/v1/incidents/:id/ai-analysis', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res) => {
  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  try {
    const clusterResources = store.getClusterResources(incident.clusterId, req.orgId!);
    const associatedResource = clusterResources.find(
      (r) =>
        r.kind.toLowerCase() === incident.resourceKind.toLowerCase() &&
        r.name.toLowerCase() === incident.resourceName.toLowerCase() &&
        (r.namespace || 'default').toLowerCase() === (incident.namespace || 'default').toLowerCase()
    );
    const notes = store.getIncidentNotes(incident.id, req.orgId!).map((n) => n.content);

    const analysis = await skyOpsAIService.analyzeIncident(incident, associatedResource, {
      notes,
      allResources: clusterResources
    });
    store.saveAIAnalysis(incident.id, analysis);
    res.json({ analysis, remediation: analysis.structuredRemediation, intelligence: analysis.intelligence });
  } catch (err: any) {
    console.error(`[SkyOps API] AI analysis error for ${req.params.id}:`, err);
    res.status(500).json({ error: err?.message || 'Failed to complete AI analysis' });
  }
});

app.post('/api/v1/incidents/:id/ai-analysis', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res) => {
  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  try {
    const clusterResources = store.getClusterResources(incident.clusterId, req.orgId!);
    const associatedResource = clusterResources.find(
      (r) =>
        r.kind.toLowerCase() === incident.resourceKind.toLowerCase() &&
        r.name.toLowerCase() === incident.resourceName.toLowerCase() &&
        (r.namespace || 'default').toLowerCase() === (incident.namespace || 'default').toLowerCase()
    );
    const notes = store.getIncidentNotes(incident.id, req.orgId!).map((n) => n.content);
    const force = req.body?.force === true;

    const analysis = await skyOpsAIService.analyzeIncident(incident, associatedResource, {
      force,
      notes,
      allResources: clusterResources
    });
    store.saveAIAnalysis(incident.id, analysis);
    res.json({ analysis, remediation: analysis.structuredRemediation, intelligence: analysis.intelligence });
  } catch (err: any) {
    console.error(`[SkyOps API] Force AI analysis error for ${req.params.id}:`, err);
    res.status(500).json({ error: err?.message || 'Failed to trigger AI analysis' });
  }
});

// --- Controlled AI Remediation Endpoints ---
app.get('/api/v1/incidents/:id/remediation', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const remediation = store.getRemediation(req.params.id, req.orgId!);
  if (!remediation) {
    return res.status(404).json({ error: 'No remediation proposal found for this incident' });
  }

  res.json({ remediation });
});

const ApproveRemediationSchema = z.object({
  proposedImage: z.string().min(1).max(300).optional(),
  comments: z.string().max(1000).optional()
});

app.post(
  '/api/v1/incidents/:id/remediation/approve',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'ENGINEER']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = ApproveRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid approval payload' });
    }

    try {
      const remediation = store.approveRemediation(
        req.params.id,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name, email: req.user!.email },
        parsed.data
      );

      res.json({
        success: true,
        message: `Remediation approved and dispatched for execution on cluster ${remediation.clusterName}`,
        remediation
      });
    } catch (err: any) {
      console.error(`[SkyOps API] Remediation approval error for ${req.params.id}:`, err);
      res.status(400).json({ error: err?.message || 'Failed to approve remediation' });
    }
  }
);

const RejectRemediationSchema = z.object({
  reason: z.string().max(500).optional()
});

app.post(
  '/api/v1/incidents/:id/remediation/reject',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'ENGINEER']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = RejectRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rejection payload' });
    }

    try {
      const remediation = store.rejectRemediation(
        req.params.id,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name },
        parsed.data.reason
      );

      res.json({
        success: true,
        message: 'Remediation proposal declined',
        remediation
      });
    } catch (err: any) {
      console.error(`[SkyOps API] Remediation rejection error for ${req.params.id}:`, err);
      res.status(400).json({ error: err?.message || 'Failed to reject remediation' });
    }
  }
);


const UpdateIncidentSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).optional(),
  title: z.string().min(3).max(200).optional(),
  resolutionReason: z.string().max(500).optional(),
  assignee: z
    .object({
      userId: z.string(),
      name: z.string(),
      email: z.string()
    })
    .optional()
});

app.patch(
  '/api/v1/incidents/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'ENGINEER']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = UpdateIncidentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid incident update payload' });
    }

    try {
      const updated = store.updateIncident(
        req.params.id,
        req.orgId!,
        parsed.data,
        { id: req.user!.id, name: req.user!.name }
      );

      if (!updated) {
        return res.status(404).json({ error: 'Incident not found' });
      }

      res.json({ incident: updated });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to update incident' });
    }
  }
);

app.get('/api/v1/incidents/:id/timeline', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const timeline = store.getIncidentTimeline(req.params.id, req.orgId!);
  res.json({ timeline });
});

app.get('/api/v1/incidents/:id/notes', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const notes = store.getIncidentNotes(req.params.id, req.orgId!);
  res.json({ notes });
});

const AddNoteSchema = z.object({
  content: z.string().min(1, 'Note content cannot be empty').max(3000)
});

app.post(
  '/api/v1/incidents/:id/notes',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'ENGINEER']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = AddNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid note content' });
    }

    const note = store.addIncidentNote(
      req.params.id,
      req.orgId!,
      { id: req.user!.id, name: req.user!.name, email: req.user!.email },
      parsed.data.content
    );

    if (!note) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.status(201).json({ note });
  }
);

app.delete(
  '/api/v1/incidents/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'ENGINEER']),
  (req: AuthenticatedUserRequest, res) => {
    const success = store.deleteIncident(req.params.id, req.orgId!);
    if (!success) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    res.json({ status: 'DELETED', id: req.params.id });
  }
);

app.delete(
  '/api/v1/incidents',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const deletedCount = store.clearAllIncidents(req.orgId!);
    res.json({ status: 'CLEARED', count: deletedCount });
  }
);

// --- Overview Dashboard Metrics ---
app.get('/api/v1/overview', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const metrics = store.getOverviewMetrics(req.orgId!);
  const clusters = store.getClusters(req.orgId!);
  const recentIncidents = store.getIncidents(req.orgId!).slice(0, 8);
  const recentActivity = store.getRecentActivity(req.orgId!, 12);

  res.json({
    metrics,
    clusters,
    recentIncidents,
    recentActivity
  });
});

// --- Development & QA Scenario Simulation ---
app.post('/api/v1/dev/simulate-scenario', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const { clusterId, scenario } = req.body;
  if (!clusterId || !scenario) {
    return res.status(400).json({ error: 'clusterId and scenario are required' });
  }

  const result = store.simulateScenario(req.orgId!, clusterId, scenario);
  res.json(result);
});

// --- API 404 Handler ---
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// --- API Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[SkyOps Server Error]', err);
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: err?.message || 'Internal Server Error' });
  } else {
    next(err);
  }
});

// ==========================================
// VITE MIDDLEWARE / SPA STATIC HANDLER
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SkyOps Server] Listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal Server Startup Error:', err);
});
