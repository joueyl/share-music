use crate::model::AudioSpec;
use std::collections::BTreeMap;
pub struct Pcm {
    pub spec: AudioSpec,
    pub position_ms: u64,
    pub samples: Vec<i32>,
}
impl Pcm {
    pub fn duration_ms(&self) -> u64 {
        self.samples.len() as u64 * 1000 / self.spec.channels as u64 / self.spec.sample_rate as u64
    }
}
#[derive(Default)]
pub struct Buffer {
    blocks: BTreeMap<u64, Pcm>,
    bytes: usize,
}
impl Buffer {
    pub fn push(&mut self, pcm: Pcm) -> Result<(), String> {
        let bytes = pcm.samples.len() * 4;
        if self.bytes + bytes > 16 * 1024 * 1024 {
            return Err("BUFFER_FULL".into());
        }
        if let Some(old) = self.blocks.insert(pcm.position_ms, pcm) {
            self.bytes -= old.samples.len() * 4;
        }
        self.bytes += bytes;
        Ok(())
    }
    pub fn contiguous_ms(&self, position: u64) -> u64 {
        let mut end = position;
        for p in self.blocks.values() {
            if p.position_ms > end + 2 {
                break;
            }
            if p.position_ms + p.duration_ms() >= end {
                end = p.position_ms + p.duration_ms();
            }
        }
        end.saturating_sub(position)
    }
    pub fn pop_at(&mut self, position: u64) -> Option<Pcm> {
        let key = self
            .blocks
            .range(..=position + 2)
            .next_back()
            .map(|(k, _)| *k)?;
        let mut pcm = self.blocks.remove(&key)?;
        self.bytes -= pcm.samples.len() * 4;
        if position >= pcm.position_ms + pcm.duration_ms() {
            return self.pop_at(position);
        }
        let skip = ((position.saturating_sub(pcm.position_ms) * pcm.spec.sample_rate as u64 / 1000)
            as usize)
            * pcm.spec.channels as usize;
        if skip > 0 {
            pcm.samples.drain(..skip.min(pcm.samples.len()));
            pcm.position_ms = position;
        }
        Some(pcm)
    }
    pub fn discard_before(&mut self, position: u64) {
        let expired: Vec<_> = self
            .blocks
            .iter()
            .filter(|(_, p)| p.position_ms + p.duration_ms() < position)
            .map(|(key, _)| *key)
            .collect();
        for key in expired {
            if let Some(p) = self.blocks.remove(&key) {
                self.bytes -= p.samples.len() * 4;
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pcm(at: u64) -> Pcm {
        Pcm {
            spec: AudioSpec {
                sample_rate: 48000,
                bits: 16,
                channels: 2,
            },
            position_ms: at,
            samples: vec![0; 9600],
        }
    }
    #[test]
    fn gap_is_not_reported_as_playable() {
        let mut b = Buffer::default();
        b.push(pcm(0)).unwrap();
        b.push(pcm(200)).unwrap();
        assert_eq!(b.contiguous_ms(0), 100);
        b.push(pcm(100)).unwrap();
        assert_eq!(b.contiguous_ms(0), 300);
    }
    #[test]
    fn late_join_trims_whole_frames() {
        let mut b = Buffer::default();
        b.push(pcm(0)).unwrap();
        let p = b.pop_at(50).unwrap();
        assert_eq!(p.samples.len(), 4800);
        assert_eq!(p.duration_ms(), 50);
    }
}
