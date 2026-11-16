import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const read=(file:string)=>readFileSync(new URL(file,import.meta.url),'utf8');
it('uses actual macOS authorization and delivery rather than the desktop plugin permission stub',()=>{
 const source=read('../src-tauri/src/chat_notifications/macos.rs');
 for(const text of ['mac_usernotifications::check_bundle()','get_notification_settings()','AuthorizationStatus::NotDetermined','request_auth()','NotificationSettingStatus::Enabled','.send()','.await','notification_requested: false'])expect(source).toContain(text);
 expect(source).not.toContain('app.notification()');expect(source).not.toContain('.default_sound()');
 expect(read('../src-tauri/Cargo.toml')).toContain('mac-usernotifications = { version = "=0.3.1", optional = true }');
});
it('bounds permission and click work and invalidates obsolete room sessions',()=>{
 const source=read('../src-tauri/src/chat_notifications/macos.rs');
 for(const text of ['try_lock()','Duration::from_secs(60)','old.abort()','let _ = old.await','session.generation.wrapping_add(1)','close_delivered','set_badge_count(None)','response.is_default_action()','current(&callback_app, generation)','chat-notification-clicked'])expect(source).toContain(text);
 expect(read('../src-tauri/src/lib.rs')).toContain('chat_notifications::on_focus(window)');
});
