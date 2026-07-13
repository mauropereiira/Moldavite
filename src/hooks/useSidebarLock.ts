/**
 * Sidebar password-modal orchestration for lock, temporary unlock, and permanent unlock.
 * Editable content is flushed before encryption, temporary plaintext remains view-only
 * in memory, and path-keyed tabs/unlock state are cleared when the disk form changes.
 */

import { useState } from 'react';
import {
  filenameToNote,
  htmlToMarkdown,
  isHtmlContent,
  lockNote,
  markdownToHtml,
  noteFileBackendPath,
  permanentlyUnlockNote,
  unlockNote,
  writeNote,
} from '@/lib';
import { useNoteStore } from '@/stores';
import { useToast } from './useToast';
import type { NoteFile } from '@/types';

type LockModalMode = 'lock' | 'unlock' | 'permanent-unlock' | null;

/**
 * Owns the encrypt / decrypt / permanent-unlock workflow for the sidebar.
 * Returns handlers that open the password modal in the right mode, a
 * submit handler that performs the correct IPC call, and the state
 * needed to render the PasswordModal.
 */
export function useSidebarLock() {
  const {
    setNotes,
    setCurrentNote,
    removeTabByPath,
    unlockNote: trackUnlockedNote,
  } = useNoteStore();
  const toast = useToast();

  const [mode, setMode] = useState<LockModalMode>(null);
  const [noteToLock, setNoteToLock] = useState<NoteFile | null>(null);

  const openLock = (note: NoteFile) => {
    setNoteToLock(note);
    setMode('lock');
  };

  const openUnlock = (note: NoteFile) => {
    setNoteToLock(note);
    setMode('unlock');
  };

  const openPermanentUnlock = (note: NoteFile) => {
    setNoteToLock(note);
    setMode('permanent-unlock');
  };

  const close = () => {
    setMode(null);
    setNoteToLock(null);
  };

  /**
   * @param notes Current list from useNotes — passed in so this hook
   *   doesn't duplicate note-list ownership.
   */
  const submit = async (password: string, notes: NoteFile[]) => {
    if (!noteToLock) return;

    if (mode === 'lock') {
      const current = useNoteStore.getState().currentNote;
      if (current?.id === noteToLock.path) {
        await writeNote(
          noteFileBackendPath(noteToLock),
          htmlToMarkdown(current.content),
          noteToLock.isDaily,
          noteToLock.isWeekly || false
        );
      }
      await lockNote(noteToLock.name, password, noteToLock.isDaily, noteToLock.isWeekly || false);
      toast.success('Note locked');
      setNotes(notes.map((n) => (n.path === noteToLock.path ? { ...n, isLocked: true } : n)));
      removeTabByPath(noteToLock.path);
    } else if (mode === 'unlock') {
      const content = await unlockNote(
        noteToLock.name,
        password,
        noteToLock.isDaily,
        noteToLock.isWeekly || false
      );
      const htmlContent = isHtmlContent(content) ? content : markdownToHtml(content);
      const note = filenameToNote(noteToLock, htmlContent);
      setCurrentNote(note);
      trackUnlockedNote(noteToLock.path);
      toast.success('Note unlocked (view only)');
    } else if (mode === 'permanent-unlock') {
      await permanentlyUnlockNote(
        noteToLock.name,
        password,
        noteToLock.isDaily,
        noteToLock.isWeekly || false
      );
      toast.success('Note permanently unlocked');
      setNotes(notes.map((n) => (n.path === noteToLock.path ? { ...n, isLocked: false } : n)));
    }
  };

  return {
    mode,
    noteToLock,
    openLock,
    openUnlock,
    openPermanentUnlock,
    close,
    submit,
  };
}
