import {
  Activity,
  AlertCircle,
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Cpu,
  Download,
  FileJson,
  FileSpreadsheet,
  Filter,
  Hash,
  Info,
  Link as LinkIcon,
  Loader2,
  Lock,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Terminal,
  User as UserIcon,
  X,
  XCircle
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { auth } from '../../firebase';
import { Button, CopyButton } from '../common/UI';

interface AuditEventItem {
  id: string;
  orgId: string;
  actorId: string;
  actorName: string;
  actorType?: 'USER' | 'HUMAN' | 'AGENT' | 'AI' | 'SYSTEM' | 'WEBHOOK' | 'AUTOMATION';
  action: string;
  resourceType: string;
  resourceId: string;
  result: 'SUCCESS' | 'FAILURE' | string;
  hash?: string;
  prevHash?: string;
  details?: Record<string, any>;
  correlationId?: string;
  ipAddress?: string;
  timestamp: number;
}

interface AuditStats {
  total: number;
  actorCounts: Record<string, number>;
  actionCategories: Record<string, number>;
  lastEventTime: number | null;
  autonomousCount: number;
  securityCount: number;
  verified: boolean;
}

interface IntegrityVerification {
  verified: boolean;
  totalChecked: number;
  tampered: boolean;
  tamperedCount: number;
  latestHash: string;
  details: string;
}

export const AuditView: React.FC = () => {
  const [logs, setLogs] = useState<AuditEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Stats & Verification
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [verification, setVerification] = useState<IntegrityVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showIntegrityModal, setShowIntegrityModal] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [actorTypeFilter, setActorTypeFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchStatsAndVerification = async () => {
    try {
      const [s, v] = await Promise.all([
        api.getAuditStats().catch(() => null),
        api.verifyAuditIntegrity().catch(() => null)
      ]);
      if (s) setStats(s);
      if (v) setVerification(v);
    } catch (err) {
      console.error('Failed to fetch audit stats/verification:', err);
    }
  };

  const fetchLogs = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.getAuditLogs({
        page,
        limit,
        search: search.trim() || undefined,
        action: actionFilter || undefined,
        actorType: actorTypeFilter || undefined,
        result: resultFilter || undefined
      });

      setLogs(res.items || []);
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
  }, [page, actionFilter, actorTypeFilter, resultFilter]);

  useEffect(() => {
    fetchStatsAndVerification();
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchLogs();
  };

  const handleResetFilters = () => {
    setSearch('');
    setActionFilter('');
    setActorTypeFilter('');
    setResultFilter('');
    setPage(1);
  };

  const handleManualVerify = async () => {
    setVerifying(true);
    try {
      const v = await api.verifyAuditIntegrity();
      setVerification(v);
      setShowIntegrityModal(true);
    } catch (err) {
      console.error('Ledger verification error:', err);
    } finally {
      setVerifying(false);
    }
  };

  const handleExport = async (format: 'csv' | 'json') => {
    try {
      const activeOrgId = localStorage.getItem('skyops_active_org_id') || 'org_default';
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      
      const query = new URLSearchParams();
      query.set('format', format);
      if (search.trim()) query.set('search', search.trim());
      if (actionFilter) query.set('action', actionFilter);
      if (actorTypeFilter) query.set('actorType', actorTypeFilter);
      if (resultFilter) query.set('result', resultFilter);

      const url = `/api/v1/audit/export?${query.toString()}`;
      
      const response = await fetch(url, {
        headers: {
          'x-org-id': activeOrgId,
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {})
        }
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `skyops_audit_${activeOrgId}_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const formatTime = (ts?: number | string | null) => {
    if (!ts) return { date: '—', time: '—', iso: '' };
    const num = typeof ts === 'string' ? Date.parse(ts) : Number(ts);
    if (isNaN(num)) return { date: '—', time: '—', iso: '' };
    const d = new Date(num);
    if (isNaN(d.getTime())) return { date: '—', time: '—', iso: '' };
    try {
      return {
        date: d.toLocaleDateString(),
        time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        iso: d.toISOString()
      };
    } catch {
      return { date: '—', time: '—', iso: '' };
    }
  };

  const getActorBadge = (type?: string, name?: string) => {
    const norm = (type || '').toUpperCase();
    if (norm === 'USER' || norm === 'HUMAN') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-sky-950/50 text-sky-300 border-sky-800/70">
          <UserIcon className="w-3 h-3 text-sky-400" />
          <span>{name || 'Human Operator'}</span>
        </span>
      );
    }
    if (norm === 'AGENT') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-indigo-950/50 text-indigo-300 border-indigo-800/70">
          <Terminal className="w-3 h-3 text-indigo-400" />
          <span>{name || 'SkyOps Agent'}</span>
        </span>
      );
    }
    if (norm === 'AI') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-purple-950/50 text-purple-300 border-purple-800/70">
          <Sparkles className="w-3 h-3 text-purple-400" />
          <span>{name || 'SkyOps AI Engine'}</span>
        </span>
      );
    }
    if (norm === 'SYSTEM') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-zinc-900 text-zinc-300 border-zinc-700">
          <Cpu className="w-3 h-3 text-zinc-400" />
          <span>{name || 'System'}</span>
        </span>
      );
    }
    if (norm === 'WEBHOOK') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-amber-950/50 text-amber-300 border-amber-800/70">
          <Activity className="w-3 h-3 text-amber-400" />
          <span>{name || 'Webhook'}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-mono border bg-zinc-900 text-zinc-400 border-zinc-800">
        <span>{name || type || 'Unknown'}</span>
      </span>
    );
  };

  const humanCount = (stats?.actorCounts?.HUMAN || 0) + (stats?.actorCounts?.USER || 0);
  const agentCount = stats?.actorCounts?.AGENT || 0;
  const aiCount = stats?.actorCounts?.AI || 0;

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-7xl mx-auto w-full font-sans">
      {/* Top Header & Export Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-950/70 border border-sky-800/80 flex items-center justify-center text-sky-400 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-zinc-100 font-mono tracking-tight">Audit & Compliance Ledger</h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 flex items-center gap-1">
                  <Lock className="w-2.5 h-2.5" /> Immutable
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Tenant-isolated cryptographic log of human approvals, agent executions, AI diagnoses, and cluster actions.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualVerify}
            disabled={verifying}
            icon={<Shield className={`w-3.5 h-3.5 ${verifying ? 'animate-spin' : 'text-emerald-400'}`} />}
            className="font-mono text-xs text-zinc-200 border-zinc-700 hover:border-emerald-700/80"
          >
            {verifying ? 'Verifying...' : 'Verify Ledger'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('csv')}
            icon={<FileSpreadsheet className="w-3.5 h-3.5 text-sky-400" />}
            className="font-mono text-xs text-zinc-300 border-zinc-800"
          >
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport('json')}
            icon={<FileJson className="w-3.5 h-3.5 text-purple-400" />}
            className="font-mono text-xs text-zinc-300 border-zinc-800"
          >
            Export JSON
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              fetchLogs(true);
              fetchStatsAndVerification();
            }}
            disabled={refreshing}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
            className="font-mono text-xs"
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Events */}
        <div className="p-4 rounded-xl storm-kpi-card shadow-md">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Total Recorded Events</span>
            <Activity className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-1.5">{total}</div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">
            Across current organization tenant
          </div>
        </div>

        {/* Ledger Cryptographic Integrity */}
        <div 
          onClick={() => setShowIntegrityModal(true)}
          className="p-4 rounded-xl storm-kpi-card shadow-md hover:border-emerald-500/50 cursor-pointer transition-all group"
        >
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Cryptographic Integrity</span>
            {verification?.tampered ? (
              <ShieldAlert className="w-4 h-4 text-rose-400" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
            )}
          </div>
          <div className="text-sm font-bold font-mono mt-1.5 flex items-center gap-1.5">
            {verification ? (
              verification.tampered ? (
                <span className="text-rose-400 flex items-center gap-1">
                  <XCircle className="w-4 h-4" /> Chain Compromised
                </span>
              ) : (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" /> SHA-256 Chain Intact
                </span>
              )
            ) : (
              <span className="text-zinc-400">Verifying blocks...</span>
            )}
          </div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1 flex items-center justify-between">
            <span>{verification?.totalChecked || total} events chained</span>
            <span className="text-sky-400 group-hover:underline text-[10px]">Inspect &rarr;</span>
          </div>
        </div>

        {/* Actor Breakdown */}
        <div className="p-4 rounded-xl storm-kpi-card shadow-md">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Actor Distribution</span>
            <Bot className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="text-sm font-bold font-mono text-zinc-200 mt-2 flex items-center gap-3">
            <span className="flex items-center gap-1 text-sky-300">
              <UserIcon className="w-3.5 h-3.5" /> {humanCount} Human
            </span>
            <span className="text-zinc-600">/</span>
            <span className="flex items-center gap-1 text-indigo-300">
              <Terminal className="w-3.5 h-3.5" /> {agentCount} Agent
            </span>
            <span className="text-zinc-600">/</span>
            <span className="flex items-center gap-1 text-purple-300">
              <Sparkles className="w-3.5 h-3.5" /> {aiCount} AI
            </span>
          </div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">
            {agentCount + aiCount} autonomous actions
          </div>
        </div>

        {/* Compliance Standard & Retention */}
        <div className="p-4 rounded-xl storm-kpi-card shadow-md">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-[11px] font-mono uppercase tracking-wider">Compliance Guarantee</span>
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-base font-bold font-mono text-zinc-200 mt-1.5">
            SOC2 Type II / ISO 27001
          </div>
          <div className="text-[11px] font-mono text-zinc-500 mt-1">
            Strict tenant isolation &bull; 365-day retention
          </div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-3">
        <form onSubmit={handleSearchSubmit} className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search actions, actors, resource IDs, details, or errors..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-8 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Actor Type Selector */}
            <select
              value={actorTypeFilter}
              onChange={(e) => {
                setActorTypeFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="">All Actors</option>
              <option value="HUMAN">Human (User)</option>
              <option value="AGENT">Agent (DaemonSet)</option>
              <option value="AI">AI (Gemini Diagnostics)</option>
              <option value="SYSTEM">System Engine</option>
              <option value="WEBHOOK">Webhook Dispatcher</option>
              <option value="AUTOMATION">Autonomous Policy</option>
            </select>

            {/* Action Selector */}
            <select
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500 cursor-pointer max-w-[200px]"
            >
              <option value="">All Actions</option>
              <option value="remediation.approved">remediation.approved</option>
              <option value="remediation.executed">remediation.executed</option>
              <option value="remediation.rejected">remediation.rejected</option>
              <option value="remediation.rollback">remediation.rollback</option>
              <option value="cluster.created">cluster.created</option>
              <option value="cluster.token_rotated">cluster.token_rotated</option>
              <option value="cluster.token_revoked">cluster.token_revoked</option>
              <option value="incident.created">incident.created</option>
              <option value="incident.resolved">incident.resolved</option>
              <option value="ai.root_cause_diagnosed">ai.root_cause_diagnosed</option>
              <option value="policy.updated">policy.updated</option>
              <option value="integration.webhook_created">integration.webhook_created</option>
              <option value="auth.session_established">auth.session_established</option>
            </select>

            {/* Outcome Filter */}
            <select
              value={resultFilter}
              onChange={(e) => {
                setResultFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              <option value="">All Outcomes</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILURE">FAILURE</option>
            </select>

            <Button type="submit" variant="primary" size="sm" className="font-mono text-xs px-4">
              Apply
            </Button>

            {(search || actionFilter || actorTypeFilter || resultFilter) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                icon={<RotateCcw className="w-3 h-3" />}
                className="font-mono text-xs text-zinc-400 hover:text-zinc-200"
              >
                Reset
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Audit Log Table */}
      <div className="bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden shadow-xs">
        {loading ? (
          <div className="p-16 text-center text-zinc-400 font-mono text-xs flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            <span>Scanning cryptographic audit records...</span>
          </div>
        ) : logs.length === 0 ? (
          <div className="p-16 text-center text-zinc-500 font-mono text-xs space-y-2">
            <Shield className="w-8 h-8 text-zinc-600 mx-auto stroke-1" />
            <p className="text-zinc-400 font-semibold">No audit events match your criteria.</p>
            <p className="text-zinc-600 text-[11px]">
              Try clearing filters or changing the search terms.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900/70 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3">Timestamp (UTC)</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Result</th>
                  <th className="px-4 py-3">Block Hash (SHA-256)</th>
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
                        className={`hover:bg-zinc-900/50 cursor-pointer transition-colors ${
                          isExpanded ? 'bg-zinc-900/40' : ''
                        }`}
                      >
                        <td className="px-4 py-3 text-zinc-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-sky-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-zinc-500 hover:text-zinc-300" />
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-zinc-400">
                          <span title={time.iso} className="font-mono text-xs">
                            {time.date} <span className="text-zinc-500">{time.time}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {getActorBadge(log.actorType, log.actorName || log.actorId)}
                        </td>
                        <td className="px-4 py-3 font-semibold text-zinc-200">
                          <code className="text-sky-300 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-[11px]">
                            {log.action}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">
                          <span className="text-zinc-500 text-[10px] uppercase mr-1">{log.resourceType}:</span>
                          <span className="text-zinc-200 font-medium">{log.resourceId}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${
                              isSuccess ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {isSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            {log.result}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                          {log.hash ? (
                            <span 
                              title={`SHA-256 Hash: ${log.hash}\nPrevious Hash: ${log.prevHash || 'Genesis'}`}
                              className="text-zinc-400 font-mono hover:text-emerald-400 transition-colors flex items-center gap-1"
                            >
                              <Lock className="w-3 h-3 text-emerald-500/70 inline" />
                              {log.hash.substring(0, 10)}...
                            </span>
                          ) : (
                            <span className="text-zinc-600">Pending</span>
                          )}
                        </td>
                      </tr>

                      {/* Detail Inspection Drawer */}
                      {isExpanded && (
                        <tr className="bg-zinc-900/60">
                          <td colSpan={7} className="px-6 py-5 border-t border-b border-zinc-800">
                            <div className="space-y-4">
                              {/* Metadata Strip */}
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80">
                                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Event Identifier</div>
                                  <div className="text-xs font-mono text-zinc-200 mt-1 flex items-center justify-between">
                                    <span className="truncate mr-2">{log.id}</span>
                                    <CopyButton text={log.id} />
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80">
                                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Actor Principal</div>
                                  <div className="text-xs font-mono text-zinc-200 mt-1">
                                    <div>{log.actorName || log.actorId}</div>
                                    <div className="text-[10px] text-zinc-500 truncate">{log.actorId}</div>
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80">
                                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Resource Target</div>
                                  <div className="text-xs font-mono text-zinc-200 mt-1">
                                    <div>{log.resourceType}</div>
                                    <div className="text-[10px] text-zinc-500 truncate">{log.resourceId}</div>
                                  </div>
                                </div>

                                <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80">
                                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Timestamp (ISO 8601)</div>
                                  <div className="text-xs font-mono text-zinc-200 mt-1">
                                    {time.iso}
                                  </div>
                                </div>
                              </div>

                              {/* Cryptographic Chain Hashes */}
                              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 text-xs font-mono text-emerald-400">
                                    <LinkIcon className="w-3.5 h-3.5" />
                                    <span>Cryptographic Hash Link</span>
                                  </div>
                                  <span className="text-[10px] font-mono text-zinc-500">SHA-256 Chained</span>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                                  <div>
                                    <span className="text-zinc-500 text-[10px] block">Current Block Hash:</span>
                                    <div className="flex items-center justify-between text-zinc-300 bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800">
                                      <span className="truncate mr-2 text-emerald-400">{log.hash || 'N/A'}</span>
                                      {log.hash && <CopyButton text={log.hash} />}
                                    </div>
                                  </div>

                                  <div>
                                    <span className="text-zinc-500 text-[10px] block">Previous Block Hash (Parent):</span>
                                    <div className="flex items-center justify-between text-zinc-300 bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800">
                                      <span className="truncate mr-2 text-zinc-400">{log.prevHash || 'Genesis Block'}</span>
                                      {log.prevHash && <CopyButton text={log.prevHash} />}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Structured Details Payload */}
                              <div>
                                <div className="flex items-center justify-between mb-1.5">
                                  <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                                    <FileJson className="w-3.5 h-3.5 text-sky-400" />
                                    <span>Structured Payload & Context:</span>
                                  </div>
                                  <CopyButton text={JSON.stringify(log.details || {}, null, 2)} />
                                </div>
                                <pre className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-60 leading-relaxed">
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
          <div className="p-3 bg-zinc-900/60 border-t border-zinc-800 flex items-center justify-between text-xs font-mono text-zinc-400">
            <div>
              Page <span className="text-zinc-200 font-semibold">{page}</span> of{' '}
              <span className="text-zinc-200 font-semibold">{totalPages}</span> ({total} events)
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

      {/* Cryptographic Ledger Verification Dialog */}
      {showIntegrityModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="text-base font-bold font-mono text-zinc-100">
                  Cryptographic Ledger Verification
                </h3>
              </div>
              <button
                onClick={() => setShowIntegrityModal(false)}
                className="text-zinc-500 hover:text-zinc-300 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs font-mono text-zinc-300">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Ledger Status:</span>
                  {verification?.verified ? (
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-bold flex items-center gap-1">
                      <Check className="w-3 h-3" /> VERIFIED INTACT
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 font-bold flex items-center gap-1">
                      <X className="w-3 h-3" /> TAMPER DETECTED
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total Chained Records:</span>
                  <span className="text-zinc-200 font-semibold">{verification?.totalChecked || 0}</span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Tampered Blocks:</span>
                  <span className={`font-semibold ${verification?.tamperedCount ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {verification?.tamperedCount || 0}
                  </span>
                </div>

                <div className="space-y-1 pt-1 border-t border-zinc-800/60">
                  <span className="text-zinc-400 block">Ledger Head Hash (SHA-256):</span>
                  <div className="bg-zinc-900 px-2 py-1.5 rounded border border-zinc-800 text-[11px] text-emerald-400 break-all font-mono">
                    {verification?.latestHash || 'Genesis State'}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/60 text-zinc-400 text-[11px] leading-relaxed">
                <Info className="w-3.5 h-3.5 text-sky-400 inline mr-1" />
                SkyOps enforces an append-only SHA-256 Merkle chain. Each audit entry cryptographically incorporates the prior entry's hash, ensuring that any modification, deletion, or retrofitting of historical records is mathematically detected.
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-zinc-800">
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowIntegrityModal(false)}
                className="font-mono text-xs px-4"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
