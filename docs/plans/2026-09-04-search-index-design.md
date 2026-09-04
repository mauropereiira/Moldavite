# Search Index Design

**Date:** 2026-09-04
**Status:** Implemented 2026-09-04 (`src-tauri/src/search_index.rs`)
**Priority:** Medium. The only known-debt item users can feel, and only at scale.

---

## Problem

Keyword search has no index. `search_notes_content_in` in
`src-tauri/src/commands/search.rs` walks the Forge with `WalkDir`, reads every
unlocked `.md` file, lowercases the body, and scans it for the query. The
frontend debounces at 150 ms (`src/stores/searchStore.ts`) and the MCP
`search_notes` tool calls the same function, so every keystroke and every agent
query pays a full read of the Forge.

Measured on 2026-09-04 with `stress_search_over_1000_note_vault`: 19 ms for
1,000 notes on an Apple Silicon SSD with a warm page cache. That is why nobody
has noticed. The cost grows linearly with total note bytes and is dominated by
disk when the cache is cold, the Forge sits on a spinning or network disk, or a
sync client is touching the files. A 20,000-note Forge on a cold cache is
whole seconds per keystroke.

Two secondary limits come from the same design: results rank by raw match
count rather than relevance, and matching is substring only, so `note` ranks a
file with twenty `notes` above one titled `Note`.

## Goal

Keyword search answers in single-digit milliseconds regardless of Forge size,
ranked by relevance, with prefix matching as you type. The frontend, the MCP
tool, and the existing tests keep the `ContentMatch` shape (`filename`,
`path`, `snippet`, `lineNumber`, `matchCount`, `isDaily`, `isWeekly`,
`folderPath`) unchanged. Nothing about it is user-visible except speed and
order.

## Non-goals

- Typo tolerance or fuzzy matching. The quick switcher already does fuzzy
  matching on titles in memory.
- Merging with the semantic index. They stay separate engines behind the
  existing mode chip.
- Indexing frontmatter keys or tags as fields. The schema leaves room; the
  first version indexes title and body only.
- Any UI change beyond a rebuild control in Settings.

## Decision: SQLite FTS5 through `rusqlite`

| Option | For | Against |
|---|---|---|
| SQLite FTS5 (`rusqlite` 0.40, `bundled` + `fts5`) | One file per Forge; BM25 ranking; prefix queries; `snippet()`; multi-process safe with WAL; can later hold the backlinks index and note metadata | Compiles SQLite from C, about 1.5 MB in the binary; CI already has the toolchains |
| tantivy 0.26 | Pure Rust; strong ranking; no C build | A directory of segment files; merges and schema evolution are our problem; larger binary; second process access is harder |
| Keep the scan, cache lowercase bodies in memory | Smallest change | Memory equals the Forge; cold start still reads everything; no ranking |

FTS5 wins on operational simplicity: one file, one schema version, one process
model that already handles the MCP server reading while the app writes.

## Where the index lives

Not inside the Forge. The semantic index sits at `<forge>/.index/` and is
safe there because it is a single blob written through `write_atomic`. A
SQLite file with a WAL is written in place, and SQLite inside a Dropbox or
iCloud folder is a documented corruption case. The index therefore lives in
the app data directory:

```text
<data_dir>/Moldavite/index/<forge-id>/search.sqlite
```

where `forge-id` is the SHA-256 of the Forge's canonical path, so a renamed
Forge rebuilds and an orphaned index is harmless. A missing index costs one
rebuild, which is the cheap operation by design. `delete_forge` removes the
matching directory.

## Schema

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);           -- schema_version, forge_root
CREATE TABLE notes (
  path       TEXT PRIMARY KEY,   -- Forge-relative, forward slashes
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,      -- frontmatter stripped, as parse_note returns it
  hash       TEXT NOT NULL,      -- sha256 of body, the same hash semantic.rs uses
  mtime_ms   INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  is_daily   INTEGER NOT NULL,
  is_weekly  INTEGER NOT NULL,
  folder     TEXT
);
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, body, content='notes', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
-- the three standard triggers keep notes_fts in step with notes
```

`body` is stored so a hit can produce the exact snippet, line number and match
count the scan produces today by calling the existing `build_snippet` on the
stored text. That keeps the frontend contract byte-identical and lets the
parity test compare the two engines directly.

## Query

```sql
SELECT n.path, n.title, n.body, n.is_daily, n.is_weekly, n.folder
FROM notes_fts f JOIN notes n ON n.rowid = f.rowid
WHERE notes_fts MATCH ?1
ORDER BY bm25(notes_fts, 2.0, 1.0)
LIMIT ?2;
```

The query string is built from the user's terms as quoted prefix tokens
(`"plug"*`), never interpolated, so FTS5 syntax in a search box is data, not
operators. Title matches weigh double.

Parity with today's substring matching: `unicode61` matches words and
prefixes, so `ugin` no longer finds `plugins`. When the index returns nothing
for a query the command falls back to the scan, which is rare, still correct,
and keeps the existing behavior reachable. If that fallback shows up in
practice the `trigram` tokenizer is the drop-in answer at roughly three times
the index size.

## Keeping it current

The semantic index is the model, with one improvement.

- **App writes.** Every place `commands/notes.rs`, `commands/trash.rs`,
  `commands/locking.rs`, `commands/import_obsidian.rs` and `mcp/tools.rs`
  already call `semantic::note_changed` or `note_removed` gains the matching
  `search_index::` call. Locking a note removes it; unlocking re-indexes it.
- **External writes.** `forge_watcher.rs` already debounces file events at
  300 ms with self-write suppression and today only emits `forge:changed` to
  the frontend. It gains a direct call into the index for the changed path, so
  an agent editing files, a sync client, or another editor is indexed without
  the frontend in the loop. This is the improvement over the semantic index,
  which waits for its next full reconcile.
- **Start and Forge switch.** `spawn_blocking`, like the backlinks index:
  open the Forge's file, compare every note's `(mtime, size)` against the
  table, hash only the ones that differ, upsert and delete the rest. A
  missing file, a `schema_version` mismatch, or a `forge_root` mismatch
  triggers a full rebuild. Search is served by the scan until the first
  reconcile finishes, then by the index.
- **Self-heal.** Every 24 hours, and from a **Rebuild search index** button
  next to the semantic one in Settings → AI & Agents, run the reconcile.
- **Never indexed.** `.md.locked`, `.trash/`, `.plugins/`, `.index/`, and
  empty bodies, using the same walk `semantic.rs` uses so the two indexes
  cannot disagree about what a note is.

## Two processes

The MCP server is the same binary in a second process on the same Forge. It
opens the index read-only with a 250 ms `busy_timeout` and falls back to the
scan when the file is missing, locked, or older than the schema it knows. Its
own writes reach the index through the app's watcher, exactly as any external
write does. WAL mode makes a reader never block the writer.

## Rollout

1. **Measure**, half a day. Extend `stress_test.rs` with a 10,000-note and a
   50,000-note Forge, warm and cold (drop the page cache), and record the scan
   numbers in this document. This is the gate: if 10,000 notes cold is under
   200 ms on the reference machine, stop here and reopen the question later.
2. **Index core**, one and a half days. `src-tauri/src/search_index.rs`: open
   or create, reconcile, upsert, remove, rename, query returning
   `Vec<ContentMatch>`. Unit tests against a temp Forge, and a parity test that
   runs a corpus through both engines and asserts the same hit set.
3. **Hooks**, one day. The note commands, the MCP tools, the watcher, start,
   Forge switch, `delete_forge`. Tests that a write, an external write, a
   lock, a rename and a trash each leave the index correct.
4. **Wire**, half a day. `search_notes_content` and `search_notes_content_in`
   prefer the index and fall back to the scan. `search_index_status` command
   and the Settings button. Logs name every rebuild and its reason.
5. **Scale**, one day. The stress Forges from step 1 against the index:
   rebuild time, query latency, incremental upsert latency, and the Windows
   and Linux CI builds with the bundled SQLite.
6. **Docs**, half a day. PROJECT_STATUS loses the known-debt line,
   ARCHITECTURE and CLAUDE.md gain the module, changelog entry.

About five working days. Each step is its own PR except 2 and 3, which share
a branch because the hooks are what make the tests meaningful.

## Risks

- **Drift between index and disk.** Content hashes on reconcile, the daily
  reconcile, the manual rebuild, and the zero-result fallback to the scan.
  A wrong index can cost a missed hit for at most a day; it can never show a
  note that does not exist because hits are re-read from the stored body.
- **Sync clients.** Answered by keeping the file out of the Forge.
- **Binary size.** About 1.5 MB for SQLite. Measured on the release build in
  step 5 and recorded here.
- **Privacy.** The index holds note text outside the Forge, in the same app
  data directory that already holds the semantic model cache and the
  credential-store namespace. Locked notes are never in it. It is deleted with
  its Forge and is not part of any export.
- **MSRV and CI.** `rusqlite` 0.40 builds on Rust 1.88; `bundled` needs a C
  compiler, which every CI job already has for other crates.

## Open questions

- Whether title-only matches should outrank body-only matches by more than
  the 2:1 weight above. Decide from the parity corpus in step 2.
- Whether the backlinks index should move into the same file once this
  exists. It is rebuilt from disk on every start today; the note table already
  holds everything it needs. Not in scope here, but the schema should not
  prevent it.

---

## Measured

Apple Silicon SSD, warm page cache, from `stress_test.rs` on 2026-09-04. Cold-cache numbers need root to drop the page cache and were not taken.

| Forge | scan query | index query | full reconcile | warm reconcile |
|---|---|---|---|---|
| 10,000 notes | 222 ms | 2.1 ms | 1.33 s | 85 ms |
| 50,000 notes | 1.33 s | 11 ms | 8.35 s | 477 ms |

The bundled SQLite adds about 1.6 MB of code to the binary.

## Deviations from the design above

- `rusqlite` 0.40 has no `fts5` feature; the bundled amalgamation always enables FTS5, and a test proves the virtual table and triggers exist.
- FTS5 rejects a table alias in `MATCH` and `bm25()`, so the query names `notes_fts` directly.
- The MCP process opens the index read-write and upserts its own writes, so an agent's search sees its own note even when the app is closed. It still never reconciles or rebuilds.
- The `notes_au` trigger fires on `title, body` only, so a touched-but-unchanged file refreshes its `(mtime, size)` without rewriting its FTS rows.
- Readiness means a completed reconcile, not an existing file, so a fresh index seeded by two MCP upserts does not answer for a whole Forge.
- Multi-word queries AND their prefix tokens; the scan matched the literal phrase. Parity is asserted over single-term and prefix queries, and the empty-result fallback covers the rest.
- Under `cfg(test)` the index root is a per-process temp dir so tests never touch the real app data dir.

