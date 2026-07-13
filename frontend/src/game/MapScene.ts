import Phaser from "phaser";
import type { GameState, Hero } from "../api/types";
import { Biome } from "../api/types";
import { bus, EV } from "../eventBus";
import { BIOME_COLORS, HERO_COLOR, HERO_COLOR_SELECTED, MONSTER_COLOR, OTHER_HERO_COLOR, darken } from "./render";
import { monsterTexKey, heroTexKey, HERO_TEX_KEYS } from "../assets";
import { DPR } from "./dpr";
import { shrinkTexture, shrinkUnitTextures, TOWN_TEX_SIZE } from "./textureUtils";

// --- Isometric tunables -----------------------------------------------------
// The whole map is drawn as 2:1 isometric cubes (FFTA2-style). Each tile is a
// PILLAR: its biome cube is stacked from level 0 up to the tile's Perlin height,
// so mountains/snow read as solid raised terraces and water stays a flat sea.
const TILE_W = 48; // iso diamond width (world px)
const TILE_H = 24; // iso diamond height (= TILE_W / 2)
const CUBE_DEPTH = 24; // visible side height of one cube
const ELEV = CUBE_DEPTH; // vertical px per height level (== CUBE_DEPTH so stacks connect)
// Supersample factor for the normalized cube textures. Scales with the device
// pixel ratio so cubes stay crisp on the DPR-sized canvas (a 96px cube upscaled
// ~1.5× on a DPR-3 phone reads soft); capped so the pillar atlas stays bounded.
const SS = Math.min(6, 2 * Math.round(DPR));

// The plains are the level-0 reference ground: water/sand/grass stay flat at 0, and
// only forest/mountain/snow rise, by their Perlin height above this baseline.
const GROUND_LEVEL = 3; // Perlin height level treated as flat ground

// Camera zoom, in CSS-pixel terms: start zoomed in on the town; wheel / pinch zoom
// between these bounds. The canvas is DPR× the CSS size, so the effective Phaser
// camera zoom is always (value × DPR) — that's what keeps the map the same
// apparent size while rendering at native device resolution.
const MIN_ZOOM = 0.35 * DPR;
const MAX_ZOOM = 2.5 * DPR;
const DEFAULT_ZOOM = 1.0 * DPR;

// Tap-vs-drag tolerance. Pointer coords are in canvas (physical) pixels, so the
// slop must scale with DPR — a fixed 8px was ~2.7 CSS px on a DPR-3 phone and
// ordinary finger taps were being swallowed as drags.
const TAP_SLOP = 10 * DPR;

// Units (heroes/monsters) and the town building render small relative to the tiles
// so the terrain reads first (they used to span nearly a full tile).
const UNIT_SCALE = 1 / 3;

// Fog of war: the server never sends undiscovered tiles (biome/height/resources are
// blank in the payload). They render as procedural CLOUD blocks — soft pastel cube
// silhouettes with puffy bumps, baked into the shared pillar atlas (pairs
// `cloud{v}:1`) so the unexplored world reads as a sea of clouds instead of black.
const CLOUD_VARIANTS = 6; // per-tile variant picked by position hash (breaks tiling)
const CLOUD_TOP = "#f8fbff";
const CLOUD_MID = "#dde7f5";
const CLOUD_SHADOW = "#bccbe3"; // creases between puffs
const CLOUD_BOT = "#a9bad6";
// Flat fallback color for undiscovered tiles while the atlas isn't baked yet.
const FOG_FALLBACK = 0xd7e0ee;

// Biome index (0..5) -> iso cube filename under /assets/isotiles/.
const ISO_TILE_FILES = ["water", "sand", "grass", "forest", "stone", "snow"];
// Monster creature sprites (loaded for use instead of the plain token).
const MONSTER_FILES = ["mob-goblin", "mob-slime", "mob-windelemental"];
// Building sprite that represents the town/home on the map (swap the filename to
// change it — e.g. townhall / bld-abbey / bld-monastery, all under /assets/buildings/).
const TOWN_BUILDING_FILE = "bld-church";

// MapScene renders the global map as an isometric world with elevation and turns
// pointer clicks into movement/selection intents. It owns no game logic. The
// React<->Phaser contract (MapRender / MapTileClick / MapHeroClick / MapHeroMenu)
// is unchanged, so the rest of the app is agnostic to the iso switch.
export class MapScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics; // overlay (labels' companions, fallbacks) — always on top
  private labels: Phaser.GameObjects.Text[] = [];
  // Static terrain layer: ONE image per tile (a pre-baked pillar frame from the shared
  // atlas). The server only sends discovered tiles (fog of war is enforced in the
  // HTTP payload), so a tile's real biome/height arrive AFTER discovery — the layer
  // is therefore diffed per draw: frame + tint per tile, only changes are touched.
  private tileImgAt: (Phaser.GameObjects.Image | null)[] = []; // indexed y*width+x
  private tileFrameAt: string[] = []; // atlas frame currently bound per tile ("" = none)
  private tileTintAt: number[] = []; // last tint applied per tile (avoids redundant setTint)
  private tilesKey = ""; // game id + dims the tile layer was built for
  private atlasPairs = new Set<string>(); // "biome:height" pillars baked into pillar-atlas
  private unitSprites: Phaser.GameObjects.Image[] = []; // hero/monster sprites (rebuilt each draw)
  private cubesReady = false; // normalized cube textures built?
  private townBuildingAspect = 0; // height/width of the normalized town building (0 = not ready)
  private gs?: GameState;
  private selectedHeroId?: string;
  // Multiplayer: my team's hero ids (empty = legacy solo, everyone is "mine").
  // Other players' heroes render as small distinct dots, hidden unless showOthers.
  private myHeroIds: string[] = [];
  private showOthers = false;

  private isMine(heroId: string): boolean {
    return this.myHeroIds.length === 0 || this.myHeroIds.includes(heroId);
  }
  private fitted = false;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  // Pinch baseline, captured when the 2nd finger lands. The gesture is applied as an
  // ABSOLUTE mapping from this baseline (zoom = startZoom × dist/startDist, and the
  // world point grabbed at start is re-pinned under the fingers' midpoint on every
  // event) — the previous incremental zoom-then-pan compounded per-event anchor
  // errors (touch events arrive one finger at a time, so the midpoint oscillates
  // while the zoom changes) into a visible sideways drift.
  private pinchStartDist = 0; // 0 = no pinch in progress
  private pinchStartZoom = 0;
  private pinchWorldX = 0; // world point under the start midpoint — stays glued to it
  private pinchWorldY = 0;

  constructor() {
    super("map");
  }

  preload() {
    // Raw iso cube tiles (1024² with transparent margins) — normalized at runtime.
    ISO_TILE_FILES.forEach((name, i) => this.load.image(`iso-raw-${i}`, `/assets/isotiles/${name}.png`));
    // Monster creature sprites (optional — falls back to a token if absent).
    MONSTER_FILES.forEach((name) => this.load.image(name, `/assets/monsters/${name}.png`));
    // Town/home building sprite (optional — falls back to the ⌂ marker if absent).
    this.load.image("town-raw", `/assets/buildings/${TOWN_BUILDING_FILE}.png`);
    // Hero character sprites (optional — falls back to a token if absent).
    HERO_TEX_KEYS.forEach((name) => this.load.image(name, `/assets/characters/${name}.png`));
  }

  create() {
    this.g = this.add.graphics();
    this.g.setDepth(10000); // overlay sits above every cube + unit
    // No camera background: the canvas is transparent so the app's sky background
    // (.sky, same as the Home tab) shows behind the map.

    this.buildHighlightTextures();

    this.buildCubeTextures();
    this.buildTownBuilding();
    // Unit sprites arrive as 1024² PNGs but are displayed at ≤ ~40 world px —
    // downscale them to their max on-screen size (frees ~45 MiB of GPU memory).
    shrinkUnitTextures(this, [...MONSTER_FILES, ...HERO_TEX_KEYS]);

    const offRender = bus.on(
      EV.MapRender,
      (p: {
        game: GameState;
        selectedHeroId?: string;
        myHeroIds?: string[];
        showOthers?: boolean;
      }) => {
        const changedGame = this.gs?.id !== p.game.id;
        this.gs = p.game;
        this.selectedHeroId = p.selectedHeroId;
        this.myHeroIds = p.myHeroIds ?? [];
        this.showOthers = !!p.showOthers;
        if (changedGame) this.fitted = false;
        this.draw();
      },
    );
    const onResize = () => {
      this.fitted = false;
      this.draw();
    };
    this.scale.on("resize", onResize);
    // Cube textures normalize from images that load asynchronously; if they finish
    // AFTER the first MapRender, rebuild the cube layer once the loader completes.
    const onLoaded = () => {
      this.buildCubeTextures();
      this.buildTownBuilding();
      // Same-task shrink + draw: unit images referencing the old textures are
      // recreated by the draw() below before any frame can render.
      shrinkUnitTextures(this, [...MONSTER_FILES, ...HERO_TEX_KEYS]);
      if (this.gs) {
        this.tilesKey = ""; // force the cube layer to rebuild now that textures exist
        this.draw();
      }
    };
    this.load.on(Phaser.Loader.Events.COMPLETE, onLoaded);
    // Remove external listeners when this scene is torn down, otherwise a destroyed
    // scene keeps reacting to bus events and crashes (this.add becomes null).
    const cleanup = () => {
      offRender();
      this.scale.off("resize", onResize);
      this.load.off(Phaser.Loader.Events.COMPLETE, onLoaded);
      this.tileImgAt.forEach((im) => im?.destroy());
      this.tileImgAt = [];
      this.tileTintAt = [];
      this.tilesKey = "";
      this.unitSprites.forEach((s) => s.destroy());
      this.unitSprites = [];
    };
    this.events.once("shutdown", cleanup);
    this.events.once("destroy", cleanup);

    // Allow a second pointer so pinch-to-zoom works on touch.
    this.input.addPointer(1);

    // Drag to pan; a click only fires if the pointer barely moved.
    // Two fingers = pinch zoom (glued to the finger midpoint) + two-finger pan.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.downX = p.x;
      this.downY = p.y;
      this.dragged = false;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      if (p1.isDown && p2.isDown) {
        // Second finger just landed: capture the pinch baseline (finger distance,
        // zoom, and the world point under the midpoint). A pinch is never a click.
        const cam = this.cameras.main;
        this.pinchStartDist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        this.pinchStartZoom = cam.zoom;
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        this.pinchWorldX = cam.scrollX + cam.width / 2 + (midX - cam.width / 2) / cam.zoom;
        this.pinchWorldY = cam.scrollY + cam.height / 2 + (midY - cam.height / 2) / cam.zoom;
        this.dragged = true;
      }
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const cam = this.cameras.main;
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      // Pinch: zoom is the baseline zoom scaled by dist/startDist, and the scroll is
      // SET (not nudged) so the baseline world point sits exactly under the current
      // midpoint — zooming and two-finger panning in one drift-free formula.
      if (p1.isDown && p2.isDown) {
        if (this.pinchStartDist > 0) {
          const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          const z = Phaser.Math.Clamp(
            (this.pinchStartZoom * dist) / this.pinchStartDist,
            MIN_ZOOM,
            MAX_ZOOM,
          );
          cam.setZoom(z);
          cam.scrollX = this.pinchWorldX - cam.width / 2 - (midX - cam.width / 2) / z;
          cam.scrollY = this.pinchWorldY - cam.height / 2 - (midY - cam.height / 2) / z;
        }
        this.dragged = true;
        return;
      }
      this.pinchStartDist = 0;
      if (!p.isDown) return;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      if (Math.abs(p.x - this.downX) + Math.abs(p.y - this.downY) > TAP_SLOP) this.dragged = true;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      // One finger lifted = the pinch (its baseline) is over; the remaining finger
      // resumes a plain one-finger pan via its own prevPosition (no jump).
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) this.pinchStartDist = 0;
      if (!this.dragged) this.onClick(p);
    });

    // Mouse wheel zoom toward the cursor.
    this.input.on(
      "wheel",
      (
        ptr: Phaser.Input.Pointer,
        _o: unknown,
        _dx: number,
        dy: number,
      ) => {
        this.zoomBy(dy > 0 ? 0.9 : 1.1, ptr.x, ptr.y);
      },
    );

    // Handlers are registered — ask React to (re)push the current state. This is what
    // lets the scene pre-build its tile layer while the Map tab is still hidden (a
    // push sent before create() would find no listener).
    bus.emit(EV.MapSceneReady);
  }

  // Multiply the camera zoom by `factor` (clamped), keeping the world point under the
  // screen anchor (sx,sy) stationary so zoom feels anchored to the cursor.
  // The screen<->world mapping is computed by hand (screen = (world - scroll - c)·zoom + c,
  // c = camera centre): cam.getWorldPoint reads the camera matrix, which is only
  // refreshed on preRender — calling it right after setZoom mixes old and new zoom
  // and mis-anchors the zoom by one event's worth of error.
  private zoomBy(factor: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const wx = cam.scrollX + cx + (sx - cx) / cam.zoom;
    const wy = cam.scrollY + cy + (sy - cy) / cam.zoom;
    const z = Phaser.Math.Clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    cam.setZoom(z);
    cam.scrollX = wx - cx - (sx - cx) / z;
    cam.scrollY = wy - cy - (sy - cy) / z;
  }

  // --- iso projection --------------------------------------------------------

  private projSx(cx: number, cy: number): number {
    return (cx - cy) * (TILE_W / 2);
  }
  private projSy(cx: number, cy: number, level: number): number {
    return (cx + cy) * (TILE_H / 2) - level * ELEV;
  }
  // Render height: water/sand/grass are the flat level-0 ground (plains); only
  // forest/mountain/snow rise, by their Perlin height above the plains baseline.
  private renderHeight(t: { biome: Biome; height: number }): number {
    if (t.biome === Biome.Water || t.biome === Biome.Sand || t.biome === Biome.Grass) return 0;
    return Math.max(0, t.height - GROUND_LEVEL);
  }
  // Top-face centre (screen point) of a tile, accounting for its stacked height.
  private topFace(cx: number, cy: number, level: number): { sx: number; sy: number } {
    return { sx: this.projSx(cx, cy), sy: this.projSy(cx, cy, level) - CUBE_DEPTH };
  }

  // Fog of war: a tile is visible once explored (shared discovered flag); the town is
  // always visible. There is no client-side reveal-all — the server does not even
  // send undiscovered tiles.
  private isVisible(x: number, y: number): boolean {
    if (this.gs && x === this.gs.town.x && y === this.gs.town.y) return true;
    return !!this.gs?.tiles[y * this.gs.width + x]?.discovered;
  }

  // --- cube texture normalization --------------------------------------------
  // The raw iso PNGs are 1024² with large transparent margins and aren't uniformly
  // framed. We measure each one's opaque content bbox once and re-draw it into a
  // uniform box (TILE_W × (TILE_H+CUBE_DEPTH)). All cubes then tessellate (same
  // width), sit on the grid, and stack cleanly (uniform depth) — the cost is a
  // tiny vertical stretch, exactly the editor's trade-off.
  private buildCubeTextures() {
    if (this.cubesReady) return;
    let built = 0;
    for (let i = 0; i < ISO_TILE_FILES.length; i++) {
      const rawKey = `iso-raw-${i}`;
      const cubeKey = `iso-cube-${i}`;
      if (this.textures.exists(cubeKey)) {
        built++;
        continue;
      }
      if (!this.textures.exists(rawKey)) continue;
      const src = this.textures.get(rawKey).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      const bb = this.opaqueBBox(src);
      if (!bb) continue;
      const { left, top, sw, sh } = bb;

      // Re-draw the content into a uniform, bottom-anchored cube box.
      const W = TILE_W * SS;
      const H = (TILE_H + CUBE_DEPTH) * SS;
      const out = document.createElement("canvas");
      out.width = W;
      out.height = H;
      const octx = out.getContext("2d");
      if (!octx) continue;
      octx.imageSmoothingEnabled = true;
      octx.drawImage(src, left, top, sw, sh, 0, 0, W, H);
      if (this.textures.exists(cubeKey)) this.textures.remove(cubeKey);
      this.textures.addCanvas(cubeKey, out);
      // The raw 1024² source is only needed for this normalization — free its GPU copy.
      this.textures.remove(rawKey);
      built++;
    }
    if (built === ISO_TILE_FILES.length) this.cubesReady = true;
  }

  private cubeKeyFor(biome: Biome): string | undefined {
    const key = `iso-cube-${biome}`;
    return this.textures.exists(key) ? key : undefined;
  }

  // Measure a sprite's opaque content bounding box (alpha > 16). The scan runs on a
  // ≤256px downscaled copy (≈16× fewer pixels than the 1024² sources) and the box is
  // mapped back with a 1-source-pixel safety margin — startup no longer stalls on
  // seven full-resolution getImageData scans. Falls back to the full image on error.
  private opaqueBBox(
    src: HTMLImageElement | HTMLCanvasElement,
  ): { left: number; top: number; sw: number; sh: number } | null {
    const nw = (src as HTMLImageElement).naturalWidth || src.width;
    const nh = (src as HTMLImageElement).naturalHeight || src.height;
    if (!nw || !nh) return null;
    const scale = Math.min(1, 256 / Math.max(nw, nh));
    const mw = Math.max(1, Math.round(nw * scale));
    const mh = Math.max(1, Math.round(nh * scale));
    const meas = document.createElement("canvas");
    meas.width = mw;
    meas.height = mh;
    const mctx = meas.getContext("2d");
    if (!mctx) return null;
    mctx.drawImage(src, 0, 0, mw, mh);
    let left = mw,
      right = 0,
      top = mh,
      bottom = 0;
    try {
      const data = mctx.getImageData(0, 0, mw, mh).data;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          if (data[(y * mw + x) * 4 + 3] > 16) {
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
          }
        }
      }
    } catch {
      return { left: 0, top: 0, sw: nw, sh: nh };
    }
    if (right < left || bottom < top) return { left: 0, top: 0, sw: nw, sh: nh };
    const pad = scale < 1 ? 1 : 0; // downscaling can blur a source pixel away — keep it
    const L = Math.max(0, Math.floor(left / scale) - pad);
    const T = Math.max(0, Math.floor(top / scale) - pad);
    const R = Math.min(nw, Math.ceil((right + 1) / scale) + pad);
    const B = Math.min(nh, Math.ceil((bottom + 1) / scale) + pad);
    return { left: L, top: T, sw: R - L, sh: B - T };
  }

  // Highlight textures (move-target diamond, selection ring). They are placed as
  // per-tile Images with iso depths — drawing them on the top overlay put them OVER
  // the character sprites, which made the move indicators cover the heroes.
  private buildHighlightTextures() {
    if (!this.textures.exists("hl-diamond")) {
      const lw = 2 * SS;
      const c = document.createElement("canvas");
      c.width = TILE_W * SS;
      c.height = TILE_H * SS;
      const ctx = c.getContext("2d");
      if (ctx) {
        const hw = c.width / 2;
        const hh = c.height / 2;
        ctx.strokeStyle = "#ffffff"; // white — tinted per use
        ctx.lineWidth = lw;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(hw, lw / 2);
        ctx.lineTo(c.width - lw / 2, hh);
        ctx.lineTo(hw, c.height - lw / 2);
        ctx.lineTo(lw / 2, hh);
        ctx.closePath();
        ctx.stroke();
        this.textures.addCanvas("hl-diamond", c);
      }
    }
    if (!this.textures.exists("hl-ring")) {
      const lw = 2.5 * SS;
      const w = (TILE_W - 8) * SS;
      const h = ((TILE_W - 8) / 2) * SS;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.ellipse(w / 2, h / 2, (w - lw) / 2, (h - lw) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        this.textures.addCanvas("hl-ring", c);
      }
    }
  }

  // --- pillar atlas ------------------------------------------------------------
  // Bake every (biome, render-height) pillar the map needs — the biome cube stacked
  // h+1 times — into ONE shared canvas atlas. Each tile then becomes a single Image
  // using its atlas frame instead of h+1 stacked cube images: ~500 objects instead of
  // ~1500, and one shared texture so the whole terrain renders as a single batch.
  // The server only sends discovered tiles, so new pairs appear as players explore:
  // the atlas is rebaked (union of pairs) and `rebuilt` tells draw() to rebind every
  // tile image to the fresh texture.
  private ensurePillarAtlas(game: GameState): { ready: boolean; rebuilt: boolean } {
    if (!this.cubeKeyFor(Biome.Grass)) return { ready: false, rebuilt: false }; // cubes not ready yet
    const need = new Set<string>();
    // The cloud pillars (fog of war) are always needed. `h` is 1: the puffy bumps
    // rise one elevation level above the top face, so the cell needs the headroom.
    for (let v = 0; v < CLOUD_VARIANTS; v++) need.add(`cloud${v}:1`);
    for (const t of game.tiles) {
      if (!t.discovered) continue; // blank in the payload — rendered as a cloud pillar
      if (!this.cubeKeyFor(t.biome)) continue; // missing biome texture -> tile skipped
      need.add(`${t.biome}:${this.renderHeight(t)}`);
    }
    let covered = this.textures.exists("pillar-atlas");
    for (const p of need) if (!this.atlasPairs.has(p)) covered = false;
    if (covered) return { ready: true, rebuilt: false };

    const all = new Set([...this.atlasPairs, ...need]);
    const pairs = [...all].map((p) => {
      const [b, h] = p.split(":");
      return { p, b, h: Number(h) };
    });
    const cellW = TILE_W * SS;
    const pillarH = (h: number) => (TILE_H + CUBE_DEPTH + h * ELEV) * SS;
    const cellH = Math.max(...pairs.map((q) => pillarH(q.h)));
    // Column count bounded by the safe GPU texture width (SS scales with DPR).
    const cols = Math.min(Math.max(1, Math.floor(4096 / cellW)), pairs.length);
    const rows = Math.ceil(pairs.length / cols);
    const canvas = document.createElement("canvas");
    canvas.width = cols * cellW;
    canvas.height = rows * cellH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ready: false, rebuilt: false };
    for (let i = 0; i < pairs.length; i++) {
      const { b, h } = pairs[i];
      const cx = (i % cols) * cellW;
      const bottom = (Math.floor(i / cols) + 1) * cellH;
      if (b.startsWith("cloud")) {
        this.drawCloudInto(ctx, cx, bottom, cellW, pillarH(h), Number(b.slice(5)));
        continue;
      }
      const cube = this.textures.get(`iso-cube-${b}`).getSourceImage() as HTMLCanvasElement;
      for (let lvl = 0; lvl <= h; lvl++) {
        ctx.drawImage(cube, cx, bottom - (TILE_H + CUBE_DEPTH + lvl * ELEV) * SS);
      }
    }
    if (this.textures.exists("pillar-atlas")) this.textures.remove("pillar-atlas");
    const tex = this.textures.addCanvas("pillar-atlas", canvas);
    if (!tex) return { ready: false, rebuilt: false };
    for (let i = 0; i < pairs.length; i++) {
      const { p, h } = pairs[i];
      tex.add(`p${p}`, 0, (i % cols) * cellW, (Math.floor(i / cols) + 1) * cellH - pillarH(h), cellW, pillarH(h));
    }
    this.atlasPairs = all;
    return { ready: true, rebuilt: true };
  }

  // Paint one cloud-block variant into its atlas cell: the iso cube silhouette in
  // soft pastel whites (so adjacent fog tiles tessellate into a continuous cloud
  // sea, exactly like terrain cubes do) topped with puffy bumps rising into the
  // one-level headroom above the top face. Deterministic per variant (seeded LCG)
  // so rebakes are stable. Everything is clipped to the cell so nothing bleeds
  // into neighbouring atlas cells.
  private drawCloudInto(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bottom: number,
    cellW: number,
    pillarPx: number,
    variant: number,
  ) {
    const W = cellW;
    const th = TILE_H * SS; // top-face diamond height
    const cd = CUBE_DEPTH * SS; // extruded side height
    const topY = bottom - (th + cd); // diamond's top corner (headroom above is for bumps)
    const midY = topY + th / 2;
    const botY = topY + th;
    const cmx = cx + W / 2;
    let seed = (variant + 1) * 48271;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, bottom - pillarPx, W, pillarPx);
    ctx.clip();

    // Cube silhouette (top diamond + sides). The top face's BASE tone is the mid
    // color — the light puff balls drawn over it need contrast to read (a near-white
    // base swallowed them and the fog looked like a flat snow plain).
    const grad = ctx.createLinearGradient(0, topY, 0, botY + cd);
    grad.addColorStop(0, CLOUD_MID);
    grad.addColorStop(0.6, CLOUD_MID);
    grad.addColorStop(1, CLOUD_BOT);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(cmx, topY);
    ctx.lineTo(cx + W, midY);
    ctx.lineTo(cx + W, midY + cd);
    ctx.lineTo(cmx, botY + cd);
    ctx.lineTo(cx, midY + cd);
    ctx.lineTo(cx, midY);
    ctx.closePath();
    ctx.fill();

    // Soft billowy top: only SOFT radial-gradient patches (no hard circle edges —
    // hard shadow slivers peeking from under hard light blobs read as scratches).
    // Shadow patches first, then highlight patches: the deck gently undulates.
    const soft = (bx: number, by: number, r: number, rgb: string, a: number) => {
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, r);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();
    };
    const inDiamond = (u: number, v: number) => ({
      bx: cmx + ((u - v) * W) / 2,
      by: topY + ((u + v) * th) / 2,
    });
    for (let i = 0; i < 3; i++) {
      const { bx, by } = inDiamond(0.22 + rnd() * 0.56, 0.22 + rnd() * 0.56);
      soft(bx, by + th * 0.04, (0.26 + rnd() * 0.14) * W, "150,172,208", 0.4 + rnd() * 0.15);
    }
    for (let i = 0; i < 5; i++) {
      const { bx, by } = inDiamond(0.16 + rnd() * 0.68, 0.16 + rnd() * 0.68);
      soft(bx, by - th * 0.04, (0.2 + rnd() * 0.12) * W, "255,255,255", 0.75 + rnd() * 0.2);
    }
    // Bumps straddling the two upper edges, rising into the headroom (kept off the
    // corners so tile borders stay seamless). Hard edges are fine here — they ARE
    // the silhouette.
    ctx.fillStyle = CLOUD_TOP;
    const bumps = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < bumps; i++) {
      const t = 0.18 + ((i + rnd() * 0.6) / bumps) * 0.64; // 0.18..0.82 across the tile
      const bx = cx + t * W;
      const by = topY + Math.abs(t - 0.5) * th; // y on the upper edges
      ctx.beginPath();
      ctx.arc(bx, by, (0.12 + rnd() * 0.09) * W, 0, Math.PI * 2);
      ctx.fill();
    }
    // Soft mid-tone patches low on the sides so the block base reads fluffy too.
    for (let i = 0; i < 3; i++) {
      const bx = cx + (0.15 + rnd() * 0.7) * W;
      const by = midY + cd * (0.5 + rnd() * 0.4);
      soft(bx, by, (0.12 + rnd() * 0.09) * W, "150,172,208", 0.35);
    }
    ctx.restore();
  }

  // Frame + pillar height a tile renders with. Undiscovered tiles are blank in the
  // server payload — they render as a cloud pillar whatever the cheat toggles say
  // (the client simply doesn't have their terrain). The cloud variant is a stable
  // position hash so the cloud sea doesn't visibly tile.
  private tileFrameAndHeight(
    t: { biome: Biome; height: number; discovered?: boolean },
    x: number,
    y: number,
  ): {
    frame: string;
    h: number;
  } {
    if (!t.discovered) {
      // Bit-mixed hash: a plain linear combo (7x+11y) lines the variants up along
      // diagonals and the cloud sea visibly repeats.
      const v = (((x * 92837111) ^ (y * 689287499)) >>> 0) % CLOUD_VARIANTS;
      return { frame: `pcloud${v}:1`, h: 1 };
    }
    const h = this.renderHeight(t);
    return { frame: `p${t.biome}:${h}`, h };
  }

  // Build a tight, content-cropped texture for the town building (preserving aspect),
  // so it stands cleanly on the town tile instead of floating in transparent margins.
  private buildTownBuilding() {
    if (this.townBuildingAspect > 0) return;
    if (this.textures.exists("town-building")) {
      const img = this.textures.get("town-building").getSourceImage();
      this.townBuildingAspect = img.height / img.width;
      return;
    }
    if (!this.textures.exists("town-raw")) return;
    const src = this.textures.get("town-raw").getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    const bb = this.opaqueBBox(src);
    if (!bb) return;
    // Crop to content AND cap to the building's max on-screen size (≈101 world px
    // × max zoom) — no point keeping a near-1024² texture for a two-tile sprite.
    const scale = Math.min(1, TOWN_TEX_SIZE / Math.max(bb.sw, bb.sh));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(bb.sw * scale));
    out.height = Math.max(1, Math.round(bb.sh * scale));
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(src, bb.left, bb.top, bb.sw, bb.sh, 0, 0, out.width, out.height);
    this.textures.addCanvas("town-building", out);
    this.textures.remove("town-raw"); // cropped copy replaces the raw source
    this.townBuildingAspect = bb.sh / bb.sw;
  }

  // --- camera ----------------------------------------------------------------
  // Start zoomed in and centered on the town (once per game). The player pans/zooms
  // from there; we no longer fit the whole map (it was far too small to read).
  private fitCamera() {
    if (!this.gs) return;
    const game = this.gs;
    const tt = game.tiles[game.town.y * game.width + game.town.x];
    const f = this.topFace(game.town.x, game.town.y, this.renderHeight(tt));
    const cam = this.cameras.main;
    cam.setZoom(DEFAULT_ZOOM);
    // Phaser's camera midpoint is scroll + size/2 regardless of zoom — this centers
    // the town at any zoom (incl. the DPR-scaled default).
    cam.setScroll(f.sx - cam.width / 2, f.sy - cam.height / 2);
    this.fitted = true;
  }

  // heroesAt only returns MY heroes: map taps select/act on my own team, never on
  // another player's marker.
  private heroesAt(x: number, y: number): Hero[] {
    return (this.gs?.heroes || []).filter(
      (h) => h.x === x && h.y === y && h.hp > 0 && this.isMine(h.id),
    );
  }

  private selectedHero(): Hero | undefined {
    return this.gs?.heroes.find((h) => h.id === this.selectedHeroId);
  }

  // --- input -----------------------------------------------------------------

  // Pick the frontmost/topmost tile whose top-face diamond contains the world point.
  private cellAt(worldX: number, worldY: number): { x: number; y: number } | null {
    if (!this.gs) return null;
    const game = this.gs;
    let best: { x: number; y: number; rank: number } | null = null;
    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x];
        const h = this.renderHeight(t);
        const f = this.topFace(x, y, h);
        const dx = Math.abs(worldX - f.sx) / (TILE_W / 2);
        const dy = Math.abs(worldY - f.sy) / (TILE_H / 2);
        if (dx + dy <= 1) {
          const rank = (x + y) * 100 + h; // frontmost, then highest
          if (!best || rank > best.rank) best = { x, y, rank };
        }
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  private onClick(pointer: Phaser.Input.Pointer) {
    if (!this.gs) return;
    const cell = this.cellAt(pointer.worldX, pointer.worldY);
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
        // Tapped the selected hero -> open the radial action menu at the click point.
        bus.emit(EV.MapHeroMenu, { sx: pointer.x, sy: pointer.y });
      } else {
        // Otherwise select the hero on that tile.
        bus.emit(EV.MapHeroClick, { heroId: here[0].id });
      }
    }
  }

  // --- drawing ---------------------------------------------------------------

  private clearLabels() {
    this.labels.forEach((l) => l.destroy());
    this.labels = [];
  }

  private text(x: number, y: number, s: string, color: string, size = 11) {
    // resolution: DPR — the text canvas is rasterized dense enough for the DPR-scaled
    // camera zoom, otherwise labels look blurry on phones.
    const t = this.add
      .text(x, y, s, { fontFamily: "monospace", fontSize: `${size}px`, color, resolution: DPR })
      .setOrigin(0.5)
      .setDepth(10001);
    this.labels.push(t);
    return t;
  }

  // A flat fallback cube (colored diamond + extruded sides) when textures are absent.
  private drawFallbackCube(cx: number, cy: number, level: number, color: number) {
    const sx = this.projSx(cx, cy);
    const sy = this.projSy(cx, cy, level);
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    // sides
    this.g.fillStyle(darken(color, 0.55), 1);
    this.g.fillPoints(
      [
        { x: sx - hw, y: sy },
        { x: sx, y: sy + hh },
        { x: sx, y: sy + hh + CUBE_DEPTH },
        { x: sx - hw, y: sy + CUBE_DEPTH },
      ],
      true,
    );
    this.g.fillStyle(darken(color, 0.4), 1);
    this.g.fillPoints(
      [
        { x: sx, y: sy + hh },
        { x: sx + hw, y: sy },
        { x: sx + hw, y: sy + CUBE_DEPTH },
        { x: sx, y: sy + hh + CUBE_DEPTH },
      ],
      true,
    );
    // top
    this.g.fillStyle(color, 1);
    this.g.fillPoints(
      [
        { x: sx, y: sy - hh },
        { x: sx + hw, y: sy },
        { x: sx, y: sy + hh },
        { x: sx - hw, y: sy },
      ],
      true,
    );
  }

  private draw() {
    if (!this.gs) return;
    if (!this.sys || !this.sys.displayList) return; // scene torn down
    const game = this.gs;
    this.g.clear();
    this.clearLabels();
    this.unitSprites.forEach((s) => s.destroy());
    this.unitSprites = [];

    const hero = this.selectedHero();

    // Tile layer: one pillar Image per tile, diffed per draw (frame + tint). The
    // server only sends discovered tiles, so a tile's real pillar appears when it is
    // discovered — undiscovered tiles render the flat fog pillar. Only changed tiles
    // are touched (destroying/recreating ~1500 images per action was the original
    // source of per-action jank; the diff keeps that fix).
    const key = `${game.id}:${game.width}x${game.height}`;
    if (this.tilesKey !== key) {
      // Drop the previous game's layer first, even if the atlas isn't ready yet.
      this.tileImgAt.forEach((im) => im?.destroy());
      this.tileImgAt = new Array(game.tiles.length).fill(null);
      this.tileFrameAt = new Array(game.tiles.length).fill("");
      this.tileTintAt = new Array(game.tiles.length).fill(-1);
      this.tilesKey = key;
    }
    const atlas = this.ensurePillarAtlas(game);
    // A rebake replaces the atlas texture: every existing image must rebind to it.
    if (atlas.rebuilt) this.tileFrameAt.fill("");
    if (atlas.ready) {
      for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
          const i = y * game.width + x;
          const t = game.tiles[i];
          const { frame, h } = this.tileFrameAndHeight(t, x, y);
          if (!this.atlasPairs.has(frame.slice(1))) continue; // missing biome texture
          if (this.tileFrameAt[i] === frame) continue;
          let img = this.tileImgAt[i];
          if (!img) {
            img = this.add
              .image(this.projSx(x, y), this.projSy(x, y, 0) + TILE_H / 2, "pillar-atlas", frame)
              .setOrigin(0.5, 1);
            this.tileImgAt[i] = img;
          } else {
            img.setTexture("pillar-atlas", frame);
          }
          img.setDisplaySize(TILE_W, TILE_H + CUBE_DEPTH + h * ELEV).setDepth((x + y) * 100 + h);
          // Mirror half the cloud tiles (stable position hash) — doubles the
          // apparent variant count of the cloud sea for free. Terrain cubes are
          // lit from a fixed side and must never flip.
          img.setFlipX(!t.discovered && ((x * 13 + y * 5) & 1) === 1);
          this.tileFrameAt[i] = frame;
          this.tileTintAt[i] = -1; // frame changed -> force retint below
        }
      }
    }
    const haveTileLayer = atlas.ready;

    // Fog + elevation shading: diff the tint per tile and only touch what changed.
    if (haveTileLayer) {
      for (let i = 0; i < game.tiles.length; i++) {
        const img = this.tileImgAt[i];
        if (!img) continue;
        const t = game.tiles[i];
        const h = this.renderHeight(t);
        // Subtle elevation shade so relief reads even on flat lighting. Cloud
        // (undiscovered) pillars stay untinted — they carry their own colors.
        const shade = Math.min(0.8 + Math.min(h, 6) * 0.033, 1);
        const tint = t.discovered && this.isVisible(i % game.width, (i / game.width) | 0)
          ? darken(0xffffff, shade)
          : 0xffffff;
        if (this.tileTintAt[i] !== tint) {
          img.setTint(tint);
          this.tileTintAt[i] = tint;
        }
      }
    }

    // Flat fallback terrain while the pillar atlas isn't available yet.
    if (!haveTileLayer) {
      const order: { x: number; y: number }[] = [];
      for (let y = 0; y < game.height; y++)
        for (let x = 0; x < game.width; x++) order.push({ x, y });
      order.sort((a, b) => a.x + a.y - (b.x + b.y));
      for (const { x, y } of order) {
        const t = game.tiles[y * game.width + x];
        const h = this.renderHeight(t);
        const color = this.isVisible(x, y)
          ? darken(BIOME_COLORS[t.biome], 0.78 + Math.min(h, 6) * 0.035)
          : FOG_FALLBACK;
        for (let lvl = 0; lvl <= h; lvl++) this.drawFallbackCube(x, y, lvl, color);
      }
    }

    // Reachable highlight around the selected hero (orthogonal, walkable land).
    // Per-tile Images with iso depths — sitting ON the tile top, UNDER any unit
    // standing there (drawing them on the top overlay covered the characters).
    if (hero) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = hero.x + dx;
        const ny = hero.y + dy;
        if (nx < 0 || ny < 0 || nx >= game.width || ny >= game.height) continue;
        const t = game.tiles[ny * game.width + nx];
        if (t.discovered && t.biome === Biome.Water) continue; // known water is unwalkable
        const th = t.discovered ? this.renderHeight(t) : 0;
        const f = this.topFace(nx, ny, th);
        const img = this.add
          .image(f.sx, f.sy, "hl-diamond")
          .setDisplaySize(TILE_W, TILE_H)
          .setTint(0xffe066)
          .setAlpha(0.9)
          .setDepth((nx + ny) * 100 + th + 1); // just above the tile, below units (+90)
        this.unitSprites.push(img);
      }
    }

    // Town/home — a building sprite standing on the town tile (falls back to the ⌂
    // marker if the texture isn't available). The base diamond stays as a subtle
    // plinth, in the iso stack (under the building/units, not over them).
    const tt = game.tiles[game.town.y * game.width + game.town.x];
    const townFace = this.topFace(game.town.x, game.town.y, this.renderHeight(tt));
    const plinth = this.add
      .image(townFace.sx, townFace.sy, "hl-diamond")
      .setDisplaySize(TILE_W, TILE_H)
      .setAlpha(0.5)
      .setDepth((game.town.x + game.town.y) * 100 + this.renderHeight(tt) + 1);
    this.unitSprites.push(plinth);
    if (this.townBuildingAspect > 0 && this.textures.exists("town-building")) {
      const w = TILE_W * 2.1 * UNIT_SCALE; // building footprint, scaled down with the units
      const img = this.add
        .image(townFace.sx, townFace.sy + TILE_H / 2, "town-building")
        .setOrigin(0.5, 1) // feet centred on the tile
        .setDisplaySize(w, w * this.townBuildingAspect)
        .setDepth((game.town.x + game.town.y) * 100 + 92);
      this.unitSprites.push(img);
    } else {
      this.text(townFace.sx, townFace.sy - 6, "⌂", "#ffffff", 14);
    }

    // --- units (monsters then heroes), depth-sorted into the cube stack -------
    for (const id in game.monsters) {
      const m = game.monsters[id];
      if (!this.isVisible(m.x, m.y)) continue; // enemies hidden in unexplored fog
      const t = game.tiles[m.y * game.width + m.x];
      const f = this.topFace(m.x, m.y, this.renderHeight(t));
      const depth = (m.x + m.y) * 100 + 90;
      const tex = monsterTexKey(m.species);
      const msz = TILE_W * 0.8 * UNIT_SCALE;
      if (tex && this.textures.exists(tex)) {
        const img = this.add
          .image(f.sx, f.sy + 4, tex)
          .setOrigin(0.5, 1)
          .setDisplaySize(msz, msz)
          .setDepth(depth);
        this.unitSprites.push(img);
      } else {
        this.g.fillStyle(MONSTER_COLOR, 1);
        this.g.fillCircle(f.sx, f.sy - 6, 7);
        this.g.lineStyle(1, 0x000000, 0.5);
        this.g.strokeCircle(f.sx, f.sy - 6, 7);
      }
      if (m.count > 1) this.text(f.sx + msz / 2 + 4, f.sy - msz - 4, `×${m.count}`, "#ffd0c4", 9);
    }

    // Heroes (offset slightly when stacked so they don't fully overlap).
    // Mine render as full chibi sprites; other players' heroes are small violet
    // dots — and only when showOthers is on ("👥" toggle).
    const stackIndex: Record<string, number> = {};
    for (const h of game.heroes) {
      if (h.hp <= 0) continue;
      const mine = this.isMine(h.id);
      if (!mine && !this.showOthers) continue;
      const skey = `${h.x},${h.y}`;
      const i = stackIndex[skey] || 0;
      stackIndex[skey] = i + 1;
      const t = game.tiles[h.y * game.width + h.x];
      const f = this.topFace(h.x, h.y, this.renderHeight(t));
      const ox = i * 6 - 6;
      const oy = i * 3;
      const cx = f.sx + ox;
      const cy = f.sy + oy;
      if (!mine) {
        // Teammate marker: small violet dot with the hero's initial — clearly not
        // one of my sprites, and never selectable.
        this.g.fillStyle(OTHER_HERO_COLOR, 1);
        this.g.fillCircle(cx, cy - 4, 4.5);
        this.g.lineStyle(1.5, 0xffffff, 0.9);
        this.g.strokeCircle(cx, cy - 4, 4.5);
        this.text(cx, cy - 16, h.name[0], "#e6d7ff", 9);
        continue;
      }
      const selected = h.id === this.selectedHeroId;
      const depth = (h.x + h.y) * 100 + 91 + i;
      // Selection ring at the hero's feet, in the iso stack just below the sprite —
      // the sprite (and units in front) draw over it instead of the ring covering them.
      if (selected) {
        // Ring sized to the (scaled-down) hero, not the tile — a full-tile ring
        // dwarfs the small sprite.
        const rw = (TILE_W - 8) * UNIT_SCALE * 1.6;
        const ring = this.add
          .image(cx, cy, "hl-ring")
          .setDisplaySize(rw, rw / 2)
          .setTint(0xffe066)
          .setDepth(depth - 0.5);
        this.unitSprites.push(ring);
      }
      const tex = heroTexKey(h.class);
      if (this.textures.exists(tex)) {
        const hsz = TILE_W * 0.85 * UNIT_SCALE;
        const img = this.add
          .image(cx, cy + 4, tex)
          .setOrigin(0.5, 1)
          .setDisplaySize(hsz, hsz)
          .setDepth(depth);
        this.unitSprites.push(img);
      } else {
        this.g.fillStyle(selected ? HERO_COLOR_SELECTED : HERO_COLOR, 1);
        this.g.fillCircle(cx, cy - 6, 6);
        this.g.lineStyle(selected ? 3 : 1, selected ? 0xffffff : 0x0a223a, 1);
        this.g.strokeCircle(cx, cy - 6, 6);
        this.text(cx, cy - 18, h.name[0], selected ? "#ffffff" : "#bfe2ff", 10);
      }
    }

    if (!this.fitted) this.fitCamera();
  }
}
