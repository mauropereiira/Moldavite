use crate::activity_log::{self, ActivityCounts, ActivityPage};
use crate::paths::get_notes_dir;

/// One page of the active Forge's note history, newest first: rows before
/// `beforeAtMs`/`beforeId` (a day's end and 0 for its first page) and at or
/// after `sinceMs`.
#[tauri::command]
pub(crate) fn list_note_activity(
    before_at_ms: Option<i64>,
    before_id: Option<i64>,
    since_ms: Option<i64>,
    limit: Option<u32>,
) -> Result<ActivityPage, String> {
    let root = get_notes_dir()?;
    let before = before_at_ms.zip(before_id);
    Ok(activity_log::page(
        &root,
        before,
        since_ms,
        limit.unwrap_or(20),
    ))
}

/// Rows per span between consecutive `bounds`: the frontend passes local day
/// starts, which only it knows.
#[tauri::command]
pub(crate) fn count_note_activity(bounds: Vec<i64>) -> Result<ActivityCounts, String> {
    if bounds.len() > 400 || bounds.windows(2).any(|span| span[0] > span[1]) {
        return Err("Invalid day bounds".to_string());
    }
    Ok(activity_log::counts(&get_notes_dir()?, &bounds))
}
