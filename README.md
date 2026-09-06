<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.png">
  <img src="docs/banner-light.png" alt="Moldavite" width="100%">
</picture>

<p align="center">
  <a href="https://mauropereiira.github.io/Moldavite/">Website</a> ·
  <a href="https://mauropereiira.github.io/Moldavite/demo.html">Try it in your browser</a> ·
  <a href="https://mauropereiira.github.io/Moldavite/guide.html">Guide</a> ·
  <a href="https://github.com/mauropereiira/moldavite-skills">Agent Skills</a> ·
  <a href="https://github.com/mauropereiira/Moldavite/releases/latest">Download</a>
</p>

---

**Notes that stay yours.** Moldavite keeps every note as a Markdown file in a
folder you choose, on your computer. Local search, wiki-links, daily notes, a
calendar, and a built-in MCP server for the AI tools you already use.

No Moldavite account. No telemetry. Optional iCloud Drive sync on Mac. If Moldavite disappeared tomorrow,
you would still have every note, in plain text, exactly where you left it.

Local-first for macOS, and for Windows and Linux in beta.

## Install

**macOS** — Homebrew fetches the signed, notarized build for your architecture
and puts `moldavite` on your `PATH`:

```sh
brew install --cask mauropereiira/moldavite/moldavite
```

Or take the DMG from [the latest release](https://github.com/mauropereiira/Moldavite/releases/latest).

**Windows** — download `Moldavite_x.x.x_x64-setup.exe` from the same page. The
installer is not Authenticode-signed yet, so SmartScreen will warn you once:
choose **More info → Run anyway**. Updates delivered inside the app are
cryptographically signed and verified before they install.

**Linux (beta)** — download `Moldavite_x.x.x_amd64.AppImage` for any
distribution, `Moldavite_x.x.x_amd64.deb` for Debian and Ubuntu, or
`Moldavite-x.x.x-1.x86_64.rpm` for Fedora. All need glibc 2.38 or newer, which
means Ubuntu 24.04, Debian 13, Fedora 39 or later; the local semantic-search
runtime sets that floor. Mark the AppImage executable once, and install
`libfuse2` if your distribution does not ship it (`sudo apt install libfuse2`
on Ubuntu). In-app updates work for the AppImage. The deb and the rpm are
updated by installing the next one.

## Connect your AI

The app binary is also the MCP server. There is no separate daemon, and nothing
leaves your machine.

```sh
claude mcp add moldavite -- moldavite --mcp
```

Settings → AI & Agents generates the exact line for Claude Code, Claude Desktop,
Cursor, or any stdio MCP client — use it on Windows and Linux, where the path differs. Add
`--forge "Work"` to pin a client to one local Forge rather than following the
active local Forge. MCP currently supports local Forges; pin a local Forge when
using the Mac app’s synced iCloud Forge.

| Tool                   | Does                                                               | Default |
| ---------------------- | ------------------------------------------------------------------ | ------- |
| `list_notes`           | Enumerate notes and locked-note placeholders, optionally by folder | On      |
| `read_note`            | Read one unlocked note by Forge-relative path                      | On      |
| `search_notes`         | Ranked full-text search with snippets                              | On      |
| `get_backlinks`        | Every note linking to a given note                                 | On      |
| `create_note`          | Create a note                                                      | **Off** |
| `write_note`           | Replace a note's contents                                          | **Off** |
| `append_to_daily_note` | Append to today's note                                             | **Off** |

Write tools are off until you turn them on, and vanish from the tool list again
the moment you turn them off. Locked notes are excluded from all seven. When an
agent changes a note you have unsaved edits in, Moldavite names the agent and
asks before replacing anything.

**[Moldavite Skills](https://github.com/mauropereiira/moldavite-skills)** teach
an agent how to use all of this. They follow the Agent Skills spec, so they work
in Claude Code, Codex, and OpenCode:

```sh
/plugin marketplace add mauropereiira/moldavite-skills
/plugin install moldavite@moldavite-skills
```

Agents that read files directly and never speak MCP are covered too: one click
writes an `AGENTS.md` describing your Forge's conventions.

## The Forge

A Forge is a directory. Keep several and switch between them.

```
~/Documents/Moldavite/<Forge>/
  daily/        YYYY-MM-DD.md
  weekly/       YYYY-Www.md
  notes/        everything else, subfolders and all
  templates/
  images/
  .trash/       7-day retention
  .plugins/
```

Real Markdown with YAML frontmatter. Point Dropbox, iCloud, git or nothing at
all at it. Edit the files in another editor while Moldavite is open and it
notices.

### Start syncing on Mac

In Moldavite 2.7.0 or later, open **Settings → General → Use synced Forge** to
create a separate iCloud Forge on your Mac. Write notes there or use **Open
synced folder in Finder** to copy Markdown files into `notes/`. Your local
Forges stay separate. You can start on Mac before installing the iOS app.

See [the Mac iCloud guide](docs/MAC_ICLOUD.md) for setup, adding existing notes,
and troubleshooting. iOS availability and its full guide will follow separately.

## What else it does

Settings → Appearance offers S–XL text sizes for the editor and desktop Settings.

Wiki-links with vault-wide rename, backlinks, a graph view, full-text and local
semantic search, Apple and Google Calendar on a timeline, note locking with
AES-256-GCM, encrypted export, a one-time Obsidian importer that copies rather
than moves, and sandboxed plugins that run in a Worker with no network unless
you grant it.

Pin the notes you keep coming back to and they sit in a bar across the top,
reorderable, with the rest a click away. Rename a note by editing its title.
Order the sidebar A–Z, Z–A, or by hand — drag notes and folders where you want
them and they stay there.

**Clip any page to a note.** A browser extension turns the page you are reading
into Markdown in the Forge you choose — links kept, images and styling dropped —
and it works whether or not Moldavite is open. It is distributed from this
repository rather than the browser stores, so Chrome needs Developer mode and the
Firefox file is signed by Mozilla without being listed there. See
[docs/CLIPPER.md](docs/CLIPPER.md).

**Publish to WordPress.com** without minting a credential: sign in once in your
browser, pick a site, and the note becomes a draft. Publishing it again updates
that draft rather than scattering new ones. Self-hosted WordPress is covered by
a bundled plugin using an Application Password, since those sites have no
WordPress.com account to sign in with.

## Privacy

Every network connection the app can make is listed in
[the privacy note](https://mauropereiira.github.io/Moldavite/privacy.html). The
short version: update checks, and whatever you explicitly connect. Fonts are
self-hosted, so no page or panel in the app calls a CDN. Your notes are never
uploaded to be indexed, including by the semantic search, which runs its model
locally.

## Contributing

Issues and pull requests welcome. `docs/RELEASING.md` covers the release
process, `CLAUDE.md` the architecture, and `docs/DESIGN_CREAM.md` the design
system. Run `npm test`, `npm run lint`, and `cargo test` before opening a PR.

Use the Node version in `.nvmrc` — `nvm use` picks it up. Node only builds and
tests the app (the shipped binary is Rust and contains no Node runtime), but on
newer versions vitest fails to hand jsdom's globals to the test context, so
`localStorage` is undefined and a couple of hundred tests fail for no real
reason while the same commit passes in CI. `npm install` warns if your version
is outside the supported range.

MIT.

### iOS development

The iOS app is in development, with a phone layout, touch formatting controls and local-device onboarding. It is not yet available on the App Store. See [the mobile status and build guide](docs/MOBILE.md) for implemented features and remaining release work, and [the App Store handoff](docs/IOS_APP_STORE.md) for account setup and upload instructions.
