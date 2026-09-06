//! Native iOS iCloud Drive access. No network client or custom sync engine.
//! The app owns Forge selection, content I/O, and conflict-copy policy.
#![cfg(target_os = "ios")]

pub mod coordination;

use tauri::{
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_icloud);

pub mod models;
pub use models::*;

pub struct ICloud<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> ICloud<R> {
    pub async fn resolve(&self) -> Result<Container, String> {
        self.0
            .run_mobile_plugin_async("resolve", ())
            .await
            .map_err(|e| e.to_string())
    }

    /// A filesystem `Missing` result does not prove a remote deletion. Merge
    /// with the initial metadata snapshot before allowing note creation.
    pub async fn status(&self, path: &str) -> Result<CloudItem, String> {
        self.0
            .run_mobile_plugin_async("status", serde_json::json!({ "path": path }))
            .await
            .map_err(|e| e.to_string())
    }

    /// Requests a download; callers must wait for actual download readiness.
    pub async fn start_downloading(&self, path: &str) -> Result<CloudItem, String> {
        self.0
            .run_mobile_plugin_async("startDownloading", serde_json::json!({ "path": path }))
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn observe(&self, on_change: Channel<CloudChange>) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async("observe", serde_json::json!({ "onChange": on_change }))
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn stop_observing(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin_async("stopObserving", ())
            .await
            .map_err(|e| e.to_string())
    }
}

pub trait ICloudExt<R: Runtime> {
    fn icloud(&self) -> &ICloud<R>;
}

impl<R: Runtime, T: Manager<R>> ICloudExt<R> for T {
    fn icloud(&self) -> &ICloud<R> {
        self.state::<ICloud<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("icloud")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_icloud)?;
            app.manage(ICloud(handle));
            Ok(())
        })
        .build()
}
