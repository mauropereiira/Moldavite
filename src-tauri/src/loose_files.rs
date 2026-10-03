//! Markdown files opened from outside the Forge and edited in place ("loose files").
//!
//! Open With, launch arguments and the open dialog supply paths from the OS.
//! Drops use the platform routes in `dropped_files`: Linux accepts page-supplied
//! URIs after a metadata check, a weaker boundary. Rust admits paths into a
//! session allowlist and hands the webview a random id. No command here takes
//! a path. Nothing is persisted.
//!
//! A save never re-serializes frontmatter, because the Forge save path reorders
//! YAML: the bytes before the body are kept exactly, and the body's line endings
//! and final newlines follow the file. A save whose base hash no longer matches
//! the file is refused and leaves it untouched; no conflict copy is ever written
//! into the user's folder.

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use rand::rngs::OsRng;
use rand::RngCore;
use serde::Serialize;
use tauri::State;

use crate::backlinks_index::BacklinksIndex;
use crate::commands::notes::sha256_hex;
use crate::note_file_access::{self, Access};
use crate::validation::is_safe_existing_note_path;

pub(crate) const MAX_LOOSE_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];
const MOVED: &str = "Moved";
const CONFLICT_PREFIX: &str = "conflict:";
const NOT_OPEN: &str = "This file is no longer open";
const READ_ONLY: &str = "This file is read-only";
const NOT_FOUND: &str = "The file could not be found";

#[derive(Clone)]
struct Entry {
    path: PathBuf,
    open: bool,
    opened: u64,
}

#[derive(Default)]
struct Registry {
    entries: HashMap<String, Entry>,
    by_path: HashMap<PathBuf, String>,
    next_opened: u64,
}

#[derive(Default)]
pub(crate) struct LooseFiles {
    registry: Mutex<Registry>,
    writes: Mutex<()>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Admission {
    ForgeNote {
        rel: String,
    },
    Loose {
        id: String,
        name: String,
        #[serde(rename = "dirDisplay")]
        dir_display: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LooseRead {
    body: String,
    hash: String,
    read_only: bool,
    name: String,
    dir_display: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LooseHash {
    hash: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenLooseFile {
    id: String,
    name: String,
    dir_display: String,
}

struct Inspected {
    path: PathBuf,
    raw: String,
    hash: String,
    mode: Option<u32>,
    read_only: bool,
}

pub(crate) fn has_markdown_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            MARKDOWN_EXTENSIONS
                .iter()
                .any(|allowed| extension.eq_ignore_ascii_case(allowed))
        })
}

fn read_capped(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| NOT_FOUND.to_string())?;
    let mut bytes = Vec::new();
    file.take(MAX_LOOSE_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_LOOSE_FILE_BYTES {
        return Err("The file is larger than 10 MB".to_string());
    }
    Ok(bytes)
}

#[cfg(unix)]
fn is_writable(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(path) = std::ffi::CString::new(path.as_os_str().as_bytes()) else {
        return false;
    };
    // SAFETY: `path` is a valid NUL-terminated string that outlives the call.
    unsafe { libc::access(path.as_ptr(), libc::W_OK) == 0 }
}

/// The parent must be writable too: the atomic save renames a new file into it.
/// A file owned by someone else is never replaced, since the rename would make
/// it ours.
#[cfg(unix)]
fn is_read_only(path: &Path, metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: `geteuid` has no preconditions and cannot fail.
    let uid = unsafe { libc::geteuid() };
    metadata.uid() != uid || !is_writable(path) || !path.parent().is_some_and(is_writable)
}

#[cfg(not(unix))]
fn is_read_only(_path: &Path, metadata: &fs::Metadata) -> bool {
    metadata.permissions().readonly()
}

#[cfg(unix)]
fn file_mode(metadata: &fs::Metadata) -> Option<u32> {
    use std::os::unix::fs::PermissionsExt;
    Some(metadata.permissions().mode() & 0o7777)
}

#[cfg(not(unix))]
fn file_mode(_metadata: &fs::Metadata) -> Option<u32> {
    None
}

fn read_canonical(canonical: &Path) -> Result<Inspected, String> {
    if !has_markdown_extension(canonical) {
        return Err("Only Markdown files can be opened".to_string());
    }
    let metadata = fs::symlink_metadata(canonical).map_err(|_| NOT_FOUND.to_string())?;
    if !metadata.is_file() {
        return Err("Only regular files can be opened".to_string());
    }
    if metadata.len() > MAX_LOOSE_FILE_BYTES {
        return Err("The file is larger than 10 MB".to_string());
    }
    let raw = String::from_utf8(read_capped(canonical)?)
        .map_err(|_| "The file is not UTF-8 text".to_string())?;
    Ok(Inspected {
        path: canonical.to_path_buf(),
        hash: sha256_hex(&raw),
        raw,
        mode: file_mode(&metadata),
        read_only: is_read_only(canonical, &metadata),
    })
}

/// A link is refused rather than followed: the user opened the link, and a
/// save would replace the file it points at somewhere else.
fn inspect(path: &Path) -> Result<Inspected, String> {
    let leaf = fs::symlink_metadata(path).map_err(|_| NOT_FOUND.to_string())?;
    if leaf.file_type().is_symlink() {
        return Err("Links to other files cannot be opened".to_string());
    }
    let canonical = dunce::canonicalize(path).map_err(|_| NOT_FOUND.to_string())?;
    read_canonical(&canonical)
}

fn strip_eol(line: &str) -> &str {
    let line = line.strip_suffix('\n').unwrap_or(line);
    line.strip_suffix('\r').unwrap_or(line)
}

/// Split a file into the bytes kept verbatim (a BOM and any `---` frontmatter
/// block, closing fence line included) and the body. Unclosed frontmatter is
/// body text, as in the Forge parser.
fn split_raw_frontmatter(raw: &str) -> (&str, &str) {
    let bom = if raw.starts_with('\u{feff}') {
        '\u{feff}'.len_utf8()
    } else {
        0
    };
    let mut lines = raw[bom..].split_inclusive('\n');
    let Some(first) = lines.next() else {
        return raw.split_at(bom);
    };
    if !first.ends_with('\n') || strip_eol(first) != "---" {
        return raw.split_at(bom);
    }
    let mut end = bom + first.len();
    for line in lines {
        end += line.len();
        if matches!(strip_eol(line), "---" | "...") {
            return raw.split_at(end);
        }
    }
    raw.split_at(bom)
}

fn uses_crlf(raw: &str) -> bool {
    raw.find('\n')
        .is_some_and(|index| index > 0 && raw.as_bytes()[index - 1] == b'\r')
}

/// The body as the editor sees it: frontmatter removed, line endings LF.
fn editor_body(raw: &str) -> String {
    split_raw_frontmatter(raw).1.replace("\r\n", "\n")
}

/// The file `raw` becomes with `body` in place of its own body.
fn compose(raw: &str, body: &str) -> String {
    let (prefix, old_body) = split_raw_frontmatter(raw);
    let old_body = old_body.replace("\r\n", "\n");
    let trailing_newlines = old_body.len() - old_body.trim_end_matches('\n').len();
    let body = body.replace("\r\n", "\n");
    let mut text = body.trim_end_matches('\n').to_string();
    if !text.is_empty() {
        text.push_str(&"\n".repeat(trailing_newlines));
    }
    if uses_crlf(raw) {
        text = text.replace('\n', "\r\n");
    }
    let separator = if !text.is_empty()
        && !prefix.is_empty()
        && prefix != "\u{feff}"
        && !prefix.ends_with('\n')
    {
        if uses_crlf(raw) {
            "\r\n"
        } else {
            "\n"
        }
    } else {
        ""
    };
    format!("{prefix}{separator}{text}")
}

/// Mode is set on the open file as well as at creation, because the creation
/// mode passes through the umask and would drop group or other bits it had.
fn write_preserving_mode(
    path: &Path,
    bytes: &[u8],
    mode: Option<u32>,
    preserve_xattrs: bool,
    before_rename: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    crate::persist::write_atomic_checked(
        path,
        mode.or(Some(0o600)),
        preserve_xattrs,
        |file| {
            file.write_all(bytes).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            if let Some(mode) = mode {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(fs::Permissions::from_mode(mode))
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        },
        before_rename,
    )
}

fn display_dir(dir: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home.and_then(|home| dunce::canonicalize(home).ok()) {
        if let Ok(rest) = dir.strip_prefix(&home) {
            return if rest.as_os_str().is_empty() {
                "~".to_string()
            } else {
                format!("~{}{}", std::path::MAIN_SEPARATOR, rest.display())
            };
        }
    }
    dir.display().to_string()
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn display_parent(path: &Path, home: Option<&Path>) -> String {
    path.parent()
        .map(|dir| display_dir(dir, home))
        .unwrap_or_default()
}

/// The Forge address of a note inside the active Forge, in the shape a
/// `moldavite://note/` link resolves: `notes/<path>`, `daily/<name>`, `weekly/<name>`.
fn forge_note_rel(canonical: &Path, forge_root: &Path) -> Option<String> {
    let root = dunce::canonicalize(forge_root).ok()?;
    let parts = canonical
        .strip_prefix(&root)
        .ok()?
        .components()
        .map(|component| component.as_os_str().to_str())
        .collect::<Option<Vec<_>>>()?;
    let (category, rest) = parts.split_first()?;
    let rest = rest.join("/");
    let addressable = match *category {
        "notes" => is_safe_existing_note_path(&rest),
        "daily" | "weekly" => !rest.contains('/') && is_safe_existing_note_path(&rest),
        _ => false,
    };
    (addressable && rest.ends_with(".md")).then(|| format!("{category}/{rest}"))
}

fn new_id() -> String {
    let mut bytes = [0u8; 16];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

impl LooseFiles {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Registry>, String> {
        self.registry
            .lock()
            .map_err(|_| "Loose-file registry poisoned".to_string())
    }

    pub(crate) fn admit_with(
        &self,
        path: &Path,
        forge_root: Option<&Path>,
        home: Option<&Path>,
    ) -> Result<Admission, String> {
        let inspected = inspect(path)?;
        if let Some(rel) = forge_root.and_then(|root| forge_note_rel(&inspected.path, root)) {
            return Ok(Admission::ForgeNote { rel });
        }
        let mut registry = self.lock()?;
        let id = registry
            .by_path
            .get(&inspected.path)
            .cloned()
            .unwrap_or_else(new_id);
        let opened = registry.next_opened;
        registry.next_opened += 1;
        registry.by_path.insert(inspected.path.clone(), id.clone());
        registry.entries.insert(
            id.clone(),
            Entry {
                path: inspected.path.clone(),
                open: true,
                opened,
            },
        );
        Ok(Admission::Loose {
            id,
            name: display_name(&inspected.path),
            dir_display: display_parent(&inspected.path, home),
        })
    }

    fn entry(&self, id: &str) -> Result<Entry, String> {
        self.lock()?
            .entries
            .get(id)
            .filter(|entry| entry.open)
            .cloned()
            .ok_or_else(|| NOT_OPEN.to_string())
    }

    pub(crate) fn path_of(&self, id: &str) -> Result<PathBuf, String> {
        Ok(self.entry(id)?.path)
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Entry)) {
        if let Ok(mut registry) = self.lock() {
            if let Some(entry) = registry.entries.get_mut(id) {
                change(entry);
            }
        }
    }

    /// A file renamed, deleted or swapped for a link since it was admitted no
    /// longer resolves to the admitted path.
    fn ensure_in_place(entry: &Entry) -> Result<(), String> {
        match dunce::canonicalize(&entry.path) {
            Ok(current) if current == entry.path => Ok(()),
            _ => Err(MOVED.to_string()),
        }
    }

    fn read_current(&self, id: &str) -> Result<(Entry, Inspected), String> {
        let entry = self.entry(id)?;
        Self::ensure_in_place(&entry)?;
        let inspected = read_canonical(&entry.path)?;
        Ok((entry, inspected))
    }

    pub(crate) fn read(&self, id: &str, home: Option<&Path>) -> Result<LooseRead, String> {
        let (entry, inspected) = self.read_current(id)?;
        Ok(LooseRead {
            body: editor_body(&inspected.raw),
            hash: inspected.hash,
            read_only: inspected.read_only,
            name: display_name(&entry.path),
            dir_display: display_parent(&entry.path, home),
        })
    }

    pub(crate) fn stat(&self, id: &str) -> Result<String, String> {
        Ok(self.read_current(id)?.1.hash)
    }

    fn writable_base(&self, id: &str, base_hash: &str) -> Result<(Entry, Inspected), String> {
        let (entry, disk) = self.read_current(id)?;
        if disk.hash != base_hash {
            return Err(format!("{CONFLICT_PREFIX}{}", disk.hash));
        }
        if disk.read_only {
            return Err(READ_ONLY.to_string());
        }
        Ok((entry, disk))
    }

    pub(crate) fn write(&self, id: &str, body: &str, base_hash: &str) -> Result<String, String> {
        let _guard = self
            .writes
            .lock()
            .map_err(|_| "Loose-file write lock poisoned".to_string())?;
        let (entry, disk) = self.writable_base(id, base_hash)?;
        let next = compose(&disk.raw, body);
        if next == disk.raw {
            return Ok(disk.hash);
        }
        write_preserving_mode(&entry.path, next.as_bytes(), disk.mode, true, || {
            self.writable_base(id, base_hash).map(|_| ())
        })?;
        Ok(sha256_hex(&next))
    }

    pub(crate) fn close(&self, id: &str) {
        self.update(id, |entry| entry.open = false);
    }

    pub(crate) fn list_open(&self, home: Option<&Path>) -> Vec<OpenLooseFile> {
        let Ok(registry) = self.lock() else {
            return Vec::new();
        };
        let mut open: Vec<(&String, &Entry)> = registry
            .entries
            .iter()
            .filter(|(_, entry)| entry.open)
            .collect();
        open.sort_by_key(|(_, entry)| entry.opened);
        open.into_iter()
            .map(|(id, entry)| OpenLooseFile {
                id: id.clone(),
                name: display_name(&entry.path),
                dir_display: display_parent(&entry.path, home),
            })
            .collect()
    }

    #[cfg(desktop)]
    fn copy_bytes(&self, id: &str, body: Option<&str>) -> Result<(String, Option<u32>), String> {
        let entry = self.entry(id)?;
        match read_canonical(&entry.path) {
            Ok(disk) => {
                let text = body.map_or_else(|| disk.raw.clone(), |body| compose(&disk.raw, body));
                Ok((text, disk.mode.map(|mode| mode | 0o200)))
            }
            Err(error) => body.map(|body| (body.to_string(), None)).ok_or(error),
        }
    }
}

/// The shared admission gate for Open With, launch arguments, the dialog and drops.
pub(crate) fn admit(state: &LooseFiles, path: &Path) -> Result<Admission, String> {
    let forge_root = crate::paths::get_notes_dir().ok();
    state.admit_with(path, forge_root.as_deref(), dirs::home_dir().as_deref())
}

pub(crate) fn file_url_path(url: &str) -> Option<PathBuf> {
    let url = tauri::Url::parse(url).ok()?;
    if url.scheme() != "file" {
        return None;
    }
    url.to_file_path().ok()
}

/// File paths and file URLs among launch arguments. Flags and other URL schemes
/// are skipped (those belong to the deep-link router); relative paths resolve against the launching
/// process's working directory, which for a second instance is not ours.
#[cfg(desktop)]
pub(crate) fn file_args<S: AsRef<str>>(argv: &[S], cwd: &Path) -> Vec<PathBuf> {
    argv.iter()
        .skip(1)
        .filter_map(|arg| {
            let arg = arg.as_ref();
            if arg.is_empty() || arg.starts_with('-') {
                return None;
            }
            if let Some(path) = file_url_path(arg) {
                return Some(path);
            }
            if arg.contains("://")
                && !Path::new(arg).is_absolute()
                && tauri::Url::parse(arg).is_ok()
            {
                return None;
            }
            let path = Path::new(arg);
            Some(if path.is_absolute() {
                path.to_path_buf()
            } else {
                cwd.join(path)
            })
        })
        .collect()
}

#[tauri::command]
pub(crate) fn read_loose_file(
    id: String,
    state: State<'_, LooseFiles>,
) -> Result<LooseRead, String> {
    let path = state.path_of(&id)?;
    note_file_access::transaction(&[Access::read(&path)], || {
        state.read(&id, dirs::home_dir().as_deref())
    })
}

/// A refused save returns `conflict:<hash of the file on disk>`.
#[tauri::command]
pub(crate) fn write_loose_file(
    id: String,
    body: String,
    base_hash: String,
    state: State<'_, LooseFiles>,
) -> Result<LooseHash, String> {
    let path = state.path_of(&id)?;
    note_file_access::transaction(&[Access::write(&path)], || {
        state
            .write(&id, &body, &base_hash)
            .map(|hash| LooseHash { hash })
    })
}

#[tauri::command]
pub(crate) fn stat_loose_file(
    id: String,
    state: State<'_, LooseFiles>,
) -> Result<LooseHash, String> {
    let path = state.path_of(&id)?;
    note_file_access::transaction(&[Access::read(&path)], || {
        state.stat(&id).map(|hash| LooseHash { hash })
    })
}

#[tauri::command]
pub(crate) fn close_loose_file(id: String, state: State<'_, LooseFiles>) {
    state.close(&id);
}

#[tauri::command]
pub(crate) fn list_open_loose_files(state: State<'_, LooseFiles>) -> Vec<OpenLooseFile> {
    state.list_open(dirs::home_dir().as_deref())
}

/// Copy the file as it is on disk into the active Forge's `notes/` under a
/// free name. Returns the new note's `notes/`-relative path.
#[tauri::command]
pub(crate) fn add_loose_to_forge(
    id: String,
    state: State<'_, LooseFiles>,
    index: State<'_, Arc<BacklinksIndex>>,
) -> Result<String, String> {
    let path = state.path_of(&id)?;
    let raw = note_file_access::transaction(&[Access::read(&path)], || {
        state.read_current(&id).map(|(_, disk)| disk.raw)
    })?;
    let stem = path
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    crate::commands::notes::create_note_with_content(&stem, &raw, &index)
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn open_loose_file_dialog(
    app: tauri::AppHandle,
) -> Result<Option<Admission>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    let picker = app
        .dialog()
        .file()
        .add_filter("Markdown", &MARKDOWN_EXTENSIONS);
    let picked = tauri::async_runtime::spawn_blocking(move || picker.blocking_pick_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || admit(&app.state::<LooseFiles>(), &path).map(Some))
        .await
        .map_err(|error| error.to_string())?
}

/// Returns the copy's file name, or `None` when the dialog was cancelled.
#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn save_loose_copy_dialog(
    app: tauri::AppHandle,
    id: String,
    body: Option<String>,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    use tauri_plugin_dialog::DialogExt;

    let (source, bytes, mode) = {
        let state = app.state::<LooseFiles>();
        let entry = state.entry(&id)?;
        let (bytes, mode) = state.copy_bytes(&id, body.as_deref())?;
        (entry.path, bytes, mode)
    };
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Untitled".to_string());
    let extension = source
        .extension()
        .map(|extension| extension.to_string_lossy().into_owned())
        .unwrap_or_else(|| "md".to_string());
    let mut picker = app
        .dialog()
        .file()
        .add_filter("Markdown", &MARKDOWN_EXTENSIONS)
        .set_file_name(format!("{stem} copy.{extension}"));
    if let Some(dir) = source.parent() {
        picker = picker.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || picker.blocking_save_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = picked.into_path().map_err(|error| error.to_string())?;
    if dunce::canonicalize(&destination).is_ok_and(|existing| existing == source) {
        return Err("Choose a different file for the copy".to_string());
    }
    write_preserving_mode(&destination, bytes.as_bytes(), mode, false, || Ok(()))?;
    Ok(Some(display_name(&destination)))
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) fn reveal_loose_file(id: String, state: State<'_, LooseFiles>) -> Result<(), String> {
    let path = state.path_of(&id)?;
    reveal(&path)
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<(), String> {
    std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open Finder: {error}"))
}

#[cfg(target_os = "windows")]
fn reveal(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // Explorer parses its own command line: the path must be quoted after the
    // comma, which Rust's argument quoting would not do.
    std::process::Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open Explorer: {error}"))
}

#[cfg(all(desktop, not(any(target_os = "macos", target_os = "windows"))))]
fn reveal(path: &Path) -> Result<(), String> {
    let dir = path.parent().ok_or_else(|| NOT_FOUND.to_string())?;
    std::process::Command::new("xdg-open")
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the folder: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "moldavite-loose-{tag}-{}-{}",
                std::process::id(),
                new_id()
            ));
            fs::create_dir_all(&dir).unwrap();
            Self(dunce::canonicalize(&dir).unwrap())
        }

        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(name);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(&path, contents).unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o755));
            }
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn loose_id(admission: Admission) -> String {
        match admission {
            Admission::Loose { id, .. } => id,
            other => panic!("expected a loose admission, got {other:?}"),
        }
    }

    fn admit_loose(files: &LooseFiles, path: &Path) -> String {
        loose_id(files.admit_with(path, None, None).unwrap())
    }

    #[test]
    fn admits_markdown_extensions_in_any_case() {
        let dir = TempDir::new("ext");
        let files = LooseFiles::default();
        for name in ["a.md", "b.MARKDOWN", "c.mdown", "d.Mkd"] {
            let path = dir.file(name, b"text");
            assert!(files.admit_with(&path, None, None).is_ok(), "{name}");
        }
    }

    #[test]
    fn refuses_other_extensions_and_locked_notes() {
        let dir = TempDir::new("reject-ext");
        let files = LooseFiles::default();
        for name in ["note.txt", "note.md.locked", "note"] {
            let path = dir.file(name, b"text");
            assert!(files.admit_with(&path, None, None).is_err(), "{name}");
        }
    }

    #[test]
    fn refuses_a_directory() {
        let dir = TempDir::new("dir");
        let folder = dir.0.join("folder.md");
        fs::create_dir_all(&folder).unwrap();
        assert!(LooseFiles::default()
            .admit_with(&folder, None, None)
            .is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_link_to_a_file_elsewhere() {
        let dir = TempDir::new("link");
        let elsewhere = TempDir::new("link-target");
        let target = elsewhere.file("real.md", b"secret");
        let link = dir.0.join("innocent.md");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert!(LooseFiles::default().admit_with(&link, None, None).is_err());
    }

    #[test]
    fn refuses_files_over_ten_megabytes() {
        let dir = TempDir::new("big");
        let path = dir.file("big.md", &vec![b'a'; MAX_LOOSE_FILE_BYTES as usize + 1]);
        let error = LooseFiles::default()
            .admit_with(&path, None, None)
            .unwrap_err();
        assert!(error.contains("10 MB"), "{error}");
    }

    #[test]
    fn refuses_text_that_is_not_utf8() {
        let dir = TempDir::new("utf8");
        let path = dir.file("latin1.md", b"caf\xe9");
        assert!(LooseFiles::default().admit_with(&path, None, None).is_err());
    }

    #[test]
    fn refuses_unknown_forged_and_closed_ids() {
        let dir = TempDir::new("ids");
        let files = LooseFiles::default();
        let id = admit_loose(&files, &dir.file("a.md", b"text"));
        assert!(files
            .read("0123456789abcdef0123456789abcdef", None)
            .is_err());
        assert!(files.write("../a.md", "x", "hash").is_err());
        files.close(&id);
        assert_eq!(files.read(&id, None).unwrap_err(), NOT_OPEN);
        assert!(files.list_open(None).is_empty());
    }

    #[test]
    fn readmitting_a_path_keeps_its_id_and_reopens_it() {
        let dir = TempDir::new("readmit");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"text");
        let id = admit_loose(&files, &path);
        files.close(&id);
        assert_eq!(admit_loose(&files, &path), id);
        assert_eq!(files.list_open(None).len(), 1);
    }

    #[cfg(all(desktop, not(windows)))]
    #[test]
    fn os_delivery_returns_while_admission_waits_and_delivers_afterward() {
        use std::sync::mpsc;
        use std::time::{Duration, Instant};
        use tauri::Manager;
        let dir = TempDir::new("async-admission");
        let path = dir.file("a.md", b"text");
        let app = tauri::test::mock_app();
        app.manage(LooseFiles::default());
        app.manage(crate::deep_link::PendingDeepLinks::default());
        let files = app.state::<LooseFiles>();
        let held = files.registry.lock().unwrap();
        let handle = app.handle().clone();
        let (sender, receiver) = mpsc::channel();
        let dispatch = std::thread::spawn(move || {
            crate::deep_link::route_paths(&handle, vec![path]);
            sender.send(()).unwrap();
        });
        let returned = receiver.recv_timeout(Duration::from_secs(2)).is_ok();
        drop(held);
        dispatch.join().unwrap();
        assert!(returned, "OS delivery blocked on admission");
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let requests = crate::deep_link::take_pending_deep_links(app.state());
            if !requests.is_empty() {
                assert!(matches!(
                    &requests[0],
                    crate::deep_link::DeepLinkRequest::LooseFile { .. }
                ));
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Admitted file was never delivered"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn ids_are_128_bit_hex() {
        let dir = TempDir::new("idshape");
        let id = admit_loose(&LooseFiles::default(), &dir.file("a.md", b"x"));
        assert_eq!(id.len(), 32);
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn a_renamed_file_reports_moved() {
        let dir = TempDir::new("moved");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"text");
        let id = admit_loose(&files, &path);
        fs::rename(&path, dir.0.join("b.md")).unwrap();
        assert_eq!(files.read(&id, None).unwrap_err(), MOVED);
        assert_eq!(files.stat(&id).unwrap_err(), MOVED);
        assert_eq!(files.write(&id, "x", "hash").unwrap_err(), MOVED);
    }

    #[test]
    fn a_stale_hash_is_a_conflict_and_leaves_the_file_untouched() {
        let dir = TempDir::new("conflict");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"original");
        let id = admit_loose(&files, &path);
        let base = files.read(&id, None).unwrap().hash;
        fs::write(&path, b"changed elsewhere").unwrap();
        let error = files.write(&id, "mine", &base).unwrap_err();
        assert_eq!(
            error,
            format!("{CONFLICT_PREFIX}{}", sha256_hex("changed elsewhere"))
        );
        assert_eq!(fs::read(&path).unwrap(), b"changed elsewhere");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn a_save_returns_the_hash_of_what_it_wrote() {
        let dir = TempDir::new("save");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"old\n");
        let id = admit_loose(&files, &path);
        let base = files.read(&id, None).unwrap().hash;
        let hash = files.write(&id, "new", &base).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "new\n");
        assert_eq!(hash, sha256_hex("new\n"));
        assert_eq!(files.stat(&id).unwrap(), hash);
    }

    #[cfg(unix)]
    #[test]
    fn a_save_keeps_the_file_mode() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("mode");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"old");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        let id = admit_loose(&files, &path);
        let base = files.read(&id, None).unwrap().hash;
        files.write(&id, "new", &base).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o7777;
        assert_eq!(mode, 0o644);
    }

    #[cfg(unix)]
    #[test]
    fn a_view_only_copy_keeps_disk_bytes_and_is_writable() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("copy-readonly");
        let files = LooseFiles::default();
        let raw = "\u{feff}---\r\ntitle: [bad\r\n---\r\n<div>Keep exactly</div>\r\n";
        let path = dir.file("source.md", raw.as_bytes());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        let id = admit_loose(&files, &path);
        let (bytes, mode) = files.copy_bytes(&id, None).unwrap();
        let copy = dir.0.join("copy.md");
        write_preserving_mode(&copy, bytes.as_bytes(), mode, false, || Ok(())).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), raw.as_bytes());
        assert_eq!(file_mode(&fs::metadata(&copy).unwrap()), Some(0o644));
        assert_eq!(file_mode(&fs::metadata(&path).unwrap()), Some(0o444));
        fs::remove_file(&path).unwrap();
        assert!(files.copy_bytes(&id, None).is_err());
        assert_eq!(
            files.copy_bytes(&id, Some("Recovered")).unwrap().0,
            "Recovered"
        );
    }

    #[test]
    fn an_external_change_during_the_temp_write_is_a_conflict_before_rename() {
        let dir = TempDir::new("late-conflict");
        let files = LooseFiles::default();
        let path = dir.file("a.md", b"old");
        let id = admit_loose(&files, &path);
        let base = files.read(&id, None).unwrap().hash;
        let error = crate::persist::write_atomic_checked(
            &path,
            None,
            true,
            |file| {
                file.write_all(b"mine").unwrap();
                fs::write(&path, "external").unwrap();
                Ok(())
            },
            || files.writable_base(&id, &base).map(|_| ()),
        )
        .unwrap_err();
        assert_eq!(
            error,
            format!("{CONFLICT_PREFIX}{}", sha256_hex("external"))
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn windows_admission_display_and_comparison_use_non_verbatim_paths() {
        let dir = TempDir::new("windows-path");
        let path = dir.file("a.md", b"old");
        let files = LooseFiles::default();
        let id = admit_loose(&files, &fs::canonicalize(&path).unwrap());
        assert!(!files
            .path_of(&id)
            .unwrap()
            .to_string_lossy()
            .starts_with(r"\\?\"));
        assert!(!files
            .read(&id, None)
            .unwrap()
            .dir_display
            .starts_with(r"\\?\"));
        assert_eq!(admit_loose(&files, &path), id);
        let read = files.read(&id, None).unwrap();
        files.write(&id, "new", &read.hash).unwrap();
    }

    #[test]
    fn invalid_frontmatter_bom_and_crlf_round_trip_byte_exact() {
        let raw =
            "\u{feff}---\r\ntitle: [unclosed\r\n  : : bad\r\n---\r\n# Heading\r\n\r\nBody text\r\n";
        let dir = TempDir::new("roundtrip");
        let files = LooseFiles::default();
        let path = dir.file("a.md", raw.as_bytes());
        let id = admit_loose(&files, &path);
        let read = files.read(&id, None).unwrap();
        assert_eq!(read.body, "# Heading\n\nBody text\n");
        files.write(&id, &read.body, &read.hash).unwrap();
        assert_eq!(fs::read(&path).unwrap(), raw.as_bytes());

        files.write(&id, "# Heading\n\nEdited", &read.hash).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "\u{feff}---\r\ntitle: [unclosed\r\n  : : bad\r\n---\r\n# Heading\r\n\r\nEdited\r\n"
        );
    }

    #[test]
    fn split_keeps_unclosed_frontmatter_in_the_body() {
        assert_eq!(
            split_raw_frontmatter("---\na: 1\nbody"),
            ("", "---\na: 1\nbody")
        );
        assert_eq!(
            split_raw_frontmatter("---\na: 1\n...\nbody"),
            ("---\na: 1\n...\n", "body")
        );
        assert_eq!(split_raw_frontmatter("\u{feff}body"), ("\u{feff}", "body"));
        assert_eq!(
            split_raw_frontmatter("--- \nbody\n---\n"),
            ("", "--- \nbody\n---\n")
        );
    }

    #[test]
    fn compose_follows_the_files_trailing_newlines() {
        assert_eq!(compose("a", "b\n"), "b");
        assert_eq!(compose("a\n\n", "b"), "b\n\n");
        assert_eq!(compose("---\nx: 1\n---\na\n", ""), "---\nx: 1\n---\n");
    }

    #[test]
    fn frontmatter_without_a_final_newline_gets_an_eol_before_new_text() {
        assert_eq!(
            compose("---\ntitle: x\n---", "Hello"),
            "---\ntitle: x\n---\nHello"
        );
        assert_eq!(
            compose("---\r\ntitle: x\r\n---", "Hello"),
            "---\r\ntitle: x\r\n---\r\nHello"
        );
        assert_eq!(compose("---\ntitle: x\n---", ""), "---\ntitle: x\n---");
        assert_eq!(compose("\u{feff}", "Hello"), "\u{feff}Hello");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_save_keeps_finder_tags_and_other_xattrs() {
        let dir = TempDir::new("xattrs");
        let files = LooseFiles::default();
        let path = dir.file("tagged.md", b"old");
        let tags = b"<?xml version=\"1.0\"?><plist version=\"1.0\"><array><string>Review\n6</string></array></plist>";
        for (name, value) in [
            ("com.apple.metadata:_kMDItemUserTags", tags.as_slice()),
            ("user.moldavite-test", b"keep".as_slice()),
        ] {
            xattr::set(&path, name, value).unwrap();
        }
        let id = admit_loose(&files, &path);
        let base = files.read(&id, None).unwrap().hash;
        files.write(&id, "new", &base).unwrap();
        for (name, expected) in [
            ("com.apple.metadata:_kMDItemUserTags", tags.as_slice()),
            ("user.moldavite-test", b"keep".as_slice()),
        ] {
            assert_eq!(xattr::get(&path, name).unwrap().unwrap(), expected);
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_file_or_folder_is_admitted_read_only_and_never_written() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new("readonly");
        let files = LooseFiles::default();

        let locked = dir.file("locked.md", b"text");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o444)).unwrap();
        let id = admit_loose(&files, &locked);
        let read = files.read(&id, None).unwrap();
        assert!(read.read_only);
        assert_eq!(files.write(&id, "x", &read.hash).unwrap_err(), READ_ONLY);
        assert_eq!(fs::read(&locked).unwrap(), b"text");

        let folder = TempDir::new("readonly-parent");
        let inside = folder.file("inside.md", b"text");
        fs::set_permissions(&folder.0, fs::Permissions::from_mode(0o555)).unwrap();
        let id = admit_loose(&files, &inside);
        assert!(files.read(&id, None).unwrap().read_only);
    }

    #[test]
    fn a_note_inside_the_active_forge_routes_as_a_forge_note() {
        let forge = TempDir::new("forge");
        let files = LooseFiles::default();
        let note = forge.file("notes/Projects/Plan.md", b"x");
        let daily = forge.file("daily/2026-01-02.md", b"x");
        let other = forge.file("templates/t.md", b"x");
        assert_eq!(
            files.admit_with(&note, Some(&forge.0), None).unwrap(),
            Admission::ForgeNote {
                rel: "notes/Projects/Plan.md".to_string()
            }
        );
        assert_eq!(
            files.admit_with(&daily, Some(&forge.0), None).unwrap(),
            Admission::ForgeNote {
                rel: "daily/2026-01-02.md".to_string()
            }
        );
        assert!(matches!(
            files.admit_with(&other, Some(&forge.0), None).unwrap(),
            Admission::Loose { .. }
        ));
    }

    #[test]
    fn the_folder_is_shown_relative_to_home() {
        let home = TempDir::new("home");
        let path = home.file("Documents/a.md", b"x");
        match LooseFiles::default()
            .admit_with(&path, None, Some(&home.0))
            .unwrap()
        {
            Admission::Loose {
                name, dir_display, ..
            } => {
                assert_eq!(name, "a.md");
                assert_eq!(
                    dir_display,
                    format!("~{}Documents", std::path::MAIN_SEPARATOR)
                );
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn launch_arguments_skip_flags_and_resolve_against_the_callers_folder() {
        let cwd = Path::new("/work/here");
        let argv = [
            "/Applications/Moldavite",
            "--safe-mode",
            "-psn_0_1234",
            "notes/today.md",
            "/abs/file.md",
            "moldavite://today",
            "",
        ];
        assert_eq!(
            file_args(&argv, cwd),
            vec![cwd.join("notes/today.md"), PathBuf::from("/abs/file.md")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn only_file_urls_can_supply_a_local_path() {
        for url in [
            "moldavite:///Users/x/diary.md",
            "moldavite://localhost/Users/x/diary.md",
        ] {
            assert_eq!(file_url_path(url), None, "{url}");
        }
        assert_eq!(
            file_url_path("file:///Users/x/diary.md"),
            Some(PathBuf::from("/Users/x/diary.md"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn launch_arguments_keep_relative_colon_filenames() {
        assert_eq!(
            file_args(&["app", "Meeting: notes.md"], Path::new("/work")),
            vec![PathBuf::from("/work/Meeting: notes.md")]
        );
    }

    #[cfg(unix)]
    #[test]
    fn launch_arguments_accept_file_urls() {
        assert_eq!(
            file_args(
                &[
                    "app",
                    "file:///tmp/a%20b.md",
                    "file:///tmp/caf%C3%A9.md",
                    "https://example.com/a.md",
                    "file://remote/share.md"
                ],
                Path::new("/")
            ),
            vec![PathBuf::from("/tmp/a b.md"), PathBuf::from("/tmp/café.md")]
        );
    }
}
