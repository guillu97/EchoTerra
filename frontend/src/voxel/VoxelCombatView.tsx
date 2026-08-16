// Combat iso en VOXEL (Phase 3 du VOXEL-PLAN) — même moteur que la carte.
// Contrat bus identique à CombatScene : CombatRender {combat, current, mode}
// entrant ; CombatUnitClick / CombatTileClick sortants (unités prioritaires).
// Terrain 7×7 en blocs 32³ (vue rapprochée), cases atteignables en VERT,
// unité courante cerclée jaune / cibles rouge (attaque) ou violet (skill),
// unités en billboards + barre de PV. Rotation caméra 4 orientations (FFTA2) —
// la vraie valeur du passage 3D : lire les hauteurs sous tous les angles.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { signacify } from "./signacMaterial";
import { bus, EV } from "../eventBus";
import type { Combat, CombatCurrent, CombatHit, CombatThreat, CombatUnit } from "../api/types";
import { heroTexKey, libUrl, monsterTexKey } from "../assets";
import { useStore } from "../store";
import { BLOOM_LAYER, clearOwned, makeSkyGradient, VoxelEngine } from "./engine";
import { VoxelControls } from "./controls";
import { BlockLibrary } from "./terrain";
import { SmoothTerrain } from "./smoothTerrain";

const ARENA_PROP_MAT = signacify(new THREE.MeshLambertMaterial({ vertexColors: true }));
// Flamme des braseros d'angle : self-lit + posée sur le calque bloom → rayonne
// (comme les cristaux de la carte). Sphère basse résolution = look voxel/braise.
const FIRE_MAT = new THREE.MeshBasicMaterial({ color: 0xff8a2a });
const GLOW_VC_MAT = new THREE.MeshBasicMaterial({ vertexColors: true }); // cristaux lumineux (leur couleur)
const FIRE_GEOM = new THREE.IcosahedronGeometry(0.17, 0);
const BRAZIER_MAT = new THREE.MeshLambertMaterial({ color: 0x3a3230 });
const BRAZIER_GEOM = new THREE.CylinderGeometry(0.13, 0.17, 0.34, 6);
const PLINTH_MAT = new THREE.MeshLambertMaterial({ color: 0x6a5b46 }); // terre/roche du socle-île
// props décoratifs sur les cases vides (herbe/fleurs/champignons)
const DECO_BY_BIOME: Record<number, string[]> = {
  1: ["pebbles", "daisy"],
  2: ["flowers", "daisy", "pebbles"],
  3: ["fern", "mushroom", "flowers"],
  4: ["pebbles", "crystal"],
  5: ["crystal", "pebbles"],
};
// Géométries PARTAGÉES des overlays de combat (reconstruits à chaque action) —
// une géométrie par quad/anneau fuyait à chaque redraw (voir clearOwned).
const CQUAD_GEOM = new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
const CRING_GEOM = new THREE.RingGeometry(0.3, 0.4, 24).rotateX(-Math.PI / 2);
const CEDGE_GEOM = new THREE.RingGeometry(0.6, 0.67, 4).rotateZ(Math.PI / 4).rotateX(-Math.PI / 2);
// Flèche d'orientation (Facing, lot C4) : petit triangle au bord de la case,
// pointant là où l'unité regarde — l'arc arrière prend +25 %.
// PROJECTILES (spawnShots) — géométries et matériaux PARTAGÉS : un tir en crée
// plusieurs par action, en allouer à chaque fois fuirait comme les overlays.
const SHOT_ARROW_GEOM = new THREE.CylinderGeometry(0.035, 0.035, 0.5, 4).rotateX(Math.PI / 2);
const SHOT_BOLT_GEOM = new THREE.IcosahedronGeometry(0.11, 0);
const SHOT_ARROW_MAT = new THREE.MeshBasicMaterial({ color: 0xf3e2b0 });
const SHOT_BOLT_MAT = new THREE.MeshBasicMaterial({ color: 0xffb454 });
const FACING_GEOM = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(0.2, 0);
  sh.lineTo(-0.04, 0.11);
  sh.lineTo(-0.04, -0.11);
  sh.closePath();
  return new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
})();
import { makeLabel } from "./labels";
import { ALL_CHAR_KEYS, CharLibrary } from "./characters";
import type { Weapon } from "./rig";
import { UnitAnimator } from "./unitAnim";

// Archétype d'arme serveur (weapons.go) → geste d'attaque du rig. Les armes de
// mêlée (épée, dague, lance) partagent le fauchage ; seuls l'arc et le bâton ont
// leur propre geste. `undefined` = pas d'arme connue → le rig garde le geste
// déduit de sa classe.
function rigWeapon(kind?: string): Weapon | undefined {
  if (kind === "arc") return "bow";
  if (kind === "baton") return "staff";
  if (kind) return "melee";
  return undefined;
}

class CombatWorld {
  smooth = new SmoothTerrain(); // sol en PENTES VOXEL lissées (comme la carte) — plus de gros cubes
  propsLib = new BlockLibrary("/voxels/props"); // obstacles/ronces/décor de l'arène
  chars = new CharLibrary();
  ready = false; // props chargés (le sol lissé, lui, est synchrone)
  terrain: THREE.Group | null = null;
  terrainKey = "";
  overlays = new THREE.Group();
  sprites = new THREE.Group();
  fx = new THREE.Group(); // étiquettes flottantes (C2) — survivent aux redraws
  deaths = new THREE.Group(); // rigs vaincus en train de s'effondrer (survivent aux redraws)
  unitOf = new Map<THREE.Object3D, string>(); // sprite → unitId (picking)
  textures = new Map<string, THREE.Texture>();
  animator: UnitAnimator; // rigs animés (idle/attaque/compétence/touché)
  fitted = false;

  combat: Combat | null = null;
  current?: CombatCurrent;
  mode = "move";
  skillIdx = 0; // compétence iso armée (surbrillance des bonnes cibles)
  threats: CombatThreat[] = []; // cases menacées par ennemi (télégraphie C2)
  threatUnitId?: string;
  aimUnitId?: string; // cible survolée : on y peint la zone d'impact du coup armé
  lastSeq = -1; // dernier combat.seq animé (diff → dégâts flottants)
  pendingActor?: { unitId: string; kind: "attack" | "skill" }; // acteur de l'action du joueur, en attente du prochain render
  private fxAnims: { sprite: THREE.Sprite; x: number; y0: number; z: number; start: number; dur: number }[] = [];
  private shots: { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; start: number; dur: number; spin: boolean }[] = [];
  private fxRaf = 0;

  skyTex: THREE.Texture;
  private unsubBeauty: () => void;

  constructor(readonly engine: VoxelEngine) {
    // idle cadencé par le réglage « Animation des personnages » (batterie) —
    // les actions (attaque, compétence, mort) restent au plein rAF.
    this.animator = new UnitAnimator(engine, undefined, {
      idleFps: useStore.getState().settings.idleAnimFps,
    });
    engine.enableLighting({ shadowSpan: 12 }); // arène + socle : ombres serrées
    // fond : dégradé crépusculaire (indigo profond → mauve chaud) au lieu du à-plat
    // → profondeur atmosphérique, l'arène-diorama ne flotte plus dans un vide plat.
    this.skyTex = makeSkyGradient(0x120c22, 0x39284e);
    engine.scene.background = this.skyTex;
    engine.scene.add(this.overlays);
    engine.scene.add(this.sprites);
    engine.scene.add(this.fx);
    engine.scene.add(this.deaths);
    // passe beauté (tone mapping + bloom sélectif sur les flammes) — la vue garde
    // SON fond crépusculaire (keepBackground) ; suit le réglage à chaud.
    const beautyOn = () => useStore.getState().settings.voxelBeauty;
    engine.setBeauty(beautyOn(), { keepBackground: true });
    engine.setSignac(useStore.getState().settings.voxelSignac, useStore.getState().settings.signacStrength);
    this.unsubBeauty = useStore.subscribe((s, prev) => {
      if (s.settings.voxelBeauty !== prev.settings.voxelBeauty)
        engine.setBeauty(s.settings.voxelBeauty, { keepBackground: true });
      if (
        s.settings.voxelSignac !== prev.settings.voxelSignac ||
        s.settings.signacStrength !== prev.settings.signacStrength
      )
        engine.setSignac(s.settings.voxelSignac, s.settings.signacStrength);
      if (s.settings.idleAnimFps !== prev.settings.idleAnimFps)
        this.animator.setIdleFps(s.settings.idleAnimFps);
    });
    void this.propsLib
      .load(["rock", "tree-green", "ice-spike", "brambles", "flowers", "daisy",
             "fern", "mushroom", "pebbles", "crystal"])
      .then(() => { this.ready = true; this.terrainKey = ""; this.draw(); });
    void this.chars.load(ALL_CHAR_KEYS).then(() => this.draw());
    // Les modèles ne font PLUS de billboard : ils sont orientés selon leur
    // Facing (fx/fy) MONDE — un sens au début du combat puis pivot au
    // déplacement/à l'attaque. Ce cap étant en espace-monde, il reste correct
    // quand la caméra tourne (on peut voir un dos), donc aucun onFrame à câbler.
  }
  /** Anime l'ACTEUR d'une action (lunge d'attaque / cast) + le recul des cibles. */
  animateAction(hits: CombatHit[], actorId?: string, kind: "attack" | "skill" = "attack") {
    const c = this.combat;
    if (!c) return;
    for (const h of hits) this.animator.trigger(h.unitId, "hit"); // recul des touchés
    // acteur : fourni (action du joueur) sinon déduit — l'unité du camp OPPOSÉ aux
    // cibles, active de préférence, sinon la plus proche d'une cible (tour ennemi)
    let actor = actorId;
    if (!actor && hits.length) {
      const tgt = c.units.find((u) => u.id === hits[0].unitId);
      if (tgt) {
        const side = tgt.side === "hero" ? "monster" : "hero";
        const cands = c.units.filter((u) => u.side === side && u.hp > 0);
        const active = c.units.find((u) => u.id === c.order[c.turnIdx]);
        actor = (active && active.side === side ? active
          : cands.sort((a, b) => (Math.hypot(a.x - tgt.x, a.y - tgt.y) - Math.hypot(b.x - tgt.x, b.y - tgt.y)))[0])?.id;
      }
    }
    if (actor) this.animator.trigger(actor, kind);
    if (actor) this.spawnShots(actor, hits);
  }

  /**
   * LE TRAIT QUI PART — un projectile voxel qui vole de l'attaquant à chaque
   * cible, en cloche.
   *
   * Pourquoi : un tir à trois cases n'était RIEN à l'écran. Le tireur mimait son
   * geste, la cible reculait, et entre les deux le vide — donc rien ne disait au
   * joueur d'où venait le coup ni qu'une portée d'arme était en jeu. C'est le
   * seul retour visuel qui rende une attaque à distance lisible sans texte, et
   * il suit l'ARME : flèche pour un arc, éclat pour le reste.
   *
   * ⚠ mêlée EXCLUE (distance ≤ 1) : sur une case voisine le trait serait un
   * scintillement, et le lunge du rig dit déjà tout.
   */
  spawnShots(actorId: string, hits: CombatHit[]) {
    const c = this.combat;
    if (!c || !hits.length) return;
    const att = c.units.find((u) => u.id === actorId);
    if (!att) return;
    const arrow = att.side === "hero" && att.weaponKind === "arc";
    const now = performance.now();
    const seen = new Set<string>();
    for (const h of hits) {
      if (h.unitId === actorId || seen.has(h.unitId)) continue;
      seen.add(h.unitId);
      const def = c.units.find((u) => u.id === h.unitId);
      if (!def) continue;
      const dist = Math.abs(def.x - att.x) + Math.abs(def.y - att.y);
      if (dist <= 1) continue; // au contact : le lunge suffit
      const from = new THREE.Vector3(att.x, this.surfaceY(att.x, att.y) + 0.55, att.y);
      const to = new THREE.Vector3(def.x, this.surfaceY(def.x, def.y) + 0.5, def.y);
      const mesh = new THREE.Mesh(arrow ? SHOT_ARROW_GEOM : SHOT_BOLT_GEOM, arrow ? SHOT_ARROW_MAT : SHOT_BOLT_MAT);
      mesh.layers.enable(BLOOM_LAYER); // l'éclat rayonne en mode beauté
      mesh.position.copy(from);
      if (arrow) mesh.lookAt(to); // la flèche pointe là où elle va
      this.fx.add(mesh);
      // une flèche ne tournoie pas : elle est ORIENTÉE une fois. L'éclat, si.
      this.shots.push({ mesh, from, to, start: now, dur: 120 + dist * 45, spin: !arrow });
    }
    if (!this.fxRaf && this.shots.length) this.tickFx();
  }

  /** Unités passées de vivantes (prev) à vaincues (now) → rig qui s'effondre. */
  spawnDeaths(prev: CombatUnit[]) {
    const now = this.combat;
    if (!now) return;
    for (const u of prev) {
      if (u.hp <= 0) continue;
      const after = now.units.find((x) => x.id === u.id);
      if (after && after.hp > 0 && !after.fled) continue; // toujours en vie
      const tex = u.side === "hero" ? (u.appearance || heroTexKey(u.kind)) : monsterTexKey(u.kind, u.appearance);
      const rig = tex ? this.chars.makeRig(tex, rigWeapon(u.weaponKind)) : undefined;
      if (!rig) continue;
      const span = u.size && u.size > 1 ? u.size : 1;
      rig.root.scale.multiplyScalar(span);
      this.deaths.add(rig.root);
      const faceY = u.fx || u.fy ? Math.atan2(u.fx, u.fy) : this.engine.azimuthNow;
      this.animator.playDeath(rig, u.x + (span - 1) / 2, this.surfaceY(u.x, u.y), u.y + (span - 1) / 2, faceY);
    }
  }

  dispose() {
    this.animator.dispose();
    if (this.fxRaf) cancelAnimationFrame(this.fxRaf);
    this.unsubBeauty();
    this.skyTex.dispose();
    this.smooth.dispose();
    this.propsLib.dispose();
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
      const y0 = this.surfaceY(u.x, u.y) + 1.0;
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
    const flying: typeof this.shots = [];
    for (const sh of this.shots) {
      const t = (now - sh.start) / sh.dur;
      if (t >= 1) {
        this.fx.remove(sh.mesh);
        continue; // géométrie et matériau sont PARTAGÉS : rien à libérer ici
      }
      sh.mesh.position.lerpVectors(sh.from, sh.to, t);
      sh.mesh.position.y += Math.sin(t * Math.PI) * 0.7; // la cloche
      if (sh.spin) sh.mesh.rotation.z += 0.4;
      flying.push(sh);
    }
    this.shots = flying;
    this.engine.invalidate();
    this.fxRaf = this.fxAnims.length || this.shots.length ? requestAnimationFrame(this.tickFx) : 0;
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

  // hauteur de MARCHE (logique) sous une case — inchangée (champ serveur)
  private heightAt(x: number, y: number): number {
    const c = this.combat;
    return c ? c.heights[y * c.gridW + x] || 0 : 0;
  }
  // Y de la SURFACE lissée sous une case (props/unités/overlays s'y posent) : la
  // pente voxel arrondie remplace le sommet du cube (= heightAt+1 avant le lissage).
  private surfaceY(x: number, y: number): number {
    return this.smooth.mesh ? this.smooth.heightAt(x, y) : this.heightAt(x, y) + 1;
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
      // clic sur le SOL lissé (mesh unique) → case = arrondi du point d'impact
      if (this.smooth.mesh && h.object === this.smooth.mesh && h.point) {
        const cx = Math.round(h.point.x), cy = Math.round(h.point.z);
        if (cx >= 0 && cy >= 0 && cx < c.gridW && cy < c.gridH) {
          bus.emit(EV.CombatTileClick, { x: cx, y: cy });
          return;
        }
        continue;
      }
    }
  }

  draw() {
    const c = this.combat;
    const engine = this.engine;
    if (!c || !this.ready) return;

    // terrain reconstruit par combat : SOL en PENTES VOXEL lissées (comme la carte,
    // fini les gros cubes) + SOCLE-ÎLE lisse ; obstacles/décor en props par-dessus.
    if (this.terrainKey !== c.id) {
      if (this.terrain) engine.scene.remove(this.terrain);
      if (this.smooth.mesh) {
        engine.scene.remove(this.smooth.mesh);
        this.smooth.mesh.geometry.dispose();
      }
      const group = new THREE.Group();
      const cellAt = (x: number, y: number) => c.cells?.[y * c.gridW + x];

      // 1) SOL lissé : biome de l'arène, cases d'eau creusées ; marches FIDÈLES
      //    (heightScale 1, ni roulis ni micro-relief → plateaux plats et lisibles).
      const src = {
        width: c.gridW,
        height: c.gridH,
        tiles: Array.from({ length: c.gridW * c.gridH }, (_, i) => {
          const cc = c.cells?.[i];
          return {
            biome: cc?.hazard === "water" ? 0 : c.biome,
            height: this.heightAt(i % c.gridW, (i / c.gridW) | 0),
            discovered: true,
          };
        }),
      };
      const floorMesh = this.smooth.build(src, null, (t) => t.height, { heightScale: 1, rollAmp: 0, micro: 0 });
      floorMesh.castShadow = floorMesh.receiveShadow = true;
      group.add(floorMesh);

      const cxm = (c.gridW - 1) / 2, cym = (c.gridH - 1) / 2;
      // 2) SOCLE-ÎLE : tronc de pyramide LISSE (pas de cubes) sous l'arène.
      const topR = (Math.max(c.gridW, c.gridH) / 2 + 0.35) * Math.SQRT2;
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR * 0.72, 5, 4, 1), PLINTH_MAT);
      plinth.rotation.y = Math.PI / 4; // faces parallèles aux bords de l'arène
      plinth.position.set(cxm, -2.5, cym); // sommet ≈ y=0
      plinth.castShadow = plinth.receiveShadow = true;
      group.add(plinth);

      // 3) BRASEROS d'angle (flamme self-lit sur le calque bloom → rayonne en beauté).
      for (const [bx, by] of [[-0.6, -0.6], [c.gridW - 0.4, -0.6], [-0.6, c.gridH - 0.4], [c.gridW - 0.4, c.gridH - 0.4]] as const) {
        const bowl = new THREE.Mesh(BRAZIER_GEOM, BRAZIER_MAT);
        bowl.castShadow = true;
        bowl.position.set(bx, 0.17, by);
        group.add(bowl);
        const fire = new THREE.Mesh(FIRE_GEOM, FIRE_MAT);
        fire.position.set(bx, 0.42, by);
        fire.layers.enable(BLOOM_LAYER);
        group.add(fire);
      }

      // 4) OBSTACLES (cases bloquées) + ronces — posés sur la surface lissée.
      const obstacleId = c.biome === 3 || c.biome === 2 ? "tree-green" : c.biome === 5 ? "ice-spike" : "rock";
      for (let y = 0; y < c.gridH; y++)
        for (let x = 0; x < c.gridW; x++) {
          const cc = cellAt(x, y);
          const propId = cc?.blocked ? obstacleId : cc?.hazard === "brambles" ? "brambles" : null;
          if (!propId) continue;
          const geom = this.propsLib.get(propId, (x * 7 + y * 13) % 3);
          if (!geom) continue;
          const mesh = new THREE.Mesh(geom, ARENA_PROP_MAT);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.position.set(x, this.surfaceY(x, y) - 0.02, y);
          mesh.rotation.y = ((x * 31 + y * 17) % 4) * (Math.PI / 2);
          mesh.scale.setScalar(cc?.blocked ? 0.95 : 0.8);
          group.add(mesh);
        }

      // 5) DÉCOR CURÉ : RARE (~12 %, le sol lissé a déjà ses pointillés d'herbe) et
      //    joli — fleurs/champignons/galets épars sur les cases plates vides.
      const deco = DECO_BY_BIOME[c.biome] ?? DECO_BY_BIOME[2];
      for (let y = 0; y < c.gridH; y++)
        for (let x = 0; x < c.gridW; x++) {
          const cc = cellAt(x, y);
          if (cc?.blocked || cc?.hazard || this.heightAt(x, y) > 0) continue;
          const hh = ((x * 73856093) ^ (y * 19349663)) >>> 0;
          if (hh % 100 >= 12) continue;
          const id = deco[(hh >>> 3) % deco.length];
          const geom = this.propsLib.get(id, (hh >>> 5) % 3);
          if (!geom) continue;
          const glow = id === "crystal";
          const m = new THREE.Mesh(geom, glow ? GLOW_VC_MAT : ARENA_PROP_MAT);
          m.castShadow = !glow;
          m.receiveShadow = !glow;
          if (glow) m.layers.enable(BLOOM_LAYER);
          const jx = ((hh >>> 7) % 40) / 100 - 0.2, jy = ((hh >>> 11) % 40) / 100 - 0.2;
          m.position.set(x + jx, this.surfaceY(x, y) - 0.02, y + jy);
          m.rotation.y = ((hh >>> 2) % 8) * (Math.PI / 4);
          m.scale.setScalar(0.3 + ((hh >>> 9) % 16) / 100);
          group.add(m);
        }

      engine.scene.add(group);
      this.terrain = group;
      this.terrainKey = c.id;
    }
    this.smooth.setTime(performance.now() / 1000); // shader d'eau (cases d'eau) sur les frames rendues

    clearOwned(this.overlays);
    clearOwned(this.sprites);
    this.unitOf.clear();
    this.animator.beginFrame();

    const topOf = (x: number, y: number) => this.surfaceY(x, y);
    // `lift` = à quelle hauteur au-dessus du sol poser le quad. Les couches se
    // superposent SANS z-fighting : portée 0.012 < déplacement 0.02 < menace
    // 0.028 < liseré de portée 0.035 < zone d'impact 0.045.
    const quad = (x: number, y: number, color: number, opacity: number, lift = 0.02) => {
      const m = new THREE.Mesh(
        CQUAD_GEOM,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
      );
      m.userData.ownMat = true;
      m.position.set(x, topOf(x, y) + lift, y);
      this.overlays.add(m);
    };
    const ring = (x: number, y: number, color: number, scale = 1) => {
      const m = new THREE.Mesh(
        CRING_GEOM,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false }),
      );
      m.userData.ownMat = true;
      m.position.set(x, topOf(Math.floor(x), Math.floor(y)) + 0.03, y);
      m.scale.setScalar(scale); // anneau élargi pour un boss 2×2
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

    // PORTÉE DU COUP ARMÉ (cases visables, servies par le serveur : bornes +
    // ligne de vue). En ROUGE SOMBRE translucide, sous les cases de déplacement
    // vertes — deux questions différentes, deux couleurs : « où puis-je aller »
    // et « qu'est-ce que j'atteins d'ici ». C'est ce qui rend une arme lisible
    // sans texte : la lance dessine une couronne à deux cases, l'arc une grande
    // tache trouée par les rochers.
    if (c.status === "active" && (this.mode === "attack" || this.mode === "skill")) {
      const aim =
        this.mode === "skill"
          ? this.current?.skills?.[this.skillIdx]?.cells ?? []
          : this.current?.attackCells ?? [];
      // ⚠ une case peut être À LA FOIS accessible (vert) et frappable (rouge) —
      // bouger ne termine pas le tour. Deux remplissages au MÊME niveau se
      // battaient en z-fighting : le fond rouge passe donc SOUS le vert, et
      // c'est un LISERÉ posé au-dessus qui porte l'information de portée. Une
      // case verte cerclée de rouge se lit « j'y vais ou j'y frappe ».
      for (const [ax, ay] of aim) {
        quad(ax, ay, 0x8f2418, 0.4, 0.012);
        const rim = new THREE.Mesh(
          CEDGE_GEOM,
          new THREE.MeshBasicMaterial({ color: 0xff5a4d, transparent: true, opacity: 0.9, depthWrite: false }),
        );
        rim.userData.ownMat = true;
        rim.position.set(ax, topOf(ax, ay) + 0.035, ay);
        this.overlays.add(rim);
      }

      // ZONE D'IMPACT sur la cible survolée : la case frappée + la grille de
      // dégâts de la capacité. Le Fauchage éclabousse, l'attaque de base non —
      // et ça ne se voyait nulle part AVANT de frapper.
      const armed =
        this.mode === "skill" ? this.current?.skills?.[this.skillIdx]?.skill : undefined;
      const hit = this.aimUnitId ? c.units.find((u) => u.id === this.aimUnitId) : undefined;
      if (hit) {
        const zone = [{ dx: 0, dy: 0 }, ...(armed?.damage ?? [])];
        for (const z of zone) {
          const zx = hit.x + z.dx;
          const zy = hit.y + z.dy;
          if (zx < 0 || zy < 0 || zx >= c.gridW || zy >= c.gridH) continue;
          quad(zx, zy, 0xff6a3d, 0.7, 0.045);
        }
      }
    }

    // télégraphie (lot C2) : les cases menacées par l'ennemi sélectionné (tap
    // sur l'unité) en ORANGE — servies par le serveur, le client n'évalue rien.
    if (c.status === "active" && this.threatUnitId) {
      const threat = this.threats.find((t) => t.unitId === this.threatUnitId);
      for (const [tx, ty] of threat?.cells ?? []) quad(tx, ty, 0xff8c3b, 0.48, 0.028);
    }

    // unités : billboards + barre de PV (sprites face caméra)
    const targets = new Set(
      this.mode === "skill"
        ? this.current?.skills?.[this.skillIdx]?.targets ?? []
        : this.mode === "push"
          ? this.current?.pushTargets ?? []
          : this.current?.attackTargets ?? [],
    );
    for (const u of c.units) {
      if (u.hp <= 0 || u.fled) continue; // les fuyards ont quitté l'arène (C3)
      // boss 2×2 (lot C5) : rendu au CENTRE de l'empreinte, modèle et anneaux ×2
      const span = u.size && u.size > 1 ? u.size : 1;
      const ux = u.x + (span - 1) / 2;
      const uy = u.y + (span - 1) / 2;
      const top = topOf(u.x, u.y);
      // flèche d'orientation (C4) : où l'unité regarde — attaquer son dos = +25 %
      if ((u.fx || u.fy) && span === 1) {
        const arrow = new THREE.Mesh(
          FACING_GEOM,
          new THREE.MeshBasicMaterial({
            color: u.side === "hero" ? 0xd9f2ff : 0xffd9d9,
            transparent: true,
            opacity: 0.85,
            depthWrite: false,
          }),
        );
        arrow.userData.ownMat = true;
        arrow.position.set(u.x + u.fx * 0.42, top + 0.035, u.y + u.fy * 0.42);
        arrow.rotation.y = -Math.atan2(u.fy, u.fx);
        this.overlays.add(arrow);
      }
      if (this.current && u.id === this.current.unitId) ring(ux, uy, 0xffe066, span);
      if (u.id === this.threatUnitId) ring(ux, uy, 0xff8c3b, span);
      if (targets.has(u.id))
        ring(ux, uy, this.mode === "skill" ? 0xc06bd6 : this.mode === "push" ? 0x4bc8e3 : 0xff5a4d, span);

      const tex =
        u.side === "hero" ? (u.appearance || heroTexKey(u.kind)) : monsterTexKey(u.kind, u.appearance);
      // modèle voxel (héros ET monstres) si disponible — orienté selon son Facing
      // MONDE (fx/fy) : les unités se font face au début, puis pivotent selon
      // leur sens de déplacement/d'attaque. Le modèle regarde +Z au repos, donc
      // atan2(fx, fy) le tourne vers (fx,fy) ; à défaut de cap, il fait face caméra.
      const faceY = u.fx || u.fy ? Math.atan2(u.fx, u.fy) : this.engine.azimuthNow;
      // Le GESTE d'attaque suit l'ARME PORTÉE (weapons.go) et non la classe :
      // à l'arc on arme la corde, au bâton on pousse, sinon on fauche.
      const rig = tex ? this.chars.makeRig(tex, rigWeapon(u.weaponKind)) : undefined;
      if (rig) {
        rig.root.position.set(ux, top, uy);
        rig.root.rotation.y = faceY;
        rig.root.scale.multiplyScalar(span);
        this.sprites.add(rig.root);
        // le picking cible chaque mesh du rig → mappe-les tous vers l'unité
        rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.unitOf.set(o, u.id); });
        this.animator.sync(u.id, rig, ux, top, uy, { faceCamera: !(u.fx || u.fy), facingY: faceY });
      } else {
        const url = libUrl(u.side === "hero" ? "characters" : "monsters", tex || "char-scout");
        const mat = new THREE.SpriteMaterial({ map: this.texture(url), alphaTest: 0.35, transparent: true });
        const s = new THREE.Sprite(mat);
        s.userData.ownMat = true;
        s.scale.set(0.7 * span, 0.7 * span, 1);
        s.center.set(0.5, 0.04);
        s.position.set(ux, top, uy);
        this.sprites.add(s);
        this.unitOf.set(s, u.id);
      }

      // barre de PV : fond sombre + remplissage coloré, toujours face caméra
      const ratio = Math.max(0, u.hp / u.maxHp);
      const barW = 0.5 * span;
      const barY = top + 0.8 * span;
      const back = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, opacity: 0.6, transparent: true }));
      back.userData.ownMat = true;
      back.scale.set(barW, 0.06, 1);
      back.position.set(ux, barY, uy);
      this.sprites.add(back);
      const fill = new THREE.Sprite(
        new THREE.SpriteMaterial({ color: u.side === "hero" ? 0x4be36e : 0xe24b4b, transparent: true }),
      );
      fill.userData.ownMat = true;
      fill.scale.set(barW * ratio, 0.06, 1);
      fill.position.set(ux - (barW * (1 - ratio)) / 2, barY + 0.001, uy);
      this.sprites.add(fill);

      // nom (+ états) sous l'unité, comme CombatScene
      const short = u.name.length > 10 ? u.name.slice(0, 9) + "…" : u.name;
      const lbl = makeLabel(short, "#e8e8f0", 0.17);
      lbl.center.set(0.5, 1);
      lbl.position.set(ux, top - 0.06, uy);
      this.sprites.add(lbl);
      if (u.states.length) {
        const st = makeLabel(u.states.join(","), "#ffd166", 0.15);
        st.center.set(0.5, 1);
        st.position.set(ux, top - 0.26, uy);
        this.sprites.add(st);
      }
    }
    this.animator.endFrame();

    // BORNES DU PAN = le damier (posées à chaque dessin : la grille d'un boss
    // fait 9×9). Hors de l'arène il n'y a que le socle et le ciel.
    engine.panBounds = { minX: 0, maxX: c.gridW - 1, minZ: 0, maxZ: c.gridH - 1 };

    if (!this.fitted) {
      // vise un peu plus BAS et dézoome légèrement pour montrer le socle-île (le
      // diorama), tout en gardant l'arène lisible ; zoom adapté à la grille (boss 9×9).
      engine.target.set((c.gridW - 1) / 2, -0.5, (c.gridH - 1) / 2);
      engine.zoom = Math.round(380 / c.gridW);
      this.fitted = true;
    }
    engine.invalidate();
  }
}

export function VoxelCombatView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VoxelEngine | null>(null);
  const [topDown, setTopDown] = useState(false);

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
        skillIdx?: number;
        threats?: CombatThreat[];
        threatUnitId?: string;
        aimUnitId?: string;
      }) => {
        const changed = world.combat?.id !== p.combat.id;
        const prevUnits = changed ? [] : world.combat?.units ?? []; // pour diff des morts
        world.combat = p.combat;
        world.current = p.current;
        world.mode = p.mode;
        world.skillIdx = p.skillIdx ?? 0;
        world.threats = p.threats ?? [];
        world.threatUnitId = p.threatUnitId;
        world.aimUnitId = p.aimUnitId;
        if (changed) {
          world.fitted = false;
          world.lastSeq = p.combat.seq; // ne pas rejouer les coups d'un combat rechargé
        } else if (p.combat.seq !== world.lastSeq) {
          world.lastSeq = p.combat.seq;
          const hits = p.combat.lastHits ?? [];
          world.spawnHits(hits);
          world.draw(); // (re)crée les rigs + les enregistre avant de déclencher l'anim
          world.animateAction(hits, world.pendingActor?.unitId, world.pendingActor?.kind ?? "attack");
          world.spawnDeaths(prevUnits); // unités tombées à 0 PV → effondrement
          world.pendingActor = undefined;
          return;
        }
        world.draw();
      },
    );
    // recentrage caméra sur une unité (barre des héros de combat) : glisse la
    // cible vers la case de l'unité, le zoom courant est conservé.
    const offFocus = bus.on(EV.CombatFocusUnit, (p: { x: number; y: number }) => {
      engine.target.set(p.x, engine.target.y, p.y);
      engine.invalidate();
    });
    // acteur de l'action du JOUEUR (précis) — consommé au prochain render seq++
    const offAnim = bus.on(EV.CombatAnim, (p: { unitId: string; kind: "attack" | "skill" }) => {
      world.pendingActor = p;
    });
    // au montage (le view vient de passer en combat) : demander l'état courant
    useStore.getState().syncScene();

    if (import.meta.env.DEV) (window as unknown as { __vc?: unknown }).__vc = { engine, world };
    return () => {
      off();
      offFocus();
      offAnim();
      controls.dispose();
      world.dispose();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div className="view-rot">
        <button
          className={`iconbtn${topDown ? " on" : ""}`}
          aria-pressed={topDown}
          title={topDown ? "Vue inclinée" : "Vue de dessus (voir les monstres masqués)"}
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

