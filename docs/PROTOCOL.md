# 协议与实现入口

服务端权威状态在 `apps/server/src/engine.ts`，WebSocket 接入在 `gateway.ts`。客户端连接与命令由 `apps/client/src/bridge.ts` 管理。

## 控制

WebSocket `/ws` 建立后 5 秒内发送 `auth` 与 token；成功后发送 `join`。单账号同时只保留一条控制连接。音源加载与 ready 上报绑定当前房间和播放代次。

命令消息为 `{type:"command",data:{commandId,roomId,expectedStateVersion,action:{type,payload}}}`。服务端依次鉴权、版本检查和去重，冲突返回快照。操作名与严格 payload 由 `packages/shared/src/index.ts` 定义。

`pending` 包含旧播放状态、准备代次、ready 成员、5 秒截止时间与 committed 标志。所有在线成员准备完成或超时后公布生效时间；最少保留 200ms 提交窗口。暂停与音质切换按最终生效时间从旧时间轴重算位置，seek 使用请求位置。

客户端发送 clock 消息测量往返；采用低延迟样本估计服务器偏移，渲染时本地计算锚点后的进度。服务端快照始终是权威状态。

## 房间聊天与生产部署检查

聊天流也包含服务端生成的操作记录（`ChatMessage.kind: "activity"`）。记录带服务端确认的操作者、时间和歌曲名称，包括点播、上一首/下一首、暂停/继续、停止、拖动进度（`mm:ss`）、添加/移除歌曲、清空/排序和音质调整。客户端以轻量提示行与普通聊天按顺序混排，沿用滚动、未读提示和加入房间历史。

记录表示操作已被服务端接受；播放类操作仍需后续音源准备和同步，不保证音频已实际发声。失败/无权限/版本冲突的操作、命令重试、自动进度上报及后台同步不会产生记录。记录与聊天共享最近 100 条进程内历史，重启后清空，仅同房间可见；必须同时更新服务端才能生成记录。

客户端通过同一条 `/ws` 发送 `{type:"chat",roomId,requestId,text}`，`requestId` 为 UUID。
服务端保存消息后向发送者返回 `{type:"chat-result",requestId,data}`，再向房内广播 `{type:"chat",data}`；失败返回 `{type:"chat-error",requestId,error}`。
客户端兼容旧版仅广播的成功确认；收到旧服务端 `UNKNOWN_MESSAGE` 时提示更新服务端。
相同用户、相同 requestId 的重试在最近 100 条历史范围内返回原消息，不重复广播；超时只代表未确认，并不保证消息未发送。

生产环境必须同步更新服务端与客户端，不能只重新打包桌面客户端。
使用仓库提供的 Compose 部署时，在仓库根目录执行 `docker compose -f deploy/compose.yml up -d --build api`，保留现有数据卷，不要使用 `down -v`。
更新后检查 `/api/health` 返回 `chatProtocolVersion: 1`，再让客户端重新连接。
缺少该字段只能说明未部署本次回执版本，不能单独据此判定旧服务端是否支持聊天。
若经负载均衡部署了多个实例，当前房间状态与聊天历史均在进程内，不能无状态地跨实例分发同一房间的连接。

## 音源加载与播放

客户端 `bridge.ts` 管理 HTTP、WebSocket 与唯一播放器，`cloud-player.ts` 控制 HTML Audio；Rust `apps/client/src-tauri/src/music_cache.rs` 和 `playback_audio.rs` 提供桌面下载、完整性校验与缓存。

客户端通过受权限保护的音乐接口取得音源：桌面下载 HTTPS 网易云 CDN 原始字节，浏览器使用 `/api/rooms/:id/music/:trackId/audio`。下载限制为 100 MiB，前端计算 MD5 并比对接口值和文件大小后创建 Blob；下载失败或不一致时自动强制刷新直链与配套摘要、大小并重新下载校验一次，成功后继续播放；桌面缓存同样校验。后端只从接口保存 MD5 和大小，不为导入或续链下载音频；网页音频代理仅做有界下载和权限检查。接口和链接刷新策略见 [API](API.md) 与 [音乐来源说明](MUSIC-SEARCH.md)。

播放器等待目标位置 seek 完成且 buffered 后报告 ready，服务端提交生效时间后按共享时间轴播放、暂停和纠偏。房间、歌曲或播放代次切换后忽略过期下载与异步结果；换歌和离房释放内存 Blob，桌面磁盘缓存按内容哈希复用。本地音量不影响其他成员。
