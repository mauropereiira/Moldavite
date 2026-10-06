import { useEffect, useState } from 'react';
import { useForgeStore } from '@/stores';
import { openForgeInFinder } from '@/lib/fileSystem';
import { isMobilePlatform } from '@/lib/platform';
import { InfoTooltip } from './common/InfoTooltip';
import { Toggle } from './common/Toggle';

const LABEL = 'Synced Forge (iCloud)';

/**
 * The iCloud Forge switch, in General and in Manage Forges. It draws its own
 * Settings row rather than using `Row`, which would pull every Settings label
 * into the main bundle with it; settingsMap.test checks the label matches.
 */
export default function SyncedForgeControl() {
  const { forges, loadForges, setSyncedForge } = useForgeStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadForges().catch(() => undefined);
  }, [loadForges]);
  const synced = forges.find((forge) => forge.isSynced);
  if (!synced) return null;

  const connect = (on: boolean) => {
    setBusy(true);
    setError(null);
    void setSyncedForge(on)
      .catch((error) => setError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };

  const note = (busy || error || (synced.isActive && !synced.path)) && (
    <div className="settings-row-note">
      {busy && <span role="status">Connecting...</span>}
      {error && <span role="alert">{error}</span>}
      {synced.isActive && !synced.path && (
        <span role="status">
          iCloud is unavailable. Your local Forges can still be opened from Index.{' '}
          <button
            type="button"
            className="settings-link pad-hover-inline"
            disabled={busy}
            onClick={() => connect(true)}
          >
            Reconnect iCloud
          </button>
        </span>
      )}
    </div>
  );

  return (
    <div className="settings-row" data-setting="synced-forge">
      <div className="settings-row-text">
        <div className="settings-row-label">
          <span>{LABEL}</span>
          <InfoTooltip
            label={LABEL}
            text="One Forge shared through iCloud Drive with your other Apple devices. Turn it on there too. Your local Forges stay separate."
          />
        </div>
        {note}
      </div>
      <div className="settings-row-control">
        {!isMobilePlatform() && synced.isActive && synced.path && (
          <button
            type="button"
            className="settings-btn"
            onClick={() => void openForgeInFinder().catch((error) => setError(String(error)))}
          >
            Open synced folder in Finder
          </button>
        )}
        <Toggle
          enabled={synced.isActive}
          onChange={() => connect(!synced.isActive)}
          ariaLabel="Use synced Forge"
          disabled={busy}
        />
      </div>
    </div>
  );
}
