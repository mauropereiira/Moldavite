/**
 * Agent-ready Forge helpers.
 *
 * A Forge is already plain Markdown on disk, so AI agents (Claude Code, etc.)
 * can read and write it directly. This module generates the two files that
 * make that explicit — an `AGENTS.md` describing the vault's conventions and
 * a `.gitignore` covering app-managed directories — and wraps the whitelisted
 * backend commands that write them to the Forge root.
 *
 * The backend enforces a hard whitelist (exactly `AGENTS.md` and
 * `.gitignore`); see src-tauri/src/commands/root_files.rs.
 */

import { safeInvoke } from './ipc';

/** Distinct backend error when the target exists and overwrite was false. */
export const ROOT_FILE_EXISTS_ERROR = 'EXISTS';

/** Files the backend allows at the Forge root (mirror of the Rust whitelist). */
export type ForgeRootFile = 'AGENTS.md' | '.gitignore';

/** `.gitignore` content for a Forge: app-managed dirs + macOS noise. */
export const GITIGNORE_CONTENT = `.trash/
.plugins/
.index/
.DS_Store
`;

/**
 * Build the AGENTS.md content for a Forge. Describes only what Moldavite
 * actually does — directory layout, naming, frontmatter, wiki links, tags —
 * plus practical guidance for agents working in the vault.
 */
export function buildAgentsMd(forgeName: string): string {
  const name = forgeName.trim() || 'this Forge';
  return `# AGENTS.md — ${name}

This folder is a **Moldavite Forge**: a note vault of plain Markdown files
with optional YAML frontmatter. There is no database — the files on disk are
the source of truth, and the Moldavite app picks up external edits via a file
watcher. You can read, create, and edit notes directly with normal file tools.

## Directory layout

\`\`\`
daily/       Daily notes, one per day (YYYY-MM-DD.md, e.g. 2026-07-12.md)
weekly/      Weekly notes, one per ISO week (YYYY-Www.md, e.g. 2026-W28.md)
notes/       Standalone notes; subfolders allowed (notes/projects/roadmap.md)
templates/   Note templates as JSON files (managed in-app; avoid editing)
images/      Images pasted or inserted into notes
.trash/      App-managed trash (7-day retention) — do not touch
.plugins/    Installed Moldavite plugins — do not touch
.index/      Reserved for app-managed indexes — do not touch
\`\`\`

## Note format

Every note is Markdown, optionally starting with a YAML frontmatter block:

\`\`\`markdown
---
color: blue
---
Note body starts here.
\`\`\`

- Frontmatter is optional. Moldavite itself only reads the \`color\` key, but
  it **preserves any other keys** on save — you may add your own metadata
  (e.g. \`status\`, \`source\`) and it will survive edits made in the app.
- Write standard Markdown in the body: headings, lists, task lists
  (\`- [ ]\`), code blocks, images, links.

## Wiki links

Notes link to each other with \`[[Note Name]]\` or \`[[Display text|target-note]]\`.
A link resolves to a file whose name matches the **slug** of the target:
NFC-normalize, lowercase, trim, spaces → hyphens, then drop anything that is
not a Unicode letter, number, or hyphen. Accents are kept (\`[[Café]]\` →
\`café.md\`). If you create a standalone note you want linkable, name the file
with that slug.

## Tags

Inline \`#hashtags\` anywhere in a note body are tags; Moldavite aggregates
them in its sidebar. No frontmatter needed.

## How to add notes

- **Daily note:** create \`daily/YYYY-MM-DD.md\` for the date (one per day;
  append to it if it already exists).
- **Weekly note:** create \`weekly/YYYY-Www.md\` (ISO week, e.g. \`2026-W03.md\`).
- **Standalone note:** create a \`.md\` file under \`notes/\` (subfolders are
  fine). The note's title in the app is derived from the filename.

## Rules for agents

1. Write plain Markdown (+ optional YAML frontmatter). Do not write HTML bodies.
2. Never modify \`.trash/\`, \`.plugins/\`, \`.index/\`, or any dotfile the app
   maintains inside this vault.
3. Do not edit \`*.md.locked\` files — they are encrypted notes.
4. Prefer appending to an existing daily note over creating duplicates.
5. Keep filenames slug-friendly (see Wiki links) so \`[[links]]\` resolve.
`;
}

/**
 * Read a whitelisted Forge-root file. Returns null if it doesn't exist.
 */
export async function readForgeRootFile(filename: ForgeRootFile): Promise<string | null> {
  return await safeInvoke<string | null>('read_forge_root_file', { filename });
}

/**
 * Write a whitelisted Forge-root file. Returns the absolute path written.
 * Throws an Error whose message is `ROOT_FILE_EXISTS_ERROR` if the file
 * exists and `overwrite` is false.
 */
export async function writeForgeRootFile(
  filename: ForgeRootFile,
  content: string,
  overwrite: boolean
): Promise<string> {
  return await safeInvoke<string>('write_forge_root_file', { filename, content, overwrite });
}
