import {
  Boxes,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Layers,
  Server,
  ShieldAlert,
  Terminal
} from 'lucide-react';
import React from 'react';
import { KubernetesResource } from '../../types/index';
import { PodPhaseBadge, WorkloadKindBadge } from '../common/Badges';

interface ResourceRelationshipTreeProps {
  primaryResource: KubernetesResource;
  allClusterResources: KubernetesResource[];
  onSelectResource?: (resource: KubernetesResource) => void;
}

export const ResourceRelationshipTree: React.FC<ResourceRelationshipTreeProps> = ({
  primaryResource,
  allClusterResources = [],
  onSelectResource
}) => {
  const safeClusterResources = Array.isArray(allClusterResources)
    ? allClusterResources.filter((r): r is KubernetesResource => !!r)
    : [];

  const isPod = primaryResource.kind === 'Pod';
  const isWorkload = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(
    primaryResource.kind
  );

  // Helper to find child pods for a workload
  const findChildPods = (workload: KubernetesResource): KubernetesResource[] => {
    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod' || r.namespace !== workload.namespace) return false;

      // Check direct ownerReference
      if (r.ownerReferences && r.ownerReferences.length > 0) {
        const matchesOwner = r.ownerReferences.some(
          (o) =>
            o &&
            ((o.kind === workload.kind && o.name === workload.name) ||
              (workload.kind === 'Deployment' &&
                o.kind === 'ReplicaSet' &&
                o.name?.startsWith(workload.name)) ||
              (workload.kind === 'CronJob' &&
                o.kind === 'Job' &&
                o.name?.startsWith(workload.name)))
        );
        if (matchesOwner) return true;
      }

      // Fallback to Kubernetes standard naming convention
      const prefix = `${workload.name}-`;
      return typeof r.name === 'string' && r.name.startsWith(prefix);
    });
  };

  // Helper to find parent workload for a pod
  const findParentWorkload = (pod: KubernetesResource): { parent?: KubernetesResource; controller?: string } => {
    // Check owner references
    if (pod.ownerReferences && pod.ownerReferences.length > 0) {
      const topOwner = pod.ownerReferences[0];
      if (topOwner && topOwner.kind === 'ReplicaSet') {
        // Find deployment that owns this replica set
        const rsName = topOwner.name || '';
        const dep = safeClusterResources.find(
          (r) =>
            r.kind === 'Deployment' &&
            r.namespace === pod.namespace &&
            rsName.startsWith(`${r.name}-`)
        );
        if (dep) return { parent: dep, controller: rsName };
        return { controller: rsName };
      }
      if (topOwner) {
        const directParent = safeClusterResources.find(
          (r) =>
            r.kind === topOwner.kind &&
            r.name === topOwner.name &&
            r.namespace === pod.namespace
        );
        if (directParent) return { parent: directParent, controller: topOwner.name };
        return { controller: topOwner.name };
      }
    }

    // Name matching fallback
    for (const r of safeClusterResources) {
      if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(r.kind)) {
        if (r.namespace === pod.namespace && pod.name.startsWith(`${r.name}-`)) {
          return { parent: r, controller: pod.name.slice(0, pod.name.lastIndexOf('-')) };
        }
      }
    }

    return {};
  };

  if (isWorkload) {
    const childPods = findChildPods(primaryResource);
    const desired = Number(primaryResource.specSummary?.replicas || 1);
    const ready = Number(
      primaryResource.statusSummary?.readyReplicas ??
      primaryResource.statusSummary?.availableReplicas ??
      0
    );

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            Resource Ownership Hierarchy
          </span>
          <span className="text-[11px] text-zinc-500">
            {primaryResource.kind} ➔ ReplicaSet ➔ Pod ➔ Container
          </span>
        </div>

        {/* Workload Node (Root) */}
        <div className="p-3.5 bg-zinc-950 border border-sky-800/60 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WorkloadKindBadge kind={primaryResource.kind} size="md" />
              <span className="font-bold text-zinc-100 text-sm">{primaryResource.name}</span>
              <span className="text-zinc-500 text-[11px]">({primaryResource.namespace})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 text-zinc-300 border border-zinc-700">
                {ready}/{desired} Ready
              </span>
              <span
                className={`px-2 py-0.5 rounded text-[11px] ${
                  primaryResource.health === 'CRITICAL'
                    ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                    : primaryResource.health === 'WARNING'
                    ? 'bg-amber-950/60 text-amber-300 border border-amber-800/60'
                    : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/60'
                }`}
              >
                {primaryResource.status}
              </span>
            </div>
          </div>
        </div>

        {/* Connecting branch */}
        <div className="pl-6 border-l-2 border-dashed border-zinc-700/80 space-y-3 pt-1">
          {/* ReplicaSet layer for Deployments */}
          {primaryResource.kind === 'Deployment' && (
            <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-zinc-700">
              <div className="p-2.5 bg-zinc-900/60 border border-zinc-800 rounded-lg flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-zinc-300">
                  <span className="px-1.5 py-0.2 rounded bg-slate-900 text-slate-300 text-[10px] border border-slate-700 font-semibold">
                    ReplicaSet
                  </span>
                  <span className="font-semibold text-zinc-200 truncate max-w-xs">
                    {primaryResource.name}-controller
                  </span>
                </div>
                <span className="text-zinc-400">Controls {childPods.length || desired} Pod(s)</span>
              </div>
            </div>
          )}

          {/* Child Pods layer */}
          <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-zinc-700 space-y-2">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
              <span>Managed Pod Replicas ({childPods.length})</span>
            </div>

            {childPods.length === 0 ? (
              <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-500 text-center text-xs">
                No individual pod telemetry currently reported for this workload.
              </div>
            ) : (
              <div className="space-y-2">
                {childPods.map((pod) => {
                  const hasCrash =
                    pod.health === 'CRITICAL' ||
                    pod.status === 'CrashLoopBackOff' ||
                    pod.status === 'ImagePullBackOff';
                  const totalRestarts =
                    pod.containers?.reduce((acc, c) => acc + (c.restartCount || 0), 0) || 0;

                  return (
                    <div
                      key={pod.id}
                      onClick={() => onSelectResource && onSelectResource(pod)}
                      className={`p-3 bg-zinc-950 border rounded-xl space-y-2 transition-all cursor-pointer hover:border-sky-500/70 ${
                        hasCrash
                          ? 'border-rose-800/80 bg-rose-950/10'
                          : 'border-zinc-800 hover:bg-zinc-900/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              hasCrash ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                            }`}
                          />
                          <span className="font-bold text-zinc-200 text-xs truncate">
                            {pod.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <PodPhaseBadge phaseOrStatus={pod.status} restarts={totalRestarts} />
                          {onSelectResource && (
                            <button className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-mono">
                              Inspect Pod →
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Containers inside this pod */}
                      {pod.containers && pod.containers.length > 0 && (
                        <div className="pl-4 border-l border-zinc-800/80 space-y-1 pt-1">
                          {pod.containers.map((c, idx) => (
                            <div
                              key={idx}
                              className="flex items-center justify-between text-[11px] text-zinc-400 py-0.5"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <Terminal className="w-3 h-3 text-zinc-500 shrink-0" />
                                <span className="text-zinc-300 font-semibold">{c.name}</span>
                                <span className="text-zinc-600">({c.image.split(':')[0].split('/').pop()})</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {c.restartCount > 0 && (
                                  <span className="text-rose-400 font-bold text-[10px]">
                                    {c.restartCount} restarts
                                  </span>
                                )}
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[10px] ${
                                    c.ready
                                      ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                                      : 'bg-rose-950/60 text-rose-300 border border-rose-800/40'
                                  }`}
                                >
                                  {c.ready ? 'Ready' : c.waitingReason || 'Not Ready'}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (isPod) {
    const { parent, controller } = findParentWorkload(primaryResource);

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            Pod Ancestry & Container Tree
          </span>
          <span className="text-[11px] text-zinc-500">
            Parent Workload ➔ Controller ➔ Pod ➔ Containers
          </span>
        </div>

        {/* Parent Workload (Ancestor) */}
        {parent ? (
          <div
            onClick={() => onSelectResource && onSelectResource(parent)}
            className="p-3 bg-zinc-950 border border-sky-900/50 hover:border-sky-500/80 rounded-xl cursor-pointer transition-all space-y-1"
          >
            <div className="text-[10px] uppercase text-zinc-500">Parent Workload</div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <WorkloadKindBadge kind={parent.kind} />
                <span className="font-bold text-zinc-100">{parent.name}</span>
                <span className="text-zinc-500 text-[11px]">({parent.namespace})</span>
              </div>
              <span className="text-sky-400 hover:text-sky-300 text-[11px] flex items-center gap-1">
                Inspect Workload <ChevronRight className="w-3 h-3" />
              </span>
            </div>
          </div>
        ) : controller ? (
          <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-400">
            <div className="text-[10px] uppercase text-zinc-500">Controller Reference</div>
            <div className="font-bold text-zinc-200 mt-0.5">{controller}</div>
          </div>
        ) : (
          <div className="p-2.5 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-400 text-[11px]">
            Standalone Pod (No parent controller detected)
          </div>
        )}

        {/* Current Pod (Active Focus) */}
        <div className="pl-6 border-l-2 border-dashed border-sky-600/60 pt-1 space-y-3">
          <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-sky-600">
            <div className="p-3.5 bg-zinc-950 border border-sky-500/80 rounded-xl space-y-2 shadow-lg shadow-sky-950/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <WorkloadKindBadge kind="Pod" size="md" />
                  <span className="font-bold text-zinc-100 text-sm truncate">{primaryResource.name}</span>
                </div>
                <PodPhaseBadge phaseOrStatus={primaryResource.status} />
              </div>
              <div className="text-zinc-400 text-[11px] flex items-center gap-3">
                <span>Namespace: <strong className="text-zinc-200">{primaryResource.namespace}</strong></span>
                <span>•</span>
                <span>Node: <strong className="text-zinc-200">{primaryResource.specSummary?.nodeName as string || 'Scheduled'}</strong></span>
              </div>
            </div>
          </div>

          {/* Containers Layer */}
          <div className="relative pl-8 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-10 before:h-0.5 before:bg-zinc-700 space-y-2">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
              Container Runtime Instances ({primaryResource.containers?.length || 0})
            </div>

            <div className="space-y-2">
              {primaryResource.containers?.map((c, idx) => (
                <div
                  key={idx}
                  className={`p-3 bg-zinc-950 border rounded-xl space-y-1.5 ${
                    !c.ready || c.waitingReason || c.terminationReason
                      ? 'border-rose-900/60 bg-rose-950/20'
                      : 'border-zinc-800'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                      <span className="font-bold text-zinc-100">{c.name}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        c.ready
                          ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
                          : 'bg-rose-950/80 text-rose-300 border border-rose-700/60'
                      }`}
                    >
                      {c.ready ? 'READY' : c.waitingReason || 'NOT READY'}
                    </span>
                  </div>

                  <div className="text-zinc-400 text-[11px] truncate">
                    Image: <span className="text-zinc-200">{c.image}</span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-zinc-400">
                    <span>State: <strong className="text-zinc-300">{c.state}</strong></span>
                    <span>•</span>
                    <span className={c.restartCount > 0 ? 'text-rose-400 font-bold' : ''}>
                      Restarts: {c.restartCount}
                    </span>
                  </div>

                  {c.waitingReason && (
                    <div className="p-2 mt-1 rounded bg-rose-950/50 border border-rose-900/80 text-rose-300 text-[11px]">
                      <strong>Waiting:</strong> {c.waitingReason}
                      {c.waitingMessage && <div className="mt-0.5 text-rose-400">{c.waitingMessage}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400">
      Resource ownership visualization not applicable for {primaryResource.kind}.
    </div>
  );
};
