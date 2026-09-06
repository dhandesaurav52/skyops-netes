import { KubernetesResource } from '../../src/types/index';
import {
  CorrelatedSignal,
  CorrelatedTimelineEvent,
  ResourceRelationship,
  SignalCategory
} from './types';

/**
 * Builds the comprehensive Kubernetes relationship graph around an incident's target resource.
 * Discovers:
 *  - Pod -> Controller (Deployment, ReplicaSet, StatefulSet, DaemonSet, Job)
 *  - Pod -> Node (and node conditions/health)
 *  - Pod -> PVCs -> StorageClass
 *  - Pod -> Exposing Services
 *  - Multi-pod co-location (peers on the same node)
 */
export function buildRelationshipGraph(
  target: KubernetesResource,
  allResources: KubernetesResource[]
): ResourceRelationship[] {
  const relationships: ResourceRelationship[] = [];
  const targetKind = target.kind;
  const targetName = target.name;
  const targetNs = target.namespace || 'default';

  if (targetKind === 'Pod') {
    const spec = target.specSummary || {};
    const status = target.statusSummary || {};

    // 1. Controller / Owner References
    if (target.ownerReferences && target.ownerReferences.length > 0) {
      for (const ref of target.ownerReferences) {
        const ownerResource = allResources.find(
          (r) =>
            r.kind.toLowerCase() === ref.kind.toLowerCase() &&
            r.name.toLowerCase() === ref.name.toLowerCase() &&
            (r.namespace || 'default').toLowerCase() === targetNs.toLowerCase()
        );

        relationships.push({
          source: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
          target: {
            kind: ref.kind,
            name: ref.name,
            namespace: targetNs,
            status: ownerResource?.status || 'Active'
          },
          relation: 'OWNED_BY',
          details: `Pod controlled by ${ref.kind}/${ref.name}${ref.controller ? ' (controller)' : ''}`
        });

        // If owned by ReplicaSet, find the parent Deployment
        if (ref.kind === 'ReplicaSet') {
          const parentDeploy = allResources.find((r) => {
            if (r.kind !== 'Deployment' || (r.namespace || 'default').toLowerCase() !== targetNs.toLowerCase()) return false;
            // Common naming pattern: deployment-name-hash
            return ref.name.startsWith(r.name + '-');
          });
          if (parentDeploy) {
            relationships.push({
              source: { kind: 'ReplicaSet', name: ref.name, namespace: targetNs, status: ownerResource?.status },
              target: { kind: 'Deployment', name: parentDeploy.name, namespace: targetNs, status: parentDeploy.status },
              relation: 'OWNED_BY',
              details: `ReplicaSet managed by Deployment ${parentDeploy.name}`
            });
          }
        }
      }
    } else {
      // Look for controller via label match if ownerReferences omitted
      const controllers = allResources.filter(
        (r) =>
          ['Deployment', 'StatefulSet', 'DaemonSet'].includes(r.kind) &&
          (r.namespace || 'default').toLowerCase() === targetNs.toLowerCase()
      );
      for (const ctrl of controllers) {
        if (targetName.startsWith(ctrl.name + '-') || targetName.startsWith(ctrl.name)) {
          relationships.push({
            source: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
            target: { kind: ctrl.kind, name: ctrl.name, namespace: targetNs, status: ctrl.status },
            relation: 'OWNED_BY',
            details: `Inferred workload owner ${ctrl.kind}/${ctrl.name} based on naming and namespace match`
          });
          break;
        }
      }
    }

    // 2. Scheduled Node Relationship
    const nodeName = spec.nodeName || status.nodeName || (target as any).nodeName;
    if (nodeName) {
      const nodeResource = allResources.find(
        (r) => r.kind === 'Node' && r.name.toLowerCase() === nodeName.toLowerCase()
      );
      const isNodePressured = nodeResource?.conditions?.some(
        (c) => ['MemoryPressure', 'DiskPressure', 'PIDPressure'].includes(c.type) && c.status === 'True'
      );
      const isNodeNotReady = nodeResource?.conditions?.some(
        (c) => c.type === 'Ready' && c.status !== 'True'
      );

      relationships.push({
        source: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
        target: {
          kind: 'Node',
          name: nodeName,
          status: isNodeNotReady ? 'NotReady' : isNodePressured ? 'Pressure' : 'Ready'
        },
        relation: 'SCHEDULED_ON',
        details: isNodePressured
          ? `Scheduled on Node ${nodeName} which is experiencing active resource pressure!`
          : isNodeNotReady
          ? `Scheduled on Node ${nodeName} which is NOT in Ready status`
          : `Scheduled on healthy Node ${nodeName}`,
        isImpacted: Boolean(isNodePressured || isNodeNotReady)
      });

      // 3. Co-located peer pods on the same node
      const peerPodsOnSameNode = allResources.filter(
        (r) =>
          r.kind === 'Pod' &&
          r.name !== targetName &&
          (r.specSummary?.nodeName === nodeName || (r as any).nodeName === nodeName)
      );

      const failingPeers = peerPodsOnSameNode.filter((p) => p.health === 'CRITICAL' || p.health === 'WARNING');
      if (failingPeers.length > 0) {
        for (const peer of failingPeers.slice(0, 3)) {
          relationships.push({
            source: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
            target: { kind: 'Pod', name: peer.name, namespace: peer.namespace, status: peer.status },
            relation: 'PEER_ON_NODE',
            details: `Co-located on node ${nodeName}; peer pod is also in ${peer.status} state`,
            isImpacted: true
          });
        }
      }
    }

    // 4. Mounted PVCs
    const volumes = (spec.volumes as any[]) || [];
    for (const vol of volumes) {
      const claimName = vol.persistentVolumeClaim?.claimName || vol.claimName;
      if (claimName) {
        const pvcResource = allResources.find(
          (r) =>
            r.kind === 'PersistentVolumeClaim' &&
            r.name.toLowerCase() === claimName.toLowerCase() &&
            (r.namespace || 'default').toLowerCase() === targetNs.toLowerCase()
        );

        const isPvcFailing = pvcResource && pvcResource.status !== 'Bound';
        relationships.push({
          source: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
          target: {
            kind: 'PersistentVolumeClaim',
            name: claimName,
            namespace: targetNs,
            status: pvcResource?.status || 'Unknown'
          },
          relation: 'MOUNTS_PVC',
          details: `Mounts PVC ${claimName} (phase: ${pvcResource?.status || 'Unknown'})`,
          isImpacted: Boolean(isPvcFailing)
        });

        // 5. StorageClass for PVC
        const storageClassName =
          pvcResource?.specSummary?.storageClassName || (pvcResource as any)?.storageClass;
        if (storageClassName) {
          relationships.push({
            source: { kind: 'PersistentVolumeClaim', name: claimName, namespace: targetNs, status: pvcResource?.status },
            target: { kind: 'StorageClass', name: storageClassName, status: 'Active' },
            relation: 'BACKED_BY_STORAGE_CLASS',
            details: `PVC ${claimName} uses StorageClass ${storageClassName}`
          });
        }
      }
    }

    // 6. Exposing Services
    const services = allResources.filter(
      (r) => r.kind === 'Service' && (r.namespace || 'default').toLowerCase() === targetNs.toLowerCase()
    );
    for (const svc of services) {
      const selector = svc.specSummary?.selector;
      if (selector && typeof selector === 'object') {
        // If pod has labels that match service selector
        const podLabels = spec.labels || {};
        let matches = true;
        for (const [k, v] of Object.entries(selector)) {
          if (podLabels[k] !== v) {
            matches = false;
            break;
          }
        }
        if (matches && Object.keys(selector).length > 0) {
          relationships.push({
            source: { kind: 'Service', name: svc.name, namespace: targetNs, status: svc.status },
            target: { kind: 'Pod', name: targetName, namespace: targetNs, status: target.status },
            relation: 'EXPOSED_BY_SERVICE',
            details: `Service ${svc.name} routes traffic to this pod`,
            isImpacted: target.health === 'CRITICAL'
          });
        }
      }
    }
  } else if (['Deployment', 'StatefulSet', 'DaemonSet'].includes(targetKind)) {
    // Controller target -> discover child pods
    const childPods = allResources.filter(
      (r) =>
        r.kind === 'Pod' &&
        (r.namespace || 'default').toLowerCase() === targetNs.toLowerCase() &&
        (r.ownerReferences?.some((ref) => ref.name === targetName || ref.name.startsWith(targetName + '-')) ||
          r.name.startsWith(targetName + '-'))
    );

    for (const pod of childPods.slice(0, 5)) {
      relationships.push({
        source: { kind: targetKind, name: targetName, namespace: targetNs, status: target.status },
        target: { kind: 'Pod', name: pod.name, namespace: targetNs, status: pod.status },
        relation: 'CONTROLS_POD',
        details: `Manages replica pod ${pod.name} (status: ${pod.status})`,
        isImpacted: pod.health === 'CRITICAL'
      });
    }
  } else if (targetKind === 'PersistentVolumeClaim') {
    // PVC target -> discover pods mounting this PVC
    const mountingPods = allResources.filter((r) => {
      if (r.kind !== 'Pod' || (r.namespace || 'default').toLowerCase() !== targetNs.toLowerCase()) return false;
      const volumes = (r.specSummary?.volumes as any[]) || [];
      return Array.isArray(volumes) && volumes.some((v: any) => v.persistentVolumeClaim?.claimName === targetName || v.claimName === targetName);
    });

    for (const pod of mountingPods.slice(0, 5)) {
      relationships.push({
        source: { kind: 'Pod', name: pod.name, namespace: targetNs, status: pod.status },
        target: { kind: 'PersistentVolumeClaim', name: targetName, namespace: targetNs, status: target.status },
        relation: 'MOUNTS_PVC',
        details: `Pod ${pod.name} requires this PVC to run`,
        isImpacted: target.status !== 'Bound'
      });
    }
  }

  return relationships;
}

/**
 * Extracts normalized, categorized signals from raw telemetry, container statuses,
 * events, conditions, and observability metrics.
 *
 * Distinguishes strictly between:
 *  - FACT: Raw observed states (exit code, reason, condition status, event text)
 *  - DERIVED_FACT: Computed mathematical metrics (restart frequency, resource limit ratio, available replicas ratio)
 *  - INFERENCE: Initial deduced cross-resource linkages (e.g. node memory pressure coinciding with pod OOM)
 */
export function extractCorrelatedSignals(
  target: KubernetesResource,
  allResources: KubernetesResource[],
  metrics?: {
    cpuUsage?: number;
    cpuLimit?: number;
    cpuRequest?: number;
    memUsageBytes?: number;
    memLimitBytes?: number;
    memRequestBytes?: number;
  }
): CorrelatedSignal[] {
  const signals: CorrelatedSignal[] = [];
  const targetNs = target.namespace || 'default';
  const now = Date.now();

  // 1. Raw Container Facts
  if (target.containers && target.containers.length > 0) {
    for (const c of target.containers) {
      if (c.exitCode !== undefined) {
        signals.push({
          id: `fact-exit-code-${c.name}`,
          category: 'FACT',
          source: 'kubelet',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `containers.${c.name}.exitCode`,
          value: c.exitCode,
          description: `Container "${c.name}" terminated with exit code ${c.exitCode}`,
          timestamp: target.updatedAt || now,
          weight: 5
        });
      }

      if (c.terminationReason) {
        signals.push({
          id: `fact-termination-reason-${c.name}`,
          category: 'FACT',
          source: 'kubelet',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `containers.${c.name}.terminationReason`,
          value: c.terminationReason,
          description: `Container "${c.name}" termination reason: ${c.terminationReason}`,
          timestamp: target.updatedAt || now,
          weight: 5
        });
      }

      if (c.waitingReason) {
        signals.push({
          id: `fact-waiting-reason-${c.name}`,
          category: 'FACT',
          source: 'kubelet',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `containers.${c.name}.waitingReason`,
          value: c.waitingReason,
          description: `Container "${c.name}" is waiting: ${c.waitingReason}${c.waitingMessage ? ` (${c.waitingMessage})` : ''}`,
          timestamp: target.updatedAt || now,
          weight: 5
        });
      }

      if (c.restartCount !== undefined && c.restartCount > 0) {
        signals.push({
          id: `derived-restart-count-${c.name}`,
          category: 'DERIVED_FACT',
          source: 'engine',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `containers.${c.name}.restartCount`,
          value: c.restartCount,
          description: `Container "${c.name}" has restarted ${c.restartCount} times`,
          timestamp: target.updatedAt || now,
          weight: c.restartCount > 5 ? 4 : 2
        });
      }

      if (c.image) {
        signals.push({
          id: `fact-container-image-${c.name}`,
          category: 'FACT',
          source: 'spec',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `containers.${c.name}.image`,
          value: c.image,
          description: `Container "${c.name}" configured with image "${c.image}"`,
          timestamp: target.createdAt || now,
          weight: 3
        });
      }
    }
  }

  // 2. Kubelet Warning & Normal Events (FACTS)
  if (target.events && target.events.length > 0) {
    for (let i = 0; i < target.events.length; i++) {
      const e = target.events[i];
      signals.push({
        id: `fact-event-${i}-${e.reason}`,
        category: 'FACT',
        source: 'events',
        resourceKind: target.kind,
        resourceName: target.name,
        namespace: targetNs,
        property: `events[${e.reason}]`,
        value: { reason: e.reason, type: e.type, count: e.count },
        description: `K8s ${e.type || 'Warning'} event "${e.reason}": ${e.message}`,
        timestamp: e.timestamp || now,
        weight: e.type === 'Warning' ? 4 : 2
      });
    }
  }

  // 3. Condition Statuses (FACTS)
  if (target.conditions && target.conditions.length > 0) {
    for (const cond of target.conditions) {
      if (cond.status === 'False' || cond.type === 'MemoryPressure' || cond.type === 'DiskPressure') {
        signals.push({
          id: `fact-condition-${cond.type}`,
          category: 'FACT',
          source: 'status',
          resourceKind: target.kind,
          resourceName: target.name,
          namespace: targetNs,
          property: `conditions[${cond.type}]`,
          value: { status: cond.status, reason: cond.reason },
          description: `Condition ${cond.type} is ${cond.status}${cond.reason ? ` (Reason: ${cond.reason})` : ''}${cond.message ? ` - ${cond.message}` : ''}`,
          timestamp: target.updatedAt || now,
          weight: 3
        });
      }
    }
  }

  // 4. Observability Metrics (DERIVED_FACTS)
  if (metrics) {
    if (metrics.memUsageBytes && metrics.memLimitBytes && metrics.memLimitBytes > 0) {
      const memPct = Math.round((metrics.memUsageBytes / metrics.memLimitBytes) * 100);
      signals.push({
        id: 'derived-metric-memory-saturation',
        category: 'DERIVED_FACT',
        source: 'metrics',
        resourceKind: target.kind,
        resourceName: target.name,
        namespace: targetNs,
        property: 'metrics.memoryUtilizationPercentage',
        value: memPct,
        description: `Memory utilization is at ${memPct}% of configured limit (${Math.round(metrics.memUsageBytes / (1024 * 1024))}Mi / ${Math.round(metrics.memLimitBytes / (1024 * 1024))}Mi)`,
        timestamp: now,
        weight: memPct >= 95 ? 5 : 3
      });
    }

    if (metrics.cpuUsage && metrics.cpuLimit && metrics.cpuLimit > 0) {
      const cpuPct = Math.round((metrics.cpuUsage / metrics.cpuLimit) * 100);
      signals.push({
        id: 'derived-metric-cpu-saturation',
        category: 'DERIVED_FACT',
        source: 'metrics',
        resourceKind: target.kind,
        resourceName: target.name,
        namespace: targetNs,
        property: 'metrics.cpuUtilizationPercentage',
        value: cpuPct,
        description: `CPU utilization is at ${cpuPct}% of configured limit (${metrics.cpuUsage}m / ${metrics.cpuLimit}m)`,
        timestamp: now,
        weight: cpuPct >= 95 ? 4 : 2
      });
    }
  }

  // 5. Workload Replica Status (DERIVED_FACTS)
  if (['Deployment', 'StatefulSet'].includes(target.kind)) {
    const spec = target.specSummary || {};
    const status = target.statusSummary || {};
    const desired = spec.replicas ?? 1;
    const available = status.availableReplicas ?? status.readyReplicas ?? 0;
    if (available < desired) {
      signals.push({
        id: 'derived-workload-replica-deficit',
        category: 'DERIVED_FACT',
        source: 'engine',
        resourceKind: target.kind,
        resourceName: target.name,
        namespace: targetNs,
        property: 'status.replicaAvailability',
        value: { desired, available },
        description: `Workload replica availability deficit: ${available}/${desired} ready replicas`,
        timestamp: target.updatedAt || now,
        weight: available === 0 ? 5 : 3
      });
    }
  }

  // 6. Cross-Resource Inferences
  const nodeName = target.specSummary?.nodeName || (target as any).nodeName;
  if (nodeName) {
    const nodeResource = allResources.find(
      (r) => r.kind === 'Node' && r.name.toLowerCase() === nodeName.toLowerCase()
    );
    if (nodeResource) {
      const hasNodeMemPressure = nodeResource.conditions?.some(
        (c) => c.type === 'MemoryPressure' && c.status === 'True'
      );
      if (hasNodeMemPressure) {
        signals.push({
          id: 'inference-node-memory-pressure-correlation',
          category: 'INFERENCE',
          source: 'engine',
          resourceKind: 'Node',
          resourceName: nodeName,
          property: 'conditions.MemoryPressure',
          value: 'True',
          description: `Node "${nodeName}" is under MemoryPressure, correlating directly with pod memory eviction/contention`,
          timestamp: now,
          weight: 5
        });
      }

      const isNodeNotReady = nodeResource.conditions?.some(
        (c) => c.type === 'Ready' && c.status !== 'True'
      );
      if (isNodeNotReady) {
        signals.push({
          id: 'inference-node-unready-correlation',
          category: 'INFERENCE',
          source: 'engine',
          resourceKind: 'Node',
          resourceName: nodeName,
          property: 'conditions.Ready',
          value: 'False',
          description: `Node "${nodeName}" is NotReady, causing scheduled workloads to enter Degraded or Unknown state`,
          timestamp: now,
          weight: 5
        });
      }
    }
  }

  return signals;
}

/**
 * Merges events, state transitions, and diagnostic logs into a clean,
 * chronologically sorted timeline with full 7-tier provenance tagging.
 */
export function buildCorrelatedTimeline(
  target: KubernetesResource,
  allResources: KubernetesResource[],
  signals: CorrelatedSignal[]
): CorrelatedTimelineEvent[] {
  const timeline: CorrelatedTimelineEvent[] = [];
  const targetNs = target.namespace || 'default';

  // Include target resource events
  if (target.events && target.events.length > 0) {
    for (let idx = 0; idx < target.events.length; idx++) {
      const e = target.events[idx];
      timeline.push({
        id: `event-${idx}-${e.reason}-${e.timestamp || 0}`,
        timestamp: e.timestamp || target.createdAt || Date.now(),
        title: `${e.reason} (${e.type || 'Warning'})`,
        category: 'FACT',
        description: e.message,
        source: 'kubelet',
        resourceKind: target.kind,
        resourceName: target.name
      });
    }
  }

  // Include correlated node events if pod is scheduled on a node
  const nodeName = target.specSummary?.nodeName || (target as any).nodeName;
  if (nodeName) {
    const nodeResource = allResources.find(
      (r) => r.kind === 'Node' && r.name.toLowerCase() === nodeName.toLowerCase()
    );
    if (nodeResource && nodeResource.events) {
      for (let idx = 0; idx < nodeResource.events.length; idx++) {
        const ne = nodeResource.events[idx];
        if (ne.type === 'Warning' || ne.reason === 'NodeNotReady' || ne.reason === 'EvictionThresholdMet') {
          timeline.push({
            id: `node-event-${idx}-${ne.reason}`,
            timestamp: ne.timestamp || Date.now(),
            title: `Node ${nodeName}: ${ne.reason}`,
            category: 'FACT',
            description: ne.message,
            source: 'kubelet-node',
            resourceKind: 'Node',
            resourceName: nodeName
          });
        }
      }
    }
  }

  // Include key inferred or derived facts from signals
  for (const sig of signals) {
    if (sig.category === 'INFERENCE' || (sig.category === 'DERIVED_FACT' && (sig.weight || 0) >= 4)) {
      timeline.push({
        id: `sig-${sig.id}`,
        timestamp: sig.timestamp,
        title: sig.property,
        category: sig.category,
        description: sig.description,
        source: sig.source,
        resourceKind: sig.resourceKind,
        resourceName: sig.resourceName
      });
    }
  }

  // Sort strictly chronological ascending
  timeline.sort((a, b) => a.timestamp - b.timestamp);

  return timeline;
}
