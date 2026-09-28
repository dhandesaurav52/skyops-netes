import { KubernetesResource, Incident, Cluster } from '../../types/index';

export type ArchitectureDomainId =
  | 'compute'
  | 'workloads'
  | 'networking'
  | 'storage'
  | 'configuration'
  | 'scheduling'
  | 'scaling'
  | 'security';

export interface DomainCategoryBreakdown {
  kind: string;
  count: number;
  resources: KubernetesResource[];
}

export interface ArchitectureDomainSummary {
  id: ArchitectureDomainId;
  title: string;
  shortTitle: string;
  description: string;
  resourceCount: number;
  healthCounts: {
    healthy: number;
    warning: number;
    critical: number;
    unknown: number;
  };
  detectedHighlights: string[];
  categories: DomainCategoryBreakdown[];
  activeFeatures: string[];
  undetectedFeatures: string[];
  allResources: KubernetesResource[];
}

export interface SchedulingTelemetrySummary {
  nodesWithTaints: number;
  podsWithNodeSelector: number;
  podsWithAffinity: number;
  podsWithTolerations: number;
  podsWithTopologySpread: number;
  taints: Array<{ nodeName: string; key: string; value?: string; effect: string }>;
  nodeSelectors: Array<{ podName: string; namespace: string; selectors: Record<string, string> }>;
  affinities: Array<{ podName: string; namespace: string; kind: 'nodeAffinity' | 'podAffinity' | 'podAntiAffinity' }>;
  tolerations: Array<{ podName: string; namespace: string; key?: string; effect?: string }>;
  topologySpreadConstraints: Array<{ podName: string; namespace: string; topologyKey: string; maxSkew?: number }>;
}

export interface ScalingTelemetrySummary {
  hpas: KubernetesResource[];
  vpas: KubernetesResource[];
  clusterAutoscalerDetected: boolean;
  clusterAutoscalerEvidence?: string;
  totalDesiredReplicas: number;
  totalReadyReplicas: number;
  totalAvailableReplicas: number;
  workloadReplicas: Array<{
    name: string;
    kind: string;
    namespace: string;
    desired: number;
    ready: number;
    available: number;
    status: string;
  }>;
}

export interface SecurityTelemetrySummary {
  roles: KubernetesResource[];
  roleBindings: KubernetesResource[];
  clusterRoles: KubernetesResource[];
  clusterRoleBindings: KubernetesResource[];
  serviceAccounts: KubernetesResource[];
  networkPolicies: KubernetesResource[];
  podSecurityHighlights: {
    runAsNonRootCount: number;
    privilegedCount: number;
    readOnlyRootFilesystemCount: number;
    allowPrivilegeEscalationFalseCount: number;
    totalInspected: number;
  };
}

export interface ArchitectureTelemetryState {
  domains: Record<ArchitectureDomainId, ArchitectureDomainSummary>;
  totalResourceCount: number;
  freshness: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  lastTelemetryTimestamp: number | null;
  ageSeconds: number | null;
  schedulingSummary: SchedulingTelemetrySummary;
  scalingSummary: ScalingTelemetrySummary;
  securitySummary: SecurityTelemetrySummary;
  activeIncidents: Incident[];
  incidentsByResourceKey: Map<string, Incident[]>;
}

export type ArchitectureViewMode = 'overview' | 'domain';

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
