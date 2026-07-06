# Journal de développement — Echo Terra

> **But** : journal inter-sessions pour Claude (et Guillaume). Chaque session de travail ajoute une
> entrée en HAUT : date, ce qui a été fait, ce qui est **fonctionnel (vérifié)**, ce qui reste à faire.
> Le `CLAUDE.md` reste la référence des systèmes ; ce journal trace l'historique et l'état d'avancement.

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
