import { useEffect, useState, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Calendar, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';

interface SidebarFooterProps {
  onToday: () => void;
  onNewNote: () => void;
  onSettings: () => void;
  /** Called with the anchor element so a TrashPopover can position itself. */
  onTrash: (anchor: HTMLElement | null) => void;
}

/**
 * Sidebar footer with four quick-action buttons arranged in two rows:
 *   [📅 Today]  [+ New]
 *   [⚙ Settings] [🗑 Trash]
 * The Trash button acts as the anchor for a TrashPopover managed by the parent.
 */
export function SidebarFooter({
  onToday,
  onNewNote,
  onSettings,
  onTrash,
}: SidebarFooterProps) {
  const [appVersion, setAppVersion] = useState<string>('');
  const trashBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

  const iconBtnStyle = {
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-muted)',
  } as const;

  const handleIconEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
    e.currentTarget.style.color = 'var(--text-primary)';
  };
  const handleIconLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
    e.currentTarget.style.color = 'var(--text-muted)';
  };

  return (
    <div style={{ borderTop: '1px solid var(--border-default)' }}>
      {/* Row 1: Today + New */}
      <div className="px-3 pt-3 pb-2 grid grid-cols-2 gap-2">
        <button
          onClick={onToday}
          className="btn btn-primary w-full py-2 focus-ring flex items-center justify-center gap-1.5"
        >
          <Calendar className="w-4 h-4" />
          <span>Today</span>
        </button>
        <button
          onClick={onNewNote}
          className="btn w-full py-2 focus-ring flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          <span>New</span>
        </button>
      </div>

      {/* Row 2: Settings + Trash */}
      <div className="px-3 pb-2 grid grid-cols-2 gap-2">
        <button
          onClick={onSettings}
          className="flex items-center justify-center gap-1.5 py-2 text-xs transition-colors"
          style={iconBtnStyle}
          onMouseEnter={handleIconEnter}
          onMouseLeave={handleIconLeave}
          title="Settings (⌘,)"
        >
          <SettingsIcon className="w-4 h-4" />
          <span>Settings</span>
        </button>
        <button
          ref={trashBtnRef}
          onClick={() => onTrash(trashBtnRef.current)}
          className="flex items-center justify-center gap-1.5 py-2 text-xs transition-colors"
          style={iconBtnStyle}
          onMouseEnter={handleIconEnter}
          onMouseLeave={handleIconLeave}
          title="Trash"
        >
          <Trash2 className="w-4 h-4" />
          <span>Trash</span>
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
