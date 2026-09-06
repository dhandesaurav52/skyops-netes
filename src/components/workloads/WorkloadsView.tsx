import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Filter,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Server
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { ResourceHealthBadge, WorkloadKindBadge } from '../common/Badges';
import { Button, EmptyState } from '../common/UI';
import { PodDetailModal } from '../resources/PodDetailModal';
import { WorkloadDetailModal } from '../resources/WorkloadDetailModal';

interface WorkloadsViewProps {
  resources: KubernetesResource[];
  clusters: Cluster[];
  incidents: Incident[];
  loading: boolean;
  onRefresh: () => void;
  onSelectCluster: (clusterId: string) => void;
  onSelectIncident: (incidentId: string) => void;
}

export const WorkloadsView: React.FC<WorkloadsViewProps> = ({
  resources,
  clusters,
  incidents,
  loading,
  onRefresh,
  onSelectCluster,
  onSelectIncident
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all');
  const [selectedKind, setSelectedKind] = useState<string>('all');
  const [selectedHealth, setSelectedHealth] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedWorkload, setSelectedWorkload] = useState<KubernetesResource | null>(null);
  const [selectedPod, setSelectedPod] = useState<KubernetesResource | null>(null);

  // Filter down to workload kinds
  const workloadKinds = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'];

  const allWorkloads = useMemo(() => {
    return resources.filter((r) => workloadKinds.includes(r.kind));
  }, [resources]);

  const filteredWorkloads = useMemo(() => {
    return allWorkloads.filter((w) => {
      if (selectedClusterId !== 'all' && w.clusterId !== selectedClusterId) return false;
      if (selectedKind !== 'all' && w.kind.toLowerCase() !== selectedKind.toLowerCase()) return false;
      if (selectedHealth !== 'all' && w.health.toLowerCase() !== selectedHealth.toLowerCase()) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = w.name.toLowerCase().includes(q);
        const matchesNs = w.namespace.toLowerCase().includes(q);
        const matchesCluster = (w.clusterName || '').toLowerCase().includes(q);
        if (!matchesName && !matchesNs && !matchesCluster) return false;
      }
      return true;
    });
  }, [allWorkloads, selectedClusterId, selectedKind, selectedHealth, searchQuery]);

  // Metric stats
  const totalCount = allWorkloads.length;
  const degradedCount = allWorkloads.filter(
    (w) => w.health === 'CRITICAL' || w.health === 'WARNING'
  ).length;
  const healthyCount = allWorkloads.filter((w) => w.health === 'HEALTHY').length;

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto font-sans">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5 font-mono">
            <Boxes className="w-5 h-5 text-sky-400" />
            Workload Operations Console
          </h1>
          <p className="text-xs font-mono text-zinc-400 mt-1">
            Real-time status of Deployments, StatefulSets, DaemonSets, and Jobs across all connected Kubernetes clusters
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
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Total Workloads</div>
          <div className="text-2xl font-bold text-zinc-100 font-mono mt-1">{totalCount}</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">Deployments & controllers</div>
        </div>

        <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40">
          <div className="text-[11px] font-mono text-emerald-400 uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Healthy Workloads
          </div>
          <div className="text-2xl font-bold text-emerald-300 font-mono mt-1">{healthyCount}</div>
          <div className="text-[10px] font-mono text-emerald-500 mt-1">All replicas available</div>
        </div>

        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-900/40">
          <div className="text-[11px] font-mono text-rose-400 uppercase tracking-wider flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            Degraded / Attention
          </div>
          <div className="text-2xl font-bold text-rose-300 font-mono mt-1">{degradedCount}</div>
          <div className="text-[10px] font-mono text-rose-500 mt-1">Unavailable pods or crashes</div>
        </div>

        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Connected Clusters</div>
          <div className="text-2xl font-bold text-zinc-200 font-mono mt-1">{clusters.length}</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">Registered infrastructure</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search workload, namespace..."
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

          {/* Workload Kind filter */}
          <select
            value={selectedKind}
            onChange={(e) => setSelectedKind(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Kinds</option>
            <option value="deployment">Deployments</option>
            <option value="statefulset">StatefulSets</option>
            <option value="daemonset">DaemonSets</option>
            <option value="job">Jobs</option>
            <option value="cronjob">CronJobs</option>
          </select>

          {/* Health filter */}
          <select
            value={selectedHealth}
            onChange={(e) => setSelectedHealth(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-zinc-300 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Health States</option>
            <option value="healthy">Healthy Only</option>
            <option value="warning">Warning / Degraded</option>
            <option value="critical">Critical Only</option>
          </select>
        </div>

        <div className="text-zinc-500 text-[11px]">
          Showing <strong>{filteredWorkloads.length}</strong> of {allWorkloads.length} workloads
        </div>
      </div>

      {/* Workload Table */}
      {filteredWorkloads.length === 0 ? (
        <EmptyState
          title="No workloads found"
          description={
            allWorkloads.length === 0
              ? 'No Kubernetes workloads are currently reporting telemetry. Connect an agent or deploy a sample workload.'
              : 'No workloads matched the selected filters.'
          }
        />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden font-mono text-xs">
          <table className="w-full text-left">
            <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="p-3.5">Workload Name</th>
                <th className="p-3.5">Kind</th>
                <th className="p-3.5">Cluster</th>
                <th className="p-3.5">Namespace</th>
                <th className="p-3.5">Health</th>
                <th className="p-3.5">Replicas</th>
                <th className="p-3.5">Linked Incidents</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filteredWorkloads.map((workload) => {
                const desired = Number(workload.specSummary?.replicas ?? 1);
                const ready = Number(
                  workload.statusSummary?.readyReplicas ??
                  workload.statusSummary?.availableReplicas ??
                  0
                );

                const linkedIncidents = incidents.filter(
                  (inc) =>
                    inc.clusterId === workload.clusterId &&
                    inc.namespace === workload.namespace &&
                    inc.resourceName === workload.name
                );

                return (
                  <tr
                    key={workload.id}
                    onClick={() => setSelectedWorkload(workload)}
                    className="hover:bg-zinc-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="p-3.5 font-bold text-zinc-100 group-hover:text-sky-300">
                      <div className="truncate max-w-[220px]">{workload.name}</div>
                    </td>
                    <td className="p-3.5">
                      <WorkloadKindBadge kind={workload.kind} />
                    </td>
                    <td className="p-3.5 text-zinc-300">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCluster(workload.clusterId);
                        }}
                        className="hover:text-sky-400 underline decoration-zinc-700 underline-offset-2 truncate max-w-[140px]"
                      >
                        {workload.clusterName || workload.clusterId}
                      </button>
                    </td>
                    <td className="p-3.5 text-zinc-400 truncate max-w-[120px]">{workload.namespace}</td>
                    <td className="p-3.5">
                      <ResourceHealthBadge health={workload.health} />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold ${
                            ready < desired ? 'text-amber-400' : 'text-emerald-400'
                          }`}
                        >
                          {ready}/{desired}
                        </span>
                        <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${
                              ready === 0
                                ? 'bg-rose-500'
                                : ready < desired
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.round((ready / (desired || 1)) * 100))}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5">
                      {linkedIncidents.length > 0 ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectIncident(linkedIncidents[0].id);
                          }}
                          className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-300 border border-rose-800/60 font-bold hover:bg-rose-900"
                        >
                          {linkedIncidents.length} active incident(s) →
                        </button>
                      ) : (
                        <span className="text-zinc-600">None</span>
                      )}
                    </td>
                    <td className="p-3.5 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedWorkload(workload);
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

      {/* Pod Detail Modal */}
      {selectedPod && (
        <PodDetailModal
          pod={selectedPod}
          clusterResources={resources.filter((r) => r.clusterId === selectedPod.clusterId)}
          incidents={incidents}
          onClose={() => setSelectedPod(null)}
          onSelectIncident={onSelectIncident}
          onSelectResource={(res) => {
            if (workloadKinds.includes(res.kind)) {
              setSelectedPod(null);
              setSelectedWorkload(res);
            }
          }}
        />
      )}
    </div>
  );
};
