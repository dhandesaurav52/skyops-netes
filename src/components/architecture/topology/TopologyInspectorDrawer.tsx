import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  FileCode,
  FileText,
  Globe,
  HardDrive,
  Layers,
  Network,
  Radio,
  Server,
  Shield,
  Sparkles,
  Terminal,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { Incident, KubernetesResource } from '../../../types/index';
import { TopologyNode } from './types';

interface TopologyInspectorDrawerProps {
  node: TopologyNode | null;
  onClose: () => void;
  onOpenDetailsModal: (resource: KubernetesResource) => void;
  onSelectResourceById?: (resourceId: string) => void;
  onSelectIncident?: (incident: Incident) => void;
  onOpenLogs?: (resource: KubernetesResource) => void;
  onOpenAiExplain?: (node: TopologyNode) => void;
}

type InspectorTab = 'overview' | 'metrics' | 'logs' | 'events' | 'topology';

export const TopologyInspectorDrawer: React.FC<TopologyInspectorDrawerProps> = ({
  node,
  onClose,
  onOpenDetailsModal,
  onSelectResourceById,
  onSelectIncident,
  onOpenLogs,
  onOpenAiExplain
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
  const [showKubectlModal, setShowKubectlModal] = useState(false);

  // Reset inspector tab to 'overview' whenever selected node changes (Phase 12)
  React.useEffect(() => {
    setActiveTab('overview');
  }, [node?.id]);

  if (!node) return null;

  const resource = node.resource;
  const kind = node.kind;
  const name = node.name;
  const namespace = node.namespace;
  const health = node.health;
  const incidents = node.incidents || [];
  const backingPods = node.backingPods || [];

  // Helper for Health badge
  const getHealthBadge = () => {
    switch (health) {
      case 'HEALTHY':
        return (
          <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Healthy
          </span>
        );
      case 'WARNING':
        return (
          <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Warning
          </span>
        );
      case 'CRITICAL':
        return (
          <span className="px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-mono flex items-center gap-1.5 animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            Degraded
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 text-xs font-mono">
            Unknown
          </span>
        );
    }
  };

  // Extract container images if available
  const containerImages = (resource?.containers || (resource?.specSummary?.containers as any[]) || []).map(
    (c) => c.image || 'unspecified'
  );

  return (
    <>
      {/* Mobile backdrop for drawer overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
        onClick={onClose}
      />
      <div className="fixed inset-x-0 bottom-0 z-40 max-h-[82vh] md:max-h-full md:relative md:inset-auto w-full md:w-96 lg:w-[420px] bg-zinc-950/95 backdrop-blur-md border-t md:border-t-0 md:border-l border-zinc-800 flex flex-col h-[75vh] md:h-full shadow-2xl transition-all duration-300 rounded-t-2xl md:rounded-none">
        {/* Mobile pull indicator */}
        <div className="w-10 h-1 bg-zinc-700 rounded-full mx-auto mt-2 md:hidden shrink-0" />

        {/* Top Header */}
        <div className="p-4 border-b border-zinc-800 flex flex-col gap-3 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 shrink-0">
                {kind === 'Node' ? (
                  <Cpu className="w-4 h-4 text-emerald-400" />
                ) : kind === 'Service' ? (
                  <Network className="w-4 h-4 text-cyan-400" />
                ) : kind === 'Ingress' ? (
                  <Globe className="w-4 h-4 text-indigo-400" />
                ) : kind === 'PersistentVolumeClaim' ? (
                  <HardDrive className="w-4 h-4 text-amber-400" />
                ) : (
                  <Layers className="w-4 h-4 text-blue-400" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-500">
                  {kind}
                </div>
                <div className="text-sm font-bold text-zinc-100 truncate">{name}</div>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 rounded-lg transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Health status bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getHealthBadge()}
              {node.statusText && (
                <span className="text-xs text-zinc-400 font-mono">{node.statusText}</span>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            {onOpenAiExplain && (
              <button
                onClick={() => onOpenAiExplain(node)}
                className="w-full py-1.5 px-3 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/35 text-xs font-mono font-semibold text-sky-300 flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm"
                title="Generate a contextual explanation of this resource from live cluster telemetry"
              >
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                <span>Explain this Resource with AI</span>
              </button>
            )}

            <button
              onClick={() => setShowKubectlModal(true)}
              className="flex-1 py-1.5 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono text-zinc-300 flex items-center justify-center gap-1.5 transition cursor-pointer"
            >
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
              <span>Kubectl ↗</span>
            </button>

            {resource && (
              <button
                onClick={() => onOpenDetailsModal(resource)}
                className="flex-1 py-1.5 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-mono font-semibold text-zinc-300 flex items-center justify-center gap-1.5 transition cursor-pointer"
              >
                <span>Details</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-zinc-800 px-4 shrink-0 font-mono text-xs">
        {(['overview', 'metrics', 'logs', 'events', 'topology'] as InspectorTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-2.5 px-3 border-b-2 font-medium capitalize transition cursor-pointer ${
              activeTab === tab
                ? 'border-sky-400 text-sky-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Scrollable Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
        {/* ================= OVERVIEW TAB ================= */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Metadata Table */}
            <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 p-3 space-y-2.5">
              <div className="flex justify-between items-center text-[11px]">
                <span className="text-zinc-500">Namespace</span>
                <span className="text-zinc-200 font-semibold px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700/60">
                  {namespace || 'cluster-scoped'}
                </span>
              </div>

              {node.replicas && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-zinc-500">Replicas</span>
                  <span className="text-zinc-200">
                    {node.replicas.ready} / {node.replicas.desired} Ready
                  </span>
                </div>
              )}

              {resource?.createdAt && (
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-zinc-500">Created</span>
                  <span className="text-zinc-300">
                    {new Date(resource.createdAt).toLocaleDateString()}
                  </span>
                </div>
              )}

              {containerImages.length > 0 && (
                <div className="pt-2 border-t border-zinc-800/80">
                  <span className="text-zinc-500 block mb-1">Container Images</span>
                  {containerImages.map((img, idx) => (
                    <div
                      key={idx}
                      className="text-[10px] text-zinc-300 bg-zinc-950 p-1.5 rounded border border-zinc-800 truncate"
                      title={img}
                    >
                      {img}
                    </div>
                  ))}
                </div>
              )}

              {resource?.labels && Object.keys(resource.labels).length > 0 && (
                <div className="pt-2 border-t border-zinc-800/80">
                  <span className="text-zinc-500 block mb-1.5">Labels</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(resource.labels)
                      .slice(0, 6)
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 truncate max-w-[180px]"
                        >
                          {k}: {v}
                        </span>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Backing Pods List if present */}
            {backingPods.length > 0 && (
              <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/80 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-bold text-zinc-300">
                  <span>Pods ({backingPods.length})</span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {backingPods.map((pod) => (
                    <div
                      key={pod.id}
                      onClick={() => onSelectResourceById?.(`pod-${pod.id}`)}
                      className="p-2 rounded-lg bg-zinc-950 hover:bg-zinc-800/80 border border-zinc-800/80 flex items-center justify-between transition cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            pod.health === 'HEALTHY'
                              ? 'bg-emerald-400'
                              : pod.health === 'CRITICAL'
                              ? 'bg-rose-500 animate-pulse'
                              : 'bg-amber-400'
                          }`}
                        />
                        <span className="text-xs text-zinc-200 truncate group-hover:text-sky-400">
                          {pod.name}
                        </span>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                        {pod.status || 'Running'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Active Incidents Banner */}
            {incidents.length > 0 && (
              <div className="bg-rose-950/20 border border-rose-900/60 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-rose-400 font-bold text-xs">
                  <AlertOctagon className="w-4 h-4" />
                  <span>Active Incidents ({incidents.length})</span>
                </div>
                <div className="space-y-2">
                  {incidents.map((inc) => (
                    <div
                      key={inc.id}
                      onClick={() => onSelectIncident?.(inc)}
                      className="p-2 bg-zinc-950/80 rounded-lg border border-rose-900/40 hover:border-rose-500/60 transition cursor-pointer"
                    >
                      <div className="text-xs font-semibold text-rose-300">{inc.title}</div>
                      <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                        <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-bold">
                          {inc.severity}
                        </span>
                        <span>{new Date(inc.firstSeenAt).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= METRICS TAB ================= */}
        {activeTab === 'metrics' && (
          <div className="space-y-4">
            {node.metrics?.isAvailable ? (
              <div className="space-y-3">
                <div className="p-3 bg-zinc-900/60 rounded-xl border border-zinc-800">
                  <div className="text-zinc-500 text-[10px] uppercase">CPU Telemetry</div>
                  <div className="text-lg font-bold text-zinc-100 mt-0.5">
                    {node.metrics.cpu}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1">Observed agent telemetry</div>
                </div>

                <div className="p-3 bg-zinc-900/60 rounded-xl border border-zinc-800">
                  <div className="text-zinc-500 text-[10px] uppercase">Memory Telemetry</div>
                  <div className="text-lg font-bold text-zinc-100 mt-0.5">
                    {node.metrics.memory}
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1">Observed agent telemetry</div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-center space-y-2">
                <Activity className="w-6 h-6 text-zinc-600 mx-auto" />
                <div className="text-xs font-semibold text-zinc-300">Metrics Unavailable</div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Metrics Server is not active or container CPU/Memory metrics were not reported in this cluster.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ================= LOGS TAB ================= */}
        {activeTab === 'logs' && (
          <div className="space-y-3">
            <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-center space-y-2.5">
              <Terminal className="w-6 h-6 text-sky-400 mx-auto" />
              <div className="text-xs font-semibold text-zinc-300">Container Log Stream</div>
              <p className="text-[11px] text-zinc-500">
                View real-time stdout / stderr output from containers belonging to this resource.
              </p>
              {resource && onOpenLogs && (
                <button
                  onClick={() => onOpenLogs(resource)}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-xs inline-flex items-center gap-1.5 transition cursor-pointer shadow-sm"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Open in Live Pod Logs →</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* ================= EVENTS TAB ================= */}
        {activeTab === 'events' && (
          <div className="space-y-3">
            {resource?.events && resource.events.length > 0 ? (
              <div className="space-y-2">
                {resource.events.map((evt, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800 text-[11px] space-y-1"
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-bold text-amber-400">{evt.reason || 'Event'}</span>
                      <span className="text-zinc-500">
                        {evt.lastTimestamp ? new Date(evt.lastTimestamp).toLocaleTimeString() : ''}
                      </span>
                    </div>
                    <div className="text-zinc-300">{evt.message}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-center space-y-2">
                <CheckCircle2 className="w-6 h-6 text-zinc-600 mx-auto" />
                <div className="text-xs font-semibold text-zinc-300">No Warning Events</div>
                <p className="text-[11px] text-zinc-500">
                  No active abnormal events recorded by Kubernetes for this resource.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ================= TOPOLOGY TAB ================= */}
        {activeTab === 'topology' && (
          <div className="space-y-3">
            <div className="text-[11px] text-zinc-400">
              Directly connected upstream and downstream components in the cluster mesh:
            </div>
            <div className="space-y-1.5">
              <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-500">Domain</span>
                <span className="text-sky-400 font-semibold uppercase text-[10px]">
                  {node.domainId}
                </span>
              </div>
              {backingPods.length > 0 && (
                <div className="p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800 flex items-center justify-between">
                  <span className="text-zinc-500">Backing Pods</span>
                  <span className="text-zinc-200">{backingPods.length} pods</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Kubectl Command Modal / Popover */}
      {showKubectlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 max-w-lg w-full space-y-4 shadow-2xl font-mono">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-zinc-100 font-bold text-sm">
                <Terminal className="w-4 h-4 text-sky-400" />
                <span>Kubectl Command Reference</span>
              </div>
              <button
                onClick={() => setShowKubectlModal(false)}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <span className="text-zinc-500 block mb-1">Describe Resource:</span>
                <div className="p-2.5 bg-zinc-900 rounded border border-zinc-800 text-sky-300 overflow-x-auto select-all">
                  kubectl describe {kind.toLowerCase()} {name} {namespace ? `-n ${namespace}` : ''}
                </div>
              </div>

              <div>
                <span className="text-zinc-500 block mb-1">Get YAML Manifest:</span>
                <div className="p-2.5 bg-zinc-900 rounded border border-zinc-800 text-sky-300 overflow-x-auto select-all">
                  kubectl get {kind.toLowerCase()} {name} {namespace ? `-n ${namespace}` : ''} -o yaml
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowKubectlModal(false)}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs cursor-pointer font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
};
