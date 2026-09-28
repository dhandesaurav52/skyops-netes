import {
  MetricHistoryPoint,
  ResourceBaseline,
  SpecChangePoint,
  TelemetryAnomaly,
  TelemetryQueryOptions,
  TelemetryResponse,
  TelemetrySummary
} from '../src/types/index';

/**
 * Internal bucket accumulator for time-series rollups.
 */
interface RollupBucket {
  timestamp: number; // bucket start timestamp
  resolution: '5m' | '1h';
  sampleCount: number;
  cpuUsageSampleCount: number;
  memoryUsageSampleCount: number;
  cpuRequestMillicores: number;
  cpuCapacityMillicores: number;
  cpuRequestedPercent?: number;
  cpuLimitPercent?: number;
  memoryRequestBytes: number;
  memoryCapacityBytes: number;
  memoryRequestedPercent?: number;
  memoryLimitPercent?: number;

  // Runtime CPU metrics (if live)
  cpuUsageSum: number;
  cpuUsageMin?: number;
  cpuUsageMax?: number;
  cpuUsageLatest?: number;

  // Runtime Memory metrics (if live)
  memoryUsageSum: number;
  memoryUsageMin?: number;
  memoryUsageMax?: number;
  memoryUsageLatest?: number;

  isUsageAvailable: boolean;
  source?: string;
  incidentId?: string;
}

/**
 * Per-cluster telemetry history state.
 */
interface ClusterTelemetryBucket {
  clusterId: string;
  rawPoints: MetricHistoryPoint[]; // Recent high-resolution observations (pruned at 2h unless pinned)
  rollups5m: Map<number, RollupBucket>; // 5-minute rollup buckets (pruned at 48h)
  rollups1h: Map<number, RollupBucket>; // 1-hour rollup buckets (pruned at 7d)
  specHistory: SpecChangePoint[]; // Config changes history (pruned at 7d)
  lastSpecSignature?: string; // Fingerprint of current spec to avoid duplicate snapshots
}

export class TelemetryStore {
  private clusters = new Map<string, ClusterTelemetryBucket>();

  // Retention windows
  private readonly RAW_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours for unpinned raw observations
  private readonly ROLLUP_5M_RETENTION_MS = 48 * 60 * 60 * 1000; // 48 hours for 5m rollups
  private readonly ROLLUP_1H_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for 1h rollups
  private readonly SPEC_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days for spec changes
  private readonly MAX_RAW_POINTS = 1200;

  private getOrCreateClusterBucket(clusterId: string): ClusterTelemetryBucket {
    let bucket = this.clusters.get(clusterId);
    if (!bucket) {
      bucket = {
        clusterId,
        rawPoints: [],
        rollups5m: new Map(),
        rollups1h: new Map(),
        specHistory: []
      };
      this.clusters.set(clusterId, bucket);
    }
    return bucket;
  }

  /**
   * Records a raw telemetry observation and updates tiered rollups and incident pinning.
   */
  public recordObservation(
    clusterId: string,
    point: MetricHistoryPoint,
    activeIncidents: Array<{ id: string; startedAt: number; resolvedAt?: number }> = [],
    now = Date.now()
  ): void {
    const bucket = this.getOrCreateClusterBucket(clusterId);
    const ts = point.timestamp || now;

    // Check incident-aware pinning:
    // If point falls in [startedAt - 15m, (resolvedAt || now) + 15m] of any incident, pin it.
    let isPinned = false;
    let incidentId: string | undefined = undefined;

    const INCIDENT_BUFFER_MS = 15 * 60 * 1000;
    for (const inc of activeIncidents) {
      const windowStart = (inc.startedAt || now) - INCIDENT_BUFFER_MS;
      const windowEnd = (inc.resolvedAt || now) + INCIDENT_BUFFER_MS;
      if (ts >= windowStart && ts <= windowEnd) {
        isPinned = true;
        incidentId = inc.id;
        break;
      }
    }

    const recordedPoint: MetricHistoryPoint = {
      ...point,
      timestamp: ts,
      resolution: 'raw',
      pinned: isPinned,
      incidentId
    };

    // 1. Add to raw points
    bucket.rawPoints.push(recordedPoint);

    // 2. Update 5-minute rollup bucket
    this.accumulateRollup(bucket.rollups5m, ts, 5 * 60 * 1000, '5m', recordedPoint);

    // 3. Update 1-hour rollup bucket
    this.accumulateRollup(bucket.rollups1h, ts, 60 * 60 * 1000, '1h', recordedPoint);

    // 4. Prune raw points older than RAW_RETENTION_MS UNLESS pinned
    const rawCutoff = now - this.RAW_RETENTION_MS;
    bucket.rawPoints = bucket.rawPoints.filter((p) => p.pinned || p.timestamp >= rawCutoff);
    if (bucket.rawPoints.length > this.MAX_RAW_POINTS) {
      // Keep pinned points and trim the oldest unpinned
      const pinned = bucket.rawPoints.filter((p) => p.pinned);
      const unpinned = bucket.rawPoints.filter((p) => !p.pinned);
      const excess = bucket.rawPoints.length - this.MAX_RAW_POINTS;
      if (unpinned.length > excess) {
        unpinned.splice(0, excess);
        bucket.rawPoints = [...unpinned, ...pinned].sort((a, b) => a.timestamp - b.timestamp);
      }
    }

    // 5. Prune rollups
    const rollup5mCutoff = now - this.ROLLUP_5M_RETENTION_MS;
    for (const [key] of bucket.rollups5m) {
      if (key < rollup5mCutoff) bucket.rollups5m.delete(key);
    }

    const rollup1hCutoff = now - this.ROLLUP_1H_RETENTION_MS;
    for (const [key] of bucket.rollups1h) {
      if (key < rollup1hCutoff) bucket.rollups1h.delete(key);
    }
  }

  /**
   * Helper to accumulate a point into a rollup bucket.
   */
  private accumulateRollup(
    map: Map<number, RollupBucket>,
    ts: number,
    intervalMs: number,
    resolution: '5m' | '1h',
    point: MetricHistoryPoint
  ): void {
    const bucketStart = Math.floor(ts / intervalMs) * intervalMs;
    let b = map.get(bucketStart);

    const hasCpu = point.cpuUsageMillicores !== undefined && point.cpuUsageMillicores !== null;
    const hasMem = point.memoryUsageBytes !== undefined && point.memoryUsageBytes !== null;

    if (!b) {
      b = {
        timestamp: bucketStart,
        resolution,
        sampleCount: 1,
        cpuUsageSampleCount: hasCpu ? 1 : 0,
        memoryUsageSampleCount: hasMem ? 1 : 0,
        cpuRequestMillicores: point.cpuRequestMillicores,
        cpuCapacityMillicores: point.cpuCapacityMillicores,
        cpuRequestedPercent: point.cpuRequestedPercent,
        cpuLimitPercent: point.cpuLimitPercent,
        memoryRequestBytes: point.memoryRequestBytes,
        memoryCapacityBytes: point.memoryCapacityBytes,
        memoryRequestedPercent: point.memoryRequestedPercent,
        memoryLimitPercent: point.memoryLimitPercent,
        cpuUsageSum: hasCpu ? point.cpuUsageMillicores! : 0,
        cpuUsageMin: hasCpu ? point.cpuUsageMillicores : undefined,
        cpuUsageMax: hasCpu ? point.cpuUsageMillicores : undefined,
        cpuUsageLatest: hasCpu ? point.cpuUsageMillicores : undefined,
        memoryUsageSum: hasMem ? point.memoryUsageBytes! : 0,
        memoryUsageMin: hasMem ? point.memoryUsageBytes : undefined,
        memoryUsageMax: hasMem ? point.memoryUsageBytes : undefined,
        memoryUsageLatest: hasMem ? point.memoryUsageBytes : undefined,
        isUsageAvailable: hasCpu || hasMem || Boolean(point.isUsageAvailable),
        source: point.source,
        incidentId: point.incidentId
      };
      map.set(bucketStart, b);
      return;
    }

    b.sampleCount++;
    b.cpuRequestMillicores = point.cpuRequestMillicores;
    b.cpuCapacityMillicores = point.cpuCapacityMillicores;
    b.cpuRequestedPercent = point.cpuRequestedPercent;
    b.cpuLimitPercent = point.cpuLimitPercent;
    b.memoryRequestBytes = point.memoryRequestBytes;
    b.memoryCapacityBytes = point.memoryCapacityBytes;
    b.memoryRequestedPercent = point.memoryRequestedPercent;
    b.memoryLimitPercent = point.memoryLimitPercent;
    if (point.source) b.source = point.source;
    if (point.incidentId) b.incidentId = point.incidentId;

    if (hasCpu) {
      b.cpuUsageSum += point.cpuUsageMillicores!;
      b.cpuUsageSampleCount = (b.cpuUsageSampleCount || 0) + 1;
      b.cpuUsageMin = b.cpuUsageMin !== undefined ? Math.min(b.cpuUsageMin, point.cpuUsageMillicores!) : point.cpuUsageMillicores;
      b.cpuUsageMax = b.cpuUsageMax !== undefined ? Math.max(b.cpuUsageMax, point.cpuUsageMillicores!) : point.cpuUsageMillicores;
      b.cpuUsageLatest = point.cpuUsageMillicores;
      b.isUsageAvailable = true;
    }

    if (hasMem) {
      b.memoryUsageSum += point.memoryUsageBytes!;
      b.memoryUsageSampleCount = (b.memoryUsageSampleCount || 0) + 1;
      b.memoryUsageMin = b.memoryUsageMin !== undefined ? Math.min(b.memoryUsageMin, point.memoryUsageBytes!) : point.memoryUsageBytes;
      b.memoryUsageMax = b.memoryUsageMax !== undefined ? Math.max(b.memoryUsageMax, point.memoryUsageBytes!) : point.memoryUsageBytes;
      b.memoryUsageLatest = point.memoryUsageBytes;
      b.isUsageAvailable = true;
    }
  }

  /**
   * Records a resource specification change only when requests, limits, capacity, or node/pod counts change.
   */
  public recordSpecChange(clusterId: string, spec: SpecChangePoint, now = Date.now()): boolean {
    const bucket = this.getOrCreateClusterBucket(clusterId);
    const signature = `${spec.cpuRequestMillicores}:${spec.cpuLimitMillicores || 0}:${spec.cpuAllocatableMillicores}:${spec.memoryRequestBytes}:${spec.memoryLimitBytes || 0}:${spec.memoryAllocatableBytes}:${spec.nodeCount}:${spec.podCount}`;

    if (bucket.lastSpecSignature === signature) {
      return false; // No specification change occurred
    }

    bucket.lastSpecSignature = signature;
    bucket.specHistory.push({
      ...spec,
      timestamp: spec.timestamp || now
    });

    const cutoff = now - this.SPEC_RETENTION_MS;
    bucket.specHistory = bucket.specHistory.filter((s) => s.timestamp >= cutoff);
    if (bucket.specHistory.length > 200) {
      bucket.specHistory.splice(0, bucket.specHistory.length - 200);
    }
    return true;
  }

  /**
   * Retrieves smart telemetry points with range-based resolution, raw observations, spec transitions, and summary.
   */
  public getTelemetryHistory(
    clusterId: string,
    options: TelemetryQueryOptions = {},
    now = Date.now()
  ): TelemetryResponse {
    const bucket = this.clusters.get(clusterId);
    const range = options.range || '1h';
    const rawLimit = options.limit || 20;

    let windowMs = 60 * 60 * 1000;
    if (range === '15m') windowMs = 15 * 60 * 1000;
    else if (range === '1h') windowMs = 60 * 60 * 1000;
    else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
    else if (range === '24h') windowMs = 24 * 60 * 60 * 1000;
    else if (range === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;

    const cutoff = now - windowMs;

    if (!bucket) {
      return {
        clusterId,
        timeRange: range,
        resolution: 'none',
        isUsageAvailable: false,
        metricsSource: 'UNAVAILABLE',
        runtimeStatus: 'UNAVAILABLE',
        summary: {
          dataPointsCount: 0,
          rawObservationsCount: 0,
          specChangesCount: 0,
          currentCpuRequestPercent: 0,
          currentCpuLimitPercent: 0,
          currentMemoryRequestPercent: 0,
          currentMemoryLimitPercent: 0
        },
        points: [],
        rawObservations: [],
        specHistory: []
      };
    }

    // Determine target resolution
    let effectiveResolution: 'raw' | '5m' | '1h' = 'raw';
    if (options.resolution && options.resolution !== 'auto') {
      if (options.resolution === '5m') effectiveResolution = '5m';
      else if (options.resolution === '1h') effectiveResolution = '1h';
      else effectiveResolution = 'raw';
    } else {
      // Auto selection
      if (range === '15m' || range === '1h') effectiveResolution = 'raw';
      else if (range === '6h' || range === '24h') effectiveResolution = '5m';
      else effectiveResolution = '1h';
    }

    let returnedPoints: MetricHistoryPoint[] = [];

    if (effectiveResolution === 'raw') {
      returnedPoints = bucket.rawPoints.filter((p) => p.timestamp >= cutoff);
      // If raw points don't reach back enough (e.g. older than 2h) but range asked for 1h/raw, complement with 5m rollups
      if (returnedPoints.length === 0 && bucket.rollups5m.size > 0) {
        returnedPoints = this.convertRollupsToPoints(bucket.rollups5m, cutoff);
      }
    } else if (effectiveResolution === '5m') {
      returnedPoints = this.convertRollupsToPoints(bucket.rollups5m, cutoff);
      // If 5m rollups are empty for this window, fall back to raw points or 1h rollups
      if (returnedPoints.length === 0) {
        returnedPoints = bucket.rawPoints.filter((p) => p.timestamp >= cutoff);
      }
    } else {
      // 1h rollups
      returnedPoints = this.convertRollupsToPoints(bucket.rollups1h, cutoff);
      if (returnedPoints.length === 0) {
        returnedPoints = this.convertRollupsToPoints(bucket.rollups5m, cutoff);
      }
    }

    returnedPoints.sort((a, b) => a.timestamp - b.timestamp);

    // Bounded raw observations for the detailed observation table
    const recentRaw = bucket.rawPoints
      .slice(-rawLimit)
      .reverse();

    // Spec history in window
    const recentSpecs = bucket.specHistory.filter((s) => s.timestamp >= cutoff);

    // Detect if live runtime usage is available
    const anyUsage = returnedPoints.some((p) => p.isUsageAvailable && (p.cpuUsagePercent !== undefined || p.memoryUsagePercent !== undefined)) ||
      bucket.rawPoints.slice(-10).some((p) => p.isUsageAvailable && (p.cpuUsageMillicores !== undefined || p.memoryUsageBytes !== undefined));

    const latestPoint = bucket.rawPoints.length > 0 ? bucket.rawPoints[bucket.rawPoints.length - 1] : returnedPoints[returnedPoints.length - 1];
    const latestAge = latestPoint ? now - latestPoint.timestamp : Infinity;

    let runtimeStatus: 'LIVE' | 'UNAVAILABLE' | 'STALE' = 'UNAVAILABLE';
    if (anyUsage) {
      runtimeStatus = latestAge < 180_000 ? 'LIVE' : 'STALE';
    } else {
      runtimeStatus = 'UNAVAILABLE';
    }

    const metricsSource: 'METRICS_SERVER' | 'SPEC_STATUS_ONLY' | 'UNAVAILABLE' = anyUsage
      ? 'METRICS_SERVER'
      : (latestPoint ? 'SPEC_STATUS_ONLY' : 'UNAVAILABLE');

    // Calculate summary statistics
    let sumCpuUsage = 0;
    let countCpuUsage = 0;
    let peakCpuUsage: number | undefined = undefined;

    let sumMemUsage = 0;
    let countMemUsage = 0;
    let peakMemUsage: number | undefined = undefined;

    for (const p of returnedPoints) {
      if (p.cpuUsagePercent !== undefined) {
        sumCpuUsage += p.cpuUsagePercent;
        countCpuUsage++;
        peakCpuUsage = peakCpuUsage !== undefined ? Math.max(peakCpuUsage, p.cpuUsagePercent) : p.cpuUsagePercent;
      }
      if (p.memoryUsagePercent !== undefined) {
        sumMemUsage += p.memoryUsagePercent;
        countMemUsage++;
        peakMemUsage = peakMemUsage !== undefined ? Math.max(peakMemUsage, p.memoryUsagePercent) : p.memoryUsagePercent;
      }
    }

    const currentCpuReq = latestPoint?.cpuRequestedPercent;
    const currentCpuLim = latestPoint?.cpuLimitPercent;
    const currentMemReq = latestPoint?.memoryRequestedPercent;
    const currentMemLim = latestPoint?.memoryLimitPercent;

    const unavailableReason = anyUsage
      ? undefined
      : 'Metrics Server (metrics.k8s.io) is not available or not reporting in this cluster';

    const summary: TelemetrySummary = {
      dataPointsCount: returnedPoints.length,
      rawObservationsCount: bucket.rawPoints.length,
      specChangesCount: recentSpecs.length,
      avgCpuUsagePercent: countCpuUsage > 0 ? Math.round(sumCpuUsage / countCpuUsage) : undefined,
      peakCpuUsagePercent: peakCpuUsage,
      avgMemoryUsagePercent: countMemMemSafe(sumMemUsage, countMemUsage),
      peakMemoryUsagePercent: peakMemUsage,
      currentCpuRequestPercent: currentCpuReq,
      currentCpuLimitPercent: currentCpuLim,
      currentMemoryRequestPercent: currentMemReq,
      currentMemoryLimitPercent: currentMemLim,
      unavailableReason
    };

    return {
      clusterId,
      timeRange: range,
      resolution: effectiveResolution,
      isUsageAvailable: anyUsage,
      metricsSource,
      runtimeStatus,
      unavailableReason,
      summary,
      points: returnedPoints,
      rawObservations: recentRaw,
      specHistory: recentSpecs
    };
  }

  /**
   * Helper to convert RollupBucket map into sorted MetricHistoryPoint array.
   */
  private convertRollupsToPoints(map: Map<number, RollupBucket>, cutoff: number): MetricHistoryPoint[] {
    const points: MetricHistoryPoint[] = [];
    for (const b of map.values()) {
      if (b.timestamp < cutoff) continue;

      const cpuSamples = b.cpuUsageSampleCount !== undefined
        ? b.cpuUsageSampleCount
        : (b.cpuUsageSum > 0 ? b.sampleCount : 0);
      const memSamples = b.memoryUsageSampleCount !== undefined
        ? b.memoryUsageSampleCount
        : (b.memoryUsageSum > 0 ? b.sampleCount : 0);

      const cpuAvg = cpuSamples > 0 ? Math.round(b.cpuUsageSum / cpuSamples) : undefined;
      const memAvg = memSamples > 0 ? Math.round(b.memoryUsageSum / memSamples) : undefined;

      const cpuUsagePct = cpuAvg !== undefined && b.cpuCapacityMillicores > 0
        ? Math.round((cpuAvg / b.cpuCapacityMillicores) * 100)
        : undefined;

      const memUsagePct = memAvg !== undefined && b.memoryCapacityBytes > 0
        ? Math.round((memAvg / b.memoryCapacityBytes) * 100)
        : undefined;

      const hasUsage = cpuSamples > 0 || memSamples > 0;

      points.push({
        timestamp: b.timestamp,
        resolution: b.resolution,
        sampleCount: b.sampleCount,
        cpuCapacityMillicores: b.cpuCapacityMillicores,
        cpuRequestMillicores: b.cpuRequestMillicores,
        cpuRequestedPercent: b.cpuRequestedPercent,
        cpuLimitPercent: b.cpuLimitPercent,
        cpuUsageMillicores: b.cpuUsageLatest ?? cpuAvg,
        cpuUsageMinMillicores: b.cpuUsageMin,
        cpuUsageMaxMillicores: b.cpuUsageMax,
        cpuUsageAvgMillicores: cpuAvg,
        cpuUsagePercent: cpuUsagePct,
        memoryCapacityBytes: b.memoryCapacityBytes,
        memoryRequestBytes: b.memoryRequestBytes,
        memoryRequestedPercent: b.memoryRequestedPercent,
        memoryLimitPercent: b.memoryLimitPercent,
        memoryUsageBytes: b.memoryUsageLatest ?? memAvg,
        memoryUsageMinBytes: b.memoryUsageMin,
        memoryUsageMaxBytes: b.memoryUsageMax,
        memoryUsageAvgBytes: memAvg,
        memoryUsagePercent: memUsagePct,
        isUsageAvailable: hasUsage || b.isUsageAvailable,
        source: hasUsage ? (b.source || 'metrics.k8s.io') : 'spec-derived',
        incidentId: b.incidentId
      });
    }
    return points;
  }

  /**
   * Backwards compatible helper: returns raw/recent points directly.
   */
  public getRawPoints(clusterId: string, range: string = '1h', now = Date.now()): MetricHistoryPoint[] {
    const bucket = this.clusters.get(clusterId);
    if (!bucket || bucket.rawPoints.length === 0) return [];

    let windowMs = 60 * 60 * 1000;
    if (range === '15m') windowMs = 15 * 60 * 1000;
    else if (range === '1h') windowMs = 60 * 60 * 1000;
    else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
    else if (range === '24h') windowMs = 24 * 60 * 60 * 1000;
    else if (range === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;

    const cutoff = now - windowMs;
    const inWindow = bucket.rawPoints.filter((p) => p && p.timestamp >= cutoff);
    if (inWindow.length > 0) return inWindow;

    // If unaggregated raw points are older than 2h but range is 6h/24h/7d, provide converted rollups
    const rollups = bucket.rollups5m.size > 0 ? bucket.rollups5m : bucket.rollups1h;
    return this.convertRollupsToPoints(rollups, cutoff);
  }

  /**
   * Returns 5m rollup points for a specific cluster and range.
   */
  public get5mRollups(clusterId: string, range: string = '1h', now = Date.now()): MetricHistoryPoint[] {
    const bucket = this.clusters.get(clusterId);
    if (!bucket) return [];
    let windowMs = 60 * 60 * 1000;
    if (range === '15m') windowMs = 15 * 60 * 1000;
    else if (range === '1h') windowMs = 60 * 60 * 1000;
    else if (range === '6h') windowMs = 6 * 60 * 60 * 1000;
    else if (range === '24h') windowMs = 24 * 60 * 60 * 1000;
    else if (range === '7d') windowMs = 7 * 24 * 60 * 60 * 1000;

    const cutoff = now - windowMs;
    return this.convertRollupsToPoints(bucket.rollups5m, cutoff);
  }

  /**
   * Pin incident telemetry window so that raw evidence is never deleted by retention prune.
   */
  public pinIncidentWindow(clusterId: string, incidentId: string, startedAt: number, resolvedAt?: number): void {
    const bucket = this.clusters.get(clusterId);
    if (!bucket) return;

    const windowStart = startedAt - 15 * 60 * 1000;
    const windowEnd = (resolvedAt || Date.now()) + 15 * 60 * 1000;

    for (const point of bucket.rawPoints) {
      if (point.timestamp >= windowStart && point.timestamp <= windowEnd) {
        point.pinned = true;
        point.incidentId = incidentId;
      }
    }
  }

  /**
   * Calculates dynamic resource baseline for Phase 2 intelligence.
   */
  public calculateBaseline(clusterId: string, range = '24h', now = Date.now()): ResourceBaseline | null {
    const bucket = this.clusters.get(clusterId);
    if (!bucket) return null;

    // Prefer granular raw observations if available in window, otherwise fallback to rollups
    const rawPoints = this.getRawPoints(clusterId, range, now).filter((p) => p.isUsageAvailable);
    const query = this.getTelemetryHistory(clusterId, { range: range as any, resolution: '5m' }, now);
    const rollupPoints = query.points.filter((p) => p.isUsageAvailable);
    const validPoints = rawPoints.length > 0 ? rawPoints : rollupPoints;
    if (validPoints.length === 0) return null;

    const cpuPercents = validPoints.map((p) => p.cpuUsagePercent).filter((v): v is number => v !== undefined);
    const memPercents = validPoints.map((p) => p.memoryUsagePercent).filter((v): v is number => v !== undefined);

    const calcStats = (vals: number[]) => {
      if (vals.length === 0) return {};
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const sorted = [...vals].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? max;
      const variance = vals.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / vals.length;
      const stdDev = Math.round(Math.sqrt(variance));
      const normalMin = Math.max(0, avg - 2 * stdDev);
      const normalMax = Math.min(100, avg + 2 * stdDev);
      return {
        avgPercent: avg,
        expectedPercent: avg,
        minPercent: min,
        maxPercent: max,
        p95Percent: p95,
        stdDevPercent: stdDev,
        normalRange: [normalMin, normalMax] as [number, number]
      };
    };

    const sampleSize = validPoints.length;
    const isSufficient = sampleSize >= 10;
    const isHighConfidence = sampleSize >= 30;

    return {
      clusterId,
      calculatedAt: now,
      windowRange: range,
      sampleSize,
      status: isSufficient ? 'AVAILABLE' : 'INSUFFICIENT_EVIDENCE',
      quality: isHighConfidence ? 'HIGH' : isSufficient ? 'MEDIUM' : 'INSUFFICIENT_HISTORY',
      confidence: isHighConfidence ? 'HIGH' : isSufficient ? 'MEDIUM' : 'LOW',
      explanation: isSufficient
        ? `Baseline calculated from ${sampleSize} historical observations across ${range}.`
        : `Baseline has limited confidence: only ${sampleSize} observation${sampleSize === 1 ? '' : 's'} exist in window. At least 10 observations required for full statistical baseline.`,
      cpu: calcStats(cpuPercents),
      memory: calcStats(memPercents)
    };
  }

  /**
   * Detects real telemetry anomalies without synthetic noise.
   */
  public detectAnomalies(clusterId: string, now = Date.now(), resources?: any[]): TelemetryAnomaly[] {
    const anomalies: TelemetryAnomaly[] = [];
    const bucket = this.clusters.get(clusterId);
    if (!bucket || bucket.rawPoints.length === 0) return anomalies;

    const recent = bucket.rawPoints.slice(-10);
    const latest = recent[recent.length - 1];

    if (!latest) return anomalies;

    // Helper for unique anomaly IDs
    let anomIdx = 0;
    const nextId = (prefix: string) => `ANOM-${clusterId}-${prefix}-${now}-${++anomIdx}`;

    // Check freshness: if cluster agent sent nothing for 5+ min
    if (now - latest.timestamp > 5 * 60 * 1000) {
      const staleMins = Math.round((now - latest.timestamp) / 60000);
      anomalies.push({
        id: nextId('STALE'),
        type: 'STALE_METRICS',
        status: 'ANOMALOUS',
        severity: 'WARNING',
        message: `Telemetry collection has stalled: last observation was ${staleMins}m ago.`,
        detectedAt: now,
        metric: 'all',
        currentValue: now - latest.timestamp,
        observedValue: `${staleMins}m without telemetry`,
        expectedValue: 'Observations every <= 15s',
        deviationReason: 'Agent connection silent or disrupted beyond 5m threshold',
        timeWindow: '5m',
        source: 'kubelet',
        confidence: 0.95,
        evidenceReferences: [`cluster.${clusterId}.lastObservationTime`],
        resource: { kind: 'Cluster', name: clusterId }
      });
    }

    // Check spec overcommitment (requests > 100% of allocatable)
    if (latest.cpuRequestedPercent !== undefined && latest.cpuRequestedPercent > 100) {
      anomalies.push({
        id: nextId('CPU_OVERCOMMIT'),
        type: 'SPEC_OVERCOMMITMENT',
        status: 'ANOMALOUS',
        severity: 'WARNING',
        message: `CPU requests (${latest.cpuRequestedPercent}%) exceed total cluster allocatable capacity.`,
        detectedAt: now,
        metric: 'cpu',
        currentValue: latest.cpuRequestedPercent,
        observedValue: `${latest.cpuRequestedPercent}%`,
        expectedValue: '<= 100%',
        threshold: 100,
        deviationReason: `CPU requested capacity exceeds 100% allocatable by ${latest.cpuRequestedPercent - 100}%`,
        timeWindow: '15m',
        source: 'spec-derived',
        confidence: 0.98,
        evidenceReferences: [`cluster.${clusterId}.cpuRequestedPercent`],
        resource: { kind: 'Cluster', name: clusterId }
      });
    }

    if (latest.memoryRequestedPercent !== undefined && latest.memoryRequestedPercent > 100) {
      anomalies.push({
        id: nextId('MEM_OVERCOMMIT'),
        type: 'SPEC_OVERCOMMITMENT',
        status: 'ANOMALOUS',
        severity: 'WARNING',
        message: `Memory requests (${latest.memoryRequestedPercent}%) exceed total cluster allocatable capacity.`,
        detectedAt: now,
        metric: 'memory',
        currentValue: latest.memoryRequestedPercent,
        observedValue: `${latest.memoryRequestedPercent}%`,
        expectedValue: '<= 100%',
        threshold: 100,
        deviationReason: `Memory requested capacity exceeds 100% allocatable by ${latest.memoryRequestedPercent - 100}%`,
        timeWindow: '15m',
        source: 'spec-derived',
        confidence: 0.98,
        evidenceReferences: [`cluster.${clusterId}.memoryRequestedPercent`],
        resource: { kind: 'Cluster', name: clusterId }
      });
    }

    // Calculate baseline intelligence for historical comparison
    const baseline = this.calculateBaseline(clusterId, '24h', now);
    const hasSufficientBaseline = baseline !== null && baseline.status === 'AVAILABLE' && baseline.sampleSize >= 10;

    // Check runtime CPU: compare against historical baseline and detect meaningful or sustained deviation
    if (latest.isUsageAvailable && latest.cpuUsagePercent !== undefined) {
      if (hasSufficientBaseline && baseline.cpu.avgPercent !== undefined && baseline.cpu.normalRange) {
        const normalUpper = baseline.cpu.normalRange[1];
        const avg = baseline.cpu.avgPercent;
        const stdDev = baseline.cpu.stdDevPercent ?? 0;

        // Detect meaningful deviation exceeding 2 standard deviations from baseline average
        if (latest.cpuUsagePercent > normalUpper && latest.cpuUsagePercent >= avg + 15) {
          // Check for sustained deviation across recent observations
          const recentUsagePoints = recent.filter((p) => p.isUsageAvailable && p.cpuUsagePercent !== undefined);
          const sustainedPoints = recentUsagePoints.filter((p) => p.cpuUsagePercent! > normalUpper);
          const sustainedCount = sustainedPoints.length;
          const isSustained = sustainedCount >= 3;
          const deviation = latest.cpuUsagePercent - avg;

          anomalies.push({
            id: nextId('CPU_BASELINE_DEVIATION'),
            type: 'CPU_SPIKE',
            status: 'ANOMALOUS',
            severity: latest.cpuUsagePercent >= 85 || isSustained ? 'CRITICAL' : 'WARNING',
            message: `Cluster CPU runtime utilization (${latest.cpuUsagePercent}%) significantly exceeds historical baseline of ${avg}%${isSustained ? ` (sustained across ${sustainedCount} observations)` : ''}.`,
            detectedAt: now,
            metric: 'cpu',
            currentValue: latest.cpuUsagePercent,
            observedValue: `${latest.cpuUsagePercent}%${isSustained ? ` (sustained ${sustainedCount}x)` : ''}`,
            expectedValue: `${avg}% (baseline normal range: ${baseline.cpu.normalRange[0]}% - ${baseline.cpu.normalRange[1]}%)`,
            threshold: normalUpper,
            deviationReason: `Current CPU (${latest.cpuUsagePercent}%) exceeds baseline upper bound (${normalUpper}%, avg ${avg}% ± ${stdDev}%) by +${deviation}%`,
            timeWindow: '24h',
            source: 'metrics.k8s.io',
            confidence: baseline.confidence === 'HIGH' ? 0.95 : 0.85,
            evidenceReferences: [
              `cluster.${clusterId}.cpuUsagePercent`,
              `cluster.${clusterId}.baseline.cpu.avgPercent`,
              `cluster.${clusterId}.baseline.cpu.normalRange`
            ],
            resource: { kind: 'Cluster', name: clusterId }
          });
        }
      }

      // Preserve deterministic static safety threshold
      if (latest.cpuUsagePercent >= 90) {
        anomalies.push({
          id: nextId('CPU_SATURATION'),
          type: 'NEAR_SATURATION',
          status: 'ANOMALOUS',
          severity: 'CRITICAL',
          message: `Cluster CPU runtime utilization reached critical level (${latest.cpuUsagePercent}%).`,
          detectedAt: now,
          metric: 'cpu',
          currentValue: latest.cpuUsagePercent,
          observedValue: `${latest.cpuUsagePercent}%`,
          expectedValue: '< 90%',
          threshold: 90,
          deviationReason: hasSufficientBaseline
            ? `CPU runtime utilization reached critical threshold (>= 90%) [Baseline avg: ${baseline?.cpu.avgPercent}%]`
            : 'CPU runtime utilization reached critical threshold (>= 90%) [Baseline: INSUFFICIENT_HISTORY]',
          timeWindow: '15m',
          source: 'metrics.k8s.io',
          confidence: 0.95,
          evidenceReferences: [`cluster.${clusterId}.cpuUsagePercent`],
          resource: { kind: 'Cluster', name: clusterId }
        });
      }
    }

    // Check runtime Memory: compare against historical baseline and detect meaningful or sustained deviation
    if (latest.isUsageAvailable && latest.memoryUsagePercent !== undefined) {
      if (hasSufficientBaseline && baseline.memory.avgPercent !== undefined && baseline.memory.normalRange) {
        const normalUpper = baseline.memory.normalRange[1];
        const avg = baseline.memory.avgPercent;
        const stdDev = baseline.memory.stdDevPercent ?? 0;

        if (latest.memoryUsagePercent > normalUpper && latest.memoryUsagePercent >= avg + 15) {
          const recentUsagePoints = recent.filter((p) => p.isUsageAvailable && p.memoryUsagePercent !== undefined);
          const sustainedPoints = recentUsagePoints.filter((p) => p.memoryUsagePercent! > normalUpper);
          const sustainedCount = sustainedPoints.length;
          const isSustained = sustainedCount >= 3;
          const deviation = latest.memoryUsagePercent - avg;

          anomalies.push({
            id: nextId('MEM_BASELINE_DEVIATION'),
            type: 'NEAR_SATURATION',
            status: 'ANOMALOUS',
            severity: latest.memoryUsagePercent >= 85 || isSustained ? 'CRITICAL' : 'WARNING',
            message: `Cluster memory utilization (${latest.memoryUsagePercent}%) significantly exceeds historical baseline of ${avg}%${isSustained ? ` (sustained across ${sustainedCount} observations)` : ''}.`,
            detectedAt: now,
            metric: 'memory',
            currentValue: latest.memoryUsagePercent,
            observedValue: `${latest.memoryUsagePercent}%${isSustained ? ` (sustained ${sustainedCount}x)` : ''}`,
            expectedValue: `${avg}% (baseline normal range: ${baseline.memory.normalRange[0]}% - ${baseline.memory.normalRange[1]}%)`,
            threshold: normalUpper,
            deviationReason: `Current memory (${latest.memoryUsagePercent}%) exceeds baseline upper bound (${normalUpper}%, avg ${avg}% ± ${stdDev}%) by +${deviation}%`,
            timeWindow: '24h',
            source: 'metrics.k8s.io',
            confidence: baseline.confidence === 'HIGH' ? 0.95 : 0.85,
            evidenceReferences: [
              `cluster.${clusterId}.memoryUsagePercent`,
              `cluster.${clusterId}.baseline.memory.avgPercent`,
              `cluster.${clusterId}.baseline.memory.normalRange`
            ],
            resource: { kind: 'Cluster', name: clusterId }
          });
        }
      }

      // Preserve deterministic static safety threshold
      if (latest.memoryUsagePercent >= 90) {
        anomalies.push({
          id: nextId('MEM_SATURATION'),
          type: 'NEAR_SATURATION',
          status: 'ANOMALOUS',
          severity: 'CRITICAL',
          message: `Cluster memory runtime utilization reached critical level (${latest.memoryUsagePercent}%).`,
          detectedAt: now,
          metric: 'memory',
          currentValue: latest.memoryUsagePercent,
          observedValue: `${latest.memoryUsagePercent}%`,
          expectedValue: '< 90%',
          threshold: 90,
          deviationReason: hasSufficientBaseline
            ? `Memory runtime utilization reached critical threshold (>= 90%) [Baseline avg: ${baseline?.memory.avgPercent}%]`
            : 'Memory runtime utilization reached critical threshold (>= 90%) [Baseline: INSUFFICIENT_HISTORY]',
          timeWindow: '15m',
          source: 'metrics.k8s.io',
          confidence: 0.95,
          evidenceReferences: [`cluster.${clusterId}.memoryUsagePercent`],
          resource: { kind: 'Cluster', name: clusterId }
        });
      }
    }

    // Check steady memory climb across recent observations (Memory leak indicator)
    if (recent.length >= 5) {
      const memUsages = recent
        .map((p) => p.memoryUsagePercent)
        .filter((v): v is number => v !== undefined);

      if (memUsages.length >= 5) {
        let isStrictlyClimbing = true;
        for (let i = 1; i < memUsages.length; i++) {
          if (memUsages[i] < memUsages[i - 1]) {
            isStrictlyClimbing = false;
            break;
          }
        }
        if (isStrictlyClimbing && memUsages[memUsages.length - 1] - memUsages[0] >= 15) {
          anomalies.push({
            id: nextId('MEM_LEAK_TREND'),
            type: 'MEMORY_LEAK_TREND',
            status: 'ANOMALOUS',
            severity: 'WARNING',
            message: `Continuous memory growth detected: climbed from ${memUsages[0]}% to ${memUsages[memUsages.length - 1]}% across recent scrapes.`,
            detectedAt: now,
            metric: 'memory',
            currentValue: memUsages[memUsages.length - 1],
            observedValue: `+${memUsages[memUsages.length - 1] - memUsages[0]}% net climb`,
            expectedValue: 'Stable or fluctuating memory usage',
            deviationReason: 'Strict upward trajectory across 5+ consecutive scrapes',
            timeWindow: '15m',
            source: 'metrics.k8s.io',
            confidence: 0.9,
            evidenceReferences: [`cluster.${clusterId}.memoryUsageTrend`],
            resource: { kind: 'Cluster', name: clusterId }
          });
        }
      }
    }

    // Workload & Node conditions anomalies if resources are provided
    if (Array.isArray(resources) && resources.length > 0) {
      for (const res of resources) {
        // 1. Restart Acceleration
        if (res.kind === 'Pod' && Array.isArray(res.containers)) {
          for (const c of res.containers) {
            if (c.restartCount !== undefined && c.restartCount >= 4) {
              anomalies.push({
                id: nextId(`RESTART_${res.name}`),
                type: 'RESTART_ACCELERATION',
                status: 'ANOMALOUS',
                severity: c.restartCount >= 10 ? 'CRITICAL' : 'WARNING',
                message: `Pod ${res.name} (container ${c.name}) has restarted ${c.restartCount} times.`,
                detectedAt: now,
                metric: 'restarts',
                currentValue: c.restartCount,
                observedValue: `${c.restartCount} restarts`,
                expectedValue: '0 restarts',
                threshold: 4,
                deviationReason: `Container ${c.name} is repeatedly failing/crashing`,
                timeWindow: '1h',
                source: 'kubelet',
                confidence: 0.95,
                evidenceReferences: [`pod.${res.name}.containers.${c.name}.restartCount`],
                resource: { kind: 'Pod', name: res.name, namespace: res.namespace }
              });
            }
          }
        }

        // 2. Node Pressure
        if (res.kind === 'Node' && Array.isArray(res.conditions)) {
          for (const cond of res.conditions) {
            if (['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(cond.type) && cond.status === 'True') {
              anomalies.push({
                id: nextId(`NODE_PRESSURE_${res.name}`),
                type: 'NODE_PRESSURE',
                status: 'ANOMALOUS',
                severity: 'CRITICAL',
                message: `Node ${res.name} has active ${cond.type}: ${cond.message || cond.reason || 'condition True'}`,
                detectedAt: now,
                metric: 'nodes',
                observedValue: `${cond.type}=True`,
                expectedValue: `${cond.type}=False`,
                deviationReason: cond.message || cond.reason || `Node reporting ${cond.type}`,
                timeWindow: '5m',
                source: 'kubelet',
                confidence: 0.99,
                evidenceReferences: [`node.${res.name}.conditions.${cond.type}`],
                resource: { kind: 'Node', name: res.name }
              });
            } else if (cond.type === 'Ready' && cond.status !== 'True') {
              anomalies.push({
                id: nextId(`NODE_NOT_READY_${res.name}`),
                type: 'NODE_PRESSURE',
                status: 'ANOMALOUS',
                severity: 'CRITICAL',
                message: `Node ${res.name} is NotReady: ${cond.message || cond.reason || 'Kubelet unready'}`,
                detectedAt: now,
                metric: 'nodes',
                observedValue: 'Ready=False',
                expectedValue: 'Ready=True',
                deviationReason: cond.message || cond.reason || 'Kubelet not ready',
                timeWindow: '5m',
                source: 'kubelet',
                confidence: 0.99,
                evidenceReferences: [`node.${res.name}.conditions.Ready`],
                resource: { kind: 'Node', name: res.name }
              });
            }
          }
        }

        // 3. Workload Degradation
        if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(res.kind)) {
          const desired = res.specSummary?.replicas ?? res.statusSummary?.desiredNumberScheduled ?? 0;
          const available = res.statusSummary?.availableReplicas ?? res.statusSummary?.numberReady ?? 0;
          if (desired > 0 && available === 0) {
            anomalies.push({
              id: nextId(`DEGRADED_${res.name}`),
              type: 'WORKLOAD_DEGRADATION',
              status: 'ANOMALOUS',
              severity: 'CRITICAL',
              message: `${res.kind} ${res.name} has 0/${desired} ready replicas.`,
              detectedAt: now,
              metric: 'all',
              observedValue: `0/${desired} ready`,
              expectedValue: `${desired}/${desired} ready`,
              deviationReason: 'Total availability loss for controller replicas',
              timeWindow: '5m',
              source: 'spec-derived',
              confidence: 0.95,
              evidenceReferences: [`workload.${res.name}.readyReplicas`],
              resource: { kind: res.kind, name: res.name, namespace: res.namespace }
            });
          }
        }
      }
    }

    return anomalies;
  }

  /**
   * Serializes all cluster telemetry data for persistent store snapshotting.
   */
  public exportSnapshot(): Record<string, any> {
    const data: Record<string, any> = {};
    for (const [clusterId, bucket] of this.clusters.entries()) {
      data[clusterId] = {
        clusterId,
        rawPoints: bucket.rawPoints,
        rollups5m: Array.from(bucket.rollups5m.entries()),
        rollups1h: Array.from(bucket.rollups1h.entries()),
        specHistory: bucket.specHistory,
        lastSpecSignature: bucket.lastSpecSignature
      };
    }
    return data;
  }

  /**
   * Restores telemetry data from snapshot.
   */
  public importSnapshot(data: Record<string, any>): void {
    if (!data || typeof data !== 'object') return;
    this.clusters.clear();

    for (const [clusterId, rawBucket] of Object.entries(data)) {
      if (!rawBucket) continue;
      const roll5m = new Map<number, RollupBucket>();
      if (Array.isArray(rawBucket.rollups5m)) {
        for (const [k, v] of rawBucket.rollups5m) {
          if (typeof k === 'number' && v) {
            if (v.cpuUsageSampleCount === undefined) {
              v.cpuUsageSampleCount = v.cpuUsageSum > 0 ? v.sampleCount : 0;
            }
            if (v.memoryUsageSampleCount === undefined) {
              v.memoryUsageSampleCount = v.memoryUsageSum > 0 ? v.sampleCount : 0;
            }
            roll5m.set(k, v);
          }
        }
      }
      const roll1h = new Map<number, RollupBucket>();
      if (Array.isArray(rawBucket.rollups1h)) {
        for (const [k, v] of rawBucket.rollups1h) {
          if (typeof k === 'number' && v) {
            if (v.cpuUsageSampleCount === undefined) {
              v.cpuUsageSampleCount = v.cpuUsageSum > 0 ? v.sampleCount : 0;
            }
            if (v.memoryUsageSampleCount === undefined) {
              v.memoryUsageSampleCount = v.memoryUsageSum > 0 ? v.sampleCount : 0;
            }
            roll1h.set(k, v);
          }
        }
      }

      this.clusters.set(clusterId, {
        clusterId,
        rawPoints: Array.isArray(rawBucket.rawPoints) ? rawBucket.rawPoints : [],
        rollups5m: roll5m,
        rollups1h: roll1h,
        specHistory: Array.isArray(rawBucket.specHistory) ? rawBucket.specHistory : [],
        lastSpecSignature: rawBucket.lastSpecSignature
      });
    }
  }
}

function countMemMemSafe(sum: number, count: number): number | undefined {
  if (count <= 0) return undefined;
  return Math.round(sum / count);
}
