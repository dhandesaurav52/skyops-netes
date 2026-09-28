# Developer Guide & Contributing

This guide explains how to set up a local development environment, build both the Node.js control plane and the Go agent, execute test suites, and contribute to SkyOps.

---

## Prerequisites

Before starting, ensure your workstation has:
- **Node.js:** v20.x or higher (`node -v`)
- **npm:** v10.x or higher
- **Go:** v1.22.x or higher (for agent development)
- **Docker:** Engine 24.x+ or Podman
- **Kubernetes CLI (`kubectl`)** and a local cluster (Kind, Minikube, or K3s)

---

## Local Repository Setup

```bash
# 1. Clone the repository
git clone https://github.com/skyops-io/skyops.git
cd skyops

# 2. Install control plane and frontend dependencies
npm install

# 3. Create local environment configuration
cp .env.example .env
```

---

## Running the Control Plane in Development Mode

The development server boots using `tsx` (TypeScript executor) and mounts Vite in middleware mode on port `3000`:

```bash
npm run dev
```

- **Web Console:** Open your browser to `http://localhost:3000`
- **Backend API:** Serves directly under `http://localhost:3000/api/v1/*`
- **Hot Reloading:** Frontend React code and backend API routes reload dynamically on file changes.

---

## Building and Running the Agent Locally

The agent is implemented in Go under `agent/`:

### 1. Compile the Go Binary
```bash
cd agent
go build -o bin/skyops-agent ./cmd/agent/main.go
```

### 2. Run the Agent Locally against a Cluster Context
You can run the agent locally against your current `kubectl` context while pointing it at your local control plane:

```bash
export KUBECONFIG=~/.kube/config
export SKYOPS_CLUSTER_ID="local-dev-cluster"
export SKYOPS_AGENT_TOKEN="skyops_at_demo_token_123"
export SKYOPS_SERVER_URL="http://localhost:3000"
export SKYOPS_LOG_LEVEL="DEBUG"

./bin/skyops-agent
```

### 3. Build the Agent Docker Image
```bash
docker build -t ghcr.io/skyops-io/skyops-agent:v1.5.0 -f agent/Dockerfile .
```

---

## Running Test Suites

SkyOps maintains comprehensive test suites covering unit logic, incident detection, remediation state machines, and API handlers.

### 1. Run Node.js & Server Tests
```bash
npm test
```
*Executes all 23 test suites and 166+ unit tests across detectors, intelligence engines, lease managers, and API sanitizers.*

### 2. Run Agent Go Unit Tests
```bash
cd agent
go test -v ./...
```

### 3. Code Linting & Type Checking
```bash
npm run lint
```

---

## Code Organization & Guidelines

When contributing new features or bug fixes, adhere to these project patterns:

1. **Deterministic Alerting:** Never implement alerting rules that depend solely on non-deterministic LLM queries. All incident detection logic must reside in `server/engine/detector.ts` as verifiable rule checks.
2. **Atomic Persistence:** When extending `server/store.ts`, ensure new entities are included in the periodic flush serialization in `server/persistence.ts`.
3. **Agent Backward Compatibility:** Changes to the agent wire format (`TelemetryPayload`, `Heartbeat`) must maintain backward compatibility with older agent minor versions.
4. **Defensive Mutation:** Any cluster mutation implemented in `agent/internal/remediation/` must implement the 4-phase lifecycle:
   - `PreconditionCheck()`
   - `Execute()`
   - `Verify()`
   - `Rollback()`
