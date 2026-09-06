//! Optional iCloud storage, separate from the device's local Forge root.
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::AppHandle;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::{Emitter, Manager};

#[cfg(not(target_os = "ios"))]
#[path = "../plugins/tauri-plugin-icloud/src/models.rs"]
mod models;
use models::CloudItem;
#[cfg(any(target_os = "macos", target_os = "ios", test))]
use models::DownloadState;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use models::{ChangeKind, CloudChange};
#[cfg(target_os = "ios")]
use tauri_plugin_icloud::models;

pub(crate) const FORGE_ID: &str = "icloud://moldavite";
static APP: OnceLock<AppHandle> = OnceLock::new();
static ITEMS: Mutex<BTreeMap<String, CloudItem>> = Mutex::new(BTreeMap::new());

pub(crate) fn initialize(app: AppHandle) {
    let _ = APP.set(app);
}

pub(crate) fn root() -> Result<PathBuf, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        #[cfg(target_os = "macos")]
        use crate::file_coordination as native;
        #[cfg(target_os = "ios")]
        use tauri_plugin_icloud::coordination as native;
        native::cloud_root()
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    Err("The iCloud Forge is available on Apple devices only".to_string())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn changed(change: CloudChange) {
    if let Ok(mut items) = ITEMS.lock() {
        if change.kind == ChangeKind::Initial {
            items.clear();
        }
        for item in &change.items {
            items.insert(item.path.clone(), item.clone());
        }
        for path in &change.removed {
            items.remove(path);
        }
    }
    if !crate::persist::read_config().active_synced_forge {
        return;
    }
    if let Some(app) = APP.get() {
        let _ = app.emit("icloud:changed", &change);
        // Existing reconciliation protects dirty open buffers. A metadata
        // update must request a read, never synthesize an empty note body.
        for path in change
            .items
            .iter()
            .filter(|item| {
                matches!(
                    item.download_state,
                    DownloadState::Local | DownloadState::Current | DownloadState::Downloaded
                )
            })
            .map(|item| &item.path)
            .chain(change.removed.iter())
        {
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
        let _ = app.emit("forges:changed", ());
    }
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

/// Add remote names to the same note list as files already on disk.
pub(crate) fn merge_notes(notes: &mut Vec<crate::types::NoteFile>) -> Result<(), String> {
    if !crate::persist::read_config().active_synced_forge {
        return Ok(());
    }
    merge_note_items(notes, snapshot()?);
    Ok(())
}

fn merge_note_items(notes: &mut Vec<crate::types::NoteFile>, items: Vec<CloudItem>) {
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
        if let Some(existing) = notes.iter_mut().find(|note| note.path == path) {
            existing.is_locked |= locked;
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
        });
    }
}

pub(crate) fn merge_folders(folders: &mut Vec<crate::types::FolderInfo>) -> Result<(), String> {
    if !crate::persist::read_config().active_synced_forge {
        return Ok(());
    }
    merge_folder_items(folders, snapshot()?);
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
