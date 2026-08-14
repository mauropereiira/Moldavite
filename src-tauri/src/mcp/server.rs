//! Bounded newline-delimited JSON-RPC transport for the built-in MCP server.
//!
//! The protocol surface is intentionally limited to `initialize`, `tools/list`,
//! and `tools/call`; notifications receive no response. Input is untrusted and a
//! request line may never retain more than 1 MiB. Oversized lines are drained so
//! one hostile request cannot desynchronize the remainder of the session.

use std::io::{BufRead, Write};

use serde_json::{json, Value};

use super::tools::ToolContext;

const LATEST_PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_REQUEST_BYTES: usize = 1024 * 1024;

enum InputLine {
    Line(Vec<u8>),
    Oversized,
}

/// Read one newline-delimited request without ever retaining more than the
/// configured request cap. Oversized lines are drained so the next request in
/// the same session can still be processed.
fn read_bounded_line<R: BufRead>(reader: &mut R) -> Result<Option<InputLine>, String> {
    let mut line = Vec::new();
    let mut oversized = false;
    loop {
        let buf = reader
            .fill_buf()
            .map_err(|error| format!("Failed to read stdin: {error}"))?;
        if buf.is_empty() {
            if line.is_empty() && !oversized {
                return Ok(None);
            }
            return Ok(Some(if oversized {
                InputLine::Oversized
            } else {
                InputLine::Line(line)
            }));
        }
        let newline = buf.iter().position(|byte| *byte == b'\n');
        let consumed = newline.map_or(buf.len(), |index| index + 1);
        if !oversized {
            let payload_len = newline.unwrap_or(consumed);
            if line.len().saturating_add(payload_len) > MAX_REQUEST_BYTES {
                oversized = true;
                line.clear();
            } else {
                line.extend_from_slice(&buf[..payload_len]);
            }
        }
        reader.consume(consumed);
        if newline.is_some() {
            return Ok(Some(if oversized {
                InputLine::Oversized
            } else {
                InputLine::Line(line)
            }));
        }
    }
}

/// Serve requests until EOF, emitting at most one newline-delimited response per request.
pub(super) fn serve<R: BufRead, W: Write>(
    mut reader: R,
    mut writer: W,
    context: ToolContext,
) -> Result<(), String> {
    while let Some(line) = read_bounded_line(&mut reader)? {
        let response = match line {
            InputLine::Oversized => Some(error_response(
                Value::Null,
                -32600,
                "Request exceeds the 1 MiB limit",
            )),
            InputLine::Line(line) if line.iter().all(u8::is_ascii_whitespace) => continue,
            InputLine::Line(line) => match serde_json::from_slice::<Value>(&line) {
                Ok(request) => handle_request(&context, request),
                Err(error) => Some(error_response(
                    Value::Null,
                    -32700,
                    &format!("Parse error: {error}"),
                )),
            },
        };
        if let Some(response) = response {
            serde_json::to_writer(&mut writer, &response)
                .map_err(|error| format!("Failed to encode response: {error}"))?;
            writer
                .write_all(b"\n")
                .map_err(|error| format!("Failed to write stdout: {error}"))?;
            writer
                .flush()
                .map_err(|error| format!("Failed to flush stdout: {error}"))?;
        }
    }
    Ok(())
}

fn handle_request(context: &ToolContext, request: Value) -> Option<Value> {
    let id = request.get("id").cloned();
    if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(error_response(
            id.unwrap_or(Value::Null),
            -32600,
            "Invalid JSON-RPC request",
        ));
    }
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return Some(error_response(
            id.unwrap_or(Value::Null),
            -32600,
            "Missing JSON-RPC method",
        ));
    };

    // Notifications intentionally have no response.
    let id = id?;
    let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
    match method {
        "initialize" => {
            context.set_client_name(
                params
                    .get("clientInfo")
                    .and_then(|client_info| client_info.get("name"))
                    .and_then(Value::as_str),
            );
            let requested = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(LATEST_PROTOCOL_VERSION);
            let protocol = if SUPPORTED_PROTOCOL_VERSIONS.contains(&requested) {
                requested
            } else {
                LATEST_PROTOCOL_VERSION
            };
            Some(success_response(
                id,
                json!({
                    "protocolVersion": protocol,
                    "capabilities": { "tools": {} },
                    "serverInfo": {
                        "name": "moldavite",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                }),
            ))
        }
        "tools/list" => Some(success_response(
            id,
            json!({ "tools": context.tool_definitions() }),
        )),
        "tools/call" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                return Some(error_response(
                    id,
                    -32602,
                    "tools/call requires a tool name",
                ));
            };
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            Some(success_response(id, context.call(name, &arguments)))
        }
        _ => Some(error_response(id, -32601, "Method not found")),
    }
}

fn success_response(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error_response(id: Value, code: i32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn temp_forge(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "moldavite-mcp-{tag}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        for folder in ["daily", "weekly", "notes"] {
            fs::create_dir_all(root.join(folder)).unwrap();
        }
        root
    }

    fn request(id: u32, method: &str, params: Value) -> String {
        format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
        )
    }

    fn run(input: String, context: ToolContext) -> Vec<Value> {
        let mut output = Vec::new();
        serve(Cursor::new(input), &mut output, context).unwrap();
        String::from_utf8(output)
            .unwrap()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    #[test]
    fn protocol_round_trip_covers_every_tool() {
        let root = temp_forge("roundtrip");
        fs::write(
            root.join("notes/source.md"),
            "# Source\n\n[[Target]]\nneedle",
        )
        .unwrap();
        fs::write(root.join("notes/target.md"), "# Target\n\nneedle").unwrap();
        let mut input = request(
            1,
            "initialize",
            json!({ "protocolVersion": "2024-11-05", "clientInfo": {"name":"test","version":"1"} }),
        );
        input.push_str(&format!(
            "{}\n",
            json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })
        ));
        input.push_str(&request(2, "tools/list", json!({})));
        let calls = [
            ("search_notes", json!({"query":"needle"})),
            ("read_note", json!({"path":"notes/target.md"})),
            ("list_notes", json!({"folder":"notes"})),
            ("get_backlinks", json!({"path":"notes/target.md"})),
            (
                "create_note",
                json!({"path":"notes/new.md","content":"new"}),
            ),
            (
                "append_to_daily_note",
                json!({"content":"daily","date":"2026-07-12"}),
            ),
            (
                "write_note",
                json!({"path":"notes/new.md","content":"replaced"}),
            ),
        ];
        for (offset, (name, arguments)) in calls.into_iter().enumerate() {
            input.push_str(&request(
                offset as u32 + 3,
                "tools/call",
                json!({"name": name, "arguments": arguments}),
            ));
        }
        let responses = run(input, ToolContext::new(root.clone(), true, false));
        assert_eq!(responses.len(), 9);
        assert_eq!(responses[0]["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(responses[1]["result"]["tools"].as_array().unwrap().len(), 7);
        for response in &responses[2..] {
            assert_ne!(response["result"]["isError"], true);
        }
        assert_eq!(
            fs::read_to_string(root.join("notes/new.md")).unwrap(),
            "replaced"
        );
        assert!(fs::read_to_string(root.join("daily/2026-07-12.md"))
            .unwrap()
            .contains("daily"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_gating_omits_and_refuses_write_tools() {
        let root = temp_forge("gating");
        let input = request(1, "tools/list", json!({}))
            + &request(
                2,
                "tools/call",
                json!({"name":"create_note","arguments":{"path":"notes/no.md","content":"x"}}),
            );
        let responses = run(input, ToolContext::new(root.clone(), false, false));
        assert_eq!(responses[0]["result"]["tools"].as_array().unwrap().len(), 4);
        assert!(responses[1]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Settings → AI & Agents → Allow agents to write"));
        assert!(!root.join("notes/no.md").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_note_preserves_existing_frontmatter() {
        let root = temp_forge("frontmatter-write");
        fs::write(
            root.join("notes/colored.md"),
            "---\ncolor: blue\ntags:\n- kept\n---\nold body",
        )
        .unwrap();

        let response = ToolContext::new(root.clone(), true, false).call(
            "write_note",
            &json!({"path":"notes/colored.md","content":"new body"}),
        );
        assert_eq!(response["isError"], false);

        let raw = fs::read_to_string(root.join("notes/colored.md")).unwrap();
        let parsed = crate::frontmatter::parse_note(&raw);
        assert_eq!(parsed.color.as_deref(), Some("blue"));
        assert!(parsed.extra.contains_key("tags"));
        assert_eq!(parsed.body, "new body");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initialized_client_is_recorded_with_the_mcp_write_body_hash() {
        let root = temp_forge("agent-write-marker");
        let spool = root.with_extension("agent-writes");
        fs::write(root.join("notes/marked.md"), "old body").unwrap();
        let context = ToolContext::new(root.clone(), true, false)
            .with_agent_write_spool(spool.clone());
        let input = request(
            1,
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "clientInfo": {"name": "Claude Code", "version": "1"}
            }),
        ) + &request(
            2,
            "tools/call",
            json!({
                "name": "write_note",
                "arguments": {
                    "path": "notes/marked.md",
                    "content": "---\ntags: [agent]\n---\nagent body"
                }
            }),
        );

        let responses = run(input, context);

        assert_eq!(responses[1]["result"]["isError"], false);
        let info = crate::agent_writes::take_agent_write_from(
            &spool,
            &root,
            "notes/marked.md",
            &crate::commands::notes::sha256_hex("agent body"),
        )
        .expect("MCP write should leave a matching attribution marker");
        assert_eq!(info.client.as_deref(), Some("Claude Code"));
        assert!(crate::agent_writes::take_agent_write_from(
            &spool,
            &root,
            "notes/marked.md",
            &crate::commands::notes::sha256_hex("agent body")
        )
        .is_none());

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(spool).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn legacy_nonportable_notes_remain_addressable_but_cannot_be_created() {
        let root = temp_forge("legacy-paths");
        let legacy_folder = root.join("notes/Q3: Roadmap.");
        fs::create_dir_all(&legacy_folder).unwrap();
        fs::write(legacy_folder.join("Reports..md"), "legacy body").unwrap();
        let context = ToolContext::new(root.clone(), true, false);
        let legacy_path = "notes/Q3: Roadmap./Reports..md";

        let read = context.call("read_note", &json!({"path": legacy_path}));
        assert_eq!(read["isError"], false);
        assert_eq!(read["structuredContent"]["content"], "legacy body");

        let write = context.call(
            "write_note",
            &json!({"path": legacy_path, "content": "saved body"}),
        );
        assert_eq!(write["isError"], false);
        assert_eq!(
            fs::read_to_string(legacy_folder.join("Reports..md")).unwrap(),
            "saved body"
        );

        let listed = context.call("list_notes", &json!({"folder": "notes/Q3: Roadmap."}));
        assert_eq!(listed["isError"], false);
        assert_eq!(listed["structuredContent"]["notes"][0]["path"], legacy_path);

        let valid_in_legacy_parent = context.call(
            "create_note",
            &json!({"path": "notes/Q3: Roadmap./Portable.md", "content": "new"}),
        );
        assert_eq!(valid_in_legacy_parent["isError"], false);

        for invalid_path in [
            "notes/Q3: Roadmap./New: Note.md",
            "notes/New: Folder/Portable.md",
            "notes/Reports..md",
        ] {
            let rejected = context.call(
                "create_note",
                &json!({"path": invalid_path, "content": "must not exist"}),
            );
            assert_eq!(rejected["isError"], true);
            assert!(rejected["structuredContent"]["error"]
                .as_str()
                .unwrap()
                .contains("Invalid note path"));
        }

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_note_with_matching_base_hash_reports_no_conflict_copy() {
        let root = temp_forge("matching-base-hash");
        let note_path = root.join("notes/matching.md");
        fs::write(&note_path, "---\ncolor: blue\n---\ndisk body").unwrap();
        let base_hash = crate::commands::notes::sha256_hex("disk body");

        let response = ToolContext::new(root.clone(), true, false).call(
            "write_note",
            &json!({
                "path": "notes/matching.md",
                "content": "agent body",
                "baseHash": base_hash
            }),
        );

        assert_eq!(response["isError"], false);
        assert_eq!(response["structuredContent"]["written"], true);
        assert!(response["structuredContent"]["conflictCopy"].is_null());
        let raw = fs::read_to_string(&note_path).unwrap();
        assert_eq!(crate::frontmatter::parse_note(&raw).body, "agent body");
        assert_eq!(fs::read_dir(root.join("notes")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_note_with_mismatched_base_hash_reports_preserved_copy() {
        let root = temp_forge("mismatched-base-hash");
        let note_path = root.join("notes/conflicted.md");
        let disk_version = "---\ncolor: green\ntags: [kept]\n---\nexternal body";
        fs::write(&note_path, disk_version).unwrap();
        let stale_hash = crate::commands::notes::sha256_hex("original body");

        let response = ToolContext::new(root.clone(), true, false).call(
            "write_note",
            &json!({
                "path": "notes/conflicted.md",
                "content": "agent body",
                "baseHash": stale_hash
            }),
        );

        assert_eq!(response["isError"], false);
        assert_eq!(response["structuredContent"]["written"], true);
        let conflict_name = response["structuredContent"]["conflictCopy"]
            .as_str()
            .expect("conflict response should name the preserved copy");
        let written = fs::read_to_string(&note_path).unwrap();
        assert_eq!(crate::frontmatter::parse_note(&written).body, "agent body");
        assert_eq!(
            fs::read_to_string(root.join("notes").join(conflict_name)).unwrap(),
            disk_version
        );
        assert_eq!(fs::read_dir(root.join("notes")).unwrap().count(), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_note_without_base_hash_keeps_legacy_overwrite_behavior() {
        let root = temp_forge("absent-base-hash");
        let note_path = root.join("notes/legacy.md");
        fs::write(&note_path, "disk body").unwrap();

        let response = ToolContext::new(root.clone(), true, false).call(
            "write_note",
            &json!({"path": "notes/legacy.md", "content": "agent body"}),
        );

        assert_eq!(response["isError"], false);
        assert_eq!(fs::read_to_string(&note_path).unwrap(), "agent body");
        assert_eq!(fs::read_dir(root.join("notes")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_note_body_hash_round_trips_into_write_note() {
        let root = temp_forge("read-hash-roundtrip");
        let note_path = root.join("notes/roundtrip.md");
        let raw = "---\ncolor: purple\ncustom: kept\n---\ndisk body";
        fs::write(&note_path, raw).unwrap();
        let context = ToolContext::new(root.clone(), true, false);

        let read = context.call("read_note", &json!({"path": "notes/roundtrip.md"}));
        assert_eq!(read["isError"], false);
        assert_eq!(read["structuredContent"]["content"], raw);
        let content_hash = read["structuredContent"]["contentHash"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(
            content_hash,
            crate::commands::notes::sha256_hex("disk body")
        );
        assert_ne!(content_hash, crate::commands::notes::sha256_hex(raw));

        let write = context.call(
            "write_note",
            &json!({
                "path": "notes/roundtrip.md",
                "content": "agent body",
                "baseHash": content_hash
            }),
        );

        assert_eq!(write["isError"], false);
        let written = fs::read_to_string(&note_path).unwrap();
        let parsed = crate::frontmatter::parse_note(&written);
        assert_eq!(parsed.body, "agent body");
        assert_eq!(parsed.color.as_deref(), Some("purple"));
        assert!(parsed.extra.contains_key("custom"));
        assert_eq!(fs::read_dir(root.join("notes")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_note_description_documents_optional_base_hash_and_conflict_response() {
        let root = temp_forge("base-hash-schema");
        let tools = ToolContext::new(root.clone(), true, false).tool_definitions();
        let write_note = tools
            .iter()
            .find(|tool| tool["name"] == "write_note")
            .unwrap();

        assert_eq!(
            write_note["inputSchema"]["properties"]["baseHash"]["type"],
            "string"
        );
        assert!(write_note["description"]
            .as_str()
            .unwrap()
            .contains("baseHash"));
        assert!(write_note["description"]
            .as_str()
            .unwrap()
            .contains("conflictCopy"));
        assert!(!write_note["inputSchema"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .any(|field| field.as_str() == Some("baseHash")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_traversal_and_locked_notes() {
        let root = temp_forge("security");
        fs::write(root.join("notes/secret.md.locked"), "ciphertext").unwrap();
        let input = request(
            1,
            "tools/call",
            json!({"name":"read_note","arguments":{"path":"notes/../../etc/passwd"}}),
        ) + &request(
            2,
            "tools/call",
            json!({"name":"read_note","arguments":{"path":"notes/secret.md"}}),
        ) + &request(
            3,
            "tools/call",
            json!({"name":"write_note","arguments":{"path":"notes/secret.md","content":"oops"}}),
        );
        let responses = run(input, ToolContext::new(root.clone(), true, false));
        assert!(responses[0]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Invalid note path"));
        for response in &responses[1..] {
            assert!(response["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("locked"));
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_oversized_unknown_and_recovery_are_bounded() {
        let root = temp_forge("bad-input");
        let mut input = "{definitely not json}\n".to_string();
        input.push_str(&"x".repeat(MAX_REQUEST_BYTES + 1));
        input.push('\n');
        input.push_str(&request(3, "unknown/method", json!({})));
        input.push_str(&request(4, "tools/list", json!({})));
        let responses = run(input, ToolContext::new(root.clone(), false, false));
        assert_eq!(responses.len(), 4);
        assert_eq!(responses[0]["error"]["code"], -32700);
        assert_eq!(responses[1]["error"]["code"], -32600);
        assert!(responses[1]["error"]["message"]
            .as_str()
            .unwrap()
            .contains("1 MiB"));
        assert_eq!(responses[2]["error"]["code"], -32601);
        assert_eq!(responses[3]["result"]["tools"].as_array().unwrap().len(), 4);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn every_path_bearing_tool_rejects_traversal_and_unknown_tools_are_clean_errors() {
        let root = temp_forge("all-traversal");
        let calls = [
            ("read_note", json!({"path":"notes/../../escape.md"})),
            ("get_backlinks", json!({"path":"daily/../escape.md"})),
            ("list_notes", json!({"folder":"notes/../escape"})),
            (
                "create_note",
                json!({"path":"notes/a/../../../escape.md","content":"x"}),
            ),
            (
                "write_note",
                json!({"path":"weekly/../escape.md","content":"x"}),
            ),
            ("not_a_tool", json!({"path":"notes/safe.md"})),
        ];
        let mut input = String::new();
        for (index, (name, arguments)) in calls.into_iter().enumerate() {
            input.push_str(&request(
                index as u32,
                "tools/call",
                json!({"name":name,"arguments":arguments}),
            ));
        }
        let responses = run(input, ToolContext::new(root.clone(), true, false));
        assert_eq!(responses.len(), 6);
        assert!(responses
            .iter()
            .all(|response| response["result"]["isError"] == true));
        assert!(!root.parent().unwrap().join("escape.md").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn write_gate_flip_applies_without_restarting_session() {
        let root = temp_forge("gate-flip");
        let enabled = Arc::new(AtomicBool::new(true));
        let gate = enabled.clone();
        let context = ToolContext::with_write_gate(
            root.clone(),
            Arc::new(move || gate.load(Ordering::SeqCst)),
        );
        let first = context.call(
            "create_note",
            &json!({"path":"notes/first.md","content":"allowed"}),
        );
        assert_eq!(first["isError"], false);
        enabled.store(false, Ordering::SeqCst);
        assert_eq!(context.tool_definitions().len(), 4);
        let second = context.call(
            "create_note",
            &json!({"path":"notes/second.md","content":"blocked"}),
        );
        assert_eq!(second["isError"], true);
        assert!(!root.join("notes/second.md").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn active_forge_switch_is_observed_between_tool_calls() {
        let first = temp_forge("dynamic-first");
        let second = temp_forge("dynamic-second");
        let selected = Arc::new(Mutex::new(first.clone()));
        let selected_for_resolver = selected.clone();
        let resolver = Arc::new(move || {
            let root = selected_for_resolver.lock().unwrap().clone();
            if fs::symlink_metadata(&root)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return Err("Refusing to use a symlinked Forge".to_string());
            }
            if !root.is_dir() {
                return Err("Selected Forge does not exist".to_string());
            }
            Ok(root)
        });
        let context = ToolContext::with_forge_resolver(resolver, true);

        let first_call = context.call(
            "create_note",
            &json!({"path":"notes/first.md","content":"first Forge"}),
        );
        assert_eq!(first_call["isError"], false);
        *selected.lock().unwrap() = second.clone();
        let second_call = context.call(
            "create_note",
            &json!({"path":"notes/second.md","content":"second Forge"}),
        );
        assert_eq!(second_call["isError"], false);
        assert!(first.join("notes/first.md").is_file());
        assert!(!first.join("notes/second.md").exists());
        assert!(second.join("notes/second.md").is_file());

        *selected.lock().unwrap() = second.join("missing");
        let missing = context.call("list_notes", &json!({}));
        assert_eq!(missing["isError"], true);
        assert!(missing["structuredContent"]["error"]
            .as_str()
            .unwrap()
            .contains("does not exist"));

        fs::remove_dir_all(first).unwrap();
        fs::remove_dir_all(second).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn write_tools_reject_symlink_destinations_and_accept_regular_notes() {
        use std::os::unix::fs::symlink;

        let root = temp_forge("write-symlinks");
        let outside = root.parent().unwrap().join(format!(
            "moldavite-mcp-outside-{}-{}.md",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&outside, "outside secret").unwrap();
        symlink(&outside, root.join("daily/2026-07-13.md")).unwrap();
        symlink(&outside, root.join("notes/linked.md")).unwrap();
        let context = ToolContext::new(root.clone(), true, false);

        let append = context.call(
            "append_to_daily_note",
            &json!({"content":"steal","date":"2026-07-13"}),
        );
        let create = context.call(
            "create_note",
            &json!({"path":"notes/linked.md","content":"replace"}),
        );
        assert_eq!(append["isError"], true);
        assert_eq!(create["isError"], true);
        assert!(append["structuredContent"]["error"]
            .as_str()
            .unwrap()
            .contains("symlinked note"));
        assert_eq!(fs::read_to_string(&outside).unwrap(), "outside secret");

        let regular_create = context.call(
            "create_note",
            &json!({"path":"notes/regular.md","content":"regular"}),
        );
        let regular_append = context.call(
            "append_to_daily_note",
            &json!({"content":"daily","date":"2026-07-14"}),
        );
        assert_eq!(regular_create["isError"], false);
        assert_eq!(regular_append["isError"], false);
        assert_eq!(
            fs::read_to_string(root.join("notes/regular.md")).unwrap(),
            "regular"
        );
        assert_eq!(
            fs::read_to_string(root.join("daily/2026-07-14.md")).unwrap(),
            "daily"
        );

        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }

    #[test]
    fn sequential_call_storm_and_unicode_paths_stay_consistent() {
        let root = temp_forge("storm-unicode");
        fs::create_dir_all(root.join("notes/Projetos_日本語")).unwrap();
        fs::write(
            root.join("notes/Projetos_日本語/café.md"),
            "olá pedra verde",
        )
        .unwrap();
        let mut input = request(
            1,
            "tools/call",
            json!({"name":"read_note","arguments":{"path":"notes/Projetos_日本語/café.md"}}),
        );
        for id in 2..=121 {
            input.push_str(&request(
                id,
                "tools/call",
                json!({"name":"list_notes","arguments":{"folder":"notes/Projetos_日本語"}}),
            ));
        }
        let responses = run(input, ToolContext::new(root.clone(), false, false));
        assert_eq!(responses.len(), 121);
        assert!(responses
            .iter()
            .all(|response| response["result"]["isError"] != true));
        assert_eq!(
            responses[0]["result"]["structuredContent"]["content"],
            "olá pedra verde"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn keyword_search_over_1000_note_forge_is_time_bounded() {
        let root = temp_forge("large-search");
        for i in 0..1000 {
            let needle = if i % 100 == 0 { " unique-needle" } else { "" };
            fs::write(
                root.join("notes").join(format!("note-{i}.md")),
                format!("# Note {i}\nordinary searchable content{needle}"),
            )
            .unwrap();
        }
        let started = std::time::Instant::now();
        let response = ToolContext::new(root.clone(), false, false)
            .call("search_notes", &json!({"query":"unique-needle","limit":50}));
        let elapsed = started.elapsed();
        assert_eq!(response["isError"], false);
        assert_eq!(response["structuredContent"]["mode"], "keyword");
        assert_eq!(
            response["structuredContent"]["results"]
                .as_array()
                .unwrap()
                .len(),
            10
        );
        eprintln!("[stress] MCP search over 1000 notes took {elapsed:?}");
        assert!(
            elapsed.as_secs() < crate::stress_test::REGRESSION_BUDGET_SECS,
            "MCP search took {elapsed:?}"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
