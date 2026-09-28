import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.NODE_ENV = 'test';
import { store, DataStore } from './store';
import { KubernetesResource } from '../src/types/index';

test('DataStore Multi-Tenant & Agent Lifecycle Suite', async (t) => {
  // Setup Test Organization
  const testOwnerId = 'user-test-sre';
  store.upsertUser({ id: testOwnerId, email: 'sre@example.com', name: 'SRE Lead' });
  const org = store.createOrganization('Reliability Org', testOwnerId);

  await t.test('Cluster onboarding generates secure token, installKey, and single-use pairing key', () => {
    const { cluster, rawToken, connectionCode, installKey } = store.createCluster(org.id, 'prod-us-east-1');

    assert.ok(cluster.id.startsWith('cls-'));
    assert.equal(cluster.name, 'prod-us-east-1');
    assert.equal(cluster.orgId, org.id);
    assert.equal(cluster.status, 'pending');
    assert.equal(cluster.agentStatus, 'PENDING');
    assert.ok(rawToken.startsWith('sky_agent_'));
    assert.ok(connectionCode.startsWith('SKYOPS-'));
    assert.ok(installKey.startsWith('sky_inst_'));

    // Authenticate with raw token
    const authSuccess = store.authenticateAgentToken(rawToken);
    assert.ok(authSuccess);
    assert.equal(authSuccess?.clusterId, cluster.id);
    assert.equal(authSuccess?.orgId, org.id);

    // Reject forged / invalid token
    const authForged = store.authenticateAgentToken('sky_agent_invalid_token_123');
    assert.equal(authForged, null);

    (store as any).saveSnapshotSync();
    const persisted = fs.readFileSync((store as any).storagePath, 'utf8');
    assert.equal(persisted.includes(rawToken), false);
    assert.equal(persisted.includes('agentToken'), false);
  });

  await t.test('Agent registration and heartbeat lifecycle update cluster diagnostics', () => {
    const { cluster, rawToken } = store.createCluster(org.id, 'staging-eu-west-1');
    
    // Register agent
    const regResult = store.registerAgent(cluster.id, 'v1.5.0', 'v1.31.1');
    assert.equal(regResult.status, 'REGISTERED');
    assert.equal(regResult.clusterId, cluster.id);

    // Verify cluster updated
    const updated = store.getCluster(cluster.id, org.id);
    assert.ok(updated);
    assert.equal(updated?.agentStatus, 'CONNECTED');
    assert.equal(updated?.agentVersion, 'v1.5.0');
    assert.equal(updated?.k8sVersion, 'v1.31.1');

    // Heartbeat updates node and pod counts
    const heartbeatOk = store.recordAgentHeartbeat(cluster.id, 'v1.5.0', 'v1.31.1', 8, 45);
    assert.equal(heartbeatOk, true);

    const afterHeartbeat = store.getCluster(cluster.id, org.id);
    assert.equal(afterHeartbeat?.nodeCount, 8);
    assert.equal(afterHeartbeat?.podCount, 45);
  });

  await t.test('Authenticated telemetry recovers stale connection state', () => {
    const { cluster } = store.createCluster(org.id, 'telemetry-recovery');
    const staleCluster = store.getClusterByIdInternal(cluster.id)!;
    staleCluster.lastHeartbeat = Date.now() - 240_000;
    staleCluster.lastHeartbeatAt = staleCluster.lastHeartbeat;
    staleCluster.agentStatus = 'OFFLINE';
    staleCluster.connectionState = 'offline';
    staleCluster.connectionStatus = 'disconnected';
    staleCluster.status = 'AGENT_OFFLINE';

    store.syncClusterResources(cluster.id, [{
      id: `${cluster.id}-pod-recovery`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'recovery-pod',
      namespace: 'default',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [{ name: 'app', image: 'example/app:1', ready: true, state: 'running', restartCount: 0 }]
    }]);

    const recovered = store.getClusterByIdInternal(cluster.id)!;
    assert.equal(recovered.agentStatus, 'CONNECTED');
    assert.equal(recovered.connectionState, 'connected');
    assert.equal(recovered.connectionStatus, 'connected');
    assert.equal(recovered.status, 'HEALTHY');
    assert.ok(recovered.lastHeartbeat! > Date.now() - 5_000);
  });

  await t.test('Multi-cluster isolation prevents cross-cluster data leakage', () => {
    const { cluster: clusterA, rawToken: tokenA } = store.createCluster(org.id, 'cluster-alpha');
    const { cluster: clusterB, rawToken: tokenB } = store.createCluster(org.id, 'cluster-beta');

    const authA = store.authenticateAgentToken(tokenA);
    const authB = store.authenticateAgentToken(tokenB);

    assert.notEqual(authA?.clusterId, authB?.clusterId);
    assert.equal(authA?.clusterId, clusterA.id);
    assert.equal(authB?.clusterId, clusterB.id);

    // Sync telemetry to Cluster A
    const resourceA: KubernetesResource = {
      id: `${clusterA.id}-pod-default-api-server`,
      clusterId: clusterA.id,
      kind: 'Pod',
      name: 'api-server-78bc',
      namespace: 'default',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [{ name: 'api', image: 'api:v1', restartCount: 0, ready: true, state: 'running' }]
    };

    store.syncClusterResources(clusterA.id, [resourceA]);

    const resA = store.getClusterResources(clusterA.id, org.id);
    const resB = store.getClusterResources(clusterB.id, org.id);

    assert.equal(resA.length, 1);
    assert.equal(resA[0].name, 'api-server-78bc');
    assert.equal(resB.length, 0); // Cluster B has no resources
  });

  await t.test('Incident detection, deduplication, timeline tracking, and auto-recovery', () => {
    const { cluster } = store.createCluster(org.id, 'prod-workloads');

    // 1. Ingest failing pod (CrashLoopBackOff)
    const failingPod: KubernetesResource = {
      id: `${cluster.id}-pod-payment-payment-svc`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'payment-svc-xyz',
      namespace: 'payment',
      status: 'CrashLoopBackOff',
      health: 'CRITICAL',
      createdAt: Date.now() - 120000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'payment',
          image: 'payment-svc:v2.1',
          restartCount: 6,
          ready: false,
          state: 'waiting',
          waitingReason: 'CrashLoopBackOff',
          waitingMessage: 'Back-off 5m0s restarting failed container',
          exitCode: 1
        }
      ]
    };

    store.syncClusterResources(cluster.id, [failingPod]);

    const incidents = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.equal(incidents.length, 1);
    const incident = incidents[0];
    assert.equal(incident.incidentType, 'CrashLoopBackOff');
    assert.equal(incident.status, 'OPEN');
    assert.equal(incident.occurrenceCount, 1);
    assert.equal(incident.resourceName, 'payment-svc-xyz');

    // 2. Deduplication & Stability: Send second scrape with same failure
    store.syncClusterResources(cluster.id, [failingPod]);

    const incidentsAfterSecondScrape = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.equal(incidentsAfterSecondScrape.length, 1); // No duplicate incident created
    assert.equal(incidentsAfterSecondScrape[0].id, incident.id);
    assert.equal(incidentsAfterSecondScrape[0].occurrenceCount, 1, 'Repeat observation of active failure must NOT increment occurrence count');

    // 3. Auto-recovery: Send updated healthy pod telemetry
    const recoveredPod: KubernetesResource = {
      ...failingPod,
      status: 'Running',
      health: 'HEALTHY',
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'payment',
          image: 'payment-svc:v2.1',
          restartCount: 6,
          ready: true,
          state: 'running'
        }
      ]
    };

    store.syncClusterResources(cluster.id, [recoveredPod]);

    const incidentsAfterRecovery = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.equal(incidentsAfterRecovery.length, 1);
    assert.equal(incidentsAfterRecovery[0].status, 'RESOLVED');
    assert.ok(incidentsAfterRecovery[0].resolvedAt);
    assert.equal(incidentsAfterRecovery[0].technicalDetails.rootCauseCategory, 'CRASH', 'Recovery must preserve the RCA history');

    // 4. Recurrence: Same failure detected again after recovery -> occurrence increments to 2
    store.syncClusterResources(cluster.id, [failingPod]);
    const incidentsAfterRecurrence = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.equal(incidentsAfterRecurrence.length, 1);
    assert.equal(incidentsAfterRecurrence[0].id, incident.id);
    assert.equal(incidentsAfterRecurrence[0].status, 'OPEN');
    assert.equal(incidentsAfterRecurrence[0].occurrenceCount, 2, 'Recurrence after resolution must increment occurrence count to 2');

    // 5. Active observation while in 2nd occurrence -> remains 2
    store.syncClusterResources(cluster.id, [failingPod]);
    const incidentsAfterSecondPulse = store.getIncidents(org.id, { clusterId: cluster.id });
    assert.equal(incidentsAfterSecondPulse[0].occurrenceCount, 2, 'Unchanged active failure must remain at 2');

    // Verify timeline has detection, recovery, and occurrence events
    const timeline = store.getIncidentTimeline(incident.id, org.id);
    assert.ok(timeline.length >= 3);
    assert.ok(timeline.some((e) => e.type === 'DETECTION'));
    assert.ok(timeline.some((e) => e.type === 'RECOVERY'));
    assert.ok(timeline.some((e) => e.type === 'OCCURRENCE'));
  });

  await t.test('Occurrence Lifecycle Regression: 10+ active observations remain 1x, resolves, recurs to 2x, remains 2x, independent fingerprints', () => {
    const { cluster } = store.createCluster(org.id, 'prod-occurrence-test');

    const imagePullPodA: KubernetesResource = {
      id: `${cluster.id}-pod-auth-auth-service`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'auth-service-abc',
      namespace: 'auth',
      status: 'ImagePullBackOff',
      health: 'CRITICAL',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'auth',
          image: 'registry.internal/auth:v999',
          restartCount: 0,
          ready: false,
          state: 'waiting',
          waitingReason: 'ImagePullBackOff',
          waitingMessage: 'Back-off pulling image registry.internal/auth:v999'
        }
      ]
    };

    const crashPodB: KubernetesResource = {
      id: `${cluster.id}-pod-billing-billing-worker`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'billing-worker-xyz',
      namespace: 'billing',
      status: 'CrashLoopBackOff',
      health: 'CRITICAL',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'worker',
          image: 'registry.internal/billing:v1.2',
          restartCount: 3,
          ready: false,
          state: 'waiting',
          waitingReason: 'CrashLoopBackOff',
          waitingMessage: 'Back-off 10s restarting failed container',
          exitCode: 1
        }
      ]
    };

    // Step 1: First detection -> occurrences = 1
    store.syncClusterResources(cluster.id, [imagePullPodA, crashPodB]);
    let incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    let incB = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'billing' })[0];
    assert.equal(incA.occurrenceCount, 1);
    assert.equal(incA.status, 'OPEN');
    assert.equal(incB.occurrenceCount, 1);
    assert.equal(incB.status, 'OPEN');
    assert.notEqual(incA.id, incB.id, 'Different fingerprints must create independent incident tickets');

    // Step 2: 12 identical consecutive telemetry scrape cycles while continuously OPEN -> occurrences MUST remain 1
    for (let cycle = 1; cycle <= 12; cycle++) {
      store.syncClusterResources(cluster.id, [imagePullPodA, crashPodB]);
    }
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    incB = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'billing' })[0];
    assert.equal(incA.occurrenceCount, 1, '12 consecutive active scrapes must still have occurrenceCount = 1');
    assert.equal(incB.occurrenceCount, 1, '12 consecutive active scrapes must still have occurrenceCount = 1');

    // Step 3: Pod A recovers -> incA becomes RESOLVED, incB remains OPEN
    const recoveredPodA: KubernetesResource = {
      ...imagePullPodA,
      status: 'Running',
      health: 'HEALTHY',
      updatedAt: Date.now(),
      containers: [
        {
          name: 'auth',
          image: 'registry.internal/auth:v999',
          restartCount: 0,
          ready: true,
          state: 'running'
        }
      ]
    };
    store.syncClusterResources(cluster.id, [recoveredPodA, crashPodB]);
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    incB = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'billing' })[0];
    assert.equal(incA.status, 'RESOLVED');
    assert.ok(incA.resolvedAt);
    assert.equal(incB.status, 'OPEN');
    assert.equal(incB.occurrenceCount, 1);

    // Step 4: Same failure happens again on Pod A -> incA reopens with occurrences = 2
    store.syncClusterResources(cluster.id, [imagePullPodA, crashPodB]);
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    assert.equal(incA.status, 'OPEN');
    assert.equal(incA.occurrenceCount, 2, 'Recurrence after resolution must increment occurrences to 2');
    assert.equal(incA.resolvedAt, null);

    // Step 5: Same failure remains active after second occurrence -> remains 2 across multiple scrapes
    for (let cycle = 1; cycle <= 5; cycle++) {
      store.syncClusterResources(cluster.id, [imagePullPodA, crashPodB]);
    }
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    assert.equal(incA.occurrenceCount, 2, 'Second occurrence must remain at 2 across repeated observations');

    // Step 6: Pod A recovers again -> becomes RESOLVED
    store.syncClusterResources(cluster.id, [recoveredPodA, crashPodB]);
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    assert.equal(incA.status, 'RESOLVED');

    // Step 7: Pod A fails a third independent time -> becomes occurrences = 3
    store.syncClusterResources(cluster.id, [imagePullPodA, crashPodB]);
    incA = store.getIncidents(org.id, { clusterId: cluster.id, namespace: 'auth' })[0];
    assert.equal(incA.status, 'OPEN');
    assert.equal(incA.occurrenceCount, 3, 'Third failure after recovery must increment occurrences to 3');
  });

  await t.test('Partial scrape does not falsely resolve active incidents; complete snapshot reconciles deleted resources', () => {
    const { cluster } = store.createCluster(org.id, 'prod-safety-cluster');

    const oomPod: KubernetesResource = {
      id: `${cluster.id}-pod-default-analytics-worker`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'analytics-worker-abc',
      namespace: 'default',
      status: 'OOMKilled',
      health: 'CRITICAL',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'worker',
          image: 'analytics:v1',
          restartCount: 2,
          ready: false,
          state: 'terminated',
          terminationReason: 'OOMKilled',
          exitCode: 137
        }
      ]
    };

    // 1. Initial detection
    store.syncClusterResources(cluster.id, [oomPod]);
    let active = store.getIncidents(org.id, { clusterId: cluster.id, status: 'OPEN' });
    assert.equal(active.length, 1);

    // 2. Transient partial scrape (empty or partial without snapshotComplete) -> Must NOT auto-resolve
    store.syncClusterResources(cluster.id, [], false);
    active = store.getIncidents(org.id, { clusterId: cluster.id, status: 'OPEN' });
    assert.equal(active.length, 1, 'Transient partial scrape must not falsely auto-resolve active incident');

    // 3. Explicit complete snapshot missing the pod -> Reconciles deleted resource
    store.syncClusterResources(cluster.id, [], true);
    active = store.getIncidents(org.id, { clusterId: cluster.id, status: 'OPEN' });
    assert.equal(active.length, 0, 'Complete snapshot must reconcile deleted resource');
    const resolved = store.getIncidents(org.id, { clusterId: cluster.id, status: 'RESOLVED' });
    assert.equal(resolved.length, 1);
  });

  await t.test('Incident retrieval flow: list to detail retrieval with sub-resources and case-insensitivity', async () => {
    const store = new DataStore();
    const org = store.createOrganization('Incident Detail Test Org', 'detail-test');
    const { cluster } = store.createCluster(org.id, 'Production Cluster', 'gke');

    const imagePullPod = {
      id: 'res-nginx-1001',
      clusterId: cluster.id,
      kind: 'Pod',
      name: 'nginx-ingress-pod',
      namespace: 'production',
      status: 'Pending',
      health: 'CRITICAL',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'nginx',
          image: 'nginx:nonexistent-tag',
          restartCount: 0,
          ready: false,
          state: 'waiting',
          waitingReason: 'ImagePullBackOff',
          waitingMessage: 'Back-off pulling image nginx:nonexistent-tag'
        }
      ]
    };

    store.syncClusterResources(cluster.id, [imagePullPod as any]);

    // 1. Verify Incidents list returns the incident
    const incidents = store.getIncidents(org.id);
    assert.equal(incidents.length, 1);
    const incident = incidents[0];
    assert.match(incident.id, /^SKY-\d+$/);
    assert.equal(incident.resourceName, 'nginx-ingress-pod');

    // 2. Verify Incident detail retrieval works by exact ID
    const detail = store.getIncident(incident.id, org.id);
    assert.ok(detail, 'Incident must be found by exact ID');
    assert.equal(detail.id, incident.id);

    // 3. Verify Case-insensitive lookup works
    const lowerDetail = store.getIncident(incident.id.toLowerCase(), org.id);
    assert.ok(lowerDetail, 'Incident must be found case-insensitively');
    assert.equal(lowerDetail.id, incident.id);

    // 4. Verify detail sub-resources execute cleanly without throwing
    const timeline = store.getIncidentTimeline(incident.id, org.id);
    assert.ok(Array.isArray(timeline));
    assert.ok(timeline.length >= 1, 'Detection event should be in timeline');

    const notes = store.getIncidentNotes(incident.id, org.id);
    assert.ok(Array.isArray(notes));

    const aiAnalysis = store.getAIAnalysis(incident.id);
    assert.equal(aiAnalysis, null);

    const remediation = store.getRemediation(incident.id, org.id);
    assert.equal(remediation, null);

    // 5. Verify tenant isolation for detail retrieval
    const otherOrgDetail = store.getIncident(incident.id, 'org-foreign-tenant');
    assert.equal(otherOrgDetail, null, 'Must not return incident for non-member tenant');
  });

  await t.test('SkyOps agent launch does not create false positive DeploymentDegraded incidents', () => {
    const store = new DataStore();
    const org = store.createOrganization('Agent Launch Corp', 'agent-launch');
    const { cluster } = store.createCluster(org.id, 'Prod EKS', 'eks');

    // Simulate the incoming agent deployment reported right as the agent pods are initializing (0/1 ready)
    const agentDeployment: KubernetesResource = {
      id: `${cluster.id}-deployment-skyops-system-skyops-agent`,
      clusterId: cluster.id,
      kind: 'Deployment',
      name: 'skyops-agent',
      namespace: 'skyops-system',
      status: '0/1 Ready',
      health: 'WARNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      specSummary: { replicas: 1 },
      statusSummary: { readyReplicas: 0, availableReplicas: 0, updatedReplicas: 1 },
      conditions: [
        { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
        { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' }
      ],
      containers: []
    };

    store.syncClusterResources(cluster.id, [agentDeployment]);

    // Verify zero incidents were created for the agent launch
    const incidents = store.getIncidents(org.id);
    assert.equal(incidents.length, 0, 'Agent launch must not create customer incident tickets');
  });

  await t.test('Phase 1.1: Agent Identity Stability: Pod restart and reconnect does not create duplicate clusters', () => {
    const store = new DataStore();
    const org = store.createOrganization('Stability Corp', 'stability-corp');
    const { cluster, rawToken } = store.createCluster(org.id, 'Production US-East', 'Primary production cluster');

    const initialClusters = store.getClusters(org.id);
    assert.equal(initialClusters.length, 1);
    assert.equal(initialClusters[0].id, cluster.id);

    // Initial registration of agent (Pod 1: skyops-agent-1a2b)
    const reg1 = store.registerAgent(cluster.id, 'v1.5.0', 'v1.29.2');
    assert.equal(reg1.clusterId, cluster.id);

    // Pod 1 sends heartbeats and telemetry
    store.recordAgentHeartbeat(cluster.id, 'v1.5.0', 'v1.29.2', 10, 45);
    const postHeartbeat = store.getCluster(cluster.id, org.id)!;
    assert.equal(postHeartbeat.connectionState, 'connected');
    assert.equal(postHeartbeat.agentStatus, 'CONNECTED');

    // Simulate Pod 1 terminating and new Pod 2 starting (skyops-agent-9z8y) using mounted Secret
    // Pod 2 registers with the same cluster ID and token
    const reg2 = store.registerAgent(cluster.id, 'v1.5.0', 'v1.29.2');
    assert.equal(reg2.clusterId, cluster.id);

    // Pod 2 sends heartbeats
    store.recordAgentHeartbeat(cluster.id, 'v1.5.0', 'v1.29.2', 10, 48);

    // Verify cluster list still contains strictly 1 cluster with preserved identity
    const afterRestartClusters = store.getClusters(org.id);
    assert.equal(afterRestartClusters.length, 1, 'Pod restart must never create a duplicate cluster');
    assert.equal(afterRestartClusters[0].id, cluster.id);
    assert.equal(afterRestartClusters[0].connectionState, 'connected');
    assert.equal(afterRestartClusters[0].podCount, 48);
  });

  await t.test('Phase 1.1: Dynamic Connection State Transitions: Connected -> Reconnecting -> Stale -> Offline -> Recovered', () => {
    const store = new DataStore();
    const org = store.createOrganization('Lifecycle Corp', 'lifecycle-corp');
    const { cluster } = store.createCluster(org.id, 'Staging Cluster', 'Staging');

    // Agent registers and sends heartbeat at t0
    const t0 = 1700000000000;
    store.registerAgent(cluster.id, 'v1.5.0', 'v1.29.0');
    store.recordAgentHeartbeat(cluster.id, 'v1.5.0', 'v1.29.0', 3, 12);

    const activeCluster = store.getClusterByIdInternal(cluster.id)!;
    activeCluster.lastHeartbeat = t0;
    activeCluster.lastHeartbeatAt = t0;

    // 1. Within 30s -> Connected
    store.reconcileClusterConnectionState(activeCluster, t0 + 30 * 1000);
    assert.equal(activeCluster.connectionState, 'connected');
    assert.equal(activeCluster.agentStatus, 'CONNECTED');
    assert.equal(activeCluster.connectionStatus, 'connected');

    // 2. At 60s (>45s) -> Reconnecting
    store.reconcileClusterConnectionState(activeCluster, t0 + 60 * 1000);
    assert.equal(activeCluster.connectionState, 'reconnecting');
    assert.equal(activeCluster.agentStatus, 'RECONNECTING');
    assert.equal(activeCluster.connectionStatus, 'reconnecting');

    // 3. At 120s (>90s) -> Stale
    store.reconcileClusterConnectionState(activeCluster, t0 + 120 * 1000);
    assert.equal(activeCluster.connectionState, 'stale');
    assert.equal(activeCluster.agentStatus, 'STALE');
    assert.equal(activeCluster.connectionStatus, 'stale');

    // 4. At 200s (>180s) -> Offline
    store.reconcileClusterConnectionState(activeCluster, t0 + 200 * 1000);
    assert.equal(activeCluster.connectionState, 'offline');
    assert.equal(activeCluster.agentStatus, 'OFFLINE');
    assert.equal(activeCluster.connectionStatus, 'disconnected');
    assert.equal(activeCluster.status, 'AGENT_OFFLINE');

    // 5. Querying cluster via getCluster dynamically reflects the real-time state
    const retrieved = store.getCluster(cluster.id, org.id)!;
    assert.equal(retrieved.connectionState, 'offline');
    assert.equal(retrieved.agentStatus, 'OFFLINE');

    // 6. Network recovers: agent sends heartbeat -> immediately returns to Connected
    store.recordAgentHeartbeat(cluster.id, 'v1.5.0', 'v1.29.0', 3, 12);
    const recovered = store.getCluster(cluster.id, org.id)!;
    assert.equal(recovered.connectionState, 'connected');
    assert.equal(recovered.agentStatus, 'CONNECTED');
    assert.equal(recovered.connectionStatus, 'connected');
    assert.equal(recovered.status, 'HEALTHY');
  });

  await t.test('Phase 1.1: Pod Lifecycle vs Agent Connectivity Truthfulness', () => {
    const store = new DataStore();
    const org = store.createOrganization('Truth Corp', 'truth-corp');
    const { cluster } = store.createCluster(org.id, 'Workload Heavy Cluster');

    store.registerAgent(cluster.id, 'v1.5.0', 'v1.29.0');

    // Customer workloads are synced (5 pods running in cluster)
    const customerPods: KubernetesResource[] = Array.from({ length: 5 }, (_, i) => ({
      id: `${cluster.id}-pod-default-service-${i}`,
      clusterId: cluster.id,
      kind: 'Pod',
      name: `service-pod-${i}`,
      namespace: 'default',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 10000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [{ name: 'app', image: 'app:1.0', ready: true, state: 'running', restartCount: 0 }]
    }));
    store.syncClusterResources(cluster.id, customerPods);

    // Verify workload resources exist in cluster
    const resources = store.getClusterResources(cluster.id, org.id);
    assert.equal(resources.length, 5);

    // Simulate agent pod network partition (heartbeats stop for 4 minutes)
    const clusterInternal = store.getClusterByIdInternal(cluster.id)!;
    clusterInternal.lastHeartbeat = Date.now() - 240 * 1000;

    // Backend must truthfully reflect that agent connectivity is OFFLINE, even though customer pods exist
    const checked = store.getCluster(cluster.id, org.id)!;
    assert.equal(checked.connectionState, 'offline');
    assert.equal(checked.agentStatus, 'OFFLINE');
    assert.equal(checked.status, 'AGENT_OFFLINE');

    // Workloads remain stored for historical inspection
    const remainingResources = store.getClusterResources(cluster.id, org.id);
    assert.equal(remainingResources.length, 5);
  });

  await t.test('Phase 1.1: Security Boundary: Temporary disconnect preserves tokens; explicit revocation invalidates them', () => {
    const store = new DataStore();
    const org = store.createOrganization('Security Boundary Org', 'sec-boundary');
    const { cluster, rawToken } = store.createCluster(org.id, 'Secured Cluster');

    // Token authenticates initially
    const auth1 = store.authenticateAgentToken(rawToken);
    assert.ok(auth1);
    assert.equal(auth1.clusterId, cluster.id);

    // Temporary disconnect must preserve the existing credential so the agent can reconnect.
    const disconnected = store.disconnectCluster(cluster.id, org.id);
    assert.equal(disconnected, true);

    const authAfterDisconnect = store.authenticateAgentToken(rawToken);
    assert.ok(authAfterDisconnect, 'Temporary disconnect must not revoke the agent token');

    const discCluster = store.getCluster(cluster.id, org.id)!;
    assert.equal(discCluster.connectionState, 'offline');
    assert.equal(discCluster.connectionStatus, 'disconnected');
    assert.equal(discCluster.agentStatus, 'OFFLINE');

    // Explicit revocation invalidates the token. Rotation then generates a fresh credential.
    const revoked = store.revokeAgentToken(cluster.id, org.id);
    assert.equal(revoked, true);
    assert.equal(store.authenticateAgentToken(rawToken), null, 'Explicitly revoked token must be rejected');

    const { rawToken: newToken } = store.rotateAgentToken(cluster.id, org.id);
    assert.notEqual(newToken, rawToken);

    assert.equal(store.authenticateAgentToken(rawToken), null, 'Old token must remain invalid');
    const authNew = store.authenticateAgentToken(newToken);
    assert.ok(authNew);
    assert.equal(authNew.clusterId, cluster.id);
  });
});
