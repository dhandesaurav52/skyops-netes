import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Key,
  Layers,
  Loader2,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  XCircle
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { Button, CodeBlock, CopyButton, Modal } from '../common/UI';

export const WebhooksManager: React.FC = () => {
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isDeliveriesOpen, setIsDeliveriesOpen] = useState(false);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formSecret, setFormSecret] = useState('');
  const [formEvents, setFormEvents] = useState<string[]>([
    'incident.created',
    'incident.resolved',
    'remediation.approved',
    'remediation.executed'
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Test Execution State
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; success: boolean; statusCode?: number; latencyMs?: number; message: string } | null>(null);

  const fetchWebhooks = async () => {
    try {
      setLoading(true);
      const res = await api.getWebhooks();
      setWebhooks(res.webhooks || []);
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formUrl.trim()) {
      setFormError('Webhook name and destination URL are required');
      return;
    }

    try {
      setSubmitting(true);
      setFormError(null);
      await api.createWebhook({
        name: formName.trim(),
        url: formUrl.trim(),
        secret: formSecret.trim() || undefined,
        enabledEvents: formEvents
      });
      setIsAddOpen(false);
      setFormName('');
      setFormUrl('');
      setFormSecret('');
      fetchWebhooks();
    } catch (err: any) {
      setFormError(err.message || 'Failed to create webhook');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this webhook endpoint?')) return;
    try {
      await api.deleteWebhook(id);
      fetchWebhooks();
    } catch (err: any) {
      alert(err.message || 'Failed to delete webhook');
    }
  };

  const handleTest = async (id: string) => {
    try {
      setTestingId(id);
      setTestResult(null);
      const res = await api.testWebhook(id);
      setTestResult({
        id,
        success: res.success,
        statusCode: res.statusCode,
        latencyMs: res.latencyMs,
        message: res.success
          ? `Ping dispatched successfully (${res.statusCode || 200} OK, ${res.latencyMs || 0}ms)`
          : `Ping failed: ${res.error || 'Endpoint returned error'}`
      });
    } catch (err: any) {
      setTestResult({
        id,
        success: false,
        message: err.message || 'Network test failed'
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleViewDeliveries = async (id: string) => {
    setSelectedWebhookId(id);
    setIsDeliveriesOpen(true);
    try {
      setLoadingDeliveries(true);
      const res = await api.getWebhookDeliveries(id);
      setDeliveries(res.deliveries || []);
    } catch (err) {
      console.error('Failed to load deliveries:', err);
    } finally {
      setLoadingDeliveries(false);
    }
  };

  const toggleEvent = (ev: string) => {
    if (formEvents.includes(ev)) {
      setFormEvents(formEvents.filter((e) => e !== ev));
    } else {
      setFormEvents([...formEvents, ev]);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h3 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
            <Webhook className="w-4 h-4 text-sky-400" />
            Outbound Webhook Integrations
          </h3>
          <p className="text-xs text-zinc-400 font-mono mt-0.5">
            Deliver signed real-time JSON webhooks to PagerDuty, Slack, Datadog, or custom SIEM systems.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setIsAddOpen(true)}
          icon={<Plus className="w-3.5 h-3.5" />}
          className="font-mono text-xs"
        >
          Add Webhook Endpoint
        </Button>
      </div>

      {testResult && (
        <div
          className={`p-3.5 rounded-lg border text-xs font-mono flex items-center justify-between ${
            testResult.success
              ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/30 border-rose-800/60 text-rose-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
          <button onClick={() => setTestResult(null)} className="text-zinc-400 hover:text-zinc-200">
            ×
          </button>
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-zinc-400 font-mono text-xs flex flex-col items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
          <span>Loading webhook integrations...</span>
        </div>
      ) : webhooks.length === 0 ? (
        <div className="p-8 rounded-xl bg-zinc-900/30 border border-zinc-800/80 text-center space-y-3">
          <Webhook className="w-8 h-8 text-zinc-600 mx-auto" />
          <div className="text-xs font-mono text-zinc-300">No outbound webhooks configured.</div>
          <p className="text-[11px] font-mono text-zinc-500 max-w-md mx-auto">
            Configure webhooks to receive instant HMAC-SHA256 authenticated alerts for incidents, approvals, and remediation executions.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddOpen(true)}
            className="font-mono text-xs"
          >
            Create Your First Webhook
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {webhooks.map((wh) => (
            <div
              key={wh.id}
              className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-xs text-zinc-100 font-mono">{wh.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-800/60 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Active
                    </span>
                  </div>
                  <div className="text-xs font-mono text-zinc-400 flex items-center gap-2">
                    <code className="text-zinc-300 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                      {wh.url}
                    </code>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={testingId === wh.id}
                    onClick={() => handleTest(wh.id)}
                    icon={
                      testingId === wh.id ? (
                        <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                      ) : (
                        <Send className="w-3 h-3 text-sky-400" />
                      )
                    }
                    className="font-mono text-xs"
                  >
                    Test Ping
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleViewDeliveries(wh.id)}
                    className="font-mono text-xs text-zinc-300"
                  >
                    History
                  </Button>
                  <button
                    onClick={() => handleDelete(wh.id)}
                    className="p-1.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 transition-colors"
                    title="Delete webhook"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Subscribed Events */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-mono text-zinc-500 uppercase mr-1">Events:</span>
                {(wh.enabledEvents || ['*']).map((ev: string) => (
                  <span
                    key={ev}
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Webhook Modal */}
      <Modal isOpen={isAddOpen} onClose={() => setIsAddOpen(false)} title="Register Outbound Webhook">
        <form onSubmit={handleCreate} className="space-y-4 text-xs font-mono">
          {formError && (
            <div className="p-2.5 rounded bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-zinc-300 font-semibold">Endpoint Name</label>
            <input
              type="text"
              placeholder="e.g. Production PagerDuty Alert Gateway"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              required
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-zinc-300 font-semibold">Target Payload URL</label>
            <input
              type="url"
              placeholder="https://api.pagerduty.com/v1/skyops-hook"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              required
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-zinc-300 font-semibold flex items-center justify-between">
              <span>HMAC-SHA256 Signing Secret (Optional)</span>
              <span className="text-[10px] text-zinc-500">Auto-generated if empty</span>
            </label>
            <input
              type="text"
              placeholder="Leave blank to auto-generate high-entropy secret"
              value={formSecret}
              onChange={(e) => setFormSecret(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="space-y-2 pt-1">
            <label className="text-zinc-300 font-semibold">Subscribed Event Topics</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              {[
                { id: 'incident.created', label: 'incident.created' },
                { id: 'incident.resolved', label: 'incident.resolved' },
                { id: 'remediation.approved', label: 'remediation.approved' },
                { id: 'remediation.executed', label: 'remediation.executed' },
                { id: 'cluster.registered', label: 'cluster.registered' },
                { id: 'cluster.disconnected', label: 'cluster.disconnected' }
              ].map((ev) => (
                <label
                  key={ev.id}
                  className="flex items-center gap-2 p-2 rounded bg-zinc-950 border border-zinc-800 cursor-pointer hover:border-zinc-700"
                >
                  <input
                    type="checkbox"
                    checked={formEvents.includes(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="rounded border-zinc-700 text-sky-600 focus:ring-0 cursor-pointer"
                  />
                  <span className="text-zinc-300">{ev.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
            <Button variant="ghost" size="sm" onClick={() => setIsAddOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={submitting}>
              {submitting ? 'Registering...' : 'Save Webhook'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delivery History Modal */}
      <Modal
        isOpen={isDeliveriesOpen}
        onClose={() => setIsDeliveriesOpen(false)}
        title="Webhook Delivery Log"
      >
        <div className="space-y-4 font-mono text-xs">
          {loadingDeliveries ? (
            <div className="p-8 text-center text-zinc-400 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
              <span>Retrieving delivery attempts...</span>
            </div>
          ) : deliveries.length === 0 ? (
            <div className="p-6 text-center text-zinc-500">
              No recorded delivery attempts for this endpoint yet.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {deliveries.map((del) => (
                <div
                  key={del.id}
                  className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-200">{del.event}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                          del.statusCode >= 200 && del.statusCode < 300
                            ? 'bg-emerald-950/40 text-emerald-400'
                            : 'bg-rose-950/40 text-rose-400'
                        }`}
                      >
                        HTTP {del.statusCode || 'ERR'}
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-500">
                      {new Date(del.timestamp).toLocaleTimeString()} ({del.latencyMs || 0}ms)
                    </div>
                  </div>
                  <span className="text-[11px] text-zinc-400">
                    Attempts: {del.attempts || 1}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button variant="secondary" size="sm" onClick={() => setIsDeliveriesOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
