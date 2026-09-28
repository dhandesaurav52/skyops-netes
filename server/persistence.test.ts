import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  resolvePersistenceConfig,
  safeWriteJsonSync,
  safeReadJsonSync,
  getPersistenceConfig,
  resetPersistenceConfig,
  verifyProductionPersistence
} from './persistence';
import { DataStore } from './store';
import { auditService } from './audit';
import { webhookService } from './integrations/webhooks';
import { incidentNotificationService } from './notifications/notificationService';

test('SkyOps Production Persistence Architecture & Isolation Gate', async (t) => {
  await t.test('Production Persistence Requirements: Firestore is authoritative', () => {
    const cfg = resolvePersistenceConfig('production');
    assert.equal(cfg.env, 'production');
    assert.equal(cfg.isExplicitProductionDir, false);
    assert.ok(cfg.dataDir.includes(os.tmpdir()));
  });

  await t.test('Production Persistence: SKYOPS_DATA_DIR is not required', () => {
    const origDataDir = process.env.SKYOPS_DATA_DIR;
    try {
      delete process.env.SKYOPS_DATA_DIR;
      resetPersistenceConfig();
      const cfg = resolvePersistenceConfig('production');
      assert.equal(cfg.env, 'production');
      assert.equal(cfg.isExplicitProductionDir, false);
    } finally {
      if (origDataDir !== undefined) process.env.SKYOPS_DATA_DIR = origDataDir;
      else delete process.env.SKYOPS_DATA_DIR;
      resetPersistenceConfig();
    }
  });

  await t.test('Test Environment Isolation: guarantees test storage never touches repository data/', () => {
    const testConfig = resolvePersistenceConfig('test');
    assert.equal(testConfig.env, 'test');
    assert.ok(testConfig.dataDir.includes(os.tmpdir()));
    assert.equal(testConfig.isExplicitProductionDir, false);
    assert.ok(!testConfig.storeFile.startsWith(path.join(process.cwd(), 'data')));
  });

  await t.test('Development Environment Default: falls back cleanly to data/ directory', () => {
    const devConfig = resolvePersistenceConfig('development');
    assert.equal(devConfig.env, 'development');
    assert.equal(devConfig.dataDir, path.join(process.cwd(), 'data'));
    assert.equal(devConfig.storeFile, path.join(process.cwd(), 'data', 'skyops_store.json'));
  });

  await t.test('Atomic Persistence: safeWriteJsonSync prevents torn or partial writes', () => {
    const testFile = path.join(os.tmpdir(), `skyops-atomic-test-${Date.now()}.json`);
    const payload = { test: true, timestamp: Date.now(), items: [1, 2, 3] };

    safeWriteJsonSync(testFile, payload);
    assert.ok(fs.existsSync(testFile));

    const read = JSON.parse(fs.readFileSync(testFile, 'utf8'));
    assert.deepEqual(read, payload);

    // Ensure no orphan temporary files remain
    const dir = path.dirname(testFile);
    const orphans = fs.readdirSync(dir).filter(f => f.includes(`${path.basename(testFile)}.tmp`));
    assert.equal(orphans.length, 0);

    fs.unlinkSync(testFile);
  });

  await t.test('Safe JSON Read: handles missing files with default fallback', () => {
    const nonExistent = path.join(os.tmpdir(), `non-existent-${Date.now()}.json`);
    const defaultData = { fallback: true };

    const result = safeReadJsonSync(nonExistent, defaultData, false);
    assert.deepEqual(result, defaultData);
  });

  await t.test('Fail-Closed Semantics: safeReadJsonSync refuses to overwrite corrupted production file', () => {
    const corruptFile = path.join(os.tmpdir(), `corrupt-prod-${Date.now()}.json`);
    fs.writeFileSync(corruptFile, '{"broken_json": INVALID', 'utf8');

    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(
        () => {
          safeReadJsonSync(corruptFile, {}, true);
        },
        (err: any) => {
          return err.message.includes('Refusing to start clean or overwrite');
        }
      );
    } finally {
      process.env.NODE_ENV = origEnv;
      if (fs.existsSync(corruptFile)) {
        fs.unlinkSync(corruptFile);
      }
    }
  });



  await t.test('Services utilize centralized persistence paths', () => {
    const storePath = (new DataStore() as any).getStoragePath();
    assert.ok(storePath);
    assert.ok(!storePath.includes('undefined'));

    const auditPath = auditService.getDataFilePath();
    assert.ok(auditPath);

    const webhookPath = webhookService.getDataFilePath();
    assert.ok(webhookPath);

    const notificationPath = incidentNotificationService.getStoragePath();
    assert.ok(notificationPath);
  });
});
