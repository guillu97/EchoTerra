// Device pixel ratio used for the Phaser canvas resolution. Without it the canvas
// backing store is sized in CSS pixels and the browser upscales it — on phones
// (DPR 2–3) the whole map looked pixelated. Capped at 3: beyond that the extra
// GPU fill-rate cost buys no visible gain on phone-sized screens.
export const DPR = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
