import { useLayoutEffect, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { applyImpactOrigin } from '@/lib/impactOrigin';
import { formatShortcut } from '@/lib/shortcuts';

interface IndexOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function IndexOverlay({ isOpen, onClose }: IndexOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { isRendered, isClosing } = useOverlayPresence(isOpen);

  useLayoutEffect(() => {
    if (isOpen) applyImpactOrigin(overlayRef.current);
  }, [isOpen]);

  useFocusTrap(overlayRef, isOpen && isRendered);

  if (!isRendered) return null;

  return (
    <div
      ref={overlayRef}
      className={`app-overlay impact-surface app-index-overlay${isClosing ? ' app-overlay-closing' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: 'var(--bg-base)',
        color: 'var(--text-primary)',
      }}
      role="region"
      aria-label="Index"
      tabIndex={-1}
    >
      {/* Hint and close button in one row, anchored top-right.
          They have been wrong twice: first as two separately positioned
          elements 32px apart, which read as one crowded object on a narrow
          window; then with the hint moved to the top-left, where it landed on
          top of the Forge name in the sidebar's own header. Neither had a
          reason to be independently positioned. As a flex row they keep their
          gap whatever the text, and they stay out of the header entirely. */}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '24px',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          gap: '16px',
        }}
      >
        <span
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)',
            fontSize: '10px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {formatShortcut('⌘\\')} · Esc closes
        </span>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-display)',
            fontSize: '24px',
            lineHeight: 1,
          }}
          aria-label="Close Index"
          title="Close Index (Esc)"
        >
          ×
        </button>
      </div>

      <Sidebar presentation="index" autoFocusSearch onNavigate={onClose} />
    </div>
  );
}
