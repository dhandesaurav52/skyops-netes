import React, { useEffect, useState } from 'react';
import {
  CreditCard,
  RefreshCw,
  Sparkles,
  Loader2,
  Database,
  Activity,
  FileText,
  ShieldAlert,
  Zap
} from 'lucide-react';
import { api } from '../../api/client';
import { OrgBillingOverview, PlanId, BillingInterval } from '../../types/index';
import { Button } from '../common/UI';
import { SubscriptionCard } from '../billing/SubscriptionCard';
import { QuotaProgress } from '../billing/QuotaProgress';
import { InvoicesTable } from '../billing/InvoicesTable';
import { PlanComparisonModal } from '../billing/PlanComparisonModal';
import { openRazorpayCheckout } from '../../utils/razorpay';

export const UsageManager: React.FC = () => {
  const [overview, setOverview] = useState<OrgBillingOverview | null>(null);
  const [rawUsage, setRawUsage] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [plansModalOpen, setPlansModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchOverview = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const [ovData, usageData] = await Promise.all([
        api.getSubscriptionOverview(),
        api.getOrgUsage().catch(() => null)
      ]);
      setOverview(ovData);
      if (usageData && usageData.usage) {
        setRawUsage(usageData.usage);
      }
    } catch (err: any) {
      console.error('Failed to load subscription overview:', err);
      setErrorMessage(err?.message || 'Failed to load organization subscription and usage data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleSelectPlan = async (planId: PlanId, interval: BillingInterval) => {
    try {
      setActionLoading(true);
      setErrorMessage(null);
      if (planId === 'FREE') {
        const res = await api.downgradePlan(planId, interval);
        setOverview(res.overview);
        return;
      }

      // Step 1: Create checkout session
      const checkout = await api.createCheckout(planId, interval);
      const session = checkout.session;

      // Step 2: If live Razorpay checkout is configured, trigger the Razorpay modal
      if (session && session.provider === 'razorpay' && session.keyId && (session.orderId || session.subscriptionId)) {
        try {
          const paymentResult = await openRazorpayCheckout({
            key: session.keyId,
            amount: session.amount ? Math.round(session.amount * 100) : (checkout.totalPrice ? Math.round(checkout.totalPrice * 100) : undefined),
            currency: session.currency || 'INR',
            name: 'SkyOps',
            description: `${checkout.planName || planId} Plan Subscription`,
            order_id: session.orderId,
            subscription_id: session.subscriptionId
          });

          // Step 3: Cryptographically verify and confirm with backend
          const confirmRes = await api.confirmCheckout(planId, interval, session.id, {
            razorpayOrderId: paymentResult.razorpay_order_id,
            razorpaySubscriptionId: paymentResult.razorpay_subscription_id,
            razorpayPaymentId: paymentResult.razorpay_payment_id,
            razorpaySignature: paymentResult.razorpay_signature
          });
          setOverview(confirmRes.overview);
        } catch (err: any) {
          if (err.message === 'PAYMENT_CANCELLED') {
            return; // User intentionally dismissed payment modal
          }
          throw err;
        }
      } else {
        // Direct sandbox / simulated confirmation
        const confirmRes = await api.confirmCheckout(planId, interval, session?.id);
        setOverview(confirmRes.overview);
      }
    } catch (err: any) {
      console.error('Subscription checkout error:', err);
      setErrorMessage(err?.message || 'Failed to complete subscription upgrade');
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    try {
      setActionLoading(true);
      const res = await api.cancelSubscription();
      setOverview(res.overview);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResumeSubscription = async () => {
    try {
      setActionLoading(true);
      const res = await api.resumeSubscription();
      setOverview(res.overview);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="p-16 text-center text-zinc-400 font-mono text-xs flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
        <span>Loading subscription status, quotas & telemetry metrics...</span>
      </div>
    );
  }

  if (errorMessage && !overview) {
    return (
      <div className="p-8 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 font-mono text-xs space-y-3">
        <div className="font-bold text-sm">Failed to Load Subscription Data</div>
        <p>{errorMessage}</p>
        <Button variant="outline" size="sm" onClick={fetchOverview} className="text-xs font-mono">
          Retry
        </Button>
      </div>
    );
  }

  const u = rawUsage || {
    period: new Date().toISOString().substring(0, 7),
    totalClusters: overview?.usage.clusters.current || 0,
    totalNodes: overview?.usage.nodes.current || 0,
    totalWorkloads: overview?.usage.workloads.current || 0,
    telemetryBatchesIngested: 0,
    telemetryResourcesIngested: 0,
    incidentsDetected: 0,
    incidentsResolved: 0,
    remediationsExecuted: overview?.usage.remediations.current || 0,
    aiAnalysesPerformed: overview?.usage.aiInvestigations.current || 0,
    auditEventsRecorded: 0
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-sky-400" />
            Tenant Subscription, Entitlements & Usage
          </h3>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            SaaS subscription lifecycle, billing intervals, quota limits, and real-time Kubernetes telemetry consumption.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOverview}
            disabled={loading || actionLoading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            className="font-mono text-xs"
          >
            Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setPlansModalOpen(true)}
            icon={<Sparkles className="w-3.5 h-3.5" />}
            className="font-mono text-xs bg-sky-600 hover:bg-sky-500"
          >
            View All Plans
          </Button>
        </div>
      </div>

      {/* 1. Subscription Overview Card */}
      {overview && (
        <SubscriptionCard
          overview={overview}
          onOpenPlans={() => setPlansModalOpen(true)}
          onCancel={handleCancelSubscription}
          onResume={handleResumeSubscription}
          loading={actionLoading}
        />
      )}

      {/* 2. Quota & Entitlements Progress */}
      {overview && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              Resource Quotas & Real-time Consumption
            </h4>
            <span className="text-[11px] font-mono text-zinc-500">
              Retention SLA: {overview.plan.limits.telemetryRetentionDays ?? overview.plan.limits.dataRetentionDays} Days
            </span>
          </div>

          <QuotaProgress overview={overview} onUpgrade={() => setPlansModalOpen(true)} />
        </div>
      )}

      {/* 3. Ingestion & Incident Telemetry Stats */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-2">
          <Database className="w-4 h-4 text-emerald-400" />
          Ingestion & Automated Remediation Metrics
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
                <Database className="w-4 h-4 text-emerald-400" /> Ingested Batches
              </span>
              <span className="text-zinc-100 font-bold">{u.telemetryBatchesIngested.toLocaleString()}</span>
            </div>
            <div className="text-[11px] text-zinc-500">
              {u.telemetryResourcesIngested.toLocaleString()} individual K8s resource snapshots processed.
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
                <ShieldAlert className="w-4 h-4 text-rose-400" /> Incidents Resolved
              </span>
              <span className="text-zinc-100 font-bold">
                {u.incidentsResolved} / {u.incidentsDetected}
              </span>
            </div>
            <div className="text-[11px] text-zinc-500">
              {u.incidentsDetected > 0
                ? `${Math.round((u.incidentsResolved / u.incidentsDetected) * 100)}% resolution rate`
                : 'Zero unresolved incident bottlenecks'}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
                <Zap className="w-4 h-4 text-cyan-400" /> AI Remediations
              </span>
              <span className="text-zinc-100 font-bold">{u.remediationsExecuted} Executed</span>
            </div>
            <div className="text-[11px] text-zinc-500">
              {u.aiAnalysesPerformed} Gemini RCA diagnostics completed this cycle.
            </div>
          </div>
        </div>
      </div>

      {/* 4. Invoices & Billing History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-2">
            <FileText className="w-4 h-4 text-sky-400" />
            Invoices & Payment Receipts
          </h4>
          <span className="text-[11px] font-mono text-zinc-500">
            {overview?.invoices?.length || 0} Invoices on Record
          </span>
        </div>

        <InvoicesTable invoices={overview?.invoices || []} loading={loading} />
      </div>

      {/* Plans & Pricing Modal */}
      {overview && (
        <PlanComparisonModal
          isOpen={plansModalOpen}
          onClose={() => setPlansModalOpen(false)}
          currentPlanId={overview.subscription.planId}
          currentInterval={overview.subscription.billingInterval}
          onSelectPlan={handleSelectPlan}
          loading={actionLoading}
        />
      )}
    </div>
  );
};
