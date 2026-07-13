# The Forge

Your Forge is the folder where Moldavite stores every note as a plain Markdown
file. Multiple Forges can live side-by-side under a parent directory (the
**Forges root**, defaulting to `~/Documents/Moldavite/`). You can switch
between them from the dropdown at the top of the sidebar, create new ones
with **+ New Forge**, or rename / delete them in **Manage Forges…**.

```
~/Documents/Moldavite/        # Forges root
├── Personal/                 # Forge
├── Work/                     # Forge
└── Archive/                  # Forge
```

Switching the active Forge reloads the window so every cache and watcher
rebinds to the new root. Per-Forge state (recent notes, quick switcher
history) is namespaced in `localStorage` so each Forge keeps its own.

The previous single-folder layout (everything stored directly under
`~/Documents/Moldavite/`) is migrated automatically on first launch into
a `Default` Forge — no manual steps required.

Because it's plain `.md`, you can:

- Sync it with iCloud, Dropbox, Syncthing, or git.
- Edit notes in Obsidian, VS Code, vim, or any other text editor.
- Run scripts, search tools (`ripgrep`, `fd`), or AI agents over it.
- Back it up with whatever tool you already trust.

Moldavite watches the Forge and reloads automatically when files change. If
something seems out of sync, hit **Settings → General → Rescan Forge**.

## Directory layout

```
<Forge>/
├── AGENTS.md              # Optional generated guide for file-based agents
├── .gitignore             # Optional generated app-managed exclusions
├── daily/                  # Daily notes, named YYYY-MM-DD.md
│   └── 2026-05-01.md
├── weekly/                 # Weekly notes, named YYYY-Www.md
│   └── 2026-W18.md
├── notes/                  # Standalone notes (recursive — folders are subdirs)
│   ├── meeting.md
│   └── projects/
│       └── apollo.md
├── templates/              # Custom templates (JSON)
├── images/                 # Images dropped into notes
├── .plugins/               # Installed Forge-local plugins
├── .index/                 # App-managed semantic index (when enabled)
│   └── embeddings.v1.bin
└── .trash/                 # Soft-deleted notes (auto-purged after 7 days)
```

Hidden files and directories (anything starting with `.`) are ignored by the
normal note scanner, including `.trash/`, `.plugins/`, `.index/`, and sidecar
metadata. Dedicated subsystems still manage those three directories: trash,
plugins, and semantic search respectively. They never appear as notes.

When local semantic search is enabled, the model itself is cached under the
Moldavite app-data directory, **not** in the Forge. Only the per-Forge embedding
index lives under `.index/`. Locked notes, trashed notes, hidden trees, and
symlinks are excluded from indexing. The generated `.gitignore` includes
`.trash/`, `.plugins/`, `.index/`, and `.DS_Store`.

## Frontmatter schema

Notes can carry an optional YAML frontmatter block at the top, fenced by
`---` lines:

```markdown
---
color: blue
---

# Apollo kick-off

The actual note body starts here.
```

### Recognized fields

| field   | type   | purpose                                           |
|---------|--------|---------------------------------------------------|
| `color` | string | Sidebar color tag. One of `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, or `default`. |

### Forward compatibility

Moldavite preserves any other frontmatter keys it doesn't understand on
re-save, so it's safe to add your own metadata (tags, aliases, anything else
your tooling cares about). Future Moldavite versions may grow the recognized
set, but unknown keys won't be stripped.

If you don't set any recognized fields, Moldavite won't write a frontmatter
block at all — empty `.md` files stay empty.

## Wiki-link syntax

Inside any note body:

```markdown
[[Apollo]]                  # link to a note named apollo.md
[[Show this text|target]]   # link with a custom display label
```

Targets are slugified to lowercase + hyphens to match a filename in
`notes/`. Clicking an unresolved link offers to create that note.

## Encrypted notes (`.md.locked`)

A note locked with **Settings → Note → Lock** is rewritten as
`<name>.md.locked`. The file is opaque AES-256-GCM ciphertext + Argon2 KDF
parameters; it is **not** plain Markdown and external tools cannot read or
edit it. Unlock from inside Moldavite to round-trip.

## Adding files from outside

Drop a new `.md` file into `daily/`, `weekly/`, or `notes/` (anywhere under
`notes/`, folders are fine) and it'll appear in Moldavite within a moment.
If the watcher misses it, click **Rescan Forge**.

Removing a file is equally fine: delete it externally and Moldavite will
notice on the next scan or watcher tick.

## External edits and conflict copies

Moldavite records the body hash from the last time it read a note. If the file
changes on disk after that read and Moldavite later tries to save different
content, the app preserves both versions instead of silently replacing the
external edit:

1. The complete disk file, including frontmatter, is copied beside the note as
   `<name> (conflict YYYY-MM-DD HHMM).md`.
2. Moldavite saves its edits to the original note path.
3. A warning toast names the conflict copy and the note list refreshes so it is
   available for manual comparison and merging.

Conflict copies are ordinary Markdown notes. A simultaneous collision in the
same minute receives a numeric suffix such as `(2)` so an earlier copy is never
overwritten. This protection applies to saves made through Moldavite after it
has read the note; a program writing Forge files directly is responsible for
its own concurrency behavior.

## Agent-ready files

**Settings → AI & Agents → Make this Forge agent-ready** writes `AGENTS.md` and
`.gitignore` at the Forge root. The backend can write only those two exact root
filenames and asks before replacing either existing file. `AGENTS.md` documents
the layout, note naming, optional frontmatter, Unicode-aware wiki-link slugs,
tags, encrypted notes, and the app-managed directories agents must avoid.

File-based agents can edit Markdown directly when their client has filesystem
permission. The separate **Allow agents to write notes** switch controls only
Moldavite's built-in MCP write tools; it cannot revoke direct OS-level file
access already granted to another process.

## Caveats

- **Image references**: Moldavite renders images via Tauri's `asset://`
  protocol. If you write a note that you also want to read in another tool,
  use a relative path like `![](images/foo.png)` so it resolves there too.
- **Wiki-link slugs**: Moldavite converts `[[My Cool Note]]` to a target
  filename `my-cool-note.md`. Other tools may use a different convention —
  consider sticking to lowercase-hyphenated filenames if you want maximum
  portability.
- **Locked notes**: As noted above, `.md.locked` files are encrypted blobs.
  Don't try to edit them externally; the next unlock will fail.
- **App-managed hidden directories**: Don't edit `.trash/`, `.plugins/`, or
  `.index/` as if they were note folders. Rebuilding semantic search safely
  replaces `.index/`; deleting or hand-editing it only discards/corrupts the
  derived index, never the Markdown source notes.
- **The `.note-metadata.json.migrated` file**: Older versions of Moldavite
  stored note colors in `.note-metadata.json` at the Forge root. The
  one-shot migration moves them into per-file frontmatter and renames the
  sidecar to `.note-metadata.json.migrated`. You can safely delete it once
  you're satisfied your colors look right.
