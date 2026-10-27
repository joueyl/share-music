pub mod buffer;
pub mod clock;
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
pub mod app_updates;

#[cfg(feature = "desktop")]
mod desktop {
    use super::*;
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::{
        io::Read,
        sync::{
            atomic::{AtomicU64, Ordering},
            Arc, Mutex,
        },
    };
    use tauri::{Emitter, Manager, State};
    struct Session {
        base: String,
        token: String,
        connection: control::Connection,
    }
    pub struct AppState {
        session: Mutex<Option<Session>>,
        auth_generation: Arc<AtomicU64>,
        event_generation: Arc<AtomicU64>,
        native: Option<Arc<native::Native>>,
        native_error: String,
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
    fn media_capabilities(state: State<'_, AppState>) -> Value {
        json!({"native":state.native.is_some(),"capture":false,"reason":state.native_error})
    }
    #[tauri::command]
    async fn login(
        app: tauri::AppHandle,
        state: State<'_, AppState>,
        server_url: String,
        name: String,
        password: String,
        register: bool,
    ) -> Result<Value, String> {
        let generation = state.auth_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let base = control::validate_server_url(&server_url)?;
        let res = state
            .http
            .post(format!("{base}/api/login"))
            .json(&json!({"name":name,"password":password,"register":register}))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = res.status();
        let data: Value = res.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(data["error"].as_str().unwrap_or("LOGIN_FAILED").into());
        }
        let token = data["token"]
            .as_str()
            .ok_or("INVALID_AUTH_RESPONSE")?
            .to_owned();
        let id = data["user"]["id"]
            .as_str()
            .ok_or("INVALID_AUTH_RESPONSE")?
            .to_owned();
        let auth_generation = state.event_generation.clone();
        let emit: control::Emit = Arc::new(move |name, payload| {
            if auth_generation.load(Ordering::SeqCst) == generation {
                let _ = app.emit(name, payload);
            }
        });
        let mut session = state.session.lock().map_err(|_| "STATE_LOCK_FAILED")?;
        if state.auth_generation.load(Ordering::SeqCst) != generation {
            return Err("LOGIN_CANCELLED".into());
        }
        state.event_generation.store(generation, Ordering::SeqCst);
        let connection =
            control::start(base.clone(), token.clone(), id, state.native.clone(), emit);
        *session = Some(Session {
            base,
            token,
            connection,
        });
        Ok(json!({"user":data["user"]}))
    }
    #[tauri::command]
    fn logout(state: State<'_, AppState>) -> Result<(), String> {
        let session = {
            let mut session = state.session.lock().map_err(|_| "STATE_LOCK_FAILED")?;
            state.auth_generation.fetch_add(1, Ordering::SeqCst);
            state.event_generation.store(0, Ordering::SeqCst);
            session.take()
        };
        // Dropping closes the socket, aborts reconnect/STUN tasks and stops the media worker.
        drop(session);
        Ok(())
    }
    async fn request(state: &AppState, path: &str, body: Option<Value>) -> Result<Value, String> {
        let (base, token) = {
            let s = state.session.lock().map_err(|_| "STATE_LOCK_FAILED")?;
            let s = s.as_ref().ok_or("UNAUTHORIZED")?;
            (s.base.clone(), s.token.clone())
        };
        let req = if let Some(body) = body {
            state.http.post(format!("{base}/api{path}")).json(&body)
        } else {
            state.http.get(format!("{base}/api{path}"))
        };
        let response = req
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let status = response.status();
        let value: Value = response.json().await.map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(value["error"].as_str().unwrap_or("REQUEST_FAILED").into());
        }
        Ok(value)
    }
    #[tauri::command]
    async fn list_rooms(state: State<'_, AppState>) -> Result<Value, String> {
        request(&state, "/rooms", None).await
    }
    #[tauri::command]
    async fn create_room(state: State<'_, AppState>, name: String) -> Result<Value, String> {
        request(&state, "/rooms", Some(json!({"name":name}))).await
    }
    #[tauri::command]
    async fn send_control(state: State<'_, AppState>, message: Value) -> Result<(), String> {
        let s = state.session.lock().map_err(|_| "STATE_LOCK_FAILED")?;
        s.as_ref().ok_or("UNAUTHORIZED")?.connection.send(message)
    }
    #[tauri::command]
    async fn join_room(state: State<'_, AppState>, room_id: String) -> Result<(), String> {
        send_control(state, json!({"type":"join","roomId":room_id})).await
    }
    #[tauri::command]
    async fn leave_room(state: State<'_, AppState>) -> Result<(), String> {
        send_control(state, json!({"type":"leave"})).await
    }
    fn media_send(state: &AppState, input: media::Input) -> Result<(), String> {
        let s = state.session.lock().map_err(|_| "STATE_LOCK_FAILED")?;
        s.as_ref()
            .ok_or("UNAUTHORIZED")?
            .connection
            .media
            .send(input)
    }
    #[tauri::command]
    fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
        if !volume.is_finite() || !(0.0..=1.).contains(&volume) {
            return Err("INVALID_VOLUME".into());
        }
        media_send(&state, media::Input::Volume(volume))
    }
    #[tauri::command]
    async fn import_file(state: State<'_, AppState>) -> Result<Value, String> {
        let native = state
            .native
            .clone()
            .ok_or_else(|| state.native_error.clone())?;
        let selection = rfd::AsyncFileDialog::new()
            .add_filter(
                "音乐文件",
                &[
                    "flac", "wav", "aiff", "aif", "mp3", "aac", "m4a", "ogg", "opus",
                ],
            )
            .pick_file()
            .await
            .ok_or("CANCELLED")?;
        let path = selection.path().to_owned();
        let path_for_task = path.clone();
        let metadata = tokio::task::spawn_blocking(move || -> Result<Value, String> {
            let stat = std::fs::metadata(&path_for_task).map_err(|e| e.to_string())?;
            if !stat.is_file() || stat.len() > 10_000_000_000 {
                return Err("FILE_TOO_LARGE".into());
            }
            let (_, mut meta) = native.open_file(&path_for_task)?;
            let mut file = std::fs::File::open(&path_for_task).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut buffer = vec![0u8; 256 * 1024];
            loop {
                let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                hash.update(&buffer[..n]);
            }
            meta["id"] = json!(uuid::Uuid::new_v4().to_string());
            meta["name"] = json!(path_for_task
                .file_name()
                .unwrap_or_default()
                .to_string_lossy());
            meta["sizeBytes"] = json!(stat.len());
            meta["contentHash"] = json!(format!("{:x}", hash.finalize()));
            Ok(meta)
        })
        .await
        .map_err(|e| e.to_string())??;
        media_send(
            &state,
            media::Input::Imported(metadata["id"].as_str().unwrap().into(), path),
        )?;
        Ok(metadata)
    }
    pub fn run() {
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("HTTP client");
        tauri::Builder::default()
            .setup(move |app| {
                app.manage(app_updates::UpdateState::default());
                if app_updates::configured(app.handle()) {
                    app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                }
                let path = native::Native::locate().or_else(|error| {
                    let packaged = app
                        .path()
                        .resource_dir()
                        .map_err(|_| error.clone())?
                        .join("media")
                        .join(native::Native::filename());
                    if packaged.is_file() {
                        Ok(packaged)
                    } else {
                        Err(error)
                    }
                });
                let (native, native_error) = match path.and_then(|path| native::Native::load(&path))
                {
                    Ok(native) => (Some(native), String::new()),
                    Err(error) => (None, error),
                };
                app.manage(AppState {
                    music_cache: music_cache::MusicCache::new(
                        app.path().app_cache_dir()?.join("music"),
                    ),
                    session: Mutex::new(None),
                    auth_generation: Arc::new(AtomicU64::new(0)),
                    event_generation: Arc::new(AtomicU64::new(0)),
                    native,
                    native_error,
                    http,
                });
                system_media::initialize(app.handle().clone());
                Ok(())
            })
            .invoke_handler(tauri::generate_handler![
                app_updates::updater_status,
                app_updates::check_app_update,
                app_updates::install_app_update,
                app_updates::restart_after_update,
                media_capabilities,
                update_system_media,
                load_playback_audio,
                read_cached_audio,
                can_remember_login,
                load_saved_login,
                save_login,
                clear_saved_login,
                login,
                logout,
                list_rooms,
                create_room,
                send_control,
                join_room,
                leave_room,
                import_file,
                set_volume
            ])
            .build(tauri::generate_context!())
            .expect("Build Tauri application")
            .run(|handle, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    system_media::shutdown();
                    if let Ok(mut session) = handle.state::<AppState>().session.lock() {
                        session.take();
                    }
                }
            });
    }
}
#[cfg(feature = "desktop")]
pub use desktop::run;
