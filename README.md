# 共鸣 · Music Share

## AI 协作与设计规范

修改项目前请先阅读根目录 [AGENTS.md](AGENTS.md) 和 [AI 设计规范](docs/AI-DESIGN.md)。规范按当前同频 TONE 实现整理，包含视觉、自适应布局、逐页交互、接口边界与验收清单；来源和映射见 [Brilliant 对照](docs/BRILLIANT-WEBVIEW2.md)。这些文件应随源码保留。若 AI 工具不自动读取 AGENTS，请手动将两份规范加入其项目上下文。

Tauri 2 + Vue 3 + TypeScript + Pinia + Vue Router 客户端，HTML Audio 播放，NestJS 控制服务。Windows 使用 WebView2 内置音频解码；Rust 仅承担缓存、系统媒体控制、凭据与更新等桌面能力。

当前客户端实现多人房间、音乐搜索与音乐库、统一播放时间轴、歌词、聊天和独立权限。歌曲通过服务端授权的网易云直链接入，来源、过期时间和元数据保存在 MySQL。

## 快速启动

需要 Node.js 22.18+、Rust 1.90+。Windows 需要 Visual Studio C++ 桌面开发工具及 WebView2。

在项目根目录运行：

```sh
npm ci
# 复制 apps/server/.env.example 为 apps/server/.env，填写数据库与服务配置后：
npm run dev:server
```

也支持 pnpm 10，在项目根目录（包含 `pnpm-workspace.yaml`）安装全部客户端、服务端和共享包依赖：

```powershell
pnpm install
# 同样先配置 apps/server/.env
pnpm run dev:server
```

另开终端运行 `pnpm run desktop`；浏览器预览使用 `pnpm run dev:client`，Windows 安装包使用 `pnpm run package:win`。pnpm 锁文件已随源码提供，可用 `pnpm install --frozen-lockfile` 复现依赖版本。首次安装需要联网；若配置了 `offline=true` 而本地没有缓存，运行 `pnpm install --offline=false`。pnpm 配置支持本地共享包链接，并允许 esbuild 等所需原生依赖的安装脚本。

另开终端：

```sh
npm run desktop
```

开发启动器直接启动 Tauri。

服务器默认绑定 `127.0.0.1:3000`。客户端按 Vite 环境变量自动连接，注册账号后即可创建房间。密码至少 10 个字符，账号保存在服务端 MySQL。

### 客户端服务器地址

地址由 `apps/client/` 下的 `VITE_SERVER_URL` 环境变量配置：

| 启动方式 | 配置文件 | 服务器地址 |
| --- | --- | --- |
| `npm run desktop` / `npm run dev:client` | `.env.development` | `http://127.0.0.1:3000` |
| `npm run build` / 桌面打包 | `.env.production` | `https://share.jouei.cn` |

可用同目录的 `.env.development.local`、`.env.production.local` 或构建进程的 `VITE_SERVER_URL` 覆盖（进程环境变量优先，本地覆盖文件不提交 Git）。地址只能包含协议、域名和可选端口，不能包含 `/api`、查询参数或认证信息；生产环境必须使用 HTTPS。配置缺失或无效时启动/构建直接报错，不会静默退回本机地址。`VITE_` 配置属于公开的构建时配置，不可填写密钥；修改开发配置需重启开发服务，修改生产配置需重新打包，已安装客户端不会读取机器上的新环境变量。自动登录仅复用与当前环境服务器相匹配的凭据，切换服务器后需手动登录一次。

### 客户端音乐缓存

桌面客户端首次播放未缓存的歌曲时，将音频写入系统应用缓存目录的 `music/` 子目录，按歌曲 contentHash 命名（新歌曲为接口 MD5）。Windows 默认位置为 `%LOCALAPPDATA%\com.musicshare.desktop\music`；macOS/Linux 使用 Tauri 对应平台的应用缓存目录。再次播放先校验本地文件的大小和哈希，命中时不重新下载音频，重启客户端后依然有效；同一音频在不同房间也可复用。缓存只保存音频，不保存音源 URL 或登录信息。

文件完整下载且校验成功后才原子写入缓存；失败或损坏的文件不会被当作有效缓存。并发请求同一音频只下载一次；无法写入缓存时仍可正常播放并显示提示。换歌或离开房间只释放内存 Blob，不删除磁盘缓存。目前无自动清理，可在退出客户端后手动清理上述 `music` 目录，下次播放会重新下载。每首文件上限仍为 100MB。登录与房间同步仍需连接服务端，浏览器预览不使用这套桌面磁盘缓存。此功能涉及原生模块，更新后需重新构建并重启桌面客户端。

播放页优先解析实际播放文件中的内嵌封面，包括 MP3 的 ID3v2 APIC/PIC、FLAC 的 PICTURE、M4A 的 covr 等，优先选择正面封面。桌面端直接使用刚下载或已缓存的同一份音频字节，不另行下载文件、不上传解析数据；封面以本地 Blob 显示，换歌或离房时释放，不把图片内容放进房间快照。支持 JPEG、PNG、GIF、WebP 图片，内嵌图片上限 10MB；缺失、损坏或不支持的图片不影响音乐播放。此功能只需重新打包客户端（包含允许本地 Blob 图片的 CSP），无需服务端升级。

文件没有可用内嵌封面时，再使用服务端/网易云封面；从搜索添加时也会按服务器地址和音频 contentHash 缓存搜索封面（最多 256 条公开图片地址，不存登录信息），兼容旧服务端缺少 `coverUrl` 的导入响应。已有歌曲缺少网络封面时，客户端调用受房间成员权限保护的 `/api/rooms/:id/music/:trackId/cover`，服务端通过持久音源索引的精确内容哈希找回网易云歌曲 ID，再补查并保存封面，不重新上传或下载音乐。旧歌曲的网络封面自动补全需部署新服务端；所有来源都没有封面时继续显示默认唱片图。

### 系统媒体控制（Windows / Linux）

- Windows：通过 Win32 `ITaskbarList3` 添加任务栏缩略图工具栏。播放时将鼠标移到任务栏应用图标上，在预览下方可点击上一首、播放/暂停、下一首；图标随实际房间状态切换。另通过 SMTC 接入系统媒体面板及媒体快捷键，显示当前曲名、时长和进度。
- Linux：通过用户会话 D-Bus 的 MPRIS 接入 GNOME/KDE 等桌面媒体控件及 `playerctl`，服务名为 `org.mpris.MediaPlayer2.com.musicshare.desktop.instance_<进程号>`。可用 `playerctl -l` 找到实际名称，再用 `playerctl --player=<名称> play-pause` 验证。Linux 没有统一的 Windows 式缩略图按钮接口，是否在任务栏悬停时显示按钮由桌面/面板实现决定；需要可用的桌面 D-Bus 会话。
- 系统动作与应用内按钮使用同一条房间命令通道，不会只暂停本机造成不同步。无权限、断线、准备切歌或已离房时不执行控制，Windows 缩略图按钮也会禁用；事件携带房间、音轨及播放 epoch，忽略过期事件。离房或退出登录后状态清空，退出进程时卸载 SDK 事件和窗口钩子。SDK 不可用不会阻止应用内播放。

此功能包含原生 SDK 代码，须重新构建并重启桌面客户端，网页刷新或只替换前端资源不足以生效。Windows 原生构建及控制通道测试不替代 Linux 桌面的实机验收。SDK 说明：[Windows 任务栏缩略图工具栏](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-itaskbarlist3-thumbbaraddbuttons)、[MPRIS 规范](https://specifications.freedesktop.org/mpris/latest/Player_Interface.html)。

## 客户端打包

在对应操作系统安装 Tauri 开发依赖后，从仓库根目录运行：

```sh
# Windows x64
npm run package:win:check
npm run package:win
# macOS Intel / Apple Silicon
npm run package:mac:check
npm run package:mac
# Linux
npm run package:linux:check
npm run package:linux
```

安装包输出到 `apps/client/src-tauri/target/release/bundle/`，分别为 NSIS `.exe`、`.app` / `.dmg`、`.deb` / `.AppImage`。安装包仅包含客户端，NestJS / MySQL 后端需单独部署。平台依赖、签名与验证边界见 [客户端打包说明](docs/PACKAGING.md)。

## 房间与权限

每房间最多 8 位在线成员，共享播放队列与统一时间轴。房主始终拥有全部权限，成员覆盖优先于房间默认值。

| 权限 | 普通成员默认 | 范围 |
|---|---|---|
| 切歌 / 播放控制 | 禁止 | 点播、上下曲、暂停、继续、停止 |
| 进度切换 | 禁止 | 拖动播放进度 |
| 加入播放列表 | 允许 | 从音乐搜索、音乐库或指定歌单添加歌曲 |

房主可排序及清空队列。权限由服务端校验；命令携带 UUID 与预期状态版本，重复命令去重，并发冲突返回快照，客户端不自动重放过期操作。

房间聊天支持 Enter 发送、Shift+Enter 换行，每条最多 500 字，每用户每 10 秒最多发送 10 条。加入或重连载入最近 100 条，消息暂存在服务端内存，重启后清空。播放与队列操作以服务端确认的操作记录混排展示。

Windows 可勾选“记住密码并自动登录”，凭据保存到当前 Windows 用户的系统凭据管理器；取消勾选或主动退出登录会清除凭据。浏览器预览、macOS 和 Linux 暂不提供此选项。

退出房间停止本地播放、释放内存 Blob 并清理房间状态；断网时也可以退出，恢复连接不会自动回到已退出的房间。

## 播放与同步

CloudPlayer 控制唯一 HTML Audio 实例。后端从网易云接口读取 MD5 和文件大小，导入和续链不下载音频；前端下载完整音频并计算 MD5、比对接口值及大小，桌面使用本地磁盘缓存，浏览器使用鉴权音频接口创建 Blob。歌词、频谱和内嵌封面基于当前歌曲。

音源准备等待目标位置 seek 完成且 buffered，再向服务端报告 ready；服务端提交后按共享时间轴播放、暂停和纠偏。客户端校验不一致时自动获取新直链和对应 MD5、大小并重新下载校验一次，成功后继续播放；再次失败才提示错误。MD5 仅用于文件一致性检查，不替代 HTTPS、来源校验或身份认证。本地音量仅影响本机。真实播放需要有效网易云音源、服务端及在线房间成员，编解码能力依赖系统 WebView。

## 服务部署

复制 `apps/server/.env.example` 为 `apps/server/.env`，配置 MySQL `DATABASE_URL`、独立随机 `TOKEN_SECRET` 和实际前端 `ALLOWED_ORIGINS`。生产使用 MySQL 8.0+，连接失败时启动失败，不回退到 SQLite。开发时未设置 TOKEN_SECRET 会生成临时密钥，重启后原会话失效。

公网管理 `/loginServe` 需设置 `NETEASE_ADMIN_TOKEN` 与实际访问的 `NETEASE_LOGIN_ORIGIN`，通过二维码、手机号或邮箱密码登录网易云；凭据仅保存在服务端。详情见 [网易云管理登录](docs/NETEASE.md)。

```sh
npm run build
npm run start -w @music-share/server
```

Linux 可使用 `deploy/compose.yml` 中的 API 服务：

```sh
docker compose -f deploy/compose.yml up -d --build api
```

Compose 中服务绑定容器地址，宿主机仅暴露 `127.0.0.1:3000`，由 Nginx 在 443 终止 TLS 并转发 HTTP / WebSocket。修改 env_file 后需重新创建 API 容器。不要提交真实 `.env`、数据库、Cookie 或签名私钥。详细迁移和备份步骤见 [MySQL 说明](docs/MYSQL.md)。

## 测试

```sh
npm run typecheck
npm test
npm run build
npm run test:desktop-launcher
npm run test:packaging
npm run test:ci-release
npm run test:updater
```

测试与构建通过不等于真实账号音源、多设备声学同步或四平台安装包验收通过。检查流程见 [发布验收操作](docs/ACCEPTANCE.md)，已有验证记录见 [测试报告](docs/TEST-REPORT.md)。

## 目录

```text
apps/client/           Vue 界面与 Tauri 桌面能力
apps/server/           NestJS、MySQL、权限与播放状态机
packages/shared/      TypeScript 协议和校验
deploy/               TLS、容器与部署示例
docs/                 设计、接口、验证和发布说明
```

第三方通知见 [依赖与许可](docs/THIRD-PARTY-NOTICES.md)。

## 版本管理与更新日志

桌面端点击窗口关闭按钮默认隐藏到系统托盘，不退出房间或主动停止播放。点击托盘图标或菜单“显示主窗口”可恢复；右键托盘选择“退出”会关闭程序并清理播放和连接。托盘初始化失败时保留正常关闭行为，避免隐藏后无法找回。Linux 桌面需支持托盘/AppIndicator；网页版关闭行为不变。

Web 页面提供窄屏顶部导航、底部全局播放器、触控控制和窄屏弹窗；手机适配范围及浏览器仿真验证说明见 [手机网页适配](docs/MOBILE.md)。

“版本与更新日志”可查看当前版本和内置更新记录。使用 `npm run version:check` 检查版本一致性，`npm run release:version -- patch` 准备下一个修订版本，`npm run release:notes -- 版本号` 导出 GitHub Release 说明。详细流程见 [版本发布说明](docs/RELEASING.md)，变更记录见 [更新日志](CHANGELOG.md)。版本命令不自动发布 GitHub；已接入 joueyl/share-music 的桌面更新，首次配置签名后由 Actions 自动生成更新文件，详见 [GitHub 更新配置](docs/UPDATER.md)。

仓库附带 **Desktop installers** GitHub Actions 工作流：支持手动打包 Windows x64、Linux x64、macOS Intel / Apple Silicon 安装包；推送匹配的 `v版本号` 标签后，四种目标全部成功并通过校验才会创建统一 Release 草稿。配置方式、产物下载、macOS 签名限制与首次运行说明见 [GitHub Actions 自动打包](docs/GITHUB-ACTIONS.md)。

## MySQL 数据迁移与 API（2026-10-29）

服务端默认使用 MySQL 8.0+，启动必须设置 `DATABASE_URL`（Docker 内不要使用 localhost 指向宿主机）。
迁移前先停止旧服务，保留原 SQLite 文件和 WAL，不要删除旧数据卷。
详细步骤、表结构和回滚限制见 [MySQL 迁移说明](docs/MYSQL.md)，接口见 [API 文档](docs/API.md)。
SQLite 驱动只保留用于离线迁移和非生产测试，不会在 MySQL 连接失败时静默回退。
