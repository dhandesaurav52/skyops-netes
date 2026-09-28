# Agent Installation Guide

This guide covers deploying the **SkyOps Kubernetes Agent (`skyops-agent` v1.5.0)** into your target cluster.

---

## Architecture & Deployment Model

The SkyOps Agent runs as a Kubernetes `Deployment` (1 replica) in the `skyops-system` namespace. It requires cluster-scoped read permissions for core observability resources and targeted mutation permissions for automated remediation.

### Current Version Information
- **Agent Version:** `v1.5.0` (Verified via `agent/VERSION` and `src/config/version.ts`)
- **Container Image:** `ghcr.io/skyops-io/skyops-agent:v1.5.0`
- **Default Namespace:** `skyops-system`
- **Resource Recommendations:**
  - Requests: `100m` CPU, `128Mi` Memory
  - Limits: `500m` CPU, `512Mi` Memory

---

## Method 1: Helm Chart Installation (Recommended for Production)

The official Helm chart is located in `agent/deploy/helm` within the repository.

### 1. Prerequisites
- Helm v3.8.0 or higher.
- A cluster registration in SkyOps to obtain your `ClusterID` and `AgentToken`.

### 2. Install using Helm CLI

```bash
# Set your SkyOps connection parameters
export CLUSTER_ID="<your-cluster-id>"
export AGENT_TOKEN="<your-agent-token>"
export SERVER_URL="https://skyops.yourcompany.com"

# Deploy release into skyops-system
helm install skyops-agent ./agent/deploy/helm \
  --namespace skyops-system \
  --create-namespace \
  --set config.clusterId="${CLUSTER_ID}" \
  --set config.agentToken="${AGENT_TOKEN}" \
  --set config.serverUrl="${SERVER_URL}" \
  --set resources.requests.cpu="100m" \
  --set resources.requests.memory="128Mi" \
  --set resources.limits.cpu="500m" \
  --set resources.limits.memory="512Mi"
```

### 3. Production `values.yaml` Example

For GitOps pipelines (ArgoCD, Flux) or production deployments, maintain a values file:

```yaml
# production-skyops-values.yaml
image:
  repository: ghcr.io/skyops-io/skyops-agent
  tag: "v1.5.0"
  pullPolicy: IfNotPresent

config:
  clusterId: "prod-us-east-1"
  serverUrl: "https://skyops.internal.corp"
  existingSecret: "skyops-agent-secret"  # References secret created by external vault
  heartbeatInterval: "30s"
  telemetryInterval: "15s"
  actionPollInterval: "5s"
  logPollInterval: "2s"
  enableSpool: true
  spoolMaxBytes: 52428800 # 50MB
  dryRunRemediation: false

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

nodeSelector: {}
tolerations:
  - key: "node-role.kubernetes.io/control-plane"
    operator: "Exists"
    effect: "NoSchedule"
```

Apply with:
```bash
helm upgrade --install skyops-agent ./agent/deploy/helm \
  --namespace skyops-system \
  -f production-skyops-values.yaml
```

---

## Method 2: One-Line Quick Install Script

For staging, sandboxes, and developer clusters, SkyOps provides an automated bootstrapping script delivered directly via the API.

```bash
curl -sSL "https://<skyops-host>/api/v1/clusters/<cluster-id>/install.sh?token=<agent-token>" | bash
```

### What the Script Executes:
1. Validates that `kubectl` is installed and the current context is reachable.
2. Checks whether namespace `skyops-system` exists; creates it if missing.
3. Provisions a Kubernetes Secret `skyops-agent-credentials` containing:
   - `cluster-id`: `<cluster-id>`
   - `agent-token`: `<agent-token>`
   - `server-url`: `https://<skyops-host>`
4. Applies the RBAC ClusterRole and ClusterRoleBinding for `skyops-agent`.
5. Deploys the `skyops-agent:v1.5.0` Deployment.
6. Waits for rollout completion: `kubectl rollout status deployment/skyops-agent -n skyops-system`.

---

## Method 3: Direct YAML Manifest

You can fetch the rendered YAML manifest from the SkyOps control plane and apply it directly:

```bash
curl -sSL -H "Authorization: Bearer <user-or-agent-token>" \
  "https://<skyops-host>/api/v1/clusters/<cluster-id>/manifest.yaml" | kubectl apply -f -
```

Or view and edit the manifest locally before applying:

```bash
curl -sSL "https://<skyops-host>/api/v1/clusters/<cluster-id>/manifest.yaml?token=<agent-token>" -o skyops-agent.yaml
kubectl apply -f skyops-agent.yaml
```

---

## RBAC Permissions Overview

The agent requires permissions defined in `agent/deploy/helm/templates/clusterrole.yaml`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: skyops-agent-reader
rules:
  # Core Workload Discovery & Log Streaming
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch", "create", "delete"]
  - apiGroups: [""]
    resources: ["pods/log"]
    verbs: ["get"]
  - apiGroups: [""]
    resources:
      - pods/status
      - nodes
      - nodes/status
      - namespaces
      - services
      - endpoints
      - persistentvolumeclaims
      - persistentvolumes
      - configmaps
      - secrets
      - serviceaccounts
      - resourcequotas
      - limitranges
      - events
    verbs: ["get", "list", "watch"]

  # Apps & Batch Resources
  - apiGroups: ["apps"]
    resources:
      - deployments
      - deployments/status
      - statefulsets
      - statefulsets/status
      - daemonsets
      - daemonsets/status
      - replicasets
    verbs: ["get", "list", "watch", "patch"]
  - apiGroups: ["batch"]
    resources: ["jobs", "cronjobs"]
    verbs: ["get", "list", "watch"]

  # Networking & Storage
  - apiGroups: ["networking.k8s.io"]
    resources: ["ingresses"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["storage.k8s.io"]
    resources: ["storageclasses"]
    verbs: ["get", "list", "watch"]

  # Metrics-Server API
  - apiGroups: ["metrics.k8s.io"]
    resources: ["nodes", "pods"]
    verbs: ["get", "list"]
```

*Note: The `create` and `delete` verbs on pods and `patch` on deployments are strictly required for executing approved remediation tasks (`ReplacePodImage`, `RestartPod`, `ScaleDeployment`). If remediation is disabled via policy or `--set config.dryRunRemediation=true`, these actions run in simulation mode.*

---

## Verifying Deployment Health

### 1. Check Pod Status
```bash
kubectl get pods -n skyops-system
```
Expected output:
```text
NAME                            READY   STATUS    RESTARTS   AGE
skyops-agent-7f6d97c76-kx89m    1/1     Running   0          2m
```

### 2. Tail Live Logs
```bash
kubectl logs -n skyops-system deployment/skyops-agent -f
```
Expected logs:
```text
{"level":"INFO","time":"2026-09-17T08:00:00Z","message":"Starting SkyOps Kubernetes Agent v1.5.0"}
{"level":"INFO","time":"2026-09-17T08:00:01Z","message":"Connecting to control plane at https://skyops.yourcompany.com"}
{"level":"INFO","time":"2026-09-17T08:00:01Z","message":"Agent successfully registered (Cluster ID: cluster-a1b2c3d4)"}
{"level":"INFO","time":"2026-09-17T08:00:02Z","message":"Initial discovery completed: 3 nodes, 42 pods"}
{"level":"INFO","time":"2026-09-17T08:00:15Z","message":"Telemetry snapshot dispatched: 45 resources, 3 nodes"}
```

---

## Upgrading the Agent

To upgrade an existing agent deployment to the latest chart version:

```bash
helm upgrade skyops-agent ./agent/deploy/helm \
  --namespace skyops-system \
  --reuse-values \
  --set image.tag="v1.5.0"
```

---

## Uninstallation

To completely remove the SkyOps agent and all associated cluster resources:

```bash
# If installed with Helm
helm uninstall skyops-agent -n skyops-system
kubectl delete namespace skyops-system

# If installed with kubectl manifest
kubectl delete -f skyops-agent.yaml
kubectl delete namespace skyops-system
```
