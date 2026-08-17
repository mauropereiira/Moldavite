//! Binary entry point that selects a headless mode before Tauri starts.
//!
//! Neither `--mcp` nor the browser-messaging host may initialize the GUI: both
//! own stdin and stdout, and a window would be a bug the caller cannot see.

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();

    if args.iter().any(|arg| arg == "--mcp") {
        if let Err(error) = moldavite_lib::mcp::run_from_env() {
            eprintln!("Moldavite MCP server error: {error}");
            std::process::exit(1);
        }
        return;
    }

    if moldavite_lib::browser_host::is_browser_host_launch(&args) {
        if let Err(error) = moldavite_lib::browser_host::run() {
            eprintln!("Moldavite browser host error: {error}");
            std::process::exit(1);
        }
        return;
    }

    moldavite_lib::run();
}
