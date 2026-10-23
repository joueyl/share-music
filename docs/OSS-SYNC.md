# OSS 文件音乐架构

文件通过认证 HTTP 上传接口上传到 OSS（单文件 100MB）；WebSocket 负责房间状态、就绪和播放进度。音乐不经 WebSocket 传输。

服务端配置 OSS_BUCKET、OSS_REGION、OSS_ENDPOINT（例如 oss-cn-hangzhou.aliyuncs.com）、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET。上传和播放均使用官方 ali-oss SDK 生成的 V4 签名，不再使用旧 V1 签名。使用仅有 music/ 前缀读写权限的 RAM 身份。Bucket 设私有，设置允许客户端来源的 GET/HEAD CORS，签名播放地址一小时有效。不要将密钥放入前端。

每次播放/跳转重新选最先报告 canplay 的成员，200ms 后生效。慢成员加载后按服务器时间追齐。基准成员离开后由下一个报告有效进度的成员接替。没有就绪者时保持等待，可停止取消。客户端进度仅允许当前 epoch、在线成员及五秒内的漂移修正。

当前文件走 Web Audio 解码校验和 HTMLAudio 播放，不保证原生 bit-perfect 无损；上传的字节保持原样。浏览器不支持的编码无法上传。系统推流已移除：没有设备采集入口、推流面板和审批操作，服务端协议不再接受 startLive/requestLive/approveLive/rejectLive/stopLive。底层原生媒体库和旧快照字段仅作兼容保留，不提供系统推流功能。上传/播放需要 HTTPS 安全上下文（localhost 开发除外）。播放地址过期后需重新切歌。列表仍为内存状态，服务器重启会清空列表；OSS 对象需配置生命周期清理未引用文件。

未配置真实 OSS 凭据时不能验证云端上传和多设备实际同步。桌面端需要重新构建前端和安装包。

开发客户端使用 http://127.0.0.1:11420（旧端口 1420 可能被 Windows 保留）。部署自定义 ALLOWED_ORIGINS 时需允许这个开发来源；打包版仍使用 Tauri 来源。

## 本项目接入点配置

本地 `apps/server/.env` 已填入用户提供的非敏感连接信息：

```dotenv
OSS_BUCKET=jouei-music-share
OSS_REGION=cn-hangzhou
OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
OSS_ACCESS_POINT_ENDPOINT=node-1463865318371961.oss-cn-hangzhou.oss-accesspoint.aliyuncs.com
OSS_ACCESS_POINT_ALIAS=node-c20dbedd7a8f7525f7acb47894c523771a-ossalias
```

`OSS_ACCESS_POINT_ENDPOINT` 和 `OSS_ACCESS_POINT_ALIAS` 必须同时配置。接入点模式下，完整域名用于 HTTPS 路由（不会在前面追加 Bucket），别名代替 Bucket 参与资源签名；真实 Bucket 名仅保留为关联配置信息，不从域名猜测或查询。程序无法仅靠这些字符串验证该接入点确实关联该 Bucket，需在控制台核对。两项均留空时走标准 Bucket Endpoint；填错不会静默绕过接入点。

在同一 `.env` 本地填入被授权 RAM 身份的 `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`，不要提交或发送密钥。使用临时凭据时同时设置 `OSS_SECURITY_TOKEN`，凭据过期后需刷新并重启服务。重启命令为 `npm run dev:server`。

在阿里云控制台配置：接入点策略和 RAM 身份允许该应用所需的 `oss:PutObject`、`oss:GetObject`，资源范围限制到 `music/*`；Bucket Policy 委派给对应接入点。不要为方便调试改成公共读写或授予所有 OSS 操作。浏览器直接从 OSS 播放要求该接入点可从公网访问；仅 VPC 接入点不适合此路径。按实际客户端来源配置 GET/HEAD CORS，允许 Range 请求。

当前验证只覆盖本地配置、签名、HTTP 上传请求构造及错误处理；只有真实凭据与策略齐备后，才能验证云端上传、签名播放和 Range/CORS。没有执行真实上传。

参考：[接入点说明](https://help.aliyun.com/zh/oss/user-guide/access-point/)、[V4 URL 签名](https://help.aliyun.com/zh/oss/developer-reference/add-signatures-to-urls)。

## 上传故障诊断

客户端现在显示经过白名单过滤的 OSS 错误码和 RequestId（若 OSS 提供），不会展示原始 XML、签名 URL、AccessKey 或 StringToSign。HTTP 502 表示服务端上传 OSS 失败，不等同于客户端到服务端连接失败。`AccessDenied` 需检查 RAM、Bucket 委派及接入点策略的 `music/*` 读写权限；`SignatureDoesNotMatch` 需要核对凭据、别名、地域和时间；`NetworkError`/`Timeout` 需要排查服务端网络。原来的通用 `OSS_UPLOAD_FAILED` 不足以单独判断根因。

Nginx 示例对 `/api/music/upload` 单独放宽到 100MB，并允许 150 秒上游等待；其他 API 保持 32KB 限制。更新代理配置后需检查配置并重载，修改示例不会自动影响已部署 Nginx。
