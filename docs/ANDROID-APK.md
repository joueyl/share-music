# Android APK 独立客户端与 Actions（实验性）

工作流：[android-apk.yml](../.github/workflows/android-apk.yml)，名称 **Android APK (experimental)**。

## 当前状态

APK 现在有独立 HTML、Vue 根组件、路由页面和响应式样式，使用 Brilliant 项目“移动端/00–04”的浅色视觉，不再加载桌面 App 或靠桌面尺寸断点切换 APK 界面。

| 项目 | 桌面/网页 | APK |
| --- | --- | --- |
| 文档/脚本 | `index.html` / `src/main.ts` | `apk.html` / `src/apk/main.ts` |
| 根组件 | `src/App.vue` | `src/apk/ApkApp.vue` |
| 页面 | `src/views/` | `src/apk/pages/` |
| 布局样式 | 原 tone / brilliant / adaptive-layout | `src/apk/apk.css` |
| 构建输出 | `dist/index.html` | `dist-apk/index.html` |

两端认证、房间发现、音乐库、房间生命周期/封面及播放控制提取为 `src/features/` 共用控制器，继续使用同一 bridge/store/CloudPlayer 和接口；搜索、排序、成员权限、收藏、聊天、歌词及模型复用既有交互组件。业务变更必须检查两端消费者并运行双端回归，不复制第二套播放器或修改协议绕过权限。入口隔离插件在 APK 构建阶段拒绝桌面页面/布局样式，并输出 `client-target.json` 标记；`check-apk-build.mjs` 再校验独立 HTML 与脚本。

**本地已验证两种前端构建；Android 原生编译以 Actions 实际结果为准，实机行为仍需安装包验收。** Actions 配置可生成 Android 壳并打包，首次远端编译问题应按真实日志处理，不把前端产物检查当作 APK 或实机验收。

## 试用范围与限制

- APK 登录、发现、播放及音乐页采用独立模板；真实业务与桌面共享。手机纵向、低矮横屏、展开大屏按可用宽高响应，760×600 以上播放与聊天双栏，不假装识别实体铰链。
- 暂不启用桌面托盘、窗口按钮、Rust 音频缓存和桌面更新器；仅新增独立 `saved-login` 原生插件用于记住密码，Android Keystore 密钥配合 AES-GCM 加密、原子写入应用不备份目录，详情见[安全记住密码](SAVED-LOGIN.md)。浏览器 `dev:apk` 不提供原生安全存储。音频走现有服务端鉴权代理；跨域请求需要后端允许实际 Android WebView Origin，不得用放开任意来源/凭据或关闭鉴权替代配置。
- 不实现安卓原生通知、媒体会话、前台服务或后台/锁屏保活；切后台后可能暂停或被系统回收，不能承诺连续播放。APK 布局独立，3D 场景与材质复用共享实现，移动 GPU 的性能与后台播放仍待实机测试。
- Android 配置保留现有 identifier 和统一版本源；不复制桌面固定最小窗口尺寸，不单独维护版本。

工作流保留手动 `workflow_dispatch`，并在 main 上客户端、shared、服务端、相关构建脚本/依赖或工作流变化时自动运行；不会因桌面标签自动发布，不参与桌面四目标 Release 汇总，不上传 Google Play 或修改已有 Release。修改需要提交并推送后 GitHub 才会执行；原生编译结果不等同于实机安装和系统安全存储验收。

## 构建方式

Android 环境初始化显式指定 `setup-android` 的 `packages: platform-tools`，不使用其包含旧 `tools` 包的默认列表；SDK platform、build-tools 和 NDK 在后续步骤分别安装。

1. CI 使用 Node 24、Rust 1.90.0、Java 17、NDK 27.2.12479018，固定安装 Android API 36 与 build-tools 36.0.0，目标 ARM64。初始化工程后由 `scripts/configure-android-sdk.mjs` 将 `compileSdk`、`targetSdk` 和 `buildToolsVersion` 同步为安装版本，不再跟随 CLI 模板请求不可获取的 API 37；保留 `minSdk`。模板字段缺失或重复时明确失败，不盲目继续。后续插件或原生依赖的兼容性仍需远端编译验证。
2. `npm ci` 后运行 `tauri android init --ci --skip-targets-install`，每次从当前锁定 CLI 生成试用工程，避免提交生成文件和本机路径；后续需要定制 Manifest/Kotlin 时再改为维护已提交工程。
3. `tauri.android.conf.json` 指定 `npm run build:apk`、`frontendDist: ../dist-apk`；Vite 在 `android-preview` 下构建 `apk.html` 并输出为 `index.html`。`.env.android-preview` 仅含公开的运行时开关。CI 使用校验过的服务地址；显式 `VITE_SERVER_URL` 始终优先；未配置时，仅 APK 打包回退到公开的生产服务地址，`dev:apk` 使用独立的 `apk-development` 模式及公开本地地址配置，默认使用 `http://127.0.0.1:3000`，不会读取生产后端作为开发默认值。
4. 前置 frontend job 对两端运行类型、客户端测试、入口/SDK 配置检查及两个构建；通过后才执行 `tauri android build --ci --debug --apk --target aarch64 --config src-tauri/tauri.android.conf.json`。打包后再次检查 `dist-apk` 标记。原生编译与实际启动仍待验证，开发机需先安装 SDK/NDK/Java 与 Rust Android target。

## 本地命令

- `npm run dev:apk`：仅监听 `127.0.0.1:11421`，打开 `/apk.html`，使用 `apk-development` 模式，默认连接本机 `127.0.0.1:3000`；需另开终端执行 `npm run dev:server`，不会自动启动后端或执行 Android 打包。本地后端需要已配置好开发数据库，不要指向生产数据库。
- 自定义地址可在 PowerShell 启动前设置 `$env:VITE_SERVER_URL="http://127.0.0.1:3100"`；修改后重启 Vite。若后端已有自定义 `ALLOWED_ORIGINS`，手动补充 `http://127.0.0.1:11421`（localhost 访问时还需对应 localhost 来源），不使用通配来源替代。
- `npm run build:apk`：构建独立 APK 前端，不覆盖桌面 `dist`。
- `npm run test:apk`：检查入口/Actions 约束与 APK/双端业务回归。
- `node scripts/check-apk-build.mjs`：检查已生成 APK 前端标记及入口脚本。
- `npm run build`、`npm run typecheck` 和 `npm test` 继续用于桌面/共享模块验证；没有部署或数据库迁移。

## GitHub 配置

当前使用 **Debug 自动签名**，不需要配置 Android 签名 Secrets。Gradle 在临时 runner 上自动生成/使用调试密钥；工作流不下载公共私钥、不保存或上传 debug keystore，也不读取正式签名 Secrets。

仅用于自行安装试用，不用于 Google Play 或正式公开发行。每个全新 runner 的调试密钥可能不同，不能保证后续 APK 可覆盖安装；签名不匹配时需要先卸载旧包，卸载会清除本地数据。正式发布时应另行配置并离线备份固定的私人签名密钥，不使用 debug 密钥发布。

可选 Repository variable `VITE_SERVER_URL` 仅接受不含凭据/路径/查询的 HTTPS Origin；未设置时复用当前客户端生产地址。此地址会内置于 APK，不是秘密。

## 运行与产物

工作流已推送到默认分支后，打开 **Actions → Android APK (experimental) → Run workflow**，选择包含适配的分支。无需再推桌面标签。

工作流安装依赖，调用显式指定 Android 配置的 `tauri android build --ci --debug --apk --target aarch64`，预期恰好一个 debug APK；保留 Gradle 自动生成的调试签名，用 Android build-tools 验证签名和 ZIP 对齐，并生成 SHA-256 校验清单，不对已签名 APK 二次修改。

成功后下载 `music-share-android-arm64-debug-版本号` Artifact（保留 30 天），包含带 `-debug.apk` 后缀的 APK、`SHA256SUMS-android-arm64-debug.txt`、`DEBUG-BUILD.txt` 试用限制、`client-target.json` 独立入口标记与版本说明。只覆盖 ARM64，不含 ARMv7/x86 模拟器包或 AAB。构建及签名校验通过不等于 Android 16 KiB 原生库兼容性、后台播放或应用商店验收通过；本次未运行 Android 编译或远端构建，未进行实机验收。

参考：[Tauri Android CLI](https://v2.tauri.app/reference/cli/#android-build)、[Android 前置环境](https://v2.tauri.app/start/prerequisites/#android)、[Android 签名](https://v2.tauri.app/distribute/sign/android/)。
