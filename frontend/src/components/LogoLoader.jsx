/**
 * LogoLoader — full-screen loading screen using the real CronStream icon.
 *
 * Design:
 *   - cronstream.png (transparent background) centred with a teal glow pulse
 *   - Two SVG arcs spinning in opposite directions outside the icon
 *   - Three staggered stream bars below
 *   - Pure CSS animations — no canvas, no RAF loop
 */
export default function LogoLoader({ label = 'Loading…' }) {
  return (
    <div style={{
      position:       'fixed',
      inset:          0,
      background:     '#0B1110',
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      zIndex:         50,
      gap:            28,
    }}>

      {/* ── Keyframes ─────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes cs-cw  { to { transform: rotate( 360deg); } }
        @keyframes cs-ccw { to { transform: rotate(-360deg); } }
        @keyframes cs-pulse {
          0%,100% {
            filter: drop-shadow(0 0 10px rgba(0,212,170,.35))
                    drop-shadow(0 0 28px rgba(0,212,170,.15));
          }
          50% {
            filter: drop-shadow(0 0 20px rgba(0,212,170,.70))
                    drop-shadow(0 0 48px rgba(0,212,170,.28));
          }
        }
        @keyframes cs-slide {
          0%   { transform: translateX(-100%); opacity: 0; }
          15%  { opacity: 1; }
          85%  { opacity: 1; }
          100% { transform: translateX(200%);  opacity: 0; }
        }
      `}</style>

      {/* ── Icon + spinner rings ───────────────────────────────────────────── */}
      <div style={{ position: 'relative', width: 160, height: 160 }}>

        {/* Soft ambient radial glow behind everything */}
        <div style={{
          position:     'absolute',
          inset:        -40,
          borderRadius: '50%',
          background:   'radial-gradient(circle, rgba(0,212,170,.09) 0%, transparent 68%)',
          pointerEvents:'none',
        }} />

        {/* Outer arc — CW, slow */}
        <svg viewBox="0 0 100 100" style={{
          position:  'absolute',
          inset:     0,
          width:     '100%',
          height:    '100%',
          animation: 'cs-cw 2.6s linear infinite',
          overflow:  'visible',
        }}>
          <defs>
            <linearGradient id="csl-outer" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="0" y2="100">
              <stop offset="0%"   stopColor="#00D4AA" stopOpacity="0"   />
              <stop offset="60%"  stopColor="#00D4AA" stopOpacity=".55" />
              <stop offset="100%" stopColor="#5DD6E0" stopOpacity="1"   />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(0,212,170,.08)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="48" fill="none"
            stroke="url(#csl-outer)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="110 192"
          />
        </svg>

        {/* Inner arc — CCW, faster */}
        <svg viewBox="0 0 100 100" style={{
          position:  'absolute',
          inset:     10,
          width:     'calc(100% - 20px)',
          height:    'calc(100% - 20px)',
          animation: 'cs-ccw 1.7s linear infinite',
          overflow:  'visible',
        }}>
          <defs>
            <linearGradient id="csl-inner" gradientUnits="userSpaceOnUse" x1="0" y1="100" x2="100" y2="0">
              <stop offset="0%"   stopColor="#5DD6E0" stopOpacity="0"   />
              <stop offset="65%"  stopColor="#00D4AA" stopOpacity=".45" />
              <stop offset="100%" stopColor="#00D4AA" stopOpacity=".85" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(0,212,170,.05)" strokeWidth="1.5" />
          <circle cx="50" cy="50" r="46" fill="none"
            stroke="url(#csl-inner)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="72 216"
          />
        </svg>

        {/* The actual icon — centred, transparent bg, pulsing glow */}
        <img
          src="/cronstream.png"
          alt=""
          draggable={false}
          style={{
            position:  'absolute',
            inset:     18,
            width:     'calc(100% - 36px)',
            height:    'calc(100% - 36px)',
            objectFit: 'contain',
            animation: 'cs-pulse 2.6s ease-in-out infinite',
            userSelect:'none',
          }}
        />

      </div>

      {/* ── Label + stream bars ───────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>

        <p style={{
          margin:        0,
          fontFamily:    '"SF Mono", "Fira Code", monospace',
          fontSize:      11,
          fontWeight:    600,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          color:         'rgba(0,212,170,.75)',
        }}>
          CronStream
        </p>

        {/* Stream bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, width: 88 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              height:       2,
              borderRadius: 1,
              background:   'rgba(0,212,170,.10)',
              overflow:     'hidden',
            }}>
              <div style={{
                height:       '100%',
                width:        '45%',
                borderRadius: 1,
                background:   'linear-gradient(90deg, transparent, #00D4AA 40%, #5DD6E0 60%, transparent)',
                animation:    `cs-slide 1.9s ease-in-out ${i * 0.32}s infinite`,
              }} />
            </div>
          ))}
        </div>

        <p style={{
          margin:        0,
          fontFamily:    'monospace',
          fontSize:      10,
          color:         'rgba(255,255,255,.25)',
          letterSpacing: '0.1em',
        }}>
          {label}
        </p>

      </div>

    </div>
  );
}
