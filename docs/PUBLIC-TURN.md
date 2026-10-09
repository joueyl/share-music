# 公共 TURN 配置

已经支持 Metered/Open Relay 托管 TURN，以及其他服务商的固定 TURN 凭证。直连优先，失败约 7 秒后申请中继；服务端验证房间、音源、提供者和接收者后才下发凭证。API Key 留在 NestJS，客户端只收到 TURN 用户名/密码。

## Metered

官方入口：https://www.metered.ca/tools/openrelay/ 。需要注册账户并取得应用域名与 TURN REST API Key，不是 Realtime publishable key。实际免费额度和费用以账号控制台为准。

在 `apps/server/.env` 中填写：

```dotenv
TURN_PROVIDER=metered
METERED_DOMAIN=你的应用名.metered.live
METERED_API_KEY=你的TURN_REST_API_KEY
STUN_URLS=stun:stun.miwifi.com:3478,stun:39.107.142.158:3478
PUBLIC_TURN_BUDGET_BPS=3500000
```

保留原有 TOKEN_SECRET、数据库和其他配置。密钥不要写入 Vue、Git 或聊天记录。服务端请求官方 `https://<domain>/api/v1/turn/credentials?apiKey=...`，验证返回地址，最多 5 秒超时、30 秒短缓存和并发请求合并，避免把异常响应或带密钥的 URL 回传客户端。

## 其他公共/托管服务

```dotenv
TURN_PROVIDER=static
TURN_URLS=turn:你的中继域名:3478?transport=udp,turn:你的中继域名:443?transport=tcp,turns:你的中继域名:443?transport=tcp
TURN_USERNAME=服务商提供的用户名
TURN_PASSWORD=服务商提供的密码
STUN_URL=stun:服务商提供的STUN域名:3478
PUBLIC_TURN_BUDGET_BPS=3500000
```

固定凭证过期须由运维更新，不自动生成。地址、端口和 TLS 支持必须对应供应商实际配置。

## 启动与检查

在项目根目录执行 `npm.cmd run dev:server`，脚本自动读取 `apps/server/.env`。修改 .env 后完整重启服务，所有客户端重新连接并重新开始音源，避免保留先前失败连接。生产启动 `npm.cmd run start -w @music-share/server` 也读取该文件。

`/api/health` 包含 turnProvider、publicRelayUsedBps、publicRelayBudgetBps；原来的 relayUsedBps 保留为自建中继统计。公共预算是应用预留限制，实际流量/总月配额以供应商计量为准，不能当成供应商限速或流量封顶。公共中继流量从用户流向供应商，不占本机控制服务器的 5Mbps 音频出口。

初始公共预算仍为 3.5Mbps，可按购买/免费配额自行调整；PCM 96k/24bit 双声道准入会超过此值。不要因为启用公共 TURN 就承诺多人无损容量。

当前凭证更新仍走约 45 秒链路重建，可能短暂重新缓冲。实际 NAT/TURN 可达性、TLS 路径和长时收听必须在配置真实凭证后验证。当前自动测试验证配置转换、授权和容量，不宣称真实公网中继已通。

## 多 STUN

`STUN_URLS` 支持逗号分隔的 1–4 个地址，优先于兼容配置 `STUN_URL`。无配置时默认使用上述两个地址。所有客户端在认证和媒体接入时收到同一列表，原生 ICE 配置总数最多 8。2026-10-09 本机 UDP Binding 探测验证两个地址均返回有效响应，不保证所有运营商环境都可达。STUN 只协助穿透，不提供 TURN 中继。

客户端登录后独立检查配置的 UDP STUN。探测失败在房间显示地址与原因，60 秒重试，成功后自动清除；不会将探测失败直接判为媒体连接失败。TLS STUN 不执行 UDP 诊断。
