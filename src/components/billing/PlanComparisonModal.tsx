import React, { useEffect, useState } from 'react';
import {
  Check,
  Zap,
  Shield,
  Star,
  Sparkles,
  ArrowRight,
  AlertCircle,
  Clock,
  X,
  Loader2
} from 'lucide-react';
import { BillingInterval, Plan, PlanId } from '../../types/index';
import { PLANS_LIST, BILLING_INTERVALS, PLANS } from '../../config/plans';
import { Button } from '../common/UI';
import { api } from '../../api/client';

interface PlanComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPlanId?: PlanId;
  currentInterval?: BillingInterval;
  onSelectPlan?: (planId: PlanId, interval: BillingInterval) => Promise<void>;
  onPlanChanged?: () => void;
  loading?: boolean;
}

export const PlanComparisonModal: React.FC<PlanComparisonModalProps> = ({
  isOpen,
  onClose,
  currentPlanId = 'FREE',
  currentInterval = 'MONTHLY',
  onSelectPlan,
  onPlanChanged,
  loading = false
}) => {
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>(currentInterval || 'MONTHLY');
  const [confirmPlan, setConfirmPlan] = useState<Plan | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usdInrRate, setUsdInrRate] = useState<{ rate: number; fetchedAt: number; source: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    api.getUsdInrRate().then(setUsdInrRate).catch(() => setUsdInrRate(null));
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChoosePlan = (plan: Plan) => {
    setActionError(null);
    if (plan.id === currentPlanId && selectedInterval === currentInterval) {
      return; // Already on this plan and interval
    }
    if (plan.id === 'ENTERPRISE') {
      window.open('mailto:sales@skyops.dev?subject=Enterprise%20Tier%20Inquiry', '_blank');
      return;
    }
    setConfirmPlan(plan);
  };

  const handleConfirmAction = async () => {
    if (!confirmPlan) return;
    try {
      setActionError(null);
      if (onSelectPlan) {
        await onSelectPlan(confirmPlan.id, selectedInterval);
      } else {
        await api.upgradePlan(confirmPlan.id, selectedInterval);
        if (onPlanChanged) onPlanChanged();
      }
      setConfirmPlan(null);
      onClose();
    } catch (err: any) {
      setActionError(err?.message || 'Failed to update subscription');
    }
  };

  const isUpgrade = (targetPlanId: PlanId): boolean => {
    const ranks: Record<PlanId, number> = { FREE: 0, PRO: 1, BUSINESS: 2, ENTERPRISE: 3 };
    return ranks[targetPlanId] > (ranks[currentPlanId] ?? 0);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-6xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 sm:p-8 my-8 text-zinc-100 font-sans">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-zinc-400 hover:text-zinc-100 p-1.5 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="text-center max-w-2xl mx-auto mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-950/60 border border-sky-800/40 text-sky-400 text-xs font-mono font-medium mb-3">
            <Sparkles className="w-3.5 h-3.5" /> SkyOps Subscription Plans
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Scale your Kubernetes Fleet with Confidence
          </h2>
          <p className="text-sm text-zinc-400 mt-2">
            Select a billing duration and tier tailored to your team's cluster scale, telemetry retention, and AI incident recovery needs.
          </p>

          {/* Billing Duration Interval Switcher */}
          <div className="mt-6 inline-flex p-1 rounded-xl bg-zinc-900 border border-zinc-800 shadow-inner">
            {BILLING_INTERVALS.map((int) => {
              const savings = PLANS.BUSINESS.pricing[int.id]?.savingsPercentage || 0;
              return (
                <button
                  key={int.id}
                  onClick={() => setSelectedInterval(int.id)}
                  className={`relative px-3.5 py-2 text-xs font-medium rounded-lg transition-all cursor-pointer ${
                    selectedInterval === int.id
                      ? 'bg-sky-600 text-white shadow-md'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span>{int.label}</span>
                  {savings > 0 && (
                    <span
                      className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full uppercase ${
                        selectedInterval === int.id
                          ? 'bg-sky-700/80 text-white'
                          : 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                      }`}
                    >
                      Save {savings}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {PLANS_LIST.map((plan) => {
            const pricing = plan.pricing[selectedInterval];
            const isCurrent = plan.id === currentPlanId;
            const isRecommended = plan.recommended;

            return (
              <div
                key={plan.id}
                className={`relative flex flex-col justify-between rounded-2xl border p-6 transition-all ${
                  isCurrent
                    ? 'border-emerald-500/80 bg-emerald-950/10 shadow-lg shadow-emerald-950/30'
                    : isRecommended
                    ? 'border-sky-500/80 bg-gradient-to-b from-sky-950/20 to-zinc-900/60 shadow-xl shadow-sky-950/20'
                    : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                }`}
              >
                {/* Badges */}
                <div className="flex items-center justify-between mb-4">
                  {isCurrent ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Active Plan
                    </span>
                  ) : isRecommended ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider bg-sky-500/20 text-sky-400 border border-sky-500/30">
                      Most Popular
                    </span>
                  ) : (
                    <span className="text-[11px] font-mono text-zinc-500 uppercase">
                      {plan.tagline}
                    </span>
                  )}
                  {plan.badge && !isCurrent && !isRecommended && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-zinc-800 text-zinc-300">
                      {plan.badge}
                    </span>
                  )}
                </div>

                {/* Title & Pricing */}
                <div className="mb-4">
                  <h3 className="text-xl font-bold text-white">{plan.name}</h3>
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{plan.description}</p>

                  <div className="mt-4 pt-4 border-t border-zinc-800/80">
                    {pricing.totalPrice === 0 ? (
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-extrabold text-white">Free</span>
                        <span className="text-xs text-zinc-400">/ forever</span>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold text-zinc-400">₹</span>
                          <span className="text-3xl font-extrabold text-white">
                            {pricing.monthlyEquivalent.toLocaleString('en-IN')}
                          </span>
                          <span className="text-xs text-zinc-400">/ month</span>
                        </div>
                        <div className="text-[11px] font-mono text-zinc-400 mt-1">
                          Billed ₹{pricing.totalPrice.toLocaleString('en-IN')} {selectedInterval.toLowerCase()}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          {usdInrRate
                            ? `≈ $${(pricing.monthlyEquivalent / usdInrRate.rate).toFixed(2)} / month`
                            : 'USD equivalent temporarily unavailable'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Limits & Feature Highlights */}
                <div className="space-y-2.5 my-5 text-xs border-t border-zinc-800/80 pt-4 flex-grow">
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      <strong>{plan.limits.clusters >= 999 ? 'Unlimited' : plan.limits.clusters}</strong>{' '}
                      Kubernetes Cluster{plan.limits.clusters === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      <strong>{plan.limits.nodes >= 9999 ? 'Unlimited' : plan.limits.nodes}</strong> Monitored Nodes
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      <strong>{plan.limits.dataRetentionDays} Days</strong> Telemetry Retention
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      <strong>{plan.limits.members >= 999 ? 'Unlimited' : plan.limits.members}</strong> Team Seats
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      {plan.limits.aiInvestigationsMonthly === 0 ? (
                        <span className="text-zinc-500">No Gemini RCA</span>
                      ) : (
                        <span>
                          <strong>{plan.limits.aiInvestigationsMonthly >= 9999 ? 'Unlimited' : plan.limits.aiInvestigationsMonthly}</strong> Gemini RCA / mo
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      {plan.features.automatedRemediation ? (
                        <span>Controlled Remediations ({plan.limits.remediationsMonthly >= 9999 ? 'Unlimited' : plan.limits.remediationsMonthly}/mo)</span>
                      ) : (
                        <span className="text-zinc-500">Remediations Disabled</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-300 font-medium">
                    <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>
                      {plan.features.webhooks ? 'Slack & Custom Webhooks' : <span className="text-zinc-500">No Webhooks</span>}
                    </span>
                  </div>
                </div>

                {/* Action CTA Button */}
                <div className="pt-2">
                  {isCurrent && selectedInterval === currentInterval ? (
                    <Button
                      variant="outline"
                      disabled
                      className="w-full justify-center text-xs font-mono border-emerald-700/60 text-emerald-400 cursor-default bg-emerald-950/20"
                    >
                      Active Plan
                    </Button>
                  ) : isCurrent ? (
                    <Button
                      variant="primary"
                      onClick={() => handleChoosePlan(plan)}
                      disabled={loading}
                      className="w-full justify-center text-xs font-mono bg-sky-600 hover:bg-sky-500"
                    >
                      Switch to {selectedInterval}
                    </Button>
                  ) : plan.id === 'ENTERPRISE' ? (
                    <Button
                      variant="outline"
                      onClick={() => handleChoosePlan(plan)}
                      className="w-full justify-center text-xs font-mono border-zinc-700 hover:border-zinc-500"
                    >
                      Contact Sales
                    </Button>
                  ) : isUpgrade(plan.id) ? (
                    <Button
                      variant="primary"
                      onClick={() => handleChoosePlan(plan)}
                      disabled={loading}
                      className="w-full justify-center text-xs font-mono bg-sky-600 hover:bg-sky-500 shadow-md shadow-sky-950"
                    >
                      Upgrade to {plan.name}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => handleChoosePlan(plan)}
                      disabled={loading}
                      className="w-full justify-center text-xs font-mono border-zinc-800 text-zinc-400 hover:text-zinc-200"
                    >
                      Downgrade to {plan.name}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Confirmation Modal */}
        {confirmPlan && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4 font-sans">
              <h4 className="text-lg font-bold text-white flex items-center gap-2">
                <Zap className="w-5 h-5 text-sky-400" />
                Confirm Subscription Change
              </h4>
              <p className="text-xs text-zinc-300">
                You are updating your organization workspace subscription:
              </p>

              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 font-mono text-xs">
                <div className="flex justify-between">
                  <span className="text-zinc-400">Selected Plan:</span>
                  <span className="font-bold text-white">{confirmPlan.name} Tier</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-400">Billing Duration:</span>
                  <span className="font-bold text-sky-400">{selectedInterval}</span>
                </div>
                <div className="flex justify-between border-t border-zinc-800/80 pt-2">
                  <span className="text-zinc-400">Total Billed Today:</span>
                  <span className="font-bold text-emerald-400 text-sm">
                    ₹{confirmPlan.pricing[selectedInterval].totalPrice.toLocaleString('en-IN')}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-zinc-400">
                {isUpgrade(confirmPlan.id)
                  ? 'Your upgraded quotas and AI investigation entitlements will activate immediately with instant invoice receipt generation.'
                  : 'Your downgrade will adjust quotas to the selected plan limits. If your current resource count exceeds target limits, new creations will be paused.'}
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => setConfirmPlan(null)}
                  disabled={loading}
                  className="font-mono text-xs"
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleConfirmAction}
                  disabled={loading}
                  icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  className="font-mono text-xs bg-sky-600 hover:bg-sky-500"
                >
                  {loading ? 'Activating...' : 'Confirm Subscription'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
