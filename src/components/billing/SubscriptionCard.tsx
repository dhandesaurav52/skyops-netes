import React, { useState } from 'react';
import {
  CreditCard,
  Sparkles,
  Calendar,
  AlertTriangle,
  RotateCcw,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Zap,
  Loader2
} from 'lucide-react';
import { OrgBillingOverview } from '../../types/index';
import { Button } from '../common/UI';

interface SubscriptionCardProps {
  overview: OrgBillingOverview;
  onOpenPlans: () => void;
  onCancel: () => Promise<void>;
  onResume: () => Promise<void>;
  loading?: boolean;
}

export const SubscriptionCard: React.FC<SubscriptionCardProps> = ({
  overview,
  onOpenPlans,
  onCancel,
  onResume,
  loading = false
}) => {
  const [canceling, setCanceling] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);

  const { subscription, plan, isTrial, trialDaysRemaining } = overview;

  const handleCancelClick = async () => {
    try {
      setCanceling(true);
      await onCancel();
      setShowConfirmCancel(false);
    } finally {
      setCanceling(false);
    }
  };

  const handleResumeClick = async () => {
    try {
      setResuming(true);
      await onResume();
    } finally {
      setResuming(false);
    }
  };

  const renewalDate = new Date(subscription.currentPeriodEnd).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-sky-950/30 border border-zinc-800 p-6 sm:p-7 shadow-xl space-y-5">
      {/* Top row: plan name, status & action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-sky-400" />
              {plan.name} Tier
            </h3>

            {/* Status Pill */}
            {subscription.status === 'ACTIVE' && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-700/60 text-emerald-400 text-xs font-mono font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVE
              </span>
            )}
            {subscription.status === 'TRIALING' && (
              <span className="px-2.5 py-0.5 rounded-full bg-sky-950/80 border border-sky-700/60 text-sky-400 text-xs font-mono font-semibold flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> TRIAL ({trialDaysRemaining}d remaining)
              </span>
            )}
            {subscription.status === 'PAST_DUE' && (
              <span className="px-2.5 py-0.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-amber-400 text-xs font-mono font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> PAYMENT PAST DUE
              </span>
            )}
            {subscription.status === 'CANCELED' && (
              <span className="px-2.5 py-0.5 rounded-full bg-rose-950/80 border border-rose-700/60 text-rose-400 text-xs font-mono font-semibold">
                CANCELED
              </span>
            )}

            {/* Billing Interval Pill */}
            {subscription.planId !== 'FREE' && (
              <span className="px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 text-xs font-mono">
                {subscription.billingInterval} Duration
              </span>
            )}

            {/* Payment Provider Pill */}
            {subscription.planId !== 'FREE' && subscription.provider && (
              <span className={`px-2.5 py-0.5 rounded-full border text-xs font-mono font-medium ${
                subscription.provider === 'razorpay'
                  ? 'bg-sky-950/60 border-sky-600/50 text-sky-300'
                  : 'bg-zinc-800/60 border-zinc-700/50 text-zinc-400'
              }`}>
                {subscription.provider === 'razorpay' ? 'Razorpay Gateway' : 'Sandbox Gateway'}
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 font-mono mt-1.5">{plan.description}</p>
        </div>

        {/* Upgrade / Change Plan CTAs */}
        <div className="flex items-center gap-2.5 shrink-0">
          {subscription.cancelAtPeriodEnd ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResumeClick}
              disabled={resuming || loading}
              icon={resuming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              className="font-mono text-xs border-emerald-700/60 text-emerald-400 hover:bg-emerald-950/30"
            >
              Resume Subscription
            </Button>
          ) : (
            subscription.planId !== 'FREE' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowConfirmCancel(true)}
                disabled={loading}
                className="font-mono text-xs text-zinc-400 hover:text-rose-400"
              >
                Cancel Subscription
              </Button>
            )
          )}

          <Button
            variant="primary"
            size="sm"
            onClick={onOpenPlans}
            disabled={loading}
            icon={<Sparkles className="w-3.5 h-3.5 text-sky-200" />}
            className="font-mono text-xs bg-sky-600 hover:bg-sky-500 shadow-md shadow-sky-950"
          >
            {subscription.planId === 'FREE' ? 'Upgrade Plan' : 'Change Plan or Duration'}
          </Button>
        </div>
      </div>

      {/* Trial Notification Banner */}
      {isTrial && trialDaysRemaining !== undefined && (
        <div className="p-3.5 rounded-xl bg-sky-950/40 border border-sky-800/60 text-xs font-mono text-sky-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              You are currently on a <strong>Free Trial</strong> with {trialDaysRemaining} day{trialDaysRemaining === 1 ? '' : 's'} remaining. Your trial concludes on <strong>{renewalDate}</strong>.
            </span>
          </div>
          <button
            onClick={onOpenPlans}
            className="text-xs text-sky-400 hover:text-sky-300 underline font-semibold shrink-0 cursor-pointer"
          >
            Upgrade Now
          </button>
        </div>
      )}

      {/* Cancellation Notice Banner */}
      {subscription.cancelAtPeriodEnd && (
        <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs font-mono text-amber-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Your subscription will cancel at the end of the current billing cycle on <strong>{renewalDate}</strong>. You can resume anytime before this date to preserve your quotas.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleResumeClick}
            disabled={resuming}
            className="text-xs font-mono border-amber-700/60 text-amber-300 hover:bg-amber-900/30 shrink-0"
          >
            Resume
          </Button>
        </div>
      )}

      {/* Period & SLA Metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs pt-2 border-t border-zinc-800/80">
        <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
          <span className="text-zinc-500 block text-[10px] uppercase">Current Billing Cycle</span>
          <span className="text-zinc-200 font-semibold mt-1 block">
            {subscription.planId === 'FREE' ? 'Standard Perpetual' : `Renews ${renewalDate}`}
          </span>
        </div>
        <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
          <span className="text-zinc-500 block text-[10px] uppercase">Telemetry Retention SLA</span>
          <span className="text-sky-400 font-semibold mt-1 block">
            {plan.limits.telemetryRetentionDays} Days Guaranteed
          </span>
        </div>
        <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/60">
          <span className="text-zinc-500 block text-[10px] uppercase">AI & Autonomous Ops</span>
          <span className="text-emerald-400 font-semibold mt-1 block">
            {plan.features.autonomousRemediation ? 'Remediations Enabled' : 'Diagnostic Only'}
          </span>
        </div>
      </div>

      {/* Confirmation Modal for Cancellation */}
      {showConfirmCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-4 font-sans">
            <h4 className="text-lg font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Cancel SkyOps Subscription?
            </h4>
            <p className="text-xs text-zinc-300 leading-relaxed font-mono">
              Your subscription will remain active until <strong>{renewalDate}</strong>. After this date, your workspace will revert to the Free tier limits (1 cluster, 5 nodes, 3-day retention).
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirmCancel(false)}
                disabled={canceling}
                className="font-mono text-xs"
              >
                Keep Subscription
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleCancelClick}
                disabled={canceling}
                className="font-mono text-xs bg-rose-600 hover:bg-rose-500"
              >
                {canceling ? 'Canceling...' : 'Confirm Cancellation'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
