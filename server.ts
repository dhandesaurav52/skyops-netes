// Intercept and suppress benign Firestore gRPC idle stream cancellation messages in stderr
if (typeof process !== 'undefined' && process.stderr && (process.stderr as any).write) {
  const originalStderrWrite = (process.stderr as any).write.bind(process.stderr);
  (process.stderr as any).write = (chunk: any, encoding?: any, callback?: any) => {
    const str = typeof chunk === 'string' ? chunk : chunk?.toString() || '';
    if (
      str.includes('Disconnecting idle stream. Timed out waiting for new targets') ||
      (str.includes('GrpcConnection') && (str.includes('CANCELLED') || str.includes('idle stream')))
    ) {
      if (typeof encoding === 'function') encoding();
      else if (typeof callback === 'function') callback();
      return true;
    }
    return originalStderrWrite(chunk, encoding, callback);
  };
}

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
  requirePermission,
  requireRole,
  requireUserAuth
} from './server/auth';
import { config, isProduction } from './server/config';
import { systemObservability } from './server/observability/metrics';
import { auditService } from './server/audit';
import { webhookService } from './server/integrations/webhooks';
import { correlationIdMiddleware, sendApiError } from './server/middleware/requestId';
import {
  generateHelmCommand,
  generateInstallScript,
  generateKubernetesManifest,
  generateOneCommandInstall
} from './server/manifestGenerator';
import { normalizeTelemetry } from './server/normalization';
import { store } from './server/store';
import { incidentNotificationService } from './server/notifications/notificationService';
import { verifyProductionPersistence } from './server/persistence';
import { getPersistenceStore } from './server/persistence/index';
import { applicationLogArchive } from './server/applicationLogArchive';
import { getUsdInrRate } from './server/currency';
import { skyOpsAIService } from './server/ai/service';
import { explainArchitectureWithAI } from './server/ai/architectureAI';
import { SkyOpsIntelligenceEngine } from './server/engine/intelligence';
import { AGENT_DEFAULT_NAMESPACE, AGENT_VERSION } from './src/config/version';
import { KubernetesResource } from './src/types/index';
import { entitlementService } from './server/billing/entitlements';
import { billingService } from './server/billing/billingService';
import { getBillingConfig } from './server/billing/provider';
import { PLANS, BILLING_INTERVALS, DEFAULT_TRIAL_DAYS } from './src/config/plans';
import { storageRouter } from './server/storageRoutes';

dotenv.config();

const app = express();
const PORT = 3000;

export { app };

// Security & Parsing Middlewares
app.use(
  cors({
    origin: isProduction
      ? (config.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-org-id', 'x-request-id', 'x-skyops-agent-version']
  })
);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

app.use(correlationIdMiddleware);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(storageRouter);

// --- Platform Health & Self-Observability Probes ---
app.get('/health/live', (req, res) => {
  res.json({ status: 'ok', liveness: true, timestamp: Date.now() });
});

app.get('/health/ready', (req, res) => {
  const health = systemObservability.getHealth(true);
  const code = health.readiness ? 200 : 503;
  res.status(code).json(health);
});

app.get('/api/v1/system/health', (req, res) => {
  res.json(systemObservability.getHealth(true));
});

app.get('/api/v1/system/metrics', requireUserAuth, requireOrgMembership, requireRole(['OWNER', 'ADMIN']), (req: AuthenticatedUserRequest, res) => {
  res.json(systemObservability.getSnapshot());
});

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
  return process.env.APP_URL || (isProduction ? '' : 'http://localhost:3000');
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
  const orgs = store.getOrganizationsForUser(user.id, user.email);
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
  const orgs = store.getOrganizationsForUser(user.id, user.email);
  const currentOrg = orgs.find((o) => o.id === req.orgId) || orgs[0];

  res.json({
    user,
    currentOrg,
    role: req.userRole || 'OWNER'
  });
});

// --- Organizations ---
app.get('/api/v1/orgs', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const orgs = store.getOrganizationsForUser(req.user!.id, req.user!.email);
  res.json({ organizations: orgs });
});

app.get('/api/v1/orgs/current', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const org = store.getOrganization(req.orgId!);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }
  res.json({ organization: org, role: req.userRole });
});

app.get('/api/v1/orgs/:id', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const access = store.checkUserOrgAccess(req.user!.id, req.params.id, req.user!.email);
  if (!access.hasAccess) {
    return res.status(403).json({ error: 'Forbidden: You do not have access to this organization' });
  }
  const org = store.getOrganization(req.params.id);
  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }
  res.json({ organization: org, role: access.role });
});

const CreateOrgSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(60)
});

app.post('/api/v1/orgs', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const parsed = CreateOrgSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid organization payload' });
  }

  const org = store.createOrganization(
    parsed.data.name.trim(),
    req.user!.id,
    req.user!.email,
    req.user!.name
  );
  res.status(201).json({ organization: org });
});

const UpdateOrgSchema = z.object({
  name: z.string().min(2).max(60).optional(),
  settings: z
    .object({
      general: z
        .object({
          name: z.string().optional(),
          timezone: z.string().optional()
        })
        .optional(),
      notifications: z
        .object({
          incidentEmailEnabled: z.boolean().optional(),
          digestEmailEnabled: z.boolean().optional(),
          alertSeverityThreshold: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
          webhookUrl: z.string().url().or(z.literal('')).optional()
        })
        .optional(),
      security: z
        .object({
          enforceMfa: z.boolean().optional(),
          sessionTimeoutMinutes: z.number().min(15).max(10080).optional()
        })
        .optional()
    })
    .optional()
});

app.patch(
  '/api/v1/orgs/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    if (req.params.id !== req.orgId) {
      return res.status(403).json({ error: 'Forbidden: Cannot update an organization outside your active context' });
    }
    const parsed = UpdateOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update payload' });
    }

    const updated = store.updateOrganization(req.orgId!, parsed.data, {
      id: req.user!.id,
      name: req.user!.name || req.user!.email
    });
    if (!updated) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.json({ organization: updated });
  }
);

// --- Organization Members ---
app.get('/api/v1/orgs/members', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const role = typeof req.query.role === 'string' ? (req.query.role as any) : undefined;
  const status = typeof req.query.status === 'string' ? (req.query.status as any) : undefined;

  const members = store.getOrgMembers(req.orgId!, { search, role, status });
  res.json({ members, total: members.length });
});

const InviteMemberSchema = z.object({
  email: z.string().email('Valid email is required'),
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'])
});

app.post(
  '/api/v1/orgs/members/invite',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const entitlement = entitlementService.canAddMember(req.orgId!);
    if (!entitlement.allowed) {
      return res.status(402).json(entitlement.error);
    }

    const parsed = InviteMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid invitation payload' });
    }

    if (req.userRole !== 'OWNER' && parsed.data.role === 'OWNER') {
      return res.status(403).json({ error: 'Only organization Owners can invite users as Owners' });
    }

    try {
      const invitation = store.inviteMember(req.orgId!, parsed.data.email, parsed.data.role, {
        id: req.user!.id,
        name: req.user!.name || req.user!.email,
        email: req.user!.email
      });
      res.status(201).json({ success: true, invitation });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to invite member' });
    }
  }
);

const UpdateRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'ENGINEER', 'VIEWER'])
});

app.patch(
  '/api/v1/orgs/members/:userId/role',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = UpdateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid role payload' });
    }

    try {
      const member = store.updateMemberRole(req.orgId!, req.params.userId, parsed.data.role, {
        id: req.user!.id,
        name: req.user!.name || req.user!.email,
        role: req.userRole!
      });
      res.json({ success: true, member });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to update member role' });
    }
  }
);

const UpdateStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REMOVED'])
});

app.patch(
  '/api/v1/orgs/members/:userId/status',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = UpdateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid status payload' });
    }

    try {
      const member = store.updateMemberStatus(req.orgId!, req.params.userId, parsed.data.status, {
        id: req.user!.id,
        name: req.user!.name || req.user!.email,
        role: req.userRole!
      });
      res.json({ success: true, member });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to update member status' });
    }
  }
);

app.delete(
  '/api/v1/orgs/members/:userId',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const success = store.removeMember(req.orgId!, req.params.userId, {
        id: req.user!.id,
        name: req.user!.name || req.user!.email,
        role: req.userRole!
      });
      res.json({ success, message: 'Member removed from organization' });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to remove member' });
    }
  }
);

// --- Invitations ---
app.get(
  '/api/v1/orgs/invitations',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const invitations = store.getOrgInvitations(req.orgId!);
    res.json({ invitations });
  }
);

app.delete(
  '/api/v1/orgs/invitations/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const success = store.revokeInvitation(req.orgId!, req.params.id, {
      id: req.user!.id,
      name: req.user!.name || req.user!.email
    });
    if (!success) {
      return res.status(404).json({ error: 'Invitation not found or cannot be revoked' });
    }
    res.json({ success: true, message: 'Invitation revoked' });
  }
);

app.post(
  '/api/v1/orgs/invitations/:id/resend',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const invitation = store.resendInvitation(req.orgId!, req.params.id, {
        id: req.user!.id,
        name: req.user!.name || req.user!.email
      });
      res.json({ success: true, invitation });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Failed to resend invitation' });
    }
  }
);

// Verify invitation token (public/authenticated preview)
app.get('/api/v1/invitations/verify', (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) {
    return res.status(400).json({ error: 'Invitation token is required' });
  }
  const inv = store.getInvitationByToken(token);
  if (!inv) {
    return res.status(404).json({ error: 'Invalid or expired invitation' });
  }
  const org = store.getOrganization(inv.orgId);
  res.json({
    valid: inv.status === 'PENDING' && inv.expiresAt > Date.now(),
    email: inv.email,
    role: inv.role,
    orgName: org?.name || 'SkyOps Workspace',
    expiresAt: inv.expiresAt,
    status: inv.status
  });
});

const AcceptInvitationSchema = z.object({
  token: z.string().min(1, 'Token is required')
});

app.post('/api/v1/invitations/accept', requireUserAuth, (req: AuthenticatedUserRequest, res) => {
  const parsed = AcceptInvitationSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid invitation acceptance payload' });
  }

  try {
    const result = store.acceptInvitation(parsed.data.token, {
      id: req.user!.id,
      email: req.user!.email,
      name: req.user!.name || req.user!.email
    });
    res.json({ success: true, organization: result.org, role: result.role });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to accept invitation' });
  }
});

// --- Support / Enterprise Contact ---
const CreateSupportTicketSchema = z.object({
  subject: z.string().min(3, 'Subject must be at least 3 characters').max(120),
  category: z.enum(['INCIDENT', 'AGENT', 'PLATFORM', 'BILLING_QUERY', 'GENERAL']),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  description: z.string().min(10, 'Description must be at least 10 characters').max(3000),
  clusterId: z.string().optional(),
  incidentId: z.string().optional()
});

app.post(
  '/api/v1/support/tickets',
  requireUserAuth,
  requireOrgMembership,
  (req: AuthenticatedUserRequest, res) => {
    const parsed = CreateSupportTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid support ticket payload' });
    }

    const ticket = store.createSupportTicket({
      orgId: req.orgId!,
      userId: req.user!.id,
      userName: req.user!.name || req.user!.email,
      userEmail: req.user!.email,
      ...parsed.data
    });

    res.status(201).json({ success: true, ticket });
  }
);

app.get(
  '/api/v1/support/tickets',
  requireUserAuth,
  requireOrgMembership,
  (req: AuthenticatedUserRequest, res) => {
    const tickets = store.getSupportTickets(req.orgId!);
    res.json({ tickets });
  }
);

// --- Clusters ---
app.get('/api/v1/clusters', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const clusters = store.getClusters(req.orgId!);
  res.json({ clusters });
});

const CreateClusterSchema = z.object({
  name: z.string().min(2, 'Cluster name must be at least 2 characters').max(60),
  description: z.string().max(300).optional()
});

app.post('/api/v1/clusters', requireUserAuth, requireOrgMembership, requirePermission('cluster.manage'), (req: AuthenticatedUserRequest, res) => {
  const entitlement = entitlementService.canCreateCluster(req.orgId!);
  if (!entitlement.allowed) {
    return res.status(403).json({
      code: entitlement.code || 'PLAN_LIMIT_REACHED',
      upgradeRequired: entitlement.upgradeRequired ?? true,
      error: entitlement.error || 'Cluster limit reached'
    });
  }

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

app.post('/api/v1/clusters/:id/connect', requireUserAuth, requireOrgMembership, requirePermission('cluster.manage'), (req: AuthenticatedUserRequest, res) => {
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

app.post(
  '/api/v1/clusters/:id/rotate-token',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('cluster.manage'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const { cluster, rawToken, connectionCode, installKey } = store.rotateAgentToken(
        req.params.id,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name }
      );
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

app.post(
  '/api/v1/clusters/:id/revoke-token',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('cluster.manage'),
  (req: AuthenticatedUserRequest, res) => {
    const success = store.revokeAgentToken(req.params.id, req.orgId!, { id: req.user!.id, name: req.user!.name });
    if (!success) {
      return res.status(404).json({ error: 'Cluster not found or already disconnected' });
    }
    res.json({ success: true, message: 'Cluster agent token revoked and cluster disconnected' });
  }
);

app.delete(
  '/api/v1/clusters/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const deleted = store.deleteCluster(req.params.id, req.orgId!, {
      id: req.user!.id,
      name: req.user!.name || req.user!.email
    });
    if (!deleted) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    res.json({ success: true, message: 'Cluster and associated telemetry deleted' });
  }
);

// Get manifests for cluster
app.get('/api/v1/clusters/:id/manifests', requireUserAuth, requireOrgMembership, requirePermission('cluster.manage'), (req: AuthenticatedUserRequest, res) => {
  const cluster = store.getCluster(req.params.id, req.orgId!, true);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const serverUrl = getPublicServerUrl(req);
  const token = store.getActiveAgentToken(cluster.id);
  if (!token) {
    return res.status(410).json({ error: 'Installation credential is no longer available; rotate the agent token to generate a new manifest' });
  }

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
const handleScriptInstall = async (req: Request, res: Response) => {
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
  const token = store.getActiveAgentToken(cluster.id);
  if (!token) {
    return res.status(410).type('text/plain').send('# Installation credential is no longer available. Generate a new agent token from the SkyOps Dashboard.\n');
  }

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
const handleManifestBySession = async (req: Request, res: Response) => {
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
  const token = store.getActiveAgentToken(cluster.id);
  if (!token) {
    return res.status(410).type('text/plain').send('# Installation credential is no longer available. Generate a new agent token from the SkyOps Dashboard.\n');
  }

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
app.get('/api/v1/clusters/:id/install.sh', async (req: Request, res: Response) => {
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
    const verified = await store.authenticateAgentTokenAsync(bearer);
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
  const token = store.getActiveAgentToken(cluster.id);
  if (!token) {
    return res.status(410).type('text/plain').send('# Installation credential is no longer available. Generate a new agent token from the SkyOps Dashboard.\n');
  }

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
const handleManifestDownload = async (req: Request, res: Response) => {
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
    const verified = await store.authenticateAgentTokenAsync(bearer);
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
  const token = store.getActiveAgentToken(cluster.id);
  if (!token) {
    return res.status(410).type('text/plain').send('# Installation credential is no longer available. Generate a new agent token from the SkyOps Dashboard.\n');
  }

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
  const cluster = store.getCluster(req.params.id, req.orgId!);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }
  const resources = store.getClusterResources(req.params.id, req.orgId!);
  res.json({ resources: Array.isArray(resources) ? resources : [] });
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
  const range = (req.query.range as string) || '1h';
  const history = store.getClusterMetricHistory(req.params.id, req.orgId!, range);
  res.json({ history, timeRange: range });
});

// --- Metrics Server Observability & Enablement Endpoints ---
app.get('/api/v1/clusters/:id/metrics-server', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const status = store.getMetricsServerStatus(req.params.id, req.orgId!);
  if (!status) {
    return res.status(404).json({ error: 'Cluster not found' });
  }
  res.json({ status });
});

app.post('/api/v1/clusters/:id/metrics-server/verify', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res) => {
  const verification = await store.verifyMetricsServer(req.params.id, req.orgId!);
  if (!verification) {
    return res.status(404).json({ error: 'Cluster not found' });
  }
  res.json(verification);
});

// Phase 2 Smart Telemetry & Historical Intelligence Endpoints
app.get('/api/v1/clusters/:id/telemetry', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const range = (req.query.range as '15m' | '1h' | '6h' | '24h' | '7d') || '1h';
  const resolution = (req.query.resolution as 'auto' | 'raw' | '1m' | '5m' | '1h') || 'auto';
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 25;
  const includeRaw = req.query.includeRaw !== 'false';

  const telemetry = store.getTelemetryHistory(req.params.id, req.orgId!, {
    range,
    resolution,
    limit,
    includeRaw
  });

  if (!telemetry) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  res.json(telemetry);
});

app.get('/api/v1/clusters/:id/telemetry/baseline', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const range = (req.query.range as string) || '24h';
  const baseline = store.getTelemetryBaseline(req.params.id, req.orgId!, range);
  if (!baseline) {
    return res.status(404).json({ error: 'Baseline not available: insufficient telemetry points or cluster not found' });
  }
  res.json({ baseline });
});

app.get('/api/v1/clusters/:id/telemetry/anomalies', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const anomalies = store.getTelemetryAnomalies(req.params.id, req.orgId!);
  res.json({ anomalies });
});

// --- First-Class Kubernetes Events Observability Endpoint ---
app.get('/api/v1/clusters/:id/events', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const cluster = store.getCluster(req.params.id, req.orgId!);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const { type, namespace, kind, resourceName, search, limit } = req.query as Record<string, string | undefined>;
  const parsedLimit = limit ? parseInt(limit, 10) : undefined;
  const parsedType = type === 'Warning' || type === 'Normal' ? type : undefined;

  const events = store.getClusterEvents(req.params.id, req.orgId!, {
    type: parsedType,
    namespace,
    kind,
    resourceName,
    search,
    limit: parsedLimit
  });

  res.json({ events });
});

// --- Controlled Pod / Container Log Retrieval Endpoint ---
app.get('/api/v1/clusters/:id/pods/:namespace/:podName/logs', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res) => {
  const cluster = store.getCluster(req.params.id, req.orgId!);
  if (!cluster) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const { container, tailLines, previous, sinceSeconds, timestamps, filter } = req.query as Record<string, string | undefined>;
  const parsedTailLines = tailLines ? parseInt(tailLines, 10) : 100;
  const parsedPrevious = previous === 'true' || previous === '1';
  const parsedSince = sinceSeconds ? parseInt(sinceSeconds, 10) : undefined;
  const parsedTimestamps = timestamps !== 'false' && timestamps !== '0';

  try {
    const logData = await store.getPodLogs(req.params.id, req.orgId!, req.params.namespace, req.params.podName, {
      container,
      tailLines: parsedTailLines,
      previous: parsedPrevious,
      sinceSeconds: parsedSince,
      timestamps: parsedTimestamps,
      filter
    });

    res.json(logData);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Failed to retrieve pod logs' });
  }
});

app.get('/api/v1/resources', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const {
    clusterId,
    kind,
    namespace,
    health,
    status,
    nodeName,
    search,
    incidentId,
    timeRange,
    since,
    until,
    sortBy,
    sortOrder,
    page,
    limit
  } = req.query as Record<string, string | undefined>;

  const parsedPage = page ? parseInt(page, 10) : undefined;
  const parsedLimit = limit ? parseInt(limit, 10) : undefined;
  const parsedSince = since ? parseInt(since, 10) : undefined;
  const parsedUntil = until ? parseInt(until, 10) : undefined;
  const parsedOrder = sortOrder === 'desc' ? 'desc' : 'asc';

  const result = store.queryResources(req.orgId!, {
    clusterId,
    kind,
    namespace,
    health,
    status,
    nodeName,
    search,
    incidentId,
    timeRange,
    since: parsedSince,
    until: parsedUntil,
    sortBy,
    sortOrder: parsedOrder,
    page: parsedPage,
    limit: parsedLimit
  });

  res.json(result);
});

// Bounded, tenant-scoped request log archive. Authentication middleware populates
// req.orgId before the response completes; no raw credentials are archived.
app.use((req: any, res: any, next: any) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const orgId = req.orgId;
    if (!orgId || !String(req.path || '').startsWith('/api/')) return;
    applicationLogArchive.append({
      orgId,
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      message: `${req.method} ${req.path}`,
      requestId: req.id || req.headers['x-request-id'],
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
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

app.post('/api/v1/agent/telemetry', requireAgentAuth, async (req: AuthenticatedAgentRequest, res) => {
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
  store.syncClusterResources(req.clusterId!, extractedResources, {
    snapshotComplete: req.body?.snapshotComplete === true,
    telemetryTimestamp: Number(req.body?.observedAt || req.body?.timestamp || 0) || undefined
  });

  const batchId = typeof req.body?.batchId === 'string' ? req.body.batchId.trim() : '';
  if (batchId) {
    const agentId = String(req.headers['x-agent-id'] || 'unknown-agent');
    const batchKey = `${req.clusterId}:${agentId}:${batchId}`;
    const accepted = await getPersistenceStore().claimTelemetryBatch(batchKey, {
      clusterId: req.clusterId,
      agentId,
      batchId
    });
    if (!accepted) {
      return res.json({
        status: 'ALREADY_PROCESSED',
        code: 'already_processed',
        clusterId: req.clusterId,
        batchId,
        timestamp: Date.now()
      });
    }
  }

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

  const cluster = store.getClusterByIdInternal(req.clusterId!);
  if (cluster) {
    auditService.record({
      orgId: cluster.orgId,
      actorId: req.clusterId!,
      actorName: `Agent (${cluster.name})`,
      actorType: 'AGENT',
      action: 'remediation.executed',
      resourceType: 'REMEDIATION',
      resourceId: action.id,
      result: parsed.data.success ? 'SUCCESS' : 'FAILURE',
      details: {
        incidentId: action.incidentId,
        clusterId: req.clusterId,
        clusterName: cluster.name,
        targetNamespace: (action as any).targetNamespace,
        targetResourceName: (action as any).targetResourceName,
        success: parsed.data.success,
        message: parsed.data.message
      }
    });
  }

  res.json({ status: 'ACK', success: true, action });
});

// Agent On-Demand Pod Logs Request Polling
app.get('/api/v1/agent/logs/requests', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const requests = store.claimPendingLogRequests(req.clusterId!);
  res.json({ requests });
});

const AgentLogIngestSchema = z.object({
  requestId: z.string().optional(),
  namespace: z.string().min(1),
  podName: z.string().min(1),
  container: z.string().min(1),
  logs: z.string().optional().default(''),
  previous: z.boolean().optional(),
  status: z.enum([
    'SUCCESS',
    'EMPTY_LOGS',
    'NO_LOGS',
    'PERMISSION_DENIED',
    'POD_NOT_FOUND',
    'CONTAINER_NOT_FOUND',
    'CONTAINER_WAITING',
    'POD_INITIALIZING',
    'PREVIOUS_LOGS_UNAVAILABLE',
    'KUBERNETES_API_UNAVAILABLE',
    'K8S_API_ERROR',
    'AGENT_DISCONNECTED',
    'TIMEOUT',
    'UNKNOWN_ERROR'
  ]).optional(),
  errorMessage: z.string().optional(),
  waitingReason: z.string().optional(),
  waitingMessage: z.string().optional()
});

app.post('/api/v1/agent/logs', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const parsed = AgentLogIngestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid log ingestion payload' });
  }

  const { namespace, podName, container, logs, previous, status, errorMessage, waitingReason, waitingMessage } = parsed.data;
  store.storePodLogs(req.clusterId!, namespace, podName, container, logs || '', !!previous, status as any, errorMessage, waitingReason, waitingMessage);

  res.json({ success: true, message: 'Pod logs ingested successfully' });
});

// Agent Metrics Server Verification Request Polling & Ingestion
app.get('/api/v1/agent/metrics-server/verification-requests', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const requests = store.claimPendingMetricsServerVerificationRequests(req.clusterId!);
  res.json({ requests });
});

const AgentMetricsServerVerificationResultSchema = z.object({
  requestId: z.string(),
  clusterId: z.string(),
  status: z.string(),
  deploymentFound: z.boolean(),
  deploymentName: z.string().optional(),
  deploymentNamespace: z.string().optional(),
  deploymentReady: z.boolean(),
  readyReplicas: z.number().optional(),
  expectedReplicas: z.number().optional(),
  podReady: z.boolean(),
  podPhase: z.string().optional(),
  podName: z.string().optional(),
  apiReachable: z.boolean(),
  nodeMetricsAvailable: z.boolean(),
  nodeMetricsCount: z.number().optional(),
  podMetricsAvailable: z.boolean(),
  podMetricsCount: z.number().optional(),
  rawError: z.string().optional(),
  diagnostics: z.array(z.string()).optional(),
  whatHappened: z.string().optional(),
  why: z.string().optional(),
  impact: z.string().optional(),
  nextAction: z.string().optional(),
  verifiedAt: z.number().optional()
});

app.post('/api/v1/agent/metrics-server/verification-results', requireAgentAuth, (req: AuthenticatedAgentRequest, res) => {
  const parsed = AgentMetricsServerVerificationResultSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid verification result payload' });
  }

  store.recordMetricsServerVerificationResult(parsed.data);
  res.json({ success: true, message: 'Metrics Server verification result recorded successfully' });
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

app.post('/api/v1/incidents/:id/investigate', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const entitlement = entitlementService.canUseAI(req.orgId!);
  if (!entitlement.allowed) {
    return res.status(402).json(entitlement.error);
  }

  const incident = store.getIncident(req.params.id, req.orgId!);
  if (!incident) {
    return res.status(404).json({ error: 'Incident not found' });
  }

  const { question } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Question string is required' });
  }

  const clusterResources = store.getClusterResources(incident.clusterId, req.orgId!);
  const associatedResource = clusterResources.find(
    (r) =>
      r.kind.toLowerCase() === incident.resourceKind.toLowerCase() &&
      r.name.toLowerCase() === incident.resourceName.toLowerCase() &&
      (r.namespace || 'default').toLowerCase() === (incident.namespace || 'default').toLowerCase()
  );
  const intelligence = SkyOpsIntelligenceEngine.analyzeIncident(incident, associatedResource, clusterResources);
  const result = SkyOpsIntelligenceEngine.investigateQuestion(intelligence, question);

  res.json({ result, intelligence });
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
  const entitlement = entitlementService.canUseAI(req.orgId!);
  if (!entitlement.allowed) {
    return res.status(402).json(entitlement.error);
  }

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

    auditService.record({
      orgId: req.orgId!,
      actorId: 'skyops-ai-engine',
      actorName: 'SkyOps Gemini AI',
      actorType: 'AI',
      action: 'ai.root_cause_diagnosed',
      resourceType: 'INCIDENT',
      resourceId: incident.id,
      result: 'SUCCESS',
      details: {
        incidentId: incident.id,
        clusterId: incident.clusterId,
        confidence: analysis.confidence,
        risk: (analysis as any).riskLevel,
        rootCauseSummary: analysis.rootCause ? analysis.rootCause.substring(0, 150) : undefined
      }
    });

    res.json({ analysis, remediation: analysis.structuredRemediation, intelligence: analysis.intelligence });
  } catch (err: any) {
    console.error(`[SkyOps API] Force AI analysis error for ${req.params.id}:`, err);
    res.status(500).json({ error: err?.message || 'Failed to trigger AI analysis' });
  }
});

// --- Architecture AI Explanation Endpoint ---
app.post('/api/v1/architecture/explain', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res: Response) => {
  try {
    const payload = req.body || {};
    if (!payload.targetName) {
      payload.targetName = payload.clusterName || 'Kubernetes Cluster';
    }
    if (!payload.targetType) {
      payload.targetType = 'cluster';
    }
    if (!payload.targetKind) {
      payload.targetKind = payload.targetType === 'cluster' ? 'Cluster' : 'Resource';
    }
    const explanation = await explainArchitectureWithAI(payload);
    res.json({ explanation });
  } catch (err: any) {
    console.error('[SkyOps API] Architecture explain error:', err);
    res.status(500).json({ error: err?.message || 'Failed to generate architecture explanation' });
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
  requirePermission('remediation.approve'),
  (req: AuthenticatedUserRequest, res) => {
    const entitlement = entitlementService.canExecuteRemediation(req.orgId!);
    if (!entitlement.allowed) {
      return res.status(402).json(entitlement.error);
    }

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

      auditService.record({
        orgId: req.orgId!,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorType: 'HUMAN',
        action: 'remediation.approved',
        resourceType: 'REMEDIATION',
        resourceId: remediation.id,
        result: 'SUCCESS',
        details: {
          incidentId: req.params.id,
          clusterId: remediation.clusterId,
          clusterName: remediation.clusterName,
          actionType: remediation.actionType,
          parameters: remediation.parameters
        }
      });

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
  requirePermission('remediation.approve'),
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

      auditService.record({
        orgId: req.orgId!,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorType: 'HUMAN',
        action: 'remediation.rejected',
        resourceType: 'REMEDIATION',
        resourceId: remediation.id,
        result: 'SUCCESS',
        details: {
          incidentId: req.params.id,
          clusterId: remediation.clusterId,
          reason: parsed.data.reason
        }
      });

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

const RollbackRemediationSchema = z.object({
  reason: z.string().max(500).optional()
});

app.post(
  '/api/v1/incidents/:id/remediation/rollback',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('remediation.approve'),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = RollbackRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rollback payload' });
    }

    try {
      const remediation = store.rollbackRemediation(
        req.params.id,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name, email: req.user!.email },
        parsed.data.reason
      );

      auditService.record({
        orgId: req.orgId!,
        actorId: req.user!.id,
        actorName: req.user!.name,
        actorType: 'HUMAN',
        action: 'remediation.rollback',
        resourceType: 'REMEDIATION',
        resourceId: remediation.id,
        result: 'SUCCESS',
        details: {
          incidentId: req.params.id,
          clusterId: remediation.clusterId,
          reason: parsed.data.reason
        }
      });

      res.json({
        success: true,
        message: `Rollback dispatched: reverting container to previous configuration on cluster "${remediation.clusterName}"`,
        remediation
      });
    } catch (err: any) {
      console.error(`[SkyOps API] Remediation rollback error for ${req.params.id}:`, err);
      res.status(400).json({ error: err?.message || 'Failed to trigger remediation rollback' });
    }
  }
);

// --- Remediation Policy & Audit Endpoints ---
const UpdateRemediationPolicySchema = z.object({
  clusterId: z.string().optional(),
  remediationMode: z.enum(['MANUAL_ONLY', 'APPROVAL_REQUIRED', 'CONTROLLED_AUTONOMOUS']).optional(),
  allowedActionTypes: z.array(z.string()).optional(),
  targetKindAllowlist: z.array(z.string()).optional(),
  namespaceAllowlist: z.array(z.string()).optional(),
  namespaceDenylist: z.array(z.string()).optional(),
  environmentAllowlist: z.array(z.string()).optional(),
  maxRiskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  requireHumanApproval: z.boolean().optional(),
  maxAutonomousPerHour: z.number().min(1).max(100).optional(),
  maxAttemptsPerIncident: z.number().min(1).max(10).optional(),
  circuitBreakerCooldownMs: z.number().min(1000).max(86400000).optional(),
  allowStandalonePodsOnly: z.boolean().optional(),
  maxTelemetryAgeMs: z.number().min(5000).max(3600000).optional(),
  actionExpirationMs: z.number().min(30000).max(3600000).optional(),
  leaseTimeoutMs: z.number().min(10000).max(600000).optional()
});

app.get('/api/v1/remediation/policy', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const clusterId = typeof req.query.clusterId === 'string' ? req.query.clusterId : undefined;
  const policy = store.getRemediationPolicy(req.orgId!, clusterId);
  res.json({ policy });
});

app.put(
  '/api/v1/remediation/policy',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = UpdateRemediationPolicySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid policy payload' });
    }

    try {
      const clusterId = parsed.data.clusterId || (typeof req.query.clusterId === 'string' ? req.query.clusterId : undefined);
      const updated = store.updateRemediationPolicy(
        req.orgId!,
        parsed.data,
        clusterId,
        { id: req.user!.id, name: req.user!.name }
      );
      res.json({ success: true, policy: updated });
    } catch (err: any) {
      console.error('[SkyOps API] Update policy error:', err);
      res.status(400).json({ error: err?.message || 'Failed to update policy' });
    }
  }
);

app.get('/api/v1/incidents/:id/remediation/audit', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  try {
    const audit = store.getRemediationAuditTrail(req.params.id, req.orgId!);
    res.json(audit);
  } catch (err: any) {
    res.status(404).json({ error: err?.message || 'Audit trail not found' });
  }
});

const CancelRemediationSchema = z.object({
  actionId: z.string().min(1)
});

app.post(
  '/api/v1/incidents/:id/remediation/cancel',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('remediation.execute'),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = CancelRemediationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Action ID is required' });
    }

    try {
      const action = store.cancelRemediationAction(
        parsed.data.actionId,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name }
      );
      res.json({ success: true, action });
    } catch (err: any) {
      console.error(`[SkyOps API] Remediation cancel error:`, err);
      res.status(400).json({ error: err?.message || 'Failed to cancel remediation' });
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

// --- Audit Center Endpoints ---
app.get('/api/v1/audit', requireUserAuth, requireOrgMembership, requirePermission('audit.read'), async (req: AuthenticatedUserRequest, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 25;
  const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
  const actorType = typeof req.query.actorType === 'string' ? req.query.actorType : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
  const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
  const resultFilter = typeof req.query.result === 'string' ? (req.query.result.toUpperCase() as 'SUCCESS' | 'FAILURE') : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const fromTimestamp = req.query.fromTimestamp ? parseInt(req.query.fromTimestamp as string, 10) : undefined;
  const toTimestamp = req.query.toTimestamp ? parseInt(req.query.toTimestamp as string, 10) : undefined;

  const result = await auditService.queryAsync({
    orgId: req.orgId!,
    page,
    limit,
    actorId,
    actorType,
    action,
    resourceType,
    resourceId,
    result: resultFilter,
    search,
    fromTimestamp,
    toTimestamp
  });

  res.json(result);
});

app.get('/api/v1/audit/stats', requireUserAuth, requireOrgMembership, requirePermission('audit.read'), async (req: AuthenticatedUserRequest, res) => {
  try {
    const stats = await auditService.getStats(req.orgId!);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to calculate audit stats' });
  }
});

app.get('/api/v1/audit/integrity', requireUserAuth, requireOrgMembership, requirePermission('audit.read'), async (req: AuthenticatedUserRequest, res) => {
  try {
    const verification = await auditService.verifyIntegrity(req.orgId!);
    res.json(verification);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to verify audit ledger integrity' });
  }
});

app.get('/api/v1/audit/verify', requireUserAuth, requireOrgMembership, requirePermission('audit.read'), async (req: AuthenticatedUserRequest, res) => {
  try {
    const verification = await auditService.verifyIntegrity(req.orgId!);
    res.json(verification);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to verify audit ledger integrity' });
  }
});

app.get('/api/v1/audit/export', requireUserAuth, requireOrgMembership, requirePermission('audit.read'), async (req: AuthenticatedUserRequest, res) => {
  const format = req.query.format === 'csv' ? 'csv' : 'json';
  const actorId = typeof req.query.actorId === 'string' ? req.query.actorId : undefined;
  const actorType = typeof req.query.actorType === 'string' ? req.query.actorType : undefined;
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const resourceType = typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined;
  const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
  const resultFilter = typeof req.query.result === 'string' ? (req.query.result.toUpperCase() as 'SUCCESS' | 'FAILURE') : undefined;
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  const fromTimestamp = req.query.fromTimestamp ? parseInt(req.query.fromTimestamp as string, 10) : undefined;
  const toTimestamp = req.query.toTimestamp ? parseInt(req.query.toTimestamp as string, 10) : undefined;

  const filters = {
    orgId: req.orgId!,
    actorId,
    actorType,
    action,
    resourceType,
    resourceId,
    result: resultFilter,
    search,
    fromTimestamp,
    toTimestamp
  };

  if (format === 'csv') {
    const csv = auditService.exportCsv(filters);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="skyops_audit_${req.orgId}_${Date.now()}.csv"`);
    return res.send(csv);
  }

  const items = auditService.exportJson(filters);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="skyops_audit_${req.orgId}_${Date.now()}.json"`);
  res.json(items);
});

// --- Webhooks & Integrations Endpoints ---
const CreateWebhookSchema = z.object({
  name: z.string().min(1).max(100),
  url: z.string().url().max(500),
  secret: z.string().min(8).max(100).optional(),
  enabledEvents: z.array(z.string()).optional()
});

app.get('/api/v1/integrations/webhooks', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), (req: AuthenticatedUserRequest, res) => {
  const webhooks = webhookService.getWebhooks(req.orgId!);
  res.json({ webhooks });
});

app.post('/api/v1/integrations/webhooks', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), (req: AuthenticatedUserRequest, res) => {
  const entitlement = entitlementService.canUseWebhooks(req.orgId!);
  if (!entitlement.allowed) {
    return res.status(403).json({
      code: 'FEATURE_NOT_ENTITLED',
      error: 'Outbound webhooks and integrations are disabled on the Free tier. Upgrade to Pro or Business to configure custom HTTP webhooks.',
      upgradeRequired: true
    });
  }

  const parsed = CreateWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid webhook payload' });
  }

  const wh = webhookService.createWebhook(req.orgId!, parsed.data as any);
  auditService.record({
    orgId: req.orgId!,
    actorId: req.user!.id,
    actorName: req.user!.name,
    actorType: 'USER',
    action: 'integration.webhook_created',
    resourceType: 'INTEGRATION',
    resourceId: wh.id,
    result: 'SUCCESS',
    details: { name: wh.name, url: wh.url }
  });
  res.status(201).json({ webhook: wh });
});

app.put('/api/v1/integrations/webhooks/:id', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), (req: AuthenticatedUserRequest, res) => {
  const updated = webhookService.updateWebhook(req.params.id, req.orgId!, req.body);
  if (!updated) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  res.json({ webhook: updated });
});

app.delete('/api/v1/integrations/webhooks/:id', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), (req: AuthenticatedUserRequest, res) => {
  const success = webhookService.deleteWebhook(req.params.id, req.orgId!);
  if (!success) {
    return res.status(404).json({ error: 'Webhook not found' });
  }
  auditService.record({
    orgId: req.orgId!,
    actorId: req.user!.id,
    actorName: req.user!.name,
    actorType: 'USER',
    action: 'integration.webhook_deleted',
    resourceType: 'INTEGRATION',
    resourceId: req.params.id,
    result: 'SUCCESS'
  });
  res.json({ success: true, message: 'Webhook deleted' });
});

app.post('/api/v1/integrations/webhooks/:id/test', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), async (req: AuthenticatedUserRequest, res) => {
  const result = await webhookService.testWebhook(req.params.id, req.orgId!);
  res.json(result);
});

app.get('/api/v1/integrations/webhooks/:id/deliveries', requireUserAuth, requireOrgMembership, requirePermission('integration.manage'), (req: AuthenticatedUserRequest, res) => {
  const deliveries = webhookService.getDeliveries(req.orgId!, req.params.id);
  res.json({ deliveries });
});

// --- Organization Usage Tracking ---
app.get('/api/v1/orgs/usage', requireUserAuth, requireOrgMembership, requirePermission('billing.read'), (req: AuthenticatedUserRequest, res) => {
  const usage = store.getOrgUsage(req.orgId!);
  const metrics = store.getUsageMetrics(req.orgId!);
  const overview = billingService.getSubscriptionOverview(req.orgId!);
  res.json({ usage, metrics, subscription: overview.subscription, plan: overview.plan, entitlements: overview.entitlements, quotaUsage: overview.usage });
});

// ==========================================
// BILLING, SUBSCRIPTIONS, PLANS & INVOICES
// ==========================================

// Public: Get billing gateway configuration (Razorpay vs Sandbox)
app.get('/api/v1/billing/config', (req, res) => {
  res.json(getBillingConfig());
});

// Public / Authenticated: List all plans, intervals, pricing, limits, and features
app.get('/api/v1/billing/exchange-rate', async (_req, res) => {
  const rate = await getUsdInrRate();
  if (!rate) return res.status(503).json({ error: 'USD/INR exchange rate is temporarily unavailable' });
  res.json({ base: 'INR', quote: 'USD', ...rate });
});

app.get('/api/v1/billing/plans', (req, res) => {
  res.json({
    plans: Object.values(PLANS),
    intervals: BILLING_INTERVALS,
    defaultTrialDays: DEFAULT_TRIAL_DAYS
  });
});

// Get current organization subscription & usage overview
app.get('/api/v1/billing/subscription', requireUserAuth, requireOrgMembership, requirePermission('billing.read'), (req: AuthenticatedUserRequest, res) => {
  const overview = billingService.getSubscriptionOverview(req.orgId!);
  res.json({
    ...overview,
    subscription: overview.subscription,
    entitlements: overview.entitlements,
    plan: overview.plan,
    usage: overview.usage
  });
});

// Get organization entitlements and limits
app.get('/api/v1/billing/entitlements', requireUserAuth, requireOrgMembership, requirePermission('billing.read'), (req: AuthenticatedUserRequest, res) => {
  const overview = billingService.getSubscriptionOverview(req.orgId!);
  const sub = overview.subscription;
  const entitlements = {
    planId: sub.planId,
    status: sub.status,
    limits: overview.entitlements.limits,
    features: overview.entitlements.features,
    effectiveLimits: overview.entitlements.limits
  };
  res.json({ entitlements, subscription: sub });
});

// Initiate checkout session for upgrade / new plan selection
const CheckoutSchema = z.object({
  planId: z.enum(['PRO', 'BUSINESS']),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).optional(),
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).optional(),
  returnUrl: z.string().optional()
});

app.post('/api/v1/billing/checkout', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  const parsed = CheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload' });
  }

  const chosenInterval = parsed.data.interval || parsed.data.billingInterval || 'MONTHLY';

  try {
    const result = await billingService.createCheckout(
      req.orgId!,
      parsed.data.planId,
      chosenInterval,
      req.user!,
      parsed.data.returnUrl
    );
    res.status(201).json({ session: result.session || result, ...result });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to initiate checkout' });
  }
});

// Complete / Confirm checkout session (used for instant checkout activation)
const ConfirmCheckoutSchema = z.object({
  planId: z.enum(['PRO', 'BUSINESS']).optional(),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).optional(),
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).optional(),
  sessionId: z.string().optional(),
  razorpayOrderId: z.string().optional(),
  razorpaySubscriptionId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional()
});

app.post('/api/v1/billing/checkout/confirm', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  const parsed = ConfirmCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid confirmation payload' });
  }

  try {
    const actor = { id: req.user!.id, name: req.user!.name || req.user!.email, email: req.user!.email };
    let result: any;

    const paymentVerification = (parsed.data.razorpayPaymentId && parsed.data.razorpaySignature && (parsed.data.razorpayOrderId || parsed.data.razorpaySubscriptionId))
      ? {
          razorpayOrderId: parsed.data.razorpayOrderId,
          razorpaySubscriptionId: parsed.data.razorpaySubscriptionId,
          razorpayPaymentId: parsed.data.razorpayPaymentId,
          razorpaySignature: parsed.data.razorpaySignature
        }
      : undefined;

    if (parsed.data.sessionId) {
      result = await billingService.confirmCheckout(parsed.data.sessionId, req.orgId!, actor, paymentVerification);
    } else {
      const planId = parsed.data.planId || 'PRO';
      const interval = parsed.data.interval || parsed.data.billingInterval || 'MONTHLY';
      result = await billingService.confirmCheckout(req.orgId!, planId, interval, actor, paymentVerification);
    }

    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({
      success: true,
      subscription: result.subscription,
      invoice: result.invoice,
      ...result,
      overview
    });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to confirm checkout' });
  }
});

// Upgrade plan / interval directly
app.post('/api/v1/billing/upgrade', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  const parsed = ConfirmCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid upgrade payload' });
  }

  try {
    const result = await billingService.confirmCheckout(
      req.orgId!,
      parsed.data.planId,
      parsed.data.interval,
      { id: req.user!.id, name: req.user!.name || req.user!.email, email: req.user!.email }
    );
    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({ success: true, ...result, overview });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to upgrade subscription' });
  }
});

// Safe downgrade implementation
const DowngradeSchema = z.object({
  planId: z.enum(['FREE', 'PRO']),
  interval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']).default('MONTHLY')
});

app.post('/api/v1/billing/downgrade', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  const parsed = DowngradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid downgrade payload' });
  }

  try {
    const subscription = await billingService.downgradeSubscription(
      req.orgId!,
      parsed.data.planId,
      parsed.data.interval,
      { id: req.user!.id, name: req.user!.name || req.user!.email }
    );
    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({ success: true, subscription, overview });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to downgrade subscription' });
  }
});

// Cancel subscription at period end
app.post('/api/v1/billing/cancel', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  try {
    const subscription = await billingService.cancelSubscription(
      req.orgId!,
      { id: req.user!.id, name: req.user!.name || req.user!.email }
    );
    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({ success: true, subscription, overview });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to cancel subscription' });
  }
});

// Resume canceled subscription
app.post('/api/v1/billing/resume', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), async (req: AuthenticatedUserRequest, res) => {
  try {
    const subscription = await billingService.resumeSubscription(
      req.orgId!,
      { id: req.user!.id, name: req.user!.name || req.user!.email }
    );
    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({ success: true, subscription, overview });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to resume subscription' });
  }
});

// List invoices for organization
app.get('/api/v1/billing/invoices', requireUserAuth, requireOrgMembership, requirePermission('billing.read'), (req: AuthenticatedUserRequest, res) => {
  const invoices = store.getInvoices(req.orgId!);
  res.json({ invoices });
});

// Download/View invoice details
app.get('/api/v1/billing/invoices/:id/download', requireUserAuth, requireOrgMembership, requirePermission('billing.read'), (req: AuthenticatedUserRequest, res) => {
  const invoices = store.getInvoices(req.orgId!);
  const invoice = invoices.find((i) => i.id === req.params.id);
  if (!invoice) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  const org = store.getOrganization(req.orgId!);
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html>
  <head>
    <title>Invoice #${invoice.id} - SkyOps</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #0f172a; max-width: 680px; margin: 0 auto; line-height: 1.5; }
      .header { display: flex; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }
      .logo { font-size: 24px; font-weight: bold; color: #0284c7; }
      .badge { display: inline-block; padding: 4px 12px; background: #ecfdf5; color: #047857; font-weight: 600; font-size: 13px; border-radius: 9999px; }
      .table { width: 100%; border-collapse: collapse; margin-top: 30px; }
      .table th, .table td { text-align: left; padding: 12px 8px; border-bottom: 1px solid #f1f5f9; }
      .total { font-size: 18px; font-weight: bold; text-align: right; margin-top: 24px; }
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <div class="logo">SkyOps</div>
        <p style="margin: 4px 0 0; color: #64748b; font-size: 14px;">Kubernetes Observability & Incident Platform</p>
      </div>
      <div style="text-align: right;">
        <h3 style="margin: 0; font-size: 18px;">INVOICE</h3>
        <p style="margin: 4px 0; font-family: monospace; font-size: 13px; color: #475569;">#${invoice.id}</p>
        <span class="badge">${invoice.status}</span>
      </div>
    </div>
    <div style="margin-top: 24px; display: flex; justify-content: space-between; font-size: 14px;">
      <div>
        <strong style="color: #475569;">BILLED TO:</strong><br/>
        <strong>${org?.name || 'SkyOps Workspace'}</strong><br/>
        Org ID: ${req.orgId}
      </div>
      <div style="text-align: right;">
        <strong style="color: #475569;">ISSUE DATE:</strong><br/>
        ${new Date(invoice.issuedAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}<br/>
        <strong>Payment Status:</strong> Paid in Full
      </div>
    </div>
    <table class="table">
      <thead>
        <tr style="background: #f8fafc; font-size: 13px; color: #475569;">
          <th>DESCRIPTION</th>
          <th>DURATION</th>
          <th style="text-align: right;">AMOUNT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>${invoice.description}</strong></td>
          <td>${invoice.billingInterval}</td>
          <td style="text-align: right; font-weight: 600;">₹${invoice.amount.toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>
    <div class="total">
      Total Paid: ₹${invoice.amount.toLocaleString('en-IN')}
    </div>
  </body>
</html>`);
});

// Incoming webhook handler
app.post('/api/v1/billing/webhook', async (req, res) => {
  const signature = (req.headers['x-razorpay-signature'] || req.headers['x-skyops-signature'] || req.headers['stripe-signature'] || '') as string;
  try {
    const rawPayload = JSON.stringify(req.body);
    const result = await billingService.handleWebhook(rawPayload, signature);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Webhook signature or processing error' });
  }
});

// Dev/QA simulation endpoint
app.post('/api/v1/billing/dev/simulate-state', requireUserAuth, requireOrgMembership, requirePermission('billing.manage'), (req: AuthenticatedUserRequest, res) => {
  if (isProduction || !config.ENABLE_DEV_SIMULATION) {
    return res.status(403).json({ error: 'Billing simulation is disabled outside development/test environments.', code: 'SIMULATION_DISABLED' });
  }
  const { state, planId, interval } = req.body;
  if (!state) {
    return res.status(400).json({ error: 'Subscription state is required' });
  }

  try {
    const sub = billingService.simulateSubscriptionState(req.orgId!, state, planId, interval);
    const overview = billingService.getSubscriptionOverview(req.orgId!);
    res.json({ success: true, subscription: sub, overview });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || 'Failed to simulate state' });
  }
});

// --- Development & QA Scenario Simulation (Strictly Protected) ---
app.post('/api/v1/dev/simulate-scenario', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  if (isProduction || !config.ENABLE_DEV_SIMULATION) {
    return res.status(403).json({
      error: 'Forbidden: Development simulation and failure injection endpoints are disabled in production environments.',
      errorDetails: {
        code: 'SIMULATION_DISABLED_IN_PROD',
        message: 'Development simulation and failure injection endpoints are disabled in production environments.'
      }
    });
  }

  const { clusterId, scenario } = req.body;
  if (!clusterId || !scenario) {
    return res.status(400).json({ error: 'clusterId and scenario are required' });
  }

  const result = store.simulateScenario(req.orgId!, clusterId, scenario);
  res.json(result);
});

// ==========================================
// NOTIFICATION SETTINGS & AUDIT ROUTES
// ==========================================
app.get('/api/v1/settings/notifications', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const user = req.user!;
  const settings = store.getUserNotificationSettings(user.id, user.email);
  res.json({
    incidentEmailEnabled: settings.incidentEmailEnabled,
    email: user.email,
    updatedAt: settings.updatedAt,
    sender: incidentNotificationService.getSender()
  });
});

app.put('/api/v1/settings/notifications', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const schema = z.object({
    incidentEmailEnabled: z.boolean()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return sendApiError(res, 400, 'INVALID_REQUEST', 'Field incidentEmailEnabled (boolean) is required');
  }

  const user = req.user!;
  const updated = store.updateUserNotificationSettings(user.id, user.email, parsed.data.incidentEmailEnabled);

  auditService.record({
    orgId: req.orgId!,
    actorId: user.id,
    actorName: user.name,
    actorType: 'USER',
    action: 'integration.notifications_updated',
    resourceType: 'INTEGRATION',
    resourceId: user.id,
    result: 'SUCCESS',
    details: {
      incidentEmailEnabled: updated.incidentEmailEnabled,
      email: user.email
    }
  });

  res.json({
    incidentEmailEnabled: updated.incidentEmailEnabled,
    email: user.email,
    updatedAt: updated.updatedAt,
    sender: incidentNotificationService.getSender()
  });
});

app.post('/api/v1/settings/notifications/test', requireUserAuth, requireOrgMembership, async (req: AuthenticatedUserRequest, res) => {
  const user = req.user!;
  const org = store.getOrg(req.orgId!);
  const orgName = org?.name || 'SkyOps Organization';

  try {
    const result = await incidentNotificationService.sendTestNotification(user.email, orgName, req.orgId!);
    res.json({
      success: result.success,
      messageId: result.messageId,
      error: result.error,
      recipient: user.email,
      sender: incidentNotificationService.getSender(),
      timestamp: result.timestamp
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      error: err?.message || 'Failed to send test notification',
      recipient: user.email,
      sender: incidentNotificationService.getSender()
    });
  }
});

app.get('/api/v1/settings/notifications/deliveries', requireUserAuth, requireOrgMembership, (req: AuthenticatedUserRequest, res) => {
  const user = req.user!;
  const rawDeliveries = incidentNotificationService.getDeliveries(req.orgId!, user.email);
  // Ensure provider details are never exposed to client
  const deliveries = rawDeliveries.map(d => ({
    id: d.id,
    incidentId: d.incidentId,
    recipient: d.recipient,
    subject: d.subject,
    status: d.status,
    timestamp: d.timestamp,
    messageId: d.messageId
  }));
  res.json({ deliveries });
});

// --- API 404 Handler ---
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// --- API Global Error Handler ---
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[SkyOps Server Error]', err);
  if (req.path.startsWith('/api/')) {
    sendApiError(res, 500, 'INTERNAL_SERVER_ERROR', err?.message || 'Internal Server Error');
  } else {
    next(err);
  }
});

// ==========================================
// VITE MIDDLEWARE / SPA STATIC HANDLER
// ==========================================
async function startServer() {
  // Production startup is fail-closed: Firestore must be reachable before
  // accepting traffic. Never boot with an empty in-memory/local store.
  verifyProductionPersistence();
  try {
    await store.initPersistence();
  } catch (err: any) {
    console.error('[SkyOps Server] Fatal persistence initialization failure:', err?.message || err);
    if (isProduction) {
      throw err;
    }
    console.warn('[SkyOps Server] Non-production persistence initialization failed:', err?.message || err);
  }

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

if (process.env.NODE_ENV !== 'test') {
  const shutdown = async () => {
    applicationLogArchive.stop();
    await applicationLogArchive.flushAll();
  };
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  startServer().catch((err) => {
    console.error('Fatal Server Startup Error:', err);
    process.exit(1);
  });
}
