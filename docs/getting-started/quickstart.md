# Quickstart Guide

Get your Kubernetes cluster connected to SkyOps in under 5 minutes.

---

## Prerequisites

Before starting, ensure you have:
1. Access to a Kubernetes cluster (**v1.24** through **v1.35+** supported).
2. Administrative permissions on the cluster (`kubectl` with rights to create `Namespaces`, `ServiceAccounts`, `ClusterRoles`, `ClusterRoleBindings`, and `Deployments`).
3. Outbound network access from the cluster nodes to your SkyOps server on port `443` (HTTPS) or `3000` (HTTP).

---

## Step 1: Log in to SkyOps Console

1. Navigate to your SkyOps instance in your browser (e.g. `http://localhost:3000` or your hosted domain).
2. Sign in using your organization credentials or initialize the default administrator account.
3. Upon authentication, you will arrive at the **Command Center** dashboard.

---

## Step 2: Register a New Cluster

1. In the left navigation sidebar, click on **Clusters**.
2. Click the **+ Add Cluster** button in the top right corner.
3. Enter a human-readable name for your cluster (e.g. `production-us-east-1` or `local-minikube`).
4. Optionally provide an environment description.
5. Click **Generate Connection Credentials**.

The control plane generates:
- A unique **Cluster ID** (e.g. `cluster-a1b2c3d4`).
- A cryptographically random **Agent Bearer Token** (`skyops_at_...`).
- A single-use **Pairing Code** (valid for 15 minutes).

---

## Step 3: Install the SkyOps Agent

Choose one of three supported installation methods:

### Option A: One-Line Quick Install Script (Recommended for Fast Evaluation)

Copy and run the generated curl command directly in your terminal:

```bash
curl -sSL "https://<your-skyops-domain>/api/v1/clusters/<cluster-id>/install.sh?token=<agent-token>" | bash
```

*Note: For self-hosted HTTP setups or development instances, replace `https` with `http` and include the appropriate port.*

The installation script automatically:
1. Creates the `skyops-system` namespace.
2. Applies the necessary RBAC `ServiceAccount`, `ClusterRole`, and `ClusterRoleBinding`.
3. Stores the credentials in a Kubernetes Secret named `skyops-agent-credentials`.
4. Deploys the `skyops-agent:v1.5.0` deployment.

### Option B: Helm Chart Installation (Recommended for Production)

If your organization manages infrastructure via Helm:

```bash
# Add or reference the local SkyOps Helm chart
helm repo add skyops https://charts.skyops.io  # (or use ./agent/deploy/helm)

# Install the agent release
helm install skyops-agent ./agent/deploy/helm \
  --namespace skyops-system \
  --create-namespace \
  --set config.clusterId="<cluster-id>" \
  --set config.agentToken="<agent-token>" \
  --set config.serverUrl="https://<your-skyops-domain>"
```

### Option C: Direct Kubernetes YAML Manifest

Download and inspect the fully rendered manifest:

```bash
kubectl apply -f "https://<your-skyops-domain>/api/v1/clusters/<cluster-id>/manifest.yaml?token=<agent-token>"
```

---

## Step 4: Verify the Connection

Check that the agent pod is running:

```bash
kubectl get pods -n skyops-system -l app.kubernetes.io/name=skyops-agent
```

Expected output:
```text
NAME                            READY   STATUS    RESTARTS   AGE
skyops-agent-7b6c898745-xyz12   1/1     Running   0          45s
```

Check the agent startup logs:

```bash
kubectl logs -n skyops-system -l app.kubernetes.io/name=skyops-agent --tail=20
```

Look for the following log confirmations:
- `[INFO] Initializing SkyOps Kubernetes Agent v1.5.0`
- `[INFO] Successfully registered agent with control plane (Cluster ID: ...)`
- `[INFO] Heartbeat dispatched successfully`
- `[INFO] Telemetry batch pushed (Resources: N, Metrics: M)`

In the SkyOps UI, the cluster status indicator will transition from **Pending** to **Installing** to **Connected** (pulsing green).

---

## Step 5: Explore Telemetry & Health

Once connected, SkyOps begins continuous discovery:
- **Infrastructure:** Visit the **Infrastructure** tab to view your nodes, CPU/Memory allocatable capacity, and all active workloads.
- **Observability:** Go to the **Observability** tab to inspect live metrics graphs (ingested directly from `metrics.k8s.io` with fallback to container specs).
- **Events:** View real-time cluster-wide Kubernetes warning and lifecycle events.

---

## Step 6: Test Incident Detection & Remediation

To observe SkyOps in action, deploy a test workload that enters a crash state:

```bash
kubectl create deployment crash-test --image=busybox -- /bin/sh -c "exit 1"
```

1. Within 15-30 seconds, the agent will detect the container entering `CrashLoopBackOff`.
2. The SkyOps Incident Engine will:
   - Create an incident record (e.g. `SKY-0012: Pod crash-test-... in CrashLoopBackOff`).
   - Associate the pod logs, events, and container diagnostics.
   - Run the **Gemini AI Root Cause Analysis** or deterministic fallback engine.
   - Generate an automated remediation proposal (e.g. `RestartPod` or image replacement).
3. Open the incident details, review the root-cause summary, and click **Approve & Execute** to trigger agent remediation.

Clean up the test deployment when finished:

```bash
kubectl delete deployment crash-test
```
