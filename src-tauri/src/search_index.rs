//! Persistent keyword search index: one SQLite FTS5 database per Forge.
//!
//! # Why a file, and why not in the Forge
//!
//! Keyword search used to walk the whole Forge on every keystroke. This module
//! replaces that walk with an FTS5 index that answers in single-digit
//! milliseconds, ranks by BM25 instead of raw match count, and matches word
//! prefixes as the user types. The live scan in [`crate::commands::search`]
//! stays intact and is still the answer whenever this index is unavailable,
//! unbuilt or returns nothing.
//!
//! A SQLite database is written in place with a WAL sidecar, which is the
//! documented way to corrupt a database inside Dropbox or iCloud. The file
//! therefore lives outside the Forge, at
//! `<data_dir>/Moldavite/index/<sha256 of the canonical Forge path>/search.sqlite`,
//! next to the semantic model cache. A renamed or moved Forge hashes
//! differently and simply rebuilds; the orphan is harmless and
//! [`delete_for`] removes it with its Forge.
//!
//! # Schema
//!
//! `notes` holds one row per indexed note plus the stat pair reconcile
//! compares against, and `notes_fts` is an external-content FTS5 table kept in
//! step by the three standard triggers. `body` is stored so a hit can produce
//! the exact snippet, line number and match count the scan produces, by
//! running the same [`crate::commands::search::content_match_fields`] over it.
//! `is_daily`, `is_weekly` and `folder` are recorded for a future
//! filter-by-location query; the result mapping deliberately re-derives them
//! through `classify_note_path` so the two engines cannot disagree.
//!
//! # Lifecycle
//!
//! Modelled on [`crate::semantic`]. Note commands, the MCP tools and the
//! filesystem watcher call the cheap [`note_changed`] / [`note_removed`] /
//! [`note_renamed`] hooks, which hand the work to one background worker thread
//! so a save is never blocked. Startup, a Forge switch, the rebuild command
//! and a 24-hour timer run [`reconcile`], which compares every note's
//! `(mtime, size)` against the table and only hashes the ones that differ. A
//! missing file, a `schema_version` mismatch or a `forge_root` mismatch drops
//! the tables, and the index is not trusted again until the next reconcile
//! stamps `last_reconcile_ms`.
//!
//! # Two processes
//!
//! The MCP server is the same binary on the same Forge. It opens the file
//! read-write with a 250 ms `busy_timeout` and pushes its own writes through
//! the same hooks, but it never reconciles or rebuilds — that stays with the
//! app process, which owns the Forge's lifecycle. WAL means its reads never
//! block the app's writes.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::commands::search::{build_snippet, classify_note_path, content_match_fields};
use crate::types::ContentMatch;

/// On-disk schema version. Bump on any change to [`SCHEMA_SQL`]; a stored
/// value that does not match drops the tables and forces a rebuild.
const SCHEMA_VERSION: &str = "1";
/// How long either process waits for a lock the other one holds.
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
/// Self-heal cadence for the app process.
const RECONCILE_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
/// Index file name inside the per-Forge directory.
const INDEX_FILE: &str = "search.sqlite";

/// Tables, the external-content FTS5 index, and the three triggers that keep
/// it in step with `notes`. Every statement is `IF NOT EXISTS`, so this runs
/// on every open.
const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS notes (
  path       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  mtime_ms   INTEGER NOT NULL,
  size       INTEGER NOT NULL,
  is_daily   INTEGER NOT NULL,
  is_weekly  INTEGER NOT NULL,
  folder     TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title, body, content='notes', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
END;
-- Scoped to the two indexed columns so reconcile can refresh a touched
-- file's `(mtime, size)` without rewriting its FTS rows.
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE OF title, body ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body)
    VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
"#;

/// Dropped in this order so no trigger outlives the table it writes to.
const DROP_SQL: &str = r#"
DROP TRIGGER IF EXISTS notes_ai;
DROP TRIGGER IF EXISTS notes_ad;
DROP TRIGGER IF EXISTS notes_au;
DROP TABLE IF EXISTS notes_fts;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS meta;
"#;

/// Title matches weigh double. FTS5's `bm25()` returns smaller (more
/// negative) numbers for better matches, so the ordering is ascending.
const QUERY_SQL: &str = "SELECT notes.path, notes.body FROM notes_fts \
     JOIN notes ON notes.rowid = notes_fts.rowid \
     WHERE notes_fts MATCH ?1 ORDER BY bm25(notes_fts, 2.0, 1.0) LIMIT ?2";

/// Snapshot of the index for Settings.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchIndexStatus {
    /// The index exists, matches this Forge and schema, and has been
    /// reconciled at least once — only then does [`query`] answer from it.
    pub(crate) ready: bool,
    pub(crate) building: bool,
    pub(crate) note_count: u64,
    pub(crate) last_reconcile_ms: Option<i64>,
    pub(crate) index_path: String,
}

// =============================================================================
// LOCATION
// =============================================================================

/// Where every Forge's index directory lives in a real installation: the app
/// data dir, never a Forge.
fn default_index_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Moldavite")
        .join("index")
}

/// Tests get a per-process root under the temp dir so a test run never writes
/// into the developer's real app data directory.
#[cfg(test)]
fn index_root() -> PathBuf {
    std::env::temp_dir().join(format!("moldavite-test-index-{}", std::process::id()))
}

#[cfg(not(test))]
fn index_root() -> PathBuf {
    default_index_root()
}

/// SHA-256 of the Forge's canonical path. Canonicalization is best-effort: a
/// Forge that no longer exists hashes by the path as given, which is exactly
/// what [`delete_for`] needs when it runs before the directory is removed.
/// A Windows `\\?\` prefix is stable across calls, so hashing it is fine.
fn forge_id(forge_root: &Path) -> String {
    use sha2::{Digest, Sha256};
    let canonical = fs::canonicalize(forge_root).unwrap_or_else(|_| forge_root.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    format!("{:x}", hasher.finalize())
}

/// `<root>/<forge id>/search.sqlite`.
fn index_file_at(root: &Path, id: &str) -> PathBuf {
    root.join(id).join(INDEX_FILE)
}

/// The canonical Forge path as stored in `meta`, so a directory reused under
/// a different Forge is detected and rebuilt.
fn canonical_root_string(forge_root: &Path) -> String {
    fs::canonicalize(forge_root)
        .unwrap_or_else(|_| forge_root.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// =============================================================================
// PER-FORGE HANDLE
// =============================================================================

/// One lazily opened connection per Forge, behind a mutex. Both processes go
/// through this; the mutex only serializes this process's own access.
struct ForgeIndex {
    forge_root: PathBuf,
    file: PathBuf,
    conn: Mutex<Option<Connection>>,
    building: AtomicBool,
}

static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<ForgeIndex>>>> = OnceLock::new();

fn registry() -> &'static Mutex<HashMap<String, Arc<ForgeIndex>>> {
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn handle(forge_root: &Path) -> Arc<ForgeIndex> {
    let id = forge_id(forge_root);
    let mut map = registry().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(id.clone())
        .or_insert_with(|| {
            Arc::new(ForgeIndex {
                forge_root: forge_root.to_path_buf(),
                file: index_file_at(&index_root(), &id),
                conn: Mutex::new(None),
                building: AtomicBool::new(false),
            })
        })
        .clone()
}

impl ForgeIndex {
    /// Open the database, applying the pragmas and the schema, and dropping
    /// everything first when the stored schema version or Forge root does not
    /// match what this build expects.
    fn open(&self) -> Result<Connection, String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Failed to create index dir: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
            }
        }
        let conn = Connection::open(&self.file).map_err(|e| e.to_string())?;
        conn.busy_timeout(BUSY_TIMEOUT).map_err(|e| e.to_string())?;
        // `journal_mode` answers with a row, so it cannot go through execute().
        let _: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA synchronous=NORMAL;")
            .map_err(|e| e.to_string())?;

        let want_root = canonical_root_string(&self.forge_root);
        let version = meta_get(&conn, "schema_version");
        let root = meta_get(&conn, "forge_root");
        if version.as_deref() != Some(SCHEMA_VERSION) || root.as_deref() != Some(want_root.as_str())
        {
            if version.is_some() || root.is_some() {
                log::info!(
                    "[search index] rebuilding {:?}: schema {:?} root {:?} did not match {} / {}",
                    self.file,
                    version,
                    root,
                    SCHEMA_VERSION,
                    want_root
                );
            }
            conn.execute_batch(DROP_SQL).map_err(|e| e.to_string())?;
            conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
            meta_set(&conn, "schema_version", SCHEMA_VERSION).map_err(|e| e.to_string())?;
            meta_set(&conn, "forge_root", &want_root).map_err(|e| e.to_string())?;
        } else {
            conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
        }
        Ok(conn)
    }

    /// Run `f` against this Forge's connection. `create` decides whether a
    /// missing database file is created: hooks and reconcile create, reads
    /// never do, so merely searching a Forge never leaves a file behind.
    fn with_conn<T>(
        &self,
        create: bool,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut slot = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            if !create && !self.file.exists() {
                return Err("search index has not been built yet".to_string());
            }
            *slot = Some(self.open()?);
        }
        let conn = slot
            .as_ref()
            .ok_or_else(|| "search index connection missing".to_string())?;
        f(conn).map_err(|e| e.to_string())
    }

    /// `(ready, note_count, last_reconcile_ms)`. Anything that goes wrong
    /// reads as "not ready", which sends callers to the scan.
    ///
    /// Readiness hangs on `last_reconcile_ms`, and only a reconcile writes it.
    /// A fresh file, or one the schema check just wiped, therefore stays
    /// untrusted even after a hook upserts a note or two into it — otherwise a
    /// two-note index would happily answer for a two-thousand-note Forge.
    fn snapshot(&self) -> (bool, u64, Option<i64>) {
        self.with_conn(false, |conn| {
            let count: i64 = conn.query_row("SELECT count(*) FROM notes", [], |row| row.get(0))?;
            let last = last_reconcile_ms(conn);
            Ok((last.is_some(), count.max(0) as u64, last))
        })
        .unwrap_or((false, 0, None))
    }

    /// The readiness half of [`snapshot`](Self::snapshot), without the row
    /// count — every keystroke goes through this, and counting the table is
    /// the expensive part on a large Forge.
    fn is_ready(&self) -> bool {
        self.with_conn(false, |conn| Ok(last_reconcile_ms(conn).is_some()))
            .unwrap_or(false)
    }
}

fn last_reconcile_ms(conn: &Connection) -> Option<i64> {
    meta_get(conn, "last_reconcile_ms").and_then(|value| value.parse::<i64>().ok())
}

fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM meta WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// =============================================================================
// ROWS
// =============================================================================

/// One note as the index stores it.
struct NoteRow {
    path: String,
    title: String,
    body: String,
    hash: String,
    mtime_ms: i64,
    size: i64,
    is_daily: bool,
    is_weekly: bool,
    folder: Option<String>,
}

/// Read a note off disk into a row. `None` means "not indexable": gone,
/// locked, a symlink, unreadable, empty once frontmatter is stripped, or
/// outside `daily/`, `weekly/` and `notes/`.
fn read_row(forge_root: &Path, rel: &str) -> Option<NoteRow> {
    let abs = forge_root.join(rel);
    let metadata = fs::symlink_metadata(&abs).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return None;
    }
    let raw = fs::read_to_string(&abs).ok()?;
    let body = crate::frontmatter::parse_note(&raw).body;
    if body.trim().is_empty() {
        return None;
    }
    let (path, is_daily, is_weekly, folder) = classify_note_path(forge_root, &abs)?;
    let title = Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel.to_string());
    Some(NoteRow {
        hash: crate::semantic::content_hash(&body),
        mtime_ms: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0),
        size: metadata.len() as i64,
        path,
        title,
        body,
        is_daily,
        is_weekly,
        folder,
    })
}

fn write_row(conn: &Connection, row: &NoteRow) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO notes(path, title, body, hash, mtime_ms, size, is_daily, is_weekly, folder) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) \
         ON CONFLICT(path) DO UPDATE SET title = excluded.title, body = excluded.body, \
         hash = excluded.hash, mtime_ms = excluded.mtime_ms, size = excluded.size, \
         is_daily = excluded.is_daily, is_weekly = excluded.is_weekly, folder = excluded.folder",
        params![
            row.path,
            row.title,
            row.body,
            row.hash,
            row.mtime_ms,
            row.size,
            row.is_daily as i64,
            row.is_weekly as i64,
            row.folder,
        ],
    )?;
    Ok(())
}

fn delete_row(conn: &Connection, path: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
    Ok(())
}

// =============================================================================
// WORKER
// =============================================================================

enum Job {
    Changed(PathBuf, String),
    Removed(PathBuf, String),
    Renamed(PathBuf, String, String),
}

static WORKER: OnceLock<Option<Sender<Job>>> = OnceLock::new();

/// One background thread drains the queue, so a save only pays for a channel
/// send. The channel is unbounded; jobs carry only paths.
fn worker() -> Option<&'static Sender<Job>> {
    WORKER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            match std::thread::Builder::new()
                .name("search-index".into())
                .spawn(move || {
                    while let Ok(job) = rx.recv() {
                        apply(job);
                    }
                }) {
                Ok(_) => Some(tx),
                Err(error) => {
                    log::warn!("[search index] worker thread failed to start: {error}");
                    None
                }
            }
        })
        .as_ref()
}

fn apply(job: Job) {
    let (forge_root, work): (PathBuf, Vec<(String, bool)>) = match job {
        Job::Changed(root, rel) => (root, vec![(rel, true)]),
        Job::Removed(root, rel) => (root, vec![(rel, false)]),
        Job::Renamed(root, old, new) => (root, vec![(old, false), (new, true)]),
    };
    let index = handle(&forge_root);
    let result = index.with_conn(true, |conn| {
        for (rel, upsert) in &work {
            match upsert.then(|| read_row(&forge_root, rel)).flatten() {
                Some(row) => write_row(conn, &row)?,
                None => delete_row(conn, rel)?,
            }
        }
        Ok(())
    });
    if let Err(error) = result {
        log::warn!("[search index] update failed: {error}");
    }
}

fn enqueue(job: Job) {
    if let Some(tx) = worker() {
        let _ = tx.send(job);
    }
}

fn indexable(rel: &str) -> bool {
    crate::semantic::is_valid_note_index_path(rel)
}

// =============================================================================
// HOOKS
// =============================================================================

/// A note's content changed (save, restore, unlock, duplicate, …).
pub(crate) fn note_changed(rel_path: &str) {
    note_changed_in(rel_path, crate::paths::get_notes_dir());
}

/// [`note_changed`] for an explicitly selected Forge. The MCP process has no
/// Forge switcher, so it must not resolve the active Forge again on the worker.
pub(crate) fn note_changed_in(rel_path: &str, forge_root: PathBuf) {
    if !indexable(rel_path) {
        return;
    }
    enqueue(Job::Changed(forge_root, rel_path.to_string()));
}

/// A note went away (delete, trash, lock, move-source).
pub(crate) fn note_removed(rel_path: &str) {
    note_removed_in(rel_path, crate::paths::get_notes_dir());
}

pub(crate) fn note_removed_in(rel_path: &str, forge_root: PathBuf) {
    if !indexable(rel_path) {
        return;
    }
    enqueue(Job::Removed(forge_root, rel_path.to_string()));
}

/// A note moved: the old row goes and the new path is read fresh, both on the
/// same worker so the two can never race each other.
pub(crate) fn note_renamed(old_rel: &str, new_rel: &str) {
    note_renamed_in(old_rel, new_rel, crate::paths::get_notes_dir());
}

pub(crate) fn note_renamed_in(old_rel: &str, new_rel: &str, forge_root: PathBuf) {
    if !indexable(old_rel) || !indexable(new_rel) {
        return;
    }
    enqueue(Job::Renamed(
        forge_root,
        old_rel.to_string(),
        new_rel.to_string(),
    ));
}

/// Every note was deleted (`clear_all_notes`).
pub(crate) fn all_notes_removed_in(forge_root: PathBuf) {
    let index = handle(&forge_root);
    if let Err(error) = index.with_conn(false, |conn| {
        conn.execute_batch("DELETE FROM notes; INSERT INTO notes_fts(notes_fts) VALUES('rebuild');")
    }) {
        log::debug!("[search index] clear skipped: {error}");
    }
}

// =============================================================================
// QUERY
// =============================================================================

/// Turn the user's words into quoted FTS5 prefix tokens joined by the implicit
/// AND. Quoting is the whole point: it is what keeps `AND`, `OR`, `NOT`,
/// `NEAR`, `*`, `(` and `-` typed into the search box data rather than
/// operators. An inner `"` is doubled, the only escape FTS5 string literals have.
fn fts_match_expression(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split_whitespace()
        .map(|word| format!("\"{}\"*", word.replace('"', "\"\"")))
        .collect();
    if terms.is_empty() {
        None
    } else {
        Some(terms.join(" "))
    }
}

/// The snippet fields for one hit. The full query is tried first so a result
/// is identical to the scan's; failing that the individual terms, since FTS5
/// matched prefixes and the whole phrase need not appear. A hit that matched
/// only after diacritics folding contains no literal term at all, and falls
/// back to the note's opening line rather than being dropped.
fn hit_fields(body: &str, full_term: &str, terms: &[String]) -> (String, usize, u32) {
    if let Some(fields) = content_match_fields(body, full_term) {
        return fields;
    }
    for term in terms {
        if let Some(fields) = content_match_fields(body, term) {
            return fields;
        }
    }
    let line = body
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    (build_snippet(line, "", 120), 1, 1)
}

/// Answer a keyword search from the index.
///
/// `None` means "ask the scan instead": no index, not reconciled yet, a
/// locked or corrupt file, or a query FTS5 refused. It never panics and never
/// creates the database.
pub(crate) fn query(
    forge_root: &Path,
    notes_dir: &Path,
    query: &str,
    limit: u32,
) -> Option<Vec<ContentMatch>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    let index = handle(forge_root);
    if !index.is_ready() {
        return None;
    }
    let expression = fts_match_expression(trimmed)?;
    let cap = limit.clamp(1, 500) as i64;
    let rows: Vec<(String, String)> = index
        .with_conn(false, |conn| {
            let mut stmt = conn.prepare(QUERY_SQL)?;
            let mapped = stmt.query_map(params![expression, cap], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?;
            mapped.collect::<rusqlite::Result<Vec<_>>>()
        })
        .map_err(|error| {
            log::debug!("[search index] query fell back to the scan: {error}");
            #[cfg(test)]
            eprintln!("[search index] query fell back to the scan: {error}");
        })
        .ok()?;

    let full_term = trimmed.to_lowercase();
    let terms: Vec<String> = trimmed.split_whitespace().map(str::to_lowercase).collect();
    let mut matches = Vec::with_capacity(rows.len());
    for (rel, body) in rows {
        // Re-derive the addressing fields through the scan's own helper so a
        // hit is shaped identically whichever engine produced it.
        let Some((path, is_daily, is_weekly, folder_path)) =
            classify_note_path(notes_dir, &notes_dir.join(&rel))
        else {
            continue;
        };
        let filename = match rel.rsplit_once('/') {
            Some((_, leaf)) => leaf.to_string(),
            None => rel.clone(),
        };
        let (snippet, line_number, match_count) = hit_fields(&body, &full_term, &terms);
        matches.push(ContentMatch {
            filename,
            path,
            snippet,
            line_number,
            match_count,
            is_daily,
            is_weekly,
            folder_path,
        });
    }
    Some(matches)
}

// =============================================================================
// RECONCILE / REBUILD
// =============================================================================

/// Bring the index in line with disk. Only the app process calls this.
///
/// Every note's `(mtime, size)` is compared against the table and only the
/// ones that differ are read and hashed; a same-size edit is caught by the
/// hash, a vanished note by its row having no file. Returns the indexed count.
pub(crate) fn reconcile(forge_root: &Path) -> Result<u64, String> {
    let index = handle(forge_root);
    // One build at a time per Forge. A second caller gets the current count
    // rather than doing the same work twice.
    if index.building.swap(true, Ordering::SeqCst) {
        log::debug!("[search index] a build is already running for {forge_root:?}");
        return Ok(index.snapshot().1);
    }
    let started = SystemTime::now();
    let result = reconcile_now(&index, forge_root);
    index.building.store(false, Ordering::SeqCst);
    match &result {
        Ok(count) => log::info!(
            "[search index] reconciled {count} notes in {:?}",
            started.elapsed().unwrap_or_default()
        ),
        Err(error) => log::warn!("[search index] reconcile failed: {error}"),
    }
    result
}

fn reconcile_now(index: &ForgeIndex, forge_root: &Path) -> Result<u64, String> {
    let candidates = crate::semantic::scan_note_paths(forge_root);
    index.with_conn(true, |conn| {
        let tx = conn.unchecked_transaction()?;
        let mut existing: HashMap<String, (i64, i64, String)> = HashMap::new();
        {
            let mut stmt = tx.prepare("SELECT path, mtime_ms, size, hash FROM notes")?;
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            for row in rows {
                let (path, mtime_ms, size, hash) = row?;
                existing.insert(path, (mtime_ms, size, hash));
            }
        }

        let mut kept: HashSet<String> = HashSet::with_capacity(candidates.len());
        for (abs, rel) in &candidates {
            let Ok(metadata) = fs::metadata(abs) else {
                continue;
            };
            let mtime_ms = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let size = metadata.len() as i64;
            if let Some((stored_mtime, stored_size, _)) = existing.get(rel) {
                if *stored_mtime == mtime_ms && *stored_size == size {
                    kept.insert(rel.clone());
                    continue;
                }
            }
            match read_row(forge_root, rel) {
                Some(row) => {
                    // Same content behind a moved mtime — a sync client
                    // rewriting a file, say. Refresh the stat so the next
                    // reconcile skips it, but leave the FTS rows alone.
                    if existing.get(rel).map(|(_, _, hash)| hash.as_str()) == Some(&row.hash) {
                        tx.execute(
                            "UPDATE notes SET mtime_ms = ?1, size = ?2 WHERE path = ?3",
                            params![row.mtime_ms, row.size, row.path],
                        )?;
                    } else {
                        write_row(&tx, &row)?;
                    }
                    kept.insert(row.path);
                }
                // Emptied, locked between the walk and the read, or no longer
                // a plain file: it is not a note any more.
                None => delete_row(&tx, rel)?,
            }
        }
        for path in existing.keys() {
            if !kept.contains(path) {
                delete_row(&tx, path)?;
            }
        }
        meta_set(&tx, "last_reconcile_ms", &now_ms().to_string())?;
        tx.commit()?;
        Ok(kept.len() as u64)
    })
}

/// Throw the index away and build it again from disk, reporting `building`
/// for the whole call.
pub(crate) fn rebuild(forge_root: &Path) -> Result<u64, String> {
    let index = handle(forge_root);
    if index.building.swap(true, Ordering::SeqCst) {
        return Err("A search index build is already running".to_string());
    }
    log::info!("[search index] rebuilding {forge_root:?} from disk");
    let result = index
        .with_conn(true, |conn| {
            conn.execute_batch(
                "DELETE FROM notes; \
                 INSERT INTO notes_fts(notes_fts) VALUES('rebuild'); \
                 DELETE FROM meta WHERE key = 'last_reconcile_ms';",
            )
        })
        .and_then(|()| reconcile_now(&index, forge_root));
    index.building.store(false, Ordering::SeqCst);
    result
}

/// Rebuild the Forge off the calling thread; the Settings button uses this.
pub(crate) fn spawn_rebuild(forge_root: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(error) = rebuild(&forge_root) {
            log::warn!("[search index] rebuild failed: {error}");
        }
    });
}

/// Reconcile the active Forge off the calling thread. Startup and Forge
/// switches use this.
pub(crate) fn spawn_reconcile(forge_root: PathBuf) {
    tauri::async_runtime::spawn_blocking(move || {
        let _ = reconcile(&forge_root);
    });
}

/// Re-reconcile the active Forge every 24 hours, so an index that drifted
/// while the app was not watching heals on its own.
pub(crate) fn spawn_periodic_reconcile() {
    let spawned = std::thread::Builder::new()
        .name("search-index-heal".into())
        .spawn(|| loop {
            std::thread::sleep(RECONCILE_INTERVAL);
            let _ = reconcile(&crate::paths::get_notes_dir());
        });
    if let Err(error) = spawned {
        log::warn!("[search index] periodic reconcile thread failed to start: {error}");
    }
}

/// Report the index for one Forge.
pub(crate) fn status(forge_root: &Path) -> SearchIndexStatus {
    let index = handle(forge_root);
    let (ready, note_count, last_reconcile_ms) = index.snapshot();
    SearchIndexStatus {
        ready,
        building: index.building.load(Ordering::SeqCst),
        note_count,
        last_reconcile_ms,
        index_path: index.file.to_string_lossy().to_string(),
    }
}

/// Drop a Forge's index. Must run before the Forge directory is removed, so
/// the path still canonicalizes to the id the index was filed under.
pub(crate) fn delete_for(forge_root: &Path) {
    let id = forge_id(forge_root);
    let dir = index_root().join(&id);
    let removed = {
        let mut map = registry().lock().unwrap_or_else(|e| e.into_inner());
        map.remove(&id)
    };
    if let Some(index) = removed {
        // Close the connection first: Windows will not delete an open file.
        if let Ok(mut slot) = index.conn.lock() {
            slot.take();
        }
    }
    if let Err(error) = fs::remove_dir_all(&dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("[search index] could not remove {dir:?}: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::search::scan_notes_content_in;

    struct TempForge(PathBuf);

    impl TempForge {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-index-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            for sub in ["notes", "notes/Projects", "daily", "weekly"] {
                fs::create_dir_all(base.join(sub)).unwrap();
            }
            Self(base)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write(&self, rel: &str, body: &str) {
            let path = self.0.join(rel);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, body).unwrap();
        }
    }

    impl Drop for TempForge {
        fn drop(&mut self) {
            delete_for(&self.0);
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Paths returned by the index, sorted, for set comparisons.
    fn index_paths(forge: &TempForge, query_text: &str) -> Vec<String> {
        let mut paths: Vec<String> = query(forge.path(), forge.path(), query_text, 100)
            .expect("index should answer")
            .into_iter()
            .map(|hit| hit.path)
            .collect();
        paths.sort();
        paths
    }

    // ---- open and create ---------------------------------------------------

    #[test]
    fn default_index_root_sits_in_the_app_data_dir_not_a_forge() {
        let root = default_index_root();
        assert!(
            root.ends_with(Path::new("Moldavite").join("index")),
            "{root:?}"
        );
    }

    #[test]
    fn index_file_is_named_for_the_hash_of_the_canonical_forge_path() {
        let forge = TempForge::new("id");
        let root = std::env::temp_dir().join("moldavite-index-root-probe");
        let file = index_file_at(&root, &forge_id(forge.path()));
        assert_eq!(file.file_name().unwrap(), INDEX_FILE);
        let id = file
            .parent()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy();
        assert_eq!(id.len(), 64, "expected a sha256 hex directory name");
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
        // Stable across calls, and different for a different Forge.
        assert_eq!(id, forge_id(forge.path()));
        let other = TempForge::new("id-other");
        assert_ne!(id, forge_id(other.path()));
    }

    #[test]
    fn open_creates_the_schema_and_stamps_meta() {
        let forge = TempForge::new("open");
        forge.write("notes/alpha.md", "hello indexed world");
        reconcile(forge.path()).unwrap();

        let index = handle(forge.path());
        index
            .with_conn(false, |conn| {
                let tables: i64 = conn.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name IN ('meta','notes','notes_fts')",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(tables, 3);
                let triggers: i64 = conn.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'trigger'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!(triggers, 3);
                assert_eq!(meta_get(conn, "schema_version").as_deref(), Some("1"));
                assert!(meta_get(conn, "forge_root").is_some());
                let journal: String =
                    conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;
                assert_eq!(journal.to_lowercase(), "wal");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn query_is_none_until_a_reconcile_has_run() {
        let forge = TempForge::new("not-ready");
        forge.write("notes/alpha.md", "hello indexed world");
        assert!(query(forge.path(), forge.path(), "indexed", 10).is_none());
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "indexed"), vec!["notes/alpha.md"]);
    }

    // ---- upsert, remove, rename -------------------------------------------

    #[test]
    fn upsert_remove_and_rename_move_the_row() {
        let forge = TempForge::new("crud");
        forge.write("notes/alpha.md", "the quick brown fox");
        reconcile(forge.path()).unwrap();

        // Upsert through the hook path.
        forge.write("notes/beta.md", "another quick note");
        apply(Job::Changed(forge.path().into(), "notes/beta.md".into()));
        assert_eq!(
            index_paths(&forge, "quick"),
            vec!["notes/alpha.md", "notes/beta.md"]
        );

        // Rename moves the row rather than duplicating it.
        fs::rename(
            forge.path().join("notes/beta.md"),
            forge.path().join("notes/gamma.md"),
        )
        .unwrap();
        apply(Job::Renamed(
            forge.path().into(),
            "notes/beta.md".into(),
            "notes/gamma.md".into(),
        ));
        assert_eq!(
            index_paths(&forge, "quick"),
            vec!["notes/alpha.md", "notes/gamma.md"]
        );

        // Remove drops it.
        apply(Job::Removed(forge.path().into(), "notes/gamma.md".into()));
        assert_eq!(index_paths(&forge, "quick"), vec!["notes/alpha.md"]);
    }

    #[test]
    fn an_emptied_note_is_removed_rather_than_indexed_empty() {
        let forge = TempForge::new("emptied");
        forge.write("notes/alpha.md", "sturdy content here");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "sturdy"), vec!["notes/alpha.md"]);

        forge.write("notes/alpha.md", "   \n\n");
        apply(Job::Changed(forge.path().into(), "notes/alpha.md".into()));
        assert!(query(forge.path(), forge.path(), "sturdy", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn hooks_ignore_paths_outside_daily_weekly_and_notes() {
        let forge = TempForge::new("outside");
        forge.write("notes/alpha.md", "anchor note");
        reconcile(forge.path()).unwrap();
        let before = status(forge.path()).note_count;
        // These must not reach the worker at all.
        note_changed_in("templates/foo.md", forge.path().into());
        note_changed_in("../escape.md", forge.path().into());
        note_removed_in("notes/../../etc/passwd", forge.path().into());
        assert_eq!(status(forge.path()).note_count, before);
    }

    // ---- querying ----------------------------------------------------------

    #[test]
    fn prefix_queries_match_as_you_type() {
        let forge = TempForge::new("prefix");
        forge.write("notes/alpha.md", "we discussed plugins at length");
        forge.write("notes/beta.md", "entirely unrelated writing");
        reconcile(forge.path()).unwrap();

        for typed in ["p", "plug", "plugin", "plugins"] {
            assert_eq!(
                index_paths(&forge, typed),
                vec!["notes/alpha.md"],
                "prefix {typed:?} should match"
            );
        }
        // A prefix is anchored at a token, not a substring anywhere.
        assert!(query(forge.path(), forge.path(), "ugin", 10)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn several_words_are_combined_with_and_not_or() {
        let forge = TempForge::new("and");
        forge.write("notes/both.md", "alpha and omega together");
        forge.write("notes/one.md", "alpha only here");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "alpha omega"), vec!["notes/both.md"]);
    }

    #[test]
    fn diacritics_are_folded_in_both_directions() {
        let forge = TempForge::new("diacritics");
        forge.write("notes/cafe.md", "we met at the café on Tuesday");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "cafe"), vec!["notes/cafe.md"]);
        assert_eq!(index_paths(&forge, "café"), vec!["notes/cafe.md"]);
        // The hit still carries usable snippet fields even though the literal
        // query text does not occur in the body.
        let hit = &query(forge.path(), forge.path(), "cafe", 10).unwrap()[0];
        assert!(!hit.snippet.is_empty());
        assert!(hit.line_number >= 1);
        assert!(hit.match_count >= 1);
    }

    #[test]
    fn fts5_operators_typed_by_the_user_are_data_not_operators() {
        let forge = TempForge::new("operators");
        forge.write("notes/ops.md", "this note says AND and OR and NOT and NEAR");
        forge.write("notes/alpha.md", "alpha lives here");
        forge.write("notes/omega.md", "omega lives here");
        reconcile(forge.path()).unwrap();

        // A bare operator word matches the note that literally contains it.
        assert_eq!(index_paths(&forge, "AND"), vec!["notes/ops.md"]);
        assert_eq!(index_paths(&forge, "NOT"), vec!["notes/ops.md"]);
        assert_eq!(index_paths(&forge, "NEAR"), vec!["notes/ops.md"]);
        // `OR` between two terms must not widen the search into a union.
        assert!(query(forge.path(), forge.path(), "alpha OR omega", 10)
            .unwrap()
            .is_empty());
        // `-` must not exclude, `*` and `(` must not be parsed.
        assert_eq!(index_paths(&forge, "alpha -omega"), Vec::<String>::new());
        for hostile in [
            "alpha*",
            "(alpha",
            "alpha)",
            "\"alpha",
            "alpha\"\"",
            "^alpha",
        ] {
            let hits = query(forge.path(), forge.path(), hostile, 10);
            assert!(
                hits.is_some(),
                "{hostile:?} should be answered, not error out"
            );
        }
        // Terms that tokenize to nothing are allowed to defeat the index —
        // the caller falls back to the scan. What they must never do is panic.
        for empty in ["-", "*", "()", "^", "\""] {
            let _ = query(forge.path(), forge.path(), empty, 10);
        }
    }

    #[test]
    fn expressions_quote_every_term_and_double_inner_quotes() {
        assert_eq!(fts_match_expression("plug"), Some("\"plug\"*".to_string()));
        assert_eq!(
            fts_match_expression("a OR b"),
            Some("\"a\"* \"OR\"* \"b\"*".to_string())
        );
        assert_eq!(
            fts_match_expression("say \"hi\""),
            Some("\"say\"* \"\"\"hi\"\"\"*".to_string())
        );
        assert_eq!(fts_match_expression("   "), None);
    }

    #[test]
    fn locked_trashed_and_internal_files_are_never_indexed() {
        let forge = TempForge::new("excluded");
        forge.write("notes/visible.md", "shared needle here");
        forge.write("notes/secret.md.locked", "shared needle here");
        forge.write(".trash/old.md", "shared needle here");
        forge.write(".plugins/thing.md", "shared needle here");
        forge.write(".index/sneaky.md", "shared needle here");
        forge.write("notes/.hidden.md", "shared needle here");
        forge.write("templates/tpl.md", "shared needle here");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "needle"), vec!["notes/visible.md"]);
    }

    #[test]
    fn locking_removes_the_note_and_unlocking_puts_it_back() {
        let forge = TempForge::new("lock");
        forge.write("notes/secret.md", "confidential needle");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "confidential"), vec!["notes/secret.md"]);

        // Locking replaces the plaintext with a `.locked` ciphertext.
        fs::rename(
            forge.path().join("notes/secret.md"),
            forge.path().join("notes/secret.md.locked"),
        )
        .unwrap();
        note_removed_in("notes/secret.md", forge.path().into());
        eventually("dropped the locked note", || {
            query(forge.path(), forge.path(), "confidential", 10)
                .is_some_and(|hits| hits.is_empty())
        });

        fs::rename(
            forge.path().join("notes/secret.md.locked"),
            forge.path().join("notes/secret.md"),
        )
        .unwrap();
        note_changed_in("notes/secret.md", forge.path().into());
        eventually("restored the unlocked note", || {
            !index_paths(&forge, "confidential").is_empty()
        });
        assert_eq!(index_paths(&forge, "confidential"), vec!["notes/secret.md"]);
    }

    /// The hooks hand their work to a background thread, so a hook's effect
    /// lands shortly after the call rather than during it.
    fn eventually(what: &str, mut check: impl FnMut() -> bool) {
        for _ in 0..200 {
            if check() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("the index never {what} (waited 5s)");
    }

    // ---- reconcile ---------------------------------------------------------

    #[test]
    fn reconcile_picks_up_a_changed_file_by_mtime_and_size() {
        let forge = TempForge::new("reconcile-stat");
        forge.write("notes/alpha.md", "original wording");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "original"), vec!["notes/alpha.md"]);

        forge.write("notes/alpha.md", "replacement wording that is much longer");
        reconcile(forge.path()).unwrap();
        assert!(query(forge.path(), forge.path(), "original", 10)
            .unwrap()
            .is_empty());
        assert_eq!(index_paths(&forge, "replacement"), vec!["notes/alpha.md"]);
    }

    /// One column of the stored row for `notes/alpha.md`.
    fn stored<T: rusqlite::types::FromSql>(forge: &TempForge, column: &str) -> T {
        handle(forge.path())
            .with_conn(false, |conn| {
                conn.query_row(
                    &format!("SELECT {column} FROM notes WHERE path = 'notes/alpha.md'"),
                    [],
                    |row| row.get(0),
                )
            })
            .unwrap()
    }

    #[test]
    fn reconcile_catches_a_same_size_edit_through_the_hash() {
        let forge = TempForge::new("reconcile-hash");
        forge.write("notes/alpha.md", "aaaa bbbb");
        reconcile(forge.path()).unwrap();
        let first_hash: String = stored(&forge, "hash");
        let size_before: i64 = stored(&forge, "size");

        // A different body of exactly the same length: the `size` half of the
        // stat pair cannot see this, so only the hash can.
        forge.write("notes/alpha.md", "cccc dddd");
        assert_eq!(
            fs::metadata(forge.path().join("notes/alpha.md"))
                .unwrap()
                .len() as i64,
            size_before,
            "the edit must be the same size for this test to mean anything"
        );
        reconcile(forge.path()).unwrap();
        assert!(query(forge.path(), forge.path(), "aaaa", 10)
            .unwrap()
            .is_empty());
        assert_eq!(index_paths(&forge, "cccc"), vec!["notes/alpha.md"]);
        assert_ne!(stored::<String>(&forge, "hash"), first_hash);
    }

    #[test]
    fn a_touched_but_unchanged_file_only_refreshes_the_stat() {
        let forge = TempForge::new("reconcile-touch");
        forge.write("notes/alpha.md", "unchanged content");
        reconcile(forge.path()).unwrap();
        let hash_before: String = stored(&forge, "hash");

        // Pretend the file was rewritten with identical bytes, the way a sync
        // client does: the stat no longer matches, so reconcile must read and
        // hash it, find nothing changed, and update only the stat.
        handle(forge.path())
            .with_conn(false, |conn| {
                conn.execute(
                    "UPDATE notes SET mtime_ms = 1 WHERE path = 'notes/alpha.md'",
                    [],
                )
            })
            .unwrap();
        reconcile(forge.path()).unwrap();

        assert_ne!(
            stored::<i64>(&forge, "mtime_ms"),
            1,
            "the stat was refreshed"
        );
        assert_eq!(stored::<String>(&forge, "hash"), hash_before);
        assert_eq!(index_paths(&forge, "unchanged"), vec!["notes/alpha.md"]);
    }

    #[test]
    fn reconcile_drops_a_deleted_file() {
        let forge = TempForge::new("reconcile-delete");
        forge.write("notes/alpha.md", "vanishing needle");
        forge.write("notes/beta.md", "surviving needle");
        reconcile(forge.path()).unwrap();
        assert_eq!(status(forge.path()).note_count, 2);

        fs::remove_file(forge.path().join("notes/alpha.md")).unwrap();
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "needle"), vec!["notes/beta.md"]);
        assert_eq!(status(forge.path()).note_count, 1);
    }

    #[test]
    fn a_schema_version_mismatch_wipes_and_rebuilds() {
        let forge = TempForge::new("schema-mismatch");
        forge.write("notes/alpha.md", "durable needle");
        reconcile(forge.path()).unwrap();
        assert!(status(forge.path()).ready);

        // Stamp a version this build does not know, then force a reopen.
        handle(forge.path())
            .with_conn(false, |conn| meta_set(conn, "schema_version", "0"))
            .unwrap();
        close_connections();

        let after = status(forge.path());
        assert!(!after.ready, "a stale schema must not be trusted");
        assert_eq!(after.note_count, 0);
        assert!(after.last_reconcile_ms.is_none());
        assert!(query(forge.path(), forge.path(), "needle", 10).is_none());

        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "needle"), vec!["notes/alpha.md"]);
    }

    #[test]
    fn a_forge_root_mismatch_wipes_and_rebuilds() {
        let forge = TempForge::new("root-mismatch");
        forge.write("notes/alpha.md", "durable needle");
        reconcile(forge.path()).unwrap();

        handle(forge.path())
            .with_conn(false, |conn| {
                meta_set(conn, "forge_root", "somewhere-else-entirely")
            })
            .unwrap();
        close_connections();

        assert_eq!(status(forge.path()).note_count, 0);
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "needle"), vec!["notes/alpha.md"]);
    }

    /// Force every cached connection shut so the next access reopens and
    /// re-runs the schema and meta checks.
    fn close_connections() {
        let map = registry().lock().unwrap_or_else(|e| e.into_inner());
        for index in map.values() {
            if let Ok(mut slot) = index.conn.lock() {
                slot.take();
            }
        }
    }

    // ---- status and rebuild ------------------------------------------------

    #[test]
    fn status_reports_readiness_count_and_path() {
        let forge = TempForge::new("status");
        let before = status(forge.path());
        assert!(!before.ready);
        assert!(!before.building);
        assert_eq!(before.note_count, 0);
        assert!(before.last_reconcile_ms.is_none());
        assert!(before.index_path.ends_with(INDEX_FILE));

        forge.write("notes/alpha.md", "one");
        forge.write("daily/2026-01-01.md", "two");
        reconcile(forge.path()).unwrap();

        let after = status(forge.path());
        assert!(after.ready);
        assert!(!after.building);
        assert_eq!(after.note_count, 2);
        assert!(after.last_reconcile_ms.unwrap() > 0);
        assert_eq!(after.index_path, before.index_path);
    }

    #[test]
    fn rebuild_discards_everything_and_indexes_from_disk_again() {
        let forge = TempForge::new("rebuild");
        forge.write("notes/alpha.md", "needle one");
        reconcile(forge.path()).unwrap();

        // A row the index believes in but disk has never had.
        handle(forge.path())
            .with_conn(false, |conn| {
                conn.execute(
                    "INSERT INTO notes(path, title, body, hash, mtime_ms, size, is_daily, is_weekly, folder) \
                     VALUES ('notes/ghost.md', 'ghost', 'needle two', 'x', 0, 0, 0, 0, NULL)",
                    [],
                )
            })
            .unwrap();
        assert_eq!(
            index_paths(&forge, "needle"),
            vec!["notes/alpha.md", "notes/ghost.md"]
        );

        rebuild(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "needle"), vec!["notes/alpha.md"]);
    }

    #[test]
    fn delete_for_removes_the_index_directory() {
        let forge = TempForge::new("delete");
        forge.write("notes/alpha.md", "needle");
        reconcile(forge.path()).unwrap();
        let file = PathBuf::from(status(forge.path()).index_path);
        assert!(file.exists());

        delete_for(forge.path());
        assert!(!file.exists());
        assert!(!file.parent().unwrap().exists());
        // Deleting an index that is already gone is not an error.
        delete_for(forge.path());
    }

    // ---- hooks -------------------------------------------------------------

    #[test]
    fn a_gui_write_reaches_the_index_through_the_hook() {
        let forge = TempForge::new("gui-write");
        forge.write("notes/anchor.md", "anchor");
        reconcile(forge.path()).unwrap();

        // What `save_note` does: write the file, then call the hook. The hook
        // returns immediately and the worker catches up.
        forge.write("notes/Projects/fresh.md", "a brand new thought");
        note_changed_in("notes/Projects/fresh.md", forge.path().into());
        eventually("indexed the new note", || {
            !index_paths(&forge, "thought").is_empty()
        });
        let hit = &query(forge.path(), forge.path(), "thought", 10).unwrap()[0];
        assert_eq!(hit.path, "notes/Projects/fresh.md");
        assert_eq!(hit.filename, "fresh.md");
        assert_eq!(hit.folder_path.as_deref(), Some("Projects"));
        assert!(!hit.is_daily && !hit.is_weekly);
    }

    #[test]
    fn trashing_removes_the_note_and_restoring_puts_it_back() {
        let forge = TempForge::new("trash");
        forge.write("notes/doomed.md", "perishable needle");
        reconcile(forge.path()).unwrap();
        assert_eq!(index_paths(&forge, "perishable"), vec!["notes/doomed.md"]);

        // Trash moves the file under `.trash/`, which the walk never visits.
        fs::create_dir_all(forge.path().join(".trash")).unwrap();
        fs::rename(
            forge.path().join("notes/doomed.md"),
            forge.path().join(".trash/doomed.md"),
        )
        .unwrap();
        note_removed_in("notes/doomed.md", forge.path().into());
        eventually("dropped the trashed note", || {
            index_paths(&forge, "perishable").is_empty()
        });

        fs::rename(
            forge.path().join(".trash/doomed.md"),
            forge.path().join("notes/doomed.md"),
        )
        .unwrap();
        note_changed_in("notes/doomed.md", forge.path().into());
        eventually("re-indexed the restored note", || {
            !index_paths(&forge, "perishable").is_empty()
        });
        assert_eq!(index_paths(&forge, "perishable"), vec!["notes/doomed.md"]);
    }

    #[test]
    fn the_rename_hook_moves_the_row_rather_than_copying_it() {
        let forge = TempForge::new("rename-hook");
        forge.write("daily/2026-01-01.md", "movable needle");
        reconcile(forge.path()).unwrap();

        fs::rename(
            forge.path().join("daily/2026-01-01.md"),
            forge.path().join("daily/2026-01-02.md"),
        )
        .unwrap();
        note_renamed_in(
            "daily/2026-01-01.md",
            "daily/2026-01-02.md",
            forge.path().into(),
        );
        eventually("moved the renamed row", || {
            index_paths(&forge, "movable") == vec!["daily/2026-01-02.md".to_string()]
        });
        assert_eq!(status(forge.path()).note_count, 1);
        let hit = &query(forge.path(), forge.path(), "movable", 10).unwrap()[0];
        assert!(hit.is_daily);
    }

    // ---- parity with the scan ---------------------------------------------

    /// A corpus with a deliberately shared vocabulary, so most queries hit
    /// many notes and the two engines have plenty to disagree about.
    fn parity_corpus(forge: &TempForge) {
        const NOUNS: [&str; 10] = [
            "moldavite",
            "forge",
            "plugin",
            "calendar",
            "backlink",
            "template",
            "trash",
            "weekly",
            "graph",
            "encryption",
        ];
        const VERBS: [&str; 6] = [
            "renders",
            "indexes",
            "publishes",
            "migrates",
            "validates",
            "watches",
        ];
        for i in 0..200 {
            let noun = NOUNS[i % NOUNS.len()];
            let other = NOUNS[(i * 7 + 3) % NOUNS.len()];
            let verb = VERBS[i % VERBS.len()];
            // "section", not "paragraph": the scan matches substrings while
            // the index matches token prefixes, so a query like "graph" would
            // find "paragraph" in one engine only. The corpus deliberately
            // holds no word that a query term sits inside.
            let body = format!(
                "# Note {i}\n\nThe {noun} {verb} the {other} every morning.\n\n\
                 A second section about {noun} and its {other} neighbour.\n\n\
                 Closing line mentioning {verb} once more.\n"
            );
            let rel = match i % 4 {
                0 => format!("daily/2026-01-{i:03}.md"),
                1 => format!("weekly/2026-W{i:03}.md"),
                2 => format!("notes/Projects/note-{i}.md"),
                _ => format!("notes/note-{i}.md"),
            };
            forge.write(&rel, &body);
        }
    }

    #[test]
    fn parity_scan_and_index_agree_on_hits_and_fields() {
        let forge = TempForge::new("parity");
        parity_corpus(&forge);
        reconcile(forge.path()).unwrap();

        let queries = [
            "moldavite",
            "forge",
            "plugin",
            "calendar",
            "backlink",
            "template",
            "trash",
            "weekly",
            "graph",
            "encryption",
            "renders",
            "indexes",
            "publishes",
            "migrates",
            "validates",
            "watches",
            "moldav",
            "plugi",
            "calen",
            "backl",
            "templ",
            "encry",
            "morning",
            "section",
            "neighbour",
            "closing",
            "second",
            "note",
            "mentioning",
            "every",
        ];
        let trash = forge.path().join(".trash");
        for text in queries {
            let scanned = scan_notes_content_in(forge.path(), &trash, text, 500);
            let indexed = query(forge.path(), forge.path(), text, 500).expect("index answers");

            let scanned_paths: HashSet<&str> =
                scanned.iter().map(|hit| hit.path.as_str()).collect();
            let indexed_paths: HashSet<&str> =
                indexed.iter().map(|hit| hit.path.as_str()).collect();
            assert_eq!(
                scanned_paths, indexed_paths,
                "different hit set for {text:?}"
            );
            assert!(!scanned_paths.is_empty(), "{text:?} matched nothing");

            let by_path: HashMap<&str, &ContentMatch> =
                indexed.iter().map(|hit| (hit.path.as_str(), hit)).collect();
            for hit in &scanned {
                let other = by_path[hit.path.as_str()];
                assert_eq!(hit.filename, other.filename, "{text:?} {}", hit.path);
                assert_eq!(hit.snippet, other.snippet, "{text:?} {}", hit.path);
                assert_eq!(hit.line_number, other.line_number, "{text:?} {}", hit.path);
                assert_eq!(hit.match_count, other.match_count, "{text:?} {}", hit.path);
                assert_eq!(hit.is_daily, other.is_daily, "{text:?} {}", hit.path);
                assert_eq!(hit.is_weekly, other.is_weekly, "{text:?} {}", hit.path);
                assert_eq!(hit.folder_path, other.folder_path, "{text:?} {}", hit.path);
            }
        }
    }

    #[test]
    fn the_limit_the_caller_asks_for_is_respected() {
        let forge = TempForge::new("limit");
        parity_corpus(&forge);
        reconcile(forge.path()).unwrap();
        let hits = query(forge.path(), forge.path(), "note", 7).unwrap();
        assert_eq!(hits.len(), 7);
    }
}
