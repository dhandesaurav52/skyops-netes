import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  RefreshCw,
  Server,
  Terminal,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { Incident, KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, SeverityBadge, WorkloadKindBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { ResourceRelationshipTree } from './ResourceRelationshipTree';

interface WorkloadDetailModalProps {
  workload: KubernetesResource | null;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
}

export const WorkloadDetailModal: React.FC<WorkloadDetailModalProps> = ({
  workload,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectPod,
  onSelectIncident
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'pods' | 'hierarchy' | 'conditions' | 'yaml'>('overview');

  if (!workload) return null;

  // Find child pods
  const childPods = clusterResources.filter((r) => {
    if (r.kind !== 'Pod' || r.namespace !== workload.namespace) return false;
    if (r.ownerReferences && r.ownerReferences.length > 0) {
      return r.ownerReferences.some(
        (o) =>
          (o.kind === workload.kind && o.name === workload.name) ||
          (workload.kind === 'Deployment' && o.kind === 'ReplicaSet' && o.name?.startsWith(workload.name)) ||
          (workload.kind === 'CronJob' && o.kind === 'Job' && o.name?.startsWith(workload.name))
      );
    }
    return r.name.startsWith(`${workload.name}-`);
  });

  const crashingPods = childPods.filter(
    (p) =>
      p.health === 'CRITICAL' ||
      p.status === 'CrashLoopBackOff' ||
      p.status === 'ImagePullBackOff' ||
      p.status === 'Failed'
  );

  const desiredReplicas = Number(workload.specSummary?.replicas ?? 1);
  const readyReplicas = Number(
    workload.statusSummary?.readyReplicas ??
    workload.statusSummary?.availableReplicas ??
    0
  );
  const availableReplicas = Number(workload.statusSummary?.availableReplicas ?? 0);
  const updatedReplicas = Number(workload.statusSummary?.updatedReplicas ?? readyReplicas);

  // Find linked incident if any
  const linkedIncident = incidents.find(
    (inc) =>
      inc.clusterId === workload.clusterId &&
      inc.namespace === workload.namespace &&
      inc.resourceName === workload.name
  );

  const isDegraded = workload.health !== 'HEALTHY' || crashingPods.length > 0 || readyReplicas < desiredReplicas;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-950/60">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <WorkloadKindBadge kind={workload.kind} size="md" />
              <h2 className="text-lg font-bold text-zinc-100 font-mono truncate">{workload.name}</h2>
              <ResourceHealthBadge health={workload.health} size="md" />
              <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
                {workload.status}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
              <span>Cluster: <strong className="text-zinc-200">{workload.clusterName || workload.clusterId}</strong></span>
              <span>•</span>
              <span>Namespace: <strong className="text-zinc-200">{workload.namespace}</strong></span>
              <span>•</span>
              <span>Replicas: <strong className="text-zinc-200">{readyReplicas}/{desiredReplicas} Ready</strong></span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Degraded Alert Banner */}
        {isDegraded && (
          <div className="p-4 bg-amber-950/40 border-b border-amber-900/60 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-300 font-bold">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  WORKLOAD DEGRADED: {readyReplicas}/{desiredReplicas} replicas available
                  {crashingPods.length > 0 && ` • ${crashingPods.length} pod(s) failing`}
                </span>
              </div>
            </div>

            {linkedIncident && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-300">
                  Associated Incident: <strong className="text-sky-400">{linkedIncident.id}</strong> — {linkedIncident.title}
                </span>
                {onSelectIncident && (
                  <button
                    onClick={() => {
                      onClose();
                      onSelectIncident(linkedIncident.id);
                    }}
                    className="px-2.5 py-1 rounded bg-sky-900/60 hover:bg-sky-800 text-sky-200 text-xs font-bold border border-sky-700 flex items-center gap-1"
                  >
                    Investigate in Incident Console <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex items-center border-b border-zinc-800 px-5 gap-1 bg-zinc-950/30 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Overview & Replicas
          </button>
          <button
            onClick={() => setActiveTab('pods')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'pods'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Pods ({childPods.length})
            {crashingPods.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('hierarchy')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'hierarchy'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Relationship Tree
          </button>
          <button
            onClick={() => setActiveTab('conditions')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'conditions'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Conditions ({workload.conditions?.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('yaml')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === 'yaml'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Raw Spec
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm font-mono">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Replica KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Desired Replicas</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{desiredReplicas}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Ready Replicas</div>
                  <div className={`text-xl font-bold mt-1 ${readyReplicas < desiredReplicas ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {readyReplicas}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Available Replicas</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{availableReplicas}</div>
                </div>
                <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Updated Replicas</div>
                  <div className="text-xl font-bold text-zinc-100 mt-1">{updatedReplicas}</div>
                </div>
              </div>

              {/* Workload Specifications */}
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-sky-400" />
                  Workload Metadata & Deployment Strategy
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400">
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase">Deployment Strategy</span>
                    <span className="text-zinc-200 font-bold">
                      {(workload.specSummary?.strategy as any)?.type || 'RollingUpdate'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase">Namespace Scope</span>
                    <span className="text-zinc-200 font-bold">{workload.namespace}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase">Created At</span>
                    <span className="text-zinc-200">{new Date(workload.createdAt).toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block text-[10px] uppercase">Telemetry Last Updated</span>
                    <span className="text-zinc-200">{new Date(workload.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pods' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-sky-400" />
                  Pods Managed By This Workload ({childPods.length})
                </h3>
              </div>

              {childPods.length === 0 ? (
                <div className="p-8 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No individual pod records currently ingested for this workload.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase">
                      <tr>
                        <th className="p-3">Pod Name</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Containers</th>
                        <th className="p-3">Restarts</th>
                        <th className="p-3">Node</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60">
                      {childPods.map((pod) => {
                        const totalR = pod.containers?.reduce((acc, c) => acc + (c.restartCount || 0), 0) || 0;
                        const readyC = pod.containers?.filter((c) => c.ready).length || 0;
                        const totalC = pod.containers?.length || 1;

                        return (
                          <tr key={pod.id} className="hover:bg-zinc-900/40 transition-colors">
                            <td className="p-3 font-bold text-zinc-200 max-w-[200px] truncate">{pod.name}</td>
                            <td className="p-3">
                              <PodPhaseBadge phaseOrStatus={pod.status} />
                            </td>
                            <td className="p-3 text-zinc-300">
                              <span className={readyC < totalC ? 'text-rose-400 font-bold' : ''}>
                                {readyC}/{totalC} Ready
                              </span>
                            </td>
                            <td className="p-3">
                              <span className={totalR > 0 ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                                {totalR}
                              </span>
                            </td>
                            <td className="p-3 text-zinc-400 max-w-[150px] truncate">
                              {pod.specSummary?.nodeName as string || 'Scheduled'}
                            </td>
                            <td className="p-3 text-right">
                              {onSelectPod && (
                                <button
                                  onClick={() => onSelectPod(pod)}
                                  className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-sky-900/50 hover:text-sky-300 text-zinc-300 rounded font-mono transition-colors"
                                >
                                  Inspect Pod →
                                </button>
                              )}
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

          {activeTab === 'hierarchy' && (
            <ResourceRelationshipTree
              primaryResource={workload}
              allClusterResources={clusterResources}
              onSelectResource={(r) => {
                if (r.kind === 'Pod' && onSelectPod) {
                  onSelectPod(r);
                }
              }}
            />
          )}

          {activeTab === 'conditions' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-sky-400" />
                Workload Lifecycle Conditions
              </h3>

              {(!workload.conditions || workload.conditions.length === 0) ? (
                <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  All deployment controller conditions reporting nominal status.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 divide-y divide-zinc-800/60">
                  {workload.conditions.map((c, i) => (
                    <div key={i} className="p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-zinc-200">{c.type}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              c.status === 'True'
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-rose-950 text-rose-300 border border-rose-800'
                            }`}
                          >
                            {c.status}
                          </span>
                        </div>
                        <span className="text-zinc-500 text-[10px]">{c.reason}</span>
                      </div>
                      {c.message && <div className="text-zinc-400 text-xs">{c.message}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'yaml' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Raw Workload Definition</div>
              <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 overflow-x-auto font-mono max-h-96">
                {JSON.stringify(workload, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <span className="text-xs font-mono text-zinc-500">
            Resource UID: {workload.uid || workload.id}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
