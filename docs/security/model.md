# Security Model & Threat Assessment

This document outlines the security architecture, threat model, trust boundaries, data protection controls, and cluster hardening standards for the SkyOps platform.

---

## Trust Boundaries & Network Topology

SkyOps is engineered under a zero-trust model, establishing distinct trust boundaries across four runtime environments:

```mermaid
graph TB
    subgraph Boundary1["1. Kubernetes Cluster Boundary (Customer VPC)"]
        Workloads["Customer Production Workloads"]
        Agent["skyops-agent Pod (Non-Root, UID 10001)"]
        K8sAPI["kube-apiserver (Internal)"]
    end

    subgraph Boundary2["2. Network Transit Boundary (Public Internet / WAN)"]
        TLS["mTLS / TLS 1.3 Outbound HTTPS (Port 443)"]
    end

    subgraph Boundary3["3. Control Plane Boundary (SkyOps Central Server)"]
        APIServer["API Gateway & Ingress"]
        DataStore["Multi-Tenant In-Memory & File Store"]
        GeminiClient["AI Analysis Engine (Egress)"]
    end

    subgraph Boundary4["4. Client Boundary (Operator Browser)"]
        Browser["React Operations Console (Firebase JWT)"]
    end

    Agent -->|Read Resources & Logs| K8sAPI
    Agent -->|Execute Approved Mutation| K8sAPI
    Agent -->|Outbound Telemetry ONLY| TLS
    TLS --> APIServer
    APIServer --> DataStore
    APIServer --> GeminiClient
    Browser <-->|REST API + Bearer JWT| APIServer
```

### Critical Security Invariant: Outbound-Only Communication
- The SkyOps Agent **never listens on open inbound network ports**.
- The cluster's firewall requires zero incoming port forwards, load balancers, or ingress controllers for SkyOps.
- If the control plane is compromised, an attacker cannot pivot inward to initiate network connections into customer clusters.

---

## Threat Model & Mitigations

| Threat | Attack Vector | SkyOps Hardening & Countermeasure |
| :--- | :--- | :--- |
| **Cluster Ingress Compromise** | Attacker probes for open cluster ports. | **Mitigated:** No open ingress ports on cluster. All traffic is outbound initiated by agent via HTTPS. |
| **Agent Token Compromise** | Stolen `skyops_at_...` bearer token. | **Mitigated:** Token only grants rights to post telemetry and retrieve designated cluster actions. Cannot read other clusters. Tokens can be revoked or rotated instantly via UI/API. |
| **Unauthorized Workload Mutation** | Rogue action attempts to delete cluster or wipe storage. | **Mitigated:** RBAC strictly forbids namespace/PVC deletion. System namespaces (`kube-system`, etc.) are protected. Pre-condition checks and atomic rollbacks prevent destructive drift. |
| **Cross-Tenant Data Leakage** | Malicious user attempts to query another organization's incidents. | **Mitigated:** Middleware enforces `requireOrgMembership` on every API route. DataStore queries strictly enforce `orgId` filtering. |
| **Secret Exfiltration via Pod Logs** | Passwords or private keys streamed into LLM prompts. | **Mitigated:** The agent and control plane pass logs through regex sanitizers that strip bearer tokens, private keys, and environment variables matching secret patterns. |
| **Prompt Injection Attacks** | Malicious payload in pod log attempts to hijack AI output. | **Mitigated:** LLM output is validated against a rigid JSON schema by `SafetyPolicyEngine`. The AI has zero execution privileges and cannot directly trigger cluster mutations. |

---

## Agent Hardening & Container Security

The official `skyops-agent` container is packaged and executed with defense-in-depth controls:

```yaml
securityContext:
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 10001
  runAsGroup: 10001
  capabilities:
    drop:
      - ALL
```

### Explanations:
1. **`runAsNonRoot: true` & `runAsUser: 10001`:** The agent binary executes under an unprivileged UID with zero root access on the host node.
2. **`allowPrivilegeEscalation: false`:** Prevents child processes from gaining setuid privileges.
3. **`readOnlyRootFilesystem: true`:** The container root filesystem cannot be modified. Ephemeral disk writes are isolated to an `emptyDir` mounted at `/var/spool/skyops-agent` and `/tmp`.
4. **`capabilities.drop: ["ALL"]`:** Removes all Linux kernel capabilities (including `CAP_NET_RAW`, `CAP_SYS_ADMIN`, `CAP_DAC_OVERRIDE`).

---

## RBAC Least Privilege

The Kubernetes ClusterRole assigned to the agent (`skyops-agent-reader`) is bounded:
- **Read-Only:** Nodes, Namespaces, Services, ConfigMaps, Secrets, PVCs, StorageClasses, and Events.
- **Controlled Mutation:** Limited strictly to:
  - `pods`: `create`, `delete` (for replacing standalone crashed pods).
  - `deployments`: `patch` (for rolling image updates and replica scaling).
- **Prohibited:** Cannot delete Namespaces, PersistentVolumes, Nodes, RBAC Roles, or mutating webhook configurations.

---

## Data Protection & Encryption

- **Data in Transit:** All communication between agents, control planes, and browsers is encrypted using **TLS 1.3** (or TLS 1.2 minimum) with modern cipher suites.
- **Data at Rest:** Control-plane state in Cloud Firestore is protected by Google Cloud infrastructure encryption (e.g. AWS EBS with KMS, GCP Persistent Disk with customer-managed keys).
- **Audit Logging:** Every user action (login, token rotation, remediation approval, policy update) generates an immutable entry in `skyops_audit.json` recording user UID, role, timestamp, client IP, and operation outcome.
