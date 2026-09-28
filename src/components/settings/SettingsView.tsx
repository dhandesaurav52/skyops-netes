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
  Headphones,
  HeartPulse,
  Key,
  Layers,
  Lock,
  Play,
  RefreshCw,
  Save,
  Server,
  Shield,
  Users,
  Webhook,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Cluster, OrganizationSettings } from '../../types/index';
import { Button, CodeBlock, CopyButton } from '../common/UI';
import { NotificationsManager } from './NotificationsManager';
import { SupportManager } from './SupportManager';
import { SystemHealthManager } from './SystemHealthManager';
import { TeamManager } from './TeamManager';
import { UsageManager } from './UsageManager';
import { WebhooksManager } from './WebhooksManager';

interface SettingsViewProps {
  clusters: Cluster[];
  onSelectIncident?: (incidentId: string) => void;
  onRefresh: () => void;
}

type SettingsTab = 'org' | 'team' | 'support' | 'notifications' | 'webhooks' | 'usage' | 'system' | 'testbed';

export const SettingsView: React.FC<SettingsViewProps> = ({ clusters, onSelectIncident, onRefresh }) => {
  const { currentOrg, role, user } = useAuth();
  const safeClusters = Array.isArray(clusters) ? clusters : [];
  const [activeTab, setActiveTab] = useState<SettingsTab>('org');
  const [selectedClusterId, setSelectedClusterId] = useState<string>(safeClusters[0]?.id || '');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ success: boolean; message: string; incidentId?: string } | null>(null);

  // Org Settings Form state
  const isOwnerOrAdmin = role === 'OWNER' || role === 'ADMIN';
  const [orgName, setOrgName] = useState(currentOrg?.name || '');
  const [timezone, setTimezone] = useState(currentOrg?.settings?.general?.timezone || 'UTC');
  const [enforceMfa, setEnforceMfa] = useState(currentOrg?.settings?.security?.enforceMfa || false);
  const [sessionTimeout, setSessionTimeout] = useState(currentOrg?.settings?.security?.sessionTimeoutMinutes || 1440);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSuccessMsg, setOrgSuccessMsg] = useState<string | null>(null);
  const [orgError, setOrgError] = useState<string | null>(null);

  useEffect(() => {
    if (currentOrg) {
      setOrgName(currentOrg.name || '');
      setTimezone(currentOrg.settings?.general?.timezone || 'UTC');
      setEnforceMfa(currentOrg.settings?.security?.enforceMfa || false);
      setSessionTimeout(currentOrg.settings?.security?.sessionTimeoutMinutes || 1440);
    }
  }, [currentOrg]);

  useEffect(() => {
    if (!selectedClusterId && safeClusters.length > 0) {
      setSelectedClusterId(safeClusters[0].id);
    }
  }, [safeClusters, selectedClusterId]);

  const handleSaveOrgSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentOrg?.id || !isOwnerOrAdmin) return;

    try {
      setSavingOrg(true);
      setOrgError(null);
      await api.updateOrganization(currentOrg.id, {
        name: orgName.trim(),
        settings: {
          general: { name: orgName.trim(), timezone },
          security: { enforceMfa, sessionTimeoutMinutes: Number(sessionTimeout) }
        }
      });
      setOrgSuccessMsg('Organization profile and security policies saved.');
      setTimeout(() => setOrgSuccessMsg(null), 4000);
      onRefresh();
    } catch (err: any) {
      setOrgError(err.message || 'Failed to update organization settings');
    } finally {
      setSavingOrg(false);
    }
  };

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
            { id: 'org', label: 'Organization & Policies', icon: <Building2 className="w-3.5 h-3.5" /> },
            { id: 'team', label: 'Team Members & RBAC', icon: <Users className="w-3.5 h-3.5" /> },
            { id: 'support', label: 'Enterprise Helpdesk', icon: <Headphones className="w-3.5 h-3.5" /> },
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-3.5 h-3.5" /> },
            { id: 'webhooks', label: 'Webhooks & Integrations', icon: <Webhook className="w-3.5 h-3.5" /> },
            { id: 'usage', label: 'Subscription & Billing', icon: <CreditCard className="w-3.5 h-3.5" /> },
            { id: 'system', label: 'System Health Probes', icon: <HeartPulse className="w-3.5 h-3.5" /> },
            ...(import.meta.env.DEV
              ? [{ id: 'testbed', label: 'Failure QA Testbed', icon: <Zap className="w-3.5 h-3.5" /> }]
              : [])
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

      {/* Tab 1: Organization & Security Policies */}
      {activeTab === 'org' && (
        <div className="space-y-6">
          {orgSuccessMsg && (
            <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-lg text-emerald-300 text-xs font-mono flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{orgSuccessMsg}</span>
            </div>
          )}

          {orgError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{orgError}</span>
            </div>
          )}

          {/* Tenant Profile Summary */}
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

          {/* Organization Settings & Security Policy Form */}
          <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
              <div>
                <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
                  <Lock className="w-4 h-4 text-sky-400" />
                  Enterprise Configuration & Security Controls
                </h3>
                <p className="text-xs text-zinc-400 font-mono mt-1">
                  Adjust workspace metadata, session policies, and authentication requirements.
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveOrgSettings} className="space-y-4 font-mono text-xs max-w-2xl">
              <div>
                <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Organization Display Name</label>
                <input
                  type="text"
                  required
                  disabled={!isOwnerOrAdmin}
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Default Timezone</label>
                  <select
                    disabled={!isOwnerOrAdmin}
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  >
                    <option value="UTC">UTC (Universal Coordinated Time)</option>
                    <option value="America/New_York">America/New_York (EST/EDT)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
                    <option value="Europe/London">Europe/London (GMT/BST)</option>
                    <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Session Timeout (Minutes)</label>
                  <input
                    type="number"
                    min={15}
                    max={10080}
                    disabled={!isOwnerOrAdmin}
                    value={sessionTimeout}
                    onChange={(e) => setSessionTimeout(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!isOwnerOrAdmin}
                    checked={enforceMfa}
                    onChange={(e) => setEnforceMfa(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-950 text-sky-500 focus:ring-0 cursor-pointer disabled:opacity-60"
                  />
                  <span className="text-zinc-300 font-semibold text-xs">
                    Enforce Multi-Factor Authentication (MFA) for all workspace members
                  </span>
                </label>
                <p className="text-[11px] text-zinc-500 mt-1 pl-6">
                  When enabled, all users accessing this organization must satisfy enterprise 2FA verification.
                </p>
              </div>

              {isOwnerOrAdmin && (
                <div className="pt-3 border-t border-zinc-800/80">
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={savingOrg}
                    icon={<Save className="w-3.5 h-3.5" />}
                  >
                    {savingOrg ? 'Saving Settings...' : 'Save Configuration'}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Tab 2: Team Members & RBAC */}
      {activeTab === 'team' && <TeamManager />}

      {/* Tab 3: Enterprise Support & SLAs */}
      {activeTab === 'support' && <SupportManager clusters={safeClusters} />}

      {/* Tab: Incident Email Notifications */}
      {activeTab === 'notifications' && <NotificationsManager />}

      {/* Tab 4: Webhooks & Integrations */}
      {activeTab === 'webhooks' && <WebhooksManager />}

      {/* Tab 5: Usage & Quotas */}
      {activeTab === 'usage' && <UsageManager />}

      {/* Tab 6: Platform Self-Observability Probes */}
      {activeTab === 'system' && <SystemHealthManager />}

      {/* Tab 7: QA Scenario Testbed (Dev Only) */}
      {import.meta.env.DEV && activeTab === 'testbed' && (
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
                {safeClusters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
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
