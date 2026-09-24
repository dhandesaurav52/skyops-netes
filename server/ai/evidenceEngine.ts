import { Incident, KubernetesResource } from '../../src/types/index';
import { EvidenceSeverity, InvestigationEvidenceItem, InvestigationEvidenceType } from './types';

export class EvidenceEngine {
  /**
   * Deterministically analyzes and extracts categorized evidence from incident data,
   * target Kubernetes resources, cluster topology, events, and metrics.
   *
   * Explicitly categorizes observations into:
   * - FACT: Verifiable, authoritative ground-truth observation from Kubernetes API/telemetry
   * - INFERENCE: High-certainty deduction logically derived from combinations of facts
   * - HYPOTHESIS: Potential root cause under evaluation with supporting/contradicting links
   * - UNKNOWN: Crucial missing data needed to confirm or eliminate failure modes
   */
  public static extractEvidence(
    incident: Incident,
    targetResource?: KubernetesResource | null,
    allResources: KubernetesResource[] = [],
    metrics?: any
  ): InvestigationEvidenceItem[] {
    const evidence: InvestigationEvidenceItem[] = [];
    let counter = 1;

    const addEvidence = (
      type: InvestigationEvidenceType,
      source: string,
      description: string,
      confidence: number,
      severity: EvidenceSeverity = 'INFO',
      rawValue?: any,
      supportingHypotheses?: string[],
      refutingHypotheses?: string[],
      timestamp?: number
    ): InvestigationEvidenceItem => {
      const id = `EV-${String(counter++).padStart(3, '0')}`;
      const item: InvestigationEvidenceItem = {
        id,
        type,
        source,
        timestamp: timestamp || incident.lastSeenAt || Date.now(),
        description,
        confidence: Math.max(0, Math.min(100, Math.round(confidence))),
        severity,
        rawValue,
        supportingHypotheses,
        refutingHypotheses
      };
      evidence.push(item);
      return item;
    };

    const tech = incident.technicalDetails || {};
    const containers = tech.containers || targetResource?.containers || [];
    const events = tech.events || targetResource?.events || [];
    const conditions = tech.conditions || targetResource?.conditions || [];

    // =========================================================================
    // 1. CONTAINER STATES & EXIT CODES (FACTS)
    // =========================================================================
    if (tech.exitCode !== undefined && tech.exitCode !== null) {
      const isOOM = tech.exitCode === 137 || tech.reason === 'OOMKilled';
      addEvidence(
        'FACT',
        'container_exit_code',
        `Container terminated with process exit code ${tech.exitCode}${tech.reason ? ` (${tech.reason})` : ''}`,
        100,
        tech.exitCode === 0 ? 'INFO' : 'CRITICAL',
        { exitCode: tech.exitCode, reason: tech.reason },
        isOOM ? ['HYP-OOM-KILL'] : tech.exitCode === 1 ? ['HYP-APP-RUNTIME-ERROR'] : ['HYP-CONTAINER-CRASH']
      );

      if (isOOM) {
        addEvidence(
          'INFERENCE',
          'container_diagnostics',
          'Linux kernel OOM-killer terminated the container because memory consumption exceeded configured limits or node memory was exhausted',
          98,
          'CRITICAL',
          { signal: 'SIGKILL (9)', exitCode: 137 },
          ['HYP-OOM-KILL'],
          ['HYP-NETWORK-TIMEOUT', 'HYP-IMAGE-PULL-FAILURE']
        );
      } else if (tech.exitCode === 1) {
        addEvidence(
          'INFERENCE',
          'container_diagnostics',
          'Container process threw an unhandled application exception or fatal assertion error upon startup or request handling',
          92,
          'CRITICAL',
          { exitCode: 1 },
          ['HYP-APP-RUNTIME-ERROR']
        );
      } else if (tech.exitCode === 127) {
        addEvidence(
          'INFERENCE',
          'container_diagnostics',
          'Container command or entrypoint binary not found in container image PATH (exit code 127)',
          99,
          'CRITICAL',
          { exitCode: 127 },
          ['HYP-ENTRYPOINT-NOT-FOUND']
        );
      }
    }

    if (tech.restartCount !== undefined && tech.restartCount > 0) {
      addEvidence(
        'FACT',
        'kubelet_pod_lifecycle',
        `Container has restarted ${tech.restartCount} times under kubelet restart policy`,
        100,
        tech.restartCount > 5 ? 'CRITICAL' : 'WARNING',
        { restartCount: tech.restartCount },
        ['HYP-CONTAINER-CRASH', 'HYP-CRASHLOOP-BACKOFF']
      );
    }

    // Examine individual container records
    for (const c of containers) {
      if (c.waitingReason) {
        addEvidence(
          'FACT',
          'container_status',
          `Container "${c.name}" is in waiting state: ${c.waitingReason}${c.waitingMessage ? ` - ${c.waitingMessage}` : ''}`,
          100,
          c.waitingReason.includes('BackOff') || c.waitingReason.includes('Error') ? 'CRITICAL' : 'WARNING',
          { container: c.name, waitingReason: c.waitingReason, message: c.waitingMessage },
          c.waitingReason.includes('Image') ? ['HYP-IMAGE-PULL-FAILURE'] : ['HYP-CRASHLOOP-BACKOFF']
        );
      }

      if (c.image) {
        addEvidence(
          'FACT',
          'pod_spec',
          `Container "${c.name}" configured with container image: ${c.image}`,
          100,
          'INFO',
          { container: c.name, image: c.image }
        );

        if (c.image.includes(':latest')) {
          addEvidence(
            'INFERENCE',
            'spec_audit',
            `Container "${c.name}" uses unpinned ':latest' image tag, creating risk of non-deterministic runtime rollouts`,
            85,
            'WARNING',
            { image: c.image },
            ['HYP-REGISTRY-DRIFT']
          );
        }
      }
    }

    // =========================================================================
    // 2. KUBERNETES EVENTS (FACTS)
    // =========================================================================
    for (const e of events) {
      const type = e.type === 'Warning' ? 'WARNING' : 'INFO';
      const isCritical =
        e.reason === 'Failed' ||
        e.reason === 'FailedCreate' ||
        e.reason === 'BackOff' ||
        e.reason === 'FailedMount' ||
        e.reason === 'FailedScheduling';

      addEvidence(
        'FACT',
        'kubernetes_event',
        `[${e.reason}] ${e.message}${e.count && e.count > 1 ? ` (occurred ${e.count} times)` : ''}`,
        98,
        isCritical ? 'CRITICAL' : type,
        { reason: e.reason, count: e.count, message: e.message },
        e.reason === 'FailedMount'
          ? ['HYP-PVC-BINDING-FAILURE']
          : e.reason === 'FailedScheduling'
          ? ['HYP-RESOURCE-INSUFFICIENT']
          : undefined,
        undefined,
        e.timestamp
      );
    }

    // =========================================================================
    // 3. POD & WORKLOAD CONDITIONS (FACTS)
    // =========================================================================
    for (const cond of conditions) {
      if (cond.status === 'False' && ['Ready', 'ContainersReady', 'PodScheduled'].includes(cond.type)) {
        addEvidence(
          'FACT',
          'pod_condition',
          `Pod condition "${cond.type}" is False${cond.reason ? ` (Reason: ${cond.reason})` : ''}${cond.message ? ` - ${cond.message}` : ''}`,
          100,
          'CRITICAL',
          { type: cond.type, status: cond.status, reason: cond.reason, message: cond.message }
        );
      }
    }

    // =========================================================================
    // 4. NODE TOPOLOGY & CONDITIONS
    // =========================================================================
    const nodeName = tech.nodeName || targetResource?.specSummary?.nodeName;
    if (nodeName) {
      addEvidence(
        'FACT',
        'node_placement',
        `Workload is scheduled on cluster node "${nodeName}"`,
        100,
        'INFO',
        { nodeName }
      );

      const nodeResource = allResources.find(
        (r) => r.kind === 'Node' && r.name.toLowerCase() === String(nodeName).toLowerCase()
      );
      if (nodeResource && nodeResource.conditions) {
        for (const nc of nodeResource.conditions) {
          if (['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(nc.type) && nc.status === 'True') {
            addEvidence(
              'FACT',
              'node_condition',
              `Host node "${nodeName}" is under active ${nc.type}=True${nc.message ? `: ${nc.message}` : ''}`,
              99,
              'CRITICAL',
              { node: nodeName, condition: nc.type, status: nc.status },
              nc.type === 'MemoryPressure' ? ['HYP-OOM-KILL', 'HYP-NODE-SATURATION'] : ['HYP-NODE-SATURATION']
            );
          }
        }
      }
    }

    // =========================================================================
    // 5. STORAGE & PVC STATUS
    // =========================================================================
    if (tech.pvcPhase || tech.storageClass) {
      const isUnbound = tech.pvcPhase && tech.pvcPhase !== 'Bound';
      addEvidence(
        'FACT',
        'pvc_status',
        `PersistentVolumeClaim state is ${tech.pvcPhase || 'Unknown'}${tech.storageClass ? ` using StorageClass "${tech.storageClass}"` : ''}`,
        98,
        isUnbound ? 'CRITICAL' : 'INFO',
        { pvcPhase: tech.pvcPhase, storageClass: tech.storageClass },
        isUnbound ? ['HYP-PVC-BINDING-FAILURE'] : undefined
      );
    }

    // =========================================================================
    // 6. METRICS & RESOURCE SATURATION
    // =========================================================================
    if (metrics) {
      if (metrics.cpuUsagePercent !== undefined) {
        addEvidence(
          'FACT',
          'prometheus_metrics',
          `Current CPU usage: ${metrics.cpuUsagePercent}% of limit`,
          90,
          metrics.cpuUsagePercent > 90 ? 'WARNING' : 'INFO',
          { cpuUsagePercent: metrics.cpuUsagePercent }
        );
      }
      if (metrics.memoryUsagePercent !== undefined) {
        addEvidence(
          'FACT',
          'prometheus_metrics',
          `Current Memory usage: ${metrics.memoryUsagePercent}% of limit`,
          90,
          metrics.memoryUsagePercent > 90 ? 'CRITICAL' : 'INFO',
          { memoryUsagePercent: metrics.memoryUsagePercent },
          metrics.memoryUsagePercent > 90 ? ['HYP-OOM-KILL'] : undefined
        );
      }
    }

    // =========================================================================
    // 7. EXPLICIT UNKNOWNS & MISSING EVIDENCE
    // =========================================================================
    // Detect what data SREs need but is currently missing from telemetry
    const hasLogs = Boolean(tech.logs || (tech as any).recentLogs);
    if (!hasLogs) {
      addEvidence(
        'UNKNOWN',
        'telemetry_gap',
        'Prior container stderr/stdout logs before termination are not attached to this incident record',
        70,
        'WARNING',
        null,
        undefined,
        undefined
      );
    }

    if (!nodeName) {
      addEvidence(
        'UNKNOWN',
        'telemetry_gap',
        'Pod has not been assigned to a node; host node hardware telemetry cannot be correlated',
        80,
        'WARNING'
      );
    }

    return evidence;
  }
}
