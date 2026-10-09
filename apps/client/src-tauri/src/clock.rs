use std::collections::VecDeque;
#[derive(Default)]
pub struct Clock {
    samples: VecDeque<(f64, f64)>,
}
impl Clock {
    pub fn sample(
        &mut self,
        sent: f64,
        received_server: f64,
        sent_server: f64,
        received: f64,
    ) -> bool {
        let rtt = received - sent - (sent_server - received_server);
        if !rtt.is_finite() || !(0.0..=2000.0).contains(&rtt) || received_server > sent_server {
            return false;
        }
        let offset = ((received_server - sent) + (sent_server - received)) / 2.0;
        if !offset.is_finite() {
            return false;
        }
        self.samples.push_back((rtt, offset));
        if self.samples.len() > 20 {
            self.samples.pop_front();
        }
        true
    }
    pub fn offset(&self) -> f64 {
        let mut samples: Vec<_> = self.samples.iter().copied().collect();
        samples.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut offsets: Vec<_> = samples.iter().take(5).map(|s| s.1).collect();
        offsets.sort_by(f64::total_cmp);
        offsets.get(offsets.len() / 2).copied().unwrap_or(0.0)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_and_uses_low_latency_samples() {
        let mut c = Clock::default();
        assert!(!c.sample(100., 90., 80., 110.));
        assert!(c.sample(100., 155., 155., 110.));
        assert_eq!(c.offset(), 50.);
        c.sample(200., 800., 800., 1000.);
        assert_eq!(c.offset(), 200.);
    }
}
