//! Built-in stdio Model Context Protocol server and MCP-only startup path.
//!
//! The application binary enters this mode before Tauri is initialized when
//! invoked with `--mcp`. The supported subset is initialization, tool listing,
//! and tool calls over newline-delimited JSON-RPC 2.0. Every client argument is
//! untrusted: `server` bounds and parses messages, while `tools` validates paths,
//! rejects symlinks, and gates every mutation on the persisted write setting.

mod server;
mod tools;

use std::path::PathBuf;
use std::sync::Arc;

/// Parse MCP-only CLI arguments and run until stdin reaches EOF.
pub fn run_from_env() -> Result<(), String> {
    let mut forge: Option<String> = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--mcp" => {}
            "--forge" => {
                let name = args
                    .next()
                    .ok_or_else(|| "--forge requires a Forge name".to_string())?;
                if forge.replace(name).is_some() {
                    return Err("--forge may only be specified once".to_string());
                }
            }
            _ => return Err(format!("Unknown MCP argument: {arg}")),
        }
    }

    let forge_root = resolve_forge(forge.as_deref())?;
    let forge_resolver: Arc<dyn Fn() -> Result<PathBuf, String> + Send + Sync> = match forge {
        Some(name) => {
            let pinned_root = forge_root.clone();
            Arc::new(move || validate_forge_root(&name, pinned_root.clone()))
        }
        None => Arc::new(|| resolve_forge(None)),
    };
    let config = crate::persist::read_config();
    let semantic_model = config
        .semantic_model
        .as_deref()
        .unwrap_or(crate::semantic::DEFAULT_MODEL_ID);
    let semantic_ready = config.semantic_enabled.unwrap_or(false)
        && crate::semantic::prepare_mcp_search(&forge_root, semantic_model);
    let context = tools::ToolContext::dynamic(forge_resolver, forge_root, semantic_ready);
    server::serve(std::io::stdin().lock(), std::io::stdout().lock(), context)
}

fn resolve_forge(requested: Option<&str>) -> Result<PathBuf, String> {
    let explicit = requested.is_some();
    let name = requested
        .map(str::to_owned)
        .unwrap_or_else(crate::paths::get_active_forge_name);
    resolve_forge_at(
        &crate::paths::get_forges_root(),
        &name,
        explicit,
        crate::migration::adopt_stray_root_layout,
    )
}

fn resolve_forge_at<F>(
    forges_root: &std::path::Path,
    name: &str,
    explicit: bool,
    adopt_strays: F,
) -> Result<PathBuf, String>
where
    F: FnOnce() -> Result<bool, String>,
{
    if !crate::validation::is_safe_existing_filename(name) {
        return Err("Invalid Forge name".to_string());
    }
    let root = forges_root.join(name);
    if explicit {
        return validate_forge_root(name, root);
    }
    if std::fs::symlink_metadata(&root)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Refusing to use a symlinked Forge".to_string());
    }
    if !root.is_dir() {
        if !crate::validation::is_safe_filename(name) {
            return Err("Invalid Forge name".to_string());
        }
        // MCP-first installs leave the default config implicit; GUI startup
        // persists forgesRoot/activeForge through the normal migration path.
        adopt_strays()?;
        if !root.is_dir() {
            crate::commands::forges::scaffold_forge(&root)?;
            eprintln!(
                "Created missing active Forge '{name}' at {}",
                root.display()
            );
        }
    }
    Ok(root)
}

fn validate_forge_root(name: &str, root: PathBuf) -> Result<PathBuf, String> {
    if std::fs::symlink_metadata(&root)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Refusing to use a symlinked Forge".to_string());
    }
    if !root.is_dir() {
        return Err(format!("Forge '{name}' does not exist"));
    }
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "moldavite-mcp-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn pinned_missing_forge_errors() {
        let root = temp_root("pinned-missing");

        assert_eq!(
            resolve_forge_at(&root, "Missing", true, || Ok(false)),
            Err("Forge 'Missing' does not exist".to_string())
        );
        assert!(!root.join("Missing").exists());
    }

    #[test]
    fn unpinned_missing_forge_is_scaffolded() {
        let root = temp_root("unpinned-missing");
        let forge = resolve_forge_at(&root, "Default", false, || Ok(false)).unwrap();

        for sub in ["daily", "notes", "weekly", "templates", ".trash"] {
            assert!(forge.join(sub).is_dir(), "missing {sub}");
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn existing_legacy_forge_is_addressable_but_not_scaffolded() {
        let root = temp_root("legacy-name");
        std::fs::create_dir_all(root.join("Q3: Roadmap")).unwrap();

        assert_eq!(
            resolve_forge_at(&root, "Q3: Roadmap", true, || Ok(false)).unwrap(),
            root.join("Q3: Roadmap")
        );
        assert_eq!(
            resolve_forge_at(&root, "Reports.", false, || Ok(false)),
            Err("Invalid Forge name".to_string())
        );
        assert!(!root.join("Reports.").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn unpinned_missing_forge_adopts_strays_before_scaffolding() {
        let root = temp_root("unpinned-adoption");
        std::fs::create_dir_all(root.join("daily")).unwrap();
        std::fs::write(root.join("daily/stray.md"), "preserved").unwrap();

        let forge = resolve_forge_at(&root, "Default", false, || {
            crate::migration::adopt_stray_root_layout_at(&root, "Default")
        })
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(forge.join("daily/stray.md")).unwrap(),
            "preserved"
        );
        assert!(!root.join("daily").exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_forge_errors_before_resolution() {
        use std::os::unix::fs::symlink;

        let root = temp_root("symlink");
        let target = root.join("target");
        std::fs::create_dir_all(&target).unwrap();
        symlink(&target, root.join("Default")).unwrap();

        assert_eq!(
            resolve_forge_at(&root, "Default", false, || Ok(false)),
            Err("Refusing to use a symlinked Forge".to_string())
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
