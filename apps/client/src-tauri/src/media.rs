use crate::{
    buffer::Buffer,
    model::{now_ms, Playback},
    native::{Capture, File, Native, Output, Peer},
    packet::{Block, Reassembler, MAX_MESSAGE},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    path::PathBuf,
    sync::{mpsc, Arc},
    thread,
    time::Duration,
};
pub enum Input {
    Snapshot(Value),
    Signal {
        peer: String,
        epoch: u64,
        data: Value,
    },
    Admission(Value),
    Imported(String, PathBuf),
    IceServers(Vec<String>),
    Device(String),
    Volume(f32),
    Clock(f64),
    Stop,
    Shutdown,
}
#[derive(Debug)]
pub enum Event {
    Control(Value),
    Status(Value),
}
struct Link {
    peer: Peer,
    open: bool,
    next_sequence: u64,
    reassembler: Reassembler,
    created_at: u64,
    tried_relay: bool,
    probe_sent: bool,
    probe_started: u64,
    probe_received: u64,
    probe_first: u64,
    capacity_bps: u64,
    lease_id: Option<String>,
    remote_offer: Option<String>,
}
impl Link {
    fn new(peer: Peer, next: u64, relay: bool) -> Self {
        Self {
            peer,
            open: false,
            next_sequence: next,
            reassembler: Reassembler::default(),
            created_at: now_ms(),
            tried_relay: relay,
            probe_sent: false,
            probe_started: 0,
            probe_received: 0,
            probe_first: 0,
            capacity_bps: 0,
            lease_id: None,
            remote_offer: None,
        }
    }
}
struct Pipeline {
    playback: Playback,
    room_id: String,
    transition_id: Option<String>,
    ready_sent: bool,
    peers: HashMap<String, Link>,
    decoder: Option<File>,
    capture: Option<Capture>,
    buffer: Buffer,
    cache: VecDeque<Block>,
    cache_bytes: usize,
    sequence: u64,
    next_position: u64,
    eof: bool,
    is_provider: bool,
    receiving_bytes: u64,
    receive_since: u64,
    admitted: bool,
    admission_requested: bool,
    duration_ms: Option<u64>,
    produced_frames: u64,
    origin_position: u64,
    capture_pending: Vec<i32>,
}
pub struct Media {
    input: mpsc::SyncSender<Input>,
}
impl Media {
    pub fn start(
        native: Option<Arc<Native>>,
        user_id: String,
        events: tokio::sync::mpsc::Sender<Event>,
    ) -> Self {
        let (tx, rx) = mpsc::sync_channel(64);
        thread::spawn(move || Worker::new(native, user_id, events).run(rx));
        Self { input: tx }
    }
    pub fn send(&self, message: Input) -> Result<(), String> {
        self.input
            .try_send(message)
            .map_err(|_| "MEDIA_COMMAND_BACKPRESSURE".into())
    }
}
struct Worker {
    native: Option<Arc<Native>>,
    user: String,
    events: tokio::sync::mpsc::Sender<Event>,
    files: HashMap<String, PathBuf>,
    device: String,
    volume: f32,
    offset: f64,
    pipelines: BTreeMap<u64, Pipeline>,
    active: Option<u64>,
    output: Option<Output>,
    output_position: u64,
    snapshot: Option<Value>,
    admissions: HashMap<String, (u64, String, bool)>,
    last_status: u64,
    ice: Vec<String>,
}
impl Worker {
    fn new(
        native: Option<Arc<Native>>,
        user: String,
        events: tokio::sync::mpsc::Sender<Event>,
    ) -> Self {
        Self {
            native,
            user,
            events,
            files: HashMap::new(),
            device: "default".into(),
            volume: 1.,
            offset: 0.,
            pipelines: BTreeMap::new(),
            active: None,
            output: None,
            output_position: 0,
            snapshot: None,
            admissions: HashMap::new(),
            last_status: 0,
            ice: Vec::new(),
        }
    }
    fn event(&self, event: Event) {
        match event {
            Event::Control(value) => {
                let _ = self.events.blocking_send(Event::Control(value));
            }
            event => {
                let _ = self.events.try_send(event);
            }
        }
    }
    fn control(&self, value: Value) {
        self.event(Event::Control(value));
    }
    fn status(&self, status: &str, detail: &str, buffered: u64, drift: i64, bps: u64) {
        self.event(Event::Status(json!({"status":status,"detail":detail,"bufferedMs":buffered,"driftMs":drift,"receiveBps":bps})));
    }
    fn server_now(&self) -> u64 {
        (now_ms() as f64 + self.offset).max(0.) as u64
    }
    fn stop(&mut self) {
        // A late signal must not rebuild pipelines from the room we just left.
        self.snapshot = None;
        self.output = None;
        self.output_position = 0;
        self.active = None;
        self.pipelines.clear();
        self.admissions.clear();
        self.status("idle", "尚未播放", 0, 0, 0);
    }
    fn run(mut self, rx: mpsc::Receiver<Input>) {
        loop {
            match rx.recv_timeout(Duration::from_millis(5)) {
                Ok(Input::Shutdown) => break,
                Ok(input) => {
                    let fatal = matches!(&input, Input::Snapshot(_));
                    if let Err(e) = self.handle(input) {
                        self.status("error", &e, 0, 0, 0);
                        if fatal {
                            self.report_source_failure();
                        }
                    }
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if let Err(e) = self.pump() {
                self.output = None;
                self.status("error", &e, 0, 0, 0);
                self.report_source_failure();
                self.pipelines.clear();
                self.active = None;
            }
        }
    }
    fn handle(&mut self, input: Input) -> Result<(), String> {
        match input {
            Input::Imported(id, path) => {
                self.files.insert(id, path);
            }
            Input::IceServers(ice) => self.ice = ice,
            Input::Device(id) => self.device = id,
            Input::Volume(v) => {
                let volume = v.clamp(0., 1.);
                if (self.volume == 0.0) != (volume == 0.0) {
                    // Drop queued sound on mute and reopen at the room position on unmute.
                    self.output = None;
                }
                self.volume = volume;
            }
            Input::Clock(offset) => self.offset = offset,
            Input::Stop => self.stop(),
            Input::Shutdown => {}
            Input::Snapshot(value) => {
                self.snapshot = Some(value);
                self.reconcile()?;
            }
            Input::Signal { peer, epoch, data } => {
                if !self.pipelines.contains_key(&epoch) {
                    self.reconcile()?;
                }
                let native = self.native.as_ref().ok_or("原生媒体库未就绪")?;
                if let Some(p) = self.pipelines.get_mut(&epoch) {
                    if !p.peers.contains_key(&peer) {
                        let source_id = p.playback.provider_id.as_deref().unwrap_or("");
                        if !p.is_provider && peer != source_id {
                            return Err("UNAUTHORIZED_MEDIA_PEER".into());
                        }
                        p.peers.insert(
                            peer.clone(),
                            Link::new(native.peer(&self.ice, false)?, 0, false),
                        );
                    }
                    let link = p.peers.get_mut(&peer).unwrap();
                    if data["kind"] == "description" && data["descriptionType"] == "offer" {
                        let offer = data["sdp"].as_str().unwrap_or("").to_owned();
                        if link
                            .remote_offer
                            .as_ref()
                            .is_some_and(|previous| previous != &offer)
                        {
                            *link = Link::new(native.peer(&self.ice, false)?, 0, false);
                        }
                        link.remote_offer = Some(offer);
                    }
                    link.peer.remote(&data)?;
                }
            }
            Input::Admission(value) => {
                let request = value["requestId"].as_str().unwrap_or("");
                if let Some((epoch, peer, relay)) = self.admissions.remove(request) {
                    if value["ok"] != true {
                        return Err(value["error"].as_str().unwrap_or("ADMISSION_FAILED").into());
                    }
                    let native = self.native.as_ref().ok_or("原生媒体库未就绪")?;
                    let ice: Vec<String> = value["iceServers"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .filter_map(|v| v.as_str().map(str::to_owned))
                                .collect()
                        })
                        .unwrap_or_default();
                    if let Some(p) = self.pipelines.get_mut(&epoch) {
                        if !relay {
                            p.admitted = true;
                        }
                        if relay || !p.peers.contains_key(&peer) {
                            let mut link = Link::new(
                                native.peer(&ice, p.is_provider)?,
                                p.cache.front().map_or(0, |b| b.sequence),
                                relay,
                            );
                            link.lease_id = value["leaseId"].as_str().map(str::to_owned);
                            p.peers.insert(peer, link);
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn report_source_failure(&self) {
        if let Some(snapshot) = &self.snapshot {
            let source = if snapshot["pending"].is_object() {
                &snapshot["pending"]["playback"]
            } else {
                &snapshot["playback"]
            };
            if source["providerId"].as_str() == Some(self.user.as_str())
                && source["sourceId"].is_string()
            {
                self.control(json!({"type":"sourceFailed","roomId":snapshot["id"],"sourceEpoch":source["sourceEpoch"]}));
            }
        }
    }
    fn reconcile(&mut self) -> Result<(), String> {
        let Some(snapshot) = self.snapshot.clone() else {
            return Ok(());
        };
        let Some(native) = self.native.clone() else {
            if snapshot["playback"]["sourceId"].is_string() || snapshot["pending"].is_object() {
                self.status("unavailable", "缺少原生媒体库，尚未开始音频播放", 0, 0, 0);
            }
            return Ok(());
        };
        let active: Playback =
            serde_json::from_value(snapshot["playback"].clone()).map_err(|e| e.to_string())?;
        let mut required = Vec::new();
        if active.source_id.is_some() {
            required.push((active.clone(), None));
        }
        if snapshot["pending"].is_object() {
            let pending: Playback = serde_json::from_value(snapshot["pending"]["playback"].clone())
                .map_err(|e| e.to_string())?;
            required.push((
                pending,
                snapshot["pending"]["id"].as_str().map(str::to_owned),
            ));
        }
        let epochs: Vec<_> = required.iter().map(|(p, _)| p.source_epoch).collect();
        self.pipelines.retain(|e, _| epochs.contains(e));
        for (playback, transition_id) in required {
            if let Some(existing) = self.pipelines.get_mut(&playback.source_epoch) {
                existing.playback = playback.clone();
                existing.transition_id = transition_id;
                continue;
            }
            let provider = playback.provider_id.as_deref() == Some(self.user.as_str());
            let spec = playback.spec.ok_or("NO_AUDIO_SPEC")?;
            spec.validate()?;
            let mut decoder = None;
            let mut capture = None;
            if provider {
                if playback.source_type.as_deref() == Some("file") {
                    let id = playback.source_id.as_ref().unwrap();
                    let path = self
                        .files
                        .get(id)
                        .ok_or("本地音源未加载；重新导入文件后再播放")?;
                    let (mut file, _) = native.open_file(path)?;
                    file.seek(playback.position_ms)?;
                    decoder = Some(file);
                } else if playback.source_type.as_deref() == Some("live") {
                    capture = Some(native.capture(&self.device, spec)?);
                    self.output = None;
                }
            }
            let mut p = Pipeline {
                playback: playback.clone(),
                room_id: snapshot["id"].as_str().unwrap_or("").into(),
                transition_id,
                ready_sent: false,
                peers: HashMap::new(),
                decoder,
                capture,
                buffer: Buffer::default(),
                cache: VecDeque::new(),
                cache_bytes: 0,
                sequence: 0,
                next_position: playback.position_ms,
                eof: false,
                is_provider: provider,
                receiving_bytes: 0,
                receive_since: now_ms(),
                admitted: provider,
                admission_requested: false,
                duration_ms: snapshot["playlist"]
                    .as_array()
                    .and_then(|items| {
                        items
                            .iter()
                            .find(|t| t["id"].as_str() == playback.source_id.as_deref())
                    })
                    .and_then(|t| t["durationMs"].as_u64()),
                produced_frames: 0,
                origin_position: playback.position_ms,
                capture_pending: Vec::new(),
            };
            if provider {
                if let Some(members) = snapshot["members"].as_array() {
                    for m in members {
                        if m["online"] == true {
                            let id = m["id"].as_str().unwrap_or("");
                            if id != self.user {
                                p.peers.insert(
                                    id.into(),
                                    Link::new(native.peer(&self.ice, true)?, 0, false),
                                );
                            }
                        }
                    }
                }
            }
            self.pipelines.insert(playback.source_epoch, p);
        }
        // Create offers for newly joined peers even if the current source is unchanged.
        for p in self.pipelines.values_mut() {
            if p.is_provider {
                if let Some(members) = snapshot["members"].as_array() {
                    p.peers.retain(|id, _| {
                        members
                            .iter()
                            .any(|m| m["id"].as_str() == Some(id) && m["online"] == true)
                    });
                    for m in members {
                        let id = m["id"].as_str().unwrap_or("");
                        if m["online"] == true && id != self.user && !p.peers.contains_key(id) {
                            p.peers.insert(
                                id.into(),
                                Link::new(
                                    native.peer(&self.ice, true)?,
                                    p.cache.front().map_or(p.sequence, |b| b.sequence),
                                    false,
                                ),
                            );
                        }
                    }
                }
            }
        }
        if active.source_id.is_none() {
            self.output = None;
            self.active = None;
        } else if active.effective_at_server_ms <= self.server_now()
            && self.active != Some(active.source_epoch)
        {
            self.active = Some(active.source_epoch);
            self.output = None;
            self.output_position = active.position(self.server_now());
        }
        Ok(())
    }
    fn pump(&mut self) -> Result<(), String> {
        let Some(native) = self.native.clone() else {
            return Ok(());
        };
        let server_now = self.server_now();
        let local_now = now_ms();
        let mut controls = vec![];
        let pending = self
            .snapshot
            .as_ref()
            .and_then(|s| s.get("pending"))
            .cloned();
        if let Some(pending) = pending {
            if pending["committed"] == true
                && pending["playback"]["effectiveAtServerMs"]
                    .as_u64()
                    .unwrap_or(u64::MAX)
                    <= server_now
            {
                let epoch = pending["playback"]["sourceEpoch"].as_u64();
                if self.active != epoch {
                    self.active = epoch;
                    self.output = None;
                    if let Some(p) = epoch.and_then(|e| self.pipelines.get(&e)) {
                        self.output_position = p.playback.position(server_now);
                    }
                }
            }
        }
        if self.active.is_none() {
            if let Some(s) = &self.snapshot {
                let playback: Playback =
                    serde_json::from_value(s["playback"].clone()).map_err(|e| e.to_string())?;
                if playback.source_id.is_some() && playback.effective_at_server_ms <= server_now {
                    self.active = Some(playback.source_epoch);
                    self.output_position = playback.position(server_now);
                }
            }
        }
        let epochs: Vec<_> = self.pipelines.keys().copied().collect();
        for epoch in epochs {
            let p = self.pipelines.get_mut(&epoch).unwrap();
            for (peer_id, link) in p.peers.iter_mut() {
                for _ in 0..128 {
                    let Some(event) = link.peer.poll()? else {
                        break;
                    };
                    if event.is_empty() {
                        continue;
                    }
                    if event[0] == 1 {
                        let event: Value =
                            serde_json::from_slice(&event[1..]).map_err(|e| e.to_string())?;
                        match event["kind"].as_str(){
       Some("description")|Some("candidate")=>controls.push(json!({"type":"signal","roomId":p.room_id,"toId":peer_id,"sourceEpoch":epoch,"data":event})),
       Some("open")=>link.open=true,
       Some("closed")|Some("failed")=>link.open=false,
       _=>{},
      }
                    } else if event[0] == 2 {
                        let bytes = &event[1..];
                        if bytes.starts_with(b"MSP1") && bytes.len() == 8200 && !p.is_provider {
                            if link.probe_first == 0 {
                                link.probe_first = local_now;
                            }
                            link.probe_received += 8192;
                            if bytes[4..6] == 31u16.to_be_bytes() {
                                let capacity = link.probe_received * 8000
                                    / local_now.saturating_sub(link.probe_first).max(1);
                                let mut ack = b"MSR1".to_vec();
                                ack.extend(capacity.to_be_bytes());
                                let _ = link.peer.send(&ack, false)?;
                            }
                            continue;
                        }
                        if bytes.starts_with(b"MSR1") && bytes.len() == 12 && p.is_provider {
                            let remote = u64::from_be_bytes(bytes[4..12].try_into().unwrap());
                            let upload =
                                262144 * 8000 / local_now.saturating_sub(link.probe_started).max(1);
                            let capacity = remote.min(upload);
                            link.capacity_bps = capacity;
                            let mut ack = b"MSC1".to_vec();
                            ack.extend(capacity.to_be_bytes());
                            let _ = link.peer.send(&ack, false)?;
                            continue;
                        }
                        if bytes.starts_with(b"MSC1") && bytes.len() == 12 && !p.is_provider {
                            link.capacity_bps =
                                u64::from_be_bytes(bytes[4..12].try_into().unwrap());
                            continue;
                        }
                        if p.is_provider {
                            continue;
                        }
                        p.receiving_bytes += event.len() as u64;
                        if let Some(block) = link.reassembler.push(&event[1..], epoch, local_now)? {
                            if block.spec != p.playback.spec.unwrap()
                                || block.codec
                                    != if p.playback.quality_mode == "opus" {
                                        2
                                    } else {
                                        1
                                    }
                            {
                                return Err("UNAUTHORIZED_AUDIO_FORMAT".into());
                            }
                            let pcm = native.decode(
                                &block.data,
                                block.codec,
                                block.spec,
                                block.position_ms,
                            )?;
                            if block.position_ms + pcm.duration_ms() + 5000
                                < p.playback.position(server_now)
                            {
                                continue;
                            }
                            p.buffer.push(pcm)?;
                        }
                    }
                }
                if link.open && p.is_provider && !link.probe_sent {
                    link.probe_sent = true;
                    link.probe_started = local_now;
                    for i in 0..32u16 {
                        let mut packet = b"MSP1".to_vec();
                        packet.extend(i.to_be_bytes());
                        packet.extend(32u16.to_be_bytes());
                        packet.resize(8200, 0);
                        if !link.peer.send(&packet, false)? {
                            return Err("PROBE_BACKPRESSURE".into());
                        }
                    }
                }
                if link.tried_relay
                    && link.lease_id.is_some()
                    && local_now.saturating_sub(link.created_at) > 45000
                    && p.is_provider
                {
                    link.created_at = local_now;
                    let request = uuid::Uuid::new_v4().to_string();
                    self.admissions
                        .insert(request.clone(), (epoch, peer_id.clone(), true));
                    controls.push(json!({"type":"admission","requestId":request,"roomId":p.room_id,"sourceEpoch":epoch,"relay":true,"peerId":peer_id,"leaseId":link.lease_id,"receiveBps":0,"sourceUploadBps":0}));
                }
                if !link.open
                    && local_now.saturating_sub(link.created_at) > 7000
                    && !link.tried_relay
                    && p.is_provider
                {
                    link.tried_relay = true;
                    let request = uuid::Uuid::new_v4().to_string();
                    self.admissions
                        .insert(request.clone(), (epoch, peer_id.clone(), true));

                    controls.push(json!({"type":"admission","requestId":request,"roomId":p.room_id,"sourceEpoch":epoch,"relay":true,"peerId":peer_id,"receiveBps":0,"sourceUploadBps":0}));
                }
            }
            let cursor = if self.active == Some(epoch) {
                p.playback.position(server_now)
            } else {
                p.playback.position_ms
            };
            if p.is_provider && !p.eof {
                // File decoding is paced by the playback cursor; captures always drain to avoid device overflow.
                let live = p.capture.is_some();
                if live || p.next_position < cursor + 5000 {
                    for _ in 0..if live { 8 } else { 2 } {
                        let pcm = if let Some(decoder) = &mut p.decoder {
                            decoder.read()?
                        } else if let Some(capture) = &mut p.capture {
                            let spec = p.playback.spec.unwrap();
                            let target = spec.sample_rate as usize / 10 * 2;
                            if p.capture_pending.len() < target {
                                for _ in 0..8 {
                                    if let Some(pcm) = capture.read()? {
                                        if pcm.spec != spec {
                                            return Err("CAPTURE_SPEC_MISMATCH".into());
                                        }
                                        p.capture_pending.extend(pcm.samples);
                                        if p.capture_pending.len() >= target {
                                            break;
                                        }
                                    } else {
                                        break;
                                    }
                                }
                            }
                            if p.capture_pending.len() >= target {
                                Some(crate::buffer::Pcm {
                                    spec,
                                    position_ms: 0,
                                    samples: p.capture_pending.drain(..target).collect(),
                                })
                            } else {
                                None
                            }
                        } else {
                            None
                        };
                        let Some(mut pcm) = pcm else {
                            if !live {
                                p.eof = true;
                            }
                            break;
                        };
                        if pcm.spec != p.playback.spec.unwrap() {
                            return Err("CAPTURE_SPEC_MISMATCH".into());
                        }
                        pcm.position_ms = p.next_position;
                        let duration = pcm.duration_ms();
                        if duration == 0 {
                            continue;
                        }
                        let codec = if p.playback.quality_mode == "opus" {
                            2
                        } else {
                            1
                        };
                        let data = native.encode(&pcm, codec)?;
                        let block = Block {
                            codec,
                            spec: pcm.spec,
                            epoch,
                            sequence: p.sequence,
                            position_ms: p.next_position,
                            data,
                        };
                        p.cache_bytes += block.data.len();
                        p.cache.push_back(block);
                        p.sequence += 1;
                        p.produced_frames += pcm.samples.len() as u64 / pcm.spec.channels as u64;
                        p.next_position = p.origin_position
                            + p.produced_frames * 1000 / pcm.spec.sample_rate as u64;
                        p.buffer.push(pcm)?;
                        while p
                            .cache
                            .front()
                            .is_some_and(|b| b.position_ms + 8000 < cursor)
                            || p.cache_bytes > 8 * 1024 * 1024
                        {
                            if let Some(block) = p.cache.pop_front() {
                                p.cache_bytes -= block.data.len();
                            } else {
                                break;
                            }
                        }
                        if !live && p.next_position >= cursor + 5000 {
                            break;
                        }
                    }
                }
                // During muted live publishing, release PCM after it is made available to peers.
                if live && self.active == Some(epoch) {
                    while p.buffer.pop_at(cursor.saturating_sub(1000)).is_some() {}
                }
            }
            for link in p.peers.values_mut() {
                if !p.is_provider
                    || !link.open
                    || link.capacity_bps < (p.playback.bitrate_bps as f64 * 1.2) as u64
                {
                    continue;
                }
                let mut sent = 0;
                let first_sequence = link.next_sequence;
                for block in p.cache.iter().filter(|b| b.sequence >= first_sequence) {
                    if link.peer.buffered() > 512 * 1024 || sent >= 32 {
                        break;
                    }
                    let fragments = block.fragments(link.peer.max_message().min(MAX_MESSAGE))?;
                    let mut all = true;
                    for fragment in fragments {
                        if !link
                            .peer
                            .send(&fragment, block.position_ms > cursor + 3000)?
                        {
                            all = false;
                            break;
                        }
                    }
                    if !all {
                        break;
                    }
                    link.next_sequence = block.sequence + 1;
                    sent += 1;
                }
            }
            let buffered = p.buffer.contiguous_ms(cursor);
            p.buffer.discard_before(cursor.saturating_sub(1000));
            if !p.is_provider
                && !p.admitted
                && !p.admission_requested
                && p.peers.values().any(|link| link.capacity_bps > 0)
            {
                // The probe measures a finite transfer, including sender acknowledgment time.
                let bps = p
                    .peers
                    .values()
                    .map(|link| link.capacity_bps)
                    .max()
                    .unwrap_or(0);
                let request = uuid::Uuid::new_v4().to_string();
                self.admissions.insert(
                    request.clone(),
                    (epoch, p.playback.provider_id.clone().unwrap(), false),
                );
                controls.push(json!({"type":"admission","requestId":request,"roomId":p.room_id,"sourceEpoch":epoch,"relay":false,"receiveBps":bps,"sourceUploadBps":bps}));
                p.admission_requested = true;
            }
            let ready_target = p
                .duration_ms
                .map_or(3000, |duration| duration.saturating_sub(cursor).min(3000))
                .max(1);
            if !p.ready_sent
                && p.transition_id.is_some()
                && p.admitted
                && (buffered >= ready_target
                    || p.eof && buffered > 0
                    || p.playback.play_state == "paused")
            {
                p.ready_sent = true;
                controls.push(json!({"type":"ready","roomId":p.room_id,"transitionId":p.transition_id,"sourceEpoch":epoch}));
            }
        }
        for control in controls {
            self.control(control);
        }
        let Some(epoch) = self.active else {
            return Ok(());
        };
        let Some(p) = self.pipelines.get_mut(&epoch) else {
            return Ok(());
        };
        if p.playback.play_state != "playing" {
            self.output = None;
            if local_now - self.last_status >= 500 {
                self.last_status = local_now;
                self.status("paused", "已暂停", 0, 0, 0);
            }
            return Ok(());
        }
        let position = p.playback.position(server_now);
        let buffered = p.buffer.contiguous_ms(position);
        let bps = p.receiving_bytes * 8000 / local_now.saturating_sub(p.receive_since).max(1);
        let muted_provider = p.is_provider && p.playback.source_type.as_deref() == Some("live")
            || self.volume == 0.0;
        if muted_provider {
            self.output = None;
            self.output_position = position;
            // Muting only suppresses local output: the media clock and cache still advance.
            p.buffer.discard_before(position);
        } else {
            let queued = self.output.as_ref().map_or(0, Output::queued_ms);
            let audible_position = self.output_position.saturating_sub(queued);
            let drift = audible_position as i64 - position as i64;
            if self.output.is_some() && drift.unsigned_abs() > 100 {
                self.output = None;
                self.output_position = position;
            }
            let start_target = p
                .duration_ms
                .map_or(2000, |duration| duration.saturating_sub(position).min(2000))
                .max(1);
            if self.output.is_none()
                && p.admitted
                && (buffered >= start_target || p.eof && buffered > 0)
            {
                self.output = Some(native.output(p.playback.spec.unwrap())?);
                self.output_position = position;
            }
            if let Some(output) = self.output.as_mut() {
                while output.queued_ms() < 200 {
                    if let Some(pcm) = p.buffer.pop_at(self.output_position) {
                        self.output_position = pcm.position_ms + pcm.duration_ms();
                        output.queue(&pcm, self.volume)?;
                    } else {
                        break;
                    }
                }
                if output.queued_ms() == 0 && buffered == 0 {
                    self.output = None;
                    self.output_position = position;
                }
            }
        }
        let status = if muted_provider || self.output.is_some() {
            "playing"
        } else {
            "buffering"
        };
        let detail = if muted_provider {
            if self.volume == 0.0 {
                "本地静音；房间播放继续"
            } else {
                "系统音频推流中，本地房间输出已关闭"
            }
        } else if self.output.is_some() {
            "正在同步播放"
        } else {
            "正在缓冲，尚未输出音频"
        };
        let exhausted = if status == "buffering"
            && !p.is_provider
            && !self.snapshot.as_ref().is_some_and(|s| {
                s["members"].as_array().is_some_and(|m| {
                    m.iter().any(|v| {
                        v["id"] == p.playback.provider_id.as_deref().unwrap_or("")
                            && v["online"] == true
                    })
                })
            }) {
            Some(json!({"type":"exhausted","roomId":p.room_id,"sourceEpoch":epoch}))
        } else {
            None
        };
        if let Some(message) = exhausted {
            self.control(message);
        }
        if local_now - self.last_status >= 500 {
            self.last_status = local_now;
            let drift = self
                .output_position
                .saturating_sub(self.output.as_ref().map_or(0, Output::queued_ms))
                as i64
                - position as i64;
            self.status(status, detail, buffered, drift, bps);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stop_discards_the_snapshot_even_when_a_late_signal_arrives() {
        let (events, _rx) = tokio::sync::mpsc::channel(16);
        let mut worker = Worker::new(None, "user".into(), events);
        worker.snapshot = Some(
            json!({"id":"old", "pending":{"committed":true}, "playback":{"sourceId":"old-file"}}),
        );
        worker.active = Some(7);
        worker.output_position = 5000;
        worker.handle(Input::Stop).unwrap();
        let _ = worker.handle(Input::Signal {
            peer: "old-provider".into(),
            epoch: 7,
            data: json!({}),
        });
        worker.pump().unwrap();
        assert!(worker.snapshot.is_none());
        assert!(worker.active.is_none());
        assert!(worker.pipelines.is_empty());
        assert!(worker.output.is_none());
        assert_eq!(worker.output_position, 0);
    }
}
