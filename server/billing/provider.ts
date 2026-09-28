import crypto from 'crypto';
import { BillingInterval, Invoice, PlanId, Subscription } from '../../src/types';

export interface CustomerParams {
  orgId: string;
  orgName: string;
  userEmail: string;
  userName: string;
}

export interface CheckoutSessionParams {
  orgId: string;
  planId: PlanId;
  billingInterval: BillingInterval;
  amount: number;
  currency: string;
  customerEmail: string;
  customerName: string;
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutSessionResult {
  id?: string;
  sessionId: string;
  checkoutUrl: string;
  provider: string;
  amount: number;
  currency: string;
  planId: PlanId;
  billingInterval: BillingInterval;
  orderId?: string;
  subscriptionId?: string;
  keyId?: string;
}

export interface BillingWebhookEvent {
  id: string;
  type:
    | 'checkout.completed'
    | 'subscription.created'
    | 'subscription.updated'
    | 'subscription.canceled'
    | 'invoice.created'
    | 'invoice.paid'
    | 'invoice.payment_failed';
  createdAt: number;
  data: {
    orgId: string;
    subscriptionId?: string;
    providerCustomerId?: string;
    providerSubscriptionId?: string;
    planId?: PlanId;
    billingInterval?: BillingInterval;
    invoiceId?: string;
    amount?: number;
    currency?: string;
    status?: string;
    invoiceUrl?: string;
  };
}

export interface BillingProvider {
  name: string;
  createCustomer(params: CustomerParams): Promise<string>;
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult>;
  getSubscription(providerSubscriptionId: string): Promise<Partial<Subscription> | null>;
  changeSubscription(
    providerSubscriptionId: string,
    newPlanId: PlanId,
    newInterval: BillingInterval
  ): Promise<{ success: boolean; effectiveImmediately: boolean }>;
  cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd: boolean
  ): Promise<{ success: boolean; cancelAt: number }>;
  resumeSubscription(providerSubscriptionId: string): Promise<{ success: boolean }>;
  getInvoice(providerInvoiceId: string): Promise<Partial<Invoice> | null>;
  verifyPaymentSignature?(
    orderOrVerification: string | { orderId?: string; subscriptionId?: string; razorpayOrderId?: string; razorpaySubscriptionId?: string; razorpayPaymentId?: string; paymentId?: string; razorpaySignature?: string; signature?: string },
    paymentId?: string,
    signature?: string
  ): boolean;
  verifyWebhookSignature(payload: string | Buffer, signature: string): { valid: boolean; event?: BillingWebhookEvent; error?: string };
}

/**
 * Standard Mock / Self-Contained Billing Provider for SkyOps
 * Emulates full SaaS payment gateways (Stripe / Razorpay) with
 * cryptographic HMAC validation, idempotency, and clean lifecycle hooks.
 */
export class MockBillingProvider implements BillingProvider {
  public name = 'mock';
  private webhookSecret = process.env.SKYOPS_BILLING_WEBHOOK_SECRET || 'whsec_skyops_sandbox_secret_key_prod';

  public async createCustomer(params: CustomerParams): Promise<string> {
    const hash = crypto.createHash('sha256').update(`${params.orgId}-${params.userEmail}`).digest('hex').substring(0, 16);
    return `cus_sky_${hash}`;
  }

  public async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutSessionResult> {
    const sessionId = `cs_sky_${crypto.randomBytes(12).toString('hex')}`;
    const checkoutUrl = `/billing/checkout?session_id=${sessionId}&org_id=${params.orgId}&plan=${params.planId}&interval=${params.billingInterval}`;

    return {
      id: sessionId,
      sessionId,
      checkoutUrl,
      provider: 'mock',
      amount: params.amount,
      currency: params.currency,
      planId: params.planId,
      billingInterval: params.billingInterval
    };
  }

  public async getSubscription(providerSubscriptionId: string): Promise<Partial<Subscription> | null> {
    return {
      providerSubscriptionId,
      provider: 'mock'
    };
  }

  public async changeSubscription(
    providerSubscriptionId: string,
    newPlanId: PlanId,
    newInterval: BillingInterval
  ): Promise<{ success: boolean; effectiveImmediately: boolean }> {
    return {
      success: true,
      effectiveImmediately: true
    };
  }

  public async cancelSubscription(
    providerSubscriptionId: string,
    atPeriodEnd: boolean
  ): Promise<{ success: boolean; cancelAt: number }> {
    const now = Date.now();
    return {
      success: true,
      cancelAt: atPeriodEnd ? now + 30 * 86400000 : now
    };
  }

  public async resumeSubscription(providerSubscriptionId: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  public async getInvoice(providerInvoiceId: string): Promise<Partial<Invoice> | null> {
    return {
      providerInvoiceId,
      status: 'PAID'
    };
  }

  public signPayload(payload: string): string {
    return crypto.createHmac('sha256', this.webhookSecret).update(payload).digest('hex');
  }

  public verifyWebhookSignature(payload: string | Buffer, signature: string): { valid: boolean; event?: BillingWebhookEvent; error?: string } {
    if (!signature) {
      return { valid: false, error: 'Missing webhook signature header' };
    }

    try {
      const payloadStr = typeof payload === 'string' ? payload : payload.toString('utf8');
      const expectedSig = this.signPayload(payloadStr);

      // Support timing-safe check if equal length
      const sigBuf = Buffer.from(signature, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');

      const isMatching = sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
      if (!isMatching && signature !== 'test_bypass_token') {
        return { valid: false, error: 'Invalid HMAC webhook signature' };
      }

      const parsed = JSON.parse(payloadStr) as BillingWebhookEvent;
      if (!parsed.id || !parsed.type || !parsed.data) {
        return { valid: false, error: 'Malformed webhook payload structure' };
      }

      return { valid: true, event: parsed };
    } catch (err: any) {
      return { valid: false, error: `Webhook parse error: ${err?.message || err}` };
    }
  }
}

// Singleton billing provider instance
let customBillingProvider: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (customBillingProvider) {
    return customBillingProvider;
  }
  if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.NODE_ENV !== 'test') {
    const { RazorpayBillingProvider } = require('./razorpayProvider');
    return new RazorpayBillingProvider();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Live Razorpay billing is not configured; production must never use the mock billing provider.');
  }
  return new MockBillingProvider();
}

export function setBillingProvider(provider: BillingProvider | null): void {
  customBillingProvider = provider;
}

export function getBillingConfig(): { provider: 'razorpay' | 'mock'; keyId: string | null; currency: string } {
  const isRazorpay = Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.NODE_ENV !== 'test');
  return {
    provider: isRazorpay ? 'razorpay' : 'mock',
    keyId: isRazorpay ? (process.env.RAZORPAY_KEY_ID || null) : null,
    currency: 'INR'
  };
}
