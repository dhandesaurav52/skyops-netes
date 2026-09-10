import {
  Activity,
  AlertTriangle,
  Boxes,
  Building2,
  CheckCircle2,
  ChevronDown,
  LogOut,
  Plus,
  Server,
  Settings,
  Shield,
  Terminal,
  UserCheck
} from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

export type NavigationTab = 'overview' | 'clusters' | 'incidents' | 'audit' | 'settings';

interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  openIncidentsCount?: number;
  onOpenAddCluster: () => void;
  onSignOut?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  openIncidentsCount = 0,
  onOpenAddCluster,
  onSignOut
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
  }> = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <Activity className="w-4 h-4" />
    },
    {
      id: 'clusters',
      label: 'Clusters',
      icon: <Server className="w-4 h-4" />
    },
    {
      id: 'incidents',
      label: 'Incidents',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: openIncidentsCount
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
    <aside className="w-64 bg-zinc-950 border-r border-zinc-800/80 flex flex-col shrink-0 h-screen select-none">
      {/* Brand Header */}
      <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-sky-600 flex items-center justify-center text-white font-mono font-bold text-sm shadow-md">
            SK
          </div>
          <div>
            <div className="font-bold text-sm text-zinc-100 tracking-tight flex items-center gap-1.5">
              SkyOps
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                v1.4
              </span>
            </div>
            <div className="text-[10px] font-mono text-zinc-500">K8s Incident Platform</div>
          </div>
        </div>
      </div>

      {/* Tenant / Organization Switcher */}
      <div className="px-3 py-3 border-b border-zinc-800/60 relative">
        <button
          onClick={() => setIsOrgDropdownOpen(!isOrgDropdownOpen)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 transition-colors text-left cursor-pointer"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <Building2 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <div className="truncate">
              <div className="text-zinc-200 font-medium truncate">{currentOrg?.name || 'My Organization'}</div>
              <div className="text-[10px] font-mono text-zinc-500 uppercase">{role}</div>
            </div>
          </div>
          <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
        </button>

        {/* Dropdown Menu */}
        {isOrgDropdownOpen && (
          <div className="absolute top-full left-3 right-3 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl py-1 z-30">
            <div className="px-3 py-1.5 text-[10px] font-mono text-zinc-500 uppercase">Switch Organization</div>
            {organizations.map((org) => (
              <button
                key={org.id}
                onClick={() => {
                  switchOrganization(org.id);
                  setIsOrgDropdownOpen(false);
                }}
                className="w-full px-3 py-1.5 text-xs text-left hover:bg-zinc-800 text-zinc-200 flex items-center justify-between cursor-pointer"
              >
                <span className="truncate">{org.name}</span>
                {org.id === currentOrg?.id && <CheckCircle2 className="w-3 h-3 text-sky-400" />}
              </button>
            ))}

            <div className="border-t border-zinc-800 mt-1 pt-1">
              {!isCreatingOrg ? (
                <button
                  onClick={() => setIsCreatingOrg(true)}
                  className="w-full px-3 py-1.5 text-xs text-left text-sky-400 hover:bg-zinc-800 flex items-center gap-1.5 cursor-pointer"
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
                    className="w-full px-2 py-1 text-xs bg-zinc-950 border border-zinc-700 rounded text-zinc-100 focus:outline-none focus:border-sky-500 mb-1.5 font-mono"
                    autoFocus
                  />
                  <div className="flex gap-1">
                    <button
                      type="submit"
                      className="px-2 py-0.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded font-mono"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsCreatingOrg(false)}
                      className="px-2 py-0.5 text-xs bg-zinc-800 text-zinc-400 rounded font-mono"
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

      {/* Main Navigation */}
      <div className="px-3 py-4 flex-1 space-y-1">
        <div className="px-3 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Navigation</div>
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-sky-950/60 text-sky-300 border border-sky-800/60 font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 border border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {item.icon}
                <span>{item.label}</span>
              </div>
              {typeof item.badge === 'number' && item.badge > 0 && (
                <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-900/80 text-rose-300 border border-rose-700/60">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        {/* Quick Cluster Registration Action */}
        <div className="pt-6 space-y-1">
          <div className="px-3 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Quick Actions</div>
          <button
            onClick={onOpenAddCluster}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-900 hover:bg-zinc-800/90 border border-zinc-800 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-sky-400" />
            <span>Connect Cluster</span>
          </button>
        </div>
      </div>

      {/* User Footer & Sign Out Action */}
      <div className="px-3 py-3 border-t border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 overflow-hidden min-w-0">
          <div className="w-7 h-7 rounded-full bg-sky-950 border border-sky-800 flex items-center justify-center text-xs font-mono text-sky-300 font-semibold shrink-0">
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
    </aside>
  );
};
