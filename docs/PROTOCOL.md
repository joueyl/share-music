# 协议与实现入口

服务端权威状态在 `apps/server/src/engine.ts`，WebSocket 接入在 `gateway.ts`。Rust 网络 actor 在 `control.rs`，专用媒体工作线程在 `media.rs`，原生 ABI 在 `native/bridge.h`。

## 控制

WebSocket `/ws` 建立后 5 秒内发送 `auth` 与 token；成功后发送 `join`。单账号同时只保留一条控制连接。媒体只接受当前房间当前/准备代次的授权源。

命令消息为 `{type:"command",data:{commandId,roomId,expectedStateVersion,action:{type,payload}}}`。服务端依次鉴权、版本检查和去重，冲突返回快照。操作名与严格 payload 由 `packages/shared/src/index.ts` 定义。

`pending` 包含旧播放状态、准备代次、ready 成员、5 秒截止时间与 committed 标志。所有在线成员准备完成或超时后公布生效时间；最少保留 200ms 提交窗口。暂停与音质切换按最终生效时间从旧时间轴重算位置，seek 使用请求位置。

客户端发送 clock 消息测量往返；采用低延迟样本估计服务器偏移，渲染时本地计算锚点后的进度。服务端快照始终是权威状态。

## 房间聊天与生产部署检查

客户端通过同一条 `/ws` 发送 `{type:"chat",roomId,requestId,text}`，`requestId` 为 UUID。
服务端保存消息后向发送者返回 `{type:"chat-result",requestId,data}`，再向房内广播 `{type:"chat",data}`；失败返回 `{type:"chat-error",requestId,error}`。
客户端兼容旧版仅广播的成功确认；收到旧服务端 `UNKNOWN_MESSAGE` 时提示更新服务端，不再笼统等待超时。
相同用户、相同 requestId 的重试在最近 100 条历史范围内返回原消息，不重复广播；超时只代表未确认，并不保证消息未发送。

生产环境必须同步更新服务端与客户端，不能只重新打包桌面客户端。
使用仓库提供的 Compose 部署时，在仓库根目录执行 `docker compose -f deploy/compose.yml up -d --build api`，保留现有数据卷，不要使用 `down -v`。
更新后检查 `/api/health` 返回 `chatProtocolVersion: 1`，再让客户端重新连接。
缺少该字段只能说明未部署本次回执版本，不能单独据此判定旧服务端是否支持聊天。
若经负载均衡部署了多个实例，当前房间状态与聊天历史均在进程内，不能无状态地跨实例分发同一房间的连接。

## 媒体

Rust `packet.rs` 定义固定 76 字节头：魔数/版本、编码、规格、音源代次、块序号、媒体位置、分片索引/数量、总长及 SHA-256。消息上限为协商上限与 16KiB 的较小值；单块 ≤256KiB，最多 64 个在途重组，超时 5 秒。接收端核对当前代次、规格和校验。

FLAC 音频块可独立解码。Opus 块带原帧数、包数与 lookahead 补偿，解码后保持原时长；仅显式有损模式允许采样率转换。PCM 缓冲按媒体位置索引，缺口不视为可播放数据。

DataChannel `playback` 和 `prefetch` 使用可靠传输，连接总排队阈值 512KiB，原生事件队列上限 8MiB。预取低优先级；可靠重传会增加延迟。`MSP1`/`MSR1`/`MSC1` 为有限吞吐探测和确认消息。

## 中继

每条提供者→接收者链路独立租约，全部房间共享 3.5Mbps；预留媒体码率 ×1.2。续租绑定 room/provider/receiver/epoch，不可换接收者复用。凭证有效 60 秒，预留持续 95 秒；服务器整形是实际出口上限的最终约束。

原生 ABI 版本化且不暴露 C++ 对象布局。Rust 加载同目录库，桌面 IPC 只包含操作、状态、设备和统计，不含音频字节。

系统推流专用命令 `stopLive` 的 payload 为 `{sourceEpoch}`。服务端验证该代次属于直播且调用者是提供者或房主；可取消准备或结束当前直播，不依赖提供者的切歌权限。
