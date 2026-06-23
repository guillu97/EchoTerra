# Echo Terra — Project Context (read this first)

> Full reference for any Claude session working on this repo. Keep it updated when systems change.

## 1. What this is

**Echo Terra** is a prototype for an **asynchronous co-op multiplayer survival game**, played
"in real time" over several real days (1 in-game day = 12h real, 2 monster waves/day). Two pillars:

- **Map mode** — a tile grid, *Hordes / Die2Nite* style: turn-based exploration, action points,
  search, states, monster waves attacking the town.
- **Isometric combat** — *Final Fantasy Tactics A2* style: turn-based on an iso grid with heights.

Neither mode is real-time → architecture is **REST + authoritative server state + a wave scheduler**.
No WebSockets. The town tile is special (city management).

**Design sources (Canva, French):**
- GDD (rules/lore/biomes/monsters): design id `DAG5VNa6460`.
- UI mockups: design id `DAG5jZMck5o`. Page roles: 2=Stock, 3=Map+Combat, 4=Craft, 5=Hero,
  6=Structure, 7-9=Home/buildings. (Use the Canva MCP `export-design` to re-read pages.)

**Art is generated locally** via **ComfyUI + Z-Image-Turbo** on the user's GPU (`D:\ComfyUI_windows_portable\`),
then background-stripped with **rembg** for true transparency. The pipeline lives in `scripts/`
(`generate-assets-comfy.mjs` driving ComfyUI's `/prompt` API, `remove_bg.py`, shared `asset-manifest.mjs`,
docs in `scripts/README-comfyui.md`). All prompts derive from a single **`DA`** constant (shared art direction:
warm pastel hand-painted storybook) so every asset is cohesive; edit `DA` to restyle the whole game. Components
fall back to emoji when an asset is missing (asset keys abstracted in `frontend/src/assets.ts`). Run:
`node scripts/generate-assets-comfy.mjs --force --rembg` (ComfyUI must be running: `run_nvidia_gpu.bat`).

**Asset library** (~160 PNGs under `frontend/public/assets/`): `isotiles/` (iso cube biomes/materials —
2:1 blocks), `tiles/` (top-down orthogonal map biomes), `objects/` (items: materials, food, tools,
weapons, medical, potions, misc), `buildings/` (iso buildings), `characters/` (chibi RPG heroes),
`props/` (iso trees/rocks/fences…), `monsters/` (goblin/slime/wind-elemental + enemies). Iso cubes are
made uniform (same width + base) by `scripts/normalize_iso.py` — **re-run it after generating any iso
tile**. `scripts/contact_sheet.py` builds per-category review sheets into `asset-index/`. Per-style
prompt prefixes live in `scripts/asset-manifest.mjs` (DA, ISO_TILE, ITEM_STYLE, CHAR_STYLE, PROP_STYLE,
MONSTER_STYLE, TILE_STYLE) — all derive from `DA`.

**Finding an asset (searchable catalog).** `scripts/build-catalog.mjs` reads the manifest and writes
`asset-index/catalog.json` + `asset-index/CATALOG.md` — every asset with `{id, category, title, file,
tags[], style, prompt}`, grouped/sorted by category. **To pick an asset in any session, grep these by
title / tag / category** (e.g. an "isometric character" → `tags` includes `isometric`+`character`,
spanning `characters`/`heroes`/`npc`). Each generated PNG also carries the same info as tEXt chunks
(`embed_png_meta.py`: Title/Category/Style/Keywords/Description). Both run automatically at the end of a
generation pass; rebuild manually with `node scripts/build-catalog.mjs`.

**Building art styles (LOD).** Buildings default to `STYLE_NEAR` (bold dark outline, crisp cel shading,
fixed upper-left light, 2:1 iso — for foreground); distant/landscape buildings can set `style: STYLE_FAR`
(no harsh outline, softer, simplified — recedes). The generator applies `STYLE_NEAR` to any `category:
"buildings"` asset unless an explicit `style` overrides it. Buildings also append the `NB` tail (no
ground/grass/terrain base, cut at the stone foundation) so they sit cleanly on the iso tile layer. A
fixed seed (`--seed N`, e.g. 42) is used for cohesion across the library.

## 2. Tech stack & how to run

| Layer | Tech |
|---|---|
| Backend | **Go** (`chi` router), REST, state serialized as JSON in **SQLite** (`modernc.org/sqlite`, pure-Go, no CGo) |
| Frontend | **React + Vite + TypeScript**, **Phaser 3** (isometric MapScene + isometric CombatScene), **Zustand** store |
| Map gen | Perlin (`aquilax/go-perlin`) → heightmap → biomes |

```bash
# Backend (:8080). Env: ECHOTERRA_ADDR (:8080), ECHOTERRA_DB (echoterra.db),
#                       ECHOTERRA_WAVE_SECONDS (wave interval, default 600; use 60 to test waves).
go -C backend run ./cmd/server

# Frontend (:5173, proxies /api -> :8080)
npm --prefix frontend install   # first time
npm --prefix frontend run dev
```

Verify: `go -C backend test ./...` · `npx tsc -b` (in frontend) · `npm run build` (in frontend).

**Windows specifics:** dev shell is PowerShell. Go isn't on git-bash PATH → run Go via PowerShell with
`$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`.
**Git push uses Windows-native OpenSSH** (`core.sshCommand=C:/Windows/System32/OpenSSH/ssh.exe`, set in
the repo) because git-bash's keys are passphrase-locked / agent not running. Remote:
`git@github.com:guillu97/EchoTerra.git`, default branch `main`.

## 3. Repo layout

```
backend/
  cmd/server/main.go            bootstrap (router, store, env -> game.WaveInterval)
  internal/api/api.go           chi routes, CORS, in-memory cache + SQLite, wave scheduler, handlers
  internal/game/
    game.go                     GameState, Hero, Tile, Monster, Biome, Stats, Item (+ Town struct inline)
    actions.go                  MoveHero, SearchTile, HideHero, EscapeHero, Advance(legacy), state consts
    classes.go                  ClassDef/ClassSkill catalog (Classes), EvolveHero, EvolveDayIntermediate/Advanced
    combat.go                   CombatUnit, Combat, NewCombat, PlayerAction (+ enemy AI), damage/AoE
    wave.go                     WaveReport, TownDefense/buildingDefense, Recompute, ProcessWave,
                                ForceWave, CatchUpWaves, recomputeTetanise, spawnWaveMonsters
    town.go                     TownBuilding, BuildReq, DefaultBuildings, buildMaterials, buildingCost,
                                HeroesInTown/TownPA/spendFor/canPay, Bank storage helpers, TownAction
    craft.go                    Recipe, Recipes catalog, Craft (town vs field), hero-item helpers
    monsters.go                 NewMonster, MonsterSpecies
    *_test.go                   worldgen, combat, tetanise, build (TestBuildConsumesBankMaterials), evolve
  internal/store/store.go       SQLite: one row per game, state as JSON blob
  internal/worldgen/worldgen.go GenerateTiles (Perlin->biomes), NewGame (town center, heroes, monsters)
frontend/src/
  main.tsx                      ReactDOM (NO StrictMode — would double-mount Phaser)
  App.tsx                       phone-frame device + screen router
  app-shell.css                 all styling (mobile-first; desktop breakpoint >=1024px)
  store.ts                      Zustand: app shell + game/map/combat state + all actions; window.__eg in DEV
  eventBus.ts                   tiny emitter bridging React <-> Phaser (EV.* names)
  townUtils.ts                  heroesInTown, townPA, effectiveTownHeroId, TOWN_TABS
  useWave.ts                    useWaveRemaining (server nextWaveAt), formatHMS
  api/{client.ts,types.ts}      REST client + TS DTOs mirroring Go JSON
  screens/                      LoadingScreen, TitleScreen, CinematicScreen, GameScreen
  components/                   TopBar, BottomNav, HeroChips, Logo, TownWorker(+useWorkerPA),
                                TownStatus, GameOver, HeroOverlay, ItemGrid
  tabs/                         HomeTab, MapTab, StockTab, StructureTab, CraftTab
  game/                         PhaserGame.tsx, MapScene.ts, CombatScene.ts, render.ts
  data/                         buildings.ts (TOWN_BUILDINGS layout, NAV_TABS)
```

## 4. Backend domain model (the JSON the client sees)

- **GameState**: `id, seed, width(22), height(22), tiles[], heroes[3], monsters{id->Monster}, day(1),
  wave(0), waveNumber, nextWaveAt(time), status("active"|"gameover"), lastWave?, town, activeCombat?, combats{}`.
- **Town** (inline in GameState): `x, y, hp(100), maxHp(100), defense(computed), buildings[], storage[]`.
  **`storage` = the Bank** (shared town stash).
- **Hero**: `id, name, x, y, pa(6), maxPa, hp, maxHp, stats{force,dexterite,agilite,endurance,athletisme,
  precision}, class("Sans classe"), classId, classTier(0|1|2), classBonuses{Stats}, states[], inventory[Item],
  bars{}`.
- **Tile**: `biome(0..5), height, resources, monsterId?`. Biomes: 0 Water,1 Sand,2 Grass,3 Forest,4 Mountain,5 Snow.
- **Monster**: `id, species, x, y, hp, maxHp, stats, count` (pack size; used for combat unit count AND Tétanisé).
- **TownBuilding**: `id, name, built(bool), level, durability, maxDurability, capacity, maxCapacity,
  open(bool, Gate), defense(computed contribution), cost{pa, materials[Item]}`.
- **Combat**: `id, gameId, tileX, tileY, gridW(7), gridH(7), heights[], units[CombatUnit], order[], turnIdx,
  round, status("active"|"won"|"lost"), log[]`. **CombatUnit**: `id,name,side("hero"|"monster"),refId,kind,
  x,y,hp,maxHp,stats,states[],move,moved,initiative`.
- **Recipe**: `id, name, category(conso|potion|forge|deco), building(kitchen|workshop), outputType,
  field(bool=craftable outside town), paCost, ingredients[Item]`.
- **WaveReport** (`lastWave`): `wave, day, hordePower, defense, townDamage, townHpAfter, buildingsHit[],
  heroesHit[], monstersSpawned, at, gameOver`.
- **ClassDef** (`/api/classes` catalog): `id, name, tier(1=intermediate|2=advanced), role, bonuses{Stats},
  paBonus, skills[{name, scope("map"|"iso"), desc}]`.

`Recompute()` (called in `persist()` and on load `tick()`) refreshes derived fields: `town.defense`,
per-building `defense`, per-building `cost`, `bank.capacity = sum(storage qty)`, and hero `Tétanisé`.

## 5. Game systems

**Movement / PA** — 6 PA/hero/day. Move = 1 PA/orthogonal step (blocked if `Tétanisé`; clears `Caché`;
PA→0 adds `Fatigue`). Search = 1 PA, loot by biome, decrements tile `resources`.

**Fire ball (map skill)** — `FireballHero` (`actions.go`): 2 PA AoE blast on a monster pack on the hero's tile
or an orthogonally adjacent tile. `damage = 5 + précision + dextérité/2 + rand(0..3)`; the blast burns through
the pack — each downed creature drops `Monster.Count` (refilling HP for the next), and the pack is removed when
the last one dies. A `Tétanisé` hero may still cast it (thinning the pack can clear Tétanisé via `Recompute`).
Casting clears `Caché`. Returns `{report:{species,damage,slain,killed,...}, game}`. Tests: `fireball_test.go`.

**States (map)**: `Fatigue` (0 PA), `Soif`, `Tétanisé`, `Caché`, `Blessé`. **(iso)**: `Stun`, `Cécité`, `Root`…
- **Tétanisé**: a hero on a tile with a pack is stuck (can't move) when `playersOnTile < ceil(monsters/heroesPerPack)`
  with `heroesPerPack=4` and `monsters>=2`. A **Gardien** (advanced class) counts as 3 heroes in this calc
  (`gardienWeight` in `wave.go`). Cleared by killing the monster (combat win) or leaving the tile.
- **Caché**: from **Hide** (1 PA) — the hero is skipped by the next wave's attack, then concealment is consumed.

**Isometric combat** (`combat.go` / `CombatScene.ts`) — initiative by agility; each turn a unit moves once
(`moved` flag) then attacks/skills; hero skill "Frappe puissante"; per-species monster specials (stun/absorb);
heights give a small bonus. Win → monster removed from map + party loots a trophy. Lose → survivors retreat to
town at 1 HP + `Tétanisé`. Combat unit count is capped at 4 even if pack `count` is larger.

**Waves / horde (Hordes-like)** — `nextWaveAt` is **server-driven**; the client only shows the countdown
(`useWaveRemaining`). Resolved lazily on access (`tick`) AND by a 15s scheduler goroutine.
`ProcessWave`: `hordePower = 12 + 6*waveNumber`; **defense** = sum of wall/gate/tower contributions scaled by
durability (**an open Gate = 0**, a construction site = 0); `overflow = horde - defense` → town HP loss +
random building durability damage; defensive buildings also wear. Heroes **outside** town are hit individually
(`Blessé`); **hidden** heroes skipped; **in-town** heroes safe. PA regen each wave; the **Well refills +10**;
new monsters spawn (pack `count` grows with `waveNumber`). **Game over** when town HP hits 0 (`status:"gameover"`).
`POST /advance` = force a wave now (dev/testing).

**Town buildings & construction** — built at start: **gate, wall, bank, well, workshop, panel**.
Construction sites (Built=false): **townhall (renamed from House — revive), tower, kitchen**.
`TownAction(buildingId, action, points, heroId)`:
- `build` → **2-phase construction** for sites + upgrade for built. A `TownBuilding` has `Built` AND
  `UnderConstruction`. Site not started → first `build` consumes **materials + PA** and sets `UnderConstruction`
  (no defense yet); under-construction → next `build` costs **PA only** and finishes it (`Built`, level 1);
  built → upgrade (materials×level + PA, level++). Cost exposed as `building.cost` (start/finish/upgrade aware).
  **Home shows a building only when `built || underConstruction`** (not-yet-started sites are hidden — built from
  the Structure tab; Structure labels: Construire→Terminer→Améliorer). Tests in `build_test.go`.
- `restore` → +5 durability per PA (built only).
- `water` (Well) → **FREE**, draws **one Ration d'eau per in-town hero per `game.day`**: charged to the selected
  town worker (`heroID`), decrements Well `capacity`, clears that hero's `Soif`, and drops the ration into **that
  hero's bag** (not the Bank). Tracked via `Hero.DrewWaterDay`; derived `town.waterDrawnToday` lists who drank today.
- `toggle` (Gate) → 1 PA, flips `open` (open = 0 defense; matches Neko's "qui a laissé la porte ouverte" chat).
- `use` → 1 PA flavored (others).

**Bank** = `town.storage`: deposit hero loot (`/town/deposit`), craft I/O in town, construction materials.

**Crafting** (`craft.go`, `CraftTab.tsx`) — **town mode** (≥1 hero in town): full recipes, ingredients from the
Bank, paid by the chosen *town worker*, output to the Bank. **Field mode** (no hero in town): only `field`
recipes (kitchen/campfire), ingredients from the **selected hero's bag**, paid by that hero, output to the bag.
Forge/workshop recipes are town-only (`field:false`).

**Hero classes & evolution** (`classes.go`) — heroes start at tier 0 ("Sans classe"). Two evolution gates:
- **Jour 2** (`EvolveDayIntermediate`): unlock intermediate classes — **Pionnier**, **Chasseur**, **Éclaireur**.
- **Jour 4** (`EvolveDayAdvanced`): unlock advanced classes — **Gardien**, **Récupérateur**, **Herboriste**.
  (`game.Day` increments every 2 waves / 1 in-game day.)
`EvolveHero(heroID, classID)` validates day threshold + tier sequencing, additively folds `cls.Bonuses` into
`Hero.Stats` (one-time, not re-derived), stores the delta in `Hero.ClassBonuses` (for UI "+N" display), bumps
`MaxPA`. The class catalog is served via `GET /api/classes` (`ClassDef` list); the frontend fetches it on game
enter (`store.ts`) and the **HeroOverlay** uses it for the Evolve picker and Unique Skills display.

## 6. REST API

```
GET  /healthz
GET  /api/recipes
POST /api/games                                  {width?,height?,seed?} -> GameState
GET  /api/games/{id}                              (runs wave catch-up)
GET  /api/games/{id}/world
POST /api/games/{id}/advance                      force a wave (dev)
POST /api/games/{id}/town/action                  {buildingId, action: build|restore|use|water|toggle, points?, heroId?}
POST /api/games/{id}/town/deposit                 deposit in-town heroes' loot into the Bank
POST /api/games/{id}/town/craft                   {recipeId, heroId}
POST /api/games/{id}/heroes/{h}/move              {DX,DY}
POST /api/games/{id}/heroes/{h}/search
POST /api/games/{id}/heroes/{h}/hide
POST /api/games/{id}/heroes/{h}/escape
POST /api/games/{id}/heroes/{h}/fireball          Fire ball map skill -> {report, game}
POST /api/games/{id}/heroes/{h}/evolve            {classId} -> GameState (applies class bonuses)
GET  /api/classes                                 [] ClassDef catalog (tier 1+2 classes)
POST /api/games/{id}/heroes/{h}/combat/start
GET  /api/games/{id}/combat/{c}
POST /api/games/{id}/combat/{c}/action            {unitId, action: move|attack|skill|end, x,y, targetId}
```

## 7. Frontend UX (decisions that matter)

- **App shell**: phone frame centered on desktop, full-screen on mobile; desktop breakpoint ≥1024px enlarges the
  frame. Screen flow: loading → title → cinematic → game. In-game: TopBar + active tab + BottomNav.
- **Bottom nav** (5 tabs): only **Home** is gated to having a hero in town (`TOWN_TABS = ["home"]`).
  **Map/Stock/Structure/Craft are always accessible.**
- **TopBar**: avatar (🙂) opens the **character screen**; 🏰% chip opens **TownStatus**; ⚙️ opens Settings.
- **Character screen** (`HeroOverlay`, from the avatar): Skill view only (class, attributes + bonuses, unique
  skills, Evolve, ◀▶ roster cycle). **No inventory tab / no Stock link** (user decision).
- **Stock**: each hero's personal bag (always) + the **Bank** section (only when ≥1 hero in town) + "deposit loot".
- **Structure**: ONE compact list (no Blueprint tab) — sites → "Construire", built → "Améliorer", each showing
  PA + material cost vs Bank stock; build actions need a hero in town (consult-only otherwise).
- **Home**: tapping the **Workshop** or any **construction site** jumps to Structure; other built buildings open a
  **centered modal** (`.bmenu-modal`, never cut off) with durability, defense contribution, building-specific
  actions (Well "Puiser de l'eau" free, Gate "Open/Close", etc.), "Améliorer (Structure)", and Restore.
- **TownStatus** panel: town HP, **defense total + per-building breakdown** (who defends, how much, durability,
  open/unbuilt), every building's durability, and the last-wave report.
- **Map** (`MapTab`): Phaser **isometric** map (`MapScene.ts`) — every tile is a 2:1 iso cube PILLAR. The **plains
  are the level-0 ground** (water/sand/grass stay flat); only forest/mountain/snow rise, by their Perlin height
  above the `GROUND_LEVEL` baseline (FFTA2-style relief). Cube textures are normalized at runtime from the 1024²
  `isotiles/` PNGs (opaque-bbox crop → uniform box, like the editor's `cubeAt`); clicks use a height-aware inverse
  projection (topmost visible tile). Starts **zoomed in & centered on the town** (no more fit-all); **wheel + pinch
  zoom** clamp 0.35–2.5. **Fog of war**: tiles are hidden (dark `FOG_TINT`, resources/monsters concealed) until a
  hero has seen them — `Tile.Discovered` is **server-authoritative & shared by all players** (`fog.go`:
  `RevealVision` runs in `Recompute`, revealing a Chebyshev ring around the town + every live hero; the town is
  always visible). Debug: the CheatPanel **👁️ Révéler la carte** toggles `store.debugNoFog` (client-side reveal-all,
  passed to the scene via `MapRender.revealAll`). Heroes/monsters reuse the same chibi/creature sprites,
  depth-sorted into the cube stack. Tap a hero (or the **⚡ Actions** button) opens a **radial action menu**
  (Fight if monster on tile / **🔥 Fire ball -2 PA when a pack is on/adjacent** / Search / Hide / **Escape only when
  Tétanisé**). Combat reached from the map.
- Server timer: `nextWaveAt` drives "Next wave in"; GameScreen polls every 20s so scheduler waves show up.

## 7b. Map editor (dev tool — `frontend/src/editor/`)

A self-contained, full-screen **isometric map editor** ("juste pour moi", inspired by Tiled). Reached via a
🗺️ **Éditeur** button on the TitleScreen (dev section) OR the `#editor` URL hash; `appScreen === "editor"` is
rendered by `App.tsx` **outside** the phone frame. Independent of the game's Phaser scenes — it uses **plain
canvas2d** so the SAME `drawMap()` feeds both the live canvas and the PNG export.

- `assetIndex.ts` — enumerates every `public/assets/**/*.png` via `import.meta.glob` (keys only, **no bundling**;
  URLs are the public `/assets/cat/file.png` paths) and groups them by category for the palette.
- `types.ts` — `MapDoc { gridW, gridH, cells[Cell], layers[] }`. **`Cell { blocks: (AssetRef|null)[]; height }`** —
  `blocks` is a STACK of iso cubes indexed by elevation level (so different tiles can stack: stone at lvl 0, sand at
  lvl 1; `null` = a gap → floating blocks are allowed). `height` = top occupied level (kept in sync via
  `recomputeCell`, used for picking/object anchoring). `normalizeCell` migrates legacy `{height, ground}` cells on
  import. Layer 0 is the special **ground** layer; other layers are **object** layers. `emptyDoc()` seeds Sol +
  Bâtiments + Décor + Objets.
- `editorStore.ts` — zustand store (separate from the game store; DEV hook `window.__ed`). Tools: paint / select /
  erase / raise / lower / marquee / stamp / pan. `beginStroke()`+`applyAt()` with per-stroke dedup; undo/redo
  history; layer add/remove/rename/reorder/visibility; grid resize. `MAX_HEIGHT=8`. Selecting an `isotiles` asset
  auto-routes to the ground layer; other assets route to an object layer.
- **Active elevation level** (`store.level`, toolbar "Niveau" + `[` / `]`): painting on the ground layer **stacks a
  block at the active level** (`cell.blocks[level] = tile`) — stone at lvl 0, sand at lvl 1 on one cell, terraces,
  floating blocks. Erase removes the block at the active level; raise/lower add/remove the top block. The single
  **grid plane is drawn at the active level's top-face, BEFORE the blocks** (`DrawOpts.{grid,focusLevel}`) so placed
  blocks read as sitting ON TOP of the grid. The hover floats at the active level. Toggles: **🔍 Focus**
  (`store.levelFocus` → `DrawOpts.focusDim`) dims blocks not at the active level to `DIM_ALPHA`; **🏛 Colonne**
  (`store.fillColumn`) fills levels 0..active with one tile in a single click (solid pillar); **👁 Niveaux**
  (`store.showLevels`) overlays each cell's top-level number.
- **Object transforms** (Select tool `V`): a `Placement` carries optional `scale`, `rot` (deg), `flipX`, `lift`
  (height levels raised above the ground), `dx/dy` (free pixel move) and `crop` (source sub-rect, fractions). The
  Select tool picks the topmost object (`screenToObject`), drag = move (`nudgeSelected`), Delete = remove; the
  floating `Inspector.tsx` edits size/rotation/flip/height/position/reset. `objectGeom()` is the single source of
  truth for an object's screen rect (used by both draw and hit-test). **Crop**: `CropModal.tsx` lets you drag a
  sub-rectangle on the source image; only that region renders, anchored centre-bottom on the tile. Two targets:
  a **placement** crop (Inspector "Recadrer", per object) and an **asset** crop (palette HUD "Recadrer la source").
- **Per-asset source crop** (`assetCrops.ts`): a global `cat/file → CropRect` map (localStorage, standalone module
  to avoid import cycles — `isoRender` reads it directly). It re-frames an asset **everywhere** it's used —
  **ground cubes** (`cubeAt` honours it; the crop region is shown tileW-wide, so a tight crop tessellates) AND
  objects (`effCrop` = placement crop ?? asset crop). Use it to normalize slightly-misframed iso tiles (e.g.
  `brick`) once. `store.assetCropRev` bumps to drive redraws/badges; the palette shows a ✂ badge on cropped assets.
- **Auto-crop** (`detectContentCrop` in `assetCrops.ts`, using `spriteMetrics` opaque-bbox incl. `fTop`): one click
  sets an asset's crop to the tight content box so the block fully fills the frame. Available per-asset (palette HUD
  "⤢ Auto-crop", and "⤢ Auto" in the crop modal to preview) and as a per-category batch (palette title "⤢" →
  `autoCropAssets`).
- **Iso block size** (`store.gridTile`, `setIsoTileSize` in `isoRender`): the block size is one grid-linked variable
  (toolbar "Bloc", px, persisted in `echoterra:editor:tileW`, applied at startup). `setIsoTileSize(w)` mutates the
  live `ISO` object (tileW/tileH/elev/cubeDepth/objW scale linearly off `ISO_BASE`); `project` reads `ISO` live so
  the whole grid + every block rescales uniformly, no call-site threading. Blocks are uniform-size by construction
  (see `cubeAt` above), so "⤢ Auto-ajuster iso" (`autoResizeAllIso` → auto-crop all `isotiles`) is now mainly to
  bake a tight source region for tiles whose auto-detected content bbox includes junk.
- **Brush + randomization** (`BrushPanel.tsx`, `store.brush`): `applyAt` paints a footprint (`size` radius, with
  per-cell `density` scatter) instead of one cell, and on object paint applies random `rot`/`scale`/`flipX`/jitter
  from the brush settings. A non-empty `assetSet` makes each placement pick a random asset from the set (scatter
  forests etc.). A size-1, no-random, empty-set brush == classic single-cell paint. The hover outlines the
  footprint (`DrawOpts.hoverRadius`). Scatter brushes intentionally stack; the plain brush still de-dups drags.
- **Presets** (`PresetsPanel.tsx`, `presets.ts`, `store.{region,presets,stamp}`): the **Marquee** tool (`M`) drags
  a cell rectangle (`region`); "Capturer" snapshots that region's cells (height + ground) and objects (with their
  transforms) — relative to the top-left — into a named `Preset` with a rendered thumbnail. Presets persist in
  `localStorage` (`echoterra:editor:presets`) and export/import as JSON. Arming a preset switches to the **Stamp**
  tool (`T`); clicking stamps it (`stampAt`) — cells overwrite, objects append to the active object layer.
  `presetToDoc()` builds a throwaway `MapDoc` reused for the thumbnail.
- `isoRender.ts` — projection + `drawMap()` + `screenToCell()` (height-aware) + **`screenToCellAtLevel(x,y,doc,level)`**
  (inverts the projection at a level's top-face plane — paint tools use THIS so the cursor matches the active-level
  grid; picking by each cell's own height drifts more as the level rises) + `contentBounds()`. `MAX_HEIGHT=32`.
  The editor doc is **autosaved to `localStorage` (`echoterra:editor:doc`, debounced) and restored on load**, so a
  refresh/HMR reload never loses the map (`loadSavedDoc` runs `normalizeCell` migration). Canvas `pointerdown`
  blurs the active element and the Space pan-modifier `preventDefault`s — so a toolbar button that kept DOM focus
  can't be re-triggered by a later Space/Enter (was spuriously toggling 🔍 Focus while placing buildings).
  **Heights (FFTA2-style)**: a cell at height h draws its ground cube stacked `h+1` times (each level shifted up by
  `ISO.elev`) so it reads as a solid pillar; objects sit on the top face. Tunables in `ISO`: `tileW/tileH`, `elev`,
  `cubeBottomDrop`, `objW`, `objBottomDrop`.
- `spriteMetrics.ts` — **the iso cubes are NOT uniformly framed** (content width 0.63–0.81 of the canvas, content
  height varies ~57–69px; `normalize_iso.py` not re-run on the newer tiles). Each sprite's opaque content bbox
  (`fLeft/fRight/fTop/fBottom`) is measured once and cached. **`cubeAt` draws EVERY block into one uniform box**
  (`tileW × (tileH + cubeDepth)`) from its content bbox (or explicit crop) as the source region, **bottom-anchored
  so the front-bottom vertex sits on the cell** (`p.sy + tileH/2`). This is the key to alignment: all blocks are the
  same size, **sit ON the grid** (grid = block bases, not buried under them), and line up top AND bottom. `cubeDepth`
  == `elev` so stacked height levels connect. Minor vertical stretch (≤~10%) is the trade for guaranteed uniformity.
  Objects (`objectGeom`) stand on the block top, which sits `cubeDepth` above the cell centre.
- `editorExport.ts` — `renderDocToCanvas()` (shared), `exportPng()` (flat full-map PNG, pan/zoom-independent),
  `exportJson()` / `importJson()` (positions+heights+layers round-trip; DEV hook `window.__edExport`).
- `EditorScreen.tsx` (layout) + `EditorCanvas.tsx` (pan/zoom/paint, rAF redraw) + `AssetPalette.tsx` (left) +
  `LayersPanel.tsx` (right) + `Toolbar.tsx` (top) + `editor.css`.
- **Gotcha**: the live canvas redraws via `requestAnimationFrame`, which is paused in the headless preview tab →
  `preview_screenshot` of the editor times out (a pending rAF never goes idle). Verify the renderer instead via
  `window.__edExport.renderDocToCanvas(doc)` → inspect pixels, or inject the data-URL into a non-canvas page.

## 8. Conventions & gotchas

- **CSS class collision**: do NOT use `town` as a tag/utility modifier — it collides with `.town
  { position:absolute; inset:0 }` (the Home town container) and blows the element up to fill its parent with a
  blue overlay. The tab modifier was renamed `ttown`. (This caused the "Structure is all blue" bug.)
- **Phaser scenes** must remove their bus/resize listeners on `shutdown`/`destroy` (done) — otherwise a destroyed
  scene keeps reacting to events and crashes (`this.add` is null). Camera centering uses an explicit zoom-aware
  `setScroll` (Phaser `centerOn` ignores zoom).
- **No React StrictMode** (double-invoke would mount Phaser twice).
- **Preview/screenshot tooling** is flaky in the headless tab (RAF pauses → screenshots/Phaser snapshots time out;
  synthetic Phaser pointer events need a preceding `pointermove` and aren't reliable). Verify via
  `preview_eval` + the dev hook **`window.__eg = { store, bus, EV }`** (DEV only) and `preview_snapshot`/`preview_inspect`.
- **Scheduler concurrency**: the 15s wave goroutine mutates cached games without per-game locks — fine for
  single-player prototyping, add locking before real multiplayer.

## 9. Pending / next steps

1. ✅ **Water 1 ration / hero / day** — DONE. `Hero.DrewWaterDay int`; the Well `water` action draws for the
   selected in-town hero once per `game.day`, ration → that hero's bag, clears `Soif`; the Well modal shows per-hero
   daily status (disabled once that worker has drunk). Derived `town.waterDrawnToday`. Tests in `water_test.go`.
2. ✅ **Fire ball** (map skill) — DONE. `FireballHero` (2 PA) blasts a pack on the hero's tile or an adjacent
   tile; damage scales with précision/dextérité and thins `Monster.Count` (helps break Tétanisé) or destroys the
   pack. Radial-menu button 🔥; route `POST /heroes/{h}/fireball`; tests in `fireball_test.go`. (TODO: gate it to a
   Mage [MAP] class once the class-evolution system exists — currently every hero can cast it.)
3. Combat **Defend/Guard** action (3rd button on mockup page 3).
4. **Building skills** — multiple upgradable skills per building (mockup page 6), beyond a single level.
5. ✅ **Gardien** class counting as 3 in the Tétanisé calc — DONE. `gardienWeight()` in `wave.go`;
   tests `TestGardienCountsAsThreeForTetanise` / `TestNonGardienGetsStuckOnLargePack` in `evolve_test.go`.
6. ✅ Real **class-evolution** system — DONE. `classes.go`: `EvolveHero`, 6 classes (3 intermediate, 3 advanced),
   day gates (2/4). `GET /api/classes`, `POST /heroes/{h}/evolve`. Frontend: `store.classes`, `store.evolve`,
   `HeroOverlay` Evolve picker. `data/classes.ts` removed (replaced by server catalog). Tests in `evolve_test.go`.
7. Building-specific effects: Townhall revive, Bank→Stock, Kitchen→Craft, Tower evaluate (some already navigate).
8. **Visual theme**: move tab panels to overlays on the isometric town; real sprites (needs the AI image connector).

## 10. Memory

A condensed version lives in the user's auto-memory (`echoterra-project.md` + `MEMORY.md`). This `CLAUDE.md` is
the full reference — keep it in sync when systems change.
