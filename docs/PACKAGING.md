# 客户端安装包构建

GitHub Actions 现提供 Windows x64、Linux x64、macOS Intel / Apple Silicon 原生构建矩阵，使用本文的相同打包脚本。配置与签名限制见 [GitHub Actions 自动打包](GITHUB-ACTIONS.md)。工作流已配置不代表已在各平台 runner 上完成验收。

在项目根目录运行，支持 npm 和 pnpm。先安装 JS 依赖、Rust、目标平台的 Tauri 开发依赖，以及原生媒体库；Node.js 22.18+、Rust 1.90+。三个平台的打包命令均构建 Release 客户端，NestJS 服务单独部署。

| 平台 | 检查命令 | 打包命令 | 输出 |
| --- | --- | --- | --- |
| Windows x64 | `pnpm run package:win:check` | `pnpm run package:win` | NSIS `.exe` |
| macOS 13+，本机 x64/arm64 | `pnpm run package:mac:check` | `pnpm run package:mac` | `.app`、`.dmg` |
| Linux，本机 x64/arm64 | `pnpm run package:linux:check` | `pnpm run package:linux` | `.deb`、`.AppImage` |

把 `pnpm` 替换成 `npm` 同样可用。输出目录为 `apps/client/src-tauri/target/release/bundle/`，对应 `nsis/`、`macos/`、`dmg/`、`deb/`、`appimage/` 子目录。必须在目标操作系统构建；这些命令不在 Windows 上交叉编译 macOS/Linux，也不生成 macOS Universal Binary。

## macOS

安装 Xcode Command Line Tools、CMake、Ninja、pkg-config、Rust、Node.js 和 vcpkg；SDK 需支持 ScreenCaptureKit。安装系统依赖可参考 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。设置 VCPKG_ROOT 为已经 bootstrap 的官方 vcpkg 目录。

```sh
pnpm install
case "$(uname -m)" in
  arm64) triplet=arm64-osx-dynamic ;;
  x86_64) triplet=x64-osx-dynamic ;;
  *) echo "不支持的架构"; exit 1 ;;
esac
cmake -S native -B native/build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_DEPLOYMENT_TARGET=13.0 \
  "-DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" \
  "-DVCPKG_OVERLAY_TRIPLETS=$PWD/native/triplets" \
  "-DVCPKG_TARGET_TRIPLET=$triplet"
cmake --build native/build --parallel
ctest --test-dir native/build --output-on-failure
pnpm run package:mac:check
pnpm run package:mac
```

媒体 dylib 及 vcpkg 动态依赖复制到独立暂存目录，检查架构，改写依赖为 `@loader_path`，对副本做 ad-hoc 签名，再通过 Tauri 的 frameworks 配置加入 `.app/Contents/Frameworks`。应用从此目录加载媒体库，许可证放在 Resources 中。原构建库不被修改。参见 [Tauri macOS 应用包](https://v2.tauri.app/distribute/macos-application-bundle/)。

不提供 Developer ID 证书时只能作为本地开发包使用；公开发布需按 [Tauri macOS 签名与公证](https://v2.tauri.app/distribute/sign/macos/)配置自己的 Apple 身份。现有 Info.plist 的系统采集授权说明保留，安装后仍需用户给予系统录屏/音频采集权限。

## Linux

需要 GTK3、WebKitGTK 4.1、PipeWire、D-Bus 的开发依赖，以及 CMake、Ninja、pkg-config、patchelf、binutils（readelf）、Rust、Node.js 和 vcpkg。运行时需要 PipeWire 桌面会话；MPRIS 系统媒体控制需要可用的用户 D-Bus 会话。Ubuntu 22.04 的依赖示例：

```sh
sudo apt update
sudo apt install build-essential cmake ninja-build pkg-config curl zip unzip tar git \
  patchelf binutils libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev \
  libssl-dev libpipewire-0.3-dev libdbus-1-dev libfuse2
```

其他发行版按 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)安装对应包。AppImage 构建需联网下载 Tauri/linuxdeploy 工具；无 FUSE 的构建环境可按工具支持使用 `APPIMAGE_EXTRACT_AND_RUN=1`。为兼容旧系统，在计划支持的最旧发行版上构建并验收。

```sh
pnpm install
case "$(uname -m)" in
  aarch64) triplet=arm64-linux-dynamic ;;
  x86_64) triplet=x64-linux-dynamic ;;
  *) echo "不支持的架构"; exit 1 ;;
esac
cmake -S native -B native/build -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  "-DCMAKE_TOOLCHAIN_FILE=$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" \
  "-DVCPKG_OVERLAY_TRIPLETS=$PWD/native/triplets" \
  "-DVCPKG_TARGET_TRIPLET=$triplet"
cmake --build native/build --parallel
ctest --test-dir native/build --output-on-failure
pnpm run package:linux:check
pnpm run package:linux
```

媒体 `.so` 和 vcpkg 动态依赖一起放入包的 `media/` 资源目录，副本的 RPATH 设置为 `$ORIGIN`，用 readelf 校验架构、ldd 检查缺失依赖及残留构建路径。Rust 使用 Tauri 的 resource_dir 定位包内媒体库，适配 deb 和 AppImage 的目录布局。deb 声明 GTK3、WebKitGTK 4.1 和 PipeWire 运行时依赖；AppImage 也要求目标系统具备 PipeWire 等系统组件，不保证能在任意 Linux 系统运行。

## 外部媒体库与检查

默认从工程内选取最新媒体库，并从对应 CMakeCache 读取 vcpkg 安装目录与 triplet。Unix 依赖库默认读取该 triplet 的 `lib/`，许可证从 `share/` 读取。外部构建可设置：

```sh
export MUSIC_NATIVE_LIBRARY=/absolute/path/libmusic_native.so
export MUSIC_NATIVE_DEPENDENCIES=/absolute/path/installed/x64-linux-dynamic/lib
export MUSIC_NATIVE_LICENSES=/absolute/path/installed/x64-linux-dynamic/share
pnpm run package:linux:check
```

macOS 改为 `.dylib` 和相应 osx triplet。使用仓库提供的 dynamic triplet，避免把 LGPL 媒体依赖静态链接进程序；打包器拒绝缺少主要媒体动态链接、许可证、架构不匹配或依赖缺失。`--check` 会暂存和检查媒体库，但不编译客户端或生成安装包。暂存文件位于 `native/build/packaging/`，每次使用新目录。

Windows 打包步骤见 README。脚本层回归测试为 `pnpm run test:packaging`；Windows 环境上的模拟测试不替代 macOS/Linux 实机安装、签名、播放、设备授权和卸载验收。
