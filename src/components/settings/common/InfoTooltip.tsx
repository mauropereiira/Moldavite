/**
 * InfoTooltip: the (i) beside a Settings label. A mouse shows the text on
 * hover, the keyboard on focus, and a tap or click keeps it open until the
 * next click elsewhere or Escape. Escape closes only the popover, never
 * Settings behind it.
 *
 * The popover is portaled to document.body and placed with `position: fixed`
 * from the trigger's rect, so the Settings scroll container never clips it. It
 * flips above the icon when there isn't room below and clamps to the viewport.
 */

import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

export interface InfoTooltipProps {
  text: ReactNode;
  /** The setting this explains; names the button "About <label>". */
  label?: string;
}

const TOOLTIP_WIDTH = 280;
const GAP = 8;
const EDGE = 8;
/** Approx popover height used to decide whether to flip above. */
const FLIP_THRESHOLD = 140;

export function InfoTooltip({ text, label }: InfoTooltipProps) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const isVisible = hovered || pinned;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, above: false });
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!isVisible) return;

    const compute = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2;
      left = Math.max(EDGE, Math.min(left, window.innerWidth - TOOLTIP_WIDTH - EDGE));
      const above = window.innerHeight - rect.bottom < FLIP_THRESHOLD && rect.top > FLIP_THRESHOLD;
      setPos({ top: above ? rect.top - GAP : rect.bottom + GAP, left, above });
    };

    compute();
    window.addEventListener('scroll', compute, true);
    window.addEventListener('resize', compute);
    return () => {
      window.removeEventListener('scroll', compute, true);
      window.removeEventListener('resize', compute);
    };
  }, [isVisible]);

  // WebKit does not focus a clicked button, so blur cannot unpin it.
  useEffect(() => {
    if (!pinned) return;
    const unpin = (event: Event) => {
      if (!triggerRef.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', unpin);
    return () => document.removeEventListener('pointerdown', unpin);
  }, [pinned]);

  const hide = () => {
    setHovered(false);
    setPinned(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="settings-info"
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={hide}
        onClick={() => setPinned(!pinned)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !isVisible) return;
          e.stopPropagation();
          hide();
        }}
        aria-label={label ? `About ${label}` : 'More information'}
        aria-expanded={isVisible}
        aria-describedby={isVisible ? tooltipId : undefined}
      >
        <Info aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={1.25} />
      </button>
      {isVisible &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="settings-info-pop"
            style={{
              top: pos.top,
              left: pos.left,
              width: TOOLTIP_WIDTH,
              transform: pos.above ? 'translateY(-100%)' : undefined,
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </>
  );
}
