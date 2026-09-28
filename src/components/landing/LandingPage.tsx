import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Fingerprint,
  Flame,
  Globe,
  HelpCircle,
  Key,
  Layers,
  Lock,
  Network,
  Radio,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  Terminal,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { DocTopic, KnowledgeBaseModal } from '../docs/KnowledgeBaseModal';
import { Footer } from '../layout/Footer';
import { ElectricArchitectureMatrix } from './ElectricArchitectureMatrix';
import { ElectricCircuitBackground } from './ElectricCircuitBackground';
import { TelemetryFlowVisualizer } from './TelemetryFlowVisualizer';
import { TerminalSimulation } from './TerminalSimulation';
import { formatINR, getPlanDefinition, getPlanPricing } from '../../config/plans';
import { api } from '../../api/client';

interface LandingPageProps {
  onSignIn: () => void;
  onSignUp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, onSignUp }) => {
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [activeDocTopic, setActiveDocTopic] = useState<DocTopic>('quickstart');
  const proMonthly = getPlanPricing('PRO', 'MONTHLY');
  const proPlan = getPlanDefinition('PRO');
  const freePlan = getPlanDefinition('FREE');
  const [usdInrRate, setUsdInrRate] = useState<number | null>(null);
  useEffect(() => {
    api.getUsdInrRate().then((result) => setUsdInrRate(result.rate)).catch(() => setUsdInrRate(null));
  }, []);

  const handleOpenDoc = (topic: DocTopic) => {
    setActiveDocTopic(topic);
    setIsDocModalOpen(true);
  };

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#02050d] text-zinc-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-100 relative">
      {/* Dynamic Electric Circuit & Conduit Background */}
      <ElectricCircuitBackground />

      {/* Top Navigation - Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#02050d]/85 border-b border-cyan-500/15 px-6 lg:px-12 py-3.5 transition-all">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          {/* Zone 1: Single Text Element Wordmark */}
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="text-lg font-bold tracking-tight text-white hover:text-cyan-300 transition-colors flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-zinc-950 shadow-md shadow-sky-500/25">
              <Network className="w-4 h-4 text-white" />
            </div>
            <span>SkyOps</span>
          </a>

          {/* Zone 2: 4-6 Clean Text Navigation Links */}
          <nav className="hidden md:flex items-center gap-7 text-xs font-mono text-zinc-300">
            <button
              onClick={() => scrollToSection('intelligence-grid')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1"
            >
              Product
            </button>
            <button
              onClick={() => scrollToSection('telemetry-flow')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1"
            >
              Telemetry Flow
            </button>
            <button
              onClick={() => scrollToSection('architecture')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1"
            >
              Architecture
            </button>
            <button
              onClick={() => scrollToSection('matrix')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1"
            >
              Comparison
            </button>
            <button
              onClick={() => scrollToSection('pricing')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1"
            >
              Pricing
            </button>
            <button
              id="landing-header-docs-btn"
              onClick={() => handleOpenDoc('quickstart')}
              className="hover:text-cyan-400 transition-colors cursor-pointer py-1 flex items-center gap-1"
            >
              <span>Documentation</span>
            </button>
          </nav>

          {/* Zone 3: 1-2 Primary Actions */}
          <div className="flex items-center gap-3">
            <button
              id="landing-signin-btn"
              onClick={onSignIn}
              className="text-xs font-mono text-zinc-300 hover:text-white px-3 py-2 rounded-lg hover:bg-zinc-800/60 transition-colors cursor-pointer whitespace-nowrap"
            >
              Sign In
            </button>
            <button
              id="landing-signup-btn"
              onClick={onSignUp}
              className="text-xs font-mono font-bold bg-gradient-to-r from-sky-400 to-cyan-400 hover:from-sky-300 hover:to-cyan-300 text-zinc-950 px-4 py-2 rounded-lg shadow-md shadow-cyan-500/25 transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <span>Get Started</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Hero Section */}
      <section className="relative z-10 pt-20 pb-24 px-6 lg:px-12 flex flex-col items-center justify-center min-h-[85vh]">
        <div className="max-w-5xl mx-auto text-center space-y-8">
          {/* Signal Kicker - Clean unboxed text with electric pulse */}
          <div className="inline-flex items-center gap-2 text-xs font-mono text-cyan-400 tracking-wider">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shadow-sm shadow-cyan-400" />
            <span>ELECTRIC INFRASTRUCTURE INTELLIGENCE</span>
          </div>

          {/* Main Headline */}
          <div className="space-y-4">
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] max-w-4xl mx-auto text-balance">
              See What Your <br />
              <span className="bg-gradient-to-r from-white via-cyan-100 to-sky-400 bg-clip-text text-transparent">
                Infrastructure Knows.
              </span>
            </h1>

            <p className="text-base sm:text-xl font-medium text-cyan-200/90 max-w-2xl mx-auto">
              From Kubernetes incidents to infrastructure-wide root cause analysis.
            </p>
          </div>

          {/* Supporting Text */}
          <p className="text-sm sm:text-base text-zinc-400 max-w-3xl mx-auto leading-relaxed">
            SkyOps correlates telemetry, incidents, logs, metrics and infrastructure signals to
            investigate problems and help teams resolve them faster.
          </p>

          {/* Primary Call to Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3.5 pt-3">
            <button
              id="hero-get-started-btn"
              onClick={onSignUp}
              className="w-full sm:w-auto px-7 py-3.5 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300 hover:from-sky-300 hover:to-cyan-200 text-zinc-950 font-bold text-sm rounded-xl transition-all shadow-xl shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer font-mono"
            >
              <span>Start Monitoring</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              id="hero-explore-btn"
              onClick={() => scrollToSection('intelligence-grid')}
              className="w-full sm:w-auto px-7 py-3.5 bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 hover:text-white border border-cyan-500/20 hover:border-cyan-500/40 font-mono text-sm rounded-xl transition-all backdrop-blur-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Explore SkyOps</span>
              <ChevronDown className="w-4 h-4 text-cyan-400" />
            </button>
          </div>

          {/* Trust & Architecture Specs Row */}
          <div className="pt-10 flex flex-wrap items-center justify-center gap-y-2 gap-x-6 text-xs font-mono text-zinc-400">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Non-Privileged Read-Only RBAC (UID 65532)</span>
            </span>
            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>Sub-Second Deterministic Deduplication</span>
            </span>
            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-amber-400" />
              <span>1-Command Helm & Kubectl Install</span>
            </span>
            <span className="text-zinc-600 hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <Cpu className="w-4 h-4 text-indigo-400" />
              <span>&lt; 15MB Agent Memory Footprint</span>
            </span>
          </div>
        </div>
      </section>

      {/* Core Visual: Electric Infrastructure Topology Matrix */}
      <section id="intelligence-grid" className="relative z-10 py-16 px-6 lg:px-12 max-w-7xl mx-auto">
        <div className="text-center max-w-3xl mx-auto mb-10 space-y-3">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Autonomous Observability Matrix
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Electric Infrastructure Intelligence
          </h2>
          <p className="text-sm text-zinc-400 font-mono">
            How SkyOps ingests hundreds of raw signals, dampens alert storm surges, and deterministically synthesizes them into actionable root-cause incident analyses.
          </p>
        </div>

        {/* Live Interactive Electric Architecture Matrix */}
        <ElectricArchitectureMatrix onGetStarted={onSignUp} />
      </section>

      {/* 4-Stage Telemetry Flow Pipeline */}
      <section id="telemetry-flow" className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80">
        <div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Signal Pipeline Architecture
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            How Telemetry Flows Through SkyOps
          </h2>
          <p className="text-sm text-zinc-400 font-mono">
            From raw eBPF probes and cgroup telemetry to mathematical fingerprinting and sub-second verified remediation runbooks.
          </p>
        </div>

        {/* Interactive Step-by-Step Flow Component */}
        <TelemetryFlowVisualizer />
      </section>

      {/* Architectural Pillars & Capabilities */}
      <section id="architecture" className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-cyan-500/10">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Engineered For Modern SREs
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Architectural Reliability by Design
          </h2>
          <p className="text-sm text-zinc-400 font-mono">
            Traditional APM tools create noisy alert storms. SkyOps uses topology correlation to pinpoint the single point of failure in seconds.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Card 1 */}
          <div className="p-6 rounded-2xl bg-[#060c18]/80 border border-cyan-500/15 hover:border-cyan-500/40 transition-all space-y-4 group electric-circuit-border">
            <div className="w-12 h-12 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
              <Fingerprint className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">01. Mathematical Deduplication</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Correlate cascading failure signals across replica sets and eliminate alert fatigue using
                mathematical fingerprint hashing. 100 crashing pods trigger 1 unified incident.
              </p>
            </div>
            <div className="pt-2 text-[11px] font-mono text-cyan-300 border-t border-cyan-500/10 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              <span>SHA-256 Signature Hashing</span>
            </div>
          </div>

          {/* Card 2 */}
          <div className="p-6 rounded-2xl bg-[#060c18]/80 border border-cyan-500/15 hover:border-cyan-500/40 transition-all space-y-4 group electric-circuit-border">
            <div className="w-12 h-12 rounded-xl bg-sky-950/60 border border-sky-800/50 flex items-center justify-center text-sky-400 group-hover:scale-105 transition-transform">
              <Network className="w-6 h-6 text-sky-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">02. Topological Dependency Graph</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Continuously maintains an in-memory topological model of your clusters, connecting
                Namespaces, Deployments, ReplicaSets, Pods, and Ingress routes into a unified dependency graph.
              </p>
            </div>
            <div className="pt-2 text-[11px] font-mono text-sky-300 border-t border-cyan-500/10 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Live Relationship Mapping</span>
            </div>
          </div>

          {/* Card 3 */}
          <div className="p-6 rounded-2xl bg-[#060c18]/80 border border-cyan-500/15 hover:border-cyan-500/40 transition-all space-y-4 group electric-circuit-border">
            <div className="w-12 h-12 rounded-xl bg-emerald-950/60 border border-emerald-800/50 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">03. Zero-Trust Read-Only Daemon</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Runs with UID 65532 non-root execution. Requires strictly read-only Kubernetes RBAC
                verbs (<code className="text-cyan-300">get, list, watch</code>). Never asks for cluster-admin or write rights.
              </p>
            </div>
            <div className="pt-2 text-[11px] font-mono text-emerald-300 border-t border-cyan-500/10 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              <span>Non-Root Security Context</span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="p-6 rounded-2xl bg-[#060c18]/80 border border-cyan-500/15 hover:border-cyan-500/40 transition-all space-y-4 group electric-circuit-border">
            <div className="w-12 h-12 rounded-xl bg-cyan-950/60 border border-cyan-800/50 flex items-center justify-center text-cyan-300 group-hover:scale-105 transition-transform">
              <Terminal className="w-6 h-6 text-cyan-300" />
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-bold text-white">04. Instant Root Cause Runbooks</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Generate verified <code className="text-cyan-300">kubectl</code> remediation commands tailored to the exact failure,
                giving your on-call engineers immediate guidance during critical outages.
              </p>
            </div>
            <div className="pt-2 text-[11px] font-mono text-cyan-300 border-t border-cyan-500/10 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              <span>1-Click Verified Remediation</span>
            </div>
          </div>
        </div>
      </section>

      {/* Terminal & 60-Second Agent Install Section */}
      <section id="quickstart" className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-6 space-y-6">
            <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
              60-Second Cluster Pairing
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              One Command to Connect. <br />
              Zero Disruption to Workloads.
            </h2>
            <p className="text-sm text-zinc-400 leading-relaxed">
              Deploy our lightweight daemon in your Kubernetes cluster using Helm 3, standard kubectl manifests, or Terraform.
              It securely registers itself using your organization pairing key and begins streaming telemetry in under 3 seconds.
            </p>

            <div className="space-y-3 pt-2">
              {[
                { title: 'No Cluster Restart Required', desc: 'Runs as a lightweight DaemonSet with zero impact on production workloads.' },
                { title: 'Strict Read-Only Enforcement', desc: 'ClusterRole grants only get/list/watch on pods, nodes, and events.' },
                { title: 'Air-Gapped & Sovereign Ready', desc: 'Outbound HTTPS TLS 1.3 only; no inbound ports opened into your VPC.' }
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-1 w-5 h-5 rounded-full bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center shrink-0">
                    <Check className="w-3 h-3 text-cyan-400" />
                  </div>
                  <div>
                    <h4 className="text-xs font-mono font-bold text-zinc-100">{item.title}</h4>
                    <p className="text-xs text-zinc-400">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                onClick={() => handleOpenDoc('agent-guide')}
                className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer underline-offset-4 hover:underline"
              >
                <span>Read the verified Agent Security Architecture Guide</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <TerminalSimulation />
          </div>
        </div>
      </section>

      {/* Enterprise Comparison: SkyOps vs Traditional APM */}
      <section id="matrix" className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80">
        <div className="text-center max-w-3xl mx-auto mb-14 space-y-3">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Enterprise Decision Matrix
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            SkyOps vs Legacy APM Tools
          </h2>
          <p className="text-sm text-zinc-400 font-mono">
            Designed specifically for Kubernetes environments where traditional threshold metrics fail to capture cascading failures.
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 overflow-hidden shadow-2xl">
          <div className="grid grid-cols-12 px-6 py-4 border-b border-zinc-800 bg-zinc-900/60 text-xs font-mono font-bold text-zinc-300">
            <div className="col-span-5 sm:col-span-4">Capability</div>
            <div className="col-span-4 sm:col-span-4 text-cyan-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              <span>SkyOps Autonomous Platform</span>
            </div>
            <div className="col-span-3 sm:col-span-4 text-zinc-500">Legacy APM / Static Thresholds</div>
          </div>

          <div className="divide-y divide-zinc-800/60 text-xs font-mono">
            {[
              {
                capability: 'Incident Correlation',
                skyops: 'Mathematical fingerprint deduplication (100 pod crashes = 1 incident)',
                legacy: '100 separate alerts sent to Slack / PagerDuty'
              },
              {
                capability: 'Cluster Agent Security',
                skyops: 'Non-root UID 65532, strictly read-only RBAC, zero secrets stored',
                legacy: 'Often requires root or broad cluster-admin privileges'
              },
              {
                capability: 'Root Cause Pinpointing',
                skyops: 'Autonomous correlation across events, logs, and cgroups in ~1.1s',
                legacy: 'Manual querying across multiple dashboards & log grep'
              },
              {
                capability: 'Resource Footprint',
                skyops: '< 15MB RAM, 0.01 CPU per agent node daemon',
                legacy: '300MB+ RAM per node daemon with heavy overhead'
              },
              {
                capability: 'Remediation Speed',
                skyops: 'Synthesized kubectl repair commands generated instantly',
                legacy: 'Manual runbook search by on-call engineers'
              }
            ].map((row, idx) => (
              <div key={idx} className="grid grid-cols-12 px-6 py-4 hover:bg-zinc-900/30 items-center">
                <div className="col-span-5 sm:col-span-4 font-semibold text-zinc-200">{row.capability}</div>
                <div className="col-span-4 sm:col-span-4 text-cyan-300 font-medium">{row.skyops}</div>
                <div className="col-span-3 sm:col-span-4 text-zinc-400">{row.legacy}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80">
        <div className="text-center max-w-3xl mx-auto mb-16 space-y-3">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-cyan-400">
            Simple, Transparent Pricing
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Predictable Plans for Any Cluster Scale
          </h2>
          <p className="text-sm text-zinc-400 font-mono">
            No surprise per-GB ingestion bills. Predictable tiers designed for dev clusters to multi-region production fleets.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Developer Tier */}
          <div className="p-7 rounded-2xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Developer</h3>
                <p className="text-xs text-zinc-400">Ideal for personal homelabs and single development clusters.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-white font-mono">{formatINR(freePlan.pricing.MONTHLY.totalPrice)}</span>
                <span className="text-xs text-zinc-500 font-mono">/ forever free</span>
              </div>
              <ul className="space-y-2.5 pt-2 text-xs font-mono text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>1 Kubernetes Cluster</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Up to 25 Pods Monitored</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Sub-second Alert Deduplication</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Community Reference & Docs</span>
                </li>
              </ul>
            </div>
            <button
              onClick={onSignUp}
              className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-semibold transition-colors cursor-pointer"
            >
              Start Free
            </button>
          </div>

          {/* Team Tier (Featured) */}
          <div className="p-7 rounded-2xl bg-[#060c18]/95 border-2 border-cyan-500/50 shadow-2xl shadow-cyan-950/60 flex flex-col justify-between space-y-6 relative overflow-hidden electric-circuit-border-active">
            {/* Top glowing electric bus line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300" />
            
            <div className="space-y-4">
              <div className="space-y-1">
                <div className="text-[11px] font-mono text-cyan-300 font-bold uppercase tracking-wider">
                  Recommended For Teams
                </div>
                <h3 className="text-lg font-bold text-white">Production Team</h3>
                <p className="text-xs text-zinc-400">For engineering teams managing critical staging and production workloads.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-black text-cyan-300 font-mono tabular-nums">{formatINR(proMonthly.totalPrice)}</span>
                <span className="text-xs text-zinc-400 font-mono">/ month</span>
              </div>
              <div className="text-[11px] text-zinc-500 font-mono">
                {usdInrRate ? `≈ $${(proMonthly.monthlyEquivalent / usdInrRate).toFixed(2)} / month` : 'USD equivalent temporarily unavailable'}
              </div>
              <ul className="space-y-2.5 pt-2 text-xs font-mono text-zinc-200">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>5 Managed Kubernetes clusters</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Up to 50 nodes & 1,000 workloads</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Advanced incident correlation & RCA</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>AI-assisted remediation recommendations</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Outbound webhooks & team notifications</span>
                </li>
              </ul>
            </div>
            <button
              onClick={onSignUp}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-400 hover:from-sky-300 hover:to-cyan-300 text-zinc-950 font-mono text-xs font-bold transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
            >
              Get Started with Team
            </button>
          </div>

          {/* Enterprise Tier */}
          <div className="p-7 rounded-2xl bg-zinc-900/40 border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-white">Enterprise Fleet</h3>
                <p className="text-xs text-zinc-400">For enterprise organizations needing multi-tenant sovereign environments.</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black text-white font-mono">Custom</span>
                <span className="text-xs text-zinc-500 font-mono">/ annual contract</span>
              </div>
              <ul className="space-y-2.5 pt-2 text-xs font-mono text-zinc-300">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Unlimited Multi-Cloud Clusters</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>Dedicated Firestore Tenant Isolation</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>99.99% Availability SLA</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>SOC2 Type II & Compliance Pack</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-cyan-400 shrink-0" />
                  <span>24/7 Dedicated SRE Escalation</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => handleOpenDoc('support')}
              className="w-full py-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-xs font-semibold transition-colors cursor-pointer"
            >
              Contact Enterprise
            </button>
          </div>
        </div>
      </section>

      {/* Security & Compliance Highlights */}
      <section id="security" className="relative z-10 py-16 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80">
        <div className="p-8 rounded-2xl bg-zinc-950/80 border border-cyan-500/20 backdrop-blur-xl flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="space-y-2">
            <div className="text-xs font-mono text-cyan-400 font-semibold uppercase tracking-wider">
              Zero-Trust Architecture
            </div>
            <h3 className="text-xl sm:text-2xl font-bold text-white">
              Enterprise Grade Security & Compliance
            </h3>
            <p className="text-xs text-zinc-400 max-w-xl">
              SkyOps operates strictly within read-only Kubernetes RBAC parameters. No application credentials, database keys, or pod environment variables are ever transmitted to or stored on our servers.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => handleOpenDoc('security-model')}
              className="px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>Security Whitepaper</span>
            </button>
            <button
              onClick={() => handleOpenDoc('rbac')}
              className="px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 font-mono text-xs flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Lock className="w-4 h-4 text-cyan-400" />
              <span>Audit RBAC Roles</span>
            </button>
          </div>
        </div>
      </section>

      {/* Pre-Footer Action Banner */}
      <section className="relative z-10 py-20 px-6 lg:px-12 max-w-7xl mx-auto border-t border-zinc-800/80 text-center space-y-6">
        <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white max-w-3xl mx-auto">
          Start Investigating Kubernetes Incidents in Minutes.
        </h2>
        <p className="text-sm text-zinc-400 max-w-xl mx-auto font-mono">
          Connect your first cluster today. Free forever for developers, no credit card required.
        </p>
        <div className="pt-2">
          <button
            onClick={onSignUp}
            className="px-8 py-4 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300 hover:from-sky-300 hover:to-cyan-200 text-zinc-950 font-bold text-sm rounded-xl transition-all shadow-xl shadow-cyan-500/25 inline-flex items-center gap-2 cursor-pointer font-mono"
          >
            <span>Deploy Free Cluster Agent</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      {/* Production Customer-Oriented Footer */}
      <Footer
        onOpenDoc={handleOpenDoc}
        onGetStarted={onSignUp}
        onOpenAddCluster={onSignUp}
        isAuthenticated={false}
      />

      {/* Technical Reference & Knowledge Base Modal */}
      <KnowledgeBaseModal
        isOpen={isDocModalOpen}
        onClose={() => setIsDocModalOpen(false)}
        initialTopic={activeDocTopic}
        onGetStarted={onSignUp}
      />
    </div>
  );
};
