import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  SHORTCUTS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  type Shortcut,
  type ShortcutCategory,
} from '@/lib/shortcuts';

interface ShortcutHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Self-contained host for the shortcut help modal. Listens globally for
 * Cmd+/ (and Cmd+?) and toggles the modal. Mount once near the app root.
 *
 * We keep the listener here rather than in `useKeyboardShortcuts` because
 * that hook is owned by the editor tree, which isn't always mounted; the
 * help shortcut should be available anywhere.
 */
export function ShortcutHelpHost() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (isMod && (key === '/' || key === '?')) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return <ShortcutHelpModal isOpen={isOpen} onClose={() => setIsOpen(false)} />;
}

/**
 * Displays every shortcut registered in `src/lib/shortcuts.ts`, grouped by
 * category. Triggered by the `shortcutHelp` shortcut (Cmd+/ or Cmd+?).
 *
 * The modal renders shortcuts as discrete key caps for readability.
 */
export function ShortcutHelpModal({ isOpen, onClose }: ShortcutHelpModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const grouped = useMemo(() => {
    const byCategory = new Map<ShortcutCategory, Shortcut[]>();
    for (const s of SHORTCUTS) {
      const list = byCategory.get(s.category) ?? [];
      list.push(s);
      byCategory.set(s.category, list);
    }
    return byCategory;
  }, []);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcut-help-title"
    >
      <div
        className="w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <h2
            id="shortcut-help-title"
            className="text-lg font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            Keyboard Shortcuts
          </h2>
          <button
            onClick={onClose}
            className="p-1 transition-colors focus-ring"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close shortcut help"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {CATEGORY_ORDER.map((category) => {
            const items = grouped.get(category);
            if (!items || items.length === 0) return null;
            return (
              <section key={category}>
                <h3
                  className="text-xs uppercase tracking-wider font-semibold mb-3"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  {CATEGORY_LABELS[category]}
                </h3>
                <ul className="space-y-2">
                  {items.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center justify-between gap-4 py-1.5"
                    >
                      <span
                        className="text-sm"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {s.description}
                      </span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {s.keys.map((k, idx) => (
                          <span key={`${s.id}-${idx}`} className="flex items-center gap-1">
                            <kbd
                              className="px-2 py-0.5 text-xs font-mono font-medium"
                              style={{
                                backgroundColor: 'var(--bg-elevated)',
                                border: '1px solid var(--border-default)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-primary)',
                                minWidth: '1.5rem',
                                textAlign: 'center',
                              }}
                            >
                              {k}
                            </kbd>
                            {idx < s.keys.length - 1 && (
                              <span
                                className="text-xs"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                +
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        {/* Footer hint */}
        <div
          className="px-6 py-3 text-xs"
          style={{
            borderTop: '1px solid var(--border-default)',
            color: 'var(--text-muted)',
          }}
        >
          Press <kbd
            className="px-1.5 py-0.5 font-mono"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)',
            }}
          >Esc</kbd> to close
        </div>
      </div>
    </div>,
    document.body,
  );
}
