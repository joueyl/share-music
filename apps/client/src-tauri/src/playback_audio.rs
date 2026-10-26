const MAX_AUDIO_BYTES: usize = 100 * 1024 * 1024;

pub fn validate_url(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "PLAYBACK_AUDIO_URL_INVALID")?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !host.ends_with(".aliyuncs.com")
        || !host.contains(".oss-")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || !url.path().starts_with("/music/")
        || url.fragment().is_some()
    {
        return Err("PLAYBACK_AUDIO_URL_INVALID".into());
    }
    Ok(url)
}

/// Download the actual song, not waveform data. Signed URLs and provider errors
/// must never be included in returned errors or logs.
pub async fn download(http: &reqwest::Client, value: &str) -> Result<Vec<u8>, String> {
    let url = validate_url(value)?;
    let mut response = http
        .get(url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|_| "PLAYBACK_AUDIO_DOWNLOAD_FAILED")?;
    if !response.status().is_success() {
        return Err("PLAYBACK_AUDIO_DOWNLOAD_FAILED".into());
    }
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
    fn accepts_only_https_oss_music_objects() {
        assert!(validate_url(
            "https://bucket.oss-cn-hangzhou.aliyuncs.com/music/files/song.mp3?x-oss-signature=test"
        )
        .is_ok());
        assert!(
            validate_url("https://ap.oss-cn-hangzhou.oss-accesspoint.aliyuncs.com/music/song")
                .is_ok()
        );
        for value in [
            "http://bucket.oss-cn-hangzhou.aliyuncs.com/music/a",
            "https://127.0.0.1/music/a",
            "https://bucket.oss-cn-hangzhou.aliyuncs.com.evil.test/music/a",
            "https://u:p@bucket.oss-cn-hangzhou.aliyuncs.com/music/a",
            "https://bucket.oss-cn-hangzhou.aliyuncs.com:8443/music/a",
            "https://bucket.oss-cn-hangzhou.aliyuncs.com/private/a",
            "https://bucket.oss-cn-hangzhou.aliyuncs.com/music/../private/a",
        ] {
            assert!(validate_url(value).is_err());
        }
    }
}
