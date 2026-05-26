import { useEffect, useRef } from 'react';

/**
 * LogoLoader — full-screen 3D animated recreation of the CronStream logo.
 *
 * Geometry:
 *   - Extruded hexagonal "coin" body (top face + 6 side trapezoids)
 *   - Two orbital rings (ellipses) spinning in opposite directions
 *   - Downward-pointing diamond spike below the coin
 *   - "C" glyph on the top face
 *
 * All drawn on Canvas 2D with a simple Y-axis rotation projection.
 */
export default function LogoLoader({ label = 'Loading…' }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const DPR = window.devicePixelRatio || 1;
    const SIZE = 280;
    canvas.width  = SIZE * DPR;
    canvas.height = SIZE * DPR;
    canvas.style.width  = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    ctx.scale(DPR, DPR);

    const CX = SIZE / 2;
    const CY = SIZE / 2 - 10;

    // ── Colours ────────────────────────────────────────────────────────────
    const TEAL       = '#00D4AA';
    const TEAL_MID   = '#00A882';
    const TEAL_DARK  = '#007A60';
    const RING_CLR   = '#5DD6E0';
    const RING_DARK  = '#3AB8C0';
    const SPIKE_CLR  = '#7EECD8';

    // ── 3-D projection ────────────────────────────────────────────────────
    // Rotate a point around the Y axis, then apply mild X tilt, then
    // perspective-divide so further-away points shrink slightly.
    function project(x, y, z, yAngle) {
      const TILT  = 0.38;          // radians — X-axis lean (fixed)
      const PERSP = 420;           // perspective distance

      // Y rotation
      const cosY = Math.cos(yAngle);
      const sinY = Math.sin(yAngle);
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;

      // X tilt
      const cosX = Math.cos(TILT);
      const sinX = Math.sin(TILT);
      const ry2 = y * cosX - rz * sinX;
      const rz2 = y * sinX + rz * cosX;

      // Perspective
      const scale = PERSP / (PERSP + rz2 + 80);
      return { sx: CX + rx * scale, sy: CY + ry2 * scale, scale, rz: rz2 };
    }

    // ── Hex vertices on the XZ plane ──────────────────────────────────────
    const HEX_R  = 62;   // hex radius
    const DEPTH  =  18;  // extrusion depth (Y direction, positive = down)
    const TOP_Y  = -10;
    const BOT_Y  = TOP_Y + DEPTH;

    function hexPts(r, yLevel) {
      return Array.from({ length: 6 }, (_, i) => {
        const a = (i * Math.PI) / 3 - Math.PI / 6; // flat-top hex
        return { x: r * Math.cos(a), y: yLevel, z: r * Math.sin(a) };
      });
    }

    // ── Spike (diamond below) ─────────────────────────────────────────────
    const SPIKE_Y = BOT_Y + 44;
    const SPIKE_R = 22;

    function spikePts(yLevel) {
      return Array.from({ length: 4 }, (_, i) => {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        return { x: SPIKE_R * Math.cos(a), y: yLevel, z: SPIKE_R * Math.sin(a) };
      });
    }

    // ── Ring: a circle in the XZ plane at a given Y and radius ────────────
    function ringPath(ctx, ringR, yLevel, yAngle, steps = 64) {
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const p = project(ringR * Math.cos(a), yLevel, ringR * Math.sin(a), yAngle);
        pts.push(p);
      }
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
      ctx.closePath();
    }

    // ── Draw a filled polygon from projected 3-D points ───────────────────
    function fillPoly(ctx, pts3d, yAngle, fillStyle) {
      const projected = pts3d.map(p => project(p.x, p.y, p.z, yAngle));
      ctx.beginPath();
      projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
    }

    // ── "C" glyph on the top face ─────────────────────────────────────────
    function drawC(ctx, yAngle) {
      // Project the centre of the top face
      const centre = project(0, TOP_Y - 2, 0, yAngle);
      const scl = centre.scale;

      ctx.save();
      ctx.translate(centre.sx, centre.sy);
      // Squash horizontally to match the perspective foreshortening
      const cosY = Math.abs(Math.cos(yAngle));
      ctx.scale(cosY * scl * 0.85, scl * 0.85);
      ctx.font = `bold ${36}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('C', 0, 0);

      // Subtle shadow behind the letter
      ctx.fillStyle = 'rgba(0,168,130,0.5)';
      ctx.fillText('C', 2, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillText('C', 0, 0);
      ctx.restore();
    }

    // ── Main draw ─────────────────────────────────────────────────────────
    let t = 0;

    function draw() {
      ctx.clearRect(0, 0, SIZE, SIZE);

      const yAngle = t * 0.6; // main rotation speed

      const topPts = hexPts(HEX_R, TOP_Y);
      const botPts = hexPts(HEX_R, BOT_Y);

      // ── Sort side faces back-to-front (painter's algorithm) ─────────────
      const sides = topPts.map((tp, i) => {
        const np = topPts[(i + 1) % 6];
        const nb = botPts[(i + 1) % 6];
        const bp = botPts[i];
        // Average Z of face to determine draw order
        const avgZ = (tp.z + np.z + nb.z + bp.z) / 4;
        const rotZ = avgZ * Math.cos(yAngle) + tp.x * Math.sin(yAngle);
        return { pts: [tp, np, nb, bp], rotZ };
      });
      sides.sort((a, b) => b.rotZ - a.rotZ); // furthest first

      // ── Ring 1 (back half — drawn before coin) ─────────────────────────
      const RING1_R = 95;
      const RING1_Y = -2;
      const ring1Angle = -t * 0.9;

      // Split ring into back half and front half
      function drawRingHalf(ctx, ringR, yLevel, ringAngle, baseYAngle, front, color, lw) {
        const steps = 64;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2 + ringAngle;
          const px = ringR * Math.cos(a);
          const pz = ringR * Math.sin(a);
          // "front" = positive Z after Y rotation
          const rotZ = px * Math.sin(baseYAngle) + pz * Math.cos(baseYAngle);
          if ((front && rotZ >= 0) || (!front && rotZ < 0)) {
            const p = project(px, yLevel, pz, baseYAngle);
            if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
            else ctx.lineTo(p.sx, p.sy);
          }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth   = lw;
        ctx.lineCap     = 'round';
        ctx.stroke();
      }

      const RING2_R = 85;
      const RING2_Y = 4;
      const ring2Angle = t * 1.1;

      // Back halves of both rings (behind coin)
      ctx.globalAlpha = 0.7;
      drawRingHalf(ctx, RING1_R, RING1_Y, ring1Angle, yAngle, false, RING_DARK, 4.5);
      drawRingHalf(ctx, RING2_R, RING2_Y, ring2Angle, yAngle, false, RING_DARK, 4);
      ctx.globalAlpha = 1;

      // ── Spike (below coin) ─────────────────────────────────────────────
      const spTop  = spikePts(BOT_Y);
      const tipPt  = { x: 0, y: SPIKE_Y, z: 0 };

      // Spike side faces
      spTop.forEach((sp, i) => {
        const np = spTop[(i + 1) % 4];
        const avgX = (sp.x + np.x) / 2;
        const avgZ = (sp.z + np.z) / 2;
        const rotZ = avgX * Math.sin(yAngle) + avgZ * Math.cos(yAngle);
        if (rotZ < 30) return; // cull back faces
        fillPoly(ctx, [sp, np, tipPt], yAngle, i % 2 === 0 ? SPIKE_CLR : TEAL_MID);
      });

      // ── Coin side faces ────────────────────────────────────────────────
      sides.forEach(({ pts, rotZ }) => {
        // Light from above-left: faces with positive Z (facing viewer) are brighter
        const brightness = Math.max(0, rotZ);
        const shade = brightness > 0 ? TEAL_MID : TEAL_DARK;
        fillPoly(ctx, pts, yAngle, shade);

        // Thin top-edge highlight
        const [tp, np] = [pts[0], pts[1]].map(p => project(p.x, p.y, p.z, yAngle));
        ctx.beginPath();
        ctx.moveTo(tp.sx, tp.sy);
        ctx.lineTo(np.sx, np.sy);
        ctx.strokeStyle = `rgba(126,236,216,${brightness > 0 ? 0.5 : 0.1})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // ── Top hex face ───────────────────────────────────────────────────
      {
        const grad = ctx.createRadialGradient(CX, CY + TOP_Y * 0.4, 5, CX, CY + TOP_Y * 0.4, HEX_R);
        grad.addColorStop(0, '#1AFFC8');
        grad.addColorStop(1, TEAL);

        const projected = topPts.map(p => project(p.x, p.y, p.z, yAngle));
        ctx.beginPath();
        projected.forEach((p, i) => (i === 0 ? ctx.moveTo(p.sx, p.sy) : ctx.lineTo(p.sx, p.sy)));
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // rim glow
        ctx.strokeStyle = 'rgba(126,236,216,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── "C" letter on face ─────────────────────────────────────────────
      drawC(ctx, yAngle);

      // ── Front halves of both rings (in front of coin) ──────────────────
      ctx.globalAlpha = 0.9;
      drawRingHalf(ctx, RING1_R, RING1_Y, ring1Angle, yAngle, true, RING_CLR, 4.5);
      drawRingHalf(ctx, RING2_R, RING2_Y, ring2Angle, yAngle, true, RING_CLR, 4);
      ctx.globalAlpha = 1;

      // ── Ambient glow beneath the whole logo ────────────────────────────
      const glow = ctx.createRadialGradient(CX, CY + 60, 5, CX, CY + 60, 80);
      glow.addColorStop(0, 'rgba(0,212,170,0.12)');
      glow.addColorStop(1, 'rgba(0,212,170,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(CX - 80, CY, 160, 80);

      t += 0.018;
    }

    function loop() {
      draw();
      rafRef.current = requestAnimationFrame(loop);
    }
    loop();

    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="fixed inset-0 bg-dark flex flex-col items-center justify-center z-50">
      {/* subtle radial bg */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(0,212,170,0.06) 0%, transparent 70%)' }}
      />

      <canvas ref={canvasRef} style={{ imageRendering: 'pixelated' }} />

      <div className="mt-2 flex flex-col items-center gap-2">
        <p className="font-mono text-sm text-accent tracking-widest uppercase animate-pulse">
          {label}
        </p>
        {/* three-dot bounce */}
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-accent/60"
              style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40%            { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
