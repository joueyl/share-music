#[cfg(feature = "desktop")]
pub mod app_updates;
pub mod buffer;
pub mod clock;
pub mod close_to_tray;
pub mod control;
pub mod media;
pub mod model;
pub mod music_cache;
pub mod native;
pub mod packet;
pub mod playback_audio;
pub mod saved_login;
pub mod stun;
pub mod system_media;

#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
    use serde_json::{json, Value};
    use tauri::{Emitter, Manager, State};

    pub struct AppState {
        http: reqwest::Client,
        music_cache: music_cache::MusicCache,
    }
    #[tauri::command]
    fn update_system_media(
        app: tauri::AppHandle,
        mut snapshot: system_media::Snapshot,
    ) -> Result<(), String> {
        snapshot.validate()?;
        app.run_on_main_thread(move || system_media::update(snapshot))
            .map_err(|_| "SYSTEM_MEDIA_UNAVAILABLE".into())
    }
    #[tauri::command]
    async fn load_system_artwork(
        state: State<'_, AppState>,
        url: String,
    ) -> Result<tauri::ipc::Response, String> {
        Ok(tauri::ipc::Response::new(
            system_media::artwork::download(&state.http, &url).await?,
        ))
    }
    #[tauri::command]
    fn update_taskbar_artwork(
        app: tauri::AppHandle,
        artwork: system_media::artwork::ArtworkFrame,
    ) -> Result<(), String> {
        artwork.validate()?;
        app.run_on_main_thread(move || system_media::update_artwork(artwork))
            .map_err(|_| "SYSTEM_MEDIA_UNAVAILABLE".into())
    }
    #[tauri::command]
    async fn load_playback_audio(
        app: tauri::AppHandle,
        state: State<'_, AppState>,
        url: String,
        content_hash: String,
        size_bytes: u64,
    ) -> Result<tauri::ipc::Response, String> {
        let audio = state
            .music_cache
            .load(&state.http, &url, &content_hash, size_bytes)
            .await?;
        if !audio.stored {
            let _ = app.emit(
                "playback-cache-warning",
                json!({"error":"PLAYBACK_AUDIO_CACHE_WRITE_FAILED"}),
            );
        }
        Ok(tauri::ipc::Response::new(audio.bytes))
    }
    #[tauri::command]
    async fn read_cached_audio(
        state: State<'_, AppState>,
        content_hash: String,
        size_bytes: u64,
    ) -> Result<tauri::ipc::Response, String> {
        Ok(tauri::ipc::Response::new(
            state
                .music_cache
                .read(&content_hash, size_bytes)
                .await?
                .unwrap_or_default(),
        ))
    }
    #[tauri::command]
    fn can_remember_login() -> bool {
        cfg!(windows)
    }
    #[tauri::command]
    fn load_saved_login() -> Result<Option<saved_login::SavedLogin>, String> {
        saved_login::load()
    }
    #[tauri::command]
    fn save_login(credentials: saved_login::SavedLogin) -> Result<(), String> {
        saved_login::save(&credentials)
    }
    #[tauri::command]
    fn clear_saved_login() -> Result<(), String> {
        saved_login::clear()
    }
    #[tauri::command]
    fn media_capabilities() -> Value {
        json!({"native":false,"capture":false,"reason":"HTML Audio · Windows WebView2 · WebSocket 同步"})
    }
    // Authentication and control sockets belong exclusively to the WebView now.
    #[tauri::command]
    fn logout() {}

    #[tauri::command]
    fn window_minimize(window: tauri::Window) {
        let _ = window.minimize();
    }
    #[tauri::command]
    fn window_toggle_maximize(window: tauri::Window) {
        if let Ok(maximized) = window.is_maximized() {
            if maximized {
                let _ = window.unmaximize();
            } else {
                let _ = window.maximize();
            }
        }
    }
    #[tauri::command]
    fn window_close(window: tauri::Window) {
        let _ = window.close();
    }
    #[tauri::command]
    fn start_dragging(window: tauri::Window) {
        let _ = window.start_dragging();
    }

    pub fn run() {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("HTTP client");
        tauri::Builder::default()
            .setup(move |app| {
                app.manage(close_to_tray::CloseToTray::default());
                if close_to_tray::install(app.handle()).is_err() {
                    eprintln!("托盘初始化失败，保留正常窗口关闭行为。");
                }
                app.manage(app_updates::UpdateState::default());
                if app_updates::configured(app.handle()) {
                    app.handle()
                        .plugin(tauri_plugin_updater::Builder::new().build())?;
                }
                app.manage(AppState {
                    http,
                    music_cache: music_cache::MusicCache::new(
                        app.path().app_cache_dir()?.join("music"),
                    ),
                });
                system_media::initialize(app.handle().clone());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_shadow(false);
                    if let Some(icon) = app.default_window_icon() {
                        let _ = window.set_icon(icon.clone());
                    }
                }
                Ok(())
            })
            .on_window_event(close_to_tray::on_window_event)
            .invoke_handler(tauri::generate_handler![
                app_updates::updater_status,
                app_updates::check_app_update,
                app_updates::install_app_update,
                app_updates::restart_after_update,
                media_capabilities,
                update_system_media,
                load_system_artwork,
                update_taskbar_artwork,
                load_playback_audio,
                read_cached_audio,
                can_remember_login,
                load_saved_login,
                save_login,
                clear_saved_login,
                logout,
                window_minimize,
                window_toggle_maximize,
                window_close,
                start_dragging
            ])
            .build(tauri::generate_context!())
            .expect("Build Tauri application")
            .run(|_handle, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    system_media::shutdown();
                }
                #[cfg(target_os = "macos")]
                if matches!(event, tauri::RunEvent::Reopen { .. }) {
                    close_to_tray::show_main(_handle);
                }
            });
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
