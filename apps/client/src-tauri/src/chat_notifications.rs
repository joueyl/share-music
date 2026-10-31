use serde::Serialize;
use tauri::{AppHandle, UserAttentionType, Window};
use tauri_plugin_notification::{NotificationExt, PermissionState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAlertResult {
    notification_requested: bool,
    attention_requested: bool,
}

fn validate(title: &str, body: &str) -> Result<(), String> {
    if title.trim().is_empty() || title.chars().count() > 200 || body.chars().count() > 1000 {
        return Err("CHAT_NOTIFICATION_INVALID".into());
    }
    Ok(())
}

#[tauri::command]
pub fn send_chat_notification(
    app: AppHandle,
    window: Window,
    title: String,
    body: String,
) -> Result<ChatAlertResult, String> {
    if window.label() != "main" {
        return Err("FORBIDDEN".into());
    }
    validate(&title, &body)?;
    // Native toast only: the bundled custom sound is played separately because
    // desktop notification sound-name semantics differ between operating systems.
    let notification_requested = matches!(
        app.notification().request_permission(),
        Ok(PermissionState::Granted)
    ) && app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .is_ok();
    let attention_requested = window.is_focused().unwrap_or(false)
        || window
            .request_user_attention(Some(UserAttentionType::Informational))
            .is_ok();
    Ok(ChatAlertResult {
        notification_requested,
        attention_requested,
    })
}

#[tauri::command]
pub fn clear_chat_attention(window: Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("FORBIDDEN".into());
    }
    window
        .request_user_attention(None)
        .map_err(|_| "CHAT_ATTENTION_FAILED".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_untrusted_text_without_accepting_file_paths_or_commands() {
        assert!(validate("房间 · 成员", "你好").is_ok());
        assert!(validate(" ", "text").is_err());
        assert!(validate(&"a".repeat(201), "text").is_err());
        assert!(validate("title", &"字".repeat(1001)).is_err());
        assert!(validate("title", &"字".repeat(1000)).is_ok());
    }
}
