# 当前安装包依赖（2026-10-29）

HTML Audio 由系统 WebView 提供，Rust HTTP 下载与缓存只校验字节，不解码音频。Tauri、Vue 等依赖按各自许可证分发。

系统媒体控制使用 [souvlaki 0.8.3](https://github.com/Sinono3/souvlaki)（MIT），许可证随包提供于 licenses/souvlaki/LICENSE。Windows 使用 WebView2 与系统 Win32 API，并由 Tauri 按 Microsoft 条款提供必要运行库。

## 聊天通知

桌面原生通知使用 Tauri 官方 `tauri-plugin-notification`（MIT / Apache-2.0），随 Rust 依赖安装，不运行外部命令。

提示音由用户提供的 `Nokia Calendar 2013_96545226 - Nokia Design Team.ogg` 转换为 48kHz、双声道 16-bit PCM WAV（约 4.993 秒），资源位于 `apps/client/src/assets/chat-notification.wav`。仅作编码转换，不依赖用户本机路径，不宣称获得 Nokia 的许可证或商标授权。项目发布者已于 2026-10-31 确认可随本公开项目再分发；此处记录发布者确认，不代表独立取得或核验了 Nokia 官方许可。

原生通知的显示、任务栏高亮/Dock 跳动及声音受系统通知设置、勿扰模式和桌面环境支持影响；开发态成功不等于安装后的三平台提醒已验收。
