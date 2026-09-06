use serde::{Deserialize, Serialize};

#[cfg(target_os = "ios")]
#[derive(Debug, Deserialize)]
pub struct Container {
    pub path: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DownloadState {
    Local,
    Current,
    Downloaded,
    Pending,
    Unknown,
    Missing,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudItem {
    pub path: String,
    pub is_directory: bool,
    pub download_state: DownloadState,
    pub is_downloading: bool,
    pub is_uploading: bool,
    pub has_conflicts: bool,
    pub error: Option<String>,
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Initial,
    Changed,
    AccountChanged,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CloudChange {
    pub kind: ChangeKind,
    pub items: Vec<CloudItem>,
    pub removed: Vec<String>,
}
