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

## 2. Tech stack & how to run

| Layer | Tech |
|---|---|
| Backend | **Go** (`chi` router), REST, state serialized as JSON in **SQLite** (`modernc.org/sqlite`, pure-Go, no CGo) |
| Frontend | **React + Vite + TypeScript**, **Phaser 3** (orthogonal MapScene + isometric CombatScene), **Zustand** store |
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
- **Map** (`MapTab`): Phaser orthogonal map; tap a hero (or the **⚡ Actions** button) opens a **radial action menu**
  (Fight if monster on tile / **🔥 Fire ball -2 PA when a pack is on/adjacent** / Search / Hide / **Escape only when
  Tétanisé**). Combat reached from the map.
- Server timer: `nextWaveAt` drives "Next wave in"; GameScreen polls every 20s so scheduler waves show up.

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
