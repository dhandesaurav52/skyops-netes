import { FirestoreStore } from './FirestoreStore';
import { InMemoryStore } from './InMemoryStore';
import { IPersistenceStore } from './types';
const fallbackConfig: Record<string, string | undefined> = {};

let storeInstance: IPersistenceStore | null = null;

export interface PersistenceProviderConfig {
  provider: 'firestore' | 'memory';
  projectId?: string;
  databaseId?: string;
}

export function determinePersistenceProvider(): 'firestore' | 'memory' {
  const envProvider = process.env.PERSISTENCE_PROVIDER?.toLowerCase();

  // If in production, firestore is strictly required
  if (process.env.NODE_ENV === 'production') {
    if (envProvider && envProvider !== 'firestore') {
      throw new Error(
        `[Persistence] CRITICAL PRODUCTION ERROR: PERSISTENCE_PROVIDER is set to "${envProvider}", but Production strictly requires "firestore". Local filesystem and in-memory persistence are forbidden in production.`
      );
    }
    return 'firestore';
  }

  // If test environment, default to in-memory unless explicitly overridden
  if (process.env.NODE_ENV === 'test') {
    return envProvider === 'firestore' ? 'firestore' : 'memory';
  }

  // Development: Use firestore by default as authoritative persistence provider unless explicitly set to memory
  if (envProvider === 'memory') {
    return 'memory';
  }
  return 'firestore';
}

export function getPersistenceStore(): IPersistenceStore {
  if (storeInstance) {
    return storeInstance;
  }

  const provider = determinePersistenceProvider();

  if (provider === 'firestore') {
    const projectId =
      process.env.SKYOPS_FIRESTORE_PROJECT_ID ||
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      fallbackConfig.projectId;

    const databaseId =
      process.env.SKYOPS_FIRESTORE_DATABASE_ID ||
      process.env.FIREBASE_DATABASE_ID ||
      process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
      (fallbackConfig as any).firestoreDatabaseId ||
      '(default)';

    if (!projectId) {
      const errorMsg =
        '[Persistence] CRITICAL STARTUP ERROR: Firestore project ID is missing. Ensure SKYOPS_FIRESTORE_PROJECT_ID or FIREBASE_PROJECT_ID is defined.';
      if (process.env.NODE_ENV === 'production') {
        throw new Error(errorMsg);
      }
      console.warn(errorMsg + ' Falling back to InMemoryStore in non-production mode.');
      storeInstance = new InMemoryStore();
      return storeInstance;
    }

    try {
      storeInstance = new FirestoreStore({ projectId, databaseId });
      console.log(`[Persistence] Initialized FirestoreStore (project=${projectId}, database=${databaseId})`);
    } catch (err: any) {
      const message = `[Persistence] Firestore initialization failed: ${err?.message || err}`;
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`${message}. Production will not fall back to in-memory persistence.`);
      }
      console.warn(`${message}. Falling back to InMemoryStore only in non-production mode.`);
      storeInstance = new InMemoryStore();
    }
  } else {
    storeInstance = new InMemoryStore();
  }

  return storeInstance;
}

export function setPersistenceStore(store: IPersistenceStore): void {
  storeInstance = store;
}

export function resetPersistenceStore(): void {
  storeInstance = null;
}

/**
 * Validates that production persistence is correctly configured.
 * Enforces production persistence gates and initializes persistence store.
 */
export function verifyProductionPersistence(): void {
  const isProd = process.env.NODE_ENV === 'production';
  const envProvider = process.env.PERSISTENCE_PROVIDER?.toLowerCase();

  if (isProd && envProvider && envProvider !== 'firestore') {
    throw new Error(
      `[Persistence] CRITICAL PRODUCTION ERROR: PERSISTENCE_PROVIDER is set to "${envProvider}", but Production strictly requires "firestore". Local filesystem and in-memory persistence are forbidden in production.`
    );
  }

  const store = getPersistenceStore();
  // Initialization is performed by server startup and must be awaited there.
  // Do not convert an initialization failure into a successful empty application.
}

export { resolvePersistenceConfig } from '../persistence';
export * from './types';
export * from './InMemoryStore';
export * from './FirestoreStore';
