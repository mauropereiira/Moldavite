// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--mcp") {
        if let Err(error) = moldavite_lib::mcp::run_from_env() {
            eprintln!("Moldavite MCP server error: {error}");
            std::process::exit(1);
        }
        return;
    }
    moldavite_lib::run();
}
