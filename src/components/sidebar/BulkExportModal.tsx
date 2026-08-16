import { useState } from 'react';
import { join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import {
  exportSingleNote,
  exportNoteToPdf,
  exportNoteAsPlaintext,
  readNote,
  noteFileBackendPath,
} from '@/lib';
import { useNoteStore } from '@/stores';
import { useNoteSelectionStore } from '@/stores';
import { usePdfExportStore } from '@/stores';
import { useToast } from '@/hooks/useToast';
import type { NoteFile } from '@/types';
import { DialogSurface } from '@/components/ui/DialogSurface';

type BulkFormat = 'markdown' | 'pdf' | 'plaintext';

interface BulkExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Bulk export modal triggered from the sidebar's `BulkActionBar`. Lets the
 * user pick a format (Markdown / PDF / Plaintext), choose a destination
 * folder, and writes one file per selected note into that folder.
 *
 * Implementation note (intentional scope choice):
 *   We loop on the frontend instead of bundling the result into a ZIP.
 *   JSZip is not currently in the dependency tree — adding it would push
 *   us closer to the 420 KB / 120 KB gz app-bundle budget — and the
 *   existing backend `export_notes` command exports the *entire* vault,
 *   not a subset. The path of least resistance that doesn't require a
 *   new Rust command is to write the files directly into a user-chosen
 *   folder, which is what this component does.
 */
export function BulkExportModal({ isOpen, onClose }: BulkExportModalProps) {
  const [format, setFormat] = useState<BulkFormat>('markdown');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  if (!isOpen) return null;

  const handleExport = async () => {
    // Snapshot selection + notes at click time so the loop is deterministic
    // even if the user clears selection mid-export.
    const selectedIds = useNoteSelectionStore.getState().selectedIds;
    const allNotes = useNoteStore.getState().notes;
    const targets: NoteFile[] = allNotes.filter((n) => selectedIds.has(n.path));
    if (targets.length === 0) {
      onClose();
      return;
    }

    let destDir: string | string[] | null;
    try {
      destDir = await open({
        title: 'Choose export folder',
        directory: true,
        multiple: false,
      });
    } catch (error) {
      console.error('[BulkExportModal] folder picker failed:', error);
      toast.error('Failed to open folder picker');
      return;
    }
    if (!destDir || typeof destDir !== 'string') {
      // User cancelled.
      return;
    }
    const folder = destDir;
    setBusy(true);

    // Sanitize a note path/name into a safe per-platform filename stem. The
    // stem is built from the folder-relative path, not the basename: the
    // destination is one flat folder, so two selected notes named `roadmap.md`
    // in different folders would otherwise export onto each other.
    const safeStem = (note: NoteFile): string => {
      const raw = noteFileBackendPath(note).replace(/\.md$/, '');
      // Drop folder separators and characters that confuse common filesystems.
      // We intentionally keep unicode letters/digits — the user picked the
      // names, and the OS dialogs handle them fine.
      return raw.replace(/[\\/:*?"<>|]/g, '_');
    };

    let succeeded = 0;
    const failures: string[] = [];

    // PDF options — reuse the user's last-saved page size / margin so the
    // bulk path stays one click and matches single-note PDF exports.
    const { pageSize, margin } = usePdfExportStore.getState();

    for (const note of targets) {
      const stem = safeStem(note);
      // Every branch has to address the note the same way the backend does —
      // a bare name resolves to notes/<name>.md and silently exports whatever
      // unrelated root note shares that basename.
      const backendPath = noteFileBackendPath(note);
      try {
        const extension = format === 'markdown' ? 'md' : format === 'plaintext' ? 'txt' : 'pdf';
        const destination = await join(folder, `${stem}.${extension}`);
        if (format === 'markdown') {
          await exportSingleNote(
            backendPath,
            destination,
            note.isDaily || false,
            note.isWeekly || false
          );
        } else if (format === 'plaintext') {
          await exportNoteAsPlaintext(
            backendPath,
            destination,
            note.isDaily || false,
            note.isWeekly || false
          );
        } else {
          // PDF — read the note (markdown), the exporter expects sanitized
          // HTML so we let the existing path do the conversion through the
          // editor renderer. For bulk we feed the markdown directly; html2pdf
          // handles plain text reasonably and we already sanitize on the way
          // in. (If a note uses heavy formatting that needs Tiptap parsing,
          // the per-note PDF path from the editor remains available.)
          const md = await readNote(backendPath, note.isDaily || false, note.isWeekly || false);
          await exportNoteToPdf(stem, md, destination, {
            pageSize,
            margin,
          });
        }
        succeeded += 1;
      } catch (error) {
        console.error('[BulkExportModal] export failed for', backendPath, error);
        failures.push(note.name);
      }
    }

    setBusy(false);
    onClose();

    if (failures.length === 0) {
      toast.success(`Exported ${succeeded} note${succeeded === 1 ? '' : 's'}`);
    } else if (succeeded === 0) {
      toast.error(`Failed to export ${failures.length} note${failures.length === 1 ? '' : 's'}`);
    } else {
      toast.error(`Exported ${succeeded}, failed ${failures.length}`);
    }
  };

  const count = useNoteSelectionStore.getState().selectedIds.size;

  return (
    <div
      className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-[9999] modal-backdrop-enter"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <DialogSurface
        onEscape={busy ? undefined : onClose}
        aria-labelledby="bulk-export-title"
        className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
        style={{ borderRadius: 'var(--radius-md)' }}
      >
        <h3
          id="bulk-export-title"
          className="text-base font-semibold mb-1"
          style={{ color: 'var(--text-primary)' }}
        >
          Export {count} note{count === 1 ? '' : 's'}
        </h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          You&apos;ll be asked for a destination folder next. One file is written per note.
        </p>

        <div className="space-y-2 mb-6">
          {(
            [
              { value: 'markdown', label: 'Markdown (.md)' },
              { value: 'plaintext', label: 'Plaintext (.txt)' },
              { value: 'pdf', label: 'PDF (.pdf)' },
            ] as Array<{ value: BulkFormat; label: string }>
          ).map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer"
              style={{
                backgroundColor: format === opt.value ? 'var(--hover-overlay)' : 'transparent',
              }}
            >
              <input
                type="radio"
                name="bulk-export-format"
                value={opt.value}
                checked={format === opt.value}
                onChange={() => setFormat(opt.value)}
                disabled={busy}
              />
              <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
                {opt.label}
              </span>
            </label>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn focus-ring" disabled={busy}>
            Cancel
          </button>
          <button onClick={handleExport} className="btn btn-primary focus-ring" disabled={busy}>
            {busy ? 'Exporting…' : 'Choose folder'}
          </button>
        </div>
      </DialogSurface>
    </div>
  );
}
