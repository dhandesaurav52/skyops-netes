import {
  AlertOctagon,
  Boxes,
  Calendar,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  ExternalLink,
  Eye,
  FileCode,
  Globe,
  GripHorizontal,
  HardDrive,
  Layers,
  Map,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shield,
  X,
  Zap
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KubernetesResource } from '../../../types/index';
import {
  TopologyEdge,
  TopologyGraphData,
  TopologyNode,
  TopologyRelationshipType
} from './types';

interface TopologyCanvasProps {
  graphData: TopologyGraphData;
  selectedNodeId: string | null;
  onSelectNode: (node: TopologyNode | null) => void;
  onToggleExpand: (nodeId: string) => void;
  showMiniMap: boolean;
  onToggleMiniMap: () => void;
  onOpenDetailsModal?: (resource: KubernetesResource) => void;
}

export const TopologyCanvas: React.FC<TopologyCanvasProps> = ({
  graphData,
  selectedNodeId,
  onSelectNode,
  onToggleExpand,
  showMiniMap,
  onToggleMiniMap,
  onOpenDetailsModal
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Pan & Zoom state
  const [transform, setTransform] = useState<{ x: number; y: number; scale: number }>({
    x: 40,
    y: 20,
    scale: 0.95
  });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Movable Floating Overlays: Relationship Types Legend & Cluster Mini-Map
  const [legendPos, setLegendPos] = useState<{ x: number; y: number } | null>(null);
  const [miniMapPos, setMiniMapPos] = useState<{ x: number; y: number } | null>(null);
  const [isLegendCollapsed, setIsLegendCollapsed] = useState(false);
  const [isLegendVisible, setIsLegendVisible] = useState(true);
  const [isMiniMapCollapsed, setIsMiniMapCollapsed] = useState(false);

  const legendRef = useRef<HTMLDivElement>(null);
  const miniMapRef = useRef<HTMLDivElement>(null);

  const activeOverlayDragRef = useRef<{
    target: 'legend' | 'minimap';
    startMouseX: number;
    startMouseY: number;
    initialElemX: number;
    initialElemY: number;
  } | null>(null);
  const [isDraggingOverlay, setIsDraggingOverlay] = useState<'legend' | 'minimap' | null>(null);

  // Drag handlers for movable overlays
  const handleStartDragOverlay = (
    e: React.MouseEvent | React.TouchEvent,
    target: 'legend' | 'minimap'
  ) => {
    e.stopPropagation();
    // Do not initiate drag if user clicked an inner button
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const containerElem = containerRef.current;
    const targetElem = target === 'legend' ? legendRef.current : miniMapRef.current;
    if (!containerElem || !targetElem) return;

    const containerRect = containerElem.getBoundingClientRect();
    const targetRect = targetElem.getBoundingClientRect();

    const currentX = targetRect.left - containerRect.left;
    const currentY = targetRect.top - containerRect.top;

    activeOverlayDragRef.current = {
      target,
      startMouseX: clientX,
      startMouseY: clientY,
      initialElemX: currentX,
      initialElemY: currentY
    };
    setIsDraggingOverlay(target);
  };

  // Dragging event listeners on window to handle fast movements and release safely
  useEffect(() => {
    if (!isDraggingOverlay) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const active = activeOverlayDragRef.current;
      if (!active || !containerRef.current) return;

      const clientX = 'touches' in e ? (e as TouchEvent).touches[0].clientX : (e as MouseEvent).clientX;
      const clientY = 'touches' in e ? (e as TouchEvent).touches[0].clientY : (e as MouseEvent).clientY;

      const deltaX = clientX - active.startMouseX;
      const deltaY = clientY - active.startMouseY;

      const containerRect = containerRef.current.getBoundingClientRect();
      const targetElem = active.target === 'legend' ? legendRef.current : miniMapRef.current;
      const elemWidth = targetElem?.offsetWidth || (active.target === 'legend' ? 180 : 190);
      const elemHeight = targetElem?.offsetHeight || (active.target === 'legend' ? 140 : 130);

      // Clamp within container boundaries so overlays are never pushed off-screen or hidden
      const newX = Math.max(10, Math.min(active.initialElemX + deltaX, containerRect.width - elemWidth - 10));
      const newY = Math.max(10, Math.min(active.initialElemY + deltaY, containerRect.height - elemHeight - 10));

      if (active.target === 'legend') {
        setLegendPos({ x: newX, y: newY });
      } else {
        setMiniMapPos({ x: newX, y: newY });
      }
    };

    const handleMouseUp = () => {
      activeOverlayDragRef.current = null;
      setIsDraggingOverlay(null);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: false });
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove, { passive: false });
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDraggingOverlay]);

  // Window resize bounds recalculation to prevent floating overlays getting pushed out of view
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();

      setLegendPos((prev) => {
        if (!prev) return null;
        const elemWidth = legendRef.current?.offsetWidth || 180;
        const elemHeight = legendRef.current?.offsetHeight || 140;
        return {
          x: Math.max(10, Math.min(prev.x, containerRect.width - elemWidth - 10)),
          y: Math.max(10, Math.min(prev.y, containerRect.height - elemHeight - 10))
        };
      });

      setMiniMapPos((prev) => {
        if (!prev) return null;
        const elemWidth = miniMapRef.current?.offsetWidth || 190;
        const elemHeight = miniMapRef.current?.offsetHeight || 130;
        return {
          x: Math.max(10, Math.min(prev.x, containerRect.width - elemWidth - 10)),
          y: Math.max(10, Math.min(prev.y, containerRect.height - elemHeight - 10))
        };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mini-map click to pan canvas viewport
  const handleMiniMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!containerRef.current || graphData.bounds.width === 0 || graphData.bounds.height === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatioX = (e.clientX - rect.left) / rect.width;
    const clickRatioY = (e.clientY - rect.top) / rect.height;

    const targetCanvasX = clickRatioX * graphData.bounds.width;
    const targetCanvasY = clickRatioY * graphData.bounds.height;

    const containerRect = containerRef.current.getBoundingClientRect();
    setTransform((prev) => ({
      ...prev,
      x: containerRect.width / 2 - targetCanvasX * prev.scale,
      y: containerRect.height / 2 - targetCanvasY * prev.scale
    }));
  };

  // Mini-map dynamic viewport box
  const miniMapViewport = useMemo(() => {
    if (!containerRef.current || graphData.bounds.width === 0 || graphData.bounds.height === 0) {
      return { left: '10%', top: '10%', width: '40%', height: '40%' };
    }
    const containerW = containerRef.current.clientWidth || 800;
    const containerH = containerRef.current.clientHeight || 600;

    const visibleW = containerW / transform.scale;
    const visibleH = containerH / transform.scale;
    const visibleX = -transform.x / transform.scale;
    const visibleY = -transform.y / transform.scale;

    const leftPct = Math.max(0, Math.min(100, (visibleX / graphData.bounds.width) * 100));
    const topPct = Math.max(0, Math.min(100, (visibleY / graphData.bounds.height) * 100));
    const widthPct = Math.max(8, Math.min(100 - leftPct, (visibleW / graphData.bounds.width) * 100));
    const heightPct = Math.max(8, Math.min(100 - topPct, (visibleH / graphData.bounds.height) * 100));

    return {
      left: `${leftPct}%`,
      top: `${topPct}%`,
      width: `${widthPct}%`,
      height: `${heightPct}%`
    };
  }, [transform, graphData.bounds]);

  // Focus Mode set of active node IDs
  const focusedNodeIds = useMemo(() => {
    if (!selectedNodeId) return null;
    const ids = new Set<string>([selectedNodeId]);

    // Add immediate neighbors (parents and children)
    const outgoing = graphData.outgoingEdges.get(selectedNodeId) || [];
    const incoming = graphData.incomingEdges.get(selectedNodeId) || [];

    for (const e of outgoing) ids.add(e.target);
    for (const e of incoming) ids.add(e.source);

    // If selected is a domain group, add its direct children
    const directNeighbors = graphData.adjacency.get(selectedNodeId);
    if (directNeighbors) {
      for (const n of directNeighbors) ids.add(n);
    }

    return ids;
  }, [selectedNodeId, graphData]);

  // Fit to screen calculation
  const handleFitToScreen = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    const { minX, minY, width, height } = graphData.bounds;

    const scaleX = (clientWidth - 80) / width;
    const scaleY = (clientHeight - 80) / height;
    const fitScale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.35), 1.2);

    const centerX = (clientWidth - width * fitScale) / 2 - minX * fitScale;
    const centerY = (clientHeight - height * fitScale) / 2 - minY * fitScale;

    setTransform({
      x: centerX,
      y: centerY,
      scale: fitScale
    });
  }, [graphData.bounds]);

  // Initial fit on mount
  useEffect(() => {
    handleFitToScreen();
  }, [handleFitToScreen]);

  // Zoom handlers
  const handleZoom = (delta: number) => {
    setTransform((prev) => {
      const nextScale = Math.min(Math.max(prev.scale + delta, 0.3), 2.0);
      return { ...prev, scale: nextScale };
    });
  };

  const handleResetZoom = () => {
    setTransform({ x: 40, y: 20, scale: 0.95 });
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = -e.deltaY * 0.0015;
      setTransform((prev) => {
        const nextScale = Math.min(Math.max(prev.scale + zoomFactor, 0.3), 2.0);
        return { ...prev, scale: nextScale };
      });
    } else {
      // Pan with scroll
      setTransform((prev) => ({
        ...prev,
        x: prev.x - e.deltaX * 0.7,
        y: prev.y - e.deltaY * 0.7
      }));
    }
  };

  // Drag to pan
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if left click on canvas background
    if (e.button === 0) {
      const target = e.target as HTMLElement;
      if (target.id === 'topology-canvas-bg' || target.tagName === 'svg') {
        setIsDragging(true);
        setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
        onSelectNode(null); // Click background to deselect Focus mode
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setTransform((prev) => ({
        ...prev,
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      }));
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch gestures for mobile pinch-to-zoom and pan
  const touchStartRef = useRef<{ x: number; y: number; dist?: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const t = e.touches[0];
      const target = e.target as HTMLElement;
      if (target.id === 'topology-canvas-bg' || target.tagName === 'svg') {
        setIsDragging(true);
        setDragStart({ x: t.clientX - transform.x, y: t.clientY - transform.y });
        touchStartRef.current = { x: t.clientX, y: t.clientY };
      }
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      touchStartRef.current = { x: 0, y: 0, dist };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging) {
      const t = e.touches[0];
      setTransform((prev) => ({
        ...prev,
        x: t.clientX - dragStart.x,
        y: t.clientY - dragStart.y
      }));
    } else if (e.touches.length === 2 && touchStartRef.current?.dist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      const ratio = newDist / touchStartRef.current.dist;
      touchStartRef.current.dist = newDist;
      setTransform((prev) => ({
        ...prev,
        scale: Math.min(Math.max(prev.scale * ratio, 0.3), 2.0)
      }));
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartRef.current = null;
  };

  // Keyboard navigation for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      setTransform((prev) => ({ ...prev, x: prev.x + 40 }));
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      setTransform((prev) => ({ ...prev, x: prev.x - 40 }));
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      setTransform((prev) => ({ ...prev, y: prev.y + 40 }));
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      setTransform((prev) => ({ ...prev, y: prev.y - 40 }));
    } else if (e.key === '+' || e.key === '=') {
      handleZoom(0.15);
    } else if (e.key === '-' || e.key === '_') {
      handleZoom(-0.15);
    } else if (e.key === '0') {
      handleResetZoom();
    } else if (e.key === 'Escape') {
      onSelectNode(null);
    }
  };

  // Helper for Node Icon
  const getNodeIcon = (kind: string, type: string) => {
    switch (kind) {
      case 'Cluster':
        return <Server className="w-4 h-4 text-sky-400" />;
      case 'Compute':
      case 'Node':
        return <Cpu className="w-4 h-4 text-emerald-400" />;
      case 'Workloads':
      case 'Deployment':
      case 'StatefulSet':
      case 'DaemonSet':
      case 'Rollout':
        return <Layers className="w-4 h-4 text-blue-400" />;
      case 'Networking':
      case 'Service':
      case 'EndpointSlice':
        return <Network className="w-4 h-4 text-cyan-400" />;
      case 'Ingress':
      case 'Gateway':
        return <Globe className="w-4 h-4 text-indigo-400" />;
      case 'Storage':
      case 'StorageClass':
      case 'PersistentVolumeClaim':
      case 'PersistentVolume':
        return <HardDrive className="w-4 h-4 text-amber-400" />;
      case 'Configuration':
      case 'ConfigMap':
      case 'Secret':
        return <FileCode className="w-4 h-4 text-purple-400" />;
      case 'Security':
      case 'ServiceAccount':
      case 'Role':
      case 'RoleBinding':
        return <Shield className="w-4 h-4 text-rose-400" />;
      case 'Scheduling':
      case 'HorizontalPodAutoscaler':
        return <Calendar className="w-4 h-4 text-teal-400" />;
      default:
        return <Boxes className="w-4 h-4 text-zinc-400" />;
    }
  };

  // Helper for Health Dot style
  const getHealthDot = (health: string) => {
    switch (health) {
      case 'HEALTHY':
        return 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]';
      case 'WARNING':
        return 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]';
      case 'CRITICAL':
        return 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)] animate-pulse';
      default:
        return 'bg-zinc-500';
    }
  };

  // Compute Bezier SVG Path between two nodes
  const calculatePath = (edge: TopologyEdge) => {
    const sourceNode = graphData.nodeMap.get(edge.source);
    const targetNode = graphData.nodeMap.get(edge.target);
    if (!sourceNode || !targetNode) return '';

    // Calculate center-connection points
    const startX = sourceNode.x + sourceNode.width / 2;
    const startY = sourceNode.y + sourceNode.height;
    const endX = targetNode.x + targetNode.width / 2;
    const endY = targetNode.y;

    // Control points for smooth vertical-to-vertical or lateral curves
    const deltaY = Math.abs(endY - startY);
    const cy1 = startY + Math.max(deltaY * 0.45, 30);
    const cy2 = endY - Math.max(deltaY * 0.45, 30);

    return `M ${startX},${startY} C ${startX},${cy1} ${endX},${cy2} ${endX},${endY}`;
  };

  // Stroke styling based on relationship type
  const getEdgeStyle = (edge: TopologyEdge, isFocused: boolean, hasFocusSet: boolean) => {
    const opacity = hasFocusSet ? (isFocused ? 1 : 0.12) : 0.65;

    switch (edge.type) {
      case 'traffic':
        return {
          stroke: '#0284c7', // Sky-600 / cyan
          strokeDasharray: '5 4',
          strokeWidth: isFocused ? 2.5 : 1.75,
          opacity,
          markerEnd: 'url(#arrow-traffic)'
        };
      case 'uses':
        return {
          stroke: '#10b981', // Emerald-500
          strokeDasharray: '4 4',
          strokeWidth: isFocused ? 2.2 : 1.5,
          opacity
        };
      case 'depends_on':
        return {
          stroke: '#f59e0b', // Amber-500
          strokeDasharray: '4 4',
          strokeWidth: isFocused ? 2.2 : 1.5,
          opacity
        };
      case 'ownership':
      default:
        return {
          stroke: isFocused ? '#38bdf8' : '#3f3f46', // zinc-700 or bright sky if focused
          strokeDasharray: 'none',
          strokeWidth: isFocused ? 2.2 : 1.25,
          opacity
        };
    }
  };

  return (
    <div
      ref={containerRef}
      id="topology-canvas-bg"
      tabIndex={0}
      role="region"
      aria-label="Kubernetes Architecture Topology Canvas"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onKeyDown={handleKeyDown}
      className="relative w-full h-full min-h-[380px] bg-[#090a0f] overflow-hidden select-none cursor-grab active:cursor-grabbing border border-zinc-800/80 rounded-xl focus:outline-none focus:ring-1 focus:ring-sky-500/30"
      style={{
        backgroundImage: `radial-gradient(#27272a 0.75px, transparent 0.75px)`,
        backgroundSize: '24px 24px'
      }}
    >
      {/* Floating Canvas View Controls (Top-Right) */}
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1.5 bg-zinc-950/90 backdrop-blur-md border border-zinc-800 p-1 rounded-lg shadow-xl font-mono text-xs">
        <button
          onClick={() => handleZoom(-0.15)}
          title="Zoom out"
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleResetZoom}
          title="Reset zoom to 100%"
          className="px-2 py-1 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 rounded text-[11px] font-semibold transition cursor-pointer"
        >
          {Math.round(transform.scale * 100)}%
        </button>
        <button
          onClick={() => handleZoom(0.15)}
          title="Zoom in"
          className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-zinc-800 mx-0.5" />
        <button
          onClick={handleFitToScreen}
          title="Fit topology to screen"
          className="p-1.5 text-zinc-400 hover:text-sky-400 hover:bg-zinc-800/80 rounded transition cursor-pointer"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-4 bg-zinc-800 mx-0.5" />
        <button
          onClick={() => setIsLegendVisible(!isLegendVisible)}
          title={isLegendVisible ? "Hide relationship legend" : "Show relationship legend"}
          className={`p-1.5 rounded transition cursor-pointer ${
            isLegendVisible
              ? 'text-sky-400 bg-sky-500/20'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onToggleMiniMap}
          title={showMiniMap ? "Hide cluster mini map" : "Show cluster mini map"}
          className={`p-1.5 rounded transition cursor-pointer ${
            showMiniMap
              ? 'text-sky-400 bg-sky-500/20'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80'
          }`}
        >
          <Map className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main Scalable Viewport */}
      <div
        className="absolute inset-0 origin-top-left transition-transform duration-75 ease-out pointer-events-none"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          width: `${graphData.bounds.width + 400}px`,
          height: `${graphData.bounds.height + 400}px`
        }}
      >
        {/* SVG Relationship Edge Layer */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
          style={{ zIndex: 1 }}
        >
          <defs>
            <marker
              id="arrow-traffic"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" />
            </marker>
          </defs>

          {graphData.edges.map((edge) => {
            const hasFocus = focusedNodeIds !== null;
            const isEdgeFocused =
              hasFocus &&
              focusedNodeIds?.has(edge.source) &&
              focusedNodeIds?.has(edge.target);
            const style = getEdgeStyle(edge, isEdgeFocused, hasFocus);
            const pathD = calculatePath(edge);
            if (!pathD) return null;

            return (
              <g key={edge.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                  strokeDasharray={style.strokeDasharray}
                  opacity={style.opacity}
                  markerEnd={style.markerEnd}
                  className="transition-all duration-300"
                />
                {edge.label && isEdgeFocused && (
                  <text
                    className="text-[9px] fill-sky-400 font-mono"
                    dy="-4"
                  >
                    <textPath
                      href={`#${edge.id}`}
                      startOffset="50%"
                      textAnchor="middle"
                    >
                      {edge.label}
                    </textPath>
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* DOM Nodes Layer */}
        <div className="absolute inset-0 pointer-events-auto" style={{ zIndex: 2 }}>
          {graphData.nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isFocused = focusedNodeIds ? focusedNodeIds.has(node.id) : true;
            const opacityClass = isFocused ? 'opacity-100 scale-100' : 'opacity-20 scale-95 pointer-events-none';
            const hasIncidents = node.incidents && node.incidents.length > 0;

            // Render based on node type
            if (node.type === 'cluster') {
              return (
                <div
                  key={node.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(node);
                  }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`
                  }}
                  className={`absolute rounded-xl bg-zinc-950/95 border p-3.5 transition-all duration-200 cursor-pointer shadow-2xl flex flex-col justify-between ${opacityClass} ${
                    isSelected
                      ? 'border-sky-400 ring-2 ring-sky-500/30 shadow-sky-500/20'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20">
                        <Server className="w-4 h-4 text-sky-400" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-zinc-100 truncate max-w-[150px]">
                          {node.name}
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          Kubernetes Cluster
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 font-mono">
                      <span className={`w-2 h-2 rounded-full ${getHealthDot(node.health)}`} />
                      <span>{node.statusText}</span>
                    </div>
                  </div>

                  <div className="text-[10px] font-mono text-zinc-400 bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800/80 truncate">
                    {node.badgeText}
                  </div>
                </div>
              );
            }

            if (node.type === 'domain_group') {
              return (
                <div
                  key={node.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectNode(node);
                  }}
                  style={{
                    left: `${node.x}px`,
                    top: `${node.y}px`,
                    width: `${node.width}px`,
                    height: `${node.height}px`
                  }}
                  className={`absolute rounded-xl bg-zinc-950/95 border p-3 transition-all duration-200 cursor-pointer shadow-lg flex flex-col justify-between ${opacityClass} ${
                    isSelected
                      ? 'border-sky-400 ring-2 ring-sky-500/30'
                      : 'border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-zinc-900 border border-zinc-800">
                        {getNodeIcon(node.kind, node.type)}
                      </div>
                      <span className="text-xs font-bold text-zinc-200">{node.name}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
                      <span className={`w-1.5 h-1.5 rounded-full ${getHealthDot(node.health)}`} />
                      <span>{node.badgeText || (node.health === 'HEALTHY' ? 'Healthy' : 'Degraded')}</span>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-400 truncate">
                    {node.statusText}
                  </div>
                </div>
              );
            }

            // Standard Resource Node (Node, Deployment, Service, PVC, etc.)
            return (
              <div
                key={node.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(node);
                }}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  width: `${node.width}px`,
                  height: `${node.height}px`
                }}
                className={`absolute rounded-lg bg-zinc-950/95 border p-2.5 transition-all duration-200 cursor-pointer shadow-md flex flex-col justify-between group ${opacityClass} ${
                  isSelected
                    ? 'border-sky-400 ring-2 ring-sky-500/30 shadow-sky-500/10'
                    : hasIncidents
                    ? 'border-rose-900/60 hover:border-rose-700'
                    : 'border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {/* Header: Health, Kind, Name */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${getHealthDot(node.health)}`} />
                    <div className="p-1 rounded bg-zinc-900 border border-zinc-800/80 shrink-0">
                      {getNodeIcon(node.kind, node.type)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold text-zinc-200 truncate group-hover:text-sky-400 transition-colors">
                        {node.name}
                      </div>
                      <div className="text-[9px] text-zinc-500 font-mono truncate">
                        {node.namespace ? `ns: ${node.namespace}` : node.kind}
                      </div>
                    </div>
                  </div>

                  {/* Incident badge if present */}
                  {hasIncidents && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/30 text-[9px] font-mono font-bold text-rose-400 flex items-center gap-0.5">
                      <AlertOctagon className="w-2.5 h-2.5 text-rose-400" />
                      {node.incidents.length}
                    </span>
                  )}
                </div>

                {/* Footer: Metrics or Status or Expand button */}
                <div className="flex items-center justify-between mt-1 pt-1 border-t border-zinc-900 text-[10px] font-mono text-zinc-400">
                  <div className="truncate">
                    {node.metrics?.isAvailable ? (
                      <span className="text-zinc-300">
                        CPU {node.metrics.cpu} | MEM {node.metrics.memory}
                      </span>
                    ) : (
                      <span className="text-zinc-400">{node.statusText}</span>
                    )}
                  </div>

                  {/* Expand / Collapse Sub-resources toggle (e.g. Workload Pods) */}
                  {node.canExpand && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleExpand(node.id);
                      }}
                      className="px-1.5 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-[9px] text-sky-400 border border-zinc-800 flex items-center gap-0.5 cursor-pointer"
                    >
                      {node.isExpanded ? (
                        <>
                          <span>Hide</span>
                          <ChevronUp className="w-2.5 h-2.5" />
                        </>
                      ) : (
                        <>
                          <span>{node.subResourcesCount} Pods</span>
                          <ChevronDown className="w-2.5 h-2.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Movable Floating Topology Legend */}
      {isLegendVisible && (
        <div
          ref={legendRef}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          style={
            legendPos
              ? { left: `${legendPos.x}px`, top: `${legendPos.y}px` }
              : { left: '16px', bottom: '20px' }
          }
          className={`absolute z-30 bg-zinc-950/95 backdrop-blur-md border border-zinc-800/90 rounded-lg shadow-2xl font-mono text-[10px] text-zinc-400 pointer-events-auto transition-shadow ${
            isDraggingOverlay === 'legend' ? 'ring-2 ring-sky-500/50 shadow-sky-500/20 cursor-grabbing select-none' : ''
          }`}
        >
          {/* Draggable Header */}
          <div
            onMouseDown={(e) => handleStartDragOverlay(e, 'legend')}
            onTouchStart={(e) => handleStartDragOverlay(e, 'legend')}
            title="Drag anywhere to reposition"
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-zinc-800/80 bg-zinc-900/50 hover:bg-zinc-900/80 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-1.5 text-zinc-400 font-semibold">
              <GripHorizontal className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-[9px] uppercase tracking-wider text-zinc-300 font-bold">
                Relationships
              </span>
            </div>
            <div className="flex items-center gap-1">
              {legendPos && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLegendPos(null);
                  }}
                  title="Reset to default corner"
                  className="p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLegendCollapsed(!isLegendCollapsed);
                }}
                title={isLegendCollapsed ? 'Expand legend' : 'Collapse legend'}
                className="p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition cursor-pointer"
              >
                {isLegendCollapsed ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronUp className="w-3 h-3" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsLegendVisible(false);
                }}
                title="Hide legend"
                className="p-0.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Legend Items */}
          {!isLegendCollapsed && (
            <div className="p-2.5 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-zinc-600 rounded" />
                <span>Ownership</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 border-t border-dashed border-sky-500" />
                <span className="text-sky-400">Traffic Flow</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 border-t border-dashed border-emerald-500" />
                <span className="text-emerald-400">Uses / Bound</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 border-t border-dashed border-amber-500" />
                <span className="text-amber-400">Depends On</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Movable Floating Cluster Mini-Map */}
      {showMiniMap && (
        <div
          ref={miniMapRef}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          style={
            miniMapPos
              ? { left: `${miniMapPos.x}px`, top: `${miniMapPos.y}px` }
              : { right: '16px', bottom: '20px' }
          }
          className={`absolute z-30 w-48 bg-zinc-950/95 backdrop-blur-md border border-zinc-800 rounded-lg shadow-2xl overflow-hidden pointer-events-auto transition-shadow flex flex-col ${
            isDraggingOverlay === 'minimap' ? 'ring-2 ring-sky-500/50 shadow-sky-500/20 cursor-grabbing select-none' : ''
          }`}
        >
          {/* Draggable Header */}
          <div
            onMouseDown={(e) => handleStartDragOverlay(e, 'minimap')}
            onTouchStart={(e) => handleStartDragOverlay(e, 'minimap')}
            title="Drag anywhere to reposition"
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-zinc-800/80 bg-zinc-900/50 hover:bg-zinc-900/80 rounded-t-lg cursor-grab active:cursor-grabbing select-none"
          >
            <div className="flex items-center gap-1.5 text-zinc-400 font-mono text-[9px] font-semibold">
              <GripHorizontal className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-zinc-300">Cluster mini map</span>
            </div>
            <div className="flex items-center gap-1">
              {miniMapPos && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMiniMapPos(null);
                  }}
                  title="Reset to default corner"
                  className="p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsMiniMapCollapsed(!isMiniMapCollapsed);
                }}
                title={isMiniMapCollapsed ? 'Expand mini map' : 'Collapse mini map'}
                className="p-0.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition cursor-pointer"
              >
                {isMiniMapCollapsed ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronUp className="w-3 h-3" />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMiniMap();
                }}
                title="Close mini map"
                className="p-0.5 text-zinc-500 hover:text-rose-400 hover:bg-zinc-800 rounded transition cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Canvas representation thumbnail */}
          {!isMiniMapCollapsed && (
            <div className="p-2">
              <div
                onClick={handleMiniMapClick}
                title="Click anywhere on map to pan canvas"
                className="relative w-full h-24 bg-zinc-900/60 rounded border border-zinc-800/60 overflow-hidden cursor-crosshair"
              >
                {graphData.nodes.map((n) => {
                  const miniX = (n.x / graphData.bounds.width) * 100;
                  const miniY = (n.y / graphData.bounds.height) * 100;
                  const dotColor =
                    n.health === 'CRITICAL'
                      ? 'bg-rose-500'
                      : n.health === 'WARNING'
                      ? 'bg-amber-400'
                      : 'bg-emerald-400';

                  return (
                    <div
                      key={`mini-${n.id}`}
                      style={{ left: `${Math.min(miniX, 90)}%`, top: `${Math.min(miniY, 85)}%` }}
                      className={`absolute w-1.5 h-1 rounded-sm ${dotColor}`}
                    />
                  );
                })}

                {/* Viewport Box */}
                <div
                  className="absolute border border-sky-400/80 bg-sky-500/15 rounded pointer-events-none transition-all duration-75"
                  style={miniMapViewport}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
