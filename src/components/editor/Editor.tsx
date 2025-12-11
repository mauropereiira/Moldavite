import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import { invoke } from '@tauri-apps/api/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { EditorHeader } from './EditorHeader';
import { WikiLink, WikiLinkSuggestion, WikiLinkSuggestionList } from './extensions';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';
import './extensions/wiki-links.css';
import type { NoteFile } from '@/types';
import { useNoteStore, useSettingsStore, useThemeStore, useNoteColorsStore, buildNotePath } from '@/stores';
import { useAutoSave, useKeyboardShortcuts, useNotes, useTemplates } from '@/hooks';
import { getNoteBackgroundColor } from '@/components/ui/NoteColorPicker';
import { useToast } from '@/hooks/useToast';
import { markdownToHtml } from '@/lib';
import { Check } from 'lucide-react';
import { WelcomeEmptyState } from '@/components/ui/EmptyState';
import { EmptyNoteTemplatePicker } from '@/components/templates/EmptyNoteTemplatePicker';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';

export function Editor() {
  const { currentNote, updateNoteContent, isSaving, setSelectedDate, notes } = useNoteStore();
  const { spellCheck, showWordCount, showAutoSaveStatus } = useSettingsStore();
  const { theme } = useThemeStore();
  const { deleteCurrentNote, loadDailyNote, createNote, loadNote } = useNotes();
  const { getTemplateContent } = useTemplates();
  const { getColor } = useNoteColorsStore();
  const toast = useToast();

  // Determine if dark mode
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Get current note's background color
  const notePath = currentNote ? buildNotePath(currentNote.id.replace('.md', '') + '.md', currentNote.isDaily) : '';
  const noteColorId = getColor(notePath);
  const noteBackgroundColor = getNoteBackgroundColor(noteColorId, isDark);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);
  const [showInlineTemplatePicker, setShowInlineTemplatePicker] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [linkInitialValues, setLinkInitialValues] = useState({ url: '', text: '' });
  const prevIsSavingRef = useRef(isSaving);

  // Ref to always access latest notes for wiki link handler
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Handle wiki link clicks
  const handleWikiLinkClick = useCallback(async (target: string) => {
    const currentNotes = notesRef.current;

    // Check if target is a daily note (YYYY-MM-DD.md format)
    const isDailyNote = /^\d{4}-\d{2}-\d{2}\.md$/.test(target);

    // Direct match first (for properly formatted targets like "Test 1.md")
    let actualNote = currentNotes.find(n => n.name === target);

    // If no direct match, try slugified match (for targets like "test-1.md")
    if (!actualNote) {
      actualNote = currentNotes.find(n => {
        const slugified = n.name
          .toLowerCase()
          .replace(/\.md$/, '')
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9-]/g, '');
        const targetSlug = target
          .toLowerCase()
          .replace(/\.md$/, '');

        return slugified === targetSlug;
      });
    }

    const noteExists = !!actualNote;

    if (noteExists && actualNote) {
      // Load the existing note
      await loadNote(actualNote);
    } else {
      // Note doesn't exist - ask to create it
      const noteName = target.replace('.md', '').replace(/-/g, ' ');
      const confirmCreate = window.confirm(`Note "${noteName}" doesn't exist. Create it?`);

      if (confirmCreate) {
        try {
          // Create the note
          await invoke('create_note_from_link', { noteName: target.replace('.md', '') });

          // Load the newly created note
          await loadNote({
            name: target,
            path: target,
            isDaily: isDailyNote,
            date: isDailyNote ? target.replace('.md', '') : undefined,
            isLocked: false,
          });

          toast.success(`Created "${noteName}"`);
        } catch (error) {
          console.error('[Editor] Failed to create note from wiki link:', error);
          toast.error('Failed to create note');
        }
      }
    }
  }, [loadNote, toast]);

  const handleCreateToday = () => {
    const today = new Date();
    setSelectedDate(today);
    loadDailyNote(today);
  };

  const handleCreateNote = async () => {
    await createNote('Untitled');
  };

  // Track save completion to show success indicator
  useEffect(() => {
    if (prevIsSavingRef.current && !isSaving) {
      // Save just completed
      setShowSaveSuccess(true);
      const timer = setTimeout(() => setShowSaveSuccess(false), 2000);
      return () => clearTimeout(timer);
    }
    prevIsSavingRef.current = isSaving;
  }, [isSaving]);

  // Check if note is empty and show template picker
  useEffect(() => {
    if (currentNote) {
      const content = currentNote.content || '';
      // Check if content is empty (handle TipTap's empty HTML)
      const textOnly = content
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
      setShowInlineTemplatePicker(textOnly === '');
    } else {
      setShowInlineTemplatePicker(false);
    }
  }, [currentNote?.id, currentNote?.content]);

  // Handle template selection for empty note
  const handleTemplateSelect = async (templateId: string) => {
    try {
      const markdownContent = await getTemplateContent(templateId);
      if (editor) {
        // Convert markdown to HTML before setting in editor
        const htmlContent = markdownToHtml(markdownContent);
        editor.commands.setContent(htmlContent);
        setShowInlineTemplatePicker(false);
        toast.success('Template applied');
      }
    } catch (error) {
      console.error('[Editor] Failed to apply template:', error);
      toast.error('Failed to apply template');
    }
  };


  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      await deleteCurrentNote();
      setShowDeleteConfirm(false);
    } catch (error) {
      console.error('[Editor] Delete failed:', error);
      setShowDeleteConfirm(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: true,
        autolink: true,
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Highlight.configure({
        multicolor: false,
      }).extend({
        addKeyboardShortcuts() {
          return {
            'Mod-Shift-h': () => this.editor.commands.toggleHighlight(),
          };
        },
      }),
      WikiLink.configure({
        onLinkClick: handleWikiLinkClick,
      }),
      WikiLinkSuggestion.configure({
        suggestion: {
          char: '[',
          allowSpaces: true,
          items: ({ query }: { query: string }) => {
            // Filter notes based on query
            const currentNotes = notesRef.current;
            const filtered = currentNotes.filter((note) => {
              const noteName = note.name.replace('.md', '');
              return noteName.toLowerCase().includes(query.toLowerCase());
            });

            return filtered.slice(0, 10); // Limit to 10 results
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: Instance[] | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(WikiLinkSuggestionList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                  maxWidth: 'none',
                });
              },

              onUpdate(props: any) {
                component?.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup?.[0]?.setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown(props: any) {
                if (props.event.key === 'Escape') {
                  popup?.[0]?.hide();
                  return true;
                }

                return (component?.ref as any)?.onKeyDown(props.event) || false;
              },

              onExit() {
                // CRITICAL: Proper cleanup to allow re-triggering
                if (popup?.[0]) {
                  popup[0].destroy();
                }
                if (component) {
                  component.destroy();
                }
                // Reset references so suggestion can trigger again
                popup = null;
                component = null;
              },
            };
          },
          command: ({ editor, range, props }: any) => {
            const note = props as NoteFile;
            const noteName = note.name.replace('.md', '');

            editor
              .chain()
              .focus()
              .deleteRange(range)
              .setWikiLink({
                target: note.name,
                label: noteName,
              })
              .run();
          },
        },
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      updateNoteContent(html);
      // Hide template picker when user starts typing
      if (showInlineTemplatePicker && editor.getText().length > 0) {
        setShowInlineTemplatePicker(false);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-full p-6',
        spellcheck: spellCheck ? 'true' : 'false',
      },
    },
  }, [currentNote?.id]); // Recreate editor for each note to reset plugin state

  // Update editor content when note changes
  // Use a ref to access the latest currentNote without adding it to deps
  const currentNoteRef = React.useRef(currentNote);
  currentNoteRef.current = currentNote;

  React.useEffect(() => {
    const note = currentNoteRef.current;
    if (editor && note) {
      // Clear editor first to reset all plugin states (including suggestions)
      editor.commands.clearContent();

      // Use setTimeout(0) to ensure state is fully cleared before new content loads
      setTimeout(() => {
        editor.commands.setContent(note.content || '');
      }, 0);
    } else if (editor && !note) {
      editor.commands.clearContent();
    }
  }, [editor, currentNote?.id]);

  // Auto-save hook
  useAutoSave();

  // Link and image insertion handlers
  const handleInsertLink = useCallback(() => {
    if (!editor) return;

    // Check if cursor is on an existing link
    const previousUrl = editor.getAttributes('link').href || '';
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;
    const selectedText = hasSelection ? editor.state.doc.textBetween(from, to) : '';

    setLinkInitialValues({ url: previousUrl, text: selectedText });
    setIsLinkModalOpen(true);
  }, [editor]);

  const handleLinkInsert = useCallback((url: string, text?: string) => {
    if (!editor) return;

    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      // Apply link to selected text
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      // Insert new link with text
      const linkText = text || url;
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'text',
          marks: [{ type: 'link', attrs: { href: url } }],
          text: linkText,
        })
        .run();
    }
  }, [editor]);

  const handleImageInsert = useCallback((url: string, alt?: string) => {
    if (!editor) return;
    editor.chain().focus().setImage({ src: url, alt }).run();
  }, [editor]);

  // Keyboard shortcuts
  const {
    showTemplatePicker: showShortcutTemplatePicker,
    handleTemplateSelect: handleShortcutTemplateSelect,
    handleTemplatePickerClose: handleShortcutTemplatePickerClose,
  } = useKeyboardShortcuts({
    editor,
    onNewNote: () => {
      // Will be handled by parent
    },
    onToggleTheme: () => {
      // Will be handled by parent
    },
    onInsertLink: handleInsertLink,
  });

  if (!currentNote) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <WelcomeEmptyState
          onCreateToday={handleCreateToday}
          onCreateNote={handleCreateNote}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 modal-backdrop-dark flex items-center justify-center z-50 modal-backdrop-enter">
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 max-w-sm mx-4 modal-elevated modal-content-enter">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Delete Note
            </h3>
            <p className="text-gray-600 dark:text-gray-300 mb-4">
              Delete this note? This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg btn-danger-gradient btn-elevated focus-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header with formatting menu */}
      <EditorHeader editor={editor} onDelete={handleDeleteClick} />

      {/* Saving indicator */}
      {showAutoSaveStatus && (isSaving || showSaveSuccess) && (
        <div className="px-4 py-1.5 text-xs bg-gray-50 dark:bg-gray-900/50 flex items-center gap-1.5">
          {isSaving ? (
            <>
              <svg className="w-3 h-3 text-gray-400 dark:text-gray-500 spinner" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span className="text-gray-400 dark:text-gray-500 saving-indicator">Saving...</span>
            </>
          ) : showSaveSuccess ? (
            <>
              <Check className="w-3 h-3 text-green-500 dark:text-green-400 save-success-icon" />
              <span className="text-green-600 dark:text-green-400">Saved</span>
            </>
          ) : null}
        </div>
      )}

      {/* Editor */}
      <div
        className="flex-1 overflow-y-auto mx-4 my-4 rounded-lg editor-paper relative transition-colors duration-200"
        style={{ backgroundColor: noteBackgroundColor || (isDark ? '#1f2937' : 'white') }}
      >
        <EditorContent key={currentNote?.id || 'empty'} editor={editor} className="h-full content-enter" />

        {/* Inline template picker for empty notes */}
        {showInlineTemplatePicker && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <EmptyNoteTemplatePicker onSelectTemplate={handleTemplateSelect} />
            </div>
          </div>
        )}
      </div>

      {/* Word Count */}
      {showWordCount && editor && (
        <div className="px-6 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
          {editor.storage.characterCount?.words?.() ||
           editor.getText().split(/\s+/).filter(word => word.length > 0).length} words
        </div>
      )}

      {/* Template Picker Modal (Cmd+Shift+T shortcut) */}
      <TemplatePickerModal
        isOpen={showShortcutTemplatePicker}
        onClose={handleShortcutTemplatePickerClose}
        onSelect={handleShortcutTemplateSelect}
        title="Create note from template"
      />

      {/* Link and Image Modals */}
      <LinkModal
        isOpen={isLinkModalOpen}
        onClose={() => setIsLinkModalOpen(false)}
        onInsert={handleLinkInsert}
        initialUrl={linkInitialValues.url}
        initialText={linkInitialValues.text}
      />
      <ImageModal
        isOpen={isImageModalOpen}
        onClose={() => setIsImageModalOpen(false)}
        onInsert={handleImageInsert}
      />
    </div>
  );
}
