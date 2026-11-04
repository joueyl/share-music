use super::{Playback, Snapshot};
use std::{
    cell::RefCell,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};
#[cfg(target_os = "windows")]
#[path = "taskbar.rs"]
mod taskbar;

thread_local! { static RUNTIME:RefCell<Option<Runtime>>=const { RefCell::new(None) }; }
struct Runtime {
    snapshot: Arc<Mutex<Snapshot>>,
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    controls: Option<souvlaki::MediaControls>,
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    metadata: Option<(Option<String>, String, u64)>,
    #[cfg(target_os = "windows")]
    taskbar: Option<taskbar::Taskbar>,
}
pub fn initialize(app: tauri::AppHandle) {
    let snapshot = Arc::new(Mutex::new(Snapshot::default()));
    #[cfg(target_os = "windows")]
    let hwnd = app
        .get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0);
    #[cfg(target_os = "linux")]
    let hwnd = None;
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let controls = {
        let name = format!("com.musicshare.desktop.instance_{}", std::process::id());
        let config = souvlaki::PlatformConfig {
            display_name: "共鸣 Music Share",
            dbus_name: &name,
            hwnd,
        };
        souvlaki::MediaControls::new(config)
            .and_then(|mut controls| {
                let app = app.clone();
                let state = snapshot.clone();
                controls.attach(move |event| handle_event(&app, &state, event))?;
                Ok(controls)
            })
            .map_err(|_| {
                eprintln!(
                    "System media controls are unavailable; in-app playback remains available."
                )
            })
            .ok()
    };
    #[cfg(target_os = "windows")]
    let taskbar = hwnd.and_then(|hwnd| {
        taskbar::Taskbar::new(hwnd, app.clone(), snapshot.clone())
            .map_err(|_| eprintln!("Taskbar thumbnail controls are unavailable."))
            .ok()
    });
    RUNTIME.with(|slot| {
        *slot.borrow_mut() = Some(Runtime {
            snapshot: snapshot.clone(),
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            controls,
            #[cfg(any(target_os = "windows", target_os = "linux"))]
            metadata: None,
            #[cfg(target_os = "windows")]
            taskbar,
        })
    });
    #[cfg(target_os = "windows")]
    schedule_taskbar_startup_recovery(app, Arc::downgrade(&snapshot));
    update(Snapshot {
        title: "共鸣 Music Share".into(),
        ..Default::default()
    });
}
pub fn update(snapshot: Snapshot) {
    RUNTIME.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        if let Some(runtime) = slot.as_mut() {
            runtime.update(snapshot);
        }
    });
}
pub fn update_artwork(artwork: super::artwork::ArtworkFrame) {
    #[cfg(target_os = "windows")]
    RUNTIME.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        if let Some(runtime) = slot.as_mut() {
            let matches = runtime
                .snapshot
                .lock()
                .is_ok_and(|state| artwork.matches(&state));
            if matches {
                if let Some(taskbar) = runtime.taskbar.as_mut() {
                    taskbar.set_artwork(artwork);
                }
            }
        }
    });
    #[cfg(not(target_os = "windows"))]
    let _ = artwork;
}
pub fn shutdown() {
    RUNTIME.with(|slot| {
        slot.borrow_mut().take();
    });
}
// Bounded recovery is independent of frontend progress updates: even an idle first launch
// may race Explorer/COM or miss TaskbarButtonCreated while installing the window hooks.
#[cfg(target_os = "windows")]
fn schedule_taskbar_startup_recovery(
    app: tauri::AppHandle,
    expected: std::sync::Weak<Mutex<Snapshot>>,
) {
    tauri::async_runtime::spawn(async move {
        for delay in [250, 500, 1000, 2000, 4000] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            if expected.strong_count() == 0 {
                break;
            }
            let expected = expected.clone();
            let handle = app.clone();
            if app
                .run_on_main_thread(move || retry_taskbar_startup(&handle, &expected))
                .is_err()
            {
                break;
            }
        }
    });
}
#[cfg(target_os = "windows")]
fn retry_taskbar_startup(app: &tauri::AppHandle, expected: &std::sync::Weak<Mutex<Snapshot>>) {
    RUNTIME.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        let Some(runtime) = slot.as_mut() else {
            return;
        };
        // Delayed callbacks from a replaced/shutdown session must not create a new toolbar.
        if !expected
            .upgrade()
            .is_some_and(|state| Arc::ptr_eq(&state, &runtime.snapshot))
        {
            return;
        }
        if runtime.taskbar.is_none() {
            runtime.taskbar = app
                .get_webview_window("main")
                .and_then(|window| window.hwnd().ok())
                .and_then(|hwnd| {
                    taskbar::Taskbar::new(hwnd.0, app.clone(), runtime.snapshot.clone()).ok()
                });
        }
        let state = runtime.snapshot.lock().ok().map(|state| state.clone());
        if let (Some(taskbar), Some(state)) = (runtime.taskbar.as_mut(), state) {
            taskbar.retry_startup(&state);
        }
    });
}
#[cfg(target_os = "windows")]
fn sync_taskbar() {
    RUNTIME.with(|slot| {
        let Ok(mut slot) = slot.try_borrow_mut() else {
            return;
        };
        if let Some(runtime) = slot.as_mut() {
            let state = runtime.snapshot.lock().ok().map(|state| state.clone());
            if let (Some(taskbar), Some(state)) = (runtime.taskbar.as_mut(), state) {
                taskbar.update(&state);
            }
        }
    });
}
impl Runtime {
    fn update(&mut self, snapshot: Snapshot) {
        if let Ok(mut state) = self.snapshot.lock() {
            *state = snapshot.clone();
        }
        #[cfg(target_os = "windows")]
        if let Some(taskbar) = self.taskbar.as_mut() {
            taskbar.update(&snapshot);
        }
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        if let Some(controls) = self.controls.as_mut() {
            let key = (
                snapshot.track_id.clone(),
                snapshot.title.clone(),
                snapshot.duration_ms,
            );
            if self.metadata.as_ref() != Some(&key) {
                if controls
                    .set_metadata(souvlaki::MediaMetadata {
                        title: Some(&snapshot.title),
                        artist: Some("共鸣 Music Share"),
                        album: Some(""),
                        cover_url: None,
                        duration: Some(Duration::from_millis(snapshot.duration_ms)),
                    })
                    .is_ok()
                {
                    self.metadata = Some(key);
                }
            }
            let progress = Some(souvlaki::MediaPosition(Duration::from_millis(
                snapshot.position_ms,
            )));
            let status = match snapshot.playback {
                Playback::Playing => souvlaki::MediaPlayback::Playing { progress },
                Playback::Paused => souvlaki::MediaPlayback::Paused { progress },
                Playback::Stopped => souvlaki::MediaPlayback::Stopped,
            };
            let _ = controls.set_playback(status);
        }
    }
}
pub(super) fn emit_control(
    app: &tauri::AppHandle,
    snapshot: &Arc<Mutex<Snapshot>>,
    action: &str,
    position: Option<u64>,
) {
    if let Ok(state) = snapshot.lock() {
        if let Some(event) = state.event(action, position) {
            let _ = app.emit("system-media-control", event);
        }
    }
}
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn handle_event(
    app: &tauri::AppHandle,
    snapshot: &Arc<Mutex<Snapshot>>,
    event: souvlaki::MediaControlEvent,
) {
    use souvlaki::{MediaControlEvent as Event, SeekDirection};
    let action = match event {
        Event::Play => "play",
        Event::Pause => "pause",
        Event::Toggle => "toggle",
        Event::Next => "next",
        Event::Previous => "previous",
        Event::Stop => "stop",
        Event::Seek(direction) | Event::SeekBy(direction, _) => {
            let distance = match event {
                Event::SeekBy(_, duration) => duration.as_millis().min(u64::MAX as u128) as u64,
                _ => 10_000,
            };
            let position = if let Ok(state) = snapshot.lock() {
                match direction {
                    SeekDirection::Forward => state.position_ms.saturating_add(distance),
                    SeekDirection::Backward => state.position_ms.saturating_sub(distance),
                }
            } else {
                return;
            };
            emit_control(app, snapshot, "seek", Some(position));
            return;
        }
        Event::SetPosition(position) => {
            emit_control(
                app,
                snapshot,
                "seek",
                Some(position.0.as_millis().min(u64::MAX as u128) as u64),
            );
            return;
        }
        Event::Raise => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            return;
        }
        _ => return,
    };
    emit_control(app, snapshot, action, None);
}
