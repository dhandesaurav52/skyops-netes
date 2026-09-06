import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCpuQuantity,
  parseMemoryQuantity,
  formatCpuMillicores,
  formatMemoryBytes,
  evaluateFreshness,
  buildPodResourceMetrics,
  buildNodeMetricsSummary,
  buildWorkloadMetricsSummary,
  buildClusterObservabilityMetrics
} from './metrics';
import { Cluster, KubernetesResource } from '../src/types/index';

describe('Kubernetes Observability & Metrics Foundation', () => {
  describe('parseCpuQuantity', () => {
    it('parses plain integer and float cores to millicores', () => {
      assert.equal(parseCpuQuantity('2'), 2000);
      assert.equal(parseCpuQuantity('0.5'), 500);
      assert.equal(parseCpuQuantity('4.0'), 4000);
      assert.equal(parseCpuQuantity(1.5), 1500);
    });

    it('parses millicores, microcores, and nanocores correctly', () => {
      assert.equal(parseCpuQuantity('250m'), 250);
      assert.equal(parseCpuQuantity('100m'), 100);
      assert.equal(parseCpuQuantity('500000u'), 500);
      assert.equal(parseCpuQuantity('250000000n'), 250);
    });

    it('returns null for missing or invalid values without fabricating data', () => {
      assert.equal(parseCpuQuantity(undefined), null);
      assert.equal(parseCpuQuantity(null), null);
      assert.equal(parseCpuQuantity(''), null);
      assert.equal(parseCpuQuantity('invalid'), null);
      assert.equal(parseCpuQuantity(-10), null);
    });
  });

  describe('parseMemoryQuantity', () => {
    it('parses binary SI units (Ki, Mi, Gi, Ti)', () => {
      assert.equal(parseMemoryQuantity('1024Ki'), 1024 * 1024);
      assert.equal(parseMemoryQuantity('128Mi'), 128 * 1024 * 1024);
      assert.equal(parseMemoryQuantity('4Gi'), 4 * 1024 * 1024 * 1024);
    });

    it('parses decimal SI units (k, M, G, T)', () => {
      assert.equal(parseMemoryQuantity('100M'), 100 * 1000 * 1000);
      assert.equal(parseMemoryQuantity('2G'), 2 * 1000 * 1000 * 1000);
    });

    it('parses raw integer bytes', () => {
      assert.equal(parseMemoryQuantity('1048576'), 1048576);
      assert.equal(parseMemoryQuantity(5242880), 5242880);
    });

    it('returns null for missing or invalid values without fabricating data', () => {
      assert.equal(parseMemoryQuantity(undefined), null);
      assert.equal(parseMemoryQuantity(null), null);
      assert.equal(parseMemoryQuantity(''), null);
      assert.equal(parseMemoryQuantity('not-a-number'), null);
    });
  });

  describe('Formatting utilities', () => {
    it('formats CPU millicores cleanly', () => {
      assert.equal(formatCpuMillicores(250), '250m');
      assert.equal(formatCpuMillicores(2000), '2 cores');
      assert.equal(formatCpuMillicores(1500), '1.50 cores');
      assert.equal(formatCpuMillicores(null), 'Unavailable');
      assert.equal(formatCpuMillicores(undefined), 'Unavailable');
    });

    it('formats Memory bytes cleanly', () => {
      assert.equal(formatMemoryBytes(134217728), '128 MiB');
      assert.equal(formatMemoryBytes(4294967296), '4.0 GiB');
      assert.equal(formatMemoryBytes(null), 'Unavailable');
      assert.equal(formatMemoryBytes(undefined), 'Unavailable');
    });
  });

  describe('Freshness evaluation', () => {
    it('classifies freshness based on observation timestamp', () => {
      const now = 1700000000000;
      assert.equal(evaluateFreshness(now - 30_000, now), 'FRESH');
      assert.equal(evaluateFreshness(now - 120_000, now), 'DELAYED');
      assert.equal(evaluateFreshness(now - 400_000, now), 'STALE');
      assert.equal(evaluateFreshness(0, now), 'UNAVAILABLE');
      assert.equal(evaluateFreshness(undefined, now), 'UNAVAILABLE');
    });
  });

  describe('Pod, Node, and Cluster Aggregations', () => {
    const mockCluster: Cluster = {
      id: 'cls-prod-1',
      name: 'Production Cluster',
      orgId: 'org-test',
      status: 'HEALTHY',
      agentStatus: 'CONNECTED',
      connectionState: 'connected',
      nodeCount: 1,
      podCount: 2,
      openIncidentCount: 0,
      createdAt: 1700000000000,
      lastHeartbeat: 1700000050000
    };

    const mockNode: KubernetesResource = {
      id: 'node-worker-1',
      clusterId: 'cls-prod-1',
      kind: 'Node',
      namespace: '',
      name: 'worker-node-1',
      status: 'Ready',
      health: 'HEALTHY',
      createdAt: 1700000000000,
      updatedAt: 1700000050000,
      specSummary: {},
      statusSummary: {
        capacity: { cpu: '4', memory: '16Gi', pods: '110' },
        allocatable: { cpu: '3800m', memory: '15Gi', pods: '110' },
        kubeletVersion: 'v1.28.2',
        cpuUsage: '950m',
        memoryUsage: '3Gi',
        metricsObservedAt: 1700000050000
      },
      conditions: [
        { type: 'Ready', status: 'True' },
        { type: 'MemoryPressure', status: 'False' }
      ]
    };

    const mockPod1: KubernetesResource = {
      id: 'pod-api-1',
      clusterId: 'cls-prod-1',
      kind: 'Pod',
      namespace: 'production',
      name: 'api-service-abc1',
      nodeName: 'worker-node-1',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: 1700000000000,
      updatedAt: 1700000050000,
      specSummary: { nodeName: 'worker-node-1' },
      statusSummary: {},
      containers: [
        {
          name: 'api',
          image: 'corp/api:v1.0.0',
          restartCount: 0,
          ready: true,
          state: 'running',
          cpuRequest: '500m',
          cpuLimit: '1000m',
          memoryRequest: '512Mi',
          memoryLimit: '1Gi',
          cpuUsage: '250m',
          memoryUsage: '400Mi'
        }
      ]
    };

    const mockPod2WithoutUsage: KubernetesResource = {
      id: 'pod-worker-2',
      clusterId: 'cls-prod-1',
      kind: 'Pod',
      namespace: 'production',
      name: 'worker-task-xyz9',
      nodeName: 'worker-node-1',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: 1700000000000,
      updatedAt: 1700000050000,
      specSummary: { nodeName: 'worker-node-1' },
      statusSummary: {},
      containers: [
        {
          name: 'worker',
          image: 'corp/worker:v1.0.0',
          restartCount: 0,
          ready: true,
          state: 'running',
          cpuRequest: '250m',
          cpuLimit: '500m',
          memoryRequest: '256Mi',
          memoryLimit: '512Mi'
          // Intentionally missing usage
        }
      ]
    };

    it('builds Pod resource metrics with requests, limits, and usage', () => {
      const metrics = buildPodResourceMetrics(mockPod1, 1700000060000);
      assert.equal(metrics.cpu.request?.value, 500);
      assert.equal(metrics.cpu.request?.formatted, '500m');
      assert.equal(metrics.cpu.limit?.value, 1000);
      assert.equal(metrics.cpu.limit?.formatted, '1 cores');
      assert.equal(metrics.cpu.usage?.value, 250);
      assert.equal(metrics.cpu.utilizationPercent, 25); // 250 / 1000
      assert.equal(metrics.isUsageAvailable, true);
    });

    it('marks usage as unavailable when pod has no live metrics without fabricating values', () => {
      const metrics = buildPodResourceMetrics(mockPod2WithoutUsage, 1700000060000);
      assert.equal(metrics.cpu.request?.value, 250);
      assert.equal(metrics.cpu.limit?.value, 500);
      assert.equal(metrics.cpu.usage, undefined);
      assert.equal(metrics.cpu.utilizationPercent, undefined);
      assert.equal(metrics.isUsageAvailable, false);
      assert.ok(metrics.unavailableReason?.includes('Live usage unavailable'));
    });

    it('builds Node metrics summary with aggregated scheduled pods', () => {
      const nodeMetrics = buildNodeMetricsSummary(mockNode, [mockPod1, mockPod2WithoutUsage], 1700000060000);
      assert.equal(nodeMetrics.cpu.capacity?.value, 4000);
      assert.equal(nodeMetrics.cpu.allocatable?.value, 3800);
      assert.equal(nodeMetrics.cpu.request?.value, 750); // 500 + 250
      assert.equal(nodeMetrics.cpu.limit?.value, 1500); // 1000 + 500
      assert.equal(nodeMetrics.cpu.usage?.value, 950);
      assert.equal(nodeMetrics.cpu.utilizationPercent, 25); // 950 / 3800 = 25%
      assert.equal(nodeMetrics.conditions.ready, true);
      assert.equal(nodeMetrics.conditions.memoryPressure, false);
    });

    it('builds cluster-wide observability metrics', () => {
      const clusterMetrics = buildClusterObservabilityMetrics(
        mockCluster,
        [mockNode, mockPod1, mockPod2WithoutUsage],
        1700000060000
      );
      assert.equal(clusterMetrics.nodeCount, 1);
      assert.equal(clusterMetrics.podCount, 2);
      assert.equal(clusterMetrics.cpu.capacity.value, 4000);
      assert.equal(clusterMetrics.cpu.allocatable.value, 3800);
      assert.equal(clusterMetrics.cpu.request.value, 750);
      assert.equal(clusterMetrics.cpu.limit.value, 1500);
      assert.equal(clusterMetrics.cpu.usage?.value, 950);
      assert.equal(clusterMetrics.isUsageAvailable, true);
      assert.equal(clusterMetrics.freshnessStatus, 'FRESH');
    });
  });
});
