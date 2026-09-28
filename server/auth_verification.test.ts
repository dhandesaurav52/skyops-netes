import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFirebaseIdToken } from './auth.js';

test('Firebase Auth Verification Suite', async (t) => {
  await t.test('accepts demo token in non-production environment', async () => {
    const previous = process.env.SKYOPS_ALLOW_DEMO_AUTH;
    process.env.SKYOPS_ALLOW_DEMO_AUTH = 'true';
    const rawDemoToken = 'sky_demo_sre_OWNER_dhandesaurav52%40gmail.com_Alex%20Rivera';
    const user = await verifyFirebaseIdToken(rawDemoToken, 'skyops-a1143');
    assert.equal(user.email, 'dhandesaurav52@gmail.com');
    assert.equal(user.name, 'Alex Rivera');
    assert.equal(user.emailVerified, true);
    assert.ok(user.id.startsWith('demo-sre-'));
    if (previous === undefined) delete process.env.SKYOPS_ALLOW_DEMO_AUTH;
    else process.env.SKYOPS_ALLOW_DEMO_AUTH = previous;
  });

  await t.test('rejects demo token when explicit opt-in is disabled', async () => {
    const previous = process.env.SKYOPS_ALLOW_DEMO_AUTH;
    process.env.SKYOPS_ALLOW_DEMO_AUTH = 'false';
    await assert.rejects(() => verifyFirebaseIdToken('sky_demo_sre_OWNER_test%40example.com_Test', 'skyops-a1143'), { message: 'Demo authentication is disabled' });
    if (previous === undefined) delete process.env.SKYOPS_ALLOW_DEMO_AUTH;
    else process.env.SKYOPS_ALLOW_DEMO_AUTH = previous;
  });

  await t.test('rejects malformed token', async () => {
    await assert.rejects(
      async () => {
        await verifyFirebaseIdToken('not-a-jwt', 'skyops-a1143');
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
        iss: 'https://securetoken.google.com/skyops-a1143',
        aud: 'skyops-a1143',
        sub: 'usr-123',
        exp: expiredExp
      })
    ).toString('base64url');
    const token = `${header}.${payload}.mock-signature`;

    await assert.rejects(
      async () => {
        await verifyFirebaseIdToken(token, 'skyops-a1143');
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
        await verifyFirebaseIdToken(token, 'skyops-a1143');
      },
      { message: 'Invalid Firebase token audience: unauthorized-attacker-project' }
    );
  });
});
