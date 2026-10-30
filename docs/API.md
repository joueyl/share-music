# 同频 TONE 服务端 API

更新：2026-10-29 · HTTP `/api` · WebSocket `/ws` · 协议版本 1。

## 通用约定

- 本机默认地址 `http://localhost:3000`；生产环境使用 HTTPS / WSS。
- 除 `/api/health`、`/api/login` 外，业务 HTTP 请求需 `Authorization: Bearer <token>`。
- JSON 接口使用 `Content-Type: application/json`；不再支持原始音频上传。请求对象严格校验，不接受未声明字段。
- UUID 字段采用标准 UUID；时间戳和时长均为毫秒；`offset` 从 0 开始。
- NestJS 默认成功状态：GET/PUT 为 **200**，POST 为 **201**。
- 错误为 `{"error":"错误码"}`，参数错误还带 `issues:[{path,message}]`。
- token 为自定义 HMAC 签名格式，**不是 JWT**，有效期 24 小时。更换 TOKEN_SECRET 会使旧 token 失效。
- 机器可读 HTTP 文档：[openapi.json](openapi.json)，可导入 Swagger Editor/Postman。

## 1. 用户

### POST /api/login

注册和登录共用，均仅使用 **用户名 + 密码**，不需要邮箱或邮箱验证码。请求不接受 email 字段。

```json
{"name":"listener","password":"example-password-123","register":true}
```

| 字段 | 规则 |
|---|---|
| name | 必填用户名，去除首尾空白，2–40 字符；区分大小写 |
| password | 10–128 字符；现有账号密码和哈希原样兼容 |
| register | boolean，默认 false；true 创建账号，false 登录 |

返回：`{"token":"...","user":{"id":"UUID","name":"用户名"}}`。
登录限流：同 IP 每分钟 10 次。忘记密码和可变登录有效期尚未实现。邮箱不参与认证；用户名中即使包含 @ 也只按普通用户名处理，不自动转小写、不自动写入邮箱。

### GET /api/me

返回当前用户公开资料，不返回 passwordHash/salt：

```json
{"id":"UUID","name":"listener","displayName":"listener","avatarUrl":null}
```

avatarUrl 可为 null；头像和显示名目前为数据库预留字段，暂无资料修改接口。

## 2. 房间

### 房间设置 RoomSettings

| 字段 | 类型 / 默认 / 限制 |
|---|---|
| description | string，默认空，最长 500 |
| atmosphere | sunset / night / weekend / custom，默认 sunset；对应日落山谷、深夜电台、慵懒周末、自定义 |
| visibility | public / invite，默认 public |
| category | string，默认空，最长 40，例如“民谣”“轻音乐” |
| coverUrl | HTTPS URL 或 null，默认 null，最长 2048 |

Permissions：`{skip:boolean,stream:boolean,seek:boolean,enqueue:boolean}`，四项均需提供。
默认 `{skip:false,stream:false,seek:false,enqueue:true}`，即成员可点歌，房主控制播放；房主始终拥有全部权限。

### POST /api/rooms

```json
{
  "name":"日落之前的慢半拍",
  "settings":{"description":"留一点时间给音乐","atmosphere":"sunset","visibility":"public","category":"民谣"},
  "defaults":{"skip":false,"stream":false,"seek":false,"enqueue":true}
}
```

name 必填，1–80 字符；settings/defaults 可省略。返回 RoomSnapshot；创建成功返回前已持久化。
每个用户每分钟最多创建 5 次。设计图中的 24 字限制未强制到旧接口，继续兼容现有 80 字规则。

### GET /api/rooms?keywords=&category=

keywords 最长 100，搜索名称和描述；category 最长 40，精确匹配。
返回数组：`[{id,name,hostId,settings,members,maxMembers,qualityMode}]`。
仅返回公开房间以及调用者自己的邀请房间；不返回邀请码。在线人数来自实时连接，容量仍为 **8 人**，设计图人数为示意，不改变现有音频容量限制。

### GET /api/rooms/resolve/:code

code 为 12 位十六进制房间码，返回 `{id,name}`，随后通过 WebSocket join 加入。
邀请房间不公开展示；持有房间码或完整房间 UUID/链接即可加入，不是房主审批制。请勿公开分享私密房间链接。

### GET /api/rooms/:id

仅房主或当前在线成员可获取 RoomSnapshot：

```text
id, name, hostId, settings, inviteCode, stateVersion, defaults,
members[], playlist[], playback, pending, requests[], serverNow
```

`members` 包含 id/name/joinedAt/online/overrides/permissions。
`playlist` 为歌曲 TrackMetadata 加 providerId/available。
完整播放结构和同步机制见 [PROTOCOL.md](PROTOCOL.md)。

### PUT /api/rooms/:id/settings

仅房主可调用（无需先在线 join）；乐观锁 `expectedStateVersion` 必须为最新值。

```json
{"expectedStateVersion":0,"name":"把夜晚调成静音","settings":{"description":"不必说话","atmosphere":"night","visibility":"invite","category":"轻音乐","coverUrl":null}}
```

返回更新后的 RoomSnapshot。**PUT 为完整替换设置**：settings 中省略的属性恢复默认值；name 可省略则不改名。

### PUT /api/rooms/:id/permissions

房主需先在线 join：

```json
{"expectedStateVersion":1,"defaults":{"skip":false,"stream":false,"seek":false,"enqueue":true}}
```

返回 RoomSnapshot。指定成员的覆盖权限通过 WebSocket `permission` 命令设置。

## 3. 歌曲：只保存音乐直链

音乐不再上传到 OSS，也不在服务端持久化音频文件。MySQL 保存来源 ID、直链、过期时间和元数据。
为兼容现有客户端的 SHA-256 缓存校验，首次导入及刷新时会临时读取音频计算哈希/音频参数，读完即丢弃，不写音频文件。

### TrackMetadata

| 字段 | 说明 |
|---|---|
| id / name | UUID；名称 1–200 字符 |
| neteaseId | 新直链歌曲必有，1–20 位数字字符串；刷新不依赖旧链接 |
| sourceUrl | 新直链歌曲必有，HTTPS 网易云音乐 CDN 单层子域地址，最长 8192；禁止公开或记录带令牌链接 |
| sourceExpiresAt | 过期时间，Unix 毫秒。优先使用上游 expi 秒数（最多 24 小时），缺失/无效则保守按 5 分钟 |
| artists / album | 可选，最长 1000 / 500 |
| coverUrl | 可选 HTTPS 封面或 null，最长 2048 |
| durationMs | 1–86400000 |
| sizeBytes | 音频字节数；实际下载限制 100 MiB |
| spec | `{sampleRate,bits,channels}`，整数音频规格 |
| lossless / bitrateBps | boolean；码率 1–20000000；当前在线导入仅支持完整 MP3 |
| contentHash | 真实音频字节 SHA-256，64 位小写十六进制 |
| ossKey / ossUrl | 仅旧数据兼容保留，新导入不返回、不使用 OSS 播放 |

### GET /api/music/uploaded

保留旧路径兼容客户端，但现在返回**音乐库**，不再读取 OSS 上传索引。
query：keywords 默认空、最长 100；offset 默认 0、范围 0–1000000；limit 默认 20、范围 1–100。
返回 `{"songs":[{id,neteaseId,name,artists,album,coverUrl,canAdd,durationMs,sizeBytes}],"total":6}`。
id 为内容哈希，不是队列 UUID；按内容去重，所有登录用户共享音乐库，每分钟 60 次。
包含可根据网易云来源 ID 恢复的旧记录；没有可续期来源的本地文件不列入可播放库，不删除历史记录。

### POST /api/music/upload

路径保留，语义改为**登记歌曲链接**，不自动加入房间：

```json
{"songId":"123"}
```

返回 `{track:TrackMetadata}`。每用户每分钟 10 次；仅接受 songId，不接受客户端提供的任意外部 URL。
原 `application/octet-stream` 上传明确返回 **410 / LOCAL_UPLOAD_NOT_SUPPORTED**，X-Music-Filename 不再使用。

### POST /api/rooms/:id/music/netease

body：`{"songId":"123","requestId":"UUID"}`。
获取完整网易云标准音质链接，计算兼容元数据、存数据库，再入队。返回 `{ok:true,track:TrackMetadata}`。
需在线成员和 enqueue 权限；每用户每 10 分钟 200 次；同时最多 2 首导入/刷新。
重试复用 requestId，同一用户 requestId 不得换歌曲或房间；成功入队后才返回成功。
链接有效则跨房间、跨用户、重启后复用，避免重复请求。

### POST /api/rooms/:id/music/uploaded

保留旧路径，改为从音乐库按内容哈希查找稳定歌曲 ID，再复用/刷新音乐链接入队。
body：`{"hash":"64位小写SHA-256","requestId":"UUID"}`，返回 `{ok:true,track}`，track.id 为新队列 UUID。
权限和限流同上；不存在可续期来源时返回 TRACK_NOT_FOUND，不访问 OSS。

### POST /api/rooms/:id/music/play

body：`{"trackId":"队列UUID","requestId":"UUID"}`，返回 `{ok:true,stateVersion}`。
需在线成员和切歌权限；每分钟 60 次。播放器随后通过以下接口取最新链接或音频并参与 WebSocket 同步。

### GET /api/rooms/:id/music/:trackId?refresh=0

需当前在线成员，返回 `{url}`，`Cache-Control: private, no-store`；每用户每分钟 60 次。
- 已保存链接距离过期不足 30 秒时，按稳定歌曲 ID 重新取链，成功后更新数据库。
- `refresh=1` 强制重新获取，供桌面端发现链接提前失效时调用。
- 桌面端下载失败最多强制取链重试一次；再次失败直接报错，不无限循环。
- 刷新后的音频哈希或长度变化时返回 MUSIC_CONTENT_CHANGED，需重新添加歌曲，不降低缓存完整性验证。

### GET /api/rooms/:id/music/:trackId/metadata

返回 TrackMetadata（旧队列可能附加 providerId/available），可补齐稳定歌曲 ID 与已保存元数据。

### GET /api/rooms/:id/music/:trackId/cover

返回 `{coverUrl: string|null}`；无封面时可尝试网易云详情，每用户每分钟 30 次。

### GET /api/rooms/:id/music/:trackId/audio

网页端返回 `application/octet-stream` 原始音频，`Cache-Control: private, no-store`。
服务端代理当前网易云链接，遇到 HTTP 401/403/404/410 时最多刷新并重试一次；校验字节数和哈希，读取前后检查成员身份。
单次最多 100 MiB，每用户每分钟 30 次，进程最多两个不同下载任务。所有重定向逐跳校验允许域名，不接受本机、私网或任意 URL。
需要管理员网易云登录状态仍有效；被下架、无权限或仅试听的歌曲不会因重试而绕过限制。

## 4. 网易云与管理

`GET /api/netease/:method` 使用 query，`POST /api/netease/:method` 使用 JSON；均需 Bearer token。
允许方法：search、search_suggest、cloudsearch、simi_song、song_detail、song_url、song_url_v1、lyric、lyric_new、playlist_detail、playlist_track_all、user_playlist、user_account、user_cloud、login_status。

相似推荐：`GET /api/netease/simi_song?id=歌曲网易云ID&limit=12&offset=0`，返回上游 `songs` 列表。id 必须为 1–20 位数字，limit 为 1–100，offset 为 0–100000 的整数。客户端根据当前播放加载，过滤当前歌曲、重复结果和队列已有歌曲；点选后通过既有音乐添加接口入队，不自动播放。此功能需要同步更新服务端白名单。
仅转发白名单参数，禁止注入 Cookie、代理和地址。详情见 [NETEASE.md](NETEASE.md)、[MUSIC-SEARCH.md](MUSIC-SEARCH.md)。

管理员扫码页面与普通用户鉴权独立：

| 方法 / 路径 | body / 返回 |
|---|---|
| GET /loginServe | HTML 扫码管理页 |
| POST /loginServe/qr | 返回 `{sessionId,image,expiresAt}` |
| POST /loginServe/check | `{sessionId}`，返回 `{code:800/801/802/803}` |

配置 NETEASE_ADMIN_TOKEN 时使用 HTTP Basic，用户名 admin、密码为该本地配置值；未配置时只允许直接本机访问。
POST 还检查同源 Origin；不向客户端返回已保存的 Cookie。

## 5. WebSocket /ws

连接后 5 秒内：`{"type":"auth","token":"..."}`，成功收到 authenticated。
加入：`{"type":"join","roomId":"UUID"}`；退出：`{"type":"leave"}`。
每账号只保留一条控制连接。房间的队列/权限操作通过：

```json
{"type":"command","data":{"commandId":"UUID","roomId":"UUID","expectedStateVersion":3,"action":{"type":"enqueue","payload":{"id":"UUID","name":"歌曲","durationMs":120000,"sizeBytes":4096,"spec":{"sampleRate":44100,"bits":16,"channels":2},"lossless":false,"bitrateBps":128000,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}
```

成功：`{type:'result',commandId,ok:true,stateVersion}`；失败：`{type:'result',commandId,ok:false,error}`，状态冲突还推送快照。
持久化队列/权限修改后才确认成功；数据库写失败进入保护状态，恢复数据库后需重启服务。
支持 action：enqueue、remove、reorder、clear、play、instant、next、previous、pause、resume、stop、seek、quality、defaults、permission。
负载结构以 `packages/shared/src/index.ts` 的 commandSchema 为准。
聊天消息 `{type:'chat',roomId,requestId,text}`，text 1–500 字符；返回 chat-result/chat-error，房内广播 chat；最近 100 条仅存内存。
时钟、信令、ready、直播和带宽租约见 [PROTOCOL.md](PROTOCOL.md)。

## 6. 健康检查和错误

`GET /api/health` 不鉴权，含 ok、protocolVersion、chatProtocolVersion、relayUsedBps、relayBudgetBps、turnProvider、publicRelayUsedBps、publicRelayBudgetBps；会探测数据库。

| HTTP | 常见 error |
|---|---|
| 400 | INVALID_REQUEST、NAME_TAKEN、ROOM_NOT_FOUND、NOT_IN_ROOM、ROOM_FULL、STATE_CONFLICT、COMMAND_ID_REUSED、TRACK_NOT_FOUND、PLAYLIST_FULL、UPLOADED_MUSIC_METADATA_MISSING、UPLOADED_MUSIC_NOT_FOUND |
| 401 | UNAUTHORIZED、INVALID_CREDENTIALS |
| 403 | HOST_ONLY、FORBIDDEN、NETEASE_LOGIN_ORIGIN_FORBIDDEN |
| 429 | RATE_LIMITED |
| 410 | LOCAL_UPLOAD_NOT_SUPPORTED |
| 400 | MUSIC_LINK_EXPIRED、MUSIC_SOURCE_UNREFRESHABLE、MUSIC_CONTENT_CHANGED、MUSIC_DOWNLOAD_FAILED |
| 503 | DATABASE_UNAVAILABLE |

其他领域错误通常为 400。STATE_CONFLICT 后获取最新快照，重新确认用户意图再提交，不要无限重试。

## 7. 数据持久化边界

MySQL 保存账号、房间设置/房主/权限、歌曲直链/过期时间/来源和详情、历史上传索引、网易云登录配置、房间队列及顺序。
在线成员、正在播放的时间轴、pending、聊天、临时权限请求、命令去重均为进程态；重启后播放停止，客户端重新 join。
旧 SQLite 从未保存的队列/历史不能凭空恢复。该版本仍要求**单服务实例**，不能仅靠 MySQL 横向扩容。


## 手机歌单短链接解析

`POST /api/music/playlist/resolve`，需 Bearer token，JSON `{ "input": "https://163cn.tv/示例短码" }`，input 为 1–4096 字符。成功返回 `{ "id": "歌单数字ID" }`，不返回链接、Cookie 或网页内容。

完整歌单链接和数字 ID 无需上游请求。短链只允许固定的 `163cn.tv` 短码路径，跟随最多 5 次手动重定向、总超时 10 秒，最终必须是 music.163.com 或 y.music.163.com 的受支持歌单链接；逐跳拒绝外域、私网地址、凭据、非标准端口和非 HTTP(S) 协议。不执行 HTML/JavaScript 跳转。每用户每分钟 20 次、全局每分钟 120 次。

失败码：`PLAYLIST_LINK_IS_ALBUM`（专辑链接，不是歌单）、`PLAYLIST_LINK_INVALID`（输入或目标不是受支持歌单）、`PLAYLIST_LINK_RESOLVE_FAILED`（超时/不可用/非 HTTP 重定向）、`PLAYLIST_LINK_REDIRECT_LIMIT`（循环/超出跳转限制）；其他鉴权和限流错误沿用通用格式。

排查部署：新版解析接口在未认证时应返回 HTTP 401 JSON；若 POST 路径返回 HTTP 404，需更新服务端或检查 `/api/` 代理转发。前端对此单独显示“短链接解析接口不存在”，不再与上游 301/302 跳转失败混为一谈。
