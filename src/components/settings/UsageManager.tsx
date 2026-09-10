import {
  Activity,
  Boxes,
  CheckCircle2,
  Cpu,
  CreditCard,
  Database,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button } from '../common/UI';

export const UsageManager: React.FC = () => {
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = async () => {
    try {
      setLoading(true);
      const res = await api.getOrgUsage();
      setUsage(res.usage);
    } catch (err) {
      console.error('Failed to load org usage:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  if (loading) {
    return (
      <div className="p-12 text-center text-zinc-400 font-mono text-xs flex flex-col items-center gap-2">
        <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
        <span>Calculating organization usage metrics...</span>
      </div>
    );
  }

  const u = usage || {
    period: new Date().toISOString().substring(0, 7),
    totalClusters: 0,
    totalNodes: 0,
    totalWorkloads: 0,
    telemetryBatchesIngested: 0,
    telemetryResourcesIngested: 0,
    incidentsDetected: 0,
    incidentsResolved: 0,
    remediationsExecuted: 0,
    aiAnalysesPerformed: 0,
    auditEventsRecorded: 0
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-sky-400" />
            Tenant Usage & Plan Quotas
          </h3>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Real-time consumption tracking for Kubernetes telemetry ingestion, managed nodes, and autonomous remediations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-zinc-400">
            Billing Period: <code className="text-sky-300 font-bold">{u.period}</code>
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchUsage}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            className="font-mono text-xs"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Plan Overview Card */}
      <div className="p-5 rounded-xl bg-gradient-to-r from-sky-950/30 to-zinc-900/60 border border-sky-900/40 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-sky-600 text-white font-mono text-xs font-bold uppercase tracking-wider">
              Enterprise Dedicated
            </span>
            <span className="text-xs font-mono text-zinc-400">Active Tenant Tier</span>
          </div>
          <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> High-Availability Cluster SLA (99.95%)
          </span>
        </div>
        <p className="text-xs font-mono text-zinc-300">
          Unlimited Kubernetes telemetry streaming, full Gemini 2.5 AI incident analysis engine, role-based access control, and 1-year cryptographic audit ledger retention.
        </p>
      </div>

      {/* Usage Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
        {/* Clusters */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Server className="w-4 h-4 text-sky-400" /> Managed Clusters
            </span>
            <span>{u.totalClusters} / 25 Max</span>
          </div>
          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
            <div
              className="bg-sky-500 h-full rounded-full"
              style={{ width: `${Math.min(100, (u.totalClusters / 25) * 100)}%` }}
            ></div>
          </div>
          <div className="text-[11px] text-zinc-500">Includes connected production & staging clusters.</div>
        </div>

        {/* Nodes */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Cpu className="w-4 h-4 text-indigo-400" /> Monitored Nodes
            </span>
            <span>{u.totalNodes} / 200 Max</span>
          </div>
          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
            <div
              className="bg-indigo-500 h-full rounded-full"
              style={{ width: `${Math.min(100, (u.totalNodes / 200) * 100)}%` }}
            ></div>
          </div>
          <div className="text-[11px] text-zinc-500">Live compute nodes currently streaming heartbeats.</div>
        </div>

        {/* Workloads */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Boxes className="w-4 h-4 text-amber-400" /> Workload Pods
            </span>
            <span>{u.totalWorkloads} / 2,000</span>
          </div>
          <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
            <div
              className="bg-amber-500 h-full rounded-full"
              style={{ width: `${Math.min(100, (u.totalWorkloads / 2000) * 100)}%` }}
            ></div>
          </div>
          <div className="text-[11px] text-zinc-500">Tracked Deployments, DaemonSets, and Pod replicas.</div>
        </div>

        {/* Telemetry Ingested */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Database className="w-4 h-4 text-emerald-400" /> Ingested Batches
            </span>
            <span className="text-zinc-200 font-bold">{u.telemetryBatchesIngested.toLocaleString()}</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            {u.telemetryResourcesIngested.toLocaleString()} individual K8s resource snapshots processed.
          </div>
        </div>

        {/* Incidents Resolved */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <ShieldAlert className="w-4 h-4 text-rose-400" /> Incidents Resolved
            </span>
            <span className="text-zinc-200 font-bold">
              {u.incidentsResolved} / {u.incidentsDetected}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500">
            {u.incidentsDetected > 0
              ? `${Math.round((u.incidentsResolved / u.incidentsDetected) * 100)}% auto-remediation & recovery rate`
              : 'Zero active incident bottlenecks'}
          </div>
        </div>

        {/* Remediations Executed */}
        <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
              <Zap className="w-4 h-4 text-cyan-400" /> AI Remediations
            </span>
            <span className="text-zinc-200 font-bold">{u.remediationsExecuted} Executed</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            {u.aiAnalysesPerformed} Gemini root-cause analyses generated this cycle.
          </div>
        </div>
      </div>
    </div>
  );
};
