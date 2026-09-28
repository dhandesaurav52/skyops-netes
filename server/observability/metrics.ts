export interface SystemMetricsSnapshot {
  uptimeSeconds: number;
  memoryUsageMb: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  http: {
    totalRequests: number;
    status2xx: number;
    status4xx: number;
    status5xx: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  };
  telemetry: {
    batchesIngested: number;
    resourcesIngested: number;
    lastIngestionTimestamp: number | null;
  };
  ai: {
    requestsTotal: number;
    requestsSucceeded: number;
    requestsFailed: number;
    circuitBreakerTripped: boolean;
  };
  jobs: {
    queueDepth: number;
    jobsProcessed: number;
    jobsFailed: number;
  };
}

export interface SystemHealthStatus {
  status: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  liveness: boolean;
  readiness: boolean;
  checks: {
    store: boolean;
    storage: boolean;
    config: boolean;
    aiService: 'READY' | 'CIRCUIT_OPEN' | 'UNCONFIGURED';
  };
  timestamp: number;
}

class SystemObservabilityCollector {
  private startTime = Date.now();
  private totalRequests = 0;
  private status2xx = 0;
  private status4xx = 0;
  private status5xx = 0;
  private recentLatencies: number[] = [];
  private readonly maxLatencySamples = 500;

  private telemetryBatches = 0;
  private telemetryResources = 0;
  private lastTelemetryTs: number | null = null;

  private aiRequests = 0;
  private aiSuccesses = 0;
  private aiFailures = 0;
  private aiCircuitOpen = false;

  private jobsDepth = 0;
  private jobsProcessed = 0;
  private jobsFailed = 0;

  public recordRequest(statusCode: number, latencyMs: number): void {
    this.totalRequests++;
    if (statusCode >= 200 && statusCode < 300) this.status2xx++;
    else if (statusCode >= 400 && statusCode < 500) this.status4xx++;
    else if (statusCode >= 500) this.status5xx++;

    this.recentLatencies.push(latencyMs);
    if (this.recentLatencies.length > this.maxLatencySamples) {
      this.recentLatencies.shift();
    }
  }

  public recordTelemetry(resourceCount: number): void {
    this.telemetryBatches++;
    this.telemetryResources += resourceCount;
    this.lastTelemetryTs = Date.now();
  }

  public recordAIRequest(success: boolean, circuitOpen = false): void {
    this.aiRequests++;
    if (success) this.aiSuccesses++;
    else this.aiFailures++;
    this.aiCircuitOpen = circuitOpen;
  }

  public updateJobQueue(depth: number, processedDelta = 0, failedDelta = 0): void {
    this.jobsDepth = depth;
    this.jobsProcessed += processedDelta;
    this.jobsFailed += failedDelta;
  }

  public getSnapshot(): SystemMetricsSnapshot {
    const mem = process.memoryUsage();
    const sortedLatencies = [...this.recentLatencies].sort((a, b) => a - b);
    const avgLatency =
      sortedLatencies.length > 0
        ? Math.round(sortedLatencies.reduce((sum, v) => sum + v, 0) / sortedLatencies.length)
        : 0;
    const p95Idx = Math.floor(sortedLatencies.length * 0.95);
    const p95Latency = sortedLatencies.length > 0 ? sortedLatencies[p95Idx] : 0;

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      memoryUsageMb: {
        rss: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
        heapTotal: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
        heapUsed: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10
      },
      http: {
        totalRequests: this.totalRequests,
        status2xx: this.status2xx,
        status4xx: this.status4xx,
        status5xx: this.status5xx,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency
      },
      telemetry: {
        batchesIngested: this.telemetryBatches,
        resourcesIngested: this.telemetryResources,
        lastIngestionTimestamp: this.lastTelemetryTs
      },
      ai: {
        requestsTotal: this.aiRequests,
        requestsSucceeded: this.aiSuccesses,
        requestsFailed: this.aiFailures,
        circuitBreakerTripped: this.aiCircuitOpen
      },
      jobs: {
        queueDepth: this.jobsDepth,
        jobsProcessed: this.jobsProcessed,
        jobsFailed: this.jobsFailed
      }
    };
  }

  public getHealth(storeReady = true): SystemHealthStatus {
    const mem = process.memoryUsage();
    const isMemoryOk = mem.heapUsed < 1.5 * 1024 * 1024 * 1024; // under 1.5 GB
    const isErrorRateLow = this.totalRequests > 0 ? this.status5xx / this.totalRequests < 0.15 : true;

    const readiness = storeReady && isMemoryOk;
    const liveness = isMemoryOk;

    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' = 'HEALTHY';
    if (!readiness) overallStatus = 'UNHEALTHY';
    else if (!isErrorRateLow || this.aiCircuitOpen) overallStatus = 'DEGRADED';

    return {
      status: overallStatus,
      liveness,
      readiness,
      checks: {
        store: storeReady,
        storage: true,
        config: true,
        aiService: this.aiCircuitOpen ? 'CIRCUIT_OPEN' : process.env.GEMINI_API_KEY ? 'READY' : 'UNCONFIGURED'
      },
      timestamp: Date.now()
    };
  }
}

export const systemObservability = new SystemObservabilityCollector();
