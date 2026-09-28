import {
  IStorageDriver,
  StorageObjectMetadata,
  StorageUploadResult
} from '../types';

interface MemoryObject {
  buffer: Buffer;
  metadata: StorageObjectMetadata;
  createdAt: number;
}

export class MemoryStorageDriver implements IStorageDriver {
  public readonly driverName = 'memory';
  private objects = new Map<string, MemoryObject>();
  private bucketName: string;

  constructor(bucketName: string = 'skyops-a1143.firebasestorage.app') {
    this.bucketName = bucketName;
  }

  public async upload(
    storagePath: string,
    buffer: Buffer,
    metadata: StorageObjectMetadata
  ): Promise<StorageUploadResult> {
    this.objects.set(storagePath, {
      buffer: Buffer.from(buffer),
      metadata: { ...metadata },
      createdAt: Date.now()
    });

    return {
      storagePath,
      storageBucket: this.bucketName,
      sizeBytes: buffer.length,
      checksumSha256: metadata.checksumSha256,
      contentType: metadata.contentType,
      publicUrl: `https://storage.googleapis.com/${this.bucketName}/${storagePath}`
    };
  }

  public async download(storagePath: string): Promise<Buffer> {
    const item = this.objects.get(storagePath);
    if (!item) {
      throw new Error(`Storage object not found: "${storagePath}"`);
    }
    return Buffer.from(item.buffer);
  }

  public async delete(storagePath: string): Promise<boolean> {
    return this.objects.delete(storagePath);
  }

  public async exists(storagePath: string): Promise<boolean> {
    return this.objects.has(storagePath);
  }

  public async getMetadata(storagePath: string): Promise<StorageObjectMetadata | null> {
    const item = this.objects.get(storagePath);
    return item ? { ...item.metadata } : null;
  }

  public async getDownloadUrl(storagePath: string): Promise<string> {
    if (!this.objects.has(storagePath)) {
      throw new Error(`Storage object not found: "${storagePath}"`);
    }
    return `https://storage.googleapis.com/${this.bucketName}/${storagePath}`;
  }

  public clear(): void {
    this.objects.clear();
  }

  public getObjectCount(): number {
    return this.objects.size;
  }
}
