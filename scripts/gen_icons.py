#!/usr/bin/env python3
"""Generate TokenShrink extension icons using Pillow."""

import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

ICONS_DIR = Path(__file__).parent.parent / "icons"
ICONS_DIR.mkdir(exist_ok=True)

BG_COLOR = (10, 10, 10, 255)
ACCENT = (0, 255, 140, 255)
BORDER = (0, 255, 140, 200)
SIZES = [16, 32, 48, 128]


def draw_icon(size, greyscale=False):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    bg = BG_COLOR
    accent = ACCENT if not greyscale else (100, 100, 100, 255)
    border = BORDER if not greyscale else (80, 80, 80, 200)

    # Rounded rectangle background
    r = max(2, size // 8)
    draw.rounded_rectangle([1, 1, size - 2, size - 2], radius=r, fill=bg, outline=border, width=max(1, size // 40))

    # Draw "↓T" text
    text = "↓T"
    font_size = max(6, int(size * 0.45))
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", font_size)
    except Exception:
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=accent)

    return img


if not HAS_PILLOW:
    print("Pillow not installed — generating placeholder PNG icons via raw bytes")
    # Write minimal valid 1x1 PNG scaled via manifest
    import struct, zlib

    def make_png(size, color_rgb):
        """Create a minimal valid PNG."""
        width = height = size
        raw = bytes([0] + list(color_rgb) + [255]) * width
        raw_rows = bytes([0]) + raw  # filter byte
        raw_data = raw_rows * height
        compressed = zlib.compress(raw_data)

        def chunk(name, data):
            c = name + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

        ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
        sig = b'\x89PNG\r\n\x1a\n'
        return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', compressed) + chunk(b'IEND', b'')

    for size in SIZES:
        path = ICONS_DIR / f"icon{size}.png"
        path.write_bytes(make_png(size, (0, 255, 140)))
        print(f"  ✓ icons/icon{size}.png (placeholder {size}x{size})")

    disabled_path = ICONS_DIR / "icon_disabled_48.png"
    disabled_path.write_bytes(make_png(48, (60, 60, 60)))
    print("  ✓ icons/icon_disabled_48.png (placeholder)")

else:
    for size in SIZES:
        img = draw_icon(size)
        path = ICONS_DIR / f"icon{size}.png"
        img.save(path, "PNG")
        print(f"  ✓ icons/icon{size}.png ({size}x{size})")

    # Disabled variant (greyscale)
    img = draw_icon(48, greyscale=True)
    path = ICONS_DIR / "icon_disabled_48.png"
    img.save(path, "PNG")
    print("  ✓ icons/icon_disabled_48.png (disabled state)")

print("Icons generated.")
