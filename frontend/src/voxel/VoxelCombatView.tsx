// Combat iso en VOXEL (Phase 3 du VOXEL-PLAN) — même moteur que la carte.
// Contrat bus identique à CombatScene : CombatRender {combat, current, mode}
// entrant ; CombatUnitClick / CombatTileClick sortants (unités prioritaires).
// Terrain 7×7 en blocs 32³ (vue rapprochée), cases atteignables en VERT,
// unité courante cerclée jaune / cibles rouge (attaque) ou violet (skill),
// unités en billboards + barre de PV. Rotation caméra 4 orientations (FFTA2) —
// la vraie valeur du passage 3D : lire les hauteurs sous tous les angles.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { bus, EV } from "../eventBus";
import type { Combat, CombatCurrent, CombatHit, CombatThreat, CombatUnit } from "../api/types";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { useStore } from "../store";
import { clearOwned, VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildTerrain, type TerrainCell } from "./terrain";

// sol d'arène par biome (lot C1) — mêmes blocs que la carte du monde
const COMBAT_FLOOR: Record<number, { block: string; under?: string }> = {
  1: { block: "sand" },
  2: { block: "grass", under: "dirt" },
  3: { block: "forest", under: "dirt" },
  4: { block: "stone" },
  5: { block: "snow", under: "stone" },
};
const ARENA_PROP_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
// Géométries PARTAGÉES des overlays de combat (reconstruits à chaque action) —
// une géométrie par quad/anneau fuyait à chaque redraw (voir clearOwned).
const CQUAD_GEOM = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
const CRING_GEOM = new THREE.RingGeometry(0.3, 0.4, 24).rotateX(-Math.PI / 2);
const CEDGE_GEOM = new THREE.RingGeometry(0.6, 0.67, 4).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2);
import { makeLabel } from "./labels";
import { ALL_CHAR_KEYS, CharLibrary } from "./characters";

class CombatWorld {
  lib = new BlockLibrary("/voxels"); // 32³ : le combat est vu de près
  propsLib = new BlockLibrary("/voxels/props"); // obstacles/ronces de l'arène (C1)
  chars = new CharLibrary();
  charMeshes: THREE.Mesh[] = [];
  libReady = false;
  terrain: THREE.Group | null = null;
  terrainKey = "";
  lookup = new Map<THREE.Object3D, TerrainCell[]>();
  overlays = new THREE.Group();
  sprites = new THREE.Group();
  fx = new THREE.Group(); // étiquettes flottantes (C2) — survivent aux redraws
  unitOf = new Map<THREE.Object3D, string>(); // sprite → unitId (picking)
  textures = new Map<string, THREE.Texture>();
  fitted = false;

  combat: Combat | null = null;
  current?: CombatCurrent;
  mode = "move";
  threats: CombatThreat[] = []; // cases menacées par ennemi (télégraphie C2)
  threatUnitId?: string;
  lastSeq = -1; // dernier combat.seq animé (diff → dégâts flottants)
  private fxAnims: { sprite: THREE.Sprite; x: number; y0: number; z: number; start: number; dur: number }[] = [];
  private fxRaf = 0;

  constructor(readonly engine: VoxelEngine) {
    engine.enableLighting({ shadowSpan: 9 }); // arène 7×7 : ombres serrées et nettes
    engine.scene.background = new THREE.Color(0x161022); // fond opaque (comme CombatScene)
    engine.scene.add(this.overlays);
    engine.scene.add(this.sprites);
    engine.scene.add(this.fx);
    void this.propsLib
      .load(["rock", "tree-green", "ice-spike", "brambles"])
      .then(() => { this.terrainKey = ""; this.draw(); });
    void this.lib.load(["grass", "dirt", "sand", "forest", "stone", "snow", "water", "ice"]).then(() => {
      this.libReady = true;
      this.terrainKey = "";
      this.draw();
    });
    void this.chars.load(ALL_CHAR_KEYS).then(() => this.draw());
    engine.onFrame = () => {
      for (const m of this.charMeshes) m.rotation.y = engine.azimuthNow;
    };
  }
  dispose() {
    if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
    this.lib.dispose();
    this.chars.dispose();
    for (const t of this.textures.values()) t.dispose();
  }

  // Dégâts flottants (lot C2) : une étiquette « −7 » par coup, qui monte et
  // s'estompe ~900 ms au-dessus de l'unité touchée. Les coups multiples sur la
  // même unité sont décalés (délai + jitter) pour rester lisibles.
  spawnHits(hits: CombatHit[]) {
    const c = this.combat;
    if (!c || !hits.length) return;
    const now = performance.now();
    const perUnit = new Map<string, number>();
    for (const h of hits) {
      const u = c.units.find((x) => x.id === h.unitId);
      if (!u) continue;
      const n = perUnit.get(h.unitId) ?? 0;
      perUnit.set(h.unitId, n + 1);
      const color = h.kind === "heal" ? "#5df08a" : h.kind === "hazard" ? "#ffb35e" : "#ff6b5e";
      const text = (h.kind === "heal" ? "+" : "−") + h.amount;
      const sprite = makeLabel(text, color, 0.34);
      const x = u.x + (n % 2 === 0 ? -0.12 : 0.12) * (n > 0 ? 1 : 0);
      const y0 = this.heightAt(u.x, u.y) + 2.0;
      sprite.position.set(x, y0, u.y);
      sprite.material.opacity = 0;
      this.fx.add(sprite);
      this.fxAnims.push({ sprite, x, y0, z: u.y, start: now + n * 220, dur: 900 });
    }
    if (!this.fxRaf && this.fxAnims.length) this.tickFx();
  }

  private tickFx = () => {
    const now = performance.now();
    const keep: typeof this.fxAnims = [];
    for (const a of this.fxAnims) {
      const t = (now - a.start) / a.dur;
      if (t < 0) {
        keep.push(a);
        continue; // pas encore parti (coup décalé)
      }
      if (t >= 1) {
        this.fx.remove(a.sprite);
        a.sprite.material.dispose();
        continue;
      }
      a.sprite.position.set(a.x, a.y0 + t * 0.9, a.z);
      // pop d'apparition puis fondu sur la fin de la montée
      a.sprite.material.opacity = t < 0.12 ? t / 0.12 : t > 0.55 ? 1 - (t - 0.55) / 0.45 : 1;
      keep.push(a);
    }
    this.fxAnims = keep;
    this.engine.invalidate();
    this.fxRaf = this.fxAnims.length ? requestAnimationFrame(this.tickFx) : 0;
  };
  texture(url: string): THREE.Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = new THREE.TextureLoader().load(url, () => this.engine.invalidate());
      t.colorSpace = THREE.NoColorSpace;
      this.textures.set(url, t);
    }
    return t;
  }

  private heightAt(x: number, y: number): number {
    const c = this.combat;
    return c ? c.heights[y * c.gridW + x] || 0 : 0;
  }

  onTap(cssX: number, cssY: number) {
    const c = this.combat;
    if (!c || c.status !== "active") return;
    const hits = this.engine.pick(cssX, cssY);
    for (const h of hits) {
      const unitId = this.unitOf.get(h.object);
      if (unitId) {
        bus.emit(EV.CombatUnitClick, { unitId });
        return;
      }
      const cells = this.lookup.get(h.object);
      if (cells && h.instanceId !== undefined) {
        const cell = cells[h.instanceId];
        bus.emit(EV.CombatTileClick, { x: cell.x, y: cell.y });
        return;
      }
    }
  }

  draw() {
    const c = this.combat;
    const engine = this.engine;
    if (!c || !this.libReady) return;

    // terrain : reconstruit par combat — ARÈNE PAR BIOME (lot C1) : sol du
    // biome, colonnes d'eau, plaques de glace ; obstacles/ronces en props
    if (this.terrainKey !== c.id) {
      if (this.terrain) engine.scene.remove(this.terrain);
      const floor = COMBAT_FLOOR[c.biome] ?? COMBAT_FLOOR[2];
      const cellAt = (x: number, y: number) => c.cells?.[y * c.gridW + x];
      const cells: TerrainCell[] = [];
      for (let y = 0; y < c.gridH; y++) {
        for (let x = 0; x < c.gridW; x++) {
          const cc = cellAt(x, y);
          let block = floor.block;
          if (cc?.hazard === "water") block = "water";
          else if (cc?.hazard === "ice") block = "ice";
          cells.push({ x, y, block, under: floor.under, levels: this.heightAt(x, y) + 1 });
        }
      }
      const built = buildTerrain(this.lib, cells);
      this.terrain = built.group;
      this.lookup = built.lookup;
      // obstacles (rocher/arbre/pic selon biome) et ronces posés SUR les cases
      const obstacleId = c.biome === 3 || c.biome === 2 ? "tree-green" : c.biome === 5 ? "ice-spike" : "rock";
      for (let y = 0; y < c.gridH; y++) {
        for (let x = 0; x < c.gridW; x++) {
          const cc = cellAt(x, y);
          const propId = cc?.blocked ? obstacleId : cc?.hazard === "brambles" ? "brambles" : null;
          if (!propId) continue;
          const geom = this.propsLib.get(propId, (x * 7 + y * 13) % 3);
          if (!geom) continue;
          const mesh = new THREE.Mesh(geom, ARENA_PROP_MAT);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.position.set(x, this.heightAt(x, y) + 1 - 0.02, y);
          mesh.rotation.y = ((x * 31 + y * 17) % 4) * (Math.PI / 2);
          mesh.scale.setScalar(cc?.blocked ? 0.95 : 0.8);
          built.group.add(mesh);
        }
      }
      engine.scene.add(built.group);
      this.terrainKey = c.id;
    }

    clearOwned(this.overlays);
    clearOwned(this.sprites);
    this.unitOf.clear();
    this.charMeshes = [];

    const topOf = (x: number, y: number) => this.heightAt(x, y) + 1;
    const quad = (x: number, y: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        CQUAD_GEOM,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.userData.ownMat = true;
      m.position.set(x, topOf(x, y) + 0.02, y);
      this.overlays.add(m);
    };
    const ring = (x: number, y: number, color: number) => {
      const m = new THREE.Mesh(
        CRING_GEOM,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
      );
      m.userData.ownMat = true;
      m.position.set(x, topOf(x, y) + 0.03, y);
      this.overlays.add(m);
    };

    // cases atteignables — servies par le serveur (current.reachable). Vert franc
    // + liseré sombre : le quad 0x6ee36e à 0.5 se noyait dans l'herbe claire.
    if (c.status === "active") {
      for (const [rx, ry] of this.current?.reachable ?? []) {
        quad(rx, ry, 0x1fb63c, 0.62);
        const edge = new THREE.Mesh(
          CEDGE_GEOM,
          new THREE.MeshBasicMaterial({ color: 0x0c5c1d, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        edge.userData.ownMat = true;
        edge.position.set(rx, topOf(rx, ry) + 0.025, ry);
        this.overlays.add(edge);
      }
    }

    // télégraphie (lot C2) : les cases menacées par l'ennemi sélectionné (tap
    // sur l'unité) en ORANGE — servies par le serveur, le client n'évalue rien.
    if (c.status === "active" && this.threatUnitId) {
      const threat = this.threats.find((t) => t.unitId === this.threatUnitId);
      for (const [tx, ty] of threat?.cells ?? []) quad(tx, ty, 0xff8c3b, 0.48);
    }

    // unités : billboards + barre de PV (sprites face caméra)
    const targets = new Set(
      this.mode === "skill"
        ? this.current?.skillTargets ?? []
        : this.mode === "push"
          ? this.current?.pushTargets ?? []
          : this.current?.attackTargets ?? [],
    );
    for (const u of c.units) {
      if (u.hp <= 0 || u.fled) continue; // les fuyards ont quitté l'arène (C3)
      if (this.current && u.id === this.current.unitId) ring(u.x, u.y, 0xffe066);
      if (u.id === this.threatUnitId) ring(u.x, u.y, 0xff8c3b);
      if (targets.has(u.id))
        ring(u.x, u.y, this.mode === "skill" ? 0xc06bd6 : this.mode === "push" ? 0x4bc8e3 : 0xff5a4d);

      const tex =
        u.side === "hero" ? (u.appearance || heroTexKey(u.kind)) : monsterTexKey(u.kind, u.appearance);
      // modèle voxel (héros ET monstres) si disponible — tourne avec la caméra
      const mesh = tex ? this.chars.make(tex) : undefined;
      if (mesh) {
        mesh.position.set(u.x, topOf(u.x, u.y), u.y);
        mesh.rotation.y = this.engine.azimuthNow;
        this.sprites.add(mesh);
        this.charMeshes.push(mesh);
        this.unitOf.set(mesh, u.id);
      } else {
        const url = libUrl(u.side === "hero" ? "characters" : "monsters", tex || "char-scout");
        const mat = new THREE.SpriteMaterial({ map: this.texture(url), alphaTest: 0.35, transparent: true });
        const s = new THREE.Sprite(mat);
        s.userData.ownMat = true;
        s.scale.set(0.7, 0.7, 1);
        s.center.set(0.5, 0.04);
        s.position.set(u.x, topOf(u.x, u.y), u.y);
        this.sprites.add(s);
        this.unitOf.set(s, u.id);
      }

      // barre de PV : fond sombre + remplissage coloré, toujours face caméra
      const ratio = Math.max(0, u.hp / u.maxHp);
      const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.6, transparent: true }));
      back.userData.ownMat = true;
      back.scale.set(0.5, 0.06, 1);
      back.position.set(u.x, topOf(u.x, u.y) + 0.8, u.y);
      this.sprites.add(back);
      const fill = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: u.side === "hero" ? 0x4be36e : 0xe24b4b, transparent: true }),
      );
      fill.userData.ownMat = true;
      fill.scale.set(0.5 * ratio, 0.06, 1);
      fill.position.set(u.x - (0.5 * (1 - ratio)) / 2, topOf(u.x, u.y) + 0.801, u.y);
      this.sprites.add(fill);

      // nom (+ états) sous l'unité, comme CombatScene
      const short = u.name.length > 10 ? u.name.slice(0, 9) + "…" : u.name;
      const lbl = makeLabel(short, "#e8e8f0", 0.17);
      lbl.center.set(0.5, 1);
      lbl.position.set(u.x, topOf(u.x, u.y) - 0.06, u.y);
      this.sprites.add(lbl);
      if (u.states.length) {
        const st = makeLabel(u.states.join(","), "#ffd166", 0.15);
        st.center.set(0.5, 1);
        st.position.set(u.x, topOf(u.x, u.y) - 0.26, u.y);
        this.sprites.add(st);
      }
    }

    if (!this.fitted) {
      engine.target.set((c.gridW - 1) / 2, 0.4, (c.gridH - 1) / 2);
      engine.zoom = 64;
      this.fitted = true;
    }
    engine.invalidate();
  }
}

export function VoxelCombatView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.minZoom = 30;
    engine.maxZoom = 160;
    const controls = new VoxelControls(engine);
    const world = new CombatWorld(engine);
    controls.onTap = (t) => world.onTap(t.cssX, t.cssY);

    const off = bus.on(
      EV.CombatRender,
      (p: {
        combat: Combat;
        current?: CombatCurrent;
        mode: string;
        threats?: CombatThreat[];
        threatUnitId?: string;
      }) => {
        const changed = world.combat?.id !== p.combat.id;
        world.combat = p.combat;
        world.current = p.current;
        world.mode = p.mode;
        world.threats = p.threats ?? [];
        world.threatUnitId = p.threatUnitId;
        if (changed) {
          world.fitted = false;
          world.lastSeq = p.combat.seq; // ne pas rejouer les coups d'un combat rechargé
        } else if (p.combat.seq !== world.lastSeq) {
          world.lastSeq = p.combat.seq;
          world.spawnHits(p.combat.lastHits ?? []);
        }
        world.draw();
      },
    );
    // au montage (le view vient de passer en combat) : demander l'état courant
    useStore.getState().syncScene();

    if (import.meta.env.DEV) (window as unknown as { __vc?: unknown }).__vc = { engine, world };
    return () => {
      off();
      controls.dispose();
      world.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button className="small" style={rotBtn} onClick={() => engineRef.current?.rotate(-1)}>↺</button>
        <button className="small" style={rotBtn} onClick={() => engineRef.current?.rotate(1)}>↻</button>
      </div>
    </>
  );
}

const rotBtn: React.CSSProperties = {
  background: "rgba(30,34,46,.78)",
  color: "#f3efdf",
  border: "1px solid rgba(255,255,255,.25)",
  borderRadius: 10,
  width: 40,
  height: 40,
  fontSize: 19,
  cursor: "pointer",
};
