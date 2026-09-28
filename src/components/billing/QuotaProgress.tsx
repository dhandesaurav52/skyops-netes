import React from 'react';
import {
  Server,
  Cpu,
  Boxes,
  Users,
  Sparkles,
  Zap,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpRight
} from 'lucide-react';
import { OrgBillingOverview } from '../../types/index';
import { Button } from '../common/UI';

interface QuotaProgressProps {
  overview: OrgBillingOverview;
  onUpgrade: () => void;
}

export const QuotaProgress: React.FC<QuotaProgressProps> = ({ overview, onUpgrade }) => {
  const { usage, entitlements, plan } = overview;

  const quotaItems = [
    {
      id: 'clusters',
      label: 'Managed Clusters',
      current: usage.clusters.current,
      limit: usage.clusters.limit,
      percentage: usage.clusters.percentage,
      icon: <Server className="w-4 h-4 text-sky-400" />,
      description: 'Connected production & staging Kubernetes clusters'
    },
    {
      id: 'nodes',
      label: 'Monitored Nodes',
      current: usage.nodes.current,
      limit: usage.nodes.limit,
      percentage: usage.nodes.percentage,
      icon: <Cpu className="w-4 h-4 text-indigo-400" />,
      description: 'Active compute nodes streaming real-time heartbeats'
    },
    {
      id: 'workloads',
      label: 'Workload Pods',
      current: usage.workloads.current,
      limit: usage.workloads.limit,
      percentage: usage.workloads.percentage,
      icon: <Boxes className="w-4 h-4 text-amber-400" />,
      description: 'Tracked Deployments, DaemonSets, and Pod replicas'
    },
    {
      id: 'members',
      label: 'Team Seats',
      current: usage.members.current,
      limit: usage.members.limit,
      percentage: usage.members.percentage,
      icon: <Users className="w-4 h-4 text-emerald-400" />,
      description: 'Team members with RBAC roles in this workspace'
    },
    {
      id: 'aiInvestigations',
      label: 'Gemini AI Incident RCA',
      current: usage.aiInvestigations.current,
      limit: usage.aiInvestigations.limit,
      percentage: usage.aiInvestigations.percentage,
      icon: <Sparkles className="w-4 h-4 text-purple-400" />,
      description: 'AI-assisted root-cause investigations generated this month'
    },
    {
      id: 'remediations',
      label: 'Controlled Remediations',
      current: usage.remediations.current,
      limit: usage.remediations.limit,
      percentage: usage.remediations.percentage,
      icon: <Zap className="w-4 h-4 text-cyan-400" />,
      description: 'Autonomous container recovery operations executed'
    }
  ];

  const anyQuotaExceeded = quotaItems.some(
    (q) => q.limit !== 999 && q.limit !== 9999 && q.current >= q.limit
  );

  return (
    <div className="space-y-6">
      {/* Exceeded Warning Banner */}
      {anyQuotaExceeded && (
        <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-xs font-mono text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Quota Limit Reached:</strong> One or more resources have reached 100% of your current plan limit. Upgrade your tier to add more clusters or team seats.
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onUpgrade}
            icon={<ArrowUpRight className="w-3.5 h-3.5" />}
            className="font-mono text-xs bg-amber-600 hover:bg-amber-500 text-white shrink-0"
          >
            Upgrade Tier
          </Button>
        </div>
      )}

      {/* Quota Progress Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono text-xs">
        {quotaItems.map((item) => {
          const isUnlimited = item.limit >= 999;
          const isFull = !isUnlimited && item.current >= item.limit;
          const isNearFull = !isUnlimited && !isFull && item.percentage >= 80;

          return (
            <div
              key={item.id}
              className={`p-4 rounded-xl bg-zinc-950 border transition-colors space-y-2.5 ${
                isFull
                  ? 'border-rose-900/80 bg-rose-950/10'
                  : isNearFull
                  ? 'border-amber-900/80 bg-amber-950/10'
                  : 'border-zinc-800/80'
              }`}
            >
              <div className="flex items-center justify-between text-zinc-400">
                <span className="flex items-center gap-1.5 font-semibold text-zinc-200">
                  {item.icon} {item.label}
                </span>
                <span
                  className={
                    isFull
                      ? 'text-rose-400 font-bold'
                      : isNearFull
                      ? 'text-amber-400 font-bold'
                      : 'text-zinc-400'
                  }
                >
                  {item.current} / {isUnlimited ? 'Unlimited' : item.limit}
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    isFull
                      ? 'bg-rose-500'
                      : isNearFull
                      ? 'bg-amber-500'
                      : 'bg-sky-500'
                  }`}
                  style={{ width: `${Math.min(100, item.percentage)}%` }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-500">
                <span className="line-clamp-1">{item.description}</span>
                {!isUnlimited && <span>{item.percentage}%</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Feature Access Matrix Card */}
      <div className="p-5 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-3 font-mono text-xs">
        <h4 className="text-zinc-200 font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Feature Entitlements Matrix ({plan.name} Tier)
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.geminiRootCauseAnalysis ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.geminiRootCauseAnalysis ? 'text-zinc-200' : 'text-zinc-500'}>
              Gemini AI Incident Root-Cause Analysis
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.autonomousRemediation ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.autonomousRemediation ? 'text-zinc-200' : 'text-zinc-500'}>
              Controlled Autonomous Remediations
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.customWebhooks ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.customWebhooks ? 'text-zinc-200' : 'text-zinc-500'}>
              Slack & Webhook Integrations
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.auditLogExport ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.auditLogExport ? 'text-zinc-200' : 'text-zinc-500'}>
              Cryptographic Audit Log Export
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.emailAlerts ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.emailAlerts ? 'text-zinc-200' : 'text-zinc-500'}>
              Real-time Incident Email Alerts
            </span>
          </div>

          <div className="flex items-center gap-2 text-zinc-300">
            {entitlements.features.ssoSaml ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
            )}
            <span className={entitlements.features.ssoSaml ? 'text-zinc-200' : 'text-zinc-500'}>
              Enterprise SSO / SAML
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
