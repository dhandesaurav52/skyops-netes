import React from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Layers,
  Sparkles,
  Play,
  UserCheck,
  Info,
  Compass,
  AlertTriangle
} from 'lucide-react';
import { AgentStatus, ClusterStatus, IncidentSeverity, IncidentStatus } from '../../types/index';

export type ProvenanceType =
  | 'FACT'
  | 'DERIVED_FACT'
  | 'INFERENCE'
  | 'HYPOTHESIS'
  | 'RECOMMENDATION'
  | 'EXECUTABLE_ACTION'
  | 'VERIFIED_RESULT'
  | 'CONFIRMED'
  | 'EXECUTABLE'
  | 'VERIFIED'
  | 'MANUAL'
  | 'UNKNOWN';

export const ProvenanceBadge: React.FC<{
  type: ProvenanceType;
  label?: string;
  size?: 'sm' | 'md';
}> = ({ type, label, size = 'sm' }) => {
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  switch (type) {
    case 'FACT':
    case 'CONFIRMED':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-emerald-950/80 text-emerald-300 border-emerald-700/80 ${padding}`}
        >
          <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
          {label || (type === 'FACT' ? 'FACT' : 'CONFIRMED')}
        </span>
      );
    case 'DERIVED_FACT':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-cyan-950/80 text-cyan-300 border-cyan-700/80 ${padding}`}
        >
          <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
          {label || 'DERIVED FACT'}
        </span>
      );
    case 'INFERENCE':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-sky-950/80 text-sky-300 border-sky-700/80 ${padding}`}
        >
          <Layers className="w-3 h-3 text-sky-400 shrink-0" />
          {label || 'INFERENCE'}
        </span>
      );
    case 'HYPOTHESIS':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-amber-950/80 text-amber-300 border-amber-700/80 ${padding}`}
        >
          <Info className="w-3 h-3 text-amber-400 shrink-0" />
          {label || 'HYPOTHESIS'}
        </span>
      );
    case 'RECOMMENDATION':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-purple-950/80 text-purple-300 border-purple-700/80 ${padding}`}
        >
          <Compass className="w-3 h-3 text-purple-400 shrink-0" />
          {label || 'RECOMMENDATION'}
        </span>
      );
    case 'EXECUTABLE_ACTION':
    case 'EXECUTABLE':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-teal-950/90 text-teal-300 border-teal-700/80 ${padding}`}
        >
          <Play className="w-2.5 h-2.5 text-teal-400 shrink-0" />
          {label || (type === 'EXECUTABLE_ACTION' ? 'EXECUTABLE ACTION' : 'EXECUTABLE')}
        </span>
      );
    case 'VERIFIED_RESULT':
    case 'VERIFIED':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-emerald-950/90 text-emerald-300 border-emerald-600 ${padding}`}
        >
          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          {label || (type === 'VERIFIED_RESULT' ? 'VERIFIED RESULT' : 'VERIFIED')}
        </span>
      );
    case 'MANUAL':
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-zinc-900 text-zinc-300 border-zinc-700 ${padding}`}
        >
          <UserCheck className="w-3 h-3 text-sky-400 shrink-0" />
          {label || 'MANUAL'}
        </span>
      );
    case 'UNKNOWN':
    default:
      return (
        <span
          className={`inline-flex items-center gap-1 font-mono font-bold rounded border bg-amber-950/80 text-amber-300 border-amber-800/80 ${padding}`}
        >
          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
          {label || 'UNKNOWN / NEEDS INVESTIGATION'}
        </span>
      );
  }
};

export const SeverityBadge: React.FC<{ severity: IncidentSeverity; size?: 'sm' | 'md' }> = ({
  severity,
  size = 'md'
}) => {
  const styles: Record<IncidentSeverity, { bg: string; text: string; border: string; dot: string }> = {
    CRITICAL: {
      bg: 'bg-rose-950/40 text-rose-300',
      text: 'text-rose-400',
      border: 'border-rose-700/60',
      dot: 'bg-rose-500'
    },
    HIGH: {
      bg: 'bg-amber-950/40 text-amber-300',
      text: 'text-amber-400',
      border: 'border-amber-700/60',
      dot: 'bg-amber-500'
    },
    MEDIUM: {
      bg: 'bg-yellow-950/30 text-yellow-300',
      text: 'text-yellow-400',
      border: 'border-yellow-700/50',
      dot: 'bg-yellow-500'
    },
    LOW: {
      bg: 'bg-sky-950/30 text-sky-300',
      text: 'text-sky-400',
      border: 'border-sky-700/50',
      dot: 'bg-sky-500'
    },
    INFO: {
      bg: 'bg-slate-900 text-slate-300',
      text: 'text-slate-400',
      border: 'border-slate-700',
      dot: 'bg-slate-500'
    }
  };

  const current = styles[severity] || styles.INFO;
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono font-medium rounded border ${current.bg} ${current.border} ${padding}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${current.dot}`} />
      {severity}
    </span>
  );
};

export const StatusBadge: React.FC<{ status: IncidentStatus; size?: 'sm' | 'md' }> = ({
  status,
  size = 'md'
}) => {
  const styles: Record<IncidentStatus, { bg: string; text: string; border: string }> = {
    OPEN: {
      bg: 'bg-rose-950/50 text-rose-300',
      text: 'text-rose-400',
      border: 'border-rose-700/60'
    },
    ACKNOWLEDGED: {
      bg: 'bg-blue-950/50 text-blue-300',
      text: 'text-blue-400',
      border: 'border-blue-700/60'
    },
    IN_PROGRESS: {
      bg: 'bg-purple-950/50 text-purple-300',
      text: 'text-purple-400',
      border: 'border-purple-700/60'
    },
    RESOLVED: {
      bg: 'bg-emerald-950/50 text-emerald-300',
      text: 'text-emerald-400',
      border: 'border-emerald-700/60'
    },
    CLOSED: {
      bg: 'bg-zinc-900 text-zinc-400',
      text: 'text-zinc-400',
      border: 'border-zinc-700'
    }
  };

  const current = styles[status] || styles.OPEN;
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded border ${current.bg} ${current.border} ${padding}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
};

export const ClusterStatusBadge: React.FC<{ status: ClusterStatus; agentStatus?: AgentStatus }> = ({
  status,
  agentStatus
}) => {
  let label: string = status;
  let bg = 'bg-slate-900 text-slate-300 border-slate-700';
  let dot = 'bg-slate-500';

  const normalized = (status || '').toLowerCase();
  const normalizedAgent = (agentStatus || '').toLowerCase();

  if (normalized === 'pending' || normalizedAgent === 'pending') {
    label = 'PENDING AGENT';
    bg = 'bg-amber-950/40 text-amber-300 border-amber-800/60';
    dot = 'bg-amber-400 animate-pulse';
  } else if (normalized === 'agent_detected' || normalizedAgent === 'agent_detected') {
    label = 'AGENT DETECTED';
    bg = 'bg-sky-950/40 text-sky-300 border-sky-800/60';
    dot = 'bg-sky-400 animate-pulse';
  } else if (normalized === 'waiting_for_confirmation' || normalizedAgent === 'waiting_confirmation') {
    label = 'WAITING CONFIRMATION';
    bg = 'bg-purple-950/40 text-purple-300 border-purple-800/60';
    dot = 'bg-purple-400 animate-pulse';
  } else if (normalized === 'connected' || normalized === 'healthy' || status === 'HEALTHY') {
    label = 'CONNECTED';
    bg = 'bg-emerald-950/40 text-emerald-300 border-emerald-700/60';
    dot = 'bg-emerald-500';
  } else if (normalized === 'warning' || status === 'WARNING' || agentStatus === 'DEGRADED') {
    label = agentStatus === 'DEGRADED' ? 'DEGRADED' : 'WARNING';
    bg = 'bg-amber-950/40 text-amber-300 border-amber-700/60';
    dot = 'bg-amber-500';
  } else if (normalized === 'critical' || status === 'CRITICAL') {
    label = 'CRITICAL';
    bg = 'bg-rose-950/40 text-rose-300 border-rose-700/60';
    dot = 'bg-rose-500 animate-pulse';
  } else if (normalized === 'offline' || normalized === 'agent_offline' || agentStatus === 'OFFLINE' || status === 'AGENT_OFFLINE') {
    label = 'AGENT OFFLINE';
    bg = 'bg-zinc-950 text-zinc-400 border-zinc-700';
    dot = 'bg-zinc-600';
  } else if (normalized === 'error' || agentStatus === 'ERROR') {
    label = 'CONNECTION ERROR';
    bg = 'bg-rose-950/40 text-rose-300 border-rose-800/60';
    dot = 'bg-rose-500';
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono text-xs font-medium px-2.5 py-1 rounded border ${bg}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
};

export const WorkloadKindBadge: React.FC<{ kind: string; size?: 'sm' | 'md' }> = ({ kind, size = 'sm' }) => {
  const k = (kind || '').toLowerCase();
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs';

  let style = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let short = kind;

  if (k === 'deployment') {
    style = 'bg-blue-950/60 text-blue-300 border-blue-800/60';
    short = 'Deploy';
  } else if (k === 'statefulset') {
    style = 'bg-indigo-950/60 text-indigo-300 border-indigo-800/60';
    short = 'STS';
  } else if (k === 'daemonset') {
    style = 'bg-purple-950/60 text-purple-300 border-purple-800/60';
    short = 'DS';
  } else if (k === 'job') {
    style = 'bg-teal-950/60 text-teal-300 border-teal-800/60';
    short = 'Job';
  } else if (k === 'cronjob') {
    style = 'bg-cyan-950/60 text-cyan-300 border-cyan-800/60';
    short = 'CronJob';
  } else if (k === 'pod') {
    style = 'bg-sky-950/60 text-sky-300 border-sky-800/60';
    short = 'Pod';
  } else if (k === 'node') {
    style = 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60';
    short = 'Node';
  } else if (k === 'persistentvolumeclaim' || k === 'pvc') {
    style = 'bg-amber-950/60 text-amber-300 border-amber-800/60';
    short = 'PVC';
  } else if (k === 'replicaset') {
    style = 'bg-slate-900 text-slate-300 border-slate-700';
    short = 'RS';
  }

  return (
    <span className={`inline-flex items-center font-mono font-semibold rounded border ${style} ${padding}`}>
      {short}
    </span>
  );
};

export const PodPhaseBadge: React.FC<{
  phaseOrStatus: string;
  restarts?: number;
  ready?: boolean;
  size?: 'sm' | 'md';
}> = ({ phaseOrStatus, restarts, ready, size = 'sm' }) => {
  const s = phaseOrStatus || 'Unknown';
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';

  const isCrashing =
    s === 'CrashLoopBackOff' ||
    s === 'ImagePullBackOff' ||
    s === 'ErrImagePull' ||
    s === 'OOMKilled' ||
    s === 'Failed' ||
    s === 'Error';

  const isPending = s === 'Pending' || s === 'ContainerCreating';
  const isCompleted = s === 'Completed' || s === 'Succeeded';
  const isRunning = s === 'Running' || (!isCrashing && !isPending && !isCompleted);

  let style = 'bg-zinc-800 text-zinc-300 border-zinc-700';
  let dot = 'bg-zinc-500';

  if (isCrashing) {
    style = 'bg-rose-950/60 text-rose-300 border-rose-800/70';
    dot = 'bg-rose-500 animate-pulse';
  } else if (isPending) {
    style = 'bg-amber-950/50 text-amber-300 border-amber-800/60';
    dot = 'bg-amber-400 animate-pulse';
  } else if (isCompleted) {
    style = 'bg-slate-900 text-slate-300 border-slate-700';
    dot = 'bg-slate-400';
  } else if (isRunning) {
    style = 'bg-emerald-950/50 text-emerald-300 border-emerald-800/60';
    dot = 'bg-emerald-500';
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono font-medium rounded border ${style} ${padding}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span>{s}</span>
      {typeof restarts === 'number' && restarts > 0 && (
        <span className="ml-1 px-1 py-0.2 rounded bg-rose-900/60 text-rose-200 text-[10px] font-bold border border-rose-700/60">
          {restarts}r
        </span>
      )}
    </span>
  );
};

export const ResourceHealthBadge: React.FC<{ health: 'HEALTHY' | 'WARNING' | 'CRITICAL'; size?: 'sm' | 'md' }> = ({
  health,
  size = 'sm'
}) => {
  const padding = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  if (health === 'CRITICAL') {
    return (
      <span className={`inline-flex items-center gap-1 font-mono font-semibold rounded border bg-rose-950/60 text-rose-300 border-rose-800/70 ${padding}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
        CRITICAL
      </span>
    );
  }
  if (health === 'WARNING') {
    return (
      <span className={`inline-flex items-center gap-1 font-mono font-semibold rounded border bg-amber-950/50 text-amber-300 border-amber-800/60 ${padding}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
        DEGRADED
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 font-mono font-semibold rounded border bg-emerald-950/50 text-emerald-300 border-emerald-800/60 ${padding}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
      HEALTHY
    </span>
  );
};
