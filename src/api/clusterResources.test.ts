import assert from 'node:assert/strict';
import test from 'node:test';
import { KubernetesResource } from '../types/index.js';
import { normalizeClusterResourcesResponse } from './client.js';

test('Cluster Resources Normalization and Resilience Suite', async (t) => {
  const samplePod: KubernetesResource = {
    id: 'res-pod-1',
    clusterId: 'cluster-prod-01',
    name: 'payment-service-5b746c-abc',
    namespace: 'payment',
    kind: 'Pod',
    status: 'Running',
    health: 'HEALTHY',
    restartCount: 0,
    createdAt: Date.now() - 172800000,
    updatedAt: Date.now(),
    cpuUsage: 120,
    memoryUsage: 268435456,
    events: []
  };

  const sampleNode: KubernetesResource = {
    id: 'res-node-1',
    clusterId: 'cluster-prod-01',
    name: 'node-worker-01',
    namespace: 'kube-system',
    kind: 'Node',
    status: 'Ready',
    health: 'HEALTHY',
    restartCount: 0,
    createdAt: Date.now() - 864000000,
    updatedAt: Date.now(),
    events: []
  };

  await t.test('1. Normal resource array: preserves valid resource arrays unchanged', () => {
    // Canonical wrapped shape { resources: [...] }
    const wrappedResult = normalizeClusterResourcesResponse({
      resources: [samplePod, sampleNode]
    });
    assert.equal(wrappedResult.length, 2);
    assert.equal(wrappedResult[0].name, 'payment-service-5b746c-abc');
    assert.equal(wrappedResult[1].kind, 'Node');

    // Direct array shape [...]
    const directResult = normalizeClusterResourcesResponse([samplePod, sampleNode]);
    assert.equal(directResult.length, 2);
    assert.equal(directResult[0].id, 'res-pod-1');
  });

  await t.test('2. Empty array: returns empty array [] without throwing', () => {
    // Canonical wrapped empty array
    const wrappedEmpty = normalizeClusterResourcesResponse({ resources: [] });
    assert.ok(Array.isArray(wrappedEmpty));
    assert.equal(wrappedEmpty.length, 0);

    // Direct empty array
    const directEmpty = normalizeClusterResourcesResponse([]);
    assert.ok(Array.isArray(directEmpty));
    assert.equal(directEmpty.length, 0);
  });

  await t.test('3. Null/undefined/empty resource payload: normalizes to empty array []', () => {
    // null payload
    const fromNull = normalizeClusterResourcesResponse(null);
    assert.ok(Array.isArray(fromNull));
    assert.equal(fromNull.length, 0);

    // undefined payload
    const fromUndefined = normalizeClusterResourcesResponse(undefined);
    assert.ok(Array.isArray(fromUndefined));
    assert.equal(fromUndefined.length, 0);

    // { resources: null }
    const fromNullResources = normalizeClusterResourcesResponse({ resources: null });
    assert.ok(Array.isArray(fromNullResources));
    assert.equal(fromNullResources.length, 0);

    // { resources: undefined }
    const fromUndefinedResources = normalizeClusterResourcesResponse({ resources: undefined });
    assert.ok(Array.isArray(fromUndefinedResources));
    assert.equal(fromUndefinedResources.length, 0);

    // empty object {}
    const fromEmptyObj = normalizeClusterResourcesResponse({});
    assert.ok(Array.isArray(fromEmptyObj));
    assert.equal(fromEmptyObj.length, 0);
  });

  await t.test('4. Malformed response shape: throws explicit descriptive telemetry error', () => {
    // resources is a primitive string
    assert.throws(
      () => normalizeClusterResourcesResponse({ resources: 'not-an-array' }),
      /Malformed cluster resources response: "resources" field is not an array/
    );

    // resources is a number
    assert.throws(
      () => normalizeClusterResourcesResponse({ resources: 404 }),
      /Malformed cluster resources response: "resources" field is not an array/
    );

    // resources is an object
    assert.throws(
      () => normalizeClusterResourcesResponse({ resources: { invalid: true } }),
      /Malformed cluster resources response: "resources" field is not an array/
    );

    // top-level payload is a primitive string
    assert.throws(
      () => normalizeClusterResourcesResponse('unexpected html or text'),
      /Malformed cluster resources response: received unexpected string payload/
    );

    // top-level payload is a number
    assert.throws(
      () => normalizeClusterResourcesResponse(500),
      /Malformed cluster resources response: received unexpected number payload/
    );

    // unexpected object without resource collection
    assert.throws(
      () => normalizeClusterResourcesResponse({ randomField: 'value' }),
      /Malformed cluster resources response: expected a resource collection array/
    );
  });

  await t.test('5. Backend errors: surfaces actual backend errors without swallowing', () => {
    assert.throws(
      () => normalizeClusterResourcesResponse({ error: 'Cluster not found' }),
      /Cluster not found/
    );
    assert.throws(
      () => normalizeClusterResourcesResponse({ error: 'Unauthorized access to cluster resources' }),
      /Unauthorized access to cluster resources/
    );
  });

  await t.test('6. Alternative collection wrappers: supports { data: [...] } and { items: [...] }', () => {
    const fromData = normalizeClusterResourcesResponse({ data: [samplePod] });
    assert.equal(fromData.length, 1);
    assert.equal(fromData[0].name, 'payment-service-5b746c-abc');

    const fromItems = normalizeClusterResourcesResponse({ items: [sampleNode] });
    assert.equal(fromItems.length, 1);
    assert.equal(fromItems[0].name, 'node-worker-01');
  });

  await t.test('7. Filter resilience: guarantees .filter() can be safely called on all normalized outputs', () => {
    const testCases: unknown[] = [
      { resources: [samplePod, sampleNode] },
      [samplePod],
      { resources: [] },
      [],
      null,
      undefined,
      { resources: null },
      { resources: undefined },
      {}
    ];

    for (const testCase of testCases) {
      const normalized = normalizeClusterResourcesResponse(testCase);
      // Simulate ClusterDetailView filter calls:
      const pods = normalized.filter((r) => r && r.kind === 'Pod');
      const nodes = normalized.filter((r) => r && r.kind === 'Node');
      const workloads = normalized.filter((r) => r && ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(r.kind));
      const searchMatch = normalized.filter((r) => r && r.name.toLowerCase().includes('payment'));

      assert.ok(Array.isArray(pods));
      assert.ok(Array.isArray(nodes));
      assert.ok(Array.isArray(workloads));
      assert.ok(Array.isArray(searchMatch));
    }
  });
});
