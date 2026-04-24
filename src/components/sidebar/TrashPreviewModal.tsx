import { useEffect, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { invoke } from '@tauri-apps/api/core';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { X, Undo2, Trash2, FileText, Calendar, Folder } from 'lucide-react';
import type { TrashedNote } from '@/types';

interface TrashPreviewModalProps {
  note: TrashedNote | null;
  onClose: () => void;
  onRestore: (trashId: string) => void;
  onPermanentDelete: (trashId: string) => void;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

/**
 * Read-only preview of a trashed note. Uses a Tiptap editor with
 * `editable: false` and no toolbar.
 */
export function TrashPreviewModal({
  note,
  onClose,
  onRestore,
  onPermanentDelete,
}: TrashPreviewModalProps) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    if (!note) {
      setHtml('');
      return;
    }
    if (note.isFolder) {
      setHtml(
        `<p><em>Folder trash — restore to browse its contents.</em></p>
         <ul><li><strong>Folder:</strong> ${escapeHtml(note.filename)}</li></ul>`
      );
      return;
    }
    invoke<string>('read_trashed_note', { trashId: note.id })
      .then((markdown) => {
        if (cancelled) return;
        const rendered = md.render(markdown || '*(empty note)*');
        setHtml(DOMPurify.sanitize(rendered));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setHtml(
          `<p><em>Could not read this note: ${escapeHtml(String(err))}.</em></p>`
        );
      });
    return () => {
      cancelled = true;
    };
  }, [note]);

  const editor = useEditor(
    {
      extensions: [StarterKit],
      content: html,
      editable: false,
    },
    [note?.id, html]
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
