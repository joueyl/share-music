use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
};
type DownloadLock = tokio::sync::Mutex<()>;

#[derive(Clone)]
pub struct MusicCache {
    root: PathBuf,
    locks: Arc<Mutex<HashMap<String, Weak<DownloadLock>>>>,
}
pub struct CachedAudio {
    pub bytes: Vec<u8>,
    pub stored: bool,
}
impl MusicCache {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            locks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    fn validate(hash: &str, size: u64) -> Result<(), String> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            || size == 0
            || size > 100 * 1024 * 1024
        {
            return Err("PLAYBACK_AUDIO_METADATA_INVALID".into());
        }
        Ok(())
    }
    fn file(&self, hash: &str) -> PathBuf {
        self.root.join(format!("{hash}.audio"))
    }
    fn valid(bytes: &[u8], hash: &str, size: u64) -> bool {
        bytes.len() as u64 == size && format!("{:x}", Sha256::digest(bytes)) == hash
    }
    pub async fn read(&self, hash: &str, size: u64) -> Result<Option<Vec<u8>>, String> {
        Self::validate(hash, size)?;
        let file = self.file(hash);
        let hash = hash.to_owned();
        tokio::task::spawn_blocking(move || {
            let Ok(metadata) = std::fs::symlink_metadata(&file) else {
                return None;
            };
            if !metadata.is_file() {
                return None;
            }
            let mut bytes = Vec::new();
            let read =
                std::fs::File::open(&file).and_then(|f| f.take(size + 1).read_to_end(&mut bytes));
            if read.is_ok() && Self::valid(&bytes, &hash, size) {
                return Some(bytes);
            }
            // This exact hash-named file is an app-owned, invalid cache entry.
            let _ = std::fs::remove_file(file);
            None
        })
        .await
        .map_err(|_| "PLAYBACK_AUDIO_CACHE_READ_FAILED".into())
    }
    pub async fn load(
        &self,
        http: &reqwest::Client,
        url: &str,
        hash: &str,
        size: u64,
    ) -> Result<CachedAudio, String> {
        self.load_with(hash, size, || crate::playback_audio::download(http, url))
            .await
    }
    async fn load_with<F, Fut>(
        &self,
        hash: &str,
        size: u64,
        fetch: F,
    ) -> Result<CachedAudio, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Vec<u8>, String>>,
    {
        Self::validate(hash, size)?;
        let lock = {
            let mut locks = self.locks.lock().map_err(|_| "STATE_LOCK_FAILED")?;
            locks.retain(|_, lock| lock.strong_count() > 0);
            let lock = locks
                .get(hash)
                .and_then(Weak::upgrade)
                .unwrap_or_else(|| Arc::new(DownloadLock::new(())));
            locks.insert(hash.to_owned(), Arc::downgrade(&lock));
            lock
        };
        let _guard = lock.lock().await;
        // Double-check after locking: another request may have just filled it.
        if let Some(bytes) = self.read(hash, size).await? {
            return Ok(CachedAudio {
                bytes,
                stored: true,
            });
        }
        let bytes = fetch().await?;
        if !Self::valid(&bytes, hash, size) {
            return Err("PLAYBACK_AUDIO_INTEGRITY_FAILED".into());
        }
        let root = self.root.clone();
        let file = self.file(hash);
        tokio::task::spawn_blocking(move || {
            let stored = write_atomic(&root, &file, &bytes).is_ok();
            CachedAudio { bytes, stored }
        })
        .await
        .map_err(|_| "PLAYBACK_AUDIO_CACHE_WRITE_FAILED".into())
    }
}
fn write_atomic(root: &Path, file: &Path, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(root)?;
    let temporary = root.join(format!("{}.part", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut output = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        output.write_all(bytes)?;
        output.sync_all()?;
        drop(output);
        // Windows rename cannot overwrite an existing invalid entry.
        if file.exists() {
            std::fs::remove_file(file)?;
        }
        std::fs::rename(&temporary, file)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("music-cache-test-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn sample() -> (Vec<u8>, String) {
        let bytes = b"test audio bytes".to_vec();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        (bytes, hash)
    }
    #[tokio::test]
    async fn cache_survives_restart_and_does_not_download_on_second_play() {
        let fixture = Fixture::new();
        let cache = MusicCache::new(fixture.0.clone());
        let (bytes, hash) = sample();
        let size = bytes.len() as u64;
        let first = cache
            .load_with(&hash, size, || async { Ok(bytes.clone()) })
            .await
            .unwrap();
        assert!(first.stored);
        assert_eq!(first.bytes, bytes);
        let restarted = MusicCache::new(fixture.0.clone());
        let second = restarted
            .load_with(&hash, size, || async {
                panic!("cache hit must not download")
            })
            .await
            .unwrap();
        assert_eq!(second.bytes, bytes);
        assert_eq!(std::fs::read_dir(&fixture.0).unwrap().count(), 1);
    }
    #[tokio::test]
    async fn corrupt_cache_is_replaced_and_failed_download_is_not_cached() {
        let fixture = Fixture::new();
        let cache = MusicCache::new(fixture.0.clone());
        let (bytes, hash) = sample();
        let size = bytes.len() as u64;
        std::fs::create_dir_all(&fixture.0).unwrap();
        std::fs::write(cache.file(&hash), vec![0; bytes.len()]).unwrap();
        assert!(cache.read(&hash, size).await.unwrap().is_none());
        assert!(cache
            .load_with(&hash, size, || async { Err("offline".into()) })
            .await
            .is_err());
        assert!(!cache.file(&hash).exists());
        assert!(cache
            .load_with(&hash, size, || async { Ok(vec![0; bytes.len()]) })
            .await
            .is_err());
        assert!(!cache.file(&hash).exists());
        cache
            .load_with(&hash, size, || async { Ok(bytes.clone()) })
            .await
            .unwrap();
        assert_eq!(cache.read(&hash, size).await.unwrap().unwrap(), bytes);
    }
    #[tokio::test]
    async fn simultaneous_requests_download_only_once() {
        let fixture = Fixture::new();
        let cache = MusicCache::new(fixture.0.clone());
        let (bytes, hash) = sample();
        let size = bytes.len() as u64;
        let count = AtomicUsize::new(0);
        let fetch = || async {
            count.fetch_add(1, Ordering::SeqCst);
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            Ok(bytes.clone())
        };
        let (a, b) = tokio::join!(
            cache.load_with(&hash, size, fetch),
            cache.load_with(&hash, size, fetch)
        );
        assert_eq!(a.unwrap().bytes, b.unwrap().bytes);
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn invalid_keys_cannot_escape_the_cache_directory() {
        let fixture = Fixture::new();
        let cache = MusicCache::new(fixture.0.clone());
        for key in ["../outside", "C:\\outside", "", &"A".repeat(64)] {
            assert!(cache.read(key, 10).await.is_err());
        }
        assert!(!fixture.0.exists());
    }
    #[tokio::test]
    async fn cache_write_failure_does_not_block_playback() {
        let fixture = Fixture::new();
        std::fs::write(&fixture.0, b"not a directory").unwrap();
        let cache = MusicCache::new(fixture.0.clone());
        let (bytes, hash) = sample();
        let result = cache
            .load_with(&hash, bytes.len() as u64, || async { Ok(bytes.clone()) })
            .await
            .unwrap();
        assert!(!result.stored);
        assert_eq!(result.bytes, bytes);
        std::fs::remove_file(&fixture.0).unwrap();
    }
}
