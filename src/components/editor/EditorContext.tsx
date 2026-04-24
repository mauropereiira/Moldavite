import { createContext, useContext, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';

/**
 * Context that exposes the active Tiptap editor to descendant components
 * without threading it through every prop. Use `useEditorContext` inside the
 * provider's subtree; `useEditorOrNull` for call sites that may render before
 * the editor is ready.
 */
const EditorContext = createContext<Editor | null>(null);

export function EditorProvider({
  editor,
  children,
}: {
  editor: Editor | null;
  children: ReactNode;
}) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

/** Returns the editor, or null if the tree renders before it mounts. */
export function useEditorOrNull(): Editor | null {
  return useContext(EditorContext);
}

/** Returns the editor, throwing if consumed outside an `EditorProvider`. */
export function useEditorContext(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error('useEditorContext must be used within an EditorProvider');
  }
  return editor;
}
