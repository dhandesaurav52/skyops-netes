import {
  AlertOctagon,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  Filter,
  Layers,
  RefreshCw,
  Search,
  Server,
  Terminal
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, WorkloadKindBadge } from '../common/Badges';
import { Button, EmptyState } from '../common/UI';
import { PodDetailModal } from '../resources/PodDetailModal';
import { WorkloadDetailModal } from '../resources/WorkloadDetailModal';

export interface PodsViewProps {
  // Supports both single-cluster (ClusterDetailView) and global invocations
  pods?: KubernetesResource[];
  resources?: KubernetesResource[];
  clusterResources?: KubernetesResource[];
  cluster?: Cluster | null;
  clusters?: Cluster[];
  incidents?: Incident[];
  loading?: boolean;
  onRefresh?: () => void;
  onSelectCluster?: (clusterId: string) => void;
  onSelectIncident?: (incidentId: string) => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  // Optional flag to adjust layout when embedded in tabs
  isEmbedded?: boolean;
}

export const PodsView: React.FC<PodsViewProps> = ({
  pods,
  resources,
  clusterResources,
  cluster,
  clusters,
  incidents,
  loading = false,
  onRefresh,
  onSelectCluster,
  onSelectIncident,
  onSelectPod,
  isEmbedded = false
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'crashing' | 'pending' | 'running'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [localSelectedPod, setLocalSelectedPod] = useState<KubernetesResource | null>(null);
  const [localSelectedWorkload, setLocalSelectedWorkload] = useState<KubernetesResource | null>(null);

  // Safe normalized collections
  const safeClusterResources = useMemo(() => {
    if (Array.isArray(clusterResources)) return clusterResources;
    if (Array.isArray(resources)) return resources;
    return [];
  }, [clusterResources, resources]);

  const safeClusters = useMemo(() => {
    if (Array.isArray(clusters) && clusters.length > 0) return clusters;
    if (cluster) return [cluster];
    const clusterMap = new Map<string, { id: string; name: string }>();
    for (const r of safeClusterResources) {
      if (r && r.clusterId && !clusterMap.has(r.clusterId)) {
        clusterMap.set(r.clusterId, {
          id: r.clusterId,
          name: r.clusterName || r.clusterId
        });
      }
    }
    return Array.from(clusterMap.values()) as unknown as Cluster[];
  }, [clusters, cluster, safeClusterResources]);

  const safeIncidents = useMemo(() => {
    return Array.isArray(incidents) ? incidents : [];
  }, [incidents]);

  const allPods = useMemo(() => {
    if (Array.isArray(pods)) {
      return pods.filter((p): p is KubernetesResource => !!p);
    }
    return safeClusterResources.filter(
      (r): r is KubernetesResource => !!r && r.kind === 'Pod'
    );
  }, [pods, safeClusterResources]);

  // Distinct namespaces for quick filtering
  const distinctNamespaces = useMemo(() => {
    const nsSet = new Set<string>();
    for (const p of allPods) {
      if (p.namespace) nsSet.add(p.namespace);
    }
    return Array.from(nsSet).sort();
  }, [allPods]);

  // Is crashing helper
  const isPodCrashing = (p: KubernetesResource) => {
    if (!p) return false;
    return (
      p.health === 'CRITICAL' ||
      p.status === 'CrashLoopBackOff' ||
      p.status === 'ImagePullBackOff' ||
      p.status === 'ErrImagePull' ||
      p.status === 'OOMKilled' ||
      p.status === 'Failed' ||
      p.status === 'Error'
    );
  };

  const isPodPending = (p: KubernetesResource) => {
    if (!p) return false;
    return p.status === 'Pending' || p.status === 'ContainerCreating';
  };

  const isPodRunning = (p: KubernetesResource) => {
    if (!p) return false;
    return p.status === 'Running';
  };

  const filteredPods = useMemo(() => {
    return allPods.filter((p) => {
      if (!p) return false;
      if (selectedClusterId !== 'all' && p.clusterId && p.clusterId !== selectedClusterId) return false;
      if (selectedNamespace !== 'all' && p.namespace !== selectedNamespace) return false;

      if (selectedStatusFilter === 'crashing' && !isPodCrashing(p)) return false;
      if (selectedStatusFilter === 'pending' && !isPodPending(p)) return false;
      if (selectedStatusFilter === 'running' && !isPodRunning(p)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = (p.name || '').toLowerCase().includes(q);
        const matchesNs = (p.namespace || '').toLowerCase().includes(q);
        const matchesCluster = (p.clusterName || p.clusterId || '').toLowerCase().includes(q);
        const matchesImage = Array.isArray(p.containers) && p.containers.some((c) => (c?.image || '').toLowerCase().includes(q));
        const matchesNode = (typeof p.specSummary?.nodeName === 'string' && p.specSummary.nodeName.toLowerCase().includes(q));
        if (!matchesName && !matchesNs && !matchesCluster && !matchesImage && !matchesNode) return false;
      }

      return true;
    });
  }, [allPods, selectedClusterId, selectedNamespace, selectedStatusFilter, searchQuery]);

  // Metric stats
  const totalCount = allPods.length;
  const crashingCount = allPods.filter(isPodCrashing).length;
  const runningCount = allPods.filter(isPodRunning).length;
  const pendingCount = allPods.filter(isPodPending).length;

  const handleInspect = (pod: KubernetesResource) => {
    if (onSelectPod) {
      onSelectPod(pod);
    } else {
      setLocalSelectedPod(pod);
    }
  };

  const isMultiCluster = safeClusters.length > 1;

  return (
    <div className={`space-y-6 ${isEmbedded ? '' : 'p-8 max-w-7xl mx-auto'} font-sans`}>
      {/* Header if not embedded */}
      {!isEmbedded && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div>
            <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5 font-mono">
              <Terminal className="w-5 h-5 text-sky-400" />
              Kubernetes Pods & Diagnostics
            </h1>
            <p className="text-xs font-mono text-zinc-400 mt-1">
              Real-time inspection of Pod lifecycles, container readiness, restarts, and diagnostic reasons
            </p>
          </div>
          {onRefresh && (
            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={onRefresh}
                disabled={loading}
                icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              >
                Refresh Telemetry
              </Button>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Total Pods</div>
          <div className="text-2xl font-bold text-zinc-100 font-mono mt-1">{totalCount}</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">Across all namespaces</div>
        </div>

        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
          <div className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Running Pods
          </div>
          <div className="text-2xl font-bold text-emerald-300 font-mono mt-1">{runningCount}</div>
          <div className="text-[10px] font-mono text-emerald-500 mt-1">Normal execution</div>
        </div>

        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40">
          <div className="text-[11px] font-mono text-rose-400 uppercase tracking-wider flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${crashingCount > 0 ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
            Crashing / BackOff
          </div>
          <div className={`text-2xl font-bold font-mono mt-1 ${crashingCount > 0 ? 'text-rose-300' : 'text-zinc-400'}`}>
            {crashingCount}
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">CrashLoop or ImagePull errors</div>
        </div>

        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-900/40">
          <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Pending / Scheduling
          </div>
          <div className="text-2xl font-bold text-amber-300 font-mono mt-1">{pendingCount}</div>
          <div className="text-[10px] font-mono text-amber-500 mt-1">Containers initializing</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          {/* Quick status tabs */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-lg p-1 gap-1">
            <button
              onClick={() => setSelectedStatusFilter('all')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                selectedStatusFilter === 'all'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({totalCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('crashing')}
              className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
                selectedStatusFilter === 'crashing'
                  ? 'bg-rose-950 text-rose-200 font-bold border border-rose-800'
                  : 'text-zinc-400 hover:text-rose-300'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${crashingCount > 0 ? 'bg-rose-500 animate-pulse' : 'bg-zinc-600'}`} />
              Crashing ({crashingCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('running')}
              className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
                selectedStatusFilter === 'running'
                  ? 'bg-emerald-950 text-emerald-200 font-bold border border-emerald-800'
                  : 'text-zinc-400 hover:text-emerald-300'
              }`}
            >
              Running ({runningCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('pending')}
              className={`px-2.5 py-1 rounded text-xs transition-colors flex items-center gap-1.5 ${
                selectedStatusFilter === 'pending'
                  ? 'bg-amber-950 text-amber-200 font-bold border border-amber-800'
                  : 'text-zinc-400 hover:text-amber-300'
              }`}
            >
              Pending ({pendingCount})
            </button>
          </div>

          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search pod name, namespace, node..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Cluster filter (only if multiple clusters) */}
          {isMultiCluster && (
            <select
              value={selectedClusterId}
              onChange={(e) => setSelectedClusterId(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Clusters ({safeClusters.length})</option>
              {safeClusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          {/* Namespace filter */}
          {distinctNamespaces.length > 1 && (
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 focus:outline-none focus:border-sky-500"
            >
              <option value="all">All Namespaces ({distinctNamespaces.length})</option>
              {distinctNamespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="text-zinc-500 text-[11px]">
          Showing <strong>{filteredPods.length}</strong> of {allPods.length} pods
        </div>
      </div>

      {/* Pods Table */}
      {filteredPods.length === 0 ? (
        <EmptyState
          title="No Pods Found"
          description={
            allPods.length === 0
              ? 'No Kubernetes pods are reporting telemetry for this cluster yet. Check agent connection or deploy workloads.'
              : 'No pods match the active filters. Try resetting status or search filters.'
          }
        />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden font-mono text-xs">
          <table className="w-full text-left">
            <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Pod Name</th>
                {isMultiCluster && <th className="p-3.5">Cluster</th>}
                <th className="p-3.5">Namespace</th>
                <th className="p-3.5">Phase / Status</th>
                <th className="p-3.5">Containers</th>
                <th className="p-3.5">Restarts</th>
                <th className="p-3.5">Scheduled Node</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredPods.map((pod) => {
                const totalContainers = Array.isArray(pod.containers) ? pod.containers.length : 0;
                const readyContainers = Array.isArray(pod.containers)
                  ? pod.containers.filter((c) => c && c.ready).length
                  : 0;
                const totalRestarts = Array.isArray(pod.containers)
                  ? pod.containers.reduce((acc, c) => acc + (c?.restartCount || 0), 0)
                  : 0;
                const scheduledNode =
                  (pod.specSummary?.nodeName as string) ||
                  (pod.statusSummary?.hostIP ? `Node (${pod.statusSummary.hostIP})` : 'Scheduled');

                return (
                  <tr
                    key={pod.id}
                    onClick={() => handleInspect(pod)}
                    className="hover:bg-zinc-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="p-3.5 font-bold text-zinc-100 group-hover:text-sky-300">
                      <div className="truncate max-w-[240px] flex items-center gap-2">
                        <Terminal className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                        <span className="truncate">{pod.name}</span>
                      </div>
                    </td>
                    {isMultiCluster && (
                      <td className="p-3.5 text-zinc-300">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onSelectCluster) onSelectCluster(pod.clusterId);
                          }}
                          className="hover:text-sky-400 underline decoration-zinc-700 underline-offset-2 truncate max-w-[140px]"
                        >
                          {pod.clusterName || pod.clusterId}
                        </button>
                      </td>
                    )}
                    <td className="p-3.5 text-zinc-400 truncate max-w-[130px]">{pod.namespace}</td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-1.5">
                        <PodPhaseBadge phase={pod.status} />
                        {pod.statusSummary?.reason && pod.statusSummary.reason !== pod.status && (
                          <span className="text-[10px] text-zinc-500 truncate max-w-[100px]">
                            ({String(pod.statusSummary.reason)})
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`font-semibold ${
                          readyContainers < totalContainers ? 'text-amber-400 font-bold' : 'text-zinc-300'
                        }`}
                      >
                        {readyContainers}/{totalContainers} Ready
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[11px] ${
                          totalRestarts > 5
                            ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60 font-bold'
                            : totalRestarts > 0
                            ? 'bg-amber-950/50 text-amber-300 border border-amber-800/50'
                            : 'text-zinc-500'
                        }`}
                      >
                        {totalRestarts}
                      </span>
                    </td>
                    <td className="p-3.5 text-zinc-400 max-w-[140px] truncate">
                      {scheduledNode}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleInspect(pod);
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-sky-900/60 hover:text-sky-200 text-zinc-300 text-xs font-mono transition-colors"
                      >
                        Inspect →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pod Detail Modal fallback when not controlled by parent */}
      {!onSelectPod && localSelectedPod && (
        <PodDetailModal
          pod={localSelectedPod}
          clusterResources={safeClusterResources.filter((r) => r && r.clusterId === localSelectedPod.clusterId)}
          incidents={safeIncidents}
          onClose={() => setLocalSelectedPod(null)}
          onSelectIncident={onSelectIncident}
          onSelectResource={(res) => {
            if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(res.kind)) {
              setLocalSelectedPod(null);
              setLocalSelectedWorkload(res);
            }
          }}
        />
      )}

      {/* Workload Detail Modal fallback */}
      {!onSelectPod && localSelectedWorkload && (
        <WorkloadDetailModal
          workload={localSelectedWorkload}
          clusterResources={safeClusterResources.filter((r) => r && r.clusterId === localSelectedWorkload.clusterId)}
          incidents={safeIncidents}
          onClose={() => setLocalSelectedWorkload(null)}
          onSelectPod={(p) => {
            setLocalSelectedWorkload(null);
            setLocalSelectedPod(p);
          }}
          onSelectIncident={onSelectIncident}
        />
      )}
    </div>
  );
};
