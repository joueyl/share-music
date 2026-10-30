# 当前客户端安装包构建

2026-10-29：客户端使用 HTML Audio。Windows 由 WebView2 解码，macOS/Linux 由系统 WebView 解码。构建不再使用 FFmpeg、vcpkg、CMake、原生媒体 DLL 或额外动态媒体库；旧 native/ 仅保留历史源码，不参与启动或 CI。

需要 Node.js 22.18+、Rust 1.90+ 及目标平台 Tauri 开发依赖。Windows 安装 Visual Studio C++ 桌面开发工具与 WebView2。Windows 安装包配置 WebView2 bootstrapper；离线安装前需预装 Runtime。

```sh
npm ci
npm run desktop
npm run package:win:check
npm run package:win
```

Windows 当前支持 x64；macOS 13+ 支持本机 x64/arm64；Linux 支持本机 x64/arm64。macOS 使用 package:mac，Linux 使用 package:linux，同样提供 :check。必须在相应操作系统打包，不跨平台编译。

`--check` 只验证版本、平台、更新配置并生成打包配置，不证明安装包构建、安装或真实播放成功。

配置在 apps/client/src-tauri/target/packaging/；安装包输出在 apps/client/src-tauri/target/release/bundle/。Windows 为 NSIS exe，macOS 为 app/dmg，Linux 为 deb/AppImage。所有平台仅额外携带第三方通知与 souvlaki 许可。

Linux 仍需 GTK、WebKitGTK 4.1、D-Bus、系统托盘开发依赖及对应运行库；系统媒体集成要求用户 D-Bus 会话。macOS 需要 Xcode Command Line Tools。HTML Audio 编解码能力依赖系统 WebView，不承诺任意格式；当前后端在线导入只支持完整 MP3。

发布矩阵保留 Windows x64、Linux x64、macOS Intel/Apple Silicon。CI 不再安装 vcpkg 或构建 native/；自动更新签名和草稿发布规则不变。签名配置见 UPDATER.md。NestJS / MySQL 后端需单独部署。
