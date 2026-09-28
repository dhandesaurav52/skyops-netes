import React, { useState } from 'react';
import { Play, Sparkles, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { BillingInterval, PlanId, SubscriptionStatus } from '../../types/index';
import { Button } from '../common/UI';

interface BillingSimulatorProps {
  onSimulate: (state: string, planId?: PlanId, interval?: BillingInterval) => Promise<void>;
  loading?: boolean;
}

export const BillingSimulator: React.FC<BillingSimulatorProps> = ({ onSimulate, loading = false }) => {
  const [selectedState, setSelectedState] = useState<SubscriptionStatus>('ACTIVE');
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('PRO');
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>('MONTHLY');
  const [simulating, setSimulating] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleRun = async () => {
    try {
      setSimulating(true);
      setFeedback(null);
      await onSimulate(selectedState, selectedPlan, selectedInterval);
      setFeedback(`Successfully switched workspace state to ${selectedPlan} (${selectedState})`);
    } catch (err: any) {
      setFeedback(`Simulation error: ${err?.message || 'Failed'}`);
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="p-5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-4 font-mono text-xs">
      <div className="flex items-center justify-between">
        <h4 className="text-zinc-200 font-bold flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          Subscription & Entitlements QA Simulator
        </h4>
        <span className="text-[11px] text-zinc-500">Dev & Evaluation Controls</span>
      </div>
      <p className="text-[11px] text-zinc-400">
        Test instant workspace reactions to plan changes, trial expiry, cancellation notices, and past-due billing states.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="text-zinc-500 block text-[10px] uppercase mb-1">Target Plan</label>
          <select
            value={selectedPlan}
            onChange={(e) => setSelectedPlan(e.target.value as PlanId)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-sky-500 text-xs"
          >
            <option value="FREE">Free Tier (1 cluster, 5 nodes)</option>
            <option value="PRO">Pro Tier (3 clusters, 25 nodes)</option>
            <option value="BUSINESS">Business Tier (10 clusters, 100 nodes)</option>
          </select>
        </div>

        <div>
          <label className="text-zinc-500 block text-[10px] uppercase mb-1">Target State</label>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value as SubscriptionStatus)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-sky-500 text-xs"
          >
            <option value="ACTIVE">ACTIVE (Normal Active)</option>
            <option value="TRIALING">TRIALING (In 14-day Free Trial)</option>
            <option value="PAST_DUE">PAST_DUE (Payment Failed / Past Due)</option>
            <option value="CANCELED">CANCELED (Grace Period / Canceled)</option>
          </select>
        </div>

        <div>
          <label className="text-zinc-500 block text-[10px] uppercase mb-1">Billing Duration</label>
          <select
            value={selectedInterval}
            onChange={(e) => setSelectedInterval(e.target.value as BillingInterval)}
            className="w-full px-2.5 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-200 focus:outline-none focus:border-sky-500 text-xs"
          >
            <option value="MONTHLY">MONTHLY (1 Month)</option>
            <option value="QUARTERLY">QUARTERLY (3 Months - 10% Off)</option>
            <option value="HALF_YEARLY">HALF_YEARLY (6 Months - 15% Off)</option>
            <option value="YEARLY">YEARLY (12 Months - 25% Off)</option>
          </select>
        </div>
      </div>

      <div className="flex items-center justify-between pt-1">
        {feedback ? (
          <span className="text-[11px] text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> {feedback}
          </span>
        ) : (
          <span className="text-[11px] text-zinc-500">Updates subscription state in store immediately.</span>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleRun}
          disabled={simulating || loading}
          icon={simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          className="font-mono text-xs border-amber-600/60 text-amber-400 hover:bg-amber-950/20"
        >
          {simulating ? 'Simulating...' : 'Apply Simulation State'}
        </Button>
      </div>
    </div>
  );
};
