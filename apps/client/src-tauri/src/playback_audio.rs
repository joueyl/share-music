const MAX_AUDIO_BYTES: usize = 100 * 1024 * 1024;

pub fn validate_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "PLAYBACK_AUDIO_URL_INVALID")?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !host.strip_suffix(".music.126.net").is_some_and(|label| {
            !label.is_empty() && label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        })
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.fragment().is_some()
    {
        return Err("PLAYBACK_AUDIO_URL_INVALID".into());
    }
    Ok(url)
}

/// Download the actual song, not waveform data. Provider URLs and errors
/// must never be included in returned errors or logs.
pub async fn download(http: &reqwest::Client, value: &str) -> Result<Vec<u8>, String> {
    let mut url = validate_url(value)?;
    let mut received = None;
    for _ in 0..4 {
        let response = http
            .get(url.clone())
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|_| "PLAYBACK_AUDIO_DOWNLOAD_FAILED")?;
        if response.status().is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|h| h.to_str().ok())
                .ok_or("PLAYBACK_AUDIO_DOWNLOAD_FAILED")?;
            url = validate_url(
                url.join(location)
                    .map_err(|_| "PLAYBACK_AUDIO_URL_INVALID")?
                    .as_str(),
            )?;
            continue;
        }
        if !response.status().is_success() {
            return Err("PLAYBACK_AUDIO_DOWNLOAD_FAILED".into());
        }
        received = Some(response);
        break;
    }
    let mut response = received.ok_or("PLAYBACK_AUDIO_DOWNLOAD_FAILED")?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_AUDIO_BYTES as u64)
    {
        return Err("PLAYBACK_AUDIO_TOO_LARGE".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "PLAYBACK_AUDIO_DOWNLOAD_FAILED")?
    {
        if bytes.len() + chunk.len() > MAX_AUDIO_BYTES {
            return Err("PLAYBACK_AUDIO_TOO_LARGE".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.is_empty() {
        return Err("PLAYBACK_AUDIO_DOWNLOAD_FAILED".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_https_netease_music_links() {
        assert!(validate_url("https://m801.music.126.net/audio.mp3?token=test").is_ok());
        for value in [
            "http://m801.music.126.net/audio.mp3",
            "https://127.0.0.1/audio.mp3",
            "https://m801.music.126.net.evil.test/audio.mp3",
            "https://u:p@m801.music.126.net/audio.mp3",
            "https://m801.music.126.net:8443/audio.mp3",
            "https://music.126.net/audio.mp3",
            "https://a.b.music.126.net/audio.mp3",
            "https://m801.music.126.net/audio.mp3#fragment",
            "https://bucket.oss-cn-hangzhou.aliyuncs.com/music/song.mp3",
        ] {
            assert!(validate_url(value).is_err(), "unexpectedly accepted URL");
        }
    }
}
