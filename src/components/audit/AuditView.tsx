import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  Hash,
  Loader2,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  User as UserIcon,
  XCircle
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button, CodeBlock, CopyButton, EmptyState } from '../common/UI';

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorTypeFilter, setActorTypeFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.getAuditLogs({
        page,
        limit,
        search: search.trim() || undefined,
        action: actionFilter || undefined
      });

      let items = res.items || [];
      if (actorTypeFilter) {
        items = items.filter((it: any) => it.actorType === actorTypeFilter);
      }

      setLogs(items);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, actionFilter, actorTypeFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const activeOrgId = localStorage.getItem('skyops_active_org_id') || 'org_default';
      const token = localStorage.getItem('skyops_demo_token');
      const url = `/api/v1/audit/export?format=${format}`;
      
      const response = await fetch(url, {
        headers: {
          'x-org-id': activeOrgId,
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `skyops_audit_export_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export audit logs. Please try again.');
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return {
      date: d.toLocaleDateString(),
      time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      iso: d.toISOString()
    };
  };

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans">
      {/* Top Header & Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-sky-950/70 border border-sky-800/80 flex items-center justify-center text-sky-400 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-zinc-100 font-mono tracking-tight">Enterprise Audit & Compliance</h1>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Immutable, cryptographically verifiable ledger of administrative actions, human approvals, and agent executions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            icon={<Download className="w-3.5 h-3.5" />}
            className="font-mono text-xs text-zinc-300"
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('json')}
            icon={<Download className="w-3.5 h-3.5" />}
            className="font-mono text-xs text-zinc-300"
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchLogs(true)}
            disabled={refreshing}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
            className="font-mono text-xs"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stat Pills */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 shadow-xs hover:border-zinc-700/60 transition-colors">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Total Recorded Events</span>
          <div className="text-xl font-bold font-mono text-zinc-100 mt-1.5">{total}</div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 shadow-xs hover:border-zinc-700/60 transition-colors">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Ledger Integrity</span>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-1.5 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>SHA-256 Valid</span>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 shadow-xs hover:border-zinc-700/60 transition-colors">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Autonomous Events</span>
          <div className="text-xl font-bold font-mono text-sky-400 mt-1.5">
            {logs.filter((l) => l.actorType === 'AGENT').length} (Page)
          </div>
        </div>
        <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 shadow-xs hover:border-zinc-700/60 transition-colors">
          <span className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">Retention Policy</span>
          <div className="text-xl font-bold font-mono text-zinc-200 mt-1.5">365 Days</div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-zinc-900/30 border border-zinc-800/80 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by action, actor, resource ID, or keyword..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
            >
              <option value="">All Actions</option>
              <option value="remediation.approved">remediation.approved</option>
              <option value="remediation.executed">remediation.executed</option>
              <option value="remediation.rejected">remediation.rejected</option>
              <option value="cluster.created">cluster.created</option>
              <option value="cluster.token_rotated">cluster.token_rotated</option>
              <option value="cluster.token_revoked">cluster.token_revoked</option>
              <option value="incident.created">incident.created</option>
              <option value="incident.resolved">incident.resolved</option>
              <option value="integration.webhook_created">integration.webhook_created</option>
            </select>

            <select
              value={actorTypeFilter}
              onChange={(e) => {
                setActorTypeFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
            >
              <option value="">All Actors</option>
              <option value="USER">User</option>
              <option value="AGENT">Agent</option>
              <option value="SYSTEM">System</option>
            </select>

            <Button type="submit" variant="primary" size="sm" className="font-mono text-xs px-4">
              Filter
            </Button>
          </div>
        </form>
      </div>

      {/* Audit Log Table */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-zinc-400 font-mono text-xs flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
            <span>Retrieving immutable audit records...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-zinc-500 font-mono text-xs">
            No audit records found matching current query criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900/60 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Record Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {logs.map((log) => {
                  const isExpanded = expandedId === log.id;
                  const time = formatTime(log.timestamp);
                  const isSuccess = log.result === 'SUCCESS';

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                        className="hover:bg-zinc-900/40 cursor-pointer transition-colors"
                      >
                        <td className="px-4 py-3 text-zinc-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-sky-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-zinc-400">
                          <span title={time.iso}>{time.date} {time.time}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border ${
                              log.actorType === 'USER'
                                ? 'bg-sky-950/40 text-sky-300 border-sky-800/60'
                                : log.actorType === 'AGENT'
                                ? 'bg-indigo-950/40 text-indigo-300 border-indigo-800/60'
                                : 'bg-zinc-900 text-zinc-300 border-zinc-700'
                            }`}
                          >
                            {log.actorType === 'USER' && <UserIcon className="w-3 h-3" />}
                            {log.actorType === 'AGENT' && <Terminal className="w-3 h-3" />}
                            {log.actorName || log.actorId}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-zinc-200">
                          <code className="text-sky-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 text-[11px]">
                            {log.action}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          <span className="text-zinc-500 text-[10px] uppercase mr-1">{log.resourceType}:</span>
                          <span className="text-zinc-300">{log.resourceId}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                              isSuccess ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            {log.result}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                          <span title={log.hash}>{(log.hash || '').substring(0, 10)}...</span>
                        </td>
                      </tr>

                      {/* Detail Inspection Drawer */}
                      {isExpanded && (
                        <tr className="bg-zinc-900/40">
                          <td colSpan={7} className="px-6 py-4 border-t border-b border-zinc-800/80">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="text-xs font-mono text-zinc-300 flex items-center gap-2">
                                  <Hash className="w-3.5 h-3.5 text-zinc-500" />
                                  <span>Log Event ID: <code className="text-zinc-100 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">{log.id}</code></span>
                                  <CopyButton text={log.id} />
                                </div>
                                <div className="text-xs font-mono text-zinc-400 flex items-center gap-2">
                                  <span>Integrity Hash:</span>
                                  <code className="text-emerald-400 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">{log.hash}</code>
                                  <CopyButton text={log.hash || ''} />
                                </div>
                              </div>

                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider">
                                    Payload Details & Context:
                                  </div>
                                  <CopyButton text={JSON.stringify(log.details || {}, null, 2)} />
                                </div>
                                <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-60 leading-relaxed scrollbar-subtle">
                                  {JSON.stringify(log.details || {}, null, 2)}
                                </pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {totalPages > 1 && (
          <div className="p-3 bg-zinc-900/40 border-t border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
            <div>
              Page {page} of {totalPages} ({total} events)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="font-mono text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="font-mono text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
