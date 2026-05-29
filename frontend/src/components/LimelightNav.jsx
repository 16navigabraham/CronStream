import { useState, useRef, useLayoutEffect, cloneElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * LimelightNav - animated bottom nav bar with a glowing limelight indicator.
 * Adapted from the limelight-nav component to work with React Router NavLinks.
 */
export function LimelightNav({ items = [], className = '' }) {
  const location = useLocation();
  const navigate  = useNavigate();

  // Derive active index from current route
  const activeIndex = (() => {
    const idx = items.findLastIndex(item => item.to && location.pathname.startsWith(item.to));
    return idx >= 0 ? idx : 0;
  })();

  const [isReady, setIsReady]   = useState(false);
  const itemRefs    = useRef([]);
  const limelightRef = useRef(null);

  useLayoutEffect(() => {
    if (!items.length) return;
    const limelight  = limelightRef.current;
    const activeItem = itemRefs.current[activeIndex];
    if (!limelight || !activeItem) return;

    const newLeft = activeItem.offsetLeft + activeItem.offsetWidth / 2 - limelight.offsetWidth / 2;
    limelight.style.left = `${newLeft}px`;
    if (!isReady) setTimeout(() => setIsReady(true), 50);
  }, [activeIndex, isReady, items]);

  return (
    <nav className={`relative inline-flex items-center h-16 w-full ${className}`}>
      {items.map(({ id, icon, label, to, onClick }, index) => {
        const isActive = index === activeIndex;
        return (
          <button
            key={id}
            ref={el => (itemRefs.current[index] = el)}
            onClick={() => {
              if (to) navigate(to);
              onClick?.();
            }}
            aria-label={label}
            className="relative z-20 flex-1 h-full flex flex-col items-center justify-center gap-1 cursor-pointer"
          >
            {cloneElement(icon, {
              className: `w-5 h-5 transition-all duration-200 ${
                isActive ? 'opacity-100 text-accent' : 'opacity-35 text-white'
              }`,
              strokeWidth: isActive ? 2.5 : 1.8,
            })}
            {label && (
              <span className={`text-[10px] font-medium transition-all duration-200 ${
                isActive ? 'text-accent opacity-100' : 'text-white opacity-35'
              }`}>
                {label}
              </span>
            )}
          </button>
        );
      })}

      {/* Limelight indicator */}
      <div
        ref={limelightRef}
        style={{ left: '-999px' }}
        className={`absolute top-0 z-10 w-10 h-[3px] rounded-full bg-accent
          shadow-[0_0_12px_2px_rgba(124,58,237,0.8)]
          ${isReady ? 'transition-[left] duration-300 ease-in-out' : ''}`}
      >
        {/* Cone glow beneath the bar */}
        <div className="absolute left-[-40%] top-[3px] w-[180%] h-14
          [clip-path:polygon(10%_100%,28%_0,72%_0,90%_100%)]
          bg-gradient-to-b from-accent/25 to-transparent pointer-events-none" />
      </div>
    </nav>
  );
}
