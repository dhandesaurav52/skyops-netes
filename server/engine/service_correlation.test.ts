import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { KubernetesResource } from '../../src/types/index';
import { buildRelationshipGraph } from './correlator';
import { normalizeResource } from '../normalization';

describe('Service & Workload Correlation - techgenx vs techgenx1 Regression Test Suite', () => {
  // Setup isolated techgenx and techgenx1 cluster resources
  const clusterId = 'cluster-killer-coda';
  const namespace = 'production';

  // techgenx Deployment & ReplicaSet
  const deployTechgenx: KubernetesResource = {
    id: 'deploy-techgenx',
    uid: 'uid-deploy-techgenx-001',
    name: 'techgenx',
    namespace,
    kind: 'Deployment',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    specSummary: {
      replicas: 1,
      selector: { matchLabels: { app: 'techgenx' } }
    },
    statusSummary: { readyReplicas: 1, replicas: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const rsTechgenx: KubernetesResource = {
    id: 'rs-techgenx-89ab',
    uid: 'uid-rs-techgenx-001',
    name: 'techgenx-89ab',
    namespace,
    kind: 'ReplicaSet',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    ownerReferences: [
      {
        uid: 'uid-deploy-techgenx-001',
        kind: 'Deployment',
        name: 'techgenx',
        controller: true
      }
    ],
    specSummary: {
      selector: { matchLabels: { app: 'techgenx' } }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // techgenx1 Deployment & ReplicaSet (the prefix trap)
  const deployTechgenx1: KubernetesResource = {
    id: 'deploy-techgenx1',
    uid: 'uid-deploy-techgenx1-002',
    name: 'techgenx1',
    namespace,
    kind: 'Deployment',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    specSummary: {
      replicas: 1,
      selector: { matchLabels: { app: 'techgenx1' } }
    },
    statusSummary: { readyReplicas: 1, replicas: 1 },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const rsTechgenx1: KubernetesResource = {
    id: 'rs-techgenx1-34cd',
    uid: 'uid-rs-techgenx1-002',
    name: 'techgenx1-34cd',
    namespace,
    kind: 'ReplicaSet',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    ownerReferences: [
      {
        uid: 'uid-deploy-techgenx1-002',
        kind: 'Deployment',
        name: 'techgenx1',
        controller: true
      }
    ],
    specSummary: {
      selector: { matchLabels: { app: 'techgenx1' } }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // techgenx Pod
  const podTechgenx: KubernetesResource = {
    id: 'pod-techgenx-89ab-xy12',
    uid: 'uid-pod-techgenx-001',
    name: 'techgenx-89ab-xy12',
    namespace,
    kind: 'Pod',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    labels: { app: 'techgenx', tier: 'backend' },
    ownerReferences: [
      {
        uid: 'uid-rs-techgenx-001',
        kind: 'ReplicaSet',
        name: 'techgenx-89ab',
        controller: true
      }
    ],
    specSummary: {
      nodeName: 'worker-node-1',
      labels: { app: 'techgenx', tier: 'backend' }
    },
    statusSummary: { phase: 'Running', podIP: '10.244.1.42' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // techgenx1 Pod
  const podTechgenx1: KubernetesResource = {
    id: 'pod-techgenx1-34cd-wz89',
    uid: 'uid-pod-techgenx1-002',
    name: 'techgenx1-34cd-wz89',
    namespace,
    kind: 'Pod',
    clusterId,
    status: 'Running',
    health: 'HEALTHY',
    labels: { app: 'techgenx1', tier: 'backend' },
    ownerReferences: [
      {
        uid: 'uid-rs-techgenx1-002',
        kind: 'ReplicaSet',
        name: 'techgenx1-34cd',
        controller: true
      }
    ],
    specSummary: {
      nodeName: 'worker-node-2',
      labels: { app: 'techgenx1', tier: 'backend' }
    },
    statusSummary: { phase: 'Running', podIP: '10.244.2.88' },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Services
  const svcTechgenx: KubernetesResource = {
    id: 'svc-techgenx-service',
    uid: 'uid-svc-techgenx-001',
    name: 'techgenx-service',
    namespace,
    kind: 'Service',
    clusterId,
    status: 'ClusterIP',
    health: 'HEALTHY',
    specSummary: {
      type: 'ClusterIP',
      clusterIP: '10.96.100.20',
      ports: [{ port: 80, targetPort: 8080, protocol: 'TCP' }],
      selector: { app: 'techgenx' }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const svcTechgenx1: KubernetesResource = {
    id: 'svc-techgenx1-service',
    uid: 'uid-svc-techgenx1-002',
    name: 'techgenx1-service',
    namespace,
    kind: 'Service',
    clusterId,
    status: 'ClusterIP',
    health: 'HEALTHY',
    specSummary: {
      type: 'ClusterIP',
      clusterIP: '10.96.100.21',
      ports: [{ port: 80, targetPort: 8081, protocol: 'TCP' }],
      selector: { app: 'techgenx1' }
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // EndpointSlices
  const epsTechgenx: KubernetesResource = {
    id: 'eps-techgenx-service-abc',
    uid: 'uid-eps-techgenx-001',
    name: 'techgenx-service-abc',
    namespace,
    kind: 'EndpointSlice',
    clusterId,
    status: 'Active',
    health: 'HEALTHY',
    labels: { 'kubernetes.io/service-name': 'techgenx-service' },
    specSummary: {
      endpoints: [{ addresses: ['10.244.1.42'], conditions: { ready: true } }],
      ports: [{ port: 8080, name: 'http' }]
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const epsTechgenx1: KubernetesResource = {
    id: 'eps-techgenx1-service-xyz',
    uid: 'uid-eps-techgenx1-002',
    name: 'techgenx1-service-xyz',
    namespace,
    kind: 'EndpointSlice',
    clusterId,
    status: 'Active',
    health: 'HEALTHY',
    labels: { 'kubernetes.io/service-name': 'techgenx1-service' },
    specSummary: {
      endpoints: [{ addresses: ['10.244.2.88'], conditions: { ready: true } }],
      ports: [{ port: 8081, name: 'http' }]
    },
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  const allResources: KubernetesResource[] = [
    deployTechgenx,
    deployTechgenx1,
    rsTechgenx,
    rsTechgenx1,
    podTechgenx,
    podTechgenx1,
    svcTechgenx,
    svcTechgenx1,
    epsTechgenx,
    epsTechgenx1
  ];

  test('MANDATORY: techgenx-service NEVER routes to techgenx1 pods', () => {
    const graph = buildRelationshipGraph(svcTechgenx, allResources);

    // Look for routes to pods
    const podRelations = graph.filter((r) => r.relation === 'ROUTES_TO_POD');
    assert.equal(podRelations.length, 1, 'techgenx-service must route to exactly one pod');
    assert.equal(
      podRelations[0].target.name,
      'techgenx-89ab-xy12',
      'techgenx-service must only route to techgenx pod'
    );

    // Ensure NO relationship touches techgenx1 in any way
    const accidentalTechgenx1Relations = graph.filter(
      (r) => r.target.name.includes('techgenx1') || r.source.name.includes('techgenx1')
    );
    assert.equal(
      accidentalTechgenx1Relations.length,
      0,
      'NEVER associate techgenx-service with techgenx1 pods or endpoint slices'
    );
  });

  test('MANDATORY: techgenx1-service NEVER routes to techgenx pods', () => {
    const graph = buildRelationshipGraph(svcTechgenx1, allResources);

    const podRelations = graph.filter((r) => r.relation === 'ROUTES_TO_POD');
    assert.equal(podRelations.length, 1, 'techgenx1-service must route to exactly one pod');
    assert.equal(
      podRelations[0].target.name,
      'techgenx1-34cd-wz89',
      'techgenx1-service must only route to techgenx1 pod'
    );

    // Ensure NO relationship touches techgenx
    const accidentalTechgenxRelations = graph.filter(
      (r) =>
        (r.target.name === 'techgenx' ||
          r.target.name === 'techgenx-89ab-xy12' ||
          r.target.name === 'techgenx-service-abc') &&
        !r.target.name.includes('techgenx1')
    );
    assert.equal(
      accidentalTechgenxRelations.length,
      0,
      'NEVER associate techgenx1-service with techgenx pods or endpoint slices'
    );
  });

  test('MANDATORY: Pod -> Controller relationship uses UID and ownerReferences, not startsWith', () => {
    const graphTechgenxPod = buildRelationshipGraph(podTechgenx, allResources);

    const ownedBy = graphTechgenxPod.filter((r) => r.relation === 'OWNED_BY');
    assert.ok(ownedBy.length >= 1, 'Pod must have OWNED_BY relation to ReplicaSet and/or Deployment');

    const targetNames = ownedBy.map((r) => r.target.name);
    assert.ok(targetNames.includes('techgenx-89ab'), 'Pod must be owned by techgenx-89ab ReplicaSet');
    assert.ok(
      !targetNames.includes('techgenx1') && !targetNames.includes('techgenx1-34cd'),
      'techgenx pod must NEVER be owned by techgenx1 controllers'
    );

    // Verify service exposure
    const exposedBy = graphTechgenxPod.filter((r) => r.relation === 'EXPOSED_BY_SERVICE');
    assert.equal(exposedBy.length, 1, 'techgenx pod must be exposed by techgenx-service only');
    assert.equal(exposedBy[0].source.name, 'techgenx-service');
  });

  test('EndpointSlice is accurately associated to Service via kubernetes.io/service-name', () => {
    const graphSvc = buildRelationshipGraph(svcTechgenx, allResources);
    const epsRelations = graphSvc.filter((r) => r.relation === 'BACKED_BY_ENDPOINTS');

    assert.equal(epsRelations.length, 1, 'Must link to backing EndpointSlice');
    assert.equal(epsRelations[0].target.name, 'techgenx-service-abc');
  });

  test('Service normalization correctly computes health based on ready endpoints', () => {
    // 1. Healthy service with ready endpoints
    const healthySvc = normalizeResource({
      kind: 'Service',
      name: 'healthy-api',
      namespace: 'default',
      spec: { type: 'ClusterIP', ports: [{ port: 80 }] },
      status: { totalEndpoints: 3, readyEndpoints: 3 }
    }, clusterId);
    assert.ok(healthySvc);
    assert.equal(healthySvc.health, 'HEALTHY');

    // 2. Degraded service with some unready endpoints
    const degradedSvc = normalizeResource({
      kind: 'Service',
      name: 'degraded-api',
      namespace: 'default',
      spec: { type: 'ClusterIP', ports: [{ port: 80 }] },
      status: { totalEndpoints: 3, readyEndpoints: 1 }
    }, clusterId);
    assert.ok(degradedSvc);
    assert.equal(degradedSvc.health, 'WARNING');

    // 3. Critical service with zero ready endpoints
    const criticalSvc = normalizeResource({
      kind: 'Service',
      name: 'critical-api',
      namespace: 'default',
      spec: { type: 'ClusterIP', ports: [{ port: 80 }] },
      status: { totalEndpoints: 3, readyEndpoints: 0 }
    }, clusterId);
    assert.ok(criticalSvc);
    assert.equal(criticalSvc.health, 'CRITICAL');

    // 4. ExternalName service always healthy
    const externalSvc = normalizeResource({
      kind: 'Service',
      name: 'external-api',
      namespace: 'default',
      spec: { type: 'ExternalName', externalName: 'api.example.com' },
      status: {}
    }, clusterId);
    assert.ok(externalSvc);
    assert.equal(externalSvc.health, 'HEALTHY');
  });
});
