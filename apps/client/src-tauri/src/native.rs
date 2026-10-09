//! Versioned C ABI. Libraries are loaded from an application-owned directory,
//! never from an audio file or a room-supplied path.
use crate::{buffer::Pcm, model::AudioSpec};
use libloading::Library;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    path::{Path, PathBuf},
    sync::Arc,
};
#[repr(C)]
#[derive(Default)]
pub struct Bytes {
    data: *mut u8,
    size: usize,
}
#[repr(C)]
#[derive(Default)]
struct RawPcm {
    data: *mut i32,
    count: usize,
    rate: u32,
    bits: u8,
    channels: u8,
    position: u64,
}
type Handle = *mut c_void;
type ErrorFn = unsafe extern "C" fn() -> *const c_char;
type FreeFn = unsafe extern "C" fn(*mut c_void);
pub struct Native {
    _library: Library,
    error: ErrorFn,
    free: FreeFn,
    file_open: unsafe extern "C" fn(*const c_char, *mut Bytes) -> Handle,
    file_read: unsafe extern "C" fn(Handle, *mut RawPcm) -> i32,
    file_seek: unsafe extern "C" fn(Handle, u64) -> i32,
    file_close: unsafe extern "C" fn(Handle),
    encode: unsafe extern "C" fn(*const i32, usize, u32, u8, u8, u8, *mut Bytes) -> i32,
    decode: unsafe extern "C" fn(*const u8, usize, u8, u32, u8, u8, *mut RawPcm) -> i32,
    output_open: unsafe extern "C" fn(u32, u8, u8) -> Handle,
    output_queue: unsafe extern "C" fn(Handle, *const i32, usize, f32) -> i32,
    output_queued: unsafe extern "C" fn(Handle) -> u64,
    output_close: unsafe extern "C" fn(Handle),
    devices: unsafe extern "C" fn(*mut Bytes) -> i32,
    capture_open: unsafe extern "C" fn(*const c_char, u32, u8, *mut Bytes) -> Handle,
    capture_read: unsafe extern "C" fn(Handle, *mut RawPcm) -> i32,
    capture_close: unsafe extern "C" fn(Handle),
    peer_open: unsafe extern "C" fn(*const c_char, bool) -> Handle,
    peer_remote: unsafe extern "C" fn(Handle, *const c_char) -> i32,
    peer_poll: unsafe extern "C" fn(Handle, *mut Bytes) -> i32,
    peer_send: unsafe extern "C" fn(Handle, *const u8, usize, bool) -> i32,
    peer_buffered: unsafe extern "C" fn(Handle) -> usize,
    peer_limit: unsafe extern "C" fn(Handle) -> usize,
    peer_close: unsafe extern "C" fn(Handle),
}
impl Native {
    pub fn filename() -> &'static str {
        if cfg!(target_os = "windows") {
            "music_native.dll"
        } else if cfg!(target_os = "macos") {
            "libmusic_native.dylib"
        } else {
            "libmusic_native.so"
        }
    }
    pub fn locate() -> Result<PathBuf, String> {
        if cfg!(debug_assertions) {
            if let Some(path) = std::env::var_os("MUSIC_NATIVE_LIBRARY") {
                return PathBuf::from(path)
                    .canonicalize()
                    .map_err(|e| e.to_string());
            }
        }
        let executable = std::env::current_exe().map_err(|e| e.to_string())?;
        let path = executable
            .parent()
            .ok_or("NO_EXECUTABLE_DIRECTORY")?
            .join(Self::filename());
        // Source development should work without a terminal-specific environment variable.
        // Only inspect the build directory belonging to this compiled workspace.
        if cfg!(debug_assertions) {
            let project = Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .and_then(Path::parent);
            if let Some(project) = project {
                for directory in [
                    "native/build-com/Release",
                    "native/build-auto/Release",
                    "native/build/Release",
                    "native/build-auto",
                    "native/build",
                ] {
                    let candidate = project.join(directory).join(Self::filename());
                    if candidate.is_file() {
                        return candidate.canonicalize().map_err(|e| e.to_string());
                    }
                }
            }
        }
        if path.is_file() {
            return path.canonicalize().map_err(|e| e.to_string());
        }
        Err({
            format!(
                "缺少原生媒体库 {}；请按 README 构建并放到可执行文件旁",
                Self::filename()
            )
        })
    }
    pub fn load(path: &Path) -> Result<Arc<Self>, String> {
        unsafe {
            #[cfg(target_os = "windows")]
            let library: Library =
                libloading::os::windows::Library::load_with_flags(path, 0x00000100 | 0x00001000)
                    .map_err(|e| e.to_string())?
                    .into();
            #[cfg(not(target_os = "windows"))]
            let library = Library::new(path).map_err(|e| e.to_string())?;
            let abi = *library
                .get::<unsafe extern "C" fn() -> u32>(b"sh_abi_version\0")
                .map_err(|e| e.to_string())?;
            if abi() != 1 {
                return Err("NATIVE_ABI_MISMATCH".into());
            }
            macro_rules! sym {
                ($name:literal) => {
                    *library
                        .get(concat!($name, "\0").as_bytes())
                        .map_err(|e| e.to_string())?
                };
            }
            Ok(Arc::new(Self {
                error: sym!("sh_last_error"),
                free: sym!("sh_free"),
                file_open: sym!("sh_file_open"),
                file_read: sym!("sh_file_read"),
                file_seek: sym!("sh_file_seek"),
                file_close: sym!("sh_file_close"),
                encode: sym!("sh_encode"),
                decode: sym!("sh_decode"),
                output_open: sym!("sh_output_open"),
                output_queue: sym!("sh_output_queue"),
                output_queued: sym!("sh_output_queued"),
                output_close: sym!("sh_output_close"),
                devices: sym!("sh_capture_devices"),
                capture_open: sym!("sh_capture_open"),
                capture_read: sym!("sh_capture_read"),
                capture_close: sym!("sh_capture_close"),
                peer_open: sym!("sh_peer_open"),
                peer_remote: sym!("sh_peer_remote"),
                peer_poll: sym!("sh_peer_poll"),
                peer_send: sym!("sh_peer_send"),
                peer_buffered: sym!("sh_peer_buffered"),
                peer_limit: sym!("sh_peer_limit"),
                peer_close: sym!("sh_peer_close"),
                _library: library,
            }))
        }
    }
    fn error(&self) -> String {
        unsafe {
            let ptr = (self.error)();
            if ptr.is_null() {
                "NATIVE_ERROR".into()
            } else {
                CStr::from_ptr(ptr).to_string_lossy().into_owned()
            }
        }
    }
    fn bytes(&self, b: Bytes) -> Vec<u8> {
        unsafe {
            if b.data.is_null() {
                return vec![];
            }
            let result = std::slice::from_raw_parts(b.data, b.size).to_vec();
            (self.free)(b.data.cast());
            result
        }
    }
    fn pcm(&self, p: RawPcm) -> Pcm {
        unsafe {
            let samples = if p.data.is_null() {
                vec![]
            } else {
                let s = std::slice::from_raw_parts(p.data, p.count).to_vec();
                (self.free)(p.data.cast());
                s
            };
            Pcm {
                spec: AudioSpec {
                    sample_rate: p.rate,
                    bits: p.bits,
                    channels: p.channels,
                },
                position_ms: p.position,
                samples,
            }
        }
    }
    pub fn open_file(self: &Arc<Self>, path: &Path) -> Result<(File, serde_json::Value), String> {
        let path = CString::new(path.to_string_lossy().as_bytes()).map_err(|_| "INVALID_PATH")?;
        let mut metadata = Bytes::default();
        let handle = unsafe { (self.file_open)(path.as_ptr(), &mut metadata) };
        if handle.is_null() {
            return Err(self.error());
        }
        let file = File {
            handle,
            native: self.clone(),
        };
        let bytes = self.bytes(metadata);
        let meta = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        Ok((file, meta))
    }
    pub fn encode(&self, pcm: &Pcm, codec: u8) -> Result<Vec<u8>, String> {
        let mut bytes = Bytes::default();
        if unsafe {
            (self.encode)(
                pcm.samples.as_ptr(),
                pcm.samples.len(),
                pcm.spec.sample_rate,
                pcm.spec.bits,
                pcm.spec.channels,
                codec,
                &mut bytes,
            )
        } < 0
        {
            return Err(self.error());
        }
        Ok(self.bytes(bytes))
    }
    pub fn decode(
        &self,
        data: &[u8],
        codec: u8,
        spec: AudioSpec,
        position: u64,
    ) -> Result<Pcm, String> {
        let mut p = RawPcm::default();
        if unsafe {
            (self.decode)(
                data.as_ptr(),
                data.len(),
                codec,
                spec.sample_rate,
                spec.bits,
                spec.channels,
                &mut p,
            )
        } < 0
        {
            return Err(self.error());
        }
        let mut pcm = self.pcm(p);
        pcm.position_ms = position;
        if pcm.spec != spec {
            return Err("DECODE_SPEC_MISMATCH".into());
        }
        Ok(pcm)
    }
    pub fn output(self: &Arc<Self>, spec: AudioSpec) -> Result<Output, String> {
        spec.validate()?;
        let handle = unsafe { (self.output_open)(spec.sample_rate, spec.bits, spec.channels) };
        if handle.is_null() {
            return Err(self.error());
        }
        Ok(Output {
            handle,
            native: self.clone(),
        })
    }
    pub fn devices(&self) -> Result<serde_json::Value, String> {
        let mut b = Bytes::default();
        if unsafe { (self.devices)(&mut b) } < 0 {
            return Err(self.error());
        }
        serde_json::from_slice(&self.bytes(b)).map_err(|e| e.to_string())
    }
    pub fn capture(self: &Arc<Self>, device: &str, spec: AudioSpec) -> Result<Capture, String> {
        spec.validate()?;
        let id = CString::new(device).map_err(|_| "INVALID_DEVICE")?;
        let mut b = Bytes::default();
        let handle =
            unsafe { (self.capture_open)(id.as_ptr(), spec.sample_rate, spec.bits, &mut b) };
        if handle.is_null() {
            return Err(self.error());
        }
        let _ = self.bytes(b);
        Ok(Capture {
            handle,
            native: self.clone(),
        })
    }
    pub fn peer(self: &Arc<Self>, ice: &[String], offer: bool) -> Result<Peer, String> {
        let json = CString::new(serde_json::to_string(ice).unwrap()).unwrap();
        let handle = unsafe { (self.peer_open)(json.as_ptr(), offer) };
        if handle.is_null() {
            return Err(self.error());
        }
        Ok(Peer {
            handle,
            native: self.clone(),
        })
    }
}
pub struct File {
    handle: Handle,
    native: Arc<Native>,
}
pub struct Capture {
    handle: Handle,
    native: Arc<Native>,
}
pub struct Output {
    handle: Handle,
    native: Arc<Native>,
}
pub struct Peer {
    handle: Handle,
    native: Arc<Native>,
}
// Handles are exclusively owned by one media worker. Native callbacks only write
// to a mutex-protected peer queue; no handle is used concurrently by Rust.
unsafe impl Send for File {}
unsafe impl Send for Capture {}
unsafe impl Send for Output {}
unsafe impl Send for Peer {}
impl File {
    pub fn read(&mut self) -> Result<Option<Pcm>, String> {
        let mut p = RawPcm::default();
        let result = unsafe { (self.native.file_read)(self.handle, &mut p) };
        if result < 0 {
            return Err(self.native.error());
        }
        if result == 0 {
            Ok(None)
        } else {
            Ok(Some(self.native.pcm(p)))
        }
    }
    pub fn seek(&mut self, position: u64) -> Result<(), String> {
        if unsafe { (self.native.file_seek)(self.handle, position) } < 0 {
            Err(self.native.error())
        } else {
            Ok(())
        }
    }
}
impl Capture {
    pub fn read(&mut self) -> Result<Option<Pcm>, String> {
        let mut p = RawPcm::default();
        let n = unsafe { (self.native.capture_read)(self.handle, &mut p) };
        if n < 0 {
            Err(self.native.error())
        } else if n == 0 {
            Ok(None)
        } else {
            Ok(Some(self.native.pcm(p)))
        }
    }
}
impl Output {
    pub fn queue(&mut self, pcm: &Pcm, volume: f32) -> Result<(), String> {
        if unsafe {
            (self.native.output_queue)(self.handle, pcm.samples.as_ptr(), pcm.samples.len(), volume)
        } < 0
        {
            Err(self.native.error())
        } else {
            Ok(())
        }
    }
    pub fn queued_ms(&self) -> u64 {
        unsafe { (self.native.output_queued)(self.handle) }
    }
}
impl Peer {
    pub fn remote(&mut self, data: &serde_json::Value) -> Result<(), String> {
        let json = CString::new(data.to_string()).unwrap();
        if unsafe { (self.native.peer_remote)(self.handle, json.as_ptr()) } < 0 {
            Err(self.native.error())
        } else {
            Ok(())
        }
    }
    pub fn poll(&mut self) -> Result<Option<Vec<u8>>, String> {
        let mut b = Bytes::default();
        let n = unsafe { (self.native.peer_poll)(self.handle, &mut b) };
        if n < 0 {
            Err(self.native.error())
        } else if n == 0 {
            Ok(None)
        } else {
            Ok(Some(self.native.bytes(b)))
        }
    }
    pub fn send(&mut self, data: &[u8], prefetch: bool) -> Result<bool, String> {
        let n =
            unsafe { (self.native.peer_send)(self.handle, data.as_ptr(), data.len(), prefetch) };
        if n < 0 {
            Err(self.native.error())
        } else {
            Ok(n > 0)
        }
    }
    pub fn buffered(&self) -> usize {
        unsafe { (self.native.peer_buffered)(self.handle) }
    }
    pub fn max_message(&self) -> usize {
        unsafe { (self.native.peer_limit)(self.handle) }
    }
}
impl Drop for File {
    fn drop(&mut self) {
        unsafe { (self.native.file_close)(self.handle) }
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        unsafe { (self.native.capture_close)(self.handle) }
    }
}
impl Drop for Output {
    fn drop(&mut self) {
        unsafe { (self.native.output_close)(self.handle) }
    }
}
impl Drop for Peer {
    fn drop(&mut self) {
        unsafe { (self.native.peer_close)(self.handle) }
    }
}
