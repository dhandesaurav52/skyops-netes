import {
  AlertTriangle,
  Boxes,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Cpu,
  Database,
  HardDrive,
  Info,
  Layers,
  Network,
  Radio,
  Server,
  ShieldAlert,
  Terminal
} from 'lucide-react';
import React, { Component, useMemo } from 'react';
import { KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, WorkloadKindBadge } from '../common/Badges';

interface TopologyErrorBoundaryProps {
  children: React.ReactNode;
}

interface TopologyErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

class TopologyErrorBoundary extends Component<TopologyErrorBoundaryProps, TopologyErrorBoundaryState> {
  override state: TopologyErrorBoundaryState = { hasError: false };

  constructor(props: TopologyErrorBoundaryProps) {
    super(props);
  }

  static getDerivedStateFromError(error: Error): TopologyErrorBoundaryState {
    return { hasError: true, errorMessage: error.message };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.warn('Topology Graph encountered a render error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 bg-zinc-950 border border-amber-800/60 rounded-xl space-y-2 text-xs font-mono">
          <div className="flex items-center gap-2 text-amber-400 font-semibold">
            <AlertTriangle className="w-4 h-4" />
            <span>Unable to render topology graph</span>
          </div>
          <p className="text-zinc-400 text-[11px]">
            An unexpected error occurred while resolving resource relationships: {this.state.errorMessage || 'Unknown error'}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ResourceRelationshipTreeProps {
  primaryResource: KubernetesResource;
  allClusterResources: KubernetesResource[];
  onSelectResource?: (resource: KubernetesResource) => void;
}

const ResourceRelationshipTreeInner: React.FC<ResourceRelationshipTreeProps> = ({
  primaryResource,
  allClusterResources = [],
  onSelectResource
}) => {
  const safeClusterResources = useMemo(() => {
    return Array.isArray(allClusterResources)
      ? allClusterResources.filter((r): r is KubernetesResource => !!r)
      : [];
  }, [allClusterResources]);

  if (!primaryResource || typeof primaryResource !== 'object' || !primaryResource.kind) {
    return (
      <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <span>No verified topology relationships found.</span>
      </div>
    );
  }

  const isPod = primaryResource.kind === 'Pod';
  const isWorkload = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(
    primaryResource.kind
  );
  const isNode = primaryResource.kind === 'Node';
  const isService = primaryResource.kind === 'Service';
  const isPVC = primaryResource.kind === 'PersistentVolumeClaim';

  // Helper to find child pods for a workload
  const findChildPods = (workload: KubernetesResource): KubernetesResource[] => {
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

      // Check direct ownerReference
      if (r.ownerReferences && r.ownerReferences.length > 0) {
        const matchesOwner = r.ownerReferences.some((o) => {
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
        if (matchesOwner) return true;
      }

      // Fallback to Kubernetes standard naming convention (strictly bounded)
      const prefix = `${workload.name}-`;
      return typeof r.name === 'string' && (r.name === workload.name || r.name.startsWith(prefix));
    });
  };

  // Helper to find parent workload for a pod
  const findParentWorkload = (pod: KubernetesResource): { parent?: KubernetesResource; controller?: string } => {
    if (pod.ownerReferences && pod.ownerReferences.length > 0) {
      const topOwner = pod.ownerReferences[0];
      if (topOwner && topOwner.kind === 'ReplicaSet') {
        const rsName = topOwner.name || '';
        // Look for ReplicaSet resource to check its ownerReferences
        const rsResource = safeClusterResources.find(
          (r) => r.kind === 'ReplicaSet' && r.namespace === pod.namespace && (topOwner.uid ? r.uid === topOwner.uid : r.name === rsName)
        );
        if (rsResource?.ownerReferences?.length) {
          const rsOwner = rsResource.ownerReferences.find((o) => o && o.kind === 'Deployment');
          if (rsOwner) {
            const dep = safeClusterResources.find(
              (r) => r.kind === 'Deployment' && r.namespace === pod.namespace && (rsOwner.uid ? r.uid === rsOwner.uid : r.name === rsOwner.name)
            );
            if (dep) return { parent: dep, controller: rsName };
          }
        }
        // Fallback bounded matching
        const dep = safeClusterResources.find(
          (r) =>
            r.kind === 'Deployment' &&
            r.namespace === pod.namespace &&
            (rsName === r.name || rsName.startsWith(`${r.name}-`))
        );
        if (dep) return { parent: dep, controller: rsName };
        return { controller: rsName };
      }
      if (topOwner) {
        const directParent = safeClusterResources.find(
          (r) =>
            r.kind === topOwner.kind &&
            (topOwner.uid ? r.uid === topOwner.uid : r.name === topOwner.name) &&
            r.namespace === pod.namespace
        );
        if (directParent) return { parent: directParent, controller: topOwner.name };
        return { controller: topOwner.name };
      }
    }

    // Name prefix fallback (strictly bounded)
    for (const r of safeClusterResources) {
      if (['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(r.kind)) {
        if (r.namespace === pod.namespace && (pod.name === r.name || pod.name.startsWith(`${r.name}-`))) {
          return { parent: r, controller: pod.name.slice(0, pod.name.lastIndexOf('-')) };
        }
      }
    }

    return {};
  };

  // Helper to find the Node running a Pod
  const findPodNode = (pod: KubernetesResource): KubernetesResource | undefined => {
    const nodeName =
      pod.nodeName ||
      (pod.specSummary?.nodeName as string) ||
      ((pod as any).spec?.nodeName as string);
    if (!nodeName) return undefined;
    return safeClusterResources.find((r) => r.kind === 'Node' && r.name === nodeName);
  };

  // Helper to find Services selecting a Pod
  const findPodServices = (pod: KubernetesResource): KubernetesResource[] => {
    const podLabels = pod.labels || {};
    if (Object.keys(podLabels).length === 0) return [];

    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Service' || r.namespace !== pod.namespace) return false;
      const selector = (r.specSummary?.selector as Record<string, string>) || (r as any).spec?.selector;
      if (!selector || typeof selector !== 'object' || Object.keys(selector).length === 0) {
        return false;
      }
      return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
    });
  };

  // Helper to find PVCs referenced by a Pod
  const findPodPVCs = (pod: KubernetesResource): KubernetesResource[] => {
    const volumes = (pod.specSummary?.volumes as any[]) || (pod as any).spec?.volumes || [];
    const claimNames = new Set<string>();
    for (const v of volumes) {
      if (v?.persistentVolumeClaim?.claimName) {
        claimNames.add(v.persistentVolumeClaim.claimName);
      }
    }
    if (claimNames.size === 0) return [];
    return safeClusterResources.filter(
      (r) => r.kind === 'PersistentVolumeClaim' && r.namespace === pod.namespace && claimNames.has(r.name)
    );
  };

  // Helper to find Pods running on a Node
  const findNodePods = (node: KubernetesResource): KubernetesResource[] => {
    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod') return false;
      const nodeName =
        r.nodeName ||
        (r.specSummary?.nodeName as string) ||
        ((r as any).spec?.nodeName as string);
      return nodeName === node.name;
    });
  };

  // Helper to find Pods mounting a PVC
  const findPVCPods = (pvc: KubernetesResource): KubernetesResource[] => {
    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod' || r.namespace !== pvc.namespace) return false;
      const volumes = (r.specSummary?.volumes as any[]) || (r as any).spec?.volumes || [];
      return volumes.some((v) => v?.persistentVolumeClaim?.claimName === pvc.name);
    });
  };

  // Helper to find Pods selected by a Service
  const findServicePods = (service: KubernetesResource): KubernetesResource[] => {
    const selector =
      (service.specSummary?.selector as Record<string, string>) ||
      (service as any).spec?.selector;
    if (!selector || typeof selector !== 'object' || Object.keys(selector).length === 0) {
      return [];
    }

    const serviceNs = (service.namespace || 'default').toLowerCase();
    return safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod') return false;
      const podNs = (r.namespace || 'default').toLowerCase();
      if (podNs !== serviceNs) return false;
      const podLabels = (r.labels || r.specSummary?.labels || (r as any).metadata?.labels || {}) as Record<string, string>;
      return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
    });
  };

  // 1. WORKLOAD VIEW (Deployment, StatefulSet, DaemonSet, Job)
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
            Workload Hierarchy & Topology
          </span>
          <span className="text-[11px] text-zinc-500">
            {primaryResource.kind} ➔ ReplicaSet ➔ Pods ({childPods.length}) ➔ Containers
          </span>
        </div>

        {/* Workload Root */}
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
              <ResourceHealthBadge health={primaryResource.health} size="sm" />
            </div>
          </div>
        </div>

        {/* Child Pods Tree */}
        <div className="pl-6 border-l-2 border-dashed border-zinc-700/80 space-y-3 pt-1">
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

          <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-zinc-700 space-y-2">
            <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
              Managed Pod Replicas ({childPods.length})
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

                      {/* Containers */}
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
                              </div>
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

  // 2. POD VIEW
  if (isPod) {
    const { parent, controller } = findParentWorkload(primaryResource);
    const node = findPodNode(primaryResource);
    const services = findPodServices(primaryResource);
    const pvcs = findPodPVCs(primaryResource);
    const nodeName =
      primaryResource.nodeName ||
      (primaryResource.specSummary?.nodeName as string) ||
      ((primaryResource as any).spec?.nodeName as string) ||
      'Unassigned';

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            Pod Topology & Upstream / Downstream Links
          </span>
          <span className="text-[11px] text-zinc-500">
            Workload Parent ➔ Pod ➔ Node & Services
          </span>
        </div>

        {/* Upstream Parent Workload */}
        {parent ? (
          <div
            onClick={() => onSelectResource && onSelectResource(parent)}
            className="p-3 bg-zinc-950 border border-sky-900/50 hover:border-sky-500/80 rounded-xl cursor-pointer transition-all space-y-1"
          >
            <div className="text-[10px] uppercase text-zinc-500 flex items-center justify-between">
              <span>Parent Workload (Owner)</span>
              <span className="text-sky-400 flex items-center gap-1">
                Inspect <ChevronRight className="w-3 h-3" />
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <WorkloadKindBadge kind={parent.kind} />
                <span className="font-bold text-zinc-100">{parent.name}</span>
                <span className="text-zinc-500 text-[11px]">({parent.namespace})</span>
              </div>
              <ResourceHealthBadge health={parent.health} size="sm" />
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

        {/* Current Pod Card */}
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
              </div>
            </div>
          </div>

          {/* Connected Host Node & Connected Services Grid */}
          <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-zinc-700 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Scheduled Node */}
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
                <div className="text-[10px] uppercase text-zinc-500 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Server className="w-3 h-3 text-sky-400" />
                    Scheduled Node
                  </span>
                  {node && onSelectResource && (
                    <button
                      onClick={() => onSelectResource(node)}
                      className="text-sky-400 hover:text-sky-300 text-[10px] flex items-center gap-0.5"
                    >
                      Inspect Node →
                    </button>
                  )}
                </div>
                <div className="font-bold text-zinc-100 text-xs truncate">{nodeName}</div>
                {node ? (
                  <div className="text-[11px] text-zinc-400 flex items-center gap-2 pt-0.5">
                    <span className="px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300">
                      {node.status || 'Ready'}
                    </span>
                    <span>Allocatable CPU: {node.metrics?.cpu?.allocatable?.formatted || 'Allocated'}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-500">Node telemetry not collected</div>
                )}
              </div>

              {/* Matched Services */}
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
                <div className="text-[10px] uppercase text-zinc-500 flex items-center gap-1">
                  <Network className="w-3 h-3 text-emerald-400" />
                  Targeted by Services ({services.length})
                </div>
                {services.length === 0 ? (
                  <div className="text-[11px] text-zinc-500">No matching service selectors</div>
                ) : (
                  <div className="space-y-1 pt-0.5">
                    {services.map((svc) => (
                      <div
                        key={svc.id}
                        onClick={() => onSelectResource && onSelectResource(svc)}
                        className="flex items-center justify-between text-[11px] text-zinc-300 hover:text-sky-300 cursor-pointer"
                      >
                        <span className="font-semibold truncate">{svc.name}</span>
                        <span className="text-[10px] text-zinc-500">
                          {((svc.specSummary?.type as string) || 'ClusterIP')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Persistent Volume Claims */}
            {pvcs.length > 0 && (
              <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
                <div className="text-[10px] uppercase text-zinc-500 flex items-center gap-1">
                  <Database className="w-3 h-3 text-amber-400" />
                  Mounted Storage Claims ({pvcs.length})
                </div>
                <div className="space-y-1">
                  {pvcs.map((pvc) => (
                    <div
                      key={pvc.id}
                      onClick={() => onSelectResource && onSelectResource(pvc)}
                      className="flex items-center justify-between text-[11px] text-zinc-300 hover:text-sky-300 cursor-pointer"
                    >
                      <span className="font-semibold">{pvc.name}</span>
                      <span className="text-[10px] text-zinc-500">
                        {pvc.status} • {((pvc.specSummary?.storage as string) || 'Bound')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. NODE VIEW
  if (isNode) {
    const scheduledPods = findNodePods(primaryResource);
    const ready = primaryResource.status === 'Ready';

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5 text-sky-400" />
            Node Infrastructure Topology
          </span>
          <span className="text-[11px] text-zinc-500">
            Node ➔ Scheduled Pods ({scheduledPods.length})
          </span>
        </div>

        {/* Node Card */}
        <div className="p-4 bg-zinc-950 border border-sky-800/60 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-4 h-4 text-sky-400" />
              <span className="font-bold text-zinc-100 text-sm">{primaryResource.name}</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                ready
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/60'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-700/60'
              }`}
            >
              {primaryResource.status || 'Ready'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] text-zinc-400 border-t border-zinc-800/60">
            <div>
              <span className="text-zinc-500">Scheduled Pods:</span>{' '}
              <strong className="text-zinc-200">{scheduledPods.length}</strong>
            </div>
            <div>
              <span className="text-zinc-500">OS / Arch:</span>{' '}
              <strong className="text-zinc-200">
                {(primaryResource.statusSummary?.nodeInfo as any)?.osImage || 'Linux'}
              </strong>
            </div>
            <div>
              <span className="text-zinc-500">Kubelet:</span>{' '}
              <strong className="text-zinc-200">
                {(primaryResource.statusSummary?.nodeInfo as any)?.kubeletVersion || 'v1.30+'}
              </strong>
            </div>
            <div>
              <span className="text-zinc-500">Health:</span>{' '}
              <strong className="text-zinc-200">{primaryResource.health}</strong>
            </div>
          </div>
        </div>

        {/* Scheduled Pods on this Node */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>Pods Hosted on this Node ({scheduledPods.length})</span>
          </div>

          {scheduledPods.length === 0 ? (
            <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
              No pods currently scheduled or running on this node.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {scheduledPods.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onSelectResource && onSelectResource(p)}
                  className="p-3 bg-zinc-950 border border-zinc-800 hover:border-sky-500/70 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="truncate space-y-0.5">
                    <div className="font-bold text-zinc-200 text-xs truncate">{p.name}</div>
                    <div className="text-[10px] text-zinc-500 truncate">ns: {p.namespace}</div>
                  </div>
                  <PodPhaseBadge phaseOrStatus={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 4. SERVICE VIEW
  if (isService) {
    const serviceNs = (primaryResource.namespace || 'default').toLowerCase();
    const selector =
      (primaryResource.specSummary?.selector as Record<string, string>) ||
      (primaryResource as any).spec?.selector ||
      {};
    const selectorKeys = Object.keys(selector);

    // Discover related EndpointSlices strictly via Kubernetes telemetry
    const relatedEndpointSlices = safeClusterResources.filter((r) => {
      if (r.kind !== 'EndpointSlice') return false;
      if ((r.namespace || 'default').toLowerCase() !== serviceNs) return false;
      const svcNameLabel = r.labels?.['kubernetes.io/service-name'];
      const matchesOwner = r.ownerReferences?.some(
        (o) => o?.kind === 'Service' && (o.uid && primaryResource.uid ? o.uid === primaryResource.uid : o.name === primaryResource.name)
      );
      return (
        svcNameLabel === primaryResource.name ||
        matchesOwner ||
        r.name === primaryResource.name ||
        r.name.startsWith(`${primaryResource.name}-`)
      );
    });

    // 1. Pods matching selector strictly
    const podsBySelector = findServicePods(primaryResource);

    // 2. Pods referenced by EndpointSlice targetRefs
    const podNamesFromEndpoints = new Set<string>();
    const podUidsFromEndpoints = new Set<string>();
    relatedEndpointSlices.forEach((slice) => {
      const eps = (slice.specSummary?.endpoints || slice.statusSummary?.endpoints || (slice as any).endpoints || []) as any[];
      eps.forEach((ep) => {
        if (ep?.targetRef?.kind === 'Pod') {
          if (ep.targetRef.uid) podUidsFromEndpoints.add(ep.targetRef.uid);
          if (ep.targetRef.name) podNamesFromEndpoints.add(ep.targetRef.name);
        }
      });
    });

    const podsFromEndpoints = safeClusterResources.filter((r) => {
      if (r.kind !== 'Pod') return false;
      if ((r.namespace || 'default').toLowerCase() !== serviceNs) return false;
      if (r.uid && podUidsFromEndpoints.has(r.uid)) return true;
      if (r.name && podNamesFromEndpoints.has(r.name)) return true;
      return false;
    });

    // Combine and deduplicate
    const targetPodsMap = new Map<string, KubernetesResource>();
    [...podsBySelector, ...podsFromEndpoints].forEach((p) => {
      const key = p.uid || `${p.namespace}/${p.name}`;
      if (!targetPodsMap.has(key)) {
        targetPodsMap.set(key, p);
      }
    });
    const targetPods = Array.from(targetPodsMap.values());

    const hasRelationships = targetPods.length > 0 || relatedEndpointSlices.length > 0;

    // Incomplete telemetry check based on actual cluster telemetry
    const isTelemetryIncomplete = (() => {
      if (selectorKeys.length > 0 && podsBySelector.length === 0) return true;
      for (const name of podNamesFromEndpoints) {
        if (!safeClusterResources.some((r) => r.kind === 'Pod' && r.name === name && (r.namespace || 'default').toLowerCase() === serviceNs)) {
          return true;
        }
      }
      for (const pod of targetPods) {
        const nodeName = pod.nodeName || (pod.specSummary?.nodeName as string) || ((pod as any).spec?.nodeName as string);
        if (nodeName && !safeClusterResources.some((r) => r.kind === 'Node' && r.name === nodeName)) {
          return true;
        }
      }
      return false;
    })();

    const serviceType = ((primaryResource.specSummary?.type as string) || (primaryResource as any).spec?.type || 'ClusterIP');
    const clusterIP = ((primaryResource.specSummary?.clusterIP as string) || (primaryResource as any).spec?.clusterIP || '-');
    const ports = ((primaryResource.specSummary?.ports || (primaryResource as any).spec?.ports || []) as any[]);

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Network className="w-3.5 h-3.5 text-emerald-400" />
            Service Routing & Endpoints
          </span>
          <span className="text-[11px] text-zinc-500">
            Service ➔ EndpointSlices ({relatedEndpointSlices.length}) ➔ Pods ({targetPods.length})
          </span>
        </div>

        {/* Telemetry incomplete notification banner */}
        {isTelemetryIncomplete && (
          <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-xl flex items-center gap-2 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Topology is partially available — some cluster resources have not been reported by the agent.</span>
          </div>
        )}

        {/* Root Service Node Card */}
        <div className="p-3.5 bg-zinc-950 border border-emerald-800/60 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Network className="w-4 h-4 text-emerald-400" />
              <span className="font-bold text-zinc-100 text-sm">{primaryResource.name}</span>
              <span className="text-zinc-500 text-[11px]">({primaryResource.namespace})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-zinc-700 text-zinc-300">
                {serviceType}
              </span>
              <ResourceHealthBadge health={primaryResource.health} size="sm" />
            </div>
          </div>

          <div className="flex items-center gap-3 text-[11px] text-zinc-400">
            <span>ClusterIP: <strong className="text-zinc-200">{clusterIP}</strong></span>
            {ports.length > 0 && (
              <span>
                Ports:{' '}
                <strong className="text-zinc-200">
                  {ports.map((p: any) => `${p.port}${p.targetPort ? `:${p.targetPort}` : ''}${p.protocol ? `/${p.protocol}` : ''}`).join(', ')}
                </strong>
              </span>
            )}
          </div>

          {/* Selector labels */}
          <div className="pt-2 border-t border-zinc-800/60 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-500">Selector:</span>
            {selectorKeys.length === 0 ? (
              <span className="text-zinc-500 text-[11px]">None (Headless / External / Manual)</span>
            ) : (
              Object.entries(selector).map(([k, v]) => (
                <span
                  key={k}
                  className="px-1.5 py-0.2 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300"
                >
                  {k}={String(v)}
                </span>
              ))
            )}
          </div>
        </div>

        {/* Empty state when no verified relationships exist */}
        {!hasRelationships ? (
          <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-zinc-300 font-semibold text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>No verified topology relationships found.</span>
            </div>
            <p className="text-zinc-400 text-[11px] leading-relaxed">
              {selectorKeys.length === 0
                ? `Service "${primaryResource.name}" in namespace "${primaryResource.namespace}" does not define a selector, and no associated EndpointSlices were reported in cluster telemetry.`
                : `Service "${primaryResource.name}" defines selector (${selectorKeys.map((k) => `${k}=${selector[k]}`).join(', ')}), but no matching Pods or EndpointSlices were reported in namespace "${primaryResource.namespace}".`}
            </p>
          </div>
        ) : (
          /* Tree hierarchy: Service -> EndpointSlices -> Endpoints/addresses -> Backing Pods -> Workload/Node */
          <div className="pl-6 border-l-2 border-dashed border-emerald-700/60 space-y-4 pt-1">
            {/* 1. EndpointSlices (if available) */}
            {relatedEndpointSlices.length > 0 && (
              <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-emerald-700/60 space-y-2">
                <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-emerald-400" />
                    EndpointSlices ({relatedEndpointSlices.length})
                  </span>
                  <span className="text-[10px] text-zinc-500 font-normal">Service ➔ EndpointSlice ➔ Addresses</span>
                </div>
                <div className="space-y-2">
                  {relatedEndpointSlices.map((slice) => {
                    const endpoints = ((slice.specSummary?.endpoints || slice.statusSummary?.endpoints || (slice as any).endpoints || []) as any[]);
                    return (
                      <div key={slice.id} className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-800/40 font-semibold">
                              EndpointSlice
                            </span>
                            <span className="font-semibold text-zinc-200 text-xs">{slice.name}</span>
                          </div>
                          <span className="text-zinc-500 text-[10px]">
                            AddressType: {((slice.specSummary?.addressType as string) || (slice as any).addressType || 'IPv4')}
                          </span>
                        </div>

                        {/* Endpoints & Addresses */}
                        {endpoints.length > 0 && (
                          <div className="pt-1.5 border-t border-zinc-800/50 space-y-1">
                            <div className="text-[10px] text-zinc-400 font-semibold">Endpoints / Addresses ({endpoints.length}):</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              {endpoints.map((ep: any, idx: number) => {
                                const addrs = Array.isArray(ep.addresses) ? ep.addresses.join(', ') : (ep.address || '-');
                                const isReady = ep.conditions?.ready !== false;
                                const targetRef = ep.targetRef;
                                return (
                                  <div key={idx} className="p-2 bg-zinc-900/60 border border-zinc-800/60 rounded-lg flex items-center justify-between text-[11px]">
                                    <div className="space-y-0.5">
                                      <div className="text-zinc-300 font-semibold flex items-center gap-1.5">
                                        <span className={`w-1.5 h-1.5 rounded-full ${isReady ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                                        <span>{addrs}</span>
                                      </div>
                                      {targetRef && (
                                        <div className="text-[10px] text-zinc-500">
                                          target: {targetRef.kind}/{targetRef.name}
                                        </div>
                                      )}
                                    </div>
                                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${isReady ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60' : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'}`}>
                                      {isReady ? 'Ready' : 'Not Ready'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2. Backing Pods Layer */}
            <div className="relative pl-4 before:content-[''] before:absolute before:left-[-24px] before:top-4 before:w-6 before:h-0.5 before:bg-emerald-700/60 space-y-2">
              <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-sky-400" />
                  Backing Pods ({targetPods.length})
                </span>
                <span className="text-[10px] text-zinc-500 font-normal">
                  {targetPods.length > 0 ? 'Pod ➔ Workload Controller ➔ Scheduled Node' : ''}
                </span>
              </div>

              {targetPods.length === 0 ? (
                <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-lg text-zinc-500 text-xs">
                  No active backing pods currently found matching selector in namespace {primaryResource.namespace}.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {targetPods.map((pod) => {
                    const { parent, controller } = findParentWorkload(pod);
                    const node = findPodNode(pod);
                    const nodeName =
                      pod.nodeName ||
                      (pod.specSummary?.nodeName as string) ||
                      ((pod as any).spec?.nodeName as string);
                    const isUnhealthy =
                      pod.health === 'CRITICAL' ||
                      pod.health === 'WARNING' ||
                      pod.status === 'CrashLoopBackOff' ||
                      pod.status === 'ImagePullBackOff' ||
                      pod.status === 'Error' ||
                      pod.status === 'Failed';

                    const totalRestarts =
                      pod.containers?.reduce((acc, c) => acc + (c.restartCount || 0), 0) || 0;

                    return (
                      <div
                        key={pod.id}
                        className={`p-3 bg-zinc-950 border rounded-xl space-y-2.5 transition-all ${
                          isUnhealthy
                            ? 'border-rose-800/80 bg-rose-950/10'
                            : 'border-zinc-800/90 hover:border-sky-500/60'
                        }`}
                      >
                        {/* Pod Header */}
                        <div className="flex items-center justify-between gap-2">
                          <div
                            onClick={() => onSelectResource && onSelectResource(pod)}
                            className="flex items-center gap-2 truncate cursor-pointer group"
                          >
                            <span
                              className={`w-2 h-2 rounded-full shrink-0 ${
                                isUnhealthy ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                              }`}
                            />
                            <span className="font-bold text-zinc-200 text-xs truncate group-hover:text-sky-300">
                              {pod.name}
                            </span>
                            <span className="text-[10px] text-zinc-500">({pod.namespace})</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <PodPhaseBadge phaseOrStatus={pod.status} restarts={totalRestarts} />
                            <ResourceHealthBadge health={pod.health} size="sm" />
                            {onSelectResource && (
                              <button
                                onClick={() => onSelectResource(pod)}
                                className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-mono"
                              >
                                Inspect Pod →
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Containers readiness if unhealthy or restarts exist */}
                        {pod.containers && pod.containers.length > 0 && (isUnhealthy || totalRestarts > 0) && (
                          <div className="pl-4 border-l border-zinc-800/80 space-y-1 pt-1">
                            {pod.containers.map((c, idx) => (
                              <div key={idx} className="flex items-center justify-between text-[11px] text-zinc-400 py-0.5">
                                <div className="flex items-center gap-1.5 truncate">
                                  <Terminal className="w-3 h-3 text-zinc-500 shrink-0" />
                                  <span className="text-zinc-300 font-semibold">{c.name}</span>
                                </div>
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
                            ))}
                          </div>
                        )}

                        {/* Parent Workload & Node hierarchy indicators */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-zinc-800/60 text-[11px]">
                          {/* Parent Workload (Deployment / ReplicaSet / StatefulSet) */}
                          <div className="flex items-center justify-between p-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg">
                            <span className="text-zinc-500 flex items-center gap-1 text-[10px] uppercase">
                              <Layers className="w-3 h-3 text-sky-400" />
                              Workload:
                            </span>
                            {parent ? (
                              <button
                                onClick={() => onSelectResource && onSelectResource(parent)}
                                className="text-sky-400 hover:text-sky-300 font-semibold truncate max-w-[150px] text-right flex items-center gap-1"
                              >
                                <span>{parent.kind}/{parent.name}</span>
                                <ChevronRight className="w-3 h-3 shrink-0" />
                              </button>
                            ) : controller ? (
                              <span className="text-zinc-300 truncate max-w-[150px] font-mono text-[10px]">
                                {controller}
                              </span>
                            ) : (
                              <span className="text-zinc-500 text-[10px]">Standalone Pod</span>
                            )}
                          </div>

                          {/* Scheduled Node */}
                          <div className="flex items-center justify-between p-2 bg-zinc-900/50 border border-zinc-800/50 rounded-lg">
                            <span className="text-zinc-500 flex items-center gap-1 text-[10px] uppercase">
                              <Server className="w-3 h-3 text-sky-400" />
                              Node:
                            </span>
                            {node ? (
                              <button
                                onClick={() => onSelectResource && onSelectResource(node)}
                                className="text-sky-400 hover:text-sky-300 font-semibold truncate max-w-[150px] text-right flex items-center gap-1"
                              >
                                <span>{node.name}</span>
                                <ChevronRight className="w-3 h-3 shrink-0" />
                              </button>
                            ) : nodeName ? (
                              <span className="text-zinc-400 truncate max-w-[150px]">
                                {nodeName}
                              </span>
                            ) : (
                              <span className="text-zinc-500 text-[10px]">Unassigned</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // 5. PERSISTENT VOLUME CLAIM VIEW
  if (isPVC) {
    const mountingPods = findPVCPods(primaryResource);

    return (
      <div className="space-y-4 font-mono text-xs">
        <div className="flex items-center justify-between text-zinc-400 pb-2 border-b border-zinc-800">
          <span className="font-bold uppercase tracking-wider text-[11px] text-zinc-300 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-amber-400" />
            Storage Claim Relationships
          </span>
          <span className="text-[11px] text-zinc-500">
            PVC ➔ Pod Volume Mounts ({mountingPods.length})
          </span>
        </div>

        <div className="p-3.5 bg-zinc-950 border border-amber-800/60 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-zinc-100 text-sm">{primaryResource.name}</span>
              <span className="text-zinc-500 text-[11px]">({primaryResource.namespace})</span>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-900 border border-zinc-700 text-zinc-300">
              {primaryResource.status}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            Workloads & Pods Mounting This Volume ({mountingPods.length})
          </div>
          {mountingPods.length === 0 ? (
            <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
              No active pods currently mount this PersistentVolumeClaim.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {mountingPods.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onSelectResource && onSelectResource(p)}
                  className="p-3 bg-zinc-950 border border-zinc-800 hover:border-sky-500/70 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="truncate">
                    <div className="font-bold text-zinc-200 text-xs truncate">{p.name}</div>
                  </div>
                  <PodPhaseBadge phaseOrStatus={p.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-400">
      Resource ownership visualization for {primaryResource.kind}: {primaryResource.name}
    </div>
  );
};

export const ResourceRelationshipTree: React.FC<ResourceRelationshipTreeProps> = (props) => {
  return (
    <TopologyErrorBoundary>
      <ResourceRelationshipTreeInner {...props} />
    </TopologyErrorBoundary>
  );
};
