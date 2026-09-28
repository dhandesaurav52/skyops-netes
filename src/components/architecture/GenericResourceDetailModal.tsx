import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  ExternalLink,
  Eye,
  FileCode,
  FolderTree,
  HardDrive,
  Info,
  Layers,
  Network,
  Radio,
  Server,
  Shield,
  Tag,
  X,
  Zap
} from 'lucide-react';
import { KubernetesResource, Incident, K8sEvent } from '../../types/index';
import { ResourceHealthBadge, StatusBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { ResourceRelationshipTree } from '../resources/ResourceRelationshipTree';
import { formatEventTimestamp } from '../../utils/date';

interface GenericResourceDetailModalProps {
  resource: KubernetesResource | null;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectResource?: (resource: KubernetesResource) => void;
  onSelectIncident?: (incidentId: string) => void;
}

export const GenericResourceDetailModal: React.FC<GenericResourceDetailModalProps> = ({
  resource,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectResource,
  onSelectIncident
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'topology' | 'spec' | 'labels' | 'yaml'>('overview');
  const [copied, setCopied] = useState(false);

  if (!resource) return null;

  const isSecret = resource.kind === 'Secret';

  // Sanitize resource if Secret to strictly ensure no secret.data or values are rendered
  const sanitizedSpecSummary = useMemo(() => {
    if (!resource.specSummary) return {};
    if (isSecret) {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(resource.specSummary)) {
        if (k === 'data' || k === 'stringData') {
          sanitized[k] = '[REDACTED - Secret payload values are not displayed in UI]';
        } else {
          sanitized[k] = v;
        }
      }
      return sanitized;
    }
    return resource.specSummary;
  }, [resource.specSummary, isSecret]);

  // Correlated incidents
  const resourceIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const matchKind = inc.resourceKind === resource.kind;
      const matchName = inc.resourceName === resource.name;
      const matchNs = !inc.namespace || inc.namespace === resource.namespace;
      const matchCluster = !inc.clusterId || inc.clusterId === resource.clusterId;
      return matchKind && matchName && matchNs && matchCluster;
    });
  }, [incidents, resource]);

  // Events from resource or related
  const events = useMemo(() => {
    if (Array.isArray(resource.events)) return resource.events;
    return [];
  }, [resource.events]);

  const handleCopyName = () => {
    navigator.clipboard.writeText(resource.name);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const getKindIcon = (kind: string) => {
    switch (kind) {
      case 'PersistentVolumeClaim':
      case 'PersistentVolume':
      case 'StorageClass':
        return <HardDrive className="w-5 h-5 text-amber-400" />;
      case 'Ingress':
      case 'EndpointSlice':
      case 'NetworkPolicy':
      case 'Service':
        return <Network className="w-5 h-5 text-sky-400" />;
      case 'ConfigMap':
        return <Database className="w-5 h-5 text-emerald-400" />;
      case 'Secret':
        return <Shield className="w-5 h-5 text-purple-400" />;
      case 'HorizontalPodAutoscaler':
      case 'VerticalPodAutoscaler':
        return <Zap className="w-5 h-5 text-yellow-400" />;
      default:
        return <Layers className="w-5 h-5 text-zinc-400" />;
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner">
              {getKindIcon(resource.kind)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 font-semibold border border-zinc-700">
                  {resource.kind}
                </span>
                {resource.namespace && (
                  <span className="text-[10px] font-mono text-zinc-400 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                    ns: {resource.namespace}
                  </span>
                )}
                <ResourceHealthBadge health={resource.health} />
                <StatusBadge status={resource.status} />
              </div>
              <div className="flex items-center gap-2 mt-1">
                <h2 className="text-base font-bold text-zinc-100 font-mono">{resource.name}</h2>
                <button
                  onClick={handleCopyName}
                  title="Copy Resource Name"
                  className="text-zinc-500 hover:text-zinc-300 transition-colors p-1"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                {copied && <span className="text-[10px] text-emerald-400 font-mono">Copied!</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-5 pt-3 border-b border-zinc-800 bg-zinc-950/40 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2.5 px-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'overview'
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Info className="w-3.5 h-3.5" />
            Overview
          </button>
          <button
            onClick={() => setActiveTab('topology')}
            className={`pb-2.5 px-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'topology'
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            Topology & Relationships
          </button>
          <button
            onClick={() => setActiveTab('spec')}
            className={`pb-2.5 px-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'spec'
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Boxes className="w-3.5 h-3.5" />
            Spec & Status
          </button>
          <button
            onClick={() => setActiveTab('labels')}
            className={`pb-2.5 px-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'labels'
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Tag className="w-3.5 h-3.5" />
            Labels & Metadata
          </button>
          <button
            onClick={() => setActiveTab('yaml')}
            className={`pb-2.5 px-2 border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'yaml'
                ? 'border-sky-500 text-sky-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            Observed State YAML
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-5 text-xs">
          {/* Active Incidents Banner if correlated */}
          {resourceIncidents.length > 0 && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-red-400 font-semibold">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Associated Active Incident ({resourceIncidents.length})</span>
                </div>
              </div>
              <div className="space-y-1.5 mt-2">
                {resourceIncidents.map((inc) => (
                  <div
                    key={inc.id}
                    onClick={() => onSelectIncident && onSelectIncident(inc.id)}
                    className="p-2.5 bg-zinc-950/80 border border-red-500/20 hover:border-red-500/40 rounded-lg flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <div>
                      <div className="font-semibold text-zinc-200">{inc.title}</div>
                      <div className="text-[11px] font-mono text-zinc-500">
                        {inc.id} • Severity: {inc.severity} • Status: {inc.status}
                      </div>
                    </div>
                    <span className="text-xs text-sky-400 font-medium">Investigate →</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <div className="space-y-5">
              {/* Quick Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Kind</div>
                  <div className="text-xs font-semibold text-zinc-200 mt-0.5">{resource.kind}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Cluster</div>
                  <div className="text-xs font-mono text-zinc-300 mt-0.5">{resource.clusterId}</div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Created</div>
                  <div className="text-xs font-mono text-zinc-300 mt-0.5">
                    {resource.createdAt ? new Date(resource.createdAt).toLocaleDateString() : '—'}
                  </div>
                </div>
                <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800">
                  <div className="text-[10px] font-mono text-zinc-500 uppercase">Observed</div>
                  <div className="text-xs font-mono text-zinc-300 mt-0.5">
                    {resource.observedAt ? formatEventTimestamp(resource.observedAt) : 'Live'}
                  </div>
                </div>
              </div>

              {/* Security Banner for Secrets */}
              {isSecret && (
                <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-300 text-xs flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>
                    Zero-Knowledge Privacy: SkyOps displays only secret metadata (type, keys, timestamps). Secret payload values are never stored or displayed.
                  </span>
                </div>
              )}

              {/* Conditions if present */}
              {Array.isArray(resource.conditions) && resource.conditions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-300 uppercase font-mono">Resource Conditions</h3>
                  <div className="border border-zinc-800 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-zinc-950 text-zinc-400 font-mono text-[11px] border-b border-zinc-800">
                          <th className="py-2 px-3">Type</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3">Reason</th>
                          <th className="py-2 px-3">Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800">
                        {resource.conditions.map((c, i) => (
                          <tr key={i} className="hover:bg-zinc-800/40">
                            <td className="py-2 px-3 font-mono font-medium text-zinc-200">{c.type}</td>
                            <td className="py-2 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${
                                  c.status === 'True' || (c.status as any) === true
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-zinc-800 text-zinc-400'
                                }`}
                              >
                                {String(c.status)}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono text-zinc-400">{c.reason || '—'}</td>
                            <td className="py-2 px-3 text-zinc-300 text-[11px]">{c.message || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Events if present */}
              {events.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-zinc-300 uppercase font-mono">Recent Cluster Events</h3>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {events.map((e, idx) => (
                      <div
                        key={idx}
                        className={`p-2.5 rounded-lg border text-[11px] font-mono ${
                          e.type === 'Warning'
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                            : 'bg-zinc-950 border-zinc-800 text-zinc-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-zinc-400 text-[10px] mb-1">
                          <span>{e.reason}</span>
                          <span>{formatEventTimestamp(e.timestamp || e.lastTimestamp || Date.now())}</span>
                        </div>
                        <div>{e.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TOPOLOGY TAB */}
          {activeTab === 'topology' && (
            <div className="space-y-4">
              <div className="text-xs text-zinc-400">
                Verified Kubernetes dependency graph resolved directly from real agent telemetry for this {resource.kind}.
              </div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                <ResourceRelationshipTree
                  primaryResource={resource}
                  allClusterResources={clusterResources}
                  onSelectResource={onSelectResource}
                />
              </div>
            </div>
          )}

          {/* SPEC & STATUS TAB */}
          {activeTab === 'spec' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-zinc-400 font-mono uppercase mb-2">Spec Summary</h3>
                <pre className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-60">
                  {JSON.stringify(sanitizedSpecSummary, null, 2)}
                </pre>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-400 font-mono uppercase mb-2">Status Summary</h3>
                <pre className="p-3.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 overflow-x-auto max-h-60">
                  {JSON.stringify(resource.statusSummary || {}, null, 2)}
                </pre>
              </div>
            </div>
          )}

          {/* LABELS & METADATA TAB */}
          {activeTab === 'labels' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-semibold text-zinc-400 font-mono uppercase mb-2">Labels</h3>
                {resource.labels && Object.keys(resource.labels).length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(resource.labels).map(([k, v]) => (
                      <span
                        key={k}
                        className="px-2 py-1 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono text-zinc-300"
                      >
                        <span className="text-sky-400">{k}</span>=<span className="text-emerald-400">{v}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-zinc-500 font-mono text-xs">No labels present</div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-400 font-mono uppercase mb-2">Annotations</h3>
                {resource.annotations && Object.keys(resource.annotations).length > 0 ? (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {Object.entries(resource.annotations).map(([k, v]) => (
                      <div
                        key={k}
                        className="p-2 rounded bg-zinc-950 border border-zinc-800 text-[11px] font-mono break-all"
                      >
                        <span className="text-zinc-400">{k}:</span> <span className="text-zinc-200">{v}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-zinc-500 font-mono text-xs">No annotations present</div>
                )}
              </div>
            </div>
          )}

          {/* YAML TAB */}
          {activeTab === 'yaml' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Normalized Kubernetes representation observed by SkyOps Agent:</span>
                <button
                  onClick={() => {
                    const yamlStr = JSON.stringify(
                      {
                        apiVersion: resource.apiVersion || 'v1',
                        kind: resource.kind,
                        metadata: {
                          name: resource.name,
                          namespace: resource.namespace,
                          labels: resource.labels,
                          annotations: resource.annotations,
                          creationTimestamp: new Date(resource.createdAt).toISOString()
                        },
                        spec: sanitizedSpecSummary,
                        status: resource.statusSummary
                      },
                      null,
                      2
                    );
                    navigator.clipboard.writeText(yamlStr);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-mono cursor-pointer flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {copied ? 'Copied' : 'Copy JSON/YAML'}
                </button>
              </div>
              <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-300 overflow-x-auto max-h-[350px]">
                {JSON.stringify(
                  {
                    apiVersion: resource.apiVersion || 'v1',
                    kind: resource.kind,
                    metadata: {
                      name: resource.name,
                      namespace: resource.namespace,
                      labels: resource.labels,
                      annotations: resource.annotations,
                      creationTimestamp: new Date(resource.createdAt).toISOString()
                    },
                    spec: sanitizedSpecSummary,
                    status: resource.statusSummary
                  },
                  null,
                  2
                )}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 bg-zinc-950/60 flex items-center justify-between">
          <div className="text-[11px] font-mono text-zinc-500">
            ID: <span className="text-zinc-400">{resource.id}</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
