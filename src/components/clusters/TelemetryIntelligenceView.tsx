import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownUp,
  BarChart2,
  CheckCircle2,
  Clock,
  Copy,
  Check,
  Cpu,
  Database,
  ExternalLink,
  Layers,
  Maximize2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Zap
} from 'lucide-react';
import { api } from '../../api/client';
import {
  MetricHistoryPoint,
  SpecChangePoint,
  TelemetryAnomaly,
  TelemetryQueryOptions,
  TelemetryResponse
} from '../../types/index';
import { Button } from '../common/UI';
import { MetricsServerEnablementModal } from './MetricsServerEnablementModal';

interface TelemetryIntelligenceViewProps {
  clusterId: string;
  clusterName: string;
}

export const TelemetryIntelligenceView: React.FC<TelemetryIntelligenceViewProps> = ({
  clusterId,
  clusterName
}) => {
  const [timeRange, setTimeRange] = useState<'15m' | '1h' | '6h' | '24h' | '7d'>('1h');
  const [telemetry, setTelemetry] = useState<TelemetryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [activeHoverPoint, setActiveHoverPoint] = useState<MetricHistoryPoint | null>(null);
  const [showAllObservations, setShowAllObservations] = useState(false);
  const [activeTab, setActiveTab] = useState<'trends' | 'raw' | 'specs'>('trends');
  const [isEnableModalOpen, setIsEnableModalOpen] = useState(false);

  const METRICS_SERVER_INSTALL_CMD =
    'kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml';

  const fetchTelemetry = async (bg = false) => {
    try {
      if (!bg) setLoading(true);
      else setRefreshing(true);
      setError(null);

      const res = await api.getTelemetryHistory(clusterId, {
        range: timeRange,
        resolution: 'auto',
        limit: 50,
        includeRaw: true
      });

      setTelemetry(res);
    } catch (err: any) {
      console.error('Failed to load smart telemetry:', err);
      setError(err?.message || 'Failed to fetch cluster telemetry data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTelemetry(false);
    const interval = setInterval(() => fetchTelemetry(true), 15000);
    return () => clearInterval(interval);
  }, [clusterId, timeRange]);

  const copyInstallCommand = () => {
    navigator.clipboard.writeText(METRICS_SERVER_INSTALL_CMD);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  const points = useMemo(() => telemetry?.points || [], [telemetry]);
  const rawObservations = useMemo(() => telemetry?.rawObservations || [], [telemetry]);
  const specHistory = useMemo(() => telemetry?.specHistory || [], [telemetry]);
  const anomalies = useMemo(() => telemetry?.anomalies || [], [telemetry]);

  const displayedObservations = showAllObservations ? rawObservations : rawObservations.slice(0, 15);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    if (timeRange === '7d' || timeRange === '24h') {
      return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const formatElapsed = (ts: number) => {
    const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (sec < 10) return 'Just now';
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    return `${Math.floor(min / 60)}h ago`;
  };

  // Helper for rendering SVG Trend Charts
  const renderTrendChart = (
    title: string,
    metricType: 'cpu' | 'memory',
    primaryColor: string,
    reqPercent: number | undefined,
    limPercent: number | undefined,
    pointsData: MetricHistoryPoint[]
  ) => {
    const chartWidth = 700;
    const chartHeight = 180;
    const padding = { top: 20, right: 30, bottom: 25, left: 45 };

    const innerW = chartWidth - padding.left - padding.right;
    const innerH = chartHeight - padding.top - padding.bottom;

    const hasUsage = pointsData.some(
      (p) => (metricType === 'cpu' ? p.cpuUsagePercent : p.memoryUsagePercent) !== undefined
    );

    // Y scale: max of 100% or highest limit/request
    const maxY = Math.max(100, (reqPercent || 0) * 1.15, (limPercent || 0) * 1.15);

    const getY = (val: number) => {
      const clamped = Math.max(0, Math.min(val, maxY));
      return padding.top + innerH - (clamped / maxY) * innerH;
    };

    const getX = (index: number, total: number) => {
      if (total <= 1) return padding.left + innerW / 2;
      return padding.left + (index / (total - 1)) * innerW;
    };

    // Calculate path for live usage
    let linePath = '';
    let areaPath = '';

    const validPoints = pointsData.filter((p) => {
      const val = metricType === 'cpu' ? p.cpuUsagePercent : p.memoryUsagePercent;
      return val !== undefined;
    });

    if (validPoints.length > 0) {
      validPoints.forEach((pt, i) => {
        const val = metricType === 'cpu' ? pt.cpuUsagePercent! : pt.memoryUsagePercent!;
        const x = getX(i, validPoints.length);
        const y = getY(val);
        if (i === 0) {
          linePath += `M ${x} ${y}`;
          areaPath += `M ${x} ${padding.top + innerH} L ${x} ${y}`;
        } else {
          linePath += ` L ${x} ${y}`;
          areaPath += ` L ${x} ${y}`;
        }
      });
      const lastX = getX(validPoints.length - 1, validPoints.length);
      areaPath += ` L ${lastX} ${padding.top + innerH} Z`;
    }

    const reqY = reqPercent !== undefined ? getY(reqPercent) : 0;
    const limY = limPercent !== undefined ? getY(limPercent) : 0;

    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {metricType === 'cpu' ? (
              <Cpu className="w-5 h-5 text-sky-400" />
            ) : (
              <Database className="w-5 h-5 text-violet-400" />
            )}
            <h4 className="font-bold text-sm text-zinc-100 font-mono">{title}</h4>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2.5 h-0.5 bg-sky-400 rounded-full inline-block" />
              Request: <strong className="text-sky-300 font-bold">
                {reqPercent !== undefined ? `${reqPercent}%` : 'Not configured'}
              </strong>{' '}
              <span className="text-[10px] text-zinc-500">(Spec)</span>
            </span>
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="w-2.5 h-0.5 bg-amber-400 rounded-full inline-block" />
              Limit: <strong className="text-amber-300 font-bold">
                {limPercent !== undefined ? `${limPercent}%` : 'Not configured'}
              </strong>{' '}
              <span className="text-[10px] text-zinc-500">(Spec)</span>
            </span>
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span
                className={`w-2.5 h-2.5 rounded-full inline-block ${
                  hasUsage ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
              />
              Usage: <strong className={hasUsage ? 'text-emerald-400' : 'text-zinc-500'}>
                {hasUsage
                  ? `${
                      metricType === 'cpu'
                        ? telemetry?.summary.avgCpuUsagePercent ?? 'Live'
                        : telemetry?.summary.avgMemoryUsagePercent ?? 'Live'
                    }% (Avg)`
                  : 'Unavailable'}
              </strong>
            </span>
          </div>
        </div>

        {/* SVG Chart */}
        <div className="relative w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full h-44 select-none"
          >
            {/* Grid & Reference lines */}
            <line
              x1={padding.left}
              y1={padding.top}
              x2={chartWidth - padding.right}
              y2={padding.top}
              stroke="#27272a"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 8}
              y={padding.top + 4}
              fill="#71717a"
              fontSize="10"
              textAnchor="end"
              fontFamily="monospace"
            >
              {Math.round(maxY)}%
            </text>

            <line
              x1={padding.left}
              y1={padding.top + innerH / 2}
              x2={chartWidth - padding.right}
              y2={padding.top + innerH / 2}
              stroke="#27272a"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 8}
              y={padding.top + innerH / 2 + 4}
              fill="#71717a"
              fontSize="10"
              textAnchor="end"
              fontFamily="monospace"
            >
              {Math.round(maxY / 2)}%
            </text>

            <line
              x1={padding.left}
              y1={padding.top + innerH}
              x2={chartWidth - padding.right}
              y2={padding.top + innerH}
              stroke="#3f3f46"
            />
            <text
              x={padding.left - 8}
              y={padding.top + innerH + 4}
              fill="#71717a"
              fontSize="10"
              textAnchor="end"
              fontFamily="monospace"
            >
              0%
            </text>

            {/* Spec Request Baseline (only if configured) */}
            {reqPercent !== undefined && (
              <>
                <line
                  x1={padding.left}
                  y1={reqY}
                  x2={chartWidth - padding.right}
                  y2={reqY}
                  stroke="#38bdf8"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.8"
                />
                <text
                  x={chartWidth - padding.right}
                  y={reqY - 4}
                  fill="#38bdf8"
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  Req {reqPercent}% (Spec)
                </text>
              </>
            )}

            {/* Spec Limit Baseline (only if configured) */}
            {limPercent !== undefined && (
              <>
                <line
                  x1={padding.left}
                  y1={limY}
                  x2={chartWidth - padding.right}
                  y2={limY}
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  opacity="0.8"
                />
                <text
                  x={chartWidth - padding.right}
                  y={limY - 4}
                  fill="#f59e0b"
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="monospace"
                  fontWeight="bold"
                >
                  Limit {limPercent}% (Spec)
                </text>
              </>
            )}

            {/* Area Fill for Live Usage */}
            {hasUsage && areaPath && (
              <path
                d={areaPath}
                fill={metricType === 'cpu' ? 'rgba(52, 211, 153, 0.12)' : 'rgba(167, 139, 250, 0.12)'}
              />
            )}

            {/* Usage Line */}
            {hasUsage && linePath ? (
              <path
                d={linePath}
                fill="none"
                stroke={metricType === 'cpu' ? '#34d399' : '#a78bfa'}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              // Empty / Unavailable state indication line
              <g>
                <line
                  x1={padding.left}
                  y1={padding.top + innerH * 0.75}
                  x2={chartWidth - padding.right}
                  y2={padding.top + innerH * 0.75}
                  stroke="#52525b"
                  strokeWidth="1"
                  strokeDasharray="4 6"
                />
                <text
                  x={padding.left + innerW / 2}
                  y={padding.top + innerH * 0.75 - 8}
                  fill="#a1a1aa"
                  fontSize="11"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  Live {metricType.toUpperCase()} Usage Unavailable (Metrics Server not installed)
                </text>
              </g>
            )}

            {/* Active Data Points */}
            {hasUsage &&
              validPoints.map((pt, idx) => {
                const val = metricType === 'cpu' ? pt.cpuUsagePercent! : pt.memoryUsagePercent!;
                const cx = getX(idx, validPoints.length);
                const cy = getY(val);
                const isHovered = activeHoverPoint?.timestamp === pt.timestamp;

                return (
                  <circle
                    key={pt.timestamp}
                    cx={cx}
                    cy={cy}
                    r={isHovered ? 5.5 : 2.5}
                    fill={metricType === 'cpu' ? '#34d399' : '#a78bfa'}
                    stroke="#18181b"
                    strokeWidth="1.5"
                    className="cursor-pointer transition-all hover:r-6"
                    onMouseEnter={() => setActiveHoverPoint(pt)}
                    onMouseLeave={() => setActiveHoverPoint(null)}
                  />
                );
              })}
          </svg>

          {/* Interactive Tooltip Card */}
          {activeHoverPoint && (
            <div className="absolute top-2 right-4 bg-zinc-950/95 border border-zinc-700 rounded-lg p-2.5 shadow-xl text-xs font-mono z-20 space-y-1 backdrop-blur pointer-events-none">
              <div className="text-zinc-400 border-b border-zinc-800 pb-1 flex items-center justify-between gap-4">
                <span>{formatTime(activeHoverPoint.timestamp)}</span>
                <span className="text-[10px] text-zinc-500">
                  {formatElapsed(activeHoverPoint.timestamp)}
                </span>
              </div>
              <div className="space-y-0.5 pt-0.5">
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">
                    {metricType.toUpperCase()} Usage (Live):
                  </span>
                  <span className="font-bold text-emerald-400">
                    {metricType === 'cpu'
                      ? activeHoverPoint.cpuUsagePercent !== undefined
                        ? `${activeHoverPoint.cpuUsagePercent}%`
                        : 'Unavailable'
                      : activeHoverPoint.memoryUsagePercent !== undefined
                      ? `${activeHoverPoint.memoryUsagePercent}%`
                      : 'Unavailable'}
                  </span>
                </div>
                {activeHoverPoint.sampleCount && activeHoverPoint.sampleCount > 1 && (
                  <div className="text-[10px] text-zinc-500 flex justify-between">
                    <span>Rollup Range:</span>
                    <span>
                      Min:{' '}
                      {metricType === 'cpu'
                        ? activeHoverPoint.cpuUsageMinMillicores ?? '—'
                        : activeHoverPoint.memoryUsageMinBytes ?? '—'}{' '}
                      | Max:{' '}
                      {metricType === 'cpu'
                        ? activeHoverPoint.cpuUsageMaxMillicores ?? '—'
                        : activeHoverPoint.memoryUsageMaxBytes ?? '—'}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-4 text-sky-300">
                  <span>Req (Spec):</span>
                  <span>
                    {metricType === 'cpu'
                      ? (activeHoverPoint.cpuRequestedPercent !== undefined
                          ? `${activeHoverPoint.cpuRequestedPercent}%`
                          : (reqPercent !== undefined ? `${reqPercent}%` : 'Not configured'))
                      : (activeHoverPoint.memoryRequestedPercent !== undefined
                          ? `${activeHoverPoint.memoryRequestedPercent}%`
                          : (reqPercent !== undefined ? `${reqPercent}%` : 'Not configured'))}
                  </span>
                </div>
                <div className="flex justify-between gap-4 text-amber-300">
                  <span>Limit (Spec):</span>
                  <span>
                    {metricType === 'cpu'
                      ? (activeHoverPoint.cpuLimitPercent !== undefined
                          ? `${activeHoverPoint.cpuLimitPercent}%`
                          : (limPercent !== undefined ? `${limPercent}%` : 'Not configured'))
                      : (activeHoverPoint.memoryLimitPercent !== undefined
                          ? `${activeHoverPoint.memoryLimitPercent}%`
                          : (limPercent !== undefined ? `${limPercent}%` : 'Not configured'))}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 pt-0.5 border-t border-zinc-800">
                  Source: {activeHoverPoint.source || (activeHoverPoint.isUsageAvailable ? 'metrics.k8s.io' : 'spec-derived')}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* HEADER CONTROLS & RANGE SELECTOR */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-950/60 border border-sky-800/80 text-sky-400">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-zinc-100 font-mono">
                Smart Telemetry & Historical Intelligence
              </h3>
              {telemetry?.runtimeStatus === 'LIVE' ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-emerald-950/70 text-emerald-300 border border-emerald-800/80 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Runtime Metrics (metrics.k8s.io)
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-zinc-800 text-amber-300 border border-amber-900/60 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  Spec Only (Runtime Usage Unavailable)
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-0.5">
              15-second collection sweep with tiered retention (raw, 5m rollups, 1h rollups) and zero synthetic fabrication.
            </p>
          </div>
        </div>

        {/* Time Range Selector & Actions */}
        <div className="flex items-center gap-2">
          <div className="flex bg-zinc-950 p-1 rounded-lg border border-zinc-800">
            {(['15m', '1h', '6h', '24h', '7d'] as const).map((rng) => (
              <button
                key={rng}
                onClick={() => setTimeRange(rng)}
                className={`px-3 py-1 text-xs font-mono rounded font-medium transition-all ${
                  timeRange === rng
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                }`}
              >
                {rng}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={() => fetchTelemetry(false)}
            disabled={refreshing}
            className="flex items-center gap-1.5 font-mono text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-sky-400' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* METRICS SERVER GUIDANCE CALLOUT (When Runtime Metrics Are Unavailable) */}
      {telemetry && !telemetry.isUsageAvailable && (
        <div className="bg-amber-950/30 border border-amber-800/60 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-900/50 border border-amber-700/60 text-amber-300 shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-amber-200 font-mono">
                  Runtime Metrics Unavailable (Metrics Server not reporting)
                </h4>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-amber-900/70 text-amber-300 border border-amber-700/80">
                  Zero-Fabrication Policy Enforced
                </span>
              </div>
              <p className="text-xs text-amber-300/90 leading-relaxed">
                SkyOps is actively collecting your cluster’s CPU & Memory <strong>Requests</strong> and <strong>Limits</strong> directly
                from Kubernetes resource specs. However, real-time consumption metrics require the Kubernetes
                <strong> Metrics Server</strong> (<code className="text-amber-200 bg-amber-950/60 px-1 py-0.5 rounded font-mono">metrics.k8s.io</code>).
                SkyOps strictly refuses to fabricate fake usage numbers so your engineering team always has accurate data.
              </p>

              <div className="bg-zinc-950/90 border border-zinc-800 rounded-lg p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-2">
                <code className="text-xs font-mono text-emerald-400 select-all overflow-x-auto">
                  {METRICS_SERVER_INSTALL_CMD}
                </code>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setIsEnableModalOpen(true)}
                    className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-mono rounded flex items-center gap-1.5 transition-colors border border-amber-500/40 cursor-pointer"
                  >
                    <Activity className="w-3.5 h-3.5 text-amber-400" />
                    <span>Guided Setup & Pre-Flight &rarr;</span>
                  </button>
                  <button
                    onClick={copyInstallCommand}
                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono rounded flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    {copiedCmd ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ANOMALY ALERTS (If detected) */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((anom, i) => (
            <div
              key={i}
              className={`border rounded-xl p-3.5 flex items-start gap-3 text-xs font-mono ${
                anom.severity === 'CRITICAL'
                  ? 'bg-rose-950/40 border-rose-800 text-rose-200'
                  : 'bg-amber-950/40 border-amber-800 text-amber-200'
              }`}
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-0.5">
                <div className="flex items-center justify-between">
                  <strong className="font-bold">{anom.type.replace(/_/g, ' ')}</strong>
                  <span className="text-[10px] text-zinc-400 opacity-80">
                    {formatElapsed(anom.detectedAt)}
                  </span>
                </div>
                <div>{anom.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SUB-NAVIGATION PILLS */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('trends')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'trends'
                ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5 text-sky-400" />
            Visual Trends & Rollups
          </button>
          <button
            onClick={() => setActiveTab('raw')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'raw'
                ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-emerald-400" />
            Recent Raw Observations ({rawObservations.length})
          </button>
          <button
            onClick={() => setActiveTab('specs')}
            className={`px-3 py-1.5 text-xs font-mono rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'specs'
                ? 'bg-zinc-800 text-zinc-100 font-bold border border-zinc-700'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            Spec Change History ({specHistory.length})
          </button>
        </div>

        <div className="text-xs font-mono text-zinc-500">
          Resolution: <strong className="text-zinc-300">{telemetry?.resolution || 'auto'}</strong> | Points: <strong className="text-zinc-300">{points.length}</strong>
        </div>
      </div>

      {/* TAB 1: VISUAL TRENDS & ROLLUPS */}
      {activeTab === 'trends' && (
        <div className="space-y-5">
          {/* Key Stat Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">CPU Requests</span>
              <div className={`text-lg font-bold font-mono ${telemetry?.summary.currentCpuRequestPercent !== undefined ? 'text-sky-400' : 'text-zinc-500'}`}>
                {telemetry?.summary.currentCpuRequestPercent !== undefined
                  ? `${telemetry.summary.currentCpuRequestPercent}%`
                  : 'Not configured'}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Source: K8s Spec</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">CPU Limits</span>
              <div className={`text-lg font-bold font-mono ${telemetry?.summary.currentCpuLimitPercent !== undefined ? 'text-amber-400' : 'text-zinc-500'}`}>
                {telemetry?.summary.currentCpuLimitPercent !== undefined
                  ? `${telemetry.summary.currentCpuLimitPercent}%`
                  : 'Not configured'}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Source: K8s Spec</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Memory Requests</span>
              <div className={`text-lg font-bold font-mono ${telemetry?.summary.currentMemoryRequestPercent !== undefined ? 'text-violet-400' : 'text-zinc-500'}`}>
                {telemetry?.summary.currentMemoryRequestPercent !== undefined
                  ? `${telemetry.summary.currentMemoryRequestPercent}%`
                  : 'Not configured'}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Source: K8s Spec</span>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3.5 space-y-1">
              <span className="text-[11px] font-mono text-zinc-400 uppercase">Memory Limits</span>
              <div className={`text-lg font-bold font-mono ${telemetry?.summary.currentMemoryLimitPercent !== undefined ? 'text-emerald-400' : 'text-zinc-500'}`}>
                {telemetry?.summary.currentMemoryLimitPercent !== undefined
                  ? `${telemetry.summary.currentMemoryLimitPercent}%`
                  : 'Not configured'}
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Source: K8s Spec</span>
            </div>
          </div>

          {/* SVG Trends */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {renderTrendChart(
              'Cluster CPU Allocation & Usage Trends (Cluster Aggregate)',
              'cpu',
              '#38bdf8',
              telemetry?.summary.currentCpuRequestPercent,
              telemetry?.summary.currentCpuLimitPercent,
              points
            )}
            {renderTrendChart(
              'Cluster Memory Allocation & Usage Trends (Cluster Aggregate)',
              'memory',
              '#a78bfa',
              telemetry?.summary.currentMemoryRequestPercent,
              telemetry?.summary.currentMemoryLimitPercent,
              points
            )}
          </div>
        </div>
      )}

      {/* TAB 2: RECENT RAW OBSERVATIONS TABLE */}
      {activeTab === 'raw' && (
        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="p-3 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-400">
                Showing <strong className="text-zinc-200">{displayedObservations.length}</strong> of{' '}
                <strong className="text-zinc-200">{rawObservations.length}</strong> recent high-resolution observations (15s intervals)
              </span>
              <span className="text-zinc-500">
                Incident-aware retention pins active incident windows
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">CPU Req % (Spec)</th>
                    <th className="px-4 py-3">CPU Limit % (Spec)</th>
                    <th className="px-4 py-3">CPU Usage % (Live)</th>
                    <th className="px-4 py-3">Memory Req % (Spec)</th>
                    <th className="px-4 py-3">Memory Limit % (Spec)</th>
                    <th className="px-4 py-3">Memory Usage % (Live)</th>
                    <th className="px-4 py-3">Data Source</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {displayedObservations.map((pt) => {
                    const cpuReqStr = pt.cpuRequestedPercent !== undefined ? `${pt.cpuRequestedPercent}%` : 'Not configured';
                    const cpuLimStr = pt.cpuLimitPercent !== undefined ? `${pt.cpuLimitPercent}%` : 'Not configured';
                    const cpuUse = pt.cpuUsagePercent;
                    const memReqStr = pt.memoryRequestedPercent !== undefined ? `${pt.memoryRequestedPercent}%` : 'Not configured';
                    const memLimStr = pt.memoryLimitPercent !== undefined ? `${pt.memoryLimitPercent}%` : 'Not configured';
                    const memUse = pt.memoryUsagePercent;
                    const src = pt.source || (pt.isUsageAvailable ? 'metrics.k8s.io' : 'spec-derived');

                    return (
                      <tr key={pt.timestamp} className="hover:bg-zinc-850/50 transition-colors">
                        <td className="px-4 py-3 text-zinc-300">
                          {formatTime(pt.timestamp)}{' '}
                          <span className="text-[10px] text-zinc-500">({formatElapsed(pt.timestamp)})</span>
                        </td>
                        <td className={`px-4 py-3 font-bold ${pt.cpuRequestedPercent !== undefined ? 'text-sky-400' : 'text-zinc-500'}`}>{cpuReqStr}</td>
                        <td className={`px-4 py-3 font-bold ${pt.cpuLimitPercent !== undefined ? 'text-amber-400' : 'text-zinc-500'}`}>{cpuLimStr}</td>
                        <td className="px-4 py-3 font-bold">
                          {cpuUse !== undefined ? (
                            <span className="text-emerald-400">{cpuUse}%</span>
                          ) : (
                            <span className="text-zinc-500">Unavailable</span>
                          )}
                        </td>
                        <td className={`px-4 py-3 font-bold ${pt.memoryRequestedPercent !== undefined ? 'text-violet-400' : 'text-zinc-500'}`}>{memReqStr}</td>
                        <td className={`px-4 py-3 font-bold ${pt.memoryLimitPercent !== undefined ? 'text-emerald-400' : 'text-zinc-500'}`}>{memLimStr}</td>
                        <td className="px-4 py-3 font-bold">
                          {memUse !== undefined ? (
                            <span className="text-emerald-400">{memUse}%</span>
                          ) : (
                            <span className="text-zinc-500">Unavailable</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] border ${
                              pt.isUsageAvailable
                                ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            }`}
                          >
                            {src}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {pt.pinned ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-rose-950 text-rose-300 border border-rose-800 flex items-center gap-1 w-max">
                              <ShieldAlert className="w-3 h-3" />
                              Incident Window
                            </span>
                          ) : (
                            <span className="text-zinc-500 text-[10px]">Normal</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {rawObservations.length > 15 && (
              <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-center">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowAllObservations(!showAllObservations)}
                  className="text-xs font-mono"
                >
                  {showAllObservations
                    ? 'Show Latest 15 Only'
                    : `Show All ${rawObservations.length} Raw Observations`}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: SPECIFICATION CHANGES HISTORY */}
      {activeTab === 'specs' && (
        <div className="space-y-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-2">
            <h4 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              Resource Specification Deduplication History
            </h4>
            <p className="text-xs text-zinc-400">
              SkyOps captures genuine specification changes (when CPU/Memory requests, limits, or node/pod counts change)
              rather than writing thousands of redundant identical rows every 15 seconds.
            </p>
          </div>

          {specHistory.length === 0 ? (
            <div className="bg-zinc-900/60 border border-dashed border-zinc-800 rounded-xl p-8 text-center text-zinc-500 text-xs font-mono">
              No configuration spec mutations detected in this window. Resource specifications are stable.
            </div>
          ) : (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Nodes / Pods</th>
                    <th className="px-4 py-3">CPU Request (m)</th>
                    <th className="px-4 py-3">CPU Limit (m)</th>
                    <th className="px-4 py-3">Memory Request</th>
                    <th className="px-4 py-3">Memory Limit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {specHistory
                    .slice()
                    .reverse()
                    .map((s, idx) => (
                      <tr key={idx} className="hover:bg-zinc-850/50 transition-colors">
                        <td className="px-4 py-3 text-zinc-300">
                          {formatTime(s.timestamp)} ({formatElapsed(s.timestamp)})
                        </td>
                        <td className="px-4 py-3 text-zinc-200">
                          {s.nodeCount} nodes / {s.podCount} pods
                        </td>
                        <td className="px-4 py-3 text-sky-400">{s.cpuRequestMillicores}m</td>
                        <td className="px-4 py-3 text-amber-400">
                          {s.cpuLimitMillicores ? `${s.cpuLimitMillicores}m` : 'Unbounded'}
                        </td>
                        <td className="px-4 py-3 text-violet-400">
                          {Math.round(s.memoryRequestBytes / (1024 * 1024))} MiB
                        </td>
                        <td className="px-4 py-3 text-emerald-400">
                          {s.memoryLimitBytes
                            ? `${Math.round(s.memoryLimitBytes / (1024 * 1024))} MiB`
                            : 'Unbounded'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Explicit User-Approved Metrics Server Enablement Modal */}
      <MetricsServerEnablementModal
        isOpen={isEnableModalOpen}
        onClose={() => setIsEnableModalOpen(false)}
        clusterId={clusterId}
        clusterName={clusterName}
        onVerified={() => {
          fetchTelemetry(true);
        }}
      />
    </div>
  );
};
