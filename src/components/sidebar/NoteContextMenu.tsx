import { save } from '@tauri-apps/plugin-dialog';
import {
  exportSingleNote,
  exportNoteToPdf,
  exportNoteAsPlaintext,
  readNote,
  noteFileBackendPath,
} from '@/lib';
import { useToast } from '@/hooks/useToast';
import { usePdfExportStore, useQuickSwitcherStore } from '@/stores';
import type { NoteFile } from '@/types';
import { ContextMenuSurface } from './ContextMenuSurface';

interface NoteContextMenuProps {
  note: NoteFile;
  position: { x: number; y: number };
  onOpenInNewTab: (note: NoteFile) => void;
  onDuplicate: (note: NoteFile) => Promise<void>;
  onRename: (note: NoteFile) => void;
  onLock: (note: NoteFile) => void;
  onUnlock: (note: NoteFile) => void;
  onPermanentUnlock: (note: NoteFile) => void;
  onMoveToFolder: (note: NoteFile) => void;
  onDelete: (e: React.MouseEvent, note: NoteFile) => void;
  onClose: () => void;
}

const itemClass = 'shrink-0 w-full px-3 py-2 text-left text-sm transition-colors';

export function NoteContextMenu({
  note,
  position,
  onOpenInNewTab,
  onDuplicate,
  onRename,
  onLock,
  onUnlock,
  onPermanentUnlock,
  onMoveToFolder,
  onDelete,
  onClose,
}: NoteContextMenuProps) {
  const toast = useToast();
  const { togglePinned, isPinned } = useQuickSwitcherStore();

  const handleExportMarkdown = async () => {
    try {
      const defaultName = note.name.replace(/\.md$/, '');
      const destination = await save({
        title: 'Export Note',
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (destination) {
        await exportSingleNote(
          note.name,
          destination,
          note.isDaily || false,
          note.isWeekly || false
        );
        toast.success('Note exported');
      }
    } catch (_error) {
      toast.error('Failed to export note');
    }
    onClose();
  };

  const handleExportPdf = async () => {
    try {
      const defaultName = note.name.replace(/\.md$/, '');
      const destination = await save({
        title: 'Export as PDF',
        defaultPath: `${defaultName}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (destination) {
        const content = await readNote(
          noteFileBackendPath(note),
          note.isDaily || false,
          note.isWeekly || false
        );
        // Use the last persisted PDF options. The editor's PDF menu offers a
        // full picker; the sidebar context menu stays one-click for speed and
        // simply respects the most recent choice.
        const { pageSize, margin } = usePdfExportStore.getState();
        await exportNoteToPdf(defaultName, content, destination, { pageSize, margin });
        toast.success('Note exported as PDF');
      }
    } catch (error) {
      console.error('[Sidebar] PDF export failed:', error);
      toast.error('Failed to export PDF');
    }
    onClose();
  };

  const handleExportPlaintext = async () => {
    try {
      const defaultName = note.name.replace(/\.md$/, '');
      const destination = await save({
        title: 'Export as Plaintext',
        defaultPath: `${defaultName}.txt`,
        filters: [{ name: 'Plain Text', extensions: ['txt'] }],
      });
      if (destination) {
        await exportNoteAsPlaintext(
          note.name,
          destination,
          note.isDaily || false,
          note.isWeekly || false
        );
        toast.success('Exported as plaintext');
      }
    } catch (error) {
      console.error('[Sidebar] Plaintext export failed:', error);
      toast.error('Failed to export plaintext');
    }
    onClose();
  };

  const handleDuplicate = async () => {
    try {
      await onDuplicate(note);
      toast.success('Note duplicated');
    } catch (_error) {
      toast.error('Failed to duplicate note');
    }
    onClose();
  };

  return (
    <ContextMenuSurface position={position} onClose={onClose}>
      {note.isLocked ? (
        <>
          <button
            onClick={() => onUnlock(note)}
            className={itemClass}
            style={{ color: 'var(--text-primary)' }}
          >
            View Note
          </button>
          <button
            onClick={() => onPermanentUnlock(note)}
            className={itemClass}
            style={{ color: 'var(--text-primary)' }}
          >
            Remove Lock
          </button>
        </>
      ) : (
        <button
          onClick={() => onLock(note)}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Lock Note
        </button>
      )}
      {/* Pinning is the one action here that is equally sensible for a locked
          note: it means "keep this to hand", not "show me what's inside". */}
      <button
        onClick={() => {
          togglePinned(note.path);
          onClose();
        }}
        className={itemClass}
        style={{ color: 'var(--text-primary)' }}
      >
        {isPinned(note.path) ? 'Unpin from top bar' : 'Pin to top bar'}
      </button>
      {!note.isLocked && (
        <button
          onClick={() => {
            onOpenInNewTab(note);
            onClose();
          }}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Open in New Tab
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleDuplicate}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Duplicate
        </button>
      )}
      {!note.isLocked && !note.isDaily && !note.isWeekly && (
        <button
          onClick={() => {
            onRename(note);
            onClose();
          }}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Rename…
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleExportMarkdown}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Export as Markdown
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleExportPdf}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Export as PDF
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleExportPlaintext}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Export as Plaintext
        </button>
      )}
      {!note.isDaily && (
        <button
          onClick={() => onMoveToFolder(note)}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
        >
          Move to Folder...
        </button>
      )}
      <div className="my-1 shrink-0" style={{ borderTop: '1px solid var(--border-muted)' }} />
      <button
        onClick={(e) => {
          onDelete(e, note);
          onClose();
        }}
        className={itemClass}
        style={{ color: 'var(--error)' }}
      >
        Delete Note
      </button>
    </ContextMenuSurface>
  );
}
