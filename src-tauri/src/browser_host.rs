//! Chrome/Firefox native-messaging host.
//!
//! The browser launches this process, so it must not initialize the GUI. The
//! transport is a 4-byte little-endian length prefix followed by a JSON body,
//! which is the only difference from the `--mcp` stdio server.
//!
//! Exactly two operations exist and both are write-side. This bridge must never
//! grow a read: the extension is authenticated only by the extension ID pinned in
//! the host manifest, which is a weaker claim than a user sitting in the app.

use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use crate::persist::write_atomic;
use crate::validation::{sanitize_path_segment, validate_path_within_base};

/// Chrome caps host → extension messages at 1 MB; inbound is our own bound.
pub(crate) const MAX_INBOUND: usize = 8 * 1024 * 1024;
pub(crate) const MAX_OUTBOUND: usize = 1024 * 1024;

/// Clips live in their own folder so a week of reading cannot bury your own notes.
const CLIPPINGS_DIR: &str = "Clippings";
/// Enough repeats of one page to be a mistake rather than a workflow.
const MAX_COLLISION_SUFFIX: u32 = 50;

/// Read one framed message. `Ok(None)` means the browser closed the pipe.
fn read_message(reader: &mut impl Read) -> Result<Option<Value>, String> {
    let mut header = [0u8; 4];
    match reader.read_exact(&mut header) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(format!("Failed to read message length: {error}")),
    }

    let length = u32::from_le_bytes(header) as usize;
    if length > MAX_INBOUND {
        return Err(format!("Message too large: {length} bytes"));
    }

    let mut body = vec![0u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| format!("Failed to read message body: {error}"))?;

    // A malformed body is the extension's problem, not a transport failure, so it
    // resolves to a null request that `handle` turns into an error response.
    Ok(Some(serde_json::from_slice(&body).unwrap_or(Value::Null)))
}

fn write_message(writer: &mut impl Write, value: &Value) -> Result<(), String> {
    let body = serde_json::to_vec(value).map_err(|error| format!("Failed to encode: {error}"))?;
    if body.len() > MAX_OUTBOUND {
        return Err(format!("Response too large: {} bytes", body.len()));
    }
    writer
        .write_all(&(body.len() as u32).to_le_bytes())
        .and_then(|()| writer.write_all(&body))
        .and_then(|()| writer.flush())
        .map_err(|error| format!("Failed to write response: {error}"))
}

fn error_response(message: &str) -> Value {
    json!({ "ok": false, "error": message })
}

/// Success bodies are objects, so `ok` is merged in rather than nesting the
/// payload one level deeper for every caller.
fn respond(result: Result<Value, String>) -> Value {
    match result {
        Ok(Value::Object(mut body)) => {
            body.insert("ok".to_string(), Value::Bool(true));
            Value::Object(body)
        }
        Ok(other) => json!({ "ok": true, "result": other }),
        Err(error) => error_response(&error),
    }
}

fn forges() -> Result<Value, String> {
    let forges = crate::commands::forges::list_forges()?;
    let active = forges
        .iter()
        .find(|forge| forge.is_active)
        .map(|forge| forge.name.clone());
    Ok(json!({
        "forges": forges.iter().map(|forge| forge.name.clone()).collect::<Vec<_>>(),
        "active": active,
    }))
}

/// Host of an http(s) URL, or `None` for any other scheme. Deliberately not a URL
/// parser: the only questions here are "is this safe to record" and "what do we
/// call the file when the page has no title".
fn http_host(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority.rsplit('@').next()?.split(':').next()?;
    (!host.is_empty()).then_some(host)
}

fn clip_stem(title: &str, url: &str) -> String {
    let fallback = http_host(url).unwrap_or("Clipped page");
    let title = title.trim();
    if title.is_empty() {
        return sanitize_path_segment(fallback, "Clipped page");
    }
    sanitize_path_segment(title, fallback)
}

fn clip_document(title: &str, url: &str, markdown: &str, clipped: &str) -> String {
    // The URL is quoted so a colon or a `#` cannot break the YAML block, and any
    // quote inside it is escaped.
    let source = url.replace('\\', "\\\\").replace('"', "\\\"");
    let heading = if title.trim().is_empty() {
        String::new()
    } else {
        format!("# {}\n\n", title.trim())
    };
    let body = markdown.trim_end();
    format!("---\nsource: \"{source}\"\nclipped: {clipped}\n---\n\n{heading}{body}\n")
}

fn unique_destination(dir: &Path, stem: &str) -> Result<PathBuf, String> {
    let first = dir.join(format!("{stem}.md"));
    if !first.exists() {
        return Ok(first);
    }
    for suffix in 2..=MAX_COLLISION_SUFFIX {
        let candidate = dir.join(format!("{stem} ({suffix}).md"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Too many clippings of this page already exist".to_string())
}

fn required_str<'a>(request: &'a Value, key: &str) -> Result<&'a str, String> {
    request
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn clip(request: &Value) -> Result<Value, String> {
    let url = required_str(request, "url")?;
    if http_host(url).is_none() {
        return Err("source must be an http(s) URL".to_string());
    }
    let markdown = required_str(request, "markdown")?;
    let title = request.get("title").and_then(Value::as_str).unwrap_or("");

    let forge_root = crate::mcp::resolve_named_forge(request.get("forge").and_then(Value::as_str))?;
    let dir = forge_root.join("notes").join(CLIPPINGS_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create the Clippings folder: {error}"))?;

    let path = unique_destination(&dir, &clip_stem(title, url))?;
    validate_path_within_base(&path, &forge_root)
        .map_err(|_| "Refusing to write outside the Forge".to_string())?;

    let clipped = chrono::Local::now().format("%Y-%m-%d").to_string();
    write_atomic(
        &path,
        clip_document(title, url, markdown, &clipped).as_bytes(),
        Some(0o600),
    )?;

    let relative = path
        .strip_prefix(&forge_root)
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    Ok(json!({ "path": relative }))
}

fn handle(request: &Value) -> Value {
    match request.get("op").and_then(Value::as_str) {
        Some("forges") => respond(forges()),
        Some("clip") => respond(clip(request)),
        _ => error_response("unsupported operation"),
    }
}

/// Serve until the browser closes stdin. Operation failures are responses;
/// only a broken transport ends the loop.
pub fn serve(mut input: impl Read, mut output: impl Write) -> Result<(), String> {
    while let Some(request) = read_message(&mut input)? {
        let response = handle(&request);
        write_message(&mut output, &response)?;
    }
    Ok(())
}

/// Entry point used by `main.rs` once launch-mode detection has fired.
pub fn run() -> Result<(), String> {
    serve(std::io::stdin().lock(), std::io::stdout().lock())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn framed(body: &str) -> Vec<u8> {
        let mut out = (body.len() as u32).to_le_bytes().to_vec();
        out.extend_from_slice(body.as_bytes());
        out
    }

    fn responses(input: Vec<u8>) -> Vec<Value> {
        let mut output: Vec<u8> = Vec::new();
        serve(input.as_slice(), &mut output).unwrap();
        let mut out = Vec::new();
        let mut cursor = 0usize;
        while cursor + 4 <= output.len() {
            let len = u32::from_le_bytes(output[cursor..cursor + 4].try_into().unwrap()) as usize;
            cursor += 4;
            out.push(serde_json::from_slice(&output[cursor..cursor + len]).unwrap());
            cursor += len;
        }
        out
    }

    #[test]
    fn unknown_operation_is_rejected_without_closing_the_stream() {
        let mut input = framed(r#"{"op":"read_note","path":"daily/2026-08-17.md"}"#);
        input.extend(framed(r#"{"op":"nope"}"#));

        let out = responses(input);

        assert_eq!(out.len(), 2);
        for response in out {
            assert_eq!(response["ok"], Value::Bool(false));
            assert_eq!(response["error"], "unsupported operation");
        }
    }

    #[test]
    fn eof_ends_the_loop_cleanly() {
        assert!(responses(Vec::new()).is_empty());
    }

    #[test]
    fn oversized_length_header_is_refused() {
        let mut input = ((MAX_INBOUND + 1) as u32).to_le_bytes().to_vec();
        input.extend_from_slice(b"{}");

        let mut output: Vec<u8> = Vec::new();
        let error = serve(input.as_slice(), &mut output).unwrap_err();

        assert!(error.contains("too large"), "unexpected error: {error}");
        assert!(output.is_empty());
    }

    #[test]
    fn forges_lists_names_and_marks_the_active_one() {
        let out = responses(framed(r#"{"op":"forges"}"#));

        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["ok"], Value::Bool(true));
        assert!(out[0]["forges"].is_array(), "forges should be an array");
        // The active Forge is either null or one of the listed names — never a
        // name that isn't there, which is what the popup would render blank.
        if let Some(active) = out[0]["active"].as_str() {
            let names: Vec<&str> = out[0]["forges"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(Value::as_str)
                .collect();
            assert!(names.contains(&active), "active {active} not in {names:?}");
        }
    }

    #[test]
    fn malformed_json_is_an_error_response_not_a_crash() {
        let out = responses(framed("{not json"));

        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["ok"], Value::Bool(false));
    }

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "moldavite-clip-{label}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn clip_document_carries_source_and_date_then_the_body() {
        let note = clip_document(
            "How TLS works",
            "https://example.com/tls",
            "First paragraph.",
            "2026-08-17",
        );

        assert_eq!(
            note,
            "---\nsource: \"https://example.com/tls\"\nclipped: 2026-08-17\n---\n\n# How TLS works\n\nFirst paragraph.\n"
        );
    }

    #[test]
    fn clip_stem_falls_back_to_the_host_when_a_page_has_no_title() {
        assert_eq!(
            clip_stem("How TLS works", "https://example.com/a"),
            "How TLS works"
        );
        assert_eq!(clip_stem("   ", "https://example.com/a"), "example.com");
        // A traversal attempt is a filename, never a path.
        let hostile = clip_stem("../../etc/passwd", "https://example.com/a");
        assert!(!hostile.contains('/'), "unexpected stem: {hostile}");
    }

    #[test]
    fn a_second_clip_of_the_same_page_does_not_overwrite_the_first() {
        let dir = temp_dir("collision");

        let first = unique_destination(&dir, "Same title").unwrap();
        std::fs::write(&first, "original").unwrap();
        let second = unique_destination(&dir, "Same title").unwrap();

        assert_eq!(first.file_name().unwrap(), "Same title.md");
        assert_eq!(second.file_name().unwrap(), "Same title (2).md");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "original");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clip_rejects_a_non_http_source() {
        let response = handle(&json!({
            "op": "clip",
            "url": "javascript:alert(1)",
            "title": "x",
            "markdown": "body",
        }));

        assert_eq!(response["ok"], Value::Bool(false));
        assert_eq!(response["error"], "source must be an http(s) URL");
    }

    #[test]
    fn clip_rejects_an_unknown_forge() {
        let response = handle(&json!({
            "op": "clip",
            "forge": "NoSuchForge-9f3a",
            "url": "https://example.com/a",
            "title": "x",
            "markdown": "body",
        }));

        assert_eq!(response["ok"], Value::Bool(false));
    }
}
