/**
 * Canonical frontend note list, editor tabs, active note, save flags, and unlock state.
 *
 * `openTabs` owns loaded note objects. `activeTabId` selects at most one tab, and
 * `currentNote` must be that exact active tab object (or `null` when no tab is active);
 * tab open, close, switch, content, and rename actions update the three together.
 * Note ids are stable disk addresses, not display titles. Recent ids are persisted per
 * Forge; temporary unlock state and loaded tab bodies are process-only.
 */

import { create } from 'zustand';
import type { Note, NoteFile } from '@/types';
import { namespacedKey } from '@/lib/forgeStorage';
import { useGraphStore } from './graphStore';
import { useTimelineStore } from './timelineStore';

interface NoteState {
  notes: NoteFile[];
  // Tab management
  openTabs: Note[];
  activeTabId: string | null;
  // Compatibility alias for the tab selected by activeTabId; never independent state.
  currentNote: Note | null;
  isLoading: boolean;
  isSaving: boolean;
  selectedDate: Date;
  selectedWeek: Date | null; // The Monday of the selected week

  // Recent notes for quick switcher
  recentNoteIds: string[];

  // Security - tracks temporarily unlocked notes for auto-lock feature
  unlockedNotes: Set<string>;

  // Actions
  setNotes: (notes: NoteFile[]) => void;
  setCurrentNote: (note: Note | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setSelectedDate: (date: Date) => void;
  setSelectedWeek: (date: Date | null) => void;
  updateNoteContent: (content: string, noteId?: string) => void;

  // Tab actions
  openTab: (note: Note, inNewTab?: boolean) => void;
  closeTab: (noteId: string) => void;
  switchTab: (noteId: string) => void;
  updateTabContent: (noteId: string, content: string) => void;
  renameNoteReferences: (oldPath: string, newPath: string, newTitle: string) => void;
  removeTabByPath: (notePath: string) => void;
  pinTab: (noteId: string) => { success: boolean; message?: string };
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  loadPinnedTabs: () => void;

  // Security actions for auto-lock
  unlockNote: (noteId: string) => void;
  lockNote: (noteId: string) => void;
  lockAllNotes: () => void;

  // Recent notes tracking
  addRecentNote: (noteId: string) => void;
}

// Load recent notes from localStorage
const loadRecentNotes = (): string[] => {
  try {
    const stored = localStorage.getItem(namespacedKey('moldavite-recent-notes'));
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('[noteStore] Failed to load recent notes:', error);
  }
  return [];
};

export const useNoteStore = create<NoteState>((set, get) => ({
  notes: [],
  openTabs: [],
  activeTabId: null,
  currentNote: null,
  isLoading: false,
  isSaving: false,
  selectedDate: new Date(),
  selectedWeek: null,
  recentNoteIds: loadRecentNotes(),
  unlockedNotes: new Set<string>(),

  /**
   * Replaces the entire notes list.
   * @param notes - New list of note files
   */
  setNotes: (notes) => {
    set({ notes });
  },

  /**
   * Sets the currently loaded note in the editor.
   * Now also opens the note as a tab.
   * @param note - The note to load, or null to clear
   */
  setCurrentNote: (note) => {
    if (note) {
      // Open the note as a tab (replaces current if exists, or adds new)
      get().openTab(note, false);
    } else {
      set({ currentNote: null });
    }
  },

  /**
   * Sets the loading state for note operations.
   * @param loading - True when loading notes
   */
  setIsLoading: (loading) => set({ isLoading: loading }),

  /**
   * Sets the saving state for auto-save operations.
   * @param saving - True when saving notes
   */
  setIsSaving: (saving) => set({ isSaving: saving }),

  /**
   * Sets the selected date for daily note navigation.
   * @param date - The date to select
   */
  setSelectedDate: (date) => set({ selectedDate: date }),

  /**
   * Sets the selected week for weekly note navigation.
   * @param date - Any date within the week, or null to clear
   */
  setSelectedWeek: (date) => set({ selectedWeek: date }),

  /**
   * Updates the content of the current note without saving to disk.
   * Used by the editor to track content changes before auto-save.
   * @param content - The new HTML content
   * @param noteId - Optional note ID to validate (prevents race conditions when switching notes)
   */
  updateNoteContent: (content, noteId) =>
    set((state) => {
      if (!state.activeTabId) return state;

      // If noteId is provided, only update if it matches the active tab
      // This prevents stale callbacks from corrupting content after switching notes
      if (noteId && noteId !== state.activeTabId) {
        return state;
      }

      const updatedTabs = state.openTabs.map((tab) =>
        tab.id === state.activeTabId ? { ...tab, content, updatedAt: new Date() } : tab
      );

      const activeTab = updatedTabs.find((t) => t.id === state.activeTabId) || null;

      return {
        openTabs: updatedTabs,
        currentNote: activeTab,
      };
    }),

  /**
   * Opens a note in tabs. If inNewTab is false, replaces content in active tab
   * or switches to existing tab if already open.
   */
  openTab: (note, inNewTab = false) => {
    // A note becoming active always yields transient exploration views. Keep
    // this at the canonical tab entry point so sidebar, search, quick switcher,
    // locked-note unlocks, graph nodes, and virtual notes cannot diverge.
    useTimelineStore.getState().close();
    useGraphStore.getState().close();

    // Track in recent notes
    get().addRecentNote(note.id);

    return set((state) => {
      // Check if note is already open
      const existingTabIndex = state.openTabs.findIndex((t) => t.id === note.id);

      if (existingTabIndex >= 0) {
        // Tab already exists - switch to it and update its content
        const updatedTabs = state.openTabs.map((t, i) =>
          i === existingTabIndex ? { ...t, content: note.content } : t
        );
        return {
          openTabs: updatedTabs,
          activeTabId: note.id,
          currentNote: updatedTabs[existingTabIndex],
        };
      }

      const activeTab = state.openTabs.find((t) => t.id === state.activeTabId);
      const activeTabIsPinned = !!activeTab?.isPinned;

      if (inNewTab || state.openTabs.length === 0 || activeTabIsPinned) {
        // Open in a new tab when explicitly requested, when no tabs exist,
        // or when the active tab is pinned (pinned tabs must not be replaced
        // by sidebar navigation / preview-mode reuse).
        const newTabs = [...state.openTabs, note];
        return {
          openTabs: newTabs,
          activeTabId: note.id,
          currentNote: note,
        };
      } else {
        // Replace active tab's content (single-click "preview" behavior).
        // Only applies when the active tab is unpinned.
        const activeIndex = state.openTabs.findIndex((t) => t.id === state.activeTabId);
        if (activeIndex >= 0) {
          const newTabs = state.openTabs.map((t, i) => (i === activeIndex ? note : t));
          return {
            openTabs: newTabs,
            activeTabId: note.id,
            currentNote: note,
          };
        } else {
          // No active tab, open as new
          const newTabs = [...state.openTabs, note];
          return {
            openTabs: newTabs,
            activeTabId: note.id,
            currentNote: note,
          };
        }
      }
    });
  },

  /**
   * Closes a tab and switches to an adjacent tab if needed.
   */
  closeTab: (noteId) =>
    set((state) => {
      const tabIndex = state.openTabs.findIndex((t) => t.id === noteId);
      if (tabIndex < 0) return state;

      const newTabs = state.openTabs.filter((t) => t.id !== noteId);

      let newActiveId: string | null = null;
      let newCurrentNote: Note | null = null;

      if (newTabs.length > 0 && state.activeTabId === noteId) {
        // Switch to adjacent tab
        const newIndex = Math.min(tabIndex, newTabs.length - 1);
        newActiveId = newTabs[newIndex].id;
        newCurrentNote = newTabs[newIndex];
      } else if (newTabs.length > 0) {
        // Keep current active tab
        newActiveId = state.activeTabId;
        newCurrentNote = newTabs.find((t) => t.id === state.activeTabId) || null;
      }

      return {
        openTabs: newTabs,
        activeTabId: newActiveId,
        currentNote: newCurrentNote,
      };
    }),

  /**
   * Switches to a different tab.
   */
  switchTab: (noteId) =>
    set((state) => {
      const tab = state.openTabs.find((t) => t.id === noteId);
      if (!tab) return state;

      return {
        activeTabId: noteId,
        currentNote: tab,
      };
    }),

  /**
   * Updates content for a specific tab.
   */
  updateTabContent: (noteId, content) =>
    set((state) => {
      const updatedTabs = state.openTabs.map((tab) =>
        tab.id === noteId ? { ...tab, content, updatedAt: new Date() } : tab
      );

      const activeTab =
        state.activeTabId === noteId
          ? updatedTabs.find((t) => t.id === noteId) || null
          : state.currentNote;

      return {
        openTabs: updatedTabs,
        currentNote: activeTab,
      };
    }),

  /** Moves every persisted/in-memory reference from a note's old path to its new path. */
  renameNoteReferences: (oldPath, newPath, newTitle) =>
    set((state) => {
      const newName = newPath.split('/').pop() || `${newTitle}.md`;
      const openTabs = state.openTabs.map((tab) =>
        tab.id === oldPath ? { ...tab, id: newPath, title: newTitle } : tab
      );
      const recentNoteIds = state.recentNoteIds.map((id) => (id === oldPath ? newPath : id));
      const unlockedNotes = new Set(
        [...state.unlockedNotes].map((id) => (id === oldPath ? newPath : id))
      );
      const activeTabId = state.activeTabId === oldPath ? newPath : state.activeTabId;
      const currentNote = activeTabId
        ? openTabs.find((tab) => tab.id === activeTabId) || null
        : null;

      try {
        localStorage.setItem(
          namespacedKey('moldavite-recent-notes'),
          JSON.stringify(recentNoteIds)
        );
        const pinnedIds = openTabs.filter((tab) => tab.isPinned).map((tab) => tab.id);
        localStorage.setItem('moldavite-pinned-tabs', JSON.stringify(pinnedIds));
      } catch (error) {
        console.error('[noteStore] Failed to persist renamed note references:', error);
      }

      return {
        notes: state.notes.map((note) =>
          note.path === oldPath ? { ...note, name: newName, path: newPath } : note
        ),
        openTabs,
        activeTabId,
        currentNote,
        recentNoteIds,
        unlockedNotes,
      };
    }),

  /**
   * Removes a tab by note path (used when a note is deleted).
   */
  removeTabByPath: (notePath) => {
    // `closeTab` already performs the complete atomic tab/current-note update.
    // Do not call it from inside another `set` updater: actions return void,
    // and returning that value would replace the entire Zustand state with
    // `undefined`.
    get().closeTab(notePath);
  },

  /**
   * Toggles the pinned state of a tab.
   * Maximum 5 pinned tabs allowed. Persists to localStorage.
   */
  pinTab: (noteId) => {
    const state = get();
    const tab = state.openTabs.find((t) => t.id === noteId);
    if (!tab) return { success: false, message: 'Tab not found' };

    const pinnedCount = state.openTabs.filter((t) => t.isPinned).length;
    const isCurrentlyPinned = tab.isPinned;

    // Check max limit when pinning
    if (!isCurrentlyPinned && pinnedCount >= 5) {
      return { success: false, message: 'Maximum 5 pinned tabs allowed' };
    }

    set((state) => {
      const updatedTabs = state.openTabs.map((t) =>
        t.id === noteId ? { ...t, isPinned: !t.isPinned } : t
      );

      // Sort tabs: pinned first, then regular
      const sortedTabs = [
        ...updatedTabs.filter((t) => t.isPinned),
        ...updatedTabs.filter((t) => !t.isPinned),
      ];

      // Persist pinned tab IDs to localStorage
      const pinnedIds = sortedTabs.filter((t) => t.isPinned).map((t) => t.id);
      localStorage.setItem('moldavite-pinned-tabs', JSON.stringify(pinnedIds));

      return {
        openTabs: sortedTabs,
        currentNote: state.activeTabId
          ? sortedTabs.find((t) => t.id === state.activeTabId) || null
          : null,
      };
    });

    return { success: true };
  },

  /**
   * Reorders tabs by moving a tab from one index to another.
   * Pinned tabs can only be reordered among pinned tabs.
   */
  reorderTabs: (fromIndex, toIndex) =>
    set((state) => {
      if (fromIndex === toIndex) return state;
      if (fromIndex < 0 || toIndex < 0) return state;
      if (fromIndex >= state.openTabs.length || toIndex >= state.openTabs.length) return state;

      const tabs = [...state.openTabs];
      const [movedTab] = tabs.splice(fromIndex, 1);
      tabs.splice(toIndex, 0, movedTab);

      // Ensure pinned tabs stay at the front
      const sortedTabs = [...tabs.filter((t) => t.isPinned), ...tabs.filter((t) => !t.isPinned)];

      return { openTabs: sortedTabs };
    }),

  /**
   * Loads pinned tab IDs from localStorage and applies pinned state to matching open tabs.
   */
  loadPinnedTabs: () => {
    try {
      const stored = localStorage.getItem('moldavite-pinned-tabs');
      if (!stored) return;

      const pinnedIds: string[] = JSON.parse(stored);
      set((state) => {
        const updatedTabs = state.openTabs.map((t) => ({
          ...t,
          isPinned: pinnedIds.includes(t.id),
        }));

        // Sort tabs: pinned first
        const sortedTabs = [
          ...updatedTabs.filter((t) => t.isPinned),
          ...updatedTabs.filter((t) => !t.isPinned),
        ];

        return {
          openTabs: sortedTabs,
          currentNote: state.activeTabId
            ? sortedTabs.find((t) => t.id === state.activeTabId) || null
            : null,
        };
      });
    } catch (error) {
      console.error('[noteStore] Failed to load pinned tabs:', error);
    }
  },

  /**
   * Marks a note as temporarily unlocked (for auto-lock tracking).
   * Called when a user enters the correct password for a locked note.
   * @param noteId - The note ID to mark as unlocked
   */
  unlockNote: (noteId) =>
    set((state) => {
      const newUnlocked = new Set(state.unlockedNotes);
      newUnlocked.add(noteId);
      return { unlockedNotes: newUnlocked };
    }),

  /**
   * Re-locks a previously unlocked note and closes its tab.
   * Called by auto-lock when inactivity timeout expires.
   * @param noteId - The note ID to re-lock
   */
  lockNote: (noteId) => {
    const state = get();
    const newUnlocked = new Set(state.unlockedNotes);
    newUnlocked.delete(noteId);

    // Close the tab for the locked note to clear decrypted content
    const tabExists = state.openTabs.some((t) => t.id === noteId);
    if (tabExists) {
      // Use closeTab to properly handle switching to another tab
      set({ unlockedNotes: newUnlocked });
      get().closeTab(noteId);
    } else {
      set({ unlockedNotes: newUnlocked });
    }
  },

  /**
   * Re-locks all temporarily unlocked notes.
   * Called when the app is about to close or after inactivity timeout.
   */
  lockAllNotes: () => {
    const state = get();
    const notesToLock = Array.from(state.unlockedNotes);

    // Close all tabs for locked notes
    notesToLock.forEach((noteId) => {
      const tabExists = state.openTabs.some((t) => t.id === noteId);
      if (tabExists) {
        get().closeTab(noteId);
      }
    });

    set({ unlockedNotes: new Set() });
  },

  /**
   * Adds a note to the recent notes list.
   * Keeps the last 7 notes, deduplicated.
   * @param noteId - The note ID to add
   */
  addRecentNote: (noteId) =>
    set((state) => {
      // Remove if already exists, then add to front
      const filtered = state.recentNoteIds.filter((id) => id !== noteId);
      const updated = [noteId, ...filtered].slice(0, 7);

      // Persist to localStorage
      try {
        localStorage.setItem(namespacedKey('moldavite-recent-notes'), JSON.stringify(updated));
      } catch (error) {
        console.error('[noteStore] Failed to save recent notes:', error);
      }

      return { recentNoteIds: updated };
    }),
}));
