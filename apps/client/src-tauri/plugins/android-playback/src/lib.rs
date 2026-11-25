use serde_json::Value;
use tauri::{
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
    Manager, Runtime, State,
};
mod room_socket;

struct AndroidPlayback<R: Runtime>(PluginHandle<R>, Channel<Value>);

#[tauri::command]
async fn operate<R: Runtime>(
    _app: tauri::AppHandle<R>,
    state: State<'_, AndroidPlayback<R>>,
    operation: Value,
) -> Result<Value, String> {
    if !matches!(
        operation["action"].as_str(),
        Some("state" | "volume" | "startup-logging")
    ) {
        return Err("ANDROID_PLAYBACK_INVALID_COMMAND".into());
    }
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
            let socket = room_socket::RoomSocket::default();
            let callback_socket = socket.clone();
            let controls = Channel::new(move |data| {
                if let Ok(event) = data.deserialize::<Value>() {
                    callback_socket.media_control(event);
                }
                Ok(())
            });
            let (updates, mut playback) = tokio::sync::watch::channel(Value::Null);
            let driver = handle.clone();
            let callback = serde_json::to_value(&controls)?;
            tauri::async_runtime::spawn(async move {
                while playback.changed().await.is_ok() {
                    let mut update = playback.borrow_and_update().clone();
                    update["action"] = Value::String("room-driver".into());
                    update["controls"] = callback.clone();
                    let _: Result<Value, _> =
                        driver.run_mobile_plugin_async("operate", update).await;
                }
            });
            socket.set_playback(updates);
            let (scope, mut chat_scope) = tokio::sync::watch::channel(Value::Null);
            let (chat, mut messages) = tokio::sync::mpsc::channel::<Value>(16);
            socket.set_chat(scope, chat);
            let notifier = handle.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    let update = tokio::select! {
                        biased;
                        change = chat_scope.changed() => {
                            if change.is_err() { break; }
                            chat_scope.borrow_and_update().clone()
                        }
                        message = messages.recv() => {
                            let Some(message) = message else { break };
                            let current = chat_scope.borrow();
                            if ["socketId", "roomId", "userId"].iter().any(|key| current[*key] != message[*key]) {
                                continue;
                            }
                            message
                        }
                    };
                    let _: Result<Value, _> =
                        notifier.run_mobile_plugin_async("operate", update).await;
                }
            });
            app.manage(AndroidPlayback(handle, controls));
            app.manage(socket);
            Ok(())
        })
        .build()
}
