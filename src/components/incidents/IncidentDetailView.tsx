import {
  Activity,
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  HelpCircle,
  Info,
  Layers,
  MessageSquare,
  Play,
  RefreshCw,
  Send,
  Server,
  Shield,
  ShieldCheck,
  Tag,
  Trash2,
  User,
  UserCheck,
  XCircle
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import {
  Incident,
  IncidentNote,
  IncidentSeverity,
  IncidentStatus,
  SkyOpsAIAnalysis,
  StructuredRemediation,
  TimelineEvent
} from '../../types/index';
import { formatDuration, formatReportDate, generateIncidentPdf, getPriorityLabel } from '../../utils/incidentPdfGenerator';
import { SeverityBadge, StatusBadge, ProvenanceBadge } from '../common/Badges';
import { Button, CopyButton, EmptyState, LoadingState } from '../common/UI';
import { SkyOpsAIAnalysisCard } from './SkyOpsAIAnalysisCard';
import { IncidentRemediationCard } from './IncidentRemediationCard';
import { IncidentEvidenceSection } from './IncidentEvidenceSection';

interface IncidentDetailViewProps {
  incidentId: string;
  onBack: () => void;
  onSelectCluster?: (clusterId: string) => void;
}

export const IncidentDetailView: React.FC<IncidentDetailViewProps> = ({
  incidentId,
  onBack,
  onSelectCluster
}) => {
  const { canEditIncidents, members } = useAuth();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [notes, setNotes] = useState<IncidentNote[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<SkyOpsAIAnalysis | null>(null);
  const [remediation, setRemediation] = useState<StructuredRemediation | null>(null);
  const [loading, setLoading] = useState(true);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [statusUpdateLoading, setStatusUpdateLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfSuccess, setPdfSuccess] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchIncidentData = async () => {
    try {
      setLoading(true);
      const data = await api.getIncident(incidentId);
      setIncident(data.incident);
      setTimeline(data.timeline);
      setNotes(data.notes);
      if (data.aiAnalysis) {
        setAiAnalysis(data.aiAnalysis);
      }
      if (data.remediation) {
        setRemediation(data.remediation);
      }
    } catch (err) {
      console.error('Failed to fetch incident details:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidentData();
  }, [incidentId]);

  const handleDownloadPdf = () => {
    if (!incident) return;
    try {
      setIsGeneratingPdf(true);
      generateIncidentPdf({ incident, timeline, notes });
      setPdfSuccess(true);
      setTimeout(() => setPdfSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to generate incident PDF report:', err);
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDelete = async () => {
    if (!incident || !canEditIncidents) return;
    if (!window.confirm(`Are you sure you want to delete incident ticket ${incident.id}?`)) return;
    try {
      setIsDeleting(true);
      await api.deleteIncident(incident.id);
      onBack();
    } catch (err) {
      console.error('Failed to delete incident:', err);
      setIsDeleting(false);
    }
  };

  const handleStatusChange = async (newStatus: IncidentStatus) => {
    if (!incident || !canEditIncidents) return;
    try {
      setStatusUpdateLoading(true);
      setStatusError(null);
      let resolutionReason: string | undefined = undefined;
      if (newStatus === 'RESOLVED') {
        const inputReason = window.prompt('Enter an optional resolution note or reason for manually marking this incident resolved:');
        if (inputReason !== null) {
          resolutionReason = inputReason.trim() || undefined;
        }
      }
      const updated = await api.updateIncident(incident.id, { status: newStatus, resolutionReason });
      setIncident(updated);
      const updatedData = await api.getIncident(incident.id);
      setTimeline(updatedData.timeline);
    } catch (err: any) {
      console.error('Failed to update status:', err);
      setStatusError(err?.message || 'Failed to update incident status');
    } finally {
      setStatusUpdateLoading(false);
    }
  };

  const handleAssigneeChange = async (userId: string) => {
    if (!incident || !canEditIncidents) return;
    const member = members.find((m) => m.userId === userId);
    try {
      const assignee = member ? { userId: member.userId, name: member.name, email: member.email } : undefined;
      const updated = await api.updateIncident(incident.id, { assignee });
      setIncident(updated);
      const updatedData = await api.getIncident(incident.id);
      setTimeline(updatedData.timeline);
    } catch (err) {
      console.error('Failed to assign incident:', err);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteContent.trim() || !incident || !canEditIncidents) return;

    try {
      setIsSubmittingNote(true);
      const note = await api.addIncidentNote(incident.id, newNoteContent.trim());
      setNotes((prev) => [...prev, note]);
      setNewNoteContent('');

      const updatedData = await api.getIncident(incident.id);
      setTimeline(updatedData.timeline);
    } catch (err) {
      console.error('Failed to add note:', err);
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'Never';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ago`;
  };

  if (loading && !incident) {
    return <LoadingState message="Loading incident ticket..." />;
  }

  if (!incident) {
    return (
      <div className="p-8">
        <EmptyState
          title="Incident Not Found"
          description="The requested incident ticket could not be found."
          action={{ label: 'Return to Incidents', onClick: onBack }}
        />
      </div>
    );
  }

  const tech = incident.technicalDetails || {};
  const priority = getPriorityLabel(incident.severity);

  // 1. Lifecycle Stage Determination
  const isResolved = incident.status === 'RESOLVED' || incident.status === 'CLOSED';
  const isVerifying = remediation?.status === 'VERIFYING' || (!isResolved && incident.resolutionSource === 'AUTOMATIC_VERIFIED');
  const isRemediationActive =
    remediation?.status === 'PROPOSED' ||
    remediation?.status === 'DISPATCHED' ||
    remediation?.status === 'EXECUTED' ||
    (!isResolved && incident.status === 'IN_PROGRESS');
  const isInvestigating = !isResolved && (incident.status === 'OPEN' || incident.status === 'ACKNOWLEDGED') && !isRemediationActive && !isVerifying;

  // 2. What Happened Statement
  const getWhatHappenedStatement = () => {
    if (incident.incidentType === 'ImagePullBackOff') {
      return `${incident.resourceName} cannot start because Kubernetes cannot pull the configured container image.`;
    }
    if (incident.incidentType === 'CrashLoopBackOff') {
      return `${incident.resourceName} is failing to start and crashing repeatedly in container runtime (exit code ${tech.exitCode ?? 'non-zero'}).`;
    }
    if (incident.incidentType === 'DeploymentDegraded') {
      return `${incident.resourceName} is degraded and has not met its target replica availability (${tech.availableReplicas ?? 0}/${tech.desiredReplicas ?? 1} available).`;
    }
    if (aiAnalysis?.summary) return aiAnalysis.summary;
    if (tech.message) return tech.message;
    return `Kubernetes observed failure state '${incident.incidentType}' on ${incident.resourceKind} ${incident.resourceName}.`;
  };

  // 3. Root Cause Provenance Segregation
  const confirmedFact =
    tech.rootCause ||
    aiAnalysis?.evidence?.find((e) => e.category === 'OBSERVED_FACT')?.detail ||
    (tech.evidence && tech.evidence.length > 0 ? tech.evidence[0].message : null) ||
    (tech.reason ? `Kubelet failure state: ${tech.reason}` : null);

  const inferenceHypothesis =
    aiAnalysis?.evidence?.find((e) => e.category === 'AI_INFERENCE')?.detail ||
    (aiAnalysis?.rootCause && aiAnalysis.confidence < 1.0 ? aiAnalysis.rootCause : null) ||
    (incident.incidentType === 'ImagePullBackOff'
      ? 'The image name or tag may be incorrect or registry authentication credentials may be missing.'
      : null);

  const unknownInvestigationNote =
    !confirmedFact && (!aiAnalysis || aiAnalysis.status === 'UNAVAILABLE')
      ? 'Root cause is currently undetermined. Diagnostic telemetry and container status are under active inspection.'
      : aiAnalysis?.additionalEvidenceNeeded && aiAnalysis.additionalEvidenceNeeded.length > 0
      ? `Supplementary evidence needed: ${aiAnalysis.additionalEvidenceNeeded.join(', ')}`
      : null;

  // 4. Impact Data
  const impactSummary =
    tech.impact ||
    (incident.severity === 'CRITICAL' || incident.severity === 'HIGH'
      ? 'Workload is unavailable or degraded, failing readiness checks.'
      : 'Localized component degradation without total cluster outage.');

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl mx-auto font-sans">
      {/* ========================================================================= */}
      {/* 1. INCIDENT HEADER */}
      {/* ========================================================================= */}
      <div className="p-5 rounded-xl bg-linear-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 border border-zinc-800/80 shadow-xs space-y-4">
        {/* Top Action Bar */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer shrink-0 mt-0.5 sm:mt-0"
              title="Back to Incidents List"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xl font-bold font-mono text-sky-400">{incident.id}</span>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {priority}
                </span>
                <SeverityBadge severity={incident.severity} size="sm" />
                <StatusBadge status={incident.status} size="sm" />
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800/80">
                  {incident.occurrenceCount}x Occurrence{incident.occurrenceCount > 1 ? ` (Recurred ${incident.occurrenceCount - 1}x)` : ''}
                </span>

                {/* Resolution Provenance Badge (if resolved) */}
                {incident.resolvedAt && (
                  incident.resolutionSource === 'AUTOMATIC_VERIFIED' || incident.resolution?.source === 'AUTOMATIC_VERIFIED' ? (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-emerald-400" />
                      VERIFIED BY TELEMETRY
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-zinc-900 text-zinc-300 border border-zinc-700 flex items-center gap-1">
                      <UserCheck className="w-3 h-3 text-sky-400" />
                      MANUALLY CLOSED
                    </span>
                  )
                )}
              </div>
              <h1 className="text-base font-semibold text-zinc-100 mt-1.5 leading-snug">{incident.title}</h1>
              <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-zinc-400 mt-1">
                <span>
                  Cluster: <strong className="text-zinc-200">{incident.clusterName}</strong>
                </span>
                <span>•</span>
                <span>
                  Namespace: <strong className="text-zinc-200">{incident.namespace}</strong>
                </span>
                <span>•</span>
                <span>
                  Target: <strong className="text-sky-300">{incident.resourceKind}/{incident.resourceName}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* Ticket Controls */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs shrink-0">
            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isGeneratingPdf}
              icon={isGeneratingPdf ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              className="bg-sky-600 hover:bg-sky-500 text-white font-semibold shadow-xs"
            >
              {pdfSuccess ? 'Report Downloaded!' : isGeneratingPdf ? 'Generating PDF...' : 'Download PDF Report'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={fetchIncidentData}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
            >
              Refresh
            </Button>

            {canEditIncidents && (
              <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1">
                <span className="text-zinc-500 text-[11px] uppercase">Status:</span>
                <select
                  value={incident.status}
                  disabled={statusUpdateLoading}
                  onChange={(e) => handleStatusChange(e.target.value as IncidentStatus)}
                  className="bg-transparent text-zinc-200 focus:outline-none font-semibold cursor-pointer text-xs"
                >
                  <option value="OPEN" className="bg-zinc-900 text-zinc-200">OPEN</option>
                  <option value="ACKNOWLEDGED" className="bg-zinc-900 text-zinc-200">ACKNOWLEDGED</option>
                  <option value="IN_PROGRESS" className="bg-zinc-900 text-zinc-200">IN_PROGRESS</option>
                  <option value="RESOLVED" className="bg-zinc-900 text-zinc-200">RESOLVED</option>
                  <option value="CLOSED" className="bg-zinc-900 text-zinc-200">CLOSED</option>
                </select>
              </div>
            )}

            {canEditIncidents && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDelete}
                disabled={isDeleting}
                icon={<Trash2 className="w-3.5 h-3.5 text-rose-400" />}
                className="hover:border-rose-800 text-rose-300"
              >
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Compact Incident Lifecycle Bar */}
        <div className="pt-3 border-t border-zinc-800/80">
          <div className="flex items-center justify-between text-[11px] font-mono overflow-x-auto pb-1 gap-2">
            {/* Stage 1: Detected */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="w-5 h-5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-700 flex items-center justify-center font-bold text-[10px]">
                ✓
              </span>
              <div>
                <span className="text-emerald-300 font-bold block">1. Detected</span>
                <span className="text-zinc-500 text-[10px]">{formatTimeAgo(incident.firstSeenAt)}</span>
              </div>
            </div>

            <div className="w-6 h-0.5 bg-zinc-800 shrink-0" />

            {/* Stage 2: Investigating */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                  isRemediationActive || isVerifying || isResolved
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                    : isInvestigating
                    ? 'bg-sky-950 text-sky-400 border border-sky-700 animate-pulse'
                    : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                }`}
              >
                {isRemediationActive || isVerifying || isResolved ? '✓' : '2'}
              </span>
              <div>
                <span
                  className={`font-bold block ${
                    isRemediationActive || isVerifying || isResolved
                      ? 'text-emerald-300'
                      : isInvestigating
                      ? 'text-sky-300'
                      : 'text-zinc-500'
                  }`}
                >
                  2. Investigating
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {isInvestigating ? 'Active Triage' : 'Root Cause Analysed'}
                </span>
              </div>
            </div>

            <div className="w-6 h-0.5 bg-zinc-800 shrink-0" />

            {/* Stage 3: Remediation */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                  isVerifying || isResolved
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                    : isRemediationActive
                    ? 'bg-amber-950 text-amber-400 border border-amber-700 animate-pulse'
                    : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                }`}
              >
                {isVerifying || isResolved ? '✓' : '3'}
              </span>
              <div>
                <span
                  className={`font-bold block ${
                    isVerifying || isResolved
                      ? 'text-emerald-300'
                      : isRemediationActive
                      ? 'text-amber-300'
                      : 'text-zinc-500'
                  }`}
                >
                  3. Remediation
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {remediation?.status === 'DISPATCHED'
                    ? 'Dispatched to Agent'
                    : remediation?.status === 'PROPOSED'
                    ? 'Approval Required'
                    : isVerifying || isResolved
                    ? 'Action Executed'
                    : 'Pending Action'}
                </span>
              </div>
            </div>

            <div className="w-6 h-0.5 bg-zinc-800 shrink-0" />

            {/* Stage 4: Verifying */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                  isResolved
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                    : isVerifying
                    ? 'bg-purple-950 text-purple-400 border border-purple-700 animate-pulse'
                    : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                }`}
              >
                {isResolved ? '✓' : '4'}
              </span>
              <div>
                <span
                  className={`font-bold block ${
                    isResolved ? 'text-emerald-300' : isVerifying ? 'text-purple-300' : 'text-zinc-500'
                  }`}
                >
                  4. Verifying
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {isVerifying ? 'Live Telemetry Check' : isResolved ? 'Verified' : 'Awaiting Check'}
                </span>
              </div>
            </div>

            <div className="w-6 h-0.5 bg-zinc-800 shrink-0" />

            {/* Stage 5: Resolved */}
            <div className="flex items-center gap-2 shrink-0">
              <span
                className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${
                  isResolved
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-700'
                    : 'bg-zinc-900 text-zinc-600 border border-zinc-800'
                }`}
              >
                {isResolved ? '✓' : '5'}
              </span>
              <div>
                <span className={`font-bold block ${isResolved ? 'text-emerald-300' : 'text-zinc-500'}`}>
                  5. Resolved
                </span>
                <span className="text-zinc-500 text-[10px]">
                  {incident.resolvedAt ? formatTimeAgo(incident.resolvedAt) : 'Open Ticket'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Status Action Error Banner */}
      {statusError && (
        <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-200 flex items-center justify-between gap-2 shadow-xs font-mono">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{statusError}</span>
          </div>
          <button
            onClick={() => setStatusError(null)}
            className="text-rose-400 hover:text-rose-200 text-xs font-bold px-2 py-0.5 rounded hover:bg-rose-900/50 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TWO-COLUMN SRE CONSOLE GRID */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Column (8 cols): What Happened, Root Cause, Impact, Remediation, AI Analysis, Evidence, Infrastructure, Telemetry */}
        <div className="lg:col-span-8 space-y-6">
          {/* ========================================================================= */}
          {/* 2. WHAT HAPPENED */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-3.5 shadow-xs">
            <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2.5">
              <AlertOctagon className="w-4 h-4 text-sky-400" />
              <h2 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider">
                2. What Happened
              </h2>
            </div>

            {/* Single strong human-readable statement */}
            <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-zinc-800">
              <p className="text-sm font-semibold text-zinc-100 leading-relaxed font-sans">
                {getWhatHappenedStatement()}
              </p>
            </div>

            {/* Concise supporting pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 uppercase block">Current State</span>
                <span className="text-rose-400 font-bold truncate block">
                  {tech.reason || tech.observedState || incident.incidentType}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 uppercase block">Target Workload</span>
                <span className="text-sky-300 font-semibold truncate block">
                  {incident.resourceKind}/{incident.resourceName}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 uppercase block">Namespace</span>
                <span className="text-zinc-200 truncate block">{incident.namespace}</span>
              </div>

              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80">
                <span className="text-[10px] text-zinc-500 uppercase block">Cluster</span>
                <span className="text-zinc-200 truncate block">{incident.clusterName}</span>
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. ROOT CAUSE */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-3.5 shadow-xs">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2.5">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider">
                  3. Root Cause Analysis
                </h2>
              </div>
              <span className="text-[10px] font-mono text-zinc-400">
                Category: <strong className="text-zinc-200">{tech.rootCauseCategory || 'CONTAINER_RUNTIME'}</strong>
              </span>
            </div>

            {/* Explicit Distinction: CONFIRMED vs INFERENCE vs UNKNOWN */}
            <div className="space-y-3 text-xs">
              {/* CONFIRMED */}
              {confirmedFact && (
                <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-emerald-900/50 space-y-1">
                  <div className="flex items-center gap-2">
                    <ProvenanceBadge type="CONFIRMED" label="CONFIRMED" />
                    <span className="text-[11px] font-mono text-zinc-400">Authoritative Observation</span>
                  </div>
                  <p className="text-xs text-zinc-200 leading-relaxed font-sans mt-1">
                    {confirmedFact}
                  </p>
                </div>
              )}

              {/* INFERENCE */}
              {inferenceHypothesis && (
                <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-sky-900/50 space-y-1">
                  <div className="flex items-center gap-2">
                    <ProvenanceBadge type="INFERENCE" label="INFERENCE" />
                    <span className="text-[11px] font-mono text-zinc-400">Plausible Failure Explanation</span>
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed font-sans mt-1">
                    {inferenceHypothesis}
                  </p>
                </div>
              )}

              {/* UNKNOWN / NEEDS INVESTIGATION */}
              {unknownInvestigationNote && (
                <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-amber-900/50 space-y-1">
                  <div className="flex items-center gap-2">
                    <ProvenanceBadge type="UNKNOWN" label="UNKNOWN / NEEDS INVESTIGATION" />
                  </div>
                  <p className="text-xs text-amber-200/90 leading-relaxed font-sans mt-1">
                    {unknownInvestigationNote}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 4. IMPACT */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-xl bg-zinc-900/60 border border-zinc-800/80 space-y-3.5 shadow-xs">
            <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-2.5">
              <Activity className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider">
                4. Operational Impact
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Affected Resource</span>
                <span className="text-sky-400 font-bold block mt-0.5 truncate">
                  {incident.resourceKind}/{incident.resourceName}
                </span>
                <span className="text-[11px] text-zinc-400 block mt-0.5">Namespace: {incident.namespace}</span>
              </div>

              <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800">
                <span className="text-[10px] text-zinc-500 uppercase block">Degraded Availability</span>
                <span className="text-rose-400 font-bold block mt-0.5">
                  {incident.severity === 'CRITICAL' ? 'Service Unavailable' : 'Degraded Pod Condition'}
                </span>
                <span className="text-[11px] text-zinc-400 block mt-0.5">
                  {tech.nodeName ? `Scheduled on node: ${tech.nodeName}` : 'Node pending'}
                </span>
              </div>

              {typeof tech.availableReplicas === 'number' ? (
                <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase block">Replica Availability</span>
                  <span className="text-amber-400 font-bold block mt-0.5">
                    {tech.availableReplicas} / {tech.desiredReplicas ?? 1} Available Replicas
                  </span>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">Under desired scale</span>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800">
                  <span className="text-[10px] text-zinc-500 uppercase block">Target Container</span>
                  <span className="text-zinc-200 font-bold block mt-0.5 truncate">
                    {tech.containerName || 'Primary container'}
                  </span>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">Readiness: False</span>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-zinc-950/80 border border-zinc-800/80 text-xs">
              <span className="text-[10px] font-mono text-zinc-500 uppercase font-bold block mb-1">
                Impact Summary:
              </span>
              <p className="text-zinc-200 leading-relaxed font-sans">{impactSummary}</p>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 5. REMEDIATION / NEXT ACTION */}
          {/* ========================================================================= */}
          <IncidentRemediationCard
            incident={incident}
            remediation={remediation}
            aiAnalysis={aiAnalysis}
            canEdit={canEditIncidents}
            onRemediationUpdated={(rem) => setRemediation(rem)}
            onRefresh={fetchIncidentData}
          />

          {/* ========================================================================= */}
          {/* 6. EVIDENCE & OBSERVABILITY SIGNALS */}
          {/* ========================================================================= */}
          <IncidentEvidenceSection
            technicalDetails={tech}
            aiAnalysis={aiAnalysis}
            incidentType={incident.incidentType}
          />

          {/* ========================================================================= */}
          {/* 7. AI ANALYSIS / DEEPER REASONING */}
          {/* ========================================================================= */}
          <SkyOpsAIAnalysisCard
            incidentId={incident.id}
            initialAnalysis={aiAnalysis}
            initialRemediation={remediation}
            canEdit={canEditIncidents}
            onRemediationApplied={fetchIncidentData}
            onAnalysisUpdated={(analysis, rem) => {
              setAiAnalysis(analysis);
              if (rem) setRemediation(rem);
            }}
          />

          {/* ========================================================================= */}
          {/* 8. KUBERNETES TARGET INFRASTRUCTURE */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2 border-b border-zinc-800/80 pb-3">
              <Server className="w-4 h-4 text-sky-400" />
              8. Kubernetes Target Infrastructure
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs font-mono">
              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Cluster Name</span>
                <span
                  onClick={() => onSelectCluster && onSelectCluster(incident.clusterId)}
                  className="text-sky-400 font-semibold truncate block hover:underline cursor-pointer"
                >
                  {incident.clusterName}
                </span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Cluster ID</span>
                <span className="text-zinc-300 truncate block text-[11px]">{incident.clusterId}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Namespace</span>
                <span className="text-zinc-200 font-semibold truncate block">{incident.namespace}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Resource Target</span>
                <span className="text-zinc-200 font-semibold truncate block">
                  {incident.resourceKind}/{incident.resourceName}
                </span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Pod Name</span>
                <span className="text-zinc-200 truncate block">{tech.podName || incident.resourceName}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Target Container</span>
                <span className="text-zinc-200 truncate block">{tech.containerName || 'Not available'}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Observed Node</span>
                <span className="text-zinc-200 truncate block">{tech.nodeName || 'Not available'}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70 sm:col-span-2">
                <span className="text-zinc-500 text-[10px] block uppercase">Container Image</span>
                <span className="text-zinc-300 truncate block font-mono text-[11px]">
                  {tech.image || 'Not available'}
                </span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Resource UID</span>
                <span className="text-zinc-400 truncate block font-mono text-[11px]">
                  {tech.resourceUid ? `${tech.resourceUid.slice(0, 16)}...` : 'Not available'}
                </span>
              </div>
            </div>

            {/* Deterministic Fingerprint Strip */}
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70 flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-500 text-[10px] uppercase">Deterministic Incident Fingerprint:</span>
              <div className="flex items-center gap-2">
                <span className="text-zinc-400 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-[11px]">
                  {incident.fingerprint}
                </span>
                <CopyButton text={incident.fingerprint} />
              </div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 9. TELEMETRY / OBSERVED STATE */}
          {/* ========================================================================= */}
          <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2 border-b border-zinc-800/80 pb-3">
              <Layers className="w-4 h-4 text-sky-400" />
              9. Diagnostic Telemetry & Observed State
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">State / Reason</span>
                <span className="text-rose-400 font-bold truncate block">{tech.reason || incident.incidentType}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Observed Status</span>
                <span className="text-zinc-200 font-semibold truncate block">{tech.observedState || incident.status}</span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Exit Code</span>
                <span className={`font-bold block ${tech.exitCode !== undefined && tech.exitCode !== 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                  {tech.exitCode !== undefined ? tech.exitCode : 'None (Waiting)'}
                </span>
              </div>

              <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/70">
                <span className="text-zinc-500 text-[10px] block uppercase">Restart Count</span>
                <span className={`font-bold block ${tech.restartCount && tech.restartCount > 0 ? 'text-amber-400' : 'text-zinc-300'}`}>
                  {tech.restartCount !== undefined ? `${tech.restartCount} restarts` : '0 restarts'}
                </span>
              </div>
            </div>

            {/* Diagnostic Message Callout */}
            {tech.message && (
              <div className="p-4 bg-rose-950/20 border border-rose-900/50 rounded-lg space-y-1 font-mono text-xs">
                <span className="text-rose-300 font-bold block text-[10px] uppercase">
                  Diagnostic Telemetry String:
                </span>
                <p className="text-rose-200/90 leading-relaxed font-sans">{tech.message}</p>
              </div>
            )}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 10. RIGHT SIDEBAR: Assigned Engineer, Audit Timeline, Investigation Notes */}
        {/* ========================================================================= */}
        <div className="lg:col-span-4 space-y-6">
          {/* Assigned Engineer */}
          <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-3 font-mono text-xs shadow-xs">
            <span className="text-zinc-400 font-bold block uppercase text-[10px] tracking-wider">
              Assigned SRE Engineer
            </span>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-zinc-200 font-semibold">{incident.assignee?.name || 'Unassigned'}</div>
                  <div className="text-[11px] text-zinc-500">{incident.assignee?.email || 'No owner assigned'}</div>
                </div>
              </div>

              {canEditIncidents && (
                <select
                  value={incident.assignee?.userId || ''}
                  onChange={(e) => handleAssigneeChange(e.target.value)}
                  className="px-2.5 py-1 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500 text-xs font-semibold cursor-pointer"
                >
                  <option value="">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Chronological Incident Audit Timeline */}
          <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2 border-b border-zinc-800/80 pb-3">
              <Activity className="w-4 h-4 text-emerald-400" />
              Incident Audit Timeline ({timeline.length})
            </h3>

            <div className="relative pl-6 space-y-5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
              {timeline.map((evt) => {
                let dotColor = 'bg-zinc-600 border-zinc-900';
                if (evt.type === 'DETECTION') dotColor = 'bg-rose-500 border-zinc-900';
                else if (evt.type === 'RECOVERY') dotColor = 'bg-emerald-500 border-zinc-900';
                else if (evt.type === 'OCCURRENCE') dotColor = 'bg-amber-500 border-zinc-900';
                else if (evt.type === 'STATE_CHANGE') dotColor = 'bg-sky-500 border-zinc-900';
                else if (evt.type === 'NOTE_ADDED') dotColor = 'bg-purple-500 border-zinc-900';
                else if (evt.type === 'REMEDIATION_APPROVED') dotColor = 'bg-emerald-400 border-zinc-900';
                else if (evt.type === 'REMEDIATION_EXECUTED') dotColor = 'bg-blue-400 border-zinc-900';

                return (
                  <div key={evt.id} className="relative font-mono text-xs">
                    <span className={`absolute -left-6 top-1 w-2.5 h-2.5 rounded-full border-2 ${dotColor}`} />
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-bold text-zinc-300">{evt.type}</span>
                      <span>{formatTimeAgo(evt.timestamp)}</span>
                    </div>
                    <div className="text-zinc-200 text-xs mt-1 leading-snug font-sans">{evt.description}</div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">by {evt.actor.name}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Investigation Notes */}
          <div className="p-5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4 shadow-xs">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2 border-b border-zinc-800/80 pb-3">
              <MessageSquare className="w-4 h-4 text-sky-400" />
              Investigation Notes ({notes.length})
            </h3>

            {notes.length === 0 ? (
              <div className="p-5 text-center text-xs font-mono text-zinc-500 border border-dashed border-zinc-800 rounded-lg">
                No investigation notes recorded yet. Add operational observations or logs below.
              </div>
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <div key={note.id} className="p-3.5 bg-zinc-950 border border-zinc-800/80 rounded-lg space-y-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                      <span className="font-semibold text-zinc-200">{note.authorName}</span>
                      <span className="text-zinc-500">{formatTimeAgo(note.createdAt)}</span>
                    </div>
                    <p className="text-zinc-300 font-sans text-xs leading-relaxed whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Note Authoring Form */}
            {canEditIncidents && (
              <form onSubmit={handleAddNote} className="space-y-2 pt-2 border-t border-zinc-800/60">
                <label className="block text-xs font-mono text-zinc-400">Add Investigation Finding:</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Record diagnostic observations, pod logs, remediation notes..."
                  value={newNoteContent}
                  onChange={(e) => setNewNoteContent(e.target.value)}
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 text-xs font-mono placeholder-zinc-600 focus:outline-none focus:border-sky-500"
                />
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    type="submit"
                    disabled={isSubmittingNote || !newNoteContent.trim()}
                    icon={<Send className="w-3.5 h-3.5" />}
                  >
                    Add Note
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
