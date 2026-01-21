import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';

/**
 * TipTap extension that provides a command menu when typing "/" at the start of a line.
 * Shows formatting options like headings, lists, quotes, code blocks, etc.
 */
export const SlashCommands = Extension.create({
  name: 'slashCommands',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: true, // Only trigger at start of line
        allowedPrefixes: null,
        pluginKey: new PluginKey('slashCommands'),
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
