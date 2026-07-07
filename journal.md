# Journal de développement — Echo Terra

> **But** : journal inter-sessions pour Claude (et Guillaume). Chaque session de travail ajoute une
> entrée en HAUT : date, ce qui a été fait, ce qui est **fonctionnel (vérifié)**, ce qui reste à faire.
> Le `CLAUDE.md` reste la référence des systèmes ; ce journal trace l'historique et l'état d'avancement.

---

## 2026-07-07 (2) — Bots : l'hôte ajoute des joueurs-IA qui agissent comme des joueurs

### Fait
- **Ajout de bots en lobby** (`lobby.go`) : `Player.Bot bool` ; `AddBot(hostID, now)` (hôte uniquement,
  nom du pool `botNames` — Marcel, Odile, Gustave… — suffixe "II" si collision). Un bot est un joueur
  normal : équipe de 3 héros, compte pour `minPlayers`/`maxPlayers` (un hôte seul + 1 bot peut lancer
  une partie min 2), expulsable via kick. Route `POST /{id}/bots` `{playerId}` → `{game, player}`.
- **Moteur de comportement** (`bots.go`) : `BotAct()` = au plus UNE action par héros bot par appel,
  cadencé par le scheduler (1 action/héros/minute → la journée d'un bot s'étale au lieu de brûler ses
  6 PA d'un coup). Priorités par héros : ① boule de feu sur un pack sur SA case ou s'il est Tétanisé
  (se libérer) ; ② blessé (<40 % PV) ou plus assez de PA pour rentrer → retraite vers la ville, et à
  1 PA loin de tout → se cacher avant la vague ; ③ en ville : puiser sa ration d'eau si Soif, déposer
  son butin en Banque, terminer/démarrer un chantier si la Banque le permet, réparer un bâtiment sous
  50 % de durabilité (dès le départ ils réparent Muraille 20/100 et Porte 40/100 — vérifié), sinon
  repartir récolter ; ④ sur le terrain : fouiller la case si elle a des ressources, sinon marcher vers
  la ressource découverte la plus proche (contournement des packs : les 4 directions sont classées par
  distance résultante, jamais de case à monstres sauf destination). Tout passe par les actions
  publiques validées (MoveHero/SearchTile/TownAction/FireballHero/…) — mêmes règles que les humains.
- **Fix deadlock** : `POST /{id}/join` passait par le middleware de verrou ET `s.join` reprenait le
  même mutex (non réentrant) → gel. Corrigé : `join` ne verrouille plus ; `joinByCode` (hors
  middleware) prend le verrou explicitement.
- **Frontend** : bouton "🤖 Ajouter un bot" (hôte, salle d'attente, grisé si complet), icône 🤖 dans la
  liste des joueurs, expulsion ✕ des bots, `Player.bot` dans les types, `api.addBot`, `store.addBot`.

### Fonctionnel (vérifié)
- `go test ./...` OK — nouveaux tests `bots_test.go` : AddBot hôte-seulement + compte pour le start,
  fouille sur le terrain, dépôt + ration d'eau en ville, retour quand PA == distance, cachette à 1 PA,
  boule de feu sur pack, les héros humains ne sont JAMAIS pilotés par `BotAct`.
- E2E serveur réel : refus d'ajout par un invité · "Gustave" (bot, 3 héros) · kick d'un bot (retire
  ses 3 héros) · join par code OK (deadlock corrigé) · 4 joueurs (dont 1 bot) → 12 héros, 10 packs ·
  après ~1 min les héros bots ont agi (PA 6→5 : réparation des défenses endommagées).
- `tsc -b` + `npm run build` OK.

### À faire / limites connues
- Bots v1 = mode carte uniquement : pas de combat iso (ils nettoient à la boule de feu), pas de craft,
  pas d'évolution de classe aux jours 2/4. À ajouter (auto-résolution de combat = le gros morceau).
- Les bots n'agissent que si la partie est en cache (scheduler) — après un redémarrage serveur, ils
  reprennent au premier chargement de la partie (même limitation que les vagues, rattrapage lazy).
- Le rythme (1 action/héros/min) est fixe ; pourrait dépendre de `ECHOTERRA_WAVE_SECONDS`.

---

## 2026-07-07 — 3 héros par joueur, spawns proportionnels aux joueurs, verrous par partie

### Fait
- **1 joueur = 3 héros** (demande du jour) : `HeroesPerPlayer = 3` ; `Player.HeroIDs []string`
  (remplace `HeroID`) + `Player.OwnsHero`. `AddPlayer` spawn une ÉQUIPE de 3 héros en ville : le 1er
  porte le nom du joueur, les 2 autres piochent dans `companionNames` (pool de 12, cyclé sur le nombre
  total de héros) ; stats du pool GDD cyclées par index de héros. `RemovePlayer`/`KickPlayer` retirent
  toute l'équipe. Le dépôt de banque multijoueur vide les sacs de TOUTE mon équipe en ville
  (`DepositHeroLoot(only []string)`).
- **Spawns de monstres ∝ joueurs** : le seeding initial quitte `worldgen` →
  `game.SeedStartingMonsters(players)` appelé AU LANCEMENT (`StartGame`), quand le nombre de joueurs
  est connu : `packs = 4 + 2*(joueurs-1)` (solo 4, 4 joueurs 10), taille des packs `+rand(joueurs)` si
  multi. Un lobby n'a AUCUN monstre avant le lancement. `worldgen.NewGame` (solo legacy) seed pour 1
  joueur (comportement identique à avant : 3 héros, 4 packs).
- **Verrous par partie** : `Server.locks map[gameID]*sync.Mutex` + `lockGame(id)` ;
  `gameLockMiddleware` sérialise TOUTES les requêtes `/{gameID}` (même les GET, qui mutent via le
  catch-up des vagues) ; le scheduler de vagues et le `lobbyJanitor` prennent le même verrou ;
  `join` (par code) verrouille lui-même. Fini les mutations concurrentes non protégées.
- Frontend : `Player.heroIds: string[]`, `myHeroIds()`/`ownsHero` par équipe, `adoptGame` sélectionne
  le 1er héros de MON équipe, `townWorkerId` choisit un de MES héros en ville (respecte `townHeroId`
  s'il est à moi), textes lobby ("3 héros par joueur", compteur de héros au départ).

### Fonctionnel (vérifié)
- `go test ./...` OK (tests mis à jour équipe de 3 + nouveau `TestStartingMonstersScaleWithPlayers`).
- `tsc -b` + `npm run build` OK.
- E2E serveur réel : solo legacy 3 héros/4 packs · lobby 0 monstre avant start · 3 joueurs → 9 héros
  (Guillaume+Brisa+Cael / Bob+Ewen+Fara / Carl+Hilda+Ilan) et 8 packs au lancement · Bob contrôle ses
  3 héros, Guillaume rejeté sur un héros de Bob · 30 requêtes concurrentes (GET + advance) sans panic
  ni corruption d'état.

### À faire / limites connues
- Reconnexion sans localStorage (retrouver son `playerId` par nom ?) ; présence en ligne ; pas de push
  (poll 3 s).
- UI : griser/distinguer visuellement les héros des autres joueurs sur la carte et les chips.
- Équilibrage : `hordePower` des vagues ne dépend pas (encore) du nombre de joueurs — seulement le
  seeding initial. À considérer.

---

## 2026-07-06 (2) — Ownership des héros, quitter/expulser un joueur, purge des salons

### Fait
- **Ownership serveur des héros** (`lobby.go` `CheckHeroOwnership`, api `ownHero`/`decodePlayer`) :
  toutes les actions héros (`move/search/hide/escape/fireball/evolve/combat start`) + le worker de
  ville (`town/action`, `town/craft`) + les unités héros en combat (`combat/action`) exigent le
  `playerId` du propriétaire dans les parties multijoueur. Les parties legacy (0 players, "Test
  rapide") restent sans restriction. `town/deposit` en multijoueur ne dépose QUE le sac de SON héros
  (`DepositHeroLoot(heroID)` filtré ; `""` = tous, comportement solo conservé).
- **Quitter / expulser** : `RemovePlayer` (lobby uniquement, retire joueur + héros, transfert du rôle
  d'hôte au suivant), `KickPlayer` (hôte uniquement, pas soi-même). Routes `POST /{id}/leave`
  (`{playerId}` → le salon vidé est **supprimé** de la base) et `POST /{id}/kick` (`{playerId,targetId}`).
- **Purge des salons abandonnés** : goroutine `lobbyJanitor` (au démarrage puis toutes les 10 min)
  supprime les lobbies jamais lancés créés il y a plus de 24 h (`lobbyTTL`) ; `store.Delete(id)`.
- **Frontend** : `playerId` envoyé sur toutes les actions (client.ts) ; garde `ownsHero` dans le store
  (feedback immédiat "ce héros appartient à un autre joueur" sans aller-retour serveur) ; en
  multijoueur le worker de ville = TOUJOURS mon héros (`townWorkerId`) ; `leaveLobby` appelle
  l'API et nettoie le localStorage ; bouton ✕ d'expulsion (hôte) dans la salle d'attente ;
  `refreshLobby` détecte l'expulsion (retour au titre avec message).

### Fonctionnel (vérifié)
- `go test ./...` OK (nouveaux : `TestHeroOwnership`, `TestRemoveAndKickPlayer`) ; `tsc -b` + build OK.
- E2E serveur réel : kick par invité refusé / kick hôte OK (joueur + héros retirés) / bouger le héros
  d'un autre refusé / bouger le sien OK / action sans `playerId` en multi refusée / quitter une partie
  lancée refusé / dernier joueur qui quitte → salon supprimé (404 ensuite) / solo legacy sans restriction.

### À faire / limites connues
- Toujours pas de verrous par partie (scheduler + handlers) avant du vrai multi simultané.
- Unicité du `joinCode` non garantie ; pas de reconnexion par nom si localStorage perdu.
- La salle d'attente poll (pas de push) ; pas de présence "en ligne/hors ligne".
- UI : les héros des autres joueurs restent sélectionnables (lecture seule de fait — les actions sont
  bloquées) ; on pourrait griser les boutons d'action plutôt que d'afficher un message.

---

## 2026-07-06 — Lobby multijoueur : créer / rejoindre / attente / lancement (+ persistance SQLite)

### Fait
- **Backend — lobby** (`backend/internal/game/lobby.go`) :
  - `Player {id, name, heroId, host, joinedAt}` — chaque joueur possède UN héros.
  - `GameState` étendu : `name`, `joinCode` (5 car., alphabet sans ambiguïté), `minPlayers`,
    `maxPlayers`, `players[]`, `createdAt`, `startedAt`, statut `"lobby" | "active" | "gameover"`.
  - `AddPlayer(name, now)` : rejoint le salon, spawn le héros du joueur en ville (stats du pool GDD
    cyclées par ordre d'arrivée), 1er joueur = hôte. Refus si partie pleine ou déjà lancée.
  - `StartGame(playerID, now)` : hôte uniquement, exige `len(players) >= minPlayers` ; passe le statut
    à `active` et programme la 1re vague (`nextWaveAt = now + WaveInterval`).
  - Les vagues ne tournent JAMAIS en lobby (`ProcessWave`/`CatchUpWaves` gardés sur `status=="active"`).
- **Worldgen** (`worldgen.go`) : factorisation `newWorld()` ; `NewLobby(w,h,seed,name,min,max)` (monde
  généré, 0 héros, pas de vague programmée, bornes 1..8 clampées) ; `NewGame` (solo/dev legacy) inchangé
  côté comportement — 3 héros via `game.NewStarterHero`.
- **Store SQLite** (`store.go`) : `List(limit)` — liste les parties (blob JSON décodé, plus récentes
  d'abord). Sert au listing des salons ouverts et à la résolution des codes.
- **API** (`api.go`) :
  - `GET  /api/games[?status=lobby]` → résumés `{id,name,joinCode,status,players,min/maxPlayers,day,waveNumber,createdAt}`.
  - `POST /api/games/lobby` `{name?,playerName,minPlayers?,maxPlayers?,width?,height?,seed?}` → crée le
    salon + auto-join du créateur (hôte) → `{game, player}` (min défaut 2, max défaut 4).
  - `POST /api/games/join` `{code,playerName}` → rejoint par code (ou id) parmi les salons ouverts.
  - `POST /api/games/{id}/join` `{playerName}` → rejoint par id.
  - `POST /api/games/{id}/start` `{playerId}` → lancement par l'hôte.
  - `POST /api/games` (legacy solo 3 héros) conservé pour les flux dev "Test rapide".
- **Frontend** :
  - `api/types.ts` (`Player`, `GameSummary`, champs lobby sur `GameState`) + `api/client.ts`
    (`listGames`, `createLobby`, `joinByCode`, `joinGame`, `startGame`).
  - `store.ts` : `playerId` (identité par partie, localStorage `echoterra:player:<gameId>`),
    `playerName` (persisté), `lobbies[]` ; actions `openLobby / setPlayerName / fetchLobbies /
    createLobby / joinLobby / startLobby / refreshLobby / leaveLobby` ; `adoptGame()` sélectionne
    automatiquement MON héros ; "Continuer"/`enterGame` re-routent vers le salon si la partie
    sauvegardée est encore en lobby.
  - `screens/LobbyScreen.tsx` (appScreen `"lobby"`) : formulaire nom du joueur + carte "Créer"
    (choix joueurs minimum) + carte "Rejoindre" (code + liste des salons ouverts, poll 5 s) ; salle
    d'attente : gros code copiable, liste des joueurs (👑 hôte, slots vides), compteur `n/min`,
    bouton "⚔️ Lancer la partie" (hôte, grisé sous le minimum), poll 3 s — les invités basculent en
    jeu automatiquement quand l'hôte lance.
  - `TitleScreen` : bouton "🌐 Multijoueur" ; `App.tsx` rend `LobbyScreen` ; styles `lobby-*` dans
    `app-shell.css`.

### Fonctionnel (vérifié)
- `go test ./...` : tous les tests passent (nouveaux : `lobby_test.go` — join/host/min/max/start,
  vagues inertes en lobby ; `worldgen` NewLobby + clamp ; `store` round-trip Save/Load/List).
- `npx tsc -b` et `npm run build` : OK.
- **E2E contre le vrai serveur** : créer lobby → start prématuré refusé (`1/2 minimum`) → listing →
  join par code → start par invité refusé → start hôte OK (vague programmée) → join après lancement
  refusé → legacy solo OK (3 héros).
- **Persistance** : redémarrage complet du serveur → la partie (joueurs + héros) se recharge depuis
  SQLite ; les salons ouverts restent joignables par code.

### À faire / limites connues
- **Pas de contrôle de propriété des héros** : le serveur accepte les actions de n'importe quel héros
  quel que soit le joueur (à verrouiller : passer `playerId` sur les actions héros).
- Pas d'endpoint "quitter le salon" (retirer un joueur + son héros) ni de suppression des lobbies
  abandonnés ; `leaveLobby` côté client ne fait que revenir au titre.
- Unicité du `joinCode` non garantie (résolution = salons ouverts, plus récent d'abord) ; collision
  improbable mais possible.
- Le scheduler de vagues mute les parties en cache sans verrou par partie (noté depuis le début —
  à traiter avant du vrai multijoueur simultané).
- UI : pas encore d'indication "qui est en ligne", ni de chat ; la salle d'attente poll (pas de push).
- `startTestGame`/"Test rapide" reste le flux solo 3 héros (voulu).

### Prochaines étapes suggérées
1. Ownership des héros par joueur (serveur) + UI qui limite les actions à SON héros.
2. Quitter/expulser un joueur en lobby ; nettoyage des salons morts (TTL sur `createdAt`).
3. Combat "Defend/Guard" (mockup p.3) ; skills de bâtiments multiples (p.6) ; effets bâtiments (§9 CLAUDE.md).
