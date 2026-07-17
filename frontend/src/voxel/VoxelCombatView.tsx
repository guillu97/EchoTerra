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
import type { Combat, CombatCurrent, CombatUnit } from "../api/types";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { useStore } from "../store";
import { VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildTerrain, type TerrainCell } from "./terrain";

class CombatWorld {
  lib = new BlockLibrary("/voxels"); // 32³ : le combat est vu de près
  libReady = false;
  terrain: THREE.Group | null = null;
  terrainKey = "";
  lookup = new Map<THREE.Object3D, TerrainCell[]>();
  overlays = new THREE.Group();
  sprites = new THREE.Group();
  unitOf = new Map<THREE.Object3D, string>(); // sprite → unitId (picking)
  textures = new Map<string, THREE.Texture>();
  fitted = false;

  combat: Combat | null = null;
  current?: CombatCurrent;
  mode = "move";

  constructor(readonly engine: VoxelEngine) {
    engine.scene.background = new THREE.Color(0x161022); // fond opaque (comme CombatScene)
    engine.scene.add(this.overlays);
    engine.scene.add(this.sprites);
    void this.lib.load(["grass", "dirt"]).then(() => {
      this.libReady = true;
      this.terrainKey = "";
      this.draw();
    });
  }
  dispose() {
    this.lib.dispose();
    for (const t of this.textures.values()) t.dispose();
  }
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

    // terrain : reconstruit par combat (les hauteurs ne bougent pas en cours)
    if (this.terrainKey !== c.id) {
      if (this.terrain) engine.scene.remove(this.terrain);
      const cells: TerrainCell[] = [];
      for (let y = 0; y < c.gridH; y++) {
        for (let x = 0; x < c.gridW; x++) {
          cells.push({ x, y, block: "grass", under: "dirt", levels: this.heightAt(x, y) + 1 });
        }
      }
      const built = buildTerrain(this.lib, cells);
      this.terrain = built.group;
      this.lookup = built.lookup;
      engine.scene.add(built.group);
      this.terrainKey = c.id;
    }

    this.overlays.clear();
    this.sprites.clear();
    this.unitOf.clear();

    const topOf = (x: number, y: number) => this.heightAt(x, y) + 1;
    const quad = (x: number, y: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.position.set(x, topOf(x, y) + 0.02, y);
      this.overlays.add(m);
    };
    const ring = (x: number, y: number, color: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.3, 0.4, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
      );
      m.position.set(x, topOf(x, y) + 0.03, y);
      this.overlays.add(m);
    };

    // cases atteignables (vert) — servies par le serveur (current.reachable)
    if (c.status === "active") {
      for (const [rx, ry] of this.current?.reachable ?? []) quad(rx, ry, 0x6ee36e, 0.5);
    }

    // unités : billboards + barre de PV (sprites face caméra)
    const targets = new Set(
      this.mode === "skill" ? this.current?.skillTargets ?? [] : this.current?.attackTargets ?? [],
    );
    for (const u of c.units) {
      if (u.hp <= 0) continue;
      if (this.current && u.id === this.current.unitId) ring(u.x, u.y, 0xffe066);
      if (targets.has(u.id)) ring(u.x, u.y, this.mode === "skill" ? 0xc06bd6 : 0xff5a4d);

      const tex =
        u.side === "hero" ? (u.appearance || heroTexKey(u.kind)) : monsterTexKey(u.kind, u.appearance);
      const url = libUrl(u.side === "hero" ? "characters" : "monsters", tex || "char-scout");
      const mat = new THREE.SpriteMaterial({ map: this.texture(url), alphaTest: 0.35, transparent: true });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.78, 0.78, 1);
      s.center.set(0.5, 0.04);
      s.position.set(u.x, topOf(u.x, u.y), u.y);
      this.sprites.add(s);
      this.unitOf.set(s, u.id);

      // barre de PV : fond sombre + remplissage coloré, toujours face caméra
      const ratio = Math.max(0, u.hp / u.maxHp);
      const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.6, transparent: true }));
      back.scale.set(0.5, 0.06, 1);
      back.position.set(u.x, topOf(u.x, u.y) + 0.92, u.y);
      this.sprites.add(back);
      const fill = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: u.side === "hero" ? 0x4be36e : 0xe24b4b, transparent: true }),
      );
      fill.scale.set(0.5 * ratio, 0.06, 1);
      fill.position.set(u.x - (0.5 * (1 - ratio)) / 2, topOf(u.x, u.y) + 0.921, u.y);
      this.sprites.add(fill);
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
      (p: { combat: Combat; current?: CombatCurrent; mode: string }) => {
        const changed = world.combat?.id !== p.combat.id;
        world.combat = p.combat;
        world.current = p.current;
        world.mode = p.mode;
        if (changed) world.fitted = false;
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
