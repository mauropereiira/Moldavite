import { useState } from 'react';
import {
  MoreVertical,
  ExternalLink,
  Link2,
  Copy,
  Trash2,
  Info,
  Star
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownDivider } from '@/components/ui/Dropdown';
import { useNoteStore } from '@/stores';
import { createNote, writeNote, htmlToMarkdown } from '@/lib';
import { SaveTemplateModal } from '@/components/templates/SaveTemplateModal';
import type { NoteFile } from '@/types';

interface MoreOptionsMenuProps {
  onDelete: () => void;
  onShowToast?: (message: string) => void;
  wordCount: number;
  characterCount: number;
}

export function MoreOptionsMenu({ onDelete, onShowToast, wordCount, characterCount }: MoreOptionsMenuProps) {
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
      };
      setNotes([...notes, noteFile]);

      onShowToast?.('Note duplicated');
    } catch (error) {
      console.error('[MoreOptionsMenu] Failed to duplicate:', error);
      onShowToast?.('Failed to duplicate');
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
        trigger={
          <button
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 transition-colors"
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
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowNoteInfo(false);
          }}
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4 shadow-xl w-full">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Note Info
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Title</span>
                <span className="text-gray-900 dark:text-white font-medium truncate max-w-[180px]">
                  {currentNote.title}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Type</span>
                <span className="text-gray-900 dark:text-white">
                  {currentNote.isDaily ? 'Daily Note' : 'Standalone Note'}
                </span>
              </div>
              {currentNote.isDaily && currentNote.date && (
                <div className="flex justify-between">
                  <span className="text-gray-500 dark:text-gray-400">Date</span>
                  <span className="text-gray-900 dark:text-white">
                    {currentNote.date}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Words</span>
                <span className="text-gray-900 dark:text-white">{wordCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">Characters</span>
                <span className="text-gray-900 dark:text-white">{characterCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">File Size</span>
                <span className="text-gray-900 dark:text-white">{getFileSizeEstimate()}</span>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowNoteInfo(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
