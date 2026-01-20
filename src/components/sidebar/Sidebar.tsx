import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { save } from '@tauri-apps/plugin-dialog';
import { Lock, Unlock, Trash2, FolderPlus, FilePlus, Pencil, FolderInput, Layers, Copy, Download, FileDown, ArrowUpAZ, ArrowDownAZ } from 'lucide-react';
import { useNotes, useSearch, useFolders, useTrash } from '@/hooks';
import { useNoteStore, useSettingsStore, useTagStore } from '@/stores';
import { lockNote, unlockNote, permanentlyUnlockNote, aggregateTags, hasTag, readNote, exportSingleNote, exportNoteToPdf, getNoteTitleError } from '@/lib';
import { SettingsModal } from '@/components/settings';
import { NoSearchResultsEmptyState, NoNotesEmptyState, PasswordModal } from '@/components/ui';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';
import { useToast } from '@/hooks/useToast';
import { CollapsibleSection } from './CollapsibleSection';
import { DraggableNoteItem } from './DraggableNoteItem';
import { FolderTree } from './FolderTree';
import { MoveToFolderModal } from './MoveToFolderModal';
import { TrashModal } from './TrashModal';
import { TagsSection } from './TagsSection';
import type { NoteFile, FolderInfo } from '@/types';

type LockModalMode = 'lock' | 'unlock' | 'permanent-unlock' | null;

export function Sidebar() {
  const { notes, loadNote, loadDailyNote, createNote, createFromTemplate, duplicateNote, refresh: refreshNotes } = useNotes();
  const { currentNote, setSelectedDate, setNotes, setCurrentNote, unlockNote: trackUnlockedNote } = useNoteStore();
  const { setIsSettingsOpen, tagsEnabled, sortOption, setSortOption } = useSettingsStore();
  const search = useSearch();
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
    restoreNoteFromFolder,
    permanentlyDelete,
    emptyTrash,
    cleanupOld: cleanupOldTrash,
  } = useTrash();

  const { allTags, selectedTag, setAllTags, setSelectedTag } = useTagStore();

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
  const [appVersion, setAppVersion] = useState<string>('');

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

  // Trash state
  const [showTrashModal, setShowTrashModal] = useState(false);

  // Track target folder for new note creation
  const [createNoteInFolder, setCreateNoteInFolder] = useState<string | null>(null);

  // Notes section drop zone state (for dragging notes back to root)
  const [isDragOverRoot, setIsDragOverRoot] = useState(false);
  const rootDragCounterRef = useRef(0);

  // Folders section drop zone state (for dragging folders back to root)
  const [isDragOverFoldersRoot, setIsDragOverFoldersRoot] = useState(false);
  const foldersRootDragCounterRef = useRef(0);

  // Fetch app version
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);

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

        // Check cache first
        let content = noteContentCacheRef.current.get(note.path);
        if (content === undefined) {
          try {
            content = await readNote(note.name, note.isDaily || false);
            noteContentCacheRef.current.set(note.path, content);
          } catch (error) {
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
  const unfiledNotes = sortNotes(
    notes.filter(n => !n.isDaily && !n.folderPath)
  );

  // All standalone notes (for FolderTree to filter by folder)
  const allStandaloneNotes = sortNotes(
    notes.filter(n => !n.isDaily)
  );

  // Filter notes by selected tag
  const filterByTag = useMemo(() => {
    if (!selectedTag) return (notes: NoteFile[]) => notes;

    return (notes: NoteFile[]) => {
      return notes.filter(note => {
        const content = noteContentCacheRef.current.get(note.path);
        if (!content) return false;
        return hasTag(content, selectedTag);
      });
    };
  }, [selectedTag]);

  // Filter notes based on search and tag
  // When filtering by tag, include ALL notes (including daily notes)
  const displayedNotes = useMemo(() => {
    if (search.isActive) {
      return filterByTag(search.results.map(r => r.note));
    }
    // When a tag is selected, search all notes (including daily)
    if (selectedTag) {
      return filterByTag(notes);
    }
    return unfiledNotes;
  }, [search.isActive, search.results, unfiledNotes, filterByTag, selectedTag, notes]);

  // Keyboard shortcuts for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Cmd/Ctrl + F or Cmd/Ctrl + K: Focus search
      if (isMod && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      search.clearSearch();
      searchInputRef.current?.blur();
    } else if (e.key === 'Enter' && displayedNotes.length > 0) {
      loadNote(displayedNotes[0]);
      // Don't clear search - let user browse other results
      searchInputRef.current?.blur();
    }
  };

  const handleCreateNote = async () => {
    const error = getNoteTitleError(newNoteTitle);
    if (!error) {
      // Store the title and show template picker
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
      // Create note from template
      try {
        await createFromTemplate(pendingNoteTitle, templateId, false, targetFolder);
        toast.success('Note created from template');
      } catch (error) {
        console.error('[Sidebar] Failed to create note from template:', error);
        toast.error('Failed to create note from template');
        // Fall back to creating empty note
        await createNote(pendingNoteTitle, targetFolder);
      }
    } else {
      // Create blank note
      await createNote(pendingNoteTitle, targetFolder);
    }
    setPendingNoteTitle('');
    setCreateNoteInFolder(null);
  };

  const handleTemplatePickerClose = () => {
    setShowTemplatePicker(false);
    // Just clear the pending state - note creation is handled by handleTemplateSelect
    // Don't create note here to avoid duplication (onSelect is already called before onClose)
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
    e.stopPropagation(); // Prevent note selection
    setNoteToDelete(note);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!noteToDelete) return;

    try {
      // For notes in folders, we need the relative path (e.g., "folder/note.md")
      // noteToDelete.path is "notes/folder/note.md" or "daily/date.md"
      let relativePath: string;
      if (noteToDelete.isDaily) {
        relativePath = noteToDelete.name;
      } else {
        // Strip "notes/" prefix to get relative path within notes directory
        relativePath = noteToDelete.path.startsWith('notes/')
          ? noteToDelete.path.slice(6)
          : noteToDelete.name;
      }
      // Move to trash instead of permanent delete
      await trashNote(relativePath, noteToDelete.isDaily || false);

      // Clear current note if it's the one being deleted
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

  // Close context menu when clicking outside
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
      // Update note in list to show locked status
      const updatedNotes = notes.map(n =>
        n.path === noteToLock.path ? { ...n, isLocked: true } : n
      );
      setNotes(updatedNotes);
      // Clear current note if it's the one being locked
      if (currentNote && currentNote.id === noteToLock.path) {
        setCurrentNote(null);
      }
    } else if (lockModalMode === 'unlock') {
      const content = await unlockNote(noteToLock.name, password, noteToLock.isDaily);
      // Load the decrypted content into the editor
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
      // Track this note as temporarily unlocked for auto-lock feature
      trackUnlockedNote(noteToLock.path);
      toast.success('Note unlocked (view only)');
    } else if (lockModalMode === 'permanent-unlock') {
      await permanentlyUnlockNote(noteToLock.name, password, noteToLock.isDaily);
      toast.success('Note permanently unlocked');
      // Update note in list to show unlocked status
      const updatedNotes = notes.map(n =>
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

    // Extract the relative path within notes/ directory
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

  // Close folder context menu when clicking outside
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
      // Use trash instead of permanent delete
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
    // Only accept notes, not folders
    const hasNoteData = e.dataTransfer.types.includes('application/x-note-path');
    const hasTextData = e.dataTransfer.types.includes('text/plain');
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if ((hasNoteData || hasTextData) && !hasFolderData) {
      setIsDragOverRoot(true);
    }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    // Only accept notes, not folders
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

    // Only handle note drops (ignore folder drops in Notes section)
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasFolderData) {
      return; // Don't accept folders in Notes section
    }

    // Handle note drop
    let notePath = e.dataTransfer.getData('application/x-note-path');
    if (!notePath) {
      notePath = e.dataTransfer.getData('text/plain');
    }
    if (notePath) {
      // Move note to root (undefined means no folder)
      await moveNoteToFolder(notePath, undefined);
    }
  };

  // Folders section drop zone handlers (only accepts folders, not notes)
  const handleFoldersRootDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    foldersRootDragCounterRef.current++;
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasFolderData) {
      setIsDragOverFoldersRoot(true);
    }
  };

  const handleFoldersRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const hasFolderData = e.dataTransfer.types.includes('application/x-folder-path');
    if (hasFolderData) {
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

    // Only handle folder drops
    const folderPath = e.dataTransfer.getData('application/x-folder-path');
    if (folderPath) {
      // Move folder to root (undefined means no parent folder)
      await moveFolderToFolder(folderPath, undefined);
    }
  };

  return (
    <div className="flex flex-col h-full select-none" style={{ color: 'var(--text-primary)' }}>
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && noteToDelete && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter">
          <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Note
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete "{noteToDelete.name.replace(/\.md$/, '')}"? It will be moved to trash for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleDeleteCancel}
                className="btn focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="btn btn-danger focus-ring"
              >
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
            className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
            onClick={handleCreateModalBackdropClick}
          >
            <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full" style={{ borderRadius: 'var(--radius-md)' }}>
              <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                New Note
              </h3>
              <input
                type="text"
                value={newNoteTitle}
                onChange={e => setNewNoteTitle(e.target.value)}
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
                <p
                  className="text-xs mb-4"
                  style={{ color: 'var(--status-error, #ef4444)' }}
                >
                  {titleError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleCancelCreate}
                  className="btn focus-ring"
                >
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
          className="fixed z-50 py-1 min-w-[160px]"
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
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <Unlock className="w-4 h-4" />
                View Note
              </button>
              <button
                onClick={() => handlePermanentUnlock(contextMenuNote)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Lock className="w-4 h-4" />
              Lock Note
            </button>
          )}
          {/* Open in New Tab */}
          {!contextMenuNote.isLocked && (
            <button
              onClick={() => {
                loadNote(contextMenuNote, true);
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Layers className="w-4 h-4" />
              Open in New Tab
            </button>
          )}
          {/* Duplicate Note */}
          {!contextMenuNote.isLocked && (
            <button
              onClick={async () => {
                try {
                  await duplicateNote(contextMenuNote);
                  toast.success('Note duplicated');
                } catch (error) {
                  toast.error('Failed to duplicate note');
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Copy className="w-4 h-4" />
              Duplicate
            </button>
          )}
          {/* Export Note as Markdown */}
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
                } catch (error) {
                  toast.error('Failed to export note');
                }
                closeContextMenu();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <Download className="w-4 h-4" />
              Export as Markdown
            </button>
          )}
          {/* Export Note as PDF */}
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
                    // Read the note content
                    const content = await readNote(
                      contextMenuNote.name,
                      contextMenuNote.isDaily || false,
                      contextMenuNote.isWeekly || false
                    );
                    // Export as PDF
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
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
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
          className="fixed z-50 py-1 min-w-[160px]"
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
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <FilePlus className="w-4 h-4" />
            New Note in Folder
          </button>
          <button
            onClick={() => handleRenameFolder(folderContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Pencil className="w-4 h-4" />
            Rename Folder
          </button>
          <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
          <button
            onClick={() => handleDeleteFolder(folderContextMenu)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors"
            style={{ color: 'var(--error)' }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--hover-overlay)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <Trash2 className="w-4 h-4" />
            Delete Folder
          </button>
        </div>
      )}

      {/* Create Folder Modal */}
      {isCreatingFolder && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
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
              <button
                onClick={() => setIsCreatingFolder(false)}
                className="btn focus-ring"
              >
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
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
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
              <button
                onClick={() => setIsRenamingFolder(false)}
                className="btn focus-ring"
              >
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
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter">
          <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Folder
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete "{folderToDelete.name}" and all its contents? They will be moved to trash for 7 days.
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
              <button
                onClick={handleDeleteFolderConfirm}
                className="btn btn-danger focus-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search Bar */}
      <div className="px-3 py-3">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--text-muted)' }}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search notes..."
            className="search-input search-input-polished w-full pl-9 pr-8 py-2 focus:outline-none"
            style={{ borderRadius: 'var(--radius-sm)' }}
          />
          {search.query && (
            <button
              onClick={() => search.clearSearch()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 search-clear-btn transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <svg className="w-4 h-4 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {search.isSearching && (
          <p className="text-xs mt-1 px-1" style={{ color: 'var(--text-muted)' }}>
            Searching...
          </p>
        )}
      </div>

      {/* Notes and Folders */}
      <div className="flex-1 overflow-y-auto">
        {/* Search Results or Normal View */}
        {search.isActive ? (
          // Search Results View
          <div className="px-3 py-2">
            <div className="flex items-center justify-between mb-2">
              <h2 className="section-header">
                {search.resultCount} {search.resultCount === 1 ? 'result' : 'results'}
              </h2>
            </div>
            <div className="space-y-1">
              {search.results.map((result) => (
                <div key={result.note.path}>
                  <DraggableNoteItem
                    note={result.note}
                    isActive={isNoteActive(result.note)}
                    onClick={(e) => {
                      if (result.note.isLocked) {
                        handleUnlockNote(result.note);
                      } else {
                        const inNewTab = e.metaKey || e.ctrlKey;
                        loadNote(result.note, inNewTab);
                        // Don't clear search - let user browse other results
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, result.note)}
                  />
                  {result.highlightedPreview && (
                    <p
                      className="text-xs px-3 pb-1 truncate search-preview"
                      style={{ color: 'var(--text-muted)', marginTop: '-2px' }}
                      dangerouslySetInnerHTML={{ __html: result.highlightedPreview }}
                    />
                  )}
                </div>
              ))}
              {search.results.length === 0 && (
                <NoSearchResultsEmptyState
                  query={search.query}
                  onClear={search.clearSearch}
                />
              )}
            </div>
          </div>
        ) : (
          // Normal View with Collapsible Sections
          <div className="py-2">
            {/* Notes Section - Unfiled notes only */}
            <CollapsibleSection
              title={selectedTag ? `Notes #${selectedTag}` : "Notes"}
              isCollapsed={sectionsCollapsed.notes}
              onToggle={() => toggleSection('notes')}
              count={selectedTag ? displayedNotes.length : unfiledNotes.length}
              rightAction={
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => setSortOption(sortOption === 'name-asc' ? 'name-desc' : 'name-asc')}
                    className="p-1 transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    title={sortOption === 'name-asc' ? 'Sort Z-A' : 'Sort A-Z'}
                  >
                    {sortOption === 'name-asc' ? (
                      <ArrowUpAZ className="w-4 h-4" />
                    ) : (
                      <ArrowDownAZ className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => setIsCreating(true)}
                    className="p-1 transition-colors"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                    title="New note"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                </div>
              }
            >
              <div
                className="px-3 space-y-1 min-h-[20px] transition-colors"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isDragOverRoot ? 'var(--accent-subtle)' : 'transparent',
                  boxShadow: isDragOverRoot ? '0 0 0 2px var(--accent-primary)' : 'none',
                }}
                onDragEnter={handleRootDragEnter}
                onDragOver={handleRootDragOver}
                onDragLeave={handleRootDragLeave}
                onDrop={handleRootDrop}
              >
                {displayedNotes.map((note) => (
                  <DraggableNoteItem
                    key={note.path}
                    note={note}
                    isActive={isNoteActive(note)}
                    onClick={(e) => {
                      if (note.isLocked) {
                        handleUnlockNote(note);
                      } else {
                        const inNewTab = e.metaKey || e.ctrlKey;
                        loadNote(note, inNewTab);
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, note)}
                  />
                ))}
                {displayedNotes.length === 0 && !selectedTag && (
                  <NoNotesEmptyState onCreateNote={() => setIsCreating(true)} />
                )}
                {displayedNotes.length === 0 && selectedTag && (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No notes with #{selectedTag}
                  </p>
                )}
              </div>
            </CollapsibleSection>

            {/* Folders Section */}
            <CollapsibleSection
              title="Folders"
              isCollapsed={sectionsCollapsed.folders}
              onToggle={() => toggleSection('folders')}
              count={folders.length}
              rightAction={
                <button
                  onClick={() => setIsCreatingFolder(true)}
                  className="p-1 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                  title="New folder"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
              }
            >
              <div
                className="px-1 min-h-[20px] transition-colors"
                style={{
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: isDragOverFoldersRoot ? 'var(--accent-subtle)' : 'transparent',
                  boxShadow: isDragOverFoldersRoot ? '0 0 0 2px var(--accent-primary)' : 'none',
                }}
                onDragEnter={handleFoldersRootDragEnter}
                onDragOver={handleFoldersRootDragOver}
                onDragLeave={handleFoldersRootDragLeave}
                onDrop={handleFoldersRootDrop}
              >
                {folders.length > 0 ? (
                  <FolderTree
                    folders={folders}
                    notes={allStandaloneNotes}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                    onFolderContextMenu={handleFolderContextMenu}
                    onNoteDrop={handleNoteDrop}
                    onFolderDrop={handleFolderDrop}
                    isNoteActive={isNoteActive}
                    onNoteClick={(note, e) => {
                      if (note.isLocked) {
                        handleUnlockNote(note);
                      } else {
                        const inNewTab = e.metaKey || e.ctrlKey;
                        loadNote(note, inNewTab);
                      }
                    }}
                    onNoteContextMenu={handleContextMenu}
                  />
                ) : (
                  <p className="px-3 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    No folders yet
                  </p>
                )}
              </div>
            </CollapsibleSection>

            {/* Tags Section */}
            {tagsEnabled && (
              <TagsSection
                allTags={allTags}
                selectedTag={selectedTag}
                isCollapsed={sectionsCollapsed.tags}
                onToggle={() => toggleSection('tags')}
                onSelectTag={setSelectedTag}
                onTagsChanged={refreshNotes}
              />
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--border-default)' }}>
        {/* Action Buttons */}
        <div className="px-3 pt-3 pb-2 space-y-2">
          <button
            onClick={handleTodayClick}
            className="btn btn-primary w-full py-2.5 focus-ring"
          >
            Today's Note
          </button>
          <button
            onClick={() => setIsCreating(true)}
            className="btn w-full py-2 focus-ring"
          >
            + New Note
          </button>
        </div>

        {/* Settings & Trash Icons */}
        <div className="px-3 pb-2 flex justify-center gap-1">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 transition-colors"
            style={{
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
            title="Settings (⌘,)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={() => setShowTrashModal(true)}
            className="p-2 transition-colors"
            style={{
              borderRadius: 'var(--radius-sm)',
              color: 'var(--text-muted)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
            title="Trash"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>

        {/* App Info */}
        <div className="px-3 pb-3 flex flex-col items-center">
          <div className="text-center">
            <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
              NOTOMATTIC
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
              v{appVersion || '...'}
            </p>
          </div>
        </div>
      </div>

      {/* Trash Modal */}
      <TrashModal
        isOpen={showTrashModal}
        onClose={() => setShowTrashModal(false)}
        trashedNotes={trashedNotes}
        onRestore={restoreNote}
        onRestoreNoteFromFolder={restoreNoteFromFolder}
        onPermanentDelete={permanentlyDelete}
        onEmptyTrash={emptyTrash}
      />
    </div>
  );
}
