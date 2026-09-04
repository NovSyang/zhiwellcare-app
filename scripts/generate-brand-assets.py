"""从项目根目录的 zwkl.jpg 确定性生成桌面与 Android 品牌图片。"""

from __future__ import annotations

import shutil
import subprocess
from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "zwkl.jpg"
BRANDING_DIR = ROOT / "assets" / "branding"
MASTER_ICON = BRANDING_DIR / "zwkl-app-icon.png"
TAURI_ICON_DIR = ROOT / "src-tauri" / "icons"
ANDROID_RES_DIR = ROOT / "android" / "app" / "src" / "main" / "res"

LAUNCHER_SIZES = {
    "mdpi": 48,
    "hdpi": 72,
    "xhdpi": 96,
    "xxhdpi": 144,
    "xxxhdpi": 192,
}

FOREGROUND_SIZES = {
    "mdpi": 108,
    "hdpi": 162,
    "xhdpi": 216,
    "xxhdpi": 324,
    "xxxhdpi": 432,
}

SPLASH_SIZES = {
    "drawable": (480, 320),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
}

TAURI_FILES = {
    "32x32.png",
    "64x64.png",
    "128x128.png",
    "128x128@2x.png",
    "icon.png",
    "icon.ico",
    "icon.icns",
    "Square30x30Logo.png",
    "Square44x44Logo.png",
    "Square71x71Logo.png",
    "Square89x89Logo.png",
    "Square107x107Logo.png",
    "Square142x142Logo.png",
    "Square150x150Logo.png",
    "Square284x284Logo.png",
    "Square310x310Logo.png",
    "StoreLogo.png",
}


def find_content_bbox(image: Image.Image, x_limit: int | None = None) -> tuple[int, int, int, int]:
    """寻找明显偏离白色背景的内容边界，避免依赖固定裁切坐标。"""
    rgb = image.convert("RGB")
    width = x_limit or rgb.width
    xs: list[int] = []
    ys: list[int] = []
    pixels = rgb.load()

    for y in range(rgb.height):
        for x in range(width):
            red, green, blue = pixels[x, y]
            if min(red, green, blue) < 232:
                xs.append(x)
                ys.append(y)

    if not xs:
        raise RuntimeError("zwkl.jpg 中没有识别到品牌内容。")

    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def find_largest_component_bbox(image: Image.Image, x_limit: int) -> tuple[int, int, int, int]:
    """在左侧区域寻找最大的非白连通图形，避免把右侧品牌文字带入图标。"""
    rgb = image.convert("RGB")
    width = min(x_limit, rgb.width)
    height = rgb.height
    pixels = rgb.load()
    content = bytearray(width * height)
    visited = bytearray(width * height)

    for y in range(height):
        row_offset = y * width
        for x in range(width):
            red, green, blue = pixels[x, y]
            if min(red, green, blue) < 232:
                content[row_offset + x] = 1

    largest_count = 0
    largest_bbox: tuple[int, int, int, int] | None = None
    for y in range(height):
        for x in range(width):
            start_index = y * width + x
            if not content[start_index] or visited[start_index]:
                continue

            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited[start_index] = 1
            count = 0
            left = right = x
            top = bottom = y
            while queue:
                current_x, current_y = queue.popleft()
                count += 1
                left = min(left, current_x)
                right = max(right, current_x)
                top = min(top, current_y)
                bottom = max(bottom, current_y)

                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_index = next_y * width + next_x
                    if content[next_index] and not visited[next_index]:
                        visited[next_index] = 1
                        queue.append((next_x, next_y))

            if count > largest_count:
                largest_count = count
                largest_bbox = (left, top, right + 1, bottom + 1)

    if largest_bbox is None:
        raise RuntimeError("zwkl.jpg 左侧没有识别到圆形品牌标志。")
    return largest_bbox


def expand_bbox(
    bbox: tuple[int, int, int, int],
    image_size: tuple[int, int],
    padding_ratio: float,
) -> tuple[int, int, int, int]:
    """按内容尺寸增加安全留白，并限制在原图范围内。"""
    left, top, right, bottom = bbox
    padding = round(max(right - left, bottom - top) * padding_ratio)
    return (
        max(0, left - padding),
        max(0, top - padding),
        min(image_size[0], right + padding),
        min(image_size[1], bottom + padding),
    )


def remove_connected_white_background(image: Image.Image) -> Image.Image:
    """只删除与四周相连的近白像素，保留标志内部封闭的白色图形。"""
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    width, height = rgba.size
    visited = bytearray(width * height)
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        red, green, blue, _ = pixels[x, y]
        return min(red, green, blue) >= 215 and max(red, green, blue) - min(red, green, blue) <= 38

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if visited[index] or not is_background(x, y):
            return
        visited[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (*pixels[x, y][:3], 0)
        if x > 0:
            enqueue(x - 1, y)
        if x + 1 < width:
            enqueue(x + 1, y)
        if y > 0:
            enqueue(x, y - 1)
        if y + 1 < height:
            enqueue(x, y + 1)

    alpha_bbox = rgba.getchannel("A").getbbox()
    if alpha_bbox is None:
        raise RuntimeError("品牌标志背景处理后没有保留任何有效像素。")
    return rgba.crop(alpha_bbox)


def remove_small_alpha_components(image: Image.Image, minimum_pixels: int) -> Image.Image:
    """清除 JPEG 边缘留下的孤立小噪点，不触碰正常文字与标志。"""
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    alpha_pixels = alpha.load()
    output_pixels = rgba.load()
    width, height = rgba.size
    visited = bytearray(width * height)

    for y in range(height):
        for x in range(width):
            start_index = y * width + x
            if visited[start_index] or alpha_pixels[x, y] == 0:
                continue

            queue: deque[tuple[int, int]] = deque([(x, y)])
            visited[start_index] = 1
            component: list[tuple[int, int]] = []
            while queue:
                current_x, current_y = queue.popleft()
                component.append((current_x, current_y))
                for next_x, next_y in (
                    (current_x - 1, current_y),
                    (current_x + 1, current_y),
                    (current_x, current_y - 1),
                    (current_x, current_y + 1),
                ):
                    if not (0 <= next_x < width and 0 <= next_y < height):
                        continue
                    next_index = next_y * width + next_x
                    if not visited[next_index] and alpha_pixels[next_x, next_y] > 0:
                        visited[next_index] = 1
                        queue.append((next_x, next_y))

            if len(component) < minimum_pixels:
                for component_x, component_y in component:
                    red, green, blue, _ = output_pixels[component_x, component_y]
                    output_pixels[component_x, component_y] = (red, green, blue, 0)

    alpha_bbox = rgba.getchannel("A").getbbox()
    if alpha_bbox is None:
        raise RuntimeError("清理品牌图噪点后没有保留任何有效像素。")
    return rgba.crop(alpha_bbox)


def place_contained(
    image: Image.Image,
    canvas_size: tuple[int, int],
    max_width_ratio: float,
    max_height_ratio: float,
    background: tuple[int, int, int, int],
) -> Image.Image:
    """保持比例缩放并居中放置，避免标志或文字被拉伸。"""
    canvas = Image.new("RGBA", canvas_size, background)
    max_width = round(canvas_size[0] * max_width_ratio)
    max_height = round(canvas_size[1] * max_height_ratio)
    scale = min(max_width / image.width, max_height / image.height)
    target_size = (
        max(1, round(image.width * scale)),
        max(1, round(image.height * scale)),
    )
    resized = image.resize(target_size, Image.Resampling.LANCZOS)
    position = (
        (canvas_size[0] - target_size[0]) // 2,
        (canvas_size[1] - target_size[1]) // 2,
    )
    canvas.alpha_composite(resized, position)
    return canvas


def save_png(image: Image.Image, destination: Path) -> None:
    """先写入同目录临时文件再替换，避免构建工具读取时得到半张图片。"""
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = destination.with_name(f".{destination.name}.tmp")
    image.save(temporary_path, format="PNG", optimize=True)
    temporary_path.replace(destination)


def build_master_icon(source: Image.Image) -> tuple[Image.Image, Image.Image]:
    """提取左侧圆形标志，并生成带透明安全留白的 1024 像素母版。"""
    left_region_width = round(source.width * 0.45)
    mark_bbox = find_largest_component_bbox(source, left_region_width)
    mark_crop = source.crop(expand_bbox(mark_bbox, source.size, 0.035))
    isolated_mark = remove_connected_white_background(mark_crop)
    master = place_contained(
        isolated_mark,
        (1024, 1024),
        max_width_ratio=0.84,
        max_height_ratio=0.84,
        background=(255, 255, 255, 0),
    )
    return isolated_mark, master


def generate_tauri_icons(master: Image.Image) -> None:
    """调用项目自带 Tauri CLI 生成 ICO、ICNS 与 Windows 多尺寸资源。"""
    BRANDING_DIR.mkdir(parents=True, exist_ok=True)
    save_png(master, MASTER_ICON)

    cli_script = ROOT / "node_modules" / "@tauri-apps" / "cli" / "tauri.js"
    if not cli_script.exists():
        raise RuntimeError("未找到 Tauri CLI，请先执行 npm install。")

    temporary_dir = ROOT / ".brand-icon-output"
    if temporary_dir.exists():
        shutil.rmtree(temporary_dir)

    try:
        subprocess.run(
            ["node", str(cli_script), "icon", str(MASTER_ICON), "-o", str(temporary_dir)],
            cwd=ROOT,
            check=True,
        )
        TAURI_ICON_DIR.mkdir(parents=True, exist_ok=True)
        for file_name in TAURI_FILES:
            source_path = temporary_dir / file_name
            if not source_path.exists():
                raise RuntimeError(f"Tauri CLI 未生成预期文件：{file_name}")
            shutil.copy2(source_path, TAURI_ICON_DIR / file_name)
    finally:
        if temporary_dir.exists():
            shutil.rmtree(temporary_dir)


def generate_android_launcher(isolated_mark: Image.Image, master: Image.Image) -> None:
    """生成传统与自适应启动器图标，自适应前景限制在安全区域内。"""
    for density, size in LAUNCHER_SIZES.items():
        destination = ANDROID_RES_DIR / f"mipmap-{density}"
        destination.mkdir(parents=True, exist_ok=True)
        launcher = master.resize((size, size), Image.Resampling.LANCZOS)
        save_png(launcher, destination / "ic_launcher.png")
        save_png(launcher, destination / "ic_launcher_round.png")

    adaptive_master = place_contained(
        isolated_mark,
        (1024, 1024),
        max_width_ratio=0.62,
        max_height_ratio=0.62,
        background=(255, 255, 255, 0),
    )
    for density, size in FOREGROUND_SIZES.items():
        destination = ANDROID_RES_DIR / f"mipmap-{density}"
        foreground = adaptive_master.resize((size, size), Image.Resampling.LANCZOS)
        save_png(foreground, destination / "ic_launcher_foreground.png")


def generate_android_splashes(source: Image.Image) -> None:
    """使用完整横向品牌图生成白底横竖屏启动图。"""
    brand_bbox = expand_bbox(find_content_bbox(source), source.size, 0.025)
    # 先清除 JPEG 自带的近白底色，避免纯白启动页出现浅色矩形边界。
    wordmark = remove_small_alpha_components(
        remove_connected_white_background(source.crop(brand_bbox)),
        minimum_pixels=120,
    )

    for directory_name, size in SPLASH_SIZES.items():
        splash = place_contained(
            wordmark,
            size,
            max_width_ratio=0.78,
            max_height_ratio=0.42,
            background=(255, 255, 255, 255),
        ).convert("RGB")
        destination = ANDROID_RES_DIR / directory_name
        destination.mkdir(parents=True, exist_ok=True)
        save_png(splash, destination / "splash.png")


def validate_outputs() -> None:
    """验证关键尺寸、透明边缘与桌面容器格式，尽早发现不完整资源。"""
    expected_tauri_png_sizes = {
        "32x32.png": (32, 32),
        "64x64.png": (64, 64),
        "128x128.png": (128, 128),
        "128x128@2x.png": (256, 256),
        "icon.png": (512, 512),
    }
    for file_name, expected_size in expected_tauri_png_sizes.items():
        with Image.open(TAURI_ICON_DIR / file_name) as image:
            if image.size != expected_size:
                raise RuntimeError(f"桌面图标尺寸错误：{file_name} 应为 {expected_size}。")

    with Image.open(TAURI_ICON_DIR / "icon.ico") as icon:
        ico_sizes = set(icon.info.get("sizes", []))
        required_sizes = {(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)}
        if not required_sizes.issubset(ico_sizes):
            raise RuntimeError("icon.ico 缺少 Windows 所需的多尺寸图层。")

    with Image.open(TAURI_ICON_DIR / "icon.icns") as icon:
        if icon.size != (1024, 1024):
            raise RuntimeError("icon.icns 未包含 1024 像素桌面图标。")

    with Image.open(MASTER_ICON) as image:
        rgba = image.convert("RGBA")
        if any(rgba.getpixel(position)[3] != 0 for position in ((0, 0), (1023, 0), (0, 1023), (1023, 1023))):
            raise RuntimeError("图标母版四角必须保持透明。")
        rgba_pixels = rgba.load()
        opaque_white_pixels = 0
        for y in range(rgba.height):
            for x in range(rgba.width):
                red, green, blue, alpha = rgba_pixels[x, y]
                if alpha > 240 and min(red, green, blue) > 242:
                    opaque_white_pixels += 1
        if opaque_white_pixels < 5_000:
            raise RuntimeError("图标母版内部的白色 ZW 或心形可能被误删。")

    for density, size in LAUNCHER_SIZES.items():
        directory = ANDROID_RES_DIR / f"mipmap-{density}"
        for file_name in ("ic_launcher.png", "ic_launcher_round.png"):
            with Image.open(directory / file_name) as image:
                if image.size != (size, size):
                    raise RuntimeError(f"Android 图标尺寸错误：{density}/{file_name}。")

    for density, size in FOREGROUND_SIZES.items():
        with Image.open(ANDROID_RES_DIR / f"mipmap-{density}" / "ic_launcher_foreground.png") as image:
            if image.size != (size, size):
                raise RuntimeError(f"Android 自适应前景尺寸错误：{density}。")

    for directory_name, size in SPLASH_SIZES.items():
        with Image.open(ANDROID_RES_DIR / directory_name / "splash.png") as image:
            if image.size != size:
                raise RuntimeError(f"Android 启动图尺寸错误：{directory_name}。")
            if image.convert("RGB").getpixel((0, 0)) != (255, 255, 255):
                raise RuntimeError(f"Android 启动图背景不是纯白色：{directory_name}。")


def main() -> None:
    if not SOURCE.exists():
        raise RuntimeError(f"品牌源图不存在：{SOURCE}")

    source = Image.open(SOURCE).convert("RGB")
    isolated_mark, master = build_master_icon(source)
    generate_tauri_icons(master)
    generate_android_launcher(isolated_mark, master)
    generate_android_splashes(source)
    validate_outputs()
    print("品牌资产生成完成：Tauri 图标、Android 启动器图标和启动图已更新。")


if __name__ == "__main__":
    main()
