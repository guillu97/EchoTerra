// Onglet Map en VOXEL (Phase 2 du VOXEL-PLAN) — remplaçant expérimental de la
// MapScene Phaser derrière le réglage `settings.voxelMap`. Il parle EXACTEMENT
// le même contrat bus que MapScene (MapRender entrant ; MapTileClick /
// MapHeroClick / MapHeroMenu sortants ; MapSceneReady au montage) : le reste de
// l'app — menu radial, TopBar, store — ne sait pas quel renderer tourne.
//
// Terrain : InstancedMesh des blocs 16³ (LOD carte), brume voxel sur les tuiles
// non découvertes (fog SERVEUR, inchangé), re-instancié quand la découverte
// évolue. Sélection/losanges/danger = quads posés sur les faces. Héros/monstres
// = billboards (sprites chibi existants — étape persos 1) ; les héros en ville
// sont "dans les murs" (masqués), ceux des autres joueurs translucides.
// Déplacement SANS animation : positions snap sur l'état serveur.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { bus, EV } from "../eventBus";
import type { GameState, Hero } from "../api/types";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildTerrain, type TerrainCell } from "./terrain";
import { SmoothTerrain } from "./smoothTerrain";
import { PROP_KEYS, scatterProps } from "./scatter";
import { buildCascade, findCascadeSite, type Cascade } from "./cascade";
import { ALL_CHAR_KEYS, CharLibrary } from "./characters";
import { makeLabel } from "./labels";
import { heroTexKey as heroKey } from "../assets";
import { useStore } from "../store";

const GROUND_LEVEL = 3; // même convention que MapScene : plaines = niveau 0
const BIOME_BLOCKS = ["water", "sand", "grass", "forest", "stone", "snow"];
const UNDER_BLOCKS: Record<string, string | undefined> = { forest: "dirt", snow: "stone" };
const OTHER_ALPHA = 0.45;

function renderHeight(t: { biome: number; height: number }): number {
  if (t.biome <= 2) return 0; // eau/sable/herbe plates
  return Math.max(0, t.height - GROUND_LEVEL);
}

class MapWorld {
  lib = new BlockLibrary("/voxels/16");
  chars = new CharLibrary(); // modèles voxel des héros (fallback billboard)
  charMeshes: THREE.Mesh[] = []; // orientés face caméra à chaque frame
  libReady = false;
  terrain: THREE.Group | null = null;
  terrainKey = "";
  // terrain CONTINU (settings.voxelSmooth) : surface lissée + brume en blocs
  smooth = new SmoothTerrain();
  smoothMode = true;
  palettes: Record<string, { palette: { top: number[][] } }> | null = null;
  // props diorama (arbres-boules, rochers) scatter sur la surface lissée
  propsLib = new BlockLibrary("/voxels/props");
  props: THREE.Group | null = null;
  // vie ambiante (lot D3) : sous-groupes bascule jour/crépuscule sur le cycle solaire
  dayProps: THREE.Group | null = null;
  nightProps: THREE.Group | null = null;
  lastDayTime = 0.35;
  // aigle landmark (lot D4) : tournoie au-dessus de son pic à chaque tick solaire
  eagle: { mesh: THREE.InstancedMesh; x: number; z: number; h: number; scale: number; angle: number } | null = null;
  // cascade (lot D4) : rideau shader sur une falaise bord d'eau, 1/carte si la géo s'y prête
  cascade: Cascade | null = null;
  lookup = new Map<THREE.Object3D, TerrainCell[]>();
  overlays = new THREE.Group(); // losanges/danger/anneau — reconstruits à chaque render
  sprites = new THREE.Group(); // billboards héros/monstres/ville
  textures = new Map<string, THREE.Texture>();
  fitted = false;

  game: GameState | null = null;
  selectedHeroId?: string;
  myHeroIds: string[] = [];
  showOthers = true;

  constructor(readonly engine: VoxelEngine) {
    engine.enableLighting({ shadowSpan: 45 }); // passe beauté : lumière pastel + ombres
    engine.scene.add(this.overlays);
    engine.scene.add(this.sprites);
    void this.lib
      .load([...BIOME_BLOCKS, "mist", "mistbase", "dirt"])
      .then(() => {
        this.libReady = true;
        this.terrainKey = ""; // forcer la construction maintenant que les blocs sont là
        this.draw();
      });
    void this.chars.load(ALL_CHAR_KEYS).then(() => this.draw());
    // palettes des biomes (mêmes teintes que les blocs) pour la surface lissée
    void fetch("/voxels/palettes.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { this.palettes = p; this.terrainKey = ""; this.draw(); })
      .catch(() => undefined);
    void this.propsLib.load(PROP_KEYS).then(() => {
      this.terrainKey = "";
      this.draw();
    });
    // les modèles voxel tournent avec la caméra (rotation animée incluse) ;
    // le shader d'eau avance son temps sur chaque frame RENDUE
    engine.onFrame = () => {
      for (const m of this.charMeshes) m.rotation.y = engine.azimuthNow;
      this.smooth.setTime(performance.now() / 1000);
      this.cascade?.setTime(performance.now() / 1000);
    };
  }

  /** progression 0..1 vers la prochaine vague — pilote le cycle solaire */
  waveProgress(): number {
    const g = this.game;
    if (!g?.nextWaveAt) return 0.35;
    const next = new Date(g.nextWaveAt).getTime();
    const last = g.lastWave?.at ? new Date(g.lastWave.at).getTime() : NaN;
    const period = Number.isFinite(last) && next > last ? next - last : 600_000;
    const remaining = Math.max(0, next - Date.now());
    return Math.min(1, Math.max(0, 1 - remaining / period));
  }

  dispose() {
    this.lib.dispose();
    this.chars.dispose();
    this.smooth.dispose();
    this.propsLib.dispose();
    this.cascade?.dispose();
    for (const t of this.textures.values()) t.dispose();
  }

  // Scatter des props (mode lisse) : tables par biome + règles « près de » et
  // repères par seed dans le module partagé scatter.ts (miroir au banc). Ici on
  // ne fait que poser les placements sur la surface lissée et instancier.
  private buildProps(game: GameState): THREE.Group {
    const items = new Map<string, { mats: THREE.Matrix4[]; phase?: "day" | "night" }>();
    const placements = scatterProps({
      width: game.width, height: game.height, tiles: game.tiles,
      townX: game.town.x, townY: game.town.y, seedStr: game.id,
    });
    for (const p of placements) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, this.smooth.heightAt(p.x, p.y) - 0.02, p.y),
        new THREE.Quaternion().setFromAxisAngle(UP, p.rot),
        new THREE.Vector3(p.scale, p.scale, p.scale),
      );
      const key = `${p.id}-v${p.v}`;
      let e = items.get(key);
      if (!e) items.set(key, (e = { mats: [], phase: p.phase }));
      e.mats.push(m);
    }
    const group = new THREE.Group();
    this.dayProps = new THREE.Group();
    this.nightProps = new THREE.Group();
    this.eagle = null;
    const eagleP = placements.find((p) => p.id === "eagle");
    for (const [key, { mats, phase }] of items) {
      const dash = key.lastIndexOf("-v");
      const geom = this.propsLib.get(key.slice(0, dash), Number(key.slice(dash + 2)));
      if (!geom) continue;
      // lucioles : self-lit (Basic) pour luire au crépuscule, sans ombre portée
      const glowing = key.startsWith("firefly");
      const mesh = new THREE.InstancedMesh(geom, glowing ? FIREFLY_MAT : PROP_MAT, mats.length);
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !glowing;
      mesh.receiveShadow = !glowing;
      if (eagleP && key.startsWith("eagle")) {
        this.eagle = {
          mesh, x: eagleP.x, z: eagleP.y,
          h: this.smooth.heightAt(eagleP.x, eagleP.y), scale: eagleP.scale, angle: 0,
        };
      }
      (phase === "day" ? this.dayProps : phase === "night" ? this.nightProps : group).add(mesh);
    }
    group.add(this.dayProps, this.nightProps);
    this.applyPhase(this.lastDayTime);
    return group;
  }

  /** l'aigle avance d'un cran sur son cercle (appelé par le tick solaire de 5 s) */
  tickAmbient() {
    const e = this.eagle;
    if (!e) return;
    e.angle += 0.55;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(e.x + Math.cos(e.angle) * 1.1, e.h, e.z + Math.sin(e.angle) * 1.1),
      new THREE.Quaternion().setFromAxisAngle(UP, -e.angle),
      new THREE.Vector3(e.scale, e.scale, e.scale),
    );
    e.mesh.setMatrixAt(0, m);
    e.mesh.instanceMatrix.needsUpdate = true;
    this.engine.invalidate();
  }

  /** vie ambiante jour/crépuscule : les props sont déjà instanciés, on toggle `visible` */
  applyPhase(t: number) {
    this.lastDayTime = t;
    const dusk = t >= 0.72; // même seuil que les lucioles du plan (t > ~0.75 du cycle)
    let changed = false;
    if (this.dayProps && this.dayProps.visible === dusk) { this.dayProps.visible = !dusk; changed = true; }
    if (this.nightProps && this.nightProps.visible !== dusk) { this.nightProps.visible = dusk; changed = true; }
    if (changed) this.engine.invalidate();
  }

  texture(url: string): THREE.Texture {
    let t = this.textures.get(url);
    if (!t) {
      t = new THREE.TextureLoader().load(url, () => this.engine.invalidate());
      t.colorSpace = THREE.NoColorSpace; // passthrough : mêmes octets que le PNG
      this.textures.set(url, t);
    }
    return t;
  }

  isMine(id: string): boolean {
    return this.myHeroIds.length === 0 || this.myHeroIds.includes(id);
  }
  private heroesAt(x: number, y: number): Hero[] {
    return (this.game?.heroes ?? []).filter((h) => h.x === x && h.y === y && h.hp > 0 && this.isMine(h.id));
  }
  private selectedHero(): Hero | undefined {
    return this.game?.heroes.find((h) => h.id === this.selectedHeroId);
  }
  private levelsOf(t: { biome: number; height: number; discovered?: boolean }): number {
    return t.discovered ? renderHeight(t) + 1 : 2; // brume non découverte = mur de 2 blocs
  }

  /** logique de clic de MapScene, à l'identique */
  onTap(cssX: number, cssY: number) {
    const game = this.game;
    if (!game) return;
    const hits = this.engine.pick(cssX, cssY);
    let cell: { x: number; y: number } | undefined;
    for (const h of hits) {
      if (this.smooth.mesh && h.object === this.smooth.mesh) {
        // surface continue : le point d'impact désigne directement la tuile
        cell = { x: Math.round(h.point.x), y: Math.round(h.point.z) };
        break;
      }
      const cells = this.lookup.get(h.object);
      if (cells && h.instanceId !== undefined) { cell = cells[h.instanceId]; break; }
    }
    if (!cell) return;
    const { x, y } = cell;
    const hero = this.selectedHero();
    if (hero && Math.abs(x - hero.x) + Math.abs(y - hero.y) === 1) {
      bus.emit(EV.MapTileClick, { x, y });
      return;
    }
    const here = this.heroesAt(x, y);
    if (here.length > 0) {
      if (hero && here.some((h) => h.id === this.selectedHeroId)) {
        bus.emit(EV.MapHeroMenu, { sx: cssX, sy: cssY });
      } else {
        bus.emit(EV.MapHeroClick, { heroId: here[0].id });
      }
    }
  }

  draw() {
    const game = this.game;
    const engine = this.engine;
    if (!game || !this.libReady) return;

    // --- terrain (re-instancié seulement quand la découverte/partie change) ----
    let discovered = 0;
    for (const t of game.tiles) if (t.discovered) discovered++;
    const key = `${game.id}:${game.width}x${game.height}:${discovered}:${this.smoothMode ? "s" : "b"}`;
    if (this.terrainKey !== key) {
      if (this.terrain) engine.scene.remove(this.terrain);
      if (this.smooth.mesh) engine.scene.remove(this.smooth.mesh);
      const cells: TerrainCell[] = [];
      for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
          const t = game.tiles[y * game.width + x];
          if (!t.discovered) {
            // mur de brume à DEUX niveaux : voile profond (mistbase) sous le dôme (mist)
            cells.push({ x, y, block: "mist", under: "mistbase", levels: 2 });
            continue;
          }
          if (this.smoothMode) continue; // le sol découvert vient de la surface lissée
          const block = BIOME_BLOCKS[t.biome] ?? "grass";
          const levels = renderHeight(t) + 1;
          const shade = Math.min(0.8 + Math.min(levels - 1, 6) * 0.033, 1);
          cells.push({
            x, y, block, levels,
            under: UNDER_BLOCKS[block],
            tint: new THREE.Color(shade, shade, shade),
          });
        }
      }
      const built = buildTerrain(this.lib, cells); // blocs — ou seulement la brume en mode lisse
      this.terrain = built.group;
      this.lookup = built.lookup;
      engine.scene.add(built.group);
      if (this.props) engine.scene.remove(this.props);
      if (this.cascade) {
        engine.scene.remove(this.cascade.group);
        this.cascade.dispose();
        this.cascade = null;
      }
      if (this.smoothMode) {
        engine.scene.add(this.smooth.build(game, this.palettes, renderHeight));
        this.props = this.buildProps(game);
        engine.scene.add(this.props);
        const site = findCascadeSite({
          width: game.width, height: game.height, tiles: game.tiles,
          townX: game.town.x, townY: game.town.y, seedStr: game.id,
        });
        if (site) {
          this.cascade = buildCascade(site, (x, y) => this.smooth.heightAt(x, y));
          engine.scene.add(this.cascade.group);
        }
      }
      this.terrainKey = key;
    }

    // --- overlays + billboards (reconstruits à chaque render, ~dizaines) -------
    this.overlays.clear();
    this.sprites.clear();
    this.charMeshes = [];
    const quad = (x: number, y: number, top: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.position.set(x, top + 0.02, y);
      this.overlays.add(m);
    };
    const tileAt = (x: number, y: number) =>
      x < 0 || y < 0 || x >= game.width || y >= game.height ? undefined : game.tiles[y * game.width + x];
    // hauteur du sol au centre d'une tuile : surface lissée en mode continu
    // (léger +0.04 : les quads plats posés sur une pente clippent moins),
    // sommet du pilier de blocs sinon
    const topOf = (x: number, y: number) => {
      if (this.smoothMode) {
        const t = tileAt(x, y);
        return t && !t.discovered ? 2 : this.smooth.heightAt(x, y) + 0.04;
      }
      const t = tileAt(x, y);
      return t ? this.levelsOf(t) : 1;
    };
    const billboard = (url: string, x: number, y: number, opts: { size?: number; alpha?: number; ox?: number; oy?: number } = {}) => {
      const tex = this.texture(url);
      const mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.35, transparent: true, opacity: opts.alpha ?? 1 });
      const s = new THREE.Sprite(mat);
      const size = opts.size ?? 0.62;
      s.scale.set(size, size, 1);
      s.center.set(0.5, 0.04); // pieds posés sur la face du dessus
      s.position.set(x + (opts.ox ?? 0), topOf(x, y), y + (opts.oy ?? 0));
      this.sprites.add(s);
    };

    // sélection + losanges de déplacement (mêmes règles que MapScene : ortho,
    // eau connue infranchissable, porte construite fermée = ville scellée)
    const hero = this.selectedHero();
    if (hero) {
      const gate = game.town.buildings?.find((b) => b.id === "gate");
      const gateClosed = !!gate && gate.built && !gate.open;
      const heroOnTown = hero.x === game.town.x && hero.y === game.town.y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = hero.x + dx, ny = hero.y + dy;
        const t = tileAt(nx, ny);
        if (!t) continue;
        if (t.discovered && t.biome === 0) continue; // eau connue
        if (gateClosed && (heroOnTown || (nx === game.town.x && ny === game.town.y))) continue;
        quad(nx, ny, topOf(nx, ny), 0xffe066, 0.55);
      }
    }

    // ville : socle + bâtiment billboard
    quad(game.town.x, game.town.y, topOf(game.town.x, game.town.y), 0xffffff, 0.25);
    billboard(libUrl("buildings", "bld-church"), game.town.x, game.town.y, { size: 1.15 });

    // monstres : teinte de danger sur la case + sprite de créature
    for (const id in game.monsters) {
      const m = game.monsters[id];
      const t = tileAt(m.x, m.y);
      if (!t?.discovered) continue; // cachés dans la brume
      const danger = Math.min(Math.max((m.count - 1) / 5, 0), 1);
      const c = new THREE.Color(1, 0.88 - danger * 0.68, 0.2 - danger * 0.2);
      quad(m.x, m.y, topOf(m.x, m.y), c.getHex(), 0.38 + danger * 0.2);
      const tex = monsterTexKey(m.species, m.appearance);
      const mesh = tex ? this.chars.make(tex) : undefined;
      if (mesh) {
        mesh.position.set(m.x, topOf(m.x, m.y), m.y);
        mesh.rotation.y = engine.azimuthNow;
        this.sprites.add(mesh);
        this.charMeshes.push(mesh);
      } else if (tex) billboard(libUrl("monsters", tex), m.x, m.y, { size: 0.6 });
    }

    // héros : les miens pleins, les autres translucides ; en ville = masqués
    const visible = (h: Hero) =>
      h.hp > 0 && !(h.x === game.town.x && h.y === game.town.y) && (this.isMine(h.id) || this.showOthers);
    const byTile: Record<string, string[]> = {};
    for (const h of game.heroes) if (visible(h)) (byTile[`${h.x},${h.y}`] ||= []).push(h.id);
    for (const h of game.heroes) {
      if (!visible(h)) continue;
      const group = byTile[`${h.x},${h.y}`];
      const i = group.indexOf(h.id);
      let ox = 0, oy = 0;
      if (group.length > 1) {
        const a = Math.PI + (i / group.length) * Math.PI * 2;
        ox = Math.cos(a) * 0.24;
        oy = Math.sin(a) * 0.24;
      }
      const mine = this.isMine(h.id);
      if (mine && h.id === this.selectedHeroId) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.2, 0.27, 24).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, depthWrite: false }),
        );
        ring.position.set(h.x + ox, topOf(h.x, h.y) + 0.03, h.y + oy);
        this.overlays.add(ring);
      }
      // Phase 5 : modèle voxel de la classe quand il existe (il tourne avec la
      // caméra), billboard PNG sinon — bascule progressive par modèle.
      const mesh = this.chars.make(heroKey(h.class));
      if (mesh) {
        mesh.position.set(h.x + ox, topOf(h.x, h.y), h.y + oy);
        mesh.rotation.y = engine.azimuthNow;
        if (!mine) {
          mesh.material = (mesh.material as THREE.MeshBasicMaterial).clone();
          (mesh.material as THREE.MeshBasicMaterial).transparent = true;
          (mesh.material as THREE.MeshBasicMaterial).opacity = OTHER_ALPHA;
        }
        this.sprites.add(mesh);
        this.charMeshes.push(mesh);
        if (mine) {
          const lbl = makeLabel(h.name, "#fff6d8", 0.2);
          lbl.center.set(0.5, 0);
          lbl.position.set(h.x + ox, topOf(h.x, h.y) + 0.82, h.y + oy);
          this.sprites.add(lbl);
        }
      } else {
        billboard(libUrl("characters", heroTexKey(h.class)), h.x, h.y, {
          alpha: mine ? 1 : OTHER_ALPHA,
          ox, oy,
        });
      }
    }

    // cadrage initial : zoomé sur la ville (comme MapScene)
    if (!this.fitted) {
      engine.target.set(game.town.x, 0, game.town.y);
      engine.zoom = 42;
      this.fitted = true;
    }
    engine.invalidate();
  }
}

export function VoxelMapView({ active = true }: { active?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.minZoom = 14;
    engine.maxZoom = 120;
    const controls = new VoxelControls(engine);
    const world = new MapWorld(engine);
    controls.onTap = (t) => world.onTap(t.cssX, t.cssY);
    // mode terrain (blocs ⇄ lisse) depuis les Réglages, à chaud
    world.smoothMode = useStore.getState().settings.voxelSmooth;
    const unsubSettings = useStore.subscribe((s, prev) => {
      if (s.settings.voxelSmooth !== prev.settings.voxelSmooth) {
        world.smoothMode = s.settings.voxelSmooth;
        world.draw();
      }
    });

    const off = bus.on(
      EV.MapRender,
      (p: { game: GameState; selectedHeroId?: string; myHeroIds?: string[]; showOthers?: boolean }) => {
        const changed = world.game?.id !== p.game.id;
        world.game = p.game;
        world.selectedHeroId = p.selectedHeroId;
        world.myHeroIds = p.myHeroIds ?? [];
        world.showOthers = !!p.showOthers;
        if (changed) {
          world.fitted = false;
          world.terrainKey = "";
        }
        world.draw();
      },
    );
    // même poignée de main que MapScene : le store re-pousse l'état courant
    bus.emit(EV.MapSceneReady);

    // CYCLE SOLAIRE piloté par le timer de vague : aube après chaque vague,
    // crépuscule menaçant à l'approche de la suivante. Tick 5 s (rendu
    // on-demand : ~12 rendus/min au repos, négligeable).
    const sunTick = () => {
      const t = world.waveProgress();
      engine.setDayTime(t);
      world.applyPhase(t); // vie ambiante : papillons/mouettes le jour, lucioles au crépuscule
      world.tickAmbient(); // l'aigle tournoie
      world.smooth.setTime(performance.now() / 1000);
    };
    sunTick();
    const sunTimer = setInterval(sunTick, 5000);

    if (import.meta.env.DEV) (window as unknown as { __vm?: unknown }).__vm = { engine, world };
    return () => {
      off();
      unsubSettings();
      clearInterval(sunTimer);
      controls.dispose();
      world.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {/* la rotation 4 orientations — LA nouveauté 3D de la carte voxel */}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button className="small" style={rotBtn} onClick={() => engineRef.current?.rotate(-1)}>↺</button>
        <button className="small" style={rotBtn} onClick={() => engineRef.current?.rotate(1)}>↻</button>
      </div>
    </>
  );
}

const UP = new THREE.Vector3(0, 1, 0);
const PROP_MAT = new THREE.MeshLambertMaterial({ vertexColors: true });
const FIREFLY_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // luit dans la pénombre

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
