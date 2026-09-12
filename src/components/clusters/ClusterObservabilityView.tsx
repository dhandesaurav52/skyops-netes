import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  HardDrive,
  Info,
  RefreshCw,
  Server,
  TrendingUp,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import {
  ClusterObservabilityMetrics,
  KubernetesResource,
  MetricHistoryPoint,
  NodeMetricsSummary,
  WorkloadMetricsSummary
} from '../../types/index';
import { Button } from '../common/UI';
import { ErrorBoundary } from '../common/ErrorBoundary';

interface ClusterObservabilityViewProps {
  clusterId: string;
  clusterName: string;
  resources?: KubernetesResource[];
  onSelectResource?: (resource: KubernetesResource) => void;
}

const ClusterObservabilityContent: React.FC<ClusterObservabilityViewProps> = ({
  clusterId,
  clusterName,
  resources = [],
  onSelectResource
}) => {
  const [metrics, setMetrics] = useState<ClusterObservabilityMetrics | null>(null);
  const [nodeSummaries, setNodeSummaries] = useState<NodeMetricsSummary[]>([]);
  const [workloadSummaries, setWorkloadSummaries] = useState<WorkloadMetricsSummary[]>([]);
  const [history, setHistory] = useState<MetricHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'cluster' | 'nodes' | 'workloads' | 'history'>('cluster');
  const [workloadFilter, setWorkloadFilter] = useState<'all' | 'no-limits' | 'near-limit' | 'missing-usage'>('all');
  const [searchFilter, setSearchFilter] = useState('');

  const loadData = async (background = false) => {
    try {
      if (!background) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const [mRes, nRes, wRes, hRes] = await Promise.all([
        api.getClusterMetrics(clusterId).catch((err) => {
          console.warn('api.getClusterMetrics failed:', err);
          return null;
        }),
        api.getNodeMetrics(clusterId).catch((err) => {
          console.warn('api.getNodeMetrics failed:', err);
          return [];
        }),
        api.getWorkloadMetrics(clusterId).catch((err) => {
          console.warn('api.getWorkloadMetrics failed:', err);
          return [];
        }),
        api.getClusterMetricHistory(clusterId).catch((err) => {
          console.warn('api.getClusterMetricHistory failed:', err);
          return [];
        })
      ]);

      setMetrics(mRes);
      setNodeSummaries(Array.isArray(nRes) ? nRes : []);
      setWorkloadSummaries(Array.isArray(wRes) ? wRes : []);
      setHistory(Array.isArray(hRes) ? hRes : []);
    } catch (err: any) {
      console.error('Failed to load observability metrics:', err);
      setError(err?.message || 'Failed to fetch cluster observability metrics');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData(false);
    const interval = setInterval(() => loadData(true), 15000);
    return () => clearInterval(interval);
  }, [clusterId]);

  const formatFreshnessTime = (ts?: number) => {
    if (!ts) return 'Unknown';
    const elapsedSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (elapsedSec < 5) return 'Just now';
    if (elapsedSec < 60) return `${elapsedSec}s ago`;
    const elapsedMin = Math.floor(elapsedSec / 60);
    if (elapsedMin < 60) return `${elapsedMin}m ago`;
    return `${Math.floor(elapsedMin / 60)}h ago`;
  };

  const getCommitmentColor = (ratio?: number) => {
    if (ratio === undefined || ratio === null) return 'bg-zinc-700 text-zinc-300';
    if (ratio > 100) return 'bg-rose-500 text-white';
    if (ratio > 85) return 'bg-amber-500 text-white';
    return 'bg-sky-500 text-white';
  };

  const getFreshnessBadge = (observedAt?: number) => {
    if (!observedAt) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
          Freshness: Unknown
        </span>
      );
    }
    const ageMs = Date.now() - observedAt;
    if (ageMs < 60000) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Fresh ({formatFreshnessTime(observedAt)})
        </span>
      );
    }
    if (ageMs < 300000) {
      return (
        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-amber-950/70 text-amber-300 border border-amber-800/80 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          Stale ({formatFreshnessTime(observedAt)})
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-rose-950/70 text-rose-300 border border-rose-800/80 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
        Expired ({formatFreshnessTime(observedAt)})
      </span>
    );
  };

  // Safe Metric Derivations
  const cpuReqPercent =
    metrics?.commitmentRatios?.cpuRequestedPercent ??
    (metrics?.cpu?.allocatable?.value && metrics?.cpu?.request?.value
      ? Math.round((metrics.cpu.request.value / metrics.cpu.allocatable.value) * 100)
      : 0);

  const cpuLimitPercent =
    metrics?.commitmentRatios?.cpuLimitPercent ??
    (metrics?.cpu?.allocatable?.value && metrics?.cpu?.limit?.value
      ? Math.round((metrics.cpu.limit.value / metrics.cpu.allocatable.value) * 100)
      : 0);

  const cpuUsagePercent =
    metrics?.commitmentRatios?.cpuUsagePercent ??
    metrics?.cpu?.utilizationPercent;

  const memReqPercent =
    metrics?.commitmentRatios?.memoryRequestedPercent ??
    (metrics?.memory?.allocatable?.value && metrics?.memory?.request?.value
      ? Math.round((metrics.memory.request.value / metrics.memory.allocatable.value) * 100)
      : 0);

  const memLimitPercent =
    metrics?.commitmentRatios?.memoryLimitPercent ??
    (metrics?.memory?.allocatable?.value && metrics?.memory?.limit?.value
      ? Math.round((metrics.memory.limit.value / metrics.memory.allocatable.value) * 100)
      : 0);

  const memUsagePercent =
    metrics?.commitmentRatios?.memoryUsagePercent ??
    metrics?.memory?.utilizationPercent;

  const cpuCapacityFormatted = metrics?.cpu?.capacity?.formatted || metrics?.cpu?.totalCapacity?.formatted || '0m';
  const cpuAllocatableFormatted = metrics?.cpu?.allocatable?.formatted || metrics?.cpu?.totalAllocatable?.formatted || '0m';
  const cpuRequestFormatted = metrics?.cpu?.request?.formatted || metrics?.cpu?.totalRequests?.formatted || '0m';
  const cpuLimitFormatted = metrics?.cpu?.limit?.formatted || metrics?.cpu?.totalLimits?.formatted || '0m';
  const cpuUsageFormatted = metrics?.cpu?.usage?.formatted || metrics?.cpu?.totalUsage?.formatted;

  const memCapacityFormatted = metrics?.memory?.capacity?.formatted || metrics?.memory?.totalCapacity?.formatted || '0 Mi';
  const memAllocatableFormatted = metrics?.memory?.allocatable?.formatted || metrics?.memory?.totalAllocatable?.formatted || '0 Mi';
  const memRequestFormatted = metrics?.memory?.request?.formatted || metrics?.memory?.totalRequests?.formatted || '0 Mi';
  const memLimitFormatted = metrics?.memory?.limit?.formatted || metrics?.memory?.totalLimits?.formatted || '0 Mi';
  const memUsageFormatted = metrics?.memory?.usage?.formatted || metrics?.memory?.totalUsage?.formatted;

  const isMetricsServerActive =
    metrics?.metricsSource === 'METRICS_SERVER' ||
    metrics?.source === 'metrics.k8s.io' ||
    metrics?.isUsageAvailable === true;

  if (loading && !metrics) {
    return (
      <div className="p-12 flex flex-col items-center justify-center space-y-4 text-center">
        <RefreshCw className="w-8 h-8 text-sky-400 animate-spin" />
        <div className="text-zinc-300 font-medium">Querying Kubernetes Observability Foundation...</div>
        <p className="text-xs text-zinc-500 max-w-md">
          Retrieving real cluster telemetry, node capacity, scheduled pod allocations, and live Metrics Server measurements.
        </p>
      </div>
    );
  }

  if (error && !metrics) {
    return (
      <div className="p-6 rounded-xl border border-rose-800 bg-rose-950/30 text-rose-200 space-y-3">
        <div className="flex items-center gap-2 font-bold text-base">
          <AlertOctagon className="w-5 h-5 text-rose-400" />
          <span>Observability Telemetry Error</span>
        </div>
        <p className="text-sm font-mono text-rose-300">{error}</p>
        <Button variant="outline" size="sm" onClick={() => loadData(false)}>
          Retry Query
        </Button>
      </div>
    );
  }

  const safeWorkloadSummaries = Array.isArray(workloadSummaries) ? workloadSummaries : [];
  const filteredWorkloads = safeWorkloadSummaries.filter((w) => {
    const wName = (w.name || w.resourceName || '').toLowerCase();
    const wNamespace = (w.namespace || '').toLowerCase();
    const wKind = (w.kind || w.workloadKind || '').toLowerCase();

    if (searchFilter.trim()) {
      const q = searchFilter.toLowerCase();
      const match = wName.includes(q) || wNamespace.includes(q) || wKind.includes(q);
      if (!match) return false;
    }

    const hasNoLimits =
      w.hasPodsWithoutLimits ??
      ((!w.cpu?.limit?.value && !(w as any).totalCpuLimits?.value) ||
        (!w.memory?.limit?.value && !(w as any).totalMemoryLimits?.value));

    const isNearLimit =
      w.isNearMemoryLimit ??
      ((w.memory?.utilizationPercent ?? 0) > 85);

    const usageAvailable =
      w.usageAvailable ??
      w.isUsageAvailable ??
      Boolean(w.cpu?.usage?.value || w.memory?.usage?.value);

    if (workloadFilter === 'no-limits') {
      return hasNoLimits;
    }
    if (workloadFilter === 'near-limit') {
      return isNearLimit;
    }
    if (workloadFilter === 'missing-usage') {
      return !usageAvailable;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Observability Header & Freshness Banner */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-base font-bold text-zinc-100 flex items-center gap-2 font-mono">
              <Activity className="w-4 h-4 text-sky-400" />
              Observability & Resource Metrics
            </h3>
            {metrics && (
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-mono font-semibold border ${
                  isMetricsServerActive
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                    : 'bg-zinc-800 text-amber-300 border-amber-800/60'
                }`}
              >
                {isMetricsServerActive ? 'metrics.k8s.io Active' : 'Kubelet / Pod Spec Declarations'}
              </span>
            )}
            {metrics && getFreshnessBadge(metrics.observedAt)}
          </div>
          <p className="text-xs text-zinc-400">
            {isMetricsServerActive
              ? 'Real-time telemetry sourced directly from the Kubernetes Metrics Server API.'
              : 'Metrics Server is not detected or active on this cluster. Allocatable capacity, requests, and limits are derived directly from Kubelet specifications.'}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="text-right hidden sm:block">
            <div className="text-[10px] font-mono text-zinc-400">
              Observed: <strong className="text-zinc-200">{metrics?.observedAt ? new Date(metrics.observedAt).toLocaleTimeString() : 'N/A'}</strong>
            </div>
            <div className="text-[10px] font-mono text-zinc-500">
              Ingested: <strong className="text-zinc-400">{metrics?.ingestedAt ? new Date(metrics.ingestedAt).toLocaleTimeString() : 'N/A'}</strong>
            </div>
          </div>
          <Button
            id="refresh-observability-btn"
            variant="outline"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-sky-400' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        <button
          onClick={() => setActiveSubTab('cluster')}
          className={`px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors ${
            activeSubTab === 'cluster'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Cluster Resource Allocations
        </button>
        <button
          onClick={() => setActiveSubTab('nodes')}
          className={`px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'nodes'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>Node Telemetry</span>
          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-400">{nodeSummaries.length}</span>
        </button>
        <button
          onClick={() => setActiveSubTab('workloads')}
          className={`px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'workloads'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>Workloads & Pods</span>
          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-400">{workloadSummaries.length}</span>
        </button>
        <button
          onClick={() => setActiveSubTab('history')}
          className={`px-4 py-2 text-xs font-mono font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeSubTab === 'history'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <span>Telemetry Timeline</span>
          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-400">{history.length} pts</span>
        </button>
      </div>

      {/* CLUSTER LEVEL VIEW */}
      {activeSubTab === 'cluster' && metrics && (
        <div className="space-y-6">
          {/* Commitment Ratios Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>CPU Request / Allocatable</span>
                <Cpu className="w-4 h-4 text-sky-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100">
                {cpuReqPercent !== undefined ? `${cpuReqPercent}%` : 'Unavailable'}
              </div>
              <div className="space-y-1">
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${getCommitmentColor(cpuReqPercent)}`}
                    style={{ width: `${Math.min(100, cpuReqPercent || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>Req: {cpuRequestFormatted}</span>
                  <span>Alloc: {cpuAllocatableFormatted}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>Memory Request / Allocatable</span>
                <Database className="w-4 h-4 text-violet-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100">
                {memReqPercent !== undefined ? `${memReqPercent}%` : 'Unavailable'}
              </div>
              <div className="space-y-1">
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${getCommitmentColor(memReqPercent)}`}
                    style={{ width: `${Math.min(100, memReqPercent || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>Req: {memRequestFormatted}</span>
                  <span>Alloc: {memAllocatableFormatted}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>CPU Limit / Allocatable</span>
                <Zap className="w-4 h-4 text-amber-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100 flex items-center gap-2">
                <span>{cpuLimitPercent !== undefined ? `${cpuLimitPercent}%` : 'Unavailable'}</span>
                {cpuLimitPercent > 100 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-400 border border-amber-800">
                    Overcommitted
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${getCommitmentColor(cpuLimitPercent)}`}
                    style={{ width: `${Math.min(100, cpuLimitPercent || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>Limit: {cpuLimitFormatted}</span>
                  <span>Alloc: {cpuAllocatableFormatted}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>Memory Limit / Allocatable</span>
                <HardDrive className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="text-2xl font-bold font-mono text-zinc-100 flex items-center gap-2">
                <span>{memLimitPercent !== undefined ? `${memLimitPercent}%` : 'Unavailable'}</span>
                {memLimitPercent > 100 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800">
                    Risk Overcommit
                  </span>
                )}
              </div>
              <div className="space-y-1">
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${getCommitmentColor(memLimitPercent)}`}
                    style={{ width: `${Math.min(100, memLimitPercent || 0)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500">
                  <span>Limit: {memLimitFormatted}</span>
                  <span>Alloc: {memAllocatableFormatted}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Resource Breakdown Side-by-Side */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CPU Detailed Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <Cpu className="w-5 h-5 text-sky-400" />
                  <h4 className="font-bold text-sm text-zinc-100 font-mono">Cluster CPU Budget</h4>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  Capacity: <strong className="text-zinc-200">{cpuCapacityFormatted}</strong>
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Total Allocatable (Kubelet):</span>
                  <span className="font-bold text-zinc-200">{cpuAllocatableFormatted}</span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Scheduled Pod Requests:</span>
                  <span className="font-bold text-sky-400">
                    {cpuRequestFormatted} ({cpuReqPercent}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Scheduled Pod Limits:</span>
                  <span className="font-bold text-amber-400">
                    {cpuLimitFormatted} ({cpuLimitPercent}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-zinc-800/80">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <span>Live Actual Usage:</span>
                    {metrics.isUsageAvailable && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  </span>
                  {metrics.isUsageAvailable && cpuUsageFormatted ? (
                    <span className="font-bold text-emerald-400 font-mono">
                      {cpuUsageFormatted} ({cpuUsagePercent ?? 0}% allocatable)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px] font-mono border border-zinc-700">
                      Usage Unavailable (No Metrics Server)
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Memory Detailed Card */}
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-violet-400" />
                  <h4 className="font-bold text-sm text-zinc-100 font-mono">Cluster Memory Budget</h4>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  Capacity: <strong className="text-zinc-200">{memCapacityFormatted}</strong>
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Total Allocatable (Kubelet):</span>
                  <span className="font-bold text-zinc-200">{memAllocatableFormatted}</span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Scheduled Pod Requests:</span>
                  <span className="font-bold text-violet-400">
                    {memRequestFormatted} ({memReqPercent}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-zinc-400">Scheduled Pod Limits:</span>
                  <span className="font-bold text-emerald-400">
                    {memLimitFormatted} ({memLimitPercent}%)
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-mono pt-2 border-t border-zinc-800/80">
                  <span className="text-zinc-400 flex items-center gap-1.5">
                    <span>Live Actual Usage:</span>
                    {metrics.isUsageAvailable && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
                  </span>
                  {metrics.isUsageAvailable && memUsageFormatted ? (
                    <span className="font-bold text-emerald-400 font-mono">
                      {memUsageFormatted} ({memUsagePercent ?? 0}% allocatable)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[11px] font-mono border border-zinc-700">
                      Usage Unavailable (No Metrics Server)
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NODE TELEMETRY VIEW */}
      {activeSubTab === 'nodes' && (
        <div className="space-y-4">
          <div className="text-xs font-mono text-zinc-400">
            Evaluating {nodeSummaries.length} nodes for capacity, scheduled allocations, pressure conditions, and actual usage.
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Node</th>
                    <th className="px-4 py-3">State & Pressure</th>
                    <th className="px-4 py-3">CPU (Usage / Alloc / Cap)</th>
                    <th className="px-4 py-3">CPU Requests (Commit)</th>
                    <th className="px-4 py-3">Memory (Usage / Alloc / Cap)</th>
                    <th className="px-4 py-3">Memory Requests (Commit)</th>
                    <th className="px-4 py-3">Pods</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {nodeSummaries.map((node) => {
                    const nodeDisplayName = node.nodeName || node.name || (node as any).resourceName || 'node';
                    
                    // Safely extract condition booleans regardless of array or object shape
                    let hasMemoryPressure = false;
                    let hasDiskPressure = false;
                    let hasPidPressure = false;
                    let isReady = node.ready ?? false;

                    if (Array.isArray(node.conditions)) {
                      hasMemoryPressure = node.conditions.some((c: any) => c.type === 'MemoryPressure' && (c.status === 'True' || c.status === true));
                      hasDiskPressure = node.conditions.some((c: any) => c.type === 'DiskPressure' && (c.status === 'True' || c.status === true));
                      hasPidPressure = node.conditions.some((c: any) => c.type === 'PIDPressure' && (c.status === 'True' || c.status === true));
                      const readyCond = node.conditions.find((c: any) => c.type === 'Ready');
                      if (readyCond) isReady = readyCond.status === 'True' || readyCond.status === true;
                    } else if (node.conditions && typeof node.conditions === 'object') {
                      hasMemoryPressure = Boolean(node.conditions.memoryPressure);
                      hasDiskPressure = Boolean(node.conditions.diskPressure);
                      hasPidPressure = Boolean(node.conditions.pidPressure);
                      if (node.conditions.ready !== undefined) isReady = Boolean(node.conditions.ready);
                    }

                    const nCpuAlloc = node.cpu?.allocatable?.formatted || '0m';
                    const nCpuCap = node.cpu?.capacity?.formatted || '0m';
                    const nCpuReq = node.cpu?.request?.formatted || (node.cpu as any)?.requests?.formatted || '0m';
                    const nCpuUsage = node.cpu?.usage?.formatted;
                    const nCpuReqPct =
                      node.cpu?.requestedPercent ??
                      (node.cpu?.allocatable?.value && (node.cpu?.request?.value || (node.cpu as any)?.requests?.value)
                        ? Math.round(((node.cpu.request?.value || (node.cpu as any).requests.value) / node.cpu.allocatable.value) * 100)
                        : 0);

                    const nMemAlloc = node.memory?.allocatable?.formatted || '0 Mi';
                    const nMemCap = node.memory?.capacity?.formatted || '0 Mi';
                    const nMemReq = node.memory?.request?.formatted || (node.memory as any)?.requests?.formatted || '0 Mi';
                    const nMemUsage = node.memory?.usage?.formatted;
                    const nMemReqPct =
                      node.memory?.requestedPercent ??
                      (node.memory?.allocatable?.value && (node.memory?.request?.value || (node.memory as any)?.requests?.value)
                        ? Math.round(((node.memory.request?.value || (node.memory as any).requests.value) / node.memory.allocatable.value) * 100)
                        : 0);

                    return (
                      <tr key={nodeDisplayName} className="hover:bg-zinc-850/50 transition-colors">
                        <td className="px-4 py-3 font-medium text-zinc-100 flex items-center gap-2">
                          <Server className="w-4 h-4 text-zinc-400" />
                          <span>{nodeDisplayName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isReady
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                  : 'bg-rose-950 text-rose-400 border border-rose-800'
                              }`}
                            >
                              {isReady ? 'Ready' : 'NotReady'}
                            </span>
                            {hasMemoryPressure && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 text-rose-400 border border-rose-800 font-bold">
                                MemPressure
                              </span>
                            )}
                            {hasDiskPressure && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800 font-bold">
                                DiskPressure
                              </span>
                            )}
                            {hasPidPressure && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-950 text-amber-400 border border-amber-800 font-bold">
                                PIDPressure
                              </span>
                            )}
                            {!hasMemoryPressure && !hasDiskPressure && !hasPidPressure && (
                              <span className="text-[10px] text-zinc-500">No Pressure</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            <div className="font-bold text-zinc-200">
                              {nCpuUsage ? (
                                <span className="text-emerald-400">{nCpuUsage}</span>
                              ) : (
                                <span className="text-zinc-500">Unavailable</span>
                              )}
                              <span className="text-zinc-500 mx-1">/</span>
                              <span>{nCpuAlloc}</span>
                            </div>
                            <div className="text-[10px] text-zinc-500">Cap: {nCpuCap}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="font-bold text-sky-400">
                              {nCpuReq} ({nCpuReqPct}%)
                            </div>
                            <div className="w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${getCommitmentColor(nCpuReqPct)}`}
                                style={{ width: `${Math.min(100, nCpuReqPct)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            <div className="font-bold text-zinc-200">
                              {nMemUsage ? (
                                <span className="text-emerald-400">{nMemUsage}</span>
                              ) : (
                                <span className="text-zinc-500">Unavailable</span>
                              )}
                              <span className="text-zinc-500 mx-1">/</span>
                              <span>{nMemAlloc}</span>
                            </div>
                            <div className="text-[10px] text-zinc-500">Cap: {nMemCap}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            <div className="font-bold text-violet-400">
                              {nMemReq} ({nMemReqPct}%)
                            </div>
                            <div className="w-24 bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${getCommitmentColor(nMemReqPct)}`}
                                style={{ width: `${Math.min(100, nMemReqPct)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-300 font-bold">{node.podCount ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* WORKLOADS & PODS VIEW */}
      {activeSubTab === 'workloads' && (
        <div className="space-y-4">
          {/* Controls & Badges Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
            <div className="flex items-center gap-2 overflow-x-auto">
              <button
                onClick={() => setWorkloadFilter('all')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors ${
                  workloadFilter === 'all'
                    ? 'bg-zinc-800 text-zinc-100 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                All Workloads ({workloadSummaries.length})
              </button>
              <button
                onClick={() => setWorkloadFilter('no-limits')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  workloadFilter === 'no-limits'
                    ? 'bg-amber-950/80 text-amber-300 border border-amber-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>No Limits Set</span>
              </button>
              <button
                onClick={() => setWorkloadFilter('near-limit')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  workloadFilter === 'near-limit'
                    ? 'bg-rose-950/80 text-rose-300 border border-rose-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                <span>Near Memory Limit</span>
              </button>
              <button
                onClick={() => setWorkloadFilter('missing-usage')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors flex items-center gap-1.5 ${
                  workloadFilter === 'missing-usage'
                    ? 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Info className="w-3.5 h-3.5 text-zinc-400" />
                <span>Usage Unavailable</span>
              </button>
            </div>

            <input
              type="text"
              placeholder="Search workload or namespace..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 w-full sm:w-64"
            />
          </div>

          {filteredWorkloads.length === 0 ? (
            <div className="p-8 text-center bg-zinc-900 border border-zinc-800 rounded-xl space-y-2">
              <Boxes className="w-8 h-8 text-zinc-500 mx-auto" />
              <div className="text-zinc-300 font-medium text-sm">No workloads match this filter</div>
              <p className="text-xs text-zinc-500">Try switching filters or clearing your search term.</p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3">Workload</th>
                      <th className="px-4 py-3">Kind / Namespace</th>
                      <th className="px-4 py-3">Observability Flags</th>
                      <th className="px-4 py-3">CPU (Req / Limit / Usage)</th>
                      <th className="px-4 py-3">Memory (Req / Limit / Usage)</th>
                      <th className="px-4 py-3">Pod Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {filteredWorkloads.map((w) => {
                      const wName = w.name || (w as any).resourceName || 'workload';
                      const wKind = w.kind || w.workloadKind || 'Workload';
                      const wNamespace = w.namespace || 'default';
                      const wPods = w.childPodCount ?? w.podCount ?? 0;

                      const wCpuReq = w.cpu?.request?.formatted || (w as any).totalCpuRequests?.formatted || '0m';
                      const wCpuLim = w.cpu?.limit?.formatted || (w as any).totalCpuLimits?.formatted || '0m';
                      const wCpuUsage = w.cpu?.usage?.formatted || (w as any).totalCpuUsage?.formatted;

                      const wMemReq = w.memory?.request?.formatted || (w as any).totalMemoryRequests?.formatted || '0 Mi';
                      const wMemLim = w.memory?.limit?.formatted || (w as any).totalMemoryLimits?.formatted || '0 Mi';
                      const wMemUsage = w.memory?.usage?.formatted || (w as any).totalMemoryUsage?.formatted;

                      const hasNoLimits =
                        w.hasPodsWithoutLimits ??
                        ((!w.cpu?.limit?.value && !(w as any).totalCpuLimits?.value) ||
                          (!w.memory?.limit?.value && !(w as any).totalMemoryLimits?.value));

                      const isNearLimit =
                        w.isNearMemoryLimit ??
                        ((w.memory?.utilizationPercent ?? 0) > 85);

                      const usageAvailable =
                        w.usageAvailable ??
                        w.isUsageAvailable ??
                        Boolean(wCpuUsage || wMemUsage);

                      return (
                        <tr key={`${wNamespace}/${wKind}/${wName}`} className="hover:bg-zinc-850/50 transition-colors">
                          <td className="px-4 py-3 font-medium text-zinc-100 flex items-center gap-2">
                            <Boxes className="w-4 h-4 text-sky-400" />
                            <span>{wName}</span>
                          </td>
                          <td className="px-4 py-3 text-zinc-400">
                            <div>
                              <span className="text-zinc-300 font-semibold">{wKind}</span>
                              <span className="text-zinc-500 ml-1">in {wNamespace}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {hasNoLimits && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" />
                                  No Limits Set
                                </span>
                              )}
                              {isNearLimit && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950 text-rose-400 border border-rose-800 flex items-center gap-1">
                                  <AlertOctagon className="w-3 h-3" />
                                  Near Memory Limit
                                </span>
                              )}
                              {!usageAvailable && (
                                <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700">
                                  Usage Unavailable
                                </span>
                              )}
                              {!hasNoLimits && !isNearLimit && usageAvailable && (
                                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                                  Healthy Spec
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className="text-zinc-300">
                                Req: <strong className="text-sky-400">{wCpuReq}</strong>
                                <span className="text-zinc-500 mx-1">|</span>
                                Limit: <strong className="text-amber-400">{wCpuLim}</strong>
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Usage:{' '}
                                {usageAvailable && wCpuUsage ? (
                                  <strong className="text-emerald-400">{wCpuUsage}</strong>
                                ) : (
                                  <span className="text-zinc-500">Unavailable</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="space-y-0.5">
                              <div className="text-zinc-300">
                                Req: <strong className="text-violet-400">{wMemReq}</strong>
                                <span className="text-zinc-500 mx-1">|</span>
                                Limit: <strong className="text-emerald-400">{wMemLim}</strong>
                              </div>
                              <div className="text-[10px] text-zinc-400">
                                Usage:{' '}
                                {usageAvailable && wMemUsage ? (
                                  <strong className="text-emerald-400">{wMemUsage}</strong>
                                ) : (
                                  <span className="text-zinc-500">Unavailable</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-zinc-300 font-bold">{wPods}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TELEMETRY TIMELINE & HISTORY VIEW */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-sky-400" />
                <h4 className="font-bold text-sm text-zinc-100 font-mono">Real Historical Telemetry Foundation</h4>
              </div>
              <span className="text-xs font-mono text-zinc-400">
                Data Points: <strong className="text-zinc-200">{history.length}</strong> (Collected over time)
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              SkyOps captures genuine time series snapshots directly from agent scrapes. In accordance with zero-fabrication directives,
              historical points are only recorded when real observations occur.
            </p>
          </div>

          {history.length <= 1 ? (
            <div className="bg-zinc-900/60 border border-dashed border-zinc-800 rounded-xl p-8 text-center space-y-3">
              <Clock className="w-8 h-8 text-zinc-500 mx-auto animate-pulse" />
              <div className="text-zinc-200 font-mono font-medium text-sm">
                Collecting historical telemetry: {history.length} observation point recorded
              </div>
              <p className="text-xs text-zinc-500 max-w-md mx-auto">
                Historical trends automatically accumulate as the SkyOps agent performs periodic telemetry scrapes.
                No synthetic or interpolated mock points are generated.
              </p>
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">CPU Request %</th>
                      <th className="px-4 py-3">CPU Limit %</th>
                      <th className="px-4 py-3">CPU Usage %</th>
                      <th className="px-4 py-3">Memory Request %</th>
                      <th className="px-4 py-3">Memory Limit %</th>
                      <th className="px-4 py-3">Memory Usage %</th>
                      <th className="px-4 py-3">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {history
                      .slice()
                      .reverse()
                      .map((pt) => {
                        const ptCpuReq =
                          pt.cpuRequestedPercent ??
                          (pt.cpuCapacityMillicores && pt.cpuRequestMillicores
                            ? Math.round((pt.cpuRequestMillicores / pt.cpuCapacityMillicores) * 100)
                            : undefined);

                        const ptCpuLim = pt.cpuLimitPercent;

                        const ptCpuUsage =
                          pt.cpuUsagePercent ??
                          (pt.cpuCapacityMillicores && pt.cpuUsageMillicores !== undefined
                            ? Math.round((pt.cpuUsageMillicores / pt.cpuCapacityMillicores) * 100)
                            : undefined);

                        const ptMemReq =
                          pt.memoryRequestedPercent ??
                          (pt.memoryCapacityBytes && pt.memoryRequestBytes
                            ? Math.round((pt.memoryRequestBytes / pt.memoryCapacityBytes) * 100)
                            : undefined);

                        const ptMemLim = pt.memoryLimitPercent;

                        const ptMemUsage =
                          pt.memoryUsagePercent ??
                          (pt.memoryCapacityBytes && pt.memoryUsageBytes !== undefined
                            ? Math.round((pt.memoryUsageBytes / pt.memoryCapacityBytes) * 100)
                            : undefined);

                        const ptSource = pt.source || (pt.isUsageAvailable ? 'metrics.k8s.io' : 'spec-derived');

                        return (
                          <tr key={pt.timestamp} className="hover:bg-zinc-850/50 transition-colors">
                            <td className="px-4 py-3 text-zinc-300">
                              {new Date(pt.timestamp).toLocaleTimeString()} ({formatFreshnessTime(pt.timestamp)})
                            </td>
                            <td className="px-4 py-3 font-bold text-sky-400">
                              {ptCpuReq !== undefined ? `${ptCpuReq}%` : 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-bold text-amber-400">
                              {ptCpuLim !== undefined ? `${ptCpuLim}%` : 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-bold text-emerald-400">
                              {ptCpuUsage !== undefined ? `${ptCpuUsage}%` : 'Unavailable'}
                            </td>
                            <td className="px-4 py-3 font-bold text-violet-400">
                              {ptMemReq !== undefined ? `${ptMemReq}%` : 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-bold text-emerald-400">
                              {ptMemLim !== undefined ? `${ptMemLim}%` : 'N/A'}
                            </td>
                            <td className="px-4 py-3 font-bold text-emerald-400">
                              {ptMemUsage !== undefined ? `${ptMemUsage}%` : 'Unavailable'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700">
                                {ptSource}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const ClusterObservabilityView: React.FC<ClusterObservabilityViewProps> = (props) => {
  return (
    <ErrorBoundary
      fallbackTitle="Observability Telemetry Interface"
      fallbackMessage="An unexpected error occurred while visualizing cluster observability telemetry. You can safely retry or return to cluster overview."
    >
      <ClusterObservabilityContent {...props} />
    </ErrorBoundary>
  );
};
