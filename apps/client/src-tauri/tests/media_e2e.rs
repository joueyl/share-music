//! Explicit integration test: generated audio only, SDL dummy output, two Rust
//! clients and a real NestJS service. No system audio or microphone is captured.
use music_share_core::{
    control::{self, Connection, Emit},
    media::Input,
    native::Native,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Write, sync::Arc, time::Duration};
use tokio::sync::mpsc;
use uuid::Uuid;
async fn event(
    rx: &mut mpsc::Receiver<(String, Value)>,
    predicate: impl Fn(&str, &Value) -> bool,
) -> Value {
    tokio::time::timeout(Duration::from_secs(15), async {
        while let Some((name, value)) = rx.recv().await {
            if name == "media-status" && value["status"] == "error" {
                panic!("media failure: {value}");
            }
            if name == "server-message" && value["type"] == "error" {
                panic!("server failure: {value}");
            }
            if predicate(&name, &value) {
                return value;
            }
        }
        panic!("event channel closed")
    })
    .await
    .expect("integration event timeout")
}
fn emitter() -> (Emit, mpsc::Receiver<(String, Value)>) {
    let (tx, rx) = mpsc::channel(1024);
    (
        Arc::new(move |name: &str, value: Value| {
            let _ = tx.try_send((name.to_owned(), value));
        }),
        rx,
    )
}
async fn post(
    http: &reqwest::Client,
    base: &str,
    path: &str,
    value: Value,
    token: Option<&str>,
) -> Value {
    let mut request = http.post(format!("{base}/api{path}")).json(&value);
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.unwrap();
    let status = response.status();
    let value: Value = response.json().await.unwrap();
    assert!(status.is_success(), "HTTP {status}: {value}");
    value
}
async fn action(
    http: &reqwest::Client,
    base: &str,
    room: &str,
    token: &str,
    connection: &Connection,
    rx: &mut mpsc::Receiver<(String, Value)>,
    action: Value,
) {
    let snapshot: Value = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let v: Value = http
                .get(format!("{base}/api/rooms/{room}"))
                .bearer_auth(token)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            if v["pending"].is_null() {
                break v;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .expect("previous transition did not settle");
    let command = Uuid::new_v4().to_string();
    connection.sender.send(json!({"type":"command","data":{"commandId":command,"roomId":room,"expectedStateVersion":snapshot["stateVersion"],"action":action}})).await.unwrap();
    let result = event(rx, |name, v| {
        name == "server-message" && v["type"] == "result" && v["commandId"] == command
    })
    .await;
    assert_eq!(result["ok"], true, "{result}");
}
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires MUSIC_NATIVE_LIBRARY and MUSIC_TEST_SERVER; run explicitly with SDL dummy output"]
async fn two_clients_play_pause_seek_and_choose_opus() {
    let base = std::env::var("MUSIC_TEST_SERVER").expect("MUSIC_TEST_SERVER required");
    std::env::set_var("SDL_AUDIODRIVER", "dummy");
    let path = Native::locate().unwrap();
    let native = Native::load(&path).unwrap();
    let http = reqwest::Client::new();
    let a=post(&http,&base,"/login",json!({"name":format!("a{}",Uuid::new_v4().simple()),"password":"generated-integration-password","register":true}),None).await;
    let b=post(&http,&base,"/login",json!({"name":format!("b{}",Uuid::new_v4().simple()),"password":"generated-integration-password","register":true}),None).await;
    let token_a = a["token"].as_str().unwrap();
    let token_b = b["token"].as_str().unwrap();
    let room = post(
        &http,
        &base,
        "/rooms",
        json!({"name":"Rust media integration"}),
        Some(token_a),
    )
    .await;
    let room_id = room["id"].as_str().unwrap();
    let (emit_a, mut rx_a) = emitter();
    let (emit_b, mut rx_b) = emitter();
    let ca = control::start(
        base.clone(),
        token_a.to_owned(),
        a["user"]["id"].as_str().unwrap().to_owned(),
        Some(native.clone()),
        emit_a,
    );
    let cb = control::start(
        base.clone(),
        token_b.to_owned(),
        b["user"]["id"].as_str().unwrap().to_owned(),
        Some(native.clone()),
        emit_b,
    );
    event(&mut rx_a, |n, v| {
        n == "connection" && v["connected"] == true
    })
    .await;
    event(&mut rx_b, |n, v| {
        n == "connection" && v["connected"] == true
    })
    .await;
    ca.media.send(Input::Volume(0.0)).unwrap();
    ca.send(json!({"type":"join","roomId":room_id})).unwrap();
    event(&mut rx_a, |n, v| {
        n == "server-message" && v["type"] == "snapshot"
    })
    .await;
    cb.send(json!({"type":"join","roomId":room_id})).unwrap();
    event(&mut rx_b, |n, v| {
        n == "server-message"
            && v["type"] == "snapshot"
            && v["data"]["members"].as_array().unwrap().len() == 2
    })
    .await;
    let fixture = std::env::temp_dir().join(format!("music-share-{}.wav", Uuid::new_v4()));
    let rate = 48000u32;
    let frames = rate * 24;
    let bytes = frames * 4;
    let mut file = std::fs::File::create(&fixture).unwrap();
    file.write_all(b"RIFF").unwrap();
    file.write_all(&(bytes + 36).to_le_bytes()).unwrap();
    file.write_all(b"WAVEfmt ").unwrap();
    file.write_all(&16u32.to_le_bytes()).unwrap();
    file.write_all(&1u16.to_le_bytes()).unwrap();
    file.write_all(&2u16.to_le_bytes()).unwrap();
    file.write_all(&rate.to_le_bytes()).unwrap();
    file.write_all(&(rate * 4).to_le_bytes()).unwrap();
    file.write_all(&4u16.to_le_bytes()).unwrap();
    file.write_all(&16u16.to_le_bytes()).unwrap();
    file.write_all(b"data").unwrap();
    file.write_all(&bytes.to_le_bytes()).unwrap();
    for i in 0..frames {
        let sample =
            (((i as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin()) * 16000.0) as i16;
        file.write_all(&sample.to_le_bytes()).unwrap();
        file.write_all(&sample.to_le_bytes()).unwrap();
    }
    drop(file);
    let (_, mut track) = native.open_file(&fixture).unwrap();
    let track_id = Uuid::new_v4().to_string();
    track["id"] = json!(track_id);
    track["name"] = json!("Generated 440Hz test.wav");
    track["sizeBytes"] = json!(std::fs::metadata(&fixture).unwrap().len());
    track["contentHash"] = json!(format!(
        "{:x}",
        Sha256::digest(std::fs::read(&fixture).unwrap())
    ));
    ca.media
        .send(Input::Imported(track_id.clone(), fixture.clone()))
        .unwrap();
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"enqueue","payload":track}),
    )
    .await;
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"play","payload":{"trackId":track_id}}),
    )
    .await;
    let playing = event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "playing"
    })
    .await;
    assert!(playing["receiveBps"].as_u64().unwrap() > 0, "{playing}");
    cb.media.send(Input::Volume(0.0)).unwrap();
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["detail"] == "本地静音；房间播放继续"
    })
    .await;
    tokio::time::sleep(Duration::from_secs(4)).await;
    let muted = event(&mut rx_b, |n, v| {
        n == "media-status" && v["detail"] == "本地静音；房间播放继续"
    })
    .await;
    assert_eq!(muted["driftMs"], 0, "muted clock must follow room: {muted}");
    cb.media.send(Input::Volume(1.0)).unwrap();
    let resumed = event(&mut rx_b, |n, v| {
        n == "media-status" && v["detail"] == "正在同步播放"
    })
    .await;
    assert!(
        resumed["driftMs"].as_i64().unwrap().abs() <= 100,
        "{resumed}"
    );
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"pause","payload":{}}),
    )
    .await;
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "paused"
    })
    .await;
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"seek","payload":{"positionMs":5000}}),
    )
    .await;
    event(&mut rx_b, |n, v| {
        n == "server-message"
            && v["type"] == "snapshot"
            && v["data"]["pending"].is_null()
            && v["data"]["playback"]["positionMs"] == 5000
    })
    .await;
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"resume","payload":{}}),
    )
    .await;
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "playing"
    })
    .await;
    action(
        &http,
        &base,
        room_id,
        token_a,
        &ca,
        &mut rx_a,
        json!({"type":"quality","payload":{"qualityMode":"opus"}}),
    )
    .await;
    event(&mut rx_b, |n, v| {
        n == "server-message"
            && v["type"] == "snapshot"
            && v["data"]["pending"].is_null()
            && v["data"]["playback"]["qualityMode"] == "opus"
    })
    .await;
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "playing"
    })
    .await;
    cb.send(json!({"type":"leave"})).unwrap();
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "idle"
    })
    .await;
    let restarted = tokio::time::timeout(Duration::from_secs(2), async {
        while let Some((name, value)) = rx_b.recv().await {
            if name == "media-status" && value["status"] == "playing" {
                return;
            }
            assert!(
                !(name == "server-message" && value["type"] == "snapshot"),
                "left room snapshot: {value}"
            );
        }
    })
    .await;
    assert!(restarted.is_err(), "playback resumed after leaving");
    event(&mut rx_a, |n, v| {
        n == "media-status" && v["status"] == "playing"
    })
    .await;
    cb.send(json!({"type":"join","roomId":room_id})).unwrap();
    event(&mut rx_b, |n, v| {
        n == "media-status" && v["status"] == "playing"
    })
    .await;
    ca.send(json!({"type":"leave"})).unwrap();
    event(&mut rx_a, |n, v| {
        n == "media-status" && v["status"] == "idle"
    })
    .await;
    drop(ca);
    drop(cb);
    tokio::time::sleep(Duration::from_millis(200)).await;
    let _ = std::fs::remove_file(fixture);
}
