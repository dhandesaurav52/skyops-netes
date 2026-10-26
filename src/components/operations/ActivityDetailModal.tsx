import React from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  RotateCcw,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  Zap
} from 'lucide-react';
import { RemediationAction } from '../../types/index';
import { Modal } from '../common/UI';

interface ActivityDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  operation: RemediationAction | null;
  clusterName?: string;
}

export const ActivityDetailModal: React.FC<ActivityDetailModalProps> = ({
  isOpen,
  onClose,
  operation,
  clusterName
}) => {
  if (!isOpen || !operation) return null;

  const isSuccess =
    operation.status === 'SUCCEEDED' ||
    operation.status === 'VERIFIED' ||
    operation.status === 'VERIFIED_RESOLVED' ||
    operation.status === 'EXECUTED';

  const isFailed = operation.status === 'FAILED';
  const isTimeout = operation.status === 'TIMEOUT' || operation.executionResult?.errorCategory === 'TIMEOUT';
  const isRolledBack = operation.status === 'ROLLED_BACK' || Boolean(operation.rollbackResult);

  const evidenceList =
    operation.verificationResult?.evidence && operation.verificationResult.evidence.length > 0
      ? operation.verificationResult.evidence
      : [
          operation.executionResult?.message ||
            (operation.parameters?.reason as string) ||
            `Operation ${operation.actionType} completed on ${operation.target?.kind} ${operation.target?.name}.`
        ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Operational Audit & Verification Record" size="lg">
      <div className="space-y-5 text-zinc-100 font-sans text-xs">
        {/* Header Summary */}
        <div className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Zap className="w-4 h-4 text-sky-400" />
              <span className="font-bold text-sm text-zinc-100">{operation.actionType}</span>
              {(operation.isSimulated || (operation as any).executionMode === 'SIMULATED') && (
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-950/80 text-amber-300 border border-amber-800/80">
                  Simulated Sandbox
                </span>
              )}
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                  isSuccess
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                    : isFailed
                    ? 'bg-rose-950 text-rose-400 border border-rose-800/60'
                    : isTimeout
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/80 font-bold'
                    : isRolledBack
                    ? 'bg-amber-950 text-amber-400 border border-amber-800/60'
                    : operation.status === 'VERIFYING'
                    ? 'bg-purple-950 text-purple-300 border border-purple-800/60 animate-pulse'
                    : operation.status === 'EXECUTING'
                    ? 'bg-blue-950 text-blue-300 border border-blue-800/60 animate-pulse'
                    : 'bg-zinc-800 text-zinc-300'
                }`}
              >
                {operation.status}
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400 text-[11px] font-mono">
              <span>
                {operation.target?.kind}/{operation.target?.namespace ? `${operation.target.namespace}/` : ''}
                {operation.target?.name}
              </span>
              {operation.target?.uid && (
                <span className="text-zinc-500">(UID: {operation.target.uid.slice(0, 16)}...)</span>
              )}
            </div>
          </div>

          <div className="text-right text-[11px] text-zinc-400">
            <div>
              Cluster: <span className="text-zinc-200 font-medium">{clusterName || operation.clusterName || operation.clusterId}</span>
            </div>
            <div className="text-zinc-500 font-mono mt-0.5">
              {new Date(operation.createdAt).toLocaleString()}
            </div>
          </div>
        </div>

        {/* 2-Column Metadata: Actor & Authorization */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Requesting Actor */}
          <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <User className="w-3.5 h-3.5 text-sky-400" />
              <span>Requesting Actor & Execution</span>
            </div>
            <div className="space-y-1 text-zinc-400">
              <div className="flex justify-between">
                <span>Actor Name:</span>
                <span className="text-zinc-200 font-medium">{operation.requestedBy?.name || 'Authorized Engineer'}</span>
              </div>
              <div className="flex justify-between">
                <span>Actor Type:</span>
                <span className="font-mono text-zinc-300">{operation.requestedBy?.type || 'USER'}</span>
              </div>
              <div className="flex justify-between font-mono text-[10px]">
                <span>Execution ID:</span>
                <span className="text-zinc-400 truncate max-w-[140px]" title={operation.executionId}>
                  {operation.executionId || operation.id}
                </span>
              </div>
              {operation.idempotencyKey && (
                <div className="flex justify-between font-mono text-[10px]">
                  <span>Idempotency Key:</span>
                  <span className="text-zinc-400 truncate max-w-[140px]" title={operation.idempotencyKey}>
                    {operation.idempotencyKey}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Approval & Authorization */}
          <div className="p-3.5 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Authorization & Risk Policy</span>
            </div>
            <div className="space-y-1 text-zinc-400">
              <div className="flex justify-between">
                <span>Approved By:</span>
                <span className="text-zinc-200 font-medium">
                  {operation.approvedBy?.name || operation.approvingUserName || 'Pre-authorized via RBAC'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Assessed Risk Level:</span>
                <span
                  className={`px-1.5 py-0.2 rounded font-semibold text-[10px] ${
                    operation.riskLevel === 'HIGH'
                      ? 'bg-rose-950 text-rose-300 border border-rose-800'
                      : operation.riskLevel === 'MEDIUM'
                      ? 'bg-amber-950 text-amber-300 border border-amber-800'
                      : 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                  }`}
                >
                  {operation.riskLevel || 'LOW'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Approval Timestamp:</span>
                <span className="text-zinc-300 font-mono text-[10px]">
                  {operation.approvedAt ? new Date(operation.approvedAt).toLocaleTimeString() : 'Automated lease'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Rollback Supported:</span>
                <span className="text-zinc-300">{operation.rollbackPlan?.supported ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* State Transition (Previous vs Resulting State) */}
        <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2">
          <h4 className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
            <span>State Transition</span>
          </h4>

          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 text-xs">
            <div>
              <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Previous State</span>
              <span className="font-mono text-zinc-300 block mt-0.5">
                {operation.mutation?.previousReplicas !== undefined
                  ? `${operation.mutation.previousReplicas} replicas`
                  : operation.mutation?.previousRevision !== undefined
                  ? `Revision ${operation.mutation.previousRevision}`
                  : operation.expectedCurrentValue || 'Initial State'}
              </span>
            </div>
            <div>
              <span className="text-zinc-500 block text-[10px] uppercase font-semibold">Resulting State</span>
              <span className="font-mono text-sky-400 font-semibold block mt-0.5">
                {operation.mutation?.targetReplicas !== undefined
                  ? `${operation.mutation.targetReplicas} replicas`
                  : operation.mutation?.targetRevision !== undefined
                  ? `Revision ${operation.mutation.targetRevision}`
                  : operation.mutation?.replacementPodName
                  ? `Replaced: ${operation.mutation.replacementPodName}`
                  : operation.proposedValue || 'Mutated State'}
              </span>
            </div>
          </div>
        </div>

        {/* Authoritative Verification Result & Evidence */}
        <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-zinc-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Verification Result & Evidence</span>
            </h4>
            <span className="text-[11px] text-zinc-400 font-mono">
              Observed State:{' '}
              <strong className="text-emerald-400 font-semibold">
                {operation.verificationResult?.observedState || 'CONVERGED'}
              </strong>
            </span>
          </div>

          <div className="space-y-1.5 bg-zinc-950/80 p-3 rounded-lg border border-zinc-800/80">
            {evidenceList.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2 text-zinc-300 text-xs">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                <span className="font-mono text-[11px] leading-relaxed">{item}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-zinc-500 leading-relaxed italic border-t border-zinc-800/60 pt-2">
            Observation Scope: Verified against Kubernetes cluster state. Application domain health checks or synthetic HTTP probes must be configured independently if end-to-end traffic verification is required.
          </p>
        </div>

        {/* Rollback Details (if rollback was executed) */}
        {operation.rollbackResult && (
          <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/60 space-y-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span>Automated Rollback Record</span>
            </div>
            <div className="space-y-1 text-xs font-mono text-zinc-300">
              {operation.rollbackResult.restoredState && (
                <div>Restored State: <span className="text-amber-300">{operation.rollbackResult.restoredState}</span></div>
              )}
              {operation.rollbackResult.rolledBackAt && (
                <div>Rolled Back At: <span className="text-zinc-400">{new Date(operation.rollbackResult.rolledBackAt).toLocaleTimeString()}</span></div>
              )}
              {operation.rollbackResult.message && (
                <div className="text-zinc-400">{operation.rollbackResult.message}</div>
              )}
            </div>
          </div>
        )}

        {/* Runtime Execution Traces (if present from agent) */}
        {operation.executionResult?.runtimeTraces && operation.executionResult.runtimeTraces.length > 0 && (
          <div className="p-3.5 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-2.5">
            <div className="flex items-center gap-2 text-zinc-300 font-semibold text-[11px] uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5 text-sky-400" />
              <span>Agent Runtime Execution Traces</span>
            </div>
            <div className="space-y-1.5 font-mono text-[11px]">
              {operation.executionResult.runtimeTraces.map((t, idx) => (
                <div key={idx} className="p-2 rounded bg-zinc-950/80 border border-zinc-800/80 flex items-start justify-between gap-3">
                  <div className="space-y-0.5">
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-zinc-800 text-sky-300 uppercase mr-2">
                      {t.phase}
                    </span>
                    <span className="text-zinc-300">{t.message}</span>
                    {t.error && <p className="text-rose-400 text-[10px] mt-0.5">Error: {t.error}</p>}
                  </div>
                  <span className="text-zinc-500 text-[10px] shrink-0">
                    {new Date(t.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unknown Mutation State / Timeout Alert */}
        {isTimeout && (
          <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/80 space-y-2">
            <div className="flex items-center gap-2 text-amber-300 font-semibold">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Mutation State Unknown (Operation Timed Out)</span>
            </div>
            <p className="text-zinc-300 text-xs font-mono">
              {operation.executionResult?.message ||
                'The operation timed out while awaiting agent verification. The final Kubernetes state is UNKNOWN.'}
            </p>
            <p className="text-[11px] text-amber-400/90 leading-relaxed">
              <strong>Operational Safety Rule:</strong> Do not automatically re-run or repeat this mutation. Verify live workloads on the cluster first to determine if changes partially or fully took effect.
            </p>
          </div>
        )}

        {/* Failure / Rollback Details (if applicable) */}
        {!isTimeout && (isFailed || isRolledBack || operation.executionResult?.errorCategory) && (
          <div className="p-3.5 rounded-xl bg-rose-950/30 border border-rose-800/60 space-y-2">
            <div className="flex items-center gap-2 text-rose-300 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-400" />
              <span>Disruption / Failure Diagnostics</span>
            </div>
            <p className="text-zinc-300 text-xs font-mono">
              {operation.executionResult?.details || operation.executionResult?.message || 'Operation failed during execution or verification.'}
            </p>
            {operation.executionResult?.errorCategory && (
              <div className="text-[11px] text-rose-400">
                Category: <strong>{operation.executionResult.errorCategory}</strong>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
          <span className="text-[11px] text-zinc-500">
            Persistent audit record stored durable across cluster reconnects.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
};
