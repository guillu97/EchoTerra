// Étiquettes texte pour le moteur voxel : un THREE.Sprite portant un canvas
// (nom d'unité, états…). Peint une fois par texte, mis en cache par contenu.

import * as THREE from "three";
import { DPR } from "../game/dpr";

const cache = new Map<string, THREE.Texture>();

function textTexture(text: string, color: string): { tex: THREE.Texture; aspect: number } {
  const key = `${color}|${text}`;
  let tex = cache.get(key);
  if (!tex) {
    const pad = 6;
    const fs = 22 * DPR;
    const c = document.createElement("canvas");
    const ctx = c.getContext("2d")!;
    ctx.font = `bold ${fs}px monospace`;
    const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
    const h = Math.ceil(fs * 1.35) + pad;
    c.width = w;
    c.height = h;
    const ctx2 = c.getContext("2d")!;
    ctx2.font = `bold ${fs}px monospace`;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";
    // halo sombre pour rester lisible sur tout terrain
    ctx2.fillStyle = "rgba(10,10,20,0.55)";
    ctx2.beginPath();
    ctx2.roundRect(0, 0, w, h, 8 * DPR);
    ctx2.fill();
    ctx2.fillStyle = color;
    ctx2.fillText(text, w / 2, h / 2 + 1);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.NoColorSpace;
    cache.set(key, tex);
  }
  const img = tex.image as HTMLCanvasElement;
  return { tex, aspect: img.height / img.width };
}

/** Sprite-étiquette ; `height` = hauteur monde souhaitée (largeur ∝ texte).
 *  depthTest OFF : l'étiquette flotte au bord d'un bloc — le test de profondeur
 *  la faisait disparaître dans le terrain. */
export function makeLabel(text: string, color = "#e8e8f0", height = 0.16): THREE.Sprite {
  const { tex, aspect } = textTexture(text, color);
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }),
  );
  s.scale.set(height / aspect, height, 1);
  s.userData.ownMat = true; // matériau propre à l'étiquette (la texture reste en cache)
  return s;
}
