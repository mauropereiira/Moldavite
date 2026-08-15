import { useLayoutEffect, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { applyImpactOrigin } from '@/lib/impactOrigin';

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
      <button
        type="button"
        onClick={onClose}
        className="focus-ring"
        style={{
          position: 'absolute',
          top: '20px',
          right: '24px',
          zIndex: 2,
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

      <Sidebar presentation="index" autoFocusSearch onNavigate={onClose} />

      <p
        style={{
          position: 'absolute',
          right: '56px',
          top: '24px',
          color: 'var(--text-muted)',
          fontSize: '10px',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        ⌘\ · Esc closes
      </p>
    </div>
  );
}
