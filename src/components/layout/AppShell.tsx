import { Bell, HelpCircle, Shield, Terminal } from 'lucide-react';
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
import { SettingsView } from '../settings/SettingsView';
import { AuditView } from '../audit/AuditView';
import { NavigationTab, Sidebar } from './Sidebar';

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
  const [isAddClusterOpen, setIsAddClusterOpen] = useState(initialOpenAddCluster);

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
    fetchGlobalData();
    // 10-second background polling for live agent pulses and incidents
    const interval = setInterval(() => fetchGlobalData(false), 10000);
    return () => clearInterval(interval);
  }, [currentOrg?.id]);

  const handleSelectCluster = (id: string) => {
    setSelectedClusterId(id);
    setSelectedIncidentId(null);
    setActiveTab('clusters');
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
    <div className="flex h-screen bg-zinc-950 text-zinc-100 antialiased overflow-hidden font-sans">
      {/* Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={handleTabChange}
        openIncidentsCount={openIncidentsCount}
        onOpenAddCluster={() => setIsAddClusterOpen(true)}
        onSignOut={onSignOut}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-zinc-950">
        {/* Top Operational Bar */}
        <header className="h-12 border-b border-zinc-800/80 px-6 flex items-center justify-between shrink-0 bg-zinc-950/80 backdrop-blur-xs">
          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Central Ingestion API: <strong className="text-zinc-200">Online</strong>
            </span>
            <span className="text-zinc-700">|</span>
            <span>
              Tenant: <strong className="text-sky-400">{currentOrg?.name || 'Workspace'}</strong>
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Autonomous Engine Active
            </span>
            <span className="text-zinc-700">|</span>
            <span>
              SkyOps Agent Version: <strong className="text-zinc-200">{AGENT_VERSION}</strong>
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
    </div>
  );
};
