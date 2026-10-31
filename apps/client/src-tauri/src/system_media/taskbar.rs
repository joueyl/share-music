use super::{emit_control, Playback, Snapshot};
use std::{
    cell::{Cell, RefCell},
    ffi::c_void,
    rc::Rc,
    sync::{Arc, Mutex},
};
use windows::{
    core::{w, BOOL, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        Graphics::{
            Dwm::{
                DwmInvalidateIconicBitmaps, DwmSetIconicThumbnail, DwmSetWindowAttribute,
                DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP,
            },
            Gdi::{
                CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
                DIB_RGB_COLORS, HBITMAP,
            },
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::{
            Shell::{
                DefSubclassProc, ITaskbarList4, RemoveWindowSubclass, SetWindowSubclass,
                TaskbarList, STPF_USEAPPPEEKALWAYS, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED,
                THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
            },
            WindowsAndMessaging::{
                CreateIcon, CreateWindowExW, DestroyIcon, DestroyWindow, GetSystemMetrics,
                IsWindowVisible, PostMessageW, RegisterWindowMessageW, SendMessageW,
                SetWindowTextW, HICON, SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_RESTORE, SM_CXSMICON,
                WM_ACTIVATE, WM_APP, WM_CLOSE, WM_COMMAND, WM_DWMSENDICONICTHUMBNAIL, WM_GETICON,
                WM_NCDESTROY, WM_SHOWWINDOW, WM_SYSCOMMAND, WS_CAPTION, WS_EX_NOACTIVATE,
                WS_EX_TOOLWINDOW, WS_POPUP, WS_SYSMENU,
            },
        },
    },
};
const SUBCLASS: usize = 0x4d534854;
const SYNC_PREVIEW: u32 = WM_APP + 0x139;
const PREVIOUS: u32 = 0x7101;
const TOGGLE: u32 = 0x7102;
const NEXT: u32 = 0x7103;
struct Apartment(bool);
impl Drop for Apartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe {
                CoUninitialize();
            }
        }
    }
}
struct Icon(HICON);
impl Drop for Icon {
    fn drop(&mut self) {
        let _ = unsafe { DestroyIcon(self.0) };
    }
}

// A hidden owned tool window supplies ONLY the taskbar album thumbnail. The real main
// HWND never gets FORCE_ICONIC/HAS_ICONIC, so Alt+Tab retains Windows' real window image.
struct ProxyWindow {
    hwnd: HWND,
    alive: Rc<Cell<bool>>,
}
impl ProxyWindow {
    fn new(main: HWND) -> windows::core::Result<Self> {
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("STATIC"),
                w!("同频 · TONE"),
                WS_POPUP | WS_CAPTION | WS_SYSMENU,
                0,
                0,
                1,
                1,
                if main.0.is_null() { None } else { Some(main) },
                None,
                None,
                None,
            )?
        };
        Ok(Self {
            hwnd,
            alive: Rc::new(Cell::new(true)),
        })
    }
}
impl Drop for ProxyWindow {
    fn drop(&mut self) {
        if self.alive.replace(false) {
            let _ = unsafe { DestroyWindow(self.hwnd) };
        }
    }
}
struct Hook {
    app: tauri::AppHandle,
    snapshot: Arc<Mutex<Snapshot>>,
    created: u32,
    alive: Cell<bool>,
    main: HWND,
    proxy: HWND,
    proxy_alive: Rc<Cell<bool>>,
    artwork: RefCell<Option<super::super::artwork::ArtworkFrame>>,
    preview_failed: Cell<bool>,
}
pub struct Taskbar {
    hwnd: HWND,
    api: ITaskbarList4,
    icons: [Icon; 4],
    proxy: ProxyWindow,
    hook: Box<Hook>,
    registered: bool,
    registration_failed: bool,
    main_added: bool,
    proxy_added: bool,
    visible: bool,
    _apartment: Apartment,
}
impl Taskbar {
    pub fn new(
        hwnd: *mut c_void,
        app: tauri::AppHandle,
        snapshot: Arc<Mutex<Snapshot>>,
    ) -> windows::core::Result<Self> {
        let apartment =
            Apartment(unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok());
        let api: ITaskbarList4 =
            unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            api.HrInit()?;
        }
        let hwnd = HWND(hwnd);
        let proxy = ProxyWindow::new(hwnd)?;
        let icons = [icon(0)?, icon(1)?, icon(2)?, icon(3)?];
        let mut hook = Box::new(Hook {
            app,
            snapshot,
            created: unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) },
            alive: Cell::new(true),
            main: hwnd,
            proxy: proxy.hwnd,
            proxy_alive: proxy.alive.clone(),
            artwork: RefCell::new(None),
            preview_failed: Cell::new(false),
        });
        let pointer = (&mut *hook as *mut Hook) as usize;
        if hook.created == 0
            || !unsafe { SetWindowSubclass(hwnd, Some(window_proc), SUBCLASS, pointer) }.as_bool()
        {
            return Err(windows::core::Error::from_thread());
        }
        if !unsafe { SetWindowSubclass(proxy.hwnd, Some(window_proc), SUBCLASS, pointer) }.as_bool()
        {
            let _ = unsafe { RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS) };
            return Err(windows::core::Error::from_thread());
        }
        Ok(Self {
            hwnd,
            api,
            icons,
            proxy,
            hook,
            registered: false,
            registration_failed: false,
            main_added: false,
            proxy_added: false,
            visible: false,
            _apartment: apartment,
        })
    }
    pub fn created(&mut self) {
        if let Ok(api) = unsafe {
            CoCreateInstance::<_, ITaskbarList4>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
        } {
            if unsafe { api.HrInit() }.is_ok() {
                self.api = api;
            }
        }
        self.registered = false;
        self.registration_failed = false;
        self.main_added = false;
        self.proxy_added = false;
        self.sync_visibility();
    }
    fn unregister(&mut self) {
        if self.registered {
            let _ = unsafe { self.api.UnregisterTab(self.proxy.hwnd) };
            self.registered = false;
        }
    }
    fn sync_visibility(&mut self) {
        let visible = self.hook.alive.get() && unsafe { IsWindowVisible(self.hwnd) }.as_bool();
        if visible != self.visible {
            self.visible = visible;
            self.registration_failed = false;
        }
        let needs_cover = visible && self.hook.artwork.borrow().is_some() && self.proxy.alive.get();
        if !needs_cover {
            self.unregister();
            return;
        }
        if self.registered || self.registration_failed {
            return;
        }
        // Fail closed to the real window if the OS cannot delegate Peek to the parent.
        let result = unsafe {
            (|| -> windows::core::Result<()> {
                iconic(self.proxy.hwnd, true)?;
                self.api.RegisterTab(self.proxy.hwnd, self.hwnd)?;
                self.api
                    .SetTabProperties(self.proxy.hwnd, STPF_USEAPPPEEKALWAYS)?;
                self.api.SetTabOrder(self.proxy.hwnd, HWND::default())?;
                self.api.SetTabActive(self.proxy.hwnd, self.hwnd, 0)
            })()
        };
        if result.is_ok() {
            self.registered = true;
        } else {
            let _ = unsafe { self.api.UnregisterTab(self.proxy.hwnd) };
            let _ = iconic(self.proxy.hwnd, false);
            self.registration_failed = true;
        }
    }
    pub fn set_artwork(&mut self, artwork: super::super::artwork::ArtworkFrame) {
        if !self.hook.alive.get() {
            return;
        }
        *self.hook.artwork.borrow_mut() = Some(artwork);
        self.hook.preview_failed.set(false);
        self.registration_failed = false;
        self.sync_visibility();
        if self.registered {
            let _ = unsafe { DwmInvalidateIconicBitmaps(self.proxy.hwnd) };
        }
        let state = self.hook.snapshot.lock().ok().map(|state| state.clone());
        if let Some(state) = state {
            self.update(&state);
        }
    }
    pub fn update(&mut self, state: &Snapshot) {
        if !self.hook.alive.get() {
            return;
        }
        if self.hook.preview_failed.replace(false) {
            self.hook.artwork.borrow_mut().take();
            self.registration_failed = true;
        }
        let stale = self
            .hook
            .artwork
            .borrow()
            .as_ref()
            .is_some_and(|artwork| !artwork.matches(state));
        if stale {
            self.hook.artwork.borrow_mut().take();
            self.registration_failed = false;
        }
        self.sync_visibility();
        let enabled = state.can_control && state.track_id.is_some();
        let playing = state.playback == Playback::Playing;
        let buttons = [
            button(PREVIOUS, "上一首", self.icons[0].0, enabled),
            button(
                TOGGLE,
                if playing { "暂停" } else { "继续播放" },
                self.icons[if playing { 2 } else { 1 }].0,
                enabled,
            ),
            button(NEXT, "下一首", self.icons[3].0, enabled),
        ];
        let target = if self.registered {
            self.proxy.hwnd
        } else {
            self.hwnd
        };
        let added = if self.registered {
            &mut self.proxy_added
        } else {
            &mut self.main_added
        };
        // Explorer may either retain or rebuild a registered tab's toolbar across unregister.
        // Try the expected operation first, then recover without accumulating another toolbar.
        *added = if *added {
            unsafe { self.api.ThumbBarUpdateButtons(target, &buttons) }
                .or_else(|_| unsafe { self.api.ThumbBarAddButtons(target, &buttons) })
                .is_ok()
        } else {
            unsafe { self.api.ThumbBarAddButtons(target, &buttons) }
                .or_else(|_| unsafe { self.api.ThumbBarUpdateButtons(target, &buttons) })
                .is_ok()
        };
        if self.registered {
            let title: Vec<u16> = state.title.encode_utf16().chain(Some(0)).collect();
            let _ = unsafe { SetWindowTextW(self.proxy.hwnd, PCWSTR(title.as_ptr())) };
        }
    }
}
impl Drop for Taskbar {
    fn drop(&mut self) {
        self.unregister();
        if self.proxy.alive.get() {
            let _ = unsafe { RemoveWindowSubclass(self.proxy.hwnd, Some(window_proc), SUBCLASS) };
            let _ = iconic(self.proxy.hwnd, false);
        }
        if self.hook.alive.get() {
            let _ = unsafe { RemoveWindowSubclass(self.hwnd, Some(window_proc), SUBCLASS) };
        }
    }
}
fn button(id: u32, title: &str, icon: HICON, enabled: bool) -> THUMBBUTTON {
    let mut tip = [0u16; 260];
    for (out, value) in tip.iter_mut().take(259).zip(title.encode_utf16()) {
        *out = value;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        hIcon: icon,
        szTip: tip,
        dwFlags: if enabled { THBF_ENABLED } else { THBF_DISABLED },
        ..Default::default()
    }
}

fn is_cover_request(hwnd: HWND, proxy: HWND, message: u32) -> bool {
    hwnd == proxy && message == WM_DWMSENDICONICTHUMBNAIL
}
fn queue_sync(hook: &Hook) {
    let _ = unsafe { PostMessageW(Some(hook.main), SYNC_PREVIEW, WPARAM(0), LPARAM(0)) };
}
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    let hook = unsafe { &*(data as *const Hook) };
    let proxy = hwnd == hook.proxy;
    if is_cover_request(hwnd, hook.proxy, message) {
        let width = ((lparam.0 as usize >> 16) & 0xffff) as u32;
        let height = (lparam.0 as usize & 0xffff) as u32;
        let delivered = hook
            .artwork
            .try_borrow()
            .ok()
            .and_then(|artwork| {
                artwork.as_ref().map(|artwork| {
                    thumbnail(artwork, width.min(height).min(320))
                        .and_then(|image| unsafe { DwmSetIconicThumbnail(hwnd, image.0, 0) })
                })
            })
            .is_some_and(|result| result.is_ok());
        if delivered {
            return LRESULT(0);
        }
        hook.preview_failed.set(true);
        queue_sync(hook);
    } else if !proxy && message == hook.created {
        let _ = hook.app.run_on_main_thread(super::refresh_taskbar);
    } else if !proxy && message == SYNC_PREVIEW {
        super::sync_taskbar();
        return LRESULT(0);
    } else if !proxy && message == WM_SHOWWINDOW {
        queue_sync(hook);
    } else if proxy && message == WM_GETICON && hook.alive.get() {
        return unsafe { SendMessageW(hook.main, message, Some(wparam), Some(lparam)) };
    } else if proxy && message == WM_ACTIVATE && (wparam.0 & 0xffff) != 0 {
        let app = hook.app.clone();
        let _ = hook
            .app
            .run_on_main_thread(move || crate::close_to_tray::show_main(&app));
        return LRESULT(0);
    } else if proxy
        && (message == WM_CLOSE
            || (message == WM_SYSCOMMAND && (wparam.0 as u32 & 0xfff0) == SC_CLOSE))
    {
        let _ = unsafe { PostMessageW(Some(hook.main), WM_CLOSE, WPARAM(0), LPARAM(0)) };
        return LRESULT(0);
    } else if proxy
        && message == WM_SYSCOMMAND
        && [SC_RESTORE, SC_MINIMIZE, SC_MAXIMIZE].contains(&(wparam.0 as u32 & 0xfff0))
    {
        let _ = unsafe { PostMessageW(Some(hook.main), message, wparam, lparam) };
        return LRESULT(0);
    } else if message == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) == THBN_CLICKED as usize {
        let action = match (wparam.0 & 0xffff) as u32 {
            PREVIOUS => Some("previous"),
            TOGGLE => Some("toggle"),
            NEXT => Some("next"),
            _ => None,
        };
        if let Some(action) = action {
            emit_control(&hook.app, &hook.snapshot, action, None);
            return LRESULT(0);
        }
    } else if message == WM_NCDESTROY {
        if proxy {
            hook.proxy_alive.set(false);
        } else {
            hook.alive.set(false);
        }
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS) };
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
}
// These attributes are applied exclusively to the hidden proxy, never the real HWND.
fn iconic(hwnd: HWND, enabled: bool) -> windows::core::Result<()> {
    let value = BOOL::from(enabled);
    let mut error = None;
    for attribute in [DWMWA_FORCE_ICONIC_REPRESENTATION, DWMWA_HAS_ICONIC_BITMAP] {
        if let Err(failure) = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                attribute,
                &value as *const _ as _,
                std::mem::size_of::<BOOL>() as u32,
            )
        } {
            if error.is_none() {
                error = Some(failure);
            }
        }
    }
    error.map_or(Ok(()), Err)
}
struct Bitmap(HBITMAP);
impl Drop for Bitmap {
    fn drop(&mut self) {
        let _ = unsafe { DeleteObject(self.0.into()) };
    }
}
fn thumbnail(
    artwork: &super::super::artwork::ArtworkFrame,
    side: u32,
) -> windows::core::Result<Bitmap> {
    if side == 0 || side > 320 {
        return Err(windows::core::Error::from_thread());
    }
    bitmap(side, side, &artwork.bgra(side as usize))
}
fn bitmap(width: u32, height: u32, pixels: &[u8]) -> windows::core::Result<Bitmap> {
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || pixels.len() != width as usize * height as usize * 4
    {
        return Err(windows::core::Error::from_thread());
    }
    let info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width as i32,
            biHeight: -(height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits = std::ptr::null_mut();
    let bitmap =
        Bitmap(unsafe { CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0)? });
    if bits.is_null() {
        return Err(windows::core::Error::from_thread());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u8, pixels.len());
    }
    Ok(bitmap)
}
fn icon(kind: u8) -> windows::core::Result<Icon> {
    let size = unsafe { GetSystemMetrics(SM_CXSMICON) }.max(16) as usize;
    let stride = size.div_ceil(16) * 2;
    let mut mask = vec![255u8; stride * size];
    let mut pixels = vec![0u8; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let px = x as i32 * 20 / size as i32;
            let py = y as i32 * 20 / size as i32;
            let dy = (py - 10).abs();
            let triangle = |left: i32, right: i32, forward: bool| {
                px >= left
                    && px <= right
                    && dy
                        <= if forward {
                            (right - px) * 3 / 4
                        } else {
                            (px - left) * 3 / 4
                        }
            };
            let on = match kind {
                0 => (4..=5).contains(&px) && (4..=16).contains(&py) || triangle(7, 16, false),
                1 => triangle(6, 15, true),
                2 => ((5..=8).contains(&px) || (12..=15).contains(&px)) && (4..=16).contains(&py),
                _ => triangle(4, 13, true) || (15..=16).contains(&px) && (4..=16).contains(&py),
            };
            if on {
                let offset = (y * size + x) * 4;
                pixels[offset..offset + 4].copy_from_slice(&[193, 232, 212, 255]);
                mask[y * stride + x / 8] &= !(128 >> (x % 8));
            }
        }
    }
    unsafe {
        CreateIcon(
            None,
            size as i32,
            size as i32,
            1,
            32,
            mask.as_ptr(),
            pixels.as_ptr(),
        )
        .map(Icon)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowLongPtrW, GWL_EXSTYLE, GW_OWNER, WM_DWMSENDICONICLIVEPREVIEWBITMAP,
    };
    #[test]
    fn album_cover_requests_are_isolated_from_the_real_hwnd_and_peek() {
        let main = HWND(1usize as _);
        let proxy = HWND(2usize as _);
        assert!(is_cover_request(proxy, proxy, WM_DWMSENDICONICTHUMBNAIL));
        assert!(!is_cover_request(main, proxy, WM_DWMSENDICONICTHUMBNAIL));
        assert!(!is_cover_request(
            main,
            proxy,
            WM_DWMSENDICONICLIVEPREVIEWBITMAP
        ));
        assert!(!is_cover_request(
            proxy,
            proxy,
            WM_DWMSENDICONICLIVEPREVIEWBITMAP
        ));
        assert!(!is_cover_request(proxy, proxy, WM_COMMAND));
    }
    #[test]
    fn proxy_is_hidden_owned_and_excluded_from_alt_tab() {
        let main = ProxyWindow::new(HWND::default()).unwrap();
        let proxy = ProxyWindow::new(main.hwnd).unwrap();
        assert!(!unsafe { IsWindowVisible(proxy.hwnd) }.as_bool());
        let style = unsafe { GetWindowLongPtrW(proxy.hwnd, GWL_EXSTYLE) } as u32;
        assert_ne!(style & WS_EX_TOOLWINDOW.0, 0);
        assert_ne!(style & WS_EX_NOACTIVATE.0, 0);
        assert_eq!(
            unsafe { GetWindow(proxy.hwnd, GW_OWNER) }.unwrap(),
            main.hwnd
        );
        assert_eq!(STPF_USEAPPPEEKALWAYS.0, 4);
    }
    #[test]
    fn creates_and_releases_real_thumbnail_bitmaps() {
        let artwork = super::super::super::artwork::ArtworkFrame {
            room_id: uuid::Uuid::new_v4().to_string(),
            track_id: uuid::Uuid::new_v4().to_string(),
            source_epoch: 1,
            width: 1,
            height: 1,
            rgba: vec![120, 160, 200, 255],
        };
        for side in [1, 160, 256, 320] {
            drop(thumbnail(&artwork, side).unwrap());
        }
        assert!(thumbnail(&artwork, 0).is_err());
        assert!(thumbnail(&artwork, 321).is_err());
        assert!(bitmap(20, 20, &[0; 4]).is_err());
    }
}
