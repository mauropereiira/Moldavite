import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import { getNoteTitleError, MAX_NOTE_TITLE_LENGTH } from '@/lib/validation';
import type { NoteFile } from '@/types';

interface RenameNoteModalProps {
  note: NoteFile;
  onRename: (note: NoteFile, title: string) => Promise<void>;
  onClose: () => void;
}

/** Small, accessible dialog shared by sidebar and editor rename affordances. */
export function RenameNoteModal({ note, onRename, onClose }: RenameNoteModalProps) {
  const [title, setTitle] = useState(() => note.name.replace(/\.md$/, ''));
  const [error, setError] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isRenaming) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isRenaming, onClose]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = getNoteTitleError(title);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsRenaming(true);
    setError(null);
    try {
      await onRename(note, title.trim());
      onClose();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    } finally {
      setIsRenaming(false);
    }
  };

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[10000] modal-backdrop-enter"
      onClick={(event) => event.target === event.currentTarget && !isRenaming && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-note-title"
        className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
        style={{ borderRadius: 'var(--radius-md)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="rename-note-title"
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Rename note
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Inbound wiki-links will be updated automatically.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="rename-note-input" className="sr-only">
            Note title
          </label>
          <input
            id="rename-note-input"
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setError(null);
            }}
            maxLength={MAX_NOTE_TITLE_LENGTH}
            disabled={isRenaming}
            autoFocus
            className="w-full px-3 py-2 text-sm rounded focus-ring"
            style={{
              color: 'var(--text-primary)',
              backgroundColor: 'var(--bg-panel)',
              border: `1px solid ${error ? 'var(--error)' : 'var(--border-default)'}`,
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'rename-note-error' : undefined}
          />
          {error && (
            <p id="rename-note-error" className="text-xs mt-2" style={{ color: 'var(--error)' }}>
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={isRenaming}
              className="btn focus-ring"
            >
              Cancel
            </button>
            <button type="submit" disabled={isRenaming} className="btn btn-primary focus-ring">
              {isRenaming ? (
                <span className="flex items-center gap-2">
                  <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
                  Renaming…
                </span>
              ) : (
                'Rename'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
