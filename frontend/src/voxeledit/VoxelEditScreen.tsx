// Éditeur voxel (Phase 1b du VOXEL-PLAN) — dev tool plein écran hors shell,
// façon éditeur de carte (§7b) / Studio de données (§7c). Trois zones :
// bibliothèque des .vox publiés (gauche), vue 3D du moteur voxel (centre —
// bloc seul / tuilage 3×3 / pile, rotation 4 orientations + orbite libre),
// outils (droite — poser/effacer/pipette, palette, miroir X, undo/redo,
// RECETTES LIVE via le module recipes.mjs partagé avec le CLI, export/import).

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { VoxelEngine } from "../voxel/engine";
import { VoxelControls } from "../voxel/controls";
import { meshVoxModel } from "../voxel/mesher";
import { LIBRARY, useVoxEdit } from "./voxeditStore";
import "./voxeledit.css";

// bornes de sliders par famille de paramètre de recette
function paramRange(key: string, value: number): { min: number; max: number; step: number } {
  if (value <= 0.1) return { min: 0, max: 0.08, step: 0.002 }; // densités de scatter
  return { min: 0, max: 8, step: 1 }; // bump, surfaceDepth…
}

export function VoxelEditScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const st = useVoxEdit();
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const meshesRef = useRef<THREE.Mesh[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // moteur : monté une fois
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.zoom = 180;
    engine.target.set(0, 0.45, 0);
    const controls = new VoxelControls(engine);
    const grid = new THREE.GridHelper(3, 3, 0x8b84a8, 0x554f6b);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = -0.002; // sous la base des blocs (sinon z-fight sur y=0)
    engine.scene.add(grid);

    controls.onTap = (tap) => {
      const s = useVoxEdit.getState();
      const m = s.model;
      if (!m || s.tool === "nav") return;
      const hit = engine.pick(tap.cssX, tap.cssY).find((i) => meshesRef.current.includes(i.object as THREE.Mesh));
      if (!hit || !hit.face) return;
      const mesh = hit.object as THREE.Mesh;
      const size = Math.max(m.sx, m.sy);
      const local = hit.point.clone().sub(mesh.position);
      const n = hit.face.normal;
      const off = 0.5 / size;
      // effacer/pipette visent le voxel PLEIN sous la face ; poser le voisin vide
      const q = s.tool === "place"
        ? local.clone().addScaledVector(n, off)
        : local.clone().addScaledVector(n, -off);
      const vx = Math.floor((q.x + 0.5) * size);
      const vy = Math.floor((q.z + 0.5) * size); // profondeur voxel = Z monde
      const vz = Math.floor(q.y * size); // hauteur voxel = Y monde
      if (s.tool === "pick") {
        const v = m.data[vx + vy * m.sx + vz * m.sx * m.sy];
        if (v) s.setColorIdx(v);
        return;
      }
      s.editVoxel(vx, vy, vz, s.tool === "place" ? s.colorIdx : 0);
    };

    // sync mode orbit/pan
    const unsub = useVoxEdit.subscribe((s) => {
      controls.mode = s.orbit ? "orbit" : "pan";
    });

    // premier chargement : doc restauré, sinon grass-v0 32³
    const s0 = useVoxEdit.getState();
    s0.loadRecipes();
    if (!s0.model && !s0.restore()) {
      const first = LIBRARY.find((e) => e.lod === "32" && e.id === "grass-v0") ?? LIBRARY[0];
      if (first) s0.loadUrl(first.url, first.id);
    }

    return () => {
      unsub();
      controls.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // re-mesh à chaque rev / changement de vue
  useEffect(() => {
    const engine = engineRef.current;
    const m = st.model;
    if (!engine || !m) return;
    for (const mesh of meshesRef.current) {
      engine.scene.remove(mesh);
      mesh.geometry.dispose();
    }
    meshesRef.current = [];
    const { geometry } = meshVoxModel(m, Math.max(m.sx, m.sy));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const places: [number, number, number][] =
      st.view === "single" ? [[0, 0, 0]]
      : st.view === "tiling" ? ([-1, 0, 1].flatMap((gx) => [-1, 0, 1].map((gz) => [gx, 0, gz])) as [number, number, number][])
      : [[0, 0, 0], [0, 1, 0], [1, 0, 0]]; // pile : raccord vertical + voisin
    for (const [gx, gy, gz] of places) {
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(gx, gy, gz);
      engine.scene.add(mesh);
      meshesRef.current.push(mesh);
    }
    engine.invalidate();
  }, [st.rev, st.view, st.model]);

  const baseId = st.modelName.replace(/-v\d+$/, "");
  const recipe = st.recipes?.[baseId];

  return (
    <div className="vxe">
      <div className="vxe-top">
        <button onClick={() => { location.hash = ""; setScreen("title"); }}>← Titre</button>
        <strong>🧊 Éditeur voxel</strong>
        <span className="vxe-status">{st.status}</span>
        <span className="vxe-sp" />
        <button className={st.view === "single" ? "on" : ""} onClick={() => st.setView("single")}>Bloc</button>
        <button className={st.view === "tiling" ? "on" : ""} onClick={() => st.setView("tiling")}>3×3</button>
        <button className={st.view === "stack" ? "on" : ""} onClick={() => st.setView("stack")}>Pile</button>
        <span className="vxe-sp" />
        <button onClick={() => engineRef.current?.rotate(1)}>↻</button>
        <button onClick={() => engineRef.current?.rotate(-1)}>↺</button>
        <button className={st.orbit ? "on" : ""} onClick={() => st.setOrbit(!st.orbit)}>🧭 Orbite</button>
        <span className="vxe-sp" />
        <button onClick={() => setScreen("voxelbench")}>🌍 Terrain 60×60</button>
      </div>

      <div className="vxe-body">
        <div className="vxe-lib">
          <div className="vxe-lib-title">Bibliothèque</div>
          {["32", "16"].map((lod) => (
            <div key={lod}>
              <div className="vxe-lib-lod">{lod}³</div>
              {LIBRARY.filter((e) => e.lod === lod).map((e) => (
                <button
                  key={e.key}
                  className={st.modelName === e.id ? "vxe-cur" : ""}
                  onClick={() => st.loadUrl(e.url, e.id)}
                >
                  {e.id}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div ref={hostRef} className="vxe-view" />

        <div className="vxe-tools">
          <div className="vxe-sec">Outils</div>
          <div className="vxe-row">
            {(["nav", "place", "erase", "pick"] as const).map((t) => (
              <button key={t} className={st.tool === t ? "on" : ""} onClick={() => st.setTool(t)}>
                {t === "nav" ? "✋" : t === "place" ? "🧱" : t === "erase" ? "⌫" : "💉"}
              </button>
            ))}
            <button className={st.mirrorX ? "on" : ""} onClick={() => st.setMirrorX(!st.mirrorX)} title="miroir X">⇄</button>
          </div>
          <div className="vxe-row">
            <button disabled={!st.history.length} onClick={st.undo}>↩ Undo</button>
            <button disabled={!st.future.length} onClick={st.redo}>↪ Redo</button>
          </div>

          <div className="vxe-sec">Palette</div>
          <div className="vxe-pal">
            {(st.model?.palette ?? []).map((c, i) => (
              <button
                key={i}
                className={st.colorIdx === i + 1 ? "vxe-sw on" : "vxe-sw"}
                style={{ background: `rgb(${c[0]},${c[1]},${c[2]})` }}
                onClick={() => st.setColorIdx(i + 1)}
                title={`#${i + 1}`}
              />
            ))}
            <input
              type="color"
              title="ajouter une couleur"
              onChange={(e) => {
                const v = e.target.value;
                st.addColor([parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]);
              }}
            />
          </div>

          {recipe && (
            <>
              <div className="vxe-sec">Recette live · {recipe.recipe}</div>
              {Object.entries(st.recipeParams).map(([k, v]) => {
                const r = paramRange(k, v);
                return (
                  <label key={k} className="vxe-slider">
                    <span>{k} <em>{v}</em></span>
                    <input type="range" min={r.min} max={r.max} step={r.step} value={v}
                      onChange={(e) => st.setRecipeParam(k, Number(e.target.value))} />
                  </label>
                );
              })}
              <label className="vxe-slider">
                <span>seed <em>{st.recipeSeed}</em></span>
                <input type="range" min={1} max={9999} step={1} value={st.recipeSeed}
                  onChange={(e) => st.setRecipeSeed(Number(e.target.value))} />
              </label>
              <div className="vxe-row">
                {[16, 32].map((s) => (
                  <button key={s} className={st.recipeSize === s ? "on" : ""} onClick={() => st.setRecipeSize(s)}>{s}³</button>
                ))}
                <button onClick={st.regenerate}>⚗️ Régénérer</button>
              </div>
            </>
          )}

          <div className="vxe-sec">Fichier</div>
          <div className="vxe-row">
            <button onClick={st.exportVox}>💾 Exporter .vox</button>
            <button onClick={() => fileRef.current?.click()}>📂 Importer</button>
            <input ref={fileRef} type="file" accept=".vox" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) st.importVox(f); e.target.value = ""; }} />
          </div>
          <div className="vxe-hint">
            ✋ naviguer (drag pan · molette zoom) · 🧱 poser · ⌫ effacer · 💉 pipette ·
            l'export se redépose dans <code>frontend/public/voxels/</code>
          </div>
        </div>
      </div>
    </div>
  );
}
