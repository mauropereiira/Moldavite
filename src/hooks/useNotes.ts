/**
 * Note-list initialization and component-facing note workflow orchestration.
 *
 * The hook coordinates IPC with tab, color, selection, recent-note, template, and
 * task state. Before navigation it saves the note being left if it was edited (see
 * `lib/leaveSave.ts`); temporarily unlocked notes are excluded. Only the latest
 * navigation opens its note. Standalone paths come from note metadata and are never
 * reconstructed from display titles.
 */

import { useCallback } from 'react';
import { safeInvoke as invoke } from '@/lib/ipc';
import {
  useNoteColorsStore,
  useNoteSelectionStore,
  useNoteStore,
  useOverlayStore,
  useQuickSwitcherStore,
  useSettingsStore,
  useSidebarOrderStore,
  useTemplateStore,
  useTaskStatusStore,
  useToastStore,
} from '@/stores';
import { useWordPressStore } from '@/stores/wordpressStore';
import {
  ensureDirectories,
  listNotes,
  readNote,
  readNoteSnapshot,
  readNoteWithMeta,
  createNote as createNoteFile,
  getDailyNoteFilename,
  getWeeklyNoteFilename,
  filenameToNote,
  markdownToHtml,
  isHtmlContent,
  justCreatedTimes,
  parseTaskStatus,
  noteFileBackendPath,
  renameNote as renameNoteFile,
  getNoteTitleError,
} from '@/lib';
import type { NoteFile } from '@/types';
import { format, getISOWeek, getISOWeekYear } from 'date-fns';
import {
  acquireAutosavePathChange,
  abortAutosavePathChange,
  beginAutosavePathChange,
  commitAutosavePathChange,
  flushPendingAutosave,
  getPendingAutosaveNoteId,
} from '@/lib/autosaveFlush';
import {
  hasUnsavedEdits,
  heldLeaveSaveNote,
  readdressLeaveSave,
  saveNoteOnLeave,
} from '@/lib/leaveSave';
import { isNotDownloadedError, openCloudPlaceholder } from '@/lib/cloudNotes';
import { isMobilePlatform } from '@/lib/platform';
import { holdKeyboard, requestTitleFocus } from '@/lib/noteTitleFocus';

/**
 * Loads the note list and scans daily notes for task status. The app calls this once
 * at startup through `initializeNotes`; `refresh` calls it again on demand.
 */
async function loadNoteList(): Promise<void> {
  const { setNotes, setIsLoading } = useNoteStore.getState();
  try {
    setIsLoading(true);
    await ensureDirectories();
    const noteFiles = await listNotes();
    if (!Array.isArray(noteFiles)) {
      throw new Error('Invalid response from list_notes');
    }
    setNotes(noteFiles);

    const dailyNotes = noteFiles.filter((n) => n.isDaily && n.date && !n.notDownloaded);
    const { setTaskStatus } = useTaskStatusStore.getState();

    // Process daily notes in the background with capped concurrency —
    // an uncapped Promise.all fires one IPC read per daily note at once,
    // which makes cold start degrade linearly with vault age.
    const queue = [...dailyNotes];
    const scanNext = async () => {
      for (;;) {
        const noteFile = queue.shift();
        if (!noteFile) return;
        try {
          const { content: rawContent } = await readNoteSnapshot(noteFile.name, true, false);
          const htmlContent = isHtmlContent(rawContent) ? rawContent : markdownToHtml(rawContent);
          const status = parseTaskStatus(htmlContent);
          if (status.totalTasks > 0 && noteFile.date) {
            setTaskStatus(noteFile.date, status);
          }
        } catch {
          // Silently skip notes that can't be parsed
        }
      }
    };
    Promise.all(Array.from({ length: Math.min(8, queue.length) }, scanNext));
  } catch (error) {
    console.error('[useNotes] Failed to initialize:', error);
    useToastStore
      .getState()
      .addToast('error', 'Failed to load notes. Check the console for details.');
  } finally {
    setIsLoading(false);
  }
}

let initialLoad: Promise<void> | null = null;

/**
 * Startup load of the note list. Concurrent calls share one request, so a double
 * mount (React StrictMode) does not scan the Forge twice. A Forge switch reloads the
 * window, which starts this over.
 */
export function initializeNotes(): Promise<void> {
  initialLoad ??= loadNoteList().finally(() => {
    initialLoad = null;
  });
  return initialLoad;
}

/** Bumped by every navigation; a load that is no longer the latest must not open its note. */
let latestNavigation = 0;

/**
 * Manages note operations including loading, creating, and deleting notes.
 * Handles both daily notes and standalone notes with automatic state synchronization.
 */
export function useNotes() {
  const { notes, setNotes, currentNote, setCurrentNote, setIsLoading, openTab } = useNoteStore();

  // Get fresh state to avoid stale closures
  const getState = useNoteStore.getState;

  /**
   * Saves the current note before switching to another note, but only if it was edited.
   * Resolves to false when that save failed and is being retried in the background.
   */
  const flushCurrentNote = useCallback(async () => {
    const note = getState().currentNote;
    if (!note) return true;
    return saveNoteOnLeave(note);
  }, [getState]);

  /**
   * Shows a note's unsaved text instead of reading its file: its open tab when that has
   * edits, or its held text when an earlier save failed. Returns false when there is none.
   */
  const openUnsavedText = useCallback(
    (noteId: string, inNewTab: boolean) => {
      const state = getState();
      if (state.openTabs.some((tab) => tab.id === noteId) && hasUnsavedEdits(noteId)) {
        state.switchTab(noteId);
        return true;
      }
      const held = heldLeaveSaveNote(noteId);
      if (!held) return false;
      state.openTab(held, inNewTab);
      getState().markNoteUnsaved(noteId);
      return true;
    },
    [getState]
  );

  /**
   * Opens a note file in a tab unless a newer navigation has started since
   * `navigation` was taken. A locked note goes to the unlock prompt instead, and an
   * open tab with unsaved edits is switched to rather than re-read from disk.
   */
  const openNoteFile = useCallback(
    async (noteFile: NoteFile, inNewTab: boolean, navigation: number) => {
      const state = getState();
      const listed = state.notes.find((note) => note.path === noteFile.path);
      if (noteFile.isLocked || listed?.isLocked) {
        if (
          state.unlockedNotes.has(noteFile.path) &&
          state.openTabs.some((tab) => tab.id === noteFile.path)
        ) {
          state.switchTab(noteFile.path);
          return;
        }
        const { indexMode } = useSettingsStore.getState();
        if (indexMode === 'off') {
          useToastStore
            .getState()
            .addToast('error', 'This note is locked. Unlock it from the Index first.');
          return;
        }
        const overlays = useOverlayStore.getState();
        const indexShown =
          overlays.activeOverlay === 'index' ||
          (indexMode === 'pinned' && !overlays.isSidebarHidden);
        // Raised in the tap that asked, for the password field about to mount.
        if (isMobilePlatform()) holdKeyboard();
        state.requestUnlock(listed ?? noteFile, !indexShown);
        overlays.openIndex(indexMode === 'pinned');
        return;
      }
      if (openUnsavedText(noteFile.path, inNewTab)) return;
      if (noteFile.notDownloaded || listed?.notDownloaded) {
        openCloudPlaceholder(listed ?? noteFile, inNewTab);
        return;
      }

      try {
        setIsLoading(true);
        const rawContent = await readNote(
          noteFileBackendPath(noteFile),
          noteFile.isDaily,
          noteFile.isWeekly || false
        );
        if (navigation !== latestNavigation) return;

        // Check if content is already HTML (backwards compatibility with old format)
        let htmlContent: string;
        if (isHtmlContent(rawContent)) {
          htmlContent = rawContent;
        } else {
          htmlContent = markdownToHtml(rawContent);
        }

        if (noteFile.isDaily && noteFile.date) {
          const taskStatus = parseTaskStatus(htmlContent);
          useTaskStatusStore.getState().setTaskStatus(noteFile.date, taskStatus);
        }

        const note = filenameToNote(noteFile, htmlContent);
        openTab(note, inNewTab);
      } catch (error) {
        if (navigation !== latestNavigation) return;
        if (isNotDownloadedError(error)) {
          openCloudPlaceholder(listed ?? noteFile, inNewTab);
          return;
        }
        console.error('[useNotes] Failed to load note:', error);
        const msg = error instanceof Error ? error.message : String(error);
        useToastStore.getState().addToast('error', `Failed to open note: ${msg}`);
      } finally {
        setIsLoading(false);
      }
    },
    [getState, openTab, openUnsavedText, setIsLoading]
  );

  /**
   * Loads a specific note from disk into the editor, saving the note being left first
   * if it was edited. When that save fails the note opens in a new tab, so the
   * unsaved one keeps its tab while the save is retried.
   * @param noteFile - The note file to load
   * @param inNewTab - If true, opens in a new tab instead of replacing the current one
   */
  const loadNote = useCallback(
    async (noteFile: NoteFile, inNewTab: boolean = false) => {
      const navigation = ++latestNavigation;
      const saved = await flushCurrentNote();
      if (navigation !== latestNavigation) return;
      await openNoteFile(noteFile, inNewTab || !saved, navigation);
    },
    [flushCurrentNote, openNoteFile]
  );

  /**
   * Loads or creates a daily note for the specified date.
   * If a default daily template is set, applies it to new daily notes.
   */
  const loadDailyNote = useCallback(
    async (date: Date) => {
      const filename = getDailyNoteFilename(date);
      const dateStr = format(date, 'yyyy-MM-dd');

      const navigation = ++latestNavigation;
      const keepCurrentTab = !(await flushCurrentNote());
      if (navigation !== latestNavigation) return;

      // Get fresh notes from store to avoid stale closure
      const currentNotes = getState().notes;

      const openVirtualOrRacedNote = async () => {
        if (openUnsavedText(`daily/${filename}`, keepCurrentTab)) return;
        let result;
        const virtualFile: NoteFile = {
          name: filename,
          path: `daily/${filename}`,
          isDaily: true,
          isWeekly: false,
          date: dateStr,
          isLocked: false,
        };
        try {
          result = await readNoteWithMeta(filename, true, false);
        } catch (error) {
          if (navigation !== latestNavigation) return;
          if (isNotDownloadedError(error)) {
            openCloudPlaceholder(virtualFile, keepCurrentTab);
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          useToastStore.getState().addToast('error', `Failed to open note: ${message}`);
          return;
        }
        if (navigation !== latestNavigation) return;
        if (!result.content) {
          openTab(filenameToNote(virtualFile, ''), keepCurrentTab);
          return;
        }

        const latestNotes = getState().notes;
        if (!latestNotes.some((note) => note.isDaily && note.date === dateStr)) {
          setNotes([...latestNotes, virtualFile]);
        }
        const htmlContent = isHtmlContent(result.content)
          ? result.content
          : markdownToHtml(result.content);
        openTab(filenameToNote(virtualFile, htmlContent), keepCurrentTab);
      };

      const existingNote = currentNotes.find((n) => n.isDaily && n.date === dateStr);

      if (existingNote) {
        await openNoteFile(existingNote, keepCurrentTab, navigation);
      } else {
        const { defaultDailyTemplate } = useTemplateStore.getState();

        if (defaultDailyTemplate) {
          try {
            await invoke('create_note_from_template', {
              filename,
              templateId: defaultDailyTemplate,
              isDaily: true,
            });

            const noteFile: NoteFile = {
              name: filename,
              path: `daily/${filename}`,
              isDaily: true,
              isWeekly: false,
              date: dateStr,
              isLocked: false,
            };

            setNotes([...currentNotes, noteFile]);

            await openNoteFile(noteFile, keepCurrentTab, navigation);
          } catch (error) {
            console.error('[useNotes] Failed to create daily note from template:', error);
            await openVirtualOrRacedNote();
          }
        } else {
          await openVirtualOrRacedNote();
        }
      }
    },
    [flushCurrentNote, getState, openNoteFile, openTab, openUnsavedText, setNotes]
  );

  /**
   * Loads or creates a weekly note for the specified week.
   * If a default weekly template is set, applies it to new weekly notes.
   * @param date - Any date within the target week (uses ISO week numbering)
   */
  const loadWeeklyNote = useCallback(
    async (date: Date) => {
      const filename = getWeeklyNoteFilename(date);
      const weekYear = getISOWeekYear(date);
      const weekNum = getISOWeek(date);
      const weekStr = `${weekYear}-W${weekNum.toString().padStart(2, '0')}`;

      const navigation = ++latestNavigation;
      const keepCurrentTab = !(await flushCurrentNote());
      if (navigation !== latestNavigation) return;

      // Get fresh notes from store to avoid stale closure
      const currentNotes = getState().notes;

      const openVirtualOrRacedNote = async () => {
        if (openUnsavedText(`weekly/${filename}`, keepCurrentTab)) return;
        let result;
        const virtualFile: NoteFile = {
          name: filename,
          path: `weekly/${filename}`,
          isDaily: false,
          isWeekly: true,
          week: weekStr,
          isLocked: false,
        };
        try {
          result = await readNoteWithMeta(filename, false, true);
        } catch (error) {
          if (navigation !== latestNavigation) return;
          if (isNotDownloadedError(error)) {
            openCloudPlaceholder(virtualFile, keepCurrentTab);
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          useToastStore.getState().addToast('error', `Failed to open note: ${message}`);
          return;
        }
        if (navigation !== latestNavigation) return;
        if (!result.content) {
          openTab(filenameToNote(virtualFile, ''), keepCurrentTab);
          return;
        }

        const realFile = { ...virtualFile, path: `weekly/${filename}` };
        const latestNotes = getState().notes;
        if (!latestNotes.some((note) => note.isWeekly && note.week === weekStr)) {
          setNotes([...latestNotes, realFile]);
        }
        const htmlContent = isHtmlContent(result.content)
          ? result.content
          : markdownToHtml(result.content);
        openTab(filenameToNote(realFile, htmlContent), keepCurrentTab);
      };

      const existingNote = currentNotes.find((n) => n.isWeekly && n.week === weekStr);

      if (existingNote) {
        await openNoteFile(existingNote, keepCurrentTab, navigation);
      } else {
        // Check for default weekly template (future feature)
        const { defaultWeeklyTemplate } = useTemplateStore.getState() as {
          defaultWeeklyTemplate?: string;
        };

        if (defaultWeeklyTemplate) {
          try {
            await invoke('create_note_from_template', {
              filename,
              templateId: defaultWeeklyTemplate,
              isDaily: false,
              isWeekly: true,
            });

            const noteFile: NoteFile = {
              name: filename,
              path: `weekly/${filename}`,
              isDaily: false,
              isWeekly: true,
              week: weekStr,
              isLocked: false,
            };

            setNotes([...currentNotes, noteFile]);

            await openNoteFile(noteFile, keepCurrentTab, navigation);
          } catch (error) {
            console.error('[useNotes] Failed to create weekly note from template:', error);
            await openVirtualOrRacedNote();
          }
        } else {
          await openVirtualOrRacedNote();
        }
      }
    },
    [flushCurrentNote, getState, openNoteFile, openTab, openUnsavedText, setNotes]
  );

  /**
   * Creates a new standalone note with the specified title.
   */
  const createNote = useCallback(
    async (title: string, folderPath?: string | null) => {
      latestNavigation += 1;
      // A phone opens a new note on its title, ready to be named.
      const focusTitle = isMobilePlatform();
      if (focusTitle) holdKeyboard();
      try {
        setIsLoading(true);
        const filename = await createNoteFile(title, folderPath || undefined);
        await readNoteWithMeta(filename, false, false);
        const noteFile: NoteFile = {
          name: filename.split('/').pop() || filename,
          path: `notes/${filename}`,
          isDaily: false,
          isWeekly: false,
          isLocked: false,
          folderPath: folderPath || undefined,
          ...justCreatedTimes(),
        };
        // Get fresh notes to avoid stale closure
        const freshNotes = getState().notes;
        if (!freshNotes.find((n) => n.path === noteFile.path)) {
          setNotes([...freshNotes, noteFile]);
        }
        const note = filenameToNote(noteFile, '');
        if (focusTitle) requestTitleFocus(note.id);
        setCurrentNote(note);
      } catch (error) {
        console.error('[useNotes] Failed to create note:', error);
        const msg = error instanceof Error ? error.message : String(error);
        useToastStore.getState().addToast('error', `Failed to create note: ${msg}`);
      } finally {
        setIsLoading(false);
      }
    },
    [getState, setNotes, setCurrentNote, setIsLoading]
  );

  /**
   * Creates a new note from a template.
   */
  const createFromTemplate = useCallback(
    async (
      title: string,
      templateId: string,
      isDaily: boolean = false,
      folderPath?: string | null
    ) => {
      try {
        setIsLoading(true);
        const filename = isDaily ? `${title}.md` : `${title}.md`;
        const fullPath = folderPath ? `${folderPath}/${filename}` : filename;

        await invoke('create_note_from_template', {
          filename: fullPath,
          templateId,
          isDaily,
        });

        const noteFile: NoteFile = {
          name: filename,
          path: isDaily ? `daily/${filename}` : `notes/${fullPath}`,
          isDaily,
          isWeekly: false,
          date: isDaily ? title : undefined,
          isLocked: false,
          folderPath: folderPath || undefined,
          ...justCreatedTimes(),
        };

        // Get fresh notes to avoid stale closure
        const freshNotes = getState().notes;
        if (!freshNotes.find((n) => n.path === noteFile.path)) {
          setNotes([...freshNotes, noteFile]);
        }

        await loadNote(noteFile);
      } catch (error) {
        console.error('[useNotes] Failed to create note from template:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [getState, setNotes, loadNote, setIsLoading]
  );

  /**
   * Renames a standalone note and migrates every frontend reference to its new path.
   * The backend also rewrites inbound wiki-links across the Forge.
   */
  const renameNote = useCallback(
    async (sourceNote: NoteFile, title: string) => {
      const newTitle = title.trim();
      const validationError = getNoteTitleError(newTitle);
      if (validationError) {
        useToastStore.getState().addToast('error', validationError);
        throw new Error(validationError);
      }
      if (sourceNote.isDaily || sourceNote.isWeekly) {
        const message = 'Daily and weekly notes are named by date and cannot be renamed';
        useToastStore.getState().addToast('error', message);
        throw new Error(message);
      }

      const oldPath = sourceNote.path;
      const oldFilename = noteFileBackendPath(sourceNote);
      const newName = `${newTitle}.md`;
      const newFilename = sourceNote.folderPath ? `${sourceNote.folderPath}/${newName}` : newName;
      const newPath = `notes/${newFilename}`;

      if (newPath === oldPath) return;

      const releasePathChange = await acquireAutosavePathChange();
      let heldAutosavePath: string | null = null;
      try {
        await flushPendingAutosave();
        if (getPendingAutosaveNoteId() !== null || heldLeaveSaveNote(oldPath)) {
          throw new Error('Save pending changes before renaming a note');
        }
        if (getState().currentNote?.id === oldPath) {
          beginAutosavePathChange(oldPath);
          heldAutosavePath = oldPath;
        }
        await renameNoteFile(oldFilename, newFilename, false, false);

        useNoteStore.getState().renameNoteReferences(oldPath, newPath, newTitle);
        readdressLeaveSave(oldPath, newPath, newTitle);
        if (heldAutosavePath) {
          const committingPath = heldAutosavePath;
          heldAutosavePath = null;
          await commitAutosavePathChange(committingPath, newPath).catch((error) => {
            console.error('[useNotes] Failed to save an edit made during rename:', error);
          });
        }
        useNoteColorsStore.getState().renameColor(oldPath, newPath);
        useNoteSelectionStore.getState().rename(oldPath, newPath);
        useQuickSwitcherStore.getState().renamePinnedNote(oldPath, newPath);
        useSidebarOrderStore.getState().renameNote(oldPath, newPath);
        useWordPressStore.getState().notePathChanged(oldPath, newPath);
        useToastStore.getState().addToast('success', 'Renamed — inbound links updated');
      } catch (error) {
        if (heldAutosavePath) {
          await abortAutosavePathChange(heldAutosavePath).catch(() => {});
        }
        const message = error instanceof Error ? error.message : String(error);
        useToastStore.getState().addToast('error', message);
        throw error;
      } finally {
        releasePathChange();
      }
    },
    [getState]
  );

  /**
   * Duplicates an existing note with " (copy)" suffix.
   */
  const duplicateNote = useCallback(
    async (sourceNote: NoteFile) => {
      try {
        setIsLoading(true);
        await flushCurrentNote();
        // Backend addresses standalone notes by folder-relative path and echoes
        // the same shape back (e.g. "Projects/foo (copy).md").
        const newFilename = await invoke<string>('duplicate_note', {
          filename: noteFileBackendPath(sourceNote),
          isDaily: sourceNote.isDaily || false,
          isWeekly: sourceNote.isWeekly || false,
        });
        const bareName = newFilename.split('/').pop() || newFilename;

        const noteFile: NoteFile = {
          name: bareName,
          path: sourceNote.isDaily
            ? `daily/${newFilename}`
            : sourceNote.isWeekly
              ? `weekly/${newFilename}`
              : `notes/${newFilename}`,
          isDaily: sourceNote.isDaily || false,
          isWeekly: sourceNote.isWeekly || false,
          isLocked: false,
          folderPath: sourceNote.folderPath,
          ...justCreatedTimes(),
        };

        // Get fresh notes to avoid stale closure
        const freshNotes = getState().notes;
        if (!freshNotes.find((n) => n.path === noteFile.path)) {
          setNotes([...freshNotes, noteFile]);
        }

        await loadNote(noteFile);
      } catch (error) {
        console.error('[useNotes] Failed to duplicate note:', error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [flushCurrentNote, getState, setNotes, loadNote, setIsLoading]
  );

  return {
    notes,
    currentNote,
    loadNote,
    loadDailyNote,
    loadWeeklyNote,
    createNote,
    createFromTemplate,
    duplicateNote,
    renameNote,
    refresh: loadNoteList,
  };
}
