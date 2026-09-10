import { ProvenanceType } from '../common/Badges';

export interface StructuredTelemetrySignal {
  id: string;
  title: string;
  badgeLabel: string;
  category: ProvenanceType;
  subsystem: string;
  containerName?: string;
  image?: string;
  registry?: string;
  statusReason?: string;
  errorCode?: string;
  exitCode?: number;
  restartCount?: number;
  memoryLimit?: string;
  nodeName?: string;
  rawTrace: string;
  cleanSummary: string;
  sreInsight: string;
  timestamp?: string;
}

/**
 * Extracts structured attributes from raw Kubernetes error messages and CRI outputs.
 */
export function parseKubernetesError(raw: string, fallbackContainer?: string): {
  containerName?: string;
  image?: string;
  registry?: string;
  errorCode?: string;
  statusReason?: string;
  cleanMessage: string;
  sreInsight: string;
} {
  let containerName = fallbackContainer;
  let image: string | undefined;
  let registry: string | undefined;
  let errorCode: string | undefined;
  let statusReason: string | undefined;
  let cleanMessage = raw;
  let sreInsight = 'Kubernetes observed an unexpected resource condition.';

  // 1. Check for container prefix (e.g. "nginx: ImagePullBackOff — ...")
  const containerMatch = raw.match(/^([a-zA-Z0-9_-]+):\s*([A-Za-z0-9_-]+)\s*—?\s*(.*)$/);
  if (containerMatch) {
    containerName = containerMatch[1];
    statusReason = containerMatch[2];
    cleanMessage = containerMatch[3] || raw;
  }

  // 2. Extract image reference: e.g. "nginxbadimage" or "docker.io/library/nginxbadimage:latest"
  const imageMatch =
    raw.match(/image\s+"([^"]+)"/i) ||
    raw.match(/image\s+([^\s:]+:[^\s]+)/i) ||
    raw.match(/failed to resolve image:\s*([^\s:]+:[^\s]+)/i);
  if (imageMatch) {
    image = imageMatch[1];
    if (image.includes('/')) {
      const parts = image.split('/');
      registry = parts[0];
    } else {
      registry = 'docker.io (Docker Hub)';
    }
  }

  // 3. Extract RPC error code or HTTP code
  const rpcMatch = raw.match(/code\s*=\s*([A-Za-z0-9_]+)/i);
  if (rpcMatch) {
    errorCode = `rpc: ${rpcMatch[1]}`;
  } else if (raw.includes('ErrImagePull')) {
    errorCode = 'ErrImagePull';
  } else if (raw.includes('ImagePullBackOff')) {
    errorCode = 'ImagePullBackOff';
  } else if (raw.includes('OOMKilled') || raw.includes('137')) {
    errorCode = 'SIGKILL 137 (OOM)';
  } else if (raw.match(/exit code:?\s*(\d+)/i)) {
    const exitMatch = raw.match(/exit code:?\s*(\d+)/i);
    errorCode = `Exit Code ${exitMatch ? exitMatch[1] : 1}`;
  }

  // 4. Determine domain-specific SRE insights
  if (raw.toLowerCase().includes('not found') || raw.toLowerCase().includes('notfound')) {
    sreInsight =
      'Remote OCI container registry returned HTTP 404 (NotFound). The requested image tag or repository does not exist on Docker Hub or requires private pull credentials.';
  } else if (raw.toLowerCase().includes('oom') || raw.includes('137')) {
    sreInsight =
      'Process resident memory footprint breached the cgroup v2 memory.max limit. Host Linux kernel dispatched SIGKILL.';
  } else if (raw.toLowerCase().includes('crash') || raw.toLowerCase().includes('exit code')) {
    sreInsight =
      'Process PID 1 terminated immediately upon container launch. Kubelet engaged exponential restart back-off.';
  } else if (raw.toLowerCase().includes('schedul') || raw.toLowerCase().includes('nodes are available')) {
    sreInsight =
      'Control plane scheduler cannot place pod onto any candidate worker node due to resource exhaustion or taints.';
  } else if (raw.toLowerCase().includes('probe')) {
    sreInsight =
      'Container health probe check failed consecutively. Pod withheld from Service endpoints to isolate traffic.';
  }

  return {
    containerName,
    image,
    registry,
    errorCode,
    statusReason: statusReason || (raw.includes('ImagePull') ? 'ImagePullBackOff' : undefined),
    cleanMessage,
    sreInsight
  };
}
