import React, { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  type: 'core' | 'service' | 'pod' | 'gateway';
  pulsePhase: number;
}

interface PulsePacket {
  sourceIndex: number;
  targetIndex: number;
  progress: number;
  speed: number;
  color: string;
}

export const ConstellationGalaxyBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Check prefers-reduced-motion
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = mediaQuery.matches;

    // Node & Packet state
    const nodeCount = Math.min(Math.floor((width * height) / 18000), 55);
    const nodes: Node[] = [];
    const packets: PulsePacket[] = [];
    const colors = {
      cyan: 'rgba(56, 189, 248, ',
      indigo: 'rgba(129, 140, 248, ',
      emerald: 'rgba(52, 211, 153, ',
      violet: 'rgba(168, 85, 247, '
    };

    const types: Node['type'][] = ['core', 'service', 'pod', 'gateway'];

    for (let i = 0; i < nodeCount; i++) {
      const type = types[i % types.length];
      const colorKey = type === 'core' ? 'cyan' : type === 'service' ? 'indigo' : type === 'pod' ? 'emerald' : 'violet';
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        radius: type === 'core' ? 2.5 : type === 'gateway' ? 2.0 : 1.5,
        color: colors[colorKey],
        type,
        pulsePhase: Math.random() * Math.PI * 2
      });
    }

    // Spawn packets intermittently
    const spawnPacket = () => {
      if (nodes.length < 2 || packets.length >= 8) return;
      const sourceIndex = Math.floor(Math.random() * nodes.length);
      // find nearest neighbor within connection distance
      let closestTarget = -1;
      let closestDist = 180;
      for (let j = 0; j < nodes.length; j++) {
        if (j === sourceIndex) continue;
        const dx = nodes[j].x - nodes[sourceIndex].x;
        const dy = nodes[j].y - nodes[sourceIndex].y;
        const dist = Math.hypot(dx, dy);
        if (dist < closestDist) {
          closestDist = dist;
          closestTarget = j;
        }
      }
      if (closestTarget !== -1) {
        packets.push({
          sourceIndex,
          targetIndex: closestTarget,
          progress: 0,
          speed: 0.008 + Math.random() * 0.012,
          color: '#38bdf8'
        });
      }
    };

    let mouseX = -1000;
    let mouseY = -1000;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleMouseLeave = () => {
      mouseX = -1000;
      mouseY = -1000;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    const maxDistance = 160;
    let lastPacketTime = 0;

    const render = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      // Packet spawner (every ~800ms)
      if (!prefersReducedMotion && time - lastPacketTime > 750) {
        spawnPacket();
        lastPacketTime = time;
      }

      // Update and draw connections
      for (let i = 0; i < nodes.length; i++) {
        const nodeA = nodes[i];

        if (!prefersReducedMotion) {
          nodeA.x += nodeA.vx;
          nodeA.y += nodeA.vy;

          // Wrap edges smoothly
          if (nodeA.x < 0) nodeA.x = width;
          if (nodeA.x > width) nodeA.x = 0;
          if (nodeA.y < 0) nodeA.y = height;
          if (nodeA.y > height) nodeA.y = 0;

          // Interactive gentle repulsion/influence around cursor
          const mdx = mouseX - nodeA.x;
          const mdy = mouseY - nodeA.y;
          const mdist = Math.hypot(mdx, mdy);
          if (mdist < 140 && mdist > 0) {
            const force = (140 - mdist) / 140;
            nodeA.x -= (mdx / mdist) * force * 0.6;
            nodeA.y -= (mdy / mdist) * force * 0.6;
          }

          nodeA.pulsePhase += 0.02;
        }

        // Connect to neighbors
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeB = nodes[j];
          const dx = nodeB.x - nodeA.x;
          const dy = nodeB.y - nodeA.y;
          const dist = Math.hypot(dx, dy);

          if (dist < maxDistance) {
            const alpha = (1 - dist / maxDistance) * 0.16;
            ctx.beginPath();
            ctx.moveTo(nodeA.x, nodeA.y);
            ctx.lineTo(nodeB.x, nodeB.y);
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }

        // Draw node
        const pulse = prefersReducedMotion ? 1 : 1 + Math.sin(nodeA.pulsePhase) * 0.35;
        const r = nodeA.radius * pulse;

        // Subtle glow halo
        ctx.beginPath();
        ctx.arc(nodeA.x, nodeA.y, r * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `${nodeA.color}0.08)`;
        ctx.fill();

        // Node center
        ctx.beginPath();
        ctx.arc(nodeA.x, nodeA.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `${nodeA.color}0.75)`;
        ctx.fill();
      }

      // Draw telemetry pulse packets
      if (!prefersReducedMotion) {
        for (let p = packets.length - 1; p >= 0; p--) {
          const pkt = packets[p];
          pkt.progress += pkt.speed;

          if (pkt.progress >= 1) {
            packets.splice(p, 1);
            continue;
          }

          const n1 = nodes[pkt.sourceIndex];
          const n2 = nodes[pkt.targetIndex];
          if (!n1 || !n2) {
            packets.splice(p, 1);
            continue;
          }

          const curX = n1.x + (n2.x - n1.x) * pkt.progress;
          const curY = n1.y + (n2.y - n1.y) * pkt.progress;

          // Glowing packet dot
          ctx.beginPath();
          ctx.arc(curX, curY, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = pkt.color;
          ctx.shadowColor = '#00f0ff';
          ctx.shadowBlur = 6;
          ctx.fill();
          ctx.shadowBlur = 0; // reset
        }
      }

      if (!prefersReducedMotion) {
        animationFrameId = requestAnimationFrame(render);
      }
    };

    if (prefersReducedMotion) {
      render(0);
    } else {
      animationFrameId = requestAnimationFrame(render);
    }

    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Deep atmospheric radial glow effects */}
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[850px] h-[550px] bg-gradient-to-b from-sky-500/12 via-indigo-600/8 to-transparent rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -left-48 w-[600px] h-[600px] bg-cyan-500/6 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-2/3 -right-48 w-[650px] h-[650px] bg-indigo-500/6 rounded-full blur-[150px] pointer-events-none" />

      {/* Subtle fine dot lattice texture */}
      <div
        className="absolute inset-0 opacity-[0.035] bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:32px_32px] pointer-events-none"
        aria-hidden="true"
      />

      {/* HTML5 Canvas Constellation */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full opacity-70"
        aria-hidden="true"
      />
    </div>
  );
};
