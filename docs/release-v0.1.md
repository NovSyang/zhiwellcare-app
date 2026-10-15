# V0.1 统一签名与 Gitee 更新

源码在 GitHub 开发，Gitee `Syang03/zhiwell-care` 仅保存发行资料和 Release 附件。初始版为 `0.1.0` / `V0.1` / Android code `1`。商城、账号、蓝牙和训练业务继续使用原有实现，正常更新保留新基线之后的用户数据。

## 配置和签名

- `release-version.json`：所有平台的版本源。`npm run version:sync` 同步 package、lock、Cargo 和原生版本，`npm run version:check` 检查漂移。
- `release-config.json`：正式仓库、两个通道及批准的下载主机。未实测的 CDN 域名不登记。
- `release-signing.json`：原 PKCS12 的公共证书指纹和 Tauri 公钥。本机已核对 Android MD5、SHA-1 和 SHA-256；文件中不含私钥或密码。
- `release.local.json`：从示例复制，只保存本机路径，已被 Git 忽略。不能存密码，也不能进入发行仓库。

运行 `npm run release:config:sync` 后，脚本生成 `UpdateEndpoints.ts`、`android/update-config.json`，并同步 Tauri endpoint 和公钥。`npm run release:config:check` 不写文件，发现错仓库、旧入口、占位身份或漂移会失败。Windows 实际读取 Tauri 配置中的入口。

截至 2026-10-15，`allowedDownloadHosts` 已按实际 HTTPS 跳转登记 `gitee.com`、`raw.giteeusercontent.com`、`foruda.gitee.com`。本仓库健康探针的 Gitee Raw 入口返回 302，跳转至 `raw.giteeusercontent.com` 后取得 200 JSON；`release-output/private/gitee-health-validation.json` 记录匿名 GET 通过且未携带认证头。对官方 `mcp-gitee` Release 附件的实测观察到下载路由经 `gitee.com/attach_files/...` 到 `foruda.gitee.com` 返回附件。这些先行实测用于批准跳转主机；本项目六份 staging APK、EXE、EXE.sig 随后均完成完整下载和验签，具体证据见下方“当前验证记录与发布门禁”。

两通道的永久清单入口继续使用 `gitee.com/Syang03/zhiwell-care/raw/main/channels/...`，安装包永久路由继续限定指定仓库的 `releases/download/<tag>/<filename>`。CDN 白名单仅供逐跳检查，清单不保存一次性 CDN 地址；HTTPS、无凭据、指定仓库、两段附件路径和未批准主机的拒绝规则保持有效。

Android Release 构建在 Gradle 中再次检查别名、私钥可用性及证书 DER 指纹；最终 APK 用 SDK 的 aapt/apksigner 检查真实包名、版本、debuggable 和签名。Windows 用最终 EXE 的 VersionInfo 检查版本，用锁定的 Minisign 验证工具检查 `.sig`。变更二进制内容后必须重新签名。

执行前，通过已有安全输入或密码管理工具将签名密码注入当前进程环境。`release.ps1` 使用受控环境中的密码；本机路径取自 `release.local.json`。密码不得写入命令行、`VITE_*`、源码、报告或聊天。Vite 只公开 `VITE_` 和 `TAURI_ENV_` 字段。

所有发布步骤统一通过 `Invoke-Checked` 调用 `scripts/release/without-signing-env.ps1`。公共配置检查、网络检查、`npm ci`、测试、前端构建、缓存清理、清单生成和远端验收会清除全部 `REHAB_ANDROID_*` 与 `TAURI_SIGNING_PRIVATE_KEY*` 环境变量。只有私钥核验或签包步骤显式保留该工具所需的变量：Android 密钥核验保留 store password，Gradle 签包保留 Android 路径、别名及两个密码，Tauri 私钥核验/签包保留其密码及必要的私钥入口。每次子进程调用都在 `finally` 恢复原值；发布脚本结束时再恢复本次设置的平台和签名变量。

`check-inputs.mjs` 的 `runTool` 对原生工具再次应用相同的变量白名单。工具失败只报告工具名和退出码，不回传原异常的 `stdout`、`stderr`、完整命令或 `cause`。PowerShell 脚本采用 UTF-8 BOM，兼容 Windows PowerShell 5。

## 本机命令

以下命令从源码仓库根目录执行。

```powershell
# 在已有签名环境的终端中，公共操作也使用隔离入口。
. ./scripts/release/without-signing-env.ps1
Invoke-WithoutSigningEnvironment -Command npm.cmd -Arguments @('run', 'version:check')
Invoke-WithoutSigningEnvironment -Command npm.cmd -Arguments @('run', 'release:config:check')
Invoke-WithoutSigningEnvironment -Command npm.cmd -Arguments @('test')
Invoke-WithoutSigningEnvironment -Command npm.cmd -Arguments @('run', 'build')
# Doctor 会按每项检查的用途管理子进程环境。
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1 -Action Doctor
```

`scripts/release.ps1` 提供 `Doctor`、`Prepare`、`Manifests`、`VerifyRemote`、`StagePublic`。使用 `Get-Help ./scripts/release.ps1 -Full` 或读取脚本的参数块查看参数。Prepare 受控构建、验签和归档，不上传远端。首次 stable 使用 `-FirstRelease`；脚本检查两端通道清单都返回 404 且初始版本为 `0.1.0/code 1`。后续发布由 `check-published-version.mjs` 匿名读取本通道两端清单，并检查产品版本与 Android code 严格递增。403、HTML、超时及其它读取失败都会阻断，不能自动转换成首次发布。

Android Wrapper 固定为官方 `https://services.gradle.org/distributions/gradle-8.14.3-bin.zip`，`distributionSha256Sum` 为 `bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531`。这个值已与原本机 ZIP 核对；干净检出不依赖未提交的 ZIP。Doctor 实际运行 `gradlew.bat --version` 检查 Wrapper 引导，而不只判断 bat 文件存在。下载、摘要校验或启动失败时，Doctor 不能判定通过。

Prepare 的两端前端构建彼此独立：先清除 `TAURI_ENV_DEBUG`，设置 `TAURI_ENV_PLATFORM=android`，在无签名环境运行 `android:sync`，将 ES2022 目标网页同步进 Android；随后单独执行 Gradle Release 签包。Windows 再设置 `TAURI_ENV_PLATFORM=windows`，在无签名环境运行 `npm run build`，生成 `chrome105` 目标网页。最后通过 `private/tauri-build-overrides.json` 暂时将 `beforeBuildCommand` 设为 `null`，执行 Windows x64 NSIS 签包，避免前端 hook 重复执行并继承私钥环境。正式 Tauri 配置文件中的 hook 保持原值。

stable 归档路径为 `release-output/stable/<version>/`；staging 为 `release-output/staging/<version>-<RunId>/`，需要独立工作树和显式 `-RunId`。`artifacts/` 包含 APK、EXE 和 EXE.sig，`public/` 是五份公开候选资料，`private/` 保存本机验证、审计和临时构建配置。整个 `release-output/` 已被 Git 忽略。Prepare 会清理三个明确的构建输出、检查本次文件时间及真实签名后再归档，已存在的归档安装包不会被静默覆盖。

## 清单生成

两个生成器拒绝未知参数和缺值，必须使用最终签名产物及真实、无凭据的 HTTPS 附件 URL：

```text
node scripts/generate-android-update-manifest.mjs
  --apk <最终APK> --apk-url <实际永久URL>
  --version-file release-version.json --notes <说明文件>
  --channel <stable或staging>
  --published-at <RFC3339时间> --output <android-latest.json>

node scripts/generate-tauri-update-manifest.mjs
  --artifact <最终EXE> --signature <对应SIG> --artifact-url <实际永久URL>
  --version-file release-version.json --notes <同一说明文件>
  --channel <与Android相同通道>
  --published-at <同一时间> --output <latest.json>
```

Windows 清单的 signature 是签名文件内容，不是路径。两个生成器不单独覆盖 `SHA256SUMS.txt`；聚合阶段生成包括 APK、EXE、EXE.sig 的摘要列表及公共 release-info。没有真实产物时不生成假清单。

`Manifests` 使用归档目录中的最终 APK/EXE/.sig，并在两端都通过真实产物校验后生成资料。附件 URL 要与版本、通道、标签和文件名一致；必须确认服务器确实提供这些字节。清单内的 `publishedAt` 是本批候选资料的时间，单独生成本地 JSON 不代表附件已经上传或对外发布。

## 更新流程

Android 通过原生工作线程请求本构建指定清单，绕过 WebView 跨域限制。请求逐跳检查 HTTPS、凭据、批准主机，最多五次重定向；清单上限 1 MiB、总时限 30 秒，APK 按清单大小限制读取并设总时限。定时断开连接覆盖阻塞请求，更新线程的 Cookie 隔离不影响业务线程的登录态。HTML、403、404、429 等不会被当作“最新版本”。APK 写入 `.part`，检查空间、大小、摘要、包名、code 和证书，通过后才成为待安装文件；安装前复核。取消与清理通过工作队列收尾，避免并发删除正在写入的文件。

PackageInstaller 的流在 commit 前关闭。未提交异常 abandon，会话失败和取消释放回调及 keepAlive，取消使用明确错误代码。安装会话设十分钟收尾保护；没有收到最终广播时先核对原生版本，再确认成功或结束失败任务。训练、校准或后台状态阻止安装；权限检查返回后再次检查锁。只有真正等待来源授权且仍有有效安装意图的任务在回前台恢复，下载失败和用户取消不会反复拉起安装器。

更新模式“自动检查并下载”仍需遵循系统安装确认。Windows 保留官方 Tauri check/download/install 验签链，并通过真实窗口可见、最小化和聚焦状态判断前台。失焦立即阻止安装，恢复时重新核对原生状态；监听注册失败或状态未知时按后台处理。旧查询结果不能覆盖后到的失焦事件，销毁后迟到的监听句柄也会清理。

## staging 和正式发布

staging 必须在独立源码工作树执行 `node scripts/sync-release-config.mjs --write --channel staging`，并在该树的 `release-version.json` 切换测试版本。检查命令也传 `--channel staging`。两端使用相同正式签名，界面标记“内部验证版”。不要将 staging 配置同步回默认 stable 工作区。

staging Release 使用 `test-v<version>-<RunId>` 标签，附件文件名带 `staging`。公开快照分别保存为 `versions/<version>/`（stable）和 `versions/staging/<test-tag>/`（staging），例如 `versions/staging/test-v0.1.0-validation/`。staging 快照标签取自本批 Windows 清单附件 URL，并受版本/通道与路径白名单校验；同一标签内容不可变。这样 staging 的 `0.1.0` 基线不会占用正式 `versions/0.1.0/`。两端活动清单仍分别写入 `channels/stable/` 或 `channels/staging/`。

正式发布前，在 staging 用统一签名 `0.1.0/code 1` 到 `0.1.1/code 2` 做真实升级，验证新建训练记录和设置仍存在。测试设备已升到 code 2 时，返回 stable code 1 需由用户确认卸载测试包，脚本不自动卸载或清用户数据。

公开仓库第一次只放 README、`.gitignore` 和 `health/update-probe.json`。APK/EXE/.sig 上传 Release 附件，不能放入 Git 历史。上传后先用 `VerifyRemote` 的默认模式检查“本地清单＋远端附件”，完整下载 APK、EXE 和 EXE.sig，比较本地最终字节并再次核验原生版本/签名。每次开始验收会撤销旧成功报告，失败保存 `verified:false`；所有检查成功后才写 `verified:true`。StagePublic 仅接受与本批版本、通道、三份附件摘要一致的成功报告。

StagePublic 只复制五份白名单资料，检查目标真实路径，拒绝源码、Keys、危险祖先/子目录、符号链接、私钥（包含 Base64 编码的 Minisign 私钥标记）、环境文件、本机报告、错通道及变更过的不可变快照。它只做暂存和差异展示；正式 commit、push、标签、Release 及附件上传由审核过的发布动作完成。通道清单发布后，再运行 `VerifyRemote -RemoteManifests`，核对实际远端 JSON 与本地预期内容，以及完整附件。

## 当前验证记录与发布门禁

stable `0.1.0/code 1` 与 staging `0.1.0/code 1`、`0.1.1/code 2` 三套候选在新增 CDN 配置后，分别通过全部 75 个 Vitest 文件、401 项测试，以及各自 `android:sync` 中的严格类型检查和前端构建。三套 APK 已分别重新执行 Release 签包，实际 DEX 检查确认均包含三个批准主机及对应通道。Windows EXE 和 `.sig` 未因 Android 白名单变更重编，字节摘要与此前已验签候选一致。进度依据为 `release-output/private/cdn-rebuild-progress.json`，本批产物摘要及真实验签依据为 `release-output/private/final-candidate-validation.json`。

最新三套候选的错误公钥、单字节 EXE 篡改、APK 版本/code/证书指纹不匹配均实测拒绝；公开资料白名单和本地版本递增通过。`private/previous-cdn-*` 等旧归档仅用于追溯。`final-candidate-validation.json` 保留本地候选验收时远端发布和设备升级为 `not-executed` 的历史状态；当前收尾状态以 `release-output/private/implementation-report.md`、`implementation-receipt.json` 及下述四份真实远端报告为准。

稳定基线和 staging 基线曾完整执行 Prepare，包括真实首次发布预检与锁定依赖安装；最后的 Windows 生命周期修改后，使用同一锁定依赖重新执行全量测试及两端受控构建。staging `0.1.1/code 2` 已匿名读取远端已发布的 `0.1.0/code 1`，正常线上版本递增预检通过，`firstRelease:false`，没有使用首次发布模式绕过后续版本检查。

官方 Gradle 8.14.3 Wrapper 已实际启动通过，使用与官方 SHA-256 一致的现有 ZIP 缓存验证。Android 原生 JVM 已有 HTTP 12 项、Cookie 隔离 3 项、安装会话 4 项，共 19 项通过记录。本轮只调整公开 CDN 配置，原生 Java 源码未变，未重复执行这 19 项；本次新增的配置与跳转回归已包含在三套候选各自的 401 项 Vitest 中。

`release-output/private/environment-validation.json` 中 refs 为空、健康探针 404 是初始化前的历史记录。用户授权的 staging 公开发布已执行：Gitee 的 `test-v0.1.0-20261014-local-verification`、`test-v0.1.1-20261014-local-verification` 两个 Release 共六份 APK、EXE、EXE.sig 均已真实上传。`0.1.0` 清单与不可变快照由提交 `9dc38015c69ce0ccb777fa21263e2c5057f507eb` 发布；随后 `0.1.1` 快照及 staging 指针由提交 `26648b379c7fc548933edb3e752cebf43482041a` 推送至 `main`，当前两端 staging 清单均指向 `0.1.1`。

两套归档 `release-output/staging/0.1.0-20261014-local-verification/`、`release-output/staging/0.1.1-20261014-local-verification/` 各自的 `private/remote-validation-report.json`（`local-manifests`）和 `private/remote-manifests-validation-report.json`（`remote-manifests`）共四份报告均为 `verified:true`。每轮均完整匿名 GET 三份附件并核对最终字节、大小、SHA-256、APK 真实版本和正式证书、Windows EXE 版本及 Tauri 签名；远端清单模式还真实读取两份 Raw JSON，与该版本归档一致。`0.1.0` 与 `0.1.1` 的远端清单验收分别于 UTC `2026-10-14T17:33:42.737Z`、`2026-10-14T17:36:30.659Z` 通过。健康探针和官方 CDN 跳转的先行检查已有本项目六份实际附件的完整验收补足。

Windows staging `0.1.0 → 0.1.1` 的实际应用内升级主链已通过。用户在 `0.1.0` 新建训练记录、保存“手动检查”，在界面检查到正确版本及 staging 说明后完成更新，并确认新版训练记录仍在、更新方式仍为“手动检查”，再次检查提示已是最新版本。这些界面与数据保留结论来自用户实际操作反馈。

独立的本机只读文件与进程核对提供佐证：已安装应用 EXE 的 ProductVersion 为 `0.1.1`，SHA-256 为 `c62f64dc7f5c0fd0b7ac4d290c334c7d2d64f4d4cfb1e05b5e29e732cc4b7d02`，新版进程于 `2026-10-15 11:19:14 +08:00` 启动。详细安装路径、进程信息和用户确认项保存在本机 `release-output/private/device-upgrade-validation.json`。

Windows 的取消、低空间、后台或训练期间禁止安装等失败与限制场景，以及 BLE/训练业务回归仍未完成实机验收。最新只读 ADB 检查仍为零台设备，Android 等待连接目标设备后执行来源授权、取消、低空间、重启、BLE/训练回归及双版本升级。stable 正式通道尚未发布。staging 与 stable 使用相同产品名和应用标识，共用安装及用户数据目录，测试结束后的卸载、降级或数据清理应按已确认的具体范围处理。

依赖审计原始记录保存在 release-output/private/dependency-audit.json 和 dependency-audit-production.json；八个受影响依赖包及生产分类的 source-map-js 高危项尚未修补。本轮未更改原依赖版本，签名环境隔离只降低构建和测试接触秘密的风险。具体剩余风险应结合实际打包内容评估。

正式首发必须取得 Gitee 匿名原始 JSON 和完整附件的成功验收，并完成两端 staging 真实升级、来源授权/取消/低空间等失败场景、训练期间安装限制和新基线数据保留验证。缺少目标设备或任一验收尚未完成时，报告保留“未执行及原因”，stable 更新入口继续保持未发布状态。

## 平台依据

安装流关闭要求参照 [Android PackageInstaller.Session](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session)。Windows 的签名编码和安装行为按当前锁定的插件及 [Tauri updater 官方文档](https://v2.tauri.app/plugin/updater/)核对，验证库独立锁定为 minisign-verify 0.2.5，不升级原项目依赖。
