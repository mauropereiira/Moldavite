import { useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import {
  MoreVertical,
  ExternalLink,
  Link2,
  Copy,
  Download,
  Trash2,
  Info,
  Star
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/ui/Dropdown';
import { useNoteStore } from '@/stores';
import { createNote, writeNote, htmlToMarkdown, exportSingleNote } from '@/lib';
import { SaveTemplateModal } from '@/components/templates/SaveTemplateModal';
import type { NoteFile } from '@/types';

interface MoreOptionsMenuProps {
  onDelete: () => void;
  onShowToast?: (message: string) => void;
  wordCount: number;
  characterCount: number;
  openDirection?: 'up' | 'down';
}

export function MoreOptionsMenu({ onDelete, onShowToast, wordCount, characterCount, openDirection = 'down' }: MoreOptionsMenuProps) {
  const { currentNote, notes, setNotes } = useNoteStore();
  const [showNoteInfo, setShowNoteInfo] = useState(false);
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false);

  const handleOpenNewWindow = () => {
    // Placeholder for open in new window
    onShowToast?.('Coming soon');
  };

  const handleCopyUrl = async () => {
    if (!currentNote) return;

    const filename = currentNote.isDaily && currentNote.date
      ? `${currentNote.date}.md`
      : `${currentNote.title}.md`;

    const link = `notomattic://note/${encodeURIComponent(filename)}`;

    try {
      await navigator.clipboard.writeText(link);
      onShowToast?.('URL copied');
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to copy URL:', error);
    }
  };

  const handleDuplicate = async () => {
    if (!currentNote || currentNote.isDaily) {
      onShowToast?.('Cannot duplicate daily notes');
      return;
    }

    try {
      // Create new note with "Copy" suffix
      let newTitle = `${currentNote.title} Copy`;
      let attempt = 1;

      // Check if name already exists
      while (notes.some(n => n.name === `${newTitle}.md`)) {
        attempt++;
        newTitle = `${currentNote.title} Copy ${attempt}`;
      }

      // Create the new file
      const filename = await createNote(newTitle);

      // Copy content
      const markdownContent = htmlToMarkdown(currentNote.content);
      await writeNote(filename, markdownContent, false);

      // Update notes list
      const noteFile: NoteFile = {
        name: filename,
        path: filename,
        isDaily: false,
        isWeekly: false,
        isLocked: false,
      };
      setNotes([...notes, noteFile]);

      onShowToast?.('Note duplicated');
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to duplicate:', error);
      onShowToast?.('Failed to duplicate');
    }
  };

  const handleExport = async () => {
    if (!currentNote) return;

    try {
      const filename = currentNote.isDaily && currentNote.date
        ? `${currentNote.date}.md`
        : currentNote.isWeekly && currentNote.week
        ? `${currentNote.week}.md`
        : `${currentNote.title}.md`;

      const defaultName = filename.replace(/\.md$/, '');
      const destination = await save({
        title: 'Export Note',
        defaultPath: `${defaultName}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });

      if (destination) {
        await exportSingleNote(
          filename,
          destination,
          currentNote.isDaily || false,
          currentNote.isWeekly || false
        );
        onShowToast?.('Note exported');
      }
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to export:', error);
      onShowToast?.('Failed to export');
    }
  };

  const handleShowInfo = () => {
    setShowNoteInfo(true);
  };

  // Get file size estimate (rough calculation)
  const getFileSizeEstimate = () => {
    if (!currentNote) return '0 B';
    const markdown = htmlToMarkdown(currentNote.content);
    const bytes = new Blob([markdown]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <>
      <Dropdown
        position="right"
        openDirection={openDirection}
        trigger={
          <button
            className="toolbar-button"
            title="More options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        }
      >
        <DropdownItem
          onClick={handleOpenNewWindow}
          icon={<ExternalLink className="w-4 h-4" />}
          disabled
        >
          Open in new window
        </DropdownItem>
        <DropdownItem
          onClick={handleCopyUrl}
          icon={<Link2 className="w-4 h-4" />}
        >
          Copy URL to note
        </DropdownItem>
        <DropdownItem
          onClick={handleDuplicate}
          icon={<Copy className="w-4 h-4" />}
          disabled={currentNote?.isDaily}
        >
          Duplicate note
        </DropdownItem>
        <DropdownItem
          onClick={handleExport}
          icon={<Download className="w-4 h-4" />}
        >
          Export note
        </DropdownItem>
        <DropdownItem
          onClick={() => setShowSaveTemplateModal(true)}
          icon={<Star className="w-4 h-4" />}
        >
          Save as template
        </DropdownItem>
        <DropdownDivider />
        <DropdownItem
          onClick={handleShowInfo}
          icon={<Info className="w-4 h-4" />}
        >
          Note info
        </DropdownItem>
        <DropdownDivider />
        <DropdownItem
          onClick={onDelete}
          icon={<Trash2 className="w-4 h-4" />}
          variant="danger"
        >
          Delete note
        </DropdownItem>
      </Dropdown>

      {/* Note Info Modal */}
      {showNoteInfo && currentNote && (
        <div
          className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNoteInfo(false);
          }}
        >
          <div
            className="modal-elevated modal-content-enter p-6 max-w-sm mx-4 w-full"
            style={{ borderRadius: 'var(--radius-md)' }}
          >
            <h3 className="text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
              Note Info
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Title</span>
                <span className="truncate max-w-[180px]" style={{ color: 'var(--text-primary)' }}>
                  {currentNote.title}
                </span>
              </div>
              <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Type</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  {currentNote.isDaily ? 'Daily' : 'Standalone'}
                </span>
              </div>
              {currentNote.isDaily && currentNote.date && (
                <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Date</span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {currentNote.date}
                  </span>
                </div>
              )}
              <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Words</span>
                <span style={{ color: 'var(--text-primary)' }}>{wordCount}</span>
              </div>
              <div className="flex justify-between py-1.5" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Characters</span>
                <span style={{ color: 'var(--text-primary)' }}>{characterCount}</span>
              </div>
              <div className="flex justify-between py-1.5">
                <span style={{ color: 'var(--text-muted)' }}>File Size</span>
                <span style={{ color: 'var(--text-primary)' }}>{getFileSizeEstimate()}</span>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowNoteInfo(false)}
                className="btn focus-ring"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {currentNote && (
        <SaveTemplateModal
          isOpen={showSaveTemplateModal}
          onClose={() => setShowSaveTemplateModal(false)}
          initialContent={htmlToMarkdown(currentNote.content)}
        />
      )}
    </>
  );
}
