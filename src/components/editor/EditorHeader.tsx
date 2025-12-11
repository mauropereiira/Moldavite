import { useState, useRef, useEffect } from 'react';
import { Editor } from '@tiptap/react';
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { ShareMenu } from './ShareMenu';
import { FormattingMenu } from './FormattingMenu';
import { MoreOptionsMenu } from './MoreOptionsMenu';
import { NoteColorPicker } from '@/components/ui';
import type { NoteColorId } from '@/components/ui/NoteColorPicker';
import { useNoteStore, useThemeStore, useNoteColorsStore, buildNotePath } from '@/stores';
import { useNotes } from '@/hooks';
import { renameNote } from '@/lib';

interface EditorHeaderProps {
  editor: Editor | null;
  onDelete: () => void;
}

export function EditorHeader({ editor, onDelete }: EditorHeaderProps) {
  const { currentNote, notes, setCurrentNote, setNotes } = useNoteStore();
  const { theme } = useThemeStore();
  const { loadNote } = useNotes();
  const { getColor, setColor } = useNoteColorsStore();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Determine if dark mode
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Get current note's color
  const notePath = currentNote ? buildNotePath(currentNote.id.replace('.md', '') + '.md', currentNote.isDaily) : '';
  const currentColorId = getColor(notePath);

  // Get word and character counts
  const wordCount = editor
    ? editor.getText().split(/\s+/).filter(word => word.length > 0).length
    : 0;
  const characterCount = editor ? editor.getText().length : 0;

  // Get sorted standalone notes for navigation
  const standaloneNotes = notes
    .filter(n => !n.isDaily)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Find current note index
  const currentIndex = currentNote
    ? standaloneNotes.findIndex(n => n.path === currentNote.id)
    : -1;

  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < standaloneNotes.length - 1 && currentIndex >= 0;

  // Focus input when editing
  useEffect(() => {
    if (isEditingTitle && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingTitle]);

  // Show toast
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  };

  // Handle title click to edit
  const handleTitleClick = () => {
    if (!currentNote || currentNote.isDaily) return; // Can't rename daily notes
    setEditedTitle(currentNote.title);
    setIsEditingTitle(true);
  };

  // Handle title save
  const handleTitleSave = async () => {
    if (!currentNote || !editedTitle.trim() || currentNote.isDaily) {
      setIsEditingTitle(false);
      return;
    }

    const newTitle = editedTitle.trim();
    if (newTitle === currentNote.title) {
      setIsEditingTitle(false);
      return;
    }

    // Check if new name already exists
    const newFilename = `${newTitle}.md`;
    if (notes.some(n => n.name === newFilename)) {
      showToast('Name already exists');
      setIsEditingTitle(false);
      return;
    }

    try {
      const oldFilename = `${currentNote.title}.md`;
      await renameNote(oldFilename, newFilename, false);

      // Update notes list
      const updatedNotes = notes.map(n => {
        if (n.path === currentNote.id) {
          return {
            ...n,
            name: newFilename,
            path: newFilename,
          };
        }
        return n;
      });
      setNotes(updatedNotes);

      // Update current note
      setCurrentNote({
        ...currentNote,
        id: newFilename,
        title: newTitle,
      });

      showToast('Renamed');
    } catch (error) {
      console.error('[EditorHeader] Failed to rename:', error);
      showToast('Failed to rename');
    } finally {
      setIsEditingTitle(false);
    }
  };

  // Handle title input keydown
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  };

  // Navigate to previous note
  const handlePrevious = () => {
    if (hasPrevious) {
      loadNote(standaloneNotes[currentIndex - 1]);
    }
  };

  // Navigate to next note
  const handleNext = () => {
    if (hasNext) {
      loadNote(standaloneNotes[currentIndex + 1]);
    }
  };

  if (!currentNote) return null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
          {toast}
        </div>
      )}

      {/* File Icon */}
      <div className="p-1.5 text-gray-400 dark:text-gray-500">
        <FileText className="w-4 h-4" />
      </div>

      {/* Title */}
      {isEditingTitle ? (
        <input
          ref={inputRef}
          type="text"
          value={editedTitle}
          onChange={(e) => setEditedTitle(e.target.value)}
          onBlur={handleTitleSave}
          onKeyDown={handleTitleKeyDown}
          className="flex-1 min-w-0 px-2 py-1 text-sm font-medium bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <button
          onClick={handleTitleClick}
          className={`flex-1 min-w-0 text-left text-sm font-medium truncate ${
            currentNote.isDaily
              ? 'text-gray-900 dark:text-white cursor-default'
              : 'text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer'
          }`}
          title={currentNote.isDaily ? currentNote.title : 'Click to rename'}
        >
          {currentNote.title}
        </button>
      )}

      {/* Spacer */}
      <div className="flex-shrink-0 w-4" />

      {/* Navigation Arrows (only for standalone notes) */}
      {!currentNote.isDaily && standaloneNotes.length > 1 && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={handlePrevious}
            disabled={!hasPrevious}
            className={`p-1.5 rounded-lg transition-colors ${
              hasPrevious
                ? 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            title="Previous note"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleNext}
            disabled={!hasNext}
            className={`p-1.5 rounded-lg transition-colors ${
              hasNext
                ? 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400'
                : 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
            }`}
            title="Next note"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Divider */}
      <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />

      {/* Note Color Picker */}
      <NoteColorPicker
        currentColorId={currentColorId}
        onColorChange={(colorId: NoteColorId) => setColor(notePath, colorId)}
        isDark={isDark}
      />

      {/* Share Menu */}
      <ShareMenu onShowToast={showToast} />

      {/* Formatting Menu */}
      <FormattingMenu editor={editor} />

      {/* More Options Menu */}
      <MoreOptionsMenu
        onDelete={onDelete}
        onShowToast={showToast}
        wordCount={wordCount}
        characterCount={characterCount}
      />
    </div>
  );
}
