import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

export const wikiLinkSuggestionPluginKey = new PluginKey('wikiLinkSuggestion');

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
