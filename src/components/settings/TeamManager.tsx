import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Copy,
  Mail,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  UserX,
  X
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { OrgInvitation, OrgMember, OrgMemberStatus, Role } from '../../types/index';
import { Button } from '../common/UI';
import { PlanComparisonModal } from '../billing/PlanComparisonModal';

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  OWNER: 'Full tenant ownership, organizational configuration, billing & member administration.',
  ADMIN: 'Manage clusters, incidents, remediation, webhooks, and team members.',
  OPERATOR: 'Operate clusters, trigger remediations, triage incidents, and read telemetry.',
  ENGINEER: 'Triage incidents, execute automated remediations, and view cluster telemetry.',
  VIEWER: 'Read-only access to clusters, incidents, and audit logs.'
};

export const TeamManager: React.FC = () => {
  const { currentOrg, role: currentUserRole, user, organizations, switchOrganization } = useAuth();
  const isOwnerOrAdmin = currentUserRole === 'OWNER' || currentUserRole === 'ADMIN';

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<{
    status: number;
    code?: string;
    message: string;
  } | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('ENGINEER');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<OrgInvitation | null>(null);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);

  // Member Action state
  const [actionMember, setActionMember] = useState<OrgMember | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [updatingMember, setUpdatingMember] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setAuthError(null);
      const [membersData, invitationsData] = await Promise.all([
        api.getOrgMembers(),
        isOwnerOrAdmin ? api.getOrgInvitations() : Promise.resolve([])
      ]);
      setMembers(membersData);
      setInvitations(invitationsData);
    } catch (err: any) {
      const is403 =
        err?.status === 403 ||
        err?.code === 'ORG_ACCESS_DENIED' ||
        err?.code === 'MEMBERSHIP_SUSPENDED' ||
        err?.code === 'MEMBERSHIP_REVOKED' ||
        /Forbidden|access to this organization|not authorized/i.test(err?.message || '');

      if (is403) {
        setAuthError({
          status: err.status || 403,
          code: err.code || 'ORG_ACCESS_DENIED',
          message: err.message || 'You do not have access to view or manage team members in this organization.'
        });
      } else {
        setError(err.message || 'Failed to load team data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentOrg?.id, currentUserRole]);

  const showNotification = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteEmail.includes('@')) {
      setError('Please provide a valid email address');
      return;
    }
    try {
      setInviting(true);
      setError(null);
      setIsQuotaError(false);
      const res = await api.inviteMember(inviteEmail.trim(), inviteRole);
      setInviteResult(res.invitation);
      showNotification(`Invitation created for ${inviteEmail}`);
      loadData();
    } catch (err: any) {
      const isQuota =
        err?.code === 'PLAN_LIMIT_REACHED' ||
        err?.status === 403 ||
        (err?.message && /quota|limit|plan|upgrade/i.test(err.message));
      setIsQuotaError(Boolean(isQuota));
      setError(err.message || 'Failed to send invitation');
    } finally {
      setInviting(false);
    }
  };

  const handleRoleChange = async (member: OrgMember, newRole: Role) => {
    if (member.role === newRole) return;
    try {
      setUpdatingMember(true);
      await api.updateMemberRole(member.userId, newRole);
      showNotification(`Updated ${member.name}'s role to ${newRole}`);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update member role');
    } finally {
      setUpdatingMember(false);
    }
  };

  const handleStatusToggle = async (member: OrgMember) => {
    const newStatus: OrgMemberStatus = member.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      setUpdatingMember(true);
      await api.updateMemberStatus(member.userId, newStatus);
      showNotification(`Marked ${member.name} as ${newStatus}`);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to update member status');
    } finally {
      setUpdatingMember(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!actionMember) return;
    try {
      setUpdatingMember(true);
      await api.removeMember(actionMember.userId);
      showNotification(`Removed ${actionMember.name} from organization`);
      setActionMember(null);
      setConfirmRemove(false);
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove member');
    } finally {
      setUpdatingMember(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      await api.revokeInvitation(invitationId);
      showNotification('Invitation revoked');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke invitation');
    }
  };

  const handleResendInvitation = async (invitationId: string) => {
    try {
      await api.resendInvitation(invitationId);
      showNotification('Invitation refreshed with new 7-day expiration');
      loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to resend invitation');
    }
  };

  const copyInviteLink = (token: string) => {
    const origin = window.location.origin;
    const url = `${origin}?invite_token=${token}`;
    navigator.clipboard.writeText(url);
    showNotification('Invitation acceptance link copied to clipboard');
  };

  const filteredMembers = members.filter((m) => {
    if (m.status === 'REMOVED') return false;
    if (roleFilter !== 'ALL' && m.role !== roleFilter) return false;
    if (statusFilter !== 'ALL' && (m.status || 'ACTIVE') !== statusFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Active Workspace Identity & RBAC Header */}
      <div className="p-4 rounded-xl bg-zinc-900/40 border border-zinc-800/80 font-mono flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-950/60 border border-sky-800/80 flex items-center justify-center text-sky-400 shrink-0">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-100">{currentOrg?.name || 'Workspace'}</span>
              <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px]">
                {currentOrg?.slug || currentOrg?.id || 'org'}
              </span>
            </div>
            <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-2">
              <span>Signed in as <strong className="text-zinc-300 font-semibold">{user?.email || 'User'}</strong></span>
              <span className="text-zinc-600">•</span>
              <span className="flex items-center gap-1">
                <Shield className="w-3 h-3 text-sky-400" />
                <span className="text-sky-300 font-semibold">{currentUserRole}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 border-zinc-800/60 pt-3 md:pt-0">
          <div className="flex items-center gap-4 text-xs text-zinc-400">
            <div>
              <span className="text-zinc-200 font-bold">{members.length}</span> active member{members.length === 1 ? '' : 's'}
            </div>
            {isOwnerOrAdmin && (
              <div>
                <span className="text-sky-400 font-bold">{invitations.filter((i) => i.status === 'PENDING').length}</span> pending invite{invitations.filter((i) => i.status === 'PENDING').length === 1 ? '' : 's'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 403 Forbidden Authorization Notice */}
      {authError && (
        <div className="p-6 rounded-xl bg-amber-950/20 border border-amber-500/40 font-mono space-y-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-amber-950/80 border border-amber-600/60 flex items-center justify-center shrink-0 text-amber-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-700 text-[10px] font-bold">
                  HTTP {authError.status} ACCESS RESTRICTED
                </span>
                <span className="text-zinc-500 text-xs">{authError.code || 'ORG_ACCESS_DENIED'}</span>
              </div>
              <h3 className="text-sm font-bold text-zinc-100">
                Workspace Membership & Directory Access Denied
              </h3>
              <p className="text-xs text-zinc-300 leading-relaxed">
                {authError.message}
              </p>
              <div className="pt-2 text-[11px] text-zinc-400 space-y-0.5">
                <div>Your account: <span className="text-zinc-200 font-semibold">{user?.email}</span></div>
                <div>Workspace requested: <span className="text-zinc-200 font-semibold">{currentOrg?.name || currentOrg?.id}</span></div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-amber-900/40">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              className="text-xs font-mono"
            >
              Retry Access
            </Button>

            {organizations && organizations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-400">Switch to authorized workspace:</span>
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => switchOrganization(org.id)}
                    className="px-2.5 py-1 rounded bg-zinc-900 hover:bg-zinc-800 text-sky-400 border border-zinc-700 hover:border-sky-600 text-xs font-mono transition-colors cursor-pointer"
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

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
        <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs font-mono flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-2">
            {isQuotaError && (
              <Button
                variant="primary"
                size="sm"
                className="bg-sky-600 hover:bg-sky-500 text-white font-bold"
                onClick={() => setShowPlanModal(true)}
                icon={<Sparkles className="w-3.5 h-3.5" />}
              >
                Upgrade Plan
              </Button>
            )}
            <button onClick={() => setError(null)} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Team Section */}
      <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div>
            <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
              <Users className="w-4 h-4 text-sky-400" />
              Team Members & Role-Based Access Control
            </h3>
            <p className="text-xs text-zinc-400 font-mono mt-1">
              Enforce strict tenant isolation and manage least-privilege operations across engineering personnel.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              className="font-mono text-xs"
            >
              Refresh
            </Button>
            {isOwnerOrAdmin && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setShowInviteModal(true);
                  setInviteResult(null);
                  setError(null);
                }}
                icon={<Plus className="w-3.5 h-3.5" />}
                className="font-mono text-xs"
              >
                Invite Member
              </Button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search member by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All Roles</option>
              <option value="OWNER">Owner</option>
              <option value="ADMIN">Admin</option>
              <option value="OPERATOR">Operator</option>
              <option value="ENGINEER">Engineer</option>
              <option value="VIEWER">Viewer</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 focus:outline-none focus:border-sky-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
            </select>
          </div>
        </div>

        {/* Members Table */}
        <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
              <tr>
                <th className="px-4 py-2.5">Member</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Joined</th>
                {isOwnerOrAdmin && <th className="px-4 py-2.5 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    <div className="flex items-center justify-center gap-2">
                      <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                      <span>Loading team member directory...</span>
                    </div>
                  </td>
                </tr>
              ) : authError ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-amber-400/90 bg-amber-950/10">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <ShieldAlert className="w-6 h-6 text-amber-400" />
                      <div className="font-semibold text-zinc-200">Directory Access Forbidden (HTTP 403)</div>
                      <div className="text-xs text-zinc-400 max-w-md">
                        You do not possess authorized membership for this organization.
                      </div>
                    </div>
                  </td>
                </tr>
              ) : members.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    No active members found in this organization.
                  </td>
                </tr>
              ) : filteredMembers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-400">
                    <div className="space-y-2">
                      <div>No team members match "{searchQuery}" or selected role/status filters.</div>
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setRoleFilter('ALL');
                          setStatusFilter('ALL');
                        }}
                        className="text-xs text-sky-400 hover:text-sky-300 underline cursor-pointer"
                      >
                        Clear filters and search
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMembers.map((m) => {
                  const isSelf = m.userId === user?.id;
                  const isSuspended = m.status === 'SUSPENDED';

                  return (
                    <tr key={m.userId} className="hover:bg-zinc-900/40">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 font-bold uppercase text-[11px]">
                            {m.name ? m.name.slice(0, 2) : 'US'}
                          </div>
                          <div>
                            <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                              <span>{m.name}</span>
                              {isSelf && (
                                <span className="px-1.5 py-0.2 bg-sky-950/60 text-sky-400 border border-sky-800/80 rounded text-[9px]">
                                  YOU
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-500">{m.email}</div>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {isOwnerOrAdmin && !isSelf ? (
                          <select
                            value={m.role}
                            disabled={updatingMember}
                            onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                            className="px-2 py-1 bg-zinc-900 border border-zinc-700 rounded text-zinc-200 text-xs font-mono focus:border-sky-500 cursor-pointer"
                          >
                            <option value="OWNER" disabled={currentUserRole !== 'OWNER'}>
                              OWNER
                            </option>
                            <option value="ADMIN">ADMIN</option>
                            <option value="OPERATOR">OPERATOR</option>
                            <option value="ENGINEER">ENGINEER</option>
                            <option value="VIEWER">VIEWER</option>
                          </select>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px] font-semibold">
                            {m.role}
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        {isSuspended ? (
                          <span className="inline-flex items-center gap-1 text-rose-400 text-[11px]">
                            <UserX className="w-3 h-3" /> Suspended
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                            <CheckCircle2 className="w-3 h-3" /> Active
                          </span>
                        )}
                      </td>

                      <td className="px-4 py-3 text-zinc-500 text-[11px]">
                        {new Date(m.joinedAt).toLocaleDateString()}
                      </td>

                      {isOwnerOrAdmin && (
                        <td className="px-4 py-3 text-right">
                          {!isSelf && (
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleStatusToggle(m)}
                                title={isSuspended ? 'Reactivate member' : 'Suspend member access'}
                                disabled={updatingMember}
                                className={`p-1.5 rounded border transition-colors cursor-pointer ${
                                  isSuspended
                                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-800 hover:bg-emerald-900/40'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-amber-300 hover:border-amber-800'
                                }`}
                              >
                                {isSuspended ? <UserCheck className="w-3.5 h-3.5" /> : <UserMinus className="w-3.5 h-3.5" />}
                              </button>

                              <button
                                onClick={() => {
                                  setActionMember(m);
                                  setConfirmRemove(true);
                                }}
                                title="Remove member from organization"
                                disabled={updatingMember}
                                className="p-1.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 hover:text-rose-400 hover:border-rose-900 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pending Invitations Section */}
      {isOwnerOrAdmin && (
        <div className="p-6 rounded-xl bg-zinc-900/40 border border-zinc-800/80 space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
            <div>
              <h3 className="text-xs font-bold text-zinc-200 font-mono uppercase tracking-wider flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-400" />
                Pending & Recent Workspace Invitations ({invitations.length})
              </h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Outstanding cryptographic invite tokens. Invited members can join and inherit assigned roles securely.
              </p>
            </div>
          </div>

          <div className="bg-zinc-950 border border-zinc-800/80 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900 text-zinc-400 uppercase text-[10px] border-b border-zinc-800">
                <tr>
                  <th className="px-4 py-2.5">Invited Email</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5">Invited On</th>
                  <th className="px-4 py-2.5">Expires</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {invitations.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                      No pending invitations at this time.
                    </td>
                  </tr>
                ) : (
                  invitations.map((inv) => {
                    const isPending = inv.status === 'PENDING' && inv.expiresAt > Date.now();
                    const isExpired = inv.status === 'EXPIRED' || (inv.status === 'PENDING' && inv.expiresAt <= Date.now());

                    return (
                      <tr key={inv.id} className="hover:bg-zinc-900/40">
                        <td className="px-4 py-3 font-semibold text-zinc-200">{inv.email}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 text-[10px]">
                            {inv.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {isPending && (
                            <span className="px-2 py-0.5 rounded bg-sky-950/60 text-sky-400 border border-sky-800 text-[10px]">
                              PENDING
                            </span>
                          )}
                          {isExpired && (
                            <span className="px-2 py-0.5 rounded bg-amber-950/60 text-amber-400 border border-amber-800 text-[10px]">
                              EXPIRED
                            </span>
                          )}
                          {inv.status === 'ACCEPTED' && (
                            <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800 text-[10px]">
                              ACCEPTED
                            </span>
                          )}
                          {inv.status === 'REVOKED' && (
                            <span className="px-2 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800 text-[10px]">
                              REVOKED
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-[11px]">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-zinc-500 text-[11px]">
                          {new Date(inv.expiresAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isPending && (
                              <button
                                onClick={() => copyInviteLink(inv.token)}
                                title="Copy invitation link"
                                className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-sky-400 border border-zinc-800 rounded text-[11px] flex items-center gap-1 cursor-pointer"
                              >
                                <Copy className="w-3 h-3" /> Link
                              </button>
                            )}

                            {(isPending || isExpired) && (
                              <button
                                onClick={() => handleResendInvitation(inv.id)}
                                title="Extend / Resend"
                                className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800 rounded text-[11px] flex items-center gap-1 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" /> Renew
                              </button>
                            )}

                            {isPending && (
                              <button
                                onClick={() => handleRevokeInvitation(inv.id)}
                                title="Revoke Invitation"
                                className="px-2 py-1 bg-zinc-900 hover:bg-rose-950/40 text-zinc-400 hover:text-rose-400 border border-zinc-800 hover:border-rose-900 rounded text-[11px] cursor-pointer"
                              >
                                Revoke
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h4 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                <Mail className="w-4 h-4 text-sky-400" />
                Invite Team Member
              </h4>
              <button
                onClick={() => setShowInviteModal(false)}
                className="text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {inviteResult ? (
              <div className="space-y-4 font-mono text-xs">
                <div className="p-3 bg-emerald-950/30 border border-emerald-800/60 rounded-lg text-emerald-300">
                  <p className="font-bold flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    Invitation created successfully!
                  </p>
                  <p className="text-[11px] text-emerald-400/80 mt-1">
                    Share this link directly with {inviteResult.email} to join your workspace:
                  </p>
                </div>

                <div className="p-2.5 bg-zinc-900 rounded border border-zinc-800 break-all text-zinc-300 text-[11px]">
                  {`${window.location.origin}?invite_token=${inviteResult.token}`}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => copyInviteLink(inviteResult.token)}
                    icon={<Copy className="w-3.5 h-3.5" />}
                    className="w-full"
                  >
                    Copy Invitation Link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowInviteModal(false);
                      setInviteResult(null);
                    }}
                    className="w-full"
                  >
                    Done
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleInvite} className="space-y-4 font-mono text-xs">
                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">User Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="colleague@company.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="text-zinc-400 block mb-1.5 text-[11px] uppercase">Assign Organization Role</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as Role)}
                    className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-zinc-200 focus:outline-none focus:border-sky-500"
                  >
                    {currentUserRole === 'OWNER' && <option value="OWNER">OWNER</option>}
                    <option value="ADMIN">ADMIN</option>
                    <option value="OPERATOR">OPERATOR</option>
                    <option value="ENGINEER">ENGINEER</option>
                    <option value="VIEWER">VIEWER</option>
                  </select>
                  <p className="text-[11px] text-zinc-500 mt-1.5">{ROLE_DESCRIPTIONS[inviteRole]}</p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowInviteModal(false)}
                    disabled={inviting}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" size="sm" disabled={inviting}>
                    {inviting ? 'Creating...' : 'Send Invitation'}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Confirm Member Removal Modal */}
      {confirmRemove && actionMember && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-2.5 text-rose-400 font-mono text-xs font-bold uppercase">
              <AlertCircle className="w-5 h-5" />
              Confirm Member Removal
            </div>

            <p className="text-xs font-mono text-zinc-300">
              Are you sure you want to remove <span className="text-zinc-100 font-bold">{actionMember.name}</span> (
              {actionMember.email}) from this workspace? They will lose access immediately.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActionMember(null);
                  setConfirmRemove(false);
                }}
                disabled={updatingMember}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleRemoveMember}
                disabled={updatingMember}
                className="bg-rose-600 hover:bg-rose-500 text-white"
              >
                {updatingMember ? 'Removing...' : 'Confirm Remove'}
              </Button>
            </div>
          </div>
        </div>
      )}

      <PlanComparisonModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        onPlanChanged={() => {
          setError(null);
          setIsQuotaError(false);
          loadData();
        }}
      />
    </div>
  );
};
