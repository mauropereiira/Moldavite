import { useOverlayStore, useSettingsStore } from '@/stores';
import { captureImpactOrigin } from '@/lib/impactOrigin';

const linkStyle = {
  color: 'var(--text-muted)',
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
} as const;

const divider = (
  <span aria-hidden="true" style={{ color: 'var(--border-strong)', fontSize: '10px' }}>
    ·
  </span>
);

export function EditorNavigation() {
  const { indexMode, agendaMode, setIsSettingsOpen } = useSettingsStore();
  const { openIndex, openAgenda, closeOverlay } = useOverlayStore();

  const openSettings = () => {
    closeOverlay();
    setIsSettingsOpen(true);
  };

  return (
    <nav
      className="editor-navigation-links"
      aria-label="App navigation"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '14px',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transform: 'translateX(-50%)',
      }}
    >
      {indexMode !== 'off' && (
        <>
          <button
            type="button"
            onClick={(event) => {
              if (indexMode === 'overlay') captureImpactOrigin(event.currentTarget);
              openIndex(indexMode === 'pinned');
            }}
            className="text-link"
            style={linkStyle}
          >
            Index
          </button>
          {divider}
        </>
      )}
      {agendaMode !== 'off' && (
        <>
          <button
            type="button"
            onClick={(event) => {
              if (agendaMode === 'overlay') captureImpactOrigin(event.currentTarget);
              openAgenda(agendaMode === 'pinned');
            }}
            className="text-link"
            style={linkStyle}
          >
            Agenda
          </button>
          {divider}
        </>
      )}
      <button type="button" onClick={openSettings} className="text-link" style={linkStyle}>
        Settings
      </button>
    </nav>
  );
}
