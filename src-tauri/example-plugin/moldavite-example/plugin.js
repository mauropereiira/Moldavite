// Moldavite example plugin — demonstrates the v1 command API.
// See docs/PLUGINS.md for the full authoring guide.

export default function register(api) {
  // Insert the current time at the cursor.
  api.commands.add({
    id: 'insert-timestamp',
    label: 'Insert timestamp',
    handler: () => {
      api.editor.insertText(new Date().toISOString());
    },
  });

  // Toast the word count of the active note.
  api.commands.add({
    id: 'word-count',
    label: 'Word count',
    handler: () => {
      const note = api.editor.getActiveNote();
      if (!note) {
        api.ui.toast('No active note', 'error');
        return;
      }
      const text = note.content.replace(/<[^>]+>/g, ' ');
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      api.ui.toast(`${words} word${words === 1 ? '' : 's'}`, 'info');
    },
  });
}
