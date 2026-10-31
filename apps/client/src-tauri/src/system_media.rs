use serde::{Deserialize, Serialize};
pub mod artwork;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub room_id: Option<String>,
    pub track_id: Option<String>,
    pub source_epoch: u64,
    pub title: String,
    pub playback: Playback,
    pub duration_ms: u64,
    pub position_ms: u64,
    pub can_control: bool,
    pub can_seek: bool,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Playback {
    Playing,
    Paused,
    #[default]
    Stopped,
}
impl Snapshot {
    pub fn validate(&mut self) -> Result<(), String> {
        if self.title.chars().count() > 200
            || self.duration_ms > 86_400_000
            || self
                .room_id
                .as_ref()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
            || self
                .track_id
                .as_ref()
                .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
        {
            return Err("SYSTEM_MEDIA_STATE_INVALID".into());
        }
        self.position_ms = self.position_ms.min(self.duration_ms.saturating_sub(1));
        if self.room_id.is_none() || self.track_id.is_none() {
            self.can_control = false;
            self.can_seek = false;
            self.playback = Playback::Stopped;
        }
        Ok(())
    }
    pub fn event(&self, action: &str, position_ms: Option<u64>) -> Option<ControlEvent> {
        if ![
            "play", "pause", "toggle", "next", "previous", "stop", "seek",
        ]
        .contains(&action)
        {
            return None;
        }
        if self.duration_ms == 0
            || if action == "seek" {
                !self.can_seek
            } else {
                !self.can_control
            }
        {
            return None;
        }
        Some(ControlEvent {
            action: action.into(),
            room_id: self.room_id.clone()?,
            track_id: self.track_id.clone()?,
            source_epoch: self.source_epoch,
            position_ms,
        })
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlEvent {
    pub action: String,
    pub room_id: String,
    pub track_id: String,
    pub source_epoch: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
}

#[cfg(feature = "desktop")]
mod runtime;
#[cfg(feature = "desktop")]
pub use runtime::{initialize, shutdown, update, update_artwork};

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_identity_and_disables_controls_without_a_track() {
        let mut s = Snapshot {
            can_control: true,
            can_seek: true,
            playback: Playback::Playing,
            ..Default::default()
        };
        s.validate().unwrap();
        assert!(!s.can_control);
        assert_eq!(s.playback, Playback::Stopped);
        assert!(s.event("toggle", None).is_none());
        s.room_id = Some("invalid".into());
        assert!(s.validate().is_err());
    }
    #[test]
    fn native_events_keep_room_epoch_and_permissions() {
        let mut s = Snapshot {
            room_id: Some(uuid::Uuid::new_v4().to_string()),
            track_id: Some(uuid::Uuid::new_v4().to_string()),
            source_epoch: 7,
            duration_ms: 1000,
            position_ms: 9999,
            can_seek: true,
            ..Default::default()
        };
        s.validate().unwrap();
        assert_eq!(s.position_ms, 999);
        assert!(s.event("toggle", None).is_none());
        assert_eq!(s.event("seek", Some(10)).unwrap().source_epoch, 7);
        s.can_control = true;
        assert!(s.event("pause", None).is_some());
    }
}
