use crate::model::AudioSpec;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
pub const HEADER: usize = 76;
pub const MAX_MESSAGE: usize = 16384;
pub const MAX_BLOCK: usize = 256 * 1024;
#[derive(Debug, Clone)]
pub struct Block {
    pub codec: u8,
    pub spec: AudioSpec,
    pub epoch: u64,
    pub sequence: u64,
    pub position_ms: u64,
    pub data: Vec<u8>,
}
impl Block {
    pub fn fragments(&self, max_message: usize) -> Result<Vec<Vec<u8>>, String> {
        self.spec.validate()?;
        let size = max_message
            .min(MAX_MESSAGE)
            .checked_sub(HEADER)
            .filter(|n| *n > 0)
            .ok_or("MESSAGE_LIMIT_TOO_SMALL")?;
        if self.data.is_empty() || self.data.len() > MAX_BLOCK || ![1, 2].contains(&self.codec) {
            return Err("INVALID_BLOCK".into());
        }
        let count = self.data.len().div_ceil(size);
        if count > 256 {
            return Err("TOO_MANY_FRAGMENTS".into());
        }
        let hash = Sha256::digest(&self.data);
        Ok(self
            .data
            .chunks(size)
            .enumerate()
            .map(|(i, data)| {
                let mut out = Vec::with_capacity(HEADER + data.len());
                out.extend(b"MSA1");
                out.extend([1, self.codec, self.spec.bits, self.spec.channels]);
                out.extend(self.spec.sample_rate.to_be_bytes());
                out.extend(self.epoch.to_be_bytes());
                out.extend(self.sequence.to_be_bytes());
                out.extend(self.position_ms.to_be_bytes());
                out.extend((i as u16).to_be_bytes());
                out.extend((count as u16).to_be_bytes());
                out.extend((self.data.len() as u32).to_be_bytes());
                out.extend(hash);
                out.extend(data);
                out
            })
            .collect())
    }
}
struct Partial {
    block: Block,
    hash: [u8; 32],
    total: usize,
    fragments: Vec<Option<Vec<u8>>>,
    created: u64,
}
#[derive(Default)]
pub struct Reassembler {
    blocks: BTreeMap<u64, Partial>,
}
impl Reassembler {
    pub fn push(&mut self, data: &[u8], epoch: u64, now: u64) -> Result<Option<Block>, String> {
        self.blocks
            .retain(|_, p| now.saturating_sub(p.created) <= 5000);
        if data.len() <= HEADER || data.len() > MAX_MESSAGE || &data[..4] != b"MSA1" || data[4] != 1
        {
            return Err("INVALID_PACKET".into());
        }
        let spec = AudioSpec {
            sample_rate: u32::from_be_bytes(data[8..12].try_into().unwrap()),
            bits: data[6],
            channels: data[7],
        };
        spec.validate()?;
        let wire_epoch = u64::from_be_bytes(data[12..20].try_into().unwrap());
        if wire_epoch != epoch {
            return Ok(None);
        }
        let seq = u64::from_be_bytes(data[20..28].try_into().unwrap());
        let pts = u64::from_be_bytes(data[28..36].try_into().unwrap());
        let index = u16::from_be_bytes(data[36..38].try_into().unwrap()) as usize;
        let count = u16::from_be_bytes(data[38..40].try_into().unwrap()) as usize;
        let total = u32::from_be_bytes(data[40..44].try_into().unwrap()) as usize;
        let hash: [u8; 32] = data[44..76].try_into().unwrap();
        if count == 0
            || count > 256
            || index >= count
            || total == 0
            || total > MAX_BLOCK
            || ![1, 2].contains(&data[5])
        {
            return Err("INVALID_PACKET".into());
        }
        if !self.blocks.contains_key(&seq) && self.blocks.len() >= 64 {
            return Err("REASSEMBLY_LIMIT".into());
        }
        let p = self.blocks.entry(seq).or_insert_with(|| Partial {
            block: Block {
                codec: data[5],
                spec,
                epoch,
                sequence: seq,
                position_ms: pts,
                data: Vec::new(),
            },
            hash,
            total,
            fragments: vec![None; count],
            created: now,
        });
        if p.hash != hash
            || p.total != total
            || p.fragments.len() != count
            || p.block.spec != spec
            || p.block.position_ms != pts
            || p.block.codec != data[5]
        {
            return Err("FRAGMENT_MISMATCH".into());
        }
        if let Some(existing) = &p.fragments[index] {
            if existing != &data[HEADER..] {
                return Err("FRAGMENT_MISMATCH".into());
            }
        } else {
            p.fragments[index] = Some(data[HEADER..].to_vec());
        }
        if p.fragments.iter().all(Option::is_some) {
            let mut p = self.blocks.remove(&seq).unwrap();
            p.block.data = p.fragments.into_iter().flat_map(|f| f.unwrap()).collect();
            if p.block.data.len() != p.total || Sha256::digest(&p.block.data)[..] != p.hash {
                return Err("BLOCK_CHECKSUM_FAILED".into());
            }
            return Ok(Some(p.block));
        }
        Ok(None)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn block() -> Block {
        Block {
            codec: 1,
            spec: AudioSpec {
                sample_rate: 48000,
                bits: 24,
                channels: 2,
            },
            epoch: 7,
            sequence: 2,
            position_ms: 100,
            data: vec![42; 32000],
        }
    }
    #[test]
    fn reordered_fragments_round_trip() {
        let b = block();
        let mut r = Reassembler::default();
        let mut result = None;
        for f in b.fragments(MAX_MESSAGE).unwrap().iter().rev() {
            result = r.push(f, 7, 0).unwrap().or(result);
        }
        assert_eq!(result.unwrap().data, b.data);
    }
    #[test]
    fn rejects_corruption_and_ignores_old_epoch() {
        let mut fs = block().fragments(MAX_MESSAGE).unwrap();
        let mut r = Reassembler::default();
        assert!(r.push(&fs[0], 8, 0).unwrap().is_none());
        fs[0][HEADER] ^= 1;
        let mut err = false;
        for f in fs {
            err |= r.push(&f, 7, 0).is_err();
        }
        assert!(err);
    }
    #[test]
    fn malformed_and_oversize_are_rejected() {
        assert!(Reassembler::default().push(&[0; 10], 7, 0).is_err());
        assert!(block().fragments(HEADER).is_err());
        let mut b = block();
        b.data = vec![0; MAX_BLOCK + 1];
        assert!(b.fragments(MAX_MESSAGE).is_err());
    }
}
