import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Cpu,
  KeyRound,
  Loader2,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AgentManifestsResponse, Cluster } from '../../types/index';
import { Button, Modal } from '../common/UI';
import { PlanComparisonModal } from '../billing/PlanComparisonModal';

interface AddClusterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClusterCreated: (cluster: Cluster) => void;
  onOpenCluster?: (clusterId: string) => void;
}

type WizardStep = 1 | 2 | 3 | 4;

export const AddClusterModal: React.FC<AddClusterModalProps> = ({
  isOpen,
  onClose,
  onClusterCreated,
  onOpenCluster
}) => {
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [clusterName, setClusterName] = useState('');
  const [environmentType, setEnvironmentType] = useState<'Production' | 'Staging' | 'Development'>('Production');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [createdCluster, setCreatedCluster] = useState<Cluster | null>(null);
  const [manifestData, setManifestData] = useState<AgentManifestsResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [logCommandCopied, setLogCommandCopied] = useState(false);

  // Step 3 Activation Code & Handshake State
  const [activationCode, setActivationCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [agentPulseDetected, setAgentPulseDetected] = useState(false);
  const [timeRemainingSeconds, setTimeRemainingSeconds] = useState(900); // 15 minutes

  // Step 1: Create pending cluster in backend
  const handleCreateCluster = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clusterName.trim()) return;

    try {
      setLoading(true);
      setError(null);
      setIsQuotaError(false);
      const desc = description.trim() || `Environment: ${environmentType}`;
      const res = await api.createCluster(clusterName.trim(), desc);
      setCreatedCluster(res.cluster);
      onClusterCreated(res.cluster);

      // Fetch the single-command install manifest
      const manifests = await api.getClusterManifests(res.cluster.id);
      setManifestData(manifests);

      setCurrentStep(2);
    } catch (err: any) {
      const isQuota =
        err?.code === 'PLAN_LIMIT_REACHED' ||
        err?.status === 403 ||
        (err?.message && /quota|plan limit|exceeded|maximum/i.test(err.message));
      setIsQuotaError(Boolean(isQuota));
      setError(err.message || 'Failed to initialize cluster creation.');
    } finally {
      setLoading(false);
    }
  };

  // Copy command helper
  const handleCopyCommand = async (textToCopy?: string) => {
    const text = textToCopy || manifestData?.oneCommandInstall || manifestData?.installCommand;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Copy log command helper
  const handleCopyLogCommand = async () => {
    try {
      await navigator.clipboard.writeText(
        'kubectl logs -n skyops-system -l app.kubernetes.io/name=skyops-agent --tail=30 -f'
      );
      setLogCommandCopied(true);
      setTimeout(() => setLogCommandCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // 15-minute countdown for activation code validity
  useEffect(() => {
    if (!isOpen || (currentStep !== 2 && currentStep !== 3) || verifySuccess) return;

    const timer = setInterval(() => {
      setTimeRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [isOpen, currentStep, verifySuccess]);

  // Background poller on Step 2 & 3 to detect agent registration & heartbeat automatically
  useEffect(() => {
    if (!isOpen || !createdCluster?.id || verifySuccess) return;

    const poller = setInterval(async () => {
      try {
        const cluster = await api.getCluster(createdCluster.id);
        if (cluster.agentStatus === 'CONNECTED' || cluster.connectionState === 'connected') {
          setVerifySuccess(true);
          setAgentPulseDetected(true);
          setCreatedCluster(cluster);
          onClusterCreated(cluster);
        } else if (cluster.agentDetectedAt || cluster.lastHeartbeat) {
          setAgentPulseDetected(true);
          setCreatedCluster(cluster);
        }
      } catch {
        // Non-fatal polling error
      }
    }, 2000);

    return () => clearInterval(poller);
  }, [isOpen, createdCluster?.id, verifySuccess, onClusterCreated]);

  // Handle human-entered activation code validation
  const handleVerifyActivation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!createdCluster?.id || !activationCode.trim()) return;

    try {
      setVerifying(true);
      setError(null);
      const res = await api.connectCluster(createdCluster.id, activationCode.trim());
      setVerifySuccess(true);
      setAgentPulseDetected(true);
      setCreatedCluster(res.cluster);
      onClusterCreated(res.cluster);
      setCurrentStep(4);
    } catch (err: any) {
      setError(err.message || 'That activation code is incorrect or expired.');
    } finally {
      setVerifying(false);
    }
  };

  const handleResetAndClose = () => {
    setCurrentStep(1);
    setClusterName('');
    setDescription('');
    setCreatedCluster(null);
    setManifestData(null);
    setActivationCode('');
    setVerifying(false);
    setVerifySuccess(false);
    setAgentPulseDetected(false);
    setError(null);
    onClose();
  };

  const handleOpenCluster = () => {
    if (createdCluster && onOpenCluster) {
      onOpenCluster(createdCluster.id);
    }
    handleResetAndClose();
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleResetAndClose}
      title={
        currentStep === 1
          ? 'Connect Cluster'
          : currentStep === 2
          ? 'Install Agent'
          : currentStep === 3
          ? 'Cluster Handshake'
          : 'Cluster Connected'
      }
      maxWidth={currentStep === 1 ? 'md' : 'xl'}
    >
      <div className="space-y-6">
        {/* Step Progress Tracker */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          {[
            { step: 1, label: 'Create Cluster' },
            { step: 2, label: 'Install Agent' },
            { step: 3, label: 'Handshake' },
            { step: 4, label: 'Connected' }
          ].map((item, idx) => {
            const isCompleted = currentStep > item.step || (item.step === 4 && verifySuccess);
            const isCurrent = currentStep === item.step;
            return (
              <div key={item.step} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold transition-all ${
                    isCompleted
                      ? 'bg-emerald-500 text-zinc-950'
                      : isCurrent
                      ? 'bg-sky-500 text-zinc-950 ring-4 ring-sky-950'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {isCompleted ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : item.step}
                </div>
                <span
                  className={`text-xs font-mono hidden sm:inline ${
                    isCurrent ? 'text-zinc-100 font-semibold' : 'text-zinc-500'
                  }`}
                >
                  {item.label}
                </span>
                {idx < 3 && <div className="w-4 sm:w-8 h-[1px] bg-zinc-800 ml-1" />}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="p-3.5 text-xs rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 font-mono flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
            {isQuotaError && (
              <Button
                variant="primary"
                size="sm"
                className="bg-sky-600 hover:bg-sky-500 text-white shrink-0 font-bold"
                onClick={() => setShowPlanModal(true)}
                icon={<Sparkles className="w-3.5 h-3.5" />}
              >
                Upgrade Plan
              </Button>
            )}
          </div>
        )}

        {/* =======================================================
            1. CREATE CLUSTER
           ======================================================= */}
        {currentStep === 1 && (
          <form onSubmit={handleCreateCluster} className="space-y-4">
            <div>
              <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                Cluster Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Production EKS"
                value={clusterName}
                onChange={(e) => setClusterName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                Environment <span className="text-rose-400">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['Production', 'Staging', 'Development'] as const).map((env) => (
                  <button
                    key={env}
                    type="button"
                    onClick={() => setEnvironmentType(env)}
                    className={`py-2 px-3 text-xs font-mono rounded-lg border text-center transition-all ${
                      environmentType === env
                        ? 'border-sky-500 bg-sky-950/40 text-sky-300 font-semibold'
                        : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {env}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono font-medium text-zinc-300 mb-1.5">
                Description (Optional)
              </label>
              <textarea
                rows={2}
                placeholder="Primary workload cluster hosting mission-critical services"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button variant="ghost" onClick={handleResetAndClose} type="button">
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={loading || !clusterName.trim()}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                Create Cluster
              </Button>
            </div>
          </form>
        )}

        {/* =======================================================
            2. INSTALL AGENT (Multi-Method Tabs)
           ======================================================= */}
        {currentStep === 2 && createdCluster && manifestData && (
          <div className="space-y-6">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-100">
                Install SkyOps Agent into {createdCluster.name}
              </h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Run the command below in your cluster terminal. The agent runs in namespace{' '}
                <code className="text-sky-300 bg-zinc-900 px-1 py-0.5 rounded">skyops-system</code> with least-privilege
                read-only permissions.
              </p>
            </div>

            {/* Command Display */}
            <div className="space-y-2">
              <div className="relative group bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-200 break-all leading-relaxed shadow-inner">
                <div className="pr-20 text-sky-300 select-all font-medium">
                  {manifestData.oneCommandInstall || manifestData.installCommand}
                </div>
                <div className="absolute right-3 top-3">
                  <button
                    type="button"
                    onClick={() => handleCopyCommand(manifestData.oneCommandInstall || manifestData.installCommand)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all ${
                      copied
                        ? 'bg-emerald-500 text-zinc-950'
                        : 'bg-sky-500 hover:bg-sky-400 text-zinc-950 shadow-sm'
                    }`}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-[11px] font-mono text-zinc-500">
                Performs preflight checks for kubectl, validates cluster reachability, creates namespace{' '}
                <code className="text-zinc-400">skyops-system</code>, applies secrets and deployment, and waits for
                rollout.
              </p>
            </div>

            {/* Security checklist */}
            <div className="p-3.5 bg-zinc-900/40 border border-zinc-800/70 rounded-xl space-y-2">
              <h3 className="text-xs font-mono font-semibold text-emerald-400 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4" />
                Security & RBAC Guarantees
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] font-mono text-zinc-400">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  Read-only ClusterRole (get, list, watch)
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  Isolated in namespace skyops-system
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  Outbound-only HTTPS telemetry stream
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  Dedicated per-cluster authentication token
                </div>
              </div>
            </div>

            {/* Step 2 Action Buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
              <Button variant="ghost" onClick={() => setCurrentStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back
              </Button>
              <Button variant="primary" onClick={() => setCurrentStep(3)}>
                Next: Check Connection Status
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* =======================================================
            3. VERIFY ACTIVATION (Auto Detection + Handshake)
           ======================================================= */}
        {currentStep === 3 && createdCluster && (
          <div className="space-y-5">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-100">Cluster Handshake & Status</h2>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {verifySuccess || createdCluster.agentStatus === 'CONNECTED'
                  ? 'SkyOps Agent is connected and actively streaming live Kubernetes telemetry.'
                  : agentPulseDetected
                  ? 'Agent pulse detected! Finalizing initial handshake...'
                  : 'Waiting for the SkyOps Agent pod to start in your cluster and establish its connection.'}
              </p>
            </div>

            {/* Status Pulse Banner */}
            <div
              className={`p-4 rounded-xl border font-mono text-xs flex items-center justify-between transition-all ${
                verifySuccess || createdCluster.agentStatus === 'CONNECTED'
                  ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
                  : agentPulseDetected
                  ? 'bg-sky-950/40 border-sky-800/80 text-sky-300'
                  : 'bg-zinc-950/80 border-zinc-800 text-zinc-300'
              }`}
            >
              <div className="flex items-center gap-3">
                {verifySuccess || createdCluster.agentStatus === 'CONNECTED' ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-emerald-400 animate-ping shrink-0" />
                    <div>
                      <div className="font-semibold text-emerald-200">Agent Connected & Verified</div>
                      <div className="text-[11px] text-emerald-400/80">
                        K8s {createdCluster.k8sVersion || 'v1.30+'} · {createdCluster.nodeCount} Nodes ·{' '}
                        {createdCluster.podCount} Pods
                      </div>
                    </div>
                  </>
                ) : agentPulseDetected ? (
                  <>
                    <div className="w-3 h-3 rounded-full bg-sky-400 animate-ping shrink-0" />
                    <div>
                      <div className="font-semibold text-sky-200">Agent Initial Contact Detected</div>
                      <div className="text-[11px] text-sky-400/80">
                        Ingesting cluster topology & telemetry stream...
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                    <div>
                      <div className="font-medium text-zinc-200">Listening for Agent Telemetry</div>
                      <div className="text-[11px] text-zinc-500">Run the install command in your cluster CLI</div>
                    </div>
                  </>
                )}
              </div>
              <div className="text-amber-400 text-[11px] flex items-center gap-1 font-mono shrink-0">
                <Clock className="w-3.5 h-3.5" />
                Session: {formatCountdown(timeRemainingSeconds)}
              </div>
            </div>

            {/* Diagnostic / Logs command helper */}
            <div className="p-3.5 bg-zinc-950/90 border border-zinc-800/90 rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-xs font-semibold text-zinc-200 font-mono">Stream Agent Pod Logs</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyLogCommand}
                  className={`px-2.5 py-1 text-xs font-mono rounded-lg border flex items-center gap-1.5 transition-all font-medium ${
                    logCommandCopied
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300'
                  }`}
                >
                  {logCommandCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{logCommandCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="font-mono text-xs text-sky-300 bg-zinc-900/90 border border-zinc-800/70 px-3 py-2 rounded-lg select-all">
                <code>kubectl logs -n skyops-system -l app.kubernetes.io/name=skyops-agent --tail=30 -f</code>
              </div>
            </div>

            {/* Optional Manual Activation Code entry if desired */}
            {!verifySuccess && createdCluster.agentStatus !== 'CONNECTED' && (
              <form onSubmit={handleVerifyActivation} className="p-4 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-medium text-zinc-300 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-zinc-400" />
                    Manual Connection Key (Optional)
                  </label>
                  {manifestData?.connectionCode && (
                    <span className="text-[10px] font-mono text-zinc-500">
                      Expected Key: <span className="text-sky-400 font-bold">{manifestData.connectionCode}</span>
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="SKYOPS-XXXX-XXXX"
                    value={activationCode}
                    onChange={(e) => setActivationCode(e.target.value)}
                    className="flex-1 px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono uppercase tracking-wider"
                  />
                  <Button variant="primary" type="submit" disabled={verifying || !activationCode.trim()}>
                    {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirm'}
                  </Button>
                </div>
              </form>
            )}

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
              <Button variant="ghost" onClick={() => setCurrentStep(2)} type="button">
                <ArrowLeft className="w-4 h-4 mr-1.5" />
                Back to Install Command
              </Button>
              <Button variant="primary" type="button" onClick={() => setCurrentStep(4)}>
                Proceed to Overview
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        )}

        {/* =======================================================
            4. CONNECTED SCREEN (Clean Summary)
           ======================================================= */}
        {currentStep === 4 && createdCluster && (
          <div className="space-y-5 text-center py-2">
            <div className="w-14 h-14 rounded-full bg-emerald-950 border border-emerald-800 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-950/40">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-zinc-100 flex items-center justify-center gap-2">
                <Check className="w-5 h-5 text-emerald-400 stroke-[3]" />
                Cluster Successfully Connected
              </h2>
              <p className="text-sm font-semibold text-sky-400 font-mono">{createdCluster.name}</p>
            </div>

            {/* Connected Cluster Telemetry Grid */}
            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono text-left">
              <div>
                <div className="text-zinc-500">Agent Status</div>
                <div className="text-emerald-400 font-semibold flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  ONLINE
                </div>
              </div>

              <div>
                <div className="text-zinc-500">Kubernetes</div>
                <div className="text-zinc-200 font-semibold mt-0.5">{createdCluster.k8sVersion || 'v1.30+'}</div>
              </div>

              <div>
                <div className="text-zinc-500">Nodes</div>
                <div className="text-zinc-200 font-semibold mt-0.5">{createdCluster.nodeCount ?? 0}</div>
              </div>

              <div>
                <div className="text-zinc-500">Pods</div>
                <div className="text-zinc-200 font-semibold mt-0.5">{createdCluster.podCount ?? 0}</div>
              </div>
            </div>

            <div className="pt-2">
              <Button
                variant="primary"
                onClick={handleOpenCluster}
                className="w-full justify-center py-2.5 text-sm font-mono font-semibold"
              >
                Open Cluster Dashboard
              </Button>
            </div>
          </div>
        )}

        <PlanComparisonModal
          isOpen={showPlanModal}
          onClose={() => setShowPlanModal(false)}
          onPlanChanged={() => {
            setError(null);
            setIsQuotaError(false);
          }}
        />
      </div>
    </Modal>
  );
};
