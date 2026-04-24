import { save } from '@tauri-apps/plugin-dialog';
import {
  Lock,
  Unlock,
  Trash2,
  FolderInput,
  Layers,
  Copy,
  Download,
  FileDown,
} from 'lucide-react';
import { exportSingleNote, exportNoteToPdf, readNote } from '@/lib';
import { useToast } from '@/hooks/useToast';
import type { NoteFile } from '@/types';

interface NoteContextMenuProps {
  note: NoteFile;
  position: { x: number; y: number };
  onOpenInNewTab: (note: NoteFile) => void;
  onDuplicate: (note: NoteFile) => Promise<void>;
  onLock: (note: NoteFile) => void;
  onUnlock: (note: NoteFile) => void;
  onPermanentUnlock: (note: NoteFile) => void;
  onMoveToFolder: (note: NoteFile) => void;
  onDelete: (e: React.MouseEvent, note: NoteFile) => void;
  onClose: () => void;
}

const itemClass = 'w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors';

function hoverIn(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = 'var(--hover-overlay)';
}
function hoverOut(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.style.backgroundColor = 'transparent';
}

export function NoteContextMenu({
  note,
  position,
  onOpenInNewTab,
  onDuplicate,
  onLock,
  onUnlock,
  onPermanentUnlock,
  onMoveToFolder,
  onDelete,
  onClose,
}: NoteContextMenuProps) {
  const toast = useToast();

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
          note.isWeekly || false,
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
          note.name,
          note.isDaily || false,
          note.isWeekly || false,
        );
        await exportNoteToPdf(defaultName, content, destination);
        toast.success('Note exported as PDF');
      }
    } catch (error) {
      console.error('[Sidebar] PDF export failed:', error);
      toast.error('Failed to export PDF');
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
    <div
      className="fixed z-[9999] py-1 min-w-[160px]"
      style={{
        left: position.x,
        top: position.y,
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-sm)',
        boxShadow: 'var(--shadow-md)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {note.isLocked ? (
        <>
          <button
            onClick={() => onUnlock(note)}
            className={itemClass}
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <Unlock className="w-4 h-4" />
            View Note
          </button>
          <button
            onClick={() => onPermanentUnlock(note)}
            className={itemClass}
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
          >
            <Unlock className="w-4 h-4" />
            Remove Lock
          </button>
        </>
      ) : (
        <button
          onClick={() => onLock(note)}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Lock className="w-4 h-4" />
          Lock Note
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={() => {
            onOpenInNewTab(note);
            onClose();
          }}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Layers className="w-4 h-4" />
          Open in New Tab
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleDuplicate}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Copy className="w-4 h-4" />
          Duplicate
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleExportMarkdown}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <Download className="w-4 h-4" />
          Export as Markdown
        </button>
      )}
      {!note.isLocked && (
        <button
          onClick={handleExportPdf}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <FileDown className="w-4 h-4" />
          Export as PDF
        </button>
      )}
      {!note.isDaily && (
        <button
          onClick={() => onMoveToFolder(note)}
          className={itemClass}
          style={{ color: 'var(--text-primary)' }}
          onMouseEnter={hoverIn}
          onMouseLeave={hoverOut}
        >
          <FolderInput className="w-4 h-4" />
          Move to Folder...
        </button>
      )}
      <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />
      <button
        onClick={(e) => {
          onDelete(e, note);
          onClose();
        }}
        className={itemClass}
        style={{ color: 'var(--error)' }}
        onMouseEnter={hoverIn}
        onMouseLeave={hoverOut}
      >
        <Trash2 className="w-4 h-4" />
        Delete Note
      </button>
    </div>
  );
}
