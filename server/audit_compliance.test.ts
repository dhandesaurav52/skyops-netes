import test from 'node:test';
import assert from 'node:assert/strict';
import { auditService, computeAuditHash } from './audit';
import { getPersistenceStore } from './persistence/index';

test('SkyOps Enterprise Audit & Compliance Ledger Suite', async (t) => {
  const store = getPersistenceStore();
  const orgA = 'org-audit-alpha';
  const orgB = 'org-audit-beta';

  await t.test('1. Strict Tenant Isolation: Org A cannot query Org B audit records', async () => {
    // Record event for Org A
    const evA = auditService.record({
      orgId: orgA,
      actorId: 'usr-alice',
      actorName: 'Alice Ops',
      actorType: 'HUMAN',
      action: 'cluster.created',
      resourceType: 'CLUSTER',
      resourceId: 'cls-alpha-01',
      result: 'SUCCESS',
      details: { region: 'us-central1', nodes: 3 }
    });

    // Record event for Org B
    const evB = auditService.record({
      orgId: orgB,
      actorId: 'usr-bob',
      actorName: 'Bob Security',
      actorType: 'HUMAN',
      action: 'cluster.created',
      resourceType: 'CLUSTER',
      resourceId: 'cls-beta-01',
      result: 'SUCCESS',
      details: { region: 'europe-west1', nodes: 5 }
    });

    const queryA = auditService.query({ orgId: orgA });
    const queryB = auditService.query({ orgId: orgB });

    assert.ok(queryA.items.some((e) => e.id === evA.id), 'Org A should see its own event');
    assert.ok(!queryA.items.some((e) => e.id === evB.id), 'Org A must NOT see Org B events');

    assert.ok(queryB.items.some((e) => e.id === evB.id), 'Org B should see its own event');
    assert.ok(!queryB.items.some((e) => e.id === evA.id), 'Org B must NOT see Org A events');
  });

  await t.test('2. Multi-Actor Diversity: HUMAN, AGENT, AI, SYSTEM, WEBHOOK, AUTOMATION', async () => {
    auditService.record({
      orgId: orgA,
      actorId: 'agent-cls-alpha',
      actorName: 'SkyOps DaemonSet Agent',
      actorType: 'AGENT',
      action: 'remediation.executed',
      resourceType: 'REMEDIATION',
      resourceId: 'rem-101',
      result: 'SUCCESS',
      details: { pod: 'nginx-front', status: 'RolledOut' }
    });

    auditService.record({
      orgId: orgA,
      actorId: 'gemini-1.5-pro',
      actorName: 'SkyOps Incident AI',
      actorType: 'AI',
      action: 'ai.root_cause_diagnosed',
      resourceType: 'INCIDENT',
      resourceId: 'inc-202',
      result: 'SUCCESS',
      details: { confidence: 0.94, rootCause: 'OOMKilled container memory leak' }
    });

    auditService.record({
      orgId: orgA,
      actorId: 'wh-pagerduty',
      actorName: 'PagerDuty Dispatcher',
      actorType: 'WEBHOOK',
      action: 'integration.webhook_dispatched',
      resourceType: 'INTEGRATION',
      resourceId: 'wh-303',
      result: 'SUCCESS'
    });

    // Filter by actorType: AGENT
    const agentEvents = auditService.query({ orgId: orgA, actorType: 'AGENT' });
    assert.ok(agentEvents.items.length > 0);
    assert.ok(agentEvents.items.every((e) => e.actorType === 'AGENT'));

    // Filter by actorType: AI
    const aiEvents = auditService.query({ orgId: orgA, actorType: 'AI' });
    assert.ok(aiEvents.items.length > 0);
    assert.ok(aiEvents.items.every((e) => e.actorType === 'AI'));
  });

  await t.test('3. SHA-256 Ledger Cryptographic Chaining and Integrity Verification', async () => {
    const integrityBefore = await auditService.verifyIntegrity(orgA);
    assert.strictEqual(integrityBefore.verified, true, 'Cryptographic chain must verify as intact');
    assert.strictEqual(integrityBefore.tampered, false);
    assert.ok(integrityBefore.totalChecked >= 4);
    assert.ok(integrityBefore.latestHash.length === 64, 'SHA-256 hash must be 64 hex characters');

    // Add another event and ensure it chains to previous hash
    const latestEvent = auditService.record({
      orgId: orgA,
      actorId: 'usr-alice',
      actorName: 'Alice Ops',
      actorType: 'HUMAN',
      action: 'policy.updated',
      resourceType: 'POLICY',
      resourceId: 'pol-root',
      result: 'SUCCESS'
    });

    assert.ok(latestEvent.hash, 'Event must have SHA-256 hash');
    assert.strictEqual(latestEvent.prevHash, integrityBefore.latestHash, 'New event must chain to previous hash');

    const integrityAfter = await auditService.verifyIntegrity(orgA);
    assert.strictEqual(integrityAfter.verified, true);
    assert.strictEqual(integrityAfter.latestHash, latestEvent.hash);
  });

  await t.test('4. Full-Text Search and Metadata Filtering', async () => {
    const searchRes = auditService.query({ orgId: orgA, search: 'OOMKilled' });
    assert.ok(searchRes.items.length > 0, 'Search should locate details substring');
    assert.ok(searchRes.items.some((e) => e.action === 'ai.root_cause_diagnosed'));

    const searchAction = auditService.query({ orgId: orgA, search: 'remediation.executed' });
    assert.ok(searchAction.items.length > 0);
  });

  await t.test('5. Summary Statistics and Metrics Aggregation', async () => {
    const stats = await auditService.getStats(orgA);
    assert.ok(stats.total >= 5);
    assert.ok(stats.actorCounts.HUMAN !== undefined || stats.actorCounts.USER !== undefined);
    assert.ok(stats.actorCounts.AGENT >= 1);
    assert.ok(stats.actorCounts.AI >= 1);
    assert.ok(stats.autonomousCount >= 2);
    assert.strictEqual(stats.verified, true);
  });

  await t.test('6. Immutable Export to CSV and JSON with Tenant Quarantine', async () => {
    const csvA = auditService.exportCsv({ orgId: orgA });
    assert.ok(csvA.includes('Event ID,Timestamp (ISO),Actor Name'));
    assert.ok(csvA.includes('Alice Ops'));
    assert.ok(!csvA.includes('Bob Security'), 'Exported CSV must never leak other tenants data');

    const jsonA = auditService.exportJson({ orgId: orgA });
    assert.ok(Array.isArray(jsonA));
    assert.ok(jsonA.every((e) => e.orgId === orgA), 'Exported JSON array must be strictly scoped to Org A');
  });
});
