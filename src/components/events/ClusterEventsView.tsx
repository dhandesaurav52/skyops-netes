import {
  AlertCircle,
  AlertTriangle,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Filter,
  Layers,
  RefreshCw,
  Search,
  Server,
  X
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { K8sEvent, KubernetesResource } from '../../types/index';
import { WorkloadKindBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { formatEventTimestamp, formatTimeAgo, safeEventTimestamp } from '../../utils/date';

interface ClusterEventsViewProps {
  events: K8sEvent[];
  clusterResources?: KubernetesResource[];
  onSelectResource?: (resource: KubernetesResource) => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const ClusterEventsView: React.FC<ClusterEventsViewProps> = ({
  events = [],
  clusterResources = [],
  onSelectResource,
  onRefresh,
  isLoading = false
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedType, setSelectedType] = useState<'ALL' | 'Warning' | 'Normal'>('ALL');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('ALL');
  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [selectedReason, setSelectedReason] = useState<string>('ALL');

  // Extract unique namespaces, kinds, and reasons
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.namespace) set.add(e.namespace);
    });
    return Array.from(set).sort();
  }, [events]);

  const kinds = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.objectKind) set.add(e.objectKind);
    });
    return Array.from(set).sort();
  }, [events]);

  const reasons = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => {
      if (e.reason) set.add(e.reason);
    });
    return Array.from(set).sort();
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (selectedType !== 'ALL' && e.type !== selectedType) return false;
      if (selectedNamespace !== 'ALL' && e.namespace !== selectedNamespace) return false;
      if (selectedKind !== 'ALL' && e.objectKind !== selectedKind) return false;
      if (selectedReason !== 'ALL' && e.reason !== selectedReason) return false;

      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesMsg = (e.message || '').toLowerCase().includes(q);
        const matchesReason = (e.reason || '').toLowerCase().includes(q);
        const matchesName = (e.objectName || '').toLowerCase().includes(q);
        const matchesKind = (e.objectKind || '').toLowerCase().includes(q);
        const matchesSource = (e.source || '').toLowerCase().includes(q);
        if (!matchesMsg && !matchesReason && !matchesName && !matchesKind && !matchesSource) {
          return false;
        }
      }

      return true;
    });
  }, [events, selectedType, selectedNamespace, selectedKind, selectedReason, searchTerm]);

  // Statistics
  const warningCount = useMemo(() => events.filter((e) => e.type === 'Warning').length, [events]);
  const normalCount = useMemo(() => events.filter((e) => e.type === 'Normal').length, [events]);
  const repeatingCount = useMemo(() => events.filter((e) => (e.count || 1) > 1).length, [events]);

  // Match event to resource in cluster
  const findTargetResource = (kind?: string, namespace?: string, name?: string) => {
    if (!kind || !name) return undefined;
    return clusterResources.find(
      (r) =>
        r.kind.toLowerCase() === kind.toLowerCase() &&
        r.name.toLowerCase() === name.toLowerCase() &&
        (!namespace || (r.namespace || '').toLowerCase() === namespace.toLowerCase())
    );
  };

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(filteredEvents, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `k8s-events-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setSelectedType('ALL');
    setSelectedNamespace('ALL');
    setSelectedKind('ALL');
    setSelectedReason('ALL');
  };

  const hasActiveFilters =
    searchTerm !== '' ||
    selectedType !== 'ALL' ||
    selectedNamespace !== 'ALL' ||
    selectedKind !== 'ALL' ||
    selectedReason !== 'ALL';

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1">
          <div className="text-zinc-500 text-[11px] uppercase tracking-wider">Total Observed Events</div>
          <div className="text-xl font-bold text-zinc-100">{events.length}</div>
        </div>

        <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1">
          <div className="text-zinc-500 text-[11px] uppercase tracking-wider">Warning Events</div>
          <div className="text-xl font-bold text-rose-400 flex items-center gap-2">
            <span>{warningCount}</span>
            {warningCount > 0 && <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />}
          </div>
        </div>

        <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1">
          <div className="text-zinc-500 text-[11px] uppercase tracking-wider">Normal / Progress</div>
          <div className="text-xl font-bold text-emerald-400">{normalCount}</div>
        </div>

        <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl space-y-1">
          <div className="text-zinc-500 text-[11px] uppercase tracking-wider">Repeating Signals</div>
          <div className="text-xl font-bold text-amber-400">{repeatingCount}</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="p-4 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter by reason, message, pod, or controller..."
              className="w-full pl-9 pr-8 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 text-xs outline-none focus:border-sky-500"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Severity Selector Pills */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 shrink-0">
            <button
              onClick={() => setSelectedType('ALL')}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                selectedType === 'ALL'
                  ? 'bg-zinc-800 text-zinc-100 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              All ({events.length})
            </button>
            <button
              onClick={() => setSelectedType('Warning')}
              className={`px-3 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                selectedType === 'Warning'
                  ? 'bg-rose-950 text-rose-300 border border-rose-800 font-bold'
                  : 'text-rose-400 hover:text-rose-300'
              }`}
            >
              <AlertTriangle className="w-3 h-3" />
              Warnings ({warningCount})
            </button>
            <button
              onClick={() => setSelectedType('Normal')}
              className={`px-3 py-1 rounded text-xs transition-colors flex items-center gap-1 ${
                selectedType === 'Normal'
                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold'
                  : 'text-emerald-400 hover:text-emerald-300'
              }`}
            >
              <CheckCircle2 className="w-3 h-3" />
              Normal ({normalCount})
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={isLoading}
                title="Refresh cluster events"
                className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            )}

            <button
              onClick={handleExportJSON}
              disabled={filteredEvents.length === 0}
              title="Export events as JSON"
              className="p-1.5 rounded-lg bg-zinc-950 border border-zinc-800 text-zinc-300 hover:text-white hover:border-zinc-700 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Dropdowns row */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-800/80 text-[11px]">
          {/* Namespace Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Namespace:</span>
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded px-2 py-1 outline-none focus:border-sky-500"
            >
              <option value="ALL">All Namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>
          </div>

          {/* Kind Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Kind:</span>
            <select
              value={selectedKind}
              onChange={(e) => setSelectedKind(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded px-2 py-1 outline-none focus:border-sky-500"
            >
              <option value="ALL">All Object Kinds</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>

          {/* Reason Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Reason:</span>
            <select
              value={selectedReason}
              onChange={(e) => setSelectedReason(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 text-zinc-200 rounded px-2 py-1 outline-none focus:border-sky-500 max-w-xs truncate"
            >
              <option value="ALL">All Reasons</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="ml-auto text-sky-400 hover:text-sky-300 text-[11px] flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Events Table */}
      <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden">
        {filteredEvents.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 space-y-2">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-full w-fit mx-auto text-zinc-500">
              <Calendar className="w-6 h-6" />
            </div>
            <div className="text-sm font-semibold text-zinc-300">No Events Found</div>
            <div className="text-xs text-zinc-500 max-w-md mx-auto">
              {hasActiveFilters
                ? 'No Kubernetes events match the current filter criteria.'
                : 'No warning or normal events have been recorded in the observation window.'}
            </div>
            {hasActiveFilters && (
              <Button size="sm" variant="secondary" onClick={handleClearFilters} className="mt-2">
                Clear Filters
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Involved Object</th>
                  <th className="px-4 py-3">Source</th>
                  <th className="px-4 py-3">Message & Diagnostic Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredEvents.map((evt) => {
                  const targetRes = findTargetResource(evt.objectKind, evt.namespace, evt.objectName);
                  const isWarning = evt.type === 'Warning';
                  const count = evt.count || 1;

                  return (
                    <tr
                      key={evt.id}
                      className={`transition-colors ${
                        isWarning
                          ? 'hover:bg-rose-950/20 bg-rose-950/5'
                          : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      {/* Timestamp & Count */}
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <div className="text-zinc-200 font-semibold">
                          {formatTimeAgo(safeEventTimestamp(evt))}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {formatEventTimestamp(safeEventTimestamp(evt))}
                        </div>
                        {count > 1 && (
                          <span
                            className="mt-1 inline-block px-1.5 py-0.2 rounded bg-amber-950/80 text-amber-300 border border-amber-800 text-[10px] font-bold"
                            title={`Repeated ${count} times (last: ${formatEventTimestamp(safeEventTimestamp(evt))})`}
                          >
                            {count}x
                          </span>
                        )}
                      </td>

                      {/* Type Badge */}
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold inline-flex items-center gap-1 ${
                            isWarning
                              ? 'bg-rose-950/80 text-rose-300 border border-rose-800'
                              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                          }`}
                        >
                          {isWarning ? <AlertTriangle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                          {evt.type}
                        </span>
                      </td>

                      {/* Reason */}
                      <td className="px-4 py-3 whitespace-nowrap align-top">
                        <span
                          className={`font-bold ${
                            isWarning ? 'text-rose-300' : 'text-zinc-200'
                          }`}
                        >
                          {evt.reason}
                        </span>
                      </td>

                      {/* Involved Object */}
                      <td className="px-4 py-3 align-top">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <WorkloadKindBadge kind={evt.objectKind || 'Object'} size="sm" />
                            {targetRes && onSelectResource ? (
                              <button
                                onClick={() => onSelectResource(targetRes)}
                                className="font-bold text-sky-400 hover:text-sky-300 hover:underline truncate max-w-xs text-left"
                                title="Inspect resource details"
                              >
                                {evt.objectName}
                              </button>
                            ) : (
                              <span className="font-semibold text-zinc-200 truncate max-w-xs">
                                {evt.objectName}
                              </span>
                            )}
                          </div>
                          {evt.namespace && (
                            <div className="text-[10px] text-zinc-500">
                              ns: <span className="text-zinc-400">{evt.namespace}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3 whitespace-nowrap align-top text-zinc-500 text-[11px]">
                        {evt.source || 'controller'}
                      </td>

                      {/* Message */}
                      <td className="px-4 py-3 text-zinc-300 align-top">
                        <div className="text-xs leading-relaxed max-w-xl break-words">
                          {evt.message}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
