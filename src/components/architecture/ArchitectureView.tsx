import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Filter,
  Maximize2,
  Network,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Workflow,
  X
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { NodeDetailModal } from '../resources/NodeDetailModal';
import { PodDetailModal } from '../resources/PodDetailModal';
import { ServiceDetailModal } from '../resources/ServiceDetailModal';
import { WorkloadDetailModal } from '../resources/WorkloadDetailModal';
import { buildArchitectureTelemetry } from './architectureTelemetry';
import { GenericResourceDetailModal } from './GenericResourceDetailModal';
import { ArchitectureExplanationModal } from './topology/ArchitectureExplanationModal';
import { buildTopologyGraph } from './topology/topologyGraphBuilder';
import { TopologyCanvas } from './topology/TopologyCanvas';
import { TopologyInspectorDrawer } from './topology/TopologyInspectorDrawer';
import {
  TopologyFilterState,
  TopologyNode,
  TopologyViewMode
} from './topology/types';
import { ArchitectureDomainId, ArchitectureTelemetryState } from './types';

interface ArchitectureViewProps {
  resources: KubernetesResource[];
  clusters: Cluster[];
  incidents: Incident[];
  selectedClusterId: string;
  onSelectCluster: (clusterId: string) => void;
  onSelectIncident?: (incidentId: string) => void;
  onOpenLogs?: (clusterId: string, namespace: string, podName: string) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const ArchitectureView: React.FC<ArchitectureViewProps> = ({
  resources,
  clusters,
  incidents,
  selectedClusterId,
  onSelectCluster,
  onSelectIncident,
  onOpenLogs,
  onRefresh,
  isLoading = false
}) => {
  // Filters & View state
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [healthFilter, setHealthFilter] = useState<'all' | 'HEALTHY' | 'WARNING' | 'CRITICAL'>('all');
  const [domainFilter, setDomainFilter] = useState<'all' | ArchitectureDomainId>('all');
  const [incidentsOnly, setIncidentsOnly] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<TopologyViewMode>('topology');
  const [showFiltersPopover, setShowFiltersPopover] = useState<boolean>(false);

  // Canvas & Interaction state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [showMiniMap, setShowMiniMap] = useState<boolean>(true);
  const [showExplainModal, setShowExplainModal] = useState<boolean>(false);

  // Full Resource Detail Modal state
  const [activeResource, setActiveResource] = useState<KubernetesResource | null>(null);

  // Filter resources by cluster
  const clusterFilteredResources = useMemo(() => {
    if (!selectedClusterId || selectedClusterId === 'all') {
      return resources;
    }
    return resources.filter((r) => r.clusterId === selectedClusterId);
  }, [resources, selectedClusterId]);

  // Available namespaces from live telemetry
  const availableNamespaces = useMemo(() => {
    const nsSet = new Set<string>();
    for (const r of clusterFilteredResources) {
      if (r.namespace) nsSet.add(r.namespace);
    }
    return Array.from(nsSet).sort();
  }, [clusterFilteredResources]);

  // Active Cluster object
  const activeCluster = useMemo(() => {
    return clusters.find((c) => c.id === selectedClusterId) || clusters[0] || null;
  }, [clusters, selectedClusterId]);

  // Telemetry state
  const telemetry: ArchitectureTelemetryState = useMemo(() => {
    return buildArchitectureTelemetry(clusterFilteredResources, clusters, incidents);
  }, [clusterFilteredResources, clusters, incidents]);

  // Filter state for builder
  const filterState: TopologyFilterState = useMemo(
    () => ({
      namespace: selectedNamespace,
      search: searchQuery,
      health: healthFilter,
      domain: domainFilter,
      incidentsOnly
    }),
    [selectedNamespace, searchQuery, healthFilter, domainFilter, incidentsOnly]
  );

  // Build Topology Graph
  const graphData = useMemo(() => {
    return buildTopologyGraph({
      resources: clusterFilteredResources,
      cluster: activeCluster,
      incidents,
      filters: filterState,
      expandedNodeIds
    });
  }, [clusterFilteredResources, activeCluster, incidents, filterState, expandedNodeIds]);

  // Active selected topology node
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return graphData.nodeMap.get(selectedNodeId) || null;
  }, [selectedNodeId, graphData.nodeMap]);

  // Node expand / collapse toggle
  const handleToggleExpand = (nodeId: string) => {
    setExpandedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  // Node selection in canvas
  const handleSelectNode = (node: TopologyNode | null) => {
    setSelectedNodeId(node ? node.id : null);
  };

  // Helper to open full resource detail modal
  const handleOpenDetailsModal = (res: KubernetesResource) => {
    setActiveResource(res);
  };

  const handleCloseModal = () => {
    setActiveResource(null);
  };

  const isWorkloadKind = (kind: string) => {
    return ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Rollout'].includes(kind);
  };

  // Operational metrics summary
  const nodeCount = clusterFilteredResources.filter((r) => r.kind === 'Node').length;
  const readyNodesCount = clusterFilteredResources.filter(
    (r) => r.kind === 'Node' && (r.status === 'Ready' || r.health === 'HEALTHY')
  ).length;

  const podCount = clusterFilteredResources.filter((r) => r.kind === 'Pod').length;
  const readyPodsCount = clusterFilteredResources.filter(
    (r) => r.kind === 'Pod' && (r.status === 'Running' || r.health === 'HEALTHY')
  ).length;

  const serviceCount = clusterFilteredResources.filter((r) => r.kind === 'Service').length;
  const pvcCount = clusterFilteredResources.filter((r) => r.kind === 'PersistentVolumeClaim').length;
  const boundPvcCount = clusterFilteredResources.filter(
    (r) => r.kind === 'PersistentVolumeClaim' && (r.status === 'Bound' || r.health === 'HEALTHY')
  ).length;

  // Active incidents for the current cluster
  const activeClusterIncidents = useMemo(() => {
    return incidents.filter(
      (i) => (!activeCluster?.id || i.clusterId === activeCluster.id) && i.status !== 'RESOLVED'
    );
  }, [incidents, activeCluster]);

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] min-h-[580px] w-full bg-zinc-950 text-zinc-100 rounded-2xl border border-zinc-800/90 shadow-2xl overflow-hidden font-sans">
      {/* ==========================================
          1. HEADER TOOLBAR
          ========================================== */}
      <div className="p-4 border-b border-zinc-800/90 bg-zinc-950/80 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Left: Title & Subtitle */}
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-lg font-bold text-zinc-100 tracking-tight flex items-center gap-2">
              <span>Architecture</span>
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold flex items-center gap-1.5 ${
                telemetry.freshness === 'LIVE'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : telemetry.freshness === 'STALE'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                  : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  telemetry.freshness === 'LIVE'
                    ? 'bg-emerald-400 animate-pulse'
                    : telemetry.freshness === 'STALE'
                    ? 'bg-amber-400'
                    : 'bg-zinc-500'
                }`}
              />
              {telemetry.freshness === 'LIVE'
                ? 'Live Topology'
                : telemetry.freshness === 'STALE'
                ? `Stale (${telemetry.ageSeconds}s)`
                : 'Offline'}
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 hidden sm:block">
            Visualize your Kubernetes cluster, understand relationships, and explore your infrastructure.
          </p>
        </div>

        {/* Center & Right: Controls */}
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {/* Cluster Selector */}
          <div className="relative">
            <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 pr-7 text-xs font-mono text-zinc-200 cursor-pointer hover:border-zinc-700">
              <Server className="w-3.5 h-3.5 text-sky-400 mr-1.5 shrink-0" />
              <select
                value={selectedClusterId}
                onChange={(e) => onSelectCluster(e.target.value)}
                className="bg-transparent text-xs text-zinc-200 focus:outline-none appearance-none cursor-pointer pr-1"
              >
                <option value="all" className="bg-zinc-950 text-zinc-200">
                  Cluster: Fleet View
                </option>
                {clusters.map((c) => (
                  <option key={c.id} value={c.id} className="bg-zinc-950 text-zinc-200">
                    Cluster: {c.name}
                  </option>
                ))}
              </select>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* Namespace Filter */}
          <div className="relative">
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 rounded-lg px-2.5 py-1.5 pr-7 focus:outline-none focus:border-sky-500 appearance-none font-mono cursor-pointer hover:border-zinc-700"
            >
              <option value="all" className="bg-zinc-950">All Namespaces</option>
              {availableNamespaces.map((ns) => (
                <option key={ns} value={ns} className="bg-zinc-950">
                  {ns}
                </option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter resources..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-sky-500 font-mono w-40 sm:w-48 placeholder-zinc-500 hover:border-zinc-700"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          {/* View Dropdown */}
          <div className="relative">
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as TopologyViewMode)}
              className="bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 rounded-lg px-2.5 py-1.5 pr-7 focus:outline-none appearance-none font-mono cursor-pointer hover:border-zinc-700"
            >
              <option value="topology" className="bg-zinc-950">View: Topology</option>
              <option value="grouped_namespace" className="bg-zinc-950">View: By Namespace</option>
              <option value="grouped_domain" className="bg-zinc-950">View: By Domain</option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>

          {/* Filters Toggle Button */}
          <div className="relative">
            <button
              onClick={() => setShowFiltersPopover(!showFiltersPopover)}
              className={`p-1.5 px-2.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition cursor-pointer ${
                healthFilter !== 'all' || domainFilter !== 'all' || incidentsOnly
                  ? 'bg-sky-500/20 border-sky-500/40 text-sky-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'
              }`}
            >
              <Filter className="w-3.5 h-3.5" />
              <span>Filters</span>
              {(healthFilter !== 'all' || domainFilter !== 'all' || incidentsOnly) && (
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              )}
            </button>

            {/* Filters Popover */}
            {showFiltersPopover && (
              <div className="absolute right-0 top-full mt-2 w-64 bg-zinc-950 border border-zinc-800 rounded-xl p-3 shadow-2xl z-40 space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="font-bold text-zinc-200">Topology Filters</span>
                  <button
                    onClick={() => {
                      setHealthFilter('all');
                      setDomainFilter('all');
                      setIncidentsOnly(false);
                    }}
                    className="text-[10px] text-sky-400 hover:underline"
                  >
                    Reset
                  </button>
                </div>

                {/* Health Filter */}
                <div>
                  <span className="text-zinc-500 text-[10px] block mb-1">Health Status</span>
                  <select
                    value={healthFilter}
                    onChange={(e) => setHealthFilter(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs"
                  >
                    <option value="all">All Health States</option>
                    <option value="HEALTHY">Healthy Only</option>
                    <option value="WARNING">Warning Only</option>
                    <option value="CRITICAL">Critical Only</option>
                  </select>
                </div>

                {/* Domain Filter */}
                <div>
                  <span className="text-zinc-500 text-[10px] block mb-1">Architectural Domain</span>
                  <select
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value as any)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded p-1.5 text-zinc-200 text-xs"
                  >
                    <option value="all">All Domains</option>
                    <option value="compute">Compute Only</option>
                    <option value="workloads">Workloads Only</option>
                    <option value="networking">Networking Only</option>
                    <option value="storage">Storage Only</option>
                    <option value="configuration">Configuration Only</option>
                    <option value="security">Security Only</option>
                    <option value="scheduling">Scheduling Only</option>
                  </select>
                </div>

                {/* Incident Only Toggle */}
                <label className="flex items-center gap-2 text-zinc-300 text-[11px] cursor-pointer pt-1 border-t border-zinc-900">
                  <input
                    type="checkbox"
                    checked={incidentsOnly}
                    onChange={(e) => setIncidentsOnly(e.target.checked)}
                    className="rounded bg-zinc-900 border-zinc-700 text-sky-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Only Resources with Incidents</span>
                </label>
              </div>
            )}
          </div>

          {/* Explain with AI header button */}
          <button
            id="architecture-explain-ai-btn"
            onClick={() => setShowExplainModal(true)}
            className="p-1.5 px-2.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-xs font-mono font-semibold text-sky-300 flex items-center gap-1.5 transition cursor-pointer shadow-sm"
            title="Explain cluster architecture with AI"
          >
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Explain with AI</span>
          </button>

          {/* Refresh button */}
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Poll latest cluster telemetry"
              className="p-1.5 px-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* ==========================================
          2. CENTRAL WORKSPACE: CANVAS & INSPECTOR
          ========================================== */}
      <div className="relative flex-1 flex overflow-hidden w-full h-full min-h-0">
        {/* Central Canvas Viewport */}
        <div className="flex-1 h-full relative min-h-0">
          <TopologyCanvas
            graphData={graphData}
            selectedNodeId={selectedNodeId}
            onSelectNode={handleSelectNode}
            onToggleExpand={handleToggleExpand}
            showMiniMap={showMiniMap}
            onToggleMiniMap={() => setShowMiniMap(!showMiniMap)}
            onOpenDetailsModal={handleOpenDetailsModal}
          />
        </div>

        {/* Right-Side Resource Inspector Drawer */}
        {selectedNode && (
          <TopologyInspectorDrawer
            node={selectedNode}
            onClose={() => setSelectedNodeId(null)}
            onOpenDetailsModal={handleOpenDetailsModal}
            onSelectResourceById={(id) => setSelectedNodeId(id)}
            onSelectIncident={(inc) => {
              if (onSelectIncident) onSelectIncident(inc.id);
            }}
            onOpenLogs={(res) => {
              if (onOpenLogs) onOpenLogs(res.clusterId, res.namespace, res.name);
            }}
            onOpenAiExplain={(node) => {
              if (node?.id) {
                setSelectedNodeId(node.id);
              }
              setShowExplainModal(true);
            }}
          />
        )}
      </div>

      {/* ==========================================
          3. BOTTOM OPERATIONAL STATUS BAR
          ========================================== */}
      <div className="p-3 border-t border-zinc-800/90 bg-zinc-950/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 text-xs font-mono shrink-0">
        {/* Left: Active Incidents banner */}
        <div className="flex items-center gap-2 min-w-0">
          {activeClusterIncidents.length > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/40 border border-rose-900/60 text-rose-300 min-w-0">
              <AlertOctagon className="w-3.5 h-3.5 text-rose-400 shrink-0 animate-pulse" />
              <span className="font-bold shrink-0">
                Active Incidents ({activeClusterIncidents.length})
              </span>
              <span className="text-zinc-500 hidden sm:inline">|</span>
              <span className="text-zinc-300 truncate hidden sm:inline">
                {activeClusterIncidents[0].title} — {activeClusterIncidents[0].resourceName}
              </span>
              <button
                onClick={() => {
                  const first = activeClusterIncidents[0];
                  if (first) {
                    // Focus affected resource in canvas
                    const matchingNode = graphData.nodes.find(
                      (n) => n.name === first.resourceName || n.resource?.name === first.resourceName
                    );
                    if (matchingNode) {
                      setSelectedNodeId(matchingNode.id);
                    } else if (onSelectIncident) {
                      onSelectIncident(first.id);
                    }
                  }
                }}
                className="text-sky-400 hover:text-sky-300 text-[11px] font-bold underline ml-1 shrink-0 cursor-pointer"
              >
                Focus →
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-emerald-400 px-3 py-1.5 rounded-lg bg-emerald-950/20 border border-emerald-900/40">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Zero active incidents detected in current cluster</span>
            </div>
          )}
        </div>

        {/* Right: Cluster Health metric badges */}
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {/* Cluster Health */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
            <span className="text-zinc-500 text-[11px]">Cluster Health:</span>
            <span
              className={`font-bold flex items-center gap-1 ${
                telemetry.activeIncidents.length > 0 ? 'text-rose-400' : 'text-emerald-400'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  telemetry.activeIncidents.length > 0 ? 'bg-rose-500' : 'bg-emerald-400'
                }`}
              />
              {telemetry.activeIncidents.length > 0 ? 'Degraded' : 'Healthy'}
            </span>
          </div>

          {/* Nodes */}
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">
            <span className="text-zinc-500">Nodes: </span>
            <span className="text-zinc-200 font-semibold">
              {readyNodesCount}/{nodeCount}
            </span>
          </div>

          {/* Pods */}
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">
            <span className="text-zinc-500">Pods: </span>
            <span
              className={`font-semibold ${
                readyPodsCount < podCount ? 'text-amber-400' : 'text-zinc-200'
              }`}
            >
              {readyPodsCount}/{podCount}
            </span>
          </div>

          {/* Services */}
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">
            <span className="text-zinc-500">Services: </span>
            <span className="text-zinc-200 font-semibold">{serviceCount}</span>
          </div>

          {/* PVCs */}
          <div className="px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px]">
            <span className="text-zinc-500">PVCs: </span>
            <span className="text-zinc-200 font-semibold">
              {pvcCount > 0 ? `${boundPvcCount}/${pvcCount}` : 'None'}
            </span>
          </div>
        </div>
      </div>

      {/* ==========================================
          4. MODALS (DETAIL MODALS + AI EXPLANATION)
          ========================================== */}
      {/* AI Explanation Modal */}
      <ArchitectureExplanationModal
        isOpen={showExplainModal}
        onClose={() => setShowExplainModal(false)}
        cluster={activeCluster}
        resources={clusterFilteredResources}
        telemetry={telemetry}
        incidents={activeClusterIncidents}
        selectedNode={selectedNode}
        onSelectResource={handleOpenDetailsModal}
      />

      {/* Detail Modals for Seamless Continuity */}
      {activeResource && (
        <>
          {activeResource.kind === 'Node' && activeCluster && (
            <NodeDetailModal
              node={activeResource}
              cluster={activeCluster}
              clusterResources={clusterFilteredResources}
              incidents={incidents}
              onClose={handleCloseModal}
              onSelectPod={handleOpenDetailsModal}
            />
          )}

          {activeResource.kind === 'Pod' && (
            <PodDetailModal
              pod={activeResource}
              clusterResources={clusterFilteredResources}
              incidents={incidents}
              onClose={handleCloseModal}
              onSelectResource={handleOpenDetailsModal}
              onSelectIncident={(incId) => {
                if (onSelectIncident) onSelectIncident(incId);
              }}
            />
          )}

          {isWorkloadKind(activeResource.kind) && (
            <WorkloadDetailModal
              workload={activeResource}
              clusterResources={clusterFilteredResources}
              incidents={incidents}
              onClose={handleCloseModal}
              onSelectPod={handleOpenDetailsModal}
            />
          )}

          {activeResource.kind === 'Service' && (
            <ServiceDetailModal
              service={activeResource}
              cluster={activeCluster}
              clusterResources={clusterFilteredResources}
              incidents={incidents}
              onClose={handleCloseModal}
              onSelectPod={handleOpenDetailsModal}
              onSelectResource={handleOpenDetailsModal}
            />
          )}

          {!['Node', 'Pod', 'Service'].includes(activeResource.kind) &&
            !isWorkloadKind(activeResource.kind) && (
              <GenericResourceDetailModal
                resource={activeResource}
                clusterResources={clusterFilteredResources}
                incidents={incidents}
                onClose={handleCloseModal}
                onSelectResource={handleOpenDetailsModal}
                onSelectIncident={(inc: any) => {
                  if (onSelectIncident) onSelectIncident(typeof inc === 'string' ? inc : inc.id);
                }}
              />
            )}
        </>
      )}
    </div>
  );
};
