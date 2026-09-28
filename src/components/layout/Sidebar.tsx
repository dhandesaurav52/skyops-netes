import {
  Activity,
  AlertTriangle,
  Award,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Layers,
  LayoutDashboard,
  LogOut,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserCheck,
  Zap
} from 'lucide-react';
import React, { useState } from 'react';
import { AGENT_VERSION } from '../../config/version';
import { useAuth } from '../../context/AuthContext';

export type NavigationTab =
  | 'overview'
  | 'infrastructure'
  | 'services'
  | 'clusters'
  | 'incidents'
  | 'observability'
  | 'audit'
  | 'settings';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  openIncidentsCount?: number;
  pendingActionsCount?: number;
  onOpenAddCluster: () => void;
  onSignOut?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  openIncidentsCount = 0,
  pendingActionsCount = 0,
  onOpenAddCluster,
  onSignOut,
  isCollapsed = false,
  onToggleCollapse
}) => {
  const { currentOrg, organizations, switchOrganization, createOrganization, role, user, signOut } = useAuth();
  const [isOrgDropdownOpen, setIsOrgDropdownOpen] = useState(false);
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    await createOrganization(newOrgName.trim());
    setNewOrgName('');
    setIsCreatingOrg(false);
    setIsOrgDropdownOpen(false);
  };

  const handleSignOut = async () => {
    await signOut();
    if (onSignOut) onSignOut();
  };

  const navItems: Array<{
    id: NavigationTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: string;
  }> = [
    {
      id: 'overview',
      label: 'Command Center',
      icon: <LayoutDashboard className="w-4 h-4" />
    },
    {
      id: 'infrastructure',
      label: 'Infrastructure',
      icon: <Server className="w-4 h-4" />
    },
    {
      id: 'services',
      label: 'Services',
      icon: <Network className="w-4 h-4" />
    },
    {
      id: 'incidents',
      label: 'Incidents',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: openIncidentsCount,
      badgeColor: 'bg-red-500/20 text-red-300 border-red-500/30'
    },
    {
      id: 'observability',
      label: 'Observability',
      icon: <Radio className="w-4 h-4" />
    },
    {
      id: 'audit',
      label: 'Audit & Compliance',
      icon: <Shield className="w-4 h-4" />
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings className="w-4 h-4" />
    }
  ];

  return (
    <aside
      className={`bg-[#030712]/95 border-r border-sky-500/15 flex flex-col shrink-0 h-screen select-none transition-all duration-200 ease-in-out backdrop-blur-md z-30 ${
        isCollapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      {isCollapsed ? (
        <div className="py-3 px-2 border-b border-sky-500/15 flex flex-col items-center justify-center gap-2">
          <button
            onClick={onToggleCollapse}
            title="Pull navigation (Expand sidebar)"
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 via-sky-600 to-blue-700 hover:from-sky-300 hover:to-blue-600 flex items-center justify-center text-white font-mono font-bold text-xs shadow-[0_0_12px_-2px_rgba(14,165,233,0.5)] transition-all cursor-pointer"
          >
            SK
          </button>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Pull navigation (Expand sidebar)"
              className="p-1 text-zinc-400 hover:text-sky-300 hover:bg-sky-950/30 rounded-md transition-colors cursor-pointer"
            >
              <PanelLeftOpen className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="px-5 py-4 border-b border-sky-500/15 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 via-sky-600 to-blue-700 flex items-center justify-center text-white font-mono font-bold text-xs shadow-[0_0_14px_-2px_rgba(14,165,233,0.5)] border border-sky-300/30">
              SK
            </div>
            <div>
              <div className="font-bold text-sm text-white tracking-tight flex items-center gap-1.5">
                SkyOps
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/60">
                  {AGENT_VERSION}
                </span>
              </div>
              <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1">
                <span>Infrastructure Control</span>
              </div>
            </div>
          </div>
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Push navigation (Collapse sidebar)"
              className="p-1.5 rounded-md text-zinc-400 hover:text-sky-300 hover:bg-sky-950/30 transition-colors cursor-pointer"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Tenant / Organization Switcher */}
      {isCollapsed ? (
        <div className="px-2 py-3 border-b border-sky-500/10 flex justify-center">
          <button
            onClick={onToggleCollapse}
            title={`Tenant: ${currentOrg?.name || 'Workspace'} (${role}) - Click to expand`}
            className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#081024] hover:bg-[#0c1938] border border-sky-500/20 text-zinc-400 hover:text-sky-300 transition-colors cursor-pointer"
          >
            <Building2 className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="px-3 py-3 border-b border-sky-500/10 relative">
          <button
            onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg bg-[#081024]/80 hover:bg-[#0c1938] border border-sky-500/20 hover:border-sky-500/40 transition-all text-left cursor-pointer"
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Building2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <div className="truncate">
                <div className="text-zinc-200 font-medium truncate">{currentOrg?.name || 'My Organization'}</div>
                <div className="text-[10px] font-mono text-zinc-500 uppercase">{role}</div>
              </div>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          </button>

          {/* Dropdown Menu */}
          {isOrgDropdownOpen && (
            <div className="absolute top-full left-3 right-3 mt-1 bg-[#060c1c] border border-sky-500/30 rounded-lg shadow-2xl py-1 z-40 backdrop-blur-xl">
              <div className="px-3 py-1.5 text-[10px] font-mono text-sky-400/80 uppercase tracking-wider">Switch Organization</div>
              {organizations.map((org) => (
                <button
                  key={org.id}
                  onClick={() => {
                    switchOrganization(org.id);
                    setIsOrgDropdownOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-xs text-left hover:bg-sky-950/50 text-zinc-200 flex items-center justify-between cursor-pointer transition-colors"
                >
                  <span className="truncate">{org.name}</span>
                  {org.id === currentOrg?.id && <CheckCircle2 className="w-3 h-3 text-sky-400" />}
                </button>
              ))}

              <div className="border-t border-sky-500/15 mt-1 pt-1">
                {!isCreatingOrg ? (
                  <button
                    onClick={() => setIsCreatingOrg(true)}
                    className="w-full px-3 py-1.5 text-xs text-left text-sky-400 hover:bg-sky-950/50 flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Organization</span>
                  </button>
                ) : (
                  <form onSubmit={handleCreateOrg} className="p-2">
                    <input
                      type="text"
                      placeholder="Organization name"
                      value={newOrgName}
                      onChange={(e) => setNewOrgName(e.target.value)}
                      className="w-full px-2 py-1 text-xs bg-[#030712] border border-sky-500/40 rounded text-zinc-100 focus:outline-none focus:border-sky-400 mb-1.5 font-mono"
                      autoFocus
                    />
                    <div className="flex gap-1">
                      <button
                        type="submit"
                        className="px-2 py-0.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded font-mono cursor-pointer"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCreatingOrg(false)}
                        className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded font-mono cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Navigation */}
      <div className={`py-4 flex-1 space-y-1 overflow-y-auto no-scrollbar ${isCollapsed ? 'px-2' : 'px-3'}`}>
        {!isCollapsed && (
          <div className="px-3 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Mission Navigation</div>
        )}
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          if (isCollapsed) {
            return (
              <button
                key={item.id}
                onClick={() => onSelectTab(item.id)}
                title={`${item.label}${typeof item.badge === 'number' && item.badge > 0 ? ` (${item.badge} active)` : ''}`}
                className={`relative flex items-center justify-center w-10 h-10 mx-auto rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-sky-950/80 text-sky-300 border border-sky-500/40 shadow-[0_0_15px_-3px_rgba(14,165,233,0.3)]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20 border border-transparent'
                }`}
              >
                {item.icon}
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold font-mono flex items-center justify-center border border-zinc-950 shadow-[0_0_8px_rgba(225,29,72,0.8)] animate-pulse">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          }

          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                isActive
                  ? 'electric-active-tab border border-sky-500/30 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-sky-950/20 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={isActive ? 'text-sky-300' : 'text-zinc-400'}>{item.icon}</span>
                <span>{item.label}</span>
              </div>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-950/90 text-rose-300 border border-rose-600/70 shadow-[0_0_8px_rgba(225,29,72,0.5)] animate-pulse">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Quick Cluster Registration Action */}
        {isCollapsed ? (
          <div className="pt-4 flex justify-center">
            <button
              onClick={onOpenAddCluster}
              title="Connect Cluster"
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-[#081024] hover:bg-[#0e1c3e] border border-sky-500/25 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="pt-6 space-y-1">
            <div className="px-3 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Quick Actions</div>
            <button
              onClick={onOpenAddCluster}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sky-200 hover:text-white bg-gradient-to-r from-sky-950/60 to-blue-950/40 hover:from-sky-900/60 hover:to-blue-900/40 border border-sky-500/25 hover:border-sky-500/45 transition-all cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span>Connect Cluster</span>
            </button>
          </div>
        )}
      </div>

      {/* User Footer & Sign Out Action */}
      {isCollapsed ? (
        <div className="py-3 px-2 border-t border-sky-500/15 bg-[#02050f]/80 flex flex-col items-center gap-2.5">
          <div
            title={`${user?.name || 'SkyOps Engineer'} (${user?.email || 'sre@skyops.io'})`}
            className="w-8 h-8 rounded-full bg-sky-950 border border-sky-500/40 flex items-center justify-center text-xs font-mono text-sky-300 font-semibold cursor-default shadow-xs"
          >
            {user?.name?.charAt(0) || 'S'}
          </div>
          <button
            onClick={handleSignOut}
            title="Sign Out of SkyOps"
            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="px-3 py-3 border-t border-sky-500/15 bg-[#02050f]/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
            <div className="w-7 h-7 rounded-full bg-sky-950 border border-sky-500/40 flex items-center justify-center text-xs font-mono text-sky-300 font-semibold shrink-0 shadow-xs">
              {user?.name?.charAt(0) || 'S'}
            </div>
            <div className="truncate">
              <div className="text-xs font-medium text-zinc-200 truncate flex items-center gap-1.5">
                {user?.name || 'SkyOps Engineer'}
              </div>
              <div className="text-[10px] font-mono text-zinc-500 truncate">
                {user?.email || 'sre@skyops.io'}
              </div>
            </div>
          </div>

          <button
            onClick={handleSignOut}
            title="Sign Out of SkyOps"
            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      )}
    </aside>
  );
};
