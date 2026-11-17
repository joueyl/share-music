# Android APK 手动构建配置（实验性，待移动端适配）

工作流：[android-apk.yml](../.github/workflows/android-apk.yml)，名称 **Android APK (experimental)**。

## 当前状态

按当前需求先试用桌面代码，不另做一套安卓页面。已添加最小 Tauri Android 入口和配置；Android 通过 `android-preview` 模式构建相同的 Vue 页面，使用已有浏览器 HTTP/WebSocket/唯一 HTML Audio 路径，不调用桌面 Rust 命令。

**尚未实际编译 Android 或实机运行**。CI 可尝试生成并打包最小壳，但不保证首次远端构建成功，编译问题应按真实日志处理，不把静态检查当作 APK 验收。

## 试用范围与限制

- 页面、登录、房间、聊天、歌词及播放逻辑复用现有代码与真实服务端，不伪造数据或操作成功。
- 暂不启用桌面托盘、窗口按钮、系统凭据保存、Rust 音频缓存和桌面更新器；音频走现有服务端鉴权代理。跨域请求需要后端允许实际 Android WebView Origin，不得用放开任意来源/凭据或关闭鉴权替代配置。
- 不实现安卓原生通知、媒体会话、前台服务或后台/锁屏保活；切后台后可能暂停或被系统回收，不能承诺连续播放。布局和 3D 画质仍沿用现有自适应策略，后续根据手机试用再优化。
- Android 配置保留现有 identifier 和统一版本源；不复制桌面固定最小窗口尺寸，不单独维护版本。

这是独立的 `workflow_dispatch` 工作流，不随 main/标签自动启动，不参与桌面四目标 Release 汇总，不上传 Google Play 或修改已有 Release。此前推送的标签不会包含后续新增配置。

## 构建方式

Android 环境初始化显式指定 `setup-android` 的 `packages: platform-tools`，不使用其包含旧 `tools` 包的默认列表；SDK platform、build-tools 和 NDK 在后续步骤分别安装。

1. CI 使用 Node 24、Rust 1.90.0、Java 17、NDK 27.2.12479018、build-tools 35.0.0，目标 ARM64；SDK platform 从锁定 CLI 生成工程的 `compileSdk` 读取并安装。Gradle 仍可能安装其默认 build-tools，不能保证未来模板始终兼容当前工具链。
2. `npm ci` 后运行 `tauri android init --ci --skip-targets-install`，每次从当前锁定 CLI 生成试用工程，避免提交生成文件和本机路径；后续需要定制 Manifest/Kotlin 时再改为维护已提交工程。
3. `tauri.android.conf.json` 指定 `npm run build -- --mode android-preview`；`.env.android-preview` 只含公开的试用开关。CI 复用生产服务地址；本地构建需显式提供 `VITE_SERVER_URL`，自定义 Vite mode 不自动读取 `.env.production`。
4. CI 使用 `tauri android build --ci --debug --apk --target aarch64`，编译与实际启动结果仍待验证。开发机需自行先安装 SDK/NDK/Java 与 Rust Android target。

## GitHub 配置

当前使用 **Debug 自动签名**，不需要配置 Android 签名 Secrets。Gradle 在临时 runner 上自动生成/使用调试密钥；工作流不下载公共私钥、不保存或上传 debug keystore，也不读取正式签名 Secrets。

仅用于自行安装试用，不用于 Google Play 或正式公开发行。每个全新 runner 的调试密钥可能不同，不能保证后续 APK 可覆盖安装；签名不匹配时需要先卸载旧包，卸载会清除本地数据。正式发布时应另行配置并离线备份固定的私人签名密钥，不使用 debug 密钥发布。

可选 Repository variable `VITE_SERVER_URL` 仅接受不含凭据/路径/查询的 HTTPS Origin；未设置时复用当前客户端生产地址。此地址会内置于 APK，不是秘密。

## 运行与产物

工作流已推送到默认分支后，打开 **Actions → Android APK (experimental) → Run workflow**，选择包含适配的分支。无需再推桌面标签。

工作流安装依赖，调用 `tauri android build --ci --debug --apk --target aarch64`，预期恰好一个 debug APK；保留 Gradle 自动生成的调试签名，用 Android build-tools 验证签名和 ZIP 对齐，并生成 SHA-256 校验清单，不对已签名 APK 二次修改。

成功后下载 `music-share-android-arm64-debug-版本号` Artifact（保留 30 天），包含带 `-debug.apk` 后缀的 APK、`SHA256SUMS-android-arm64-debug.txt`、`DEBUG-BUILD.txt` 试用限制与版本说明。只覆盖 ARM64，不含 ARMv7/x86 模拟器包或 AAB。构建及签名校验通过不等于 Android 16 KiB 原生库兼容性、后台播放或应用商店验收通过；本次未运行 Android 编译或远端构建，未进行实机验收。

参考：[Tauri Android CLI](https://v2.tauri.app/reference/cli/#android-build)、[Android 前置环境](https://v2.tauri.app/start/prerequisites/#android)、[Android 签名](https://v2.tauri.app/distribute/sign/android/)。
