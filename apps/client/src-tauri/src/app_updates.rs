use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{ipc::Channel, AppHandle, State};
#[cfg(target_os = "linux")]
use tauri::Manager;
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: &str = "https://github.com/joueyl/share-music/releases/latest/download/latest.json";
#[derive(Default)]
pub struct UpdateState {
    pending: Mutex<Option<Update>>,
    busy: AtomicBool,
    installed: AtomicBool,
}
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl UpdateState {
    fn begin(&self) -> Result<Busy<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "UPDATER_BUSY".to_string())?;
        Ok(Busy(&self.busy))
    }
}
pub fn configured(app: &AppHandle) -> bool {
    let config = app.config().plugins.0.get("updater");
    let key = config
        .and_then(|v| v.get("pubkey"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let endpoint = config
        .and_then(|v| v.get("endpoints"))
        .and_then(Value::as_array);
    !key.trim().is_empty()
        && endpoint.is_some_and(|urls| urls.len() == 1 && urls[0].as_str() == Some(ENDPOINT))
}
fn supported(app: &AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    {
        app.env().appimage.is_some()
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        true
    }
}
#[tauri::command]
pub fn updater_status(app: AppHandle) -> Value {
    json!({"configured":configured(&app),"supported":supported(&app),"endpoint":ENDPOINT})
}
#[tauri::command]
pub async fn check_app_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<Value>, String> {
    if !configured(&app) {
        return Err("UPDATER_NOT_CONFIGURED".into());
    }
    if !supported(&app) {
        return Err("UPDATER_FORMAT_UNSUPPORTED".into());
    }
    let _busy = state.begin()?;
    state
        .pending
        .lock()
        .map_err(|_| "UPDATER_STATE_FAILED")?
        .take();
    let updater = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|_| "UPDATER_CHECK_FAILED")?;
    let update = tokio::time::timeout(std::time::Duration::from_secs(20), updater.check())
        .await
        .map_err(|_| "UPDATER_CHECK_FAILED")?
        .map_err(|_| "UPDATER_CHECK_FAILED")?;
    // Do not allow a remote manifest to direct downloads outside the configured repository.
    if let Some(update) = update.as_ref() {
        if update.download_url.scheme() != "https"
            || update.download_url.host_str() != Some("github.com")
            || !update.download_url.username().is_empty()
            || update.download_url.password().is_some()
            || update.download_url.port().is_some()
            || !update
                .download_url
                .path()
                .starts_with("/joueyl/share-music/releases/download/")
        {
            return Err("UPDATER_SOURCE_INVALID".into());
        }
    }
    let metadata = update
        .as_ref()
        .map(|u| json!({"version":u.version,"currentVersion":u.current_version,"body":u.body}));
    *state.pending.lock().map_err(|_| "UPDATER_STATE_FAILED")? = update;
    Ok(metadata)
}
#[tauri::command]
pub async fn install_app_update(
    state: State<'_, UpdateState>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let _busy = state.begin()?;
    let update = state
        .pending
        .lock()
        .map_err(|_| "UPDATER_STATE_FAILED")?
        .take()
        .ok_or("UPDATER_NO_PENDING_UPDATE")?;
    let _ = on_event.send(json!({"event":"Started"}));
    update
        .download_and_install(
            |chunk, total| {
                let _ = on_event
                    .send(json!({"event":"Progress","chunkLength":chunk,"contentLength":total}));
            },
            || {
                let _ = on_event.send(json!({"event":"Finished"}));
            },
        )
        .await
        .map_err(|_| "UPDATER_INSTALL_FAILED")?;
    state.installed.store(true, Ordering::SeqCst);
    Ok(())
}
#[tauri::command]
pub fn restart_after_update(app: AppHandle, state: State<'_, UpdateState>) -> Result<(), String> {
    if !state.installed.load(Ordering::SeqCst) {
        return Err("UPDATER_NO_INSTALLED_UPDATE".into());
    }
    app.restart()
}
