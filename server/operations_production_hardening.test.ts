import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import crypto from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SKYOPS_ALLOW_DEMO_AUTH = 'true';
process.env.ENABLE_DEV_SIMULATION = 'true';

const { app } = await import('../server.js');
const { store } = await import('./store.js');

const makeUserToken = (email: string, name: string, role = 'OWNER') =>
  `sky_demo_sre_${role}_${encodeURIComponent(email)}_${encodeURIComponent(name)}`;

test('PROMPT 4: Operations Workspace Production Hardening & Failure Recovery Suite', async (t) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());

  const ownerEmail = `hardening-lead-${Date.now()}@skyops.io`;
  const ownerToken = makeUserToken(ownerEmail, 'SRE Lead Hardening', 'OWNER');

  const operatorEmail = `hardening-op-${Date.now()}@skyops.io`;
  const operatorToken = makeUserToken(operatorEmail, 'Junior Operator', 'OPERATOR');

  const viewerEmail = `hardening-view-${Date.now()}@skyops.io`;
  const viewerToken = makeUserToken(viewerEmail, 'Read Only Auditor', 'VIEWER');

  // 1. Create Organization
  const orgRes = await fetch(`http://127.0.0.1:${port}/api/v1/orgs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'Hardening & Resilience Org' })
  });
  assert.equal(orgRes.status, 201);
  const { organization: org } = await orgRes.json();

  const orgData = store.getOrganization(org.id);
  assert.ok(orgData);

  // Add operator and viewer to org members with authoritative roles
  const orgMembers = store.getOrgMembers(org.id);
  const opHash = crypto.createHash('sha256').update(operatorEmail.toLowerCase()).digest('hex').substring(0, 16);
  orgMembers.push({
    membershipId: `mem-${org.id}-op`,
    userId: `demo-sre-${opHash}`,
    orgId: org.id,
    email: operatorEmail,
    name: 'Junior Operator',
    role: 'OPERATOR',
    status: 'ACTIVE',
    joinedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  const viewHash = crypto.createHash('sha256').update(viewerEmail.toLowerCase()).digest('hex').substring(0, 16);
  orgMembers.push({
    membershipId: `mem-${org.id}-view`,
    userId: `demo-sre-${viewHash}`,
    orgId: org.id,
    email: viewerEmail,
    name: 'Read Only Auditor',
    role: 'VIEWER',
    status: 'ACTIVE',
    joinedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  store.setOrgMembers(org.id, orgMembers);

  // 2. Create Cluster with connected Agent
  const clusterRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-org-id': org.id,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'hardened-prod-cluster-01',
      description: 'Production cluster with full safety checks',
      provider: 'gcp',
      region: 'us-central1',
      environment: 'production'
    })
  });
  assert.equal(clusterRes.status, 201);
  const { cluster, token: agentToken } = await clusterRes.json();

  // Seed resources in cluster
  (store as any).resources.set(cluster.id, [
    {
      id: `${cluster.id}:Deployment:default:payments-api`,
      uid: 'uid-payments-api-prod',
      clusterId: cluster.id,
      kind: 'Deployment',
      name: 'payments-api',
      namespace: 'default',
      status: 'Available',
      health: 'HEALTHY',
      replicas: 3,
      readyReplicas: 3,
      annotations: { 'deployment.kubernetes.io/revision': '2' },
      specSummary: { replicas: 3 },
      statusSummary: { readyReplicas: 3, availableReplicas: 3, updatedReplicas: 3, revision: '2' },
      createdAt: Date.now() - 7200000,
      updatedAt: Date.now()
    },
    {
      id: `${cluster.id}:Pod:default:standalone-migration-runner`,
      uid: 'uid-standalone-migration-runner',
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'standalone-migration-runner',
      namespace: 'default',
      status: 'Running',
      health: 'HEALTHY',
      ownerReferences: [], // Naked pod (no controller)
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now()
    },
    {
      id: `${cluster.id}:Node:prod-worker-node-1`,
      uid: 'uid-prod-worker-node-1',
      clusterId: cluster.id,
      kind: 'Node',
      name: 'prod-worker-node-1',
      namespace: '',
      status: 'Ready',
      health: 'HEALTHY',
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now()
    }
  ] as any);

  // Send initial agent heartbeat (admin tier)
  const hbRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clusterId: cluster.id,
      agentId: 'agent-prod-01',
      agentVersion: '1.4.0',
      k8sVersion: 'v1.35.1',
      nodeCount: 3,
      podCount: 35,
      timestamp: Date.now(),
      permissionTier: 'admin',
      operationalCapabilities: {
        canDeletePods: true,
        canRestartDeployments: true,
        canScaleDeployments: true,
        canScaleStatefulSets: true,
        canMutateCronJobs: true,
        canCreateJobs: true,
        canDeleteJobs: true,
        canCordonNodes: true,
        canDrainNodes: true
      }
    })
  });
  assert.equal(hbRes.status, 200);

  // =========================================================================
  // SUBTEST 1: Idempotency Protection & Deduplication
  // =========================================================================
  await t.test('1. Idempotency Key Deduplication: Repeated submission returns same action without duplicate mutation', async () => {
    const testIdemKey = `idem-key-test-${Date.now()}`;

    // First submission
    const res1 = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default',
        idempotencyKey: testIdemKey
      })
    });
    assert.equal(res1.status, 200);
    const data1 = await res1.json();
    assert.ok(data1.action?.id);
    assert.equal(data1.action.idempotencyKey, testIdemKey);

    // Second submission with identical idempotencyKey
    const res2 = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default',
        idempotencyKey: testIdemKey
      })
    });
    assert.equal(res2.status, 200);
    const data2 = await res2.json();

    // Must return the exact same action ID without duplicate queue entry
    assert.equal(data2.action.id, data1.action.id);
    assert.match(data2.message, /already dispatched with idempotency key/);

    // Complete the action with the agent to release the deployment lock
    await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${data1.action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: data1.action.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Restart complete and verified',
        verificationResult: {
          success: true,
          observedState: 'Available',
          evidence: ['Rollout restart completed'],
          verifiedAt: Date.now()
        }
      })
    });
  });

  // =========================================================================
  // SUBTEST 2: Target Resource Concurrency Lock (409 Conflict)
  // =========================================================================
  await t.test('2. Concurrency Lock: Simultaneous in-flight requests on same resource are rejected with 409', async () => {
    // 1. Submit first in-flight operation
    const op1 = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 4 }
      })
    });
    assert.equal(op1.status, 200);
    const { action: inFlightAction } = await op1.json();

    // 2. Submit second conflicting operation on payments-api while op1 is still in-flight
    const op2 = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(op2.status, 409);
    const errData = await op2.json();
    assert.match(errData.error, /Conflict: Operation "ScaleDeployment" is already in progress/);

    // Complete op1 to release lock
    await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${inFlightAction.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: inFlightAction.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Scaled to 4'
      })
    });
  });

  // =========================================================================
  // SUBTEST 3: Terminal State Immutability
  // =========================================================================
  await t.test('3. Terminal State Immutability: Late in-flight updates cannot overwrite or regress terminal states', async () => {
    // Dispatch and complete an action
    const dispatchRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(dispatchRes.status, 200);
    const { action } = await dispatchRes.json();

    // Terminal result reported: SUCCEEDED
    const successRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: action.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Authoritative completion reached',
        verificationResult: {
          success: true,
          observedState: 'Healthy',
          evidence: ['Verified convergence'],
          verifiedAt: Date.now()
        }
      })
    });
    assert.equal(successRes.status, 200);

    // Late arriving EXECUTING progress report from network jitter
    const lateReport = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: action.id,
        state: 'EXECUTING',
        success: false,
        message: 'Stale delayed network packet'
      })
    });
    assert.equal(lateReport.status, 200);

    // Verify stored action remains strictly SUCCEEDED
    const verifiedAction = store.getRemediationAction(action.id);
    assert.equal(verifiedAction?.status, 'SUCCEEDED');
    assert.equal(verifiedAction?.verificationResult?.observedState, 'Healthy');
  });

  // =========================================================================
  // SUBTEST 4: Agent Disconnect / Stalled Action Reaper & Unknown Mutation State
  // =========================================================================
  await t.test('4. Agent Disconnect & Reaper: Stalled actions transition to TIMEOUT with explicit UNKNOWN mutation state', async () => {
    // 1. Submit an action
    const opRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 2 }
      })
    });
    assert.equal(opRes.status, 200);
    const { action } = await opRes.json();

    // 2. Agent claims action
    const claimRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions`, {
      headers: { Authorization: `Bearer ${agentToken}` }
    });
    assert.equal(claimRes.status, 200);

    // 3. Agent reports EXECUTING state
    await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: action.id,
        state: 'EXECUTING',
        success: false,
        message: 'Applying patch'
      })
    });

    const storedAction = store.getRemediationAction(action.id);
    assert.equal(storedAction?.status, 'EXECUTING');

    // 4. Simulate agent disconnect: Mark cluster agentStatus OFFLINE and connectionState offline
    const liveCluster = store.getClusterByIdInternal(cluster.id)!;
    assert.ok(liveCluster);
    liveCluster.lastHeartbeat = Date.now() - 400 * 1000; // 400s ago
    liveCluster.lastSeenAt = Date.now() - 400 * 1000;
    liveCluster.agentStatus = 'OFFLINE';
    liveCluster.connectionState = 'offline';
    liveCluster.connectionStatus = 'disconnected';

    // Fast-forward timestamp past DISCONNECTED_TIMEOUT_MS (3 minutes)
    const futureTime = Date.now() + 5 * 60 * 1000;
    const reapedCount = store.reconcileStalledActions(futureTime);
    assert.ok(reapedCount >= 1);

    // 5. Verify action transitioned to TIMEOUT with explicit UNKNOWN errorCategory and safety message
    const timedOutAction = store.getRemediationAction(action.id);
    assert.equal(timedOutAction?.status, 'TIMEOUT');
    assert.equal(timedOutAction?.executionResult?.errorCategory, 'TIMEOUT');
    assert.match(timedOutAction?.executionResult?.message || '', /UNKNOWN/);

    // Restore cluster state for remaining tests
    liveCluster.lastHeartbeat = Date.now();
    liveCluster.lastSeenAt = Date.now();
    liveCluster.agentStatus = 'CONNECTED';
    liveCluster.connectionState = 'connected';
    liveCluster.connectionStatus = 'connected';
  });

  // =========================================================================
  // SUBTEST 5: Authorization & Safety Boundaries Enforcement
  // =========================================================================
  await t.test('5. Authorization & Safety: Destructive operations require explicit confirmation and appropriate role tier', async () => {
    // A. Naked Pod deletion without confirmNakedPodDelete -> 400
    const nakedRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'DeletePod',
        targetKind: 'Pod',
        targetName: 'standalone-migration-runner',
        targetNamespace: 'default'
      })
    });
    assert.equal(nakedRes.status, 400);
    const nakedErr = await nakedRes.json();
    assert.match(nakedErr.error, /confirmNakedPodDelete/);

    // B. Scale to 0 without confirmScaleToZero -> 400
    const zeroRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 0 }
      })
    });
    assert.equal(zeroRes.status, 400);
    const zeroErr = await zeroRes.json();
    assert.match(zeroErr.error, /confirmScaleToZero/);

    // C. Node drain without confirmDrain -> 400
    const drainNoConfirm = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'DrainNode',
        targetKind: 'Node',
        targetName: 'prod-worker-node-1'
      })
    });
    assert.equal(drainNoConfirm.status, 400);
    const drainErr = await drainNoConfirm.json();
    assert.match(drainErr.error, /confirmDrain/);

    // D. Operator role attempting node drain -> 403 Forbidden (requires Admin/SRE)
    const opDrain = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operatorToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'DrainNode',
        targetKind: 'Node',
        targetName: 'prod-worker-node-1',
        confirmDrain: true
      })
    });
    assert.equal(opDrain.status, 403);

    // E. Viewer role attempting rollout restart -> 403 Forbidden
    const viewRestart = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'payments-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(viewRestart.status, 403);
  });
});
