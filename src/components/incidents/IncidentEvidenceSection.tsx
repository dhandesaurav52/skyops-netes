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
  Radio
} from 'lucide-react';
import { TechnicalDetails, SkyOpsAIAnalysis, AIEvidenceCategory } from '../../types';
import { ProvenanceBadge, ProvenanceType } from '../common/Badges';

interface IncidentEvidenceSectionProps {
  technicalDetails: TechnicalDetails;
  aiAnalysis?: SkyOpsAIAnalysis | null;
  incidentType: string;
}

export const IncidentEvidenceSection: React.FC<IncidentEvidenceSectionProps> = ({
  technicalDetails: tech,
  aiAnalysis,
  incidentType
}) => {
  const [activeTab, setActiveTab] = useState<'events' | 'containers' | 'conditions' | 'raw' | 'engine'>('events');
  const [isExpanded, setIsExpanded] = useState(true);

  // Compile confirmed signals for compact header summary
  const signals: Array<{ label: string; detail: string; category: ProvenanceType }> = [];

  // Signal 1: Core Failure Reason
  const failureReason = tech.reason || incidentType;
  signals.push({
    label: 'Primary Signal',
    detail: failureReason,
    category: 'CONFIRMED'
  });

  // Signal 2: Container Waiting Reason or State
  const firstContainer = tech.containers?.[0];
  if (firstContainer?.waitingReason) {
    signals.push({
      label: 'Container State',
      detail: `${firstContainer.name}: ${firstContainer.waitingReason}${firstContainer.waitingMessage ? ` — ${firstContainer.waitingMessage}` : ''}`,
      category: 'CONFIRMED'
    });
  } else if (tech.exitCode !== undefined && tech.exitCode !== 0) {
    signals.push({
      label: 'Exit Code',
      detail: `Container terminated with code ${tech.exitCode}`,
      category: 'CONFIRMED'
    });
  }

  // Signal 3: Kubernetes Events Warning
  const warningEvents = tech.events?.filter((e) => e.type === 'Warning') || [];
  if (warningEvents.length > 0) {
    signals.push({
      label: 'Cluster Warning Event',
      detail: `${warningEvents[0].reason}: ${warningEvents[0].message || 'Observed by kubelet'}`,
      category: 'CONFIRMED'
    });
  } else if (tech.events && tech.events.length > 0) {
    signals.push({
      label: 'Cluster Events',
      detail: `${tech.events.length} event${tech.events.length > 1 ? 's' : ''} recorded`,
      category: 'CONFIRMED'
    });
  }

  // Signal 4: Evidence from engine
  if (tech.evidence && tech.evidence.length > 0) {
    signals.push({
      label: 'Engine Grounding',
      detail: tech.evidence[0].message,
      category: 'CONFIRMED'
    });
  }

  // If AI inference exists, add one distinct inference signal
  if (aiAnalysis?.evidence) {
    const inferenceEv = aiAnalysis.evidence.find((e) => e.category === 'AI_INFERENCE');
    if (inferenceEv) {
      signals.push({
        label: 'Inferred Hypothesis',
        detail: inferenceEv.detail,
        category: 'INFERENCE'
      });
    }
  }

  const totalEvents = tech.events?.length || 0;
  const totalContainers = tech.containers?.length || 0;
  const totalConditions = tech.conditions?.length || 0;
  const totalEvidence = (tech.evidence?.length || 0) + (aiAnalysis?.evidence?.length || 0);

  return (
    <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4 shadow-xs">
      {/* Header with expand toggle */}
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider">
            6. Corroborating Evidence & Observability Signals
          </h3>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-950 text-zinc-400 border border-zinc-800">
            {signals.length} Signals Captured
          </span>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs font-mono text-zinc-400 hover:text-zinc-200 flex items-center gap-1 cursor-pointer"
        >
          {isExpanded ? (
            <>
              <span>Collapse details</span>
              <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              <span>Expand details</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>

      {/* --- COMPACT SIGNALS SUMMARY (Fast Scan) --- */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          CONFIRMED SIGNALS (Observed Live Telemetry):
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
          {signals.map((sig, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 flex items-start gap-2"
            >
              <div className="shrink-0 mt-0.5">
                <ProvenanceBadge type={sig.category} />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold block truncate">
                  {sig.label}
                </span>
                <p className="text-zinc-200 text-xs mt-0.5 break-words font-mono">{sig.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* --- DEEPER DETAILS (Expandable Tabs) --- */}
      {isExpanded && (
        <div className="pt-2 border-t border-zinc-800/80 space-y-3">
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
                <div className="divide-y divide-zinc-800/60 max-h-72 overflow-y-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60">
                  {tech.events.map((ev, idx) => (
                    <div key={idx} className="p-3 hover:bg-zinc-900/40 text-xs font-mono space-y-1">
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
                          {ev.lastTimestamp || ev.firstTimestamp || 'Live pulse'}
                        </span>
                      </div>
                      <p className="text-zinc-300 text-xs font-sans leading-relaxed">{ev.message}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 text-center text-xs text-zinc-400 font-mono">
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
                    <th className="px-3 py-2">Container</th>
                    <th className="px-3 py-2">Image</th>
                    <th className="px-3 py-2">Ready</th>
                    <th className="px-3 py-2">State / Reason</th>
                    <th className="px-3 py-2">Restarts</th>
                    <th className="px-3 py-2">Exit Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {tech.containers.map((c, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/30">
                      <td className="px-3 py-2.5 font-bold text-zinc-200">{c.name}</td>
                      <td className="px-3 py-2.5 text-zinc-400 max-w-[180px] truncate" title={c.image}>
                        {c.image}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            c.ready ? 'bg-emerald-950 text-emerald-300' : 'bg-rose-950 text-rose-300'
                          }`}
                        >
                          {c.ready ? 'READY' : 'NOT READY'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-zinc-200">
                        {c.waitingReason || c.terminationReason || c.state}
                        {c.waitingMessage && (
                          <div className="text-[10px] text-rose-400 max-w-[200px] truncate mt-0.5" title={c.waitingMessage}>
                            {c.waitingMessage}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-zinc-300">{c.restartCount ?? 0}</td>
                      <td className="px-3 py-2.5 text-zinc-300">{c.exitCode !== undefined ? c.exitCode : '-'}</td>
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
                    <th className="px-3 py-2">Condition Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Reason / Message</th>
                    <th className="px-3 py-2">Last Transition</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {tech.conditions.map((cond, idx) => (
                    <tr key={idx} className="hover:bg-zinc-900/30">
                      <td className="px-3 py-2 font-bold text-zinc-200">{cond.type}</td>
                      <td className="px-3 py-2">
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
                      <td className="px-3 py-2 text-zinc-300 text-xs">
                        {cond.reason && <span className="font-semibold text-zinc-200 mr-1">{cond.reason}:</span>}
                        <span>{cond.message || 'No additional message.'}</span>
                      </td>
                      <td className="px-3 py-2 text-zinc-400 text-[11px]">
                        {cond.lastTransitionTime ? cond.lastTransitionTime.slice(0, 19).replace('T', ' ') : 'Not available'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: DIAGNOSTIC MESSAGE & RAW DETAILS */}
          {activeTab === 'raw' && (
            <div className="p-4 rounded-lg bg-zinc-950 border border-zinc-800 font-mono text-xs space-y-3">
              <div>
                <span className="text-[10px] text-zinc-500 uppercase font-bold block mb-1">
                  Kubelet Diagnostic Error String:
                </span>
                <div className="p-3 rounded bg-zinc-900/80 border border-zinc-800 text-rose-300 leading-relaxed break-words">
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
            <div className="space-y-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                {/* AI Grounding Items */}
                {aiAnalysis?.evidence?.map((ev, idx) => {
                  const type =
                    ev.category === 'OBSERVED_FACT'
                      ? 'CONFIRMED'
                      : ev.category === 'PROPOSED_CHANGE'
                      ? 'RECOMMENDATION'
                      : 'INFERENCE';
                  return (
                    <div key={`ai-${idx}`} className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">
                        <ProvenanceBadge
                          type={type}
                          label={ev.category === 'OBSERVED_FACT' ? 'CONFIRMED FACT' : ev.category === 'PROPOSED_CHANGE' ? 'PROPOSED' : 'INFERENCE'}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase block">
                          {ev.source}
                        </span>
                        <p className="text-zinc-200 text-xs mt-0.5 break-words font-mono">{ev.detail}</p>
                      </div>
                    </div>
                  );
                })}

                {/* Technical Details Evidence Items */}
                {tech.evidence?.map((ev, idx) => (
                  <div key={`tech-${idx}`} className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-800 flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">
                      <ProvenanceBadge type="CONFIRMED" label="CONFIRMED FACT" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase block">
                        {ev.source || 'Kubelet Telemetry'}
                      </span>
                      <p className="text-zinc-200 text-xs mt-0.5 break-words font-mono">{ev.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
