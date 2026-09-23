import { useState } from 'react';
import { useForgeStore } from '@/stores/forgeStore';
import { useForgeReadinessStore } from '@/lib/forgeReadiness';
import { DotLoader } from './DotLoader';

/** Stands in for the app while the synced Forge waits for iCloud at launch. */
export function ForgeReadinessScreen() {
  const { status, message } = useForgeReadinessStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reconnect = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await useForgeStore.getState().setSyncedForge(enabled);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'unavailable') {
    return (
      <div
        className="flex h-full flex-1 items-center justify-center"
        style={{ color: 'var(--text-muted)' }}
      >
        <DotLoader label="Opening your iCloud Forge" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center" role="alert">
        <h1 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
          iCloud isn&apos;t available right now
        </h1>
        {(error ?? message) && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {error ?? message}
          </p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn btn-primary min-h-11 focus-ring"
            disabled={busy}
            onClick={() => void reconnect(true)}
          >
            {busy ? 'Connecting…' : 'Try again'}
          </button>
          <button
            type="button"
            className="btn min-h-11 focus-ring"
            disabled={busy}
            onClick={() => void reconnect(false)}
          >
            Use local Forge
          </button>
        </div>
      </div>
    </div>
  );
}
