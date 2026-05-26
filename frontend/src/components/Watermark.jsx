/**
 * Watermark — tiled logo pattern stamped across an entire surface.
 *
 * variant="page"  — fixed full-viewport overlay (AppShell, behind all content)
 * variant="modal" — absolute fill inside a modal panel (needs position:relative on parent)
 */
export default function Watermark({ variant = 'page' }) {
  const shared = {
    backgroundImage:    'url(/logo.png)',
    backgroundRepeat:   'repeat',
    backgroundSize:     '52px 52px',
    opacity:            0.028,
    pointerEvents:      'none',
    userSelect:         'none',
  };

  if (variant === 'page') {
    return (
      <div
        aria-hidden="true"
        style={{
          ...shared,
          position: 'fixed',
          inset:    0,
          zIndex:   0,
        }}
      />
    );
  }

  // modal — sits inside the panel, clipped to its rounded corners, behind all content
  return (
    <div
      aria-hidden="true"
      style={{
        ...shared,
        position:     'absolute',
        inset:        0,
        borderRadius: 'inherit',
        overflow:     'hidden',
        zIndex:       -1,
      }}
    />
  );
}
