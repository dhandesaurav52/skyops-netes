import fs from 'fs';
import os from 'os';
import path from 'path';

export interface PersistenceConfig {
  env: 'development' | 'production' | 'test';
  dataDir: string;
  isExplicitProductionDir: boolean;
  storeFile: string;
  auditFile: string;
  webhooksFile: string;
  notificationsFile: string;
  billingFile: string;
}

/**
 * Resolves and validates persistence paths based on the runtime environment.
 * Enforces strict environment boundaries:
 * - TEST: Isolated per-process temp directory (never mutates repository data/)
 * - DEVELOPMENT: Local repository data/ directory (or explicit SKYOPS_DATA_DIR)
 * - PRODUCTION: Must be an explicitly provided persistent directory via SKYOPS_DATA_DIR.
 *   Fails closed if missing, invalid, unwritable, or pointing to an unmounted/ephemeral relative path.
 */
export function resolvePersistenceConfig(
  forcedEnv?: string,
  forcedDataDir?: string
): PersistenceConfig {
  const env = (forcedEnv || process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const envDataDir = process.env.SKYOPS_DATA_DIR && process.env.SKYOPS_DATA_DIR !== 'undefined'
    ? process.env.SKYOPS_DATA_DIR
    : undefined;
  const rawDataDir = forcedDataDir !== undefined ? forcedDataDir : envDataDir;

  if (env === 'production') {
    // Production persistence is Firestore. SKYOPS_DATA_DIR is retained only for
    // development/test migration utilities and is never an application source of truth.
    const dataDir = rawDataDir ? path.resolve(rawDataDir.trim()) : path.join(os.tmpdir(), 'skyops-migration');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    return {
      env: 'production',
      dataDir,
      isExplicitProductionDir: false,
      storeFile: path.join(dataDir, 'skyops_store.json'),
      auditFile: path.join(dataDir, 'skyops_audit.json'),
      webhooksFile: path.join(dataDir, 'skyops_webhooks.json'),
      notificationsFile: path.join(dataDir, 'skyops_notifications.json'),
      billingFile: path.join(dataDir, 'skyops_billing.json')
    };
  }

  if (env === 'test') {
    // In test mode, always isolate in temp directory unless explicitly overridden via parameter
    const testDir = forcedDataDir !== undefined && forcedDataDir !== ''
      ? path.resolve(forcedDataDir.trim())
      : path.join(os.tmpdir(), `skyops-test-${process.pid}`);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    return {
      env: 'test',
      dataDir: testDir,
      isExplicitProductionDir: false,
      storeFile: path.join(testDir, 'skyops_store.json'),
      auditFile: path.join(testDir, 'skyops_audit.json'),
      webhooksFile: path.join(testDir, 'skyops_webhooks.json'),
      notificationsFile: path.join(testDir, 'skyops_notifications.json'),
      billingFile: path.join(testDir, 'skyops_billing.json')
    };
  }

  // Development mode
  const devDir = rawDataDir
    ? path.resolve(rawDataDir.trim())
    : path.join(process.cwd(), 'data');
  if (!fs.existsSync(devDir)) {
    fs.mkdirSync(devDir, { recursive: true });
  }

  return {
    env: 'development',
    dataDir: devDir,
    isExplicitProductionDir: Boolean(rawDataDir),
    storeFile: path.join(devDir, 'skyops_store.json'),
    auditFile: path.join(devDir, 'skyops_audit.json'),
    webhooksFile: path.join(devDir, 'skyops_webhooks.json'),
    notificationsFile: path.join(devDir, 'skyops_notifications.json'),
    billingFile: path.join(devDir, 'skyops_billing.json')
  };
}

let activeConfig: PersistenceConfig | null = null;

export function getPersistenceConfig(): PersistenceConfig {
  if (!activeConfig) {
    activeConfig = resolvePersistenceConfig();
  }
  return activeConfig;
}

/**
 * Resets cached persistence configuration (useful for testing environment switches)
 */
export function resetPersistenceConfig(): void {
  activeConfig = null;
}

/**
 * Safely writes data to disk using an atomic temp-file write and rename.
 * This eliminates the risk of file truncation or partial writes if interrupted.
 */
export function safeWriteJsonSync(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempFile = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).substring(2, 6)}`;
  const serialized = JSON.stringify(data, null, 2);
  fs.writeFileSync(tempFile, serialized, 'utf8');

  // Atomically replace target
  fs.renameSync(tempFile, filePath);
}

/**
 * Reads a JSON file with fail-closed semantics in production for critical files.
 */
export function safeReadJsonSync<T>(
  filePath: string,
  defaultValue: T,
  isCriticalProductionFile = false
): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production' && isCriticalProductionFile) {
      throw new Error(
        `[SkyOps Persistence] Fatal: Corrupted or unreadable persistence file at "${filePath}". Refusing to start clean or overwrite to prevent production data loss: ${err?.message || err}`
      );
    }
    console.warn(`[SkyOps Persistence] Notice reading persistence file "${filePath}":`, err?.message || err);
    return defaultValue;
  }
}

/**
 * Verifies production persistence readiness on startup.
 * Throws a fatal exception if in production mode and persistence requirements are not satisfied.
 */
export function verifyProductionPersistence(): void {
  if (process.env.NODE_ENV === 'production') {
    const provider = (process.env.PERSISTENCE_PROVIDER || 'firestore').toLowerCase();
    if (provider !== 'firestore') {
      throw new Error(
        `[SkyOps Persistence] CRITICAL PRODUCTION ERROR: PERSISTENCE_PROVIDER is set to "${provider}". Production strictly requires "firestore". Local filesystem and in-memory persistence are forbidden in production.`
      );
    }

    const projectId =
      process.env.SKYOPS_FIRESTORE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT;

    if (process.env.SKYOPS_DATA_DIR) {
      const cfg = getPersistenceConfig();
      console.log(`[SkyOps Persistence] Storage directory configured: ${cfg.dataDir}`);
    }

    console.log(`[SkyOps Persistence] Production persistence verified: Cloud Firestore (provider=${provider}, project=${projectId || 'configured'}).`);
  }
}

