# GitHub Actions 自动打包

桌面与 Android APK 现共用一个版本工作流。main 只运行检查；匹配的版本标签统一构建四个桌面目标和 Android ARM64 Debug APK，全部成功后汇总到同一 Release 草稿。Android 仍是 Debug 试用包，不代表正式签名或实机验收，见 [Android APK 配置与前置条件](ANDROID-APK.md)。

工作流：`.github/workflows/desktop-release.yml`，名称为 **Client installers**。现覆盖 Windows x64、Linux x64 和 macOS Intel / Apple Silicon 四个桌面目标及 Android ARM64，并支持配置签名后的应用内更新。

## 首次配置

1. 将源码及工作流文件提交并推送到你自己的 GitHub 仓库，确保默认分支包含此工作流，仓库已启用 Actions。
2. 在 **Settings → Secrets and variables → Actions → Variables** 中，可选设置 `VITE_SERVER_URL` 为实际生产服务地址，例如 `https://music.example.com`。这是内置到客户端的公开地址，不能含账号密码、路径或查询参数。未设置时使用工程 `apps/client/.env.production` 的现有公开地址。
3. 普通打包无需个人访问令牌或私钥；启用应用内更新需按 [更新配置](UPDATER.md) 设置公钥 Variable 和签名 Secrets。构建任务仅有 `contents: read`；标签构建成功后的独立草稿任务使用 GitHub 自动提供的 `GITHUB_TOKEN` 和 `contents: write`。组织/仓库策略可能需要允许工作流创建 Release。
4. 现有安装包未进行 Windows 代码签名；首次下载/安装可能触发系统安全提示。SHA-256 校验文件不是发布者身份签名，也不替代 Tauri 更新签名。

## 手动打包（建议先执行）

在 **Actions → Client installers → Run workflow** 选择分支并运行，一次触发四个桌面目标及 Android ARM64 共五个目标。流水线将：

- 使用 Node.js 24，校验版本、更新日志和生产服务地址，执行 `npm ci` 与 JavaScript 测试；网易云 hana 编程式 SDK 的离线兼容测试也在此环境执行。
- 安装固定 Rust 1.90.0，使用对应平台的系统 WebView / HTML Audio。
- 缓存 Cargo 下载与 Rust 依赖，构建 Tauri 桌面壳及客户端。
- 调用对应平台的 `package:win` / `package:linux` / `package:mac` 及检查命令。Linux 安装 WebKitGTK 4.1、GTK3、PipeWire、D-Bus 等依赖；macOS 分别使用 Intel / Apple Silicon runner，并设置最低系统版本 13.0。
- 每个目标独立上传名为 `music-share-目标-版本号` 的 Actions Artifact，保留 30 天；包含对应安装包、`SHA256SUMS-目标.txt`、`RELEASE-NOTES.md`。文件名统一包含版本、平台及架构，避免冲突。

手动运行会执行检查并构建全部五个目标，仅上传 Actions Artifact，不创建或公开 Release。main 相关推送（客户端、共享包、服务端、scripts、根依赖或工作流）只运行 verify：类型、测试、双端前端构建与发布门禁；不会生成安装包，因此不再与随后 tag 重复打包。匹配版本标签推送时，verify 通过后才并行打包，任一目标失败或被取消都阻止 Release 草稿。标签推送不受路径过滤影响，纯文档修改不触发 main 检查。

## 版本标签与 Release 草稿

先按 RELEASING.md 准备新版本、审阅更新日志并提交代码，再推送匹配的标签。以下是准备 `0.1.2` 的示例；若当前版本已不同，请使用实际下一版本：

```powershell
npm run release:version -- 0.1.2
# 审阅、测试并提交版本文件和工作流后：
git tag v0.1.2
git push origin v0.1.2
```

标签必须与项目版本完全一致。四个桌面目标和 Android 全部成功后，汇总任务严格核对五份 Artifact 的版本、完整文件集、统一说明及真实 SHA-256；还检查 APK 独立入口标记和不可省略的 Debug 警告。缺少 Android、混入旧包、签名/校验失败或说明不一致，都不会创建草稿。通过后创建同名 **Draft Release**，包含六个安装包（Windows 一个、Linux 两个、macOS 两个及 Android 一个）、ANDROID-DEBUG-NOTICE.txt、SHA256SUMS.txt 和 RELEASE-NOTES.md，共九个附件；启用桌面签名更新时加上两份 macOS 更新压缩包、四份签名和 latest.json，共十六个附件。

Android APK 不是桌面 Tauri Updater 目标，latest.json 仍只含四个桌面平台；APK 不伪造更新签名或生产签名。发布者验收后再点击 **Publish release** 公开整个版本。恢复发布也必须来自同一标签提交的完整五目标构建，并重新校验，不允许跳过 Android。

已有同名 Release 时创建步骤会失败，不覆盖已发布内容。失败重跑前先检查是否已有草稿或部分上传的附件；不要删除正式发布版本或强制移动已公开标签。若构建成功但草稿任务因权限失败，Actions Artifact 仍可下载。

## 平台与签名

| 平台 | Runner | 架构 | 产物 |
| --- | --- | --- | --- |
| Windows | windows-2022 | x64 | NSIS .exe |
| Linux | ubuntu-22.04 | x64 | .deb、.AppImage |
| macOS Intel | macos-15-intel | x64 | .dmg |
| macOS Apple Silicon | macos-15 | arm64 | .dmg |
| Android 试用 | ubuntu-22.04 | ARM64 | -android-arm64-debug.apk |

对应系统原生编译，不交叉编译；macOS 两种架构分别发布，不是 Universal Binary。Linux ARM64 尚未配置。Runner 标签参考 [GitHub 官方镜像列表](https://github.com/actions/runner-images#available-images)，今后可能随镜像生命周期调整。

macOS 当前使用 ad-hoc 签名（APPLE_SIGNING_IDENTITY=-），未配置 Developer ID 与 Apple 公证，不能视为已满足正式公开分发签名要求。正式分发前应单独配置证书与公证并实机验收，不要用关闭系统安全机制替代签名。

## Cargo 与 Rust 编译缓存

Windows、Linux 和两种 macOS 架构均使用固定提交版本的 `Swatinem/rust-cache`，在选择 Rust 1.90.0 后恢复缓存：

- 缓存 Cargo registry 下载、Git 依赖及 `apps/client/src-tauri/target` 中的第三方依赖编译产物。
- 不缓存 Cargo 安装的工具或本项目最终安装包，不因缓存命中跳过构建、测试和签名检查。
- 缓存键包含系统、架构、原生依赖配置；Action 自动纳入 Rust 编译器、Cargo.lock/Cargo.toml 与相关构建环境，避免不兼容产物混用。自定义 key 不再额外拼接原始 Cargo.lock 哈希；沿用固定版本 rust-cache 对本项目版本的归一化及真实依赖哈希，使仅应用升版不再改变恢复前缀，依赖变化仍由 Action 识别。
- `cache-on-failure` 允许普通任务失败后保存已生成的缓存，但缓存服务异常、任务取消或 runner 中断时不保证保存。
- main 只检查，不自动预热原生编译缓存。需要默认分支缓存时可在 main 手动运行完整工作流；否则标签构建可能冷启动。GitHub 不允许不同标签直接读取彼此缓存，不能承诺固定加速比例；不再要求每次发布先构建 main 安装包。
- Android 沿用独立的 Android Rust 缓存命名空间与 NDK 键，不能与桌面目标的编译缓存混用。

npm 依赖与 Cargo/Rust 编译产物分别缓存。缓存失效、依赖或工具链变化时仍可能重新编译，不保证固定加速比例。

## 验证边界

本地可运行 `npm run test:ci-release` 和 `npm run test:version`。这些测试覆盖标签与版本匹配、公开地址校验、日志提取、五目标产物筛选、汇总和真实 SHA-256 计算，隔离测试不代表已在 GitHub runner 上执行新合并工作流或完成实机安装验收。

此工作流已接入 Tauri Updater：配置匹配的公钥和签名 Secrets 后生成 `.sig`、`latest.json`，并在收集及汇总时验证签名。不自动公开 Release，也不部署 NestJS 服务。首次配置和完整流程见 [GitHub 更新配置](UPDATER.md)。
