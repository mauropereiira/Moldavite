//! "Make Moldavite your Markdown app": the system's default handler for `.md`.
//!
//! macOS sets it through Launch Services in the Swift bridge. Windows 10 and
//! 11 do not let an app make itself the default, so the command opens the
//! Default Apps page and the status stays unknown. Linux sets it with
//! `xdg-mime` for the installed `.desktop` entry that launches this binary;
//! an AppImage has no installed entry, so it reports `Unsupported` like iOS
//! and the UI hides the control.

use serde::Serialize;

/// Each platform constructs only its own modes.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DefaultAppMode {
    Set,
    OpenSettings,
    Unsupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DefaultAppStatus {
    pub mode: DefaultAppMode,
    pub is_default: Option<bool>,
}

#[cfg(any(not(any(target_os = "macos", windows)), test))]
const UNSUPPORTED: DefaultAppStatus = DefaultAppStatus {
    mode: DefaultAppMode::Unsupported,
    is_default: None,
};

/// Async with `spawn_blocking` because the macOS bridge waits on Launch
/// Services' completion handler, which must never block the main thread.
#[tauri::command]
pub(crate) async fn default_markdown_app_status() -> Result<DefaultAppStatus, String> {
    tauri::async_runtime::spawn_blocking(platform::status)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) async fn make_default_markdown_app() -> Result<DefaultAppStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        platform::make_default()?;
        Ok(platform::status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{DefaultAppMode, DefaultAppStatus};

    extern "C" {
        fn is_default_markdown_handler() -> bool;
        fn set_default_markdown_handler() -> bool;
    }

    pub(super) fn status() -> DefaultAppStatus {
        DefaultAppStatus {
            mode: DefaultAppMode::Set,
            is_default: Some(unsafe { is_default_markdown_handler() }),
        }
    }

    pub(super) fn make_default() -> Result<(), String> {
        if unsafe { set_default_markdown_handler() } {
            Ok(())
        } else {
            Err("macOS did not make Moldavite the default app for Markdown files".to_string())
        }
    }
}

#[cfg(windows)]
mod platform {
    use super::{DefaultAppMode, DefaultAppStatus};

    pub(super) fn status() -> DefaultAppStatus {
        DefaultAppStatus {
            mode: DefaultAppMode::OpenSettings,
            is_default: None,
        }
    }

    /// From Rust because the webview's shell scope only opens http(s),
    /// mailto and tel links.
    pub(super) fn make_default() -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:defaultapps")
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Could not open Default Apps settings: {e}"))
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use super::linux::{application_dirs, find_desktop_id, linux_status};
    use super::DefaultAppStatus;
    use std::path::PathBuf;
    use std::process::Command;

    const MARKDOWN_MIME: &str = "text/markdown";

    fn is_appimage() -> bool {
        std::env::var_os("APPIMAGE").is_some()
    }

    fn own_desktop_id() -> Option<String> {
        let exe = std::env::current_exe().ok()?;
        let dirs = application_dirs(
            std::env::var_os("XDG_DATA_HOME").map(PathBuf::from),
            dirs::home_dir(),
            std::env::var_os("XDG_DATA_DIRS"),
        );
        let path_dirs: Vec<PathBuf> = std::env::var_os("PATH")
            .map(|path| std::env::split_paths(&path).collect())
            .unwrap_or_default();
        find_desktop_id(&dirs, &exe, &path_dirs)
    }

    fn query_default() -> Option<String> {
        let output = Command::new("xdg-mime")
            .args(["query", "default", MARKDOWN_MIME])
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub(super) fn status() -> DefaultAppStatus {
        if is_appimage() {
            return linux_status(true, None, None);
        }
        let id = own_desktop_id();
        let query = id.as_ref().and_then(|_| query_default());
        linux_status(false, id.as_deref(), query.as_deref())
    }

    pub(super) fn make_default() -> Result<(), String> {
        if is_appimage() {
            return Err("An AppImage cannot be the default app for Markdown files".to_string());
        }
        let id = own_desktop_id()
            .ok_or_else(|| "No installed desktop entry launches Moldavite".to_string())?;
        let status = Command::new("xdg-mime")
            .args(["default", &id, MARKDOWN_MIME])
            .status()
            .map_err(|e| format!("Could not run xdg-mime: {e}"))?;
        if status.success() {
            Ok(())
        } else {
            Err(format!(
                "xdg-mime could not set {id} as the Markdown default"
            ))
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
mod platform {
    use super::{DefaultAppStatus, UNSUPPORTED};

    pub(super) fn status() -> DefaultAppStatus {
        UNSUPPORTED
    }

    pub(super) fn make_default() -> Result<(), String> {
        Err("This platform has no default app for Markdown files".to_string())
    }
}

#[cfg(any(target_os = "linux", all(unix, test)))]
mod linux {
    use super::{DefaultAppMode, DefaultAppStatus, UNSUPPORTED};
    use std::ffi::OsString;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// The XDG base-directory search order: the user's data home first, then
    /// each system data dir, each with its `applications/` subfolder.
    pub(super) fn application_dirs(
        data_home: Option<PathBuf>,
        home: Option<PathBuf>,
        data_dirs: Option<OsString>,
    ) -> Vec<PathBuf> {
        let data_home = data_home
            .filter(|dir| dir.is_absolute())
            .or_else(|| home.map(|home| home.join(".local/share")));
        let data_dirs: Vec<PathBuf> = data_dirs
            .filter(|dirs| !dirs.is_empty())
            .map(|dirs| std::env::split_paths(&dirs).collect())
            .unwrap_or_else(|| vec!["/usr/local/share".into(), "/usr/share".into()]);
        data_home
            .into_iter()
            .chain(data_dirs.into_iter().filter(|dir| dir.is_absolute()))
            .map(|dir| dir.join("applications"))
            .collect()
    }

    /// The desktop-file id (its file name) of the first entry whose `Exec`
    /// program is this binary, so `xdg-mime` sets the entry that launches us
    /// rather than any other Moldavite install.
    pub(super) fn find_desktop_id(
        app_dirs: &[PathBuf],
        exe: &Path,
        path_dirs: &[PathBuf],
    ) -> Option<String> {
        let exe = fs::canonicalize(exe).ok()?;
        for dir in app_dirs {
            let Ok(entries) = fs::read_dir(dir) else {
                continue;
            };
            let mut files: Vec<PathBuf> = entries
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|path| path.extension().is_some_and(|ext| ext == "desktop"))
                .collect();
            files.sort();
            for file in files {
                let Ok(contents) = fs::read_to_string(&file) else {
                    continue;
                };
                let markdown = desktop_entry_value(&contents, "MimeType")
                    .is_some_and(|value| value.split(';').any(|mime| mime == "text/markdown"));
                let hidden = ["NoDisplay", "Hidden"]
                    .iter()
                    .any(|key| desktop_entry_value(&contents, key) == Some("true"));
                if !markdown || hidden {
                    continue;
                }
                let launches_us = exec_program(&contents)
                    .and_then(|program| resolve_program(&program, path_dirs))
                    .is_some_and(|program| program == exe);
                if launches_us {
                    return file.file_name()?.to_str().map(str::to_string);
                }
            }
        }
        None
    }

    /// The program of the `[Desktop Entry]` group's `Exec` key: its first
    /// argument, honouring the spec's double quoting and backslash escapes.
    pub(super) fn exec_program(contents: &str) -> Option<String> {
        first_argument(desktop_entry_value(contents, "Exec")?)
    }

    fn desktop_entry_value<'a>(contents: &'a str, wanted: &str) -> Option<&'a str> {
        let mut in_entry = false;
        for line in contents.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                in_entry = line == "[Desktop Entry]";
                continue;
            }
            if !in_entry {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key.trim() == wanted {
                return Some(value.trim());
            }
        }
        None
    }

    fn first_argument(exec: &str) -> Option<String> {
        let mut chars = exec.chars();
        let mut program = String::new();
        if exec.starts_with('"') {
            chars.next();
            while let Some(c) = chars.next() {
                match c {
                    '"' => return (!program.is_empty()).then_some(program),
                    '\\' => program.push(chars.next()?),
                    _ => program.push(c),
                }
            }
            return None;
        }
        program.extend(chars.take_while(|c| !c.is_whitespace()));
        (!program.is_empty()).then_some(program)
    }

    fn resolve_program(program: &str, path_dirs: &[PathBuf]) -> Option<PathBuf> {
        if program.contains('/') {
            return fs::canonicalize(program).ok();
        }
        path_dirs
            .iter()
            .filter(|dir| dir.is_absolute())
            .find_map(|dir| fs::canonicalize(dir.join(program)).ok())
    }

    pub(super) fn linux_status(
        appimage: bool,
        desktop_id: Option<&str>,
        current_default: Option<&str>,
    ) -> DefaultAppStatus {
        match (appimage, desktop_id, current_default) {
            (false, Some(id), Some(current)) => DefaultAppStatus {
                mode: DefaultAppMode::Set,
                is_default: Some(current.trim() == id),
            },
            _ => UNSUPPORTED,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_serialises_in_the_shape_the_frontend_reads() {
        let json = serde_json::to_value(DefaultAppStatus {
            mode: DefaultAppMode::OpenSettings,
            is_default: None,
        })
        .unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "mode": "open-settings", "isDefault": null })
        );
        assert_eq!(
            serde_json::to_value(UNSUPPORTED).unwrap()["mode"],
            serde_json::json!("unsupported")
        );
    }
}

#[cfg(all(unix, test))]
mod linux_tests {
    use super::linux::*;
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(test: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "moldavite-default-app-{test}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("bin")).unwrap();
            fs::create_dir_all(root.join("other")).unwrap();
            fs::create_dir_all(root.join("apps")).unwrap();
            fs::create_dir_all(root.join("user-apps")).unwrap();
            fs::write(root.join("bin/moldavite"), b"").unwrap();
            fs::write(root.join("other/moldavite"), b"").unwrap();
            Self { root }
        }

        fn path(&self, relative: &str) -> PathBuf {
            self.root.join(relative)
        }

        fn desktop(&self, dir: &str, name: &str, exec: &str) {
            let contents = format!(
                "[Desktop Entry]\nType=Application\nName=Moldavite\nExec={exec}\nMimeType=text/markdown;\n"
            );
            fs::write(self.path(dir).join(name), contents).unwrap();
        }

        fn exe(&self) -> PathBuf {
            self.path("bin/moldavite")
        }

        fn app_dirs(&self) -> Vec<PathBuf> {
            vec![self.path("user-apps"), self.path("apps")]
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn finds_the_entry_whose_exec_runs_this_binary_with_a_file_list() {
        let fx = Fixture::new("match");
        fx.desktop(
            "apps",
            "Moldavite.desktop",
            &format!("{} %F", fx.exe().display()),
        );
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]),
            Some("Moldavite.desktop".to_string())
        );
    }

    #[test]
    fn mime_and_visibility_keys_only_apply_in_the_desktop_entry_section() {
        let fx = Fixture::new("entry-section");
        let file = fx.path("apps/Moldavite.desktop");
        for (mime, expected) in [
            ("text/markdown;", Some("Moldavite.desktop".to_string())),
            ("text/plain;", None),
        ] {
            fs::write(&file, format!(
                "[Desktop Action Other]\nMimeType=text/markdown;\n[Desktop Entry]\nExec={} %U\nMimeType={mime}\n[Desktop Action New]\nNoDisplay=true\nHidden=true\nMimeType=text/markdown;\nExec=other\n",
                fx.exe().display()
            )).unwrap();
            assert_eq!(find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]), expected);
        }
    }

    #[test]
    fn ignores_hidden_and_non_markdown_handlers_for_this_binary() {
        let fx = Fixture::new("hidden-handler");
        for (mime, extra) in [
            ("text/markdown;", "NoDisplay=true"),
            ("text/markdown;", "Hidden=true"),
            ("x-scheme-handler/moldavite;", ""),
        ] {
            let contents = format!(
                "[Desktop Entry]\nExec={} %u\nMimeType={mime}\n{extra}\n",
                fx.exe().display()
            );
            fs::write(fx.path("user-apps/moldavite-handler.desktop"), contents).unwrap();
            assert_eq!(
                find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]),
                None,
                "{extra}"
            );
        }
        fx.desktop(
            "apps",
            "Moldavite.desktop",
            &format!("{} %U", fx.exe().display()),
        );
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]),
            Some("Moldavite.desktop".into())
        );
    }

    #[test]
    fn resolves_a_bare_exec_name_through_path() {
        let fx = Fixture::new("bare");
        fx.desktop("apps", "Moldavite.desktop", "moldavite %U");
        assert_eq!(find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]), None);
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &fx.exe(), &[fx.path("bin")]),
            Some("Moldavite.desktop".to_string())
        );
    }

    #[test]
    fn ignores_entries_that_launch_another_binary() {
        let fx = Fixture::new("other");
        fx.desktop(
            "apps",
            "Other.desktop",
            &format!("{} %F", fx.path("other/moldavite").display()),
        );
        fx.desktop("apps", "Editor.desktop", "gedit %U");
        fx.desktop("apps", "Readme.txt", &fx.exe().display().to_string());
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &fx.exe(), &[fx.path("other")]),
            None
        );
    }

    #[test]
    fn reads_a_quoted_exec_with_spaces_and_arguments() {
        let fx = Fixture::new("quoted");
        let spaced = fx.path("my apps");
        fs::create_dir_all(&spaced).unwrap();
        fs::write(spaced.join("moldavite"), b"").unwrap();
        fx.desktop(
            "apps",
            "moldavite-dev.desktop",
            &format!("\"{}\" --forge Work %F", spaced.join("moldavite").display()),
        );
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &spaced.join("moldavite"), &[]),
            Some("moldavite-dev.desktop".to_string())
        );
    }

    #[test]
    fn the_user_data_dir_wins_over_system_dirs() {
        let fx = Fixture::new("order");
        let exec = format!("{} %F", fx.exe().display());
        fx.desktop("apps", "Moldavite.desktop", &exec);
        fx.desktop("user-apps", "moldavite-local.desktop", &exec);
        assert_eq!(
            find_desktop_id(&fx.app_dirs(), &fx.exe(), &[]),
            Some("moldavite-local.desktop".to_string())
        );
    }

    #[test]
    fn exec_parsing_follows_the_desktop_entry_spec() {
        assert_eq!(
            exec_program(
                "[Desktop Action New]\nExec=other\n[Desktop Entry]\nExec = moldavite %F\n"
            ),
            Some("moldavite".to_string())
        );
        assert_eq!(
            exec_program("[Desktop Entry]\nExec=\"/opt/My \\\"App\\\"/bin\" %U\n"),
            Some("/opt/My \"App\"/bin".to_string())
        );
        assert_eq!(exec_program("[Desktop Entry]\nTryExec=moldavite\n"), None);
        assert_eq!(exec_program("[Desktop Entry]\nExec=\"unterminated\n"), None);
        assert_eq!(exec_program("[Desktop Entry]\nExec=\n"), None);
    }

    #[test]
    fn application_dirs_follow_the_xdg_search_order() {
        assert_eq!(
            application_dirs(None, Some("/home/me".into()), None),
            vec![
                PathBuf::from("/home/me/.local/share/applications"),
                PathBuf::from("/usr/local/share/applications"),
                PathBuf::from("/usr/share/applications"),
            ]
        );
        assert_eq!(
            application_dirs(
                Some("/data".into()),
                Some("/home/me".into()),
                Some("/a:relative:/b".into())
            ),
            vec![
                PathBuf::from("/data/applications"),
                PathBuf::from("/a/applications"),
                PathBuf::from("/b/applications"),
            ]
        );
    }

    #[test]
    fn linux_status_maps_what_was_found() {
        let set = |is_default| DefaultAppStatus {
            mode: DefaultAppMode::Set,
            is_default: Some(is_default),
        };
        assert_eq!(
            linux_status(
                false,
                Some("Moldavite.desktop"),
                Some("Moldavite.desktop\n")
            ),
            set(true)
        );
        assert_eq!(
            linux_status(
                false,
                Some("Moldavite.desktop"),
                Some("org.gnome.TextEditor.desktop\n")
            ),
            set(false)
        );
        assert_eq!(
            linux_status(false, Some("Moldavite.desktop"), Some("")),
            set(false)
        );
        assert_eq!(
            linux_status(true, Some("Moldavite.desktop"), Some("Moldavite.desktop")),
            UNSUPPORTED
        );
        assert_eq!(
            linux_status(false, None, Some("Moldavite.desktop")),
            UNSUPPORTED
        );
        assert_eq!(
            linux_status(false, Some("Moldavite.desktop"), None),
            UNSUPPORTED
        );
    }
}
