# GitHub Releases 桌面更新

更新仓库固定为 [joueyl/share-music](https://github.com/joueyl/share-music)。客户端从以下地址检查最新正式版：

```text
https://github.com/joueyl/share-music/releases/latest/download/latest.json
```

**不需要手写 latest.json。** 配置签名后，Actions 自动生成各平台签名、下载地址、版本及更新说明，全部平台成功才创建 Release 草稿。必须手动验收并点击 **Publish release**；Draft 和预发布版不是此更新通道。仓库 Releases 必须允许匿名访问，不要把 GitHub Token 内置进客户端。

## 首次配置（一次性）

### 1. 在自己电脑生成并备份签名密钥

根目录安装依赖后执行（PowerShell）：

```powershell
npm run tauri -w @music-share/client -- signer generate -w "$env:USERPROFILE\.tauri\share-music.key"
```

按命令提示设置密码。备份生成的私钥 `.key`、公钥 `.key.pub` 和密码；私钥丢失将影响已安装客户端后续验签。不要提交私钥、截图发送私钥或把它作为 Release 附件。此密钥是 **Tauri 更新签名**，不等同于 Windows 代码签名或 Apple Developer ID / 公证。

### 2. 配置仓库 Actions

打开仓库 **Settings → Secrets and variables → Actions**，填写文件内容，不是本地文件路径：

| 位置 | 名称 | 值 |
| --- | --- | --- |
| Variables | `UPDATER_PUBLIC_KEY` | `.key.pub` 文件的完整内容 |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY` | `.key` 文件的完整内容 |
| Secrets | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成私钥时设置的密码；无密码时可留空 |

公开公钥和私钥必须配套。公钥会内置到安装包，私钥只进入签名构建步骤，不进入客户端、更新描述文件或附件。无需把任何私钥发给小怪。

未配置密钥时，工作流仍可生成普通安装包，但更新功能不启用，也不生成 latest.json。只配置公钥或只配置私钥会在预检阶段报错，避免误发不可更新的包。普通前端开发不需要私钥。

### 3. 构建并手动安装首个启用更新的版本

旧安装包没有更新模块或没有公钥，不能通过修改 GitHub 配置直接获得应用内更新。首次需手动安装上述配置生效后构建的安装包。默认配置文件的空公钥是有意保留的：Actions 会在打包时注入 Variable，无需手动修改源码 JSON。

## 后续发布

1. 在 CHANGELOG.md 的“未发布”中写更新说明。
2. 按 [版本发布说明](RELEASING.md) 升版、测试并提交。
3. 推送与项目版本一致的标签，例如项目已经升到 0.1.2 时：

   ```powershell
   git tag v0.1.2
   git push origin v0.1.2
   ```

4. 等待四个平台构建、签名及 SHA-256 校验通过。Actions 创建 Draft Release，并附上 `latest.json`；不需要新建分支，不需要每次更改更新地址。
5. 验收安装包，点击 **Publish release**。客户端在“版本与更新日志 → 检查更新”中才会看到更高的正式版本；不会在后台自动安装。

不要覆盖已经发布的同版本包或移动公开标签。修复应升到新版本，并继续使用原签名密钥。

## 平台行为

- Windows x64：下载带签名的 NSIS `.exe`。用户确认安装后，Windows 更新安装流程会退出程序，播放会中断。
- Linux x64：应用内更新仅对 AppImage 开启；DEB 用户手动下载新版安装。
- macOS Intel / Apple Silicon：更新下载各自的 `.app.tar.gz`，不是 DMG。安装成功后点击重启；当前 ad-hoc 签名不替代 Apple 公证，仍需实机验收。
- 网页版不下载桌面安装包，点击检查只显示刷新页面提示。

客户端只接受指定仓库的 HTTPS Release 下载链接，安装前由官方 Tauri Updater 验签。签名/下载/权限失败不会显示更新成功。安装前请先保存操作；安装中不要强制关闭程序。

## 本地签名打包与排错

本地打包可在当前终端设置同名环境变量后运行对应平台打包命令；私钥环境变量可使用 Tauri 支持的密钥文件路径，不要写进提交的脚本。Actions Secret 建议始终填写文件完整内容。

检查更新失败时，依次确认：GitHub 可访问、Release 已正式发布且不是预发布、附件中存在 latest.json、版本高于当前安装版本、公私钥配套、包包含更新公钥。单独上传安装包不够。切换仓库需要修改源码中的更新地址/来源限制并重新分发客户端。

验证命令：`npm run test:updater`、`npm run test:ci-release`、`npm test`。测试使用临时生成的测试签名，不能替代真实 GitHub Actions 构建、签名发布和各系统升级验收。
