// Per-sprite content metrics, measured once from the decoded image and cached by URL.
//
// The generated iso cubes are NOT uniformly framed (content width varies 0.63–0.81 of
// the canvas, with transparent padding around it). To tessellate them we measure each
// sprite's actual opaque content box and scale/anchor by THAT, not by the raw image.
// All values are resolution-independent fractions of the image's own width/height.

export interface SpriteMetrics {
  fLeft: number; // content left edge, fraction of image width
  fRight: number;
  fTop: number; // content top edge, fraction of image height
  fBottom: number; // content bottom edge, fraction of image height
  fCenterX: number; // content horizontal centre, fraction of image width
  fWidth: number; // content width, fraction of image width
  aspect: number; // image height / image width
}

const cache = new Map<string, SpriteMetrics>();

// Scan a downscaled copy for speed (content fractions are scale-invariant).
const SCAN_W = 160;

export function metricsFor(img: HTMLImageElement): SpriteMetrics | undefined {
  const key = img.src;
  const hit = cache.get(key);
  if (hit) return hit;
  if (!img.complete || !img.naturalWidth) return undefined;

  const sw = SCAN_W;
  const sh = Math.max(1, Math.round((SCAN_W * img.naturalHeight) / img.naturalWidth));
  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;

  let left = sw,
    right = -1,
    top = sh,
    bottom = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (data[(y * sw + x) * 4 + 3] > 40) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) {
    // Fully transparent — fall back to a centred full-frame sprite.
    const m: SpriteMetrics = { fLeft: 0, fRight: 1, fTop: 0, fBottom: 1, fCenterX: 0.5, fWidth: 1, aspect: sh / sw };
    cache.set(key, m);
    return m;
  }

  const m: SpriteMetrics = {
    fLeft: left / sw,
    fRight: (right + 1) / sw,
    fTop: top / sh,
    fBottom: (bottom + 1) / sh,
    fCenterX: (left + right + 1) / 2 / sw,
    fWidth: (right - left + 1) / sw,
    aspect: img.naturalHeight / img.naturalWidth,
  };
  cache.set(key, m);
  return m;
}
