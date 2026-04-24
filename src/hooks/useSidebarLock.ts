import { useState } from 'react';
import { lockNote, unlockNote, permanentlyUnlockNote } from '@/lib';
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
  const { currentNote, setNotes, setCurrentNote, unlockNote: trackUnlockedNote } = useNoteStore();
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
      await lockNote(noteToLock.name, password, noteToLock.isDaily);
      toast.success('Note locked');
      setNotes(notes.map((n) => (n.path === noteToLock.path ? { ...n, isLocked: true } : n)));
      if (currentNote && currentNote.id === noteToLock.path) {
        setCurrentNote(null);
      }
    } else if (mode === 'unlock') {
      const content = await unlockNote(noteToLock.name, password, noteToLock.isDaily);
      const note = {
        id: noteToLock.path,
        title: noteToLock.name.replace(/\.md$/, ''),
        content,
        createdAt: new Date(),
        updatedAt: new Date(),
        isDaily: noteToLock.isDaily,
        isWeekly: noteToLock.isWeekly || false,
        date: noteToLock.date,
        week: noteToLock.week,
      };
      setCurrentNote(note);
      trackUnlockedNote(noteToLock.path);
      toast.success('Note unlocked (view only)');
    } else if (mode === 'permanent-unlock') {
      await permanentlyUnlockNote(noteToLock.name, password, noteToLock.isDaily);
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
