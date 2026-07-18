// Banc d'essai du moteur voxel (Phase 1 du VOXEL-PLAN) — dev tool plein écran,
// hors du shell téléphone (hash #voxel-bench, bouton titre). Rend un monde
// 60×60 façon Map (biomes par hauteur + anneau de brume "fog of war"), avec
// les vrais contrôles (pan/pinch/molette/tap) et la rotation 4 orientations.
// Le HUD affiche les budgets à valider sur téléphone réel : draw calls,
// triangles, instances, temps de meshing, durée de la dernière frame.
// Absorbé plus tard comme onglet "Terrain" de l'éditeur voxel (Phase 1b).

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildTerrain, type TerrainCell } from "./terrain";
import { SmoothTerrain, type TerrainSource } from "./smoothTerrain";

const W = 60, H = 60; // mêmes dimensions que worldgen.DefaultSize
const FOG_RADIUS = 21; // au-delà : brume (simule les tuiles non découvertes)

function hashNoise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h >>> 16) & 0xffff) / 0x10000;
}
// bruit de valeur lissé 2 octaves — juste pour donner un relief plausible au banc
function terrainNoise(x: number, y: number): number {
  const n = (s: number, xx: number, yy: number) => {
    const x0 = Math.floor(xx / s), y0 = Math.floor(yy / s);
    const fx = (xx / s) - x0, fy = (yy / s) - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hashNoise(x0, y0), b = hashNoise(x0 + 1, y0), c = hashNoise(x0, y0 + 1), d = hashNoise(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c + (d - c) * sx - (a + (b - a) * sx)) * sy;
  };
  return 0.65 * n(13, x, y) + 0.35 * n(5, x + 77, y + 77);
}

// biome + hauteur synthétiques (mêmes seuils que la vraie génération, en gros)
function tileFor(x: number, y: number): { biome: number; height: number } {
  const v = terrainNoise(x, y);
  if (v < 0.32) return { biome: 0, height: 0 };
  if (v < 0.4) return { biome: 1, height: 0 };
  if (v < 0.58) return { biome: 2, height: 0 };
  if (v < 0.72) return { biome: 3, height: Math.round((v - 0.58) / 0.07) };
  if (v < 0.86) return { biome: 4, height: 1 + Math.round((v - 0.72) / 0.06) };
  return { biome: 5, height: 3 };
}
const BLOCK_OF = ["water", "sand", "grass", "forest", "stone", "snow"];
const UNDER_OF: Record<string, string | undefined> = { forest: "dirt", snow: "stone" };

function makeCells(): TerrainCell[] {
  const cells: TerrainCell[] = [];
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > FOG_RADIUS) {
        cells.push({ x, y, block: "mist", under: "mistbase", levels: 2 });
        continue;
      }
      const t = tileFor(x, y);
      const block = BLOCK_OF[t.biome];
      const levels = t.biome === 0 || t.biome === 1 || t.biome === 2 ? 1 : t.height + 1;
      const shade = 1 - Math.min(0.18, (levels - 1) * 0.05);
      cells.push({ x, y, block, levels, under: UNDER_OF[block], tint: new THREE.Color(shade, shade, shade) });
    }
  }
  return cells;
}

// source "tout découvert" pour évaluer le style diorama sur un GRAND monde
function makeSource(): TerrainSource {
  const tiles: TerrainSource["tiles"] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) tiles.push({ ...tileFor(x, y), discovered: true });
  }
  return { width: W, height: H, tiles };
}

export function VoxelBench() {
  const setScreen = useStore((s) => s.setScreen);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const [hud, setHud] = useState({ calls: 0, triangles: 0, ms: 0, instances: 0, meshMs: 0, loadMs: 0 });
  const [picked, setPicked] = useState<string>("");
  const [mode, setMode] = useState<"blocks" | "smooth">("smooth");
  const rebuildRef = useRef<((m: "blocks" | "smooth") => void) | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.enableLighting({ shadowSpan: 45 });
    const controls = new VoxelControls(engine);
    engine.target.set(W / 2, 0, H / 2);
    engine.zoom = 28;
    let disposed = false;
    let lib: BlockLibrary | null = null;

    const sel = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    sel.visible = false;
    engine.scene.add(sel);

    (async () => {
      const t0 = performance.now();
      lib = new BlockLibrary("/voxels/16"); // LOD carte : blocs 16³
      const propsLib = new BlockLibrary("/voxels/props");
      await Promise.all([
        lib.load(["water", "sand", "grass", "forest", "stone", "snow", "mist", "mistbase", "dirt"]),
        propsLib.load(["tree-green", "tree-pink", "rock", "pine", "pine-snow", "grass-tuft", "flowers", "reed"]),
      ]);
      if (disposed) return;
      const smooth = new SmoothTerrain();
      const roots: THREE.Object3D[] = [];
      let lookup = new Map<THREE.Object3D, TerrainCell[]>();
      let instances = 0;
      const rebuild = (mode: "blocks" | "smooth") => {
        for (const r of roots) engine.scene.remove(r);
        roots.length = 0;
        if (mode === "blocks") {
          const built = buildTerrain(lib!, makeCells());
          lookup = built.lookup;
          instances = built.instances;
          roots.push(built.group);
        } else {
          // GRAND MONDE tout découvert : l'évaluation du style diorama
          const source = makeSource();
          roots.push(smooth.build(source, null, (t) => t.height));
          // scatter d'arbres/rochers, même logique que la carte (compacte)
          const h01 = (x: number, y: number, s: number) => {
            let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
            h = (h ^ (h >> 13)) * 1274126177;
            return ((h >>> 16) & 0xffff) / 0x10000;
          };
          const mats = new Map<string, THREE.Matrix4[]>();
          const up = new THREE.Vector3(0, 1, 0);
          for (const [i, t] of source.tiles.entries()) {
            const x = i % W, y = Math.floor(i / W);
            const plant = (id: string, k: number, sc: number) => {
              const px = x + (h01(x, y, k) - 0.5) * 0.7;
              const py = y + (h01(x, y, k + 1) - 0.5) * 0.7;
              const s = sc * (0.75 + h01(x, y, k + 2) * 0.4);
              const m = new THREE.Matrix4().compose(
                new THREE.Vector3(px, smooth.heightAt(px, py) - 0.02, py),
                new THREE.Quaternion().setFromAxisAngle(up, h01(x, y, k + 3) * Math.PI * 2),
                new THREE.Vector3(s, s, s),
              );
              const key = `${id}-v${Math.floor(h01(x, y, k + 4) * 3)}`;
              (mats.get(key) ?? mats.set(key, []).get(key)!).push(m);
            };
            if (t.biome === 3) {
              plant("tree-green", 10, 0.62);
              if (h01(x, y, 20) < 0.5) plant("tree-green", 30, 0.5);
              if (h01(x, y, 40) < 0.12) plant("tree-pink", 50, 0.55);
              if (h01(x, y, 110) < 0.4) plant("grass-tuft", 115, 0.3);
            } else if (t.biome === 2) {
              const r = h01(x, y, 60);
              if (r < 0.06) plant("tree-pink", 70, 0.55);
              else if (r < 0.14) plant("tree-green", 80, 0.5);
              if (h01(x, y, 120) < 0.55) plant("grass-tuft", 125, 0.32);
              if (h01(x, y, 130) < 0.16) plant("flowers", 135, 0.3);
            } else if (t.biome === 4) {
              if (h01(x, y, 99) < 0.3) plant("rock", 100, 0.65);
              if (h01(x, y, 150) < 0.3) plant("pine", 155, 0.62);
            } else if (t.biome === 5) {
              if (h01(x, y, 160) < 0.35) plant("pine-snow", 165, 0.6);
            } else if (t.biome === 1) {
              if (h01(x, y, 170) < 0.12) plant("reed", 175, 0.38);
            }
          }
          const group = new THREE.Group();
          instances = 0;
          for (const [key, list] of mats) {
            const dash = key.lastIndexOf("-v");
            const geom = propsLib.get(key.slice(0, dash), Number(key.slice(dash + 2)));
            if (!geom) continue;
            const mesh = new THREE.InstancedMesh(geom, new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
            for (let k = 0; k < list.length; k++) mesh.setMatrixAt(k, list[k]);
            mesh.instanceMatrix.needsUpdate = true;
            mesh.castShadow = mesh.receiveShadow = true;
            group.add(mesh);
            instances += list.length;
          }
          roots.push(group);
          lookup = new Map();
        }
        for (const r of roots) engine.scene.add(r);
        engine.invalidate();
      };
      rebuild("smooth");
      rebuildRef.current = rebuild;
      (window as unknown as { __vbRebuild?: (m: "blocks" | "smooth") => void }).__vbRebuild = rebuild;
      engine.onFrame = (f) =>
        setHud((h) => ({ ...h, ...f, instances, meshMs: Math.round(lib!.meshMs), loadMs: Math.round(performance.now() - t0) }));
      controls.onTap = (tap) => {
        const hit = tap && engine.pick(tap.cssX, tap.cssY).find((i) => lookup.has(i.object));
        if (hit && hit.instanceId !== undefined) {
          const cell = lookup.get(hit.object)![hit.instanceId];
          sel.position.set(cell.x, cell.levels + 0.02, cell.y);
          sel.visible = true;
          setPicked(`(${cell.x},${cell.y}) ${cell.block} ×${cell.levels}`);
        } else {
          sel.visible = false;
          setPicked("");
        }
        engine.invalidate();
      };
      engine.invalidate();
    })();

    if (import.meta.env.DEV) (window as unknown as { __vb?: unknown }).__vb = { engine, THREE };
    return () => {
      disposed = true;
      controls.dispose();
      engine.dispose();
      lib?.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#20242e", color: "#e8e4d8", fontFamily: "sans-serif" }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={() => { location.hash = ""; setScreen("title"); }} style={btn}>← Retour</button>
        <button onClick={() => setScreen("voxeledit")} style={btn}>🧊 Éditeur</button>
        <button onClick={() => engineRef.current?.rotate(1)} style={btn}>↻ Rotation</button>
        <button onClick={() => engineRef.current?.rotate(-1)} style={btn}>↺</button>
        <button
          style={{ ...btn, background: mode === "smooth" ? "#5a7d4a" : btn.background }}
          onClick={() => { const m = mode === "smooth" ? "blocks" : "smooth"; setMode(m); rebuildRef.current?.(m); }}
        >
          {mode === "smooth" ? "🌄 Lisse" : "🧱 Blocs"}
        </button>
      </div>
      <div style={{ position: "absolute", bottom: 8, left: 8, fontSize: 12, background: "rgba(0,0,0,.55)", padding: "6px 10px", borderRadius: 8, lineHeight: 1.6 }}>
        <div>draw calls {hud.calls} · tris {hud.triangles.toLocaleString()} · instances {hud.instances}</div>
        <div>meshing {hud.meshMs} ms · chargement {hud.loadMs} ms · frame {hud.ms.toFixed(1)} ms</div>
        <div>{picked || "tap = sélection · drag = pan · molette/pinch = zoom"}</div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "#3a4152", color: "#e8e4d8", border: "1px solid #555d72",
  borderRadius: 8, padding: "8px 14px", fontSize: 14, cursor: "pointer",
};
