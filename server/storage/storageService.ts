import crypto from 'crypto';
import {
  StorageCategory,
  StoredArtifact,
  StoredArtifactLifecycleStatus,
  StoredArtifactActor,
  StoredArtifactFilters,
  StorageUsageSummary,
  IStorageDriver,
  StorageValidationError,
  StorageSecurityError
} from './types';
import {
  validateOrgId,
  validateCategory,
  sanitizeFilename,
  validateFileSize,
  validateMimeType,
  computeChecksumSha256,
  buildStoragePath
} from './validation';
import { MemoryStorageDriver } from './drivers/MemoryStorageDriver';
import { CloudStorageDriver } from './drivers/CloudStorageDriver';
import { resolveStorageBucket } from '../config';
import { getPersistenceStore } from '../persistence/index';
import { auditService } from '../audit';
import { PaginatedResult } from '../repositories/types';

export interface UploadArtifactParams {
  orgId: string;
  category: StorageCategory;
  filename: string;
  buffer: Buffer;
  mimeType: string;
  actor: StoredArtifactActor;
  subpath?: string;
  tags?: string[];
  metadata?: Record<string, string | number | boolean>;
  retentionDays?: number;
}

export interface StorageServiceOptions {
  driver?: IStorageDriver;
  bucketName?: string;
}

export class StorageService {
  private driver: IStorageDriver;
  private bucketName: string;

  constructor(options?: StorageServiceOptions) {
    this.bucketName = options?.bucketName || resolveStorageBucket();

    if (options?.driver) {
      this.driver = options.driver;
    } else if (process.env.NODE_ENV === 'test') {
      this.driver = new MemoryStorageDriver(this.bucketName);
    } else {
      this.driver = new CloudStorageDriver({
        bucketName: this.bucketName,
        useFallbackOnFailure: false
      });
    }
  }

  public getBucketName(): string {
    return this.bucketName;
  }

  public getDriverName(): string {
    return this.driver.driverName;
  }

  public setDriver(driver: IStorageDriver): void {
    this.driver = driver;
  }

  /**
   * Securely uploads and records an artifact within tenant-isolated storage boundaries.
   */
  public async uploadArtifact(params: UploadArtifactParams): Promise<StoredArtifact> {
    const { orgId, category, filename, buffer, mimeType, actor, subpath, tags, metadata, retentionDays } = params;

    // 1. Strict Parameter Validation
    validateOrgId(orgId);
    const validCategory = validateCategory(category);
    const sanitizedName = sanitizeFilename(filename);
    validateFileSize(buffer, validCategory);
    const validMimeType = validateMimeType(mimeType);

    // 2. Cryptographic Integrity Checksum
    const checksum = computeChecksumSha256(buffer);

    // 3. Unique Artifact ID and Storage Path Construction
    const artifactId = `art_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const cleanSubpath = subpath ? subpath.trim() : `${Date.now()}_${sanitizedName}`;
    const storagePath = buildStoragePath(orgId, validCategory, cleanSubpath);

    const now = Date.now();
    const expiresAt = retentionDays && retentionDays > 0 ? now + retentionDays * 24 * 60 * 60 * 1000 : undefined;

    // 4. Physical Storage Write
    const uploadResult = await this.driver.upload(storagePath, buffer, {
      orgId,
      category: validCategory,
      filename: sanitizedName,
      contentType: validMimeType,
      sizeBytes: buffer.length,
      checksumSha256: checksum,
      uploadedBy: actor,
      customMetadata: metadata,
      retentionDays
    });

    // 5. Build StoredArtifact Entity
    const artifact: StoredArtifact = {
      id: artifactId,
      orgId,
      category: validCategory,
      storagePath,
      storageBucket: this.bucketName,
      filename: sanitizedName,
      sizeBytes: buffer.length,
      mimeType: validMimeType,
      checksumSha256: checksum,
      uploadedBy: actor,
      createdAt: now,
      updatedAt: now,
      expiresAt,
      lifecycleStatus: 'ACTIVE',
      tags: tags || [],
      metadata: metadata || {},
      downloadUrl: uploadResult.publicUrl
    };

    // 6. Persist to Firestore / Persistence Store
    const store = getPersistenceStore();
    await store.saveStoredArtifact(artifact);

    // 7. Record Immutable Enterprise Audit Entry
    try {
      auditService.record({
        orgId,
        actorId: actor.id,
        actorName: actor.name || actor.email || 'Unknown',
        actorType: actor.actorType as any,
        action: 'STORAGE_UPLOAD',
        resourceType: 'ARTIFACT',
        resourceId: artifactId,
        result: 'SUCCESS',
        details: {
          filename: sanitizedName,
          category: validCategory,
          sizeBytes: buffer.length,
          mimeType: validMimeType,
          checksumSha256: checksum,
          storagePath
        }
      });
    } catch (auditErr: any) {
      console.warn(`[StorageService] Warning: Could not record audit event: ${auditErr?.message || auditErr}`);
    }

    return artifact;
  }

  /**
   * Retrieves artifact metadata with strict tenant boundary enforcement.
   */
  public async getArtifact(orgId: string, artifactId: string): Promise<StoredArtifact | null> {
    validateOrgId(orgId);
    const store = getPersistenceStore();
    const artifact = await store.getStoredArtifact(orgId, artifactId);
    if (!artifact) return null;

    if (artifact.orgId !== orgId) {
      throw new StorageSecurityError(`Cross-tenant storage access attempt rejected`);
    }

    return artifact;
  }

  /**
   * Securely downloads an artifact buffer, verifying tenant isolation and cryptographic integrity.
   */
  public async downloadArtifact(
    orgId: string,
    artifactId: string,
    actor?: StoredArtifactActor
  ): Promise<{ artifact: StoredArtifact; buffer: Buffer }> {
    validateOrgId(orgId);
    const artifact = await this.getArtifact(orgId, artifactId);

    if (!artifact) {
      throw new StorageValidationError(`Artifact "${artifactId}" not found in organization`, 'NOT_FOUND');
    }

    if (artifact.lifecycleStatus === 'DELETED') {
      throw new StorageValidationError(`Artifact "${artifactId}" has been deleted`, 'ARTIFACT_DELETED');
    }

    // Physical Storage Read
    const buffer = await this.driver.download(artifact.storagePath);

    // Cryptographic Checksum Verification
    const actualChecksum = computeChecksumSha256(buffer);
    if (actualChecksum !== artifact.checksumSha256) {
      throw new StorageSecurityError(
        `Artifact cryptographic checksum mismatch! Expected ${artifact.checksumSha256} but found ${actualChecksum}. File integrity is compromised.`
      );
    }

    // Record Download Audit Event
    if (actor) {
      try {
        auditService.record({
          orgId,
          actorId: actor.id,
          actorName: actor.name || actor.email || 'Unknown',
          actorType: actor.actorType as any,
          action: 'STORAGE_DOWNLOAD',
          resourceType: 'ARTIFACT',
          resourceId: artifactId,
          result: 'SUCCESS',
          details: {
            filename: artifact.filename,
            category: artifact.category,
            sizeBytes: buffer.length
          }
        });
      } catch (auditErr: any) {
        console.warn(`[StorageService] Warning: Could not record download audit: ${auditErr?.message || auditErr}`);
      }
    }

    return { artifact, buffer };
  }

  /**
   * Lists stored artifacts for a tenant with optional filtering.
   */
  public async listArtifacts(
    orgId: string,
    filters?: StoredArtifactFilters
  ): Promise<PaginatedResult<StoredArtifact>> {
    validateOrgId(orgId);
    const store = getPersistenceStore();
    return store.listStoredArtifacts(orgId, filters);
  }

  /**
   * Deletes an artifact. Prohibits deleting immutable audit exports.
   */
  public async deleteArtifact(
    orgId: string,
    artifactId: string,
    actor?: StoredArtifactActor,
    hardDelete: boolean = false
  ): Promise<boolean> {
    validateOrgId(orgId);
    const artifact = await this.getArtifact(orgId, artifactId);

    if (!artifact) {
      return false;
    }

    // Audit Ledger Exports are strictly immutable
    if (artifact.category === 'audit-exports') {
      throw new StorageSecurityError('Audit ledger export artifacts are strictly immutable and cannot be deleted');
    }

    const store = getPersistenceStore();

    if (hardDelete) {
      await this.driver.delete(artifact.storagePath);
      await store.deleteStoredArtifact(orgId, artifactId);
    } else {
      await store.updateStoredArtifactStatus(orgId, artifactId, 'DELETED');
    }

    if (actor) {
      try {
        auditService.record({
          orgId,
          actorId: actor.id,
          actorName: actor.name || actor.email || 'Unknown',
          actorType: actor.actorType as any,
          action: 'STORAGE_DELETE',
          resourceType: 'ARTIFACT',
          resourceId: artifactId,
          result: 'SUCCESS',
          details: {
            filename: artifact.filename,
            category: artifact.category,
            hardDelete
          }
        });
      } catch (auditErr: any) {
        console.warn(`[StorageService] Warning: Could not record delete audit: ${auditErr?.message || auditErr}`);
      }
    }

    return true;
  }

  /**
   * Transitions an artifact to ARCHIVED state.
   */
  public async archiveArtifact(
    orgId: string,
    artifactId: string,
    actor?: StoredArtifactActor
  ): Promise<StoredArtifact | null> {
    validateOrgId(orgId);
    const artifact = await this.getArtifact(orgId, artifactId);
    if (!artifact) return null;

    const store = getPersistenceStore();
    const updated = await store.updateStoredArtifactStatus(orgId, artifactId, 'ARCHIVED');

    if (actor) {
      try {
        auditService.record({
          orgId,
          actorId: actor.id,
          actorName: actor.name || actor.email || 'Unknown',
          actorType: actor.actorType as any,
          action: 'STORAGE_ARCHIVE',
          resourceType: 'ARTIFACT',
          resourceId: artifactId,
          result: 'SUCCESS',
          details: { filename: artifact.filename }
        });
      } catch (err) {
        // Ignored
      }
    }

    return updated;
  }

  /**
   * Computes aggregated storage usage breakdown for a tenant.
   */
  public async getStorageUsageSummary(orgId: string): Promise<StorageUsageSummary> {
    validateOrgId(orgId);
    const store = getPersistenceStore();
    return store.getStorageUsageSummary(orgId);
  }

  /**
   * Helper: Exports organization's audit ledger directly into immutable storage.
   */
  public async exportAuditToStorage(
    orgId: string,
    actor: StoredArtifactActor,
    format: 'json' | 'csv' = 'json'
  ): Promise<StoredArtifact> {
    validateOrgId(orgId);

    const timestamp = Date.now();
    const filename = `audit_ledger_export_${orgId}_${timestamp}.${format}`;
    let content: string;
    let mimeType: string;

    if (format === 'csv') {
      content = auditService.exportCsv({ orgId });
      mimeType = 'text/csv';
    } else {
      const records = auditService.exportJson({ orgId });
      content = JSON.stringify(records, null, 2);
      mimeType = 'application/json';
    }

    const buffer = Buffer.from(content, 'utf-8');

    return this.uploadArtifact({
      orgId,
      category: 'audit-exports',
      filename,
      buffer,
      mimeType,
      actor,
      tags: ['audit', 'compliance', 'ledger-export', format],
      metadata: {
        exportedAt: timestamp,
        format,
        exportSource: 'auditService'
      }
    });
  }
}

export const storageService = new StorageService();
