"""将已公开且已验签的安装包准备为独立的官网下载资料，不改应用更新通道。"""

from __future__ import annotations

# 优化模式会移除 assert；发布门禁必须在加载外部依赖前明确拒绝该模式。
if not __debug__:
    raise RuntimeError("发布工具禁止使用 Python 优化模式（-O / PYTHONOPTIMIZE）。")

import argparse
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import quote, urlsplit

import qrcode
from qrcode.image.svg import SvgPathImage


ROOT = Path(__file__).resolve().parents[2]
TEMPLATES = Path(__file__).with_name("templates")


def read_json(path: Path) -> dict:
    """兼容 PowerShell 保存的 UTF-8 BOM 文件。"""
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify_archive(archive: Path, info: dict) -> None:
    """只镜像已公开验收的同一批文件，不把本地 stable 候选直接当成正式版。"""
    for name in ("remote-validation-report.json", "remote-manifests-validation-report.json"):
        report = read_json(archive / "private" / name)
        assert report.get("verified") is True, "公开附件验收尚未通过"
        assert report.get("version") == info["version"]
        assert report.get("channel") == info["channel"]
        assert sorted(report["assets"], key=lambda item: item["name"]) == sorted(
            info["assets"], key=lambda item: item["name"]
        ), "公开验收报告与本批附件不一致"
    for item in info["assets"]:
        assert Path(item["name"]).name == item["name"], "附件名称不能包含目录"
        path = archive / "artifacts" / item["name"]
        assert path.stat().st_size == item["size"] and digest(path) == item["sha256"]

    # 复用项目的原生版本及签名检查，只使用公开证书和公钥。
    code = """
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyApk,verifyWindows} from './scripts/release/check-inputs.mjs';
const archive=process.argv[1];
const info=JSON.parse((await readFile(resolve(archive,'public/release-info.json'),'utf8')).replace(/^\\uFEFF/,''));
const signing=JSON.parse(await readFile('release-signing.json','utf8'));
const version={schemaVersion:1,productVersion:info.version,displayVersion:info.displayVersion,
 desktop:{version:info.version},android:{versionName:info.version,versionCode:info.versionCode}};
const find=suffix=>resolve(archive,'artifacts',info.assets.find(a=>a.name.endsWith(suffix)).name);
const android=await verifyApk(find('.apk'),version,signing);
const windows=await verifyWindows(find('.exe'),find('.exe.sig'),version,signing);
console.log(JSON.stringify({android,windows:{version:windows.version,updaterSignature:'verified'}}));
"""
    environment = {
        key: value
        for key, value in os.environ.items()
        if not re.match(r"^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY)", key, re.I)
    }
    subprocess.run(
        ["node", "--input-type=module", "-e", code, str(archive)],
        cwd=ROOT,
        env=environment,
        check=True,
        timeout=240,
    )


def render(name: str, values: dict[str, str]) -> str:
    """模板数据统一转义，避免更新版本资料时意外生成 HTML。"""
    text = (TEMPLATES / name).read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace("{{" + key + "}}", html.escape(str(value), quote=True))
    assert not re.search(r"\{\{[A-Z_]+\}\}", text), "模板仍有未填写字段"
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--base-url", default="https://zhiwellcare.com")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    archive = args.archive.resolve()
    output = args.output.resolve()
    origin = args.base_url.rstrip("/")
    url = urlsplit(origin)
    assert url.scheme == "https" and url.netloc and not url.path
    assert not url.username and not url.password and not url.query and not url.fragment
    assert output.is_relative_to(ROOT / "release-output"), "输出应放入已忽略的 release-output"
    info = read_json(archive / "public/release-info.json")
    assert info["channel"] in {"stable", "staging"}
    assert re.fullmatch(r"\d+\.\d+\.\d+", info["version"])
    assert len(info["assets"]) == 3, "仅公开 APK、EXE 和对应签名"
    verify_archive(archive, info)

    channel, version = info["channel"], info["version"]
    prefix = "ZhiWellCare-" + version + ("-staging" if channel == "staging" else "")
    expected = {prefix + "-android.apk", prefix + "-windows-x64-setup.exe", prefix + "-windows-x64-setup.exe.sig"}
    assert {item["name"] for item in info["assets"]} == expected
    files = {item["name"]: item for item in info["assets"]}
    apk = files[prefix + "-android.apk"]
    windows = files[prefix + "-windows-x64-setup.exe"]
    relative = f"{channel}/{version}"
    base = f"{origin}/downloads/app/{relative}"
    page_url = origin + "/download.html"
    site = output / "site"
    assets = site / "assets/app-download"
    packages = output / "packages" / relative
    assets.mkdir(parents=True, exist_ok=True)
    packages.mkdir(parents=True, exist_ok=True)
    for item in info["assets"]:
        destination = packages / item["name"]
        if destination.exists():
            assert digest(destination) == item["sha256"], "同版本安装包不能被不同字节覆盖"
        else:
            shutil.copy2(archive / "artifacts" / item["name"], destination)
    for name in ("SHA256SUMS.txt", "release-info.json"):
        shutil.copy2(archive / "public" / name, packages / name)

    # 二维码只编码固定下载页；以后换安装包时无需重新印刷二维码。
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=12, border=4)
    qr.add_data(page_url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(assets / "download-qr.png")
    qr.make_image(image_factory=SvgPathImage).save(assets / "download-qr.svg")
    asset_hash = hashlib.sha256(
        (TEMPLATES / "download.css").read_bytes() + (TEMPLATES / "download.js").read_bytes()
    ).hexdigest()[:12]
    values = {
        "VERSION": version,
        "CHANNEL_LABEL": "预览体验版" if channel == "staging" else "正式版",
        "PUBLISHED_DATE": info["publishedAt"][:10],
        "ANDROID_URL": base + "/" + quote(apk["name"]),
        "ANDROID_SIZE": f"{apk['size'] / 1024 / 1024:.2f} MB",
        "ANDROID_SHA256": apk["sha256"],
        "WINDOWS_URL": base + "/" + quote(windows["name"]),
        "WINDOWS_SIZE": f"{windows['size'] / 1024 / 1024:.2f} MB",
        "WINDOWS_SHA256": windows["sha256"],
        "SIGNATURE_URL": base + "/" + quote(windows["name"] + ".sig"),
        "CHECKSUMS_URL": base + "/SHA256SUMS.txt",
        "RELEASE_INFO_URL": base + "/release-info.json",
        "DOWNLOAD_PAGE_URL": page_url,
        "ASSET_VERSION": asset_hash,
    }
    (site / "download.html").write_text(render("download.html", values), encoding="utf-8")
    (output / "home-section.html").write_text(render("home-section.html", values), encoding="utf-8")
    for name in ("download.css", "download.js"):
        shutil.copy2(TEMPLATES / name, assets / name)
    metadata = {
        "schemaVersion": 1,
        "version": version,
        "channel": channel,
        "channelLabel": values["CHANNEL_LABEL"],
        "publishedAt": info["publishedAt"],
        "downloadPage": page_url,
        "sourceRepository": "https://github.com/NovSyang/zhiwellcare-app",
        "accountServices": "not-configured-in-current-preview",
        "assets": [{**item, "url": base + "/" + quote(item["name"])} for item in info["assets"]],
    }
    (assets / "latest.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # 部署清单只列白名单公开文件，不包含源码、私钥或 private 诊断报告。
    all_files = [p for directory in (site, output / "packages") for p in directory.rglob("*") if p.is_file()]
    expected_paths = {"site/download.html"} | {
        "site/assets/app-download/" + name
        for name in ("download.css", "download.js", "download-qr.png", "download-qr.svg", "latest.json")
    } | {"packages/" + relative + "/" + name for name in expected | {"SHA256SUMS.txt", "release-info.json"}}
    assert {p.relative_to(output).as_posix() for p in all_files} == expected_paths, "输出目录存在白名单之外的文件"
    assert all(not p.is_symlink() for p in all_files)
    manifest = {
        "schemaVersion": 1,
        "version": version,
        "channel": channel,
        "assetVersion": asset_hash,
        "packageRelative": relative,
        "downloadPage": page_url,
        "files": {str(p.relative_to(output)).replace("\\", "/"): {"size": p.stat().st_size, "sha256": digest(p)} for p in all_files},
    }
    (output / "deployment-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"prepared": str(output), "version": version, "channel": channel, "downloadPage": page_url, "publicFiles": len(all_files)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
