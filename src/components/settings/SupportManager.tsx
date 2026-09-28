import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Headphones,
  LifeBuoy,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Cluster, SupportTicket, TicketCategory, TicketSeverity } from '../../types/index';
import { Button } from '../common/UI';

interface SupportManagerProps {
  clusters?: Cluster[];
}

export const SupportManager: React.FC<SupportManagerProps> = ({ clusters = [] }) => {
  const { currentOrg, user } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New ticket modal
  const [showModal, setShowModal] = useState(false);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('INCIDENT');
  const [severity, setSeverity] = useState<TicketSeverity>('HIGH');
  const [description, setDescription] = useState('');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const loadTickets = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getSupportTickets();
      setTickets(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load support tickets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, [currentOrg?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setError('Please provide both a subject and details for your support request');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      await api.createSupportTicket({
        subject: subject.trim(),
        category,
        severity,
        description: description.trim(),
        clusterId: selectedClusterId || undefined
      });

      setSuccessMsg('Support ticket dispatched to SkyOps Enterprise Operations.');
      setShowModal(false);
      setSubject('');
      setDescription('');
      setSelectedClusterId('');
      loadTickets();
      setTimeout(() => setSuccessMsg(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch support ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toast notifications */}
      {successMsg && (
        <div className="p-3 bg-emerald-950/40 border border-emerald-800/80 rounded-lg text-emerald-300 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-300">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Header card */}
      <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
              <Headphones className="w-4 h-4 text-sky-400" />
              Enterprise Support & Incident Escapes
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Direct access to SkyOps site reliability engineering team with guaranteed enterprise SLA responses.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadTickets}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              className="font-mono text-xs"
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setShowModal(true);
                setError(null);
              }}
              icon={<Plus className="w-3.5 h-3.5" />}
              className="font-mono text-xs"
            >
              Open Support Ticket
            </Button>
          </div>
        </div>

        {/* SLA Tier Guidelines */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="flex items-center gap-1.5 text-rose-400 font-semibold mb-1">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>CRITICAL</span>
            </div>
            <div className="text-zinc-300 text-[11px]">&lt; 1 Hour Response</div>
            <div className="text-zinc-500 text-[10px] mt-0.5">Production outage or catastrophic cluster disruption</div>
          </div>

          <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="flex items-center gap-1.5 text-amber-400 font-semibold mb-1">
              <Clock className="w-3.5 h-3.5" />
              <span>HIGH</span>
            </div>
            <div className="text-zinc-300 text-[11px]">&lt; 4 Hours Response</div>
            <div className="text-zinc-500 text-[10px] mt-0.5">Degraded workload or recurring crash-loops</div>
          </div>

          <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="flex items-center gap-1.5 text-sky-400 font-semibold mb-1">
              <MessageSquare className="w-3.5 h-3.5" />
              <span>MEDIUM</span>
            </div>
            <div className="text-zinc-300 text-[11px]">&lt; 12 Hours Response</div>
            <div className="text-zinc-500 text-[10px] mt-0.5">Agent connectivity questions or non-critical issues</div>
          </div>

          <div className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-lg">
            <div className="flex items-center gap-1.5 text-zinc-400 font-semibold mb-1">
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>LOW</span>
            </div>
            <div className="text-zinc-300 text-[11px]">&lt; 24 Hours Response</div>
            <div className="text-zinc-500 text-[10px] mt-0.5">General technical advice or product inquiries</div>
          </div>
        </div>
      </div>

      {/* Tickets Table */}
      <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
        <h4 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-sky-400" />
          Submitted Support Tickets ({tickets.length})
        </h4>

        <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
              <tr>
                <th className="px-4 py-2.5">Ticket</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Severity</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Submitted By</th>
                <th className="px-4 py-2.5 text-right">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    No support tickets submitted for this workspace yet.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-zinc-900/40">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-zinc-200">{t.subject}</div>
                      <div className="text-[11px] text-zinc-500 truncate max-w-xs">{t.description}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300">
                        {t.category}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] border font-semibold ${
                          t.severity === 'CRITICAL'
                            ? 'bg-rose-950/40 text-rose-400 border-rose-800'
                            : t.severity === 'HIGH'
                            ? 'bg-amber-950/40 text-amber-400 border-amber-800'
                            : t.severity === 'MEDIUM'
                            ? 'bg-sky-950/40 text-sky-400 border-sky-800'
                            : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                        }`}
                      >
                        {t.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-sky-950/40 text-sky-400 border border-sky-800 text-[10px]">
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-400 text-[11px]">{t.userName || t.userEmail}</td>
                    <td className="px-4 py-3 text-right text-zinc-500 text-[11px]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Ticket Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h4 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <Headphones className="w-4 h-4 text-sky-400" />
                Dispatch Enterprise Support Request
              </h4>
              <button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 font-mono text-xs">
              <div>
                <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Ticket Subject</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Ingestion latency spike or agent token rotation failure"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as TicketCategory)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="INCIDENT">INCIDENT</option>
                    <option value="AGENT">AGENT</option>
                    <option value="PLATFORM">PLATFORM</option>
                    <option value="BILLING_QUERY">BILLING_QUERY</option>
                    <option value="GENERAL">GENERAL</option>
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as TicketSeverity)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="CRITICAL">CRITICAL (&lt; 1h SLA)</option>
                    <option value="HIGH">HIGH (&lt; 4h SLA)</option>
                    <option value="MEDIUM">MEDIUM (&lt; 12h SLA)</option>
                    <option value="LOW">LOW (&lt; 24h SLA)</option>
                  </select>
                </div>
              </div>

              {clusters.length > 0 && (
                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Associated Cluster (Optional)</label>
                  <select
                    value={selectedClusterId}
                    onChange={(e) => setSelectedClusterId(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                  >
                    <option value="">-- No specific cluster --</option>
                    {clusters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Detailed Description & Context</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Describe the operational issue, error outputs, affected workloads, or steps taken..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowModal(false)} disabled={submitting}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={submitting}
                  icon={<Send className="w-3.5 h-3.5" />}
                >
                  {submitting ? 'Dispatching...' : 'Dispatch Ticket'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
