/**
 * StreamBackground — animated canvas background for the landing page hero.
 *
 * Visualises CronStream's core concept:
 *   • Horizontal stream lanes — payment channels between company → contractor
 *   • Glowing particles with trails — tokens flowing per-second
 *   • Pulsing milestone nodes — verification checkpoints on each lane
 *   • Burst rings — fired when a particle passes through a node (milestone hit)
 *   • Faint vertical grid — structural depth
 */

import { useEffect, useRef } from 'react';

const ACCENT  = '#00D4AA';
const ACCENT0 = 'rgba(0,212,170,0)';

// ─── helpers ─────────────────────────────────────────────────────────────────
const rand   = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

export default function StreamBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx  = canvas.getContext('2d');
    const dpr  = window.devicePixelRatio || 1;
    let animId, W, H;
    let streams = [], particles = [], nodes = [], bursts = [];
    let lastBurst = {}; // cooldown map keyed by nodeId

    // ── setup ──────────────────────────────────────────────────────────────
    function init() {
      const rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width  = W * dpr;
      canvas.height = H * dpr;
      ctx.scale(dpr, dpr);

      streams   = [];
      particles = [];
      nodes     = [];
      bursts    = [];

      const N_STREAMS = Math.max(5, Math.floor(H / 110));

      for (let i = 0; i < N_STREAMS; i++) {
        const y   = (H / (N_STREAMS + 1)) * (i + 1) + rand(-20, 20);
        const opa = rand(0.06, 0.16);
        streams.push({ y, opa });

        // particles per lane
        const nP = randInt(2, 4);
        for (let j = 0; j < nP; j++) {
          particles.push({
            si:    i,                          // stream index
            x:     rand(0, W),
            speed: rand(0.6, 2.2),
            r:     rand(1.8, 3.2),
            opa:   rand(0.55, 1),
          });
        }

        // milestone nodes per lane
        const nN = randInt(1, 3);
        for (let j = 0; j < nN; j++) {
          nodes.push({
            id:   `${i}-${j}`,
            si:   i,
            x:    (W / (nN + 1)) * (j + 1) + rand(-60, 60),
            phi:  rand(0, Math.PI * 2),   // phase offset for pulse
            br:   rand(3.5, 6),           // base radius
          });
        }
      }
    }

    // ── burst factory ──────────────────────────────────────────────────────
    function spawnBurst(x, y) {
      const n = randInt(1, 2);
      for (let i = 0; i < n; i++) {
        bursts.push({
          x, y,
          r:    0,
          maxR: rand(24, 48),
          opa:  rand(0.5, 0.8),
          spd:  rand(0.7, 1.3),
        });
      }
    }

    // ── main draw ──────────────────────────────────────────────────────────
    function draw(t) {
      ctx.clearRect(0, 0, W, H);

      // faint vertical grid lines
      const gridStep = 80;
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += gridStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.strokeStyle = 'rgba(0,212,170,0.04)';
        ctx.stroke();
      }

      // ── stream lanes ────────────────────────────────────────────────────
      streams.forEach(({ y, opa }) => {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.strokeStyle = `rgba(0,212,170,${opa * 0.5})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      });

      // ── milestone nodes ─────────────────────────────────────────────────
      nodes.forEach(node => {
        const { x, y: sy } = { x: node.x, y: streams[node.si].y };
        node.phi += 0.025;
        const r = node.br + Math.sin(node.phi) * 1.8;

        // outer glow halo
        const g = ctx.createRadialGradient(x, sy, 0, x, sy, r * 5);
        g.addColorStop(0, `rgba(0,212,170,0.18)`);
        g.addColorStop(1, ACCENT0);
        ctx.beginPath();
        ctx.arc(x, sy, r * 5, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // inner ring
        ctx.beginPath();
        ctx.arc(x, sy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,212,170,0.25)`;
        ctx.lineWidth = 1;
        ctx.stroke();

        // core dot
        ctx.beginPath();
        ctx.arc(x, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,212,170,0.85)`;
        ctx.shadowBlur  = 12;
        ctx.shadowColor = ACCENT;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── particles ───────────────────────────────────────────────────────
      particles.forEach(p => {
        const sy = streams[p.si].y;
        p.x += p.speed;
        if (p.x > W + 40) p.x = -40;

        // collision check with nodes on same lane — with cooldown
        nodes.forEach(node => {
          if (node.si !== p.si) return;
          if (Math.abs(p.x - node.x) < 10) {
            const now = Date.now();
            const last = lastBurst[node.id] ?? 0;
            if (now - last > 800) {
              spawnBurst(node.x, sy);
              lastBurst[node.id] = now;
            }
          }
        });

        // trail gradient
        const trailLen = 40 + p.speed * 14;
        const tg = ctx.createLinearGradient(p.x - trailLen, sy, p.x, sy);
        tg.addColorStop(0, ACCENT0);
        tg.addColorStop(1, `rgba(0,212,170,${p.opa * 0.7})`);
        ctx.beginPath();
        ctx.moveTo(p.x - trailLen, sy);
        ctx.lineTo(p.x, sy);
        ctx.strokeStyle = tg;
        ctx.lineWidth   = p.r * 0.7;
        ctx.stroke();

        // particle head
        ctx.beginPath();
        ctx.arc(p.x, sy, p.r, 0, Math.PI * 2);
        ctx.fillStyle  = `rgba(0,212,170,${p.opa})`;
        ctx.shadowBlur  = 14;
        ctx.shadowColor = ACCENT;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // ── burst rings ─────────────────────────────────────────────────────
      bursts = bursts.filter(b => b.opa > 0.01);
      bursts.forEach(b => {
        b.r   += b.spd;
        b.opa *= 0.94;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,212,170,${b.opa})`;
        ctx.lineWidth   = 1.5;
        ctx.stroke();
      });

      animId = requestAnimationFrame(draw);
    }

    // ── resize ─────────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => init());
    ro.observe(canvas);

    init();
    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity: 0.75,
      }}
    />
  );
}
