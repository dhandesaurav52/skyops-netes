import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderTree,
  Activity,
  Layers,
  Boxes,
  Clock,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Cpu,
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X
} from 'lucide-react';
import { Cluster, Incident, K8sEvent, KubernetesResource } from '../../types/index';
import { api } from '../../api/client';
import { Button } from '../common/UI';
import { StatusBadge, SeverityBadge, ResourceHealthBadge, WorkloadKindBadge } from '../common/Badges';
import { formatEventTimestamp } from '../../utils/date';

interface NamespaceDetailModalProps {
  namespaceName: string;
  cluster: Cluster;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectWorkload?: (workload: KubernetesResource) => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
}

const WORKLOAD_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob', 'Rollout'];

export const NamespaceDetailModal: React.FC<NamespaceDetailModalProps> = ({
  namespaceName,
  cluster,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectWorkload,
  onSelectPod,
  onSelectIncident
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'workloads' | 'pods' | 'events' | 'incidents'>('overview');
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const safeClusterResources = useMemo(() => {
    return Array.isArray(clusterResources) ? clusterResources.filter(Boolean) : [];
  }, [clusterResources]);

  const safeIncidents = useMemo(() => {
    return Array.isArray(incidents) ? incidents.filter(Boolean) : [];
  }, [incidents]);

  // Workloads in this namespace
  const workloads = useMemo(() => {
    return safeClusterResources.filter(
      (r) => (r.namespace || 'default') === namespaceName && WORKLOAD_KINDS.includes(r.kind)
    );
  }, [safeClusterResources, namespaceName]);

  // Pods in this namespace
  const pods = useMemo(() => {
    return safeClusterResources.filter(
      (r) => (r.namespace || 'default') === namespaceName && r.kind === 'Pod'
    );
  }, [safeClusterResources, namespaceName]);

  // Incidents in this namespace
  const namespaceIncidents = useMemo(() => {
    return safeIncidents.filter(
      (inc) => inc.clusterId === cluster.id && (inc.namespace || 'default') === namespaceName
    );
  }, [safeIncidents, cluster.id, namespaceName]);

  // Derive Health
  const health = useMemo(() => {
    const allResources = [...workloads, ...pods];
    if (allResources.some((r) => r.health === 'CRITICAL')) return 'CRITICAL';
    if (allResources.some((r) => r.health === 'WARNING')) return 'WARNING';
    if (allResources.length === 0) return 'HEALTHY';
    return 'HEALTHY';
  }, [workloads, pods]);

  // Aggregate resource requests and limits
  const { totalCpuReq, totalCpuLim, totalMemReq, totalMemLim } = useMemo(() => {
    let cpuReqMilli = 0;
    let cpuLimMilli = 0;
    let memReqBytes = 0;
    let memLimBytes = 0;

    for (const pod of pods) {
      if (!Array.isArray(pod.containers)) continue;
      for (const c of pod.containers) {
        if (c.cpuRequest) {
          const match = c.cpuRequest.match(/^(\d+)(m)?$/);
          if (match) {
            cpuReqMilli += match[2] === 'm' ? parseInt(match[1], 10) : parseInt(match[1], 10) * 1000;
          }
        }
        if (c.cpuLimit) {
          const match = c.cpuLimit.match(/^(\d+)(m)?$/);
          if (match) {
            cpuLimMilli += match[2] === 'm' ? parseInt(match[1], 10) : parseInt(match[1], 10) * 1000;
          }
        }
        if (c.memoryRequest) {
          const match = c.memoryRequest.match(/^(\d+)(Mi|Gi|M|G)?$/);
          if (match) {
            const num = parseInt(match[1], 10);
            const unit = match[2] || '';
            if (unit === 'Gi' || unit === 'G') memReqBytes += num * 1024;
            else memReqBytes += num;
          }
        }
        if (c.memoryLimit) {
          const match = c.memoryLimit.match(/^(\d+)(Mi|Gi|M|G)?$/);
          if (match) {
            const num = parseInt(match[1], 10);
            const unit = match[2] || '';
            if (unit === 'Gi' || unit === 'G') memLimBytes += num * 1024;
            else memLimBytes += num;
          }
        }
      }
    }

    return {
      totalCpuReq: cpuReqMilli > 0 ? `${(cpuReqMilli / 1000).toFixed(2)} cores` : 'Not specified',
      totalCpuLim: cpuLimMilli > 0 ? `${(cpuLimMilli / 1000).toFixed(2)} cores` : 'Uncapped',
      totalMemReq: memReqBytes > 0 ? `${memReqBytes} Mi` : 'Not specified',
      totalMemLim: memLimBytes > 0 ? `${memLimBytes} Mi` : 'Uncapped'
    };
  }, [pods]);

  // Load namespace events
  useEffect(() => {
    let isMounted = true;
    setEventsLoading(true);
    api
      .getClusterEvents(cluster.id, {
        namespace: namespaceName,
        limit: 50
      })
      .then((evts) => {
        if (isMounted) setEvents(evts);
      })
      .catch(() => {
        if (isMounted) setEvents([]);
      })
      .finally(() => {
        if (isMounted) setEventsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [cluster.id, namespaceName]);

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
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800 flex items-center gap-1.5">
                <FolderTree className="w-3.5 h-3.5" />
                Namespace
              </span>
              <ResourceHealthBadge health={health} />
              <span className="text-xs font-mono text-zinc-400">
                Cluster: <strong className="text-zinc-200">{cluster.name}</strong>
              </span>
            </div>
            <h2 className="text-xl font-bold text-zinc-100 font-mono truncate">{namespaceName}</h2>
            <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 flex-wrap">
              <span>Workloads: <strong className="text-zinc-300">{workloads.length}</strong></span>
              <span>•</span>
              <span>Pods: <strong className="text-zinc-300">{pods.length}</strong></span>
              <span>•</span>
              <span>Incidents: <strong className={namespaceIncidents.length > 0 ? 'text-amber-400 font-bold' : 'text-zinc-300'}>{namespaceIncidents.length}</strong></span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-5 border-b border-zinc-800 flex items-center gap-1 bg-zinc-950/30 overflow-x-auto text-xs font-mono">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'overview'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            Overview & Telemetry
          </button>
          <button
            onClick={() => setActiveTab('workloads')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'workloads'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Workloads ({workloads.length})
          </button>
          <button
            onClick={() => setActiveTab('pods')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'pods'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Pods ({pods.length})
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3 py-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 ${
              activeTab === 'events'
                ? 'border-indigo-500 text-indigo-300'
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
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Incidents ({namespaceIncidents.length})
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 font-mono text-xs">
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Aggregated Resources Card */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-zinc-200 font-bold">
                      <Cpu className="w-4 h-4 text-indigo-400" />
                      CPU Allocation
                    </span>
                    <span className="text-zinc-500 text-[11px]">{pods.length} Pods</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-300 pt-2 border-t border-zinc-800/80">
                    <div>
                      <span className="text-zinc-500 block text-[10px]">TOTAL REQUEST</span>
                      <span className="text-zinc-200 font-semibold">{totalCpuReq}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">TOTAL LIMIT</span>
                      <span className="text-zinc-200 font-semibold">{totalCpuLim}</span>
                    </div>
                  </div>
                  <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/40">
                    Live Pod Usage: <span className="text-amber-400 font-medium">Data unavailable</span> (requires metrics-server per-namespace aggregation)
                  </div>
                </div>

                <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-zinc-200 font-bold">
                      <Database className="w-4 h-4 text-emerald-400" />
                      Memory Allocation
                    </span>
                    <span className="text-zinc-500 text-[11px]">{pods.length} Pods</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-zinc-300 pt-2 border-t border-zinc-800/80">
                    <div>
                      <span className="text-zinc-500 block text-[10px]">TOTAL REQUEST</span>
                      <span className="text-zinc-200 font-semibold">{totalMemReq}</span>
                    </div>
                    <div>
                      <span className="text-zinc-500 block text-[10px]">TOTAL LIMIT</span>
                      <span className="text-zinc-200 font-semibold">{totalMemLim}</span>
                    </div>
                  </div>
                  <div className="pt-2 text-[11px] text-zinc-500 border-t border-zinc-800/40">
                    Live Pod Usage: <span className="text-amber-400 font-medium">Data unavailable</span> (requires metrics-server per-namespace aggregation)
                  </div>
                </div>
              </div>

              {/* Workload Breakdown */}
              <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-4 space-y-3">
                <h4 className="text-zinc-300 font-bold uppercase text-[11px] tracking-wider">Namespace Summary</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-zinc-300">
                  <div>
                    <span className="text-zinc-500 block text-[10px]">NAMESPACE</span>
                    <span className="text-zinc-200 font-bold">{namespaceName}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">CLUSTER</span>
                    <span className="text-zinc-200">{cluster.name}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">HEALTH STATUS</span>
                    <span className="text-zinc-200">{health}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px]">TOTAL PODS</span>
                    <span className="text-zinc-200 font-bold">{pods.length}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Layers className="w-3.5 h-3.5 text-indigo-400" />}
                  onClick={() => setActiveTab('workloads')}
                >
                  Inspect Workloads ({workloads.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  icon={<Boxes className="w-3.5 h-3.5 text-sky-400" />}
                  onClick={() => setActiveTab('pods')}
                >
                  Inspect Pods ({pods.length})
                </Button>
              </div>
            </div>
          )}

          {/* Workloads Tab */}
          {activeTab === 'workloads' && (
            <div className="space-y-3">
              {workloads.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No workloads found in namespace {namespaceName}.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {workloads.map((w) => (
                    <div
                      key={w.id}
                      onClick={() => onSelectWorkload && onSelectWorkload(w)}
                      className="p-3 hover:bg-zinc-800/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <WorkloadKindBadge kind={w.kind} />
                          <span className="font-bold text-zinc-200 group-hover:text-indigo-300 transition-colors truncate">
                            {w.name}
                          </span>
                          <ResourceHealthBadge health={w.health} />
                        </div>
                        <div className="text-[11px] text-zinc-500">
                          Replicas: {String(w.statusSummary?.readyReplicas || w.statusSummary?.availableReplicas || 0)}/
                          {String(w.specSummary?.replicas || 1)} ready
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectWorkload && onSelectWorkload(w);
                        }}
                        className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 shrink-0"
                      >
                        Inspect
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pods Tab */}
          {activeTab === 'pods' && (
            <div className="space-y-3">
              {pods.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No pods found in namespace {namespaceName}.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {pods.map((p) => {
                    const restarts = p.containers?.reduce((s, c) => s + (c.restartCount || 0), 0) || 0;
                    return (
                      <div
                        key={p.id}
                        onClick={() => onSelectPod && onSelectPod(p)}
                        className="p-3 hover:bg-zinc-800/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-zinc-200 group-hover:text-indigo-300 transition-colors truncate">
                              {p.name}
                            </span>
                            <StatusBadge status={p.status} />
                            <ResourceHealthBadge health={p.health} />
                          </div>
                          <div className="text-[11px] text-zinc-500 flex items-center gap-3">
                            <span>Node: {String(p.specSummary?.nodeName || 'Scheduled')}</span>
                            <span>•</span>
                            <span className={restarts > 0 ? 'text-amber-400 font-semibold' : 'text-zinc-500'}>
                              {restarts} restart{restarts === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectPod && onSelectPod(p);
                          }}
                          className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1 shrink-0"
                        >
                          Inspect
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Events Tab */}
          {activeTab === 'events' && (
            <div className="space-y-3">
              {eventsLoading ? (
                <div className="p-8 text-center text-zinc-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Loading namespace events...
                </div>
              ) : events.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No events recorded in namespace {namespaceName}.
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
                          <span className="text-zinc-500 text-[10px]">
                            {evt.involvedObject?.kind}/{evt.involvedObject?.name}
                          </span>
                          {evt.count > 1 && (
                            <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-zinc-400 text-[10px]">
                              {evt.count}x
                            </span>
                          )}
                        </div>
                        <span className="text-zinc-500 text-[10px]">
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
            <div className="space-y-3">
              {namespaceIncidents.length === 0 ? (
                <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500">
                  No incidents detected in namespace {namespaceName}.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800/70 bg-zinc-950/40">
                  {namespaceIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => onSelectIncident && onSelectIncident(inc.id)}
                      className="p-3 hover:bg-zinc-800/40 transition-colors flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={inc.severity} />
                          <span className="font-bold text-zinc-200 group-hover:text-indigo-300 transition-colors truncate">
                            {inc.title}
                          </span>
                        </div>
                        <div className="text-zinc-500 text-[11px]">
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
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between font-mono text-xs text-zinc-500">
          <div>Cluster: {cluster.name} • Namespace: {namespaceName}</div>
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
