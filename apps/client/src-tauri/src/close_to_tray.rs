use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct CloseToTray {
    ready: AtomicBool,
    exiting: AtomicBool,
}

impl CloseToTray {
    pub fn enable(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }

    pub fn quit(&self) {
        self.exiting.store(true, Ordering::SeqCst);
    }

    pub fn should_hide(&self, label: &str) -> bool {
        label == "main" && self.ready.load(Ordering::SeqCst) && !self.exiting.load(Ordering::SeqCst)
    }
}

#[cfg(feature = "desktop")]
mod desktop {
    use super::CloseToTray;
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
        AppHandle, Manager, Window, WindowEvent,
    };

    pub fn show_main(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    pub fn install(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let show = MenuItem::with_id(app, "tray.show", "显示主窗口", true, None::<&str>)?;
        let separator = PredefinedMenuItem::separator(app)?;
        let quit = MenuItem::with_id(app, "tray.quit", "退出", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &separator, &quit])?;
        let icon = app
            .default_window_icon()
            .cloned()
            .ok_or("TRAY_ICON_MISSING")?;
        // Tauri retains the icon in its resource table for the application's lifetime.
        TrayIconBuilder::with_id("music-share-tray")
            .icon(icon)
            .tooltip("同频 · TONE")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id.as_ref() {
                "tray.show" => show_main(app),
                "tray.quit" => {
                    app.state::<CloseToTray>().quit();
                    // Keep the existing RunEvent::Exit cleanup for media and sessions.
                    app.exit(0);
                }
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    show_main(tray.app_handle());
                }
            })
            .build(app)?;
        app.state::<CloseToTray>().enable();
        Ok(())
    }

    pub fn on_window_event(window: &Window, event: &WindowEvent) {
        if let WindowEvent::CloseRequested { api, .. } = event {
            if window
                .app_handle()
                .state::<CloseToTray>()
                .should_hide(window.label())
            {
                api.prevent_close();
                if window.hide().is_err() {
                    eprintln!("无法收起到托盘，窗口保持打开；请使用托盘菜单退出。");
                }
            }
        }
    }
}

#[cfg(feature = "desktop")]
pub use desktop::{install, on_window_event, show_main};

#[cfg(test)]
mod tests {
    use super::CloseToTray;

    #[test]
    fn keeps_normal_close_when_tray_creation_failed() {
        assert!(!CloseToTray::default().should_hide("main"));
    }

    #[test]
    fn closing_main_window_only_hides_and_can_be_repeated() {
        let policy = CloseToTray::default();
        policy.enable();
        assert!(policy.should_hide("main"));
        assert!(policy.should_hide("main"));
        assert!(!policy.should_hide("auxiliary"));
    }

    #[test]
    fn explicit_tray_quit_does_not_get_intercepted() {
        let policy = CloseToTray::default();
        policy.enable();
        policy.quit();
        assert!(!policy.should_hide("main"));
        policy.enable();
        assert!(!policy.should_hide("main"));
    }
}
