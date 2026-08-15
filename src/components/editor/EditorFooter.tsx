import { Editor } from '@tiptap/react';
import { ShareMenu } from './ShareMenu';
import { WordPressMenu } from './WordPressMenu';
import { FormattingMenu } from './FormattingMenu';
import { MoreOptionsMenu } from './MoreOptionsMenu';
import { NoteColorPicker } from '@/components/ui';
import type { NoteColorId } from '@/components/ui/NoteColorPicker';
import {
  useNoteStore,
  useThemeStore,
  useNoteColorsStore,
  useSettingsStore,
  buildNotePath,
} from '@/stores';
import { useToast } from '@/hooks/useToast';
import type { NoteFile } from '@/types';

interface EditorFooterProps {
  editor: Editor | null;
  onDelete: () => void;
  isSaving: boolean;
  showSaveSuccess: boolean;
  onRenameNote: (note: NoteFile, title: string) => Promise<void>;
}

export function EditorFooter({
  editor,
  onDelete,
  isSaving,
  showSaveSuccess,
  onRenameNote,
}: EditorFooterProps) {
  const { currentNote } = useNoteStore();
  const { theme } = useThemeStore();
  const { getColor, setColor } = useNoteColorsStore();
  const { showWordCount, showAutoSaveStatus } = useSettingsStore();
  const toast = useToast();

  // Determine if dark mode
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Get current note's color
  const notePath = currentNote
    ? buildNotePath(currentNote.id.replace('.md', '') + '.md', currentNote.isDaily)
    : '';
  const currentColorId = getColor(notePath);

  // Get word and character counts
  const wordCount = editor
    ? editor
        .getText()
        .split(/\s+/)
        .filter((word) => word.length > 0).length
    : 0;
  const characterCount = editor ? editor.getText().length : 0;

  // Show toast helper
  const showToast = (message: string) => {
    toast.success(message);
  };

  if (!currentNote) return null;

  return (
    <div className="editor-footer">
      {/* Left: Word count and save status */}
      <div className="editor-footer-left">
        {showWordCount && editor && <span>{wordCount} words</span>}
        {showAutoSaveStatus && (isSaving || showSaveSuccess) && (
          <div className="flex items-center ml-4">
            {isSaving ? <span>Saving…</span> : showSaveSuccess ? <span>Saved</span> : null}
          </div>
        )}
      </div>

      {/* Right: typographic controls */}
      <div className="editor-footer-right">
        {/* Note Color Picker */}
        <div className="editor-footer-color">
          <NoteColorPicker
            currentColorId={currentColorId}
            onColorChange={(colorId: NoteColorId) => setColor(notePath, colorId)}
            isDark={isDark}
            openDirection="up"
          />
        </div>

        {/* Publish to WordPress — absent unless the build has credentials */}
        <WordPressMenu
          onShowToast={showToast}
          onShowError={(message) => toast.error(message)}
          openDirection="up"
        />

        {/* Share Menu */}
        <ShareMenu onShowToast={showToast} openDirection="up" />

        {/* Formatting Menu */}
        <FormattingMenu editor={editor} openDirection="up" />

        {/* More Options Menu */}
        <MoreOptionsMenu
          onDelete={onDelete}
          onShowToast={showToast}
          wordCount={wordCount}
          characterCount={characterCount}
          onRenameNote={onRenameNote}
          openDirection="up"
        />
      </div>
    </div>
  );
}
