//! iOS side of the calendar sources. Its Swift package links the `src-swift`
//! EventKit bridge, so `calendar::apple` calls the same C symbols as on macOS,
//! and it runs Google's consent page in an `ASWebAuthenticationSession`, since
//! a phone app cannot listen on the desktop flow's loopback port.
#![cfg(target_os = "ios")]

use serde::Deserialize;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime,
};

tauri::ios_plugin_binding!(init_plugin_calendar);

#[derive(Deserialize)]
struct AuthenticateResult {
    url: Option<String>,
}

pub struct Calendar<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> Calendar<R> {
    /// `None` means the user closed the sheet. The caller must still check the
    /// returned URL's `state`.
    pub async fn authenticate(
        &self,
        url: &str,
        callback_scheme: &str,
    ) -> Result<Option<String>, String> {
        let result: AuthenticateResult = self
            .0
            .run_mobile_plugin_async(
                "authenticate",
                serde_json::json!({ "url": url, "callbackScheme": callback_scheme }),
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(result.url)
    }
}

pub trait CalendarExt<R: Runtime> {
    fn calendar(&self) -> &Calendar<R>;
}

impl<R: Runtime, T: Manager<R>> CalendarExt<R> for T {
    fn calendar(&self) -> &Calendar<R> {
        self.state::<Calendar<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("calendar")
        .setup(|app, api| {
            let handle = api.register_ios_plugin(init_plugin_calendar)?;
            app.manage(Calendar(handle));
            Ok(())
        })
        .build()
}
