import React, { useState } from 'react';
import {
  ShieldCheck,
  Activity,
  AlertTriangle,
  Layers,
  FileText,
  ChevronDown,
  ChevronUp,
  Info,
  Clock,
  Radio,
  Boxes,
  Terminal,
  Server,
  Globe,
  CheckCircle2,
  AlertOctagon,
  Copy,
  Cpu,
  RefreshCw,
  ExternalLink,
  Code2
} from 'lucide-react';
import { TechnicalDetails, SkyOpsAIAnalysis, Incident } from '../../types';
import { ProvenanceBadge, ProvenanceType } from '../common/Badges';
import { CopyButton } from '../common/UI';
import { ArchitecturalFaultTopology } from './ArchitecturalFaultTopology';
import { parseKubernetesError, StructuredTelemetrySignal } from './telemetryParser';

interface IncidentEvidenceSectionProps {
  technicalDetails: TechnicalDetails;
  aiAnalysis?: SkyOpsAIAnalysis | null;
  incidentType: string;
  incident?: Incident | null;
}

export const IncidentEvidenceSection: React.FC<IncidentEvidenceSectionProps> = ({
  technicalDetails: tech,
  aiAnalysis,
  incidentType,
  incident
}) => {
  const [activeTab, setActiveTab] = useState<'events' | 'containers' | 'conditions' | 'raw' | 'engine'>('events');
  const [isExpanded, setIsExpanded] = useState(true);
  const [viewMode, setViewMode] = useState<'all' | 'topology' | 'signals'>('all');

  // Compile rich structured signals
  const structuredSignals: StructuredTelemetrySignal[] = [];

  // Signal 1: Core Failure Reason
  const failureReason = tech.reason || incidentType;
  const primaryParsed = parseKubernetesError(
    `${failureReason}: ${tech.message || 'Primary failure condition detected on resource'}`,
    tech.containerName
  );

  structuredSignals.push({
    id: 'primary-signal',
    title: 'Primary Incident Signature',
    badgeLabel: 'CORE FAILURE SIGNATURE',
    category: 'CONFIRMED',
    subsystem: 'kube-apiserver / detector',
    statusReason: failureReason,
    containerName: tech.containerName,
    image: tech.image,
    nodeName: tech.nodeName,
    exitCode: tech.exitCode,
    restartCount: tech.restartCount,
    rawTrace: tech.message || `Incident triggered by condition: ${failureReason}`,
    cleanSummary: tech.message || `Resource transitioned into unhealthy state: ${failureReason}`,
    sreInsight: primaryParsed.sreInsight,
    timestamp: 'Observed Live Telemetry'
  });

  // Signal 2: Container Waiting Reason or State
  const firstContainer = tech.containers?.[0];
  if (firstContainer?.waitingReason || firstContainer?.state) {
    const rawContainerMsg = `${firstContainer.name}: ${firstContainer.waitingReason || firstContainer.state}${
      firstContainer.waitingMessage ? ` — ${firstContainer.waitingMessage}` : ''
    }`;
    const parsed = parseKubernetesError(rawContainerMsg, firstContainer.name);

    structuredSignals.push({
      id: 'container-state',
      title: `Container Runtime State: ${firstContainer.name}`,
      badgeLabel: 'CONTAINER CRI DIAGNOSTIC',
      category: 'CONFIRMED',
      subsystem: 'kubelet / containerd CRI',
      containerName: firstContainer.name,
      image: firstContainer.image || tech.image,
      registry: parsed.registry,
      statusReason: firstContainer.waitingReason || firstContainer.state,
      errorCode: parsed.errorCode,
      exitCode: firstContainer.exitCode ?? tech.exitCode,
      restartCount: firstContainer.restartCount ?? tech.restartCount,
      memoryLimit: firstContainer.memoryLimit,
      rawTrace: firstContainer.waitingMessage || rawContainerMsg,
      cleanSummary: parsed.cleanMessage,
      sreInsight: parsed.sreInsight,
      timestamp: 'Active Container State'
    });
  } else if (tech.exitCode !== undefined && tech.exitCode !== 0) {
    structuredSignals.push({
      id: 'container-exit',
      title: 'Container Termination Status',
      badgeLabel: 'PROCESS EXIT CODE',
      category: 'CONFIRMED',
      subsystem: 'containerd / PID 1',
      containerName: tech.containerName,
      statusReason: `Exit Code ${tech.exitCode}`,
      exitCode: tech.exitCode,
      restartCount: tech.restartCount,
      rawTrace: `Container process exited with status code ${tech.exitCode}. Kubelet recorded termination.`,
      cleanSummary: `Container PID 1 terminated with non-zero exit code: ${tech.exitCode}`,
      sreInsight: 'Non-zero exit indicates process failure during startup or uncaught exception.',
      timestamp: 'Process Lifecycle Event'
    });
  }

  // Signal 3: Kubernetes Events Warning
  const warningEvents = tech.events?.filter((e) => e.type === 'Warning') || [];
  if (warningEvents.length > 0) {
    const firstWarn = warningEvents[0];
    const warnParsed = parseKubernetesError(
      `${firstWarn.reason}: ${firstWarn.message || 'Observed by kubelet'}`,
      tech.containerName
    );

    structuredSignals.push({
      id: 'cluster-warning-event',
      title: `Kubelet Warning Event: ${firstWarn.reason}`,
      badgeLabel: 'CLUSTER EVENT STREAM',
      category: 'CONFIRMED',
      subsystem: 'kubelet.service',
      statusReason: firstWarn.reason,
      containerName: warnParsed.containerName || tech.containerName,
      image: warnParsed.image || tech.image,
      registry: warnParsed.registry,
      errorCode: warnParsed.errorCode,
      rawTrace: firstWarn.message,
      cleanSummary: firstWarn.message,
      sreInsight: warnParsed.sreInsight,
      timestamp: firstWarn.timestamp
        ? new Date(firstWarn.timestamp).toLocaleTimeString()
        : 'Cluster Event Pulse'
    });
  } else if (tech.events && tech.events.length > 0) {
    structuredSignals.push({
      id: 'cluster-events-summary',
      title: 'Kubernetes Cluster Events Recorded',
      badgeLabel: 'EVENT LOG SUMMARY',
      category: 'CONFIRMED',
      subsystem: 'kubelet.service',
      rawTrace: `${tech.events.length} events logged for this workload resource in namespace ${incident?.namespace || 'default'}.`,
      cleanSummary: `${tech.events.length} events recorded in workload event buffer.`,
      sreInsight: 'Review individual event items in the detailed events tab below.',
      timestamp: 'Aggregated Events'
    });
  }

  // Signal 4: Evidence from Engine
  if (tech.evidence && tech.evidence.length > 0) {
    const engineEv = tech.evidence[0];
    structuredSignals.push({
      id: 'engine-grounding',
      title: `Telemetry Grounding: ${engineEv.reason}`,
      badgeLabel: 'DETERMINISTIC GROUNDING',
      category: 'CONFIRMED',
      subsystem: engineEv.source || 'telemetry-engine',
      rawTrace: engineEv.message,
      cleanSummary: engineEv.message,
      sreInsight: 'Deterministic telemetry engine verified this condition from raw cluster state.',
      timestamp: engineEv.timestamp
        ? new Date(engineEv.timestamp).toLocaleTimeString()
        : 'Telemetry Grounding'
    });
  }

  // Signal 5: AI Inference (if present)
  if (aiAnalysis?.evidence) {
    const inferenceEv = aiAnalysis.evidence.find((e) => e.category === 'AI_INFERENCE');
    if (inferenceEv) {
      structuredSignals.push({
        id: 'ai-inference',
        title: 'Analytical Inference Hypothesis',
        badgeLabel: 'PROBABILISTIC INFERENCE',
        category: 'INFERENCE',
        subsystem: 'Gemini RCA Engine',
        rawTrace: inferenceEv.detail,
        cleanSummary: inferenceEv.detail,
        sreInsight: 'Plausible root cause inference synthesized from corroborating signals and error messages.',
        timestamp: 'AI Inference'
      });
    }
  }

  const totalEvents = tech.events?.length || 0;
  const totalContainers = tech.containers?.length || 0;
  const totalConditions = tech.conditions?.length || 0;
  const totalEvidence = (tech.evidence?.length || 0) + (aiAnalysis?.evidence?.length || 0);

  return (
    <div className="p-5 sm:p-6 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-6 shadow-xs">
      {/* Header with expand toggle and View Mode selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-950/80 border border-emerald-700/80 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider">
                6. Corroborating Evidence & Observability Signals
              </h3>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-950 text-emerald-400 border border-zinc-800">
                {structuredSignals.length} Signals Verified
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-sans mt-0.5">
              Live Kubernetes telemetry stream, architectural fault isolation, and corroborated state
            </p>
          </div>
        </div>

        {/* View Switcher & Expand Toggle */}
        <div className="flex items-center gap-2">
          {/* View Mode Switcher */}
          <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-[11px] font-mono">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer font-medium ${
                viewMode === 'all'
                  ? 'bg-zinc-800 text-zinc-100 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Unified SRE Deck
            </button>
            <button
              type="button"
              onClick={() => setViewMode('topology')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                viewMode === 'topology'
                  ? 'bg-zinc-800 text-sky-300 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Boxes className="w-3 h-3 text-sky-400" />
              Architectural Topology
            </button>
            <button
              type="button"
              onClick={() => setViewMode('signals')}
              className={`px-2.5 py-1 rounded transition-colors cursor-pointer font-medium flex items-center gap-1.5 ${
                viewMode === 'signals'
                  ? 'bg-zinc-800 text-emerald-300 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Terminal className="w-3 h-3 text-emerald-400" />
              Signals Only
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            title={isExpanded ? 'Collapse section' : 'Expand section'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-6">
          {/* ========================================================================= */}
          {/* 1. ARCHITECTURAL FAULT TOPOLOGY (Shown in 'all' or 'topology' mode) */}
          {/* ========================================================================= */}
          {(viewMode === 'all' || viewMode === 'topology') && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-zinc-300 uppercase font-bold flex items-center gap-2">
                  <Boxes className="w-3.5 h-3.5 text-sky-400" />
                  Architectural Fault Isolation & Lifecycle Flow
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  Full 7-Layer Kubernetes Pipeline
                </span>
              </div>

              <ArchitecturalFaultTopology
                incidentType={incidentType}
                technicalDetails={tech}
                incident={incident}
              />
            </div>
          )}

          {/* ========================================================================= */}
          {/* 2. STRUCTURED TELEMETRY SIGNALS DECK (Shown in 'all' or 'signals' mode) */}
          {/* ========================================================================= */}
          {(viewMode === 'all' || viewMode === 'signals') && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono text-zinc-300 uppercase font-bold flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Structured Telemetry Signal Stream ({structuredSignals.length})
                </span>
                <span className="text-[10px] font-mono text-zinc-500">
                  Parsed CRI & Kubelet Diagnostic Traces
                </span>
              </div>

              {/* High-Fidelity Signal Cards (Spacious, Structured, NEVER Squished) */}
              <div className="space-y-3">
                {structuredSignals.map((sig) => (
                  <div
                    key={sig.id}
                    className="p-4 sm:p-5 rounded-xl bg-zinc-950/90 border border-zinc-800/90 space-y-3.5 shadow-xs transition-colors hover:border-zinc-700/80"
                  >
                    {/* Top Signal Header Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/70 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-900 text-zinc-300 border border-zinc-800">
                          {sig.badgeLabel}
                        </span>
                        <h4 className="text-xs font-mono font-bold text-zinc-100 truncate">
                          {sig.title}
                        </h4>
                      </div>

                      <div className="flex items-center gap-2">
                        <ProvenanceBadge type={sig.category} />
                        <span className="text-[10px] font-mono text-zinc-400 bg-zinc-900/80 px-2 py-0.5 rounded border border-zinc-800/60">
                          {sig.subsystem}
                        </span>
                      </div>
                    </div>

                    {/* Structured Key-Value Attribute Chips */}
                    {(sig.containerName ||
                      sig.image ||
                      sig.registry ||
                      sig.statusReason ||
                      sig.errorCode ||
                      sig.exitCode !== undefined) && (
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                        {sig.statusReason && (
                          <div className="px-2.5 py-1 rounded-md bg-rose-950/60 border border-rose-800/80 text-rose-300 flex items-center gap-1.5">
                            <span className="text-[10px] text-rose-400 uppercase font-bold">State:</span>
                            <span className="font-bold">{sig.statusReason}</span>
                          </div>
                        )}

                        {sig.containerName && (
                          <div className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-200 flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold">Container:</span>
                            <span className="text-zinc-100 font-semibold">{sig.containerName}</span>
                          </div>
                        )}

                        {sig.image && (
                          <div className="px-2.5 py-1 rounded-md bg-sky-950/60 border border-sky-800/70 text-sky-200 flex items-center gap-1.5 max-w-full truncate">
                            <span className="text-[10px] text-sky-400 uppercase font-bold shrink-0">Image:</span>
                            <span className="font-mono text-[11px] truncate">{sig.image}</span>
                            <CopyButton text={sig.image} />
                          </div>
                        )}

                        {sig.registry && (
                          <div className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold">Registry:</span>
                            <span>{sig.registry}</span>
                          </div>
                        )}

                        {sig.errorCode && (
                          <div className="px-2.5 py-1 rounded-md bg-amber-950/60 border border-amber-800/70 text-amber-300 flex items-center gap-1.5">
                            <span className="text-[10px] text-amber-400 uppercase font-bold">Code:</span>
                            <span className="font-semibold">{sig.errorCode}</span>
                          </div>
                        )}

                        {sig.exitCode !== undefined && (
                          <div className="px-2.5 py-1 rounded-md bg-rose-950/60 border border-rose-800/70 text-rose-300 flex items-center gap-1.5">
                            <span className="text-[10px] text-rose-400 uppercase font-bold">Exit Code:</span>
                            <span className="font-bold">{sig.exitCode}</span>
                          </div>
                        )}

                        {sig.restartCount !== undefined && sig.restartCount > 0 && (
                          <div className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 flex items-center gap-1.5">
                            <span className="text-[10px] text-zinc-400 uppercase font-bold">Restarts:</span>
                            <span className="text-rose-400 font-bold">{sig.restartCount}x</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* High-Fidelity Monospace Console Log Viewer */}
                    <div className="rounded-lg bg-zinc-950 border border-zinc-800/90 overflow-hidden">
                      <div className="px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800/80 flex items-center justify-between text-[11px] font-mono text-zinc-400">
                        <div className="flex items-center gap-2">
                          <Code2 className="w-3.5 h-3.5 text-zinc-500" />
                          <span className="text-zinc-300 font-medium">Diagnostic Error String & Telemetry Trace</span>
                        </div>
                        <CopyButton text={sig.rawTrace} label="Copy Trace" />
                      </div>

                      <div className="p-3.5 font-mono text-xs text-zinc-200 leading-relaxed overflow-x-auto whitespace-pre-wrap break-words bg-zinc-950/90">
                        {sig.rawTrace}
                      </div>
                    </div>

                    {/* SRE Triage Insight */}
                    <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/70 flex items-start gap-2 text-xs">
                      <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                      <p className="text-zinc-300 leading-relaxed font-sans">
                        <strong className="text-zinc-200 font-mono text-[11px] mr-1">SRE Grounding:</strong>
                        {sig.sreInsight}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 3. DEEPER DIAGNOSTIC DETAILS (Tabs: Events, Containers, Conditions, etc.) */}
          {/* ========================================================================= */}
          <div className="pt-4 border-t border-zinc-800/80 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase font-bold text-zinc-400 tracking-wider">
                Detailed Cluster Telemetry Inspections:
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                Authoritative Kubelet Telemetry
              </span>
            </div>

            {/* Tabs Bar */}
            <div className="flex items-center gap-2 overflow-x-auto border-b border-zinc-800/70 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('events')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'events'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
                }`}
              >
                Kubernetes Events ({totalEvents})
              </button>

              {totalContainers > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('containers')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'containers'
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
                  }`}
                >
                  Container States ({totalContainers})
                </button>
              )}

              {totalConditions > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('conditions')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'conditions'
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
                  }`}
                >
                  Pod Conditions ({totalConditions})
                </button>
              )}

              <button
                type="button"
                onClick={() => setActiveTab('raw')}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  activeTab === 'raw'
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
                }`}
              >
                Diagnostic Message
              </button>

              {totalEvidence > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('engine')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    activeTab === 'engine'
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 font-bold'
                      : 'text-zinc-400 hover:text-zinc-200 bg-zinc-950 border border-zinc-800'
                  }`}
                >
                  Categorized Grounding ({totalEvidence})
                </button>
              )}
            </div>

            {/* TAB 1: KUBERNETES EVENTS */}
            {activeTab === 'events' && (
              <div className="space-y-2">
                {tech.events && tech.events.length > 0 ? (
                  <div className="divide-y divide-zinc-800/60 max-h-80 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60">
                    {tech.events.map((ev, idx) => (
                      <div key={idx} className="p-3.5 hover:bg-zinc-900/40 text-xs font-mono space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                ev.type === 'Warning'
                                  ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                                  : 'bg-zinc-900 text-zinc-300 border border-zinc-800'
                              }`}
                            >
                              {ev.type}
                            </span>
                            <span className="font-bold text-zinc-200">{ev.reason}</span>
                            {ev.count && ev.count > 1 && (
                              <span className="text-zinc-500 text-[10px]">({ev.count}x)</span>
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-500 truncate">
                            {ev.timestamp
                              ? new Date(ev.timestamp).toLocaleTimeString()
                              : 'Live pulse'}
                          </span>
                        </div>
                        <p className="text-zinc-200 text-xs font-sans leading-relaxed whitespace-pre-wrap break-words">
                          {ev.message}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-5 rounded-lg bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-400 font-mono">
                    No active Kubernetes warning events recorded for this resource.
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: CONTAINER DIAGNOSTICS */}
            {activeTab === 'containers' && tech.containers && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 uppercase text-[10px]">
                    <tr>
                      <th className="px-3.5 py-2.5">Container</th>
                      <th className="px-3.5 py-2.5">Image</th>
                      <th className="px-3.5 py-2.5">Ready</th>
                      <th className="px-3.5 py-2.5">State / Reason</th>
                      <th className="px-3.5 py-2.5">Restarts</th>
                      <th className="px-3.5 py-2.5">Exit Code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    {tech.containers.map((c, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/30">
                        <td className="px-3.5 py-3 font-bold text-zinc-200">{c.name}</td>
                        <td className="px-3.5 py-3 text-zinc-400 max-w-[220px] truncate" title={c.image}>
                          {c.image}
                        </td>
                        <td className="px-3.5 py-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              c.ready ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                            }`}
                          >
                            {c.ready ? 'READY' : 'NOT READY'}
                          </span>
                        </td>
                        <td className="px-3.5 py-3 text-zinc-200">
                          {c.waitingReason || c.terminationReason || c.state}
                          {c.waitingMessage && (
                            <div className="text-[10px] text-rose-400 max-w-[280px] truncate mt-0.5" title={c.waitingMessage}>
                              {c.waitingMessage}
                            </div>
                          )}
                        </td>
                        <td className="px-3.5 py-3 text-zinc-300">{c.restartCount ?? 0}</td>
                        <td className="px-3.5 py-3 text-zinc-300">{c.exitCode !== undefined ? c.exitCode : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 3: RESOURCE CONDITIONS */}
            {activeTab === 'conditions' && tech.conditions && (
              <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 uppercase text-[10px]">
                    <tr>
                      <th className="px-3.5 py-2.5">Condition Type</th>
                      <th className="px-3.5 py-2.5">Status</th>
                      <th className="px-3.5 py-2.5">Reason / Message</th>
                      <th className="px-3.5 py-2.5">Last Transition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                    {tech.conditions.map((cond, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/30">
                        <td className="px-3.5 py-2.5 font-bold text-zinc-200">{cond.type}</td>
                        <td className="px-3.5 py-2.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              cond.status === 'True'
                                ? 'bg-emerald-950 text-emerald-300'
                                : cond.status === 'False'
                                ? 'bg-rose-950 text-rose-300'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {cond.status}
                          </span>
                        </td>
                        <td className="px-3.5 py-2.5 text-zinc-300 text-xs">
                          {cond.reason && <span className="font-semibold text-zinc-200 mr-1">{cond.reason}:</span>}
                          <span>{cond.message || 'No additional message.'}</span>
                        </td>
                        <td className="px-3.5 py-2.5 text-zinc-400 text-[11px]">
                          {cond.lastTransitionTime
                            ? cond.lastTransitionTime.slice(0, 19).replace('T', ' ')
                            : 'Not available'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB 4: DIAGNOSTIC MESSAGE & RAW DETAILS */}
            {activeTab === 'raw' && (
              <div className="p-4 sm:p-5 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500 uppercase font-bold">
                      Kubelet Diagnostic Error String:
                    </span>
                    <CopyButton text={tech.message || ''} label="Copy Error String" />
                  </div>
                  <div className="p-3.5 rounded bg-zinc-900/80 border border-zinc-800 text-rose-300 leading-relaxed whitespace-pre-wrap break-words">
                    {tech.message || 'No specific error message string recorded in container status.'}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] pt-2 border-t border-zinc-800">
                  <div>
                    <span className="text-zinc-500 block">REASON:</span>
                    <span className="text-zinc-200 font-bold">{tech.reason || incidentType}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">OBSERVED STATE:</span>
                    <span className="text-zinc-200">{tech.observedState || 'Failed'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">EXIT CODE:</span>
                    <span className={tech.exitCode ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                      {tech.exitCode ?? 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 block">RESTARTS:</span>
                    <span className={tech.restartCount ? 'text-rose-400 font-bold' : 'text-zinc-400'}>
                      {tech.restartCount ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: CATEGORIZED GROUNDING (Facts vs Inferences) */}
            {activeTab === 'engine' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* AI Grounding Items */}
                  {aiAnalysis?.evidence?.map((ev, idx) => {
                    const type =
                      ev.category === 'OBSERVED_FACT'
                        ? 'CONFIRMED'
                        : ev.category === 'PROPOSED_CHANGE'
                        ? 'RECOMMENDATION'
                        : 'INFERENCE';
                    return (
                      <div
                        key={`ai-${idx}`}
                        className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2.5"
                      >
                        <div className="shrink-0 mt-0.5">
                          <ProvenanceBadge
                            type={type}
                            label={
                              ev.category === 'OBSERVED_FACT'
                                ? 'CONFIRMED FACT'
                                : ev.category === 'PROPOSED_CHANGE'
                                ? 'PROPOSED'
                                : 'INFERENCE'
                            }
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase block">
                            {ev.source}
                          </span>
                          <p className="text-zinc-200 text-xs mt-1 leading-relaxed whitespace-pre-wrap break-words font-mono">
                            {ev.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}

                  {/* Technical Details Evidence Items */}
                  {tech.evidence?.map((ev, idx) => (
                    <div
                      key={`tech-${idx}`}
                      className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2.5"
                    >
                      <div className="shrink-0 mt-0.5">
                        <ProvenanceBadge type="CONFIRMED" label="CONFIRMED FACT" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase block">
                          {ev.source || 'Kubelet Telemetry'}
                        </span>
                        <p className="text-zinc-200 text-xs mt-1 leading-relaxed whitespace-pre-wrap break-words font-mono">
                          {ev.message}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
