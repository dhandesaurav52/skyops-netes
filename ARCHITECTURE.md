# SkyOps architecture

SkyOps is an API-mediated Kubernetes control plane. The React application uses Firebase Auth for sign-in and calls `/api/v1`; it does not read or mutate control-plane documents directly. Express verifies Firebase ID tokens, resolves tenant membership from server persistence, applies RBAC, validates resources belong to the resolved organization, and writes server-side audit events.

Firestore holds control-plane data such as organizations, memberships, clusters, incidents, remediation state, agent tokens, webhooks, billing records and audit events. High-frequency telemetry is processed through the telemetry/store abstraction rather than granting clients Firestore access. Cloud Storage artifacts live under `tenants/{orgId}/{category}` and are accessed through authenticated artifact APIs.

Kubernetes agents authenticate with a cluster-bound bearer token and submit telemetry/heartbeats to agent endpoints. Human actions follow UI → authenticated API → tenant/RBAC/resource validation → policy/approval → agent execution → verification/audit. AI analysis is advisory and validated before it can enter this flow.

For production, run the API with persistent server-owned storage and a workload identity. Replace the development in-process job worker with a durable Cloud Tasks or Pub/Sub adapter before horizontally scaling workers.

## Kubernetes Operations Workspace Production Hardening & Safety

The Operations Workspace provides direct, policy-governed Kubernetes mutations executed via cluster-bound agents:
- **Idempotency**: Requests carry a unique client-generated or server-scoped `idempotencyKey` preventing duplicate dispatch on network retries.
- **Resource Concurrency Lock**: Active in-flight mutations on the same target resource return `409 Conflict` until completion or terminal timeout.
- **Terminal State Immutability**: Actions in terminal states (`SUCCEEDED`, `FAILED`, `VERIFIED_RESOLVED`, `ROLLED_BACK`, `TIMEOUT`) reject out-of-order stale agent callbacks.
- **Unknown Mutation State & Timeout Reaper**: If an agent disconnects or execution stalls past lease expiration (10 min normal, 3 min when agent disconnected), the heartbeat monitor transitions the action to `TIMEOUT` with explicit `UNKNOWN` mutation state. The UI flags this state prominently and strictly forbids automatic retries without manual cluster verification.
- **Safety Policy Enforcement**: Standalone pod deletions require explicit `confirmNakedPodDelete`; workload scaling to 0 requires `confirmScaleToZero`; node drain requires `confirmDrain` and is strictly restricted to `OWNER`, `ADMIN`, or `SRE` roles.
- **Scoped Agent RBAC**: ClusterRoles in Helm charts (`agent/deploy/helm/templates/clusterrole.yaml`) define fine-grained least-privilege permissions across deployments, replica sets, stateful sets, pods, nodes, jobs, and cronjobs without wildcard cluster-admin escalation.
