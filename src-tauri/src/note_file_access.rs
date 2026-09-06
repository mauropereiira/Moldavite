//! Keep Apple's download checks and coordination around complete note operations.
//! Local files and non-Apple platforms retain the existing direct file path.
use std::path::Path;

#[cfg(target_os = "macos")]
use crate::file_coordination as native;
#[cfg(target_os = "ios")]
use tauri_plugin_icloud::coordination as native;

pub(crate) fn read<T: Send>(
    path: &Path,
    operation: impl FnOnce(&Path) -> Result<T, String> + Send,
) -> Result<T, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return native::read_cloud(path, operation);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    operation(path)
}

pub(crate) fn write<T: Send>(
    path: &Path,
    operation: impl FnOnce(&Path) -> Result<T, String> + Send,
) -> Result<T, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    return native::write_cloud(path, operation);
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    operation(path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Access<'a> {
    path: &'a Path,
    mode: &'static str,
    move_to: Option<usize>,
}

impl<'a> Access<'a> {
    pub(crate) fn read(path: &'a Path) -> Self {
        Self {
            path,
            mode: "read",
            move_to: None,
        }
    }
    pub(crate) fn write(path: &'a Path) -> Self {
        Self {
            path,
            mode: "write",
            move_to: None,
        }
    }
    pub(crate) fn moving(path: &'a Path, destination: usize) -> Self {
        Self {
            path,
            mode: "move",
            move_to: Some(destination),
        }
    }
    pub(crate) fn deleting(path: &'a Path) -> Self {
        Self {
            path,
            mode: "delete",
            move_to: None,
        }
    }
}

/// Reserve all involved files before checking existence, hashes or destinations.
/// A presenter moving a path mid-request requires a fresh command so its note
/// ID, encryption identity and frontend references remain consistent.
pub(crate) fn transaction<T: Send>(
    requests: &[Access<'_>],
    operation: impl FnOnce() -> Result<T, String> + Send,
) -> Result<T, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let json = serde_json::to_string(requests).map_err(|error| error.to_string())?;
        native::transaction(&json, false, |paths| {
            if paths.len() != requests.len()
                || paths
                    .iter()
                    .zip(requests)
                    .any(|(path, request)| path != request.path)
            {
                return Err(
                    "A file moved during this operation. Refresh the Forge and try again.".into(),
                );
            }
            operation()
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = requests;
        operation()
    }
}
