import { dump } from 'js-yaml';
import { AGENT_DEFAULT_NAMESPACE, AGENT_IMAGE_REPOSITORY, AGENT_VERSION } from '../src/config/version';

export interface ManifestConfig {
  clusterId: string;
  clusterName: string;
  token: string;
  serverUrl: string;
  agentVersion?: string;
  namespace?: string;
}

export function generateKubernetesManifest(config: ManifestConfig): string {
  const namespace = config.namespace || AGENT_DEFAULT_NAMESPACE;
  const agentVersion = config.agentVersion || AGENT_VERSION;
  const encodedToken = Buffer.from(config.token).toString('base64');
  const encodedServer = Buffer.from(config.serverUrl).toString('base64');
  const encodedClusterId = Buffer.from(config.clusterId).toString('base64');

  const documents = [
    {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name: namespace,
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
          'app.kubernetes.io/part-of': 'skyops',
        },
      },
    },
    {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: {
        name: 'skyops-agent',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
        },
      },
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: {
        name: 'skyops-agent-reader',
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
        },
      },
      rules: [
        {
          apiGroups: [''],
          resources: ['pods'],
          verbs: ['get', 'list', 'watch', 'create', 'delete'],
        },
        {
          apiGroups: [''],
          resources: [
            'pods/status',
            'nodes',
            'nodes/status',
            'namespaces',
            'services',
            'persistentvolumeclaims',
            'persistentvolumes',
            'configmaps',
            'events',
          ],
          verbs: ['get', 'list', 'watch'],
        },
        {
          apiGroups: ['apps'],
          resources: [
            'deployments',
            'deployments/status',
            'statefulsets',
            'statefulsets/status',
            'daemonsets',
            'daemonsets/status',
            'replicasets',
          ],
          verbs: ['get', 'list', 'watch'],
        },
        {
          apiGroups: ['batch'],
          resources: ['jobs', 'cronjobs'],
          verbs: ['get', 'list', 'watch'],
        },
        {
          apiGroups: ['networking.k8s.io'],
          resources: ['ingresses'],
          verbs: ['get', 'list', 'watch'],
        },
        {
          apiGroups: ['metrics.k8s.io'],
          resources: ['nodes', 'pods'],
          verbs: ['get', 'list'],
        },
      ],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: {
        name: 'skyops-agent-reader-binding',
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
        },
      },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'skyops-agent-reader',
      },
      subjects: [
        {
          kind: 'ServiceAccount',
          name: 'skyops-agent',
          namespace,
        },
      ],
    },
    {
      apiVersion: 'v1',
      kind: 'Secret',
      metadata: {
        name: 'skyops-agent-credentials',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
        },
      },
      type: 'Opaque',
      data: {
        SKYOPS_AGENT_TOKEN: encodedToken,
        SKYOPS_SERVER_URL: encodedServer,
        SKYOPS_CLUSTER_ID: encodedClusterId,
      },
    },
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: 'skyops-agent',
        namespace,
        labels: {
          'app.kubernetes.io/name': 'skyops-agent',
          'app.kubernetes.io/version': agentVersion,
        },
      },
      spec: {
        replicas: 1,
        selector: {
          matchLabels: {
            'app.kubernetes.io/name': 'skyops-agent',
          },
        },
        template: {
          metadata: {
            labels: {
              'app.kubernetes.io/name': 'skyops-agent',
            },
          },
          spec: {
            serviceAccountName: 'skyops-agent',
            terminationGracePeriodSeconds: 30,
            containers: [
              {
                name: 'skyops-agent',
                image: `${AGENT_IMAGE_REPOSITORY}:${agentVersion}`,
                imagePullPolicy: 'IfNotPresent',
                env: [
                  {
                    name: 'SKYOPS_CLUSTER_ID',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'skyops-agent-credentials',
                        key: 'SKYOPS_CLUSTER_ID',
                      },
                    },
                  },
                  {
                    name: 'SKYOPS_AGENT_TOKEN',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'skyops-agent-credentials',
                        key: 'SKYOPS_AGENT_TOKEN',
                      },
                    },
                  },
                  {
                    name: 'SKYOPS_SERVER_URL',
                    valueFrom: {
                      secretKeyRef: {
                        name: 'skyops-agent-credentials',
                        key: 'SKYOPS_SERVER_URL',
                      },
                    },
                  },
                  {
                    name: 'NODE_NAME',
                    valueFrom: {
                      fieldRef: {
                        fieldPath: 'spec.nodeName',
                      },
                    },
                  },
                ],
                resources: {
                  limits: {
                    cpu: '250m',
                    memory: '256Mi',
                  },
                  requests: {
                    cpu: '50m',
                    memory: '64Mi',
                  },
                },
                securityContext: {
                  readOnlyRootFilesystem: true,
                  allowPrivilegeEscalation: false,
                  runAsNonRoot: true,
                  runAsUser: 65532,
                  capabilities: {
                    drop: ['ALL'],
                  },
                },
              },
            ],
          },
        },
      },
    },
  ];

  return documents.map(doc => dump(doc, { lineWidth: 1000, noRefs: true })).join('---\n');
}

export function generateInstallScript(config: ManifestConfig & { installKey?: string }): string {
  const namespace = config.namespace || AGENT_DEFAULT_NAMESPACE;
  const agentVersion = config.agentVersion || AGENT_VERSION;
  const manifestYaml = generateKubernetesManifest(config);

  return `#!/usr/bin/env bash
# ==============================================================================
# SkyOps In-Cluster Agent One-Command Installer
# Cluster ID: ${config.clusterId} (${config.clusterName})
# SkyOps Server: ${config.serverUrl}
# ==============================================================================

set -euo pipefail

RED='\\033[0;31m'
GREEN='\\033[0;32m'
BLUE='\\033[0;34m'
CYAN='\\033[0;36m'
YELLOW='\\033[1;33m'
BOLD='\\033[1m'
NC='\\033[0m'

log_info() {
    echo -e "\${CYAN}[SkyOps]\${NC} \$1"
}

log_success() {
    echo -e "\${GREEN}[SkyOps ✓]\${NC} \${BOLD}\$1\${NC}"
}

log_warn() {
    echo -e "\${YELLOW}[SkyOps ⚠]\${NC} \$1"
}

log_error() {
    echo -e "\${RED}[SkyOps ✗] ERROR:\${NC} \$1" >&2
}

echo -e "\${BLUE}======================================================================\${NC}"
echo -e "\${BOLD}   SkyOps Kubernetes In-Cluster Agent Installer                       \${NC}"
echo -e "\${BLUE}======================================================================\${NC}"
echo -e "Target Cluster:  \${BOLD}${config.clusterName}\${NC} (${config.clusterId})"
echo -e "Central Server:  \${CYAN}${config.serverUrl}\${NC}"
echo -e "Agent Version:   \${BOLD}${agentVersion}\${NC}"
echo -e "\${BLUE}----------------------------------------------------------------------\${NC}"

# 1. Preflight Check: Verify kubectl command availability
log_info "Verifying prerequisite tools..."
if ! command -v kubectl >/dev/null 2>&1; then
    log_error "The 'kubectl' command-line tool was not found in your PATH."
    echo -e "Please install kubectl and configure your Kubernetes context before running this installer."
    exit 1
fi
log_success "Found kubectl CLI utility"

# 2. Preflight Check: Verify active Kubernetes cluster connection
log_info "Verifying connectivity to Kubernetes cluster..."
if ! CURRENT_CTX=\$(kubectl config current-context 2>/dev/null); then
    log_error "No active Kubernetes context found. Please run 'kubectl config use-context <context>' or set KUBECONFIG."
    exit 1
fi
log_info "Active context: \${BOLD}\${CURRENT_CTX}\${NC}"

if ! kubectl cluster-info >/dev/null 2>&1 && ! kubectl get nodes >/dev/null 2>&1; then
    log_error "Unable to contact Kubernetes API server. Please check your cluster connection and kubeconfig."
    exit 1
fi
log_success "Connected to Kubernetes cluster API server"

# 3. Preflight Check: Validate RBAC permissions
log_info "Checking necessary RBAC privileges for namespace & ClusterRole installation..."
CAN_CREATE_NS=\$(kubectl auth can-i create namespaces 2>/dev/null || echo "unknown")
CAN_CREATE_CR=\$(kubectl auth can-i create clusterroles 2>/dev/null || echo "unknown")
if [ "\$CAN_CREATE_NS" = "no" ] || [ "\$CAN_CREATE_CR" = "no" ]; then
    log_warn "Current user might not have sufficient permissions to create cluster-scoped roles."
    log_warn "If this step fails, re-run with a cluster-admin context."
fi

# 4. Deploy SkyOps Agent Manifest
log_info "Applying SkyOps Agent manifests (Namespace, ServiceAccount, ClusterRole, Secret, Deployment)..."

cat <<'EOF_SKYOPS_MANIFEST' | kubectl apply -f -
${manifestYaml}
EOF_SKYOPS_MANIFEST

log_success "Manifests successfully applied to namespace '${namespace}'"

# 5. Wait for agent deployment rollout
log_info "Waiting for SkyOps Agent deployment to become Ready (up to 90 seconds)..."
if kubectl rollout status deployment/skyops-agent -n "${namespace}" --timeout=90s; then
    log_success "SkyOps Agent deployment is active and running!"
else
    log_warn "Deployment rollout timed out or is still starting. Checking pod status..."
fi

# 6. Verify Pod status
POD_NAME=\$(kubectl get pods -n "${namespace}" -l app.kubernetes.io/name=skyops-agent -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
if [ -n "\$POD_NAME" ]; then
    POD_STATUS=\$(kubectl get pod "\$POD_NAME" -n "${namespace}" -o jsonpath='{.status.phase}' 2>/dev/null || echo "Unknown")
    log_info "Agent Pod: \${BOLD}\${POD_NAME}\${NC} (Status: \${POD_STATUS})"
fi

echo -e "\\n\${GREEN}======================================================================\${NC}"
echo -e "\${GREEN}\${BOLD}   SkyOps Agent Installation Complete!                                \${NC}"
echo -e "\${GREEN}======================================================================\${NC}"
echo -e "Cluster ID:      \${BOLD}${config.clusterId}\${NC}"
echo -e "Cluster Name:    \${BOLD}${config.clusterName}\${NC}"
echo -e "Namespace:       \${BOLD}${namespace}\${NC}"
echo -e "Dashboard URL:   \${CYAN}${config.serverUrl}/clusters/${config.clusterId}\${NC}"
echo -e "\${GREEN}----------------------------------------------------------------------\${NC}"
echo -e "To view agent logs at any time, run:"
echo -e "  \${BOLD}kubectl logs -n ${namespace} -l app.kubernetes.io/name=skyops-agent -f\${NC}\\n"
`;
}

export function generateOneCommandInstall(serverUrl: string, installKey: string): string {
  return `curl -fsSL "${serverUrl}/api/v1/install/${installKey}" | bash`;
}

export function generateHelmCommand(config: ManifestConfig): string {
  const namespace = config.namespace || AGENT_DEFAULT_NAMESPACE;
  return `helm repo add skyops https://charts.skyops.io
helm repo update
helm upgrade --install skyops-agent skyops/skyops-agent \\
  --namespace ${namespace} \\
  --create-namespace \\
  --set clusterId="${config.clusterId}" \\
  --set agentToken="${config.token}" \\
  --set serverUrl="${config.serverUrl}"`;
}

export function generateKubectlCommand(serverUrl: string, clusterId: string, installKey?: string): string {
  const installParam = installKey ? `?key=${installKey}` : '';
  return `kubectl apply -f "${serverUrl}/api/v1/clusters/${clusterId}/manifest.yaml${installParam}"`;
}

export function generateInstallCommand(serverUrl: string, clusterId: string, installKey?: string): string {
  const installParam = installKey ? `?key=${installKey}` : '';
  return `kubectl apply -f "${serverUrl}/api/v1/clusters/${clusterId}/manifest.yaml${installParam}"`;
}

export function generateHelmValues(config: ManifestConfig): string {
  return `replicaCount: 1
image:
  repository: ${AGENT_IMAGE_REPOSITORY}
  pullPolicy: IfNotPresent
  tag: "${config.agentVersion || AGENT_VERSION}"

clusterId: "${config.clusterId}"
agentToken: "${config.token}"
serverUrl: "${config.serverUrl}"

resources:
  limits:
    cpu: 250m
    memory: 256Mi
  requests:
    cpu: 50m
    memory: 64Mi

securityContext:
  readOnlyRootFilesystem: true
  allowPrivilegeEscalation: false
  runAsNonRoot: true
  runAsUser: 65532
`;
}
