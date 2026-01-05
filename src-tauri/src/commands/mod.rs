//! Tauri command modules
//!
//! This module organizes Tauri commands into logical groups.
//! Currently contains type definitions and helper functions that will be
//! used when commands are migrated from lib.rs.
//!
//! # Module Organization
//!
//! - `notes` - Note CRUD operations
//! - `folders` - Folder management
//! - `trash` - Trash/recycle bin operations
//! - `templates` - Template management
//! - `encryption` - Note locking/unlocking
//! - `import_export` - Import/export and backup
//! - `wiki` - Wiki link operations
//! - `metadata` - Note metadata (colors, etc.)
//!
//! # Migration Status
//!
//! Commands currently remain in lib.rs. These modules contain the type
//! definitions and helper functions that will enable incremental migration.

#[allow(dead_code)]
pub mod encryption;
#[allow(dead_code)]
pub mod folders;
#[allow(dead_code)]
pub mod import_export;
#[allow(dead_code)]
pub mod metadata;
#[allow(dead_code)]
pub mod notes;
#[allow(dead_code)]
pub mod templates;
#[allow(dead_code)]
pub mod trash;
#[allow(dead_code)]
pub mod wiki;
