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
  const lastActivityRef = useRef<number>(Date.now());

  // Reset the inactivity timer
  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();

    // Clear existing timeout
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Don't set timer if auto-lock is disabled (0) or no unlocked notes
    if (autoLockTimeout === 0 || unlockedNotes.size === 0) {
      return;
    }

    // Set new timeout
    const timeoutMs = autoLockTimeout * 60 * 1000; // Convert minutes to ms
    timeoutRef.current = window.setTimeout(() => {
      // Lock all temporarily unlocked notes
      const notesToLock = Array.from(unlockedNotes);
      notesToLock.forEach((noteId) => {
        lockNote(noteId);
      });
      console.log(`[AutoLock] Locked ${notesToLock.length} notes after ${autoLockTimeout} minutes of inactivity`);
    }, timeoutMs);
  }, [autoLockTimeout, unlockedNotes, lockNote]);

  // Handle activity events
  const handleActivity = useCallback(() => {
    resetTimer();
  }, [resetTimer]);

  // Set up event listeners
  useEffect(() => {
    // Skip if auto-lock is disabled
    if (autoLockTimeout === 0) {
      return;
    }

    // Activity events to track
    const events = [
      'mousedown',
      'mousemove',
      'keydown',
      'scroll',
      'touchstart',
      'click',
    ];

    // Add event listeners with passive option for performance
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Initialize timer when hook mounts
    resetTimer();

    // Cleanup
    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [autoLockTimeout, handleActivity, resetTimer]);

  // Also reset timer when unlocked notes change
  useEffect(() => {
    if (unlockedNotes.size > 0 && autoLockTimeout > 0) {
      resetTimer();
    }
  }, [unlockedNotes, autoLockTimeout, resetTimer]);

  // Return the time remaining until auto-lock (useful for UI indicators)
  const getTimeRemaining = useCallback((): number | null => {
    if (autoLockTimeout === 0 || unlockedNotes.size === 0) {
      return null;
    }
    const elapsed = Date.now() - lastActivityRef.current;
    const remaining = (autoLockTimeout * 60 * 1000) - elapsed;
    return Math.max(0, remaining);
  }, [autoLockTimeout, unlockedNotes]);

  return {
    getTimeRemaining,
    resetTimer,
  };
}
