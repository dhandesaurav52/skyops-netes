import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileCode,
  Layers,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Incident, K8sEvent, KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, SeverityBadge, WorkloadKindBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { ResourceRelationshipTree } from './ResourceRelationshipTree';
import { api } from '../../api/client';
import { formatEventTimestamp } from '../../utils/date';

interface WorkloadDetailModalProps {
  workload: KubernetesResource | null;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
  onSelectResource?: (resource: KubernetesResource) => void;
}

export const WorkloadDetailModal: React.FC<WorkloadDetailModalProps> = ({
  workload,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectPod,
  onSelectIncident,
  onSelectResource
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'pods' | 'template' | 'events' | 'incidents' | 'hierarchy' | 'conditions' | 'yaml'>('overview');
  const [events, setEvents] = useState<K8sEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const safeClusterResources = useMemo(() => {
    return Array.isArray(clusterResources)
      ? clusterResources.filter((r): r is KubernetesResource => !!r)
      : [];
  }, [clusterResources]);

  const safeIncidents = useMemo(() => {
    return Array.isArray(incidents)
      ? incidents.filter((i): i is Incident => !!i)
      : [];
  }, [incidents]);

  // Load events for this workload
  useEffect(() => {
    if (!workload) return;
    let isMounted = true;
    setEventsLoading(true);
    api
      .getClusterEvents(workload.clusterId, {
        namespace: workload.namespace,
        kind: workload.kind,
        resourceName: workload.name,
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
  }, [workload?.clusterId, workload?.namespace, workload?.kind, workload?.name]);

  if (!workload) return null;

  // Find child pods with strict Kubernetes hierarchy and bounded matching
  const childPods = useMemo(() => {
    if (!workload) return [];

    // For Deployment: find owned ReplicaSets first
    const ownedRsNames = new Set<string>();
    const ownedRsUids = new Set<string>();
    if (workload.kind === 'Deployment') {
      safeClusterResources.forEach((r) => {
        if (r.kind === 'ReplicaSet' && r.namespace === workload.namespace) {
          const isOwned =
            r.ownerReferences?.some(
              (o) => o && o.kind === 'Deployment' && (o.uid && workload.uid ? o.uid === workload.uid : o.name === workload.name)
            ) ||
            (!r.ownerReferences?.length && (r.name === workload.name || r.name.startsWith(`${workload.name}-`)));
          if (isOwned) {
            ownedRsNames.add(r.name);
            if (r.uid) ownedRsUids.add(r.uid);
          }
        }
      });
    }

    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod' || r.namespace !== workload.namespace) return false;
      if (r.ownerReferences && r.ownerReferences.length > 0) {
        return r.ownerReferences.some((o) => {
          if (!o) return false;
          // Direct owner match
          if (o.kind === workload.kind && (o.uid && workload.uid ? o.uid === workload.uid : o.name === workload.name)) {
            return true;
          }
          // Deployment -> ReplicaSet -> Pod
          if (workload.kind === 'Deployment' && o.kind === 'ReplicaSet') {
            if (o.uid && ownedRsUids.has(o.uid)) return true;
            if (o.name && ownedRsNames.has(o.name)) return true;
            return o.name === workload.name || o.name?.startsWith(`${workload.name}-`);
          }
          // CronJob -> Job -> Pod
          if (workload.kind === 'CronJob' && o.kind === 'Job') {
            return o.name === workload.name || o.name?.startsWith(`${workload.name}-`);
          }
          return false;
        });
      }
      return typeof r.name === 'string' && (r.name === workload.name || r.name.startsWith(`${workload.name}-`));
    });
  }, [workload, safeClusterResources]);

  const crashingPods = childPods.filter(
    (p) =>
      p &&
      (p.health === 'CRITICAL' ||
        p.status === 'CrashLoopBackOff' ||
        p.status === 'ImagePullBackOff' ||
        p.status === 'Failed')
  );

  const desiredReplicas = Number(workload.specSummary?.replicas ?? 1);
  const readyReplicas = Number(
    workload.statusSummary?.readyReplicas ??
    workload.statusSummary?.availableReplicas ??
    0
  );
  const availableReplicas = Number(workload.statusSummary?.availableReplicas ?? 0);
  const updatedReplicas = Number(workload.statusSummary?.updatedReplicas ?? readyReplicas);

  // Compute resource requests & limits from child pods
  const { totalCpuReq, totalCpuLim, totalMemReq, totalMemLim } = useMemo(() => {
    let cpuReqMilli = 0;
    let cpuLimMilli = 0;
    let memReqBytes = 0;
    let memLimBytes = 0;

    for (const pod of childPods) {
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
  }, [childPods]);

  // Pod template spec extraction
  const templateContainers = useMemo(() => {
    const specContainers =
      (workload.specSummary?.template as any)?.spec?.containers ||
      (workload.specSummary?.containers as any[]) ||
      (childPods[0]?.containers as any[]) ||
      [];
    return Array.isArray(specContainers) ? specContainers : [];
  }, [workload.specSummary, childPods]);

  // Find linked and related incidents
  const relatedIncidents = useMemo(() => {
    return safeIncidents.filter(
      (inc) =>
        inc.clusterId === workload.clusterId &&
        ((inc.namespace === workload.namespace && inc.resourceName === workload.name) ||
          childPods.some((p) => p.name === inc.resourceName))
    );
  }, [safeIncidents, workload.clusterId, workload.namespace, workload.name, childPods]);
  const linkedIncident = relatedIncidents[0] || null;

  const isRolloutComplete =
    readyReplicas >= desiredReplicas &&
    availableReplicas >= desiredReplicas &&
    updatedReplicas >= desiredReplicas &&
    crashingPods.length === 0;

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
        <div className="flex items-center border-b border-zinc-800 px-5 gap-1 bg-zinc-950/30 overflow-x-auto no-scrollbar">
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
            onClick={() => setActiveTab('template')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'template'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Pod Template Spec
          </button>
          <button
            onClick={() => setActiveTab('events')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'events'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Events ({events.length})
          </button>
          <button
            onClick={() => setActiveTab('incidents')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'incidents'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Incidents ({relatedIncidents.length})
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
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm font-mono scrollbar-subtle">
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

              {/* Rollout & Deployment Status Card */}
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                    <RefreshCw className={`w-4 h-4 ${isRolloutComplete ? 'text-emerald-400' : 'text-amber-400'}`} />
                    Rollout & Controller Status
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold border ${
                      isRolloutComplete
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                        : 'bg-amber-950 text-amber-300 border-amber-800'
                    }`}
                  >
                    {isRolloutComplete ? 'Rollout Complete' : 'Rollout Progressing / Incomplete'}
                  </span>
                </div>
                <p className="text-xs text-zinc-400">
                  {isRolloutComplete
                    ? `All ${desiredReplicas} replicas are up-to-date, ready, and serving cluster traffic.`
                    : `${readyReplicas} of ${desiredReplicas} replicas ready (${updatedReplicas} updated to current spec).`}
                </p>
                <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      isRolloutComplete ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    style={{
                      width: `${Math.min(100, desiredReplicas > 0 ? (readyReplicas / desiredReplicas) * 100 : 100)}%`
                    }}
                  />
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

              {/* Resource Allocation & Limits */}
              <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  Resource Allocation & Consumption Limits
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-zinc-400">
                  <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 font-bold flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-sky-400" /> CPU Allocation
                      </span>
                      <span className="text-zinc-500 text-[11px]">{childPods.length} Pods</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-zinc-300 pt-1">
                      <div>
                        <span className="text-zinc-500 text-[10px] block">REQUEST</span>
                        <span className="text-zinc-200 font-semibold">{totalCpuReq}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-[10px] block">LIMIT</span>
                        <span className="text-zinc-200 font-semibold">{totalCpuLim}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 bg-zinc-900/60 rounded-lg border border-zinc-800/80 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-400 font-bold flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5 text-emerald-400" /> Memory Allocation
                      </span>
                      <span className="text-zinc-500 text-[11px]">{childPods.length} Pods</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-zinc-300 pt-1">
                      <div>
                        <span className="text-zinc-500 text-[10px] block">REQUEST</span>
                        <span className="text-zinc-200 font-semibold">{totalMemReq}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 text-[10px] block">LIMIT</span>
                        <span className="text-zinc-200 font-semibold">{totalMemLim}</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-zinc-500">
                  Live Usage: <span className="text-amber-400 font-medium">Data unavailable</span> (workload-level real-time utilization requires metrics-server roll-up)
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
                              {pod.nodeName || (pod.specSummary?.nodeName as string) || 'Unassigned'}
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

          {activeTab === 'template' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-sky-400" />
                  Pod Template Specification ({templateContainers.length} Container{templateContainers.length === 1 ? '' : 's'})
                </h3>
                <span className="text-[11px] text-zinc-500">Values & secrets obfuscated for security</span>
              </div>

              {templateContainers.length === 0 ? (
                <div className="p-8 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No container template specifications defined in workload spec.
                </div>
              ) : (
                <div className="space-y-4">
                  {templateContainers.map((c, idx) => {
                    const envKeys = Array.isArray(c.env)
                      ? c.env.map((e: any) => (typeof e === 'string' ? e : e?.name || 'UNKNOWN'))
                      : [];
                    const ports = Array.isArray(c.ports) ? c.ports : [];

                    return (
                      <div key={idx} className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800 text-xs font-bold font-mono">
                              {c.name || `container-${idx}`}
                            </span>
                            {c.ready !== undefined && (
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.ready ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'}`}>
                                {c.ready ? 'Ready' : 'Not Ready'}
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-zinc-400 font-mono break-all">{c.image || 'Image unspecified'}</span>
                        </div>

                        {/* Resource Requests & Limits */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-500 block uppercase">CPU Request</span>
                            <span className="text-zinc-200 font-bold">{c.cpuRequest || c.resources?.requests?.cpu || 'None'}</span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-500 block uppercase">CPU Limit</span>
                            <span className="text-zinc-200 font-bold">{c.cpuLimit || c.resources?.limits?.cpu || 'Uncapped'}</span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-500 block uppercase">Memory Request</span>
                            <span className="text-zinc-200 font-bold">{c.memoryRequest || c.resources?.requests?.memory || 'None'}</span>
                          </div>
                          <div className="p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
                            <span className="text-[10px] text-zinc-500 block uppercase">Memory Limit</span>
                            <span className="text-zinc-200 font-bold">{c.memoryLimit || c.resources?.limits?.memory || 'Uncapped'}</span>
                          </div>
                        </div>

                        {/* Ports */}
                        {ports.length > 0 && (
                          <div className="space-y-1.5">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-bold">Container Ports</span>
                            <div className="flex flex-wrap gap-2">
                              {ports.map((p: any, pIdx: number) => (
                                <span key={pIdx} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 text-[11px]">
                                  {p.containerPort || p.port}/{p.protocol || 'TCP'} {p.name ? `(${p.name})` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Environment Variable Keys Only */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider block font-bold">Environment Variable Keys ({envKeys.length})</span>
                            <span className="text-[10px] text-zinc-500">Keys only — values redacted</span>
                          </div>
                          {envKeys.length === 0 ? (
                            <span className="text-xs text-zinc-500">No environment variables declared in spec.</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {envKeys.map((k: string, kIdx: number) => (
                                <span key={kIdx} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-sky-400 font-mono text-[11px]">
                                  {k}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'events' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-400" />
                  Cluster Events For This Workload ({events.length})
                </h3>
              </div>

              {eventsLoading ? (
                <div className="p-8 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  Streaming events from Kubernetes API...
                </div>
              ) : events.length === 0 ? (
                <div className="p-8 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No events recorded for this workload in namespace {workload.namespace}.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 divide-y divide-zinc-800/60">
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
                      <p className="text-zinc-300 text-xs leading-relaxed">{evt.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'incidents' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-sky-400" />
                  Correlated Incidents ({relatedIncidents.length})
                </h3>
              </div>

              {relatedIncidents.length === 0 ? (
                <div className="p-8 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No active or past incidents correlated with this workload or its pods.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 divide-y divide-zinc-800/60">
                  {relatedIncidents.map((inc) => (
                    <div key={inc.id} className="p-4 space-y-2 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={inc.severity} />
                          <span className="font-bold text-zinc-200">{inc.title}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300">
                            {inc.status}
                          </span>
                        </div>
                        <span className="text-zinc-500 text-xs">
                          {new Date(inc.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-zinc-300 text-xs leading-relaxed">{inc.summary}</p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-zinc-500 font-mono">
                          Target: {inc.resourceKind || workload.kind}/{inc.resourceName || workload.name}
                        </span>
                        {onSelectIncident && (
                          <button
                            onClick={() => {
                              onClose();
                              onSelectIncident(inc.id);
                            }}
                            className="px-2.5 py-1 rounded bg-sky-900/60 hover:bg-sky-800 text-sky-200 text-xs font-bold border border-sky-700 flex items-center gap-1"
                          >
                            Open Incident <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
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
              <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 overflow-x-auto font-mono max-h-96 scrollbar-subtle">
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
