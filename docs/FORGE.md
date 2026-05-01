# The Forge

Your Forge is the folder where Moldavite stores every note as a plain Markdown
file. It defaults to `~/Documents/Moldavite/`, but you can move it anywhere
under your home folder via **Settings → General → Forge → Change**.

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
└── .trash/                 # Soft-deleted notes (auto-purged after 7 days)
```

Hidden files (anything starting with `.`) are ignored by Moldavite's scanner,
including `.trash/` and any sidecar metadata.

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
- **The `.note-metadata.json.migrated` file**: Older versions of Moldavite
  stored note colors in `.note-metadata.json` at the Forge root. The
  one-shot migration moves them into per-file frontmatter and renames the
  sidecar to `.note-metadata.json.migrated`. You can safely delete it once
  you're satisfied your colors look right.
