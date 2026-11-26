"""从公网匿名读取官网、安装包及二维码，验证用户实际得到的下载内容。"""

from __future__ import annotations

# 优化模式会移除 assert；发布门禁必须在加载外部依赖前明确拒绝该模式。
if not __debug__:
    raise RuntimeError("发布工具禁止使用 Python 优化模式（-O / PYTHONOPTIMIZE）。")

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

class Page(HTMLParser):
    """按 DOM 元素核对入口，不把注释中的文字当作已显示的下载按钮。"""

    def __init__(self):
        super().__init__()
        self.links = []
        self.qr_images = []
        self.icp = []
        self._badge = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a":
            self.links.append(attrs)
            if "icp-badge" in attrs.get("class", "").split():
                self._badge = {"href": attrs.get("href"), "text": ""}
                self.icp.append(self._badge)
        if tag == "img" and "download-qr" in attrs.get("src", ""):
            self.qr_images.append(attrs)

    def handle_data(self, text):
        if self._badge is not None:
            self._badge["text"] += text

    def handle_endtag(self, tag):
        if tag == "a":
            self._badge = None


def fetch(url: str, headers: dict | None = None):
    # 不携带账号、Cookie 或授权头，保持 TLS 证书及主机名校验。
    request = Request(url, headers={"User-Agent": "ZhiWellCare-Download-Verification", **(headers or {})})
    response = build_opener(ProxyHandler({})).open(request, timeout=30)
    return response, response.read()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared", type=Path, required=True)
    args = parser.parse_args()
    output = args.prepared.resolve()
    report = {"verified": False, "version": None, "channel": None, "pages": [], "assets": []}
    results = output / "verification"
    report_path = results / "public-verification.json"
    # 先撤销旧成功：元数据损坏、缺少依赖等早期失败也不能沿用上次绿灯。
    report_path.unlink(missing_ok=True)
    results.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        metadata = json.loads((output / "site/assets/app-download/latest.json").read_text(encoding="utf-8"))
        report.update({"version": metadata["version"], "channel": metadata["channel"]})
        base = metadata["downloadPage"].removesuffix("/download.html")
        # 可选二维码依赖也在失败闭合范围内加载，缺包时保留本轮失败报告。
        from PIL import Image
        import zxingcpp

        def page_check(name):
            response, body = fetch(base + "/" + name)
            assert response.status == 200
            page = Page()
            page.feed(body.decode("utf-8"))
            assert page.icp == [{"href": "https://beian.miit.gov.cn/", "text": "京ICP备2023038913号"}]
            assert any(link.get("data-nav") == "download" and link.get("href") == "/download.html" for link in page.links)
            if name in ("", "index.html", "download.html"):
                assert page.qr_images, "页面缺少扫码入口"
            if name == "download.html":
                assert all(any(link.get("href") == item["url"] for link in page.links) for item in metadata["assets"] if not item["name"].endswith(".sig"))
                assert "预览体验版" in body.decode("utf-8") and "账号登录与云端服务暂未开放" in body.decode("utf-8")
                # expires 和 add_header 可能各产生一条字段，应合并所有缓存指令。
                assert "no-store" in ", ".join(response.headers.get_all("Cache-Control", []))
            return {"page": name or "/", "status": response.status, "downloadNavigation": True, "icpPreserved": True}

        paths = ["", "index.html", "about.html", "contact.html", "home-care.html", "news-detail.html",
                 "news.html", "product-detail.html", "products.html", "solutions.html", "support.html", "download.html"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            report["pages"] = list(pool.map(page_check, paths))
        for item in metadata["assets"]:
            response, data = fetch(item["url"])
            assert response.status == 200 and len(data) == item["size"]
            assert hashlib.sha256(data).hexdigest() == item["sha256"]
            assert "attachment" in response.headers.get("Content-Disposition", "")
            if item["name"].endswith((".apk", ".exe")):
                expected_type = "application/vnd.android.package-archive" if item["name"].endswith(".apk") else "application/vnd.microsoft.portable-executable"
                assert response.headers.get_content_type() == expected_type
                partial, first = fetch(item["url"], {"Range": "bytes=0-1023"})
                assert partial.status == 206 and first == data[:1024]
                assert partial.headers["Content-Range"] == f"bytes 0-1023/{item['size']}"
            report["assets"].append({"name": item["name"], "size": len(data), "sha256": item["sha256"], "fullDownloadVerified": True,
                                     "rangeVerified": item["name"].endswith((".apk", ".exe"))})
        qr_response, qr_bytes = fetch(base + "/assets/app-download/download-qr.png")
        assert qr_response.status == 200
        decoded = zxingcpp.read_barcode(Image.open(io.BytesIO(qr_bytes)))
        assert decoded is not None and decoded.text == metadata["downloadPage"]
        assert qr_bytes == (output / "site/assets/app-download/download-qr.png").read_bytes()
        (results / "download-qr.png").write_bytes(qr_bytes)
        report["qrDecodedUrl"] = decoded.text
        for name in ("download.css", "download.js", "download-qr.svg", "latest.json"):
            response, data = fetch(base + "/assets/app-download/" + name)
            assert response.status == 200 and data == (output / "site/assets/app-download" / name).read_bytes()
            if name == "latest.json":
                assert "no-store" in ", ".join(response.headers.get_all("Cache-Control", []))
        # 目录浏览不可用，访问者只能下载页面公布的具体文件。
        directory = metadata["assets"][0]["url"].rsplit("/", 1)[0] + "/"
        try:
            fetch(directory)
            raise AssertionError("安装包目录不应提供目录列表")
        except HTTPError as error:
            assert error.code in (403, 404)
        report["directoryListingDisabled"] = True
        report["verified"] = True
    finally:
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
