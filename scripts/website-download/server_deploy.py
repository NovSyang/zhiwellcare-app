"""在已授权的 Nginx 服务器运行：安装包独立保存，官网通过 current 链接切换。"""

from __future__ import annotations

# 优化模式会移除 assert；发布门禁必须在加载外部依赖前明确拒绝该模式。
if not __debug__:
    raise RuntimeError("发布工具禁止使用 Python 优化模式（-O / PYTHONOPTIMIZE）。")

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import time
from urllib.request import Request, urlopen


CURRENT = Path("/srv/sites/web/current")
RELEASES = Path("/srv/sites/web/releases")
PACKAGES = Path("/srv/downloads/zhiwellcare")
CONFIG = Path("/etc/nginx/sites-available/zwkl-web")
BEGIN = "# BEGIN ZHIWELLCARE_APP_DOWNLOADS"
END = "# END ZHIWELLCARE_APP_DOWNLOADS"


def digest(path: Path) -> str:
    # Ubuntu 22.04 默认使用 Python 3.10，分块计算兼容该系统且不占用大块内存。
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def write_config(data: bytes, identifier: str) -> None:
    temporary = CONFIG.with_name(".zwkl-web-" + identifier)
    temporary.write_bytes(data)
    temporary.chmod(0o644)
    os.replace(temporary, CONFIG)


def switch_site(target: str, identifier: str) -> None:
    temporary = CURRENT.with_name(".current-" + identifier)
    assert not temporary.exists() and not temporary.is_symlink()
    os.symlink(target, temporary)
    os.replace(temporary, CURRENT)


def checked(command: list[str]) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(" ".join(command) + ": " + result.stdout + result.stderr)


def add_page_entry(text: str, css_version: str) -> str:
    """保留原导航和备案页脚，仅增加下载入口及其独立样式。"""
    assert "京ICP备" in text, "官网备案页脚必须保留"
    if 'data-nav="download"' not in text:
        entry = '\n        <!-- 固定下载页便于用户查找当前应用版本。 -->\n'
        entry += '        <li><a class="nav__link" data-nav="download" href="/download.html">应用下载</a></li>\n      '
        pattern = r'(<ul\b[^>]*id="navMenu"[^>]*>.*?)(</ul>)'
        text, count = re.subn(pattern, lambda match: match[1] + entry + match[2], text, count=1, flags=re.S)
        assert count == 1, "未找到官网主导航"
    text = text.replace('class="site-header"', 'class="site-header download-nav-enabled"', 1)
    link = f'<link rel="stylesheet" href="/assets/app-download/download.css?v={css_version}">'
    pattern = r'<link\b[^>]*href="/assets/app-download/download\.css[^\"]*"[^>]*>'
    if re.search(pattern, text):
        text = re.sub(pattern, lambda _: link, text, count=1)
    else:
        text = text.replace("</head>", "<!-- 下载样式限定作用域，避免影响原有业务页面。 -->\n" + link + "\n</head>", 1)
    return text


def nginx_locations() -> str:
    # 包路径包含通道和版本，已有同版本字节不可被另一个版本覆盖。
    return """    # BEGIN ZHIWELLCARE_APP_DOWNLOADS
    # 下载页和当前版本资料不缓存，更新安装包后二维码仍指向同一页面。
    location = /download.html {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }
    location = /assets/app-download/latest.json {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }
    # 安装包独立于官网版本目录保存；关闭目录浏览，支持断点续传。
    location ^~ /downloads/app/ {
        alias /srv/downloads/zhiwellcare/;
        autoindex off;
        types {
            application/vnd.android.package-archive apk;
            application/vnd.microsoft.portable-executable exe;
            application/json json;
            text/plain sig txt md;
        }
        default_type application/octet-stream;
        add_header Content-Disposition "attachment";
        add_header X-Content-Type-Options "nosniff" always;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    # END ZHIWELLCARE_APP_DOWNLOADS

"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--deploy-id", required=True)
    args = parser.parse_args()
    stage = args.stage.resolve()
    identifier = args.deploy_id
    assert re.fullmatch(r"app-download-\d{8}T\d{6}Z", identifier)
    assert stage.parent == Path("/home/ubuntu") and stage.name == ".website-download-" + identifier
    assert not args.stage.is_symlink() and all(not path.is_symlink() for path in stage.rglob("*"))
    manifest = json.loads((stage / "deployment-manifest.json").read_text(encoding="utf-8"))
    relative = manifest["packageRelative"]
    assert relative == f"{manifest['channel']}/{manifest['version']}"
    assert re.fullmatch(r"(?:stable|staging)/\d+\.\d+\.\d+", relative)
    for name, info in manifest["files"].items():
        path = stage / name
        assert path.resolve().is_relative_to(stage) and path.is_file()
        assert path.stat().st_size == info["size"] and digest(path) == info["sha256"]
    assert CURRENT.is_symlink() and CURRENT.resolve().is_relative_to(RELEASES)
    old_target = os.readlink(CURRENT)
    previous = CURRENT.resolve()
    old_config = CONFIG.read_bytes()
    protected = {name: digest(Path("/etc/nginx/sites-available") / name) for name in ("zwkl-app", "zwkl-admin")}
    backup = Path("/var/backups/website-app-download") / identifier
    backup.mkdir(parents=True, mode=0o700)
    backup.chmod(0o700)
    shutil.copy2(CONFIG, backup / "zwkl-web.conf")
    record = {"status": "preparing", "previousRelease": str(previous), "previousCurrentLink": old_target,
              "downloadPage": manifest["downloadPage"], "version": manifest["version"],
              "channel": manifest["channel"], "protectedConfigs": protected, "backupDirectory": str(backup)}

    def save_record() -> None:
        path = backup / "deployment.json"
        path.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        path.chmod(0o600)

    save_record()
    # 校验同版本不可变，再把预备安装包目录原子移入正式目录。
    destination = PACKAGES / relative
    incoming = PACKAGES / (".incoming-" + identifier)
    package_source = stage / "packages" / relative
    if destination.exists():
        assert {p.name for p in destination.iterdir()} == {p.name for p in package_source.iterdir()}
        assert all(digest(destination / p.name) == digest(p) for p in package_source.iterdir())
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(package_source, incoming)
        for path in incoming.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)
        incoming.chmod(0o755)
        os.replace(incoming, destination)

    release = RELEASES / identifier
    shutil.copytree(previous, release, copy_function=shutil.copy2)
    # 官网资料使用独立目录，与移动端的 Gitee 更新清单互不混用。
    for path in (stage / "site").rglob("*"):
        target = release / path.relative_to(stage / "site")
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            target.chmod(0o644)
    pages = sorted(release.glob("*.html"))
    for page in pages:
        text = add_page_entry(page.read_bytes().decode("utf-8"), manifest["assetVersion"])
        if page.name == "index.html":
            start, end = "<!-- APP_DOWNLOAD_SECTION_START -->", "<!-- APP_DOWNLOAD_SECTION_END -->"
            block = start + "\n" + (stage / "home-section.html").read_text(encoding="utf-8") + "\n" + end
            if start in text:
                text, count = re.subn(re.escape(start) + r".*?" + re.escape(end), lambda _: block, text, flags=re.S)
                assert count == 1
            else:
                hero = text.index('<section class="hero">')
                hero_end = text.index("</section>", hero) + len("</section>")
                text = text[:hero_end] + "\n" + block + text[hero_end:]
        page.write_bytes(text.encode("utf-8"))
    assert len(pages) == 11 and all((release / name).is_file() for name in ("download.html", "assets/app-download/download-qr.svg"))

    config_text = old_config.decode("utf-8")
    locations = nginx_locations()
    if BEGIN in config_text:
        pattern = r"(?ms)^    " + re.escape(BEGIN) + r".*?^    " + re.escape(END) + r"\n*"
        new_config, count = re.subn(pattern, lambda _: locations, config_text)
    else:
        marker = "    location /assets/ {"
        count = config_text.count(marker)
        new_config = config_text.replace(marker, locations + marker)
    assert count == 2, "只允许修改官网的两个静态入口"
    assert digest(CONFIG) == hashlib.sha256(old_config).hexdigest() and CURRENT.resolve() == previous
    changed_config = new_config.encode("utf-8") != old_config
    switched = False
    try:
        write_config(new_config.encode("utf-8"), identifier)
        checked(["nginx", "-t"])
        switch_site(str(release), identifier)
        switched = True
        if changed_config:
            checked(["systemctl", "reload", "nginx"])
        # 本地入口也验证实际文件服务，公网信任与整包摘要由调用端继续验收。
        response = urlopen(Request("http://127.0.0.1/download.html", headers={"Host": "49.233.153.19"}), timeout=10)
        assert response.status == 200 and manifest["version"] in response.read().decode("utf-8")
        apk = next(p for p in package_source.iterdir() if p.suffix == ".apk")
        request = Request("http://127.0.0.1/downloads/app/" + relative + "/" + apk.name,
                          headers={"Host": "49.233.153.19"}, method="HEAD")
        # reload 发送信号后，等待新工作进程接管新加入的下载路由。
        for attempt in range(10):
            try:
                head = urlopen(request, timeout=10)
                break
            except OSError:
                if attempt == 9:
                    raise
                time.sleep(0.2)
        assert head.status == 200 and head.headers.get_content_type() == "application/vnd.android.package-archive"
        assert int(head.headers["Content-Length"]) == apk.stat().st_size
        assert all(digest(Path("/etc/nginx/sites-available") / name) == value for name, value in protected.items())
        # 完整官网备份包不包含外部安装包，下一次升级官网也不会丢失历史下载。
        website_package = Path("/srv/sites/web/packages") / ("zwkl-web-" + identifier + ".tar.gz")
        with tarfile.open(website_package, "w:gz") as archive:
            archive.add(release, arcname=".")
        record.update({"status": "active", "release": str(release), "packageDirectory": str(destination),
                       "websitePackage": str(website_package), "pageCount": len(pages)})
        save_record()
        # 目录名和父目录都已限定，清理本次不含秘密的临时上传副本。
        shutil.rmtree(stage)
        print(json.dumps(record, ensure_ascii=False), flush=True)
    except Exception as error:
        write_config(old_config, identifier)
        if switched:
            switch_site(old_target, identifier)
        checked(["nginx", "-t"])
        checked(["systemctl", "reload", "nginx"])
        record.update({"status": "rolled-back", "error": str(error)})
        save_record()
        raise


if __name__ == "__main__":
    main()
