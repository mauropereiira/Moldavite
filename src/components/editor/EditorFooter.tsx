import { Editor } from '@tiptap/react';
import { Check } from 'lucide-react';
import { ShareMenu } from './ShareMenu';
import { FormattingMenu } from './FormattingMenu';
import { MoreOptionsMenu } from './MoreOptionsMenu';
import { NoteColorPicker } from '@/components/ui';
import type { NoteColorId } from '@/components/ui/NoteColorPicker';
import { useNoteStore, useThemeStore, useNoteColorsStore, useSettingsStore, buildNotePath } from '@/stores';
import { useToast } from '@/hooks/useToast';

interface EditorFooterProps {
  editor: Editor | null;
  onDelete: () => void;
  isSaving: boolean;
  showSaveSuccess: boolean;
}

export function EditorFooter({ editor, onDelete, isSaving, showSaveSuccess }: EditorFooterProps) {
  const { currentNote } = useNoteStore();
  const { theme } = useThemeStore();
  const { getColor, setColor } = useNoteColorsStore();
  const { showWordCount, showAutoSaveStatus } = useSettingsStore();
  const toast = useToast();

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

  // Show toast helper
  const showToast = (message: string) => {
    toast.success(message);
  };

  if (!currentNote) return null;

  return (
    <div className="editor-footer">
      {/* Left: Word count and save status */}
      <div className="editor-footer-left">
        {showWordCount && editor && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {wordCount} words
          </span>
        )}
        {showAutoSaveStatus && (isSaving || showSaveSuccess) && (
          <div className="flex items-center gap-1.5 text-xs ml-4">
            {isSaving ? (
              <>
                <svg className="w-3 h-3 spinner" style={{ color: 'var(--text-muted)' }} viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span className="saving-indicator" style={{ color: 'var(--text-muted)' }}>Saving...</span>
              </>
            ) : showSaveSuccess ? (
              <>
                <Check className="w-3 h-3 save-success-icon" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)' }}>Saved</span>
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Right: Toolbar icons */}
      <div className="editor-footer-right">
        {/* Note Color Picker */}
        <NoteColorPicker
          currentColorId={currentColorId}
          onColorChange={(colorId: NoteColorId) => setColor(notePath, colorId)}
          isDark={isDark}
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
          openDirection="up"
        />
      </div>
    </div>
  );
}
