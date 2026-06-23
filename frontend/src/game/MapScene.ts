import Phaser from "phaser";
import type { GameState, Hero } from "../api/types";
import { Biome } from "../api/types";
import { bus, EV } from "../eventBus";
import { BIOME_COLORS, HERO_COLOR, HERO_COLOR_SELECTED, MONSTER_COLOR, darken } from "./render";
import { monsterTexKey, heroTexKey, HERO_TEX_KEYS } from "../assets";

// --- Isometric tunables -----------------------------------------------------
// The whole map is drawn as 2:1 isometric cubes (FFTA2-style). Each tile is a
// PILLAR: its biome cube is stacked from level 0 up to the tile's Perlin height,
// so mountains/snow read as solid raised terraces and water stays a flat sea.
const TILE_W = 48; // iso diamond width (world px)
const TILE_H = 24; // iso diamond height (= TILE_W / 2)
const CUBE_DEPTH = 24; // visible side height of one cube
const ELEV = CUBE_DEPTH; // vertical px per height level (== CUBE_DEPTH so stacks connect)
const SS = 2; // supersample factor for the normalized cube textures (crispness)

// The plains are the level-0 reference ground: water/sand/grass stay flat at 0, and
// only forest/mountain/snow rise, by their Perlin height above this baseline.
const GROUND_LEVEL = 3; // Perlin height level treated as flat ground

// Camera zoom: start zoomed in on the town; wheel / pinch zoom between these bounds.
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const DEFAULT_ZOOM = 1.0;

// Fog of war: undiscovered tiles are tinted to this near-black so terrain + relief read
// as hidden until a hero has explored them.
const FOG_TINT = 0x141a26;

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
  private g!: Phaser.GameObjects.Graphics; // overlay (pips, highlights, town) — always on top
  private labels: Phaser.GameObjects.Text[] = [];
  private tileImgs: Phaser.GameObjects.Image[] = []; // static cube layer (rebuilt on map change)
  private tilesKey = ""; // game id + dims the cube layer was built for
  private unitSprites: Phaser.GameObjects.Image[] = []; // hero/monster sprites (rebuilt each draw)
  private cubesReady = false; // normalized cube textures built?
  private townBuildingAspect = 0; // height/width of the normalized town building (0 = not ready)
  private gs?: GameState;
  private selectedHeroId?: string;
  private revealAll = false; // debug: ignore fog of war (reveal whole map)
  private fitted = false;
  private downX = 0;
  private downY = 0;
  private dragged = false;
  private pinchDist = 0; // last two-finger distance (px) for pinch zoom

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
    this.cameras.main.setBackgroundColor("#0e1626");

    this.buildCubeTextures();
    this.buildTownBuilding();

    const offRender = bus.on(
      EV.MapRender,
      (p: { game: GameState; selectedHeroId?: string; revealAll?: boolean }) => {
        const changedGame = this.gs?.id !== p.game.id;
        this.gs = p.game;
        this.selectedHeroId = p.selectedHeroId;
        this.revealAll = !!p.revealAll;
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
      this.tileImgs.forEach((im) => im.destroy());
      this.tileImgs = [];
      this.tilesKey = "";
      this.unitSprites.forEach((s) => s.destroy());
      this.unitSprites = [];
    };
    this.events.once("shutdown", cleanup);
    this.events.once("destroy", cleanup);

    // Allow a second pointer so pinch-to-zoom works on touch.
    this.input.addPointer(1);

    // Drag to pan; a click only fires if the pointer barely moved. Two fingers = pinch zoom.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.downX = p.x;
      this.downY = p.y;
      this.dragged = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      const p1 = this.input.pointer1;
      const p2 = this.input.pointer2;
      // Pinch: both pointers down -> zoom by the change in finger distance.
      if (p1.isDown && p2.isDown) {
        const dist = Phaser.Math.Distance.Between(p1.x, p1.y, p2.x, p2.y);
        if (this.pinchDist > 0 && dist > 0) {
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          this.zoomBy(dist / this.pinchDist, mid.x, mid.y);
        }
        this.pinchDist = dist;
        this.dragged = true;
        return;
      }
      this.pinchDist = 0;
      if (!p.isDown) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      if (Math.abs(p.x - this.downX) + Math.abs(p.y - this.downY) > 8) this.dragged = true;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.input.pointer1.isDown && !this.input.pointer2.isDown) this.pinchDist = 0;
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
  }

  // Multiply the camera zoom by `factor` (clamped), keeping the world point under the
  // screen anchor (sx,sy) stationary so zoom feels anchored to the cursor/pinch centre.
  private zoomBy(factor: number, sx: number, sy: number) {
    const cam = this.cameras.main;
    const before = cam.getWorldPoint(sx, sy);
    const z = Phaser.Math.Clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    cam.setZoom(z);
    const after = cam.getWorldPoint(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
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

  // Fog of war: a tile is visible if explored (shared discovered flag), if it's the
  // town (always visible), or in debug reveal-all mode.
  private isVisible(x: number, y: number): boolean {
    if (this.revealAll) return true;
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
      built++;
    }
    if (built === ISO_TILE_FILES.length) this.cubesReady = true;
  }

  private cubeKeyFor(biome: Biome): string | undefined {
    const key = `iso-cube-${biome}`;
    return this.textures.exists(key) ? key : undefined;
  }

  // Measure a sprite's opaque content bounding box (alpha > 16). Falls back to the full
  // image if pixels can't be read.
  private opaqueBBox(
    src: HTMLImageElement | HTMLCanvasElement,
  ): { left: number; top: number; sw: number; sh: number } | null {
    const nw = (src as HTMLImageElement).naturalWidth || src.width;
    const nh = (src as HTMLImageElement).naturalHeight || src.height;
    if (!nw || !nh) return null;
    const meas = document.createElement("canvas");
    meas.width = nw;
    meas.height = nh;
    const mctx = meas.getContext("2d");
    if (!mctx) return null;
    mctx.drawImage(src, 0, 0);
    let left = nw,
      right = 0,
      top = nh,
      bottom = 0;
    try {
      const data = mctx.getImageData(0, 0, nw, nh).data;
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          if (data[(y * nw + x) * 4 + 3] > 16) {
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
    return { left, top, sw: right - left + 1, sh: bottom - top + 1 };
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
    const out = document.createElement("canvas");
    out.width = bb.sw;
    out.height = bb.sh;
    const octx = out.getContext("2d");
    if (!octx) return;
    octx.drawImage(src, bb.left, bb.top, bb.sw, bb.sh, 0, 0, bb.sw, bb.sh);
    this.textures.addCanvas("town-building", out);
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
    cam.setScroll(f.sx - cam.width / (2 * DEFAULT_ZOOM), f.sy - cam.height / (2 * DEFAULT_ZOOM));
    this.fitted = true;
  }

  private heroesAt(x: number, y: number): Hero[] {
    return (this.gs?.heroes || []).filter((h) => h.x === x && h.y === y && h.hp > 0);
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
    const t = this.add
      .text(x, y, s, { fontFamily: "monospace", fontSize: `${size}px`, color })
      .setOrigin(0.5)
      .setDepth(10001);
    this.labels.push(t);
    return t;
  }

  // Draw a top-face diamond outline at the given screen centre (overlay graphics).
  private diamond(sx: number, sy: number) {
    const hw = TILE_W / 2;
    const hh = TILE_H / 2;
    this.g.beginPath();
    this.g.moveTo(sx, sy - hh);
    this.g.lineTo(sx + hw, sy);
    this.g.lineTo(sx, sy + hh);
    this.g.lineTo(sx - hw, sy);
    this.g.closePath();
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
    const haveCubes = !!this.cubeKeyFor(Biome.Grass);

    // Build the static cube layer once per game (id + dimensions). Each tile is a
    // stacked pillar of its biome cube from level 0 to its render height. The fog
    // signature (how many tiles are discovered + the debug flag) is part of the key
    // so the layer rebuilds and re-tints whenever the explored set grows.
    let discoveredCount = 0;
    for (const t of game.tiles) if (t.discovered) discoveredCount++;
    const key = `${game.id}:${game.width}x${game.height}:fog${discoveredCount}:all${this.revealAll}`;
    if (haveCubes && this.tilesKey !== key) {
      this.tileImgs.forEach((im) => im.destroy());
      this.tileImgs = [];
      for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
          const t = game.tiles[y * game.width + x];
          const h = this.renderHeight(t);
          const cubeKey = this.cubeKeyFor(t.biome);
          if (!cubeKey) continue;
          const visible = this.isVisible(x, y);
          // Subtle elevation shade so relief reads even on flat lighting.
          const shade = Math.min(0.8 + Math.min(h, 6) * 0.033, 1);
          for (let lvl = 0; lvl <= h; lvl++) {
            const sy = this.projSy(x, y, lvl);
            const img = this.add
              .image(this.projSx(x, y), sy + TILE_H / 2, cubeKey)
              .setOrigin(0.5, 1)
              .setDisplaySize(TILE_W, TILE_H + CUBE_DEPTH)
              .setDepth((x + y) * 100 + lvl);
            img.setTint(visible ? darken(0xffffff, shade) : FOG_TINT);
            this.tileImgs.push(img);
          }
        }
      }
      this.tilesKey = key;
    }

    // Flat fallback terrain when cube textures aren't available.
    if (!haveCubes) {
      const order: { x: number; y: number }[] = [];
      for (let y = 0; y < game.height; y++)
        for (let x = 0; x < game.width; x++) order.push({ x, y });
      order.sort((a, b) => a.x + a.y - (b.x + b.y));
      for (const { x, y } of order) {
        const t = game.tiles[y * game.width + x];
        const h = this.renderHeight(t);
        const color = this.isVisible(x, y)
          ? darken(BIOME_COLORS[t.biome], 0.78 + Math.min(h, 6) * 0.035)
          : FOG_TINT;
        for (let lvl = 0; lvl <= h; lvl++) this.drawFallbackCube(x, y, lvl, color);
      }
    }

    // --- overlay (resource pips, highlights, town) — always on top -----------
    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x];
        if (t.biome === Biome.Water) continue;
        if (!this.isVisible(x, y)) continue; // resources stay hidden under fog
        const f = this.topFace(x, y, this.renderHeight(t));
        this.g.fillStyle(t.resources > 0 ? 0x9ae66e : 0xc0392b, 1);
        this.g.fillCircle(f.sx - TILE_W / 4, f.sy, 2);
      }
    }

    // Reachable highlight around the selected hero (orthogonal, walkable land).
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
        if (t.biome === Biome.Water) continue;
        const f = this.topFace(nx, ny, this.renderHeight(t));
        this.diamond(f.sx, f.sy);
        this.g.lineStyle(2, 0xffe066, 0.9);
        this.g.strokePath();
      }
    }

    // Town/home — a building sprite standing on the town tile (falls back to the ⌂
    // marker if the texture isn't available). The base diamond stays as a subtle plinth.
    const tt = game.tiles[game.town.y * game.width + game.town.x];
    const townFace = this.topFace(game.town.x, game.town.y, this.renderHeight(tt));
    this.diamond(townFace.sx, townFace.sy);
    this.g.lineStyle(2, 0xffffff, 0.5);
    this.g.strokePath();
    if (this.townBuildingAspect > 0 && this.textures.exists("town-building")) {
      const w = TILE_W * 2.1; // building spans a bit over two tiles wide
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
      if (tex && this.textures.exists(tex)) {
        const img = this.add
          .image(f.sx, f.sy + 4, tex)
          .setOrigin(0.5, 1)
          .setDisplaySize(TILE_W * 0.8, TILE_W * 0.8)
          .setDepth(depth);
        this.unitSprites.push(img);
      } else {
        this.g.fillStyle(MONSTER_COLOR, 1);
        this.g.fillCircle(f.sx, f.sy - 6, 7);
        this.g.lineStyle(1, 0x000000, 0.5);
        this.g.strokeCircle(f.sx, f.sy - 6, 7);
      }
      if (m.count > 1) this.text(f.sx + 12, f.sy - 18, `×${m.count}`, "#ffd0c4", 9);
    }

    // Heroes (offset slightly when stacked so they don't fully overlap).
    const stackIndex: Record<string, number> = {};
    for (const h of game.heroes) {
      if (h.hp <= 0) continue;
      const skey = `${h.x},${h.y}`;
      const i = stackIndex[skey] || 0;
      stackIndex[skey] = i + 1;
      const t = game.tiles[h.y * game.width + h.x];
      const f = this.topFace(h.x, h.y, this.renderHeight(t));
      const ox = i * 6 - 6;
      const oy = i * 3;
      const cx = f.sx + ox;
      const cy = f.sy + oy;
      const selected = h.id === this.selectedHeroId;
      // Selection ring under the sprite (overlay).
      if (selected) {
        this.g.lineStyle(2.5, 0xffe066, 1);
        this.g.strokeEllipse(cx, cy, TILE_W - 8, (TILE_W - 8) / 2);
      }
      const tex = heroTexKey(h.class);
      const depth = (h.x + h.y) * 100 + 91 + i;
      if (this.textures.exists(tex)) {
        const img = this.add
          .image(cx, cy + 4, tex)
          .setOrigin(0.5, 1)
          .setDisplaySize(TILE_W * 0.85, TILE_W * 0.85)
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
