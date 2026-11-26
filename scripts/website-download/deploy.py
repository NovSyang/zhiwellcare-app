"""上传独立的官网下载资料，并使用备份和原子切换发布官网新版本。"""

from __future__ import annotations

# 优化模式会移除 assert；发布门禁必须在加载外部依赖前明确拒绝该模式。
if not __debug__:
    raise RuntimeError("发布工具禁止使用 Python 优化模式（-O / PYTHONOPTIMIZE）。")

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shlex

import paramiko


class PinnedHostKey(paramiko.MissingHostKeyPolicy):
    """复用核对过的服务器公钥指纹，避免把安装包发到错误服务器。"""

    def __init__(self, expected: str):
        self.expected = expected

    def missing_host_key(self, client, hostname, key):
        actual = "SHA256:" + base64.b64encode(hashlib.sha256(key.asbytes()).digest()).decode().rstrip("=")
        if actual != self.expected:
            raise paramiko.SSHException("服务器 SSH 公钥指纹与指定值不一致")


def file_hash(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--user", default="ubuntu")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--host-key-sha256", required=True)
    args = parser.parse_args()
    password = os.environ.get("ZHIWELLCARE_SSH_PASSWORD")
    assert password, "通过 ZHIWELLCARE_SSH_PASSWORD 环境变量提供 SSH 密码"
    root = args.prepared.resolve()
    manifest = json.loads((root / "deployment-manifest.json").read_text(encoding="utf-8"))
    prefix = "ZhiWellCare-" + manifest["version"] + ("-staging" if manifest["channel"] == "staging" else "")
    expected = {"site/download.html"} | {"site/assets/app-download/" + name for name in (
        "download.css", "download.js", "download-qr.png", "download-qr.svg", "latest.json"
    )} | {"packages/" + manifest["packageRelative"] + "/" + name for name in (
        prefix + "-android.apk", prefix + "-windows-x64-setup.exe", prefix + "-windows-x64-setup.exe.sig",
        "SHA256SUMS.txt", "release-info.json"
    )}
    assert set(manifest["files"]) == expected, "部署清单只能包含官网下载所需的公开文件"
    for name, info in manifest["files"].items():
        path = (root / name).resolve()
        assert path.is_relative_to(root) and path.is_file() and not path.is_symlink()
        assert path.stat().st_size == info["size"] and file_hash(path) == info["sha256"]
    deploy_id = "app-download-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stage = f"/home/{args.user}/.website-download-{deploy_id}"
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(PinnedHostKey(args.host_key_sha256))
    try:
        client.connect(args.host, args.port, args.user, password, timeout=15,
                       auth_timeout=15, allow_agent=False, look_for_keys=False)
        sftp = client.open_sftp()
        sftp.mkdir(stage, mode=0o700)
        sftp.chmod(stage, 0o700)
        made = {stage}

        def upload(local: Path, relative: str) -> None:
            # 仅上传白名单公开文件和部署脚本，私钥与 private 报告不在上传列表。
            parts = relative.split("/")
            assert all(part not in {"", ".", ".."} for part in parts)
            parent = stage
            for part in parts[:-1]:
                parent += "/" + part
                if parent not in made:
                    sftp.mkdir(parent, mode=0o700)
                    made.add(parent)
            target = stage + "/" + relative
            sftp.put(str(local), target)
            sftp.chmod(target, 0o600)

        for name in manifest["files"]:
            upload(root / name, name)
        for name in ("deployment-manifest.json", "home-section.html"):
            upload(root / name, name)
        upload(Path(__file__).with_name("server_deploy.py"), "server_deploy.py")
        command = "sudo -n python3 " + shlex.quote(stage + "/server_deploy.py")
        command += " --stage " + shlex.quote(stage) + " --deploy-id " + shlex.quote(deploy_id)
        print("UPLOADED_VALIDATED_DOWNLOAD_FILES", flush=True)
        _, stdout, stderr = client.exec_command(command, timeout=180)
        result_text = stdout.read().decode("utf-8", "replace")
        error_text = stderr.read().decode("utf-8", "replace")
        print(result_text, end="", flush=True)
        if error_text:
            print(error_text, flush=True)
        status = stdout.channel.recv_exit_status()
        if status:
            raise SystemExit(status)
        result = json.loads(result_text.strip().splitlines()[-1])
        (root / "deployment-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    finally:
        client.close()


if __name__ == "__main__":
    main()
