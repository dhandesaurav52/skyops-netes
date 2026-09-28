import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  HelpCircle,
  Key,
  Layers,
  Lock,
  Mail,
  Network,
  Radio,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Terminal,
  X,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';

export type DocTopic =
  | 'quickstart'
  | 'connect-cluster'
  | 'agent-guide'
  | 'metrics'
  | 'logs'
  | 'events'
  | 'incidents'
  | 'remediation'
  | 'security-model'
  | 'architecture'
  | 'rbac'
  | 'persistence'
  | 'api-reference'
  | 'troubleshooting'
  | 'support';

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTopic?: DocTopic;
  onGetStarted?: () => void;
}

interface DocArticle {
  id: DocTopic;
  title: string;
  category: 'Get Started' | 'Observability' | 'Intelligence' | 'Security' | 'Reference' | 'Support';
  icon: React.ElementType;
  badge?: string;
  summary: string;
  content: React.ReactNode;
}

export const KnowledgeBaseModal: React.FC<KnowledgeBaseModalProps> = ({
  isOpen,
  onClose,
  initialTopic = 'quickstart',
  onGetStarted
}) => {
  const [activeTopic, setActiveTopic] = useState<DocTopic>(initialTopic);

  useEffect(() => {
    if (initialTopic) {
      setActiveTopic(initialTopic);
    }
  }, [initialTopic]);

  // Handle ESC key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const articles: DocArticle[] = [
    {
      id: 'quickstart',
      title: 'Getting Started',
      category: 'Get Started',
      icon: Terminal,
      badge: '5-min Onboarding',
      summary: 'Register your cluster, install the lightweight agent, and start receiving real-time telemetry.',
      content: (
        <div className="space-y-6 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps provides continuous Kubernetes incident management and root-cause analysis through a single non-privileged agent deployed in your cluster.
          </p>

          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs">1</span>
              Register Your Cluster
            </h4>
            <p className="text-xs text-zinc-400">
              In the SkyOps console, click <strong>Add Cluster</strong>. Select your cloud provider or distribution (AWS EKS, Google GKE, Azure AKS, K3s, Kind, or Bare Metal). SkyOps issues a unique, revocable cluster token (<code className="text-sky-300">skyops_at_...</code>).
            </p>
          </div>

          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs">2</span>
              Deploy the Lightweight Agent
            </h4>
            <p className="text-xs text-zinc-400">
              Execute the single-line bootstrap script in your terminal using <code className="text-zinc-200">kubectl</code>:
            </p>
            <div className="rounded-lg bg-zinc-950 p-3 border border-zinc-800/80 font-mono text-xs text-sky-300 overflow-x-auto select-all">
              curl -sSL https://skyops.io/api/v1/install/[SESSION_KEY]/install.sh | bash
            </div>
            <p className="text-xs text-zinc-500">
              Or use the official Helm chart: <code className="text-zinc-300 font-mono">helm install skyops-agent skyops/skyops-agent --set clusterId=...</code>
            </p>
          </div>

          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded bg-sky-500/20 text-sky-400 flex items-center justify-center text-xs">3</span>
              Automatic Connection Handshake
            </h4>
            <p className="text-xs text-zinc-400">
              The agent initializes in <code className="text-zinc-200">skyops-system</code>, queries <code className="text-zinc-200">kube-apiserver</code>, and performs an outbound TLS handshake with the control plane. Status automatically transitions from <em>Installing</em> to <em>Connected</em> within 10 seconds.
            </p>
          </div>

          {onGetStarted && (
            <div className="pt-2">
              <button
                id="doc-modal-quickstart-cta"
                onClick={() => {
                  onClose();
                  onGetStarted();
                }}
                className="px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold text-xs rounded-lg transition-all inline-flex items-center gap-2 cursor-pointer shadow-lg shadow-sky-500/20"
              >
                Connect Your Cluster Now
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )
    },
    {
      id: 'connect-cluster',
      title: 'Connect Cluster',
      category: 'Get Started',
      icon: Server,
      badge: 'Helm & Kubectl',
      summary: 'Complete technical specifications for connecting managed or self-hosted Kubernetes clusters.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps connects to any Kubernetes v1.24+ cluster with zero open inbound firewall ports. The connection is maintained solely through outbound HTTPS requests initiated by the agent.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Installation Methods</h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sky-400 font-semibold text-xs font-mono">
                <Terminal className="w-4 h-4" />
                Automated One-Line Script
              </div>
              <p className="text-xs text-zinc-400">
                Downloads pre-rendered Kubernetes manifests, creates the <code className="text-zinc-300">skyops-system</code> namespace, injects tokens into Kubernetes Secrets, and applies RBAC rules.
              </p>
            </div>

            <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-4 space-y-2">
              <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs font-mono">
                <Layers className="w-4 h-4" />
                Helm Chart
              </div>
              <p className="text-xs text-zinc-400">
                Native GitOps deployment via ArgoCD or Flux. Full control over affinity, nodeSelectors, tolerations, and resource limits via <code className="text-zinc-300">values.yaml</code>.
              </p>
            </div>
          </div>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Lifecycle Connection States</h4>
          <ul className="space-y-2 text-xs font-mono">
            <li className="flex items-center gap-2 p-2 rounded bg-zinc-900/40 border border-zinc-800/60">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <strong className="text-zinc-200">pending:</strong> Cluster entity registered; waiting for first agent registration request.
            </li>
            <li className="flex items-center gap-2 p-2 rounded bg-zinc-900/40 border border-zinc-800/60">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <strong className="text-zinc-200">connected:</strong> Heartbeats and telemetry received within the last 30 seconds.
            </li>
            <li className="flex items-center gap-2 p-2 rounded bg-zinc-900/40 border border-zinc-800/60">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <strong className="text-zinc-200">reconnecting / stale:</strong> No heartbeat received for 30–90 seconds; agent buffer spooled.
            </li>
            <li className="flex items-center gap-2 p-2 rounded bg-zinc-900/40 border border-zinc-800/60">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <strong className="text-zinc-200">offline:</strong> No telemetry received for 90+ seconds; connection alert dispatched.
            </li>
          </ul>
        </div>
      )
    },
    {
      id: 'agent-guide',
      title: 'Agent Guide',
      category: 'Get Started',
      icon: Cpu,
      badge: 'skyops-agent v1.5.0',
      summary: 'Go daemon architecture, disk spool-and-forward, non-root privileges, and resource footprint.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            The <code className="text-sky-300">skyops-agent</code> is a single-replica compiled Go daemon built on Kubernetes <code className="text-zinc-200">client-go</code> informers. It monitors workload state changes with microsecond latency.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-500 font-mono">CPU Request/Limit</div>
              <div className="text-base font-bold font-mono text-zinc-100 mt-1">20m / 50m</div>
            </div>
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-500 font-mono">Memory Footprint</div>
              <div className="text-base font-bold font-mono text-zinc-100 mt-1">32Mi / 64Mi</div>
            </div>
            <div className="rounded-lg bg-zinc-900/80 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-500 font-mono">Security User</div>
              <div className="text-base font-bold font-mono text-emerald-400 mt-1">Non-Root (UID 10001)</div>
            </div>
          </div>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Spool & Forward Engine</h4>
          <p className="text-xs text-zinc-400">
            If network transit between your cluster and the control plane is interrupted, the agent automatically buffers telemetry events to an in-memory ring buffer, spilling over to encrypted local disk storage (<code className="text-zinc-300">/var/spool/skyops-agent</code>). When connectivity is restored, telemetry is flushed sequentially without loss.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Least-Privilege RBAC</h4>
          <p className="text-xs text-zinc-400">
            The agent operates under a read-only ClusterRole for standard telemetry collection:
          </p>
          <div className="rounded-lg bg-zinc-950 p-3 border border-zinc-800/80 font-mono text-xs text-zinc-300 overflow-x-auto">
            verbs: [&quot;get&quot;, &quot;list&quot;, &quot;watch&quot;]<br />
            resources: [&quot;pods&quot;, &quot;nodes&quot;, &quot;services&quot;, &quot;deployments&quot;, &quot;statefulsets&quot;, &quot;daemonsets&quot;, &quot;events&quot;, &quot;namespaces&quot;]
          </div>
        </div>
      )
    },
    {
      id: 'metrics',
      title: 'Metrics',
      category: 'Observability',
      icon: Activity,
      badge: 'metrics.k8s.io',
      summary: 'Cluster-wide CPU/memory ingestion, Metrics-Server integration, and 2.5-sigma baseline anomaly detection.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps ingests node and container CPU millicores and memory usage bytes directly from Kubernetes <code className="text-zinc-200">metrics.k8s.io</code> every 10 seconds.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Dynamic Baseline Anomaly Detection</h4>
          <p className="text-xs text-zinc-400">
            Rather than relying on static thresholds that create alert fatigue, the SkyOps Intelligence Engine calculates a rolling Gaussian baseline across your workload history:
          </p>

          <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 p-4 text-center font-mono text-sm text-sky-400">
            Upper Limit = &mu; + 2.5 &times; &sigma; &nbsp; (Mean + 2.5 Standard Deviations)
          </div>

          <p className="text-xs text-zinc-400">
            When a pod or node exceeds 2.5 standard deviations above its rolling average for 3 consecutive scrapes, SkyOps triggers an infrastructure anomaly alert with supporting historical evidence.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Metrics-Server Fallback Handling</h4>
          <p className="text-xs text-zinc-400">
            If <code className="text-zinc-300">metrics-server</code> is not installed in the cluster, SkyOps falls back to resource request/limit allocations from the Pod spec. The UI provides a one-click verification modal with exact install commands to enable live CPU/memory metrics.
          </p>
        </div>
      )
    },
    {
      id: 'logs',
      title: 'Logs',
      category: 'Observability',
      icon: FileText,
      badge: 'On-Demand Streaming',
      summary: 'Ephemeral pod log retrieval pipeline, 512KB tail safety bounds, and crash diagnostics.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps utilizes an <strong>On-Demand Log Streaming Pipeline</strong>. Unlike traditional log aggregators that continuously ingest and store terabytes of cluster logs, SkyOps queries container logs directly from the Kubernetes API only when an SRE opens an investigation.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Crash Diagnostic Fallback (Previous: true)</h4>
          <p className="text-xs text-zinc-400">
            When a pod enters <code className="text-rose-400">CrashLoopBackOff</code> or OOMKilled states, the active container is terminated and logs may be empty. The SkyOps Log Viewer automatically detects this state and queries the previous terminated container instance (<code className="text-zinc-300">previous=true</code>), surfacing the exact panic or stack trace that triggered the crash.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Bandwidth & Memory Protection</h4>
          <ul className="space-y-2 text-xs text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <strong>512KB Payload Cap:</strong> Protects control plane memory and browser DOM from multi-gigabyte log floods.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <strong>Tail Window:</strong> Queries the last 100–500 lines or 15–60 minutes of container execution.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <strong>Secret Redaction:</strong> Automatically scrubs bearer tokens, private keys, and environment passwords before display or AI analysis.
            </li>
          </ul>
        </div>
      )
    },
    {
      id: 'events',
      title: 'Events',
      category: 'Observability',
      icon: Radio,
      badge: 'Lifecycle Auditing',
      summary: 'Real-time Kubernetes Warning and Normal event ingestion, deduplication, and evidence binding.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            Kubernetes events reveal scheduler rejections, image pull failures, probe timeouts, and volume mount issues. SkyOps streams all cluster events in real-time, grouping related event occurrences to avoid spam.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Automated Evidence Binding</h4>
          <p className="text-xs text-zinc-400">
            When an incident is detected (e.g., <code className="text-amber-300">CrashLoopBackOff</code> on a deployment), SkyOps automatically filters and binds the exact chronological event sequence (<code className="text-zinc-300">BackOff</code>, <code className="text-zinc-300">Failed</code>, <code className="text-zinc-300">Unhealthy</code>) to the incident ticket, giving responders immediate context.
          </p>

          <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 space-y-2 text-xs font-mono">
            <div className="text-zinc-500 font-bold">Monitored Event Reasons:</div>
            <div className="grid grid-cols-2 gap-2 text-zinc-300">
              <div>• FailedScheduling</div>
              <div>• FailedMount</div>
              <div>• BackOff (CrashLoop)</div>
              <div>• FailedSync</div>
              <div>• Unhealthy (Liveness/Readiness)</div>
              <div>• NodeNotReady</div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'incidents',
      title: 'Incident Intelligence',
      category: 'Intelligence',
      icon: AlertTriangle,
      badge: 'Deterministic + AI',
      summary: 'Deterministic SHA-256 fingerprinting, severity mapping, and Google Gemini root cause analysis.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps enforces a strict two-layer incident philosophy: <strong>Alerts are detected deterministically; investigations are assisted by AI.</strong>
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Deterministic SHA-256 Deduplication</h4>
          <p className="text-xs text-zinc-400">
            To prevent alert storms during cascading cluster failures, SkyOps computes a deterministic SHA-256 hash for every failure:
          </p>
          <div className="rounded-lg bg-zinc-950 p-3 border border-zinc-800/80 font-mono text-xs text-sky-400">
            Fingerprint = SHA256(ClusterID + Namespace + Kind + Name + IncidentType)
          </div>
          <p className="text-xs text-zinc-400">
            Subsequent observations increment the incident occurrence counter and update the timeline without creating duplicate tickets.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">AI Root-Cause Analysis (Gemini)</h4>
          <p className="text-xs text-zinc-400">
            Powered by Google Gemini models (<code className="text-zinc-300">gemini-3.1-flash-lite</code> / <code className="text-zinc-300">gemini-3.8-flash</code>), the investigation engine ingests pod specs, event history, exit codes, and sanitized crash logs to provide:
          </p>
          <ul className="space-y-1.5 text-xs text-zinc-400">
            <li className="flex items-center gap-2">• Plain-English explanation of why the workload failed</li>
            <li className="flex items-center gap-2">• Confidence scoring with verifiable evidence citations</li>
            <li className="flex items-center gap-2">• Recommended kubectl remediation commands and prevention steps</li>
          </ul>
        </div>
      )
    },
    {
      id: 'remediation',
      title: 'Safe Remediation',
      category: 'Intelligence',
      icon: Zap,
      badge: 'Atomic Rollback',
      summary: 'Action leases, protected system namespaces, human approval gates, and 60-second atomic rollback.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            Automated cluster changes require defense-in-depth. The SkyOps Remediation Engine guarantees that no unauthorized or destructive change can compromise your production infrastructure.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Safety Guarantees</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 space-y-1">
              <strong className="text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Protected Namespaces
              </strong>
              <p className="text-zinc-400">
                Remediations are strictly blocked in <code className="text-zinc-300">kube-system</code>, <code className="text-zinc-300">kube-public</code>, <code className="text-zinc-300">kube-node-lease</code>, and <code className="text-zinc-300">skyops-system</code>.
              </p>
            </div>
            <div className="rounded-lg bg-zinc-900/60 border border-zinc-800 p-3 space-y-1">
              <strong className="text-sky-400 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                Cluster Action Leases
              </strong>
              <p className="text-zinc-400">
                Distributed mutual-exclusion locks prevent concurrent mutations on the same namespace or workload.
              </p>
            </div>
          </div>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Atomic Rollback</h4>
          <p className="text-xs text-zinc-400">
            Before applying any patch (e.g., rolling back an image tag or restarting a pod), the agent captures a resource snapshot. If post-remediation readiness probes fail within the verification window (default 60 seconds), the agent immediately reverts the workload to its pre-execution state.
          </p>
        </div>
      )
    },
    {
      id: 'security-model',
      title: 'Security Model',
      category: 'Security',
      icon: Shield,
      badge: 'Zero Inbound Ports',
      summary: 'Outbound-only TLS architecture, non-root agent container, least-privilege RBAC, and secret stripping.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps is designed for zero-trust environments. The agent operates inside your private Kubernetes network without exposing any public ingress or listening ports.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Zero Ingress Ports</h4>
          <p className="text-xs text-zinc-400">
            Your firewall requires no open inbound ports, port forwards, or ingress controllers for SkyOps. If the SkyOps central server were ever compromised, an attacker cannot pivot into your cluster because there are no listening network endpoints.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Cryptographic Token Isolation</h4>
          <p className="text-xs text-zinc-400">
            Each cluster uses an isolated 48-character bearer token (<code className="text-zinc-300">skyops_at_...</code>). A cluster token can only push telemetry for its own ID and poll actions specifically assigned to it. Tokens can be revoked or rotated instantly from the console.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider pt-2">Automated Secret Redaction</h4>
          <p className="text-xs text-zinc-400">
            Log payloads and environment variables pass through regex scrubbers before egress, sanitizing JWT tokens, RSA private keys, AWS access keys, and passwords before they reach the control plane.
          </p>
        </div>
      )
    },
    {
      id: 'architecture',
      title: 'Architecture',
      category: 'Security',
      icon: Network,
      badge: 'Topology Overview',
      summary: 'End-to-end component topology connecting Kubernetes worker nodes, the control plane, and the SRE console.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            The SkyOps platform comprises three decoupled subsystems communicating over secure TLS 1.3 channels:
          </p>

          <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 font-mono text-xs text-zinc-300 space-y-3">
            <div className="text-sky-400 font-bold">[Customer Kubernetes VPC]</div>
            <div className="pl-4 text-zinc-400">
              └─ skyops-agent Pod (Go binary, UID 10001)<br />
              &nbsp;&nbsp;&nbsp;&nbsp;├─ Reads kube-apiserver resources &amp; events<br />
              &nbsp;&nbsp;&nbsp;&nbsp;├─ Scrapes metrics.k8s.io every 10s<br />
              &nbsp;&nbsp;&nbsp;&nbsp;└─ Outbound HTTPS TLS (Port 443) ────────────┐
            </div>
            <div className="text-indigo-400 font-bold">[SkyOps Control Plane] &lt;───────────────────┘</div>
            <div className="pl-4 text-zinc-400">
              ├─ Express API Server + DataStore engine<br />
              ├─ Deterministic Rule Evaluation &amp; Anomaly Engine<br />
              ├─ Google Gemini Integration for AI Investigations<br />
              └─ REST API (Bearer JWT authenticated) ──────────────┐
            </div>
            <div className="text-emerald-400 font-bold">[Operator Console] &lt;──────────────────────────────────┘</div>
            <div className="pl-4 text-zinc-400">
              └─ React SRE Console (Dashboard, Logs, Incidents, Settings)
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'rbac',
      title: 'RBAC & Tenant Isolation',
      category: 'Security',
      icon: Key,
      badge: '5 Role Tiers',
      summary: 'Firebase Auth ID token verification, multi-tenant organization boundary, and role matrix.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            SkyOps enforces strict multi-tenancy. Every cluster, incident, metric, and log line is permanently partitioned by <code className="text-sky-300">orgId</code>. Cross-organization access is cryptographically blocked at the API gateway layer.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Five-Tier Role Hierarchy</h4>
          <div className="space-y-2 text-xs">
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 flex items-start gap-2">
              <span className="font-mono font-bold text-amber-400 w-24">OWNER</span>
              <span className="text-zinc-400">Full organization control, billing, member deletion, and cluster deletion.</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 flex items-start gap-2">
              <span className="font-mono font-bold text-sky-400 w-24">ADMIN</span>
              <span className="text-zinc-400">Cluster onboarding, token rotation, notification settings, and user invites.</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 flex items-start gap-2">
              <span className="font-mono font-bold text-emerald-400 w-24">ENGINEER</span>
              <span className="text-zinc-400">Incident triage, AI investigations, pod log queries, and remediation execution.</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 flex items-start gap-2">
              <span className="font-mono font-bold text-zinc-300 w-24">ANALYST</span>
              <span className="text-zinc-400">Read-only access to metrics, incidents, service topology, and audit logs.</span>
            </div>
            <div className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800 flex items-start gap-2">
              <span className="font-mono font-bold text-zinc-500 w-24">VIEWER</span>
              <span className="text-zinc-400">Read-only dashboard overview and cluster health indicators.</span>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'persistence',
      title: 'Data & Persistence',
      category: 'Security',
      icon: Database,
      badge: 'Fail-Closed Atomic Store',
      summary: 'In-memory DataStore, atomic filesystem persistence (PERSISTENCE_PROVIDER=firestore), and automated recovery.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            The SkyOps control plane utilizes an authoritative in-memory state engine backed by atomic disk persistence. All transactions are committed to temporary files before being renamed into place, preventing corruption during power loss or container crashes.
          </p>

          <h4 className="text-xs font-mono font-bold text-zinc-200 uppercase tracking-wider">Persistence Guarantees</h4>
          <ul className="space-y-2 text-xs text-zinc-400">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <strong>Atomic Write-Rename:</strong> Files are written to <code className="text-zinc-300">.tmp</code> buffers and atomically renamed to prevent partial writes.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <strong>Volume Mount Support:</strong> Set <code className="text-zinc-300">PERSISTENCE_PROVIDER=firestore</code> to bind to Kubernetes PVCs or persistent cloud disks.
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <strong>Tiered Metric Pruning:</strong> High-resolution 10-second telemetry is rolled up into hourly averages after 24 hours to ensure constant disk efficiency.
            </li>
          </ul>
        </div>
      )
    },
    {
      id: 'api-reference',
      title: 'API Reference',
      category: 'Reference',
      icon: BookOpen,
      badge: 'REST v1',
      summary: 'Comprehensive endpoints for cluster management, telemetry, incidents, and webhook integrations.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            All SkyOps endpoints are versioned under <code className="text-sky-300">/api/v1/</code> and require either a user Bearer JWT or an agent token header.
          </p>

          <div className="space-y-3 font-mono text-xs">
            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-emerald-400">GET</span>
                <span className="text-zinc-200">/api/v1/clusters</span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-1 font-sans">List all clusters in the active organization with health states.</p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-sky-400">POST</span>
                <span className="text-zinc-200">/api/v1/clusters</span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-1 font-sans">Register a new cluster and provision an agent bearer token.</p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-emerald-400">GET</span>
                <span className="text-zinc-200">/api/v1/incidents</span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-1 font-sans">List deduplicated incident tickets filtered by status and severity.</p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-purple-400">POST</span>
                <span className="text-zinc-200">/api/v1/incidents/:id/ai-analysis</span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-1 font-sans">Trigger Gemini AI root-cause investigation across incident evidence.</p>
            </div>

            <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-emerald-400">GET</span>
                <span className="text-zinc-200">/api/v1/clusters/:id/pods/:ns/:pod/logs</span>
              </div>
              <p className="text-zinc-400 text-[11px] mt-1 font-sans">Stream on-demand container logs with optional previous crash tail.</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      category: 'Support',
      icon: HelpCircle,
      badge: 'SRE Runbooks',
      summary: 'Diagnostic procedures for agent connection drops, log streaming errors, and metrics timeouts.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            Common operational scenarios and step-by-step diagnostic runbooks:
          </p>

          <div className="space-y-4">
            <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-2">
              <h5 className="text-xs font-mono font-bold text-amber-400">1. Cluster Shows &quot;Pending&quot; or &quot;Offline&quot;</h5>
              <p className="text-xs text-zinc-400">
                Verify the agent pod is running in your cluster:
              </p>
              <div className="rounded bg-zinc-950 p-2 font-mono text-xs text-sky-300 select-all">
                kubectl get pods -n skyops-system -l app=skyops-agent
              </div>
              <p className="text-xs text-zinc-400">
                Check agent pod logs for network errors:
              </p>
              <div className="rounded bg-zinc-950 p-2 font-mono text-xs text-sky-300 select-all">
                kubectl logs -n skyops-system -l app=skyops-agent --tail=50
              </div>
            </div>

            <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-2">
              <h5 className="text-xs font-mono font-bold text-amber-400">2. CPU/Memory Graphs Show &quot;No Metric Data&quot;</h5>
              <p className="text-xs text-zinc-400">
                Ensure <code className="text-zinc-300">metrics-server</code> is running in the cluster:
              </p>
              <div className="rounded bg-zinc-950 p-2 font-mono text-xs text-sky-300 select-all">
                kubectl top nodes &amp;&amp; kubectl top pods -A
              </div>
              <p className="text-xs text-zinc-400">
                If not installed, deploy with:
              </p>
              <div className="rounded bg-zinc-950 p-2 font-mono text-xs text-sky-300 select-all">
                kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
              </div>
            </div>

            <div className="rounded-xl bg-zinc-900/80 border border-zinc-800 p-4 space-y-2">
              <h5 className="text-xs font-mono font-bold text-amber-400">3. Log Streaming Returns 404 or Timeout</h5>
              <p className="text-xs text-zinc-400">
                If a container crashed repeatedly, enable the <em>&quot;Previous Crash Logs&quot;</em> toggle in the log viewer to retrieve the terminated container buffer.
              </p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'support',
      title: 'Contact Support',
      category: 'Support',
      icon: Mail,
      badge: 'Official SRE Channel',
      summary: 'Direct engineering support channel for SkyOps operators and customers.',
      content: (
        <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
          <p>
            The SkyOps reliability engineering team is available to assist with cluster integration, agent troubleshooting, custom alerts, or security reviews.
          </p>

          <div className="rounded-xl bg-zinc-900/90 border border-zinc-800 p-5 space-y-3">
            <div className="text-xs text-zinc-500 font-mono uppercase tracking-wider">Official Support Email</div>
            <div className="flex items-center gap-3">
              <a
                href="mailto:skyopsnetes2000@gmail.com"
                className="text-lg font-mono font-bold text-sky-400 hover:text-sky-300 underline underline-offset-4 flex items-center gap-2"
              >
                <Mail className="w-5 h-5 text-sky-400" />
                skyopsnetes2000@gmail.com
              </a>
            </div>
            <p className="text-xs text-zinc-400 pt-1">
              Include your Cluster ID (<code className="text-zinc-300">cls_...</code>) or incident fingerprint for faster diagnostics.
            </p>
          </div>

          <div className="rounded-xl bg-zinc-900/40 border border-zinc-800/80 p-4 space-y-2">
            <h5 className="text-xs font-mono font-bold text-zinc-200">When contacting support, please share:</h5>
            <ul className="text-xs text-zinc-400 space-y-1">
              <li>• Kubernetes distribution and version (<code className="text-zinc-300">kubectl version</code>)</li>
              <li>• Cloud provider (AWS EKS, GKE, AKS, K3s, Bare Metal)</li>
              <li>• Agent pod logs (<code className="text-zinc-300">kubectl logs -n skyops-system -l app=skyops-agent</code>)</li>
            </ul>
          </div>
        </div>
      )
    }
  ];

  const currentArticle = articles.find((a) => a.id === activeTopic) || articles[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="kb-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
    >
      <div className="w-full max-w-5xl h-[85vh] max-h-[800px] bg-[#040812]/95 border border-cyan-500/30 rounded-2xl shadow-2xl shadow-cyan-950/80 flex flex-col overflow-hidden text-zinc-100 relative electric-circuit-border">
        {/* Top glowing electric bus line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300" />

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-cyan-500/15 bg-[#02050b]/90">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 id="kb-modal-title" className="text-sm font-bold text-white flex items-center gap-2">
                SkyOps Knowledge Base &amp; Technical Reference
              </h2>
              <p className="text-xs font-mono text-zinc-400">
                Verified architectural guides, security specifications, and operational runbooks
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors cursor-pointer"
            aria-label="Close Reference Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body: Two-column layout */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Left Navigation Sidebar */}
          <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-cyan-500/15 bg-[#02050b]/60 p-3 overflow-y-auto space-y-1">
            <div className="px-2 py-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-400">
              Documentation Index
            </div>
            {articles.map((article) => {
              const Icon = article.icon;
              const isActive = article.id === activeTopic;
              return (
                <button
                  key={article.id}
                  onClick={() => setActiveTopic(article.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-sky-500/20 to-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/40 shadow-xs'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-cyan-400' : 'text-zinc-500'}`} />
                    <span className="truncate">{article.title}</span>
                  </div>
                  {article.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#060c18] text-zinc-400 border border-zinc-800 shrink-0 ml-1">
                      {article.badge.split(' ')[0]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Content View */}
          <div className="flex-1 p-6 overflow-y-auto bg-[#02050b]/20 space-y-6">
            <div className="border-b border-cyan-500/15 pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#060c18] text-cyan-300 border border-cyan-500/30 uppercase">
                  {currentArticle.category}
                </span>
                {currentArticle.badge && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                    {currentArticle.badge}
                  </span>
                )}
              </div>
              <h3 className="text-xl font-bold text-white flex items-center gap-2">
                {currentArticle.title}
              </h3>
              <p className="text-xs text-zinc-400 mt-1 font-mono">
                {currentArticle.summary}
              </p>
            </div>

            {/* Article Content */}
            <div className="pt-2">
              {currentArticle.content}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-cyan-500/15 bg-[#02050b]/90 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono text-zinc-500">
          <div className="flex items-center gap-2">
            <Server className="w-3.5 h-3.5 text-cyan-400" />
            <span>Built for Kubernetes operations • © 2026 SkyOps</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="mailto:skyopsnetes2000@gmail.com"
              className="text-zinc-400 hover:text-cyan-400 transition-colors flex items-center gap-1.5"
            >
              <Mail className="w-3.5 h-3.5" />
              skyopsnetes2000@gmail.com
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
