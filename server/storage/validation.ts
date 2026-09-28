import crypto from 'crypto';
import path from 'path';
import { StorageCategory, StorageValidationError, StorageSecurityError } from './types';

export const CATEGORY_SIZE_LIMITS: Record<StorageCategory, number> = {
  'audit-exports': 50 * 1024 * 1024,      // 50 MB
  'remediation-manifests': 5 * 1024 * 1024, // 5 MB
  'ai-diagnostics': 10 * 1024 * 1024,     // 10 MB
  'incident-artifacts': 25 * 1024 * 1024, // 25 MB
  'cluster-snapshots': 25 * 1024 * 1024,  // 25 MB
  'user-uploads': 25 * 1024 * 1024,       // 25 MB
  'logs': 50 * 1024 * 1024                  // 50 MB compressed archive
};

export const ALLOWED_MIME_TYPES = new Set<string>([
  'application/json',
  'text/csv',
  'text/plain',
  'application/x-yaml',
  'text/yaml',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/gzip',
  'application/octet-stream'
]);

export const FORBIDDEN_EXTENSIONS = new Set<string>([
  '.exe', '.bat', '.cmd', '.sh', '.msi', '.bin', '.scr', '.vbs', '.com', '.dll', '.pif', '.hta'
]);

/**
 * Computes deterministic SHA-256 hash of a file buffer.
 */
export function computeChecksumSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sanitizes and validates a filename to prevent path traversal and shell injection.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    throw new StorageValidationError('Filename must be a non-empty string', 'INVALID_FILENAME');
  }

  // Check for malicious path traversal sequences (both raw and URL-encoded)
  const decoded = decodeURIComponent(filename);
  if (
    filename.includes('..') ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  ) {
    throw new StorageSecurityError('Path traversal sequence detected in filename');
  }

  // Strip non-printable characters and whitespace
  const base = path.basename(filename).trim();
  const sanitized = base.replace(/[^a-zA-Z0-9._-]/g, '_');

  if (!sanitized || sanitized === '.' || sanitized === '..') {
    throw new StorageValidationError('Sanitized filename is invalid', 'INVALID_FILENAME');
  }

  const ext = path.extname(sanitized).toLowerCase();
  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new StorageSecurityError(`File extension "${ext}" is forbidden for security`);
  }

  return sanitized;
}

/**
 * Validates tenant organization ID format.
 */
export function validateOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new StorageSecurityError('Valid organization ID is required');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(orgId)) {
    throw new StorageSecurityError('Invalid organization ID characters or length');
  }
  if (orgId.includes('..') || orgId.includes('/') || orgId.includes('\\')) {
    throw new StorageSecurityError('Organization ID contains invalid traversal characters');
  }
}

/**
 * Validates storage category against allowlist.
 */
export function validateCategory(category: string): StorageCategory {
  const validCategories: StorageCategory[] = [
    'audit-exports',
    'incident-artifacts',
    'remediation-manifests',
    'cluster-snapshots',
    'ai-diagnostics',
    'user-uploads',
    'logs'
  ];

  if (!validCategories.includes(category as StorageCategory)) {
    throw new StorageValidationError(
      `Invalid storage category: "${category}". Allowed: ${validCategories.join(', ')}`,
      'INVALID_CATEGORY'
    );
  }

  return category as StorageCategory;
}

/**
 * Validates file buffer size against category limit.
 */
export function validateFileSize(buffer: Buffer, category: StorageCategory): void {
  const limit = CATEGORY_SIZE_LIMITS[category];
  if (buffer.length === 0) {
    throw new StorageValidationError('File content cannot be empty (0 bytes)', 'EMPTY_FILE');
  }
  if (buffer.length > limit) {
    const limitMb = Math.round(limit / (1024 * 1024));
    throw new StorageValidationError(
      `File size (${(buffer.length / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed for ${category} (${limitMb} MB)`,
      'FILE_TOO_LARGE',
      { actualBytes: buffer.length, maxBytes: limit }
    );
  }
}

/**
 * Validates MIME type against allowlist.
 */
export function validateMimeType(mimeType: string): string {
  const normalized = (mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalized)) {
    throw new StorageValidationError(
      `MIME type "${mimeType}" is not allowed. Allowed types: ${Array.from(ALLOWED_MIME_TYPES).join(', ')}`,
      'UNSUPPORTED_MIME_TYPE'
    );
  }
  return normalized;
}

/**
 * Builds canonical tenant-isolated storage path.
 * Format: tenants/{orgId}/{category}/{subpath...}
 */
export function buildStoragePath(orgId: string, category: StorageCategory, subpath: string): string {
  validateOrgId(orgId);
  validateCategory(category);

  // Normalize and clean subpath
  const cleanSubpath = subpath
    .replace(/\\/g, '/')
    .split('/')
    .map((seg) => seg.trim())
    .filter(Boolean);

  for (const seg of cleanSubpath) {
    if (seg === '..' || seg === '.' || seg.includes('\0')) {
      throw new StorageSecurityError('Path traversal sequence detected in storage subpath');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(seg)) {
      throw new StorageSecurityError(`Invalid characters in storage path segment: "${seg}"`);
    }
  }

  if (cleanSubpath.length === 0) {
    throw new StorageValidationError('Storage subpath must include a valid filename', 'EMPTY_SUBPATH');
  }

  return `tenants/${orgId}/${category}/${cleanSubpath.join('/')}`;
}

/**
 * Extracts and verifies tenant orgId from a full storage path.
 */
export function parseTenantFromPath(storagePath: string): { orgId: string; category: StorageCategory; subpath: string } {
  const parts = storagePath.split('/');
  if (parts.length < 4 || parts[0] !== 'tenants') {
    throw new StorageSecurityError(`Malformed tenant storage path: "${storagePath}"`);
  }
  const orgId = parts[1];
  const category = validateCategory(parts[2]);
  const subpath = parts.slice(3).join('/');
  validateOrgId(orgId);
  return { orgId, category, subpath };
}
