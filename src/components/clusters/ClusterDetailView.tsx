import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Database,
  KeyRound,
  Layers,
  ListTree,
  Loader2,
  Radio,
  RefreshCw,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Trash2,
  TrendingUp,
  Unplug,
  Zap
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AGENT_DEFAULT_NAMESPACE, AGENT_IMAGE_REPOSITORY, AGENT_VERSION } from '../../config/version';
import { useAuth } from '../../context/AuthContext';
import { AgentManifestsResponse, Cluster, Incident, KubernetesResource } from '../../types/index';
import { ClusterStatusBadge, PodPhaseBadge, ResourceHealthBadge, SeverityBadge, StatusBadge, WorkloadKindBadge } from '../common/Badges';
import { Button, CodeBlock, CopyButton, EmptyState, LoadingState, Modal } from '../common/UI';
import { PodDetailModal } from '../resources/PodDetailModal';
import { WorkloadDetailModal } from '../resources/WorkloadDetailModal';
import { PodsView } from '../pods/PodsView';
import { WorkloadsView } from '../workloads/WorkloadsView';
import { ClusterObservabilityView } from './ClusterObservabilityView';
import { ErrorBoundary } from '../common/ErrorBoundary';

interface ClusterDetailViewProps {
  clusterId: string;
  onBack: () => void;
  onSelectIncident?: (id: string) => void;
  onDeleteCluster?: (clusterId: string) => Promise<void> | void;
}

type ResourceTab = 'overview' | 'observability' | 'workloads' | 'pods' | 'nodes' | 'pvcs' | 'events' | 'agent';

const ClusterDetailViewInner: React.FC<ClusterDetailViewProps> = ({ clusterId, onBack, onSelectIncident, onDeleteCluster }) => {
  const { role, canDeleteClusters } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';

  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [resources, setResources] = useState<KubernetesResource[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [manifestData, setManifestData] = useState<AgentManifestsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<ResourceTab>('overview');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedResource, setSelectedResource] = useState<KubernetesResource | null>(null);

  // Handshake & Credentials modal states
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [inputConnectionCode, setInputConnectionCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [regenerateLoading, setRegenerateLoading] = useState(false);
  const [disconnectLoading, setDisconnectLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Confirmation Modals
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);

  const fetchDetails = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      if (!isBackground) setTelemetryError(null);

      // Fetch primary cluster record, manifests, and incidents
      const clusterPromise = api.getCluster(clusterId);
      const manifestsPromise = api.getClusterManifests(clusterId).catch((err) => {
        console.warn('Cluster manifests fetch notice:', err?.message || err);
        return { connectionCode: '', manifests: {} } as unknown as AgentManifestsResponse;
      });
      const incidentsPromise = api.getIncidents({ clusterId }).catch((err) => {
        console.warn('Cluster incidents fetch notice:', err?.message || err);
        return [] as Incident[];
      });

      // Fetch cluster resources with explicit telemetry validation error capture
      const resourcesPromise = api.getClusterResources(clusterId).catch((err) => {
        console.error('Cluster resources telemetry fetch notice:', err);
        setTelemetryError(err?.message || 'Failed to load telemetry resources');
        return [] as KubernetesResource[];
      });

      const [clusterRes, manifestsRes, incidentsRes, resourcesRes] = await Promise.all([
        clusterPromise,
        manifestsPromise,
        incidentsPromise,
        resourcesPromise
      ]);

      const safeResList = Array.isArray(resourcesRes) ? resourcesRes : [];
      setCluster(clusterRes);
      setResources(safeResList);
      setManifestData(manifestsRes);
      setIncidents(Array.isArray(incidentsRes) ? incidentsRes : []);
      if (manifestsRes?.connectionCode) {
        setInputConnectionCode(manifestsRes.connectionCode);
      }
      return { cluster: clusterRes, resources: safeResList };
    } catch (err: any) {
      console.error('Error fetching cluster details:', err);
      if (!isBackground) {
        setActionError(err?.message || 'Failed to fetch cluster telemetry');
      }
      throw err;
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    try {
      setManualRefreshing(true);
      setActionError(null);
      const result = await fetchDetails(false);
      const safeResultResources = Array.isArray(result?.resources) ? result.resources : [];
      const podCount = safeResultResources.filter((r) => r && r.kind === 'Pod').length;
      const nodeCount = safeResultResources.filter((r) => r && r.kind === 'Node').length;
      setActionSuccess(`Telemetry refreshed: ${safeResultResources.length} resources loaded (${podCount} pods, ${nodeCount} nodes).`);
      setTimeout(() => {
        setActionSuccess((prev) => (prev?.startsWith('Telemetry refreshed') ? null : prev));
      }, 4000);
    } catch (err: any) {
      setActionError(err?.message || 'Failed to refresh cluster telemetry');
    } finally {
      setManualRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDetails(false).catch((err) => {
      console.warn('Initial cluster load notice:', err?.message || err);
    });
    const interval = setInterval(() => {
      fetchDetails(true).catch((err) => {
        console.warn('Background cluster refresh notice:', err?.message || err);
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [clusterId]);

  const handleVerifyConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputConnectionCode.trim()) return;

    try {
      setVerifying(true);
      setActionError(null);
      const res = await api.connectCluster(clusterId, inputConnectionCode.trim());
      setCluster(res.cluster);
      setActionSuccess('Cluster connection verified successfully!');
      setConnectModalOpen(false);
      fetchDetails();
    } catch (err: any) {
      setActionError(err.message || 'Failed to verify connection code');
    } finally {
      setVerifying(false);
    }
  };

  const handleRegenerateCredentials = async () => {
    try {
      setRegenerateLoading(true);
      setActionError(null);
      const res = await api.regenerateClusterToken(clusterId);
      setCluster(res.cluster);
      if (res.connectionCode) {
        setInputConnectionCode(res.connectionCode);
      }
      setActionSuccess('Agent credentials regenerated. Please update your cluster secret.');
      setConfirmRegenOpen(false);
      fetchDetails();
    } catch (err: any) {
      setActionError(err.message || 'Failed to regenerate credentials');
    } finally {
      setRegenerateLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setDisconnectLoading(true);
      setActionError(null);
      await api.disconnectCluster(clusterId);
      setActionSuccess('Cluster agent disconnected.');
      setConfirmDisconnectOpen(false);
      fetchDetails();
    } catch (err: any) {
      setActionError(err.message || 'Failed to disconnect cluster');
    } finally {
      setDisconnectLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setDeleteLoading(true);
      setActionError(null);
      if (onDeleteCluster) {
        await onDeleteCluster(clusterId);
      } else {
        await api.deleteCluster(clusterId);
      }
      setConfirmDeleteOpen(false);
      onBack();
    } catch (err: any) {
      setActionError(err.message || 'Failed to delete cluster');
    } finally {
      setDeleteLoading(false);
    }
  };

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'Never';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ago`;
  };

  const workloadKinds = ['Deployment', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'];
  const safeResources = Array.isArray(resources) ? resources : [];
  const safeIncidents = Array.isArray(incidents) ? incidents : [];

  const workloads = safeResources.filter((r) => r && workloadKinds.includes(r.kind));
  const pods = safeResources.filter((r) => r && r.kind === 'Pod');
  const nodes = safeResources.filter((r) => r && r.kind === 'Node');
  const pvcs = safeResources.filter((r) => r && (r.kind === 'PersistentVolumeClaim' || r.kind === 'PVC'));
  const crashingPods = pods.filter(
    (p) =>
      p &&
      (p.health === 'CRITICAL' ||
        p.status === 'CrashLoopBackOff' ||
        p.status === 'ImagePullBackOff' ||
        p.status === 'Failed' ||
        p.status === 'Error')
  );
  const degradedWorkloads = workloads.filter(
    (w) => w && (w.health === 'CRITICAL' || w.health === 'WARNING')
  );
  const openIncidents = safeIncidents.filter(
    (i) => i && (i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED')
  );
  const criticalIncidents = openIncidents.filter((i) => i && i.severity === 'CRITICAL');
  const highIncidents = openIncidents.filter((i) => i && i.severity === 'HIGH');

  const getFilteredResources = () => {
    let list: KubernetesResource[] = [];
    if (activeTab === 'workloads') list = workloads;
    else if (activeTab === 'pods') list = pods;
    else if (activeTab === 'nodes') list = nodes;
    else if (activeTab === 'pvcs') list = pvcs;

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) => r && (r.name.toLowerCase().includes(q) || (r.namespace && r.namespace.toLowerCase().includes(q)))
      );
    }

    return list;
  };

  const allEvents = safeResources
    .flatMap((r) => (r && Array.isArray(r.events) ? r.events : []))
    .sort((a, b) => ((b && b.timestamp) || 0) - ((a && a.timestamp) || 0));

  if (loading && !cluster) {
    return <LoadingState message="Loading cluster diagnostics..." />;
  }

  if (!cluster) {
    return (
      <div className="p-8">
        <EmptyState title="Cluster Not Found" description="The requested cluster could not be located." action={{ label: 'Back to Clusters', onClick: onBack }} />
      </div>
    );
  }

  const tabs: Array<{ id: ResourceTab; label: string; count?: number; alertCount?: number }> = [
    { id: 'overview', label: 'Cluster Overview' },
    { id: 'observability', label: 'Observability & Metrics' },
    { id: 'workloads', label: 'Workloads', count: workloads.length, alertCount: degradedWorkloads.length },
    { id: 'pods', label: 'Pods', count: pods.length, alertCount: crashingPods.length },
    { id: 'nodes', label: 'Nodes', count: nodes.length },
    { id: 'pvcs', label: 'Storage (PVC)', count: pvcs.length },
    { id: 'events', label: 'Cluster Events', count: allEvents.length },
    { id: 'agent', label: 'Agent Install Manifest' }
  ];

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-zinc-100 font-mono">{cluster.name}</h1>
              <ClusterStatusBadge status={cluster.status} agentStatus={cluster.agentStatus} />
            </div>
            <div className="text-xs font-mono text-zinc-500 mt-0.5">{cluster.id}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            id="cluster-refresh-telemetry-btn"
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={manualRefreshing || loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${manualRefreshing ? 'animate-spin text-sky-400' : ''}`} />}
          >
            {manualRefreshing ? 'Refreshing...' : 'Refresh Telemetry'}
          </Button>
          {canDeleteClusters && (
            <Button
              id="cluster-delete-btn"
              variant="danger"
              size="sm"
              onClick={() => setConfirmDeleteOpen(true)}
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Delete Cluster
            </Button>
          )}
        </div>
      </div>

      {/* Action Alerts */}
      {actionSuccess && (
        <div className="p-3 text-xs rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-zinc-400 hover:text-zinc-200">
            &times;
          </button>
        </div>
      )}

      {actionError && (
        <div className="p-3 text-xs rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="text-zinc-400 hover:text-zinc-200">
            &times;
          </button>
        </div>
      )}

      {telemetryError && (
        <div className="p-3 text-xs rounded-lg bg-amber-950/40 border border-amber-800 text-amber-300 font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Telemetry Alert: {telemetryError}</span>
          </div>
          <button onClick={() => setTelemetryError(null)} className="text-zinc-400 hover:text-zinc-200">
            &times;
          </button>
        </div>
      )}

      {/* Cluster Handshake Pending Banner */}
      {cluster.connectionState !== 'connected' && cluster.agentStatus !== 'CONNECTED' && (
        <div className="p-4 rounded-xl bg-amber-950/25 border border-amber-800/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="p-2 rounded-lg bg-amber-900/40 text-amber-300 border border-amber-700/60">
              <Radio className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="font-semibold text-amber-200">
                {cluster.connectionState === 'agent_detected' || cluster.agentStatus === 'AGENT_DETECTED'
                  ? 'Agent Detected — Awaiting Handshake Verification'
                  : 'Pending Agent Installation & Handshake'}
              </div>
              <div className="text-amber-400/80 text-[11px] mt-0.5">
                {cluster.connectionState === 'agent_detected' || cluster.agentStatus === 'AGENT_DETECTED'
                  ? 'The cluster agent reached SkyOps. Verify your connection code to finalize the connection.'
                  : 'Deploy the SkyOps Agent into your cluster to initiate telemetry ingestion.'}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setConnectModalOpen(true)}
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
            >
              Verify Connection Code
            </Button>
          </div>
        </div>
      )}

      {/* Cluster Overview Stats Bar */}
      <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 grid grid-cols-2 sm:grid-cols-5 gap-4 text-xs font-mono">
        <div>
          <span className="text-zinc-500 block uppercase text-[10px]">Agent Status</span>
          <span className="text-zinc-200 font-semibold flex items-center gap-1.5 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${
                cluster.agentStatus === 'CONNECTED'
                  ? 'bg-emerald-500'
                  : cluster.agentStatus === 'DEGRADED'
                  ? 'bg-amber-500'
                  : 'bg-zinc-600'
              }`}
            />
            {cluster.agentStatus}
          </span>
        </div>

        <div>
          <span className="text-zinc-500 block uppercase text-[10px]">Last Heartbeat</span>
          <span className="text-zinc-200 font-semibold block mt-1 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-zinc-500" />
            {formatTimeAgo(cluster.lastHeartbeat)}
          </span>
        </div>

        <div>
          <span className="text-zinc-500 block uppercase text-[10px]">Kubernetes Version</span>
          <span className="text-zinc-200 font-semibold block mt-1">{cluster.k8sVersion || (cluster.agentStatus === 'CONNECTED' ? 'Detecting...' : '—')}</span>
        </div>

        <div>
          <span className="text-zinc-500 block uppercase text-[10px]">Node / Pod Density</span>
          <span className="text-zinc-200 font-semibold block mt-1">
            {cluster.nodeCount} Nodes / {cluster.podCount} Pods
          </span>
        </div>

        <div>
          <span className="text-zinc-500 block uppercase text-[10px]">Active Incidents</span>
          <span
            className={`font-semibold block mt-1 ${
              cluster.openIncidentCount > 0 ? 'text-rose-400 font-bold' : 'text-zinc-400'
            }`}
          >
            {cluster.openIncidentCount} open
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSearchTerm('');
            }}
            className={`px-4 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
              activeTab === tab.id
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>{tab.label}</span>
            {typeof tab.count === 'number' && (
              <span className="px-1.5 py-0.2 rounded bg-zinc-800 text-[10px] text-zinc-400">{tab.count}</span>
            )}
            {tab.alertCount !== undefined && tab.alertCount > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 border border-rose-800 text-[10px] font-bold animate-pulse">
                {tab.alertCount} failing
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'observability' ? (
        <ClusterObservabilityView
          clusterId={cluster.id}
          clusterName={cluster.name}
          resources={safeResources}
          onSelectResource={(r) => setSelectedResource(r)}
        />
      ) : activeTab === 'agent' ? (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-zinc-200 font-mono">Agent Installation & Cluster Handshake</h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage agent connection credentials, view deployment manifests, and monitor cluster connectivity.
              </p>
            </div>
            {canManage && (
              <div className="flex items-center gap-2">
                {cluster.connectionState !== 'connected' && cluster.agentStatus !== 'CONNECTED' && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setConnectModalOpen(true)}
                    icon={<ShieldCheck className="w-3.5 h-3.5" />}
                  >
                    Verify Handshake
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRegenOpen(true)}
                  disabled={regenerateLoading}
                  icon={regenerateLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                >
                  Regenerate Token
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setConfirmDisconnectOpen(true)}
                  disabled={disconnectLoading}
                  icon={disconnectLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
                >
                  Disconnect
                </Button>
              </div>
            )}
          </div>

          {manifestData && (
            <div className="space-y-4">
              <div className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <div className="text-zinc-500">Authoritative Version</div>
                  <div className="text-zinc-200 font-semibold">{manifestData.agentVersion || AGENT_VERSION}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Container Repository</div>
                  <div className="text-sky-400 font-semibold truncate">{AGENT_IMAGE_REPOSITORY}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Target Namespace</div>
                  <div className="text-zinc-200 font-semibold">{manifestData.namespace || AGENT_DEFAULT_NAMESPACE}</div>
                </div>
                <div>
                  <div className="text-zinc-500">Agent Handshake</div>
                  <div className="text-zinc-200 font-semibold">
                    {cluster.connectionState === 'connected' ? (
                      <span className="text-emerald-400">Connected & Verified</span>
                    ) : (
                      <span className="text-amber-400">Pending Verification</span>
                    )}
                  </div>
                </div>
              </div>

              {manifestData.oneCommandInstall && (
                <CodeBlock
                  code={manifestData.oneCommandInstall}
                  language="bash"
                  title="One-Command Safe Installer (Recommended)"
                />
              )}
              {manifestData.installCommand && (
                <CodeBlock
                  code={manifestData.installCommand}
                  language="bash"
                  title="Direct kubectl apply Command"
                />
              )}
              <CodeBlock
                code={`# Check agent pod status\nkubectl get pods -n skyops-system -l app.kubernetes.io/name=skyops-agent\n\n# Stream agent logs\nkubectl logs -n skyops-system -l app.kubernetes.io/name=skyops-agent -f`}
                language="bash"
                title="Agent Verification & Diagnostics"
              />
              <CodeBlock code={manifestData.helmCommand} language="bash" title="Helm Upgrade / Install" />
              <CodeBlock code={manifestData.kubectlManifest} language="yaml" title="Full Kubernetes Agent Manifest" />
            </div>
          )}
        </div>
      ) : activeTab === 'events' ? (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-zinc-200 font-mono">Observed Kubernetes Cluster Events</h3>
          {allEvents.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-500 border border-zinc-800 rounded-xl bg-zinc-900/30">
              No warning or error events recorded in this cluster.
            </div>
          ) : (
            <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-2.5">Time</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Reason</th>
                    <th className="px-4 py-2.5">Object</th>
                    <th className="px-4 py-2.5">Message</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                  {allEvents.map((evt) => (
                    <tr key={evt.id} className="hover:bg-zinc-800/40">
                      <td className="px-4 py-2 text-zinc-500 whitespace-nowrap">{formatTimeAgo(evt.timestamp)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] ${
                            evt.type === 'Warning'
                              ? 'bg-rose-950/60 text-rose-300 border border-rose-800/60'
                              : 'bg-zinc-800 text-zinc-400'
                          }`}
                        >
                          {evt.type}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-semibold text-zinc-200">{evt.reason}</td>
                      <td className="px-4 py-2 text-zinc-400">
                        {evt.objectKind}/{evt.objectName}
                        {evt.namespace ? ` (${evt.namespace})` : ''}
                      </td>
                      <td className="px-4 py-2 text-zinc-300 max-w-md truncate">{evt.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : activeTab === 'overview' ? (
        <div className="space-y-6 font-mono text-xs">
          {/* 1. Health Status Banner (Actionable Alert or Nominal) */}
          {(crashingPods.length > 0 || degradedWorkloads.length > 0) ? (
            <div className="p-5 rounded-xl bg-rose-950/20 border border-rose-900/40 space-y-4">
              <div className="flex items-center justify-between border-b border-rose-900/40 pb-3">
                <div className="flex items-center gap-2 text-rose-300 font-bold">
                  <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
                  <span>ACTION REQUIRED: {crashingPods.length} Pod(s) Failing • {degradedWorkloads.length} Workload(s) Degraded</span>
                </div>
                <span className="text-[11px] text-rose-400/80">Cluster health impacted</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Failing Workloads */}
                {degradedWorkloads.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                      Degraded Workloads ({degradedWorkloads.length})
                    </div>
                    <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg bg-zinc-950/80 overflow-hidden">
                      {degradedWorkloads.map((w) => (
                        <div key={w.id} className="p-2.5 flex items-center justify-between gap-2">
                          <div className="truncate">
                            <div className="font-bold text-zinc-200 truncate">{w.name}</div>
                            <div className="text-[10px] text-zinc-500">{w.namespace} • {w.kind}</div>
                          </div>
                          <button
                            onClick={() => setSelectedResource(w)}
                            className="px-2 py-1 text-[11px] rounded bg-rose-950 text-rose-200 border border-rose-800 hover:bg-rose-900 shrink-0"
                          >
                            Inspect Workload →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Crashing Pods */}
                {crashingPods.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                      Crashing Pods ({crashingPods.length})
                    </div>
                    <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg bg-zinc-950/80 overflow-hidden">
                      {crashingPods.slice(0, 5).map((p) => (
                        <div key={p.id} className="p-2.5 flex items-center justify-between gap-2">
                          <div className="truncate">
                            <div className="font-bold text-rose-300 truncate">{p.name}</div>
                            <div className="text-[10px] text-zinc-500">
                              {p.namespace} • {p.status} • {p.containers?.reduce((s, c) => s + (c.restartCount || 0), 0) || 0} restarts
                            </div>
                          </div>
                          <button
                            onClick={() => setSelectedResource(p)}
                            className="px-2 py-1 text-[11px] rounded bg-rose-950 text-rose-200 border border-rose-800 hover:bg-rose-900 shrink-0"
                          >
                            Inspect Pod →
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : openIncidents.length > 0 ? (
            <div className="p-5 rounded-xl bg-amber-950/20 border border-amber-900/40 space-y-4">
              <div className="flex items-center justify-between border-b border-amber-900/40 pb-3">
                <div className="flex items-center gap-2 text-amber-300 font-bold">
                  <ShieldAlert className="w-4 h-4 text-amber-400 animate-pulse" />
                  <span>
                    ATTENTION REQUIRED: {openIncidents.length} Active Incident(s) Detected • Workloads Nominal
                  </span>
                </div>
                <span className="text-[11px] text-amber-400/80">
                  {criticalIncidents.length > 0 ? `${criticalIncidents.length} Critical` : `${highIncidents.length} High`} priority
                </span>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-bold text-zinc-300 uppercase tracking-wider">
                  Active Incidents Impacting Infrastructure ({openIncidents.length})
                </div>
                <div className="divide-y divide-zinc-800/80 border border-zinc-800 rounded-lg bg-zinc-950/80 overflow-hidden">
                  {openIncidents.slice(0, 5).map((inc) => (
                    <div key={inc.id} className="p-2.5 flex items-center justify-between gap-2">
                      <div className="truncate">
                        <div className="font-bold text-zinc-200 truncate flex items-center gap-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            inc.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-300 border border-rose-800' :
                            inc.severity === 'HIGH' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                            'bg-zinc-800 text-zinc-300'
                          }`}>
                            {inc.severity}
                          </span>
                          <span>{inc.title}</span>
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {inc.namespace || 'cluster-wide'} • {inc.resourceKind}/{inc.resourceName} • {inc.incidentType}
                        </div>
                      </div>
                      {onSelectIncident && (
                        <button
                          onClick={() => onSelectIncident(inc.id)}
                          className="px-2 py-1 text-[11px] rounded bg-zinc-900 text-zinc-200 border border-zinc-700 hover:bg-zinc-800 shrink-0"
                        >
                          View Incident →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 flex items-center justify-between gap-3 text-emerald-300">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <span className="font-bold block">Nominal Cluster State</span>
                  <span className="text-[11px] text-emerald-400/80">
                    All {workloads.length} workloads and {pods.length} pods are healthy with 0 active incidents.
                  </span>
                </div>
              </div>
              <div className="text-[10px] font-mono px-2 py-1 rounded bg-emerald-950 border border-emerald-800 text-emerald-300">
                100% OPERATIONAL
              </div>
            </div>
          )}

          {/* 2. Cluster Health Experience: Nodes Grid & Pod/Workload Density Matrix */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Node Infrastructure Visualization */}
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-bold text-sm flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-sky-400" />
                  Node Topology
                </span>
                <button
                  onClick={() => setActiveTab('nodes')}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Inspect All ({nodes.length}) →
                </button>
              </div>

              <div className="space-y-2">
                {nodes.length === 0 ? (
                  <div className="text-zinc-500 text-xs py-2">No nodes discovered yet.</div>
                ) : (
                  nodes.map((node) => {
                    const isReady = node.status === 'Ready';
                    const conds = Array.isArray(node.conditions) ? node.conditions : [];
                    const hasMemoryPressure = conds.some(
                      (c) => c.type === 'MemoryPressure' && (c.status === 'True' || c.status === true)
                    );
                    const hasDiskPressure = conds.some(
                      (c) => c.type === 'DiskPressure' && (c.status === 'True' || c.status === true)
                    );
                    const nodePods = pods.filter((p) => p.nodeName === node.name);

                    return (
                      <div
                        key={node.id}
                        onClick={() => setSelectedResource(node)}
                        className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800/80 hover:border-zinc-700 cursor-pointer transition-colors space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-zinc-200 truncate">{node.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              isReady && !hasMemoryPressure && !hasDiskPressure
                                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                                : 'bg-amber-950 text-amber-300 border border-amber-800'
                            }`}
                          >
                            {isReady ? 'Ready' : node.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-zinc-400">
                          <span>{nodePods.length} Scheduled Pods</span>
                          <span>
                            {hasMemoryPressure ? 'Mem Pressure' : hasDiskPressure ? 'Disk Pressure' : 'Healthy Spec'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Pod Experience & Health Breakdown */}
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-bold text-sm flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-violet-400" />
                  Pod Health Experience
                </span>
                <button
                  onClick={() => setActiveTab('pods')}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Inspect All ({pods.length}) →
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">Running / Healthy:</span>
                  <strong className="text-emerald-400">
                    {pods.filter((p) => p.status === 'Running' && p.health === 'HEALTHY').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">CrashLoopBackOff:</span>
                  <strong className={pods.filter((p) => p.status === 'CrashLoopBackOff').length > 0 ? 'text-rose-400' : 'text-zinc-400'}>
                    {pods.filter((p) => p.status === 'CrashLoopBackOff').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">ImagePullBackOff / OOM:</span>
                  <strong className={pods.filter((p) => p.status === 'ImagePullBackOff' || p.status === 'OOMKilled').length > 0 ? 'text-amber-400' : 'text-zinc-400'}>
                    {pods.filter((p) => p.status === 'ImagePullBackOff' || p.status === 'OOMKilled').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">Pending / Scheduling:</span>
                  <strong className="text-zinc-300">
                    {pods.filter((p) => p.status === 'Pending' || p.status === 'ContainerCreating').length}
                  </strong>
                </div>
              </div>
            </div>

            {/* Workload Health & Controller Specs */}
            <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between text-zinc-300">
                <span className="font-bold text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Workload Experience
                </span>
                <button
                  onClick={() => setActiveTab('workloads')}
                  className="text-[11px] text-sky-400 hover:underline"
                >
                  Inspect All ({workloads.length}) →
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">Deployments:</span>
                  <strong className="text-zinc-200">
                    {workloads.filter((w) => w.kind === 'Deployment').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">StatefulSets:</span>
                  <strong className="text-zinc-200">
                    {workloads.filter((w) => w.kind === 'StatefulSet').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">DaemonSets:</span>
                  <strong className="text-zinc-200">
                    {workloads.filter((w) => w.kind === 'DaemonSet').length}
                  </strong>
                </div>

                <div className="flex justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60">
                  <span className="text-zinc-400">Degraded Controllers:</span>
                  <strong className={degradedWorkloads.length > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                    {degradedWorkloads.length} degraded
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* Incidents on this Cluster */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Open Incidents ({incidents.length})
              </h3>
            </div>

            {incidents.length === 0 ? (
              <div className="p-6 bg-zinc-900/40 border border-zinc-800/80 rounded-xl text-center text-zinc-500 text-xs">
                No active incidents reported for this cluster.
              </div>
            ) : (
              <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/40 divide-y divide-zinc-800/60">
                {incidents.map((inc) => (
                  <div key={inc.id} className="p-3.5 flex items-center justify-between gap-4">
                    <div className="space-y-1 truncate">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={inc.severity} />
                        <span className="font-bold text-zinc-200 truncate">{inc.title}</span>
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {inc.namespace && `Namespace: ${inc.namespace} • `}
                        {inc.resourceName && `Resource: ${inc.resourceName} • `}
                        Opened {formatTimeAgo(inc.firstSeenAt || (inc as any).createdAt)}
                      </div>
                    </div>
                    {onSelectIncident && (
                      <button
                        onClick={() => onSelectIncident(inc.id)}
                        className="px-2.5 py-1 rounded bg-zinc-800 hover:bg-sky-900/60 hover:text-sky-200 text-zinc-300 text-xs shrink-0 transition-colors"
                      >
                        Investigate Incident →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Inventory Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div
              onClick={() => setActiveTab('observability')}
              className="p-4 rounded-xl bg-sky-950/20 border border-sky-900/60 cursor-pointer hover:border-sky-600 transition-colors"
            >
              <div className="text-[11px] text-sky-400 uppercase font-bold flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" />
                Observability
              </div>
              <div className="text-xl font-bold text-sky-200 mt-1">Metrics</div>
              <div className="text-[10px] text-sky-400/80 mt-1 flex items-center gap-1">
                Usage & Limits →
              </div>
            </div>

            <div
              onClick={() => setActiveTab('workloads')}
              className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition-colors"
            >
              <div className="text-[11px] text-zinc-500 uppercase">Workloads</div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{workloads.length}</div>
              <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                View all workloads →
              </div>
            </div>

            <div
              onClick={() => setActiveTab('pods')}
              className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition-colors"
            >
              <div className="text-[11px] text-zinc-500 uppercase">Pods</div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{pods.length}</div>
              <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                View all pods →
              </div>
            </div>

            <div
              onClick={() => setActiveTab('nodes')}
              className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition-colors"
            >
              <div className="text-[11px] text-zinc-500 uppercase">Nodes</div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{nodes.length}</div>
              <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                View node capacity →
              </div>
            </div>

            <div
              onClick={() => setActiveTab('events')}
              className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 cursor-pointer hover:border-zinc-700 transition-colors"
            >
              <div className="text-[11px] text-zinc-500 uppercase">Cluster Events</div>
              <div className="text-xl font-bold text-zinc-100 mt-1">{allEvents.length}</div>
              <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1">
                View audit events →
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === 'workloads' ? (
        <WorkloadsView
          workloads={workloads}
          clusterResources={safeResources}
          incidents={safeIncidents}
          cluster={cluster}
          clusters={cluster ? [cluster] : []}
          onSelectWorkload={(w) => setSelectedResource(w)}
          onSelectIncident={onSelectIncident}
          onRefresh={handleManualRefresh}
          loading={manualRefreshing || loading}
          isEmbedded={true}
        />
      ) : activeTab === 'pods' ? (
        <PodsView
          pods={pods}
          clusterResources={safeResources}
          incidents={safeIncidents}
          cluster={cluster}
          clusters={cluster ? [cluster] : []}
          onSelectPod={(p) => setSelectedResource(p)}
          onSelectIncident={onSelectIncident}
          onRefresh={handleManualRefresh}
          loading={manualRefreshing || loading}
          isEmbedded={true}
        />
      ) : activeTab === 'nodes' ? (
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden font-mono text-xs">
            <table className="w-full text-left">
              <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Node Name</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Kubelet Version</th>
                  <th className="px-4 py-2.5">Allocatable Memory</th>
                  <th className="px-4 py-2.5">Allocatable CPU</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {getFilteredResources().length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500 font-mono text-xs">
                      No nodes found in this cluster.
                    </td>
                  </tr>
                ) : (
                  getFilteredResources().map((res) => {
                    const kubeletVer = (res.statusSummary?.kubeletVersion as string) || (res.specSummary?.kubeletVersion as string) || cluster.k8sVersion || 'v1.35.1';
                    const allocMem = (res.statusSummary?.allocatable as any)?.memory || res.statusSummary?.allocatableMemory || (res.statusSummary?.capacity as any)?.memory || '32Gi';
                    const allocCpu = (res.statusSummary?.allocatable as any)?.cpu || res.statusSummary?.allocatableCpu || (res.statusSummary?.capacity as any)?.cpu || '8 cores';
                    return (
                      <tr
                        key={res.id}
                        onClick={() => setSelectedResource(res)}
                        className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3 font-semibold text-zinc-100">{res.name}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[11px] ${
                            res.status === 'Ready'
                              ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/50'
                              : 'bg-amber-950/40 text-amber-300 border border-amber-800/50'
                          }`}>
                            {res.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          {kubeletVer}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          {String(allocMem)}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          {String(allocCpu)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedResource(res);
                            }}
                            className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded font-mono"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Storage PVCs */
        <div className="space-y-4">
          <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden font-mono text-xs">
            <table className="w-full text-left">
              <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">PVC Name</th>
                  <th className="px-4 py-2.5">Namespace</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Capacity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {getFilteredResources().map((res) => (
                  <tr key={res.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-3 font-semibold text-zinc-100">{res.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{res.namespace || 'default'}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded text-[11px] bg-zinc-800 text-zinc-300">
                        {res.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-300">
                      {String(res.statusSummary?.capacity || '100Gi')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pod Detail Modal */}
      {selectedResource && selectedResource.kind === 'Pod' && (
        <PodDetailModal
          pod={selectedResource}
          clusterResources={safeResources}
          incidents={safeIncidents}
          onClose={() => setSelectedResource(null)}
          onSelectIncident={onSelectIncident}
          onSelectResource={(res) => setSelectedResource(res)}
        />
      )}

      {/* Workload Detail Modal */}
      {selectedResource && workloadKinds.includes(selectedResource.kind) && (
        <WorkloadDetailModal
          workload={selectedResource}
          clusterResources={safeResources}
          incidents={safeIncidents}
          onClose={() => setSelectedResource(null)}
          onSelectPod={(pod) => setSelectedResource(pod)}
          onSelectIncident={onSelectIncident}
        />
      )}

      {/* Node & Other Resources Detail Modal */}
      {selectedResource && selectedResource.kind !== 'Pod' && !workloadKinds.includes(selectedResource.kind) && (
        <Modal
          isOpen={!!selectedResource}
          onClose={() => setSelectedResource(null)}
          title={`${selectedResource.kind}: ${selectedResource.name}`}
          maxWidth="lg"
        >
          <div className="space-y-4 text-xs font-mono">
            <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <span className="text-zinc-500 block">Kind</span>
                <span className="text-zinc-200">{selectedResource.kind}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Namespace</span>
                <span className="text-zinc-200">{selectedResource.namespace || 'default'}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Status</span>
                <span className="text-emerald-400 font-semibold">{selectedResource.status}</span>
              </div>
              <div>
                <span className="text-zinc-500 block">Last Sync</span>
                <span className="text-zinc-400">{formatTimeAgo(selectedResource.updatedAt)}</span>
              </div>
            </div>

            {selectedResource.conditions && selectedResource.conditions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Conditions</h4>
                <div className="divide-y divide-zinc-800 border border-zinc-800 rounded-lg bg-zinc-950">
                  {selectedResource.conditions.map((cond, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between">
                      <span className="text-zinc-300">{cond.type}</span>
                      <span className="font-semibold text-emerald-400">
                        {cond.status} {cond.reason ? `(${cond.reason})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Verify Connection Handshake Modal */}
      {connectModalOpen && (
        <Modal
          isOpen={connectModalOpen}
          onClose={() => setConnectModalOpen(false)}
          title={`Verify Handshake — ${cluster.name}`}
          maxWidth="md"
        >
          <form onSubmit={handleVerifyConnection} className="space-y-4">
            <p className="text-xs text-zinc-400">
              Enter the single-use connection registration code generated when this cluster was registered or from the agent installation output to finalize the connection.
            </p>

            <div>
              <label className="block text-xs font-mono font-medium text-zinc-300 mb-1">
                Connection Registration Code
              </label>
              <input
                type="text"
                required
                placeholder="SKYOPS-CONNECT-XXXX-XXXX"
                value={inputConnectionCode}
                onChange={(e) => setInputConnectionCode(e.target.value.toUpperCase())}
                className="w-full px-3 py-2 text-sm bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-sky-500 font-mono tracking-wider"
              />
            </div>

            <div className="text-[11px] font-mono text-zinc-500 flex items-center gap-1.5">
              <KeyRound className="w-3 h-3 text-zinc-400" />
              <span>Valid for 30 minutes after cluster creation or credential regeneration.</span>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <Button variant="ghost" type="button" onClick={() => setConnectModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={verifying || !inputConnectionCode.trim()}
                icon={verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              >
                {verifying ? 'Verifying...' : 'Verify & Connect'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirm Regenerate Modal */}
      {confirmRegenOpen && (
        <Modal
          isOpen={confirmRegenOpen}
          onClose={() => !regenerateLoading && setConfirmRegenOpen(false)}
          title="Regenerate Agent Credentials"
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 bg-amber-950/20 border border-amber-900/30 rounded-lg text-amber-300">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-amber-200">Invalidate Current Agent Token?</p>
                <p className="text-zinc-400">
                  Regenerating credentials will invalidate the existing cluster token immediately. You will need to re-apply the generated Kubernetes secret to reconnect the live agent.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" disabled={regenerateLoading} onClick={() => setConfirmRegenOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={regenerateLoading}
                onClick={handleRegenerateCredentials}
                icon={regenerateLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              >
                {regenerateLoading ? 'Regenerating...' : 'Regenerate Credentials'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Disconnect Modal */}
      {confirmDisconnectOpen && (
        <Modal
          isOpen={confirmDisconnectOpen}
          onClose={() => !disconnectLoading && setConfirmDisconnectOpen(false)}
          title="Disconnect Cluster Agent"
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 bg-amber-950/20 border border-amber-900/30 rounded-lg text-amber-300">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-amber-200">Disconnect Agent from {cluster.name}?</p>
                <p className="text-zinc-400">
                  The agent will be marked as disconnected and telemetry streaming will pause. Incident histories and logs are preserved.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" disabled={disconnectLoading} onClick={() => setConfirmDisconnectOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={disconnectLoading}
                onClick={handleDisconnect}
                icon={disconnectLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              >
                {disconnectLoading ? 'Disconnecting...' : 'Disconnect Agent'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete Modal */}
      {confirmDeleteOpen && (
        <Modal
          isOpen={confirmDeleteOpen}
          onClose={() => !deleteLoading && setConfirmDeleteOpen(false)}
          title="Delete Kubernetes Cluster"
          maxWidth="md"
        >
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3.5 bg-rose-950/20 border border-rose-900/30 rounded-lg text-rose-300">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-semibold text-rose-200">Permanent Deletion</p>
                <p className="text-zinc-400">
                  Are you sure you want to permanently delete <span className="font-mono text-zinc-200 font-bold">{cluster.name}</span> ({cluster.id})? All agent tokens, telemetry snapshots, and resource tracking will be removed.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" disabled={deleteLoading} onClick={() => setConfirmDeleteOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={deleteLoading}
                onClick={handleDelete}
                icon={deleteLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              >
                {deleteLoading ? 'Deleting Cluster...' : 'Delete Cluster'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export const ClusterDetailView: React.FC<ClusterDetailViewProps> = (props) => {
  return (
    <ErrorBoundary
      fallbackTitle="Cluster Detail Error"
      fallbackMessage="An unexpected error occurred while loading this cluster. You can return to the clusters list or retry."
      onReset={props.onBack}
    >
      <ClusterDetailViewInner {...props} />
    </ErrorBoundary>
  );
};
