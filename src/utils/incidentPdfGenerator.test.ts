import assert from 'node:assert/strict';
import test from 'node:test';
import { Incident, IncidentNote, TimelineEvent } from '../../src/types/index.js';
import {
  formatDuration,
  formatReportDate,
  generateIncidentPdf,
  getPriorityLabel
} from '../../src/utils/incidentPdfGenerator.js';

test('PDF Incident Generator Suite', async (t) => {
  await t.test('P1-P5 priority mapping is deterministic', () => {
    assert.equal(getPriorityLabel('CRITICAL'), 'P1 - Critical');
    assert.equal(getPriorityLabel('HIGH'), 'P2 - High');
    assert.equal(getPriorityLabel('MEDIUM'), 'P3 - Moderate');
    assert.equal(getPriorityLabel('LOW'), 'P4 - Low');
    assert.equal(getPriorityLabel('INFO'), 'P5 - Planning');
    assert.equal(getPriorityLabel('UNKNOWN'), 'P5 - Planning');
  });

  await t.test('formatReportDate and formatDuration handles valid, null, and edge durations', () => {
    assert.equal(formatReportDate(null), 'Not available');
    assert.equal(formatReportDate(undefined), 'Not available');
    assert.ok(formatReportDate(1700000000000).includes('2023'));

    assert.equal(formatDuration(1000, null), 'Ongoing (Active)');
    assert.equal(formatDuration(1000, 15000), '14 seconds');
    assert.equal(formatDuration(1000, 185000), '3m 4s');
    assert.equal(formatDuration(1000, 7201000), '2h 0m');
  });

  await t.test('generates complete PDF for resolved incident with full metadata and arrays', () => {
    const mockIncident: Incident = {
      id: 'SKY-0042',
      orgId: 'org-test-123',
      clusterId: 'cluster-prod-01',
      clusterName: 'Production US-East',
      fingerprint: 'prod:Pod:payment:payment-api:CrashLoopBackOff',
      incidentType: 'CrashLoopBackOff',
      severity: 'CRITICAL',
      status: 'RESOLVED',
      title: 'CrashLoopBackOff in payment/payment-api',
      resourceKind: 'Pod',
      resourceName: 'payment-api-6b8f9c-xyz',
      namespace: 'payment',
      firstSeenAt: 1700000000000,
      lastSeenAt: 1700003600000,
      resolvedAt: 1700003600000,
      updatedAt: 1700003600000,
      occurrenceCount: 2,
      assignee: {
        userId: 'usr-456',
        name: 'Sarah Connor',
        email: 'sarah@example.com'
      },
      technicalDetails: {
        reason: 'CrashLoopBackOff',
        message: 'Back-off 5m restarting failed container=payment-server',
        impact: 'Payment checkout requests failing with 502 Bad Gateway',
        rootCause: 'OOMKilled exit code 137 due to memory limit 512Mi',
        recommendation: 'Increase container memory request/limit to 1Gi',
        nodeName: 'node-pool-1-worker-88',
        containerName: 'payment-server',
        image: 'registry.internal/payments/api:v2.4.1@sha256:abcd1234ef',
        resourceUid: 'uid-999-888-777',
        restartCount: 8,
        exitCode: 137,
        observedState: 'Terminated (OOMKilled)',
        containers: [
          {
            name: 'payment-server',
            image: 'registry.internal/payments/api:v2.4.1',
            ready: false,
            restartCount: 8,
            state: 'waiting',
            waitingReason: 'CrashLoopBackOff',
            waitingMessage: 'Back-off 5m restarting container',
            exitCode: 137
          },
          {
            name: 'istio-proxy',
            image: 'docker.io/istio/proxyv2:1.19.0',
            ready: true,
            restartCount: 0,
            state: 'running'
          }
        ],
        conditions: [
          {
            type: 'Ready',
            status: 'False',
            reason: 'ContainersNotReady',
            message: 'containers with unready status: [payment-server]',
            lastTransitionTime: '2023-11-14T22:15:00Z'
          },
          {
            type: 'PodScheduled',
            status: 'True',
            reason: 'Scheduled',
            message: 'Successfully assigned to node-pool-1-worker-88',
            lastTransitionTime: '2023-11-14T22:00:00Z'
          }
        ],
        events: [
          {
            id: 'evt-1',
            timestamp: 1700000000000,
            type: 'Warning',
            reason: 'BackOff',
            objectKind: 'Pod',
            objectName: 'payment-api-6b8f9c-xyz',
            namespace: 'payment',
            message: 'Back-off restarting failed container'
          }
        ]
      }
    };

    const mockTimeline: TimelineEvent[] = [
      {
        id: 'tl-1',
        incidentId: 'SKY-0042',
        timestamp: 1700000000000,
        type: 'DETECTION',
        actor: { type: 'AGENT', name: 'SkyOps Agent' },
        description: 'Incident detected: CrashLoopBackOff on Pod payment-api-6b8f9c-xyz'
      },
      {
        id: 'tl-2',
        incidentId: 'SKY-0042',
        timestamp: 1700001000000,
        type: 'STATE_CHANGE',
        actor: { type: 'USER', name: 'Sarah Connor' },
        description: 'Status changed from OPEN to IN_PROGRESS'
      },
      {
        id: 'tl-3',
        incidentId: 'SKY-0042',
        timestamp: 1700003600000,
        type: 'RECOVERY',
        actor: { type: 'AGENT', name: 'SkyOps Agent' },
        description: 'Auto-recovery confirmed: Pod payment-api-6b8f9c-xyz returned to healthy Running state'
      }
    ];

    const mockNotes: IncidentNote[] = [
      {
        id: 'note-1',
        incidentId: 'SKY-0042',
        authorId: 'usr-456',
        authorName: 'Sarah Connor',
        authorEmail: 'sarah@example.com',
        content: 'Allocated 2Gi heap limit to container spec in Helm release. Pod restarted cleanly.',
        createdAt: 1700002000000
      }
    ];

    // Verify generation succeeds without throwing
    assert.doesNotThrow(() => {
      generateIncidentPdf({
        incident: mockIncident,
        timeline: mockTimeline,
        notes: mockNotes
      });
    });
  });

  await t.test('handles missing optional fields, empty arrays, special characters, and 50+ timeline events', () => {
    const minimalIncident: Incident = {
      id: 'SKY-0099',
      orgId: 'org-test-456',
      clusterId: 'cluster-dev',
      clusterName: 'Dev <Test> & "Cluster" \'Special\' \n Multiline',
      fingerprint: 'fp-dev-test',
      incidentType: 'CrashLoopBackOff',
      severity: 'LOW',
      status: 'OPEN',
      title: 'Minimal Incident with Special Characters: < > & " \' / \\ [ ] { }',
      resourceKind: 'Deployment',
      resourceName: 'web-frontend',
      namespace: 'default',
      firstSeenAt: 1700000000000,
      lastSeenAt: 1700000000000,
      updatedAt: 1700000000000,
      occurrenceCount: 1,
      // No assignee, no resolvedAt
      technicalDetails: {
        // empty containers, empty conditions, empty events
        containers: [],
        conditions: [],
        events: []
      }
    };

    // Generate 60 timeline events to verify multi-page pagination & flow
    const largeTimeline: TimelineEvent[] = [];
    for (let i = 1; i <= 60; i++) {
      largeTimeline.push({
        id: `tl-large-${i}`,
        incidentId: 'SKY-0099',
        timestamp: 1700000000000 + i * 60000,
        type: i % 2 === 0 ? 'STATE_CHANGE' : 'OCCURRENCE',
        actor: { type: 'AGENT', name: `Subsystem-Worker-${i}` },
        description: `Automated timeline event record #${i}: long diagnostic text detailing telemetry observation status with unicode symbols α β γ δ and memory thresholds.`
      });
    }

    const specialNotes: IncidentNote[] = [
      {
        id: 'note-special-1',
        incidentId: 'SKY-0099',
        authorId: 'usr-1',
        authorName: 'Operator <Admin>',
        authorEmail: 'admin@example.com',
        content: 'Engineering note with very long continuous text:\n' + 'A'.repeat(500) + '\nSpecial chars: <>&"\'',
        createdAt: 1700000000000
      }
    ];

    assert.doesNotThrow(() => {
      generateIncidentPdf({
        incident: minimalIncident,
        timeline: largeTimeline,
        notes: specialNotes
      });
    });
  });
});
