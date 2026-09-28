import express, { Response } from 'express';
import {
  AuthenticatedUserRequest,
  requireOrgMembership,
  requireRole,
  requireUserAuth
} from './auth';
import { storageService } from './storage';
import { StorageCategory } from './storage/types';
import { sendApiError } from './middleware/requestId';

const router = express.Router();

/**
 * GET /api/v1/storage/config
 * Public / Authenticated storage runtime configuration
 */
router.get('/api/v1/storage/config', (req, res) => {
  res.json({
    bucket: storageService.getBucketName(),
    driver: storageService.getDriverName(),
    status: 'ACTIVE'
  });
});

/**
 * GET /api/v1/storage/usage
 * Aggregated storage usage breakdown by category for the tenant
 */
router.get(
  '/api/v1/storage/usage',
  requireUserAuth,
  requireOrgMembership,
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const usage = await storageService.getStorageUsageSummary(orgId);
      res.json(usage);
    } catch (err: any) {
      sendApiError(res, 500, err?.message || 'Failed to retrieve storage usage', 'STORAGE_USAGE_ERROR');
    }
  }
);

/**
 * GET /api/v1/storage/artifacts
 * Lists stored artifacts for the organization
 */
router.get(
  '/api/v1/storage/artifacts',
  requireUserAuth,
  requireOrgMembership,
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const { category, status, search, offset, limit, from, to } = req.query;

      const result = await storageService.listArtifacts(orgId, {
        category: category ? (category as StorageCategory) : undefined,
        lifecycleStatus: status ? (status as any) : undefined,
        search: search ? String(search) : undefined,
        offset: offset ? parseInt(String(offset), 10) : 0,
        limit: limit ? parseInt(String(limit), 10) : 50,
        fromTimestamp: from ? parseInt(String(from), 10) : undefined,
        toTimestamp: to ? parseInt(String(to), 10) : undefined
      });

      res.json(result);
    } catch (err: any) {
      sendApiError(res, 500, err?.message || 'Failed to list artifacts', 'STORAGE_LIST_ERROR');
    }
  }
);

/**
 * GET /api/v1/storage/artifacts/:id
 * Retrieves metadata for a specific stored artifact
 */
router.get(
  '/api/v1/storage/artifacts/:id',
  requireUserAuth,
  requireOrgMembership,
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const artifactId = req.params.id;

      const artifact = await storageService.getArtifact(orgId, artifactId);
      if (!artifact) {
        return sendApiError(res, 404, `Artifact "${artifactId}" not found`, 'ARTIFACT_NOT_FOUND');
      }

      res.json(artifact);
    } catch (err: any) {
      sendApiError(res, 500, err?.message || 'Failed to retrieve artifact', 'STORAGE_RETRIEVE_ERROR');
    }
  }
);

/**
 * GET /api/v1/storage/artifacts/:id/download
 * Securely streams the stored artifact payload
 */
router.get(
  '/api/v1/storage/artifacts/:id/download',
  requireUserAuth,
  requireOrgMembership,
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const artifactId = req.params.id;

      const actor = {
        id: req.user?.id || 'unknown',
        email: req.user?.email,
        name: req.user?.name,
        actorType: 'HUMAN' as const
      };

      const { artifact, buffer } = await storageService.downloadArtifact(orgId, artifactId, actor);

      res.setHeader('Content-Type', artifact.mimeType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', `attachment; filename="${artifact.filename}"`);
      res.setHeader('ETag', `"${artifact.checksumSha256}"`);
      res.setHeader('Cache-Control', 'private, no-cache');

      res.send(buffer);
    } catch (err: any) {
      const statusCode = err?.name === 'StorageSecurityError' ? 403 : 400;
      sendApiError(res, statusCode, err?.message || 'Download failed', err?.code || 'STORAGE_DOWNLOAD_ERROR');
    }
  }
);

/**
 * POST /api/v1/storage/upload
 * Securely uploads an artifact into tenant-isolated storage
 */
router.post(
  '/api/v1/storage/upload',
  requireUserAuth,
  requireOrgMembership,
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const { filename, category, contentBase64, mimeType, tags, metadata, retentionDays } = req.body;

      if (!filename || typeof filename !== 'string') {
        return sendApiError(res, 400, 'filename is required', 'MISSING_PARAM');
      }
      if (!category || typeof category !== 'string') {
        return sendApiError(res, 400, 'category is required', 'MISSING_PARAM');
      }
      if (!contentBase64 || typeof contentBase64 !== 'string') {
        return sendApiError(res, 400, 'contentBase64 is required', 'MISSING_PARAM');
      }

      const buffer = Buffer.from(contentBase64, 'base64');
      const actor = {
        id: req.user?.id || 'unknown',
        email: req.user?.email,
        name: req.user?.name,
        actorType: 'HUMAN' as const
      };

      const artifact = await storageService.uploadArtifact({
        orgId,
        category: category as StorageCategory,
        filename,
        buffer,
        mimeType: mimeType || 'application/octet-stream',
        actor,
        tags: Array.isArray(tags) ? tags : [],
        metadata: typeof metadata === 'object' && metadata !== null ? metadata : {},
        retentionDays: retentionDays ? parseInt(String(retentionDays), 10) : undefined
      });

      res.status(201).json(artifact);
    } catch (err: any) {
      const statusCode = err?.name === 'StorageSecurityError' ? 403 : 400;
      sendApiError(res, statusCode, err?.message || 'Upload failed', err?.code || 'STORAGE_UPLOAD_ERROR');
    }
  }
);

/**
 * DELETE /api/v1/storage/artifacts/:id
 * Deletes an artifact (rejects audit exports)
 */
router.delete(
  '/api/v1/storage/artifacts/:id',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN', 'OPERATOR']),
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const artifactId = req.params.id;
      const hard = req.query.hard === 'true';

      const actor = {
        id: req.user?.id || 'unknown',
        email: req.user?.email,
        name: req.user?.name,
        actorType: 'HUMAN' as const
      };

      const success = await storageService.deleteArtifact(orgId, artifactId, actor, hard);
      if (!success) {
        return sendApiError(res, 404, `Artifact "${artifactId}" not found`, 'ARTIFACT_NOT_FOUND');
      }

      res.json({ success: true, artifactId });
    } catch (err: any) {
      const statusCode = err?.name === 'StorageSecurityError' ? 403 : 400;
      sendApiError(res, statusCode, err?.message || 'Delete failed', err?.code || 'STORAGE_DELETE_ERROR');
    }
  }
);

/**
 * POST /api/v1/storage/audit-export
 * Exports tenant audit ledger to immutable storage
 */
router.post(
  '/api/v1/storage/audit-export',
  requireUserAuth,
  requireOrgMembership,
  requireRole(['OWNER', 'ADMIN']),
  async (req: AuthenticatedUserRequest, res: Response) => {
    try {
      const orgId = req.orgId!;
      const format = (req.body.format || 'json') === 'csv' ? 'csv' : 'json';

      const actor = {
        id: req.user?.id || 'unknown',
        email: req.user?.email,
        name: req.user?.name,
        actorType: 'HUMAN' as const
      };

      const artifact = await storageService.exportAuditToStorage(orgId, actor, format);
      res.status(201).json(artifact);
    } catch (err: any) {
      sendApiError(res, 500, err?.message || 'Audit export failed', 'AUDIT_EXPORT_ERROR');
    }
  }
);

export { router as storageRouter };
