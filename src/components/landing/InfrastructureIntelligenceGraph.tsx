import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  Fingerprint,
  Layers,
  Network,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';

interface Scenario {
  id: string;
  name: string;
  badge: string;
  category: string;
  description: string;
  rawSignals: number;
  dedupedIncidents: number;
  triageDuration: string;
  rootCause: string;
  affectedCluster: string;
  affectedNamespace: string;
  primarySignal: string;
  remediationCommand: string;
  streams: {
    name: string;
    source: string;
    status: 'alert' | 'warning' | 'nominal';
    detail: string;
  }[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'crashloop',
    name: 'Distributed Replica CrashLoop',
    badge: '48 Pods → 1 Incident',
    category: 'Workload Anomaly',
    description: 'Cascading pod crash failures across 3 Kubernetes worker nodes correlated to a single missing configuration secret.',
    rawSignals: 48,
    dedupedIncidents: 1,
    triageDuration: '1.2s',
    rootCause: 'Missing Secret `db-creds-v2` in namespace `payments`. Pod startup fails at container entrypoint.',
    affectedCluster: 'prod-gke-us-east',
    affectedNamespace: 'payments',
    primarySignal: 'CrashLoopBackOff (Exit Code 1)',
    remediationCommand: 'kubectl apply -f k8s/base/db-credentials.yaml -n payments',
    streams: [
      { name: 'Kubelet Events', source: 'Node 1,2,3', status: 'alert', detail: 'Back-off restarting failed container' },
      { name: 'Pod Logs', source: 'payments-api-*', status: 'alert', detail: 'Fatal: DB_PASSWORD env var not found' },
      { name: 'Metrics Mesh', source: 'ReplicaSet', status: 'warning', detail: 'Available replicas dropped 100% → 0%' },
      { name: 'Ingress Mesh', source: 'Envoy Gateway', status: 'warning', detail: '503 Service Unavailable upstream' }
    ]
  },
  {
    id: 'gateway502',
    name: 'Ingress Gateway 502 Timeout Cascade',
    badge: 'Cross-Namespace Anomaly',
    category: 'Network & Ingress',
    description: 'Ingress HTTP 502 spikes correlated to Redis connection pool saturation in an upstream shared cache service.',
    rawSignals: 112,
    dedupedIncidents: 1,
    triageDuration: '0.9s',
    rootCause: 'Connection pool exhausted on `redis-cache-0`. Client connections rejected after 10000 max clients reached.',
    affectedCluster: 'prod-eks-eu-central',
    affectedNamespace: 'ingress-nginx',
    primarySignal: 'HTTP 502 Bad Gateway (Upstream Timeout)',
    remediationCommand: 'kubectl patch configmap redis-config -n cache -p \'{"data":{"maxclients":"20000"}}\'',
    streams: [
      { name: 'Ingress Metrics', source: 'nginx-ingress', status: 'alert', detail: '502 error rate spiked to 14.8%' },
      { name: 'TCP Socket Mesh', source: 'redis-cache-0', status: 'alert', detail: 'TCP ESTABLISHED at 10,000 / 10,000' },
      { name: 'Application APM', source: 'auth-service', status: 'warning', detail: 'RedisTimeoutException in session lookup' },
      { name: 'DNS Core Resolver', source: 'CoreDNS', status: 'nominal', detail: 'Query latency nominal (0.8ms)' }
    ]
  },
  {
    id: 'oomkill',
    name: 'Kernel cgroup v2 Memory Pressure',
    badge: 'Node Memory Pressure',
    category: 'Host & Node Constraint',
    description: 'JVM heap runaway exceeding container cgroup memory limits triggering Linux OOM killer termination.',
    rawSignals: 34,
    dedupedIncidents: 1,
    triageDuration: '1.4s',
    rootCause: 'Container memory limit 512Mi breached by JVM Heap `-Xmx768m`. SIGKILL issued by cgroup v2 memory controller.',
    affectedCluster: 'prod-aks-ap-south',
    affectedNamespace: 'analytics',
    primarySignal: 'OOMKilled (Exit Code 137)',
    remediationCommand: 'kubectl set resources deployment/data-pipeline -c=worker --limits=memory=1.5Gi',
    streams: [
      { name: 'Kernel Events', source: 'cgroup2-oom', status: 'alert', detail: 'Task worker invoked oom-killer: score=842' },
      { name: 'Memory Slope', source: 'cadvisor', status: 'alert', detail: 'Usage slope +42MB/sec until 512Mi ceiling' },
      { name: 'GC Telemetry', source: 'jvm-metrics', status: 'warning', detail: 'Full GC pause time > 4800ms' },
      { name: 'Node Allocatable', source: 'node-pool-heavy-2', status: 'nominal', detail: 'Host RAM headroom 64% available' }
    ]
  }
];

export const InfrastructureIntelligenceGraph: React.FC<{ onGetStarted: () => void }> = ({ onGetStarted }) => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('crashloop');
  const [copiedCmd, setCopiedCmd] = useState(false);

  const activeScenario = SCENARIOS.find((s) => s.id === selectedScenarioId) || SCENARIOS[0];

  const handleCopy = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="w-full relative">
      {/* Outer ambient glow container */}
      <div className="relative rounded-2xl border border-sky-500/20 bg-gradient-to-b from-zinc-900/90 via-zinc-950/95 to-zinc-950 backdrop-blur-xl shadow-2xl shadow-sky-950/40 overflow-hidden">
        {/* Subtle top indicator bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-zinc-800/80 bg-zinc-900/40 text-xs font-mono">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
            <span className="font-semibold text-zinc-100">Live Infrastructure Topology Graph</span>
            <span className="text-zinc-600">/</span>
            <span className="text-sky-400 font-medium">Deterministic Correlation Engine</span>
          </div>

          <div className="flex items-center gap-4 text-zinc-400 text-[11px]">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>142,800 signals/s</span>
            </span>
            <span className="text-zinc-700 hidden sm:inline">·</span>
            <span className="hidden sm:flex items-center gap-1.5 text-cyan-300">
              <Zap className="w-3.5 h-3.5" />
              <span>&lt; 15MB Agent Footprint</span>
            </span>
          </div>
        </div>

        {/* Interactive Scenario Tabs */}
        <div className="px-5 pt-4 pb-2 border-b border-zinc-800/60 bg-zinc-950/60 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider mr-2">
            Simulate Incident:
          </span>
          {SCENARIOS.map((s) => {
            const isActive = s.id === activeScenario.id;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedScenarioId(s.id)}
                className={`text-xs font-mono px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-2 cursor-pointer ${
                  isActive
                    ? 'bg-sky-500/15 text-cyan-300 border border-sky-400/40 shadow-sm shadow-sky-500/10 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
                }`}
              >
                <span>{s.name}</span>
                <span
                  className={`text-[10px] px-1.5 py-0.2 rounded font-sans ${
                    isActive ? 'bg-sky-400/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {s.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Core Visualization Layout */}
        <div className="p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Input Telemetry Streams converging */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pb-1">
              <span className="uppercase tracking-wider">Correlated Inbound Streams</span>
              <span className="text-sky-400 font-semibold">{activeScenario.rawSignals} Raw Signals</span>
            </div>

            <div className="space-y-2.5">
              {activeScenario.streams.map((stream, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 hover:border-zinc-700/80 transition-colors flex items-start gap-3"
                >
                  <div
                    className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
                      stream.status === 'alert'
                        ? 'bg-rose-950/70 border border-rose-800/70 text-rose-400'
                        : stream.status === 'warning'
                        ? 'bg-amber-950/70 border border-amber-800/70 text-amber-400'
                        : 'bg-emerald-950/70 border border-emerald-800/70 text-emerald-400'
                    }`}
                  >
                    {stream.status === 'alert' ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : stream.status === 'warning' ? (
                      <Activity className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono font-medium text-zinc-200 truncate">
                        {stream.name}
                      </span>
                      <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                        {stream.source}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400 truncate mt-0.5">
                      {stream.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 flex items-center gap-2 text-xs font-mono text-zinc-500">
              <Fingerprint className="w-4 h-4 text-cyan-400" />
              <span>Mathematical SHA-256 fingerprint deduplication active</span>
            </div>
          </div>

          {/* Center: Intelligence Engine Nexus */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center py-4 lg:py-0 relative">
            {/* Visual convergence lines / glow rings */}
            <div className="relative w-28 h-28 flex items-center justify-center">
              {/* Outer pulsing ring */}
              <div className="absolute inset-0 rounded-full border border-cyan-400/30 animate-ping opacity-25" />
              {/* Secondary rotating ring */}
              <div className="absolute inset-1 rounded-full border border-dashed border-sky-400/40 animate-[spin_18s_linear_infinite]" />
              {/* Inner glow core */}
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-sky-600 via-cyan-500 to-indigo-600 p-[2px] shadow-lg shadow-cyan-500/30 flex items-center justify-center">
                <div className="w-full h-full rounded-full bg-zinc-950 flex flex-col items-center justify-center text-center p-2">
                  <Cpu className="w-6 h-6 text-cyan-400 animate-pulse mb-0.5" />
                  <span className="text-[9px] font-black font-mono tracking-tighter text-zinc-100">
                    SKYOPS
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400">
                    NEXUS
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-3 text-center">
              <div className="text-[11px] font-mono font-semibold text-cyan-300">
                Triage: {activeScenario.triageDuration}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                Deterministic Output
              </div>
            </div>
          </div>

          {/* Right: Synthesized Incident Card */}
          <div className="lg:col-span-5">
            <div className="p-5 rounded-xl border border-sky-500/30 bg-zinc-900/80 shadow-xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    Correlated Root Cause Analysis
                  </div>
                  <h4 className="text-sm font-bold text-zinc-100 mt-1 font-mono">
                    {activeScenario.name}
                  </h4>
                </div>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-zinc-800 text-sky-300 border border-zinc-700">
                  {activeScenario.category}
                </span>
              </div>

              {/* Cluster and Namespace details */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800">
                <div>
                  <span className="text-zinc-500 text-[10px] block">Cluster</span>
                  <span className="text-zinc-200 font-semibold truncate block">
                    {activeScenario.affectedCluster}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] block">Namespace</span>
                  <span className="text-zinc-200 font-semibold truncate block">
                    {activeScenario.affectedNamespace}
                  </span>
                </div>
              </div>

              {/* Exact Root Cause Explanation */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wide">
                  Root Cause Diagnosis
                </span>
                <div className="p-3 rounded-lg bg-rose-950/20 border border-rose-900/40 text-xs text-rose-200 leading-relaxed font-mono">
                  {activeScenario.rootCause}
                </div>
              </div>

              {/* Remediation Action / Kubectl command */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span>Verified Remediation Runbook</span>
                  <button
                    onClick={() => handleCopy(activeScenario.remediationCommand)}
                    className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    {copiedCmd ? 'Copied!' : 'Copy command'}
                  </button>
                </div>
                <div className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2 text-xs font-mono text-zinc-300">
                  <code className="text-cyan-300 truncate">
                    {activeScenario.remediationCommand}
                  </code>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom CTA Strip */}
        <div className="px-6 py-4 border-t border-zinc-800/80 bg-zinc-900/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-zinc-400 font-mono">
            Every cluster is monitored in real-time with zero cluster-admin write privileges required.
          </div>
          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto px-5 py-2.5 bg-sky-500 hover:bg-sky-400 text-zinc-950 font-bold font-mono text-xs rounded-lg transition-all shadow-md shadow-sky-500/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Start Monitoring Free</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
