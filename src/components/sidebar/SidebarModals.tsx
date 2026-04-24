import { getNoteTitleError } from '@/lib';
import type { NoteFile, FolderInfo } from '@/types';

/**
 * Sidebar modal props bundle. These five modals share backdrop styling,
 * live at the top of the sidebar, and all take the same basic
 * open/close/confirm pattern, so they're grouped here to keep Sidebar.tsx
 * lean.
 */
export interface SidebarModalsProps {
  // Delete Note
  deleteNote: NoteFile | null;
  onDeleteNoteConfirm: () => void;
  onDeleteNoteCancel: () => void;

  // Create Note
  isCreatingNote: boolean;
  newNoteTitle: string;
  onNewNoteTitleChange: (v: string) => void;
  onCreateNote: () => void;
  onCancelCreateNote: () => void;

  // Create Folder
  isCreatingFolder: boolean;
  newFolderName: string;
  onNewFolderNameChange: (v: string) => void;
  onCreateFolder: () => void;
  onCancelCreateFolder: () => void;

  // Rename Folder
  renamingFolder: FolderInfo | null;
  renameFolderName: string;
  onRenameFolderNameChange: (v: string) => void;
  onRenameFolderSubmit: () => void;
  onCancelRenameFolder: () => void;

  // Delete Folder
  deleteFolder: FolderInfo | null;
  onDeleteFolderConfirm: () => void;
  onDeleteFolderCancel: () => void;
}

export function SidebarModals(props: SidebarModalsProps) {
  const {
    deleteNote,
    onDeleteNoteConfirm,
    onDeleteNoteCancel,
    isCreatingNote,
    newNoteTitle,
    onNewNoteTitleChange,
    onCreateNote,
    onCancelCreateNote,
    isCreatingFolder,
    newFolderName,
    onNewFolderNameChange,
    onCreateFolder,
    onCancelCreateFolder,
    renamingFolder,
    renameFolderName,
    onRenameFolderNameChange,
    onRenameFolderSubmit,
    onCancelRenameFolder,
    deleteFolder,
    onDeleteFolderConfirm,
    onDeleteFolderCancel,
  } = props;

  const titleError = isCreatingNote && newNoteTitle.trim() ? getNoteTitleError(newNoteTitle) : null;

  const handleCreateNoteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !getNoteTitleError(newNoteTitle)) {
      onCreateNote();
    } else if (e.key === 'Escape') {
      onCancelCreateNote();
    }
  };

  const handleCreateNoteBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancelCreateNote();
    }
  };

  return (
    <>
      {/* Delete Note */}
      {deleteNote && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter">
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Note
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete &quot;{deleteNote.name.replace(/\.md$/, '')}&quot;? It will be moved to trash
              for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={onDeleteNoteCancel} className="btn focus-ring">
                Cancel
              </button>
              <button onClick={onDeleteNoteConfirm} className="btn btn-danger focus-ring">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Note */}
      {isCreatingNote && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
          onClick={handleCreateNoteBackdropClick}
        >
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              New Note
            </h3>
            <input
              type="text"
              value={newNoteTitle}
              onChange={(e) => onNewNoteTitleChange(e.target.value)}
              onKeyDown={handleCreateNoteKeyDown}
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
              <button onClick={onCancelCreateNote} className="btn focus-ring">
                Cancel
              </button>
              <button
                onClick={onCreateNote}
                disabled={!newNoteTitle.trim() || !!titleError}
                className="btn btn-primary focus-ring"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Folder */}
      {isCreatingFolder && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
          onClick={onCancelCreateFolder}
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
              onChange={(e) => onNewFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newFolderName.trim()) onCreateFolder();
                if (e.key === 'Escape') onCancelCreateFolder();
              }}
              placeholder="Folder name..."
              className="input mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={onCancelCreateFolder} className="btn focus-ring">
                Cancel
              </button>
              <button
                onClick={onCreateFolder}
                disabled={!newFolderName.trim()}
                className="btn btn-primary focus-ring"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename Folder */}
      {renamingFolder && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
          onClick={onCancelRenameFolder}
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
              onChange={(e) => onRenameFolderNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameFolderName.trim()) onRenameFolderSubmit();
                if (e.key === 'Escape') onCancelRenameFolder();
              }}
              placeholder="Folder name..."
              className="input mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={onCancelRenameFolder} className="btn focus-ring">
                Cancel
              </button>
              <button
                onClick={onRenameFolderSubmit}
                disabled={!renameFolderName.trim()}
                className="btn btn-primary focus-ring"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Folder */}
      {deleteFolder && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter">
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Folder
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete &quot;{deleteFolder.name}&quot; and all its contents? They will be moved to
              trash for 7 days.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={onDeleteFolderCancel} className="btn focus-ring">
                Cancel
              </button>
              <button onClick={onDeleteFolderConfirm} className="btn btn-danger focus-ring">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
