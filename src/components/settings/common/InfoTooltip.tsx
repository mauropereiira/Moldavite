/**
 * InfoTooltip — small (i) info icon that shows an explanatory popover on
 * hover/focus. The popover is rendered through a portal to document.body and
 * positioned with `position: fixed` from the trigger's bounding rect, so it is
 * never clipped by the Settings scroll container. It flips above the icon when
 * there isn't room below, and clamps horizontally to stay inside the viewport.
 */

import { useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export interface InfoTooltipProps {
  text: string;
}

const TOOLTIP_WIDTH = 260;
const GAP = 8;
const EDGE = 8;
/** Approx popover height used to decide whether to flip above. */
const FLIP_THRESHOLD = 140;

export function InfoTooltip({ text }: InfoTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' }>({
    top: 0,
    left: 0,
    placement: 'bottom',
  });
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!isVisible) return;

    const compute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      left = Math.max(EDGE, Math.min(left, vw - TOOLTIP_WIDTH - EDGE));
      const spaceBelow = vh - rect.bottom;
      const placement: 'top' | 'bottom' =
        spaceBelow < FLIP_THRESHOLD && rect.top > FLIP_THRESHOLD ? 'top' : 'bottom';
      const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - GAP;
      setPos({ top, left, placement });
    };

    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [isVisible]);

  return (
    <span className="inline-flex items-center ml-1.5">
      <button
        ref={triggerRef}
        type="button"
        className="p-0.5 rounded-full transition-all duration-200"
        style={{ color: 'var(--text-muted)', backgroundColor: 'transparent' }}
        onMouseEnter={(e) => {
          setIsVisible(true);
          e.currentTarget.style.color = 'var(--accent-primary)';
          e.currentTarget.style.backgroundColor = 'var(--accent-subtle)';
          e.currentTarget.style.transform = 'scale(1.1)';
        }}
        onMouseLeave={(e) => {
          setIsVisible(false);
          e.currentTarget.style.color = 'var(--text-muted)';
          e.currentTarget.style.backgroundColor = 'transparent';
          e.currentTarget.style.transform = 'scale(1)';
        }}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        aria-label="More information"
        aria-describedby={isVisible ? tooltipId : undefined}
      >
        <Info aria-hidden="true" className="w-3.5 h-3.5" />
      </button>
      {isVisible &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="px-3 py-2 text-xs"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_WIDTH,
              transform: pos.placement === 'top' ? 'translateY(-100%)' : undefined,
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)',
              color: 'var(--text-secondary)',
              zIndex: 10000,
              whiteSpace: 'normal',
              pointerEvents: 'none',
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
}
