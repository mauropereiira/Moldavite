//! Tauri library entry point and composition root for Moldavite.
//!
//! This module owns command registration, application startup, and managed
//! shared state. Domain behavior stays in `commands/` and the sibling service
//! modules; every filesystem-facing command must preserve their validation
//! and atomic-persistence invariants.
//!
//! # Security
//!
//! - All file operations validate paths to prevent traversal attacks
//! - File permissions are set to 0o600 (owner read/write only)
//! - Directory permissions are set to 0o700 (owner only)
//! - Note encryption uses AES-256-GCM with Argon2 key derivation
//! - Unlock attempts are rate limited in-process; a copied `.locked` file is
//!   protected only by Argon2id and the password itself

/// Calendar integration: Apple (EventKit, macOS and iOS) and Google (REST, all platforms)
mod calendar;

/// OS credential store, shared by plugins and calendar accounts
mod secrets;

/// Core encryption logic (AES-256-GCM)
mod encryption;

/// Strict custom-scheme parsing and delivery for website plugin installs.
mod deep_link;

/// Security utilities (rate limiting)
mod security;

/// Markdown files opened from outside the Forge, edited in place by session id.
pub(crate) mod loose_files;

/// Markdown files dropped on the window, admitted as loose files when the
/// platform can say where they live.
mod dropped_files;

/// Host-side network execution for the plugin `net.fetch` API — the request
/// leaves from this process, not the webview, so the CSP's `connect-src`
/// cannot block it.
#[cfg(desktop)]
mod plugin_net;

/// Starting without third-party plugins: `--safe-mode` and the unfinished-start marker.
#[cfg(desktop)]
mod plugin_safety;

/// YAML frontmatter parsing for note files.
pub(crate) mod frontmatter;

/// One-shot migration: sidecar metadata JSON → per-file YAML frontmatter.
pub(crate) mod migration;

/// Stdio Model Context Protocol server, selected with the `--mcp` flag.
pub mod mcp;

/// Native-messaging host for the browser clipper, selected by how the browser
/// launches us. Write-only, and narrower than MCP on purpose.
pub mod browser_host;

/// Filesystem watcher (notify) that emits `forge:changed` events.
pub(crate) mod forge_watcher;

/// Best-effort attribution for note writes made through MCP.
pub(crate) mod agent_writes;

/// Publish a note to WordPress.com over an account the user signs in to.
pub(crate) mod wordpress;

pub(crate) mod backlinks_index;
pub(crate) mod cloud_forge;
pub(crate) mod commands;
pub(crate) mod paths;
pub(crate) mod persist;
/// Persistent keyword search: one SQLite FTS5 index per Forge.
pub(crate) mod search_index;
/// Local semantic (vector) search: embeddings index + query engine.
pub(crate) mod semantic;
pub(crate) mod templates_data;
pub(crate) mod types;
pub(crate) mod validation;
pub(crate) mod wiki;

#[cfg(test)]
mod stress_test;

// The same Foundation boundary is linked on macOS and iOS.
#[cfg(target_os = "macos")]
#[path = "../plugins/tauri-plugin-icloud/src/coordination.rs"]
mod file_coordination;
pub(crate) mod note_file_access;

/// File coordination must leave WebKit's main thread free. Run both the note
/// command and its synchronous IPC reply on the blocking pool. Using Tauri's
/// `command(async)` instead sends replies from Tokio's async workers: WebKit
/// waits for main to accept each reply, while the iOS dev asset proxy on main
/// waits for that same saturated runtime, deadlocking startup note reads.
///
/// Commands that can wait on a whole-Forge scan or index build take the same
/// route on every platform: run synchronously they hold the main thread, and
/// the window, for as long as they wait. A rename rewrites links across the
/// Forge; the graph took 0.3 to 1.3 s at 10,000 notes. `list_notes` stays on
/// main: its replies must keep their order against `create_note` and the other
/// synchronous writes, or a list started earlier lands last and drops the note
/// just created from the sidebar.
fn dispatch_note_io(
    handler: fn(tauri::ipc::Invoke) -> bool,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        let command = invoke.message.command();
        let waits_on_forge_scan = matches!(
            command,
            "get_backlinks"
                | "rescan_forge"
                | "search_notes_content"
                | "search_index_status"
                | "get_note_graph"
                | "rename_note"
                | "rename_folder"
                | "move_folder"
        );
        let coordinates_note_files = cfg!(any(target_os = "macos", target_os = "ios"))
            && matches!(
                command,
                "read_note"
                    | "write_note"
                    | "lock_note"
                    | "unlock_note"
                    | "permanently_unlock_note"
                    | "is_note_locked"
                    | "icloud_download_note"
                    | "move_note"
                    | "delete_note"
                    | "create_folder"
                    | "delete_folder"
                    | "set_note_color"
                    | "read_loose_file"
                    | "write_loose_file"
                    | "stat_loose_file"
                    | "add_loose_to_forge"
                    | "add_dropped_to_forge"
            );
        if waits_on_forge_scan || coordinates_note_files {
            tauri::async_runtime::spawn_blocking(move || handler(invoke));
            true
        } else {
            handler(invoke)
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
use calendar::CalendarPermission;
use calendar::{CalendarFetchResult, CalendarInfo, CalendarSourceStatus};

use commands::backlinks::{create_note_from_link, get_backlinks, scan_note_links};
use commands::export_import::{
    export_encrypted_backup, export_notes, export_settings_json, import_encrypted_backup,
    import_notes, import_settings_json,
};
use commands::folders::{create_folder, delete_folder, list_folders, move_folder, rename_folder};
use commands::forges::{
    create_forge, delete_forge, get_forges_root_path, list_forges, rename_forge, set_active_forge,
    set_forges_root,
};
use commands::graph::get_note_graph;
use commands::import_obsidian::{analyze_obsidian_vault, import_obsidian_vault};
use commands::locking::{is_note_locked, lock_note, permanently_unlock_note, unlock_note};
use commands::mcp_settings::{get_app_binary_path, get_mcp_writes_enabled, set_mcp_writes_enabled};
use commands::misc::{
    ensure_directories, get_all_note_colors, get_note_color, get_notes_directory,
    open_forge_in_finder, rescan_forge, save_image, set_note_color, write_binary_file,
};
use commands::notes::{
    clear_all_notes, create_note, delete_note, duplicate_note, export_single_note,
    fix_note_permissions, list_notes, move_note, preserve_buffer_copy, read_note, rename_note,
    write_note,
};
#[cfg(desktop)]
use commands::plugin_package::read_plugin_package;
#[cfg(desktop)]
use commands::plugins::{
    install_example_plugin, install_plugin_from_data, install_wordpress_plugin, list_plugins,
    plugin_secret_delete, plugin_secret_get, plugin_secret_set, uninstall_plugin,
};
use commands::root_files::{read_forge_root_file, write_forge_root_file};
use commands::search::{search_index_rebuild, search_index_status, search_notes_content};
use commands::semantic::{
    semantic_models, semantic_reindex, semantic_related, semantic_search, semantic_set_enabled,
    semantic_set_model, semantic_status,
};
use commands::templates::{
    apply_template, create_note_from_template, delete_template, get_template, list_templates,
    save_template, update_template,
};
use commands::trash::{
    cleanup_old_trash, empty_trash, list_trash, permanently_delete_trash, read_trashed_note,
    restore_note, restore_note_from_folder, trash_folder, trash_note,
};
#[cfg(desktop)]
use plugin_net::plugin_fetch;
#[cfg(desktop)]
use plugin_safety::{
    begin_plugin_startup, finish_plugin_startup, plugin_safe_mode_status, set_plugin_safe_mode,
};
use wordpress::{
    wordpress_connect, wordpress_disconnect, wordpress_publish, wordpress_sites, wordpress_status,
};

// The three EventKit permission commands exist only on macOS and iOS because
// they wrap an Apple-specific authorization model. Everything else dispatches
// across sources and compiles everywhere, so Google Calendar works on Windows
// and Linux too.

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[tauri::command]
fn get_calendar_permission() -> CalendarPermission {
    calendar::apple::get_permission_status()
}

/// Async so the bridge's wait (up to a minute) for the system prompt stays off
/// the main thread, which iOS needs free while the alert is up.
#[cfg(any(target_os = "macos", target_os = "ios"))]
#[tauri::command]
async fn request_calendar_permission() -> bool {
    tauri::async_runtime::spawn_blocking(calendar::apple::request_permission)
        .await
        .unwrap_or(false)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[tauri::command]
fn is_calendar_authorized() -> bool {
    calendar::apple::is_authorized()
}

#[tauri::command]
async fn list_calendar_sources() -> Result<Vec<CalendarSourceStatus>, String> {
    Ok(calendar::list_sources().await)
}

#[tauri::command]
async fn fetch_calendar_events(
    start_date: String,
    end_date: String,
    calendar_ids: Vec<String>,
) -> Result<CalendarFetchResult, String> {
    Ok(calendar::fetch_events(&start_date, &end_date, &calendar_ids).await)
}

#[tauri::command]
async fn list_calendars() -> Result<Vec<CalendarInfo>, String> {
    calendar::list_all_calendars().await
}

#[tauri::command]
async fn google_calendar_connect(app: tauri::AppHandle) -> Result<CalendarSourceStatus, String> {
    calendar::connect_google(&app).await
}

#[tauri::command]
fn google_calendar_disconnect() -> Result<(), String> {
    calendar::disconnect_google()
}

/// Whether the main webview may navigate to `url`: only the app's own origin,
/// plus the dev server in a debug build. A file dropped on the window, or a
/// stray link, would otherwise replace the app with the file and leave the
/// close guard registered by the page that is gone, so the window can no
/// longer be closed.
#[cfg(desktop)]
pub(crate) fn is_app_navigation_url(url: &tauri::Url, dev: Option<&tauri::Url>) -> bool {
    if url.scheme() == "blob" {
        return tauri::Url::parse(url.path())
            .is_ok_and(|inner| inner.scheme() != "blob" && is_app_navigation_url(&inner, dev));
    }
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true,
        _ => dev.is_some_and(|dev| {
            dev.scheme() == url.scheme()
                && dev.host_str() == url.host_str()
                && dev.port_or_known_default() == url.port_or_known_default()
        }),
    }
}

#[cfg(desktop)]
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri::Manager;

    tauri::plugin::Builder::new("nav-guard")
        .on_navigation(|webview, url| {
            let dev = if cfg!(debug_assertions) {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            let allowed = is_app_navigation_url(url, dev.as_ref());
            if !allowed {
                log::info!("[nav-guard] blocked a navigation away from the app");
            }
            allowed
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use std::sync::Arc;

    use tauri::{Emitter, Manager};
    use tauri_plugin_deep_link::DeepLinkExt;

    use crate::backlinks_index::BacklinksIndex;

    let backlinks_index = Arc::new(BacklinksIndex::new());
    let recent_writes = Arc::new(forge_watcher::RecentWrites::new());

    let builder = tauri::Builder::default();

    // This must remain the first desktop plugin so a secondary process exits
    // before any other plugin setup. Its `deep-link` feature forwards the
    // process argv through the existing `on_open_url` handler.
    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        if plugin_safety::has_safe_mode_flag(&argv) {
            plugin_safety::restart_in_safe_mode(app);
        }
        deep_link::route_paths(
            app,
            loose_files::file_args(&argv, std::path::Path::new(&cwd)),
        );
    }));

    let builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "ios")]
    let builder = builder
        .plugin(tauri_plugin_icloud::init())
        .plugin(tauri_plugin_calendar::init())
        .plugin(tauri_plugin_document_export::init())
        .plugin(tauri_plugin_mobile_ui::init());

    // The App Store owns updates and the restart after them, and a phone
    // has no window geometry to restore.
    #[cfg(desktop)]
    let builder = builder
        .plugin(navigation_guard())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::new().build());

    builder
        .manage(backlinks_index.clone())
        .manage(recent_writes.clone())
        .manage(deep_link::PendingDeepLinks::default())
        .manage(loose_files::LooseFiles::default())
        .setup(move |app| {
            deep_link::mark_launch();
            #[cfg(windows)]
            dropped_files::listen_for_drops(app.handle());
            // Here rather than on the builder: only the primary instance may
            // consume the marker, and a second launch exits before setup.
            #[cfg(desktop)]
            app.manage(plugin_safety::PluginSafety::at_launch(
                plugin_safety::marker_path(),
                plugin_safety::has_safe_mode_flag(&std::env::args().collect::<Vec<_>>()),
            ));
            cloud_forge::initialize(app.handle().clone());
            // Register before WebView hydration. Live URLs wake the frontend;
            // cold-start URLs remain queued until React drains them.
            let app_handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                deep_link::route_urls(&app_handle, event.urls().iter().map(|url| url.as_str()));
            });
            if let Some(urls) = app.deep_link().get_current()? {
                deep_link::route_urls(app.handle(), urls.iter().map(|url| url.as_str()));
            }
            // Windows and Linux hand a double-clicked file to a cold start as
            // an argument; macOS delivers it to `on_open_url` as a file URL.
            #[cfg(desktop)]
            if let Ok(cwd) = std::env::current_dir() {
                let argv: Vec<String> = std::env::args().collect();
                deep_link::route_paths(app.handle(), loose_files::file_args(&argv, &cwd));
            }
            // macOS schemes are registered through the generated app bundle.
            // Linux, and Windows development builds without an installer,
            // register the configured schemes at runtime.
            #[cfg(any(target_os = "linux", all(debug_assertions, target_os = "windows")))]
            app.deep_link().register_all()?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Wrap legacy single-Forge layout into Default Forge if needed.
            // Idempotent — runs on every launch and exits early once
            // forges_root + active_forge are set.
            if let Err(e) = migration::migrate_legacy_single_forge_to_multi() {
                log::warn!("[forge] multi-Forge migration error: {}", e);
            }
            // A moved app bundle leaves paired browsers pointing at a binary
            // that is no longer there; only already-paired browsers are touched.
            #[cfg(desktop)]
            commands::browser_bridge::refresh_paired_manifests();
            if let Err(e) = migration::adopt_stray_root_layout() {
                log::warn!("[forge] stray root layout migration error: {}", e);
            }
            if let Err(e) = commands::forges::ensure_active_forge() {
                log::warn!("[forge] active Forge bootstrap error: {}", e);
            }
            // The static asset scope only covers the default Forge location, so
            // a relocated or iCloud Forge needs its images granted before the
            // first note renders.
            if let Ok(root) = paths::get_notes_dir() {
                paths::grant_forge_asset_access(app.handle(), &root);
            }
            // Run sidecar-metadata → frontmatter migration once. Idempotent,
            // safe to call on every launch.
            match migration::migrate_metadata_to_frontmatter() {
                Ok(0) => {}
                Ok(n) => log::info!("[forge] migrated {} note colors to frontmatter", n),
                Err(e) => log::warn!("[forge] migration error: {}", e),
            }
            // Build backlinks index off the main thread so startup isn't blocked.
            let idx = backlinks_index.clone();
            tauri::async_runtime::spawn_blocking(move || {
                idx.rebuild_from_disk();
            });
            // Bring the keyword index in line with disk, also off-thread.
            // Search is served by the live scan until this finishes.
            if let Ok(root) = paths::get_notes_dir() {
                search_index::spawn_reconcile(root);
            }
            search_index::spawn_periodic_reconcile();
            // Spawn the file watcher into a slot that survives Forge switches.
            // The slot is managed unconditionally, even if this spawn fails, so
            // a later switch still has somewhere to install its watcher.
            let watcher_slot = forge_watcher::WatcherSlot::default();
            // iOS has no FSEvents, so `notify` polls there and reports the
            // app's own writes back as external edits. Nothing else can touch
            // the sandboxed Forge yet; the iCloud work brings its own watcher.
            if cfg!(desktop) {
                match forge_watcher::spawn(app.handle().clone(), recent_writes.clone()) {
                    Ok(h) => watcher_slot.replace(Some(h)),
                    Err(e) => log::warn!("[forge] watcher spawn failed: {}", e),
                }
            }
            app.manage(watcher_slot);
            if persist::read_config().active_synced_forge {
                let handle = app.handle().clone();
                let recent = recent_writes.clone();
                let index = backlinks_index.clone();
                tauri::async_runtime::spawn(async move {
                    match cloud_forge::connect(&handle).await {
                        Ok(root) => {
                            if persist::read_config().active_synced_forge {
                                commands::forges::refresh_active_forge(
                                    &handle, recent, index, root,
                                );
                                let _ = handle.emit("icloud:ready", ());
                            }
                        }
                        Err(error) => {
                            let _ = handle.emit("icloud:error", error);
                        }
                    }
                });
            }
            wordpress::init(app.handle());
            // If the user already enabled semantic search, load/reconcile the
            // index in the background (the model was downloaded during the
            // original explicit enable; this only re-downloads if the cache
            // was wiped while the feature stayed enabled).
            if persist::read_config().semantic_enabled.unwrap_or(false) {
                commands::semantic::spawn_semantic_build(app.handle().clone(), false);
            }
            Ok(())
        })
        .invoke_handler(dispatch_note_io(tauri::generate_handler![
            deep_link::take_pending_deep_links,
            deep_link::was_launched_with_file,
            loose_files::read_loose_file,
            loose_files::write_loose_file,
            loose_files::stat_loose_file,
            loose_files::close_loose_file,
            loose_files::list_open_loose_files,
            loose_files::add_loose_to_forge,
            dropped_files::admit_dropped_files,
            dropped_files::add_dropped_to_forge,
            #[cfg(desktop)]
            loose_files::open_loose_file_dialog,
            #[cfg(desktop)]
            loose_files::save_loose_copy_dialog,
            #[cfg(desktop)]
            loose_files::reveal_loose_file,
            commands::forges::set_synced_forge_enabled,
            commands::forges::icloud_readiness,
            commands::notes::icloud_download_note,
            #[cfg(mobile)]
            commands::misc::open_support_page,
            #[cfg(mobile)]
            commands::misc::open_external_link,
            #[cfg(target_os = "ios")]
            commands::export_import::export_mobile_document,
            #[cfg(target_os = "ios")]
            commands::export_import::share_mobile_note,
            #[cfg(desktop)]
            commands::browser_bridge::browser_bridge_status,
            #[cfg(desktop)]
            commands::browser_bridge::connect_browser_bridge,
            #[cfg(desktop)]
            commands::browser_bridge::disconnect_browser_bridge,
            wordpress_status,
            wordpress_connect,
            wordpress_disconnect,
            wordpress_sites,
            wordpress_publish,
            commands::default_app::default_markdown_app_status,
            commands::default_app::make_default_markdown_app,
            agent_writes::take_agent_write,
            ensure_directories,
            get_app_binary_path,
            get_mcp_writes_enabled,
            set_mcp_writes_enabled,
            list_notes,
            search_notes_content,
            // Persistent keyword (FTS5) index
            search_index_status,
            search_index_rebuild,
            // Semantic (vector) search commands
            semantic_status,
            semantic_models,
            semantic_set_enabled,
            semantic_set_model,
            semantic_search,
            semantic_related,
            semantic_reindex,
            read_note,
            write_note,
            delete_note,
            preserve_buffer_copy,
            create_note,
            duplicate_note,
            export_single_note,
            rename_note,
            clear_all_notes,
            // Plugin system commands
            #[cfg(desktop)]
            list_plugins,
            #[cfg(desktop)]
            uninstall_plugin,
            #[cfg(desktop)]
            install_example_plugin,
            #[cfg(desktop)]
            install_wordpress_plugin,
            #[cfg(desktop)]
            install_plugin_from_data,
            #[cfg(desktop)]
            plugin_secret_get,
            #[cfg(desktop)]
            plugin_secret_set,
            #[cfg(desktop)]
            plugin_secret_delete,
            #[cfg(desktop)]
            plugin_fetch,
            #[cfg(desktop)]
            read_plugin_package,
            #[cfg(desktop)]
            plugin_safe_mode_status,
            #[cfg(desktop)]
            begin_plugin_startup,
            #[cfg(desktop)]
            finish_plugin_startup,
            #[cfg(desktop)]
            set_plugin_safe_mode,
            // Folder system commands
            list_folders,
            create_folder,
            rename_folder,
            delete_folder,
            move_folder,
            move_note,
            // Trash system commands
            trash_note,
            trash_folder,
            list_trash,
            read_trashed_note,
            restore_note,
            restore_note_from_folder,
            permanently_delete_trash,
            empty_trash,
            cleanup_old_trash,
            // Template system commands
            list_templates,
            get_template,
            save_template,
            update_template,
            delete_template,
            apply_template,
            create_note_from_template,
            // Privacy commands
            fix_note_permissions,
            // Note locking commands
            lock_note,
            unlock_note,
            permanently_unlock_note,
            is_note_locked,
            // Wiki Link system commands
            scan_note_links,
            get_backlinks,
            create_note_from_link,
            // Graph view
            get_note_graph,
            // Directory management commands
            get_notes_directory,
            rescan_forge,
            open_forge_in_finder,
            // Forge-root whitelisted files (AGENTS.md, .gitignore)
            write_forge_root_file,
            read_forge_root_file,
            // Multi-Forge management commands
            list_forges,
            create_forge,
            set_active_forge,
            rename_forge,
            delete_forge,
            set_forges_root,
            get_forges_root_path,
            // One-time Obsidian vault COPY importer
            analyze_obsidian_vault,
            import_obsidian_vault,
            // Export/Import commands
            export_notes,
            import_notes,
            export_encrypted_backup,
            import_encrypted_backup,
            // Note metadata commands
            get_note_color,
            set_note_color,
            get_all_note_colors,
            // Binary file write (PDF export)
            write_binary_file,
            // Settings JSON export / import
            export_settings_json,
            import_settings_json,
            // Image handling
            save_image,
            // Calendar: EventKit permission is macOS and iOS only, the rest is cross-platform
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            get_calendar_permission,
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            request_calendar_permission,
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            is_calendar_authorized,
            list_calendar_sources,
            fetch_calendar_events,
            list_calendars,
            google_calendar_connect,
            google_calendar_disconnect
        ]))
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                semantic::service().flush_persist();
            }
        });
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use crate::commands::search::search_notes_content_in;
    use crate::validation::{is_safe_filename, validate_path_within_base};

    #[test]
    fn navigation_stays_on_the_app_origin() {
        use super::is_app_navigation_url;
        let url = |value: &str| tauri::Url::parse(value).unwrap();
        let dev = url("http://localhost:5173");

        for allowed in [
            "tauri://localhost",
            "tauri://localhost/index.html#note",
            "http://tauri.localhost/",
            "https://tauri.localhost/settings",
            "blob:http://tauri.localhost/1234",
            "blob:https://tauri.localhost/1234",
        ] {
            assert!(is_app_navigation_url(&url(allowed), None), "{allowed}");
        }
        assert!(is_app_navigation_url(
            &url("http://localhost:5173/src/main.tsx"),
            Some(&dev)
        ));
        assert!(is_app_navigation_url(
            &url("blob:http://localhost:5173/1234"),
            Some(&dev)
        ));

        for blocked in [
            "file:///Users/me/Desktop/note.md",
            "https://example.com/",
            "http://localhost:5173/",
            "tauri://evil.com",
            "http://tauri.localhost.evil.com/",
            "asset://localhost/x.png",
            "about:blank",
            "blob:https://example.com/1234",
            "blob:file:///tmp/1234",
            "blob:null/1234",
            "blob:blob:http://tauri.localhost/1234",
        ] {
            assert!(!is_app_navigation_url(&url(blocked), None), "{blocked}");
        }
        for blocked in [
            "http://localhost:5174/",
            "https://localhost:5173/",
            "http://127.0.0.1:5173/",
            "blob:http://localhost:5174/1234",
        ] {
            assert!(
                !is_app_navigation_url(&url(blocked), Some(&dev)),
                "{blocked}"
            );
        }
    }

    #[test]
    fn is_safe_filename_accepts_simple_names() {
        assert!(is_safe_filename("note.md"));
        assert!(is_safe_filename("My Note 2024.md"));
        assert!(is_safe_filename("a"));
        assert!(is_safe_filename("日本語.md"));
    }

    #[test]
    fn is_safe_filename_rejects_empty() {
        assert!(!is_safe_filename(""));
    }

    #[test]
    fn is_safe_filename_rejects_path_traversal() {
        assert!(!is_safe_filename(".."));
        assert!(!is_safe_filename("../secrets.md"));
        assert!(!is_safe_filename("..\\secrets.md"));
        assert!(!is_safe_filename("foo/../bar.md"));
        assert!(!is_safe_filename("notes/..hidden"));
    }

    #[test]
    fn is_safe_filename_rejects_absolute_paths() {
        assert!(!is_safe_filename("/etc/passwd"));
        assert!(!is_safe_filename("\\Windows\\System32"));
    }

    #[test]
    fn is_safe_filename_rejects_directory_separators() {
        assert!(!is_safe_filename("sub/note.md"));
        assert!(!is_safe_filename("sub\\note.md"));
    }

    #[test]
    fn is_safe_filename_rejects_null_bytes() {
        assert!(!is_safe_filename("note\0.md"));
    }

    fn make_tmp_base() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "moldavite-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&base).unwrap();
        base
    }

    #[test]
    fn validate_path_within_base_accepts_child() {
        let base = make_tmp_base();
        let dest = base.join("child.md");
        // Parent (== base) must exist; dest itself does not need to
        assert!(validate_path_within_base(&dest, &base).is_ok());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn validate_path_within_base_accepts_nested_child() {
        let base = make_tmp_base();
        let sub = base.join("sub");
        fs::create_dir_all(&sub).unwrap();
        let dest = sub.join("note.md");
        assert!(validate_path_within_base(&dest, &base).is_ok());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn validate_path_within_base_rejects_sibling() {
        let base = make_tmp_base();
        let outside = base
            .parent()
            .unwrap()
            .join(format!("moldavite-test-outside-{}", std::process::id()));
        fs::create_dir_all(&outside).unwrap();
        let dest = outside.join("leak.md");
        let result = validate_path_within_base(&dest, &base);
        assert!(result.is_err(), "expected rejection, got {:?}", result);
        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    #[test]
    fn validate_path_within_base_rejects_missing_base() {
        let base = std::env::temp_dir().join(format!(
            "moldavite-does-not-exist-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let dest = base.join("foo.md");
        assert!(validate_path_within_base(&dest, &base).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validate_path_within_base_rejects_symlinked_subdir() {
        use std::os::unix::fs::symlink;

        let base = make_tmp_base();
        let outside = base.parent().unwrap().join(format!(
            "moldavite-test-symtarget-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        fs::create_dir_all(&outside).unwrap();

        let link = base.join("evil");
        symlink(&outside, &link).unwrap();

        let dest = link.join("pwned.md");
        let result = validate_path_within_base(&dest, &base);
        assert!(
            result.is_err(),
            "expected symlink rejection, got {:?}",
            result
        );

        fs::remove_dir_all(&base).ok();
        fs::remove_dir_all(&outside).ok();
    }

    fn seed_notes(base: &Path) {
        fs::create_dir_all(base.join("notes")).unwrap();
        fs::create_dir_all(base.join("notes/Projects")).unwrap();
        fs::create_dir_all(base.join("daily")).unwrap();
        fs::create_dir_all(base.join("weekly")).unwrap();
        fs::create_dir_all(base.join(".trash")).unwrap();

        fs::write(
            base.join("notes/alpha.md"),
            "First line\nThe quick brown fox\nalpha beta gamma\n",
        )
        .unwrap();
        fs::write(
            base.join("notes/Projects/beta.md"),
            "beta appears once here\nno match on this line\nand beta again\n",
        )
        .unwrap();
        fs::write(
            base.join("daily/2026-04-24.md"),
            "Daily log\nDiscussed the fox plan\n",
        )
        .unwrap();
        fs::write(
            base.join("weekly/2026-W17.md"),
            "Weekly review\nfox sightings up\n",
        )
        .unwrap();
        // A locked note that must never be scanned
        fs::write(base.join("notes/secret.md.locked"), "fox fox fox fox").unwrap();
        // A trashed note that must never be scanned
        fs::write(base.join(".trash/old.md"), "fox fox fox").unwrap();
        // Internal semantic-index state that must never be scanned
        fs::create_dir_all(base.join(".index")).unwrap();
        fs::write(base.join(".index/embeddings.v1.bin"), b"binary fox").unwrap();
        fs::write(base.join(".index/sneaky.md"), "fox fox fox fox fox").unwrap();
    }

    #[test]
    fn search_notes_content_finds_matches() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        let names: Vec<_> = results.iter().map(|r| r.filename.clone()).collect();
        assert!(names.contains(&"alpha.md".to_string()));
        assert!(names.contains(&"2026-04-24.md".to_string()));
        assert!(names.contains(&"2026-W17.md".to_string()));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_excludes_locked_files() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        for r in &results {
            assert!(
                !r.filename.ends_with(".locked"),
                "locked file surfaced: {}",
                r.filename
            );
            assert!(
                !r.path.starts_with(".trash"),
                "trash file surfaced: {}",
                r.path
            );
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_excludes_index_dir() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        assert!(!results.is_empty());
        for r in &results {
            assert!(
                !r.path.starts_with(".index"),
                "semantic index dir surfaced in search: {}",
                r.path
            );
            assert_ne!(r.filename, "sneaky.md");
        }
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn scan_notes_recursive_skips_hidden_dirs() {
        let base = make_tmp_base();
        seed_notes(&base);
        // Even if an .index dir somehow appears inside notes/, it must be
        // invisible to note listing.
        fs::create_dir_all(base.join("notes/.index")).unwrap();
        fs::write(base.join("notes/.index/sneaky.md"), "hidden").unwrap();
        let mut notes = Vec::new();
        crate::commands::notes::scan_notes_recursive(&base.join("notes"), "", &mut notes);
        assert!(notes.iter().all(|n| !n.path.contains(".index")));
        assert!(notes.iter().any(|n| n.name == "alpha.md"));
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_is_case_insensitive() {
        let base = make_tmp_base();
        seed_notes(&base);
        let lower = search_notes_content_in(&base, &base.join(".trash"), "fox", 100);
        let upper = search_notes_content_in(&base, &base.join(".trash"), "FOX", 100);
        assert_eq!(lower.len(), upper.len());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_sorts_by_match_count() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "beta", 100);
        assert!(!results.is_empty());
        // beta.md has 2 matches, alpha.md has 1. beta.md must come first.
        assert_eq!(results[0].filename, "beta.md");
        assert_eq!(results[0].match_count, 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_respects_max_results() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "fox", 2);
        assert!(results.len() <= 2);
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_empty_query_returns_nothing() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "   ", 100);
        assert!(results.is_empty());
        fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn search_notes_content_reports_folder_path() {
        let base = make_tmp_base();
        seed_notes(&base);
        let results = search_notes_content_in(&base, &base.join(".trash"), "beta", 100);
        let beta = results.iter().find(|r| r.filename == "beta.md").unwrap();
        assert_eq!(beta.folder_path.as_deref(), Some("Projects"));
        assert!(!beta.is_daily);
        assert!(!beta.is_weekly);
        fs::remove_dir_all(&base).ok();
    }
}
