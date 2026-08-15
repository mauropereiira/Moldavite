import { useEffect, useState, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { selectHasPendingUpdate, useGraphStore, useTimelineStore, useUpdateStore } from '@/stores';
import { formatShortcut } from '@/lib/shortcuts';

interface SidebarFooterProps {
  onToday: () => void;
  onNewNote: () => void;
  onSettings: () => void;
  /** Called with the anchor element so a TrashPopover can position itself. */
  onTrash: (anchor: HTMLElement | null) => void;
}

/**
 * Sidebar footer with typographic quick actions in two compact rows.
 * The Trash button acts as the anchor for a TrashPopover managed by the parent.
 */
export function SidebarFooter({ onToday, onNewNote, onSettings, onTrash }: SidebarFooterProps) {
  const [appVersion, setAppVersion] = useState<string>('');
  const trashBtnRef = useRef<HTMLButtonElement>(null);
  const { isOpen: isTimelineOpen, toggle: toggleTimeline } = useTimelineStore();
  const { isOpen: isGraphOpen, toggle: toggleGraph } = useGraphStore();
  const hasPendingUpdate = useUpdateStore(selectHasPendingUpdate);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('0.0.0'));
  }, []);

  const linkStyle = {
    color: 'var(--text-muted)',
    fontSize: '11px',
  } as const;

  const handleLinkEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = 'var(--text-primary)';
  };
  const handleLinkLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = 'var(--text-muted)';
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-default)' }}>
      <div
        className="mx-3 flex items-center"
        style={{ borderBottom: '1px solid var(--border-muted)' }}
      >
        <button
          type="button"
          onClick={onToday}
          className="text-link w-1/2 py-2 text-xs focus-ring transition-colors"
          style={{ color: 'var(--text-secondary)', borderRight: '1px solid var(--border-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          Today
        </button>
        <button
          type="button"
          onClick={onNewNote}
          className="text-link w-1/2 py-2 text-xs focus-ring transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          New
        </button>
      </div>

      <div className="px-3 py-3 flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={toggleTimeline}
          className="text-link transition-colors"
          style={{
            ...linkStyle,
            color: isTimelineOpen ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: isTimelineOpen ? 500 : 400,
          }}
          onMouseEnter={(e) => {
            if (!isTimelineOpen) handleLinkEnter(e);
          }}
          onMouseLeave={(e) => {
            if (!isTimelineOpen) handleLinkLeave(e);
          }}
          title="Timeline"
          aria-pressed={isTimelineOpen}
          aria-label="Toggle timeline"
        >
          Timeline
        </button>
        <span aria-hidden="true" style={{ color: 'var(--border-strong)', fontSize: '11px' }}>
          ·
        </span>
        <button
          type="button"
          onClick={toggleGraph}
          className="text-link transition-colors"
          style={{
            ...linkStyle,
            color: isGraphOpen ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: isGraphOpen ? 500 : 400,
          }}
          onMouseEnter={(e) => {
            if (!isGraphOpen) handleLinkEnter(e);
          }}
          onMouseLeave={(e) => {
            if (!isGraphOpen) handleLinkLeave(e);
          }}
          title={`Graph view (${formatShortcut('⌘⇧G')})`}
          aria-pressed={isGraphOpen}
          aria-label="Toggle graph view"
        >
          Graph
        </button>
        <span aria-hidden="true" style={{ color: 'var(--border-strong)', fontSize: '11px' }}>
          ·
        </span>
        <button
          type="button"
          onClick={onSettings}
          className="text-link transition-colors"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
          title={`Settings (${formatShortcut('⌘,')})`}
          aria-label={hasPendingUpdate ? 'Open settings (update available)' : 'Open settings'}
        >
          Settings
        </button>
        <span aria-hidden="true" style={{ color: 'var(--border-strong)', fontSize: '11px' }}>
          ·
        </span>
        <button
          type="button"
          ref={trashBtnRef}
          onClick={() => onTrash(trashBtnRef.current)}
          className="text-link transition-colors"
          style={linkStyle}
          onMouseEnter={handleLinkEnter}
          onMouseLeave={handleLinkLeave}
          title="Trash"
          aria-label="Open trash"
        >
          Trash
        </button>
      </div>

      {/* App Info */}
      <div className="px-3 pb-3 flex flex-col items-center">
        <div className="text-center">
          <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
            MOLDAVITE
          </p>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            v{appVersion || '...'}
          </p>
        </div>
      </div>
    </div>
  );
}
