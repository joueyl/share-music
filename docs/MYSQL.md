# MySQL 迁移与运行说明

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
| users | id、name（唯一用户名，注册/登录使用）、display_name、avatar_url、password_hash、salt、last_login_ip（最近一次成功登录 IP）、netease_profile_url（当前账号绑定的规范化网易云主页链接）、created_at、updated_at |
| rooms | id、name、host_id（当前房主）、creator_id（原始创建者）、creator_name、creator_display_name、creator_avatar_url（创建时用户名/显示名/头像）、description、atmosphere（日落/深夜/周末/自定义）、visibility（公开/邀请）、category、cover_url、invite_code、defaults_json、overrides_json、created_at、updated_at |
| user_favorite_songs | user_id、source、song_id（联合主键）、name、artists、album、cover_url、duration_ms、saved_at；当前用户的单曲收藏，用户外键级联删除，用户/收藏时间索引 |
| songs | sequence、scope、source、content_hash、name、artists、album、cover_url、duration_ms、size_bytes、lossless、bitrate_bps、sample_rate、bits、channels、netease_id、source_url、source_expires_at、track_json、detail_json、created_at、updated_at |

辅助表：room_tracks 保存房间歌曲 UUID、排序、添加者及完整队列元数据；settings 保存服务端配置；schema_migrations 记录版本。
rooms.host_id 和 rooms.creator_id 外键关联 users；room_tracks.room_id 关联 rooms。songs 按 `(scope,source)` 唯一。
creator_id 在新房间创建时由已认证用户写入，后续房主转移或房间保存不改变它；历史未知创建者留 NULL。last_login_ip 只保留最近一次成功注册/密码登录的地址，失败登录和 token 验证不更新，不对普通 API 公开；须按账号敏感数据限制数据库访问，不额外打印 IP。代理部署的 `TRUST_PROXY` 配置见 [API](API.md#post-apilogin) 与配置模板，未配置时仅记录直连地址。
创建时由服务端读取该认证用户的资料，另存 creator_name、creator_display_name、creator_avatar_url 快照，后续资料变更或房主转移不覆盖它们。缺少显示名时使用用户名，头像可空；不复制密码哈希、盐、Cookie 或登录 IP。创建者资料快照仅在数据库内部保存，现有房间响应不新增这些字段。
相同内容可有多个来源；未完整解析的老歌曲保留 track_json，其可空元数据不会被编造。
房间内点歌写入 room_tracks。公共来源歌曲在 songs 中按 `(scope,source)` 更新，队列 UUID、排序、添加者和完整快照在 room_tracks 中保留；同一首歌加入多个房间不会因此复制公共歌曲资料。历史来源和不同音频版本仍可能各有记录，不能仅凭歌名批量删重。

新增设计字段应先修改共享 Zod schema/类型、API 校验与文档，再新增有版本号的 **ALTER TABLE** 迁移；
启动提供版本 1 的基础初始化、版本 2 的音乐直链字段升级、版本 3 的登录 IP/创建者字段与创建者外键升级，以及版本 4 的创建者资料快照字段升级。升级前备份数据库，部署新版后端并重启，启动账号需具备对应 ALTER/REFERENCES 权限；旧用户 IP、旧房间未知创建者及缺失的创建时资料保持 NULL，后续成功登录才补充 IP。快照不从当前用户资料自动回填，新建房间才保存创建时资料。不会任意根据网页内容动态执行 DDL，也不会自动重建/删表。此升级不需要重新导入 SQLite，也不修改已发布客户端协议。
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

先部署使用公共来源歌曲与独立 room_tracks 队列的新版本。以下命令均在仓库根目录执行，由服务端本地环境文件读取数据库配置；日志只包含计数和备份表名，不输出连接串或歌曲内容。

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

接口详见 [API.md](API.md) 与 [openapi.json](openapi.json)。

## 用户名认证调整（2026-10-29）

注册与登录均只接受 name/password/register，不接受 email，也不通过邮箱别名查找账号。
不自动将包含 @ 的用户名写入邮箱，不改写大小写；现有账号及密码不受影响。
保留已有 users.email 列和数据作为历史预留，不进行破坏性删列或重新导入。

## 音乐直链字段（迁移版本 2）

版本 2 为 songs 增加 source_url（TEXT）与 source_expires_at（BIGINT 毫秒）。新增和刷新歌曲都会更新 URL、过期时间及完整 JSON，scope 为 netease；房间队列使用独立歌曲 UUID。

链接按使用需求获取，不在迁移时批量访问音乐提供商。两种音源导入和续链均只读取链接与大小等元数据，不下载音频计算摘要；网页播放代理临时转发，不在服务端保存音频。桌面保留原有本地缓存，`contentHash` 仅作稳定键，无数据库结构迁移。

## 单曲收藏增量（版本 5）

启动时幂等创建 `user_favorite_songs` 并记录 schema_migrations=5；不清空/回填旧歌单收藏，不保存音频地址、凭据或文件。升级先备份数据库，使用可建表/索引的账号重启新版后端并同步升级客户端。未在此开发任务中连接或执行生产迁移；MySQL DDL/索引/外键需在目标环境验收。SQLite 隔离测试也使用独立收藏表；手动旧库迁移会导入并核对单曲收藏，仍要求空目标和显式确认，不自动运行。

## 个人信息中的网易云绑定（版本 6）

`users.netease_profile_url VARCHAR(255) NULL` 保存规范化 `https://music.163.com/user?id=<网易云ID>`；NULL 表示未绑定。服务端先验证真实网易云主页身份，再按已认证同频用户 ID 更新，不覆盖用户名、昵称和头像，不保存 Cookie、分享追踪参数或账号密码。该字段不加入登录/token 验证的公开用户响应；绑定不是网易云登录或所有权认证。

启动时幂等加列并记录版本 6；旧 `settings` 的 `music.profile.<用户UUID>` 引用由个人主页接口首次读取时兼容迁移。绑定/解除时用户列更新与旧记录清理在一个事务中完成，异常回滚，防止解除后旧绑定恢复。规范化列优先于旧引用；损坏存量数据保留并报错，不猜测回填。

升级需先备份数据库、提供相应 ALTER TABLE 权限并重启后端；本次代码任务不执行生产迁移。SQLite 内存/临时文件隔离测试覆盖字段、旧值迁移、回滚与关闭重开；旧 SQLite→MySQL 手动迁移会保留并核对已有用户绑定列，继续要求空目标和显式确认。真实 MySQL 实机升级仍需验收。

版本 6 验证：个人绑定/数据库相关 27 项隔离回归通过，全仓 662 项通过、1 项按配置跳过；类型检查、完整构建及 diff 空白检查通过。SQLite 已验证真实临时文件关闭重开和密码重登恢复，MySQL 使用模拟执行器验证参数化、幂等迁移及事务回滚；未执行真实 MySQL/生产迁移或真实网易云接口联调。新绑定不再写旧 settings，不能混跑新旧后端；回滚旧服务端前需单独处理绑定数据兼容，不自动回填旧格式。
