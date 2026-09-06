import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  Boxes,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Activity,
  Layers,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  Terminal,
  X
} from 'lucide-react';
import React, { useState } from 'react';
import { Incident, KubernetesResource } from '../../types/index';
import { PodPhaseBadge, ResourceHealthBadge, SeverityBadge, StatusBadge, WorkloadKindBadge } from '../common/Badges';
import { Button } from '../common/UI';
import { ResourceRelationshipTree } from './ResourceRelationshipTree';

interface PodDetailModalProps {
  pod: KubernetesResource | null;
  clusterResources?: KubernetesResource[];
  incidents?: Incident[];
  onClose: () => void;
  onSelectIncident?: (incidentId: string) => void;
  onSelectResource?: (resource: KubernetesResource) => void;
}

export const PodDetailModal: React.FC<PodDetailModalProps> = ({
  pod,
  clusterResources = [],
  incidents = [],
  onClose,
  onSelectIncident,
  onSelectResource
}) => {
  const [activeSection, setActiveSection] = useState<'diagnostics' | 'resources' | 'containers' | 'hierarchy' | 'events' | 'yaml'>('diagnostics');

  if (!pod) return null;

  // Observability flags
  const containers = pod.containers || [];
  const hasNoLimits = containers.length > 0 && containers.some((c) => !c.memoryLimit && !c.cpuLimit);
  const metricsAvailable = pod.statusSummary?.metricsAvailable === true;
  const metricsObservedAt = pod.statusSummary?.metricsObservedAt as string | undefined;

  // Find linked incident if any
  const linkedIncident = incidents.find(
    (inc) =>
      inc.clusterId === pod.clusterId &&
      inc.namespace === pod.namespace &&
      inc.resourceName === pod.name
  );

  // Check if crashing/failing
  const isCrashing =
    pod.health === 'CRITICAL' ||
    pod.status === 'CrashLoopBackOff' ||
    pod.status === 'ImagePullBackOff' ||
    pod.status === 'ErrImagePull' ||
    pod.status === 'OOMKilled' ||
    pod.status === 'Failed' ||
    pod.status === 'Error';

  const totalRestarts =
    pod.containers?.reduce((sum, c) => sum + (c.restartCount || 0), 0) ?? 0;

  // Find crashing container
  const failingContainer = pod.containers?.find(
    (c) => !c.ready || c.waitingReason || c.terminationReason
  );

  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'Unknown';
    return new Date(ts).toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="bg-zinc-900 border border-zinc-700/80 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-zinc-800 flex items-start justify-between gap-4 bg-zinc-950/60">
          <div className="space-y-1.5 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <WorkloadKindBadge kind="Pod" size="md" />
              <h2 className="text-lg font-bold text-zinc-100 font-mono truncate">{pod.name}</h2>
              <PodPhaseBadge phaseOrStatus={pod.status} restarts={totalRestarts} size="md" />
              <ResourceHealthBadge health={pod.health} size="md" />
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-zinc-400">
              <span>Cluster: <strong className="text-zinc-200">{pod.clusterName || pod.clusterId}</strong></span>
              <span>•</span>
              <span>Namespace: <strong className="text-zinc-200">{pod.namespace}</strong></span>
              <span>•</span>
              <span>Node: <strong className="text-zinc-200">{pod.specSummary?.nodeName as string || 'Scheduled'}</strong></span>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Crash / Incident Alert Banner (Answers "What Pods are crashing/failing, and why?") */}
        {isCrashing && (
          <div className="p-4 bg-rose-950/40 border-b border-rose-900/60 font-mono text-xs space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-300 font-bold">
                <AlertOctagon className="w-4 h-4 text-rose-400 shrink-0" />
                <span>ACTIVE POD INSTABILITY DETECTED: {pod.status}</span>
              </div>
              {totalRestarts > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-900/70 text-rose-200 text-[11px] font-bold border border-rose-700">
                  {totalRestarts} Total Restarts
                </span>
              )}
            </div>

            {failingContainer && (
              <div className="p-2.5 rounded bg-black/40 border border-rose-900/80 space-y-1">
                <div className="text-zinc-300">
                  Container <strong className="text-rose-300">"{failingContainer.name}"</strong> failure diagnosis:
                </div>
                {failingContainer.waitingReason && (
                  <div className="text-rose-400">
                    <strong>Waiting Reason:</strong> {failingContainer.waitingReason}
                    {failingContainer.waitingMessage && (
                      <span className="text-zinc-400 ml-1">({failingContainer.waitingMessage})</span>
                    )}
                  </div>
                )}
                {failingContainer.terminationReason && (
                  <div className="text-rose-400">
                    <strong>Termination Reason:</strong> {failingContainer.terminationReason}
                    {failingContainer.exitCode !== undefined && (
                      <span className="ml-2 px-1.5 py-0.2 bg-rose-950 rounded border border-rose-800 text-[10px]">
                        exit code: {failingContainer.exitCode}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {linkedIncident && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-zinc-300">
                  Correlated Incident: <strong className="text-sky-400">{linkedIncident.id}</strong> — {linkedIncident.title}
                </span>
                {onSelectIncident && (
                  <button
                    onClick={() => {
                      onClose();
                      onSelectIncident(linkedIncident.id);
                    }}
                    className="px-2.5 py-1 rounded bg-sky-900/60 hover:bg-sky-800 text-sky-200 text-xs font-bold border border-sky-700/80 flex items-center gap-1"
                  >
                    Investigate in Incident Console <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Section Navigation Tabs */}
        <div className="flex items-center border-b border-zinc-800 px-5 gap-1 bg-zinc-950/30 overflow-x-auto">
          <button
            onClick={() => setActiveSection('diagnostics')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeSection === 'diagnostics'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Diagnostics & Status
          </button>
          <button
            onClick={() => setActiveSection('resources')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'resources'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Observability & Limits</span>
            {hasNoLimits && (
              <span className="w-2 h-2 rounded-full bg-amber-400" title="No resource limits declared" />
            )}
          </button>
          <button
            onClick={() => setActiveSection('containers')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'containers'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Containers ({pod.containers?.length || 0})
          </button>
          <button
            onClick={() => setActiveSection('hierarchy')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'hierarchy'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Ownership & Hierarchy
          </button>
          <button
            onClick={() => setActiveSection('events')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              activeSection === 'events'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Events ({pod.events?.length || 0})
          </button>
          <button
            onClick={() => setActiveSection('yaml')}
            className={`px-3.5 py-2.5 text-xs font-mono font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeSection === 'yaml'
                ? 'border-sky-500 text-sky-400 bg-sky-950/20'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Raw Spec
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm font-mono">
          {activeSection === 'diagnostics' && (
            <div className="space-y-6">
              {/* Pod Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Phase / Status</div>
                  <div className="text-sm font-bold text-zinc-200 mt-1">{pod.status}</div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Total Restarts</div>
                  <div className={`text-sm font-bold mt-1 ${totalRestarts > 0 ? 'text-rose-400' : 'text-zinc-200'}`}>
                    {totalRestarts}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Scheduled Node</div>
                  <div className="text-sm font-bold text-zinc-200 mt-1 truncate">
                    {pod.specSummary?.nodeName as string || 'Not scheduled'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="text-[10px] text-zinc-500 uppercase">Age / Created</div>
                  <div className="text-sm font-bold text-zinc-200 mt-1">{formatTimestamp(pod.createdAt)}</div>
                </div>
              </div>

              {/* Conditions Diagnostic Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-sky-400" />
                  Kubernetes Pod Lifecycle Conditions
                </h3>

                {(!pod.conditions || pod.conditions.length === 0) ? (
                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-zinc-500 text-xs">
                    Standard healthy pod lifecycle conditions maintained.
                  </div>
                ) : (
                  <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-zinc-900/80 text-zinc-400 border-b border-zinc-800 text-[11px] uppercase">
                        <tr>
                          <th className="p-2.5">Condition Type</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5">Reason</th>
                          <th className="p-2.5">Diagnostic Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-800/60">
                        {pod.conditions.map((c, i) => (
                          <tr key={i} className="hover:bg-zinc-900/40">
                            <td className="p-2.5 font-bold text-zinc-200">{c.type}</td>
                            <td className="p-2.5">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  c.status === 'True'
                                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                                    : 'bg-rose-950 text-rose-300 border border-rose-800/50'
                                }`}
                              >
                                {c.status}
                              </span>
                            </td>
                            <td className="p-2.5 text-zinc-400">{c.reason || '—'}</td>
                            <td className="p-2.5 text-zinc-400">{c.message || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeSection === 'resources' && (
            <div className="space-y-6">
              {/* Observability Badges & Status */}
              <div className="flex items-center gap-2 flex-wrap">
                {hasNoLimits ? (
                  <span className="px-3 py-1 rounded-lg text-xs font-bold bg-amber-950/80 text-amber-400 border border-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    No Limits Declared (Unbounded Resource Risk)
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-950/80 text-emerald-400 border border-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Resource Limits Configured
                  </span>
                )}

                {metricsAvailable ? (
                  <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    Metrics Server API Active
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-lg text-xs font-bold bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    Live Usage Unavailable (Metrics Server not reporting)
                  </span>
                )}
              </div>

              {/* Containers Resource Allocations Table */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-sky-400" />
                  Container CPU & Memory Budget
                </h3>

                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                      <tr>
                        <th className="p-3">Container</th>
                        <th className="p-3">CPU Request</th>
                        <th className="p-3">CPU Limit</th>
                        <th className="p-3">CPU Usage</th>
                        <th className="p-3">Memory Request</th>
                        <th className="p-3">Memory Limit</th>
                        <th className="p-3">Memory Usage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {pod.containers?.map((c, idx) => (
                        <tr key={idx} className="hover:bg-zinc-900/50">
                          <td className="p-3 font-bold text-zinc-200">{c.name}</td>
                          <td className="p-3 text-sky-400">{c.cpuRequest || 'None'}</td>
                          <td className="p-3 text-amber-400">{c.cpuLimit || 'None'}</td>
                          <td className="p-3 text-emerald-400">{c.cpuUsage || 'Unavailable'}</td>
                          <td className="p-3 text-violet-400">{c.memoryRequest || 'None'}</td>
                          <td className="p-3 text-emerald-400">{c.memoryLimit || 'None'}</td>
                          <td className="p-3 text-emerald-400">{c.memoryUsage || 'Unavailable'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Freshness notice */}
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 text-xs text-zinc-500 space-y-1">
                <div>Observed at: <strong className="text-zinc-400">{pod.observedAt ? new Date(pod.observedAt).toLocaleString() : 'N/A'}</strong></div>
                <div>Telemetry Window: <strong className="text-zinc-400">{String(pod.statusSummary?.metricsWindow || '15s')}</strong></div>
              </div>
            </div>
          )}

          {activeSection === 'containers' && (
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-4 h-4 text-sky-400" />
                Container Specifications & Live States
              </h3>

              <div className="space-y-3">
                {pod.containers?.map((c, idx) => (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl bg-zinc-950 border space-y-3 ${
                      !c.ready || c.waitingReason || c.terminationReason
                        ? 'border-rose-800/80'
                        : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Terminal className="w-4 h-4 text-zinc-400" />
                        <span className="font-bold text-zinc-100 text-sm">{c.name}</span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          c.ready
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}
                      >
                        {c.ready ? 'READY (1/1)' : 'NOT READY (0/1)'}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs text-zinc-400 bg-zinc-900/60 p-3 rounded-lg border border-zinc-800/60">
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">State</span>
                        <span className="text-zinc-200 font-bold">{c.state}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">Restarts</span>
                        <span className={`font-bold ${c.restartCount > 0 ? 'text-rose-400' : 'text-zinc-200'}`}>
                          {c.restartCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">Exit Code</span>
                        <span className="text-zinc-200 font-bold">{c.exitCode ?? '0'}</span>
                      </div>
                    </div>

                    <div className="text-xs text-zinc-400">
                      <span className="text-zinc-500 block text-[10px] uppercase">Image Repository & Tag</span>
                      <span className="text-zinc-300 break-all">{c.image}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-zinc-900/40 p-2.5 rounded-lg border border-zinc-800">
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">CPU Request</span>
                        <span className="text-sky-400 font-bold">{c.cpuRequest || 'None'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">CPU Limit</span>
                        <span className="text-amber-400 font-bold">{c.cpuLimit || 'None'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">Mem Request</span>
                        <span className="text-violet-400 font-bold">{c.memoryRequest || 'None'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500 block text-[10px] uppercase">Mem Limit</span>
                        <span className="text-emerald-400 font-bold">{c.memoryLimit || 'None'}</span>
                      </div>
                    </div>

                    {(c.waitingReason || c.waitingMessage) && (
                      <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs space-y-1">
                        <div className="font-bold">Waiting: {c.waitingReason}</div>
                        {c.waitingMessage && <div className="text-rose-400">{c.waitingMessage}</div>}
                      </div>
                    )}

                    {(c.terminationReason || c.terminationMessage) && (
                      <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-rose-300 text-xs space-y-1">
                        <div className="font-bold">Terminated: {c.terminationReason} (code: {c.exitCode})</div>
                        {c.terminationMessage && <div className="text-rose-400">{c.terminationMessage}</div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeSection === 'hierarchy' && (
            <ResourceRelationshipTree
              primaryResource={pod}
              allClusterResources={clusterResources}
              onSelectResource={onSelectResource}
            />
          )}

          {activeSection === 'events' && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                <Calendar className="w-4 h-4 text-sky-400" />
                Kubernetes Pod Events Log
              </h3>

              {(!pod.events || pod.events.length === 0) ? (
                <div className="p-6 bg-zinc-950 border border-zinc-800 rounded-xl text-center text-zinc-500 text-xs">
                  No warning or error events recorded in the current cluster observation window.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-950 divide-y divide-zinc-800/60">
                  {pod.events.map((evt, idx) => (
                    <div key={idx} className="p-3 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                              evt.type === 'Warning'
                                ? 'bg-rose-950 text-rose-300 border border-rose-800'
                                : 'bg-zinc-800 text-zinc-300 border border-zinc-700'
                            }`}
                          >
                            {evt.type}
                          </span>
                          <span className="font-bold text-zinc-200">{evt.reason}</span>
                          {evt.count && evt.count > 1 && (
                            <span className="text-[10px] text-zinc-500 font-mono">({evt.count}x)</span>
                          )}
                        </div>
                        <span className="text-zinc-500 text-[10px]">{formatTimestamp(evt.lastTimestamp)}</span>
                      </div>
                      <div className="text-zinc-300 text-xs pl-2 border-l border-zinc-800">{evt.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeSection === 'yaml' && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Raw Resource Definition</div>
              <pre className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-300 overflow-x-auto font-mono max-h-96">
                {JSON.stringify(pod, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-800 flex items-center justify-between bg-zinc-950/60">
          <span className="text-xs font-mono text-zinc-500">
            Resource UID: {pod.uid || pod.id}
          </span>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
