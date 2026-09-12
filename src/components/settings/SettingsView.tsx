import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  CheckCircle2,
  Cpu,
  CreditCard,
  Flame,
  HardDrive,
  HeartPulse,
  Key,
  Layers,
  Play,
  RefreshCw,
  Server,
  Shield,
  Users,
  Webhook,
  Zap
} from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Cluster } from '../../types/index';
import { Button, CodeBlock, CopyButton } from '../common/UI';
import { NotificationsManager } from './NotificationsManager';
import { SystemHealthManager } from './SystemHealthManager';
import { UsageManager } from './UsageManager';
import { WebhooksManager } from './WebhooksManager';

interface SettingsViewProps {
  clusters: Cluster[];
  onSelectIncident?: (incidentId: string) => void;
  onRefresh: () => void;
}

type SettingsTab = 'org' | 'notifications' | 'webhooks' | 'usage' | 'system' | 'testbed';

export const SettingsView: React.FC<SettingsViewProps> = ({ clusters, onSelectIncident, onRefresh }) => {
  const { currentOrg, members, role, user } = useAuth();
  const [activeTab, setActiveTab] = useState<SettingsTab>('org');
  const [selectedClusterId, setSelectedClusterId] = useState<string>(clusters[0]?.id || '');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ success: boolean; message: string; incidentId?: string } | null>(null);

  const handleSimulate = async (
    scenario:
      | 'CrashLoopBackOff'
      | 'ImagePullBackOff'
      | 'OOMKilled'
      | 'NodeNotReady'
      | 'DeploymentDegraded'
      | 'PVCPending'
      | 'HighCPUPayments'
      | 'RecoverAll'
  ) => {
    if (!selectedClusterId) return;
    try {
      setSimulating(true);
      setSimResult(null);
      const res = await api.simulateScenario(selectedClusterId, scenario);
      setSimResult(res);
      onRefresh();
    } catch (err: any) {
      setSimResult({ success: false, message: err.message || 'Simulation failed' });
    } finally {
      setSimulating(false);
    }
  };

  const scenarios: Array<{
    id: 'CrashLoopBackOff' | 'ImagePullBackOff' | 'OOMKilled' | 'NodeNotReady' | 'DeploymentDegraded' | 'PVCPending' | 'HighCPUPayments';
    name: string;
    description: string;
    icon: React.ReactNode;
    severity: string;
  }> = [
    {
      id: 'HighCPUPayments',
      name: 'High CPU on payments-api',
      description: 'Simulates 99% CPU throttling exhaustion on payments-api container triggering incident email alerts.',
      icon: <Cpu className="w-4 h-4 text-amber-400" />,
      severity: 'HIGH'
    },
    {
      id: 'CrashLoopBackOff',
      name: 'Pod CrashLoopBackOff',
      description: 'Simulates container exit code 1 with rapid crash loops in payment-service pod.',
      icon: <Flame className="w-4 h-4 text-rose-400" />,
      severity: 'CRITICAL'
    },
    {
      id: 'ImagePullBackOff',
      name: 'Pod ImagePullBackOff',
      description: 'Simulates invalid image tag with err-image-pull failure in auth-worker.',
      icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      severity: 'HIGH'
    },
    {
      id: 'OOMKilled',
      name: 'Container OOMKilled',
      description: 'Simulates container exceeding memory limits with Linux SIGKILL 137.',
      icon: <Cpu className="w-4 h-4 text-rose-400" />,
      severity: 'CRITICAL'
    },
    {
      id: 'NodeNotReady',
      name: 'Node NotReady State',
      description: 'Simulates kubelet heartbeat timeout rendering worker node NotReady.',
      icon: <Server className="w-4 h-4 text-rose-400" />,
      severity: 'CRITICAL'
    },
    {
      id: 'DeploymentDegraded',
      name: 'Deployment Degraded',
      description: 'Simulates replica deficit where available replicas fall below spec.',
      icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
      severity: 'HIGH'
    },
    {
      id: 'PVCPending',
      name: 'PersistentVolumeClaim Pending',
      description: 'Simulates volume provisioning failure leaving PVC stuck in Pending.',
      icon: <HardDrive className="w-4 h-4 text-amber-400" />,
      severity: 'HIGH'
    }
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="border-b border-zinc-800/80 pb-5">
        <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5 font-mono">
          Enterprise Settings & Infrastructure Management
        </h1>
        <p className="text-xs font-mono text-zinc-400 mt-1">
          Tenant organization profile, RBAC members, outbound webhooks, usage quotas, and platform observability.
        </p>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 mt-5 border-b border-zinc-800 -mb-5 pb-px overflow-x-auto no-scrollbar">
          {[
            { id: 'org', label: 'Organization & Team', icon: <Building2 className="w-3.5 h-3.5" /> },
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-3.5 h-3.5" /> },
            { id: 'webhooks', label: 'Webhooks & Integrations', icon: <Webhook className="w-3.5 h-3.5" /> },
            { id: 'usage', label: 'Usage & Quotas', icon: <CreditCard className="w-3.5 h-3.5" /> },
            { id: 'system', label: 'System Health Probes', icon: <HeartPulse className="w-3.5 h-3.5" /> },
            { id: 'testbed', label: 'Failure QA Testbed', icon: <Zap className="w-3.5 h-3.5" /> }
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as SettingsTab)}
              className={`px-3.5 py-2 font-mono text-xs flex items-center gap-2 border-b-2 transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === t.id
                  ? 'border-sky-500 text-sky-400 font-semibold bg-sky-950/20 rounded-t'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tab 1: Organization & Team */}
      {activeTab === 'org' && (
        <div className="space-y-6">
          {/* Tenant Profile */}
          <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
              <Building2 className="w-4 h-4 text-sky-400" />
              Tenant Organization Profile
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs font-mono">
              <div className="p-3.5 bg-zinc-950 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block uppercase text-[10px]">Organization Name</span>
                <span className="text-zinc-200 font-semibold mt-1 block">{currentOrg?.name}</span>
              </div>

              <div className="p-3.5 bg-zinc-950 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block uppercase text-[10px]">Organization ID</span>
                <span className="text-zinc-200 font-semibold mt-1 block">{currentOrg?.id}</span>
              </div>

              <div className="p-3.5 bg-zinc-950 rounded-lg border border-zinc-800/80">
                <span className="text-zinc-500 block uppercase text-[10px]">Your Access Role</span>
                <span className="text-sky-400 font-bold mt-1 block">{role}</span>
              </div>
            </div>
          </div>

          {/* Team Members List */}
          <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-400" />
              Team Members & Access Roles ({members.length})
            </h3>

            <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {members.map((m) => (
                    <tr key={m.userId} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-3 font-semibold text-zinc-200">{m.name}</td>
                      <td className="px-4 py-3 text-zinc-400">{m.email}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px]">
                          {m.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> Active
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Incident Email Notifications */}
      {activeTab === 'notifications' && <NotificationsManager />}

      {/* Tab 2: Webhooks & Integrations */}
      {activeTab === 'webhooks' && <WebhooksManager />}

      {/* Tab 3: Usage & Quotas */}
      {activeTab === 'usage' && <UsageManager />}

      {/* Tab 4: Platform Self-Observability Probes */}
      {activeTab === 'system' && <SystemHealthManager />}

      {/* Tab 5: QA Scenario Testbed */}
      {activeTab === 'testbed' && (
        <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div>
              <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                Kubernetes Failure & Recovery QA Testbed
              </h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Simulate realistic Kubernetes operational failure conditions to verify deterministic incident detection, deduplication, and auto-recovery. (Strictly protected in production).
              </p>
            </div>

            <div className="flex items-center gap-2 font-mono text-xs">
              <span className="text-zinc-400">Target Cluster:</span>
              <select
                value={selectedClusterId}
                onChange={(e) => setSelectedClusterId(e.target.value)}
                className="px-3 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-200 focus:outline-none focus:border-sky-500 font-semibold"
              >
                {clusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {simResult && (
            <div
              className={`p-3.5 rounded-lg border text-xs font-mono flex items-center justify-between ${
                simResult.success
                  ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{simResult.message}</span>
              </div>
              {simResult.incidentId && onSelectIncident && (
                <button
                  onClick={() => onSelectIncident(simResult.incidentId!)}
                  className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-sky-400 rounded border border-zinc-700 cursor-pointer"
                >
                  Inspect Incident {simResult.incidentId} →
                </button>
              )}
            </div>
          )}

          {/* Scenarios Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scenarios.map((sc) => (
              <div
                key={sc.id}
                className="p-4 bg-zinc-950 border border-zinc-800/80 rounded-xl space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-xs text-zinc-200 font-mono">
                      {sc.icon}
                      {sc.name}
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                      {sc.severity}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug">{sc.description}</p>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  disabled={simulating || !selectedClusterId}
                  onClick={() => handleSimulate(sc.id)}
                  icon={<Play className="w-3 h-3 text-amber-400" />}
                  className="w-full text-xs font-mono"
                >
                  Trigger Failure
                </Button>
              </div>
            ))}
          </div>

          {/* Auto Recovery Action */}
          <div className="pt-2">
            <div className="p-4 bg-emerald-950/20 border border-emerald-900/40 rounded-xl flex items-center justify-between gap-4">
              <div>
                <h4 className="text-xs font-bold text-emerald-300 font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  Simulate Full Cluster Auto-Recovery
                </h4>
                <p className="text-[11px] text-emerald-400/80 font-mono mt-0.5">
                  Transitions all failing workloads back to Ready/Running state and verifies deterministic incident auto-resolution.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={simulating || !selectedClusterId}
                onClick={() => handleSimulate('RecoverAll')}
                className="text-emerald-300 border-emerald-800 hover:bg-emerald-900/40 font-mono text-xs shrink-0"
              >
                Simulate Auto-Recovery
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
