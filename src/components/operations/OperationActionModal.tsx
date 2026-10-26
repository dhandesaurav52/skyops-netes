import React, { useState, useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sliders,
  Terminal,
  Trash2,
  X,
  Zap,
  ShieldAlert,
  ShieldCheck,
  Shield
} from 'lucide-react';
import { api } from '../../api/client';
import { Cluster, KubernetesResource, RemediationAction } from '../../types/index';
import { Modal, Button } from '../common/UI';

export type OperationActionType =
  | 'RolloutRestart'
  | 'RestartPod'
  | 'DeletePod'
  | 'ScaleDeployment'
  | 'ScaleWorkload'
  | 'RollbackDeployment'
  | 'CordonNode'
  | 'UncordonNode'
  | 'DrainNode'
  | 'SuspendCronJob'
  | 'ResumeCronJob'
  | 'TriggerCronJob'
  | 'RerunJob'
  | 'DeleteJob';

interface OperationActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  cluster: Cluster;
  resource: KubernetesResource;
  actionType: OperationActionType;
  onSuccess: (action: RemediationAction, updatedResource?: KubernetesResource) => void;
}

export const OperationActionModal: React.FC<OperationActionModalProps> = ({
  isOpen,
  onClose,
  cluster,
  resource,
  actionType,
  onSuccess
}) => {
  const currentReplicas =
    (resource.specSummary as any)?.replicas ?? resource.specReplicas ?? 1;

  const currentRevStr =
    resource.annotations?.['deployment.kubernetes.io/revision'] ||
    (resource.statusSummary as any)?.revision ||
    '1';
  const currentRevisionNum = parseInt(currentRevStr, 10) || 1;
  const suggestedRollbackRev = currentRevisionNum > 1 ? String(currentRevisionNum - 1) : '1';

  const isNakedPod = resource.kind === 'Pod' && (!resource.ownerReferences || resource.ownerReferences.length === 0);

  const [targetReplicas, setTargetReplicas] = useState<number>(currentReplicas);
  const [targetRevision, setTargetRevision] = useState<string>(suggestedRollbackRev);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<{ message: string; action: RemediationAction } | null>(null);

  // Safety confirmation states
  const [confirmScaleToZero, setConfirmScaleToZero] = useState(false);
  const [confirmNakedPodDelete, setConfirmNakedPodDelete] = useState(false);
  const [confirmDrain, setConfirmDrain] = useState(false);
  const [ignoreDaemonSets, setIgnoreDaemonSets] = useState(true);
  const [deleteEmptyDirData, setDeleteEmptyDirData] = useState(false);

  if (!isOpen) return null;

  const isConnected =
    cluster.agentStatus === 'CONNECTED' ||
    cluster.connectionState === 'connected' ||
    cluster.connectionStatus === 'connected' ||
    (cluster.lastHeartbeat ? Date.now() - cluster.lastHeartbeat < 5 * 60 * 1000 : false) ||
    (cluster.lastSeenAt ? Date.now() - cluster.lastSeenAt < 5 * 60 * 1000 : false) ||
    Boolean(cluster.isSimulated);

  const isDisconnectedAndProd = !isConnected && !cluster.isSimulated;

  const getActionConfig = () => {
    switch (actionType) {
      case 'RolloutRestart':
        return {
          title: `Rollout Restart ${resource.kind}`,
          icon: <RefreshCw className="w-5 h-5 text-sky-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
          description:
            `Initiates an orderly rolling update for "${resource.name}". Existing pods are replaced incrementally without dropping active traffic.`,
          impact: 'Pods are cycled one-by-one according to rolling update strategy. Slight temporary increase in cluster CPU/Memory during pod spin-up.'
        };
      case 'ScaleDeployment':
      case 'ScaleWorkload':
        return {
          title: `Scale Replicas for ${resource.name}`,
          icon: <Sliders className="w-5 h-5 text-indigo-400" />,
          riskLevel: targetReplicas === 0 ? 'HIGH' : 'MEDIUM',
          riskColor: targetReplicas === 0 ? 'text-rose-400 bg-rose-950/40 border-rose-800/60' : 'text-amber-400 bg-amber-950/40 border-amber-800/60',
          description:
            resource.kind === 'StatefulSet'
              ? `Modifies replica count for StatefulSet "${resource.name}". StatefulSets follow strict ordinal scale-down (N-1 down to 0). Note: PVCs are persistent and will NOT be automatically deleted.`
              : `Modifies desired replica count for ${resource.kind} "${resource.name}" in namespace "${resource.namespace}". Allowed range is 0 to 20 replicas.`,
          impact: targetReplicas === 0
            ? 'CRITICAL IMPACT: Scaling to 0 terminates all pods and stops handling active application traffic.'
            : 'Surplus pods will be terminated when scaling down; new pods will be scheduled when scaling up.'
        };
      case 'RollbackDeployment':
        return {
          title: `Rollback Deployment Revisions`,
          icon: <RotateCcw className="w-5 h-5 text-amber-400" />,
          riskLevel: 'MEDIUM',
          riskColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
          description:
            `Restores deployment template to a previous ReplicaSet revision. Currently at revision ${currentRevisionNum}.`,
          impact: 'Rolls back container image, environment config, and resource requests to the designated revision snapshot.'
        };
      case 'DeletePod':
      case 'RestartPod':
        return {
          title: `Delete Pod "${resource.name}"`,
          icon: <Trash2 className="w-5 h-5 text-rose-400" />,
          riskLevel: isNakedPod ? 'HIGH' : 'LOW',
          riskColor: isNakedPod ? 'text-rose-400 bg-rose-950/40 border-rose-800/60' : 'text-amber-400 bg-amber-950/40 border-amber-800/60',
          description:
            `Deletes pod "${resource.name}". ` +
            (!isNakedPod
              ? `This pod is controller-managed (${resource.ownerReferences![0].kind}/${resource.ownerReferences![0].name}). A fresh replacement pod will be provisioned automatically.`
              : 'CRITICAL: This is a standalone (naked) pod without a controller owner! It will NOT be recreated after deletion.'),
          impact: 'Active processes inside the pod receive SIGTERM followed by SIGKILL after grace period.'
        };
      case 'CordonNode':
        return {
          title: `Cordon Worker Node "${resource.name}"`,
          icon: <ShieldAlert className="w-5 h-5 text-amber-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
          description:
            `Marks worker node "${resource.name}" as unschedulable. Existing pods continue running, but no new pods will be scheduled here.`,
          impact: 'Prevents Kubernetes scheduler from placing new workloads on this node during maintenance.'
        };
      case 'UncordonNode':
        return {
          title: `Uncordon Worker Node "${resource.name}"`,
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
          description:
            `Restores schedulable status on node "${resource.name}". Scheduler will resume placing pods on this worker node.`,
          impact: 'Worker node returns to standard active cluster scheduling.'
        };
      case 'DrainNode':
        return {
          title: `Drain Worker Node "${resource.name}"`,
          icon: <AlertTriangle className="w-5 h-5 text-rose-400" />,
          riskLevel: 'HIGH',
          riskColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
          description:
            `Safely evicts non-DaemonSet pods from node "${resource.name}" so node can be taken offline. Node will be cordoned first.`,
          impact: 'Pods are evicted through the Eviction API respecting PodDisruptionBudgets (PDBs). Non-DaemonSet pods will be relocated to other ready nodes.'
        };
      case 'SuspendCronJob':
        return {
          title: `Suspend CronJob "${resource.name}"`,
          icon: <Clock className="w-5 h-5 text-amber-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-amber-400 bg-amber-950/40 border-amber-800/60',
          description:
            `Suspends scheduled job runs for CronJob "${resource.name}". Currently running jobs will run to completion.`,
          impact: 'Prevents automatic cron triggers until resumed.'
        };
      case 'ResumeCronJob':
        return {
          title: `Resume CronJob "${resource.name}"`,
          icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/60',
          description:
            `Resumes scheduled executions for CronJob "${resource.name}" according to its configured schedule.`,
          impact: 'CronJob resumes normal periodic execution.'
        };
      case 'TriggerCronJob':
        return {
          title: `Trigger CronJob Run "${resource.name}"`,
          icon: <Zap className="w-5 h-5 text-sky-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-sky-400 bg-sky-950/40 border-sky-800/60',
          description:
            `Manually spawns a new Job execution from CronJob "${resource.name}" immediately without waiting for cron schedule.`,
          impact: 'Spawns an active Job. Note: If ConcurrencyPolicy is Forbid and another run is active, duplicates may be queued or skipped.'
        };
      case 'RerunJob':
        return {
          title: `Rerun Batch Job "${resource.name}"`,
          icon: <RefreshCw className="w-5 h-5 text-indigo-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-indigo-400 bg-indigo-950/40 border-indigo-800/60',
          description:
            `Creates a new Job instance duplicating the specification of Job "${resource.name}".`,
          impact: 'Launches pod batch tasks until completion.'
        };
      case 'DeleteJob':
        return {
          title: `Delete Batch Job "${resource.name}"`,
          icon: <Trash2 className="w-5 h-5 text-rose-400" />,
          riskLevel: 'LOW',
          riskColor: 'text-rose-400 bg-rose-950/40 border-rose-800/60',
          description:
            `Deletes batch Job "${resource.name}" and stops associated pods.`,
          impact: 'Terminates active batch job execution and deletes Kubernetes job resource.'
        };
    }
  };

  const config = getActionConfig();

  // Authoritative capability checking grounded in Kubernetes SSAR telemetry
  const capabilityCheck = useMemo(() => {
    if (cluster.isSimulated) {
      return {
        supported: true,
        mode: 'SIMULATED',
        message: 'Demo / Sandbox Cluster: Changes simulate immediately in in-memory telemetry.'
      };
    }
    if (!isConnected) {
      return {
        supported: false,
        mode: 'DISCONNECTED',
        message: 'Live Agent Offline: Reconnect SkyOps agent to execute operational actions.'
      };
    }
    const caps = cluster.operationalCapabilities;
    const tier = cluster.permissionTier || 'observer';
    if (caps) {
      switch (actionType) {
        case 'DeletePod':
          if (!caps.canDeletePods) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Pod deletion (missing delete on core/pods). Deploy with Operator or Platform Admin tier.'
            };
          }
          break;
        case 'RestartPod':
          if (resource.kind === 'Pod' && !caps.canDeletePods) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Pod restart (missing delete on core/pods). Deploy with Operator or Platform Admin tier.'
            };
          }
          if (resource.kind !== 'Pod' && !caps.canRestartDeployments) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Deployment rollout restart (missing patch on apps/deployments).'
            };
          }
          break;
        case 'RolloutRestart':
        case 'RollbackDeployment':
          if (!caps.canRestartDeployments) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Rollout/Rollback (missing patch on apps/deployments). Deploy with Operator tier.'
            };
          }
          break;
        case 'ScaleDeployment':
          if (!caps.canScaleDeployments) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Scaling (missing patch/update on apps/deployments/scale). Deploy with Operator tier.'
            };
          }
          break;
        case 'ScaleWorkload':
          if (resource.kind === 'StatefulSet' && !caps.canScaleStatefulSets) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies StatefulSet scaling (missing patch/update on apps/statefulsets/scale).'
            };
          }
          if (!caps.canScaleDeployments) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Workload scaling. Deploy with Operator tier.'
            };
          }
          break;
        case 'SuspendCronJob':
        case 'ResumeCronJob':
          if (!caps.canMutateCronJobs) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies CronJob mutation (missing patch/update on batch/cronjobs).'
            };
          }
          break;
        case 'TriggerCronJob':
        case 'RerunJob':
          if (!caps.canCreateJobs) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Job creation (missing create on batch/jobs).'
            };
          }
          break;
        case 'DeleteJob':
          if (!caps.canDeleteJobs) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Operator',
              message: 'Agent RBAC denies Job deletion (missing delete on batch/jobs).'
            };
          }
          break;
        case 'CordonNode':
        case 'UncordonNode':
          if (!caps.canCordonNodes) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Platform Administrator',
              message: 'Agent RBAC denies Node cordon/uncordon (missing patch on core/nodes). Requires Platform Admin tier.'
            };
          }
          break;
        case 'DrainNode':
          if (!caps.canDrainNodes) {
            return {
              supported: false,
              mode: 'RBAC_DENIED',
              requiredTier: 'Platform Administrator',
              message: 'Agent RBAC denies Node drain (missing patch on core/nodes or create on core/pods/eviction). Requires Platform Admin tier.'
            };
          }
          break;
      }
    } else if (tier === 'observer') {
      return {
        supported: false,
        mode: 'RBAC_DENIED',
        requiredTier: 'Operator',
        message: 'Cluster agent is configured in Observer tier (read-only). Operational mutations require Operator or Platform Admin tier.'
      };
    }

    return {
      supported: true,
      mode: 'VERIFIED',
      message: `Agent capability verified via Kubernetes SelfSubjectAccessReview (${tier} tier)`
    };
  }, [cluster, actionType, isConnected, resource.kind]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isDisconnectedAndProd || !capabilityCheck.supported) return;

    try {
      setSubmitting(true);
      setError(null);

      const payload: any = {
        actionType,
        targetKind: resource.kind,
        targetName: resource.name,
        targetNamespace: resource.namespace || undefined,
        targetUid: resource.uid,
        idempotencyKey: `idem-${cluster.id}-${resource.kind}-${resource.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        confirmScaleToZero: targetReplicas === 0 ? confirmScaleToZero : undefined,
        confirmNakedPodDelete: isNakedPod ? confirmNakedPodDelete : undefined,
        confirmDrain: actionType === 'DrainNode' ? confirmDrain : undefined,
        drainOptions: actionType === 'DrainNode' ? {
          ignoreDaemonSets,
          deleteEmptyDirData
        } : undefined,
        parameters: {
          reason: reason.trim() || undefined,
          targetReplicas: (actionType === 'ScaleDeployment' || actionType === 'ScaleWorkload') ? targetReplicas : undefined,
          targetRevision: actionType === 'RollbackDeployment' ? targetRevision : undefined,
          expectedRevision: actionType === 'RollbackDeployment' ? currentRevStr : undefined,
          expectedReplicas: (actionType === 'ScaleDeployment' || actionType === 'ScaleWorkload') ? currentReplicas : undefined,
          confirmScaleToZero: targetReplicas === 0 ? confirmScaleToZero : undefined,
          confirmNakedPodDelete: isNakedPod ? confirmNakedPodDelete : undefined,
          confirmDrain: actionType === 'DrainNode' ? confirmDrain : undefined,
          drainOptions: actionType === 'DrainNode' ? {
            ignoreDaemonSets,
            deleteEmptyDirData
          } : undefined
        }
      };

      const res = await api.executeClusterOperation(cluster.id, payload);
      setSuccessResult({ message: res.message, action: res.action });

      setTimeout(() => {
        onSuccess(res.action, res.updatedResource);
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error('Operation execution failure:', err);
      setError(err?.message || 'Failed to dispatch cluster operation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={config.title} size="md">
      <div className="space-y-5 text-zinc-100 font-sans">
        {/* Context Bar */}
        <div className="flex items-center justify-between gap-3 bg-zinc-950/60 p-3 rounded-lg border border-zinc-800/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              {config.icon}
            </div>
            <div>
              <p className="text-xs text-zinc-400">
                Cluster: <span className="text-zinc-200 font-medium">{cluster.name}</span>
                {resource.namespace && (
                  <> · Namespace: <span className="text-zinc-200 font-medium">{resource.namespace}</span></>
                )}
              </p>
              <p className="text-xs font-mono text-zinc-300">Target: {resource.kind}/{resource.name}</p>
            </div>
          </div>
          <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${config.riskColor}`}>
            Risk: {config.riskLevel}
          </span>
        </div>

        {/* Capability Status Banners */}
        {capabilityCheck.mode === 'SIMULATED' && (
          <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-800/60 text-xs text-sky-200 flex items-start gap-2.5">
            <Shield className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-sky-300">Simulated Sandbox Environment</span>
              <p className="mt-0.5 text-zinc-300">
                This cluster is running in simulated demonstration mode. Operations execute instantaneously in the sandbox telemetry model without touching actual cloud infrastructure.
              </p>
            </div>
          </div>
        )}

        {capabilityCheck.mode === 'DISCONNECTED' && (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-200 flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300">Live Agent Disconnected</span>
              <p className="mt-0.5 text-zinc-300">
                Mutations requiring live cluster state are disabled because the SkyOps cluster agent is currently offline. Reconnect the agent to execute operational actions.
              </p>
            </div>
          </div>
        )}

        {capabilityCheck.mode === 'RBAC_DENIED' && (
          <div className="p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/60 text-xs text-rose-200 flex items-start gap-3">
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-rose-300">
                RBAC Denied by Kubernetes Cluster ({capabilityCheck.requiredTier} Tier Required)
              </span>
              <p className="mt-0.5 text-zinc-300">{capabilityCheck.message}</p>
              <p className="mt-1 text-[11px] text-zinc-400">
                Upgrade the agent installation: set <code className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-200 font-mono">rbac.tier={capabilityCheck.requiredTier.toLowerCase().replace(' ', '-')}</code> in Helm values or apply <code className="bg-zinc-900 px-1 py-0.5 rounded text-zinc-200 font-mono">skyops-agent-operator</code> ClusterRole.
              </p>
            </div>
          </div>
        )}

        {capabilityCheck.mode === 'VERIFIED' && (
          <div className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-xs text-emerald-300 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{capabilityCheck.message}</span>
          </div>
        )}

        {/* Description & Impact */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-2 text-xs">
          <p className="text-zinc-300 leading-relaxed">{config.description}</p>
          <div className="pt-2 border-t border-zinc-800/60 flex items-start gap-2 text-zinc-400">
            <span className="font-medium text-zinc-300 shrink-0">Operational Impact:</span>
            <span>{config.impact}</span>
          </div>
        </div>

        {/* Action Specific Inputs */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {(actionType === 'ScaleDeployment' || actionType === 'ScaleWorkload') && (
            <div className="space-y-3 p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 font-medium">Desired Replicas:</span>
                <span className="font-mono font-bold text-sky-400 text-sm">
                  {targetReplicas} <span className="text-zinc-500 font-normal text-xs">(Current: {currentReplicas})</span>
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                value={targetReplicas}
                onChange={(e) => setTargetReplicas(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 cursor-pointer"
              />
              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span>0 replicas (stop traffic)</span>
                <span>10</span>
                <span>20 replicas (safety cap)</span>
              </div>

              {targetReplicas === 0 && (
                <label className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-950/40 border border-rose-800/80 cursor-pointer select-none mt-2">
                  <input
                    type="checkbox"
                    checked={confirmScaleToZero}
                    onChange={(e) => setConfirmScaleToZero(e.target.checked)}
                    className="mt-0.5 rounded border-rose-700 bg-zinc-950 text-rose-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <span className="text-xs text-rose-200">
                    <strong>Confirm Scale to 0:</strong> I understand that scaling to 0 terminates all running pods, stopping traffic handling completely.
                  </span>
                </label>
              )}
            </div>
          )}

          {(actionType === 'DeletePod' || actionType === 'RestartPod') && isNakedPod && (
            <label className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-950/40 border border-rose-800/80 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={confirmNakedPodDelete}
                onChange={(e) => setConfirmNakedPodDelete(e.target.checked)}
                className="mt-0.5 rounded border-rose-700 bg-zinc-950 text-rose-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <span className="text-xs text-rose-200">
                <strong>Confirm Standalone Pod Deletion:</strong> This is a standalone (naked) pod without a controller owner. It will <strong>NOT</strong> be recreated by Kubernetes.
              </span>
            </label>
          )}

          {actionType === 'DrainNode' && (
            <div className="space-y-3 p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/80 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={confirmDrain}
                  onChange={(e) => setConfirmDrain(e.target.checked)}
                  className="mt-0.5 rounded border-rose-700 bg-zinc-950 text-rose-500 cursor-pointer"
                />
                <span className="text-rose-200">
                  <strong>Confirm Node Drain:</strong> Evict workloads from node <strong className="text-white">{resource.name}</strong>. Pods will be rescheduled on remaining nodes.
                </span>
              </label>
              <div className="pt-2 border-t border-rose-900/40 space-y-2 text-zinc-300">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={ignoreDaemonSets}
                    onChange={(e) => setIgnoreDaemonSets(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-sky-500 cursor-pointer"
                  />
                  <span>Ignore DaemonSet pods (leave system agent pods on node)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={deleteEmptyDirData}
                    onChange={(e) => setDeleteEmptyDirData(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-950 text-sky-500 cursor-pointer"
                  />
                  <span>Delete local emptyDir data if required</span>
                </label>
              </div>
            </div>
          )}

          {actionType === 'RollbackDeployment' && (
            <div className="space-y-2 p-3.5 rounded-xl bg-zinc-900/40 border border-zinc-800">
              <label className="text-xs font-medium text-zinc-300 block">
                Target Revision:
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={targetRevision}
                  onChange={(e) => setTargetRevision(e.target.value)}
                  placeholder="e.g. 2"
                  className="px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-100 focus:outline-none focus:border-sky-500 w-32"
                />
                <span className="text-xs text-zinc-400">
                  Current active revision: <strong className="text-zinc-200">rev {currentRevisionNum}</strong>
                </span>
              </div>
              {currentRevisionNum <= 1 && (
                <p className="text-[11px] text-rose-400">
                  Notice: Workload is currently at initial revision 1. No earlier revision history is recorded.
                </p>
              )}
            </div>
          )}

          {/* Optional reason / audit annotation */}
          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1.5">
              Operational Reason (Logged in immutable audit trail):
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Cleared memory pressure during high traffic window"
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Feedback messages */}
          {error && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/80 text-xs text-rose-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successResult && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/80 text-xs text-emerald-300 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">{successResult.message}</span>
                <p className="mt-0.5 text-zinc-300">Action ID: {successResult.action.id} · Status: {successResult.action.status}</p>
              </div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={
                submitting ||
                !capabilityCheck.supported ||
                (actionType === 'RollbackDeployment' && currentRevisionNum <= 1) ||
                ((actionType === 'ScaleDeployment' || actionType === 'ScaleWorkload') && targetReplicas === 0 && !confirmScaleToZero) ||
                ((actionType === 'DeletePod' || actionType === 'RestartPod') && isNakedPod && !confirmNakedPodDelete) ||
                (actionType === 'DrainNode' && !confirmDrain)
              }
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 text-white transition-all cursor-pointer ${
                actionType === 'DeletePod' || actionType === 'RestartPod'
                  ? 'bg-rose-600 hover:bg-rose-500 disabled:opacity-50'
                  : 'bg-sky-600 hover:bg-sky-500 disabled:opacity-50'
              }`}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Dispatching to Cluster...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Execute {actionType.replace(/([A-Z])/g, ' $1').trim()}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
};
