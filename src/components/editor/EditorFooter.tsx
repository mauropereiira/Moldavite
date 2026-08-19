import { useState } from 'react';
import { Editor } from '@tiptap/react';
import { ShareMenu } from './ShareMenu';
import { WordPressMenu } from './WordPressMenu';
import { FormattingMenu } from './FormattingMenu';
import { MoreOptionsMenu } from './MoreOptionsMenu';
import { Dropdown, DropdownStatic } from '@/components/ui/Dropdown';
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
import { useElementWidth } from '@/hooks/useElementWidth';
import type { NoteFile } from '@/types';

/**
 * Below this editor width the action labels no longer fit beside the centred
 * Index · Agenda · Settings links, which are positioned against the editor
 * column and cannot be pushed aside — they simply print on top. Past it the
 * actions fold into one menu, the same shape the links themselves take at a
 * narrower width still.
 *
 * The two collide at 860: the links are ~176px centred, the actions ~322px
 * against the right edge, both inside 20px of padding. 900 keeps 20px of air
 * on each side. It is a constant rather than a measurement because collapsing
 * removes the very element whose width would say when to expand again.
 */
const ACTIONS_COLLAPSE_WIDTH = 900;

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
  const [footerNode, setFooterNode] = useState<HTMLDivElement | null>(null);
  const footerWidth = useElementWidth(footerNode);
  const isCollapsed = footerWidth !== null && footerWidth < ACTIONS_COLLAPSE_WIDTH;

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

  // Every action menu opens upward from wherever it is rendered, so the same
  // markup serves the wide row and the folded menu alike. Rendering it in one
  // place or the other — never both — keeps a single instance of each menu's
  // state, and means a new action (a plugin's, say) is added once and appears
  // in whichever of the two the window is currently wide enough for.
  const actions = (
    <>
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
    </>
  );

  return (
    <div className="editor-footer" ref={setFooterNode}>
      {/* Left: Word count and save status */}
      <div className="editor-footer-left">
        {showWordCount && editor && <span>{wordCount} words</span>}
        {showAutoSaveStatus && (isSaving || showSaveSuccess) && (
          <div className="flex items-center ml-4">
            {isSaving ? <span>Saving…</span> : showSaveSuccess ? <span>Saved</span> : null}
          </div>
        )}
      </div>

      {/* Right: the controls themselves, or the one menu they fold into */}
      <div className="editor-footer-right">
        {isCollapsed ? (
          <Dropdown
            openDirection="up"
            position="right"
            trigger={
              <button type="button" className="editor-footer-overflow-toggle">
                Actions
              </button>
            }
          >
            {/* Static: each row here opens a menu of its own, so clicking one
                must not dismiss the menu it was clicked in. */}
            <DropdownStatic>
              <div className="editor-footer-actions-menu">{actions}</div>
            </DropdownStatic>
          </Dropdown>
        ) : (
          actions
        )}
      </div>
    </div>
  );
}
