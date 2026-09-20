/**
 * Activity-driven relocking lifecycle for temporarily decrypted notes.
 * One timer covers the current unlocked-note set, is reset by user activity, and
 * is removed when disabled or unmounted. Relocking changes in-memory visibility;
 * encrypted disk content remains authoritative throughout.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNoteStore } from '@/stores/noteStore';

/**
 * Hook that monitors user activity and automatically locks unlocked notes
 * after a period of inactivity.
 *
 * Tracks: mouse movements, key presses, clicks, scrolls, touch events
 *
 * When the timeout expires, all temporarily unlocked notes are re-locked
 * (the user will need to enter their password again to view them).
 */
export function useAutoLock() {
  const { autoLockTimeout } = useSettingsStore();
  const { unlockedNotes, lockNote } = useNoteStore();
  const timeoutRef = useRef<number | null>(null);
  // Initialized in the effect below (cannot call Date.now() during render).
  const lastActivityRef = useRef<number | null>(null);

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (autoLockTimeout === 0 || unlockedNotes.size === 0) {
      return;
    }

    const timeoutMs = autoLockTimeout * 60 * 1000;
    timeoutRef.current = window.setTimeout(() => {
      const notesToLock = Array.from(unlockedNotes);
      notesToLock.forEach((noteId) => {
        lockNote(noteId);
      });
    }, timeoutMs);
  }, [autoLockTimeout, unlockedNotes, lockNote]);

  const handleActivity = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  useEffect(() => {
    if (lastActivityRef.current === null) {
      lastActivityRef.current = Date.now();
    }

    if (autoLockTimeout === 0) {
      return;
    }

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    resetTimer();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [autoLockTimeout, handleActivity, resetTimer]);

  useEffect(() => {
    if (unlockedNotes.size > 0 && autoLockTimeout > 0) {
      resetTimer();
    }
  }, [unlockedNotes, autoLockTimeout, resetTimer]);

  const getTimeRemaining = useCallback((): number | null => {
    if (autoLockTimeout === 0 || unlockedNotes.size === 0) {
      return null;
    }
    const elapsed = Date.now() - (lastActivityRef.current ?? Date.now());
    const remaining = autoLockTimeout * 60 * 1000 - elapsed;
    return Math.max(0, remaining);
  }, [autoLockTimeout, unlockedNotes]);

  return {
    getTimeRemaining,
    resetTimer,
  };
}
