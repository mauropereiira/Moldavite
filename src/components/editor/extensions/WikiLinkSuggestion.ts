import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey, type EditorState } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

export const wikiLinkSuggestionPluginKey = new PluginKey('wikiLinkSuggestion');

/**
 * Starts only while the editor has focus; once open, the list stays until
 * Escape or blur ends it, since its buttons keep focus until their clicks
 * insert. With spaces allowed the match runs to the end of the text, so a
 * closing `]]` ends it as well: a phone has no Escape key to do that.
 */
export function wikiLinkSuggestionAllowed({
  editor,
  state,
  range,
  isActive,
}: {
  editor: Editor;
  state: EditorState;
  range: Range;
  isActive?: boolean;
}): boolean {
  return (
    (isActive === true || editor.isFocused) &&
    !state.doc.textBetween(range.from, range.to).includes(']]')
  );
}

/**
 * TipTap extension that provides autocomplete suggestions when typing [[ for wiki links.
 * Shows a dropdown of available notes as the user types.
 */
export const WikiLinkSuggestion = Extension.create({
  name: 'wikiLinkSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        allowedPrefixes: null, // Allow triggering after any character
        pluginKey: wikiLinkSuggestionPluginKey,
      } as Partial<SuggestionOptions>,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});
