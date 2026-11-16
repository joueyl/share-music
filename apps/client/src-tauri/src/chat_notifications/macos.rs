//! Modern notification-center delivery; never trust the desktop plugin's stub permission.
use super::ChatAlertResult;
use mac_usernotifications::{AuthorizationStatus, Notification, NotificationSettingStatus};
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, Window};

#[derive(Default)]
pub struct MacChatNotifications {
    gate: tokio::sync::Mutex<()>,
    session: Mutex<Session>,
}
#[derive(Default)]
struct Session {
    generation: u64,
    unread: i64,
    observer: Option<tauri::async_runtime::JoinHandle<()>>,
}
fn id(generation: u64) -> String {
    format!("tone-chat-{generation}")
}
fn current(app: &AppHandle, generation: u64) -> bool {
    app.state::<MacChatNotifications>()
        .session
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .generation
        == generation
}
pub fn focused(window: &Window) {
    window
        .state::<MacChatNotifications>()
        .session
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .unread = 0;
    let _ = window.set_badge_count(None);
}
pub fn clear(window: &Window) {
    let state = window.state::<MacChatNotifications>();
    let old = {
        let mut session = state.session.lock().unwrap_or_else(|e| e.into_inner());
        let old = session.generation;
        session.generation = session.generation.wrapping_add(1);
        session.unread = 0;
        if let Some(task) = session.observer.take() {
            task.abort();
        }
        old
    };
    let _ = window.set_badge_count(None);
    tauri::async_runtime::spawn(async move {
        mac_usernotifications::close_delivered(&id(old)).await;
    });
}
pub async fn notify(
    app: &AppHandle,
    window: &Window,
    title: String,
    body: String,
) -> Result<ChatAlertResult, String> {
    let state = app.state::<MacChatNotifications>();
    // Permission prompts do not create an unbounded request queue during a chat burst.
    let focused = window.is_focused().unwrap_or(false);
    let attention_requested = focused
        || window
            .request_user_attention(Some(tauri::UserAttentionType::Informational))
            .is_ok();
    let Ok(_guard) = state.gate.try_lock() else {
        return Ok(ChatAlertResult {
            notification_requested: false,
            attention_requested,
        });
    };
    let (generation, old) = {
        let mut session = state.session.lock().unwrap_or_else(|e| e.into_inner());
        (session.generation, session.observer.take())
    };
    // Drop the old response receiver before registering a replacement with the same ID.
    if let Some(old) = old {
        old.abort();
        let _ = old.await;
    }
    let delivery = tokio::time::timeout(Duration::from_secs(60), async {
        mac_usernotifications::check_bundle().map_err(|_| ())?;
        let settings = mac_usernotifications::get_notification_settings()
            .await
            .map_err(|_| ())?;
        if settings.authorization_status == AuthorizationStatus::NotDetermined
            && !mac_usernotifications::request_auth()
                .await
                .map_err(|_| ())?
        {
            return Err(());
        }
        let settings = mac_usernotifications::get_notification_settings()
            .await
            .map_err(|_| ())?;
        if !matches!(
            settings.authorization_status,
            AuthorizationStatus::Authorized | AuthorizationStatus::Provisional
        ) || settings.alert_enabled != NotificationSettingStatus::Enabled
            || !current(app, generation)
        {
            return Err(());
        }
        if !window.is_focused().unwrap_or(false)
            && settings.badge_enabled == NotificationSettingStatus::Enabled
        {
            let count = {
                let mut session = state.session.lock().unwrap_or_else(|e| e.into_inner());
                session.unread = session.unread.saturating_add(1).min(99);
                session.unread
            };
            let _ = window.set_badge_count(Some(count));
        }
        Notification::new()
            .id(&id(generation))
            .thread_id("tone-chat")
            .title(title)
            .message(body)
            // No system sound: the existing bundled sound already plays independently.
            .timeout(Duration::from_secs(60))
            .send()
            .await
            .map_err(|_| ())
    })
    .await;
    let Ok(Ok(handle)) = delivery else {
        return Ok(ChatAlertResult {
            notification_requested: false,
            attention_requested,
        });
    };
    if !current(app, generation) {
        mac_usernotifications::close_delivered(&id(generation)).await;
        return Ok(ChatAlertResult {
            notification_requested: false,
            attention_requested,
        });
    }
    let callback_app = app.clone();
    let observer = tauri::async_runtime::spawn(async move {
        if let Ok(response) = handle.response().await {
            if response.is_default_action() && current(&callback_app, generation) {
                let _ = callback_app.emit("chat-notification-clicked", ());
                crate::close_to_tray::show_main(&callback_app);
            }
        }
    });
    let mut session = state.session.lock().unwrap_or_else(|e| e.into_inner());
    if session.generation == generation {
        session.observer = Some(observer);
    } else {
        observer.abort();
    }
    Ok(ChatAlertResult {
        notification_requested: true,
        attention_requested,
    })
}
