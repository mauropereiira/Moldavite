//! Plugin system backend: enumerate, uninstall, and install-example plugins
//! living under the active Forge's `.plugins/` directory. Plugin source
//! crosses the backend boundary only in the same snapshot as its consent
//! hash.
//!
//! Plugin ids and relative asset paths are untrusted. Resolution remains inside
//! the canonical `.plugins` root with directory and leaf symlinks rejected;
//! content hashes bind consent to the exact manifest and code bytes returned to
//! the frontend. Secrets are namespaced by plugin id in the macOS Keychain and
//! are never returned across a different plugin identity.

use crate::validation::is_valid_plugin_id;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::paths::get_notes_dir;
use crate::persist::write_atomic;
use crate::secrets::{KeychainSecretStore, SecretStore};
use crate::validation::validate_path_within_base;

/// Absolute path to the active Forge's `.plugins` directory.
pub(crate) fn plugins_dir() -> Result<PathBuf, String> {
    Ok(get_notes_dir()?.join(".plugins"))
}

fn is_valid_secret_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key.chars().enumerate().all(|(index, c)| {
            c.is_ascii_alphanumeric() || (index > 0 && matches!(c, '.' | '_' | '-'))
        })
}

fn secret_account(plugin_id: &str, key: &str) -> Result<String, String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err("invalid plugin id".into());
    }
    if !is_valid_secret_key(key) {
        return Err("invalid secret key".into());
    }
    Ok(format!("plugin:{plugin_id}:{key}"))
}

/// The credential store cannot list a service's accounts, so the keys each
/// plugin stored are recorded here, one per line, for uninstall to find. Keys
/// are validated, so none contains a newline.
fn key_list_account(plugin_id: &str) -> String {
    format!("plugin-keys:{plugin_id}")
}

/// Serializes the read-modify-write of a key list across command threads.
static KEY_LIST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn stored_keys(store: &impl SecretStore, plugin_id: &str) -> Result<Vec<String>, String> {
    Ok(store
        .get(&key_list_account(plugin_id))?
        .unwrap_or_default()
        .lines()
        .filter(|key| is_valid_secret_key(key))
        .map(str::to_string)
        .collect())
}

fn update_key_list(
    store: &impl SecretStore,
    plugin_id: &str,
    key: &str,
    present: bool,
) -> Result<(), String> {
    let _guard = KEY_LIST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut keys = stored_keys(store, plugin_id)?;
    if keys.iter().any(|stored| stored == key) == present {
        return Ok(());
    }
    keys.retain(|stored| stored != key);
    if present {
        keys.push(key.to_string());
    }
    if keys.is_empty() {
        store.delete(&key_list_account(plugin_id))
    } else {
        store.set(&key_list_account(plugin_id), &keys.join("\n"))
    }
}

fn secret_get_with(
    store: &impl SecretStore,
    plugin_id: &str,
    key: &str,
) -> Result<Option<String>, String> {
    let value = store.get(&secret_account(plugin_id, key)?)?;
    // A secret stored before keys were recorded joins the list the first time
    // its plugin reads it.
    if value.is_some() {
        if let Err(error) = update_key_list(store, plugin_id, key, true) {
            log::warn!("[plugins] could not record a secret key for {plugin_id}: {error}");
        }
    }
    Ok(value)
}

fn secret_set_with(
    store: &impl SecretStore,
    plugin_id: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    let account = secret_account(plugin_id, key)?;
    update_key_list(store, plugin_id, key, true)?;
    store.set(&account, value)
}

fn secret_delete_with(store: &impl SecretStore, plugin_id: &str, key: &str) -> Result<(), String> {
    store.delete(&secret_account(plugin_id, key)?)?;
    update_key_list(store, plugin_id, key, false)
}

/// Every secret the plugin stored, then the list itself.
fn delete_plugin_secrets_with(store: &impl SecretStore, plugin_id: &str) -> Result<(), String> {
    for key in stored_keys(store, plugin_id)? {
        store.delete(&secret_account(plugin_id, &key)?)?;
    }
    store.delete(&key_list_account(plugin_id))
}

/// Secrets are keyed by plugin id alone, so a copy of the plugin in another
/// Forge reads the same ones and must keep them.
fn installed_in_another_forge(id: &str, plugins_dir: &Path, forges: &[PathBuf]) -> bool {
    let here = plugins_dir.canonicalize().ok();
    forges.iter().any(|forge| {
        let dir = forge.join(".plugins");
        !forge.as_os_str().is_empty() && dir.canonicalize().ok() != here && dir.join(id).is_dir()
    })
}

#[tauri::command]
pub(crate) fn plugin_secret_get(plugin_id: String, key: String) -> Result<Option<String>, String> {
    secret_get_with(&KeychainSecretStore, &plugin_id, &key)
}

#[tauri::command]
pub(crate) fn plugin_secret_set(
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    secret_set_with(&KeychainSecretStore, &plugin_id, &key, &value)
}

#[tauri::command]
pub(crate) fn plugin_secret_delete(plugin_id: String, key: String) -> Result<(), String> {
    secret_delete_with(&KeychainSecretStore, &plugin_id, &key)
}

fn canonical_real_directory(path: &Path) -> Option<PathBuf> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return None;
    }
    path.canonicalize().ok()
}

/// Resolve a file used by plugin enumeration without trusting lexical path
/// containment, which would follow a plugin-directory symlink outside the Forge.
fn resolve_installed_plugin_file_in(base: &Path, id: &str, rel: &str) -> Option<PathBuf> {
    if !is_valid_plugin_id(id) || !matches!(rel, "manifest.json" | "plugin.js") {
        return None;
    }

    let canonical_root = canonical_real_directory(base)?;
    let plugin_base = base.join(id);
    let canonical_plugin_base = canonical_real_directory(&plugin_base)?;
    if !canonical_plugin_base.starts_with(&canonical_root) {
        return None;
    }

    let candidate = plugin_base.join(rel);
    let candidate_metadata = fs::symlink_metadata(&candidate).ok()?;
    if candidate_metadata.file_type().is_symlink() || !candidate_metadata.is_file() {
        return None;
    }

    let canonical_candidate = candidate.canonicalize().ok()?;
    if !canonical_candidate.starts_with(&canonical_root)
        || !canonical_candidate.starts_with(&canonical_plugin_base)
    {
        None
    } else {
        Some(canonical_candidate)
    }
}

/// Raw per-plugin data returned to the frontend, which owns manifest
/// validation (single source of truth in `src/lib/plugins/manifest.ts`).
#[derive(Serialize)]
pub(crate) struct RawPlugin {
    pub id: String,
    #[serde(rename = "manifestRaw")]
    pub manifest_raw: Option<serde_json::Value>,
    #[serde(rename = "readError")]
    pub read_error: Option<String>,
    /// SHA-256 over the exact manifest.json and plugin.js bytes in this record.
    #[serde(rename = "contentHash")]
    pub content_hash: Option<String>,
    /// UTF-8 plugin.js source read once and hashed before this record is built.
    pub code: Option<String>,
}

struct PluginSnapshot {
    manifest_raw: serde_json::Value,
    content_hash: String,
    code: String,
}

fn plugin_content_hash_bytes(manifest: &[u8], code: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(manifest);
    hasher.update([0u8]); // domain separator between the two files
    hasher.update(code);
    format!("{:x}", hasher.finalize())
}

fn read_plugin_snapshot_in(base: &Path, id: &str) -> Result<PluginSnapshot, String> {
    let manifest_path = resolve_installed_plugin_file_in(base, id, "manifest.json")
        .ok_or_else(|| "no manifest.json: missing, unreadable, or unsafe path".to_string())?;
    let code_path = resolve_installed_plugin_file_in(base, id, "plugin.js")
        .ok_or_else(|| "no plugin.js: missing, unreadable, or unsafe path".to_string())?;
    let manifest =
        fs::read(manifest_path).map_err(|e| format!("cannot read manifest.json: {e}"))?;
    let code_bytes = fs::read(code_path).map_err(|e| format!("cannot read plugin.js: {e}"))?;
    let content_hash = plugin_content_hash_bytes(&manifest, &code_bytes);
    let code = String::from_utf8(code_bytes)
        .map_err(|_| "invalid plugin.js: source is not UTF-8".to_string())?;
    let manifest_raw =
        serde_json::from_slice(&manifest).map_err(|e| format!("invalid manifest.json: {e}"))?;

    Ok(PluginSnapshot {
        manifest_raw,
        content_hash,
        code,
    })
}

#[cfg(test)]
fn plugin_content_hash(plugin_dir: &Path) -> Option<String> {
    let id = plugin_dir.file_name()?.to_str()?;
    let base = plugin_dir.parent()?;
    read_plugin_snapshot_in(base, id)
        .ok()
        .map(|snapshot| snapshot.content_hash)
}

fn list_plugins_in(dir: &Path) -> Vec<RawPlugin> {
    let mut out = Vec::new();
    if canonical_real_directory(dir).is_none() {
        return out;
    }
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return out,
    };
    for entry in entries.flatten() {
        let id = entry.file_name().to_string_lossy().to_string();
        if !is_valid_plugin_id(&id) {
            continue;
        }
        match read_plugin_snapshot_in(dir, &id) {
            Ok(snapshot) => out.push(RawPlugin {
                id,
                manifest_raw: Some(snapshot.manifest_raw),
                read_error: None,
                content_hash: Some(snapshot.content_hash),
                code: Some(snapshot.code),
            }),
            Err(error) => out.push(RawPlugin {
                id,
                manifest_raw: None,
                read_error: Some(error),
                content_hash: None,
                code: None,
            }),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out
}

#[tauri::command]
pub(crate) fn list_plugins() -> Result<Vec<RawPlugin>, String> {
    Ok(list_plugins_in(&plugins_dir()?))
}

#[tauri::command]
pub(crate) fn uninstall_plugin(id: String) -> Result<(), String> {
    if !is_valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    let base = plugins_dir()?;
    let target = base.join(&id);
    validate_path_within_base(&target, &base)
        .map_err(|_| "refusing to delete outside the plugins directory".to_string())?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("failed to uninstall: {e}"))?;
    }
    // An unreadable Forge list keeps the secrets rather than risk another
    // Forge's copy of the plugin losing them.
    let elsewhere = match crate::commands::forges::list_forges() {
        Ok(forges) => {
            let paths: Vec<PathBuf> = forges.into_iter().map(|f| PathBuf::from(f.path)).collect();
            installed_in_another_forge(&id, &base, &paths)
        }
        Err(_) => true,
    };
    if !elsewhere {
        if let Err(error) = delete_plugin_secrets_with(&KeychainSecretStore, &id) {
            log::warn!("[plugins] could not delete the secrets of {id}: {error}");
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct InstallManifestIdentity {
    id: String,
}

struct PluginFiles<'a> {
    manifest_json: &'a [u8],
    plugin_js: &'a [u8],
    readme: Option<&'a [u8]>,
}

pub(crate) const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
pub(crate) const MAX_PLUGIN_JS_BYTES: u64 = 10 * 1024 * 1024;

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(bytes))
}

fn verify_registry_hash(file_name: &str, bytes: &[u8], expected: &str) -> Result<(), String> {
    let valid_expected =
        expected.len() == 64 && expected.bytes().all(|byte| byte.is_ascii_hexdigit());
    if !valid_expected || !sha256_hex(bytes).eq_ignore_ascii_case(expected) {
        return Err(format!(
            "Security check failed: {file_name} didn't match the registry — not installed"
        ));
    }
    Ok(())
}

fn validate_install_files(plugin_id: &str, files: &PluginFiles<'_>) -> Result<(), String> {
    if !is_valid_plugin_id(plugin_id) {
        return Err("invalid plugin id".into());
    }
    let manifest: InstallManifestIdentity = serde_json::from_slice(files.manifest_json)
        .map_err(|e| format!("invalid plugin manifest: {e}"))?;
    if manifest.id != plugin_id {
        return Err(format!(
            "plugin manifest id {} does not match requested id {plugin_id}",
            manifest.id
        ));
    }
    Ok(())
}

fn plugin_install_paths(parent: &Path, plugin_id: &str) -> (PathBuf, PathBuf) {
    (
        parent.join(format!(".{plugin_id}.installing")),
        parent.join(format!(".{plugin_id}.previous")),
    )
}

fn remove_install_artifact(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
    .map_err(|e| format!("cannot clean plugin install artifact: {e}"))
}

/// Validate and stage the complete file set before one same-parent rename makes
/// it visible. Bundled and community installs both pass through this helper.
fn install_plugin_files(
    dest: &Path,
    plugin_id: &str,
    files: PluginFiles<'_>,
    confirm_update: bool,
) -> Result<(), String> {
    validate_install_files(plugin_id, &files)?;

    let parent = dest
        .parent()
        .ok_or_else(|| "plugin destination has no parent directory".to_string())?;
    if dest != parent.join(plugin_id) {
        return Err("plugin destination does not match plugin id".into());
    }
    fs::create_dir_all(parent).map_err(|e| format!("cannot create plugins directory: {e}"))?;
    validate_path_within_base(dest, parent)
        .map_err(|_| "refusing to install outside the plugins directory".to_string())?;

    let installed = match fs::symlink_metadata(dest) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => true,
        Ok(_) => return Err("plugin destination is not a safe directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("cannot inspect plugin destination: {error}")),
    };
    if installed && !confirm_update {
        return Err(format!(
            "{plugin_id} is already installed; confirm the update before replacing it"
        ));
    }

    let (staging, previous) = plugin_install_paths(parent, plugin_id);
    remove_install_artifact(&staging)?;
    if fs::symlink_metadata(&previous).is_ok() {
        if installed {
            remove_install_artifact(&previous)?;
        } else {
            fs::rename(&previous, dest)
                .map_err(|e| format!("cannot restore previous plugin install: {e}"))?;
            return Err(format!(
                "recovered a previous {plugin_id} install; confirm the update again"
            ));
        }
    }

    let install_result = (|| {
        fs::create_dir(&staging).map_err(|e| format!("cannot create plugin staging dir: {e}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&staging, fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("cannot secure plugin staging dir: {e}"))?;
        }
        write_atomic(
            &staging.join("manifest.json"),
            files.manifest_json,
            Some(0o600),
        )
        .map_err(|e| format!("write manifest.json failed: {e}"))?;
        write_atomic(&staging.join("plugin.js"), files.plugin_js, Some(0o600))
            .map_err(|e| format!("write plugin.js failed: {e}"))?;
        if let Some(readme) = files.readme {
            write_atomic(&staging.join("README.md"), readme, Some(0o600))
                .map_err(|e| format!("write README.md failed: {e}"))?;
        }

        if installed {
            fs::rename(dest, &previous)
                .map_err(|e| format!("cannot stage previous plugin version: {e}"))?;
        }
        if let Err(error) = fs::rename(&staging, dest) {
            if installed {
                let _ = fs::rename(&previous, dest);
            }
            return Err(format!("cannot finish plugin install: {error}"));
        }
        if installed {
            if let Err(error) = remove_install_artifact(&previous) {
                log::warn!("could not remove previous plugin version: {error}");
            }
        }
        Ok(())
    })();

    if install_result.is_err() {
        remove_install_artifact(&staging).ok();
    }
    install_result
}

fn copy_plugin_files(src: &Path, dest: &Path, plugin_id: &str) -> Result<(), String> {
    let manifest_json = fs::read(src.join("manifest.json")).map_err(|e| {
        format!(
            "bundled plugin source is missing manifest.json: {} ({e})",
            src.join("manifest.json").display()
        )
    })?;
    let plugin_js = fs::read(src.join("plugin.js")).map_err(|e| {
        format!(
            "bundled plugin source is missing plugin.js: {} ({e})",
            src.join("plugin.js").display()
        )
    })?;
    let readme = fs::read(src.join("README.md")).ok();
    install_plugin_files(
        dest,
        plugin_id,
        PluginFiles {
            manifest_json: &manifest_json,
            plugin_js: &plugin_js,
            readme: readme.as_deref(),
        },
        false,
    )
}

fn bundled_plugin_source(app: &tauri::AppHandle, resource_name: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    let bundled = app
        .path()
        .resolve(resource_name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("cannot locate bundled plugin: {e}"))?;

    if bundled.join("manifest.json").is_file() {
        return Ok(bundled);
    }

    // A running `tauri dev` process can have a stale target/debug resource
    // tree when a new resource directory is added. Production must only use
    // the app bundle; debug builds can safely fall back to the source tree.
    #[cfg(debug_assertions)]
    {
        let source_tree = Path::new(env!("CARGO_MANIFEST_DIR")).join(resource_name);
        if source_tree.join("manifest.json").is_file() {
            return Ok(source_tree);
        }
    }

    Ok(bundled)
}

fn install_bundled_plugin(
    app: &tauri::AppHandle,
    resource_name: &str,
    plugin_id: &str,
) -> Result<(), String> {
    let src = bundled_plugin_source(app, resource_name)?;
    let dest = plugins_dir()?.join(plugin_id);
    copy_plugin_files(&src, &dest, plugin_id)
}

#[tauri::command]
pub(crate) fn install_example_plugin(app: tauri::AppHandle) -> Result<(), String> {
    install_bundled_plugin(
        &app,
        "example-plugin/moldavite-example",
        "moldavite-example",
    )
}

#[tauri::command]
pub(crate) fn install_wordpress_plugin(app: tauri::AppHandle) -> Result<(), String> {
    install_bundled_plugin(
        &app,
        "example-plugin/moldavite-wordpress",
        "moldavite-wordpress",
    )
}

/// Install bytes fetched by an explicit frontend registry action. Network URLs
/// never cross this boundary; both files must match the registry's digests
/// before the shared staged installer performs any filesystem mutation.
#[tauri::command]
pub(crate) fn install_plugin_from_data(
    id: String,
    manifest_json: String,
    plugin_js: String,
    expected_manifest_sha256: String,
    expected_plugin_sha256: String,
    confirm_update: bool,
) -> Result<(), String> {
    if !is_valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    if manifest_json.len() as u64 > MAX_MANIFEST_BYTES
        || plugin_js.len() as u64 > MAX_PLUGIN_JS_BYTES
    {
        return Err("plugin files exceed the safe install size limit".into());
    }
    verify_registry_hash(
        "manifest.json",
        manifest_json.as_bytes(),
        &expected_manifest_sha256,
    )?;
    verify_registry_hash("plugin.js", plugin_js.as_bytes(), &expected_plugin_sha256)?;

    install_plugin_files(
        &plugins_dir()?.join(&id),
        &id,
        PluginFiles {
            manifest_json: manifest_json.as_bytes(),
            plugin_js: plugin_js.as_bytes(),
            readme: None,
        },
        confirm_update,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemorySecretStore(RefCell<HashMap<String, String>>);

    impl SecretStore for MemorySecretStore {
        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self.0.borrow().get(account).cloned())
        }

        fn set(&self, account: &str, value: &str) -> Result<(), String> {
            self.0.borrow_mut().insert(account.into(), value.into());
            Ok(())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.0.borrow_mut().remove(account);
            Ok(())
        }
    }

    #[test]
    fn accepts_valid_ids() {
        assert!(is_valid_plugin_id("moldavite-example"));
        assert!(is_valid_plugin_id("abc123"));
        assert!(is_valid_plugin_id("a"));
    }

    #[test]
    fn rejects_invalid_ids() {
        assert!(!is_valid_plugin_id(""));
        assert!(!is_valid_plugin_id("-lead"));
        assert!(!is_valid_plugin_id("Upper"));
        assert!(!is_valid_plugin_id("has space"));
        assert!(!is_valid_plugin_id("../etc"));
        assert!(!is_valid_plugin_id("under_score"));
        assert!(!is_valid_plugin_id(&"a".repeat(65)));
    }

    #[cfg(unix)]
    #[test]
    fn installed_plugin_resolution_is_scoped_and_rejects_symlinks() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-resolution-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let base = root.join(".plugins");
        let first = base.join("first-plugin");
        let second = base.join("second-plugin");
        let symlinked = base.join("symlinked-plugin");
        fs::create_dir_all(&first).unwrap();
        fs::create_dir_all(&second).unwrap();
        fs::create_dir_all(&symlinked).unwrap();
        fs::write(first.join("plugin.js"), "first").unwrap();
        fs::write(first.join("README.md"), "not executable").unwrap();
        fs::write(second.join("plugin.js"), "second").unwrap();
        let outside = root.join("outside.js");
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, symlinked.join("plugin.js")).unwrap();
        let outside_plugin = root.join("outside-plugin");
        fs::create_dir_all(&outside_plugin).unwrap();
        fs::write(outside_plugin.join("plugin.js"), "outside plugin").unwrap();
        symlink(&outside_plugin, base.join("directory-link")).unwrap();

        assert_eq!(
            resolve_installed_plugin_file_in(&base, "first-plugin", "plugin.js"),
            Some(first.join("plugin.js").canonicalize().unwrap())
        );
        assert!(resolve_installed_plugin_file_in(
            &base,
            "first-plugin",
            "../second-plugin/plugin.js"
        )
        .is_none());
        assert!(resolve_installed_plugin_file_in(&base, "symlinked-plugin", "plugin.js").is_none());
        assert!(resolve_installed_plugin_file_in(&base, "directory-link", "plugin.js").is_none());
        assert!(resolve_installed_plugin_file_in(&base, "first-plugin", "README.md").is_none());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_hash_verification_accepts_exact_bytes_and_rejects_mismatches() {
        let bytes = b"registry payload";
        let expected = sha256_hex(bytes);
        assert!(verify_registry_hash("plugin.js", bytes, &expected).is_ok());

        let error = verify_registry_hash("plugin.js", b"changed payload", &expected).unwrap_err();
        assert_eq!(
            error,
            "Security check failed: plugin.js didn't match the registry — not installed"
        );
        assert!(verify_registry_hash("plugin.js", bytes, "not-a-sha256").is_err());
    }

    #[test]
    fn data_install_validation_rejects_invalid_and_mismatched_ids_before_staging() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-id-validation-test-{}",
            std::process::id()
        ));
        fs::remove_dir_all(&root).ok();
        let files = PluginFiles {
            manifest_json: br#"{"id":"safe-plugin"}"#,
            plugin_js: b"export default () => {};",
            readme: None,
        };

        let invalid_dest = root.join("plugins/../escape");
        assert!(install_plugin_files(&invalid_dest, "../escape", files, false).is_err());
        assert!(
            !root.exists(),
            "invalid ids must fail before creating staging paths"
        );

        let mismatched = PluginFiles {
            manifest_json: br#"{"id":"other-plugin"}"#,
            plugin_js: b"export default () => {};",
            readme: None,
        };
        let error = validate_install_files("safe-plugin", &mismatched).unwrap_err();
        assert!(error.contains("does not match requested id"));
    }

    #[test]
    fn staging_and_recovery_paths_are_hidden_siblings_of_the_destination() {
        let parent = Path::new("/forge/.plugins");
        let (staging, previous) = plugin_install_paths(parent, "safe-plugin");
        assert_eq!(staging, parent.join(".safe-plugin.installing"));
        assert_eq!(previous, parent.join(".safe-plugin.previous"));
    }

    #[test]
    fn secret_accounts_validate_and_namespace_plugin_ids() {
        assert_eq!(
            secret_account("publisher", "api-token").unwrap(),
            "plugin:publisher:api-token"
        );
        assert!(secret_account("../publisher", "api-token").is_err());
        assert!(secret_account("publisher", "").is_err());
        assert!(secret_account("publisher", "bad:key").is_err());
    }

    #[test]
    fn secret_commands_are_isolated_by_plugin_id() {
        let store = MemorySecretStore::default();
        secret_set_with(&store, "plugin-a", "token", "alpha").unwrap();
        secret_set_with(&store, "plugin-b", "token", "beta").unwrap();
        assert_eq!(
            secret_get_with(&store, "plugin-a", "token")
                .unwrap()
                .as_deref(),
            Some("alpha")
        );
        assert_eq!(
            secret_get_with(&store, "plugin-b", "token")
                .unwrap()
                .as_deref(),
            Some("beta")
        );
        secret_delete_with(&store, "plugin-a", "token").unwrap();
        assert_eq!(secret_get_with(&store, "plugin-a", "token").unwrap(), None);
        assert_eq!(
            secret_get_with(&store, "plugin-b", "token")
                .unwrap()
                .as_deref(),
            Some("beta")
        );
    }

    #[test]
    fn deleting_a_plugins_secrets_removes_every_key_it_stored_and_no_other() {
        let store = MemorySecretStore::default();
        secret_set_with(&store, "plugin-a", "token", "alpha").unwrap();
        secret_set_with(&store, "plugin-a", "config.v2", "{}").unwrap();
        secret_set_with(&store, "plugin-a", "token", "alpha again").unwrap();
        secret_set_with(&store, "plugin-b", "token", "beta").unwrap();

        delete_plugin_secrets_with(&store, "plugin-a").unwrap();

        assert_eq!(secret_get_with(&store, "plugin-a", "token").unwrap(), None);
        assert_eq!(
            secret_get_with(&store, "plugin-a", "config.v2").unwrap(),
            None
        );
        assert_eq!(
            secret_get_with(&store, "plugin-b", "token")
                .unwrap()
                .as_deref(),
            Some("beta")
        );
        let left: Vec<String> = store.0.borrow().keys().cloned().collect();
        assert!(
            left.iter().all(|account| !account.contains("plugin-a")),
            "{left:?}"
        );
    }

    #[test]
    fn a_secret_stored_before_keys_were_recorded_is_deleted_once_it_has_been_read() {
        let store = MemorySecretStore::default();
        store
            .set("plugin:plugin-a:legacy", "old app password")
            .unwrap();
        assert_eq!(
            secret_get_with(&store, "plugin-a", "legacy")
                .unwrap()
                .as_deref(),
            Some("old app password")
        );
        delete_plugin_secrets_with(&store, "plugin-a").unwrap();
        assert!(store.0.borrow().is_empty());
    }

    #[test]
    fn a_deleted_secret_leaves_the_key_list() {
        let store = MemorySecretStore::default();
        secret_set_with(&store, "plugin-a", "token", "alpha").unwrap();
        secret_delete_with(&store, "plugin-a", "token").unwrap();
        assert!(stored_keys(&store, "plugin-a").unwrap().is_empty());
    }

    #[test]
    fn many_keys_across_many_plugins_are_all_tracked() {
        let store = MemorySecretStore::default();
        for plugin in 0..20 {
            for key in 0..50 {
                secret_set_with(&store, &format!("p{plugin}"), &format!("k{key}"), "v").unwrap();
            }
        }
        for plugin in 0..20 {
            delete_plugin_secrets_with(&store, &format!("p{plugin}")).unwrap();
            let left = store.0.borrow().len();
            assert_eq!(left, (19 - plugin) * 51);
        }
    }

    #[test]
    fn secrets_stay_while_another_forge_has_the_plugin_installed() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-forges-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let here = root.join("Here");
        let there = root.join("There");
        fs::create_dir_all(here.join(".plugins/shared")).unwrap();
        fs::create_dir_all(there.join(".plugins/shared")).unwrap();
        fs::create_dir_all(here.join(".plugins/only-here")).unwrap();
        let forges = vec![here.clone(), there.clone(), PathBuf::new()];

        assert!(installed_in_another_forge(
            "shared",
            &here.join(".plugins"),
            &forges
        ));
        assert!(!installed_in_another_forge(
            "only-here",
            &here.join(".plugins"),
            &forges
        ));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn consent_hash_changes_when_allowed_hosts_change() {
        let dir =
            std::env::temp_dir().join(format!("moldavite-plugin-hash-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("plugin.js"), "export default () => {};").unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{"allowedHosts":["api.example.com"]}"#,
        )
        .unwrap();
        let before = plugin_content_hash(&dir).unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{"allowedHosts":["other.example.com"]}"#,
        )
        .unwrap();
        let after = plugin_content_hash(&dir).unwrap();
        assert_ne!(before, after);
        fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn missing_plugin_code_does_not_produce_a_consent_hash() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-missing-code-test-{}",
            std::process::id()
        ));
        let dir = root.join(".plugins/missing-code");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("manifest.json"), r#"{"id":"missing-code"}"#).unwrap();

        assert!(plugin_content_hash(&dir).is_none());
        let records = list_plugins_in(dir.parent().unwrap());
        assert_eq!(records.len(), 1);
        assert!(records[0].read_error.is_some());
        assert!(records[0].content_hash.is_none());
        assert!(records[0].code.is_none());

        fs::remove_dir_all(root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn consent_hash_rejects_a_symlinked_plugin_directory() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-directory-link-test-{}",
            std::process::id()
        ));
        let outside = root.join("outside");
        let linked = root.join(".plugins/linked-plugin");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&outside).unwrap();
        fs::create_dir_all(linked.parent().unwrap()).unwrap();
        fs::write(outside.join("manifest.json"), r#"{"id":"linked-plugin"}"#).unwrap();
        fs::write(outside.join("plugin.js"), "export default () => {};").unwrap();
        symlink(&outside, &linked).unwrap();

        assert!(plugin_content_hash(&linked).is_none());
        let records = list_plugins_in(linked.parent().unwrap());
        assert_eq!(records.len(), 1);
        assert!(records[0].read_error.is_some());
        assert!(records[0].content_hash.is_none());
        assert!(records[0].code.is_none());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn plugin_snapshot_returns_the_exact_code_bound_to_its_hash() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-snapshot-test-{}",
            std::process::id()
        ));
        let base = root.join(".plugins");
        let plugin = base.join("snapshot-plugin");
        let manifest = br#"{"id":"snapshot-plugin","version":"1.0.0"}"#;
        let code = b"export default () => 'hashed source';";
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&plugin).unwrap();
        fs::write(plugin.join("manifest.json"), manifest).unwrap();
        fs::write(plugin.join("plugin.js"), code).unwrap();

        let snapshot = read_plugin_snapshot_in(&base, "snapshot-plugin").unwrap();
        assert_eq!(snapshot.code.as_bytes(), code);
        assert_eq!(
            snapshot.content_hash,
            plugin_content_hash_bytes(manifest, code)
        );

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn missing_source_manifest_does_not_leave_a_partial_install() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-install-test-{}",
            std::process::id()
        ));
        let src = root.join("source");
        let dest = root.join("plugins/moldavite-wordpress");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&src).unwrap();
        fs::write(src.join("plugin.js"), "export default () => {};").unwrap();

        let error = copy_plugin_files(&src, &dest, "moldavite-wordpress").unwrap_err();
        assert!(error.contains("missing manifest.json"));
        assert!(!dest.exists());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn plugin_copy_is_complete_and_can_reinstall_after_removal() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-reinstall-test-{}",
            std::process::id()
        ));
        let src = root.join("source");
        let dest = root.join("plugins/moldavite-wordpress");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&src).unwrap();
        for (name, contents) in [
            ("manifest.json", r#"{"id":"moldavite-wordpress"}"#),
            ("plugin.js", "export default () => {};"),
            ("README.md", "# Publish to WordPress"),
        ] {
            fs::write(src.join(name), contents).unwrap();
        }

        copy_plugin_files(&src, &dest, "moldavite-wordpress").unwrap();
        assert_eq!(
            fs::read_to_string(dest.join("manifest.json")).unwrap(),
            r#"{"id":"moldavite-wordpress"}"#
        );
        assert!(dest.join("plugin.js").is_file());
        assert!(dest.join("README.md").is_file());

        fs::remove_dir_all(&dest).unwrap();
        copy_plugin_files(&src, &dest, "moldavite-wordpress").unwrap();
        assert!(dest.join("manifest.json").is_file());

        fs::remove_dir_all(root).ok();
    }

    #[test]
    fn installed_plugin_requires_confirmation_before_atomic_update() {
        let root = std::env::temp_dir().join(format!(
            "moldavite-plugin-update-test-{}",
            std::process::id()
        ));
        let dest = root.join("plugins/community-plugin");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(dest.parent().unwrap()).unwrap();

        let original_manifest = br#"{"id":"community-plugin","version":"1.0.0"}"#;
        install_plugin_files(
            &dest,
            "community-plugin",
            PluginFiles {
                manifest_json: original_manifest,
                plugin_js: b"export default () => 'old';",
                readme: None,
            },
            false,
        )
        .unwrap();

        let updated_manifest = br#"{"id":"community-plugin","version":"2.0.0"}"#;
        let unconfirmed = install_plugin_files(
            &dest,
            "community-plugin",
            PluginFiles {
                manifest_json: updated_manifest,
                plugin_js: b"export default () => 'new';",
                readme: None,
            },
            false,
        )
        .unwrap_err();
        assert!(unconfirmed.contains("confirm the update"));
        assert_eq!(
            fs::read(dest.join("manifest.json")).unwrap(),
            original_manifest
        );

        install_plugin_files(
            &dest,
            "community-plugin",
            PluginFiles {
                manifest_json: updated_manifest,
                plugin_js: b"export default () => 'new';",
                readme: None,
            },
            true,
        )
        .unwrap();
        assert_eq!(
            fs::read(dest.join("manifest.json")).unwrap(),
            updated_manifest
        );
        let (staging, previous) = plugin_install_paths(dest.parent().unwrap(), "community-plugin");
        assert!(!staging.exists());
        assert!(!previous.exists());

        fs::remove_dir_all(root).ok();
    }
}
