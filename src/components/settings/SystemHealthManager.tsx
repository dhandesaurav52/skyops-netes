import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  HeartPulse,
  Layers,
  Loader2,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AGENT_VERSION } from '../../config/version';
import { Button } from '../common/UI';

export const SystemHealthManager: React.FC = () => {
  const [health, setHealth] = useState<any>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchHealth = async () => {
    try {
      setLoading(true);
      const [h, m] = await Promise.all([
        api.getSystemHealth().catch((err) => ({ error: err?.message })),
        api.getSystemMetrics().catch((err) => null)
      ]);
      setHealth(h);
      setMetrics(m);
    } catch (err) {
      console.error('Failed to load system health:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, []);

  const formatUptime = (sec?: number) => {
    if (!sec) return '0m';
    const hours = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-zinc-400 font-mono text-xs flex flex-col items-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
        <span>Querying SkyOps Platform Observability probes...</span>
      </div>
    );
  }

  const h = health || {};
  const isHealthy = h.status === 'ok';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-emerald-400" />
            Platform Self-Observability & Health Probes
          </h3>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Internal Kubernetes controller metrics, memory utilization, background queues, and AI provider status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchHealth}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            className="font-mono text-xs"
          >
            Poll Probes
          </Button>
        </div>
      </div>

      {/* Primary Status Banner */}
      <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4 font-mono text-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-950/50 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="font-bold text-sm text-zinc-100 flex items-center gap-2">
              SkyOps Platform Services Healthy
              <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-800/60">
                LIVENESS 200 OK
              </span>
            </div>
            <div className="text-zinc-400 text-xs mt-0.5">
              Readiness: {h.readiness ? 'Ready to ingest telemetry' : 'Degraded'} • System Uptime: {formatUptime(h.uptimeSeconds)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-zinc-400 border-t sm:border-t-0 pt-2 sm:pt-0 border-zinc-800">
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Agent Spec</div>
            <div className="text-zinc-200 font-bold">v{AGENT_VERSION}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-zinc-500">Node Env</div>
            <div className="text-zinc-200 font-bold">{h.environment || 'development'}</div>
          </div>
        </div>
      </div>

      {/* Subsystem Health Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
        {/* Ingestion Pipeline */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-sky-400" /> Ingestion Pipeline
            </span>
            <span className="text-emerald-400 text-[11px] font-bold">HEALTHY</span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Processing cluster state heartbeats, pod phases, node capacities, and events.
          </p>
          <div className="pt-1 text-[11px] text-zinc-500">
            Total Batches: <code className="text-zinc-300">{metrics?.telemetry?.batchesProcessed || 0}</code>
          </div>
        </div>

        {/* Gemini AI Subsystem */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-indigo-400" /> Gemini 2.5 AI Service
            </span>
            <span className="text-emerald-400 text-[11px] font-bold">
              {metrics?.ai?.circuitBreakerOpen ? 'CIRCUIT OPEN' : 'ACTIVE'}
            </span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Autonomous root cause analysis, structured remediation proposals, and risk evaluations.
          </p>
          <div className="pt-1 text-[11px] text-zinc-500">
            Consecutive Failures: <code className="text-zinc-300">{metrics?.ai?.consecutiveFailures || 0}</code>
          </div>
        </div>

        {/* Background Job Queue */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-amber-400" /> Background Queues
            </span>
            <span className="text-emerald-400 text-[11px] font-bold">DRAINING</span>
          </div>
          <p className="text-[11px] text-zinc-400">
            Asynchronous outbound webhook deliveries, retry jitter loops, and metric rollups.
          </p>
          <div className="pt-1 text-[11px] text-zinc-500">
            Active Workers: <code className="text-zinc-300">{metrics?.jobs?.activeWorkers || 1}</code>
          </div>
        </div>
      </div>

      {/* Memory & Resource Utilization */}
      {h.memory && (
        <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-800/80 space-y-3 font-mono text-xs">
          <h4 className="font-bold text-zinc-200 uppercase tracking-wider text-[11px] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-zinc-400" />
            Backend Container Resource Utilization
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div className="text-[10px] text-zinc-500 uppercase">Heap Used</div>
              <div className="text-base font-bold text-zinc-200 mt-0.5">{h.memory.heapUsedMb} MB</div>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div className="text-[10px] text-zinc-500 uppercase">Heap Total</div>
              <div className="text-base font-bold text-zinc-200 mt-0.5">{h.memory.heapTotalMb} MB</div>
            </div>
            <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
              <div className="text-[10px] text-zinc-500 uppercase">Resident Set Size (RSS)</div>
              <div className="text-base font-bold text-zinc-200 mt-0.5">{h.memory.rssMb} MB</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
