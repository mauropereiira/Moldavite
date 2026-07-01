# Example Plugin

A minimal Moldavite plugin that registers two commands, demonstrating the v1
plugin API. Use it as a starting point for your own plugin.

## What it does

- **Insert timestamp** — inserts the current date/time (ISO 8601) at the cursor.
- **Word count** — shows a toast with the number of words in the active note.

Both commands appear in the command palette (⌘/Ctrl+P) and the editor slash
menu (type `/`) once the plugin is enabled.

## How it works

A plugin is a folder under your Forge at `.plugins/<id>/` containing:

- `manifest.json` — identity + declared capabilities (`id` must match the folder).
- `plugin.js` — an ES module that default-exports `register(api)`.

`register` is called once when the plugin loads. It uses the injected `api`:

- `api.commands.add({ id, label, handler })` — register a command.
- `api.editor.getActiveNote()` — read the active note (`{ title, content }`, content is HTML).
- `api.editor.insertText(text)` — insert plain text at the cursor.
- `api.ui.toast(message, kind)` — show a toast (`'info' | 'success' | 'error'`).

See `docs/PLUGINS.md` in the Moldavite repo for the full reference, the trust
model, and the v2 roadmap.
