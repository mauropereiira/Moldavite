/**
 * WhatsNewModal — shows compact release highlights after an app update.
 *
 * Always mounted (in App). On mount it compares the running version to the
 * persisted lastSeenVersion and opens itself when the running version is newer
 * and has a CHANGELOG entry (never on first launch). Re-openable from
 * Settings → About via useWhatsNewStore.open().
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { SignatureMark } from '@/components/ui/SignatureMark';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { shouldShowWhatsNew } from '@/lib/changelog';
import { getReleaseNotes } from '@/lib/releaseNotes';
import { useWhatsNewStore } from '@/stores/whatsNewStore';

const RELEASES_URL = 'https://github.com/mauropereiira/Moldavite/releases';

export function WhatsNewModal() {
  const { isOpen, entry, open, close, markSeen } = useWhatsNewStore();
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(dialogRef, isOpen);

  const handleClose = useCallback(() => {
    setExpandedVersion(null);
    close();
  }, [close]);

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

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      handleClose();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleClose, isOpen]);

  if (!isOpen || !entry) return null;

  const headlineGroups = entry.groups.filter((group) => group.title.toLowerCase() !== 'fixed');
  const fixedItems = entry.groups
    .filter((group) => group.title.toLowerCase() === 'fixed')
    .flatMap((group) => group.items);
  const fixesExpanded = expandedVersion === entry.version;
  const fixesLabel = `${fixedItems.length} ${fixedItems.length === 1 ? 'fix' : 'fixes'}`;

  return (
    <div
      className="wn-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="wn-dialog wn-enter"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wn-title"
      >
        <div className="wn-body">
          <header className="wn-hero">
            <h2
              id="wn-title"
              className="wn-version"
              aria-label={`What's new in version ${entry.version}`}
            >
              {entry.version}
            </h2>
            {entry.date && (
              <div className="wn-date">
                <SignatureMark size={12} />
                <span>Released {entry.date}</span>
              </div>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="wn-close"
              aria-label="Close what's new"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>

          {headlineGroups.map((group) => (
            <section key={group.title} className="wn-section">
              <h3 className="wn-label">{group.title}</h3>
              <ul className="wn-list">
                {group.items.map((item, index) => (
                  <li key={`${item.headline}-${index}`} className="wn-headline">
                    {item.headline}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {fixedItems.length > 0 && (
            <section className="wn-fixed-section">
              <button
                type="button"
                className="wn-fixed-toggle"
                onClick={() =>
                  setExpandedVersion((current) =>
                    current === entry.version ? null : entry.version
                  )
                }
                aria-expanded={fixesExpanded}
                aria-controls="wn-fixes"
                aria-label={fixesLabel}
              >
                <span className="wn-label">Fixed</span>
                <span className="wn-fix-count">
                  {fixesLabel}
                  <span className="wn-caret" aria-hidden="true" />
                </span>
              </button>
              {fixesExpanded && (
                <ul id="wn-fixes" className="wn-list wn-fixes-list">
                  {fixedItems.map((item, index) => (
                    <li key={`${item.headline}-${index}`} className="wn-headline">
                      {item.headline}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <footer className="wn-footer">
          <button
            type="button"
            onClick={() => void shellOpen(RELEASES_URL)}
            className="wn-release-link"
          >
            Full release notes
          </button>
          <button type="button" onClick={handleClose} className="wn-dismiss">
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
