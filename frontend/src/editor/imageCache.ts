// Tiny HTMLImageElement cache shared by the live canvas and the PNG exporter.

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();

// Synchronous accessor for the render loop: returns the image if already decoded,
// otherwise kicks off a load and calls onReady once it's available (to trigger a redraw).
export function getImage(url: string, onReady?: () => void): HTMLImageElement | undefined {
  const hit = cache.get(url);
  if (hit) return hit;
  if (!pending.has(url)) {
    void loadImage(url).then(() => onReady?.());
  } else if (onReady) {
    void pending.get(url)!.then(() => onReady());
  }
  return undefined;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  const hit = cache.get(url);
  if (hit) return Promise.resolve(hit);
  const existing = pending.get(url);
  if (existing) return existing;
  const p = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      cache.set(url, img);
      pending.delete(url);
      resolve(img);
    };
    img.onerror = (e) => {
      pending.delete(url);
      reject(e);
    };
    img.src = url;
  });
  pending.set(url, p);
  return p;
}

export function loadAll(urls: string[]): Promise<unknown> {
  return Promise.all(urls.map((u) => loadImage(u).catch(() => undefined)));
}
