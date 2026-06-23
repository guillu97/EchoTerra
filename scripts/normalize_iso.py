"""
EchoTerra — isometric cube normaliser (PRECISE / fixed-box).

For a tessellating iso tileset, every cube must be EXACTLY the same size. This crops
each tile to its content and resizes it to a FIXED box (BOX_W x BOX_H) — independent
X/Y scaling, which removes per-generation size variance so all cubes end up identical.
The cube is then placed on a fixed square canvas, horizontally centred and bottom-anchored
so every cube base lines up. (This assumes PURE cubes — no decoration protruding past the
cube silhouette; protruding decorations should be separate props.)

Run with the ComfyUI embedded Python:
  D:\\ComfyUI_windows_portable\\python_embeded\\python.exe scripts\\normalize_iso.py [files...]
With no args it normalises frontend/public/assets/isotiles/*.png (skipping bridge.png,
which is a connector, not a tessellating block).

Env: ISO_CANVAS (1024), ISO_BOX_W (0.86 of canvas), ISO_BOX_H (0.88), ISO_MARGIN (0.06)
"""
import os
import sys
import glob

from PIL import Image

CANVAS = int(os.environ.get("ISO_CANVAS", 1024))
BOX_W = int(CANVAS * float(os.environ.get("ISO_BOX_W", 0.86)))
BOX_H = int(CANVAS * float(os.environ.get("ISO_BOX_H", 0.88)))
MARGIN = int(CANVAS * float(os.environ.get("ISO_MARGIN", 0.06)))
SKIP = {"bridge.png"}  # connectors / non-tessellating tiles


def normalize(path):
    name = os.path.basename(path)
    if name in SKIP:
        print(f"  skip {name} (excluded)")
        return
    im = Image.open(path).convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        print(f"  skip {name} (empty)")
        return
    content = im.crop(bbox).resize((BOX_W, BOX_H), Image.LANCZOS)  # force exact box
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - BOX_W) // 2
    y = CANVAS - BOX_H - MARGIN  # bottom-anchor: all cube bases align
    canvas.alpha_composite(content, (x, max(0, y)))
    canvas.save(path, format="PNG")
    print(f"  norm {name}: -> {BOX_W}x{BOX_H} (fixed)")


def main():
    files = sys.argv[1:]
    if not files:
        here = os.path.dirname(os.path.abspath(__file__))
        files = glob.glob(os.path.join(here, "..", "frontend", "public", "assets", "isotiles", "*.png"))
    print(f"Normalising {len(files)} iso tiles to fixed box {BOX_W}x{BOX_H} on {CANVAS} canvas")
    for f in files:
        normalize(f)
    print("Done.")


if __name__ == "__main__":
    main()
