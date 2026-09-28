import {
  Activity,
  AlertCircle,
  Clock,
  Filter,
  Layers,
  Radio,
  RefreshCw,
  Search,
  Server,
  Terminal
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { Cluster, K8sEvent, KubernetesResource } from '../../types/index';
import { ClusterObservabilityView } from '../clusters/ClusterObservabilityView';
import { ClusterEventsView } from '../events/ClusterEventsView';
import { PodLogsViewer } from '../logs/PodLogsViewer';
import { ClusterStatusBadge } from '../common/Badges';
import { EmptyState } from '../common/UI';

export interface LogNavigationIntent {
  requestId: string;
  clusterId?: string;
  namespace: string;
  name: string;
}

export interface SelectedPodIdentity {
  clusterId: string;
  namespace: string;
  name: string;
  uid?: string;
  container?: string;
}

export interface ObservabilityHubViewProps {
  clusters: Cluster[];
  initialClusterId?: string;
  initialPod?: { namespace?: string; name: string };
  logIntent?: LogNavigationIntent | null;
  onClearLogIntent?: () => void;
  onRefresh?: () => void;
}

type ObservabilityTab = 'metrics' | 'logs' | 'events';

export const ObservabilityHubView: React.FC<ObservabilityHubViewProps> = ({
  clusters = [],
  initialClusterId,
  initialPod,
  logIntent,
  onClearLogIntent,
  onRefresh
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>(() => {
    if (logIntent?.clusterId && clusters.some((c) => c.id === logIntent.clusterId)) {
      return logIntent.clusterId;
    }
    if (initialClusterId && clusters.some((c) => c.id === initialClusterId)) {
      return initialClusterId;
    }
    return clusters[0]?.id || '';
  });

  const [activeTab, setActiveTab] = useState<ObservabilityTab>(() => {
    return logIntent || initialPod ? 'logs' : 'metrics';
  });

  const [clusterResources, setClusterResources] = useState<KubernetesResource[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [clusterEvents, setClusterEvents] = useState<K8sEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);

  // Canonical selected pod model
  const [selectedPod, setSelectedPod] = useState<SelectedPodIdentity | null>(() => {
    const podName = logIntent?.name || initialPod?.name;
    if (!podName) return null;
    const clusterId =
      logIntent?.clusterId ||
      (initialClusterId && clusters.some((c) => c.id === initialClusterId) ? initialClusterId : clusters[0]?.id) ||
      '';
    const ns = logIntent?.namespace ?? initialPod?.namespace ?? '';
    return {
      clusterId,
      namespace: ns,
      name: podName
    };
  });

  // Namespace filter state: 'all' or specific namespace
  const [selectedNamespace, setSelectedNamespace] = useState<string>(() => {
    if (logIntent?.namespace) return logIntent.namespace;
    if (initialPod?.namespace) return initialPod.namespace;
    return 'all';
  });

  const [podSearchFilter, setPodSearchFilter] = useState<string>('');

  // Track handled intent ID to guarantee one-shot consumption
  const lastHandledIntentId = useRef<string | null>(null);

  // Keep selectedClusterId synced if clusters list updates and none selected
  useEffect(() => {
    if (!selectedClusterId && clusters.length > 0) {
      setSelectedClusterId(clusters[0].id);
    }
  }, [clusters, selectedClusterId]);

  // Robust ONE-SHOT navigation intent contract
  useEffect(() => {
    if (logIntent && logIntent.requestId && logIntent.requestId !== lastHandledIntentId.current) {
      lastHandledIntentId.current = logIntent.requestId;
      const targetClusterId = logIntent.clusterId || selectedClusterId;
      if (logIntent.clusterId) {
        setSelectedClusterId(logIntent.clusterId);
      }
      if (logIntent.namespace) {
        setSelectedNamespace(logIntent.namespace);
      }
      setSelectedPod({
        clusterId: targetClusterId,
        namespace: logIntent.namespace || '',
        name: logIntent.name
      });
      setActiveTab('logs');
      onClearLogIntent?.();
    }
  }, [logIntent, onClearLogIntent, selectedClusterId]);

  const selectedCluster = useMemo(() => {
    return clusters.find((c) => c.id === selectedClusterId) || clusters[0] || null;
  }, [clusters, selectedClusterId]);

  // Fetch resources for active cluster
  const loadClusterResources = async (clusterId: string) => {
    if (!clusterId) return;
    try {
      setLoadingResources(true);
      const res = await api.getClusterResources(clusterId);
      setClusterResources(Array.isArray(res) ? res : []);
    } catch (err) {
      console.warn('[ObservabilityHub] Failed to fetch cluster resources:', err);
      setClusterResources([]);
    } finally {
      setLoadingResources(false);
    }
  };

  // Fetch events for active cluster
  const loadClusterEvents = async (clusterId: string) => {
    if (!clusterId) return;
    try {
      setLoadingEvents(true);
      const evts = await api.getClusterEvents(clusterId);
      setClusterEvents(Array.isArray(evts) ? evts : []);
    } catch (err) {
      console.warn('[ObservabilityHub] Failed to fetch cluster events:', err);
      setClusterEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (selectedCluster?.id) {
      loadClusterResources(selectedCluster.id);
      loadClusterEvents(selectedCluster.id);
    }
  }, [selectedCluster?.id]);

  // Available Pods in this cluster
  const podResources = useMemo(() => {
    return clusterResources.filter((r) => r.kind === 'Pod');
  }, [clusterResources]);

  // Unique namespaces containing pods
  const availableNamespaces = useMemo(() => {
    const set = new Set<string>();
    podResources.forEach((p) => {
      if (p.namespace) set.add(p.namespace);
    });
    return Array.from(set).sort();
  }, [podResources]);

  // Filtered pods by namespace and search
  const filteredPods = useMemo(() => {
    return podResources.filter((p) => {
      const matchNs = selectedNamespace === 'all' || p.namespace === selectedNamespace;
      const matchSearch =
        !podSearchFilter ||
        p.name.toLowerCase().includes(podSearchFilter.toLowerCase()) ||
        p.namespace.toLowerCase().includes(podSearchFilter.toLowerCase());
      return matchNs && matchSearch;
    });
  }, [podResources, selectedNamespace, podSearchFilter]);

  // Canonical active pod resource lookup (kind === 'Pod' AND namespace AND name)
  const activePodResource = useMemo(() => {
    if (!selectedPod) return null;
    return (
      podResources.find(
        (p) =>
          p.kind === 'Pod' &&
          p.namespace === selectedPod.namespace &&
          p.name === selectedPod.name &&
          (selectedPod.uid ? p.uid === selectedPod.uid : true)
      ) || null
    );
  }, [podResources, selectedPod]);

  // NOTE: Per Phase 4, we DO NOT auto-select the first pod when the user opens the logs tab.
  // Pods are only preselected when explicitly requested via a navigation intent.

  if (!clusters.length) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <EmptyState
          icon={<Server className="w-10 h-10 text-zinc-500" />}
          title="No Connected Clusters"
          description="Register or connect a Kubernetes cluster to unlock live observability, metrics, logs, and telemetry streaming."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent text-zinc-100">
      {/* Top Observability Hub Header */}
      <div className="border-b border-sky-500/15 bg-[#030712]/80 backdrop-blur-md px-6 lg:px-8 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-sky-950/60 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0 shadow-[0_0_15px_-3px_rgba(14,165,233,0.3)]">
                <Radio className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-white font-mono">Observability Radar</h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 border border-sky-500/30">
                    Live Stream & Diagnostics
                  </span>
                </div>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  Full-stack infrastructure telemetry, real-time pod log streaming, and cluster audit events.
                </p>
              </div>
            </div>

            {/* Controls: Cluster Selector & Refresh */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-[#081024] border border-sky-500/25 rounded-lg px-3 py-1.5 shadow-xs">
                <Server className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <select
                  aria-label="Select Cluster"
                  value={selectedCluster?.id || ''}
                  onChange={(e) => {
                    setSelectedClusterId(e.target.value);
                    setSelectedPod(null);
                  }}
                  className="bg-transparent text-xs font-mono text-zinc-200 outline-none cursor-pointer pr-2"
                >
                  {clusters.map((c) => (
                    <option key={c.id} value={c.id} className="bg-[#050b18] text-zinc-200">
                      {c.name} ({c.environment || 'production'})
                    </option>
                  ))}
                </select>
                {selectedCluster && <ClusterStatusBadge status={selectedCluster.status} />}
              </div>

              <button
                onClick={() => {
                  if (selectedCluster?.id) {
                    loadClusterResources(selectedCluster.id);
                    loadClusterEvents(selectedCluster.id);
                  }
                  if (onRefresh) onRefresh();
                }}
                title="Refresh telemetry"
                className="p-2 rounded-lg bg-[#081024] hover:bg-[#0c1836] text-zinc-300 hover:text-white border border-sky-500/25 hover:border-sky-500/45 transition-colors cursor-pointer shadow-xs"
              >
                <RefreshCw
                  className={`w-4 h-4 ${loadingResources || loadingEvents ? 'animate-spin text-sky-400' : 'text-zinc-400'}`}
                />
              </button>
            </div>
          </div>

          {/* View Mode Tabs */}
          <div className="flex items-center gap-2 mt-4 border-t border-sky-500/10 pt-3">
            <button
              onClick={() => setActiveTab('metrics')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium font-mono transition-all cursor-pointer ${
                activeTab === 'metrics'
                  ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/30'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Metrics & Telemetry</span>
            </button>

            <button
              onClick={() => setActiveTab('logs')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium font-mono transition-all cursor-pointer ${
                activeTab === 'logs'
                  ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/30'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Live Pod Logs</span>
              {podResources.length > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeTab === 'logs' ? 'bg-sky-900 text-sky-200 border border-sky-400/30' : 'bg-sky-950/60 text-sky-300 border border-sky-800/60'
                  }`}
                >
                  {podResources.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('events')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium font-mono transition-all cursor-pointer ${
                activeTab === 'events'
                  ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white shadow-[0_0_12px_rgba(14,165,233,0.35)] border border-sky-400/40'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/30'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Cluster Events</span>
              {clusterEvents.length > 0 && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    activeTab === 'events' ? 'bg-sky-900 text-sky-200 border border-sky-400/30' : 'bg-sky-950/60 text-sky-300 border border-sky-800/60'
                  }`}
                >
                  {clusterEvents.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area based on active tab */}
      <div className="flex-1 overflow-y-auto">
        {selectedCluster && (
          <>
            {activeTab === 'metrics' && (
              <div className="p-6 lg:p-8 max-w-7xl mx-auto">
                <ClusterObservabilityView
                  clusterId={selectedCluster.id}
                  clusterName={selectedCluster.name}
                  resources={clusterResources}
                />
              </div>
            )}

            {activeTab === 'logs' && (
              <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
                {/* Pod Selection Bar */}
                <div className="flex flex-wrap items-center gap-3 bg-zinc-900/60 border border-zinc-800/80 p-3 rounded-xl">
                  {/* Namespace filter */}
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Filter className="w-3.5 h-3.5" />
                    <span>Namespace:</span>
                    <select
                      aria-label="Filter Namespace"
                      value={selectedNamespace}
                      onChange={(e) => {
                        const newNs = e.target.value;
                        setSelectedNamespace(newNs);
                        // If user switched to a specific namespace and selected pod does not belong to it:
                        // clear selected pod and require a new selection!
                        if (selectedPod && newNs !== 'all' && selectedPod.namespace !== newNs) {
                          setSelectedPod(null);
                        }
                      }}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none cursor-pointer font-mono"
                    >
                      <option value="all">All Namespaces</option>
                      {availableNamespaces.map((ns) => (
                        <option key={ns} value={ns}>
                          {ns}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Pod Search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search pods..."
                      value={podSearchFilter}
                      onChange={(e) => setPodSearchFilter(e.target.value)}
                      className="w-full pl-8 pr-3 py-1 bg-zinc-800/80 border border-zinc-700 rounded text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono"
                    />
                  </div>

                  {/* Pod Selector dropdown */}
                  <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                    <Terminal className="w-3.5 h-3.5 text-sky-400" />
                    <span>Target Pod:</span>
                    <select
                      aria-label="Select Target Pod"
                      value={selectedPod ? `${selectedPod.namespace}/${selectedPod.name}` : ''}
                      onChange={(e) => {
                        const compositeVal = e.target.value;
                        if (!compositeVal) {
                          setSelectedPod(null);
                          return;
                        }
                        const slashIdx = compositeVal.indexOf('/');
                        if (slashIdx === -1) {
                          setSelectedPod(null);
                          return;
                        }
                        const targetNs = compositeVal.slice(0, slashIdx);
                        const targetName = compositeVal.slice(slashIdx + 1);
                        const matched = podResources.find(
                          (p) => p.kind === 'Pod' && p.namespace === targetNs && p.name === targetName
                        );
                        setSelectedPod({
                          clusterId: selectedCluster.id,
                          namespace: targetNs,
                          name: targetName,
                          uid: matched?.uid,
                          container: matched?.containers?.[0]?.name
                        });
                        if (selectedNamespace !== 'all' && selectedNamespace !== targetNs) {
                          setSelectedNamespace(targetNs);
                        }
                      }}
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 outline-none cursor-pointer font-mono max-w-xs"
                    >
                      <option value="">Select a Pod to stream logs...</option>
                      {/* Ensure explicitly selected pod is represented even if filtered out */}
                      {selectedPod &&
                        !filteredPods.some(
                          (p) => p.namespace === selectedPod.namespace && p.name === selectedPod.name
                        ) && (
                          <option
                            key={`${selectedPod.namespace}/${selectedPod.name}`}
                            value={`${selectedPod.namespace}/${selectedPod.name}`}
                          >
                            {selectedPod.namespace}/{selectedPod.name}
                          </option>
                        )}
                      {filteredPods.map((p) => (
                        <option key={`${p.namespace}/${p.name}`} value={`${p.namespace}/${p.name}`}>
                          {p.namespace}/{p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Embedded PodLogsViewer */}
                {selectedPod ? (
                  <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                    <PodLogsViewer
                      key={`${selectedPod.clusterId}:${selectedPod.namespace}:${selectedPod.name}`}
                      clusterId={selectedPod.clusterId}
                      namespace={selectedPod.namespace}
                      podName={selectedPod.name}
                      containers={activePodResource?.containers}
                      initialContainer={selectedPod.container || activePodResource?.containers?.[0]?.name}
                      isEmbedded={true}
                    />
                  </div>
                ) : (
                  <EmptyState
                    icon={<Terminal className="w-8 h-8 text-zinc-500" />}
                    title="Select a Pod to stream logs."
                    description="Choose a pod from the target pod selector above to stream real-time standard output and diagnostic logs."
                  />
                )}
              </div>
            )}

            {activeTab === 'events' && (
              <div className="p-6 lg:p-8 max-w-7xl mx-auto">
                <ClusterEventsView
                  events={clusterEvents}
                  clusterResources={clusterResources}
                  onRefresh={() => loadClusterEvents(selectedCluster.id)}
                  isLoading={loadingEvents}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
