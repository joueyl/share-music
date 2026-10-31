# 当前安装包依赖（2026-10-29）

HTML Audio 由系统 WebView 提供，Rust HTTP 下载与缓存只校验字节，不解码音频。Tauri、Vue 等依赖按各自许可证分发。

系统媒体控制使用 [souvlaki 0.8.3](https://github.com/Sinono3/souvlaki)（MIT），许可证随包提供于 licenses/souvlaki/LICENSE。Windows 使用 WebView2 与系统 Win32 API，并由 Tauri 按 Microsoft 条款提供必要运行库。
