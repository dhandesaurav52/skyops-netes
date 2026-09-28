import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Mail,
  Shield,
  UserCheck,
  X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../common/UI';

export const InvitationAcceptanceModal: React.FC = () => {
  const { user } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [invInfo, setInvInfo] = useState<{
    valid: boolean;
    email: string;
    role: string;
    orgName: string;
    expiresAt: number;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteToken = params.get('invite_token') || params.get('invitation');
    if (inviteToken) {
      setToken(inviteToken);
      verifyToken(inviteToken);
    }
  }, []);

  const verifyToken = async (t: string) => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.verifyInvitation(t);
      setInvInfo(res);
    } catch (err: any) {
      setError(err.message || 'Invitation is invalid or has expired');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!token) return;
    try {
      setAccepting(true);
      setError(null);
      const res = await api.acceptInvitation(token);
      setAccepted(true);

      // Save as active organization and reload into the new tenant context
      if (res.organization?.id) {
        localStorage.setItem('skyops_active_org_id', res.organization.id);
      }

      setTimeout(() => {
        // Clean up URL
        const url = new URL(window.location.href);
        url.searchParams.delete('invite_token');
        url.searchParams.delete('invitation');
        window.history.replaceState({}, '', url.pathname);
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Failed to accept invitation');
      setAccepting(false);
    }
  };

  const handleDismiss = () => {
    setToken(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('invite_token');
    url.searchParams.delete('invitation');
    window.history.replaceState({}, '', url.pathname);
  };

  if (!token) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4 backdrop-blur-md">
      <div className="bg-[#050914] border border-cyan-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl font-mono relative overflow-hidden electric-circuit-border">
        {/* Top glowing electric bus line */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-300" />

        <div className="flex items-center justify-between border-b border-cyan-500/15 pb-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Mail className="w-4 h-4 text-cyan-400" />
            Workspace Invitation
          </h3>
          {!accepted && (
            <button onClick={handleDismiss} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-zinc-400 animate-pulse">
            Verifying invitation credentials with SkyOps...
          </div>
        ) : error ? (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-rose-950/30 border border-rose-800/60 rounded-lg text-rose-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleDismiss} className="w-full">
              Close
            </Button>
          </div>
        ) : accepted ? (
          <div className="space-y-4 text-xs text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-950/60 border border-emerald-700/80 flex items-center justify-center mx-auto text-emerald-400">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Welcome to {invInfo?.orgName}!</h4>
              <p className="text-zinc-400 text-xs mt-1">
                Your workspace membership is active. Initializing tenant context...
              </p>
            </div>
          </div>
        ) : invInfo ? (
          <div className="space-y-4 text-xs">
            <p className="text-zinc-300 leading-relaxed">
              You have been invited to join the enterprise workspace{' '}
              <span className="text-cyan-400 font-bold">{invInfo.orgName}</span>.
            </p>

            <div className="p-3 bg-[#02050b] border border-cyan-500/20 rounded-lg space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-zinc-500">Target Email:</span>
                <span className="text-zinc-200">{invInfo.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Assigned Role:</span>
                <span className="text-cyan-400 font-bold">{invInfo.role}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Expires:</span>
                <span className="text-zinc-400">{new Date(invInfo.expiresAt).toLocaleDateString()}</span>
              </div>
            </div>

            {user ? (
              <div className="space-y-3">
                <div className="text-[11px] text-zinc-400">
                  Logged in as: <span className="text-zinc-200 font-semibold">{user.email}</span>
                </div>

                {user.email && invInfo.email && user.email.trim().toLowerCase() !== invInfo.email.trim().toLowerCase() && (
                  <div className="p-3 bg-amber-950/40 border border-amber-800/80 rounded-lg text-amber-300 text-[11px] space-y-1">
                    <div className="font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      Email Identity Mismatch
                    </div>
                    <div>
                      You are signed in as <strong className="text-zinc-200">{user.email}</strong>, but this invitation was cryptographically issued to <strong className="text-zinc-200">{invInfo.email}</strong>.
                    </div>
                    <div className="text-amber-400/80 pt-1">
                      Please sign in with the matching email address or request an invite to your current address.
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2 border-t border-cyan-500/15">
                  <Button variant="outline" size="sm" onClick={handleDismiss} disabled={accepting} className="w-full">
                    Decline
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleAccept}
                    disabled={accepting || (Boolean(user.email && invInfo.email && user.email.trim().toLowerCase() !== invInfo.email.trim().toLowerCase()))}
                    icon={<UserCheck className="w-3.5 h-3.5" />}
                    className="w-full"
                  >
                    {accepting ? 'Joining...' : 'Accept & Join'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded-lg text-amber-300 text-[11px]">
                Please sign in to your SkyOps account to accept this invitation.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
