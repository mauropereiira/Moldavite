import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

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
        pluginKey: new PluginKey('wikiLinkSuggestion'),
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
