"""Embed searchable metadata into asset PNGs as tEXt chunks.

Reads asset-index/catalog.json (built by build-catalog.mjs) and writes, into each
PNG, the chunks: Title, Id, Category, Style, Keywords, Description, Software.
The metadata travels with the file, so it stays findable even outside the repo
(e.g. `exiftool img.png` or PIL `Image.open(p).text`).

Run: <comfy_python> scripts/embed_png_meta.py [catalog.json]
Also called automatically at the end of a generation run.
"""
import json
import os
import sys

from PIL import Image, PngImagePlugin

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
catalog_path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "asset-index", "catalog.json")

with open(catalog_path, encoding="utf-8") as f:
    entries = json.load(f)

ok = 0
skipped = 0
for e in entries:
    rel = e["file"].replace("/", os.sep)
    p = os.path.join(ROOT, "frontend", "public", rel)
    if not os.path.exists(p):
        skipped += 1
        continue
    try:
        im = Image.open(p)
        im.load()
        meta = PngImagePlugin.PngInfo()
        meta.add_text("Title", e.get("title", ""))
        meta.add_text("Id", e.get("id", ""))
        meta.add_text("Category", e.get("category", ""))
        if e.get("style"):
            meta.add_text("Style", e["style"])
        meta.add_text("Keywords", ", ".join(e.get("tags", [])))
        meta.add_text("Description", (e.get("prompt", "") or "")[:600])
        meta.add_text("Software", "ComfyUI Z-Image-Turbo (EchoTerra)")
        im.save(p, "PNG", pnginfo=meta)
        ok += 1
    except Exception as ex:  # noqa: BLE001
        print(f"  ! metadata failed for {p}: {ex}")
        skipped += 1

print(f"PNG metadata embedded: {ok} ok, {skipped} skipped")
