// Onglet Map en VOXEL (Phase 2 du VOXEL-PLAN) — remplaçant expérimental de la
// Carte du monde en voxel — SEUL rendu depuis 2026-07-29 (le rendu 2D
// isométrique Phaser a été retiré). Il parle EXACTEMENT
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

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { signacify } from "./signacMaterial";
import { bus, EV } from "../eventBus";
import type { GameState, Hero } from "../api/types";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { BLOOM_LAYER, clearOwned, VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary, buildTerrain, type TerrainCell } from "./terrain";
import { SmoothTerrain, setTerrainTheme } from "./smoothTerrain";
import { themedKey, themedKeysFor } from "./themeModels";
import { PROP_KEYS, scatterProps } from "./scatter";
import { buildCascade, findCascadeSite, type Cascade } from "./cascade";
import { makeWeather, weatherPropKeys, WeatherLayer } from "./weather";
import { ALL_CHAR_KEYS, CharLibrary, setRigOpacity } from "./characters";
import { UnitAnimator } from "./unitAnim";
import { makeLabel } from "./labels";
import { heroTexKey as heroKey } from "../assets";
import { useStore } from "../store";

const GROUND_LEVEL = 3; // même convention que MapScene : plaines = niveau 0
const BIOME_BLOCKS = ["water", "sand", "grass", "forest", "stone", "snow"];
const UNDER_BLOCKS: Record<string, string | undefined> = { forest: "dirt", snow: "stone" };
const OTHER_ALPHA = 0.45;
// Géométries PARTAGÉES des overlays reconstruits à chaque draw (quads de
// surbrillance, anneau de sélection) — en créer une par quad fuyait ~11
// géométries GPU par poll de 20 s (voir clearOwned dans engine.ts).
const QUAD_GEOM = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
const SEL_RING_GEOM = new THREE.RingGeometry(0.2, 0.27, 24).rotateX(-Math.PI / 2);

// Texture des cases ÉPUISÉES : de la terre retournée, pas un aplat.
//
// Un simple voile brun uniforme ne marchait pas : assez discret pour ne pas
// salir la carte, il se confondait avec les variations du terrain (mesuré :
// 17/255 d'écart moyen, indiscernable d'une bande d'herbe plus sombre) ; assez
// fort pour se voir, il noircissait la moitié d'une carte bien explorée. Une
// TEXTURE règle les deux : des taches de terre couvrant à peine la moitié de la
// case se lisent comme un marqueur (ça ne ressemble à aucun terrain), tout en
// laissant passer le sol entre elles.
let DEPLETED_TEX: THREE.CanvasTexture | null = null;
function depletedTexture(): THREE.CanvasTexture {
  if (DEPLETED_TEX) return DEPLETED_TEX;
  const S = 96;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  // PRNG figé : la tache doit être identique d'une session à l'autre.
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 34; i++) {
    const x = rnd() * S, y = rnd() * S, r = 4 + rnd() * 9;
    const dark = rnd() < 0.45;
    g.fillStyle = dark ? "rgba(74,55,32,0.92)" : "rgba(120,94,56,0.85)";
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  DEPLETED_TEX = new THREE.CanvasTexture(c);
  return DEPLETED_TEX;
}
// NEIGE FRAÎCHE (thème nordique, backend cold.go). Même problème et même réponse que
// les cases épuisées : un aplat uniforme se confond avec le terrain ou noircit la
// carte, une TEXTURE se lit comme un marqueur. Ici des congères claires en amas, assez
// couvrantes pour qu'on comprenne que la case est ensevelie — c'est ce qui explique au
// joueur pourquoi sa fouille automatique s'est arrêtée là.
let SNOW_TEX: THREE.CanvasTexture | null = null;
function snowTexture(): THREE.CanvasTexture {
  if (SNOW_TEX) return SNOW_TEX;
  const S = 96;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let seed = 4242; // PRNG figé : la congère doit être identique d'une session à l'autre
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S, y = rnd() * S, r = 8 + rnd() * 14;
    g.fillStyle = rnd() < 0.4 ? "rgba(226,236,248,0.95)" : "rgba(248,251,255,0.9)";
    g.beginPath();
    g.ellipse(x, y, r, r * (0.5 + rnd() * 0.4), rnd() * Math.PI, 0, Math.PI * 2);
    g.fill();
  }
  SNOW_TEX = new THREE.CanvasTexture(c);
  return SNOW_TEX;
}
// Props « arbres » : montés d'un cran sur la carte pour dépasser les personnages.
// ⚠ PAS LE CACTUS. Son modèle avait DÉJÀ été épaissi et allongé dans sa grille
// pour ne pas se lire comme une touffe d'herbe, et il portait en plus la plus
// grosse échelle de scatter du désert : cumulé au coup de pouce des arbres, le
// saguaro sortait à 1,67 tuile de haut — PLUS GRAND QU'UN SAPIN (1,36) et aussi
// large que lui. Trois corrections empilées pour un seul problème ; on n'en garde
// qu'une, celle qui est dans le modèle.
const TREE_IDS = new Set(["tree-green", "tree-pink", "pine", "pine-snow", "dead-tree", "palm"]);
// Échelle relative des monstres par apparence (× la taille de base d'un perso) :
// une limace est petite, un élémentaire/loup imposant, un boss massif.
const MONSTER_SCALE: Record<string, number> = {
  "mob-slime": 0.8,
  "mob-bat": 0.75,
  "mob-mushroomling": 0.8,
  "mob-ghost": 0.9,
  "mob-goblin": 0.95,
  "mob-spider": 0.95,
  "mob-windelemental": 1.2,
  "mob-wolf": 1.15,
  "mob-orc": 1.25,
};
const bossAppearance = (species: string) => /roi gobelin|arbre vivant|ancien/i.test(species);

function renderHeight(t: { biome: number; height: number }): number {
  if (t.biome <= 2) return 0; // eau/sable/herbe plates
  return Math.max(0, t.height - GROUND_LEVEL);
}

// CE QU'UN OBJET DE LA SCÈNE DÉSIGNE (2026-08-09).
//
// Le tap était résolu par le SEUL point d'impact du rayon sur le terrain : tout
// ce qui est posé dessus (héros, monstres, ruines, village de la case ville)
// était traversé en silence. Or la caméra est dimétrique à 30° : un point situé
// à la hauteur `h` au-dessus du sol se projette là où le sol se trouve
// `h/tan(30°) ≈ 1,73` unité PLUS LOIN, réparti sur x ET z (azimut 45°) — donc
// cliquer le TORSE d'un héros touchait le sol une à deux cases derrière lui.
// Mesuré : sur une équipe sortie ensemble, un clic sur le corps du héros
// sélectionné émettait « déplace-toi en (10,11) » au lieu d'ouvrir son menu
// d'actions, et un clic un peu plus haut ne faisait RIEN (la case visée
// tombait en diagonale, que le store ignore). C'est le bug « le perso se
// déplace au lieu d'ouvrir la popup ».
//
// D'où cette étiquette : un objet du jeu dit lui-même quelle case il occupe, et
// le picking la préfère au terrain qu'il masque. `heroId` n'est posé que sur MES
// héros — taper un personnage, c'est le viser lui, jamais marcher.
type PickTag = { x: number; y: number; heroId?: string };
/** Remonte la hiérarchie (les rigs sont des groupes) jusqu'à l'objet étiqueté. */
function pickTagOf(o: THREE.Object3D | null): PickTag | undefined {
  for (let n = o; n; n = n.parent) {
    const tag = (n.userData as { pickTag?: PickTag }).pickTag;
    if (tag) return tag;
  }
  return undefined;
}

// Couleur du badge de danger : jaune (#ffe066, pack minuscule) → rouge (#ff3b30,
// gros pack). `t` ∈ [0,1].
function dangerColor(t: number): string {
  const g = Math.round(0xe0 * (1 - t) + 0x3b * t);
  const b = Math.round(0x66 * (1 - t) + 0x30 * t);
  return `#ff${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

class MapWorld {
  lib = new BlockLibrary("/voxels/16");
  chars = new CharLibrary(); // modèles voxel des héros (fallback billboard)
  charMeshes: THREE.Mesh[] = []; // orientés face caméra à chaque frame
  animator: UnitAnimator; // rigs animés (idle/marche/attaque) — pose + rotation gérées ici
  /** Cycle solaire : le tick et son timer, mis en pause quand l'onglet Map est
   *  quitté (la vue reste montée, elle ne doit pas continuer à travailler). */
  sunTick?: () => void;
  sunTimer: ReturnType<typeof setInterval> | undefined;
  libReady = false;
  /** ⚠ la bibliothèque de props est-elle chargée ? La météo en dépend (nuages,
   *  vire-vents) et `BlockLibrary.get` rend `undefined` sans erreur : construite
   *  trop tôt, la couche existait mais était VIDE, et sa clé l'empêchait ensuite
   *  d'être rebâtie — un ciel couvert silencieusement absent (mesuré : 0 nuage). */
  propsReady = false;
  terrain: THREE.Group | null = null;
  terrainKey = "";
  themedFor = ""; // thème dont les modèles propres sont déjà chargés
  weatherFor = ""; // thème dont les modèles de MÉTÉO sont arrivés
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
  // LA MÉTÉO DU THÈME (weather.ts) : neige + ciel couvert au nord, vire-vents au
  // sud. Réglable, et à « Aucun » la couche n'existe pas — c'est la seule façon de
  // garder la promesse « la carte est 100 % on-demand ».
  weather: WeatherLayer;
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
    // L'idle est CADENCÉ par le réglage « Animation des personnages » (cf.
    // l'en-tête de unitAnim.ts) : à 0 la carte redevient 100 % on-demand et les
    // monstres se figent tant que rien ne bouge ; au-dessus, ils respirent au
    // rythme choisi — c'est bien un redraw complet de la scène par image, d'où
    // le réglage. Les poses restent aussi rafraîchies par `onBeforeFrame`, sur
    // les frames que d'autres demandent (rotation, redraw).
    this.animator = new UnitAnimator(engine, undefined, {
      idleFps: useStore.getState().settings.idleAnimFps,
    });
    this.weather = new WeatherLayer(engine, useStore.getState().settings.weatherFps);
    engine.scene.add(this.overlays);
    engine.scene.add(this.sprites);
    void this.lib
      .load([...BIOME_BLOCKS, "mist", "dirt"])
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
    void this.propsLib.load([
      ...PROP_KEYS, "olive",
      // la case ville rend un village miniature (mairie + portail + muraille),
      // les mêmes modèles que l'onglet Ville — plus le temple grec d'avant
      "bld-townhall", "bld-gate", "bld-wall",
      "site-ferme", "site-epave", "site-sanctuaire", "site-mine", "site-tour",
    ]).then(() => {
      this.propsReady = true;
      this.terrainKey = "";
      this.draw();
    });
    // Les rigs sont posés AVANT le rendu : posés après, ils accuseraient une
    // frame de retard, ce qui se voit quand la caméra tourne (ils font face à
    // la caméra). C'est aussi ce qui garde la respiration vivante alors que
    // l'animator ne demande plus de frames pour elle.
    engine.onBeforeFrame = () => this.animator.pose();
    // les billboards tournent avec la caméra (rotation animée incluse) ;
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

  /** (Re)construit la météo pour la partie courante. Appelée au draw et quand le
   *  réglage rallume la couche. La CLÉ résume tout ce dont la météo dépend — sans
   *  elle on rebâtirait des milliers de flocons à chaque redessin de la carte. */
  syncWeather() {
    const game = this.game;
    const theme = game?.themeId ?? "";
    // ⚠ on n'entre PAS avant que les modèles soient là : `BlockLibrary.get` rend
    // `undefined` sans rien signaler, et une couche construite trop tôt reste
    // VIDE pour de bon (sa clé l'empêche d'être rebâtie) — mesuré : 0 nuage.
    if (!game || !this.propsReady || this.weatherFor !== theme) return;
    this.weather.rebuild(`${theme}:${game.id}:${game.width}x${game.height}`, () =>
      makeWeather(theme, this.propsLib, {
        cx: (game.width - 1) / 2,
        cy: (game.height - 1) / 2,
        // marge : les vire-vents entrent et sortent hors du regard, et le pont de
        // nuages déborde des bords plutôt que de s'arrêter net sur la carte.
        span: Math.max(game.width, game.height) + 10,
        seed: strSeed(game.id),
        groundAt: (x, z) => this.smooth.heightAt(x, z),
        // Un vire-vent ne roule ni hors carte, ni sur l'eau, ni sur le brouillard.
        //
        // ⚠ ON LIT `this.game`, PAS le `game` capturé. La couche est construite UNE
        // fois par partie (sa clé la protège des redessins), or le store remplace
        // l'objet `game` à chaque rafraîchissement : une capture gèle donc la carte
        // de découverte telle qu'elle était AU LANCEMENT — c'est-à-dire la ville et
        // ses abords, et rien d'autre pour toute la partie. Les cases explorées
        // ensuite n'auraient jamais vu passer un seul vire-vent.
        passable: (x, z) => {
          const g = this.game;
          if (!g) return false;
          const t = this.tileAtWorld(g, x, z);
          return !!t?.discovered && t.biome !== 0;
        },
        view: () => ({
          x: this.engine.target.x, z: this.engine.target.z,
          w: this.engine.viewWidth, h: this.engine.viewHeight, ppu: this.engine.zoom,
        }),
      }),
    );
  }

  /** tuile sous une position monde, ou undefined hors carte */
  private tileAtWorld(game: GameState, x: number, z: number) {
    const tx = Math.round(x), ty = Math.round(z);
    if (tx < 0 || ty < 0 || tx >= game.width || ty >= game.height) return undefined;
    return game.tiles[ty * game.width + tx];
  }

  dispose() {
    this.weather.dispose();
    this.animator.dispose();
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
      townX: game.town.x, townY: game.town.y, seedStr: game.id, theme: game.themeId,
    });
    for (const p of placements) {
      // Les ARBRES sont montés d'un cran pour dominer les personnages (échelle
      // naturelle : un arbre dépasse un chibi) sans écraser la ville.
      const s = p.scale * (TREE_IDS.has(p.id) ? 1.6 : 1);
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, this.smooth.heightAt(p.x, p.y) - 0.02, p.y),
        new THREE.Quaternion().setFromAxisAngle(UP, p.rot),
        new THREE.Vector3(s, s, s),
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
      // objets LUMINEUX : lucioles + cristaux/stalagmites de givre — self-lit
      // (Basic) et posés sur le calque bloom pour RAYONNER en mode beauté.
      const glowing = GLOW_PROPS.some((g) => key.startsWith(g));
      const mesh = new THREE.InstancedMesh(geom, glowing ? GLOW_MAT : PROP_MAT, mats.length);
      for (let i = 0; i < mats.length; i++) mesh.setMatrixAt(i, mats[i]);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = !glowing;
      mesh.receiveShadow = !glowing;
      if (glowing) mesh.layers.enable(BLOOM_LAYER); // rayonne dans la passe beauté

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
    return t.discovered ? renderHeight(t) + 1 : 1.5; // brume = nappe basse (sommet à 1.5)
  }

  /** Résolution d'un tap : on vise CE QU'ON VOIT, le terrain seulement à défaut. */
  onTap(cssX: number, cssY: number) {
    const game = this.game;
    if (!game) return;
    const hits = this.engine.pick(cssX, cssY);
    let cell: { x: number; y: number } | undefined;
    let tappedHeroId: string | undefined;
    for (const h of hits) {
      // Un objet du jeu (héros, monstre, ruine, village) désigne SA case — même
      // si le rayon, en le traversant, irait frapper le sol derrière lui.
      const tag = pickTagOf(h.object);
      if (tag) { cell = { x: tag.x, y: tag.y }; tappedHeroId = tag.heroId; break; }
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
    // Taper UN DE MES HÉROS le vise LUI : menu d'actions s'il est déjà
    // sélectionné, sélection sinon. Jamais un déplacement — sans cette sortie,
    // un héros posé sur une case voisine de celle du héros actif était compris
    // comme « marche vers cette case », et le personnage filait au lieu
    // d'ouvrir sa popup.
    if (tappedHeroId) {
      if (tappedHeroId === this.selectedHeroId) bus.emit(EV.MapHeroMenu, { sx: cssX, sy: cssY });
      else bus.emit(EV.MapHeroClick, { heroId: tappedHeroId });
      return;
    }
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

    // Les modèles PROPRES AU THÈME (pyramide, drakkar, halle) ne se chargent qu'ici :
    // le constructeur ne connaît pas encore la partie, et une carte tempérée ne doit
    // pas télécharger un octet de plus. Une seule fois par thème, puis on redessine.
    if (this.themedFor !== (game.themeId ?? "")) {
      this.themedFor = game.themeId ?? "";
      // …et ce que sa MÉTÉO réclame (weather.ts) : le pont de nuages du nord, les
      // vire-vents du sud. Même règle — une carte tempérée n'en télécharge aucun.
      const keys = [...themedKeysFor(game.themeId), ...weatherPropKeys(game.themeId)];
      const forTheme = this.themedFor;
      if (keys.length) void this.propsLib.load(keys).then(() => { this.weatherFor = forTheme; this.draw(); });
      else this.weatherFor = forTheme;
    }

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
            // NAPPE BASSE (2026-07-19, −3/4 de hauteur) : un seul bloc de brume
            // écrasé à 0.5, posé sur le niveau 1 — le sommet affleure à 1.5
            cells.push({ x, y, block: "mist", levels: 1, baseY: 1, scaleY: 0.5 });
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
        // LA PEAU DU THÈME (backend theme.go) : la palette de terrain suit la nature
        // de l'expédition. Posée AVANT la construction — sans elle, une carte
        // nordique n'est qu'une carte ordinaire avec des taches blanches.
        setTerrainTheme(game.themeId);
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

    // météo du thème : construite une fois par partie (la clé la protège des
    // redessins), rien du tout en tempéré ou si le joueur l'a coupée.
    this.syncWeather();

    // --- overlays + billboards (reconstruits à chaque render, ~dizaines) -------
    clearOwned(this.overlays);
    clearOwned(this.sprites);
    this.charMeshes = [];
    this.animator.beginFrame();
    const quad = (x: number, y: number, top: number, color: number, opacity: number) => {
      const m = new THREE.Mesh(
        QUAD_GEOM,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.userData.ownMat = true;
      m.position.set(x, top + 0.045, y); // 0.02 z-fightait avec la face de brume à DPR élevé
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
        return t && !t.discovered ? 1.5 : this.smooth.heightAt(x, y) + 0.04;
      }
      const t = tileAt(x, y);
      return t ? this.levelsOf(t) : 1;
    };
    const billboard = (url: string, x: number, y: number, opts: { size?: number; alpha?: number; ox?: number; oy?: number } = {}) => {
      const tex = this.texture(url);
      const mat = new THREE.SpriteMaterial({ map: tex, alphaTest: 0.35, transparent: true, opacity: opts.alpha ?? 1 });
      const s = new THREE.Sprite(mat);
      s.userData.ownMat = true; // matériau du billboard (la texture reste en cache)
      const size = opts.size ?? 0.62;
      s.scale.set(size, size, 1);
      s.center.set(0.5, 0.04); // pieds posés sur la face du dessus
      s.position.set(x + (opts.ox ?? 0), topOf(x, y), y + (opts.oy ?? 0));
      this.sprites.add(s);
      return s;
    };
    /** Rend un objet CLIQUABLE pour la case qu'il occupe (cf. PickTag). */
    const pickable = <T extends THREE.Object3D>(o: T, tag: PickTag): T => {
      o.userData.pickTag = tag;
      return o;
    };

    // CASES ÉPUISÉES : `Tile.resources` tombé à 0, la fouille n'y rend plus
    // grand-chose. Un voile de terre retournée le dit d'un coup d'œil — sans ça
    // le joueur ne pouvait le découvrir qu'en marchant dessus et en lisant un
    // bouton grisé.
    //
    // ⚠ `resources === 0` tout seul ne veut RIEN dire : le brouillard renvoie
    // une tuile VIERGE (donc `resources: 0`, et `biome: 0` = eau) pour tout ce
    // qui n'est pas découvert. D'où les trois exclusions : non découverte, eau
    // (jamais fouillable), et la case ville (générée sans ressources, et la
    // fouille y est refusée par le serveur).
    //
    // UN SEUL InstancedMesh : sur une carte largement explorée il peut y avoir
    // des milliers de cases épuisées, un mesh par case ferait autant de draw
    // calls et ferait exploser le budget de la suite de perf.
    const depleted: { x: number; y: number }[] = [];
    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x];
        if (!t?.discovered || t.resources > 0) continue;
        if (t.biome === 0) continue;
        if (x === game.town.x && y === game.town.y) continue;
        depleted.push({ x, y });
      }
    }
    if (depleted.length) {
      const im = new THREE.InstancedMesh(
        QUAD_GEOM,
        new THREE.MeshBasicMaterial({
          map: depletedTexture(), // texture PARTAGÉE (jamais libérée : une seule pour la partie)
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
        }),
        depleted.length,
      );
      im.userData.ownMat = true; // géométrie PARTAGÉE (QUAD_GEOM) : ne pas la marquer ownGeom
      im.renderOrder = -1; // sous les losanges de déplacement, qui doivent rester lisibles
      const m4 = new THREE.Matrix4();
      depleted.forEach((c, i) => {
        m4.makeTranslation(c.x, topOf(c.x, c.y) + 0.03, c.y);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      this.overlays.add(im);
    }

    // LA NEIGE FRAÎCHE, même traitement : un seul InstancedMesh pour toute la carte.
    // ⚠ `covered` n'a de sens que sur une case DÉCOUVERTE — le fog rend une tuile
    // vierge, donc sans le drapeau, et une case cachée ne doit rien afficher.
    const snowy: { x: number; y: number }[] = [];
    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x];
        if (t?.discovered && t.covered) snowy.push({ x, y });
      }
    }
    if (snowy.length) {
      const im = new THREE.InstancedMesh(
        QUAD_GEOM,
        new THREE.MeshBasicMaterial({
          map: snowTexture(), // texture PARTAGÉE (jamais libérée)
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
        }),
        snowy.length,
      );
      im.userData.ownMat = true;
      im.renderOrder = -1;
      const m4 = new THREE.Matrix4();
      snowy.forEach((c, i) => {
        // Au-dessus du voile des cases épuisées : une case peut être les deux, et
        // c'est la neige qui commande (elle empêche la récolte).
        m4.makeTranslation(c.x, topOf(c.x, c.y) + 0.04, c.y);
        im.setMatrixAt(i, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      this.overlays.add(im);
    }

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

    // ville : socle + VILLAGE MINIATURE.
    //
    // C'était un TEMPLE GREC (colonnes de marbre, parvis dallé) — un bâtiment
    // qui n'existe nulle part ailleurs dans le jeu et qui n'avait aucun rapport
    // avec ce qu'on voit dans l'onglet Ville (village fortifié médiéval :
    // muraille, portail, mairie à beffroi). Deux architectures pour un même
    // lieu. On rend désormais la MÊME ville en réduction : la mairie au centre,
    // ceinte de quatre pans de muraille et de son portail côté caméra.
    const townTop = topOf(game.town.x, game.town.y);
    quad(game.town.x, game.town.y, townTop, 0xffffff, 0.25);
    const townPiece = (id: string, dx: number, dz: number, cells: number, rotY: number) => {
      const geom = this.propsLib.get(id, 0);
      if (!geom) return false;
      if (!geom.boundingBox) geom.computeBoundingBox();
      const bb = geom.boundingBox!;
      const w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) || 1;
      const m = pickable(new THREE.Mesh(geom, TOWN_MAT), { x: game.town.x, y: game.town.y });
      m.castShadow = m.receiveShadow = true;
      m.position.set(game.town.x + dx, townTop - 0.03, game.town.y + dz);
      m.scale.setScalar(cells / w);
      m.rotation.y = Math.PI + rotY;
      this.sprites.add(m);
      return true;
    };
    // Mairie au centre, portail devant (côté caméra), trois pans de mur derrière.
    const R = 0.42; // demi-emprise : tient dans la case sans déborder sur les voisines
    const placed =
      townPiece("bld-townhall", 0, -0.06, 0.62, 0) &&
      townPiece("bld-gate", 0, R, 0.5, 0) &&
      townPiece("bld-wall", -R, 0, 0.5, Math.PI / 2) &&
      townPiece("bld-wall", R, 0, 0.5, Math.PI / 2) &&
      townPiece("bld-wall", 0, -R, 0.5, 0);
    if (!placed)
      pickable(billboard(libUrl("buildings", "bld-church"), game.town.x, game.town.y, { size: 1.15 }), {
        x: game.town.x, y: game.town.y,
      });
    // couronne d'OLIVIERS autour du temple (déterministe par partie) — posés
    // sur la surface, jamais sur l'eau connue
    const oliveGeom = this.propsLib.get("olive", 0);
    if (oliveGeom) {
      const hash01 = (s: number) => {
        let h = 0;
        for (let i = 0; i < game.id.length; i++) h = ((h * 31 + game.id.charCodeAt(i) + s * 97) & 0xffffff) >>> 0;
        return (h % 1024) / 1024;
      };
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + hash01(1) * Math.PI;
        const r = 1.05 + hash01(i + 2) * 0.45;
        const px = game.town.x + Math.cos(a) * r;
        const py = game.town.y + Math.sin(a) * r;
        const t = tileAt(Math.round(px), Math.round(py));
        if (!t || (t.discovered && t.biome === 0)) continue;
        const o = new THREE.Mesh(this.propsLib.get("olive", i % 3), PROP_MAT);
        o.castShadow = o.receiveShadow = true;
        o.position.set(px, this.smoothMode ? this.smooth.heightAt(px, py) - 0.02 : topOf(Math.round(px), Math.round(py)), py);
        o.rotation.y = hash01(i + 9) * Math.PI * 2;
        // agrandis pour se mettre à l'échelle des arbres de la carte (boost 1.6) —
        // un olivier ridicule à côté d'un chêne sinon (retour utilisateur)
        o.scale.setScalar(0.7 + hash01(i + 20) * 0.2);
        this.sprites.add(o);
      }
    }

    // ruines-donjons : bâtiment en ruine par biome — variante choisie par ÉTAT
    // serveur (0 = enseveli, 1 = déblayé avec entrée sombre + lueur) ; socle
    // doré discret pour signaler le point d'intérêt
    for (const id in game.ruins ?? {}) {
      const ru = game.ruins![id];
      // La ruine prend la silhouette du thème quand il en a une (pyramide, drakkar) —
      // par le REGISTRE, jamais par une clé dérivée à l'aveugle (themeModels.ts).
      const geom = this.propsLib.get(themedKey(`site-${ru.type}`, game.themeId), ru.cleared ? 1 : 0);
      if (!geom) continue;
      const mesh = pickable(new THREE.Mesh(geom, PROP_MAT), { x: ru.x, y: ru.y });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.set(ru.x, topOf(ru.x, ru.y) - 0.02, ru.y);
      mesh.scale.setScalar(0.72);
      this.sprites.add(mesh);
      quad(ru.x, ru.y, topOf(ru.x, ru.y), ru.cleared && ru.charges > 0 ? 0xffd66e : 0xfff3d0, ru.cleared ? 0.35 : 0.2);
    }

    // combats en cours : un marqueur ⚔ par case de combat (plusieurs combats
    // peuvent tourner en parallèle) — les autres joueurs les voient et peuvent
    // rejoindre le leur (bouton dans la barre de la Map).
    for (const id in game.combats ?? {}) {
      const ac = game.combats![id];
      if (ac.status !== "active") continue;
      quad(ac.tileX, ac.tileY, topOf(ac.tileX, ac.tileY), 0xff4433, 0.45);
      const lbl = makeLabel("⚔️ Combat !", "#ffd166", 0.3);
      lbl.center.set(0.5, 0);
      lbl.position.set(ac.tileX, topOf(ac.tileX, ac.tileY) + 0.95, ac.tileY);
      this.sprites.add(lbl);
    }

    // monstres : sprite de créature + BADGE de dangerosité flottant AU-DESSUS
    // (jaune→rouge selon la taille du pack). Plus de teinte sur la case : le
    // losange coloré est désormais RÉSERVÉ aux cases où le héros sélectionné peut
    // aller — mélanger les deux rendait la lecture ambiguë.
    for (const id in game.monsters) {
      const m = game.monsters[id];
      const t = tileAt(m.x, m.y);
      if (!t?.discovered) continue; // cachés dans la brume
      const top = topOf(m.x, m.y);
      const tex = monsterTexKey(m.species, m.appearance);
      const rig = tex ? this.chars.makeRig(tex) : undefined;
      const mScale = bossAppearance(m.species) ? 1.8 : MONSTER_SCALE[tex ?? ""] ?? 1;
      if (rig) {
        rig.root.scale.multiplyScalar(mScale); // taille par espèce (limace ≪ boss)
        rig.root.position.set(m.x, top, m.y);
        rig.root.rotation.y = engine.azimuthNow;
        this.sprites.add(pickable(rig.root, { x: m.x, y: m.y }));
        this.animator.sync(id, rig, m.x, top, m.y, { faceCamera: true });
      } else if (tex)
        pickable(billboard(libUrl("monsters", tex), m.x, m.y, { size: 0.6 * mScale }), { x: m.x, y: m.y });
      // badge de danger : icône + taille du pack, teinte jaune (peu) → rouge (beaucoup)
      const danger = Math.min(Math.max((m.count - 1) / 5, 0), 1);
      const badge = pickable(makeLabel(`☠ ${m.count}`, dangerColor(danger), 0.24 + danger * 0.08), { x: m.x, y: m.y });
      badge.center.set(0.5, 0);
      badge.position.set(m.x, top + 0.62, m.y);
      this.sprites.add(badge);
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
          SEL_RING_GEOM,
          new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.95, depthWrite: false }),
        );
        ring.userData.ownMat = true;
        ring.position.set(h.x + ox, topOf(h.x, h.y) + 0.03, h.y + oy);
        this.overlays.add(ring);
      }
      // Phase 5 : modèle voxel de la classe quand il existe (rig animé qui tourne
      // avec la caméra), billboard PNG sinon — bascule progressive par modèle.
      // Étiquette de picking : le MODÈLE (et son étiquette de nom) désigne le
      // héros lui-même — c'est ce qui empêche un clic sur le personnage d'être
      // lu comme un clic sur la case que son corps masque. Seuls MES héros
      // portent l'id : ceux des autres joueurs ne valent que pour leur case.
      const tag: PickTag = mine ? { x: h.x, y: h.y, heroId: h.id } : { x: h.x, y: h.y };
      const mesh = this.chars.makeRig(heroKey(h.class));
      if (mesh) {
        const by = topOf(h.x, h.y);
        mesh.root.position.set(h.x + ox, by, h.y + oy);
        mesh.root.rotation.y = engine.azimuthNow;
        if (!mine) setRigOpacity(mesh, OTHER_ALPHA); // héros des autres : translucides
        this.sprites.add(pickable(mesh.root, tag));
        this.animator.sync(h.id, mesh, h.x + ox, by, h.y + oy, { faceCamera: true });
        if (mine) {
          const lbl = pickable(makeLabel(h.name, "#fff6d8", 0.2), tag);
          lbl.center.set(0.5, 0);
          lbl.position.set(h.x + ox, topOf(h.x, h.y) + 0.82, h.y + oy);
          this.sprites.add(lbl);
        }
      } else {
        pickable(
          billboard(libUrl("characters", heroTexKey(h.class)), h.x, h.y, {
            alpha: mine ? 1 : OTHER_ALPHA,
            ox, oy,
          }),
          tag,
        );
      }
    }

    this.animator.endFrame(); // oublie les unités disparues, garde l'état des présentes

    this.engine.refreshShadows(); // le contenu a pu changer (terrain/props/sprites)

    // cadrage initial : zoomé sur la ville (comme MapScene)
    if (!this.fitted) {
      engine.target.set(game.town.x, 0, game.town.y);
      engine.zoom = 42;
      this.fitted = true;
    }
    engine.invalidate();
  }
}

// Pas de nuages PERMANENTS ici (retour 2026-07-19 : la boucle continue sur la
// scène LOURDE lagait sur téléphone) — la carte est 100 % on-demand ; les nuages
// vivent sur la vue VILLE, légère. La seule exception est la MÉTÉO D'UN THÈME
// (weather.ts) : elle apporte son pont de nuages avec la neige du nord, mais
// c'est un effet OPTIONNEL, cadencé, absent des cartes tempérées et supprimable
// d'un tap (Paramètres → « Effets de météo »).
//
// `active` = l'onglet Map est-il celui qu'on regarde ? La vue reste MONTÉE toute
// la partie (démonter le moteur rendait l'ouverture de l'onglet interminable) et
// n'est que masquée en CSS — donc c'est à elle de se taire : sans ça, elle
// animait et faisait tourner son cycle solaire derrière un `visibility: hidden`.
export function VoxelMapView({ active = true }: { active?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const worldRef = useRef<MapWorld | null>(null);
  const [topDown, setTopDown] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const engine = new VoxelEngine(host);
    engineRef.current = engine;
    engine.minZoom = 14;
    engine.maxZoom = 120;
    const controls = new VoxelControls(engine);
    const world = new MapWorld(engine);
    worldRef.current = world;
    controls.onTap = (t) => world.onTap(t.cssX, t.cssY);
    // mode terrain (blocs ⇄ lisse) + passe beauté depuis les Réglages, à chaud
    world.smoothMode = useStore.getState().settings.voxelSmooth;
    engine.setBeauty(useStore.getState().settings.voxelBeauty);
    engine.setSignac(useStore.getState().settings.voxelSignac, useStore.getState().settings.signacStrength);
    const unsubSettings = useStore.subscribe((s, prev) => {
      if (s.settings.voxelSmooth !== prev.settings.voxelSmooth) {
        world.smoothMode = s.settings.voxelSmooth;
        world.draw();
      }
      if (s.settings.voxelBeauty !== prev.settings.voxelBeauty) {
        engine.setBeauty(s.settings.voxelBeauty);
      }
      if (
        s.settings.voxelSignac !== prev.settings.voxelSignac ||
        s.settings.signacStrength !== prev.settings.signacStrength
      )
        engine.setSignac(s.settings.voxelSignac, s.settings.signacStrength);
      if (s.settings.idleAnimFps !== prev.settings.idleAnimFps)
        world.animator.setIdleFps(s.settings.idleAnimFps);
      if (s.settings.weatherFps !== prev.settings.weatherFps)
        // rallumer demande une RECONSTRUCTION : à « Aucun » la couche n'était pas
        // figée, elle n'existait pas (cf. l'en-tête de weather.ts).
        world.weather.setFps(s.settings.weatherFps, () => world.syncWeather());
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
    // recentrage caméra sur un héros (sélection depuis la barre de héros) :
    // la cible glisse vers la case du héros, le zoom courant est conservé.
    const offFocus = bus.on(EV.MapFocusHero, (p: { x: number; y: number }) => {
      engine.target.set(p.x, engine.target.y, p.y);
      engine.invalidate();
    });
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
    world.sunTick = sunTick; // re-joué au retour sur l'onglet (cf. l'effet `active`)
    const sunTimer = setInterval(sunTick, 5000);
    world.sunTimer = sunTimer;

    if (import.meta.env.DEV) (window as unknown as { __vm?: unknown }).__vm = { engine, world };
    return () => {
      off();
      offFocus();
      unsubSettings();
      clearInterval(world.sunTimer);
      controls.dispose();
      world.dispose();
      engine.dispose();
      engineRef.current = null;
      worldRef.current = null;
    };
  }, []);

  // Onglet quitté : on coupe l'animation ET le cycle solaire. Retrouvé : on
  // rattrape le cycle d'un coup (l'heure du jour dépend du timer de vague, pas
  // du nombre de ticks) puis on relance.
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    world.animator.setActive(active);
    world.weather.setActive(active);
    clearInterval(world.sunTimer);
    if (active) {
      world.sunTick?.();
      world.sunTimer = setInterval(() => world.sunTick?.(), 5000);
    }
  }, [active]);

  return (
    <>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      {/* la rotation 4 orientations — LA nouveauté 3D de la carte voxel */}
      <div className="view-rot">
        {/* Vue de dessus, comme en combat : à 30° les reliefs cachent ce qui se
            trouve derrière eux — un pack de monstres, une ruine, un héros au
            pied d'une falaise. Le moteur ne change QUE l'élévation : azimut,
            zoom et cible sont conservés, on retrouve donc sa vue en ressortant. */}
        <button
          className={`iconbtn${topDown ? " on" : ""}`}
          aria-pressed={topDown}
          title={topDown ? "Vue inclinée" : "Vue de dessus (voir ce que les reliefs cachent)"}
          onClick={() => {
            const v = !topDown;
            setTopDown(v);
            engineRef.current?.setTopDown(v);
          }}
        >
          {topDown ? "🎥" : "🔼"}
        </button>
        <button className="iconbtn" aria-label="Pivoter la vue à gauche" onClick={() => engineRef.current?.rotate(-1)}>
          ↺
        </button>
        <button className="iconbtn" aria-label="Pivoter la vue à droite" onClick={() => engineRef.current?.rotate(1)}>
          ↻
        </button>
      </div>
    </>
  );
}

const UP = new THREE.Vector3(0, 1, 0);
/** graine numérique stable tirée de l'id de partie (la seed serveur est masquée
 *  par le fog) — même vent d'une session à l'autre pour une même expédition. */
function strSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0;
  return h % 100000;
}
const PROP_MAT = signacify(new THREE.MeshLambertMaterial({ vertexColors: true }));
// matériau des objets LUMINEUX (lucioles, cristaux, givre) : self-lit (Basic) →
// couleurs pleines, luit dans la pénombre, et alimente le bloom sélectif.
const GLOW_MAT = new THREE.MeshBasicMaterial({ vertexColors: true });
const GLOW_PROPS = ["firefly", "crystal", "ice-spike"]; // props posés sur le calque bloom
// le temple est surtout fait de FACES VERTICALES : ombrage cuit du mesher +
// Lambert = double peine → petite émissive chaude pour garder le marbre clair
// Village de la case ville : surtout des faces verticales, dont l'ombrage est
// déjà CUIT par le mesher — sans l'émissif le Lambert les assombrit une seconde
// fois et le bourg vire au gris.
const TOWN_MAT = signacify(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0x4a453e) }));

