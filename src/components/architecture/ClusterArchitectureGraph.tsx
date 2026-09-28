import React from 'react';
import {
  Boxes,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Network,
  Radio,
  Server,
  Shield,
  ShieldCheck,
  Workflow,
  Zap
} from 'lucide-react';
import { Cluster } from '../../types/index';
import { ArchitectureDomainId, ArchitectureDomainSummary, ArchitectureTelemetryState } from './types';

interface ClusterArchitectureGraphProps {
  cluster?: Cluster | null;
  telemetry: ArchitectureTelemetryState;
  onSelectDomain: (id: ArchitectureDomainId) => void;
}

export const ClusterArchitectureGraph: React.FC<ClusterArchitectureGraphProps> = ({
  cluster,
  telemetry,
  onSelectDomain
}) => {
  const domains = telemetry.domains;

  const getDomainIcon = (id: ArchitectureDomainId) => {
    switch (id) {
      case 'compute':
        return <Cpu className="w-4 h-4 text-sky-400" />;
      case 'workloads':
        return <Layers className="w-4 h-4 text-indigo-400" />;
      case 'networking':
        return <Network className="w-4 h-4 text-cyan-400" />;
      case 'storage':
        return <HardDrive className="w-4 h-4 text-amber-400" />;
      case 'configuration':
        return <Database className="w-4 h-4 text-emerald-400" />;
      case 'scheduling':
        return <Workflow className="w-4 h-4 text-violet-400" />;
      case 'scaling':
        return <Zap className="w-4 h-4 text-yellow-400" />;
      case 'security':
        return <ShieldCheck className="w-4 h-4 text-rose-400" />;
      default:
        return <Boxes className="w-4 h-4 text-zinc-400" />;
    }
  };

  const domainList: ArchitectureDomainSummary[] = [
    domains.compute,
    domains.workloads,
    domains.networking,
    domains.storage,
    domains.configuration,
    domains.scheduling,
    domains.scaling,
    domains.security
  ];

  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 shadow-sm overflow-hidden relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 bg-[radial-gradient(#27272a_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Central Cluster Hub */}
        <div className="w-full max-w-xl bg-zinc-950/90 border-2 border-sky-500/40 rounded-2xl p-4 shadow-xl mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-inner">
              <Server className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold uppercase text-sky-400 tracking-wider">
                  Target Architecture
                </span>
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              </div>
              <h2 className="text-base font-bold text-zinc-100 mt-0.5">
                {cluster ? cluster.name : 'Fleet Telemetry Mesh (All Clusters)'}
              </h2>
              <div className="text-[11px] font-mono text-zinc-400 flex items-center gap-3 mt-1">
                <span>K8s {cluster?.k8sVersion || 'v1.29'}</span>
                <span>•</span>
                <span>{telemetry.totalResourceCount} Objects Ingested</span>
                <span>•</span>
                <span className="text-emerald-400 font-semibold">{telemetry.freshness}</span>
              </div>
            </div>
          </div>

          <div className="text-right hidden sm:block">
            <div className="text-[10px] font-mono uppercase text-zinc-500">Live Agent</div>
            <div className="text-xs font-semibold text-emerald-400 mt-0.5">
              {cluster?.agentStatus || 'CONNECTED'}
            </div>
          </div>
        </div>

        {/* 8 Architectural Domains Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {domainList.map((domain) => {
            const hasCrit = domain.healthCounts.critical > 0;
            const hasWarn = domain.healthCounts.warning > 0;

            return (
              <div
                key={domain.id}
                onClick={() => onSelectDomain(domain.id)}
                className="bg-zinc-950/80 hover:bg-zinc-950 border border-zinc-800/90 hover:border-sky-500/50 rounded-xl p-4 cursor-pointer transition-all group shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 group-hover:border-zinc-700 transition-colors">
                        {getDomainIcon(domain.id)}
                      </div>
                      <span className="text-xs font-bold text-zinc-200 group-hover:text-sky-400 transition-colors">
                        {domain.shortTitle}
                      </span>
                    </div>

                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-300">
                      {domain.resourceCount}
                    </span>
                  </div>

                  <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed mb-3">
                    {domain.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-zinc-900 flex items-center justify-between text-[10px] font-mono">
                  <span className="text-zinc-500 truncate max-w-[130px]">
                    {domain.activeFeatures[0] || 'Active'}
                  </span>
                  <span
                    className={`font-semibold ${
                      hasCrit
                        ? 'text-red-400'
                        : hasWarn
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {hasCrit ? 'DEGRADED' : hasWarn ? 'WARNING' : 'HEALTHY'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
