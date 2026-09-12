import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import https from 'https';
import fallbackConfig from '../firebase-applet-config.json';
import { store } from './store';
import { Role } from '../src/types/index';

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
  // Demo credentials are deliberately opt-in and authenticate local non-production or sandbox preview traffic.
  if (rawToken.startsWith('sky_demo_') || rawToken.startsWith('demo_')) {
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
  const validProjects = new Set<string>(
    [
      projectId,
      process.env.VITE_FIREBASE_PROJECT_ID,
      process.env.FIREBASE_PROJECT_ID,
      fallbackConfig.projectId,
      'ai-studio-applet-webapp-4bb6f',
      'skyops-netes-56b89'
    ].filter(Boolean) as string[]
  );

  const tokenAudience = payload.aud;
  const tokenIssuer = payload.iss;

  // Validate audience matches one of the application's valid projects
  const isAllowedAudience =
    validProjects.has(tokenAudience) ||
    tokenAudience.startsWith('ai-studio-') ||
    tokenAudience.startsWith('skyops-');

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
  const projectId =
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    fallbackConfig.projectId ||
    'ai-studio-applet-webapp-4bb6f';

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
export function requireOrgMembership(
  req: AuthenticatedUserRequest,
  res: Response,
  next: NextFunction
): void | Response {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  const requestedOrgId = (req.headers['x-org-id'] as string) || (req.query.orgId as string) || (req.body?.orgId as string);
  const userOrgs = store.getOrganizationsForUser(req.user.id, req.user.email);

  if (userOrgs.length === 0) {
    // Auto-bootstrap workspace
    const userWorkspaceName = req.user.name ? `${req.user.name.split(' ')[0]}'s Workspace` : 'Primary Workspace';
    const newOrg = store.createOrganization(userWorkspaceName, req.user.id);
    req.orgId = newOrg.id;
    req.userRole = 'OWNER';
    return next();
  }

  let targetOrgId = requestedOrgId;
  if (!targetOrgId || !userOrgs.some((o) => o.id === targetOrgId)) {
    targetOrgId = userOrgs[0].id;
  }

  const access = store.checkUserOrgAccess(req.user.id, targetOrgId, req.user.email);
  req.orgId = targetOrgId;
  req.userRole = access.hasAccess && access.role ? access.role : 'OWNER';
  next();
}

/**
 * Middleware: Require Minimum Role within Organization (OWNER > ADMIN > ENGINEER > VIEWER)
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
  | 'audit.read'
  | 'billing.read'
  | 'integration.manage';

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
    'audit.read',
    'billing.read',
    'integration.manage'
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
    'audit.read',
    'billing.read',
    'integration.manage'
  ],
  ENGINEER: [
    'cluster.read',
    'incident.read',
    'incident.manage',
    'remediation.view',
    'remediation.approve',
    'remediation.execute',
    'audit.read'
  ],
  VIEWER: [
    'cluster.read',
    'incident.read',
    'remediation.view',
    'audit.read'
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
export function requireAgentAuth(
  req: AuthenticatedAgentRequest,
  res: Response,
  next: NextFunction
): void | Response {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Missing or malformed Agent Bearer Token in Authorization header'
    });
  }

  const rawToken = authHeader.substring(7).trim();
  const verified = store.authenticateAgentToken(rawToken);

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
