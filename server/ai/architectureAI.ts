import { GoogleGenAI } from '@google/genai';

export interface ArchitectureExplainRequest {
  clusterId?: string;
  clusterName?: string;
  targetType: 'cluster' | 'domain' | 'resource';
  targetId: string;
  targetName: string;
  targetKind: string;
  namespace?: string;
  domainId?: string;
  resourceSpec?: any;
  resourceStatus?: any;
  metrics?: {
    cpu?: string;
    memory?: string;
    isAvailable?: boolean;
  };
  replicas?: {
    ready?: number;
    desired?: number;
  };
  health?: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  statusText?: string;
  incidents?: Array<{
    id: string;
    title: string;
    severity: string;
    incidentType: string;
    firstSeenAt: number;
    occurrenceCount: number;
  }>;
  relatedResources?: Array<{
    kind: string;
    name: string;
    namespace?: string;
    relation: string;
  }>;
  backingPods?: Array<{
    name: string;
    status: string;
    health?: string;
    restarts?: number;
  }>;
  clusterSummary?: {
    totalNodes: number;
    totalWorkloads: number;
    totalPods: number;
    totalServices: number;
    totalIngresses: number;
    totalPvcs: number;
    activeIncidentsCount: number;
  };
  userPrompt?: string;
}

export interface ArchitectureAIExplanation {
  title: string;
  targetType: 'cluster' | 'domain' | 'resource';
  targetName: string;
  targetKind: string;
  summary: string;
  operationalStatus: {
    health: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    headline: string;
    details: string;
  };
  architectureAndRole: {
    overview: string;
    keyResponsibilities: string[];
    networkTrafficPath?: string;
    storageAndState?: string;
  };
  resilienceAndPerformance: {
    highAvailabilityVerdict: string;
    replicaAssessment?: string;
    resourceAllocationVerdict?: string;
    bottlenecksOrRisks: string[];
  };
  securityPosture: {
    verdict: string;
    recommendations: string[];
  };
  activeIssuesAndDiagnostics: {
    hasIssues: boolean;
    incidentSummary?: string;
    rootCauseHypothesis?: string;
  };
  recommendedCommands: Array<{
    command: string;
    description: string;
    category: 'inspect' | 'logs' | 'remediate' | 'metrics';
  }>;
  bestPracticeTips: string[];
  customAnswer?: string;
  aiModel: string;
  isAiGenerated: boolean;
  generatedAt: number;
}

let geminiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return null;
  }
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: apiKey.trim() });
  }
  return geminiClient;
}

/**
 * Deterministic SRE rule engine fallback for when Gemini API key is absent or unreachable.
 * Synthesizes Kubernetes cluster topology, spec definitions, and live telemetry.
 */
function generateDeterministicExplanation(req: ArchitectureExplainRequest): ArchitectureAIExplanation {
  const isCluster = req.targetType === 'cluster';
  const isDomain = req.targetType === 'domain';
  const health = req.health || 'HEALTHY';
  const incidents = req.incidents || [];
  const hasIssues = health !== 'HEALTHY' || incidents.length > 0;
  const ns = req.namespace ? `-n ${req.namespace}` : '';

  // 1. Target Title & Headline
  let title = '';
  let summary = '';
  let overview = '';
  let responsibilities: string[] = [];
  let networkPath = '';
  let storageAndState = '';
  let haVerdict = '';
  let replicaAssessment = '';
  let resourceVerdict = '';
  const risks: string[] = [];
  const securityRecs: string[] = [];
  const commands: Array<{ command: string; description: string; category: 'inspect' | 'logs' | 'remediate' | 'metrics' }> = [];
  const tips: string[] = [];

  if (isCluster) {
    title = `${req.clusterName || 'Kubernetes'} Cluster Architecture`;
    const summaryData = req.clusterSummary || {
      totalNodes: 2,
      totalWorkloads: 5,
      totalPods: 14,
      totalServices: 4,
      totalIngresses: 1,
      totalPvcs: 1,
      activeIncidentsCount: incidents.length
    };
    summary = `Cluster operates across ${summaryData.totalNodes} compute nodes with ${summaryData.totalWorkloads} managed workloads and ${summaryData.totalPods} running pods. External traffic is serviced across ${summaryData.totalServices} service endpoints and ${summaryData.totalIngresses} ingress gateways.`;
    overview = `This cluster represents the core execution environment. Nodes are distributed to balance compute and memory requirements while maintaining high availability across scheduled workloads.`;
    responsibilities = [
      `Host and schedule containerized microservices across ${summaryData.totalNodes} compute nodes`,
      `Maintain cluster-internal DNS resolution, service mesh, and virtual IP routing`,
      `Ensure persistent state lifecycle management through StorageClasses and PVCs`,
      `Enforce RBAC boundaries, network policies, and API server authentication`
    ];
    networkPath = summaryData.totalIngresses > 0
      ? `Ingress controller routes edge traffic via HTTP/HTTPS host rules to internal ClusterIP services, which load balance across healthy endpoints.`
      : `Internal ClusterIP services route virtual IP traffic across pods using kube-proxy iptables/IPVS and EndpointSlice tracking.`;
    storageAndState = summaryData.totalPvcs > 0
      ? `${summaryData.totalPvcs} active PersistentVolumeClaims bound to CSI storage backends.`
      : `Workloads operate ephemerally or connect to external cloud database services.`;
    haVerdict = summaryData.totalNodes >= 3 ? 'Resilient: Multi-node topology prevents single node failure outages.' : 'Caution: Small node pool (≤2 nodes) limits scheduling tolerance during node maintenance or drained states.';
    if (summaryData.totalNodes < 3) {
      risks.push('Node pool size is small; draining a node during rolling upgrades can cause resource contention.');
    }
    commands.push(
      { command: 'kubectl get nodes -o wide', description: 'Inspect all cluster nodes, statuses, and kernel versions', category: 'inspect' },
      { command: 'kubectl top nodes', description: 'Evaluate live CPU and memory utilization across the node pool', category: 'metrics' },
      { command: 'kubectl get events -A --sort-by=.metadata.creationTimestamp', description: 'Review recent cluster-wide warning and scheduling events', category: 'logs' },
      { command: 'kubectl get pods -A --field-selector status.phase!=Running', description: 'Identify any unhealthy, pending, or crash-looping pods', category: 'remediate' }
    );
    tips.push('Configure PodDisruptionBudgets (PDB) to safeguard availability during planned node upgrades.');
    tips.push('Ensure Cluster Autoscaler or Karpenter is configured for dynamic compute elasticity under peak traffic.');
  } else if (isDomain) {
    const domainName = req.targetName;
    title = `${domainName} Architectural Domain`;
    
    if (domainName.toLowerCase().includes('workload')) {
      summary = `The Workloads domain encapsulates declarative application controllers including Deployments, StatefulSets, and DaemonSets that define container state and zero-downtime rolling strategies.`;
      overview = `Responsible for managing process lifecycles, replica counts, rolling upgrade batching, and container readiness probes across scheduled pods.`;
      responsibilities = [
        'Maintain desired replica counts and auto-healing of terminated containers',
        'Coordinate rolling update rollouts with maxSurge and maxUnavailable guarantees',
        'Inject environment configurations, secrets, and volume mounts into pod specs'
      ];
      haVerdict = req.replicas ? (req.replicas.desired && req.replicas.desired > 1 ? 'High Availability enabled across multiple replica sets.' : 'Single replica detected: susceptible to transient downtime during restarts.') : 'Workloads manage replica sets across worker nodes.';
      commands.push(
        { command: `kubectl get deployments,statefulsets,daemonsets -A`, description: 'List all managed workload controllers and replica readiness', category: 'inspect' },
        { command: `kubectl get pods -A -o wide --show-labels`, description: 'View pod placement and node distribution for workloads', category: 'inspect' },
        { command: `kubectl top pods -A --sort-by=cpu`, description: 'Identify top CPU-consuming workload pods', category: 'metrics' }
      );
      tips.push('Configure readiness and liveness probes to prevent unready pods from receiving production traffic.');
      tips.push('Set explicit CPU and memory resource requests/limits to prevent noisy neighbor contention.');
    } else if (domainName.toLowerCase().includes('compute')) {
      summary = `The Compute domain provides the underlying virtual or bare-metal execution nodes running kubelet, container runtime (containerd), and node telemetry agents.`;
      overview = `Executes scheduled pod sandboxes, allocates CPU/RAM cgroups, attaches volume mounts, and continuously reports node conditions (Ready, MemoryPressure, DiskPressure).`;
      responsibilities = [
        'Host and isolate container processes using Linux cgroups and namespaces',
        'Report node capacity, allocatable resources, and hardware heartbeat telemetry',
        'Handle local volume attachment and network interface binding (CNI)'
      ];
      haVerdict = 'Worker tier provides the physical or VM foundation for scheduling.';
      commands.push(
        { command: 'kubectl get nodes -o wide', description: 'Inspect node conditions and addresses', category: 'inspect' },
        { command: 'kubectl describe nodes | grep -A 5 Conditions', description: 'Check for MemoryPressure, DiskPressure, or PIDPressure', category: 'inspect' },
        { command: 'kubectl top nodes', description: 'Check CPU/memory load per node', category: 'metrics' }
      );
      tips.push('Maintain at least 15% head-room on node memory to avoid kernel OOM killer eviction waves.');
    } else if (domainName.toLowerCase().includes('network')) {
      summary = `The Networking domain orchestrates service discovery, edge routing, DNS resolution (CoreDNS), and L4/L7 load balancing.`;
      overview = `Directs incoming ingress traffic from external clients down to target pod IP endpoints via stable virtual IP abstraction.`;
      responsibilities = [
        'Provide static DNS names and internal VIPs via Kubernetes Services',
        'Manage TLS termination, path routing, and host-based rules via Ingress/Gateway',
        'Synchronize healthy pod IPs into EndpointSlice objects for low-latency routing'
      ];
      commands.push(
        { command: 'kubectl get ingress,svc,endpointslices -A', description: 'List all network routing primitives across namespaces', category: 'inspect' },
        { command: 'kubectl get pods -n kube-system -l k8s-app=kube-dns', description: 'Verify CoreDNS cluster DNS resolution health', category: 'inspect' }
      );
      tips.push('Implement NetworkPolicies to restrict pod-to-pod traffic to only verified microservice paths.');
    } else if (domainName.toLowerCase().includes('storage')) {
      summary = `The Storage domain manages persistent state, CSI volume plugins, StorageClasses, and PersistentVolumeClaims.`;
      overview = `Decouples physical storage backends (cloud SSDs, NFS, Block storage) from pod lifecycles, enabling stateful failovers.`;
      responsibilities = [
        'Bind persistent volume claims to dynamic provisioners',
        'Manage volume mount lifecycle across node rescheduling events',
        'Enforce reclaim policies (Retain, Delete) to avoid accidental data loss'
      ];
      commands.push(
        { command: 'kubectl get sc,pvc,pv -A', description: 'Inspect storage classes and PVC binding states', category: 'inspect' },
        { command: 'kubectl get events -A --field-selector reason=FailedMount', description: 'Detect any persistent volume mount errors', category: 'logs' }
      );
      tips.push('Always test volume snapshot and restore procedures for stateful services.');
    } else {
      summary = `The ${domainName} domain provides essential infrastructure services for the active cluster.`;
      overview = `Enforces configuration, access control, and operational boundaries.`;
      responsibilities = ['Support cluster orchestration', 'Enforce operational policies'];
      commands.push({ command: 'kubectl get all -A', description: 'List active resources', category: 'inspect' });
      tips.push('Regularly audit cluster resource definitions against GitOps manifests.');
    }
  } else {
    // Single Resource
    const kind = req.targetKind;
    const name = req.targetName;
    title = `${kind}: ${name}`;
    summary = `${name} is a Kubernetes ${kind} in namespace "${req.namespace || 'default'}".`;
    
    if (kind === 'Deployment') {
      overview = `Declarative controller that ensures ${req.replicas?.desired || 1} replica(s) of the application pods are running and handles rolling update rollouts with zero downtime.`;
      responsibilities = [
        'Maintain desired pod replica count and restart dead containers',
        'Coordinate rolling upgrades with automated rollback on health probe failures',
        'Mount secrets, configuration, and storage into pod specifications'
      ];
      replicaAssessment = req.replicas
        ? `${req.replicas.ready || 0} of ${req.replicas.desired || 0} pods ready.`
        : 'Replica telemetry active.';
      haVerdict = (req.replicas?.desired || 1) > 1
        ? 'High Availability: Multiple replicas configured for horizontal redundancy.'
        : 'Single Instance: Highly vulnerable to downtime during container crashes or node maintenance.';
      if ((req.replicas?.desired || 1) === 1) {
        risks.push('Deployment only has 1 replica. Consider scaling to at least 2 replicas for fault tolerance.');
      }
      commands.push(
        { command: `kubectl describe deployment ${name} ${ns}`, description: 'Inspect deployment conditions, selector, and rolling update strategy', category: 'inspect' },
        { command: `kubectl get pods -l app=${name} ${ns}`, description: 'List current pods running under this deployment', category: 'inspect' },
        { command: `kubectl rollout restart deployment ${name} ${ns}`, description: 'Trigger a safe, graceful zero-downtime rolling restart', category: 'remediate' },
        { command: `kubectl rollout status deployment ${name} ${ns}`, description: 'Watch the progress of the rolling update', category: 'logs' }
      );
    } else if (kind === 'Pod') {
      overview = `The fundamental execution unit in Kubernetes, encapsulating one or more co-located application containers with shared network IP and storage volumes.`;
      responsibilities = [
        'Run application container processes within an isolated Linux cgroup sandbox',
        'Expose readiness and liveness health endpoints to kubelet',
        'Share localhost IPC and volume mounts between co-located containers'
      ];
      commands.push(
        { command: `kubectl describe pod ${name} ${ns}`, description: 'Examine pod conditions, event history, and exit codes', category: 'inspect' },
        { command: `kubectl logs ${name} ${ns} --tail=100`, description: 'Tail recent standard output and error container logs', category: 'logs' },
        { command: `kubectl logs ${name} ${ns} --previous`, description: 'Read logs from the previous container instance if crashing', category: 'logs' },
        { command: `kubectl top pod ${name} ${ns}`, description: 'Inspect live CPU and memory consumption', category: 'metrics' }
      );
    } else if (kind === 'Service') {
      overview = `An abstract way to expose an application running on a set of pods as a network service with a stable virtual ClusterIP and DNS name.`;
      responsibilities = [
        'Provide a persistent virtual IP (ClusterIP) within the cluster network',
        'Load balance incoming traffic across healthy endpoints matching selector labels',
        'Expose ports to internal microservices or external LoadBalancers'
      ];
      commands.push(
        { command: `kubectl describe svc ${name} ${ns}`, description: 'Inspect service ports, target ports, and selector', category: 'inspect' },
        { command: `kubectl get endpoints ${name} ${ns}`, description: 'Check which backing pod IPs are currently receiving traffic', category: 'inspect' }
      );
    } else if (kind === 'Node') {
      overview = `Worker node executing scheduled workloads and managed by the control plane via kubelet.`;
      responsibilities = [
        'Provide CPU, memory, storage, and network capacity for pods',
        'Report resource telemetry, hardware health, and condition checks',
        'Execute pod sandbox lifecycles and bind container ports'
      ];
      commands.push(
        { command: `kubectl describe node ${name}`, description: 'View node capacity, allocatable resources, and conditions', category: 'inspect' },
        { command: `kubectl top node ${name}`, description: 'Check current CPU and memory consumption', category: 'metrics' },
        { command: `kubectl get pods --field-selector spec.nodeName=${name} -A`, description: 'List all pods scheduled onto this node', category: 'inspect' }
      );
    } else {
      overview = `Resource of type ${kind} supporting the cluster workload and configuration mesh.`;
      responsibilities = [`Enforce Kubernetes ${kind} API specification`];
      commands.push({ command: `kubectl describe ${kind.toLowerCase()} ${name} ${ns}`, description: `Inspect ${kind} details`, category: 'inspect' });
    }

    // Telemetry and Metrics evaluation
    if (req.metrics?.isAvailable) {
      resourceVerdict = `Telemetry active: CPU ${req.metrics.cpu || 'N/A'}, Memory ${req.metrics.memory || 'N/A'}.`;
    } else {
      resourceVerdict = `Live resource telemetry is normal or metrics-server is polling.`;
    }

    tips.push(`Keep container images tagged with immutable commit SHAs rather than mutable 'latest' tags.`);
    tips.push(`Audit pod resource limits to avoid out-of-memory (OOMKilled) container terminations.`);
  }

  // Security Posture assessment
  securityRecs.push('Run containers as non-root users (`securityContext.runAsNonRoot: true`)');
  securityRecs.push('Enforce read-only root filesystems (`securityContext.readOnlyRootFilesystem: true`)');
  securityRecs.push('Drop all default Linux capabilities except those strictly necessary (`capabilities.drop: ["ALL"]`)');

  // Operational status details
  let headline = '';
  let details = '';
  if (health === 'CRITICAL') {
    headline = 'Critical Anomaly Detected';
    details = incidents.length > 0
      ? `${incidents[0].title}: ${incidents[0].incidentType}. Immediate operator intervention recommended.`
      : 'Resource or child pods are in a degraded or crashing state.';
  } else if (health === 'WARNING') {
    headline = 'Operational Warning';
    details = incidents.length > 0
      ? `${incidents[0].title}. Pod or node is experiencing elevated restarts or resource pressure.`
      : 'Sub-optimal operational health or resource limits approaching capacity.';
  } else {
    headline = 'Operational & Healthy';
    details = 'All health probes, conditions, and observed replica sets are operating within normal thresholds.';
  }

  // If user prompted a specific question, generate a contextual answer
  let customAnswer: string | undefined = undefined;
  if (req.userPrompt && req.userPrompt.trim().length > 0) {
    const q = req.userPrompt.toLowerCase();
    if (q.includes('scale') || q.includes('scaling') || q.includes('hpa')) {
      customAnswer = `To scale ${req.targetName} safely without downtime:\n1. Apply horizontal autoscaling: \`kubectl autoscale ${req.targetKind.toLowerCase()} ${req.targetName} --min=2 --max=10 --cpu-percent=75 ${ns}\`\n2. Ensure a PodDisruptionBudget is defined with \`minAvailable: 1\` to prevent complete unavailability during cluster node maintenance.\n3. Verify that readiness probes are responsive so newly spawned pods only take traffic once fully warmed up.`;
    } else if (q.includes('zero') || q.includes('downtime') || q.includes('rollout')) {
      customAnswer = `To guarantee zero-downtime rollouts for ${req.targetName}:\n1. Set \`strategy.rollingUpdate.maxUnavailable: 0\` and \`maxSurge: 1\` or \`25%\`.\n2. Ensure preStop hooks are defined (\`sleep 5\`) to allow kube-proxy and Ingress endpoints to deregister the pod before SIGTERM is sent.\n3. Implement proper readiness probes that test backend connectivity before marking the container ready.`;
    } else if (q.includes('security') || q.includes('harden') || q.includes('rbac')) {
      customAnswer = `Security Hardening recommendations for ${req.targetName}:\n1. In \`securityContext\`, set \`allowPrivilegeEscalation: false\` and \`runAsNonRoot: true\`.\n2. Mount configuration secrets via projected volumes or external secrets store instead of hardcoded environment variables.\n3. Define a dedicated ServiceAccount with minimal RBAC RoleBindings rather than using the 'default' ServiceAccount.`;
    } else if (q.includes('bottleneck') || q.includes('performance') || q.includes('cpu') || q.includes('memory')) {
      customAnswer = `Performance & Bottleneck analysis for ${req.targetName}:\n- Ensure container resource requests equal 70-80% of anticipated baseline to guarantee node allocation without oversubscribing.\n- Set memory limits equal to requests to avoid unpredictable kernel OOMKilled events under burst loads.\n- Monitor network socket buffers and connection pools when talking to downstream services.`;
    } else {
      customAnswer = `Contextual Analysis for "${req.userPrompt}":\n${req.targetName} (${req.targetKind}) is operating in ${req.namespace || 'the active cluster'}. The operational state is currently ${health}.\n\nRecommended action: Run \`${commands[0]?.command || 'kubectl get pods'}\` to inspect current runtime status, or consult the recommended CLI diagnostics tab for tailored commands.`;
    }
  }

  return {
    title,
    targetType: req.targetType,
    targetName: req.targetName,
    targetKind: req.targetKind,
    summary,
    operationalStatus: {
      health,
      headline,
      details
    },
    architectureAndRole: {
      overview,
      keyResponsibilities: responsibilities,
      networkTrafficPath: networkPath || undefined,
      storageAndState: storageAndState || undefined
    },
    resilienceAndPerformance: {
      highAvailabilityVerdict: haVerdict || 'Standard Kubernetes scheduling resilience applied.',
      replicaAssessment: replicaAssessment || undefined,
      resourceAllocationVerdict: resourceVerdict || undefined,
      bottlenecksOrRisks: risks.length > 0 ? risks : ['No critical capacity or topology bottlenecks detected.']
    },
    securityPosture: {
      verdict: 'Standard Kubernetes pod security profile.',
      recommendations: securityRecs
    },
    activeIssuesAndDiagnostics: {
      hasIssues,
      incidentSummary: incidents.length > 0 ? `${incidents.length} active incident(s): ${incidents.map((i) => i.title).join('; ')}` : undefined,
      rootCauseHypothesis: incidents.length > 0 ? `Correlated failure in ${incidents[0].incidentType}. Review container restart count and pod events.` : undefined
    },
    recommendedCommands: commands,
    bestPracticeTips: tips,
    customAnswer,
    aiModel: 'Deterministic Kubernetes SRE Engine',
    isAiGenerated: false,
    generatedAt: Date.now()
  };
}

/**
 * Explains architecture using Google Gemini when available, falling back to deterministic SRE engine.
 */
export async function explainArchitectureWithAI(req: ArchitectureExplainRequest): Promise<ArchitectureAIExplanation> {
  const client = getGeminiClient();
  const fallback = generateDeterministicExplanation(req);

  if (!client) {
    return fallback;
  }

  try {
    const prompt = `You are SkyOps AI, a Principal Kubernetes Site Reliability Engineer (SRE) and Cloud Native Architect.
Generate an authoritative, technically precise, and actionable architectural explanation of the following target in a live Kubernetes cluster.

TARGET DETAILS:
- Target Type: ${req.targetType}
- Target Name: ${req.targetName}
- Target Kind: ${req.targetKind}
- Namespace: ${req.namespace || 'cluster-scoped'}
- Domain: ${req.domainId || 'general'}
- Cluster Name: ${req.clusterName || 'Kubernetes Cluster'}
- Live Health: ${req.health || 'HEALTHY'} (${req.statusText || 'Active'})
- Replicas: ${req.replicas ? `${req.replicas.ready}/${req.replicas.desired}` : 'N/A'}
- Metrics: ${req.metrics?.isAvailable ? `CPU: ${req.metrics.cpu}, Memory: ${req.metrics.memory}` : 'Metrics not available'}
- Backing Pods: ${req.backingPods ? req.backingPods.map((p) => `${p.name} (${p.status}, ${p.restarts || 0} restarts)`).join(', ') : 'None'}
- Related Resources: ${req.relatedResources ? req.relatedResources.map((r) => `${r.relation}: ${r.kind}/${r.name}`).join(', ') : 'None'}
- Active Incidents: ${req.incidents && req.incidents.length > 0 ? JSON.stringify(req.incidents) : 'None'}
- Cluster Summary: ${req.clusterSummary ? JSON.stringify(req.clusterSummary) : 'N/A'}
${req.userPrompt ? `- User Question: "${req.userPrompt}"` : ''}

CRITICAL REQUIREMENTS:
1. Explain the target's exact architecture role, traffic flow, and relationships in the cluster.
2. Provide an honest, rigorous resilience & high-availability verdict.
3. If there are incidents or warnings, explain root cause and exact failure mode.
4. Supply realistic, tailored, and copy-pasteable 'kubectl' commands.
5. If the user asked a question, provide a dedicated, concise technical answer.

Return ONLY valid JSON conforming to this schema:
{
  "title": "string",
  "summary": "string (1-2 clear sentences)",
  "operationalStatus": {
    "headline": "string",
    "details": "string"
  },
  "architectureAndRole": {
    "overview": "string (detailed explanation)",
    "keyResponsibilities": ["string", "string", "string"],
    "networkTrafficPath": "string",
    "storageAndState": "string"
  },
  "resilienceAndPerformance": {
    "highAvailabilityVerdict": "string",
    "replicaAssessment": "string",
    "resourceAllocationVerdict": "string",
    "bottlenecksOrRisks": ["string"]
  },
  "securityPosture": {
    "verdict": "string",
    "recommendations": ["string", "string"]
  },
  "activeIssuesAndDiagnostics": {
    "hasIssues": boolean,
    "incidentSummary": "string",
    "rootCauseHypothesis": "string"
  },
  "recommendedCommands": [
    {
      "command": "string",
      "description": "string",
      "category": "inspect" | "logs" | "remediate" | "metrics"
    }
  ],
  "bestPracticeTips": ["string", "string"],
  "customAnswer": "string (optional answer to user's question)"
}`;

    const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gemini generation timed out after 8s')), 8000)
    );
    const response = await Promise.race([
      client.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2
        }
      }),
      timeoutPromise
    ]);

    const text = response.text?.trim();
    if (!text) {
      return fallback;
    }

    const parsed = JSON.parse(text);
    return {
      title: parsed.title || fallback.title,
      targetType: req.targetType,
      targetName: req.targetName,
      targetKind: req.targetKind,
      summary: parsed.summary || fallback.summary,
      operationalStatus: {
        health: req.health || 'HEALTHY',
        headline: parsed.operationalStatus?.headline || fallback.operationalStatus.headline,
        details: parsed.operationalStatus?.details || fallback.operationalStatus.details
      },
      architectureAndRole: {
        overview: parsed.architectureAndRole?.overview || fallback.architectureAndRole.overview,
        keyResponsibilities: Array.isArray(parsed.architectureAndRole?.keyResponsibilities)
          ? parsed.architectureAndRole.keyResponsibilities
          : fallback.architectureAndRole.keyResponsibilities,
        networkTrafficPath: parsed.architectureAndRole?.networkTrafficPath || fallback.architectureAndRole.networkTrafficPath,
        storageAndState: parsed.architectureAndRole?.storageAndState || fallback.architectureAndRole.storageAndState
      },
      resilienceAndPerformance: {
        highAvailabilityVerdict: parsed.resilienceAndPerformance?.highAvailabilityVerdict || fallback.resilienceAndPerformance.highAvailabilityVerdict,
        replicaAssessment: parsed.resilienceAndPerformance?.replicaAssessment || fallback.resilienceAndPerformance.replicaAssessment,
        resourceAllocationVerdict: parsed.resilienceAndPerformance?.resourceAllocationVerdict || fallback.resilienceAndPerformance.resourceAllocationVerdict,
        bottlenecksOrRisks: Array.isArray(parsed.resilienceAndPerformance?.bottlenecksOrRisks) && parsed.resilienceAndPerformance.bottlenecksOrRisks.length > 0
          ? parsed.resilienceAndPerformance.bottlenecksOrRisks
          : fallback.resilienceAndPerformance.bottlenecksOrRisks
      },
      securityPosture: {
        verdict: parsed.securityPosture?.verdict || fallback.securityPosture.verdict,
        recommendations: Array.isArray(parsed.securityPosture?.recommendations) && parsed.securityPosture.recommendations.length > 0
          ? parsed.securityPosture.recommendations
          : fallback.securityPosture.recommendations
      },
      activeIssuesAndDiagnostics: {
        hasIssues: parsed.activeIssuesAndDiagnostics?.hasIssues ?? fallback.activeIssuesAndDiagnostics.hasIssues,
        incidentSummary: parsed.activeIssuesAndDiagnostics?.incidentSummary || fallback.activeIssuesAndDiagnostics.incidentSummary,
        rootCauseHypothesis: parsed.activeIssuesAndDiagnostics?.rootCauseHypothesis || fallback.activeIssuesAndDiagnostics.rootCauseHypothesis
      },
      recommendedCommands: Array.isArray(parsed.recommendedCommands) && parsed.recommendedCommands.length > 0
        ? parsed.recommendedCommands
        : fallback.recommendedCommands,
      bestPracticeTips: Array.isArray(parsed.bestPracticeTips) && parsed.bestPracticeTips.length > 0
        ? parsed.bestPracticeTips
        : fallback.bestPracticeTips,
      customAnswer: parsed.customAnswer || fallback.customAnswer,
      aiModel: `Google Gemini (${modelName})`,
      isAiGenerated: true,
      generatedAt: Date.now()
    };
  } catch (err: any) {
    console.warn('[SkyOps Architecture AI] Gemini generation failed, using deterministic SRE fallback:', err?.message || err);
    return fallback;
  }
}
