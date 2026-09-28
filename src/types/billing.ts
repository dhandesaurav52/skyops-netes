export type PlanTier = 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';

export type BillingInterval = 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'GRACE_PERIOD'
  | 'SUSPENDED'
  | 'CANCELED'
  | 'EXPIRED';

export type BillingProviderType = 'mock' | 'stripe' | 'razorpay' | 'manual';

export interface PlanLimits {
  clusters: number; // Max clusters allowed (-1 for unlimited/custom)
  nodes: number; // Max nodes allowed across clusters (-1 for unlimited/custom)
  workloads: number; // Max pods/workloads (-1 for unlimited/custom)
  members: number; // Max team members (-1 for unlimited/custom)
  dataRetentionDays: number; // Telemetry retention
  telemetryRetentionDays?: number;
  auditRetentionDays: number; // Audit log retention
  aiMonthlyAllowance: number; // Number of AI RCA & investigation requests/month (-1 for unlimited)
  storageGb: number; // Telemetry storage cap in GB
}

export interface PlanFeatures {
  incidentDetection: boolean;
  incidentCorrelation: 'basic' | 'advanced';
  aiInvestigation: 'limited' | 'full' | 'advanced';
  rca: 'basic' | 'full' | 'advanced';
  remediationRecommendations: 'limited' | 'full' | 'advanced';
  automatedRemediation: 'disabled' | 'limited' | 'full';
  notifications: 'basic' | 'advanced';
  webhooks: boolean;
  rbac: 'basic' | 'full' | 'advanced';
  slaSupport: 'community' | 'standard_8h' | 'business_4h' | 'enterprise_1h';
  customIntegrations?: boolean;
  geminiRootCauseAnalysis?: boolean;
  autonomousRemediation?: boolean;
  customWebhooks?: boolean;
  auditLogExport?: boolean;
  emailAlerts?: boolean;
  ssoSaml?: boolean;
}

export interface IntervalPricing {
  durationMonths: number;
  label: string;
  totalPrice: number; // In INR (₹)
  effectiveMonthlyPrice: number; // In INR (₹)
  savingsAmount: number; // In INR (₹)
  savingsPercent: number; // percentage (e.g. 20)
}

export interface PlanDefinition {
  id: PlanTier;
  name: string;
  tagline: string;
  description: string;
  currency: string;
  pricing: Record<BillingInterval, IntervalPricing>;
  limits: PlanLimits;
  features: PlanFeatures;
  badge?: string;
  isPopular?: boolean;
}

export interface Subscription {
  id: string;
  organizationId: string;
  planId: PlanTier;
  billingInterval: BillingInterval;
  status: SubscriptionStatus;
  startedAt: number;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialStartedAt?: number;
  trialEndsAt?: number;
  cancelAtPeriodEnd: boolean;
  canceledAt?: number;
  provider: BillingProviderType;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  providerPlanId?: string;
  latestPaymentId?: string;
  latestInvoiceId?: string;
  nextBillingAt?: number;
  paidAt?: number;
  activatedAt?: number;
  customLimits?: Partial<PlanLimits>;
  createdAt: number;
  updatedAt: number;
}

export type InvoiceStatus = 'DRAFT' | 'OPEN' | 'PAID' | 'VOID' | 'UNCOLLECTIBLE';

export interface Invoice {
  id: string;
  organizationId: string;
  subscriptionId: string;
  providerInvoiceId?: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: number;
  dueAt: number;
  paidAt?: number;
  invoiceUrl?: string;
  description: string;
  billingInterval?: BillingInterval;
  planId?: PlanTier;
  pdfGenerated?: boolean;
}

export interface QuotaResourceUsage {
  current: number;
  limit: number;
  percent: number;
  isAtLimit: boolean;
  isNearLimit: boolean; // >= 80%
}

export interface Entitlements {
  organizationId: string;
  planId: PlanTier;
  planName: string;
  status: SubscriptionStatus;
  isActive: boolean;
  isTrial: boolean;
  trialDaysRemaining: number;
  billingInterval: BillingInterval;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
  limits: PlanLimits;
  features: PlanFeatures;
  usage: {
    clusters: QuotaResourceUsage;
    nodes: QuotaResourceUsage;
    workloads: QuotaResourceUsage;
    members: QuotaResourceUsage;
    aiInvestigations: QuotaResourceUsage;
    webhooks: {
      current: number;
      allowed: boolean;
    };
    dataRetentionDays: number;
    auditRetentionDays: number;
  };
}

export interface PlanLimitErrorResponse {
  code: 'PLAN_LIMIT_REACHED' | 'FEATURE_NOT_ENTITLED' | 'SUBSCRIPTION_RESTRICTED';
  resource?: 'clusters' | 'nodes' | 'workloads' | 'members' | 'ai_investigations' | 'remediations' | 'webhooks';
  current?: number;
  limit?: number;
  plan: PlanTier;
  upgradeRequired: boolean;
  error: string;
}

export interface CheckoutSessionPayload {
  planId: PlanTier;
  billingInterval: BillingInterval;
  returnUrl?: string;
}

export interface CheckoutSessionResponse {
  sessionId: string;
  planId: PlanTier;
  billingInterval: BillingInterval;
  amount: number;
  currency: string;
  clientSecret?: string;
  paymentUrl?: string;
  provider: BillingProviderType;
}

export interface WebhookEventPayload {
  id: string;
  type: string;
  createdAt: number;
  data: Record<string, any>;
}
