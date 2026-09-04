import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Calendar } from '@/components/calendar/Calendar';
import { Timeline } from '@/components/calendar/Timeline';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSettingsStore } from '@/stores';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { applyImpactOrigin } from '@/lib/impactOrigin';
import { formatShortcut } from '@/lib/shortcuts';

interface AgendaOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgendaOverlay({ isOpen, onClose }: AgendaOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { showCalendarWidget, showTimelineWidget } = useSettingsStore();
  const { isRendered, isClosing } = useOverlayPresence(isOpen);

  useLayoutEffect(() => {
    if (isOpen) applyImpactOrigin(overlayRef.current);
  }, [isOpen]);

  useFocusTrap(overlayRef, isOpen && isRendered);

  if (!isRendered) return null;

  return (
    <div
      ref={overlayRef}
      className={`app-overlay impact-surface app-agenda-overlay${isClosing ? ' app-overlay-closing' : ''}`}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        padding: '28px 32px 24px',
        backgroundColor: 'var(--bg-base)',
        color: 'var(--text-primary)',
      }}
      role="region"
      aria-label="Agenda"
      tabIndex={-1}
    >
      <header
        className="app-overlay-section"
        style={
          {
            '--index': 0,
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '24px',
            paddingBottom: '18px',
            borderBottom: '1px solid var(--border-default)',
          } as CSSProperties
        }
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 500,
              letterSpacing: '-0.015em',
            }}
          >
            Agenda
          </h1>
          <p
            style={{
              marginTop: '4px',
              color: 'var(--text-muted)',
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            {formatShortcut('⌘⌥\\')} · Esc closes
          </p>
        </div>
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
          aria-label="Close Agenda"
          title="Close Agenda (Esc)"
        >
          ×
        </button>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          minHeight: 0,
          flex: 1,
          gap: '32px',
          paddingTop: '24px',
        }}
      >
        {showCalendarWidget && (
          <section
            className="app-overlay-section"
            style={
              {
                '--index': 1,
                minWidth: 0,
                minHeight: 0,
                overflowY: 'auto',
                padding: '0 12px',
              } as CSSProperties
            }
            aria-label="Month calendar"
          >
            <Calendar onNavigate={onClose} />
          </section>
        )}

        {showTimelineWidget && (
          <section
            className="app-overlay-section"
            style={
              {
                '--index': 2,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderLeft: showCalendarWidget ? '1px solid var(--border-default)' : undefined,
                paddingLeft: showCalendarWidget ? '32px' : undefined,
              } as CSSProperties
            }
            aria-label="Event timeline"
          >
            <Timeline />
          </section>
        )}

        {!showCalendarWidget && !showTimelineWidget && (
          <p
            className="app-overlay-section"
            style={
              {
                '--index': 1,
                color: 'var(--text-muted)',
                fontSize: '13px',
              } as CSSProperties
            }
          >
            Enable the calendar or timeline in Settings → Features.
          </p>
        )}
      </div>
    </div>
  );
}
