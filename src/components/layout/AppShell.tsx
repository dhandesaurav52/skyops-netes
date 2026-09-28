import { Bell, BookOpen, HelpCircle, Shield, Terminal } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { AGENT_VERSION } from '../../config/version';
import { useAuth } from '../../context/AuthContext';
import { Cluster, Incident, OverviewMetrics } from '../../types/index';
import { AddClusterModal } from '../clusters/AddClusterModal';
import { ClusterDetailView } from '../clusters/ClusterDetailView';
import { ClustersView } from '../clusters/ClustersView';
import { IncidentDetailView } from '../incidents/IncidentDetailView';
import { IncidentsView } from '../incidents/IncidentsView';
import { OverviewView } from '../overview/OverviewView';
import { InfrastructureView } from '../infrastructure/InfrastructureView';
import { ServicesView } from '../services/ServicesView';
import { LogNavigationIntent, ObservabilityHubView } from '../observability/ObservabilityHubView';
import { SettingsView } from '../settings/SettingsView';
import { AuditView } from '../audit/AuditView';
import { NavigationTab, Sidebar } from './Sidebar';
import { Footer } from './Footer';
import { DocTopic, KnowledgeBaseModal } from '../docs/KnowledgeBaseModal';

interface AppShellProps {
  initialOpenAddCluster?: boolean;
  onSignOut?: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  initialOpenAddCluster = false,
  onSignOut
}) => {
  const { currentOrg } = useAuth();
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [pendingLogIntent, setPendingLogIntent] = useState<LogNavigationIntent | null>(null);
  const [isAddClusterOpen, setIsAddClusterOpen] = useState(initialOpenAddCluster);
  const [isDocModalOpen, setIsDocModalOpen] = useState(false);
  const [selectedDocTopic, setSelectedDocTopic] = useState<DocTopic>('quickstart');

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

  const fetchGlobalData = async (isManual = false) => {
    if (isManual) {
      setIsRefreshing(true);
    }
    const startTime = Date.now();
    try {
      const [overviewData, incidentsData] = await Promise.all([
        api.getOverview().catch((err) => {
          console.warn('Overview data fetch notice:', err?.message || err);
          return null;
        }),
        api.getIncidents().catch((err) => {
          console.warn('Incidents data fetch notice:', err?.message || err);
          return [];
        })
      ]);

      if (overviewData) {
        setMetrics(overviewData.metrics || defaultMetrics);
        setClusters(overviewData.clusters || []);
        setRecentActivity(overviewData.recentActivity || []);
      } else if (!metrics) {
        setMetrics(defaultMetrics);
      }

      if (incidentsData) {
        setIncidents(incidentsData);
      }
    } catch (err) {
      console.warn('SkyOps state sync notice:', err);
      if (!metrics) {
        setMetrics(defaultMetrics);
      }
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
    // 10-second background polling for live agent pulses and incidents
    const interval = setInterval(() => fetchGlobalData(false), 10000);
    return () => clearInterval(interval);
  }, [currentOrg?.id]);

  const handleSelectCluster = (id: string) => {
    setSelectedClusterId(id);
    setSelectedIncidentId(null);
    setActiveTab('infrastructure');
  };

  const handleOpenLogs = (clusterId: string, namespace: string, podName: string) => {
    setPendingLogIntent({
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      clusterId,
      namespace,
      name: podName
    });
    setActiveTab('observability');
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

  const handleTabChange = (tab: NavigationTab) => {
    setActiveTab(tab);
    setSelectedClusterId(null);
    handleClearIncident();
    // Clear any pending log navigation when navigating away from observability
    if (tab !== 'observability') {
      setPendingLogIntent(null);
    }
  };

  // Direct navigation support on initial mount and browser back/forward
  useEffect(() => {
    const resolveDirectIncidentRoute = () => {
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
        }
      } catch {
        // safe fallback
      }
    };

    resolveDirectIncidentRoute();
    window.addEventListener('popstate', resolveDirectIncidentRoute);
    return () => window.removeEventListener('popstate', resolveDirectIncidentRoute);
  }, []);

  const openIncidentsCount = incidents.filter(
    (i) => i.status === 'OPEN' || i.status === 'IN_PROGRESS' || i.status === 'ACKNOWLEDGED'
  ).length;

  return (
    <div className="flex h-screen storm-bg-canvas text-zinc-100 antialiased overflow-hidden font-sans relative">
      {/* Subtle atmospheric lightning aura glow */}
      <div className="absolute inset-0 pointer-events-none storm-atmospheric-overlay z-0" />

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
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto relative z-10">
        {/* Top Operational Bar */}
        <header className="h-12 border-b border-sky-500/15 px-4 sm:px-6 flex items-center justify-between shrink-0 bg-[#030712]/85 backdrop-blur-md sticky top-0 z-20 shadow-xs">
          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-zinc-400">Ingestion:</span>
              <strong className="text-emerald-400 font-semibold tracking-wide">ONLINE</strong>
            </span>
            <span className="text-zinc-700 hidden md:inline">|</span>
            <span className="hidden md:flex items-center gap-1.5">
              <span className="text-zinc-500">Tenant:</span>
              <strong className="text-sky-300 font-semibold">{currentOrg?.name || 'Workspace'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <button
              id="topbar-docs-btn"
              onClick={() => handleOpenDoc('quickstart')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#0a1226]/80 hover:bg-[#0f1b38] text-zinc-300 hover:text-sky-300 border border-sky-500/20 hover:border-sky-500/40 transition-all cursor-pointer shadow-xs"
              title="SkyOps Technical Reference & Documentation"
            >
              <BookOpen className="w-3.5 h-3.5 text-sky-400" />
              <span>Reference Docs</span>
            </button>
            <span className="text-zinc-800 hidden sm:inline">|</span>
            <span className="text-emerald-400 hidden sm:flex items-center gap-1.5 text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              Autonomous Engine Active
            </span>
            <span className="text-zinc-800 hidden sm:inline">|</span>
            <span className="text-[11px] text-zinc-400">
              Agent <strong className="text-sky-300">{AGENT_VERSION}</strong>
            </span>
          </div>
        </header>

        {/* View Routing */}
        <div className="flex-1">
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
            />
          )}

          {(activeTab === 'infrastructure' || activeTab === 'clusters') && (
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

          {activeTab === 'services' && (
            <div className="p-6 max-w-7xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold text-zinc-100">Kubernetes Services</h1>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/30">
                      Service Mesh & Ingress
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">
                    First-class observability for ClusterIP, NodePort, LoadBalancer services, backing pods, and endpoint slices.
                  </p>
                </div>
              </div>
              <ServicesView
                clusters={clusters}
                incidents={incidents}
                loading={loading || isRefreshing}
                onRefresh={handleManualRefresh}
                onSelectCluster={handleSelectCluster}
                onSelectIncident={handleSelectIncident}
              />
            </div>
          )}

          {activeTab === 'incidents' && (
            <>
              {selectedIncidentId ? (
                <IncidentDetailView
                  incidentId={selectedIncidentId}
                  onBack={handleClearIncident}
                  onSelectCluster={handleSelectCluster}
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

          {activeTab === 'audit' && (
            <AuditView />
          )}

          {activeTab === 'settings' && (
            <SettingsView
              clusters={clusters}
              onSelectIncident={handleSelectIncident}
              onRefresh={handleManualRefresh}
            />
          )}
        </div>

        {/* Global Operational Footer */}
        <Footer
          onNavigateTab={handleTabChange}
          onOpenAddCluster={() => setIsAddClusterOpen(true)}
          onOpenDoc={handleOpenDoc}
          isAuthenticated={true}
        />
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
    </div>
  );
};
