import assert from 'node:assert/strict';
import test from 'node:test';
import { IncidentDetector } from './detector';
import { KubernetesResource } from '../../src/types/index';

const now = Date.now();
function pod(overrides: Partial<KubernetesResource> = {}): KubernetesResource {
  return { id: 'pod-uid', uid: 'pod-uid', clusterId: 'c1', kind: 'Pod', namespace: 'default', name: 'workload', status: 'Running', health: 'HEALTHY', createdAt: now - 600000, updatedAt: now, specSummary: { nodeName: 'node-a' }, statusSummary: { phase: 'Running' }, conditions: [{ type: 'Ready', status: 'True' }], containers: [{ name: 'app', image: 'example/app:v1', restartCount: 0, ready: true, state: 'running' }], events: [], ...overrides };
}

test('investigates image pull errors from current container state', () => {
  const result = IncidentDetector.evaluateResource(pod({ status: 'ImagePullBackOff', health: 'CRITICAL', conditions: [{ type: 'Ready', status: 'False' }], containers: [{ name: 'app', image: 'nginx:no-such-tag', restartCount: 0, ready: false, state: 'waiting', waitingReason: 'ImagePullBackOff', waitingMessage: 'failed to resolve image: not found' }] }));
  assert.equal(result?.incidentType, 'ImagePullBackOff'); assert.equal(result?.severity, 'HIGH');
  assert.equal(result?.technicalDetails.rootCauseCategory, 'IMAGE_PULL'); assert.equal(result?.technicalDetails.rootCause, 'The configured container image/tag could not be found in the container registry.'); assert.equal(result?.technicalDetails.confidence, 'HIGH');
});

test('classifies registry authentication image failures separately', () => {
  const result = IncidentDetector.evaluateResource(pod({ status: 'ImagePullBackOff', containers: [{ name: 'app', image: 'private/app:v1', restartCount: 0, ready: false, state: 'waiting', waitingReason: 'ImagePullBackOff', waitingMessage: 'pull access denied: authentication required (401 Unauthorized)' }] }));
  assert.equal(result?.technicalDetails.rootCauseCategory, 'REGISTRY_AUTH');
  assert.equal(result?.technicalDetails.rootCause, 'Container registry authentication failure.');
});

for (const reason of ['ErrImagePull', 'InvalidImageName'] as const) test(`detects ${reason}`, () => {
  const result = IncidentDetector.evaluateResource(pod({ status: reason, containers: [{ name: 'app', image: 'bad', restartCount: 0, ready: false, state: 'waiting', waitingReason: reason, waitingMessage: 'bad image' }] }));
  assert.equal(result?.incidentType, 'ImagePullBackOff');
  assert.equal(result?.technicalDetails.reason, reason);
});

test('detects crash loop and OOMKilled', () => {
  const crash = IncidentDetector.evaluateResource(pod({ status: 'CrashLoopBackOff', containers: [{ name: 'app', image: 'x', restartCount: 8, ready: false, state: 'waiting', waitingReason: 'CrashLoopBackOff', exitCode: 2, lastTerminationReason: 'Error' }] }));
  assert.equal(crash?.incidentType, 'CrashLoopBackOff'); assert.equal(crash?.technicalDetails.rootCauseCategory, 'CRASH'); assert.equal(crash?.technicalDetails.exitCode, 2);
  assert.equal(IncidentDetector.evaluateResource(pod({ containers: [{ name: 'app', image: 'x', restartCount: 1, ready: false, state: 'terminated', terminationReason: 'OOMKilled', exitCode: 137 }] }))?.incidentType, 'OOMKilled');
});

test('does not infer a crash loop from a generic BackOff event', () => {
  const result = IncidentDetector.evaluateResource(pod({ status: 'Pending', health: 'WARNING', conditions: [{ type: 'Ready', status: 'False' }], containers: [{ name: 'app', image: 'x', restartCount: 0, ready: false, state: 'waiting' }], events: [{ id: 'backoff', timestamp: now, type: 'Warning', reason: 'BackOff', objectKind: 'Pod', objectName: 'workload', namespace: 'default', message: 'Back-off pulling image x' }] }));
  assert.equal(result, null);
});

test('classifies PVC StorageClass and first-consumer states without conflating them', () => {
  const missing = IncidentDetector.evaluateResource({ ...pod(), kind: 'PersistentVolumeClaim', name: 'data', status: 'Pending', containers: [], events: [{ id: 'missing', timestamp: now, type: 'Warning', reason: 'ProvisioningFailed', objectKind: 'PersistentVolumeClaim', objectName: 'data', namespace: 'default', message: 'storageclass.storage.k8s.io "fast" not found' }] });
  const waiting = IncidentDetector.evaluateResource({ ...pod(), kind: 'PersistentVolumeClaim', name: 'data-waiting', status: 'Pending', containers: [], events: [{ id: 'wait', timestamp: now, type: 'Normal', reason: 'WaitForFirstConsumer', objectKind: 'PersistentVolumeClaim', objectName: 'data-waiting', namespace: 'default', message: 'waiting for first consumer to be created before binding' }] });
  assert.equal(missing?.technicalDetails.rootCauseCategory, 'STORAGE_CLASS');
  assert.equal(waiting?.technicalDetails.rootCauseCategory, 'WAITING_FOR_CONSUMER');
});

test('classifies Pending pods using scheduling evidence', () => {
  const result = IncidentDetector.evaluateResource(pod({ status: 'Pending', health: 'WARNING', conditions: [{ type: 'PodScheduled', status: 'False' }], containers: [], events: [{ id: 'scheduled', timestamp: now, type: 'Warning', reason: 'FailedScheduling', objectKind: 'Pod', objectName: 'workload', namespace: 'default', message: '0/3 nodes are available: 3 Insufficient cpu.' }] }));
  assert.equal(result?.incidentType, 'PodSchedulingFailed'); assert.equal(result?.technicalDetails.rootCauseCategory, 'SCHEDULING');
});

test('does not turn Pending without evidence into an incident', () => {
  assert.equal(IncidentDetector.evaluateResource(pod({ status: 'Pending', health: 'WARNING', conditions: [{ type: 'PodScheduled', status: 'False' }], containers: [] })), null);
});

test('does not create stale readiness incident from historical event', () => {
  const result = IncidentDetector.evaluateResource(pod({ events: [{ id: 'old', timestamp: now - 3600000, type: 'Warning', reason: 'Unhealthy', objectKind: 'Pod', objectName: 'workload', namespace: 'default', message: 'Readiness probe failed' }] }));
  assert.equal(result, null);
});

test('detects current readiness failure and resolves after readiness returns', () => {
  const failing = pod({ health: 'WARNING', conditions: [{ type: 'Ready', status: 'False' }], containers: [{ name: 'app', image: 'x', restartCount: 0, ready: false, state: 'running' }], events: [{ id: 'recent', timestamp: now, type: 'Warning', reason: 'Unhealthy', objectKind: 'Pod', objectName: 'workload', namespace: 'default', message: 'Readiness probe failed' }] });
  assert.equal(IncidentDetector.evaluateResource(failing)?.incidentType, 'ReadinessProbeFailed');
  assert.equal(IncidentDetector.evaluateRecovery(pod(), 'ReadinessProbeFailed').recovered, true);
});

test('detects and recovers deployment availability deterministically', () => {
  const down: KubernetesResource = { ...pod(), kind: 'Deployment', name: 'payment-service', status: '0/1 Ready', specSummary: { replicas: 1 }, statusSummary: { readyReplicas: 0, availableReplicas: 0, updatedReplicas: 0 }, conditions: [{ type: 'Available', status: 'False' }], containers: [] };
  const healthy = { ...down, status: '1/1 Ready', statusSummary: { readyReplicas: 1, availableReplicas: 1, updatedReplicas: 1 }, conditions: [{ type: 'Available', status: 'True' }] };
  assert.equal(IncidentDetector.evaluateResource(down)?.incidentType, 'DeploymentDegraded');
  assert.equal(IncidentDetector.evaluateResource(healthy), null); assert.equal(IncidentDetector.evaluateRecovery(healthy, 'DeploymentDegraded').recovered, true);
});

test('exempts SkyOps agent infrastructure from generating false-positive incidents during launch', () => {
  const agentDeployment: KubernetesResource = {
    ...pod(),
    kind: 'Deployment',
    namespace: 'skyops-system',
    name: 'skyops-agent',
    status: '0/1 Ready',
    specSummary: { replicas: 1 },
    statusSummary: { readyReplicas: 0, availableReplicas: 0, updatedReplicas: 0 },
    conditions: [{ type: 'Available', status: 'False' }],
    containers: []
  };
  assert.equal(IncidentDetector.isAgentInfrastructure(agentDeployment), true);
  assert.equal(IncidentDetector.evaluateResource(agentDeployment), null);
});

test('understands healthy in-flight deployment rollout vs deadline failure', () => {
  // 1. Newly created deployment actively progressing within startup grace window
  const inFlightRollout: KubernetesResource = {
    ...pod(),
    kind: 'Deployment',
    name: 'web-service',
    createdAt: Date.now() - 30000, // 30 seconds ago
    status: '0/3 Ready',
    specSummary: { replicas: 3 },
    statusSummary: { readyReplicas: 0, availableReplicas: 0, updatedReplicas: 3 },
    conditions: [
      { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
      { type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated', message: 'ReplicaSet is progressing' }
    ],
    containers: []
  };
  assert.equal(IncidentDetector.evaluateResource(inFlightRollout), null);

  // 2. Deployment that failed progress deadline (spec.progressDeadlineSeconds exceeded)
  const failedRollout: KubernetesResource = {
    ...inFlightRollout,
    conditions: [
      { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable' },
      { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'Progress deadline exceeded' }
    ]
  };
  const result = IncidentDetector.evaluateResource(failedRollout);
  assert.equal(result?.incidentType, 'DeploymentDegraded');
  assert.equal(result?.severity, 'CRITICAL');
});

test('detects node pressure, PVC pending, and service without endpoints', () => {
  assert.equal(IncidentDetector.evaluateResource({ ...pod(), kind: 'Node', namespace: '', name: 'node-a', conditions: [{ type: 'MemoryPressure', status: 'True' }], containers: [] })?.incidentType, 'NodeMemoryPressure');
  assert.equal(IncidentDetector.evaluateResource({ ...pod(), kind: 'PersistentVolumeClaim', name: 'data', status: 'Pending', containers: [] })?.incidentType, 'PVCPending');
});

test('service health evaluation accurately distinguishes healthy, unready pods, selector mismatch, and control-plane endpoints', () => {
  const baseService: KubernetesResource = {
    id: 'svc-1',
    clusterId: 'c1',
    kind: 'Service',
    namespace: 'default',
    name: 'web-api',
    status: 'Active',
    health: 'HEALTHY',
    createdAt: now - 120_000,
    updatedAt: now,
    specSummary: { selector: { app: 'web-api' }, type: 'ClusterIP' },
    statusSummary: {},
    conditions: [],
    containers: [],
    events: []
  };

  // 1. Healthy service with ready endpoints
  const healthySvc: KubernetesResource = {
    ...baseService,
    statusSummary: { readyEndpoints: 2, notReadyEndpoints: 0, totalEndpoints: 2, hasEndpointsObject: true }
  };
  assert.equal(IncidentDetector.evaluateResource(healthySvc), null);

  // 2. ExternalName service should never trigger an incident
  const externalNameSvc: KubernetesResource = {
    ...baseService,
    name: 'external-db',
    specSummary: { type: 'ExternalName', externalName: 'db.example.com' },
    statusSummary: { readyEndpoints: 0, hasEndpointsObject: false }
  };
  assert.equal(IncidentDetector.evaluateResource(externalNameSvc), null);

  // 3. Newly created service within grace period (< 45s) should not trigger incident
  const newSvc: KubernetesResource = {
    ...baseService,
    createdAt: Date.now() - 10_000,
    statusSummary: { readyEndpoints: 0, hasEndpointsObject: true }
  };
  assert.equal(IncidentDetector.evaluateResource(newSvc), null);

  // 4. Service with selector where backing pods exist but are NOT ready
  const unreadyPodsSvc: KubernetesResource = {
    ...baseService,
    statusSummary: {
      readyEndpoints: 0,
      notReadyEndpoints: 2,
      totalEndpoints: 2,
      matchingPodsCount: 2,
      readyBackingPodsCount: 0,
      unreadyBackingPodsCount: 2,
      unreadyPodDetails: [
        { name: 'web-api-abc', phase: 'Running', reason: 'Readiness probe failed' },
        { name: 'web-api-def', phase: 'Pending', waitingReason: 'CrashLoopBackOff' }
      ],
      hasEndpointsObject: true
    }
  };
  const unreadyResult = IncidentDetector.evaluateResource(unreadyPodsSvc);
  assert.equal(unreadyResult?.detected, true);
  assert.equal(unreadyResult?.incidentType, 'ServiceBackingPodsNotReady');
  assert.equal(unreadyResult?.severity, 'HIGH');
  assert.equal((unreadyResult?.technicalDetails as any).matchingPodsCount, 2);

  // 5. Service with selector where 0 backing pods match selector
  const mismatchSvc: KubernetesResource = {
    ...baseService,
    statusSummary: {
      readyEndpoints: 0,
      notReadyEndpoints: 0,
      totalEndpoints: 0,
      matchingPodsCount: 0,
      readyBackingPodsCount: 0,
      unreadyBackingPodsCount: 0,
      hasEndpointsObject: true
    }
  };
  const mismatchResult = IncidentDetector.evaluateResource(mismatchSvc);
  assert.equal(mismatchResult?.detected, true);
  assert.equal(mismatchResult?.incidentType, 'ServiceSelectorMismatch');
  assert.equal(mismatchResult?.severity, 'HIGH');

  // 6. Optional kube-system service (e.g. cilium-envoy) selector mismatch is LOW severity
  const ciliumEnvoySvc: KubernetesResource = {
    ...baseService,
    namespace: 'kube-system',
    name: 'cilium-envoy',
    specSummary: { selector: { 'k8s-app': 'cilium-envoy' } },
    statusSummary: {
      readyEndpoints: 0,
      notReadyEndpoints: 0,
      matchingPodsCount: 0,
      hasEndpointsObject: true
    }
  };
  const ciliumResult = IncidentDetector.evaluateResource(ciliumEnvoySvc);
  assert.equal(ciliumResult?.detected, true);
  assert.equal(ciliumResult?.incidentType, 'ServiceSelectorMismatch');
  assert.equal(ciliumResult?.severity, 'LOW');

  // 7. Control plane API service (default/kubernetes) with 0 endpoints is CRITICAL
  const k8sApiSvc: KubernetesResource = {
    ...baseService,
    namespace: 'default',
    name: 'kubernetes',
    specSummary: {}, // No selector
    statusSummary: {
      readyEndpoints: 0,
      notReadyEndpoints: 0,
      isControlPlaneService: true,
      hasEndpointsObject: true
    }
  };
  const k8sApiResult = IncidentDetector.evaluateResource(k8sApiSvc);
  assert.equal(k8sApiResult?.detected, true);
  assert.equal(k8sApiResult?.incidentType, 'ServiceNoEndpoints');
  assert.equal(k8sApiResult?.severity, 'CRITICAL');

  // 8. Auto-recovery when endpoints become ready
  const recoveredService: KubernetesResource = {
    ...baseService,
    statusSummary: { readyEndpoints: 2 }
  };
  assert.equal(IncidentDetector.evaluateRecovery(recoveredService, 'ServiceNoEndpoints').recovered, true);
  assert.equal(IncidentDetector.evaluateRecovery(recoveredService, 'ServiceSelectorMismatch').recovered, true);
  assert.equal(IncidentDetector.evaluateRecovery(recoveredService, 'ServiceBackingPodsNotReady').recovered, true);
});
