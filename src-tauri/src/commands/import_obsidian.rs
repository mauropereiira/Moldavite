//! One-time, read-only Obsidian vault analysis and COPY import.
//!
//! The source tree is traversed with `symlink_metadata` and is never mutated.
//! Imported notes are planned into a newly scaffolded Forge, path segments are
//! sanitized and collision-deduplicated, and every destination file is written
//! through [`crate::persist::write_atomic`].

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

use chrono::NaiveDate;
use lazy_static::lazy_static;
use regex::Regex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::commands::forges::{create_forge, looks_like_forge, scaffold_forge};
use crate::paths::get_forges_root;
use crate::persist::write_atomic;
use crate::validation::{is_safe_filename, validate_path_within_base};

pub(crate) const OBSIDIAN_IMPORT_PROGRESS_EVENT: &str = "obsidian-import://progress";
const PROGRESS_INTERVAL: usize = 10;
const DEFAULT_DAILY_FORMAT: &str = "YYYY-MM-DD";

lazy_static! {
    static ref WIKI_LINK_RE: Regex =
        Regex::new(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").expect("valid wiki-link regex");
    static ref WIKI_EMBED_RE: Regex =
        Regex::new(r"!\[\[([^\]]+)\]\]").expect("valid wiki-embed regex");
    static ref MARKDOWN_IMAGE_RE: Regex =
        Regex::new(r#"!\[([^\]]*)\]\((?:<([^>]+)>|([^\s\)]+))(?:\s+([\"'][^\"']*[\"']))?\)"#,)
            .expect("valid Markdown image regex");
    static ref FRONTMATTER_RE: Regex =
        Regex::new(r"(?s)\A(?:\u{feff})?---\r?\n.*?\r?\n---(?:\r?\n|\z)",)
            .expect("valid frontmatter regex");
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObsidianDailyNotesConfig {
    pub(crate) folder: String,
    pub(crate) format: String,
}

impl Default for ObsidianDailyNotesConfig {
    fn default() -> Self {
        Self {
            folder: String::new(),
            format: DEFAULT_DAILY_FORMAT.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObsidianVaultPreview {
    pub(crate) note_count: usize,
    pub(crate) attachment_count: usize,
    pub(crate) detected_daily_notes: Option<ObsidianDailyNotesConfig>,
    pub(crate) folder_count: usize,
    pub(crate) canvas_count: usize,
    pub(crate) estimated_collisions: usize,
    pub(crate) has_obsidian_directory: bool,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObsidianImportProgress {
    pub(crate) current: usize,
    pub(crate) total: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkippedImportItem {
    pub(crate) path: String,
    pub(crate) reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObsidianImportReport {
    pub(crate) forge_name: String,
    pub(crate) daily_notes_imported: usize,
    pub(crate) standalone_notes_imported: usize,
    pub(crate) attachments_imported: usize,
    pub(crate) skipped_items: Vec<SkippedImportItem>,
    pub(crate) link_conversions_performed: usize,
    pub(crate) warnings: Vec<String>,
}

#[derive(Debug, Default)]
struct VaultScan {
    notes: Vec<SourceFile>,
    attachments: Vec<SourceFile>,
    folder_count: usize,
    canvas_count: usize,
    skipped: Vec<SkippedImportItem>,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
struct SourceFile {
    absolute: PathBuf,
    relative: PathBuf,
}

#[derive(Debug)]
struct DailyConfigState {
    detected: Option<ObsidianDailyNotesConfig>,
    effective: ObsidianDailyNotesConfig,
    warnings: Vec<String>,
}

#[derive(Debug, Clone)]
enum NoteKind {
    Daily(NaiveDate),
    Standalone,
}

#[derive(Debug, Clone)]
struct PlannedNote {
    source: SourceFile,
    destination: PathBuf,
    kind: NoteKind,
}

#[derive(Debug, Default)]
struct NotePlan {
    notes: Vec<PlannedNote>,
    collisions: usize,
}

#[derive(Debug, Default)]
struct FolderPlanner {
    mapped: HashMap<PathBuf, PathBuf>,
    used_by_destination_parent: HashMap<PathBuf, HashSet<String>>,
    collisions: usize,
}

impl FolderPlanner {
    fn new() -> Self {
        let mut mapped = HashMap::new();
        mapped.insert(PathBuf::new(), PathBuf::new());
        Self {
            mapped,
            ..Self::default()
        }
    }

    fn destination_for(&mut self, source_folder: &Path) -> Result<PathBuf, String> {
        if let Some(existing) = self.mapped.get(source_folder) {
            return Ok(existing.clone());
        }
        let parent = source_folder.parent().unwrap_or_else(|| Path::new(""));
        let destination_parent = self.destination_for(parent)?;
        let raw = source_folder
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Source folder has a non-Unicode name".to_string())?;
        let sanitized = sanitize_path_segment(raw, "Untitled");
        let used = self
            .used_by_destination_parent
            .entry(destination_parent.clone())
            .or_default();
        let (deduped, collided) = dedupe_name(&sanitized, None, used);
        if collided {
            self.collisions += 1;
        }
        let mapped = destination_parent.join(deduped);
        self.mapped
            .insert(source_folder.to_path_buf(), mapped.clone());
        Ok(mapped)
    }
}

#[derive(Debug, Default)]
struct AttachmentIndex {
    by_relative: HashMap<String, SourceFile>,
    by_name: HashMap<String, Vec<SourceFile>>,
}

impl AttachmentIndex {
    fn new(files: &[SourceFile]) -> Self {
        let mut index = Self::default();
        for file in files {
            let relative_key = normalized_path_key(&file.relative);
            index.by_relative.insert(relative_key, file.clone());
            if let Some(name) = file.relative.file_name().and_then(|name| name.to_str()) {
                index
                    .by_name
                    .entry(name.to_lowercase())
                    .or_default()
                    .push(file.clone());
            }
        }
        index
    }

    fn resolve(
        &self,
        reference: &str,
        note_relative: &Path,
        prefer_note_relative: bool,
    ) -> Option<SourceFile> {
        let cleaned = clean_attachment_reference(reference)?;
        let note_parent = note_relative.parent().unwrap_or_else(|| Path::new(""));
        let note_relative_candidate = normalize_source_relative(note_parent, &cleaned);
        let vault_relative_candidate = normalize_source_relative(Path::new(""), &cleaned);
        let candidates = if prefer_note_relative {
            [note_relative_candidate, vault_relative_candidate]
        } else {
            [vault_relative_candidate, note_relative_candidate]
        };
        for candidate in candidates.into_iter().flatten() {
            if let Some(file) = self.by_relative.get(&normalized_path_key(&candidate)) {
                return Some(file.clone());
            }
        }

        let basename = Path::new(&cleaned).file_name()?.to_str()?.to_lowercase();
        let matches = self.by_name.get(&basename)?;
        if matches.len() == 1 {
            return matches.first().cloned();
        }
        None
    }
}

struct ImportContext<'a> {
    source_root: &'a Path,
    forge_root: &'a Path,
    attachment_index: AttachmentIndex,
    copied_attachments: HashMap<PathBuf, String>,
    used_attachment_names: HashSet<String>,
    warnings: Vec<String>,
    skipped: Vec<SkippedImportItem>,
    link_conversions: usize,
    attachment_collisions: usize,
}

impl<'a> ImportContext<'a> {
    fn new(
        source_root: &'a Path,
        forge_root: &'a Path,
        attachment_files: &[SourceFile],
        skipped: Vec<SkippedImportItem>,
        warnings: Vec<String>,
    ) -> Self {
        Self {
            source_root,
            forge_root,
            attachment_index: AttachmentIndex::new(attachment_files),
            copied_attachments: HashMap::new(),
            used_attachment_names: HashSet::new(),
            warnings,
            skipped,
            link_conversions: 0,
            attachment_collisions: 0,
        }
    }

    fn copy_attachment(&mut self, source: &SourceFile) -> Result<String, String> {
        if let Some(existing) = self.copied_attachments.get(&source.relative) {
            return Ok(existing.clone());
        }
        validate_source_file(self.source_root, &source.absolute)?;
        let raw_name = source
            .relative
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "Attachment has a non-Unicode name".to_string())?;
        let (stem, extension) = split_filename(raw_name);
        let sanitized_stem = sanitize_path_segment(stem, "Attachment");
        let sanitized_extension = extension.map(sanitize_extension);
        let (destination_name, collided) = dedupe_name(
            &sanitized_stem,
            sanitized_extension.as_deref(),
            &mut self.used_attachment_names,
        );
        if collided {
            self.attachment_collisions += 1;
        }

        let images_relative = PathBuf::from("images");
        ensure_destination_directory(self.forge_root, &images_relative)?;
        let destination_relative = images_relative.join(&destination_name);
        let destination = safe_destination_path(self.forge_root, &destination_relative)?;
        validate_path_within_base(&destination, self.forge_root)?;
        let bytes = fs::read(&source.absolute).map_err(|error| {
            format!(
                "Failed to read attachment '{}': {error}",
                relative_display(&source.relative)
            )
        })?;
        write_atomic(&destination, &bytes, Some(0o600))?;
        self.copied_attachments
            .insert(source.relative.clone(), destination_name.clone());
        Ok(destination_name)
    }

    fn unresolved_attachment(&mut self, reference: &str, note: &Path) {
        self.warnings.push(format!(
            "Could not resolve attachment '{}' referenced by '{}'",
            reference,
            relative_display(note)
        ));
    }
}

#[tauri::command]
pub(crate) async fn analyze_obsidian_vault(path: String) -> Result<ObsidianVaultPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        analyze_obsidian_vault_from(Path::new(&path), &get_forges_root())
    })
    .await
    .map_err(|error| format!("Obsidian analysis task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn import_obsidian_vault(
    path: String,
    forge_name: String,
    app: AppHandle,
) -> Result<ObsidianImportReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let source = validate_source_vault(Path::new(&path), &get_forges_root())?;
        // Reuse the standard Forge validation and creation path. The source is
        // fully scanned before this call, so creating the destination cannot
        // affect traversal even when the configured roots share an ancestor.
        let scan = scan_vault(&source)?;
        let daily = read_daily_notes_config(&source);
        let plan = plan_notes(&scan.notes, &daily.effective)?;
        let created = create_forge(forge_name.clone())?;
        let forge_root = PathBuf::from(&created.path);

        let result = import_prepared_vault(
            &source,
            &forge_root,
            &forge_name,
            scan,
            daily,
            plan,
            |current, total| {
                let _ = app.emit(
                    OBSIDIAN_IMPORT_PROGRESS_EVENT,
                    ObsidianImportProgress { current, total },
                );
            },
        );
        if result.is_err() {
            // This directory was created exclusively for this import. Removing
            // a failed partial copy makes a retry possible without touching the
            // source vault or any pre-existing Forge.
            let _ = fs::remove_dir_all(&forge_root);
        }
        result
    })
    .await
    .map_err(|error| format!("Obsidian import task failed: {error}"))?
}

fn analyze_obsidian_vault_from(
    source: &Path,
    forges_root: &Path,
) -> Result<ObsidianVaultPreview, String> {
    let source = validate_source_vault(source, forges_root)?;
    let scan = scan_vault(&source)?;
    let daily = read_daily_notes_config(&source);
    let plan = plan_notes(&scan.notes, &daily.effective)?;
    let attachment_collisions = estimate_attachment_collisions(&scan.attachments);
    let has_obsidian_directory = is_real_directory(&source.join(".obsidian"));
    let mut warnings = daily.warnings;
    if !has_obsidian_directory {
        warnings.push(
            "No .obsidian directory was found; default daily-note settings will be used"
                .to_string(),
        );
    }
    warnings.extend(scan.warnings);
    Ok(ObsidianVaultPreview {
        note_count: scan.notes.len(),
        attachment_count: scan.attachments.len(),
        detected_daily_notes: daily.detected,
        folder_count: scan.folder_count,
        canvas_count: scan.canvas_count,
        estimated_collisions: plan.collisions + attachment_collisions,
        has_obsidian_directory,
        warnings,
    })
}

fn import_prepared_vault<F>(
    source_root: &Path,
    forge_root: &Path,
    forge_name: &str,
    scan: VaultScan,
    daily: DailyConfigState,
    plan: NotePlan,
    mut emit_progress: F,
) -> Result<ObsidianImportReport, String>
where
    F: FnMut(usize, usize),
{
    if !forge_root.is_dir() {
        scaffold_forge(forge_root)?;
    }
    let total = plan.notes.len();
    emit_progress(0, total);
    let mut context = ImportContext::new(
        source_root,
        forge_root,
        &scan.attachments,
        scan.skipped,
        daily.warnings,
    );
    let mut daily_notes_imported = 0;
    let mut standalone_notes_imported = 0;

    for (index, note) in plan.notes.iter().enumerate() {
        match import_note(note, &mut context) {
            Ok(()) => match note.kind {
                NoteKind::Daily(_) => daily_notes_imported += 1,
                NoteKind::Standalone => standalone_notes_imported += 1,
            },
            Err(error) if error.starts_with("SKIP:") => {
                let reason = error.trim_start_matches("SKIP:").trim().to_string();
                context.skipped.push(SkippedImportItem {
                    path: relative_display(&note.source.relative),
                    reason: reason.clone(),
                });
                context.warnings.push(format!(
                    "Skipped '{}': {}",
                    relative_display(&note.source.relative),
                    reason
                ));
            }
            Err(error) => return Err(error),
        }

        let current = index + 1;
        if current % PROGRESS_INTERVAL == 0 || current == total {
            emit_progress(current, total);
        }
    }

    for attachment in &scan.attachments {
        if !context
            .copied_attachments
            .contains_key(&attachment.relative)
        {
            context.skipped.push(SkippedImportItem {
                path: relative_display(&attachment.relative),
                reason: "Unreferenced attachment".to_string(),
            });
        }
    }
    let total_collisions = plan.collisions + context.attachment_collisions;
    if total_collisions > 0 {
        context.warnings.push(format!(
            "Renamed {total_collisions} imported item(s) to avoid destination collisions"
        ));
    }
    if total == 0 {
        emit_progress(0, 0);
    }

    Ok(ObsidianImportReport {
        forge_name: forge_name.to_string(),
        daily_notes_imported,
        standalone_notes_imported,
        attachments_imported: context.copied_attachments.len(),
        skipped_items: context.skipped,
        link_conversions_performed: context.link_conversions,
        warnings: context.warnings,
    })
}

fn import_note(note: &PlannedNote, context: &mut ImportContext<'_>) -> Result<(), String> {
    validate_source_file(context.source_root, &note.source.absolute)
        .map_err(|error| format!("SKIP: {error}"))?;
    let bytes = fs::read(&note.source.absolute)
        .map_err(|error| format!("SKIP: Could not read source note: {error}"))?;
    let content =
        String::from_utf8(bytes).map_err(|_| "SKIP: Source note is not valid UTF-8".to_string())?;
    let converted = convert_note_content(&content, note, context)?;

    let parent = note
        .destination
        .parent()
        .ok_or_else(|| "Planned note has no destination parent".to_string())?;
    ensure_destination_directory(context.forge_root, parent)?;
    let destination = safe_destination_path(context.forge_root, &note.destination)?;
    validate_path_within_base(&destination, context.forge_root)?;
    write_atomic(&destination, converted.as_bytes(), Some(0o600))
}

fn convert_note_content(
    content: &str,
    note: &PlannedNote,
    context: &mut ImportContext<'_>,
) -> Result<String, String> {
    let frontmatter_end = FRONTMATTER_RE.find(content).map(|matched| matched.end());
    let (frontmatter, body) = match frontmatter_end {
        Some(end) => content.split_at(end),
        None => ("", content),
    };
    let body = convert_attachments(body, note, context)?;
    let (body, link_conversions) = convert_wiki_links(&body);
    context.link_conversions += link_conversions;
    Ok(format!("{frontmatter}{body}"))
}

enum AttachmentMatch<'a> {
    Markdown(regex::Captures<'a>),
    Wiki(regex::Captures<'a>),
}

impl AttachmentMatch<'_> {
    fn start(&self) -> usize {
        match self {
            Self::Markdown(captures) | Self::Wiki(captures) => {
                captures.get(0).expect("whole attachment match").start()
            }
        }
    }
}

/// Convert both supported attachment syntaxes in document order so the first
/// reference deterministically receives the unsuffixed destination filename.
fn convert_attachments(
    body: &str,
    note: &PlannedNote,
    context: &mut ImportContext<'_>,
) -> Result<String, String> {
    let mut matches = MARKDOWN_IMAGE_RE
        .captures_iter(body)
        .map(AttachmentMatch::Markdown)
        .chain(WIKI_EMBED_RE.captures_iter(body).map(AttachmentMatch::Wiki))
        .collect::<Vec<_>>();
    matches.sort_by_key(AttachmentMatch::start);

    let mut output = String::with_capacity(body.len());
    let mut cursor = 0;
    for attachment_match in matches {
        let whole = match &attachment_match {
            AttachmentMatch::Markdown(captures) | AttachmentMatch::Wiki(captures) => {
                captures.get(0).expect("whole attachment match")
            }
        };
        if whole.start() < cursor {
            continue;
        }
        output.push_str(&body[cursor..whole.start()]);
        match attachment_match {
            AttachmentMatch::Markdown(captures) => {
                let reference = captures
                    .get(2)
                    .or_else(|| captures.get(3))
                    .map(|matched| matched.as_str())
                    .unwrap_or_default();
                if is_remote_or_data_reference(reference) {
                    output.push_str(whole.as_str());
                } else if let Some(source) =
                    context
                        .attachment_index
                        .resolve(reference, &note.source.relative, false)
                {
                    let name = context.copy_attachment(&source)?;
                    let relative = relative_image_link(&note.destination, &name);
                    let alt = captures
                        .get(1)
                        .map(|matched| matched.as_str())
                        .unwrap_or("");
                    let title = captures.get(4).map(|matched| matched.as_str());
                    output.push_str(&format!("![{alt}](<{relative}>)"));
                    if let Some(title) = title {
                        output.truncate(output.len() - 1);
                        output.push(' ');
                        output.push_str(title);
                        output.push(')');
                    }
                } else {
                    context.unresolved_attachment(reference, &note.source.relative);
                    output.push_str(whole.as_str());
                }
            }
            AttachmentMatch::Wiki(captures) => {
                let inside = captures
                    .get(1)
                    .map(|matched| matched.as_str())
                    .unwrap_or("");
                let reference = inside.split('|').next().unwrap_or(inside).trim();
                let reference = strip_link_target_suffix(reference).trim();
                if let Some(source) =
                    context
                        .attachment_index
                        .resolve(reference, &note.source.relative, false)
                {
                    let name = context.copy_attachment(&source)?;
                    let relative = relative_image_link(&note.destination, &name);
                    output.push_str(&format!("![](<{relative}>)"));
                } else {
                    context.unresolved_attachment(reference, &note.source.relative);
                    output.push_str(whole.as_str());
                }
            }
        }
        cursor = whole.end();
    }
    output.push_str(&body[cursor..]);
    Ok(output)
}

/// Convert Obsidian `[[target|Display]]` aliases to Moldavite's verified
/// `[[Display|target]]` order and remove heading/block suffixes from targets.
fn convert_wiki_links(body: &str) -> (String, usize) {
    let mut output = String::with_capacity(body.len());
    let mut cursor = 0;
    let mut conversions = 0;
    for captures in WIKI_LINK_RE.captures_iter(body) {
        let whole = captures.get(0).expect("whole wiki-link match");
        output.push_str(&body[cursor..whole.start()]);
        if whole.start() > 0 && body.as_bytes().get(whole.start() - 1) == Some(&b'!') {
            output.push_str(whole.as_str());
            cursor = whole.end();
            continue;
        }
        let target = captures
            .get(1)
            .map(|matched| matched.as_str())
            .unwrap_or("");
        let stripped_target = strip_link_target_suffix(target);
        let replacement = match captures.get(2) {
            Some(display) => format!("[[{}|{}]]", display.as_str().trim(), stripped_target.trim()),
            None if stripped_target != target => format!("[[{}]]", stripped_target.trim()),
            None => whole.as_str().to_string(),
        };
        if replacement != whole.as_str() {
            conversions += 1;
        }
        output.push_str(&replacement);
        cursor = whole.end();
    }
    output.push_str(&body[cursor..]);
    (output, conversions)
}

fn strip_link_target_suffix(target: &str) -> &str {
    let heading = target.find('#');
    let block = target.find('^');
    let end = match (heading, block) {
        (Some(a), Some(b)) => a.min(b),
        (Some(index), None) | (None, Some(index)) => index,
        (None, None) => target.len(),
    };
    &target[..end]
}

fn plan_notes(
    source_notes: &[SourceFile],
    daily: &ObsidianDailyNotesConfig,
) -> Result<NotePlan, String> {
    let mut sorted = source_notes.to_vec();
    sorted.sort_by_key(|file| normalized_path_key(&file.relative));
    let mut folder_planner = FolderPlanner::new();
    let mut used_note_paths = HashSet::new();
    let mut notes = Vec::with_capacity(sorted.len());
    let mut collisions = 0;

    for source in sorted {
        let kind = parse_daily_note(&source.relative, daily)
            .map(NoteKind::Daily)
            .unwrap_or(NoteKind::Standalone);
        let destination = match kind {
            NoteKind::Daily(date) => {
                let base = date.format("%Y-%m-%d").to_string();
                let (name, collided) =
                    dedupe_relative_file(Path::new("daily"), &base, "md", &mut used_note_paths);
                if collided {
                    collisions += 1;
                }
                PathBuf::from("daily").join(name)
            }
            NoteKind::Standalone => {
                let source_parent = source.relative.parent().unwrap_or_else(|| Path::new(""));
                let mapped_parent = folder_planner.destination_for(source_parent)?;
                let raw_stem = source
                    .relative
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .ok_or_else(|| "Source note has a non-Unicode filename".to_string())?;
                let base = sanitize_path_segment(raw_stem, "Untitled");
                let destination_parent = PathBuf::from("notes").join(mapped_parent);
                let (name, collided) =
                    dedupe_relative_file(&destination_parent, &base, "md", &mut used_note_paths);
                if collided {
                    collisions += 1;
                }
                destination_parent.join(name)
            }
        };
        notes.push(PlannedNote {
            source,
            destination,
            kind,
        });
    }
    collisions += folder_planner.collisions;
    Ok(NotePlan { notes, collisions })
}

fn parse_daily_note(relative: &Path, daily: &ObsidianDailyNotesConfig) -> Option<NaiveDate> {
    let folder = config_relative_path(&daily.folder)?;
    let under_folder = relative.strip_prefix(&folder).ok()?;
    let mut without_extension = under_folder.to_path_buf();
    if !without_extension
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return None;
    }
    without_extension.set_extension("");
    let value = relative_display(&without_extension);
    parse_date_with_obsidian_format(&value, &daily.format)
}

fn parse_date_with_obsidian_format(value: &str, format: &str) -> Option<NaiveDate> {
    let (regex, tokens) = compile_daily_format(format)?;
    let captures = regex.captures(value)?;
    let mut year = None;
    let mut month = None;
    let mut day = None;
    for (index, token) in tokens.iter().enumerate() {
        let parsed = captures.get(index + 1)?.as_str().parse::<i32>().ok()?;
        match token.as_str() {
            "YYYY" => year = Some(parsed),
            "MM" => month = u32::try_from(parsed).ok(),
            "DD" => day = u32::try_from(parsed).ok(),
            _ => return None,
        }
    }
    NaiveDate::from_ymd_opt(year?, month?, day?)
}

fn compile_daily_format(format: &str) -> Option<(Regex, Vec<String>)> {
    let mut remaining = format;
    let mut pattern = String::from("^");
    let mut tokens = Vec::new();
    while !remaining.is_empty() {
        if let Some(token) = ["YYYY", "MM", "DD"]
            .iter()
            .find(|token| remaining.starts_with(**token))
        {
            pattern.push_str(if *token == "YYYY" {
                r"(\d{4})"
            } else {
                r"(\d{2})"
            });
            tokens.push((*token).to_string());
            remaining = &remaining[token.len()..];
            continue;
        }
        let separator = remaining.chars().next()?;
        if !matches!(separator, '-' | '_' | '.' | '/') {
            return None;
        }
        pattern.push_str(&regex::escape(&separator.to_string()));
        remaining = &remaining[separator.len_utf8()..];
    }
    if tokens.len() != 3
        || tokens
            .iter()
            .filter(|token| token.as_str() == "YYYY")
            .count()
            != 1
        || tokens.iter().filter(|token| token.as_str() == "MM").count() != 1
        || tokens.iter().filter(|token| token.as_str() == "DD").count() != 1
    {
        return None;
    }
    pattern.push('$');
    Regex::new(&pattern).ok().map(|regex| (regex, tokens))
}

fn read_daily_notes_config(source: &Path) -> DailyConfigState {
    let default = ObsidianDailyNotesConfig::default();
    let obsidian_dir = source.join(".obsidian");
    if !is_real_directory(&obsidian_dir) {
        return DailyConfigState {
            detected: None,
            effective: default,
            warnings: Vec::new(),
        };
    }
    let path = obsidian_dir.join("daily-notes.json");
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.file_type().is_file() => metadata,
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return DailyConfigState {
                detected: None,
                effective: default,
                warnings: vec![
                    "Skipped symlinked .obsidian/daily-notes.json configuration".to_string()
                ],
            }
        }
        _ => {
            return DailyConfigState {
                detected: None,
                effective: default,
                warnings: Vec::new(),
            }
        }
    };
    let _ = metadata;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            return DailyConfigState {
                detected: None,
                effective: default,
                warnings: vec![format!(
                    "Could not read daily-notes configuration; defaults will be used: {error}"
                )],
            }
        }
    };
    #[derive(Deserialize)]
    struct RawDailyConfig {
        folder: Option<String>,
        format: Option<String>,
    }
    let parsed: RawDailyConfig = match serde_json::from_str(&raw) {
        Ok(parsed) => parsed,
        Err(error) => {
            return DailyConfigState {
                detected: None,
                effective: default,
                warnings: vec![format!(
                    "Could not parse daily-notes configuration; defaults will be used: {error}"
                )],
            }
        }
    };
    let detected = ObsidianDailyNotesConfig {
        folder: parsed.folder.unwrap_or_default(),
        format: parsed
            .format
            .unwrap_or_else(|| DEFAULT_DAILY_FORMAT.to_string()),
    };
    let mut effective = detected.clone();
    let mut warnings = Vec::new();
    if config_relative_path(&effective.folder).is_none() {
        warnings
            .push("Daily-notes folder is unsafe; the vault root will be used instead".to_string());
        effective.folder.clear();
    }
    if compile_daily_format(&effective.format).is_none() {
        warnings.push(format!(
            "Daily-note format '{}' is unsupported; {} will be used instead",
            effective.format, DEFAULT_DAILY_FORMAT
        ));
        effective.format = DEFAULT_DAILY_FORMAT.to_string();
    }
    DailyConfigState {
        detected: Some(detected),
        effective,
        warnings,
    }
}

fn validate_source_vault(source: &Path, forges_root: &Path) -> Result<PathBuf, String> {
    if !source.is_absolute() {
        return Err("Obsidian vault path must be absolute".to_string());
    }
    let metadata = fs::symlink_metadata(source)
        .map_err(|_| "Selected Obsidian vault does not exist".to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("The selected Obsidian vault cannot be a symlink".to_string());
    }
    if !metadata.is_dir() {
        return Err("Selected Obsidian vault is not a folder".to_string());
    }
    let canonical_source = source
        .canonicalize()
        .map_err(|_| "Could not resolve the selected Obsidian vault".to_string())?;
    validate_source_against_forge_roots(&canonical_source, forges_root)?;
    Ok(canonical_source)
}

fn validate_source_against_forge_roots(source: &Path, forges_root: &Path) -> Result<(), String> {
    if let Ok(canonical_root) = forges_root.canonicalize() {
        if source == canonical_root || canonical_root.starts_with(source) {
            return Err(
                "The selected vault overlaps the configured Moldavite Forges root".to_string(),
            );
        }
        if let Ok(entries) = fs::read_dir(&canonical_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !looks_like_forge(&path) {
                    continue;
                }
                if let Ok(forge) = path.canonicalize() {
                    if source == forge || source.starts_with(&forge) {
                        return Err(
                            "Cannot import a folder from inside an existing Moldavite Forge"
                                .to_string(),
                        );
                    }
                }
            }
        }
    }
    Ok(())
}

fn scan_vault(source: &Path) -> Result<VaultScan, String> {
    let mut scan = VaultScan::default();
    scan_directory(source, source, &mut scan)?;
    scan.notes
        .sort_by_key(|file| normalized_path_key(&file.relative));
    scan.attachments
        .sort_by_key(|file| normalized_path_key(&file.relative));
    Ok(scan)
}

fn scan_directory(
    source_root: &Path,
    directory: &Path,
    scan: &mut VaultScan,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| format!("Could not read selected vault directory: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not inspect selected vault: {error}"))?;
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    for entry in entries {
        let absolute = entry.path();
        let relative = absolute
            .strip_prefix(source_root)
            .map_err(|_| "Source entry escaped the selected vault".to_string())?
            .to_path_buf();
        let name = match entry.file_name().into_string() {
            Ok(name) => name,
            Err(_) => {
                scan.skipped.push(SkippedImportItem {
                    path: relative_display(&relative),
                    reason: "Non-Unicode file or folder name".to_string(),
                });
                continue;
            }
        };
        let metadata = match fs::symlink_metadata(&absolute) {
            Ok(metadata) => metadata,
            Err(error) => {
                scan.skipped.push(SkippedImportItem {
                    path: relative_display(&relative),
                    reason: format!("Could not inspect item: {error}"),
                });
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            scan.skipped.push(SkippedImportItem {
                path: relative_display(&relative),
                reason: "Symlink skipped (links are never followed)".to_string(),
            });
            scan.warnings
                .push(format!("Skipped symlink '{}'", relative_display(&relative)));
            continue;
        }
        if name.starts_with('.') {
            let reason = match name.as_str() {
                ".obsidian" => "Obsidian settings directory",
                ".trash" => "Obsidian trash directory",
                _ => "Hidden file or directory",
            };
            scan.skipped.push(SkippedImportItem {
                path: relative_display(&relative),
                reason: reason.to_string(),
            });
            continue;
        }
        if metadata.is_dir() {
            scan.folder_count += 1;
            scan_directory(source_root, &absolute, scan)?;
            continue;
        }
        if !metadata.is_file() {
            scan.skipped.push(SkippedImportItem {
                path: relative_display(&relative),
                reason: "Unsupported filesystem item".to_string(),
            });
            continue;
        }
        let extension = absolute
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("");
        if extension.eq_ignore_ascii_case("canvas") {
            scan.canvas_count += 1;
            scan.skipped.push(SkippedImportItem {
                path: relative_display(&relative),
                reason: "Obsidian Canvas files are not imported".to_string(),
            });
        } else if extension.eq_ignore_ascii_case("md") {
            scan.notes.push(SourceFile { absolute, relative });
        } else {
            scan.attachments.push(SourceFile { absolute, relative });
        }
    }
    Ok(())
}

fn validate_source_file(source_root: &Path, source: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source)
        .map_err(|_| "Source file disappeared during import".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("Source item is no longer a regular file".to_string());
    }
    let canonical = source
        .canonicalize()
        .map_err(|_| "Could not resolve source file".to_string())?;
    if !canonical.starts_with(source_root) {
        return Err("Source file escaped the selected vault".to_string());
    }
    Ok(())
}

fn ensure_destination_directory(forge_root: &Path, relative: &Path) -> Result<(), String> {
    let mut current = forge_root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("Unsafe destination directory".to_string());
        };
        let segment = segment
            .to_str()
            .ok_or_else(|| "Destination directory is not valid Unicode".to_string())?;
        if !is_safe_filename(segment) || segment.starts_with('.') {
            return Err("Unsafe destination directory segment".to_string());
        }
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err("Refusing to traverse a destination symlink".to_string())
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err("Destination directory is occupied by a file".to_string())
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|error| format!("Failed to create import directory: {error}"))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&current, fs::Permissions::from_mode(0o700))
                        .map_err(|error| format!("Failed to secure import directory: {error}"))?;
                }
            }
            Err(error) => {
                return Err(format!("Failed to inspect import directory: {error}"));
            }
        }
        let canonical = current
            .canonicalize()
            .map_err(|_| "Could not resolve import directory".to_string())?;
        let canonical_root = forge_root
            .canonicalize()
            .map_err(|_| "Could not resolve new Forge".to_string())?;
        if !canonical.starts_with(&canonical_root) {
            return Err("Import destination escaped the new Forge".to_string());
        }
    }
    Ok(())
}

fn safe_destination_path(forge_root: &Path, relative: &Path) -> Result<PathBuf, String> {
    if relative.is_absolute() {
        return Err("Import destination must be Forge-relative".to_string());
    }
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err("Import destination contains traversal".to_string());
        };
        let segment = segment
            .to_str()
            .ok_or_else(|| "Import destination is not valid Unicode".to_string())?;
        if !is_safe_filename(segment) || segment.starts_with('.') {
            return Err("Import destination contains an unsafe segment".to_string());
        }
    }
    let destination = forge_root.join(relative);
    let parent = destination
        .parent()
        .ok_or_else(|| "Import destination has no parent".to_string())?;
    let canonical_root = forge_root
        .canonicalize()
        .map_err(|_| "Could not resolve new Forge".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "Import destination parent does not exist".to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Import destination escaped the new Forge".to_string());
    }
    Ok(destination)
}

fn sanitize_path_segment(raw: &str, fallback: &str) -> String {
    let mut sanitized = String::with_capacity(raw.len());
    for character in raw.trim().chars() {
        if character.is_control()
            || matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            )
        {
            sanitized.push('-');
        } else {
            sanitized.push(character);
        }
    }
    while sanitized.contains("..") {
        sanitized = sanitized.replace("..", "-");
    }
    let sanitized = sanitized.trim().trim_matches('.').trim().to_string();
    let mut sanitized = if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    };
    if sanitized.chars().count() > 180 {
        sanitized = sanitized.chars().take(180).collect();
    }
    if !is_safe_filename(&sanitized) {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn sanitize_extension(raw: &str) -> String {
    let sanitized: String = raw
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, '-' | '_'))
        .take(24)
        .collect();
    if sanitized.is_empty() {
        "bin".to_string()
    } else {
        sanitized
    }
}

fn split_filename(filename: &str) -> (&str, Option<&str>) {
    let path = Path::new(filename);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(filename);
    let extension = path.extension().and_then(|extension| extension.to_str());
    (stem, extension)
}

fn dedupe_name(base: &str, extension: Option<&str>, used: &mut HashSet<String>) -> (String, bool) {
    let build = |counter: Option<usize>| {
        let stem = counter
            .map(|counter| format!("{base} {counter}"))
            .unwrap_or_else(|| base.to_string());
        extension
            .map(|extension| format!("{stem}.{extension}"))
            .unwrap_or(stem)
    };
    let first = build(None);
    if used.insert(first.to_lowercase()) {
        return (first, false);
    }
    for counter in 2..=10_000 {
        let candidate = build(Some(counter));
        if used.insert(candidate.to_lowercase()) {
            return (candidate, true);
        }
    }
    let fallback = build(Some(10_001));
    used.insert(fallback.to_lowercase());
    (fallback, true)
}

fn dedupe_relative_file(
    parent: &Path,
    base: &str,
    extension: &str,
    used_paths: &mut HashSet<String>,
) -> (String, bool) {
    let build = |counter: Option<usize>| {
        let stem = counter
            .map(|counter| format!("{base} {counter}"))
            .unwrap_or_else(|| base.to_string());
        format!("{stem}.{extension}")
    };
    let first = build(None);
    if used_paths.insert(normalized_path_key(&parent.join(&first))) {
        return (first, false);
    }
    for counter in 2..=10_000 {
        let candidate = build(Some(counter));
        if used_paths.insert(normalized_path_key(&parent.join(&candidate))) {
            return (candidate, true);
        }
    }
    let fallback = build(Some(10_001));
    used_paths.insert(normalized_path_key(&parent.join(&fallback)));
    (fallback, true)
}

fn estimate_attachment_collisions(attachments: &[SourceFile]) -> usize {
    let mut used = HashSet::new();
    let mut collisions = 0;
    for attachment in attachments {
        let Some(name) = attachment
            .relative
            .file_name()
            .and_then(|name| name.to_str())
        else {
            continue;
        };
        let (stem, extension) = split_filename(name);
        let base = sanitize_path_segment(stem, "Attachment");
        let extension = extension.map(sanitize_extension);
        let (_, collided) = dedupe_name(&base, extension.as_deref(), &mut used);
        if collided {
            collisions += 1;
        }
    }
    collisions
}

fn config_relative_path(value: &str) -> Option<PathBuf> {
    if value.is_empty() {
        return Some(PathBuf::new());
    }
    let normalized = value.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute() {
        return None;
    }
    let mut result = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(segment) => {
                let segment = segment.to_str()?;
                if segment.is_empty() || segment == ".." || segment.starts_with('.') {
                    return None;
                }
                result.push(segment);
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    Some(result)
}

fn normalize_source_relative(base: &Path, reference: &str) -> Option<PathBuf> {
    let normalized = reference.replace('\\', "/");
    let path = Path::new(&normalized);
    if path.is_absolute() || normalized.contains(':') {
        return None;
    }
    let mut parts: Vec<PathBuf> = base
        .components()
        .filter_map(|component| match component {
            Component::Normal(segment) => Some(PathBuf::from(segment)),
            _ => None,
        })
        .collect();
    for component in path.components() {
        match component {
            Component::Normal(segment) => parts.push(PathBuf::from(segment)),
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop()?;
            }
            _ => return None,
        }
    }
    let mut result = PathBuf::new();
    for part in parts {
        result.push(part);
    }
    Some(result)
}

fn clean_attachment_reference(reference: &str) -> Option<String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() || is_remote_or_data_reference(trimmed) {
        return None;
    }
    let without_suffix = strip_link_target_suffix(trimmed).trim();
    if without_suffix.is_empty() {
        return None;
    }
    Some(without_suffix.replace("%20", " "))
}

fn is_remote_or_data_reference(reference: &str) -> bool {
    let lower = reference.trim().to_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("file:")
        || lower.starts_with('#')
}

fn relative_image_link(note_destination: &Path, attachment_name: &str) -> String {
    let parent = note_destination.parent().unwrap_or_else(|| Path::new(""));
    let depth = parent.components().count();
    let mut parts = vec![".."; depth];
    parts.push("images");
    parts.push(attachment_name);
    parts.join("/")
}

fn normalized_path_key(path: &Path) -> String {
    relative_display(path).to_lowercase()
}

fn relative_display(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(segment) => Some(segment.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn is_real_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join(format!(
                    "moldavite-obsidian-import-{tag}-{}",
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos()
                ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn write_fixture(path: &Path, bytes: &[u8]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn import_fixture(source: &Path, forge: &Path) -> Result<ObsidianImportReport, String> {
        scaffold_forge(forge)?;
        let scan = scan_vault(source)?;
        let daily = read_daily_notes_config(source);
        let plan = plan_notes(&scan.notes, &daily.effective)?;
        import_prepared_vault(source, forge, "Imported", scan, daily, plan, |_, _| {})
    }

    #[test]
    fn swaps_obsidian_alias_order_and_strips_target_suffixes() {
        let input = "[[Target|Display]] [[Plain]] [[Note#Heading]] [[Block^abc]] ![[keep.png]]";
        let (converted, count) = convert_wiki_links(input);
        assert_eq!(
            converted,
            "[[Display|Target]] [[Plain]] [[Note]] [[Block]] ![[keep.png]]"
        );
        assert_eq!(count, 3);
    }

    #[test]
    fn preserves_frontmatter_verbatim_while_converting_body_links() {
        let tmp = TempDir::new("frontmatter");
        let source = tmp.path().join("source");
        let forge = tmp.path().join("forge");
        let frontmatter = "---\ntitle: '[[Target|YAML alias]]'\ncustom: true\n---\n";
        write_fixture(
            &source.join("Note.md"),
            format!("{frontmatter}Body [[Target|Visible]]").as_bytes(),
        );
        import_fixture(&source, &forge).unwrap();
        let imported = fs::read_to_string(forge.join("notes/Note.md")).unwrap();
        assert!(imported.starts_with(frontmatter));
        assert!(imported.ends_with("Body [[Visible|Target]]"));
    }

    #[test]
    fn parses_daily_formats_nested_folders_and_rejects_bad_names() {
        let config = ObsidianDailyNotesConfig {
            folder: "Journal/Daily".to_string(),
            format: "DD-MM-YYYY".to_string(),
        };
        assert_eq!(
            parse_daily_note(Path::new("Journal/Daily/31-12-2025.md"), &config),
            NaiveDate::from_ymd_opt(2025, 12, 31)
        );
        assert_eq!(
            parse_daily_note(Path::new("Journal/Daily/not-a-date.md"), &config),
            None
        );
        assert_eq!(
            parse_daily_note(Path::new("Other/31-12-2025.md"), &config),
            None
        );

        let slash_config = ObsidianDailyNotesConfig {
            folder: "Daily".to_string(),
            format: "YYYY/MM/DD".to_string(),
        };
        assert_eq!(
            parse_daily_note(Path::new("Daily/2026/07/15.md"), &slash_config),
            NaiveDate::from_ymd_opt(2026, 7, 15)
        );
        assert_eq!(
            parse_daily_note(Path::new("Daily/2026/02/30.md"), &slash_config),
            None
        );
    }

    #[test]
    fn converts_embeds_copies_attachments_and_dedupes_collisions() {
        let tmp = TempDir::new("embeds");
        let source = tmp.path().join("source");
        let forge = tmp.path().join("forge");
        write_fixture(&source.join("Attachments/photo.png"), b"first");
        write_fixture(&source.join("Other/photo.png"), b"second");
        write_fixture(
            &source.join("Projects/Note.md"),
            b"![[Attachments/photo.png]]\n![second](Other/photo.png)",
        );

        let report = import_fixture(&source, &forge).unwrap();
        assert_eq!(report.attachments_imported, 2);
        let note = fs::read_to_string(forge.join("notes/Projects/Note.md")).unwrap();
        assert_eq!(
            note,
            "![](<../../images/photo.png>)\n![second](<../../images/photo 2.png>)"
        );
        assert_eq!(fs::read(forge.join("images/photo.png")).unwrap(), b"first");
        assert_eq!(
            fs::read(forge.join("images/photo 2.png")).unwrap(),
            b"second"
        );
    }

    #[test]
    fn path_safety_rejects_traversal_and_absolute_destinations() {
        let tmp = TempDir::new("path-safety");
        let forge = tmp.path().join("forge");
        scaffold_forge(&forge).unwrap();
        assert!(safe_destination_path(&forge, Path::new("../evil.md")).is_err());
        assert!(safe_destination_path(&forge, Path::new("/tmp/evil.md")).is_err());
        assert!(normalize_source_relative(Path::new("notes"), "../../evil.png").is_none());
        assert!(normalize_source_relative(Path::new(""), "/etc/passwd").is_none());
        let sanitized = sanitize_path_segment("..evil", "Untitled");
        assert!(is_safe_filename(&sanitized));
        assert!(!sanitized.contains(".."));
    }

    #[cfg(unix)]
    #[test]
    fn scanner_never_follows_symlinks() {
        use std::os::unix::fs::symlink;

        let tmp = TempDir::new("symlink");
        let source = tmp.path().join("source");
        let outside = tmp.path().join("outside");
        write_fixture(&outside.join("secret.md"), b"secret");
        fs::create_dir_all(&source).unwrap();
        symlink(&outside, source.join("linked")).unwrap();
        let scan = scan_vault(&source).unwrap();
        assert!(scan.notes.is_empty());
        assert_eq!(scan.skipped.len(), 1);
        assert!(scan.skipped[0].reason.contains("Symlink"));
        assert_eq!(scan.warnings.len(), 1);
    }

    #[test]
    fn report_counts_daily_standalone_attachments_skips_links_and_warnings() {
        let tmp = TempDir::new("report");
        let source = tmp.path().join("source");
        let forge = tmp.path().join("forge");
        write_fixture(
            &source.join(".obsidian/daily-notes.json"),
            br#"{"folder":"Journal","format":"DD-MM-YYYY"}"#,
        );
        write_fixture(
            &source.join("Journal/15-07-2026.md"),
            b"Daily [[Target|Shown]] ![[assets/pic.png]]",
        );
        write_fixture(
            &source.join("Journal/bad-name.md"),
            b"Standalone ![[missing.png]]",
        );
        write_fixture(&source.join("Notes/Regular.md"), b"Regular");
        write_fixture(&source.join("assets/pic.png"), b"pic");
        write_fixture(&source.join("assets/unused.pdf"), b"unused");
        write_fixture(&source.join("Board.canvas"), b"{}");
        write_fixture(&source.join(".hidden.md"), b"hidden");

        let report = import_fixture(&source, &forge).unwrap();
        assert_eq!(report.daily_notes_imported, 1);
        assert_eq!(report.standalone_notes_imported, 2);
        assert_eq!(report.attachments_imported, 1);
        assert_eq!(report.link_conversions_performed, 1);
        assert!(report
            .skipped_items
            .iter()
            .any(|item| item.path == "Board.canvas"));
        assert!(report
            .skipped_items
            .iter()
            .any(|item| item.path == "assets/unused.pdf"));
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.contains("missing.png")));
        assert_eq!(
            fs::read_to_string(forge.join("daily/2026-07-15.md")).unwrap(),
            "Daily [[Shown|Target]] ![](<../images/pic.png>)"
        );
        assert!(forge.join("notes/Journal/bad-name.md").is_file());
    }

    #[test]
    fn analysis_reports_preview_and_estimated_collisions() {
        let tmp = TempDir::new("analysis");
        let source = tmp.path().join("source");
        let forges = tmp.path().join("forges");
        fs::create_dir_all(&forges).unwrap();
        write_fixture(&source.join("A:B.md"), b"one");
        write_fixture(&source.join("A?B.md"), b"two");
        write_fixture(&source.join("one/photo.png"), b"one");
        write_fixture(&source.join("two/photo.png"), b"two");
        write_fixture(&source.join("view.canvas"), b"{}");

        let preview = analyze_obsidian_vault_from(&source, &forges).unwrap();
        assert_eq!(preview.note_count, 2);
        assert_eq!(preview.attachment_count, 2);
        assert_eq!(preview.canvas_count, 1);
        assert!(!preview.has_obsidian_directory);
        assert_eq!(preview.estimated_collisions, 2);
    }

    #[test]
    fn rejects_sources_inside_existing_forges_or_overlapping_the_root() {
        let tmp = TempDir::new("forge-overlap");
        let root = tmp.path().join("forges");
        let forge = root.join("Existing");
        scaffold_forge(&forge).unwrap();
        fs::create_dir_all(forge.join("nested")).unwrap();
        let root = root.canonicalize().unwrap();
        let forge = forge.canonicalize().unwrap();
        assert!(validate_source_against_forge_roots(&forge, &root).is_err());
        assert!(validate_source_against_forge_roots(&forge.join("nested"), &root).is_err());
        assert!(validate_source_against_forge_roots(&root, &root).is_err());
    }
}
