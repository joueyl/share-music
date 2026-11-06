# 同频 TONE 服务端 API

更新：2026-11-02 · HTTP `/api` · WebSocket `/ws` · 协议版本 1。

## 通用约定

网易云后端使用 hana-music-api 3.2.0 的编程式 SDK（Node.js 24+），不启动独立 hana HTTP 服务；本项目对外接口与权限不变，现有 Cookie 沿用数据库保存值，升级见 [网易云服务端说明](NETEASE.md)。

- 本机默认地址 `http://localhost:3000`；生产环境使用 HTTPS / WSS。
- 除 `/api/health`、`/api/login` 外，业务 HTTP 请求需 `Authorization: Bearer <token>`。
- JSON 接口使用 `Content-Type: application/json`。请求对象严格校验，不接受未声明字段。
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
注册成功时保存、每次密码登录成功后覆盖 `users.last_login_ip`（IPv4/IPv6，IPv4 映射地址规范为 IPv4）。失败登录不更新，复用 token 不更新；IP 不接受请求体上报，也不在登录、`/api/me` 或房间响应中公开。默认使用直连地址，不信任转发头；经反向代理部署时配置 `TRUST_PROXY` 为可信代理 IP/CIDR 列表，并确保代理正确覆盖/追加 `X-Forwarded-For`，否则记录的是代理地址。无法获取地址时为空，不记录 IP 历史。

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

Permissions：`{skip:boolean,stream:boolean,seek:boolean,enqueue:boolean,playbackMode?:boolean}`。playbackMode 为独立“播放模式修改”权限，与 skip（切歌/播放控制）、enqueue（播放列表控制）分开；原四项必填，新增字段兼容旧请求可省略，新客户端应显式提交。
新房间默认 `{skip:true,stream:true,seek:true,enqueue:true,playbackMode:true}`，即权限全开；已有房间保留保存的默认/成员权限，房主始终拥有全部权限。`enqueue` 是“播放列表控制”的兼容协议/存储字段，统一授权添加、删除任意成员的歌曲、排序及清空，不再另设“加入播放列表”权限。

### POST /api/rooms

```json
{
  "name":"日落之前的慢半拍",
  "settings":{"description":"留一点时间给音乐","atmosphere":"sunset","visibility":"public","category":"民谣"},
  "defaults":{"skip":true,"stream":true,"seek":true,"enqueue":true,"playbackMode":true}
}
```

name 必填，1–80 字符；settings/defaults 可省略。返回 RoomSnapshot；创建成功返回前已持久化。
创建者由当前认证账号决定，内部保存为 `rooms.creator_id` 外键关联 `users.id`；同时以 `creator_name`、`creator_display_name`、`creator_avatar_url` 保存创建当时的用户名、显示名与头像快照。与会转移的 `host_id` 分离，房主转移、后续资料变化及房间保存均不覆盖创建者快照。缺少显示名时使用用户名，缺少头像为 NULL；不复制密码、盐、Cookie 或登录 IP。旧房间缺失创建者/创建时资料时保持 NULL，不按当前房主或当前资料猜测回填。请求体不接受 creatorId/creatorInfo，现有响应结构与授权规则不变，不新增公开创建者资料接口。
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
members[], playlist[], playbackMode, playback, pending, requests[], serverNow
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
{"expectedStateVersion":1,"defaults":{"skip":true,"stream":true,"seek":true,"enqueue":true,"playbackMode":true}}
```

返回 RoomSnapshot。指定成员的覆盖权限通过 WebSocket `permission` 命令设置。

## 3. 歌曲：只保存音乐直链

MySQL 保存音乐来源 ID、直链、过期时间和元数据，音频文件不在服务端持久化。
导入和续链使用 `song_url_v1` 返回的链接、`size` 与有效期，不下载音频或计算哈希；大小必须为 1–100 MiB 的整数字节数。`md5` 可作为新记录的缓存键候选，缺失或无效时生成随机键，已有键保持不变；不校验音频摘要。

### TrackMetadata

| 字段 | 说明 |
|---|---|
| id / name | UUID；名称 1–200 字符 |
| neteaseId | 新直链歌曲必有，1–20 位数字字符串；刷新不依赖旧链接 |
| sourceUrl | 新直链歌曲必有，HTTPS `*.music.126.net` 或 `*.stream.qqmusic.qq.com` 单层子域地址，最长 8192；禁止公开或记录带令牌链接 |
| sourceExpiresAt | 过期时间，Unix 毫秒。优先使用上游 expi 秒数（最多 24 小时），缺失/无效则保守按 5 分钟 |
| artists / album | 可选，最长 1000 / 500 |
| coverUrl | 可选 HTTPS 封面或 null，最长 2048 |
| durationMs | 1–86400000 |
| qqId | QQ 音乐歌曲 MID，可选，1–80 位字母数字；与 neteaseId 分开保存 |
| sizeBytes | 音频字节数；实际下载限制 100 MiB |
| spec | 可选 `{sampleRate,bits,channels}`；直链 MP3 导入不读取音频推测规格，未取得时省略 |
| lossless / bitrateBps | boolean；码率 1–20000000；当前在线导入仅支持完整 MP3 |
| contentHash | 稳定缓存/音乐库键，32 或 64 位小写十六进制；沿用历史键，新 QQ 记录使用随机 32 位键，不代表音频摘要 |

### GET /api/music/uploaded

返回共享音乐库的歌曲来源记录。
query：keywords 默认空、最长 100；offset 默认 0、范围 0–1000000；limit 默认 20、范围 1–100。
返回 `{"songs":[{id,neteaseId,name,artists,album,coverUrl,canAdd,durationMs,sizeBytes}],"total":6}`。
id 为内容哈希，不是队列 UUID；按内容去重，所有登录用户共享音乐库，每分钟 60 次。
包含可根据网易云来源 ID 恢复的旧记录；没有可续期来源的本地文件不列入可播放库，不删除历史记录。

### POST /api/music/upload

登记歌曲链接，不自动加入房间：

```json
{"songId":"123"}
```

返回 `{track:TrackMetadata}`。每用户每分钟 10 次；仅接受 songId，不接受客户端提供的任意外部 URL。

### POST /api/rooms/:id/music/netease

body：`{"songId":"123","requestId":"UUID"}`。
获取完整网易云标准音质链接，计算兼容元数据、存数据库，再入队。返回 `{ok:true,track:TrackMetadata}`。
需在线成员和播放列表控制（enqueue）权限；每用户每 10 分钟 200 次；同时最多 2 首导入/刷新。
重试复用 requestId，同一用户 requestId 不得换歌曲或房间；成功入队后才返回成功。
链接有效则跨房间、跨用户、重启后复用，避免重复请求。

### POST /api/rooms/:id/music/netease/batch

批量添加网易云歌曲，body：

```json
{"items":[{"songId":"123","requestId":"UUID"},{"songId":"456","requestId":"另一个UUID"}]}
```

- 每批 1–50 首，songId 与 requestId 各自不可重复；每项使用独立 UUID，不接受上游路由、Cookie 或 URL。
- 服务端对未缓存/接近过期的歌曲调用一次内部 Hana `batch`，合并 `/api/v3/song/detail` 与 `/api/song/enhance/player/url/v1` 两个多歌曲只读请求；有效链接仍复用，不下载音频。
- 返回 `{results:[{songId,requestId,ok:true,track}|{songId,requestId,ok:false,error}]}`，结果和入队顺序与输入一致；逐首检查权限、容量及幂等。非原子事务，成功项不因其他歌曲失败回滚。
- 每用户每 10 分钟 200 首，按歌曲数而非 HTTP 请求数计费；同时最多两个批量任务，其他单曲导入限制不变。
- 我的音乐及搜索“添加全部”每 50 首串行分组，失败项保留选择及原 requestId；请求中切换账号/房间或离页时忽略过期结果。仅“立即播放”额外对首个成功歌曲发送播放命令，普通批量添加不打断播放。
- 需要同步更新后端与客户端；旧单曲接口保留，普通浏览器代理不开放任意 `batch` 调用。

### POST /api/rooms/:id/music/qq/batch

请求/逐项响应、1–50 首限制、权限、容量、幂等、按歌曲数限流及两项批量并发上限同网易云 batch，songId 改为 QQ 歌曲 MID。搜索“添加全部”按当前音源调用对应项目 batch；QQ 上游不使用 Hana batch，服务端顺序复用既有 QQ 详情/播放链接接口，只读元数据，不下载音频。旧 QQ 单曲接口保持不变。

### POST /api/rooms/:id/music/uploaded

从音乐库按内容哈希查找稳定歌曲 ID，再复用/刷新音乐链接入队。
body：`{"hash":"32或64位小写十六进制缓存键","requestId":"UUID"}`，返回 `{ok:true,track}`，track.id 为新队列 UUID。
权限和限流同上；不存在可续期来源时返回 TRACK_NOT_FOUND。

### POST /api/rooms/:id/music/play

body：`{"trackId":"队列UUID","requestId":"UUID"}`，返回 `{ok:true,stateVersion}`。
需在线成员和切歌权限；每分钟 60 次。播放器随后通过以下接口取最新链接或音频并参与 WebSocket 同步。

### GET /api/rooms/:id/music/:trackId?refresh=0

需当前在线成员，返回 `{url,contentHash,sizeBytes}`（链接、稳定缓存键及文件大小），`Cache-Control: private, no-store`；每用户每分钟 60 次。
- 已保存链接距离过期不足 30 秒时，按稳定歌曲 ID 重新取链，成功后更新数据库。
- `refresh=1` 强制重新获取，供客户端收到 403 等链接失效或下载失败时静默调用。
- 桌面及 Web 客户端静默强制取链并重新下载一次，不弹续链提示、不无限循环；保留文件大小与下载上限检查，不计算或比较音频摘要。
- 同一稳定歌曲 ID 续链保留原缓存键，更新 URL、大小与过期时间，不修改队列 UUID、状态版本或播放时间轴，不要求手动重新添加。

### GET /api/rooms/:id/music/:trackId/metadata

返回 TrackMetadata（旧队列可能附加 providerId/available），可补齐稳定歌曲 ID 与已保存元数据。

### GET /api/rooms/:id/music/:trackId/cover

返回 `{coverUrl: string|null}`；无封面时可尝试网易云详情，每用户每分钟 30 次。

### GET /api/rooms/:id/music/:trackId/audio

网页端返回 `application/octet-stream` 原始音频，`Cache-Control: private, no-store`。
服务端代理当前音源链接，遇到 HTTP 401/403/404/410 时最多刷新并重试一次；限制总大小、超时和重定向，读取前后检查成员身份。前后端不计算音频摘要，客户端仅检查大小。
单次最多 100 MiB，每用户每分钟 30 次，进程最多两个不同下载任务。所有重定向逐跳校验允许域名，不接受本机、私网或任意 URL。
需要对应音源的管理员登录状态仍有效；被下架、无权限或仅试听的歌曲不会因重试而绕过限制。

## 4. 网易云与管理

`GET /api/netease/:method` 使用 query，`POST /api/netease/:method` 使用 JSON；均需 Bearer token。
允许方法：search、search_suggest、cloudsearch、simi_song、song_detail、song_url、song_url_v1、lyric、lyric_new、playlist_detail、playlist_track_all、user_playlist、user_account、user_cloud、login_status、album。

相似推荐：`GET /api/netease/simi_song?id=歌曲网易云ID&limit=12&offset=0`，返回上游 `songs` 列表。id 必须为 1–20 位数字，limit 为 1–100，offset 为 0–100000 的整数。客户端根据当前播放加载，过滤当前歌曲、重复结果和队列已有歌曲；点选后通过既有音乐添加接口入队，不自动播放。此功能需要同步更新服务端白名单。
仅转发白名单参数，禁止注入 Cookie、代理和地址。详情见 [NETEASE.md](NETEASE.md)、[MUSIC-SEARCH.md](MUSIC-SEARCH.md)。

管理员网易云登录页面与普通用户鉴权独立（不改变客户端用户名登录）：

| 方法 / 路径 | body / 返回 |
|---|---|
| GET /loginServe | HTML 管理页，选择网易云（二维码、手机号/邮箱密码）或 QQ 音乐（扫码） |
| POST /loginServe/qr | 返回 `{sessionId,image,expiresAt}` |
| POST /loginServe/check | `{sessionId}`，返回 `{code:800/801/802/803}` |
| POST /loginServe/password | 手机号：`{type:"phone",phone,countrycode?:"86",password}`；邮箱：`{type:"email",email,password}`。成功返回 `{code:200}` |

配置 NETEASE_ADMIN_TOKEN 时使用 HTTP Basic，用户名 admin、密码为该本地配置值；未配置时只允许直接本机访问。
POST 还检查同源 Origin；不向客户端返回已保存的 Cookie。密码登录每来源每分钟最多 5 次，全局每分钟最多 10 次。手机号为 5–20 位数字，国家区号为 1–4 位数字（不含 +，默认 86），邮箱不超过 254 字符，密码 1–128 字符，拒绝额外字段。密码仅用于本次上游请求，不持久化。失败不覆盖旧凭据；新登录请求使旧二维码/密码请求结果失效。账号密码错误返回 INVALID_CREDENTIALS；上游风控或安全验证返回 NETEASE_LOGIN_REJECTED，需改用二维码；上游不可用返回 NETEASE_UNAVAILABLE。不提供短信验证码发送或交互式风控验证。

### 服务端内部定时任务（无新增 HTTP 路由）

Asia/Shanghai 每日 08:00，有已保存的网易云 MUSIC_U 时调用 daily_signin（安卓 type=0）、yunbei_sign、vip_tasks + vip_growthpoint_get（仅真实 unGetIds）。按凭据与任务持久化当日尝试标记，晚启动仅补当天未尝试项；无登录态跳过，超时/未确认结果当日不自动重复领取。

新的网易云歌曲已提交播放并生效时，将歌曲总时长转换为秒，**播放中就上报整首总时长，而非播完后才上报**；sourceid 使用详情中的真实专辑 ID。该参数不代表实际已听满，统计是否计入由上游决定。单并发、100 项等待队列和 Worker 超时隔离，失败不阻塞其他接口或房间命令；无网易云 ID、空房间、准备失败不报告，暂停/seek/普通进度不重复报告。服务端凭据更换后旧排队任务失效；详细边界见 [网易云任务说明](NETEASE.md#服务端每日任务与播放打卡)。

副作用方法不加入 `/api/netease/:method` 白名单，普通用户不能通过代理自行签到、领取或注入听歌记录；无需新的请求参数或数据库结构迁移。

## 5. WebSocket /ws

连接后 5 秒内：`{"type":"auth","token":"..."}`，成功收到 authenticated。
加入：`{"type":"join","roomId":"UUID"}`；退出：`{"type":"leave"}`。
每账号只保留一条控制连接。房间的队列/权限操作通过：

```json
{"type":"command","data":{"commandId":"UUID","roomId":"UUID","expectedStateVersion":3,"action":{"type":"enqueue","payload":{"id":"UUID","name":"歌曲","durationMs":120000,"sizeBytes":4096,"spec":{"sampleRate":44100,"bits":16,"channels":2},"lossless":false,"bitrateBps":128000,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}}}
```

成功：`{type:'result',commandId,ok:true,stateVersion}`；失败：`{type:'result',commandId,ok:false,error}`，状态冲突还推送快照。
持久化队列/权限修改后才确认成功；数据库写失败进入保护状态，恢复数据库后需重启服务。
支持 action：playbackMode、enqueue、remove、reorder、clear、play、instant、next、previous、pause、resume、stop、seek、quality、defaults、permission。

`enqueue/remove/reorder/clear` 统一检查播放列表控制（enqueue）权限，`instant` 也须该权限及原播放权限。删除当前或准备中的歌曲返回 TRACK_IN_USE；clear 保留当前歌曲（含暂停）及时间轴，无当前歌曲时全部清空；存在 pending 时返回 PLAYBACK_TRANSITION_PENDING，不改列表。reorder 仍须提交完整且无重复的歌曲 ID。上述操作沿用版本、幂等和持久化检查。
`playbackMode` 负载为 `{mode:"queue"|"shuffle"|"single"|"loop"}`，须在线成员且有 permissions.playbackMode（播放模式修改）权限；pending 时拒绝。快照顶层 playbackMode 为当前房间模式，旧服务端缺失时客户端禁用模式入口。

- queue（默认点歌）：自然播完删除当前队列项并持久化，再接下一首；手动跳过、停止、暂停不删歌曲。
- shuffle：本轮可播放歌曲不重复，全部播过后重新随机；多首时避免跨轮首尾同曲。新增加入未播集合、删除及排序不重置本轮，不可用曲暂跳过；手动点播和上一首允许主动重复。
- single：自然播完重播同曲，手动下一首仍可切歌。
- loop：按当前列表从上到下循环，不删除歌曲。

切换不重置当前进度，模式由服务端统一广播和持久化；MySQL 复用 settings 表的 `room.playbackMode.<roomId>` 键，与房间/队列同事务保存，无结构迁移。旧房间缺省为 queue（注意自然播完会删除歌曲）。重启后保留模式、停止播放，随机轮次重新开始。

负载结构以 `packages/shared/src/index.ts` 的 commandSchema 为准。
聊天消息 `{type:'chat',roomId,requestId,text}`，text 1–500 字符；返回 chat-result/chat-error，房内广播 chat；最近 100 条仅存内存。
时钟、ready 和音源加载见 [PROTOCOL.md](PROTOCOL.md)。

## 6. 健康检查和错误

`GET /api/health` 不鉴权，含 ok、protocolVersion、chatProtocolVersion、relayUsedBps、relayBudgetBps、turnProvider、publicRelayUsedBps、publicRelayBudgetBps；会探测数据库。

| HTTP | 常见 error |
|---|---|
| 400 | INVALID_REQUEST、NAME_TAKEN、ROOM_NOT_FOUND、NOT_IN_ROOM、ROOM_FULL、STATE_CONFLICT、COMMAND_ID_REUSED、TRACK_NOT_FOUND、PLAYLIST_FULL、UPLOADED_MUSIC_METADATA_MISSING、UPLOADED_MUSIC_NOT_FOUND |
| 401 | UNAUTHORIZED、INVALID_CREDENTIALS |
| 403 | HOST_ONLY、FORBIDDEN、NETEASE_LOGIN_ORIGIN_FORBIDDEN |
| 429 | RATE_LIMITED |
| 410 | LOCAL_UPLOAD_NOT_SUPPORTED |
| 400 | MUSIC_LINK_EXPIRED、MUSIC_SOURCE_UNREFRESHABLE、MUSIC_DOWNLOAD_FAILED |
| 503 | DATABASE_UNAVAILABLE |

其他领域错误通常为 400。STATE_CONFLICT 后获取最新快照，重新确认用户意图再提交，不要无限重试。

## 7. 数据持久化边界

MySQL 保存账号、房间设置/房主/权限、歌曲直链/过期时间/来源和详情、网易云登录配置、房间队列及顺序。
在线成员、正在播放的时间轴、pending、聊天、临时权限请求、命令去重均为进程态；重启后播放停止，客户端重新 join。
旧 SQLite 从未保存的队列/历史不能凭空恢复。该版本仍要求**单服务实例**，不能仅靠 MySQL 横向扩容。


## 手机歌单短链接解析

`POST /api/music/playlist/resolve`，需 Bearer token，JSON `{ "input": "https://163cn.tv/示例短码" }`，input 为 1–4096 字符。成功返回 `{ "id": "歌单数字ID" }`，不返回链接、Cookie 或网页内容。

完整歌单链接和数字 ID 无需上游请求。短链只允许固定的 `163cn.tv` 短码路径，跟随最多 5 次手动重定向、总超时 10 秒，最终必须是 music.163.com 或 y.music.163.com 的受支持歌单链接；逐跳拒绝外域、私网地址、凭据、非标准端口和非 HTTP(S) 协议。不执行 HTML/JavaScript 跳转。每用户每分钟 20 次、全局每分钟 120 次。

失败码：`PLAYLIST_LINK_IS_ALBUM`（专辑链接，不是歌单）、`PLAYLIST_LINK_INVALID`（输入或目标不是受支持歌单）、`PLAYLIST_LINK_RESOLVE_FAILED`（超时/不可用/非 HTTP 重定向）、`PLAYLIST_LINK_REDIRECT_LIMIT`（循环/超出跳转限制）；其他鉴权和限流错误沿用通用格式。

排查部署：新版解析接口在未认证时应返回 HTTP 401 JSON；若 POST 路径返回 HTTP 404，需更新服务端或检查 `/api/` 代理转发。前端对此单独显示“短链接解析接口不存在”，与上游 301/302 跳转失败分别反馈。


## QQ 音乐接入

QQ API 默认作为服务端依赖内置运行，无需外部地址；`QQ_MUSIC_API_URL` 为可选外部覆盖。配置与限制见 [QQ-MUSIC.md](QQ-MUSIC.md)，机器可读定义见 [openapi.json](openapi.json)。不改变普通用户的用户名密码登录。

### 用户接口（Bearer 鉴权）

- `GET /api/qq/search?keyword=歌曲&offset=0`：keyword 去空白后 1–60 字，offset 为 0–100000 的 20 的倍数，固定每页 20 条。返回 `{songs:[{id,name,artists,album,coverUrl,durationMs}],total}`，id 是歌曲 MID。使用公开匿名目录，不携带播放会话；同查询并发合并，成功结果缓存 15 秒，失败不缓存。
- `GET /api/qq/lyrics/:mid`：返回 `{lrc:{lyric},tlyric:{lyric}}`；MID 为 1–80 位字母数字。
- `POST /api/rooms/:id/music/qq`：严格请求 `{songId: MID,requestId: UUID}`，返回 `{ok:true,track}`，沿用房间权限、容量、幂等 ID、异步过期保护和数据库持久化。只导入完整 128K MP3，拒绝无权播放或明确试听结果。

QQ 导入和续链只读取上游链接及 `detail.file.size_128mp3`，缺少有效大小时明确失败；不下载音频计算 MD5，不持久化音频。已有 `contentHash` 缓存键保留，新记录使用随机 32 位稳定键，客户端不作摘要校验。HTTPS 单层 CDN 白名单、100 MiB/60 秒限制、导入并发与权限检查不变；无数据库结构迁移，需同步更新后端和客户端并重建安装包。

### 管理接口（沿用 Basic/本机鉴权、同源检查、限流和 no-store）

| POST 路径 | 请求与返回 |
|---|---|
| /loginServe/qq/channels | 无请求字段；返回 `{channels:['qq','wechat','qqmusic']}` 的可用子集 |
| /loginServe/qq/status | 返回 `{loggedIn:boolean}`，不返回用户凭据 |
| /loginServe/qq/qr | `{channel:'qq'或'wechat'或'qqmusic'}`；返回 `{sessionId,image,expiresAt}` |
| /loginServe/qq/check | `{sessionId:UUID}`；返回 `{code:800/801/802/803}` |
| /loginServe/qq/cancel | `{sessionId:UUID}`；取消未完成二维码，不退出已保存账号 |

状态 800 为失效、801 待扫码、802 待确认、803 成功。新登录验证成功后仅覆盖 QQ 会话；失败或过期结果保留旧凭据。QQ 会话保存在服务端 settings，向上游以 `X-QQ-Session` 请求头发送，不出现在 URL、客户端响应或日志中。不得公开上游服务来代替项目权限检查。QQ 搜索/歌词共享每用户每分钟 60 次限流，扫码创建每分钟最多 10 次，并受管理接口总限流约束。

QQ 上游不可用或响应异常返回 HTTP 502（QQ_MUSIC_UNAVAILABLE / QQ_INVALID_RESPONSE），上游频率限制返回 429（QQ_MUSIC_RATE_LIMITED），QQ 管理会话失效返回 503（QQ_LOGIN_REQUIRED），不再统一映射为参数错误 400。搜索仅对临时网络/可重试网关故障自动重试一次，共享 20 秒总预算；不重试明确不可重试的业务拒绝、鉴权或频率限制。


### QQ 搜索联想与舞台封面

- `GET /api/qq/suggest?keyword=关键词`：Bearer 鉴权，keyword 去空白后 1–60 字，返回 `{suggestions:string[]}`，真实上游结果去重后最多 8 条。仅上游明确 `resource.not-found` 的 422 转为空列表，故障仍返回错误。与 QQ 搜索/歌词共享每用户每分钟 60 次限流。
- `GET /api/rooms/:id/music/:trackId/cover/image`：Bearer 鉴权，只读取该房间歌曲已有或恢复的封面，不接受 URL 参数。下载前后校验在线成员身份；返回 JPEG/PNG/WebP/GIF 字节，`private, no-store`。每用户 60 次/分钟，全局 120 次/分钟，最多两个不同封面下载，相同 URL 合并；10 MiB、15 秒及最多 5 次请求，每次重定向重新检查 HTTPS 图片白名单、凭据、端口与 fragment，拒绝 SVG。失败不影响音乐播放。

QQ 封面 CDN 无 CORS 许可时不能直接用于 Canvas/WebGL。舞台使用同源 Blob 图像：桌面从现有 Rust 图片下载接口取字节，Web 从上述受保护接口取字节；内嵌 Blob 封面直接复用，不重复下载音频。

独立模式权限兼容：新房间默认开启；旧房间无 defaults.playbackMode 时按旧 defaults.skip 补齐，旧成员存在 skip 覆盖且未设模式权限时迁移其原有效权限，避免升级自动提权。已有独立字段后，成员未设置则跟随房间，不再随 skip 改变。旧 defaults 请求省略新增字段时保留现值；无需数据库结构迁移，权限沿用 defaults/overrides JSON 持久化，需同步更新前后端。

## 我的音乐：主页、歌单、专辑及同频内收藏

- `POST /api/music/reference/resolve`：Bearer 鉴权，严格 body `{input:string}`（1–4096），返回 `{kind:"user"|"playlist"|"album",id:string}`。每用户 20 次/分钟、全局 120 次/分钟。长链本地识别，短链仅请求固定 163cn.tv HTTPS，最多 5 次/10 秒，逐跳拒绝凭据、非默认端口、私网/外域与不支持资源；不获取最终网页，不转发任何认证。错误为 MUSIC_LINK_INVALID / MUSIC_LINK_RESOLVE_FAILED / MUSIC_LINK_REDIRECT_LIMIT。
- `/api/netease/user_playlist?uid=<主页用户ID>&offset=0&limit=30`：分页获取该用户可访问的歌单，包括上游允许展示的创建/收藏列表，不保证读取私有列表。新页面逐页加载，每批最多 100 页，超大列表可继续加载；不从歌单 creatorId 或专辑 userid 推断需要加载主页。
- `/api/netease/playlist_detail?id=<歌单ID>`、`playlist_track_all?id=...&offset=...&limit=50` 沿用原接口；新增只读 `album?id=<专辑ID>`，返回上游真实 album/songs，id 为 1–20 位数字。歌单/专辑歌曲仍通过现有房间导入接口加入播放列表，原权限、容量和 requestId 幂等规则不变。
- `GET /api/music/favorites`：Bearer 鉴权，返回 `{collections:MusicCollection[]}`，仅当前同频账号可见；每用户 60 次/分钟。
- `PUT /api/music/favorites`：Bearer 鉴权，严格 `{kind:"playlist"|"album",id:"数字ID",saved:boolean}`。true 收藏，false 取消；返回最新 `{collections}`。每用户 20 次/分钟、全局 120 次/分钟，每账号最多 200 项（MUSIC_FAVORITES_FULL）。客户端不能指定 userId 或伪造名称/封面，收藏元数据由服务端向真实网易云详情接口验证；同账号并发写串行化防止覆盖，重复收藏/取消结果幂等。损坏的存量数据返回 MUSIC_FAVORITES_INVALID，不静默清空。

MusicCollection 包含 kind/id/name/coverUrl/trackCount/creatorId，可带 description。收藏保存在 settings 的 `music.favorites.<同频用户UUID>` JSON 中，跨客户端/重启保留，不更改共享网易云账号的歌单收藏；无数据库结构迁移。当前与房间一样以单服务进程为基准，不提供多实例收藏写锁。需同步更新前后端，桌面重建。
