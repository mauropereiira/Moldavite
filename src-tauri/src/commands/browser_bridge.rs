//! Native-messaging pairing for the browser clipper.
//!
//! The only thing standing between a browser extension and the Forge is the
//! extension ID pinned in these manifests, so nothing here is written
//! implicitly: the user presses Connect in Settings, the same way plugins are
//! never installed or enabled silently.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};

use crate::browser_host::GECKO_EXTENSION_ID;
use crate::persist::write_atomic;

pub(crate) const HOST_NAME: &str = "com.moldavite.clipper";

/// Derived from `extension/key.pem`; see `extension/README.md`. Regenerating
/// that key changes this ID and unpairs every install.
pub(crate) const CHROME_EXTENSION_ID: &str = "dgidmimgcpmanonfbijebppdmfhnhhem";

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Flavor {
    Chromium,
    Firefox,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BridgeTarget {
    pub(crate) label: String,
    pub(crate) connected: bool,
}

fn manifest_body(flavor: Flavor, binary: &Path) -> Value {
    let mut body = json!({
        "name": HOST_NAME,
        "description": "Moldavite page clipper",
        "path": binary.to_string_lossy(),
        "type": "stdio",
    });
    match flavor {
        Flavor::Chromium => {
            body["allowed_origins"] = json!([format!("chrome-extension://{CHROME_EXTENSION_ID}/")]);
        }
        Flavor::Firefox => {
            body["allowed_extensions"] = json!([GECKO_EXTENSION_ID]);
        }
    }
    body
}

fn manifest_path(dir: &Path) -> PathBuf {
    dir.join(format!("{HOST_NAME}.json"))
}

fn write_manifest(dir: &Path, flavor: Flavor, binary: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir)
        .map_err(|error| format!("Cannot create {}: {error}", dir.display()))?;
    let body = serde_json::to_vec_pretty(&manifest_body(flavor, binary))
        .map_err(|error| format!("Cannot encode the host manifest: {error}"))?;
    write_atomic(&manifest_path(dir), &body, Some(0o600))
}

/// Rewrite a manifest whose `path` no longer matches the running binary — a
/// Homebrew upgrade or a drag out of /Applications would otherwise break
/// clipping silently. Absent manifests stay absent: pairing is the user's call.
fn refresh_manifest_at(dir: &Path, flavor: Flavor, binary: &Path) -> Result<(), String> {
    let manifest = manifest_path(dir);
    if !manifest.exists() {
        return Ok(());
    }
    let stale = std::fs::read_to_string(&manifest)
        .ok()
        .and_then(|current| serde_json::from_str::<Value>(&current).ok())
        .and_then(|value| {
            value["path"]
                .as_str()
                .map(|path| path != binary.to_string_lossy())
        })
        // Unreadable or malformed means we cannot tell, so rewrite it.
        .unwrap_or(true);
    if stale {
        write_manifest(dir, flavor, binary)?;
    }
    Ok(())
}

/// Per-user manifest directories, paired with the label the UI shows.
#[cfg(target_os = "macos")]
fn targets(home: &Path) -> Vec<(&'static str, PathBuf, Flavor)> {
    let support = home.join("Library/Application Support");
    vec![
        (
            "Chrome",
            support.join("Google/Chrome/NativeMessagingHosts"),
            Flavor::Chromium,
        ),
        (
            "Edge",
            support.join("Microsoft Edge/NativeMessagingHosts"),
            Flavor::Chromium,
        ),
        (
            "Brave",
            support.join("BraveSoftware/Brave-Browser/NativeMessagingHosts"),
            Flavor::Chromium,
        ),
        (
            "Firefox",
            support.join("Mozilla/NativeMessagingHosts"),
            Flavor::Firefox,
        ),
    ]
}

#[cfg(target_os = "linux")]
fn targets(home: &Path) -> Vec<(&'static str, PathBuf, Flavor)> {
    vec![
        (
            "Chrome",
            home.join(".config/google-chrome/NativeMessagingHosts"),
            Flavor::Chromium,
        ),
        (
            "Chromium",
            home.join(".config/chromium/NativeMessagingHosts"),
            Flavor::Chromium,
        ),
        (
            "Firefox",
            home.join(".mozilla/native-messaging-hosts"),
            Flavor::Firefox,
        ),
    ]
}

#[cfg(target_os = "windows")]
fn targets(home: &Path) -> Vec<(&'static str, PathBuf, Flavor)> {
    // Windows keeps the manifest wherever we like and points at it from the
    // registry, so all four browsers share one directory of our own.
    let dir = home.join("AppData/Roaming/Moldavite/NativeMessagingHosts");
    vec![
        ("Chrome", dir.clone(), Flavor::Chromium),
        ("Edge", dir.clone(), Flavor::Chromium),
        ("Brave", dir.clone(), Flavor::Chromium),
        ("Firefox", dir, Flavor::Firefox),
    ]
}

/// Whether this browser looks installed. On macOS and Linux the manifest
/// directory's parent is the browser's own profile root, so its absence means
/// the browser is not there; on Windows the directory is ours, so pair all four.
#[cfg(not(target_os = "windows"))]
fn browser_present(dir: &Path) -> bool {
    dir.parent().map(Path::exists).unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn browser_present(_dir: &Path) -> bool {
    true
}

#[cfg(target_os = "windows")]
fn registry_key(label: &str) -> String {
    let root = match label {
        "Edge" => r"Software\Microsoft\Edge\NativeMessagingHosts",
        "Brave" => r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts",
        "Firefox" => r"Software\Mozilla\NativeMessagingHosts",
        _ => r"Software\Google\Chrome\NativeMessagingHosts",
    };
    format!(r"{root}\{HOST_NAME}")
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Cannot locate the home directory".to_string())
}

fn binary_path() -> Result<PathBuf, String> {
    crate::paths::app_binary_path()
}

#[tauri::command]
pub(crate) fn browser_bridge_status() -> Result<Vec<BridgeTarget>, String> {
    let home = home_dir()?;
    Ok(targets(&home)
        .into_iter()
        .map(|(label, dir, _)| BridgeTarget {
            label: label.to_string(),
            connected: manifest_path(&dir).exists(),
        })
        .collect())
}

#[tauri::command]
pub(crate) fn connect_browser_bridge() -> Result<Vec<String>, String> {
    let home = home_dir()?;
    let binary = binary_path()?;
    let mut connected = Vec::new();

    for (label, dir, flavor) in targets(&home) {
        if !browser_present(&dir) {
            continue;
        }
        write_manifest(&dir, flavor, &binary)?;

        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;

            let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
                .create_subkey(registry_key(label))
                .map_err(|error| format!("Cannot write the {label} registry key: {error}"))?;
            key.set_value("", &manifest_path(&dir).to_string_lossy().to_string())
                .map_err(|error| format!("Cannot write the {label} registry value: {error}"))?;
        }

        connected.push(label.to_string());
    }

    if connected.is_empty() {
        return Err("No supported browser was found on this machine.".to_string());
    }
    Ok(connected)
}

#[tauri::command]
pub(crate) fn disconnect_browser_bridge() -> Result<(), String> {
    let home = home_dir()?;
    for (_label, dir, _) in targets(&home) {
        let manifest = manifest_path(&dir);
        if manifest.exists() {
            std::fs::remove_file(&manifest)
                .map_err(|error| format!("Cannot remove {}: {error}", manifest.display()))?;
        }

        #[cfg(target_os = "windows")]
        {
            use winreg::enums::HKEY_CURRENT_USER;
            use winreg::RegKey;

            // Absent keys are fine: this is the state we are trying to reach.
            let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(registry_key(_label));
        }
    }
    Ok(())
}

/// Called once on launch. A moved app bundle must not silently stop clipping.
pub(crate) fn refresh_paired_manifests() {
    let (Ok(home), Ok(binary)) = (home_dir(), binary_path()) else {
        return;
    };
    for (_label, dir, flavor) in targets(&home) {
        if let Err(error) = refresh_manifest_at(&dir, flavor, &binary) {
            log::warn!("[clipper] could not refresh a host manifest: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "moldavite-bridge-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn written(dir: &Path) -> Value {
        serde_json::from_str(&std::fs::read_to_string(manifest_path(dir)).unwrap()).unwrap()
    }

    #[test]
    fn writes_a_chrome_manifest_that_pins_our_extension() {
        let home = temp_home("chrome");
        let dir = home.join("Google/Chrome/NativeMessagingHosts");

        write_manifest(&dir, Flavor::Chromium, Path::new("/Applications/M.app/M")).unwrap();

        let manifest = written(&dir);
        assert_eq!(manifest["name"], HOST_NAME);
        assert_eq!(manifest["type"], "stdio");
        assert_eq!(manifest["path"], "/Applications/M.app/M");
        assert_eq!(
            manifest["allowed_origins"][0],
            format!("chrome-extension://{CHROME_EXTENSION_ID}/")
        );
        assert!(manifest.get("allowed_extensions").is_none());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn writes_a_firefox_manifest_that_pins_the_addon_id() {
        let home = temp_home("firefox");
        let dir = home.join("Mozilla/NativeMessagingHosts");

        write_manifest(&dir, Flavor::Firefox, Path::new("/Applications/M.app/M")).unwrap();

        let manifest = written(&dir);
        assert_eq!(manifest["allowed_extensions"][0], GECKO_EXTENSION_ID);
        assert!(manifest.get("allowed_origins").is_none());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn a_stale_binary_path_is_rewritten_not_left_broken() {
        let home = temp_home("stale");
        let dir = home.join("Google/Chrome/NativeMessagingHosts");
        write_manifest(&dir, Flavor::Chromium, Path::new("/old/path/M")).unwrap();

        refresh_manifest_at(&dir, Flavor::Chromium, Path::new("/new/path/M")).unwrap();

        assert_eq!(written(&dir)["path"], "/new/path/M");

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn refresh_does_not_pair_a_browser_the_user_never_connected() {
        let home = temp_home("unpaired");
        let dir = home.join("Google/Chrome/NativeMessagingHosts");
        std::fs::create_dir_all(&dir).unwrap();

        refresh_manifest_at(&dir, Flavor::Chromium, Path::new("/new/path/M")).unwrap();

        assert!(!manifest_path(&dir).exists());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn status_reports_a_directory_without_a_manifest_as_disconnected() {
        let home = temp_home("status");
        let targets = targets(&home);
        assert!(!targets.is_empty());
        for (_label, dir, _) in targets {
            assert!(!manifest_path(&dir).exists());
        }
    }
}
