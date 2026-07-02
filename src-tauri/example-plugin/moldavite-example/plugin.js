// Moldavite example plugin — demonstrates the v1 command API.
// Plugins run in a sandboxed Web Worker; every editor/ui call is async.
// See docs/PLUGINS.md for the full authoring guide.

export default function register(api) {
  // Insert the current time at the cursor.
  api.commands.add({
    id: 'insert-timestamp',
    label: 'Insert timestamp',
    handler: async () => {
      await api.editor.insertText(new Date().toISOString());
    },
  });

  // Toast the word count of the active note.
  api.commands.add({
    id: 'word-count',
    label: 'Word count',
    handler: async () => {
      const note = await api.editor.getActiveNote();
      if (!note) {
        await api.ui.toast('No active note', 'error');
        return;
      }
      const text = note.content.replace(/<[^>]+>/g, ' ');
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      await api.ui.toast(`${words} word${words === 1 ? '' : 's'}`, 'info');
    },
  });
}
