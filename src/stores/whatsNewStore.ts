/**
 * Persisted "What's New" acknowledgement and transient modal visibility.
 * `lastSeenVersion` advances only when the popup is acknowledged; opening/closing the
 * current session must not itself mark unseen release notes as read.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChangelogEntry } from '@/lib/changelog';

interface WhatsNewState {
  /** Last app version the user has seen the What's New popup for (persisted). */
  lastSeenVersion: string | null;
  /** Whether the popup is currently open (transient). */
  isOpen: boolean;
  /** The release-notes entry to display (transient). */
  entry: ChangelogEntry | null;
  open: (entry: ChangelogEntry) => void;
  close: () => void;
  markSeen: (version: string) => void;
}

export const useWhatsNewStore = create<WhatsNewState>()(
  persist(
    (set) => ({
      lastSeenVersion: null,
      isOpen: false,
      entry: null,
      open: (entry) => set({ entry, isOpen: true }),
      close: () => set({ isOpen: false }),
      markSeen: (version) => set({ lastSeenVersion: version }),
    }),
    {
      name: 'moldavite-whats-new',
      // Persist only the durable cursor, not transient modal state.
      partialize: (state) => ({ lastSeenVersion: state.lastSeenVersion }),
    }
  )
);
