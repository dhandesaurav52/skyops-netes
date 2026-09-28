import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Database,
  Filter,
  Layers,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Tag,
  ExternalLink
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Cluster, Incident, KubernetesResource } from '../../types/index';
import { ResourceHealthBadge, ServiceTypeBadge } from '../common/Badges';
import { Button, EmptyState } from '../common/UI';
import { ServiceDetailModal } from '../resources/ServiceDetailModal';
import { PodDetailModal } from '../resources/PodDetailModal';
import { formatTimeAgo } from '../../utils/date';
import { api } from '../../api/client';

export interface ServicesViewProps {
  services?: KubernetesResource[];
  resources?: KubernetesResource[];
  clusterResources?: KubernetesResource[];
  cluster?: Cluster | null;
  clusters?: Cluster[];
  incidents?: Incident[];
  loading?: boolean;
  onRefresh?: () => void;
  onSelectCluster?: (clusterId: string) => void;
  onSelectIncident?: (incidentId: string) => void;
  onSelectService?: (service: KubernetesResource) => void;
  isEmbedded?: boolean;
}

export const ServicesView: React.FC<ServicesViewProps> = ({
  services,
  resources,
  clusterResources,
  cluster,
  clusters,
  incidents = [],
  loading = false,
  onRefresh,
  onSelectCluster,
  onSelectIncident,
  onSelectService,
  isEmbedded = false
}) => {
  const [selectedClusterId, setSelectedClusterId] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedHealth, setSelectedHealth] = useState<string>('all');
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [activeService, setActiveService] = useState<KubernetesResource | null>(null);
  const [activePod, setActivePod] = useState<KubernetesResource | null>(null);

  // Determine if parent is explicitly controlling resources/services data
  const isControlled = Boolean(
    (services !== undefined && services !== null) ||
    (resources !== undefined && resources !== null) ||
    (clusterResources !== undefined && clusterResources !== null)
  );

  const [internalResources, setInternalResources] = useState<KubernetesResource[]>([]);
  const [internalLoading, setInternalLoading] = useState<boolean>(false);

  // Self-fetch when rendered standalone (e.g. global left-nav Services page)
  const fetchServicesData = async () => {
    if (isControlled) return;
    try {
      setInternalLoading(true);
      const data = await api.getAllResources();
      setInternalResources(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('ServicesView autonomous resource fetch notice:', err);
    } finally {
      setInternalLoading(false);
    }
  };

  useEffect(() => {
    if (!isControlled) {
      fetchServicesData();
    }
  }, [isControlled, clusters?.length]);

  const handleRefresh = async () => {
    if (onRefresh) onRefresh();
    if (!isControlled) {
      await fetchServicesData();
    }
  };

  // Normalized pool of resources
  const allResources = useMemo(() => {
    if (Array.isArray(clusterResources) && clusterResources.length > 0) return clusterResources;
    if (Array.isArray(resources) && resources.length > 0) return resources;
    if (!isControlled && Array.isArray(internalResources)) return internalResources;
    return [];
  }, [clusterResources, resources, internalResources, isControlled]);

  // Extract all services
  const allServices = useMemo(() => {
    if (Array.isArray(services) && services.length > 0) return services;
    return allResources.filter((r) => r.kind === 'Service');
  }, [services, allResources]);

  // Safe clusters list
  const safeClusters = useMemo(() => {
    if (Array.isArray(clusters) && clusters.length > 0) return clusters;
    if (cluster) return [cluster];
    const clusterMap = new Map<string, { id: string; name: string }>();
    for (const r of allResources) {
      if (r && r.clusterId && !clusterMap.has(r.clusterId)) {
        clusterMap.set(r.clusterId, {
          id: r.clusterId,
          name: r.clusterName || r.clusterId
        });
      }
    }
    return Array.from(clusterMap.values());
  }, [clusters, cluster, allResources]);

  // Distinct namespaces
  const namespaces = useMemo(() => {
    const set = new Set<string>();
    for (const s of allServices) {
      if (s.namespace) set.add(s.namespace);
    }
    return Array.from(set).sort();
  }, [allServices]);

  // Calculate backing pods and stats per service
  const serviceStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        backingPodsTotal: number;
        backingPodsReady: number;
        portsText: string;
        serviceType: string;
        clusterIP: string;
        externalIP: string;
        selectorText: string;
      }
    >();

    for (const svc of allServices) {
      const spec = (svc.specSummary || {}) as Record<string, any>;
      const status = (svc.statusSummary || {}) as Record<string, any>;
      const targetNs = (svc.namespace || 'default').toLowerCase();
      const selector = (spec.selector || {}) as Record<string, string>;
      const selectorKeys = Object.keys(selector);

      // Backing pods matching selector strictly
      let totalPods = 0;
      let readyPods = 0;

      if (selectorKeys.length > 0) {
        const matchingPods = allResources.filter((r) => {
          if (r.kind !== 'Pod' || (r.namespace || 'default').toLowerCase() !== targetNs) return false;
          const podLabels = (r.labels || r.specSummary?.labels || (r as any).metadata?.labels || {}) as Record<string, string>;
          return selectorKeys.every((k) => podLabels[k] === selector[k]);
        });
        totalPods = matchingPods.length;
        readyPods = matchingPods.filter((p) => {
          if (p.status !== 'Running' && p.health !== 'HEALTHY') return false;
          if (p.containers && p.containers.length > 0) {
            return p.containers.every((c) => c.ready);
          }
          return true;
        }).length;
      }

      // Ports formatting
      const ports = (Array.isArray(spec.ports) ? spec.ports : []) as Array<{
        name?: string;
        port: number;
        targetPort?: number | string;
        protocol?: string;
        nodePort?: number;
      }>;
      const portsText = ports
        .map((p) => {
          if (p.nodePort) return `${p.port}:${p.nodePort}/${p.protocol || 'TCP'}`;
          if (p.targetPort && String(p.targetPort) !== String(p.port)) {
            return `${p.port}→${p.targetPort}/${p.protocol || 'TCP'}`;
          }
          return `${p.port}/${p.protocol || 'TCP'}`;
        })
        .join(', ');

      const serviceType = spec.type || svc.status || 'ClusterIP';
      const clusterIP = spec.clusterIP || (spec.clusterIPs && spec.clusterIPs[0]) || '-';

      const loadBalancerIngress = status.loadBalancer?.ingress as Array<{ ip?: string; hostname?: string }> | undefined;
      const externalIP =
        (loadBalancerIngress && loadBalancerIngress.length > 0 && (loadBalancerIngress[0].ip || loadBalancerIngress[0].hostname)) ||
        (Array.isArray(spec.externalIPs) && spec.externalIPs[0]) ||
        (serviceType === 'ExternalName' ? spec.externalName : '-');

      const selectorText = selectorKeys.map((k) => `${k}=${selector[k]}`).join(' ');

      map.set(svc.id || `${svc.clusterId}-${svc.namespace}-${svc.name}`, {
        backingPodsTotal: totalPods,
        backingPodsReady: readyPods,
        portsText: portsText || '-',
        serviceType,
        clusterIP,
        externalIP: externalIP || '-',
        selectorText
      });
    }

    return map;
  }, [allServices, allResources]);

  // Filtered services
  const filteredServices = useMemo(() => {
    return allServices.filter((svc) => {
      if (selectedClusterId !== 'all' && svc.clusterId !== selectedClusterId) return false;
      if (selectedNamespace !== 'all' && (svc.namespace || 'default') !== selectedNamespace) return false;

      const stats = serviceStatsMap.get(svc.id || `${svc.clusterId}-${svc.namespace}-${svc.name}`);
      const svcType = stats?.serviceType || svc.status || 'ClusterIP';

      if (selectedType !== 'all' && svcType.toLowerCase() !== selectedType.toLowerCase()) return false;
      if (selectedHealth !== 'all' && svc.health?.toUpperCase() !== selectedHealth.toUpperCase()) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const nameMatch = svc.name.toLowerCase().includes(query);
        const nsMatch = (svc.namespace || 'default').toLowerCase().includes(query);
        const ipMatch = stats?.clusterIP?.toLowerCase().includes(query) || stats?.externalIP?.toLowerCase().includes(query);
        const portMatch = stats?.portsText?.toLowerCase().includes(query);
        const selectorMatch = stats?.selectorText?.toLowerCase().includes(query);
        if (!nameMatch && !nsMatch && !ipMatch && !portMatch && !selectorMatch) return false;
      }

      return true;
    });
  }, [allServices, selectedClusterId, selectedNamespace, selectedType, selectedHealth, searchQuery, serviceStatsMap]);

  // Aggregated Counts
  const metrics = useMemo(() => {
    let healthy = 0;
    let warning = 0;
    let critical = 0;
    let loadBalancers = 0;

    for (const svc of allServices) {
      if (svc.health === 'CRITICAL') critical++;
      else if (svc.health === 'WARNING') warning++;
      else healthy++;

      const stats = serviceStatsMap.get(svc.id || `${svc.clusterId}-${svc.namespace}-${svc.name}`);
      if (stats?.serviceType === 'LoadBalancer') loadBalancers++;
    }

    return { total: allServices.length, healthy, warning, critical, loadBalancers };
  }, [allServices, serviceStatsMap]);

  const handleOpenDetail = (svc: KubernetesResource) => {
    setActiveService(svc);
    if (onSelectService) onSelectService(svc);
  };

  return (
    <div className="space-y-6">
      {/* Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="storm-kpi-card rounded-xl p-4 flex items-center gap-3 shadow-md">
          <div className="p-2.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/30 shadow-[0_0_10px_rgba(14,165,233,0.2)]">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-white font-mono">{metrics.total}</div>
            <div className="text-xs font-mono text-zinc-400">Total Services</div>
          </div>
        </div>

        <div className="storm-kpi-card rounded-xl p-4 flex items-center gap-3 shadow-md">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_10px_rgba(52,211,153,0.2)]">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">{metrics.healthy}</div>
            <div className="text-xs font-mono text-zinc-400">Healthy & Backed</div>
          </div>
        </div>

        <div className="storm-kpi-card rounded-xl p-4 flex items-center gap-3 shadow-md">
          <div className="p-2.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-400 font-mono">{metrics.warning}</div>
            <div className="text-xs font-mono text-zinc-400">Degraded Endpoints</div>
          </div>
        </div>

        <div className="storm-kpi-card rounded-xl p-4 flex items-center gap-3 shadow-md">
          <div className="p-2.5 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 shadow-[0_0_10px_rgba(244,63,94,0.2)]">
            <AlertOctagon className="w-5 h-5" />
          </div>
          <div>
            <div className="text-2xl font-bold text-rose-400 font-mono">{metrics.critical}</div>
            <div className="text-xs font-mono text-zinc-400">Broken Endpoints</div>
          </div>
        </div>
      </div>

      {/* Control / Filter Bar */}
      <div className="storm-card rounded-xl p-4 space-y-4 shadow-xl">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between font-mono text-xs">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-sky-400/60 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter by name, namespace, IP, port, or selector..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-400 font-mono transition-all"
            />
          </div>

          {/* Filters & Refresh */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Cluster Selector / Scope indicator */}
            {!cluster && safeClusters.length > 0 && (
              <select
                value={selectedClusterId}
                onChange={(e) => setSelectedClusterId(e.target.value)}
                className="px-3 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-sky-400 font-mono cursor-pointer"
              >
                <option value="all">
                  {safeClusters.length === 1
                    ? `Cluster: ${safeClusters[0].name || safeClusters[0].id}`
                    : `All Clusters (${safeClusters.length})`}
                </option>
                {safeClusters.length > 1 &&
                  safeClusters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                    </option>
                  ))}
              </select>
            )}

            {cluster && (
              <div className="flex items-center gap-1.5 px-3 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs font-mono text-zinc-300">
                <Server className="w-3.5 h-3.5 text-sky-400" />
                <span>Cluster: <strong className="text-white">{cluster.name || cluster.id}</strong></span>
              </div>
            )}

            {/* Namespace Filter */}
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              className="px-3 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-sky-400 font-mono cursor-pointer"
            >
              <option value="all">All Namespaces</option>
              {namespaces.map((ns) => (
                <option key={ns} value={ns}>
                  {ns}
                </option>
              ))}
            </select>

            {/* Service Type Filter */}
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="px-3 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-sky-400 font-mono cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="ClusterIP">ClusterIP</option>
              <option value="NodePort">NodePort</option>
              <option value="LoadBalancer">LoadBalancer</option>
              <option value="ExternalName">ExternalName</option>
            </select>

            {/* Health Filter */}
            <select
              value={selectedHealth}
              onChange={(e) => setSelectedHealth(e.target.value)}
              className="px-3 py-2 bg-[#030712] border border-sky-500/25 rounded-lg text-xs text-zinc-300 focus:outline-none focus:border-sky-400 font-mono cursor-pointer"
            >
              <option value="all">All Health</option>
              <option value="HEALTHY">Healthy</option>
              <option value="WARNING">Warning</option>
              <option value="CRITICAL">Critical</option>
            </select>

            {(onRefresh || !isControlled) && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                loading={loading || internalLoading}
                className="flex items-center gap-1.5 font-mono text-xs border-sky-500/25 hover:border-sky-500/45"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Services Table */}
      <div className="storm-card rounded-xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-sky-500/15 bg-[#050b18]/90 text-[11px] font-mono text-zinc-400">
                <th className="py-3 px-4">Service Name</th>
                {(!isEmbedded || safeClusters.length > 1) && (
                  <th className="py-3 px-4">Cluster</th>
                )}
                <th className="py-3 px-4">Namespace</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Cluster IP</th>
                <th className="py-3 px-4">External IP</th>
                <th className="py-3 px-4">Ports</th>
                <th className="py-3 px-4">Backing Pods</th>
                <th className="py-3 px-4">Health</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-sans">
              {filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={(!isEmbedded || safeClusters.length > 1) ? 10 : 9} className="py-12 text-center text-zinc-500">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Network className="w-8 h-8 text-zinc-600" />
                      <p className="text-sm font-medium text-zinc-300">No services match the active filters</p>
                      <p className="text-xs text-zinc-500">Try adjusting your search query, namespace, or type filters.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredServices.map((svc) => {
                  const stats = serviceStatsMap.get(svc.id || `${svc.clusterId}-${svc.namespace}-${svc.name}`);
                  const hasBackingPods = stats && stats.backingPodsTotal > 0;
                  const isDegraded = stats && stats.backingPodsTotal > 0 && stats.backingPodsReady < stats.backingPodsTotal;
                  const isZeroEndpoints = stats && stats.backingPodsTotal === 0 && stats.serviceType !== 'ExternalName';

                  return (
                    <tr
                      key={svc.id || `${svc.clusterId}-${svc.namespace}-${svc.name}`}
                      className="hover:bg-zinc-800/40 transition-colors group cursor-pointer"
                      onClick={() => handleOpenDetail(svc)}
                    >
                      {/* Name */}
                      <td className="py-3.5 px-4 font-semibold text-zinc-100 flex items-center gap-2 font-mono">
                        <Network className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        <span className="group-hover:text-sky-300 transition-colors truncate max-w-[200px]">
                          {svc.name}
                        </span>
                      </td>

                      {/* Cluster */}
                      {(!isEmbedded || safeClusters.length > 1) && (
                        <td className="py-3.5 px-4 font-mono text-zinc-300">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800/80 text-zinc-300 text-[11px] border border-zinc-700/60 font-mono">
                            <Server className="w-3 h-3 text-sky-400 shrink-0" />
                            <span className="truncate max-w-[120px]">
                              {svc.clusterName || svc.clusterId || '-'}
                            </span>
                          </span>
                        </td>
                      )}

                      {/* Namespace */}
                      <td className="py-3.5 px-4 font-mono text-zinc-300">{svc.namespace || 'default'}</td>

                      {/* Type Badge */}
                      <td className="py-3.5 px-4">
                        <ServiceTypeBadge type={stats?.serviceType || svc.status || 'ClusterIP'} />
                      </td>

                      {/* Cluster IP */}
                      <td className="py-3.5 px-4 font-mono text-zinc-300">{stats?.clusterIP || '-'}</td>

                      {/* External IP */}
                      <td className="py-3.5 px-4 font-mono text-zinc-400">{stats?.externalIP || '-'}</td>

                      {/* Ports */}
                      <td className="py-3.5 px-4 font-mono text-zinc-300 truncate max-w-[180px]" title={stats?.portsText}>
                        {stats?.portsText || '-'}
                      </td>

                      {/* Backing Pods */}
                      <td className="py-3.5 px-4 font-mono">
                        {stats?.serviceType === 'ExternalName' ? (
                          <span className="text-zinc-500 text-[11px]">External Alias</span>
                        ) : isZeroEndpoints ? (
                          <span className="text-red-400 font-bold flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                            0 endpoints
                          </span>
                        ) : isDegraded ? (
                          <span className="text-amber-400 font-semibold flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            {stats.backingPodsReady}/{stats.backingPodsTotal} ready
                          </span>
                        ) : hasBackingPods ? (
                          <span className="text-emerald-400 font-semibold flex items-center gap-1 text-[11px]">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            {stats.backingPodsReady}/{stats.backingPodsTotal} ready
                          </span>
                        ) : (
                          <span className="text-zinc-500 text-[11px]">No pods</span>
                        )}
                      </td>

                      {/* Health Status */}
                      <td className="py-3.5 px-4">
                        <ResourceHealthBadge health={svc.health} />
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenDetail(svc);
                          }}
                          className="text-sky-400 hover:text-sky-300 text-xs font-medium cursor-pointer inline-flex items-center gap-1"
                        >
                          Inspect →
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Service Detail Modal */}
      {activeService && (
        <ServiceDetailModal
          service={activeService}
          cluster={cluster || (clusters && clusters.find((c) => c.id === activeService.clusterId)) || null}
          clusterResources={allResources}
          incidents={incidents}
          onClose={() => setActiveService(null)}
          onSelectPod={(pod) => setActivePod(pod)}
          onSelectResource={(res) => {
            if (res.kind === 'Pod') setActivePod(res);
            else if (res.kind === 'Service') setActiveService(res);
          }}
        />
      )}

      {/* Pod Detail Modal (if navigated into from backing pods) */}
      {activePod && (
        <PodDetailModal
          pod={activePod}
          clusterResources={allResources}
          incidents={incidents}
          onClose={() => setActivePod(null)}
          onSelectResource={(res) => {
            if (res.kind === 'Pod') setActivePod(res);
            else if (res.kind === 'Service') {
              setActivePod(null);
              setActiveService(res);
            }
          }}
        />
      )}
    </div>
  );
};
