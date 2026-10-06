import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Calendar } from '@/components/calendar/Calendar';
import { DayChanges } from '@/components/calendar/DayChanges';
import { DayEvents } from '@/components/calendar/DayEvents';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { useSettingsStore } from '@/stores';
import { useOverlayPresence } from '@/components/overlays/useOverlayPresence';
import { applyImpactOrigin } from '@/lib/impactOrigin';
import { formatShortcut } from '@/lib/shortcuts';
import { CloseButton } from '@/components/ui/CloseButton';
import { isMobilePlatform } from '@/lib/platform';

interface AgendaOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AgendaOverlay({ isOpen, onClose }: AgendaOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const showCalendarWidget = useSettingsStore((state) => state.showCalendarWidget);
  const calendarVisible = isMobilePlatform() || showCalendarWidget;
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
        zIndex: 'var(--z-overlay)',
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
        className="app-overlay-section app-overlay-header"
        style={
          {
            '--index': 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '24px',
            paddingBottom: '18px',
            borderBottom: '1px solid var(--border-default)',
          } as CSSProperties
        }
      >
        <div>
          <h1
            className="app-overlay-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: '28px',
              fontWeight: 500,
              letterSpacing: '-0.015em',
            }}
          >
            Agenda
          </h1>
        </div>
        <CloseButton
          onClick={onClose}
          label="Close Agenda"
          shortcut={`Esc, ${formatShortcut('⌘⌥\\')}`}
        />
      </header>

      <div
        className="app-agenda-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          minHeight: 0,
          flex: 1,
          gap: '32px',
          paddingTop: '24px',
        }}
      >
        <section
          className="app-overlay-section app-agenda-calendar"
          style={
            {
              '--index': 1,
              minWidth: 0,
              minHeight: 0,
              overflowY: 'auto',
              padding: '0 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '28px',
            } as CSSProperties
          }
          aria-label="Calendar"
        >
          {calendarVisible && <Calendar onNavigate={onClose} />}
          <DayEvents />
        </section>

        <section
          className="app-overlay-section app-agenda-timeline"
          style={
            {
              '--index': 2,
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              borderLeft: '1px solid var(--border-default)',
              paddingLeft: '32px',
            } as CSSProperties
          }
          aria-label="Changed on this day"
        >
          <DayChanges onNavigate={onClose} />
        </section>
      </div>
    </div>
  );
}
