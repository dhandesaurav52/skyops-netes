import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  Lock,
  Play,
  X,
  RefreshCw,
  Edit2,
  ArrowRight,
  Terminal,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Server,
  FileCode,
  Activity
} from 'lucide-react';
import { Incident, StructuredRemediation, SkyOpsAIAnalysis } from '../../types';
import { api } from '../../api/client';
import { Button } from '../common/UI';

interface IncidentRemediationCardProps {
  incident: Incident;
  remediation?: StructuredRemediation | null;
  aiAnalysis?: SkyOpsAIAnalysis | null;
  canEdit?: boolean;
  onRemediationUpdated?: (remediation: StructuredRemediation) => void;
  onRefresh?: () => void;
}

export const IncidentRemediationCard: React.FC<IncidentRemediationCardProps> = ({
  incident,
  remediation: initialRemediation,
  aiAnalysis,
  canEdit = true,
  onRemediationUpdated,
  onRefresh
}) => {
  const [remediation, setRemediation] = useState<StructuredRemediation | null>(
    initialRemediation || aiAnalysis?.structuredRemediation || null
  );
  const [customImage, setCustomImage] = useState(
    initialRemediation?.parameters?.proposedImage || aiAnalysis?.structuredRemediation?.parameters?.proposedImage || ''
  );
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  // Synchronize incoming props
  React.useEffect(() => {
    const rem = initialRemediation || aiAnalysis?.structuredRemediation || null;
    setRemediation(rem);
    if (rem?.parameters?.proposedImage && rem.parameters.proposedImage !== 'unknown') {
      setCustomImage(rem.parameters.proposedImage);
    }
  }, [initialRemediation, aiAnalysis?.structuredRemediation]);

  // Determine if a validated executable remediation is present
  const isExecutableRemediation = Boolean(
    remediation &&
    remediation.isExecutable !== false &&
    remediation.parameters?.proposedImage &&
    remediation.parameters.proposedImage !== 'unknown' &&
    remediation.actionType !== 'MANUAL_INSPECTION' &&
    remediation.actionType !== 'UNSPECIFIED'
  );

  const handleApprove = async () => {
    if (!remediation) return;
    try {
      setActionLoading(true);
      setActionMessage(null);
      const proposedImage = customImage.trim() || remediation.parameters.proposedImage;
      const res = await api.approveRemediation(incident.id, { proposedImage });
      setRemediation(res.remediation);
      setActionMessage({
        type: 'success',
        text: `Remediation approved. Action dispatched to SkyOps Agent on cluster "${res.remediation.clusterName || incident.clusterName}".`
      });
      setIsEditingImage(false);
      if (onRemediationUpdated) {
        onRemediationUpdated(res.remediation);
      }
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      console.error('Failed to approve remediation:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Failed to approve remediation'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!remediation) return;
    try {
      setActionLoading(true);
      setActionMessage(null);
      const res = await api.rejectRemediation(incident.id, 'Declined by operator');
      setRemediation(res.remediation);
      setActionMessage({
        type: 'success',
        text: 'Remediation proposal declined. Workload configuration remains unchanged.'
      });
      if (onRemediationUpdated) {
        onRemediationUpdated(res.remediation);
      }
      if (onRefresh) {
        onRefresh();
      }
    } catch (err: any) {
      console.error('Failed to decline remediation:', err);
      setActionMessage({
        type: 'error',
        text: err?.message || 'Failed to decline remediation'
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  // Diagnostic kubectl commands for manual investigation
  const describeCmd = `kubectl describe ${incident.resourceKind.toLowerCase()} ${incident.resourceName} -n ${incident.namespace}`;
  const logsCmd = `kubectl logs ${incident.resourceName} -n ${incident.namespace}`;

  return (
    <div className="p-5 rounded-xl bg-linear-to-b from-zinc-900/90 via-zinc-900/60 to-zinc-950 border border-sky-900/50 shadow-xs space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div className="flex items-center gap-2.5">
          <div className={`p-2 rounded-lg border ${
            isExecutableRemediation
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
          }`}>
            {isExecutableRemediation ? (
              <ShieldCheck className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold text-zinc-100 font-mono uppercase tracking-wider">
                5. Remediation / Next Action
              </h3>
              {isExecutableRemediation ? (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 flex items-center gap-1">
                  <Play className="w-2.5 h-2.5" />
                  AUTOMATED REMEDIATION AVAILABLE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  MANUAL INVESTIGATION REQUIRED
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              Can SkyOps safely execute a fix?{' '}
              <strong className={isExecutableRemediation ? 'text-emerald-300' : 'text-amber-300'}>
                {isExecutableRemediation
                  ? 'Yes — validated deterministic patch available'
                  : 'No — manual operator action required'}
              </strong>
            </p>
          </div>
        </div>

        {/* Action Status Pill */}
        {remediation && isExecutableRemediation && (
          <div>
            {remediation.status === 'PROPOSED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-amber-950/80 text-amber-300 border border-amber-800 flex items-center gap-1.5">
                <Lock className="w-3 h-3" />
                AWAITING OPERATOR APPROVAL
              </span>
            )}
            {remediation.status === 'DISPATCHED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-blue-950/80 text-blue-300 border border-blue-800 flex items-center gap-1.5 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" />
                DISPATCHED TO IN-CLUSTER AGENT
              </span>
            )}
            {remediation.status === 'EXECUTED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-indigo-950/80 text-indigo-300 border border-indigo-800 flex items-center gap-1.5">
                <Play className="w-3 h-3" />
                PATCH APPLIED (VERIFYING)
              </span>
            )}
            {remediation.status === 'VERIFYING' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-purple-950/80 text-purple-300 border border-purple-800 flex items-center gap-1.5 animate-pulse">
                <RefreshCw className="w-3 h-3 animate-spin" />
                OBSERVING LIVE TELEMETRY
              </span>
            )}
            {remediation.status === 'VERIFIED_RESOLVED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-700 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                VERIFIED RESOLVED BY TELEMETRY
              </span>
            )}
            {remediation.status === 'REJECTED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-zinc-900 text-zinc-400 border border-zinc-700 flex items-center gap-1.5">
                <X className="w-3 h-3" />
                DECLINED BY OPERATOR
              </span>
            )}
            {remediation.status === 'FAILED' && (
              <span className="px-2.5 py-1 rounded text-xs font-mono font-bold bg-rose-950/80 text-rose-300 border border-rose-800 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3" />
                EXECUTION FAILED
              </span>
            )}
          </div>
        )}
      </div>

      {/* Action Feedback Banner */}
      {actionMessage && (
        <div
          className={`p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
            actionMessage.type === 'success'
              ? 'bg-emerald-950/40 border-emerald-800/70 text-emerald-200'
              : 'bg-rose-950/40 border-rose-800/70 text-rose-200'
          }`}
        >
          {actionMessage.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          )}
          <p className="text-xs leading-relaxed">{actionMessage.text}</p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* CASE A: VALID EXECUTABLE REMEDIATION EXISTS */}
      {/* ========================================================================= */}
      {isExecutableRemediation && remediation && (
        <div className="space-y-4">
          {/* Target & Change Preview Diff */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            {/* Target Workload */}
            <div className="p-3 bg-zinc-950/90 rounded-lg border border-zinc-800 space-y-1">
              <span className="text-[10px] font-mono text-zinc-500 uppercase font-bold block">
                Target Workload
              </span>
              <div className="font-mono text-zinc-200">
                <span className="text-sky-400 font-bold">{remediation.targetResource.kind}</span>{' '}
                <span className="text-zinc-400">{remediation.targetResource.namespace || 'default'}/</span>
                <span className="text-zinc-100 font-semibold">{remediation.targetResource.name}</span>
              </div>
              <div className="text-[11px] text-zinc-400 font-mono mt-1">
                Container: <code className="text-zinc-200">{remediation.parameters.containerName}</code>
              </div>
              {remediation.changePreview?.field && (
                <div className="text-[10px] text-zinc-500 font-mono truncate" title={remediation.changePreview.field}>
                  Field: {remediation.changePreview.field}
                </div>
              )}
            </div>

            {/* Strategic Container Image Diff */}
            <div className="md:col-span-2 p-3 bg-zinc-950/90 rounded-lg border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold">
                  Exact Container Image Strategic Patch
                </span>
                {remediation.status === 'PROPOSED' && canEdit && (
                  <button
                    type="button"
                    onClick={() => setIsEditingImage(!isEditingImage)}
                    className="text-[11px] font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                  >
                    <Edit2 className="w-3 h-3" />
                    {isEditingImage ? 'Cancel edit' : 'Customize image tag'}
                  </button>
                )}
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs font-mono">
                {/* Current Failing Image */}
                <div className="p-2 rounded bg-rose-950/30 border border-rose-900/60 text-rose-300 flex-1 truncate">
                  <span className="text-[9px] uppercase tracking-wider text-rose-400 block mb-0.5">Current (Failing)</span>
                  <span className="line-through">{remediation.parameters.currentImage || 'unknown'}</span>
                </div>

                <ArrowRight className="w-4 h-4 text-sky-400 shrink-0 hidden sm:block" />

                {/* Proposed Target Image */}
                <div className="p-2 rounded bg-emerald-950/30 border border-emerald-900/60 text-emerald-300 flex-1 truncate">
                  <span className="text-[9px] uppercase tracking-wider text-emerald-400 block mb-0.5">Proposed Target</span>
                  {!isEditingImage ? (
                    <span className="font-bold text-emerald-200">{customImage || remediation.parameters.proposedImage}</span>
                  ) : (
                    <input
                      type="text"
                      value={customImage}
                      onChange={(e) => setCustomImage(e.target.value)}
                      placeholder="e.g. registry.company.com/app:v1.2.4"
                      className="w-full bg-zinc-900 border border-emerald-600 rounded px-2 py-0.5 text-xs text-emerald-200 font-mono focus:outline-hidden"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Closed-Loop Pipeline Progress Tracker */}
          <div className="p-3 bg-zinc-950/90 rounded-lg border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-mono text-zinc-400 uppercase font-bold">
                Closed-Loop Execution & Verification Pipeline
              </span>
              <span className="text-[10px] font-mono text-zinc-500">
                Backend Authoritative State: <strong className="text-zinc-300">{remediation.status}</strong>
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs font-mono">
              {/* Step 1: Proposed */}
              <div className="p-2 rounded bg-zinc-900 border border-zinc-800 flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">1. Proposed</span>
                  <span className="text-zinc-400 text-[9px] block truncate">Patch verified</span>
                </div>
              </div>

              {/* Step 2: Awaiting Approval / Approved */}
              <div
                className={`p-2 rounded border flex items-center gap-1.5 ${
                  remediation.status !== 'PROPOSED' && remediation.status !== 'REJECTED'
                    ? 'bg-zinc-900 border-zinc-800 text-emerald-400'
                    : 'bg-zinc-900/40 border-zinc-800 text-amber-400'
                }`}
              >
                {remediation.approval ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                )}
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">
                    {remediation.approval ? '2. Approved' : '2. Awaiting Gate'}
                  </span>
                  <span className="text-zinc-400 text-[9px] block truncate">
                    {remediation.approval?.approvedBy?.name ? remediation.approval.approvedBy.name : 'Human sign-off'}
                  </span>
                </div>
              </div>

              {/* Step 3: Agent Executing */}
              <div
                className={`p-2 rounded border flex items-center gap-1.5 ${
                  remediation.status === 'EXECUTED' ||
                  remediation.status === 'VERIFYING' ||
                  remediation.status === 'VERIFIED_RESOLVED'
                    ? 'bg-zinc-900 border-zinc-800 text-emerald-400'
                    : remediation.status === 'DISPATCHED'
                    ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-500'
                }`}
              >
                {remediation.execution?.status === 'SUCCESS' ||
                remediation.status === 'EXECUTED' ||
                remediation.status === 'VERIFYING' ||
                remediation.status === 'VERIFIED_RESOLVED' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : remediation.status === 'DISPATCHED' ? (
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-blue-400" />
                ) : (
                  <Terminal className="w-3.5 h-3.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">3. Executing</span>
                  <span className="text-zinc-400 text-[9px] block truncate">
                    {remediation.status === 'DISPATCHED' ? 'Agent in progress' : 'In-cluster agent'}
                  </span>
                </div>
              </div>

              {/* Step 4: Executed */}
              <div
                className={`p-2 rounded border flex items-center gap-1.5 ${
                  remediation.execution?.status === 'SUCCESS' ||
                  remediation.status === 'EXECUTED' ||
                  remediation.status === 'VERIFYING' ||
                  remediation.status === 'VERIFIED_RESOLVED'
                    ? 'bg-zinc-900 border-zinc-800 text-emerald-400'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-500'
                }`}
              >
                {remediation.execution?.status === 'SUCCESS' ||
                remediation.status === 'EXECUTED' ||
                remediation.status === 'VERIFYING' ||
                remediation.status === 'VERIFIED_RESOLVED' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <Terminal className="w-3.5 h-3.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">4. Executed</span>
                  <span className="text-zinc-400 text-[9px] block truncate">Patch applied</span>
                </div>
              </div>

              {/* Step 5: Verifying */}
              <div
                className={`p-2 rounded border flex items-center gap-1.5 ${
                  remediation.status === 'VERIFIED_RESOLVED'
                    ? 'bg-zinc-900 border-zinc-800 text-emerald-400'
                    : remediation.status === 'VERIFYING'
                    ? 'bg-purple-950/40 border-purple-800 text-purple-300'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-500'
                }`}
              >
                {remediation.status === 'VERIFIED_RESOLVED' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : remediation.status === 'VERIFYING' ? (
                  <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin text-purple-400" />
                ) : (
                  <Activity className="w-3.5 h-3.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">5. Verifying</span>
                  <span className="text-zinc-400 text-[9px] block truncate">
                    {remediation.status === 'VERIFYING' ? 'Observing live...' : 'Awaiting scrape'}
                  </span>
                </div>
              </div>

              {/* Step 6: Verified */}
              <div
                className={`p-2 rounded border flex items-center gap-1.5 ${
                  remediation.status === 'VERIFIED_RESOLVED'
                    ? 'bg-emerald-950/40 border-emerald-800 text-emerald-400'
                    : 'bg-zinc-900/40 border-zinc-800 text-zinc-500'
                }`}
              >
                {remediation.status === 'VERIFIED_RESOLVED' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-400" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-bold block text-[10px] truncate">6. Verified</span>
                  <span className="text-zinc-400 text-[9px] block truncate">
                    {remediation.status === 'VERIFIED_RESOLVED' ? 'Zero errors' : 'Pending proof'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Explicit Execution vs Telemetry Verification State Breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Execution State */}
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-sky-400 font-bold flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5" />
                  Agent Execution State
                </span>
                <span className="text-zinc-400 text-[10px]">
                  {remediation.execution?.executedAt
                    ? new Date(remediation.execution.executedAt).toLocaleTimeString()
                    : remediation.status === 'DISPATCHED'
                    ? 'Dispatching'
                    : 'Pending authorization'}
                </span>
              </div>
              <p className="text-zinc-200 text-xs">
                {remediation.execution?.message ||
                  (remediation.status === 'DISPATCHED'
                    ? 'Dispatched to in-cluster agent. Waiting for agent execution acknowledgment.'
                    : remediation.status === 'PROPOSED'
                    ? 'Waiting for operator approval before dispatching patch.'
                    : 'Strategic pod image mutation queued.')}
              </p>
            </div>

            {/* Telemetry Verification State */}
            <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Telemetry Verification State
                </span>
                <span className="text-zinc-400 text-[10px]">
                  {remediation.verification?.verifiedAt
                    ? `Verified ${new Date(remediation.verification.verifiedAt).toLocaleTimeString()}`
                    : remediation.status === 'VERIFYING'
                    ? 'Live observing'
                    : 'Awaiting execution'}
                </span>
              </div>
              <p className="text-zinc-200 text-xs">
                {remediation.status === 'VERIFIED_RESOLVED'
                  ? 'Fresh telemetry confirms the expected healthy state: error events ceased and pod ready.'
                  : remediation.status === 'VERIFYING'
                  ? 'Waiting for fresh Kubernetes telemetry scrape to confirm error events have ceased.'
                  : remediation.verification?.observedState ||
                    'Verification begins automatically after agent reports successful patch application.'}
              </p>
              {remediation.verificationCriteria && (
                <div className="text-[10px] text-zinc-400 pt-1 border-t border-zinc-800/80 flex items-center gap-2">
                  <span className="text-zinc-500">Criteria:</span>
                  <span>Target status: <code className="text-zinc-300">{remediation.verificationCriteria.expectedStatus || 'Running'}</code></span>
                  <span>Observation: <code className="text-zinc-300">{remediation.verificationCriteria.observationPeriodSeconds || 30}s</code></span>
                </div>
              )}
            </div>
          </div>

          {/* Action Approval Controls (Only when PROPOSED and canEdit) */}
          {remediation.status === 'PROPOSED' && canEdit && (
            <div className="p-3.5 rounded-lg bg-zinc-950/90 border border-sky-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-sky-400" />
                  Engineer Authorization Required
                </span>
                <p className="text-[11px] text-zinc-400">
                  Approving will dispatch this typed patch command to the connected SkyOps Kubernetes Agent.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDecline}
                  disabled={actionLoading}
                  icon={<X className="w-3.5 h-3.5 text-zinc-400" />}
                  className="text-xs text-zinc-300 hover:text-rose-300 hover:border-rose-800"
                >
                  Decline
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApprove}
                  disabled={actionLoading}
                  icon={<Play className="w-3.5 h-3.5" />}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm"
                >
                  {actionLoading ? 'Dispatching...' : 'Approve & Execute Fix'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* CASE B: NO EXECUTABLE REMEDIATION EXISTS */}
      {/* ========================================================================= */}
      {!isExecutableRemediation && (
        <div className="p-4 rounded-xl bg-amber-950/20 border border-amber-800/60 space-y-3.5">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-amber-300 uppercase tracking-wide">
                Automated Execution Restricted
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed font-sans">
              {remediation?.unexecutableReason ||
                'SkyOps identified the failure but does not have a validated exact change that can be safely executed automatically.'}
            </p>
            <p className="text-[11px] text-zinc-400 font-sans">
              Automated execution is strictly reserved for verified standalone Pod image tags. Controller-managed resources (Deployments, StatefulSets, DaemonSets) require updating source manifests in Git or CI/CD to prevent state reconciliation drift.
            </p>
          </div>

          {/* Recommended Operator Next Step */}
          <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800 space-y-1.5">
            <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Recommended Operator Next Step:
            </span>
            <p className="text-xs text-zinc-200 leading-relaxed font-sans">
              {incident.technicalDetails.recommendedAction ||
                incident.technicalDetails.recommendation ||
                aiAnalysis?.recommendedFix?.description ||
                'Inspect the container registry to verify that the image and tag exist and credentials are valid, then update the deployment manifest.'}
            </p>
          </div>

          {/* Authoritative Diagnostic Commands */}
          <div className="p-3 rounded-lg bg-zinc-950/90 border border-zinc-800 space-y-2 font-mono text-xs">
            <span className="text-[10px] text-zinc-400 uppercase font-bold block">
              Diagnostic Kubernetes Inspection Commands:
            </span>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-200">
                <code className="text-[11px] truncate">{describeCmd}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(describeCmd, 'describe')}
                  className="text-xs text-zinc-400 hover:text-zinc-200 ml-2 shrink-0 flex items-center gap-1 cursor-pointer"
                  title="Copy command"
                >
                  {copiedCmd === 'describe' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span className="text-[10px]">{copiedCmd === 'describe' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800/80 text-zinc-200">
                <code className="text-[11px] truncate">{logsCmd}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(logsCmd, 'logs')}
                  className="text-xs text-zinc-400 hover:text-zinc-200 ml-2 shrink-0 flex items-center gap-1 cursor-pointer"
                  title="Copy command"
                >
                  {copiedCmd === 'logs' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span className="text-[10px]">{copiedCmd === 'logs' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
