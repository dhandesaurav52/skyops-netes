import {
  Entitlements,
  PlanDefinition,
  PlanFeatures,
  PlanLimitErrorResponse,
  PlanLimits,
  PlanTier,
  Subscription
} from '../../src/types/billing';
import { auditService } from '../audit';
import { webhookService } from '../integrations/webhooks';
import { store } from '../store';
import { billingService } from './billingService';
import { getPlanDefinition } from './planConfig';

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  plan: PlanTier;
  upgradeRequired: boolean;
  code?: 'PLAN_LIMIT_REACHED' | 'FEATURE_NOT_ENTITLED' | 'SUBSCRIPTION_RESTRICTED';
  error?: string;
}

export class EntitlementService {
  /**
   * Get active subscription for organization
   */
  public getSubscription(orgId: string): Subscription {
    return billingService.getSubscription(orgId) as unknown as Subscription;
  }

  /**
   * Get plan definition for organization
   */
  public getPlan(orgId: string): PlanDefinition {
    const sub = this.getSubscription(orgId);
    return getPlanDefinition(sub.planId);
  }

  /**
   * Calculate full entitlements and real-time consumption
   */
  public getEntitlements(orgId: string): Entitlements {
    const sub = this.getSubscription(orgId);
    const plan = getPlanDefinition(sub.planId);

    // Apply any custom enterprise limits
    const limits: PlanLimits = {
      ...plan.limits,
      ...(sub.customLimits || {})
    };

    const features: PlanFeatures = {
      ...plan.features
    };

    const now = Date.now();
    const isTrial = sub.status === 'TRIALING';
    const trialDaysRemaining =
      isTrial && sub.trialEndsAt && sub.trialEndsAt > now
        ? Math.ceil((sub.trialEndsAt - now) / (24 * 60 * 60 * 1000))
        : 0;

    const isActive = sub.status === 'ACTIVE' || isTrial || sub.status === 'GRACE_PERIOD';

    // Current consumption from DataStore
    const orgClusters = store.getClusters(orgId);
    const clusterCount = orgClusters.length;

    let nodeCount = 0;
    let workloadCount = 0;
    for (const c of orgClusters) {
      nodeCount += c.nodeCount || 0;
      workloadCount += c.podCount || 0;
    }

    const members = store.getOrgMembers(orgId);
    const memberCount = members.length;

    const usage = store.getOrgUsage(orgId);
    const aiCount = usage.aiAnalysesPerformed || 0;

    const webhooks = webhookService.getWebhooks(orgId);
    const webhookCount = webhooks.length;

    const calcMeter = (current: number, limit: number) => {
      if (limit === -1) {
        return {
          current,
          limit,
          percent: 0,
          isAtLimit: false,
          isNearLimit: false
        };
      }
      const percent = Math.min(100, Math.round((current / limit) * 100));
      return {
        current,
        limit,
        percent,
        isAtLimit: current >= limit,
        isNearLimit: percent >= 80 && current < limit
      };
    };

    return {
      organizationId: orgId,
      planId: sub.planId,
      planName: plan.name,
      status: sub.status,
      isActive,
      isTrial,
      trialDaysRemaining,
      billingInterval: sub.billingInterval,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      limits,
      features,
      usage: {
        clusters: calcMeter(clusterCount, limits.clusters),
        nodes: calcMeter(nodeCount, limits.nodes),
        workloads: calcMeter(workloadCount, limits.workloads),
        members: calcMeter(memberCount, limits.members),
        aiInvestigations: calcMeter(aiCount, limits.aiMonthlyAllowance),
        webhooks: {
          current: webhookCount,
          allowed: features.webhooks
        },
        dataRetentionDays: limits.dataRetentionDays,
        auditRetentionDays: limits.auditRetentionDays
      }
    };
  }

  /**
   * Check quota for a resource. If exceeded, logs an audit event and returns structured details.
   */
  public checkQuota(
    orgId: string,
    resource: 'clusters' | 'nodes' | 'workloads' | 'members' | 'ai_investigations' | 'remediations' | 'webhooks',
    requestedQuantity = 1
  ): QuotaCheckResult {
    const entitlements = this.getEntitlements(orgId);
    const plan = entitlements.planId;

    // Check if subscription is restricted (e.g. expired trial or suspended)
    if (!entitlements.isActive) {
      const error = `Subscription is ${entitlements.status.toLowerCase()}. Please upgrade your plan to continue provisioning resources.`;
      auditService.record({
        orgId,
        actorId: 'system',
        actorName: 'Entitlement Quota Engine',
        actorType: 'SYSTEM',
        action: 'plan_limit_reached',
        resourceType: 'SUBSCRIPTION',
        resourceId: resource,
        result: 'FAILURE',
        details: { resource, reason: 'SUBSCRIPTION_RESTRICTED', status: entitlements.status }
      });
      return {
        allowed: false,
        current: 0,
        limit: 0,
        plan,
        upgradeRequired: true,
        code: 'SUBSCRIPTION_RESTRICTED',
        error
      };
    }

    // Feature gating
    if (resource === 'webhooks') {
      if (!entitlements.features.webhooks) {
        const error = `Webhooks and integrations are not available on the ${plan} plan. Please upgrade to Pro or Business.`;
        auditService.record({
          orgId,
          actorId: 'system',
          actorName: 'Entitlement Quota Engine',
          actorType: 'SYSTEM',
          action: 'plan_limit_reached',
          resourceType: 'INTEGRATION',
          resourceId: 'webhooks',
          result: 'FAILURE',
          details: { resource: 'webhooks', reason: 'FEATURE_NOT_ENTITLED', plan }
        });
        return {
          allowed: false,
          current: entitlements.usage.webhooks.current,
          limit: 0,
          plan,
          upgradeRequired: true,
          code: 'FEATURE_NOT_ENTITLED',
          error
        };
      }
      return {
        allowed: true,
        current: entitlements.usage.webhooks.current,
        limit: -1,
        plan,
        upgradeRequired: false
      };
    }

    if (resource === 'remediations') {
      if (entitlements.features.automatedRemediation === 'disabled' || !entitlements.features.automatedRemediation) {
        const error = `Automated remediations require a Pro or Business subscription.`;
        return {
          allowed: false,
          current: 0,
          limit: 0,
          plan,
          upgradeRequired: true,
          code: 'FEATURE_NOT_ENTITLED',
          error
        };
      }

      const usage = store.getOrgUsage(orgId);
      const currentRemediations = usage.remediationsExecuted || 0;
      const limitRemediations = plan === 'PRO' ? 25 : plan === 'BUSINESS' ? 200 : -1;

      if (limitRemediations !== -1 && currentRemediations + requestedQuantity > limitRemediations) {
        const error = `Monthly automated remediation quota reached (${currentRemediations}/${limitRemediations}). Upgrade your plan to execute additional remediations.`;
        auditService.record({
          orgId,
          actorId: 'system',
          actorName: 'Entitlement Quota Engine',
          actorType: 'SYSTEM',
          action: 'plan_limit_reached',
          resourceType: 'SUBSCRIPTION',
          resourceId: 'remediations',
          result: 'FAILURE',
          details: { resource: 'remediations', current: currentRemediations, limit: limitRemediations, plan }
        });
        return {
          allowed: false,
          current: currentRemediations,
          limit: limitRemediations,
          plan,
          upgradeRequired: true,
          code: 'PLAN_LIMIT_REACHED',
          error
        };
      }

      return {
        allowed: true,
        current: currentRemediations,
        limit: limitRemediations,
        plan,
        upgradeRequired: false
      };
    }

    // Numeric limits
    let current = 0;
    let limit = 0;

    switch (resource) {
      case 'clusters':
        current = entitlements.usage.clusters.current;
        limit = entitlements.limits.clusters;
        break;
      case 'nodes':
        current = entitlements.usage.nodes.current;
        limit = entitlements.limits.nodes;
        break;
      case 'workloads':
        current = entitlements.usage.workloads.current;
        limit = entitlements.limits.workloads;
        break;
      case 'members':
        current = entitlements.usage.members.current;
        limit = entitlements.limits.members;
        break;
      case 'ai_investigations':
        current = entitlements.usage.aiInvestigations.current;
        limit = entitlements.limits.aiMonthlyAllowance;
        break;
    }

    if (limit !== -1 && current + requestedQuantity > limit) {
      const error = `Plan limit reached: You have reached the limit of ${limit} ${resource} on the ${plan} plan. Upgrade your plan to expand capacity.`;
      auditService.record({
        orgId,
        actorId: 'system',
        actorName: 'Entitlement Quota Engine',
        actorType: 'SYSTEM',
        action: 'plan_limit_reached',
        resourceType: 'SUBSCRIPTION',
        resourceId: resource,
        result: 'FAILURE',
        details: { resource, current, limit, plan }
      });

      return {
        allowed: false,
        current,
        limit,
        plan,
        upgradeRequired: true,
        code: 'PLAN_LIMIT_REACHED',
        error
      };
    }

    return {
      allowed: true,
      current,
      limit,
      plan,
      upgradeRequired: false
    };
  }

  public canCreateCluster(orgId: string): QuotaCheckResult {
    return this.checkQuota(orgId, 'clusters');
  }

  public canAddMember(orgId: string): QuotaCheckResult {
    return this.checkQuota(orgId, 'members');
  }

  public canUseAI(orgId: string): QuotaCheckResult {
    return this.checkQuota(orgId, 'ai_investigations');
  }

  public canExecuteRemediation(orgId: string): QuotaCheckResult {
    return this.checkQuota(orgId, 'remediations');
  }

  public canUseWebhooks(orgId: string): QuotaCheckResult {
    return this.checkQuota(orgId, 'webhooks');
  }

  public hasFeature(orgId: string, featureKey: keyof PlanFeatures): boolean {
    const entitlements = this.getEntitlements(orgId);
    const val = entitlements.features[featureKey];
    return Boolean(val && val !== 'disabled');
  }

  public getRetentionDays(orgId: string): number {
    const entitlements = this.getEntitlements(orgId);
    return entitlements.limits.dataRetentionDays || 7;
  }
}

export const entitlementService = new EntitlementService();
