# REST API Reference

This document provides a comprehensive specification of all HTTP REST endpoints exposed by the SkyOps Control Plane (`server.ts`).

---

## Authentication & Headers

### User Requests
All user-facing endpoints require a valid Firebase ID Token and an active tenant organization:
```http
Authorization: Bearer <firebase-id-token>
X-Org-Id: <organization-id>
Content-Type: application/json
```

### Agent Requests
All Kubernetes agent endpoints require the cluster's cryptographic Bearer token:
```http
Authorization: Bearer <skyops-agent-token>
X-SkyOps-Agent-Version: 1.5.0
Content-Type: application/json
```

---

## 1. Kubernetes Agent Endpoints

These endpoints are called exclusively by the `skyops-agent` daemon.

### `POST /api/v1/agent/register`
Initializes or reconnects the agent daemon instance.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Body:**
  ```json
  {
    "agentVersion": "v1.5.0",
    "nodeName": "worker-pool-1",
    "podNamespace": "skyops-system",
    "podName": "skyops-agent-7f6d97c76-xyz12",
    "k8sVersion": "v1.35.1"
  }
  ```
- **Response (200 OK):**
  ```json
  {
    "status": "REGISTERED",
    "clusterId": "cluster-a1b2c3d4",
    "serverVersion": "v1.5.0"
  }
  ```

### `POST /api/v1/agent/heartbeat`
Dispatches periodic health and cluster capacity heartbeats.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Body:**
  ```json
  {
    "nodeCount": 3,
    "podCount": 42,
    "k8sVersion": "v1.35.1",
    "agentVersion": "v1.5.0"
  }
  ```
- **Response (200 OK):** `{ "acknowledged": true }`

### `POST /api/v1/agent/telemetry`
Pushes full resource topology, container diagnostics, and metrics.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Body:** Contains resources array, node metrics, and events.
- **Response (200 OK):**
  ```json
  {
    "ingested": true,
    "resourcesCount": 45,
    "incidentsDetected": 1
  }
  ```

### `GET /api/v1/agent/actions`
Polls for queued remediation actions designated for this cluster.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Response (200 OK):** Array of pending `RemediationAction` objects.

### `POST /api/v1/agent/actions/:actionId/result`
Reports the outcome of an executed remediation action.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Body:**
  ```json
  {
    "status": "SUCCEEDED",
    "executionTimeMs": 1420,
    "message": "Deployment container image successfully updated and verified.",
    "previousState": "my-app:v1.2.2",
    "currentState": "my-app:v1.2.3"
  }
  ```

### `GET /api/v1/agent/logs/requests`
Polls for on-demand pod log streaming requests created by SRE operators.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Response (200 OK):** Array of pending log requests.

### `POST /api/v1/agent/logs`
Delivers collected pod log lines back to the control plane.
- **Auth:** Agent Token (`requireAgentAuth`)
- **Body:**
  ```json
  {
    "requestId": "req-987654",
    "status": "SUCCESS",
    "lines": ["log line 1", "log line 2"],
    "totalLines": 2,
    "bytes": 142
  }
  ```

---

## 2. Cluster Management Endpoints

### `GET /api/v1/clusters`
Lists all clusters enrolled in the active organization.

### `POST /api/v1/clusters`
Registers a new cluster and provisions authentication credentials.
- **Auth:** User Auth + `cluster.manage` permission
- **Body:**
  ```json
  {
    "name": "production-us-east-1",
    "description": "Primary production EKS cluster"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "id": "cluster-a1b2c3d4",
    "name": "production-us-east-1",
    "status": "pending",
    "agentToken": "skyops_at_...",
    "connectionCode": "849201"
  }
  ```

### `GET /api/v1/clusters/:id`
Retrieves detailed status, connectivity, and diagnostics for a specific cluster.

### `POST /api/v1/clusters/:id/rotate-token`
Rotates the cluster's agent bearer token.

### `POST /api/v1/clusters/:id/disconnect`
Sever connection and disconnect agent.

### `DELETE /api/v1/clusters/:id`
Permanently removes cluster and all associated telemetry from the organization.

---

## 3. Observability & Telemetry Endpoints

### `GET /api/v1/clusters/:id/resources`
Returns normalized list of discovered Kubernetes resources (Pods, Deployments, Nodes, Services).

### `GET /api/v1/clusters/:id/metrics`
Returns aggregate cluster-level CPU and memory utilization.

### `GET /api/v1/clusters/:id/metrics/nodes`
Returns per-node capacity, usage, and condition diagnostics.

### `GET /api/v1/clusters/:id/metrics/history?range=1h&interval=1m`
Returns historical CPU and memory timeseries data.

### `GET /api/v1/clusters/:id/pods/:namespace/:podName/logs`
Fetches live pod logs on demand via the agent pipeline.
- **Query Params:** `container` (optional), `tailLines` (default 250), `previous` (boolean).

---

## 4. Incident Management Endpoints

### `GET /api/v1/incidents`
Lists incidents in the organization with filtering by `status`, `severity`, and `clusterId`.

### `GET /api/v1/incidents/:id`
Retrieves full incident diagnostics, affected containers, events, and timeline.

### `PATCH /api/v1/incidents/:id/status`
Updates incident status or assigns an SRE responder.
- **Body:** `{ "status": "ACKNOWLEDGED", "assigneeUserId": "user-123" }`

### `POST /api/v1/incidents/:id/resolve`
Manually marks an active incident as resolved.
- **Body:** `{ "reason": "Manually patched secret and scaled deployment." }`

### `POST /api/v1/incidents/:id/ai-analysis`
Triggers or refreshes Gemini AI root cause analysis.
- **Body:** `{ "force": false }`

### `GET /api/v1/incidents/:id/timeline`
Retrieves immutable chronological timeline events for the incident.

### `GET /api/v1/incidents/:id/notes`
Lists SRE investigation notes on the incident.

### `POST /api/v1/incidents/:id/notes`
Adds an SRE investigation note.
- **Body:** `{ "content": "Database connection verified restored." }`

---

## 5. Remediation Endpoints

### `GET /api/v1/incidents/:id/remediation`
Inspects proposed remediation action and pre-condition validation status.

### `POST /api/v1/incidents/:id/remediations/replace-pod-image/approve`
Approves and dispatches an image replacement action.
- **Auth:** `remediation.approve` + `remediation.execute`

### `GET /api/v1/remediation/policy`
Retrieves organization remediation policy rules and autonomy modes.

### `PUT /api/v1/remediation/policy`
Updates remediation policy (e.g. autonomy mode, allowed action types).
- **Auth:** `policy.manage`

---

## 6. Audit & Webhook Endpoints

### `GET /api/v1/audit`
Returns paginated security audit log trail.

### `GET /api/v1/audit/export?format=json`
Exports audit log history for compliance.

### `GET /api/v1/integrations/webhooks`
Lists configured outbound webhook endpoints.

### `POST /api/v1/integrations/webhooks`
Registers an outbound webhook with URL, event triggers, and secret key.

### `POST /api/v1/integrations/webhooks/:id/test`
Dispatches a synthetic test payload to verify endpoint connectivity.
