import test from 'node:test';
import assert from 'node:assert/strict';
import { DataStore } from './store';
import { RemediationPolicyEngine } from './engine/policy';
import { RemediationAction, Incident, RemediationPolicy, KubernetesResource, StructuredRemediation } from '../src/types/index';

test('Controlled Autonomous Remediation & Policy Engine Suite', async (t) => {
  await t.test('Policy Engine: State Machine transitions', () => {
    // Valid transitions
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('PROPOSED', 'APPROVED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('APPROVED', 'DISPATCHED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('DISPATCHED', 'DELIVERED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('PENDING', 'DELIVERED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('DELIVERED', 'SUCCEEDED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('DELIVERED', 'FAILED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('SUCCEEDED', 'VERIFIED_RESOLVED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('SUCCEEDED', 'VERIFICATION_FAILED'));
    assert.doesNotThrow(() => RemediationPolicyEngine.assertValidTransition('PENDING', 'CANCELLED'));

    // Invalid transitions
    assert.throws(
      () => RemediationPolicyEngine.assertValidTransition('SUCCEEDED', 'PENDING'),
      /Illegal remediation state transition/
    );
    assert.throws(
      () => RemediationPolicyEngine.assertValidTransition('CANCELLED', 'SUCCEEDED'),
      /Illegal remediation state transition/
    );
    assert.throws(
      () => RemediationPolicyEngine.assertValidTransition('VERIFIED_RESOLVED', 'DELIVERED'),
      /Illegal remediation state transition/
    );
  });

  await t.test('Policy Engine: Autonomous Policy Decisions', () => {
    const defaultPolicy = RemediationPolicyEngine.getDefaultPolicy('org-test', 'cluster-1');
    const baseAction: RemediationAction = {
      id: 'act-1',
      incidentId: 'inc-1',
      orgId: 'org-test',
      clusterId: 'cluster-1',
      clusterName: 'production-us-east',
      actionType: 'ReplacePodImage',
      type: 'ReplacePodImage',
      target: { kind: 'Pod', namespace: 'default', name: 'payment-worker', container: 'app' },
      fieldPath: '/spec/containers/app/image',
      expectedCurrentValue: 'registry.corp/payment:v1.2.0',
      proposedValue: 'registry.corp/payment:v1.1.9',
      requestedBy: { type: 'AUTONOMOUS_POLICY', name: 'SkyOps Autonomous Policy Engine' },
      status: 'PROPOSED',
      createdAt: Date.now(),
      expiresAt: Date.now() + 300000,
      executionId: 'exec-1',
      idempotencyKey: 'idem-1',
      verificationPlan: {
        expectedState: 'Running',
        observationWindowSeconds: 30,
        timeoutSeconds: 120
      },
      rollbackPlan: {
        supported: true,
        strategy: 'Restore previous image',
        rollbackValue: 'registry.corp/payment:v1.2.0'
      },
      riskLevel: 'LOW',
      isExecutable: true
    };

    const baseIncident: Incident = {
      id: 'inc-1',
      fingerprint: 'fp-1',
      orgId: 'org-test',
      clusterId: 'cluster-1',
      clusterName: 'production-us-east',
      title: 'ImagePullBackOff in payment-worker',
      incidentType: 'ImagePullBackOff',
      status: 'OPEN',
      severity: 'HIGH',
      confidence: 'HIGH',
      resourceKind: 'Pod',
      resourceName: 'payment-worker',
      namespace: 'default',
      occurrenceCount: 1,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
      summary: 'Pod image pull failing',
      rootCauseAnalysis: 'ErrImagePull',
      updatedAt: Date.now(),
      technicalDetails: {
        containers: [{ name: 'app', image: 'registry.corp/payment:v1.2.0', ready: false, restartCount: 0, state: 'waiting' }]
      }
    };

    // 1. In MANUAL_ONLY mode -> Human confirmation required
    const manualPolicy: RemediationPolicy = { ...defaultPolicy, remediationMode: 'MANUAL_ONLY' };
    const res1 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, manualPolicy);
    assert.equal(res1.allowed, false);
    assert.equal(res1.decision, 'REQUIRES_APPROVAL');

    // 2. In APPROVAL_REQUIRED mode -> Human confirmation required
    const approvalPolicy: RemediationPolicy = { ...defaultPolicy, remediationMode: 'APPROVAL_REQUIRED' };
    const res2 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, approvalPolicy);
    assert.equal(res2.allowed, false);
    assert.equal(res2.decision, 'REQUIRES_APPROVAL');

    // 3. In CONTROLLED_AUTONOMOUS mode, low risk, standalone pod -> Allowed
    const autoPolicy: RemediationPolicy = {
      ...defaultPolicy,
      remediationMode: 'CONTROLLED_AUTONOMOUS'
    };
    const res3 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, autoPolicy, {
      isStandalonePod: true,
      hasActiveTargetLock: false,
      recentClusterActionsCount: 0,
      incidentFailureCount: 0,
      telemetryAgeMs: 5000
    });
    assert.equal(res3.allowed, true);
    assert.equal(res3.decision, 'ALLOW');

    // 4. In CONTROLLED_AUTONOMOUS mode, high risk action -> Human approval required
    const highRiskAction: RemediationAction = { ...baseAction, riskLevel: 'HIGH' };
    const res4 = RemediationPolicyEngine.evaluatePolicy(highRiskAction, baseIncident, autoPolicy, {
      isStandalonePod: true
    });
    assert.equal(res4.allowed, false);
    assert.equal(res4.decision, 'REQUIRES_APPROVAL');

    // 5. In excluded namespace -> Denied
    const kubeAction: RemediationAction = {
      ...baseAction,
      target: { ...baseAction.target, namespace: 'kube-system' }
    };
    const kubeIncident: Incident = { ...baseIncident, namespace: 'kube-system' };
    const namespaceRestrictedPolicy: RemediationPolicy = {
      ...autoPolicy,
      allowedNamespaces: ['default', 'production']
    };
    const res5 = RemediationPolicyEngine.evaluatePolicy(kubeAction, kubeIncident, namespaceRestrictedPolicy);
    assert.equal(res5.allowed, false);
    assert.equal(res5.decision, 'DENY');

    // 6. Controller-managed pod (e.g. has ReplicaSet owner) -> Controller owned
    const res6 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, autoPolicy, {
      isStandalonePod: false
    });
    assert.equal(res6.allowed, false);
    assert.equal(res6.decision, 'CONTROLLER_OWNED');

    // 7. Rate limit exceeded (> maxAutonomousPerHour) -> Rate limited
    const res7 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, autoPolicy, {
      isStandalonePod: true,
      recentClusterActionsCount: 15
    });
    assert.equal(res7.allowed, false);
    assert.equal(res7.decision, 'RATE_LIMITED');

    // 8. Circuit breaker tripped (failures >= maxAttemptsPerIncident) -> Circuit breaker tripped
    const res8 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, autoPolicy, {
      isStandalonePod: true,
      incidentFailureCount: 3
    });
    assert.equal(res8.allowed, false);
    assert.equal(res8.decision, 'CIRCUIT_BREAKER_TRIPPED');

    // 9. Concurrency conflict (active target lock) -> Target busy
    const res9 = RemediationPolicyEngine.evaluatePolicy(baseAction, baseIncident, autoPolicy, {
      isStandalonePod: true,
      hasActiveTargetLock: true
    });
    assert.equal(res9.allowed, false);
    assert.equal(res9.decision, 'TARGET_BUSY');
  });

  await t.test('DataStore End-to-End Controlled Autonomous Remediation Lifecycle', () => {
    const store = new DataStore();
    const userId = 'usr-auto-test';
    store.upsertUser({ id: userId, email: 'auto@test.com', name: 'Auto Tester' });
    const org = store.createOrganization('Autonomous Test Org', userId);
    const { cluster } = store.createCluster(org.id, 'prod-cluster');

    // Configure cluster policy for CONTROLLED_AUTONOMOUS
    const policy = store.updateRemediationPolicy(org.id, {
      remediationMode: 'CONTROLLED_AUTONOMOUS',
      maxActionsPerHourPerCluster: 10,
      maxAttemptsPerIncident: 2
    }, cluster.id);
    assert.equal(policy.remediationMode, 'CONTROLLED_AUTONOMOUS');

    // Ingest standalone pod telemetry that has ImagePullBackOff (manifest unknown => high confidence)
    const now = Date.now();
    const failingPod: KubernetesResource = {
      id: `pod-${cluster.id}-batch-worker`,
      uid: 'pod-uid-1',
      clusterId: cluster.id,
      name: 'batch-worker',
      namespace: 'default',
      kind: 'Pod',
      status: 'Waiting',
      health: 'CRITICAL',
      createdAt: now - 60000,
      updatedAt: now,
      specSummary: {
        containers: [{ name: 'worker', image: 'registry.internal/worker:v2.0.1-broken' }]
      },
      statusSummary: {
        observedState: 'Waiting',
        containerStates: [
          {
            name: 'worker',
            state: 'waiting',
            ready: false,
            image: 'registry.internal/worker:v2.0.1-broken',
            waiting: { reason: 'ImagePullBackOff', message: 'manifest unknown: tag not found' }
          }
        ]
      },
      containers: [
        {
          name: 'worker',
          image: 'registry.internal/worker:v2.0.1-broken',
          ready: false,
          restartCount: 0,
          state: 'waiting',
          waitingReason: 'ImagePullBackOff',
          waitingMessage: 'manifest unknown: tag not found'
        }
      ]
    };
    store.syncClusterResources(cluster.id, [failingPod]);

    // Check incident was opened
    const incidents = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.ok(incidents.length > 0, 'Incident should be detected');
    const incident = incidents[0];

    // Save a proposed remediation -> Should be autonomously evaluated and dispatched!
    const remediationPayload: StructuredRemediation = {
      id: `REM-${incident.id}-1`,
      incidentId: incident.id,
      orgId: org.id,
      clusterId: cluster.id,
      clusterName: cluster.name,
      status: 'PROPOSED',
      targetResource: { kind: 'Pod', name: 'batch-worker', namespace: 'default' },
      actionType: 'ReplacePodImage',
      parameters: {
        containerName: 'worker',
        currentImage: 'registry.internal/worker:v2.0.1-broken',
        proposedImage: 'registry.internal/worker:v2.0.0-stable'
      },
      reasoning: {
        summary: 'Roll back broken container',
        whyRecommended: 'Pod failing image pull',
        expectedImpact: 'Restore pod to ready state',
        rollbackStrategy: 'Roll back image',
        confidence: 90,
        rootCause: 'Broken configuration in container image v2.0.1',
        explanation: 'Roll back container to previous known working image',
        risk: 'LOW',
        rollbackPlan: 'Restore broken tag if needed'
      },
      createdAt: now,
      updatedAt: now,
      isExecutable: true
    };
    store.saveRemediation(remediationPayload);

    // Verify remediation is now DISPATCHED
    const rem = store.getRemediation(incident.id, org.id);
    assert.ok(rem);
    assert.equal(rem.status, 'DISPATCHED', 'Remediation should be autonomously dispatched');
    assert.ok(rem.approval?.approvedBy?.userId.includes('autonomous'));

    // Agent polls for actions -> claims pending remediation
    const claimedActions = store.claimPendingRemediationActions(cluster.id);
    assert.equal(claimedActions.length, 1);
    const action = claimedActions[0];
    assert.equal(action.status, 'DELIVERED');
    assert.ok(action.leaseExpiresAt! > Date.now());

    // Agent executes and reports result
    const ackAction = store.recordRemediationResult(cluster.id, action.id, {
      success: true,
      message: 'Successfully patched pod container image to registry.internal/worker:v2.0.0-stable'
    });
    assert.ok(ackAction);
    assert.equal(ackAction.status, 'SUCCEEDED');

    // Verify StructuredRemediation is EXECUTED
    const executedRem = store.getRemediation(incident.id, org.id);
    assert.equal(executedRem?.status, 'EXECUTED');

    // Live Kubernetes telemetry arrives showing container Running & Ready
    const healthyPod: KubernetesResource = {
      id: `pod-${cluster.id}-batch-worker`,
      uid: 'pod-uid-1',
      clusterId: cluster.id,
      name: 'batch-worker',
      namespace: 'default',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: now - 60000,
      updatedAt: Date.now() + 1000,
      specSummary: {
        containers: [{ name: 'worker', image: 'registry.internal/worker:v2.0.0-stable' }]
      },
      statusSummary: {
        observedState: 'Running',
        containerStates: [
          {
            name: 'worker',
            state: 'running',
            ready: true,
            image: 'registry.internal/worker:v2.0.0-stable'
          }
        ]
      },
      containers: [
        {
          name: 'worker',
          image: 'registry.internal/worker:v2.0.0-stable',
          ready: true,
          restartCount: 0,
          state: 'running'
        }
      ]
    };
    store.syncClusterResources(cluster.id, [healthyPod]);

    // Verification succeeds: action is VERIFIED_RESOLVED and incident is RESOLVED
    const verifiedRem = store.getRemediation(incident.id, org.id);
    assert.equal(verifiedRem?.status, 'VERIFIED_RESOLVED');

    const updatedIncident = store.getIncident(incident.id, org.id);
    assert.equal(updatedIncident?.status, 'RESOLVED');
    assert.equal(updatedIncident?.resolutionSource, 'AUTOMATIC_VERIFIED');

    // Verify Audit Trail returns complete timeline and actions
    const audit = store.getRemediationAuditTrail(incident.id, org.id);
    assert.ok(audit.remediation);
    assert.equal(audit.actions.length, 1);
    assert.equal(audit.actions[0].status, 'VERIFIED_RESOLVED');
    assert.ok(audit.timeline.some((e) => e.type === 'AUTOMATIC_ACTION'));
  });

  await t.test('Circuit Breaker Trips after repeated failures', () => {
    const store = new DataStore();
    const userId = 'usr-cb-test';
    store.upsertUser({ id: userId, email: 'cb@test.com', name: 'CB Tester' });
    const org = store.createOrganization('CB Org', userId);
    const { cluster } = store.createCluster(org.id, 'cb-cluster');

    // Set maxAttemptsPerIncident = 2
    store.updateRemediationPolicy(org.id, {
      remediationMode: 'CONTROLLED_AUTONOMOUS',
      maxAttemptsPerIncident: 2
    }, cluster.id);

    const now = Date.now();
    const failingPod: KubernetesResource = {
      id: `pod-${cluster.id}-failing-pod`,
      uid: 'pod-uid-cb',
      clusterId: cluster.id,
      name: 'failing-pod',
      namespace: 'default',
      kind: 'Pod',
      status: 'Waiting',
      health: 'CRITICAL',
      createdAt: now - 30000,
      updatedAt: now,
      specSummary: {
        containers: [{ name: 'app', image: 'app:broken' }]
      },
      statusSummary: {
        observedState: 'Waiting',
        containerStates: [
          {
            name: 'app',
            state: 'waiting',
            ready: false,
            image: 'app:broken',
            waiting: { reason: 'ImagePullBackOff', message: 'manifest unknown: image not found' }
          }
        ]
      },
      containers: [{ name: 'app', image: 'app:broken', ready: false, restartCount: 0, state: 'waiting', waitingReason: 'ImagePullBackOff', waitingMessage: 'manifest unknown: image not found' }]
    };
    store.syncClusterResources(cluster.id, [failingPod]);

    const incidents = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.ok(incidents.length > 0);
    const incident = incidents[0];

    // Propose first remediation
    const remediationPayload: StructuredRemediation = {
      id: `REM-${incident.id}-1`,
      incidentId: incident.id,
      orgId: org.id,
      clusterId: cluster.id,
      clusterName: cluster.name,
      status: 'PROPOSED',
      targetResource: { kind: 'Pod', name: 'failing-pod', namespace: 'default' },
      actionType: 'ReplacePodImage',
      parameters: { containerName: 'app', currentImage: 'app:broken', proposedImage: 'app:try1' },
      reasoning: {
        summary: 'Try rollback image',
        whyRecommended: 'Fix pull failure',
        risk: 'LOW',
        expectedImpact: 'Pod returns to running',
        rollbackStrategy: 'Revert',
        confidence: 90,
        rootCause: 'Image not found'
      },
      createdAt: now,
      updatedAt: now,
      isExecutable: true
    };
    store.saveRemediation(remediationPayload);

    const claimed1 = store.claimPendingRemediationActions(cluster.id);
    assert.equal(claimed1.length, 1);

    // Report failure 1
    store.recordRemediationResult(cluster.id, claimed1[0].id, {
      success: false,
      message: 'Image pull failed for app:try1'
    });
    assert.equal(store.getIncidentFailureCount(incident.id), 1);

    // Second failure
    const failures = store.recordIncidentFailure(incident.id);
    assert.equal(failures, 2);

    // Subsequent proposal should be blocked by circuit breaker
    const candidateRem = store.getRemediation(incident.id, org.id);
    if (candidateRem) {
      candidateRem.status = 'PROPOSED';
      const autoAction = store.evaluateAutonomousRemediation(incident, candidateRem);
      assert.equal(autoAction, null, 'Circuit breaker must prevent further autonomous dispatches');
    }
  });

  await t.test('Remediation Action Cancellation', () => {
    const store = new DataStore();
    const userId = 'usr-cancel-test';
    store.upsertUser({ id: userId, email: 'cancel@test.com', name: 'Cancel Tester' });
    const org = store.createOrganization('Cancel Org', userId);
    const { cluster } = store.createCluster(org.id, 'test-cluster');

    const now = Date.now();
    const cancelPod: KubernetesResource = {
      id: `pod-${cluster.id}-cancel-pod`,
      uid: 'pod-cancel',
      clusterId: cluster.id,
      name: 'cancel-pod',
      namespace: 'default',
      kind: 'Pod',
      status: 'Waiting',
      health: 'CRITICAL',
      createdAt: now - 30000,
      updatedAt: now,
      specSummary: {
        containers: [{ name: 'app', image: 'app:v1' }]
      },
      statusSummary: {
        observedState: 'Waiting',
        containerStates: [
          {
            name: 'app',
            state: 'waiting',
            ready: false,
            image: 'app:v1',
            waiting: { reason: 'ImagePullBackOff', message: 'Failed to pull image' }
          }
        ]
      },
      containers: [{ name: 'app', image: 'app:v1', ready: false, restartCount: 0, state: 'waiting', waitingReason: 'ImagePullBackOff' }]
    };
    store.syncClusterResources(cluster.id, [cancelPod]);

    const incidents = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.ok(incidents.length > 0);
    const incident = incidents[0];

    const action = store.approvePodImageReplacement(
      incident.id,
      org.id,
      { container: 'app', expectedCurrentValue: 'app:v1', proposedValue: 'app:v2' },
      { id: 'usr-1', name: 'DevOps Engineer' }
    );
    assert.equal(action.status, 'PENDING');

    // Cancel action
    const cancelled = store.cancelRemediationAction(action.id, org.id, { id: 'usr-1', name: 'DevOps Engineer' });
    assert.equal(cancelled.status, 'CANCELLED');
    assert.ok(cancelled.completedAt);
  });

  await t.test('Verify Expiration: claimPendingRemediationActions marks expired actions', () => {
    const store = new DataStore();
    const userId = 'usr-expire-test';
    store.upsertUser({ id: userId, email: 'expire@test.com', name: 'Expire Tester' });
    const org = store.createOrganization('Expire Org', userId);
    const { cluster } = store.createCluster(org.id, 'expire-cluster');

    const now = Date.now();
    const expirePod: KubernetesResource = {
      id: `pod-${cluster.id}-expire-pod`,
      uid: 'pod-expire',
      clusterId: cluster.id,
      name: 'expire-pod',
      namespace: 'default',
      kind: 'Pod',
      status: 'Waiting',
      health: 'CRITICAL',
      createdAt: now - 30000,
      updatedAt: now,
      specSummary: {
        containers: [{ name: 'app', image: 'app:v1' }]
      },
      statusSummary: {
        observedState: 'Waiting',
        containerStates: [
          {
            name: 'app',
            state: 'waiting',
            ready: false,
            image: 'app:v1',
            waiting: { reason: 'ImagePullBackOff', message: 'manifest unknown: image not found' }
          }
        ]
      },
      containers: [{ name: 'app', image: 'app:v1', ready: false, restartCount: 0, state: 'waiting', waitingReason: 'ImagePullBackOff', waitingMessage: 'manifest unknown: image not found' }]
    };
    store.syncClusterResources(cluster.id, [expirePod]);

    const incidents = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.ok(incidents.length > 0);
    const incident = incidents[0];

    const action = store.approvePodImageReplacement(
      incident.id,
      org.id,
      { container: 'app', expectedCurrentValue: 'app:v1', proposedValue: 'app:v2' },
      { id: 'usr-1', name: 'DevOps Engineer' }
    );
    assert.equal(action.status, 'PENDING');

    // Artificially age the action past its expiresAt timestamp
    action.expiresAt = Date.now() - 1000;

    // Call claimPendingRemediationActions -> should detect expiration and mark it EXPIRED
    const claimed = store.claimPendingRemediationActions(cluster.id);
    assert.equal(claimed.length, 0, 'Expired action should not be delivered to agent');

    // Verify action in store is marked EXPIRED
    const storedAction = store.getRemediationAction(action.id);
    assert.ok(storedAction);
    assert.equal(storedAction.status, 'EXPIRED');

    // Verify timeline recorded expiration event
    const timeline = store.getIncidentTimeline(incident.id, org.id);
    assert.ok(timeline.some((evt) => evt.type === 'REMEDIATION_EXPIRED'));
  });
});
