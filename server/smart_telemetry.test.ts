import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TelemetryStore } from './telemetry_store';
import { DataStore } from './store';
import { MetricHistoryPoint } from '../src/types/index';

describe('Phase 2 Smart Telemetry, Tiered Retention & Historical Intelligence', () => {
  describe('Tiered Storage and Aggregations', () => {
    it('records raw observations and generates rollups without data loss', () => {
      const store = new TelemetryStore();
      const clusterId = 'test-cluster-1';
      const baseTime = Date.now() - 30 * 60 * 1000; // 30 minutes ago

      // Ingest 20 observations spaced 15 seconds apart
      for (let i = 0; i < 20; i++) {
        const timestamp = baseTime + i * 15 * 1000;
        store.recordObservation(clusterId, {
          timestamp,
          cpuCapacityMillicores: 4000,
          cpuAllocatableMillicores: 3800,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          cpuRequestedPercent: 53,
          cpuLimitPercent: 79,
          cpuUsageMillicores: 800 + i * 20,
          cpuUsagePercent: 20 + Math.round((i * 20) / 40),
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryAllocatableBytes: 15 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          memoryLimitBytes: 12 * 1024 * 1024 * 1024,
          memoryRequestedPercent: 53,
          memoryLimitPercent: 80,
          memoryUsageBytes: 4 * 1024 * 1024 * 1024 + i * 50 * 1024 * 1024,
          memoryUsagePercent: 25 + i,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        });
      }

      const raw = store.getRawPoints(clusterId, '1h');
      assert.equal(raw.length, 20);
      assert.equal(raw[0].isUsageAvailable, true);
      assert.equal(raw[0].source, 'metrics.k8s.io');

      // Verify rollups were generated for the 5-minute buckets
      const rollups5m = store.get5mRollups(clusterId, '1h');
      assert.ok(rollups5m.length > 0, 'Should have at least 1 five-minute rollup bucket');
      assert.ok(rollups5m[0].sampleCount! >= 1);
      assert.ok(rollups5m[0].cpuUsageAvgMillicores! > 0);
    });

    it('enforces zero-fabrication policy when metrics.k8s.io is unavailable', () => {
      const store = new TelemetryStore();
      const clusterId = 'cluster-no-metrics';
      const timestamp = Date.now();

      store.recordObservation(clusterId, {
        timestamp,
        cpuCapacityMillicores: 8000,
        cpuAllocatableMillicores: 7600,
        cpuRequestMillicores: 4000,
        cpuLimitMillicores: 6000,
        cpuRequestedPercent: 53,
        cpuLimitPercent: 79,
        // Live usage omitted because Metrics Server is not installed
        cpuUsageMillicores: undefined,
        cpuUsagePercent: undefined,
        memoryCapacityBytes: 32 * 1024 * 1024 * 1024,
        memoryAllocatableBytes: 30 * 1024 * 1024 * 1024,
        memoryRequestBytes: 16 * 1024 * 1024 * 1024,
        memoryLimitBytes: 24 * 1024 * 1024 * 1024,
        memoryRequestedPercent: 53,
        memoryLimitPercent: 80,
        memoryUsageBytes: undefined,
        memoryUsagePercent: undefined,
        isUsageAvailable: false,
        source: 'spec-derived'
      });

      const history = store.getTelemetryHistory(clusterId, { range: '1h' });
      assert.equal(history.isUsageAvailable, false);
      assert.equal(history.metricsSource, 'SPEC_STATUS_ONLY');
      assert.equal(history.runtimeStatus, 'UNAVAILABLE');
      assert.ok(history.summary.unavailableReason?.includes('Metrics Server'));

      // Verify points contain spec values but no fabricated usage
      assert.equal(history.points.length, 1);
      assert.equal(history.points[0].cpuRequestedPercent, 53);
      assert.equal(history.points[0].cpuUsagePercent, undefined);
      assert.equal(history.points[0].memoryUsagePercent, undefined);
    });
  });

  describe('Specification Deduplication and Change Tracking', () => {
    it('deduplicates identical resource specifications across sweeps', () => {
      const store = new TelemetryStore();
      const clusterId = 'cluster-spec-test';
      const now = Date.now();

      // Record 10 identical spec points
      for (let i = 0; i < 10; i++) {
        store.recordSpecChange(clusterId, {
          timestamp: now + i * 15000,
          nodeCount: 3,
          podCount: 25,
          cpuCapacityMillicores: 12000,
          cpuRequestMillicores: 6000,
          cpuLimitMillicores: 9000,
          memoryCapacityBytes: 48 * 1024 * 1024 * 1024,
          memoryRequestBytes: 24 * 1024 * 1024 * 1024,
          memoryLimitBytes: 36 * 1024 * 1024 * 1024
        });
      }

      const history = store.getTelemetryHistory(clusterId, { range: '1h' });
      // Only 1 spec entry should exist because specs did not change
      assert.equal(history.specHistory.length, 1);

      // Now introduce a real spec change (e.g. node scaled up)
      store.recordSpecChange(clusterId, {
        timestamp: now + 150000,
        nodeCount: 4, // Scaled from 3 to 4
        podCount: 30,
        cpuCapacityMillicores: 16000,
        cpuRequestMillicores: 7000,
        cpuLimitMillicores: 10000,
        memoryCapacityBytes: 64 * 1024 * 1024 * 1024,
        memoryRequestBytes: 28 * 1024 * 1024 * 1024,
        memoryLimitBytes: 40 * 1024 * 1024 * 1024
      });

      const updatedHistory = store.getTelemetryHistory(clusterId, { range: '1h' });
      assert.equal(updatedHistory.specHistory.length, 2);
      assert.equal(updatedHistory.specHistory[1].nodeCount, 4);
    });
  });

  describe('Incident-Aware Retention Pinning', () => {
    it('pins telemetry observations falling within active incident windows', () => {
      const store = new TelemetryStore();
      const clusterId = 'incident-pin-cluster';
      const incidentStart = Date.now() - 600 * 1000;
      const incidentEnd = Date.now() - 300 * 1000;

      const activeIncidentWindows = [
        { id: 'INC-999', startedAt: incidentStart, resolvedAt: incidentEnd }
      ];

      // Point comfortably before incident (outside 15-minute buffer: 25 minutes prior)
      store.recordObservation(
        clusterId,
        {
          timestamp: incidentStart - 25 * 60 * 1000,
          cpuCapacityMillicores: 4000,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        },
        activeIncidentWindows
      );

      // Point during incident
      store.recordObservation(
        clusterId,
        {
          timestamp: incidentStart + 30000,
          cpuCapacityMillicores: 4000,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        },
        activeIncidentWindows
      );

      const points = store.getRawPoints(clusterId, '1h');
      assert.equal(points.length, 2);
      assert.equal(points[0].pinned, false);
      assert.equal(points[1].pinned, true);
      assert.equal(points[1].incidentId, 'INC-999');
    });
  });

  describe('Baseline Calculation & Anomaly Detection', () => {
    it('computes statistical baseline metrics across observations', () => {
      const store = new TelemetryStore();
      const clusterId = 'baseline-cluster';
      const now = Date.now();

      for (let i = 0; i < 30; i++) {
        const cpuPct = 20 + (i % 10);
        const memPct = 30 + (i % 5);
        store.recordObservation(clusterId, {
          timestamp: now - (30 - i) * 60000,
          cpuCapacityMillicores: 4000,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          cpuUsageMillicores: Math.round((cpuPct / 100) * 4000),
          cpuUsagePercent: cpuPct,
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          memoryLimitBytes: 12 * 1024 * 1024 * 1024,
          memoryUsageBytes: Math.round((memPct / 100) * 16 * 1024 * 1024 * 1024),
          memoryUsagePercent: memPct,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        });
      }

      const baseline = store.calculateBaseline(clusterId, '1h', now);
      assert.ok(baseline !== null);
      assert.ok(baseline!.sampleSize > 0);
      assert.ok(baseline!.cpu.avgPercent !== undefined && baseline!.cpu.avgPercent >= 20);
      assert.ok(baseline!.cpu.p95Percent !== undefined);
    });

    it('detects overcommitment anomalies when requests exceed allocatable capacity', () => {
      const store = new TelemetryStore();
      const clusterId = 'anomaly-cluster';
      const now = Date.now();

      store.recordObservation(clusterId, {
        timestamp: now,
        cpuCapacityMillicores: 4000,
        cpuAllocatableMillicores: 3800,
        cpuRequestMillicores: 4500, // 118% requested!
        cpuRequestedPercent: 118,
        cpuLimitMillicores: 6000,
        cpuLimitPercent: 158,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryAllocatableBytes: 15 * 1024 * 1024 * 1024,
        memoryRequestBytes: 17 * 1024 * 1024 * 1024, // Overcommitted
        memoryRequestedPercent: 113,
        memoryLimitBytes: 20 * 1024 * 1024 * 1024,
        memoryLimitPercent: 133,
        isUsageAvailable: false,
        source: 'spec-derived'
      });

      const anomalies = store.detectAnomalies(clusterId, now);
      assert.ok(anomalies.length >= 1);
      const overcommit = anomalies.find((a) => a.type === 'SPEC_OVERCOMMITMENT');
      assert.ok(overcommit !== undefined);
      assert.equal(overcommit!.severity, 'WARNING');
    });

    it('detects baseline deviation anomalies with complete evidence and sustained flags', () => {
      const store = new TelemetryStore();
      const clusterId = 'deviation-cluster';
      const now = Date.now();

      // Seed 20 baseline points around 25% CPU and 30% memory
      for (let i = 0; i < 20; i++) {
        store.recordObservation(clusterId, {
          timestamp: now - (25 - i) * 60000,
          cpuCapacityMillicores: 4000,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          cpuUsageMillicores: 1000,
          cpuUsagePercent: 25,
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          memoryLimitBytes: 12 * 1024 * 1024 * 1024,
          memoryUsageBytes: 4800000000,
          memoryUsagePercent: 30,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        });
      }

      // Now inject sustained spike of 80% CPU (far above 25% avg and > avg + 15%) across 4 observations
      for (let i = 0; i < 4; i++) {
        store.recordObservation(clusterId, {
          timestamp: now - (4 - i) * 15000,
          cpuCapacityMillicores: 4000,
          cpuRequestMillicores: 2000,
          cpuLimitMillicores: 3000,
          cpuUsageMillicores: 3200,
          cpuUsagePercent: 80,
          memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
          memoryRequestBytes: 8 * 1024 * 1024 * 1024,
          memoryLimitBytes: 12 * 1024 * 1024 * 1024,
          memoryUsageBytes: 4800000000,
          memoryUsagePercent: 30,
          isUsageAvailable: true,
          source: 'metrics.k8s.io'
        });
      }

      const anomalies = store.detectAnomalies(clusterId, now);
      const baselineDev = anomalies.find((a) => a.id.includes('CPU_BASELINE_DEVIATION'));
      assert.ok(baselineDev !== undefined, 'Should detect CPU_BASELINE_DEVIATION');
      assert.ok(String(baselineDev!.observedValue).includes('sustained'), 'Should flag sustained deviation');
      assert.ok(String(baselineDev!.expectedValue).includes('baseline normal range'));
      assert.ok(baselineDev!.deviationReason.includes('exceeds baseline upper bound'));
      assert.ok(baselineDev!.evidenceReferences.length >= 2);
      assert.equal(baselineDev!.source, 'metrics.k8s.io');
      assert.ok(baselineDev!.confidence >= 0.85);
    });

    it('reports INSUFFICIENT_HISTORY when insufficient samples exist for baseline calculation', () => {
      const store = new TelemetryStore();
      const clusterId = 'new-empty-cluster';
      const now = Date.now();

      // Only 2 points recorded
      store.recordObservation(clusterId, {
        timestamp: now - 30000,
        cpuCapacityMillicores: 4000,
        cpuRequestMillicores: 1000,
        cpuLimitMillicores: 2000,
        cpuUsagePercent: 20,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryRequestBytes: 8 * 1024 * 1024 * 1024,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });
      store.recordObservation(clusterId, {
        timestamp: now,
        cpuCapacityMillicores: 4000,
        cpuRequestMillicores: 1000,
        cpuLimitMillicores: 2000,
        cpuUsagePercent: 25,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryRequestBytes: 8 * 1024 * 1024 * 1024,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });

      const baseline = store.calculateBaseline(clusterId, '24h', now);
      assert.ok(baseline !== null);
      assert.equal(baseline!.status, 'INSUFFICIENT_EVIDENCE');
      assert.equal(baseline!.quality, 'INSUFFICIENT_HISTORY');
      assert.equal(baseline!.confidence, 'LOW');
      assert.equal(baseline!.sampleSize, 2);
    });
  });

  describe('Telemetry Snapshot Persistence & DataStore Integration', () => {
    it('persists and reloads telemetry data across export and import snapshots', () => {
      const store1 = new TelemetryStore();
      const clusterId = 'persist-cluster';
      const now = Date.now();

      store1.recordObservation(clusterId, {
        timestamp: now,
        cpuCapacityMillicores: 4000,
        cpuRequestMillicores: 2000,
        cpuLimitMillicores: 3000,
        cpuUsagePercent: 35,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryRequestBytes: 8 * 1024 * 1024 * 1024,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });

      store1.recordSpecChange(clusterId, {
        timestamp: now,
        nodeCount: 2,
        podCount: 10,
        cpuCapacityMillicores: 4000,
        cpuRequestMillicores: 2000,
        cpuLimitMillicores: 3000,
        memoryCapacityBytes: 8000,
        memoryRequestBytes: 4000,
        memoryLimitBytes: 6000
      });

      const snapshot = store1.exportSnapshot();
      assert.ok(snapshot[clusterId]);
      assert.equal(snapshot[clusterId].rawPoints.length, 1);
      assert.equal(snapshot[clusterId].specHistory.length, 1);

      const store2 = new TelemetryStore();
      store2.importSnapshot(snapshot);

      const points = store2.getRawPoints(clusterId, '1h');
      assert.equal(points.length, 1);
      assert.equal(points[0].cpuUsagePercent, 35);

      const specs = store2.getTelemetryHistory(clusterId).specHistory;
      assert.equal(specs.length, 1);
      assert.equal(specs[0].nodeCount, 2);
    });

    it('DataStore seamlessly provides getTelemetryHistory and getTelemetryBaseline', () => {
      const ds = new DataStore();
      const org = ds.createOrganization('Telemetry Org', 'user-test-1');
      const { cluster } = ds.createCluster(org.id, 'prod-cluster');

      // Record telemetry via store
      ds.recordMetricHistoryPoint(cluster.id, {
        timestamp: Date.now(),
        cpuCapacityMillicores: 4000,
        cpuAllocatableMillicores: 3800,
        cpuRequestMillicores: 2000,
        cpuLimitMillicores: 3000,
        cpuRequestedPercent: 53,
        cpuLimitPercent: 79,
        cpuUsagePercent: 25,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryAllocatableBytes: 15 * 1024 * 1024 * 1024,
        memoryRequestBytes: 8 * 1024 * 1024 * 1024,
        memoryLimitBytes: 12 * 1024 * 1024 * 1024,
        memoryRequestedPercent: 53,
        memoryLimitPercent: 80,
        memoryUsagePercent: 30,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });

      const telemetryRes = ds.getTelemetryHistory(cluster.id, org.id, { range: '1h' });
      assert.ok(telemetryRes !== null);
      assert.equal(telemetryRes!.clusterId, cluster.id);
      assert.equal(telemetryRes!.isUsageAvailable, true);
      assert.equal(telemetryRes!.runtimeStatus, 'LIVE');
      assert.equal(telemetryRes!.points.length, 1);
      assert.equal(telemetryRes!.rawObservations.length, 1);

      const baseline = ds.getTelemetryBaseline(cluster.id, org.id, '1h');
      assert.ok(baseline !== null);
      assert.equal(baseline!.clusterId, cluster.id);
      assert.ok(baseline!.sampleSize >= 1);
    });

    it('accurately calculates CPU and Memory averages independently when one metric is partially available', () => {
      const store = new TelemetryStore();
      const clusterId = 'cluster-partial-metrics';
      const baseBucketTime = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000);

      // Observation 1: Both CPU (1000m) and Memory (1000 Bytes)
      store.recordObservation(clusterId, {
        timestamp: baseBucketTime + 10_000,
        cpuCapacityMillicores: 4000,
        cpuUsageMillicores: 1000,
        cpuUsagePercent: 25,
        memoryCapacityBytes: 4000,
        memoryUsageBytes: 1000,
        memoryUsagePercent: 25,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });

      // Observation 2: CPU only (3000m), Memory missing/undefined
      store.recordObservation(clusterId, {
        timestamp: baseBucketTime + 25_000,
        cpuCapacityMillicores: 4000,
        cpuUsageMillicores: 3000,
        cpuUsagePercent: 75,
        memoryCapacityBytes: 4000,
        memoryUsageBytes: undefined,
        memoryUsagePercent: undefined,
        isUsageAvailable: true,
        source: 'metrics.k8s.io'
      });

      const rollups = store.get5mRollups(clusterId, '1h');
      assert.equal(rollups.length, 1);
      const bucket = rollups[0];

      // Sample count is 2 total
      assert.equal(bucket.sampleCount, 2);
      // CPU was present in 2 samples: sum = 4000m, avg = 4000 / 2 = 2000m (50%)
      assert.equal(bucket.cpuUsageAvgMillicores, 2000);
      assert.equal(bucket.cpuUsagePercent, 50);

      // Memory was present in only 1 sample: sum = 1000 Bytes, avg must be 1000 / 1 = 1000 Bytes (25%), NOT 1000 / 2 = 500 Bytes!
      assert.equal(bucket.memoryUsageAvgBytes, 1000);
      assert.equal(bucket.memoryUsagePercent, 25);
    });

    it('truthfully preserves undefined for unconfigured requests and limits (None vs Zero semantics)', () => {
      const store = new TelemetryStore();
      const clusterId = 'cluster-unconfigured-spec';
      const now = Date.now();

      store.recordObservation(clusterId, {
        timestamp: now,
        cpuCapacityMillicores: 4000,
        // No requests or limits specified in spec
        cpuRequestMillicores: undefined,
        cpuLimitMillicores: undefined,
        cpuRequestedPercent: undefined,
        cpuLimitPercent: undefined,
        memoryCapacityBytes: 16 * 1024 * 1024 * 1024,
        memoryRequestBytes: undefined,
        memoryLimitBytes: undefined,
        memoryRequestedPercent: undefined,
        memoryLimitPercent: undefined,
        isUsageAvailable: false,
        source: 'spec-derived'
      });

      const history = store.getTelemetryHistory(clusterId, { range: '1h' });
      // Crucial: current percentages must be undefined, NEVER converted to 0
      assert.equal(history.summary.currentCpuRequestPercent, undefined);
      assert.equal(history.summary.currentCpuLimitPercent, undefined);
      assert.equal(history.summary.currentMemoryRequestPercent, undefined);
      assert.equal(history.summary.currentMemoryLimitPercent, undefined);

      // Points must preserve undefined
      assert.equal(history.points[0].cpuRequestedPercent, undefined);
      assert.equal(history.points[0].cpuLimitPercent, undefined);
      assert.equal(history.points[0].memoryRequestedPercent, undefined);
      assert.equal(history.points[0].memoryLimitPercent, undefined);
    });

    it('handles exact 10-observation rollup with sporadic unavailable usage (divides by valid samples, not 10)', () => {
      const store = new TelemetryStore();
      const clusterId = 'cluster-10-obs';
      const baseBucketTime = Math.floor(Date.now() / (5 * 60 * 1000)) * (5 * 60 * 1000);

      // 10 observations:
      // CPU: 500m, 600m, unavailable, unavailable, 700m, unavailable, 800m, unavailable, unavailable, 900m
      // Sum = 500 + 600 + 700 + 800 + 900 = 3500m
      // Valid CPU count = 5. Average MUST be 3500 / 5 = 700m (NOT 3500 / 10 = 350m!)
      // Memory: unavailable, 1000, 2000, unavailable, unavailable, 3000, unavailable, unavailable, unavailable, 4000
      // Sum = 1000 + 2000 + 3000 + 4000 = 10000. Valid count = 4. Average MUST be 10000 / 4 = 2500.
      const cpuSeries: Array<number | undefined> = [
        500, 600, undefined, undefined, 700, undefined, 800, undefined, undefined, 900
      ];
      const memSeries: Array<number | undefined> = [
        undefined, 1000, 2000, undefined, undefined, 3000, undefined, undefined, undefined, 4000
      ];

      for (let i = 0; i < 10; i++) {
        const cpuVal = cpuSeries[i];
        const memVal = memSeries[i];
        store.recordObservation(clusterId, {
          timestamp: baseBucketTime + i * 5000,
          cpuCapacityMillicores: 10000,
          cpuUsageMillicores: cpuVal,
          cpuUsagePercent: cpuVal !== undefined ? Math.round((cpuVal / 10000) * 100) : undefined,
          memoryCapacityBytes: 100000,
          memoryUsageBytes: memVal,
          memoryUsagePercent: memVal !== undefined ? Math.round((memVal / 100000) * 100) : undefined,
          isUsageAvailable: cpuVal !== undefined || memVal !== undefined,
          source: (cpuVal !== undefined || memVal !== undefined) ? 'metrics.k8s.io' : 'spec-derived'
        });
      }

      const rollups = store.get5mRollups(clusterId, '1h');
      assert.equal(rollups.length, 1);
      const bucket = rollups[0];

      // Total observations = 10
      assert.equal(bucket.sampleCount, 10);

      // CPU valid samples = 5. Avg = 3500 / 5 = 700m, NOT 350m
      assert.equal(bucket.cpuUsageAvgMillicores, 700);
      assert.equal(bucket.cpuUsagePercent, 7); // 700 / 10000 = 7%
      assert.equal(bucket.cpuUsageMinMillicores, 500);
      assert.equal(bucket.cpuUsageMaxMillicores, 900);
      assert.equal(bucket.cpuUsageMillicores, 900); // latest observed

      // Memory valid samples = 4. Avg = 10000 / 4 = 2500, NOT 1000
      assert.equal(bucket.memoryUsageAvgBytes, 2500);
      assert.equal(bucket.memoryUsagePercent, 3); // 2500 / 100000 = 2.5% rounded to 3%
      assert.equal(bucket.memoryUsageMinBytes, 1000);
      assert.equal(bucket.memoryUsageMaxBytes, 4000);
      assert.equal(bucket.memoryUsageBytes, 4000); // latest observed
    });
  });
});
