use super::{emit_control, Playback, Snapshot};
use std::{
    cell::Cell,
    ffi::c_void,
    sync::{Arc, Mutex},
};
use windows::{
    core::w,
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
            COINIT_APARTMENTTHREADED,
        },
        UI::{
            Shell::{
                DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass,
                TaskbarList, THBF_DISABLED, THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON,
                THB_TOOLTIP, THUMBBUTTON,
            },
            WindowsAndMessaging::{
                CreateIcon, DestroyIcon, GetSystemMetrics, RegisterWindowMessageW, HICON,
                SM_CXSMICON, WM_COMMAND, WM_NCDESTROY,
            },
        },
    },
};
const SUBCLASS: usize = 0x4d534854;
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
        unsafe {
            let _ = DestroyIcon(self.0);
        }
    }
}
struct Hook {
    app: tauri::AppHandle,
    snapshot: Arc<Mutex<Snapshot>>,
    created: u32,
    alive: Cell<bool>,
}
pub struct Taskbar {
    hwnd: HWND,
    api: ITaskbarList3,
    icons: [Icon; 4],
    hook: Box<Hook>,
    added: bool,
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
        let api: ITaskbarList3 =
            unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER)? };
        unsafe {
            api.HrInit()?;
        }
        let icons = [icon(0)?, icon(1)?, icon(2)?, icon(3)?];
        let mut hook = Box::new(Hook {
            app,
            snapshot,
            created: unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) },
            alive: Cell::new(true),
        });
        let hwnd = HWND(hwnd);
        if hook.created == 0
            || !unsafe {
                SetWindowSubclass(
                    hwnd,
                    Some(window_proc),
                    SUBCLASS,
                    (&mut *hook as *mut Hook) as usize,
                )
            }
            .as_bool()
        {
            return Err(windows::core::Error::from_thread());
        }
        Ok(Self {
            hwnd,
            api,
            icons,
            hook,
            added: false,
            _apartment: apartment,
        })
    }
    pub fn created(&mut self) {
        if let Ok(api) = unsafe {
            CoCreateInstance::<_, ITaskbarList3>(&TaskbarList, None, CLSCTX_INPROC_SERVER)
        } {
            if unsafe { api.HrInit() }.is_ok() {
                self.api = api;
            }
        }
        self.added = false;
    }
    pub fn update(&mut self, state: &Snapshot) {
        if !self.hook.alive.get() {
            return;
        }
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
        if self.added {
            let _ = unsafe { self.api.ThumbBarUpdateButtons(self.hwnd, &buttons) };
        } else {
            self.added = unsafe { self.api.ThumbBarAddButtons(self.hwnd, &buttons) }.is_ok();
        }
    }
}
impl Drop for Taskbar {
    fn drop(&mut self) {
        if self.hook.alive.get() {
            unsafe {
                let _ = RemoveWindowSubclass(self.hwnd, Some(window_proc), SUBCLASS);
            }
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
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    let hook = unsafe { &*(data as *const Hook) };
    if message == hook.created {
        let app = hook.app.clone();
        let _ = app.run_on_main_thread(super::refresh_taskbar);
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
        hook.alive.set(false);
        unsafe {
            let _ = RemoveWindowSubclass(hwnd, Some(window_proc), SUBCLASS);
        }
    }
    unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
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
