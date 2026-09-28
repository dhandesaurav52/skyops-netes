import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  ExternalLink,
  Filter,
  FolderTree,
  HardDrive,
  Info,
  Layers,
  Network,
  Radio,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  Zap
} from 'lucide-react';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, StatusBadge, WorkloadKindBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { ArchitectureDomainId, ArchitectureDomainSummary, ArchitectureTelemetryState } from './types';

interface ArchitectureDomainViewProps {
  domainId: ArchitectureDomainId;
  telemetry: ArchitectureTelemetryState;
  clusters: Cluster[];
  selectedClusterId: string;
  selectedNamespace: string;
  onBack: () => void;
  onSelectResource: (resource: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
  onOpenLogs?: (clusterId: string, namespace: string, podName: string) => void;
}

export const ArchitectureDomainView: React.FC<ArchitectureDomainViewProps> = ({
  domainId,
  telemetry,
  clusters,
  selectedClusterId,
  selectedNamespace,
  onBack,
  onSelectResource,
  onSelectIncident,
  onOpenLogs
}) => {
  const domain = telemetry.domains[domainId];
  const [selectedKind, setSelectedKind] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'inventory' | 'relationships'>('inventory');

  // Filter resources for this domain
  const filteredResources = useMemo(() => {
    let list = domain.allResources;

    // Filter by kind
    if (selectedKind !== 'all') {
      list = list.filter((r) => r.kind === selectedKind);
    }

    // Filter by namespace
    if (selectedNamespace !== 'all') {
      list = list.filter((r) => !r.namespace || r.namespace === selectedNamespace);
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((r) => {
        const matchName = r.name.toLowerCase().includes(q);
        const matchNs = (r.namespace || '').toLowerCase().includes(q);
        const matchKind = r.kind.toLowerCase().includes(q);
        return matchName || matchNs || matchKind;
      });
    }

    return list;
  }, [domain.allResources, selectedKind, selectedNamespace, searchQuery]);

  // Compute domain icon
  const getDomainIcon = (id: ArchitectureDomainId) => {
    switch (id) {
      case 'compute':
        return <Cpu className="w-5 h-5 text-sky-400" />;
      case 'workloads':
        return <Layers className="w-5 h-5 text-indigo-400" />;
      case 'networking':
        return <Network className="w-5 h-5 text-cyan-400" />;
      case 'storage':
        return <HardDrive className="w-5 h-5 text-amber-400" />;
      case 'configuration':
        return <Database className="w-5 h-5 text-emerald-400" />;
      case 'scheduling':
        return <Workflow className="w-5 h-5 text-violet-400" />;
      case 'scaling':
        return <Zap className="w-5 h-5 text-yellow-400" />;
      case 'security':
        return <ShieldCheck className="w-5 h-5 text-rose-400" />;
      default:
        return <Boxes className="w-5 h-5 text-zinc-400" />;
    }
  };

  // Check if a resource is affected by active incident
  const getResourceIncidents = (r: KubernetesResource): Incident[] => {
    const key = `${r.clusterId}/${r.kind}/${r.namespace || ''}/${r.name}`;
    const wildcardKey = `*/${r.kind}/${r.namespace || ''}/${r.name}`;
    return [
      ...(telemetry.incidentsByResourceKey.get(key) || []),
      ...(telemetry.incidentsByResourceKey.get(wildcardKey) || [])
    ];
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Domain Header */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-100 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">All Domains</span>
            </button>

            <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
              <span className="hover:text-zinc-200 cursor-pointer" onClick={onBack}>
                Architecture
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />
              <span className="text-sky-400 font-bold">{domain.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveSubTab('inventory')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'inventory'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                  : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              Resource Inventory ({domain.resourceCount})
            </button>
            <button
              onClick={() => setActiveSubTab('relationships')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                activeSubTab === 'relationships'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                  : 'bg-zinc-950 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              Domain Architecture & Flow
            </button>
          </div>
        </div>

        {/* Domain Overview Strip */}
        <div className="mt-4 pt-4 border-t border-zinc-800/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center">
              {getDomainIcon(domain.id)}
            </div>
            <div>
              <h2 className="text-sm font-bold text-zinc-100">{domain.title}</h2>
              <p className="text-xs text-zinc-400 mt-0.5">{domain.description}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {domain.detectedHighlights.map((hl, idx) => (
              <span
                key={idx}
                className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300"
              >
                {hl}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* RELATIONSHIPS & FLOW SUB-TAB */}
      {activeSubTab === 'relationships' && (
        <div className="space-y-4">
          {/* Domain-specific architectural flow explanation */}
          {domainId === 'networking' && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <Network className="w-4 h-4 text-cyan-400" />
                    Observed Ingress & Egress Network Topology
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Real traffic path resolved from cluster telemetry: Ingress → Service → EndpointSlice → Pods
                  </p>
                </div>
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 font-mono text-xs text-zinc-300 overflow-x-auto">
                <div className="flex items-center gap-3 min-w-[600px]">
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">1. Entry Ingress</div>
                    <div className="text-xs text-zinc-200 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'Ingress').length} Rules
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">2. Cluster Services</div>
                    <div className="text-xs text-cyan-400 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'Service').length} Virtual IPs
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">3. EndpointSlices</div>
                    <div className="text-xs text-sky-400 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'EndpointSlice').length} Slices Synced
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">4. Backing Pods</div>
                    <div className="text-xs text-emerald-400 mt-1 font-bold">
                      {telemetry.domains.compute.allResources.filter((r) => r.kind === 'Pod').length} Endpoints
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {domainId === 'storage' && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-amber-400" />
                    Observed Persistent Storage Topology
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Real storage binding chain: Workload Mount → PersistentVolumeClaim → PersistentVolume → StorageClass
                  </p>
                </div>
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 font-mono text-xs text-zinc-300 overflow-x-auto">
                <div className="flex items-center gap-3 min-w-[600px]">
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">1. Workload Mount</div>
                    <div className="text-xs text-zinc-200 mt-1 font-bold">
                      {telemetry.domains.workloads.resourceCount} Workloads
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">2. PVCs</div>
                    <div className="text-xs text-amber-400 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'PersistentVolumeClaim').length} Claims
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">3. PV Backends</div>
                    <div className="text-xs text-sky-400 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'PersistentVolume').length} Volumes
                    </div>
                  </div>
                  <span className="text-zinc-600 text-lg">→</span>
                  <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-center flex-1">
                    <div className="text-[10px] text-zinc-500 uppercase font-semibold">4. StorageClasses</div>
                    <div className="text-xs text-emerald-400 mt-1 font-bold">
                      {domain.allResources.filter((r) => r.kind === 'StorageClass').length} Classes
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {domainId === 'scheduling' && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Workflow className="w-4 h-4 text-violet-400" />
                Detected Scheduler Mechanisms in Observed Cluster
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">Node Taints</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                      {telemetry.schedulingSummary.nodesWithTaints} Nodes
                    </span>
                  </div>
                  {telemetry.schedulingSummary.taints.length === 0 ? (
                    <p className="text-xs text-zinc-500">No active taints detected on cluster nodes.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {telemetry.schedulingSummary.taints.map((t, idx) => (
                        <div key={idx} className="text-[11px] font-mono p-2 bg-zinc-900 rounded border border-zinc-800 text-zinc-300 flex items-center justify-between">
                          <span>{t.nodeName}: <span className="text-violet-400">{t.key}</span></span>
                          <span className="text-zinc-500">{t.effect}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-200">nodeSelector & Affinities</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                      {telemetry.schedulingSummary.podsWithNodeSelector + telemetry.schedulingSummary.podsWithAffinity} Pods
                    </span>
                  </div>
                  {telemetry.schedulingSummary.podsWithNodeSelector === 0 && telemetry.schedulingSummary.podsWithAffinity === 0 ? (
                    <p className="text-xs text-zinc-500">Pods rely on standard kube-scheduler automatic node selection.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-40 overflow-y-auto">
                      {telemetry.schedulingSummary.nodeSelectors.map((ns, idx) => (
                        <div key={idx} className="text-[11px] font-mono p-2 bg-zinc-900 rounded border border-zinc-800 text-zinc-300">
                          <div className="text-zinc-400">{ns.namespace}/{ns.podName}</div>
                          <div className="text-sky-400 mt-0.5">{JSON.stringify(ns.selectors)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {domainId === 'scaling' && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-yellow-400" />
                Cluster Elasticity & Scaling Verification
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">HorizontalPodAutoscaler</div>
                  <div className="text-base font-bold text-zinc-100 mt-1">
                    {telemetry.scalingSummary.hpas.length} Active
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {telemetry.scalingSummary.hpas.length > 0
                      ? 'Automating pod replica counts based on metrics'
                      : 'None detected in cluster'}
                  </div>
                </div>

                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Cluster Autoscaler</div>
                  <div className="text-base font-bold text-zinc-100 mt-1 flex items-center gap-1.5">
                    {telemetry.scalingSummary.clusterAutoscalerDetected ? (
                      <span className="text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" /> Detected
                      </span>
                    ) : (
                      <span className="text-zinc-400">Not Detected</span>
                    )}
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {telemetry.scalingSummary.clusterAutoscalerEvidence || 'No autoscaler controller pod observed'}
                  </div>
                </div>

                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Fleet Workload Replicas</div>
                  <div className="text-base font-bold text-zinc-100 mt-1">
                    {telemetry.scalingSummary.totalReadyReplicas} / {telemetry.scalingSummary.totalDesiredReplicas} Ready
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {telemetry.scalingSummary.totalAvailableReplicas} replicas actively serving traffic
                  </div>
                </div>
              </div>
            </div>
          )}

          {domainId === 'security' && (
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4 shadow-sm">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-rose-400" />
                Observed Security Architecture & RBAC Telemetry
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Network Policies</div>
                  <div className="text-base font-bold text-zinc-100 mt-1">
                    {telemetry.securitySummary.networkPolicies.length} Policies
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {telemetry.securitySummary.networkPolicies.length > 0
                      ? 'Packet filtering active'
                      : 'Flat network perimeter (all pods can communicate)'}
                  </div>
                </div>

                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Non-Root Containers</div>
                  <div className="text-base font-bold text-zinc-100 mt-1">
                    {telemetry.securitySummary.podSecurityHighlights.runAsNonRootCount} / {telemetry.securitySummary.podSecurityHighlights.totalInspected} Pods
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    Enforcing runAsNonRoot execution policy
                  </div>
                </div>

                <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800">
                  <div className="text-[10px] font-mono uppercase text-zinc-500">Privileged Containers</div>
                  <div className="text-base font-bold text-zinc-100 mt-1">
                    {telemetry.securitySummary.podSecurityHighlights.privilegedCount} Observed
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">
                    {telemetry.securitySummary.podSecurityHighlights.privilegedCount === 0
                      ? 'No privileged containers observed'
                      : 'Privileged capability detected'}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FILTER & INVENTORY BAR */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
        {/* Kind Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          <button
            onClick={() => setSelectedKind('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              selectedKind === 'all'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
            }`}
          >
            All Kinds ({domain.allResources.length})
          </button>
          {domain.categories.map((cat) => (
            <button
              key={cat.kind}
              onClick={() => setSelectedKind(cat.kind)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                selectedKind === cat.kind
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
              }`}
            >
              {cat.kind} ({cat.count})
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Filter ${domain.shortTitle} objects...`}
            className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-300 placeholder-zinc-500 focus:outline-none focus:border-sky-500 w-full sm:w-64"
          />
        </div>
      </div>

      {/* RESOURCE LIST / INVENTORY TABLE */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-950/80 text-[11px] font-mono text-zinc-400">
                <th className="py-3 px-4">Resource Name</th>
                <th className="py-3 px-4">Kind</th>
                <th className="py-3 px-4">Namespace</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Health</th>
                <th className="py-3 px-4">Telemetry Metrics</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-sans">
              {filteredResources.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    <Info className="w-6 h-6 mx-auto mb-2 text-zinc-600" />
                    No {selectedKind === 'all' ? domain.shortTitle : selectedKind} resources found for the active filter.
                  </td>
                </tr>
              ) : (
                filteredResources.map((res) => {
                  const correlatedIncidents = getResourceIncidents(res);
                  const hasIncidents = correlatedIncidents.length > 0;

                  return (
                    <tr
                      key={res.id}
                      onClick={() => onSelectResource(res)}
                      className="hover:bg-zinc-800/50 transition-colors cursor-pointer group"
                    >
                      <td className="py-3 px-4 font-semibold text-zinc-100 flex items-center gap-2">
                        {getDomainIcon(domainId)}
                        <span className="truncate max-w-[220px] font-mono group-hover:text-sky-400 transition-colors">
                          {res.name}
                        </span>
                        {hasIncidents && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onSelectIncident && correlatedIncidents[0]) {
                                onSelectIncident(correlatedIncidents[0].id);
                              }
                            }}
                            title="Active Incident affecting this resource"
                            className="p-1 rounded bg-red-500/20 text-red-400 border border-red-500/40 hover:bg-red-500/30 flex items-center gap-1 cursor-pointer"
                          >
                            <AlertOctagon className="w-3 h-3" />
                            <span className="text-[10px] font-mono font-bold">INCIDENT</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-400">{res.kind}</td>
                      <td className="py-3 px-4 font-mono text-zinc-300">{res.namespace || 'cluster-scoped'}</td>
                      <td className="py-3 px-4 font-mono text-zinc-300">
                        <StatusBadge status={res.status} />
                      </td>
                      <td className="py-3 px-4">
                        <ResourceHealthBadge health={res.health} />
                      </td>
                      <td className="py-3 px-4 font-mono text-zinc-400 text-[11px]">
                        {res.kind === 'Node' ? (
                          <span>{(res.metrics as any)?.cpuUsage || 'CPU Unavailable'}</span>
                        ) : res.kind === 'Pod' ? (
                          <span>
                            {(res.metrics?.cpu as any)?.formatted ? `${(res.metrics?.cpu as any).formatted} CPU` : 'CPU Unavailable'}
                            {res.restartCount !== undefined ? ` • ${res.restartCount} restarts` : ''}
                          </span>
                        ) : res.kind === 'Deployment' || res.kind === 'StatefulSet' ? (
                          <span>
                            {(res.statusSummary as any)?.readyReplicas ?? (res.statusSummary as any)?.numberReady ?? '—'}/
                            {(res.specSummary as any)?.replicas ?? 1} replicas
                          </span>
                        ) : res.kind === 'PersistentVolumeClaim' ? (
                          <span>{(res.specSummary as any)?.storageClassName || 'Standard'}</span>
                        ) : (
                          <span>Telemetry synced</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className="text-sky-400 group-hover:text-sky-300 text-xs font-medium">
                          Inspect →
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
    </div>
  );
};
