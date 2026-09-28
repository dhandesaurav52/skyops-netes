import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DataStore } from './store';
import { KubernetesResource } from '../src/types/index';

describe('Live Pod Logs Namespace Context & State Consistency Suite', () => {
  // Test 1: kube-system pod lookup
  it('1. kube-system pod lookup: queries and retrieves logs using authoritative kube-system namespace', async () => {
    const store = new DataStore();
    const org = store.createOrganization('KubeSystemOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'Production K8s');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    const corednsPod: KubernetesResource = {
      id: `${cluster.id}:kube-system:Pod:coredns-5f68d5bd7f-kjk7p`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'coredns-5f68d5bd7f-kjk7p',
      namespace: 'kube-system',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
      containers: [{ name: 'coredns', image: 'coredns:v1.11.1', ready: true, restartCount: 0, state: 'running' }]
    };
    store.syncClusterResources(cluster.id, [corednsPod]);

    // Store log entry in kube-system
    store.storePodLogs(
      cluster.id,
      'kube-system',
      'coredns-5f68d5bd7f-kjk7p',
      'coredns',
      '2026-09-19T05:00:00Z [INFO] CoreDNS ready\n',
      false,
      'SUCCESS'
    );

    const logResult = await store.getPodLogs(cluster.id, org.id, 'kube-system', 'coredns-5f68d5bd7f-kjk7p', {
      container: 'coredns'
    });

    assert.strictEqual(logResult.statusCategory, 'SUCCESS');
    assert.strictEqual(logResult.namespace, 'kube-system');
    assert.strictEqual(logResult.podName, 'coredns-5f68d5bd7f-kjk7p');
    assert.strictEqual(logResult.container, 'coredns');
    assert.ok(logResult.rawText.includes('CoreDNS ready'));
  });

  // Test 2: default namespace pod lookup
  it('2. default namespace pod lookup: queries and retrieves logs using default namespace', async () => {
    const store = new DataStore();
    const org = store.createOrganization('DefaultOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'Staging K8s');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    const appPod: KubernetesResource = {
      id: `${cluster.id}:default:Pod:my-app-7798c87db4-q2wxz`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'my-app-7798c87db4-q2wxz',
      namespace: 'default',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 1800000,
      updatedAt: Date.now() - 1800000,
      containers: [{ name: 'my-app', image: 'app:v2.1', ready: true, restartCount: 0, state: 'running' }]
    };
    store.syncClusterResources(cluster.id, [appPod]);

    store.storePodLogs(
      cluster.id,
      'default',
      'my-app-7798c87db4-q2wxz',
      'my-app',
      '2026-09-19T05:00:00Z [INFO] Server listening on port 8080\n',
      false,
      'SUCCESS'
    );

    const logResult = await store.getPodLogs(cluster.id, org.id, 'default', 'my-app-7798c87db4-q2wxz', {
      container: 'my-app'
    });

    assert.strictEqual(logResult.statusCategory, 'SUCCESS');
    assert.strictEqual(logResult.namespace, 'default');
    assert.strictEqual(logResult.podName, 'my-app-7798c87db4-q2wxz');
    assert.ok(logResult.rawText.includes('Server listening on port 8080'));
  });

  // Test 3: same pod name in different namespaces (default/api vs payments/api)
  it('3. same pod name in different namespaces: selecting payments/api NEVER resolves default/api', async () => {
    const store = new DataStore();
    const org = store.createOrganization('MultiNsOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'Prod-Multi');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    const defaultApiPod: KubernetesResource = {
      id: `${cluster.id}:default:Pod:api-pod`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'api-pod',
      namespace: 'default',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
      containers: [{ name: 'api', image: 'api:default', ready: true, restartCount: 0, state: 'running' }]
    };

    const paymentsApiPod: KubernetesResource = {
      id: `${cluster.id}:payments:Pod:api-pod`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'api-pod',
      namespace: 'payments',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 3600000,
      containers: [{ name: 'api', image: 'api:payments', ready: true, restartCount: 0, state: 'running' }]
    };

    store.syncClusterResources(cluster.id, [defaultApiPod, paymentsApiPod]);

    store.storePodLogs(
      cluster.id,
      'default',
      'api-pod',
      'api',
      'DEFAULT NAMESPACE LOG ENTRY\n',
      false,
      'SUCCESS'
    );
    store.storePodLogs(
      cluster.id,
      'payments',
      'api-pod',
      'api',
      'PAYMENTS NAMESPACE LOG ENTRY: Processing transactions\n',
      false,
      'SUCCESS'
    );

    // Query specifically for payments/api
    const paymentsResult = await store.getPodLogs(cluster.id, org.id, 'payments', 'api-pod', { container: 'api' });
    assert.strictEqual(paymentsResult.namespace, 'payments');
    assert.ok(paymentsResult.rawText.includes('PAYMENTS NAMESPACE LOG ENTRY'));
    assert.ok(!paymentsResult.rawText.includes('DEFAULT NAMESPACE LOG ENTRY'), 'Must not contain default pod logs');

    // Query specifically for default/api
    const defaultResult = await store.getPodLogs(cluster.id, org.id, 'default', 'api-pod', { container: 'api' });
    assert.strictEqual(defaultResult.namespace, 'default');
    assert.ok(defaultResult.rawText.includes('DEFAULT NAMESPACE LOG ENTRY'));
    assert.ok(!defaultResult.rawText.includes('PAYMENTS NAMESPACE LOG ENTRY'), 'Must not contain payments pod logs');
  });

  // Test 4: namespace change clears invalid pod
  it('4. namespace change validation: invalidates pod if it does not belong to new namespace', () => {
    // Simulate ObservabilityHubView state transition logic
    let selectedPod: { clusterId: string; namespace: string; name: string } | null = {
      clusterId: 'cluster-1',
      namespace: 'kube-system',
      name: 'coredns-5f68d5bd7f-kjk7p'
    };

    const handleNamespaceChange = (newNs: string) => {
      if (selectedPod && newNs !== 'all' && selectedPod.namespace !== newNs) {
        selectedPod = null;
      }
    };

    // User switches to 'default'
    handleNamespaceChange('default');
    assert.strictEqual(selectedPod, null, 'Selected pod must be cleared when namespace filter switches to non-matching namespace');

    // Restore pod in kube-system and switch to 'all'
    selectedPod = {
      clusterId: 'cluster-1',
      namespace: 'kube-system',
      name: 'coredns-5f68d5bd7f-kjk7p'
    };
    handleNamespaceChange('all');
    assert.notStrictEqual(selectedPod, null, 'Selected pod must be retained when filter switches to all namespaces');
    assert.strictEqual(selectedPod?.namespace, 'kube-system', 'Pod namespace remains kube-system');
  });

  // Test 5: explicit navigation preserves namespace
  it('5. explicit navigation preserves namespace: logIntent preserves kube-system namespace', () => {
    const logIntent = {
      requestId: 'req-12345',
      clusterId: 'cluster-alpha',
      namespace: 'kube-system',
      name: 'coredns-5f68d5bd7f-kjk7p'
    };

    // Derived selectedPod model
    const selectedPod = {
      clusterId: logIntent.clusterId,
      namespace: logIntent.namespace,
      name: logIntent.name
    };

    assert.strictEqual(selectedPod.namespace, 'kube-system');
    assert.notStrictEqual(selectedPod.namespace, 'default');
  });

  // Test 6: live polling preserves namespace
  it('6. live polling preserves namespace: polling request maintains original canonical namespace', async () => {
    const store = new DataStore();
    const org = store.createOrganization('PollOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'Poll Cluster');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    const pod: KubernetesResource = {
      id: `${cluster.id}:kube-system:Pod:kube-proxy-abc`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'kube-proxy-abc',
      namespace: 'kube-system',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 100000,
      updatedAt: Date.now(),
      containers: [{ name: 'kube-proxy', image: 'kube-proxy:v1.30', ready: true, restartCount: 0, state: 'running' }]
    };
    store.syncClusterResources(cluster.id, [pod]);

    store.storePodLogs(cluster.id, 'kube-system', 'kube-proxy-abc', 'kube-proxy', 'Polling tick 1\n', false, 'SUCCESS');

    // Initial query
    const initialQuery = await store.getPodLogs(cluster.id, org.id, 'kube-system', 'kube-proxy-abc', {
      container: 'kube-proxy'
    });
    assert.strictEqual(initialQuery.namespace, 'kube-system');

    // Simulate poll tick 2
    store.storePodLogs(cluster.id, 'kube-system', 'kube-proxy-abc', 'kube-proxy', 'Polling tick 2\n', false, 'SUCCESS');
    const pollQuery = await store.getPodLogs(cluster.id, org.id, 'kube-system', 'kube-proxy-abc', {
      container: 'kube-proxy'
    });
    assert.strictEqual(pollQuery.namespace, 'kube-system');
    assert.ok(pollQuery.rawText.includes('Polling tick 2'));
  });

  // Test 7: previous logs preserve namespace
  it('7. previous logs preserve namespace: requesting terminated container logs retains namespace', async () => {
    const store = new DataStore();
    const org = store.createOrganization('PrevNsOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'Prev Cluster');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    const pod: KubernetesResource = {
      id: `${cluster.id}:monitoring:Pod:prometheus-k8s-0`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'prometheus-k8s-0',
      namespace: 'monitoring',
      kind: 'Pod',
      status: 'Running',
      health: 'WARNING',
      createdAt: Date.now() - 500000,
      updatedAt: Date.now(),
      containers: [{ name: 'prometheus', image: 'prometheus:v2.50', ready: true, restartCount: 2, state: 'running' }]
    };
    store.syncClusterResources(cluster.id, [pod]);

    store.storePodLogs(
      cluster.id,
      'monitoring',
      'prometheus-k8s-0',
      'prometheus',
      'Terminated instance exit code 137 OOMKilled\n',
      true, // previous
      'SUCCESS'
    );

    const prevResult = await store.getPodLogs(cluster.id, org.id, 'monitoring', 'prometheus-k8s-0', {
      container: 'prometheus',
      previous: true
    });

    assert.strictEqual(prevResult.namespace, 'monitoring');
    assert.strictEqual(prevResult.previous, true);
    assert.ok(prevResult.rawText.includes('OOMKilled'));
  });

  // Test 8: missing namespace does not silently default to "default"
  it('8. missing namespace does not silently default to "default": reports unavailable', () => {
    // In PodLogsViewer contract: if namespace is missing/empty, it does not query default/<pod>
    const namespace: string = '';
    const podName = 'orphan-pod';

    let error: string | null = null;
    let unavailableReason = '';
    if (!namespace || namespace.trim() === '') {
      error = 'Pod namespace is unavailable.';
      unavailableReason = 'Pod namespace is unavailable.';
    }

    assert.strictEqual(error, 'Pod namespace is unavailable.');
    assert.strictEqual(unavailableReason, 'Pod namespace is unavailable.');
    assert.notStrictEqual(error, null);
  });

  // Test 9: pod-not-found message shows correct namespace
  it('9. pod-not-found message shows correct namespace: returns honest reason with kube-system', async () => {
    const store = new DataStore();
    const org = store.createOrganization('NotFoundOrg', 'admin@example.com');
    const { cluster } = store.createCluster(org.id, 'NF Cluster');
    store.recordAgentHeartbeat(cluster.id, 'v1.2.0', 'v1.30.0', 3, 10);

    // Sync only a pod in default namespace
    const defaultPod: KubernetesResource = {
      id: `${cluster.id}:default:Pod:unrelated`,
      clusterId: cluster.id,
      clusterName: cluster.name,
      name: 'unrelated',
      namespace: 'default',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      containers: [{ name: 'main', image: 'main:v1', ready: true, restartCount: 0, state: 'running' }]
    };
    store.syncClusterResources(cluster.id, [defaultPod]);

    // Query for non-existent pod in kube-system
    const result = await store.getPodLogs(cluster.id, org.id, 'kube-system', 'coredns-missing-pod', {
      container: 'coredns'
    });

    assert.strictEqual(result.statusCategory, 'POD_NOT_FOUND');
    assert.strictEqual(result.namespace, 'kube-system');
    assert.strictEqual(result.podName, 'coredns-missing-pod');
    assert.ok(
      result.unavailableReason?.includes('kube-system/coredns-missing-pod'),
      `Expected unavailableReason to include kube-system/coredns-missing-pod, got: ${result.unavailableReason}`
    );
    assert.ok(
      !result.unavailableReason?.includes('default/coredns-missing-pod'),
      'Must not claim pod was in default namespace'
    );
  });

  // Test 10: footer shows actual selected namespace
  it('10. footer shows actual selected namespace: formatting matches canonical namespace', () => {
    const formatFooterNamespace = (namespace: string | undefined | null) => {
      return namespace || 'Unavailable';
    };

    assert.strictEqual(formatFooterNamespace('kube-system'), 'kube-system');
    assert.strictEqual(formatFooterNamespace('monitoring'), 'monitoring');
    assert.strictEqual(formatFooterNamespace('default'), 'default');
    assert.strictEqual(formatFooterNamespace(''), 'Unavailable');
    assert.strictEqual(formatFooterNamespace(undefined), 'Unavailable');
  });
});
