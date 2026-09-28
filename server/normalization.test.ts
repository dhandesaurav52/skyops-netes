import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeResource, resourceIdentity } from './normalization';

test('normalizes a ready Running pod as healthy without optional diagnostics', () => {
  const pod = normalizeResource({ kind: 'Pod', metadata: { name: 'coredns', namespace: 'kube-system' }, status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }], containerStatuses: [{ name: 'coredns', ready: true, state: { running: {} } }] } }, 'cluster-a');
  assert.equal(pod?.status, 'Running'); assert.equal(pod?.health, 'HEALTHY'); assert.equal(pod?.clusterId, 'cluster-a');
});
test('normalizes image pull failure and keeps cluster-scoped identity distinct', () => {
  const pod = normalizeResource({ kind: 'Pod', metadata: { name: 'bad', namespace: 'default' }, status: { phase: 'Pending', containerStatuses: [{ name: 'bad', state: { waiting: { reason: 'ImagePullBackOff' } } }] } }, 'cluster-a');
  assert.equal(pod?.status, 'ImagePullBackOff'); assert.equal(pod?.health, 'CRITICAL');
  assert.notEqual(resourceIdentity('cluster-a', 'Pod', 'default', 'bad'), resourceIdentity('cluster-b', 'Pod', 'default', 'bad'));
});

test('preserves Kubernetes UID, ownership, terminal diagnostics, and event evidence', () => {
  const resource = normalizeResource({ apiVersion: 'v1', kind: 'Pod', metadata: { uid: 'pod-uid', name: 'worker', namespace: 'jobs', ownerReferences: [{ uid: 'rs-uid', kind: 'ReplicaSet', name: 'worker-abc', controller: true }] }, status: { phase: 'Failed', containerStatuses: [{ name: 'worker', image: 'example/worker:v2', imageID: 'sha256:abc', ready: false, restartCount: 2, state: { terminated: { reason: 'Error', exitCode: 1, signal: 9 } }, lastState: { terminated: { reason: 'OOMKilled' } } }] }, events: [{ metadata: { uid: 'event-uid' }, type: 'Warning', reason: 'BackOff', message: 'container failed', timestamp: 123 }] }, 'cluster-a');
  assert.equal(resource?.uid, 'pod-uid'); assert.equal(resource?.apiVersion, 'v1'); assert.equal(resource?.ownerReferences?.[0]?.uid, 'rs-uid');
  assert.equal(resource?.containers?.[0]?.imageId, 'sha256:abc'); assert.equal(resource?.containers?.[0]?.signal, 9); assert.equal(resource?.containers?.[0]?.lastTerminationReason, 'OOMKilled'); assert.equal(resource?.events?.[0]?.id, 'event-uid');
});

test('preserves agent-provided prior termination and memory-limit evidence', () => {
  const resource = normalizeResource({ kind: 'Pod', metadata: { name: 'worker', namespace: 'jobs' }, status: { phase: 'Running' }, containers: [{ name: 'worker', image: 'example/worker:v2', restartCount: 3, ready: false, state: 'waiting', waitingReason: 'CrashLoopBackOff', lastTerminationReason: 'Error', lastExitCode: 2, memoryLimit: '256Mi' }] }, 'cluster-a');
  assert.equal(resource?.containers?.[0]?.lastTerminationReason, 'Error');
  assert.equal(resource?.containers?.[0]?.lastExitCode, 2);
  assert.equal(resource?.containers?.[0]?.memoryLimit, '256Mi');
});
