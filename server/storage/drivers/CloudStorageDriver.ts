import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import {
  IStorageDriver,
  StorageObjectMetadata,
  StorageUploadResult
} from '../types';

export interface CloudStorageConfig {
  bucketName: string;
  projectId?: string;
  apiKey?: string;
  accessToken?: string;
  /**
   * Kept for backwards-compatible constructor calls, but ignored.
   * Production storage must never fall back to an in-memory copy.
   */
  useFallbackOnFailure?: boolean;
}

/**
 * Durable Firebase/Google Cloud Storage driver.
 *
 * The Admin SDK uses server credentials and writes directly to the configured
 * bucket. There is intentionally no memory or local fallback: a failed cloud
 * operation is surfaced to the caller.
 */
export class CloudStorageDriver implements IStorageDriver {
  public readonly driverName = 'firebase-cloud-storage';
  private bucketName: string;
  private bucket: any;

  constructor(config: CloudStorageConfig) {
    this.bucketName = config.bucketName.replace(/^gs:\/\//, '').trim();
    if (!this.bucketName) throw new Error('[CloudStorageDriver] Storage bucket is required');

    const app = getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          projectId: config.projectId || process.env.SKYOPS_FIRESTORE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID,
          credential: applicationDefault(),
          storageBucket: this.bucketName
        });

    this.bucket = getStorage(app).bucket(this.bucketName);
  }

  public async upload(
    storagePath: string,
    buffer: Buffer,
    metadata: StorageObjectMetadata
  ): Promise<StorageUploadResult> {
    const file = this.bucket.file(storagePath);
    await file.save(buffer, {
      resumable: false,
      contentType: metadata.contentType,
      metadata: {
        metadata: {
          orgId: metadata.orgId,
          category: metadata.category,
          checksumSha256: metadata.checksumSha256,
          filename: metadata.filename,
          ...(metadata.customMetadata || {})
        }
      },
      validation: 'crc32c'
    });

    return {
      storagePath,
      storageBucket: this.bucketName,
      sizeBytes: buffer.length,
      checksumSha256: metadata.checksumSha256,
      contentType: metadata.contentType,
      // This is an internal object reference, not a public URL.
      publicUrl: `gs://${this.bucketName}/${storagePath}`,
      metadata: metadata.customMetadata
    };
  }

  public async download(storagePath: string): Promise<Buffer> {
    const [contents] = await this.bucket.file(storagePath).download();
    return contents;
  }

  public async delete(storagePath: string): Promise<boolean> {
    try {
      await this.bucket.file(storagePath).delete({ ignoreNotFound: true });
      return true;
    } catch {
      throw new Error(`Failed to delete gs://${this.bucketName}/${storagePath}`);
    }
  }

  public async exists(storagePath: string): Promise<boolean> {
    const [exists] = await this.bucket.file(storagePath).exists();
    return exists;
  }

  public async getMetadata(storagePath: string): Promise<StorageObjectMetadata | null> {
    const [exists] = await this.bucket.file(storagePath).exists();
    if (!exists) return null;
    const [data] = await this.bucket.file(storagePath).getMetadata();
    return {
      orgId: String(data.metadata?.orgId || ''),
      category: (String(data.metadata?.category || 'incident-artifacts') as import('../types').StorageCategory),
      filename: String(data.metadata?.filename || storagePath.split('/').pop() || storagePath),
      contentType: String(data.contentType || 'application/octet-stream'),
      sizeBytes: Number(data.size || 0),
      checksumSha256: String(data.metadata?.checksumSha256 || '')
    };
  }

  public async getDownloadUrl(storagePath: string): Promise<string> {
    // Do not expose a public object URL. API routes should authorize the tenant
    // and stream the object through StorageService.
    return `gs://${this.bucketName}/${storagePath}`;
  }
}
