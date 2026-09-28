import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

test('SkyOps Production Footer Specification & Route Verification Suite', async (t) => {
  const footerFilePath = path.resolve(process.cwd(), 'src/components/layout/Footer.tsx');
  const footerSource = fs.readFileSync(footerFilePath, 'utf-8');

  const kbModalFilePath = path.resolve(process.cwd(), 'src/components/docs/KnowledgeBaseModal.tsx');
  const kbModalSource = fs.readFileSync(kbModalFilePath, 'utf-8');

  await t.test('1. Brand & Tagline: matches user requirement exactly', () => {
    assert.match(footerSource, /SkyOps/i, 'Footer must display SkyOps brand');
    assert.match(footerSource, /Kubernetes Incident Management Platform/i, 'Footer must display exact subtitle');
    assert.match(
      footerSource,
      /Observe, investigate, and safely operate Kubernetes environments with evidence-driven intelligence\./i,
      'Footer must display exact mandated tagline'
    );
  });

  await t.test('2. Product Navigation: contains ONLY real existing product routes', () => {
    // Real existing router tabs in AppShell / Sidebar:
    const requiredProductLinks = [
      'Command Center',
      'Infrastructure',
      'Observability',
      'Incidents',
      'Services',
      'AI Investigation',
      'Safe Remediation'
    ];

    for (const link of requiredProductLinks) {
      assert.ok(
        footerSource.includes(link),
        `Footer Product column must include real product feature "${link}"`
      );
    }

    // Verify product click handlers map to authentic navigation tabs
    assert.match(footerSource, /handleProductClick\('overview'/);
    assert.match(footerSource, /handleProductClick\('infrastructure'/);
    assert.match(footerSource, /handleProductClick\('observability'/);
    assert.match(footerSource, /handleProductClick\('incidents'/);
    assert.match(footerSource, /handleProductClick\('services'/);
  });

  await t.test('3. Learn / Get Started: every link has a verified documentation destination', () => {
    const requiredLearnLinks = [
      'Getting Started',
      'Connect Cluster',
      'Agent Guide',
      'Metrics',
      'Logs',
      'Events',
      'Incident Intelligence',
      'Troubleshooting'
    ];

    for (const link of requiredLearnLinks) {
      assert.ok(
        footerSource.includes(link),
        `Footer Get Started column must include destination "${link}"`
      );
    }

    // Ensure all target topics exist in KnowledgeBaseModal
    const targetTopics = [
      'quickstart',
      'connect-cluster',
      'agent-guide',
      'metrics',
      'logs',
      'events',
      'incidents',
      'troubleshooting'
    ];

    for (const topic of targetTopics) {
      assert.ok(
        kbModalSource.includes(`id: '${topic}'`),
        `KnowledgeBaseModal must contain verified article for "${topic}"`
      );
    }
  });

  await t.test('4. Security & Trust: authentic documented architecture only (no unverified claims)', () => {
    const requiredSecurityLinks = [
      'Security Model',
      'Architecture',
      'RBAC & Tenant Isolation',
      'Data & Persistence',
      'API Reference'
    ];

    for (const link of requiredSecurityLinks) {
      assert.ok(
        footerSource.includes(link),
        `Footer Security column must include link "${link}"`
      );
    }

    // Strict negative check: Banned fake claims
    const bannedClaims = [
      'SOC 2',
      'SOC2',
      'ISO 27001',
      'ISO27001',
      'HIPAA',
      'GDPR certified',
      '99.99%',
      'enterprise compliance certified'
    ];

    for (const claim of bannedClaims) {
      const regex = new RegExp(`\\b${claim}\\b`, 'i');
      assert.ok(
        !regex.test(footerSource),
        `Footer must NOT claim "${claim}" without repository evidence`
      );
    }
  });

  await t.test('5. Support Section: official email and clickable mailto link', () => {
    const expectedEmail = 'skyopsnetes2000@gmail.com';
    const expectedMailto = 'mailto:skyopsnetes2000@gmail.com';

    assert.ok(footerSource.includes(expectedEmail), `Footer must display ${expectedEmail}`);
    assert.ok(footerSource.includes(expectedMailto), `Footer must contain clickable ${expectedMailto}`);

    // Verify no other email address is used
    const emailMatches = footerSource.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const email of emailMatches) {
      assert.strictEqual(
        email.toLowerCase(),
        expectedEmail.toLowerCase(),
        `Only official email ${expectedEmail} may be used, found: ${email}`
      );
    }
  });

  await t.test('6. Helpful CTA Block: contains required messaging and action', () => {
    assert.match(
      footerSource,
      /Need help connecting your cluster\?/i,
      'Footer CTA must contain "Need help connecting your cluster?"'
    );
    assert.match(
      footerSource,
      /Follow the quickstart guide or contact SkyOps support\./i,
      'Footer CTA must contain quickstart/support text'
    );
    assert.match(
      footerSource,
      /Get Started/i,
      'Footer CTA must contain "Get Started" action'
    );
  });

  await t.test('7. Banned Content Removal: strictly no social media, GitHub, or fluff', () => {
    const bannedTokens = [
      'github.com',
      'github',
      'twitter.com',
      'twitter',
      'linkedin.com',
      'linkedin',
      'discord.gg',
      'discord',
      'youtube.com',
      'youtube',
      'careers',
      'investors',
      'press',
      'partners'
    ];

    for (const token of bannedTokens) {
      const regex = new RegExp(`\\b${token}\\b`, 'i');
      assert.ok(
        !regex.test(footerSource),
        `Footer must NOT contain banned link/reference: "${token}"`
      );
    }
  });

  await t.test('8. Sub-footer: Built for Kubernetes operations & © 2026 SkyOps', () => {
    assert.match(
      footerSource,
      /Built for Kubernetes operations/i,
      'Sub-footer must state "Built for Kubernetes operations"'
    );
    assert.match(
      footerSource,
      /© 2026 SkyOps/i,
      'Sub-footer must state "© 2026 SkyOps"'
    );
  });

  await t.test('9. Quality check: Zero dead or placeholder href="#" links in Footer', () => {
    assert.ok(
      !footerSource.includes('href="#"'),
      'Footer must not contain dead href="#" links'
    );
    assert.ok(
      !footerSource.includes('e.preventDefault()'),
      'Footer must not contain stub links using e.preventDefault()'
    );
  });
});
