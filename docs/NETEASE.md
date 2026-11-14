# 网易云服务端登录

服务端使用固定版本 `hana-music-api` 3.2.0，通常通过公开 Promise SDK `invokeModule(identifier, query, config)` 编程式调用；固定只读批量请求使用 SDK 的公开 `createRequest`，不部署或连接独立的 hana HTTP 服务。参考 [API 文档](https://hana-music-api.netlify.app/api/)及[编程式调用](https://hana-music-api.netlify.app/guide/programmatic-api)。SDK 要求 **Node.js 24+、ESM**；项目仍使用 NestJS CommonJS，通过原生 Worker 内的动态 `import()` 加载 SDK，避免编译器把导入转换成 require。

## 从旧依赖升级

升级 Node.js 至 24+ 后，在项目根目录执行 `npm ci`、`npm run build`，再重启服务端；容器需重新构建镜像，不能只重启旧容器。npm 与 pnpm 锁文件均已同步，不再依赖旧网易云 API 包。现有数据库 `netease.cookie` 和每日尝试标记原样复用，无结构迁移，无需清空登录态。客户端 API、鉴权和只读白名单不变，客户端无需因本次服务端 SDK 替换而升级。

## 使用

1. 重启服务端：`npm run dev:server`。
2. 在服务端本机浏览器访问 http://127.0.0.1:3000/loginServe。
3. 默认用网易云音乐 App 扫码并确认；也可切换手机号或邮箱，输入网易云音乐密码登录。手机号支持国家区号（默认 86），不发送短信验证码；若上游要求安全验证，请改用扫码。页面显示成功后，Cookie 登录凭据写入当前配置的数据库 settings 表（生产 MySQL，测试可用 SQLite），密码不持久化。
4. 再次访问此页面或点击重新获取二维码，会创建新二维码；旧凭据一直保留到新登录确认成功时才覆盖。旧二维码及在途密码请求结果不能覆盖更新的登录请求。密码登录失败不覆盖旧凭据，每来源每分钟最多 5 次、全局每分钟最多 10 次。二维码有效等待上限三分钟，过期请重新获取。

没有把网易云 Cookie 当成本项目的 Bearer token，也不会把 Cookie 返回页面、存入 localStorage 或响应 Set-Cookie。该集成是服务端全局单账号，不是每位房间成员各自的网易云账号。数据库内含可复用登录凭据，当前为明文保存：请限制数据库及备份的系统文件权限，不对外暴露，不提交 Git；Docker 部署沿用 /data 持久卷。凭据自然过期后需重新登录。

## 公网管理

默认只允许直接来自本机且 Host 为 localhost/127.0.0.1/[::1] 的管理访问；经反向代理或远程访问默认拒绝，避免任何访客替换全局账号。

设置服务端 `NETEASE_ADMIN_TOKEN` 为独立的高强度管理口令。浏览器认证对话框用户名为 `admin`，密码为该口令。公网必须使用 HTTPS。反向代理场景同时设置 `NETEASE_LOGIN_ORIGIN=https://你的实际域名`，并按 Nginx 示例转发 `/loginServe`。不要将管理口令放在 URL、二维码或前端代码中。

## 自动携带凭据

业务代码通过 `app.netease.call(method, params)` 统一调用，始终从数据库取最新 Cookie 注入，不依赖进程内缓存，重启仍有效。已开放的只读方法：search、search_suggest、cloudsearch、simi_song、song_detail、song_url、lyric、lyric_new、playlist_detail、playlist_track_all、user_playlist、user_detail、user_account、user_cloud、login_status、album。

HTTP 路径 `GET /api/netease/:method`（查询参数）或 `POST /api/netease/:method`（JSON）。调用者必须携带本项目登录获得的 `Authorization: Bearer ...`。例如 `/api/netease/song_detail?ids=123`。服务端内部再携带网易云 Cookie，客户端不需要知道该凭据。客户端提供的 cookie、代理、IP、域名等覆盖参数不会被转发。没有开放第三方包中的账号修改、登出和任意模块调用接口；需要更多接口时明确扩展方法及参数白名单。

适配层把业务参数传给 `query`，Cookie 放到独立的 `config.cookie`，不再将旧库的 timestamp/noCookie 执行参数塞进业务输入。每次 SDK 调用超时 15 秒，Worker 18 秒终止，外层服务调用仍以 20 秒封顶；显式配置零重试，尤其不能在签到、领取或打卡超时后自动重复副作用。Worker 标准输出/错误输出不写服务端日志。登录拒绝只保留业务 code（包括风控 10004），打卡业务拒绝仅交给后台任务判断是否接受，不打印响应正文；其余传输/结构错误统一返回应用错误码。响应中的 Cookie/token 字段继续过滤，登录成功凭据仅存数据库。

进程内默认 SDK 调用器最多同时保留 4 个 Worker，歌词、相似推荐、取链、登录及后台账号任务共用此上限；满额时不创建 Worker、不排队、不自动重试，立即返回既有 `NETEASE_UNAVAILABLE`。成功、失败及超时均等待 Worker 真正终止后才释放名额并结束调用，避免快速切歌时 SDK 实例及待退出的旧 Worker 无界叠加。此限制不代表进程总内存硬上限，也不保证满载时每个请求成功；线上 RSS 峰值与回落仍需实际部署复测。

## 验证与限制

开发模式 `node --watch` 会设置 `WATCH_REPORT_DEPENDENCIES`，Worker 导入模块时可能先通过 parentPort 发送 `watch:import` 依赖报告。适配器只处理带 `music-share:hana-result` 标识的结果，不能把端口首条消息直接当作业务结果；不关闭热重载，不放宽接口或凭据校验。

排查“网易云服务暂不可用”时，先看 NestJS 服务端终端的 `网易云 SDK 调用失败`：`phase=worker_setup` 表示入口解析或创建 Worker 失败，`import` 表示加载 SDK 失败，`request` 表示调用被拒绝，`response_shape` 表示上游结构不符合 SDK 校验，`invalid_response` 表示 SDK 返回对象异常，`timeout` / `worker_error` / `worker_exit` 表示 Worker 超时或异常。诊断仅包含方法名、固定阶段、数值 status/bodyCode 和格式受限的字段路径，不打印原始异常、请求参数、URL 或凭据；HTTP 客户端仍收到通用错误，不公开内部诊断。SDK 没有独立监听端口，不应通过“hana HTTP 服务是否启动”判断是否可用；健康检查成功也不等于网易云请求成功。

迁移测试覆盖 SDK 配置分离、ESM Worker 加载、业务拒绝/畸形返回/超时、真实安装的 hana SDK 本地二维码生成，以及用拦截 fetcher 对现有模块标识的离线兼容检查；既有测试覆盖二维码状态、自动附带凭据、重登覆盖、过期/并发旧会话保护、持久化和路由权限。这些不是网易云真实登录、搜索/取链或听歌统计联调；新 SDK 可能对上游响应结构有更严格的校验，不应把结构错误伪装为空列表或成功。依赖替换不等于所有安全漏洞已修复，应针对当前锁文件重新审计。

## 部署后获取二维码提示 FORBIDDEN

旧逻辑直接用后端收到的 HTTP 协议与浏览器 HTTPS Origin 比较，TLS 在反向代理终止时会误拒绝；Nginx 使用 `$host` 还可能丢掉非标准端口。

优先在服务器设置 `NETEASE_LOGIN_ORIGIN` 为浏览器实际访问的 Origin，例如 `https://music.example.com:8443`，不要包含 `/loginServe`、查询参数或片段。管理密码 `NETEASE_ADMIN_TOKEN` 保持配置。正常进程重启后生效；Docker Compose 的 env_file 改动需要重新创建 API 容器（`docker compose -f deploy/compose.yml up -d --build --force-recreate api`，在项目根目录执行），仅 restart 不更新容器环境变量。

Nginx `/loginServe` 转发需覆盖 `Host $http_host` 和 `X-Forwarded-Proto $scheme`，保留外部端口且不允许客户端伪造协议。新代码仅接受直接连接的回环代理传来的单一 http/https 协议头，不全局启用 trust proxy；Docker 网桥或其他代理需显式配置上述 Origin。配置错误仍拒绝跨站来源，并显示专用错误 `NETEASE_LOGIN_ORIGIN_FORBIDDEN`，不会关闭管理认证或放开所有来源。


`/loginServe` 也可切换 QQ 音乐扫码，两种音源会话独立；网易云原有配置和操作不变。QQ 部署与范围见 [QQ-MUSIC.md](QQ-MUSIC.md)。

## 批量请求的参数适配

Hana 3.2.0 的 `batch` 模块输入要求子请求参数为对象，但默认加密请求直接保留嵌套对象；网易云 `/api/batch` 要求每个子请求参数为 JSON 字符串。房间单首添加、播放取链、强制续链与批量添加统一使用这条 batch 路径；播放器子请求使用非 v1 `song_url`（`br=128000`），不调用或回退 v1，不在失败后追加接口轮询。项目仅对固定的 `/api/v3/song/detail` 和 `/api/song/enhance/player/url`，在 Worker 内序列化参数，再调用公开 `createRequest('/api/batch', data, config)`。不修改 node_modules，不开放任意上游路径，继续沿用 Cookie 注入、超时、无自动重试及逐项权限/缓存规则。

此前空 Cookie 对照确认了对象参数的业务码 400 与 JSON 字符串参数的正确编码；当前播放器子请求已改为非 v1 `song_url`，ids 使用 JSON 字符串数组、br 固定 128000，不再使用 level/encodeType。新接口的一次空 Cookie 对照返回子请求 200，但所测歌曲音频项为 404、无链接，未证明完整歌曲可播放。该验证不代表登录歌曲的完整播放权限；隔离入队验证中试听音源仍会被 `MUSIC_TRIAL_ONLY` 拦截，不绕过试听限制。修复仅需更新、构建并重启后端，客户端批量接口不变。

### batch 响应校验失败

batch 的 HTTP/SDK 返回成功不代表所有子请求成功。服务端出现 `网易云 batch 响应校验失败` 时，仅记录固定 `phase`（`business_rejected` 或 `response_shape`）、`stage`（batch / song_detail / song_url）、有限数值代码，以及代码/详情/列表字段的类型；不记录完整响应、歌曲 ID、URL、Cookie 或上游消息。

已存在的数值业务拒绝（如根响应 400、播放器子请求 -460）返回 `NETEASE_UNAVAILABLE`，明确的 301 返回 `NETEASE_LOGIN_REQUIRED`；缺少字段或类型不匹配才返回 `NETEASE_INVALID_RESPONSE`。整批只记录一次对应的上游失败，不按 50 首重新请求或自动回退；有错误不视为已恢复。定位线上失败需取得这条脱敏日志，仅有客户端错误名不足以确认原因。

### 同服务器匿名只读对照

当线上日志为 `rootCode=200`、`detailCode=200`、`sourceCode=-460` 时，已确认仅播放器子请求被上游拒绝；不再将其当成响应结构错误，也不能声称换成 batch 就解决了线上问题。

在同一台服务器使用同一歌曲的正整数 ID，手动运行一次：

```sh
node <项目绝对路径>/scripts/diagnose-netease-source.mjs <歌曲数字ID>
```

脚本通过服务端安装位置解析 Hana SDK，只调用一次固定 batch 元数据接口，Cookie 强制为空，禁用重试；不读取 `.env`、数据库或保存的凭据，不下载音频、创建房间、写入数据或执行签到。输出仅包含有限数值状态、是否有对应元数据/链接及试听标记，不输出链接、歌曲名称或上游消息。未对真实线上服务器执行该诊断。

- 匿名对照收到正常播放器元数据、但现有登录态请求仍被拒绝：需要进一步核对账号/登录态相关请求差异，不能直接认定 Cookie 已失效；匿名可取到试听元数据也不代表完整播放权限。
- 匿名对照也返回 -460：说明拒绝不只发生于现有保存的登录态；仍不能直接断言是服务器 IP 被封，需要进一步核对共同请求路径和网络环境。
- `request_failed` 或 SDK 加载失败不作为账号/服务器拒绝的对照结论；提供该脚本的一行脱敏输出即可，不发送 Cookie 或完整响应。不轮询、不自动重复登录、不伪造来源 IP。

## 单曲取链失败的脱敏定位

`网易云 SDK 调用失败` 中的方法名允许数字后缀，不会误显示为 `unknown`。保留阶段、数值状态及业务码；SDK 请求事件仅映射为固定 `upstreamStep` 标签：`anonymous_registration`（匿名初始化）、`song_url`（非 v1 播放器取链）、`batch`（批量读取）。未知路径不输出标签，不记录事件原始 URL、查询、请求头、Cookie 或错误消息。

`phase=request` 和 `bodyCode=-460` 只能用于定位 SDK 请求阶段的拒绝，不能仅凭此认定 Cookie 失效、批量接口故障或服务器 IP 已被封。先结合具体操作及固定步骤标签核对；当前不为此错误额外自动重试，不伪造来源 IP、不自动清空登录态。诊断修复本身不代表恢复取链；房间音乐业务现改为统一使用上述固定 batch 路径，播放器子请求及通用代理均改用非 v1 `song_url`；原 `song_url_v1` 代理调用现返回 `NETEASE_METHOD_NOT_ALLOWED`。需要更新、构建并重启后端，由线上实际进程验证；若 batch 同样被拒绝则返回真实失败，不保证解除任何上游限制，无需升级客户端。

## 服务端每日任务与播放打卡

- 使用数据库 `netease.cookie` 中的 MUSIC_U 登录态，不是项目 Bearer token、TOKEN_SECRET 或 QQ 会话。Asia/Shanghai 每天 **08:00** 并行尝试安卓签到（`daily_signin`，`type=0`）、PC 签到（`daily_signin`，`type=1`）、云贝签到（`yunbei_sign`）；等待三项均结束（包括失败或超时）后，再读取 `vip_tasks` 的 `data.taskList[].taskItems[]`，仅领取 `needReceive === true` 的真实 taskId；同时兼容带 unGetIds 的响应。调用 `vip_growthpoint_get` 时去重并有界校验 ID；无待领取 ID 不伪造奖励，不做任务刷取或付费操作。
- 服务重启晚于 08:00 时只补当天未尝试的任务，不追补旧日期；08:00 无凭据则跳过。凭据过期由上游真实拒绝，需管理员重新登录。任务启动前持久化当日尝试标记（`netease.daily.<登录态指纹>.<任务>`），超时/未知结果当日不自动重试，以免重复执行有副作用的请求；记录在 settings 表，无结构迁移。凭据更换后旧待处理任务不能使用新账号凭据。安卓、PC、云贝与 VIP 领取各自持久化标记；升级保留旧标记，PC 作为新任务可补当天，已尝试的签到及领取不会重做。单项签到失败不阻断其他签到，三项结束后仍可查询并领取上游实际可领取的奖励；停止服务或凭据更换不会用新凭据继续旧领取。当前为单服务进程调度，不提供跨实例分布式任务锁。
- 房间新的歌曲播放经 ready/提交生效且仍有在线成员后，将网易云 ID、歌曲总时长加入独立打卡队列。**在播放中即提交整首总时长（秒），不等播完；该参数不是实测听歌时长，也不保证上游按完整收听计入统计。** 后台读取 song_detail 取得真实专辑 ID 作为 sourceid，以队列 durationMs 与详情 dt/duration 较小值转整秒作为 scrobble.time。元数据缺失、非网易云、过短歌曲或空房间跳过，不用随机来源 ID 冒充歌单/专辑。
- 每次新的切歌/循环播放可上报一次，普通快照、进度、暂停/继续、seek、音质同步和幂等重试不会重复打卡。歌曲加载准备中或取消/失败的准备不打卡。上报失败不回滚播放或队列，不伪造成功回执。
- 打卡为单并发、最多 100 项等待队列，与每日任务和 HTTP 业务调用无共享串行锁；满队列丢弃并输出不含凭据的提示。沿用独立 Worker 和 18 秒 Worker/20 秒服务调用超时，不让慢打卡占住搜索、导入、取链或播放命令；关闭服务停止调度、丢弃等待项，并等待有界的在途调用结束后关闭数据库。
- 这些副作用方法只允许服务端内部固定参数调用，`/api/netease/:method` 仍保持只读白名单。每日任务日志仅输出固定任务名和确认状态；听歌打卡不打印响应 body、歌曲 ID、来源 ID 或上报时长，成功时保持安静，仅保留失败/超时和队列满等固定异常提示，不输出凭据或上游原始异常。SDK 失败诊断仍按前述脱敏规则保留。只有真实账号联调才能验收签到、领取或排行结果，单元测试不代表已获得奖励。

已核对 hana-music-api 3.2.0 的 daily_signin、yunbei_sign、vip_tasks、vip_growthpoint_get、scrobble 实现。SDK 的 scrobble 模块会强制覆盖为 macOS 身份；项目改由公开 `createRequest` 向固定 clientlog/eapi 路径依次发送原有 startplay 和 play 事件，仅打卡使用模拟 Windows 10 标识（os=pc、mobilename=Windows 10，配套系统版本及 UA），不修改 node_modules 或数据库 Cookie，不开放浏览器设备参数覆盖。首段失败或响应异常不继续发送第二段；队列、总时长上报与凭据隔离不变，禁用自动重试。该身份不是实际设备检测，网易云最终显示名称、排行、时长或奖励是否入账均需真实账号核验，返回 200 也不能证明；不额外增加第三方 HTTP 服务或定时框架。
