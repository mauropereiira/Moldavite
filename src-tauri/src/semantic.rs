//! Local semantic (vector) search over notes.
//!
//! # Privacy model
//!
//! Everything runs on-device. The user chooses from a small curated set of
//! 384-dimensional ONNX embedding models powered by `fastembed`. The selected
//! model is downloaded from Hugging Face exactly once, and only after the user explicitly enables the feature
//! (`semantic_set_enabled`). Model files are cached in the app data dir
//! (`~/Library/Application Support/Moldavite/models`), never inside a vault.
//! At query time no data ever leaves the machine.
//!
//! # Index
//!
//! The per-Forge index lives at `<forge>/.index/embeddings.v1.bin`
//! (bincode, written with `persist::write_atomic`). One vector per note:
//! long notes are chunked into ~350-word windows (≈512 MiniLM tokens) and
//! the note vector is the L2-normalized mean of the chunk vectors.
//! Locked notes (`.md.locked`) are encrypted and are never read or indexed;
//! when a note becomes locked its entry is removed.
//!
//! Search is a brute-force cosine scan over the in-memory vectors — at
//! 384 dims × 10k notes that is milliseconds, so no vector-DB dependency
//! is warranted.
//!
//! # Incremental updates
//!
//! Note write/delete/rename/trash/restore command paths call the cheap
//! hooks [`note_changed`] / [`note_removed`] / [`notes_changed`] /
//! [`notes_removed`], which no-op unless the feature is enabled and the
//! index is ready. Changed notes are re-embedded on a debounced background
//! thread so saves are never blocked. Content hashes make full reconciles
//! cheap: unchanged notes are never re-embedded.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::frontmatter;
use crate::persist::write_atomic;

// =============================================================================
// CONSTANTS
// =============================================================================

/// On-disk index format version. Bump on breaking changes to force rebuilds.
pub(crate) const INDEX_VERSION: u32 = 1;
/// Default embedding model for new and upgraded installations.
pub(crate) const DEFAULT_MODEL_ID: &str = "all-minilm-l6-v2";
/// All curated models currently produce 384-dimensional vectors.
pub(crate) const EMBED_DIM: u32 = 384;
/// Directory (relative to the Forge root) holding internal index state.
pub(crate) const INDEX_DIR: &str = ".index";
/// Index file name inside [`INDEX_DIR`].
pub(crate) const INDEX_FILE: &str = "embeddings.v1.bin";
/// Words per embedding chunk (≈512 MiniLM tokens for English prose).
const CHUNK_WORDS: usize = 350;
/// Debounce window for re-embedding after a note save.
const DEBOUNCE_MS: u64 = 600;
/// Error string used to signal a user-initiated cancellation (disable
/// mid-build). Not surfaced to the UI as an error.
pub(crate) const CANCELLED: &str = "__semantic_cancelled__";
/// User-facing reason semantic search is unavailable on Intel macOS.
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub(crate) const UNSUPPORTED_MESSAGE: &str = "Semantic search requires Apple Silicon on macOS";

// =============================================================================
// EMBEDDER
// =============================================================================

/// User-facing metadata for one curated local embedding model.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelInfo {
    pub(crate) id: &'static str,
    pub(crate) label: &'static str,
    pub(crate) download_size_mb: u32,
    pub(crate) dims: u32,
    pub(crate) description: &'static str,
    pub(crate) active: bool,
}

const MODEL_REGISTRY: [ModelInfo; 3] = [
    ModelInfo {
        id: DEFAULT_MODEL_ID,
        label: "all-MiniLM-L6-v2",
        download_size_mb: 97,
        dims: EMBED_DIM,
        description: "fastest, English-focused",
        active: false,
    },
    ModelInfo {
        id: "bge-small-en-v1.5",
        label: "BGE small English v1.5",
        download_size_mb: 130,
        dims: EMBED_DIM,
        description: "better quality, English",
        active: false,
    },
    ModelInfo {
        id: "multilingual-e5-small",
        label: "Multilingual E5 small",
        download_size_mb: 450,
        dims: EMBED_DIM,
        description: "for non-English or mixed-language vaults",
        active: false,
    },
];

/// The configured model id, with the default applied to older configs.
pub(crate) fn configured_model_id() -> String {
    crate::persist::read_config()
        .semantic_model
        .unwrap_or_else(|| DEFAULT_MODEL_ID.to_string())
}

/// Return the curated registry and mark the configured model active.
pub(crate) fn models() -> Vec<ModelInfo> {
    let active_id = configured_model_id();
    MODEL_REGISTRY
        .iter()
        .cloned()
        .map(|mut info| {
            info.active = info.id == active_id;
            info
        })
        .collect()
}

/// Validate a model id and return its registry metadata.
pub(crate) fn model_info(id: &str) -> Result<ModelInfo, String> {
    MODEL_REGISTRY
        .iter()
        .find(|info| info.id == id)
        .cloned()
        .ok_or_else(|| {
            format!(
                "Unknown semantic model id '{id}'. Choose one of: {}",
                MODEL_REGISTRY
                    .iter()
                    .map(|info| info.id)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
fn fastembed_model(id: &str) -> Result<fastembed::EmbeddingModel, String> {
    match id {
        DEFAULT_MODEL_ID => Ok(fastembed::EmbeddingModel::AllMiniLML6V2),
        "bge-small-en-v1.5" => Ok(fastembed::EmbeddingModel::BGESmallENV15),
        "multilingual-e5-small" => Ok(fastembed::EmbeddingModel::MultilingualE5Small),
        _ => Err(model_info(id).unwrap_err()),
    }
}

/// Anything that can turn text into vectors. Supported production targets use
/// a fastembed-backed implementation; tests use a deterministic fake so
/// `cargo test` never touches the network or the real model.
pub(crate) trait Embedder: Send + Sync {
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String>;
}

/// Real embedder backed by fastembed (ONNX Runtime).
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub(crate) struct FastEmbedder {
    // fastembed's `embed` takes `&mut self`, so serialize access.
    inner: Mutex<fastembed::TextEmbedding>,
}

#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
impl Embedder for FastEmbedder {
    fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
        let mut model = self
            .inner
            .lock()
            .map_err(|_| "embedding model lock poisoned".to_string())?;
        model
            .embed(texts, None)
            .map_err(|e| format!("Embedding failed: {}", e))
    }
}

/// Directory where model files are cached: the app data dir, never a vault.
pub(crate) fn model_cache_dir(model_id: &str) -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("Moldavite")
        .join("models")
        .join(model_id)
}

/// Heuristic used for status reporting: the model has been downloaded if the
/// cache dir contains anything.
pub(crate) fn model_files_cached(model_id: &str) -> bool {
    if model_info(model_id).is_err() {
        return false;
    }
    fs::read_dir(model_cache_dir(model_id))
        .map(|mut entries| entries.next().is_some())
        .unwrap_or(false)
}

/// Initialize the real embedder. Downloads the model into
/// [`model_cache_dir`] if it is not cached yet — callers must only invoke
/// this from the explicit enable flow (or on startup when the user already
/// enabled the feature).
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub(crate) fn init_fastembed_embedder(model_id: &str) -> Result<FastEmbedder, String> {
    use fastembed::{InitOptions, TextEmbedding};

    let model = fastembed_model(model_id)?;
    let cache = model_cache_dir(model_id);
    fs::create_dir_all(&cache).map_err(|e| format!("Failed to create model cache dir: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&cache, fs::Permissions::from_mode(0o700));
    }
    let options = InitOptions::new(model)
        .with_cache_dir(cache)
        .with_show_download_progress(false);
    let model = TextEmbedding::try_new(options)
        .map_err(|e| format!("Failed to load embedding model: {}", e))?;
    Ok(FastEmbedder {
        inner: Mutex::new(model),
    })
}

// =============================================================================
// INDEX FILE
// =============================================================================

/// One indexed note.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct IndexEntry {
    /// Forge-relative path, e.g. `notes/Projects/foo.md` or `daily/2026-01-01.md`.
    pub(crate) path: String,
    /// SHA-256 hex of the note body (frontmatter stripped).
    pub(crate) content_hash: String,
    /// Display title (file stem).
    pub(crate) title: String,
    /// L2-normalized note vector (mean of chunk vectors).
    pub(crate) embedding: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IndexFile {
    version: u32,
    model: String,
    dim: u32,
    entries: Vec<IndexEntry>,
}

/// A search / related-notes hit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SemanticHit {
    pub(crate) path: String,
    pub(crate) title: String,
    pub(crate) score: f32,
}

pub(crate) fn index_path(forge_root: &Path) -> PathBuf {
    forge_root.join(INDEX_DIR).join(INDEX_FILE)
}

/// Persist the index atomically (temp file + fsync + rename, 0600).
pub(crate) fn save_index(
    forge_root: &Path,
    entries: &[IndexEntry],
    model_id: &str,
) -> Result<(), String> {
    let model = model_info(model_id)?;
    let dir = forge_root.join(INDEX_DIR);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create index dir: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    let file = IndexFile {
        version: INDEX_VERSION,
        model: model.id.to_string(),
        dim: model.dims,
        entries: entries.to_vec(),
    };
    let bytes =
        bincode::serialize(&file).map_err(|e| format!("Failed to serialize index: {}", e))?;
    write_atomic(&index_path(forge_root), &bytes, Some(0o600))
}

/// Load the index for a Forge. Returns `None` if the file is missing,
/// unreadable, or was built with an incompatible version/model — callers
/// then fall back to a full rebuild.
pub(crate) fn load_index(forge_root: &Path, model_id: &str) -> Option<Vec<IndexEntry>> {
    let model = model_info(model_id).ok()?;
    let bytes = fs::read(index_path(forge_root)).ok()?;
    let file: IndexFile = bincode::deserialize(&bytes).ok()?;
    if file.version != INDEX_VERSION || file.model != model.id || file.dim != model.dims {
        return None;
    }
    Some(file.entries)
}

// =============================================================================
// TEXT → VECTOR
// =============================================================================

/// SHA-256 hex of a note body.
pub(crate) fn content_hash(body: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(body.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Split a note body into ~[`CHUNK_WORDS`]-word windows.
pub(crate) fn chunk_text(body: &str) -> Vec<String> {
    let words: Vec<&str> = body.split_whitespace().collect();
    words.chunks(CHUNK_WORDS).map(|c| c.join(" ")).collect()
}

fn l2_normalize(v: &mut [f32]) -> bool {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= f32::EPSILON {
        return false;
    }
    for x in v.iter_mut() {
        *x /= norm;
    }
    true
}

/// Embed a note body: chunk, embed each chunk, mean-pool, L2-normalize.
/// Returns `Ok(None)` for empty/degenerate bodies (nothing to index).
pub(crate) fn embed_note_body(
    embedder: &dyn Embedder,
    body: &str,
) -> Result<Option<Vec<f32>>, String> {
    let chunks = chunk_text(body);
    if chunks.is_empty() {
        return Ok(None);
    }
    let vectors = embedder.embed(&chunks)?;
    if vectors.is_empty() {
        return Ok(None);
    }
    let dim = vectors[0].len();
    let mut mean = vec![0f32; dim];
    for v in &vectors {
        if v.len() != dim {
            return Err("Embedder returned inconsistent dimensions".to_string());
        }
        for (m, x) in mean.iter_mut().zip(v) {
            *m += x;
        }
    }
    let n = vectors.len() as f32;
    for m in mean.iter_mut() {
        *m /= n;
    }
    if !l2_normalize(&mut mean) {
        return Ok(None);
    }
    Ok(Some(mean))
}

/// Cosine similarity. Vectors in the index are L2-normalized, so this is a
/// plain dot product.
fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Return deterministic top-k cosine matches, optionally excluding one note path.
///
/// The index is intentionally scanned in memory: at 384 dimensions and expected
/// Forge sizes this remains fast while avoiding a vector-database dependency.
pub(crate) fn top_k_similar(
    entries: &[IndexEntry],
    query: &[f32],
    limit: usize,
    exclude_path: Option<&str>,
) -> Vec<SemanticHit> {
    let mut hits: Vec<SemanticHit> = entries
        .iter()
        .filter(|e| exclude_path != Some(e.path.as_str()))
        .filter(|e| e.embedding.len() == query.len())
        .map(|e| SemanticHit {
            path: e.path.clone(),
            title: e.title.clone(),
            score: dot(&e.embedding, query),
        })
        .collect();
    hits.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then_with(|| a.path.cmp(&b.path))
    });
    hits.truncate(limit);
    hits
}

// =============================================================================
// NOTE SCANNING + RECONCILE
// =============================================================================

/// A note eligible for indexing: forge-relative path, title, body.
pub(crate) struct NoteSource {
    pub(crate) rel_path: String,
    pub(crate) title: String,
    pub(crate) body: String,
}

fn title_from_rel_path(rel_path: &str) -> String {
    Path::new(rel_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel_path.to_string())
}

fn push_note_source(abs: &Path, rel_path: String, out: &mut Vec<NoteSource>) {
    let Ok(raw) = fs::read_to_string(abs) else {
        return;
    };
    let body = frontmatter::parse_note(&raw).body;
    if body.trim().is_empty() {
        return;
    }
    out.push(NoteSource {
        title: title_from_rel_path(&rel_path),
        rel_path,
        body,
    });
}

/// Collect every unlocked, non-empty markdown note in the Forge. Locked
/// notes (`.md.locked`), hidden files/dirs (`.index`, `.trash`, …), and
/// symlinks are skipped.
pub(crate) fn scan_note_sources(forge_root: &Path) -> Vec<NoteSource> {
    let mut out = Vec::new();
    // Daily and weekly notes live flat at the top level.
    for top in ["daily", "weekly"] {
        let dir = forge_root.join(top);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if name.starts_with('.') || !name.ends_with(".md") {
                continue;
            }
            if fs::symlink_metadata(&path)
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(true)
                || !path.is_file()
            {
                continue;
            }
            push_note_source(&path, format!("{}/{}", top, name), &mut out);
        }
    }
    // Standalone notes may live in nested folders.
    let notes_dir = forge_root.join("notes");
    scan_standalone(&notes_dir, "", &mut out);
    out
}

fn scan_standalone(dir: &Path, rel: &str, out: &mut Vec<NoteSource>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()).map(String::from) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        if fs::symlink_metadata(&path)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(true)
        {
            continue;
        }
        let child_rel = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel, name)
        };
        if path.is_dir() {
            scan_standalone(&path, &child_rel, out);
        } else if name.ends_with(".md") && !name.ends_with(".md.locked") {
            push_note_source(&path, format!("notes/{}", child_rel), out);
        }
    }
}

/// Build an up-to-date entry list for the Forge, reusing embeddings from
/// `existing` when the content hash is unchanged (so only new/edited notes
/// hit the model). `progress(done, total)` is called after every note and
/// must return `true` to continue — returning `false` aborts with
/// [`CANCELLED`].
pub(crate) fn reconcile_index(
    forge_root: &Path,
    embedder: &dyn Embedder,
    existing: &[IndexEntry],
    mut progress: impl FnMut(usize, usize) -> bool,
) -> Result<Vec<IndexEntry>, String> {
    let by_path: HashMap<&str, &IndexEntry> =
        existing.iter().map(|e| (e.path.as_str(), e)).collect();
    let sources = scan_note_sources(forge_root);
    let total = sources.len();
    let mut entries = Vec::with_capacity(total);
    for (i, src) in sources.into_iter().enumerate() {
        let hash = content_hash(&src.body);
        match by_path.get(src.rel_path.as_str()) {
            Some(prev) if prev.content_hash == hash => entries.push(IndexEntry {
                path: src.rel_path,
                content_hash: hash,
                title: src.title,
                embedding: prev.embedding.clone(),
            }),
            _ => {
                if let Some(embedding) = embed_note_body(embedder, &src.body)? {
                    entries.push(IndexEntry {
                        path: src.rel_path,
                        content_hash: hash,
                        title: src.title,
                        embedding,
                    });
                }
            }
        }
        if !progress(i + 1, total) {
            return Err(CANCELLED.to_string());
        }
    }
    Ok(entries)
}

/// Re-embed (or drop) a single note in `entries`. Returns `Ok(true)` if the
/// entry list changed. A missing file (deleted, trashed, or replaced by a
/// `.locked` ciphertext) or an empty body removes the entry.
pub(crate) fn refresh_entry(
    forge_root: &Path,
    embedder: &dyn Embedder,
    entries: &mut Vec<IndexEntry>,
    rel_path: &str,
) -> Result<bool, String> {
    if !is_valid_note_index_path(rel_path) {
        return Ok(false);
    }
    let remove = |entries: &mut Vec<IndexEntry>| {
        let before = entries.len();
        entries.retain(|e| e.path != rel_path);
        entries.len() != before
    };

    let abs = forge_root.join(rel_path);
    // Locked notes are encrypted — never read them; drop any stale entry.
    if !abs.is_file() {
        return Ok(remove(entries));
    }
    let raw = fs::read_to_string(&abs).map_err(|e| format!("Failed to read note: {}", e))?;
    let body = frontmatter::parse_note(&raw).body;
    if body.trim().is_empty() {
        return Ok(remove(entries));
    }
    let hash = content_hash(&body);
    if entries
        .iter()
        .any(|e| e.path == rel_path && e.content_hash == hash)
    {
        return Ok(false);
    }
    let Some(embedding) = embed_note_body(embedder, &body)? else {
        return Ok(remove(entries));
    };
    let entry = IndexEntry {
        path: rel_path.to_string(),
        content_hash: hash,
        title: title_from_rel_path(rel_path),
        embedding,
    };
    if let Some(existing) = entries.iter_mut().find(|e| e.path == rel_path) {
        *existing = entry;
    } else {
        entries.push(entry);
    }
    Ok(true)
}

// =============================================================================
// PATH HELPERS
// =============================================================================

/// Forge-relative index path for a note addressed the way the note commands
/// address it (bare filename for daily/weekly, `notes/`-relative otherwise).
pub(crate) fn note_rel_path(filename: &str, is_daily: bool, is_weekly: bool) -> String {
    if is_daily {
        format!("daily/{}", filename)
    } else if is_weekly {
        format!("weekly/{}", filename)
    } else {
        format!("notes/{}", filename)
    }
}

/// Validate a forge-relative note path coming from the frontend or from an
/// index entry: must live under `daily/`, `weekly/` or `notes/`, and each
/// component must be safe (no traversal, no hidden components).
pub(crate) fn is_valid_note_index_path(path: &str) -> bool {
    let Some((top, rest)) = path.split_once('/') else {
        return false;
    };
    if !matches!(top, "daily" | "weekly" | "notes") {
        return false;
    }
    crate::validation::is_safe_note_path(rest)
}

// =============================================================================
// SERVICE (global state + incremental hooks)
// =============================================================================

/// Lifecycle state of the semantic index.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Phase {
    Disabled,
    Downloading,
    Indexing,
    Ready,
    Error(String),
}

impl Phase {
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Phase::Disabled => "disabled",
            Phase::Downloading => "downloading",
            Phase::Indexing => "indexing",
            Phase::Ready => "ready",
            Phase::Error(_) => "error",
        }
    }
}

/// Process-wide semantic search state. Commands and the note-command hooks
/// share it through [`service`]; it starts out `Disabled` and is driven by
/// the enable flow in `commands::semantic`.
pub(crate) struct SemanticService {
    entries: RwLock<Vec<IndexEntry>>,
    phase: RwLock<Phase>,
    embedder: RwLock<Option<Arc<dyn Embedder>>>,
    /// Debounce bookkeeping for [`note_changed`]: path → latest generation.
    pending: Mutex<HashMap<String, u64>>,
    pending_gen: AtomicU64,
    /// Guards against concurrent full builds.
    building: AtomicBool,
    /// Serializes index-file writes.
    save_lock: Mutex<()>,
}

static SERVICE: OnceLock<SemanticService> = OnceLock::new();

pub(crate) fn service() -> &'static SemanticService {
    SERVICE.get_or_init(|| SemanticService {
        entries: RwLock::new(Vec::new()),
        phase: RwLock::new(Phase::Disabled),
        embedder: RwLock::new(None),
        pending: Mutex::new(HashMap::new()),
        pending_gen: AtomicU64::new(0),
        building: AtomicBool::new(false),
        save_lock: Mutex::new(()),
    })
}

impl SemanticService {
    pub(crate) fn phase(&self) -> Phase {
        self.phase
            .read()
            .map(|p| p.clone())
            .unwrap_or(Phase::Disabled)
    }

    pub(crate) fn set_phase(&self, phase: Phase) {
        if let Ok(mut p) = self.phase.write() {
            *p = phase;
        }
    }

    pub(crate) fn is_ready(&self) -> bool {
        matches!(self.phase(), Phase::Ready)
    }

    pub(crate) fn indexed_count(&self) -> usize {
        self.entries.read().map(|e| e.len()).unwrap_or(0)
    }

    pub(crate) fn embedder(&self) -> Option<Arc<dyn Embedder>> {
        self.embedder.read().ok().and_then(|e| e.clone())
    }

    pub(crate) fn set_embedder(&self, embedder: Arc<dyn Embedder>) {
        if let Ok(mut e) = self.embedder.write() {
            *e = Some(embedder);
        }
    }

    pub(crate) fn replace_entries(&self, new_entries: Vec<IndexEntry>) {
        if let Ok(mut e) = self.entries.write() {
            *e = new_entries;
        }
    }

    /// Feature switched off: forget everything (the on-disk index is kept so
    /// a re-enable only re-embeds notes that changed in the meantime).
    pub(crate) fn disable(&self) {
        self.set_phase(Phase::Disabled);
        self.replace_entries(Vec::new());
        if let Ok(mut e) = self.embedder.write() {
            *e = None;
        }
        if let Ok(mut p) = self.pending.lock() {
            p.clear();
        }
    }

    /// The active Forge changed: in-memory entries belong to the old vault.
    pub(crate) fn reset_for_forge_switch(&self) {
        self.replace_entries(Vec::new());
        if let Ok(mut p) = self.pending.lock() {
            p.clear();
        }
        if !matches!(self.phase(), Phase::Disabled) {
            self.set_phase(Phase::Indexing);
        }
    }

    /// Try to become the (single) running build task.
    pub(crate) fn try_begin_build(&self) -> bool {
        !self.building.swap(true, Ordering::SeqCst)
    }

    pub(crate) fn is_building(&self) -> bool {
        self.building.load(Ordering::SeqCst)
    }

    pub(crate) fn end_build(&self) {
        self.building.store(false, Ordering::SeqCst);
    }

    fn begin_pending(&self, rel_path: &str) -> u64 {
        let gen = self.pending_gen.fetch_add(1, Ordering::SeqCst) + 1;
        if let Ok(mut p) = self.pending.lock() {
            p.insert(rel_path.to_string(), gen);
        }
        gen
    }

    fn take_pending_if_current(&self, rel_path: &str, gen: u64) -> bool {
        let Ok(mut p) = self.pending.lock() else {
            return false;
        };
        if p.get(rel_path) == Some(&gen) {
            p.remove(rel_path);
            true
        } else {
            false
        }
    }

    /// Snapshot the in-memory entries and persist them for the given Forge.
    fn persist_entries(&self, forge_root: &Path) {
        let snapshot = match self.entries.read() {
            Ok(e) => e.clone(),
            Err(_) => return,
        };
        let _guard = self.save_lock.lock();
        if let Err(e) = save_index(forge_root, &snapshot, &configured_model_id()) {
            log::warn!("[semantic] failed to persist index: {}", e);
        }
    }

    /// Embed `query` and return the `limit` most similar notes.
    pub(crate) fn search(&self, query: &str, limit: usize) -> Result<Vec<SemanticHit>, String> {
        if !self.is_ready() {
            return Err("Semantic search is not ready".to_string());
        }
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let embedder = self
            .embedder()
            .ok_or_else(|| "Embedding model is not loaded".to_string())?;
        let Some(qv) = embed_note_body(embedder.as_ref(), query)? else {
            return Ok(Vec::new());
        };
        let entries = self
            .entries
            .read()
            .map_err(|_| "index lock poisoned".to_string())?;
        Ok(top_k_similar(&entries, &qv, limit.clamp(1, 100), None))
    }

    /// Nearest neighbours of an already-indexed note, excluding itself.
    pub(crate) fn related(&self, path: &str, limit: usize) -> Result<Vec<SemanticHit>, String> {
        if !is_valid_note_index_path(path) {
            return Err("Invalid note path".to_string());
        }
        if !self.is_ready() {
            return Err("Semantic search is not ready".to_string());
        }
        let entries = self
            .entries
            .read()
            .map_err(|_| "index lock poisoned".to_string())?;
        let target = entries
            .iter()
            .find(|e| e.path == path)
            .ok_or_else(|| "Note is not in the semantic index".to_string())?;
        let qv = target.embedding.clone();
        Ok(top_k_similar(
            &entries,
            &qv,
            limit.clamp(1, 100),
            Some(path),
        ))
    }
}

// =============================================================================
// INCREMENTAL HOOKS (called from note commands; no-ops when disabled)
// =============================================================================

/// A note's content changed (save, restore, unlock, …). Debounced so rapid
/// auto-saves collapse into one re-embed; never blocks the caller.
pub(crate) fn note_changed(rel_path: &str) {
    note_changed_in(rel_path, crate::paths::get_notes_dir());
}

/// MCP-mode variant of [`note_changed`] for an explicitly selected Forge.
/// The MCP process has no GUI Forge switcher, so it must not resolve the
/// active Forge again inside the background task.
pub(crate) fn note_changed_in(rel_path: &str, forge_root: PathBuf) {
    let svc = service();
    if !svc.is_ready() || !is_valid_note_index_path(rel_path) {
        return;
    }
    let gen = svc.begin_pending(rel_path);
    let rel = rel_path.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(DEBOUNCE_MS));
        let svc = service();
        if !svc.take_pending_if_current(&rel, gen) || !svc.is_ready() {
            return;
        }
        let Some(embedder) = svc.embedder() else {
            return;
        };
        let changed = {
            let Ok(mut entries) = svc.entries.write() else {
                return;
            };
            refresh_entry(&forge_root, embedder.as_ref(), &mut entries, &rel).unwrap_or_else(|e| {
                log::warn!("[semantic] re-embed of {} failed: {}", rel, e);
                false
            })
        };
        if changed {
            svc.persist_entries(&forge_root);
        }
    });
}

/// Load an already-built semantic index for MCP mode without rebuilding it.
/// Returns false when semantic search is not immediately usable, allowing
/// MCP search to fall back to keyword mode without downloading or indexing.
#[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
pub(crate) fn prepare_mcp_search(forge_root: &Path, model_id: &str) -> bool {
    let svc = service();
    if !model_files_cached(model_id) {
        return false;
    }
    if model_info(model_id).is_err() {
        return false;
    }
    let Some(entries) = load_index(forge_root, model_id) else {
        return false;
    };
    if entries.is_empty() {
        return false;
    }
    let embedder: Arc<dyn Embedder> = match init_fastembed_embedder(model_id) {
        Ok(embedder) => Arc::new(embedder),
        Err(_) => return false,
    };
    svc.set_embedder(embedder);
    svc.replace_entries(entries);
    svc.set_phase(Phase::Ready);
    true
}

/// Intel macOS has no ort-sys prebuilt runtime. Returning false keeps MCP's
/// `search_notes` tool on its existing keyword-search fallback.
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub(crate) fn prepare_mcp_search(_forge_root: &Path, _model_id: &str) -> bool {
    false
}

/// Several notes changed at once (folder restore). One background thread,
/// no debounce.
pub(crate) fn notes_changed(rel_paths: Vec<String>) {
    let svc = service();
    if !svc.is_ready() || rel_paths.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let svc = service();
        if !svc.is_ready() {
            return;
        }
        let Some(embedder) = svc.embedder() else {
            return;
        };
        let forge_root = crate::paths::get_notes_dir();
        let mut any_changed = false;
        for rel in &rel_paths {
            let Ok(mut entries) = svc.entries.write() else {
                return;
            };
            match refresh_entry(&forge_root, embedder.as_ref(), &mut entries, rel) {
                Ok(changed) => any_changed |= changed,
                Err(e) => log::warn!("[semantic] re-embed of {} failed: {}", rel, e),
            }
        }
        if any_changed {
            svc.persist_entries(&forge_root);
        }
    });
}

/// A note went away (delete, trash, lock, rename-source, move-source).
pub(crate) fn note_removed(rel_path: &str) {
    notes_removed(vec![rel_path.to_string()]);
}

/// Several notes went away at once (folder trash).
pub(crate) fn notes_removed(rel_paths: Vec<String>) {
    let svc = service();
    if !svc.is_ready() || rel_paths.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let svc = service();
        if !svc.is_ready() {
            return;
        }
        let removed = {
            let Ok(mut entries) = svc.entries.write() else {
                return;
            };
            let before = entries.len();
            entries.retain(|e| !rel_paths.iter().any(|p| p == &e.path));
            entries.len() != before
        };
        if removed {
            svc.persist_entries(&crate::paths::get_notes_dir());
        }
    });
}

/// Every note was deleted (`clear_all_notes`).
pub(crate) fn all_notes_removed() {
    let svc = service();
    if !svc.is_ready() {
        return;
    }
    std::thread::spawn(move || {
        let svc = service();
        if !svc.is_ready() {
            return;
        }
        svc.replace_entries(Vec::new());
        svc.persist_entries(&crate::paths::get_notes_dir());
    });
}

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    use std::sync::atomic::AtomicUsize;

    /// Deterministic fake embedder: a hashed bag-of-words. Texts sharing
    /// words get similar vectors, so cosine ranking behaves sensibly, and
    /// `cargo test` never needs the real model or the network.
    struct FakeEmbedder {
        calls: AtomicUsize,
    }

    impl FakeEmbedder {
        fn new() -> Self {
            Self {
                calls: AtomicUsize::new(0),
            }
        }
        fn embed_calls(&self) -> usize {
            self.calls.load(Ordering::SeqCst)
        }
    }

    fn bag_of_words(text: &str) -> Vec<f32> {
        let mut v = vec![0f32; EMBED_DIM as usize];
        for word in text.to_lowercase().split_whitespace() {
            let mut h = DefaultHasher::new();
            word.hash(&mut h);
            v[(h.finish() % EMBED_DIM as u64) as usize] += 1.0;
        }
        v
    }

    impl Embedder for FakeEmbedder {
        fn embed(&self, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
            self.calls.fetch_add(texts.len(), Ordering::SeqCst);
            Ok(texts.iter().map(|t| bag_of_words(t)).collect())
        }
    }

    struct TempForge(PathBuf);

    impl TempForge {
        fn new(tag: &str) -> Self {
            let base = std::env::temp_dir().join(format!(
                "moldavite-semantic-{}-{}-{}",
                tag,
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
            ));
            for sub in ["daily", "weekly", "notes", "notes/Projects", ".trash"] {
                fs::create_dir_all(base.join(sub)).unwrap();
            }
            Self(base)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempForge {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn entry(path: &str, embedding: Vec<f32>) -> IndexEntry {
        IndexEntry {
            path: path.to_string(),
            content_hash: content_hash(path),
            title: title_from_rel_path(path),
            embedding,
        }
    }

    // ---- chunking + embedding ----------------------------------------------

    #[test]
    fn chunk_text_empty_body_yields_no_chunks() {
        assert!(chunk_text("").is_empty());
        assert!(chunk_text("   \n\t ").is_empty());
    }

    #[test]
    fn chunk_text_splits_long_notes_into_windows() {
        let body = vec!["word"; 800].join(" ");
        let chunks = chunk_text(&body);
        assert_eq!(chunks.len(), 3); // 350 + 350 + 100
        assert!(chunk_text("short note").len() == 1);
    }

    #[test]
    fn embed_note_body_returns_normalized_mean_of_chunks() {
        let fake = FakeEmbedder::new();
        let body = vec!["alpha beta"; 500].join(" ");
        let v = embed_note_body(&fake, &body).unwrap().unwrap();
        assert_eq!(v.len(), EMBED_DIM as usize);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!(
            (norm - 1.0).abs() < 1e-4,
            "expected unit norm, got {}",
            norm
        );
        assert!(fake.embed_calls() > 1, "long note should embed >1 chunk");
    }

    #[test]
    fn embed_note_body_empty_returns_none() {
        let fake = FakeEmbedder::new();
        assert!(embed_note_body(&fake, "").unwrap().is_none());
        assert_eq!(fake.embed_calls(), 0);
    }

    // ---- cosine ranking ------------------------------------------------------

    #[test]
    fn top_k_ranks_by_cosine_similarity() {
        let mut e1 = vec![0f32; 384];
        e1[0] = 1.0;
        let mut e2 = vec![0f32; 384];
        e2[1] = 1.0;
        let mut e3 = vec![0f32; 384];
        e3[0] = 0.8;
        e3[1] = 0.6;
        let entries = vec![
            entry("notes/orthogonal.md", e2),
            entry("notes/exact.md", e1.clone()),
            entry("notes/close.md", e3),
        ];
        let hits = top_k_similar(&entries, &e1, 10, None);
        assert_eq!(hits[0].path, "notes/exact.md");
        assert!((hits[0].score - 1.0).abs() < 1e-6);
        assert_eq!(hits[1].path, "notes/close.md");
        assert_eq!(hits[2].path, "notes/orthogonal.md");
        assert!(hits[2].score.abs() < 1e-6);
    }

    #[test]
    fn top_k_respects_limit_and_exclusion() {
        let mut q = vec![0f32; 384];
        q[0] = 1.0;
        let entries = vec![
            entry("notes/a.md", q.clone()),
            entry("notes/b.md", q.clone()),
            entry("notes/c.md", q.clone()),
        ];
        let hits = top_k_similar(&entries, &q, 2, Some("notes/a.md"));
        assert_eq!(hits.len(), 2);
        assert!(hits.iter().all(|h| h.path != "notes/a.md"));
    }

    #[test]
    fn similar_texts_rank_above_unrelated_texts() {
        let fake = FakeEmbedder::new();
        let mk = |body: &str| {
            (
                content_hash(body),
                embed_note_body(&fake, body).unwrap().unwrap(),
            )
        };
        let (h1, v1) = mk("rust compiler borrow checker lifetimes traits");
        let (h2, v2) = mk("sourdough bread baking hydration flour starter");
        let entries = vec![
            IndexEntry {
                path: "notes/rust.md".into(),
                content_hash: h1,
                title: "rust".into(),
                embedding: v1,
            },
            IndexEntry {
                path: "notes/bread.md".into(),
                content_hash: h2,
                title: "bread".into(),
                embedding: v2,
            },
        ];
        let q = embed_note_body(&fake, "borrow checker and lifetimes in rust")
            .unwrap()
            .unwrap();
        let hits = top_k_similar(&entries, &q, 2, None);
        assert_eq!(hits[0].path, "notes/rust.md");
        assert!(hits[0].score > hits[1].score);
    }

    // ---- index file round trip ----------------------------------------------

    #[cfg(not(all(target_os = "macos", target_arch = "x86_64")))]
    #[test]
    fn curated_model_registry_maps_exact_fastembed_variants() {
        assert_eq!(MODEL_REGISTRY.len(), 3);
        assert_eq!(
            fastembed_model(DEFAULT_MODEL_ID).unwrap(),
            fastembed::EmbeddingModel::AllMiniLML6V2
        );
        assert_eq!(
            fastembed_model("bge-small-en-v1.5").unwrap(),
            fastembed::EmbeddingModel::BGESmallENV15
        );
        assert_eq!(
            fastembed_model("multilingual-e5-small").unwrap(),
            fastembed::EmbeddingModel::MultilingualE5Small
        );
        assert!(MODEL_REGISTRY.iter().all(|model| model.dims == 384));
    }

    #[test]
    fn curated_model_registry_rejects_unknown_ids() {
        let error = model_info("download-anything").unwrap_err();
        assert!(error.contains("Unknown semantic model id 'download-anything'"));
        assert!(error.contains(DEFAULT_MODEL_ID));
        assert!(!model_files_cached("../../outside-model-cache"));
    }

    #[test]
    fn index_round_trips_through_disk() {
        let forge = TempForge::new("roundtrip");
        let entries = vec![
            entry("notes/a.md", bag_of_words("alpha")),
            entry("daily/2026-07-12.md", bag_of_words("daily log")),
        ];
        save_index(forge.path(), &entries, DEFAULT_MODEL_ID).unwrap();
        assert!(index_path(forge.path()).is_file());
        let bytes = fs::read(index_path(forge.path())).unwrap();
        let header: IndexFile = bincode::deserialize(&bytes).unwrap();
        assert_eq!(header.model, DEFAULT_MODEL_ID);
        let loaded = load_index(forge.path(), DEFAULT_MODEL_ID).unwrap();
        assert_eq!(loaded, entries);
    }

    #[test]
    fn load_index_rejects_incompatible_header() {
        let forge = TempForge::new("badheader");
        let file = IndexFile {
            version: INDEX_VERSION,
            model: "bge-small-en-v1.5".to_string(),
            dim: EMBED_DIM,
            entries: vec![entry("notes/a.md", vec![0.0; 384])],
        };
        let dir = forge.path().join(INDEX_DIR);
        fs::create_dir_all(&dir).unwrap();
        write_atomic(
            &index_path(forge.path()),
            &bincode::serialize(&file).unwrap(),
            Some(0o600),
        )
        .unwrap();
        assert!(load_index(forge.path(), DEFAULT_MODEL_ID).is_none());
        assert!(load_index(forge.path(), "bge-small-en-v1.5").is_some());
    }

    #[test]
    fn load_index_missing_or_garbage_returns_none() {
        let forge = TempForge::new("missing");
        assert!(load_index(forge.path(), DEFAULT_MODEL_ID).is_none());
        let dir = forge.path().join(INDEX_DIR);
        fs::create_dir_all(&dir).unwrap();
        fs::write(index_path(forge.path()), b"not bincode").unwrap();
        assert!(load_index(forge.path(), DEFAULT_MODEL_ID).is_none());
    }

    // ---- reconcile -----------------------------------------------------------

    fn seed_vault(forge: &TempForge) {
        let base = forge.path();
        fs::write(base.join("daily/2026-07-12.md"), "daily standup notes").unwrap();
        fs::write(base.join("weekly/2026-W28.md"), "weekly review of goals").unwrap();
        fs::write(base.join("notes/rust.md"), "rust borrow checker").unwrap();
        fs::write(
            base.join("notes/Projects/bread.md"),
            "---\ncolor: blue\n---\nsourdough bread baking",
        )
        .unwrap();
        // Must all be excluded:
        fs::write(base.join("notes/secret.md.locked"), "ciphertextciphertext").unwrap();
        fs::write(base.join("notes/empty.md"), "   \n").unwrap();
        fs::write(base.join(".trash/old.md"), "trashed content").unwrap();
        fs::create_dir_all(base.join(INDEX_DIR)).unwrap();
        fs::write(base.join(INDEX_DIR).join("sneaky.md"), "index dir junk").unwrap();
        fs::create_dir_all(base.join("notes/.hidden")).unwrap();
        fs::write(base.join("notes/.hidden/h.md"), "hidden dir junk").unwrap();
    }

    #[test]
    fn reconcile_indexes_notes_and_excludes_locked_hidden_and_empty() {
        let forge = TempForge::new("reconcile");
        seed_vault(&forge);
        let fake = FakeEmbedder::new();
        let entries = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
        let mut paths: Vec<&str> = entries.iter().map(|e| e.path.as_str()).collect();
        paths.sort();
        assert_eq!(
            paths,
            vec![
                "daily/2026-07-12.md",
                "notes/Projects/bread.md",
                "notes/rust.md",
                "weekly/2026-W28.md",
            ]
        );
        // Frontmatter must be stripped before embedding/hashing.
        let bread = entries
            .iter()
            .find(|e| e.path == "notes/Projects/bread.md")
            .unwrap();
        assert_eq!(bread.content_hash, content_hash("sourdough bread baking"));
        assert_eq!(bread.title, "bread");
    }

    #[test]
    fn reconcile_reuses_unchanged_embeddings_and_reembeds_edits() {
        let forge = TempForge::new("incremental");
        seed_vault(&forge);
        let fake = FakeEmbedder::new();
        let first = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
        let calls_after_first = fake.embed_calls();
        assert!(calls_after_first >= 4);

        // Nothing changed → no new embed calls.
        let second = reconcile_index(forge.path(), &fake, &first, |_, _| true).unwrap();
        assert_eq!(fake.embed_calls(), calls_after_first);
        assert_eq!(second.len(), first.len());

        // Edit one note, delete another → exactly one re-embed, one drop.
        fs::write(forge.path().join("notes/rust.md"), "rust async runtimes").unwrap();
        fs::remove_file(forge.path().join("daily/2026-07-12.md")).unwrap();
        let third = reconcile_index(forge.path(), &fake, &second, |_, _| true).unwrap();
        assert_eq!(fake.embed_calls(), calls_after_first + 1);
        assert_eq!(third.len(), first.len() - 1);
        assert!(!third.iter().any(|e| e.path == "daily/2026-07-12.md"));
        let rust = third.iter().find(|e| e.path == "notes/rust.md").unwrap();
        assert_eq!(rust.content_hash, content_hash("rust async runtimes"));
    }

    #[test]
    fn stress_reconcile_builds_1000_note_vault_with_fake_embedder() {
        let forge = TempForge::new("stress-1000");
        for i in 0..1000 {
            let dir = if i % 4 == 0 {
                forge.path().join("notes/Projects")
            } else {
                forge.path().join("notes")
            };
            fs::write(
                dir.join(format!("note-{i}.md")),
                format!("# Note {i}\nsemantic stress corpus item {i} with common words"),
            )
            .unwrap();
        }
        let fake = FakeEmbedder::new();
        let started = std::time::Instant::now();
        let entries = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
        let elapsed = started.elapsed();
        assert_eq!(entries.len(), 1000);
        assert_eq!(fake.embed_calls(), 1000);
        save_index(forge.path(), &entries, DEFAULT_MODEL_ID).unwrap();
        assert_eq!(
            load_index(forge.path(), DEFAULT_MODEL_ID).unwrap().len(),
            1000
        );
        eprintln!("[stress] semantic build over 1000 notes took {elapsed:?}");
        assert!(elapsed.as_secs() < 10, "semantic build took {elapsed:?}");
    }

    #[test]
    fn incremental_save_rename_trash_restore_churn_matches_disk() {
        let forge = TempForge::new("churn");
        let fake = FakeEmbedder::new();
        let mut entries = Vec::new();
        let a = forge.path().join("notes/a.md");
        let b = forge.path().join("notes/Projects/β.md");
        let trashed = forge.path().join(".trash/β.md");

        for revision in 0..25 {
            fs::write(&a, format!("revision {revision}")).unwrap();
            refresh_entry(forge.path(), &fake, &mut entries, "notes/a.md").unwrap();
        }
        fs::rename(&a, &b).unwrap();
        refresh_entry(forge.path(), &fake, &mut entries, "notes/a.md").unwrap();
        refresh_entry(forge.path(), &fake, &mut entries, "notes/Projects/β.md").unwrap();
        fs::rename(&b, &trashed).unwrap();
        refresh_entry(forge.path(), &fake, &mut entries, "notes/Projects/β.md").unwrap();
        fs::rename(&trashed, &b).unwrap();
        refresh_entry(forge.path(), &fake, &mut entries, "notes/Projects/β.md").unwrap();

        let rebuilt = reconcile_index(forge.path(), &fake, &entries, |_, _| true).unwrap();
        assert_eq!(rebuilt.len(), 1);
        assert_eq!(rebuilt[0].path, "notes/Projects/β.md");
        assert_eq!(rebuilt[0].content_hash, content_hash("revision 24"));
        assert_eq!(rebuilt, entries);
    }

    #[test]
    fn corrupt_truncated_and_model_mismatched_indexes_rebuild_cleanly() {
        let forge = TempForge::new("fallbacks");
        fs::write(forge.path().join("notes/a.md"), "alpha body").unwrap();
        let fake = FakeEmbedder::new();
        fs::create_dir_all(forge.path().join(INDEX_DIR)).unwrap();
        for corrupt in [b"\x01\x02".as_slice(), b"truncated-index".as_slice()] {
            fs::write(index_path(forge.path()), corrupt).unwrap();
            assert!(load_index(forge.path(), DEFAULT_MODEL_ID).is_none());
            let rebuilt = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
            save_index(forge.path(), &rebuilt, DEFAULT_MODEL_ID).unwrap();
            assert_eq!(load_index(forge.path(), DEFAULT_MODEL_ID).unwrap(), rebuilt);
        }

        let entries = load_index(forge.path(), DEFAULT_MODEL_ID).unwrap();
        save_index(forge.path(), &entries, "bge-small-en-v1.5").unwrap();
        assert!(load_index(forge.path(), DEFAULT_MODEL_ID).is_none());
        let rebuilt = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
        save_index(forge.path(), &rebuilt, DEFAULT_MODEL_ID).unwrap();
        assert_eq!(load_index(forge.path(), DEFAULT_MODEL_ID).unwrap(), rebuilt);
    }

    #[test]
    fn locked_note_exclusion_survives_repeated_lock_unlock_churn() {
        let forge = TempForge::new("lock-churn");
        let plain = forge.path().join("notes/secret.md");
        let locked = forge.path().join("notes/secret.md.locked");
        let fake = FakeEmbedder::new();
        let mut entries = Vec::new();
        for revision in 0..20 {
            fs::write(&plain, format!("secret plaintext {revision}")).unwrap();
            refresh_entry(forge.path(), &fake, &mut entries, "notes/secret.md").unwrap();
            assert_eq!(entries.len(), 1);
            fs::remove_file(&plain).unwrap();
            fs::write(&locked, format!("ciphertext-{revision}")).unwrap();
            refresh_entry(forge.path(), &fake, &mut entries, "notes/secret.md").unwrap();
            assert!(entries.is_empty());
            fs::remove_file(&locked).unwrap();
        }
        assert!(scan_note_sources(forge.path()).is_empty());
    }

    #[test]
    fn reconcile_reports_progress_and_can_be_cancelled() {
        let forge = TempForge::new("cancel");
        seed_vault(&forge);
        let fake = FakeEmbedder::new();
        let mut seen: Vec<(usize, usize)> = Vec::new();
        reconcile_index(forge.path(), &fake, &[], |done, total| {
            seen.push((done, total));
            true
        })
        .unwrap();
        assert_eq!(seen.len(), 4);
        assert_eq!(seen.last(), Some(&(4, 4)));

        let err = reconcile_index(forge.path(), &fake, &[], |_, _| false).unwrap_err();
        assert_eq!(err, CANCELLED);
    }

    // ---- single-note refresh --------------------------------------------------

    #[test]
    fn refresh_entry_updates_removes_and_skips_unchanged() {
        let forge = TempForge::new("refresh");
        seed_vault(&forge);
        let fake = FakeEmbedder::new();
        let mut entries = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();

        // Unchanged → false.
        assert!(!refresh_entry(forge.path(), &fake, &mut entries, "notes/rust.md").unwrap());

        // Edited → true, hash updated.
        fs::write(forge.path().join("notes/rust.md"), "tokio and async-std").unwrap();
        assert!(refresh_entry(forge.path(), &fake, &mut entries, "notes/rust.md").unwrap());
        let rust = entries.iter().find(|e| e.path == "notes/rust.md").unwrap();
        assert_eq!(rust.content_hash, content_hash("tokio and async-std"));

        // New note → inserted.
        fs::write(forge.path().join("notes/new.md"), "fresh content").unwrap();
        assert!(refresh_entry(forge.path(), &fake, &mut entries, "notes/new.md").unwrap());
        assert!(entries.iter().any(|e| e.path == "notes/new.md"));

        // Deleted from disk → removed from index.
        fs::remove_file(forge.path().join("notes/new.md")).unwrap();
        assert!(refresh_entry(forge.path(), &fake, &mut entries, "notes/new.md").unwrap());
        assert!(!entries.iter().any(|e| e.path == "notes/new.md"));

        // Emptied → removed.
        fs::write(forge.path().join("notes/rust.md"), "  \n").unwrap();
        assert!(refresh_entry(forge.path(), &fake, &mut entries, "notes/rust.md").unwrap());
        assert!(!entries.iter().any(|e| e.path == "notes/rust.md"));
    }

    #[test]
    fn refresh_entry_removes_note_that_became_locked() {
        let forge = TempForge::new("locked");
        seed_vault(&forge);
        let fake = FakeEmbedder::new();
        let mut entries = reconcile_index(forge.path(), &fake, &[], |_, _| true).unwrap();
        assert!(entries.iter().any(|e| e.path == "notes/rust.md"));

        // Simulate lock_note: plaintext removed, ciphertext appears.
        fs::remove_file(forge.path().join("notes/rust.md")).unwrap();
        fs::write(forge.path().join("notes/rust.md.locked"), "ciphertext").unwrap();

        assert!(refresh_entry(forge.path(), &fake, &mut entries, "notes/rust.md").unwrap());
        assert!(!entries.iter().any(|e| e.path == "notes/rust.md"));
        // And the ciphertext itself can never be addressed for indexing:
        // hidden/locked names fail path validation inside refresh_entry.
        assert!(!refresh_entry(forge.path(), &fake, &mut entries, "notes/../etc/passwd").unwrap());
    }

    // ---- path helpers -----------------------------------------------------------

    #[test]
    fn note_rel_path_maps_note_kinds() {
        assert_eq!(
            note_rel_path("2026-07-12.md", true, false),
            "daily/2026-07-12.md"
        );
        assert_eq!(
            note_rel_path("2026-W28.md", false, true),
            "weekly/2026-W28.md"
        );
        assert_eq!(
            note_rel_path("Projects/x.md", false, false),
            "notes/Projects/x.md"
        );
    }

    #[test]
    fn note_index_path_validation() {
        assert!(is_valid_note_index_path("daily/2026-07-12.md"));
        assert!(is_valid_note_index_path("weekly/2026-W28.md"));
        assert!(is_valid_note_index_path("notes/Projects/x.md"));
        assert!(!is_valid_note_index_path("notes/../escape.md"));
        assert!(!is_valid_note_index_path(".trash/x.md"));
        assert!(!is_valid_note_index_path(".index/embeddings.v1.bin"));
        assert!(!is_valid_note_index_path("templates/t.json"));
        assert!(!is_valid_note_index_path("bare.md"));
        assert!(!is_valid_note_index_path("notes/.hidden/x.md"));
        assert!(!is_valid_note_index_path("notes/x.md\0"));
    }
}
