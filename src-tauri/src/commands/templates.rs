//! Template management commands.

use std::fs;

use crate::paths::{ensure_templates_dir, get_daily_dir, get_standalone_dir, get_templates_dir};
use crate::templates_data::{
    generate_template_id, get_default_templates, replace_template_variables,
};
use crate::types::{SaveTemplateInput, Template};

#[tauri::command]
pub(crate) fn list_templates() -> Result<Vec<Template>, String> {
    let mut templates = get_default_templates();

    // Load custom templates from disk
    let templates_dir = get_templates_dir()?;
    if templates_dir.exists() {
        if let Ok(entries) = fs::read_dir(&templates_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "json") {
                    if let Ok(content) = fs::read_to_string(&path) {
                        if let Ok(template) = serde_json::from_str::<Template>(&content) {
                            templates.push(template);
                        }
                    }
                }
            }
        }
    }

    Ok(templates)
}

#[tauri::command]
pub(crate) fn get_template(id: String) -> Result<Template, String> {
    // Check default templates first
    let defaults = get_default_templates();
    if let Some(template) = defaults.into_iter().find(|t| t.id == id) {
        return Ok(template);
    }

    // Check custom templates
    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if template_path.exists() {
        let content = fs::read_to_string(&template_path).map_err(|e| e.to_string())?;
        let template: Template = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(template);
    }

    Err(format!("Template '{}' not found", id))
}

#[tauri::command]
pub(crate) fn save_template(input: SaveTemplateInput) -> Result<Template, String> {
    ensure_templates_dir()?;

    let id = generate_template_id(&input.name);
    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    // Check if template with this ID already exists
    if template_path.exists() {
        return Err(format!("A template with the name '{}' already exists", input.name));
    }

    // Check if trying to overwrite a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot overwrite a default template".to_string());
    }

    let template = Template {
        id: id.clone(),
        name: input.name,
        description: input.description,
        icon: input.icon,
        is_default: false,
        content: input.content,
    };

    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    fs::write(&template_path, json).map_err(|e| e.to_string())?;

    Ok(template)
}

#[tauri::command]
pub(crate) fn update_template(id: String, input: SaveTemplateInput) -> Result<Template, String> {
    // Check if trying to update a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot modify a default template".to_string());
    }

    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if !template_path.exists() {
        return Err(format!("Template '{}' not found", id));
    }

    let template = Template {
        id: id.clone(),
        name: input.name,
        description: input.description,
        icon: input.icon,
        is_default: false,
        content: input.content,
    };

    let json = serde_json::to_string_pretty(&template).map_err(|e| e.to_string())?;
    fs::write(&template_path, json).map_err(|e| e.to_string())?;

    Ok(template)
}

#[tauri::command]
pub(crate) fn delete_template(id: String) -> Result<(), String> {
    // Check if trying to delete a default template
    let defaults = get_default_templates();
    if defaults.iter().any(|t| t.id == id) {
        return Err("Cannot delete a default template".to_string());
    }

    let templates_dir = get_templates_dir()?;
    let template_path = templates_dir.join(format!("{}.json", id));

    if template_path.exists() {
        fs::remove_file(&template_path).map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub(crate) fn apply_template(template_id: String) -> Result<String, String> {
    let template = get_template(template_id)?;
    let content = replace_template_variables(template.content);
    Ok(content)
}

#[tauri::command]
pub(crate) fn create_note_from_template(
    filename: String,
    template_id: String,
    is_daily: bool,
) -> Result<(), String> {
    let dir = if is_daily {
        get_daily_dir()
    } else {
        get_standalone_dir()
    };

    let path = dir.join(&filename);

    if path.exists() {
        return Err("A note with this name already exists".to_string());
    }

    let template = get_template(template_id)?;
    let content = replace_template_variables(template.content);

    fs::write(&path, content).map_err(|e| e.to_string())?;

    // Set restrictive file permissions (600 = owner read/write only)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&path, permissions).map_err(|e| e.to_string())?;
    }

    Ok(())
}
