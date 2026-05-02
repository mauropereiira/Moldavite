import React, { Suspense, lazy, useState, useRef, useEffect, useMemo } from 'react';
import {
  useNotes,
  useFolders,
  useTrash,
  useSidebarContextMenu,
  useSidebarLock,
  useSidebarTags,
  useSidebarDnd,
} from '@/hooks';
import {
  useNoteStore,
  useSettingsStore,
  useTagStore,
  useSearchStore,
  useNoteSelectionStore,
} from '@/stores';
import type { ContentMatch } from '@/stores';
import { getNoteTitleError } from '@/lib';
import { PasswordModal } from '@/components/ui';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';
import { useToast } from '@/hooks/useToast';
import { MoveToFolderModal } from './MoveToFolderModal';
import { NoteContextMenu } from './NoteContextMenu';
import { FolderContextMenu } from './FolderContextMenu';
import { SidebarModals } from './SidebarModals';
import { TrashPopover } from './TrashPopover';
import { BulkActionBar } from './BulkActionBar';
import { BulkExportModal } from './BulkExportModal';

// Modals that only mount on-demand — code-split to keep them out of the
// main bundle. Tiptap + markdown-it + DOMPurify (~200 KB gz) in
// TrashPreviewModal and the entire settings tree (~150 KB) don't need
// to ship with the first render.
const SettingsModal = lazy(() =>
  import('@/components/settings').then((m) => ({ default: m.SettingsModal })),
);
const TrashPreviewModal = lazy(() =>
  import('./TrashPreviewModal').then((m) => ({ default: m.TrashPreviewModal })),
);
import { ForgeSwitcher } from './ForgeSwitcher';
import { ManageForgesModal } from './ManageForgesModal';
import { SidebarTagList } from './SidebarTagList';
import { BacklinksSection } from './BacklinksSection';
import { SidebarSearch } from './SidebarSearch';
import { SidebarSearchResults } from './SidebarSearchResults';
import { SidebarNotesList } from './SidebarNotesList';
import { SidebarFolderTree } from './SidebarFolderTree';
import { SidebarDailyList } from './SidebarDailyList';
import { SidebarFooter } from './SidebarFooter';
import type { NoteFile, FolderInfo, TrashedNote } from '@/types';

export function Sidebar() {
  const { notes, loadNote, loadDailyNote, createNote, createFromTemplate, duplicateNote, refresh: refreshNotes } = useNotes();
  const { currentNote, setSelectedDate, setCurrentNote } = useNoteStore();
  const lock = useSidebarLock();
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
    setSelectedTag,
    toggleTag,
    clearFilter: clearTagFilter,
    setTagSearchQuery,
  } = useTagStore();
  const { getNoteTags, filterByTag } = useSidebarTags(notes);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState('');
  const [noteToDelete, setNoteToDelete] = useState<NoteFile | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingNoteTitle, setPendingNoteTitle] = useState('');

  // Folder state
  const [showMoveToFolder, setShowMoveToFolder] = useState(false);
  const [noteToMove, setNoteToMove] = useState<NoteFile | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
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

  // Root-level drop zones (notes section accepts notes, folders section
  // accepts folders). Lives in a dedicated hook.
  const dnd = useSidebarDnd({ moveNoteToFolder, moveFolderToFolder });

  // Initialize folders
  useEffect(() => {
    initializeFolders();
  }, [initializeFolders]);

  // Initialize trash and cleanup old items
  useEffect(() => {
    loadTrash();
    cleanupOldTrash();
  }, [loadTrash, cleanupOldTrash]);

  const { noteMenu, folderMenu } = useSidebarContextMenu();

  // Bulk selection state — the store holds the set of selected ids, this
  // component owns the UI affordances (anchor for shift-range, move/trash
  // modals) that sit on top of it.
  const selectionToggle = useNoteSelectionStore((s) => s.toggle);
  const selectionSelectRange = useNoteSelectionStore((s) => s.selectRange);
  const selectionClear = useNoteSelectionStore((s) => s.clear);
  const selectionAnchorRef = useRef<string | null>(null);
  const [showBulkMoveModal, setShowBulkMoveModal] = useState(false);
  const [showManageForges, setShowManageForges] = useState(false);
  const [showBulkTrashConfirm, setShowBulkTrashConfirm] = useState(false);
  const [showBulkExportModal, setShowBulkExportModal] = useState(false);

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

  const handleContextMenu = noteMenu.open;
  const closeContextMenu = noteMenu.close;

  // Lock/Unlock handlers — thin wrappers that close the context menu too.
  const handleLockNote = (note: NoteFile) => {
    lock.openLock(note);
    closeContextMenu();
  };
  const handleUnlockNote = (note: NoteFile) => {
    lock.openUnlock(note);
    closeContextMenu();
  };
  const handlePermanentUnlock = (note: NoteFile) => {
    lock.openPermanentUnlock(note);
    closeContextMenu();
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

  const handleFolderContextMenu = (e: React.MouseEvent, folder: FolderInfo) =>
    folderMenu.open(folder, e);
  const closeFolderContextMenu = folderMenu.close;

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

  const handleSidebarNoteClick = (note: NoteFile, e: React.MouseEvent) => {
    if (note.isLocked) {
      handleUnlockNote(note);
    } else {
      const inNewTab = e.metaKey || e.ctrlKey;
      loadNote(note, inNewTab);
    }
  };

  /**
   * Flat list of note ids (paths) in display order, used to resolve
   * shift-click ranges. Kept in one place so ordering is consistent whether
   * the user shift-clicks in the unfiled notes, a folder, or a mix of both
   * (folders appear in tree order between their parent and next sibling).
   *
   * Notes inside collapsed folders are excluded — a user who can't see them
   * almost certainly didn't mean to include them in a visual range.
   */
  const visibleNoteIds = useMemo(() => {
    const ids: string[] = [];
    // Unfiled notes first, matching the Notes section render order
    for (const n of displayedNotes) ids.push(n.path);
    // Then folder notes, depth-first, only when the folder is expanded
    const walk = (fs: FolderInfo[]) => {
      for (const f of fs) {
        if (!expandedFolders.includes(f.path)) continue;
        // Child folders render before child notes (see FolderItem)
        if (f.children.length > 0) walk(f.children);
        for (const n of allStandaloneNotes) {
          if (n.folderPath === f.path) ids.push(n.path);
        }
      }
    };
    walk(folders);
    return ids;
  }, [displayedNotes, allStandaloneNotes, folders, expandedFolders]);

  const handleSelectionClick = (note: NoteFile, e: React.MouseEvent) => {
    const id = note.path;
    if (e.shiftKey && selectionAnchorRef.current) {
      // Range select between anchor and this row in whatever order they appear
      const anchor = selectionAnchorRef.current;
      const a = visibleNoteIds.indexOf(anchor);
      const b = visibleNoteIds.indexOf(id);
      if (a === -1 || b === -1) {
        // Anchor is no longer visible — fall back to toggle behaviour
        selectionToggle(id);
        selectionAnchorRef.current = id;
        return;
      }
      const [lo, hi] = a < b ? [a, b] : [b, a];
      selectionSelectRange(visibleNoteIds.slice(lo, hi + 1));
      return;
    }
    // Cmd/Ctrl click — toggle and update the anchor so a follow-up shift-click
    // ranges from here.
    selectionToggle(id);
    selectionAnchorRef.current = id;
  };

  /** Resolve selected ids back to NoteFile objects (current snapshot). */
  const resolveSelectedNotes = (): NoteFile[] => {
    const ids = useNoteSelectionStore.getState().selectedIds;
    return notes.filter((n) => ids.has(n.path));
  };

  const handleBulkMoveSelect = async (folderPath: string | null) => {
    const selected = resolveSelectedNotes();
    setShowBulkMoveModal(false);
    if (selected.length === 0) return;

    const results = await Promise.allSettled(
      selected.map((n) => {
        const relative = n.path.startsWith('notes/') ? n.path.slice(6) : n.path;
        return moveNoteToFolder(relative, folderPath ?? undefined);
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      toast.error(`Failed to move ${failed} note${failed === 1 ? '' : 's'}`);
    } else {
      toast.success(`Moved ${selected.length} note${selected.length === 1 ? '' : 's'}`);
    }
    selectionClear();
  };

  const handleBulkTrashConfirm = async () => {
    const selected = resolveSelectedNotes();
    setShowBulkTrashConfirm(false);
    if (selected.length === 0) return;

    const results = await Promise.allSettled(
      selected.map((n) => {
        const relative = n.isDaily
          ? n.name
          : n.path.startsWith('notes/')
            ? n.path.slice(6)
            : n.name;
        return trashNote(relative, n.isDaily || false);
      }),
    );
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Drop the current note from view if it was trashed
    if (currentNote && selected.some((n) => n.path === currentNote.id)) {
      setCurrentNote(null);
    }

    if (failed > 0) {
      toast.error(`Failed to trash ${failed} note${failed === 1 ? '' : 's'}`);
    } else {
      toast.success(`Moved ${selected.length} note${selected.length === 1 ? '' : 's'} to trash`);
    }
    selectionClear();
  };

  const handleSidebarRootClick = (e: React.MouseEvent) => {
    // Only clear when the user clicks truly-empty sidebar chrome. Note rows,
    // folder rows, buttons etc. call stopPropagation (or are interactive
    // elements handled above this), so clicks on them never bubble here.
    if (e.target === e.currentTarget) {
      if (useNoteSelectionStore.getState().selectedIds.size > 0) {
        selectionClear();
        selectionAnchorRef.current = null;
      }
    }
  };

  // Esc clears the selection — registered centrally in useKeyboardShortcuts.
  // We still reset the local anchor ref alongside it, which is why we keep
  // a lightweight listener here.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (useNoteSelectionStore.getState().selectedIds.size === 0) return;
      selectionAnchorRef.current = null;
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  // Keep the store pristine across unmounts (e.g. hot reload in dev).
  useEffect(() => {
    return () => {
      selectionClear();
    };
  }, [selectionClear]);


  return (
    <div
      className="flex flex-col h-full select-none relative"
      style={{ color: 'var(--text-primary)' }}
      onClick={handleSidebarRootClick}
    >
      <SidebarModals
        deleteNote={showDeleteConfirm ? noteToDelete : null}
        onDeleteNoteConfirm={handleDeleteConfirm}
        onDeleteNoteCancel={handleDeleteCancel}
        isCreatingNote={isCreating}
        newNoteTitle={newNoteTitle}
        onNewNoteTitleChange={setNewNoteTitle}
        onCreateNote={handleCreateNote}
        onCancelCreateNote={handleCancelCreate}
        isCreatingFolder={isCreatingFolder}
        newFolderName={newFolderName}
        onNewFolderNameChange={setNewFolderName}
        onCreateFolder={handleCreateFolder}
        onCancelCreateFolder={() => setIsCreatingFolder(false)}
        renamingFolder={isRenamingFolder ? folderToRename : null}
        renameFolderName={renameFolderName}
        onRenameFolderNameChange={setRenameFolderName}
        onRenameFolderSubmit={handleRenameFolderSubmit}
        onCancelRenameFolder={() => setIsRenamingFolder(false)}
        deleteFolder={showDeleteFolderConfirm ? folderToDelete : null}
        onDeleteFolderConfirm={handleDeleteFolderConfirm}
        onDeleteFolderCancel={() => {
          setShowDeleteFolderConfirm(false);
          setFolderToDelete(null);
        }}
      />

      {/* Settings Modal — lazy-loaded so the ~2k-line tab tree stays out of
          the main bundle until the user opens it. */}
      <Suspense fallback={null}>
        <SettingsModal />
      </Suspense>

      {/* Password Modal for Lock/Unlock */}
      {lock.mode && lock.noteToLock && (
        <PasswordModal
          isOpen={true}
          onClose={lock.close}
          onSubmit={(password) => lock.submit(password, notes)}
          mode={lock.mode}
          noteTitle={lock.noteToLock.name.replace(/\.md$/, '')}
        />
      )}

      {/* Context Menu */}
      {noteMenu.target && (
        <NoteContextMenu
          note={noteMenu.target}
          position={noteMenu.position}
          onOpenInNewTab={(note) => loadNote(note, true)}
          onDuplicate={duplicateNote}
          onLock={handleLockNote}
          onUnlock={handleUnlockNote}
          onPermanentUnlock={handlePermanentUnlock}
          onMoveToFolder={handleMoveToFolder}
          onDelete={handleDeleteClick}
          onClose={closeContextMenu}
        />
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
      {folderMenu.target && (
        <FolderContextMenu
          folder={folderMenu.target}
          position={folderMenu.position}
          onNewNoteInFolder={(folder) => {
            setCreateNoteInFolder(folder.path);
            setIsCreating(true);
            closeFolderContextMenu();
          }}
          onRename={handleRenameFolder}
          onDelete={handleDeleteFolder}
        />
      )}

      {/* Forge switcher (above search) */}
      <ForgeSwitcher onManage={() => setShowManageForges(true)} />

      <ManageForgesModal
        isOpen={showManageForges}
        onClose={() => setShowManageForges(false)}
      />

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
              onNoteSelectionClick={handleSelectionClick}
              onNoteContextMenu={handleContextMenu}
              isNoteActive={isNoteActive}
              getNoteTags={tagsEnabled ? getNoteTags : undefined}
              isDragOverRoot={dnd.isDragOverRoot}
              onRootDragEnter={dnd.onRootDragEnter}
              onRootDragOver={dnd.onRootDragOver}
              onRootDragLeave={dnd.onRootDragLeave}
              onRootDrop={dnd.onRootDrop}
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
                onNoteSelectionClick={handleSelectionClick}
                onNoteContextMenu={handleContextMenu}
                getNoteTags={tagsEnabled ? getNoteTags : undefined}
                isDragOverFoldersRoot={dnd.isDragOverFoldersRoot}
                onFoldersRootDragEnter={dnd.onFoldersRootDragEnter}
                onFoldersRootDragOver={dnd.onFoldersRootDragOver}
                onFoldersRootDragLeave={dnd.onFoldersRootDragLeave}
                onFoldersRootDrop={dnd.onFoldersRootDrop}
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

      {/* Bulk selection floating bar + its modals */}
      <BulkActionBar
        onMoveToFolder={() => setShowBulkMoveModal(true)}
        onTrash={() => setShowBulkTrashConfirm(true)}
        onExport={() => setShowBulkExportModal(true)}
      />

      <BulkExportModal
        isOpen={showBulkExportModal}
        onClose={() => setShowBulkExportModal(false)}
      />

      {showBulkMoveModal && (
        <MoveToFolderModal
          isOpen={showBulkMoveModal}
          onClose={() => setShowBulkMoveModal(false)}
          onSelect={handleBulkMoveSelect}
          folders={folders}
          bulkCount={useNoteSelectionStore.getState().selectedIds.size}
        />
      )}

      {showBulkTrashConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter">
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Trash Notes
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Move {useNoteSelectionStore.getState().selectedIds.size} note
              {useNoteSelectionStore.getState().selectedIds.size === 1 ? '' : 's'} to trash? They
              will be kept for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowBulkTrashConfirm(false)}
                className="btn focus-ring"
              >
                Cancel
              </button>
              <button onClick={handleBulkTrashConfirm} className="btn btn-danger focus-ring">
                Trash
              </button>
            </div>
          </div>
        </div>
      )}

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
      {/* Trash preview pulls in Tiptap + markdown-it + DOMPurify — only
          mount it when the user actually opens a trashed note. */}
      {trashPreviewNote && (
        <Suspense fallback={null}>
          <TrashPreviewModal
            note={trashPreviewNote}
            onClose={() => setTrashPreviewNote(null)}
            onRestore={restoreNote}
            onPermanentDelete={permanentlyDelete}
          />
        </Suspense>
      )}
    </div>
  );
}
