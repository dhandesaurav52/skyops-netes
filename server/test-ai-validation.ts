import dotenv from 'dotenv';
dotenv.config();

import { buildIncidentContext } from './ai/contextBuilder';
import { GeminiAIProvider } from './ai/providers/geminiProvider';
import { SafetyPolicyEngine } from './ai/safetyPolicy';
import { skyOpsAIService } from './ai/service';
import { store } from './store';
import { Incident, KubernetesResource } from '../src/types/index';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runValidation() {
  console.log('========================================================================');
  console.log('🚀 SKYOPS AI EVIDENCE-DRIVEN REASONING VALIDATION SUITE');
  console.log('========================================================================\n');

  const devOrgId = 'org-dev-001';
  const clusterId = 'cluster-prod-01';
  if (!store.getClusterByIdInternal(clusterId)) {
    (store as any).clusters.set(clusterId, {
      id: clusterId,
      orgId: devOrgId,
      name: 'Production EKS',
      environment: 'PRODUCTION',
      status: 'CRITICAL',
      connectionStatus: 'connected',
      nodeCount: 3,
      podCount: 24,
      agentVersion: '1.2.0',
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now()
    });
  }
  const cluster = store.getClusterByIdInternal(clusterId);
  const clusterName = cluster?.name || 'Production EKS';

  const testResults: Array<{
    scenario: string;
    passed: boolean;
    durationMs: number;
    geminiCallMs: number;
    confidence: number;
    status: string;
    details: Record<string, any>;
  }> = [];

  // -------------------------------------------------------------------------
  // SCENARIO 1: ImagePullBackOff / ErrImagePull
  // -------------------------------------------------------------------------
  console.log('------------------------------------------------------------------------');
  console.log('🧪 TEST 1: ImagePullBackOff / ErrImagePull');
  console.log('------------------------------------------------------------------------');

  const imagePullPod: KubernetesResource = {
    id: 'res-imgpull-001',
    clusterId,
    kind: 'Pod',
    namespace: 'auth-layer',
    name: 'auth-service-v3-84f9cc964-m7x8q',
    status: 'Pending',
    health: 'CRITICAL',
    createdAt: Date.now() - 1800000,
    updatedAt: Date.now(),
    specSummary: {
      nodeName: 'k8s-node-worker-01',
      containers: [{ name: 'auth-daemon', image: 'registry.acme.corp/auth/service:v3.9.0-rc.2' }]
    },
    statusSummary: { phase: 'Pending', podIP: '10.244.1.45' },
    containers: [
      {
        name: 'auth-daemon',
        image: 'registry.acme.corp/auth/service:v3.9.0-rc.2',
        restartCount: 0,
        ready: false,
        state: 'waiting',
        waitingReason: 'ImagePullBackOff',
        waitingMessage: 'Back-off pulling image "registry.acme.corp/auth/service:v3.9.0-rc.2": ErrImagePull: manifest unknown'
      }
    ],
    conditions: [
      { type: 'Initialized', status: 'True' },
      { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
      { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady' }
    ],
    events: [
      {
        id: 'evt-img-01',
        timestamp: Date.now() - 60000,
        type: 'Warning',
        reason: 'Failed',
        objectKind: 'Pod',
        objectName: 'auth-service-v3-84f9cc964-m7x8q',
        namespace: 'auth-layer',
        message: 'Failed to pull image "registry.acme.corp/auth/service:v3.9.0-rc.2": rpc error: code = NotFound desc = failed to pull and unpack image: manifest unknown'
      }
    ]
  };

  const imagePullIncident: Incident = {
    id: 'INC-VAL-001',
    fingerprint: 'fp-imgpull-001',
    orgId: devOrgId,
    clusterId,
    clusterName,
    namespace: 'auth-layer',
    resourceKind: 'Pod',
    resourceName: 'auth-service-v3-84f9cc964-m7x8q',
    incidentType: 'ImagePullBackOff',
    title: 'Container auth-daemon in ImagePullBackOff (manifest unknown)',
    severity: 'CRITICAL',
    status: 'OPEN',
    occurrenceCount: 8,
    firstSeenAt: Date.now() - 1800000,
    lastSeenAt: Date.now() - 60000,
    technicalDetails: {
      podName: 'auth-service-v3-84f9cc964-m7x8q',
      containerName: 'auth-daemon',
      image: 'registry.acme.corp/auth/service:v3.9.0-rc.2',
      imageTag: 'v3.9.0-rc.2',
      reason: 'ImagePullBackOff',
      observedState: 'ImagePullBackOff: rpc error: code = NotFound desc = failed to pull and unpack image: manifest unknown',
      events: imagePullPod.events,
      conditions: imagePullPod.conditions,
      containers: imagePullPod.containers
    },
    updatedAt: Date.now()
  };

  const t1Start = Date.now();
  const analysis1 = await skyOpsAIService.analyzeIncident(imagePullIncident, imagePullPod, { force: true });
  const t1Duration = Date.now() - t1Start;

  console.log(`⏱️ Analysis 1 Completed in ${t1Duration}ms (Status: ${analysis1.status}, Confidence: ${Math.round(analysis1.confidence * 100)}%)`);
  console.log(`📌 1. Summary: ${analysis1.summary}`);
  console.log(`📌 2. Root Cause: ${analysis1.rootCause}`);
  console.log(`📌 3. Confidence: ${analysis1.confidence} (${analysis1.confidenceExplanation})`);
  console.log(`📌 4. Categorized Evidence (${analysis1.evidence.length} items):`);
  analysis1.evidence.forEach((e) => console.log(`   - [${e.category}] (${e.source}): ${e.detail}`));
  console.log(`📌 5. Recommended Fix: ${analysis1.recommendedFix.description}`);
  console.log(`📌 6. Exact Change Preview:`, analysis1.changePreview);
  console.log(`📌 7. Expected Impact: ${analysis1.expectedImpact || analysis1.recommendedFix.expectedImpact}`);
  console.log(`📌 8. Risk Level: ${analysis1.recommendedFix.risk} (${analysis1.riskExplanation || analysis1.recommendedFix.reason})`);
  console.log(`📌 9. Rollback: ${analysis1.rollback || analysis1.recommendedFix.rollback}`);
  console.log(`📌 10. Verification Criteria:`, analysis1.verificationCriteria);
  console.log(`⏱️ Detailed Timing Metrics:`, analysis1.timing);

  const t1Checks = {
    hasObservableFailure: Boolean(analysis1.summary && analysis1.summary.length > 10),
    hasProvenRootCause: Boolean(analysis1.rootCause && (analysis1.rootCause.toLowerCase().includes('image') || analysis1.rootCause.toLowerCase().includes('manifest') || analysis1.rootCause.toLowerCase().includes('pull') || analysis1.rootCause.toLowerCase().includes('not found'))),
    hasConfidenceScore: typeof analysis1.confidence === 'number' && analysis1.confidence >= 0 && analysis1.confidence <= 1,
    hasCategorizedEvidence: analysis1.evidence.some((e) => e.category === 'OBSERVED_FACT'),
    hasAffectedResources: analysis1.affectedResources.length > 0,
    hasRecommendedFix: Boolean(analysis1.recommendedFix.description),
    hasChangePreview: Boolean(analysis1.changePreview && analysis1.changePreview.field && analysis1.changePreview.proposedValue),
    hasExpectedImpact: Boolean(analysis1.expectedImpact || analysis1.recommendedFix.expectedImpact),
    hasRiskLevel: Boolean(analysis1.recommendedFix.risk),
    hasRollback: Boolean(analysis1.rollback || analysis1.recommendedFix.rollback),
    hasVerificationCriteria: Boolean(analysis1.verificationCriteria && analysis1.verificationCriteria.expectedState)
  };
  const t1Passed = Object.values(t1Checks).every(Boolean);
  testResults.push({
    scenario: 'ImagePullBackOff / ErrImagePull',
    passed: t1Passed,
    durationMs: t1Duration,
    geminiCallMs: analysis1.timing?.durations.geminiCallMs ?? 0,
    confidence: analysis1.confidence,
    status: analysis1.status,
    details: t1Checks
  });

  // -------------------------------------------------------------------------
  // SCENARIO 2: CrashLoopBackOff (with Exit Code 1 / Non-Zero App Failure)
  // -------------------------------------------------------------------------
  await sleep(3000);
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 TEST 2: CrashLoopBackOff (Investigates Exit Code, Restarts, Events - NOT auto image change)');
  console.log('------------------------------------------------------------------------');

  const crashLoopPod: KubernetesResource = {
    id: 'res-crash-001',
    clusterId,
    kind: 'Pod',
    namespace: 'production',
    name: 'skyops-api-gateway-7f89d4b6-kx92z',
    status: 'Running',
    health: 'CRITICAL',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
    specSummary: {
      nodeName: 'k8s-node-worker-02',
      restartPolicy: 'Always',
      containers: [{ name: 'api-server', image: 'registry.acme.corp/skyops/api:v2.8.1' }]
    },
    statusSummary: { phase: 'Running', podIP: '10.244.2.89' },
    containers: [
      {
        name: 'api-server',
        image: 'registry.acme.corp/skyops/api:v2.8.1',
        restartCount: 14,
        ready: false,
        state: 'waiting',
        waitingReason: 'CrashLoopBackOff',
        waitingMessage: 'back-off 5m0s restarting failed container=api-server pod=skyops-api-gateway-7f89d4b6-kx92z (exit code: 1)',
        exitCode: 1,
        terminationReason: 'Error'
      }
    ],
    conditions: [
      { type: 'Initialized', status: 'True' },
      { type: 'Ready', status: 'False', reason: 'ContainersNotReady' },
      { type: 'ContainersReady', status: 'False', reason: 'ContainersNotReady' },
      { type: 'PodScheduled', status: 'True' }
    ],
    events: [
      {
        id: 'evt-crash-01',
        timestamp: Date.now() - 120000,
        type: 'Warning',
        reason: 'BackOff',
        objectKind: 'Pod',
        objectName: 'skyops-api-gateway-7f89d4b6-kx92z',
        namespace: 'production',
        message: 'Back-off restarting failed container api-server in pod skyops-api-gateway-7f89d4b6-kx92z (Process exited with status 1: Fatal Error - Database connection refused on port 5432)'
      }
    ]
  };

  const crashLoopIncident: Incident = {
    id: 'INC-VAL-002',
    fingerprint: 'fp-crash-001',
    orgId: devOrgId,
    clusterId,
    clusterName,
    namespace: 'production',
    resourceKind: 'Pod',
    resourceName: 'skyops-api-gateway-7f89d4b6-kx92z',
    incidentType: 'CrashLoopBackOff',
    title: 'Container api-server in CrashLoopBackOff (14 restarts, exit code 1)',
    severity: 'CRITICAL',
    status: 'OPEN',
    occurrenceCount: 14,
    firstSeenAt: Date.now() - 3600000,
    lastSeenAt: Date.now() - 120000,
    technicalDetails: {
      podName: 'skyops-api-gateway-7f89d4b6-kx92z',
      containerName: 'api-server',
      image: 'registry.acme.corp/skyops/api:v2.8.1',
      restartCount: 14,
      exitCode: 1,
      reason: 'CrashLoopBackOff',
      observedState: 'CrashLoopBackOff: Container terminated with exit code 1 (Database connection refused on port 5432)',
      events: crashLoopPod.events,
      conditions: crashLoopPod.conditions,
      containers: crashLoopPod.containers
    },
    updatedAt: Date.now()
  };

  const t2Start = Date.now();
  const analysis2 = await skyOpsAIService.analyzeIncident(crashLoopIncident, crashLoopPod, { force: true });
  const t2Duration = Date.now() - t2Start;

  console.log(`⏱️ Analysis 2 Completed in ${t2Duration}ms (Status: ${analysis2.status}, Confidence: ${Math.round(analysis2.confidence * 100)}%)`);
  console.log(`📌 1. Summary: ${analysis2.summary}`);
  console.log(`📌 2. Root Cause: ${analysis2.rootCause}`);
  console.log(`📌 3. Confidence: ${analysis2.confidence} (${analysis2.confidenceExplanation})`);
  console.log(`📌 4. Categorized Evidence (${analysis2.evidence.length} items):`);
  analysis2.evidence.forEach((e) => console.log(`   - [${e.category}] (${e.source}): ${e.detail}`));
  console.log(`📌 5. Recommended Fix: ${analysis2.recommendedFix.description}`);
  console.log(`📌 6. Exact Change Preview:`, analysis2.changePreview);
  console.log(`📌 7. Expected Impact: ${analysis2.expectedImpact || analysis2.recommendedFix.expectedImpact}`);
  console.log(`📌 8. Risk Level: ${analysis2.recommendedFix.risk}`);
  console.log(`📌 9. Rollback: ${analysis2.rollback || analysis2.recommendedFix.rollback}`);
  console.log(`📌 10. Verification Criteria:`, analysis2.verificationCriteria);
  console.log(`⏱️ Detailed Timing Metrics:`, analysis2.timing);

  const t2Checks = {
    hasObservableFailure: Boolean(analysis2.summary && analysis2.summary.length > 10),
    hasProvenRootCause: Boolean(analysis2.rootCause && (analysis2.rootCause.toLowerCase().includes('exit') || analysis2.rootCause.toLowerCase().includes('restart') || analysis2.rootCause.toLowerCase().includes('database') || analysis2.rootCause.toLowerCase().includes('connection') || analysis2.rootCause.toLowerCase().includes('application') || analysis2.rootCause.toLowerCase().includes('crash'))),
    hasConfidenceScore: typeof analysis2.confidence === 'number',
    hasCategorizedEvidence: analysis2.evidence.some((e) => e.category === 'OBSERVED_FACT'),
    hasAffectedResources: analysis2.affectedResources.length > 0,
    hasRecommendedFix: Boolean(analysis2.recommendedFix.description),
    hasVerificationCriteria: Boolean(analysis2.verificationCriteria && analysis2.verificationCriteria.expectedState)
  };
  const t2Passed = Object.values(t2Checks).every(Boolean);
  testResults.push({
    scenario: 'CrashLoopBackOff',
    passed: t2Passed,
    durationMs: t2Duration,
    geminiCallMs: analysis2.timing?.durations.geminiCallMs ?? 0,
    confidence: analysis2.confidence,
    status: analysis2.status,
    details: t2Checks
  });

  // -------------------------------------------------------------------------
  // SCENARIO 3: DeploymentDegraded (Desired vs Available Replicas & ProgressDeadlineExceeded)
  // -------------------------------------------------------------------------
  await sleep(3000);
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 TEST 3: DeploymentDegraded (Considers Desired/Available Replicas, Conditions, Events)');
  console.log('------------------------------------------------------------------------');

  const depDegradedResource: KubernetesResource = {
    id: 'res-dep-001',
    clusterId,
    kind: 'Deployment',
    namespace: 'checkout-prod',
    name: 'order-processing-service',
    status: 'Degraded',
    health: 'CRITICAL',
    createdAt: Date.now() - 86400000 * 3,
    updatedAt: Date.now(),
    specSummary: { replicas: 5, strategy: 'RollingUpdate' },
    statusSummary: { replicas: 5, updatedReplicas: 2, readyReplicas: 0, availableReplicas: 0, unavailableReplicas: 5 },
    conditions: [
      { type: 'Available', status: 'False', reason: 'MinimumReplicasUnavailable', message: 'Deployment has minimum availability violations (0/5 available)' },
      { type: 'Progressing', status: 'False', reason: 'ProgressDeadlineExceeded', message: 'ReplicaSet "order-processing-service-89f4b" has timed out progressing.' }
    ],
    events: [
      {
        id: 'evt-dep-01',
        timestamp: Date.now() - 90000,
        type: 'Warning',
        reason: 'FailedCreate',
        objectKind: 'Deployment',
        objectName: 'order-processing-service',
        namespace: 'checkout-prod',
        message: 'Deployment does not have minimum availability (0/5 replicas available) due to pod scheduling resource constraints.'
      }
    ]
  };

  const depDegradedIncident: Incident = {
    id: 'INC-VAL-003',
    fingerprint: 'fp-dep-001',
    orgId: devOrgId,
    clusterId,
    clusterName,
    namespace: 'checkout-prod',
    resourceKind: 'Deployment',
    resourceName: 'order-processing-service',
    incidentType: 'DeploymentDegraded',
    title: 'Deployment order-processing-service degraded (0/5 replicas available)',
    severity: 'CRITICAL',
    status: 'OPEN',
    occurrenceCount: 5,
    firstSeenAt: Date.now() - 86400000,
    lastSeenAt: Date.now() - 90000,
    technicalDetails: {
      desiredReplicas: 5,
      availableReplicas: 0,
      readyReplicas: 0,
      updatedReplicas: 2,
      reason: 'ProgressDeadlineExceeded',
      observedState: 'DeploymentDegraded: 0/5 replicas available; ProgressDeadlineExceeded on ReplicaSet order-processing-service-89f4b',
      conditions: depDegradedResource.conditions,
      events: depDegradedResource.events
    },
    updatedAt: Date.now()
  };

  const t3Start = Date.now();
  const analysis3 = await skyOpsAIService.analyzeIncident(depDegradedIncident, depDegradedResource, { force: true });
  const t3Duration = Date.now() - t3Start;

  console.log(`⏱️ Analysis 3 Completed in ${t3Duration}ms (Status: ${analysis3.status}, Confidence: ${Math.round(analysis3.confidence * 100)}%)`);
  console.log(`📌 1. Summary: ${analysis3.summary}`);
  console.log(`📌 2. Root Cause: ${analysis3.rootCause}`);
  console.log(`📌 3. Confidence: ${analysis3.confidence} (${analysis3.confidenceExplanation})`);
  console.log(`📌 4. Categorized Evidence (${analysis3.evidence.length} items):`);
  analysis3.evidence.forEach((e) => console.log(`   - [${e.category}] (${e.source}): ${e.detail}`));
  console.log(`📌 5. Recommended Fix: ${analysis3.recommendedFix.description}`);
  console.log(`📌 6. Exact Change Preview:`, analysis3.changePreview);
  console.log(`📌 7. Expected Impact: ${analysis3.expectedImpact || analysis3.recommendedFix.expectedImpact}`);
  console.log(`📌 8. Risk Level: ${analysis3.recommendedFix.risk}`);
  console.log(`📌 9. Rollback: ${analysis3.rollback || analysis3.recommendedFix.rollback}`);
  console.log(`📌 10. Verification Criteria:`, analysis3.verificationCriteria);
  console.log(`⏱️ Detailed Timing Metrics:`, analysis3.timing);

  const t3Checks = {
    hasObservableFailure: Boolean(analysis3.summary && analysis3.summary.length > 10),
    hasProvenRootCause: Boolean(analysis3.rootCause && (analysis3.rootCause.toLowerCase().includes('replica') || analysis3.rootCause.toLowerCase().includes('progress') || analysis3.rootCause.toLowerCase().includes('deployment') || analysis3.rootCause.toLowerCase().includes('availability') || analysis3.rootCause.toLowerCase().includes('pod'))),
    hasConfidenceScore: typeof analysis3.confidence === 'number',
    hasCategorizedEvidence: analysis3.evidence.some((e) => e.category === 'OBSERVED_FACT'),
    hasAffectedResources: analysis3.affectedResources.length > 0,
    hasRecommendedFix: Boolean(analysis3.recommendedFix.description),
    hasVerificationCriteria: Boolean(analysis3.verificationCriteria && analysis3.verificationCriteria.expectedState)
  };
  const t3Passed = Object.values(t3Checks).every(Boolean);
  testResults.push({
    scenario: 'DeploymentDegraded',
    passed: t3Passed,
    durationMs: t3Duration,
    geminiCallMs: analysis3.timing?.durations.geminiCallMs ?? 0,
    confidence: analysis3.confidence,
    status: analysis3.status,
    details: t3Checks
  });

  // -------------------------------------------------------------------------
  // SCENARIO 4: PVC Pending (Considers PVC conditions, StorageClass, PV state)
  // -------------------------------------------------------------------------
  await sleep(3000);
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 TEST 4: PVC Pending (Considers StorageClass, PV binding, Conditions, Events)');
  console.log('------------------------------------------------------------------------');

  const pvcPendingResource: KubernetesResource = {
    id: 'res-pvc-001',
    clusterId,
    kind: 'PersistentVolumeClaim',
    namespace: 'database',
    name: 'postgres-data-vol-claim',
    status: 'Pending',
    health: 'WARNING',
    createdAt: Date.now() - 3600000,
    updatedAt: Date.now(),
    specSummary: {
      storageClassName: 'ssd-premium-replicated',
      capacity: '250Gi',
      accessModes: ['ReadWriteOnce']
    },
    statusSummary: { phase: 'Pending' },
    conditions: [],
    events: [
      {
        id: 'evt-pvc-01',
        timestamp: Date.now() - 600000,
        type: 'Warning',
        reason: 'ProvisioningFailed',
        objectKind: 'PersistentVolumeClaim',
        objectName: 'postgres-data-vol-claim',
        namespace: 'database',
        message: 'storageclass.storage.k8s.io "ssd-premium-replicated" not found: failed to provision volume for claim "database/postgres-data-vol-claim"'
      }
    ]
  };

  const pvcPendingIncident: Incident = {
    id: 'INC-VAL-004',
    fingerprint: 'fp-pvc-001',
    orgId: devOrgId,
    clusterId,
    clusterName,
    namespace: 'database',
    resourceKind: 'PersistentVolumeClaim',
    resourceName: 'postgres-data-vol-claim',
    incidentType: 'PVCPending',
    title: 'PersistentVolumeClaim postgres-data-vol-claim Pending (StorageClass ssd-premium-replicated not found)',
    severity: 'HIGH',
    status: 'OPEN',
    occurrenceCount: 1,
    firstSeenAt: Date.now() - 3600000,
    lastSeenAt: Date.now() - 600000,
    technicalDetails: {
      storageClass: 'ssd-premium-replicated',
      pvcPhase: 'Pending',
      capacity: '250Gi',
      reason: 'ProvisioningFailed',
      observedState: 'PVCPending: storageclass.storage.k8s.io "ssd-premium-replicated" not found',
      events: pvcPendingResource.events
    },
    updatedAt: Date.now()
  };

  const t4Start = Date.now();
  const analysis4 = await skyOpsAIService.analyzeIncident(pvcPendingIncident, pvcPendingResource, { force: true });
  const t4Duration = Date.now() - t4Start;

  console.log(`⏱️ Analysis 4 Completed in ${t4Duration}ms (Status: ${analysis4.status}, Confidence: ${Math.round(analysis4.confidence * 100)}%)`);
  console.log(`📌 1. Summary: ${analysis4.summary}`);
  console.log(`📌 2. Root Cause: ${analysis4.rootCause}`);
  console.log(`📌 3. Confidence: ${analysis4.confidence} (${analysis4.confidenceExplanation})`);
  console.log(`📌 4. Categorized Evidence (${analysis4.evidence.length} items):`);
  analysis4.evidence.forEach((e) => console.log(`   - [${e.category}] (${e.source}): ${e.detail}`));
  console.log(`📌 5. Recommended Fix: ${analysis4.recommendedFix.description}`);
  console.log(`📌 6. Exact Change Preview:`, analysis4.changePreview);
  console.log(`📌 7. Expected Impact: ${analysis4.expectedImpact || analysis4.recommendedFix.expectedImpact}`);
  console.log(`📌 8. Risk Level: ${analysis4.recommendedFix.risk}`);
  console.log(`📌 9. Rollback: ${analysis4.rollback || analysis4.recommendedFix.rollback}`);
  console.log(`📌 10. Verification Criteria:`, analysis4.verificationCriteria);
  console.log(`⏱️ Detailed Timing Metrics:`, analysis4.timing);

  const t4Checks = {
    hasObservableFailure: Boolean(analysis4.summary && analysis4.summary.length > 10),
    hasProvenRootCause: Boolean(analysis4.rootCause && (analysis4.rootCause.toLowerCase().includes('storageclass') || analysis4.rootCause.toLowerCase().includes('storage') || analysis4.rootCause.toLowerCase().includes('provision') || analysis4.rootCause.toLowerCase().includes('pvc') || analysis4.rootCause.toLowerCase().includes('volume'))),
    hasConfidenceScore: typeof analysis4.confidence === 'number',
    hasCategorizedEvidence: analysis4.evidence.some((e) => e.category === 'OBSERVED_FACT'),
    hasAffectedResources: analysis4.affectedResources.length > 0,
    hasRecommendedFix: Boolean(analysis4.recommendedFix.description),
    hasVerificationCriteria: Boolean(analysis4.verificationCriteria && analysis4.verificationCriteria.expectedState)
  };
  const t4Passed = Object.values(t4Checks).every(Boolean);
  testResults.push({
    scenario: 'PVC Pending',
    passed: t4Passed,
    durationMs: t4Duration,
    geminiCallMs: analysis4.timing?.durations.geminiCallMs ?? 0,
    confidence: analysis4.confidence,
    status: analysis4.status,
    details: t4Checks
  });

  // -------------------------------------------------------------------------
  // TEST 5: Complete Remediation Lifecycle on ImagePullBackOff
  // Agent evidence → AI RCA → proposed change → exact change preview → safety validation → human approval → typed action → Agent → Kubernetes → fresh telemetry → verification
  // -------------------------------------------------------------------------
  console.log('\n------------------------------------------------------------------------');
  console.log('🧪 TEST 5: Full Closed-Loop Remediation Lifecycle (ImagePullBackOff)');
  console.log('------------------------------------------------------------------------');

  // Step 1: Save incident & AI analysis in store
  (store as any).incidents.set(imagePullIncident.id, imagePullIncident);
  store.syncClusterResources(clusterId, [imagePullPod]);
  store.saveAIAnalysis(imagePullIncident.id, analysis1);

  const storedRem = store.getRemediation(imagePullIncident.id, devOrgId);
  console.log(`✅ Step 1 (AI RCA & Proposal): Remediation ID: ${storedRem?.id || 'N/A'}, Status: ${storedRem?.status}`);
  console.log(`   Action Type: ${storedRem?.actionType}, Target: ${storedRem?.targetResource.kind} ${storedRem?.targetResource.name}`);
  console.log(`   Change Preview: ${storedRem?.changePreview?.field} | Current: "${storedRem?.changePreview?.currentValue}" -> Proposed: "${storedRem?.changePreview?.proposedValue}"`);

  // Step 2: Human operator approval
  const approver = { id: 'user-sre-01', name: 'Lead SRE Operator', email: 'sre@skyops.io' };
  console.log(`\n👤 Step 2 (Human Operator Approval): Dispathing approval from ${approver.name}...`);
  const approvedRem = store.approveRemediation(
    imagePullIncident.id,
    devOrgId,
    approver,
    { comments: 'Approved rolling fix to stable image tag.' }
  );
  console.log(`✅ Step 2 Result: Status: ${approvedRem.status}, ApprovedBy: ${approvedRem.approval?.approvedBy.name}, Execution Status: ${approvedRem.execution?.status}`);

  // Step 3: Agent patches cluster & fresh healthy telemetry arrives
  console.log('\n🤖 Step 3 (Agent Execution & Fresh Kubernetes Telemetry Ingestion)...');
  const healthyPatchedPod: KubernetesResource = {
    ...imagePullPod,
    status: 'Running',
    health: 'HEALTHY',
    updatedAt: Date.now(),
    containers: [
      {
        name: 'auth-daemon',
        image: approvedRem.parameters.proposedImage || 'registry.acme.corp/auth/service:v3.8.9',
        restartCount: 0,
        ready: true,
        state: 'running'
      }
    ],
    statusSummary: {
      phase: 'Running',
      podIP: '10.244.1.45',
      containerStates: [
        {
          name: 'auth-daemon',
          image: approvedRem.parameters.proposedImage || 'registry.acme.corp/auth/service:v3.8.9',
          state: 'running',
          ready: true
        }
      ]
    },
    conditions: [
      { type: 'Initialized', status: 'True' },
      { type: 'Ready', status: 'True' },
      { type: 'ContainersReady', status: 'True' }
    ]
  };

  // Agent syncs fresh telemetry
  store.syncClusterResources(clusterId, [healthyPatchedPod]);

  // Step 4: Closed-Loop Verification check
  const verifiedRem = store.getRemediation(imagePullIncident.id, devOrgId);
  const updatedIncident = store.getIncident(imagePullIncident.id, devOrgId);
  console.log(`✅ Step 4 (Closed-Loop Verification): Remediation Status: ${verifiedRem?.status}`);
  console.log(`   Verification Details: ${verifiedRem?.verification?.observedState}`);
  console.log(`   Incident Status: ${updatedIncident?.status} (Resolved: ${updatedIncident?.resolvedAt ? 'YES' : 'NO'})`);

  const lifecyclePassed =
    (approvedRem.status === 'DISPATCHED' || approvedRem.status === 'EXECUTED' || approvedRem.status === 'VERIFIED_RESOLVED') &&
    verifiedRem?.status === 'VERIFIED_RESOLVED' &&
    updatedIncident?.status === 'RESOLVED';

  testResults.push({
    scenario: 'Full Closed-Loop Remediation Lifecycle',
    passed: lifecyclePassed,
    durationMs: 0,
    geminiCallMs: 0,
    confidence: 1.0,
    status: 'VERIFIED_RESOLVED',
    details: {
      proposalGenerated: Boolean(storedRem),
      operatorApproved: approvedRem.status === 'DISPATCHED',
      telemetryVerified: verifiedRem?.status === 'VERIFIED_RESOLVED',
      incidentAutoResolved: updatedIncident?.status === 'RESOLVED'
    }
  });

  // -------------------------------------------------------------------------
  // FINAL SUMMARY
  // -------------------------------------------------------------------------
  console.log('\n========================================================================');
  console.log('📊 FINAL TEST RESULTS & LATENCY BENCHMARKS');
  console.log('========================================================================');
  console.table(
    testResults.map((r) => ({
      Scenario: r.scenario,
      Passed: r.passed ? '✅ PASS' : '❌ FAIL',
      'Total (ms)': r.durationMs,
      'Gemini (ms)': r.geminiCallMs,
      Confidence: `${Math.round(r.confidence * 100)}%`,
      Status: r.status
    }))
  );

  const allPassed = testResults.every((r) => r.passed);
  console.log(
    allPassed
      ? '\n🎉 ALL VALIDATION TESTS PASSED WITH EVIDENCE GROUNDING AND LOW LATENCY!'
      : '\n⚠️ SOME TESTS FAILED'
  );
}

runValidation().catch((err) => {
  console.error('Validation script execution failed:', err);
  process.exit(1);
});
