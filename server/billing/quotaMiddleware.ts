import { NextFunction, Response } from 'express';
import { AuthenticatedUserRequest } from '../auth';
import { entitlementService } from './entitlementService';
import { PlanFeatures } from '../../src/types/billing';

/**
 * Middleware: Enforces backend quota before mutating operations
 */
export function requireQuota(
  resource: 'clusters' | 'nodes' | 'workloads' | 'members' | 'ai_investigations' | 'remediations' | 'webhooks',
  requestedQuantity = 1
) {
  return (req: AuthenticatedUserRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.orgId) {
      return res.status(400).json({ error: 'Organization ID is required for quota validation' });
    }

    const check = entitlementService.checkQuota(req.orgId, resource, requestedQuantity);
    if (!check.allowed) {
      return res.status(403).json({
        code: check.code || 'PLAN_LIMIT_REACHED',
        resource,
        current: check.current,
        limit: check.limit,
        plan: check.plan,
        upgradeRequired: check.upgradeRequired,
        error: check.error || `Plan limit reached for ${resource}`
      });
    }

    next();
  };
}

/**
 * Middleware: Enforces feature access entitlement
 */
export function requireFeature(feature: keyof PlanFeatures) {
  return (req: AuthenticatedUserRequest, res: Response, next: NextFunction): void | Response => {
    if (!req.orgId) {
      return res.status(400).json({ error: 'Organization ID is required for feature validation' });
    }

    const has = entitlementService.hasFeature(req.orgId, feature);
    if (!has) {
      const entitlements = entitlementService.getEntitlements(req.orgId);
      return res.status(403).json({
        code: 'FEATURE_NOT_ENTITLED',
        feature,
        plan: entitlements.planId,
        upgradeRequired: true,
        error: `The feature '${feature}' is not available on your current ${entitlements.planId} plan. Please upgrade your plan.`
      });
    }

    next();
  };
}
