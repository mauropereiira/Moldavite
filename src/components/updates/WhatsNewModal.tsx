/**
 * WhatsNewModal — shows release notes after the app updates to a new version.
 *
 * Always mounted (in App). On mount it compares the running version to the
 * persisted lastSeenVersion and opens itself when the running version is newer
 * and has a CHANGELOG entry (never on first launch). Re-openable from
 * Settings → About via useWhatsNewStore.open().
 */
import { useEffect, useRef } from 'react';
import { Sparkles, X } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { useWhatsNewStore } from '@/stores/whatsNewStore';
import { getReleaseNotes } from '@/lib/releaseNotes';
import { shouldShowWhatsNew } from '@/lib/changelog';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export function WhatsNewModal() {
  const { isOpen, entry, open, close, markSeen } = useWhatsNewStore();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, isOpen);

  // Launch check: show notes once per upgrade. Never blocks app startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const current = await getVersion();
        const releaseEntry = getReleaseNotes(current);
        const lastSeen = useWhatsNewStore.getState().lastSeenVersion;
        if (
          !cancelled &&
          shouldShowWhatsNew({
            lastSeenVersion: lastSeen,
            currentVersion: current,
            hasEntry: !!releaseEntry,
          }) &&
          releaseEntry
        ) {
          open(releaseEntry);
        }
        if (!cancelled) markSeen(current);
      } catch (err) {
        console.error('[whatsNew] launch check failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isOpen || !entry) return null;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md mx-4 max-h-[80vh] flex flex-col modal-elevated modal-content-enter"
        style={{ borderRadius: 'var(--radius-md)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2">
            <Sparkles aria-hidden="true" className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
            <h2 id="whats-new-title" className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              What&apos;s New in v{entry.version}
            </h2>
          </div>
          <button
            onClick={close}
            className="p-1 transition-colors"
            style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
            aria-label="Close what's new"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {entry.date && (
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {entry.date}
            </p>
          )}
          {entry.groups.map((group) => (
            <div key={group.title} className="space-y-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--accent-primary)' }}>
                {group.title}
              </h3>
              <ul className="space-y-1.5">
                {group.items.map((item, i) => (
                  <li
                    key={i}
                    className="text-sm flex gap-2"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span aria-hidden="true" style={{ color: 'var(--accent-primary)' }}>
                      •
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border-default)' }}>
          <button
            onClick={close}
            className="px-4 py-2 text-sm font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--accent-primary)', borderRadius: 'var(--radius-sm)' }}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
