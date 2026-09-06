import React, { useState } from 'react';
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Info,
  ChevronDown,
  ChevronUp,
  Cpu,
  Lock,
  Clock,
  Shield,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import {
  SkyOpsAIAnalysis,
  StructuredRemediation,
  AIRiskLevel,
  AIEvidenceCategory
} from '../../types';
import { api } from '../../api/client';
import { Button } from '../common/UI';
import { ProvenanceBadge } from '../common/Badges';

interface SkyOpsAIAnalysisCardProps {
  incidentId: string;
  initialAnalysis?: SkyOpsAIAnalysis | null;
  initialRemediation?: StructuredRemediation | null;
  canEdit?: boolean;
  onRemediationApplied?: () => void;
  onAnalysisUpdated?: (analysis: SkyOpsAIAnalysis, remediation: StructuredRemediation | null) => void;
}

export const SkyOpsAIAnalysisCard: React.FC<SkyOpsAIAnalysisCardProps> = ({
  incidentId,
  initialAnalysis,
  initialRemediation,
  canEdit = true,
  onRemediationApplied,
  onAnalysisUpdated
}) => {
  const [analysis, setAnalysis] = useState<SkyOpsAIAnalysis | null>(initialAnalysis || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDeepReasoning, setShowDeepReasoning] = useState(false);

  // Auto-fetch if not provided initially
  React.useEffect(() => {
    if (initialAnalysis) {
      setAnalysis(initialAnalysis);
    } else {
      fetchAnalysis(false);
    }
  }, [incidentId, initialAnalysis]);

  const fetchAnalysis = async (force = false) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.triggerIncidentAIAnalysis(incidentId, force);
      setAnalysis(res.analysis);
      const rem = res.remediation || res.analysis.structuredRemediation || null;
      if (onAnalysisUpdated) {
        onAnalysisUpdated(res.analysis, rem);
      }
      if (onRemediationApplied) {
        onRemediationApplied();
      }
    } catch (err: any) {
      console.error('Failed to trigger SkyOps AI analysis:', err);
      setError(err?.message || 'Failed to complete AI analysis');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyAnalysis = () => {
    if (!analysis) return;
    const text = `[SkyOps AI Incident Intelligence]
Ticket: ${analysis.incidentId}
1. Summary: ${analysis.summary}
2. Root Cause: ${analysis.rootCause}
3. Confidence: ${Math.round(analysis.confidence * 100)}% (${analysis.confidenceExplanation || 'Evidence verified'})
4. Recommended Fix: ${analysis.recommendedFix.description}
5. Risk: ${analysis.recommendedFix.risk} (${analysis.riskExplanation || analysis.recommendedFix.reason})
6. Expected Impact: ${analysis.expectedImpact || analysis.recommendedFix.expectedImpact}
7. Rollback: ${analysis.rollback || analysis.recommendedFix.rollback}
8. Verification: ${analysis.verificationCriteria?.expectedState || 'Telemetry check'}
9. Safer Alternative: ${analysis.saferAlternative.description}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const getRiskBadge = (risk: AIRiskLevel) => {
    switch (risk) {
      case 'CRITICAL':
      case 'HIGH':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800">
            <AlertTriangle className="w-3 h-3" />
            HIGH RISK
          </span>
        );
      case 'MEDIUM':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800">
            <AlertTriangle className="w-3 h-3" />
            MEDIUM RISK
          </span>
        );
      case 'LOW':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
            <ShieldCheck className="w-3 h-3" />
            LOW RISK
          </span>
        );
    }
  };

  const getConfidenceColor = (confidence: number) => {
    const pct = Math.round(confidence * 100);
    if (pct >= 85) return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80';
    if (pct >= 60) return 'text-amber-400 bg-amber-950/60 border-amber-800/80';
    return 'text-zinc-400 bg-zinc-900 border-zinc-700';
  };

  const getEvidenceCategoryBadge = (category?: AIEvidenceCategory) => {
    switch (category) {
      case 'OBSERVED_FACT':
        return <ProvenanceBadge type="CONFIRMED" label="CONFIRMED FACT" />;
      case 'AI_INFERENCE':
        return <ProvenanceBadge type="INFERENCE" label="AI INFERENCE" />;
      case 'PROPOSED_CHANGE':
        return <ProvenanceBadge type="RECOMMENDATION" label="PROPOSED CHANGE" />;
      default:
        return (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-zinc-900 text-zinc-400 border border-zinc-700">
            EVIDENCE
          </span>
        );
    }
  };

  return (
    <div className="p-5 rounded-xl bg-linear-to-b from-zinc-900/90 via-zinc-900/60 to-zinc-950 border border-sky-900/40 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider flex items-center gap-1.5">
                7. SkyOps AI Analysis & Telemetry Correlation
              </h3>
              {analysis && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/70 flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" />
                  {analysis.model || 'Gemini 2.5 Flash'}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Evidence correlation, inference classification, and telemetry verification criteria
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {analysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyAnalysis}
              icon={copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              className="text-xs font-mono"
            >
              {copied ? 'Copied' : 'Copy RCA'}
            </Button>
          )}

          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => fetchAnalysis(true)}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              className="bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold font-mono"
            >
              {loading ? 'Reasoning...' : 'Re-Analyze'}
            </Button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && !analysis && (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-center">
          <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
          <p className="text-xs font-semibold text-zinc-200 font-mono">Running SkyOps AI Reasoning Engine...</p>
          <p className="text-[11px] text-zinc-400 font-mono">
            Correlating Kubernetes telemetry, container states, exit codes, and events
          </p>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/70 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-300">AI Analysis Notice</p>
            <p className="text-[11px] text-amber-200/90">{error}</p>
          </div>
        </div>
      )}

      {/* Analysis Content */}
      {analysis && (
        <div className="space-y-4">
          {/* Status notice if unavailable */}
          {analysis.status === 'UNAVAILABLE' && (
            <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/60 flex items-center gap-2 text-xs text-amber-300">
              <Info className="w-4 h-4 text-amber-400 shrink-0" />
              <span>
                {analysis.errorMessage || 'AI reasoning engine is running in offline fallback mode. Core incident monitoring continues normally.'}
              </span>
            </div>
          )}

          {/* Primary RCA Grid: Summary & Root Cause vs Confidence */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 text-xs">
            {/* Left: Observable Failure Summary & Proven Root Cause (8 cols) */}
            <div className="lg:col-span-8 p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2.5">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-sky-400 block mb-1">
                  Observable Failure Summary:
                </span>
                <p className="text-zinc-200 text-xs leading-relaxed font-sans bg-zinc-900/60 p-2 rounded border border-zinc-800/60">
                  {analysis.summary}
                </p>
              </div>

              <div className="border-t border-zinc-800/70 pt-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono uppercase font-bold text-emerald-400">
                    Proven Root Cause:
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                    EVIDENCE BACKED
                  </span>
                </div>
                <p className="text-xs font-semibold text-zinc-100 leading-relaxed font-sans">
                  {analysis.rootCause}
                </p>
              </div>
            </div>

            {/* Right: Confidence Score & Verification (4 cols) */}
            <div className="lg:col-span-4 p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 flex flex-col justify-between gap-2.5">
              <div>
                <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 block mb-1">
                  Confidence Score:
                </span>
                <div className="flex items-center gap-2">
                  <div className={`px-2.5 py-1 rounded-md border font-mono font-bold text-base ${getConfidenceColor(analysis.confidence)}`}>
                    {Math.round(analysis.confidence * 100)}%
                  </div>
                  <div className="text-[11px] text-zinc-400 leading-tight">
                    {analysis.confidenceExplanation ||
                      (analysis.confidence >= 0.85
                        ? 'High certainty supported by authoritative telemetry'
                        : 'Moderate certainty; inspect supplementary logs')}
                  </div>
                </div>
              </div>

              {/* Guardrails Pill */}
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <div className="text-[10px] font-mono">
                  <span className="text-zinc-200 font-bold block">Deterministic Safety Gate</span>
                  <span className="text-zinc-400 text-[9px]">Reasoning only • Human approval required</span>
                </div>
              </div>
            </div>
          </div>

          {/* Categorized Grounding Evidence Signals */}
          {analysis.evidence && analysis.evidence.length > 0 && (
            <div className="p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-emerald-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Corroborating Evidence Grounding ({analysis.evidence.length})
                </span>
                <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-400">
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Fact
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> Inference
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400" /> Proposed
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {analysis.evidence.map((ev, idx) => (
                  <div key={idx} className="p-2 rounded bg-zinc-900/70 border border-zinc-800 flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">{getEvidenceCategoryBadge(ev.category)}</div>
                    <div className="min-w-0 flex-1">
                      <span className="font-mono text-[9px] font-bold text-zinc-400 uppercase block">
                        {ev.source}
                      </span>
                      <p className="text-zinc-200 text-xs mt-0.5 break-words font-mono">{ev.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Fix & Telemetry Verification Criteria */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {/* Recommended Fix */}
            <div className="p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase font-bold text-sky-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Recommended Action
                </span>
                {getRiskBadge(analysis.recommendedFix.risk)}
              </div>
              <p className="text-xs font-semibold text-zinc-100 leading-relaxed font-sans">
                {analysis.recommendedFix.description}
              </p>
              <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                <strong className="text-zinc-300">Why this resolves root cause:</strong> {analysis.recommendedFix.reason}
              </p>
            </div>

            {/* Telemetry Verification Criteria */}
            <div className="p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2">
              <span className="text-[10px] font-mono uppercase font-bold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Telemetry Verification Criteria
              </span>
              {analysis.verificationCriteria ? (
                <div className="p-2 rounded bg-zinc-900 border border-zinc-800 space-y-1 font-mono text-[11px]">
                  <div className="text-zinc-200 font-semibold">
                    Expected State: <span className="text-emerald-300">{analysis.verificationCriteria.expectedState}</span>
                  </div>
                  {analysis.verificationCriteria.conditions && analysis.verificationCriteria.conditions.length > 0 && (
                    <div className="space-y-0.5 text-zinc-300 text-[10px]">
                      {analysis.verificationCriteria.conditions.map((cond, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-sky-300">{cond.type}={cond.status}</span>
                          {cond.description && <span className="text-zinc-400 truncate">({cond.description})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 font-mono">Observe Kubernetes pod condition Ready=True</p>
              )}
            </div>
          </div>

          {/* --- EXPANDABLE DEEP TECHNICAL REASONING --- */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/60">
            <button
              type="button"
              onClick={() => setShowDeepReasoning(!showDeepReasoning)}
              className="w-full p-2.5 flex items-center justify-between text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-semibold text-sky-400">
                <Shield className="w-3.5 h-3.5" />
                {showDeepReasoning ? 'Hide Deep Technical Rationale & Safety Policy' : 'Show Deep Technical Rationale (Risk, Rollback, Alternative)'}
              </span>
              {showDeepReasoning ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showDeepReasoning && (
              <div className="p-3.5 border-t border-zinc-800 space-y-3 text-xs font-mono">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Expected Impact & Risk Explanation */}
                  <div className="space-y-2">
                    <div>
                      <span className="text-zinc-500 text-[10px] block uppercase font-bold">Expected Impact</span>
                      <p className="text-zinc-300 text-xs font-sans mt-0.5">
                        {analysis.expectedImpact || analysis.recommendedFix.expectedImpact}
                      </p>
                    </div>

                    {analysis.riskExplanation && (
                      <div>
                        <span className="text-zinc-500 text-[10px] block uppercase font-bold">Risk Assessment</span>
                        <p className="text-zinc-300 text-xs font-sans mt-0.5">{analysis.riskExplanation}</p>
                      </div>
                    )}
                  </div>

                  {/* Rollback Procedure & Safer Alternative */}
                  <div className="space-y-2">
                    <div>
                      <span className="text-zinc-500 text-[10px] block uppercase font-bold">Rollback Procedure</span>
                      <p className="text-zinc-200 text-xs font-mono bg-zinc-900 p-1.5 rounded border border-zinc-800 mt-0.5 break-all">
                        {analysis.rollback || analysis.recommendedFix.rollback}
                      </p>
                    </div>

                    {analysis.saferAlternative && (
                      <div>
                        <span className="text-zinc-500 text-[10px] block uppercase font-bold">Safest Declarative Alternative</span>
                        <p className="text-zinc-300 text-xs font-sans mt-0.5">
                          {analysis.saferAlternative.description} — {analysis.saferAlternative.reason}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Additional Evidence Needed (if any) */}
                {analysis.additionalEvidenceNeeded && analysis.additionalEvidenceNeeded.length > 0 && (
                  <div className="pt-2 border-t border-zinc-800 text-[11px]">
                    <span className="text-amber-400 font-bold block mb-1">Supplementary Evidence Needed for 100% Certainty:</span>
                    <ul className="list-disc list-inside text-zinc-300 space-y-0.5 text-[10px]">
                      {analysis.additionalEvidenceNeeded.map((item, idx) => (
                        <li key={idx} className="truncate">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Timing Metrics Breakdown */}
                {analysis.timing && (
                  <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
                    <span>
                      Latency: <strong className="text-sky-400">{analysis.timing.durations.totalMs}ms</strong> (Gemini: {analysis.timing.durations.geminiCallMs || 0}ms, Context: {analysis.timing.durations.contextConstructionMs}ms)
                    </span>
                    <span>Analyzed {new Date(analysis.analyzedAt).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
