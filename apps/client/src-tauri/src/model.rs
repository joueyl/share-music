use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpec {
    pub sample_rate: u32,
    pub bits: u8,
    pub channels: u8,
}
impl AudioSpec {
    pub fn validate(&self) -> Result<(), String> {
        if self.channels != 2
            || ![16, 24].contains(&self.bits)
            || ![44100, 48000, 88200, 96000].contains(&self.sample_rate)
        {
            return Err("UNSUPPORTED_AUDIO_SPEC".into());
        }
        Ok(())
    }
    pub fn pcm_bps(&self) -> u64 {
        self.sample_rate as u64 * self.bits as u64 * self.channels as u64
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playback {
    pub source_id: Option<String>,
    pub source_epoch: u64,
    pub source_type: Option<String>,
    pub play_state: String,
    pub position_ms: u64,
    pub effective_at_server_ms: u64,
    pub provider_id: Option<String>,
    pub quality_mode: String,
    pub spec: Option<AudioSpec>,
    pub bitrate_bps: u64,
    pub instant: bool,
}
impl Playback {
    pub fn position(&self, server_now: u64) -> u64 {
        self.position_ms
            + if self.play_state == "playing" {
                server_now.saturating_sub(self.effective_at_server_ms)
            } else {
                0
            }
    }
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
