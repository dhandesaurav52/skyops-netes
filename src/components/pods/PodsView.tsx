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

interface PodsViewProps {
  resources: KubernetesResource[];
  clusters: Cluster[];
  incidents: Incident[];
  loading: boolean;
  onRefresh: () => void;
  onSelectCluster: (clusterId: string) => void;
  onSelectIncident: (incidentId: string) => void;
}

export const PodsView: React.FC<PodsViewProps> = ({
  resources,
  clusters,
  incidents,
  loading,
  onRefresh,
  onSelectCluster,
  onSelectIncident
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'all' | 'crashing' | 'pending' | 'running'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedPod, setSelectedPod] = useState<KubernetesResource | null>(null);
  const [selectedWorkload, setSelectedWorkload] = useState<KubernetesResource | null>(null);

  // All pods
  const allPods = useMemo(() => {
    return resources.filter((r) => r.kind === 'Pod');
  }, [resources]);

  // Is crashing helper
  const isPodCrashing = (p: KubernetesResource) => {
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
    return p.status === 'Pending' || p.status === 'ContainerCreating';
  };

  const isPodRunning = (p: KubernetesResource) => {
    return p.status === 'Running';
  };

  const filteredPods = useMemo(() => {
    return allPods.filter((p) => {
      if (selectedClusterId !== 'all' && p.clusterId !== selectedClusterId) return false;

      if (selectedStatusFilter === 'crashing' && !isPodCrashing(p)) return false;
      if (selectedStatusFilter === 'pending' && !isPodPending(p)) return false;
      if (selectedStatusFilter === 'running' && !isPodRunning(p)) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(q);
        const matchesNs = p.namespace.toLowerCase().includes(q);
        const matchesCluster = (p.clusterName || '').toLowerCase().includes(q);
        const matchesImage = p.containers?.some((c) => c.image.toLowerCase().includes(q));
        if (!matchesName && !matchesNs && !matchesCluster && !matchesImage) return false;
      }

      return true;
    });
  }, [allPods, selectedClusterId, selectedStatusFilter, searchQuery]);

  // Metric stats
  const totalCount = allPods.length;
  const crashingCount = allPods.filter(isPodCrashing).length;
  const runningCount = allPods.filter(isPodRunning).length;
  const pendingCount = allPods.filter(isPodPending).length;

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5 font-mono">
            <Terminal className="w-5 h-5 text-sky-400" />
            Kubernetes Pods & Diagnostics
          </h1>
          <p className="text-xs font-mono text-zinc-400 mt-1">
            Real-time inspection of Pod lifecycles, container readiness, restarts, and crash diagnostic reasons
          </p>
        </div>
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
      </div>

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
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            Crashing / BackOff
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono mt-1">{crashingCount}</div>
          <div className="text-[10px] font-mono text-rose-500 mt-1">CrashLoop or ImagePull errors</div>
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
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
              Crashing ({crashingCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('running')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                selectedStatusFilter === 'running'
                  ? 'bg-emerald-950 text-emerald-200 font-bold border border-emerald-800'
                  : 'text-zinc-400 hover:text-emerald-300'
              }`}
            >
              Running ({runningCount})
            </button>
            <button
              onClick={() => setSelectedStatusFilter('pending')}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
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
              placeholder="Search pod name, namespace..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Cluster filter */}
          <select
            value={selectedClusterId}
            onChange={(e) => setSelectedClusterId(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Clusters ({clusters.length})</option>
            {clusters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
              ? 'No Kubernetes pods are reporting telemetry yet. Connect a cluster or deploy workloads.'
              : 'No pods match the active filters.'
          }
        />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden font-mono text-xs">
          <table className="w-full text-left">
            <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Pod Name</th>
                <th className="p-3.5">Cluster</th>
                <th className="p-3.5">Namespace</th>
                <th className="p-3.5">Status & Reason</th>
                <th className="p-3.5">Containers</th>
                <th className="p-3.5">Restarts</th>
                <th className="p-3.5">Node</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredPods.map((pod) => {
                const crashing = isPodCrashing(pod);
                const totalRestarts =
                  pod.containers?.reduce((sum, c) => sum + (c.restartCount || 0), 0) || 0;
                const readyContainers = pod.containers?.filter((c) => c.ready).length || 0;
                const totalContainers = pod.containers?.length || 1;

                // Specific waiting/failing reason
                const failingC = pod.containers?.find(
                  (c) => c.waitingReason || c.terminationReason || !c.ready
                );
                const diagnosticText =
                  failingC?.waitingReason || failingC?.terminationReason || pod.status;

                return (
                  <tr
                    key={pod.id}
                    onClick={() => setSelectedPod(pod)}
                    className={`hover:bg-zinc-800/40 transition-colors cursor-pointer group ${
                      crashing ? 'bg-rose-950/10' : ''
                    }`}
                  >
                    <td className="p-3.5 font-bold text-zinc-100 group-hover:text-sky-300">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            crashing
                              ? 'bg-rose-500 animate-pulse'
                              : pod.status === 'Running'
                              ? 'bg-emerald-500'
                              : 'bg-amber-400'
                          }`}
                        />
                        <span className="truncate max-w-[220px]">{pod.name}</span>
                      </div>
                    </td>
                    <td className="p-3.5 text-zinc-300">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCluster(pod.clusterId);
                        }}
                        className="hover:text-sky-400 underline decoration-zinc-700 underline-offset-2 truncate max-w-[130px]"
                      >
                        {pod.clusterName || pod.clusterId}
                      </button>
                    </td>
                    <td className="p-3.5 text-zinc-400 truncate max-w-[120px]">{pod.namespace}</td>
                    <td className="p-3.5">
                      <div className="space-y-0.5">
                        <PodPhaseBadge phaseOrStatus={pod.status} />
                        {failingC && failingC.waitingReason && failingC.waitingReason !== pod.status && (
                          <div className="text-[10px] text-rose-400 font-mono">
                            {failingC.waitingReason}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5 text-zinc-300">
                      <span className={readyContainers < totalContainers ? 'text-rose-400 font-bold' : ''}>
                        {readyContainers}/{totalContainers} Ready
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`font-bold ${
                          totalRestarts > 0 ? 'text-rose-400 font-mono' : 'text-zinc-400'
                        }`}
                      >
                        {totalRestarts}
                      </span>
                    </td>
                    <td className="p-3.5 text-zinc-400 max-w-[140px] truncate">
                      {pod.specSummary?.nodeName as string || 'Scheduled'}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedPod(pod);
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

      {/* Pod Detail Modal */}
      {selectedPod && (
        <PodDetailModal
          pod={selectedPod}
          clusterResources={resources.filter((r) => r.clusterId === selectedPod.clusterId)}
          incidents={incidents}
          onClose={() => setSelectedPod(null)}
          onSelectIncident={onSelectIncident}
          onSelectResource={(res) => {
            if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(res.kind)) {
              setSelectedPod(null);
              setSelectedWorkload(res);
            }
          }}
        />
      )}

      {/* Workload Detail Modal */}
      {selectedWorkload && (
        <WorkloadDetailModal
          workload={selectedWorkload}
          clusterResources={resources.filter((r) => r.clusterId === selectedWorkload.clusterId)}
          incidents={incidents}
          onClose={() => setSelectedWorkload(null)}
          onSelectPod={(pod) => {
            setSelectedWorkload(null);
            setSelectedPod(pod);
          }}
          onSelectIncident={onSelectIncident}
        />
      )}
    </div>
  );
};
