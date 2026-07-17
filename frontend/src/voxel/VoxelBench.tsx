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

function makeCells(): TerrainCell[] {
  const cells: TerrainCell[] = [];
  const cx = W / 2, cy = H / 2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > FOG_RADIUS) {
        cells.push({ x, y, block: "mist", levels: 1 });
        continue;
      }
      const v = terrainNoise(x, y);
      let block = "grass", levels = 1, under: string | undefined;
      if (v < 0.32) block = "water";
      else if (v < 0.4) block = "sand";
      else if (v < 0.58) block = "grass";
      else if (v < 0.72) { block = "forest"; levels = 1 + Math.round((v - 0.58) / 0.07); under = "dirt"; }
      else if (v < 0.86) { block = "stone"; levels = 2 + Math.round((v - 0.72) / 0.06); }
      else { block = "snow"; levels = 4; under = "stone"; }
      // ombrage d'altitude léger, comme le tint de MapScene
      const shade = 1 - Math.min(0.18, (levels - 1) * 0.05);
      cells.push({ x, y, block, levels, under, tint: new THREE.Color(shade, shade, shade) });
    }
  }
  return cells;
}

export function VoxelBench() {
  const setScreen = useStore((s) => s.setScreen);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const [hud, setHud] = useState({ calls: 0, triangles: 0, ms: 0, instances: 0, meshMs: 0, loadMs: 0 });
  const [picked, setPicked] = useState<string>("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
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
      await lib.load(["water", "sand", "grass", "forest", "stone", "snow", "mist", "dirt"]);
      if (disposed) return;
      const cells = makeCells();
      const { group, lookup, instances } = buildTerrain(lib, cells);
      engine.scene.add(group);
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
        <button onClick={() => engineRef.current?.rotate(1)} style={btn}>↻ Rotation</button>
        <button onClick={() => engineRef.current?.rotate(-1)} style={btn}>↺</button>
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
