// Home (ville) en VOXEL (Phase 4 du VOXEL-PLAN) — mêmes props que TownMap :
// HomeTab bascule TownMap ⇄ VoxelTownView selon `settings.voxelMap`.
//
// La ville est un PLAN GÉNÉRÉ à partir de l'état de jeu (`voxel/townLayout.ts`),
// plus la carte d'éditeur `town-map.json` : celle-ci n'avait d'emplacement que
// pour 8 des 10 bâtiments (la muraille et la cuisine étaient invisibles et
// intouchables), posait ses bâtiments par décalages en pixels d'éditeur — donc
// dispersés — et son terrain était un plateau de grès sans un seul bloc
// d'herbe. Le plan procédural donne un village fortifié : muraille sur le
// pourtour, portail face caméra, place centrale autour du puits, une parcelle
// par bâtiment du serveur. Les modèles sont mis à l'échelle d'après leur boîte
// englobante réelle pour occuper l'emprise voulue en cellules (fini le facteur
// magique ×2.3). Hotspots par raycast + pastilles DOM projetées ; MES héros en
// ville sont des rigs voxel animés sur l'herbe. Zoom/pan/pinch/rotation = les
// contrôles du moteur.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { signacify } from "./signacMaterial";
import { TOWN_BUILDINGS } from "../data/buildings";
import { heroAssetUrl, heroTexKey, libUrl } from "../assets";
import { myTeamHeroes } from "../townUtils";
import { useStore } from "../store";
import { durColor } from "../tabs/HomeTab";
import { clearOwned, VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildStacks, type StackItem } from "./terrain";
import { makeClouds, type Clouds } from "./clouds";
import { makeLabel } from "./labels";
import { ALL_CHAR_KEYS, CharLibrary } from "./characters";
import { UnitAnimator } from "./unitAnim";
import { buildTownLayout, TOWN_DECOR_PROPS, type TownPlot } from "./townLayout";

const HERO_KEYS = ALL_CHAR_KEYS.filter((k) => k.startsWith("char-"));

// Gonds (pivots) des vantaux du portail, en coordonnées LOCALES du mesh (repère
// mesher, avant le scale du groupe) : X = faceExterne_fine/30 − 0.5, Z = centre
// de profondeur des battants (posés au FRONT de l'arche, y≈8 → Z≈−0.067). Battant
// gauche = fine x9 (−0.2), droit = fine x23 (+0.2667). Cf. bldGateDoor dans
// scripts/voxel/gen-props.mjs.
const GATE_HINGE = { lx: -0.2, rx: 0.2667, z: -0.0667 };
const GATE_OPEN_ANGLE = 1.4; // rad (~80°) — vantaux grands ouverts vers l'avant

// Échelle d'un modèle pour qu'il occupe `cells` cellules au sol. Les modèles
// n'ont pas tous la même emprise dans leur grille (la muraille est un bandeau,
// la mairie un pavé), donc on mesure la boîte englobante RÉELLE au lieu
// d'appliquer un facteur commun — c'est ce que faisait l'ancien code (×2.3
// hérité de l'échelle d'auteur), d'où des bâtiments de tailles incohérentes.
function fitScale(geom: THREE.BufferGeometry, cells: number): number {
  if (!geom.boundingBox) geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) return cells;
  const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  return w > 1e-6 ? cells / w : cells;
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
    engine.setSignac(useStore.getState().settings.voxelSignac, useStore.getState().settings.signacStrength);
    const unsubBeauty = useStore.subscribe((s, prev) => {
      if (s.settings.voxelBeauty !== prev.settings.voxelBeauty) engine.setBeauty(s.settings.voxelBeauty);
      if (
        s.settings.voxelSignac !== prev.settings.voxelSignac ||
        s.settings.signacStrength !== prev.settings.signacStrength
      )
        engine.setSignac(s.settings.voxelSignac, s.settings.signacStrength);
    });
    const controls = new VoxelControls(engine);
    // héros voxel ANIMÉS (respiration à l'arrêt) — remplacent les billboards
    const chars = new CharLibrary();
    const animator = new UnitAnimator(engine);
    // LOD 16³ aussi pour la ville : 575 cellules × 32³ pesaient 6,1 M tris —
    // en 16³ le style voxel reste lisible de près et le budget retombe ~4×.
    const lib = new BlockLibrary("/voxels/16");
    // bâtiments VOXEL à états (2026-07-19) : v0 intact / v1 abîmé / v2 ruine
    // par DURABILITÉ réelle ; échafaudage pour les chantiers
    const propsLib = new BlockLibrary("/voxels/props");

    // 1) plan du village, dérivé de l'état de jeu (voir townLayout.ts)
    const layout = buildTownLayout();
    const items: StackItem[] = layout.terrain;
    const used = new Set(layout.blocks);
    const GROUND = layout.groundLevel;
    const texLoader = new THREE.TextureLoader();
    const textures: THREE.Texture[] = [];

    // --- groupe DYNAMIQUE des bâtiments voxel : reconstruit à chaque état ----
    const bldGroup = new THREE.Group();
    engine.scene.add(bldGroup);
    // SELF-LIT : l'ombrage des faces est déjà CUIT par le mesher — sous le
    // Lambert les façades cumulaient deux ombrages et viraient au gris
    const BLD_MAT = signacify(new THREE.MeshBasicMaterial({ vertexColors: true }));

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

    // Ancre de pastille pour une parcelle vide (pas de mesh à surmonter).
    const spotAtGround = (pl: TownPlot) => new THREE.Vector3(pl.x, GROUND + 0.6, pl.y);

    const drawBuildings = () => {
      bldGroup.clear();
      spriteBuildingOf.current.clear();
      gatePivots = null;
      const g = useStore.getState().game;
      const list: Spot[] = [];
      for (const pl of layout.plots) {
        const b = g?.town.buildings?.find((x) => x.id === pl.bid);
        if (!b) continue;
        // Site dont le plan n'est pas encore posé : rien à dresser en 3D, mais
        // la parcelle en terre battue reste visible ET on publie quand même sa
        // pastille. Sans elle, quatre bâtiments sur dix (mairie, tour, cuisine,
        // recyclerie en début de partie) étaient introuvables depuis la Ville —
        // c'était le principal défaut de cohérence de l'onglet.
        if (!b.built && !b.underConstruction) {
          if (pl.primary) list.push({ buildingId: pl.bid, world: spotAtGround(pl) });
          continue;
        }
        const variant = b.built
          ? (() => { const r = b.maxDurability > 0 ? b.durability / b.maxDurability : 1; return r >= 0.66 ? 0 : r >= 0.33 ? 1 : 2; })()
          : 0;
        const spotAt = (h: number) => new THREE.Vector3(pl.x, GROUND + h, pl.y);

        // PORTAIL construit : maçonnerie + deux vantaux animés autour des gonds
        if (pl.bid === "gate" && b.built) {
          const frame0 = propsLib.get("bld-gate", variant);
          const S = frame0 ? fitScale(frame0, pl.cells) : pl.cells;
          const grp = new THREE.Group();
          grp.position.set(pl.x, GROUND, pl.y);
          grp.scale.setScalar(S);
          grp.rotation.y = Math.PI + (pl.rot ?? 0); // façades vers la caméra
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
          if (pl.primary) list.push({ buildingId: "gate", world: spotAt(pl.cells * 0.9) });
          continue;
        }

        const geom = b.built ? propsLib.get(`bld-${pl.bid}`, variant) : propsLib.get("bld-chantier", 0);
        if (!geom) continue;
        const mesh = new THREE.Mesh(geom, BLD_MAT);
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.position.set(pl.x, GROUND, pl.y);
        mesh.scale.setScalar(fitScale(geom, pl.cells));
        mesh.rotation.y = Math.PI + (pl.rot ?? 0);
        bldGroup.add(mesh);
        spriteBuildingOf.current.set(mesh, pl.bid);
        // La muraille a des dizaines de segments mais UNE pastille : seul le
        // segment marqué `primary` en porte une.
        if (pl.primary) list.push({ buildingId: pl.bid, world: spotAt(pl.cells * 0.9) });
      }
      spotsRef.current = list;
      setSpotList(list);
      engine.refreshShadows(); // bâtiments changés → passe d'ombres à re-rendre
    };
    let clouds: Clouds | null = null;
    void propsLib
      .load(["bld-well", "bld-panel", "bld-bank", "bld-workshop", "bld-gate", "bld-tower",
             "bld-townhall", "bld-kitchen", "bld-wall", "bld-recyclerie", "bld-chantier",
             "bld-gate-door-l", "bld-gate-door-r", "cloud", ...TOWN_DECOR_PROPS])
      .then(() => {
        drawBuildings();
        // nuages au-dessus de la ville : plus hauts, plus lents que la carte
        clouds = makeClouds(propsLib, {
          count: 5, cx: layout.center, cy: layout.center,
          span: layout.size + 12,
          altitude: [13, 17], speed: [0.35, 0.7], scale: [2.5, 4],
          seed: 4242,
          groundAt: () => GROUND, // niveau de la place — la tache glisse sur l'herbe
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
    // Emplacements d'herbe libres, triés par proximité de la place : les héros
    // se rassemblent devant la mairie plutôt que de se disperser dans les coins.
    const grass = layout.heroSlots;
    // cache par URL : fallback billboard si le modèle voxel manque
    const heroTexCache = new Map<string, THREE.Texture>();
    const drawHeroes = () => {
      clearOwned(heroGroup);
      animator.beginFrame();
      const g = useStore.getState().game;
      const pid = useStore.getState().playerId;
      if (!g || !grass.length) { animator.endFrame(); return; }
      const inTown = myTeamHeroes(g, pid).filter((h) => h.hp > 0 && h.x === g.town.x && h.y === g.town.y);
      const usedIdx = new Set<number>();
      // Les emplacements sont déjà triés du plus proche de la place au plus
      // lointain : on sert dans l'ordre pour que l'équipe se tienne ensemble.
      for (let i = 0; i < inTown.length; i++) {
        const h = inTown[i];
        let idx = i % grass.length;
        while (usedIdx.has(idx)) idx = (idx + 1) % grass.length;
        usedIdx.add(idx);
        const gpos = grass[idx];
        const rig = chars.makeRig(heroTexKey(h.class));
        if (rig) {
          rig.root.scale.multiplyScalar(1.8); // ~taille de l'ancien billboard
          rig.root.position.set(gpos.x, gpos.lvl, gpos.y);
          heroGroup.add(rig.root);
          animator.sync(h.id, rig, gpos.x, gpos.lvl, gpos.y, { faceCamera: true });
        } else {
          const url = heroAssetUrl(h.class);
          let tex = heroTexCache.get(url);
          if (!tex) { tex = texLoader.load(url, () => engine.invalidate()); tex.colorSpace = THREE.NoColorSpace; heroTexCache.set(url, tex); textures.push(tex); }
          const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.35, transparent: true }));
          spr.userData.ownMat = true;
          spr.scale.set(1.1, 1.1, 1);
          spr.center.set(0.5, 0.02);
          spr.position.set(gpos.x, gpos.lvl, gpos.y);
          heroGroup.add(spr);
        }
        const lbl = makeLabel(h.name, "#fff6d8", 0.3);
        lbl.center.set(0.5, 0);
        lbl.position.set(gpos.x, gpos.lvl + 1.18, gpos.y);
        heroGroup.add(lbl);
      }
      animator.endFrame();
      engine.refreshShadows(); // héros ajoutés/retirés → ombres à jour
    };
    void chars.load(HERO_KEYS).then(() => drawHeroes()); // modèles prêts → rigs animés

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

    // chargement des blocs puis construction + cadrage sur le village
    let terrain: THREE.Group | null = null;
    void lib.load([...used]).then(() => {
      const built = buildStacks(lib, items);
      terrain = built.group;
      engine.scene.add(built.group);
      engine.refreshShadows();
      // Le village est carré et connu d'avance : on vise son centre et on cadre
      // sur son côté. `+3` laisse respirer la muraille et les pastilles.
      engine.target.set(layout.center, 0, layout.center);
      // En projection dimétrique un carré de côté N occupe ~N·√2 en diagonale
      // écran : cadrer sur N seul débordait des deux côtés. On cadre sur la
      // DIAGONALE, avec une marge pour la muraille et les pastilles.
      const span = (layout.size + 2) * 1.28;
      const fit = Math.min(host.clientWidth, host.clientHeight) / span;
      engine.zoom = Math.max(engine.minZoom, Math.min(engine.maxZoom, fit));
      drawHeroes();
      engine.invalidate();
    });

    // décor : arbres, buissons et fleurs sur les cellules d'herbe libres — sans
    // eux le village est une pelouse rase et les bâtiments flottent.
    const decorGroup = new THREE.Group();
    engine.scene.add(decorGroup);
    void propsLib.load(TOWN_DECOR_PROPS).then(() => {
      for (const d of layout.decor) {
        const geom = propsLib.get(d.prop, (d.x + d.y) % 3);
        if (!geom) continue;
        const m = new THREE.Mesh(geom, BLD_MAT);
        m.castShadow = m.receiveShadow = true;
        m.position.set(d.x, GROUND, d.y);
        m.scale.setScalar(fitScale(geom, d.scale));
        m.rotation.y = ((d.x * 7 + d.y * 13) % 4) * (Math.PI / 2);
        decorGroup.add(m);
      }
      engine.refreshShadows();
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
      animator.dispose();
      chars.dispose();
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
          const sel = selected === s.buildingId;
          // Marqueur ICÔNE par défaut, nom déplié seulement sur le bâtiment
          // sélectionné : à dix bâtiments les pastilles texte se chevauchaient
          // (19 collisions mesurées) et masquaient la ville qu'elles annotent.
          return (
            <button
              key={s.buildingId}
              data-bid={s.buildingId}
              className={`town-spot ${sel ? "sel" : ""} ${site ? "site" : ""}`}
              style={{ position: "absolute", pointerEvents: "auto" }}
              onClick={() => onBuildingClick(s.buildingId)}
              aria-label={
                site
                  ? `${layout.name} — chantier à lancer`
                  : `${layout.name} — durabilité ${Math.round(
                      bs.maxDurability > 0 ? (bs.durability / bs.maxDurability) * 100 : 0,
                    )} %`
              }
            >
              <span className="ts-ic" aria-hidden="true">
                {site ? "🏗️" : layout.icon}
              </span>
              {sel && <span className="ts-name">{layout.name}</span>}
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
      <div className="view-rot">
        <button className="iconbtn" aria-label="Pivoter la vue à gauche" onClick={() => engineRef.current?.rotate(-1)}>
          ↺
        </button>
        <button className="iconbtn" aria-label="Pivoter la vue à droite" onClick={() => engineRef.current?.rotate(1)}>
          ↻
        </button>
      </div>
    </div>
  );
}

