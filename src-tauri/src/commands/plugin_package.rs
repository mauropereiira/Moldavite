//! Reading a plugin package the user picked from their own files: a plugin
//! folder, or a `.zip` of one. Nothing is written here. The frontend validates
//! the manifest, shows what the plugin asks for, and installs the exact bytes
//! returned through `install_plugin_from_data` only after the user confirms.
//!
//! A package is untrusted. Only `manifest.json` and `plugin.js` are read, from
//! the package root or from a single folder inside it, so a zip entry's own
//! path never reaches the filesystem. Links are refused rather than followed.

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::plugins::{sha256_hex, MAX_MANIFEST_BYTES, MAX_PLUGIN_JS_BYTES};
use crate::validation::is_valid_plugin_id;

const MAX_ZIP_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ZIP_ENTRIES: usize = 2_000;
const S_IFMT: u32 = 0o170_000;
const S_IFLNK: u32 = 0o120_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginPackage {
    pub manifest_json: String,
    pub plugin_js: String,
    pub manifest_sha256: String,
    pub plugin_sha256: String,
}

#[derive(Deserialize)]
struct PackageIdentity {
    id: String,
}

fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.') || name == "__MACOSX"
}

fn read_limited(reader: impl Read, name: &str, limit: u64) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    reader
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read {name}: {e}"))?;
    if bytes.len() as u64 > limit {
        return Err(format!(
            "{name} is larger than the {} MB limit",
            limit / (1024 * 1024)
        ));
    }
    Ok(bytes)
}

fn read_package_file(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let metadata = fs::symlink_metadata(path).map_err(|_| format!("the package has no {name}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{name} must be a regular file, not a link"));
    }
    let file = fs::File::open(path).map_err(|e| format!("cannot open {name}: {e}"))?;
    read_limited(file, name, limit)
}

/// The chosen folder itself, or its one visible subfolder holding a manifest,
/// which is what unzipping a downloaded plugin usually produces.
fn package_dir(chosen: &Path) -> Result<PathBuf, String> {
    if fs::symlink_metadata(chosen.join("manifest.json")).is_ok() {
        return Ok(chosen.to_path_buf());
    }
    let entries = fs::read_dir(chosen).map_err(|e| format!("cannot read the folder: {e}"))?;
    let mut found = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name();
        if is_ignored_name(&name.to_string_lossy()) {
            continue;
        }
        let path = entry.path();
        let is_real_dir = fs::symlink_metadata(&path)
            .map(|metadata| metadata.is_dir())
            .unwrap_or(false);
        if is_real_dir && fs::symlink_metadata(path.join("manifest.json")).is_ok() {
            found.push(path);
        }
    }
    match found.len() {
        1 => Ok(found.remove(0)),
        0 => Err(no_manifest()),
        _ => Err(more_than_one()),
    }
}

fn no_manifest() -> String {
    "No manifest.json found. Choose the plugin's folder, the one holding manifest.json and plugin.js."
        .into()
}

fn more_than_one() -> String {
    "This holds more than one plugin. Choose a single plugin's folder or .zip.".into()
}

fn read_dir_package(chosen: &Path) -> Result<(Vec<u8>, Vec<u8>), String> {
    let dir = package_dir(chosen)?;
    Ok((
        read_package_file(&dir.join("manifest.json"), MAX_MANIFEST_BYTES)?,
        read_package_file(&dir.join("plugin.js"), MAX_PLUGIN_JS_BYTES)?,
    ))
}

/// `""` when the files sit at the archive root, or `"<folder>/"` when a single
/// top-level folder holds them.
fn zip_prefix<'a>(names: impl Iterator<Item = &'a str>) -> Result<String, String> {
    let mut prefixes = BTreeSet::new();
    for name in names {
        let Some(prefix) = name.strip_suffix("manifest.json") else {
            continue;
        };
        if prefix.is_empty() {
            return Ok(String::new());
        }
        let folder = prefix.trim_end_matches('/');
        if prefix.ends_with('/') && !folder.contains('/') && !is_ignored_name(folder) {
            prefixes.insert(prefix.to_string());
        }
    }
    match prefixes.len() {
        1 => Ok(prefixes.into_iter().next().unwrap_or_default()),
        0 => Err(no_manifest()),
        _ => Err(more_than_one()),
    }
}

fn read_zip_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
    file: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(name)
        .map_err(|_| format!("the package has no readable {file}"))?;
    let is_link = entry
        .unix_mode()
        .is_some_and(|mode| mode & S_IFMT == S_IFLNK);
    if entry.is_dir() || is_link {
        return Err(format!("{file} must be a regular file, not a link"));
    }
    if entry.size() > limit {
        return Err(format!(
            "{file} is larger than the {} MB limit",
            limit / (1024 * 1024)
        ));
    }
    read_limited(entry, file, limit)
}

fn read_zip_package(path: &Path, size: u64) -> Result<(Vec<u8>, Vec<u8>), String> {
    if size > MAX_ZIP_BYTES {
        return Err(format!(
            "The .zip is larger than the {} MB limit for a plugin",
            MAX_ZIP_BYTES / (1024 * 1024)
        ));
    }
    let file = fs::File::open(path).map_err(|e| format!("cannot open the .zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|_| "This isn't a readable .zip file.".to_string())?;
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err("The .zip holds too many files to be a plugin.".into());
    }
    let prefix = zip_prefix(archive.file_names())?;
    Ok((
        read_zip_entry(
            &mut archive,
            &format!("{prefix}manifest.json"),
            "manifest.json",
            MAX_MANIFEST_BYTES,
        )?,
        read_zip_entry(
            &mut archive,
            &format!("{prefix}plugin.js"),
            "plugin.js",
            MAX_PLUGIN_JS_BYTES,
        )?,
    ))
}

fn package_from_bytes(manifest: Vec<u8>, plugin: Vec<u8>) -> Result<PluginPackage, String> {
    let manifest_sha256 = sha256_hex(&manifest);
    let plugin_sha256 = sha256_hex(&plugin);
    let manifest_json =
        String::from_utf8(manifest).map_err(|_| "manifest.json isn't UTF-8 text".to_string())?;
    let plugin_js =
        String::from_utf8(plugin).map_err(|_| "plugin.js isn't UTF-8 text".to_string())?;
    let identity: PackageIdentity = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("manifest.json isn't valid: {e}"))?;
    if !is_valid_plugin_id(&identity.id) {
        return Err(
            "The manifest id must be lowercase letters, digits and hyphens, up to 64 characters."
                .into(),
        );
    }
    Ok(PluginPackage {
        manifest_json,
        plugin_js,
        manifest_sha256,
        plugin_sha256,
    })
}

fn read_package_at(path: &Path) -> Result<PluginPackage, String> {
    if !path.is_absolute() {
        return Err("Choose a plugin folder or .zip file.".into());
    }
    let metadata =
        fs::symlink_metadata(path).map_err(|_| "That file or folder can't be read.".to_string())?;
    let is_zip = path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"));
    let (manifest, plugin) = if metadata.is_dir() {
        read_dir_package(path)?
    } else if metadata.is_file() && is_zip {
        read_zip_package(path, metadata.len())?
    } else {
        return Err("Choose a plugin folder or .zip file.".into());
    };
    package_from_bytes(manifest, plugin)
}

#[tauri::command]
pub(crate) fn read_plugin_package(path: String) -> Result<PluginPackage, String> {
    read_package_at(Path::new(&path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::write::SimpleFileOptions;

    const MANIFEST: &str =
        r#"{"id":"hello-world","name":"Hello","version":"1.0.0","apiVersion":2}"#;
    const CODE: &str = "export default function register() {}\n";

    fn scratch(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "moldavite-plugin-package-{test}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_plugin(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(dir.join("manifest.json"), MANIFEST).unwrap();
        fs::write(dir.join("plugin.js"), CODE).unwrap();
    }

    fn zip_with(path: &Path, entries: &[(&str, &str)]) {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, body) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        fs::write(path, writer.finish().unwrap().into_inner()).unwrap();
    }

    #[test]
    fn reads_a_plugin_folder_with_hashes_of_the_exact_bytes() {
        let root = scratch("folder");
        write_plugin(&root.join("hello-world"));
        let package = read_package_at(&root.join("hello-world")).unwrap();
        assert_eq!(package.manifest_json, MANIFEST);
        assert_eq!(package.plugin_js, CODE);
        assert_eq!(package.manifest_sha256, sha256_hex(MANIFEST.as_bytes()));
        assert_eq!(package.plugin_sha256, sha256_hex(CODE.as_bytes()));
    }

    #[test]
    fn accepts_the_single_folder_an_unzip_leaves_behind() {
        let root = scratch("wrapped");
        write_plugin(&root.join("hello-world-main"));
        fs::create_dir_all(root.join("__MACOSX")).unwrap();
        fs::write(root.join(".DS_Store"), b"").unwrap();
        assert_eq!(read_package_at(&root).unwrap().plugin_js, CODE);
    }

    #[test]
    fn refuses_a_folder_with_no_plugin_or_several() {
        let empty = scratch("empty");
        assert!(read_package_at(&empty)
            .unwrap_err()
            .contains("No manifest.json"));

        let several = scratch("several");
        write_plugin(&several.join("one"));
        write_plugin(&several.join("two"));
        assert!(read_package_at(&several)
            .unwrap_err()
            .contains("more than one plugin"));
    }

    #[cfg(unix)]
    #[test]
    fn refuses_linked_files_instead_of_following_them() {
        let root = scratch("symlink");
        let secret = root.join("secret.txt");
        fs::write(&secret, "not plugin code").unwrap();
        let plugin = root.join("hello-world");
        fs::create_dir_all(&plugin).unwrap();
        fs::write(plugin.join("manifest.json"), MANIFEST).unwrap();
        std::os::unix::fs::symlink(&secret, plugin.join("plugin.js")).unwrap();
        assert!(read_package_at(&plugin).unwrap_err().contains("not a link"));
    }

    #[test]
    fn enforces_the_size_limit_even_when_the_file_grows_past_it() {
        let root = scratch("size");
        let file = root.join("plugin.js");
        fs::write(&file, "x".repeat(64)).unwrap();
        assert!(read_package_file(&file, 63).unwrap_err().contains("limit"));
        assert_eq!(read_package_file(&file, 64).unwrap().len(), 64);
    }

    #[test]
    fn reads_a_zip_at_its_root_or_inside_one_folder() {
        let root = scratch("zip");
        let flat = root.join("flat.zip");
        zip_with(&flat, &[("manifest.json", MANIFEST), ("plugin.js", CODE)]);
        assert_eq!(read_package_at(&flat).unwrap().manifest_json, MANIFEST);

        let nested = root.join("nested.ZIP");
        zip_with(
            &nested,
            &[
                ("__MACOSX/hello-world/._manifest.json", "junk"),
                ("hello-world/manifest.json", MANIFEST),
                ("hello-world/plugin.js", CODE),
                ("hello-world/README.md", "# Hello"),
            ],
        );
        assert_eq!(read_package_at(&nested).unwrap().plugin_js, CODE);
    }

    #[test]
    fn refuses_zips_that_are_ambiguous_incomplete_or_not_zips() {
        let root = scratch("zip-bad");
        let deep = root.join("deep.zip");
        zip_with(
            &deep,
            &[("a/b/manifest.json", MANIFEST), ("a/b/plugin.js", CODE)],
        );
        assert!(read_package_at(&deep)
            .unwrap_err()
            .contains("No manifest.json"));

        let two = root.join("two.zip");
        zip_with(
            &two,
            &[
                ("one/manifest.json", MANIFEST),
                ("two/manifest.json", MANIFEST),
            ],
        );
        assert!(read_package_at(&two)
            .unwrap_err()
            .contains("more than one plugin"));

        let missing = root.join("missing.zip");
        zip_with(&missing, &[("manifest.json", MANIFEST)]);
        assert!(read_package_at(&missing).unwrap_err().contains("plugin.js"));

        let fake = root.join("fake.zip");
        fs::write(&fake, "not a zip").unwrap();
        assert!(read_package_at(&fake)
            .unwrap_err()
            .contains("readable .zip"));
    }

    #[test]
    fn refuses_a_zip_entry_that_is_a_link() {
        let root = scratch("zip-link");
        let path = root.join("link.zip");
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(MANIFEST.as_bytes()).unwrap();
        writer
            .add_symlink("plugin.js", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        fs::write(&path, writer.finish().unwrap().into_inner()).unwrap();
        assert!(read_package_at(&path).unwrap_err().contains("not a link"));
    }

    #[test]
    fn refuses_other_files_relative_paths_bad_ids_and_non_utf8() {
        let root = scratch("other");
        let text = root.join("notes.txt");
        fs::write(&text, "hello").unwrap();
        assert!(read_package_at(&text).is_err());
        assert!(read_package_at(Path::new("relative/plugin")).is_err());

        let bad_id = root.join("bad-id");
        fs::create_dir_all(&bad_id).unwrap();
        fs::write(bad_id.join("manifest.json"), r#"{"id":"../Escape"}"#).unwrap();
        fs::write(bad_id.join("plugin.js"), CODE).unwrap();
        assert!(read_package_at(&bad_id)
            .unwrap_err()
            .contains("manifest id"));

        let binary = root.join("binary");
        fs::create_dir_all(&binary).unwrap();
        fs::write(binary.join("manifest.json"), MANIFEST).unwrap();
        fs::write(binary.join("plugin.js"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(read_package_at(&binary).unwrap_err().contains("UTF-8"));
    }
}
