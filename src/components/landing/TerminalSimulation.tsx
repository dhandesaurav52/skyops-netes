import React, { useState } from 'react';
import { Check, Copy, Terminal as TerminalIcon } from 'lucide-react';

export const TerminalSimulation: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'helm' | 'kubectl' | 'terraform'>('helm');
  const [copied, setCopied] = useState(false);

  const commands = {
    helm: `# 1. Add the SkyOps Helm repository
helm repo add skyops https://charts.skyops.io
helm repo update

# 2. Deploy the read-only agent (UID 65532 non-root)
helm install skyops-agent skyops/skyops-agent \\
  --namespace skyops --create-namespace \\
  --set clusterName="production-gke-us" \\
  --set pairingToken="sky_live_8f3b29c1e4a70"`,
    kubectl: `# Apply the official SkyOps non-privileged DaemonSet
kubectl apply -f https://downloads.skyops.io/v1/agent.yaml

# Verify read-only RBAC binding (ClusterRole view only)
kubectl auth can-i create pods --as=system:serviceaccount:skyops:agent
# Output: no (zero write capabilities)`,
    terraform: `module "skyops_agent" {
  source       = "skyops/agent/kubernetes"
  version      = "~> 1.4.0"
  cluster_name = "production-gke-us"
  pairing_token = var.skyops_token
  read_only    = true
}`
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(commands[activeTab]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-zinc-950/95 shadow-2xl overflow-hidden font-mono electric-circuit-border">
      {/* Top terminal bar */}
      <div className="bg-zinc-900/90 px-4 py-3 border-b border-cyan-500/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-3 h-3 rounded-full bg-emerald-500/80 inline-block" />
          </div>
          <div className="h-4 w-px bg-zinc-800" />
          <div className="flex items-center gap-1 text-xs text-zinc-400">
            <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span>terminal — bash</span>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex items-center gap-1 bg-zinc-950/80 p-1 rounded-lg border border-zinc-800">
          {(['helm', 'kubectl', 'terraform'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                activeTab === tab
                  ? 'bg-zinc-800 text-cyan-300 font-semibold shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab === 'helm' ? 'Helm 3' : tab === 'kubectl' ? 'Kubectl' : 'Terraform'}
            </button>
          ))}
        </div>
      </div>

      {/* Code body */}
      <div className="p-5 text-xs text-zinc-300 relative group overflow-x-auto">
        <button
          onClick={handleCopy}
          className="absolute top-4 right-4 px-2.5 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700 text-zinc-300 text-[11px] flex items-center gap-1.5 transition-all cursor-pointer z-10"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              <span>Copy</span>
            </>
          )}
        </button>

        <pre className="text-zinc-300 leading-relaxed font-mono whitespace-pre selection:bg-cyan-500/30">
          {commands[activeTab]}
        </pre>
      </div>

      {/* Verification footer */}
      <div className="px-5 py-3 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between text-[11px] text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>Non-root UID 65532 · Read-only ClusterRole · Zero secrets stored</span>
        </div>
        <span className="text-zinc-600 hidden sm:inline">SHA256 Signed Helm Chart</span>
      </div>
    </div>
  );
};
