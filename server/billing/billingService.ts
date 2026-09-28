import crypto from 'crypto';
import { PLANS, resolveEffectiveLimits } from '../../src/config/plans';
import {
  BillingInterval,
  Invoice,
  InvoiceStatus,
  OrgBillingOverview,
  PlanId,
  Subscription,
  SubscriptionStatus
} from '../../src/types';
import { auditService } from '../audit';
import { AuthenticatedUser } from '../auth';
import { store } from '../store';
import { getBillingProvider } from './provider';

export class BillingService {
  private checkoutSessions = new Map<
    string,
    {
      id: string;
      organizationId: string;
      planId: PlanId;
      billingInterval: BillingInterval;
      amount: number;
      currency: string;
      customerEmail: string;
      customerName: string;
      createdAt: number;
      url: string;
    }
  >();

  /**
   * Get active subscription for organization
   */
  public getSubscription(orgId: string): Subscription {
    return this.getOrReconcileSubscription(orgId);
  }

  /**
   * Transition organization immediately to the Developer Free tier
   */
  public downgradeToFree(
    orgId: string,
    actor: { id: string; name: string; email?: string }
  ): { subscription: Subscription } {
    const sub = this.getOrReconcileSubscription(orgId);
    const now = Date.now();
    sub.planId = 'FREE';
    sub.status = 'ACTIVE';
    sub.billingInterval = 'MONTHLY';
    sub.trialStartedAt = undefined;
    sub.trialEndsAt = undefined;
    sub.cancelAtPeriodEnd = false;
    sub.canceledAt = undefined;
    sub.updatedAt = now;
    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'subscription.downgraded',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: { plan: 'FREE' }
    });

    return { subscription: sub };
  }

  /**
   * Start a 14-day full Pro trial
   */
  public startProTrial(
    orgId: string,
    actor: { id: string; name: string; email?: string }
  ): { subscription: Subscription; message: string } {
    const sub = this.getOrReconcileSubscription(orgId);
    const now = Date.now();
    const trialDuration = 14 * 86400000;
    sub.planId = 'PRO';
    sub.status = 'TRIALING';
    sub.trialStartedAt = now;
    sub.trialEndsAt = now + trialDuration;
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = now + trialDuration;
    sub.cancelAtPeriodEnd = false;
    sub.canceledAt = undefined;
    sub.updatedAt = now;
    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'subscription.trial_started',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: { planId: 'PRO', trialDays: 14 }
    });

    return {
      subscription: sub,
      message: '14-day Pro trial successfully activated'
    };
  }

  /**
   * Create checkout session with calculated pricing
   */
  public async createCheckoutSession(
    orgId: string,
    orgName: string,
    actor: { id: string; name: string; email?: string },
    planId: any,
    billingInterval: any,
    returnUrl?: string
  ) {
    const plan = PLANS[planId as PlanId] || PLANS.PRO;
    const pricing = plan.pricing[billingInterval as BillingInterval];
    const amount = pricing ? pricing.totalPrice : 5000;
    const currency = pricing ? pricing.currency : 'INR';
    const sessionId = `cs_sky_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    const session = {
      id: sessionId,
      organizationId: orgId,
      planId: planId as PlanId,
      billingInterval: billingInterval as BillingInterval,
      amount,
      currency,
      status: 'open' as const,
      customerEmail: actor.email || '',
      customerName: actor.name || 'SRE',
      createdAt: Date.now(),
      url: `/billing/checkout?session_id=${sessionId}&org_id=${orgId}`
    };

    this.checkoutSessions.set(sessionId, session);
    return session;
  }

  /**
   * Get complete billing & subscription overview for an organization
   */
  public getSubscriptionOverview(orgId: string): OrgBillingOverview {
    const sub = this.getOrReconcileSubscription(orgId);
    const plan = PLANS[sub.planId] || PLANS.FREE;
    const effectiveLimits = resolveEffectiveLimits(sub.planId, sub.customLimits);

    const now = Date.now();
    const isTrial = sub.status === 'TRIALING';
    const trialDaysRemaining = isTrial && sub.trialEndsAt
      ? Math.max(0, Math.ceil((sub.trialEndsAt - now) / 86400000))
      : undefined;

    // Fetch real live resource counts
    const clusters = store.getClusters(orgId);
    let totalNodes = 0;
    let totalWorkloads = 0;

    for (const c of clusters) {
      totalNodes += c.nodeCount || 0;
      totalWorkloads += c.podCount || 0;
    }

    const members = store.getOrgMembers(orgId).filter((m) => m.status !== 'REMOVED');
    const orgUsage = store.getOrgUsage(orgId);

    const calcPercentage = (current: number, limit: number): number => {
      if (limit === -1) return 0; // Unlimited
      if (limit === 0) return 100;
      return Math.min(100, Math.round((current / limit) * 100));
    };

    const usage = {
      clusters: {
        current: clusters.length,
        limit: effectiveLimits.clusters,
        percentage: calcPercentage(clusters.length, effectiveLimits.clusters)
      },
      nodes: {
        current: totalNodes,
        limit: effectiveLimits.nodes,
        percentage: calcPercentage(totalNodes, effectiveLimits.nodes)
      },
      workloads: {
        current: totalWorkloads,
        limit: effectiveLimits.workloads,
        percentage: calcPercentage(totalWorkloads, effectiveLimits.workloads)
      },
      members: {
        current: members.length,
        limit: effectiveLimits.members,
        percentage: calcPercentage(members.length, effectiveLimits.members)
      },
      aiInvestigations: {
        current: orgUsage.aiAnalysesPerformed || 0,
        limit: effectiveLimits.aiInvestigationsMonthly,
        percentage: calcPercentage(orgUsage.aiAnalysesPerformed || 0, effectiveLimits.aiInvestigationsMonthly)
      },
      remediations: {
        current: orgUsage.remediationsExecuted || 0,
        limit: effectiveLimits.remediationsMonthly,
        percentage: calcPercentage(orgUsage.remediationsExecuted || 0, effectiveLimits.remediationsMonthly)
      },
      retentionDays: effectiveLimits.dataRetentionDays
    };

    const invoices = store.getInvoices(orgId);

    return {
      subscription: sub,
      plan,
      entitlements: {
        limits: effectiveLimits,
        features: plan.features
      },
      usage,
      invoices,
      isTrial,
      trialDaysRemaining
    };
  }

  /**
   * Reconciles expired trials and period renewals
   */
  public getOrReconcileSubscription(orgId: string): Subscription {
    let sub = store.getSubscription(orgId);
    if (!sub) {
      sub = store.getOrCreateOrgSubscription(orgId);
    }

    const now = Date.now();

    // Check if trial has expired
    if (sub.status === 'TRIALING' && sub.trialEndsAt && now > sub.trialEndsAt) {
      sub.status = 'EXPIRED';
      sub.updatedAt = now;
      store.saveSubscription(sub);

      auditService.record({
        orgId,
        actorId: 'system',
        actorName: 'SkyOps Subscription Engine',
        actorType: 'SYSTEM',
        action: 'trial.expired',
        resourceType: 'SUBSCRIPTION',
        resourceId: sub.id,
        result: 'SUCCESS',
        details: { previousPlan: sub.planId, expiredAt: now }
      });
    }

    // Check if subscription canceled at period end has passed its period end
    if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd && now > sub.currentPeriodEnd && sub.status === 'ACTIVE') {
      sub.status = 'CANCELED';
      sub.updatedAt = now;
      store.saveSubscription(sub);

      auditService.record({
        orgId,
        actorId: 'system',
        actorName: 'SkyOps Subscription Engine',
        actorType: 'SYSTEM',
        action: 'subscription.canceled',
        resourceType: 'SUBSCRIPTION',
        resourceId: sub.id,
        result: 'SUCCESS',
        details: { planId: sub.planId, endedAt: now }
      });
    }

    return sub;
  }

  /**
   * Initiate Checkout for an organization
   */
  public async createCheckout(
    orgId: string,
    planId: PlanId,
    interval: BillingInterval,
    user: AuthenticatedUser,
    returnUrl?: string
  ) {
    if (planId === 'FREE') {
      throw new Error('The Free tier does not require commercial payment checkout.');
    }
    if (planId === 'ENTERPRISE') {
      throw new Error('Enterprise plans require custom commercial agreement. Please contact SkyOps Sales.');
    }

    const plan = PLANS[planId];
    if (!plan) {
      throw new Error(`Invalid plan identifier: ${planId}`);
    }

    const pricing = plan.pricing[interval];
    if (!pricing) {
      throw new Error(`Invalid billing duration interval: ${interval}`);
    }

    const org = store.getOrganization(orgId);
    if (!org) {
      throw new Error('Organization not found');
    }

    const provider = getBillingProvider();
    const providerCustomerId = await provider.createCustomer({
      orgId,
      orgName: org.name,
      userEmail: user.email,
      userName: user.name
    });

    const session = await provider.createCheckoutSession({
      orgId,
      planId,
      billingInterval: interval,
      amount: pricing.totalPrice,
      currency: pricing.currency,
      customerEmail: user.email,
      customerName: user.name,
      returnUrl: returnUrl || `/settings?tab=usage&checkout=complete`
    });

    const sessionObj = {
      id: session.id || session.sessionId,
      sessionId: session.sessionId,
      organizationId: orgId,
      planId,
      billingInterval: interval,
      amount: pricing.totalPrice,
      currency: pricing.currency,
      customerEmail: user.email,
      customerName: user.name,
      createdAt: Date.now(),
      url: session.checkoutUrl
    };
    this.checkoutSessions.set(sessionObj.id, sessionObj);
    this.checkoutSessions.set(sessionObj.sessionId, sessionObj);

    return {
      session: {
        ...session,
        id: sessionObj.id,
        amount: pricing.totalPrice
      },
      planName: plan.name,
      intervalLabel: pricing.label,
      totalPrice: pricing.totalPrice,
      currency: pricing.currency,
      savings: pricing.savings
    };
  }

  /**
   * Process a completed payment checkout (e.g. sandbox instant confirmation or verified webhook)
   */
  public async confirmCheckout(
    arg1: string,
    arg2: any,
    arg3?: any,
    arg4?: any,
    arg5?: any
  ): Promise<{ subscription: Subscription; invoice: Invoice }> {
    let orgId: string;
    let planId: PlanId;
    let interval: BillingInterval;
    let actor: { id: string; name: string; email?: string };
    let paymentVerification: { razorpayOrderId?: string; razorpaySubscriptionId?: string; razorpayPaymentId: string; razorpaySignature: string } | undefined;

    // Case 1: Called as confirmCheckout(sessionId, orgId, actor, paymentVerification)
    if (typeof arg1 === 'string' && (arg1.startsWith('cs_') || arg1.startsWith('order_') || arg1.startsWith('sub_') || this.checkoutSessions.has(arg1))) {
      const session = this.checkoutSessions.get(arg1);
      orgId = arg2;
      planId = (session?.planId || 'PRO') as PlanId;
      interval = (session?.billingInterval || 'MONTHLY') as BillingInterval;
      actor = arg3 || { id: 'system', name: 'System Checkout' };
      paymentVerification = arg4;
    } else {
      // Case 2: Called as confirmCheckout(orgId, planId, interval, actor, paymentVerification)
      orgId = arg1;
      planId = arg2 as PlanId;
      interval = arg3 as BillingInterval;
      actor = arg4 || { id: 'system', name: 'System Checkout' };
      paymentVerification = arg5;
    }

    // Cryptographically verify Razorpay signature if payment verification details provided
    if (paymentVerification) {
      const provider = getBillingProvider();
      if ('verifyPaymentSignature' in provider) {
        const isValid = (provider as any).verifyPaymentSignature(
          paymentVerification,
          paymentVerification.razorpayPaymentId,
          paymentVerification.razorpaySignature
        );
        if (!isValid) {
          throw new Error('Razorpay payment signature verification failed');
        }
      }
    }

    const plan = PLANS[planId] || PLANS.PRO;
    const pricing = plan.pricing[interval] || {
      durationMonths: 1,
      label: '1 Month',
      totalPrice: 5000,
      effectiveMonthlyPrice: 5000,
      currency: 'INR',
      savings: '0%'
    };

    const now = Date.now();
    const periodMonths = pricing.durationMonths || 1;
    const periodEnd = now + periodMonths * 30 * 86400000;
    const providerType = (paymentVerification ? 'razorpay' : 'mock') as any;
    const providerSubId = paymentVerification?.razorpaySubscriptionId || paymentVerification?.razorpayPaymentId || `sub_prov_${crypto.randomBytes(8).toString('hex')}`;

    let sub = store.getSubscription(orgId);
    if (!sub) {
      sub = {
        id: `sub-${crypto.randomBytes(8).toString('hex')}`,
        organizationId: orgId,
        planId,
        billingInterval: interval,
        status: 'ACTIVE',
        startedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        provider: providerType,
        providerSubscriptionId: providerSubId,
        latestPaymentId: paymentVerification?.razorpayPaymentId,
        paidAt: now,
        activatedAt: now,
        createdAt: now,
        updatedAt: now
      };
    } else {
      const oldPlan = sub.planId;
      sub.planId = planId;
      sub.billingInterval = interval;
      sub.status = 'ACTIVE';
      sub.currentPeriodStart = now;
      sub.currentPeriodEnd = periodEnd;
      sub.cancelAtPeriodEnd = false;
      sub.canceledAt = undefined;
      sub.trialEndsAt = undefined;
      sub.provider = providerType;
      sub.providerSubscriptionId = providerSubId;
      sub.latestPaymentId = paymentVerification?.razorpayPaymentId;
      sub.paidAt = now;
      sub.activatedAt = now;
      sub.updatedAt = now;

      auditService.record({
        orgId,
        actorId: actor.id,
        actorName: actor.name,
        actorType: 'USER',
        action: oldPlan === planId ? 'subscription.updated' : 'subscription.upgraded',
        resourceType: 'SUBSCRIPTION',
        resourceId: sub.id,
        result: 'SUCCESS',
        details: {
          previousPlan: oldPlan,
          newPlan: planId,
          interval,
          amount: pricing.totalPrice,
          paymentMethod: paymentVerification ? 'razorpay' : 'sandbox',
          razorpayPaymentId: paymentVerification?.razorpayPaymentId,
          razorpayOrderId: paymentVerification?.razorpayOrderId
        }
      });
    }

    store.saveSubscription(sub);

    // Create Invoice
    const invoiceId = `inv-${crypto.randomBytes(8).toString('hex')}`;
    const invoice: Invoice = {
      id: invoiceId,
      organizationId: orgId,
      subscriptionId: sub.id,
      providerInvoiceId: paymentVerification?.razorpayPaymentId || `pi_${crypto.randomBytes(8).toString('hex')}`,
      amount: pricing.totalPrice,
      currency: pricing.currency,
      status: 'PAID',
      issuedAt: now,
      dueAt: now,
      paidAt: now,
      invoiceUrl: `/api/v1/billing/invoices/${invoiceId}/download`,
      description: `SkyOps ${plan.name} Plan (${pricing.label})`,
      planId,
      billingInterval: interval,
      createdAt: now
    };

    store.addInvoice(invoice);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'payment.succeeded',
      resourceType: 'INVOICE',
      resourceId: invoice.id,
      result: 'SUCCESS',
      details: { amount: pricing.totalPrice, currency: pricing.currency, planId, interval }
    });

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'invoice.paid',
      resourceType: 'INVOICE',
      resourceId: invoice.id,
      result: 'SUCCESS',
      details: { invoiceId: invoice.id, amount: pricing.totalPrice }
    });

    return { subscription: sub, invoice };
  }

  /**
   * Safe downgrade implementation:
   * Existing resources are preserved; new resource creation past the lower limit is blocked.
   */
  public async downgradeSubscription(
    orgId: string,
    targetPlanId: PlanId,
    targetInterval: BillingInterval,
    actor: { id: string; name: string }
  ): Promise<Subscription> {
    const sub = this.getOrReconcileSubscription(orgId);
    const oldPlan = sub.planId;

    if (targetPlanId === oldPlan && targetInterval === sub.billingInterval) {
      return sub;
    }

    const now = Date.now();
    sub.planId = targetPlanId;
    sub.billingInterval = targetInterval;
    sub.updatedAt = now;

    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'subscription.downgraded',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: {
        previousPlan: oldPlan,
        newPlan: targetPlanId,
        interval: targetInterval,
        note: 'Safe downgrade: Existing clusters and workloads retained. New allocations subject to revised quotas.'
      }
    });

    return sub;
  }

  /**
   * Cancel subscription at period end
   */
  public cancelSubscription(
    orgId: string,
    actor: { id: string; name: string; email?: string }
  ): Subscription {
    return this.requestCancellation(orgId, actor);
  }

  /**
   * Request subscription cancellation with optional user reason
   */
  public requestCancellation(
    orgId: string,
    actor: { id: string; name: string; email?: string },
    reason?: string
  ): Subscription {
    const sub = this.getOrReconcileSubscription(orgId);

    if (sub.status === 'CANCELED' || sub.cancelAtPeriodEnd) {
      return sub;
    }

    const now = Date.now();
    sub.cancelAtPeriodEnd = true;
    sub.canceledAt = now;
    sub.updatedAt = now;

    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'subscription.cancel_requested',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: {
        planId: sub.planId,
        cancelAtPeriodEnd: true,
        reason,
        effectiveUntil: sub.currentPeriodEnd
      }
    });

    return sub;
  }

  /**
   * Resume / Reverse cancellation
   */
  public resumeSubscription(
    orgId: string,
    actor: { id: string; name: string; email?: string }
  ): Subscription {
    const sub = this.getOrReconcileSubscription(orgId);

    if (!sub.cancelAtPeriodEnd && sub.status === 'ACTIVE') {
      return sub;
    }

    const now = Date.now();
    sub.cancelAtPeriodEnd = false;
    sub.canceledAt = undefined;
    sub.status = 'ACTIVE';
    sub.updatedAt = now;

    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: actor.id,
      actorName: actor.name,
      actorType: 'USER',
      action: 'subscription.resumed',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: { planId: sub.planId }
    });

    return sub;
  }

  /**
   * Get all invoices for an organization
   */
  public getInvoices(orgId: string): Invoice[] {
    return store.getInvoices(orgId);
  }

  /**
   * Get a specific invoice by ID
   */
  public getInvoice(invoiceId: string, orgId?: string): Invoice | undefined {
    const invoices = orgId ? store.getInvoices(orgId) : [];
    return invoices.find((inv) => inv.id === invoiceId);
  }

  /**
   * Process incoming verified billing webhook
   */
  public async handleWebhook(rawPayload: string | Buffer, signature: string) {
    const provider = getBillingProvider();
    const verification = provider.verifyWebhookSignature(rawPayload, signature);

    if (!verification.valid || !verification.event) {
      throw new Error(verification.error || 'Invalid webhook signature');
    }

    const event = verification.event;

    // Idempotency check
    if (store.hasProcessedWebhook(event.id)) {
      return { received: true, idempotentDuplicate: true, eventId: event.id };
    }

    const { orgId, planId, billingInterval, amount, currency } = event.data;

    switch (event.type) {
      case 'checkout.completed':
      case 'subscription.created': {
        if (orgId && planId && billingInterval) {
          await this.confirmCheckout(orgId, planId, billingInterval, {
            id: 'webhook',
            name: 'Payment Gateway Webhook'
          });
        }
        break;
      }

      case 'invoice.paid': {
        if (orgId && event.data.invoiceId) {
          store.updateInvoiceStatus(event.data.invoiceId, 'PAID');
          const sub = store.getSubscription(orgId);
          if (sub && sub.status === 'PAST_DUE') {
            sub.status = 'ACTIVE';
            store.saveSubscription(sub);
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        if (orgId) {
          const sub = store.getSubscription(orgId);
          if (sub) {
            sub.status = 'PAST_DUE';
            sub.updatedAt = Date.now();
            store.saveSubscription(sub);

            auditService.record({
              orgId,
              actorId: 'webhook',
              actorName: 'Payment Gateway',
              actorType: 'SYSTEM',
              action: 'payment.failed',
              resourceType: 'SUBSCRIPTION',
              resourceId: sub.id,
              result: 'FAILURE',
              details: { reason: 'Invoice payment failed', eventId: event.id }
            });
          }
        }
        break;
      }

      case 'subscription.canceled': {
        if (orgId) {
          const sub = store.getSubscription(orgId);
          if (sub) {
            sub.status = 'CANCELED';
            sub.updatedAt = Date.now();
            store.saveSubscription(sub);
          }
        }
        break;
      }

      default:
        console.warn(`[BillingService] Unhandled webhook event type: ${event.type}`);
    }

    store.markWebhookProcessed(event.id);

    return { received: true, eventId: event.id, type: event.type };
  }

  /**
   * Development & QA testbed helper: Simulate subscription transitions
   */
  public simulateSubscriptionState(
    orgId: string,
    targetState: SubscriptionStatus,
    targetPlan?: PlanId,
    targetInterval?: BillingInterval
  ): Subscription {
    const sub = this.getOrReconcileSubscription(orgId);
    const now = Date.now();

    sub.status = targetState;
    if (targetPlan) sub.planId = targetPlan;
    if (targetInterval) sub.billingInterval = targetInterval;

    if (targetState === 'TRIALING') {
      sub.trialStartedAt = now - 5 * 86400000;
      sub.trialEndsAt = now + 9 * 86400000;
    } else if (targetState === 'EXPIRED') {
      sub.trialStartedAt = now - 20 * 86400000;
      sub.trialEndsAt = now - 1 * 86400000;
    }

    sub.updatedAt = now;
    store.saveSubscription(sub);

    auditService.record({
      orgId,
      actorId: 'dev-simulation',
      actorName: 'QA Testbed',
      actorType: 'SYSTEM',
      action: 'subscription.updated',
      resourceType: 'SUBSCRIPTION',
      resourceId: sub.id,
      result: 'SUCCESS',
      details: { simulatedState: targetState, plan: sub.planId }
    });

    return sub;
  }
}

export const billingService = new BillingService();
