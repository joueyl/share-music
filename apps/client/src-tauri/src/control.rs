use crate::{
    clock::Clock,
    media::{Event, Input, Media},
    model::now_ms,
    native::Native,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
pub struct Connection {
    pub sender: mpsc::Sender<Value>,
    pub media: Arc<Media>,
    pub connected: Arc<AtomicBool>,
    pub task: tokio::task::JoinHandle<()>,
    room: Arc<Mutex<Option<String>>>,
}
pub fn start(
    base: String,
    token: String,
    user_id: String,
    native: Option<Arc<Native>>,
    emit: Emit,
) -> Connection {
    let (sender, mut outbound) = mpsc::channel::<Value>(64);
    let (events, mut media_events) = mpsc::channel::<Event>(256);
    let media = Arc::new(Media::start(native, user_id, events));
    let worker = media.clone();
    let connected = Arc::new(AtomicBool::new(false));
    let online = connected.clone();
    let room = Arc::new(Mutex::new(None::<String>));
    let desired_room = room.clone();
    let task = tokio::spawn(async move {
        let mut url = url::Url::parse(&base).unwrap();
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        let _ = url.set_scheme(scheme);
        url.set_path("/ws");
        let mut clock = Clock::default();
        let mut backoff = 1u64;
        let mut disconnected_at = now_ms();
        let mut stun_probe: Option<crate::stun::ProbeTask> = None;
        loop {
            let connection = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                connect_async(url.as_str()),
            )
            .await;
            match connection {
                Ok(Ok((socket, _))) => {
                    let (mut sink, mut stream) = socket.split();
                    if sink
                        .send(Message::Text(
                            json!({"type":"auth","token":token}).to_string(),
                        ))
                        .await
                        .is_err()
                    {
                        continue;
                    }
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(5));
                    loop {
                        tokio::select! {
                         message=stream.next()=>match message {
                          Some(Ok(Message::Text(text)))=>{
                           let Ok(message)=serde_json::from_str::<Value>(&text)else{continue;};
                           if !room_message_allowed(&desired_room.lock().unwrap(), &message) { continue; }
                           match message["type"].as_str(){
                            Some("authenticated")=>{let ice: Vec<String>=message["iceServers"].as_array().map(|v|v.iter().filter_map(|s|s.as_str().map(str::to_owned)).collect()).unwrap_or_default();stun_probe = Some(crate::stun::start(ice.clone(),emit.clone()));let _=worker.send(Input::IceServers(ice));online.store(true,Ordering::Relaxed);backoff=1;emit("connection",json!({"connected":true}));let rejoin=desired_room.lock().unwrap().clone();if let Some(id)=rejoin{if sink.send(Message::Text(json!({"type":"join","roomId":id}).to_string())).await.is_err(){break;}}},
                            Some("snapshot")=>{let membership=desired_room.lock().unwrap();if !room_message_allowed(&membership,&message){continue;}let _=worker.send(Input::Snapshot(message["data"].clone()));},
                            Some("signal")=>{let membership=desired_room.lock().unwrap();if !room_message_allowed(&membership,&message){continue;}let _=worker.send(Input::Signal{peer:message["fromId"].as_str().unwrap_or("").into(),epoch:message["sourceEpoch"].as_u64().unwrap_or(0),data:message["data"].clone()});},
                            Some("admission")=>{let membership=desired_room.lock().unwrap();if !room_message_allowed(&membership,&message){continue;}let _=worker.send(Input::Admission(message.clone()));},
                            Some("clock")=>{if let (Some(a),Some(b),Some(c))=(message["clientSentAt"].as_f64(),message["serverReceivedAt"].as_f64(),message["serverSentAt"].as_f64()){if clock.sample(a,b,c,now_ms() as f64){let offset=clock.offset();let _=worker.send(Input::Clock(offset));emit("clock-offset",json!({"offsetMs":offset}));}}},
                            _=>{},
                           }
                           emit("server-message",message);
                          },
                          Some(Ok(Message::Ping(data)))=>{if sink.send(Message::Pong(data)).await.is_err(){break;}},
                          Some(Ok(Message::Close(frame)))=>{if frame.is_some_and(|f|u16::from(f.code)==4001 || u16::from(f.code)==4009){online.store(false,Ordering::Relaxed);let _=worker.send(Input::Stop);emit("connection",json!({"connected":false}));emit("server-message",json!({"type":"error","error":"SESSION_EXPIRED"}));return;}break;},
                          Some(Err(_))|None=>break,_=>{},
                         },
                         message=outbound.recv()=>{
                          let Some(message)=message else{let _=worker.send(Input::Shutdown);return;};
                          if message["type"]=="join" && desired_room.lock().unwrap().as_deref()!=message["roomId"].as_str(){continue;}

                          if sink.send(Message::Text(message.to_string())).await.is_err(){break;}
                         },
                         event=media_events.recv()=>{if let Some(event)=event{match event{Event::Control(value)=>{if desired_room.lock().unwrap().as_deref()!=value["roomId"].as_str() || value["roomId"].as_str().is_none(){continue;}if sink.send(Message::Text(value.to_string())).await.is_err(){break;}},Event::Status(value)=>emit("media-status",value)}}},
                         _=interval.tick()=>{if online.load(Ordering::Relaxed) && sink.send(Message::Text(json!({"type":"clock","requestId":uuid::Uuid::new_v4().to_string(),"clientSentAt":now_ms()}).to_string())).await.is_err(){break;}},
                        }
                    }
                    disconnected_at = now_ms();
                    drop(stun_probe.take());
                }
                _ => {}
            }
            online.store(false, Ordering::Relaxed);
            emit("connection", json!({"connected":false}));
            if now_ms().saturating_sub(disconnected_at) >= 15000 {
                let _ = worker.send(Input::Stop);
            }
            // Playback commands queued while disconnected are discarded, never replayed.
            while outbound.try_recv().is_ok() {}
            tokio::time::sleep(std::time::Duration::from_secs(backoff)).await;
            backoff = (backoff * 2).min(8);
        }
    });
    Connection {
        sender,
        media,
        connected,
        task,
        room,
    }
}
impl Connection {
    pub fn send(&self, message: Value) -> Result<(), String> {
        let mut room = self.room.lock().map_err(|_| "STATE_LOCK_FAILED")?;
        if message["type"] == "leave" {
            *room = None;
            self.media.send(Input::Stop)?;
            if !self.connected.load(Ordering::Relaxed) {
                return Ok(());
            }
        } else {
            if !self.connected.load(Ordering::Relaxed) {
                return Err("控制连接未就绪".into());
            }
            if message["type"] == "join" {
                self.media.send(Input::Stop)?;
                *room = message["roomId"].as_str().map(str::to_owned);
            }
        }
        self.sender
            .try_send(message)
            .map_err(|_| "CONTROL_BACKPRESSURE".into())
    }
}
fn room_message_allowed(room: &Option<String>, message: &Value) -> bool {
    match message["type"].as_str() {
        Some("snapshot") => room
            .as_deref()
            .is_some_and(|id| message["data"]["id"].as_str() == Some(id)),
        Some("signal") | Some("admission") => {
            room.is_some()
                && message["roomId"]
                    .as_str()
                    .is_none_or(|id| room.as_deref() == Some(id))
        }
        _ => true,
    }
}
impl Drop for Connection {
    fn drop(&mut self) {
        let _ = self.media.send(Input::Shutdown);
        self.task.abort();
    }
}
pub fn validate_server_url(value: &str) -> Result<String, String> {
    let url = url::Url::parse(value).map_err(|_| "INVALID_SERVER_URL")?;
    let local = url
        .host_str()
        .is_some_and(|h| h == "localhost" || h == "127.0.0.1" || h == "[::1]");
    if url.host_str().is_none()
        || !(url.scheme() == "https" || url.scheme() == "http" && local)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("服务器必须使用 HTTPS，本机开发地址可使用 HTTP；地址不能包含路径或凭据".into());
    }
    Ok(url.origin().ascii_serialization())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn left_room_rejects_stale_media_and_snapshot() {
        for message in [
            json!({"type":"snapshot","data":{"id":"old"}}),
            json!({"type":"signal"}),
            json!({"type":"admission"}),
        ] {
            assert!(!room_message_allowed(&None, &message));
        }
        let room = Some("new".to_owned());
        assert!(!room_message_allowed(
            &room,
            &json!({"type":"snapshot","data":{"id":"old"}})
        ));
        assert!(room_message_allowed(
            &room,
            &json!({"type":"snapshot","data":{"id":"new"}})
        ));
        assert!(room_message_allowed(&None, &json!({"type":"clock"})));
    }
    #[tokio::test]
    async fn disconnected_leave_clears_reconnect_membership() {
        let connection = start(
            "http://127.0.0.1:1".into(),
            "test".into(),
            "user".into(),
            None,
            Arc::new(|_, _| {}),
        );
        *connection.room.lock().unwrap() = Some("old".into());
        connection.send(json!({"type":"leave"})).unwrap();
        assert!(connection.room.lock().unwrap().is_none());
        assert!(connection.sender.capacity() == 64);
    }
    #[test]
    fn url_policy() {
        assert!(validate_server_url("http://127.0.0.1:3000").is_ok());
        assert!(validate_server_url("https://music.example.com").is_ok());
        assert!(validate_server_url("http://example.com").is_err());
        assert!(validate_server_url("https://u:p@example.com").is_err());
        assert!(validate_server_url("file:///etc/passwd").is_err());
    }
}
