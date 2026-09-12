import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Clock,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2
} from 'lucide-react';
import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Cluster } from '../../types/index';
import { ClusterStatusBadge } from '../common/Badges';
import { Button, EmptyState, Modal } from '../common/UI';

interface ClustersViewProps {
  clusters: Cluster[];
  onSelectCluster: (clusterId: string) => void;
  onOpenAddCluster: () => void;
  onDeleteCluster: (clusterId: string) => Promise<void> | void;
  onRefresh: () => void;
  loading: boolean;
}

export const ClustersView: React.FC<ClustersViewProps> = ({
  clusters,
  onSelectCluster,
  onOpenAddCluster,
  onDeleteCluster,
  onRefresh,
  loading
}) => {
  const { canDeleteClusters } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [clusterToDelete, setClusterToDelete] = useState<Cluster | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'Never';
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h ago`;
  };

  const filteredClusters = clusters.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.description && c.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleDeleteConfirm = async () => {
    if (!clusterToDelete) return;
    try {
      setIsDeleting(true);
      setDeleteError(null);
      await onDeleteCluster(clusterToDelete.id);
      setClusterToDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete cluster');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div>
          <h1 className="text-xl font-bold text-zinc-100 tracking-tight flex items-center gap-2.5">
            <Server className="w-5 h-5 text-sky-400" />
            Kubernetes Clusters
          </h1>
          <p className="text-xs font-mono text-zinc-400 mt-1">
            Registered clusters, telemetry agent health, and resource density metrics
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onOpenAddCluster} icon={<Plus className="w-3.5 h-3.5" />}>
            Connect Cluster
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by cluster name, ID, or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono"
          />
        </div>
        <div className="text-xs font-mono text-zinc-500">
          Showing {filteredClusters.length} of {clusters.length} clusters
        </div>
      </div>

      {/* Clusters Table */}
      {filteredClusters.length === 0 ? (
        <EmptyState
          title={searchTerm ? 'No matching clusters found' : 'No Kubernetes clusters connected'}
          description={
            searchTerm
              ? 'Try modifying your search criteria.'
              : 'Add your first cluster to begin observing resources and detecting incidents.'
          }
          action={searchTerm ? undefined : { label: 'Connect Cluster', onClick: onOpenAddCluster }}
        />
      ) : (
        <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-xl overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-900/90 border-b border-zinc-800 text-zinc-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="px-5 py-3">Cluster Name</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Agent</th>
                  <th className="px-5 py-3">K8s Version</th>
                  <th className="px-5 py-3">Nodes / Pods</th>
                  <th className="px-5 py-3">Open Incidents</th>
                  <th className="px-5 py-3">Last Heartbeat</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-300">
                {filteredClusters.map((cluster) => (
                  <tr
                    key={cluster.id}
                    onClick={() => onSelectCluster(cluster.id)}
                    className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-zinc-100 flex items-center gap-2">
                        {cluster.name}
                        {cluster.isSimulated && (
                          <span className="text-[9px] bg-zinc-800 text-zinc-400 px-1 rounded border border-zinc-700">
                            TEST
                          </span>
                        )}
                      </div>
                      {cluster.description && (
                        <div className="text-[11px] text-zinc-500 font-sans truncate max-w-xs">{cluster.description}</div>
                      )}
                      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{cluster.id}</div>
                    </td>

                    <td className="px-5 py-3.5">
                      <ClusterStatusBadge status={cluster.status} agentStatus={cluster.agentStatus} />
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="text-zinc-200 font-medium">
                        {cluster.agentStatus === 'CONNECTED' || cluster.connectionState === 'connected' ? (
                          <span className="text-emerald-400">Connected</span>
                        ) : cluster.agentStatus === 'RECONNECTING' || cluster.connectionState === 'reconnecting' ? (
                          <span className="text-amber-400 font-semibold animate-pulse">Reconnecting</span>
                        ) : cluster.agentStatus === 'STALE' || cluster.connectionState === 'stale' ? (
                          <span className="text-orange-400 font-semibold">Stale</span>
                        ) : cluster.agentStatus === 'AGENT_DETECTED' || cluster.connectionState === 'agent_detected' ? (
                          <span className="text-sky-400 font-semibold animate-pulse">Detected</span>
                        ) : cluster.agentStatus === 'PENDING' || cluster.connectionState === 'pending' ? (
                          <span className="text-amber-400">Pending</span>
                        ) : cluster.agentStatus === 'DEGRADED' ? (
                          <span className="text-amber-400">Degraded</span>
                        ) : (
                          <span className="text-zinc-500">Offline</span>
                        )}
                      </div>
                      <div className="text-[10px] text-zinc-500">{cluster.agentVersion || '—'}</div>
                    </td>

                    <td className="px-5 py-3.5 text-zinc-400">{cluster.k8sVersion || '—'}</td>

                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 text-zinc-200 font-medium">
                        <span>{cluster.nodeCount} Nodes</span>
                        <span className="text-zinc-600">/</span>
                        <span>{cluster.podCount} Pods</span>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      {cluster.openIncidentCount > 0 ? (
                        <span className="inline-flex items-center gap-1 font-bold text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3" />
                          {cluster.openIncidentCount}
                        </span>
                      ) : (
                        <span className="text-zinc-500">0</span>
                      )}
                    </td>

                    <td className="px-5 py-3.5 text-zinc-400">
                      <div className="flex items-center gap-1 text-zinc-300">
                        <Clock className="w-3 h-3 text-zinc-500" />
                        {formatTimeAgo(cluster.lastHeartbeat)}
                      </div>
                    </td>

                    <td className="px-5 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => onSelectCluster(cluster.id)}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-xs transition-colors cursor-pointer"
                        >
                          Inspect →
                        </button>
                        {canDeleteClusters && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setClusterToDelete(cluster);
                              setDeleteError(null);
                            }}
                            title="Delete Cluster"
                            className="p-1.5 text-zinc-500 hover:text-rose-400 hover:bg-rose-950/40 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete Cluster Confirmation Modal */}
      <Modal
        isOpen={!!clusterToDelete}
        onClose={() => {
          if (!isDeleting) {
            setClusterToDelete(null);
            setDeleteError(null);
          }
        }}
        title="Delete Kubernetes Cluster"
        maxWidth="md"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-3.5 bg-rose-950/20 border border-rose-900/30 rounded-lg text-rose-300">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="font-semibold text-rose-200">Are you sure you want to delete this cluster?</p>
              <p className="text-zinc-400">
                Deleting <span className="font-mono text-zinc-200 font-bold">{clusterToDelete?.name}</span> ({clusterToDelete?.id}) will permanently remove all associated agent tokens, telemetry snapshots, and resource records from SkyOps.
              </p>
            </div>
          </div>

          {deleteError && (
            <div className="p-3 bg-rose-950/40 border border-rose-800/50 rounded text-xs text-rose-300">
              {deleteError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={isDeleting}
              onClick={() => {
                setClusterToDelete(null);
                setDeleteError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={isDeleting}
              onClick={handleDeleteConfirm}
              icon={isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            >
              {isDeleting ? 'Deleting Cluster...' : 'Delete Cluster'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
