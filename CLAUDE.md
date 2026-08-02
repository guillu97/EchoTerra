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
| Frontend | **React + Vite + TypeScript**, **Three.js** (moteur voxel : carte, combat, ville), **Zustand** store |
| Map gen | Perlin (`aquilax/go-perlin`) → heightmap **lissée (maxStep 1)** → biomes par niveau ; **60×60 par défaut** (`worldgen.DefaultSize`) |

```bash
# Backend (:8080). Env: ECHOTERRA_ADDR (:8080), ECHOTERRA_DB (echoterra.db),
#                       ECHOTERRA_WAVE_SECONDS (wave interval, default 600; use 60 to test waves),
#                       ECHOTERRA_TURN_SECONDS (combat turn limit multi, default 60 ; game.TurnLimit).
go -C backend run ./cmd/server

# Frontend (:5173, proxies /api -> :8080)
npm --prefix frontend install   # first time
npm --prefix frontend run dev
```

Verify: `go -C backend test ./...` · `npx tsc -b` (in frontend) · `npm run build` (in frontend) ·
`npm run test:perf` (in frontend — budgets de chargement de l'onglet Map, voir §7; réutilise les dev
servers s'ils tournent, sinon les démarre; Chromium requis: `PERF_BROWSER` ou Chrome installé).

**Déploiement Vercel (gratuit)** — voir `DEPLOY.md`. Preset **Services** (`vercel.json`) : service
`frontend` (root `frontend/`, Vite, statique CDN) + service `backend` (root `backend/`, le preset Go
détecte `cmd/server/main.go` — le VRAI serveur, qui écoute `PORT` sur Vercel) ; rewrites `/api/*` +
`/healthz` → backend, reste → frontend. Quand `VERCEL` est présent, `main.go` choisit
`api.NewServerless` (mode *stateless* : pas de goroutines ni de cache inter-requêtes — la base est la
seule vérité ; purge lobbies + salon public par `housekeeping()`, qui **dédoublonne** aussi les salons
publics créés en double par deux instances froides). Le store (`store.Open`) accepte un DSN
`postgres://` (Neon via le Marketplace Vercel, var `DATABASE_URL`) en plus d'un chemin SQLite.
`backend/serverless` = handler FaaS de secours + harnais e2e du mode stateless.

**Horloge de simulation & BATTEMENT (2026-08-01)** — le monde avance **par le temps écoulé**, pas par
un processus vivant : `GameState.AdvanceTo(now, SimBudget)` (`game/sim.go`) rejoue la période manquée
dans l'**ordre chronologique** en entrelaçant les vagues (`NextWaveAt`, toutes les `WaveInterval`) et
les rounds de joueurs-IA (`LastBotAt`, toutes les `BotCatchUpInterval` = 1 min). Convergent (le
rappeler ne rejoue rien), **reprenable** (budget épuisé ⇒ `Done:false`, les horloges ne sont PAS
avancées au-delà du joué, l'appel suivant continue) et **plafonné** (`CatchUpMaxBacklog`, 12 h,
`ECHOTERRA_CATCHUP_HOURS` : au-delà les vagues manquées sont sautées et tracées au journal de la
ville — sinon 3 jours d'oubli = des centaines de vagues et des dizaines de milliers de monstres).
Trois appelants, même horloge : `POST /api/tick` (**le battement**, budget `TickBudget`), toute
requête touchant une partie (`tick()`, budget `RequestBudget`, plus petit — un joueur attend), et le
`waveScheduler` résident en dev. Le battement est appelé par **GitHub Actions toutes les 15 min**
(`.github/workflows/heartbeat.yml`, gratuit sur repo public ; 15 et pas 5 min à cause du quota compute de Neon, cf. DEPLOY.md) + un **cron Vercel quotidien** en filet
(`vercel.json` ; le plan Hobby ne permet pas mieux qu'1×/jour) ; jeton `ECHOTERRA_TICK_TOKEN` (ou
`CRON_SECRET`), sans jeton l'endpoint répond **503** en déploiement. Il écrit avec
`store.SaveIfUnchanged` (colonne `rev`) : **il abandonne son rattrapage plutôt que d'écraser l'action
d'un joueur** écrite entre-temps par une autre instance. Colonnes `status`/`next_wave_at` miroir du
blob JSON → `store.ActiveGames` cible les parties à avancer (les plus en retard d'abord) sans décoder
toute la base. Détail complet dans `DEPLOY.md`. (Ex-`BotCatchUp` et l'ancien `CatchUpWaves` borné à
3 vagues : supprimés.)

**Windows specifics:** dev shell is PowerShell. Go isn't on git-bash PATH → run Go via PowerShell with
`$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")`.
**Git push uses Windows-native OpenSSH** (`core.sshCommand=C:/Windows/System32/OpenSSH/ssh.exe`, set in
the repo) because git-bash's keys are passphrase-locked / agent not running. Remote:
`git@github.com:guillu97/EchoTerra.git`, default branch `main`.

## 3. Repo layout

```
backend/
  cmd/server/main.go            bootstrap (router, store, env; écoute PORT + stateless si VERCEL)
  internal/api/api.go           chi routes, CORS, in-memory cache + SQLite, wave scheduler, handlers
  internal/game/
    game.go                     GameState, Hero, Tile, Monster, Biome, Stats, Item (+ Town struct inline)
    lobby.go                    Player, AddPlayer, AddBot, StartGame, NewStarterHero, NewJoinCode, Status*
    bots.go                     BotAct: joueurs-IA (survie/ville/récolte), 1 action/héros bot par tick
    actions.go                  MoveHero, SearchTile, HideHero, EscapeHero, Advance(legacy), state consts
    classes.go                  ClassDef/ClassSkill catalog (Classes), EvolveHero, EvolveDayIntermediate/Advanced
    combat.go                   CombatUnit, Combat, NewCombat, PlayerAction (+ enemy AI), damage/AoE
    wave.go                     WaveReport, TownDefense/buildingDefense, Recompute, ProcessWave,
                                ForceWave, CatchUpWaves, recomputeTetanise, spawnWaveMonsters
    town.go                     TownBuilding, BuildReq, DefaultBuildings, buildMaterials, buildingCost,
                                HeroesInTown/TownPA/spendFor/canPay, Bank storage helpers, TownAction
    craft.go                    Recipe, Recipes catalog, Craft (town vs field), hero-item helpers
    monsters.go                 NewMonster, MonsterSpecies
    townnames.go                NewTownName: noms de ville générés (Town.Name, posé au worldgen)
    *_test.go                   worldgen, combat, tetanise, build (TestBuildConsumesBankMaterials), evolve
  internal/store/store.go       SQLite OU Postgres (DSN postgres://): one row per game, state as JSON blob
                                + table leaderboard (ScoreEntry, saveScore/Leaderboard — voir §5)
  internal/store/users.go       comptes (email unique, bcrypt ou Google) + sessions (token TTL 30j)
  internal/api/auth.go          register/login/logout/me/me/games, Bearer, userFromReq (anonyme OK)
  internal/api/google.go        Google Sign-In: /auth/config + /auth/google (id_token vérifié via tokeninfo)
  internal/worldgen/worldgen.go GenerateTiles (Perlin->biomes), NewGame (town center, heroes, monsters)
  serverless/serverless.go      handler FaaS de secours + harnais des tests e2e du mode stateless
vercel.json                     preset Services: services frontend (Vite) + backend (Go) + rewrites
frontend/src/
  main.tsx                      ReactDOM (PAS de StrictMode — double-monterait le moteur voxel)
  App.tsx                       phone-frame device + screen router
  app-shell.css                 all styling (mobile-first; desktop breakpoint >=1024px)
  store.ts                      Zustand: app shell + game/map/combat state + all actions; window.__eg in DEV
  eventBus.ts                   petit émetteur React <-> moteur voxel (noms EV.*)
  townUtils.ts                  heroesInTown, townPA, effectiveTownHeroId, TOWN_TABS
  useWave.ts                    useWaveRemaining (server nextWaveAt), formatHMS
  api/{client.ts,types.ts}      REST client + TS DTOs mirroring Go JSON
  screens/                      LoadingScreen, TitleScreen, CinematicScreen, GameScreen, LobbyScreen,
                                AccountScreen, LeaderboardScreen (classement, onglets par mode)
  components/                   TopBar, BottomNav, HeroChips, Logo, TownWorker(+useWorkerPA),
                                TownStatus, GameOver, HeroOverlay, ItemGrid, MapHeroBar,
                                HeroChip (LA pastille de héros, partagée par les 3 listes),
                                TownJournal, TownChat (messagerie, cf. §5)
  ui/                           Overlay.tsx (LA primitive de modale/feuille : Échap, piège à focus,
                                retour du focus, role=dialog/aria-modal), Toasts.tsx (file aria-live),
                                ErrorBoundary.tsx (écran de secours au lieu d'un écran blanc)
  tabs/                         HomeTab, MapTab, StockTab, StructureTab, CraftTab
  game/                         dpr.ts (DPR plafonné) + render.ts (palette de biomes)
                                ⚠ plus de Phaser : MapScene/CombatScene/PhaserGame supprimés 2026-07-29
  data/                         buildings.ts (TOWN_BUILDINGS layout, NAV_TABS)
```

## 4. Backend domain model (the JSON the client sees)

- **GameState**: `id, name, seed, width(22), height(22), tiles[], heroes[], monsters{id->Monster}, day(1),
  wave(0), waveNumber, nextWaveAt(time), status("lobby"|"active"|"gameover"), lastWave?, monstersKilled, town,
  activeCombat?, combats{}` + lobby: `joinCode, visibility, solo, minPlayers, maxPlayers, players[], createdAt,
  startedAt`.
- **Player** (lobby.go): `id, name, heroIds[3], host, joinedAt` — **1 joueur = 3 héros** (équipe : le 1er
  héros porte le nom du joueur, les 2 autres viennent du pool `companionNames`) ; le 1er joueur est l'hôte.
- **Town** (inline in GameState): `name, x, y, hp(100), maxHp(100), defense(computed), buildings[], storage[]`.
  **`storage` = the Bank** (shared town stash). `name` = nom généré au worldgen (`townnames.go`,
  « Clairmont », « Valbourg-sur-Brume ») — affiché dans la TopBar et **c'est lui qui figure au classement**.
- **Hero**: `id, name, x, y, pa(6), maxPa, hp, maxHp, stats{force,dexterite,agilite,endurance,athletisme,
  precision}, class("Sans classe"), classId, classTier(0|1|2), classBonuses{Stats}, states[], inventory[Item],
  bars{}`.
- **design.go — le catalogue de game-design** (import du JSON du Studio 2026-07-14) : `Terrains{biome ->
  searchable, resourcesMin/Max, drops[DropDef pondérés]}`, `Species[]SpeciesDef` (11 espèces : slime,
  gobelin, élémentaire, chauve-souris, harpies prairie/givre, dryade, araignée cristalline, loup-garou +
  BOSS Roi Gobelin & Arbre Vivant Ancien — stats/PV/pack min-max/biomes d'apparition/`Attacks[AttackDef]`
  avec grilles GDD `Targets/Damage[]GridCell` + effets structurés (DmgStat, StunPct, Root, Absorb,
  SelfShield, BuffAllies)/loots pondérés), `BuildingDesigns{id -> Requires[], Levels[3]{Materials,
  Effects, Defense, Capacity}}` (niveau max 3 ; matériaux craftés aux niveaux hauts : Planche, Corde,
  Brique, Acier, Cœur de chêne ancien). Les PA de chantier restent dans `buildPA` (décision : le design
  n'écrase pas les PA).
- **Tile**: `biome(0..5), height, resources, monsterId?`. Biomes: 0 Water,1 Sand,2 Grass,3 Forest,4 Mountain,5 Snow.
- **Monster**: `id, species, appearance(mob-*), x, y, hp, maxHp, stats, count` (pack size; used for combat unit count AND Tétanisé).
- **TownBuilding**: `id, name, built(bool), underConstruction, paInvested, level(max 3), durability,
  maxDurability, capacity, maxCapacity, open(bool, Gate), defense(computed), cost{pa, materials[Item]},
  requires[{building, level}]` (arbre techno dérivé, affiché verrouillé 🔒 côté Structure).
- **Combat**: `id, gameId, tileX, tileY, gridW(7), gridH(7), heights[], units[CombatUnit], order[], turnIdx,
  round, status("active"|"won"|"lost"), log[]`. **CombatUnit**: `id,name,side("hero"|"monster"),refId,kind,
  x,y,hp,maxHp,stats,states[],move,moved,initiative`.
- **Recipe**: `id, name, category(conso|potion|forge|deco), building(kitchen|workshop), buildingLevel,
  outputType, outputName?, outputQty?(Planche/Brique ×2), field(bool=craftable outside town), paCost,
  ingredients[Item], effects` — **26 recettes** (transformations, armes/équipements mythiques, cuisine,
  alchimie). En ville le bâtiment doit être CONSTRUIT au niveau requis (Kitchen niv.2 = plats raffinés,
  niv.3 = Ambroisie ; Workshop niv.2 = Acier/équipements, niv.3 = Talisman/Amulette) ; en expédition les
  recettes `field` s'affranchissent du bâtiment (feu de camp).
- **WaveReport** (`lastWave`): `wave, day, hordePower, defense, townDamage, townHpAfter, buildingsHit[],
  heroesHit[], monstersSpawned, at, gameOver`.
- **ClassDef** (`/api/classes` catalog): `id, name, tier(1|2), day(2|4), requires[] (arbre : gardien ←
  pionnier ; récupérateur ← chasseur|éclaireur ; herboriste ← éclaireur — vérifié par EvolveHero ET filtré
  dans le picker), role, bonuses{Stats}, paBonus, skills[{name, scope, pa, desc, effects}], appearance{map,
  icon} (asset char-* : sprite du héros sur carte + combat)`. **Passifs implémentés** : Éclaireur vision +1
  (fog), Récupérateur +1 ressource/fouille +1 trophée/victoire, Herboriste +1 plante/minerai, Gardien poids 3
  (Tétanisé). **Actives de CARTE** : chaque classe a sa/ses compétence(s) `MapSkills` (voir §5, route `/skill`),
  ex. Chasseur « Tir précis ». **Actives iso** : `heroIsoSkillsFor(classID)` sert la LISTE des compétences de
  combat de la classe (une par bouton) — pionnier [Frappe de la mort qui tue +5, Coup de bouclier Stun],
  chasseur [Tir de zone en croix, Flèche perçante portée 3], gardien [Posture défensive Bouclier, Provocation
  Root], éclaireur/récupérateur/herboriste 1 skill, sans classe [Frappe puissante]. `combatResponse` sert
  `current.skills[{idx, skill, targets, estimates, selfCast}]` ; l'action combat porte `skillIdx`.

`Recompute()` (called in `persist()` and on load `tick()`) refreshes derived fields: `town.defense`,
per-building `defense`, per-building `cost`, `bank.capacity = sum(storage qty)`, and hero `Tétanisé`.

## 5. Game systems

**Lobby / multijoueur** (`lobby.go`, `LobbyScreen.tsx`) — deux visibilités (`GameState.Visibility`,
"" = private legacy) : **privée** = créée par un joueur, join par CODE, lancée par l'HÔTE, kick = hôte ;
**publique** = créée automatiquement par le serveur ("Expédition de <Ville>", `ensurePublicLobby` au boot
+ janitor + après chaque auto-start → il y a toujours un salon public ouvert), listée sans joinCode,
**démarre seule dès `minPlayers` atteint** (`MaybeAutoStart`), start manuel/bots/pouvoirs d'hôte
refusés, expulsion par **vote majoritaire** (`VoteKick`, `KickVotes`, majorité stricte des autres
humains, lobby only, votes purgés aux départs). **Mode solo** : `POST /api/games/solo` = partie privée
créateur + 4 bots lancée immédiatement (bouton menu "🤖 Solo"), marquée `GameState.Solo` (classement).
Une partie naît en statut **`lobby`** :
`POST /api/games/lobby` génère le monde SANS héros, SANS monstres ni vague programmée, avec un `joinCode`
(5 car.) et auto-join du créateur (= hôte 👑). Chaque `join` (par code ou id) spawn l'ÉQUIPE de 3 héros du
joueur en ville (stats du pool GDD cyclées). L'hôte lance via `POST /{id}/start` **une fois `minPlayers`
atteint** (min défaut 2, max défaut 4, clamp 1–8) → statut `active`, 1re vague programmée, et **seeding
des monstres ∝ joueurs** (`SeedStartingMonsters`: packs = 4+2*(joueurs-1), taille +rand(joueurs)).
Les vagues sont inertes en lobby. **Bots** : l'hôte peut ajouter des joueurs-IA (`POST /{id}/bots`,
`Player.Bot`, noms du pool `botNames`) — équipe de 3 héros, comptent pour min/max, expulsables ; le
scheduler les fait jouer (`bots.go BotAct`, ~1 action/héros/min : combat iso AUTO-RÉSOLU sur un pack de
leur case si l'équipe 100% bot fait le poids (`botShouldEngage`, IA héros = `heroAutoTurn` miroir de
l'IA monstre, bataille entière résolue sous le verrou du tick), sinon boule de feu ; retraite/cachette
avant la vague, eau/dépôt/chantier/réparation en ville, fouille et exploration sinon, évolution de
classe auto aux paliers jour 2/4 selon les stats (`botEvolve`) — via les actions publiques validées ;
pas encore de craft [aucune mécanique de consommation d'objets]). Tout est persisté en SQLite (le salon survit à un redémarrage ; les
salons ouverts se listent via `GET /api/games?status=lobby`). ⚠ **toute recherche de salon passe par
`store.ListByStatus(StatusLobby, n)`, JAMAIS par `List(n)` + filtre en Go** : un salon est écrit une
fois puis plus jamais, alors que chaque partie active est réécrite à chaque vague ET par le battement —
filtrer après le `LIMIT` rendait la recherche publique, le `joinByCode` et `ensurePublicLobby` aveugles
dès qu'il y avait `n` parties plus fraîches (bug 2026-08-02, test `TestListByStatusIgnoresFresherGames`).
Le front garde l'identité par partie dans
`localStorage` (`echoterra:player:<gameId>`, nom dans `echoterra:playerName`) ; la salle d'attente poll
toutes les 3 s et bascule tout le monde en jeu quand l'hôte lance. `POST /api/games` (legacy) reste le
flux solo instantané à 3 héros pour "Test rapide". **Ownership serveur** : dans une partie AVEC joueurs,
toute action héros (move/search/hide/escape/fireball/evolve/combat, worker de ville, unité de combat)
exige le `playerId` propriétaire (`CheckHeroOwnership`; legacy 0-players = libre) ; `town/deposit` ne
dépose que le sac de SON héros ; **`town/action` exige `heroId` en multi** (le pool PA partagé
`spendTownPA` drainerait les héros des AUTRES joueurs — interdit, test `town_test.go`) et le front
(`townUtils` : `heroesInTown/townPA/effectiveTownHeroId/myTeamHeroes` prennent `playerId`) ne compte
que MES héros pour la présence en ville, le worker, les PA et le Stock. `POST /{id}/leave` (lobby only, salon vidé = supprimé, hôte transféré),
`POST /{id}/kick` (hôte). Goroutine `lobbyJanitor` purge les lobbies non lancés de +24 h (`store.Delete`).
Tests: `lobby_test.go`, `store_test.go`, worldgen `TestNewLobby*`.

**Classement des villes** (`store.go` table `leaderboard`, `GET /api/leaderboard`,
`LeaderboardScreen.tsx`, 2026-08-02) — **une ligne par partie LANCÉE** (les salons sont exclus),
upsertée à chaque `Save` ET à chaque `SaveIfUnchanged` (sans ce second point, une ville qui ne
survit que par le BATTEMENT ne monterait jamais au tableau) et qui **survit à la suppression de la
partie**. `ScoreEntry {gameId, townName, gameName, mode, players[] (humains seulement), days, waves,
monstersKilled, gameOver, updatedAt}` ; tri `waves DESC, monsters_killed DESC, updated_at DESC`,
top 50. **Trois natures de partie qui NE SE COMPARENT PAS** (`GameState.LeaderboardMode()`) :
`solo` (drapeau `GameState.Solo`, posé par `POST /api/games/solo` ; repli pour les parties d'avant
le drapeau : privée + 1 humain + ≥1 bot), `public`, `private` — le paramètre `?mode=` filtre, un mode
inconnu répond 400. Le score suivi est `GameState.MonstersKilled`, incrémenté dans `CastMapSkill`
(`rep.Slain`) et dans `FinishCombat` sur une victoire (`m.Count`, le pack entier — ce qui couvre
aussi les combats auto-résolus des bots). Front : bouton « 🏆 Classement » de l'écran titre →
4 onglets **Toutes · Solo · Publiques · Privées**, chacun refaisant la requête avec son mode ; le
badge de mode par ligne n'apparaît que dans « Toutes ». Tests : `achievements_test.go`,
`store_test.go` (`TestLeaderboardSavesAndRanks`, `TestLeaderboardFiltersByMode`).

**Comptes utilisateur** (`store/users.go`, `api/auth.go`, `api/google.go`, `AccountScreen.tsx`,
`googleAuth.ts`) — email+mot de passe (bcrypt, gratuit) **et Google Sign-In**, sessions Bearer 30 j,
bouton 👤 sur l'écran titre. `Player.UserID` lie un joueur à son compte : nom de joueur = pseudo du
compte par défaut, re-`join` d'une partie où mon compte figure → MON joueur (`rejoined:true`, reprise
multi-appareils), `GET /api/auth/me/games` + "Mes parties" (reprise en un clic). L'anonyme reste
possible partout. **Google** : activé par `ECHOTERRA_GOOGLE_CLIENT_ID` (backend) ; le front lit
`GET /api/auth/config` et, si configuré, charge Google Identity Services et affiche le bouton officiel ;
le `credential` (id_token) est vérifié serveur via l'endpoint `tokeninfo` (signature/expiration par
Google, audience + email vérifié par nous — vérificateur injectable dans les tests). 1er login Google =
création du compte (provider "google", PassHash vide → login mot de passe refusé avec message dédié) ;
email déjà inscrit = même compte. Setup GCP : voir `DEPLOY.md`. Apple écarté (payant, ~99 $/an).

**Movement / PA** — 6 PA/hero/day. Move = 1 PA/orthogonal step (blocked if `Tétanisé`; clears `Caché`;
PA→0 adds `Fatigue`). Search = 1 PA, **tirage pondéré de la table du terrain** (`Terrains[biome].Drops` —
plaine : fleur/viande/débris + baies/fibres ; forêt : herbe/peau/bois + champignons/baies ; montagne/neige :
paliers de rareté pierre > fer/charbon > argent/or/givre), decrements tile `resources`. **Search et Hide sont
REFUSÉS sur la case ville** (serveur `actions.go` + menu radial masqué ; la tuile ville est générée avec
`resources: 0` pour que les bots/UI ne la ciblent pas).

**Compétences de carte PAR CLASSE** (`mapskills.go`, 2026-07-20 — remplacent la boule de feu universelle) —
catalogue data `MapSkills []MapSkillDef {id, classId, name, icon, pa, desc, kind, base, stat, loot}` servi par
`GET /api/mapskills` ; `MapSkillsForClass(classID)` = les compétences de SA classe (ou la base `stone-throw`
« Jet de pierre » pour un héros sans classe). `CastMapSkill(heroID, skillID)` (route `POST /heroes/{h}/skill`
`{skillId}`) valide la possession (classe) + les PA, puis :
- **blast** (Jet de pierre / Charge héroïque pionnier / Volée de flèches chasseur / Tir tendu éclaireur / Cri
  de ralliement gardien / Tir chapardeur récupérateur [+trophée] / Projection de spores herboriste) : souffle
  de zone sur un pack de la case du héros ou orthogonalement adjacent, `dmg = base + stat + dext/2 + rand(0..3)`,
  traverse le pack (réduit `Count` / le détruit — aide à briser Tétanisé) ;
- **snipe** (Chasseur « Tir précis ») : achève 1 créature d'un pack sur la case si PV ≤ 5.
Un `Tétanisé` peut caster ; le sort clear `Caché`. Renvoie `{report:{skillId,name,species,damage,slain,killed,
loot?,...}, game}`. Front : boutons dynamiques (menu radial + dropdown 🙂) filtrés par classe + portée,
catalogue dans `store.mapSkills` (util `skills.ts mapSkillsForHero`). Tests : `mapskills_test.go`. Les bots
lancent leur 1re compétence blast abordable. (Ex-`FireballHero`/`PreciseShotHero` + routes `/fireball`/`/snipe`
SUPPRIMÉS.)

**States (map)**: `Fatigue` (0 PA), `Soif`, `Tétanisé`, `Caché`, `Blessé`. **(iso)**: `Stun`, `Cécité`, `Root`…
- **Tétanisé**: a hero on a tile with a pack is stuck when `playersOnTile < ceil(monsters/heroesPerPack)`
  with `heroesPerPack=4` and `monsters>=2` (1 héros tient 4 créatures, la 5e le submerge). A **Gardien**
  counts as 3 heroes (`gardienWeight`). **Un héros tétanisé ne peut NI bouger, NI fouiller, NI se cacher**
  (refus serveur + UI) — il peut boule-de-feu, Tir précis, Escape, ou ouvrir le combat. Libéré quand le pack
  passe sous le seuil (fireball/snipe/combat), qu'un renfort arrive sur la case, ou en quittant la case
  (Escape). Tests exhaustifs : `tetanise_test.go`.
- **Caché**: from **Hide** (1 PA) — the hero is skipped by the next wave's attack, then concealment is consumed.

**Isometric combat** (`combat.go` / `CombatScene.ts`) — initiative by agility; each turn a unit moves once
(`moved` flag) then acts. **Les attaques sont des `AttackDef` du design** : grille de ciblage VERTE relative à
l'attaquant + zone de dégâts ROUGE autour de la case touchée (toujours incluse), effets structurés — dégâts
par stat (force/dext/précision, diviseur), % Stun, **Root** (consommé au début du tour de la victime : pas de
déplacement ce tour), Absorbe (soigne la moitié), **Bouclier** (-50% subis jusqu'au prochain tour), buff
d'alliés (+2 force adjacents, Hurlement de Meute). L'IA monstre choisit base/spéciale (~35%), s'approche
jusqu'à ce que la cible soit sur une case de ciblage, frappe avec la zone. Héros : attaque de mêlée + skill de
classe (`heroSkillFor`) ; `combatResponse` sert `attackTargets`/`skillTargets` calculés sur les grilles + la
def complète du skill. Heights give a small bonus. Win → pack retiré + **chaque héros tire un loot pondéré de
la table de l'espèce** (Récupérateur +1 trophée). Lose → survivors retreat to town at 1 HP + `Tétanisé`.
Combat unit count is capped at 4 ; `CombatUnit` porte `classId` + `appearance` (sprites côté client).
**Combats CONCURRENTS (2026-07-20)** : un combat ne fige plus les autres joueurs — les actions de carte sont
bloquées seulement pour les héros ENGAGÉS (`g.heroInCombat(heroID)`), plusieurs combats tournent en parallèle
(`StartCombat` refuse juste un héros déjà au combat, `FinishCombat` ne nettoie que le sien). Client :
`combatUtils.myActiveCombat` scanne tous les combats actifs (bouton « Rejoindre » + marqueur ⚔ par case).
Vue de DESSUS en combat : `engine.setTopDown` (bouton 🔼/🎥 de VoxelCombatView) plonge la caméra (~78°) pour
voir les monstres masqués par les reliefs. **MINUTEUR DE TOUR (2026-07-22, anti-blocage multi)** : en combat
PARTAGÉ (`sharedHumanCombat` = ≥2 participants présents), le tour d'un héros d'humain présent est minuté
(`Combat.TurnDeadline`, `game.TurnLimit` 60 s / `ECHOTERRA_TURN_SECONDS`) ; à l'expiration `EnforceTurnTimer`
fait jouer le héros par l'IA (`heroAutoAct`) et passe le tour. Armé dans `advanceUntilHeroOrEnd`/`JoinCombat`,
purgé par `advanceTurn` ; enforcement paresseux (`getCombat`, `tick`) + scheduler (`waveScheduler`). Solo/
legacy = pas de limite. Front : `useTurnRemaining` → badge « ⏱ Ns » dans `CombatControls`.

**Waves / horde (Hordes-like)** — `nextWaveAt` is **server-driven**; the client only shows the countdown
(`useWaveRemaining`). Resolved lazily on access (`tick`) AND by a 15s scheduler goroutine.
`ProcessWave`: `hordePower = 12 + 6*waveNumber`; **defense** = sum of wall/gate/tower contributions scaled by
durability (**an open Gate = 0**, a construction site = 0); `overflow = horde - defense` → town HP loss +
random building durability damage; defensive buildings also wear. Heroes **outside** town are hit individually
(`Blessé`); **hidden** heroes skipped; **in-town** heroes safe. PA regen each wave; the **Well refills +10**;
new monsters spawn **selon les biomes d'apparition des espèces** — **scaling INFINI par vague (2026-07-22)** :
le nombre de packs posés (`spawnWaveMonsters` : `4+waveNumber`, PLUS de plafond — borné en pratique par la
saturation des tuiles) ET la taille des packs croissent sans borne (`spawnWeightedPack` : la croissance de
vague `waveNumber/2` s'empile SANS clamp au PackMax — le PackMax ne borne plus que la taille de départ). Les
**BOSS** (Roi Gobelin, Arbre Vivant Ancien) n'entrent dans le pool qu'à partir de la vague 4
(`bossWaveThreshold`) et ne reçoivent pas la croissance. **Fusion des packs en migration** :
`migrateMonstersTowardTown` fait avancer chaque pack d'un pas vers la ville ; quand le pas est bloqué par un
AUTRE pack (aucune case libre plus proche), les deux **fusionnent** (`mergePacks` — effectifs additionnés, le
groupe le plus nombreux impose espèce/apparence/stats/PV ; le mobile disparaît dans le pack resté en place).
Résultat : la horde se consolide en packs de plus en plus gros en convergeant (constaté : ~900 créatures en
~20 packs, max ~186, à la vague 30). Un pack en combat ne migre/fusionne pas ; chaque pack ne joue qu'une
fois par vague. Défense des bâtiments = valeur PAR NIVEAU du design (wall 10/15/20, gate 8/12/16 fermée,
tower 6/9/12) × ratio de durabilité. **Game over** when town HP hits 0 (`status:"gameover"`).
`POST /advance` = force a wave now (dev/testing ; `{safe:true}` = sans dégâts ville).

**Town buildings & construction** — built at start: **gate, wall, bank, well, workshop, panel**, tous
**à 100 % de durabilité** (2026-08-02 : la graine les livrait usés — muraille 20/100, portail 40/100 —
et comme `buildingDefense` est proportionnelle au ratio, la ville ouvrait la vague 1 avec ~2 de défense
contre une horde à 18 ; l'usure vient des vagues, pas de la graine). Construction sites (Built=false) :
**townhall (renamed from House — revive), tower, kitchen, recyclerie, poste**. ⚠ `DefaultBuildings()` ne
tourne QU'AU worldgen : `Recompute` → `backfillBuildings()` ajoute à l'état neuf tout bâtiment du
catalogue absent d'une partie déjà enregistrée (sans jamais toucher aux existants) — sinon un bâtiment
ajouté après coup n'atteindrait aucune partie en cours.
`TownAction(buildingId, action, points, heroId)`:
- `build` → **flux CHANTIER collectif (2026-07-14)** : (1) **poser le PLAN** (1 PA, `planPACost`) ouvre le
  chantier (`UnderConstruction=true`, `PaInvested=0`) — vaut pour les sites ET les améliorations ; (2)
  **investir des PA** (`points`, borné au restant et aux PA du payeur) — autorisé UNIQUEMENT si TOUS les
  matériaux requis sont en Banque (simple présence, PAS consommés) ; s'il en manque, l'investissement est
  refusé mais **les PA déjà investis restent acquis** (le chantier est juste en pause) ; (3) quand
  `PaInvested` atteint `cost.PA`, les matériaux sont consommés et le bâtiment est construit (level 1) ou
  amélioré (level++). **PLAN À TROUVER + matériaux + PA (2026-07-21)** : la construction NEUVE (niveau 1)
  d'un site exige EN PLUS un **plan (blueprint) LOOTABLE** dans la Banque, requis ET consommé à la POSE du
  chantier (gate SUPPLÉMENTAIRE, pas un remplacement — il faut aussi les matériaux niv.1 + les PA)
  (`buildingPlanItem` : townhall→« Plan de la Mairie », tower→« Plan de la Tour », kitchen→« Plan de la
  Cuisine », recyclerie→« Plan de la Recyclerie » ; `BuildReq.Plan` porte le nom). Les plans tombent des
  **ruines** (chaque ruine en donne un, cf. ruins.go) et de la **fouille de terrain** ; les bâtiments
  **SIMPLES** (recyclerie, cuisine) ont des plans **COMMUNS** dans les biomes proches de la ville
  (sable/prairie, poids 2-3) pour ne pas bloquer le début, les avancés (tour/mairie) restent modérés
  (forêt/montagne, poids 1). Les **améliorations** (niv.2/3) n'exigent PAS de plan, gardent leurs matériaux
  craftés (`BuildingDesigns` — Planche/Corde/Brique/Acier, Townhall niv.3 = **Cœur de chêne ancien** du
  boss forêt). Coûts PA **élevés et collectifs** :
  `buildPA` (townhall 20, tower/wall/workshop 15, kitchen/gate/bank 12, well 10, panel 6) × niveau visé,
  **−1 si Workshop niv.2+**. **Prérequis d'arbre techno vérifiés à la pose** (townhall/kitchen ← workshop 1,
  tower ← wall 1 ; 🔒 côté Structure). Capacités par niveau à l'achèvement (Well 50/75/112, Bank 500/750/
  1125). `building.cost` expose PA + `plan` (site neuf) + `materials` (niv.1 pour un site, niv. suivant pour
  une amélioration), `building.paInvested` la progression. Structure : « 📐 Poser le plan » (gaté sur le plan
  en Banque, affiché « 📐 <plan> 0/1 » + les matériaux « Bois n/m ») / « 📐 Améliorer » ; la POSE ne réclame
  que le plan, l'INVESTISSEMENT des PA réclame les matériaux ; barre de progression + « +N PA ». Les bots posent les plans des sites *quand le plan
  est en Banque* (sinon l'action échoue en silence), déposent les plans qu'ils trouvent, et rejoignent les
  améliorations ouvertes par les humains. Tests in `build_test.go`.
- `restore` → +5 durability per PA (built only).
- `revive` (Townhall) → **ressuscite le premier héros mort** : PV = max/2, replacé en ville, états purgés.
  Quota quotidien = niveau du Townhall (1/jour niv.1, 2/jour niv.2) ; **niv.3 = illimité ET gratuit** (sinon
  2 PA). Suivi `Town.ReviveDay/RevivesToday`. Bouton « 🛏️ Ressusciter <héros> » dans le modal Home.
- `water` (Well) → **FREE**, draws **one Ration d'eau per in-town hero per `game.day`**: charged to the selected
  town worker (`heroID`), decrements Well `capacity`, clears that hero's `Soif`, and drops the ration into **that
  hero's bag** (not the Bank). Tracked via `Hero.DrewWaterDay`; derived `town.waterDrawnToday` lists who drank today.
  **Sur la CARTE**, un héros peut BOIRE une Ration d'eau de son sac (`DrinkRation`, route `/drink`, boutons 💧) :
  +6 PA (`RationPA`, plafonné à MaxPA), purge Fatigue/Soif, refusé sans ration ou à PA plein — sans coûter de PA.
- `toggle` (Gate) → 1 PA, flips `open` (open = 0 defense; matches Neko's "qui a laissé la porte ouverte" chat).
  **Une porte CONSTRUITE et FERMÉE scelle la ville** : personne n'entre NI ne sort (`GateClosed()` dans
  `MoveHero` — deux sens — et le pas de retraite d'`EscapeHero` ne peut pas finir sur la ville ; les losanges
  de déplacement du client reflètent la règle). La porte **démarre OUVERTE** (les héros doivent pouvoir sortir
  au spawn) — la fermer restaure sa défense : c'est LE dilemme Hordes. Les bots ouvrent la porte avant de
  sortir récolter et se cachent s'ils trouvent porte close en rentrant. Tests `gate_test.go`.
- `use` → 1 PA flavored (others).

**Bank** = `town.storage`: deposit hero loot (`/town/deposit`), craft I/O in town, construction materials.

**Ruines-donjons** (`ruins.go`, 2026-07-19) — 5 bâtiments en ruine PAR BIOME semés au worldgen
(`SeedRuins`, déterministe, 1/biome, Chebyshev ≥ 3 de la ville) : Épave (sable 8 PA), Ferme
(prairie 8), Sanctuaire (forêt 10), Mine (montagne 12), Tour gelée (neige 12). `GameState.Ruins`
+ `Tile.RuinID`, caviardés par le fog comme les monstres. **Déblayage COLLECTIF** (`ClearRuin`,
PA partagés comme les chantiers, refus Tétanisé/combat) puis **donjon** (`ExploreRuin`, 2 PA,
4 charges) : tirage pondéré par type — matériaux rares (Acier, Cœur de chêne ancien), items
rares, « plans anciens » ; Récupérateur +1. Front : menu radial ⛏️ Déblayer / 🏛️ Explorer ;
voxel `site-*` v0 enseveli / v1 déblayé (variante par ÉTAT serveur), socle doré. Tests
`ruins_test.go`. (Les bots ignorent les ruines.)

**Journal de la ville** (`town.log`, bâtiment Panel) — `TownLogEntry {at, day, text}`, **serveur-side,
partagé, plus récent en premier, plafonné à 100** (`logTown`). Recense UNIQUEMENT les actions faites en
ville : porte OUVERTE/FERMÉE, ration puisée au puits, dépôts à la Banque (par héros), chantiers
lancés/terminés/améliorations, réparations, crafts en ville, `use`. Front : `TownJournal.tsx` (overlay,
`store.townJournalOpen`), ouvert par le bouton « 📋 Journal » du Panel. Tests `townlog_test.go`.

**Messagerie de la ville** (`chat.go` + `moderation.go`, `TownChat.tsx`, 2026-08-02) — les joueurs d'une
même ville se parlent, et l'accès est **POSITIONNEL** : un héros vivant sur la case ville ⇒ on écrit et on
lit librement ; sinon il faut que la ville ait bâti la **Poste** (`ChatAccess` → `remote:true`, message
marqué 📮). Une Poste à 0 de durabilité ne relaie plus (même convention que le Portail). `ChatMessage
{id, at, day, playerId, author, text, filtered, remote}` dans `Town.Chat`, **du plus ANCIEN au plus
récent** (à l'inverse du journal), plafonné à `chatCap` 120 en coupant par la tête ; anti-flood
`chatMinInterval` 3 s par joueur, déduit du board (pas d'état en plus). ⚠ **le board ne transite JAMAIS
par le payload de partie** : `ClientView` le remplace par `Town.ChatCount` (la pastille de non-lus), parce
que la lecture est gatée PAR JOUEUR et que `ClientView` ne sait pas qui appelle — le contenu passe par la
route dédiée `GET /town/chat`, qui **n'appelle pas `tick()`** (sondage à 4 s quand la feuille est ouverte :
le faire passer par la simulation multiplierait rattrapages et écritures SQL). **Modération = MASQUER,
jamais refuser** (`Moderate`) : découpage en JETONS (normaliser change les longueurs, masquer par indice
smearait le masque), normalisation par jeton (minuscules, accents dépliés, leet `0→o 4→a…`, `*` → JOKER
positionnel, lettres répétées réduites), liste `badWords` **strict par défaut** (égalité + suffixes FR)
et `loose:true` (sous-chaîne) réservé aux mots longs et sans ambiguïté — « retard », « crever », « rape »,
« con » sont volontairement ABSENTS (vocabulaire ordinaire ; cf. le test de non-régression). Front :
bouton ✉️ de la TopBar (pastille `chatCount − chatSeen`, lu localStorage par partie), feuille
`store.chatOpen`, bulle du DERNIER message sur l'écran Ville, panneau verrouillé explicatif hors de
portée. Tests `chat_test.go`, `moderation_test.go`.

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
POST /api/tick                                   BATTEMENT: avance TOUTES les parties actives + entretien
                                                 des salons (jeton ECHOTERRA_TICK_TOKEN/CRON_SECRET en
                                                 Bearer ou ?token=; GET accepté aussi) -> {ok,games[],…}
GET  /api/recipes
GET  /api/leaderboard[?mode=solo|public|private]  classement des villes (top 50, vagues puis monstres tués ;
                                                 mode inconnu -> 400) -> [] ScoreEntry
GET  /api/auth/config                            {googleClientId} (""=Google désactivé; le front s'y adapte)
POST /api/auth/register                          {email,name?,password} -> {user,token} (bcrypt, session 30j)
POST /api/auth/login                             {email,password} -> {user,token} ; POST /api/auth/logout
POST /api/auth/google                            {credential:id_token GIS} -> {user,token} (501 si non configuré)
GET  /api/auth/me                                 (Bearer) -> {user}
GET  /api/auth/me/games                           (Bearer) mes parties + myPlayerId (reprise multi-appareils)
GET  /api/games?status=lobby                      list game summaries (id,name,joinCode,players,min/max…)
POST /api/games                                  {width?,height?,seed?} -> GameState (legacy solo, 3 héros)
POST /api/games/lobby                            {playerName,name?,minPlayers?,maxPlayers?,…} -> {game,player}
POST /api/games/solo                             {playerName} -> {game,player} (privée + 4 bots, lancée)
POST /api/games/join                             {code,playerName} -> {game,player} (code OU id)
POST /api/games/{id}/join                        {playerName} -> {game,player}
POST /api/games/{id}/start                       {playerId} -> GameState (hôte, exige minPlayers)
POST /api/games/{id}/leave                       {playerId} -> {left,deleted[,game]} (lobby only)
POST /api/games/{id}/kick                        {playerId,targetId} -> privé: {game,kicked} (hôte) ;
                                                 public: {game,votes,needed,kicked} (vote majoritaire)
POST /api/games/{id}/bots                        {playerId} -> {game,player} (hôte; ajoute un joueur-IA)
GET  /api/games/{id}                              (runs wave catch-up)
GET  /api/games/{id}/world
POST /api/games/{id}/advance                      force a wave (dev)
POST /api/games/{id}/town/action                  {buildingId, action: build|restore|use|water|toggle|revive, points?, heroId?}
POST /api/games/{id}/town/deposit                 deposit in-town heroes' loot into the Bank
POST /api/games/{id}/town/craft                   {recipeId, heroId}
GET  /api/games/{id}/town/chat?playerId=…         messagerie de la ville (gatée : héros en ville OU Poste
                                                  bâtie) -> {messages[], poste} ; 400 = hors de portée.
                                                  N'appelle PAS tick() (sondage rapide, cf. §5)
POST /api/games/{id}/town/chat                    {playerId, text} -> {message, messages[], poste}
POST /api/games/{id}/heroes/{h}/move              {DX,DY}
POST /api/games/{id}/heroes/{h}/search
POST /api/games/{id}/heroes/{h}/hide
POST /api/games/{id}/heroes/{h}/escape
POST /api/games/{id}/heroes/{h}/skill             {skillId} compétence de carte par classe -> {report, game}
POST /api/games/{id}/heroes/{h}/drink             boit une Ration d'eau du sac (+6 PA) -> GameState
POST /api/games/{id}/heroes/{h}/ruin/clear        {points} déblaye la ruine sous le héros -> {ruin, game}
POST /api/games/{id}/heroes/{h}/ruin/explore      fouille le donjon déblayé (2 PA) -> {item, game}
POST /api/games/{id}/heroes/{h}/evolve            {classId} -> GameState (applies class bonuses)
GET  /api/classes                                 [] ClassDef catalog (tier 1+2 classes)
GET  /api/mapskills                               [] MapSkillDef (compétences de carte par classe)
POST /api/games/{id}/heroes/{h}/combat/start
GET  /api/games/{id}/combat/{c}
POST /api/games/{id}/combat/{c}/action            {unitId, action: move|attack|skill|defend|push|flee|item|end, x,y, targetId, skillIdx, item}
```

## 7. Frontend UX (decisions that matter)

**Design system (revue complète 2026-07-26).** `app-shell.css :root` porte maintenant, en plus de la
palette parchemin : espacements `--s-1..7`, rayons `--r-sm/md/lg/pill`, typo `--t-xs..2xl` +
`--lh-*`, ombres `--sh-*`, couches `--z-map/chrome/float/overlay/toast/modal-top` (remplacent 21
z-index ad hoc), motion `--dur-*`/`--ease`, cibles `--tap`/`--tap-lg`, traits `--line*` et voiles
`--veil-*`/`--shade*`/`--backdrop`. **Utiliser ces tokens plutôt que des littéraux.** Socle global :
un anneau `:focus-visible` doré unique, un plancher de cible tactile sur les familles de boutons de
chrome (`.pill/.chip/.iconbtn/.nav-tab`…) — PAS sur tous les `button`, les grilles denses sont des
damiers — et une coupure `prefers-reduced-motion` qui neutralise toutes les animations. Les modales
passent **obligatoirement** par `ui/Overlay.tsx` (ne pas recopier le couple
`.settings` + `stopPropagation`) ; les retours d'action passent par `store.notify()` → `ui/Toasts.tsx`.
L'app est **en français** : les chaînes anglaises restantes sont des bugs — SAUF celles qui portent
de la logique de jeu (`"Ration d'eau"`, `"Plan "`, `"Tétanisé"`), à ne jamais traduire. Les noms de
bâtiments s'affichent via `buildingName(id)` (`data/buildings.ts`), pas via `b.name` du serveur.

- **App shell**: **full-bleed à toutes les tailles** — `.device` est simplement le conteneur plein
  viewport (100dvh) ; le cadre téléphone/tablette centré sur desktop a été SUPPRIMÉ (2026-07-13). Le
  breakpoint ≥1024px ne fait plus que des ajustements de tailles + plafonne les rangées larges
  (contenu de `.map-controls`, barres du loading) pour qu'elles ne s'étirent pas d'un bord à l'autre.
  Screen flow: loading → title → cinematic → game. In-game: TopBar + active tab + BottomNav.
- **Bottom nav** (5 tabs, refondue 2026-07-26) : onglets parchemin gravés **Ville · Sac · [Carte] ·
  Bâtir · Atelier** (libellés FR dans `NAV_TABS`), avec la **Carte en pastille centrale surélevée**
  (`.nav-center`, débord de 26px vers le haut — les barres posées au-dessus doivent réserver
  ~30px, cf. `.map-herobar`). L'actif se marque par l'encre + un fond crème + un **liseré doré sous
  l'onglet** (plus la pilule rouge pleine, qui criait plus fort que le contenu). Icônes = les PNG
  peints `assets/ui/nav-*` (réduits à 160px par `scripts/downscale-ui.mjs` — en 1024² ils faisaient
  dépasser le budget `test:perf`), emoji en repli. `role="tablist"` + `aria-selected`, cibles 48px.
  Only **Home** is gated to having one of MY heroes in town (`TOWN_TABS = ["home"]`; another
  player's hero in town doesn't open MY city screen) — l'onglet verrouillé reste **focusable**
  (`aria-disabled`, pas `disabled`) et explique la raison par un **toast** au tap, le `title=` étant
  invisible au doigt. **Map/Stock/Structure/Craft are always accessible.**
- **TopBar**: l'avatar (🙂) ouvre le **dropdown des héros** (`HeroActionsMenu`) : une `HeroChip` par héros
  de MON équipe (taper la pastille = sélectionner + basculer sur la Map ; ⓘ = **fiche de personnage**),
  puis les actions contextuelles du héros (⚔️ si monstre sur sa case, compétence de classe si pack à
  portée, 💧 ration, 🔎/🫥 hors ville, 🏃 si Tétanisé, note « en ville » sinon). Les actions sélectionnent
  le héros puis agissent. La barre du bas de la Map est réduite à Forcer vague + 👥 Autres (déplacement
  inchangé : losanges jaunes). ⚠ le span du nom de ville est `className="town-name"`
  — PAS `town` (collision `.town{position:absolute;inset:0}` qui recouvrait l'avatar et mangeait ses
  clics). 🏰% chip opens **TownStatus**; ✉️ ouvre la **messagerie** (pastille de non-lus ; JAMAIS gaté sur
  la présence en ville — c'est la feuille qui explique le blocage) ; ⚙️ opens Settings.
- **HeroChip** (`components/HeroChip.tsx`) : LA pastille de héros — portrait de classe, nom, barre de PV,
  PA, badge de lieu 🏰/🔒/💀 — partagée par les TROIS listes (barre de la Map, liste de l'écran Ville,
  dropdown de la TopBar ; `CombatHeroBar` recopie déjà les mêmes classes `.mhb-*`). Variante `layout=
  "column"` pour les listes empilées. ⚠ le badge « en ville » s'appelle `intown`, PAS `town` : la règle
  GLOBALE `.town{inset:0}` l'étalait sur tout le portrait (même piège que §8, corrigé 2026-08-02, aussi
  dans `CombatHeroBar` où le marqueur de tour est passé à `turn`).
- **MapHeroBar** (`components/MapHeroBar.tsx`, bas de la vue Map) : **barre de sélection des héros** — une
  pastille par héros de MON équipe (portrait de classe, nom, barre de PV, PA, badge de lieu 🏰/🔒/💀). Taper
  une pastille = `store.focusHero(id)` : sélectionne le héros ACTIF (celui que les losanges jaunes déplacent)
  ET recentre la caméra dessus (bus `EV.MapFocusHero`, géré par VoxelMapView `engine.target` + MapScene
  `setScroll`) ; bouton ⓘ = fiche (HeroOverlay). Hint contextuel sous la barre (ville → « tape une case
  adjacente pour sortir » ; Tétanisé ; sinon losanges). C'est LE moyen de choisir qui sort de la ville (les
  héros en ville sont masqués sur la carte mais chacun a sa pastille) et qui je déplace. `focusHero` ≠
  `selectHero` (ce dernier, appelé par les taps carte, ne recentre PAS — le héros tapé est déjà à l'écran).
  Empilé au-dessus de `MapControls` via `.map-bottom` (`.map-controls` passe en `position:static` dedans).
- **Character screen** (`HeroOverlay`, from the avatar): Skill view only (class, attributes + bonuses, unique
  skills, Evolve, ◀▶ roster cycle). **No inventory tab / no Stock link** (user decision).
- **Stock**: MY team's personal bags only (always) + the **Bank** section (only when ≥1 of MY heroes in town)
  + "deposit loot" (server deposits my team's bags only).
- **Structure**: vue par défaut **groupée par état** (tri « Statut ») : **🏗️ Chantiers en cours**
  (constructions ET améliorations — barre `paInvested/cost.pa`, bouton « +N PA », « ⏸ matériaux
  manquants » si la Banque ne couvre pas la liste), **📐 Plans à poser** (sites, bouton « Poser le
  plan » 1 PA), **🏠 Construits** (bouton « 📐 Améliorer » = pose le plan d'amélioration). Tris A-Z/Lv
  = liste plate. Coût affiché = TOTAL du chantier (PA + matériaux vs Banque) ; actions exigent un
  héros en ville (consultation sinon).
- **Home**: en surimpression du plan, une **bulle** reprend le DERNIER message de la messagerie (clic =
  ouvre la feuille ✉️) et la **liste des personnages** (`HeroChips`, colonne à gauche au-dessus de la nav)
  aligne une `HeroChip` par héros de MON équipe. Taper un héros EN VILLE le sélectionne **et** en fait
  l'ouvrier qui paie les PA (`setTownHero`, même choix que `TownWorker`). ⚠ 2026-08-02 : cette colonne
  affichait la CLASSE du héros et, faute de classe, un tableau de secours en dur (« Pionnier »,
  « Récupérateur », « Éclaireur ») qui n'était le nom de personne ; la bulle et le bandeau « Shinki »
  contenaient deux répliques factices de la maquette — les trois ont été remplacés par du réel.
  La ville est un **plan GÉNÉRÉ à partir de l'état de jeu** — `voxel/townLayout.ts`
  (`buildTownLayout()`). Depuis 2026-07-29 elle s'inspire d'**EDORAS** : géométrie POLAIRE, plus
  aucune coordonnée sur une grille. Un **tertre** ovale isolé au milieu de la plaine (la hauteur ne
  dépend que du rayon elliptique, donc strictement décroissante — aucune cuvette possible ; lobage
  et gauchissement de forte amplitude, éteints près du centre, sinon les courbes de niveau sont des
  ellipses homothétiques et la butte fait « gâteau à étages » ; ⚠ vérifier `0 marche > 1`), une
  **palissade de bois** en 16 segments tangents à l'ellipse, **une seule route en lacet** du portail
  au sommet (⚠ elle doit s'arrêter avant t=1 : son rayon tend vers 0 et l'esplanade part en terre
  battue), les parcelles en (rayon, angle) façades vers l'AVAL, et **Meduseld seule au sommet**.
  ⚠ **seuls les gros bâtiments creusent leur terrasse** — faire creuser les ~28 maisons érodait la
  butte de deux paliers ; elles se posent au MINIMUM de leur emprise et mordent dans le talus.
  Palette **rohirrique** : chaume (trois tons) + bois sombre, pas de tuile ni d'ardoise.
  **~28 maisons de remplissage** en **9 modèles** (`house`/`house2`/`house3` ×3, sans rôle de jeu ni
  hotspot), **mobilier de rue** et **clôtures** le long de la route.
  Le terrain n'est PLUS des cubes d'une tuile : il passe par **`smoothTerrain.ts`** (les mêmes
  colonnes fines que la carte du monde, R=10 par tuile), et `townLayout` expose donc un CHAMP
  (`field`, sol + hauteur par cellule) et non une pile de blocs. Les sols de ville sont des codes de
  « biome » réservés dans la palette (`SOIL.GRASS/DIRT/PLAIN/PAVED` = 6..9). ⚠ les objets se posent
  sur une **terrasse plate** creusée au niveau de leur cellule centrale, et la pose lit la hauteur au
  **cœur** de l'objet (le pourtour déborde sur la terrasse du voisin et enfoncerait l'objet d'un
  palier). ⚠ ne PAS aplanir au minimum de l'emprise (enterre les bâtiments) ni adopter le niveau
  d'une terrasse voisine (ça chaîne et rabote toute la butte). La FORTIFICATION n'a pas de terrasse —
  ses pads rabotaient le pied du tertre — mais `contourPoint` la recale sur le contour lobé réel,
  sans quoi le portail tombe hors du terrain et **vole**. La palissade est répartie par **longueur
  d'arc** (par angle paramétrique, l'arc par pas varie de 3,85 à 4,48 sur l'ellipse et il s'ouvre
  des jours près du portail). Rendu par `VoxelTownView.tsx` ; **le mode 2D isométrique de secours a été SUPPRIMÉ**
  (2026-07-29). Les bâtiments posés deviennent des
  **hotspots cliquables** (pastille
  nom + barre de durabilité, contre-échelonnée `--inv = 1/zoom` pour rester lisible à tout zoom).
  **Zoom/pan dans la ville** : molette ancrée au curseur, drag, pinch en mapping absolu (même math que
  MapScene), fit initial auto (refit au resize tant que l'utilisateur n'a pas bougé). **MES héros en
  ville apparaissent sur l'herbe du Home** (cellules `GRASS_FILES` hors anneau des bâtiments,
  affectation par hachage d'id ; les héros des AUTRES joueurs n'y figurent pas) et tout héros en ville
  est **masqué sur la carte du monde** (`MapScene` saute tout héros sur la case ville — ils sont
  « dans les murs » ; sélection via le dropdown 🙂/tap de la case ville, sortie soumise à la porte). ⚠ le viewport
  fait `setPointerCapture` → les `click` des boutons ne partent JAMAIS : les taps sont résolus au
  `pointerup` par `elementFromPoint().closest(".town-spot")`. ⚠ les crops d'assets de l'éditeur vivent
  dans le localStorage du navigateur : le rendu peut différer légèrement sur un autre appareil. Pour
  CHANGER la ville : éditer `voxel/townLayout.ts` (les deux rendus en découlent ; mettre à jour
  `BUILDING_SPRITE` si un nouveau bâtiment interactif apparaît). Tapping the **Workshop** or any
  **construction site** jumps to Structure; other built buildings open a
  **centered modal** (`.bmenu-modal`, never cut off) with durability, defense contribution, building-specific
  actions (Well "Puiser de l'eau" free, Gate "Open/Close", etc.), "Améliorer (Structure)", and Restore.
- **TownStatus** panel: town HP, **defense total + per-building breakdown** (who defends, how much, durability,
  open/unbuilt), every building's durability, and the last-wave report.
- **Map** (`MapTab`): carte du monde en **voxel** (`voxel/VoxelMapView.tsx`) — SEUL rendu depuis
  2026-07-29, le moteur Phaser et tout le rendu 2D isométrique ayant été retirés (bundle 2 652 kB →
  1 138 kB). Terrain en **colonnes voxel fines** (`smoothTerrain.ts`, R=10 colonnes par tuile, pas
  vertical 1/10) plutôt qu'en cubes d'une tuile ; props, personnages et monstres en modèles voxel
  animés (§7a-bis). **Fog of war — appliqué dans le payload HTTP** : `Tile.Discovered` est
  server-authoritative & partagé (`fog.go`: `RevealVision` dans `Recompute`, anneau Chebyshev autour
  de la ville et de chaque héros vivant). `GameState.ClientView()` est appliqué à TOUTE réponse par
  l'interception centrale `clientView` dans `api.writeJSON` : les tuiles non découvertes partent
  **vierges**, les monstres sur tuiles cachées sont **omis**, et la **seed est masquée** (seed +
  générateur = toute la carte). Tests : `fog_test.go` (`TestClientViewRedactsUndiscovered`).
  L'onglet Map reste **MONTÉ toute la partie** (`GameScreen` le rend en permanence avec une prop
  `active`, caché via `visibility:hidden` — PAS `display:none`). Tap a hero (or the **⚡ Actions**
  button) opens a **radial action menu** (Fight if monster on tile / compétence de classe / Search /
  Hide / **Escape only when Tétanisé** ; **Search/Hide cachés sur la case ville**). Combat reached
  from the map.
- Server timer: `nextWaveAt` drives "Next wave in"; GameScreen polls every 20s so scheduler waves show up.

## 7a-bis. Chantier VOXEL (2026-07-17 — voir `VOXEL-PLAN.md`, branche `claude/voxel-map-mobile-2blara`)

Migration progressive du rendu vers un **moteur voxel 3D unique** (Three.js, ortho dimétrique 30°,
**rotation 4 orientations**). Réalisé : **Phase 0** `scripts/voxel/` (gen-blocks.mjs SANS ComfyUI —
palettes extraites des isotiles, recettes procédurales `recipes.mjs` [JS pur, partagé navigateur],
`.vox` 32³ racine + **LOD 16³** dans `voxels/16/` [obligatoire à l'échelle carte : 32³ = 21,9 M tris
mesurés], previews par rendu logiciel `render-iso.mjs` → `asset-index/voxels/`) ; **Phase 1**
`frontend/src/voxel/` (mesher greedy couleurs-par-vertex [⚠ chiralité : enroulement inversé par
l'échange d'axes], moteur ON-DEMAND, InstancedMesh par (bloc,variante) + bloc `under`, contrôles
pinch absolu, banc `#voxel-bench`) ; **Phase 1b** éditeur `#voxeledit` / bouton 🧊 (bibliothèque,
édition raycast, palette, undo, **recettes live** via import direct de recipes.mjs + palettes.json,
export/import .vox, orbite libre) ; **Phase 2** `VoxelMapView.tsx` — la Map voxel derrière
**Settings → « Carte voxel (expérimental) »** (`settings.voxelMap`), MÊME contrat bus que MapScene
(le reste de l'app est agnostique), fog serveur → blocs de brume, billboards persos (étape 1),
déplacement snap sans animation ; **Phase 3** `VoxelCombatView.tsx` (arène 7×7 blocs 32³, reachable serveur en quads verts
contrastés, anneaux cibles, barres de PV + étiquettes canvas `labels.ts` [depthTest OFF —
lisibles derrière un pilier], rotation FFTA2) ; **Phase 4** `VoxelTownView.tsx` (plan de
`townLayout.ts` interprété pile par pile via `buildStacks`, TOUS les matériaux de sol ont leur bloc
voxel homonyme, hotspots raycast + pastilles DOM projetées, héros sur l'herbe, LOD 16³ ;
~625 k tris pour le bourg 21×21 avec son tissu de maisons
 ; **2026-07-19 : bâtiments VOXEL à états** — recettes `bld-*` + `bld-chantier`, 3
variantes par DURABILITÉ (v0 intact / v1 abîmé / v2 ruine, passe `damagePass` : morsures
visant le toit + carbonisation + gravats **contenus dans l'emprise du modèle** — semés sur toute la
grille, ils triplaient la profondeur du rempart en ruine, donc son échelle), groupe dynamique reconstruit à chaque état,
site sans plan = herbe nue, matériau SELF-LIT — l'ombrage cuit + Lambert grisait tout ; **2026-07-22 :
PORTAIL à vantaux ANIMÉS** — `bld-gate` = maçonnerie seule, deux battants séparés `bld-gate-door-l/-r`
[`bldGateDoor`, même grille pleine → repère partagé] pivotant chacun autour de son gond [`GATE_HINGE`
local X ∓, `GATE_OPEN_ANGLE` 1.75 rad] ; `VoxelTownView` lisse `gateAnim` vers `b.open` dans la boucle
rAF → la porte s'ouvre/se ferme en douceur, état `open` server-authoritative donc IDENTIQUE pour tous
les joueurs) ; **Phase 5** personnages voxel (`char-recipe.mjs` gabarit
chibi paramétré 7 classes + `monster-recipe.mjs` 9 silhouettes de monstres, couleurs
échantillonnées des PNG par `gen-characters.mjs`/`gen-monsters.mjs` → `voxels/chars/*.vox`,
`characters.ts` CharLibrary : modèle voxel quand il existe sinon billboard, rotation.y = azimut
caméra chaque frame SUR LA CARTE ; **en COMBAT (2026-07-20) les modèles ne billboardent PLUS** : ils
s'orientent selon leur Facing monde `rotation.y = atan2(fx, fy)` — les unités se font face au début puis
pivotent au déplacement/attaque (FFTA2), stable quand la caméra tourne). Catalogue : `build-catalog.mjs`
énumère `voxels/**` (catégorie `voxels`). **Phase 7 (2026-07-22) — ANIMATION DES UNITÉS** (`rig.ts` +
`unitAnim.ts`) : les `.vox` monolithiques sont **découpés au CHARGEMENT** en corps + membres (bandes de
voxels : jambes/pattes/ailes proprement séparables — `SPECS` par clé), un squelette THREE fait pivoter
chaque membre autour de son articulation (`buildRig` root→tilt→pivots, offset `-pivot` comme les vantaux
du portail) ; les sans-membres (slime/mushroom=squash, ghost=flottement, windelemental=rotation) animent
le corps entier. `applyAnim(rig,state,…)` : idle respiration / **walk** foulée+saut / **attack** lunge+piqué
/ **skill** accroupi→jaillit+pulse / **hit** recul. `UnitAnimator` = registre par id survivant aux redraws,
détecte les déplacements (lerp de pose + arc → walk), joue les one-shots, UNE boucle rAF qui invalide tant
qu'il reste des unités (onglet visible). `CharLibrary.makeRig(key)` (géométries découpées en cache) +
`setRigOpacity` (héros des autres, translucides). Carte : rigs face caméra (idle + marche au pas) ; Combat :
rigs orientés Facing, l'action du JOUEUR émet `EV.CombatAnim{unitId,kind}` (lunge/cast précis), recul des
cibles depuis `lastHits`, acteur ENNEMI déduit (unité active adverse ou la plus proche d'une cible).
**MORT** : `UnitAnimator.playDeath` fait s'effondrer (bascule arrière) + fondre + enfoncer un rig vaincu sur
850 ms puis le retire ; `VoxelCombatView.spawnDeaths` diffe les unités passées à 0 PV entre deux `seq` (groupe
`deaths` survivant aux redraws). **La
VILLE anime aussi les héros** (rigs voxel, respiration à l'arrêt — `CharLibrary`+`UnitAnimator`, fallback
billboard). **Bras & armes des HÉROS = vraies parties** (2026-07-22) : `char-recipe.mjs` tague un canal de
PARTIE (`Grid.curPart` 0 corps/1 legL/2 legR/3 armL/4 armR, l'arme tenue suit son bras), stocké dans un chunk
`.vox` maison `nPRT` (lu par `vox.ts`/`vox-format.mjs` → `VoxModel.parts`) ; `splitRig` découpe les héros
EXACTEMENT par ce canal (monstres = bandes géométriques). **Attaque SPÉCIFIQUE À L'ARME** (`weaponFor(key)`
→ `Rig.weapon`/`weaponSide`) : mêlée = fauchage du bras armé ; arc = main libre qui arme la corde puis relâche
(arc tendu à l'avant) ; bâton = poussée sèche du bras armé ; compétence = les deux bras se lèvent. Seuls les
monstres n'ont pas de canal de partie (bandes). 7 `.vox` héros régénérés ; monstres inchangés.
**Phase 6 (2026-07-17)** : le voxel est le rendu **PAR DÉFAUT** (`voxelMap: true` dans
`DEFAULT_SETTINGS`). **2026-07-29 : le voxel est le SEUL rendu** — Phaser, les scènes
MapScene/CombatScene, `components/TownMap.tsx` et le réglage « Classique » ont été supprimés.
Maintenir deux moteurs obligeait le plan de ville à rester exprimable sur une grille de cases
entières, ce qui interdisait à la fois la géométrie polaire du tertre et le terrain lissé.) **2026-07-22** : `voxelBeauty: true` (mode CINÉMATIQUE — ACES + bloom
+ ciel/brume) et `quality: "Very high"` sont aussi des DÉFAUTS ; migration unique `RENDER_PRESET`
dans `loadSettings` qui bascule les installs déjà sauvegardées une fois (opt-out ultérieur respecté). **Détails du monde** (`WORLD-DETAILS-PLAN.md`, lots D1+D2 faits
2026-07-18) : 37 props ×3 variantes (`scripts/voxel/gen-props.mjs` → `voxels/props/`) et
**`frontend/src/voxel/scatter.ts`** = scatter PARTAGÉ carte/banc, pur (sans THREE) — tables
par biome, règles « près de » (voisinage 8 : bord d'eau, eau calme, pied de falaise, sommet,
prairie ouverte ; ⚠ exiger `discovered`, le fog caviarde le biome à 0) et **repères par
seed** (3-5 landmarks hachés sur `game.id` : menhir, barque, épouvantail, bonhomme de neige,
tortue, ruche, cercle de fées, vieil arbre). **Lots D3+D4 (2026-07-18)** : vie ambiante à
bascule jour/crépuscule sur le cycle solaire (papillons/mouettes/lapins/lièvres/crabes le
jour, lucioles self-lit `MeshBasicMaterial` au crépuscule — sous-groupes `dayProps`/
`nightProps`, `applyPhase(t)` seuil 0.72, `phase` sur `PropPlacement`), toiles d'araignée,
souffle de neige, aigle-landmark qui tournoie au tick solaire (`tickAmbient`), veines de
minerai dorées/cuivrées dans les murs de falaise montagne (`smoothTerrain.wall`, par bruit),
et **cascade** (`cascade.ts` : `findCascadeSite` pur — falaise relief ≥ 2 bordant l'eau,
1/carte par hash de `game.id` — + rideau `ShaderMaterial` à bandes descendantes couvrant la
chute COMPLÈTE à travers les terrasses du lissage, écume au pied), algues affleurantes
(teinte des colonnes d'eau par bruit dans `colColor`), murets en ruine ALIGNÉS (cellules
6×6, rotation posée) et ruines éparses 2-3/carte (colonne/dalle/arche, passe `ruins()` —
⚠ `^` renvoie un int32 signé : toujours `>>> 0` avant `%`/indexation). Le plan
WORLD-DETAILS est ✅ livré en totalité (50 props ×3 variantes). **Nuages (2026-07-19)** :
`clouds.ts` partagé carte/ville — dérive CONTINUE (rAF gated par onglet actif + page
visible, première boucle continue du moteur), anti-pattern par re-tirage du
couloir/altitude/silhouette à chaque tour de piste, castShadow (ombres mouvantes). **Résolution ×
(2026-07-18)** : props stockés ×1.5 (30×30×45, gabarits inchangés — formes courbes évaluées
PAR voxel fin via l'`ellipsoid` partagé + cônes sapin + disque nénuphar ; teinte par nappes
de 2 cellules pour le greedy), monstres ×1.6, persos `CHAR_FINE` 2.5 (chanfrein de coin
DIAGONAL en voxels fins dans `roundedBox`), terrain lissé R=10/VS=1/10. Le mesher normalise
par `model.sx` → tailles écran inchangées. Banc pire-cas 16,1 M tris, vraie partie ~2,2 M.

## 7b. Map editor (dev tool — `frontend/src/editor/`)

A self-contained, full-screen **isometric map editor** ("juste pour moi", inspired by Tiled). Reached via a
🗺️ **Éditeur** button on the TitleScreen (dev section) OR the `#editor` URL hash; `appScreen === "editor"` is
rendered by `App.tsx` **outside** the phone frame. Indépendant du moteur voxel — il utilise **plain
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

## 7c. Studio de données (dev tool — `frontend/src/designer/`)

**But** : éditer le game design en JSON — bouton 🧬 **Données** sur l'écran titre ou hash `#designer`
(`appScreen === "designer"`, hors shell). Sept onglets : **🏗️ Bâtiments** (arbre techno : prérequis
`{building, level}`, niveaux avec PA + matériaux + effets, `startsBuilt`), **⚒️ Craft** (recettes :
bâtiment requis + niveau, `field`, PA, ingrédients, produit `{type,name,qty}`, effets — vue groupée
par bâtiment), **🧙 Classes** (palier/jour/prérequis entre classes, rôle, bonus de stats + PA,
pouvoirs `{name, scope map|iso, pa, desc, effects}`, apparence `{map, icon}` = assets `characters/`
avec préviews), **⛰️ Terrains** (`TerrainDef`, par biome : praticable/fouillable, richesse min–max à la
génération, **table de fouille** `ResourceDrop {type,name,qty,weight}` — weight = pondération du tirage),
**📦 Ressources** (`ResourceItemDef` — **le catalogue d'objets** `{id,name,icon,type,desc}` groupé par
catégorie `RESOURCE_CATEGORIES` [objet/minerai/plante/animal/eau/aliment/consommable/arme/deco] ;
**toutes les saisies d'objet ailleurs sont des dropdowns `ResourceSelect`** groupés par catégorie —
drops des terrains, loots de monstres, matériaux de bâtiments, ingrédients + produit des recettes ;
une valeur hors catalogue s'affiche « ⚠ … (hors catalogue) » ; renommer un item ne renomme PAS ses
usages), **👹 Monstres** (PV/stats/pack min–max, **terrains d'apparition** = checkboxes de `doc.terrains`,
**attaques** avec grilles GDD, **loot de pack vaincu** en drops pondérés, apparence = asset `monsters/`),
**🌍 Génération** (Perlin paramétré : seed/échelle/octaves/persistance/hauteur max + **lissage** = écart
de hauteur max entre voisins [abaissement itératif], seuils de biomes, packs — aperçu canvas 4 vues :
Terrain/Hauteurs/Ressources/Monstres alimentées par les onglets Terrains + Monstres ; défauts = worldgen.go).
**Grilles d'attaque GDD** (`AttackDef`/`SkillDef.targets+damage`, `GridShapeEditor` 7×7) : ciblage VERT
relatif à l'attaquant ⚔️ + zone de dégâts ROUGE relative à la case touchée 🎯 (toujours incluse) — sur
les attaques des monstres ET les pouvoirs `iso` des classes ; presets mêlée/portée 3. **Migrations douces**
(`normalizeDoc`, appliquée au load ET à l'import) : ancien `special` → attaque ; ancien onglet
« resources » qui contenait les BIOMES (détecté par `searchable`) → `terrains`, et le catalogue d'items
est re-seedé (l'import JSON fait le même reroutage). Supprimer un terrain le retire des terrains
d'apparition des monstres. Fichiers : `types.ts` (schémas + **seeds = données actuelles du jeu**, miroir de
town.go/craft.go/classes.go), `store.ts` (zustand, autosave localStorage `echoterra:designer:doc`,
hook DEV `window.__dd`), `DesignerScreen.tsx` (liste + **arbre SVG** par profondeur de prérequis +
inspecteur), `designer.css`. **Export JSON** (tout ou par onglet, `echoterra-design-*.json`) →
l'utilisateur me redonne le fichier pour implémentation serveur ; import accepte doc complet ou
partiel. ♻️ Reset = re-seed depuis les valeurs du jeu.

## 7c-bis. Studio Personnages (dev tool — `frontend/src/charstudio/`, 2026-07-24)

**But** : visualiser, designer et ANIMER les personnages/monstres voxel — bouton titre « 🎭 Persos »
ou hash `#charstudio` (`appScreen === "charstudio"`, hors shell). Viewport 3D (VoxelEngine, orbite
libre, plateau d'exposition, ombres), liste Héros (7 `char-*`) / Monstres (9 `mob-*`), 🔄 turntable.
**Les animations passent par LE VRAI code du jeu** (`splitRig` → `buildRig` → `applyAnim`) : boutons
Idle / Marche / Attaque / Compétence / Touché / Mort (chorégraphie de `UnitAnimator.playDeath`
reproduite), vitesse ×0.25–×2 — ce qu'on voit est ce qui joue en partie. **Vue 🦴 Parties** : corps
gris + membres colorés par rôle/côté + billes rouges sur les pivots (contrôle visuel de la découpe du
rig). **Deux sources** : 🎮 les `.vox` du jeu (`public/voxels/chars/`) ou 🧪 la **recette live** —
`char-recipe.mjs`/`monster-recipe.mjs` vivent maintenant dans **`frontend/src/voxel/shared/`** (JS pur,
importées par le studio ET par les scripts Node) → régénération dans le navigateur, **éditer une
recette sous Vite HMR met à jour le modèle** (LA boucle de design pour Claude). Palettes éditables par
rôle (départ fidèle : `frontend/src/charstudio/palettes.json`, figé par `scripts/voxel/gen-palettes.mjs`
qui importe les samplers exportés de gen-characters/gen-monsters — leurs `main()` sont gardés par un
garde d'entrée CLI). Export ⬇ `.vox` (canal nPRT préservé pour les héros). Panneau Modèle (dims,
voxels, kind, arme, membres) + HUD. Hook DEV **`window.__cs`** `{select, play, setSource, setParts,
setSpeed, setTurntable, state, engine}` — pilotable en headless (vérif Playwright : poll par
`page.evaluate`, jamais `waitForFunction`).

## 8. Conventions & gotchas

- **CSS class collision**: do NOT use `town` as a tag/utility modifier — it collides with `.town
  { position:absolute; inset:0 }` (the Home town container) and blows the element up to fill its parent with a
  blue overlay. The tab modifier was renamed `ttown`. (This caused the "Structure is all blue" bug,
  the TopBar's town-name span — renamed `town-name` — used to cover the avatar and eat its clicks, and
  **`.mhb-badge.town`** — le badge « en ville » des pastilles de héros — héritait de `inset:0` et
  s'étalait sur TOUT le portrait qu'il recouvrait ; renommé `intown` (et `turn` en combat) le 2026-08-02.
  Trois fois le même piège : **greper `className=".*\btown\b"` avant d'ajouter un modificateur.**)
- **Les vues voxel** doivent retirer leurs écouteurs (bus / resize) au démontage — sinon une vue détruite
  continue de réagir aux événements et plante.
- **Pas de React StrictMode** (le double-invoke monterait le moteur deux fois).
- **Preview/screenshot tooling** is flaky in the headless tab (RAF pauses → screenshots time out). Verify via
  `preview_eval` + the dev hook **`window.__eg = { store, bus, EV }`** (DEV only) and `preview_snapshot`/`preview_inspect`.
- **Per-game locking**: every access to a game's state must hold its per-game mutex (`Server.lockGame`).
  HTTP requests get it automatically via `gameLockMiddleware` on the `/{gameID}` route; the wave scheduler,
  `lobbyJanitor` and `join`-by-code take it explicitly. `GameState` itself has NO internal synchronization.

## 9. Pending / next steps

1. ✅ **Water 1 ration / hero / day** — DONE. `Hero.DrewWaterDay int`; the Well `water` action draws for the
   selected in-town hero once per `game.day`, ration → that hero's bag, clears `Soif`; the Well modal shows per-hero
   daily status (disabled once that worker has drunk). Derived `town.waterDrawnToday`. Tests in `water_test.go`.
2. ✅ **Fire ball** (map skill) — DONE. `FireballHero` (2 PA) blasts a pack on the hero's tile or an adjacent
   tile; damage scales with précision/dextérité and thins `Monster.Count` (helps break Tétanisé) or destroys the
   pack. Radial-menu button 🔥; route `POST /heroes/{h}/fireball`; tests in `fireball_test.go`. (TODO: gate it to a
   Mage [MAP] class once the class-evolution system exists — currently every hero can cast it.)
3. Combat **Defend/Guard** action (3rd button on mockup page 3). (Posture défensive du Gardien = déjà un
   bouclier -50% ; un Defend générique pour tous reste à faire.)
3b. ✅ **Lobby multijoueur** (créer / rejoindre par code / attente `minPlayers` / lancement hôte,
   persisté SQLite) — DONE (2026-07-06, voir `journal.md`). ✅ Ownership serveur des héros par joueur,
   quitter/expulser un joueur, purge des salons abandonnés (même jour). ✅ 2026-07-07 : 1 joueur =
   3 héros (équipes), spawns initiaux ∝ nombre de joueurs (au lancement), verrous par partie.
   Restent : reconnexion sans localStorage, présence en ligne, hordePower ∝ joueurs.
4. **Building skills** — multiple upgradable skills per building (mockup page 6), beyond a single level.
4b. ✅ **Design JSON du Studio implémenté** (2026-07-14, `design.go`) : terrains data-driven (fouille pondérée,
   richesse), 11 espèces avec grilles d'attaque GDD en combat iso + spawn par biome + loots pondérés + boss
   vague 4+, bâtiments (matériaux par niveau, prérequis, défense/capacités par niveau, revive Townhall,
   Workshop −1 PA chantiers, puits 2j×héros), 26 recettes gatées par niveau de bâtiment, classes (requires,
   apparences, passifs récolte/vision, Tir précis, skills iso), mapgen 60×60 lissé. Restent du design :
   consommation d'objets (nourriture/potions/équipement — les effets sont du texte), Poussée du Survivant
   (pionnier), Éclairer (éclaireur iso), moral de la ville (déco), faim.
5. ✅ **Gardien** class counting as 3 in the Tétanisé calc — DONE. `gardienWeight()` in `wave.go`;
   tests `TestGardienCountsAsThreeForTetanise` / `TestNonGardienGetsStuckOnLargePack` in `evolve_test.go`.
6. ✅ Real **class-evolution** system — DONE. `classes.go`: `EvolveHero`, 6 classes (3 intermediate, 3 advanced),
   day gates (2/4). `GET /api/classes`, `POST /heroes/{h}/evolve`. Frontend: `store.classes`, `store.evolve`,
   `HeroOverlay` Evolve picker. `data/classes.ts` removed (replaced by server catalog). Tests in `evolve_test.go`.
7. ✅ Building-specific effects — Townhall revive RÉEL (action `revive`), Bank→Stock, Kitchen→Craft (gating
   par niveau), Tower evaluate.
8. **Visual theme**: move tab panels to overlays on the isometric town; real sprites (needs the AI image connector).

## 10. Memory

A condensed version lives in the user's auto-memory (`echoterra-project.md` + `MEMORY.md`). This `CLAUDE.md` is
the full reference — keep it in sync when systems change.

**`journal.md`** (racine du repo) : journal inter-sessions — chaque session de travail y ajoute une
entrée en haut (date, fait, fonctionnel/vérifié, à faire). **Le lire en début de session** pour l'état
d'avancement réel, et le mettre à jour avant de pousser.
