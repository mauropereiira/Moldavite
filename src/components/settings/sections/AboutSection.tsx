/** AboutSection: version and what's new, software updates, and help. */

import { useState, useEffect } from 'react';
import { Download, ExternalLink, Keyboard, RefreshCw, Sparkles } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useUpdateStore, useSettingsStore, useWhatsNewStore } from '@/stores';
import { getReleaseNotes } from '@/lib/releaseNotes';
import { formatShortcut } from '@/lib/shortcuts';
import { isMobilePlatform } from '@/lib/platform';
import { Group, Row, ToggleRow } from '../common';
import { openShortcutHelp } from '@/components/ShortcutHelpModal';
import { DotLoader } from '@/components/ui/DotLoader';
import { useToast } from '@/hooks/useToast';
import { safeInvoke } from '@/lib/ipc';
import { useSeasonalTouches } from '@/lib/seasons';

function SoftwareUpdates() {
  const {
    availableVersion,
    isChecking,
    lastCheckedAt,
    error,
    checkForUpdate,
    installUpdate,
    downloading,
    progress,
    autoCheck,
    setAutoCheck,
  } = useUpdateStore();

  return (
    <Group id="updates">
      <Row
        id="update-check"
        note={
          <>
            {availableVersion ? (
              <span className="settings-ok">Update available: v{availableVersion}</span>
            ) : isChecking ? (
              'Checking for updates...'
            ) : (
              <>
                You&apos;re up to date
                {lastCheckedAt && `. Last checked ${new Date(lastCheckedAt).toLocaleString()}`}
              </>
            )}
            {error && <span className="settings-error">{error}</span>}
            {downloading && (
              <span className="settings-progress" aria-label={`${progress}% downloaded`}>
                <span style={{ width: `${progress}%` }} />
              </span>
            )}
            <button
              type="button"
              className="settings-link pad-hover"
              onClick={() => shellOpen('https://github.com/mauropereiira/Moldavite/releases')}
            >
              <ExternalLink aria-hidden="true" className="w-3 h-3" />
              View releases on GitHub
            </button>
          </>
        }
      >
        {availableVersion ? (
          <button onClick={installUpdate} disabled={downloading} className="settings-btn">
            <Download aria-hidden="true" className="w-4 h-4" />
            {downloading ? 'Installing...' : 'Install update'}
          </button>
        ) : (
          <button onClick={checkForUpdate} disabled={isChecking} className="settings-btn">
            {isChecking ? (
              <DotLoader label="Checking for updates" />
            ) : (
              <RefreshCw aria-hidden="true" className="w-4 h-4" />
            )}
            {isChecking ? 'Checking...' : 'Check for updates'}
          </button>
        )}
      </Row>
      <ToggleRow id="auto-update" value={autoCheck} onChange={setAutoCheck} />
    </Group>
  );
}

export function AboutSection() {
  const toast = useToast();
  const mobile = isMobilePlatform();
  const [appVersion, setAppVersion] = useState<string>('');
  const season = useSeasonalTouches();
  const setHasSeenAppOnboarding = useSettingsStore((s) => s.setHasSeenAppOnboarding);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const openWhatsNew = useWhatsNewStore((s) => s.open);

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => setAppVersion('0.0.0'));
  }, []);

  const handleShowWhatsNew = () => {
    const entry = getReleaseNotes(appVersion);
    if (entry) {
      setIsSettingsOpen(false); // close settings so the popup is visible
      openWhatsNew(entry);
    }
  };

  const handleReplayOnboarding = () => {
    setHasSeenAppOnboarding(false);
    // Close settings so the onboarding modal is visible.
    setIsSettingsOpen(false);
  };

  return (
    <div className="settings-tab">
      <Group id="app">
        <Row
          id="version"
          note={
            appVersion ? `${appVersion}${season === 'autumn' ? ', Autumn edition' : ''}` : '...'
          }
          detail="Moldavite is a tektite: natural glass formed by a meteorite impact, found in Bohemia."
        >
          {!mobile && (
            <button type="button" onClick={handleShowWhatsNew} className="settings-btn">
              What&apos;s new
            </button>
          )}
        </Row>
      </Group>

      {!mobile && <SoftwareUpdates />}

      <Group id="help">
        <Row id="onboarding">
          <button type="button" onClick={handleReplayOnboarding} className="settings-btn">
            <Sparkles aria-hidden="true" className="w-4 h-4" />
            Show onboarding again
          </button>
        </Row>
        {/* A phone has no keyboard; an iPad with one still opens the sheet with ⌘/. */}
        {!mobile && (
          <Row
            id="shortcuts"
            detail={<span className="settings-path-block">Shortcut: {formatShortcut('⌘/')}</span>}
          >
            <button
              type="button"
              onClick={() => {
                setIsSettingsOpen(false);
                openShortcutHelp();
              }}
              className="settings-btn"
            >
              <Keyboard aria-hidden="true" className="w-4 h-4" />
              Show all shortcuts
            </button>
          </Row>
        )}
        {mobile && (
          <Row id="links">
            {[
              ['Privacy policy', 'privacy'],
              ['Support', 'support'],
            ].map(([text, page]) => (
              <button
                key={page}
                type="button"
                className="settings-btn"
                onClick={() =>
                  void safeInvoke('open_support_page', { page }).catch(() =>
                    toast.error(`Could not open ${text.toLowerCase()}.`)
                  )
                }
              >
                {text}
              </button>
            ))}
          </Row>
        )}
      </Group>
    </div>
  );
}
