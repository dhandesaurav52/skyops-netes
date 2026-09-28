import React, { useEffect, useMemo, useState } from 'react';
import {
  Server,
  Activity,
  Cpu,
  Database,
  Layers,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Boxes,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Terminal,
  ExternalLink,
  X
} from 'lucide-react';
import { Cluster, Incident, K8sEvent, KubernetesResource, NodeMetricsSummary } from '../../types/index';
import { api } from '../../api/client';
import { Button } from '../common/UI';
import { StatusBadge, SeverityBadge } from '../common/Badges';
import { formatEventTimestamp } from '../../utils/date';

interface NodeDetailModalProps {
  node: KubernetesResource | null;
  cluster: Cluster;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
}

export const NodeDetailModal: React.FC<NodeDetailModalProps> = ({
  node,
  cluster,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectPod,
  onSelectIncident
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'pods' | 'events' | 'incidents' | 'conditions' | 'yaml'>('overview');
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [nodeMetrics, setNodeMetrics] = useState<NodeMetricsSummary | null>(null);

  const safeClusterResources = useMemo(() => {
    return Array.isArray(clusterResources) ? clusterResources.filter(Boolean) : [];
  }, [clusterResources]);

  const safeIncidents = useMemo(() => {
    return Array.isArray(incidents) ? incidents.filter(Boolean) : [];
  }, [incidents]);

  // Pods scheduled on this node
  const scheduledPods = useMemo(() => {
    if (!node) return [];
    return safeClusterResources.filter(
      (r) =>
        r.kind === 'Pod' &&
        ((r.nodeName && r.nodeName === node.name) ||
          ((r.specSummary?.nodeName as string) === node.name))
    );
  }, [node, safeClusterResources]);

  // Incidents related to this node or pods on this node
  const relatedIncidents = useMemo(() => {
    if (!node) return [];
    const scheduledPodNames = new Set(scheduledPods.map((p) => p.name));
    return safeIncidents.filter((inc) => {
      if (inc.clusterId !== cluster.id) return false;
      if (inc.resourceKind === 'Node' && inc.resourceName === node.name) return true;
      if (inc.resourceKind === 'Pod' && scheduledPodNames.has(inc.resourceName)) return true;
      return false;
    });
  }, [node, cluster.id, scheduledPods, safeIncidents]);

  // Fetch live events and node metrics
  useEffect(() => {
    if (!node) return;

    let isMounted = true;
    const fetchObservability = async () => {
      setEventsLoading(true);
      try {
        const [evts, metricsList] = await Promise.all([
          api.getClusterEvents(cluster.id, {
            kind: 'Node',
            resourceName: node.name,
            limit: 50
          }).catch(() => []),
          api.getNodeMetrics(cluster.id).catch(() => [])
        ]);

        if (isMounted) {
          setEvents(evts);
          const found = metricsList.find((m) => m.nodeName === node.name);
          if (found) {
            setNodeMetrics(found);
          }
        }
      } catch (err) {
        console.warn('Failed to load node events/metrics:', err);
      } finally {
        if (isMounted) setEventsLoading(false);
      }
    };

    fetchObservability();
    return () => {
      isMounted = false;
    };
  }, [node?.name, cluster.id]);

  if (!node) return null;

  // Node hardware / spec info
  const statusSummary = node.statusSummary || {};
  const specSummary = node.specSummary || {};
  const nodeInfo = (statusSummary.nodeInfo as Record<string, string>) || {};

  const kubeletVersion =
    nodeInfo.kubeletVersion ||
    (statusSummary.kubeletVersion as string) ||
    (specSummary.kubeletVersion as string) ||
    cluster.k8sVersion ||
    'Unavailable';

  const osImage = nodeInfo.osImage || (statusSummary.osImage as string) || 'Unavailable';
  const architecture = nodeInfo.architecture || (statusSummary.architecture as string) || 'Unavailable';
  const containerRuntime = nodeInfo.containerRuntimeVersion || (statusSummary.containerRuntimeVersion as string) || 'Unavailable';
  const kernelVersion = nodeInfo.kernelVersion || (statusSummary.kernelVersion as string) || 'Unavailable';

  // Capacity & Allocatable
  const capacity = (statusSummary.capacity as Record<string, string>) || {};
  const allocatable = (statusSummary.allocatable as Record<string, string>) || {};

  const cpuCapacity = capacity.cpu || allocatable.cpu || (statusSummary.allocatableCpu as string) || 'Unavailable';
  const memoryCapacity = capacity.memory || allocatable.memory || (statusSummary.allocatableMemory as string) || 'Unavailable';

  // Real Usage from metrics summary (No fabrication)
  const cpuUsage = nodeMetrics?.cpuUsage;
  const cpuPercent = nodeMetrics?.cpuPercent;
  const memoryUsage = nodeMetrics?.memoryUsage;
  const memoryPercent = nodeMetrics?.memoryPercent;
  const isUsageAvailable = nodeMetrics?.isUsageAvailable ?? (statusSummary.metricsAvailable === true);

  // Conditions
  const conditions: Array<{ type: string; status: string; reason?: string; message?: string }> =
    Array.isArray(statusSummary.conditions)
      ? statusSummary.conditions
      : [
          { type: 'Ready', status: node.status === 'Ready' ? 'True' : 'False', reason: 'KubeletReady' },
          { type: 'MemoryPressure', status: 'False', reason: 'KubeletHasSufficientMemory' },
          { type: 'DiskPressure', status: 'False', reason: 'KubeletHasNoDiskPressure' },
          { type: 'PIDPressure', status: 'False', reason: 'KubeletHasSufficientPID' }
        ];

  const isReady = node.status === 'Ready' || conditions.some((c) => c.type === 'Ready' && c.status === 'True');

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-950/60">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-sky-950 text-sky-300 border border-sky-800 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />
                Node
              </span>
              <span
                className={`px-2.5 py-0.5 rounded text-xs font-mono font-bold flex items-center gap-1.5 ${
                  isReady
                    ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                    : 'bg-rose-950/80 text-rose-300 border border-rose-800'
                }`}
              >
                {isReady ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <XCircle className="w-3.5 h-3.5 text-rose-400" />}
                {node.status || (isReady ? 'Ready' : 'NotReady')}
              </span>
              <span className="text-xs font-mono text-zinc-400">
                Cluster: <strong className="text-zinc-200">{cluster.name}</strong>
              </span>
            </div>
            <h2 className="text-xl font-bold text-zinc-100 font-mono truncate">{node.name}</h2>
            <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 flex-wrap">
              <span>OS: <strong className="text-zinc-300">{osImage}</strong></span>
              <span>•</span>
              <span>Arch: <strong className="text-zinc-300">{architecture}</strong></span>
              <span>•</span>
              <span>K8s: <strong className="text-zinc-300">{kubeletVersion}</strong></span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 border-b border-zinc-800 flex items-center gap-1 bg-zinc-950/30 overflow-x-auto text-xs font-mono">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Overview & Metrics
          </button>
          <button
            onClick={() => setActiveTab('pods')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'pods'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Scheduled Pods ({scheduledPods.length})
          </button>
          <button
            onClick={() => setActiveTab('conditions')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'conditions'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Conditions ({conditions.length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'events'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Events ({events.length})
          </button>
          <button
            onClick={() => setActiveTab('incidents')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'incidents'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Related Incidents ({relatedIncidents.length})
          </button>
          <button
            onClick={() => setActiveTab('yaml')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'yaml'
                ? 'border-sky-500 text-sky-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            YAML
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* CPU & Memory Observability Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* CPU Card */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 font-mono space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-zinc-300 font-bold">
                      <Cpu className="w-4 h-4 text-sky-400" />
                      CPU Resource
                    </span>
                    <span className="text-zinc-500 text-[11px]">Capacity: {cpuCapacity}</span>
                  </div>

                  {isUsageAvailable && typeof cpuPercent === 'number' ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400">Usage: {cpuUsage || `${cpuPercent}%`}</span>
                        <span className="font-bold text-zinc-200">{cpuPercent}% utilized</span>
                      </div>
                      <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            cpuPercent > 85 ? 'bg-rose-500' : cpuPercent > 70 ? 'bg-amber-500' : 'bg-sky-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, cpuPercent))}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-3 text-xs text-zinc-400">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Utilization:</span>
                        <span className="text-amber-400 font-bold">Data unavailable</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Metrics not collected by metrics-server or agent. Allocatable: {cpuCapacity}
                      </div>
                    </div>
                  )}
                </div>

                {/* Memory Card */}
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 font-mono space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-zinc-300 font-bold">
                      <Database className="w-4 h-4 text-emerald-400" />
                      Memory Resource
                    </span>
                    <span className="text-zinc-500 text-[11px]">Capacity: {memoryCapacity}</span>
                  </div>

                  {isUsageAvailable && typeof memoryPercent === 'number' ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-400">Usage: {memoryUsage || `${memoryPercent}%`}</span>
                        <span className="font-bold text-zinc-200">{memoryPercent}% utilized</span>
                      </div>
                      <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            memoryPercent > 85 ? 'bg-rose-500' : memoryPercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, memoryPercent))}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-lg p-3 text-xs text-zinc-400">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500">Utilization:</span>
                        <span className="text-amber-400 font-bold">Data unavailable</span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-1">
                        Metrics not collected by metrics-server or agent. Allocatable: {memoryCapacity}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Node System & Hardware Details */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 font-mono text-xs space-y-3">
                <h4 className="text-zinc-300 font-bold uppercase text-[11px] tracking-wider">System Specifications</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-zinc-300">
                  <div>
                    <span className="text-zinc-500 block text-[10px]">KUBELET VERSION</span>
                    <span className="text-zinc-200">{kubeletVersion}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">CONTAINER RUNTIME</span>
                    <span className="text-zinc-200">{containerRuntime}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">OS IMAGE</span>
                    <span className="text-zinc-200">{osImage}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">ARCHITECTURE</span>
                    <span className="text-zinc-200">{architecture}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">KERNEL VERSION</span>
                    <span className="text-zinc-200">{kernelVersion}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">SCHEDULED POD COUNT</span>
                    <span className="text-zinc-200 font-bold">{scheduledPods.length}</span>
                  </div>
                </div>
              </div>

              {/* Quick Links / Actions */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Boxes className="w-3.5 h-3.5 text-sky-400" />}
                  onClick={() => setActiveTab('pods')}
                >
                  View {scheduledPods.length} Scheduled Pods
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Clock className="w-3.5 h-3.5 text-amber-400" />}
                  onClick={() => setActiveTab('events')}
                >
                  View Node Events ({events.length})
                </Button>
              </div>
            </div>
          )}

          {/* Pods Tab */}
          {activeTab === 'pods' && (
            <div className="space-y-3 font-mono text-xs">
              <div className="text-zinc-400 flex items-center justify-between">
                <span>Pods scheduled on <strong className="text-zinc-200">{node.name}</strong>:</span>
                <span className="text-zinc-500">{scheduledPods.length} total</span>
              </div>

              {scheduledPods.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No pods currently scheduled on this node.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {scheduledPods.map((pod) => {
                    const restarts = pod.containers?.reduce((s, c) => s + (c.restartCount || 0), 0) || 0;
                    return (
                      <div
                        key={pod.id}
                        onClick={() => onSelectPod && onSelectPod(pod)}
                        className="p-3 hover:bg-zinc-800/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-zinc-200 group-hover:text-sky-300 transition-colors truncate">
                              {pod.name}
                            </span>
                            <StatusBadge status={pod.status} />
                            <span className="text-[11px] text-zinc-500">ns: {pod.namespace || 'default'}</span>
                          </div>
                          <div className="text-[11px] text-zinc-400 flex items-center gap-3">
                            <span>{pod.containers?.length || 1} container(s)</span>
                            <span>•</span>
                            <span className={restarts > 0 ? 'text-amber-400 font-semibold' : 'text-zinc-500'}>
                              {restarts} restart{restarts === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPod && onSelectPod(pod);
                          }}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 shrink-0"
                        >
                          Inspect Pod
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Conditions Tab */}
          {activeTab === 'conditions' && (
            <div className="space-y-3 font-mono text-xs">
              <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                {conditions.map((cond, idx) => {
                  const isHealthy = cond.type === 'Ready' ? cond.status === 'True' : cond.status === 'False';
                  return (
                    <div key={idx} className="p-3.5 flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-200">{cond.type}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isHealthy
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                            }`}
                          >
                            Status: {cond.status}
                          </span>
                        </div>
                        {cond.reason && (
                          <div className="text-[11px] text-zinc-400 mt-1">Reason: {cond.reason}</div>
                        )}
                        {cond.message && (
                          <div className="text-[11px] text-zinc-500 mt-0.5">{cond.message}</div>
                        )}
                      </div>
                      <span className="text-zinc-500 text-[10px]">Authoritative Kubelet Condition</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Events Tab */}
          {activeTab === 'events' && (
            <div className="space-y-3 font-mono text-xs">
              {eventsLoading ? (
                <div className="p-8 text-center text-zinc-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading node events from cluster...
                </div>
              ) : events.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No events recorded for this node.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {events.map((evt) => (
                    <div key={evt.id} className="p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              evt.type === 'Warning'
                                ? 'bg-amber-950 text-amber-300 border border-amber-800'
                                : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                            }`}
                          >
                            {evt.type}
                          </span>
                          <span className="font-semibold text-zinc-200">{evt.reason}</span>
                          {evt.count > 1 && (
                            <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 text-[10px]">
                              {evt.count}x
                            </span>
                          )}
                        </div>
                        <span className="text-zinc-500 text-[10px] flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatEventTimestamp(evt.lastObserved ?? evt.timestamp ?? evt.lastTimestamp)}
                        </span>
                      </div>
                      <p className="text-zinc-300 text-[11px] leading-relaxed">{evt.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Incidents Tab */}
          {activeTab === 'incidents' && (
            <div className="space-y-3 font-mono text-xs">
              {relatedIncidents.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No active or past incidents associated with this node or its scheduled pods.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {relatedIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => onSelectIncident && onSelectIncident(inc.id)}
                      className="p-3 hover:bg-zinc-800/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={inc.severity} />
                          <span className="font-bold text-zinc-200 group-hover:text-sky-300 transition-colors truncate">
                            {inc.title}
                          </span>
                          <span className="text-zinc-500 text-[10px]">({inc.id})</span>
                        </div>
                        <div className="text-zinc-400 text-[11px]">
                          Target: {inc.resourceKind}/{inc.resourceName} • Type: {inc.incidentType}
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectIncident && onSelectIncident(inc.id);
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 shrink-0"
                      >
                        Open Incident
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* YAML Tab */}
          {activeTab === 'yaml' && (
            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 overflow-x-auto">
              <pre className="font-mono text-xs text-zinc-300 leading-relaxed">
                {JSON.stringify(node, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between font-mono text-xs text-zinc-500">
          <div>UID: {node.id || node.name}</div>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
