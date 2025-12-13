import React, { useState, useRef, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Lock, Unlock, Trash2, MoreHorizontal } from 'lucide-react';
import { useNotes, useSearch } from '@/hooks';
import { useNoteStore, useSettingsStore } from '@/stores';
import { deleteNote, lockNote, unlockNote, permanentlyUnlockNote } from '@/lib';
import { SettingsModal } from '@/components/settings';
import { NoSearchResultsEmptyState, NoNotesEmptyState, PasswordModal } from '@/components/ui';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';
import { useToast } from '@/hooks/useToast';
import type { NoteFile } from '@/types';

type LockModalMode = 'lock' | 'unlock' | 'permanent-unlock' | null;

export function Sidebar() {
  const { notes, loadNote, loadDailyNote, createNote, createFromTemplate } = useNotes();
  const { currentNote, setSelectedDate, setNotes, setCurrentNote } = useNoteStore();
  const { setIsSettingsOpen } = useSettingsStore();
  const search = useSearch();
  const toast = useToast();
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

  // Fetch app version
  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion('0.0.0'));
  }, []);
  const [contextMenuNote, setContextMenuNote] = useState<NoteFile | null>(null);
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });

  // Get standalone notes only (daily notes accessed via calendar)
  const standaloneNotes = notes
    .filter(n => !n.isDaily)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Filter notes based on search
  const displayedNotes = search.isActive
    ? search.results.map(r => r.note)
    : standaloneNotes;

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
      search.clearSearch();
      searchInputRef.current?.blur();
    }
  };

  const handleCreateNote = async () => {
    if (newNoteTitle.trim()) {
      // Store the title and show template picker
      setPendingNoteTitle(newNoteTitle.trim());
      setNewNoteTitle('');
      setIsCreating(false);
      setShowTemplatePicker(true);
    }
  };

  const handleTemplateSelect = async (templateId: string | null) => {
    setShowTemplatePicker(false);
    if (templateId) {
      // Create note from template
      try {
        await createFromTemplate(pendingNoteTitle, templateId, false);
        toast.success('Note created from template');
      } catch (error) {
        console.error('[Sidebar] Failed to create note from template:', error);
        toast.error('Failed to create note from template');
        // Fall back to creating empty note
        await createNote(pendingNoteTitle);
      }
    } else {
      // Create blank note
      await createNote(pendingNoteTitle);
    }
    setPendingNoteTitle('');
  };

  const handleTemplatePickerClose = () => {
    setShowTemplatePicker(false);
    // Create blank note if user closes without selecting
    if (pendingNoteTitle) {
      createNote(pendingNoteTitle);
      setPendingNoteTitle('');
    }
  };

  const handleCancelCreate = () => {
    setNewNoteTitle('');
    setIsCreating(false);
  };

  const handleCreateModalKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newNoteTitle.trim()) {
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
      const filename = noteToDelete.name;
      await deleteNote(filename, noteToDelete.isDaily || false);

      // Remove from notes list
      const updatedNotes = notes.filter(n => n.path !== noteToDelete.path);
      setNotes(updatedNotes);

      // Clear current note if it's the one being deleted
      if (currentNote && currentNote.id === noteToDelete.path) {
        setCurrentNote(null);
      }
    } catch (error) {
      console.error('[Sidebar] Delete failed:', error);
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
        date: noteToLock.date,
      };
      setCurrentNote(note);
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

  return (
    <div className="flex flex-col h-full">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && noteToDelete && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter">
          <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Delete Note
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Delete "{noteToDelete.name.replace(/\.md$/, '')}"? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-3 py-1.5 text-sm font-medium text-white rounded btn-danger-gradient btn-elevated focus-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Note Modal */}
      {isCreating && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
          onClick={handleCreateModalBackdropClick}
        >
          <div className="bg-white dark:bg-gray-800 rounded-md p-6 max-w-sm mx-4 w-full modal-elevated modal-content-enter">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              New Note
            </h3>
            <input
              type="text"
              value={newNoteTitle}
              onChange={e => setNewNoteTitle(e.target.value)}
              onKeyDown={handleCreateModalKeyDown}
              placeholder="Note title..."
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={handleCancelCreate}
                className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateNote}
                disabled={!newNoteTitle.trim()}
                className={`px-3 py-1.5 text-sm font-medium text-white rounded btn-primary-gradient focus-ring ${
                  !newNoteTitle.trim() ? 'btn-disabled' : 'btn-elevated'
                }`}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

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
          className="fixed z-50 bg-white dark:bg-gray-800 rounded shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[160px]"
          style={{
            left: contextMenuPosition.x,
            top: contextMenuPosition.y,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenuNote.isLocked ? (
            <>
              <button
                onClick={() => handleUnlockNote(contextMenuNote)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Unlock className="w-4 h-4" />
                View Note
              </button>
              <button
                onClick={() => handlePermanentUnlock(contextMenuNote)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                <Unlock className="w-4 h-4" />
                Remove Lock
              </button>
            </>
          ) : (
            <button
              onClick={() => handleLockNote(contextMenuNote)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <Lock className="w-4 h-4" />
              Lock Note
            </button>
          )}
          <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
          <button
            onClick={(e) => {
              handleDeleteClick(e, contextMenuNote);
              closeContextMenu();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700"
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

      {/* Today Button */}
      <div className="p-3">
        <button
          onClick={handleTodayClick}
          className="w-full px-3 py-2.5 text-sm font-medium text-white rounded btn-primary-gradient btn-elevated focus-ring"
        >
          Today's Note
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-3 pb-2">
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
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
            className="w-full pl-9 pr-8 py-2 text-sm rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 search-input-polished focus:outline-none"
          />
          {search.query && (
            <button
              onClick={() => search.clearSearch()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 search-clear-btn"
            >
              <svg className="w-4 h-4 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        {search.isSearching && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 px-1">
            Searching...
          </p>
        )}
      </div>

      {/* Notes */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {search.isActive
                ? `${search.resultCount} ${search.resultCount === 1 ? 'result' : 'results'}`
                : 'Notes'}
            </h2>
            <button
              onClick={() => setIsCreating(true)}
              className="p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              title="New note"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          </div>

          <div className="space-y-0.5">
            {displayedNotes.map((note, index) => (
              <div
                key={note.path}
                className="group relative list-item-stagger"
                style={{ '--index': index } as React.CSSProperties}
                onContextMenu={(e) => handleContextMenu(e, note)}
              >
                <button
                  onClick={() => {
                    if (note.isLocked) {
                      // Open unlock modal for locked notes
                      handleUnlockNote(note);
                    } else {
                      loadNote(note);
                      search.clearSearch();
                    }
                  }}
                  className={`note-card sidebar-item-animated w-full text-left text-sm truncate pr-8 focus-ring ${
                    isNoteActive(note) ? 'note-card-active text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {note.isLocked && (
                      <Lock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    )}
                    <span className="truncate">{note.name.replace(/\.md$/, '')}</span>
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setContextMenuNote(note);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenuPosition({ x: rect.right, y: rect.top });
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-1 delete-btn-fade text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                  title="More options"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {displayedNotes.length === 0 && (
              search.isActive ? (
                <NoSearchResultsEmptyState
                  query={search.query}
                  onClear={search.clearSearch}
                />
              ) : (
                <NoNotesEmptyState onCreateNote={() => setIsCreating(true)} />
              )
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 dark:border-gray-700">
        {/* New Note Button */}
        <div className="p-3 pb-2">
          <button
            onClick={() => setIsCreating(true)}
            className="w-full px-3 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-all shadow-system-xs hover:shadow-system-sm focus-ring"
          >
            + New Note
          </button>
        </div>

        {/* Settings & App Info */}
        <div className="px-3 pb-3 flex flex-col items-center gap-2">
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="Settings (⌘,)"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <div className="text-center">
            <p className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
              Notomattic
            </p>
            <p className="text-[10px] text-gray-300 dark:text-gray-600">
              v{appVersion || '...'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
