import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchitectureTelemetry, getResourceKey } from './architectureTelemetry';
import { KubernetesResource, Cluster, Incident } from '../../types/index';

describe('SkyOps Architecture Telemetry Engine', () => {
  const mockCluster: Cluster = {
    id: 'cluster-prod-1',
    orgId: 'org-test',
    name: 'prod-primary-us-east',
    status: 'connected',
    agentStatus: 'CONNECTED',
    nodeCount: 2,
    podCount: 3,
    openIncidentCount: 1,
    k8sVersion: 'v1.29.2',
    createdAt: Date.now() - 100000,
    lastHeartbeatAt: Date.now() - 10000
  };

  const mockResources: any[] = [
    // 1. Compute
    {
      id: 'node-1',
      clusterId: 'cluster-prod-1',
      name: 'node-pool-1',
      kind: 'Node',
      apiVersion: 'v1',
      status: 'Ready',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: {
        taints: [{ key: 'dedicated', value: 'critical-workload', effect: 'NoSchedule' }]
      }
    },
    {
      id: 'pod-1',
      clusterId: 'cluster-prod-1',
      name: 'api-server-79d8-xyz',
      namespace: 'production',
      kind: 'Pod',
      apiVersion: 'v1',
      status: 'Running',
      health: 'HEALTHY',
      createdAt: Date.now() - 40000,
      observedAt: Date.now() - 10000,
      specSummary: {
        nodeSelector: { 'topology.kubernetes.io/zone': 'us-east-1a' },
        affinity: {
          nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: {} }
        },
        tolerations: [{ key: 'dedicated', effect: 'NoSchedule' }],
        containers: [
          {
            name: 'api',
            image: 'app/api:v2.1',
            securityContext: { runAsNonRoot: true, readOnlyRootFilesystem: true }
          }
        ]
      }
    },
    // 2. Application Management (Workloads)
    {
      id: 'deploy-1',
      clusterId: 'cluster-prod-1',
      name: 'api-server',
      namespace: 'production',
      kind: 'Deployment',
      apiVersion: 'apps/v1',
      status: 'Available',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: { replicas: 3 },
      statusSummary: { readyReplicas: 3, availableReplicas: 3 }
    },
    // 3. Networking
    {
      id: 'svc-1',
      clusterId: 'cluster-prod-1',
      name: 'api-service',
      namespace: 'production',
      kind: 'Service',
      apiVersion: 'v1',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: {
        type: 'ClusterIP',
        clusterIP: '10.96.0.42',
        ports: [{ name: 'http', port: 80, targetPort: 8080 }]
      }
    },
    {
      id: 'eps-1',
      clusterId: 'cluster-prod-1',
      name: 'api-service-slice-1',
      namespace: 'production',
      kind: 'EndpointSlice',
      apiVersion: 'discovery.k8s.io/v1',
      status: 'Synced',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    },
    {
      id: 'ing-1',
      clusterId: 'cluster-prod-1',
      name: 'api-ingress',
      namespace: 'production',
      kind: 'Ingress',
      apiVersion: 'networking.k8s.io/v1',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    },
    // 4. Storage
    {
      id: 'pvc-1',
      clusterId: 'cluster-prod-1',
      name: 'data-claim',
      namespace: 'production',
      kind: 'PersistentVolumeClaim',
      apiVersion: 'v1',
      status: 'Bound',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: { storageClassName: 'premium-rwo', volumeName: 'pv-volume-101' }
    },
    {
      id: 'pv-1',
      clusterId: 'cluster-prod-1',
      name: 'pv-volume-101',
      kind: 'PersistentVolume',
      apiVersion: 'v1',
      status: 'Bound',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: { storageClassName: 'premium-rwo' }
    },
    // 5. Configuration & Secrets
    {
      id: 'cm-1',
      clusterId: 'cluster-prod-1',
      name: 'app-config',
      namespace: 'production',
      kind: 'ConfigMap',
      apiVersion: 'v1',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    },
    {
      id: 'sec-1',
      clusterId: 'cluster-prod-1',
      name: 'db-credentials',
      namespace: 'production',
      kind: 'Secret',
      apiVersion: 'v1',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000,
      specSummary: {
        type: 'Opaque',
        data: { password: 'DO_NOT_EXPOSE_SECRET' }
      }
    },
    // 6. Scaling
    {
      id: 'hpa-1',
      clusterId: 'cluster-prod-1',
      name: 'api-server-hpa',
      namespace: 'production',
      kind: 'HorizontalPodAutoscaler',
      apiVersion: 'autoscaling/v2',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    },
    // 7. Security
    {
      id: 'netpol-1',
      clusterId: 'cluster-prod-1',
      name: 'default-deny-ingress',
      namespace: 'production',
      kind: 'NetworkPolicy',
      apiVersion: 'networking.k8s.io/v1',
      status: 'Enforced',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    },
    {
      id: 'sa-1',
      clusterId: 'cluster-prod-1',
      name: 'api-sa',
      namespace: 'production',
      kind: 'ServiceAccount',
      apiVersion: 'v1',
      status: 'Active',
      health: 'HEALTHY',
      createdAt: Date.now() - 50000,
      observedAt: Date.now() - 10000
    }
  ];

  const mockIncidents: any[] = [
    {
      id: 'inc-101',
      clusterId: 'cluster-prod-1',
      title: 'High CPU on api-server',
      summary: 'Pod CPU usage above threshold',
      status: 'OPEN',
      severity: 'HIGH',
      type: 'HighCpuUsage',
      resourceKind: 'Pod',
      resourceName: 'api-server-79d8-xyz',
      namespace: 'production',
      startedAt: Date.now() - 10000,
      updatedAt: Date.now() - 5000,
      orgId: 'org-test'
    }
  ];

  it('correctly categorizes all 8 architectural domains without omission', () => {
    const telemetry = buildArchitectureTelemetry(mockResources, [mockCluster], mockIncidents);

    assert.ok(telemetry.domains.compute, 'Compute domain exists');
    assert.ok(telemetry.domains.workloads, 'Workloads domain exists');
    assert.ok(telemetry.domains.networking, 'Networking domain exists');
    assert.ok(telemetry.domains.storage, 'Storage domain exists');
    assert.ok(telemetry.domains.configuration, 'Configuration domain exists');
    assert.ok(telemetry.domains.scheduling, 'Scheduling domain exists');
    assert.ok(telemetry.domains.scaling, 'Scaling domain exists');
    assert.ok(telemetry.domains.security, 'Security domain exists');

    assert.equal(telemetry.domains.compute.resourceCount, 2); // 1 node + 1 pod
    assert.equal(telemetry.domains.workloads.resourceCount, 1); // 1 deployment
    assert.equal(telemetry.domains.networking.resourceCount, 4); // svc, eps, ing, netpol
    assert.equal(telemetry.domains.storage.resourceCount, 2); // pvc, pv
    assert.equal(telemetry.domains.configuration.resourceCount, 3); // cm, secret, sa
    assert.equal(telemetry.domains.scaling.resourceCount, 1); // hpa
    assert.equal(telemetry.domains.security.resourceCount, 2); // netpol, sa
  });

  it('correctly tracks telemetry freshness as LIVE when data is within threshold', () => {
    const telemetry = buildArchitectureTelemetry(mockResources, [mockCluster], mockIncidents);
    assert.equal(telemetry.freshness, 'LIVE');
    assert.ok(telemetry.ageSeconds !== null && telemetry.ageSeconds < 90);
  });

  it('correctly marks freshness as UNAVAILABLE for empty telemetry', () => {
    const telemetry = buildArchitectureTelemetry([], [], []);
    assert.equal(telemetry.freshness, 'UNAVAILABLE');
    assert.equal(telemetry.totalResourceCount, 0);
  });

  it('accurately parses scheduling telemetry (taints, selectors, affinities)', () => {
    const telemetry = buildArchitectureTelemetry(mockResources, [mockCluster], mockIncidents);
    assert.equal(telemetry.schedulingSummary.nodesWithTaints, 1);
    assert.equal(telemetry.schedulingSummary.taints[0].key, 'dedicated');
    assert.equal(telemetry.schedulingSummary.podsWithNodeSelector, 1);
    assert.equal(telemetry.schedulingSummary.podsWithAffinity, 1);
    assert.equal(telemetry.schedulingSummary.podsWithTolerations, 1);
  });

  it('accurately calculates scaling metrics and workload replicas', () => {
    const telemetry = buildArchitectureTelemetry(mockResources, [mockCluster], mockIncidents);
    assert.equal(telemetry.scalingSummary.hpas.length, 1);
    assert.equal(telemetry.scalingSummary.totalDesiredReplicas, 3);
    assert.equal(telemetry.scalingSummary.totalReadyReplicas, 3);
  });

  it('correlates active incidents to resources via key mapping', () => {
    const telemetry = buildArchitectureTelemetry(mockResources, [mockCluster], mockIncidents);
    const podKey = 'cluster-prod-1/Pod/production/api-server-79d8-xyz';
    const correlated = telemetry.incidentsByResourceKey.get(podKey);
    assert.ok(correlated);
    assert.equal(correlated.length, 1);
    assert.equal(correlated[0].id, 'inc-101');
  });

  it('generates consistent resource keys with getResourceKey helper', () => {
    const key = getResourceKey({
      clusterId: 'c1',
      kind: 'Service',
      namespace: 'prod',
      name: 'web'
    });
    assert.equal(key, 'c1/Service/prod/web');
  });
});
