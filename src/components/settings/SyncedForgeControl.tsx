import { useEffect, useState } from 'react';
import { useForgeStore } from '@/stores';
import { openForgeInFinder } from '@/lib/fileSystem';
import { isMobilePlatform } from '@/lib/platform';

export default function SyncedForgeControl() {
  const { forges, loadForges, setSyncedForge } = useForgeStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadForges().catch(() => undefined);
  }, [loadForges]);
  const synced = forges.find((forge) => forge.isSynced);
  if (!synced) return null;

  const change = async () => {
    setBusy(true);
    setError(null);
    try {
      await setSyncedForge(!synced.isActive);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border-default)' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">Synced Forge (iCloud Drive)</span>
        <button
          type="button"
          role="switch"
          aria-label="Use synced Forge"
          aria-checked={synced.isActive}
          disabled={busy}
          onClick={() => void change()}
          className="btn min-h-11 text-xs px-3 py-2 shrink-0"
        >
          {busy ? 'Connecting…' : synced.isActive ? 'On' : 'Off'}
        </button>
      </div>
      {error && (
        <p className="text-xs mt-2" role="alert" style={{ color: 'var(--text-primary)' }}>
          {error}
        </p>
      )}
      {synced.isActive && !synced.path && (
        <div className="mt-2 text-xs" role="status" style={{ color: 'var(--text-muted)' }}>
          iCloud is unavailable. Your local Forges can still be opened from Index.
          <button
            type="button"
            className="btn min-h-11 mt-2"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void setSyncedForge(true)
                .catch((error) => setError(String(error)))
                .finally(() => setBusy(false));
            }}
          >
            Reconnect iCloud
          </button>
        </div>
      )}
      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        Turn on to create or open your iCloud Forge on this device. Notes added here will also be
        available on your other Apple devices when you turn it on there. Your local Forges stay
        separate.
      </p>
      {!isMobilePlatform() && synced.isActive && synced.path && (
        <button
          type="button"
          className="btn min-h-11 mt-2 text-xs"
          onClick={() => void openForgeInFinder().catch((error) => setError(String(error)))}
        >
          Open synced folder in Finder
        </button>
      )}
    </div>
  );
}
