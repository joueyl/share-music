//! Independent UDP Binding diagnostics; failure is not proof that ICE/P2P failed.
use crate::control::Emit;
use serde_json::json;
use std::time::Duration;
use tokio::{
    net::{lookup_host, UdpSocket},
    task::JoinHandle,
};

pub struct ProbeTask(JoinHandle<()>);
impl Drop for ProbeTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}
pub fn start(servers: Vec<String>, emit: Emit) -> ProbeTask {
    let servers: Vec<_> = servers
        .into_iter()
        .filter(|s| s.starts_with("stun:"))
        .collect();
    emit("stun-status", json!({"checking":true,"servers":[]}));
    ProbeTask(tokio::spawn(async move {
        loop {
            let reports = futures_util::future::join_all(servers.iter().map(|uri| async move {
                let result = probe(uri, Duration::from_secs(4)).await;
                json!({"url":uri,"ok":result.is_ok(),"error":result.err().unwrap_or_default()})
            }))
            .await;
            emit("stun-status", json!({"checking":false,"servers":reports}));
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    }))
}
async fn probe(uri: &str, timeout: Duration) -> Result<(), String> {
    tokio::time::timeout(timeout, async {
        let target = uri.strip_prefix("stun:").ok_or("地址格式错误")?;
        let url = url::Url::parse(&format!("stun://{target}")).map_err(|_| "地址格式错误")?;
        let host = url.host_str().ok_or("地址格式错误")?;
        let port = url.port().unwrap_or(3478);
        let addresses = lookup_host((host, port))
            .await
            .map_err(|_| "域名解析失败")?;
        let mut attempts = Vec::new();
        for address in addresses.take(4) {
            attempts.push(async move {
                let socket = UdpSocket::bind(if address.is_ipv4() {
                    "0.0.0.0:0"
                } else {
                    "[::]:0"
                })
                .await
                .map_err(|_| "无法创建 UDP 连接")?;
                socket
                    .connect(address)
                    .await
                    .map_err(|_| "无法连接 STUN 地址")?;
                let transaction = uuid::Uuid::new_v4();
                let mut request = vec![0, 1, 0, 0, 0x21, 0x12, 0xa4, 0x42];
                request.extend_from_slice(&transaction.as_bytes()[..12]);
                socket
                    .send(&request)
                    .await
                    .map_err(|_| "STUN 请求发送失败")?;
                let mut response = [0u8; 2048];
                loop {
                    let len = socket
                        .recv(&mut response)
                        .await
                        .map_err(|_| "STUN 响应接收失败")?;
                    if len < 20
                        || response[4..8] != request[4..8]
                        || response[8..20] != request[8..20]
                    {
                        continue;
                    }
                    let declared = u16::from_be_bytes([response[2], response[3]]) as usize;
                    if declared % 4 != 0 || len != declared + 20 {
                        continue;
                    }
                    match response[..2] {
                        [1, 1] => return Ok(()),
                        [1, 17] => return Err("STUN 服务拒绝请求"),
                        _ => continue,
                    }
                }
            });
        }
        if attempts.is_empty() {
            return Err("域名未返回可用地址");
        }
        let mut attempts = futures_util::stream::FuturesUnordered::from_iter(attempts);
        use futures_util::StreamExt;
        let mut error = "STUN 请求失败";
        while let Some(result) = attempts.next().await {
            match result {
                Ok(()) => return Ok(()),
                Err(e) => error = e,
            }
        }
        Err(error)
    })
    .await
    .map_err(|_| "STUN 探测超时（网络不可达或 UDP 被拦截）".to_owned())?
    .map_err(str::to_owned)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn validates_transaction_and_accepts_binding_success() {
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let target = format!("stun:{}", socket.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut buffer = [0; 256];
            let (n, peer) = socket.recv_from(&mut buffer).await.unwrap();
            assert_eq!(n, 20);
            let mut wrong = buffer[..n].to_vec();
            wrong[0] = 1;
            wrong[1] = 1;
            wrong[8] ^= 1;
            socket.send_to(&wrong, peer).await.unwrap();
            buffer[0] = 1;
            buffer[1] = 1;
            socket.send_to(&buffer[..n], peer).await.unwrap();
        });
        assert!(probe(&target, Duration::from_secs(1)).await.is_ok());
        server.await.unwrap();
    }
    #[tokio::test]
    async fn rejects_invalid_address_and_times_out_on_unresponsive_server() {
        assert!(probe("https://invalid", Duration::from_millis(30))
            .await
            .unwrap_err()
            .contains("地址格式错误"));
        let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let target = format!("stun:{}", socket.local_addr().unwrap());
        assert!(probe(&target, Duration::from_millis(30))
            .await
            .unwrap_err()
            .contains("探测超时"));
    }
}
