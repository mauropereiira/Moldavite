//! Plugin system backend: enumerate, uninstall, and install-example plugins
//! living under the active Forge's `.plugins/` directory, plus the path
//! resolver used by the `plugin://` URI scheme handler in `lib.rs`.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

use crate::paths::get_notes_dir;
use crate::validation::validate_path_within_base;

const KEYRING_SERVICE: &str = "Moldavite";

/// Absolute path to the active Forge's `.plugins` directory.
pub(crate) fn plugins_dir() -> PathBuf {
    get_notes_dir().join(".plugins")
}

/// A plugin id must match its folder name: lowercase alphanumerics + hyphens,
/// not starting with a hyphen, max 64 chars.
pub(crate) fn is_valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().next().map(|c| c != '-').unwrap_or(false)
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
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

trait PluginSecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, String>;
    fn set(&self, account: &str, value: &str) -> Result<(), String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}

struct KeychainSecretStore;

impl KeychainSecretStore {
    fn entry(account: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, account)
            .map_err(|e| format!("could not access plugin secret: {e}"))
    }
}

impl PluginSecretStore for KeychainSecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, String> {
        match Self::entry(account)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("could not read plugin secret: {e}")),
        }
    }

    fn set(&self, account: &str, value: &str) -> Result<(), String> {
        Self::entry(account)?
            .set_password(value)
            .map_err(|e| format!("could not save plugin secret: {e}"))
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        match Self::entry(account)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not delete plugin secret: {e}")),
        }
    }
}

fn secret_get_with(
    store: &impl PluginSecretStore,
    plugin_id: &str,
    key: &str,
) -> Result<Option<String>, String> {
    store.get(&secret_account(plugin_id, key)?)
}

fn secret_set_with(
    store: &impl PluginSecretStore,
    plugin_id: &str,
    key: &str,
    value: &str,
) -> Result<(), String> {
    store.set(&secret_account(plugin_id, key)?, value)
}

fn secret_delete_with(
    store: &impl PluginSecretStore,
    plugin_id: &str,
    key: &str,
) -> Result<(), String> {
    store.delete(&secret_account(plugin_id, key)?)
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

/// Resolve `<plugins_dir>/<id>/<rel>` and confirm it stays inside `.plugins`.
/// Returns None on any invalid id, empty rel, traversal, or missing file.
pub(crate) fn resolve_plugin_file(id: &str, rel: &str) -> Option<PathBuf> {
    if !is_valid_plugin_id(id) || rel.is_empty() {
        return None;
    }
    let base = plugins_dir();
    let candidate = base.join(id).join(rel);
    if validate_path_within_base(&candidate, &base).is_err() {
        return None;
    }
    if candidate.is_file() {
        Some(candidate)
    } else {
        None
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
    /// SHA-256 over manifest.json + plugin.js bytes. The frontend pins the
    /// user's consent to this hash so silently swapped plugin code always
    /// triggers a fresh permission prompt.
    #[serde(rename = "contentHash")]
    pub content_hash: Option<String>,
}

/// Hash the files that define a plugin's behavior (manifest + code).
fn plugin_content_hash(plugin_dir: &std::path::Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    let manifest = fs::read(plugin_dir.join("manifest.json")).ok()?;
    let code = fs::read(plugin_dir.join("plugin.js")).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(&manifest);
    hasher.update([0u8]); // domain separator between the two files
    hasher.update(&code);
    Some(format!("{:x}", hasher.finalize()))
}

#[tauri::command]
pub(crate) fn list_plugins() -> Result<Vec<RawPlugin>, String> {
    let dir = plugins_dir();
    let mut out = Vec::new();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // no `.plugins` dir yet
    };
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let id = entry.file_name().to_string_lossy().to_string();
        if !is_valid_plugin_id(&id) {
            continue;
        }
        let manifest_path = entry.path().join("manifest.json");
        let content_hash = plugin_content_hash(&entry.path());
        match fs::read_to_string(&manifest_path) {
            Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
                Ok(v) => out.push(RawPlugin {
                    id,
                    manifest_raw: Some(v),
                    read_error: None,
                    content_hash,
                }),
                Err(e) => out.push(RawPlugin {
                    id,
                    manifest_raw: None,
                    read_error: Some(format!("invalid manifest.json: {e}")),
                    content_hash,
                }),
            },
            Err(e) => out.push(RawPlugin {
                id,
                manifest_raw: None,
                read_error: Some(format!("no manifest.json: {e}")),
                content_hash,
            }),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[tauri::command]
pub(crate) fn uninstall_plugin(id: String) -> Result<(), String> {
    if !is_valid_plugin_id(&id) {
        return Err("invalid plugin id".into());
    }
    let base = plugins_dir();
    let target = base.join(&id);
    validate_path_within_base(&target, &base)
        .map_err(|_| "refusing to delete outside the plugins directory".to_string())?;
    if target.is_dir() {
        fs::remove_dir_all(&target).map_err(|e| format!("failed to uninstall: {e}"))?;
    }
    Ok(())
}

fn install_bundled_plugin(
    app: &tauri::AppHandle,
    resource_name: &str,
    plugin_id: &str,
) -> Result<(), String> {
    use tauri::Manager;
    let src = app
        .path()
        .resolve(resource_name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("cannot locate bundled plugin: {e}"))?;
    let dest = plugins_dir().join(plugin_id);
    if dest.exists() {
        return Err(format!("{plugin_id} is already installed"));
    }
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create plugin dir: {e}"))?;
    for name in ["manifest.json", "plugin.js", "README.md"] {
        let from = src.join(name);
        if from.is_file() {
            fs::copy(&from, dest.join(name)).map_err(|e| format!("copy {name} failed: {e}"))?;
        }
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemorySecretStore(RefCell<HashMap<String, String>>);

    impl PluginSecretStore for MemorySecretStore {
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
}
