# Agent Troubleshooting Runbook

This runbook provides systematic diagnostic steps and solutions for common operational issues encountered with the **SkyOps Agent (`skyops-agent` v1.5.0)**.

---

## 1. Agent Fails to Connect (Cluster Status Stays "Pending")

### Symptoms
- The cluster status card in the SkyOps Console remains **Pending** or **Installing**.
- No heartbeats or resource metrics appear.

### Diagnostic Steps
1. Check if the agent pod is running:
   ```bash
   kubectl get pods -n skyops-system -l app.kubernetes.io/name=skyops-agent
   ```
2. Inspect the agent pod logs:
   ```bash
   kubectl logs -n skyops-system -l app.kubernetes.io/name=skyops-agent --tail=50
   ```

### Common Causes & Fixes

#### A. Invalid or Unreachable Server URL (`SKYOPS_SERVER_URL`)
- **Error in logs:** `dial tcp: lookup skyops.internal: no such host` or `connection refused`.
- **Fix:** If running locally (Minikube / Kind / Docker Desktop), do not use `localhost` or `127.0.0.1` inside the cluster. Use your host machine's LAN IP (e.g. `http://192.168.1.50:3000`) or Kubernetes host gateway (e.g. `http://host.minikube.internal:3000`).

#### B. Invalid Bearer Token (`SKYOPS_AGENT_TOKEN`)
- **Error in logs:** `HTTP 403 Forbidden: Agent authentication failed`.
- **Fix:** Verify the secret matches the token displayed in the cluster connection modal:
  ```bash
  kubectl get secret skyops-agent-credentials -n skyops-system -o jsonpath="{.data.agent-token}" | base64 --decode
  ```
  If invalid, rotate the token in the SkyOps UI and update the secret.

#### C. Outbound Firewall Blocking Egress
- **Error in logs:** `i/o timeout` connecting to port 443.
- **Fix:** Ensure cluster egress security groups allow outbound TCP on port 443 (HTTPS) to the SkyOps control plane IP/domain.

---

## 2. Pod Log Streaming Errors

### Symptoms
- SRE clicks **View Logs** on a pod or incident and sees:
  `"Kubernetes API Unavailable: content negotiation error"` or `status="UNKNOWN_ERROR" lines=0 bytes=0`.

### Root Cause Analysis
This error typically occurs when the client-go REST client sends an invalid `Accept` HTTP header (requesting `application/json` instead of `text/plain`) against the Kubernetes pod log subresource (`/api/v1/namespaces/{ns}/pods/{name}/log`), or when the target container has crashed and exited.

### Resolution Steps
1. Verify pod logs exist directly on the cluster:
   ```bash
   kubectl logs -n <namespace> <pod-name> -c <container> --tail=20
   ```
2. If the container is in `CrashLoopBackOff`, check previous logs:
   ```bash
   kubectl logs -n <namespace> <pod-name> -c <container> --previous --tail=20
   ```
3. Ensure the agent version is updated to **`v1.5.0`**, which implements the normalized streaming pipeline with automatic previous-container fallback and correct `text/plain` content negotiation.

---

## 3. Metrics-Server Unavailable (Fallback Mode Triggered)

### Symptoms
- The Observability tab displays:
  *"Live metrics-server unavailable; falling back to container request/limit allocations."*

### Diagnostic Steps
1. Check if metrics-server is deployed in `kube-system`:
   ```bash
   kubectl get deployment metrics-server -n kube-system
   ```
2. Test if real CPU and memory metrics are queryable:
   ```bash
   kubectl top nodes
   kubectl top pods -A
   ```

### Fixes
- **If missing:** Install metrics-server:
  ```bash
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
  ```
- **If `top nodes` fails with x509 certificate errors:** (Common in test clusters or self-hosted kubeadm):
  Edit the metrics-server deployment:
  ```bash
  kubectl edit deployment metrics-server -n kube-system
  ```
  Add the `--kubelet-insecure-tls` flag to `spec.template.spec.containers[0].args`.

---

## 4. Remediation Action Fails (`FAILED` or `ROLLED_BACK`)

### Symptoms
- Remediation timeline records status `FAILED` with error message.

### Common Causes & Fixes

#### A. Target in Protected Namespace
- **Error:** `Action target resides in protected namespace (kube-system)`.
- **Reason:** SkyOps policy engine explicitly forbids automated mutations against system infrastructure.
- **Fix:** If intended, modify `SKYOPS_PROTECTED_NAMESPACES` in agent config or perform modification manually via kubectl.

#### B. Precondition Version Mismatch
- **Error:** `Precondition failed: container image does not match expected baseline`.
- **Reason:** Another deployment or engineer changed the container image between proposal and approval.
- **Fix:** Re-run root cause analysis; review the latest incident snapshot.

#### C. Verification Timeout (Triggered Automatic Rollback)
- **Status:** `ROLLED_BACK`.
- **Reason:** The patched image was applied, but the replacement container failed readiness probes or entered `CrashLoopBackOff` within 60 seconds.
- **Safety Guarantee:** The agent automatically rolled back to the previous known working state to protect production uptime.

---

## 5. Local Disk Spool Filling Up (`/var/spool/skyops-agent`)

### Symptoms
- Agent logs show: `Spool queue approaching capacity: 42MB / 50MB`.

### Cause
The agent has lost network connectivity to the SkyOps control plane, and is buffering telemetry locally on disk.

### Resolution
1. Verify the control plane server is healthy:
   ```bash
   curl -I https://skyops.yourcompany.com/api/health
   ```
2. Once network connectivity is restored, the agent's background spool drain worker automatically dispatches the backlog in chronological order, and the spool usage drops back to 0MB.
