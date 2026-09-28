import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import https from 'https';
import { store } from './store';
import { Role } from '../src/types/index';
import { config, isProduction } from './config';

export interface AuthenticatedUser {
  id: string; // Firebase UID
  email: string;
  name: string;
  emailVerified?: boolean;
}

export interface AuthenticatedUserRequest extends Request {
  user?: AuthenticatedUser;
  orgId?: string;
  userRole?: Role;
}

export interface AuthenticatedAgentRequest extends Request {
  clusterId?: string;
  orgId?: string;
}

// In-memory cache for Google Public Certificates for Firebase Auth ID token verification
let googleCertsCache: { [key: string]: string } = {};
let certsExpiry = 0;

async function fetchGooglePublicCerts(): Promise<{ [key: string]: string }> {
  const now = Date.now();
  if (Object.keys(googleCertsCache).length > 0 && now < certsExpiry) {
    return googleCertsCache;
  }

  return new Promise((resolve, reject) => {
    https.get('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com', (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const certs = JSON.parse(data);
          const cacheControl = res.headers['cache-control'] || '';
          const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
          const maxAgeSeconds = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
          googleCertsCache = certs;
          certsExpiry = Date.now() + maxAgeSeconds * 1000;
          resolve(certs);
        } catch (err) {
          reject(err);
        }
      });
      res.on('error', reject);
    });
  });
}

/**
 * Verify a Firebase ID Token using Google's public certificates or standard claims
 */
export async function verifyFirebaseIdToken(rawToken: string, projectId: string): Promise<AuthenticatedUser> {
  // Demo credentials are permanently disabled in all environments (production & development).
  // Only the test harness with explicit opt-in (NODE_ENV=test and SKYOPS_ALLOW_DEMO_AUTH=true) can mock auth for unit tests.
  if (rawToken.startsWith('sky_demo_') || rawToken.startsWith('demo_')) {
    const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.SKYOPS_TEST_RUN);
    const allowDemo = isTest && (process.env.SKYOPS_ALLOW_DEMO_AUTH === 'true' || process.env.SKYOPS_ALLOW_DEMO_AUTH === '1');

    if (!allowDemo) {
      throw new Error('Demo authentication is disabled');
    }
    const isSkyPrefix = rawToken.startsWith('sky_demo_');
    const parts = rawToken.split('_');
    const offset = isSkyPrefix ? 1 : 0;
    const persona = parts[1 + offset] || 'sre';
    const role = parts[2 + offset] || 'OWNER';
    const email = parts[3 + offset] ? decodeURIComponent(parts[3 + offset]) : 'dhandesaurav52@gmail.com';
    const name = parts[4 + offset] ? decodeURIComponent(parts[4 + offset]) : 'Alex Rivera (Staff SRE)';
    const uid = `demo-${persona}-${Buffer.from(email).toString('hex').substring(0, 8)}`;
    return {
      id: uid,
      email,
      name,
      emailVerified: true
    };
  }

  const decodedUnverified = jwt.decode(rawToken, { complete: true }) as {
    header: { kid: string; alg: string };
    payload: {
      iss: string;
      aud: string;
      sub: string;
      email?: string;
      name?: string;
      email_verified?: boolean;
      user_id?: string;
      exp: number;
    };
  } | null;

  if (!decodedUnverified || !decodedUnverified.header || !decodedUnverified.payload) {
    throw new Error('Malformed or unparseable Firebase ID token');
  }

  const { kid, alg } = decodedUnverified.header;
  const payload = decodedUnverified.payload;

  // Basic claims check (with 60-second clock skew tolerance)
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (payload.exp && nowInSeconds > payload.exp + 60) {
    throw new Error('Firebase ID token has expired');
  }

  // Determine allowed project IDs
  const validProjects = new Set<string>([
    projectId,
    config.FIREBASE_PROJECT_ID,
    'skyops-a1143',
    ...(config.FIREBASE_TRUSTED_PROJECT_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)
  ].filter(Boolean) as string[]);

  const tokenAudience = payload.aud;
  const tokenIssuer = payload.iss;

  // Validate audience matches one of the application's valid projects
  const isAllowedAudience = validProjects.has(tokenAudience);

  if (!isAllowedAudience) {
    throw new Error(`Invalid Firebase token audience: ${tokenAudience}`);
  }

  const expectedIssuer = `https://securetoken.google.com/${tokenAudience}`;
  if (tokenIssuer !== expectedIssuer) {
    throw new Error(`Invalid Firebase token issuer: ${tokenIssuer}`);
  }

  // Cryptographic Signature Verification using Google's public certs
  let certs = await fetchGooglePublicCerts();
  let certificate = certs[kid];
  if (!certificate) {
    // Retry with freshly fetched certs in case of key rotation
    certsExpiry = 0;
    certs = await fetchGooglePublicCerts();
    certificate = certs[kid];
  }
  if (!certificate) throw new Error('Unknown Firebase token signing key');

  jwt.verify(rawToken, certificate, {
    algorithms: ['RS256'],
    issuer: expectedIssuer,
    audience: tokenAudience,
    clockTolerance: 60
  });

  const uid = payload.sub || payload.user_id;
  if (!uid) {
    throw new Error('Token payload missing subject identifier (uid)');
  }

  const email = payload.email || `${uid}@users.skyops.internal`;
  const name = payload.name || email.split('@')[0];

  return {
    id: uid,
    email,
    name,
    emailVerified: payload.email_verified
  };
}

/**
 * Middleware: Require a cryptographically verified user identity.
 */
export async function requireUserAuth(
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const idToken = authHeader.substring(7).trim();
  const projectId = config.FIREBASE_PROJECT_ID || (config.FIREBASE_TRUSTED_PROJECT_IDS || '').split(',')[0]?.trim() || '';

  try {
    const verifiedUser = await verifyFirebaseIdToken(idToken, projectId);
    req.user = verifiedUser;

    // Sync user into store
    store.upsertUser({
      id: verifiedUser.id,
      email: verifiedUser.email,
      name: verifiedUser.name
    });

    next();
  } catch (err: any) {
    console.warn('[SkyOps Auth] ID token verification rejected:', err?.message || err);
    res.status(401).json({ error: 'Invalid or expired authentication token' });
  }
}

/**
 * Middleware: Require Organization Membership & Role Resolution
 */
export async function requireOrgMembership(
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  const requestedOrgId = (req.headers['x-org-id'] as string) || (req.query.orgId as string) || (req.body?.orgId as string);
  let userOrgs = store.getOrganizationsForUser(req.user.id, req.user.email);

  if (userOrgs.length === 0) {
    try {
      const persistedOrgs = await store.getPersistence().getUserOrganizations(req.user.id, req.user.email);
      if (persistedOrgs && persistedOrgs.length > 0) {
        for (const po of persistedOrgs) {
          store.hydrateOrganization(po);
          const members = await store.getPersistence().getOrgMembers(po.id);
          if (members && members.length > 0) {
            store.setOrgMembers(po.id, members);
          }
        }
        userOrgs = store.getOrganizationsForUser(req.user.id, req.user.email);
      }
    } catch (err: any) {
      console.warn('[SkyOps Auth] Notice: Firestore user organizations lookup failed:', err?.message || err);
    }
  }

  if (userOrgs.length === 0) {
    // Auto-bootstrap personal workspace for new tenant
    const userWorkspaceName = req.user.name ? `${req.user.name.split(' ')[0]}'s Workspace` : 'Primary Workspace';
    const newOrg = store.createOrganization(userWorkspaceName, req.user.id, req.user.email, req.user.name);
    req.orgId = newOrg.id;
    req.userRole = 'OWNER';
    return next();
  }

  // Resolve target organization by id, slug, or name
  let targetOrg = requestedOrgId
    ? userOrgs.find(
        (o) =>
          o.id === requestedOrgId ||
          (o.slug && o.slug.toLowerCase() === requestedOrgId.toLowerCase()) ||
          (o.name && o.name.toLowerCase() === requestedOrgId.toLowerCase())
      )
    : userOrgs[0];

  // For /api/v1/auth/session, or if requestedOrgId was not found,
  // fall back to user's first valid organization for session establishment
  const isSessionEndpoint =
    req.path === '/api/v1/auth/session' ||
    req.originalUrl?.includes('/api/v1/auth/session') ||
    req.url?.includes('/api/v1/auth/session');
  if (!targetOrg && (isSessionEndpoint || !requestedOrgId)) {
    targetOrg = userOrgs[0];
  }

  if (!targetOrg) {
    return res.status(403).json({
      error: 'Forbidden: You do not have access to this organization',
      code: 'ORG_ACCESS_DENIED',
      requestedOrgId: requestedOrgId,
      availableOrgs: userOrgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
      message: 'You are not an authorized member of this organization.'
    });
  }

  const targetOrgId = targetOrg.id;
  const access = store.checkUserOrgAccess(req.user.id, targetOrgId, req.user.email);
  if (!access.hasAccess) {
    if (access.status === 'SUSPENDED') {
      return res.status(403).json({
        error: 'Forbidden: Your organization membership has been suspended',
        code: 'MEMBERSHIP_SUSPENDED',
        orgId: targetOrgId
      });
    }
    if (access.status === 'REMOVED') {
      return res.status(403).json({
        error: 'Forbidden: Your organization membership has been revoked',
        code: 'MEMBERSHIP_REVOKED',
        orgId: targetOrgId
      });
    }
    return res.status(403).json({
      error: 'Forbidden: You do not have access to this organization',
      code: 'ORG_ACCESS_DENIED',
      orgId: targetOrgId
    });
  }

  req.orgId = targetOrgId;
  req.userRole = access.role || 'VIEWER';
  next();
}

/**
 * Middleware: Require Minimum Role within Organization (OWNER > ADMIN > OPERATOR / ENGINEER > VIEWER)
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: AuthenticatedUserRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      return res.status(403).json({
        error: `Forbidden: This operation requires one of the following roles: [${allowedRoles.join(', ')}]. Your current role is '${req.userRole || 'NONE'}'.`
      });
    }
    next();
  };
}

export type Permission =
  | 'cluster.read'
  | 'cluster.manage'
  | 'incident.read'
  | 'incident.manage'
  | 'remediation.view'
  | 'remediation.approve'
  | 'remediation.execute'
  | 'policy.manage'
  | 'team.manage'
  | 'member.manage'
  | 'org.manage'
  | 'audit.read'
  | 'billing.read'
  | 'billing.manage'
  | 'integration.manage'
  | 'support.create'
  | 'support.manage';

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: [
    'cluster.read',
    'cluster.manage',
    'incident.read',
    'incident.manage',
    'remediation.view',
    'remediation.approve',
    'remediation.execute',
    'policy.manage',
    'team.manage',
    'member.manage',
    'org.manage',
    'audit.read',
    'billing.read',
    'billing.manage',
    'integration.manage',
    'support.create',
    'support.manage'
  ],
  ADMIN: [
    'cluster.read',
    'cluster.manage',
    'incident.read',
    'incident.manage',
    'remediation.view',
    'remediation.approve',
    'remediation.execute',
    'policy.manage',
    'team.manage',
    'member.manage',
    'org.manage',
    'audit.read',
    'billing.read',
    'billing.manage',
    'integration.manage',
    'support.create',
    'support.manage'
  ],
  OPERATOR: [
    'cluster.read',
    'cluster.manage',
    'incident.read',
    'incident.manage',
    'remediation.view',
    'remediation.approve',
    'remediation.execute',
    'audit.read',
    'billing.read',
    'support.create'
  ],
  ENGINEER: [
    'cluster.read',
    'cluster.manage',
    'incident.read',
    'incident.manage',
    'remediation.view',
    'remediation.approve',
    'remediation.execute',
    'audit.read',
    'billing.read',
    'support.create'
  ],
  VIEWER: [
    'cluster.read',
    'incident.read',
    'remediation.view',
    'audit.read',
    'billing.read',
    'support.create'
  ]
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || [];
  return permissions.includes(permission);
}

/**
 * Middleware: Require Fine-Grained Enterprise Permission(s)
 */
export function requirePermission(required: Permission | Permission[]) {
  const requiredList = Array.isArray(required) ? required : [required];
  return (req: AuthenticatedUserRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.userRole) {
      return res.status(403).json({ error: 'Forbidden: No active organization role resolved' });
    }

    const hasAll = requiredList.every((perm) => hasPermission(req.userRole!, perm));
    if (!hasAll) {
      return res.status(403).json({
        error: `Forbidden: Missing required permission(s): [${requiredList.join(', ')}]. Role '${req.userRole}' does not hold this authorization.`
      });
    }

    next();
  };
}

/**
 * Middleware: Require Valid Kubernetes Agent Authentication
 */
export async function requireAgentAuth(
  req: AuthenticatedAgentRequest,
  res: Response,
  next: NextFunction
): Promise<void | Response> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or malformed Agent Bearer Token in Authorization header'
    });
  }

  const rawToken = authHeader.substring(7).trim();
  let verified = store.authenticateAgentToken(rawToken);
  if (!verified) {
    try {
      verified = await store.authenticateAgentTokenAsync(rawToken);
    } catch {
      // Ignored
    }
  }

  if (!verified) {
    return res.status(403).json({
      error: 'Forbidden: Invalid, revoked, or unassociated Kubernetes Agent token'
    });
  }

  // Agent version compatibility verification
  const agentVersion = (req.headers['x-skyops-agent-version'] as string) || (req.body?.agentVersion as string) || '1.0.0';
  const major = parseInt(agentVersion.split('.')[0], 10) || 1;
  const minor = parseInt(agentVersion.split('.')[1], 10) || 0;

  if (major < 1) {
    res.setHeader('X-SkyOps-Agent-Compatibility', 'UNSUPPORTED');
    return res.status(426).json({
      error: `Upgrade Required: SkyOps Agent v${agentVersion} is deprecated. Minimum required version is v1.0.0.`
    });
  } else if (major === 1 && minor < 2) {
    res.setHeader('X-SkyOps-Agent-Compatibility', 'UPDATE_RECOMMENDED');
  } else {
    res.setHeader('X-SkyOps-Agent-Compatibility', 'SUPPORTED');
  }

  req.clusterId = verified.clusterId;
  req.orgId = verified.orgId;
  next();
}
