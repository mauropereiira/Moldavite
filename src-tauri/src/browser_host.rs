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

use serde_json::{json, Value};

/// Chrome caps host → extension messages at 1 MB; inbound is our own bound.
pub(crate) const MAX_INBOUND: usize = 8 * 1024 * 1024;
pub(crate) const MAX_OUTBOUND: usize = 1024 * 1024;

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

fn handle(request: &Value) -> Value {
    match request.get("op").and_then(Value::as_str) {
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
    fn malformed_json_is_an_error_response_not_a_crash() {
        let out = responses(framed("{not json"));

        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["ok"], Value::Bool(false));
    }
}
