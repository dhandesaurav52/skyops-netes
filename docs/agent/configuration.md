# Agent Configuration Reference

This document provides a comprehensive reference of all configuration options for the **SkyOps Agent (`skyops-agent` v1.5.0)**, covering environment variables, Helm values, tuning recommendations, and namespace isolation policies.

---

## Environment Variable Reference

The agent loads its configuration at boot via `agent/internal/config/config.go`.

### Required Parameters

| Variable | Type | Description |
| :--- | :--- | :--- |
| `SKYOPS_CLUSTER_ID` | String | Unique cluster identifier assigned by the SkyOps control plane upon cluster registration. |
| `SKYOPS_AGENT_TOKEN` | String | Cryptographic bearer token (`skyops_at_...`) used to authenticate all outbound agent requests. |
| `SKYOPS_SERVER_URL` | String | Absolute HTTP or HTTPS URL of the SkyOps Control Plane (e.g. `https://skyops.yourcompany.com`). |

### Core Identity & Downward API

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_AGENT_VERSION` | String | `v1.5.0` | Agent software version reported in handshakes and telemetry. |
| `SKYOPS_AGENT_ID` | String | `$POD_NAME` or `$HOSTNAME` | Identity of this specific agent daemon instance. |
| `NODE_NAME` | String | `""` | Assigned via Kubernetes Downward API `spec.nodeName`. |
| `POD_NAMESPACE` | String | `""` | Assigned via Kubernetes Downward API `metadata.namespace`. |
| `POD_NAME` | String | `""` | Assigned via Kubernetes Downward API `metadata.name`. |

### Intervals & Timers

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_HEARTBEAT_INTERVAL` | Duration | `30s` | Frequency of cluster liveness and capacity heartbeats sent to the server. |
| `SKYOPS_TELEMETRY_INTERVAL` | Duration | `15s` | Frequency of full resource snapshots and metrics scrapes pushed to the control plane. |
| `SKYOPS_ACTION_POLL_INTERVAL`| Duration | `5s` | Polling frequency for pending remediation action requests. |
| `SKYOPS_LOG_POLL_INTERVAL` | Duration | `2s` | Polling frequency for on-demand pod log collection requests initiated by users. |
| `SKYOPS_LOG_REQUEST_TIMEOUT`| Duration | `10s` | Maximum time allowed to stream pod logs from the Kubernetes API before timing out. |
| `SKYOPS_RESYNC_INTERVAL` | Duration | `10m` | Periodic full resync interval for Kubernetes informers. |

### Buffering, Spooling & Resiliency

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_QUEUE_CAPACITY` | Integer | `500` | In-memory queue buffer size for outgoing telemetry records. |
| `SKYOPS_MAX_RETRIES` | Integer | `5` | Maximum retry attempts per telemetry batch before routing to disk spool. |
| `SKYOPS_BACKOFF_BASE` | Duration | `1s` | Initial base duration for exponential backoff retry calculations. |
| `SKYOPS_ENABLE_SPOOL` | Boolean | `true` | Enables persistent local disk buffering when control plane connection drops. |
| `SKYOPS_SPOOL_DIR` | String | `/var/spool/skyops-agent` | Mount path for disk spool storage (`emptyDir` or persistent volume). |
| `SKYOPS_SPOOL_MAX_BYTES` | Int64 | `52428800` (50MB) | Maximum disk spool size. Oldest unacknowledged records are dropped if exceeded. |
| `SKYOPS_CIRCUIT_BREAKER_THRESHOLD` | Integer | `5` | Consecutive failed HTTP requests before opening the circuit breaker. |
| `SKYOPS_CIRCUIT_BREAKER_COOLDOWN` | Duration | `30s` | Duration to pause outbound dispatching when circuit breaker is open. |

### Log Collection Limits

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_MAX_LOG_TAIL_LINES`| Integer | `250` | Maximum number of log lines retrieved per container request. |
| `SKYOPS_MAX_LOG_BYTES` | Int64 | `524288` (512KB) | Maximum payload byte size for pod log streaming responses. |
| `SKYOPS_MAX_CONTAINERS_PER_CYCLE` | Integer | `5` | Maximum number of containers concurrently scraped during on-demand multi-container requests. |

### Scope, Filtering & Namespace Governance

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_PROTECTED_NAMESPACES`| Comma-separated | `kube-system,kube-public,kube-node-lease,skyops` | Namespaces where automated remediation actions are strictly prohibited. |
| `SKYOPS_INCLUDED_NAMESPACES` | Comma-separated | `""` (all) | If specified, the agent only scrapes workloads in these namespaces. |
| `SKYOPS_EXCLUDED_NAMESPACES` | Comma-separated | `""` | Workloads in these namespaces are completely ignored by telemetry scrapers. |
| `SKYOPS_WATCH_RESOURCES` | Comma-separated | `""` (all) | Explicit resource types to watch (e.g. `pods,deployments,services`). |

### Remediation & Safety Settings

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `SKYOPS_DRY_RUN_REMEDIATION` | Boolean | `false` | When true, approved remediation tasks are simulated; no live cluster mutation occurs. |
| `SKYOPS_MAX_CONCURRENT_ACTIONS` | Integer | `1` | Maximum number of concurrent remediation tasks allowed to execute simultaneously. |
| `SKYOPS_LOG_LEVEL` | String | `INFO` | Agent logging verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`). |

---

## Helm Chart `values.yaml` Reference

When installing via `agent/deploy/helm`, the environment variables are exposed as structured values:

```yaml
image:
  repository: ghcr.io/skyops-io/skyops-agent
  tag: "v1.5.0"
  pullPolicy: IfNotPresent

config:
  clusterId: ""                      # Maps to SKYOPS_CLUSTER_ID
  agentToken: ""                     # Maps to SKYOPS_AGENT_TOKEN
  serverUrl: ""                      # Maps to SKYOPS_SERVER_URL
  heartbeatInterval: "30s"           # Maps to SKYOPS_HEARTBEAT_INTERVAL
  telemetryInterval: "15s"           # Maps to SKYOPS_TELEMETRY_INTERVAL
  actionPollInterval: "5s"           # Maps to SKYOPS_ACTION_POLL_INTERVAL
  logPollInterval: "2s"              # Maps to SKYOPS_LOG_POLL_INTERVAL
  enableSpool: true                  # Maps to SKYOPS_ENABLE_SPOOL
  spoolMaxBytes: 52428800            # Maps to SKYOPS_SPOOL_MAX_BYTES
  dryRunRemediation: false           # Maps to SKYOPS_DRY_RUN_REMEDIATION
  protectedNamespaces:               # Maps to SKYOPS_PROTECTED_NAMESPACES
    - kube-system
    - kube-public
    - kube-node-lease
    - skyops
  logLevel: "INFO"                   # Maps to SKYOPS_LOG_LEVEL

resources:
  requests:
    cpu: 100m
    memory: 128Mi
  limits:
    cpu: 500m
    memory: 512Mi

securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 10001
  capabilities:
    drop:
      - ALL

rbac:
  create: true                       # Generates ClusterRole and ClusterRoleBinding
serviceAccount:
  create: true
  name: skyops-agent
```

---

## High-Volume Cluster Tuning Recommendations

For large Kubernetes clusters exceeding **100 nodes** or **2,000 pods**:

1. **Adjust Telemetry Interval:** Increase `telemetryInterval` to `30s` to reduce API server list/watch load.
2. **Increase Queue Capacity:** Set `SKYOPS_QUEUE_CAPACITY="2000"` to prevent buffer overflow during burst periods.
3. **Expand Spool Volume:** Allocate an `emptyDir` or SSD PersistentVolume with at least `200Mi` (`SKYOPS_SPOOL_MAX_BYTES="209715200"`).
4. **Agent Resource Allocation:**
   ```yaml
   resources:
     requests:
       cpu: 250m
       memory: 256Mi
     limits:
       cpu: 1000m
       memory: 1Gi
   ```
