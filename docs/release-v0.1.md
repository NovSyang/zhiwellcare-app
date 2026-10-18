# V0.1 统一签名与 Gitee 更新

源码在 GitHub 开发，Gitee `Syang03/zhiwell-care` 仅保存发行资料和 Release 附件。初始版为 `0.1.0` / `V0.1` / Android code `1`。商城、账号、蓝牙和训练业务继续使用原有实现，正常更新保留新基线之后的用户数据。

## 配置和签名

- `release-version.json`：所有平台的版本源。`npm run version:sync` 同步 package、lock、Cargo 和原生版本，`npm run version:check` 检查漂移。
- `release-config.json`：正式仓库、两个通道及批准的下载主机。未实测的 CDN 域名不登记。
- `release-signing.json`：原 PKCS12 的公共证书指纹和 Tauri 公钥。本机已核对 Android MD5、SHA-1 和 SHA-256；文件中不含私钥或密码。
- `release.local.json`：从示例复制，只保存本机路径，已被 Git 忽略。不能存密码，也不能进入发行仓库。

运行 `npm run release:config:sync` 后，脚本生成 `UpdateEndpoints.ts`、`android/update-config.json`，并同步 Tauri endpoint 和公钥。`npm run release:config:check` 不写文件，发现错仓库、旧入口、占位身份或漂移会失败。Windows 实际读取 Tauri 配置中的入口。

截至 2026-10-15，`allowedDownloadHosts` 已按实际 HTTPS 跳转登记 `gitee.com`、`raw.giteeusercontent.com`、`foruda.gitee.com`。本仓库健康探针的 Gitee Raw 入口返回 302，跳转至 `raw.giteeusercontent.com` 后取得 200 JSON；`release-output/private/gitee-health-validation.json` 记录匿名 GET 通过且未携带认证头。对官方 `mcp-gitee` Release 附件的实测观察到下载路由经 `gitee.com/attach_files/...` 到 `foruda.gitee.com` 返回附件。这些先行实测用于批准跳转主机；本项目最初两轮的六份 staging APK、EXE、EXE.sig 随后均完成完整下载和验签。第四轮及暂停状态见下方“截至 2026-10-18 的交付与暂停状态”，既往各轮结果见“历史验证记录与发布门禁”。

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

## 截至 2026-10-18 的交付与暂停状态

用户要求实机进度截至 APK 下载中断测试，暂停“恢复网络后重新下载”及后续手机操作，并先提交代码和说明。以下是本次交付快照；后面的分轮记录保留各阶段当时的结果，不能据此判断当前指针或全部验收已通过。

最新业务源码及 `0.1.3` 候选对应提交 `1229e5a69f1aeb0aa92354b372a524fedb8c82c8`。本次说明更新不改变候选二进制。默认源码仍是 stable `0.1.0/code 1`，staging `0.1.3/code 4` 在独立工作树构建，没有将测试通道或测试版本同步回默认源码。

| 项目 | 截止暂停时的真实结果 |
|---|---|
| 标准构建与资料生成 | `0.1.3/code 4` 的 Prepare、Manifests、Android Release 及 Windows NSIS 签包通过 |
| 自动化测试 | 本轮 75 个 Vitest 文件、401 项测试全部通过；Java HTTP、Cookie 隔离和安装会话共 19 项重新执行通过 |
| 独立候选检查 | 十一项真实产物、元数据与正反向验签检查通过；本地已验 `0.1.2/code 3 → 0.1.3/code 4` 递增 |
| 公开下载 | `0.1.3` 三附件完整匿名下载、摘要与真实版本/签名核验通过；两份远端 Raw JSON 与本批清单一致 |
| Windows 实机主链 | 既往 `0.1.0 → 0.1.1` 应用内升级、训练记录及“手动检查”保留、再次检查最新通过；未做 `0.1.3` 实机升级 |
| Android 实机主链 | 既往 `0.1.0 → 0.1.1 → 0.1.2` 升级、旧训练记录及“手动检查”保留、再次检查最新通过 |
| Android 拒绝授权与取消 | `0.1.1 → 0.1.2` 来源拒绝后不循环打开设置、系统取消后不重弹、缓存手动重试通过 |
| 离线清单检查及恢复 | `0.1.2` 断网检查明确失败；恢复网络后再次检查显示已是最新版本，通过；不等同于 APK 下载失败后重试 |
| APK 下载中断 | 用户在 `0.1.2 → 0.1.3` 下载约 11% 时关闭 Wi-Fi，明确提示“更新文件读取失败，请检查网络或可用空间”，没有自动打开安装器，通过 |
| APK 下载失败后恢复 | 未执行，按用户要求暂停；没有将此前“离线检查恢复”计作此项通过 |
| 新网络提示 | 已改为“当前网络状况不佳，请检查网络后重试”；最终 APK DEX 精确新文案 1 处、旧完整 HTTPS 文案 0 处；新版手机界面仍未验证 |
| 本轮目标已安装版本 | 未完成 `0.1.3` 实机升级或已安装 APK 核验；手机最后独立核验为 `0.1.2/code 3` |
| stable | 尚未发布；全部必需实机门禁仍未满足 |

`0.1.3` 已按用户明确授权发布为 [Gitee 预览 Release](https://gitee.com/Syang03/zhiwell-care/releases/tag/test-v0.1.3-20261016-remaining-device-qa)。发行仓库提交 `98f7193d9b1d2afd7e1edf7ea788d94e5a3e33b9` 已将两端 staging 指针推进至 `0.1.3`；Release 标签指向发行资料提交 `07f06d3e91c98f9227971fd99e950b51339fc964`，与上述业务源码提交用途不同。四轮 staging 共上传十二份附件，八份独立远端验收报告均通过；历史报告只证明对应轮次当时的内容。

本批最终公开附件如下，可用于后续恢复验收时核对，不能替代设备升级证据：

| 附件 | 字节数 | SHA-256 |
|---|---:|---|
| `ZhiWellCare-0.1.3-staging-android.apk` | 5712257 | `34adb2e7080d5a43533b2f85321dbbc0bc6451d0d70a35da2301d5bac0b71c78` |
| `ZhiWellCare-0.1.3-staging-windows-x64-setup.exe` | 3698860 | `43981e8cea784cc8afe4d346dc90ff383eb78207da99a26259ab9e5fbc2a12c7` |
| `ZhiWellCare-0.1.3-staging-windows-x64-setup.exe.sig` | 424 | `8a57306150be93029980aa126d9b9ffea17d0375dec45c6de555f453377d4ad9` |

为覆盖新的网络提示，最初基于 `e24adc3` 的未公开 `0.1.3` 候选已封存，未上传；上述当前候选基于 `1229e5a` 重新完整构建和验收。旧候选及调试失败尝试仅用于本机追溯，不计入最终成功结果。

尚未完成的实机项目包括 APK 下载失败后恢复、后台/训练/标定期间禁止启动安装、独立进程重启、BLE 与训练业务回归、本轮 `0.1.3` 升级及数据保留、新网络提示的设备界面验证；Windows 的取消、低空间及安装限制分支亦待补测。Android 低空间仍因没有合适设备而未执行：现有手机曾测得约 79.6 GiB 空闲，目标 APK 的实际空间门槛为 28,201,730 bytes。没有填满用户存储、修改门槛或把系统低空间广播算作实机通过。暂停或缺少环境均不构成门禁豁免。

下载中断测试使用的临时入站限速设置已写回原值 `-1` 并独立读回确认；这仅证明设置恢复，不作为精确吞吐率或内核规则效果的证据。用户最后反馈尚未恢复网络或来源许可，后续 USB 检查未发现设备，未取得新的原生版本信息。暂停后不再要求手机操作；恢复时先重新确认连接、版本与权限，再从下载失败后的重试继续，保留现有安装和训练数据。

本机原始证据在被 Git 忽略的 `release-output/private/remaining-device-acceptance.json`、`remaining-device-report.md`、`remaining-device-receipt.json`、`remaining-candidate-validation.json`、`remaining-staging-publication.json`；本批两份远端报告在 `release-output/staging/0.1.3-20261016-remaining-device-qa/private/`。这些本机文件、安装包、私钥、密码及本机路径配置不随源码提交。本节公开的是必要结果、摘要和剩余门禁。

stable 继续保持未发布。已有本地 stable 归档早于最新网络提示改动，后续即使实机全部通过，也必须先基于最新源码重新构建、验签并完成正式发布前检查，不能直接上传旧归档。

## 历史验证记录与发布门禁

以下记录截至第三轮 `0.1.2` 验收完成；其中“本轮”和候选状态均属于对应历史阶段，当前交付状态以上方暂停快照为准。

stable `0.1.0/code 1` 与 staging `0.1.0/code 1`、`0.1.1/code 2` 三套候选在新增 CDN 配置后，分别通过全部 75 个 Vitest 文件、401 项测试，以及各自 `android:sync` 中的严格类型检查和前端构建。三套 APK 已分别重新执行 Release 签包，实际 DEX 检查确认均包含三个批准主机及对应通道。Windows EXE 和 `.sig` 未因 Android 白名单变更重编，字节摘要与此前已验签候选一致。进度依据为 `release-output/private/cdn-rebuild-progress.json`，本批产物摘要及真实验签依据为 `release-output/private/final-candidate-validation.json`。

最初三套候选的错误公钥、单字节 EXE 篡改、APK 版本/code/证书指纹不匹配均实测拒绝；公开资料白名单和本地版本递增通过。`private/previous-cdn-*` 等旧归档仅用于追溯。`final-candidate-validation.json` 保留本地候选验收时远端发布和设备升级为 `not-executed` 的历史状态；新增 `0.1.2` 的本地验收独立保存在 `next-candidate-validation.json`。第三轮收尾状态记录于 `release-output/private/implementation-report.md`、`implementation-receipt.json` 及当时三轮共六份真实远端报告，最初两轮的四份报告是各自当时的实际验收记录；第四轮采用上方单独的 remaining 证据。

稳定基线和 staging 基线曾完整执行 Prepare，包括真实首次发布预检与锁定依赖安装；最后的 Windows 生命周期修改后，使用同一锁定依赖重新执行全量测试及两端受控构建。staging `0.1.1/code 2` 已匿名读取远端已发布的 `0.1.0/code 1`，正常线上版本递增预检通过，`firstRelease:false`，没有使用首次发布模式绕过后续版本检查。

官方 Gradle 8.14.3 Wrapper 已实际启动通过，使用与官方 SHA-256 一致的现有 ZIP 缓存验证。Android 原生 JVM 已有 HTTP 12 项、Cookie 隔离 3 项、安装会话 4 项，共 19 项通过记录。本轮只调整公开 CDN 配置，原生 Java 源码未变，未重复执行这 19 项；本次新增的配置与跳转回归已包含在三套候选各自的 401 项 Vitest 中。

`release-output/private/environment-validation.json` 中 refs 为空、健康探针 404 是初始化前的历史记录。用户授权的最初两轮 staging 公开发布已执行：Gitee 的 `test-v0.1.0-20261014-local-verification`、`test-v0.1.1-20261014-local-verification` 两个 Release 共六份 APK、EXE、EXE.sig 均已真实上传。`0.1.0` 清单与不可变快照由提交 `9dc38015c69ce0ccb777fa21263e2c5057f507eb` 发布；随后 `0.1.1` 快照及 staging 指针由提交 `26648b379c7fc548933edb3e752cebf43482041a` 推送至 `main`，两端指针当时均为 `0.1.1`。后续第三轮已推进至 `0.1.2`，详见下文当前发布记录。

最初两套归档 `release-output/staging/0.1.0-20261014-local-verification/`、`release-output/staging/0.1.1-20261014-local-verification/` 各自的 `private/remote-validation-report.json`（`local-manifests`）和 `private/remote-manifests-validation-report.json`（`remote-manifests`）共四份历史报告均为 `verified:true`。每轮均完整匿名 GET 三份附件并核对最终字节、大小、SHA-256、APK 真实版本和正式证书、Windows EXE 版本及 Tauri 签名；远端清单模式还真实读取两份 Raw JSON，与该版本归档一致。`0.1.0` 与 `0.1.1` 的远端清单验收分别于 UTC `2026-10-14T17:33:42.737Z`、`2026-10-14T17:36:30.659Z` 通过。这两轮结果不表示当前指针仍为旧版；新增 `0.1.2` 的两份成功报告见后文，三轮合计六份报告、九份附件。健康探针和官方 CDN 跳转的先行检查已由本项目实际附件的完整验收补足。

Windows staging `0.1.0 → 0.1.1` 的实际应用内升级主链已通过。用户在 `0.1.0` 新建训练记录、保存“手动检查”，在界面检查到正确版本及 staging 说明后完成更新，并确认新版训练记录仍在、更新方式仍为“手动检查”，再次检查提示已是最新版本。这些界面与数据保留结论来自用户实际操作反馈。

独立的本机只读文件与进程核对提供佐证：已安装应用 EXE 的 ProductVersion 为 `0.1.1`，SHA-256 为 `c62f64dc7f5c0fd0b7ac4d290c334c7d2d64f4d4cfb1e05b5e29e732cc4b7d02`，新版进程于 `2026-10-15 11:19:14 +08:00` 启动。详细安装路径、进程信息和用户确认项保存在本机 `release-output/private/device-upgrade-validation.json`。

Windows 的取消、低空间、后台或训练期间禁止安装等失败与限制场景，以及 BLE/训练业务回归仍未完成实机验收。

Android 15 / API 35 的 V2452A 已完成首次连接预检：当前用户 `user 0` 当时尚未安装 `com.zhiwellcare.app`，可用空间约 `82.69 GiB`。两次 USB 安装均被手机即时拒绝，返回 `INSTALL_FAILED_ABORTED: User rejected permissions`，包括用户解锁并同意重试后的第二次尝试；执行过程中未调整任何手机安全设置。

随后通过 `adb` 的 `VIEW` 操作打开同一份已完整验签的 staging `0.1.0` 公开 APK URL。用户通过普通浏览器和系统确认完成首次安装，确认界面为 V0.1、内部验证版，并完成一次训练。用户随后直接允许应用安装更新，完成 `0.1.0 → 0.1.1` 应用内升级，并确认此前训练记录可查看、更新方式仍为“手动检查”、再次检查提示已是最新版本。这些界面与数据保留结论来自用户实际操作反馈。

首轮恢复 ADB 连接后的独立只读验收记录保存在 `release-output/private/android-upgrade-installed-validation.json`：当时实际已安装版本为 `0.1.1/code 2`，`installerPackageName=com.zhiwellcare.app`；完整已安装 APK 的 SHA-256 为 `db56fa1ebe6521f5b1d4d836808feb786043762432c6c6a9684ebd32f39938d9`，与 staging 归档整包摘要一致；签名验证通过，团队证书 SHA-256 为 `cdd71d525d47ce609fd5597b8d2ecd68389bef5295e8770a1a2cb240dceb7ec3`，与登记基准一致。该核对未安装、卸载、清数据、改设置或读取训练内容。首轮证据亦保存在设备汇总的 `initialStagingUpgrade` 中，不能当作后续当前版本。升级前 ADB 曾断开，因此 `0.1.0` 基线的已安装 APK 字节证据为 `not-captured`，不能补写为已完成基线实包核验。

Android `0.1.0 → 0.1.1` 主升级链和来源权限直接允许分支已通过；后续 `0.1.1 → 0.1.2` 专项亦已完成来源拒绝返回、允许后系统取消、取消后后台不重弹、缓存手动重试和升级后数据保留，详见下文。先前 USB 安装拒绝仍不计为这些应用内分支的验收；低空间、下载中断、独立重启、安装前的后台或训练/标定限制，以及 BLE/训练业务回归仍待完成，不能将本轮通过解释为全部正式发布门禁满足。

为继续验证未覆盖分支，已在独立 staging 工作树以 `0.1.2/code 3`、RunId `20261015-device-retry` 准备更高版本，避免降级或清除设备数据。前两次 Prepare 分别在测试启动和 Vite 打包时因系统提交内存不足中止，第二次低并发 75 文件/401 项测试已通过但尚未完成签包；原 `waiting-for-system-memory` 摘要及两次 OOM 明细保留在 `release-output/private/next-staging-attempts.json` 的历史记录中。该文件已依据实际报告追加第三次完整构建、独立验收通过，并将本地构建、远端发布和设备验收分开记录。

内存恢复后，基于源码快照 `9d52799` 的新一轮标准 Prepare 已完整通过，包括全部 75 文件/401 项测试、Android Release 签包、Windows NSIS 与 `.sig` 生成，以及最终真实版本和签名核验。Manifests 已完成，Root 归档位于 `release-output/staging/0.1.2-20261015-device-retry/`；三份最终附件的大小与 SHA-256 见该归档的 `public/release-info.json`，构建依据为 `private/validation-report.json`。独立报告 `release-output/private/next-candidate-validation.json` 的十一项真实产物、清单、公钥错误、单字节篡改、APK 版本/code/证书错误等正反向检查均通过，并确认已验归档 `0.1.1/code 2 → 0.1.2/code 3` 的本地版本递增；这不代替该版本的公开下载或设备升级验收。

用户明确授权后，`test-v0.1.2-20261015-device-retry` 预览 Release 和三份附件已公开发布。归档 `private/remote-validation-report.json` 与 `private/remote-manifests-validation-report.json` 均为 `verified:true`：两端 Raw JSON 与本批清单一致，三附件均完整匿名 GET、摘要一致并通过实际版本和签名核验。发行仓库提交 `07f06d3e91c98f9227971fd99e950b51339fc964` 已推送，第三轮当时两端 staging 指针均为 `0.1.2`；发布收据为 `release-output/private/next-staging-publication.json`。stable 不在本次发布范围内。

手机用户先手动关闭本应用的来源安装许可并返回，执行代理只读核对为 `deny`。`release-output/private/android-0.1.2-negative-acceptance.json` 已记录本轮全部指定阶段通过。第一阶段用户确认返回应用后仍显示“等待允许安装更新”及“未允许”，没有自行反复打开设置；该阶段版本仍为 V0.1.1。

第二阶段用户开启来源许可，在系统安装页取消后等待约五秒，确认应用显示“更新已下载”和“已取消安装，可手动重试。”，设置页提供“检查更新”“查看更新”；Home 往返后没有自行重开安装器，界面仍为 V0.1.1。执行代理只读核对来源许可为 `allow`、实际版本仍为 `0.1.1/code 2`、最后更新时间仍为 `2026-10-15 18:35:33`，佐证取消未误安装。

第三阶段用户直接选择“查看更新 → 安装”，未重新检查或重新下载，完成缓存手动重试；安装后确认 V0.1.2、旧训练记录可见、“手动检查”保留、再次检查提示已是最新版本。界面和数据保留结论来自用户实际操作反馈。当前独立只读实包报告为 `release-output/private/android-0.1.2-installed-validation.json`：已安装 APK 为 `0.1.2/code 3`、`5712213` bytes，SHA-256 为 `dacadb79b32c409cc806c349202304f70d94d762b1f97647fed118331adfe9fc`，与公开归档一致；SDK 验签通过，证书仍为上述团队 SHA-256。安装来源为 `com.zhiwellcare.app`，最后更新时间为 `2026-10-16 22:01:22`。该次核对未安装、卸载、清数据、改设置或读取训练内容。

stable 正式通道尚未发布。staging 与 stable 使用相同产品名和应用标识，共用安装及用户数据目录，测试结束后的卸载、降级或数据清理应按已确认的具体范围处理。

依赖审计原始记录保存在 release-output/private/dependency-audit.json 和 dependency-audit-production.json；八个受影响依赖包及生产分类的 source-map-js 高危项尚未修补。本轮未更改原依赖版本，签名环境隔离只降低构建和测试接触秘密的风险。具体剩余风险应结合实际打包内容评估。

正式首发必须取得 Gitee 匿名原始 JSON 和完整附件的成功验收，并完成两端 staging 真实升级、来源授权/取消/低空间等失败场景、训练期间安装限制和新基线数据保留验证。当前两端主升级与数据保留、Android 本轮拒绝/取消/手动重试专项均已通过；其他尚未完成的失败场景与业务回归继续保留“未执行及原因”，stable 更新入口保持未发布状态。

## 平台依据

安装流关闭要求参照 [Android PackageInstaller.Session](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session)。Windows 的签名编码和安装行为按当前锁定的插件及 [Tauri updater 官方文档](https://v2.tauri.app/plugin/updater/)核对，验证库独立锁定为 minisign-verify 0.2.5，不升级原项目依赖。
