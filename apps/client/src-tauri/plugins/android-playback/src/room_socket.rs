use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::State;
use tokio::{
    sync::{mpsc, oneshot, watch, Notify},
    task::JoinHandle,
    time::{interval, sleep, timeout, Instant},
};
use tokio_tungstenite::{
    connect_async_tls_with_config,
    tungstenite::{
        client::IntoClientRequest, handshake::client::Request, http::HeaderValue,
        protocol::WebSocketConfig, Message,
    },
    Connector,
};
use url::Url;

const SOCKET_ERROR: &str = "ROOM_CONTROL_UNAVAILABLE";
const WRITE_LIMIT: Duration = Duration::from_secs(5);
const NATIVE_CLOCK_ID: &str = "746f6e65-0000-4000-8000-000000000001";
// Protocol codes mirror packages/shared; legacy 4001 alone is ambiguous.
const UNAUTHORIZED_CLOSE: u16 = 4401;
fn retryable_disconnect(code: u16) -> bool {
    matches!(code, 1001 | 1006 | 4001 | 4010)
}

#[test]
fn retries_timeouts_but_not_credential_rejection_or_replacement() {
    for code in [1001, 1006, 4001, 4010] {
        assert!(retryable_disconnect(code));
    }
    for code in [1000, 4003, 4009, UNAUTHORIZED_CLOSE] {
        assert!(!retryable_disconnect(code));
    }
}

// Debug APK only. Log fixed stage names and numeric close codes, never frames,
// room IDs, connection URLs, credentials or remote close reasons.
#[cfg(all(target_os = "android", debug_assertions))]
fn socket_log(message: std::fmt::Arguments<'_>) {
    use std::ffi::{c_char, c_int, CString};
    #[link(name = "log")]
    extern "C" {
        fn __android_log_write(priority: c_int, tag: *const c_char, text: *const c_char) -> c_int;
    }
    if let Ok(line) = CString::new(message.to_string()) {
        unsafe { __android_log_write(4, c"ToneRoomSocket".as_ptr(), line.as_ptr()) };
    }
}

#[cfg(not(all(target_os = "android", debug_assertions)))]
fn socket_log(_: std::fmt::Arguments<'_>) {}
type Completion = oneshot::Sender<Result<(), String>>;
type Outbound = (String, Completion);

#[derive(Default)]
struct Resume {
    auth: Option<String>,
    joining: Option<String>,
    room: Option<String>,
    recoveries: u64,
    user: Option<String>,
    clock_offset: Option<i64>,
}

struct Connection {
    id: String,
    commands: mpsc::Sender<Outbound>,
    events: Arc<Events>,
    media: mpsc::Sender<Value>,
    task: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Clone, Default)]
pub struct RoomSocket(
    Arc<Mutex<Option<Connection>>>,
    Arc<Mutex<Option<watch::Sender<Value>>>>,
    Arc<Mutex<Option<ChatUpdates>>>,
);

#[derive(Clone)]
pub(crate) struct ChatUpdates {
    scope: watch::Sender<Value>,
    messages: mpsc::Sender<Value>,
}

impl ChatUpdates {
    fn scope(&self, socket: &str, room: Option<&str>, user: Option<&str>, replace: bool) {
        let next = json!({"action":"chat-scope","socketId":socket,"roomId":room,"userId":user});
        self.scope.send_if_modified(|current| {
            if (!replace && current["socketId"] != socket) || *current == next {
                return false;
            }
            *current = next;
            true
        });
    }
}

impl RoomSocket {
    pub(crate) fn set_chat(&self, scope: watch::Sender<Value>, messages: mpsc::Sender<Value>) {
        if let Ok(mut slot) = self.2.lock() {
            *slot = Some(ChatUpdates { scope, messages });
        }
    }

    pub(crate) fn set_playback(&self, updates: watch::Sender<Value>) {
        if let Ok(mut slot) = self.1.lock() {
            *slot = Some(updates);
        }
    }

    pub(crate) fn media_control(&self, event: Value) {
        if let Ok(active) = self.0.lock() {
            if let Some(connection) = active
                .as_ref()
                .filter(|c| event["socketId"] == c.id.as_str())
            {
                let _ = connection.media.try_send(event);
            }
        }
    }
}

struct NativePlayback {
    updates: watch::Sender<Value>,
    socket: String,
    origin: String,
    chat: Option<ChatUpdates>,
}

fn chat_notice(
    socket: &str,
    session: &Resume,
    snapshot: &Value,
    frame: &Value,
    now: i64,
) -> Option<Value> {
    let room = session.room.as_deref()?;
    let user = session.user.as_deref()?;
    let message = &frame["data"];
    let sender = message["userId"].as_str()?;
    let sent = message["sentAt"].as_i64()?;
    if frame["type"] != "chat"
        || message["kind"] == "activity"
        || sender == user
        || message["roomId"] != room
        || snapshot["id"] != room
        || !(-5_000..=60_000).contains(&now.saturating_sub(sent))
    {
        return None;
    }
    let id = message["id"].as_str()?;
    let body = message["text"].as_str()?.trim();
    if id.is_empty() || id.len() > 64 || body.is_empty() {
        return None;
    }
    Some(
        json!({"action":"chat-notify","socketId":socket,"roomId":room,"userId":user,
        "id":id, "roomName":snapshot["name"].as_str()?.chars().take(80).collect::<String>(),
        "sender":message["userName"].as_str()?.chars().take(80).collect::<String>(),
        "body":body.chars().take(500).collect::<String>()}),
    )
}

#[cfg(test)]
mod chat_notice_tests {
    use super::*;

    #[test]
    fn only_fresh_peer_chat_in_the_current_room_can_notify() {
        let session = Resume {
            room: Some("room".into()),
            user: Some("self".into()),
            ..Default::default()
        };
        let snapshot = json!({"id":"room","name":"Music"});
        let mut frame = json!({"type":"chat","data":{"id":"message","roomId":"room",
            "userId":"peer","userName":"Peer","sentAt":100_000,"text":"Hello"}});
        assert!(chat_notice("socket", &session, &snapshot, &frame, 100_100).is_some());
        assert!(chat_notice("socket", &session, &snapshot, &frame, 161_000).is_none());
        frame["data"]["kind"] = json!("activity");
        assert!(chat_notice("socket", &session, &snapshot, &frame, 100_100).is_none());
        frame["data"]["kind"] = Value::Null;
        frame["data"]["userId"] = json!("self");
        assert!(chat_notice("socket", &session, &snapshot, &frame, 100_100).is_none());
    }
}

impl NativePlayback {
    fn publish(&self, state: &str, session: &Resume, snapshot: Option<&Value>) {
        if let Some(chat) = &self.chat {
            if state == "snapshot" {
                chat.scope(
                    &self.socket,
                    session.room.as_deref(),
                    session.user.as_deref(),
                    false,
                );
            } else {
                chat.scope(&self.socket, None, None, state == "reset");
            }
        }
        let mut value = json!({"driverState":state, "socketId":self.socket});
        if let (Some(snapshot), Some(user), Some(auth)) = (snapshot, &session.user, &session.auth) {
            let pending = &snapshot["pending"];
            let playback = if pending.is_null() {
                &snapshot["playback"]
            } else {
                &pending["playback"]
            };
            let track = snapshot["playlist"]
                .as_array()
                .and_then(|list| {
                    list.iter()
                        .find(|t| t["id"].is_string() && t["id"] == playback["sourceId"])
                })
                .filter(|t| t["sourceUrl"].is_string() || t["ossKey"].is_string());
            if let (Some(track), Ok(auth)) = (track, serde_json::from_str::<Value>(auth)) {
                let offset = session.clock_offset.unwrap_or_else(|| {
                    snapshot["serverNow"]
                        .as_i64()
                        .map_or(0, |at| at - wall_ms())
                });
                value = json!({"driverState":"snapshot","socketId":self.socket,"base":self.origin,
                    "token":auth["token"],"userId":user,"roomId":snapshot["id"],"hostId":snapshot["hostId"],
                    "offsetMs":offset,"track":track,"playback":playback,
                    "pending":pending["id"],"committed":pending["committed"],
                    "canControl":media_permission(snapshot, user, "skip"),
                    "canSeek":media_permission(snapshot, user, "seek")});
            } else {
                value["driverState"] = json!("clear");
            }
        }
        self.updates.send_if_modified(|current| {
            if state != "reset" && current["socketId"] != self.socket.as_str() {
                return false;
            }
            *current = value;
            true
        });
    }
}

fn wall_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn playback_report(event: &Value, room: Option<&str>, snapshot: &Value) -> Option<String> {
    let id = room?;
    if event["roomId"] != id || snapshot["id"] != id {
        return None;
    }
    let action = event["action"].as_str()?;
    let epoch = event["sourceEpoch"].as_u64()?;
    let message = match action {
        "ready"
            if snapshot["pending"]["committed"] == false
                && snapshot["pending"]["playback"]["sourceEpoch"].as_u64() == Some(epoch)
                && event["transitionId"] == snapshot["pending"]["id"] =>
        {
            json!({
                "type":"ready","roomId":id,"transitionId":event["transitionId"],"sourceEpoch":epoch
            })
        }
        "progress"
            if snapshot["pending"].is_null()
                && snapshot["playback"]["sourceEpoch"].as_u64() == Some(epoch)
                && snapshot["playback"]["playState"] == "playing" =>
        {
            json!({
                "type":"progress","roomId":id,"sourceEpoch":epoch,"positionMs":event["positionMs"].as_u64()?,
                "sampledAtServerMs":event["sampledAtServerMs"].as_u64()?,
                "listenedMs":event["listenedMs"].as_u64()?
            })
        }
        _ => return None,
    };
    Some(message.to_string())
}

fn media_permission(snapshot: &Value, user: &str, permission: &str) -> bool {
    snapshot["hostId"] == user
        || snapshot["members"].as_array().is_some_and(|members| {
            members.iter().any(|m| {
                m["id"] == user && m["online"] == true && m["permissions"][permission] == true
            })
        })
}

fn media_command(
    event: &Value,
    room: Option<&str>,
    user: &str,
    snapshot: &Value,
) -> Option<String> {
    let id = room?;
    let playback = &snapshot["playback"];
    if snapshot["id"] != id
        || event["roomId"] != id
        || !snapshot["pending"].is_null()
        || event["trackId"].as_str().is_none()
        || event["trackId"] != playback["sourceId"]
        || event["sourceEpoch"].as_u64()? != playback["sourceEpoch"].as_u64()?
    {
        return None;
    }
    let mut payload = json!({});
    let action = match (event["action"].as_str()?, playback["playState"].as_str()?) {
        ("seek", "playing" | "paused")
            if playback["sourceType"] == "file" && media_permission(snapshot, user, "seek") =>
        {
            let duration = snapshot["playlist"]
                .as_array()?
                .iter()
                .find(|track| track["id"] == playback["sourceId"])?["durationMs"]
                .as_u64()?;
            payload["positionMs"] =
                json!(event["positionMs"].as_u64()?.min(duration.checked_sub(1)?));
            "seek"
        }
        (action @ ("next" | "previous"), "playing" | "paused") => action,
        ("play", "paused") => "resume",
        ("pause", "playing") => "pause",
        _ => return None,
    };
    if action != "seek" && !media_permission(snapshot, user, "skip") {
        return None;
    }
    Some(
        json!({"type":"command","data":{
            "commandId":event["commandId"].as_str()?, "roomId":id,
            "expectedStateVersion":snapshot["stateVersion"].as_u64()?,
            "action":{"type":action,"payload":payload}
        }})
        .to_string(),
    )
}

#[cfg(test)]
mod media_command_tests {
    use super::*;

    #[test]
    fn system_skip_uses_current_version_only_for_matching_track() {
        let mut event = json!({"action":"next","roomId":"room","trackId":"track","sourceEpoch":7,"commandId":"command"});
        let mut snapshot = json!({"id":"room","hostId":"user","stateVersion":18,"pending":null,
            "playback":{"sourceId":"track","sourceEpoch":7,"playState":"playing"}});
        let command: Value =
            serde_json::from_str(&media_command(&event, Some("room"), "user", &snapshot).unwrap())
                .unwrap();
        assert_eq!(command["data"]["expectedStateVersion"], 18);
        assert_eq!(command["data"]["action"]["type"], "next");
        snapshot["pending"] = json!({});
        assert!(media_command(&event, Some("room"), "user", &snapshot).is_none());
        snapshot["pending"] = Value::Null;
        event["sourceEpoch"] = json!(6);
        assert!(media_command(&event, Some("room"), "user", &snapshot).is_none());
    }

    #[test]
    fn system_seek_checks_seek_permission_and_bounds_without_skip_permission() {
        let event = json!({"action":"seek","roomId":"room","trackId":"track","sourceEpoch":7,"commandId":"cmd","positionMs":1000});
        let mut snapshot = json!({"id":"room","hostId":"host","stateVersion":18,"pending":null,
            "members":[{"id":"user","online":true,"permissions":{"seek":true,"skip":false}}],
            "playlist":[{"id":"track","durationMs":900}],
            "playback":{"sourceId":"track","sourceEpoch":7,"sourceType":"file","playState":"paused"}});
        let command: Value =
            serde_json::from_str(&media_command(&event, Some("room"), "user", &snapshot).unwrap())
                .unwrap();
        assert_eq!(command["data"]["action"]["payload"]["positionMs"], 899);
        snapshot["members"][0]["permissions"]["seek"] = json!(false);
        assert!(media_command(&event, Some("room"), "user", &snapshot).is_none());
    }
}

struct Event {
    body: Value,
    bytes: usize,
    snapshot: bool,
}
#[derive(Default)]
struct Events {
    queue: Mutex<VecDeque<Event>>,
    changed: Notify,
}

impl Events {
    fn push(&self, body: Value, bytes: usize, snapshot: bool) {
        if let Ok(mut queue) = self.queue.lock() {
            // A frozen WebView consumes nothing; keep native memory bounded and
            // coalesce consecutive complete snapshots before it wakes up.
            if snapshot && queue.back().is_some_and(|e| e.snapshot) {
                queue.pop_back();
            }
            let mut total = queue.iter().map(|e| e.bytes).sum::<usize>() + bytes;
            while queue.len() >= 32 || total > 8 * 1024 * 1024 {
                let Some(old) = queue.pop_front() else { break };
                total -= old.bytes;
            }
            queue.push_back(Event {
                body,
                bytes,
                snapshot,
            });
            self.changed.notify_one();
        }
    }

    async fn receive(&self) -> Result<Value, String> {
        loop {
            if let Some(event) = self
                .queue
                .lock()
                .map_err(|_| SOCKET_ERROR.to_owned())?
                .pop_front()
            {
                return Ok(event.body);
            }
            self.changed.notified().await;
        }
    }
}

fn request(url: &str, origin: &str) -> Result<Request, String> {
    let invalid = || "ROOM_CONTROL_URL_INVALID".to_owned();
    let parsed = Url::parse(url).map_err(|_| invalid())?;
    let Some(host) = parsed.host_str() else {
        return Err(invalid());
    };
    let debug_loopback = cfg!(debug_assertions)
        && parsed.scheme() == "ws"
        && matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    if !(parsed.scheme() == "wss" || debug_loopback)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.path() != "/ws"
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid());
    }
    let valid_origin = Url::parse(origin).map_err(|_| invalid())?;
    if valid_origin.host_str().is_none()
        || valid_origin.query().is_some()
        || valid_origin.fragment().is_some()
        || !valid_origin.username().is_empty()
        || valid_origin.password().is_some()
    {
        return Err(invalid());
    }
    let mut req = parsed
        .as_str()
        .into_client_request()
        .map_err(|_| invalid())?;
    req.headers_mut().insert(
        "Origin",
        HeaderValue::from_str(origin).map_err(|_| invalid())?,
    );
    Ok(req)
}

#[tauri::command]
pub async fn room_connect(
    state: State<'_, RoomSocket>,
    socket_id: String,
    url: String,
    origin: String,
) -> Result<(), String> {
    if socket_id.is_empty() || socket_id.len() > 64 {
        return Err(SOCKET_ERROR.into());
    }
    let req = request(&url, &origin)?;
    let base = Url::parse(&url).map_err(|_| SOCKET_ERROR.to_string())?;
    let http = if base.scheme() == "wss" {
        "https"
    } else {
        "http"
    };
    let updates = state
        .1
        .lock()
        .map_err(|_| SOCKET_ERROR.to_owned())?
        .clone()
        .ok_or_else(|| SOCKET_ERROR.to_owned())?;
    let driver = NativePlayback {
        updates,
        chat: state.2.lock().map_err(|_| SOCKET_ERROR.to_owned())?.clone(),
        socket: socket_id.clone(),
        origin: base
            .origin()
            .ascii_serialization()
            .replacen(base.scheme(), http, 1),
    };
    let (commands, receiver) = mpsc::channel(32);
    let (media, media_rx) = mpsc::channel(8);
    let events = Arc::new(Events::default());
    let worker_events = events.clone();
    let mut active = state.0.lock().map_err(|_| SOCKET_ERROR.to_owned())?;
    driver.publish("reset", &Resume::default(), None);
    *active = Some(Connection {
        id: socket_id,
        commands,
        events,
        media,
        task: tokio::spawn(async move {
            let code = supervise(
                req,
                &url,
                &origin,
                &worker_events,
                receiver,
                media_rx,
                &driver,
            )
            .await;
            driver.publish("closed", &Resume::default(), None);
            socket_log(format_args!("stage=worker-closed code={code}"));
            worker_events.push(json!({"type":"close","code":code}), 32, false);
        }),
    });
    Ok(())
}

#[tauri::command]
pub async fn room_receive(
    state: State<'_, RoomSocket>,
    socket_id: String,
) -> Result<Option<Value>, String> {
    let events = state
        .0
        .lock()
        .map_err(|_| SOCKET_ERROR.to_owned())?
        .as_ref()
        .filter(|active| active.id == socket_id)
        .map(|active| active.events.clone())
        .ok_or_else(|| SOCKET_ERROR.to_owned())?;
    match timeout(Duration::from_secs(15), events.receive()).await {
        Ok(event) => event.map(Some),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
pub async fn room_send(
    state: State<'_, RoomSocket>,
    socket_id: String,
    data: String,
) -> Result<(), String> {
    if data.len() > 256 * 1024 {
        return Err(SOCKET_ERROR.into());
    }
    let commands = state
        .0
        .lock()
        .map_err(|_| SOCKET_ERROR.to_owned())?
        .as_ref()
        .filter(|active| active.id == socket_id)
        .map(|active| active.commands.clone())
        .ok_or_else(|| SOCKET_ERROR.to_owned())?;
    let (complete, result) = oneshot::channel();
    commands
        .try_send((data, complete))
        .map_err(|_| SOCKET_ERROR.to_owned())?;
    timeout(WRITE_LIMIT, result)
        .await
        .map_err(|_| SOCKET_ERROR.to_owned())?
        .map_err(|_| SOCKET_ERROR.to_owned())?
}

#[tauri::command]
pub fn room_close(state: State<'_, RoomSocket>, socket_id: String) -> Result<(), String> {
    let mut active = state.0.lock().map_err(|_| SOCKET_ERROR.to_owned())?;
    if active
        .as_ref()
        .is_some_and(|connection| connection.id == socket_id)
    {
        socket_log(format_args!("stage=client-close"));
        *active = None;
        if let Ok(slot) = state.2.lock() {
            if let Some(chat) = slot.as_ref() {
                chat.scope(&socket_id, None, None, false);
            }
        }
        if let Ok(slot) = state.1.lock() {
            if let Some(updates) = slot.as_ref() {
                updates.send_if_modified(|current| {
                    if current["socketId"] != socket_id.as_str() {
                        return false;
                    }
                    *current = json!({"driverState":"closed","socketId":socket_id});
                    true
                });
            }
        }
    }
    Ok(())
}

async fn supervise(
    req: Request,
    url: &str,
    origin: &str,
    events: &Events,
    mut commands: mpsc::Receiver<Outbound>,
    mut media: mpsc::Receiver<Value>,
    driver: &NativePlayback,
) -> u16 {
    let mut session = Resume::default();
    let mut code = run_socket(
        req,
        events,
        &mut commands,
        &mut media,
        &mut session,
        false,
        driver,
    )
    .await;
    while retryable_disconnect(code) && session.room.is_some() && session.auth.is_some() {
        socket_log(format_args!("stage=reconnecting code={code}"));
        driver.publish("disconnected", &session, None);
        events.push(json!({"type":"reconnecting"}), 32, false);
        let mut restored = false;
        for delay in [1, 2, 4] {
            let wait = sleep(Duration::from_secs(delay));
            tokio::pin!(wait);
            loop {
                tokio::select! {
                    _ = &mut wait => break,
                    _ = media.recv() => {}, // Drop controls pressed while disconnected.
                    cmd = commands.recv() => {
                        let Some((data, done)) = cmd else { return 1000 };
                        let leave = !done.is_closed() && serde_json::from_str::<Value>(&data).ok()
                            .is_some_and(|m| m["type"] == "leave");
                        let _ = done.send(if leave { Ok(()) } else { Err(SOCKET_ERROR.into()) });
                        if leave { return 1000; }
                    }
                }
            }
            // Only retry transport failures. Auth rejection, replacement and
            // explicit rejoin rejection are terminal, not a reconnect loop.
            let before = session.recoveries;
            socket_log(format_args!("stage=retry delaySeconds={delay}"));
            let Ok(req) = request(url, origin) else {
                return 4003;
            };
            let attempt = run_socket(
                req,
                events,
                &mut commands,
                &mut media,
                &mut session,
                true,
                driver,
            )
            .await;
            code = attempt;
            if session.recoveries != before || !retryable_disconnect(attempt) || session.room.is_none() {
                restored = true;
                break;
            }
        }
        if !restored {
            break;
        }
    }
    code
}

async fn run_socket(
    req: Request,
    events: &Events,
    commands: &mut mpsc::Receiver<Outbound>,
    media: &mut mpsc::Receiver<Value>,
    session: &mut Resume,
    reconnect: bool,
    driver: &NativePlayback,
) -> u16 {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let config = WebSocketConfig {
        max_message_size: Some(4 * 1024 * 1024),
        ..Default::default()
    };
    let Ok(Ok((mut socket, _))) = timeout(
        Duration::from_secs(10),
        connect_async_tls_with_config(
            req,
            Some(config),
            true,
            Some(Connector::Rustls(Arc::new(tls))),
        ),
    )
    .await
    else {
        socket_log(format_args!("stage=upgrade-failed"));
        return 1006;
    };
    socket_log(format_args!("stage=upgraded retry={reconnect}"));
    if reconnect {
        let Some(auth) = session.auth.as_ref() else {
            return 1000;
        };
        if !matches!(
            timeout(WRITE_LIMIT, socket.send(Message::Text(auth.clone()))).await,
            Ok(Ok(()))
        ) {
            return 1006;
        }
    } else {
        events.push(json!({"type":"open"}), 32, false);
    }
    if reconnect {
        while media.try_recv().is_ok() {}
    }
    let mut latest = Value::Null;
    let mut rejoining = reconnect;
    let mut reauthenticating = reconnect;
    let handshake_deadline = Instant::now() + Duration::from_secs(8);
    let mut last_frame = Instant::now();
    let mut last_pong_log: Option<Instant> = None;
    let mut watchdog = interval(Duration::from_secs(5));
    let mut native_clock_sent = 0;
    loop {
        tokio::select! {
            received = socket.next() => {
                let frame = match received {
                    Some(Ok(frame)) => frame,
                    Some(Err(_)) => { socket_log(format_args!("stage=read-error")); return 1006; }
                    None => { socket_log(format_args!("stage=read-eof")); return 1006; }
                };
                last_frame = Instant::now();
                match frame {
                    Message::Text(data) => {
                        let snapshot = data.starts_with("{\"type\":\"snapshot\",");
                        if !rejoining && data.starts_with("{\"type\":\"chat\",") {
                            if let (Some(chat), Ok(frame)) = (&driver.chat, serde_json::from_str::<Value>(&data)) {
                                let now = wall_ms().saturating_add(session.clock_offset.unwrap_or(0));
                                if let Some(notice) = chat_notice(&driver.socket, session, &latest, &frame, now) {
                                    let _ = chat.messages.try_send(notice);
                                }
                            }
                        }
                        if rejoining || snapshot || data.starts_with("{\"type\":\"authenticated\",") || data.starts_with("{\"type\":\"clock\",") {
                            if let Ok(m) = serde_json::from_str::<Value>(&data) {
                                if m["type"] == "authenticated" {
                                    session.user = m["user"]["id"].as_str().map(str::to_owned);
                                }
                                if m["type"] == "clock" && m["requestId"] == NATIVE_CLOCK_ID {
                                    let now = wall_ms();
                                    if let (Some(received), Some(sent)) = (m["serverReceivedAt"].as_i64(), m["serverSentAt"].as_i64()) {
                                        let rtt = now - native_clock_sent - (sent - received);
                                        if (0..1000).contains(&rtt) {
                                            session.clock_offset = Some(((received - native_clock_sent) + (sent - now)) / 2);
                                            if !latest.is_null() { driver.publish("snapshot", session, Some(&latest)); }
                                        }
                                    }
                                    continue;
                                }
                                if reauthenticating && m["type"] == "authenticated" {
                                    reauthenticating = false;
                                    let Some(room) = session.room.as_ref() else { return 1000 };
                                    let join = json!({"type":"join","roomId":room}).to_string();
                                    if !matches!(timeout(WRITE_LIMIT, socket.send(Message::Text(join))).await, Ok(Ok(()))) {
                                        return 1006;
                                    }
                                    continue; // Do not let the WebView send a second join.
                                }
                                if rejoining && m["type"] == "error" {
                                    session.room = None;
                                    if m["error"] == "UNAUTHORIZED" { return UNAUTHORIZED_CLOSE; }
                                    events.push(json!({"type":"message","data":data}), 128, false);
                                    return 1000;
                                }
                                if snapshot {
                                    let id = m["data"]["id"].as_str();
                                    if id.is_some() && id == session.joining.as_deref() {
                                        session.room = session.joining.take();
                                    }
                                    if rejoining && !reauthenticating && id.is_some() && id == session.room.as_deref() {
                                        rejoining = false;
                                        session.recoveries += 1;
                                        socket_log(format_args!("stage=rejoined"));
                                        events.push(json!({"type":"reconnected"}), 32, false);
                                    }
                                    if id.is_some() && id == session.room.as_deref() {
                                        latest = m["data"].clone();
                                        driver.publish("snapshot", session, Some(&latest));
                                    }
                                }
                            }
                        }
                        let bytes = data.len();
                        events.push(json!({"type":"message","data":data}), bytes, snapshot);
                    }
                    Message::Close(frame) => {
                        let code = frame.map_or(1000, |f| f.code.into());
                        socket_log(format_args!("stage=remote-close code={code}"));
                        return code;
                    }
                    // tungstenite already queues the pong. Flush it without any WebView event.
                    Message::Ping(_) => {
                        if !matches!(timeout(WRITE_LIMIT, socket.flush()).await, Ok(Ok(()))) {
                            socket_log(format_args!("stage=pong-write-failed"));
                            return 1006;
                        }
                        if last_pong_log.map_or(true, |at| at.elapsed() >= Duration::from_secs(15)) {
                            socket_log(format_args!("stage=pong-flushed"));
                            last_pong_log = Some(Instant::now());
                        }
                    }
                    _ => {}
                }
            }
            control = media.recv() => {
                let Some(event) = control else { return 1000 };
                if !rejoining {
                    if let Some(command) = playback_report(&event, session.room.as_deref(), &latest)
                        .or_else(|| media_command(&event, session.room.as_deref(), session.user.as_deref()?, &latest)) {
                        if !matches!(timeout(WRITE_LIMIT, socket.send(Message::Text(command))).await, Ok(Ok(()))) { return 1006; }
                    }
                }
            }
            next = commands.recv() => {
                let Some((data, done)) = next else { return 1000 };
                if done.is_closed() { continue; } // Do not replay expired writes.
                if let Ok(m) = serde_json::from_str::<Value>(&data) {
                    match m["type"].as_str() {
                        Some("leave") => {
                            session.joining = None;
                            session.room = None;
                            latest = Value::Null;
                            driver.publish("clear", session, None);
                            if rejoining { let _ = done.send(Ok(())); return 1000; }
                        }
                        Some("auth") if !rejoining => session.auth = Some(data.clone()),
                        Some("join") if !rejoining => session.joining = m["roomId"].as_str().map(str::to_owned),
                        _ => {}
                    }
                }
                if rejoining { let _ = done.send(Err(SOCKET_ERROR.into())); continue; }
                let sent = matches!(timeout(WRITE_LIMIT, socket.send(Message::Text(data))).await, Ok(Ok(())));
                let _ = done.send(if sent { Ok(()) } else { Err(SOCKET_ERROR.into()) });
                if !sent { return 1006; }
            }
            _ = tokio::time::sleep_until(handshake_deadline), if rejoining => {
                socket_log(format_args!("stage=rejoin-timeout"));
                return 1006;
            }
            _ = watchdog.tick() => {
                if last_frame.elapsed() >= Duration::from_secs(25) {
                    socket_log(format_args!("stage=heartbeat-timeout"));
                    return 1006;
                }
                if !rejoining && session.room.is_some() {
                    native_clock_sent = wall_ms();
                    let clock = json!({"type":"clock","requestId":NATIVE_CLOCK_ID,"clientSentAt":native_clock_sent}).to_string();
                    if !matches!(timeout(WRITE_LIMIT, socket.send(Message::Text(clock))).await, Ok(Ok(()))) { return 1006; }
                }
            },
        }
    }
}
