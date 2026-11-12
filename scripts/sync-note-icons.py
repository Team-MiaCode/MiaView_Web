"""Generate the Web statistics PNGs from the v2 skin sprites (requires Pillow)."""

import os
from pathlib import Path

from PIL import Image


# Match TimelineNoteAssets.cpp, NoteImageProvider.cpp and NoteStatistics.qml.
def touch_icon(corner):
    offset = 30
    side = max(corner.width, 2 * offset + corner.height)
    center = side // 2
    canvas = Image.new("RGBA", (side, side))
    for dx, dy, rotation in ((0, -offset, 180), (offset, 0, 90), (0, offset, 0), (-offset, 0, 270)):
        piece = corner.rotate(rotation, expand=True)
        canvas.alpha_composite(piece, (center + dx - piece.width // 2, center + dy - piece.height // 2))
    return canvas


def sync_note_icons(source, output):
    # Use twice the QML display size for high-DPI screens.
    sprites = {
        "tap": ("tap", (40, 40)),
        "hold": ("hold", (36, 52)),
        "slide": ("star", (48, 48)),
        "touch": ("touch", (40, 40)),
        "tap_break": ("tap_break", (40, 40)),
    }
    for skin in ("SD", "DX"):
        skin_dir = source / "assets" / "skin" / f"skin{skin}"
        target = output / skin
        target.mkdir(parents=True, exist_ok=True)
        for kind, (sprite, size) in sprites.items():
            with Image.open(skin_dir / f"{sprite}.png") as sprite_image:
                image = sprite_image.convert("RGBA")
            if kind == "touch":
                image = touch_icon(image)
            image = image.crop(image.getchannel("A").getbbox())
            image.thumbnail(size, Image.Resampling.BILINEAR)
            image.save(target / f"{kind}.png", optimize=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    source = Path(os.environ.get("MIACODE_UI_SOURCE_DIR", root / "vendor" / "MiaCode"))
    sync_note_icons(source, root / "ui" / "components" / "notes")
