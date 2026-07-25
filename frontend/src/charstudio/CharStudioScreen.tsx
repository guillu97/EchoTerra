// Studio Personnages (dev tool — hash #charstudio, bouton titre 🎭) : visualiser,
// designer et ANIMER les personnages/monstres voxel avec le VRAI code du jeu
// (splitRig/buildRig/applyAnim — ce qu'on voit ici est ce qui joue en partie).
// Deux sources : les .vox du jeu (public/voxels/chars/) ou la RECETTE LIVE
// (char-recipe/monster-recipe importées directement — éditer la recette sous
// Vite HMR met à jour le modèle) avec palettes éditables (départ fidèle :
// palettes.json extrait par scripts/voxel/gen-palettes.mjs) et export .vox.

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useStore } from "../store";
import { VoxelEngine } from "../voxel/engine";
import { VoxelControls } from "../voxel/controls";
import { fetchVox, type VoxModel } from "../voxel/vox";
import { HERO_HEIGHT } from "../voxel/characters";
import {
  splitRig, buildRig, applyAnim, disposeRiggedGeom,
  type Rig, type RiggedGeom, type AnimState,
} from "../voxel/rig";
import { generateCharacter, type CharPalette } from "../voxel/shared/char-recipe.mjs";
import { generateMonster } from "../voxel/shared/monster-recipe.mjs";
import { encodeVox } from "../voxel/shared/vox-format.mjs";
import DEFAULT_PALETTES from "./palettes.json";
import "./charstudio.css";

// ---- catalogue -------------------------------------------------------------
const HEROES: [string, string][] = [
  ["char-builder", "Pionnier"],
  ["char-archer", "Chasseur"],
  ["char-scout", "Éclaireur"],
  ["char-knight", "Gardien"],
  ["char-merchant", "Récupérateur"],
  ["char-healer", "Herboriste"],
  ["char-wizard", "Mage (défaut)"],
];
const MONSTERS: [string, string][] = [
  ["mob-slime", "Slime Vorace"],
  ["mob-goblin", "Gobelin Pillard"],
  ["mob-windelemental", "Élém. de Vent"],
  ["mob-bat", "Chauve-souris"],
  ["mob-ghost", "Harpie"],
  ["mob-mushroomling", "Dryade"],
  ["mob-spider", "Araignée"],
  ["mob-wolf", "Loup-garou"],
  ["mob-orc", "Roi Gobelin"],
];

type Palette = Record<string, number[]>;
const PALETTES = DEFAULT_PALETTES as Record<string, Palette>;
const ROLE_LABELS: Record<string, string> = {
  skin: "Peau", hair: "Cheveux", outfit: "Tenue", outfit2: "Tenue 2",
  accent: "Accent", body: "Corps",
};
const clonePal = (p: Palette): Palette =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, [...v]]));
const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const fromHex = (h: string): number[] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// couleurs de la vue « parties » (rig) : corps neutre, membres codés par rôle+côté
function partColor(role: string, side: number): number {
  if (role === "arm") return side < 0 ? 0xe8963c : 0xffc46b;
  if (role === "wing") return side < 0 ? 0xb07fe8 : 0xd3aef7;
  return side < 0 ? 0x4e8bd8 : 0x79c0ff; // jambes/pattes
}

/** (Ré)assigne les matériaux du rig : normal (couleurs des voxels) ou vue
 *  « parties » (corps gris + membres codés). Toujours des matériaux POSSÉDÉS
 *  par le studio (dispose des précédents) — évite de toucher au matériau
 *  partagé du module rig. */
function setStudioMats(rig: Rig, parts: boolean) {
  const assign = (mesh: THREE.Mesh, mat: THREE.Material) => {
    if (mesh.userData.csMat) (mesh.material as THREE.Material).dispose();
    mesh.material = mat;
    mesh.userData.csMat = true;
  };
  for (const c of rig.tilt.children) {
    const m = c as THREE.Mesh;
    if (m.isMesh) assign(m, parts
      ? new THREE.MeshLambertMaterial({ color: 0x8b93a5 })
      : new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
  for (const l of rig.limbGroups) {
    const m = l.group.children[0] as THREE.Mesh;
    if (m?.isMesh) assign(m, parts
      ? new THREE.MeshLambertMaterial({ color: partColor(l.role, l.side) })
      : new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
}

function disposeRig(rig: Rig) {
  rig.root.parent?.remove(rig.root);
  rig.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.userData.csMat) (m.material as THREE.Material).dispose();
  });
}

// durées des one-shots (secondes) — mêmes valeurs que UnitAnimator
const SHOT_DUR: Record<string, number> = { attack: 0.45, skill: 0.7, hit: 0.3 };
const DEATH_S = 0.85; // UnitAnimator.DEATH_MS
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

type Base = "idle" | "walk";
type Shot = "attack" | "skill" | "hit";
type AnimSel = Base | Shot | "death";

export function CharStudioScreen() {
  const setScreen = useStore((s) => s.setScreen);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const rigRef = useRef<Rig | null>(null);
  const geomRef = useRef<RiggedGeom | null>(null);
  const modelRef = useRef<VoxModel | null>(null);
  const pivotsRef = useRef<THREE.Group | null>(null);
  const partsRef = useRef(false);
  // état d'animation piloté par la boucle rAF (hors React)
  const animRef = useRef({
    base: "idle" as Base, shot: null as Shot | null, shotT: 0, clock: 0,
    dying: null as { t: number; mats: THREE.Material[] } | null,
    last: 0, speed: 1, turntable: false,
  });

  const [key, setKey] = useState("char-knight");
  const [source, setSource] = useState<"vox" | "recipe">("vox");
  const [palette, setPalette] = useState<Palette>(() => clonePal(PALETTES["char-knight"] ?? {}));
  const [partsView, setPartsView] = useState(false);
  const [animSel, setAnimSel] = useState<AnimSel>("idle");
  const [speed, setSpeed] = useState(1);
  const [turntable, setTurntable] = useState(false);
  const [info, setInfo] = useState({ dims: "", voxels: 0, kind: "", weapon: "", limbs: "" });
  const [hud, setHud] = useState({ calls: 0, triangles: 0, ms: 0 });

  // ---- moteur (une fois) ---------------------------------------------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.minZoom = 40;
    engine.maxZoom = 2400;
    engine.zoom = Math.min(host.clientWidth, host.clientHeight) * 0.85;
    engine.target.set(0, HERO_HEIGHT * 0.45, 0);
    engine.elevation = 0.38;
    engine.enableLighting({ shadowSpan: 3 });
    const controls = new VoxelControls(engine);
    controls.mode = "orbit";

    // plateau d'exposition
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x262b36 }),
    );
    ground.position.y = -0.062;
    ground.receiveShadow = true;
    const plat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.62, 0.06, 48),
      new THREE.MeshLambertMaterial({ color: 0x8a7a5c }),
    );
    plat.position.y = -0.03;
    plat.receiveShadow = true;
    const grass = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 48).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x79b356 }),
    );
    grass.position.y = 0.002;
    grass.receiveShadow = true;
    engine.scene.add(ground, plat, grass);
    engine.onFrame = (f) => setHud(f);

    // boucle d'animation : le VRAI applyAnim du jeu, vitesse réglable
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const a = animRef.current;
      const dt = Math.min(0.1, (now - (a.last || now)) / 1000) * a.speed;
      a.last = now;
      a.clock += dt;
      if (a.turntable) engine.orbitBy(dt * 0.45, 0);
      const rig = rigRef.current;
      if (!rig) { if (a.turntable) engine.invalidate(); return; }
      if (a.dying) {
        // même chorégraphie que UnitAnimator.playDeath, puis retour idle
        a.dying.t += dt;
        const p = a.dying.t / DEATH_S;
        if (p >= 1.45) {
          for (const m of a.dying.mats) m.dispose();
          a.dying = null;
          setStudioMats(rig, partsRef.current);
          rig.root.position.y = 0;
          setAnimSel(a.base);
        } else {
          const q = Math.min(1, p);
          const e = easeInOut(Math.min(1, q * 1.3));
          rig.tilt.position.set(0, 0, 0);
          rig.tilt.scale.set(1, 1, 1);
          rig.tilt.rotation.set(-(Math.PI / 2) * e, 0, 0);
          rig.root.position.y = -0.12 * e;
          for (const m of a.dying.mats) (m as THREE.MeshLambertMaterial).opacity = 1 - q;
          engine.invalidate();
          return;
        }
      }
      let state: AnimState = a.base;
      let t = a.clock;
      if (a.shot) {
        a.shotT += dt;
        if (a.shotT >= SHOT_DUR[a.shot]) { a.shot = null; setAnimSel(a.base); }
        else { state = a.shot; t = a.shotT; }
      }
      applyAnim(rig, state, t, a.clock, 1);
      engine.invalidate();
    };
    raf = requestAnimationFrame(tick);

    engine.invalidate();
    return () => {
      cancelAnimationFrame(raf);
      controls.dispose();
      if (rigRef.current) disposeRig(rigRef.current);
      if (geomRef.current) disposeRiggedGeom(geomRef.current);
      rigRef.current = null;
      geomRef.current = null;
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // ---- (re)construction du modèle -----------------------------------------
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let stale = false;
    (async () => {
      let model: VoxModel;
      try {
        if (source === "vox") {
          model = await fetchVox(`/voxels/chars/${key}.vox`);
        } else {
          model = key.startsWith("char-")
            ? generateCharacter(key, palette as unknown as CharPalette)
            : generateMonster(key, palette as { body: number[]; accent: number[] });
        }
      } catch {
        return; // .vox manquant / recette inconnue : on garde le modèle courant
      }
      if (stale) return;
      // remplacer rig + géométries
      const a = animRef.current;
      if (a.dying) { for (const m of a.dying.mats) m.dispose(); a.dying = null; }
      if (rigRef.current) disposeRig(rigRef.current);
      if (geomRef.current) disposeRiggedGeom(geomRef.current);
      modelRef.current = model;
      const rg = splitRig(model, key, HERO_HEIGHT);
      const rig = buildRig(rg);
      setStudioMats(rig, partsRef.current);
      engine.scene.add(rig.root);
      geomRef.current = rg;
      rigRef.current = rig;
      syncPivots();
      let voxels = 0;
      for (let i = 0; i < model.data.length; i++) if (model.data[i]) voxels++;
      setInfo({
        dims: `${model.sx}×${model.sy}×${model.sz}`,
        voxels,
        kind: rg.kind,
        weapon: key.startsWith("char-") ? rg.weapon : "",
        limbs: rg.limbs.map((l) => l.name).join(", ") || "aucun (corps entier)",
      });
      engine.invalidate();
    })();
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, source, palette]);

  // ---- vue « parties » : recolore + billes de pivots ----------------------
  const syncPivots = useCallback(() => {
    const rig = rigRef.current;
    const engine = engineRef.current;
    if (!rig || !engine) return;
    if (pivotsRef.current) {
      pivotsRef.current.parent?.remove(pivotsRef.current);
      pivotsRef.current.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
      });
      pivotsRef.current = null;
    }
    if (partsRef.current) {
      const g = new THREE.Group();
      for (const l of rig.limbGroups) {
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(0.045, 12, 10),
          new THREE.MeshBasicMaterial({ color: 0xff4d6d, depthTest: false }),
        );
        s.renderOrder = 10;
        s.position.copy(l.group.position);
        g.add(s);
      }
      rig.tilt.add(g);
      pivotsRef.current = g;
    }
  }, []);

  useEffect(() => {
    partsRef.current = partsView;
    const rig = rigRef.current;
    if (rig && !animRef.current.dying) setStudioMats(rig, partsView);
    syncPivots();
    engineRef.current?.invalidate();
  }, [partsView, syncPivots]);

  // ---- actions -------------------------------------------------------------
  const selectKey = useCallback((k: string) => {
    setKey(k);
    setPalette(clonePal(PALETTES[k] ?? {}));
  }, []);

  const play = useCallback((sel: AnimSel) => {
    const a = animRef.current;
    const rig = rigRef.current;
    if (a.dying) return; // laisser finir la mort
    if (sel === "idle" || sel === "walk") {
      a.base = sel;
      a.shot = null;
    } else if (sel === "death") {
      if (!rig) return;
      const mats: THREE.Material[] = [];
      rig.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh && m.material) {
          const c = (m.material as THREE.MeshLambertMaterial).clone();
          c.transparent = true;
          if (m.userData.csMat) (m.material as THREE.Material).dispose();
          m.material = c;
          m.userData.csMat = false; // les clones de mort sont gérés par dying.mats
          mats.push(c);
        }
      });
      a.dying = { t: 0, mats };
    } else {
      a.shot = sel;
      a.shotT = 0;
    }
    setAnimSel(sel);
  }, []);

  const setRole = useCallback((role: string, hex: string) => {
    setPalette((p) => ({ ...p, [role]: fromHex(hex) }));
    setSource("recipe"); // éditer une couleur bascule sur la recette live
  }, []);

  const exportVox = useCallback(() => {
    const model = modelRef.current;
    if (!model) return;
    const bytes = encodeVox(model as unknown as Parameters<typeof encodeVox>[0]);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${key}.vox`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [key]);

  useEffect(() => { animRef.current.speed = speed; }, [speed]);
  useEffect(() => { animRef.current.turntable = turntable; }, [turntable]);

  // hook DEV : piloter le studio depuis la console / un navigateur headless
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __cs?: unknown }).__cs = {
      engine: engineRef.current,
      select: selectKey,
      play,
      setSource,
      setParts: setPartsView,
      setSpeed,
      setTurntable,
      state: () => ({ key, source, animSel, partsView, palette }),
    };
  }, [selectKey, play, key, source, animSel, partsView, palette]);

  const roles = Object.keys(palette);
  const animBtns: [AnimSel, string][] = [
    ["idle", "🧍 Idle"], ["walk", "🚶 Marche"], ["attack", "⚔️ Attaque"],
    ["skill", "✨ Compétence"], ["hit", "💥 Touché"], ["death", "💀 Mort"],
  ];

  return (
    <div className="charstudio">
      <div className="cs-top">
        <button onClick={() => { location.hash = ""; setScreen("title"); }}>← Retour</button>
        <div className="cs-title">🎭 Studio Personnages</div>
        <button className={source === "vox" ? "on" : ""} onClick={() => setSource("vox")}>🎮 .vox du jeu</button>
        <button className={source === "recipe" ? "on" : ""} onClick={() => setSource("recipe")}>🧪 Recette live</button>
        <button className={partsView ? "on" : ""} onClick={() => setPartsView(!partsView)}>🦴 Parties</button>
        <button className={turntable ? "on" : ""} onClick={() => setTurntable(!turntable)}>🔄 Tourne</button>
        <button onClick={exportVox}>⬇ .vox</button>
      </div>

      <div className="cs-list">
        {/* mobile : la liste en colonne ne tient pas — dropdown natif à la place */}
        <select className="cs-select" value={key} onChange={(e) => selectKey(e.target.value)}>
          <optgroup label="Héros">
            {HEROES.map(([k, label]) => <option key={k} value={k}>{label} ({k.replace("char-", "")})</option>)}
          </optgroup>
          <optgroup label="Monstres">
            {MONSTERS.map(([k, label]) => <option key={k} value={k}>{label} ({k.replace("mob-", "")})</option>)}
          </optgroup>
        </select>
        <div className="cs-group">Héros</div>
        {HEROES.map(([k, label]) => (
          <button key={k} className={k === key ? "on" : ""} onClick={() => selectKey(k)}>
            <span className="cs-key">{k.replace("char-", "")}</span> {label}
          </button>
        ))}
        <div className="cs-group">Monstres</div>
        {MONSTERS.map(([k, label]) => (
          <button key={k} className={k === key ? "on" : ""} onClick={() => selectKey(k)}>
            <span className="cs-key">{k.replace("mob-", "")}</span> {label}
          </button>
        ))}
      </div>

      <div ref={hostRef} className="cs-viewport" />

      <div className="cs-side">
        <div className="cs-panel">
          <div className="cs-h">Palette {source === "vox" && <em>(éditer ⇒ recette live)</em>}</div>
          {roles.map((r) => (
            <label key={r} className="cs-color">
              <input type="color" value={toHex(palette[r])} onChange={(e) => setRole(r, e.target.value)} />
              {ROLE_LABELS[r] ?? r}
            </label>
          ))}
          <button className="cs-reset" onClick={() => setPalette(clonePal(PALETTES[key] ?? {}))}>↺ Palette du jeu</button>
        </div>
        <div className="cs-panel cs-info">
          <div className="cs-h">Modèle</div>
          <div>{key} · {info.dims} · {info.voxels.toLocaleString()} voxels</div>
          <div>rig <b>{info.kind}</b>{info.weapon && <> · arme <b>{info.weapon}</b></>}</div>
          <div>membres : {info.limbs}</div>
          <div className="cs-hud">draw {hud.calls} · tris {hud.triangles.toLocaleString()} · {hud.ms.toFixed(1)} ms</div>
        </div>
      </div>

      <div className="cs-bottom">
        {animBtns.map(([sel, label]) => (
          <button key={sel} className={animSel === sel ? "on" : ""} onClick={() => play(sel)}>{label}</button>
        ))}
        <label className="cs-speed">
          ⏱ ×{speed.toFixed(2)}
          <input type="range" min={0.25} max={2} step={0.25} value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
      </div>
    </div>
  );
}
