import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  Filter,
  Flame,
  GitCommit,
  GitCompare,
  HardDrive,
  Info,
  Layers,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Terminal,
  Trash2,
  Workflow,
  Zap,
  Tag,
  KeyRound,
  FileCode,
  Radio
} from 'lucide-react';
import { api } from '../../api/client';
import {
  Cluster,
  Incident,
  KubernetesResource,
  RemediationAction,
  DeploymentRecord
} from '../../types/index';
import {
  ClusterStatusBadge,
  PodPhaseBadge,
  ResourceHealthBadge,
  WorkloadKindBadge
} from '../common/Badges';
import { Button, EmptyState, LoadingState } from '../common/UI';
import { ResourceDetailPanel } from './ResourceDetailPanel';
import { OperationActionModal, OperationActionType } from './OperationActionModal';
import { ReleaseDiffModal } from './ReleaseDiffModal';
import { ActivityDetailModal } from './ActivityDetailModal';

interface OperationsWorkspaceViewProps {
  clusters: Cluster[];
  initialClusterId?: string | null;
  onSelectCluster?: (clusterId: string) => void;
  onSelectIncident?: (incidentId: string) => void;
  onOpenAddCluster?: () => void;
  onRefreshGlobal?: () => void;
}

type OperationsCategoryTab =
  | 'workloads'
  | 'pods'
  | 'services'
  | 'nodes'
  | 'config'
  | 'releases'
  | 'activity';

export const OperationsWorkspaceView: React.FC<OperationsWorkspaceViewProps> = ({
  clusters = [],
  initialClusterId,
  onSelectCluster,
  onSelectIncident,
  onOpenAddCluster,
  onRefreshGlobal
}) => {
  const safeClusters = Array.isArray(clusters) ? clusters : [];

  // Active Cluster Selection
  const [selectedClusterId, setSelectedClusterId] = useState<string>(
    initialClusterId || (safeClusters.length > 0 ? safeClusters[0].id : '')
  );

  useEffect(() => {
    if (initialClusterId) {
      setSelectedClusterId(initialClusterId);
    } else if (!selectedClusterId && safeClusters.length > 0) {
      setSelectedClusterId(safeClusters[0].id);
    }
  }, [initialClusterId, safeClusters]);

  const activeCluster = useMemo(() => {
    if (!selectedClusterId) {
      return safeClusters.length > 0 ? safeClusters[0] : null;
    }
    return safeClusters.find((c) => c.id === selectedClusterId) || null;
  }, [safeClusters, selectedClusterId]);

  // Data states
  const [resources, setResources] = useState<KubernetesResource[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [operations, setOperations] = useState<RemediationAction[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Tabs
  const [categoryTab, setCategoryTab] = useState<OperationsCategoryTab>('workloads');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | 'HEALTHY' | 'CRITICAL' | 'WARNING'>('all');

  // Interactive panels and modals
  const [selectedResource, setSelectedResource] = useState<KubernetesResource | null>(null);
  const [activeActionModal, setActiveActionModal] = useState<{
    resource: KubernetesResource;
    actionType: OperationActionType;
  } | null>(null);
  const [diffDeployment, setDiffDeployment] = useState<KubernetesResource | null>(null);
  const [selectedActivityOp, setSelectedActivityOp] = useState<RemediationAction | null>(null);

  // In-flight cluster request sequence tracking to prevent race conditions and cross-cluster overwrites
  const activeClusterIdRef = useRef<string>(activeCluster?.id || '');
  activeClusterIdRef.current = activeCluster?.id || '';

  // Load cluster data
  const fetchClusterOperationsData = async (isBackground = false) => {
    const targetClusterId = activeCluster?.id;
    if (!targetClusterId) return;

    if (!isBackground) {
      // Clear stale resource data immediately when loading a different cluster
      setResources([]);
      setIncidents([]);
      setOperations([]);
      setDeployments([]);
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const [resData, incData, opsData, depsData] = await Promise.all([
        api.getClusterResources(targetClusterId).catch(() => [] as KubernetesResource[]),
        api.getIncidents({ clusterId: targetClusterId }).catch(() => [] as Incident[]),
        api.getClusterOperations(targetClusterId).catch(() => ({ operations: [] })),
        api.getDeployments(targetClusterId).catch(() => ({ deployments: [] }))
      ]);

      // Guard: prevent earlier in-flight response from overwriting newly selected cluster
      if (activeClusterIdRef.current !== targetClusterId) {
        return;
      }

      setResources(Array.isArray(resData) ? resData : []);
      setIncidents(Array.isArray(incData) ? incData : []);
      setOperations(Array.isArray(opsData?.operations) ? opsData.operations : []);
      setDeployments(Array.isArray(depsData?.deployments) ? depsData.deployments : []);
    } catch (err) {
      console.warn('Operations workspace data fetch notice:', err);
    } finally {
      if (activeClusterIdRef.current === targetClusterId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchClusterOperationsData();
  }, [activeCluster?.id]);

  // Real cluster agent connection state (never true for simulated clusters)
  const isRealAgentConnected = useMemo(() => {
    if (!activeCluster || activeCluster.isSimulated) return false;
    const now = Date.now();
    const hasFreshHeartbeat = activeCluster.lastHeartbeat ? now - activeCluster.lastHeartbeat < 5 * 60 * 1000 : false;
    const hasFreshSeen = activeCluster.lastSeenAt ? now - activeCluster.lastSeenAt < 5 * 60 * 1000 : false;
    return (
      (activeCluster.agentStatus === 'CONNECTED' ||
        activeCluster.connectionState === 'connected' ||
        activeCluster.connectionStatus === 'connected') &&
      (hasFreshHeartbeat || hasFreshSeen)
    );
  }, [activeCluster]);

  // Operational readiness helper
  const isConnected = useMemo(() => {
    if (!activeCluster) return false;
    if (activeCluster.isSimulated) return true;
    return isRealAgentConnected;
  }, [activeCluster, isRealAgentConnected]);

  const telemetryAge = useMemo(() => {
    if (!activeCluster) return 'No data';
    const lastSeen = activeCluster.lastHeartbeat || activeCluster.lastSeenAt || activeCluster.updatedAt || activeCluster.createdAt;
    const diffSec = Math.max(0, Math.floor((Date.now() - lastSeen) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return `${Math.floor(diffSec / 3600)}h ago`;
  }, [activeCluster]);

  // Extract namespaces
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const r of resources) {
      if (r.namespace) set.add(r.namespace);
    }
    return Array.from(set).sort();
  }, [resources]);

  // Filter resources
  const filteredResources = useMemo(() => {
    return resources.filter((r) => {
      if (selectedNamespace !== 'all' && r.namespace !== selectedNamespace) return false;
      if (healthFilter !== 'all' && r.health !== healthFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = r.name.toLowerCase().includes(q);
        const matchNs = (r.namespace || '').toLowerCase().includes(q);
        const matchKind = r.kind.toLowerCase().includes(q);
        const matchStatus = (r.status || '').toLowerCase().includes(q);
        return matchName || matchNs || matchKind || matchStatus;
      }
      return true;
    });
  }, [resources, selectedNamespace, healthFilter, searchQuery]);

  // Category partitions
  const workloads = useMemo(() => {
    return filteredResources.filter((r) =>
      ['Deployment', 'StatefulSet', 'DaemonSet', 'Rollout', 'Job', 'CronJob'].includes(r.kind)
    );
  }, [filteredResources]);

  const pods = useMemo(() => {
    return filteredResources.filter((r) => r.kind === 'Pod');
  }, [filteredResources]);

  const services = useMemo(() => {
    return filteredResources.filter((r) => ['Service', 'Ingress', 'EndpointSlice'].includes(r.kind));
  }, [filteredResources]);

  const nodes = useMemo(() => {
    return filteredResources.filter((r) => r.kind === 'Node');
  }, [filteredResources]);

  const configs = useMemo(() => {
    return filteredResources.filter((r) => ['ConfigMap', 'Secret', 'Namespace'].includes(r.kind));
  }, [filteredResources]);

  // Health counts
  const degradedWorkloadsCount = useMemo(() => {
    return workloads.filter((w) => w.health === 'CRITICAL' || w.health === 'WARNING').length;
  }, [workloads]);

  const failingPodsCount = useMemo(() => {
    return pods.filter(
      (p) =>
        p.health === 'CRITICAL' ||
        p.status?.includes('CrashLoop') ||
        p.status?.includes('ImagePull') ||
        p.status?.includes('OOM')
    ).length;
  }, [pods]);

    // Operation execution handler
  const handleOperationSuccess = (action: RemediationAction, updatedResource?: KubernetesResource) => {
    // Add to operations list
    setOperations((prev) => [action, ...prev.filter((a) => a.id !== action.id)]);
    // Refresh resources
    if (updatedResource) {
      setResources((prev) =>
        prev.map((r) => (r.id === updatedResource.id ? { ...r, ...updatedResource } : r))
      );
    }
    fetchClusterOperationsData(true);
  };

  // Auto-refresh when any operation is in-flight (PENDING, EXECUTING, VERIFYING, ROLLING_BACK)
  useEffect(() => {
    const hasInFlight = operations.some((o) =>
      ['PENDING', 'EXECUTING', 'VERIFYING', 'ROLLING_BACK', 'DELIVERED'].includes(o.status)
    );
    if (!hasInFlight) return;
    const interval = setInterval(() => {
      fetchClusterOperationsData(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [operations, activeCluster?.id]);

  if (!activeCluster) {
    return (
      <div className="p-8 max-w-7xl mx-auto font-sans text-zinc-100">
        <EmptyState
          title="No Kubernetes Cluster Connected"
          description="Connect a Kubernetes cluster to access the unified operations workspace, inspect workloads, and execute authorized operations."
          action={onOpenAddCluster ? { label: 'Connect Cluster', onClick: onOpenAddCluster } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="p-5 sm:p-7 max-w-7xl mx-auto space-y-6 font-sans text-zinc-100">
      {/* 1. CLUSTER CONTEXT & TELEMETRY STATUS BAR */}
      <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800/90 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Cluster Selector & Identity */}
          <div className="flex items-center gap-3.5 flex-wrap">
            <div className="relative">
              <select
                value={activeCluster.id}
                onChange={(e) => {
                  setSelectedClusterId(e.target.value);
                  if (onSelectCluster) onSelectCluster(e.target.value);
                }}
                className="appearance-none pl-3.5 pr-8 py-2 bg-zinc-950 border border-zinc-700/80 rounded-xl text-xs font-semibold text-zinc-100 focus:outline-none focus:border-sky-500 cursor-pointer shadow-inner"
              >
                {safeClusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.environment ? `(${c.environment})` : ''}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* Connection Status Pill */}
            {activeCluster.isSimulated ? (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border bg-amber-950/60 border-amber-800/70 text-amber-300">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Simulated Cluster (Demo Mode)</span>
              </div>
            ) : (
              <div
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                  isRealAgentConnected
                    ? 'bg-emerald-950/60 border-emerald-800/70 text-emerald-300'
                    : 'bg-rose-950/60 border-rose-800/70 text-rose-300'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRealAgentConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                  }`}
                />
                <span>{isRealAgentConnected ? 'Live Agent Connected' : 'Agent Disconnected'}</span>
              </div>
            )}

            {/* Telemetry Freshness */}
            <div className="flex items-center gap-1 text-xs text-zinc-400 bg-zinc-950/60 px-2.5 py-1 rounded-lg border border-zinc-800">
              <Clock className="w-3.5 h-3.5 text-zinc-500" />
              <span>Telemetry: {telemetryAge}</span>
            </div>

            {/* K8s Version */}
            <div className="text-xs text-zinc-400 bg-zinc-950/60 px-2.5 py-1 rounded-lg border border-zinc-800 font-mono">
              K8s: <span className="text-zinc-200">{activeCluster.k8sVersion || 'v1.35.1'}</span>
            </div>

            {/* RBAC Permission Tier Pill */}
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                activeCluster.isSimulated
                  ? 'bg-sky-950/60 border-sky-800/70 text-sky-300'
                  : activeCluster.permissionTier === 'admin' || activeCluster.permissionTier === 'platform-admin'
                  ? 'bg-purple-950/60 border-purple-800/70 text-purple-300'
                  : activeCluster.permissionTier === 'operator'
                  ? 'bg-emerald-950/60 border-emerald-800/70 text-emerald-300'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
              title={
                activeCluster.isSimulated
                  ? 'Simulated Cluster Demo Mode'
                  : `Agent RBAC Tier: ${activeCluster.permissionTier || 'observer'}`
              }
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="capitalize">
                {activeCluster.isSimulated
                  ? 'Simulated'
                  : `RBAC: ${activeCluster.permissionTier || 'observer'}`}
              </span>
            </div>
          </div>

          {/* Quick Refresh Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fetchClusterOperationsData(true)}
              disabled={loading || refreshing}
              className="px-3 py-1.5 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-950 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
              title="Refresh live cluster telemetry"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>
        </div>

        {/* Real Cluster Resource Counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-zinc-800/70 text-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-950/50 border border-sky-800/60 text-sky-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <span className="text-zinc-400 block text-[11px]">Workloads</span>
              <span className="font-semibold text-zinc-100">
                {workloads.length} total {degradedWorkloadsCount > 0 && <span className="text-rose-400">({degradedWorkloadsCount} degraded)</span>}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-950/50 border border-indigo-800/60 text-indigo-400">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <span className="text-zinc-400 block text-[11px]">Active Pods</span>
              <span className="font-semibold text-zinc-100">
                {pods.length} pods {failingPodsCount > 0 && <span className="text-rose-400">({failingPodsCount} failing)</span>}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-teal-950/50 border border-teal-800/60 text-teal-400">
              <Network className="w-4 h-4" />
            </div>
            <div>
              <span className="text-zinc-400 block text-[11px]">Services & Endpoints</span>
              <span className="font-semibold text-zinc-100">{services.length} services</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-950/50 border border-purple-800/60 text-purple-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <span className="text-zinc-400 block text-[11px]">Worker Nodes</span>
              <span className="font-semibold text-zinc-100">{nodes.length} nodes</span>
            </div>
          </div>
        </div>

        {/* Offline Disclaimer Banner when disconnected */}
        {!isConnected && !activeCluster.isSimulated && (
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Showing Last-Known Cached Snapshot:</span> SkyOps agent is currently disconnected. Live mutations requiring agent connectivity (scale, restart, delete) are safely disabled until reconnect.
            </div>
          </div>
        )}
      </div>

      {/* 2. CATEGORY TABS & FILTER TOOLBAR */}
      <div className="space-y-4">
        {/* Navigation Category Tabs */}
        <div className="flex items-center gap-1.5 border-b border-zinc-800 pb-px overflow-x-auto">
          <button
            onClick={() => setCategoryTab('workloads')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'workloads'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Workloads</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {workloads.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('pods')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'pods'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            <span>Pods</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {pods.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('services')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'services'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Services & Networking</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {services.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('nodes')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'nodes'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Nodes</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {nodes.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('config')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'config'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Namespaces & Config</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {configs.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('releases')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'releases'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Releases & Rollbacks</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {deployments.length}
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('activity')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition-all cursor-pointer flex items-center gap-2 ${
              categoryTab === 'activity'
                ? 'bg-zinc-900 border-t border-x border-zinc-800 text-sky-400 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Operational Activity</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {operations.length}
            </span>
          </button>
        </div>

        {/* Global Filter Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search resources, containers, images, labels..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Namespace Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-zinc-400 text-xs hidden md:inline">Namespace:</span>
              <select
                value={selectedNamespace}
                onChange={(e) => setSelectedNamespace(e.target.value)}
                className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="all">All Namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Health Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400 text-xs hidden md:inline">Health:</span>
            <div className="flex items-center rounded-xl bg-zinc-900 border border-zinc-800 p-0.5">
              {(['all', 'HEALTHY', 'CRITICAL', 'WARNING'] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHealthFilter(h)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    healthFilter === h
                      ? 'bg-zinc-800 text-white'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {h === 'all' ? 'All' : h}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 3. CATEGORY TABLES & OPERATIONAL CONTENT */}
      {loading ? (
        <LoadingState message="Loading cluster resource telemetry..." />
      ) : (
        <div className="space-y-4">
          {/* TAB 1: WORKLOADS */}
          {categoryTab === 'workloads' && (
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
              {workloads.length === 0 ? (
                <EmptyState
                  title="No Workloads Found"
                  description="No deployments, statefulsets, daemonsets, or jobs match current filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-4">Workload</th>
                        <th className="py-3 px-4">Kind</th>
                        <th className="py-3 px-4">Namespace</th>
                        <th className="py-3 px-4">Health / Status</th>
                        <th className="py-3 px-4">Replicas</th>
                        <th className="py-3 px-4">Container Image</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {workloads.map((w) => {
                        const associatedInc = incidents.find(
                          (i) =>
                            i.clusterId === activeCluster.id &&
                            i.resourceName?.toLowerCase() === w.name.toLowerCase() &&
                            (i.status === 'OPEN' || i.status === 'IN_PROGRESS')
                        );

                        const currentReplicas =
                          (w.specSummary as any)?.replicas ?? w.specReplicas ?? 1;
                        const readyReplicas =
                          (w.statusSummary as any)?.readyReplicas ?? w.readyReplicas ?? (w.status === 'Running' ? currentReplicas : 0);

                        const img =
                          w.containers?.[0]?.image ||
                          (w.specSummary as any)?.template?.spec?.containers?.[0]?.image ||
                          '—';

                        return (
                          <tr
                            key={w.id}
                            className="hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                            onClick={() => setSelectedResource(w)}
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                              <span>{w.name}</span>
                              {associatedInc && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 border border-rose-800 text-rose-300 font-mono">
                                  {associatedInc.severity}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <WorkloadKindBadge kind={w.kind} />
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">
                              {w.namespace || 'default'}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <ResourceHealthBadge health={w.health} />
                                <span className="text-[11px] font-mono text-zinc-400 truncate max-w-[120px]">
                                  {w.status || 'Active'}
                                </span>
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-200">
                              {readyReplicas} / {currentReplicas}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400 truncate max-w-[180px]" title={img}>
                              {img}
                            </td>
                            <td
                              className="py-3 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setActiveActionModal({ resource: w, actionType: 'RolloutRestart' })}
                                  disabled={!isConnected && !activeCluster.isSimulated}
                                  className="p-1.5 text-zinc-400 hover:text-sky-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                  title="Rollout Restart"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>

                                {w.kind === 'Deployment' && (
                                  <>
                                    <button
                                      onClick={() => setActiveActionModal({ resource: w, actionType: 'ScaleDeployment' })}
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title="Scale Replicas"
                                    >
                                      <Sliders className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setDiffDeployment(w)}
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title="Rollback Deployment"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}

                                {w.kind === 'StatefulSet' && (
                                  <button
                                    onClick={() => setActiveActionModal({ resource: w, actionType: 'ScaleWorkload' })}
                                    disabled={!isConnected && !activeCluster.isSimulated}
                                    className="p-1.5 text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                    title="Scale StatefulSet Replicas"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                {w.kind === 'CronJob' && (
                                  <>
                                    <button
                                      onClick={() => setActiveActionModal({ resource: w, actionType: 'TriggerCronJob' })}
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-sky-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title="Trigger Immediate Run"
                                    >
                                      <Zap className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() =>
                                        setActiveActionModal({
                                          resource: w,
                                          actionType: (w.specSummary as any)?.suspend ? 'ResumeCronJob' : 'SuspendCronJob'
                                        })
                                      }
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-amber-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title={(w.specSummary as any)?.suspend ? 'Resume Schedule' : 'Suspend Schedule'}
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}

                                {w.kind === 'Job' && (
                                  <>
                                    <button
                                      onClick={() => setActiveActionModal({ resource: w, actionType: 'RerunJob' })}
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-indigo-300 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title="Rerun Batch Job"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setActiveActionModal({ resource: w, actionType: 'DeleteJob' })}
                                      disabled={!isConnected && !activeCluster.isSimulated}
                                      className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                      title="Delete Job"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}

                                <button
                                  onClick={() => setSelectedResource(w)}
                                  className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
                                >
                                  Inspect
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: PODS */}
          {categoryTab === 'pods' && (
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
              {pods.length === 0 ? (
                <EmptyState
                  title="No Pods Found"
                  description="No running or pending pods match current filters."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-4">Pod Name</th>
                        <th className="py-3 px-4">Namespace</th>
                        <th className="py-3 px-4">Node</th>
                        <th className="py-3 px-4">Phase / Health</th>
                        <th className="py-3 px-4">Restarts</th>
                        <th className="py-3 px-4">Containers</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {pods.map((p) => {
                        const readyCount = (p.containers || []).filter((c) => c.ready).length;
                        const totalCount = p.containers?.length || 1;

                        return (
                          <tr
                            key={p.id}
                            className="hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                            onClick={() => setSelectedResource(p)}
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                              <span>{p.name}</span>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">{p.namespace}</td>
                            <td className="py-3 px-4 font-mono text-zinc-400">{p.nodeName || '—'}</td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-2">
                                <PodPhaseBadge phase={p.status || 'Running'} />
                                <ResourceHealthBadge health={p.health} />
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono">
                              <span className={p.restartCount && p.restartCount > 5 ? 'text-amber-400 font-bold' : 'text-zinc-300'}>
                                {p.restartCount ?? 0}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">
                              {readyCount} / {totalCount} ready
                            </td>
                            <td
                              className="py-3 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() => setActiveActionModal({ resource: p, actionType: 'DeletePod' })}
                                  disabled={!isConnected && !activeCluster.isSimulated}
                                  className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                                  title="Delete Pod"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setSelectedResource(p)}
                                  className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
                                >
                                  Inspect & Logs
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SERVICES & NETWORKING */}
          {categoryTab === 'services' && (
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
              {services.length === 0 ? (
                <EmptyState
                  title="No Networking Services"
                  description="No ClusterIP, NodePort, LoadBalancer services found."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-4">Service</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Namespace</th>
                        <th className="py-3 px-4">Cluster IP</th>
                        <th className="py-3 px-4">Ports</th>
                        <th className="py-3 px-4">Endpoints</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {services.map((s) => {
                        const sType = (s.specSummary as any)?.type || 'ClusterIP';
                        const cIp = (s.specSummary as any)?.clusterIP || '—';
                        const ports = (s.specSummary as any)?.ports || [];
                        const portsStr = ports.map((p: any) => `${p.port}/${p.protocol || 'TCP'}`).join(', ') || '—';
                        const endpoints = (s.statusSummary as any)?.readyEndpoints ?? 'Active';

                        return (
                          <tr
                            key={s.id}
                            className="hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                            onClick={() => setSelectedResource(s)}
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                              <span>{s.name}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-zinc-800 font-mono text-zinc-300">
                                {sType}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">{s.namespace}</td>
                            <td className="py-3 px-4 font-mono text-zinc-300">{cIp}</td>
                            <td className="py-3 px-4 font-mono text-zinc-400">{portsStr}</td>
                            <td className="py-3 px-4 font-mono text-emerald-400">{endpoints}</td>
                            <td
                              className="py-3 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => setSelectedResource(s)}
                                className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: NODES */}
          {categoryTab === 'nodes' && (
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
              {nodes.length === 0 ? (
                <EmptyState
                  title="No Cluster Nodes"
                  description="No worker or control-plane nodes recorded in cluster telemetry."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-4">Node Name</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Scheduling</th>
                        <th className="py-3 px-4">CPU Usage</th>
                        <th className="py-3 px-4">Memory Usage</th>
                        <th className="py-3 px-4">Kubelet</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {nodes.map((n) => {
                        const isCordoned = Boolean((n.specSummary as any)?.unschedulable);
                        const isControl = n.name.includes('control') || n.labels?.['node-role.kubernetes.io/control-plane'];
                        const role = isControl ? 'Control-Plane' : 'Worker';

                        return (
                          <tr
                            key={n.id}
                            className="hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                            onClick={() => setSelectedResource(n)}
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100">{n.name}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-300">
                                {role}
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-emerald-400 font-semibold flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                <span>{n.status || 'Ready'}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4">
                              {isCordoned ? (
                                <span className="px-2 py-0.5 rounded text-[10px] bg-amber-950 border border-amber-800 text-amber-300">
                                  SchedulingDisabled
                                </span>
                              ) : (
                                <span className="text-zinc-400">Schedulable</span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">
                              {n.cpuUsage ? `${n.cpuUsage}%` : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">
                              {n.memoryUsage ? `${n.memoryUsage}%` : '—'}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">
                              {(n.specSummary as any)?.kubeletVersion || 'v1.35.1'}
                            </td>
                            <td
                              className="py-3 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  onClick={() =>
                                    setActiveActionModal({
                                      resource: n,
                                      actionType: isCordoned ? 'UncordonNode' : 'CordonNode'
                                    })
                                  }
                                  disabled={!isConnected && !activeCluster.isSimulated}
                                  className="px-2 py-1 text-[11px] font-medium text-amber-300 bg-amber-950/60 border border-amber-800/60 rounded-md hover:bg-amber-900/60 transition-colors cursor-pointer disabled:opacity-40"
                                >
                                  {isCordoned ? 'Uncordon' : 'Cordon'}
                                </button>
                                <button
                                  onClick={() =>
                                    setActiveActionModal({
                                      resource: n,
                                      actionType: 'DrainNode'
                                    })
                                  }
                                  disabled={!isConnected && !activeCluster.isSimulated}
                                  className="px-2 py-1 text-[11px] font-medium text-rose-300 bg-rose-950/60 border border-rose-800/60 rounded-md hover:bg-rose-900/60 transition-colors cursor-pointer disabled:opacity-40"
                                  title="Safely evict workloads and drain node"
                                >
                                  Drain
                                </button>
                                <button
                                  onClick={() => setSelectedResource(n)}
                                  className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
                                >
                                  Inspect
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: NAMESPACES & CONFIG */}
          {categoryTab === 'config' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Security Guarantee:</strong> SkyOps displays resource metadata and data keys only. Secret payload values are strictly withheld and never transmitted to the client.
                </span>
              </div>

              <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
                {configs.length === 0 ? (
                  <EmptyState
                    title="No Configurations Found"
                    description="No namespaces, configmaps, or secrets match current filters."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-zinc-300">
                      <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                        <tr>
                          <th className="py-3 px-4">Resource Name</th>
                          <th className="py-3 px-4">Kind</th>
                          <th className="py-3 px-4">Namespace</th>
                          <th className="py-3 px-4">Data Keys Recorded</th>
                          <th className="py-3 px-4">Status</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-sans">
                        {configs.map((c) => (
                          <tr
                            key={c.id}
                            className="hover:bg-zinc-800/30 transition-colors group cursor-pointer"
                            onClick={() => setSelectedResource(c)}
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                              {c.kind === 'Secret' && <KeyRound className="w-3.5 h-3.5 text-amber-400" />}
                              {c.kind === 'ConfigMap' && <FileCode className="w-3.5 h-3.5 text-sky-400" />}
                              <span>{c.name}</span>
                            </td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-zinc-800 text-zinc-300">
                                {c.kind}
                              </span>
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">
                              {c.namespace || 'Cluster-Scoped'}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-400">
                              {c.dataKeys && c.dataKeys.length > 0 ? (
                                <span>{c.dataKeys.length} keys ({c.dataKeys.slice(0, 2).join(', ')}{c.dataKeys.length > 2 ? '...' : ''})</span>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="py-3 px-4">
                              <span className="text-emerald-400 font-medium">Active</span>
                            </td>
                            <td
                              className="py-3 px-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => setSelectedResource(c)}
                                className="px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors cursor-pointer"
                              >
                                Inspect Keys
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: RELEASES & ROLLBACKS */}
          {categoryTab === 'releases' && (
            <div className="space-y-4">
              <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
                {deployments.length === 0 ? (
                  <EmptyState
                    title="No Deployment Rollout Records"
                    description="No recorded deployment revisions or pre-deployment gate evaluations for this cluster."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-zinc-300">
                      <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                        <tr>
                          <th className="py-3 px-4">Workload Release</th>
                          <th className="py-3 px-4">Namespace</th>
                          <th className="py-3 px-4">Revision</th>
                          <th className="py-3 px-4">Image Tag</th>
                          <th className="py-3 px-4">Health Score</th>
                          <th className="py-3 px-4">Timestamp</th>
                          <th className="py-3 px-4 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60 font-sans">
                        {deployments.map((d) => {
                          const targetWorkload = workloads.find(
                            (w) => w.name.toLowerCase() === d.name.toLowerCase()
                          );

                          return (
                            <tr key={d.id} className="hover:bg-zinc-800/30 transition-colors group">
                              <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                                <GitCommit className="w-3.5 h-3.5 text-sky-400" />
                                <span>{d.name}</span>
                              </td>
                              <td className="py-3 px-4 font-mono text-zinc-400">{d.namespace}</td>
                              <td className="py-3 px-4 font-mono text-sky-400 font-bold">rev {d.revision}</td>
                              <td className="py-3 px-4 font-mono text-zinc-300 truncate max-w-[200px]" title={d.image}>
                                {d.image}
                              </td>
                              <td className="py-3 px-4">
                                <span className={`font-mono font-semibold ${d.healthScore && d.healthScore < 90 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                  {d.healthScore ?? 100}%
                                </span>
                              </td>
                              <td className="py-3 px-4 font-mono text-zinc-400">
                                {new Date(d.startedAt).toLocaleTimeString()}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <button
                                  onClick={() => {
                                    if (targetWorkload) setDiffDeployment(targetWorkload);
                                  }}
                                  disabled={!targetWorkload || (!isConnected && !activeCluster.isSimulated)}
                                  className="px-2.5 py-1 text-[11px] font-semibold text-amber-300 bg-amber-950/60 border border-amber-800/60 rounded-md hover:bg-amber-900/60 transition-colors cursor-pointer disabled:opacity-40 inline-flex items-center gap-1.5"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Plan Rollback</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: ACTIVITY LOG */}
          {categoryTab === 'activity' && (
            <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/40">
              {operations.length === 0 ? (
                <EmptyState
                  title="No Cluster Operations Recorded"
                  description="Operations executed from this workspace (rollout restarts, scaling, pod deletions, rollbacks) will be tracked here in real-time."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                      <tr>
                        <th className="py-3 px-4">Operation</th>
                        <th className="py-3 px-4">Target Resource</th>
                        <th className="py-3 px-4">Actor</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Outcome / Message</th>
                        <th className="py-3 px-4 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-sans">
                      {operations.map((op) => {
                        const isSuccess = op.status === 'SUCCEEDED' || op.status === 'VERIFIED' || op.status === 'VERIFIED_RESOLVED' || op.status === 'EXECUTED';

                        return (
                          <tr
                            key={op.id}
                            onClick={() => setSelectedActivityOp(op)}
                            className="hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                          >
                            <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                              <Zap className="w-3.5 h-3.5 text-sky-400 group-hover:text-sky-300 transition-colors" />
                              <span className="group-hover:underline underline-offset-2">{op.actionType}</span>
                              {(op.isSimulated || (op as any).executionMode === 'SIMULATED') && (
                                <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-semibold bg-amber-950/80 text-amber-300 border border-amber-800/60 uppercase">
                                  Simulated
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">
                              {op.target?.kind}/{op.target?.namespace ? `${op.target.namespace}/` : ''}{op.target?.name}
                            </td>
                            <td className="py-3 px-4 text-zinc-400">
                              {op.requestedBy?.name || 'HUMAN'}
                            </td>
                            <td className="py-3 px-4">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                                  isSuccess
                                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                                    : op.status === 'FAILED'
                                    ? 'bg-rose-950 text-rose-400 border border-rose-800/60'
                                    : op.status === 'TIMEOUT'
                                    ? 'bg-amber-950/80 text-amber-400 border border-amber-700/80'
                                    : op.status === 'ROLLED_BACK'
                                    ? 'bg-amber-950 text-amber-300 border border-amber-800/60'
                                    : op.status === 'ROLLING_BACK'
                                    ? 'bg-orange-950 text-orange-300 border border-orange-800/60 animate-pulse'
                                    : op.status === 'VERIFYING'
                                    ? 'bg-purple-950 text-purple-300 border border-purple-800/60 animate-pulse'
                                    : op.status === 'EXECUTING'
                                    ? 'bg-blue-950 text-blue-300 border border-blue-800/60 animate-pulse'
                                    : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                                }`}
                              >
                                {op.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-zinc-400 max-w-xs truncate" title={op.executionResult?.message || op.parameters?.reason as string || '—'}>
                              {op.executionResult?.message || op.parameters?.reason as string || 'Operation completed'}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-zinc-500">
                              {new Date(op.createdAt).toLocaleTimeString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. CONTEXTUAL RESOURCE DETAIL PANEL */}
      {selectedResource && (
        <ResourceDetailPanel
          cluster={activeCluster}
          resource={selectedResource}
          onClose={() => setSelectedResource(null)}
          incidents={incidents}
          onSelectIncident={onSelectIncident}
          onOperationSuccess={handleOperationSuccess}
          deploymentRecords={deployments}
        />
      )}

      {/* 5. ACTION MODAL */}
      {activeActionModal && (
        <OperationActionModal
          isOpen={Boolean(activeActionModal)}
          onClose={() => setActiveActionModal(null)}
          cluster={activeCluster}
          resource={activeActionModal.resource}
          actionType={activeActionModal.actionType}
          onSuccess={handleOperationSuccess}
        />
      )}

      {/* 6. RELEASE DIFF / ROLLBACK MODAL */}
      {diffDeployment && (
        <ReleaseDiffModal
          isOpen={Boolean(diffDeployment)}
          onClose={() => setDiffDeployment(null)}
          cluster={activeCluster}
          deployment={diffDeployment}
          historyRecords={deployments}
          onRollbackSuccess={handleOperationSuccess}
        />
      )}

      {/* 7. ACTIVITY DETAIL MODAL */}
      {selectedActivityOp && (
        <ActivityDetailModal
          isOpen={Boolean(selectedActivityOp)}
          onClose={() => setSelectedActivityOp(null)}
          operation={selectedActivityOp}
          clusterName={activeCluster?.name}
        />
      )}
    </div>
  );
};
