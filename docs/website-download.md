# 官网应用下载与二维码维护

固定下载页是 `https://zhiwellcare.com/download.html`。首页二维码和下载页二维码都编码此地址，发布新安装包时继续使用同一张二维码。二维码原图为 `/assets/app-download/download-qr.png`，另提供可缩放的 SVG。

当前分发的是已经公开、验签的 **0.1.3 / code 4 预览版**，不是 stable 正式首发。原始附件位于 `release-output/staging/0.1.3-20261016-remaining-device-qa/`；Android 和 Windows 更新地址继续使用原有 Gitee 通道。

当前 APK 的账号 API 仍编译为 `http://127.0.0.1:8080`。下载页面已明确说明本地训练预览及账号、云端服务限制。本次不修改已签名二进制、不恢复先前暂停的实机 QA。后续联网版需配置真实 HTTPS API，递增版本并重新构建、签名和验收；不能直接改 APK 字节或将它改标为 stable。

## 目录与公开文件

- 官网：`/srv/sites/web/current`，保留原有版本并通过符号链接切换。
- 安装包：`/srv/downloads/zhiwellcare/<channel>/<version>/`。
- 公开地址：`https://zhiwellcare.com/downloads/app/<channel>/<version>/<filename>`。
- 主页、导航及下载页模板：`scripts/website-download/templates/`。
- Nginx 配置备份：`/var/backups/website-app-download/<deployment-id>/`。
- 更新后的完整官网包：`/srv/sites/web/packages/zwkl-web-<deployment-id>.tar.gz`。

安装包目录只包含 APK、Windows EXE、对应 EXE.sig、SHA256SUMS.txt 和公开 release-info.json；源码、签名私钥、密码、`release.local.json`、private 报告均不上传。目录浏览关闭，APK/EXE 以附件响应，支持 Range 断点续传。同通道同版本的文件字节不可被替换，应发布递增版本。

## 准备与发布

先选择一个装有 Node.js、Java、Android SDK 和 Python 3.12 的开发环境；原生版本与签名检查复用项目现有工具，不需要签名私钥密码。Python 工具依赖列在 `scripts/website-download/requirements.txt`，建议安装到独立虚拟环境。

四个发布与验收脚本均拒绝 Python 优化模式（`-O`、`-OO` 或启用 `PYTHONOPTIMIZE`），防止路径、摘要等校验被跳过。公网验收会先撤销旧成功结果，再读取本批资料及依赖；失败后不会保留旧的 `verified: true`。

```powershell
# 按本机 Python 实际路径执行；工具环境位于已忽略的 release-output。
python -m venv release-output/website-tools
$sitePython = (Resolve-Path release-output/website-tools/Scripts/python.exe).Path
& $sitePython -m pip install -r scripts/website-download/requirements.txt

# 本地安全回归仅使用 Python 标准库，不连接服务器、不执行部署。
& $sitePython -m unittest discover -s scripts/website-download -p 'test_*.py'

# 新版本必须已完成原发布流程的公开附件和清单验收。
& $sitePython scripts/website-download/prepare.py `
  --archive release-output/staging/0.1.3-20261016-remaining-device-qa `
  --output release-output/website-download/staging/0.1.3
```

`prepare.py` 校验两份成功的远端验收报告与本批版本、通道和三附件一致，再核对真实 APK 身份、团队证书及 Windows 版本和 Tauri 更新签名。它生成独立的官网元数据，**不改写应用内更新清单**。Windows 更新签名不等于 Authenticode 受信任发布者签名，页面如实提示安装来源。

上传前通过已有安全环境提供 `ZHIWELLCARE_SSH_PASSWORD`。密码不放在参数、脚本或文档中。部署使用核验后的服务器公开 SSH 指纹：

```powershell
try {
  & $sitePython scripts/website-download/deploy.py `
    --prepared release-output/website-download/staging/0.1.3 `
    --host 49.233.153.19 --user ubuntu --port 22 `
    --host-key-sha256 'SHA256:aldbetmXG4PZydY5M5QpdQDWMBwoRybHhsxjTbIp1OI'
} finally {
  # 使用后清除当前进程中的 SSH 密码变量。
  Remove-Item Env:\ZHIWELLCARE_SSH_PASSWORD -ErrorAction SilentlyContinue
}

# 从公网匿名完整读取安装包、验证摘要、断点续传及二维码真实内容。
& $sitePython scripts/website-download/verify.py `
  --prepared release-output/website-download/staging/0.1.3
```

服务器端工具兼容 Ubuntu 22.04 自带的 Python 3.10。它为官网下载增加独立 Nginx location，保留 IP、`.cn`、APP 和管理后台配置；通过 `nginx -t` 后再切换官网并 reload。部署阶段失败会恢复旧官网指针与 Nginx 配置，已上传的同版本安装包仍可保留待重试。

部署结果保存在本地准备目录的 `deployment-result.json`，公网验收记录为 `verification/public-verification.json`。前者的 `status: active` 证明服务器切换完成；后者的 `verified: true` 才证明公网下载、二维码和页面检查通过，二者不能互相替代。

## 更换版本或页面内容

新版本先完成已有发布流程，再把 `--archive`、`--output` 指向相应版本。工具自动更新首页卡片、导航、下载页、体积、摘要和独立官网元数据；旧安装包目录和固定二维码地址不变。版本更新不会自动取消预览版标记或账号限制说明；在新版业务能力、实机门禁确认后，按实际状态更新模板和说明。

调整页面外观时修改 templates 后重新执行 prepare、deploy、verify。下载页与当前版本资料使用 no-store，版本化安装包使用长期缓存，静态样式带内容摘要参数。所有页面继续保留 `京ICP备2023038913号` 及工信部查询链接。

如需回滚，依据服务器备份中的 `deployment.json` 找到 `previousCurrentLink`，恢复对应官网指针和同目录的 `zwkl-web.conf`，检查 Nginx 配置再 reload。不要删除安装包历史目录，以免已保存的下载地址失效。
