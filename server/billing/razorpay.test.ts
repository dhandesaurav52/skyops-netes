import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { RazorpayBillingProvider } from './razorpayProvider.js';
import { billingService } from './billingService.js';
import { store } from '../store.js';

test('Razorpay Payment Gateway Integration Suite', async (t) => {
  const testKeyId = 'rzp_test_sampleKey123';
  const testKeySecret = 'testSecret456Key789';
  const testWebhookSecret = 'whsec_sampleRazorpayWebhookSecret';

  const provider = new RazorpayBillingProvider(testKeyId, testKeySecret, testWebhookSecret);

  await t.test('1. Configuration & Key Management', () => {
    assert.equal(provider.isConfigured(), true);
    assert.equal(provider.getKeyId(), testKeyId);
    assert.equal(provider.name, 'razorpay');
  });

  await t.test('2. Cryptographic Payment Signature Verification', () => {
    const orderId = 'order_DA9v93BvdvXq12';
    const paymentId = 'pay_DA9w8bVdVxq456';
    
    // Valid HMAC-SHA256 signature generated with keySecret
    const validSignature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const isValid = provider.verifyPaymentSignature(orderId, paymentId, validSignature);
    assert.equal(isValid, true, 'Valid HMAC signature must verify as true');

    const isInvalid = provider.verifyPaymentSignature(orderId, paymentId, 'tampered_signature_string_hex_123456');
    assert.equal(isInvalid, false, 'Tampered signature must reject as false');
  });

  await t.test('3. Webhook Signature Verification and Event Parsing', () => {
    const payload = JSON.stringify({
      id: 'evt_test123',
      event: 'order.paid',
      created_at: 1710720000,
      payload: {
        payment: {
          entity: {
            id: 'pay_testPayment789',
            amount: 500000, // 5000 INR
            currency: 'INR',
            status: 'captured',
            notes: {
              orgId: 'test-org-razorpay-001',
              planId: 'PRO',
              billingInterval: 'MONTHLY'
            }
          }
        }
      }
    });

    const signature = crypto.createHmac('sha256', testWebhookSecret).update(payload).digest('hex');
    const result = provider.verifyWebhookSignature(payload, signature);

    assert.equal(result.valid, true);
    assert.ok(result.event);
    assert.equal(result.event.type, 'checkout.completed');
    assert.equal(result.event.data.orgId, 'test-org-razorpay-001');
    assert.equal(result.event.data.amount, 5000);
    assert.equal(result.event.data.currency, 'INR');
  });

  await t.test('4. End-to-End Razorpay Checkout Confirmation & Verification in BillingService', async () => {
    const orgId = `org-rzp-test-${Date.now()}`;
    const orderId = `order_test_${Date.now()}`;
    const paymentId = `pay_test_${Date.now()}`;
    
    // Generate authentic signature
    const signature = crypto
      .createHmac('sha256', testKeySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    // Temporarily set provider
    const { setBillingProvider } = await import('./provider.js');
    setBillingProvider(provider);

    try {
      const confirmResult = await billingService.confirmCheckout(
        orgId,
        'PRO',
        'MONTHLY',
        { id: 'usr-123', name: 'Tester', email: 'tester@skyops.dev' },
        {
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature
        }
      );

      assert.ok(confirmResult.subscription);
      assert.equal(confirmResult.subscription.planId, 'PRO');
      assert.equal(confirmResult.subscription.status, 'ACTIVE');
      assert.equal(confirmResult.subscription.provider, 'razorpay');
      assert.equal(confirmResult.subscription.providerSubscriptionId, paymentId);

      assert.ok(confirmResult.invoice);
      assert.equal(confirmResult.invoice.status, 'PAID');
      assert.equal(confirmResult.invoice.providerInvoiceId, paymentId);
      assert.equal(confirmResult.invoice.amount, 5000);

      // Verify persisted in store
      const persistedSub = store.getSubscription(orgId);
      assert.ok(persistedSub);
      assert.equal(persistedSub.provider, 'razorpay');
      assert.equal(persistedSub.providerSubscriptionId, paymentId);
    } finally {
      // Reset back to default
      setBillingProvider(null);
    }
  });

  await t.test('5. Rejection of Tampered Razorpay Signature in Checkout Confirmation', async () => {
    const orgId = `org-rzp-tamper-${Date.now()}`;
    const orderId = `order_test_${Date.now()}`;
    const paymentId = `pay_test_${Date.now()}`;

    const { setBillingProvider } = await import('./provider.js');
    setBillingProvider(provider);

    try {
      await assert.rejects(
        async () => {
          await billingService.confirmCheckout(
            orgId,
            'BUSINESS',
            'MONTHLY',
            { id: 'usr-123', name: 'Tester', email: 'tester@skyops.dev' },
            {
              razorpayOrderId: orderId,
              razorpayPaymentId: paymentId,
              razorpaySignature: 'invalid_fraudulent_signature'
            }
          );
        },
        /Razorpay payment signature verification failed/
      );
    } finally {
      setBillingProvider(null);
    }
  });
});
