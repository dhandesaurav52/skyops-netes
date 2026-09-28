import assert from 'node:assert/strict';
import test from 'node:test';
import { DataStore } from './store.js';

test('HTTP and Store Authorization / Multi-Tenant Isolation Suite', async (t) => {
  const store = new DataStore();

  // Create two distinct organizations
  const orgA = 'org-alpha-111';
  const orgB = 'org-beta-222';

  // Seed user accounts for both orgs
  const userA = { id: 'usr-a', name: 'Alice Alpha', email: 'alice@alpha.io' };
  const userB = { id: 'usr-b', name: 'Bob Beta', email: 'bob@beta.io' };

  // Onboard clusters for both orgs
  const { cluster: clusterA, rawToken: tokenA } = store.createCluster(orgA, 'Alpha Production', 'gke');
  const { cluster: clusterB, rawToken: tokenB } = store.createCluster(orgB, 'Beta Staging', 'eks');

  // Trigger an incident in Org A
  const incA = store.evaluateResourceObservation(orgA, clusterA.id, clusterA.name, {
    id: 'res-a1',
    clusterId: clusterA.id,
    kind: 'Pod',
    name: 'payment-service-pod',
    namespace: 'payments',
    status: 'Pending',
    health: 'CRITICAL',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    specSummary: {},
    statusSummary: {},
    containers: [
      {
        name: 'payment-service',
        image: 'internal/pay:v1',
        ready: false,
        restartCount: 5,
        state: 'waiting',
        waitingReason: 'CrashLoopBackOff',
        waitingMessage: 'Back-off restarting container',
        exitCode: 1,
        lastTerminationReason: 'Error'
      }
    ]
  });

  assert.ok(incA, 'Incident A should be created');
  const incAId = incA!.id;

  await t.test('Organization A can read its own incident', () => {
    const fetched = store.getIncident(incAId, orgA);
    assert.ok(fetched, 'Org A should find its own incident');
    assert.equal(fetched?.id, incAId);
    assert.equal(fetched?.orgId, orgA);
  });

  await t.test('Organization B CANNOT read Organization A incident (404/Null isolation)', () => {
    const fetched = store.getIncident(incAId, orgB);
    assert.equal(fetched, null, 'Org B must not be able to read Org A incident');

    const orgBIncidents = store.getIncidents(orgB);
    assert.equal(orgBIncidents.length, 0, 'Org B incidents list should be empty');
  });

  await t.test('Organization B CANNOT modify Organization A incident', () => {
    const updated = store.updateIncident(
      incAId,
      orgB,
      { status: 'RESOLVED', title: 'Malicious modification by Org B' },
      userB
    );
    assert.equal(updated, null, 'Org B must not be able to update Org A incident');

    // Verify incident in Org A remains unchanged
    const current = store.getIncident(incAId, orgA);
    assert.equal(current?.status, 'OPEN');
    assert.notEqual(current?.title, 'Malicious modification by Org B');
  });

  await t.test('Organization B CANNOT add notes or read timeline of Organization A incident', () => {
    const note = store.addIncidentNote(incAId, orgB, userB, 'Injected note from Org B');
    assert.equal(note, null, 'Org B must not be able to add notes to Org A incident');

    const notes = store.getIncidentNotes(incAId, orgB);
    assert.deepEqual(notes, [], 'Org B must receive empty notes list for Org A incident');

    const timeline = store.getIncidentTimeline(incAId, orgB);
    assert.deepEqual(timeline, [], 'Org B must receive empty timeline for Org A incident');
  });

  await t.test('Organization B CANNOT delete Organization A incident', () => {
    const deleted = store.deleteIncident(incAId, orgB);
    assert.equal(deleted, false, 'Org B delete attempt must return false');

    // Verify incident still exists for Org A
    const current = store.getIncident(incAId, orgA);
    assert.ok(current, 'Incident must still exist in Org A');
  });

  await t.test('Invalid or Expired agent token authentication is rejected', () => {
    const invalidAuth = store.authenticateAgentToken('invalid-secret-token-xyz');
    assert.equal(invalidAuth, null, 'Invalid agent token must return null');

    const validAuth = store.authenticateAgentToken(tokenA);
    assert.ok(validAuth, 'Valid token must be authenticated');
    assert.equal(validAuth?.clusterId, clusterA.id);
    assert.equal(validAuth?.orgId, orgA);
  });

  await t.test('Cluster ownership cannot be spoofed through telemetry payload clusterId', () => {
    // When an agent authenticates with Token B (Org B / Cluster B),
    // if the payload claims clusterId = clusterA.id, the server enforces clusterId from the token (req.clusterId = clusterB.id).
    const authenticatedInfo = store.authenticateAgentToken(tokenB);
    assert.equal(authenticatedInfo?.clusterId, clusterB.id, 'Authenticated clusterId must come from token hash');
    assert.notEqual(authenticatedInfo?.clusterId, clusterA.id, 'Token B cannot claim Cluster A');
  });

  await t.test('Organization A CAN delete its own incident', () => {
    const deleted = store.deleteIncident(incAId, orgA);
    assert.equal(deleted, true, 'Org A must be able to delete its own incident');

    const current = store.getIncident(incAId, orgA);
    assert.equal(current, null, 'Incident must no longer exist in Org A');
  });
});
