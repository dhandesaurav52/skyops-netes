import { Incident, KubernetesResource } from '../../src/types/index';
import {
  InvestigationEvidenceItem,
  InvestigationTimelineEvent,
  TimelineCausalRelation
} from './types';

export class TimelineEngine {
  /**
   * Formats temporal distance relative to incident onset (firstSeenAt).
   */
  public static formatTemporalDistance(timestamp: number, onsetTimestamp: number): string {
    const diffMs = timestamp - onsetTimestamp;
    const absSec = Math.round(Math.abs(diffMs) / 1000);
    if (absSec < 5) return 'at incident onset';
    const mins = Math.floor(absSec / 60);
    const secs = absSec % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return diffMs < 0 ? `-${timeStr} before onset` : `+${timeStr} after onset`;
  }

  /**
   * Builds an investigation timeline with causal relationship tagging
   * (TRIGGER, SYMPTOM, CONSEQUENCE, RECOVERY_ATTEMPT).
   */
  public static buildTimeline(
    incident: Incident,
    targetResource?: KubernetesResource | null,
    allResources: KubernetesResource[] = [],
    evidence: InvestigationEvidenceItem[] = []
  ): InvestigationTimelineEvent[] {
    const events: InvestigationTimelineEvent[] = [];
    const onset = incident.firstSeenAt || Date.now();
    const tech = incident.technicalDetails || {};
    let counter = 1;

    const addEvent = (
      timestamp: number,
      title: string,
      description: string,
      category: any,
      source: string,
      resourceKind: string,
      resourceName: string,
      causalRelation: TimelineCausalRelation,
      correlationScore: number,
      namespace?: string
    ) => {
      const id = `TLE-${String(counter++).padStart(3, '0')}`;
      events.push({
        id,
        timestamp,
        title,
        description,
        category,
        source,
        resourceKind,
        resourceName,
        namespace: namespace || incident.namespace,
        temporalDistance: this.formatTemporalDistance(timestamp, onset),
        causalRelation,
        correlationScore: Math.max(0, Math.min(100, Math.round(correlationScore)))
      });
    };

    // 1. Ingest Raw Kubernetes Events
    const rawEvents = tech.events || targetResource?.events || [];
    for (const ev of rawEvents) {
      const ts = ev.timestamp || onset;
      const isWarning = ev.type === 'Warning';
      let causal: TimelineCausalRelation = 'SYMPTOM';

      if (ev.reason === 'Failed' || ev.reason === 'BackOff' || ev.reason === 'CrashLoopBackOff') {
        causal = 'SYMPTOM';
      } else if (ev.reason === 'Pulled' || ev.reason === 'Created' || ev.reason === 'Started') {
        causal = ts < onset ? 'TRIGGER' : 'RECOVERY_ATTEMPT';
      } else if (ev.reason === 'FailedMount' || ev.reason === 'FailedScheduling') {
        causal = 'TRIGGER';
      } else if (ev.reason === 'Killing' || ev.reason === 'Evicted') {
        causal = 'CONSEQUENCE';
      }

      addEvent(
        ts,
        `Kubernetes Event: ${ev.reason || 'Event'}`,
        ev.message || `Observed event on ${ev.objectKind || incident.resourceKind}/${ev.objectName || incident.resourceName}`,
        isWarning ? 'FACT' : 'DERIVED_FACT',
        'k8s-event-stream',
        ev.objectKind || incident.resourceKind,
        ev.objectName || incident.resourceName,
        causal,
        isWarning ? 95 : 80,
        ev.namespace
      );
    }

    // 2. Incident First Detection
    addEvent(
      onset,
      `Incident Detected: ${incident.incidentType}`,
      `SkyOps agent identified ${incident.severity} condition on ${incident.resourceKind}/${incident.resourceName}`,
      'FACT',
      'skyops-detector',
      incident.resourceKind,
      incident.resourceName,
      'TRIGGER',
      100
    );

    // 3. Container Diagnostic States
    const containers = tech.containers || targetResource?.containers || [];
    for (const c of containers) {
      if (c.restartCount && c.restartCount > 0) {
        addEvent(
          incident.lastSeenAt || onset,
          `Kubelet Restarts: ${c.name}`,
          `Container ${c.name} has recorded ${c.restartCount} restarts; back-off delay active`,
          'FACT',
          'kubelet-lifecycle',
          'Container',
          c.name,
          'RECOVERY_ATTEMPT',
          90
        );
      }

      if (c.waitingReason) {
        addEvent(
          incident.lastSeenAt || onset,
          `Container Waiting: ${c.waitingReason}`,
          c.waitingMessage || `Container entered waiting state with reason ${c.waitingReason}`,
          'FACT',
          'container-runtime',
          'Container',
          c.name,
          'SYMPTOM',
          98
        );
      }
    }

    // 4. Host Node Pressure Conditions
    const nodeName = tech.nodeName || targetResource?.specSummary?.nodeName;
    if (nodeName) {
      const nodeResource = allResources.find(
        (r) => r.kind === 'Node' && r.name.toLowerCase() === String(nodeName).toLowerCase()
      );
      if (nodeResource && nodeResource.conditions) {
        for (const nc of nodeResource.conditions) {
          if (nc.status === 'True' && ['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(nc.type)) {
            addEvent(
              nodeResource.updatedAt || onset - 60000,
              `Node Condition: ${nc.type}`,
              `Host node ${nodeName} entered ${nc.type}=True condition: ${nc.message || nc.reason || ''}`,
              'FACT',
              'node-controller',
              'Node',
              String(nodeName),
              'TRIGGER',
              99
            );
          }
        }
      }
    }

    // 5. Downstream Workload Consequences
    if (tech.availableReplicas !== undefined && tech.desiredReplicas !== undefined && tech.availableReplicas < tech.desiredReplicas) {
      addEvent(
        incident.lastSeenAt || onset,
        'Replica Deficit Observed',
        `Available replicas (${tech.availableReplicas}) below desired scale (${tech.desiredReplicas}) for ${incident.resourceKind}/${incident.resourceName}`,
        'DERIVED_FACT',
        'controller-manager',
        incident.resourceKind,
        incident.resourceName,
        'CONSEQUENCE',
        95
      );
    }

    // Sort chronologically
    return events.sort((a, b) => a.timestamp - b.timestamp);
  }
}
