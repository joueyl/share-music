# 网易云服务端登录

已安装用户指定的 `NeteaseCloudMusicApi`（4.32.0），通过 Node 模块调用，不单独开放第三方包的 HTTP 服务。用户提供的 http://iwenwiki.com:3000/docs/ 当前无法由文档读取工具访问；接口形状已核对实际安装包的 login_qr_key / login_qr_create / login_qr_check / login_cellphone / login 源码。

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

业务代码通过 `app.netease.call(method, params)` 统一调用，始终从数据库取最新 Cookie 注入，不依赖进程内缓存，重启仍有效。已开放的只读方法：search、search_suggest、cloudsearch、simi_song、song_detail、song_url、song_url_v1、lyric、playlist_detail、user_playlist、user_account、user_cloud、login_status、album。

HTTP 路径 `GET /api/netease/:method`（查询参数）或 `POST /api/netease/:method`（JSON）。调用者必须携带本项目登录获得的 `Authorization: Bearer ...`。例如 `/api/netease/song_detail?ids=123`。服务端内部再携带网易云 Cookie，客户端不需要知道该凭据。客户端提供的 cookie、代理、IP、域名等覆盖参数不会被转发。没有开放第三方包中的账号修改、登出和任意模块调用接口；需要更多接口时明确扩展方法及参数白名单。

第三方库在错误分支可能打印原始响应，因此实际调用放入输出被丢弃的 Worker，并设置超时终止；仅返回应用自己的错误码，不输出第三方错误对象。响应中的 Cookie/token 字段也被过滤。

## 验证与限制

本地测试覆盖二维码状态、自动附带凭据、重登覆盖、过期/并发旧会话保护、SQLite 关闭重开及路由权限。已通过真实库调用获取二维码，但没有代替用户扫码确认，因此不能宣称真实账号已登录。生产依赖审计报告 7 项安全告警（6 高危、1 中危），涉及 NeteaseCloudMusicApi 及其 basic-ftp、get-uri、pac-proxy-agent、music-metadata、file-type、node-forge 依赖链。审计建议的自动修复会将用户指定库降到 3.47.5，属于破坏性版本变更，未自动执行。当前仅暴露只读接口、不开放代理或文件解析入口；这不等同于已修复漏洞，公网部署前需评估升级或替代方案。

## 部署后获取二维码提示 FORBIDDEN

旧逻辑直接用后端收到的 HTTP 协议与浏览器 HTTPS Origin 比较，TLS 在反向代理终止时会误拒绝；Nginx 使用 `$host` 还可能丢掉非标准端口。

优先在服务器设置 `NETEASE_LOGIN_ORIGIN` 为浏览器实际访问的 Origin，例如 `https://music.example.com:8443`，不要包含 `/loginServe`、查询参数或片段。管理密码 `NETEASE_ADMIN_TOKEN` 保持配置。正常进程重启后生效；Docker Compose 的 env_file 改动需要重新创建 API 容器（`docker compose -f deploy/compose.yml up -d --build --force-recreate api`，在项目根目录执行），仅 restart 不更新容器环境变量。

Nginx `/loginServe` 转发需覆盖 `Host $http_host` 和 `X-Forwarded-Proto $scheme`，保留外部端口且不允许客户端伪造协议。新代码仅接受直接连接的回环代理传来的单一 http/https 协议头，不全局启用 trust proxy；Docker 网桥或其他代理需显式配置上述 Origin。配置错误仍拒绝跨站来源，并显示专用错误 `NETEASE_LOGIN_ORIGIN_FORBIDDEN`，不会关闭管理认证或放开所有来源。


`/loginServe` 也可切换 QQ 音乐扫码，两种音源会话独立；网易云原有配置和操作不变。QQ 部署与范围见 [QQ-MUSIC.md](QQ-MUSIC.md)。

## 服务端每日任务与播放打卡

- 使用数据库 `netease.cookie` 中的 MUSIC_U 登录态，不是项目 Bearer token、TOKEN_SECRET 或 QQ 会话。Asia/Shanghai 每天 **08:00** 自动尝试安卓签到（`daily_signin`，`type=0`）、云贝签到（`yunbei_sign`）、读取 `vip_tasks` 返回的 `unGetIds` 并调用 `vip_growthpoint_get`；无待领取 ID 不伪造奖励，不做任务刷取或付费操作。
- 服务重启晚于 08:00 时只补当天未尝试的任务，不追补旧日期；08:00 无凭据则跳过。凭据过期由上游真实拒绝，需管理员重新登录。任务启动前持久化当日尝试标记（`netease.daily.<登录态指纹>.<任务>`），超时/未知结果当日不自动重试，以免重复执行有副作用的请求；记录在 settings 表，无结构迁移。凭据更换后旧待处理任务不能使用新账号凭据。当前为单服务进程调度，不提供跨实例分布式任务锁。
- 房间新的歌曲播放经 ready/提交生效且仍有在线成员后，将网易云 ID、歌曲总时长加入独立打卡队列。**在播放中即提交整首总时长（秒），不等播完；该参数不是实测听歌时长，也不保证上游按完整收听计入统计。** 后台读取 song_detail 取得真实专辑 ID 作为 sourceid，以队列 durationMs 与详情 dt/duration 较小值转整秒作为 scrobble.time。元数据缺失、非网易云、过短歌曲或空房间跳过，不用随机来源 ID 冒充歌单/专辑。
- 每次新的切歌/循环播放可上报一次，普通快照、进度、暂停/继续、seek、音质同步和幂等重试不会重复打卡。歌曲加载准备中或取消/失败的准备不打卡。上报失败不回滚播放或队列，不伪造成功回执。
- 打卡为单并发、最多 100 项等待队列，与每日任务和 HTTP 业务调用无共享串行锁；满队列丢弃并输出不含凭据的提示。沿用独立 Worker 和 18 秒 Worker/20 秒服务调用超时，不让慢打卡占住搜索、导入、取链或播放命令；关闭服务停止调度、丢弃等待项，并等待有界的在途调用结束后关闭数据库。
- 这些副作用方法只允许服务端内部固定参数调用，`/api/netease/:method` 仍保持只读白名单。后台日志只输出固定任务名和确认状态，不记录 Cookie、token、上游原始错误或完整响应。只有真实账号联调才能验收签到、领取或排行结果，单元测试不代表已获得奖励。

已核对安装包 4.32.0 的 daily_signin、yunbei_sign、vip_tasks、vip_growthpoint_get、scrobble 模块与随包文档；没有额外部署第三方 HTTP 服务或新增定时框架依赖。
