import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SKYOPS_ALLOW_DEMO_AUTH = 'true';

const { app } = await import('../server.js');
const { store } = await import('./store.js');
const { auditService } = await import('./audit.js');

const demoToken = (email: string, name: string, role = 'OWNER') =>
  `sky_demo_sre_${role}_${encodeURIComponent(email)}_${encodeURIComponent(name)}`;

async function request(baseUrl: string, path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

test('HTTP security boundaries enforce tenant isolation and viewer RBAC', async (t) => {
  const aliceEmail = `alice-${Date.now()}@example.com`;
  const bobEmail = `bob-${Date.now()}@example.com`;
  const viewerEmail = `viewer-${Date.now()}@example.com`;
  const aliceToken = demoToken(aliceEmail, 'Alice');
  const bobToken = demoToken(bobEmail, 'Bob');
  const viewerToken = demoToken(viewerEmail, 'Viewer', 'VIEWER');

  const aliceId = `demo-sre-${Buffer.from(aliceEmail).toString('hex').substring(0, 8)}`;
  const bobId = `demo-sre-${Buffer.from(bobEmail).toString('hex').substring(0, 8)}`;
  const viewerId = `demo-sre-${Buffer.from(viewerEmail).toString('hex').substring(0, 8)}`;
  store.upsertUser({ id: aliceId, email: aliceEmail, name: 'Alice' });
  store.upsertUser({ id: bobId, email: bobEmail, name: 'Bob' });
  store.upsertUser({ id: viewerId, email: viewerEmail, name: 'Viewer' });
  const orgA = store.createOrganization('HTTP Alpha', aliceId, aliceEmail, 'Alice');
  const orgB = store.createOrganization('HTTP Beta', bobId, bobEmail, 'Bob');
  const clusterA = store.createCluster(orgA.id, 'Alpha Cluster');
  const invitation = store.inviteMember(orgB.id, viewerEmail, 'VIEWER', { id: bobId, name: 'Bob', email: bobEmail });
  store.acceptInvitation(invitation.token, { id: viewerId, email: viewerEmail, name: 'Viewer' });
  const clusterB = store.createCluster(orgB.id, 'Beta Cluster');
  const incidentB = store.evaluateResourceObservation(orgB.id, clusterB.cluster.id, clusterB.cluster.name, {
    id: 'pod-beta', clusterId: clusterB.cluster.id, kind: 'Pod', name: 'beta-pod', namespace: 'default', status: 'Pending', health: 'WARNING',
    createdAt: Date.now(), updatedAt: Date.now(), specSummary: {}, statusSummary: {}, containers: [{
      name: 'beta', image: 'example/beta:1', ready: false, restartCount: 4, state: 'waiting', waitingReason: 'CrashLoopBackOff', exitCode: 1, lastTerminationReason: 'Error'
    }]
  } as any);
  auditService.record({ orgId: orgB.id, actorId: bobId, actorName: 'Bob', actorType: 'USER', action: 'test.beta', resourceType: 'CLUSTER', resourceId: clusterB.cluster.id, result: 'SUCCESS' });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(() => server.close());

  await t.test('cross-tenant cluster, incident, telemetry, logs, and audit access is denied', async () => {
    const cluster = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}`, aliceToken);
    assert.equal(cluster.status, 404);
    const incident = await request(baseUrl, `/api/v1/incidents/${incidentB!.id}`, aliceToken);
    assert.equal(incident.status, 404);
    const telemetry = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}/telemetry`, aliceToken);
    assert.equal(telemetry.status, 404);
    const logs = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}/pods/default/beta-pod/logs`, aliceToken);
    assert.equal(logs.status, 404);
    const audit = await request(baseUrl, `/api/v1/audit?orgId=${encodeURIComponent(orgB.id)}`, aliceToken);
    assert.equal(audit.status, 403);
    const forgedOrg = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}`, aliceToken, { headers: { 'x-org-id': orgB.id } });
    assert.equal(forgedOrg.status, 403);
    const privilegedManifest = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}/manifests`, bobToken, { headers: { 'x-org-id': orgB.id } });
    assert.equal(privilegedManifest.status, 200);
    assert.equal((await privilegedManifest.json()).token, clusterB.rawToken);
    const crossTenantAgent = await fetch(`${baseUrl}/api/v1/clusters/${clusterB.cluster.id}/manifest.yaml`, {
      headers: { Authorization: `Bearer ${clusterA.rawToken}` }
    });
    assert.equal(crossTenantAgent.status, 403);
  });

  await t.test('viewer cannot mutate clusters, retrieve manifests, approve, or execute actions', async () => {
    const create = await request(baseUrl, '/api/v1/clusters', viewerToken, { method: 'POST', body: JSON.stringify({ name: 'Forbidden' }), headers: { 'content-type': 'application/json', 'x-org-id': orgB.id } });
    assert.equal(create.status, 403);
    const connect = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}/connect`, viewerToken, { method: 'POST', body: JSON.stringify({ connectionCode: 'invalid' }), headers: { 'content-type': 'application/json', 'x-org-id': orgB.id } });
    assert.equal(connect.status, 403);
    const remove = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}`, viewerToken, { method: 'DELETE', headers: { 'x-org-id': orgB.id } });
    assert.equal(remove.status, 403);
    const manifest = await request(baseUrl, `/api/v1/clusters/${clusterB.cluster.id}/manifests`, viewerToken, { headers: { 'x-org-id': orgB.id } });
    assert.equal(manifest.status, 403);
    const approve = await request(baseUrl, `/api/v1/incidents/${incidentB!.id}/remediation/approve`, viewerToken, { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json', 'x-org-id': orgB.id } });
    assert.equal(approve.status, 403);
    const execute = await request(baseUrl, '/api/v1/agent/actions', viewerToken, { headers: { 'x-org-id': orgB.id } });
    assert.equal(execute.status, 403);
  });

  await t.test('forged user identity in request payload does not change authorization', async () => {
    const response = await request(baseUrl, '/api/v1/clusters', aliceToken, { method: 'POST', body: JSON.stringify({ name: 'Alice Cluster', userId: bobId, orgId: orgB.id, role: 'OWNER' }), headers: { 'content-type': 'application/json', 'x-org-id': orgA.id } });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.equal(created.cluster.orgId, orgA.id);
  });
});
