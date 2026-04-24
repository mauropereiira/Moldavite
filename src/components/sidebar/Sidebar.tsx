import React, { useState, useRef, useEffect, useMemo } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Lock, Unlock, Trash2, FilePlus, Pencil, FolderInput, Layers, Copy, Download, FileDown } from 'lucide-react';
import { useNotes, useFolders, useTrash } from '@/hooks';
import { useNoteStore, useSettingsStore, useTagStore, useSearchStore } from '@/stores';
import type { ContentMatch } from '@/stores';
import {
  lockNote,
  unlockNote,
  permanentlyUnlockNote,
  aggregateTags,
  hasTag,
  extractTags,
  readNote,
  exportSingleNote,
  exportNoteToPdf,
  getNoteTitleError,
} from '@/lib';
import { SettingsModal } from '@/components/settings';
import { PasswordModal } from '@/components/ui';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';
import { useToast } from '@/hooks/useToast';
import { MoveToFolderModal } from './MoveToFolderModal';
import { TrashPopover } from './TrashPopover';
import { TrashPreviewModal } from './TrashPreviewModal';
import { SidebarTagList } from './SidebarTagList';
import { BacklinksSection } from './BacklinksSection';
import { SidebarSearch } from './SidebarSearch';
import { SidebarSearchResults } from './SidebarSearchResults';
import { SidebarNotesList } from './SidebarNotesList';
import { SidebarFolderTree } from './SidebarFolderTree';
import { SidebarDailyList } from './SidebarDailyList';
import { SidebarFooter } from './SidebarFooter';
import type { NoteFile, FolderInfo, TrashedNote } from '@/types';

type LockModalMode = 'lock' | 'unlock' | 'permanent-unlock' | null;

export function Sidebar() {
  const { notes, loadNote, loadDailyNote, createNote, createFromTemplate, duplicateNote, refresh: refreshNotes } = useNotes();
  const { currentNote, setSelectedDate, setNotes, setCurrentNote, unlockNote: trackUnlockedNote } = useNoteStore();
  const {
    setIsSettingsOpen,
    tagsEnabled,
    sortOption,
    setSortOption,
    showFoldersSection,
    showBacklinksSection,
    backlinksEnabled,
  } = useSettingsStore();
  const searchStore = useSearchStore();
  const searchQuery = searchStore.query;
  const searchResults = searchStore.results;
  const searchLoading = searchStore.loading;
  const searchSelectedIndex = searchStore.selectedIndex;
  const isSearchActive = searchQuery.trim().length > 0;
  const toast = useToast();
  const {
    folders,
    expandedFolders,
    sectionsCollapsed,
    initialize: initializeFolders,
    createNewFolder,
    renameExistingFolder,
    moveNoteToFolder,
    moveFolderToFolder,
    toggleFolder,
    toggleSection,
  } = useFolders();

  const {
    trashedNotes,
    loadTrash,
    trashNote,
    trashFolder,
    restoreNote,
    permanentlyDelete,
    emptyTrash,
    cleanupOld: cleanupOldTrash,
  } = useTrash();

  const {
    allTags,
    selectedTag,
    selectedTags,
    tagSearchQuery,
    setAllTags,
    setSelectedTag,
    toggleTag,
    clearFilter: clearTagFilter,
    setTagSearchQuery,
  } = useTagStore();

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [noteToDelete, setNoteToDelete] = useState<NoteFile | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingNoteTitle, setPendingNoteTitle] = useState('');

  // Lock/unlock state
  const [lockModalMode, setLockModalMode] = useState<LockModalMode>(null);
  const [noteToLock, setNoteToLock] = useState<NoteFile | null>(null);

  // Folder state
  const [showMoveToFolder, setShowMoveToFolder] = useState(false);
  const [noteToMove, setNoteToMove] = useState<NoteFile | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderContextMenu, setFolderContextMenu] = useState<FolderInfo | null>(null);
  const [folderContextMenuPosition, setFolderContextMenuPosition] = useState({ x: 0, y: 0 });
  const [isRenamingFolder, setIsRenamingFolder] = useState(false);
  const [folderToRename, setFolderToRename] = useState<FolderInfo | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [showDeleteFolderConfirm, setShowDeleteFolderConfirm] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<FolderInfo | null>(null);

  // Trash state (popover anchored to footer Trash button + preview modal)
  const [trashPopoverAnchor, setTrashPopoverAnchor] = useState<HTMLElement | null>(null);
  const [trashPreviewNote, setTrashPreviewNote] = useState<TrashedNote | null>(null);

  // Track target folder for new note creation
  const [createNoteInFolder, setCreateNoteInFolder] = useState<string | null>(null);

  // Notes section drop zone state (for dragging notes back to root)
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const rootDragCounterRef = useRef(0);

  // Folders section drop zone state (for dragging folders back to root)
  const [isDragOverFoldersRoot, setIsDragOverFoldersRoot] = useState(false);
  const foldersRootDragCounterRef = useRef(0);

  // Initialize folders
  useEffect(() => {
    initializeFolders();
  }, [initializeFolders]);

  // Initialize trash and cleanup old items
  useEffect(() => {
    loadTrash();
    cleanupOldTrash();
  }, [loadTrash, cleanupOldTrash]);

  // Track note content for tag extraction
  const noteContentCacheRef = useRef<Map<string, string>>(new Map());

  // Helper to get tags for a specific note from the cache
  const getNoteTags = (notePath: string): string[] => {
    const content = noteContentCacheRef.current.get(notePath);
    if (!content) return [];
    return extractTags(content);
  };

  // Aggregate tags from all notes (only when tags are enabled)
  useEffect(() => {
    if (!tagsEnabled) {
      setAllTags(new Map());
      return;
    }

    const aggregateAllTags = async () => {
      const contents: string[] = [];

      for (const note of notes) {
        if (note.isLocked) continue; // Skip locked notes

        let content = noteContentCacheRef.current.get(note.path);
        if (content === undefined) {
          try {
            content = await readNote(note.name, note.isDaily || false);
            noteContentCacheRef.current.set(note.path, content);
          } catch (_error) {
            console.error('[Sidebar] Failed to read note for tags:', note.name);
            content = '';
          }
        }
        contents.push(content);
      }

      const tags = aggregateTags(contents);
      setAllTags(tags);
    };

    aggregateAllTags();
  }, [notes, setAllTags, tagsEnabled]);

  // Clear tag filter when notes change significantly
  useEffect(() => {
    if (selectedTag && !allTags.has(selectedTag)) {
      setSelectedTag(null);
    }
  }, [allTags, selectedTag, setSelectedTag]);

  const [contextMenuNote, setContextMenuNote] = useState<NoteFile | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // Sort function based on current sort option
  const sortNotes = (notesToSort: NoteFile[]) => {
    return [...notesToSort].sort((a, b) => {
      switch (sortOption) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'name-asc':
        default:
          return a.name.localeCompare(b.name);
      }
    });
  };

  // Notes that are NOT in any folder (for the Notes section)
  const unfiledNotes = sortNotes(notes.filter((n) => !n.isDaily && !n.isWeekly && !n.folderPath));

  // All standalone notes (for FolderTree to filter by folder)
  const allStandaloneNotes = sortNotes(notes.filter((n) => !n.isDaily && !n.isWeekly));

  // Daily notes
  const dailyNotes = useMemo(() => notes.filter((n) => n.isDaily), [notes]);

  // Filter notes by selected tags (AND logic)
  const filterByTag = useMemo(() => {
    if (selectedTags.length === 0) return (notes: NoteFile[]) => notes;

    return (notes: NoteFile[]) => {
      return notes.filter((note) => {
        const content = noteContentCacheRef.current.get(note.path);
        if (!content) return false;
        return selectedTags.every((tag) => hasTag(content, tag));
      });
    };
  }, [selectedTags]);

  // Filter notes based on tag (search is handled separately with
  // full-text results from the backend).
  const displayedNotes = useMemo(() => {
    if (selectedTags.length > 0) {
      return filterByTag(notes);
    }
    return unfiledNotes;
  }, [unfiledNotes, filterByTag, selectedTags.length, notes]);

  // Keyboard shortcuts: Cmd/Ctrl+F or Cmd/Ctrl+K focuses the search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  /** Map a full-text search ContentMatch back to a loadable NoteFile. */
  const openSearchMatch = (match: ContentMatch) => {
    // The backend returns paths relative to the notes root, e.g.
    // "notes/foo/bar.md" or "daily/2026-04-23.md". The in-memory
    // note store stores paths in the same form.
    const note = notes.find((n) => n.path === match.path);
    if (note) {
      if (note.isLocked) {
        handleUnlockNote(note);
      } else {
        loadNote(note);
      }
    } else {
      console.error('[Sidebar] search match had no matching note in store:', match.path);
    }
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      searchStore.clear();
      searchInputRef.current?.blur();
    } else if (e.key === 'Enter' && searchResults.length > 0) {
      const idx = Math.max(0, Math.min(searchResults.length - 1, searchSelectedIndex));
      openSearchMatch(searchResults[idx]);
      searchInputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchStore.moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchStore.moveSelection(-1);
    }
  };

  const handleCreateNote = async () => {
    const error = getNoteTitleError(newNoteTitle);
    if (!error) {
      setPendingNoteTitle(newNoteTitle.trim());
      setNewNoteTitle('');
      setIsCreating(false);
      setShowTemplatePicker(true);
    }
  };

  const handleTemplateSelect = async (templateId: string | null) => {
    setShowTemplatePicker(false);
    const targetFolder = createNoteInFolder;
    if (templateId) {
      try {
        await createFromTemplate(pendingNoteTitle, templateId, false, targetFolder);
        toast.success('Note created from template');
      } catch (error) {
        console.error('[Sidebar] Failed to create note from template:', error);
        toast.error('Failed to create note from template');
        await createNote(pendingNoteTitle, targetFolder);
      }
    } else {
      await createNote(pendingNoteTitle, targetFolder);
    }
    setPendingNoteTitle('');
    setCreateNoteInFolder(null);
  };

  const handleTemplatePickerClose = () => {
    setShowTemplatePicker(false);
    setPendingNoteTitle('');
    setCreateNoteInFolder(null);
  };

  const handleCancelCreate = () => {
    setNewNoteTitle('');
    setIsCreating(false);
    setCreateNoteInFolder(null);
  };

  const handleCreateModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !getNoteTitleError(newNoteTitle)) {
      handleCreateNote();
    } else if (e.key === 'Escape') {
      handleCancelCreate();
    }
  };

  const handleCreateModalBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleCancelCreate();
    }
  };

  const handleTodayClick = () => {
    const today = new Date();
    setSelectedDate(today);
    loadDailyNote(today);
  };

  const isNoteActive = (note: NoteFile) => {
    if (!currentNote) return false;
    return currentNote.id === note.path;
  };

  const handleDeleteClick = (e: React.MouseEvent, note: NoteFile) => {
    e.stopPropagation();
    setNoteToDelete(note);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return;

    try {
      let relativePath: string;
      if (noteToDelete.isDaily) {
        relativePath = noteToDelete.name;
      } else {
        relativePath = noteToDelete.path.startsWith('notes/')
          ? noteToDelete.path.slice(6)
          : noteToDelete.name;
      }
      await trashNote(relativePath, noteToDelete.isDaily || false);

      if (currentNote && currentNote.id === noteToDelete.path) {
        setCurrentNote(null);
      }
    } catch (error) {
      console.error('[Sidebar] Trash failed:', error);
    } finally {
      setNoteToDelete(null);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeleteCancel = () => {
    setNoteToDelete(null);
    setShowDeleteConfirm(false);
  };

  // Context menu handlers
  const handleContextMenu = (e: React.MouseEvent, note: NoteFile) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenuNote(note);
    setContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => {
    setContextMenuNote(null);
  };

  useEffect(() => {
    const handleClick = () => closeContextMenu();
    if (contextMenuNote) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenuNote]);

  // Lock/Unlock handlers
  const handleLockNote = (note: NoteFile) => {
    setNoteToLock(note);
    setLockModalMode('lock');
    closeContextMenu();
  };

  const handleUnlockNote = (note: NoteFile) => {
    setNoteToLock(note);
    setLockModalMode('unlock');
    closeContextMenu();
  };

  const handlePermanentUnlock = (note: NoteFile) => {
    setNoteToLock(note);
    setLockModalMode('permanent-unlock');
    closeContextMenu();
  };

  const handleLockSubmit = async (password: string) => {
    if (!noteToLock) return;

    if (lockModalMode === 'lock') {
      await lockNote(noteToLock.name, password, noteToLock.isDaily);
      toast.success('Note locked');
      const updatedNotes = notes.map((n) =>
        n.path === noteToLock.path ? { ...n, isLocked: true } : n
      );
      setNotes(updatedNotes);
      if (currentNote && currentNote.id === noteToLock.path) {
        setCurrentNote(null);
      }
    } else if (lockModalMode === 'unlock') {
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
    } else if (lockModalMode === 'permanent-unlock') {
      await permanentlyUnlockNote(noteToLock.name, password, noteToLock.isDaily);
      toast.success('Note permanently unlocked');
      const updatedNotes = notes.map((n) =>
        n.path === noteToLock.path ? { ...n, isLocked: false } : n
      );
      setNotes(updatedNotes);
    }
  };

  const handleLockModalClose = () => {
    setLockModalMode(null);
    setNoteToLock(null);
  };

  // Folder handlers
  const handleMoveToFolder = (note: NoteFile) => {
    setNoteToMove(note);
    setShowMoveToFolder(true);
    closeContextMenu();
  };

  const handleMoveToFolderSelect = async (folderPath: string | null) => {
    if (!noteToMove) return;

    const relativePath = noteToMove.path.startsWith('notes/')
      ? noteToMove.path.slice(6)
      : noteToMove.path;

    await moveNoteToFolder(relativePath, folderPath ?? undefined);
    setNoteToMove(null);
    setShowMoveToFolder(false);
  };

  const handleCreateFolder = async () => {
    if (newFolderName.trim()) {
      await createNewFolder(newFolderName.trim());
      setNewFolderName('');
      setIsCreatingFolder(false);
    }
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folder: FolderInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderContextMenu(folder);
    setFolderContextMenuPosition({ x: e.clientX, y: e.clientY });
  };

  const closeFolderContextMenu = () => {
    setFolderContextMenu(null);
  };

  useEffect(() => {
    const handleClick = () => closeFolderContextMenu();
    if (folderContextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [folderContextMenu]);

  const handleRenameFolder = (folder: FolderInfo) => {
    setFolderToRename(folder);
    setRenameFolderName(folder.name);
    setIsRenamingFolder(true);
    closeFolderContextMenu();
  };

  const handleRenameFolderSubmit = async () => {
    if (folderToRename && renameFolderName.trim() && renameFolderName !== folderToRename.name) {
      await renameExistingFolder(folderToRename.path, renameFolderName.trim());
    }
    setFolderToRename(null);
    setRenameFolderName('');
    setIsRenamingFolder(false);
  };

  const handleDeleteFolder = (folder: FolderInfo) => {
    setFolderToDelete(folder);
    setShowDeleteFolderConfirm(true);
    closeFolderContextMenu();
  };

  const handleDeleteFolderConfirm = async () => {
    if (folderToDelete) {
      await trashFolder(folderToDelete.path);
    }
    setFolderToDelete(null);
    setShowDeleteFolderConfirm(false);
  };

  const handleNoteDrop = async (notePath: string, toFolder: string) => {
    await moveNoteToFolder(notePath, toFolder);
  };

  const handleFolderDrop = async (folderPath: string, toFolder: string) => {
    await moveFolderToFolder(folderPath, toFolder);
  };

  // Notes section drop zone handlers (only accepts notes, not folders)
  const handleRootDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    rootDragCounterRef.current++;
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if ((hasNoteData || hasTextData) && !hasFolderData) {
      setIsDragOverRoot(true);
    }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if ((hasNoteData || hasTextData) && !hasFolderData) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    rootDragCounterRef.current--;
    if (rootDragCounterRef.current === 0) {
      setIsDragOverRoot(false);
    }
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    rootDragCounterRef.current = 0;
    setIsDragOverRoot(false);

    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasFolderData) return;

    let notePath = e.dataTransfer.getData('application/x-note-path');
    if (!notePath) {
      notePath = e.dataTransfer.getData('text/plain');
    }
    if (notePath) {
      await moveNoteToFolder(notePath, undefined);
    }
  };

  // Folders section drop zone handlers (only accepts folders, not notes)
  const handleFoldersRootDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current++;
    if (e.dataTransfer.types.includes('application/x-folder-path')) {
      setIsDragOverFoldersRoot(true);
    }
  };

  const handleFoldersRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/x-folder-path')) {
      e.dataTransfer.dropEffect = 'move';
    }
  };

  const handleFoldersRootDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current--;
    if (foldersRootDragCounterRef.current === 0) {
      setIsDragOverFoldersRoot(false);
    }
  };

  const handleFoldersRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    foldersRootDragCounterRef.current = 0;
    setIsDragOverFoldersRoot(false);

    const folderPath = e.dataTransfer.getData('application/x-folder-path');
    if (folderPath) {
      await moveFolderToFolder(folderPath, undefined);
    }
  };

  const handleSidebarNoteClick = (note: NoteFile, e: React.MouseEvent) => {
    if (note.isLocked) {
      handleUnlockNote(note);
    } else {
      const inNewTab = e.metaKey || e.ctrlKey;
      loadNote(note, inNewTab);
    }
  };

  return (
    <div className="flex flex-col h-full select-none" style={{ color: 'var(--text-primary)' }}>
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && noteToDelete && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter">
          <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Note
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete &quot;{noteToDelete.name.replace(/\.md$/, '')}&quot;? It will be moved to trash for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={handleDeleteCancel} className="btn focus-ring">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} className="btn btn-danger focus-ring">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Note Modal */}
      {isCreating && (() => {
        const titleError = newNoteTitle.trim() ? getNoteTitleError(newNoteTitle) : null;
        return (
          <div
            className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
            onClick={handleCreateModalBackdropClick}
          >
            <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full" style={{ borderRadius: 'var(--radius-md)' }}>
              <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                New Note
              </h3>
              <input
                type="text"
                value={newNoteTitle}
                onChange={(e) => setNewNoteTitle(e.target.value)}
                onKeyDown={handleCreateModalKeyDown}
                placeholder="Note title..."
                className="input"
                style={{
                  marginBottom: titleError ? '0.5rem' : '1rem',
                  borderColor: titleError ? 'var(--status-error, #ef4444)' : undefined,
                }}
                autoFocus
              />
              {titleError && (
                <p className="text-xs mb-4" style={{ color: 'var(--status-error, #ef4444)' }}>
                  {titleError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button onClick={handleCancelCreate} className="btn focus-ring">
                  Cancel
                </button>
                <button
                  onClick={handleCreateNote}
                  disabled={!newNoteTitle.trim() || !!titleError}
                  className="btn btn-primary focus-ring"
                >
                  Create
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Settings Modal */}
      <SettingsModal />

      {/* Password Modal for Lock/Unlock */}
      {lockModalMode && noteToLock && (
        <PasswordModal
          isOpen={true}
          onClose={handleLockModalClose}
          onSubmit={handleLockSubmit}
          mode={lockModalMode}
          noteTitle={noteToLock.name.replace(/\.md$/, '')}
        />
      )}

      {/* Context Menu */}
      {contextMenuNote && (
        <div
          className="fixed z-[9999] py-1 min-w-[160px]"
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenuNote.isLocked ? (
            <>
              <button
                onClick={() => handleUnlockNote(contextMenuNote)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Unlock className="w-4 h-4" />
                View Note
              </button>
              <button
                onClick={() => handlePermanentUnlock(contextMenuNote)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <Unlock className="w-4 h-4" />
                Remove Lock
              </button>
            </>
          ) : (
            <button
              onClick={() => handleLockNote(contextMenuNote)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Lock className="w-4 h-4" />
              Lock Note
            </button>
          )}
          {!contextMenuNote.isLocked && (
            <button
              onClick={() => {
                loadNote(contextMenuNote, true);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Layers className="w-4 h-4" />
              Open in New Tab
            </button>
          )}
          {!contextMenuNote.isLocked && (
            <button
              onClick={async () => {
                try {
                  await duplicateNote(contextMenuNote);
                  toast.success('Note duplicated');
                } catch (_error) {
                  toast.error('Failed to duplicate note');
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
          )}
          {!contextMenuNote.isLocked && (
            <button
              onClick={async () => {
                try {
                  const defaultName = contextMenuNote.name.replace(/\.md$/, '');
                  const destination = await save({
                    title: 'Export Note',
                    defaultPath: `${defaultName}.md`,
                    filters: [{ name: 'Markdown', extensions: ['md'] }],
                  });
                  if (destination) {
                    await exportSingleNote(
                      contextMenuNote.name,
                      destination,
                      contextMenuNote.isDaily || false,
                      contextMenuNote.isWeekly || false
                    );
                    toast.success('Note exported');
                  }
                } catch (_error) {
                  toast.error('Failed to export note');
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <Download className="w-4 h-4" />
              Export as Markdown
            </button>
          )}
          {!contextMenuNote.isLocked && (
            <button
              onClick={async () => {
                try {
                  const defaultName = contextMenuNote.name.replace(/\.md$/, '');
                  const destination = await save({
                    title: 'Export as PDF',
                    defaultPath: `${defaultName}.pdf`,
                    filters: [{ name: 'PDF', extensions: ['pdf'] }],
                  });
                  if (destination) {
                    const content = await readNote(
                      contextMenuNote.name,
                      contextMenuNote.isDaily || false,
                      contextMenuNote.isWeekly || false
                    );
                    await exportNoteToPdf(defaultName, content, destination);
                    toast.success('Note exported as PDF');
                  }
                } catch (error) {
                  console.error('[Sidebar] PDF export failed:', error);
                  toast.error('Failed to export PDF');
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <FileDown className="w-4 h-4" />
              Export as PDF
            </button>
          )}
          {!contextMenuNote.isDaily && (
            <button
              onClick={() => handleMoveToFolder(contextMenuNote)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <FolderInput className="w-4 h-4" />
              Move to Folder...
            </button>
          )}
          <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
          <button
            onClick={(e) => {
              handleDeleteClick(e, contextMenuNote);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--error)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Trash2 className="w-4 h-4" />
            Delete Note
          </button>
        </div>
      )}

      {/* Template Picker Modal */}
      <TemplatePickerModal
        isOpen={showTemplatePicker}
        onClose={handleTemplatePickerClose}
        onSelect={handleTemplateSelect}
        title={`Choose a template for "${pendingNoteTitle}"`}
      />

      {/* Move to Folder Modal */}
      {noteToMove && (
        <MoveToFolderModal
          isOpen={showMoveToFolder}
          onClose={() => {
            setShowMoveToFolder(false);
            setNoteToMove(null);
          }}
          onSelect={handleMoveToFolderSelect}
          folders={folders}
          noteFilename={noteToMove.name}
        />
      )}

      {/* Folder Context Menu */}
      {folderContextMenu && (
        <div
          className="fixed z-[9999] py-1 min-w-[160px]"
          style={{
            left: folderContextMenuPosition.x,
            top: folderContextMenuPosition.y,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              setCreateNoteInFolder(folderContextMenu.path);
              setIsCreating(true);
              closeFolderContextMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <FilePlus className="w-4 h-4" />
            New Note in Folder
          </button>
          <button
            onClick={() => handleRenameFolder(folderContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Pencil className="w-4 h-4" />
            Rename Folder
          </button>
          <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
          <button
            onClick={() => handleDeleteFolder(folderContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--error)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            <Trash2 className="w-4 h-4" />
            Delete Folder
          </button>
        </div>
      )}

      {/* Create Folder Modal */}
      {isCreatingFolder && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
          onClick={() => setIsCreatingFolder(false)}
        >
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
            style={{ borderRadius: 'var(--radius-md)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              New Folder
            </h3>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) handleCreateFolder();
                if (e.key === 'Escape') setIsCreatingFolder(false);
              }}
              placeholder="Folder name..."
              className="input mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsCreatingFolder(false)} className="btn focus-ring">
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="btn btn-primary focus-ring"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Folder Modal */}
      {isRenamingFolder && folderToRename && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
          onClick={() => setIsRenamingFolder(false)}
        >
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
            style={{ borderRadius: 'var(--radius-md)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Rename Folder
            </h3>
            <input
              type="text"
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameFolderName.trim()) handleRenameFolderSubmit();
                if (e.key === 'Escape') setIsRenamingFolder(false);
              }}
              placeholder="Folder name..."
              className="input mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setIsRenamingFolder(false)} className="btn focus-ring">
                Cancel
              </button>
              <button
                onClick={handleRenameFolderSubmit}
                disabled={!renameFolderName.trim()}
                className="btn btn-primary focus-ring"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Folder Confirmation Modal */}
      {showDeleteFolderConfirm && folderToDelete && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter">
          <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Folder
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete &quot;{folderToDelete.name}&quot; and all its contents? They will be moved to trash for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowDeleteFolderConfirm(false);
                  setFolderToDelete(null);
                }}
                className="btn focus-ring"
              >
                Cancel
              </button>
              <button onClick={handleDeleteFolderConfirm} className="btn btn-danger focus-ring">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <SidebarSearch
        ref={searchInputRef}
        query={searchQuery}
        onChange={searchStore.setQuery}
        onKeyDown={handleSearchKeyDown}
        onClear={searchStore.clear}
        isSearching={searchLoading}
      />

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {isSearchActive ? (
          <SidebarSearchResults
            query={searchQuery}
            results={searchResults}
            loading={searchLoading}
            selectedIndex={searchSelectedIndex}
            onSelect={searchStore.setSelectedIndex}
            onOpen={openSearchMatch}
            onClear={searchStore.clear}
          />
        ) : (
          <div className="py-2">
            <SidebarNotesList
              notes={displayedNotes}
              isCollapsed={sectionsCollapsed.notes}
              onToggleSection={() => toggleSection('notes')}
              title={selectedTags.length > 0 ? 'Notes (filtered)' : 'Notes'}
              count={selectedTags.length > 0 ? displayedNotes.length : unfiledNotes.length}
              sortOption={sortOption === 'name-desc' ? 'name-desc' : 'name-asc'}
              onSortToggle={() =>
                setSortOption(sortOption === 'name-asc' ? 'name-desc' : 'name-asc')
              }
              onNewNote={() => setIsCreating(true)}
              onNoteClick={handleSidebarNoteClick}
              onNoteContextMenu={handleContextMenu}
              isNoteActive={isNoteActive}
              getNoteTags={tagsEnabled ? getNoteTags : undefined}
              isDragOverRoot={isDragOverRoot}
              onRootDragEnter={handleRootDragEnter}
              onRootDragOver={handleRootDragOver}
              onRootDragLeave={handleRootDragLeave}
              onRootDrop={handleRootDrop}
              showEmptyState={displayedNotes.length === 0 && selectedTags.length === 0}
              showFilteredEmptyState={displayedNotes.length === 0 && selectedTags.length > 0}
              filteredEmptyTagCount={selectedTags.length}
            />

            {showFoldersSection && (
              <SidebarFolderTree
                folders={folders}
                notes={allStandaloneNotes}
                expandedFolders={expandedFolders}
                isCollapsed={sectionsCollapsed.folders}
                onToggleSection={() => toggleSection('folders')}
                onToggleFolder={toggleFolder}
                onFolderContextMenu={handleFolderContextMenu}
                onNewFolder={() => setIsCreatingFolder(true)}
                onNoteDrop={handleNoteDrop}
                onFolderDrop={handleFolderDrop}
                isNoteActive={isNoteActive}
                onNoteClick={handleSidebarNoteClick}
                onNoteContextMenu={handleContextMenu}
                getNoteTags={tagsEnabled ? getNoteTags : undefined}
                isDragOverFoldersRoot={isDragOverFoldersRoot}
                onFoldersRootDragEnter={handleFoldersRootDragEnter}
                onFoldersRootDragOver={handleFoldersRootDragOver}
                onFoldersRootDragLeave={handleFoldersRootDragLeave}
                onFoldersRootDrop={handleFoldersRootDrop}
              />
            )}

            <SidebarDailyList
              notes={dailyNotes}
              isCollapsed={sectionsCollapsed.daily}
              onToggleSection={() => toggleSection('daily')}
              onNoteClick={handleSidebarNoteClick}
              onNoteContextMenu={handleContextMenu}
              isNoteActive={isNoteActive}
              onOpenToday={handleTodayClick}
            />

            {tagsEnabled && (
              <SidebarTagList
                allTags={allTags}
                selectedTag={selectedTag}
                selectedTags={selectedTags}
                tagSearchQuery={tagSearchQuery}
                isCollapsed={sectionsCollapsed.tags}
                onToggle={() => toggleSection('tags')}
                onSelectTag={setSelectedTag}
                onToggleTag={toggleTag}
                onClearFilter={clearTagFilter}
                onSearchChange={setTagSearchQuery}
                onTagsChanged={refreshNotes}
              />
            )}

            {backlinksEnabled && showBacklinksSection && (
              <BacklinksSection
                notes={notes}
                isCollapsed={sectionsCollapsed.backlinks}
                onToggle={() => toggleSection('backlinks')}
                onNoteClick={(note) => {
                  if (note.isLocked) {
                    handleUnlockNote(note);
                  } else {
                    loadNote(note);
                  }
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <SidebarFooter
        onToday={handleTodayClick}
        onNewNote={() => setIsCreating(true)}
        onSettings={() => setIsSettingsOpen(true)}
        onTrash={(anchor) => setTrashPopoverAnchor((prev) => (prev ? null : anchor))}
      />

      {/* Trash popover + read-only preview modal */}
      <TrashPopover
        isOpen={trashPopoverAnchor !== null}
        anchor={trashPopoverAnchor}
        trashedNotes={trashedNotes}
        onClose={() => setTrashPopoverAnchor(null)}
        onRestore={restoreNote}
        onPermanentDelete={permanentlyDelete}
        onEmptyTrash={emptyTrash}
        onPreview={(note) => setTrashPreviewNote(note)}
      />
      <TrashPreviewModal
        note={trashPreviewNote}
        onClose={() => setTrashPreviewNote(null)}
        onRestore={restoreNote}
        onPermanentDelete={permanentlyDelete}
      />
    </div>
  );
}
