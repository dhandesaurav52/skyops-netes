import {
  AlertCircle,
  ArrowDownToLine,
  Ban,
  Check,
  Clock,
  Copy,
  Download,
  Filter,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
  Terminal,
  X
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client';
import { ContainerDiagnostic, KubernetesResource, PodLogsResponse } from '../../types/index';
import { Button } from '../common/UI';

interface PodLogsViewerProps {
  clusterId: string;
  namespace: string;
  podName: string;
  containers?: ContainerDiagnostic[];
  initialContainer?: string;
  initialPrevious?: boolean;
  onClose?: () => void;
  isEmbedded?: boolean;
}

export const PodLogsViewer: React.FC<PodLogsViewerProps> = ({
  clusterId,
  namespace,
  podName,
  containers = [],
  initialContainer,
  initialPrevious = false,
  onClose,
  isEmbedded = false
}) => {
  const [selectedContainer, setSelectedContainer] = useState<string>(() => {
    if (initialContainer) return initialContainer;
    if (containers.length > 0) return containers[0].name;
    return '';
  });

  const [isPrevious, setIsPrevious] = useState<boolean>(initialPrevious);
  const [tailLines, setTailLines] = useState<number>(250);
  const [sinceSeconds, setSinceSeconds] = useState<number | undefined>(undefined);
  const [showTimestamps, setShowTimestamps] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isCleared, setIsCleared] = useState<boolean>(false);

  const [logData, setLogData] = useState<PodLogsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // Sync initial container if containers change
  useEffect(() => {
    if (containers.length > 0) {
      if (!selectedContainer || !containers.some((c) => c.name === selectedContainer)) {
        const preferred =
          initialContainer && containers.some((c) => c.name === initialContainer)
            ? initialContainer
            : containers[0].name;
        setSelectedContainer(preferred);
      }
    }
  }, [containers, initialContainer, selectedContainer]);

  const fetchLogs = async (isBackground = false) => {
    if (!clusterId || !podName) return;

    if (!namespace || namespace.trim() === '') {
      setError('Pod namespace is unavailable.');
      setLoading(false);
      setLogData({
        clusterId,
        namespace: '',
        podName,
        container: selectedContainer || '',
        totalLines: 0,
        lines: [],
        statusCategory: 'POD_NOT_FOUND',
        unavailableReason: 'Pod namespace is unavailable.',
        timestamps: false,
        previous: false,
        rawText: '',
        source: 'none',
        retrievedAt: Date.now()
      });
      return;
    }

    try {
      if (!isBackground) setLoading(true);
      setError(null);
      setIsCleared(false);

      const resp = await api.getPodLogs(clusterId, namespace, podName, {
        container: selectedContainer || undefined,
        tailLines,
        previous: isPrevious,
        sinceSeconds,
        timestamps: showTimestamps
      });

      setLogData(resp);
    } catch (err: any) {
      console.warn('Failed to fetch pod logs:', err);
      setError(err?.message || 'Failed to retrieve container logs');
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs(false);
  }, [clusterId, namespace, podName, selectedContainer, isPrevious, tailLines, sinceSeconds, showTimestamps]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchLogs(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, clusterId, namespace, podName, selectedContainer, isPrevious, tailLines, sinceSeconds, showTimestamps]);

  // Filtered log lines
  const filteredLines = useMemo(() => {
    if (isCleared) return [];
    if (!logData || !Array.isArray(logData.lines)) return [];
    if (!searchTerm.trim()) return logData.lines;

    const term = searchTerm.toLowerCase();
    return logData.lines.filter(
      (line) =>
        line.message.toLowerCase().includes(term) ||
        (line.timestamp && line.timestamp.toLowerCase().includes(term))
    );
  }, [logData, searchTerm, isCleared]);

  const handleCopy = () => {
    if (!logData) return;
    const content = filteredLines.map((l) => (showTimestamps && l.timestamp ? `${l.timestamp} ${l.message}` : l.message)).join('\n');
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!logData) return;
    const content = filteredLines.map((l) => (showTimestamps && l.timestamp ? `${l.timestamp} ${l.message}` : l.message)).join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-${selectedContainer || 'logs'}${isPrevious ? '-previous' : ''}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const scrollToBottom = () => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const selectedContainerObj = containers.find((c) => c.name === selectedContainer);

  return (
    <div
      className={`flex flex-col bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden font-mono ${
        isFullscreen
          ? 'fixed inset-4 z-50 shadow-2xl border-zinc-700 bg-zinc-950'
          : isEmbedded
          ? 'h-full min-h-[460px]'
          : 'h-[580px]'
      }`}
    >
      {/* Header Toolbar */}
      <div className="bg-zinc-900/90 border-b border-zinc-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
          <div className="flex items-center gap-1.5 truncate">
            <span className="text-zinc-400">Pod:</span>
            <span className="font-bold text-zinc-100 truncate">{podName}</span>
          </div>

          {/* Container Selector */}
          {containers.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-zinc-500 text-[11px]">Container:</span>
              <select
                value={selectedContainer}
                onChange={(e) => setSelectedContainer(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px] rounded px-2 py-1 outline-none focus:border-sky-500"
              >
                {containers.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name} {c.ready ? '(Ready)' : c.waitingReason ? `(${c.waitingReason})` : '(Not Ready)'}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Previous Container Toggle */}
          <button
            onClick={() => setIsPrevious(!isPrevious)}
            title={isPrevious ? 'Viewing previous crashed container logs' : 'Switch to previous terminated container logs'}
            className={`px-2 py-1 rounded text-[11px] border transition-colors flex items-center gap-1 ${
              isPrevious
                ? 'bg-amber-950/80 text-amber-300 border-amber-800 font-bold'
                : 'bg-zinc-800/80 text-zinc-400 border-zinc-700 hover:text-zinc-200'
            }`}
          >
            <Clock className="w-3 h-3" />
            Previous Logs
          </button>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* Tail Lines */}
          <div className="flex items-center gap-1 text-[11px] text-zinc-400">
            <span>Tail:</span>
            <select
              value={tailLines}
              onChange={(e) => setTailLines(Number(e.target.value))}
              className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded px-1.5 py-0.5 outline-none focus:border-sky-500"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>

          {/* Time Window (Since) */}
          <div className="flex items-center gap-1 text-[11px] text-zinc-400">
            <span>Since:</span>
            <select
              value={sinceSeconds ?? ''}
              onChange={(e) => setSinceSeconds(e.target.value ? Number(e.target.value) : undefined)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-200 rounded px-1.5 py-0.5 outline-none focus:border-sky-500"
            >
              <option value="">All Time</option>
              <option value={300}>5m</option>
              <option value={900}>15m</option>
              <option value={3600}>1h</option>
              <option value={86400}>24h</option>
            </select>
          </div>

          {/* Timestamps Toggle */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            className={`px-2 py-1 rounded text-[11px] border transition-colors ${
              showTimestamps
                ? 'bg-sky-950/60 text-sky-300 border-sky-800/80'
                : 'bg-zinc-800/60 text-zinc-400 border-zinc-700'
            }`}
          >
            Timestamps
          </button>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2 py-1 rounded text-[11px] border transition-colors flex items-center gap-1 ${
              autoRefresh
                ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800 font-semibold'
                : 'bg-zinc-800/60 text-zinc-400 border-zinc-700'
            }`}
          >
            <RefreshCw className={`w-3 h-3 ${autoRefresh ? 'animate-spin' : ''}`} />
            Live (5s)
          </button>

          {/* Refresh Manual Button */}
          <button
            onClick={() => fetchLogs(false)}
            disabled={loading}
            title="Refresh logs"
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* Clear Logs Button */}
          <button
            onClick={() => setIsCleared(true)}
            disabled={!logData || isCleared || filteredLines.length === 0}
            title="Clear current log view"
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-40 flex items-center gap-1 px-2 text-[11px]"
          >
            <Ban className="w-3.5 h-3.5 text-zinc-400" />
            <span>Clear</span>
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            disabled={!logData || filteredLines.length === 0}
            title="Copy logs to clipboard"
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-40 flex items-center gap-1 px-2 text-[11px]"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          {/* Download Button */}
          <button
            onClick={handleDownload}
            disabled={!logData || filteredLines.length === 0}
            title="Download logs file"
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Expand Fullscreen'}
            className="p-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Close modal if applicable */}
          {onClose && (
            <button
              onClick={onClose}
              title="Close log viewer"
              className="p-1 rounded bg-zinc-800/80 border border-zinc-700 text-zinc-400 hover:text-rose-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="bg-zinc-900/40 border-b border-zinc-800/80 px-4 py-1.5 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search log lines (regex or text)..."
            className="bg-transparent text-zinc-200 placeholder-zinc-500 text-xs outline-none w-full"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-zinc-500 hover:text-zinc-300">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-400">
          {searchTerm && (
            <span className="text-sky-400">
              {filteredLines.length} match{filteredLines.length === 1 ? '' : 'es'}
            </span>
          )}
          <span>
            Showing {filteredLines.length} / {logData?.totalLines || 0} lines
          </span>
          {logData?.source && (
            <span className="text-zinc-500 text-[10px] uppercase">
              Src: {logData.source}
            </span>
          )}
          <button
            onClick={scrollToBottom}
            className="text-zinc-400 hover:text-sky-300 text-[11px] flex items-center gap-1"
          >
            <ArrowDownToLine className="w-3 h-3" />
            Bottom
          </button>
        </div>
      </div>

      {/* Terminal View Content Area */}
      <div
        ref={terminalContainerRef}
        className="flex-1 overflow-y-auto bg-black p-4 text-xs font-mono select-text"
      >
        {loading && !logData && (
          <div className="h-full flex flex-col items-center justify-center space-y-3 text-zinc-400">
            <RefreshCw className="w-6 h-6 text-sky-400 animate-spin" />
            <div className="text-xs">
              Streaming logs for {namespace ? `${namespace}/` : ''}{podName} / {selectedContainer || 'default'}...
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-950/40 border border-rose-900 rounded-lg text-rose-300 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold">Log Retrieval Error</div>
              <div className="text-rose-400 text-xs">{error}</div>
              <Button size="sm" variant="secondary" onClick={() => fetchLogs(false)} className="mt-2 text-xs">
                Retry
              </Button>
            </div>
          </div>
        )}

        {!loading && !error && filteredLines.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-zinc-400 space-y-3">
            <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-full text-zinc-400">
              <Terminal className="w-6 h-6" />
            </div>

            {logData?.statusCategory === 'PERMISSION_DENIED' || logData?.unavailableReason?.includes('permission') ? (
              <>
                <div className="text-sm font-semibold text-amber-400">Permission Denied</div>
                <div className="max-w-md text-xs text-zinc-300 font-mono bg-zinc-900/90 p-3 rounded-lg border border-amber-900/50">
                  SkyOps cannot read logs for this container because the cluster agent lacks the required Kubernetes permission.
                </div>
                <div className="text-[11px] text-zinc-500 max-w-md">
                  Verify ClusterRole for the agent includes <code className="text-amber-400">apiGroups: [""]</code>, <code className="text-amber-400">resources: ["pods/log"]</code>, <code className="text-amber-400">verbs: ["get", "list"]</code>.
                </div>
              </>
            ) : logData?.statusCategory === 'AGENT_DISCONNECTED' || (logData?.statusCategory === 'UNKNOWN_ERROR' && logData?.unavailableReason?.includes('Agent disconnected')) ? (
              <>
                <div className="text-sm font-semibold text-rose-400">Agent Disconnected</div>
                <div className="max-w-md text-xs text-rose-300 font-mono bg-rose-950/30 p-3 rounded-lg border border-rose-900/50">
                  Agent disconnected. Live container logs cannot be retrieved until the agent reconnects.
                </div>
              </>
            ) : logData?.statusCategory === 'CONTAINER_WAITING' ? (
              <>
                <div className="text-sm font-semibold text-amber-400">Container Waiting to Start</div>
                <div className="max-w-md text-xs text-zinc-300 font-mono bg-zinc-900/90 p-3 rounded-lg border border-amber-900/50">
                  {logData.unavailableReason || `Container is waiting: ${logData.waitingReason || 'Pending'}`}
                </div>
                {logData.waitingMessage && (
                  <div className="text-[11px] text-zinc-400 max-w-md">{logData.waitingMessage}</div>
                )}
              </>
            ) : logData?.statusCategory === 'POD_INITIALIZING' ? (
              <>
                <div className="text-sm font-semibold text-sky-400">Pod Initializing</div>
                <div className="max-w-md text-xs text-zinc-300 font-mono bg-zinc-900/90 p-3 rounded-lg border border-sky-900/50">
                  Pod is currently executing init containers. Application container logs will be available once init containers complete.
                </div>
              </>
            ) : logData?.statusCategory === 'POD_NOT_FOUND' ? (
              <>
                <div className="text-sm font-semibold text-amber-400">Pod Not Found</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  {logData.unavailableReason || (namespace ? `Pod "${namespace}/${podName}" was not found in cluster resources. It may have been evicted or deleted.` : 'Pod namespace is unavailable.')}
                </div>
              </>
            ) : logData?.statusCategory === 'CONTAINER_NOT_FOUND' ? (
              <>
                <div className="text-sm font-semibold text-amber-400">Container Not Found</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  {logData.unavailableReason || `Container ${selectedContainer} does not exist in pod ${podName}.`}
                </div>
              </>
            ) : logData?.statusCategory === 'PREVIOUS_LOGS_UNAVAILABLE' || (isPrevious && (!logData?.rawText || logData?.totalLines === 0)) ? (
              <>
                <div className="text-sm font-semibold text-zinc-300">Previous Logs Unavailable</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  Previous container logs are not available from Kubernetes. The container may not have restarted yet.
                </div>
              </>
            ) : logData?.statusCategory === 'KUBERNETES_API_UNAVAILABLE' || logData?.statusCategory === 'K8S_API_ERROR' ? (
              <>
                <div className="text-sm font-semibold text-rose-400">Kubernetes API Unavailable</div>
                <div className="max-w-md text-xs text-rose-300 font-mono bg-rose-950/30 p-3 rounded-lg border border-rose-900/50">
                  {logData.unavailableReason || 'Kubernetes API server could not be reached.'}
                </div>
              </>
            ) : logData?.statusCategory === 'TIMEOUT' ? (
              <>
                <div className="text-sm font-semibold text-amber-400">Log Retrieval Timed Out</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  Request to fetch pod logs timed out. Please retry.
                </div>
              </>
            ) : logData?.statusCategory === 'EMPTY_LOGS' || logData?.statusCategory === 'NO_LOGS' ? (
              <>
                <div className="text-sm font-semibold text-zinc-300">No Logs Emitted</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  {searchTerm ? `No log lines matched "${searchTerm}"` : 'The container is running, but standard output and error streams are currently empty.'}
                </div>
              </>
            ) : logData?.unavailableReason ? (
              <>
                <div className="text-sm font-semibold text-zinc-300">Log Notice</div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  {logData.unavailableReason}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-semibold text-zinc-300">
                  {searchTerm ? 'No Matching Logs' : 'No Logs Available'}
                </div>
                <div className="max-w-md text-xs text-zinc-400 font-mono bg-zinc-900/90 p-3 rounded-lg border border-zinc-800">
                  {searchTerm ? `No log lines matched "${searchTerm}"` : 'No log output is currently available for this container.'}
                </div>
              </>
            )}

            {!logData?.statusCategory && selectedContainerObj?.waitingReason && (
              <div className="p-3 bg-zinc-900/60 border border-zinc-800 rounded-lg text-left text-xs max-w-md space-y-1">
                <div className="text-amber-400 font-bold">
                  Diagnostic: {selectedContainerObj.waitingReason}
                </div>
                {selectedContainerObj.waitingMessage && (
                  <div className="text-zinc-400">{selectedContainerObj.waitingMessage}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Render Log Lines */}
        {filteredLines.length > 0 && (
          <div className="space-y-0.5">
            {filteredLines.map((line, idx) => {
              const isError =
                line.message.includes('ERROR') ||
                line.message.includes('FATAL') ||
                line.message.includes('Exception') ||
                line.message.includes('panic:');
              const isWarn = line.message.includes('WARN') || line.message.includes('Warning');

              return (
                <div
                  key={idx}
                  className={`flex items-start gap-3 py-0.5 px-1 rounded hover:bg-zinc-900/80 transition-colors ${
                    isError
                      ? 'text-rose-300 bg-rose-950/20'
                      : isWarn
                      ? 'text-amber-300 bg-amber-950/10'
                      : 'text-zinc-300'
                  }`}
                >
                  <span className="text-zinc-600 select-none text-[10px] w-8 shrink-0 text-right">
                    {idx + 1}
                  </span>

                  {showTimestamps && line.timestamp && (
                    <span className="text-zinc-500 shrink-0 text-[11px] whitespace-nowrap">
                      {line.timestamp}
                    </span>
                  )}

                  <span className="break-all whitespace-pre-wrap flex-1 text-[11.5px] leading-relaxed">
                    {line.message}
                  </span>
                </div>
              );
            })}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>

      {/* Terminal Footer Status */}
      <div className="bg-zinc-900/80 border-t border-zinc-800 px-4 py-1.5 flex items-center justify-between text-[11px] text-zinc-500">
        <div className="flex items-center gap-3">
          <span>
            Namespace: <strong className="text-zinc-300">{namespace || 'Unavailable'}</strong>
          </span>
          <span>•</span>
          <span>
            Container: <strong className="text-zinc-300">{selectedContainer || 'default'}</strong>
          </span>
          {isPrevious && (
            <span className="text-amber-400 font-semibold">• Viewing Terminated Instance</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span>SkyOps Safe Redaction Active</span>
        </div>
      </div>
    </div>
  );
};
