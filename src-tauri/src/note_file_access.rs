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
