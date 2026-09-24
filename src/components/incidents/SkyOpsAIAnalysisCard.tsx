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
  AlertCircle,
  Terminal,
  Activity,
  Layers,
  Crosshair,
  GitCommit,
  Radio,
  FileText
} from 'lucide-react';
import {
  SkyOpsAIAnalysis,
  StructuredRemediation,
  AIRiskLevel,
  AIEvidenceCategory,
  BlastRadiusScope,
  InvestigationEvidenceItem,
  InvestigationEvidenceType,
  InvestigationTimelineEvent,
  RootCauseProbability,
  RuledOutCause,
  TimelineCausalRelation
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
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [showDeepReasoning, setShowDeepReasoning] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'probabilities' | 'evidence' | 'timeline' | 'commands'>('overview');

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
    const text = `[SkyOps AI SRE Incident Investigation]
Ticket: ${analysis.incidentId}
1. Summary: ${analysis.summary}
2. Root Cause: ${analysis.rootCause}
3. Confidence: ${Math.round(analysis.confidence * 100)}% (${analysis.confidenceExplanation || 'Evidence verified'})
4. Blast Radius: ${analysis.blastRadius || 'SINGLE_POD'}
5. Recommended Fix: ${analysis.recommendedFix.description}
6. Risk: ${analysis.recommendedFix.risk} (${analysis.riskExplanation || analysis.recommendedFix.reason})
7. Expected Impact: ${analysis.expectedImpact || analysis.recommendedFix.expectedImpact}
8. Rollback: ${analysis.rollback || analysis.recommendedFix.rollback}
9. Verification: ${analysis.verificationCriteria?.expectedState || 'Telemetry check'}
10. Safer Alternative: ${analysis.saferAlternative.description}`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCommand(cmd);
    setTimeout(() => setCopiedCommand(null), 2500);
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

  const getBlastRadiusBadge = (radius?: BlastRadiusScope) => {
    switch (radius) {
      case 'CLUSTER_WIDE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">CLUSTER WIDE</span>;
      case 'NAMESPACE_WIDE':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">NAMESPACE WIDE</span>;
      case 'WORKLOAD_ROLLOUT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800">WORKLOAD ROLLOUT</span>;
      case 'ISOLATED_CONTAINER':
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">ISOLATED CONTAINER</span>;
      case 'SINGLE_POD':
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-950 text-sky-300 border border-sky-800">SINGLE POD</span>;
    }
  };

  const getConfidenceColor = (confidence: number) => {
    const pct = Math.round(confidence * 100);
    if (pct >= 85) return 'text-emerald-400 bg-emerald-950/60 border-emerald-800/80';
    if (pct >= 60) return 'text-amber-400 bg-amber-950/60 border-amber-800/80';
    return 'text-zinc-400 bg-zinc-900 border-zinc-700';
  };

  const getEvidenceTypeBadge = (type: InvestigationEvidenceType) => {
    switch (type) {
      case 'FACT':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">FACT</span>;
      case 'INFERENCE':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-950 text-sky-300 border border-sky-800">INFERENCE</span>;
      case 'HYPOTHESIS':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">HYPOTHESIS</span>;
      case 'UNKNOWN':
      default:
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800">UNKNOWN</span>;
    }
  };

  const getCausalBadge = (causal: TimelineCausalRelation) => {
    switch (causal) {
      case 'TRIGGER':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">TRIGGER</span>;
      case 'SYMPTOM':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800">SYMPTOM</span>;
      case 'CONSEQUENCE':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800">CONSEQUENCE</span>;
      case 'RECOVERY_ATTEMPT':
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-sky-950 text-sky-300 border border-sky-800">RECOVERY</span>;
      default:
        return <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-zinc-900 text-zinc-400 border border-zinc-700">OBSERVED</span>;
    }
  };

  const evidenceItems: InvestigationEvidenceItem[] = analysis?.investigationEvidence || [];
  const timelineItems: InvestigationTimelineEvent[] = analysis?.investigationTimeline || [];
  const probabilities: RootCauseProbability[] = analysis?.rootCauseProbabilities || (analysis?.investigation?.rootCauseProbabilities || []);
  const ruledOut: RuledOutCause[] = analysis?.ruledOutCauses || (analysis?.investigation?.ruledOutCauses || []);

  return (
    <div className="p-5 rounded-xl bg-linear-to-b from-zinc-900/90 via-zinc-900/60 to-zinc-950 border border-sky-900/40 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400">
            <Sparkles className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider flex items-center gap-1.5">
                7. SkyOps AI SRE Investigation Engine
              </h3>
              {analysis && (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-sky-950/80 text-sky-300 border border-sky-800/70 flex items-center gap-1">
                  <Cpu className="w-2.5 h-2.5" />
                  {analysis.model || 'Gemini 2.5 Flash'}
                </span>
              )}
              {analysis?.blastRadius && getBlastRadiusBadge(analysis.blastRadius)}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Evidence-first root cause investigation, timeline correlation, blast radius, and SRE action plan
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
              {loading ? 'Investigating...' : 'Re-Investigate'}
            </Button>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && !analysis && (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-center">
          <RefreshCw className="w-5 h-5 text-sky-400 animate-spin" />
          <p className="text-xs font-semibold text-zinc-200 font-mono">Running SkyOps AI SRE Investigation...</p>
          <p className="text-[11px] text-zinc-400 font-mono">
            Indexing evidence items, reconstructing causal timeline, and scoring root cause hypotheses
          </p>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/70 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-amber-300">AI Investigation Notice</p>
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
                {analysis.errorMessage || 'AI reasoning engine is running in offline fallback mode with deterministic evidence extraction.'}
              </span>
            </div>
          )}

          {/* SRE Navigation Tabs */}
          <div className="flex items-center gap-1 border-b border-zinc-800/80 pb-1 text-xs font-mono overflow-x-auto">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Findings & Remediation
            </button>
            <button
              onClick={() => setActiveTab('probabilities')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'probabilities'
                  ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              Probabilities & Ruled Out ({probabilities.length + ruledOut.length})
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'evidence'
                  ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Evidence Matrix ({evidenceItems.length || analysis.evidence.length})
            </button>
            <button
              onClick={() => setActiveTab('timeline')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'timeline'
                  ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              Incident Timeline ({timelineItems.length})
            </button>
            <button
              onClick={() => setActiveTab('commands')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer ${
                activeTab === 'commands'
                  ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              SRE Commands & Safety
            </button>
          </div>

          {/* TAB 1: OVERVIEW & SRE DIAGNOSIS */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Primary RCA Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 text-xs">
                {/* Left: Summary & Root Cause */}
                <div className="lg:col-span-8 p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2.5">
                  <div>
                    <span className="text-[10px] font-mono uppercase font-bold text-sky-400 block mb-1">
                      Observable Failure Summary:
                    </span>
                    <p className="text-zinc-200 text-xs leading-relaxed font-sans bg-zinc-900/60 p-2.5 rounded border border-zinc-800/60">
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
                    <p className="text-xs font-semibold text-zinc-100 leading-relaxed font-sans bg-zinc-900/60 p-2.5 rounded border border-zinc-800/60">
                      {analysis.rootCause}
                    </p>
                  </div>
                </div>

                {/* Right: Confidence Score & Blast Radius */}
                <div className="lg:col-span-4 p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 flex flex-col justify-between gap-2.5">
                  <div>
                    <span className="text-[10px] font-mono uppercase font-bold text-zinc-400 block mb-1">
                      Investigation Confidence:
                    </span>
                    <div className="flex items-center gap-2">
                      <div className={`px-2.5 py-1 rounded-md border font-mono font-bold text-base ${getConfidenceColor(analysis.confidence)}`}>
                        {Math.round(analysis.confidence * 100)}%
                      </div>
                      <div className="text-[11px] text-zinc-400 leading-tight">
                        {analysis.confidenceExplanation ||
                          (analysis.confidence >= 0.85
                            ? 'High certainty supported by authoritative cluster telemetry'
                            : 'Moderate certainty; additional telemetry recommended')}
                      </div>
                    </div>
                  </div>

                  {/* Blast Radius Box */}
                  <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-zinc-400 font-bold uppercase">Estimated Blast Radius:</span>
                      {getBlastRadiusBadge(analysis.blastRadius)}
                    </div>
                    <p className="text-[10px] text-zinc-400 leading-tight">
                      {analysis.expectedImpact || 'Isolated to target workload and backing pods.'}
                    </p>
                  </div>

                  {/* Guardrails Pill */}
                  <div className="p-2 rounded bg-zinc-900 border border-zinc-800 flex items-center gap-2">
                    <Lock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <div className="text-[10px] font-mono">
                      <span className="text-zinc-200 font-bold block">Deterministic Safety Gate</span>
                      <span className="text-zinc-400 text-[9px]">SRE Human approval required before mutation</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommended Fix & Telemetry Verification Criteria */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {/* Recommended Fix */}
                <div className="p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase font-bold text-sky-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Recommended SRE Action
                    </span>
                    {getRiskBadge(analysis.recommendedFix.risk)}
                  </div>
                  <p className="text-xs font-semibold text-zinc-100 leading-relaxed font-sans">
                    {analysis.recommendedFix.description}
                  </p>
                  <p className="text-[11px] text-zinc-400 leading-relaxed font-sans">
                    <strong className="text-zinc-300">Why this resolves root cause:</strong> {analysis.recommendedFix.reason}
                  </p>
                  {analysis.changePreview && (
                    <div className="p-2 rounded bg-zinc-900/90 border border-zinc-800 font-mono text-[10px] space-y-0.5">
                      <div className="text-zinc-400 uppercase font-bold text-[9px]">Exact Change Preview:</div>
                      <div className="text-zinc-300 truncate">
                        Target: <span className="text-sky-300">{analysis.changePreview.resource}/{analysis.changePreview.object}</span> (ns: {analysis.changePreview.namespace})
                      </div>
                      <div className="text-zinc-300 truncate">
                        Field: <span className="text-zinc-400">{analysis.changePreview.field}</span>
                      </div>
                      <div className="text-rose-300 truncate">- {analysis.changePreview.currentValue}</div>
                      <div className="text-emerald-300 truncate">+ {analysis.changePreview.proposedValue}</div>
                    </div>
                  )}
                </div>

                {/* Telemetry Verification Criteria */}
                <div className="p-3.5 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-2">
                  <span className="text-[10px] font-mono uppercase font-bold text-emerald-400 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Telemetry Verification Criteria
                  </span>
                  {analysis.verificationCriteria ? (
                    <div className="p-2.5 rounded bg-zinc-900 border border-zinc-800 space-y-1.5 font-mono text-[11px]">
                      <div className="text-zinc-200 font-semibold">
                        Expected State: <span className="text-emerald-300">{analysis.verificationCriteria.expectedState}</span>
                      </div>
                      {analysis.verificationCriteria.conditions && analysis.verificationCriteria.conditions.length > 0 && (
                        <div className="space-y-1 text-zinc-300 text-[10px]">
                          {analysis.verificationCriteria.conditions.map((cond, idx) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-sky-300">{cond.type}={cond.status}</span>
                              {cond.description && <span className="text-zinc-400 truncate">({cond.description})</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400 font-mono">Observe Kubernetes pod condition Ready=True</p>
                  )}
                  {analysis.rollback && (
                    <div className="p-2 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono">
                      <span className="text-zinc-400 uppercase font-bold text-[9px] block">Rollback Strategy:</span>
                      <span className="text-amber-300 break-all">{analysis.rollback}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ROOT CAUSE PROBABILITIES & RULED OUT CAUSES */}
          {activeTab === 'probabilities' && (
            <div className="space-y-4">
              {/* Evaluated Root Cause Probabilities */}
              <div className="p-4 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-3">
                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                  <span className="text-xs font-mono font-bold text-sky-400 uppercase flex items-center gap-1.5">
                    <Crosshair className="w-4 h-4" />
                    Evaluated Root Cause Probabilities ({probabilities.length})
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500">Sum of confidence weights</span>
                </div>

                <div className="space-y-3">
                  {probabilities.map((prob, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {prob.isPrimary && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                              PRIMARY
                            </span>
                          )}
                          <span className="font-mono text-xs font-bold text-zinc-100">{prob.cause}</span>
                        </div>
                        <span className="font-mono text-xs font-bold text-sky-400">{prob.probabilityPercent}%</span>
                      </div>

                      {/* Percentage Bar */}
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${prob.isPrimary ? 'bg-emerald-500' : 'bg-sky-500'}`}
                          style={{ width: `${Math.min(100, Math.max(5, prob.probabilityPercent))}%` }}
                        />
                      </div>

                      <p className="text-[11px] text-zinc-300 font-sans">{prob.explanation}</p>

                      {prob.citedEvidenceIds && prob.citedEvidenceIds.length > 0 && (
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          <span className="text-[9px] font-mono text-zinc-500">Cited Evidence:</span>
                          {prob.citedEvidenceIds.map((eid, eidx) => (
                            <span key={eidx} className="px-1 py-0.2 rounded text-[9px] font-mono bg-zinc-800 text-sky-300 border border-zinc-700">
                              {eid}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Ruled-Out Hypotheses */}
              {ruledOut.length > 0 && (
                <div className="p-4 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-3">
                  <div className="flex items-center gap-1.5 border-b border-zinc-800/80 pb-2">
                    <Shield className="w-4 h-4 text-zinc-400" />
                    <span className="text-xs font-mono font-bold text-zinc-300 uppercase">
                      Ruled-Out Hypotheses ({ruledOut.length})
                    </span>
                  </div>

                  <div className="space-y-2">
                    {ruledOut.map((ro, idx) => (
                      <div key={idx} className="p-2.5 rounded bg-zinc-900/60 border border-zinc-800/60 text-xs font-mono">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                            RULED OUT
                          </span>
                          <span className="text-zinc-200 font-bold">{ro.cause}</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 font-sans pl-1">{ro.reasonRuledOut}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: EVIDENCE MATRIX */}
          {activeTab === 'evidence' && (
            <div className="p-4 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <span className="text-xs font-mono font-bold text-emerald-400 uppercase flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  Corroborating Evidence Grounding Matrix ({evidenceItems.length || analysis.evidence.length})
                </span>
                <div className="flex items-center gap-2 text-[9px] font-mono text-zinc-400">
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> FACT</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-400" /> INFERENCE</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> HYPOTHESIS</span>
                  <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-purple-400" /> UNKNOWN</span>
                </div>
              </div>

              {evidenceItems.length > 0 ? (
                <div className="space-y-2">
                  {evidenceItems.map((ev, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/90 flex items-start gap-2.5">
                      <div className="shrink-0 flex flex-col items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-zinc-800 text-sky-300 border border-zinc-700">
                          {ev.id}
                        </span>
                        {getEvidenceTypeBadge(ev.type)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase">
                            Source: {ev.source}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400">
                            Confidence: <strong className="text-emerald-400">{ev.confidence}%</strong>
                          </span>
                        </div>
                        <p className="text-zinc-200 text-xs mt-1 leading-relaxed font-sans">{ev.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {analysis.evidence.map((ev, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800/90 flex items-start gap-2.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-800">
                        {ev.category || 'OBSERVED_FACT'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[10px] font-bold text-zinc-400 uppercase block">{ev.source}</span>
                        <p className="text-zinc-200 text-xs mt-1 leading-relaxed font-mono">{ev.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: CHRONOLOGICAL TIMELINE */}
          {activeTab === 'timeline' && (
            <div className="p-4 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <span className="text-xs font-mono font-bold text-sky-400 uppercase flex items-center gap-1.5">
                  <Clock className="w-4 h-4" />
                  Chronological Incident Investigation Timeline ({timelineItems.length})
                </span>
                <span className="text-[10px] font-mono text-zinc-400">Relative to incident onset</span>
              </div>

              {timelineItems.length > 0 ? (
                <div className="relative pl-4 border-l border-zinc-800 space-y-3 my-2">
                  {timelineItems.map((item, idx) => (
                    <div key={idx} className="relative group">
                      <div className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full bg-sky-500 border border-zinc-900" />
                      <div className="p-2.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 space-y-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-2">
                            {getCausalBadge(item.causalRelation)}
                            <span className="font-mono text-xs font-bold text-zinc-200">{item.title}</span>
                          </div>
                          <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.5 rounded">
                            {item.temporalDistance || new Date(item.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-300 font-sans">{item.description}</p>
                        <div className="text-[9px] font-mono text-zinc-500">
                          Resource: {item.resourceKind}/{item.resourceName} • Source: {item.source}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-zinc-400 font-mono py-4 text-center">
                  Timeline events are being compiled from active cluster telemetry.
                </p>
              )}
            </div>
          )}

          {/* TAB 5: SRE COMMANDS & SAFETY */}
          {activeTab === 'commands' && (
            <div className="p-4 bg-zinc-950/90 rounded-lg border border-zinc-800/80 space-y-4 text-xs font-mono">
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2">
                <span className="font-bold text-sky-400 uppercase flex items-center gap-1.5">
                  <Terminal className="w-4 h-4" />
                  Recommended SRE Commands
                </span>
                <span className="text-[10px] text-zinc-400">Click to copy commands</span>
              </div>

              {/* Commands List */}
              <div className="space-y-2">
                {(analysis.recommendedCommands && analysis.recommendedCommands.length > 0) ? (
                  analysis.recommendedCommands.map((cmd, idx) => (
                    <div key={idx} className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-zinc-800 text-sky-300 uppercase">
                          {cmd.stage}
                        </span>
                        <span className="text-[10px] text-zinc-400">{cmd.description}</span>
                      </div>
                      <div className="flex items-center justify-between bg-black/60 p-2 rounded border border-zinc-800 text-zinc-200">
                        <code className="text-[11px] text-emerald-400 break-all">{cmd.command}</code>
                        <button
                          onClick={() => handleCopyCommand(cmd.command)}
                          className="ml-2 p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        >
                          {copiedCommand === cmd.command ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="space-y-2">
                    <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                      <span className="text-[10px] text-zinc-400 block uppercase font-bold">1. Pre-Check Diagnostic:</span>
                      <div className="flex items-center justify-between bg-black/60 p-2 rounded border border-zinc-800">
                        <code className="text-emerald-400 text-[11px] truncate">
                          kubectl describe pod {incidentId} -n default
                        </code>
                        <button
                          onClick={() => handleCopyCommand(`kubectl describe pod ${incidentId} -n default`)}
                          className="ml-2 p-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Declarative Alternative */}
              {analysis.saferAlternative && (
                <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 space-y-1">
                  <span className="text-zinc-400 text-[10px] uppercase font-bold block">Declarative Alternative:</span>
                  <p className="text-zinc-300 text-xs font-sans">
                    {analysis.saferAlternative.description} — {analysis.saferAlternative.reason}
                  </p>
                </div>
              )}

              {/* Missing Evidence / Unknowns */}
              {analysis.additionalEvidenceNeeded && analysis.additionalEvidenceNeeded.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-800/40 text-[11px]">
                  <span className="text-amber-400 font-bold block mb-1">Telemetry Gaps & Missing Telemetry:</span>
                  <ul className="list-disc list-inside text-zinc-300 space-y-0.5 text-[10px]">
                    {analysis.additionalEvidenceNeeded.map((item, idx) => (
                      <li key={idx} className="truncate">{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Expandable Technical Details Footer */}
          <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-950/60">
            <button
              type="button"
              onClick={() => setShowDeepReasoning(!showDeepReasoning)}
              className="w-full p-2.5 flex items-center justify-between text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900/40 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5 font-semibold text-sky-400">
                <Shield className="w-3.5 h-3.5" />
                {showDeepReasoning ? 'Hide Pipeline Latency & Policy Invariants' : 'Show Pipeline Latency Breakdown & Safety Guarantees'}
              </span>
              {showDeepReasoning ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showDeepReasoning && (
              <div className="p-3.5 border-t border-zinc-800 space-y-2 text-xs font-mono">
                {analysis.timing && (
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span>
                      Pipeline Latency: <strong className="text-sky-400">{analysis.timing.durations.totalMs}ms</strong> (Gemini: {analysis.timing.durations.geminiCallMs || 0}ms, Context: {analysis.timing.durations.contextConstructionMs}ms, Safety: {analysis.timing.durations.safetyValidationMs}ms)
                    </span>
                    <span>Analyzed {new Date(analysis.analyzedAt).toLocaleTimeString()}</span>
                  </div>
                )}
                <div className="text-[10px] text-zinc-400">
                  SkyOps SRE Invariants: Zero automated shell execution • All mutations require human approval • Evidence cited before assertions
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
