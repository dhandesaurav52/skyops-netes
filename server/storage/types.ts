import {
  StorageCategory,
  StoredArtifact,
  StoredArtifactLifecycleStatus,
  StoredArtifactActor,
  StoredArtifactFilters,
  StorageUsageSummary
} from '../../src/types/index';

export type {
  StorageCategory,
  StoredArtifact,
  StoredArtifactLifecycleStatus,
  StoredArtifactActor,
  StoredArtifactFilters,
  StorageUsageSummary
};

export interface StorageObjectMetadata {
  orgId: string;
  category: StorageCategory;
  filename: string;
  contentType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedBy?: StoredArtifactActor;
  customMetadata?: Record<string, string | number | boolean>;
  retentionDays?: number;
}

export interface StorageUploadResult {
  storagePath: string;
  storageBucket: string;
  sizeBytes: number;
  checksumSha256: string;
  contentType: string;
  publicUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface IStorageDriver {
  readonly driverName: string;
  upload(
    storagePath: string,
    buffer: Buffer,
    metadata: StorageObjectMetadata
  ): Promise<StorageUploadResult>;
  download(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<boolean>;
  exists(storagePath: string): Promise<boolean>;
  getMetadata(storagePath: string): Promise<StorageObjectMetadata | null>;
  getDownloadUrl?(storagePath: string, expiresInSeconds?: number): Promise<string>;
}

export class StorageValidationError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: string = 'STORAGE_VALIDATION_ERROR', details?: Record<string, unknown>) {
    super(message);
    this.name = 'StorageValidationError';
    this.code = code;
    this.details = details;
  }
}

export class StorageSecurityError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'STORAGE_SECURITY_ERROR') {
    super(message);
    this.name = 'StorageSecurityError';
    this.code = code;
  }
}
