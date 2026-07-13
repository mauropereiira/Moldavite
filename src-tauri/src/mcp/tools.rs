use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{Local, NaiveDate};
use serde_json::{json, Value};
use walkdir::WalkDir;

use crate::commands::search::search_notes_content_in;
use crate::persist::write_atomic;
use crate::validation::{is_safe_filename, is_safe_note_path, validate_path_within_base};

const WRITE_DISABLED: &str =
    "MCP writes are disabled. Enable Settings → AI & Agents → Allow agents to write.";

#[derive(Clone)]
pub(super) struct ToolContext {
    forge_root: PathBuf,
    write_gate: Arc<dyn Fn() -> bool + Send + Sync>,
    semantic_ready: bool,
}

impl ToolContext {
    #[cfg(test)]
    pub(super) fn new(forge_root: PathBuf, writes_enabled: bool, semantic_ready: bool) -> Self {
        Self {
            forge_root,
            write_gate: Arc::new(move || writes_enabled),
            semantic_ready,
        }
    }

    /// Re-read the persisted setting for every request so disabling writes
    /// takes effect in already-running MCP sessions.
    pub(super) fn dynamic(forge_root: PathBuf, semantic_ready: bool) -> Self {
        Self {
            forge_root,
            write_gate: Arc::new(|| {
                crate::persist::read_config()
                    .mcp_writes_enabled
                    .unwrap_or(false)
            }),
            semantic_ready,
        }
    }

    #[cfg(test)]
    pub(super) fn with_write_gate(
        forge_root: PathBuf,
        write_gate: Arc<dyn Fn() -> bool + Send + Sync>,
    ) -> Self {
        Self {
            forge_root,
            write_gate,
            semantic_ready: false,
        }
    }

    fn writes_enabled(&self) -> bool {
        (self.write_gate)()
    }

    pub(super) fn tool_definitions(&self) -> Vec<Value> {
        let mut tools = read_tool_definitions();
        if self.writes_enabled() {
            tools.extend(write_tool_definitions());
        }
        tools
    }

    pub(super) fn call(&self, name: &str, arguments: &Value) -> Value {
        let result = match name {
            "search_notes" => self.search_notes(arguments),
            "read_note" => self.read_note(arguments),
            "list_notes" => self.list_notes(arguments),
            "get_backlinks" => self.get_backlinks(arguments),
            "create_note" | "append_to_daily_note" | "write_note" if !self.writes_enabled() => {
                Err(WRITE_DISABLED.to_string())
            }
            "create_note" => self.create_note(arguments),
            "append_to_daily_note" => self.append_to_daily_note(arguments),
            "write_note" => self.write_note(arguments),
            _ => Err(format!("Unknown tool: {name}")),
        };
        match result {
            Ok(value) => tool_result(value, false),
            Err(error) => tool_result(json!({ "error": error }), true),
        }
    }

    fn search_notes(&self, arguments: &Value) -> Result<Value, String> {
        let query = required_string(arguments, "query")?;
        let limit = optional_u32(arguments, "limit")?
            .unwrap_or(20)
            .clamp(1, 100);
        if self.semantic_ready && crate::semantic::service().is_ready() {
            if let Ok(results) = crate::semantic::service().search(query, limit as usize) {
                return Ok(json!({ "mode": "semantic", "results": results }));
            }
        }
        let results = search_notes_content_in(
            &self.forge_root,
            &self.forge_root.join(".trash"),
            query,
            limit,
        );
        Ok(json!({ "mode": "keyword", "results": results }))
    }

    fn read_note(&self, arguments: &Value) -> Result<Value, String> {
        let rel = validated_note_path(required_string(arguments, "path")?)?;
        let path = self.checked_existing_note(&rel)?;
        let content =
            fs::read_to_string(&path).map_err(|error| format!("Failed to read note: {error}"))?;
        Ok(json!({ "path": rel, "content": content }))
    }

    fn list_notes(&self, arguments: &Value) -> Result<Value, String> {
        let folder = match arguments.get("folder") {
            None | Some(Value::Null) => None,
            Some(Value::String(folder)) => Some(validated_folder(folder)?),
            Some(_) => return Err("folder must be a string".to_string()),
        };
        let mut notes = Vec::new();
        for entry in WalkDir::new(&self.forge_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || (!entry.file_name().to_string_lossy().starts_with('.')
                        && (entry.depth() > 1
                            || matches!(
                                entry.file_name().to_string_lossy().as_ref(),
                                "daily" | "weekly" | "notes"
                            )))
            })
            .flatten()
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let Ok(rel) = entry.path().strip_prefix(&self.forge_root) else {
                continue;
            };
            let mut rel = rel.to_string_lossy().replace('\\', "/");
            let locked = rel.ends_with(".md.locked");
            if locked {
                rel.truncate(rel.len() - ".locked".len());
            } else if !rel.ends_with(".md") {
                continue;
            }
            if let Some(folder) = folder.as_deref() {
                if rel != folder && !rel.starts_with(&format!("{folder}/")) {
                    continue;
                }
            }
            notes.push(json!({ "path": rel, "isLocked": locked }));
        }
        notes.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
        Ok(json!({ "notes": notes }))
    }

    fn get_backlinks(&self, arguments: &Value) -> Result<Value, String> {
        let target_rel = validated_note_path(required_string(arguments, "path")?)?;
        self.checked_existing_note(&target_rel)?;
        let target_filename = Path::new(&target_rel)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Invalid note path".to_string())?;
        let target_stem = target_filename.trim_end_matches(".md");
        let mut seen = HashSet::new();
        let mut backlinks = Vec::new();
        for entry in WalkDir::new(&self.forge_root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0 || !entry.file_name().to_string_lossy().starts_with('.')
            })
            .flatten()
        {
            if !entry.file_type().is_file()
                || entry.path().extension().and_then(|ext| ext.to_str()) != Some("md")
            {
                continue;
            }
            let Ok(source_rel) = entry.path().strip_prefix(&self.forge_root) else {
                continue;
            };
            let source_rel = source_rel.to_string_lossy().replace('\\', "/");
            if source_rel == target_rel {
                continue;
            }
            let Ok(raw) = fs::read_to_string(entry.path()) else {
                continue;
            };
            let content = crate::frontmatter::parse_note(&raw).body;
            let links = crate::wiki::parse_wiki_links(&content);
            if let Some(link) = links.iter().find(|link| {
                crate::wiki::note_name_to_filename(link) == target_filename
                    || link.as_str() == target_stem
            }) {
                if seen.insert(source_rel.clone()) {
                    let fallback = source_rel
                        .rsplit('/')
                        .next()
                        .unwrap_or(source_rel.as_str())
                        .trim_end_matches(".md");
                    let title = content
                        .lines()
                        .find_map(|line| line.strip_prefix("# "))
                        .map(str::trim)
                        .filter(|title| !title.is_empty())
                        .unwrap_or(fallback);
                    backlinks.push(json!({
                        "fromNote": source_rel,
                        "fromTitle": title,
                        "context": crate::wiki::get_link_context(&content, link)
                    }));
                }
            }
        }
        Ok(json!({ "path": target_rel, "backlinks": backlinks }))
    }

    fn create_note(&self, arguments: &Value) -> Result<Value, String> {
        let rel = validated_note_path(required_string(arguments, "path")?)?;
        let content = required_string(arguments, "content")?;
        let path = self.prepare_note_destination(&rel)?;
        if locked_path(&path).exists() {
            return Err("Refusing to create a locked note".to_string());
        }
        if path.exists() {
            return Err("Note already exists; use write_note to replace it".to_string());
        }
        write_atomic(&path, content.as_bytes(), Some(0o600))?;
        self.note_changed(&rel);
        Ok(json!({ "path": rel, "created": true }))
    }

    fn append_to_daily_note(&self, arguments: &Value) -> Result<Value, String> {
        let content = required_string(arguments, "content")?;
        let date = match arguments.get("date") {
            None | Some(Value::Null) => Local::now().date_naive(),
            Some(Value::String(date)) => {
                NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| {
                    "date must be a real calendar date in YYYY-MM-DD format".to_string()
                })?
            }
            Some(_) => return Err("date must be a string".to_string()),
        };
        let rel = format!("daily/{}.md", date.format("%Y-%m-%d"));
        let path = self.prepare_note_destination(&rel)?;
        if locked_path(&path).exists() {
            return Err("Refusing to append to a locked note".to_string());
        }
        let created = !path.exists();
        let mut existing = if !created {
            fs::read_to_string(&path)
                .map_err(|error| format!("Failed to read daily note: {error}"))?
        } else {
            String::new()
        };
        if !existing.is_empty() && !existing.ends_with('\n') {
            existing.push('\n');
        }
        existing.push_str(content);
        write_atomic(&path, existing.as_bytes(), Some(0o600))?;
        self.note_changed(&rel);
        Ok(json!({ "path": rel, "created": created }))
    }

    fn write_note(&self, arguments: &Value) -> Result<Value, String> {
        let rel = validated_note_path(required_string(arguments, "path")?)?;
        let content = required_string(arguments, "content")?;
        let path = self.prepare_note_destination(&rel)?;
        if locked_path(&path).exists() {
            return Err("Refusing to write a locked note".to_string());
        }
        if !path.exists() {
            return Err("Note does not exist; use create_note first".to_string());
        }
        reject_symlink(&path)?;
        write_atomic(&path, content.as_bytes(), Some(0o600))?;
        self.note_changed(&rel);
        Ok(json!({ "path": rel, "written": true }))
    }

    fn checked_existing_note(&self, rel: &str) -> Result<PathBuf, String> {
        let path = self.forge_root.join(rel);
        if locked_path(&path).exists() {
            return Err("This note is locked and cannot be accessed through MCP".to_string());
        }
        if !path.is_file() {
            return Err("Note not found".to_string());
        }
        reject_symlink(&path)?;
        validate_path_within_base(&path, &self.forge_root)?;
        Ok(path)
    }

    fn prepare_note_destination(&self, rel: &str) -> Result<PathBuf, String> {
        let path = self.forge_root.join(rel);
        let parent = path
            .parent()
            .ok_or_else(|| "Invalid note path".to_string())?;
        ensure_directory_tree(&self.forge_root, parent)?;
        validate_path_within_base(&path, &self.forge_root)?;
        Ok(path)
    }

    fn note_changed(&self, rel: &str) {
        crate::semantic::note_changed_in(rel, self.forge_root.clone());
    }
}

fn read_tool_definitions() -> Vec<Value> {
    vec![
        tool("search_notes", "Search unlocked notes. Uses the local semantic index when it is enabled and ready, otherwise performs keyword full-text search. The response always identifies the mode used.", json!({"type":"object","properties":{"query":{"type":"string","description":"Words or meaning to search for."},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20}},"required":["query"],"additionalProperties":false})),
        tool("read_note", "Read one unlocked Markdown note using a Forge-relative path such as daily/2026-07-12.md or notes/Projects/foo.md.", note_path_schema(true)),
        tool("list_notes", "List notes and locked-note placeholders, optionally restricted to a Forge-relative folder such as daily, notes, or notes/Projects.", json!({"type":"object","properties":{"folder":{"type":"string","description":"Optional Forge-relative folder."}},"additionalProperties":false})),
        tool("get_backlinks", "Find unlocked notes that contain wiki-links to the specified note.", note_path_schema(true)),
    ]
}

fn write_tool_definitions() -> Vec<Value> {
    vec![
        tool("create_note", "Create a new Markdown note. Refuses to overwrite an existing or locked note.", content_path_schema()),
        tool("append_to_daily_note", "Append Markdown to a daily note, creating it when absent. Defaults to today's local date.", json!({"type":"object","properties":{"content":{"type":"string","description":"Markdown to append."},"date":{"type":"string","format":"date","description":"Optional YYYY-MM-DD date; defaults to today."}},"required":["content"],"additionalProperties":false})),
        tool("write_note", "Fully replace an existing unlocked Markdown note. Refuses missing and locked notes.", content_path_schema()),
    ]
}

fn tool(name: &str, description: &str, input_schema: Value) -> Value {
    json!({ "name": name, "description": description, "inputSchema": input_schema })
}

fn note_path_schema(required: bool) -> Value {
    let required = if required { json!(["path"]) } else { json!([]) };
    json!({"type":"object","properties":{"path":{"type":"string","description":"Forge-relative note path under daily/, weekly/, or notes/."}},"required":required,"additionalProperties":false})
}

fn content_path_schema() -> Value {
    json!({"type":"object","properties":{"path":{"type":"string","description":"Forge-relative .md note path."},"content":{"type":"string","description":"Complete Markdown file content."}},"required":["path","content"],"additionalProperties":false})
}

fn tool_result(value: Value, is_error: bool) -> Value {
    let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
    json!({
        "content": [{ "type": "text", "text": text }],
        "structuredContent": value,
        "isError": is_error
    })
}

fn required_string<'a>(arguments: &'a Value, name: &str) -> Result<&'a str, String> {
    arguments
        .get(name)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{name} must be a string"))
}

fn optional_u32(arguments: &Value, name: &str) -> Result<Option<u32>, String> {
    match arguments.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .map(Some)
            .ok_or_else(|| format!("{name} must be a non-negative integer")),
    }
}

fn validated_note_path(path: &str) -> Result<String, String> {
    let Some((top, rest)) = path.split_once('/') else {
        return Err("Invalid note path; expected daily/, weekly/, or notes/".to_string());
    };
    if !is_safe_filename(top)
        || !matches!(top, "daily" | "weekly" | "notes")
        || !(if top == "notes" {
            is_safe_note_path(rest)
        } else {
            is_safe_filename(rest)
        })
        || !rest.ends_with(".md")
    {
        return Err("Invalid note path".to_string());
    }
    Ok(path.to_string())
}

fn validated_folder(folder: &str) -> Result<String, String> {
    if is_safe_filename(folder) && matches!(folder, "daily" | "weekly" | "notes") {
        return Ok(folder.to_string());
    }
    let Some((top, rest)) = folder.split_once('/') else {
        return Err("Invalid folder path".to_string());
    };
    if top != "notes" || !is_safe_filename(top) || !is_safe_note_path(rest) {
        return Err("Invalid folder path".to_string());
    }
    Ok(folder.to_string())
}

fn locked_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}.locked", path.to_string_lossy()))
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("Refusing to access a symlinked note".to_string());
    }
    Ok(())
}

fn ensure_directory_tree(base: &Path, destination: &Path) -> Result<(), String> {
    let relative = destination
        .strip_prefix(base)
        .map_err(|_| "Path traversal attempt detected".to_string())?;
    let mut current = base.to_path_buf();
    for component in relative.components() {
        let name = component.as_os_str().to_string_lossy();
        if !is_safe_filename(&name) {
            return Err("Invalid note path".to_string());
        }
        current.push(component);
        if current.exists() {
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| format!("Failed to inspect note folder: {error}"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("Refusing to traverse an unsafe note folder".to_string());
            }
        } else {
            fs::create_dir(&current)
                .map_err(|error| format!("Failed to create note folder: {error}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&current, fs::Permissions::from_mode(0o700))
                    .map_err(|error| format!("Failed to secure note folder: {error}"))?;
            }
        }
    }
    Ok(())
}
