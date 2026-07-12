use std::io::{BufRead, Write};

use serde_json::{json, Value};

use super::tools::ToolContext;

const LATEST_PROTOCOL_VERSION: &str = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

pub(super) fn serve<R: BufRead, W: Write>(
    reader: R,
    mut writer: W,
    context: ToolContext,
) -> Result<(), String> {
    for line in reader.lines() {
        let line = line.map_err(|error| format!("Failed to read stdin: {error}"))?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle_request(&context, request),
            Err(error) => Some(error_response(
                Value::Null,
                -32700,
                &format!("Parse error: {error}"),
            )),
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
}
