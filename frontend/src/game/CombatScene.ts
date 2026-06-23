import Phaser from "phaser";
import type { Combat, CombatCurrent, CombatUnit } from "../api/types";
import { bus, EV } from "../eventBus";
import { ISO, isoProject, darken, speciesColor, HERO_COLOR, MONSTER_COLOR } from "./render";
import { monsterTexKey, heroTexKey, HERO_TEX_KEYS } from "../assets";

const COMBAT_MONSTER_FILES = ["mob-goblin", "mob-slime", "mob-windelemental"];

// CombatScene renders the isometric battle (FFTA2-style) with elevation, and picks
// tiles/units from pointer clicks by inverse projection (front-to-back hit testing).
export class CombatScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  private sprites: Phaser.GameObjects.Image[] = []; // unit sprites (rebuilt each draw)
  private combat?: Combat;
  private current?: CombatCurrent;
  private mode: string = "move";
  private originX = 320;
  private originY = 80;

  constructor() {
    super("combat");
  }

  preload() {
    // Unit sprites (optional — fall back to tokens if absent).
    COMBAT_MONSTER_FILES.forEach((k) => this.load.image(k, `/assets/monsters/${k}.png`));
    HERO_TEX_KEYS.forEach((k) => this.load.image(k, `/assets/characters/${k}.png`));
  }

  create() {
    this.g = this.add.graphics();
    this.cameras.main.setBackgroundColor("#161022");

    const offRender = bus.on(
      EV.CombatRender,
      (p: { combat: Combat; current?: CombatCurrent; mode: string }) => {
        this.combat = p.combat;
        this.current = p.current;
        this.mode = p.mode;
        this.layout();
        this.draw();
      },
    );

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.onClick(pointer));

    const onResize = () => {
      if (this.combat) {
        this.layout();
        this.draw();
      }
    };
    this.scale.on("resize", onResize);

    // Drop external listeners on teardown so a destroyed scene stops reacting.
    const cleanup = () => {
      offRender();
      this.scale.off("resize", onResize);
      this.sprites.forEach((s) => s.destroy());
      this.sprites = [];
    };
    this.events.once("shutdown", cleanup);
    this.events.once("destroy", cleanup);

    // Booted only so this listener exists; hide until the map hands off to combat.
    this.time.delayedCall(0, () => this.scene.sleep());
  }

  private layout() {
    if (!this.combat) return;
    // Center the diamond grid in the viewport.
    this.originX = this.scale.width / 2;
    this.originY = 70;
  }

  private heightAt(x: number, y: number): number {
    if (!this.combat) return 0;
    return this.combat.heights[y * this.combat.gridW + x] || 0;
  }

  private unitAt(x: number, y: number): CombatUnit | undefined {
    return this.combat?.units.find((u) => u.hp > 0 && u.x === x && u.y === y);
  }

  // --- input -----------------------------------------------------------------

  private onClick(pointer: Phaser.Input.Pointer) {
    if (!this.combat || this.combat.status !== "active") return;
    const px = pointer.worldX;
    const py = pointer.worldY;

    // Build a front-to-back ordering (larger x+y, then higher units, drawn last).
    const tiles: { x: number; y: number }[] = [];
    for (let y = 0; y < this.combat.gridH; y++)
      for (let x = 0; x < this.combat.gridW; x++) tiles.push({ x, y });
    tiles.sort((a, b) => b.x + b.y - (a.x + a.y));

    // 1) Units take click priority.
    for (const t of tiles) {
      const u = this.unitAt(t.x, t.y);
      if (!u) continue;
      const { sx, sy } = isoProject(t.x, t.y, this.heightAt(t.x, t.y), this.originX, this.originY);
      if (Phaser.Math.Distance.Between(px, py, sx, sy - 10) < 16) {
        bus.emit(EV.CombatUnitClick, { unitId: u.id });
        return;
      }
    }

    // 2) Otherwise pick a tile by its top diamond.
    for (const t of tiles) {
      const { sx, sy } = isoProject(t.x, t.y, this.heightAt(t.x, t.y), this.originX, this.originY);
      const dx = Math.abs(px - sx) / (ISO.tileW / 2);
      const dy = Math.abs(py - sy) / (ISO.tileH / 2);
      if (dx + dy <= 1) {
        bus.emit(EV.CombatTileClick, { x: t.x, y: t.y });
        return;
      }
    }
  }

  // --- drawing ---------------------------------------------------------------

  private clearTexts() {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
  }

  private label(x: number, y: number, s: string, color: string, size = 11) {
    const t = this.add
      .text(x, y, s, { fontFamily: "monospace", fontSize: `${size}px`, color, fontStyle: "bold" })
      .setOrigin(0.5);
    this.texts.push(t);
  }

  private heightColor(h: number): number {
    const palette = [0x5a8f4a, 0x6f9a4f, 0x8a9560, 0xa39a78];
    return palette[Math.min(h, palette.length - 1)];
  }

  private isReachable(x: number, y: number): boolean {
    return !!this.current?.reachable.some(([rx, ry]) => rx === x && ry === y);
  }

  private targetSet(): Set<string> {
    if (!this.current) return new Set();
    if (this.mode === "skill") return new Set(this.current.skillTargets);
    if (this.mode === "attack") return new Set(this.current.attackTargets);
    return new Set(this.current.attackTargets); // hint in move mode
  }

  private draw() {
    if (!this.combat) return;
    if (!this.sys || !this.sys.displayList) return; // scene torn down
    const c = this.combat;
    this.g.clear();
    this.clearTexts();
    this.sprites.forEach((s) => s.destroy());
    this.sprites = [];

    const order: { x: number; y: number }[] = [];
    for (let y = 0; y < c.gridH; y++) for (let x = 0; x < c.gridW; x++) order.push({ x, y });
    // Back-to-front so closer tiles overdraw farther ones.
    order.sort((a, b) => a.x + a.y - (b.x + b.y));

    const hw = ISO.tileW / 2;
    const hh = ISO.tileH / 2;

    for (const t of order) {
      const h = this.heightAt(t.x, t.y);
      const { sx, sy } = isoProject(t.x, t.y, h, this.originX, this.originY);
      const top = this.heightColor(h);
      const ph = h * ISO.elev;

      // Side faces (extruded down) give the 2.5D block look.
      if (ph > 0) {
        this.g.fillStyle(darken(top, 0.55), 1);
        this.g.fillPoints(
          [
            { x: sx - hw, y: sy },
            { x: sx, y: sy + hh },
            { x: sx, y: sy + hh + ph },
            { x: sx - hw, y: sy + ph },
          ],
          true,
        );
        this.g.fillStyle(darken(top, 0.4), 1);
        this.g.fillPoints(
          [
            { x: sx, y: sy + hh },
            { x: sx + hw, y: sy },
            { x: sx + hw, y: sy + ph },
            { x: sx, y: sy + hh + ph },
          ],
          true,
        );
      }

      // Top face.
      const reachable = this.isReachable(t.x, t.y);
      this.g.fillStyle(reachable ? 0x6ee36e : top, 1);
      this.g.fillPoints(
        [
          { x: sx, y: sy - hh },
          { x: sx + hw, y: sy },
          { x: sx, y: sy + hh },
          { x: sx - hw, y: sy },
        ],
        true,
      );
      this.g.lineStyle(1, reachable ? 0x2f8f2f : 0x213b1f, reachable ? 1 : 0.6);
      this.g.strokePoints(
        [
          { x: sx, y: sy - hh },
          { x: sx + hw, y: sy },
          { x: sx, y: sy + hh },
          { x: sx - hw, y: sy },
          { x: sx, y: sy - hh },
        ],
        true,
      );
    }

    // Units, back-to-front.
    const targets = this.targetSet();
    const curUnit = c.units.find((u) => u.id === this.current?.unitId);
    const unitOrder = c.units.filter((u) => u.hp > 0).sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const u of unitOrder) {
      const h = this.heightAt(u.x, u.y);
      const { sx, sy } = isoProject(u.x, u.y, h, this.originX, this.originY);
      const cy = sy - 10;
      const base = u.side === "hero" ? HERO_COLOR : speciesColor(u.kind);

      // Highlight current unit and valid targets.
      if (curUnit && u.id === curUnit.id) {
        this.g.lineStyle(3, 0xffe066, 1);
        this.g.strokeCircle(sx, cy, 15);
      }
      if (targets.has(u.id)) {
        this.g.lineStyle(3, this.mode === "skill" ? 0xc06bd6 : 0xff5a4d, 1);
        this.g.strokeCircle(sx, cy, 15);
      }

      // Token — a unit sprite when available, else the coloured circle.
      const tex = u.side === "hero" ? heroTexKey(u.kind) : monsterTexKey(u.kind);
      if (tex && this.textures.exists(tex)) {
        const img = this.add
          .image(sx, cy - 6, tex)
          .setDisplaySize(34, 34)
          .setDepth(10);
        this.sprites.push(img);
      } else {
        this.g.fillStyle(u.side === "hero" ? base : MONSTER_COLOR, 1);
        this.g.fillCircle(sx, cy, 11);
        this.g.lineStyle(2, darken(base, 0.5), 1);
        this.g.strokeCircle(sx, cy, 11);
      }

      // HP bar.
      const w = 26;
      const ratio = Math.max(0, u.hp / u.maxHp);
      this.g.fillStyle(0x000000, 0.6);
      this.g.fillRect(sx - w / 2, cy - 22, w, 5);
      this.g.fillStyle(u.side === "hero" ? 0x4be36e : 0xe24b4b, 1);
      this.g.fillRect(sx - w / 2, cy - 22, w * ratio, 5);

      this.label(sx, cy + 18, u.name.length > 10 ? u.name.slice(0, 9) + "…" : u.name, "#e8e8f0", 9);
      if (u.states.length) this.label(sx, cy + 28, u.states.join(","), "#ffd166", 8);
    }
  }
}
