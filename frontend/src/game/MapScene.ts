import Phaser from "phaser";
import type { GameState, Hero } from "../api/types";
import { Biome } from "../api/types";
import { bus, EV } from "../eventBus";
import { BIOME_COLORS, HERO_COLOR, HERO_COLOR_SELECTED, MONSTER_COLOR, darken } from "./render";

const TILE = 26;
// Biome index (0..5) -> tile texture filename under /assets/tiles/.
const TILE_FILES = ["water", "sand", "grass", "forest", "mountain", "snow"];

// MapScene renders the global orthogonal map (Hordes-style) and turns pointer
// clicks into movement/selection intents. It owns no game logic.
export class MapScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private tileImgs: Phaser.GameObjects.Image[] = [];
  private tilesKey = ""; // game id + dims the tile layer was built for
  private gs?: GameState;
  private selectedHeroId?: string;
  private fitted = false;
  private downX = 0;
  private downY = 0;
  private dragged = false;

  constructor() {
    super("map");
  }

  preload() {
    // Generated biome tiles (optional — falls back to flat colors if absent).
    TILE_FILES.forEach((name, i) => this.load.image(`tile-${i}`, `/assets/tiles/${name}.png`));
  }

  create() {
    this.g = this.add.graphics();
    this.g.setDepth(5); // dynamic graphics (pips, units, highlights) sit above the tile layer
    this.cameras.main.setBackgroundColor("#0e1626");

    const offRender = bus.on(EV.MapRender, (p: { game: GameState; selectedHeroId?: string }) => {
      const changedGame = this.gs?.id !== p.game.id;
      this.gs = p.game;
      this.selectedHeroId = p.selectedHeroId;
      if (changedGame) this.fitted = false;
      this.draw();
    });
    const onResize = () => {
      this.fitted = false;
      this.draw();
    };
    this.scale.on("resize", onResize);
    // Tile textures load asynchronously; if they finish AFTER the first MapRender,
    // the tile layer would never get built. Redraw once the loader completes.
    const onLoaded = () => {
      if (this.gs) this.draw();
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
    };
    this.events.once("shutdown", cleanup);
    this.events.once("destroy", cleanup);

    // Drag to pan; a click only fires if the pointer barely moved.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.downX = p.x;
      this.downY = p.y;
      this.dragged = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const cam = this.cameras.main;
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      if (Math.abs(p.x - this.downX) + Math.abs(p.y - this.downY) > 8) this.dragged = true;
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      if (!this.dragged) this.onClick(p);
    });
  }

  // Fit the whole map into the viewport and center it (once per game / resize).
  // NB: Phaser's camera.centerOn() ignores zoom, so we set the scroll ourselves
  // (zoom-aware) to truly center the map — otherwise it ends up shoved into a corner.
  private fitCamera() {
    if (!this.gs) return;
    const cam = this.cameras.main;
    const w = this.gs.width * TILE;
    const h = this.gs.height * TILE;
    const z = Math.min(cam.width / w, cam.height / h);
    cam.setZoom(Math.min(z, 1.2));
    const zoom = cam.zoom;
    cam.setScroll((w - cam.width / zoom) / 2, (h - cam.height / zoom) / 2);
    this.fitted = true;
  }

  private heroesAt(x: number, y: number): Hero[] {
    return (this.gs?.heroes || []).filter((h) => h.x === x && h.y === y && h.hp > 0);
  }

  private selectedHero(): Hero | undefined {
    return this.gs?.heroes.find((h) => h.id === this.selectedHeroId);
  }

  private onClick(pointer: Phaser.Input.Pointer) {
    if (!this.gs) return;
    const x = Math.floor(pointer.worldX / TILE);
    const y = Math.floor(pointer.worldY / TILE);
    if (x < 0 || y < 0 || x >= this.gs.width || y >= this.gs.height) return;

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

  private clearLabels() {
    this.labels.forEach((l) => l.destroy());
    this.labels = [];
  }

  private text(x: number, y: number, s: string, color: string, size = 11) {
    const t = this.add
      .text(x, y, s, { fontFamily: "monospace", fontSize: `${size}px`, color })
      .setOrigin(0.5)
      .setDepth(6);
    this.labels.push(t);
    return t;
  }

  private draw() {
    if (!this.gs) return;
    if (!this.sys || !this.sys.displayList) return; // scene torn down
    const game = this.gs;
    this.g.clear();
    this.clearLabels();

    const hero = this.selectedHero();

    // Tile textures are optional; fall back to flat biome colors when absent.
    const haveTextures = this.textures.exists("tile-2");

    // Build the static tile-sprite layer once per game (id + dimensions). It's a lot
    // of sprites, so we only rebuild when the map actually changes, not every draw.
    const key = `${game.id}:${game.width}x${game.height}`;
    if (haveTextures && this.tilesKey !== key) {
      this.tileImgs.forEach((im) => im.destroy());
      this.tileImgs = [];
      for (let y = 0; y < game.height; y++) {
        for (let x = 0; x < game.width; x++) {
          const t = game.tiles[y * game.width + x];
          const img = this.add.image(x * TILE, y * TILE, `tile-${t.biome}`).setOrigin(0, 0);
          img.setDisplaySize(TILE, TILE).setDepth(0);
          // Shade by elevation for a bit of relief (tint multiplies toward white).
          const shade = Math.min(0.78 + Math.min(t.height, 6) * 0.035, 1);
          img.setTint(darken(0xffffff, shade));
          this.tileImgs.push(img);
        }
      }
      this.tilesKey = key;
    }

    for (let y = 0; y < game.height; y++) {
      for (let x = 0; x < game.width; x++) {
        const t = game.tiles[y * game.width + x];
        const px = x * TILE;
        const py = y * TILE;
        if (!haveTextures) {
          // Shade by elevation for a bit of relief.
          const shade = 0.78 + Math.min(t.height, 6) * 0.035;
          this.g.fillStyle(darken(BIOME_COLORS[t.biome], shade), 1);
          this.g.fillRect(px, py, TILE - 1, TILE - 1);
        }

        // Depleted resource marker (red) vs available (green pip).
        if (t.biome !== Biome.Water) {
          if (t.resources > 0) {
            this.g.fillStyle(0x9ae66e, 1);
            this.g.fillCircle(px + 5, py + 5, 2);
          } else {
            this.g.fillStyle(0xc0392b, 1);
            this.g.fillCircle(px + 5, py + 5, 2);
          }
        }
      }
    }

    // Reachable highlight around the selected hero.
    if (hero) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = hero.x + dx;
        const ny = hero.y + dy;
        const t = game.tiles[ny * game.width + nx];
        if (nx < 0 || ny < 0 || nx >= game.width || ny >= game.height) continue;
        if (t.biome === Biome.Water) continue;
        this.g.lineStyle(2, 0xffe066, 0.9);
        this.g.strokeRect(nx * TILE + 1, ny * TILE + 1, TILE - 3, TILE - 3);
      }
    }

    // Town marker.
    const tx = game.town.x * TILE;
    const ty = game.town.y * TILE;
    this.g.lineStyle(2, 0xffffff, 0.9);
    this.g.strokeRect(tx + 2, ty + 2, TILE - 5, TILE - 5);
    this.text(tx + TILE / 2, ty + TILE / 2, "⌂", "#ffffff", 14);

    // Monsters.
    for (const id in game.monsters) {
      const m = game.monsters[id];
      const cx = m.x * TILE + TILE / 2;
      const cy = m.y * TILE + TILE / 2;
      this.g.fillStyle(MONSTER_COLOR, 1);
      this.g.fillCircle(cx, cy, 7);
      this.g.lineStyle(1, 0x000000, 0.5);
      this.g.strokeCircle(cx, cy, 7);
      if (m.count > 1) this.text(cx + 8, cy - 8, `×${m.count}`, "#ffd0c4", 9);
    }

    // Heroes (offset slightly when stacked so they don't fully overlap).
    const stackIndex: Record<string, number> = {};
    for (const h of game.heroes) {
      if (h.hp <= 0) continue;
      const key = `${h.x},${h.y}`;
      const i = stackIndex[key] || 0;
      stackIndex[key] = i + 1;
      const cx = h.x * TILE + TILE / 2 + i * 4 - 4;
      const cy = h.y * TILE + TILE / 2 + i * 2;
      const selected = h.id === this.selectedHeroId;
      this.g.fillStyle(selected ? HERO_COLOR_SELECTED : HERO_COLOR, 1);
      this.g.fillCircle(cx, cy, 6);
      this.g.lineStyle(selected ? 3 : 1, selected ? 0xffffff : 0x0a223a, 1);
      this.g.strokeCircle(cx, cy, 6);
      this.text(cx, cy - 12, h.name[0], selected ? "#ffffff" : "#bfe2ff", 10);
    }

    if (!this.fitted) this.fitCamera();
  }
}
