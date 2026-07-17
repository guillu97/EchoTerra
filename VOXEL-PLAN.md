# Plan — Passage de la carte en voxels (moteur unique Home / Map / Combat)

> Rédigé le 2026-07-17. Objectif : remplacer le rendu iso 2D (Phaser + canvas2d du Home) par un
> **moteur voxel 3D unique** (Three.js, caméra orthographique dimétrique) couvrant les trois vues,
> avec **rotation de caméra 4 orientations**, des **blocs voxel générés localement** (sans ComfyUI,
> inspirés des `isotiles/` existants), des **personnages d'abord en images (billboards) puis en
> voxels**, et des **déplacements sans animation, case par case** (snap sur l'état serveur).

## Principes directeurs

- **Un seul moteur** pour Map monde, Combat iso et Home ville → un seul contexte WebGL (contrainte
  mobile), meshing/contrôles/rotation mutualisés. Phaser sort du projet en fin de plan (~−1,2 Mo).
- **Les données ne bougent pas** : grilles (x, y, hauteur) côté serveur, `town-map.json` côté Home.
  Seul le rendu change. La rotation est purement caméra — aucune donnée n'est transformée.
- **Mobile d'abord** : instanciation (transposition directe de `ensurePillarAtlas`), rendu
  **on-demand** (pas de boucle rAF permanente — batterie), DPR plafonné 3, budgets `test:perf`
  étendus au chemin voxel.
- **Transition sous flag** : l'ancien rendu reste le fallback jusqu'à parité vérifiée, vue par vue.

### Correspondance pipeline actuel → voxel (les acquis se transposent)

| Aujourd'hui (Phaser / canvas2d)                  | Demain (Three.js)                                  |
|--------------------------------------------------|----------------------------------------------------|
| Atlas de piliers `biome:h` cuit une fois         | Géométrie greedy-meshée par type de bloc, une fois |
| 1 Image par tuile, 1 batch texture               | `InstancedMesh` : ~10–20 draw calls pour 60×60     |
| Diff de `setTint` (fog / ombrage / danger)       | Attribut couleur par instance, même diff           |
| Variantes de brume par hachage de position       | Variantes/rotations de bloc par hachage            |
| Projection inverse manuelle sensible à la hauteur| Raycast (plus simple et exact)                     |
| Tri de profondeur `(x+y)*100+h`                  | Z-buffer (gratuit)                                 |
| Pinch absolu depuis baseline, TAP_SLOP=10×DPR    | Même math, portée sur la caméra ortho              |

---

## Phase 0 — Générateur de blocs voxel (sans ComfyUI) `scripts/voxel/`

Le point « il faut que tu puisses le faire » : tout est du **Node pur** (pngjs), générable et
**vérifiable en session sans GPU ni ComfyUI**.

1. **`gen-blocks.mjs`** — pour chaque bloc à produire :
   - **Extraction de palette depuis les `isotiles/` existants** (55 PNG) : échantillonnage de la
     face du haut (losange) et des flancs du cube iso → palette quantifiée (~8–16 couleurs) par
     matériau. Les couleurs de la DA storybook sont ainsi héritées de l'art actuel, pas inventées.
   - **Recettes déclaratives par bloc** (un objet JS par matériau) : strates (socle terre/pierre +
     couche de surface), bruit de relief de surface (±1–2 voxels), détails scatter (brins d'herbe,
     fleurs, cailloux, congères, cristaux…) avec les couleurs d'accent de la palette extraite.
   - **Résolution paramétrable** (32³ par défaut, 64³ en option — décision D1), **3 variantes par
     bloc** (seed), déterministe.
   - **Sortie au format `.vox` MagicaVoxel** → `frontend/public/voxels/` : petit, standard, et
     retouchable à la main dans MagicaVoxel si une recette ne suffit pas.
2. **`render-preview.mjs`** — mini-rendu logiciel isométrique (projection + painter's, zéro GPU)
   → PNG de preview par bloc + **contact sheet** dans `asset-index/voxels/`. C'est l'outil de
   validation du style en session (l'équivalent voxel de `contact_sheet.py`).
3. **Catalogue** : entrées `voxels` ajoutées à `build-catalog.mjs` (id, tags, fichier, recette).
4. **Livrable** : les blocs du monde (eau, sable, herbe/prairie, forêt, montagne/pierre, neige),
   le bloc **brume** (nuage voxel, remplace les piliers de fog), et 3–4 matériaux ville
   (chemin, dallage, brique, bois) pour le Home.

**Critère de sortie** : contact sheet validée visuellement (par Guillaume) — le style storybook tient.

## Phase 1 — Moteur voxel commun `frontend/src/voxel/`

- Dépendance : `three` (~150 Ko gz). Modules :
  - `voxLoader.ts` — parseur `.vox` (format simple, pas de lib externe nécessaire).
  - `mesher.ts` — greedy meshing, **couleurs par vertex** (zéro texture), AO légère cuite au
    meshing (pas d'éclairage dynamique : il tuerait le rendu « peint à la main »). Cache de
    géométries par (bloc, variante).
  - `engine.ts` — renderer, **rendu on-demand** (invalidation sur interaction/état/transition),
    caméra **orthographique dimétrique** (même angle apparent que l'iso 2:1 actuel), DPR via
    `game/dpr.ts`, gestion perte de contexte WebGL.
  - `terrain.ts` — couche de sol en `InstancedMesh` par type de bloc, tint par instance diffé
    (fog / ombrage d'altitude / danger), re-instanciation incrémentale à la découverte (fog).
  - `controls.ts` — tap/pan/pinch en reprenant la **math absolue existante** (baseline posée au
    2e doigt, jamais de lecture caméra entre set et render, `TAP_SLOP = 10×DPR`) ; picking raycast.
  - **`rotation.ts` — la logique de rotation** : 4 orientations (0/90/180/270°). Seul l'azimut de
    la caméra tourne (petite transition animée) ; les billboards font toujours face à la caméra ;
    les overlays au sol (losanges, anneaux, grilles d'attaque) sont des quads posés sur les faces
    supérieures donc invariants ; le raycast reste correct par construction. UI : bouton ↻ (et
    geste « twist » 2 doigts en option plus tard). Orientation stockée dans le store, par vue.
- **Banc d'essai dev** : hash `#voxel-bench` — rend un 60×60 instancié avec contrôles + rotation,
  pour valider la perf **sur téléphone réel** avant toute intégration au jeu.

**Critère de sortie** : 60 fps au pan/zoom/rotation sur mobile, ≤ ~30 draw calls terrain, rendu
on-demand vérifié (0 frame rendue au repos).

## Phase 2 — Onglet Map (monde)

- `VoxelMapView` monté par `MapTab` derrière un **flag** (réglage Settings + hash dev) ;
  `MapScene` Phaser reste le fallback jusqu'à parité.
- Parité fonctionnelle :
  - **Fog serveur inchangé** (`ClientView` envoie des tuiles vierges) → instances du bloc brume,
    variante par hachage de position, respiration = modulation d'alpha/couleur d'instance (diffée,
    on-demand : l'animation n'invalide que quelques frames/s, et rien onglet caché).
  - Sélection, losanges de déplacement, **teinte de danger des packs** → quads overlay teintés.
  - Héros en ville masqués ; ville = billboard du bâtiment (modèle voxel possible plus tard).
  - Menu radial / UI React inchangés, ancrés par projection monde→écran.
- **Personnages — étape 1 (images)** : billboards des PNG chibi existants (recadrage carré
  `cropSquare` réutilisé, ancrés aux pieds), répartition sur case partagée par offsets dans la
  tuile, alpha 0.45 pour les héros des autres joueurs (toggle 👥 conservé).
- **Déplacements : sans animation, case par case** — la position snap sur l'état serveur (le
  mouvement coûte déjà 1 PA/case ; aucune interpolation pour l'instant).
- Rotation active. `tests/perf` étendu : draw calls, Mo de géométrie, temps de meshing, payload
  (les `.vox` remplacent ~17 PNG 1024² ≈ 8,5 Mo par quelques dizaines de Ko), on-demand, DPR natif.

**Critère de sortie** : parité MapScene validée sur téléphone, budgets perf verts → flag activé par défaut.

## Phase 3 — Combat iso (même moteur)

- Scène 7×7 : colonnes de hauteurs avec les **mêmes meshes de blocs** ; fond opaque conservé.
- **Grilles d'attaque GDD** : ciblage VERT relatif à l'attaquant + zone de dégâts ROUGE = quads
  overlay teintés sur les faces supérieures (le pipeline `attackTargets`/`skillTargets` du serveur
  ne change pas).
- Unités = billboards (étape persos 1) avec barres de PV ; tour par tour inchangé, déplacement snap.
- **Rotation 4 orientations FFTA2** — c'est ici qu'elle a le plus de valeur (lire les hauteurs,
  viser derrière un pilier).
- `CombatScene` Phaser conservée derrière le même flag jusqu'à parité.

**Note d'ordre (D3)** : Combat avant Home — petite scène (7×7), c'est le meilleur endroit pour
roder la rotation et les overlays de grille avant la ville, plus grosse et plus interactive.

## Phase 4 — Home (ville)

- **`town-map.json` est déjà un document voxel-compatible** : 54×59, 575 cellules occupées, et
  chaque `Cell.blocks[niveau]` est une **pile de blocs par élévation** (le format de l'éditeur).
  Le renderer voxel lit ce même export : asset isotile référencé → bloc voxel de la Phase 0
  (mapping fichier→bloc, comme `ASSET_TO_BUILDING`).
- Bâtiments et props : **étape 1 en billboards** des PNG iso existants (positions/transforms du
  doc éditeur respectés) ; **hotspots par raycast** — ce qui remplace au passage le contournement
  `setPointerCapture`/`elementFromPoint` actuel. Mêmes pastilles nom + durabilité (React ancré),
  mêmes modals/actions.
- Mes héros en ville posés sur l'herbe en billboards (même affectation par hachage d'id).
- Zoom/pan/rotation : mêmes contrôles que la Map ; fit initial auto conservé.
- **L'éditeur 2D reste l'outil de création** (son export JSON est la source) — sa réécriture
  voxel n'est PAS dans ce plan. ⚠ les crops localStorage de l'éditeur devront être **cuits dans
  l'export** pour que le rendu voxel soit identique partout (petit ajout à `editorExport.ts`).

## Phase 5 — Personnages, étape 2 : voxels

- Production des modèles : **gabarit chibi voxel paramétré** (`gen-characters.mjs` — tête/corps/
  accessoire, couleurs extraites du PNG de la classe/du monstre) pour un premier passage cohérent,
  puis retouches à la main dans MagicaVoxel (`.vox` re-déposés, le loader ne fait pas la différence).
- **Statiques** (pas d'animation squelettique) ; en 3D le modèle tourne réellement avec la caméra.
- Mapping `appearance.map` (classe/espèce) → modèle voxel, **fallback billboard** si le modèle
  n'existe pas encore → bascule progressive, héros par héros, monstre par monstre.
- Déplacements toujours snap case par case (l'animation de marche est un chantier ultérieur).

## Phase 6 — Bascule finale & nettoyage

- Flags retirés ; **Phaser désinstallé** (MapScene, CombatScene, PhaserGame supprimés ; ~−1,2 Mo
  de bundle, `textureUtils` conservé tant que des billboards restent).
- Budgets perf consolidés, `CLAUDE.md` §7 réécrit, `journal.md` à jour.

---

## Décisions à trancher (avant/pendant Phase 0–1)

- **D1 — Résolution des blocs : 32³ ou 64³.** Le générateur est paramétrable ; on tranche sur la
  contact sheet + le banc de perf (64³ ≈ 4–8× plus de triangles ; l'instanciation absorbe, mais le
  style chibi lit souvent mieux en 32³, et 64³ reste dispo pour les blocs « héros » type cristal).
- **D2 — Meshing runtime vs build** : runtime recommandé (quelques ms/bloc, fichiers `.vox`
  minuscules, pas de pipeline glTF à maintenir).
- **D3 — Ordre Combat avant Home** : recommandé (voir Phase 3) — c'est l'ordre de ce plan.
- **D4 — Emplacement du flag** : réglage Settings (+ hash dev) recommandé.

## Estimations (ordres de grandeur, sessions de travail)

| Phase | Contenu | Estimation |
|---|---|---|
| 0 | Générateur de blocs + previews | 2–4 j |
| 1 | Moteur + rotation + banc d'essai | 4–6 j |
| 2 | Map monde (parité + fog + persos images) | 5–8 j |
| 3 | Combat iso | 4–6 j |
| 4 | Home ville | 3–5 j |
| 5 | Personnages voxel | 4–8 j |
| 6 | Bascule & nettoyage | 1–2 j |

Chaque phase se termine par un état **poussable et jouable** (les flags garantissent qu'aucune
phase ne casse le jeu existant).
