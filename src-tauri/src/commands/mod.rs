//! Tauri command surface, partitioned by the user-data domain each module owns.
//!
//! Commands are the IPC trust boundary: path-shaped arguments are validated by
//! their domain before access, user-data writes go through atomic persistence,
//! and stateful indexes are updated only after the corresponding disk operation.

pub mod backlinks;
pub mod export_import;
pub mod folders;
pub mod forges;
pub mod graph;
pub mod locking;
pub mod mcp_settings;
pub mod misc;
pub mod notes;
pub mod plugins;
pub mod root_files;
pub mod search;
pub mod semantic;
pub mod templates;
pub mod trash;
