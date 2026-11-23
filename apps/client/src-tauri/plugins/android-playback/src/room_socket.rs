use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::State;
use tokio::{
    sync::{mpsc, oneshot, Notify},
    task::JoinHandle,
    time::{interval, timeout, Instant},
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
type Completion = oneshot::Sender<Result<(), String>>;
type Outbound = (String, Completion);

struct Connection {
    id: String,
    commands: mpsc::Sender<Outbound>,
    events: Arc<Events>,
    task: JoinHandle<()>,
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[derive(Default)]
pub struct RoomSocket(Mutex<Option<Connection>>);

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
    let (commands, receiver) = mpsc::channel(32);
    let events = Arc::new(Events::default());
    let worker_events = events.clone();
    let mut active = state.0.lock().map_err(|_| SOCKET_ERROR.to_owned())?;
    *active = Some(Connection {
        id: socket_id,
        commands,
        events,
        task: tokio::spawn(async move {
            let code = run_socket(req, &worker_events, receiver).await;
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
        *active = None;
    }
    Ok(())
}

async fn run_socket(req: Request, events: &Events, mut commands: mpsc::Receiver<Outbound>) -> u16 {
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
        return 1006;
    };
    events.push(json!({"type":"open"}), 32, false);
    let mut last_frame = Instant::now();
    let mut watchdog = interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            received = socket.next() => {
                let Some(Ok(frame)) = received else { return 1006 };
                last_frame = Instant::now();
                match frame {
                    Message::Text(data) => {
                        let snapshot = data.starts_with("{\"type\":\"snapshot\",");
                        let bytes = data.len();
                        events.push(json!({"type":"message","data":data}), bytes, snapshot);
                    }
                    Message::Close(frame) => return frame.map_or(1000, |f| f.code.into()),
                    // tungstenite already queues the pong. Flush it without any WebView event.
                    Message::Ping(_) => if !matches!(timeout(WRITE_LIMIT, socket.flush()).await, Ok(Ok(()))) { return 1006 },
                    _ => {}
                }
            }
            next = commands.recv() => {
                let Some((data, done)) = next else { return 1000 };
                if done.is_closed() { continue; } // Do not replay expired writes.
                let sent = matches!(timeout(WRITE_LIMIT, socket.send(Message::Text(data))).await, Ok(Ok(())));
                let _ = done.send(if sent { Ok(()) } else { Err(SOCKET_ERROR.into()) });
                if !sent { return 1006; }
            }
            _ = watchdog.tick() => if last_frame.elapsed() >= Duration::from_secs(25) { return 1006 },
        }
    }
}
