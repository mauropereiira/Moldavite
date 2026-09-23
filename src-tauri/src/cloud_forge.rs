//! Optional iCloud storage, separate from the device's local Forge root.
//!
//! The metadata snapshot (`ITEMS`) is the only record of notes whose contents are
//! still in iCloud: their names are listed and reserved, reads of them answer
//! `NOT_DOWNLOADED` before any path check that would need the missing folder, and
//! nothing reads or writes their bytes until `download` has been asked for them.
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::{Emitter, Manager};

#[cfg(not(target_os = "ios"))]
#[path = "../plugins/tauri-plugin-icloud/src/models.rs"]
mod models;
#[cfg(any(target_os = "macos", target_os = "ios", test))]
use models::{ChangeKind, CloudChange};
use models::{CloudItem, DownloadState};
#[cfg(target_os = "ios")]
use tauri_plugin_icloud::models;

#[cfg(target_os = "macos")]
use crate::file_coordination as native;
#[cfg(target_os = "ios")]
use tauri_plugin_icloud::coordination as native;

pub(crate) const FORGE_ID: &str = "icloud://moldavite";
/// The frontend recognises this exact text (`NOT_DOWNLOADED_MESSAGE` in
/// `src/lib/cloudNotes.ts`), and the native layer returns it too.
pub(crate) const NOT_DOWNLOADED: &str =
    "This note is in iCloud and hasn't downloaded to this device yet.";
static APP: OnceLock<AppHandle> = OnceLock::new();
static ITEMS: Mutex<BTreeMap<String, CloudItem>> = Mutex::new(BTreeMap::new());

/// Whether the last connection attempt produced a readable root. A failed
/// attempt leaves the native query running, so its first pass can still arrive.
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
enum Readiness {
    Connecting,
    Ready,
    Failed(String),
}
static READINESS: Mutex<Readiness> = Mutex::new(Readiness::Connecting);

pub(crate) fn initialize(app: AppHandle) {
    let _ = APP.set(app);
}

pub(crate) fn root() -> Result<PathBuf, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        native::cloud_root()
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    Err("The iCloud Forge is available on Apple devices only".to_string())
}

/// The config's `active_synced_forge`, cached: name checks and scans ask on every
/// file. 0 is unknown, then 1 (local Forge) or 2 (synced). `write_config` updates it.
static ACTIVE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

pub(crate) fn remember_active(synced: bool) {
    ACTIVE.store(
        if synced { 2 } else { 1 },
        std::sync::atomic::Ordering::Relaxed,
    );
}

fn is_active() -> bool {
    match ACTIVE.load(std::sync::atomic::Ordering::Relaxed) {
        0 => {
            let synced = crate::persist::read_config().active_synced_forge;
            remember_active(synced);
            synced
        }
        state => state == 2,
    }
}

/// `ready`, `preparing` or `unavailable` (with the reason) for the synced Forge.
pub(crate) fn readiness() -> (&'static str, Option<String>) {
    if root().is_ok() {
        return ("ready", None);
    }
    match &*READINESS
        .lock()
        .unwrap_or_else(|poison| poison.into_inner())
    {
        Readiness::Failed(message) => ("unavailable", Some(message.clone())),
        _ => ("preparing", None),
    }
}

/// Mark the root ready. Returns true when this ends a failed connection, so
/// the caller announces a root nothing else is going to announce.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn become_ready() -> bool {
    let mut readiness = READINESS
        .lock()
        .unwrap_or_else(|poison| poison.into_inner());
    let late = matches!(*readiness, Readiness::Failed(_));
    *readiness = Readiness::Ready;
    late
}

/// Refresh the Forge the startup connection could not, and tell the frontend.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn announce_late_ready(app: &AppHandle) {
    if !is_active() {
        return;
    }
    let (Ok(root), Some(recent), Some(index)) = (
        root(),
        app.try_state::<std::sync::Arc<crate::forge_watcher::RecentWrites>>(),
        app.try_state::<std::sync::Arc<crate::backlinks_index::BacklinksIndex>>(),
    ) else {
        return;
    };
    let (app, recent, index) = (app.clone(), recent.inner().clone(), index.inner().clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::commands::forges::refresh_active_forge(&app, recent, index, root);
        let _ = app.emit("icloud:ready", ());
    });
}

/// Metadata sends every item on every update, including upload progress. Only
/// these reach the frontend, which reloads the note list and reads notes on them.
#[cfg(any(target_os = "macos", target_os = "ios", test))]
#[derive(Debug, Default, PartialEq)]
struct ChangeEffects {
    /// A name was added or removed, or a note's contents arrived or left.
    refresh_list: bool,
    /// Paths whose local contents may differ from what the frontend last read.
    modified: Vec<String>,
    /// Download progress for items whose local-ness or error changed.
    updates: Vec<ItemUpdate>,
    /// Notes with unresolved iCloud conflict versions.
    conflicts: Vec<String>,
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ItemUpdate {
    path: String,
    downloaded: bool,
    error: Option<String>,
}

fn state_is_local(state: DownloadState) -> bool {
    matches!(
        state,
        DownloadState::Local | DownloadState::Current | DownloadState::Downloaded
    )
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
fn is_note_item(path: &str) -> bool {
    let Some((category, relative)) = path.split_once('/') else {
        return false;
    };
    matches!(category, "notes" | "daily" | "weekly")
        && relative.ends_with(".md")
        && crate::validation::is_safe_existing_note_path(relative)
}

#[cfg(any(target_os = "macos", target_os = "ios", test))]
fn apply_change(items: &mut BTreeMap<String, CloudItem>, change: &CloudChange) -> ChangeEffects {
    let mut effects = ChangeEffects::default();
    let conflicted =
        |item: &CloudItem| item.has_conflicts && !item.is_directory && is_note_item(&item.path);
    match change.kind {
        ChangeKind::Initial => {
            items.clear();
            for item in &change.items {
                items.insert(item.path.clone(), item.clone());
            }
            effects.refresh_list = true;
            effects.conflicts = items
                .values()
                .filter(|item| conflicted(item))
                .map(|item| item.path.clone())
                .collect();
        }
        ChangeKind::AccountChanged => effects.refresh_list = true,
        ChangeKind::Changed => {
            for item in &change.items {
                let Some(previous) = items.insert(item.path.clone(), item.clone()) else {
                    effects.refresh_list = true;
                    if conflicted(item) {
                        effects.conflicts.push(item.path.clone());
                    }
                    continue;
                };
                let was_local = state_is_local(previous.download_state);
                let is_local = state_is_local(item.download_state);
                let update = ItemUpdate {
                    path: item.path.clone(),
                    downloaded: is_local,
                    error: item.error.clone(),
                };
                // The content date can move before the new bytes land, so the end
                // of a download (a state change, or is_downloading clearing) also
                // asks for a read. iOS has no file watcher to do it instead.
                let contents_may_differ = (item.modified.is_some()
                    && previous.modified != item.modified)
                    || previous.download_state != item.download_state
                    || (previous.is_downloading && !item.is_downloading);
                if was_local != is_local {
                    effects.refresh_list = true;
                    if is_local {
                        effects.modified.push(item.path.clone());
                    }
                    effects.updates.push(update);
                } else if is_local && contents_may_differ {
                    effects.modified.push(item.path.clone());
                } else if !is_local && previous.error != item.error {
                    effects.updates.push(update);
                }
                // A conflicted note that had no local bytes was skipped; resolve
                // it once its contents arrive.
                if conflicted(item) && (!previous.has_conflicts || (is_local && !was_local)) {
                    effects.conflicts.push(item.path.clone());
                }
            }
            for path in &change.removed {
                if items.remove(path).is_some() {
                    effects.refresh_list = true;
                    effects.modified.push(path.clone());
                }
            }
        }
    }
    effects
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn changed(change: CloudChange) {
    let effects = match ITEMS.lock() {
        Ok(mut items) => apply_change(&mut items, &change),
        Err(_) => return,
    };
    let initial = change.kind == ChangeKind::Initial;
    if change.kind == ChangeKind::AccountChanged {
        if let Ok(mut readiness) = READINESS.lock() {
            *readiness = Readiness::Failed(
                "The iCloud account changed. Reopen the synced Forge before continuing.".into(),
            );
        }
    }
    let Some(app) = APP.get() else {
        return;
    };
    if initial && become_ready() {
        announce_late_ready(app);
    }
    if !is_active() {
        return;
    }
    if effects.refresh_list || !effects.updates.is_empty() {
        let _ = app.emit(
            "icloud:changed",
            serde_json::json!({
                "refreshList": effects.refresh_list,
                "initial": initial,
                "items": effects.updates,
            }),
        );
    }
    // Existing reconciliation protects dirty open buffers. A metadata
    // update must request a read, never synthesize an empty note body.
    for path in &effects.modified {
        if let (Ok(root), Some(recent)) = (
            root(),
            app.try_state::<std::sync::Arc<crate::forge_watcher::RecentWrites>>(),
        ) {
            if recent.matches_current_content(&root.join(path)) {
                continue;
            }
        }
        let _ = app.emit(
            "forge:changed",
            serde_json::json!({ "kind": "modified", "relPath": path }),
        );
    }
    if initial || change.kind == ChangeKind::AccountChanged {
        let _ = app.emit("forges:changed", ());
    }
    for path in effects.conflicts {
        resolve_conflicts(app, path);
    }
}

/// Save each unresolved iCloud conflict version of a note as the app's usual
/// `(conflict …)` copy beside it, then let iCloud discard those versions.
/// A locked note is left alone: its ciphertext authenticates its own path,
/// so a copy under another name could never be decrypted.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn resolve_conflicts(app: &AppHandle, rel: String) {
    static RESOLVING: Mutex<std::collections::BTreeSet<String>> =
        Mutex::new(std::collections::BTreeSet::new());
    if !RESOLVING
        .lock()
        .map(|mut resolving| resolving.insert(rel.clone()))
        .unwrap_or(false)
    {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = root().and_then(|root| {
            let path = root.join(&rel);
            if !has_local_bytes(&path) {
                return Ok(Vec::new());
            }
            native::resolve_conflicts(&path, |paths| {
                let (note, versions) = paths
                    .split_first()
                    .ok_or("The file coordinator returned no paths")?;
                crate::commands::notes::preserve_conflict_versions(note, versions)
            })
        });
        match result {
            Ok(copies) => {
                let folder = rel.rsplit_once('/').map_or("", |(folder, _)| folder);
                for (name, body) in copies {
                    if let Some(index) =
                        app.try_state::<std::sync::Arc<crate::backlinks_index::BacklinksIndex>>()
                    {
                        index.update_note(&name, &body);
                    }
                    let copy = format!("{folder}/{name}");
                    crate::search_index::note_changed(&copy);
                    crate::semantic::note_changed(&copy);
                }
            }
            Err(error) => log::warn!("[icloud] could not resolve conflicts for {rel}: {error}"),
        }
        if let Ok(mut resolving) = RESOLVING.lock() {
            resolving.remove(&rel);
        }
    });
}

#[cfg(target_os = "macos")]
extern "C" fn desktop_change(json: *const std::ffi::c_char) {
    // The native observer lends its JSON string only for this callback.
    // Never allow a Rust panic to unwind into Foundation.
    let _ = std::panic::catch_unwind(|| {
        if json.is_null() {
            return;
        }
        let bytes = unsafe { std::ffi::CStr::from_ptr(json) }.to_bytes();
        if let Ok(change) = serde_json::from_slice(bytes) {
            changed(change);
        }
    });
}

pub(crate) async fn connect(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(mut readiness) = READINESS.lock() {
        *readiness = Readiness::Connecting;
    }
    let result = match connect_native(app).await {
        // The first metadata pass can finish just after the wait gave up.
        Err(_) if root().is_ok() => root(),
        other => other,
    };
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    match &result {
        Ok(_) => {
            become_ready();
        }
        Err(error) => {
            if let Ok(mut readiness) = READINESS.lock() {
                *readiness = Readiness::Failed(error.clone());
            }
            if root().is_ok() && become_ready() {
                announce_late_ready(app);
            }
        }
    }
    result
}

async fn connect_native(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "ios")]
    {
        use tauri_plugin_icloud::ICloudExt;
        app.icloud().resolve().await?;
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        let channel = tauri::ipc::Channel::new(move |body| {
            let change: CloudChange = body.deserialize()?;
            let initial = matches!(
                change.kind,
                ChangeKind::Initial | ChangeKind::AccountChanged
            );
            changed(change);
            if initial {
                let _ = send.try_send(());
            }
            Ok(())
        });
        app.icloud().observe(channel).await?;
        tauri::async_runtime::spawn_blocking(move || {
            receive
                .recv_timeout(std::time::Duration::from_secs(15))
                .map_err(|_| {
                    "iCloud is still preparing this Forge. Try again shortly.".to_string()
                })?;
            root()
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(|| {
            crate::file_coordination::connect_cloud(desktop_change)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = app;
        Err("The iCloud Forge is available on Apple devices only".to_string())
    }
}

pub(crate) fn snapshot() -> Result<Vec<CloudItem>, String> {
    root()?;
    ITEMS
        .lock()
        .map(|items| items.values().cloned().collect())
        .map_err(|error| error.to_string())
}

/// SF_DATALESS from `<sys/stat.h>`: the file's contents are not on this device,
/// and reading it makes the system download them first.
#[cfg(any(target_os = "macos", target_os = "ios"))]
const SF_DATALESS: u32 = 0x4000_0000;

fn is_dataless(metadata: &std::fs::Metadata) -> bool {
    #[cfg(target_os = "ios")]
    use std::os::ios::fs::MetadataExt;
    #[cfg(target_os = "macos")]
    use std::os::macos::fs::MetadataExt;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return metadata.st_flags() & SF_DATALESS != 0;
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = metadata;
        false
    }
}

/// Whether the file's own bytes are on this device. A legacy `.name.icloud`
/// placeholder leaves no file at `path`, and a dataless file has none of its bytes.
pub(crate) fn has_local_bytes(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| metadata.is_file() && !is_dataless(&metadata))
        .unwrap_or(false)
}

/// A file in the synced Forge whose contents are still in iCloud. Whole-Forge
/// scans skip it so that indexing never downloads every note.
pub(crate) fn is_evicted(path: &Path) -> bool {
    std::fs::symlink_metadata(path)
        .map(|metadata| is_dataless(&metadata))
        .unwrap_or(false)
        && is_active()
}

fn relative_to(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    let parts = relative
        .components()
        .map(|component| match component {
            std::path::Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    Some(parts.join("/"))
}

/// Metadata trails the app's own deletes, renames, moves and locks. An entry
/// iCloud last saw on this device whose file is gone was changed here, so it
/// no longer holds a name. Only entries iCloud never had locally stay listed
/// without a file.
fn is_stale(root: &Path, item: &CloudItem) -> bool {
    state_is_local(item.download_state) && std::fs::symlink_metadata(root.join(&item.path)).is_err()
}

fn lookup(items: &BTreeMap<String, CloudItem>, root: &Path, path: &Path) -> Option<CloudItem> {
    items
        .get(&relative_to(root, path)?)
        .filter(|item| !is_stale(root, item))
        .cloned()
}

fn listed(path: &Path) -> Option<CloudItem> {
    #[cfg(test)]
    if let Some(found) = test_snapshot::lookup(path) {
        return found;
    }
    if !is_active() {
        return None;
    }
    let root = root().ok()?;
    lookup(&*ITEMS.lock().ok()?, &root, path)
}

/// Stand-in metadata for tests, per thread, so they never read the real config.
#[cfg(test)]
pub(crate) mod test_snapshot {
    use super::{BTreeMap, CloudItem, DownloadState, Path, PathBuf};
    use std::cell::RefCell;

    thread_local! {
        static SNAPSHOT: RefCell<Option<(PathBuf, BTreeMap<String, CloudItem>)>> =
            const { RefCell::new(None) };
    }

    pub(crate) struct Installed;

    impl Drop for Installed {
        fn drop(&mut self) {
            SNAPSHOT.with(|snapshot| *snapshot.borrow_mut() = None);
        }
    }

    /// List `remote` (paths relative to `root`) as notes not yet downloaded.
    pub(crate) fn install(root: &Path, remote: &[&str]) -> Installed {
        let items = remote
            .iter()
            .map(|path| {
                let item = CloudItem {
                    path: path.to_string(),
                    is_directory: false,
                    download_state: DownloadState::Pending,
                    is_downloading: false,
                    is_uploading: false,
                    has_conflicts: false,
                    error: None,
                    modified: None,
                };
                (path.to_string(), item)
            })
            .collect();
        SNAPSHOT.with(|snapshot| *snapshot.borrow_mut() = Some((root.to_path_buf(), items)));
        Installed
    }

    pub(super) fn lookup(path: &Path) -> Option<Option<CloudItem>> {
        SNAPSHOT.with(|snapshot| {
            snapshot
                .borrow()
                .as_ref()
                .map(|(root, items)| super::lookup(items, root, path))
        })
    }
}

/// iCloud lists this name, whether or not its contents are on this device.
pub(crate) fn is_remote_name(path: &Path) -> bool {
    listed(path).is_some()
}

/// iCloud lists this note but its contents are not on this device. Checked
/// before path validation, which needs the note's folder to exist locally.
pub(crate) fn is_remote_only(path: &Path) -> bool {
    listed(path).is_some_and(|item| !item.is_directory) && !has_local_bytes(path)
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct CloudDownload {
    pub(crate) downloaded: bool,
    pub(crate) error: Option<String>,
}

/// Ask iCloud to download a listed note. Completion arrives as a metadata update.
pub(crate) fn download(path: &Path) -> Result<CloudDownload, String> {
    let item = listed(path).ok_or("This note is not in the synced Forge")?;
    if item.is_directory {
        return Err("Only notes can be downloaded".to_string());
    }
    if has_local_bytes(path) {
        return Ok(CloudDownload {
            downloaded: true,
            error: None,
        });
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let relative = root()
            .ok()
            .and_then(|root| relative_to(&root, path))
            .ok_or("This note is not in the synced Forge")?;
        let item: CloudItem =
            serde_json::from_str(&native::start_download(&relative)?).map_err(|e| e.to_string())?;
        Ok(CloudDownload {
            downloaded: has_local_bytes(path),
            error: item.error,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    Err("The iCloud Forge is available on Apple devices only".to_string())
}

/// Add remote names to the same note list as files already on disk, and mark
/// the ones whose contents are still in iCloud.
pub(crate) fn merge_notes(notes: &mut Vec<crate::types::NoteFile>) -> Result<(), String> {
    if !is_active() {
        return Ok(());
    }
    let root = root()?;
    let items = snapshot()?
        .into_iter()
        .filter(|item| !is_stale(&root, item))
        .collect();
    merge_note_items(notes, items, |relative| {
        has_local_bytes(&root.join(relative))
    });
    Ok(())
}

fn merge_note_items(
    notes: &mut Vec<crate::types::NoteFile>,
    items: Vec<CloudItem>,
    has_local_bytes: impl Fn(&str) -> bool,
) {
    for item in items {
        let Some((category, relative)) = item.path.split_once('/') else {
            continue;
        };
        if item.is_directory
            || relative.split('/').any(|part| part.starts_with('.'))
            || !matches!(category, "notes" | "daily" | "weekly")
            || !crate::validation::is_safe_existing_note_path(relative)
            || (category != "notes" && relative.contains('/'))
        {
            continue;
        }
        let locked = relative.ends_with(".md.locked");
        let Some(relative) = (if locked {
            relative.strip_suffix(".locked")
        } else {
            Some(relative)
        })
        .filter(|relative| relative.ends_with(".md")) else {
            continue;
        };
        let path = format!("{category}/{relative}");
        let not_downloaded = !has_local_bytes(&item.path);
        if let Some(existing) = notes.iter_mut().find(|note| note.path == path) {
            existing.is_locked |= locked;
            existing.not_downloaded |= not_downloaded;
            continue;
        }
        let name = relative.rsplit('/').next().unwrap_or(relative).to_string();
        let stem = name.trim_end_matches(".md").to_string();
        notes.push(crate::types::NoteFile {
            name,
            path,
            is_daily: category == "daily",
            is_weekly: category == "weekly",
            date: (category == "daily" && crate::commands::notes::is_date_stem(&stem))
                .then_some(stem.clone()),
            week: (category == "weekly" && crate::commands::notes::is_week_stem(&stem))
                .then_some(stem),
            is_locked: locked,
            folder_path: if category == "notes" {
                relative
                    .rsplit_once('/')
                    .map(|(parent, _)| parent.to_string())
            } else {
                None
            },
            modified_at: None,
            created_at: None,
            not_downloaded,
        });
    }
}

pub(crate) fn merge_folders(folders: &mut Vec<crate::types::FolderInfo>) -> Result<(), String> {
    if !is_active() {
        return Ok(());
    }
    let root = root()?;
    let items = snapshot()?
        .into_iter()
        .filter(|item| !is_stale(&root, item))
        .collect();
    merge_folder_items(folders, items);
    Ok(())
}

fn merge_folder_items(folders: &mut Vec<crate::types::FolderInfo>, items: Vec<CloudItem>) {
    fn insert(folders: &mut Vec<crate::types::FolderInfo>, components: &[&str], parent: &str) {
        let Some((name, rest)) = components.split_first() else {
            return;
        };
        let path = if parent.is_empty() {
            name.to_string()
        } else {
            format!("{parent}/{name}")
        };
        let position = match folders.iter().position(|folder| folder.path == path) {
            Some(position) => position,
            None => {
                folders.push(crate::types::FolderInfo {
                    name: name.to_string(),
                    path: path.clone(),
                    children: Vec::new(),
                });
                folders.len() - 1
            }
        };
        insert(&mut folders[position].children, rest, &path);
        folders.sort_by_key(|folder| folder.name.to_lowercase());
    }
    for item in items {
        let Some(relative) = item.path.strip_prefix("notes/") else {
            continue;
        };
        if !crate::validation::is_safe_existing_note_path(relative)
            || relative.split('/').any(|part| part.starts_with('.'))
        {
            continue;
        }
        // File metadata includes every ancestor, including directories that
        // have not yet materialized in the local filesystem.
        let parent = if item.is_directory {
            relative
        } else {
            let Some((parent, _)) = relative.rsplit_once('/') else {
                continue;
            };
            parent
        };
        insert(folders, &parent.split('/').collect::<Vec<_>>(), "");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(path: &str, is_directory: bool) -> CloudItem {
        CloudItem {
            path: path.into(),
            is_directory,
            download_state: DownloadState::Pending,
            is_downloading: false,
            is_uploading: false,
            has_conflicts: false,
            error: None,
            modified: None,
        }
    }

    #[test]
    fn remote_notes_preserve_paths_locks_and_calendar_classification() {
        let mut notes = Vec::new();
        merge_note_items(
            &mut notes,
            vec![
                item("notes/Project/Plan.md", false),
                item("notes/Project/Plan.md.locked", false),
                item("daily/2026-09-06.md", false),
                item("daily/2026-09-06 (conflict).md", false),
                item("weekly/2026-W36.md", false),
                item("notes/Empty.md", true),
                item("notes/.hidden/Secret.md", false),
                item("notes/../outside.md", false),
                item("daily/nested/2026-09-06.md", false),
            ],
            |_| false,
        );
        assert_eq!(notes.len(), 4);
        assert_eq!(notes[0].path, "notes/Project/Plan.md");
        assert_eq!(notes[0].folder_path.as_deref(), Some("Project"));
        assert!(notes[0].is_locked);
        assert_eq!(notes[1].date.as_deref(), Some("2026-09-06"));
        assert_eq!(notes[2].date, None);
        assert_eq!(notes[3].week.as_deref(), Some("2026-W36"));
    }

    #[test]
    fn notes_without_local_bytes_are_marked_not_downloaded() {
        let listed_on_disk = |path: &str| crate::types::NoteFile {
            name: path.rsplit('/').next().unwrap().into(),
            path: path.into(),
            is_daily: path.starts_with("daily/"),
            is_weekly: false,
            date: None,
            week: None,
            is_locked: false,
            folder_path: None,
            modified_at: None,
            created_at: None,
            not_downloaded: false,
        };
        let mut notes = vec![
            listed_on_disk("notes/Dataless.md"),
            listed_on_disk("notes/Local.md"),
        ];
        merge_note_items(
            &mut notes,
            vec![
                item("notes/Dataless.md", false),
                item("notes/Local.md", false),
                item("notes/Remote/Plan.md", false),
                item("daily/2026-09-20.md", false),
            ],
            |path| path == "notes/Local.md" || path == "daily/2026-09-20.md",
        );
        let flag = |path: &str| {
            notes
                .iter()
                .find(|note| note.path == path)
                .unwrap()
                .not_downloaded
        };
        assert!(flag("notes/Dataless.md"));
        assert!(!flag("notes/Local.md"));
        assert!(flag("notes/Remote/Plan.md"));
        assert!(!flag("daily/2026-09-20.md"));
    }

    fn at(path: &str, state: DownloadState) -> CloudItem {
        CloudItem {
            download_state: state,
            ..item(path, false)
        }
    }

    fn change(kind: ChangeKind, items: Vec<CloudItem>, removed: Vec<&str>) -> CloudChange {
        CloudChange {
            kind,
            items,
            removed: removed.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn the_initial_gather_is_one_list_refresh() {
        let mut items = BTreeMap::new();
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                (0..500)
                    .map(|n| at(&format!("notes/{n}.md"), DownloadState::Current))
                    .collect(),
                vec![],
            ),
        );
        assert_eq!(
            effects,
            ChangeEffects {
                refresh_list: true,
                ..Default::default()
            }
        );
        assert_eq!(items.len(), 500);
    }

    #[test]
    fn upload_progress_and_unchanged_items_emit_nothing() {
        let mut items = BTreeMap::new();
        let note = CloudItem {
            modified: Some(10.0),
            ..at("notes/a.md", DownloadState::Current)
        };
        let pending = at("notes/b.md", DownloadState::Pending);
        apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                vec![note.clone(), pending.clone()],
                vec![],
            ),
        );
        let uploading = CloudItem {
            is_uploading: true,
            ..note.clone()
        };
        let downloading = CloudItem {
            is_downloading: true,
            ..pending
        };
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Changed,
                vec![uploading, downloading, note],
                vec![],
            ),
        );
        assert_eq!(effects, ChangeEffects::default());
    }

    #[test]
    fn download_state_changes_and_remote_edits_are_reported() {
        let mut items = BTreeMap::new();
        let edited = CloudItem {
            modified: Some(10.0),
            ..at("notes/edited.md", DownloadState::Current)
        };
        apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                vec![
                    at("notes/remote.md", DownloadState::Pending),
                    at("notes/failing.md", DownloadState::Pending),
                    edited.clone(),
                    at("notes/gone.md", DownloadState::Current),
                ],
                vec![],
            ),
        );
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Changed,
                vec![
                    at("notes/remote.md", DownloadState::Current),
                    CloudItem {
                        error: Some("The Internet connection appears to be offline.".into()),
                        ..at("notes/failing.md", DownloadState::Pending)
                    },
                    CloudItem {
                        modified: Some(20.0),
                        ..edited
                    },
                ],
                vec!["notes/gone.md"],
            ),
        );
        assert!(effects.refresh_list);
        assert_eq!(
            effects.modified,
            vec!["notes/remote.md", "notes/edited.md", "notes/gone.md"]
        );
        assert_eq!(
            effects.updates,
            vec![
                ItemUpdate {
                    path: "notes/remote.md".into(),
                    downloaded: true,
                    error: None,
                },
                ItemUpdate {
                    path: "notes/failing.md".into(),
                    downloaded: false,
                    error: Some("The Internet connection appears to be offline.".into()),
                },
            ]
        );
    }

    #[test]
    fn an_error_alone_does_not_reload_the_list() {
        let mut items = BTreeMap::new();
        apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                vec![at("notes/a.md", DownloadState::Pending)],
                vec![],
            ),
        );
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Changed,
                vec![CloudItem {
                    error: Some("offline".into()),
                    ..at("notes/a.md", DownloadState::Pending)
                }],
                vec![],
            ),
        );
        assert!(!effects.refresh_list);
        assert!(effects.modified.is_empty());
        assert_eq!(effects.updates.len(), 1);
    }

    #[test]
    fn conflicts_are_resolved_once_and_never_for_locked_notes() {
        let conflicted = |path: &str| CloudItem {
            has_conflicts: true,
            ..at(path, DownloadState::Current)
        };
        let mut items = BTreeMap::new();
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                vec![
                    conflicted("notes/a.md"),
                    conflicted("notes/Secret.md.locked"),
                    conflicted("templates/t.json"),
                ],
                vec![],
            ),
        );
        assert_eq!(effects.conflicts, vec!["notes/a.md"]);
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Changed,
                vec![conflicted("notes/a.md"), conflicted("daily/2026-09-20.md")],
                vec![],
            ),
        );
        assert_eq!(effects.conflicts, vec!["daily/2026-09-20.md"]);
    }

    #[test]
    fn the_end_of_a_download_asks_for_a_read_even_when_the_date_moved_first() {
        let mut items = BTreeMap::new();
        let downloading = CloudItem {
            modified: Some(20.0),
            is_downloading: true,
            ..at("notes/a.md", DownloadState::Downloaded)
        };
        apply_change(
            &mut items,
            &change(ChangeKind::Initial, vec![downloading.clone()], vec![]),
        );
        let finished = CloudItem {
            is_downloading: false,
            ..downloading.clone()
        };
        let effects = apply_change(
            &mut items,
            &change(ChangeKind::Changed, vec![finished], vec![]),
        );
        assert_eq!(effects.modified, vec!["notes/a.md"]);
        let current = CloudItem {
            is_downloading: false,
            ..at("notes/a.md", DownloadState::Current)
        };
        let current = CloudItem {
            modified: Some(20.0),
            ..current
        };
        let effects = apply_change(
            &mut items,
            &change(ChangeKind::Changed, vec![current], vec![]),
        );
        assert_eq!(effects.modified, vec!["notes/a.md"]);
        assert!(!effects.refresh_list);
    }

    #[test]
    fn a_conflict_found_before_the_download_is_resolved_when_it_arrives() {
        let conflicted = |state| CloudItem {
            has_conflicts: true,
            ..at("notes/a.md", state)
        };
        let mut items = BTreeMap::new();
        apply_change(
            &mut items,
            &change(
                ChangeKind::Initial,
                vec![conflicted(DownloadState::Pending)],
                vec![],
            ),
        );
        let effects = apply_change(
            &mut items,
            &change(
                ChangeKind::Changed,
                vec![conflicted(DownloadState::Current)],
                vec![],
            ),
        );
        assert_eq!(effects.conflicts, vec!["notes/a.md"]);
    }

    #[test]
    fn a_name_the_app_removed_is_free_before_the_metadata_catches_up() {
        let root = std::env::temp_dir().join(format!("moldavite-stale-{}", std::process::id()));
        std::fs::create_dir_all(root.join("daily")).unwrap();
        std::fs::write(root.join("daily/2026-09-20.md"), "body").unwrap();
        let items = BTreeMap::from([
            (
                "daily/2026-09-20.md".to_string(),
                at("daily/2026-09-20.md", DownloadState::Current),
            ),
            (
                "notes/Remote.md".to_string(),
                at("notes/Remote.md", DownloadState::Pending),
            ),
        ]);
        assert!(lookup(&items, &root, &root.join("daily/2026-09-20.md")).is_some());
        std::fs::remove_file(root.join("daily/2026-09-20.md")).unwrap();
        assert!(lookup(&items, &root, &root.join("daily/2026-09-20.md")).is_none());
        assert!(lookup(&items, &root, &root.join("notes/Remote.md")).is_some());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn remote_names_are_found_by_absolute_path() {
        let root = Path::new("/cloud/Documents");
        let items = BTreeMap::from([(
            "notes/Remote Folder/Plan.md".to_string(),
            item("notes/Remote Folder/Plan.md", false),
        )]);
        assert!(lookup(&items, root, &root.join("notes/Remote Folder/Plan.md")).is_some());
        assert!(lookup(&items, root, &root.join("notes/Plan.md")).is_none());
        assert!(lookup(
            &items,
            root,
            Path::new("/elsewhere/notes/Remote Folder/Plan.md")
        )
        .is_none());
        assert!(lookup(
            &items,
            root,
            &root.join("notes/../notes/Remote Folder/Plan.md")
        )
        .is_none());
    }

    #[test]
    fn a_regular_file_has_local_bytes() {
        let dir = std::env::temp_dir().join(format!("moldavite-bytes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        std::fs::write(&file, "body").unwrap();
        assert!(has_local_bytes(&file));
        assert!(!has_local_bytes(&dir.join("absent.md")));
        assert!(!has_local_bytes(&dir));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn remote_folders_include_empty_directories_without_duplicates() {
        let mut folders = Vec::new();
        merge_folder_items(
            &mut folders,
            vec![
                item("notes/Zebra/Empty", true),
                item("notes/Zebra/Note.md", false),
                item("notes/Alpha", true),
                item("notes/.hidden/Secret.md", false),
            ],
        );
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].name, "Alpha");
        assert_eq!(folders[1].children.len(), 1);
        assert_eq!(folders[1].children[0].path, "Zebra/Empty");
    }
}
