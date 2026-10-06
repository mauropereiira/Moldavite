import { useState } from 'react';
import { BannerAction, bannerStyle } from './BannerAction';
import { useToast } from '@/hooks/useToast';
import { isLooseNote } from '@/lib/looseId';
import { saveLooseCopy } from '@/lib/looseFiles';
import { retryFailedSave, saveFailedNoteAsCopy } from '@/lib/leaveSave';
import { useNoteStore } from '@/stores/noteStore';
import { useSaveFailureStore } from '@/stores/saveFailureStore';

/**
 * The open note's last save did not reach disk. This is the one place a failed
 * save shows while its note is on screen; it goes once a save of the note works.
 */
export function SaveFailedBanner() {
  const currentNote = useNoteStore((state) => state.currentNote);
  const reason = useSaveFailureStore((state) =>
    currentNote ? state.failures[currentNote.id] : undefined
  );
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!currentNote || reason === undefined) return null;
  const noteId = currentNote.id;
  const loose = isLooseNote(currentNote);

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

  const saveCopy = loose
    ? async () => {
        const name = await saveLooseCopy(currentNote);
        if (name) toast.success(`Saved a copy as ${name}`);
      }
    : () => saveFailedNoteAsCopy(noteId);

  return (
    <div style={bannerStyle}>
      <span role="status" style={{ flex: '1 1 auto', color: 'var(--text-primary)' }}>
        {`Couldn't save this note: ${reason}. Your changes are kept here until it saves.`}
      </span>
      <BannerAction disabled={busy} onClick={() => void run(() => retryFailedSave(noteId))}>
        Try again
      </BannerAction>
      <BannerAction disabled={busy} onClick={() => void run(saveCopy)}>
        {loose ? 'Save a copy…' : 'Save as a copy'}
      </BannerAction>
    </div>
  );
}
