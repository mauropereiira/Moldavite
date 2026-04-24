import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { X, Undo2, Trash2, FileText, Calendar, Folder } from 'lucide-react';
import type { TrashedNote } from '@/types';

interface TrashPreviewModalProps {
  note: TrashedNote | null;
  onClose: () => void;
  onRestore: (trashId: string) => void;
  onPermanentDelete: (trashId: string) => void;
}

/**
 * Read-only preview of a trashed note. Uses a Tiptap editor with
 * `editable: false` and no toolbar, matching the editor elsewhere
 * in the app.
 *
 * NOTE: The backend doesn't yet expose a `read_trashed_content`
 * command, so the preview body is currently a metadata-only message.
 * When that command lands, swap the placeholder content for the
 * actual trashed note HTML.
 */
export function TrashPreviewModal({
  note,
  onClose,
  onRestore,
  onPermanentDelete,
}: TrashPreviewModalProps) {
  const placeholderHtml = note
    ? `<p><em>Preview of trashed notes is metadata-only until the backend exposes read access to the trash directory.</em></p>
       <ul>
         <li><strong>File:</strong> ${escapeHtml(note.filename)}</li>
         <li><strong>Original path:</strong> ${escapeHtml(note.originalPath)}</li>
         <li><strong>Days remaining:</strong> ${note.daysRemaining}</li>
       </ul>
       <p>Restore the note to read its contents.</p>`
    : '';

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: placeholderHtml,
      editable: false,
    },
    [note?.id]
  );

  if (!note) return null;

  const icon = note.isFolder ? (
    <Folder className="w-5 h-5" style={{ color: 'var(--warning)' }} />
  ) : note.isDaily ? (
    <Calendar className="w-5 h-5" style={{ color: 'var(--accent-primary)' }} />
  ) : (
    <FileText className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop-enter"
      onClick={onClose}
    >
      <div className="absolute inset-0 modal-backdrop-dark" />
      <div
        className="relative modal-elevated modal-content-enter w-full max-w-lg mx-4 flex flex-col"
        style={{ borderRadius: 'var(--radius-md)', maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            {icon}
            <h2 className="text-base font-semibold truncate">
              {note.filename.replace(/\.md$/, '')}
            </h2>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => {
                onRestore(note.id);
                onClose();
              }}
              className="btn focus-ring flex items-center gap-1.5"
              title="Restore"
            >
              <Undo2 className="w-4 h-4" />
              <span>Restore</span>
            </button>
            <button
              onClick={() => {
                onPermanentDelete(note.id);
                onClose();
              }}
              className="btn btn-danger focus-ring flex items-center gap-1.5"
              title="Delete permanently"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 transition-colors"
              style={{ color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--hover-overlay)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body: read-only Tiptap editor, no toolbar */}
        <div className="flex-1 overflow-y-auto p-4">
          <EditorContent editor={editor} className="prose prose-sm max-w-none" />
        </div>
      </div>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
