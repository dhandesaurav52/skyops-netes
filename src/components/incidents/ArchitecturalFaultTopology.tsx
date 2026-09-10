import React, { useState } from 'react';
import {
  Layers,
  Cpu,
  Server,
  Globe,
  Activity,
  Terminal,
  Network,
  CheckCircle2,
  AlertOctagon,
  PauseCircle,
  ArrowRight,
  ShieldAlert,
  Info,
  ChevronRight,
  Boxes,
  Zap,
  ExternalLink
} from 'lucide-react';
import { Incident, TechnicalDetails } from '../../types';
import { CopyButton } from '../common/UI';

interface ArchitecturalFaultTopologyProps {
  incidentType: string;
  technicalDetails: TechnicalDetails;
  incident?: Incident | null;
}

export type StageStatus = 'PASSED' | 'FAULT_POINT' | 'BLOCKED' | 'NOT_REACHED';

export interface ArchitectureStage {
  id: string;
  layerNumber: number;
  name: string;
  subsystem: string;
  icon: React.ElementType;
  status: StageStatus;
  statusSummary: string;
  roleDescription: string;
  observedBehavior: string;
  blastRadius: string;
  architecturalFix: string;
}

export const ArchitecturalFaultTopology: React.FC<ArchitecturalFaultTopologyProps> = ({
  incidentType,
  technicalDetails: tech,
  incident
}) => {
  // Normalize failure reasons and container messages
  const primaryReason = tech.reason || incidentType;
  const container = tech.containers?.[0];
  const containerMsg = container?.waitingMessage || tech.message || '';
  const exitCode = tech.exitCode ?? container?.exitCode;
  const restartCount = tech.restartCount ?? container?.restartCount ?? 0;
  const image = tech.image || container?.image || 'unknown';

  // Determine which architectural layer contains the fault
  const resolveArchitectureStages = (): ArchitectureStage[] => {
    let faultStageId = 'image_registry';

    const normalizedType = incidentType.toLowerCase();
    if (
      normalizedType.includes('image') ||
      normalizedType.includes('pull') ||
      primaryReason.includes('Image') ||
      containerMsg.includes('pull')
    ) {
      faultStageId = 'image_registry';
    } else if (
      normalizedType.includes('crash') ||
      normalizedType.includes('backoff') && !normalizedType.includes('image') ||
      primaryReason.includes('CrashLoop')
    ) {
      faultStageId = 'app_runtime';
    } else if (
      normalizedType.includes('oom') ||
      primaryReason.includes('OOM') ||
      exitCode === 137
    ) {
      faultStageId = 'kernel_cgroups';
    } else if (
      normalizedType.includes('schedul') ||
      normalizedType.includes('pending') && !tech.containers?.length
    ) {
      faultStageId = 'scheduling';
    } else if (
      normalizedType.includes('node') ||
      primaryReason.includes('Node')
    ) {
      faultStageId = 'kubelet_node';
    } else if (
      normalizedType.includes('probe')
    ) {
      faultStageId = 'app_runtime';
    } else if (
      normalizedType.includes('endpoint') ||
      normalizedType.includes('service')
    ) {
      faultStageId = 'ingress_network';
    } else if (
      normalizedType.includes('pvc') ||
      normalizedType.includes('storage')
    ) {
      faultStageId = 'workload_spec';
    }

    const stageOrder = [
      'workload_spec',
      'scheduling',
      'kubelet_node',
      'image_registry',
      'kernel_cgroups',
      'app_runtime',
      'ingress_network'
    ];

    const faultIdx = stageOrder.indexOf(faultStageId);

    return [
      {
        id: 'workload_spec',
        layerNumber: 1,
        name: 'Workload & Manifest Spec',
        subsystem: 'Deployment / ReplicaSet Controller',
        icon: Layers,
        status: faultStageId === 'workload_spec' ? 'FAULT_POINT' : 'PASSED',
        statusSummary: faultStageId === 'workload_spec' ? 'Specification / PVC Binding Failure' : 'Spec Generated & Accepted',
        roleDescription: 'Defines intended container state, image repository tags, resource limits, and replica targets.',
        observedBehavior:
          faultStageId === 'workload_spec'
            ? `Workload definition specifies resources or storage that cannot be reconciled (${primaryReason}).`
            : `Controller successfully evaluated workload manifest and issued Pod creation request to kube-apiserver for ${incident?.resourceName || tech.podName || 'pod'}.`,
        blastRadius:
          faultStageId === 'workload_spec'
            ? 'Deployment unable to instantiate running pods. Workload capacity at 0%.'
            : 'Contained to controller reconciliation loop.',
        architecturalFix: 'Verify StorageClass provisioner, check volume claim templates, and validate resource requests.'
      },
      {
        id: 'scheduling',
        layerNumber: 2,
        name: 'Control Plane & Placement',
        subsystem: 'kube-scheduler',
        icon: Cpu,
        status:
          faultStageId === 'scheduling'
            ? 'FAULT_POINT'
            : faultIdx < 1
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'scheduling'
            ? 'Pod Unschedulable (0 Nodes Available)'
            : faultIdx < 1
            ? 'Scheduler Bypassed'
            : `Bound to Node: ${tech.nodeName || 'worker-01'}`,
        roleDescription: 'Evaluates node resource headroom, taints, tolerations, and affinities to bind pods to target worker nodes.',
        observedBehavior:
          faultStageId === 'scheduling'
            ? `kube-scheduler evaluated cluster nodes but found no node satisfying memory/CPU requests or node selector constraints.`
            : `kube-scheduler bound Pod successfully to worker node [${tech.nodeName || 'worker-01'}] with sufficient allocatable capacity.`,
        blastRadius:
          faultStageId === 'scheduling'
            ? 'Pod stuck in Pending phase. No worker node capacity allocated.'
            : 'Nominal control plane placement complete.',
        architecturalFix: 'Scale cluster worker nodes (Cluster Autoscaler) or reduce pod compute requests to match available allocatable slices.'
      },
      {
        id: 'kubelet_node',
        layerNumber: 3,
        name: 'Node Kubelet & Sandbox',
        subsystem: 'kubelet.service / containerd CRI',
        icon: Server,
        status:
          faultStageId === 'kubelet_node'
            ? 'FAULT_POINT'
            : faultIdx < 2
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'kubelet_node'
            ? 'Node NotReady / Kubelet Flapping'
            : faultIdx < 2
            ? 'Waiting for Node Placement'
            : 'Pod Sandbox Initialized',
        roleDescription: 'Kubelet daemon on worker node accepts Pod spec, creates network namespace, and coordinates container runtimes.',
        observedBehavior:
          faultStageId === 'kubelet_node'
            ? `Kubelet service is unreachable, failed heartbeat lease renewals, or node is experiencing disk/memory pressure.`
            : `Kubelet on [${tech.nodeName || 'worker-node'}] acknowledged pod manifest, allocated IP in pod CIDR, and initiated container sandbox creation.`,
        blastRadius:
          faultStageId === 'kubelet_node'
            ? 'Node-wide failure; all pods scheduled on this node risk eviction and service disruption.'
            : 'Localized to target pod sandbox.',
        architecturalFix: 'Check systemd journal for kubelet.service, verify node disk space, or replace unhealthy worker node.'
      },
      {
        id: 'image_registry',
        layerNumber: 4,
        name: 'OCI Registry & Supply Chain',
        subsystem: 'OCI Registry / containerd Image Puller',
        icon: Globe,
        status:
          faultStageId === 'image_registry'
            ? 'FAULT_POINT'
            : faultIdx < 3
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'image_registry'
            ? 'Pull Failure: Image Not Found (404)'
            : faultIdx < 3
            ? 'Waiting for Kubelet CRI'
            : 'Image Layers Verified & Cached',
        roleDescription: 'Pulls container image manifests from remote OCI registries (Docker Hub, ECR, GCR, Harbor), validates digests, and extracts rootfs layers.',
        observedBehavior:
          faultStageId === 'image_registry'
            ? `CRI daemon executed HTTPS GET to remote registry for "${image}". Registry returned NotFound (rpc error: code = 5 / 404). Image tag does not exist or requires authentication.`
            : `Container image "${image}" successfully pulled from OCI registry, unpacked into local containerd overlayfs snapshotter.`,
        blastRadius:
          faultStageId === 'image_registry'
            ? 'Container sandbox execution stalled. Workload replica unavailable (0/1). Service endpoint excluded. Neighboring pods unaffected.'
            : 'Nominal image supply chain verification.',
        architecturalFix: 'Update Deployment pod template to reference a valid existing image tag (e.g. nginx:alpine or nginx:1.25) or configure imagePullSecrets for private registry access.'
      },
      {
        id: 'kernel_cgroups',
        layerNumber: 5,
        name: 'Host Kernel & Cgroups',
        subsystem: 'Linux Cgroups v2 & Kernel OOM Killer',
        icon: Activity,
        status:
          faultStageId === 'kernel_cgroups'
            ? 'FAULT_POINT'
            : faultIdx < 4
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'kernel_cgroups'
            ? 'Memory Limit Breached: OOMKilled (137)'
            : faultIdx < 4
            ? 'Pending Container Execution'
            : 'Cgroup Memory & CPU Active',
        roleDescription: 'Enforces kernel-level memory boundaries (memory.max), CPU quotas, and process isolation. Triggers SIGKILL if limit is exceeded.',
        observedBehavior:
          faultStageId === 'kernel_cgroups'
            ? `Container process resident memory allocation exceeded configured limit (${container?.memoryLimit || 'configured memory threshold'}). Kernel cgroup subsystem dispatched SIGKILL (Exit 137).`
            : faultIdx < 4
            ? 'Container process has not yet executed; cgroup limits not engaged.'
            : 'Kernel cgroup boundaries allocated nominal CPU and Memory shares.',
        blastRadius:
          faultStageId === 'kernel_cgroups'
            ? 'Abrupt process termination; active socket connections severed. In-flight requests dropped.'
            : 'Cgroup resource envelope respected.',
        architecturalFix: 'Increase spec.containers[*].resources.limits.memory in the deployment manifest or profile application heap memory consumption.'
      },
      {
        id: 'app_runtime',
        layerNumber: 6,
        name: 'Application Runtime (PID 1)',
        subsystem: 'Container Process & Health Probes',
        icon: Terminal,
        status:
          faultStageId === 'app_runtime'
            ? 'FAULT_POINT'
            : faultIdx < 5
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'app_runtime'
            ? `CrashLoop (Exit ${exitCode ?? 1}) / Probe Fail`
            : faultIdx < 5
            ? 'Blocked: Waiting for Image'
            : 'Process PID 1 Running & Healthy',
        roleDescription: 'Launches application entrypoint, establishes database/upstream connections, listens on target ports, and answers readiness probes.',
        observedBehavior:
          faultStageId === 'app_runtime'
            ? `Container process terminated immediately after startup (Exit code ${exitCode ?? 1}). Kubelet engaged exponential restart back-off after ${restartCount} crashes.`
            : faultIdx < 5
            ? 'Process cannot launch because container image layers failed to pull from registry.'
            : 'Application process running inside container namespace, listening on port and serving traffic.',
        blastRadius:
          faultStageId === 'app_runtime'
            ? 'Application process flapping in crash cycle. Pod not ready; restarts incrementing.'
            : 'Nominal application execution.',
        architecturalFix: 'Inspect container stderr logs, check missing environment variables, verify configuration files, or adjust startup probe timeout.'
      },
      {
        id: 'ingress_network',
        layerNumber: 7,
        name: 'Service Mesh & Ingress Routing',
        subsystem: 'kube-proxy & EndpointSlice Controller',
        icon: Network,
        status:
          faultStageId === 'ingress_network'
            ? 'FAULT_POINT'
            : faultIdx < 6
            ? 'BLOCKED'
            : 'PASSED',
        statusSummary:
          faultStageId === 'ingress_network'
            ? 'No Endpoints / Selector Mismatch'
            : faultIdx < 6
            ? 'Endpoints Withheld (Pod Not Ready)'
            : 'Traffic Routing Active (HTTP 200 OK)',
        roleDescription: 'Monitors Pod readiness status, registers healthy pod IPs into Service EndpointSlices, and forwards external traffic via Ingress.',
        observedBehavior:
          faultStageId === 'ingress_network'
            ? 'Service ClusterIP has 0 active endpoints; service selector labels do not match any healthy pods in namespace.'
            : faultIdx < 6
            ? 'Endpoints controller intentionally withholds pod IP from Service routing because Container is in waiting/failing condition.'
            : 'Pod IP registered in EndpointSlice; ingress actively routing client HTTP traffic.',
        blastRadius:
          faultStageId === 'ingress_network'
            ? 'Clients attempting to connect receive HTTP 502 / Connection Refused.'
            : 'Pod prevented from receiving client requests, preventing user-facing HTTP errors.',
        architecturalFix: 'Ensure backing pods reach Ready state, or reconcile Service selector labels with Pod template metadata.'
      }
    ];
  };

  const stages = resolveArchitectureStages();
  const faultStage = stages.find((s) => s.status === 'FAULT_POINT') || stages[3];
  const [selectedStageId, setSelectedStageId] = useState<string>(faultStage.id);

  const currentStage = stages.find((s) => s.id === selectedStageId) || faultStage;

  return (
    <div className="rounded-xl bg-zinc-950/80 border border-zinc-800/90 overflow-hidden shadow-xs">
      {/* Top Banner: Architectural Fault Isolation Banner */}
      <div className="p-4 bg-zinc-900/90 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-rose-950/90 border border-rose-800/80 flex items-center justify-center shrink-0 shadow-xs">
            <AlertOctagon className="w-4 h-4 text-rose-400 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-rose-300">
                Architectural Fault Isolation Point
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-400 border border-rose-800/60">
                LAYER {faultStage.layerNumber} / 7
              </span>
            </div>
            <p className="text-xs text-zinc-300 font-sans mt-0.5">
              Break occurred at <strong className="text-zinc-100">{faultStage.name}</strong> ({faultStage.subsystem})
            </p>
          </div>
        </div>

        {/* Quick SRE Architecture Stats */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 uppercase">Blast Radius:</span>
            <span className="text-amber-400 font-semibold text-[11px]">Pod Sandbox Stalled</span>
          </div>
          <div className="px-2.5 py-1 rounded-md bg-zinc-950 border border-zinc-800 flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 uppercase">Control Loop:</span>
            <span className="text-sky-400 font-semibold text-[11px]">Back-off Exponential</span>
          </div>
        </div>
      </div>

      {/* 7-Layer Architectural Flow Pipeline */}
      <div className="p-4 sm:p-5 border-b border-zinc-800/80 bg-zinc-950/40">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-mono uppercase font-bold text-zinc-400 tracking-wider flex items-center gap-2">
            <Boxes className="w-3.5 h-3.5 text-sky-400" />
            Kubernetes Workload Execution Pipeline Topology:
          </span>
          <span className="text-[10px] font-mono text-zinc-500">
            Click any layer node to inspect architectural contract
          </span>
        </div>

        {/* Responsive Grid Pipeline */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {stages.map((stage, idx) => {
            const Icon = stage.icon;
            const isSelected = stage.id === selectedStageId;
            const isFault = stage.status === 'FAULT_POINT';
            const isPassed = stage.status === 'PASSED';
            const isBlocked = stage.status === 'BLOCKED';

            return (
              <button
                key={stage.id}
                type="button"
                onClick={() => setSelectedStageId(stage.id)}
                className={`p-3 rounded-lg border text-left transition-all relative cursor-pointer flex flex-col justify-between min-h-[110px] ${
                  isSelected
                    ? isFault
                      ? 'bg-rose-950/40 border-rose-500 shadow-md shadow-rose-950/30'
                      : isPassed
                      ? 'bg-emerald-950/30 border-emerald-500'
                      : 'bg-zinc-900 border-zinc-400'
                    : isFault
                    ? 'bg-rose-950/20 border-rose-800/80 hover:border-rose-600'
                    : isPassed
                    ? 'bg-zinc-950/90 border-emerald-900/50 hover:border-emerald-700/80'
                    : 'bg-zinc-950/60 border-zinc-800/60 hover:border-zinc-700 opacity-60'
                }`}
              >
                {/* Header: Layer Number + Status Icon */}
                <div className="flex items-center justify-between gap-1 mb-2">
                  <span
                    className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      isFault
                        ? 'bg-rose-950 text-rose-300 border border-rose-800/80 font-bold'
                        : isPassed
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/60'
                        : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    L{stage.layerNumber}
                  </span>

                  {isFault && (
                    <span className="flex items-center gap-1 text-[9px] font-mono font-bold text-rose-400 animate-pulse">
                      <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
                      FAULT
                    </span>
                  )}
                  {isPassed && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  {isBlocked && (
                    <PauseCircle className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                  )}
                </div>

                {/* Subsystem & Title */}
                <div>
                  <div className="flex items-center gap-1.5 text-zinc-200">
                    <Icon
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isFault ? 'text-rose-400' : isPassed ? 'text-emerald-400' : 'text-zinc-400'
                      }`}
                    />
                    <span className="font-mono text-[11px] font-bold truncate block">
                      {stage.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400 font-mono block truncate mt-0.5">
                    {stage.subsystem}
                  </span>
                </div>

                {/* Bottom Status Pill */}
                <div className="mt-2 pt-1.5 border-t border-zinc-800/60">
                  <span
                    className={`text-[9px] font-mono block truncate ${
                      isFault
                        ? 'text-rose-300 font-bold'
                        : isPassed
                        ? 'text-emerald-400'
                        : 'text-zinc-500'
                    }`}
                  >
                    {isFault ? '💥 Breakpoint' : isPassed ? '✓ Passed' : '⏸ Stalled'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Stage Detail Inspector */}
      <div className="p-4 sm:p-5 bg-zinc-950/70 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
          <div className="flex items-center gap-2">
            <currentStage.icon
              className={`w-4 h-4 ${
                currentStage.status === 'FAULT_POINT'
                  ? 'text-rose-400'
                  : currentStage.status === 'PASSED'
                  ? 'text-emerald-400'
                  : 'text-zinc-400'
              }`}
            />
            <h4 className="text-xs font-mono font-bold uppercase text-zinc-200">
              Layer {currentStage.layerNumber}: {currentStage.name} Inspector
            </h4>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                currentStage.status === 'FAULT_POINT'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800'
                  : currentStage.status === 'PASSED'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
              }`}
            >
              {currentStage.statusSummary}
            </span>
          </div>

          <span className="text-[11px] font-mono text-zinc-400">
            Subsystem: <strong className="text-zinc-200">{currentStage.subsystem}</strong>
          </span>
        </div>

        {/* 2-Column Architectural Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
          {/* Left Column: Role & Observed Behavior */}
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 block mb-1">
                Architectural Responsibility:
              </span>
              <p className="text-zinc-200 leading-relaxed text-xs">
                {currentStage.roleDescription}
              </p>
            </div>

            <div
              className={`p-3 rounded-lg border ${
                currentStage.status === 'FAULT_POINT'
                  ? 'bg-rose-950/30 border-rose-900/70'
                  : currentStage.status === 'PASSED'
                  ? 'bg-emerald-950/20 border-emerald-900/50'
                  : 'bg-zinc-900/40 border-zinc-800/60'
              }`}
            >
              <span
                className={`text-[10px] font-mono uppercase font-bold block mb-1 ${
                  currentStage.status === 'FAULT_POINT'
                    ? 'text-rose-400'
                    : currentStage.status === 'PASSED'
                    ? 'text-emerald-400'
                    : 'text-zinc-400'
                }`}
              >
                Observed Runtime Behavior in this Incident:
              </span>
              <p className="text-zinc-200 leading-relaxed text-xs font-mono">
                {currentStage.observedBehavior}
              </p>
            </div>
          </div>

          {/* Right Column: Blast Radius & Architectural Resolution */}
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800/80">
              <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 block mb-1">
                Blast Radius & Propagation:
              </span>
              <p className="text-zinc-300 leading-relaxed text-xs">
                {currentStage.blastRadius}
              </p>
            </div>

            <div className="p-3 rounded-lg bg-sky-950/20 border border-sky-900/50">
              <span className="text-[10px] font-mono uppercase font-bold text-sky-400 block mb-1">
                Architectural Resolution Vector:
              </span>
              <p className="text-sky-200 leading-relaxed text-xs">
                {currentStage.architecturalFix}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
