import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { Incident, KubernetesResource } from '../../src/types/index';
import { SkyOpsIntelligenceEngine } from './intelligence';

describe('SkyOps Intelligence Engine - Deterministic Pipeline', () => {
  const baseIncident: Incident = {
    id: 'inc-test-1',
    fingerprint: 'fp-test-1',
    orgId: 'org-test',
    clusterId: 'cluster-prod-1',
    clusterName: 'Production US-East',
    incidentType: 'ImagePullBackOff',
    severity: 'CRITICAL',
    status: 'OPEN',
    resourceKind: 'Pod',
    resourceName: 'checkout-api-7b89',
    namespace: 'ecommerce',
    title: 'ImagePullBackOff: checkout-api-7b89',
    firstSeenAt: Date.now() - 60000,
    lastSeenAt: Date.now(),
    occurrenceCount: 1,
    technicalDetails: {
      podName: 'checkout-api-7b89',
      containerName: 'api',
      image: 'registry.internal.io/checkout-api:v2.99.0-nonexistent',
      imageTag: 'v2.99.0-nonexistent',
      observedState: 'ImagePullBackOff',
      reason: 'ErrImagePull',
      events: [
        {
          id: 'ev-1',
          type: 'Warning',
          reason: 'Failed',
          objectKind: 'Pod',
          objectName: 'checkout-api-7b89',
          namespace: 'ecommerce',
          message: 'Failed to pull image "registry.internal.io/checkout-api:v2.99.0-nonexistent": rpc error: code = NotFound desc = failed to pull and unpack image: manifest unknown',
          count: 3,
          timestamp: Date.now() - 30000
        }
      ],
      containers: [
        {
          name: 'api',
          image: 'registry.internal.io/checkout-api:v2.99.0-nonexistent',
          ready: false,
          state: 'waiting',
          waitingReason: 'ImagePullBackOff',
          waitingMessage: 'Back-off pulling image "registry.internal.io/checkout-api:v2.99.0-nonexistent"',
          restartCount: 0
        }
      ]
    },
    updatedAt: Date.now()
  };

  test('ImagePullBackOff: Selects "Image Tag Not Found" with high confidence and refutes Auth failure', () => {
    const analysis = SkyOpsIntelligenceEngine.analyzeIncident(baseIncident);

    assert.equal(analysis.rootCause, 'Image Tag Not Found in Container Registry');
    assert.equal(analysis.rootCauseCategory, 'IMAGE_REGISTRY_ERROR');
    assert.equal(analysis.confidenceLevel, 'HIGH');
    assert.ok(analysis.confidence >= 0.85, `Expected confidence >= 0.85, got ${analysis.confidence}`);
    assert.equal(analysis.isUnknownOrInconclusive, false);

    assert.ok(analysis.primaryHypothesis);
    assert.equal(analysis.primaryHypothesis.status, 'CONFIRMED');
    assert.ok(analysis.primaryHypothesis.supportingEvidence.length >= 1);

    // Explainability checks
    assert.ok(analysis.explainability.whySelected.includes('Image Tag Not Found'));
    const rejectedAuth = analysis.explainability.rejectedAlternatives.find(
      (a) => a.title.includes('Registry Authentication Failure')
    );
    assert.ok(rejectedAuth, 'Expected Authentication Failure in rejected alternatives');

    // 7-tier categorization check
    const factSignals = analysis.signals.filter((s) => s.category === 'FACT');
    assert.ok(factSignals.length > 0, 'Must have signals with category FACT');
    assert.ok(factSignals.some((s) => s.property.includes('waitingReason')));
  });

  test('ImagePullBackOff: Selects "Registry Authentication Failure" when 401/403 event is observed', () => {
    const authIncident: Incident = {
      ...baseIncident,
      id: 'inc-test-auth',
      technicalDetails: {
        ...baseIncident.technicalDetails,
        events: [
          {
            id: 'ev-auth',
            type: 'Warning',
            reason: 'Failed',
            objectKind: 'Pod',
            objectName: 'checkout-api-7b89',
            namespace: 'ecommerce',
            message: 'Failed to pull image "registry.internal.io/checkout-api:private": rpc error: code = Unknown desc = failed to pull and unpack image: pull access denied, repository does not exist or may require \'docker login\': unauthorized',
            count: 2,
            timestamp: Date.now() - 10000
          }
        ]
      }
    };

    const analysis = SkyOpsIntelligenceEngine.analyzeIncident(authIncident);
    assert.equal(analysis.rootCause, 'Registry Authentication Failure or Missing Pull Secret');
    assert.equal(analysis.rootCauseCategory, 'AUTHENTICATION_ERROR');
    assert.equal(analysis.confidenceLevel, 'HIGH');

    const tagNotFound = analysis.evaluatedHypotheses.find((h) => h.id === 'hypo-image-tag-not-found');
    assert.ok(tagNotFound);
    assert.equal(tagNotFound.status, 'REFUTED');
  });

  test('OOMKilled: Distinguishes between isolated Container Memory Limit vs Node-Level Memory Pressure', () => {
    const oomIncident: Incident = {
      ...baseIncident,
      id: 'inc-test-oom',
      incidentType: 'OOMKilled',
      technicalDetails: {
        podName: 'data-worker-1',
        containerName: 'processor',
        exitCode: 137,
        reason: 'OOMKilled',
        nodeName: 'node-worker-2',
        containers: [
          {
            name: 'processor',
            image: 'worker:latest',
            ready: false,
            state: 'terminated',
            terminationReason: 'OOMKilled',
            exitCode: 137,
            restartCount: 4
          }
        ]
      }
    };

    // Case 1: Node is healthy (MemoryPressure is False)
    const healthyNode: KubernetesResource = {
      id: 'node-worker-2',
      clusterId: 'cluster-prod-1',
      kind: 'Node',
      name: 'node-worker-2',
      namespace: '',
      status: 'Ready',
      health: 'HEALTHY',
      createdAt: Date.now() - 100000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      conditions: [
        { type: 'Ready', status: 'True' },
        { type: 'MemoryPressure', status: 'False' }
      ]
    };

    const analysisHealthy = SkyOpsIntelligenceEngine.analyzeIncident(
      oomIncident,
      null,
      [healthyNode]
    );

    assert.equal(analysisHealthy.rootCause, 'Container Exceeded Configured Memory Limit (cgroup OOM)');
    assert.equal(analysisHealthy.rootCauseCategory, 'RESOURCE_LIMIT_EXCEEDED');
    assert.ok(analysisHealthy.confidence >= 0.85);

    const nodeHypo = analysisHealthy.evaluatedHypotheses.find((h) => h.id === 'hypo-node-memory-pressure');
    assert.ok(nodeHypo);
    assert.equal(nodeHypo.status, 'REFUTED', 'Node memory pressure hypothesis must be REFUTED when Node MemoryPressure is False');

    // Case 2: Node is actively under MemoryPressure
    const pressuredNode: KubernetesResource = {
      ...healthyNode,
      conditions: [
        { type: 'Ready', status: 'True' },
        { type: 'MemoryPressure', status: 'True' }
      ]
    };

    const analysisPressured = SkyOpsIntelligenceEngine.analyzeIncident(
      oomIncident,
      null,
      [pressuredNode]
    );

    assert.equal(analysisPressured.rootCause, 'Node-Level Memory Exhaustion & System Eviction');
    assert.equal(analysisPressured.rootCauseCategory, 'HOST_RESOURCE_PRESSURE');
  });

  test('FailedScheduling: Correctly attributes scheduling failure to insufficient resources vs node taints', () => {
    const schedulingIncident: Incident = {
      ...baseIncident,
      id: 'inc-test-sched',
      incidentType: 'PodSchedulingFailed',
      technicalDetails: {
        podName: 'ml-inference-0',
        observedState: 'Pending',
        events: [
          {
            id: 'ev-sched',
            type: 'Warning',
            reason: 'FailedScheduling',
            objectKind: 'Pod',
            objectName: 'ml-inference-0',
            namespace: 'ecommerce',
            message: '0/8 nodes are available: 8 Insufficient memory.',
            count: 5,
            timestamp: Date.now() - 15000
          }
        ]
      }
    };

    const analysis = SkyOpsIntelligenceEngine.analyzeIncident(schedulingIncident);
    assert.equal(analysis.rootCause, 'Insufficient Cluster CPU or Memory Capacity');
    assert.equal(analysis.rootCauseCategory, 'CAPACITY_EXHAUSTION');
    assert.equal(analysis.confidenceLevel, 'HIGH');
  });

  test('CrashLoopBackOff: Detects binary not found (exit code 127) vs unhandled application exception (exit code 1)', () => {
    const exit127Incident: Incident = {
      ...baseIncident,
      id: 'inc-test-127',
      incidentType: 'CrashLoopBackOff',
      technicalDetails: {
        podName: 'frontend-app',
        containerName: 'web',
        exitCode: 127,
        containers: [
          {
            name: 'web',
            image: 'web:v1',
            ready: false,
            state: 'waiting',
            waitingReason: 'CrashLoopBackOff',
            exitCode: 127,
            restartCount: 6
          }
        ]
      }
    };

    const analysis127 = SkyOpsIntelligenceEngine.analyzeIncident(exit127Incident);
    assert.equal(analysis127.rootCause, 'Entrypoint Command or Binary Not Found (Exit 127)');
    assert.equal(analysis127.rootCauseCategory, 'CONTAINER_SPEC_ERROR');

    const appCrashHypo = analysis127.evaluatedHypotheses.find((h) => h.id === 'hypo-app-runtime-crash');
    assert.ok(appCrashHypo);
    assert.equal(appCrashHypo.status, 'REFUTED', 'Application runtime crash must be REFUTED when exit code is 127');
  });

  test('Inconclusive telemetry: Gracefully declares UNKNOWN with LOW confidence and missing evidence list', () => {
    const ambiguousIncident: Incident = {
      ...baseIncident,
      id: 'inc-test-unknown',
      incidentType: 'PodPending',
      technicalDetails: {
        observedState: 'Unknown',
        events: [],
        containers: []
      }
    };

    const analysis = SkyOpsIntelligenceEngine.analyzeIncident(ambiguousIncident);
    assert.equal(analysis.isUnknownOrInconclusive, true);
    assert.equal(analysis.rootCause, 'UNKNOWN / INSUFFICIENT_EVIDENCE');
    assert.equal(analysis.rootCauseCategory, 'UNDETERMINED');
    assert.equal(analysis.confidenceLevel, 'LOW');
    assert.ok(analysis.confidence <= 0.35);

    assert.ok(analysis.explainability.missingEvidence);
    assert.ok(analysis.explainability.missingEvidence.length > 0);
  });
});
