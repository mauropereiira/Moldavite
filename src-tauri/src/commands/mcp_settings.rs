//! GUI-facing discovery and write-consent settings for the built-in MCP server.
//!
//! Write access is persisted as an explicit opt-in and defaults to false. The
//! running MCP tool context re-reads this value per request, so changing it takes
//! effect without restarting an existing client session.

use crate::persist::{read_config, write_config};

#[tauri::command]
pub(crate) fn get_app_binary_path() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| format!("Failed to locate the Moldavite binary: {error}"))
}

#[tauri::command]
pub(crate) fn get_mcp_writes_enabled() -> bool {
    read_config().mcp_writes_enabled.unwrap_or(false)
}

#[tauri::command]
pub(crate) fn set_mcp_writes_enabled(enabled: bool) -> Result<(), String> {
    let mut config = read_config();
    config.mcp_writes_enabled = Some(enabled);
    write_config(&config)
}
