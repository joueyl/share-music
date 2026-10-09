# Windows 媒体依赖与源码

安装包动态链接 FFmpeg、FLAC、Opus、SDL2、libdatachannel、libjuice、OpenSSL、Ogg 等组件。各组件的原始许可证随安装包放在 `licenses/<组件>/copyright`。这些许可证仅适用于对应第三方组件，不为本项目指定许可证。

本次依赖由 vcpkg baseline `2750401336fb7c95f6619657a46a7e798661341c` 构建，具体版本、源码地址及补丁见 [对应 vcpkg ports](https://github.com/microsoft/vcpkg/tree/2750401336fb7c95f6619657a46a7e798661341c/ports)。原生构建配置见随源码交付的 `native/vcpkg.json` 与 `native/CMakeLists.txt`；FFmpeg 未启用 GPL/nonfree 功能。

FFmpeg 与 SDL2 使用 LGPL；请保留对应许可和通知。动态库独立于客户端，可使用 ABI 兼容的自行构建版本替换来调试库的修改。重新发布不同构建时，应核对实际版本、许可证及提供对应源码的义务。项目源码包不包含第三方完整源码。

上游源码：

- FFmpeg：https://ffmpeg.org/download.html
- SDL2：https://github.com/libsdl-org/SDL/tree/SDL2
- FLAC：https://github.com/xiph/flac
- Opus：https://github.com/xiph/opus
- Ogg：https://github.com/xiph/ogg
- libdatachannel：https://github.com/paullouisageneau/libdatachannel
- libjuice：https://github.com/paullouisageneau/libjuice
- OpenSSL：https://github.com/openssl/openssl

Windows 安装包也包含 Tauri 打包工具提供的 Microsoft Visual C++ 运行库，按 Microsoft 的再分发条款使用。
