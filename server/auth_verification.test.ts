import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFirebaseIdToken } from './auth.js';

test('Firebase Auth Verification Suite', async (t) => {
  await t.test('accepts demo token in non-production environment', async () => {
    const rawDemoToken = 'sky_demo_sre_OWNER_dhandesaurav52%40gmail.com_Alex%20Rivera';
    const user = await verifyFirebaseIdToken(rawDemoToken, 'skyops-netes-56b89');
    assert.equal(user.email, 'dhandesaurav52@gmail.com');
    assert.equal(user.name, 'Alex Rivera');
    assert.equal(user.emailVerified, true);
    assert.ok(user.id.startsWith('demo-sre-'));
  });

  await t.test('rejects malformed token', async () => {
    await assert.rejects(
      async () => {
        await verifyFirebaseIdToken('not-a-jwt', 'skyops-netes-56b89');
      },
      { message: 'Malformed or unparseable Firebase ID token' }
    );
  });

  await t.test('rejects expired token beyond tolerance window', async () => {
    // Construct expired JWT payload (exp: 1000 seconds ago)
    const header = Buffer.from(JSON.stringify({ kid: 'test-kid', alg: 'RS256' })).toString('base64url');
    const expiredExp = Math.floor(Date.now() / 1000) - 120; // 120 seconds ago (> 60s tolerance)
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://securetoken.google.com/ai-studio-applet-webapp-4bb6f',
        aud: 'ai-studio-applet-webapp-4bb6f',
        sub: 'usr-123',
        exp: expiredExp
      })
    ).toString('base64url');
    const token = `${header}.${payload}.mock-signature`;

    await assert.rejects(
      async () => {
        await verifyFirebaseIdToken(token, 'skyops-netes-56b89');
      },
      { message: 'Firebase ID token has expired' }
    );
  });

  await t.test('rejects token with completely unauthorized project audience', async () => {
    const header = Buffer.from(JSON.stringify({ kid: 'test-kid', alg: 'RS256' })).toString('base64url');
    const validExp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://securetoken.google.com/unauthorized-attacker-project',
        aud: 'unauthorized-attacker-project',
        sub: 'usr-attacker',
        exp: validExp
      })
    ).toString('base64url');
    const token = `${header}.${payload}.mock-signature`;

    await assert.rejects(
      async () => {
        await verifyFirebaseIdToken(token, 'skyops-netes-56b89');
      },
      { message: 'Invalid Firebase token audience: unauthorized-attacker-project' }
    );
  });
});
