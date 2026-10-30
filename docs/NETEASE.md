# 网易云服务端登录

已安装用户指定的 `NeteaseCloudMusicApi`（4.32.0），通过 Node 模块调用，不单独开放第三方包的 HTTP 服务。用户提供的 http://iwenwiki.com:3000/docs/ 当前无法由文档读取工具访问；接口形状已核对实际安装包的 login_qr_key / login_qr_create / login_qr_check 源码。

## 使用

1. 重启服务端：`npm run dev:server`。
2. 在服务端本机浏览器访问 http://127.0.0.1:3000/loginServe。
3. 用网易云音乐 App 扫码并确认。页面显示成功后，Cookie 登录凭据写入现有 SQLite 数据库 settings 表。
4. 再次访问此页面或点击重新登录，会创建新二维码；旧凭据一直保留到新扫码确认成功时才覆盖。旧页面及旧的在途轮询不能覆盖新登录。二维码有效等待上限三分钟，过期请重新获取。

没有把网易云 Cookie 当成本项目的 Bearer token，也不会把 Cookie 返回页面、存入 localStorage 或响应 Set-Cookie。该集成是服务端全局单账号，不是每位房间成员各自的网易云账号。数据库内含可复用登录凭据，当前为明文保存：请限制数据库及备份的系统文件权限，不对外暴露，不提交 Git；Docker 部署沿用 /data 持久卷。凭据自然过期后需重新扫码。

## 公网管理

默认只允许直接来自本机且 Host 为 localhost/127.0.0.1/[::1] 的管理访问；经反向代理或远程访问默认拒绝，避免任何访客替换全局账号。

设置服务端 `NETEASE_ADMIN_TOKEN` 为独立的高强度管理口令。浏览器认证对话框用户名为 `admin`，密码为该口令。公网必须使用 HTTPS。反向代理场景同时设置 `NETEASE_LOGIN_ORIGIN=https://你的实际域名`，并按 Nginx 示例转发 `/loginServe`。不要将管理口令放在 URL、二维码或前端代码中。

## 自动携带凭据

业务代码通过 `app.netease.call(method, params)` 统一调用，始终从数据库取最新 Cookie 注入，不依赖进程内缓存，重启仍有效。已开放的只读方法：search、search_suggest、cloudsearch、simi_song、song_detail、song_url、song_url_v1、lyric、playlist_detail、user_playlist、user_account、user_cloud、login_status。

HTTP 路径 `GET /api/netease/:method`（查询参数）或 `POST /api/netease/:method`（JSON）。调用者必须携带本项目登录获得的 `Authorization: Bearer ...`。例如 `/api/netease/song_detail?ids=123`。服务端内部再携带网易云 Cookie，客户端不需要知道该凭据。客户端提供的 cookie、代理、IP、域名等覆盖参数不会被转发。没有开放第三方包中的账号修改、登出和任意模块调用接口；需要更多接口时明确扩展方法及参数白名单。

第三方库在错误分支可能打印原始响应，因此实际调用放入输出被丢弃的 Worker，并设置超时终止；仅返回应用自己的错误码，不输出第三方错误对象。响应中的 Cookie/token 字段也被过滤。

## 验证与限制

本地测试覆盖二维码状态、自动附带凭据、重登覆盖、过期/并发旧会话保护、SQLite 关闭重开及路由权限。已通过真实库调用获取二维码，但没有代替用户扫码确认，因此不能宣称真实账号已登录。生产依赖审计报告 7 项安全告警（6 高危、1 中危），涉及 NeteaseCloudMusicApi 及其 basic-ftp、get-uri、pac-proxy-agent、music-metadata、file-type、node-forge 依赖链。审计建议的自动修复会将用户指定库降到 3.47.5，属于破坏性版本变更，未自动执行。当前仅暴露只读接口、不开放代理或文件解析入口；这不等同于已修复漏洞，公网部署前需评估升级或替代方案。

## 部署后获取二维码提示 FORBIDDEN

旧逻辑直接用后端收到的 HTTP 协议与浏览器 HTTPS Origin 比较，TLS 在反向代理终止时会误拒绝；Nginx 使用 `$host` 还可能丢掉非标准端口。

优先在服务器设置 `NETEASE_LOGIN_ORIGIN` 为浏览器实际访问的 Origin，例如 `https://music.example.com:8443`，不要包含 `/loginServe`、查询参数或片段。管理密码 `NETEASE_ADMIN_TOKEN` 保持配置。正常进程重启后生效；Docker Compose 的 env_file 改动需要重新创建 API 容器（`docker compose -f deploy/compose.yml up -d --build --force-recreate api`，在项目根目录执行），仅 restart 不更新容器环境变量。

Nginx `/loginServe` 转发需覆盖 `Host $http_host` 和 `X-Forwarded-Proto $scheme`，保留外部端口且不允许客户端伪造协议。新代码仅接受直接连接的回环代理传来的单一 http/https 协议头，不全局启用 trust proxy；Docker 网桥或其他代理需显式配置上述 Origin。配置错误仍拒绝跨站来源，并显示专用错误 `NETEASE_LOGIN_ORIGIN_FORBIDDEN`，不会关闭管理认证或放开所有来源。
