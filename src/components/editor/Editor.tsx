import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { invoke } from '@tauri-apps/api/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import { EditorFooter } from './EditorFooter';
import { TabBar } from './TabBar';
import { SelectionToolbar } from './SelectionToolbar';
import { ImageToolbar } from './ImageToolbar';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { WikiLink, WikiLinkSuggestion, WikiLinkSuggestionList, TagMark, TagSuggestion, TagSuggestionList, SlashCommands, SlashCommandList, filterCommands } from './extensions';
import { ResizableImage } from './extensions/ResizableImage';
import type { TagItem, SlashCommandItem } from './extensions';
import { LinkModal } from './LinkModal';
import { ImageModal } from './ImageModal';
import './extensions/wiki-links.css';
import './extensions/tags.css';
import type { NoteFile } from '@/types';
import { useNoteStore, useSettingsStore, useThemeStore, useNoteColorsStore, buildNotePath, useTagStore } from '@/stores';
import { useAutoSave, useKeyboardShortcuts, useNotes, useTemplates } from '@/hooks';
import { getNoteBackgroundColor } from '@/components/ui/NoteColorPicker';
import { useToast } from '@/hooks/useToast';
import { markdownToHtml, processAndSaveImage } from '@/lib';
import { convertFileSrc } from '@tauri-apps/api/core';
import { WelcomeEmptyState } from '@/components/ui/EmptyState';
import { EmptyNoteTemplatePicker } from '@/components/templates/EmptyNoteTemplatePicker';
import { TemplatePickerModal } from '@/components/templates/TemplatePickerModal';

export function Editor() {
  const { currentNote, updateNoteContent, isSaving, setSelectedDate, notes, openTabs } = useNoteStore();
  const { spellCheck, tagsEnabled } = useSettingsStore();
  const { theme } = useThemeStore();
  const { deleteCurrentNote, loadDailyNote, createNote, loadNote } = useNotes();
  const { getTemplateContent } = useTemplates();
  const { getColor } = useNoteColorsStore();
  const { allTags, setSelectedTag } = useTagStore();
  const toast = useToast();

  // Handle tag clicks - filter notes by tag
  const handleTagClick = useCallback((tag: string) => {
    setSelectedTag(tag);
  }, [setSelectedTag]);

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

  // Ref to always access latest tags for tag suggestion handler
  const tagsRef = useRef(allTags);
  tagsRef.current = allTags;

  // Track if component is mounted to prevent state updates after unmount
  const isMountedRef = useRef(true);
  // Ref for scrollable editor container
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Ref for image file handler (to break circular dependency with useEditor)
  const handleImageFileRef = useRef<((file: File) => Promise<void>) | null>(null);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
            isWeekly: false,
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
      // Also check for images - if there's an img tag, the note has content
      const hasImages = /<img\s/i.test(content);
      const textOnly = content
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
      setShowInlineTemplatePicker(textOnly === '' && !hasImages);
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
        link: false,      // Disable - we configure Link separately below
        underline: false, // Disable - we add Underline separately below
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      ResizableImage.configure({
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
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      WikiLink.configure({
        onLinkClick: handleWikiLinkClick,
      }),
      // Only include TagMark and TagSuggestion when tags are enabled
      ...(tagsEnabled ? [TagMark.configure({
        onTagClick: handleTagClick,
      })] : []),
      ...(tagsEnabled ? [TagSuggestion.configure({
        suggestion: {
          char: '#',
          allowSpaces: false,
          items: ({ query }: { query: string }) => {
            // Get tags from ref and filter based on query
            const currentTags = tagsRef.current;
            const tagItems: TagItem[] = [];

            currentTags.forEach((count, name) => {
              if (name.toLowerCase().includes(query.toLowerCase())) {
                tagItems.push({ name, count });
              }
            });

            // Sort by count (descending), then alphabetically
            tagItems.sort((a, b) => {
              if (b.count !== a.count) return b.count - a.count;
              return a.name.localeCompare(b.name);
            });

            return tagItems.slice(0, 10); // Limit to 10 results
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: Instance[] | null = null;

            return {
              onStart: (props: any) => {
                try {
                  component = new ReactRenderer(TagSuggestionList, {
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
                } catch (error) {
                  console.error('[TagSuggestion] onStart error:', error);
                }
              },

              onUpdate(props: any) {
                try {
                  component?.updateProps(props);

                  if (!props.clientRect) {
                    return;
                  }

                  popup?.[0]?.setProps({
                    getReferenceClientRect: props.clientRect,
                  });
                } catch (error) {
                  console.error('[TagSuggestion] onUpdate error:', error);
                }
              },

              onKeyDown(props: any) {
                try {
                  if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                  }

                  return (component?.ref as any)?.onKeyDown(props.event) || false;
                } catch (error) {
                  console.error('[TagSuggestion] onKeyDown error:', error);
                  return false;
                }
              },

              onExit() {
                try {
                  if (popup?.[0]) {
                    popup[0].destroy();
                  }
                  if (component) {
                    component.destroy();
                  }
                } catch (error) {
                  console.error('[TagSuggestion] onExit error:', error);
                }
                popup = null;
                component = null;
              },
            };
          },
          command: ({ editor, range, props }: any) => {
            const tag = props as TagItem;
            // Insert the tag text (the # is already typed, just add the name)
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent(`#${tag.name} `)
              .run();
          },
        },
      })] : []),
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
                try {
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
                } catch (error) {
                  console.error('[WikiLinkSuggestion] onStart error:', error);
                }
              },

              onUpdate(props: any) {
                try {
                  component?.updateProps(props);

                  if (!props.clientRect) {
                    return;
                  }

                  popup?.[0]?.setProps({
                    getReferenceClientRect: props.clientRect,
                  });
                } catch (error) {
                  console.error('[WikiLinkSuggestion] onUpdate error:', error);
                }
              },

              onKeyDown(props: any) {
                try {
                  if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                  }

                  return (component?.ref as any)?.onKeyDown(props.event) || false;
                } catch (error) {
                  console.error('[WikiLinkSuggestion] onKeyDown error:', error);
                  return false;
                }
              },

              onExit() {
                // CRITICAL: Proper cleanup to allow re-triggering
                try {
                  if (popup?.[0]) {
                    popup[0].destroy();
                  }
                  if (component) {
                    component.destroy();
                  }
                } catch (error) {
                  console.error('[WikiLinkSuggestion] onExit error:', error);
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
      SlashCommands.configure({
        suggestion: {
          char: '/',
          allowSpaces: false,
          startOfLine: true,
          items: ({ query }: { query: string }) => {
            return filterCommands(query);
          },
          render: () => {
            let component: ReactRenderer | null = null;
            let popup: Instance[] | null = null;

            return {
              onStart: (props: any) => {
                try {
                  component = new ReactRenderer(SlashCommandList, {
                    props: {
                      ...props,
                      editor: props.editor,
                    },
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
                } catch (error) {
                  console.error('[SlashCommands] onStart error:', error);
                }
              },

              onUpdate(props: any) {
                try {
                  component?.updateProps({
                    ...props,
                    editor: props.editor,
                  });

                  if (!props.clientRect) {
                    return;
                  }

                  popup?.[0]?.setProps({
                    getReferenceClientRect: props.clientRect,
                  });
                } catch (error) {
                  console.error('[SlashCommands] onUpdate error:', error);
                }
              },

              onKeyDown(props: any) {
                try {
                  if (props.event.key === 'Escape') {
                    popup?.[0]?.hide();
                    return true;
                  }

                  return (component?.ref as any)?.onKeyDown(props.event) || false;
                } catch (error) {
                  console.error('[SlashCommands] onKeyDown error:', error);
                  return false;
                }
              },

              onExit() {
                try {
                  if (popup?.[0]) {
                    popup[0].destroy();
                  }
                  if (component) {
                    component.destroy();
                  }
                } catch (error) {
                  console.error('[SlashCommands] onExit error:', error);
                }
                popup = null;
                component = null;
              },
            };
          },
          command: ({ editor, range, props }: any) => {
            const item = props as SlashCommandItem;
            // Delete the "/" and run the command
            editor.chain().focus().deleteRange(range).run();
            item.command(editor);
          },
        },
      }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      try {
        const html = editor.getHTML();
        // Pass current note ID to prevent race conditions when switching notes
        const noteId = currentNoteRef.current?.id;
        updateNoteContent(html, noteId);
        // Hide template picker when user adds any content (text or images)
        if (showInlineTemplatePicker && !editor.isEmpty) {
          setShowInlineTemplatePicker(false);
        }
      } catch (error) {
        console.error('[Editor] onUpdate error:', error);
      }
    },
    onDestroy: () => {
      // Clean up any pending operations when editor is destroyed
      console.log('[Editor] Editor destroyed');
    },
    onSelectionUpdate: () => {
      // Wrap in try-catch to prevent crashes during selection
      try {
        // Selection update handling - no-op but catches errors
      } catch (error) {
        console.error('[Editor] Selection update error:', error);
      }
    },
    editorProps: {
      attributes: {
        class: 'prose dark:prose-invert max-w-none focus:outline-none min-h-full px-6 py-8',
        spellcheck: spellCheck ? 'true' : 'false',
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file && handleImageFileRef.current) {
              handleImageFileRef.current(file);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const file = files[0];
        if (file.type.startsWith('image/')) {
          event.preventDefault();
          if (handleImageFileRef.current) {
            handleImageFileRef.current(file);
          }
          return true;
        }
        return false;
      },
    },
  }, [tagsEnabled]); // Recreate editor when tagsEnabled changes

  // Handle image file from paste or drop
  const handleImageFile = useCallback(async (file: File) => {
    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      toast.error('Unsupported image format');
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Image must be smaller than 10MB');
      return;
    }

    try {
      // Resize and save image
      const savedPath = await processAndSaveImage(file);
      const imageUrl = convertFileSrc(savedPath);

      // Insert the image at the current cursor position
      if (editor && !editor.isDestroyed) {
        editor.chain().focus().setImage({ src: imageUrl }).run();
        toast.success('Image added');
      }
    } catch (err) {
      toast.error(`Failed to upload image: ${err}`);
    }
  }, [editor, toast]);

  // Keep ref updated for use in editorProps
  handleImageFileRef.current = handleImageFile;

  // Update editor content when note changes
  // Use a ref to access the latest currentNote without adding it to deps
  const currentNoteRef = React.useRef(currentNote);
  currentNoteRef.current = currentNote;

  React.useEffect(() => {
    const note = currentNoteRef.current;

    // Check if editor is valid and not destroyed
    if (!editor || editor.isDestroyed) {
      return;
    }

    // Check if component is still mounted
    if (!isMountedRef.current) {
      return;
    }

    try {
      if (note) {
        // Use a microtask to ensure React has finished its commit phase
        queueMicrotask(() => {
          try {
            // Double-check mounted and editor state before DOM operations
            if (isMountedRef.current && editor && !editor.isDestroyed) {
              // Clear and set content, then blur to clear any selection
              editor.commands.setContent(note.content || '');
              editor.commands.blur();
              // Reset scroll position to top
              if (scrollContainerRef.current) {
                scrollContainerRef.current.scrollTop = 0;
              }
            }
          } catch (error) {
            console.error('[Editor] setContent error:', error);
          }
        });
      } else {
        queueMicrotask(() => {
          try {
            // Double-check mounted and editor state before DOM operations
            if (isMountedRef.current && editor && !editor.isDestroyed) {
              editor.commands.clearContent();
            }
          } catch (error) {
            console.error('[Editor] clearContent error:', error);
          }
        });
      }
    } catch (error) {
      console.error('[Editor] Content update error:', error);
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
    openTemplatePicker,
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
          <div className="modal-elevated modal-content-enter p-6 max-w-sm mx-4" style={{ borderRadius: 'var(--radius-md)' }}>
            <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
              Delete Note
            </h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Delete this note? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleDeleteCancel}
                className="btn focus-ring"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="btn btn-danger focus-ring"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab bar - only show when there are open tabs */}
      {openTabs.length > 0 && <TabBar />}

      {/* Editor */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto editor-paper relative transition-colors duration-200"
        style={{ backgroundColor: noteBackgroundColor || (isDark ? '#0f1512' : 'white') }}
      >
        <EditorErrorBoundary resetKey={currentNote?.id}>
          <EditorContent editor={editor} className="h-full content-enter" />
          {/* Selection Toolbar (Bubble Menu) - inside error boundary */}
          {editor && !editor.isDestroyed && <SelectionToolbar editor={editor} onInsertLink={handleInsertLink} />}
          {/* Image Toolbar - shows when image is selected */}
          {editor && !editor.isDestroyed && <ImageToolbar editor={editor} />}
        </EditorErrorBoundary>

        {/* Inline template picker for empty notes */}
        {showInlineTemplatePicker && (
          <div
            className="absolute inset-0 flex items-center justify-center z-50"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            {/* Clickable overlay to dismiss picker and focus editor */}
            <div
              className="absolute inset-0 bg-transparent cursor-text"
              onClick={() => {
                setShowInlineTemplatePicker(false);
                editor?.commands.focus();
              }}
            />
            <div className="relative z-10">
              <EmptyNoteTemplatePicker
                onSelectTemplate={handleTemplateSelect}
                onOpenAllTemplates={openTemplatePicker}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer with save status, toolbar, and word count */}
      <EditorFooter
        editor={editor}
        onDelete={handleDeleteClick}
        isSaving={isSaving}
        showSaveSuccess={showSaveSuccess}
      />

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
