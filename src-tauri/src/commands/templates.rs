//! Template management operations
//!
//! This module handles template-related Tauri commands including:
//! - Listing available templates (built-in and custom)
//! - Creating, updating, and deleting custom templates
//! - Applying templates to create new notes
//!
//! # Template System
//! - Built-in templates are embedded in the binary
//! - Custom templates are stored in `templates/` directory
//! - Templates support variables: {{date}}, {{time}}, {{day_of_week}}

use crate::utils::get_templates_dir;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/// A template with all its content
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    /// Unique identifier (slug format)
    pub id: String,
    /// Display name
    pub name: String,
    /// Short description
    pub description: String,
    /// Icon name (lucide icon)
    pub icon: String,
    /// Whether this is a built-in template
    pub is_default: bool,
    /// Template content (Markdown)
    pub content: String,
}

/// Template file listing (without content)
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemplateFile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: String,
}

/// Input for saving a new template
#[derive(Debug, Deserialize)]
pub struct SaveTemplateInput {
    pub name: String,
    pub description: String,
    pub icon: String,
    pub content: String,
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/// Ensure templates directory exists
pub fn ensure_templates_dir() -> Result<(), String> {
    let templates_dir = get_templates_dir();
    fs::create_dir_all(&templates_dir).map_err(|e| e.to_string())?;
    Ok(())
}

/// Get built-in default templates
pub fn get_default_templates() -> Vec<Template> {
    vec![
        Template {
            id: "meeting-notes".to_string(),
            name: "Meeting Notes".to_string(),
            description: "Structured template for meeting documentation".to_string(),
            icon: "users".to_string(),
            is_default: true,
            content: include_str!("../templates/meeting-notes.md").to_string(),
        },
        Template {
            id: "daily-log".to_string(),
            name: "Daily Log".to_string(),
            description: "Track your daily goals, accomplishments, and reflections".to_string(),
            icon: "calendar".to_string(),
            is_default: true,
            content: include_str!("../templates/daily-log.md").to_string(),
        },
        Template {
            id: "project-plan".to_string(),
            name: "Project Plan".to_string(),
            description: "Plan and track project goals, timeline, and resources".to_string(),
            icon: "clipboard".to_string(),
            is_default: true,
            content: include_str!("../templates/project-plan.md").to_string(),
        },
    ]
}

/// Replace template variables with current values
pub fn replace_template_variables(content: String) -> String {
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let time = now.format("%H:%M").to_string();
    let day_of_week = now.format("%A").to_string();

    content
        .replace("{{date}}", &date)
        .replace("{{time}}", &time)
        .replace("{{day_of_week}}", &day_of_week)
}

/// Generate a template ID from a name
pub fn generate_template_id(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<&str>>()
        .join("-")
}

// =============================================================================
// TAURI COMMANDS
// =============================================================================

// Note: The actual Tauri command implementations remain in lib.rs for now.
// This module defines the shared types and helper functions.
//
// Commands to be migrated here:
// - list_templates
// - get_template
// - save_template
// - update_template
// - delete_template
// - apply_template
// - create_note_from_template
