import { Router } from 'express';
import { z } from 'zod';
import { AuthenticatedUserRequest, requireOrgMembership, requirePermission, requireUserAuth } from '../auth';
import { billingService } from './billingService';
import { entitlementService } from './entitlementService';
import { PLANS } from './planConfig';
import { store } from '../store';

export const billingRouter = Router();

// --- Public / Read-Only Plan Config ---
billingRouter.get('/plans', (req, res) => {
  res.json({
    plans: Object.values(PLANS)
  });
});

// --- Subscription & Entitlements ---
billingRouter.get(
  '/subscription',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.read'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const orgId = req.orgId!;
      const subscription = billingService.getSubscription(orgId);
      const entitlements = entitlementService.getEntitlements(orgId);
      res.json({
        subscription,
        entitlements
      });
    } catch (err: any) {
      console.error('[BillingRouter] Subscription fetch error:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch subscription details' });
    }
  }
);

// --- Entitlements & Usage Quotas Endpoint ---
billingRouter.get(
  '/entitlements',
  requireUserAuth,
  requireOrgMembership,
  (req: AuthenticatedUserRequest, res) => {
    try {
      const orgId = req.orgId!;
      const entitlements = entitlementService.getEntitlements(orgId);
      res.json({ entitlements });
    } catch (err: any) {
      console.error('[BillingRouter] Entitlements fetch error:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch entitlements' });
    }
  }
);

// --- Create Checkout Session (Upgrade / Change Plan) ---
const CheckoutSchema = z.object({
  planId: z.enum(['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  billingInterval: z.enum(['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY']),
  returnUrl: z.string().optional()
});

billingRouter.post(
  '/checkout',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.manage'),
  async (req: AuthenticatedUserRequest, res) => {
    const parsed = CheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid checkout payload' });
    }

    try {
      const org = store.getOrg(req.orgId!);
      const session = await billingService.createCheckoutSession(
        req.orgId!,
        org?.name || 'SkyOps Workspace',
        { id: req.user!.id, name: req.user!.name, email: req.user!.email },
        parsed.data.planId,
        parsed.data.billingInterval,
        parsed.data.returnUrl
      );

      res.status(201).json({ session });
    } catch (err: any) {
      console.error('[BillingRouter] Checkout error:', err);
      res.status(400).json({ error: err?.message || 'Failed to initialize checkout session' });
    }
  }
);

// --- Confirm Checkout Session (Payment Completion / Simulated Provider Flow) ---
const ConfirmCheckoutSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required')
});

billingRouter.post(
  '/checkout/confirm',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.manage'),
  async (req: AuthenticatedUserRequest, res) => {
    const parsed = ConfirmCheckoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid confirmation payload' });
    }

    try {
      const result = await billingService.confirmCheckout(
        parsed.data.sessionId,
        req.orgId!,
        { id: req.user!.id, name: req.user!.name, email: req.user!.email }
      );

      const entitlements = entitlementService.getEntitlements(req.orgId!);
      res.json({
        success: true,
        subscription: result.subscription,
        invoice: result.invoice,
        entitlements,
        message: 'Subscription successfully upgraded.'
      });
    } catch (err: any) {
      console.error('[BillingRouter] Confirmation error:', err);
      res.status(400).json({ error: err?.message || 'Failed to complete checkout' });
    }
  }
);

// --- Start 14-day Pro Trial ---
billingRouter.post(
  '/subscription/trial/start',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.manage'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const result = billingService.startProTrial(req.orgId!, {
        id: req.user!.id,
        name: req.user!.name,
        email: req.user!.email
      });
      const entitlements = entitlementService.getEntitlements(req.orgId!);
      res.json({
        success: true,
        subscription: result.subscription,
        entitlements,
        message: result.message
      });
    } catch (err: any) {
      console.error('[BillingRouter] Trial start error:', err);
      res.status(400).json({ error: err?.message || 'Failed to start trial' });
    }
  }
);

// --- Request Cancellation at Period End ---
const CancelSchema = z.object({
  reason: z.string().max(500).optional()
});

billingRouter.post(
  '/subscription/cancel',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.manage'),
  (req: AuthenticatedUserRequest, res) => {
    const parsed = CancelSchema.safeParse(req.body || {});
    try {
      const sub = billingService.requestCancellation(
        req.orgId!,
        { id: req.user!.id, name: req.user!.name, email: req.user!.email },
        parsed.success ? parsed.data.reason : undefined
      );
      const entitlements = entitlementService.getEntitlements(req.orgId!);
      res.json({
        success: true,
        subscription: sub,
        entitlements,
        message: 'Subscription will cancel at the end of the current billing cycle.'
      });
    } catch (err: any) {
      console.error('[BillingRouter] Cancel error:', err);
      res.status(400).json({ error: err?.message || 'Failed to cancel subscription' });
    }
  }
);

// --- Resume Canceled Subscription ---
billingRouter.post(
  '/subscription/resume',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.manage'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const sub = billingService.resumeSubscription(req.orgId!, {
        id: req.user!.id,
        name: req.user!.name,
        email: req.user!.email
      });
      const entitlements = entitlementService.getEntitlements(req.orgId!);
      res.json({
        success: true,
        subscription: sub,
        entitlements,
        message: 'Subscription successfully resumed.'
      });
    } catch (err: any) {
      console.error('[BillingRouter] Resume error:', err);
      res.status(400).json({ error: err?.message || 'Failed to resume subscription' });
    }
  }
);

// --- Invoices & Billing History ---
billingRouter.get(
  '/invoices',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.read'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const invoices = billingService.getInvoices(req.orgId!);
      res.json({ invoices });
    } catch (err: any) {
      console.error('[BillingRouter] Invoices fetch error:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch invoices' });
    }
  }
);

billingRouter.get(
  '/invoices/:id',
  requireUserAuth,
  requireOrgMembership,
  requirePermission('billing.read'),
  (req: AuthenticatedUserRequest, res) => {
    try {
      const invoice = billingService.getInvoice(req.params.id, req.orgId!);
      if (!invoice) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      res.json({ invoice });
    } catch (err: any) {
      console.error('[BillingRouter] Invoice fetch error:', err);
      res.status(500).json({ error: err?.message || 'Failed to fetch invoice' });
    }
  }
);

// --- Inbound Payment Provider Webhook Handler ---
billingRouter.post('/webhook', async (req, res) => {
  const signature = (req.headers['x-skyops-signature'] ||
    req.headers['stripe-signature'] ||
    req.headers['x-razorpay-signature'] ||
    '') as string;

  try {
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);
    const result = await billingService.handleWebhook(rawBody, signature);
    res.json({ received: true, ...result });
  } catch (err: any) {
    console.error('[BillingRouter] Webhook error:', err);
    res.status(400).json({ error: err?.message || 'Webhook processing failed' });
  }
});
