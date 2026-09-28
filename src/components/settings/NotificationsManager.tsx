import {
  CheckCircle2,
  Mail,
  ShieldCheck
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export const NotificationsManager: React.FC = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [incidentEmailEnabled, setIncidentEmailEnabled] = useState(false);
  const [sender, setSender] = useState('SkyOps <skyopsnetes2000@gmail.com>');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await api.getNotificationSettings();
      setIncidentEmailEnabled(res.incidentEmailEnabled);
      if (res.sender) setSender(res.sender);
    } catch (err: any) {
      console.error('Failed to load notification settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleToggle = async (checked: boolean) => {
    try {
      setSaving(true);
      setFeedbackMessage(null);
      const res = await api.updateNotificationSettings(checked);
      setIncidentEmailEnabled(res.incidentEmailEnabled);
      setFeedbackMessage(
        checked
          ? 'Incident email notifications enabled. You will receive alerts when incidents are detected.'
          : 'Incident email notifications disabled.'
      );
      setTimeout(() => setFeedbackMessage(null), 4000);
    } catch (err: any) {
      setFeedbackMessage(`Error saving preferences: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const registeredEmail = user?.email || 'authenticated-user@skyops.internal';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Main Settings Card */}
      <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-6">
        {/* Header & Toggle */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
              <Mail className="w-5 h-5 text-sky-400" />
              Incident Email Notifications
            </h3>
            <p className="text-xs text-zinc-400">
              Receive structured incident reports automatically when Kubernetes issues are detected.
            </p>
          </div>

          <div className="flex items-center gap-3 self-start sm:self-center">
            <span
              className={`text-xs font-mono font-semibold px-2.5 py-1 rounded-full border ${
                incidentEmailEnabled
                  ? 'bg-emerald-950/60 border-emerald-800/80 text-emerald-400'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400'
              }`}
            >
              {incidentEmailEnabled ? 'ON' : 'OFF'}
            </span>

            {/* Toggle Switch */}
            <button
              id="incident-email-toggle"
              type="button"
              role="switch"
              aria-checked={incidentEmailEnabled}
              disabled={loading || saving}
              onClick={() => handleToggle(!incidentEmailEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-zinc-900 ${
                incidentEmailEnabled ? 'bg-sky-500' : 'bg-zinc-700'
              } ${loading || saving ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  incidentEmailEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {feedbackMessage && (
          <div className="p-3 rounded-lg bg-sky-950/40 border border-sky-800/70 text-xs font-mono text-sky-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>{feedbackMessage}</span>
          </div>
        )}

        {/* Informational Details when ON or OFF */}
        <div className="p-4 rounded-lg bg-zinc-950/60 border border-zinc-800/60 space-y-3">
          {incidentEmailEnabled ? (
            <div className="space-y-3 text-xs text-zinc-300 leading-relaxed">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <div>
                  <span className="font-semibold text-zinc-100">Active: </span>
                  SkyOps automatically sends a professionally formatted incident email from{' '}
                  <span className="font-mono text-sky-300 bg-sky-950/40 px-1.5 py-0.5 rounded border border-sky-900/50">
                    {sender}
                  </span>{' '}
                  to your registered email address{' '}
                  <span className="font-mono text-zinc-100 font-semibold">{registeredEmail}</span>.
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-zinc-400">
                <ShieldCheck className="w-4 h-4 text-sky-400 mt-0.5 flex-shrink-0" />
                <div>
                  Alerts are generated in real time from live cluster telemetry and diagnostics. Email infrastructure is fully managed centrally by SkyOps with zero client configuration required.
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-400 leading-relaxed">
              Incident email notifications are currently <span className="font-semibold text-zinc-300">disabled</span>. Turn this setting ON to receive real-time incident reports delivered to{' '}
              <span className="font-mono text-zinc-300">{registeredEmail}</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
