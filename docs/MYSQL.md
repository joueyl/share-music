# MySQL 迁移与运行说明

## 本次实际结果（2026-10-29）

目标：`localhost:3306` / `share-music`。已获用户授权导入当前 SQLite，使用本地环境文件中的凭据，未在文档记录凭据。
事务已提交，账号哈希/盐、歌曲来源 JSON、详情、上传键和设置逐项核对。

| 目标表 | 实际行数 |
|---|---:|
| users | 2 |
| rooms | 1 |
| songs | 6 |
| music_assets | 6 |
| settings | 1 |
| room_tracks | 0 |
| schema_migrations | 1 |

源数据还包含 1 条歌曲完整详情，已合并到 songs.detail_json。源房间未保存队列，因此 room_tracks 为 0，不代表导入漏失。
原始 SQLite 未删除；使用 SQLite 在线备份 API（包含 WAL 已提交内容）创建了同目录备份：
`apps/server/data/music-share.sqlite.backup-1793257908866.sqlite`。

## 配置

复制/更新 `apps/server/.env`：

```dotenv
DATABASE_DRIVER=mysql
DATABASE_URL=mysql://music_share:REPLACE_ME@localhost:3306/share-music
# MYSQL_SSL_CA=/absolute/path/to/mysql-ca.pem
```

用户名/密码特殊字符必须 URL 编码。数据库应使用 utf8mb4；推荐独立业务账号和最小权限。
初次初始化需要建表/索引权限，运行需要 SELECT/INSERT/UPDATE/DELETE；后续可拆分迁移账号与运行账号。
当前启动流程会执行幂等建表及版本化增量字段迁移，因此运行账号仍需相应 DDL 权限。

MySQL 8.0+、InnoDB、utf8mb4_bin；连接池最多 10 个连接，参数化 execute，不拼接用户字段。
远程部署建议配置 MYSQL_SSL_CA 验证服务端证书；未配置时不会自动启用 TLS。切勿设置跳过证书验证。
MySQL 配置错误或不可达时启动失败，不会退回 SQLite。非生产测试可显式 `DATABASE_DRIVER=sqlite`。
Docker 内 localhost 指容器自身；宿主机 MySQL 应使用合适的网络地址，例如 Docker Desktop 的 host.docker.internal。
Compose 保留旧 SQLite 数据卷作为回退资料，不自动部署或清空 MySQL。

## 核心表与设计映射

| 表 | 关键字段 / Brilliant 设计 |
|---|---|
| users | id、name（唯一用户名，注册/登录使用）、email（历史预留，不参与认证）、display_name、avatar_url、password_hash、salt、created_at、updated_at |
| rooms | id、name、host_id、description、atmosphere（日落/深夜/周末/自定义）、visibility（公开/邀请）、category、cover_url、invite_code、defaults_json、overrides_json、created_at、updated_at |
| songs | sequence、scope、source、content_hash、name、artists、album、cover_url、duration_ms、size_bytes、lossless、bitrate_bps、sample_rate、bits、channels、oss_key（历史）、netease_id、source_url、source_expires_at、track_json、detail_json、created_at、updated_at |

辅助表：room_tracks 保存房间歌曲 UUID、排序、添加者及完整队列元数据；music_assets 保存已成功登记的 OSS 资产；settings 保存服务端配置；schema_migrations 记录版本。
rooms.host_id 外键关联 users；room_tracks.room_id 关联 rooms。songs 按 `(scope,source)` 唯一，资产按 `(scope,hash)` 唯一。
相同内容可有多个来源；未完整解析的老歌曲保留 track_json，其可空元数据不会被编造。
房间内点歌只写 room_tracks，不再向 songs 写入 scope=`room:<房间UUID>` 的重复歌曲。公共来源歌曲在 songs 中按 `(scope,source)` 更新，队列 UUID、排序、添加者和完整快照在 room_tracks 中保留；同一首歌加入多个房间不会因此复制公共歌曲资料。历史来源和不同音频版本仍可能各有记录，不能仅凭歌名批量删重。

新增设计字段应先修改共享 Zod schema/类型、API 校验与文档，再新增有版本号的 **ALTER TABLE** 迁移；
本版提供版本 1 的基础初始化，以及版本 2 的音乐直链字段增量升级，不会任意根据网页内容动态执行 DDL，也不会自动重建/删表。
JSON 保留来源详情与扩展兼容信息，但公共 API 仍严格限制字段。

## 重新执行迁移（仅供其他空库）

1. 停止旧服务及其他写入者；安全保存 SQLite 主文件、WAL 和配置。不要只复制正在使用的主文件。
2. 创建一个**空的**目标数据库，设置本地 DATABASE_URL；不要让新旧服务同时写入。
3. 根目录执行预检（source 相对于 apps/server 工作目录）：

```powershell
npm run db:migrate -w @music-share/server -- --source=data/music-share.sqlite --dry-run
```

4. 检查计数后实际导入：

```powershell
npm run db:migrate -w @music-share/server -- --source=data/music-share.sqlite --confirm
```

未提供 --confirm 默认只预检；--confirm 会先生成备份，再读取一致性快照，初始化目标结构，在一个事务中导入和校验。
非空目标会拒绝，不覆盖、不合并、不使用 INSERT IGNORE 吞掉用户/歌曲冲突；重复执行已迁移库会失败。
DDL 初始化不属于数据事务，失败可能留下空表；已成功导入的数据不会被后续重复迁移破坏。
迁移日志只打印计数、备份路径和成功/失败状态，不输出密码哈希、Cookie、连接串。

5. `npm run dev:server` 或构建后 `npm run start -w @music-share/server`；检查 `/api/health`。
保持 TOKEN_SECRET 可保留尚未过期的旧登录 token；密码哈希和盐无需重置。

## 一致性和回滚

### 清理旧版房间歌曲副本

先部署已移除重复写入的新版本。以下命令均在仓库根目录执行，由服务端本地环境文件读取数据库配置；日志只包含计数和备份表名，不输出连接串或歌曲内容。

```powershell
# 默认只读预检，也可显式加 --dry-run
npm run db:cleanup-room-songs -w @music-share/server -- --dry-run

# 停止服务和其他写入者、检查预检结果后再执行
npm run db:cleanup-room-songs -w @music-share/server -- --confirm
```

工具只清理 room UUID / track UUID 格式的旧副本，且要求无独有 detail_json、已有完整 netease 公共来源、相同网易云 ID、内容哈希及文件大小。没有可靠公共副本或音频内容不同的旧记录不动；room_tracks、播放列表顺序及公共歌曲资料不动。

确认执行时，先创建唯一的 `songs_room_backup_<随机值>` 备份表，再在同一事务中保存候选完整行、删除这些行并核对数量；写入或校验失败会回滚。不自动在服务启动时删除数据。DDL 不属于事务，失败可能留下空备份表；不要把空表当作成功清理。备份表可能包含已过期音源链接，应按数据库备份权限和保留策略管理。重复预检只统计剩余候选，不会重复清理已删除行。

房间和队列在同一 MySQL 事务提交。同步引擎的写入按顺序排队，HTTP/WS 成功回执等待落库；写失败后保护性拒绝后续操作，需修复并重启。
广播也等待落库。数据不做双写，MySQL 中手工修改房间后须重启服务加载。
运行中在线人数、播放时间轴和聊天仍在内存，不适合多实例共享连接；重启后需重新加入，播放停止。

导入前回滚：保留原 SQLite 和配置，用旧版本服务恢复。导入后已经发生新写入时，不能直接切回旧 SQLite，否则会丢失新数据；需另行导出合并。
不要删除目标库、原文件或备份来“重试”。备份含密码哈希、服务端 Cookie，需限制文件权限，并按备份保留策略处理。

## 验证

- `npm run typecheck`：服务端和客户端类型检查。
- `npm run build`：构建。
- `npm test`：默认隔离测试，真实 MySQL 测试默认跳过。
- 在根目录 PowerShell 设置 `$env:RUN_MYSQL_TESTS='1'`，然后运行：
  `node --env-file=apps/server/.env node_modules/vitest/vitest.mjs run apps/server/test packages/shared/test`
- 真实 MySQL 测试需要临时 CREATE/DROP DATABASE 权限，只创建并删除随机命名的 `music_share_verify_<随机值>`，不改业务库。
- 本次真实 MySQL 与服务端/共享协议测试 **110/110 通过**，包含真实 HTTP 启动、原密码登录、设置修改、写入确认和回滚。
- 初始工作区已有客户端 bridge/store 未提交修改，未覆盖；当前客户端 WebRTC 测试另有 4 项失败；相关文件在本任务开始前已存在修改，本次未覆盖。

接口详见 [API.md](API.md) 与 [openapi.json](openapi.json)。

## 用户名认证调整（2026-10-29）

注册与登录均只接受 name/password/register，不接受 email，也不通过邮箱别名查找账号。
不自动将包含 @ 的用户名写入邮箱，不改写大小写；现有账号及密码不受影响。
保留已有 users.email 列和数据作为历史预留，不进行破坏性删列或重新导入。

## 音乐直链升级（2026-10-29，版本 2）

已对 `share-music` 执行增量升级：songs 新增 source_url（TEXT）和 source_expires_at（BIGINT 毫秒），schema_migrations 包含版本 1、2。
原有 6 条歌曲记录均保留稳定网易云 ID，可在下次加入/播放时取链；不在升级时批量访问音乐提供商。
旧 OSS 资产索引/对象键仅作为历史数据保留，不清库、不删除云对象，也不再读取云对象。
新记录的 scope 为 netease；队列仍使用独立歌曲 UUID。新增和刷新都会更新 URL、过期时间及完整 JSON。
本地 .env 和 .env.example 已移除对象存储变量，实际 MySQL 配置下不再保留 DATABASE_PATH。
TURN/STUN 仍用于兼容功能和启动校验，因此未误删；不再需要 ali-oss SDK。
音频只为计算哈希/音频参数和网页播放而临时读取，不在服务端保存音频文件；桌面客户端保留本地校验缓存。

### 直链版本验证结果

相关服务端、共享类型、客户端播放/缓存/搜索/登录测试 128/128 通过（含独立真实 MySQL 临时库验证）；Rust 单元测试 26/26 通过，1 项原生端到端媒体测试因缺少专用测试环境跳过。
类型检查及前后端构建通过；全量测试仍有之前已存在的 4 项 WebRTC 告警测试失败，未将其算作本次直链验证通过项。
当前业务库音乐库为 6 首，6 首均具备可续期歌曲 ID。链接按使用需求获取，不在升级时自动批量下载。
本地 .env 检查确认不再含 OSS_* 或当前已废弃的 DATABASE_PATH，数据库账号/密码等其他有效配置未改动。
