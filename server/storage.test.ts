import test, { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  StorageService,
  MemoryStorageDriver,
  StorageValidationError,
  StorageSecurityError,
  sanitizeFilename,
  validateOrgId,
  validateCategory,
  validateFileSize,
  validateMimeType,
  computeChecksumSha256,
  buildStoragePath,
  parseTenantFromPath
} from './storage';
import { resolveStorageBucket } from './config';
import { getPersistenceStore } from './persistence/index';
import { auditService } from './audit';

describe('SkyOps Firebase Cloud Storage Foundation', () => {
  let storageService: StorageService;
  let memoryDriver: MemoryStorageDriver;
  const orgA = 'org-acme-corp';
  const orgB = 'org-globex-inc';
  const actor = {
    id: 'usr-sre-alice',
    email: 'alice@acme.com',
    name: 'Alice Admin',
    actorType: 'HUMAN' as const
  };

  beforeEach(() => {
    memoryDriver = new MemoryStorageDriver('skyops-a1143.firebasestorage.app');
    storageService = new StorageService({
      driver: memoryDriver,
      bucketName: 'skyops-a1143.firebasestorage.app'
    });
  });

  describe('Configuration & Bucket Resolution', () => {
    it('resolves canonical bucket name and strips gs:// protocol scheme', () => {
      const bucket = resolveStorageBucket();
      assert.ok(bucket);
      assert.ok(!bucket.includes('gs://'));
      assert.equal(bucket, 'skyops-a1143.firebasestorage.app');
    });

    it('initializes StorageService with canonical bucket', () => {
      assert.equal(storageService.getBucketName(), 'skyops-a1143.firebasestorage.app');
      assert.equal(storageService.getDriverName(), 'memory');
    });
  });

  describe('Security Validation & Path Isolation', () => {
    it('constructs strict tenant-scoped paths', () => {
      const path = buildStoragePath(orgA, 'incident-artifacts', 'dump.json');
      assert.equal(path, 'tenants/org-acme-corp/incident-artifacts/dump.json');
    });

    it('parses and validates tenant org from canonical storage path', () => {
      const parsed = parseTenantFromPath('tenants/org-acme-corp/remediation-manifests/v1/patch.yaml');
      assert.equal(parsed.orgId, orgA);
      assert.equal(parsed.category, 'remediation-manifests');
      assert.equal(parsed.subpath, 'v1/patch.yaml');
    });

    it('rejects path traversal attacks in filenames', () => {
      assert.throws(() => sanitizeFilename('../../etc/passwd'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('..\\windows\\system32'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('%2e%2e%2fsecret.key'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('payload\0.png'), StorageSecurityError);
    });

    it('rejects forbidden dangerous executable file extensions', () => {
      assert.throws(() => sanitizeFilename('exploit.exe'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('malware.sh'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('script.bat'), StorageSecurityError);
      assert.throws(() => sanitizeFilename('installer.msi'), StorageSecurityError);
    });

    it('rejects invalid or traversal organization IDs', () => {
      assert.throws(() => validateOrgId('../evil-tenant'), StorageSecurityError);
      assert.throws(() => validateOrgId('org/sub/bad'), StorageSecurityError);
      assert.throws(() => validateOrgId(''), StorageSecurityError);
    });

    it('enforces category allowlist', () => {
      assert.equal(validateCategory('audit-exports'), 'audit-exports');
      assert.equal(validateCategory('remediation-manifests'), 'remediation-manifests');
      assert.throws(() => validateCategory('unauthorized-folder' as any), StorageValidationError);
    });

    it('enforces MIME type allowlist', () => {
      assert.equal(validateMimeType('application/json'), 'application/json');
      assert.equal(validateMimeType('text/plain; charset=utf-8'), 'text/plain');
      assert.equal(validateMimeType('application/x-yaml'), 'application/x-yaml');
      assert.throws(() => validateMimeType('application/x-msdownload'), StorageValidationError);
    });

    it('enforces maximum size limits per category', () => {
      const smallBuffer = Buffer.alloc(1024, 'x'); // 1KB
      assert.doesNotThrow(() => validateFileSize(smallBuffer, 'remediation-manifests'));

      const emptyBuffer = Buffer.alloc(0);
      assert.throws(() => validateFileSize(emptyBuffer, 'remediation-manifests'), StorageValidationError);

      const oversizedManifest = Buffer.alloc(6 * 1024 * 1024, 'a'); // 6MB > 5MB limit
      assert.throws(() => validateFileSize(oversizedManifest, 'remediation-manifests'), StorageValidationError);
    });
  });

  describe('Tenant-Isolated Upload, Checksum & Download Flow', () => {
    it('uploads an artifact, generates SHA-256, and stores in tenant boundary', async () => {
      const content = JSON.stringify({ cluster: 'prod-us-east-1', status: 'CRASH_LOOP' });
      const buffer = Buffer.from(content, 'utf-8');
      const expectedChecksum = computeChecksumSha256(buffer);

      const artifact = await storageService.uploadArtifact({
        orgId: orgA,
        category: 'incident-artifacts',
        filename: 'diagnostics.json',
        buffer,
        mimeType: 'application/json',
        actor,
        tags: ['incident', 'prod-crash']
      });

      assert.match(artifact.id, /^art_/);
      assert.equal(artifact.orgId, orgA);
      assert.equal(artifact.category, 'incident-artifacts');
      assert.ok(artifact.storagePath.includes(`tenants/${orgA}/incident-artifacts/`));
      assert.equal(artifact.storageBucket, 'skyops-a1143.firebasestorage.app');
      assert.equal(artifact.checksumSha256, expectedChecksum);
      assert.equal(artifact.sizeBytes, buffer.length);
      assert.equal(artifact.lifecycleStatus, 'ACTIVE');

      // Verify persisted metadata in persistence store
      const retrieved = await storageService.getArtifact(orgA, artifact.id);
      assert.ok(retrieved !== null);
      assert.equal(retrieved?.id, artifact.id);

      // Verify download and cryptographic integrity check
      const downloadResult = await storageService.downloadArtifact(orgA, artifact.id, actor);
      assert.equal(downloadResult.buffer.toString('utf-8'), content);
      assert.equal(downloadResult.artifact.id, artifact.id);
    });

    it('enforces strict cross-tenant isolation: Tenant B cannot access Tenant A artifacts', async () => {
      const content = Buffer.from('Cluster snapshot data', 'utf-8');
      const artifactA = await storageService.uploadArtifact({
        orgId: orgA,
        category: 'cluster-snapshots',
        filename: 'cluster-nodes.txt',
        buffer: content,
        mimeType: 'text/plain',
        actor
      });

      // Tenant B queries Tenant A artifact ID -> Expect 404 or Security Error
      const crossTenantGet = await storageService.getArtifact(orgB, artifactA.id);
      assert.equal(crossTenantGet, null);

      // Tenant B download attempt -> Fails
      await assert.rejects(async () => {
        await storageService.downloadArtifact(orgB, artifactA.id);
      });

      // Tenant B delete attempt -> Fails
      const deleteResult = await storageService.deleteArtifact(orgB, artifactA.id);
      assert.equal(deleteResult, false);
    });

    it('enforces audit exports immutability: cannot be deleted', async () => {
      const auditPayload = Buffer.from('Immutable Audit Log Entries', 'utf-8');
      const artifact = await storageService.uploadArtifact({
        orgId: orgA,
        category: 'audit-exports',
        filename: 'compliance_report.txt',
        buffer: auditPayload,
        mimeType: 'text/plain',
        actor
      });

      // Attempting to delete an audit-export must throw StorageSecurityError
      await assert.rejects(async () => {
        await storageService.deleteArtifact(orgA, artifact.id);
      }, StorageSecurityError);
    });

    it('allows soft and hard deletion for mutable categories', async () => {
      const buffer = Buffer.from('temporary manifest', 'utf-8');
      const artifact = await storageService.uploadArtifact({
        orgId: orgA,
        category: 'remediation-manifests',
        filename: 'hotfix.yaml',
        buffer,
        mimeType: 'application/x-yaml',
        actor
      });

      // Soft delete
      const softDeleted = await storageService.deleteArtifact(orgA, artifact.id, actor, false);
      assert.equal(softDeleted, true);

      const statusAfterSoft = await storageService.getArtifact(orgA, artifact.id);
      assert.equal(statusAfterSoft?.lifecycleStatus, 'DELETED');

      // Attempting download of deleted artifact throws validation error
      await assert.rejects(async () => {
        await storageService.downloadArtifact(orgA, artifact.id);
      }, StorageValidationError);

      // Hard delete
      const hardDeleted = await storageService.deleteArtifact(orgA, artifact.id, actor, true);
      assert.equal(hardDeleted, true);
      const afterHard = await storageService.getArtifact(orgA, artifact.id);
      assert.equal(afterHard, null);
    });

    it('calculates storage usage summary broken down by category', async () => {
      const orgUsageId = `org-usage-${Date.now()}`;
      await storageService.uploadArtifact({
        orgId: orgUsageId,
        category: 'remediation-manifests',
        filename: 'patch1.yaml',
        buffer: Buffer.alloc(1000, 'a'),
        mimeType: 'text/yaml',
        actor
      });

      await storageService.uploadArtifact({
        orgId: orgUsageId,
        category: 'ai-diagnostics',
        filename: 'ai-log.json',
        buffer: Buffer.alloc(2500, 'b'),
        mimeType: 'application/json',
        actor
      });

      const summary = await storageService.getStorageUsageSummary(orgUsageId);
      assert.equal(summary.orgId, orgUsageId);
      assert.equal(summary.totalArtifactsCount, 2);
      assert.equal(summary.totalSizeBytes, 3500);
      assert.equal(summary.categoryBreakdown['remediation-manifests'].sizeBytes, 1000);
      assert.equal(summary.categoryBreakdown['remediation-manifests'].count, 1);
      assert.equal(summary.categoryBreakdown['ai-diagnostics'].sizeBytes, 2500);
      assert.equal(summary.categoryBreakdown['ai-diagnostics'].count, 1);
    });

    it('records immutable audit events for storage operations', async () => {
      const orgAuditTest = `org-aud-${Date.now()}`;
      const buffer = Buffer.from('test audit payload', 'utf-8');

      const artifact = await storageService.uploadArtifact({
        orgId: orgAuditTest,
        category: 'incident-artifacts',
        filename: 'artifact-audit.txt',
        buffer,
        mimeType: 'text/plain',
        actor
      });

      // Download it
      await storageService.downloadArtifact(orgAuditTest, artifact.id, actor);

      // Check audit entries recorded
      const auditEvents = auditService.query({ orgId: orgAuditTest });
      assert.ok(auditEvents.total >= 2);

      const uploadEvent = auditEvents.items.find((e) => e.action === 'STORAGE_UPLOAD');
      assert.ok(uploadEvent);
      assert.equal(uploadEvent?.resourceId, artifact.id);
      assert.equal(uploadEvent?.actorId, actor.id);

      const downloadEvent = auditEvents.items.find((e) => e.action === 'STORAGE_DOWNLOAD');
      assert.ok(downloadEvent);
      assert.equal(downloadEvent?.resourceId, artifact.id);
    });

    it('exports audit ledger directly to immutable storage artifact', async () => {
      const orgAuditExport = `org-export-${Date.now()}`;

      // Create dummy audit event
      auditService.record({
        orgId: orgAuditExport,
        actorId: actor.id,
        actorName: actor.name,
        actorType: 'HUMAN',
        action: 'TEST_ACTION',
        resourceType: 'CLUSTER',
        resourceId: 'cluster-1',
        result: 'SUCCESS'
      });

      const exportArtifact = await storageService.exportAuditToStorage(orgAuditExport, actor, 'json');
      assert.equal(exportArtifact.category, 'audit-exports');
      assert.equal(exportArtifact.mimeType, 'application/json');
      assert.ok(exportArtifact.sizeBytes > 0);

      const download = await storageService.downloadArtifact(orgAuditExport, exportArtifact.id, actor);
      const exportedJson = JSON.parse(download.buffer.toString('utf-8'));
      assert.ok(Array.isArray(exportedJson));
      assert.ok(exportedJson.length > 0);
    });
  });
});
