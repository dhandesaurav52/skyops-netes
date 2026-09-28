import React from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Cpu,
  Database,
  HardDrive,
  Layers,
  Network,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Workflow,
  Zap
} from 'lucide-react';
import { ArchitectureDomainId, ArchitectureDomainSummary } from './types';

interface ArchitectureDomainCardProps {
  domain: ArchitectureDomainSummary;
  onSelectDomain: (id: ArchitectureDomainId) => void;
}

export const ArchitectureDomainCard: React.FC<ArchitectureDomainCardProps> = ({
  domain,
  onSelectDomain
}) => {
  const getDomainIcon = (id: ArchitectureDomainId) => {
    switch (id) {
      case 'compute':
        return <Cpu className="w-5 h-5 text-sky-400" />;
      case 'workloads':
        return <Layers className="w-5 h-5 text-indigo-400" />;
      case 'networking':
        return <Network className="w-5 h-5 text-cyan-400" />;
      case 'storage':
        return <HardDrive className="w-5 h-5 text-amber-400" />;
      case 'configuration':
        return <Database className="w-5 h-5 text-emerald-400" />;
      case 'scheduling':
        return <Workflow className="w-5 h-5 text-violet-400" />;
      case 'scaling':
        return <Zap className="w-5 h-5 text-yellow-400" />;
      case 'security':
        return <ShieldCheck className="w-5 h-5 text-rose-400" />;
      default:
        return <Boxes className="w-5 h-5 text-zinc-400" />;
    }
  };

  const { healthy, warning, critical, unknown } = domain.healthCounts;
  const hasCritical = critical > 0;
  const hasWarning = warning > 0;

  return (
    <div
      onClick={() => onSelectDomain(domain.id)}
      className="bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 flex flex-col justify-between transition-all cursor-pointer group shadow-sm hover:shadow-md"
    >
      <div>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center group-hover:border-zinc-700 transition-colors shadow-inner">
              {getDomainIcon(domain.id)}
            </div>
            <div>
              <h3 className="text-sm font-bold text-zinc-100 group-hover:text-sky-400 transition-colors flex items-center gap-1.5">
                {domain.title}
              </h3>
              <div className="text-[11px] font-mono text-zinc-500">
                {domain.resourceCount} observed resource{domain.resourceCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          {/* Health Pills */}
          <div className="flex items-center gap-1.5 text-[10px] font-mono">
            {critical > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/30 font-bold">
                {critical} crit
              </span>
            )}
            {warning > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                {warning} warn
              </span>
            )}
            {healthy > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {healthy} healthy
              </span>
            )}
            {domain.resourceCount === 0 && (
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                none
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        <p className="text-xs text-zinc-400 leading-relaxed mb-4 line-clamp-2">
          {domain.description}
        </p>

        {/* Real telemetry highlights */}
        <div className="space-y-1.5 mb-4 bg-zinc-950/70 p-3 rounded-lg border border-zinc-800/80">
          {domain.detectedHighlights.map((hl, idx) => (
            <div key={idx} className="text-xs text-zinc-300 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
              <span className="truncate">{hl}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer link */}
      <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs">
        <div className="text-[11px] font-mono text-zinc-500">
          {domain.categories.length > 0
            ? domain.categories.slice(0, 3).map((c) => `${c.count} ${c.kind}`).join(' • ')
            : 'Observing telemetry'}
        </div>
        <span className="text-sky-400 group-hover:text-sky-300 font-medium flex items-center gap-1">
          Explore
          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
        </span>
      </div>
    </div>
  );
};
