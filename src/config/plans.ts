import { BillingInterval, Plan, PlanId, PlanIntervalPricing, PlanLimits } from '../types';

export const BILLING_INTERVALS: Array<{
  id: BillingInterval;
  label: string;
  shortLabel: string;
  months: number;
}> = [
  { id: 'MONTHLY', label: 'Monthly', shortLabel: '1 Mo', months: 1 },
  { id: 'QUARTERLY', label: '3 Months', shortLabel: '3 Mos', months: 3 },
  { id: 'HALF_YEARLY', label: '6 Months', shortLabel: '6 Mos', months: 6 },
  { id: 'YEARLY', label: '12 Months (Best Value)', shortLabel: '12 Mos', months: 12 }
];

export const DEFAULT_TRIAL_DAYS = 14;

export const PLANS: Record<PlanId, Plan> = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    tagline: 'Permanent entry tier to test SkyOps in sandbox & dev clusters',
    description: 'Install the SkyOps agent, observe cluster health, and experience incident detection.',
    badge: 'Permanent Free',
    recommended: false,
    pricing: {
      MONTHLY: {
        interval: 'MONTHLY',
        label: 'Monthly',
        durationMonths: 1,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      QUARTERLY: {
        interval: 'QUARTERLY',
        label: '3 Months',
        durationMonths: 3,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      HALF_YEARLY: {
        interval: 'HALF_YEARLY',
        label: '6 Months',
        durationMonths: 6,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      YEARLY: {
        interval: 'YEARLY',
        label: '12 Months',
        durationMonths: 12,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      }
    },
    limits: {
      clusters: 1,
      nodes: 5,
      workloads: 100,
      members: 1,
      dataRetentionDays: 7,
      aiInvestigationsMonthly: 20,
      aiMonthlyAllowance: 20,
      remediationsMonthly: 0,
      auditLogsDays: 7
    },
    features: {
      incidentDetection: true,
      metrics: true,
      events: true,
      logs: 'basic',
      incidentCorrelation: 'basic',
      rca: 'basic',
      remediationRecommendations: 'limited',
      automatedRemediation: false,
      notifications: 'basic',
      webhooks: false,
      rbac: 'basic',
      support: 'community'
    },
    highlights: [
      '1 Managed Kubernetes cluster',
      'Up to 5 nodes & 100 workload pods',
      '1 Organization member seat',
      '7 days data & audit retention',
      'Real-time incident detection & metrics',
      'Basic logs, correlation & RCA',
      'Standard community support'
    ]
  },

  PRO: {
    id: 'PRO',
    name: 'Pro',
    tagline: 'Ideal for engineering teams managing small to mid-size clusters',
    description: 'Full AI investigation, automated incident correlation, extended retention and team RBAC.',
    badge: 'Most Popular',
    recommended: true,
    currency: 'INR',
    razorpayPlanIds: {
      MONTHLY: (typeof process !== 'undefined' && process.env?.RAZORPAY_PRO_MONTHLY_PLAN_ID) || 'plan_pro_monthly',
      YEARLY: (typeof process !== 'undefined' && process.env?.RAZORPAY_PRO_YEARLY_PLAN_ID) || 'plan_pro_yearly'
    },
    pricing: {
      MONTHLY: {
        interval: 'MONTHLY',
        label: '1 Month',
        durationMonths: 1,
        totalPrice: 5000,
        monthlyEquivalent: 5000,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      QUARTERLY: {
        interval: 'QUARTERLY',
        label: '3 Months',
        durationMonths: 3,
        totalPrice: 14000,
        monthlyEquivalent: 4667,
        savings: 1000,
        savingsPercentage: 7,
        currency: 'INR'
      },
      HALF_YEARLY: {
        interval: 'HALF_YEARLY',
        label: '6 Months',
        durationMonths: 6,
        totalPrice: 26000,
        monthlyEquivalent: 4333,
        savings: 4000,
        savingsPercentage: 13,
        currency: 'INR'
      },
      YEARLY: {
        interval: 'YEARLY',
        label: '12 Months',
        durationMonths: 12,
        totalPrice: 48000,
        monthlyEquivalent: 4000,
        savings: 12000,
        savingsPercentage: 20,
        currency: 'INR'
      }
    },
    limits: {
      clusters: 5,
      nodes: 50,
      workloads: 1000,
      members: 10,
      dataRetentionDays: 30,
      aiInvestigationsMonthly: 200,
      aiMonthlyAllowance: 200,
      remediationsMonthly: 25,
      auditLogsDays: 30
    },
    features: {
      incidentDetection: true,
      metrics: true,
      events: true,
      logs: 'standard',
      incidentCorrelation: 'advanced',
      rca: 'advanced',
      remediationRecommendations: 'enabled',
      automatedRemediation: 'limited',
      notifications: 'advanced',
      webhooks: true,
      rbac: 'standard',
      support: 'standard'
    },
    highlights: [
      '5 Managed Kubernetes clusters',
      'Up to 50 nodes & 1,000 workloads',
      '10 Team member seats with RBAC',
      '30 days data & cryptographic audit retention',
      'Gemini AI Root Cause Analysis (200/mo)',
      'Automated remediation proposals (25/mo)',
      'Outbound webhooks & Slack integration',
      'Standard email & helpdesk SLA'
    ]
  },

  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    tagline: 'High-density multi-cluster production environments & platform teams',
    description: 'High capacity quotas, 90-day retention, advanced RBAC, and heavy AI investigations.',
    badge: 'Advanced Ops',
    recommended: false,
    currency: 'INR',
    razorpayPlanIds: {
      MONTHLY: (typeof process !== 'undefined' && process.env?.RAZORPAY_BUSINESS_MONTHLY_PLAN_ID) || 'plan_biz_monthly',
      YEARLY: (typeof process !== 'undefined' && process.env?.RAZORPAY_BUSINESS_YEARLY_PLAN_ID) || 'plan_biz_yearly'
    },
    pricing: {
      MONTHLY: {
        interval: 'MONTHLY',
        label: '1 Month',
        durationMonths: 1,
        totalPrice: 12000,
        monthlyEquivalent: 12000,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      QUARTERLY: {
        interval: 'QUARTERLY',
        label: '3 Months',
        durationMonths: 3,
        totalPrice: 33000,
        monthlyEquivalent: 11000,
        savings: 3000,
        savingsPercentage: 8,
        currency: 'INR'
      },
      HALF_YEARLY: {
        interval: 'HALF_YEARLY',
        label: '6 Months',
        durationMonths: 6,
        totalPrice: 60000,
        monthlyEquivalent: 10000,
        savings: 12000,
        savingsPercentage: 17,
        currency: 'INR'
      },
      YEARLY: {
        interval: 'YEARLY',
        label: '12 Months',
        durationMonths: 12,
        totalPrice: 108000,
        monthlyEquivalent: 9000,
        savings: 36000,
        savingsPercentage: 25,
        currency: 'INR'
      }
    },
    limits: {
      clusters: 20,
      nodes: 200,
      workloads: 5000,
      members: 50,
      dataRetentionDays: 90,
      aiInvestigationsMonthly: 1000,
      aiMonthlyAllowance: 1000,
      remediationsMonthly: 200,
      auditLogsDays: 90
    },
    features: {
      incidentDetection: true,
      metrics: true,
      events: true,
      logs: 'full',
      incidentCorrelation: 'advanced',
      rca: 'advanced',
      remediationRecommendations: 'enabled',
      automatedRemediation: 'enabled',
      notifications: 'advanced',
      webhooks: true,
      rbac: 'advanced',
      support: 'priority'
    },
    highlights: [
      '20 Managed Kubernetes clusters',
      'Up to 200 nodes & 5,000 workloads',
      '50 Team member seats with custom RBAC',
      '90 days data & compliance audit retention',
      'Advanced AI root cause & question investigator (1,000/mo)',
      'Automated remediation execution (200/mo)',
      'High-throughput webhooks & notification digests',
      'Priority 4-hour helpdesk SLA'
    ]
  },

  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Mission-critical enterprise fleets with custom governance and SLA',
    description: 'Custom cluster capacity, tailored retention, governance, integrations, and support terms.',
    badge: 'Custom Terms',
    recommended: false,
    pricing: {
      MONTHLY: {
        interval: 'MONTHLY',
        label: 'Custom',
        durationMonths: 1,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      QUARTERLY: {
        interval: 'QUARTERLY',
        label: 'Custom',
        durationMonths: 3,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      HALF_YEARLY: {
        interval: 'HALF_YEARLY',
        label: 'Custom',
        durationMonths: 6,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      },
      YEARLY: {
        interval: 'YEARLY',
        label: 'Custom',
        durationMonths: 12,
        totalPrice: 0,
        monthlyEquivalent: 0,
        savings: 0,
        savingsPercentage: 0,
        currency: 'INR'
      }
    },
    limits: {
      clusters: -1, // Unlimited / Custom
      nodes: -1,
      workloads: -1,
      members: -1,
      dataRetentionDays: 365,
      aiInvestigationsMonthly: -1,
      aiMonthlyAllowance: -1,
      remediationsMonthly: -1,
      auditLogsDays: 365
    },
    features: {
      incidentDetection: true,
      metrics: true,
      events: true,
      logs: 'custom',
      incidentCorrelation: 'custom',
      rca: 'custom',
      remediationRecommendations: 'custom',
      automatedRemediation: 'custom',
      notifications: 'custom',
      webhooks: true,
      rbac: 'custom',
      support: 'dedicated_sla'
    },
    highlights: [
      'Custom clusters, nodes & workloads capacity',
      'Unlimited organization member seats',
      '1+ Year compliance & audit retention',
      'Custom AI & automated remediation policies',
      'Custom integrations & single tenant deployment options',
      'Custom support and service terms'
    ]
  }
};

export const BILLING_INTERVAL_CONFIG: Record<
  BillingInterval,
  { months: number; label: string; shortLabel: string }
> = {
  MONTHLY: { months: 1, label: '1 Month', shortLabel: '/mo' },
  QUARTERLY: { months: 3, label: '3 Months', shortLabel: '/qtr' },
  HALF_YEARLY: { months: 6, label: '6 Months', shortLabel: '/half-yr' },
  YEARLY: { months: 12, label: '12 Months', shortLabel: '/yr' }
};

export const TRIAL_CONFIG = {
  planId: 'PRO' as PlanId,
  durationDays: 14,
  durationMs: 14 * 24 * 60 * 60 * 1000
};

export const PLANS_LIST: Plan[] = Object.values(PLANS);

/**
 * Get plan definition by PlanId
 */
export function getPlanDefinition(planId: PlanId | string): Plan {
  return PLANS[planId as PlanId] || PLANS.FREE;
}

/**
 * Get pricing definition by PlanId and BillingInterval
 */
export function getPlanPricing(planId: PlanId | string, interval: BillingInterval): PlanIntervalPricing {
  const plan = getPlanDefinition(planId);
  return plan.pricing[interval] || plan.pricing.MONTHLY;
}

/**
 * Format INR currency value
 */
export function formatINR(amount: number): string {
  if (amount === 0) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
}

/**
 * Helper to get effective limits for an organization considering custom overrides
 */
export function resolveEffectiveLimits(
  planId: PlanId,
  customLimits?: Partial<PlanLimits>
): PlanLimits {
  const base = PLANS[planId]?.limits || PLANS.FREE.limits;
  if (!customLimits) return { ...base };
  return {
    ...base,
    ...customLimits
  };
}
