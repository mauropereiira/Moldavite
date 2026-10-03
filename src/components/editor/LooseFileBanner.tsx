import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { isLooseNote } from '@/lib/looseId';
import {
  keepMineLooseNote,
  reloadLooseNote,
  saveLooseCopy,
  useLooseStatusStore,
} from '@/lib/looseFiles';
import { useNoteStore } from '@/stores/noteStore';

const actionStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  padding: 0,
  width: 'auto',
  font: 'inherit',
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

/** What a file outside the Forge did on disk while it was open, and the ways out. */
export function LooseFileBanner() {
  const currentNote = useNoteStore((state) => state.currentNote);
  const status = useLooseStatusStore((state) =>
    currentNote ? state.status[currentNote.id] : undefined
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!currentNote || !isLooseNote(currentNote) || !status) return null;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const saveCopy = () =>
    run(async () => {
      const name = await saveLooseCopy(currentNote);
      if (name) toast.success(`Saved a copy as ${name}`);
    });

  return (
    <div
      role="status"
      className="loose-file-banner"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'baseline',
        gap: '6px 16px',
        padding: '8px 20px',
        borderBottom: '1px solid var(--border-default)',
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}
    >
      <span style={{ flex: '1 1 auto' }}>
        {status === 'moved'
          ? 'This file was moved or deleted. Your text is still here.'
          : 'This file changed on disk since you opened it.'}
      </span>
      {status === 'changed' && (
        <>
          <button
            type="button"
            style={actionStyle}
            disabled={busy}
            onClick={() => void run(() => reloadLooseNote(currentNote))}
          >
            Reload
          </button>
          <button
            type="button"
            style={actionStyle}
            disabled={busy}
            onClick={() => void run(() => keepMineLooseNote(currentNote))}
          >
            Keep mine
          </button>
        </>
      )}
      <button type="button" style={actionStyle} disabled={busy} onClick={() => void saveCopy()}>
        Save a copy…
      </button>
    </div>
  );
}
