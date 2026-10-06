//! What happened to which note and when, one SQLite file per Forge, for the
//! Timeline.
//!
//! # Where it lives
//!
//! `<data_dir>/Moldavite/activity/<sha256 of the canonical Forge path>/activity.sqlite`,
//! beside the keyword index and never inside the Forge: a database written in
//! place inside iCloud or Dropbox gets corrupted, and the record is this
//! device's own. A synced Forge therefore has one log per device. Deleting a
//! Forge deletes its log ([`delete_for`]); renaming one carries it along
//! ([`detach`] and [`reattach`]), since unlike the search index it cannot be
//! rebuilt from disk.
//!
//! # What a row holds
//!
//! Forge-relative paths (`daily/2026-10-06.md`, `notes/Projects/a.md`), an
//! action and times. Never a byte of a note, so a locked note is its name only.
//! `path` and `old_path` are the names when it happened; `note_path` follows the
//! note through later renames and moves, so an old row still opens it.
//!
//! # Coalescing
//!
//! Autosave writes every few hundred milliseconds. An edit merges into the
//! note's latest row when that row is a create or an edit begun less than
//! [`COALESCE_WINDOW_MS`] ago on the same local day, and the row's time only
//! moves once [`TOUCH_THROTTLE_MS`] has passed, so typing costs one indexed
//! read per save and a write every fifteen seconds. A note created and renamed
//! or discarded within that window keeps one row or none. Rows from file dates
//! never absorb live events.
//!
//! # Sources
//!
//! The app logs its own actions where it performs them, and quiets those paths
//! for [`ECHO_QUIET`] so the watcher's sight of the same write is not logged a
//! second time. The watcher logs what is left: other programs, sync clients
//! and the MCP server. The MCP server is a separate process and logs its own
//! writes as an agent's; the watcher's echo of one merges into it.
//! [`catch_up`] adds what changed while the app was closed, from file dates,
//! and on the first run seeds the history the same way.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chrono::{Local, NaiveDate, TimeZone};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

const LOG_FILE: &str = "activity.sqlite";
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
const COALESCE_WINDOW_MS: i64 = 30 * 60 * 1000;
const TOUCH_THROTTLE_MS: i64 = 15 * 1000;
/// A repeated trash, lock or restore inside this is the same action seen twice.
const REPEAT_MS: i64 = 60 * 1000;
const RETENTION_MS: i64 = 180 * 24 * 60 * 60 * 1000;
const MAX_ROWS: i64 = 50_000;
const PRUNE_EVERY: u32 = 500;
/// Covers the watcher's 300 ms debounce plus FSEvents' own latency.
const ECHO_QUIET: Duration = Duration::from_secs(15);
/// A file the watcher sees whose birth time is this recent was just created.
const FRESH_FILE_MS: i64 = 2 * 60 * 1000;
/// A file date this close to a logged row is that row, not a missed change.
/// Larger than [`TOUCH_THROTTLE_MS`], by which a row's time may trail its file.
const CATCH_UP_SLACK_MS: i64 = 60 * 1000;
/// A save in the same minute as the create is part of making the note.
const SAME_MINUTE_MS: i64 = 60 * 1000;
/// How far a file's time may trail the row the app wrote for the same change.
const ECHO_SLACK_MS: i64 = 2 * 1000;

const SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  first_ms  INTEGER NOT NULL,
  at_ms     INTEGER NOT NULL,
  action    TEXT NOT NULL,
  path      TEXT NOT NULL,
  old_path  TEXT,
  note_path TEXT NOT NULL,
  source    TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS events_by_time ON events(at_ms DESC, id DESC);
CREATE INDEX IF NOT EXISTS events_by_note ON events(note_path, id DESC);
"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Action {
    Created,
    Edited,
    Renamed,
    Moved,
    Trashed,
    Deleted,
    Restored,
    Locked,
    Unlocked,
}

impl Action {
    fn as_str(self) -> &'static str {
        match self {
            Action::Created => "created",
            Action::Edited => "edited",
            Action::Renamed => "renamed",
            Action::Moved => "moved",
            Action::Trashed => "trashed",
            Action::Deleted => "deleted",
            Action::Restored => "restored",
            Action::Locked => "locked",
            Action::Unlocked => "unlocked",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "created" => Action::Created,
            "edited" => Action::Edited,
            "renamed" => Action::Renamed,
            "moved" => Action::Moved,
            "trashed" => Action::Trashed,
            "deleted" => Action::Deleted,
            "restored" => Action::Restored,
            "locked" => Action::Locked,
            "unlocked" => Action::Unlocked,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Source {
    App,
    Agent,
    Outside,
    /// Inferred from a file's dates rather than seen happening.
    Files,
}

impl Source {
    fn as_str(self) -> &'static str {
        match self {
            Source::App => "app",
            Source::Agent => "agent",
            Source::Outside => "outside",
            Source::Files => "files",
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityEntry {
    pub(crate) id: i64,
    pub(crate) first_ms: i64,
    pub(crate) at_ms: i64,
    pub(crate) action: String,
    pub(crate) path: String,
    pub(crate) old_path: Option<String>,
    pub(crate) note_path: String,
    pub(crate) source: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityPage {
    pub(crate) entries: Vec<ActivityEntry>,
    pub(crate) has_more: bool,
    /// When this device first read the Forge's file dates; `None` until then.
    pub(crate) recording_since_ms: Option<i64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActivityCounts {
    pub(crate) counts: Vec<i64>,
    pub(crate) has_earlier: bool,
    pub(crate) recording_since_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct Event {
    action: Action,
    path: String,
    old_path: Option<String>,
    source: Source,
    at_ms: i64,
}

#[cfg(test)]
fn log_root() -> PathBuf {
    std::env::temp_dir().join(format!("moldavite-test-activity-{}", std::process::id()))
}

#[cfg(not(test))]
fn log_root() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Moldavite")
        .join("activity")
}

fn log_dir(forge_root: &Path) -> PathBuf {
    log_root().join(crate::search_index::forge_id(forge_root))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn local_day(ms: i64) -> Option<NaiveDate> {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|time| time.date_naive())
}

/// One lazily opened connection per Forge. The MCP process opens the same
/// file; WAL and the busy timeout let the two take turns.
struct ForgeLog {
    file: PathBuf,
    conn: Mutex<Option<Connection>>,
    inserts: Mutex<u32>,
}

static REGISTRY: OnceLock<Mutex<HashMap<PathBuf, Arc<ForgeLog>>>> = OnceLock::new();

fn handle(forge_root: &Path) -> Arc<ForgeLog> {
    let dir = log_dir(forge_root);
    let mut map = REGISTRY
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.entry(dir.clone())
        .or_insert_with(|| {
            Arc::new(ForgeLog {
                file: dir.join(LOG_FILE),
                conn: Mutex::new(None),
                inserts: Mutex::new(0),
            })
        })
        .clone()
}

fn forget_handle(dir: &Path) {
    let removed = REGISTRY
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(dir);
    if let Some(log) = removed {
        // Windows will not delete or rename an open file.
        log.conn.lock().unwrap_or_else(|e| e.into_inner()).take();
    }
}

impl ForgeLog {
    fn open(&self) -> Result<Connection, String> {
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("Failed to create log dir: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o700));
            }
        }
        let conn = Connection::open(&self.file).map_err(|e| e.to_string())?;
        conn.busy_timeout(BUSY_TIMEOUT).map_err(|e| e.to_string())?;
        let _: String = conn
            .query_row("PRAGMA journal_mode=WAL", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA synchronous=NORMAL; PRAGMA secure_delete=ON;")
            .map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA_SQL).map_err(|e| e.to_string())?;
        Ok(conn)
    }

    /// Reads pass `create: false`, so looking at a Forge's Timeline never
    /// leaves a file behind.
    fn with_conn<T>(
        &self,
        create: bool,
        f: impl FnOnce(&mut Connection) -> rusqlite::Result<T>,
    ) -> Result<T, String> {
        let mut slot = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        if slot.is_none() {
            if !create && !self.file.exists() {
                return Err("activity log not created yet".to_string());
            }
            *slot = Some(self.open()?);
        }
        let conn = slot
            .as_mut()
            .ok_or_else(|| "activity log connection missing".to_string())?;
        f(conn).map_err(|e| e.to_string())
    }
}

fn meta_get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .ok()
    .flatten()
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

struct Latest {
    id: i64,
    first_ms: i64,
    at_ms: i64,
    action: Option<Action>,
    old_path: Option<String>,
    from_files: bool,
}

fn latest_for(conn: &Connection, note_path: &str) -> rusqlite::Result<Option<Latest>> {
    conn.query_row(
        "SELECT id, first_ms, at_ms, action, old_path, source FROM events \
         WHERE note_path = ?1 ORDER BY id DESC LIMIT 1",
        [note_path],
        |row| {
            let action: String = row.get(3)?;
            let source: String = row.get(5)?;
            Ok(Latest {
                id: row.get(0)?,
                first_ms: row.get(1)?,
                at_ms: row.get(2)?,
                action: Action::parse(&action),
                old_path: row.get(4)?,
                from_files: source == Source::Files.as_str(),
            })
        },
    )
    .optional()
}

impl Latest {
    /// Whether a live event at `at_ms` may still be folded into this row.
    fn open_at(&self, at_ms: i64) -> bool {
        !self.from_files
            && at_ms - self.first_ms < COALESCE_WINDOW_MS
            && local_day(self.first_ms) == local_day(at_ms)
    }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn move_kind(from: &str, to: &str) -> Action {
    if parent_of(from) == parent_of(to) {
        Action::Renamed
    } else {
        Action::Moved
    }
}

fn insert(conn: &Connection, event: &Event, first_ms: i64) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO events(first_ms, at_ms, action, path, old_path, note_path, source) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?4, ?6)",
        params![
            first_ms,
            event.at_ms,
            event.action.as_str(),
            event.path,
            event.old_path,
            event.source.as_str(),
        ],
    )?;
    Ok(())
}

/// Point the rows of the note at `from` to its new place. Rows from before
/// the last time something at `from` was trashed or deleted belong to a
/// different note and keep their path.
fn follow_note(conn: &Connection, from: &str, to: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE events SET note_path = ?2 WHERE note_path = ?1 AND id > \
         (SELECT COALESCE(MAX(id), 0) FROM events WHERE note_path = ?1 \
          AND action IN ('trashed', 'deleted'))",
        params![from, to],
    )?;
    Ok(())
}

/// Write one event, folding it into the note's latest row where the rules in
/// the module header say so. Returns whether a row was inserted.
fn apply_event(conn: &Connection, event: &Event) -> rusqlite::Result<bool> {
    let at = event.at_ms;
    match event.action {
        Action::Edited => {
            if let Some(latest) = latest_for(conn, &event.path)? {
                if matches!(latest.action, Some(Action::Created | Action::Edited))
                    && latest.open_at(at)
                {
                    if at - latest.at_ms >= TOUCH_THROTTLE_MS {
                        conn.execute(
                            "UPDATE events SET at_ms = ?2, count = count + 1 WHERE id = ?1",
                            params![latest.id, at],
                        )?;
                    }
                    return Ok(false);
                }
            }
        }
        Action::Created => {
            if let Some(latest) = latest_for(conn, &event.path)? {
                if latest.action == Some(Action::Created) && latest.open_at(at) {
                    conn.execute(
                        "UPDATE events SET at_ms = MAX(at_ms, ?2) WHERE id = ?1",
                        params![latest.id, at],
                    )?;
                    return Ok(false);
                }
            }
        }
        Action::Renamed | Action::Moved => {
            let Some(from) = event.old_path.as_deref() else {
                return Ok(false);
            };
            let to = event.path.as_str();
            if from == to {
                return Ok(false);
            }
            let latest = latest_for(conn, from)?;
            follow_note(conn, from, to)?;
            if let Some(latest) = latest.filter(|latest| latest.open_at(at)) {
                match latest.action {
                    Some(Action::Created) => {
                        conn.execute(
                            "UPDATE events SET path = ?2 WHERE id = ?1",
                            params![latest.id, to],
                        )?;
                        return Ok(false);
                    }
                    Some(Action::Renamed | Action::Moved) => {
                        let origin = latest.old_path.unwrap_or_default();
                        if origin == to {
                            conn.execute("DELETE FROM events WHERE id = ?1", [latest.id])?;
                        } else {
                            conn.execute(
                                "UPDATE events SET path = ?2, action = ?3, at_ms = ?4 \
                                 WHERE id = ?1",
                                params![latest.id, to, move_kind(&origin, to).as_str(), at],
                            )?;
                        }
                        return Ok(false);
                    }
                    _ => {}
                }
            }
            let event = Event {
                action: move_kind(from, to),
                ..event.clone()
            };
            insert(conn, &event, at)?;
            return Ok(true);
        }
        Action::Deleted => {
            if let Some(latest) = latest_for(conn, &event.path)? {
                // A note made and thrown away inside the window never was.
                if event.source == Source::App
                    && latest.action == Some(Action::Created)
                    && latest.open_at(at)
                {
                    conn.execute(
                        "DELETE FROM events WHERE note_path = ?1 AND id >= ?2",
                        params![event.path, latest.id],
                    )?;
                    return Ok(false);
                }
                if matches!(latest.action, Some(Action::Deleted | Action::Trashed))
                    && at - latest.at_ms < REPEAT_MS
                {
                    return Ok(false);
                }
            }
        }
        Action::Trashed | Action::Restored | Action::Locked | Action::Unlocked => {
            if let Some(latest) = latest_for(conn, &event.path)? {
                if latest.action == Some(event.action) && at - latest.at_ms < REPEAT_MS {
                    return Ok(false);
                }
            }
        }
    }
    insert(conn, event, at)?;
    Ok(true)
}

fn prune(conn: &Connection, now: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM events WHERE at_ms < ?1", [now - RETENTION_MS])?;
    let count: i64 = conn.query_row("SELECT count(*) FROM events", [], |row| row.get(0))?;
    if count > MAX_ROWS {
        conn.execute(
            "DELETE FROM events WHERE id IN \
             (SELECT id FROM events ORDER BY at_ms ASC, id ASC LIMIT ?1)",
            [count - MAX_ROWS],
        )?;
    }
    Ok(())
}

fn locked_twin(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(".locked");
    PathBuf::from(name)
}

fn exists_on_disk(forge_root: &Path, rel: &str) -> bool {
    let path = forge_root.join(rel);
    path.is_file() || locked_twin(&path).is_file()
}

/// `(birth, modified)` in ms. Linux and Android cannot keep a birth time
/// across the atomic rename every save does, so there it is left out.
fn file_times(forge_root: &Path, rel: &str) -> Option<(Option<i64>, i64)> {
    let path = forge_root.join(rel);
    let meta = fs::metadata(&path)
        .or_else(|_| fs::metadata(locked_twin(&path)))
        .ok()?;
    let ms = |time: SystemTime| {
        time.duration_since(UNIX_EPOCH)
            .ok()
            .map(|d| d.as_millis() as i64)
    };
    let birth = if cfg!(any(target_os = "linux", target_os = "android")) {
        None
    } else {
        meta.created().ok().and_then(ms)
    };
    Some((birth, meta.modified().ok().and_then(ms)?))
}

fn covered(conn: &Connection, note_path: &str, since_ms: i64) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE note_path = ?1 AND at_ms >= ?2)",
        params![note_path, since_ms],
        |row| row.get(0),
    )
}

fn has_rows(conn: &Connection, note_path: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM events WHERE note_path = ?1)",
        [note_path],
        |row| row.get(0),
    )
}

/// The watcher's batch. Debouncing collapses create, modify and remove into
/// "something happened here", so presence on disk decides. A batch that is
/// exactly one note gone and one unfamiliar note appeared is another program
/// renaming or moving it.
fn apply_outside(
    conn: &Connection,
    forge_root: &Path,
    rels: &[String],
    at: i64,
) -> rusqlite::Result<()> {
    let mut missing = Vec::new();
    let mut present = Vec::new();
    for rel in rels {
        if !exists_on_disk(forge_root, rel) {
            missing.push(rel.clone());
            continue;
        }
        // A permission, attribute or download event leaves the modified time
        // alone, and is not an edit.
        let (birth, modified) = file_times(forge_root, rel).unwrap_or((None, 0));
        let born = birth.filter(|born| at - born < FRESH_FILE_MS);
        let touched = at - modified < FRESH_FILE_MS;
        present.push((rel.clone(), born, touched.then_some(modified)));
    }
    if let ([gone], [(appeared, None, _)]) = (missing.as_slice(), present.as_slice()) {
        if has_rows(conn, gone)? && !has_rows(conn, appeared)? {
            let event = Event {
                action: move_kind(gone, appeared),
                path: appeared.clone(),
                old_path: Some(gone.clone()),
                source: Source::Outside,
                at_ms: at,
            };
            apply_event(conn, &event)?;
            return Ok(());
        }
    }
    for rel in missing {
        let event = Event {
            action: Action::Deleted,
            path: rel,
            old_path: None,
            source: Source::Outside,
            at_ms: at,
        };
        apply_event(conn, &event)?;
    }
    // The file's own times, not the moment the watcher looked: a batch can
    // arrive late, and an edit must not move a row past the note's last save.
    for (rel, born, modified) in present {
        let events = [
            born.map(|born| (Action::Created, born)),
            modified.map(|modified| (Action::Edited, modified)),
        ];
        for (action, at_ms) in events.into_iter().flatten() {
            // A row already as new as the file is this process's own write,
            // seen after its quiet window, or a second look at the same change.
            if covered(conn, &rel, at_ms - ECHO_SLACK_MS)? {
                continue;
            }
            let event = Event {
                action,
                path: rel.clone(),
                old_path: None,
                source: Source::Outside,
                at_ms: at_ms.min(at),
            };
            apply_event(conn, &event)?;
        }
    }
    Ok(())
}

/// Log what the file dates say happened since the last look: everything
/// within the retention window on the first run, then whatever changed while
/// the app was closed. Stats only; no note is read.
fn catch_up(conn: &mut Connection, forge_root: &Path, now: i64) -> rusqlite::Result<u64> {
    let since = meta_get(conn, "scanned_ms")
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(now - RETENTION_MS);
    let notes = crate::commands::notes::list_notes_in(forge_root);
    let keep_birth = !cfg!(any(target_os = "linux", target_os = "android"));
    let tx = conn.transaction()?;
    let mut added = 0u64;
    {
        let mut covered =
            tx.prepare("SELECT EXISTS(SELECT 1 FROM events WHERE note_path = ?1 AND at_ms >= ?2)")?;
        let mut add = tx.prepare(
            "INSERT INTO events(first_ms, at_ms, action, path, old_path, note_path, source) \
             VALUES (?1, ?1, ?2, ?3, NULL, ?3, 'files')",
        )?;
        for note in notes {
            let Some(modified) = note.modified_at.map(|s| s * 1000) else {
                continue;
            };
            let created = note
                .created_at
                .filter(|_| keep_birth)
                .map(|s| s * 1000)
                .filter(|created| *created > since && *created <= now);
            if modified <= since && created.is_none() {
                continue;
            }
            let latest = created.map_or(modified, |c| c.max(modified));
            if covered.query_row(params![note.path, latest - CATCH_UP_SLACK_MS], |row| {
                row.get::<_, bool>(0)
            })? {
                continue;
            }
            if let Some(created) = created {
                add.execute(params![created, Action::Created.as_str(), note.path])?;
                added += 1;
            }
            let edited_later = created.is_none_or(|c| modified - c >= SAME_MINUTE_MS);
            if modified > since && modified <= now && edited_later {
                add.execute(params![modified, Action::Edited.as_str(), note.path])?;
                added += 1;
            }
        }
    }
    if meta_get(&tx, "first_scan_ms").is_none() {
        meta_set(&tx, "first_scan_ms", &now.to_string())?;
    }
    meta_set(&tx, "scanned_ms", &now.to_string())?;
    prune(&tx, now)?;
    tx.commit()?;
    Ok(added)
}

enum Job {
    Event(PathBuf, Event),
    Outside(PathBuf, Vec<String>, i64),
    CatchUp(PathBuf),
}

fn apply(job: Job) {
    let result = match job {
        Job::Event(root, event) => {
            let log = handle(&root);
            let inserted = log.with_conn(true, |conn| apply_event(conn, &event));
            if let Ok(true) = inserted {
                let mut count = log.inserts.lock().unwrap_or_else(|e| e.into_inner());
                *count += 1;
                if *count >= PRUNE_EVERY {
                    *count = 0;
                    let _ = log.with_conn(true, |conn| prune(conn, now_ms()));
                }
            }
            inserted.map(|_| ())
        }
        Job::Outside(root, rels, at) => {
            handle(&root).with_conn(true, |conn| apply_outside(conn, &root, &rels, at))
        }
        Job::CatchUp(root) => handle(&root)
            .with_conn(true, |conn| catch_up(conn, &root, now_ms()))
            .map(|added| {
                if added > 0 {
                    log::info!("[activity] logged {added} changes from file dates");
                }
            }),
    };
    if let Err(error) = result {
        log::warn!("[activity] update failed: {error}");
    }
}

static WORKER: OnceLock<Option<Sender<Job>>> = OnceLock::new();

/// One background thread writes, so a save only pays for a channel send.
/// Tests apply in place so each assertion sees its write.
fn enqueue(job: Job) {
    if cfg!(test) {
        apply(job);
        return;
    }
    let sender = WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel::<Job>();
        match std::thread::Builder::new()
            .name("activity-log".into())
            .spawn(move || {
                while let Ok(job) = rx.recv() {
                    apply(job);
                }
            }) {
            Ok(_) => Some(tx),
            Err(error) => {
                log::warn!("[activity] worker thread failed to start: {error}");
                None
            }
        }
    });
    if let Some(tx) = sender {
        let _ = tx.send(job);
    }
}

type QuietKey = (PathBuf, String);
static QUIET: OnceLock<Mutex<HashMap<QuietKey, Instant>>> = OnceLock::new();

fn quiet_map() -> std::sync::MutexGuard<'static, HashMap<QuietKey, Instant>> {
    QUIET
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Keep the watcher from logging what this process just did to `rel`.
pub(crate) fn quiet_in(forge_root: &Path, rel: &str) {
    let mut map = quiet_map();
    map.retain(|_, at| at.elapsed() < ECHO_QUIET);
    map.insert(
        (forge_root.to_path_buf(), plain(rel).to_string()),
        Instant::now(),
    );
}

fn is_quiet(forge_root: &Path, rel: &str) -> bool {
    quiet_map()
        .get(&(forge_root.to_path_buf(), rel.to_string()))
        .is_some_and(|at| at.elapsed() < ECHO_QUIET)
}

fn plain(rel: &str) -> &str {
    rel.strip_suffix(".locked").unwrap_or(rel)
}

fn loggable(rel: &str) -> bool {
    crate::semantic::is_valid_note_index_path(rel) && rel.ends_with(".md")
}

pub(crate) fn record_in(
    forge_root: &Path,
    action: Action,
    rel: &str,
    old_rel: Option<&str>,
    source: Source,
) {
    let rel = plain(rel);
    let old_rel = old_rel.map(plain);
    if !loggable(rel) || old_rel.is_some_and(|old| !loggable(old)) {
        return;
    }
    if source != Source::Outside {
        quiet_in(forge_root, rel);
        if let Some(old) = old_rel {
            quiet_in(forge_root, old);
        }
    }
    enqueue(Job::Event(
        forge_root.to_path_buf(),
        Event {
            action,
            path: rel.to_string(),
            old_path: old_rel.map(str::to_string),
            source,
            at_ms: now_ms(),
        },
    ));
}

/// The app did `action` to the note at Forge-relative `rel`.
pub(crate) fn record(action: Action, rel: &str) {
    if let Ok(root) = crate::paths::get_notes_dir() {
        record_in(&root, action, rel, None, Source::App);
    }
}

/// The app renamed or moved a note; which one follows from the paths.
pub(crate) fn record_move(old_rel: &str, new_rel: &str) {
    if let Ok(root) = crate::paths::get_notes_dir() {
        record_move_in(&root, old_rel, new_rel);
    }
}

pub(crate) fn record_move_in(forge_root: &Path, old_rel: &str, new_rel: &str) {
    record_in(
        forge_root,
        move_kind(old_rel, new_rel),
        new_rel,
        Some(old_rel),
        Source::App,
    );
}

/// What the watcher saw in one debounced batch, minus this process's echoes.
pub(crate) fn outside_changes_in(forge_root: &Path, rels: Vec<String>) {
    let mut seen = HashSet::new();
    let rels: Vec<String> = rels
        .iter()
        .map(|rel| plain(rel).to_string())
        .filter(|rel| loggable(rel) && seen.insert(rel.clone()))
        .filter(|rel| !is_quiet(forge_root, rel))
        .collect();
    if rels.is_empty() {
        return;
    }
    enqueue(Job::Outside(forge_root.to_path_buf(), rels, now_ms()));
}

/// Seed or catch up the Forge's log from file dates, on the writer thread.
pub(crate) fn spawn_catch_up(forge_root: PathBuf) {
    enqueue(Job::CatchUp(forge_root));
}

/// Newest first, from rows before `before` (the `(at_ms, id)` of the last row
/// already shown, or a day's end with id 0) and at or after `since_ms`.
pub(crate) fn page(
    forge_root: &Path,
    before: Option<(i64, i64)>,
    since_ms: Option<i64>,
    limit: u32,
) -> ActivityPage {
    let limit = limit.clamp(1, 500) as i64;
    let result = handle(forge_root).with_conn(false, |conn| {
        let recording_since_ms =
            meta_get(conn, "first_scan_ms").and_then(|value| value.parse::<i64>().ok());
        let (before_at, before_id) = before.map_or((None, None), |(at, id)| (Some(at), Some(id)));
        let mut statement = conn.prepare(
            "SELECT id, first_ms, at_ms, action, path, old_path, note_path, source FROM events \
             WHERE (?1 IS NULL OR at_ms < ?1 OR (at_ms = ?1 AND id < ?2)) \
             AND (?4 IS NULL OR at_ms >= ?4) \
             ORDER BY at_ms DESC, id DESC LIMIT ?3",
        )?;
        let mut entries = statement
            .query_map(params![before_at, before_id, limit + 1, since_ms], |row| {
                Ok(ActivityEntry {
                    id: row.get(0)?,
                    first_ms: row.get(1)?,
                    at_ms: row.get(2)?,
                    action: row.get(3)?,
                    path: row.get(4)?,
                    old_path: row.get(5)?,
                    note_path: row.get(6)?,
                    source: row.get(7)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let has_more = entries.len() as i64 > limit;
        entries.truncate(limit as usize);
        Ok(ActivityPage {
            entries,
            has_more,
            recording_since_ms,
        })
    });
    result.unwrap_or(ActivityPage {
        entries: Vec::new(),
        has_more: false,
        recording_since_ms: None,
    })
}

/// How many rows fall in each span between consecutive `bounds` (ascending
/// instants, so a week of local days is eight), and whether any row is older
/// than the first. One indexed range count per span.
pub(crate) fn counts(forge_root: &Path, bounds: &[i64]) -> ActivityCounts {
    let result = handle(forge_root).with_conn(false, |conn| {
        let mut statement =
            conn.prepare("SELECT count(*) FROM events WHERE at_ms >= ?1 AND at_ms < ?2")?;
        let counts = bounds
            .windows(2)
            .map(|span| statement.query_row(params![span[0], span[1]], |row| row.get(0)))
            .collect::<rusqlite::Result<Vec<i64>>>()?;
        let has_earlier = match bounds.first() {
            Some(first) => conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM events WHERE at_ms < ?1)",
                [first],
                |row| row.get(0),
            )?,
            None => false,
        };
        Ok(ActivityCounts {
            counts,
            has_earlier,
            recording_since_ms: meta_get(conn, "first_scan_ms")
                .and_then(|value| value.parse::<i64>().ok()),
        })
    });
    result.unwrap_or(ActivityCounts {
        counts: vec![0; bounds.len().saturating_sub(1)],
        has_earlier: false,
        recording_since_ms: None,
    })
}

/// Remove a Forge's log. Must run before the Forge directory goes, while its
/// path still canonicalizes to the id the log is filed under.
pub(crate) fn delete_for(forge_root: &Path) {
    let dir = log_dir(forge_root);
    forget_handle(&dir);
    if let Err(error) = fs::remove_dir_all(&dir) {
        if error.kind() != std::io::ErrorKind::NotFound {
            log::warn!("[activity] could not remove {dir:?}: {error}");
        }
    }
}

/// Close a Forge's log before the Forge is renamed. Returns where it is filed,
/// for [`reattach`] once the new path exists.
pub(crate) fn detach(forge_root: &Path) -> PathBuf {
    let dir = log_dir(forge_root);
    forget_handle(&dir);
    dir
}

/// File a detached log under the Forge's new path.
pub(crate) fn reattach(old_dir: PathBuf, new_root: &Path) {
    let new_dir = log_dir(new_root);
    if old_dir == new_dir || !old_dir.exists() {
        return;
    }
    let _ = fs::remove_dir_all(&new_dir);
    if let Err(error) = fs::rename(&old_dir, &new_dir) {
        log::warn!("[activity] could not move the log to {new_dir:?}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempForge(PathBuf);

    impl TempForge {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-activity-{tag}-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            for sub in ["notes/Projects", "notes/Archive", "daily", "weekly"] {
                fs::create_dir_all(base.join(sub)).unwrap();
            }
            Self(base)
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn write(&self, rel: &str, body: &str) {
            fs::write(self.0.join(rel), body).unwrap();
        }
    }

    impl Drop for TempForge {
        fn drop(&mut self) {
            delete_for(&self.0);
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Noon today, so a test's offsets never cross a local midnight.
    fn noon() -> i64 {
        let today = Local::now().date_naive();
        Local
            .from_local_datetime(&today.and_hms_opt(12, 0, 0).unwrap())
            .earliest()
            .unwrap()
            .timestamp_millis()
    }

    const MIN: i64 = 60 * 1000;

    fn event_at(
        forge: &TempForge,
        action: Action,
        rel: &str,
        old: Option<&str>,
        source: Source,
        at: i64,
    ) {
        let event = Event {
            action,
            path: rel.to_string(),
            old_path: old.map(str::to_string),
            source,
            at_ms: at,
        };
        handle(forge.path())
            .with_conn(true, |conn| apply_event(conn, &event))
            .unwrap();
    }

    fn rows(forge: &TempForge) -> Vec<ActivityEntry> {
        page(forge.path(), None, None, 500).entries
    }

    fn summary(forge: &TempForge) -> Vec<(String, String, Option<String>)> {
        rows(forge)
            .into_iter()
            .map(|row| (row.action, row.path, row.old_path))
            .collect()
    }

    #[test]
    fn appends_newest_first_and_pages_by_time_and_id() {
        let forge = TempForge::new("page");
        let t = noon();
        for i in 0..5 {
            event_at(
                &forge,
                Action::Created,
                &format!("notes/n{i}.md"),
                None,
                Source::App,
                t + i * MIN,
            );
        }
        let first = page(forge.path(), None, None, 2);
        assert!(first.has_more);
        assert_eq!(
            first
                .entries
                .iter()
                .map(|e| e.path.as_str())
                .collect::<Vec<_>>(),
            ["notes/n4.md", "notes/n3.md"]
        );
        let last = first.entries.last().unwrap();
        let second = page(forge.path(), Some((last.at_ms, last.id)), None, 10);
        assert!(!second.has_more);
        assert_eq!(
            second
                .entries
                .iter()
                .map(|e| e.path.as_str())
                .collect::<Vec<_>>(),
            ["notes/n2.md", "notes/n1.md", "notes/n0.md"]
        );
    }

    #[test]
    fn counts_rows_per_day_and_pages_within_one_day() {
        let forge = TempForge::new("days");
        let t = noon();
        let day = 24 * 60 * MIN;
        for i in 0..3 {
            event_at(
                &forge,
                Action::Created,
                &format!("notes/today{i}.md"),
                None,
                Source::App,
                t + i * MIN,
            );
        }
        event_at(
            &forge,
            Action::Created,
            "notes/yesterday.md",
            None,
            Source::App,
            t - day,
        );
        event_at(
            &forge,
            Action::Created,
            "notes/old.md",
            None,
            Source::App,
            t - 10 * day,
        );
        let start = t - 12 * 60 * MIN;
        let bounds = [start - day, start, start + day];
        let counted = counts(forge.path(), &bounds);
        assert_eq!(counted.counts, vec![1, 3]);
        assert!(counted.has_earlier);

        let first = page(forge.path(), Some((start + day, 0)), Some(start), 2);
        assert!(first.has_more);
        assert_eq!(first.entries.len(), 2);
        let last = first.entries.last().unwrap();
        let rest = page(forge.path(), Some((last.at_ms, last.id)), Some(start), 10);
        assert_eq!(
            rest.entries
                .iter()
                .map(|e| e.path.as_str())
                .collect::<Vec<_>>(),
            ["notes/today0.md"]
        );
        assert!(!rest.has_more);
    }

    #[test]
    fn autosave_edits_coalesce_into_one_row_per_window() {
        let forge = TempForge::new("coalesce");
        let t = noon();
        let rel = "notes/Projects/plan.md";
        for step in 0..200 {
            event_at(
                &forge,
                Action::Edited,
                rel,
                None,
                Source::App,
                t + step * 300,
            );
        }
        let all = rows(&forge);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].first_ms, t);
        // The row's time trails the last save by less than the throttle.
        assert!(t + 199 * 300 - all[0].at_ms < TOUCH_THROTTLE_MS);

        event_at(&forge, Action::Edited, rel, None, Source::App, t + 31 * MIN);
        assert_eq!(rows(&forge).len(), 2);
    }

    #[test]
    fn edits_after_a_create_extend_it_and_an_agent_echo_merges() {
        let forge = TempForge::new("create-edit");
        let t = noon();
        event_at(
            &forge,
            Action::Created,
            "daily/2026-10-06.md",
            None,
            Source::Agent,
            t,
        );
        event_at(
            &forge,
            Action::Created,
            "daily/2026-10-06.md",
            None,
            Source::Outside,
            t + 500,
        );
        event_at(
            &forge,
            Action::Edited,
            "daily/2026-10-06.md",
            None,
            Source::App,
            t + 5 * MIN,
        );
        let all = rows(&forge);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].action, "created");
        assert_eq!(all[0].source, "agent");
        assert_eq!(all[0].at_ms, t + 5 * MIN);
    }

    #[test]
    fn rename_and_move_record_old_and_new_and_rows_follow_the_note() {
        let forge = TempForge::new("rename");
        let t = noon();
        event_at(
            &forge,
            Action::Edited,
            "notes/a.md",
            None,
            Source::Files,
            t - 60 * MIN,
        );
        event_at(
            &forge,
            Action::Renamed,
            "notes/b.md",
            Some("notes/a.md"),
            Source::App,
            t,
        );
        event_at(
            &forge,
            Action::Moved,
            "notes/Archive/b.md",
            Some("notes/b.md"),
            Source::App,
            t + 40 * MIN,
        );
        assert_eq!(
            summary(&forge),
            vec![
                (
                    "moved".into(),
                    "notes/Archive/b.md".into(),
                    Some("notes/b.md".into())
                ),
                (
                    "renamed".into(),
                    "notes/b.md".into(),
                    Some("notes/a.md".into())
                ),
                ("edited".into(), "notes/a.md".into(), None),
            ]
        );
        assert!(rows(&forge)
            .iter()
            .all(|row| row.note_path == "notes/Archive/b.md"));
    }

    #[test]
    fn a_fresh_note_renamed_keeps_one_created_row_and_a_rename_back_cancels() {
        let forge = TempForge::new("fresh-rename");
        let t = noon();
        event_at(
            &forge,
            Action::Created,
            "notes/Untitled.md",
            None,
            Source::App,
            t,
        );
        event_at(
            &forge,
            Action::Renamed,
            "notes/Ideas.md",
            Some("notes/Untitled.md"),
            Source::App,
            t + 10_000,
        );
        assert_eq!(
            summary(&forge),
            vec![("created".into(), "notes/Ideas.md".into(), None)]
        );

        event_at(
            &forge,
            Action::Edited,
            "notes/Old.md",
            None,
            Source::Files,
            t - 120 * MIN,
        );
        event_at(
            &forge,
            Action::Renamed,
            "notes/New.md",
            Some("notes/Old.md"),
            Source::App,
            t,
        );
        event_at(
            &forge,
            Action::Renamed,
            "notes/Newer.md",
            Some("notes/New.md"),
            Source::App,
            t + MIN,
        );
        assert_eq!(rows(&forge)[0].path, "notes/Newer.md");
        assert_eq!(rows(&forge)[0].old_path.as_deref(), Some("notes/Old.md"));
        event_at(
            &forge,
            Action::Renamed,
            "notes/Old.md",
            Some("notes/Newer.md"),
            Source::App,
            t + 2 * MIN,
        );
        assert!(rows(&forge).iter().all(|row| row.action != "renamed"));
    }

    #[test]
    fn trash_lock_and_restore_are_logged_once() {
        let forge = TempForge::new("trash");
        let t = noon();
        event_at(
            &forge,
            Action::Edited,
            "notes/x.md",
            None,
            Source::Files,
            t - 300 * MIN,
        );
        event_at(&forge, Action::Locked, "notes/x.md", None, Source::App, t);
        event_at(
            &forge,
            Action::Locked,
            "notes/x.md",
            None,
            Source::App,
            t + 1000,
        );
        event_at(
            &forge,
            Action::Unlocked,
            "notes/x.md",
            None,
            Source::App,
            t + 2 * MIN,
        );
        event_at(
            &forge,
            Action::Trashed,
            "notes/x.md",
            None,
            Source::App,
            t + 3 * MIN,
        );
        event_at(
            &forge,
            Action::Deleted,
            "notes/x.md",
            None,
            Source::Outside,
            t + 3 * MIN + 500,
        );
        event_at(
            &forge,
            Action::Restored,
            "notes/x.md",
            None,
            Source::App,
            t + 4 * MIN,
        );
        let actions: Vec<String> = rows(&forge).into_iter().map(|row| row.action).collect();
        assert_eq!(
            actions,
            ["restored", "trashed", "unlocked", "locked", "edited"]
        );
    }

    #[test]
    fn a_new_note_discarded_inside_the_window_leaves_no_rows() {
        let forge = TempForge::new("discard");
        let t = noon();
        event_at(
            &forge,
            Action::Created,
            "daily/2026-10-06.md",
            None,
            Source::App,
            t,
        );
        event_at(
            &forge,
            Action::Edited,
            "daily/2026-10-06.md",
            None,
            Source::App,
            t + 20_000,
        );
        event_at(
            &forge,
            Action::Deleted,
            "daily/2026-10-06.md",
            None,
            Source::App,
            t + 40_000,
        );
        assert!(rows(&forge).is_empty());
    }

    #[test]
    fn a_new_note_at_a_deleted_path_does_not_inherit_the_old_rows() {
        let forge = TempForge::new("reuse");
        let t = noon();
        event_at(
            &forge,
            Action::Edited,
            "notes/a.md",
            None,
            Source::Files,
            t - 200 * MIN,
        );
        event_at(
            &forge,
            Action::Trashed,
            "notes/a.md",
            None,
            Source::App,
            t - 100 * MIN,
        );
        event_at(
            &forge,
            Action::Created,
            "notes/a.md",
            None,
            Source::App,
            t - 90 * MIN,
        );
        event_at(
            &forge,
            Action::Renamed,
            "notes/b.md",
            Some("notes/a.md"),
            Source::App,
            t,
        );
        let notes: Vec<(String, String)> = rows(&forge)
            .into_iter()
            .map(|row| (row.action, row.note_path))
            .collect();
        assert_eq!(
            notes,
            vec![
                ("renamed".into(), "notes/b.md".into()),
                ("created".into(), "notes/b.md".into()),
                ("trashed".into(), "notes/a.md".into()),
                ("edited".into(), "notes/a.md".into()),
            ]
        );
    }

    #[test]
    fn prune_drops_rows_past_retention_and_over_the_cap() {
        let forge = TempForge::new("prune");
        let now = noon();
        event_at(
            &forge,
            Action::Created,
            "notes/old.md",
            None,
            Source::App,
            now - RETENTION_MS - MIN,
        );
        event_at(
            &forge,
            Action::Created,
            "notes/new.md",
            None,
            Source::App,
            now - MIN,
        );
        handle(forge.path())
            .with_conn(true, |conn| prune(conn, now))
            .unwrap();
        assert_eq!(
            summary(&forge),
            vec![("created".into(), "notes/new.md".into(), None)]
        );

        handle(forge.path())
            .with_conn(true, |conn| {
                let tx = conn.transaction()?;
                for i in 0..(MAX_ROWS + 10) {
                    tx.execute(
                        "INSERT INTO events(first_ms, at_ms, action, path, note_path, source) \
                         VALUES (?1, ?1, 'edited', 'notes/n.md', 'notes/n.md', 'app')",
                        [now - 100 * MIN + i],
                    )?;
                }
                tx.commit()?;
                prune(conn, now)?;
                let count: i64 = conn.query_row("SELECT count(*) FROM events", [], |r| r.get(0))?;
                assert_eq!(count, MAX_ROWS);
                let newest: String = conn.query_row(
                    "SELECT path FROM events ORDER BY at_ms DESC LIMIT 1",
                    [],
                    |r| r.get(0),
                )?;
                assert_eq!(newest, "notes/new.md");
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn first_run_seeds_from_file_dates_and_marks_them() {
        let forge = TempForge::new("seed");
        forge.write("notes/Projects/plan.md", "secret plan body");
        forge.write("daily/2026-10-01.md", "daily body");
        forge.write("notes/vault.md.locked", "ciphertext");
        let now = now_ms() + MIN;
        let added = handle(forge.path())
            .with_conn(true, |conn| catch_up(conn, forge.path(), now))
            .unwrap();
        assert!(added >= 3);
        let all = rows(&forge);
        assert!(all.iter().all(|row| row.source == "files"));
        let paths: HashSet<String> = all.iter().map(|row| row.path.clone()).collect();
        assert!(paths.contains("notes/Projects/plan.md"));
        assert!(paths.contains("daily/2026-10-01.md"));
        assert!(paths.contains("notes/vault.md"));
        assert!(page(forge.path(), None, None, 10)
            .recording_since_ms
            .is_some());

        let again = handle(forge.path())
            .with_conn(true, |conn| catch_up(conn, forge.path(), now + MIN))
            .unwrap();
        assert_eq!(again, 0);
    }

    #[test]
    fn catch_up_adds_only_changes_no_row_covers() {
        let forge = TempForge::new("catch-up");
        forge.write("notes/a.md", "a");
        forge.write("notes/b.md", "b");
        let first = now_ms() - 10 * MIN;
        handle(forge.path())
            .with_conn(true, |conn| {
                meta_set(conn, "first_scan_ms", &first.to_string())?;
                meta_set(conn, "scanned_ms", &first.to_string())
            })
            .unwrap();
        record_in(
            forge.path(),
            Action::Edited,
            "notes/a.md",
            None,
            Source::App,
        );
        handle(forge.path())
            .with_conn(true, |conn| catch_up(conn, forge.path(), now_ms() + 1000))
            .unwrap();
        let all = rows(&forge);
        let for_a: Vec<_> = all.iter().filter(|row| row.path == "notes/a.md").collect();
        let for_b: Vec<_> = all.iter().filter(|row| row.path == "notes/b.md").collect();
        assert_eq!(for_a.len(), 1);
        assert_eq!(for_a[0].source, "app");
        assert!(!for_b.is_empty());
        assert!(for_b.iter().all(|row| row.source == "files"));
    }

    #[test]
    fn the_database_never_holds_note_content() {
        let forge = TempForge::new("content");
        forge.write("notes/Projects/plan.md", "TOP-SECRET-BODY-TEXT");
        handle(forge.path())
            .with_conn(true, |conn| catch_up(conn, forge.path(), now_ms() + MIN))
            .unwrap();
        record_in(
            forge.path(),
            Action::Edited,
            "notes/Projects/plan.md",
            None,
            Source::App,
        );
        record_in(
            forge.path(),
            Action::Locked,
            "notes/Projects/plan.md",
            None,
            Source::App,
        );
        forget_handle(&log_dir(forge.path()));
        let dir = log_dir(forge.path());
        let mut bytes = Vec::new();
        for entry in fs::read_dir(&dir).unwrap().flatten() {
            bytes.extend(fs::read(entry.path()).unwrap());
        }
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("notes/Projects/plan.md"));
        assert!(!text.contains("TOP-SECRET-BODY-TEXT"));
    }

    #[test]
    fn each_forge_has_its_own_log_and_deleting_the_forge_deletes_it() {
        let one = TempForge::new("iso-one");
        let two = TempForge::new("iso-two");
        record_in(
            one.path(),
            Action::Created,
            "notes/one.md",
            None,
            Source::App,
        );
        record_in(
            two.path(),
            Action::Created,
            "notes/two.md",
            None,
            Source::App,
        );
        assert_eq!(
            summary(&one),
            vec![("created".into(), "notes/one.md".into(), None)]
        );
        assert_eq!(
            summary(&two),
            vec![("created".into(), "notes/two.md".into(), None)]
        );

        let dir = log_dir(one.path());
        assert!(dir.join(LOG_FILE).exists());
        delete_for(one.path());
        assert!(!dir.exists());
        assert!(rows(&one).is_empty());
        assert_eq!(rows(&two).len(), 1);
    }

    #[test]
    fn a_renamed_forge_keeps_its_log() {
        let forge = TempForge::new("forge-rename");
        record_in(
            forge.path(),
            Action::Created,
            "notes/kept.md",
            None,
            Source::App,
        );
        let renamed = forge.path().with_extension("renamed");
        let detached = detach(forge.path());
        fs::rename(forge.path(), &renamed).unwrap();
        reattach(detached, &renamed);
        assert_eq!(
            page(&renamed, None, None, 10).entries[0].path,
            "notes/kept.md"
        );
        delete_for(&renamed);
        let _ = fs::remove_dir_all(&renamed);
    }

    #[test]
    fn rejects_paths_outside_the_note_folders() {
        let forge = TempForge::new("paths");
        record_in(
            forge.path(),
            Action::Created,
            "../escape.md",
            None,
            Source::App,
        );
        record_in(
            forge.path(),
            Action::Created,
            ".trash/x.md",
            None,
            Source::App,
        );
        record_in(
            forge.path(),
            Action::Created,
            "notes/image.png",
            None,
            Source::App,
        );
        assert!(rows(&forge).is_empty());
    }

    #[test]
    fn the_watcher_skips_this_processes_echoes_and_logs_outside_changes() {
        let forge = TempForge::new("watcher");
        forge.write("notes/mine.md", "x");
        forge.write("notes/theirs.md", "y");
        record_in(
            forge.path(),
            Action::Edited,
            "notes/mine.md",
            None,
            Source::App,
        );
        outside_changes_in(
            forge.path(),
            vec!["notes/mine.md".into(), "notes/theirs.md".into()],
        );
        let all = rows(&forge);
        assert_eq!(all.iter().filter(|r| r.path == "notes/mine.md").count(), 1);
        let theirs: Vec<_> = all.iter().filter(|r| r.path == "notes/theirs.md").collect();
        assert_eq!(theirs.len(), 1);
        assert_eq!(theirs[0].source, "outside");
    }

    #[test]
    fn the_watcher_logs_an_outside_delete_and_a_locked_file_as_present() {
        let forge = TempForge::new("watcher-delete");
        forge.write("notes/locked.md.locked", "ciphertext");
        outside_changes_in(
            forge.path(),
            vec!["notes/gone.md".into(), "notes/locked.md.locked".into()],
        );
        let all = summary(&forge);
        assert!(all.contains(&("deleted".into(), "notes/gone.md".into(), None)));
        assert!(all
            .iter()
            .any(|(action, path, _)| path == "notes/locked.md" && action != "deleted"));
    }

    #[test]
    fn the_watcher_dates_an_edit_by_the_files_modified_time() {
        let forge = TempForge::new("watcher-time");
        forge.write("notes/late.md", "x");
        let saved = now_ms() + 5 * MIN;
        fs::File::options()
            .write(true)
            .open(forge.path().join("notes/late.md"))
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_millis(saved as u64))
            .unwrap();
        let at = saved + 30 * 1000;
        handle(forge.path())
            .with_conn(true, |conn| {
                apply_outside(conn, forge.path(), &["notes/late.md".to_string()], at)
            })
            .unwrap();
        let all = rows(&forge);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].at_ms, saved);
    }

    #[test]
    fn a_late_echo_of_the_apps_own_lock_is_not_logged_again() {
        let forge = TempForge::new("late-echo");
        forge.write("notes/vault.md.locked", "ciphertext");
        let (_, modified) = file_times(forge.path(), "notes/vault.md").unwrap();
        let at = modified + 30 * 1000;
        event_at(
            &forge,
            Action::Locked,
            "notes/vault.md",
            None,
            Source::App,
            modified + 5,
        );
        handle(forge.path())
            .with_conn(true, |conn| {
                apply_outside(conn, forge.path(), &["notes/vault.md".to_string()], at)
            })
            .unwrap();
        assert_eq!(
            summary(&forge),
            vec![("locked".into(), "notes/vault.md".into(), None)]
        );
    }

    #[test]
    fn the_watcher_ignores_a_note_whose_contents_did_not_change() {
        let forge = TempForge::new("watcher-chmod");
        forge.write("notes/old.md", "x");
        let at = now_ms() + 10 * FRESH_FILE_MS;
        handle(forge.path())
            .with_conn(true, |conn| {
                apply_outside(conn, forge.path(), &["notes/old.md".to_string()], at)
            })
            .unwrap();
        assert!(rows(&forge).is_empty());
    }

    #[test]
    fn the_watcher_pairs_one_disappearance_with_one_unfamiliar_note_as_a_move() {
        let forge = TempForge::new("watcher-move");
        event_at(
            &forge,
            Action::Edited,
            "notes/a.md",
            None,
            Source::Files,
            noon() - 300 * MIN,
        );
        forge.write("notes/Archive/a.md", "moved by Finder");
        let at = now_ms() + 10 * FRESH_FILE_MS;
        handle(forge.path())
            .with_conn(true, |conn| {
                apply_outside(
                    conn,
                    forge.path(),
                    &["notes/a.md".to_string(), "notes/Archive/a.md".to_string()],
                    at,
                )
            })
            .unwrap();
        assert_eq!(
            summary(&forge)[0],
            (
                "moved".into(),
                "notes/Archive/a.md".into(),
                Some("notes/a.md".into())
            )
        );
    }

    #[test]
    fn mcp_writes_land_in_the_forge_they_name() {
        let forge = TempForge::new("mcp");
        record_in(
            forge.path(),
            Action::Created,
            "notes/from-agent.md",
            None,
            Source::Agent,
        );
        let all = rows(&forge);
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].source, "agent");
    }
}
