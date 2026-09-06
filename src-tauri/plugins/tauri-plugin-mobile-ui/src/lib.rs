//! Native appearance and Dynamic Type for the iOS webview.
#![cfg(target_os = "ios")]

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_mobile_ui);

struct MobileUi<R: Runtime>(PluginHandle<R>);

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Appearance {
    Light,
    Dark,
    System,
}

#[tauri::command]
async fn set_appearance<R: Runtime>(app: AppHandle<R>, mode: Appearance) -> Result<(), String> {
    app.state::<MobileUi<R>>()
        .0
        .run_mobile_plugin_async("setAppearance", serde_json::json!({ "mode": mode }))
        .await
        .map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-ui")
        .invoke_handler(tauri::generate_handler![set_appearance])
        .setup(|app, api| {
            app.manage(MobileUi(api.register_ios_plugin(init_plugin_mobile_ui)?));
            Ok(())
        })
        .build()
}
