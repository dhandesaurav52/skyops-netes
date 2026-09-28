import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Clock,
  Filter,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Cluster, Incident, IncidentSeverity, IncidentStatus } from '../../types/index';
import { SeverityBadge, StatusBadge } from '../common/Badges';
import { Button, EmptyState } from '../common/UI';

interface IncidentsViewProps {
  incidents: Incident[];
  clusters: Cluster[];
  onSelectIncident: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({
  incidents,
  clusters,
  onSelectIncident,
  onRefresh,
  loading
}) => {
  const { canEditIncidents } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [clusterFilter, setClusterFilter] = useState<string>('ALL');
  const [clearing, setClearing] = useState(false);

  const handleClearAll = async () => {
    if (!window.confirm('Are you sure you want to clear all incident tickets? Any active failing resources will regenerate tickets on the next telemetry sync.')) return;
    try {
      setClearing(true);
      await api.clearAllIncidents();
      onRefresh();
    } catch (err) {
      console.error('Failed to clear incidents:', err);
    } finally {
      setClearing(false);
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

  const safeIncidents = Array.isArray(incidents) ? incidents : [];
  const safeClusters = Array.isArray(clusters) ? clusters : [];

  const filteredIncidents = safeIncidents.filter((inc) => {
    if (!inc) return false;
    // Search
    const q = (searchTerm || '').toLowerCase().trim();
    const matchesSearch =
      !q ||
      (inc.id && inc.id.toLowerCase().includes(q)) ||
      (inc.title && inc.title.toLowerCase().includes(q)) ||
      (inc.resourceName && inc.resourceName.toLowerCase().includes(q)) ||
      (inc.namespace && inc.namespace.toLowerCase().includes(q)) ||
      (inc.clusterName && inc.clusterName.toLowerCase().includes(q)) ||
      (inc.incidentType && inc.incidentType.toLowerCase().includes(q));

    // Status
    const matchesStatus = statusFilter === 'ALL' || inc.status === statusFilter;

    // Severity
    const matchesSeverity = severityFilter === 'ALL' || inc.severity === severityFilter;

    // Cluster
    const matchesCluster = clusterFilter === 'ALL' || inc.clusterId === clusterFilter;

    return Boolean(matchesSearch && matchesStatus && matchesSeverity && matchesCluster);
  });

  const activeFiltersCount =
    (statusFilter !== 'ALL' ? 1 : 0) + (severityFilter !== 'ALL' ? 1 : 0) + (clusterFilter !== 'ALL' ? 1 : 0);

  const resetFilters = () => {
    setStatusFilter('ALL');
    setSeverityFilter('ALL');
    setClusterFilter('ALL');
    setSearchTerm('');
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-sky-500/15 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2.5 font-mono">
            <span className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <AlertTriangle className="w-5 h-5" />
            </span>
            Deterministic Incident Tickets
          </h1>
          <p className="text-xs font-mono text-zinc-400 mt-1">
            Deduplicated Kubernetes failure states, occurrence counters, and automated investigation telemetry
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditIncidents && incidents.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearAll}
              disabled={loading || clearing}
              icon={<Trash2 className="w-3.5 h-3.5 text-zinc-400" />}
              className="text-zinc-400 hover:text-rose-400 hover:border-rose-500/40"
            >
              Clear All
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : 'text-zinc-400'}`} />}
            className="border-sky-500/20 hover:border-sky-500/40 bg-[#081024]/60 hover:bg-[#0c1836] text-zinc-300"
          >
            Refresh Incidents
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="storm-card rounded-xl p-4 space-y-3 font-mono text-xs">
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
          {/* Search Box */}
          <div className="sm:col-span-4 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-sky-400/60" />
            <input
              type="text"
              placeholder="Search SKY ID, resource, namespace..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-[#030712] border border-sky-500/25 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 transition-all"
            />
          </div>

          {/* Status Filter */}
          <div className="sm:col-span-3">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#030712] border border-sky-500/25 rounded-lg text-zinc-200 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              <option value="ALL">Status: All</option>
              <option value="OPEN">Status: OPEN</option>
              <option value="ACKNOWLEDGED">Status: ACKNOWLEDGED</option>
              <option value="IN_PROGRESS">Status: IN_PROGRESS</option>
              <option value="RESOLVED">Status: RESOLVED</option>
              <option value="CLOSED">Status: CLOSED</option>
            </select>
          </div>

          {/* Severity Filter */}
          <div className="sm:col-span-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#030712] border border-sky-500/25 rounded-lg text-zinc-200 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              <option value="ALL">Severity: All</option>
              <option value="CRITICAL">CRITICAL</option>
              <option value="HIGH">HIGH</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="LOW">LOW</option>
              <option value="INFO">INFO</option>
            </select>
          </div>

          {/* Cluster Filter */}
          <div className="sm:col-span-3">
            <select
              value={clusterFilter}
              onChange={(e) => setClusterFilter(e.target.value)}
              className="w-full px-3 py-1.5 bg-[#030712] border border-sky-500/25 rounded-lg text-zinc-200 focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              <option value="ALL">Cluster: All Clusters</option>
              {safeClusters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name || c.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {activeFiltersCount > 0 && (
          <div className="flex items-center justify-between pt-2 border-t border-sky-500/10 text-[11px] text-zinc-400">
            <span>{activeFiltersCount} active filter(s) applied</span>
            <button
              onClick={resetFilters}
              className="text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer transition-colors"
            >
              <X className="w-3 h-3" />
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Incidents Table */}
      {filteredIncidents.length === 0 ? (
        <EmptyState
          title={safeIncidents.length === 0 ? 'No active incidents' : 'No matching incidents'}
          description={
            safeIncidents.length === 0
              ? 'SkyOps has not detected any failure conditions on your clusters.'
              : 'Try clearing your active filters or modifying search keywords.'
          }
        />
      ) : (
        <div className="storm-card rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#050b18]/90 border-b border-sky-500/15 text-zinc-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-5 py-3.5">Incident ID</th>
                  <th className="px-5 py-3.5">Severity</th>
                  <th className="px-5 py-3.5">Title / Problem</th>
                  <th className="px-5 py-3.5">Cluster / Target Resource</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5">Occurrences</th>
                  <th className="px-5 py-3.5">Last Seen</th>
                  <th className="px-5 py-3.5 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sky-500/10 text-zinc-300">
                {filteredIncidents.map((inc) => (
                  <tr
                    key={inc.id}
                    onClick={() => onSelectIncident(inc.id)}
                    className="hover:bg-sky-950/20 transition-all cursor-pointer group"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-bold text-sky-400 font-mono group-hover:text-sky-300 transition-colors">{inc.id}</span>
                      <div className="text-[10px] text-zinc-500 font-sans mt-0.5">{inc.incidentType || 'Failure'}</div>
                    </td>

                    <td className="px-5 py-3.5">
                      <SeverityBadge severity={inc.severity} size="sm" />
                    </td>

                    <td className="px-5 py-3.5 max-w-sm">
                      <div className="font-semibold text-zinc-100 truncate group-hover:text-white transition-colors">{inc.title || 'Incident Anomaly'}</div>
                      {inc.technicalDetails?.reason && (
                        <div className="text-[11px] text-zinc-400 truncate mt-0.5">
                          Reason: {inc.technicalDetails.reason}
                        </div>
                      )}
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="text-zinc-200 font-medium">{inc.clusterName || inc.clusterId || 'Cluster'}</div>
                      <div className="text-[11px] text-zinc-500 truncate">
                        ns: <strong className="text-zinc-400">{inc.namespace || 'default'}</strong> • {inc.resourceKind || 'Workload'}/
                        {inc.resourceName || 'Resource'}
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      <StatusBadge status={inc.status} size="sm" />
                    </td>

                    <td className="px-5 py-3.5">
                      <span className="font-bold text-sky-200 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/60">
                        {inc.occurrenceCount}x
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-zinc-400 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-zinc-300">
                        <Clock className="w-3.5 h-3.5 text-sky-400/70" />
                        {formatTimeAgo(inc.lastSeenAt)}
                      </div>
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => onSelectIncident(inc.id)}
                        className="px-3 py-1 bg-sky-950/70 hover:bg-sky-900/80 text-sky-300 border border-sky-700/60 rounded text-xs transition-colors cursor-pointer group-hover:border-sky-500"
                      >
                        Investigate →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
