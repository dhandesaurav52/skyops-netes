import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  Fingerprint,
  Layers,
  Network,
  Radio,
  Server,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';

interface Stage {
  step: string;
  title: string;
  metaphor: string;
  tagline: string;
  description: string;
  stats: string;
  icon: React.ReactNode;
  activeColor: string;
  codeSnippet: string;
}

const FLOW_STAGES: Stage[] = [
  {
    step: '01',
    title: 'High-Voltage Raw Ingestion',
    metaphor: 'ELECTRICITY → RAW TELEMETRY',
    tagline: 'Continuous stream from eBPF probes, cgroups & kubelet',
    description:
      'The non-privileged daemon taps the live Kubernetes event stream, cgroup v2 memory slopes, and stdout/stderr logs. Raw signals flow at high frequency without impacting node compute.',
    stats: '142,800 signals / sec',
    icon: <Radio className="w-5 h-5 text-cyan-400" />,
    activeColor: 'from-sky-500/20 to-cyan-500/10 border-cyan-500/40 text-cyan-300',
    codeSnippet: `// 1. Ingesting raw cluster signals without kernel hooks
watch_stream {
  source: "kubelet.v1.Event",
  types: ["FailedMount", "BackOff", "OOMKilled", "Unhealthy"],
  sample_rate: "100%",
  buffer_overhead_mb: 8.4
}`
  },
  {
    step: '02',
    title: 'Mathematical Rectification',
    metaphor: 'ENERGY FILTER → ALERT DEDUPLICATION',
    tagline: 'SHA-256 fingerprint hashing collapses alert storms',
    description:
      'When an entire ReplicaSet collapses, traditional tools send 50 alerts. SkyOps computes a deterministic SHA-256 signature from the root failure path, collapsing 100 alerts into 1 unified incident.',
    stats: '98.2% noise reduction',
    icon: <Fingerprint className="w-5 h-5 text-indigo-400" />,
    activeColor: 'from-indigo-500/20 to-purple-500/10 border-indigo-500/40 text-indigo-300',
    codeSnippet: `// 2. Deterministic fingerprint deduplication
fn dedupe_signature(event: &K8sEvent) -> Hash256 {
  let seed = format!("{}:{}:{}", event.cluster, event.namespace, event.reason);
  sha256_hash(seed.as_bytes()) // 100 alerts -> 1 incident
}`
  },
  {
    step: '03',
    title: 'Topological Circuit Correlation',
    metaphor: 'ELECTRICAL GRID → INFRASTRUCTURE GRAPH',
    tagline: 'Traversing the live dependency mesh',
    description:
      'SkyOps traces the failure through the cluster topology: Ingress → Gateway → Service Pods → Persistent Volumes. It detects that an HTTP 503 is merely the symptom of an upstream database timeout.',
    stats: 'Live graph depth: 8 tiers',
    icon: <Layers className="w-5 h-5 text-emerald-400" />,
    activeColor: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/40 text-emerald-300',
    codeSnippet: `// 3. Graph traversal to identify causal root
graph.traverse_upstream(ingress_node)
  .correlate_latency_spikes()
  .find_chokepoint() // Pinpoint Redis connection pool saturation
  .mark_causal_origin()`
  },
  {
    step: '04',
    title: 'Autonomous Remediation Discharge',
    metaphor: 'PULSE STABILIZATION → ACTIONABLE RUNBOOK',
    tagline: 'Instant diagnosis & verified kubectl runbook',
    description:
      'Within ~1.1 seconds of detection, SkyOps produces a plain-English explanation of the root cause along with safe, pre-tested kubectl commands ready for on-call engineers to execute.',
    stats: '1.1s average MTTR triage',
    icon: <Terminal className="w-5 h-5 text-amber-400" />,
    activeColor: 'from-amber-500/20 to-yellow-500/10 border-amber-500/40 text-amber-300',
    codeSnippet: `// 4. Output: Verified kubectl remediation
kubectl patch configmap redis-config -n cache-layer \\
  -p '{"data":{"maxclients":"20000"}}'
// Result: 502 Bad Gateway cleared in 3.4 seconds`
  }
];

export const TelemetryFlowVisualizer: React.FC = () => {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <div className="w-full space-y-8">
      {/* 4-Stage Step Bar */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {FLOW_STAGES.map((stage, idx) => {
          const isActive = activeStep === idx;
          return (
            <button
              key={stage.step}
              onClick={() => setActiveStep(idx)}
              className={`p-5 rounded-2xl border text-left transition-all cursor-pointer relative overflow-hidden flex flex-col justify-between h-full ${
                isActive
                  ? 'bg-gradient-to-b from-zinc-900/90 to-zinc-950/90 border-cyan-500/50 shadow-xl shadow-cyan-950/30'
                  : 'bg-zinc-950/60 border-zinc-800/80 hover:border-zinc-700/80 hover:bg-zinc-900/40'
              }`}
            >
              {/* Electric indicator pulse */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 to-cyan-400" />
              )}

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-zinc-500">
                    STAGE {stage.step}
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-zinc-900/80 border border-zinc-800 flex items-center justify-center">
                    {stage.icon}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white font-mono">{stage.title}</h4>
                  <div className="text-[11px] font-mono text-cyan-400 mt-0.5">
                    {stage.metaphor}
                  </div>
                </div>
              </div>

              <div className="pt-4 text-xs font-mono text-zinc-400 flex items-center justify-between border-t border-zinc-800/80 mt-4">
                <span>{stage.stats}</span>
                <span className={`text-[10px] font-bold ${isActive ? 'text-cyan-400' : 'text-zinc-600'}`}>
                  {isActive ? 'ACTIVE VIEW' : 'CLICK TO VIEW'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected Stage Detail Panel */}
      <div className="rounded-2xl border border-cyan-500/20 bg-zinc-950/90 backdrop-blur-xl p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        <div className="lg:col-span-6 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-xs font-mono text-cyan-300">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span>STAGE {FLOW_STAGES[activeStep].step} · {FLOW_STAGES[activeStep].metaphor}</span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {FLOW_STAGES[activeStep].title}
          </h3>

          <p className="text-sm text-cyan-200/90 font-mono font-medium">
            {FLOW_STAGES[activeStep].tagline}
          </p>

          <p className="text-sm text-zinc-400 leading-relaxed font-sans">
            {FLOW_STAGES[activeStep].description}
          </p>

          <div className="pt-2 flex items-center gap-3">
            <div className="px-4 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300">
              Key Metric: <strong className="text-cyan-400">{FLOW_STAGES[activeStep].stats}</strong>
            </div>
            <button
              onClick={() => setActiveStep((prev) => (prev + 1) % FLOW_STAGES.length)}
              className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer underline-offset-4 hover:underline"
            >
              <span>Next Stage</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Right: Code and Electrical Logic View */}
        <div className="lg:col-span-6">
          <div className="rounded-xl border border-zinc-800 bg-[#020610] p-5 font-mono shadow-2xl relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-3 text-xs text-zinc-400">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400" />
                <span>skyops-engine://stage-{FLOW_STAGES[activeStep].step}.rs</span>
              </div>
              <span className="text-[10px] text-zinc-500">Rust Core · Zero GC</span>
            </div>

            <pre className="text-xs text-cyan-100 leading-relaxed overflow-x-auto selection:bg-cyan-500/30">
              {FLOW_STAGES[activeStep].codeSnippet}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
