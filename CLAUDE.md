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
| Map gen | Perlin (`aquilax/go-perlin`) → heightmap **lissée (maxStep 1)** → biomes par niveau ; **taille suivant l'expédition** (`worldgen.SizeForPlayers` : surface par joueur constante ~900 tuiles, bornée `MinMapSize` 40 → `MaxMapSize` 140 ; 1 joueur 40², 4 joueurs 60² = `DefaultSize`, 20 joueurs 134²) ; **jusqu'à `MaxPlayersPerGame` = 20 joueurs** (60 héros) ; `ensureNearbyBiomes` garantit un **gisement** de forêt ET de montagne près de la ville (`biomeQuota` : quota ∝ surface [12 tuiles pour une carte de référence 60²] mais **RAYON FIGÉ à `nearBiomeR` 8** — le faire suivre la carte satisfaisait la garantie sur le papier en étalant le gisement jusqu'à 18 cases du bourg, hors de portée d'un héros à 6 PA/vague : mesuré sur une expédition de vingt, ZÉRO forêt découverte pendant trois vagues et bois en Banque nul toute la partie, donc aucune tour ni aucun site ; la portée d'un héros est FIXE, c'est le monde qui grandit — même erreur et même correctif que `hordeFrontRadius` — un quota ABSOLU faisait partager la carrière d'un solo à vingt équipes, d'où l'effondrement des grandes parties — l'ancienne garantie « au moins UNE tuile » laissait des cartes à 21 montagnes sur 3600, donc sans pierre exploitable) |

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
`go -C backend run ./cmd/balance` (**simule des parties entières** et dit si le jeu est jouable — voir §5
« Équilibrage ») ·
`npm run test:perf` (in frontend — budgets de chargement de l'onglet Map, voir §7; réutilise les dev
servers s'ils tournent, sinon les démarre; Chromium requis: `PERF_BROWSER` ou Chrome installé) ·
`npm run test:map-tap` (in frontend — **le picking de la carte** : taper un héros ouvre son menu et ne
le déplace jamais, taper le sol déplace toujours; mêmes prérequis que `test:perf`) ·
`npm run test:combat-ui` (in frontend — **la barre d'action du combat** : ses trois rangs, les DEUX
JAUGES du tour et les recharges, l'arme au poing, un bouton par compétence servie, les raccourcis
clavier; mêmes prérequis) ·
`npm run test:reconnect` (in frontend — **la reprise après une absence** : le rattrapage ne se joue pas
sous les yeux du joueur (une seule cinématique, pas une toutes les 20 s) et une ville tombée rend la
main au menu; mêmes prérequis) ·
`npm run test:endgame` (in frontend — **le récit de fin de partie** : le registre de contribution dans
l'ordre d'arrivée, la promesse du mémorial, et une relance qui ne repasse PAS par la partie legacy;
mêmes prérequis) ·
`npm run test:fog` (in frontend — **le brouillard de guerre** : les trois états dans le
payload, une case quittée qui redevient un SOUVENIR assombri sans être oubliée, et le
voile réellement POSÉ dans la scène; mêmes prérequis) ·
`npm run test:weather` (in frontend — **la météo des thèmes** : neige + pont de nuages au nord portés
par le MÊME vent, vire-vents qui roulent VRAIMENT à l'écran au sud, rien du tout en tempéré, et
« Aucun » qui SUPPRIME la couche au lieu de la figer; mêmes prérequis) ·
`npm run test:inventory` (in frontend — **l'inventaire** : aucun nom d'objet tronqué sur un écran de
390 px, et la FICHE d'objet — ce qu'il fait, « Utiliser », « Équiper », jusqu'à l'état serveur pour
la ration puisée au puits; mêmes prérequis) ·
`npm run test:structures` (in frontend — **l'onglet Bâtir** : aucun bâtiment dont le plan n'est pas
en Banque, le plan trouvé qui fait apparaître SON chantier, et le doseur de PA jusqu'au `points`
envoyé au serveur; mêmes prérequis) ·
`npm run test:wave-chip` (in frontend — **la pastille de vague** : elle MESURE le contraste sur les
pixels peints (capture → canvas → percentiles de luminance), dans les deux états, et vérifie que la
TopBar tient à 390 px avec le badge le plus large; **aucun serveur de dev requis**, c'est du CSS pur
sur du balisage statique) ·
`npm run test:mythic` (in frontend — **la faveur des dieux** : la barre du haut tient sur UNE rangée
à 390 px compteur compris, les trois dieux du panthéon lisibles sans troncature, et le vote qui part
vraiment au serveur; mêmes prérequis) ·
`npm run test:camera` (in frontend — **les bornes de la caméra** : le bourg reste à l'écran après un
pan à fond, la cible ne quitte ni le tertre ni le damier, et un TÉMOIN sans bornes qui perd le bourg
prouve que le test mord; mêmes prérequis) ·
`npm run test:proportions` (in frontend — **L'AUDIT DES PROPORTIONS** : la taille RÉELLE de chaque
asset dans la scène rendue, en tuiles, comparée au repère HÉROS ; écrit
`asset-index/PROPORTIONS.md` et liste ce qui sort de la fourchette attendue — voir §7a-bis « UNE
TAILLE SE MESURE »; mêmes prérequis).

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
Quatre appelants, même horloge : `POST /api/tick` (**le battement**, budget `TickBudget`), toute
requête touchant une partie (`tick()`, budget `RequestBudget`, plus petit — un joueur attend),
`POST /{id}/catchup` (**le rattrapage demandé** par un joueur qui revient, budget `CatchUpBudget`,
réponse = un RÉSUMÉ de quelques octets et non l'état complet) et le `waveScheduler` résident en dev.
⚠ **UN BUDGET S'EXPRIME EN VAGUES, c'est-à-dire en TEMPS DE MONDE** : `SimBudget.resolve` déduit les
deux autres compteurs (rounds de bots, fouilles) de ce nombre, parce que les trois horloges n'avancent
PAS à la même cadence et que la plus fine ÉTRANGLE les deux autres si on la fixe à la main — mesuré,
`{Waves: 24, BotRounds: 30}` n'avançait pas de 24 vagues mais de trente MINUTES (trois vagues à 10 min
de vague), donc le battement perdait une demi-heure de monde à chaque passage, indéfiniment, jusqu'à ce
que le plafond de 12 h absorbe la dérive en SAUTANT des vagues : le joueur revenait toujours dans une
ville en retard. Coût mesuré une fois corrigé : 12 ms pour une requête de jeu, 53 ms pour un battement
(8 joueurs, 13 h de retard). Un appelant peut toujours imposer ses compteurs (la simulation
d'équilibrage le fait). Le battement est appelé par **GitHub Actions** (`*/15` dans
`.github/workflows/heartbeat.yml`, gratuit sur repo public ; 15 et pas 5 min à cause du quota compute
de Neon, cf. DEPLOY.md) — ⚠ **mais GitHub ne livre PAS un cron `*/15` toutes les 15 min** : mesuré sur
30 exécutions consécutives, les écarts réels vont de **38 à 124 min** (médiane ~55), le cron des repos
publics étant best-effort. Tout ce qui dépend de la cadence du battement doit donc supporter une heure
de retard — d'où le budget en temps de monde ci-dessus. Plus un **cron Vercel quotidien** en filet
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
    weapons.go                  ARCHÉTYPES d'arme + leurs TECHNIQUES de combat, SwapWeapon (action `swap`)
    monsters.go                 NewMonster, MonsterSpecies
    townnames.go                NewTownName: noms de ville générés (Town.Name, posé au worldgen)
    theme.go                    LES EXPÉDITIONS THÉMATIQUES: ThemeDef/Themes/PickTheme (tiré de la
                                graine), biome dominant, libellés de terrain, peau des ruines
    mythic.go                   LA FAVEUR DES DIEUX: Pantheon/God (grec/nordique/égyptien),
                                Town.Favor, VoteBlessing, resolveBlessingVote, expireBlessings,
                                les trois domaines (rempart/moisson/lame)
    *_test.go                   worldgen, combat, tetanise, build (TestBuildConsumesBankMaterials), evolve
  internal/balance/balance.go   SIMULATION DE PARTIE headless (Run/Report/Table) — l'instrument
                                d'équilibrage ; balance_test.go = garde-fou SurvivalFloor
  cmd/balance/main.go           CLI d'exploration : tables vague par vague, balayage 1→6 joueurs
  internal/store/activity.go    L'ACTIVITÉ: une ligne par (compte, partie, JOUR) — la donnée d'où
                                sortent les chiffres de rétention (voir api/metrics.go)
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
                                CombatControls (LA barre d'action du combat : qui joue / quoi faire / sur qui),
                                TownJournal, TownChat (messagerie, cf. §5),
                                TownLedger (LE registre de contribution : la feuille de ville ET
                                le récit de fin de partie lisent le même composant),
                                TemplePanel (LE TEMPLE : compteur de faveur, bénédictions en
                                cours, scrutin — cf. §5)
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
  Plus la FAVEUR DES DIEUX (`mythic.go`) : `favor`, `blessings[{godId,name,icon,domain,untilWave}]`,
  `votes{playerId->godId}` (persistés) et les dérivés `favorGoal`/`blessingSlots` posés par `Recompute`.
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
  x,y,hp,maxHp,stats,states[],move,moved,acted,cooldowns{},initiative` (`moved`/`acted` = les deux
  budgets du tour ; `cooldowns` = capacité -> tours restants avant de la rejouer).
- **Recipe**: `id, name, category(conso|potion|forge|deco), building(kitchen|workshop), buildingLevel,
  outputType, outputName?, outputQty?(Planche/Brique ×2), field(bool=craftable outside town), paCost,
  ingredients[Item], effects, favor?` — **29 recettes** (transformations, armes/équipements mythiques,
  cuisine, alchimie, et **5 OFFRANDES** qui versent de la faveur, cf. `mythic.go` — `favor` n'existe
  que sur la catégorie `deco`, garde-fou `TestEveryDecoRecipePaysFavor`).
  En ville le bâtiment doit être CONSTRUIT au niveau requis (Kitchen niv.2 = plats raffinés,
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
  `current.skills[{idx, skill, targets, estimates, selfCast, cooldown, cooldownLeft}]` plus les deux
  budgets du tour (`current.moved` / `current.acted`) ; l'action combat porte `skillIdx`.

`Recompute()` (called in `persist()` and on load `tick()`) refreshes derived fields: `town.defense`,
per-building `defense`, per-building `cost`, `bank.capacity = sum(storage qty)`, and hero `Tétanisé`.

## 5. Game systems

**Lobby / multijoueur** (`lobby.go`, `LobbyScreen.tsx`) — deux visibilités (`GameState.Visibility`,
"" = private legacy) : **privée** = créée par un joueur, join par CODE, lancée par l'HÔTE, kick = hôte ;
**publique** = créée automatiquement par le serveur ("Expédition de <Ville>", `ensurePublicLobby` au boot
+ janitor + après chaque auto-start → il y a toujours un salon public ouvert), listée sans joinCode,
**démarre seule dès `minPlayers` atteint** (`MaybeAutoStart`) puis **reste OUVERTE** pendant sa
**fenêtre d'accueil** — `game.PublicJoinGraceWaves` = 4 vagues, comptées en VAGUES et non en heures
parce que `WaveInterval` vaut 10 min en dev et 6 h en cible (2 vagues/jour réel), donc « 2 jours » n'est
portable qu'ainsi. `GameState.JoinOpen()` est l'unique juge (« peut-on encore embarquer ? ») : salon
toujours, publique lancée pendant la fenêtre, **privée jamais après son lancement**. Un joueur qui
rejoint en cours de partie voit ses 3 héros naître en ville et **le puits complété**
(`WellRationsPerHero × 3` — sinon il boirait la réserve des autres). Le serveur maintient **UN SEUL**
point d'accueil public à la fois (`joinablePublicCount`) : ouvrir un salon neuf pendant qu'une
expédition accueille séparerait les joueurs, ce que la fenêtre veut justement éviter ; le salon suivant
naît quand les portes se ferment. start manuel/bots/pouvoirs d'hôte
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
pas encore de craft [aucune mécanique de consommation d'objets]). **Refonte 2026-08-09, guidée par la
simulation** (§ Équilibrage) : **rôles** (`heroIsBuilder`, 1 héros sur 3 reste en ville — sans ça les
réparations, toujours disponibles après une vague, absorbaient l'action de TOUT le monde et personne
n'atteignait le code qui rouvre la porte) ; **couvre-feu** en deux temps (`curfewPhase` : on rentre à
la moitié de l'intervalle, on VERROUILLE au dernier sixième) et **politique de porte** collective
(`botGateWork` : ouverte le jour, fermée au crépuscule — l'attendre pour tout le monde revient à ne
jamais fermer) ; **réserve de dissimulation** (le dernier PA d'un héros dehors ne sert QU'à se cacher :
sans elle tous les récolteurs mouraient avant la vague 9) ; **campement** (on ne rentre que pour un
sac plein [`heroLoad`, en OBJETS et non en piles] ou une blessure — la fouille auto récolte toute
seule) ; **Escape quand Tétanisé** (seule issue : un tétanisé ne peut ni bouger ni fouiller ni se
cacher) ; **liste de courses** (`botShoppingList`/`botCriticalList` : on récolte ce qui MANQUE, pondéré
par la rareté, et on explore quand aucune tuile connue ne fournit un matériau) ; **priorité défense**
(`reservedForDefense` : la pierre des murs n'est pas dépensée en rapiéçage de PV ni en chantiers
annexes) ; **CRAFT** (`botCraft` : les niveaux 2-3 du design réclament TOUS un matériau crafté —
Planche/Corde/Brique/Acier — donc une ville qui ne va jamais à l'atelier reste bloquée à sa défense de
départ ; recycle aussi les Débris en Bois/Pierre dès que la Recyclerie est debout, la réponse du design
à une carte qui se vide) ; **débloquer la FORGE** (`botCraftUnlockNeeded` : les
bots n'amélioraient que muraille/portail/tour, or le niveau 3 du portail réclame de l'ACIER, l'acier
un Atelier niveau 2, et l'Atelier n'était sur la liste de personne — mesuré, portail plafonné au
niveau 2 sur CHAQUE partie simulée ; un bâtiment qui garde un matériau de défense EST un bâtiment de
défense, à un cran de distance). ⚠ **trois RÔLES par équipe**, par rang (`heroRole`) : bâtisseur (reste en ville), **défenseur** (dégage l'anneau d'assaut — c'est de la défense depuis que `hordePower` en dépend — avec une LAISSE `botDefenderLeash` 10, sans quoi les défenseurs d'une carte 120² partent au bout du monde) et récolteur. Le rang, PAS un hash d'id : « environ un sur trois » ne garantit rien pour UNE équipe, et un bot dont
les trois héros tombaient récolteurs ne construisait jamais rien. **Combat** : `botShouldEngage` juge sur
la PUISSANCE et non l'effectif (un combat n'oppose jamais plus de 4 unités quelle que soit la taille du
pack, et la victoire supprime le pack ENTIER — exiger un héros par unité revenait à ne jamais combattre) ;
`botRallyTile` envoie un renfort à un camarade Tétanisé (la façon documentée de le libérer) et un pinné
TIENT quand l'aide est à un pas. **Tuer compte désormais** : `hordePower` inclut les créatures massées dans
l'anneau, donc dégager les abords retire directement des dégâts (règle changée le 2026-08-09 à la
demande de l'utilisateur — auparavant le combat ne servait qu'au butin). ⚠ la récolte reste
prioritaire sur le sauvetage pour un RÉCOLTEUR : mesuré, inverser les deux fait BAISSER la survie
(les matériaux font vivre la ville). **PROSPECTION** (2026-08-10) : l'exploration n'était qu'un REPLI (on ne poussait le brouillard que si
plus aucune case connue ne fournissait ce qu'on cherchait — presque jamais vrai). Mesuré : **0,9 %**
d'une carte de vingt joueurs explorée en vingt vagues, et les bots faisaient la NAVETTE (2491
déplacements pour 572 cases révélées). `botProspecting` : un RÉCOLTEUR, pendant les
`botProspectWaves` (6) premières vagues, et seulement si la Banque ne tient rien à zéro, vise la
lisière du brouillard et **ne campe pas** (fouiller arme la récolte auto et fixe le héros). Résultat
2,5 %, ×2,3, à survie égale. ⚠ mesuré et REJETÉ : viser la lisière la plus ÉLOIGNÉE de la ville au
lieu de la plus proche fait TOMBER l'exploration à 1,7 % et coûte deux vagues de survie — les héros
courent après des cases inatteignables à 6 PA. **RUINES** (2026-08-10) : un bot déblaie et fouille la ruine de sa case (`botWorkRuin`), et un
récolteur s'y rend (`botRuinTarget`, portée `botRuinReach` 12) — une ruine déjà déblayée vaut toujours
le détour, une ruine ensevelie seulement si la Banque ne tient plus rien à zéro. Sans ça les cinq
bâtiments de spécialité étaient INVISIBLES à l'IA (leurs plans ne tombent que des ruines). ⚠ mesuré :
les bots ne travaillent que 0 à 1 ruine sur quatre, non par manque de volonté mais parce qu'ils en
DÉCOUVRENT peu — le brouillard ne se lève que d'une case autour d'un héros. Débloquer les spécialités
reste donc largement l'affaire d'un joueur humain. Tout est persisté en SQLite (le salon survit à un redémarrage ; les
salons ouverts se listent via `GET /api/games?status=lobby`). ⚠ **la recherche de partie REJOIGNABLE passe par `store.OpenForJoin(n)`**
(colonne miroir `join_open`, alimentée par `JoinOpen()`) et toute recherche de salon par
`store.ListByStatus(StatusLobby, n)` — **JAMAIS par `List(n)` + filtre en Go** : un salon est écrit une
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

**L'ESCORTE DE DÉPART** (`lobby.go` `MaybeStartWithEscort`, 2026-08-12) — R4 de
`RETENTION-PLAN.md` : le premier contact avec le jeu pouvait être une SALLE D'ATTENTE. Le serveur ne
tient qu'UN point d'accueil public (règle voulue) et ce salon ne partait qu'à `MinPlayers` : sur une
population faible, un nouveau venu attendait un deuxième humain qui n'arrivera peut-être jamais. Au
bout de `PublicEscortWait` (90 s), l'expédition part avec une **escorte de joueurs-IA** — et reste
OUVERTE pendant sa fenêtre d'accueil, donc les humains suivants trouvent une ville qui VIT au lieu
d'un salon vide. ⚠ **trois bornes** : jamais sans un humain (sinon le battement fabriquerait des
expéditions fantômes en boucle), jusqu'au MINIMUM seulement (les places restent pour des gens), et on
attend vraiment (deux humains à une minute d'intervalle partent ENSEMBLE). ⚠ **appelé depuis `tick()`,
donc à CHAQUE accès à la partie** : le joueur qui patiente sonde son salon toutes les 3 s, donc c'est
son attente elle-même qui déclenche son départ — accroché au seul `housekeeping()`, le départ
dépendait du mode (stateless) et du janitor résident, qui ne passe que toutes les DIX MINUTES (mesuré :
jamais parti, quatre minutes après l'heure). `ClientView` pose `escortAt` (dérivé, jamais persisté)
pour que l'écran d'attente affiche le compte à rebours. ⚠ **`AddBot` refuse toujours** les parties
publiques : l'escorte est une décision du SERVEUR, pas un moyen pour un joueur de bourrer un salon.
⚠ **une expédition menée par UN humain et des robots est classée SOLO** (`LeaderboardMode`, règle
changée le même jour) — et redevient publique dès qu'un deuxième humain embarque, le mode étant
recalculé à chaque écriture. Tests : `escort_test.go`.

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

**Saisons du classement** (`game/season.go`, colonne `leaderboard.season`, `GET /api/seasons`,
2026-08-09) — P8 de `RETENTION-PLAN.md`. **Une saison = un MOIS civil** (identifiant `2026-08`, qui
se trie chronologiquement en tant que chaîne — d'où l'`ORDER BY season DESC` sans conversion). ⚠ **une
partie appartient à la saison de son LANCEMENT** (`GameState.Season()` lit `StartedAt`, repli sur
`CreatedAt`) : une expédition dure une dizaine de jours réels, la faire changer de saison en route la
ferait disparaître du tableau qu'elle dispute au moment où elle y monte — et `StartedAt` ne bougeant
plus, chaque réécriture de la ligne recalcule la MÊME saison. `GET /api/leaderboard?season=` rend la
**saison en cours par défaut**, `all` tous les temps, un identifiant une saison passée (elles restent
consultables : une remise à zéro qui effacerait le passé serait une punition). `GET /api/seasons` rend
les saisons réellement jouées + celle en cours même vierge. Les lignes d'avant la colonne portent `''`
et ne figurent que dans « tous les temps ». ⚠ **rien ne traverse une saison** (même règle que les
mémoriaux et les titres) et la chronique de compte, elle, ne se réinitialise JAMAIS. Tests :
`game/season_test.go`, `store` (`TestLeaderboardFiltersBySeason`), `api/season_test.go`.

**Chronique de compte & titres** (`store/chronicle.go`, `api/chronicle.go`,
`components/ChronicleCard.tsx`, 2026-08-09) — ce qu'un compte garde des villes qu'il a vues tomber
(P7 de `RETENTION-PLAN.md`). Table `chronicle`, **une ligne par (compte, partie)**, upsertée avec la
ligne de classement — donc aussi par `SaveIfUnchanged`, sinon une ville qui ne survit que par le
BATTEMENT n'entrerait dans la chronique de personne — et qui **survit à la suppression de la
partie** (c'est quand la ville n'est plus là qu'on veut s'en souvenir). Anonymes (`Player.UserID`
vide) et joueurs-IA exclus. On y garde la ville, le mode, la vague atteinte et les six colonnes du
registre de contribution. **Titres DÉRIVÉS à la lecture** (`titleDefs`, 12 paliers sur 6 domaines,
deux par domaine) : rien de plus à stocker, et changer un seuil corrige rétroactivement tout le
monde. `GET /api/auth/me/chronicle` (Bearer) → `{runs, totals, titles}`, **réservé au titulaire** :
pas de chronique publique — exposer celle des autres transformerait un souvenir en palmarès.
⚠ **COSMÉTIQUE, JAMAIS DE LA PUISSANCE** (même règle que les mémoriaux) : aucun titre n'accorde de
PA, de défense ni d'objet — un vétéran et un débutant rejoignent une ville strictement égaux, et
c'est cette égalité qui fait tenir une survie de groupe. Tests : `store/chronicle_test.go`
(dont la survie à la purge), `api/chronicle_test.go` (dont `TestATitleCarriesNoPower`).

**LES CHIFFRES — rétention J1/J3/J7** (`store/activity.go` + `api/metrics.go`, 2026-08-12) — R3 de
`RETENTION-PLAN.md` : « tant que la rétention J3/J7 n'est pas suivie, tout le reste est une opinion ».
Neuf propositions avaient été livrées sans qu'aucune soit confrontée à une mesure. La donnée est
MINIMALE : une ligne par **(compte, partie, jour civil UTC)** avec un compteur, écrite par un
middleware sur les seules requêtes **POST** d'une partie — ⚠ pas sur les GET, sinon le sondage de 20 s
du client ferait passer une page laissée ouverte pour un joueur actif. ⚠ **rien sur les anonymes** :
la rétention se mesure sur des COMPTES (un joueur sans compte n'a pas d'identité qui traverse les
parties), donc le chiffre sous-estime l'activité réelle et le dit lui-même dans son champ `scope`.
⚠ **l'agrégation se fait en GO**, pas en SQL : l'arithmétique de dates ne s'écrit pas pareil en SQLite
et en Postgres, les deux moteurs que ce store sert. `computeMetrics` est PURE (elle prend `today` en
paramètre) — c'est ce qui la rend testable, même raison que `GameState.clock()`. ⚠ une cohorte porte
un drapeau **`mature`** par échéance : sans lui, une cohorte d'hier afficherait 0 % à J7 et tirerait
la moyenne vers le bas — le zéro d'une chose qui n'a pas encore eu lieu. « Revenu » veut dire au moins
une fois **entre J+1 et J+k**, pas pile ce jour-là. Tests : `store/activity_test.go`,
`api/metrics_test.go` (dont un test de bout en bout qui joue une vraie action et va lire la base).

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
`resources: 0` pour que les bots/UI ne la ciblent pas). Une case **ÉPUISÉE** (`resources` à 0) reste
FOUILLABLE : `depletedFindPct` 25 % de vraie ressource, sinon des Débris (que la Recyclerie transforme).
⚠ le client désactivait le bouton dès `resources <= 0`, rendant ce mode inatteignable — corrigé 2026-08-02,
ne pas réintroduire cette garde. Le tirage est partagé par `searchLoot` (fouille manuelle ET automatique).

**Fouille AUTOMATIQUE** (`forage.go`, 2026-08-02) — le PA de la fouille n'achète plus une trouvaille mais
une INSTALLATION : `SearchTile` pose `Hero.ForageAt`, et le héros continue de fouiller sa case **tout seul,
sans PA**, tant qu'il ne bouge pas. C'est ce qui donne un intérêt à POSTER un héros sur un jeu joué en
plusieurs jours réels. `ForageInterval() = WaveInterval / 6` — exprimé en fraction de vague et pas en
minutes fixes, sinon les 6 h de vague du déploiement donneraient 72 trouvailles entre deux vagues ; un
sixième donne SIX récoltes par période, exactement les 6 PA d'un héros. **C'est une TROISIÈME horloge de
`AdvanceTo`** (sim.go), entrelacée chronologiquement avec les vagues et les rounds de bots — sans quoi elle
ne tournerait pas sans joueur connecté ; bornée par `SimBudget.Forages` et par `trimBacklog` (une partie
oubliée trois jours ne doit pas déverser des milliers d'objets). Interrompue par : bouger, s'échapper, se
cacher, entrer en combat, être Tétanisé, tomber (`StopForaging` + `canForage`, vérifié paresseusement par
`nextForage`). Pas de plafond de sac : ce qui borne le camping, c'est que la case s'épuise (~75 % de Débris
ensuite), que le héros posté hors des murs se fait frapper à chaque vague, et que recycler coûte 1 PA.
Front : le bouton devient « 🔄 Fouille auto » avec compte à rebours (`useForageRemaining`), plus un rappel
dans `MapHeroBar`. Tests `forage_test.go`.

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

**LES STATISTIQUES ET CE QU'ELLES FONT** (`combat.go` + `climb.go`, audit 2026-08-16) — **Force**
dégâts par défaut · **Dextérité** dégâts des tirs et des capacités à distance · **Agilité** LA PORTÉE
DE DÉPLACEMENT (`Move = 2+agi/3`) et `Initiative = agi*10+rand` · **Endurance** `−end/2` aux dégâts
subis ET les PV (`8+end*2` à la création, `+2` par point gagné à l'ÉVOLUTION — `EvolveHero` ne les
recalculait pas, un gardien à 7 d'endurance gardait les 16 PV de ses 4 points de départ) ·
**Précision** la chance de COUP CRITIQUE (`critPct` : ×1,5 dégâts, 3 %/point, plafond 40 %) ·
**Perception** JUSQU'OÙ ON VOIT — rayon de brouillard levé sur la CARTE (`sightRadius` :
`1 + perception/4`) ET portée d'œil en COMBAT (`sight` : `3 + perception/3`) ·
**Athlétisme** LA HAUTEUR FRANCHISSABLE, en combat ET sur la carte (`climbFrom` : `plancher +
athlétisme/5`, plancher **2** en arène et **1** sur la carte — voir « LE RELIEF ARRÊTE »). ⚠ **les deux dernières ne
faisaient RIEN** avant cet audit : Athlétisme n'était lu par aucune ligne de code, Précision ne portait
les dégâts que de DEUX capacités sur tout le jeu — alors que `classes.go` donne `Athletisme: 5` comme
bonus PRINCIPAL à trois classes sur six (éclaireur, récupérateur, herboriste), qui échangeaient donc
leur évolution contre cinq points de rien. ⚠ **la PERCEPTION est une 7ᵉ statistique ajoutée le 2026-08-16**, après un premier jet
qui chargeait la vision sur la Précision : les cinq autres paires racontent chacune UNE
idée vue sous deux angles (Endurance = encaisser : PV + réduction ; Agilité = vitesse :
déplacement + initiative), alors que « frapper juste » et « savoir ce qu'il y a là » sont
deux idées différentes. Elle ne fait qu'une chose, mais sur les DEUX surfaces du jeu — et
elle a un PROPRIÉTAIRE : l'Éclaireur (Perception 5), qui n'avait aucune identité chiffrée
(voir « LES SIX PROFILS »). Elle a aussi supprimé le `if h.ClassID == "eclaireur"` codé en
dur dans `fog.go` : la vision d'une classe est devenue un profil et non une exception du
moteur. ⚠ le rayon de carte est la valeur la PLUS dangereuse du jeu à toucher (à rayon 0,
mesuré : 2 tuiles de montagne en 12 vagues = défaite arithmétique), d'où le `/4` serré.
⚠ **pas de jet de toucher, et il ne faut pas en ajouter** :
rater son tour dans un jeu qu'on joue deux fois par jour est une punition, pas une tension — d'où le
critique, qui est une pointe de dégâts ANNONCÉE (`CritChance` → `critPct`/`critMax` servis à côté de la
fourchette, jamais fondus dedans). ⚠ l'agilité reste en ESCALIER (`/3`) : une Cape de plumes (+2) ne
change le déplacement que si elle fait franchir un multiple de 3. La fiche de personnage
(`HeroOverlay`) RÉPÈTE ces phrases sous chaque attribut — pas dans un `title`, il n'y a pas de survol
sur un téléphone. Tests : `turneconomy_test.go`.

**LE RELIEF ARRÊTE — escarpements de carte** (`game/climb.go` + `worldgen/escarpments.go`,
2026-08-16) — `Tile.Height` était commenté « cosmetic » et l'était : `MoveHero` acceptait n'importe
quel pas orthogonal quelle que soit la dénivellation, et la carte ne POUVAIT pas porter de falaise
(`smoothLevels`, genMaxStep 1, garantit des marches ≤ 1). Désormais une marche > `HeroClimb(h)` est
REFUSÉE — sur la carte comme dans l'arène, avec la même statistique et le même diviseur.
- **Le franchissement** : `climbFrom(athlétisme, plancher)` = `plancher + ath/5`. Plancher **2** en
  arène (la valeur qui y était codée en dur : personne ne perd de terrain jouable, et être bloqué
  dans un espace clos de 7×7 serait une punition arbitraire) et **1** sur la carte (le monde a des
  détours par construction). Calibré sur les valeurs réelles : les quatre blocs de départ donnent
  2·3·3·4 d'athlétisme, donc **aucun héros neuf ne grimpe** ; éclaireur/récupérateur/herboriste
  (+5) passent à 7-9, et les **Bottes cloutées** (+3) suffisent à n'importe qui.
- ⚠ **SYMÉTRIQUE** (valeur absolue) : une descente vertigineuse arrête autant qu'une montée — une
  règle asymétrique produirait « j'y suis allé et je ne peux plus revenir ». ⚠ **le BROUILLARD ne
  bloque jamais** (`ClientView` sert une tuile vierge, hauteur 0 : refuser sur une hauteur que le
  joueur n'a pas vue transformerait l'exploration au contact en tirage au sort). ⚠ un refus de
  relief **ne coûte pas de PA**. ⚠ **`Hero.Climb` est un champ DÉRIVÉ** refait par `Recompute` et
  servi au client : les bonus d'équipement ne sont pas dans `Stats`, donc un miroir client-side
  divergerait au premier objet ajouté.
- ⚠ **LA HORDE IGNORE LE RELIEF** (`migrateMonstersTowardTown` ne regarde que la praticabilité) et
  ça doit le rester : gater la migration ferait dépendre la difficulté du tirage du terrain, alors
  que la courbe de survie est réglée à la mesure.
- **Les MESAS** (`carveEscarpments`, dernière passe de `newWorld`) : sommet plat à `base+2`, pied
  nivelé à `base`, donc une falaise de **2 exactement** sur tout le pourtour. Une partie reçoit des
  RAMPES (`base+1`, deux marches de 1) ; `sealedPlateauPct` 45 % n'en reçoit AUCUNE — ce sont les
  zones qui n'existent que pour qui grimpe. ⚠ **une mesa ne change AUCUN biome** (tables de fouille,
  spawns d'espèces, `ensureNearbyBiomes` et la liste de courses des bots voient la carte d'avant) et
  ⚠ **c'est une POCHE, jamais un mur** — convexe, entourée d'un anneau praticable, donc en sceller
  ne coupe jamais une région. ⚠⚠ **TROIS approches ont été mesurées et jetées avant celle-ci** (rive
  partielle, massif de biome, disques de +1) : toutes rendaient **0,0 à 1,2 %** de carte gardée, la
  dernière parce qu'un disque sur une PENTE a toujours un côté amont à fleur du terrain. Détail
  complet dans l'en-tête d'`escarpments.go` — ne pas les retenter. Mesuré aujourd'hui : **6,2 %** de
  la carte demande de grimper, **<0,01 %** est hors d'atteinte même en grimpant. Garanties testées :
  marche max 2, bois et pierre (montagne **OU NEIGE** — une carte nordique peut n'avoir aucune tuile
  de biome montagne) atteignables sans athlétisme. Tests : `worldgen/escarpments_test.go`,
  `game/climb_test.go`.

**L'ÉCONOMIE DU TOUR — un déplacement, une action, et des RECHARGES** (`combat.go`, 2026-08-16) —
« on peut se déplacer puis faire dix fois la même attaque » (retour utilisateur). Mesuré : dix attaques
d'affilée acceptées, mais aux rounds 2·3·4…11 — une action par tour ÉTAIT tenue (toute action appelait
`endTurn`), sauf que le tour ennemi se résout instantanément et que la barre n'affichait AUCUN budget,
donc taper dix fois « marchait ». **Le vrai trou est la RÉPÉTITION de la meilleure capacité** : le tour
de jeu se résumait à « quelle est la compétence la plus bonifiée ? », question dont la réponse ne
change jamais (et une Colonne de Vent qui étourdit à 100 % rejouée chaque tour n'est pas un combat,
c'est une exécution). Trois pièces :
- **`AttackDef.Cooldown` + `CombatUnit.Cooldowns`** — décrémentées au début du tour de l'UNITÉ
  (`tickCooldowns` dans `advanceTurn`), en tours et pas en rounds : sinon une unité rapide et une lente
  ne paieraient pas le même prix. Classe 2-3, technique d'arme 2, et **toute spéciale du catalogue de
  design qui n'en déclare pas hérite de `defaultSpecialCooldown` 2** (`withCooldowns`, qui COPIE —
  `Species` est un global). ⚠ **l'attaque de base ne se recharge jamais** (la recharge pousse à
  composer, elle ne prive pas d'agir) et ⚠ **l'IA joue la même règle** (`readyOnly`, `heroAutoAct`) —
  un cooldown que seul le joueur subit n'est pas une règle, c'est un handicap.
- **`CombatUnit.Acted`** — l'action ne clôt PLUS le tour d'office : tant qu'il reste le déplacement, on
  peut **frapper puis décrocher** (l'arc et la lance n'avaient aucune façon de reculer après leur coup).
  `spendBudget` ferme le tour dès que les deux budgets sont dépensés, donc « j'avance et je tape » ne
  coûte pas un clic de plus qu'avant.
- **L'interface DIT la règle** (`CombatControls`) : deux jauges 🥾/⚔️ allumées-éteintes, une phrase qui
  dit ce qui RESTE, ⏳N sur une compétence en recharge (↻N au repos), boutons d'action éteints une fois
  l'action dépensée, 🎯N % de critique sur la cible. ⚠ le raccourci clavier obéit à la recharge comme le
  bouton. Garde-fou : `npm run test:combat-ui`.

**Isometric combat** (`combat.go` / `CombatScene.ts`) — initiative by agility; each turn a unit moves once
(`moved` flag) and acts once (`acted` flag, voir l'économie du tour ci-dessus). **Les attaques sont des `AttackDef` du design** : grille de ciblage VERTE relative à
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
**LA GARNISON** (2026-08-09) — `TownDefense() = buildingsDefense() + GarrisonDefense()` : **un héros
présent dans les murs à l'heure de la vague DÉFEND** (poids 1, 2 pour une classe évoluée, 3 pour un
Gardien), exposé par `Town.Garrison`/`GarrisonValue`. ⚠ **PLAFONNÉ PAR LA PIERRE** : jamais plus que ce
que les bâtiments tiennent déjà — sans ce plafond, masser du monde en ville rendrait la construction,
donc le jeu, inutile ; et un portail OUVERT (défense 0) abaisse aussi le plafond. Pourquoi : la défense
ne dépendait que des bâtiments, plafonnés aux mêmes trois niveaux qu'on soit trois héros ou soixante,
pendant que la pression suivait l'expédition — d'où une survie NON MONOTONE (15·14·14·16·17·19 vagues
pour 1·2·4·8·12·20 joueurs : deux et quatre joueurs allaient MOINS loin qu'un solo). C'est aussi le
dilemme de Hordes sous sa forme la plus simple : rentré je défends, sorti je récolte. Tests
`garrison_test.go`. Complément : un **genou** sur `hordeScale` (`hordeKnee` 8 équipes, taux réduit
au-delà) parce que la capacité d'une ville sature là où la pression ne saturait pas.

`ProcessWave`: **`hordePower = pression(vague) + créatures massées dans le rayon d'assaut`**
(2026-08-09). Deux termes, et la distinction est tout le design : la **pression**
(`hordeBase 6 + 2*vague`, × `hordeScale`) est un plancher qui monte quoi qu'on fasse ; l'**assaut**
(`besiegingCreatures`, Chebyshev ≤ `assaultRadius` 2 autour de la ville) est la horde réellement
présente quand elle frappe — **c'est ce terme que tuer fait baisser**. Avant, la puissance était une
pure fonction du numéro de vague : nettoyer les abords ne retirait pas un point, donc le combat ne
servait qu'au butin, et une expédition de 20 ne pouvait pas dépasser un solo (le plafond de défense
20+16+12=48 est le même à 3 héros qu'à 60). ⚠ **rien n'apparaît dans l'anneau d'assaut**
(`spawnSafeRadius = assaultRadius`) : un pack qui s'y matérialise est un pack que personne n'a laissé
passer. Les packs qui ont porté l'assaut s'y **brisent** (`spendAssaultingPacks`,
`WaveReport.MonstersSpent`), le calcul se faisant AVANT leur retrait ; **defense** = sum of wall/gate/tower contributions scaled by
durability (**an open Gate = 0**, a construction site = 0); `overflow = horde - defense` → town HP loss +
random building durability damage; defensive buildings also wear. Heroes **outside** town are hit individually
(`Blessé`); **hidden** heroes skipped; **in-town** heroes safe. PA regen each wave; the **Well refills +10**;
new monsters spawn **selon les biomes d'apparition des espèces** — ⚠ les renforts de vague naissent dans un **FRONT de rayon FIXE** (`hordeFrontRadius` 14, indépendant de la taille de carte) : les packs migrent d'une case par vague, donc les tirer uniformément sur une carte de 134² faisait que la horde n'arrivait JAMAIS — mesuré, deux joueurs dans un salon prévu pour vingt tenaient 30 vagues contre 16 sur leur propre carte, le mode facile du jeu. Le semis initial (`SeedStartingMonsters`, `4 + 3×joueurs + surface/1200`) reste réparti partout : c'est du peuplement, pas de la pression, et il suit l'EXPÉDITION et non la surface. **scaling INFINI par vague (2026-07-22)** :
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
- `repair` (Wall) → **relève les PV de la VILLE** : 1 PA + 1 Pierre → +`TownRepairHP` (5) PV, borné
  aux PV manquants. Voir §5 « Réparer la VILLE » — la seule source de PV de ville du jeu.
- `revive` (Townhall) → **ressuscite le premier héros mort** : PV = max/2, replacé en ville, états purgés.
  Quota quotidien = niveau du Townhall (1/jour niv.1, 2/jour niv.2) ; **niv.3 = illimité ET gratuit** (sinon
  2 PA). Suivi `Town.ReviveDay/RevivesToday`. Bouton « 🛏️ Ressusciter <héros> » dans le modal Home.
- `water` (Well) → **FREE**, draws **one Ration d'eau per in-town hero per `game.day`**: charged to the selected
  town worker (`heroID`), decrements Well `capacity`, clears that hero's `Soif`, and drops the ration into **that
  hero's bag** (not the Bank). Tracked via `Hero.DrewWaterDay` + `DrewWaterCount` ; dérivés
  `town.waterDrawnToday` (qui a ÉPUISÉ son quota) et `town.waterAllowance` (le quota lui-même).
  ⚠ **PUISER N'EST PAS BOIRE, et l'interface ne doit jamais dire « a bu »** (rapporté en jeu 2026-08-16) :
  l'action met une ration dans le SAC ; boire est un geste séparé, sur la carte. ⚠ et le puits s'éteint sur
  `waterDrawnToday`, **jamais** sur `drewWaterDay == day` : ce champ porte le JOUR de la dernière ration et
  non le quota, donc le comparer au jour courant grisait le puits dès la PREMIÈRE ration alors qu'une Cuisine
  niveau 2 (`dailyWaterAllowance`) en autorise une seconde — l'effet payé restait inatteignable au joueur.
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

**LES NIVEAUX 2-3 NE SONT PLUS DU TEXTE** (2026-08-10) — quatre effets du catalogue de design
n'existaient que sur le papier ; le joueur payait des PA et des matériaux pour une phrase. Ils sont
branchés : **Recyclerie** (`craftYieldBonus` : +1 par palier sur ses SEULES recettes — l'étendre à
tout ferait de l'Atelier une machine à dupliquer l'Acier) · **Panneau** (`townLogCapacity` ×niveau et
`requestsCapacity` +6/niveau : à vingt joueurs le journal défile en une soirée et les demandes les
plus anciennes tombent avant d'avoir été vues) · **Poste** (`chatRemoteDepth` : depuis LE TERRAIN on
reçoit 20 messages au niv.1, 40 au niv.2, tout le fil au niv.3 ; en ville on lit tout, on est devant
le panneau) · **Cuisine niv.2** (`dailyWaterAllowance` : une SECONDE ration d'eau par héros et par
jour — l'eau rend des PA sur le terrain, donc du temps de jeu). ⚠ mesuré, les niveaux 2-3 du
catalogue courant SONT atteints (20 joueurs, 3 graines : 19 bâtiments niv.1, 3 niv.2, 9 niv.3) ; ce
sont les spécialités qui restent au niveau 1, parce qu'elles se débloquent tard. Tests :
`levels_test.go`.

**LES CINQ BÂTIMENTS DE SPÉCIALITÉ** (`design.go`, 2026-08-10) — Infirmerie, Cartographe,
Armurerie, Verger, Caserne. **Pourquoi** : une expédition de vingt construisait LES ONZE bâtiments du
catalogue (mesuré : 11 debout, 18 niveaux sur 33) — il n'y avait aucune priorité à arbitrer, juste
une liste à dérouler ; un solo, lui, n'en bâtissait aucun. Chacun ouvre un AXE que rien d'autre ne
couvre, pour que l'arbitrage porte sur des choses INCOMPARABLES et non sur « lequel donne le plus de
défense » : **Infirmerie** (action `heal`, quota/jour = niveau, gratuit au niv.3 — elle bouche un
trou : RIEN ne rendait de PV à un héros, la seule remise en état était de mourir puis d'être
ressuscité) · **Cartographe** (`fog.go` : vision de TOUS les héros +niveau, plafond +2 ; niv.3
révèle aussi les abords) · **Armurerie** (`NewCombat` : +niveau en force, prêté à l'unité et jamais
greffé sur `Hero.Stats` — le SEUL bâtiment dont l'effet sort des murs) · **Verger** (`regrowOrchard`
à chaque vague : rend une ressource aux cases les plus PAUVRES dans `orchardRadius` 4, plafonné à
`orchardCap` — réponse à l'ÉPUISEMENT DE LA CARTE, la vraie limite d'une longue partie) ·
**Caserne** (`casernePerLevel` 4 au PLAFOND de la garnison, sans un point de défense de pierre —
l'axe « tenir plus nombreux », qui profite d'autant plus que l'expédition est grande).
⚠ **TOUS À TROIS NIVEAUX** comme le reste (`MaxBuildingLevel`), et **DEUX VERROUS** les rendent
rares : un **prérequis** d'arbre techno (kitchen 1 · panel 2 · workshop 2 · well 2 · wall 2) et un
**plan qui ne tombe QUE des ruines, un par biome** — les débloquer tous demanderait de déblayer une
ruine dans CHAQUE biome. Mesuré : même en donnant les cinq plans aux bots, une ville n'en bâtit que
1 à 3, tous au niveau 1. ⚠ **`botShoppingList` ignore les sites dont le PLAN n'est pas en Banque** :
sans ça les cinq nouveaux mettaient Cuir, Herbe médicinale, Graines anciennes et Minerai d'or sur la
liste de courses de TOUTES les villes, y compris celles qui n'auraient jamais le plan. Chacun a
désormais SON modèle voxel (`gen-props.mjs`), reconnaissable à sa couleur de toit et à sa silhouette
— c'est le seul repère qui survit au dézoom : infirmerie bleu-vert + croix, cartographe indigo +
rose des vents, armurerie rouge forge + enclume, caserne longue et basse + bannière, verger =
parcelle plantée. ⚠ `buildingModelKey` (townLayout.ts) reste l'indirection : un modèle manquant fait
`if (!geom) continue`, donc un bâtiment INVISIBLE et incliquable.
Tests : `specialties_test.go`.

**LA FAVEUR DES DIEUX** (`game/mythic.go` + bâtiment `temple`, 2026-08-16) — le pilier MYTHIQUE, à
la Age of Mythology. La catégorie « déco » du craft annonçait « moral de la ville » depuis le premier
jour, et le moral n'existe nulle part dans le code : fabriquer un totem produisait un objet qui allait
dormir en Banque. Les offrandes versent désormais de la **FAVEUR** (compteur ⚡, l'icône vient du
panthéon), la ville la dépense en **BÉNÉDICTIONS** qu'elle **VOTE** au **Temple**, et le dieu élu
répond **dès la vague suivante**. **Trois panthéons, un par thème** : `PantheonOlympe` (grec — le
thème TEMPÉRÉ, donc le défaut, donc aussi celui des parties d'avant les thèmes), `PantheonAsgard`
(Thor/Loki/Odin), `PantheonDuat` (Râ/Osiris/Sekhmet).
⚠ **UN PANTHÉON EST UNE PEAU** (`TestPantheonsAreLateralNotStronger`) : les trois servent les MÊMES
trois **domaines** avec les mêmes chiffres — `rempart` (+8 de défense de ville), `moisson` (+1 à
CHAQUE trouvaille, fouille auto comprise), `lame` (+2 de force au combat iso). Un thème se TIRE ;
s'il pouvait donner de meilleurs dieux, ce serait une punition au hasard (même règle que les armes
de thème). ⚠ **LA FAVEUR SE PAIE EN MATÉRIAUX DE CONSTRUCTION** — un totem coûte 3 Bois, une stèle
3 Pierre, un brasero une Brique + du Charbon : la ferveur est en CONCURRENCE avec la muraille, les
remparts et (au nord) les foyers, jamais une ressource parallèle. ⚠ **UNE BÉNÉDICTION EXPIRE**
(`BlessingWaves` 4, la vague d'invocation comprise) : sans expiration une ville accumulerait les
boons jusqu'à devenir imprenable et le compteur n'aurait plus rien à dire passé la vague 10.
⚠ **ON VOTE** (même esprit que `VoteKick`) : `VoteBlessing(playerID, godID)` est **gratuite, sans
héros et sans PA** — la faire payer donnerait le dernier mot au joueur le plus riche — et le
**dépouillement a lieu EN HAUT de `processWave`**, avant que la horde et la défense soient chiffrées.
Aucun quorum (à moitié endormie, une expédition n'invoquerait jamais rien) ; une voix non aboutie
RESTE POSÉE pour le scrutin suivant. ⚠ **le dépouillement parcourt le panthéon DANS SON ORDRE**
(`BlessingTally`) : c'est lui qui départage les ex æquo, et itérer la map des voix aurait rendu le
vainqueur dépendant de l'ordre d'itération de Go — donc deux rejeux de la même période auraient
appelé deux dieux différents (cf. §8, « ordre d'itération = état »). ⚠ le domaine `rempart` s'ajoute
**HORS du plafond de garnison** (une faveur n'est pas de la pierre) et le domaine `lame` est **PRÊTÉ
à la `CombatUnit`**, jamais greffé sur `Hero.Stats` (même règle que l'Armurerie et l'équipement).
⚠ **LES JOUEURS-IA N'Y TOUCHENT PAS** : ils bâtissent le Temple comme n'importe quel site dont le
plan est en Banque (mesuré : sans effet sur le plancher de survie), mais ils ne fabriquent pas
d'offrandes (le bois est déjà la matière la plus disputée) et surtout **ils ne votent pas** — à vingt
robots contre un humain, leurs voix décideraient du dieu à sa place. **Le Temple** : prérequis
Atelier niv.1 (là où l'on fabrique les offrandes), **plan trouvable à la FOUILLE ORDINAIRE** (prairie
et sable, plus le sanctuaire en ruine) et non réservé aux ruines — un pilier que la moitié des
parties n'atteindrait jamais n'en serait pas un ; ses trois niveaux = le nombre de bénédictions
SIMULTANÉES (1/2/3), et son modèle voxel change avec le panthéon (`bld-temple` péristyle grec,
`bld-temple-nordique` hof à toitures étagées, `bld-temple-desertique` pylône à obélisques).
Front : chip ⚡ dans la TopBar (affiché seulement si Temple debout ou faveur > 0), `TemplePanel.tsx`,
ligne d'ordre du jour quand un scrutin peut aboutir. Tests : `game/mythic_test.go`,
`api/mythic_test.go`, `npm run test:mythic`.

**LES EXPÉDITIONS THÉMATIQUES** (`game/theme.go` + `worldgen.applyThemeBias`, 2026-08-11) — trois
NATURES de carte tirées de la graine (**Tempéré** le témoin sans biais, **Nordique**, **Désertique**),
réponse au trou R5 de `RETENTION-PLAN.md` : rien ne distinguait l'expédition n°4 de la n°1. ⚠ **un
thème est une PEAU et un BIAIS, jamais un jeu différent** : les six biomes gardent leurs identifiants
ET leur rôle économique (3 = le bois, 4 = la pierre) — `Terrains`, `Species.Biomes`, `ruinDefs`,
`ensureNearbyBiomes` et `botShoppingList` (qui cherche littéralement « Bois » et « Pierre ») sont tous
indexés dessus, donc un désert SANS forêt serait une partie sans bois, donc sans chantier. **La
palmeraie du désert EST le biome forêt.** Corollaire : **le renommage est de la PRÉSENTATION** —
`Item.Name` et `Ruin.Type` ne changent JAMAIS (recettes, bots, modèle voxel les lisent) ; seuls les
libellés bougent (`GameState.BiomeLabel`, `ThemeDef.RuinNames`). « Dominant » veut dire **autour de la
VILLE** : `applyThemeBias` convertit avec une probabilité décroissant avec la distance (portée = la
moitié de la carte), donc au loin la carte redevient elle-même — la variété devient lointaine, donc
elle se mérite. ⚠ **DEUX GARDE-FOUS** : `ensureNearbyBiomes` passe APRÈS et l'emporte (bois et pierre
à portée quel que soit le thème — sinon on rejoue la famine déjà mesurée deux fois), et **aucun biome
présent ne peut disparaître** (`SeedRuins` pose une ruine par biome et chaque ruine porte le plan
d'une spécialité). ⚠ **le plancher de survie se vérifie THÈME PAR THÈME** (`balance.Config{Theme}`,
`cmd/balance -themes`, `TestEveryThemeHoldsTheFloor`) : un thème se TIRE, personne ne le choisit, donc
un thème non simulé serait une punition au hasard. `GET /api/themes`, `themeId` dans les résumés de
salon, colonne `theme` au classement. Tests : `game/theme_test.go`, `worldgen_test.go`.

**LES MODÈLES D'UN THÈME** (`scripts/voxel/gen-props.mjs`, 2026-08-12) — le désert n'avait AUCUN
modèle à lui : sa steppe empruntait les oliviers et les arbres morts du monde tempéré. Quatre
silhouettes procédurales suffisent (`cactus` saguaro à bras, `palm` au tronc courbé et à la couronne
retombante, `bones` crâne à demi enseveli, `rune-stone` stèle gravée du nord), générées sans ComfyUI
comme le reste des props : `node scripts/voxel/gen-props.mjs cactus palm bones rune-stone` (le filtre
CLI évite de réécrire les 216 fichiers). ⚠ **LE MESHER NORMALISE SUR LA LARGEUR DE GRILLE** : un modèle
étroit dans la grille 20×20×30 reste petit à l'écran quel que soit son `scale` de scatter — un premier
cactus de 3 cellules de large se lisait comme une touffe d'herbe, il a fallu l'épaissir à 5 ET monter
son échelle de placement. ⚠⚠ **UNE TAILLE À L'ÉCRAN EST UN PRODUIT DE TROIS FACTEURS** — remplissage
du modèle dans sa grille × `scale` du scatter × coup de pouce `TREE_IDS` de VoxelMapView — et corriger
« il est trop petit » sur les trois à la fois donne un géant : le saguaro est sorti à **1,67 tuile de
haut, plus grand qu'un sapin (1,36) et aussi large**. Un prop n'a le droit qu'à UNE correction
d'échelle, et elle se VÉRIFIE en tuiles (extension du modèle ÷ `sx`, × scale × boost) et non à l'œil
sur une capture — le cactus n'est plus dans `TREE_IDS` (ce boost sert à faire dominer les ARBRES) et
tient désormais 0,97 tuile, sous le palmier (1,16). ⚠ une couronne de palmier PLATE se lit comme un champignon : c'est la
retombée quadratique des palmes et leur largeur de deux voxels près du cœur qui font le palmier.
⚠⚠ **`PROP_KEYS` (scatter.ts) EST CE QUE LA CARTE CHARGE** : un prop semé par les tables mais absent
de cette liste n'est jamais téléchargé — `propsLib.get` rend `undefined`, la pose fait `continue`, et
le décor est **silencieusement absent** (aucune erreur, aucun trou : on croit que le tirage n'est pas
tombé). Y ajouter tout nouveau prop, et le vérifier en comptant les `.vox` réellement téléchargés
plutôt qu'à l'œil sur une capture — `brambles`, semé depuis le lot D2, n'avait jamais poussé nulle
part pour cette raison.

**LES ARMES D'UN THÈME** (`equipment.go` + `craft.go`, 2026-08-12) — ⚠ **UN THÈME DONNE UN AUTRE
CHEMIN VERS UNE PUISSANCE QUI EXISTE DÉJÀ, JAMAIS UNE PUISSANCE DE PLUS** (test
`TestThemeWeaponsAreLateralNotStronger` : aucune arme de thème ne dépasse la meilleure arme ordinaire
de son archétype). Le **Khopesh de verre** (désert, épée) vaut exactement la Lame de fer mais se forge
avec le verre des dunes quand le fer manque ; le **Harpon de givre** (nord, lance) vaut une Lance de
sanglier à un point de force près, et surtout il se forge avec du givre au lieu d'exiger la défense
d'un BOSS. Ce qu'un thème change, c'est l'ACCÈS, pas le plafond. ⚠ **aucun `if theme ==` dans le
craft** : c'est le MATÉRIAU qui gate — le « Verre du désert » (fulgurite) ne tombe que sur le sable
d'une carte désertique (`ThemeDef.ExtraDrops`), le Givre éternel demande de la neige. Gater par la
matière garde le catalogue lisible et n'invente aucune règle.

**LES MODÈLES PROPRES À UN THÈME** (`voxel/themeModels.ts`, 2026-08-12) — un thème peut donner sa
silhouette à un bâtiment ou à une ruine : la **halle sommitale** du bourg (toit-terrasse à parapet en
désert, là où il ne pleut jamais ; chaume sombre coiffé de neige au nord — la recette `bldTownhall`
est PARAMÉTRÉE par une peau, on n'écrit pas deux bâtiments de plus) et le **donjon de sable**
(`sitePyramide`, `siteDrakkar` — ⚠ même `Ruin.Type` serveur que l'épave, donc même table de butin et
même plan de spécialité : un thème rhabille, il ne redistribue pas). ⚠ **le TEMPLE est le seul cas où
la forme porte une RÈGLE** et non une matière (péristyle grec / hof nordique / pylône égyptien = quels
dieux figurent au scrutin) : d'où trois recettes distinctes dans `gen-props.mjs`, là où la halle
sommitale n'est qu'une recette à peaux. La clé devient
`<base>-<theme>`. ⚠ **LE REGISTRE EST EXPLICITE** (`themedKey`/`themedKeysFor`) : les modèles sont
PRÉCHARGÉS par liste, donc demander une clé sans fichier ne produit ni erreur ni repli — `get` rend
`undefined`, la pose fait `continue`, et le bâtiment est silencieusement INVISIBLE. On ne dérive donc
jamais la clé à l'aveugle. La carte charge ces modèles PARESSEUSEMENT au premier dessin d'une partie
(le constructeur ne connaît pas encore le thème, et une carte tempérée ne doit pas télécharger un
octet de plus). ⚠ **`VoxelTownView` porte une `key` par partie** (HomeTab) : sa scène est montée une
seule fois (`useEffect(..., [])`) et son terrain lit le thème AU MONTAGE — sans cette clé, reprendre
une autre expédition sans recharger la page garde la palette de la précédente (mesuré : un bourg
nordique rendu en ocre désertique).

**LA PEAU D'UN THÈME** (`voxel/smoothTerrain.ts` `THEME_PALETTES` + `voxel/scatter.ts`, 2026-08-11) —
le biais de biomes change ce qui pousse autour de la ville ; la **palette de terrain** change l'humeur
de TOUTE la carte, y compris des biomes que le thème n'a pas déplacés — sans elle, une carte nordique
n'est qu'une carte ordinaire avec des taches blanches (mesuré à l'œil, c'est exactement ce qu'elle
donnait). `setTerrainTheme(themeId)` est posé AVANT chaque construction de terrain (carte ET ville) :
un module-level plutôt qu'un paramètre traversant, parce que les trois vues bâtissent leur terrain à
des moments différents. ⚠ **on ne remplace que les tons qu'un thème a une raison de changer** — ce qui
n'est pas listé garde la palette de référence, donc un thème ne peut pas rendre la carte illisible par
omission. ⚠ **les codes 6..9 sont les SOLS DE VILLE** (`SOIL` dans townLayout.ts) : les rhabiller fait
prendre au tertre l'air du pays **sans toucher à un seul modèle de bâtiment** — c'est ce qui rend la
ville nordique blanche et la ville désertique ocre pour trois lignes de couleurs. La **végétation**
suit aussi (`themeSkin` dans scatter.ts) : taïga de conifères et bosquets givrés au nord, arbres morts
/ oliviers / épineux au sud, en réutilisant les props qui existaient déjà (`pine-snow`, `frost-tree`,
`snowdrift`, `dead-tree`, `olive`, `brambles`, `dune-grass`) ; les repères de carte et les ruines ne
bougent PAS (ce sont des points d'intérêt, pas du décor). ⚠ réglé À L'ŒIL SUR CAPTURE : un premier jet
« vert éteint » pour le nord donnait une forêt terne — l'hiver se lit quand tout est clair et bleuté et
que les seules taches sombres sont les conifères, c'est le CONTRASTE qui fait la saison, pas la
désaturation.

**LA MÉTÉO D'UN THÈME** (`voxel/weather.ts`, réglage `settings.weatherFps`, 2026-08-12) — la peau et
les modèles rendaient un thème reconnaissable, mais IMMOBILE : une carte nordique était un paysage
d'hiver parfaitement figé, un désert une étendue qui ne respirait pas. **Nordique** = la neige tombe
sous un **ciel couvert** ; **désertique** = des **vire-vents** roulent en travers du regard ;
**tempéré** = rien (et pas un octet téléchargé — `weatherPropKeys` charge les modèles PAR THÈME).
⚠ **la « cohérence » demandée est un VENT PARTAGÉ** (`windOf(seed)`) : le pont de nuages, l'inclinaison
de la chute et la course des vire-vents ont le même cap — c'est ça qu'on voit, pas la simple présence
de nuages (test dédié, qui le mesure sur le DÉPLACEMENT réel des nuages et non en relisant la constante
des deux côtés). ⚠ **« Aucun » (0 img/s) NE FIGE PAS, IL SUPPRIME** : aucune géométrie, aucune boucle,
aucun redraw — même contrat que « Figée » côté personnages, et la seule façon honnête de tenir « la
carte est 100 % on-demand » (les nuages en avaient déjà été retirés une fois pour la batterie en
2026-07-19) ; rallumer RECONSTRUIT. Les autres crans cadencent la boucle
(`setTimeout(1000/fps)` → rAF), jamais la fréquence de l'écran. Zéro CPU par flocon : chute, dérive et
rebouclage sont dans le VERTEX SHADER, une uniforme de temps par frame.
⚠⚠ **TROIS PANNES SILENCIEUSES, toutes trouvées à la MESURE et aucune détectable en lisant le code** —
(1) le pont de nuages construit avant que `BlockLibrary` ait chargé : `get` rend `undefined`, la pose
fait `continue`, la couche EXISTE mais est vide, et sa clé l'empêche d'être rebâtie (0 nuage) — d'où
`propsReady`/`weatherFor` ; (2) la colonne de neige semée sur la CARTE : la vue ne couvre qu'une
dizaine d'unités sur 50 à 140, donc <5 % des flocons étaient à l'image — elle **suit le regard**
(boîte de 72, recentrage à hystérésis) et tient une **densité à l'écran constante** en ne dessinant
qu'un PRÉFIXE du nuage de points (`setDrawRange`, les positions venant d'un hachage un préfixe reste
uniforme) ; (3) les vire-vents en voies larges : ils ne roulent que sur une case DÉCOUVERTE (jamais sur
l'eau ni sur la nappe de brume — essayé, ça se lit comme un objet en lévitation), or on ne connaît
qu'une cinquantaine de cases sur 1600 en début de partie → **0,00 vire-vent à l'écran en moyenne** ;
couloir resserré à la mesure de la vue → 2,1. ⚠⚠ **le test de praticabilité lit `this.game`, JAMAIS une
capture** : la couche est bâtie UNE fois par partie (sa clé la protège des redessins) alors que le
store REMPLACE l'objet `game` à chaque rafraîchissement — capturé, il gèle la carte de découverte telle
qu'elle était au lancement, si bien qu'aucun vire-vent ne roulait jamais ailleurs qu'autour de la ville,
quoi qu'on explore (rapporté en jeu ; mesuré 0,00 sur un coin exploré, 9,05 après correction). ⚠ **pas de
vire-vents dans la vue VILLE** (`WeatherOpts.tumbleweeds:false`, honoré aussi par `weatherPropKeys`
pour ne pas télécharger le modèle) : rien ne dit à une boule qui roule librement de contourner un
bâtiment, et elle les TRAVERSAIT — le tertre est trop dense pour un objet libre, et lui donner une
carte d'obstacles coûterait plus que ce que l'effet rapporte à cette échelle ; la ville garde la neige,
qui tombe sur tout sans rien traverser. ⚠ **le ciel SUIT LA CAMÉRA (parallaxe 1)** : la
projection étant dimétrique à 30°, un nuage à 15 unités d'altitude se projette ~26 unités plus haut à
l'écran, très au-dessus d'une vue qui n'en couvre qu'une vingtaine. ⚠ **un flocon blanc sur un ciel
blanc est invisible** (la moitié d'une carte est de la brume presque blanche) — d'où le flocon à deux
tons, cœur clair et **bord froid**. ⚠ **rien de la météo n'est pickable** (`engine.pick` raycaste la
scène ENTIÈRE : un nuage volerait les taps de la carte) et **les Points sont masqués pendant la passe
bloom** (ils n'ont pas `isMesh`, donc `darkenNonBloomed` les laissait passer et chaque flocon devenait
une source de lueur). Modèle `tumbleweed` (`gen-props.mjs`) : boule AJOURÉE de cerceaux tracés en
voxels FINS dans des plans d'orientation uniforme sur la sphère — deux angles d'Euler indépendants
donnent une boule APLATIE, et à la résolution grossière les cerceaux se soudent en brique ; centrée en
hauteur sur son rayon pour rouler sans flotter. ⚠ **SON ÉCHELLE SE MESURE EN TUILES** (`TW_SCALE`,
2026-08-17) : le modèle fait 0,90 tuile de large pour 0,77 de haut à l'échelle 1, donc les 0,50-0,85
du premier jet rendaient une boule de **0,77 tuile — la taille d'un héros** (`HERO_HEIGHT` 0,6) et
près du DOUBLE de la largeur d'un cactus (0,44), soit l'objet le plus large du désert après le vieil
arbre-repère (« les tumbleweeds sont trop gros », rapporté en jeu). 0,30-0,44 rend 0,27-0,40 tuile,
38-57 % d'un héros : à hauteur de cuisse. Même règle que les props (§« LES MODÈLES D'UN THÈME ») —
un objet trop gros ne se corrige pas à l'œil sur une capture, il se mesure contre un repère du jeu.
Tests : `npm run test:weather` (dont la taille, bornée par le haut ET par le bas — c'est du décor, il
doit rester visible).

**LA CONTRAINTE D'UN THÈME — LA SOIF** (`game/thirst.go`, 2026-08-11) — un thème qui ne serait
qu'une palette s'userait en deux expéditions ; chacun porte donc **UNE** contrainte de survie, encadrée
par six règles (`RETENTION-PLAN.md` §8) : brancher un système qui EXISTE, être collective et se régler
en ville, se payer en PA ou en matériaux (donc en concurrence avec la défense), être ANNONCÉE, ne
jamais piéger un absent, et **passer le plancher de survie**. ⚠ **`thirst.go` N'INVENTE RIEN, IL
ALLUME** : `StateSoif` était déclaré, retiré par la boisson / le Jus de fruit / l'Élixir de givre,
consulté par les bots — et **posé par personne**. Tout le sous-système de l'eau (rations du puits,
`Hero.DrewWaterDay`, capacités 50/75/112, recharge par vague, et jusqu'à `dailyWaterAllowance` de la
Cuisine niv.2) pendait à un état qui n'arrivait jamais, et le puits n'était qu'un distributeur gratuit
de +6 PA. Le thème **Désertique** le branche : `applyThirst()` pose la Soif **au changement de JOUR**
(pas à chaque vague : « qui n'a pas bu de la journée » est une phrase que le joueur peut se dire) sur
qui n'a pas bu, `thirstPA` 2 se paie **à la régénération** (jamais en PV — elle ralentit, elle ne tue
pas) avec un **plancher de 1 PA** (un assoiffé doit pouvoir marcher jusqu'au puits), la recharge du
puits tombe à `WellRefill` 4 contre 10, et **la Palmeraie (le biome FORÊT) rend de l'eau**
(`ThemeDef.ExtraDrops`) — l'oasis est là où sont les palmiers, et le thème les a justement éloignés :
le même biome porte alors le bois ET l'eau, destination disputée. ⚠ `ExtraDrops` **AJOUTE**, n'enlève
jamais (un thème ne peut pas couper une ville de son bois) et `terrainFor()` **copie** la table (muter
`Terrains` ferait boire toutes les parties) ; ⚠ **toute lecture de `Terrains` qui décide de ce qu'on
TROUVE passe par `terrainFor`** — fouille manuelle, fouille auto, ET `biomeSupplies` des bots, sinon
l'IA ignore l'eau de la palmeraie sur la carte même qui en dépend. Les bots boivent dès qu'ils portent
de quoi (`botConsumeClearing`) et l'eau entre dans `botShoppingList`. **Mesuré** : 148 héros-vagues
assoiffés sur 3 parties désertiques (0 en tempéré), 28 puisées au puits ; survie **médiane identique**
au thème témoin sur 8 graines (17 vagues) — la contrainte change ce qu'on FAIT, pas la difficulté.
Tests : `thirst_test.go`.

**LA CONTRAINTE NORDIQUE — LE FROID** (`game/cold.go`, 2026-08-11) — deux faces d'une même idée.
**(1) LA NEIGE RECOUVRE LES CASES** (`Tile.Covered`, `snowfall`/`snowmelt` à chaque vague) et
interrompt la **fouille AUTOMATIQUE** : c'est la réponse mécanique au seul reproche qu'on puisse faire
au campement (forage.go), qui est de se jouer tout seul une fois posé. ⚠ la fouille MANUELLE rend son
butin comme d'habitude **et déblaie la case** — le coût de la neige est de devoir REVENIR, jamais une
ressource perdue ; elle ne bloque pas le déplacement et ne blesse personne (règle 5). ⚠ **il faut le
DÉGEL** (`snowmeltDivisor` 8) : sans lui la couverture s'accumule indéfiniment — mesuré, 2787 cases
gelées pour toujours, soit un quart de la carte amputé au lieu d'une météo. **(2) LES FOYERS BRÛLENT**
(`burnHearth`, 1 unité/vague prise sur la Banque) : éteints, TOUT LE MONDE gèle (`StateGele`, −2 PA au
réveil, jamais de PV) ; allumés, les murs abritent et **se cacher aussi** (1 PA — se cacher, c'est déjà
avoir trouvé un abri, et ça réutilise une mécanique existante au lieu d'en ajouter une). ⚠ **ON BRÛLE
LES DÉBRIS D'ABORD**, puis le bois, le charbon en dernier : avec le seul bois, mesuré, les foyers
étaient éteints **46 nuits sur 48** — la contrainte n'était plus un choix mais un impôt permanent,
parce que le bois part dans les chantiers à mesure qu'il rentre. Brûler les Débris DÉCOUPLE le feu de
l'économie de construction et donne enfin un second usage à un objet de rebut (284 héros-vagues gelés
→ 25). ⚠ **PAS DE BÂTIMENT NEUF** : « le brasier » a été conçu puis écarté (modèle voxel + parcelle +
catalogue + 3 niveaux, et `buildingModelKey` rend INVISIBLE un bâtiment sans modèle) — les foyers d'une
ville sont une fiction que le journal et l'ordre du jour portent très bien. ⚠ **la table de la NEIGE
n'avait jamais été réglée** (aucune carte n'en portait) : elle recopiait la montagne, si bien qu'une
carte nordique posait la carrière à la porte de la ville — 88 de pierre en banque contre 6 en tempéré,
et CINQ vagues de survie en plus. Le sol gelé rend désormais moins que la roche (`Terrains[BiomeSnow]`
2-4 ressources, Pierre poids 3). Résultat : **médiane 17 vagues sur les TROIS thèmes** (8 graines,
4 joueurs) — latéral, jamais supérieur. Tests : `cold_test.go`.

**⚠ LA NEIGE N'EXISTAIT DANS AUCUNE PARTIE** (corrigé 2026-08-11) — les seuils du Studio donnent un
biome par niveau de hauteur et la neige exige le niveau 6, or le **lissage** (`genMaxStep` 1) rabote
les sommets : niveau maximum réellement produit = **5**, mesuré sur 8 graines × 4 tailles de carte
(zéro tuile de neige de 40² à 134²). Donc la **Tour gelée** ne naissait jamais et le **Plan de la
Caserne**, qu'elle est SEULE à donner, était inatteignable — un bâtiment du catalogue absent de toutes
les parties, sans qu'aucun test n'échoue. `snowCaps` coiffe les sommets ISOLÉS du niveau maximum,
`ensureSnowCap` garantit au moins une tuile (le point culminant du gisement de montagne) sur les
cartes molles. ⚠ ne pas « corriger » en baissant le seuil de la neige : elle volerait tout son terrain
à la montagne.

**LA TOUR DE GUET** (`game/watchtower.go`, `POST /heroes/{h}/tower/build`, 2026-08-16) —
des SITES semés au worldgen sur les **sommets** (`SeedWatchtowerSites` : une case dont
aucune voisine n'est plus haute, ≥12 du bourg, espacées de 10 ; ⚠ critère TOPOGRAPHIQUE
et pas de biome — « biome montagne » ne veut pas dire « point haut » dans ce
générateur). Chantier COLLECTIF (`WatchtowerPA` 14 + Bois 6/Pierre 4 en Banque, mêmes
règles qu'une ruine) ; une fois bâtie elle éclaire `WatchtowerSight` 6 cases **en
permanence et pour TOUS les joueurs** — c'est la seule façon de transformer une
exploration individuelle en savoir d'expédition. ⚠ **elle ne donne QUE de la vision**
(aucune défense, aucun PA, aucun stockage) : un objet qui ferait deux choses obligerait
à arbitrer entre elles. ⚠ **ce n'est PAS un `TownBuilding`** — greffer une parcelle
hors-les-murs sur `town.go` aurait contaminé la défense, l'ordre du jour et l'usure ;
elle réutilise le modèle des ruines. ⚠ **synergie voulue avec les mesas** : un sommet est
justement ce qu'un héros ordinaire ne peut pas atteindre (climb.go), donc la récompense
d'un plateau scellé est le belvédère qu'on y pose. La **Tour de la ville** fait de même
autour du bourg (`townTowerSight` 4/6/8 par niveau). ⚠ le modèle voxel doit figurer dans
la liste de PRÉCHARGEMENT de `VoxelMapView` (`bld-tower`, `bld-chantier`) — un modèle
absent rend l'objet SILENCIEUSEMENT invisible.

**LA VISION EN COMBAT** (`game/combatsight.go`, 2026-08-16) — l'arène servait TOUT :
chaque unité connaissait chaque ennemi à travers les piliers dès le premier round.
Désormais `Sight = 3 + perception/3` (la **PERCEPTION**, 7ᵉ statistique — la Précision portait les
deux au premier jet, à tort : voir §« LES STATISTIQUES »), vision MISE
EN COMMUN par camp, ligne de vue via `hasLOS`, et le **contact voit toujours** (sinon une
unité collée à un rocher devenait invisible pour celle qui la touche). `canTarget` exige
de VOIR — c'est la conséquence qui compte. ⚠ **`SightView` RETIRE les unités invisibles
du payload** au lieu de les marquer : un drapeau « cachée » laisserait la position
voyager. ⚠ **l'ORDRE du tour n'est pas amputé** (le raccourcir trahirait le nombre
d'ennemis). ⚠ **règle SYMÉTRIQUE** : `packTarget` ne cible que le visible… mais retombe
sur le plus proche quand il ne voit RIEN, sinon deux camps aveugles resteraient plantés
jusqu'à la limite de rounds — une panne, pas une tension. **ÉCLAIRER** (éclaireur,
`AttackDef.Reveal`, cooldown 3, aucun dégât, portée de ciblage 5) désigne une CASE — pas
une unité, et c'est tout le point : la capacité sert quand on n'a rien à cibler — et
marque les ennemis du rayon pour `spotRounds` 2 rounds. Tests : `combatsight_test.go`.

**Ruines-donjons** (`ruins.go`, 2026-07-19) — 5 bâtiments en ruine PAR BIOME semés au worldgen
(`SeedRuins`, déterministe, 1/biome, Chebyshev ≥ 3 de la ville) : Épave (sable 8 PA), Ferme
(prairie 8), Sanctuaire (forêt 10), Mine (montagne 12), Tour gelée (neige 12). `GameState.Ruins`
+ `Tile.RuinID`, caviardés par le fog comme les monstres. **Déblayage COLLECTIF** (`ClearRuin`,
PA partagés comme les chantiers, refus Tétanisé/combat) puis **donjon** (`ExploreRuin`, 2 PA,
4 charges) : tirage pondéré par type — matériaux rares (Acier, Cœur de chêne ancien), items
rares, « plans anciens » ; Récupérateur +1. **MÉMORIAUX (2026-08-09)** : chaque carte neuve sème aussi les ruines de villes RÉELLEMENT
tombées avant elle (`Memorial`, `SeedMemorialRuins`, `api.seedMemorials`) — nom, dernière vague,
défenseurs (`Ruin.Epitaph()`), butin = les MATÉRIAUX de la ville morte. La source est
`store.FallenTowns` : le classement conservait déjà tout et survit à la suppression de la partie,
donc aucune table de plus. ⚠ **jamais de transfert de puissance entre parties** (pas de plan de
bâtiment dans la table, test dédié) : ça casserait l'égalité qui fait tenir une survie de groupe.
C'est la réponse au trou de rétention n°1 (`RETENTION-PLAN.md`). Front : menu radial ⛏️ Déblayer / 🏛️ Explorer ;
voxel `site-*` v0 enseveli / v1 déblayé (variante par ÉTAT serveur), socle doré. Tests
`ruins_test.go`. (Les bots ignorent les ruines.)

**Ordre du jour & prévision de vague** (`orders.go`, `components/TownOrders.tsx`, 2026-08-09) —
`Town.Orders` (≤ `townOrdersCap` 4 lignes) et `Town.Forecast` sont **entièrement DÉRIVÉS**, refaits par
`Recompute` EN DERNIER (ils lisent les `b.Cost` qu'on vient de recalculer). L'ordre du jour classe par
urgence : menace chiffrée → portail ouvert → remparts → chantier en cours → matériau manquant pour la
prochaine amélioration défensive → plan posable → usure. `Forecast` = `hordePower` SANS le terme
aléatoire (on annonce « ~34 », pas une promesse) et n'est actionnable que parce que la puissance dérive
des assiégeants : tuer fait baisser le chiffre sous les yeux du joueur. Réponse aux trous T3/T5 de
`RETENTION-PLAN.md`. Tests `orders_test.go`.

**Consignes permanentes** (`orders_standing.go`, 2026-08-09) — `Hero.Order` (`shelter` | `return`),
posée gratuitement, exécutée par `runStandingOrders()` juste AVANT `attackHeroesOutside` puis
**consommée**. ⚠ **le menu ne PROPOSE que ce qui peut s'exécuter** (2026-08-12) : le serveur ne part
que si `distance ≤ PA` et se rabat SILENCIEUSEMENT sur « se cacher » sinon — l'interface offrait donc
« 🏰 Rentrer » à un héros à 1 PA au bout du monde, promettant un retour qui n'aurait jamais eu lieu
(rapporté en jeu). `MapTab` calcule le MIROIR de cette règle (distance de Manhattan vs PA COURANTS —
les consignes s'exécutent avant la régénération de vague, donc le PA affiché est bien celui qui
servira), affiche le coût `-N` sur le bouton, et **écrit la raison** quand il est éteint ; à 0 PA les
DEUX consignes s'éteignent, puisqu'aucune ne pourrait tourner. Garde-fou : `npm run test:map-tap`. Trois bornes délibérées : une seule vague, jamais de combat ni de fouille, et `return`
ne se met en marche que si la ville est atteignable (sinon il se cache — brûler ses PA pour finir à
découvert est le piège que les bots ont connu). Réponse au trou T4 : les PA non dépensés sont PERDUS,
donc une soirée manquée coûtait une journée de travail. ⚠ c'est un FILET, pas un pilote automatique —
un joueur présent doit faire strictement mieux. Tests `orders_standing_test.go`.

**Registre de contribution & requêtes** (`contribution.go`, `requests.go`, 2026-08-09) —
`credit()` sur six actions ; `Ledger()` rend l'ordre d'ARRIVÉE, **jamais trié par mérite** (trier
installerait une compétition entre coéquipiers). Les requêtes du Panneau (`PostRequest`/`FillRequest`)
sont la **seule sortie de la Banque** vers un joueur, et elle exige d'être deux — se servir soi-même
est refusé. Routes `/town/request`, `/town/request/fill`.

**Tour de guet** (`orders.go`) — `Forecast()` rend une FOURCHETTE dont la largeur se mérite : sans Tour
±50 %, chaque niveau resserre, et chaque JOUEUR monté observer (`ScoutWave`, 2 PA, `/town/scout`)
resserre encore **pour toute la ville**, une fois par joueur et par vague (remis à zéro à chaque vague).
⚠ à faible horde (~5) la fourchette entière sature à ±1 : normal, une vague de début est prévisible.

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

**Équilibrage & simulation de partie** (`internal/balance`, `cmd/balance`, 2026-08-09) — une partie
ENTIÈRE jouée en tête, sans mock : vrai worldgen, vrais joueurs-IA, vraie horloge (`game.AdvanceTo`,
le chemin du battement en production) — donc un verdict de la simulation est un verdict sur le JEU.
`balance.Run(Config{Seed,Players,Waves})` → `Report{Snapshots[]}` (par vague : horde/défense/dégâts/
PV, héros vivants·en ville·cachés·tétanisés, bâtiments/niveaux/usure, banque + bois + pierre, sacs,
packs/unités, ressources restantes). CLI : `go -C backend run ./cmd/balance [-seeds N] [-players N]
[-waves N] [-detail] [-sweep] [-json]`. **`SurvivalFloor = 12`** (`balance_test.go`) est le contrat :
une ville laissée aux seuls bots doit tenir 12 vagues sur toute graine et à 1·2·4·8·12·20 joueurs ; un
`TestTownActuallyProgresses` exige en plus qu'elle CONSTRUISE, récolte, tue et évolue (survivre sans
rien faire n'est pas un jeu), et `TestBigExpeditionsGoFurther` est une **ÉCHELLE** (1 < 4 < 20) et non
deux points — « 20 > 1 » se satisfaisait d'une courbe qui plongeait au milieu, ce qui était le cas.
Écrire cet instrument a révélé que **toutes les graines mouraient à la vague 5** — invisible pour la
suite de tests, qui n'avait jamais joué une partie. **Médianes actuelles : 15 · 18 · 22 · 22 vagues
pour 1 · 4 · 12 · 20 joueurs.** Historique complet : `journal.md` (entrées 94 et 98).

⚠ **DEUX PIÈGES QUI ONT FAIT MENTIR L'INSTRUMENT** (2026-08-09, entrée 98) — les deux invisibles :
- `rand.Seed` est un **NO-OP depuis Go 1.24**. Le worldgen ET la simulation comptaient dessus : deux
  parties de même graine n'avaient pas la même carte, et l'instrument ne répondait pas deux fois pareil
  à la même question. Tout le paquet `game` passe désormais par `game/rng.go` (`SeedRNG`, `randIntn`,
  `randFloat64`, verrouillés) et worldgen par un `*rand.Rand` local. Gardes : `determinism_test.go`.
  ⚠ une sonde qui fait avancer deux rejeux TOUR À TOUR partage leur flux de hasard : elle se mesure
  elle-même. Rejouer A EN ENTIER, puis resemer et rejouer B.
- **L'horloge.** `SearchTile` planifiait la fouille automatique sur `time.Now()` alors que la simulation
  tourne sur une horloge synthétique → **zéro récolte automatique sur une partie entière**, donc un jeu
  amputé de son économie de campement. `GameState.clock()` rend l'instant REJOUÉ pendant un rattrapage
  (`simNow`, posé par `AdvanceTo`, non sérialisé) et l'heure réelle sinon. **Toute échéance qu'une
  action pose dans le futur doit partir de `g.clock()`**, jamais de `time.Now()`.
- **Un test qui affirme quelque chose sur une issue tirée aux dés doit SEMER** (`seedForTest` dans
  `bots_test.go`) : empiler les statistiques rend une victoire probable, pas certaine — mesuré, trois
  héros à 20 de force perdaient contre deux slimes une fois sur vingt, et le test échouait au hasard.

**Comportement des bots — deux règles trouvées à la mesure** (entrée 98) : un récolteur **se fixe un
cap et s'y tient** (`Hero.GoalX/GoalY/HasGoal`, `botGoalWorthKeeping`) — rechoisir sa destination à
chaque round le faisait osciller (mesuré : 7 pas par récolte, une case à dix pas jamais atteinte avec
6 PA/vague) ; et il **rentre ce dont la Banque est à ZÉRO** quelle que soit la taille de son sac
(`botCarryingWanted`) — le seuil de portage est un critère de rendement, muet sur l'urgence, et à
soixante héros portant huit objets chacun personne ne l'atteignait (mesuré : 56 Pierre et 39 plans
dormant dans les sacs, dont dix « Plan de la Tour » jamais bâtie).

**Réparer la VILLE** (`TownAction("wall","repair")`, `TownRepairHP` 5 PV par PA, `TownRepairMaterial`
« Pierre », 1 par PA ; bouton « 🧱 Relever les remparts » du modal Mur) — **rien ne rendait de PV à
`Town.HP`** : les bâtiments se restauraient, la ville non, donc toute partie était un compte à rebours
indépendant des joueurs. C'est cette action qui fait de l'ÉPUISEMENT DE LA CARTE, et non de
l'arithmétique de la horde, la vraie limite d'une longue partie. Bornée aux PV manquants (ne gaspille
ni PA ni pierre) et refusée sur une ville intacte. Tests `townrepair_test.go`.

**ÉQUIPEMENT** (`equipment.go`, `GET /api/equipment`, `POST /heroes/{h}/equip`, 2026-08-10 ;
objets d'athlétisme et de précision 2026-08-16) — la
forge produisait lames, arcs, capes et armures dont les effets n'étaient QUE DU TEXTE : on montait
l'Atelier au niveau 2, on fabriquait l'objet, il rejoignait la Banque et n'en ressortait jamais.
**DEUX EMPLACEMENTS** (`SlotWeapon` « arme », `SlotGear` « equipement ») — assez pour qu'un choix se
pose, assez peu pour rester lisible sur un téléphone. ⚠ **l'objet QUITTE le sac** tant qu'il est porté
(sinon on le déposerait en Banque tout en le portant, et une seule lame armerait la ville) et y
revient au retrait, y compris quand on remplace une pièce. ⚠ **les bonus sont PRÊTÉS à la
`CombatUnit`, jamais greffés sur `Hero.Stats`** (même règle que l'Armurerie : greffés, ils
s'empileraient à chaque combat). Quatre effets réels : stats (force/dext/agilité/endurance — et
`u.Move` est RECALCULÉ après, sinon une cape d'agilité ne changerait rien), `Armor` (dégâts subis en
moins, appliqué APRÈS les multiplicateurs, plancher 1), `Reach` (l'arme change les `Targets` de
l'attaque de base — c'est ce qui fait d'un arc autre chose qu'une épée aux chiffres différents) et
`VsCursed` (l'argent contre les loups-garous). ⚠ `damageWith` et `EstimateDamage` doivent rester
MIROIRS, armure comprise, sinon la prévisualisation d'attaque ment. ⚠ **Athlétisme et Précision ont enfin leurs objets** (2026-08-16) : **Bottes cloutées** (+3 ath,
Atelier niv.**1** — délibéré, elles ouvrent des ZONES DE CARTE et les réserver au niveau 2 fermerait
une partie du monde derrière une chaîne de construction qu'une petite expédition n'atteint pas),
**Œil-de-lynx** (+3 PERCEPTION — un lynx ne frappe pas mieux, il VOIT plus loin : c'est
le seul équipement qui agrandit le champ de vision, sur la carte comme dans l'arène) et **Stylet d'écorcheur** (dague, +1 force/+4 précision — la dague
devient la voie du coup PLACÉ face à l'épée du coup lourd). Les deux statistiques n'étaient portées
par AUCUN objet, ce qui se tenait tant qu'elles ne faisaient rien. Les bots PORTENT ce qu'ils
trouvent (`botEquip`) mais ⚠ **NE FORGENT PAS** : mesuré, leur faire fabriquer des armes coûte deux
vagues aux grandes expéditions (le fer d'une lame est celui du portail niveau 3). Tests :
`equipment_test.go`.

**LES ARMES FONT LE COMBAT** (`weapons.go`, action combat `swap`, 2026-08-11) — l'équipement donnait
des CHIFFRES et, pour deux armes, une portée ; mais au combat un héros à l'arc et un héros à l'épée
jouaient le même tour avec les mêmes boutons. Chaque arme appartient désormais à un **ARCHÉTYPE**
(`EquipDef.Weapon` : `epee | dague | lance | arc | baton`) et l'archétype porte une **TECHNIQUE** —
une action de combat de plus, à qui la PORTE, quelle que soit sa classe : **Fauchage** (épée : frappe
la case visée ET ses quatre voisines), **Coup bas** (dague : 30 % de Stun), **Estoc** (lance : portée 2
et repousse), **Tir en cloche** (arc : portée 2-4, ignore la couverture, INUTILISABLE au contact),
**Balayage** (bâton : Root). Deux champs nouveaux d'`AttackDef` les portent : `Push` (mêmes règles que
l'action Poussée) et `IgnoreCover` (le seul cas où l'ARME, et non la position, annule un modificateur
de terrain). ⚠ **l'archétype vient du CATALOGUE**, pas d'un `switch` sur le nom : une arme ajoutée à
`Equipment` hérite de sa technique sans toucher au combat. ⚠ **AUCUNE PÉNALITÉ AUX MAINS NUES** — la
technique est un GAIN, pas une taxe : punir l'absence d'arme punirait toutes les premières vagues.
⚠ **une technique n'est jamais strictement meilleure que l'attaque de base** (le Fauchage ne gagne
rien sur une cible isolée, l'Estoc peut ÉLOIGNER une cible qu'on voulait finir, la cloche ne vise pas
au contact) : c'est ce choix situationnel qui fait le tour de jeu. ⚠ **`Combat.HeroSkills` est LA
liste** (classe puis technique, technique en DERNIER) — `PlayerAction` l'indexe par le même `skillIdx`
que le client, donc les deux ne peuvent pas diverger ; le payload marque la technique d'un drapeau
`weapon` pour qu'elle s'affiche avec l'arme et non avec la classe.
**CHANGER D'ARME EN COMBAT** (`SwapWeapon`, action `swap`, `current.swaps`) coûte **le tour** : porter
l'arc ET l'épée, c'est accepter de perdre un tour à changer de registre quand la mêlée se ferme —
sans ce coût on garderait toujours l'arme optimale et l'archétype ne serait plus un choix. ⚠ la mise
à jour de l'unité se fait **EN DELTA** (`refreshWeapon`) et jamais en recalculant depuis le héros :
un +2 force gagné pendant le combat (Hurlement de Meute) serait effacé par un recalcul. L'IA joue
aussi la technique (`heroAutoAct`, la plus bonifiée des deux — balayer TOUTE la liste changeait le
choix des classes à deux compétences). Côté client : `CombatUnit.weaponName/weaponKind` alimentent la
pastille d'arme de la barre de combat, le **geste** du rig (`makeRig(key, weapon)` — l'arc arme la
corde au lieu de faucher ; ⚠ seul le GESTE change, le modèle tenu est cuit dans le `.vox`) et le
**projectile** (`spawnShots` : flèche pour un arc, éclat sinon, en cloche, mêlée exclue — un tir à
trois cases n'était RIEN à l'écran). Tests : `game/weapons_test.go`, `api/weapons_test.go`,
`frontend/tests/combat-ui.mjs`. ⚠ `CombatHeal` est désormais **dérivé d'`ItemEffects`** : le lot C3
avait figé sa propre table de quatre objets, qui listait « Baies » (nom d'aucun objet du jeu) et
ignorait l'Élixir de sève.
**LA PORTÉE SE VOIT** (`Combat.AimCells`, `current.attackCells` + `skills[].cells`, 2026-08-11) — la
portée d'une arme ne se lisait que dans une LISTE DE CIBLES : rien au sol ne disait « d'ici, la lance
atteint deux cases » ni « ce rocher coupe mon tir ». `AimCells(u, atk)` rend les cases visables —
grille de ciblage, bornes de l'arène et **ligne de vue**, exactement les règles de `canTarget`
(⚠ recalculées côté client elles divergeraient au premier obstacle, et le joueur viserait une case
que le serveur refuse ; test dédié dans les DEUX sens). Le client peint aussi la **ZONE D'IMPACT** de
la cible SURVOLÉE (`store.aimUnitId`, `setAimUnit` sur `onPointerEnter`/`onFocus` des boutons de
cible) à partir de `skill.damage` — le Fauchage éclabousse, l'attaque de base non, et ça ne se voyait
qu'APRÈS avoir frappé. ⚠ **une case peut être à la fois accessible et frappable** (bouger ne termine
pas le tour) : les deux remplissages au même niveau se battaient en z-fighting, d'où des COUCHES
explicites dans `quad(..., lift)` — portée 0,012 < déplacement 0,02 < menace 0,028 < liseré de portée
0,035 < zone d'impact 0,045 — et c'est un LISERÉ rouge, posé au-dessus, qui porte la portée sur une
case verte.

**USAGE DES OBJETS** (`items.go`, `GET /api/items`, `POST /heroes/{h}/use`, 2026-08-10) — le
catalogue portait 26 recettes dont les effets n'étaient QUE DU TEXTE : on cuisinait des ragoûts et
des potions qui dormaient en Banque, et la seule remise en état d'un héros abîmé était de mourir puis
d'être ressuscité. `ItemEffects` (table servie au client, jamais recopiée) donne `{PA, HP, Clears,
ClearsAll, Desc}` par nom d'objet. ⚠ **LA FAIM N'EXISTE PAS** dans le code (elle est au GDD) : un plat
ne « restaure la faim », il rend des **PA** — la vraie monnaie d'une journée, à l'image de la Ration
d'eau (`RationPA` 6). Barème : plat cuisiné 2-5 PA, aliment BRUT 1 (dépannage, ça laisse sa raison
d'être à la Cuisine), potions 5-10 PV, Ambroisie rend tout et purge TOUS les états. **Gratuit en PA**
comme boire : ce qui borne l'usage, c'est l'objet, qu'il a fallu récolter puis cuisiner. ⚠ **Tétanisé
ne se mange pas** (c'est un pack qui cloue, pas une fatigue) — seule l'Ambroisie le retire. ⚠ **LA
CANTINE** : en ville un héros consomme SUR LA RÉSERVE COMMUNE sans rien emporter — la seule sortie de
la Banque vers un joueur reste la requête du Panneau, qui exige d'être deux ; sans cette porte tout ce
que la Cuisine produit restait bloqué en Banque. Les bots s'en servent (`botUseItem` : potion sous
60 % de PV, repas à court de PA) et **cuisinent** (`botCookStores`, seuil bas par produit). Mesuré :
médianes 15 · 17 · 19 · 21 · 22 · 23 (contre 15 · 15 · 18 · 21 · 22 · 22). Tests : `items_test.go`.
⚠ `ItemEffect` PORTE DES TAGS JSON : la table est servie au client, sans eux Go sérialisait `PA`/`Desc`
et l'interface lisait `undefined`. ⚠ et un handler qui a besoin du `playerId` ET d'un autre champ doit
DÉCODER LE CORPS UNE SEULE FOIS (`decodePlayer` consomme le flux — sinon le champ arrive vide).

**Crafting** (`craft.go`, `CraftTab.tsx`) — **town mode** (≥1 hero in town): full recipes, ingredients from the
Bank, paid by the chosen *town worker*, output to the Bank. **Field mode** (no hero in town): only `field`
recipes (kitchen/campfire), ingredients from the **selected hero's bag**, paid by that hero, output to the bag.
Forge/workshop recipes are town-only (`field:false`).

**LES SIX PROFILS DE CLASSE** (`classes.go`, différenciés 2026-08-16) — le catalogue
portait SIX classes pour **TROIS blocs de statistiques** : Pionnier == Gardien (Force 5,
End 3) et Éclaireur == Récupérateur == Herboriste (Ath 5, Agi 3, End 2). L'Éclaireur — la
classe de la vision — était donc le clone chiffré de l'Herboriste, et choisir sa classe
n'engageait rien de mesurable. Chaque bloc vaut désormais **10 points** et raconte ce que
la classe sait faire, en accord avec ses propres compétences : **Pionnier** F5·At3·E2 (il
ouvre le passage, et il GRIMPE — ce que son passif promet) · **Chasseur** D5·P3·E2 (ses
deux tirs portent à la dextérité, la précision place le coup) · **Éclaireur** Pe5·A3·E2
(l'ŒIL) · **Gardien** E5·F5 (le mur) · **Récupérateur** At5·E3·F2 (celui qui va chercher
loin) · **Herboriste** P4·D3·E3 (son Aspersion acide frappe DÉJÀ à la précision).
⚠ **différencier ne doit ni hiérarchiser ni AMAIGRIR** : un premier jet répartissait
joliment mais faisait passer la somme d'endurance du catalogue de 14 à 11 — et comme
l'endurance porte les PV, la survie médiane a chuté (mesuré : 18 → 17 à quatre joueurs,
19 → 17 à douze). Deux tests le gardent (`TestEveryClassHasItsOwnStatProfile`,
`TestClassBonusesAreWorthTheSame`) et `botEvolve` choisit désormais sur la statistique que
la classe fait fructifier. Tests : `perception_test.go`.

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
GET  /api/leaderboard[?mode=…][&season=…]         classement des villes (top 50, vagues puis monstres
                                                 tués ; mode inconnu -> 400). season: SAISON EN COURS
                                                 par défaut, `all` = tous les temps -> [] ScoreEntry
GET  /api/seasons                                {current, seasons[{id,label,current}]} (jouées + en cours)
GET  /api/auth/config                            {googleClientId} (""=Google désactivé; le front s'y adapte)
POST /api/auth/register                          {email,name?,password} -> {user,token} (bcrypt, session 30j)
POST /api/auth/login                             {email,password} -> {user,token} ; POST /api/auth/logout
POST /api/auth/google                            {credential:id_token GIS} -> {user,token} (501 si non configuré)
GET  /api/auth/me                                 (Bearer) -> {user}
GET  /api/auth/me/games                           (Bearer) mes parties + myPlayerId (reprise multi-appareils)
GET  /api/auth/me/chronicle                       (Bearer) ma chronique -> {runs,totals,titles}
                                                 (cosmétique ; réservé au titulaire, pas de vue publique)
GET  /api/games?status=open|lobby|active          `open` = ce qu'on peut REJOINDRE (salons + expéditions
                                                 publiques dans leur fenêtre d'accueil) ; résumés
                                                 (id,name,players,min/max,joinOpen,joinWavesLeft…)
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
POST /api/games/{id}/catchup                      RATTRAPAGE DEMANDÉ: avance CETTE partie (budget
                                                  CatchUpBudget) et rend un RÉSUMÉ, pas l'état complet
                                                  -> {done,waves,skipped?,waveNumber,townHp,status}
                                                  (la boucle du retour tourne dessus; l'état complet
                                                  n'est rechargé qu'une fois, à l'arrivée)
POST /api/games/{id}/town/action                  {buildingId, action: build|restore|repair|use|water|toggle|revive|heal, points?, heroId?}
                                                  (repair = mur : PA + Pierre -> PV de la ville)
POST /api/games/{id}/town/blessing                {playerId, godId} vote au Temple pour le dieu que la
                                                  ville appelle (mythic.go). GRATUIT, sans héros ni PA ;
                                                  godId vide = retirer sa voix. Le panthéon lui-même
                                                  voyage dans le payload (`theme.pantheon`) — pas de
                                                  route de catalogue à part.
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
GET  /api/items                                   {nom -> {pa,hp,clears,clearsAll,desc}} ce qui se consomme
GET  /api/equipment                               {nom -> EquipDef} ce qui se PORTE (2 emplacements)
POST /api/games/{id}/heroes/{h}/equip             {item,slot} porte un objet du sac (item vide = retirer)
POST /api/games/{id}/heroes/{h}/use               {item} consomme un objet du sac (ou, EN VILLE, de la
                                                  réserve commune : on mange sur place, on n'emporte rien)
POST /api/games/{id}/heroes/{h}/tower/build     {points} bâtit le belvédère du sommet sous le héros
POST /api/games/{id}/heroes/{h}/ruin/clear        {points} déblaye la ruine sous le héros -> {ruin, game}
POST /api/games/{id}/heroes/{h}/ruin/explore      fouille le donjon déblayé (2 PA) -> {item, game}
POST /api/games/{id}/heroes/{h}/evolve            {classId} -> GameState (applies class bonuses)
GET  /api/classes                                 [] ClassDef catalog (tier 1+2 classes)
GET  /api/mapskills                               [] MapSkillDef (compétences de carte par classe)
GET  /api/themes                                  [] ThemeDef — les NATURES d'expédition (theme.go)
GET  /api/metrics                                 RÉTENTION J1/J3/J7 par cohorte (metrics.go) — FERMÉ
                                                 par le jeton du battement (503 sans jeton en
                                                 déploiement, 401 si mauvais)
POST /api/games/{id}/heroes/{h}/combat/start
GET  /api/games/{id}/combat/{c}
POST /api/games/{id}/combat/{c}/action            {unitId, action: move|attack|skill|defend|push|flee|item|swap|end,
                                                  x,y, targetId, skillIdx, item}
                                                  skill: `skillIdx` indexe game.HeroSkills (classe puis
                                                  TECHNIQUE D'ARME) ; swap: `item` = l'arme à dégainer
                                                  (du sac, coûte le tour ; vide = ranger)
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
⚠ **UN LIBELLÉ TRONQUÉ SUR UN TÉLÉPHONE EST UN LIBELLÉ PERDU** : il n'y a pas de survol pour révéler
un `title`. La grille d'inventaire (`ItemGrid` + `.item-name`) coupait les noms sur une ligne — « Plan
de la P… » et « Plan de la C… » sont le MÊME texte à l'écran ; elle les enroule désormais sur trois
lignes (`overflow-wrap: anywhere`, clamp à 3 en garde-fou). Réflexe à garder pour toute nouvelle
étiquette : le vérifier à 390 px de large, garde-fou `npm run test:inventory` (qui mesure
`scrollWidth` contre `clientWidth`, c'est-à-dire le navigateur et non une estimation).
⚠⚠ **UN TOKEN DE COULEUR POSÉ SUR UN FOND FAIT DU MÊME TOKEN EST UN PIÈGE MUET** : `.chip.wave
.wave-dmg` était `color: var(--red)` sur un dégradé qui FINIT sur `var(--red)` — contraste **1,40:1
mesuré**, un chiffre invisible ; et `.chip.wave.fatal { color: var(--red) }` faisait le même coup au
chip ENTIER, minuteur compris, au moment où il compte le plus (rapporté en jeu 2026-08-16). Deux
règles : un badge se détache par son **FOND** (encre translucide), jamais par sa teinte ; et une
alerte **AJOUTE** du contraste, elle n'en retire pas. Garde-fou `npm run test:wave-chip`, qui MESURE
les pixels peints. Corollaire : **un débordement de TopBar se mesure** (`scrollWidth` contre
`clientWidth`), il ne se constate pas à l'œil — la barre débordait de 41 px à 390 px, ⚙️ hors écran,
depuis l'ajout de ce badge, sans que personne le voie sur les captures. Enfin, **un chiffre nu ment**
(« −0/16 » a été lu comme une fraction, pas comme la fourchette de PV qu'il est) : les phrases de la
prévision sont écrites UNE fois dans `src/forecast.ts`, servent la pastille + son `aria-label` + son
`title` + la feuille « État de la ville », et la version longue DOIT exister ailleurs qu'en `title=`.
L'app est **en français** : les chaînes anglaises restantes sont des bugs — SAUF celles qui portent
de la logique de jeu (`"Ration d'eau"`, `"Plan "`, `"Tétanisé"`), à ne jamais traduire. Les noms de
bâtiments s'affichent via `buildingName(id)` (`data/buildings.ts`), pas via `b.name` du serveur —
⚠ et côté SERVEUR, toute phrase française composée en Go (journal de la ville, ordre du jour,
messages d'erreur) doit passer par **`buildingLabel(id, fallback)` / `b.Label()`** (`town.go`) : une
phrase fabriquée côté serveur ne peut pas être traduite côté client, et le joueur lisait « Wall
niveau 2 : il manque 6 Pierre » ou « Gui a achevé la construction de Kitchen » (corrigé 2026-08-09,
test `TestServerWrittenSentencesUseFrenchBuildingNames`).

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
  + "deposit loot" (server deposits my team's bags only). **Taper un objet ouvre sa FICHE**
  (`components/ItemSheet.tsx`, 2026-08-12) : ce que c'est, ce qu'il fait (`GET /api/items` +
  `GET /api/equipment` — le jeu le savait et ne le disait NULLE PART), puis les deux seules actions du
  jeu, « 🍽️ Utiliser » et « 🗡️/🧥 Équiper ». Avant, la grille était une vitrine et un tap CONSOMMAIT
  l'objet sans rien dire. ⚠ **la fiche n'offre jamais un bouton qui échouera** : `Utiliser` prend dans
  le sac — ou, en ville, dans la réserve commune (la « cantine » d'items.go), d'où un bouton actif sur
  la Banque à condition qu'un héros soit dans les murs — et `itemWouldHelp` est le **MIROIR** de la
  fonction serveur du même nom (héros déjà au mieux ⇒ bouton éteint, avec la raison écrite) ; `Équiper`
  exige l'objet dans le sac DE CE HÉROS, donc jamais depuis la Banque. Un objet sans action (ressource,
  plan) ouvre quand même sa fiche et EXPLIQUE à quoi il sert — c'est tout l'intérêt.
- **Structure**: vue par défaut **groupée par état** (tri « Statut ») : **🏗️ Chantiers en cours**
  (constructions ET améliorations — barre `paInvested/cost.pa`, bouton « +N PA », « ⏸ matériaux
  manquants » si la Banque ne couvre pas la liste), **📐 Plans à poser** (sites, bouton « Poser le
  plan » 1 PA), **🏠 Construits** (bouton « 📐 Améliorer » = pose le plan d'amélioration). Tris A-Z/Lv
  = liste plate. Coût affiché = TOTAL du chantier (PA + matériaux vs Banque) ; actions exigent un
  héros en ville (consultation sinon).
  ⚠ **UN PLAN QU'ON N'A PAS TROUVÉ N'EST PAS LISTÉ** (2026-08-16, `townUtils.buildingKnown` : bâti ·
  en chantier · pas de plan requis · plan en Banque). Dix bâtiments sur seize ne s'ouvrent qu'avec un
  plan qui ne tombe que des ruines et de la fouille : les afficher avant alignait SIX lignes
  « 📐 Plan de X 0/1 » à bouton mort au-dessus des chantiers réellement ouvrables (rapporté en jeu).
  Le même juge sert aux TROIS écrans qui NOMMENT un bâtiment — Structures, `TownStatus` (ses deux
  listes) et les **pastilles de `VoxelTownView`** (la parcelle d'un site inconnu reste une friche
  anonyme) : cacher ici et nommer là serait le pire des deux mondes. Une ligne de pied de liste dit
  COMBIEN de bâtiments attendent leur plan **sans les nommer** — le catalogue doit se deviner plus
  grand que la ville (c'est le moteur des ruines), pas se lire comme une liste de courses. Rien à
  changer côté serveur : `orders.go` ne parle que des plans DÉJÀ en Banque et `botShoppingList`
  ignore déjà les sites sans plan. ⚠ **LA DÉCOUVERTE SE DIT** (toast, `useStore.subscribe` en fin de
  `store.ts`) : un plan qui tombe dans le sac d'un de MES héros (« dépose-le à la Banque ») et un
  plan qui arrive en BANQUE (« nouveau chantier débloqué : X », vaut aussi pour le dépôt d'un
  coéquipier) — sans quoi le seul signe d'un chantier neuf serait une ligne de plus dans un onglet
  qu'on n'ouvre pas. UN seul point de branchement, donc le toast part quelle que soit la route de
  l'état (dépôt, sondage, rattrapage, bot). ⚠ deux gardes indispensables : on ne compare que deux
  états de la MÊME partie (`next.id === before.id` — sinon reprendre une partie déverse un toast par
  plan déjà en Banque) et seules les APPARITIONS parlent (sinon le sondage de 20 s toaste en boucle ;
  et le dépôt, qui vide le sac ET remplit la Banque dans le même état, ne dit qu'UNE chose).
  ⚠ **LE JOUEUR DOSE SES PA** (même jour) : un chantier ouvert porte un `− / valeur / + / tout`
  (`.ps-invest`, état local par bâtiment) plafonné aux PA du travailleur ET au restant du chantier ;
  le défaut reste « tout » (le geste d'avant, en un tap). Le serveur acceptait déjà n'importe quel
  `points` (`TownAction`, testé en Go) — c'était l'interface qui imposait le tout-ou-rien, alors que
  les PA d'un héros SONT sa journée. Garde-fou : `npm run test:structures`.
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
- **LES BORNES DE LA CAMÉRA** (`VoxelEngine.panBounds`, 2026-08-16) — le pan des trois vues voxel était
  INFINI. Sur la VILLE on tirait le tertre dans un coin et il ne restait à l'écran que du ciel : les
  nuages volent à 13-17 unités et la projection est dimétrique à 30°, donc ils se projettent **~26
  unités PLUS HAUT** que le sol — un pan vers le haut ne trouvait littéralement QUE des nuages, sans
  plus aucun repère pour savoir dans quel sens revenir (« quand je bouge ça déplace les nuages »,
  rapporté en jeu). Chaque vue pose désormais le rectangle de SON contenu : le tertre
  (`TownLayout.hill`, demi-axes de la butte), la carte (`0..width-1 × 0..height-1`, reposé à chaque
  dessin — une autre expédition a une autre taille) et le damier de l'arène (9×9 pour un boss).
  ⚠ **le recadrage se fait dans `applyCamera()`**, pas dans les contrôles : toute la math écran↔monde
  passe par `groundAt()`, qui appelle `applyCamera` — borner au seul endroit qui pose la caméra
  garantit qu'aucun chemin (pan, pinch, molette, recentrage sur un héros) ne peut sortir du contenu, et
  que le point saisi sous le doigt est recalculé sur la caméra RÉELLEMENT posée (butée nette, sans
  dérive accumulée). ⚠ la cible reste DANS le rectangle : on peut amener le BORD du contenu au centre
  de l'écran, jamais au-delà — borner n'est pas figer, un pan normal continue de déplacer la vue.
  `null` (défaut) = pan libre, pour l'éditeur et le banc. Garde-fou : `npm run test:camera` (dont un
  TÉMOIN qui rejoue le même geste bornes retirées et DOIT perdre le bourg).
- **Map** (`MapTab`): carte du monde en **voxel** (`voxel/VoxelMapView.tsx`) — SEUL rendu depuis
  2026-07-29, le moteur Phaser et tout le rendu 2D isométrique ayant été retirés (bundle 2 652 kB →
  1 138 kB). Terrain en **colonnes voxel fines** (`smoothTerrain.ts`, R=10 colonnes par tuile, pas
  vertical 1/10) plutôt qu'en cubes d'une tuile ; props, personnages et monstres en modèles voxel
  animés (§7a-bis). **Fog of war — appliqué dans le payload HTTP** : `Tile.Discovered` est
  server-authoritative & partagé (`fog.go`: `RevealVision` dans `Recompute`, anneau Chebyshev autour
  de la ville [rayon 3] et de chaque héros vivant [**rayon 1**, Éclaireur 2 — le rayon 0 « au contact »
  d'origine rendait la prospection impossible : mesuré, 2 tuiles de montagne découvertes sur 31 en douze
  vagues, donc zéro pierre et défaite arithmétique]). `GameState.ClientView()` est appliqué à TOUTE réponse par
  l'interception centrale `clientView` dans `api.writeJSON` : les tuiles non découvertes partent
  **vierges**, les monstres sur tuiles cachées sont **omis**, et la **seed est masquée** (seed +
  générateur = toute la carte). Tests : `fog_test.go` (`TestClientViewRedactsUndiscovered`).
  ⚠ **Fog of war à TROIS ÉTATS et à mémoire PAR JOUEUR (2026-08-16, refonte)** —
  modèle Warcraft III / StarCraft II : `FogHidden` (jamais vue : noir, tuile vierge) ·
  `FogExplored` (vue autrefois, plus sous les yeux de personne : le TERRAIN est rendu
  sous un **voile sombre**, mais rien de vivant n'est servi) · `FogVisible` (dans le
  champ de quelqu'un : tout est là). ⚠ **la mémoire est par JOUEUR**
  (`GameState.Explored`, un bitset par identifiant — jamais sur le réseau : `[]bool`
  pèserait ~90 ko par joueur et par requête sur une carte 134²) ; `ClientViewFor(playerID)`
  remplace `ClientView()`, et le destinataire arrive par le **ResponseWriter emballé**
  (`viewerWriter`, posé par `gameLockMiddleware`) — on ne change PAS la signature de
  `writeJSON`, dont la centralisation est ce qui garantit qu'aucun handler ne fuite ;
  un handler qui oublierait le destinataire sert la vue d'un anonyme, donc la plus
  pauvre. Le client ajoute `?playerId=` dans l'UNIQUE fonction `req` (api/client.ts).
  ⚠ **les MONSTRES ne sont servis que sur une case VISIBLE** (un souvenir qui garderait
  ses monstres mentirait sur leur position) ; les RUINES et les belvédères, eux, restent
  connus une fois repérés — un bâtiment ne se déplace pas. ⚠ **`Tile.Discovered` survit**
  avec un sens réduit (« quelqu'un l'a vue »), lu par `climb.go` et la simulation
  d'équilibrage ; les BOTS, eux, lisent leur PROPRE mémoire (`heroKnows`). ⚠ **MIGRATION**
  : une sauvegarde d'avant la refonte (`Explored == nil`) est semée une fois depuis
  `Tile.Discovered`, sinon des jours réels d'exploration disparaîtraient — mais un joueur
  qui rejoint ENSUITE part bien d'une carte noire. ⚠ **`visible` est OMIS quand il est
  faux** (280 ko de JSON économisés) : tester `!t.visible`, jamais `t.visible === false`
  — un premier jet écrivait le second et ne voilait jamais rien. Le voile est un
  **InstancedMesh de quads sombres** et non une teinte de terrain : la surface n'est
  re-maillée que quand le nombre de cases DÉCOUVERTES change, alors que la visibilité
  bouge à chaque pas — remailler la carte à chaque déplacement violerait le budget de
  `test:perf`. Garde-fou : `npm run test:fog`. Tests Go : `fogwar_test.go`.
  L'onglet Map reste **MONTÉ toute la partie** (`GameScreen` le rend en permanence avec une prop
  `active`, caché via `visibility:hidden` — PAS `display:none`) : c'est donc à **`VoxelMapView`
  d'honorer `active`** (animator coupé, cycle solaire en pause), sinon la vue travaille derrière un
  `visibility:hidden`. Tap a hero (or the **⚡ Actions**
  button) opens a **radial action menu** (Fight if monster on tile / compétence de classe / Search /
  Hide / **Escape only when Tétanisé** ; **Search/Hide cachés sur la case ville**). Combat reached
  from the map. **Le tap vise CE QU'ON VOIT** (2026-08-09) : les objets posés sur le sol (héros,
  monstres, ruines, village de la case ville) portent une étiquette `userData.pickTag {x,y,heroId?}`
  et `VoxelMapView.onTap` la préfère au terrain qu'ils masquent. Sans elle le tap était résolu par le
  seul point d'impact du rayon sur le sol : la caméra étant dimétrique à **30°**, un point à la hauteur
  `h` se projette là où le sol se trouve `h/tan(30°) ≈ 1,73` unité plus loin (sur x ET z, azimut 45°) —
  donc **cliquer le torse d'un héros touchait le sol une à deux cases derrière lui**, et le héros
  PARTAIT (case voisine) ou rien ne se passait (case en diagonale) au lieu d'ouvrir le menu radial.
  Taper un de MES héros (`heroId` posé) le vise LUI — menu s'il est sélectionné, sélection sinon — et
  ne déclenche JAMAIS un déplacement. ⚠ **UNE ÉTIQUETTE N'EST PAS UN PERSONNAGE** (2026-08-12) : les
  noms de héros, les badges ☠ de pack et le libellé « ⚔️ Combat ! » sont posés `unpicked` — le rayon
  les TRAVERSE et touche ce qu'ils recouvrent. Le nom portait l'étiquette de picking de son héros ET
  flottait à 0,82 alors qu'un héros mesure `HERO_HEIGHT` 0,6 : mesuré, la colonne de pixels au-dessus
  des pieds répondait « c'est lui » sur DEUX bandes — le corps (0-20 px) puis, détachée, la plaque de
  nom (28-36 px). Viser la case derrière un coéquipier tapait donc son nom et le sélectionnait au lieu
  de déplacer le héros actif (rapporté en jeu). Les badges de monstre se posent en plus sur la taille
  RÉELLE de la créature (`HERO_HEIGHT × mScale`) : à hauteur fixe ils s'enfonçaient dans un boss (1,8×)
  et flottaient loin au-dessus d'une limace (0,8×). Corollaire : `engine.pick` fait `scene.updateMatrixWorld(true)`
  (le moteur est on-demand ; un objet redessiné mais pas encore rendu serait resté à l'origine, donc
  invisible au picking). Garde-fou : `npm run test:map-tap` (dev servers requis).
  Le combat, lui, enregistrait déjà chaque mesh de rig dans `unitOf` — il n'était pas touché.
  Boutons de vue en haut à droite (`.view-rot`) : **🔼/🎥 vue de dessus**
  (`engine.setTopDown`, ~78° — le MÊME contrôle qu'en combat ; seule l'élévation change, azimut/zoom/
  cible conservés, on retrouve donc sa vue en ressortant) puis ↺/↻ rotation 4 orientations.
- **Cases ÉPUISÉES** (2026-08-02) : `Tile.resources` à 0 → un InstancedMesh de quads texturés « terre
  retournée » (`depletedTexture()`, un seul mesh pour toute la carte : une carte explorée peut en
  compter des milliers). ⚠ `resources === 0` seul ne veut RIEN dire — le fog renvoie une tuile
  **vierge** (donc `resources: 0` ET `biome: 0`) : le test est `discovered && resources <= 0 && biome
  !== 0 && pas la case ville`. Un aplat uniforme avait été essayé d'abord : discret il se confondait
  avec les variations du terrain, visible il noircissait la carte — d'où la texture.
- **Déplacement OPTIMISTE** (2026-08-02) : `store.move` applique le pas LOCALEMENT avant d'envoyer
  (`predictMove`, module de `store.ts`), donc l'animation de marche part au doigt et non à la réponse
  HTTP (mesuré : 0-1 ms au lieu de ~30-90 ms en local, bien pire en déploiement). `predictMove` est un
  **miroir de `game.MoveHero`** et doit le rester ; il renvoie `null` — « je ne sais pas, on attend » —
  dès qu'il y a le moindre doute, en particulier sur une case **sous le brouillard** (marcher sur de
  l'eau inconnue coûte 1 PA et laisse le héros sur place : indevinable côté client). Un compteur
  `moveSeq` ignore une réponse doublée par un pas plus récent (sinon le héros reculait), et un échec
  resynchronise par `refreshGame()` plutôt que par un rollback à la main.
- Server timer: `nextWaveAt` drives "Next wave in"; GameScreen polls every 20s so scheduler waves show up.
- **LE RÉCIT DE FIN DE PARTIE** (`components/GameOver.tsx` + `components/TownLedger.tsx`, 2026-08-11) —
  après sept à neuf jours de survie collective, l'écran de fin était un emoji, une phrase et deux
  boutons (`RETENTION-PLAN.md` R1+R2). Il porte désormais **le registre de contribution**, resté
  invisible depuis P3 : le serveur le calcule (`contribution.go`), le sérialise (`contributions`), le
  type dans `api/types.ts` — et AUCUN composant ne le lisait. ⚠ `buildLedger()` est le **MIROIR de
  `GameState.Ledger()`** : joueurs dans l'ORDRE D'ARRIVÉE (lignes à zéro comprises — leur absence
  dirait « il n'existe pas »), puis les partis triés par id ; **jamais trié par mérite, aucun total,
  aucun « meilleur joueur »** — trier installerait une compétition entre coéquipiers dans un jeu qui
  se vend sur la survie de groupe. Le même composant sert la feuille de ville (bouton « 🤝 Ce que la
  ville vous doit » du Panneau, `store.townLedgerOpen`) et le récit. L'écran annonce aussi que la
  ville **hantera les cartes suivantes** (la promesse des mémoriaux P5, tenue par le serveur et que
  personne ne disait au joueur). ⚠ **la relance ne repasse PLUS par `newGame()`** (`POST /api/games`,
  la partie solo legacy 22×22 sans joueurs) : une partie solo propose de repartir en solo, une
  expédition renvoie vers les expéditions publiques — au seul instant où l'on sait que le joueur est
  là, le jeu l'éjectait de sa propre boucle multijoueur. La carte scrolle (`max-height: 92dvh`) :
  un bouton de sortie hors de l'écran recréerait le cul-de-sac qu'on vient de supprimer. Test :
  `npm run test:endgame` (échoue 7/8 sur le code d'avant).
- **LE MOMENT DE LA VAGUE** (`components/WaveCinematic.tsx`, 2026-08-02) — la horde qui frappe était
  trois lignes de log, alors que c'est le battement du jeu ET le pire instant côté client : le serveur
  résout la vague (mesuré jusqu'à 1,3 s en local, plus en déploiement) puis des centaines de créatures
  apparaissent, ce qui alourdit la frame suivante (450-1100 ms en GL logiciel ; le redessin, lui, ne
  coûte que 1-3 ms — ce n'est PAS lui le problème). Deux temps : **frappe** (ciel rouge, « VAGUE N »
  frappé comme un tampon, secousse, −N PV) 1,6 s, puis **rapport** en carte parchemin (horde vs
  défense, PV, bâtiments et héros touchés, renforts). ⚠ **tout est en CSS pur, sur `transform`/
  `opacity`** : une animation pilotée en JS se figerait exactement à l'instant qu'on cherche à masquer,
  puisque c'est le thread principal qui maille et qui rend. Vérifié : 90 % des pixels changent entre
  deux captures prises PENDANT un blocage de 1,2 s du thread principal. Déclenchée par `refreshGame`
  (diff de `lastWave.wave`) et par `advance` (triche), et **au retour de partie** par
  `waveCinemaOnEnter` — les vagues d'une absence sont déjà dans l'état chargé, il n'y a rien à
  diffé­rencier : c'est la trace locale `echoterra:waveSeen:<gameId>` (dernière vague vue + PV de la
  ville à ce moment) qui donne le nombre de vagues manquées et le cumul de dégâts, en UNE cinématique.
  ⚠ `WaveReport.buildingsHit/heroesHit` étaient `nil` côté Go, donc `null` en JSON : lire `.length`
  dessus plantait le rendu (et, dans `refreshGame`, l'exception avalée par le `catch` sautait le
  `renderMap()`). Les slices sont désormais initialisées côté serveur, et le client garde un `?? []`
  pour les rapports déjà enregistrés. ⚠ **IL FAUT TOUJOURS UNE SORTIE** : une ville TOMBÉE n'affichait
  que la ligne « La ville est tombée » sans aucun bouton — or la cinématique passe au-dessus de tout
  (`--z-modal-top`, donc au-dessus de `.gameover` à z-index 80) : le joueur restait bloqué sur son
  rapport, sans retour au menu ni nouvelle partie (rapporté 2026-08-11). Le bouton est désormais
  INCONDITIONNEL (« Voir le bilan » / « Continuer ») et Échap ferme aussi.
- **LE RATTRAPAGE NE SE JOUE PAS SOUS LES YEUX DU JOUEUR** (`game.CatchUpPending` → payload `catchUp`,
  boucle dans `store.refreshGame`, 2026-08-11) — une requête de jeu ne rejoue qu'un petit nombre de
  vagues (`game.RequestBudget` : quelqu'un attend la réponse), donc au retour d'une absence il en
  reste, et le seul relanceur était le sondage de 20 s de `GameScreen` : la ville se faisait frapper
  **une vague toutes les 20 secondes**, minuteur figé à 0, une cinématique à chaque fois. Le serveur
  DIT désormais son retard — `ClientView` pose `catchUp` (dérivé : « une vague est due et n'a pas été
  rejouée », donc rien à mémoriser ni à invalider, et rien de persisté) — et le client enchaîne les
  tours en **accumulant** : une seule cinématique à l'arrivée, avec le cumul des vagues et des dégâts
  (même règle qu'au retour de partie). ⚠ **la boucle tourne sur `POST /{id}/catchup`, pas sur l'état
  complet** : une carte explorée pèse des centaines de ko, et la retélécharger à chaque tour coûterait
  des mégaoctets sur un téléphone pour n'afficher qu'UN rapport ; l'état complet n'est rechargé qu'aux
  deux bouts (test dédié). La route échoue-t-elle (front du CDN plus récent que le backend) qu'on
  retombe sur l'ancienne boucle en `getGame`. ⚠ **borne dure** `CATCHUP_MAX_ROUNDS` : `catchUp` ne
  retomberait jamais si l'intervalle de vague était réglé plus court que le temps d'une requête, et le
  client sonderait sans fin. La boucle s'arrête aussi en entrant en combat et sur erreur réseau —
  sinon `catchingUp` restait vrai SANS plus personne pour sonder. Pendant ce temps la TopBar affiche
  « ⏳ Rattrapage… » au lieu d'un minuteur à 00:00 qui ne veut plus rien dire. Tests :
  `game/sim_test.go`, `api/catchup_test.go`, `frontend/tests/reconnect.mjs` (`npm run test:reconnect`).

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
détecte les déplacements (lerp de pose + arc → walk), joue les one-shots. **QUI PILOTE LES FRAMES
(2026-08-02, cadencé le 2026-08-09)** : la boucle réarmait « tant qu'il reste une unité » — or l'idle
(respiration) ne s'arrête jamais, donc la CARTE rendait ~35 fps en continu dès qu'un héros existait,
c'est-à-dire toujours (batterie sur téléphone, et contrat « carte 100 % on-demand » rompu ; les nuages en
avaient déjà été retirés pour ça). La réponse d'alors — la carte en pur CONSOMMATEUR de frames — a
**figé les monstres** : sur une carte au repos, plus rien ne remuait. D'où un **CADENCEUR D'IDLE**
(`UnitAnimator({idleFps})` + `setIdleFps`, réglage `settings.idleAnimFps` — Paramètres → « Animation des
personnages » : Figée 0 / Éco 8 / Fluide 15 [défaut] / Max 30, appliqué aux TROIS vues) : à **0** la
boucle ne tourne que tant qu'il se PASSE quelque chose (un pas / un one-shot / une mort) et les poses
sont rafraîchies par `pose()` branché sur `engine.onBeforeFrame`, donc sur les frames que d'AUTRES
demandent ; **au-dessus**, l'idle réarme la boucle mais au rythme demandé (`setTimeout` entre deux rAF),
pas à la fréquence de l'écran — un rendu on-demand qui reste on-demand, où l'on choisit combien de
redraws/s la respiration a le droit de coûter. ⚠ le cadenceur ne borne QUE l'idle : un pas, une attaque,
une mort gardent le plein rAF (`ensureLoop(urgent)` coupe court à l'attente). `setActive(false)` coupe
tout quand l'onglet Map est quitté. Vérifié par `npm run test:perf` (« Figée » = 0 redraw en 3 s ;
cadence tenue sous son plafond ; 0 redraw hors de l'onglet même animation active). ⚠ **la MÉTÉO d'un
thème** (`voxel/weather.ts`, §5) rejoue exactement ce contrat sur son propre réglage
(`settings.weatherFps`, Paramètres → « Effets de météo ») — à ceci près qu'à « Aucun » elle ne se fige
pas, elle n'est pas CONSTRUITE ; et `test:perf` coupe désormais les DEUX réglages avant de mesurer la
carte au repos, `newGame()` tirant une expédition au hasard donc une carte sur trois avec météo. ⚠ le budget de perf compte `engine.frames` (un par REDRAW) et non
`renderer.info.render.frame` (un par appel GL) : depuis que le mode beauté est le défaut, la passe bloom
fait ~17 appels pour un seul redraw. `CharLibrary.makeRig(key)` (géométries découpées en cache) +
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
dans `loadSettings` qui bascule les installs déjà sauvegardées une fois (opt-out ultérieur respecté). ⚠ **PAS DE QUASI-NEUTRE SUR UNE GRANDE SURFACE VOXEL** (2026-08-10) : `shade()` de
`scripts/voxel/gen-props.mjs` est DIVISIONNISTE (il écarte la teinte pour faire vibrer la matière).
Sur une couleur franche c'est le but ; sur un quasi-neutre il n'y a pas de teinte où aller et le
résultat bascule dans le VIOLET — mesuré, un chaume « lin » [226,220,200] (chroma 26) ressort lilas
[197,169,232]. Les toits qui marchent sont à chroma ≥ ~40. Un blanc pur reste possible en petite
touche via `g.box` direct, qui ne passe pas par `shade`. Au passage `sharp` n'est plus importé qu'à
la demande (il ne sert qu'aux aperçus PNG ; son absence faisait échouer toute la génération).

**UNE TAILLE SE MESURE — l'audit des proportions** (`frontend/tests/proportions.mjs` →
`asset-index/PROPORTIONS.md`, 2026-08-17) — troisième fois que « c'est trop gros » arrive du jeu (le
saguaro plus grand qu'un sapin, le vire-vent à la taille d'un héros, et l'audit qui a suivi), donc
l'outil existe. ⚠ **LE REPÈRE EST LE HÉROS** : `CharLibrary` normalise chaque personnage à
`HERO_HEIGHT` 0,6 unité, donc un héros mesure exactement 0,6 tuile ; s'il représente un humain d'≈1,7 m,
**1 tuile ≈ 2,83 m** et tout objet se discute en mètres. ⚠ **on mesure la SCÈNE, pas les tables** :
la taille à l'écran est le produit du remplissage du modèle dans sa grille × l'échelle de pose ×
les coups de pouce (`TREE_IDS` ×1,6, `fitScale` de la ville, échelle par espèce des monstres) — aucun
des facteurs ne se lit dans le fichier de l'autre. L'outil parcourt les trois vues et lit les
**matrices d'instance** ; c'est pour ça que les vues posent un `mesh.name` / `rig.root.name` sur ce
qu'elles instancient (une scène anonyme n'est pas auditable). Ce que la première passe a trouvé, et qui
était invisible en lisant le code : une **pâquerette de 3,85 m** en ville (la végétation y est mise à
l'échelle par son EMPRISE AU SOL, or une fleur n'occupe presque rien dans sa grille → le facteur
explose et la hauteur va taper le plafond par défaut `emprise × 1,6` ; d'où `DECOR_HMAX`, un plafond
ABSOLU par prop), le **même asset dix fois plus grand en ville que sur la carte**, des **arbres plus
bas qu'un héros** (frost-tree 0,95 m, olive 1,12 m — ils n'étaient pas dans `TREE_IDS`) et une **arche
en ruine de 0,99 m** sous laquelle personne ne peut passer (les trois types de ruine partageaient une
échelle unique alors qu'une arche est haute et une dalle plate → `RUIN_SCALE`). ⚠ la fourchette
attendue (`EXPECTED`) est un choix d'ART DIRECTION, pas une vérité : quand une ligne sort, c'est
l'occasion de décider si c'est l'asset ou l'intention qui est fausse — et le VERDICT se juge sur le
plus GRAND exemplaire, jamais sur le plus petit (le scatter tire une échelle par pied, donc juger sur
le minimum flagge la variété : un premier jet mettait ainsi le sapin au piquet).

**Détails du monde** (`WORLD-DETAILS-PLAN.md`, lots D1+D2 faits
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
- **Ordre d'itération = état** : toute boucle sur une map (`g.Monsters`, `g.Combats`) qui MUTE l'état ou
  consomme du hasard doit être TRIÉE (par position — les id sont des UUID, les trier ne fixe rien).
  L'architecture entière repose sur « rejouer le temps écoulé » (`sim.go`) : deux instances rejouant la
  même période doivent aboutir au même monde. Deux fuites corrigées le 2026-08-09 (fusion des packs en
  migration, `EnforceCombatTimers`) ; la même graine pouvait tomber vague 13 ou vague 19.
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
3. ✅ Combat **Defend/Guard** action (3rd button on mockup page 3) — LIVRÉ au lot C3 : action `defend`
   pour TOUS (état `Bouclier`, −50 % subis jusqu'au prochain tour, termine le tour), bouton 🛡️ de la
   barre de combat. (La Posture défensive du Gardien reste sa version « compétence de classe ».)
3b. ✅ **Lobby multijoueur** (créer / rejoindre par code / attente `minPlayers` / lancement hôte,
   persisté SQLite) — DONE (2026-07-06, voir `journal.md`). ✅ Ownership serveur des héros par joueur,
   quitter/expulser un joueur, purge des salons abandonnés (même jour). ✅ 2026-07-07 : 1 joueur =
   3 héros (équipes), spawns initiaux ∝ nombre de joueurs (au lancement), verrous par partie.
   Restent : reconnexion sans localStorage, présence en ligne, hordePower ∝ joueurs.
4. ✅ **Building skills** — REFORMULÉ ET LIVRÉ (2026-08-10) à la demande de l'utilisateur : plutôt que
   N compétences par bâtiment, on garde **trois niveaux maximum partout** et on AJOUTE des bâtiments —
   cinq bâtiments de spécialité (Infirmerie, Cartographe, Armurerie, Verger, Caserne), chacun sur un
   axe que rien d'autre ne couvre, rendus rares par un prérequis + un plan qui ne tombe que des
   ruines. Le catalogue passe de 11 à 16 : aucune ville ne peut tout avoir, donc il y a des priorités
   à arbitrer. Voir §5 « LES CINQ BÂTIMENTS DE SPÉCIALITÉ ».
4b. ✅ **Design JSON du Studio implémenté** (2026-07-14, `design.go`) : terrains data-driven (fouille pondérée,
   richesse), 11 espèces avec grilles d'attaque GDD en combat iso + spawn par biome + loots pondérés + boss
   vague 4+, bâtiments (matériaux par niveau, prérequis, défense/capacités par niveau, revive Townhall,
   Workshop −1 PA chantiers, puits 2j×héros), 26 recettes gatées par niveau de bâtiment, classes (requires,
   apparences, passifs récolte/vision, Tir précis, skills iso), mapgen 60×60 lissé. Le « moral de la
   ville » de la déco a été REMPLACÉ (2026-08-16) par LA FAVEUR DES DIEUX (`mythic.go`, §5) : un moral
   qui n'aurait été qu'un multiplicateur invisible n'aurait rien donné à décider, une faveur qu'on vote
   au Temple, si. Restent du design : Poussée du Survivant (pionnier), Éclairer (éclaireur iso), faim
   (les objets, eux, se consomment vraiment depuis `items.go`).
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
