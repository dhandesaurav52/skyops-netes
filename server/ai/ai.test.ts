import assert from 'node:assert/strict';
import test from 'node:test';
import { Incident, KubernetesResource, SkyOpsAIAnalysis } from '../../src/types/index';
import { DataStore } from '../store';
import { buildIncidentContext, sanitizeObject, sanitizeStringValue } from './contextBuilder';
import { HIGH_RISK_KEYWORDS, MEDIUM_RISK_KEYWORDS, SafetyPolicyEngine } from './safetyPolicy';
import { SkyOpsAIService } from './service';
import { AIProvider, IncidentContext } from './types';

const mockIncident: Incident = {
  id: 'SKY-TEST-101',
  clusterId: 'cls-prod-01',
  clusterName: 'production-primary',
  title: 'CrashLoopBackOff on payment-gateway-7df899b8-x9kz',
  severity: 'CRITICAL',
  status: 'OPEN',
  incidentType: 'CrashLoopBackOff',
  resourceKind: 'Pod',
  resourceName: 'payment-gateway-7df899b8-x9kz',
  namespace: 'payments',
  fingerprint: 'CrashLoopBackOff:payments:payment-gateway-7df899b8-x9kz',
  firstSeenAt: Date.now() - 3600000,
  lastSeenAt: Date.now(),
  occurrenceCount: 5,
  orgId: 'org-test-sre',
  technicalDetails: {
    podName: 'payment-gateway-7df899b8-x9kz',
    containerName: 'gateway',
    image: 'payments-api:v2.4.1',
    restartCount: 12,
    exitCode: 137,
    reason: 'OOMKilled',
    observedState: 'Container killed due to exceeding memory limit of 512Mi',
    events: [
      {
        id: 'evt-test-1',
        objectKind: 'Pod',
        objectName: 'payment-gateway-7df899b8-x9kz',
        namespace: 'payments',
        type: 'Warning',
        reason: 'BackOff',
        message: 'Back-off restarting failed container gateway in pod payment-gateway-7df899b8-x9kz',
        count: 12,
        timestamp: Date.now() - 120000
      }
    ]
  },
  updatedAt: Date.now()
};

const mockResource: KubernetesResource = {
  id: 'res-payment-01',
  clusterId: 'cls-prod-01',
  kind: 'Pod',
  name: 'payment-gateway-7df899b8-x9kz',
  namespace: 'payments',
  status: 'CrashLoopBackOff',
  health: 'CRITICAL',
  createdAt: Date.now() - 86400000,
  updatedAt: Date.now(),
  specSummary: {
    restartPolicy: 'Always',
    secretToken: 'super-secret-auth-key-12345',
    containers: [{ name: 'gateway', image: 'payments-api:v2.4.1' }]
  },
  statusSummary: {
    phase: 'Running',
    passwordHash: 'secret-hash-value'
  },
  containers: [
    {
      name: 'gateway',
      image: 'payments-api:v2.4.1',
      state: 'waiting',
      restartCount: 12,
      ready: false,
      waitingReason: 'CrashLoopBackOff',
      waitingMessage: 'back-off 5m0s restarting failed container',
      terminationReason: 'OOMKilled',
      exitCode: 137
    }
  ]
};

test('SkyOps AI Suite', async (t) => {
  await t.test('buildIncidentContext: builds sanitized, high-signal context without token bloat or credential leak', () => {
    const context = buildIncidentContext(mockIncident, mockResource);

    assert.equal(context.incidentId, 'SKY-TEST-101');
    assert.equal(context.incidentType, 'CrashLoopBackOff');
    assert.equal(context.resourceKind, 'Pod');
    assert.equal(context.resourceName, 'payment-gateway-7df899b8-x9kz');
    assert.equal(context.namespace, 'payments');
    assert.equal(context.restartCount, 12);
    assert.equal(context.exitCode, 137);
    assert.equal(context.terminationReason, 'OOMKilled');

    // Verify sensitive keys are redacted from specSummary and statusSummary
    assert.equal((context.specSummary as any).secretToken, '[REDACTED_SENSITIVE_DATA]');
    assert.equal((context.statusSummary as any).passwordHash, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(context.recentEvents.length, 1);
    assert.equal(context.containers.length, 1);
  });

  await t.test('Sensitive Data Sanitization: comprehensively redacts secrets while preserving operational keys', () => {
    const testObject = {
      image: 'ghcr.io/org/app:v1.2.3',
      namespace: 'production',
      podName: 'app-6b8f7c-xk9d',
      deployment: 'app-service',
      reason: 'OOMKilled',
      status: 'CrashLoopBackOff',
      exitCode: 137,
      restartCount: 15,
      password: 'my-super-secret-password',
      authToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature',
      clientSecret: 'secret_live_987654321',
      bearerHeader: 'Bearer ghp_0123456789abcdefghijklmnopqrstuvwx',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----',
      apiKey: 'AIzaSyA_sample_google_api_key_12345678',
      env: [
        { name: 'DATABASE_URL', value: 'postgres://user:pass@db.internal:5432/main' },
        { name: 'DB_PASSWORD', value: 'supersecretpass123' },
        { name: 'NODE_ENV', value: 'production' }
      ],
      data: {
        'tls.crt': 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==',
        'tls.key': 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCg=='
      },
      annotations: {
        'kubectl.kubernetes.io/last-applied-configuration': '{"kind":"Secret","data":{"token":"raw-token-123"}}'
      }
    };

    const sanitized = sanitizeObject(testObject);

    // 1. Verify operational fields are preserved intact
    assert.equal(sanitized.image, 'ghcr.io/org/app:v1.2.3');
    assert.equal(sanitized.namespace, 'production');
    assert.equal(sanitized.podName, 'app-6b8f7c-xk9d');
    assert.equal(sanitized.deployment, 'app-service');
    assert.equal(sanitized.reason, 'OOMKilled');
    assert.equal(sanitized.status, 'CrashLoopBackOff');
    assert.equal(sanitized.exitCode, 137);
    assert.equal(sanitized.restartCount, 15);

    // 2. Verify sensitive keys and tokens are redacted
    assert.equal(sanitized.password, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(sanitized.authToken, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(sanitized.clientSecret, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(sanitized.bearerHeader, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(sanitized.privateKey, '[REDACTED_SENSITIVE_DATA]');
    assert.equal(sanitized.apiKey, '[REDACTED_SENSITIVE_DATA]');

    // 3. Verify env array items
    const envPass = sanitized.env.find((e: any) => e.name === 'DB_PASSWORD');
    assert.equal(envPass.value, '[REDACTED_SENSITIVE_DATA]');
    const envNode = sanitized.env.find((e: any) => e.name === 'NODE_ENV');
    assert.equal(envNode.value, 'production');

    // 4. Verify Secret data dictionary
    assert.equal(sanitized.data['tls.crt'], '[REDACTED_SECRET_PAYLOAD]');
    assert.equal(sanitized.data['tls.key'], '[REDACTED_SECRET_PAYLOAD]');

    // 5. Verify string token detection
    assert.equal(sanitizeStringValue('Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'), '[REDACTED_SENSITIVE_TOKEN]');
    assert.equal(sanitizeStringValue('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), '[REDACTED_SENSITIVE_TOKEN]');
  });

  await t.test('SafetyPolicyEngine: enforces deterministic human approval and detects destructive actions', () => {
    // 1. Benign low-risk recommendation
    const safeOutput = SafetyPolicyEngine.validateAndEnforce(
      {
        summary: 'Memory limit exceeded',
        rootCause: 'Pod terminated due to memory cgroup exhaustion (Exit code 137 / OOMKilled)',
        confidence: 0.95,
        recommendedFix: {
          description: 'Increase container memory request from 512Mi to 1Gi in deployment manifest',
          reason: 'Provides sufficient headroom for peak traffic garbage collection',
          risk: 'LOW',
          expectedImpact: 'Prevents OOM kill',
          rollback: 'Revert memory limit back to 512Mi'
        }
      },
      'SKY-TEST-101'
    );

    assert.equal(safeOutput.incidentId, 'SKY-TEST-101');
    assert.equal(safeOutput.requiresApproval, true);
    assert.equal(safeOutput.executionSafe, true);
    assert.equal(safeOutput.confidence, 0.95);
    assert.equal(safeOutput.recommendedFix.action?.type, 'RESOURCE_RESIZING');

    // 2. Destructive recommendation (delete pod / delete namespace)
    const dangerousOutput = SafetyPolicyEngine.validateAndEnforce(
      {
        summary: 'Delete workload',
        rootCause: 'Workload stuck',
        confidence: 99, // percentage format should normalize to 0.99
        recommendedFix: {
          description: 'Force delete pod and delete namespace payments immediately',
          reason: 'Clear everything',
          risk: 'LOW', // AI claims low, but safety policy must elevate
          expectedImpact: 'Destroys namespace',
          rollback: 'None'
        }
      },
      'SKY-TEST-101'
    );

    assert.equal(dangerousOutput.recommendedFix.risk, 'HIGH');
    assert.equal(dangerousOutput.requiresApproval, true);
    assert.equal(dangerousOutput.confidence, 0.99);

    // 3. Malformed / empty input handling
    const malformedOutput = SafetyPolicyEngine.validateAndEnforce(null as any, 'SKY-MALFORMED');
    assert.equal(malformedOutput.incidentId, 'SKY-MALFORMED');
    assert.equal(malformedOutput.confidence, 0.85);
    assert.equal(malformedOutput.requiresApproval, true);
    assert.equal(malformedOutput.executionSafe, true);
    assert.equal(malformedOutput.evidence.length, 1);
    assert.equal(malformedOutput.affectedResources.length, 1);
  });

  await t.test('SkyOpsAIService: in-flight request deduplication prevents concurrent duplicate AI requests', async () => {
    let slowProviderCalls = 0;
    class SlowMockAIProvider implements AIProvider {
      public readonly name = 'SlowMockAI';
      public readonly model = 'mock-v1';

      public isAvailable(): boolean {
        return true;
      }

      public async analyzeIncident(ctx: IncidentContext): Promise<SkyOpsAIAnalysis> {
        slowProviderCalls++;
        // Simulate a 50ms async processing window
        await new Promise((resolve) => setTimeout(resolve, 50));
        return SafetyPolicyEngine.validateAndEnforce(
          {
            summary: `Diagnosis for ${ctx.incidentId}`,
            rootCause: 'Transient crash loop',
            confidence: 0.9,
            provider: this.name,
            model: this.model
          },
          ctx.incidentId
        );
      }
    }

    const provider = new SlowMockAIProvider();
    const service = new SkyOpsAIService(provider);

    // Launch 5 concurrent calls simultaneously for the same uncached incident
    const promises = [
      service.analyzeIncident(mockIncident, mockResource),
      service.analyzeIncident(mockIncident, mockResource),
      service.analyzeIncident(mockIncident, mockResource),
      service.analyzeIncident(mockIncident, mockResource),
      service.analyzeIncident(mockIncident, mockResource)
    ];

    const results = await Promise.all(promises);

    // Verify all 5 callers received identical valid results
    assert.equal(results.length, 5);
    results.forEach((res) => {
      assert.equal(res.incidentId, 'SKY-TEST-101');
      assert.equal(res.status, 'SUCCESS');
      assert.equal(res.confidence, 0.9);
    });

    // Provider MUST have been invoked exactly ONCE due to in-flight deduplication
    assert.equal(slowProviderCalls, 1);
    assert.equal(service.getInFlightCount(), 0);
  });

  await t.test('SkyOpsAIService: handles caching, custom mock provider, and error fallback', async () => {
    class MockAIProvider implements AIProvider {
      public readonly name = 'MockAI';
      public readonly model = 'mock-v1';
      public callCount = 0;

      public isAvailable(): boolean {
        return true;
      }

      public async analyzeIncident(ctx: IncidentContext): Promise<SkyOpsAIAnalysis> {
        this.callCount++;
        return SafetyPolicyEngine.validateAndEnforce(
          {
            summary: `Mock diagnosis for ${ctx.incidentId}`,
            rootCause: `OOMKilled due to high traffic on ${ctx.resourceName}`,
            confidence: 0.92,
            provider: this.name,
            model: this.model,
            recommendedFix: {
              description: 'Scale deployment replicas',
              reason: 'Distributes traffic',
              risk: 'LOW',
              expectedImpact: 'Reduces memory pressure',
              rollback: 'Scale back'
            }
          },
          ctx.incidentId
        );
      }
    }

    const mockProvider = new MockAIProvider();
    const service = new SkyOpsAIService(mockProvider);

    // First call triggers provider
    const analysis1 = await service.analyzeIncident(mockIncident, mockResource);
    assert.equal(analysis1.status, 'SUCCESS');
    assert.equal(analysis1.confidence, 0.92);
    assert.equal(mockProvider.callCount, 1);

    // Second call for same incident uses cache without invoking provider
    const analysis2 = await service.analyzeIncident(mockIncident, mockResource);
    assert.equal(analysis2.status, 'CACHED');
    assert.equal(mockProvider.callCount, 1);

    // Force refresh bypasses cache
    const analysis3 = await service.analyzeIncident(mockIncident, mockResource, { force: true });
    assert.equal(mockProvider.callCount, 2);

    // Verify error fallback when provider throws
    class FailingProvider implements AIProvider {
      public readonly name = 'FailingAI';
      public readonly model = 'fail-v1';
      public isAvailable() { return true; }
      public async analyzeIncident(): Promise<SkyOpsAIAnalysis> {
        throw new Error('Remote AI service unreachable');
      }
    }

    const failingService = new SkyOpsAIService(new FailingProvider());
    const fallbackResult = await failingService.analyzeIncident(mockIncident, mockResource, { force: true });
    assert.equal(fallbackResult.status, 'FAILED');
    assert.equal(fallbackResult.executionSafe, true);
    assert.equal(fallbackResult.requiresApproval, true);
  });

  await t.test('Multi-Tenant Isolation: prevents cross-tenant access to incidents and cluster resources', () => {
    const store = new DataStore();
    const orgA = 'org-alpha';
    const orgB = 'org-bravo';

    // Onboard cluster for Org A
    const { cluster: clusterA } = store.createCluster(orgA, 'prod-cluster-alpha', 'production primary cluster');
    const failingResource: KubernetesResource = {
      id: 'res-auth-01',
      clusterId: clusterA.id,
      kind: 'Pod',
      name: 'auth-service-pod-0',
      namespace: 'auth',
      status: 'CrashLoopBackOff',
      health: 'CRITICAL',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now(),
      specSummary: {},
      statusSummary: {},
      containers: [
        {
          name: 'auth-app',
          image: 'auth-service:v1.0.0',
          state: 'waiting',
          restartCount: 8,
          ready: false,
          waitingReason: 'CrashLoopBackOff',
          waitingMessage: 'back-off restarting failed container',
          terminationReason: 'Error',
          exitCode: 1
        }
      ]
    };

    const incidentA = store.evaluateResourceObservation(orgA, clusterA.id, clusterA.name, failingResource);
    assert.ok(incidentA, 'Incident should be detected and created for Org A');

    // Org A can retrieve its own incident
    const retrievedByOrgA = store.getIncident(incidentA.id, orgA);
    assert.ok(retrievedByOrgA);
    assert.equal(retrievedByOrgA.id, incidentA.id);

    // Org B CANNOT retrieve Org A incident
    const retrievedByOrgB = store.getIncident(incidentA.id, orgB);
    assert.equal(retrievedByOrgB, null);

    // Org B CANNOT query Org A cluster resources
    const resourcesOrgB = store.getClusterResources(clusterA.id, orgB);
    assert.equal(resourcesOrgB.length, 0);
  });
});
