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
    let config = crate::persist::read_config();
    let semantic_model = config
        .semantic_model
        .as_deref()
        .unwrap_or(crate::semantic::DEFAULT_MODEL_ID);
    let semantic_ready = config.semantic_enabled.unwrap_or(false)
        && crate::semantic::prepare_mcp_search(&forge_root, semantic_model);
    let context = tools::ToolContext::dynamic(forge_root, semantic_ready);
    server::serve(std::io::stdin().lock(), std::io::stdout().lock(), context)
}

fn resolve_forge(requested: Option<&str>) -> Result<PathBuf, String> {
    let name = requested
        .map(str::to_owned)
        .unwrap_or_else(crate::paths::get_active_forge_name);
    if !crate::validation::is_safe_filename(&name) {
        return Err("Invalid Forge name".to_string());
    }
    let root = crate::paths::get_forges_root().join(&name);
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
