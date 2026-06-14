# Echo Terra — Prototype (vertical slice)

Jeu coopératif multijoueur **asynchrone** (façon *Hordes/Die2Nite* pour la carte, *FFTA2*
pour le combat). Ce dépôt contient une **tranche verticale** jouable : carte globale en
cases → combat isométrique sur une case occupée par un monstre → retour à la carte, avec
état **autoritatif côté serveur**.

## Stack

| Couche | Techno |
|---|---|
| Frontend | React + Vite + TypeScript, **Phaser 3** (carte orthogonale + combat isométrique) |
| État front | Zustand + un petit event bus (React ↔ Phaser) |
| Backend | **Go** (chi), REST, état sérialisé en JSON |
| Persistance | **SQLite** pur-Go (`modernc.org/sqlite`, sans CGo) — migrable vers PostgreSQL |
| Génération de carte | Bruit de Perlin → biomes par seuils (porté du GDD) |

## Prérequis

- Go ≥ 1.26
- Node ≥ 20

## Lancer

### 1. Backend (port 8080)

```powershell
go -C backend run ./cmd/server
# variables optionnelles : ECHOTERRA_ADDR (def :8080), ECHOTERRA_DB (def echoterra.db)
```

### 2. Frontend (port 5173)

```powershell
cd frontend
npm install   # première fois
npm run dev
```

Ouvre http://localhost:5173 (Vite proxifie `/api` vers le backend).

## Interface (shell mobile-first)

L'app s'affiche dans un **cadre téléphone** (~390px) centré sur PC, plein écran sur mobile.

- **Démarrage** : chargement → titre (Start the game / Ranking / Achievement / Parameter) → cinématique → jeu.
- **Settings** (icône ⚙️ ou *Parameter*) : Setting (volume, FPS, qualité), Language (8 langues), Notifications. Persistés en `localStorage`.
- **Barre de navigation** (bas) : **Home** (la Ville : bâtiments cliquables + menu contextuel, wave timer, Shinki, chips héros), **Map** (la carte Phaser + combat iso), **Stock/Structure/Craft** (stubs en attendant les maquettes).

Code shell : `src/screens/*`, `src/components/*`, `src/tabs/*`, `src/settings/*`, `src/data/buildings.ts`,
état dans `src/store.ts` (`appScreen` / `tab` / `settings`).

## Système de vagues (façon Hordes)

- La horde attaque la ville à intervalle réel **`nextWaveAt`** (côté serveur ; le client n'affiche que le décompte). Défaut 10 min, configurable : `ECHOTERRA_WAVE_SECONDS`.
- **Défense** = somme des structures défensives (wall/gate/tower), pondérée par leur durabilité. La horde **croît** à chaque vague.
- Dégâts : `overflow = horde − défense`. Les défenses absorbent (et s'usent) ; le surplus retire des **PV à la ville** et **endommage des bâtiments**.
- Les héros **hors de la ville** sont attaqués individuellement (PV + état *Blessé*) ; ceux **en ville** sont protégés.
- De nouveaux **monstres spawnent** sur la carte après chaque vague.
- **Game Over** si les PV de la ville tombent à 0 (`status: "gameover"`).
- Endpoints : la vague se résout à l'accès (`GET`/actions) et via un **scheduler** serveur (15s) ; `POST /town/action` (PA), `POST /advance` force une vague (test). UI : indicateur PV ville (TopBar), panneau **État de la ville** (PV, défense, prochaine vague, dernier rapport), écran **Game Over**.

## Actions sur la carte (Hordes)

Toutes les actions du héros passent par un **menu unique** : tape le héros sur la carte (ou le bouton **⚡ Actions**). Les contrôles Map ne gardent que le **déplacement** (flèches) + **⚡ Actions** + **🌊 Forcer vague** (dev).
- **Fight** (si un monstre est sur la case) → combat isométrique.
- **Search** → fouille (1 PA ; désactivée si le héros est *Tétanisé*).
- **Hide** → le héros se dissimule : **épargné par la prochaine vague** (concealment consommé), 1 PA.
- **Escape** → ne s'affiche **que si le héros est *Tétanisé*** ; repli d'une case vers la ville (1 PA, 25 % de trébucher → *Blessé*).

**Tétanisé** (GDD) : un héros entouré d'un pack de **2+ monstres** est bloqué (aucun déplacement) tant que les héros présents ne suffisent pas à le tenir — *joueurs requis = ceil(monstres ÷ 4)* (constante `heroesPerPack`, un **Gardien comptera pour 3** plus tard). Il s'en sort en **tuant** le monstre (Fight) ou en **fuyant** (Escape). Les packs de horde grossissent avec les vagues, donc l'état émerge naturellement.

## Boucle de jeu (slice)

1. **Nouvelle partie** : génère un monde (Perlin → biomes), une ville au centre d'une plaine,
   3 héros et quelques monstres autour.
2. **Déplacement** : flèches du HUD ou clic sur une case adjacente (1 PA/case). Les cases
   atteignables sont surlignées en jaune.
3. **Fouille** : bouton *Fouiller* — loot selon le biome, décrémente les ressources de la case.
4. **Combat** : place un héros sur une case avec un monstre (point rouge) → *Combattre* →
   scène isométrique tour par tour (déplacement façon FFTA2 avec hauteurs, attaque + compétence,
   états Stun/Root, initiative par agilité). Victoire → le monstre disparaît de la carte.
5. **Avancer** : simule la demi-journée suivante (régénère les PA, +1 vague/jour).

## Tests

```powershell
go -C backend test ./...        # worldgen + résolution de combat
cd frontend; npx tsc -b         # typecheck
```

## Architecture

```
backend/
  cmd/server/main.go            bootstrap (router + db)
  internal/
    api/        handlers REST (chi), vue de combat pour l'UI
    game/       domaine: hero, world, actions (déplacement/fouille/advance), combat iso
    worldgen/   Perlin → heightmap → biomes, fabrique de partie
    store/      persistance SQLite (état JSON)
frontend/src/
  api/          client REST + types (miroir des DTO Go)
  store.ts      zustand: orchestration + appels REST
  eventBus.ts   pont React ↔ Phaser
  game/         MapScene (orthogonal), CombatScene (isométrique), render helpers
  components/   Hud (héros, actions, combat, journal)
```

## Assets

Le rendu actuel utilise des **placeholders programmatiques** (formes/couleurs par classe et
espèce). Le pipeline est prêt pour un **swap vers de l'art généré par IA** : une fois un
connecteur d'image branché, un script générera les sprites (clés d'asset identiques → bascule
transparente). Voir le plan dans `.claude/plans/`.

## Prochaines étapes (hors slice)

- Connecteur image IA + génération des sprites héros/monstres/tuiles.
- Scheduler réel des vagues (13h / 1h) au lieu du bouton *Avancer*.
- Multi-héros en combat, comptes joueurs, persistance multi-session.
- Migration SQLite → PostgreSQL pour le multijoueur à l'échelle.
