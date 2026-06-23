"""Build per-category contact sheets of the generated asset library, for review."""
import os, glob, math
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.join(HERE, "..", "frontend", "public", "assets")
OUT = os.path.join(HERE, "..", "asset-index")
os.makedirs(OUT, exist_ok=True)

CATS = ["isotiles", "tiles", "objects", "buildings", "characters", "props", "monsters", "structures"]
CELL, COLS, PAD = 190, 8, 12
BG = (44, 48, 58, 255)

for cat in CATS:
    files = sorted(glob.glob(os.path.join(BASE, cat, "*.png")))
    if not files:
        continue
    rows = math.ceil(len(files) / COLS)
    W = COLS * (CELL + PAD) + PAD
    H = rows * (CELL + PAD) + PAD
    sheet = Image.new("RGBA", (W, H), BG)
    for i, f in enumerate(files):
        im = Image.open(f).convert("RGBA")
        im.thumbnail((CELL, CELL), Image.LANCZOS)
        cx = PAD + (i % COLS) * (CELL + PAD) + (CELL - im.width) // 2
        cy = PAD + (i // COLS) * (CELL + PAD) + (CELL - im.height) // 2
        sheet.alpha_composite(im, (cx, cy))
    sheet.convert("RGB").save(os.path.join(OUT, f"{cat}.png"))
    print(f"  {cat}: {len(files)} -> {cat}.png ({W}x{H})")

print("Contact sheets in", os.path.normpath(OUT))
