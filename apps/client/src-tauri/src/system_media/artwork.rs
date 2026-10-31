use super::{Playback, Snapshot};
use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArtworkFrame {
    pub room_id: String,
    pub track_id: String,
    pub source_epoch: u64,
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}
impl ArtworkFrame {
    pub fn validate(&self) -> Result<(), String> {
        if uuid::Uuid::parse_str(&self.room_id).is_err()
            || uuid::Uuid::parse_str(&self.track_id).is_err()
            || self.width == 0
            || self.height == 0
            || self.width > 320
            || self.height > 320
            || self.rgba.len() != self.width as usize * self.height as usize * 4
        {
            return Err("SYSTEM_ARTWORK_INVALID".into());
        }
        Ok(())
    }
    pub fn matches(&self, state: &Snapshot) -> bool {
        state.room_id.as_ref() == Some(&self.room_id)
            && state.track_id.as_ref() == Some(&self.track_id)
            && state.source_epoch == self.source_epoch
            && state.playback != Playback::Stopped
    }
    pub fn bgra(&self, side: usize) -> Vec<u8> {
        let mut pixels = vec![0; side * side * 4];
        for y in 0..side {
            for x in 0..side {
                let source = ((y * self.height as usize / side) * self.width as usize
                    + x * self.width as usize / side)
                    * 4;
                let target = (y * side + x) * 4;
                // DWM expects premultiplied BGRA; composite transparency onto the light surface.
                let alpha = self.rgba[source + 3] as u32;
                pixels[target] =
                    ((self.rgba[source + 2] as u32 * alpha + 247 * (255 - alpha)) / 255) as u8;
                pixels[target + 1] =
                    ((self.rgba[source + 1] as u32 * alpha + 242 * (255 - alpha)) / 255) as u8;
                pixels[target + 2] =
                    ((self.rgba[source] as u32 * alpha + 238 * (255 - alpha)) / 255) as u8;
                pixels[target + 3] = 255;
            }
        }
        pixels
    }
}

pub fn cover_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "SYSTEM_ARTWORK_URL_INVALID")?;
    let host = url.host_str().unwrap_or_default();
    if value.len() > 2048
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || url.fragment().is_some()
        || ![".music.126.net", ".music.163.com"].iter().any(|suffix| {
            host.strip_suffix(suffix)
                .is_some_and(|label| !label.is_empty())
        })
    {
        return Err("SYSTEM_ARTWORK_URL_INVALID".into());
    }
    Ok(url)
}
pub async fn download(http: &reqwest::Client, value: &str) -> Result<Vec<u8>, String> {
    let mut url = cover_url(value)?;
    let job = async {
        for _ in 0..4 {
            let mut response = http
                .get(url.clone())
                .send()
                .await
                .map_err(|_| "SYSTEM_ARTWORK_DOWNLOAD_FAILED")?;
            if response.status().is_redirection() {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or("SYSTEM_ARTWORK_DOWNLOAD_FAILED")?;
                url = cover_url(
                    url.join(location)
                        .map_err(|_| "SYSTEM_ARTWORK_URL_INVALID")?
                        .as_str(),
                )?;
                continue;
            }
            if !response.status().is_success() {
                return Err("SYSTEM_ARTWORK_DOWNLOAD_FAILED".into());
            }
            const MAX: usize = 10 * 1024 * 1024;
            if response.content_length().is_some_and(|n| n > MAX as u64) {
                return Err("SYSTEM_ARTWORK_TOO_LARGE".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| "SYSTEM_ARTWORK_DOWNLOAD_FAILED")?
            {
                if bytes.len() + chunk.len() > MAX {
                    return Err("SYSTEM_ARTWORK_TOO_LARGE".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            if bytes.is_empty() {
                return Err("SYSTEM_ARTWORK_DOWNLOAD_FAILED".into());
            }
            return Ok(bytes);
        }
        Err("SYSTEM_ARTWORK_DOWNLOAD_FAILED".into())
    };
    tokio::time::timeout(std::time::Duration::from_secs(15), job)
        .await
        .map_err(|_| "SYSTEM_ARTWORK_DOWNLOAD_FAILED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn frame() -> ArtworkFrame {
        ArtworkFrame {
            room_id: uuid::Uuid::new_v4().to_string(),
            track_id: uuid::Uuid::new_v4().to_string(),
            source_epoch: 3,
            width: 2,
            height: 1,
            rgba: vec![255, 0, 0, 255, 0, 0, 255, 0],
        }
    }
    #[test]
    fn validates_bounded_pixels_and_identity() {
        let mut image = frame();
        assert!(image.validate().is_ok());
        image.width = 321;
        assert!(image.validate().is_err());
        image.width = 0;
        assert!(image.validate().is_err());
        image.width = 2;
        image.rgba.pop();
        assert!(image.validate().is_err());
        image = frame();
        image.room_id = "invalid".into();
        assert!(image.validate().is_err());
    }
    #[test]
    fn ignores_late_artwork_and_clears_on_stop_or_leave_but_keeps_pause() {
        let image = frame();
        let mut state = Snapshot {
            room_id: Some(image.room_id.clone()),
            track_id: Some(image.track_id.clone()),
            source_epoch: 3,
            playback: Playback::Playing,
            ..Default::default()
        };
        assert!(image.matches(&state));
        state.playback = Playback::Paused;
        assert!(image.matches(&state));
        state.source_epoch = 4;
        assert!(!image.matches(&state));
        state.source_epoch = 3;
        state.playback = Playback::Stopped;
        assert!(!image.matches(&state));
        state.playback = Playback::Playing;
        state.track_id = Some(uuid::Uuid::new_v4().to_string());
        assert!(!image.matches(&state));
        state.room_id = None;
        assert!(!image.matches(&state));
    }
    #[test]
    fn scales_bgra_and_composites_transparency_without_stretching_channels() {
        let pixels = frame().bgra(2);
        assert_eq!(&pixels[..4], &[0, 0, 255, 255]);
        assert_eq!(&pixels[4..8], &[247, 242, 238, 255]);
        assert_eq!(&pixels[8..12], &[0, 0, 255, 255]);
    }
    #[test]
    fn artwork_downloads_are_restricted_to_https_provider_images() {
        assert!(cover_url("https://p1.music.126.net/cover.jpg").is_ok());
        assert!(cover_url("https://p2.music.163.com/cover.png").is_ok());
        for url in [
            "http://p1.music.126.net/a",
            "https://127.0.0.1/a",
            "https://p1.music.126.net.evil.test/a",
            "file:///private",
            "https://user:pass@p1.music.126.net/a",
            "https://p1.music.126.net:8443/a",
            "https://p1.music.126.net/a#fragment",
        ] {
            assert!(cover_url(url).is_err(), "accepted {url}");
        }
    }
}
