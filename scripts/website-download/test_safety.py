"""只用标准库验证发布门禁，测试不连接网络、不运行 SSH 或服务器部署。"""

from __future__ import annotations

import builtins
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


SCRIPTS = Path(__file__).resolve().parent


class EntryPointSafetyTests(unittest.TestCase):
    """优化模式不能绕过任何入口中的路径、白名单或摘要校验。"""

    def test_all_entry_points_reject_optimized_mode_before_optional_imports(self):
        # 子进程不继承签名变量；--help 不执行发布，且优化模式仍应先被拒绝。
        environment = {
            key: value
            for key, value in os.environ.items()
            if not re.match(r"^(REHAB_ANDROID_|TAURI_SIGNING_PRIVATE_KEY)", key, re.I)
        }
        # Windows 管道默认编码可能不同，固定 UTF-8 便于核对中文拒绝原因。
        environment["PYTHONIOENCODING"] = "utf-8"
        for name in ("prepare.py", "deploy.py", "server_deploy.py", "verify.py"):
            with self.subTest(script=name):
                result = subprocess.run(
                    [sys.executable, "-O", str(SCRIPTS / name), "--help"],
                    env=environment,
                    capture_output=True,
                    timeout=15,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("优化模式".encode(), result.stderr)
                self.assertNotIn(b"ModuleNotFoundError", result.stderr)


class VerificationReceiptSafetyTests(unittest.TestCase):
    """每次重验先撤销旧报告，早期错误也不能留下 verified:true。"""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="zhiwellcare-website-safety-")
        self.addCleanup(self.temporary.cleanup)
        self.prepared = Path(self.temporary.name)
        self.report_path = self.prepared / "verification/public-verification.json"
        self.report_path.parent.mkdir()
        self.report_path.write_text(json.dumps({"verified": True, "version": "old-run"}), encoding="utf-8")
        spec = importlib.util.spec_from_file_location("website_download_verifier_under_test", SCRIPTS / "verify.py")
        self.verifier = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.verifier)

    def write_metadata(self, content: str):
        path = self.prepared / "site/assets/app-download/latest.json"
        path.parent.mkdir(parents=True)
        path.write_text(content, encoding="utf-8")

    def run_verifier(self):
        # 失败路径必须在网络之前结束；意外触发 fetch 时测试立即失败。
        with patch.object(sys, "argv", ["verify.py", "--prepared", str(self.prepared)]):
            with patch.object(self.verifier, "fetch", side_effect=AssertionError("测试禁止访问网络")):
                self.verifier.main()

    def assert_current_failure_report(self):
        report = json.loads(self.report_path.read_text(encoding="utf-8"))
        self.assertIs(report["verified"], False)
        self.assertNotEqual(report["version"], "old-run")

    def test_missing_metadata_invalidates_previous_success(self):
        with self.assertRaises(FileNotFoundError):
            self.run_verifier()
        self.assert_current_failure_report()

    def test_malformed_metadata_invalidates_previous_success(self):
        self.write_metadata("{broken-json")
        with self.assertRaises(json.JSONDecodeError):
            self.run_verifier()
        self.assert_current_failure_report()

    def test_missing_metadata_fields_invalidate_previous_success(self):
        self.write_metadata("{}")
        with self.assertRaises(KeyError):
            self.run_verifier()
        self.assert_current_failure_report()

    def test_optional_dependency_failure_invalidates_previous_success(self):
        self.write_metadata(json.dumps({
            "version": "0.1.3", "channel": "staging", "downloadPage": "https://example.invalid/download.html"
        }))
        real_import = builtins.__import__

        def reject_optional_dependency(name, *arguments, **keywords):
            # 模拟二维码库未安装；其余标准库导入继续正常执行。
            if name in {"PIL", "zxingcpp"}:
                raise ModuleNotFoundError("模拟可选二维码依赖缺失")
            return real_import(name, *arguments, **keywords)

        with patch("builtins.__import__", side_effect=reject_optional_dependency):
            with self.assertRaises(ModuleNotFoundError):
                self.run_verifier()
        self.assert_current_failure_report()


if __name__ == "__main__":
    unittest.main()
