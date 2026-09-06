//! Export an already-complete file through the iOS document picker.
#![cfg(target_os = "ios")]

use serde::Deserialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_document_export);

#[derive(Deserialize)]
struct ExportResult {
    exported: bool,
}

pub struct DocumentExport<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> DocumentExport<R> {
    /// Keep the source alive until this returns. False means the user cancelled.
    pub async fn export(&self, path: &std::path::Path) -> Result<bool, String> {
        let result: ExportResult = self
            .0
            .run_mobile_plugin_async("exportFile", serde_json::json!({ "path": path }))
            .await
            .map_err(|e| e.to_string())?;
        Ok(result.exported)
    }
}

pub trait DocumentExportExt<R: Runtime> {
    fn document_export(&self) -> &DocumentExport<R>;
}

impl<R: Runtime, T: Manager<R>> DocumentExportExt<R> for T {
    fn document_export(&self) -> &DocumentExport<R> {
        self.state::<DocumentExport<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("document-export")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_document_export)?;
            app.manage(DocumentExport(handle));
            Ok(())
        })
        .build()
}
