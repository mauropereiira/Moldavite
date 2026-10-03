//! Markdown files dropped on the window, opened in place like Open With.
//!
//! Tauri's drop handling stays off (see `src/lib/dropGuard.ts`), so the page
//! gets a dropped file's bytes; paths need the platform routes below. Every
//! recovered path still goes through `loose_files::admit`.
//!
//! macOS reads the named drag pasteboard; persistence after WebKit delivers a
//! drop needs a real drag check. Apple's docs do not guarantee cross-process
//! drags use that board. Windows reads WebView2's native File objects. Linux
//! accepts file URLs from the page, a weaker boundary: matching metadata does
//! not prove the user dropped the file. Unmatched files open read-only.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Deserialize;
use tauri::{AppHandle, Manager, Runtime, State};
use unicode_normalization::UnicodeNormalization;

use crate::loose_files::{self, Admission, LooseFiles, MAX_LOOSE_FILE_BYTES};

const MAX_DROPPED_FILES: usize = 64;
// Allow timestamp rounding by the webview or filesystem.
const MTIME_TOLERANCE_MS: f64 = 2000.0;
#[cfg(any(test, windows))]
const REPORT_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DropCandidate {
    name: String,
    size: u64,
    last_modified: Option<f64>,
}

fn same_name(path: &Path, name: &str) -> bool {
    path.file_name()
        .and_then(|leaf| leaf.to_str())
        .is_some_and(|leaf| leaf.nfc().eq(name.nfc()))
}

fn matches(candidate: &DropCandidate, path: &Path, require_mtime: bool) -> bool {
    if !path.is_absolute()
        || !same_name(path, &candidate.name)
        || !loose_files::has_markdown_extension(path)
    {
        return false;
    }
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    let modified_ms = metadata
        .modified()
        .ok()
        .map(|time| match time.duration_since(UNIX_EPOCH) {
            Ok(since) => since.as_millis() as f64,
            Err(before) => -(before.duration().as_millis() as f64),
        });
    metadata.is_file()
        && metadata.len() == candidate.size
        && if require_mtime {
            candidate
                .last_modified
                .zip(modified_ms)
                .is_some_and(|(reported, actual)| (actual - reported).abs() <= 1.0)
        } else {
            candidate
                .last_modified
                .zip(modified_ms)
                .is_none_or(|(reported, actual)| (actual - reported).abs() <= MTIME_TOLERANCE_MS)
        }
}

fn match_candidates(
    candidates: &[DropCandidate],
    paths: &[PathBuf],
    require_mtime: bool,
) -> Vec<Option<PathBuf>> {
    let mut claimed = vec![false; paths.len()];
    candidates
        .iter()
        .map(|candidate| {
            let index = paths.iter().enumerate().position(|(index, path)| {
                !claimed[index] && matches(candidate, path, require_mtime)
            })?;
            claimed[index] = true;
            Some(paths[index].clone())
        })
        .collect()
}

fn admit_candidates(
    candidates: &[DropCandidate],
    paths: &[PathBuf],
    require_mtime: bool,
    admit: impl Fn(&Path) -> Result<Admission, String>,
) -> Vec<Option<Admission>> {
    match_candidates(candidates, paths, require_mtime)
        .into_iter()
        .map(|path| {
            path.and_then(|path| match admit(&path) {
                Ok(admission) => Some(admission),
                Err(reason) => {
                    log::info!("[dropped-files] not admitted reason={reason}");
                    None
                }
            })
        })
        .collect()
}

#[cfg(any(test, target_os = "macos"))]
fn parse_path_list(json: &str) -> Vec<PathBuf> {
    serde_json::from_str::<Vec<String>>(json)
        .map(|paths| {
            paths
                .into_iter()
                .filter(|path| Path::new(path).is_absolute())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(any(all(test, unix), all(desktop, not(any(target_os = "macos", windows)))))]
fn parse_uri_list(list: &str) -> Vec<PathBuf> {
    list.lines()
        .map(str::trim)
        .filter(|line| line.starts_with("file://"))
        .filter_map(loose_files::file_url_path)
        .collect()
}

#[cfg(target_os = "macos")]
mod drag_pasteboard {
    use std::ffi::CStr;
    use std::os::raw::c_char;
    use std::path::PathBuf;

    extern "C" {
        fn drag_pasteboard_file_paths() -> *mut c_char;
        fn free_string(ptr: *mut c_char);
    }

    pub(super) fn paths() -> Vec<PathBuf> {
        // SAFETY: the bridge returns null or a NUL-terminated string it
        // allocated, which goes back to its own `free_string` exactly once.
        unsafe {
            let raw = drag_pasteboard_file_paths();
            if raw.is_null() {
                return Vec::new();
            }
            let json = CStr::from_ptr(raw).to_string_lossy().into_owned();
            free_string(raw);
            super::parse_path_list(&json)
        }
    }
}

/// Paths WebView2 reported for each drop, keyed by the page's drop token, until
/// `admit_dropped_files` asks for them. The message and the command travel
/// separately, so either can arrive first.
#[cfg(any(test, windows))]
#[derive(Default)]
pub(crate) struct DropReports {
    reports: std::sync::Mutex<std::collections::HashMap<String, Vec<PathBuf>>>,
    arrived: std::sync::Condvar,
}

#[cfg(any(test, windows))]
impl DropReports {
    const MAX_PENDING: usize = 16;

    fn put(&self, token: String, paths: Vec<PathBuf>) {
        let Ok(mut reports) = self.reports.lock() else {
            return;
        };
        if reports.len() >= Self::MAX_PENDING {
            reports.clear();
        }
        reports.insert(token, paths);
        self.arrived.notify_all();
    }

    fn take(&self, token: &str, wait: std::time::Duration) -> Vec<PathBuf> {
        let Ok(reports) = self.reports.lock() else {
            return Vec::new();
        };
        let Ok((mut reports, _)) = self
            .arrived
            .wait_timeout_while(reports, wait, |reports| !reports.contains_key(token))
        else {
            return Vec::new();
        };
        reports.remove(token).unwrap_or_default()
    }
}

#[cfg(any(test, windows))]
fn drop_token(message_json: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct DropMessage {
        #[serde(rename = "moldaviteDrop")]
        token: String,
    }
    let token = serde_json::from_str::<DropMessage>(message_json)
        .ok()?
        .token;
    let valid = (1..=64).contains(&token.len())
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-');
    valid.then_some(token)
}

#[cfg(windows)]
mod webview2 {
    use std::path::PathBuf;

    use tauri::{AppHandle, Manager, Runtime};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Controller, ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs,
        ICoreWebView2WebMessageReceivedEventArgs2,
    };
    use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
    use windows_core::{Interface, PWSTR};

    use super::{drop_token, DropReports, MAX_DROPPED_FILES};

    fn from_app<R: Runtime>(app: &AppHandle<R>, source: &str) -> bool {
        let dev = if cfg!(debug_assertions) {
            app.config().build.dev_url.clone()
        } else {
            None
        };
        tauri::Url::parse(source).is_ok_and(|url| crate::is_app_navigation_url(&url, dev.as_ref()))
    }

    /// The page posts a JSON object rather than a string, so wry's IPC
    /// handler, which reads every message as a string, skips it.
    unsafe fn report<R: Runtime>(
        app: &AppHandle<R>,
        args: &ICoreWebView2WebMessageReceivedEventArgs,
    ) -> windows_core::Result<()> {
        let mut source = PWSTR::null();
        args.Source(&mut source)?;
        if !from_app(app, &take_pwstr(source)) {
            return Ok(());
        }
        let mut json = PWSTR::null();
        args.WebMessageAsJson(&mut json)?;
        let Some(token) = drop_token(&take_pwstr(json)) else {
            return Ok(());
        };
        let objects = args
            .cast::<ICoreWebView2WebMessageReceivedEventArgs2>()?
            .AdditionalObjects()?;
        let mut count = 0u32;
        objects.Count(&mut count)?;
        let mut paths = Vec::new();
        for index in 0..count.min(MAX_DROPPED_FILES as u32) {
            let Ok(file) = objects
                .GetValueAtIndex(index)
                .and_then(|object| object.cast::<ICoreWebView2File>())
            else {
                continue;
            };
            let mut path = PWSTR::null();
            if file.Path(&mut path).is_ok() {
                paths.push(PathBuf::from(take_pwstr(path)));
            }
        }
        app.state::<DropReports>().put(token, paths);
        Ok(())
    }

    pub(super) unsafe fn listen<R: Runtime>(
        controller: ICoreWebView2Controller,
        app: AppHandle<R>,
    ) -> windows_core::Result<()> {
        let mut token = 0i64;
        controller.CoreWebView2()?.add_WebMessageReceived(
            &WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                if let Some(args) = args {
                    if let Err(error) = report(&app, &args) {
                        log::info!("[dropped-files] could not read a drop: {error}");
                    }
                }
                Ok(())
            })),
            &mut token,
        )
    }
}

#[cfg(windows)]
pub(crate) fn listen_for_drops<R: Runtime>(app: &AppHandle<R>) {
    app.manage(DropReports::default());
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let handle = app.clone();
    let attached = window.with_webview(move |webview| {
        // SAFETY: runs on the UI thread that owns the controller.
        if let Err(error) = unsafe { webview2::listen(webview.controller(), handle) } {
            log::warn!("[dropped-files] could not listen for drops: {error}");
        }
    });
    if let Err(error) = attached {
        log::warn!("[dropped-files] could not reach the webview: {error}");
    }
}

/// Runs off the main thread, which the macOS read is sent back to: AppKit
/// objects belong there, and WebView2 delivers its reports there too.
#[allow(unused_variables)]
fn dropped_paths<R: Runtime>(
    app: &AppHandle<R>,
    uri_list: Option<&str>,
    token: Option<&str>,
) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        if app
            .run_on_main_thread(move || {
                let _ = sender.send(drag_pasteboard::paths());
            })
            .is_err()
        {
            return Vec::new();
        }
        receiver
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap_or_default()
    }
    #[cfg(windows)]
    {
        token
            .map(|token| app.state::<DropReports>().take(token, REPORT_WAIT))
            .unwrap_or_default()
    }
    #[cfg(all(desktop, not(any(target_os = "macos", windows))))]
    {
        uri_list.map(parse_uri_list).unwrap_or_default()
    }
    #[cfg(mobile)]
    {
        Vec::new()
    }
}

/// Admit each dropped Markdown file the platform can place. The result lines
/// up with `candidates`; `null` means the page should open that file read-only.
#[tauri::command]
pub(crate) async fn admit_dropped_files<R: Runtime>(
    app: AppHandle<R>,
    mut candidates: Vec<DropCandidate>,
    uri_list: Option<String>,
    token: Option<String>,
) -> Result<Vec<Option<Admission>>, String> {
    candidates.truncate(MAX_DROPPED_FILES);
    tauri::async_runtime::spawn_blocking(move || {
        let paths = dropped_paths(&app, uri_list.as_deref(), token.as_deref());
        let state = app.state::<LooseFiles>();
        admit_candidates(
            &candidates,
            &paths,
            cfg!(all(desktop, not(any(target_os = "macos", windows)))),
            |path| loose_files::admit(&state, path),
        )
    })
    .await
    .map_err(|error| error.to_string())
}

/// A dropped file opened read-only, copied into the active Forge's `notes/`
/// from the text the page read. Returns the new note's `notes/`-relative path.
#[tauri::command]
pub(crate) fn add_dropped_to_forge(
    name: String,
    text: String,
    index: State<'_, std::sync::Arc<crate::backlinks_index::BacklinksIndex>>,
) -> Result<String, String> {
    if text.len() as u64 > MAX_LOOSE_FILE_BYTES {
        return Err("The file is larger than 10 MB".to_string());
    }
    let stem = Path::new(&name)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    crate::commands::notes::create_note_with_content(&stem, &text, &index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "moldavite-dropped-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dunce::canonicalize(&dir).unwrap())
        }

        fn file(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, contents).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn mtime_ms(path: &Path) -> f64 {
        fs::metadata(path)
            .unwrap()
            .modified()
            .unwrap()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as f64
    }

    fn candidate_for(path: &Path) -> DropCandidate {
        DropCandidate {
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            size: fs::metadata(path).unwrap().len(),
            last_modified: Some(mtime_ms(path)),
        }
    }

    #[test]
    fn a_path_matching_a_dropped_file_by_name_size_and_time_is_matched() {
        let dir = TempDir::new("match");
        let note = dir.file("Read me.md", "# Hello");
        let other = dir.file("Other.md", "# Other");

        let matched = match_candidates(&[candidate_for(&note)], &[other, note.clone()], false);

        assert_eq!(matched, vec![Some(note)]);
    }

    #[test]
    fn timestamps_before_the_unix_epoch_are_checked() {
        let dir = TempDir::new("pre-epoch-mtime");
        let note = dir.file("Old.md", "# Old");
        let times = fs::FileTimes::new().set_modified(UNIX_EPOCH - Duration::from_secs(1));
        fs::OpenOptions::new()
            .write(true)
            .open(&note)
            .unwrap()
            .set_times(times)
            .unwrap();
        let candidate = DropCandidate {
            name: "Old.md".to_string(),
            size: 5,
            last_modified: Some(-1000.0),
        };
        let mismatched = DropCandidate {
            last_modified: Some(-60_000.0),
            ..candidate.clone()
        };

        assert_eq!(
            match_candidates(&[mismatched], std::slice::from_ref(&note), false),
            vec![None]
        );
        assert_eq!(
            match_candidates(&[candidate], std::slice::from_ref(&note), false),
            vec![Some(note)]
        );
    }

    #[test]
    fn a_missing_candidate_mtime_still_matches_name_and_size() {
        let dir = TempDir::new("no-reported-mtime");
        let note = dir.file("Note.md", "note");
        let candidate: DropCandidate =
            serde_json::from_str(r#"{"name":"Note.md","size":4}"#).unwrap();

        assert_eq!(
            match_candidates(&[candidate], std::slice::from_ref(&note), false),
            vec![Some(note)]
        );
    }

    #[cfg(unix)]
    #[test]
    fn linux_uri_admission_requires_mtime_within_one_millisecond() {
        let dir = TempDir::new("linux-mtime");
        let note = dir.file("Note.md", "note");
        let candidate = candidate_for(&note);
        let missing = DropCandidate {
            last_modified: None,
            ..candidate.clone()
        };
        let changed = DropCandidate {
            last_modified: candidate.last_modified.map(|time| time + 2.0),
            ..candidate.clone()
        };
        for offset in [-2.0, -1.0, 0.0, 1.0, 2.0] {
            let rounded = DropCandidate {
                last_modified: candidate.last_modified.map(|time| time + offset),
                ..candidate.clone()
            };
            assert_eq!(matches(&rounded, &note, true), offset.abs() <= 1.0);
        }
        let paths = parse_uri_list(tauri::Url::from_file_path(&note).unwrap().as_ref());
        let state = LooseFiles::default();
        let admitted = admit_candidates(&[missing, changed, candidate], &paths, true, |path| {
            state.admit_with(path, None, None)
        });
        assert_eq!(admitted[..2], [None, None]);
        assert!(admitted[2].is_some());
        assert_eq!(state.list_open(None).len(), 1);
    }

    #[test]
    fn admission_registers_only_matching_reported_markdown_files() {
        let dir = TempDir::new("admission");
        let note = dir.file("Note.md", "# Note");
        let stale = dir.file("Stale.md", "# Stale");
        let text = dir.file("Text.txt", "text");
        let wrong = DropCandidate {
            size: 100,
            ..candidate_for(&note)
        };
        let state = LooseFiles::default();

        let admissions = admit_candidates(
            &[wrong, candidate_for(&text), candidate_for(&note)],
            &[stale, text, note.clone()],
            false,
            |path| state.admit_with(path, None, None),
        );

        assert_eq!(admissions[..2], [None, None]);
        let Some(Admission::Loose { id, .. }) = &admissions[2] else {
            panic!("Matching file was not admitted");
        };
        assert_eq!(state.path_of(id).unwrap(), note);
        assert_eq!(state.list_open(None).len(), 1);
    }

    #[test]
    #[cfg(unix)]
    fn matching_a_symlink_does_not_bypass_loose_file_admission() {
        let dir = TempDir::new("link");
        let target = dir.file("Target.md", "# Target");
        let link = dir.0.join("Link.md");
        std::os::unix::fs::symlink(target, &link).unwrap();
        let state = LooseFiles::default();

        assert_eq!(
            admit_candidates(&[candidate_for(&link)], &[link], false, |path| {
                state.admit_with(path, None, None)
            }),
            vec![None]
        );
        assert!(state.list_open(None).is_empty());
    }

    #[test]
    fn a_different_size_name_or_time_is_not_the_dropped_file() {
        let dir = TempDir::new("mismatch");
        let note = dir.file("Read me.md", "# Hello");
        let paths = [note.clone()];
        let base = candidate_for(&note);

        let bigger = DropCandidate {
            size: base.size + 1,
            ..base.clone()
        };
        let renamed = DropCandidate {
            name: "Readme.md".to_string(),
            ..base.clone()
        };
        let older = DropCandidate {
            last_modified: base.last_modified.map(|time| time - 60_000.0),
            ..base.clone()
        };

        assert_eq!(
            match_candidates(&[bigger, renamed, older], &paths, false),
            vec![None, None, None]
        );
        assert_eq!(match_candidates(&[base], &paths, false), vec![Some(note)]);
    }

    #[test]
    fn a_path_no_dropped_file_matches_is_never_returned() {
        let dir = TempDir::new("stale");
        let dropped = dir.file("dropped.md", "# Dropped");
        let stale = dir.file("stale.md", "# Stale, from an earlier drag");
        let candidate = candidate_for(&dropped);
        fs::remove_file(&dropped).unwrap();

        assert_eq!(match_candidates(&[candidate], &[stale], false), vec![None]);
        assert_eq!(
            match_candidates(&[], &[dir.0.join("stale.md")], false),
            vec![]
        );
    }

    #[test]
    fn only_markdown_files_match() {
        let dir = TempDir::new("ext");
        let text = dir.file("notes.txt", "plain");
        let markdown = dir.file("NOTES.MARKDOWN", "# Notes");

        let matched = match_candidates(
            &[candidate_for(&text), candidate_for(&markdown)],
            &[text.clone(), markdown.clone()],
            false,
        );

        assert_eq!(matched, vec![None, Some(markdown)]);
    }

    #[test]
    fn two_dropped_files_with_the_same_name_take_one_path_each() {
        let dir = TempDir::new("twins");
        let first = dir.file("a/Same.md", "same");
        let second = dir.file("b/Same.md", "same");
        let candidate = candidate_for(&first);

        let matched = match_candidates(
            &[candidate.clone(), candidate.clone(), candidate],
            &[first.clone(), second.clone()],
            false,
        );

        assert_eq!(matched, vec![Some(first), Some(second), None]);
    }

    #[test]
    fn names_match_across_unicode_normalization() {
        let dir = TempDir::new("nfc");
        let note = dir.file("Cafe\u{301}.md", "# Café");
        let candidate = DropCandidate {
            name: "Caf\u{e9}.md".to_string(),
            ..candidate_for(&note)
        };

        assert_eq!(
            match_candidates(&[candidate], std::slice::from_ref(&note), false),
            vec![Some(note)]
        );
    }

    #[test]
    fn the_pasteboard_path_list_parses_absolute_paths_only() {
        let first = std::env::temp_dir().join("a.md");
        let second = std::env::temp_dir().join("b c.md");
        let json = serde_json::json!([first, "relative.md", second]).to_string();

        assert_eq!(parse_path_list(&json), vec![first, second]);
        assert!(parse_path_list("").is_empty());
        assert!(parse_path_list("not json").is_empty());
        assert!(parse_path_list(r#"{"error":"x"}"#).is_empty());
        assert!(parse_path_list("[1, 2]").is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn the_uri_list_keeps_file_urls_and_decodes_them() {
        let list = "# dropped from the file manager\r\n\
                    file:///home/me/My%20Notes/Caf%C3%A9.md\r\n\
                    https://example.com/a.md\r\n\
                    \r\n\
                    file://localhost/tmp/b.md\n\
                    file://otherhost/tmp/c.md\n";

        assert_eq!(
            parse_uri_list(list),
            vec![
                PathBuf::from("/home/me/My Notes/Café.md"),
                PathBuf::from("/tmp/b.md")
            ]
        );
    }

    #[test]
    #[cfg(unix)]
    fn a_uri_list_path_is_admitted_only_when_it_is_the_dropped_file() {
        let dir = TempDir::new("uri");
        let dropped = dir.file("Dropped note.md", "# Dropped");
        let elsewhere = dir.file("secret.md", "# Not dropped");
        let list = format!(
            "{}\n{}\n",
            tauri::Url::from_file_path(&elsewhere).unwrap(),
            tauri::Url::from_file_path(&dropped).unwrap()
        );

        let state = LooseFiles::default();
        let candidate = candidate_for(&dropped);
        let mismatched = DropCandidate {
            size: candidate.size + 1,
            ..candidate.clone()
        };
        let admitted = admit_candidates(
            &[mismatched, candidate],
            &parse_uri_list(&list),
            true,
            |path| state.admit_with(path, None, None),
        );

        assert_eq!(admitted[0], None);
        let Some(Admission::Loose { id, .. }) = &admitted[1] else {
            panic!("URI matching the dropped file was not admitted");
        };
        assert_eq!(state.path_of(id).unwrap(), dropped);
        assert_eq!(state.list_open(None).len(), 1);
    }

    #[test]
    fn a_drop_token_is_read_only_from_the_drop_message() {
        assert_eq!(
            drop_token(r#"{"moldaviteDrop":"0b8e7c1a-2f4d-4e55-9a10-3c2d1e0f9a8b"}"#),
            Some("0b8e7c1a-2f4d-4e55-9a10-3c2d1e0f9a8b".to_string())
        );
        for message in [
            r#""moldaviteDrop""#,
            r#"{"cmd":"read_note"}"#,
            r#"{"moldaviteDrop":""}"#,
            r#"{"moldaviteDrop":"../../etc"}"#,
            r#"{"moldaviteDrop":7}"#,
        ] {
            assert_eq!(drop_token(message), None, "{message}");
        }
        let long = format!(r#"{{"moldaviteDrop":"{}"}}"#, "a".repeat(65));
        assert_eq!(drop_token(&long), None);
    }

    #[test]
    fn a_drop_report_reaches_the_command_whichever_arrives_first() {
        let reports = std::sync::Arc::new(DropReports::default());
        reports.put("early".to_string(), vec![PathBuf::from("/a.md")]);
        assert_eq!(
            reports.take("early", Duration::ZERO),
            vec![PathBuf::from("/a.md")]
        );
        assert!(reports.take("early", Duration::ZERO).is_empty());

        let late = reports.clone();
        let waiter = std::thread::spawn(move || late.take("late", REPORT_WAIT));
        std::thread::sleep(Duration::from_millis(50));
        reports.put("late".to_string(), vec![PathBuf::from("/b.md")]);
        assert_eq!(waiter.join().unwrap(), vec![PathBuf::from("/b.md")]);

        assert!(reports.take("never", Duration::from_millis(10)).is_empty());
    }
}
