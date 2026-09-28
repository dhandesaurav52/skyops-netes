import { Cluster, Incident, KubernetesResource } from '../../../types/index';
import { ArchitectureDomainId } from '../types';

export type TopologyNodeType =
  | 'cluster'
  | 'domain_group'
  | 'resource'
  | 'pod_leaf';

export type TopologyRelationshipType =
  | 'ownership'    // Solid line (Cluster -> Domain, Workload -> Pod, Node -> Pod)
  | 'traffic'      // Dashed blue/cyan with arrow (Ingress -> Service, Service -> Pod)
  | 'uses'         // Dashed green (Pod -> PVC, Pod -> ConfigMap / Secret)
  | 'depends_on';  // Dashed amber (PVC -> StorageClass, HPA -> Workload, RoleBinding -> Role)

export interface TopologyNode {
  id: string;
  type: TopologyNodeType;
  kind: string; // 'Cluster' | 'Compute' | 'Workloads' | 'Networking' | 'Storage' | 'Node' | 'Deployment' | etc.
  name: string;
  namespace?: string;
  clusterId?: string;
  resource?: KubernetesResource;
  cluster?: Cluster;
  health: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'UNKNOWN';
  statusText: string;
  badgeText?: string;
  metrics?: {
    cpu?: string;
    memory?: string;
    cpuPercent?: number;
    memoryPercent?: number;
    isAvailable?: boolean;
  };
  replicas?: {
    ready: number;
    desired: number;
  };
  incidents: Incident[];
  subResourcesCount?: number;
  isExpanded?: boolean;
  canExpand?: boolean;
  domainId: ArchitectureDomainId | 'cluster';
  groupId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  backingPods?: KubernetesResource[];
}

export interface TopologyEdge {
  id: string;
  source: string; // source node id
  target: string; // target node id
  type: TopologyRelationshipType;
  label?: string;
  animated?: boolean;
}

export interface TopologyGraphData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  nodeMap: Map<string, TopologyNode>;
  adjacency: Map<string, Set<string>>; // node id -> connected node ids
  outgoingEdges: Map<string, TopologyEdge[]>;
  incomingEdges: Map<string, TopologyEdge[]>;
}

export interface TopologyFilterState {
  namespace: string;
  search: string;
  health: 'all' | 'HEALTHY' | 'WARNING' | 'CRITICAL';
  domain: 'all' | ArchitectureDomainId;
  incidentsOnly: boolean;
}

export type TopologyViewMode = 'topology' | 'grouped_namespace' | 'grouped_domain';
