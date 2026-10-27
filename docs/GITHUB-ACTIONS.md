# GitHub Actions 自动打包

工作流：`.github/workflows/desktop-release.yml`，名称为 **Desktop installers**。现覆盖 Windows x64、Linux x64 和 macOS Intel / Apple Silicon 四种构建目标，并支持配置签名后的应用内更新。旧 Windows 单平台工作流已移除，避免重复创建草稿。

## 首次配置

1. 将源码及工作流文件提交并推送到你自己的 GitHub 仓库，确保默认分支包含此工作流，仓库已启用 Actions。
2. 在 **Settings → Secrets and variables → Actions → Variables** 中，可选设置 `VITE_SERVER_URL` 为实际生产服务地址，例如 `https://music.example.com`。这是内置到客户端的公开地址，不能含账号密码、路径或查询参数。未设置时使用工程 `apps/client/.env.production` 的现有公开地址。
3. 普通打包无需个人访问令牌或私钥；启用应用内更新需按 [更新配置](UPDATER.md) 设置公钥 Variable 和签名 Secrets。构建任务仅有 `contents: read`；标签构建成功后的独立草稿任务使用 GitHub 自动提供的 `GITHUB_TOKEN` 和 `contents: write`。组织/仓库策略可能需要允许工作流创建 Release。
4. 现有安装包未进行 Windows 代码签名；首次下载/安装可能触发系统安全提示。SHA-256 校验文件不是发布者身份签名，也不替代 Tauri 更新签名。

## 手动打包（建议先执行）

在 **Actions → Desktop installers → Run workflow** 选择分支并运行，一次触发全部四种构建目标。流水线将：

- 校验版本、更新日志和生产服务地址，执行 `npm ci` 与 JavaScript 测试。
- 安装固定 Rust 1.90.0；按 `native/vcpkg.json` 的 builtin-baseline 检出 vcpkg。
- 缓存 vcpkg 编译产物，构建原生媒体库并执行 CTest。
- 调用对应平台的 `package:win` / `package:linux` / `package:mac` 及检查命令。Linux 安装 WebKitGTK 4.1、GTK3、PipeWire、D-Bus 等依赖，使用 x64-linux-dynamic triplet；macOS 使用 x64-osx-dynamic 或 arm64-osx-dynamic，并设置最低系统版本 13.0。
- 每个目标独立上传名为 `music-share-目标-版本号` 的 Actions Artifact，保留 30 天；包含对应安装包、`SHA256SUMS-目标.txt`、`RELEASE-NOTES.md`。文件名统一包含版本、平台及架构，避免冲突。

手动运行不创建或公开 Release。产物可从本次 Actions 运行页面下载。首次构建 FFmpeg 等原生依赖较慢，工作流超时为 180 分钟；实际耗时受 GitHub runner 和网络影响，私有仓库还需留意 Actions 配额。

## 版本标签与 Release 草稿

先按 RELEASING.md 准备新版本、审阅更新日志并提交代码，再推送匹配的标签。以下是准备 `0.1.2` 的示例；若当前版本已不同，请使用实际下一版本：

```powershell
npm run release:version -- 0.1.2
# 审阅、测试并提交版本文件和工作流后：
git tag v0.1.2
git push origin v0.1.2
```

标签必须与项目版本完全一致。四种目标全部构建成功后，独立汇总任务重新计算每个安装包的 SHA-256，检查各目标的更新日志和版本一致；缺少目标或校验失败时不会创建草稿。通过后创建 `v0.1.2` 的 **Draft Release**，填入该版本 CHANGELOG.md 说明并附上五个安装包（Windows 一个、Linux 两个、macOS 两个）、统一的 SHA256SUMS.txt 和 RELEASE-NOTES.md，共七个附件（未启用更新时）。启用签名更新时另含两份 macOS 更新压缩包、四份签名和 latest.json，共十四个附件。发布者下载并验收安装包，再手动点 **Publish release** 对外发布。

已有同名 Release 时创建步骤会失败，不覆盖已发布内容。失败重跑前先检查是否已有草稿或部分上传的附件；不要删除正式发布版本或强制移动已公开标签。若构建成功但草稿任务因权限失败，Actions Artifact 仍可下载。

## 平台与签名

| 平台 | Runner | 架构 | 产物 |
| --- | --- | --- | --- |
| Windows | windows-2022 | x64 | NSIS .exe |
| Linux | ubuntu-22.04 | x64 | .deb、.AppImage |
| macOS Intel | macos-15-intel | x64 | .dmg |
| macOS Apple Silicon | macos-15 | arm64 | .dmg |

对应系统原生编译，不交叉编译；macOS 两种架构分别发布，不是 Universal Binary。Linux ARM64 尚未配置。Runner 标签参考 [GitHub 官方镜像列表](https://github.com/actions/runner-images#available-images)，今后可能随镜像生命周期调整。

macOS 当前使用 ad-hoc 签名（APPLE_SIGNING_IDENTITY=-），未配置 Developer ID 与 Apple 公证，不能视为已满足正式公开分发签名要求。正式分发前应单独配置证书与公证并实机验收，不要用关闭系统安全机制替代签名。

## 验证边界

本地可运行 `npm run test:ci-release` 和 `npm run test:version`。这些测试覆盖标签与版本匹配、公开地址校验、日志提取、四架构产物筛选、汇总和真实 SHA-256 计算，不代表已在 GitHub runner 上完成原生编译、安装包生成或实机安装验收。

此工作流已接入 Tauri Updater：配置匹配的公钥和签名 Secrets 后生成 `.sig`、`latest.json`，并在收集及汇总时验证签名。不自动公开 Release、不部署 NestJS 服务，也不上传 OSS。首次配置和完整流程见 [GitHub 更新配置](UPDATER.md)。
