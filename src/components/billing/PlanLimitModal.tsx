import { AlertTriangle, ArrowRight, Layers, ShieldAlert, Sparkles, X } from 'lucide-react';
import React from 'react';
import { Button, Modal } from '../common/UI';

interface PlanLimitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeClick: () => void;
  resourceName?: string;
  current?: number;
  limit?: number;
  currentPlan?: string;
  customMessage?: string;
}

export const PlanLimitModal: React.FC<PlanLimitModalProps> = ({
  isOpen,
  onClose,
  onUpgradeClick,
  resourceName = 'resources',
  current,
  limit,
  currentPlan = 'Developer Free',
  customMessage
}) => {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Plan Limit Reached"
      maxWidth="max-w-lg"
    >
      <div className="space-y-5 font-mono">
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-950/30 border border-amber-800/60 text-amber-200 text-xs">
          <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-amber-300">
              Capacity Quota Reached for {resourceName.toUpperCase()}
            </div>
            <p className="text-zinc-300 leading-relaxed">
              {customMessage ||
                `Your organization has reached the maximum allowed limit of ${limit || 'allocated'} ${resourceName} on the ${currentPlan} plan.`}
            </p>
          </div>
        </div>

        {current !== undefined && limit !== undefined && (
          <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2 text-xs">
            <div className="flex items-center justify-between text-zinc-400">
              <span>Current Allocation:</span>
              <span className="font-bold text-zinc-200">
                {current} / {limit} {resourceName}
              </span>
            </div>
            <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden">
              <div className="bg-rose-500 h-full rounded-full w-full"></div>
            </div>
          </div>
        )}

        <p className="text-xs text-zinc-400 leading-relaxed">
          Upgrade your operational tier to expand cluster capacity, increase monitored node limits, unlock team seats, and access autonomous remediation features.
        </p>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-zinc-800">
          <Button variant="outline" size="sm" onClick={onClose}>
            Dismiss
          </Button>
          <Button
            variant="primary"
            size="sm"
            className="bg-sky-600 hover:bg-sky-500 text-white font-bold"
            onClick={() => {
              onClose();
              onUpgradeClick();
            }}
            icon={<Sparkles className="w-4 h-4" />}
          >
            Upgrade Plan
          </Button>
        </div>
      </div>
    </Modal>
  );
};
