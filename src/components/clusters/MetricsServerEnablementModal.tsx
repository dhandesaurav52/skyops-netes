import React, { useState, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Info,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Terminal,
  X
} from 'lucide-react';
import { api } from '../../api/client';
import { MetricsServerStatus } from '../../types/index';

interface MetricsServerEnablementModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  clusterName: string;
  onVerified?: () => void;
}

export const MetricsServerEnablementModal: React.FC<MetricsServerEnablementModalProps> = ({
  isOpen,
  onClose,
  clusterId,
  clusterName,
  onVerified
}) => {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<MetricsServerStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string } | null>(null);
  const [installMethod, setInstallMethod] = useState<'manifest' | 'helm'>('manifest');
  const [useInsecureTls, setUseInsecureTls] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && clusterId) {
      loadStatus();
    } else {
      setStatus(null);
      setVerifyResult(null);
      setError(null);
    }
  }, [isOpen, clusterId]);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMetricsServerStatus(clusterId);
      setStatus(data);
      if (data?.status === 'INSTALLED_NOT_READY' || (data?.verification?.deploymentFound && !data?.verification?.deploymentReady)) {
        setUseInsecureTls(true);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to inspect Metrics Server status');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.verifyMetricsServer(clusterId);
      setStatus(res.status);
      setVerifyResult({
        success: res.success,
        message: res.message
      });
      if (res.success && onVerified) {
        onVerified();
      }
    } catch (err: any) {
      setVerifyResult({
        success: false,
        message: err?.message || 'Verification request failed'
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  if (!isOpen) return null;

  const currentCommand =
    installMethod === 'manifest'
      ? useInsecureTls
        ? status?.commands.kubectlInsecureTls || 'kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml'
        : status?.commands.kubectl || 'kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml'
      : useInsecureTls
      ? status?.commands.helmInsecureTls || 'helm upgrade --install metrics-server metrics-server/metrics-server -n kube-system --set "args={--kubelet-insecure-tls}"'
      : status?.commands.helm || 'helm upgrade --install metrics-server metrics-server/metrics-server -n kube-system';

  const getStatusBadge = (st?: string) => {
    switch (st) {
      case 'READY_WITH_METRICS':
      case 'ACTIVE':
        return {
          bg: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300',
          label: 'Ready & Scraping Metrics',
          dot: 'bg-emerald-400'
        };
      case 'READY_NO_METRICS':
      case 'INSTALLED_NOT_REPORTING':
        return {
          bg: 'bg-blue-500/10 border-blue-500/20 text-blue-300',
          label: 'Pod Ready — Scraping In Progress',
          dot: 'bg-blue-400'
        };
      case 'INSTALLED_NOT_READY':
        return {
          bg: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
          label: 'Deployment Installed — Pod Not Ready',
          dot: 'bg-amber-400'
        };
      case 'PERMISSION_DENIED':
        return {
          bg: 'bg-rose-500/10 border-rose-500/20 text-rose-300',
          label: 'RBAC Permission Denied (metrics.k8s.io)',
          dot: 'bg-rose-400'
        };
      case 'API_UNAVAILABLE':
        return {
          bg: 'bg-rose-500/10 border-rose-500/20 text-rose-300',
          label: 'metrics.k8s.io API Unavailable',
          dot: 'bg-rose-400'
        };
      case 'TIMEOUT':
        return {
          bg: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
          label: 'Verification Timed Out',
          dot: 'bg-amber-400'
        };
      case 'UNKNOWN':
        return {
          bg: 'bg-zinc-800 border-zinc-700 text-zinc-300',
          label: 'Unknown / Agent Offline',
          dot: 'bg-zinc-500'
        };
      case 'NOT_INSTALLED':
      default:
        return {
          bg: 'bg-zinc-900 border-zinc-800 text-zinc-400',
          label: 'Not Installed (Optional)',
          dot: 'bg-zinc-500'
        };
    }
  };

  const statusBadge = getStatusBadge(status?.status);

  return (
    <div
      id="metrics-server-enablement-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="metrics-server-enablement-modal"
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden my-8"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-zinc-100">Enable Kubernetes Metrics Server</h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
                  {clusterName}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Explicit, user-guided enablement for real-time CPU and memory telemetry
              </p>
            </div>
          </div>
          <button
            id="close-metrics-server-modal-btn"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[calc(85vh-120px)] overflow-y-auto">
          {/* Policy & Safety Notice */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex gap-3 text-xs text-amber-200/90">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300 block mb-1">Explicit Consent Policy</span>
              SkyOps will never silently install packages or alter cluster workloads without your explicit direction.
              Metrics Server is an optional, lightweight cluster add-on that enables pod/node usage metrics (`metrics.k8s.io`).
            </div>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 space-y-3">
              <Loader2 className="w-8 h-8 text-sky-400 animate-spin" />
              <div className="text-xs text-zinc-400">Checking cluster pre-flight conditions...</div>
            </div>
          ) : error ? (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 text-xs text-rose-300 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          ) : (
            <>
              {/* Pre-Flight Status Checklist */}
              <div className="bg-zinc-950/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Pre-Flight Readiness</span>
                  <span className="font-mono text-[11px] text-zinc-500">
                    Kubernetes {status?.clusterVersion || 'v1.31.0'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="flex items-center gap-2.5 p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
                    {status?.preflight.connected ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-medium text-zinc-200">Agent Connected</div>
                      <div className="text-[10px] text-zinc-500">
                        {status?.preflight.connected ? 'Active heartbeat' : 'Agent offline'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
                    {status?.preflight.versionCompatible ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-medium text-zinc-200">K8s Compatible</div>
                      <div className="text-[10px] text-zinc-500">
                        {status?.preflight.versionCompatible ? '>= v1.21 verified' : 'Upgrade recommended'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 p-2.5 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
                    {status?.preflight.rbacReady ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <div>
                      <div className="font-medium text-zinc-200">RBAC Permissions</div>
                      <div className="text-[10px] text-zinc-500">ClusterRole configured</div>
                    </div>
                  </div>
                </div>

                {/* Current Metrics Server State Banner */}
                <div
                  className={`p-3.5 rounded-lg border flex items-center justify-between text-xs ${statusBadge.bg}`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${statusBadge.dot}`} />
                    <Server className="w-4 h-4 shrink-0" />
                    <span>
                      Current Status:{' '}
                      <strong className="text-zinc-100 font-semibold">
                        {statusBadge.label}
                      </strong>
                    </span>
                  </div>
                  <button
                    onClick={loadStatus}
                    className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh
                  </button>
                </div>

                {/* Verification Evidence (Live Agent/K8s Observation) */}
                {status?.verification && (
                  <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/90 text-xs space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                      <span className="flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                        Verification Evidence
                      </span>
                      {status.verification.verifiedAt && (
                        <span className="font-mono text-[10px] text-zinc-500 font-normal">
                          {new Date(status.verification.verifiedAt).toLocaleTimeString()}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Deployment</div>
                        <div className="font-medium text-zinc-200 truncate">
                          {status.verification.deploymentFound
                            ? `${status.verification.readyReplicas || 0}/${status.verification.expectedReplicas || 1} Ready`
                            : 'Not Found'}
                        </div>
                      </div>

                      <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Pod Status</div>
                        <div className="font-medium text-zinc-200 truncate">
                          {status.verification.podReady
                            ? 'Ready'
                            : status.verification.podPhase || (status.verification.deploymentFound ? 'Not Ready' : 'None')}
                        </div>
                      </div>

                      <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">API Endpoint</div>
                        <div className="font-medium text-zinc-200 truncate">
                          {status.verification.apiReachable ? 'Reachable' : 'Unreachable'}
                        </div>
                      </div>

                      <div className="p-2 bg-zinc-950/60 rounded border border-zinc-800">
                        <div className="text-zinc-500 text-[10px]">Metrics Scraped</div>
                        <div className="font-medium text-zinc-200 truncate">
                          {status.verification.nodeMetricsAvailable || status.verification.podMetricsAvailable
                            ? `${status.verification.nodeMetricsCount || 0} nodes / ${status.verification.podMetricsCount || 0} pods`
                            : 'None'}
                        </div>
                      </div>
                    </div>

                    {/* Structured Diagnosis */}
                    {(status.verification.whatHappened || status.verification.why) && (
                      <div className="mt-2 p-2.5 bg-zinc-950/80 rounded border border-zinc-800/80 space-y-1.5 text-[11px]">
                        {status.verification.whatHappened && (
                          <div>
                            <span className="text-zinc-400 font-medium">What happened: </span>
                            <span className="text-zinc-200">{status.verification.whatHappened}</span>
                          </div>
                        )}
                        {status.verification.why && (
                          <div>
                            <span className="text-zinc-400 font-medium">Why: </span>
                            <span className="text-zinc-300">{status.verification.why}</span>
                          </div>
                        )}
                        {status.verification.impact && (
                          <div>
                            <span className="text-zinc-400 font-medium">Impact: </span>
                            <span className="text-amber-300/90">{status.verification.impact}</span>
                          </div>
                        )}
                        {status.verification.nextAction && (
                          <div>
                            <span className="text-zinc-400 font-medium">Next action: </span>
                            <span className="text-sky-300">{status.verification.nextAction}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Guided Installation Steps */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
                    Deployment Command
                  </div>
                  <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[11px]">
                    <button
                      onClick={() => setInstallMethod('manifest')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        installMethod === 'manifest'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      kubectl
                    </button>
                    <button
                      onClick={() => setInstallMethod('helm')}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        installMethod === 'helm'
                          ? 'bg-sky-500/20 text-sky-300'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      Helm 3
                    </button>
                  </div>
                </div>

                {/* Insecure TLS checkbox for dev clusters (Kind, Minikube, KillerCoda) */}
                <div className="flex items-center gap-2 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-300">
                    <input
                      type="checkbox"
                      checked={useInsecureTls}
                      onChange={(e) => setUseInsecureTls(e.target.checked)}
                      className="rounded border-zinc-700 bg-zinc-800 text-sky-500 focus:ring-sky-500/30"
                    />
                    <span>Local or Development Cluster (KillerCoda / Kind / Minikube)</span>
                  </label>
                  <span className="text-[10px] text-zinc-500">
                    (Applies <code className="text-zinc-400">--kubelet-insecure-tls</code> patch)
                  </span>
                </div>

                {/* Quick Patch helper when already deployed but 0/1 Ready */}
                {status?.verification?.deploymentFound && !status?.verification?.deploymentReady && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-lg space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                        Fix Existing Deployment (0/1 Ready)
                      </span>
                      <button
                        onClick={() =>
                          handleCopy(
                            `kubectl patch deployment metrics-server -n kube-system --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'`,
                            'patch-cmd'
                          )
                        }
                        className="px-2 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-medium rounded transition-colors flex items-center gap-1"
                      >
                        {copiedKey === 'patch-cmd' ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy Quick Patch</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-400">
                      In KillerCoda/dev clusters, Kubelet certificates are self-signed. Run this patch in your terminal to enable <code className="text-zinc-300">--kubelet-insecure-tls</code> without reinstalling:
                    </p>
                    <pre className="font-mono text-[11px] text-zinc-300 bg-zinc-950 p-2 rounded border border-zinc-800 overflow-x-auto whitespace-pre-wrap">
                      {`kubectl patch deployment metrics-server -n kube-system --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'`}
                    </pre>
                  </div>
                )}

                {/* Command Snippet */}
                <div className="relative group bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-200 overflow-x-auto">
                  <pre className="whitespace-pre-wrap leading-relaxed pr-16">{currentCommand}</pre>
                  <button
                    id="copy-metrics-server-cmd-btn"
                    onClick={() => handleCopy(currentCommand, 'cmd')}
                    className="absolute top-3 right-3 p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-zinc-100 transition-colors flex items-center gap-1.5 text-xs shadow-sm"
                  >
                    {copiedKey === 'cmd' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 text-[11px]">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="text-[11px]">Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Diagnostic Advice */}
              {status?.diagnostics && status.diagnostics.length > 0 && (
                <div className="bg-zinc-950/40 border border-zinc-800/80 rounded-xl p-4 space-y-2 text-xs">
                  <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Info className="w-3.5 h-3.5 text-sky-400" />
                    Cluster Advisory & Diagnostics
                  </div>
                  <ul className="space-y-1 text-zinc-400 list-disc list-inside">
                    {status.diagnostics.map((diag, idx) => (
                      <li key={idx} className="leading-relaxed">
                        {diag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Verification Feedback Banner */}
              {verifyResult && (
                <div
                  className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
                    verifyResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                      : 'bg-amber-500/10 border-amber-500/20 text-amber-200'
                  }`}
                >
                  {verifyResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <span className="font-semibold block mb-0.5">
                      {verifyResult.success ? 'Verification Succeeded' : 'Verification Update'}
                    </span>
                    <span>{verifyResult.message}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 bg-zinc-900/80">
          <div className="text-xs text-zinc-500">
            Official Kubernetes Metrics Server:{' '}
            <a
              href="https://github.com/kubernetes-sigs/metrics-server"
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 hover:underline inline-flex items-center gap-1"
            >
              Docs <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="close-metrics-server-footer-btn"
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Done
            </button>
            <button
              id="verify-metrics-server-btn"
              type="button"
              onClick={handleVerify}
              disabled={verifying || loading}
              className="px-4 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-xl transition-all shadow-sm flex items-center gap-2"
            >
              {verifying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <Terminal className="w-3.5 h-3.5" />
                  Verify Installation
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
