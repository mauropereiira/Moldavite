import { useLayoutEffect, useRef } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { applyImpactOrigin } from '@/lib/impactOrigin';
import { formatShortcut } from '@/lib/shortcuts';
import { CloseButton } from '@/components/ui/CloseButton';
import { isMobilePlatform } from '@/lib/platform';

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
      {/* Anchored top-right, level with the Forge name. The shortcut is in
          the tooltip, not a hint line, so nothing crowds the Forge name. */}
      <div
        className="app-overlay-controls"
        style={{ position: 'absolute', top: '16px', right: '20px', zIndex: 2 }}
      >
        <CloseButton
          onClick={onClose}
          label="Close Index"
          shortcut={`Esc, ${formatShortcut('⌘\\')}`}
        />
      </div>

      {/* Auto-focus would raise the keyboard over the list on a phone. */}
      <Sidebar presentation="index" autoFocusSearch={!isMobilePlatform()} onNavigate={onClose} />
    </div>
  );
}
