import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

/**
 * TipTap extension that provides autocomplete suggestions when typing # for tags.
 * Shows a dropdown of existing tags as the user types.
 */
export const TagSuggestion = Extension.create({
  name: 'tagSuggestion',

  addOptions() {
    return {
      suggestion: {
        char: '#',
        allowSpaces: false, // Tags don't have spaces
        startOfLine: false,
        allowedPrefixes: [' ', '\n', '\t', null], // Only trigger after whitespace or start
        pluginKey: new PluginKey('tagSuggestion'),
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
