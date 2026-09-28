import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  ExternalLink,
  Flame,
  Globe,
  Layers,
  Network,
  Radio,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';

interface ElectricScenario {
  id: string;
  name: string;
  badge: string;
  voltageStatus: 'CRITICAL SURGE' | 'IMPEDANCE FAULT' | 'LEAKAGE SPIKE' | 'ISOLATION DROP';
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
  failedNode: string;
  circuitNodes: {
    id: string;
    label: string;
    role: 'edge' | 'service' | 'data';
    status: 'nominal' | 'warning' | 'critical';
    signalType: string;
    metric: string;
  }[];
}

const ELECTRIC_SCENARIOS: ElectricScenario[] = [
  {
    id: 'crashloop-surge',
    name: 'Distributed Replica CrashLoop Surge',
    badge: '48 Pods → 1 Incident',
    voltageStatus: 'CRITICAL SURGE',
    category: 'Workload State Failure',
    description:
      'Cascading pod crash failures across 3 Kubernetes worker nodes. Raw alerts surge from 48 pods, but SkyOps correlates the underlying missing configuration secret in 1.1s.',
    rawSignals: 48,
    dedupedIncidents: 1,
    triageDuration: '1.1s',
    rootCause:
      'Missing Kubernetes Secret `db-creds-v2` in namespace `payments`. Container entrypoint crashes immediately upon initialization with Exit Code 1.',
    affectedCluster: 'prod-gke-us-east1',
    affectedNamespace: 'payments',
    primarySignal: 'CrashLoopBackOff (SIGTERM Exit Code 1)',
    remediationCommand: 'kubectl apply -f k8s/base/db-credentials.yaml -n payments',
    failedNode: 'payments-api',
    circuitNodes: [
      { id: 'edge-1', label: 'ingress-nginx', role: 'edge', status: 'warning', signalType: 'HTTP 503 Surge', metric: '48.2 req/s 5xx' },
      { id: 'edge-2', label: 'envoy-gateway', role: 'edge', status: 'warning', signalType: 'Circuit Tripped', metric: 'Upstream Unavail' },
      { id: 'svc-1', label: 'auth-service', role: 'service', status: 'nominal', signalType: 'Nominal Bus', metric: 'p99 18ms' },
      { id: 'svc-2', label: 'payments-api', role: 'service', status: 'critical', signalType: 'CrashLoopBackOff', metric: '48 Pods Failing' },
      { id: 'data-1', label: 'redis-cache', role: 'data', status: 'nominal', signalType: 'Nominal Bus', metric: '0.4% mem' },
      { id: 'data-2', label: 'postgres-primary', role: 'data', status: 'nominal', signalType: 'Nominal Bus', metric: '4.2k IOPS' }
    ]
  },
  {
    id: 'ingress-spike',
    name: 'Ingress 502 Saturation Voltage Spike',
    badge: '112 Signals → 1 Incident',
    voltageStatus: 'IMPEDANCE FAULT',
    category: 'Network & Cache Saturation',
    description:
      'Sudden traffic surge exhausts Redis connection pool, cascading into upstream 502 bad gateway errors on edge ingress proxies.',
    rawSignals: 112,
    dedupedIncidents: 1,
    triageDuration: '0.9s',
    rootCause:
      'Redis connection pool exhausted on `redis-cluster-cache`. Reached 10,000 maximum active TCP sockets, triggering upstream connection timeouts.',
    affectedCluster: 'prod-eks-eu-central',
    affectedNamespace: 'cache-layer',
    primarySignal: 'HTTP 502 Bad Gateway (Upstream Timeout)',
    remediationCommand: 'kubectl patch configmap redis-config -n cache-layer -p \'{"data":{"maxclients":"20000"}}\'',
    failedNode: 'redis-cache',
    circuitNodes: [
      { id: 'edge-1', label: 'ingress-nginx', role: 'edge', status: 'critical', signalType: 'HTTP 502 Wave', metric: '14.8% error rate' },
      { id: 'edge-2', label: 'envoy-gateway', role: 'edge', status: 'critical', signalType: 'TCP Timeout', metric: 'Socket Reset' },
      { id: 'svc-1', label: 'auth-service', role: 'service', status: 'warning', signalType: 'Cache Lock Wait', metric: 'Latency +450ms' },
      { id: 'svc-2', label: 'payments-api', role: 'service', status: 'nominal', signalType: 'Nominal Bus', metric: 'p99 22ms' },
      { id: 'data-1', label: 'redis-cache', role: 'data', status: 'critical', signalType: 'Socket Saturation', metric: '10,000/10,000 conns' },
      { id: 'data-2', label: 'postgres-primary', role: 'data', status: 'nominal', signalType: 'Nominal Bus', metric: 'Healthy' }
    ]
  },
  {
    id: 'oomkill-leak',
    name: 'Kernel cgroup v2 OOMKill Surge',
    badge: '34 Signals → 1 Incident',
    voltageStatus: 'LEAKAGE SPIKE',
    category: 'Kernel Memory Pressure',
    description:
      'Container memory consumption slope exceeds cgroup limit. Linux kernel invokes OOM Killer, generating a burst of node and pod death events.',
    rawSignals: 34,
    dedupedIncidents: 1,
    triageDuration: '1.3s',
    rootCause:
      'Memory limit 512Mi breached by JVM Heap `-Xmx768m` in deployment `analytics-worker`. Linux cgroup v2 controller issued SIGKILL (Exit 137).',
    affectedCluster: 'prod-aks-ap-south',
    affectedNamespace: 'analytics',
    primarySignal: 'OOMKilled (Linux SIGKILL Exit Code 137)',
    remediationCommand: 'kubectl set resources deployment/analytics-worker -n analytics --limits=memory=1.5Gi',
    failedNode: 'svc-1',
    circuitNodes: [
      { id: 'edge-1', label: 'ingress-nginx', role: 'edge', status: 'nominal', signalType: 'Nominal Bus', metric: 'p99 14ms' },
      { id: 'edge-2', label: 'envoy-gateway', role: 'edge', status: 'nominal', signalType: 'Nominal Bus', metric: 'Healthy' },
      { id: 'svc-1', label: 'analytics-worker', role: 'service', status: 'critical', signalType: 'OOMKilled (137)', metric: '512Mi Ceiling Breached' },
      { id: 'svc-2', label: 'payments-api', role: 'service', status: 'nominal', signalType: 'Nominal Bus', metric: 'p99 20ms' },
      { id: 'data-1', label: 'redis-cache', role: 'data', status: 'nominal', signalType: 'Nominal Bus', metric: 'Nominal' },
      { id: 'data-2', label: 'postgres-primary', role: 'data', status: 'nominal', signalType: 'Nominal Bus', metric: 'Healthy' }
    ]
  }
];

export const ElectricArchitectureMatrix: React.FC<{ onGetStarted: () => void }> = ({ onGetStarted }) => {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('crashloop-surge');
  const [copied, setCopied] = useState(false);
  const [isSurging, setIsSurging] = useState(false);

  const scenario = ELECTRIC_SCENARIOS.find((s) => s.id === selectedScenarioId) || ELECTRIC_SCENARIOS[0];

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const triggerFaultSurge = (id: string) => {
    setIsSurging(true);
    setSelectedScenarioId(id);
    setTimeout(() => setIsSurging(false), 800);
  };

  return (
    <div className="w-full relative">
      {/* Outer Enclosure with electric circuit glow */}
      <div className="relative rounded-2xl border border-cyan-500/25 bg-[#050a14]/90 backdrop-blur-2xl shadow-2xl shadow-cyan-950/40 overflow-hidden">
        {/* Top Electrical Bus Indicator Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-cyan-500/15 bg-zinc-950/70 font-mono text-xs">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-400" />
            </span>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white tracking-wide">
                ELECTRIC INFRASTRUCTURE TOPOLOGY
              </span>
              <span className="text-zinc-600">/</span>
              <span className="text-cyan-400 font-medium">AUTONOMOUS SIGNAL RECTIFIER</span>
            </div>
          </div>

          <div className="flex items-center gap-5 text-zinc-400 text-[11px]">
            <div className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                <strong className="text-white">142,800</strong> telemetry signals/s
              </span>
            </div>
            <span className="text-zinc-700 hidden md:inline">·</span>
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                Grid Latency: <strong className="text-white">{scenario.triageDuration}</strong>
              </span>
            </div>
            <span className="text-zinc-700 hidden md:inline">·</span>
            <div className="hidden lg:flex items-center gap-1.5 text-indigo-300">
              <Cpu className="w-3.5 h-3.5" />
              <span>Agent: &lt; 15MB Non-Root</span>
            </div>
          </div>
        </div>

        {/* Incident Surge Injector Selector */}
        <div className="px-6 py-3.5 border-b border-zinc-800/80 bg-zinc-950/90 flex flex-wrap items-center gap-3">
          <span className="text-xs font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-cyan-400" />
            <span>Inject Electrical Surge:</span>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {ELECTRIC_SCENARIOS.map((s) => {
              const active = s.id === scenario.id;
              return (
                <button
                  key={s.id}
                  onClick={() => triggerFaultSurge(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all flex items-center gap-2 cursor-pointer ${
                    active
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40 shadow-sm shadow-cyan-500/20 font-semibold'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-zinc-800/80'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-cyan-400 animate-pulse' : 'bg-zinc-600'}`} />
                  <span>{s.name}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-sans ${
                      active ? 'bg-cyan-400/20 text-cyan-200' : 'bg-zinc-900 text-zinc-400 border border-zinc-800'
                    }`}
                  >
                    {s.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Circuit Grid Layout */}
        <div className="p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative">
          {/* Subtle electric grid overlay */}
          <div className="absolute inset-0 electric-grid-bg opacity-30 pointer-events-none" />

          {/* Left Side: Microservice Circuit Nodes (Input Electrical Grid) */}
          <div className="lg:col-span-5 space-y-4 relative z-10">
            <div className="flex items-center justify-between font-mono text-xs text-zinc-400 pb-1">
              <span className="uppercase tracking-wider flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-cyan-400" />
                <span>Microservice Circuit Topology</span>
              </span>
              <span className="text-rose-400 font-bold flex items-center gap-1">
                <Flame className="w-3 h-3 text-rose-400" />
                <span>{scenario.rawSignals} Unstable Signals</span>
              </span>
            </div>

            <div className="space-y-2.5">
              {scenario.circuitNodes.map((node) => {
                const isCrit = node.status === 'critical';
                const isWarn = node.status === 'warning';

                return (
                  <div
                    key={node.id}
                    className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 ${
                      isCrit
                        ? 'bg-rose-950/30 border-rose-500/50 shadow-lg shadow-rose-950/40 text-rose-100'
                        : isWarn
                        ? 'bg-amber-950/20 border-amber-500/40 text-amber-100'
                        : 'bg-zinc-900/50 border-zinc-800/80 text-zinc-300 hover:border-cyan-500/30'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                          isCrit
                            ? 'bg-rose-950 border-rose-500/80 text-rose-400'
                            : isWarn
                            ? 'bg-amber-950 border-amber-500/80 text-amber-400'
                            : 'bg-zinc-950 border-zinc-800 text-cyan-400'
                        }`}
                      >
                        {isCrit ? (
                          <ShieldAlert className="w-4 h-4 animate-bounce" />
                        ) : isWarn ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : (
                          <Server className="w-4 h-4" />
                        )}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold">{node.label}</span>
                          <span className="text-[10px] font-mono px-1 rounded bg-zinc-950/60 border border-zinc-800 text-zinc-400">
                            {node.role}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                          Signal: <span className={isCrit ? 'text-rose-300 font-semibold' : isWarn ? 'text-amber-300' : 'text-zinc-400'}>{node.signalType}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono">
                      <div className={`text-xs font-semibold ${isCrit ? 'text-rose-400' : isWarn ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {node.metric}
                      </div>
                      <div className="text-[10px] text-zinc-500 uppercase">
                        {node.status}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/90 text-xs font-mono text-zinc-400 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-cyan-400" />
                <span>Deterministic SHA-256 Hashing Active</span>
              </div>
              <span className="text-cyan-300 font-bold">1 Incident Filtered</span>
            </div>
          </div>

          {/* Center Nexus: SkyOps Signal Rectifier & Voltage Transformer */}
          <div className="lg:col-span-2 flex flex-col items-center justify-center py-4 lg:py-0 relative z-10">
            {/* Pulsing energy rings */}
            <div className="relative w-32 h-32 flex items-center justify-center">
              {/* Surging outer aura */}
              <div
                className={`absolute inset-0 rounded-full border border-cyan-400/40 transition-all duration-300 ${
                  isSurging ? 'scale-125 opacity-80 border-cyan-300' : 'animate-ping opacity-20'
                }`}
              />
              {/* Rotating conduit ring */}
              <div className="absolute inset-1.5 rounded-full border border-dashed border-cyan-400/50 animate-[spin_12s_linear_infinite]" />
              
              {/* Center Transformer Core */}
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-sky-600 via-cyan-500 to-indigo-600 p-[2.5px] shadow-xl shadow-cyan-500/30 flex items-center justify-center">
                <div className="w-full h-full rounded-full bg-[#050a14] flex flex-col items-center justify-center text-center p-2">
                  <Zap className="w-6 h-6 text-cyan-400 animate-pulse mb-0.5" />
                  <span className="text-[10px] font-black font-mono tracking-wider text-white">
                    SKYOPS
                  </span>
                  <span className="text-[8px] font-mono text-cyan-400 font-bold uppercase">
                    RECTIFIER
                  </span>
                </div>
              </div>
            </div>

            {/* Waveform / Oscilloscope simulation */}
            <div className="mt-3 text-center space-y-1">
              <div className="flex items-center justify-center gap-1">
                {[4, 12, 8, 20, 14, 6, 18, 10, 22, 8, 14, 4].map((h, i) => (
                  <span
                    key={i}
                    style={{ height: `${h}px` }}
                    className="w-1 bg-cyan-400 rounded-full animate-pulse opacity-80"
                  />
                ))}
              </div>
              <div className="text-[11px] font-mono text-cyan-300 font-bold">
                Triage: {scenario.triageDuration}
              </div>
              <div className="text-[10px] font-mono text-zinc-500">
                100% Deterministic Root Cause
              </div>
            </div>
          </div>

          {/* Right Side: Synthesized Correlated Incident Output (Discharged Action) */}
          <div className="lg:col-span-5 relative z-10">
            <div className="p-6 rounded-2xl border border-cyan-500/30 bg-zinc-950/90 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3 border-b border-zinc-800 pb-3">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-rose-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                    <span>SURGE SYNTHESIZED INCIDENT</span>
                  </div>
                  <h4 className="text-base font-bold text-white mt-1 font-mono">
                    {scenario.name}
                  </h4>
                </div>
                <span className="px-2.5 py-1 text-[10px] font-mono font-bold rounded bg-rose-950/60 text-rose-300 border border-rose-800/60 shrink-0">
                  {scenario.voltageStatus}
                </span>
              </div>

              {/* Topology Breadcrumbs */}
              <div className="grid grid-cols-2 gap-2 text-xs font-mono p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80">
                <div>
                  <span className="text-zinc-500 text-[10px] block">Cluster Realm</span>
                  <span className="text-zinc-200 font-bold truncate block">{scenario.affectedCluster}</span>
                </div>
                <div>
                  <span className="text-zinc-500 text-[10px] block">Namespace</span>
                  <span className="text-zinc-200 font-bold truncate block">{scenario.affectedNamespace}</span>
                </div>
              </div>

              {/* Exact Root Cause Explanation */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wide">
                  Root Cause Diagnosis
                </span>
                <div className="p-3.5 rounded-xl bg-rose-950/20 border border-rose-900/40 text-xs text-rose-200 leading-relaxed font-mono">
                  {scenario.rootCause}
                </div>
              </div>

              {/* Verified Remediation Command */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                  <span className="text-cyan-400 font-medium flex items-center gap-1.5">
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Verified Remediation Runbook</span>
                  </span>
                  <button
                    onClick={() => handleCopy(scenario.remediationCommand)}
                    className="text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 cursor-pointer font-bold"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy kubectl</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="p-3 rounded-xl bg-[#02050a] border border-cyan-500/20 flex items-center justify-between gap-2 text-xs font-mono text-zinc-200">
                  <code className="text-cyan-300 truncate select-all">{scenario.remediationCommand}</code>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Banner */}
        <div className="px-6 py-4 border-t border-cyan-500/15 bg-zinc-950/80 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs">
          <div className="text-zinc-400 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Zero write rights required. Operates strictly under read-only Kubernetes RBAC (UID 65532).</span>
          </div>

          <button
            onClick={onGetStarted}
            className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-sky-400 to-cyan-400 hover:from-sky-300 hover:to-cyan-300 text-zinc-950 font-bold rounded-lg transition-all shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 cursor-pointer"
          >
            <span>Connect Your First Cluster Free</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
