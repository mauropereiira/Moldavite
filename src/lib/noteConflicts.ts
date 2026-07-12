import { listNotes } from './fileSystem';
import type { NoteWriteResult } from './fileSystem';
// Import the concrete store modules (not the '@/stores' index) to avoid a
// module cycle: stores/index → noteColorsStore → '@/lib' → this file.
import { useNoteStore } from '@/stores/noteStore';
import { useToastStore } from '@/stores/toastStore';

/**
 * Surfaces an external-edit conflict to the user after a save.
 *
 * When `write_note` detects that the on-disk note changed since it was last
 * read (external editor, iCloud/Dropbox/Syncthing/git sync…), it preserves
 * the disk version as a sibling conflict copy before writing. This helper
 * shows a warning toast naming the copy and refreshes the note list so it
 * appears in the sidebar. No-op when the save had no conflict.
 */
export function notifyConflictCopy(result: NoteWriteResult): void {
  if (!result.conflictCopy) return;

  const name = result.conflictCopy.split('/').pop() ?? result.conflictCopy;
  useToastStore
    .getState()
    .addToast(
      'warning',
      `Edits conflicted with an external change — saved a conflict copy: ${name}`,
      8000,
    );

  listNotes()
    .then((notes) => useNoteStore.getState().setNotes(notes))
    .catch((err) => {
      console.error('[noteConflicts] Failed to refresh notes after conflict copy:', err);
    });
}
