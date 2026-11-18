use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime, State};
use serde_json::{json, Value};

struct SecureLogin<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn can_remember_login<R: Runtime>(_app: tauri::AppHandle<R>, state: State<'_, SecureLogin<R>>) -> Result<bool, String> {
    state.inner().0.run_mobile_plugin_async("available", ()).await.map_err(|_| "SAVED_LOGIN_UNAVAILABLE".into())
}
#[tauri::command]
async fn load_saved_login<R: Runtime>(_app: tauri::AppHandle<R>, state: State<'_, SecureLogin<R>>) -> Result<Value, String> {
    state.inner().0.run_mobile_plugin_async("load", ()).await.map_err(|_| "SAVED_LOGIN_READ_FAILED".into())
}
#[tauri::command]
async fn save_login<R: Runtime>(_app: tauri::AppHandle<R>, state: State<'_, SecureLogin<R>>, credentials: Value) -> Result<(), String> {
    state.inner().0.run_mobile_plugin_async("save", json!({"credentials": credentials})).await.map_err(|_| "SAVED_LOGIN_WRITE_FAILED".into())
}
#[tauri::command]
async fn clear_saved_login<R: Runtime>(_app: tauri::AppHandle<R>, state: State<'_, SecureLogin<R>>) -> Result<(), String> {
    state.inner().0.run_mobile_plugin_async("clear", ()).await.map_err(|_| "SAVED_LOGIN_DELETE_FAILED".into())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("saved-login")
        .invoke_handler(tauri::generate_handler![can_remember_login, load_saved_login, save_login, clear_saved_login])
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.musicshare.savedlogin", "SavedLoginPlugin")?;
            app.manage(SecureLogin(handle));
            Ok(())
        })
        .build()
}
