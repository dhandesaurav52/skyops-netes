import { AlertTriangle, BookOpen, Building2, Plus, RefreshCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Cluster, Incident, OverviewMetrics } from '../../types/index';
import { AddClusterModal } from '../clusters/AddClusterModal';
import { ClusterDetailView } from '../clusters/ClusterDetailView';
import { ClustersView } from '../clusters/ClustersView';
import { IncidentDetailView } from '../incidents/IncidentDetailView';
import { IncidentsView } from '../incidents/IncidentsView';
import { OverviewView } from '../overview/OverviewView';
import { InfrastructureView, InfraSubTab } from '../infrastructure/InfrastructureView';
import { LogNavigationIntent, ObservabilityHubView } from '../observability/ObservabilityHubView';
import { SettingsView } from '../settings/SettingsView';
import { AuditView } from '../audit/AuditView';
import { NavigationTab, Sidebar } from './Sidebar';
import { DocTopic, KnowledgeBaseModal } from '../docs/KnowledgeBaseModal';
import { OperationsWorkspaceView } from '../operations/OperationsWorkspaceView';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { PodLogsViewer } from '../logs/PodLogsViewer';
import { Modal } from '../common/UI';

interface AppShellProps {
  initialOpenAddCluster?: boolean;
  onSignOut?: () => void;
}

const PAGE_METADATA: Record<string, { title: string; subtitle: string }> = {
  overview: {
    title: 'Overview',
    subtitle: 'Fleet health summary, active alerts, and connected Kubernetes clusters'
  },
  operations: {
    title: 'Operations Workspace',
    subtitle: 'Unified Kubernetes resource control, releases, live diagnostics & operations'
  },
  clusters: {
    title: 'Clusters',
    subtitle: 'Connect, organize, and inspect your Kubernetes environments'
  },
  infrastructure: {
    title: 'Infrastructure',
    subtitle: 'Explore workloads, pods, services, worker nodes, and topology'
  },
  incidents: {
    title: 'Incidents',
    subtitle: 'Investigate cluster issues, root-cause evidence, and 1-click Auto-Healing'
  },
  observability: {
    title: 'Observability',
    subtitle: 'Live CPU & memory metrics, Kubernetes events, and container logs'
  },
  audit: {
    title: 'Activity Log',
    subtitle: 'Complete history of team actions, auto-healing, and cluster changes'
  },
  settings: {
    title: 'Settings',
    subtitle: 'Workspace preferences, team access, auto-healing rules, and billing'
  }
};

export const AppShell: React.FC<AppShellProps> = ({
  initialOpenAddCluster = false,
  onSignOut
}) => {
  const { currentOrg, createOrganization, pendingInvitations, acceptInvitation } = useAuth();
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [infraSubTab, setInfraSubTab] = useState<InfraSubTab>('workloads');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [pendingLogIntent, setPendingLogIntent] = useState<LogNavigationIntent | null>(null);
  const [isAddClusterOpen, setIsAddClusterOpen] = useState(initialOpenAddCluster);
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [selectedDocTopic, setSelectedDocTopic] = useState<DocTopic>('quickstart');
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [activePodLogsModal, setActivePodLogsModal] = useState<{
    clusterId: string;
    namespace: string;
    podName: string;
    container?: string;
  } | null>(null);

  const handleOpenDoc = (topic: DocTopic) => {
    setSelectedDocTopic(topic);
    setIsDocModalOpen(true);
  };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined') {
        return localStorage.getItem('skyops_sidebar_collapsed') === 'true';
      }
    } catch {}
    return false;
  });

  const handleToggleSidebar = () => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('skyops_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  };

  // Keyboard shortcut Ctrl+B / Cmd+B for toggling navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Global state
  const defaultMetrics: OverviewMetrics = {
    totalClusters: 0,
    healthyClusters: 0,
    warningClusters: 0,
    criticalClusters: 0,
    offlineClusters: 0,
    openIncidents: 0,
    criticalIncidents: 0,
    highIncidents: 0,
    mediumIncidents: 0,
    lowIncidents: 0,
    resolvedTodayCount: 0
  };

  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchGlobalData = async (isManual = false) => {
    if (!currentOrg?.id) {
      setMetrics(defaultMetrics);
      setClusters([]);
      setIncidents([]);
      setRecentActivity([]);
      setFetchError(null);
      setIsStale(false);
      setLoading(false);
      setIsRefreshing(false);
      return;
    }

    if (isManual) {
      setIsRefreshing(true);
      setRefreshKey((prev) => prev + 1);
    }
    const startTime = Date.now();
    let encounteredError = false;
    let errorMessage = '';

    try {
      const [overviewData, incidentsData] = await Promise.all([
        api.getOverview().catch((err) => {
          encounteredError = true;
          errorMessage = err?.message || 'Failed to sync cluster fleet overview';
          console.warn('Overview data fetch notice:', errorMessage);
          return null;
        }),
        api.getIncidents().catch((err) => {
          encounteredError = true;
          errorMessage = err?.message || 'Failed to sync active incidents';
          console.warn('Incidents data fetch notice:', errorMessage);
          return null;
        })
      ]);

      if (overviewData) {
        setMetrics(overviewData.metrics || defaultMetrics);
        setClusters(overviewData.clusters || []);
        setRecentActivity(overviewData.recentActivity || []);
      } else if (!metrics && !encounteredError) {
        setMetrics(defaultMetrics);
      }

      if (incidentsData !== null) {
        setIncidents(incidentsData);
      }

      if (overviewData || incidentsData !== null) {
        setLastUpdatedAt(Date.now());
      }

      if (encounteredError) {
        setIsStale(true);
        setFetchError(errorMessage || 'Telemetry sync failure');
      } else {
        setIsStale(false);
        setFetchError(null);
      }
    } catch (err: any) {
      console.warn('SkyOps state sync notice:', err);
      setIsStale(true);
      setFetchError(err?.message || 'Failed to sync SkyOps state');
    } finally {
      const elapsed = Date.now() - startTime;
      if (isManual && elapsed < 400) {
        await new Promise((r) => setTimeout(r, 400 - elapsed));
      }
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = () => {
    fetchGlobalData(true);
  };

  useEffect(() => {
    setSelectedClusterId(null);
    setSelectedIncidentId(null);
    setPendingLogIntent(null);
    setClusters([]);
    setIncidents([]);
    setMetrics(null);
    fetchGlobalData();
    const interval = setInterval(() => fetchGlobalData(false), 10000);
    return () => clearInterval(interval);
  }, [currentOrg?.id]);

  const handleSelectCluster = (id: string) => {
    setSelectedClusterId(id);
    setSelectedIncidentId(null);
    if (activeTab !== 'infrastructure') {
      setActiveTab('clusters');
    }
  };

  const handleOpenLogs = (clusterId: string, namespace: string, podName: string) => {
    setPendingLogIntent({
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      clusterId,
      namespace,
      name: podName
    });
    setActiveTab('observability');
    try {
      if (typeof window !== 'undefined') {
        window.history.pushState({ tab: 'observability' }, '', '/observability');
      }
    } catch {
      // safe fallback
    }
  };

  const handleClearIncident = () => {
    setSelectedIncidentId(null);
    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        if (url.searchParams.has('incident') || url.searchParams.has('incidentId')) {
          url.searchParams.delete('incident');
          url.searchParams.delete('incidentId');
          window.history.pushState({}, '', url.toString());
        }
      }
    } catch {
      // safe fallback
    }
  };

  const handleSelectIncident = (id: string) => {
    setSelectedIncidentId(id);
    setSelectedClusterId(null);
    setActiveTab('incidents');
    try {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('incident', id);
        window.history.pushState({ incidentId: id }, '', url.toString());
      }
    } catch {
      // safe fallback
    }
  };

  const handleTabChange = (tab: NavigationTab, subTab?: InfraSubTab) => {
    setSelectedClusterId(null);
    handleClearIncident();

    // Map legacy or consolidated tab targets into the 7 core pages
    if (tab === 'services') {
      setInfraSubTab('services');
      setActiveTab('infrastructure');
      return;
    }
    if (tab === 'logs') {
      setActiveTab('observability');
      return;
    }
    if (tab === 'cost' || tab === 'security') {
      setActiveTab('overview');
      return;
    }

    if (tab === 'infrastructure' && subTab) {
      setInfraSubTab(subTab);
    }

    setActiveTab(tab);
    try {
      if (typeof window !== 'undefined') {
        if (tab === 'incidents') {
          window.history.pushState({ tab: 'incidents' }, '', '/incidents');
        } else if (tab === 'observability') {
          window.history.pushState({ tab: 'observability' }, '', '/observability');
        }
      }
    } catch {
      // safe fallback
    }
    if (tab !== 'observability') {
      setPendingLogIntent(null);
    }
  };

  // Direct navigation support on initial mount and browser back/forward
  useEffect(() => {
    const resolveDirectRoutes = () => {
      try {
        if (typeof window === 'undefined') return;
        const searchParams = new URLSearchParams(window.location.search);
        const queryInc = searchParams.get('incident') || searchParams.get('incidentId');
        const pathMatch = window.location.pathname.match(/\/incidents\/([a-zA-Z0-9_-]+)/i);
        const hashMatch = window.location.hash.match(/(?:#|\/)(SKY-\d+|incidents\/([a-zA-Z0-9_-]+))/i);

        const targetId = queryInc || (pathMatch ? pathMatch[1] : null) || (hashMatch ? (hashMatch[2] || hashMatch[1]) : null);
        if (targetId) {
          setSelectedIncidentId(targetId);
          setSelectedClusterId(null);
          setActiveTab('incidents');
          return;
        }

        const logsMatch =
          window.location.pathname.match(/^\/logs(?:\/([a-zA-Z0-9_-]+))?/i) ||
          window.location.hash.match(/^#(?:|\/)logs(?:\/([a-zA-Z0-9_-]+))?/i);
        if (logsMatch) {
          setActiveTab('observability');
          setSelectedClusterId(null);
          setSelectedIncidentId(null);
          return;
        }

        const opsMatch =
          searchParams.get('tab') === 'operations' ||
          window.location.pathname.startsWith('/operations') ||
          window.location.hash.startsWith('#/operations');
        if (opsMatch) {
          setActiveTab('operations');
          const targetCluster = searchParams.get('clusterId');
          if (targetCluster) setSelectedClusterId(targetCluster);
          return;
        }
      } catch {
        // safe fallback
      }
    };

    resolveDirectRoutes();
    window.addEventListener('popstate', resolveDirectRoutes);
    return () => window.removeEventListener('popstate', resolveDirectRoutes);
  }, []);

  const openIncidentsCount = incidents.filter(
    (i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED'
  ).length;

  const pageMeta = PAGE_METADATA[activeTab] || PAGE_METADATA.overview;

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100 antialiased overflow-hidden font-sans">
      {/* Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        openIncidentsCount={openIncidentsCount}
        onOpenAddCluster={() => setIsAddClusterOpen(true)}
        onSignOut={onSignOut}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full bg-zinc-950 overscroll-contain overflow-y-auto">
        {/* Clean, Human-Understandable Top Header Bar */}
        <header className="h-12 border-b border-zinc-800/80 px-4 sm:px-6 flex items-center justify-between shrink-0 bg-zinc-950/90 backdrop-blur-xs sticky top-0 z-20">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-2 text-xs text-zinc-400 min-w-0">
              <span className="font-medium text-zinc-300 truncate max-w-[140px]">
                {currentOrg?.name || 'My Workspace'}
              </span>
              <span className="text-zinc-600" aria-hidden="true">/</span>
              <span className="font-semibold text-zinc-100">{pageMeta.title}</span>
            </div>
            <span className="text-zinc-700 hidden lg:inline" aria-hidden="true">·</span>
            <span className="text-xs text-zinc-400 hidden lg:inline truncate">
              {pageMeta.subtitle}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Active Incidents quick jump if any are open */}
            {openIncidentsCount > 0 && activeTab !== 'incidents' && (
              <button
                onClick={() => handleTabChange('incidents')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-rose-950/70 hover:bg-rose-900/70 text-rose-300 border border-rose-800/70 text-xs font-medium transition-colors cursor-pointer"
                title="View active incidents needing attention"
              >
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                <span>{openIncidentsCount} Open {openIncidentsCount === 1 ? 'Incident' : 'Incidents'}</span>
              </button>
            )}

            {/* Centralized Notification Center */}
            <NotificationCenter
              onOpenPodLogs={(clusterId, namespace, podName, container) => {
                setActivePodLogsModal({ clusterId, namespace, podName, container });
              }}
              onOpenIncident={handleSelectIncident}
            />

            {/* Sync & Manual Refresh Button */}
            <button
              onClick={handleManualRefresh}
              disabled={loading || isRefreshing}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 text-xs transition-colors cursor-pointer"
              title="Refresh live cluster telemetry and incidents"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-sky-400 ${loading || isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isRefreshing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            {/* Connect Cluster Quick Button */}
            <button
              onClick={() => setIsAddClusterOpen(true)}
              className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-600/15 hover:bg-sky-600/25 text-sky-300 border border-sky-500/30 text-xs font-medium transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Connect Cluster</span>
            </button>

            {/* Docs & Help */}
            <button
              id="topbar-docs-btn"
              onClick={() => handleOpenDoc('quickstart')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-sky-300 border border-zinc-800 text-xs transition-colors cursor-pointer"
              title="SkyOps Guides & Documentation"
            >
              <BookOpen className="w-3.5 h-3.5 text-sky-400" />
              <span>Help & Docs</span>
            </button>
          </div>
        </header>

        {/* View Routing (7 Core Production Pages) */}
        <div className="flex-1 flex flex-col min-h-0">
          {!currentOrg ? (
            <div className="p-8 max-w-xl mx-auto my-12">
              <div className="p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-5 shadow-xl">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white">Create Your Organization Workspace</h2>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      You currently have no active workspace. Create a new tenant workspace to connect and manage Kubernetes clusters.
                    </p>
                  </div>
                </div>

                {pendingInvitations && pendingInvitations.length > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-800/50 space-y-2">
                    <div className="text-xs font-semibold text-amber-300">
                      Pending Workspace Invitations ({pendingInvitations.length})
                    </div>
                    {pendingInvitations.map((inv) => (
                      <div key={inv.id} className="flex items-center justify-between gap-2 text-xs bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800">
                        <div>
                          <div className="font-semibold text-zinc-100">{inv.orgName || 'Workspace'}</div>
                          <div className="text-[11px] text-zinc-400">Role: {inv.role}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => acceptInvitation(inv.id)}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
                        >
                          Accept & Join
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!newWorkspaceName.trim()) return;
                    try {
                      setIsCreatingWorkspace(true);
                      await createOrganization(newWorkspaceName.trim());
                      setNewWorkspaceName('');
                    } finally {
                      setIsCreatingWorkspace(false);
                    }
                  }}
                  className="space-y-3"
                >
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Workspace / Organization Name
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      maxLength={60}
                      placeholder="e.g., Acme Cloud Platform"
                      value={newWorkspaceName}
                      onChange={(e) => setNewWorkspaceName(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-700 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isCreatingWorkspace || newWorkspaceName.trim().length < 2}
                    className="w-full py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>{isCreatingWorkspace ? 'Creating Workspace...' : 'Create Workspace'}</span>
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
            <OverviewView
              metrics={metrics}
              clusters={clusters}
              recentIncidents={incidents}
              recentActivity={recentActivity}
              onSelectIncident={handleSelectIncident}
              onSelectCluster={handleSelectCluster}
              onOpenAddCluster={() => setIsAddClusterOpen(true)}
              onRefresh={handleManualRefresh}
              loading={loading || isRefreshing}
              onNavigateTab={handleTabChange}
              lastUpdatedAt={lastUpdatedAt}
              fetchError={fetchError}
              isStale={isStale}
              refreshKey={refreshKey}
            />
          )}

          {activeTab === 'clusters' && (
            <>
              {selectedClusterId ? (
                <ClusterDetailView
                  clusterId={selectedClusterId}
                  onBack={() => setSelectedClusterId(null)}
                  onSelectIncident={handleSelectIncident}
                  onDeleteCluster={async (id) => {
                    await api.deleteCluster(id);
                    setSelectedClusterId(null);
                    fetchGlobalData(true);
                  }}
                />
              ) : (
                <ClustersView
                  clusters={clusters}
                  onSelectCluster={handleSelectCluster}
                  onOpenAddCluster={() => setIsAddClusterOpen(true)}
                  onDeleteCluster={async (id) => {
                    await api.deleteCluster(id);
                    fetchGlobalData(true);
                  }}
                  onRefresh={handleManualRefresh}
                  loading={loading || isRefreshing}
                />
              )}
            </>
          )}

          {activeTab === 'operations' && (
            <OperationsWorkspaceView
              clusters={clusters}
              initialClusterId={selectedClusterId}
              onSelectCluster={handleSelectCluster}
              onSelectIncident={handleSelectIncident}
              onOpenAddCluster={() => setIsAddClusterOpen(true)}
              onRefreshGlobal={handleManualRefresh}
            />
          )}

          {activeTab === 'infrastructure' && (
            <>
              {selectedClusterId ? (
                <ClusterDetailView
                  clusterId={selectedClusterId}
                  onBack={() => setSelectedClusterId(null)}
                  onSelectIncident={handleSelectIncident}
                  onDeleteCluster={async (id) => {
                    await api.deleteCluster(id);
                    setSelectedClusterId(null);
                    fetchGlobalData(true);
                  }}
                />
              ) : (
                <InfrastructureView
                  clusters={clusters}
                  initialSubTab={infraSubTab}
                  onSelectCluster={handleSelectCluster}
                  onOpenAddCluster={() => setIsAddClusterOpen(true)}
                  onDeleteCluster={async (id) => {
                    await api.deleteCluster(id);
                    fetchGlobalData(true);
                  }}
                  onRefresh={handleManualRefresh}
                  loading={loading || isRefreshing}
                  onSelectIncident={handleSelectIncident}
                  onOpenLogs={handleOpenLogs}
                />
              )}
            </>
          )}

          {activeTab === 'incidents' && (
            <>
              {selectedIncidentId ? (
                <IncidentDetailView
                  incidentId={selectedIncidentId}
                  onBack={handleClearIncident}
                  onSelectCluster={handleSelectCluster}
                  onOpenLogs={(clusterId, namespace, podOrWorkload) => {
                    handleOpenLogs(clusterId, namespace, podOrWorkload);
                  }}
                />
              ) : (
                <IncidentsView
                  incidents={incidents}
                  clusters={clusters}
                  onSelectIncident={handleSelectIncident}
                  onRefresh={handleManualRefresh}
                  loading={loading || isRefreshing}
                />
              )}
            </>
          )}

          {activeTab === 'observability' && (
            <ObservabilityHubView
              clusters={clusters}
              logIntent={pendingLogIntent}
              onClearLogIntent={() => setPendingLogIntent(null)}
              onRefresh={handleManualRefresh}
            />
          )}

          {activeTab === 'audit' && <AuditView />}

          {activeTab === 'settings' && (
            <SettingsView
              clusters={clusters}
              onSelectIncident={handleSelectIncident}
              onRefresh={handleManualRefresh}
            />
          )}
            </>
          )}
        </div>
      </main>

      {/* Add Cluster Modal */}
      <AddClusterModal
        isOpen={isAddClusterOpen}
        onClose={() => setIsAddClusterOpen(false)}
        onClusterCreated={() => {
          fetchGlobalData();
        }}
        onOpenCluster={(clusterId) => {
          setSelectedClusterId(clusterId);
          setActiveTab('clusters');
        }}
      />

      {/* Technical Reference & Knowledge Base Modal */}
      <KnowledgeBaseModal
        isOpen={isDocModalOpen}
        onClose={() => setIsDocModalOpen(false)}
        initialTopic={selectedDocTopic}
        onGetStarted={() => setIsAddClusterOpen(true)}
      />

      {/* Pod Logs Viewer Modal */}
      {activePodLogsModal && (
        <Modal
          isOpen={!!activePodLogsModal}
          onClose={() => setActivePodLogsModal(null)}
          title={`Pod Logs: ${activePodLogsModal.podName}`}
          size="xl"
        >
          <PodLogsViewer
            clusterId={activePodLogsModal.clusterId}
            namespace={activePodLogsModal.namespace}
            podName={activePodLogsModal.podName}
            initialContainer={activePodLogsModal.container}
            onClose={() => setActivePodLogsModal(null)}
          />
        </Modal>
      )}
    </div>
  );
};
