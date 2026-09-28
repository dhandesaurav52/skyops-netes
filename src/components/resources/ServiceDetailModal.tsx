import React, { useMemo, useState } from 'react';
import {
  Network,
  Activity,
  Layers,
  Boxes,
  Clock,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Cpu,
  Database,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  FileCode,
  Tag,
  Radio,
  Server
} from 'lucide-react';
import { Cluster, Incident, K8sEvent, KubernetesResource } from '../../types/index';
import { Button, CodeBlock, CopyButton } from '../common/UI';
import { ResourceHealthBadge, ServiceTypeBadge, SeverityBadge, StatusBadge, PodPhaseBadge } from '../common/Badges';
import { ResourceRelationshipTree } from './ResourceRelationshipTree';
import { formatEventTimestamp, formatTimeAgo, safeEventTimestamp } from '../../utils/date';

interface ServiceDetailModalProps {
  service: KubernetesResource | null;
  cluster?: Cluster | null;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectPod?: (pod: KubernetesResource) => void;
  onSelectResource?: (resource: KubernetesResource) => void;
}

type ServiceTab = 'overview' | 'pods' | 'endpoints' | 'relationships' | 'events' | 'incidents' | 'yaml';

export const ServiceDetailModal: React.FC<ServiceDetailModalProps> = ({
  service,
  cluster,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectPod,
  onSelectResource
}) => {
  const [activeTab, setActiveTab] = useState<ServiceTab>('overview');

  if (!service) return null;

  const spec = (service.specSummary || {}) as Record<string, any>;
  const status = (service.statusSummary || {}) as Record<string, any>;
  const targetNs = (service.namespace || 'default').toLowerCase();

  const serviceType = spec.type || service.status || 'ClusterIP';
  const clusterIP = spec.clusterIP || (spec.clusterIPs && spec.clusterIPs[0]) || 'None';
  const selector = (spec.selector || {}) as Record<string, string>;
  const selectorKeys = Object.keys(selector);
  const ports = (Array.isArray(spec.ports) ? spec.ports : []) as Array<{
    name?: string;
    port: number;
    targetPort?: number | string;
    protocol?: string;
    nodePort?: number;
  }>;

  const loadBalancerIngress = status.loadBalancer?.ingress as Array<{ ip?: string; hostname?: string }> | undefined;
  const externalIP =
    (loadBalancerIngress && loadBalancerIngress.length > 0 && (loadBalancerIngress[0].ip || loadBalancerIngress[0].hostname)) ||
    (Array.isArray(spec.externalIPs) && spec.externalIPs[0]) ||
    (serviceType === 'ExternalName' ? spec.externalName : '-');

  // Discover Backing Pods matching selector strictly
  const backingPods = useMemo(() => {
    if (selectorKeys.length === 0) return [];
    return clusterResources.filter((r) => {
      if (r.kind !== 'Pod' || (r.namespace || 'default').toLowerCase() !== targetNs) return false;
      const podLabels = (r.labels || r.specSummary?.labels || (r as any).metadata?.labels || {}) as Record<string, string>;
      return selectorKeys.every((k) => podLabels[k] === selector[k]);
    });
  }, [clusterResources, selector, selectorKeys, targetNs]);

  // Discover EndpointSlices for this service
  const relatedEndpointSlices = useMemo(() => {
    return clusterResources.filter(
      (r) =>
        r.kind === 'EndpointSlice' &&
        (r.namespace || 'default').toLowerCase() === targetNs &&
        (r.labels?.['kubernetes.io/service-name'] === service.name ||
          r.name === service.name ||
          r.name.startsWith(service.name + '-'))
    );
  }, [clusterResources, service.name, targetNs]);

  // Backing pods ready count
  const readyPodsCount = useMemo(() => {
    return backingPods.filter((p) => {
      if (p.status !== 'Running' && p.health !== 'HEALTHY') return false;
      if (p.containers && p.containers.length > 0) {
        return p.containers.every((c) => c.ready);
      }
      return true;
    }).length;
  }, [backingPods]);

  // Related Incidents
  const relatedIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (inc.resourceKind === 'Service' && inc.resourceName === service.name) return true;
      if (inc.resourceKind === 'Pod' && backingPods.some((p) => p.name === inc.resourceName)) return true;
      return false;
    });
  }, [incidents, service.name, backingPods]);

  // Service Events
  const events = useMemo(() => {
    if (Array.isArray(service.events)) return service.events;
    return [];
  }, [service.events]);

  const rawJson = useMemo(() => {
    return JSON.stringify(service, null, 2);
  }, [service]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-start justify-between p-6 border-b border-zinc-800 bg-zinc-900/50">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl text-sky-400 mt-1">
              <Network className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-zinc-100 font-mono">{service.name}</h2>
                <ServiceTypeBadge type={serviceType} />
                <ResourceHealthBadge health={service.health} />
              </div>
              <div className="flex items-center gap-3 text-xs text-zinc-400 mt-1.5 font-mono">
                <span>ns: {service.namespace || 'default'}</span>
                <span>•</span>
                <span>cluster: {cluster?.name || service.clusterId}</span>
                {service.createdAt && (
                  <>
                    <span>•</span>
                    <span>created: {formatTimeAgo(service.createdAt)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CopyButton text={rawJson} label="Copy JSON" />
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 p-2 rounded-lg hover:bg-zinc-800/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 border-b border-zinc-800 bg-zinc-950/40 overflow-x-auto">
          {[
            { id: 'overview' as ServiceTab, label: 'Overview', icon: <Activity className="w-4 h-4" /> },
            {
              id: 'pods' as ServiceTab,
              label: `Backing Pods (${backingPods.length})`,
              icon: <Boxes className="w-4 h-4" />
            },
            {
              id: 'endpoints' as ServiceTab,
              label: `EndpointSlices (${relatedEndpointSlices.length})`,
              icon: <Radio className="w-4 h-4" />
            },
            { id: 'relationships' as ServiceTab, label: 'Topology Graph', icon: <Layers className="w-4 h-4" /> },
            { id: 'events' as ServiceTab, label: `Events (${events.length})`, icon: <Clock className="w-4 h-4" /> },
            {
              id: 'incidents' as ServiceTab,
              label: `Incidents (${relatedIncidents.length})`,
              icon: <ShieldAlert className="w-4 h-4" />,
              badge: relatedIncidents.length > 0 ? relatedIncidents.length : undefined
            },
            { id: 'yaml' as ServiceTab, label: 'Manifest', icon: <FileCode className="w-4 h-4" /> }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'border-sky-500 text-sky-400 bg-sky-500/5'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-red-500/20 text-red-300 border border-red-500/30">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Health Banner if Warning / Critical */}
              {service.health !== 'HEALTHY' && (
                <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-amber-200">Service Degraded / Unhealthy</h4>
                    <p className="text-xs text-amber-300/80 mt-1 leading-relaxed">
                      {selectorKeys.length > 0 && backingPods.length === 0
                        ? `No backing pods found matching selector: ${selectorKeys.map((k) => `${k}=${selector[k]}`).join(', ')}. Traffic routed to this service will fail.`
                        : readyPodsCount === 0 && backingPods.length > 0
                        ? `All ${backingPods.length} backing pod(s) are currently unready or failing readiness probes.`
                        : `Only ${readyPodsCount} of ${backingPods.length} backing pods are ready to serve incoming traffic.`}
                    </p>
                  </div>
                </div>
              )}

              {/* Top Details Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4">
                  <span className="text-zinc-400 text-xs font-mono">Service Type</span>
                  <div className="mt-1">
                    <ServiceTypeBadge type={serviceType} />
                  </div>
                </div>

                <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4">
                  <span className="text-zinc-400 text-xs font-mono">Cluster IP</span>
                  <p className="text-zinc-200 font-mono text-sm mt-1">{clusterIP}</p>
                </div>

                <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-4">
                  <span className="text-zinc-400 text-xs font-mono">External / Ingress IP</span>
                  <p className="text-zinc-200 font-mono text-sm mt-1">{externalIP}</p>
                </div>
              </div>

              {/* Ports Configuration */}
              <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                  <Network className="w-4 h-4 text-sky-400" />
                  Port Mappings ({ports.length})
                </h3>
                {ports.length === 0 ? (
                  <p className="text-xs text-zinc-500">No ports exposed on this service.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-zinc-700/60 text-zinc-400 font-mono text-[11px]">
                          <th className="py-2 px-3">Port Name</th>
                          <th className="py-2 px-3">Service Port</th>
                          <th className="py-2 px-3">Target Port</th>
                          <th className="py-2 px-3">Node Port</th>
                          <th className="py-2 px-3">Protocol</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800 font-mono">
                        {ports.map((p, idx) => (
                          <tr key={idx} className="hover:bg-zinc-800/30">
                            <td className="py-2.5 px-3 text-zinc-300 font-medium">{p.name || '-'}</td>
                            <td className="py-2.5 px-3 text-sky-400 font-bold">{p.port}</td>
                            <td className="py-2.5 px-3 text-emerald-400">{p.targetPort || p.port}</td>
                            <td className="py-2.5 px-3 text-amber-400">{p.nodePort || '-'}</td>
                            <td className="py-2.5 px-3 text-zinc-400">{p.protocol || 'TCP'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Pod Selector */}
              <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-emerald-400" />
                  Pod Selector & Backing Pool
                </h3>
                {selectorKeys.length === 0 ? (
                  <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-xs text-zinc-400">
                    No selector specified. This service uses manual Endpoints or represents an external alias.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(selector).map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-700/80 text-xs font-mono text-zinc-200"
                        >
                          <span className="text-zinc-400">{k}:</span>
                          <span className="text-emerald-400 font-medium">{v}</span>
                        </span>
                      ))}
                    </div>

                    <div className="flex items-center justify-between p-3.5 bg-zinc-900/70 border border-zinc-800 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2.5 h-2.5 rounded-full ${
                            backingPods.length > 0 && readyPodsCount === backingPods.length
                              ? 'bg-emerald-400'
                              : backingPods.length > 0
                              ? 'bg-amber-400'
                              : 'bg-red-400'
                          }`}
                        />
                        <div>
                          <div className="text-xs font-semibold text-zinc-200">
                            {readyPodsCount} / {backingPods.length} Backing Pods Ready
                          </div>
                          <div className="text-[11px] text-zinc-400">
                            {backingPods.length === 0
                              ? 'Zero pods match selector labels in this namespace'
                              : `Selected strictly via namespace "${targetNs}" and label selector`}
                          </div>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setActiveTab('pods')}
                        className="text-xs"
                      >
                        Inspect Pods →
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* BACKING PODS TAB */}
          {activeTab === 'pods' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">
                  Target Pods ({backingPods.length})
                </h3>
                <span className="text-xs text-zinc-400 font-mono">
                  {readyPodsCount}/{backingPods.length} Ready
                </span>
              </div>

              {backingPods.length === 0 ? (
                <div className="p-8 text-center bg-zinc-800/20 border border-dashed border-zinc-800 rounded-xl space-y-2">
                  <Boxes className="w-8 h-8 text-zinc-600 mx-auto" />
                  <p className="text-sm text-zinc-300 font-medium">No backing pods match this service selector</p>
                  <p className="text-xs text-zinc-500 max-w-md mx-auto">
                    Check if the deployment label selector matches the service selector exact keys and values.
                  </p>
                </div>
              ) : (
                <div className="bg-zinc-800/30 border border-zinc-700/50 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-950/60 font-mono text-[11px] text-zinc-400">
                        <th className="py-3 px-4">Pod Name</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Ready</th>
                        <th className="py-3 px-4">Restarts</th>
                        <th className="py-3 px-4">IP</th>
                        <th className="py-3 px-4">Node</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 font-sans">
                      {backingPods.map((pod) => {
                        const readyContainers = pod.containers?.filter((c) => c.ready).length || 0;
                        const totalContainers = pod.containers?.length || 1;
                        const totalRestarts = pod.containers?.reduce((acc, c) => acc + (c.restartCount || 0), 0) || 0;
                        const podIp = String(pod.specSummary?.podIP || pod.statusSummary?.podIP || '-');
                        const nodeName = String(pod.nodeName || pod.specSummary?.nodeName || '-');

                        return (
                          <tr key={pod.id || pod.name} className="hover:bg-zinc-800/40 transition-colors">
                            <td className="py-3 px-4 font-mono font-semibold text-zinc-100 flex items-center gap-2">
                              <Boxes className="w-3.5 h-3.5 text-zinc-500" />
                              <span className="truncate max-w-[200px]">{pod.name}</span>
                            </td>
                            <td className="py-3 px-4">
                              <PodPhaseBadge phase={pod.status} />
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">
                              {readyContainers}/{totalContainers}
                            </td>
                            <td className="py-3 px-4 font-mono text-zinc-300">{totalRestarts}</td>
                            <td className="py-3 px-4 font-mono text-zinc-400">{podIp}</td>
                            <td className="py-3 px-4 font-mono text-zinc-400 truncate max-w-[140px]">{nodeName}</td>
                            <td className="py-3 px-4 text-right">
                              <button
                                onClick={() => onSelectPod && onSelectPod(pod)}
                                className="text-sky-400 hover:text-sky-300 text-xs font-medium cursor-pointer"
                              >
                                Details →
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ENDPOINTS TAB */}
          {activeTab === 'endpoints' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">
                  EndpointSlices ({relatedEndpointSlices.length})
                </h3>
              </div>

              {relatedEndpointSlices.length === 0 ? (
                <div className="p-8 text-center bg-zinc-800/20 border border-dashed border-zinc-800 rounded-xl space-y-2">
                  <Radio className="w-8 h-8 text-zinc-600 mx-auto" />
                  <p className="text-sm text-zinc-300 font-medium">No EndpointSlices found for this service</p>
                  <p className="text-xs text-zinc-500 max-w-md mx-auto">
                    Kubernetes endpoint-slice-controller creates slices automatically for services with selectors.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {relatedEndpointSlices.map((slice) => {
                    const endpoints = (slice.specSummary?.endpoints || slice.statusSummary?.endpoints || []) as any[];
                    return (
                      <div
                        key={slice.id || slice.name}
                        className="p-4 bg-zinc-800/30 border border-zinc-700/50 rounded-xl space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Radio className="w-4 h-4 text-sky-400" />
                            <span className="font-mono text-xs font-bold text-zinc-100">{slice.name}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                            {slice.status || 'Active'}
                          </span>
                        </div>

                        {endpoints.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs border-collapse font-mono">
                              <thead>
                                <tr className="border-b border-zinc-800 text-zinc-400 text-[10px]">
                                  <th className="py-1 px-2">Addresses</th>
                                  <th className="py-1 px-2">Ready</th>
                                  <th className="py-1 px-2">Target Ref</th>
                                  <th className="py-1 px-2">Node</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-zinc-800/50">
                                {endpoints.map((ep, i) => (
                                  <tr key={i} className="hover:bg-zinc-800/20">
                                    <td className="py-1.5 px-2 text-zinc-200">
                                      {Array.isArray(ep.addresses) ? ep.addresses.join(', ') : ep.ip || '-'}
                                    </td>
                                    <td className="py-1.5 px-2">
                                      {ep.conditions?.ready !== false ? (
                                        <span className="text-emerald-400">Ready</span>
                                      ) : (
                                        <span className="text-red-400">Not Ready</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 text-zinc-400">
                                      {ep.targetRef ? `${ep.targetRef.kind}/${ep.targetRef.name}` : '-'}
                                    </td>
                                    <td className="py-1.5 px-2 text-zinc-400">{ep.nodeName || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-500 font-mono">No endpoint addresses registered yet.</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TOPOLOGY & RELATIONSHIPS TAB */}
          {activeTab === 'relationships' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-200 mb-2">Service Relationship Graph</h3>
              <ResourceRelationshipTree
                primaryResource={service}
                allClusterResources={clusterResources}
                onSelectResource={onSelectResource}
              />
            </div>
          )}

          {/* EVENTS TAB */}
          {activeTab === 'events' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-200">Recent Events</h3>
              {events.length === 0 ? (
                <div className="p-8 text-center bg-zinc-800/20 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No events recorded for this service.
                </div>
              ) : (
                <div className="space-y-2">
                  {events.map((evt, idx) => (
                    <div
                      key={evt.id || idx}
                      className="p-3 rounded-lg bg-zinc-800/40 border border-zinc-700/40 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              evt.type === 'Warning'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                : 'bg-zinc-800 text-zinc-300'
                            }`}
                          >
                            {evt.type}
                          </span>
                          <span className="font-semibold text-zinc-200 font-mono">{evt.reason}</span>
                          {evt.count && evt.count > 1 && (
                            <span className="text-[10px] text-zinc-400 font-mono">({evt.count}x)</span>
                          )}
                        </div>
                        <span className="text-zinc-500 text-[10px]">
                          {formatEventTimestamp(safeEventTimestamp(evt))}
                        </span>
                      </div>
                      <p className="text-zinc-300 leading-relaxed pl-2 border-l border-zinc-800">{evt.message}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* INCIDENTS TAB */}
          {activeTab === 'incidents' && (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-zinc-200">Related Incidents ({relatedIncidents.length})</h3>
              {relatedIncidents.length === 0 ? (
                <div className="p-8 text-center bg-zinc-800/20 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-xs">
                  No active incidents detected for this service or its backing pods.
                </div>
              ) : (
                <div className="space-y-3">
                  {relatedIncidents.map((inc) => (
                    <div
                      key={inc.id}
                      className="p-4 rounded-xl bg-zinc-800/40 border border-zinc-700/60 hover:border-zinc-600 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <SeverityBadge severity={inc.severity} />
                          <span className="font-mono text-xs font-bold text-zinc-200">{inc.id}</span>
                          <span className="text-xs text-zinc-300 font-medium">{inc.title}</span>
                        </div>
                        <StatusBadge status={inc.status} />
                      </div>
                      <p className="text-xs text-zinc-400 line-clamp-2">
                        {inc.summary || inc.technicalDetails?.rootCause || 'Under active root-cause analysis'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* MANIFEST / YAML TAB */}
          {activeTab === 'yaml' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400 font-mono">Kubernetes Resource Definition</span>
                <CopyButton text={rawJson} label="Copy JSON" />
              </div>
              <CodeBlock code={rawJson} language="json" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
