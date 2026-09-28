# SkyOps Documentation Hub

Welcome to the official documentation for **SkyOps** — a production-grade Kubernetes observability, incident detection, automated root-cause intelligence, and remediation platform.

SkyOps bridges the gap between raw cluster metrics/events and actionable SRE workflows. Through a lightweight Go daemon deployed in each Kubernetes cluster and a centralized management control plane, SkyOps continuously monitors workload health, computes baselines, isolates anomalies, triggers deterministic investigations, and facilitates human-governed or autonomous remediation.

---

## Documentation Directory Structure

```
docs/
├── README.md                                  # Hub & Global Index (this document)
├── getting-started/
│   ├── quickstart.md                          # 5-minute onboarding guide
│   └── architecture.md                        # Platform architecture & data flow
├── agent/
│   ├── installation.md                        # Helm, Manifest, and Script installation
│   ├── configuration.md                       # Environment variables and Helm values
│   └── architecture.md                        # Internal daemon design (pipeline, spool, dispatcher)
├── kubernetes/
│   ├── cluster-connection.md                  # Pairing, token rotation & heartbeat lifecycle
│   └── supported-versions.md                  # Matrix, RBAC requirements & metrics-server setup
├── observability/
│   ├── metrics.md                             # Cluster, node & workload metrics ingestion
│   ├── logs.md                                # On-demand pod log streaming pipeline
│   └── events.md                              # Kubernetes event streaming and correlation
├── incidents/
│   ├── detection-engine.md                    # Deterministic rule engine & fingerprinting
│   └── lifecycle.md                           # Triage, occurrence counter, auto-verification
├── ai/
│   └── gemini-integration.md                  # Gemini models, prompt context & safety engine
├── remediation/
│   └── engine.md                              # Actions (Image, Restart, Scale), leases & rollbacks
├── platform/
│   ├── auth-rbac.md                           # Firebase Auth, RBAC roles & permission matrix
│   ├── persistence.md                         # Storage architecture (DataStore vs Roadmap)
│   └── notifications-webhooks.md              # SMTP alerting, webhooks & HMAC signatures
├── api/
│   └── reference.md                           # Complete REST API specification (User & Agent)
└── operations/
    ├── troubleshooting.md                     # Runbooks for connection, logs & metrics issues
    └── production-deployment.md               # High availability, TLS & scaling guidelines
```

---

## System Overview & Architecture

SkyOps consists of two primary operational boundaries:

1. **SkyOps Kubernetes Agent (`skyops-agent` v1.5.0)**
   - Implemented in **Go** (`agent/cmd/agent`, `agent/internal/*`).
   - Runs as a lightweight single-replica or cluster-wide Deployment in the `skyops-system` namespace.
   - Collects cluster topology, node metrics, container diagnostic statuses, workload conditions, and events.
   - Executes authorized remediation actions (`ReplacePodImage`, `RestartPod`, `ScaleDeployment`) with pre-condition checks and atomic rollback.
   - Streams on-demand pod logs over HTTP/HTTPS back to the control plane.
   - Employs local disk-spooling (`/var/spool/skyops-agent`) and exponential backoff retry logic during network partitions.

2. **SkyOps Central Control Plane & Engine**
   - Implemented in **TypeScript / Node.js** (`server.ts`, `server/*`).
   - Ingests agent telemetry, performs cryptographic token verification, and maintains cluster heartbeats.
   - Evaluates resources against a **deterministic incident detection engine** (`server/engine/detector.ts`).
   - Computes workload baselines and flags anomalous spikes (`server/engine/intelligence.ts`).
   - Orchestrates AI root-cause analysis via Google Gemini (`@google/genai` models `gemini-3.1-flash-lite` and `gemini-3.8-flash`) guarded by a **Safety Policy Engine**.
   - Serves a responsive, single-page operations console built with **React 19, Tailwind CSS, and Motion** (`src/*`).

```mermaid
flowchart TD
    subgraph KubernetesCluster["Target Kubernetes Cluster"]
        K8sAPI["kube-apiserver & metrics-server"]
        Agent["skyops-agent daemon (Go v1.5.0)"]
        Workloads["Pods / Deployments / Nodes"]
        
        K8sAPI -->|Informer Watch & Scrape| Agent
        Agent -->|Precondition / Mutate / Rollback| Workloads
    end

    subgraph SkyOpsControlPlane["SkyOps Control Plane (Express + TS)"]
        Ingress["REST API Endpoints (/api/v1/*)"]
        AuthLayer["Auth & RBAC (Bearer Token / Firebase JWT)"]
        Engine["Deterministic Incident Detector & Correlator"]
        AI["Gemini AI Service + Safety Policy Engine"]
        DataStore["Authoritative DataStore (Persistence Layer)"]
        Notifiers["Email (SMTP) & Outbound Webhooks"]
        
        Ingress --> AuthLayer
        AuthLayer --> Engine
        Engine --> DataStore
        Engine --> AI
        Engine --> Notifiers
    end

    subgraph UserInterface["Client Tier"]
        Browser["SRE / DevOps Browser Console (React 19)"]
    end

    Agent -->|Heartbeats, Telemetry & Logs (HTTP Post)| Ingress
    Ingress -->|Action Dispatch & Log Requests| Agent
    Browser <-->|Session REST API (JSON)| Ingress
```

---

## Project Status & Implementation Matrix

To maintain strict operational transparency, all capabilities across SkyOps are classified into four clear stages:

| Component / Subsystem | Implementation Status | Codebase References | Notes |
| :--- | :--- | :--- | :--- |
| **Go Agent Core** | **Implemented** | `agent/cmd/agent`, `agent/internal/*` | Version v1.5.0, in-memory queue, disk spooling fallback. |
| **Helm Chart Packaging** | **Implemented** | `agent/deploy/helm/*` | Version 1.5.0, supports custom image, resources, securityContext. |
| **Manifest & Script Install**| **Implemented** | `server.ts` (`/api/v1/install/*`), `curl | sh` | Generates cluster-specific tokens, pairing keys, and YAML manifests. |
| **Pod Log Streaming** | **Implemented** | `agent/internal/logs`, `server.ts` | On-demand log requests with tail-lines, container selection, and fallback. |
| **Metrics-Server Ingestion** | **Implemented** | `agent/internal/metrics`, `server.ts` | Direct scrape of `metrics.k8s.io` with fallback to container specs. |
| **Deterministic Detector** | **Implemented** | `server/engine/detector.ts` | 35+ incident types evaluated across 8 resource kinds. |
| **Gemini AI Root Cause** | **Implemented** | `server/ai/*`, `@google/genai` | Multi-model fallback, prompt sanitization, structured JSON output. |
| **Deterministic Intelligence**| **Implemented** | `server/engine/intelligence.ts` | Baseline standard deviations, memory leak projections, blast radius. |
| **Remediation Execution** | **Implemented** | `agent/internal/remediation/executor.go` | `ReplacePodImage`, `RestartPod`, `ScaleDeployment` with auto-rollback. |
| **Remediation Leases** | **Implemented** | `server/engine/policy.ts` | Mutex locking per cluster/namespace to prevent race conditions. |
| **User Authentication** | **Implemented** | `server/auth.ts`, `src/firebase.ts` | Firebase ID token verification against Google public x509 certs. |
| **Agent Authentication** | **Implemented** | `server/auth.ts` (`requireAgentAuth`) | Cryptographic Bearer token with revocation and version handshake. |
| **Multi-Tenancy & RBAC** | **Implemented** | `server/auth.ts` | OWNER, ADMIN, OPERATOR, ENGINEER, VIEWER roles + permissions. |
| **Email Alerts (SMTP)** | **Implemented** | `server/notifications/email.ts` | Nodemailer client with HTML incident alert templates. |
| **Webhooks & Delivery** | **Implemented** | `server/webhooks/dispatcher.ts` | HMAC-SHA256 signatures, exponential backoff, delivery auditing. |
| **Authoritative Store** | **Implemented (Local/Dir)**| `server/store.ts`, `server/persistence.ts` | Thread-safe `DataStore` with atomic JSON file persistence (`PERSISTENCE_PROVIDER=firestore`). |
| **Firestore Persistence** | **Partially Implemented** | `firebase-blueprint.json`, `src/firebase.ts` | Client auth configured; full server-side Firestore migration planned. |
| **Prometheus Exporter Expose**| **Partially Implemented**| `agent/internal/collector/collector.go` | Internal metrics collected; Prometheus `/metrics` endpoint planned. |
| **Multi-Region HA Agent** | **Planned (Roadmap)** | — | Distributed consensus for multiple agent replicas per cluster. |
| **PostgreSQL Backend** | **Planned (Roadmap)** | — | Relational store alternative for large-scale enterprise deployments. |

---

## Quick Navigation

- **Get Up and Running Fast:** Check out the [5-Minute Quickstart Guide](getting-started/quickstart.md).
- **Deploy the Agent in Your Cluster:** Follow the [Agent Installation Guide](agent/installation.md).
- **Configure Telemetry & Tuning:** Inspect the [Agent Configuration Reference](agent/configuration.md).
- **Explore the API:** View the full [REST API Reference](api/reference.md).
- **Resolve Operational Issues:** Consult the [Troubleshooting Playbook](operations/troubleshooting.md).
