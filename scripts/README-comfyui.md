# Local asset generation with ComfyUI

Generate the game's art **locally** on your own GPU (RTX 5060) — no cloud, no queue,
no Perchance/Cloudflare bot-detection. This is the preferred path; the AI Horde script
(`generate-assets.mjs`) stays as a cloud fallback.

## Install location

ComfyUI (portable, NVIDIA cu130 build) lives at:

```
D:\ComfyUI_windows_portable\
```

- Embedded Python + PyTorch 2.12 (CUDA 13.0, Blackwell sm_120 — verified working).

### Backends (the generator can drive either)

**`zimage` — Z-Image-Turbo (DEFAULT, recommended).** Cleaner game-icon output, near-white
background, only 8 steps. Mirrors the `image_z_image_turbo.json` workflow. Model files:
- `models/diffusion_models/z_image_turbo_bf16.safetensors`
- `models/text_encoders/qwen_3_4b.safetensors`
- `models/vae/ae.safetensors`

(These total ~19 GB and exceed the 8 GB VRAM, so ComfyUI streams weights between RAM and
VRAM — the first generation is slow while models load, then it speeds up.)

**`sd15` — DreamShaper 8 (fallback).** `models/checkpoints/dreamshaper_8.safetensors`. Lighter
and fully GPU-resident, but tends to add a colored circular background.

Select with `COMFY_BACKEND` (default `zimage`):

```powershell
$env:COMFY_BACKEND="sd15"; npm run generate:comfy      # use DreamShaper instead
```

## 1. Start the ComfyUI server

Double-click (or run):

```
D:\ComfyUI_windows_portable\run_nvidia_gpu.bat
```

Wait until it prints `To see the GUI go to: http://127.0.0.1:8188`. The REST API is on
the same port. Leave this window open while generating.

## 2. Generate assets

From the `scripts/` folder:

```bash
npm run generate:comfy            # generate every MISSING asset
npm run generate:comfy:dry        # list what would be generated (no GPU work)

# or directly:
node generate-assets-comfy.mjs --id building-gate    # one specific asset
node generate-assets-comfy.mjs --force               # regenerate ALL (overwrite)
```

Output → `frontend/public/assets/{category}/{filename}.png`. Existing files are skipped
unless `--force` is given. Prompts come from the shared `asset-manifest.mjs` (edit the
`STYLE` prefix there to retune the whole set).

## Transparent backgrounds (rembg)

Diffusion models can't emit a real alpha channel — they *paint* a background (Z-Image
gives dark or white depending on the subject). A post-process strips it to real
transparency with **rembg** (neural matting), installed in ComfyUI's embedded Python.

```bash
# Generate AND strip backgrounds in one go:
node generate-assets-comfy.mjs --force --rembg

# Or run it standalone over everything already in frontend/public/assets:
npm run rembg
# ...or specific files:
"D:\ComfyUI_windows_portable\python_embeded\python.exe" remove_bg.py path\to\a.png path\to\b.png
```

Each PNG is rewritten in place as RGBA. Model: `isnet-general-use` (override with
`REMBG_MODEL`, e.g. `u2net` or `birefnet-general`). The first run downloads the model
(~180 MB) once.

## Tuning (env vars)

| Var | Default (zimage / sd15) | Notes |
|---|---|---|
| `COMFY_HOST` | `127.0.0.1:8188` | server address |
| `COMFY_BACKEND` | `zimage` | `zimage` or `sd15` |
| `COMFY_STEPS` | `8` / `25` | sampler steps |
| `COMFY_CFG` | `1` / `7` | prompt adherence |
| `COMFY_SAMPLER` | `res_multistep` / `euler_ancestral` | KSampler sampler |
| `COMFY_SCHEDULER` | `simple` / `normal` | KSampler scheduler |
| `COMFY_SIZE` | `1024` / `512` | square output px |
| `COMFY_CKPT` | `dreamshaper_8.safetensors` | sd15 checkpoint |
| `COMFY_ZUNET` / `COMFY_ZCLIP` / `COMFY_ZVAE` | z-image files | override Z-Image model filenames |

PowerShell example:

```powershell
$env:COMFY_STEPS=30; $env:COMFY_CFG=6.5; npm run generate:comfy
```

## Adding SDXL later (optional, higher quality)

8 GB VRAM can run SDXL with `--lowvram`. Drop an SDXL checkpoint
(e.g. `dreamshaperXL.safetensors`) into `models/checkpoints`, start ComfyUI with
`run_nvidia_gpu.bat` plus `--lowvram`, then:

```powershell
$env:COMFY_CKPT="dreamshaperXL.safetensors"; $env:COMFY_SIZE=1024; npm run generate:comfy
```

(For SDXL the negative prompt and CFG may want tuning; SD1.5 / DreamShaper 8 is the
default because it's fast and matches the existing prompt style.)
