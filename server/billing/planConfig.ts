import {
  BILLING_INTERVALS as SRC_BILLING_INTERVALS,
  PLANS as SRC_PLANS,
  TRIAL_CONFIG as SRC_TRIAL_CONFIG
} from '../../src/config/plans';
import {
  BillingInterval,
  IntervalPricing,
  PlanDefinition,
  PlanTier
} from '../../src/types/billing';

export const BILLING_INTERVALS = SRC_BILLING_INTERVALS;

function adaptPricing(srcPricing: any): Record<BillingInterval, IntervalPricing> {
  const result: any = {};
  const intervals: BillingInterval[] = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'];
  for (const interval of intervals) {
    const p = srcPricing[interval] || srcPricing.MONTHLY;
    result[interval] = {
      durationMonths: p.durationMonths || 1,
      label: p.label || '1 Month',
      totalPrice: p.totalPrice || 0,
      effectiveMonthlyPrice: p.monthlyEquivalent || p.effectiveMonthlyPrice || (p.totalPrice / (p.durationMonths || 1)),
      savingsAmount: p.savings || p.savingsAmount || 0,
      savingsPercent: p.savingsPercentage || p.savingsPercent || 0
    };
  }
  return result;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  FREE: {
    id: 'FREE',
    name: SRC_PLANS.FREE.name,
    tagline: SRC_PLANS.FREE.tagline,
    description: SRC_PLANS.FREE.description,
    currency: 'INR',
    badge: SRC_PLANS.FREE.badge || 'Standard Free',
    pricing: adaptPricing(SRC_PLANS.FREE.pricing),
    limits: {
      clusters: SRC_PLANS.FREE.limits.clusters,
      nodes: SRC_PLANS.FREE.limits.nodes,
      workloads: SRC_PLANS.FREE.limits.workloads,
      members: SRC_PLANS.FREE.limits.members,
      dataRetentionDays: SRC_PLANS.FREE.limits.dataRetentionDays,
      auditRetentionDays: SRC_PLANS.FREE.limits.auditLogsDays,
      aiMonthlyAllowance: SRC_PLANS.FREE.limits.aiMonthlyAllowance ?? SRC_PLANS.FREE.limits.aiInvestigationsMonthly,
      storageGb: 10
    },
    features: {
      incidentDetection: true,
      incidentCorrelation: 'basic',
      aiInvestigation: 'limited',
      rca: 'basic',
      remediationRecommendations: 'limited',
      automatedRemediation: 'disabled',
      notifications: 'basic',
      webhooks: false,
      rbac: 'basic',
      slaSupport: 'community',
      customIntegrations: false
    }
  },
  PRO: {
    id: 'PRO',
    name: SRC_PLANS.PRO.name,
    tagline: SRC_PLANS.PRO.tagline,
    description: SRC_PLANS.PRO.description,
    currency: 'INR',
    badge: SRC_PLANS.PRO.badge || 'Most Popular',
    isPopular: true,
    pricing: adaptPricing(SRC_PLANS.PRO.pricing),
    limits: {
      clusters: SRC_PLANS.PRO.limits.clusters,
      nodes: SRC_PLANS.PRO.limits.nodes,
      workloads: SRC_PLANS.PRO.limits.workloads,
      members: SRC_PLANS.PRO.limits.members,
      dataRetentionDays: SRC_PLANS.PRO.limits.dataRetentionDays,
      auditRetentionDays: SRC_PLANS.PRO.limits.auditLogsDays,
      aiMonthlyAllowance: SRC_PLANS.PRO.limits.aiMonthlyAllowance ?? SRC_PLANS.PRO.limits.aiInvestigationsMonthly,
      storageGb: 50
    },
    features: {
      incidentDetection: true,
      incidentCorrelation: 'advanced',
      aiInvestigation: 'full',
      rca: 'full',
      remediationRecommendations: 'full',
      automatedRemediation: 'limited',
      notifications: 'advanced',
      webhooks: true,
      rbac: 'full',
      slaSupport: 'standard_8h',
      customIntegrations: false
    }
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: SRC_PLANS.BUSINESS.name,
    tagline: SRC_PLANS.BUSINESS.tagline,
    description: SRC_PLANS.BUSINESS.description,
    currency: 'INR',
    badge: SRC_PLANS.BUSINESS.badge || 'Advanced Ops',
    pricing: adaptPricing(SRC_PLANS.BUSINESS.pricing),
    limits: {
      clusters: SRC_PLANS.BUSINESS.limits.clusters,
      nodes: SRC_PLANS.BUSINESS.limits.nodes,
      workloads: SRC_PLANS.BUSINESS.limits.workloads,
      members: SRC_PLANS.BUSINESS.limits.members,
      dataRetentionDays: SRC_PLANS.BUSINESS.limits.dataRetentionDays,
      auditRetentionDays: SRC_PLANS.BUSINESS.limits.auditLogsDays,
      aiMonthlyAllowance: SRC_PLANS.BUSINESS.limits.aiMonthlyAllowance ?? SRC_PLANS.BUSINESS.limits.aiInvestigationsMonthly,
      storageGb: 250
    },
    features: {
      incidentDetection: true,
      incidentCorrelation: 'advanced',
      aiInvestigation: 'advanced',
      rca: 'advanced',
      remediationRecommendations: 'advanced',
      automatedRemediation: 'full',
      notifications: 'advanced',
      webhooks: true,
      rbac: 'advanced',
      slaSupport: 'business_4h',
      customIntegrations: true
    }
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: SRC_PLANS.ENTERPRISE.name,
    tagline: SRC_PLANS.ENTERPRISE.tagline,
    description: SRC_PLANS.ENTERPRISE.description,
    currency: 'INR',
    badge: 'Enterprise',
    pricing: adaptPricing(SRC_PLANS.ENTERPRISE.pricing),
    limits: {
      clusters: -1,
      nodes: -1,
      workloads: -1,
      members: -1,
      dataRetentionDays: 365,
      auditRetentionDays: 365,
      aiMonthlyAllowance: -1,
      storageGb: -1
    },
    features: {
      incidentDetection: true,
      incidentCorrelation: 'advanced',
      aiInvestigation: 'advanced',
      rca: 'advanced',
      remediationRecommendations: 'advanced',
      automatedRemediation: 'full',
      notifications: 'advanced',
      webhooks: true,
      rbac: 'advanced',
      slaSupport: 'enterprise_1h',
      customIntegrations: true
    }
  }
};

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  return PLANS[tier] || PLANS.FREE;
}

export function getPlanPricing(tier: PlanTier, interval: BillingInterval): IntervalPricing {
  const plan = getPlanDefinition(tier);
  return plan.pricing[interval] || plan.pricing.MONTHLY;
}

export const TRIAL_CONFIG = {
  planId: 'PRO' as PlanTier,
  durationDays: 14,
  durationMs: 14 * 24 * 60 * 60 * 1000
};
