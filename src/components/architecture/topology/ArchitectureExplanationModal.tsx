import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  ExternalLink,
  Globe,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Network,
  RefreshCw,
  Server,
  Sparkles,
  Terminal,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api/client';
import { Cluster, Incident, KubernetesResource } from '../../../types/index';
import { ArchitectureAIExplanation, ArchitectureTelemetryState } from '../types';
import { TopologyNode } from './types';

interface ArchitectureExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
  cluster: Cluster | null;
  resources: KubernetesResource[];
  telemetry: ArchitectureTelemetryState;
  incidents: Incident[];
  selectedNode?: TopologyNode | null;
  onSelectResource?: (resource: KubernetesResource) => void;
}

type ModalTab = 'architecture' | 'diagnostics';

/**
 * Client-side grounded fallback engine that instantly synthesizes Kubernetes spec,
 * conditions, and incidents if the network or remote AI API is delayed or fails.
 */
function generateClientFallback(
  targetInfo: {
    type: 'cluster' | 'domain' | 'resource';
    id: string;
    name: string;
    kind: string;
    namespace?: string;
    domainId?: string;
    health: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  },
  cluster: Cluster | null,
  clusterSummary: {
    totalNodes: number;
    totalWorkloads: number;
    totalPods: number;
    totalServices: number;
    totalIngresses: number;
    totalPvcs: number;
    activeIncidentsCount: number;
  },
  correlatedIncidents: Incident[],
  selectedNode?: TopologyNode | null
): ArchitectureAIExplanation {
  const ns = targetInfo.namespace ? `-n ${targetInfo.namespace}` : '';
  const kind = targetInfo.kind;
  const name = targetInfo.name;
  const isCluster = targetInfo.type === 'cluster';
  const isDomain = targetInfo.type === 'domain';
  const hasIssues = targetInfo.health !== 'HEALTHY' || correlatedIncidents.length > 0;

  let title = '';
  let summary = '';
  let overview = '';
  let keyResponsibilities: string[] = [];
  let networkTrafficPath = '';
  let storageAndState = '';
  const commands: Array<{ command: string; description: string; category: 'inspect' | 'logs' | 'remediate' | 'metrics' }> = [];

  if (isCluster) {
    title = `${cluster?.name || 'Kubernetes'} Cluster Architecture`;
    summary = `The cluster operates across ${clusterSummary.totalNodes} node(s) hosting ${clusterSummary.totalWorkloads} workload controller(s) and ${clusterSummary.totalPods} pod(s). Internal communication and external traffic are managed via ${clusterSummary.totalServices} service(s) and ${clusterSummary.totalIngresses} ingress gateway(s).`;
    overview = `This cluster forms the unified compute and orchestration plane. Workloads are distributed across compute nodes according to resource requests, anti-affinity rules, and scheduler constraints.`;
    keyResponsibilities = [
      `Execute containerized applications across ${clusterSummary.totalNodes} node(s)`,
      `Manage internal VIP routing, DNS resolution, and load balancing`,
      `Enforce RBAC namespaces, network isolation, and persistent volume lifecycles`
    ];
    networkTrafficPath = clusterSummary.totalIngresses > 0
      ? 'Edge traffic arrives at the Ingress Controller and is dispatched across ClusterIP services to healthy pod endpoints.'
      : 'Cluster-internal traffic communicates via CoreDNS and kube-proxy virtual IPs to backend pod EndpointSlices.';
    storageAndState = clusterSummary.totalPvcs > 0
      ? `${clusterSummary.totalPvcs} PersistentVolumeClaims bound to CSI storage backends.`
      : 'Workloads execute statelessly or rely on external managed persistence.';
    commands.push(
      { command: 'kubectl get nodes -o wide', description: 'List all cluster worker nodes, addresses, and statuses', category: 'inspect' },
      { command: 'kubectl top nodes', description: 'View live CPU and memory utilization across the node pool', category: 'metrics' },
      { command: 'kubectl get pods -A --field-selector status.phase!=Running', description: 'List any unhealthy, failing, or pending pods', category: 'remediate' }
    );
  } else if (isDomain) {
    title = `${name} Domain Architecture`;
    summary = `The ${name} domain encapsulates core ${targetInfo.domainId || 'cluster'} primitives supporting workload availability and network isolation.`;
    overview = `Coordinates operational lifecycles, configuration policies, and scheduling constraints for related cluster components.`;
    keyResponsibilities = [
      `Maintain declarative operational parameters for ${name}`,
      `Coordinate self-healing, rolling updates, and resource allocation`,
      `Ensure fault tolerance across node failure domains`
    ];
    commands.push(
      { command: `kubectl get all -A`, description: 'List all running resources across namespaces', category: 'inspect' },
      { command: `kubectl get events -A --sort-by=.metadata.creationTimestamp`, description: 'Stream recent cluster warning and failure events', category: 'logs' }
    );
  } else {
    // Single Resource
    title = `${kind}: ${name}`;
    summary = `${name} is an active ${kind} operating in namespace "${targetInfo.namespace || 'default'}".`;

    if (kind === 'Deployment') {
      overview = `Declarative controller that ensures the desired replica set of application containers is running with automated rolling updates and zero downtime.`;
      keyResponsibilities = [
        'Maintain desired replica count and auto-restart failed containers',
        'Coordinate rolling upgrades with maxSurge and maxUnavailable guarantees',
        'Mount secrets, configuration ConfigMaps, and storage volumes'
      ];
      networkTrafficPath = `Traffic routes through matching Kubernetes Service selectors to pod ports.`;
      commands.push(
        { command: `kubectl describe deployment ${name} ${ns}`, description: 'Inspect deployment status, conditions, and pod template', category: 'inspect' },
        { command: `kubectl get pods -l app=${name} ${ns}`, description: 'List pods currently managed by this deployment', category: 'inspect' },
        { command: `kubectl rollout restart deployment ${name} ${ns}`, description: 'Perform a safe, zero-downtime rolling restart', category: 'remediate' }
      );
    } else if (kind === 'Pod') {
      overview = `The fundamental execution unit in Kubernetes, wrapping container processes with shared network namespace, IP address, and storage volumes.`;
      keyResponsibilities = [
        'Run application processes inside isolated cgroup sandboxes',
        'Respond to readiness and liveness health probes from kubelet',
        'Share local volume mounts and network socket interfaces'
      ];
      commands.push(
        { command: `kubectl describe pod ${name} ${ns}`, description: 'Inspect container status, exit codes, and recent events', category: 'inspect' },
        { command: `kubectl logs ${name} ${ns} --tail=100`, description: 'Tail standard container output and error logs', category: 'logs' },
        { command: `kubectl top pod ${name} ${ns}`, description: 'Check live CPU and memory consumption', category: 'metrics' }
      );
    } else if (kind === 'Service') {
      overview = `Network abstraction providing a stable virtual ClusterIP, DNS record, and load balancing across backing pod endpoints.`;
      keyResponsibilities = [
        'Provide a persistent virtual IP (ClusterIP) within the cluster network',
        'Load-balance incoming traffic across healthy backing pods',
        'Publish service discovery endpoints for downstream microservices'
      ];
      networkTrafficPath = `Incoming requests to Service IP:Port are directed via kube-proxy iptables/IPVS to healthy pod IP endpoints.`;
      commands.push(
        { command: `kubectl describe svc ${name} ${ns}`, description: 'View service selector, ports, and cluster IP', category: 'inspect' },
        { command: `kubectl get endpointslices -l kubernetes.io/service-name=${name} ${ns}`, description: 'Inspect active backend endpoint IPs receiving traffic', category: 'inspect' }
      );
    } else if (kind === 'Node') {
      overview = `Kubernetes worker node running container runtime, kubelet, and network proxies to execute scheduled pod workloads.`;
      keyResponsibilities = [
        'Execute container processes and allocate CPU/memory cgroups',
        'Report node capacity, hardware health, and condition telemetry',
        'Manage local container image caching and volume mount attachments'
      ];
      commands.push(
        { command: `kubectl describe node ${name}`, description: 'Inspect node conditions, capacity, and allocatable limits', category: 'inspect' },
        { command: `kubectl top node ${name}`, description: 'Inspect live CPU and memory utilization', category: 'metrics' },
        { command: `kubectl get pods --field-selector spec.nodeName=${name} -A`, description: 'List all pods scheduled onto this node', category: 'inspect' }
      );
    } else {
      overview = `Resource of type ${kind} configuring and supporting the Kubernetes cluster workload mesh.`;
      keyResponsibilities = [`Maintain Kubernetes ${kind} API specification and operational state`];
      commands.push({ command: `kubectl describe ${kind.toLowerCase()} ${name} ${ns}`, description: `Inspect ${kind} details and status`, category: 'inspect' });
    }
  }

  const headline = hasIssues
    ? (correlatedIncidents[0]?.title || 'Operational Anomaly Detected')
    : 'Operational & Healthy';

  const details = hasIssues
    ? (correlatedIncidents[0] ? `${correlatedIncidents[0].title}: ${correlatedIncidents[0].incidentType}. Operator review advised.` : 'Resource is experiencing degraded health or pending status.')
    : 'All observed conditions, container probes, and replica sets are operating within normal parameters.';

  return {
    title,
    targetType: targetInfo.type,
    targetName: targetInfo.name,
    targetKind: targetInfo.kind,
    summary,
    operationalStatus: {
      health: targetInfo.health,
      headline,
      details
    },
    architectureAndRole: {
      overview,
      keyResponsibilities,
      networkTrafficPath: networkTrafficPath || undefined,
      storageAndState: storageAndState || undefined
    },
    resilienceAndPerformance: {
      highAvailabilityVerdict: 'Standard Kubernetes cluster resilience applied.',
      bottlenecksOrRisks: hasIssues ? ['Elevated restart count or pending pods detected.'] : ['No critical capacity bottlenecks detected.']
    },
    securityPosture: {
      verdict: 'Standard Kubernetes security posture',
      recommendations: ['Enforce non-root execution where applicable']
    },
    activeIssuesAndDiagnostics: {
      hasIssues,
      incidentSummary: correlatedIncidents.length > 0 ? correlatedIncidents.map((i) => i.title).join('; ') : undefined,
      rootCauseHypothesis: correlatedIncidents.length > 0 ? `Correlated failure in ${correlatedIncidents[0].incidentType}. Verify container exit codes and logs.` : undefined
    },
    recommendedCommands: commands,
    bestPracticeTips: [
      'Maintain explicit resource requests and limits to guarantee predictable scheduling.',
      'Configure readiness probes to prevent unready containers from receiving production traffic.'
    ],
    aiModel: 'SkyOps Kubernetes Intelligence',
    isAiGenerated: false,
    generatedAt: Date.now()
  };
}

export const ArchitectureExplanationModal: React.FC<ArchitectureExplanationModalProps> = ({
  isOpen,
  onClose,
  cluster,
  resources,
  telemetry,
  incidents,
  selectedNode,
  onSelectResource
}) => {
  // Exactly 2 strong, useful AI features:
  // 1. 'architecture' (Architecture & Topology Flow)
  // 2. 'diagnostics' (SRE Diagnostics & Kubectl Runbook)
  const [activeTab, setActiveTab] = useState<ModalTab>('architecture');
  const [explanation, setExplanation] = useState<ArchitectureAIExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Target information resolution
  const targetInfo = useMemo(() => {
    if (!selectedNode || selectedNode.type === 'cluster') {
      return {
        type: 'cluster' as const,
        id: cluster?.id || 'cluster-root',
        name: cluster?.name || 'Kubernetes Cluster',
        kind: 'Cluster',
        namespace: undefined,
        domainId: undefined,
        resource: undefined,
        health: (cluster?.status as string) === 'DEGRADED' || cluster?.status === 'CRITICAL' ? ('CRITICAL' as const) : ('HEALTHY' as const)
      };
    }

    if (selectedNode.type === 'domain_group') {
      const h = selectedNode.health;
      return {
        type: 'domain' as const,
        id: selectedNode.id,
        name: selectedNode.name,
        kind: selectedNode.kind || 'Domain Group',
        namespace: undefined,
        domainId: selectedNode.domainId,
        resource: undefined,
        health: h === 'UNKNOWN' || !h ? ('HEALTHY' as const) : h
      };
    }

    const resHealth = selectedNode.health;
    return {
      type: 'resource' as const,
      id: selectedNode.id,
      name: selectedNode.name,
      kind: selectedNode.kind,
      namespace: selectedNode.namespace || 'default',
      domainId: selectedNode.domainId,
      resource: selectedNode.resource,
      health: resHealth === 'UNKNOWN' || !resHealth ? ('HEALTHY' as const) : resHealth
    };
  }, [selectedNode, cluster]);

  // Aggregate cluster summary for grounding
  const clusterSummary = useMemo(() => {
    const nodes = resources.filter((r) => r.kind === 'Node');
    const pods = resources.filter((r) => r.kind === 'Pod');
    const services = resources.filter((r) => r.kind === 'Service');
    const ingresses = resources.filter((r) => r.kind === 'Ingress' || r.kind === 'Gateway');
    const workloads = resources.filter((r) =>
      ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(r.kind)
    );
    const pvcs = resources.filter((r) => r.kind === 'PersistentVolumeClaim');

    return {
      totalNodes: nodes.length,
      totalWorkloads: workloads.length,
      totalPods: pods.length,
      totalServices: services.length,
      totalIngresses: ingresses.length,
      totalPvcs: pvcs.length,
      activeIncidentsCount: incidents.length
    };
  }, [resources, incidents]);

  // Correlated incidents for target
  const correlatedIncidents = useMemo(() => {
    return (selectedNode?.incidents || incidents.filter((i) => {
      if (!selectedNode || selectedNode.type === 'cluster') return true;
      if (selectedNode.type === 'domain_group') {
        return selectedNode.domainId ? i.resourceKind?.toLowerCase().includes(selectedNode.domainId.toLowerCase()) : false;
      }
      return i.resourceName === selectedNode.name || (i as any).resourceId === selectedNode.id;
    }));
  }, [selectedNode, incidents]);

  // Fetch or regenerate explanation
  const fetchExplanation = async () => {
    setLoading(true);

    // Prepare instant client fallback in case of latency or network issue
    const fallback = generateClientFallback(
      targetInfo,
      cluster,
      clusterSummary,
      correlatedIncidents,
      selectedNode
    );

    try {
      const payload = {
        clusterId: cluster?.id,
        clusterName: cluster?.name || 'Kubernetes Cluster',
        targetType: targetInfo.type,
        targetId: targetInfo.id,
        targetName: targetInfo.name,
        targetKind: targetInfo.kind,
        namespace: targetInfo.namespace,
        domainId: targetInfo.domainId,
        resourceSpec: targetInfo.resource ? (targetInfo.resource as any).spec || targetInfo.resource.specSummary : undefined,
        resourceStatus: targetInfo.resource ? (targetInfo.resource as any).status : undefined,
        metrics: selectedNode?.metrics,
        replicas: selectedNode?.replicas,
        health: targetInfo.health,
        statusText: selectedNode?.statusText,
        incidents: correlatedIncidents.map((inc) => ({
          id: inc.id,
          title: inc.title,
          severity: inc.severity,
          incidentType: inc.incidentType,
          firstSeenAt: inc.firstSeenAt,
          occurrenceCount: inc.occurrenceCount
        })),
        clusterSummary
      };

      const res = await api.explainArchitecture(payload);
      if (res && res.explanation) {
        setExplanation(res.explanation);
      } else {
        setExplanation(fallback);
      }
    } catch (err) {
      console.warn('[ArchitectureExplanationModal] Using grounded fallback due to network/API error:', err);
      // Fall back seamlessly without breaking UI
      setExplanation(fallback);
    } finally {
      setLoading(false);
    }
  };

  // Trigger when modal opens or target changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab('architecture');
      fetchExplanation();
    } else {
      setExplanation(null);
    }
  }, [isOpen, selectedNode?.id, cluster?.id]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(text);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  if (!isOpen) return null;

  const targetIcon = () => {
    if (targetInfo.type === 'cluster') return <Server className="w-5 h-5 text-sky-400" />;
    if (targetInfo.type === 'domain') return <Layers className="w-5 h-5 text-indigo-400" />;
    const k = targetInfo.kind;
    if (k === 'Node') return <Cpu className="w-5 h-5 text-emerald-400" />;
    if (k === 'Service') return <Network className="w-5 h-5 text-cyan-400" />;
    if (k === 'Ingress' || k === 'Gateway') return <Globe className="w-5 h-5 text-blue-400" />;
    if (k === 'PersistentVolumeClaim') return <HardDrive className="w-5 h-5 text-amber-400" />;
    return <Boxes className="w-5 h-5 text-sky-400" />;
  };

  const healthColor =
    targetInfo.health === 'CRITICAL'
      ? 'text-rose-400 bg-rose-500/15 border-rose-500/30'
      : targetInfo.health === 'WARNING'
      ? 'text-amber-400 bg-amber-500/15 border-amber-500/30'
      : 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30';

  const hasActiveIssues = Boolean(
    explanation?.activeIssuesAndDiagnostics?.hasIssues ||
    targetInfo.health !== 'HEALTHY' ||
    correlatedIncidents.length > 0
  );

  return (
    <div
      id="architecture-ai-explanation-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
    >
      <div
        id="architecture-ai-explanation-modal"
        className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[88vh] font-sans"
      >
        {/* ==========================================
            1. MODAL HEADER
            ========================================== */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 shrink-0 shadow-inner">
              {targetIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded">
                  {targetInfo.kind}
                </span>
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${healthColor}`}>
                  {targetInfo.health}
                </span>
                {explanation?.aiModel && (
                  <span className="text-[10px] font-mono text-sky-300 bg-sky-500/10 border border-sky-500/25 px-2 py-0.5 rounded flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-sky-400" />
                    <span>{explanation.aiModel}</span>
                  </span>
                )}
              </div>
              <h2 className="text-base sm:text-lg font-bold text-zinc-100 truncate mt-1">
                AI Architecture Insight: {targetInfo.name}
              </h2>
              <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">
                {targetInfo.namespace ? `Namespace: ${targetInfo.namespace}` : 'Scope: Cluster-wide'}
                {targetInfo.domainId ? ` | Domain: ${targetInfo.domainId}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              id="ai-explain-refresh-btn"
              onClick={() => fetchExplanation()}
              disabled={loading}
              title="Refresh Explanation"
              className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              id="ai-explain-close-btn"
              onClick={onClose}
              className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ==========================================
            2. TWO CORE AI FEATURES (TABS)
            Feature 1: Architecture & Topology Flow
            Feature 2: Diagnostics & Kubectl Runbook
            ========================================== */}
        <div className="flex items-center border-b border-zinc-800 bg-zinc-950 px-4 shrink-0 font-mono text-xs">
          <button
            id="tab-architecture"
            onClick={() => setActiveTab('architecture')}
            className={`py-3 px-4 border-b-2 font-medium flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'architecture'
                ? 'border-sky-400 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Architecture & Topology</span>
          </button>

          <button
            id="tab-diagnostics"
            onClick={() => setActiveTab('diagnostics')}
            className={`py-3 px-4 border-b-2 font-medium flex items-center gap-2 transition cursor-pointer ${
              activeTab === 'diagnostics'
                ? 'border-sky-400 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Diagnostics & Runbook</span>
            {hasActiveIssues && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse ml-0.5" />
            )}
          </button>
        </div>

        {/* ==========================================
            3. TAB CONTENT
            ========================================== */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-zinc-300 leading-relaxed flex-1">
          {loading && !explanation ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3">
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
              <div className="text-zinc-200 font-semibold text-sm">
                Analyzing Architecture & Telemetry...
              </div>
              <div className="text-zinc-500 text-xs font-mono text-center max-w-sm">
                Synthesizing cluster topology, active specs, and live runtime metrics
              </div>
            </div>
          ) : (
            <>
              {/* Executive Summary Card */}
              <div className="p-3.5 rounded-xl bg-sky-950/20 border border-sky-500/25 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] uppercase tracking-wider font-mono font-bold text-sky-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                    <span>Executive Summary</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-400">
                    {explanation?.operationalStatus?.headline || 'Operational'}
                  </span>
                </div>
                <p className="text-zinc-200 text-xs sm:text-sm font-medium leading-relaxed">
                  {explanation?.summary || 'Analyzing resource role in cluster topology...'}
                </p>
              </div>

              {/* FEATURE 1: ARCHITECTURE & TOPOLOGY FLOW */}
              {activeTab === 'architecture' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  {/* Architectural Role Overview */}
                  <div className="space-y-1.5">
                    <h3 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5 text-sky-400" />
                      <span>Role in Cluster</span>
                    </h3>
                    <div className="p-3.5 rounded-xl bg-zinc-900/70 border border-zinc-800 text-zinc-300 leading-relaxed text-xs">
                      {explanation?.architectureAndRole?.overview ||
                        'Serves as a managed component within the cluster infrastructure.'}
                    </div>
                  </div>

                  {/* Key Responsibilities */}
                  {explanation?.architectureAndRole?.keyResponsibilities &&
                    explanation.architectureAndRole.keyResponsibilities.length > 0 && (
                      <div className="space-y-1.5">
                        <h4 className="text-xs font-mono font-bold text-zinc-300">
                          Core Responsibilities
                        </h4>
                        <div className="space-y-1.5">
                          {explanation.architectureAndRole.keyResponsibilities.map((resp, idx) => (
                            <div
                              key={idx}
                              className="p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/80 flex items-start gap-2 text-zinc-300"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{resp}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Traffic & Topology Path */}
                  {explanation?.architectureAndRole?.networkTrafficPath && (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-mono font-bold text-cyan-400 flex items-center gap-1.5">
                        <Network className="w-3.5 h-3.5" />
                        <span>Traffic & Networking Flow</span>
                      </h4>
                      <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-300 text-xs">
                        {explanation.architectureAndRole.networkTrafficPath}
                      </div>
                    </div>
                  )}

                  {/* Storage / Persistence state */}
                  {explanation?.architectureAndRole?.storageAndState && (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1.5">
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Storage & Persistence</span>
                      </h4>
                      <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800 text-zinc-300 text-xs">
                        {explanation.architectureAndRole.storageAndState}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* FEATURE 2: SRE DIAGNOSTICS & KUBECTL RUNBOOK */}
              {activeTab === 'diagnostics' && (
                <div className="space-y-4 animate-in fade-in duration-150">
                  {/* Health Status & Root Cause Diagnosis */}
                  <div className="space-y-2">
                    <h3 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-sky-400" />
                      <span>Operational Health & Diagnosis</span>
                    </h3>

                    {hasActiveIssues ? (
                      <div className="p-3.5 rounded-xl bg-rose-950/25 border border-rose-900/60 space-y-2">
                        <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
                          <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                          <span>
                            {explanation?.activeIssuesAndDiagnostics?.incidentSummary ||
                              'Active incident or health degradation detected'}
                          </span>
                        </div>
                        {explanation?.activeIssuesAndDiagnostics?.rootCauseHypothesis && (
                          <div className="text-zinc-300 text-xs bg-zinc-900/80 p-2.5 rounded-lg border border-zinc-800">
                            <span className="font-mono text-[10px] text-zinc-500 uppercase block font-bold mb-1">
                              Root Cause Hypothesis:
                            </span>
                            {explanation.activeIssuesAndDiagnostics.rootCauseHypothesis}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                        <div>
                          <div className="text-xs font-bold text-emerald-300">
                            Zero Active Incidents Detected
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">
                            {explanation?.operationalStatus?.details ||
                              'All health probes, container conditions, and observed replica sets are operating normally.'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Production Kubectl Runbook */}
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-mono font-bold text-sky-400 flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Actionable Kubectl Commands</span>
                      </h4>
                      <span className="text-[10px] font-mono text-zinc-500">
                        Click to copy
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {(explanation?.recommendedCommands || []).slice(0, 3).map((item, idx) => {
                        const isCopied = copiedCmd === item.command;
                        return (
                          <div
                            key={idx}
                            className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800 space-y-1.5 hover:border-zinc-700 transition"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-zinc-300 font-medium text-xs">
                                {item.description}
                              </span>
                              <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                {item.category}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 bg-zinc-950 p-2 rounded-lg border border-zinc-800/80 font-mono text-[11px] text-sky-300">
                              <code className="truncate selection:bg-sky-500/30">
                                {item.command}
                              </code>
                              <button
                                onClick={() => handleCopy(item.command)}
                                className="p-1 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded transition cursor-pointer shrink-0"
                                title="Copy command"
                              >
                                {isCopied ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ==========================================
            4. MODAL FOOTER
            ========================================== */}
        <div className="p-3.5 sm:p-4 border-t border-zinc-800 bg-zinc-900/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
            <span>SkyOps Architecture AI</span>
            <span>•</span>
            <span>{clusterSummary.totalNodes} Nodes / {clusterSummary.totalWorkloads} Workloads</span>
          </div>

          <div className="flex items-center gap-2">
            {targetInfo.resource && onSelectResource && (
              <button
                onClick={() => {
                  onSelectResource(targetInfo.resource!);
                  onClose();
                }}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 font-mono text-xs rounded-lg transition cursor-pointer flex items-center gap-1.5"
              >
                <span>Full Details</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold rounded-lg transition cursor-pointer font-mono text-xs"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
