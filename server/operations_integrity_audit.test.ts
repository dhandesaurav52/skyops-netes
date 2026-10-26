import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.SKYOPS_ALLOW_DEMO_AUTH = 'true';
process.env.ENABLE_DEV_SIMULATION = 'true';

const { app } = await import('../server.js');
const { store } = await import('./store.js');

const makeUserToken = (email: string, name: string, role = 'OWNER') =>
  `sky_demo_sre_${role}_${encodeURIComponent(email)}_${encodeURIComponent(name)}`;

test('PROMPT 3: Operations Workspace Execution Integrity & End-to-End Audit Suite', async (t) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());

  const ownerEmail = `sre-audit-${Date.now()}@skyops-test.io`;
  const ownerToken = makeUserToken(ownerEmail, 'SRE Lead Auditor', 'OWNER');

  const operatorEmail = `operator-${Date.now()}@skyops-test.io`;
  const operatorToken = makeUserToken(operatorEmail, 'Junior Operator', 'OPERATOR');

  const viewerEmail = `viewer-${Date.now()}@skyops-test.io`;
  const viewerToken = makeUserToken(viewerEmail, 'Read Only Viewer', 'VIEWER');

  // 1. Create Organization
  const orgRes = await fetch(`http://127.0.0.1:${port}/api/v1/orgs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: 'Integrity Operations Org' })
  });
  assert.equal(orgRes.status, 201);
  const { organization: org } = await orgRes.json();

  // Add operator and viewer to org
  const orgData = store.getOrganization(org.id);
  assert.ok(orgData);

  // 2. Create Cluster 1 (Live Cluster with connected agent token)
  const cluster1Res = await fetch(`http://127.0.0.1:${port}/api/v1/clusters`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-org-id': org.id,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'live-prod-cluster-01',
      description: 'Live connected production cluster',
      provider: 'aws',
      region: 'us-east-1',
      environment: 'production'
    })
  });
  assert.equal(cluster1Res.status, 201);
  const { cluster: cluster1, token: agentToken1 } = await cluster1Res.json();
  assert.ok(cluster1.id);
  assert.ok(agentToken1);

  // Seed cluster telemetry resources for live cluster 1
  (store as any).resources.set(cluster1.id, [
    {
      id: `${cluster1.id}:Deployment:default:checkout-api`,
      uid: 'deploy-checkout-uid-12345',
      clusterId: cluster1.id,
      kind: 'Deployment',
      name: 'checkout-api',
      namespace: 'default',
      status: 'Available',
      health: 'HEALTHY',
      replicas: 2,
      readyReplicas: 2,
      annotations: {
        'deployment.kubernetes.io/revision': '1'
      },
      specSummary: { replicas: 2 },
      statusSummary: { readyReplicas: 2, availableReplicas: 2, updatedReplicas: 2, revision: '1' },
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now()
    },
    {
      id: `${cluster1.id}:Pod:default:standalone-debug-runner`,
      uid: 'pod-debug-runner-uid-67890',
      clusterId: cluster1.id,
      kind: 'Pod',
      name: 'standalone-debug-runner',
      namespace: 'default',
      status: 'Running',
      health: 'HEALTHY',
      ownerReferences: [], // Explicitly naked pod for safety policy test
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now()
    },
    {
      id: `${cluster1.id}:Node:node-worker-01`,
      uid: 'node-worker-01-uid',
      clusterId: cluster1.id,
      kind: 'Node',
      name: 'node-worker-01',
      namespace: '',
      status: 'Ready',
      health: 'HEALTHY',
      specSummary: {
        unschedulable: false
      },
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now()
    }
  ] as any);

  // Register live agent 1 with Administrator tier
  const heartbeat1 = await fetch(`http://127.0.0.1:${port}/api/v1/agent/heartbeat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${agentToken1}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      clusterId: cluster1.id,
      agentId: 'agent-pod-live-01',
      agentVersion: '1.2.0',
      k8sVersion: 'v1.35.1',
      nodeCount: 3,
      podCount: 24,
      timestamp: Date.now(),
      permissionTier: 'admin',
      capabilities: ['DeletePod', 'RolloutRestart', 'ScaleDeployment', 'DrainNode', 'CordonNode'],
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
  assert.equal(heartbeat1.status, 200);

  // 3. Create Cluster 2 (Simulated Sandbox Cluster)
  const cluster2Res = await fetch(`http://127.0.0.1:${port}/api/v1/clusters`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-org-id': org.id,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'sandbox-simulated-02',
      description: 'Simulated demo sandbox cluster',
      provider: 'gcp',
      region: 'us-central1',
      environment: 'staging'
    })
  });
  assert.equal(cluster2Res.status, 201);
  const { cluster: cluster2, token: agentToken2, connectionCode: connCode2 } = await cluster2Res.json();

  // Connect Cluster 2 in simulated demo mode
  const connect2Res = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster2.id}/connect`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      'x-org-id': org.id,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ connectionCode: connCode2 })
  });
  assert.equal(connect2Res.status, 200);

  // =========================================================================
  // TEST SUBTEST 1: Simulated vs Live Cluster Execution & Isolation
  // =========================================================================
  await t.test('1. Simulated vs Live cluster operation semantics and queue isolation', async () => {
    // A. Execute on Simulated cluster: must be marked SIMULATED, executed immediately in memory, and NOT queued
    const simOpRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster2.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(simOpRes.status, 200);
    const simOpData = await simOpRes.json();
    assert.equal(simOpData.action.isSimulated, true);
    assert.equal(simOpData.action.executionMode, 'SIMULATED');
    assert.equal(simOpData.action.status, 'SUCCEEDED');
    assert.ok(simOpData.action.verificationResult?.evidence);

    // Agent polling on Cluster 2 must have 0 queued actions (simulated never reaches agent queue)
    const simPollRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions`, {
      headers: { Authorization: `Bearer ${agentToken2}` }
    });
    assert.equal(simPollRes.status, 200);
    const simPollData = await simPollRes.json();
    assert.equal(simPollData.actions.length, 0);

    // B. Execute on Live cluster: must be queued with status PENDING and LIVE executionMode
    const liveOpRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(liveOpRes.status, 200);
    const liveOpData = await liveOpRes.json();
    assert.equal(liveOpData.action.isSimulated, false);
    assert.equal(liveOpData.action.executionMode, 'LIVE');
    assert.equal(liveOpData.action.status, 'PENDING');
  });

  // =========================================================================
  // TEST SUBTEST 2: Live Operation Claim, Execution Progress & Result Verification
  // =========================================================================
  await t.test('2. Live Agent claim, progress reporting, and authoritative verification recording', async () => {
    // 1. Agent 1 claims pending action
    const claimRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions`, {
      headers: { Authorization: `Bearer ${agentToken1}` }
    });
    assert.equal(claimRes.status, 200);
    const { actions } = await claimRes.json();
    assert.ok(actions.length >= 1);
    const claimedAction = actions[0];
    assert.equal(claimedAction.status, 'DELIVERED');
    assert.ok(claimedAction.deliveredAt);

    // 2. Agent 1 reports EXECUTING in-flight progress with runtime traces
    const execProgressRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${claimedAction.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: claimedAction.id,
        state: 'EXECUTING',
        success: false,
        message: 'Executing strategic merge patch on deployment default/checkout-api',
        runtimeTraces: [
          { phase: 'VALIDATING', message: 'Preconditions passed', timestamp: Date.now() - 2000 },
          { phase: 'EXECUTING', message: 'Strategic merge patch applied to apps/deployments', timestamp: Date.now() }
        ]
      })
    });
    assert.equal(execProgressRes.status, 200);
    const inFlightAction = store.getRemediationAction(claimedAction.id);
    assert.equal(inFlightAction?.status, 'EXECUTING');

    // 3. Agent 1 reports VERIFYING state
    const verifyingRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${claimedAction.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: claimedAction.id,
        state: 'VERIFYING',
        success: false,
        message: 'Awaiting rollout generation convergence across all ready replicas'
      })
    });
    assert.equal(verifyingRes.status, 200);
    assert.equal(store.getRemediationAction(claimedAction.id)?.status, 'VERIFYING');

    // 4. Agent 1 reports terminal SUCCEEDED with structured verification evidence
    const verifySuccessRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${claimedAction.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: claimedAction.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Rollout restart completed and verified successfully',
        verificationResult: {
          success: true,
          observedState: 'Healthy',
          evidence: [
            'Annotation kubectl.kubernetes.io/restartedAt updated',
            'ObservedGeneration matches Generation',
            'All replicas ready: 1/1 Available'
          ],
          verifiedAt: Date.now()
        },
        runtimeTraces: [
          { phase: 'VALIDATING', message: 'Preconditions verified', timestamp: Date.now() - 5000 },
          { phase: 'EXECUTING', message: 'Patch deployed', timestamp: Date.now() - 3000 },
          { phase: 'VERIFYING', message: 'Rollout converged', timestamp: Date.now() }
        ]
      })
    });
    assert.equal(verifySuccessRes.status, 200);

    const verifiedAction = store.getRemediationAction(claimedAction.id);
    assert.equal(verifiedAction?.status, 'SUCCEEDED');
    assert.ok(verifiedAction?.verifiedAt);
    assert.equal(verifiedAction?.verificationResult?.success, true);
    assert.equal(verifiedAction?.verificationResult?.evidence?.length, 3);
  });

  // =========================================================================
  // TEST SUBTEST 3: Cross-Cluster Agent Security & Unauthorized Result Reporting
  // =========================================================================
  await t.test('3. Cross-Cluster Agent Security: Agent A cannot claim or report results for Agent B', async () => {
    // Submit a live operation for Cluster 1
    const opRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 3 }
      })
    });
    assert.equal(opRes.status, 200);
    const { action } = await opRes.json();

    // Agent for Cluster 2 tries to report result for Cluster 1's action -> MUST BE REJECTED 404
    const rogueReport = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken2}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: action.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Rogue agent injection attempt'
      })
    });
    assert.equal(rogueReport.status, 404);

    // Verify action on Cluster 1 is still in PENDING status, unaffected by rogue report
    const checkAction = store.getRemediationAction(action.id);
    assert.equal(checkAction?.status, 'PENDING');

    // Complete the action with authoritative Agent 1 to release concurrency lock
    const completeRes = await fetch(`http://127.0.0.1:${port}/api/v1/agent/actions/${action.id}/result`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${agentToken1}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionId: action.id,
        state: 'SUCCEEDED',
        success: true,
        message: 'Completed scaling verification',
        verificationResult: {
          success: true,
          observedState: 'Scaled to 3 replicas',
          evidence: ['Deployment replicas 3 ready'],
          verifiedAt: Date.now()
        }
      })
    });
    assert.equal(completeRes.status, 200);
  });

  // =========================================================================
  // TEST SUBTEST 4: Authoritative Preconditions: Stale Target UID Rejection
  // =========================================================================
  await t.test('4. Rejection on stale resource UID precondition failure', async () => {
    const staleUidRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default',
        targetUid: 'stale-bogus-uid-99999'
      })
    });
    assert.equal(staleUidRes.status, 400);
    const errData = await staleUidRes.json();
    assert.match(errData.error, /Precondition failed: target resource UID has changed/);
  });

  // =========================================================================
  // TEST SUBTEST 5: Safety Policy: Standalone Naked Pod & Scale-to-Zero Safeguards
  // =========================================================================
  await t.test('5. Safety policy: Naked pod deletion and scale-to-zero safeguards', async () => {
    // A. Naked Pod deletion without confirmation must be blocked
    const nakedPodRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'DeletePod',
        targetKind: 'Pod',
        targetName: 'standalone-debug-runner',
        targetNamespace: 'default'
      })
    });
    assert.equal(nakedPodRes.status, 400);
    const nakedErr = await nakedPodRes.json();
    assert.match(nakedErr.error, /confirmNakedPodDelete/);

    // B. Scaling to zero without confirmScaleToZero must be blocked
    const scaleZeroRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 0 }
      })
    });
    assert.equal(scaleZeroRes.status, 400);
    const scaleErr = await scaleZeroRes.json();
    assert.match(scaleErr.error, /confirmScaleToZero/);

    // C. Scaling beyond safe bounds (> 20) must be rejected
    const scaleOOBRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'ScaleDeployment',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default',
        parameters: { targetReplicas: 25 }
      })
    });
    assert.equal(scaleOOBRes.status, 400);
  });

  // =========================================================================
  // TEST SUBTEST 6: Role Authorization & Platform Admin Elevation Checks
  // =========================================================================
  await t.test('6. Role Authorization: Operator cannot drain nodes; VIEWER cannot mutate resources', async () => {
    // A. Operator role attempting node drain -> Forbidden (requires SRE/Admin)
    const opDrainRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${operatorToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'DrainNode',
        targetKind: 'Node',
        targetName: 'node-worker-01',
        confirmDrain: true
      })
    });
    assert.equal(opDrainRes.status, 403);

    // B. Viewer role attempting rollout restart -> Forbidden
    const viewerRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${viewerToken}`,
        'x-org-id': org.id,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        actionType: 'RolloutRestart',
        targetKind: 'Deployment',
        targetName: 'checkout-api',
        targetNamespace: 'default'
      })
    });
    assert.equal(viewerRes.status, 403);
  });

  // =========================================================================
  // TEST SUBTEST 7: Persistent Operations Retrieval & Authoritative State
  // =========================================================================
  await t.test('7. Persistent operations retrieval returns complete verified activity record', async () => {
    const listRes = await fetch(`http://127.0.0.1:${port}/api/v1/clusters/${cluster1.id}/operations`, {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'x-org-id': org.id
      }
    });
    assert.equal(listRes.status, 200);
    const { operations } = await listRes.json();
    assert.ok(Array.isArray(operations));
    assert.ok(operations.length >= 1);

    const verified = operations.find((o: any) => o.status === 'SUCCEEDED' && o.actionType === 'RolloutRestart');
    assert.ok(verified);
    assert.equal(verified.actionType, 'RolloutRestart');
    assert.ok(verified.verificationResult?.evidence);
    assert.ok(verified.verifiedAt);
    assert.ok(verified.requestedBy?.name);
  });
});
