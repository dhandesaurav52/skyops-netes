import {
  IncidentSeverity,
  IncidentType,
  KubernetesResource,
  TechnicalDetails
} from '../../src/types/index';

export interface DetectionResult {
  detected: boolean;
  incidentType: IncidentType;
  title: string;
  severity: IncidentSeverity;
  technicalDetails: TechnicalDetails;
}

export interface RecoveryResult {
  recovered: boolean;
  reason: string;
}

/**
 * Deterministic Incident Rule Engine
 * Evaluates observed Kubernetes resources and produces standardized diagnostic results without non-deterministic or LLM logic.
 */
export class IncidentDetector {
  /**
   * Determines whether a resource is part of the SkyOps telemetry agent infrastructure.
   * Agent components are monitored through dedicated cluster connectivity and heartbeats,
   * not as customer workload incident tickets.
   */
  public static isAgentInfrastructure(resource: KubernetesResource): boolean {
    if (!resource) return false;
    const ns = (resource.namespace || '').toLowerCase();
    const name = (resource.name || '').toLowerCase();

    // The official SkyOps agent namespace is skyops-system (or skyops)
    if (ns === 'skyops-system' || ns === 'skyops') {
      return true;
    }

    // Workload explicitly named or prefixed as skyops-agent
    if (name === 'skyops-agent' || name.startsWith('skyops-agent-')) {
      return true;
    }

    const appLabel = resource.specSummary?.['app.kubernetes.io/name'] || (resource as any).labels?.['app.kubernetes.io/name'];
    const partOfLabel = resource.specSummary?.['app.kubernetes.io/part-of'] || (resource as any).labels?.['app.kubernetes.io/part-of'];

    if (appLabel === 'skyops-agent' || partOfLabel === 'skyops') {
      return true;
    }

    return false;
  }

  /**
   * Evaluate a single resource observation
   */
  public static evaluateResource(resource: KubernetesResource): DetectionResult | null {
    // Never flag SkyOps telemetry agent infrastructure as customer incident tickets
    if (this.isAgentInfrastructure(resource)) {
      return null;
    }

    let result: DetectionResult | null;
    switch (resource.kind) {
      case 'Pod':
        result = this.evaluatePod(resource); break;
      case 'Node':
        result = this.evaluateNode(resource); break;
      case 'Deployment':
        result = this.evaluateDeployment(resource); break;
      case 'StatefulSet':
        result = this.evaluateStatefulSet(resource); break;
      case 'DaemonSet':
        result = this.evaluateDaemonSet(resource); break;
      case 'Job':
        result = this.evaluateJob(resource); break;
      case 'PersistentVolumeClaim':
      case 'PVC':
        result = this.evaluatePVC(resource); break;
      case 'Service':
        result = this.evaluateService(resource); break;
      default:
        result = null;
    }
    return result ? this.withInvestigation(resource, result) : null;
  }

  private static withInvestigation(resource: KubernetesResource, result: DetectionResult): DetectionResult {
    const details = result.technicalDetails;
    const message = String(details.message || 'No diagnostic message was provided by Kubernetes.');
    const eventText = (resource.events || []).map(event => `${event.reason} ${event.message}`).join('\n');
    const evidenceText = `${message}\n${eventText}`;
    let rootCause = 'Root cause undetermined';
    let rootCauseCategory = 'UNDETERMINED';
    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
    let recommendation = 'Inspect current Kubernetes events, resource status, and dependent resources before remediation.';
    if (result.incidentType === 'ImagePullBackOff' || result.incidentType === 'ErrImagePull' || result.incidentType === 'InvalidImageName') {
      if (/401|unauthorized|authentication required|\bdenied\b|pull access denied/i.test(evidenceText)) {
        rootCauseCategory = 'REGISTRY_AUTH'; rootCause = 'Container registry authentication failure.'; confidence = 'HIGH'; recommendation = 'Verify imagePullSecrets, registry credentials, and repository permissions.';
      } else if (/notfound|not found|manifest unknown|failed to resolve|image not found/i.test(evidenceText)) {
        rootCauseCategory = 'IMAGE_PULL'; rootCause = 'The configured container image/tag could not be found in the container registry.'; confidence = 'HIGH'; recommendation = 'Verify the container image repository and tag, then redeploy the workload with a valid image.';
      } else { rootCauseCategory = 'IMAGE_PULL'; rootCause = 'Container image pull is failing; the exact registry cause is undetermined.'; confidence = 'MEDIUM'; recommendation = 'Verify the image repository and tag, registry reachability, and image-pull credentials.'; }
    } else if (result.incidentType === 'OOMKilled') {
      rootCauseCategory = 'OOM'; rootCause = 'Container exceeded its memory limit.'; confidence = 'HIGH'; recommendation = 'Review memory usage and increase the container memory limit only if appropriate.';
    } else if (result.incidentType === 'CrashLoopBackOff') {
      rootCauseCategory = 'CRASH'; rootCause = 'Container is repeatedly terminating with a non-zero exit code.'; confidence = 'HIGH'; recommendation = 'Inspect container logs and the application configuration, then correct the failing process before redeploying.';
    } else if (result.incidentType === 'PVCPending') {
      if (/storageclass(?:\.storage\.k8s\.io)? .*not found|storage class .*not found|storageclass.*does not exist/i.test(evidenceText)) { rootCauseCategory = 'STORAGE_CLASS'; rootCause = 'Referenced StorageClass does not exist.'; confidence = 'HIGH'; recommendation = 'Create the referenced StorageClass or update the PVC to use an available StorageClass.'; }
      else if (/waitforfirstconsumer|waiting for first consumer|waiting for a pod to be scheduled/i.test(evidenceText)) { rootCauseCategory = 'WAITING_FOR_CONSUMER'; rootCause = 'PVC is waiting for a consuming pod before volume provisioning.'; confidence = 'HIGH'; recommendation = 'Schedule a consuming pod; provisioning will continue after the scheduler selects a node.'; }
      else if (/provisioning failed|failed to provision|provisioner/i.test(evidenceText)) { rootCauseCategory = 'STORAGE_PROVISIONING'; rootCause = message; confidence = 'HIGH'; recommendation = 'Inspect the storage provisioner, StorageClass parameters, and the provider error before retrying.'; }
    } else if (result.incidentType === 'PodSchedulingFailed') {
      rootCauseCategory = 'SCHEDULING'; confidence = 'HIGH'; recommendation = 'Adjust workload requests or scheduling constraints, or add compatible cluster capacity.';
      if (/insufficient cpu/i.test(evidenceText)) rootCause = 'Pod cannot be scheduled because the cluster has insufficient CPU.';
      else if (/insufficient memory/i.test(evidenceText)) rootCause = 'Pod cannot be scheduled because the cluster has insufficient memory.';
      else if (/node selector|didn.t match node selector/i.test(evidenceText)) rootCause = 'Pod node selector does not match any eligible node.';
      else if (/taint|toleration/i.test(evidenceText)) rootCause = 'Pod cannot be scheduled because it does not tolerate an eligible node taint.';
      else if (/affinity|anti-affinity/i.test(evidenceText)) rootCause = 'Pod affinity or anti-affinity constraints cannot be satisfied.';
    } else if (result.incidentType === 'ReadinessProbeFailed' || result.incidentType === 'LivenessProbeFailed' || result.incidentType === 'StartupProbeFailed') {
      rootCause = 'Probe failure is currently observed; application-level cause is undetermined.'; confidence = 'MEDIUM'; recommendation = 'Inspect the probe endpoint, container logs, and recent deployment changes.';
    } else if (result.incidentType === 'DeploymentDegraded') { rootCause = 'Deployment does not currently have the requested available replicas.'; confidence = 'HIGH'; recommendation = 'Inspect owned ReplicaSets and Pods to identify the blocking workload failure.'; }
    return { ...result, technicalDetails: { ...details, resourceUid: resource.uid || resource.id, observedState: resource.status, rootCause, rootCauseCategory, impact: result.severity === 'CRITICAL' || result.severity === 'HIGH' ? 'The affected workload or infrastructure component is unavailable or degraded.' : 'A localized component is degraded.', recommendation, recommendedAction: recommendation, confidence, relatedResources: (resource.ownerReferences || []).map(owner => ({ kind: owner.kind || 'Unknown', namespace: resource.namespace, name: owner.name || 'unknown', uid: owner.uid, relationship: 'owner' })), evidence: [{ source: 'kubernetes-status', reason: String(details.reason || result.incidentType), message }, ...(resource.events || []).slice(-5).map(event => ({ source: 'kubernetes-event', reason: event.reason, message: event.message, timestamp: event.timestamp }))] } };
  }

  /**
   * Pod Rule Evaluation
   */
  private static evaluatePod(resource: KubernetesResource): DetectionResult | null {
    const containers = resource.containers || [];
    const events = resource.events || [];

    // Image failures have precedence over generic BackOff wording in events.
    for (const c of containers) {
      const isImageError = c.waitingReason === 'ImagePullBackOff' || c.waitingReason === 'ErrImagePull' || c.waitingReason === 'InvalidImageName' || resource.status === 'ImagePullBackOff' || resource.status === 'ErrImagePull' || resource.status === 'InvalidImageName';
      if (isImageError) return this.imagePullResult(resource, c, containers, events);
    }

    // OOM termination is more specific than a crash loop.
    for (const c of containers) {
      if (c.terminationReason === 'OOMKilled' || c.lastTerminationReason === 'OOMKilled' || c.exitCode === 137 || c.lastExitCode === 137) {
        return { detected: true, incidentType: 'OOMKilled', title: `Container ${c.name} in pod ${resource.name} was OOMKilled (Exit Code ${c.exitCode ?? c.lastExitCode ?? 137})`, severity: 'HIGH', technicalDetails: { podName: resource.name, containerName: c.name, image: c.image, restartCount: c.restartCount, exitCode: c.exitCode ?? c.lastExitCode ?? 137, reason: 'OOMKilled', message: `Container exceeded its memory limit${c.memoryLimit ? ` (${c.memoryLimit})` : ''} and was killed by the Linux OOM killer`, nodeName: String(resource.specSummary?.nodeName || 'unknown'), containers, conditions: resource.conditions, events } };
      }
    }

    // CrashLoopBackOff requires actual repeated non-zero termination evidence; an event saying BackOff alone is insufficient.
    for (const c of containers) {
      const exitCode = c.exitCode ?? c.lastExitCode;
      const terminationReason = c.terminationReason ?? c.lastTerminationReason;
      if (
        c.waitingReason === 'CrashLoopBackOff' && c.restartCount > 0 &&
        exitCode !== undefined && exitCode !== 0 && terminationReason !== 'OOMKilled'
      ) {
        return {
          detected: true,
          incidentType: 'CrashLoopBackOff',
          title: `Pod ${resource.name} is in CrashLoopBackOff (Container: ${c.name}, ${c.restartCount} restarts)`,
          severity: c.restartCount > 5 ? 'HIGH' : 'MEDIUM',
          technicalDetails: {
            podName: resource.name,
            containerName: c.name,
            image: c.image,
            restartCount: c.restartCount,
            exitCode,
            reason: terminationReason || c.waitingReason,
            message: c.waitingMessage || `Container ${c.name} is restarting repeatedly (exit code: ${exitCode})`,
            nodeName: String(resource.specSummary?.nodeName || 'unknown'),
            containers,
            conditions: resource.conditions,
            events
          }
        };
      }
    }

    // 2. Check for container creation errors
    for (const c of containers) {
      if (c.waitingReason === 'CreateContainerConfigError' || c.waitingReason === 'CreateContainerError') {
        return {
          detected: true,
          incidentType: c.waitingReason,
          title: `Container creation failed in pod ${resource.name} (${c.waitingReason}: ${c.name})`,
          severity: 'HIGH',
          technicalDetails: { podName: resource.name, containerName: c.name, image: c.image, reason: c.waitingReason, message: c.waitingMessage || `Kubernetes could not create container ${c.name}`, nodeName: String(resource.specSummary?.nodeName || 'unknown'), containers, conditions: resource.conditions, events }
        };
      }
    }

    // Fallback if containers list was empty but pod status itself indicates crash/image failure
    if (resource.status === 'ImagePullBackOff' || resource.status === 'ErrImagePull') {
      return {
        detected: true,
        incidentType: 'ImagePullBackOff',
        title: `Image pull failure in pod ${resource.name}`,
        severity: 'HIGH',
        technicalDetails: {
          podName: resource.name,
          reason: resource.status,
          message: `Pod ${resource.name} failed to pull container image`,
          nodeName: String(resource.specSummary?.nodeName || 'unknown'),
          containers,
          conditions: resource.conditions,
          events
        }
      };
    }

    const schedulingEvent = events.find(event => event.reason === 'FailedScheduling' && /insufficient cpu|insufficient memory|node selector|taint|toleration|affinity/i.test(event.message));
    if (resource.status === 'Pending' && schedulingEvent) return { detected: true, incidentType: 'PodSchedulingFailed', title: `Pod ${resource.name} cannot be scheduled`, severity: 'MEDIUM', technicalDetails: { podName: resource.name, reason: schedulingEvent.reason, message: schedulingEvent.message, nodeName: String(resource.specSummary?.nodeName || 'unknown'), containers, conditions: resource.conditions, events } };

    // Events are historical. A warning alone is not a current outage: only raise
    // a probe incident when it is recent *and* the current PodReady condition is false.
    const podReady = (resource.conditions || []).find((c) => c.type === 'Ready')?.status === 'True';
    const recentEvents = events.filter((evt) => evt.timestamp > 0 && evt.timestamp >= resource.updatedAt - 5 * 60 * 1000);
    // 4. Check current probe failures backed by recent events
    for (const evt of recentEvents) {
      if (!podReady && evt.type === 'Warning' && evt.reason === 'Unhealthy') {
        if (evt.message.toLowerCase().includes('liveness probe')) {
          return {
            detected: true,
            incidentType: 'LivenessProbeFailed',
            title: `Liveness probe failure in pod ${resource.name}`,
            severity: 'HIGH',
            technicalDetails: {
              podName: resource.name,
              message: evt.message,
              reason: 'Unhealthy',
              containers,
              conditions: resource.conditions,
              events
            }
          };
        }
        if (evt.message.toLowerCase().includes('readiness probe')) {
          return {
            detected: true,
            incidentType: 'ReadinessProbeFailed',
            title: `Readiness probe failure in pod ${resource.name}`,
            severity: 'MEDIUM',
            technicalDetails: {
              podName: resource.name,
              message: evt.message,
              reason: 'Unhealthy',
              containers,
              conditions: resource.conditions,
              events
            }
          };
        }
      }
    }

    // 5. Pod Failed phase
    if (resource.status === 'Failed') {
      return {
        detected: true,
        incidentType: 'PodFailed',
        title: `Pod ${resource.name} entered Failed phase`,
        severity: 'HIGH',
        technicalDetails: {
          podName: resource.name,
          reason: 'PodFailed',
          message: 'All containers in the Pod have terminated, and at least one container has terminated in failure',
          containers,
          conditions: resource.conditions,
          events
        }
      };
    }

    return null;
  }

  private static imagePullResult(resource: KubernetesResource, c: NonNullable<KubernetesResource['containers']>[number], containers: NonNullable<KubernetesResource['containers']>, events: NonNullable<KubernetesResource['events']>): DetectionResult {
    return { detected: true, incidentType: 'ImagePullBackOff', title: `Image pull failure in pod ${resource.name} (${c.waitingReason || resource.status}: ${c.name})`, severity: 'HIGH', technicalDetails: { podName: resource.name, containerName: c.name, image: c.image, reason: c.waitingReason || resource.status || 'ImagePullBackOff', message: c.waitingMessage || `Failed to pull container image ${c.image}`, nodeName: String(resource.specSummary?.nodeName || 'unknown'), containers, conditions: resource.conditions, events } };
  }

  /**
   * Node Rule Evaluation
   */
  private static evaluateNode(resource: KubernetesResource): DetectionResult | null {
    const conditions = resource.conditions || [];
    const events = resource.events || [];

    // Check Ready condition
    const readyCondition = conditions.find((c) => c.type === 'Ready');
    if (readyCondition && (readyCondition.status === 'False' || readyCondition.status === 'Unknown')) {
      return {
        detected: true,
        incidentType: 'NodeNotReady',
        title: `Node ${resource.name} is NotReady (${readyCondition.reason || 'KubeletNotReady'})`,
        severity: 'CRITICAL',
        technicalDetails: {
          nodeName: resource.name,
          reason: readyCondition.reason || 'NodeNotReady',
          message: readyCondition.message || `Node condition Ready is ${readyCondition.status}`,
          conditions,
          events
        }
      };
    }

    // Check Pressure conditions
    const memoryPressure = conditions.find((c) => c.type === 'MemoryPressure');
    if (memoryPressure && memoryPressure.status === 'True') {
      return {
        detected: true,
        incidentType: 'NodeMemoryPressure',
        title: `Node ${resource.name} is experiencing MemoryPressure`,
        severity: 'HIGH',
        technicalDetails: {
          nodeName: resource.name,
          reason: memoryPressure.reason || 'MemoryPressure',
          message: memoryPressure.message || 'Node available memory is below threshold',
          conditions,
          events
        }
      };
    }

    const diskPressure = conditions.find((c) => c.type === 'DiskPressure');
    if (diskPressure && diskPressure.status === 'True') {
      return {
        detected: true,
        incidentType: 'NodeDiskPressure',
        title: `Node ${resource.name} is experiencing DiskPressure`,
        severity: 'HIGH',
        technicalDetails: {
          nodeName: resource.name,
          reason: diskPressure.reason || 'DiskPressure',
          message: diskPressure.message || 'Node root filesystem disk capacity is low',
          conditions,
          events
        }
      };
    }

    const pidPressure = conditions.find((c) => c.type === 'PIDPressure');
    if (pidPressure && pidPressure.status === 'True') {
      return {
        detected: true,
        incidentType: 'NodePIDPressure',
        title: `Node ${resource.name} is experiencing PIDPressure`,
        severity: 'HIGH',
        technicalDetails: {
          nodeName: resource.name,
          reason: pidPressure.reason || 'PIDPressure',
          message: pidPressure.message || 'Node available process IDs are exhausted',
          conditions,
          events
        }
      };
    }

    return null;
  }

  /**
   * Deployment Rule Evaluation
   */
  private static evaluateDeployment(resource: KubernetesResource): DetectionResult | null {
    if (this.isAgentInfrastructure(resource)) {
      return null;
    }

    const desired = Number(resource.specSummary?.replicas ?? 1);
    const ready = Number(resource.statusSummary?.readyReplicas ?? resource.statusSummary?.availableReplicas ?? 0);
    const available = Number(resource.statusSummary?.availableReplicas ?? resource.statusSummary?.readyReplicas ?? 0);
    const updated = Number(resource.statusSummary?.updatedReplicas ?? ready);
    const conditions = resource.conditions || [];
    const events = resource.events || [];

    // Check Kubernetes Deployment Conditions
    const isAvailableCondition = conditions.some((c) => c.type === 'Available' && (c.status === 'True' || c.status === 'true'));

    // In Kubernetes, Progressing=True indicates an active rollout in progress (e.g. ReplicaSetUpdated, NewReplicaSetCreated, NewReplicaSetAvailable)
    const progressingCondition = conditions.find((c) => c.type === 'Progressing');
    const isProgressingHealthy = progressingCondition ? (progressingCondition.status === 'True' || progressingCondition.status === 'true') : false;

    // Explicit failure conditions in Kubernetes:
    // 1. ProgressDeadlineExceeded: The deployment failed to make progress within spec.progressDeadlineSeconds
    const isProgressDeadlineExceeded = conditions.some(
      (c) => c.type === 'Progressing' && (c.status === 'False' || c.status === 'false') && c.reason === 'ProgressDeadlineExceeded'
    );
    // 2. ReplicaFailure: Pod creation failed at the ReplicaSet level (e.g., quota exceeded)
    const isReplicaFailure = conditions.some(
      (c) => c.type === 'ReplicaFailure' && (c.status === 'True' || c.status === 'true')
    );

    // If Kubernetes explicitly marks the deployment as Available or ready >= desired, it is healthy
    if (isAvailableCondition || (ready >= desired && desired > 0) || (available >= desired && desired > 0)) {
      return null;
    }

    // Startup / Rollout Grace Period:
    // If the deployment was recently created or updated (e.g., within 5 minutes / 300,000ms)
    // and is actively progressing without progress deadline failure or replica failure,
    // Kubernetes is in the middle of standard pod scheduling and image pulling. This is NOT an incident.
    const ageMs = resource.createdAt ? Date.now() - resource.createdAt : 0;
    const isWithinRolloutGraceWindow = resource.createdAt ? ageMs < 300000 : false;
    const isInFlightStartup = isProgressingHealthy && !isProgressDeadlineExceeded && !isReplicaFailure && (isWithinRolloutGraceWindow || !resource.createdAt);

    if (isInFlightStartup && !isProgressDeadlineExceeded && !isReplicaFailure) {
      return null;
    }

    const isExplicitlyFailed = isProgressDeadlineExceeded || isReplicaFailure;

    if (desired > 0 && (isExplicitlyFailed || (!isInFlightStartup && (ready < desired || available < desired)))) {
      const isCompleteOutage = ready === 0 && available === 0;
      return {
        detected: true,
        incidentType: 'DeploymentDegraded',
        title: `Deployment ${resource.name} is degraded (${ready}/${desired} ready)`,
        severity: isCompleteOutage ? 'CRITICAL' : 'HIGH',
        technicalDetails: {
          desiredReplicas: desired,
          availableReplicas: available,
          readyReplicas: ready,
          updatedReplicas: updated,
          reason: isCompleteOutage ? 'DeploymentUnavailable' : 'DeploymentDegraded',
          message: isProgressDeadlineExceeded
            ? `Deployment ${resource.name} exceeded its progress deadline without reaching available replicas.`
            : isReplicaFailure
            ? `Deployment ${resource.name} encountered replica creation failure.`
            : `Expected ${desired} ready replicas, but currently only ${ready} are ready.`,
          conditions,
          events
        }
      };
    }

    return null;
  }

  /**
   * StatefulSet Rule Evaluation
   */
  private static evaluateStatefulSet(resource: KubernetesResource): DetectionResult | null {
    const desired = Number(resource.specSummary?.replicas ?? 1);
    const ready = Number(resource.statusSummary?.readyReplicas ?? 0);

    if (desired > 0 && ready < desired) {
      return {
        detected: true,
        incidentType: 'StatefulSetDegraded',
        title: `StatefulSet ${resource.name} replica mismatch (${ready}/${desired} ready)`,
        severity: 'HIGH',
        technicalDetails: {
          desiredReplicas: desired,
          readyReplicas: ready,
          reason: 'StatefulSetDegraded',
          message: `StatefulSet expects ${desired} ready replicas, current ready count is ${ready}`,
          conditions: resource.conditions,
          events: resource.events
        }
      };
    }
    return null;
  }

  /**
   * DaemonSet Rule Evaluation
   */
  private static evaluateDaemonSet(resource: KubernetesResource): DetectionResult | null {
    const desired = Number(resource.statusSummary?.desiredNumberScheduled ?? 1);
    const numberReady = Number(resource.statusSummary?.numberReady ?? 0);

    if (desired > 0 && numberReady < desired) {
      return {
        detected: true,
        incidentType: 'DaemonSetDegraded',
        title: `DaemonSet ${resource.name} is degraded (${numberReady}/${desired} nodes scheduled)`,
        severity: 'HIGH',
        technicalDetails: {
          desiredReplicas: desired,
          readyReplicas: numberReady,
          reason: 'DaemonSetDegraded',
          message: `DaemonSet is ready on ${numberReady} nodes out of ${desired} scheduled nodes`,
          conditions: resource.conditions,
          events: resource.events
        }
      };
    }
    return null;
  }

  /**
   * Job Rule Evaluation
   */
  private static evaluateJob(resource: KubernetesResource): DetectionResult | null {
    const failedCount = Number(resource.statusSummary?.failed ?? 0);
    const conditions = resource.conditions || [];

    const failedCondition = conditions.find((c) => c.type === 'Failed' && c.status === 'True');
    if (failedCondition || failedCount > 0) {
      return {
        detected: true,
        incidentType: 'JobFailed',
        title: `Batch Job ${resource.name} has failed`,
        severity: 'MEDIUM',
        technicalDetails: {
          reason: failedCondition?.reason || 'JobFailed',
          message: failedCondition?.message || `Job execution failed after ${failedCount} retries`,
          conditions,
          events: resource.events
        }
      };
    }
    return null;
  }

  /**
   * PVC Rule Evaluation
   */
  private static evaluatePVC(resource: KubernetesResource): DetectionResult | null {
    if (resource.status === 'Pending') {
      return {
        detected: true,
        incidentType: 'PVCPending',
        title: `PersistentVolumeClaim ${resource.name} is stuck in Pending`,
        severity: 'MEDIUM',
        technicalDetails: {
          pvcPhase: 'Pending',
          storageClass: String(resource.specSummary?.storageClassName || 'standard'),
          capacity: String(resource.specSummary?.capacity || 'unknown'),
          reason: 'PVCPending',
          message: 'PersistentVolumeClaim has not bound to a backing PersistentVolume',
          conditions: resource.conditions,
          events: resource.events
        }
      };
    }
    return null;
  }

  private static evaluateService(resource: KubernetesResource): DetectionResult | null {
    // ExternalName services never have endpoints
    if (
      resource.specSummary?.type === 'ExternalName' ||
      resource.statusSummary?.isExternalName === true
    ) {
      return null;
    }

    // If telemetry explicitly has not collected endpoints, do NOT guess or produce false positives
    const statusSummary = resource.statusSummary || {};
    const hasExplicitEndpointData =
      statusSummary.readyEndpoints !== undefined ||
      statusSummary.hasEndpointsObject !== undefined ||
      statusSummary.endpoints !== undefined;

    if (!hasExplicitEndpointData) {
      return null;
    }

    const readyEndpoints = Number(statusSummary.readyEndpoints ?? statusSummary.endpoints ?? 0);
    if (readyEndpoints > 0) {
      return null;
    }

    // Grace period for newly created services (< 45s)
    if (resource.createdAt && Date.now() - resource.createdAt < 45_000) {
      return null;
    }

    const selector = resource.specSummary?.selector as Record<string, string> | undefined;
    const hasSelector = selector && Object.keys(selector).length > 0;
    const matchingPodsCount = Number(statusSummary.matchingPodsCount ?? 0);
    const unreadyBackingPodsCount = Number(statusSummary.unreadyBackingPodsCount ?? 0);
    const notReadyEndpoints = Number(statusSummary.notReadyEndpoints ?? 0);
    const backingPodIncidentCount = Number(statusSummary.backingPodIncidentCount ?? 0);
    const isControlPlane =
      resource.statusSummary?.isControlPlaneService === true ||
      ((resource.namespace || '').toLowerCase() === 'default' && resource.name.toLowerCase() === 'kubernetes');
    const isKubeSystem = (resource.namespace || '').toLowerCase() === 'kube-system';

    // Case 1: Service has a selector
    if (hasSelector) {
      const hasBackingPods = matchingPodsCount > 0 || notReadyEndpoints > 0;

      if (hasBackingPods) {
        // Backing pods exist, but NONE of them are ready
        const severity: 'HIGH' | 'MEDIUM' | 'LOW' =
          backingPodIncidentCount > 0 || isKubeSystem ? 'MEDIUM' : 'HIGH';

        const unreadyPods = (statusSummary.unreadyPodDetails as any[]) || [];
        const unreadyReasons = unreadyPods
          .map((p) => `${p.name}: ${p.waitingReason || p.reason || p.phase}`)
          .slice(0, 3)
          .join(', ');

        return {
          detected: true,
          incidentType: 'ServiceBackingPodsNotReady',
          title: `Service ${resource.name} backing pods are not ready (${unreadyBackingPodsCount || notReadyEndpoints} unready)`,
          severity,
          technicalDetails: {
            reason: 'BackingPodsNotReady',
            message: `Service ${resource.name} matches ${matchingPodsCount || notReadyEndpoints} pod(s), but 0 are ready to receive traffic.${unreadyReasons ? ` [${unreadyReasons}]` : ''}`,
            selector,
            matchingPodsCount,
            unreadyBackingPodsCount: unreadyBackingPodsCount || notReadyEndpoints,
            unreadyPods,
            events: resource.events,
          },
        };
      } else {
        // Truly 0 matching pods exist for this selector
        const isOptionalKubeSystem =
          isKubeSystem &&
          (resource.name.toLowerCase().includes('cilium-envoy') ||
            resource.name.toLowerCase().includes('metrics-server'));

        const severity: 'HIGH' | 'MEDIUM' | 'LOW' = isOptionalKubeSystem
          ? 'LOW'
          : isKubeSystem
          ? 'MEDIUM'
          : 'HIGH';

        return {
          detected: true,
          incidentType: 'ServiceSelectorMismatch',
          title: `Service ${resource.name} has no matching pods for selector`,
          severity,
          technicalDetails: {
            reason: 'NoMatchingPods',
            message: `Service ${resource.name} selector does not match any existing pods in namespace ${resource.namespace || 'default'}.`,
            selector,
            events: resource.events,
          },
        };
      }
    }

    // Case 2: Service has NO selector
    if (isControlPlane) {
      return {
        detected: true,
        incidentType: 'ServiceNoEndpoints',
        title: `Kubernetes API Service (default/kubernetes) has no ready endpoints`,
        severity: 'CRITICAL',
        technicalDetails: {
          reason: 'ControlPlaneEndpointsMissing',
          message: `The cluster control plane API service (default/kubernetes) has 0 ready endpoints. The kube-apiserver endpoint is unreachable.`,
          events: resource.events,
        },
      };
    }

    return {
      detected: true,
      incidentType: 'ServiceNoEndpoints',
      title: `Service ${resource.name} has no ready endpoints`,
      severity: isKubeSystem ? 'LOW' : 'MEDIUM',
      technicalDetails: {
        reason: 'NoEndpoints',
        message: `Service ${resource.name} has no selector and 0 ready endpoints defined.`,
        events: resource.events,
      },
    };
  }

  /**
   * Deterministic Auto-Recovery Evaluation
   */
  public static evaluateRecovery(
    resource: KubernetesResource,
    incidentType: IncidentType
  ): RecoveryResult {
    switch (incidentType) {
      case 'CrashLoopBackOff':
      case 'ImagePullBackOff':
      case 'ErrImagePull':
      case 'InvalidImageName':
      case 'CreateContainerConfigError':
      case 'CreateContainerError':
      case 'OOMKilled':
      case 'PodFailed': {
        const containers = resource.containers || [];
        const allRunningAndReady =
          resource.status === 'Running' &&
          containers.length > 0 &&
          containers.every((c) => c.ready && c.state === 'running' && !c.waitingReason);
        if (allRunningAndReady) {
          return {
            recovered: true,
            reason: `Pod ${resource.name} is now Running and all containers are in Ready state`
          };
        }
        break;
      }
      case 'ReadinessProbeFailed':
      case 'LivenessProbeFailed':
      case 'StartupProbeFailed': {
        if (resource.status === 'Running' && (resource.conditions || []).some(c => c.type === 'Ready' && c.status === 'True')) return { recovered: true, reason: `Pod ${resource.name} is Ready and no longer has an active probe failure` };
        break;
      }
      case 'ServiceNoEndpoints':
      case 'ServiceSelectorMismatch':
      case 'ServiceBackingPodsNotReady': {
        const ready = Number(resource.statusSummary?.readyEndpoints ?? resource.statusSummary?.endpoints ?? 0);
        if (ready > 0) return { recovered: true, reason: `Service ${resource.name} has ready endpoints (${ready} ready)` };
        break;
      }
      case 'NodeNotReady':
      case 'NodeMemoryPressure':
      case 'NodeDiskPressure':
      case 'NodePIDPressure': {
        const conditions = resource.conditions || [];
        const readyCond = conditions.find((c) => c.type === 'Ready');
        const isReady = readyCond?.status === 'True';
        const memPress = conditions.find((c) => c.type === 'MemoryPressure')?.status === 'True';
        const diskPress = conditions.find((c) => c.type === 'DiskPressure')?.status === 'True';
        const pidPress = conditions.find((c) => c.type === 'PIDPressure')?.status === 'True';

        if (incidentType === 'NodeNotReady' && isReady) {
          return { recovered: true, reason: `Node ${resource.name} condition Ready transitioned to True` };
        }
        if (incidentType === 'NodeMemoryPressure' && !memPress) {
          return { recovered: true, reason: `Node ${resource.name} memory pressure has cleared` };
        }
        if (incidentType === 'NodeDiskPressure' && !diskPress) {
          return { recovered: true, reason: `Node ${resource.name} disk pressure has cleared` };
        }
        if (incidentType === 'NodePIDPressure' && !pidPress) {
          return { recovered: true, reason: `Node ${resource.name} PID pressure has cleared` };
        }
        break;
      }
      case 'DeploymentDegraded': {
        const desired = Number(resource.specSummary?.replicas ?? 1);
        const ready = Number(resource.statusSummary?.readyReplicas ?? resource.statusSummary?.availableReplicas ?? 0);
        const available = Number(resource.statusSummary?.availableReplicas ?? resource.statusSummary?.readyReplicas ?? 0);
        const conditions = resource.conditions || [];
        const isAvailableCondition = conditions.some((c) => c.type === 'Available' && (c.status === 'True' || c.status === 'true'));

        if (isAvailableCondition || (desired > 0 && (available >= desired || ready >= desired)) || resource.status === 'Available') {
          return {
            recovered: true,
            reason: `Deployment ${resource.name} replicas fully restored and marked Available`
          };
        }
        break;
      }
      case 'StatefulSetDegraded': {
        const desired = Number(resource.specSummary?.replicas ?? 1);
        const ready = Number(resource.statusSummary?.readyReplicas ?? 0);
        if (desired > 0 && ready >= desired) {
          return {
            recovered: true,
            reason: `StatefulSet ${resource.name} all ${ready} replicas are ready`
          };
        }
        break;
      }
      case 'PVCPending': {
        if (resource.status === 'Bound') {
          return {
            recovered: true,
            reason: `PersistentVolumeClaim ${resource.name} is now Bound to storage`
          };
        }
        break;
      }
    }

    return { recovered: false, reason: '' };
  }
}
