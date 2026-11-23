use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime, State,
};
mod room_socket;

struct AndroidPlayback<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn operate<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AndroidPlayback<R>>,
    operation: Value,
) -> Result<Value, String> {
    state
        .inner()
        .0
        .run_mobile_plugin_async("operate", operation)
        .await
        .map_err(|_| "ANDROID_PLAYBACK_UNAVAILABLE".into())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-playback")
        .invoke_handler(tauri::generate_handler![
            operate,
            room_socket::room_connect,
            room_socket::room_receive,
            room_socket::room_send,
            room_socket::room_close
        ])
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.musicshare.playback", "AndroidPlaybackPlugin")?;
            app.manage(AndroidPlayback(handle));
            app.manage(room_socket::RoomSocket::default());
            Ok(())
        })
        .build()
}
