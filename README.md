# 共鸣 · Music Share

Tauri 2 + Vue 3 + TypeScript + Pinia + Vue Router 客户端，Rust 原生媒体核心，NestJS 控制服务。

本项目提供可运行的开发原型，实现多人房间、四项独立权限、本地文件及系统音频音源、统一播放时间轴、P2P 媒体传输、有限 TURN 中继和主动 Opus 降级。服务器不保存音乐文件、不转码、不混音。

## 快速启动

需要 Node.js 22.18+、Rust 1.90+。Windows 需要 Visual Studio C++ 桌面开发工具及 WebView2。原生媒体库另需 CMake 和 vcpkg，首次编译 FFmpeg 可能需要较长时间。

在项目根目录运行：

```sh
npm ci
npm run dev:server
```

另开终端：

```sh
npm run desktop
```

开发启动器会自动选择工程内最新的媒体库，并打印加载路径；不再需要为工程内的旧 DLL 手动设置环境变量。外部自定义媒体库路径仍尊重 `MUSIC_NATIVE_LIBRARY`。

服务器默认绑定 `127.0.0.1:3000`。客户端填写该地址，创建本地账号后即可创建房间。密码至少 10 个字符。开发环境未设置 TOKEN_SECRET 时，每次重启生成临时密钥；账号保存到 SQLite，旧会话失效。

**完整音频需要下面的原生库。** 缺少原生库时，桌面界面仍可操作房间，但音频按钮禁用并显示具体原因，不会伪装为已播放。

`npm run dev:client` 仅用于浏览器开发预览：支持真实登录、房间及权限控制，不支持媒体。生产构建禁用浏览器登录适配器，网络与音频由 Rust 管理。

## 构建原生媒体库

安装官方 vcpkg，设置 `VCPKG_ROOT`，在项目根目录运行：

```sh
cmake -S native -B native/build -DCMAKE_TOOLCHAIN_FILE="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
cmake --build native/build --config Release --parallel
ctest --test-dir native/build -C Release --output-on-failure
```

Windows PowerShell 第一行改为：

```powershell
cmake -S native -B native/build "-DCMAKE_TOOLCHAIN_FILE=$env:VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake"
```

原生依赖由 `native/vcpkg.json` 定义：FFmpeg、FLAC、Opus、libdatachannel、SDL2、nlohmann-json。Linux 另外安装 `libpipewire-0.3-dev` 和桌面开发依赖；Tauri 需要 WebKitGTK 4.1、GTK3。macOS 需要 Xcode 和 macOS 13+ SDK。

开发时将 `MUSIC_NATIVE_LIBRARY` 设置为编译后的完整路径，例如：

```powershell
$env:MUSIC_NATIVE_LIBRARY = (Resolve-Path native/build/Release/music_native.dll).Path
npm run desktop
```

Windows 必须保留 CMake 自动复制到 Release 目录的依赖 DLL。Rust 使用受限 DLL 搜索加载其同目录依赖。正式分发时，将 `music_native.dll` / `libmusic_native.dylib` / `libmusic_native.so` 及运行依赖置于应用可执行文件目录，并完成各平台签名、依赖安装名/RPATH 和第三方许可证打包。

## 打包 Windows 安装文件

在 Windows x64 上完成上面的依赖安装和原生媒体库 Release 构建后，在项目根目录执行：

```powershell
npm run package:win:check
npm run package:win
```

第一条检查媒体依赖和许可证，第二条构建 Vue、Rust Release 客户端并生成 NSIS `.exe` 安装文件，输出到 `apps/client/src-tauri/target/release/bundle/nsis/`。首次打包需要联网下载 NSIS 工具，工具缓存留在 Tauri 的 `target/.tauri/` 中。

打包器自动选择工程内最新的媒体 DLL，并把同目录的依赖 DLL 放在安装后的客户端可执行文件旁；同时附带 Visual C++ 运行库和第三方许可证。安装后无需设置媒体库环境变量。安装向导支持简体中文和英文，按当前用户安装，可从 Windows 应用列表卸载。未安装 WebView2 的电脑会联网下载安装该运行时。

许可证目录从媒体库对应的 CMakeCache 自动读取。使用外部构建时可显式指定：

```powershell
$env:MUSIC_NATIVE_LIBRARY = 'D:\media\Release\music_native.dll'
$env:MUSIC_NATIVE_LICENSES = 'D:\vcpkg\installed\x64-windows\share'
npm run package:win
```

当前生成的是未签名安装包。安装包只包含客户端，NestJS 服务需单独启动或部署；登录界面填写服务地址。若仅需可执行文件，仍可运行 `npm run tauri -w @music-share/client -- build --no-bundle`。

登录后可在侧栏账号区域点击“退出登录”，自动停止本地媒体、断开连接并回到登录页。

退出房间会停止本地播放与采集，释放 P2P 连接、音频缓冲和旧播放快照；断网时也可以退出，恢复连接不会自动回到已退出的房间。

## 房间与权限

每房间最多 8 位在线成员，同一时刻一个音源。房主始终拥有全部权限；成员覆盖优先于房间默认值。

| 权限 | 普通成员默认 | 范围 |
|---|---|---|
| 切歌 | 禁止 | 即时播放、上下曲、停止、文件播放/暂停 |
| 本地推流 | 禁止 | 本地即时文件或系统音频，或申请席位 |
| 进度切换 | 禁止 | 文件拖动；直播不支持 |
| 加入列表 | 允许 | 提交本地文件 |

即时播放或直接直播需要同时有切歌、本地推流权限；只有推流权限时由房主批准席位。已授权列表项正常轮播无需额外推流权限。列表结束默认停止；手动上下曲可循环查找可用项。成员可撤回自己的未播放项，房主管理排序及清空。

权限在 NestJS 校验，UI 禁用按钮不作为安全边界。命令带 UUID 与预期版本，重复命令去重、并发冲突返回快照，客户端不自动重放过期播放操作。

## 音频、同步与带宽

- Vue 只接收状态；PCM 和媒体字节始终留在 Rust/原生层，不经过 IPC。
- 文件由 FFmpeg 按时间定位、解码为原规格 PCM，再无损编码为可独立校验的 FLAC 音频块；有损文件依然标为“原始有损音源”。接收方得到音频块缓存，**不是完整原文件下载**。
- 每个音频块带代次、序号、媒体时间、规格及 SHA-256；最多 16KiB 消息切片，有界重组、缓冲与背压。新代次丢弃旧音源数据。
- Windows 系统采集自动读取系统默认输出设备，移除设备与采集规格选择。整数音频自动采用 16/24bit；浮点或高位深音频自动整数化为 24bit PCM；无损保证从该 PCM 边界开始。Windows 要求采样率与设备匹配。macOS/PipeWire 按请求格式提供采集，系统自身的格式转换不属于原文件无损保证。
- 支持双声道 44.1/48/88.2/96kHz、16/24bit。其他无损规格明确拒绝，不静默改变源文件规格。
- 原生输出使用 SDL2；音量调整、操作系统输出及蓝牙可能改变声音，保证截止解码 PCM。
- 默认准备 3 秒，最长等待 5 秒后提交；未就绪者继续等待。直播不支持暂停、seek 或回放。无损同步不通过持续变速/重采样追赶，偏差过大时重新定位。
- 每条新 P2P 链路先发送约 256KiB 探测数据，结合接收时间及确认往返估算容量，再准入；持续不足时缓冲并提示，不静默降级。探测是有限样本，不能保证随后公网带宽。
- Opus 为显式房间级切换，编码目标 192kbps；独立块的 lookahead 补偿产生额外编码帧，中继按 230.4kbps 媒体预算再预留 20% 协议开销，不把 192kbps 当作固定线上流量。

文件准入目前保守使用 PCM 码率，避免按原始 MP3/FLAC 容器码率低估重编码后的网络需求。详细实施差异见 `docs/TEST-REPORT.md`。

CD PCM 每接收者约 1.411Mbps。按 FLAC 示例 0.9Mbps 和 20% 开销计算，8 人房间的提供者需要约 7.56Mbps 上行。服务器只预留 3.5Mbps 给 TURN，其余 1.5Mbps 为控制与余量；所有房间共享该预算。20 人总在线是控制目标，不能据此保证 20 人同时无损收听。

TURN 凭证有效 60 秒，容量保留 95 秒用于连接拆除。当前 libdatachannel 封装通过约每 45 秒更新凭证并重建中继链路续期，可能产生短暂重新缓冲；长时间 TURN 连续播放仍需真实网络验收。服务端预算不能替代操作系统出口整形。

## 公共 TURN

可使用 Metered 或其他托管 TURN。配置见 [公共 TURN 接入](docs/PUBLIC-TURN.md)。域名和 API Key 必须由服务账号提供；外部预算与自建服务器预算独立。

## 服务部署

复制 `apps/server/.env.example` 为 `.env`，填写随机 TOKEN_SECRET、与 coturn 一致的 TURN_SECRET、公网 TURN 主机与 STUN_URL。Node 进程使用 `--env-file` 加载：

```sh
npm run build
cd apps/server
node --env-file=.env dist/apps/server/src/main.js
```

也可使用 `deploy/compose.yml`（Linux），先从示例创建 `deploy/turnserver.conf`。NestJS 只暴露本机 HTTP，Nginx 在 443 终止 TLS；桌面端只允许 HTTPS，回环开发地址允许 HTTP。开放 TURN 3478 UDP/TCP 与 49160–49200 UDP。示例配置拒绝中继访问私网，不使用服务器作为通用内网代理。

`deploy/shape-egress.sh <网卡>` 默认只输出命令；加 `--apply` 才安装 5Mbps 总出口、3.5Mbps TURN 类的整形策略。它拒绝覆盖已有自定义整形。Docker 转发路径、网卡卸载和运营商计费开销需要在实际服务器检查；该脚本针对 host 网络 coturn 的 OUTPUT 流量。

不要把示例密钥、真实 `.env`、SQLite 或 TURN 配置提交到仓库。生产部署前校验 TLS、反向代理与出口限速。当前交付未连接或部署到你的远程服务器。

## 测试

```sh
npm run typecheck
npm test
npm run build
npm run test:rust
ctest --test-dir native/build -C Release --output-on-failure
```

`npm test` 自动构建服务端并启动独立内存测试实例，包含真实 HTTP/WebSocket 双用户测试。原生测试使用生成 WAV，无个人音乐。

完整 Rust 媒体集成测试需要另开内存服务，设置 `MUSIC_TEST_SERVER` 和 `MUSIC_NATIVE_LIBRARY`：

```powershell
$env:MUSIC_TEST_SERVER = 'http://127.0.0.1:3000'
$env:MUSIC_NATIVE_LIBRARY = (Resolve-Path native/build/Release/music_native.dll).Path
cargo test --manifest-path apps/client/src-tauri/Cargo.toml --no-default-features --test media_e2e -- --ignored --nocapture
```

该测试使用合成音频、SDL dummy 输出、两个 Rust 客户端与真实 NestJS 服务，不采集系统声音或麦克风。它验证完整文件播放、暂停、seek、恢复和主动 Opus 切换。

验证记录与尚未验收的目标见 `docs/TEST-REPORT.md`。三平台源码并不等于三平台硬件验证：macOS/Linux 实机采集、8 人 30 分钟声学同步、公网 NAT/TURN 长时稳定性、5M 真实出口与 20 人以上现场负载，必须在对应环境执行后才能宣布达标。

## 目录

```text
apps/client/           Vue 界面与 Tauri/Rust 核心
apps/server/           NestJS、SQLite、权限与播放状态机
packages/shared/      TypeScript 协议和校验
native/               原生编解码、P2P、输出与三平台采集
deploy/               TLS、coturn、容器与出口整形示例
docs/                 协议、验证和发布验收
```

第三方媒体库使用各自许可证；分发需要附带相应许可及 LGPL 相关材料。原生依赖保持动态链接，FFmpeg manifest 未启用 GPL/nonfree 功能。发布前按实际构建的库核对授权文件。
