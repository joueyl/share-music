# 版本管理与更新日志

## 单一版本源

根目录 `package.json` 的 `version` 为统一版本源。1.0.0 为本次统一发布版本；源码版本与实际 GitHub 发布状态分别核对。同步范围包括各 workspace 的 package.json、共享包引用、Tauri 配置、Cargo.toml、Cargo.lock、package-lock.json 和 pnpm-lock.yaml。

客户端侧栏“版本与更新日志”在登录前后均可打开，显示同一个版本号及随包内置的 CHANGELOG.md。内置日志不依赖网络；桌面端可手动检查 GitHub 更新，需先配置签名，见 [更新配置](UPDATER.md)。

## 日常开发

在根目录 CHANGELOG.md 的 `## [未发布]` 下维护 `### 新增`、`### 优化`、`### 修复` 等分类，每条说明以 `- ` 开头。客户端直接解析此文件，不需要再维护另一份日志。

```powershell
npm run version:check
npm run test:version
```

发现历史版本号不一致时执行 `npm run version:sync`；此命令只同步当前版本，不归档日志。不要单独使用 `npm version` 或只改 Tauri 版本号。

## 准备发布

在根目录选择一种命令（不要连续执行）：

```powershell
npm run release:version -- patch
# 或 npm run release:version -- minor
# 或 npm run release:version -- major
# 或 npm run release:version -- 0.2.0
```

支持正式版本 x.y.z，拒绝相同版本、降级或无有效条目的未发布日志。命令先校验所有输入，再同步版本文件，将未发布内容归档到新版本下，并按 Asia/Shanghai 写入操作当天日期。该日期是本地版本归档日期，不证明已上传 GitHub。之后保留空的未发布区供下一轮开发使用。命令不会提交 Git、创建标签、生成安装包或发布 GitHub Release。

```powershell
npm run version:check
npm run test:version
npm test
npm run build
```

前端生产构建与三平台打包脚本都会先检查版本一致性。实际安装包仍需按 PACKAGING.md 在对应平台构建；保持应用 identifier 不变。

## GitHub Release

可用 GitHub Actions 自动构建 Windows x64、Linux x64、macOS Intel / Apple Silicon 安装包，并在版本标签的四种目标全部构建成功后创建统一 Release 草稿。首次配置、手动运行、仓库变量、签名限制和验证边界见 [GitHub Actions 自动打包](GITHUB-ACTIONS.md)。以下手工步骤仍可作为备用流程。

1. 准备版本、审阅日志并完成测试和目标平台打包。
2. 按实际新版本创建 Git 标签，例如 `v0.1.2`；提交、标签和推送由发布者执行。
3. 导出对应版本的 Release 说明（以下为准备了 0.1.2 后的示例）：

```powershell
node scripts/version.mjs --notes 0.1.2
# 或 npm run release:notes -- 0.1.2
```

4. 将输出复制到同名 GitHub Release 的说明中，再上传测试过的安装包。自动化调用建议直接运行 node 命令，避免 npm 自身的日志混入 Markdown。

版本命令本身不会上传 GitHub；可选 GitHub Actions 工作流负责生成安装包并创建草稿，不自动公开发布。已接入 joueyl/share-music 的 Tauri Updater；首次配置公钥和签名 Secrets 后，Actions 自动生成签名和 latest.json。旧版需手动安装首个启用更新的包。不要将签名私钥写进日志、提交 Git 或作为 Release 附件。
