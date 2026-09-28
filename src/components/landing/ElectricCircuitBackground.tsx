import React, { useEffect, useRef } from 'react';

interface CircuitNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  type: 'core' | 'gateway' | 'pod' | 'bus';
  voltage: number;
  charge: number;
}

interface ElectricPulse {
  sourceIndex: number;
  targetIndex: number;
  progress: number;
  speed: number;
  color: string;
  amplitude: number;
  length: number;
}

export const ElectricCircuitBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const prefersReducedMotion = mediaQuery.matches;

    // Node count calculated based on viewport dimensions
    const nodeCount = Math.min(Math.floor((width * height) / 16000), 50);
    const nodes: CircuitNode[] = [];
    const pulses: ElectricPulse[] = [];

    const types: CircuitNode['type'][] = ['core', 'gateway', 'pod', 'bus'];

    for (let i = 0; i < nodeCount; i++) {
      const type = types[i % types.length];
      const color =
        type === 'core'
          ? 'rgba(56, 189, 248, '   // Electric Cyan
          : type === 'gateway'
          ? 'rgba(14, 165, 233, '   // Sky Blue
          : type === 'bus'
          ? 'rgba(96, 165, 250, '   // Electric Blue
          : 'rgba(255, 255, 255, '; // Pure White Energy Node

      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        radius: type === 'core' ? 3 : type === 'gateway' ? 2.5 : 2,
        color,
        type,
        voltage: 0.5 + Math.random() * 0.5,
        charge: Math.random() * Math.PI * 2
      });
    }

    // Spawn pulses along connected circuit traces
    const spawnPulse = () => {
      if (nodes.length < 2 || pulses.length >= 12) return;
      const sourceIndex = Math.floor(Math.random() * nodes.length);

      let closestTarget = -1;
      let closestDist = 220;

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
        pulses.push({
          sourceIndex,
          targetIndex: closestTarget,
          progress: 0,
          speed: 0.009 + Math.random() * 0.015,
          color: Math.random() > 0.4 ? '#38bdf8' : '#ffffff',
          amplitude: 1.5 + Math.random() * 2,
          length: 0.12 + Math.random() * 0.08
        });
      }
    };

    let mouseX = -1000;
    let mouseY = -1000;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    };

    const handleResize = () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('resize', handleResize);

    const connectionDistance = 210;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // 1. Draw subtle circuit conduits / bus lines
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          const dist = Math.hypot(dx, dy);

          if (dist < connectionDistance) {
            const alpha = (1 - dist / connectionDistance) * 0.16;
            ctx.beginPath();
            ctx.strokeStyle = `rgba(56, 189, 248, ${alpha})`;
            ctx.lineWidth = 1;

            // Circuit line drawing with subtle orthogonal bias
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.stroke();
          }
        }
      }

      // 2. Draw moving electric pulses along conduits
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        if (!nodes[pulse.sourceIndex] || !nodes[pulse.targetIndex]) {
          pulses.splice(i, 1);
          continue;
        }

        const source = nodes[pulse.sourceIndex];
        const target = nodes[pulse.targetIndex];

        pulse.progress += pulse.speed;

        if (pulse.progress >= 1) {
          pulses.splice(i, 1);
          continue;
        }

        // Tail and head calculation
        const headProg = pulse.progress;
        const tailProg = Math.max(0, pulse.progress - pulse.length);

        const hx = source.x + (target.x - source.x) * headProg;
        const hy = source.y + (target.y - source.y) * headProg;

        const tx = source.x + (target.x - source.x) * tailProg;
        const ty = source.y + (target.y - source.y) * tailProg;

        const grad = ctx.createLinearGradient(tx, ty, hx, hy);
        grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
        grad.addColorStop(0.5, 'rgba(56, 189, 248, 0.4)');
        grad.addColorStop(1, pulse.color);

        ctx.beginPath();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.moveTo(tx, ty);
        ctx.lineTo(hx, hy);
        ctx.stroke();

        // Glowing pulse head
        ctx.beginPath();
        ctx.arc(hx, hy, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = pulse.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0; // reset
      }

      // 3. Draw nodes and voltage charge halo
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];

        if (!prefersReducedMotion) {
          node.x += node.vx;
          node.y += node.vy;

          if (node.x < 10 || node.x > width - 10) node.vx *= -1;
          if (node.y < 10 || node.y > height - 10) node.vy *= -1;

          node.charge += 0.04;
        }

        // Mouse electrostatic repulsion/attraction
        const mdx = node.x - mouseX;
        const mdy = node.y - mouseY;
        const mDist = Math.hypot(mdx, mdy);
        if (mDist < 120 && mDist > 0) {
          const force = (120 - mDist) / 120;
          node.x += (mdx / mDist) * force * 1.5;
          node.y += (mdy / mDist) * force * 1.5;
        }

        const pulseGlow = Math.sin(node.charge) * 0.3 + 0.7;

        // Outer voltage ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = node.color + (0.08 * pulseGlow) + ')';
        ctx.fill();

        // Core circuit dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color + (0.9 * pulseGlow) + ')';
        ctx.fill();
      }

      // Intermittent pulse dispatch
      if (Math.random() < 0.08) {
        spawnPulse();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0 opacity-70"
      style={{
        maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0.3) 100%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0.3) 100%)'
      }}
    />
  );
};
