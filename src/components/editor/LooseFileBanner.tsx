import { BannerAction } from './BannerAction';
import { useState } from 'react';
import { useToast } from '@/hooks/useToast';
import { useNotes } from '@/hooks/useNotes';
import { isDroppedId, isLooseNote, isLooseViewOnly } from '@/lib/looseId';
import { formatShortcut } from '@/lib/shortcuts';
import {
  keepMineLooseNote,
  reloadLooseNote,
  saveLooseCopy,
  useLooseStatusStore,
} from '@/lib/looseFiles';
import { useNoteStore } from '@/stores/noteStore';

const bannerStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: '6px 16px',
  padding: '8px 20px',
  borderBottom: '1px solid var(--border-default)',
  fontSize: 13,
  color: 'var(--text-secondary)',
};

export function DroppedFileBanner() {
  const currentNote = useNoteStore((state) => state.currentNote);
  const { addFileToForge } = useNotes();
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!currentNote || !isDroppedId(currentNote.id)) return null;

  const addToForge = async () => {
    setBusy(true);
    try {
      await addFileToForge(currentNote);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={bannerStyle}>
      <span role="status" style={{ flex: '1 1 auto' }}>
        {`Moldavite couldn't find where this file lives, so it opened read-only. Use Open With or ${formatShortcut('⌘O')} to edit it.`}
      </span>
      <BannerAction disabled={busy} onClick={() => void addToForge()}>
        Add to Forge
      </BannerAction>
    </div>
  );
}

/** What a file outside the Forge did on disk while it was open, and the ways out. */
export function LooseFileBanner() {
  const currentNote = useNoteStore((state) => state.currentNote);
  const status = useLooseStatusStore((state) =>
    currentNote ? state.status[currentNote.id] : undefined
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!currentNote || !isLooseNote(currentNote) || isDroppedId(currentNote.id) || !status)
    return null;

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
    <div style={bannerStyle}>
      <span role="status" style={{ flex: '1 1 auto' }}>
        {status === 'moved'
          ? 'This file was moved or deleted. Your text is still here.'
          : 'This file changed on disk since you opened it.'}
      </span>
      {status === 'changed' && (
        <>
          <BannerAction
            disabled={busy}
            onClick={() => void run(() => reloadLooseNote(currentNote))}
          >
            Reload
          </BannerAction>
          {!isLooseViewOnly(currentNote) && (
            <BannerAction
              disabled={busy}
              onClick={() => void run(() => keepMineLooseNote(currentNote))}
            >
              Keep mine
            </BannerAction>
          )}
        </>
      )}
      <BannerAction disabled={busy} onClick={() => void saveCopy()}>
        Save a copy…
      </BannerAction>
    </div>
  );
}
