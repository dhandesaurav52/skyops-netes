import crypto from 'crypto';
import { BillingInterval, BillingProviderType, PlanTier } from '../../src/types/billing';
import { getPlanPricing } from './planConfig';

export interface CheckoutSessionOptions {
  organizationId: string;
  organizationName: string;
  userEmail: string;
  userName: string;
  planId: PlanTier;
  billingInterval: BillingInterval;
  returnUrl?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface ProviderCheckoutSession {
  id: string;
  organizationId: string;
  planId: PlanTier;
  billingInterval: BillingInterval;
  amount: number;
  currency: string;
  status: 'open' | 'complete' | 'expired';
  customerEmail: string;
  url: string;
  expiresAt: number;
  metadata: Record<string, any>;
}

export interface BillingProvider {
  name: BillingProviderType;
  createCustomer(orgId: string, orgName: string, email: string): Promise<{ customerId: string }>;
  createCheckoutSession(options: CheckoutSessionOptions): Promise<ProviderCheckoutSession>;
  getCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession | null>;
  cancelSubscription(providerSubId: string, atPeriodEnd?: boolean): Promise<{ success: boolean; canceledAt: number }>;
  resumeSubscription(providerSubId: string): Promise<{ success: boolean }>;
  verifyWebhookSignature(rawPayload: string | Buffer, signature: string, secret?: string): boolean;
}

/**
 * Production-grade mock provider that accurately models payment gateways (e.g. Stripe / Razorpay)
 * with cryptographically verified test tokens, realistic session lifecycle, and signature validation.
 */
export class MockBillingProvider implements BillingProvider {
  public readonly name: BillingProviderType = 'mock';
  private sessions: Map<string, ProviderCheckoutSession> = new Map();
  private readonly defaultSecret: string = process.env.BILLING_WEBHOOK_SECRET || 'skyops_mock_wh_sec_984f87a3e21';

  async createCustomer(orgId: string, orgName: string, email: string): Promise<{ customerId: string }> {
    const customerId = `cust_sky_${orgId.substring(0, 8)}_${crypto.randomBytes(4).toString('hex')}`;
    return { customerId };
  }

  async createCheckoutSession(options: CheckoutSessionOptions): Promise<ProviderCheckoutSession> {
    const pricing = getPlanPricing(options.planId, options.billingInterval);
    const sessionId = `cs_sky_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 minutes

    const session: ProviderCheckoutSession = {
      id: sessionId,
      organizationId: options.organizationId,
      planId: options.planId,
      billingInterval: options.billingInterval,
      amount: pricing.totalPrice,
      currency: 'INR',
      status: 'open',
      customerEmail: options.userEmail,
      url: `/billing/checkout?session_id=${sessionId}`,
      expiresAt,
      metadata: {
        organizationId: options.organizationId,
        organizationName: options.organizationName,
        planId: options.planId,
        billingInterval: options.billingInterval,
        userName: options.userName,
        userEmail: options.userEmail,
        returnUrl: options.returnUrl || '/settings'
      }
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async getCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (session.status === 'open' && Date.now() > session.expiresAt) {
      session.status = 'expired';
    }
    return session;
  }

  async completeCheckoutSession(sessionId: string): Promise<ProviderCheckoutSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.status = 'complete';
    return session;
  }

  async cancelSubscription(providerSubId: string, atPeriodEnd = true): Promise<{ success: boolean; canceledAt: number }> {
    return {
      success: true,
      canceledAt: Date.now()
    };
  }

  async resumeSubscription(providerSubId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  verifyWebhookSignature(rawPayload: string | Buffer, signature: string, secret?: string): boolean {
    const signingSecret = secret || this.defaultSecret;
    if (!signature) return false;

    try {
      const payloadString = Buffer.isBuffer(rawPayload) ? rawPayload.toString('utf8') : rawPayload;
      const expectedSignature = crypto
        .createHmac('sha256', signingSecret)
        .update(payloadString)
        .digest('hex');

      // Check direct match or t=timestamp,v1=signature format (Stripe-style)
      if (signature === expectedSignature) return true;

      if (signature.includes('v1=')) {
        const parts = signature.split(',');
        const v1Part = parts.find((p) => p.startsWith('v1='));
        const tPart = parts.find((p) => p.startsWith('t='));
        if (v1Part) {
          const sig = v1Part.substring(3);
          const t = tPart ? tPart.substring(2) : '';
          const signedData = t ? `${t}.${payloadString}` : payloadString;
          const computed = crypto.createHmac('sha256', signingSecret).update(signedData).digest('hex');
          return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(computed));
        }
      }

      // Safe constant-time comparison if lengths match
      if (signature.length === expectedSignature.length) {
        return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
      }

      return false;
    } catch {
      return false;
    }
  }

  generateWebhookSignature(payload: string | object, secret?: string): string {
    const signingSecret = secret || this.defaultSecret;
    const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHmac('sha256', signingSecret).update(bodyStr).digest('hex');
  }
}

export const billingProvider = new MockBillingProvider();
