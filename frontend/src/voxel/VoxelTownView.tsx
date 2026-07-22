// Home (ville) en VOXEL (Phase 4 du VOXEL-PLAN) — mêmes props que TownMap :
// HomeTab bascule TownMap ⇄ VoxelTownView selon `settings.voxelMap`.
//
// La ville reste LA CARTE AUTEUR de l'éditeur (town-map.json) : chaque
// `Cell.blocks[niveau]` (asset isotile) devient une instance du bloc voxel
// HOMONYME (générés avec les palettes de ces isotiles — les couleurs de la
// carte sont préservées). Les bâtiments/props de l'éditeur sont des billboards
// aux mêmes positions (dx/dy écran de l'éditeur inversés vers le monde), avec
// **hotspots par raycast** (fini le hack elementFromPoint) + pastilles DOM
// projetées (nom, durabilité, compat CSS .town-spot). MES héros en ville sont
// des billboards sur l'herbe (mêmes règles que TownMap). Zoom/pan/pinch/
// rotation = les contrôles du moteur.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import townJson from "../data/town-map.json";
import type { Cell, MapDoc, Placement } from "../editor/types";
import { normalizeCell } from "../editor/types";
import { ISO } from "../editor/isoRender";
import { TOWN_BUILDINGS } from "../data/buildings";
import { heroAssetUrl, libUrl } from "../assets";
import { myTeamHeroes } from "../townUtils";
import { useStore } from "../store";
import { durColor } from "../tabs/HomeTab";
import { clearOwned, VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildStacks, type StackItem } from "./terrain";
import { makeClouds, type Clouds } from "./clouds";
import { makeLabel } from "./labels";

// Mêmes mappings que TownMap.
const ASSET_TO_BUILDING: Record<string, string> = {
  "bld-well": "well",
  gate: "gate",
  "bld-chapel": "townhall",
  panel: "panel",
  workshop: "workshop",
  bank: "bank",
  "bld-archerytower": "tower",
  "bld-recyclerie": "recyclerie",
};
const GRASS_FILES = new Set(["grass", "jungle", "darkgrass", "fallgrass", "mossy"]);

// Gonds (pivots) des vantaux du portail, en coordonnées LOCALES du mesh (repère
// mesher, avant le scale du groupe) : X = faceExterne_fine/30 − 0.5, Z = centre
// de profondeur des battants (posés au FRONT de l'arche, y≈8 → Z≈−0.067). Battant
// gauche = fine x9 (−0.2), droit = fine x23 (+0.2667). Cf. bldGateDoor dans
// scripts/voxel/gen-props.mjs.
const GATE_HINGE = { lx: -0.2, rx: 0.2667, z: -0.0667 };
const GATE_OPEN_ANGLE = 1.4; // rad (~80°) — vantaux grands ouverts vers l'avant

function getDoc(): MapDoc {
  const d = townJson as unknown as MapDoc;
  d.cells = d.cells.map((c) => normalizeCell({ ...(c as Cell) }));
  return d;
}

// Offsets écran de l'éditeur (px au tileW courant) → offsets monde (unités
// tuile) : sx=(x−y)·tileW/2, sy=(x+y)·tileH/2 ⇒ du=dx/tileW+dy/tileH,
// dv=dy/tileH−dx/tileW.
function screenOffsetToWorld(dx: number, dy: number): { du: number; dv: number } {
  return { du: dx / ISO.tileW + dy / ISO.tileH, dv: dy / ISO.tileH - dx / ISO.tileW };
}

type Spot = { buildingId: string; world: THREE.Vector3 };

export function VoxelTownView({
  selected,
  onBuildingClick,
  onClear,
}: {
  selected: string | null;
  onBuildingClick: (id: string) => void;
  onClear: () => void;
}) {
  const game = useStore((s) => s.game);
  const hostRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const spotsRef = useRef<Spot[]>([]);
  const [spotList, setSpotList] = useState<Spot[]>([]); // version React des spots (pills)
  const spriteBuildingOf = useRef(new Map<THREE.Object3D, string>());

  // moteur + scène statique (une fois)
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.enableLighting({ shadowSpan: 32 }); // lumière pastel + ombres sur la ville
    engine.minZoom = 8;
    engine.maxZoom = 90;
    // passe beauté (Tier 1) depuis les Réglages, à chaud
    engine.setBeauty(useStore.getState().settings.voxelBeauty);
    const unsubBeauty = useStore.subscribe((s, prev) => {
      if (s.settings.voxelBeauty !== prev.settings.voxelBeauty) engine.setBeauty(s.settings.voxelBeauty);
    });
    const controls = new VoxelControls(engine);
    // LOD 16³ aussi pour la ville : 575 cellules × 32³ pesaient 6,1 M tris —
    // en 16³ le style voxel reste lisible de près et le budget retombe ~4×.
    const lib = new BlockLibrary("/voxels/16");
    // bâtiments VOXEL à états (2026-07-19) : v0 intact / v1 abîmé / v2 ruine
    // par DURABILITÉ réelle ; échafaudage pour les chantiers
    const propsLib = new BlockLibrary("/voxels/props");
    const doc = getDoc();

    // 1) terrain : toutes les piles de blocs occupées
    const items: StackItem[] = [];
    const used = new Set<string>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let cy = 0; cy < doc.gridH; cy++) {
      for (let cx = 0; cx < doc.gridW; cx++) {
        const cell = doc.cells[cy * doc.gridW + cx];
        const blocks = cell?.blocks ?? [];
        for (let lvl = 0; lvl < blocks.length; lvl++) {
          const b = blocks[lvl];
          if (!b) continue;
          items.push({ x: cx, y: cy, level: lvl, block: b.file });
          used.add(b.file);
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        }
      }
    }

    // 2) bâtiments/props de l'éditeur → billboards + hotspots raycast
    const texLoader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];
    const sprites = new THREE.Group();
    const spots: Spot[] = [];
    const bldPlacements: { bid: string; wx: number; wy: number; lvl: number; w: number }[] = [];
    const occupied = new Set<string>();
    for (const l of doc.layers) {
      if (!l.visible) continue;
      for (const p of l.placements as Placement[]) {
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) occupied.add(`${p.cx + dx},${p.cy + dy}`);
        const { du, dv } = screenOffsetToWorld(p.dx ?? 0, p.dy ?? 0);
        const wx = p.cx + du;
        const wy = p.cy + dv;
        const cell = doc.cells[p.cy * doc.gridW + p.cx];
        const lvl = (cell?.height ?? 0) + 1 + (p.lift ?? 0);
        const bid = ASSET_TO_BUILDING[p.asset.file];
        if (bid) {
          // bâtiment de GAMEPLAY → mesh voxel piloté par l'état (groupe dynamique)
          bldPlacements.push({ bid, wx, wy, lvl, w: ((p.scale ?? 1) * ISO.objW) / ISO.tileW });
          continue;
        }
        // décor éventuel non mappé : billboard comme avant
        const url = `/assets/${p.asset.cat}/${p.asset.file}.png`;
        const tex = texLoader.load(url, (t) => {
          const aspect = t.image ? t.image.height / t.image.width : 1;
          const w = ((p.scale ?? 1) * ISO.objW) / ISO.tileW;
          spr.scale.set(p.flipX ? -w : w, w * aspect, 1);
          engine.invalidate();
        });
        tex.colorSpace = THREE.NoColorSpace;
        textures.push(tex);
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.3, transparent: true }));
        spr.center.set(0.5, 0.02);
        spr.position.set(wx, lvl, wy);
        sprites.add(spr);
      }
    }
    void spots;
    engine.scene.add(sprites);

    // --- groupe DYNAMIQUE des bâtiments voxel : reconstruit à chaque état ----
    const bldGroup = new THREE.Group();
    engine.scene.add(bldGroup);
    // SELF-LIT : l'ombrage des faces est déjà CUIT par le mesher — sous le
    // Lambert les façades cumulaient deux ombrages et viraient au gris
    const BLD_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });

    // --- animation d'ouverture du portail --------------------------------------
    // `gateAnim.current` (0 fermé → 1 ouvert) est lissé image par image et
    // PERSISTE entre les reconstructions de drawBuildings ; `gatePivots` porte
    // les deux groupes-gonds recréés à chaque reconstruction ; `gateTarget` suit
    // l'état serveur `open` (partagé par tous les joueurs → même porte pour tous).
    const gateAnim = { current: 0 };
    let gatePivots: { l: THREE.Group; r: THREE.Group } | null = null;
    let gateTarget = 0;
    const applyGateAngle = () => {
      if (!gatePivots) return;
      const a = gateAnim.current * GATE_OPEN_ANGLE;
      gatePivots.l.rotation.y = a; // les deux battants s'ouvrent vers l'avant
      gatePivots.r.rotation.y = -a;
    };

    const drawBuildings = () => {
      bldGroup.clear();
      spriteBuildingOf.current.clear();
      gatePivots = null;
      const g = useStore.getState().game;
      const list: Spot[] = [];
      for (const pl of bldPlacements) {
        const b = g?.town.buildings?.find((x) => x.id === pl.bid);
        if (!b || (!b.built && !b.underConstruction)) continue; // site sans plan : herbe nue
        // ×2.3 : le modèle est normalisé sur sa grille de 20 mais le bâtiment
        // n'en occupe que ~14 — sans ce facteur il paraît minuscule vs le billboard
        const S = pl.w * 2.3;
        const variant = b.built
          ? (() => { const r = b.maxDurability > 0 ? b.durability / b.maxDurability : 1; return r >= 0.66 ? 0 : r >= 0.33 ? 1 : 2; })()
          : 0;

        // PORTAIL construit : maçonnerie + deux vantaux animés autour des gonds
        if (pl.bid === "gate" && b.built) {
          const grp = new THREE.Group();
          grp.position.set(pl.wx, pl.lvl, pl.wy);
          grp.scale.setScalar(S);
          grp.rotation.y = Math.PI; // façades (y bas du modèle) vers la caméra
          const frame = propsLib.get("bld-gate", variant);
          if (frame) {
            const m = new THREE.Mesh(frame, BLD_MAT);
            m.castShadow = m.receiveShadow = true;
            grp.add(m);
            spriteBuildingOf.current.set(m, "gate");
          }
          const mkLeaf = (side: -1 | 1): THREE.Group | null => {
            const geom = propsLib.get(side < 0 ? "bld-gate-door-l" : "bld-gate-door-r", variant);
            if (!geom) return null;
            const hx = side < 0 ? GATE_HINGE.lx : GATE_HINGE.rx;
            const pivot = new THREE.Group();
            pivot.position.set(hx, 0, GATE_HINGE.z); // gond = axe vertical du battant
            const m = new THREE.Mesh(geom, BLD_MAT);
            m.castShadow = m.receiveShadow = true;
            m.position.set(-hx, 0, -GATE_HINGE.z); // annule le gond → aligné à angle 0
            pivot.add(m);
            grp.add(pivot);
            spriteBuildingOf.current.set(m, "gate");
            return pivot;
          };
          const lp = mkLeaf(-1), rp = mkLeaf(1);
          gatePivots = lp && rp ? { l: lp, r: rp } : null;
          gateTarget = b.open ? 1 : 0;
          applyGateAngle(); // pose l'angle courant lissé sans clignotement
          bldGroup.add(grp);
          list.push({ buildingId: "gate", world: new THREE.Vector3(pl.wx, pl.lvl + pl.w * 2.6, pl.wy) });
          continue;
        }

        const geom = b.built ? propsLib.get(`bld-${pl.bid}`, variant) : propsLib.get("bld-chantier", 0);
        if (!geom) continue;
        const mesh = new THREE.Mesh(geom, BLD_MAT);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.set(pl.wx, pl.lvl, pl.wy);
        mesh.scale.setScalar(S);
        mesh.rotation.y = Math.PI; // façades (y bas du modèle) vers la caméra par défaut
        bldGroup.add(mesh);
        spriteBuildingOf.current.set(mesh, pl.bid);
        list.push({ buildingId: pl.bid, world: new THREE.Vector3(pl.wx, pl.lvl + pl.w * 2.6, pl.wy) });
      }
      spotsRef.current = list;
      setSpotList(list);
      engine.refreshShadows(); // bâtiments changés → passe d'ombres à re-rendre
    };
    let clouds: Clouds | null = null;
    void propsLib
      .load(["bld-well", "bld-panel", "bld-bank", "bld-workshop", "bld-gate", "bld-tower",
             "bld-townhall", "bld-kitchen", "bld-wall", "bld-recyclerie", "bld-chantier",
             "bld-gate-door-l", "bld-gate-door-r", "cloud"])
      .then(() => {
        drawBuildings();
        // nuages au-dessus de la ville : plus hauts, plus lents que la carte
        clouds = makeClouds(propsLib, {
          count: 5, cx: doc.gridW / 2, cy: doc.gridH / 2,
          span: Math.max(doc.gridW, doc.gridH) + 16,
          altitude: [14, 18], speed: [0.35, 0.7], scale: [3, 5],
          seed: 4242,
          groundAt: () => 1.06, // niveau de la place — la tache glisse sur l'herbe
        });
        engine.scene.add(clouds.group);
      });

    // animation CONTINUE des nuages + ouverture des vantaux tant que le Home est
    // monté et la page visible
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (document.visibilityState !== "visible") return;
      let moved = false;
      // vantaux : lissage exponentiel doux vers l'état ouvert/fermé
      if (gatePivots && Math.abs(gateTarget - gateAnim.current) > 0.001) {
        gateAnim.current += (gateTarget - gateAnim.current) * 0.14;
        if (Math.abs(gateTarget - gateAnim.current) <= 0.001) {
          gateAnim.current = gateTarget;
          engine.refreshShadows(); // fin de course → ombres des vantaux à jour
        }
        applyGateAngle();
        moved = true;
      }
      if (clouds) { clouds.setTime(performance.now() / 1000); moved = true; }
      if (moved) engine.invalidate();
    };
    raf = requestAnimationFrame(animate);

    // 3) MES héros en ville, sur l'herbe (mêmes règles/hachage que TownMap)
    const heroGroup = new THREE.Group();
    engine.scene.add(heroGroup);
    const grass: { x: number; y: number; lvl: number }[] = [];
    for (let cy = 0; cy < doc.gridH; cy++) {
      for (let cx = 0; cx < doc.gridW; cx++) {
        const cell = doc.cells[cy * doc.gridW + cx];
        const blocks = cell?.blocks ?? [];
        let top: string | undefined;
        let topLvl = 0;
        for (let i = blocks.length - 1; i >= 0; i--)
          if (blocks[i]) { top = blocks[i]!.file; topLvl = i + 1; break; }
        if (!top || !GRASS_FILES.has(top) || occupied.has(`${cx},${cy}`)) continue;
        grass.push({ x: cx, y: cy, lvl: topLvl });
      }
    }
    // cache par URL : drawHeroes tourne à chaque changement d'état — recharger
    // la texture et recréer le matériau à chaque passe fuyait GPU-side
    const heroTexCache = new Map<string, THREE.Texture>();
    const drawHeroes = () => {
      clearOwned(heroGroup);
      const g = useStore.getState().game;
      const pid = useStore.getState().playerId;
      if (!g || !grass.length) return;
      const inTown = myTeamHeroes(g, pid).filter((h) => h.hp > 0 && h.x === g.town.x && h.y === g.town.y);
      const usedIdx = new Set<number>();
      const hash = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; };
      for (const h of inTown) {
        let idx = hash(h.id) % grass.length;
        while (usedIdx.has(idx)) idx = (idx + 29) % grass.length;
        usedIdx.add(idx);
        const gpos = grass[idx];
        const url = heroAssetUrl(h.class);
        let tex = heroTexCache.get(url);
        if (!tex) {
          tex = texLoader.load(url, () => engine.invalidate());
          tex.colorSpace = THREE.NoColorSpace;
          heroTexCache.set(url, tex);
          textures.push(tex);
        }
        const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.35, transparent: true }));
        spr.userData.ownMat = true;
        spr.scale.set(1.1, 1.1, 1);
        spr.center.set(0.5, 0.02);
        spr.position.set(gpos.x, gpos.lvl, gpos.y);
        heroGroup.add(spr);
        const lbl = makeLabel(h.name, "#fff6d8", 0.3);
        lbl.center.set(0.5, 0);
        lbl.position.set(gpos.x, gpos.lvl + 1.18, gpos.y);
        heroGroup.add(lbl);
      }
      engine.refreshShadows(); // héros ajoutés/retirés → ombres à jour
    };

    // pastilles DOM projetées à chaque frame (imperatif — pas de re-render React)
    engine.onFrame = () => {
      const layer = pillsRef.current;
      if (!layer) return;
      const rect = engine.renderer.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      for (const el of Array.from(layer.children) as HTMLElement[]) {
        const spot = spotsRef.current.find((s) => s.buildingId === el.dataset.bid);
        if (!spot) continue;
        v.copy(spot.world).project(engine.camera);
        el.style.left = `${((v.x + 1) / 2) * rect.width}px`;
        el.style.top = `${((1 - v.y) / 2) * rect.height}px`;
      }
    };

    // tap : bâtiment (sprite) prioritaire, sinon vider la sélection
    controls.onTap = (t) => {
      const hits = engine.pick(t.cssX, t.cssY);
      for (const h of hits) {
        const bid = spriteBuildingOf.current.get(h.object);
        if (bid) { onBuildingClickRef.current(bid); return; }
      }
      onClearRef.current();
    };

    // chargement des blocs puis construction + cadrage sur la zone occupée
    let terrain: THREE.Group | null = null;
    void lib.load([...used]).then(() => {
      const built = buildStacks(lib, items);
      terrain = built.group;
      engine.scene.add(built.group);
      engine.refreshShadows();
      const cxm = (minX + maxX) / 2;
      const cym = (minY + maxY) / 2;
      engine.target.set(cxm, 0, cym);
      const span = Math.max(maxX - minX, maxY - minY) + 6;
      engine.zoom = Math.max(engine.minZoom, Math.min(engine.maxZoom, Math.min(host.clientWidth, host.clientHeight) / span * 1.6));
      drawHeroes();
      engine.invalidate();
    });

    const unsub = useStore.subscribe((s, prev) => {
      if (s.game !== prev.game) { drawHeroes(); drawBuildings(); }
    });

    if (import.meta.env.DEV) (window as unknown as { __vt?: unknown }).__vt = { engine };
    return () => {
      unsub();
      unsubBeauty();
      cancelAnimationFrame(raf);
      clouds?.dispose();
      controls.dispose();
      lib.dispose();
      propsLib.dispose();
      for (const t of textures) t.dispose();
      if (terrain) engine.scene.remove(terrain);
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // callbacks vivants (le moteur est monté une fois, les props changent)
  const onBuildingClickRef = useRef(onBuildingClick);
  onBuildingClickRef.current = onBuildingClick;
  const onClearRef = useRef(onClear);
  onClearRef.current = onClear;

  const buildingState = (id: string) => game?.town.buildings?.find((x) => x.id === id);

  return (
    <div className="town-map-viewport" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {/* pastilles nom + durabilité, projetées par le moteur (left/top pilotés en onFrame) */}
      <div ref={pillsRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {spotList.map((s) => {
          const layout = TOWN_BUILDINGS.find((b) => b.id === s.buildingId);
          const bs = buildingState(s.buildingId);
          if (!layout || !bs) return null;
          const site = !bs.built;
          return (
            <button
              key={s.buildingId}
              data-bid={s.buildingId}
              className={`town-spot ${selected === s.buildingId ? "sel" : ""} ${site ? "site" : ""}`}
              style={{ position: "absolute", pointerEvents: "auto" }}
              onClick={() => onBuildingClick(s.buildingId)}
              title={site ? `${layout.name} — en construction` : layout.name}
            >
              <span className="ts-pill">
                {site ? "🏗️" : layout.icon} {layout.name}
              </span>
              {bs.built && (
                <span className="ts-dur">
                  <i
                    style={{
                      width: `${bs.maxDurability > 0 ? Math.min(100, (bs.durability / bs.maxDurability) * 100) : 0}%`,
                      background: durColor(bs.maxDurability > 0 ? bs.durability / bs.maxDurability : 0),
                    }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
        <button style={rotBtn} onClick={() => engineRef.current?.rotate(-1)}>↺</button>
        <button style={rotBtn} onClick={() => engineRef.current?.rotate(1)}>↻</button>
      </div>
    </div>
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
