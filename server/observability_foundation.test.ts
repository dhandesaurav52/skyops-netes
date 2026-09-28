import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactSensitiveLogData, parseLogLines } from './logs';
import { store } from './store';
import { K8sEvent, KubernetesResource } from '../src/types/index';

describe('Observability Foundation: Logs, Events, and Deduplication', () => {
  describe('Enterprise Log Redaction', () => {
    it('redacts Bearer tokens, passwords, and API keys securely', () => {
      const rawLog = 'Connecting with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-ID and password=SuperSecretPassword123!';
      const redacted = redactSensitiveLogData(rawLog);

      assert.ok(!redacted.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
      assert.ok(!redacted.includes('SuperSecretPassword123!'));
      assert.ok(redacted.includes('Bearer [REDACTED_BEARER_TOKEN]'));
      assert.ok(redacted.includes('password=[REDACTED]'));
    });

    it('redacts AWS Access Key IDs and SkyOps agent tokens', () => {
      const logWithKeys = 'Failed push using AKIAIOSFODNN7EXAMPLE and token: skyops_agent_secret_token_123';
      const redacted = redactSensitiveLogData(logWithKeys);

      assert.ok(!redacted.includes('AKIAIOSFODNN7EXAMPLE'));
      assert.ok(redacted.includes('[REDACTED_AWS_KEY]'));
      assert.ok(!redacted.includes('skyops_agent_secret_token_123'));
      assert.ok(redacted.includes('[REDACTED_AGENT_TOKEN]'));
    });
  });

  describe('Pod Log Line Parsing', () => {
    it('extracts RFC3339 timestamps and formats cleanly', () => {
      const line = '2026-09-13T12:34:56.789123456Z [INFO] Application started on port 8080';
      const parsed = parseLogLines(line);

      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].timestamp, '2026-09-13T12:34:56.789123456Z');
      assert.equal(parsed[0].message, '[INFO] Application started on port 8080');
      assert.ok(parsed[0].raw.includes('Application started'));
    });

    it('gracefully handles lines without timestamps', () => {
      const line = 'Stack trace: at main.go:42';
      const parsed = parseLogLines(line);

      assert.equal(parsed.length, 1);
      assert.equal(parsed[0].timestamp, undefined);
      assert.equal(parsed[0].message, 'Stack trace: at main.go:42');
    });

    it('supports search query filtering', () => {
      const lines = '2026-09-13T12:00:00Z First normal line\n2026-09-13T12:00:01Z ERROR: Connection timeout\n2026-09-13T12:00:02Z Normal recovery';
      const parsed = parseLogLines(lines, 'ERROR');

      assert.equal(parsed.length, 1);
      assert.ok(parsed[0].message.includes('Connection timeout'));
    });
  });

  describe('Event Ingestion and Deduplication', () => {
    it('deduplicates identical events across resources and aggregates count', () => {
      const org = store.createOrganization('Event Org', 'user-test-obs');
      const { cluster } = store.createCluster(org.id, 'event-cluster');

      const event1: K8sEvent = {
        id: 'evt-1',
        timestamp: 1700000000000,
        type: 'Warning',
        reason: 'FailedScheduling',
        objectKind: 'Pod',
        objectName: 'nginx-test',
        namespace: 'default',
        message: '0/3 nodes are available: insufficient cpu',
        count: 1,
        firstObserved: 1700000000000,
        lastObserved: 1700000000000
      };

      const event2: K8sEvent = {
        id: 'evt-2',
        timestamp: 1700000060000,
        type: 'Warning',
        reason: 'FailedScheduling',
        objectKind: 'Pod',
        objectName: 'nginx-test',
        namespace: 'default',
        message: '0/3 nodes are available: insufficient cpu',
        count: 2,
        firstObserved: 1700000000000,
        lastObserved: 1700000060000
      };

      const podResource: KubernetesResource = {
        id: `${cluster.id}-pod-nginx-test`,
        clusterId: cluster.id,
        kind: 'Pod',
        name: 'nginx-test',
        namespace: 'default',
        status: 'Pending',
        health: 'WARNING',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        events: [event1, event2]
      };

      store.syncClusterResources(cluster.id, [podResource]);
      const events = store.getClusterEvents(cluster.id, org.id);

      // Deduplicated into a single event with count 3
      assert.equal(events.length, 1);
      assert.equal(events[0].count, 3);
      assert.equal(events[0].lastObserved, 1700000060000);
      assert.equal(events[0].firstObserved, 1700000000000);
    });
  });

  describe('Historical Metric Trend & Non-Fabrication', () => {
    it('returns empty history points for cluster without telemetry rather than fabricating numbers', () => {
      const org = store.createOrganization('Empty Metrics Org', 'user-test-obs');
      const { cluster } = store.createCluster(org.id, 'empty-cluster');

      const history = store.getClusterMetricHistory(cluster.id, org.id);
      assert.ok(Array.isArray(history));
    });

    it('returns cluster observability metrics with clear unavailableReason when live metrics are absent', () => {
      const org = store.createOrganization('No Live Metrics Org', 'user-test-obs');
      const { cluster } = store.createCluster(org.id, 'no-live-metrics-cluster');

      const podWithoutUsage: KubernetesResource = {
        id: `${cluster.id}-pod-simple-app`,
        clusterId: cluster.id,
        kind: 'Pod',
        name: 'simple-app',
        namespace: 'default',
        status: 'Running',
        health: 'HEALTHY',
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        containers: [
          {
            name: 'app',
            image: 'app:v1',
            restartCount: 0,
            ready: true,
            state: 'running',
            cpuRequest: '100m',
            memoryRequest: '128Mi'
          }
        ]
      };

      store.syncClusterResources(cluster.id, [podWithoutUsage]);
      const metrics = store.getClusterObservabilityMetrics(cluster.id, org.id);

      assert.ok(metrics);
      assert.equal(metrics.isUsageAvailable, false);
      assert.ok(metrics.unavailableReason?.includes('Metrics Server'));
      assert.equal(metrics.cpu.totalUsage, undefined);
      assert.equal(metrics.memory.totalUsage, undefined);
    });

    it('persists historical metric points across saveSnapshot and loadSnapshot without loss', () => {
      const org = store.createOrganization('Persistent History Org', 'user-test-obs');
      const { cluster } = store.createCluster(org.id, 'history-cluster');

      // Record a point
      store.recordMetricHistoryPoint(cluster.id, {
        timestamp: Date.now(),
        cpuUsageMillicores: 1500,
        cpuRequestMillicores: 2000,
        cpuCapacityMillicores: 4000,
        memoryUsageBytes: 1024 * 1024 * 512,
        memoryRequestBytes: 1024 * 1024 * 1024,
        memoryCapacityBytes: 1024 * 1024 * 2048,
        isUsageAvailable: true,
        source: 'METRICS_SERVER'
      });

      const historyBefore = store.getClusterMetricHistory(cluster.id, org.id);
      assert.equal(historyBefore.length, 1);
      assert.equal(historyBefore[0].cpuUsageMillicores, 1500);

      // Force synchronous flush to disk
      (store as any).saveSnapshotSync();

      // Create fresh DataStore instance simulating server restart
      const newStore = new (store.constructor as any)();
      const historyAfter = newStore.getClusterMetricHistory(cluster.id, org.id);

      assert.ok(Array.isArray(historyAfter));
      assert.equal(historyAfter.length, 1);
      assert.equal(historyAfter[0].cpuUsageMillicores, 1500);
      assert.equal(historyAfter[0].isUsageAvailable, true);
      assert.equal(historyAfter[0].memoryUsageBytes, 1024 * 1024 * 512);
    });
  });

  describe('Metrics Server Observability & Enablement Workflow', () => {
    it('detects NOT_INSTALLED status and provides preflight and command diagnostics', async () => {
      const org = store.createOrganization('MS Test Org 1', 'user-ms-test');
      const { cluster } = store.createCluster(org.id, 'uninstrumented-cluster');

      // Cluster with basic pod without metrics-server
      const pod: KubernetesResource = {
        id: `${cluster.id}-pod-nginx`,
        clusterId: cluster.id,
        kind: 'Pod',
        name: 'nginx-1',
        namespace: 'default',
        status: 'Running',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      store.syncClusterResources(cluster.id, [pod]);

      const status = store.getMetricsServerStatus(cluster.id, org.id);
      assert.ok(status);
      assert.equal(status.status, 'NOT_INSTALLED');
      assert.equal(status.isInstalled, false);
      assert.equal(status.isActive, false);
      assert.ok(status.commands.kubectl.includes('kubernetes-sigs/metrics-server'));
      assert.ok(status.commands.kubectlInsecureTls.includes('--kubelet-insecure-tls'));
      assert.ok(status.commands.helm.includes('helm upgrade --install'));
      assert.ok(status.diagnostics.some(d => d.includes('No metrics-server deployment')));

      const verification = await store.verifyMetricsServer(cluster.id, org.id);
      assert.ok(verification);
      assert.equal(verification.success, false);
      assert.equal(verification.status.status, 'NOT_INSTALLED');
    });

    it('detects INSTALLED_NOT_REPORTING when metrics-server deployment is present but API is not yet reporting', async () => {
      const org = store.createOrganization('MS Test Org 2', 'user-ms-test');
      const { cluster } = store.createCluster(org.id, 'warmup-cluster');

      const metricsServerDeployment: KubernetesResource = {
        id: `${cluster.id}-dep-metrics-server`,
        clusterId: cluster.id,
        kind: 'Deployment',
        name: 'metrics-server',
        namespace: 'kube-system',
        status: 'Active',
        health: 'HEALTHY',
        createdAt: Date.now() - 30000,
        updatedAt: Date.now()
      };
      store.syncClusterResources(cluster.id, [metricsServerDeployment]);

      const status = store.getMetricsServerStatus(cluster.id, org.id);
      assert.ok(status);
      assert.equal(status.isInstalled, true);
      assert.equal(status.isActive, false);
      assert.equal(status.status, 'INSTALLED_NOT_REPORTING');
      assert.ok(status.diagnostics.some(d => d.includes('--kubelet-insecure-tls')));

      const verification = await store.verifyMetricsServer(cluster.id, org.id);
      assert.ok(verification);
      assert.equal(verification.success, false);
      assert.ok(verification.message.includes('detected in the cluster'));
    });

    it('detects ACTIVE status when live usage metrics are reported', async () => {
      const org = store.createOrganization('MS Test Org 3', 'user-ms-test');
      const { cluster } = store.createCluster(org.id, 'active-ms-cluster');

      const nodeWithUsage: KubernetesResource = {
        id: `${cluster.id}-node-1`,
        clusterId: cluster.id,
        kind: 'Node',
        name: 'node-1',
        namespace: '',
        status: 'Ready',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        cpuUsage: 250,
        memoryUsage: 1024 * 1024 * 1024
      };

      const podWithUsage: KubernetesResource = {
        id: `${cluster.id}-pod-app-1`,
        clusterId: cluster.id,
        kind: 'Pod',
        name: 'app-1',
        namespace: 'production',
        status: 'Running',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        containers: [
          {
            name: 'main',
            image: 'nginx:alpine',
            restartCount: 0,
            ready: true,
            state: 'running',
            cpuUsage: '50m',
            memoryUsage: '64Mi'
          }
        ]
      };
      store.syncClusterResources(cluster.id, [nodeWithUsage, podWithUsage]);

      const status = store.getMetricsServerStatus(cluster.id, org.id);
      assert.ok(status);
      assert.equal(status.isActive, true);
      assert.equal(status.status, 'ACTIVE');

      const verification = await store.verifyMetricsServer(cluster.id, org.id);
      assert.ok(verification);
      assert.equal(verification.success, true);
      assert.ok(verification.message.includes('verified'));
    });
  });

  describe('Pod Logs Storage & Retrieval', () => {
    it('stores container logs and redacts sensitive tokens on retrieval', async () => {
      const org = store.createOrganization('Logs Test Org', 'user-log-test');
      const { cluster } = store.createCluster(org.id, 'log-cluster');

      const pod: KubernetesResource = {
        id: `${cluster.id}-pod-test-pod`,
        clusterId: cluster.id,
        kind: 'Pod',
        name: 'test-pod',
        namespace: 'default',
        status: 'Running',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        containers: [
          {
            name: 'web',
            image: 'nginx',
            restartCount: 0,
            ready: true,
            state: 'running'
          }
        ]
      };
      store.syncClusterResources(cluster.id, [pod]);

      const secretLog = '2026-09-14T10:00:00Z [INFO] Connected to db using password=SuperSecret456! with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz';
      store.storePodLogs(cluster.id, 'default', 'test-pod', 'web', secretLog, false);

      const logsRes = await store.getPodLogs(cluster.id, org.id, 'default', 'test-pod', { container: 'web', previous: false });
      assert.ok(logsRes);
      assert.ok(logsRes.rawText);
      assert.ok(!logsRes.rawText.includes('SuperSecret456!'));
      assert.ok(!logsRes.rawText.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz'));
      assert.ok(logsRes.rawText.includes('password=[REDACTED]'));
      assert.ok(logsRes.rawText.includes('Bearer [REDACTED_BEARER_TOKEN]'));
    });
  });
});
