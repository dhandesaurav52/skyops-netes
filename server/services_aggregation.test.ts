import assert from 'node:assert/strict';
import test, { describe, beforeEach } from 'node:test';
import { DataStore } from './store.js';
import { KubernetesResource } from '../src/types/index.js';
import { normalizeClusterResourcesResponse } from '../src/api/client.js';

describe('Global Services Aggregation & Tenant Isolation Suite', () => {
  let store: DataStore;
  const orgDev = 'org-dev-sandbox';
  const orgProd = 'org-production-isolated';

  beforeEach(() => {
    store = new DataStore();
  });

  test('Aggregates real services from connected cluster "killer-coda" across org resources', () => {
    // 1. Setup cluster killer-coda under orgDev
    const { cluster } = store.createCluster(orgDev, 'killer-coda');

    assert.equal(cluster.name, 'killer-coda');

    // 2. Real connected cluster killer-coda services
    const realServices: KubernetesResource[] = [
      {
        id: 'svc-kubernetes',
        uid: 'uid-svc-k8s-001',
        name: 'kubernetes',
        namespace: 'default',
        kind: 'Service',
        clusterId: cluster.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        specSummary: {
          type: 'ClusterIP',
          clusterIP: '10.96.0.1',
          ports: [{ name: 'https', port: 443, targetPort: 6443, protocol: 'TCP' }]
        },
        createdAt: Date.now() - 3600000,
        updatedAt: Date.now()
      },
      {
        id: 'svc-skyops-test-service',
        uid: 'uid-svc-skyops-002',
        name: 'skyops-test-service',
        namespace: 'default',
        kind: 'Service',
        clusterId: cluster.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        specSummary: {
          type: 'ClusterIP',
          clusterIP: '10.96.142.50',
          ports: [{ name: 'http', port: 80, targetPort: 8080, protocol: 'TCP' }],
          selector: { app: 'skyops-test' }
        },
        createdAt: Date.now() - 1800000,
        updatedAt: Date.now()
      },
      {
        id: 'svc-cilium-envoy',
        uid: 'uid-svc-cilium-003',
        name: 'cilium-envoy',
        namespace: 'kube-system',
        kind: 'Service',
        clusterId: cluster.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        specSummary: {
          type: 'ClusterIP',
          clusterIP: 'None',
          ports: [{ name: 'envoy-admin', port: 9901, targetPort: 9901, protocol: 'TCP' }],
          selector: { 'k8s-app': 'cilium-envoy' }
        },
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now()
      },
      {
        id: 'svc-kube-dns',
        uid: 'uid-svc-dns-004',
        name: 'kube-dns',
        namespace: 'kube-system',
        kind: 'Service',
        clusterId: cluster.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        specSummary: {
          type: 'ClusterIP',
          clusterIP: '10.96.0.10',
          ports: [
            { name: 'dns', port: 53, protocol: 'UDP' },
            { name: 'dns-tcp', port: 53, protocol: 'TCP' },
            { name: 'metrics', port: 9153, protocol: 'TCP' }
          ],
          selector: { 'k8s-app': 'kube-dns' }
        },
        createdAt: Date.now() - 7200000,
        updatedAt: Date.now()
      }
    ];

    // Store cluster resources using snapshotComplete = true
    store.syncClusterResources(cluster.id, realServices, true);

    // Verify cluster-specific retrieval matches exactly 4 services
    const clusterRes = store.getClusterResources(cluster.id);
    assert.equal(clusterRes.length, 4);

    // Verify global organization retrieval aggregates all resources with cluster details
    const allOrgResources = store.getAllResources(orgDev);
    assert.equal(allOrgResources.length, 4);

    // Verify each resource contains cluster identification
    for (const r of allOrgResources) {
      assert.equal(r.clusterId, cluster.id);
      assert.equal(r.clusterName, 'killer-coda');
      assert.equal(r.kind, 'Service');
    }

    // Verify querying by kind: 'Service' returns all 4 services
    const { resources: servicesOnly } = store.queryResources(orgDev, { kind: 'Service' });
    assert.equal(servicesOnly.length, 4);
    const serviceNames = servicesOnly.map((s) => s.name).sort();
    assert.deepEqual(serviceNames, ['cilium-envoy', 'kube-dns', 'kubernetes', 'skyops-test-service']);
  });

  test('Multi-cluster aggregation and tenant isolation: clusters in other orgs do not leak', () => {
    // Setup cluster in orgDev
    const { cluster: clusterDev } = store.createCluster(orgDev, 'killer-coda');

    // Setup cluster in orgProd
    const { cluster: clusterProd } = store.createCluster(orgProd, 'prod-europe-1');

    // Add service to dev
    store.syncClusterResources(clusterDev.id, [
      {
        id: 'svc-dev-1',
        name: 'dev-api',
        namespace: 'default',
        kind: 'Service',
        clusterId: clusterDev.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ], true);

    // Add service to prod
    store.syncClusterResources(clusterProd.id, [
      {
        id: 'svc-prod-1',
        name: 'payment-gateway',
        namespace: 'payments',
        kind: 'Service',
        clusterId: clusterProd.id,
        status: 'LoadBalancer',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        id: 'svc-prod-2',
        name: 'auth-service',
        namespace: 'identity',
        kind: 'Service',
        clusterId: clusterProd.id,
        status: 'ClusterIP',
        health: 'HEALTHY',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ], true);

    // Query dev org - must ONLY return dev service
    const devResources = store.getAllResources(orgDev);
    assert.equal(devResources.length, 1);
    assert.equal(devResources[0].name, 'dev-api');
    assert.equal(devResources[0].clusterName, 'killer-coda');

    // Query prod org - must ONLY return prod services
    const prodResources = store.getAllResources(orgProd);
    assert.equal(prodResources.length, 2);
    assert.ok(prodResources.every((r) => r.clusterName === 'prod-europe-1'));
  });

  test('Resource normalization safely handles API response formats', () => {
    // Normal array
    const normal = [{ id: '1', kind: 'Service', name: 'svc-1' }];
    assert.equal(normalizeClusterResourcesResponse(normal).length, 1);

    // Object wrapper { resources: [...] } as returned by /api/v1/resources
    const wrappedResources = { resources: [{ id: '2', kind: 'Service', name: 'svc-2' }] };
    assert.equal(normalizeClusterResourcesResponse(wrappedResources).length, 1);

    // Object wrapper { data: [...] }
    const wrappedData = { data: [{ id: '3', kind: 'Service', name: 'svc-3' }] };
    assert.equal(normalizeClusterResourcesResponse(wrappedData).length, 1);

    // Null or undefined
    assert.deepEqual(normalizeClusterResourcesResponse(null), []);
    assert.deepEqual(normalizeClusterResourcesResponse(undefined), []);
  });
});
