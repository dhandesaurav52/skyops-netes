import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  HardDrive,
  Info,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Zap
} from 'lucide-react';
import React, { useMemo, useState, useEffect } from 'react';
import { api } from '../../api/client';
import { Cluster, Incident, KubernetesResource, OverviewMetrics } from '../../types/index';
import { ClusterStatusBadge, SeverityBadge, StatusBadge } from '../common/Badges';
import { Button, EmptyState } from '../common/UI';
import { ErrorBoundary } from '../common/ErrorBoundary';

interface OverviewViewProps {
  metrics: OverviewMetrics | null;
  clusters: Cluster[];
  recentIncidents: Incident[];
  recentActivity: Array<{
    id: string;
    type: string;
    timestamp: number;
    title: string;
    description: string;
    incidentId?: string;
    clusterId?: string;
  }>;
  onSelectIncident: (id: string) => void;
  onSelectCluster: (id: string) => void;
  onOpenAddCluster: () => void;
  onRefresh: () => void;
  loading: boolean;
}

const OverviewViewContent: React.FC<OverviewViewProps> = ({
  metrics,
  clusters = [],
  recentIncidents = [],
  recentActivity = [],
  onSelectIncident,
  onSelectCluster,
  onOpenAddCluster,
  onRefresh,
  loading
}) => {
  const [resources, setResources] = useState<KubernetesResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [clusterFilter, setClusterFilter] = useState<string>('all');
  const [activeIncidentTab, setActiveIncidentTab] = useState<'all' | 'critical' | 'high' | 'in_progress'>('all');
  const [inventorySearch, setInventorySearch] = useState('');

  // Fetch all resources across clusters to populate live node, pod, and workload telemetry
  useEffect(() => {
    let isMounted = true;
    const fetchResources = async () => {
      try {
        setLoadingResources(true);
        const data = await api.getAllResources();
        if (isMounted) {
          setResources(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.warn('OverviewView getAllResources notice:', err);
      } finally {
        if (isMounted) setLoadingResources(false);
      }
    };

    fetchResources();
    return () => {
      isMounted = false;
    };
  }, [clusters.length]);

  const safeClusters = Array.isArray(clusters) ? clusters : [];
  const safeIncidents = Array.isArray(recentIncidents) ? recentIncidents : [];
  const safeActivity = Array.isArray(recentActivity) ? recentActivity : [];
  const safeResources = Array.isArray(resources) ? resources : [];

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'Never';
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  // Open & active incidents
  const openIncidents = useMemo(() => {
    return safeIncidents.filter(
      (i) => i && (i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED')
    );
  }, [safeIncidents]);

  const criticalIncidents = useMemo(
    () => openIncidents.filter((i) => i.severity === 'CRITICAL'),
    [openIncidents]
  );
  const highIncidents = useMemo(
    () => openIncidents.filter((i) => i.severity === 'HIGH'),
    [openIncidents]
  );
  const inProgressIncidents = useMemo(
    () => openIncidents.filter((i) => i.status === 'IN_PROGRESS'),
    [openIncidents]
  );

  // Filtered incidents according to active tab
  const displayedIncidents = useMemo(() => {
    let list = openIncidents;
    if (activeIncidentTab === 'critical') list = criticalIncidents;
    else if (activeIncidentTab === 'high') list = highIncidents;
    else if (activeIncidentTab === 'in_progress') list = inProgressIncidents;

    if (clusterFilter !== 'all') {
      list = list.filter((i) => i.clusterId === clusterFilter);
    }
    return list;
  }, [openIncidents, criticalIncidents, highIncidents, inProgressIncidents, activeIncidentTab, clusterFilter]);

  // Nodes, Pods, Workloads breakdown
  const workloadKinds = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'];
  const allPods = useMemo(() => safeResources.filter((r) => r.kind === 'Pod'), [safeResources]);
  const allNodes = useMemo(() => safeResources.filter((r) => r.kind === 'Node'), [safeResources]);
  const allWorkloads = useMemo(
    () => safeResources.filter((r) => workloadKinds.includes(r.kind)),
    [safeResources]
  );

  // Filter by selected cluster if applicable
  const filteredPods = useMemo(() => {
    if (clusterFilter === 'all') return allPods;
    return allPods.filter((p) => p.clusterId === clusterFilter);
  }, [allPods, clusterFilter]);

  const filteredNodes = useMemo(() => {
    if (clusterFilter === 'all') return allNodes;
    return allNodes.filter((n) => n.clusterId === clusterFilter);
  }, [allNodes, clusterFilter]);

  const filteredWorkloads = useMemo(() => {
    if (clusterFilter === 'all') return allWorkloads;
    return allWorkloads.filter((w) => w.clusterId === clusterFilter);
  }, [allWorkloads, clusterFilter]);

  // Problematic resources
  const crashingPods = useMemo(() => {
    return filteredPods.filter(
      (p) =>
        p.health === 'CRITICAL' ||
        p.status === 'CrashLoopBackOff' ||
        p.status === 'ImagePullBackOff' ||
        p.status === 'ErrImagePull' ||
        p.status === 'OOMKilled' ||
        p.status === 'Failed' ||
        p.status === 'Error'
    );
  }, [filteredPods]);

  const degradedWorkloads = useMemo(() => {
    return filteredWorkloads.filter((w) => w.health === 'CRITICAL' || w.health === 'WARNING');
  }, [filteredWorkloads]);

  const pressureNodes = useMemo(() => {
    return filteredNodes.filter((n) => {
      const conds = Array.isArray(n.conditions) ? n.conditions : [];
      const hasPressure = conds.some(
        (c) =>
          (c.type === 'MemoryPressure' || c.type === 'DiskPressure' || c.type === 'PIDPressure') &&
          (c.status === 'True' || (c.status as any) === true)
      );
      const isNotReady = conds.some(
        (c) => c.type === 'Ready' && (c.status === 'False' || (c.status as any) === false)
      );
      return hasPressure || isNotReady || n.status !== 'Ready';
    });
  }, [filteredNodes]);

  // Overall Global Health Status computation
  const overallGlobalStatus = useMemo<'HEALTHY' | 'WARNING' | 'CRITICAL'>(() => {
    if (criticalIncidents.length > 0 || crashingPods.length > 0 || (metrics?.criticalClusters ?? 0) > 0) {
      return 'CRITICAL';
    }
    if (
      highIncidents.length > 0 ||
      degradedWorkloads.length > 0 ||
      pressureNodes.length > 0 ||
      (metrics?.warningClusters ?? 0) > 0
    ) {
      return 'WARNING';
    }
    return 'HEALTHY';
  }, [criticalIncidents, crashingPods, metrics, highIncidents, degradedWorkloads, pressureNodes]);

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-7xl mx-auto font-sans text-zinc-100">
      {/* 1. Global Command Center Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-sky-500/15 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-white font-mono flex items-center gap-2.5">
              <span className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 shadow-[0_0_12px_rgba(14,165,233,0.3)]">
                <Shield className="w-5 h-5" />
              </span>
              <span>Command Center</span>
            </h1>
            <span
              className={`px-2.5 py-1 rounded-md text-xs font-mono font-bold flex items-center gap-2 border shadow-xs ${
                overallGlobalStatus === 'HEALTHY'
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/40 shadow-[0_0_12px_rgba(52,211,153,0.25)]'
                  : overallGlobalStatus === 'WARNING'
                  ? 'bg-amber-950/80 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                  : 'bg-rose-950/90 text-rose-300 border-rose-500/50 shadow-[0_0_15px_rgba(244,63,94,0.35)] animate-pulse'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  overallGlobalStatus === 'HEALTHY'
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : overallGlobalStatus === 'WARNING'
                    ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]'
                    : 'bg-rose-400 shadow-[0_0_8px_#f43f5e]'
                }`}
              />
              MISSION: {overallGlobalStatus}
            </span>
          </div>
          <p className="text-xs font-mono text-zinc-400 mt-1.5 flex items-center gap-2">
            <span>Deterministic Kubernetes telemetry • Real-time node pressure radar • Incident remediation</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Cluster filter selector */}
          <div className="flex items-center gap-2 bg-[#081024] border border-sky-500/25 rounded-lg px-3 py-1.5 text-xs font-mono shadow-xs">
            <Server className="w-3.5 h-3.5 text-sky-400" />
            <select
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="bg-transparent text-zinc-200 focus:outline-none cursor-pointer pr-2"
              title="Filter overview by cluster"
            >
              <option value="all" className="bg-[#050b18] text-zinc-100">
                All Fleet Clusters ({safeClusters.length})
              </option>
              {safeClusters.map((c) => (
                <option key={c.id} value={c.id} className="bg-[#050b18] text-zinc-100">
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : 'text-zinc-400'}`} />}
            className="border-sky-500/20 hover:border-sky-500/40 bg-[#081024]/60 hover:bg-[#0c1836] text-zinc-300"
          >
            {loading ? 'Synchronizing...' : 'Refresh Fleet'}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenAddCluster}
            icon={<Plus className="w-3.5 h-3.5" />}
            className="bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 border-sky-400/40 shadow-[0_0_15px_-3px_rgba(14,165,233,0.4)]"
          >
            Connect Cluster
          </Button>
        </div>
      </div>

      {/* Prominent Empty State if NO clusters exist */}
      {safeClusters.length === 0 && (
        <div className="p-8 rounded-2xl storm-card text-center space-y-4 shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center mx-auto text-sky-400 shadow-[0_0_20px_-3px_rgba(14,165,233,0.3)]">
            <Server className="w-7 h-7" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-lg font-bold text-white font-mono">No Kubernetes Clusters Connected</h2>
            <p className="text-xs text-zinc-400 font-mono leading-relaxed">
              Connect your first Kubernetes cluster with the SkyOps Agent to begin streaming real-time telemetry, monitoring resource pressure, and orchestrating remediation.
            </p>
          </div>
          <div>
            <Button
              variant="primary"
              size="md"
              onClick={onOpenAddCluster}
              icon={<Plus className="w-4 h-4" />}
              className="font-mono text-xs px-6 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 shadow-[0_0_15px_-3px_rgba(14,165,233,0.4)]"
            >
              Connect Cluster
            </Button>
          </div>
        </div>
      )}

      {/* 2. Global Status & Vital Fleet KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Total Clusters */}
        <div className="p-4 rounded-xl storm-kpi-card flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Fleet Clusters</span>
            <Server className="w-3.5 h-3.5 text-sky-400/80" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-2">
            {metrics?.totalClusters ?? safeClusters.length}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1 flex items-center gap-1.5">
            <span className="text-emerald-400 font-medium">{metrics?.healthyClusters ?? 0} healthy</span>
            <span className="text-zinc-600">•</span>
            <span className="text-rose-400 font-medium">{metrics?.criticalClusters ?? 0} crit</span>
          </div>
        </div>

        {/* Nodes Online */}
        <div className="p-4 rounded-xl storm-kpi-card flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Cluster Nodes</span>
            <Cpu className="w-3.5 h-3.5 text-sky-400/80" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100 mt-2">
            {metrics?.totalNodes ?? allNodes.length}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1 flex items-center gap-1">
            {pressureNodes.length > 0 ? (
              <span className="text-amber-400 font-bold">{pressureNodes.length} with pressure</span>
            ) : (
              <span className="text-emerald-400">All nodes Ready</span>
            )}
          </div>
        </div>

        {/* Total Pods & Failing Count */}
        <div
          className={`p-4 rounded-xl flex flex-col justify-between ${
            crashingPods.length > 0
              ? 'storm-critical-card'
              : 'storm-kpi-card'
          }`}
        >
          <div className="text-[11px] font-mono uppercase tracking-wider flex items-center justify-between">
            <span className={crashingPods.length > 0 ? 'text-rose-300 font-bold' : 'text-zinc-400'}>Tracked Pods</span>
            <Boxes className={`w-3.5 h-3.5 ${crashingPods.length > 0 ? 'text-rose-400' : 'text-sky-400/80'}`} />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-2">
            {metrics?.totalPods ?? allPods.length}
          </div>
          <div className="text-[10px] font-mono mt-1">
            {crashingPods.length > 0 ? (
              <span className="text-rose-300 font-bold animate-pulse">{crashingPods.length} failing / crashing</span>
            ) : (
              <span className="text-emerald-400">0 crashing</span>
            )}
          </div>
        </div>

        {/* Workloads */}
        <div className="p-4 rounded-xl storm-kpi-card flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Controllers</span>
            <Layers className="w-3.5 h-3.5 text-sky-400/80" />
          </div>
          <div className="text-2xl font-bold font-mono text-zinc-100 mt-2">
            {metrics?.totalWorkloads ?? allWorkloads.length}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">
            {degradedWorkloads.length > 0 ? (
              <span className="text-amber-400 font-semibold">{degradedWorkloads.length} degraded</span>
            ) : (
              <span className="text-emerald-400">0 degraded</span>
            )}
          </div>
        </div>

        {/* Active Incidents */}
        <div
          className={`p-4 rounded-xl flex flex-col justify-between ${
            openIncidents.length > 0
              ? 'storm-ai-card'
              : 'storm-kpi-card'
          }`}
        >
          <div className="text-[11px] font-mono uppercase tracking-wider flex items-center justify-between text-purple-300">
            <span>Incident Radar</span>
            <AlertTriangle className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-2">
            {openIncidents.length}
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1 flex items-center gap-1.5">
            <span className="text-rose-400 font-medium">{criticalIncidents.length} crit</span>
            <span className="text-zinc-600">•</span>
            <span className="text-amber-400 font-medium">{highIncidents.length} high</span>
          </div>
        </div>

        {/* Agent Telemetry Pulse */}
        <div className="p-4 rounded-xl storm-kpi-card flex flex-col justify-between">
          <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Telemetry Link</span>
            <Activity className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-2 flex items-center gap-2">
            <span>{metrics?.connectedAgents ?? safeClusters.filter((c) => c.agentStatus === 'CONNECTED').length}</span>
            <span className="text-xs font-mono font-normal text-zinc-500">
              / {safeClusters.length}
            </span>
          </div>
          <div className="text-[10px] font-mono text-zinc-400 mt-1">
            {metrics?.offlineAgents ? (
              <span className="text-rose-400 font-medium">{metrics.offlineAgents} agent(s) offline</span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                Stream live
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Operational Attention Banner if Failing Resources or Critical Incidents */}
      {(crashingPods.length > 0 || degradedWorkloads.length > 0 || criticalIncidents.length > 0) && (
        <div className="p-4 rounded-xl storm-critical-card font-mono text-xs space-y-3">
          <div className="flex items-center justify-between border-b border-rose-500/30 pb-2.5">
            <div className="flex items-center gap-2 text-rose-300 font-bold">
              <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
              <span>
                OPERATIONAL STORM ALERT • {crashingPods.length} FAILING PODS •{' '}
                {criticalIncidents.length} CRITICAL INCIDENTS
              </span>
            </div>
            <span className="text-[11px] text-rose-300/80 hidden sm:inline">
              Automated telemetry correlation active
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {crashingPods.slice(0, 4).map((p) => (
              <div
                key={p.id}
                className="p-3 rounded-lg bg-[#070b16]/90 border border-rose-500/30 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="truncate">
                  <div className="font-bold text-rose-300 truncate">{p.name}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">
                    {p.namespace} • <span className="text-rose-400 font-semibold">{p.status}</span> •{' '}
                    {p.containers?.reduce((acc, c) => acc + (c.restartCount || 0), 0) || 0} restarts
                  </div>
                </div>
                {p.clusterId && (
                  <button
                    onClick={() => onSelectCluster(p.clusterId)}
                    className="px-2.5 py-1 rounded bg-rose-950/80 text-rose-200 border border-rose-700/60 text-[10px] hover:bg-rose-900 transition-colors shrink-0 cursor-pointer"
                  >
                    Inspect →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Two-Column Core Layout: Connected Clusters Fleet & Active Incidents Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Connected Clusters Fleet */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              <span>Fleet Matrix ({safeClusters.length})</span>
            </h2>
            <button
              onClick={onOpenAddCluster}
              className="text-xs font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>+ Connect New</span>
            </button>
          </div>

          {safeClusters.length === 0 ? (
            <EmptyState
              title="No Kubernetes clusters connected"
              description="Connect your first cluster to start streaming telemetry and detecting incidents."
              action={{ label: 'Connect Cluster', onClick: onOpenAddCluster }}
            />
          ) : (
            <div className="storm-card rounded-xl overflow-hidden divide-y divide-sky-500/10">
              {safeClusters.map((cluster) => {
                const clusterPods = allPods.filter((p) => p.clusterId === cluster.id);
                const clusterCrashing = clusterPods.filter(
                  (p) =>
                    p.health === 'CRITICAL' ||
                    p.status === 'CrashLoopBackOff' ||
                    p.status === 'ImagePullBackOff' ||
                    p.status === 'ErrImagePull' ||
                    p.status === 'OOMKilled'
                );
                const clusterIncidents = openIncidents.filter((i) => i.clusterId === cluster.id);

                return (
                  <div
                    key={cluster.id}
                    onClick={() => onSelectCluster(cluster.id)}
                    className="p-4 hover:bg-sky-950/25 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono text-xs group"
                  >
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-zinc-100 font-mono truncate group-hover:text-sky-300 transition-colors">
                          {cluster.name}
                        </span>
                        {cluster.isSimulated && (
                          <span className="text-[9px] font-mono bg-sky-950/60 text-sky-300 px-1.5 py-0.5 rounded border border-sky-800/60">
                            TEST
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-zinc-400 text-[11px]">
                        <span className="text-zinc-300 font-medium">
                          {cluster.k8sVersion
                            ? `K8s ${cluster.k8sVersion}`
                            : cluster.agentStatus === 'CONNECTED'
                            ? 'K8s (detecting)'
                            : 'K8s —'}
                        </span>
                        <span className="text-zinc-600">•</span>
                        <span>{cluster.nodeCount} Nodes</span>
                        <span className="text-zinc-600">•</span>
                        <span>{cluster.podCount} Pods</span>

                        {clusterCrashing.length > 0 && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-rose-400 font-bold animate-pulse">
                              {clusterCrashing.length} failing
                            </span>
                          </>
                        )}

                        {clusterIncidents.length > 0 && (
                          <>
                            <span className="text-zinc-600">•</span>
                            <span className="text-purple-400">
                              {clusterIncidents.length} incident(s)
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0 sm:self-center justify-between sm:justify-end">
                      <div className="text-left sm:text-right">
                        <ClusterStatusBadge status={cluster.status} agentStatus={cluster.agentStatus} />
                        <div className="text-[10px] font-mono text-zinc-500 mt-1">
                          Heartbeat: {formatTimeAgo(cluster.lastHeartbeat || cluster.lastHeartbeatAt)}
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-zinc-600 group-hover:text-sky-400 transition-colors" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Active Incident Triage Feed */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Incident Radar ({displayedIncidents.length})</span>
            </h2>
          </div>

          {/* Sub-tabs for incident filtering */}
          <div className="flex items-center gap-1 border-b border-sky-500/15 pb-2 text-xs font-mono">
            <button
              onClick={() => setActiveIncidentTab('all')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeIncidentTab === 'all'
                  ? 'bg-sky-950/80 text-sky-200 border border-sky-500/40 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({openIncidents.length})
            </button>
            <button
              onClick={() => setActiveIncidentTab('critical')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeIncidentTab === 'critical'
                  ? 'bg-rose-950/80 text-rose-300 font-bold border border-rose-500/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Critical ({criticalIncidents.length})
            </button>
            <button
              onClick={() => setActiveIncidentTab('high')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeIncidentTab === 'high'
                  ? 'bg-amber-950/80 text-amber-300 font-bold border border-amber-500/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              High ({highIncidents.length})
            </button>
            <button
              onClick={() => setActiveIncidentTab('in_progress')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                activeIncidentTab === 'in_progress'
                  ? 'bg-purple-950/80 text-purple-300 font-bold border border-purple-500/50'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              In Progress ({inProgressIncidents.length})
            </button>
          </div>

          {displayedIncidents.length === 0 ? (
            <div className="p-8 border border-sky-500/15 rounded-xl storm-card text-center font-mono text-xs">
              <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <div className="font-bold text-zinc-200">No active incidents in this filter</div>
              <div className="text-zinc-500 mt-1">
                All monitored workloads and pods are operating within safe baseline thresholds.
              </div>
            </div>
          ) : (
            <div className="storm-card rounded-xl overflow-hidden divide-y divide-sky-500/10 font-mono text-xs">
              {displayedIncidents.slice(0, 6).map((inc) => (
                <div
                  key={inc.id}
                  onClick={() => onSelectIncident(inc.id)}
                  className="p-3.5 hover:bg-sky-950/25 transition-all cursor-pointer space-y-2 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sky-400 group-hover:text-sky-300">{inc.id}</span>
                      <SeverityBadge severity={inc.severity} size="sm" />
                      <StatusBadge status={inc.status} size="sm" />
                    </div>
                    <span className="text-[10px] text-zinc-500">{formatTimeAgo(inc.lastSeenAt)}</span>
                  </div>

                  <div className="font-semibold text-zinc-200 truncate group-hover:text-white transition-colors">{inc.title}</div>

                  <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 truncate">
                    <span className="text-zinc-500">cluster:</span>
                    <span className="text-zinc-300">{inc.clusterName}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-zinc-500">ns:</span>
                    <span className="text-zinc-300">{inc.namespace}</span>
                    <span className="text-zinc-600">/</span>
                    <span className="text-zinc-300">{inc.resourceKind}/{inc.resourceName}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 5. Fleet Infrastructure Health & Pressure Breakdown */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-sky-500/15 pb-3">
          <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <span>Resource Pressure & Node Diagnostics</span>
          </h2>
          <div className="text-xs font-mono text-zinc-400">
            Evaluating {filteredNodes.length} nodes across {safeClusters.length} clusters
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
          {/* Node Health Card */}
          <div className="p-4 rounded-xl storm-card space-y-3">
            <div className="flex items-center justify-between text-zinc-300">
              <span className="font-bold text-sm flex items-center gap-2 text-white">
                <Cpu className="w-4 h-4 text-sky-400" />
                Node Availability
              </span>
              <span className="text-[11px] text-zinc-500">{filteredNodes.length} Total</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-400">
                <span>Ready Nodes:</span>
                <strong className="text-emerald-400">
                  {filteredNodes.filter((n) => n.status === 'Ready').length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Pressure / Degraded:</span>
                <strong className={pressureNodes.length > 0 ? 'text-amber-400' : 'text-zinc-400'}>
                  {pressureNodes.length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Memory / Disk / PID:</span>
                <span className="text-zinc-300">
                  {pressureNodes.length === 0 ? 'Nominal' : 'Pressure Detected'}
                </span>
              </div>
            </div>
          </div>

          {/* Pod Failure Diagnostics Card */}
          <div className="p-4 rounded-xl storm-card space-y-3">
            <div className="flex items-center justify-between text-zinc-300">
              <span className="font-bold text-sm flex items-center gap-2 text-white">
                <Boxes className="w-4 h-4 text-violet-400" />
                Pod Diagnostics
              </span>
              <span className="text-[11px] text-zinc-500">{filteredPods.length} Total</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-400">
                <span>Running / Healthy:</span>
                <strong className="text-emerald-400">
                  {filteredPods.filter((p) => p.status === 'Running' && p.health === 'HEALTHY').length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>CrashLoopBackOff:</span>
                <strong className={filteredPods.filter((p) => p.status === 'CrashLoopBackOff').length > 0 ? 'text-rose-400' : 'text-zinc-400'}>
                  {filteredPods.filter((p) => p.status === 'CrashLoopBackOff').length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>ImagePullBackOff / OOM:</span>
                <strong className={filteredPods.filter((p) => p.status === 'ImagePullBackOff' || p.status === 'OOMKilled').length > 0 ? 'text-amber-400' : 'text-zinc-400'}>
                  {filteredPods.filter((p) => p.status === 'ImagePullBackOff' || p.status === 'OOMKilled').length}
                </strong>
              </div>
            </div>
          </div>

          {/* Workload Controllers Card */}
          <div className="p-4 rounded-xl storm-card space-y-3">
            <div className="flex items-center justify-between text-zinc-300">
              <span className="font-bold text-sm flex items-center gap-2 text-white">
                <Layers className="w-4 h-4 text-emerald-400" />
                Controllers & Storage
              </span>
              <span className="text-[11px] text-zinc-500">{filteredWorkloads.length} Total</span>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-400">
                <span>Nominal Deployments:</span>
                <strong className="text-emerald-400">
                  {filteredWorkloads.filter((w) => w.health === 'HEALTHY').length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Degraded Replicas:</span>
                <strong className={degradedWorkloads.length > 0 ? 'text-rose-400' : 'text-zinc-400'}>
                  {degradedWorkloads.length}
                </strong>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>PVC Volumes:</span>
                <span className="text-zinc-300">
                  {safeResources.filter((r) => r.kind === 'PersistentVolumeClaim').length} Tracked
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 6. Recent Audit & Activity Stream */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center gap-2">
          <Activity className="w-4 h-4 text-sky-400" />
          <span>Operational Audit & Incident Event Stream</span>
        </h2>

        <div className="storm-card rounded-xl p-4">
          {safeActivity.length === 0 ? (
            <div className="text-xs font-mono text-zinc-500 py-2">
              No audit events recorded in this session.
            </div>
          ) : (
            <div className="space-y-3 font-mono text-xs">
              {safeActivity.slice(0, 8).map((act) => (
                <div
                  key={act.id}
                  className="flex items-start gap-3 text-zinc-300 pb-2 border-b border-sky-500/10 last:border-0"
                >
                  <span className="text-zinc-500 text-[11px] shrink-0">{formatTimeAgo(act.timestamp)}</span>
                  <span className="px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-300 text-[10px] shrink-0 border border-sky-800/60">
                    {act.type}
                  </span>
                  <span className="text-zinc-300 flex-1">{act.description}</span>
                  {act.incidentId && (
                    <button
                      onClick={() => onSelectIncident(act.incidentId!)}
                      className="text-sky-400 hover:text-sky-300 shrink-0 text-[11px] font-bold cursor-pointer"
                    >
                      {act.incidentId} →
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const OverviewView: React.FC<OverviewViewProps> = (props) => {
  return (
    <ErrorBoundary
      fallbackTitle="Command Center Error"
      fallbackMessage="An unexpected error occurred while rendering the Global Command Center overview. You can retry or refresh the page."
      onReset={props.onRefresh}
    >
      <OverviewViewContent {...props} />
    </ErrorBoundary>
  );
};
