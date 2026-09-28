import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Cluster, Incident, KubernetesResource } from '../../../types/index';
import { buildTopologyGraph } from './topologyGraphBuilder';

describe('SkyOps Architecture Topology Graph Builder', () => {
  const mockCluster: Cluster = {
    id: 'cluster-prod',
    orgId: 'org-test',
    name: 'kkk',
    status: 'connected',
    agentStatus: 'CONNECTED',
    nodeCount: 2,
    podCount: 3,
    openIncidentCount: 1,
    createdAt: Date.now() - 100000
  };

  const mockResources: any[] = [
    // 1. Node
    {
      id: 'node-1',
      clusterId: 'cluster-prod',
      name: 'node-1',
      kind: 'Node',
      status: 'Ready',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      updatedAt: Date.now() - 1000,
      cpuUsage: 21,
      memoryUsage: 48
    },
    // 2. Deployment
    {
      id: 'deploy-api',
      clusterId: 'cluster-prod',
      name: 'api',
      namespace: 'production',
      kind: 'Deployment',
      status: 'Available',
      health: 'WARNING',
      createdAt: Date.now() - 40000,
      updatedAt: Date.now() - 1000,
      labels: { app: 'api', tier: 'backend' }
    },
    // 3. Pods
    {
      id: 'pod-api-1',
      clusterId: 'cluster-prod',
      name: 'api-7d8c9f6f-1',
      namespace: 'production',
      kind: 'Pod',
      status: 'Running',
      health: 'HEALTHY',
      nodeName: 'node-1',
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 1000,
      labels: { app: 'api', tier: 'backend' },
      ownerReferences: [{ kind: 'Deployment', name: 'api' }]
    },
    {
      id: 'pod-api-2',
      clusterId: 'cluster-prod',
      name: 'api-7d8c9f6f-2',
      namespace: 'production',
      kind: 'Pod',
      status: 'CrashLoopBackOff',
      health: 'CRITICAL',
      nodeName: 'node-1',
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 1000,
      labels: { app: 'api', tier: 'backend' },
      ownerReferences: [{ kind: 'Deployment', name: 'api' }]
    },
    // 4. Service
    {
      id: 'svc-api',
      clusterId: 'cluster-prod',
      name: 'api-service',
      namespace: 'production',
      kind: 'Service',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 35000,
      updatedAt: Date.now() - 1000,
      specSummary: {
        type: 'ClusterIP',
        selector: { app: 'api', tier: 'backend' }
      }
    },
    // 5. Ingress
    {
      id: 'ing-main',
      clusterId: 'cluster-prod',
      name: 'ingress-nginx',
      namespace: 'production',
      kind: 'Ingress',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 35000,
      updatedAt: Date.now() - 1000,
      specSummary: {
        rules: [
          {
            http: {
              paths: [{ backend: { service: { name: 'api-service' } } }]
            }
          }
        ]
      }
    },
    // 6. PVC
    {
      id: 'pvc-data',
      clusterId: 'cluster-prod',
      name: 'data-pvc',
      namespace: 'production',
      kind: 'PersistentVolumeClaim',
      status: 'Bound',
      health: 'HEALTHY',
      createdAt: Date.now() - 35000,
      updatedAt: Date.now() - 1000
    }
  ];

  const mockIncidents: Incident[] = [
    {
      id: 'INC-001',
      fingerprint: 'fp-1',
      orgId: 'org-test',
      clusterId: 'cluster-prod',
      clusterName: 'kkk',
      namespace: 'production',
      resourceKind: 'Pod',
      resourceName: 'api-7d8c9f6f-2',
      incidentType: 'CrashLoopBackOff',
      title: 'Pod restarting repeatedly',
      severity: 'HIGH',
      status: 'OPEN',
      occurrenceCount: 5,
      firstSeenAt: Date.now() - 300000,
      lastSeenAt: Date.now() - 60000,
      technicalDetails: {},
      updatedAt: Date.now() - 60000
    }
  ];

  it('builds topology graph with cluster root and core domains', () => {
    const graph = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'all', incidentsOnly: false },
      expandedNodeIds: new Set()
    });

    assert.ok(graph.nodes.length > 0, 'Graph should have nodes');
    assert.ok(graph.edges.length > 0, 'Graph should have edges');

    const root = graph.nodes.find((n) => n.type === 'cluster');
    assert.ok(root, 'Cluster root node must exist');
    assert.strictEqual(root.name, 'kkk');

    const computeGroup = graph.nodes.find((n) => n.id === 'domain-compute');
    assert.ok(computeGroup, 'Compute domain group must exist');

    const workloadsGroup = graph.nodes.find((n) => n.id === 'domain-workloads');
    assert.ok(workloadsGroup, 'Workloads domain group must exist');

    const networkingGroup = graph.nodes.find((n) => n.id === 'domain-networking');
    assert.ok(networkingGroup, 'Networking domain group must exist');
  });

  it('correctly builds authoritative traffic flow edges: Ingress -> Service -> Workload', () => {
    const graph = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'all', incidentsOnly: false },
      expandedNodeIds: new Set()
    });

    const trafficEdges = graph.edges.filter((e) => e.type === 'traffic');
    assert.ok(trafficEdges.length >= 2, 'Should have at least 2 traffic flow edges (Ingress->Service and Service->Workload)');

    // Ingress -> Service
    const ingToSvc = trafficEdges.find((e) => e.source === 'ingress-ing-main' && e.target === 'service-svc-api');
    assert.ok(ingToSvc, 'Must connect Ingress to Service via traffic flow');

    // Service -> Workload
    const svcToWorkload = trafficEdges.find((e) => e.source === 'service-svc-api' && e.target === 'workload-deploy-api');
    assert.ok(svcToWorkload, 'Must connect Service to matching Workload via label selector');
  });

  it('correlates incidents to affected resources and displays incident count', () => {
    const graph = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'all', incidentsOnly: false },
      expandedNodeIds: new Set(['workload-deploy-api']) // expand workload to see pod
    });

    const podNode = graph.nodes.find((n) => n.name === 'api-7d8c9f6f-2');
    assert.ok(podNode, 'Expanded pod node must be present');
    assert.strictEqual(podNode.incidents.length, 1, 'Pod node must be correlated to the incident');
    assert.strictEqual(podNode.incidents[0].title, 'Pod restarting repeatedly');
  });

  it('accurately parses CPU and Memory metrics when present', () => {
    const graph = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'all', incidentsOnly: false },
      expandedNodeIds: new Set()
    });

    const nodeNode = graph.nodes.find((n) => n.name === 'node-1');
    assert.ok(nodeNode, 'Node node must exist');
    assert.strictEqual(nodeNode.metrics?.cpu, '21%');
    assert.strictEqual(nodeNode.metrics?.memory, '48%');
    assert.strictEqual(nodeNode.metrics?.isAvailable, true);
  });

  it('filters resources by namespace and search query accurately', () => {
    const graphFiltered = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'non-existent', search: '', health: 'all', domain: 'all', incidentsOnly: false },
      expandedNodeIds: new Set()
    });

    // Deployments in 'production' should be filtered out
    const deploy = graphFiltered.nodes.find((n) => n.name === 'api');
    assert.strictEqual(deploy, undefined, 'Resources outside namespace must be filtered out');
  });

  it('filters by domain correctly and isolates selected domain', () => {
    const graphDomain = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'networking', incidentsOnly: false },
      expandedNodeIds: new Set()
    });

    const netDomain = graphDomain.nodes.find((n) => n.id === 'domain-networking');
    assert.ok(netDomain, 'Networking domain must be present');

    const storageDomain = graphDomain.nodes.find((n) => n.id === 'domain-storage');
    assert.strictEqual(storageDomain, undefined, 'Storage domain must be excluded when domain=networking');
  });

  it('filters by incidents-only correctly', () => {
    const graphIncidents = buildTopologyGraph({
      resources: mockResources,
      cluster: mockCluster,
      incidents: mockIncidents,
      filters: { namespace: 'all', search: '', health: 'all', domain: 'all', incidentsOnly: true },
      expandedNodeIds: new Set()
    });

    // api-7d8c9f6f-2 pod has incident, so parent deployment should be prioritized / pod visible when expanded
    const node1 = graphIncidents.nodes.find((n) => n.name === 'node-1');
    assert.strictEqual(node1, undefined, 'Healthy resources without incidents must be excluded when incidentsOnly=true');
  });
});
