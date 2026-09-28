import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  Filter,
  Flame,
  HardDrive,
  Layers,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Shield,
  Trash2,
  Workflow,
  Zap
} from 'lucide-react';
import { api } from '../../api/client';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { ClusterStatusBadge } from '../common/Badges';
import { ServicesView } from '../services/ServicesView';
import { ArchitectureView } from '../architecture/ArchitectureView';

interface InfrastructureViewProps {
  clusters: Cluster[];
  onSelectCluster: (clusterId: string) => void;
  onOpenAddCluster: () => void;
  onDeleteCluster: (clusterId: string) => void;
  onRefresh: () => void;
  loading: boolean;
  onSelectIncident?: (id: string) => void;
  onOpenLogs?: (clusterId: string, namespace: string, podName: string) => void;
}

type InfraSubTab = 'architecture' | 'clusters' | 'nodes' | 'workloads' | 'pods' | 'services';

export const InfrastructureView: React.FC<InfrastructureViewProps> = ({
  clusters = [],
  onSelectCluster,
  onOpenAddCluster,
  onDeleteCluster,
  onRefresh,
  loading,
  onSelectIncident,
  onOpenLogs
}) => {
  const [subTab, setSubTab] = useState<InfraSubTab>('clusters');
  const [resources, setResources] = useState<KubernetesResource[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [selectedClusterFilter, setSelectedClusterFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespaceFilter, setSelectedNamespaceFilter] = useState<string>('all');

  const fetchResources = async () => {
    try {
      setLoadingResources(true);
      const [resData, incData] = await Promise.all([
        api.getAllResources().catch(() => []),
        api.getIncidents().catch(() => [])
      ]);
      setResources(Array.isArray(resData) ? resData : []);
      setIncidents(Array.isArray(incData) ? incData : []);
    } catch (err) {
      console.warn('InfrastructureView resource fetch notice:', err);
    } finally {
      setLoadingResources(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, [clusters.length]);

  const safeClusters = Array.isArray(clusters) ? clusters : [];
  const safeResources = Array.isArray(resources) ? resources : [];

  // Filter resources by cluster
  const clusterFilteredResources = useMemo(() => {
    if (selectedClusterFilter === 'all') return safeResources;
    return safeResources.filter((r) => r.clusterId === selectedClusterFilter);
  }, [safeResources, selectedClusterFilter]);

  // Extract namespaces
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const r of clusterFilteredResources) {
      if (r.namespace) set.add(r.namespace);
    }
    return Array.from(set).sort();
  }, [clusterFilteredResources]);

  // Search and namespace filter
  const filteredResources = useMemo(() => {
    return clusterFilteredResources.filter((r) => {
      if (selectedNamespaceFilter !== 'all' && r.namespace !== selectedNamespaceFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = r.name.toLowerCase().includes(q);
        const matchNs = (r.namespace || '').toLowerCase().includes(q);
        const matchKind = r.kind.toLowerCase().includes(q);
        return matchName || matchNs || matchKind;
      }
      return true;
    });
  }, [clusterFilteredResources, selectedNamespaceFilter, searchQuery]);

  // Separate resources by kind
  const nodes = useMemo(
    () => filteredResources.filter((r) => r.kind === 'Node'),
    [filteredResources]
  );
  const workloads = useMemo(
    () =>
      filteredResources.filter((r) =>
        ['Deployment', 'StatefulSet', 'DaemonSet', 'Rollout'].includes(r.kind)
      ),
    [filteredResources]
  );
  const pods = useMemo(
    () => filteredResources.filter((r) => r.kind === 'Pod'),
    [filteredResources]
  );
  const services = useMemo(
    () => filteredResources.filter((r) => r.kind === 'Service'),
    [filteredResources]
  );
  const servicesAndStorage = useMemo(
    () =>
      filteredResources.filter((r) =>
        ['Service', 'PersistentVolumeClaim', 'Ingress'].includes(r.kind)
      ),
    [filteredResources]
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-sky-500/15 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.3)]">
              <Server className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white font-mono">Infrastructure Topology</h1>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30">
              Fleet Mesh
            </span>
          </div>
          <p className="text-xs font-mono text-zinc-400 mt-1">
            Authoritative multi-cluster inventory: nodes, replica sets, pods, and ingress mesh
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              onRefresh();
              fetchResources();
            }}
            disabled={loading || loadingResources}
            className="p-2 text-zinc-300 hover:text-white bg-[#081024] border border-sky-500/25 hover:border-sky-500/45 rounded-lg hover:bg-[#0c1836] transition-colors cursor-pointer shadow-xs"
            title="Refresh Fleet Data"
          >
            <RefreshCw className={`w-4 h-4 ${loading || loadingResources ? 'animate-spin text-sky-400' : 'text-zinc-400'}`} />
          </button>

          <button
            onClick={onOpenAddCluster}
            className="px-3.5 py-2 text-xs font-semibold font-mono rounded-lg bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white border border-sky-400/40 shadow-[0_0_15px_-3px_rgba(14,165,233,0.4)] transition-all cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Connect Cluster
          </button>
        </div>
      </div>

      {/* Sub-Navigation & Filters Bar */}
      <div className="storm-card rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
        {/* Sub-tabs */}
        <div className="flex items-center gap-1 bg-[#030712] p-1 rounded-lg border border-sky-500/20 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setSubTab('architecture')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'architecture'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Workflow className="w-3.5 h-3.5 text-sky-400" />
            Architecture
          </button>
          <button
            onClick={() => setSubTab('clusters')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'clusters'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            Clusters ({safeClusters.length})
          </button>
          <button
            onClick={() => setSubTab('nodes')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'nodes'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Nodes ({nodes.length})
          </button>
          <button
            onClick={() => setSubTab('workloads')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'workloads'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Workloads ({workloads.length})
          </button>
          <button
            onClick={() => setSubTab('pods')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'pods'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Pods ({pods.length})
          </button>
          <button
            onClick={() => setSubTab('services')}
            className={`px-3 py-1.5 text-xs font-medium font-mono rounded transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              subTab === 'services'
                ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            Services ({services.length})
          </button>
        </div>

        {/* Global Cluster & Search Filter */}
        {subTab !== 'architecture' && (
          <div className="flex flex-wrap items-center gap-2.5 font-mono text-xs">
            {safeClusters.length > 1 && (
              <select
                value={selectedClusterFilter}
                onChange={(e) => setSelectedClusterFilter(e.target.value)}
                className="bg-[#030712] border border-sky-500/25 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">All Clusters ({safeClusters.length})</option>
                {safeClusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            {namespaces.length > 0 && subTab !== 'clusters' && subTab !== 'nodes' && (
              <select
                value={selectedNamespaceFilter}
                onChange={(e) => setSelectedNamespaceFilter(e.target.value)}
                className="bg-[#030712] border border-sky-500/25 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-sky-400 cursor-pointer"
              >
                <option value="all">All Namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
            )}

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search resource..."
                className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-sky-500 w-44 sm:w-56"
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Tab Content */}
      {subTab === 'architecture' && (
        <ArchitectureView
          resources={safeResources}
          clusters={safeClusters}
          incidents={incidents}
          selectedClusterId={selectedClusterFilter}
          onSelectCluster={(cid) => setSelectedClusterFilter(cid)}
          onSelectIncident={onSelectIncident}
          onOpenLogs={onOpenLogs}
          onRefresh={() => {
            onRefresh();
            fetchResources();
          }}
          isLoading={loading || loadingResources}
        />
      )}

      {subTab === 'clusters' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {safeClusters.length === 0 ? (
            <div className="col-span-full py-16 text-center bg-zinc-900/60 border border-zinc-800 rounded-xl">
              <Server className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-zinc-200">No Clusters Connected</h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto mb-4">
                Connect your Kubernetes cluster with the SkyOps Helm chart to start streaming telemetry.
              </p>
              <button
                onClick={onOpenAddCluster}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-md"
              >
                + Connect Cluster
              </button>
            </div>
          ) : (
            safeClusters.map((cluster) => {
              const clusterRes = safeResources.filter((r) => r.clusterId === cluster.id);
              const nodeCount = cluster.nodeCount || clusterRes.filter((r) => r.kind === 'Node').length || 0;
              const podCount = cluster.podCount || clusterRes.filter((r) => r.kind === 'Pod').length || 0;

              return (
                <div
                  key={cluster.id}
                  className="bg-zinc-900/80 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 flex flex-col justify-between transition-all group shadow-sm"
                >
                  <div>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                          <Server className="w-4 h-4" />
                        </div>
                        <div>
                          <h3
                            onClick={() => onSelectCluster(cluster.id)}
                            className="text-sm font-bold text-zinc-100 group-hover:text-sky-400 transition-colors cursor-pointer"
                          >
                            {cluster.name}
                          </h3>
                          <div className="text-[11px] font-mono text-zinc-500">
                            {cluster.environment || 'production'} • {cluster.region || 'global'}
                          </div>
                        </div>
                      </div>

                      <ClusterStatusBadge status={cluster.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 my-4">
                      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">Nodes</div>
                        <div className="text-xs font-semibold text-zinc-200 mt-0.5">{nodeCount} Ready</div>
                      </div>
                      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">Workloads</div>
                        <div className="text-xs font-semibold text-zinc-200 mt-0.5">{podCount} Pods</div>
                      </div>
                      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">Kubernetes</div>
                        <div className="text-xs font-semibold text-zinc-200 mt-0.5">
                          {cluster.k8sVersion || 'v1.29'}
                        </div>
                      </div>
                      <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800">
                        <div className="text-[10px] font-mono text-zinc-500 uppercase">Telemetry Agent</div>
                        <div className="text-xs font-semibold text-emerald-400 mt-0.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          {cluster.agentStatus}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                    <button
                      onClick={() => onSelectCluster(cluster.id)}
                      className="text-xs font-medium text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      Manage Infrastructure
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Remove cluster "${cluster.name}" from SkyOps?`)) {
                          onDeleteCluster(cluster.id);
                        }
                      }}
                      title="Disconnect Cluster"
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Nodes Tab */}
      {subTab === 'nodes' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-[11px] font-mono text-zinc-400">
                  <th className="py-3 px-4">Node Name</th>
                  <th className="py-3 px-4">Cluster</th>
                  <th className="py-3 px-4">Condition</th>
                  <th className="py-3 px-4">CPU Allocatable</th>
                  <th className="py-3 px-4">Memory Allocatable</th>
                  <th className="py-3 px-4">Pressure</th>
                  <th className="py-3 px-4">Taints / OS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {nodes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No nodes found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  nodes.map((node) => {
                    const cluster = safeClusters.find((c) => c.id === node.clusterId);
                    const conditions = (node.conditions || []) as any[];
                    const hasMemoryPressure = conditions.some(
                      (c) => c.type === 'MemoryPressure' && (c.status === 'True' || c.status === true)
                    );
                    const hasDiskPressure = conditions.some(
                      (c) => c.type === 'DiskPressure' && (c.status === 'True' || c.status === true)
                    );

                    return (
                      <tr key={`${node.clusterId}-${node.name}`} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                          {node.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{cluster?.name || node.clusterId}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-medium ${
                              node.status === 'Ready'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-red-500/10 text-red-400 border-red-500/30'
                            }`}
                          >
                            {node.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">
                          {(node.metrics as any)?.cpuUsage || (node as any).cpuAllocatable || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">
                          {(node.metrics as any)?.memoryUsage || (node as any).memoryAllocatable || '—'}
                        </td>
                        <td className="py-3 px-4">
                          {hasMemoryPressure || hasDiskPressure ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 font-bold">
                              {hasMemoryPressure ? 'MEM PRESSURE' : 'DISK PRESSURE'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> None
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">
                          {(node as any).osImage || (node as any).architecture || '—'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Workloads Tab */}
      {subTab === 'workloads' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-[11px] font-mono text-zinc-400">
                  <th className="py-3 px-4">Workload Name</th>
                  <th className="py-3 px-4">Kind</th>
                  <th className="py-3 px-4">Namespace</th>
                  <th className="py-3 px-4">Cluster</th>
                  <th className="py-3 px-4">Replicas</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Health</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {workloads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No deployments or workloads found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  workloads.map((w) => {
                    const cluster = safeClusters.find((c) => c.id === w.clusterId);
                    return (
                      <tr key={`${w.clusterId}-${w.namespace}-${w.name}`} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                          <Layers className="w-3.5 h-3.5 text-sky-400" />
                          {w.name}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{w.kind}</td>
                        <td className="py-3 px-4 font-mono text-zinc-300">{w.namespace || 'default'}</td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{cluster?.name || w.clusterId}</td>
                        <td className="py-3 px-4 font-mono text-zinc-200">
                          {(w as any).readyReplicas !== undefined && (w as any).replicas !== undefined
                            ? `${(w as any).readyReplicas} / ${(w as any).replicas}`
                            : (w as any).replicas !== undefined
                            ? `${(w as any).replicas}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">{w.status || '—'}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-medium ${
                              w.health === 'CRITICAL'
                                ? 'bg-red-500/10 text-red-400 border-red-500/30'
                                : w.health === 'WARNING'
                                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                : w.health === 'HEALTHY'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {w.health || 'UNKNOWN'}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pods Tab */}
      {subTab === 'pods' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-950/80 text-[11px] font-mono text-zinc-400">
                  <th className="py-3 px-4">Pod Name</th>
                  <th className="py-3 px-4">Namespace</th>
                  <th className="py-3 px-4">Cluster</th>
                  <th className="py-3 px-4">Status / Phase</th>
                  <th className="py-3 px-4">Restarts</th>
                  <th className="py-3 px-4">Node</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 font-sans">
                {pods.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500">
                      No pods found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  pods.map((pod) => {
                    const cluster = safeClusters.find((c) => c.id === pod.clusterId);
                    const isCrashing =
                      pod.status === 'CrashLoopBackOff' ||
                      pod.status === 'ImagePullBackOff' ||
                      pod.status === 'OOMKilled' ||
                      pod.health === 'CRITICAL';

                    return (
                      <tr key={`${pod.clusterId}-${pod.namespace}-${pod.name}`} className="hover:bg-zinc-800/40 transition-colors">
                        <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                          <Boxes className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="truncate max-w-[200px]">{pod.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">{pod.namespace || 'default'}</td>
                        <td className="py-3 px-4 font-mono text-zinc-400">{cluster?.name || pod.clusterId}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase font-medium ${
                              isCrashing
                                ? 'bg-red-500/10 text-red-400 border-red-500/30 font-bold'
                                : pod.status === 'Running'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {pod.status || 'Unknown'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-300">
                          {(pod as any).restartCount || 0}
                        </td>
                        <td className="py-3 px-4 font-mono text-zinc-400 truncate max-w-[140px]">
                          {(pod as any).nodeName || '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {onOpenLogs && (
                            <button
                              onClick={() =>
                                onOpenLogs(pod.clusterId, pod.namespace, pod.name)
                              }
                              className="text-sky-400 hover:text-sky-300 text-xs font-medium cursor-pointer"
                            >
                              Logs →
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Services Tab */}
      {subTab === 'services' && (
        <ServicesView
          services={services}
          resources={safeResources}
          clusters={safeClusters}
          loading={loading || loadingResources}
          onRefresh={() => {
            onRefresh();
            fetchResources();
          }}
          onSelectCluster={onSelectCluster}
          onSelectIncident={onSelectIncident}
          isEmbedded
        />
      )}
    </div>
  );
};
