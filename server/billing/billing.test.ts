import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { PLANS, getPlanDefinition } from './planConfig.js';
import { billingService } from './billingService.js';
import { entitlementService } from './entitlementService.js';

process.env.NODE_ENV = 'test';
process.env.SKYOPS_ALLOW_DEMO_AUTH = 'true';

const { app } = await import('../../server.js');
const { store } = await import('../store.js');

const demoToken = (email: string, name: string, role = 'OWNER') =>
  `sky_demo_sre_${role}_${encodeURIComponent(email)}_${encodeURIComponent(name)}`;

async function request(baseUrl: string, path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

test('SkyOps SaaS Billing, Entitlements & Quotas Suite', async (t) => {
  const testOrgId = `test-org-${Date.now()}`;
  const testUser = {
    id: `usr-test-${Date.now()}`,
    name: 'Test SRE',
    email: 'engineer@skyops.dev'
  };

  await t.test('1. Plans catalog verification', () => {
    const freePlan = getPlanDefinition('FREE');
    const proPlan = getPlanDefinition('PRO');
    const businessPlan = getPlanDefinition('BUSINESS');
    const enterprisePlan = getPlanDefinition('ENTERPRISE');

    assert.equal(freePlan.id, 'FREE');
    assert.equal(freePlan.limits.clusters, 1);
    assert.equal(freePlan.features.webhooks, false);

    assert.equal(proPlan.id, 'PRO');
    assert.equal(proPlan.limits.clusters, 5);
    assert.equal(proPlan.features.webhooks, true);
    assert.equal(proPlan.pricing.MONTHLY.totalPrice, 5000);
    assert.equal(proPlan.pricing.YEARLY.savingsPercent, 20);

    assert.equal(businessPlan.id, 'BUSINESS');
    assert.equal(businessPlan.limits.clusters, 20);

    assert.equal(enterprisePlan.id, 'ENTERPRISE');
  });

  await t.test('2. Developer Free subscription & baseline quota check', () => {
    // Force transition to Free to test baseline Free limits
    const { subscription: sub } = billingService.downgradeToFree(testOrgId, testUser);
    assert.equal(sub.organizationId, testOrgId);
    assert.equal(sub.planId, 'FREE');
    assert.equal(sub.status, 'ACTIVE');

    // Check baseline entitlements
    const entitlements = entitlementService.getEntitlements(testOrgId);
    assert.equal(entitlements.planId, 'FREE');
    assert.equal(entitlements.limits.clusters, 1);
    assert.equal(entitlements.features.webhooks, false);

    // Initial quota check with 0 clusters used, requesting 1
    const quotaCheck0 = entitlementService.checkQuota(testOrgId, 'clusters', 1);
    assert.equal(quotaCheck0.allowed, true);
    assert.equal(quotaCheck0.limit, 1);

    // Quota check when requesting 2 clusters (exceeding Free limit of 1)
    const quotaCheck1 = entitlementService.checkQuota(testOrgId, 'clusters', 2);
    assert.equal(quotaCheck1.allowed, false);
    assert.equal(quotaCheck1.upgradeRequired, true);

    // Feature check: Webhooks disabled on FREE
    const webhookEntitlement = entitlementService.checkQuota(testOrgId, 'webhooks');
    assert.equal(webhookEntitlement.allowed, false);
    assert.equal(webhookEntitlement.code, 'FEATURE_NOT_ENTITLED');
  });

  await t.test('3. Starting 14-day Pro Trial expands entitlements', () => {
    const { subscription: trialSub } = billingService.startProTrial(testOrgId, testUser);
    assert.equal(trialSub.planId, 'PRO');
    assert.equal(trialSub.status, 'TRIALING');
    assert.ok(trialSub.trialEndsAt && trialSub.trialEndsAt > Date.now());

    // Check expanded entitlements
    const entitlements = entitlementService.getEntitlements(testOrgId);
    assert.equal(entitlements.planId, 'PRO');
    assert.equal(entitlements.limits.clusters, 5);
    assert.equal(entitlements.limits.members, 10);
    assert.equal(entitlements.features.webhooks, true);

    // Cluster quota now allows up to 5
    const quotaCheck4 = entitlementService.checkQuota(testOrgId, 'clusters', 4);
    assert.equal(quotaCheck4.allowed, true);

    const quotaCheck6 = entitlementService.checkQuota(testOrgId, 'clusters', 6);
    assert.equal(quotaCheck6.allowed, false);

    // Webhooks are now enabled
    const webhookEntitlement = entitlementService.checkQuota(testOrgId, 'webhooks');
    assert.equal(webhookEntitlement.allowed, true);
  });

  await t.test('4. Checkout simulation & payment confirmation creates invoice', async () => {
    const session = await billingService.createCheckoutSession(
      testOrgId,
      'Test Org',
      testUser,
      'PRO',
      'YEARLY'
    );

    assert.ok(session.id);
    assert.equal(session.amount, 48000);
    assert.equal(session.currency, 'INR');

    // Confirm checkout payment
    const result = await billingService.confirmCheckout(session.id, testOrgId, testUser);
    assert.equal(result.subscription.planId, 'PRO');
    assert.equal(result.subscription.status, 'ACTIVE');
    assert.equal(result.subscription.billingInterval, 'YEARLY');
    assert.ok(result.invoice);
    assert.equal(result.invoice.amount, 48000);
    assert.equal(result.invoice.status, 'PAID');

    // Verify invoice is retrievable in invoice history
    const invoices = billingService.getInvoices(testOrgId);
    assert.ok(invoices.length >= 1);
    const invoice = billingService.getInvoice(result.invoice.id, testOrgId);
    assert.ok(invoice);
    assert.equal(invoice?.id, result.invoice.id);
  });

  await t.test('5. Plan Upgrade to BUSINESS via checkout increases capacity and limits', async () => {
    const session = await billingService.createCheckoutSession(
      testOrgId,
      'Test Org',
      testUser,
      'BUSINESS',
      'YEARLY'
    );
    const result = await billingService.confirmCheckout(session.id, testOrgId, testUser);
    assert.equal(result.subscription.planId, 'BUSINESS');

    const entitlements = entitlementService.getEntitlements(testOrgId);
    assert.equal(entitlements.planId, 'BUSINESS');
    assert.equal(entitlements.limits.clusters, 20);
    assert.equal(entitlements.limits.members, 50);
  });

  await t.test('6. Subscription cancellation & reactivation', () => {
    const cancelledSub = billingService.requestCancellation(testOrgId, testUser, 'Customer requested cancellation');
    assert.equal(cancelledSub.cancelAtPeriodEnd, true);

    const reactivatedSub = billingService.resumeSubscription(testOrgId, testUser);
    assert.equal(reactivatedSub.cancelAtPeriodEnd, false);
    assert.equal(reactivatedSub.status, 'ACTIVE');
  });

  await t.test('7. End-to-End HTTP API & Quota Enforcement Integration', async (httpTest) => {
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    httpTest.after(() => server.close());

    const e2eUserEmail = `billing-lead-${Date.now()}@skyops.dev`;
    const e2eUserName = 'Billing Lead';
    const token = demoToken(e2eUserEmail, e2eUserName, 'OWNER');
    const e2eUserId = `demo-sre-${Buffer.from(e2eUserEmail).toString('hex').substring(0, 8)}`;

    store.upsertUser({ id: e2eUserId, email: e2eUserEmail, name: e2eUserName });
    const org = store.createOrganization('E2E Billing Org', e2eUserId, e2eUserEmail, e2eUserName);

    // Ensure the org starts on Free tier for testing limit enforcement
    billingService.downgradeToFree(org.id, { id: e2eUserId, name: e2eUserName, email: e2eUserEmail });

    // 7.1 Verify Plans endpoint returns public catalog
    const plansRes = await request(baseUrl, '/api/v1/billing/plans', token, {
      headers: { 'x-org-id': org.id }
    });
    assert.equal(plansRes.status, 200);
    const plansData = await plansRes.json();
    assert.ok(Array.isArray(plansData.plans));
    assert.ok(plansData.plans.length >= 4);
    assert.ok(plansData.plans.some((p: any) => p.id === 'FREE'));
    assert.ok(plansData.plans.some((p: any) => p.id === 'PRO'));

    // 7.2 Verify Subscription endpoint returns Developer Free
    const subRes = await request(baseUrl, '/api/v1/billing/subscription', token, {
      headers: { 'x-org-id': org.id }
    });
    assert.equal(subRes.status, 200);
    const subData = await subRes.json();
    assert.equal(subData.subscription.planId, 'FREE');

    // 7.3 Verify Entitlements endpoint returns Free limits
    const entRes = await request(baseUrl, '/api/v1/billing/entitlements', token, {
      headers: { 'x-org-id': org.id }
    });
    assert.equal(entRes.status, 200);
    const entData = await entRes.json();
    assert.equal(entData.entitlements.planId, 'FREE');
    assert.equal(entData.entitlements.limits.clusters, 1);
    assert.equal(entData.entitlements.features.webhooks, false);

    // 7.4 Quota Enforcement: Create 1 cluster (Allowed under Free tier)
    const cluster1Res = await request(baseUrl, '/api/v1/clusters', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({ name: 'First Free Cluster' })
    });
    assert.equal(cluster1Res.status, 201);

    // 7.5 Quota Enforcement: Attempt to create 2nd cluster -> 403 PLAN_LIMIT_REACHED
    const cluster2Res = await request(baseUrl, '/api/v1/clusters', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({ name: 'Second Blocked Cluster' })
    });
    assert.equal(cluster2Res.status, 403);
    const quotaBlock = await cluster2Res.json();
    assert.equal(quotaBlock.code, 'PLAN_LIMIT_REACHED');
    assert.equal(quotaBlock.upgradeRequired, true);

    // 7.6 Feature Gating: Attempt to create webhook on Free -> 403 FEATURE_NOT_ENTITLED
    const webhookRes = await request(baseUrl, '/api/v1/integrations/webhooks', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({
        name: 'Slack Alerts',
        url: 'https://hooks.slack.com/services/T00/B00/X00',
        events: ['incident.created']
      })
    });
    assert.equal(webhookRes.status, 403);
    const webhookBlock = await webhookRes.json();
    assert.equal(webhookBlock.code, 'FEATURE_NOT_ENTITLED');
    assert.equal(webhookBlock.upgradeRequired, true);

    // 7.7 Upgrade Flow: Create checkout session for PRO Yearly
    const checkoutRes = await request(baseUrl, '/api/v1/billing/checkout', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({
        planId: 'PRO',
        billingInterval: 'YEARLY'
      })
    });
    assert.equal(checkoutRes.status, 201);
    const checkoutData = await checkoutRes.json();
    assert.ok(checkoutData.session.id);
    assert.equal(checkoutData.session.amount, 48000);

    // 7.8 Confirm checkout session (activates PRO plan and issues invoice)
    const confirmRes = await request(baseUrl, '/api/v1/billing/checkout/confirm', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({
        sessionId: checkoutData.session.id
      })
    });
    assert.equal(confirmRes.status, 200);
    const confirmData = await confirmRes.json();
    assert.equal(confirmData.subscription.planId, 'PRO');
    assert.equal(confirmData.subscription.status, 'ACTIVE');
    assert.ok(confirmData.invoice);
    assert.equal(confirmData.invoice.amount, 48000);

    // 7.9 Now verify that cluster creation and webhooks succeed under PRO plan!
    const cluster2AfterUpgrade = await request(baseUrl, '/api/v1/clusters', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({ name: 'Second Allowed Cluster' })
    });
    assert.equal(cluster2AfterUpgrade.status, 201);

    const webhookAfterUpgrade = await request(baseUrl, '/api/v1/integrations/webhooks', token, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-org-id': org.id },
      body: JSON.stringify({
        name: 'Slack Alerts Pro',
        url: 'https://hooks.slack.com/services/T00/B00/X00',
        events: ['incident.created']
      })
    });
    assert.equal(webhookAfterUpgrade.status, 201);

    // 7.10 Verify Invoice listing endpoint
    const invoicesRes = await request(baseUrl, '/api/v1/billing/invoices', token, {
      headers: { 'x-org-id': org.id }
    });
    assert.equal(invoicesRes.status, 200);
    const invoicesData = await invoicesRes.json();
    assert.ok(invoicesData.invoices.length >= 1);
    assert.equal(invoicesData.invoices[0].amount, 48000);
  });
});
