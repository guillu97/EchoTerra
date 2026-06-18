"""
EchoTerra — transparent-background post-processor.

Runs rembg (neural background matting) over generated PNGs and rewrites each one
with a real alpha channel, so the painted background (dark or white) becomes
transparent. This makes the icons drop cleanly onto any game UI surface.

Run with the ComfyUI embedded Python (rembg is installed there):

  D:\\ComfyUI_windows_portable\\python_embeded\\python.exe scripts\\remove_bg.py [files...]

With no file arguments it scans frontend/public/assets/**.png. Pass explicit paths
(the generator does this) to process only the freshly-generated files.

Env:
  REMBG_MODEL   rembg model name (default: isnet-general-use; alt: u2net, birefnet-general)
"""

import os
import sys
import glob

from rembg import remove, new_session
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, "..", "frontend", "public", "assets")
MODEL = os.environ.get("REMBG_MODEL", "isnet-general-use")


def targets():
    args = sys.argv[1:]
    if args:
        return args
    return glob.glob(os.path.join(ASSETS, "**", "*.png"), recursive=True)


def main():
    files = targets()
    if not files:
        print("No PNG files to process.")
        return

    print(f"rembg background removal — model '{MODEL}' — {len(files)} file(s)")
    session = new_session(MODEL)

    ok = 0
    for i, path in enumerate(files, 1):
        name = os.path.basename(path)
        try:
            with Image.open(path) as img:
                src = img.convert("RGBA")
            out = remove(src, session=session)  # returns RGBA with bg removed
            out.save(path, format="PNG")
            print(f"  [{i}/{len(files)}] OK  {name}")
            ok += 1
        except Exception as e:  # noqa: BLE001 - report and continue
            print(f"  [{i}/{len(files)}] FAIL {name}: {e}")

    print(f"Done: {ok}/{len(files)} made transparent.")


if __name__ == "__main__":
    main()
