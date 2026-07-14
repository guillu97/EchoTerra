# Journal de développement — Echo Terra

> **But** : journal inter-sessions pour Claude (et Guillaume). Chaque session de travail ajoute une
> entrée en HAUT : date, ce qui a été fait, ce qui est **fonctionnel (vérifié)**, ce qui reste à faire.
> Le `CLAUDE.md` reste la référence des systèmes ; ce journal trace l'historique et l'état d'avancement.

---

## 2026-07-14 (13) — Le design JSON du Studio implémenté dans le jeu (sauf PA des bâtiments)

### Fait
- **`design.go`** : tout le game-design du Studio en données Go — terrains (fouille pondérée + richesse),
  **11 espèces** (harpies prairie/givre, dryade, araignée cristalline, loup-garou, chauve-souris + BOSS
  Roi Gobelin & Arbre Vivant Ancien) avec **grilles d'attaque GDD** (`AttackDef.Targets/Damage` + effets
  structurés : Stun %, Root, Absorbe, Bouclier -50%, buff d'alliés), niveaux de bâtiments (matériaux par
  niveau avec Planche/Corde/Brique/Acier/Cœur de chêne, prérequis d'arbre techno, défense/capacités par
  niveau), et le maintien volontaire des PA de chantier actuels (`buildPA`, exception demandée).
- **Fouille** : tirage pondéré de la table du biome ; passifs Récupérateur (+1), Herboriste (+1
  plante/minerai) ; Éclaireur vision +1 ; **Tir précis** du Chasseur (map, 1 PA, route `/snipe`, 🏹).
- **Monstres** : spawn par biome d'apparition, packs [min,max] du design, **boss à partir de la vague 4**,
  loot de victoire pondéré par espèce (chaque héros tire ; Récupérateur +1 trophée), `appearance` servi
  au client (sprites mob-* sur carte ET en combat).
- **Combat iso data-driven** : IA monstre par grilles (spéciales ~35%), zones de dégâts appliquées autour
  de la case touchée, Root consommé au tour de la victime (pas de déplacement), Bouclier jusqu'au tour
  suivant ; skills de classe des héros (Frappe +5, **Tir de zone** portée 3 en croix, **Posture
  défensive** auto-ciblée depuis l'UI) ; `combatResponse` sert les cibles calculées sur les grilles.
- **Bâtiments** : prérequis vérifiés à la pose du plan (🔒 affiché), Workshop niv.2 = chantiers −1 PA,
  capacités par niveau (puits 50/75/112, banque 500/750/1125), **puits initial = 2 rations × héros**,
  niveau max 3, **revive du Townhall réel** (quota = niveau, niv.3 gratuit/illimité, bouton Home).
- **26 recettes** gatées par bâtiment+niveau (Kitchen 2 = plats raffinés, 3 = Ambroisie ; Workshop 2 =
  Acier/équipements, 3 = Talisman/Amulette), sorties multiples (Planche/Brique ×2), effets affichés.
- **Classes** : requires d'évolution (gardien←pionnier, récupérateur←chasseur|éclaireur,
  herboriste←éclaireur) côté serveur ET picker ; apparence par classe (sprite du héros change).
- **Mapgen** : 60×60 par défaut, lissage maxStep 1 (test : aucun voisin à +2), biomes par niveau lissé,
  richesse par terrain. Bots : évolution selon la branche de classe.
- ⚠ Un redémarrage du conteneur a fait perdre l'arbre local (retour à un vieux commit) — récupéré via
  `git reset --hard origin/main` + réapplication ; rien de poussé n'a été perdu.

### Fonctionnel (vérifié)
- `go test ./...` (6 paquets) + **design_test.go** (12 tests : tables de fouille, passifs, prérequis,
  défense par niveau, workshop −1, revive, gating recettes, requires d'évolution, pools de spawn, loot
  d'espèce, grilles/Root/Bouclier en combat, rations du puits, Tir précis) + test de lissage worldgen.
- E2E UI : 26 recettes servies, Gardien requires+appearance, Ragoût verrouillé « Kitchen niv.2 », Bank
  niv.2 demande des Planches, carte 60×60, monstres avec appearance ; **combat e2e complet** : marche
  jusqu'à un Loup-garou, grilles jouées, victoire, loot « Fourrure maudite ».
- `npx tsc -b`, `npm run build`, `npm run test:perf` **13/13** (payload 22,6/24 MB avec les 6 nouveaux
  sprites, VRAM 24,3/40 MiB, carte 60×60).

### À faire
- Consommation d'objets (nourriture/potions/équipements — effets encore descriptifs), Poussée du
  Survivant, moral de la ville, faim ; sprites dédiés harpie/dryade/sanglier via ComfyUI.

## 2026-07-14 (12) — Structure groupée par état + vérification du chantier d'amélioration

### Fait
- **Onglet Structure : regroupement par état par défaut** (tri « Statut ») : **🏗️ Chantiers en
  cours** (constructions ET améliorations, triés par nom), **📐 Plans à poser**, **🏠 Construits**
  — en-têtes de section `.ps-group-h`. Les tris A-Z / Lv restent des listes plates.
- L'**amélioration suivait déjà la logique chantier** (plan 1 PA → PA à investir tant que les
  matériaux sont en Banque) — vérifiée de bout en bout dans l'UI cette fois : cliquer
  « 📐 Améliorer » sur le Wall le fait passer dans « Chantiers en cours » avec le tag
  « amélioration Lv 2 », la barre 0/30 PA et la pause matériaux.

### Fonctionnel (vérifié)
- E2E (9/9) : 3 groupes par défaut, Tower en chantier, Kitchen/Townhall en plans, 6 construits,
  Wall → chantier d'amélioration après clic (0/30 PA ⏸, bouton +N PA), chaque plan = 1 PA.
- `npx tsc -b`, `npm run build`.

## 2026-07-14 (11) — Chantiers collectifs : plan + investissement de PA gaté par les matériaux

### Fait
- **Nouveau flux de construction** (`town.go`, demande Guillaume) : ① **poser le PLAN** (1 PA,
  `planPACost`, aucun matériau) ouvre le chantier — sites ET améliorations ; ② **investir des PA**
  (`points`, borné au restant + aux PA du payeur) tant que TOUS les matériaux requis sont **présents
  en Banque** (simple gate, rien n'est consommé) — s'il en manque, refus mais **les PA investis
  restent acquis** (`TownBuilding.PaInvested`, chantier en pause) ; ③ à `PaInvested == cost.PA`,
  matériaux consommés + bâtiment construit (lvl 1) / amélioré (lvl++).
- **Coûts PA beaucoup plus élevés** (`buildPA`, effort collectif façon Hordes) : townhall 20,
  tower/wall/workshop 15, kitchen/gate/bank 12, well 10, panel 6 — × niveau visé pour les
  améliorations (matériaux × niveau aussi). `building.cost` = TOTAL du chantier, `paInvested` exposé.
- **Bots** : posent les plans des sites, investissent 1 PA/tick, rejoignent les chantiers
  d'amélioration ouverts par un humain (n'en ouvrent jamais eux-mêmes).
- **Structure (front)** : « 📐 Poser le plan » / « 📐 Améliorer » (1 PA) → **barre de progression**
  `paInvested/cost.pa` + bouton « +N PA » (PA du worker, borné serveur) ; « ⏸ matériaux manquants »
  quand la Banque ne couvre pas la liste (bouton désactivé, hint « les PA investis restent acquis »).
- **Studio** : seeds des bâtiments alignés (`seedLevels(basePA, …)` — niveau L = basePA×L PA).

### Fonctionnel (vérifié)
- `go test ./...` (6 paquets) — build_test réécrit : plan sans matériaux, invest refusé banque vide,
  PA conservés après pénurie, clamp au restant, conso des matériaux à l'achèvement, cumul multi-héros
  (7+5=12), amélioration via chantier (panel 6→12 PA lvl2).
- E2E API+UI : plan 1 PA, cost.pa=15 (tour), refus « les PA déjà investis restent acquis », rows
  Structure (en chantier 0/15 ⏸, plan à poser, 📐 Améliorer), clic « Poser le plan » ouvre le chantier.
- `npx tsc -b`, `npm run build`, `npm run test:perf` 13/13.

### À faire
- Effet Workshop lvl2 « coût PA chantiers -1 » (design) non implémenté ; hordePower ∝ joueurs.

## 2026-07-14 (10) — Studio : onglet ⛰️ Terrains + vrai onglet 📦 Ressources (catalogue) + dropdowns partout

### Fait
- **Renommage** : l'ancien onglet « 🌿 Ressources » (qui décrivait les BIOMES) devient **⛰️ Terrains**
  (`TerrainDef`, `doc.terrains`, `updateTerrain`) — praticable/fouillable, richesse min–max, table de
  fouille inchangées.
- **Nouveau vrai onglet 📦 Ressources** : le **catalogue d'objets** (`ResourceItemDef {id, name, icon,
  type, desc}`) groupé par catégories `RESOURCE_CATEGORIES` (objet, minerai, plante, animal, eau,
  aliment, consommable, arme, deco). 15 items seedés depuis les données du jeu (bois, pierre, minerai
  de fer, débris, fleur, herbe médicinale, viande, peau, trophée, ration d'eau, mapo curry, jus de
  fruit, potion de soin, lame de fer, totem de bois). CRUD + cartes centrales par catégorie.
- **Fin des inputs texte libres** : tout champ « objet » devient un **dropdown `ResourceSelect`**
  (options groupées par catégorie via `<optgroup>`) — drops des terrains, loots de monstres,
  matériaux des niveaux de bâtiments, ingrédients ET produit des recettes. Une valeur absente du
  catalogue s'affiche « ⚠ … (hors catalogue) » (rien n'est cassé, on corrige via le dropdown).
  Les terrains d'apparition des monstres viennent de `doc.terrains` (déjà des checkboxes).
- **Migrations douces** (`normalizeDoc`, load + import) : un doc/export dont `resources` contient des
  biomes (détection : champ `searchable`) est rerouté vers `terrains` (les données legacy GAGNENT sur
  le seed) et le catalogue d'items est re-seedé ; `onImport` fait le même reroutage sur les fichiers
  partiels et accepte désormais `terrains` + `mapgen`. MapGenPane/mapgen.ts consomment `doc.terrains`.

### Fonctionnel (vérifié)
- `npx tsc -b` ✓, `npm run build` ✓, `npm run test:perf` 13/13 ✓.
- E2E Playwright (17/17) : migration legacy resources→terrains (biome Forêt conservé avec ses drops,
  items re-seedés, `special`→attacks), onglets ⛰️/📦 présents, TerrainForm + dropdowns de drops avec
  optgroups, cartes ressources groupées (9 catégories), ＋ Nouveau + changement de catégorie persisté,
  RecipeForm avec 2 dropdowns catalogue, terrains cochables du MonsterForm issus de doc.terrains,
  canvas Génération rendu sur doc.terrains.

### À faire
- Implémentation serveur des JSON exportés (arbre techno, recettes/effets, classes, mapgen, grilles
  d'attaque en combat iso) quand Guillaume fournit les fichiers.

## 2026-07-14 (9) — Studio : onglet 🌍 Génération + grilles d'attaque GDD (monstres & héros)

### Fait
- **Onglet 🌍 Génération de maps** : paramètres Perlin (seed + 🎲, dimensions, échelle, octaves,
  persistance, hauteur max) + **LISSAGE** demandé — « écart max entre voisins » : abaissement itératif
  des pics jusqu'à ce qu'aucune case ne dépasse sa voisine de plus de N niveaux (N=1 → une montagne
  niv. 6 ne peut jamais toucher une plaine niv. 0 ; les biomes sont recalculés sur la hauteur lissée
  donc les transitions suivent les pentes). Seuils de biomes ajustables (ordre auto-préservé), nombre
  de packs. **Aperçu canvas 4 vues** : Terrain (relief ombré), Hauteurs, Ressources (richesse des
  tables de l'onglet 🌿), Monstres (spawns en anneaux selon les terrains d'apparition de l'onglet 👹).
  Défauts = worldgen.go (0.08/3 octaves/seuils GDD/hauteur 6). Contrainte vérifiée numériquement en
  e2e. ⚠ Perlin JS ≠ bit-à-bit go-perlin : l'aperçu montre le style, l'export pilote l'implémentation.
- **Grilles d'attaque façon GDD** (planches Harpies/Dryades) : `AttackDef {name, kind base|special,
  pa, desc, effects, targets[], damage[]}` sur les monstres (liste d'attaques remplaçant le champ
  `special`, migré par `normalizeDoc`) et `targets/damage` optionnels sur les pouvoirs `iso` des
  classes. `GridShapeEditor` 7×7 cliquable : **ciblage vert** relatif à l'attaquant ⚔️, **zone de
  dégâts rouge** relative à la case touchée 🎯 (toujours incluse), presets mêlée/portée 3/vider.
  Seeds = combat.go (mêlée pour tous ; Colonne de Vent portée 3 + Stun ; Tir de zone du chasseur avec
  dégâts en croix).

### Fonctionnel (vérifié)
- E2E : lissage maxStep 1→écart max 1, 3→2 ; 4 éditeurs de grilles sur l'élémentaire (2 attaques),
  clic d'une case de dégâts → `{dx:1,dy:0}` dans le doc ; classes : grilles uniquement sur le pouvoir
  iso. `tsc -b` + `npm run build` OK, `test:perf` 13/13.

---

## 2026-07-14 (8) — Studio de données : onglets Ressources (fouille par biome) et Monstres

### Fait
- **🌿 Ressources** : un biome = praticable/fouillable, richesse à la génération (fouilles min–max)
  et **table de fouille** en drops pondérés (`{type, name, qty, weight}` — weight = pondération du
  tirage). Seeds = `lootForBiome` + worldgen actuels (forêt : herbe/peau/bois 3–6 fouilles ;
  montagne/neige : pierre/minerai 1–3 ; eau : rien).
- **👹 Monstres** : espèce, PV, stats, taille de pack min–max, **terrains d'apparition** (checkboxes
  des biomes de l'onglet Ressources), **pouvoir spécial** de combat, **loot du pack vaincu** (drops
  pondérés) et **apparence** (asset `monsters/` avec préview). Seeds = monsters.go + `SkillFor`
  (Absorbe / Tranche vicieuse / Colonne de Vent-Stun) + trophée générique actuel.
- Store : 2 collections de plus (CRUD, export/import complet ou partiel, migration douce d'un doc
  localStorage sans ces clés) ; supprimer un biome le retire des terrains des monstres.

### Fonctionnel (vérifié)
- E2E : 6 cartes biomes, édition d'une pondération reflétée dans le doc, 3 cartes monstres avec
  sprites, « Exporter l'onglet » télécharge `echoterra-monsters-*.json`. `tsc -b` + build OK,
  `test:perf` 13/13.

---

## 2026-07-14 (7) — Studio de données : arbres techno bâtiments/craft/classes éditables + export JSON

### Fait
- **Nouvel outil dev `frontend/src/designer/`** (« 🧬 Données » sur l'écran titre, hash `#designer`),
  dans l'esprit de l'éditeur de carte : trois catalogues de game design édités visuellement et
  **exportables en JSON** (tout ou par onglet) pour me les redonner à implémenter.
  1. **Bâtiments** : arbre technologique (prérequis bâtiment+niveau, rendus en arbre SVG par colonnes
     de profondeur avec flèches étiquetées), niveaux de construction/amélioration avec PA + matériaux
     + effets, drapeau « construit dès le départ ».
  2. **Craft** : recettes avec bâtiment requis (+ niveau min), craft d'expédition (`field`), PA,
     ingrédients, produit (type/nom/qté) et **effets** ; vue centrale groupée par bâtiment.
  3. **Classes** : palier (1/2) + jour requis + **prérequis entre classes** (arbre SVG depuis « Sans
     classe »), rôle, bonus de stats (6) + bonus PA, **pouvoirs** (portée map|iso, PA 0 = passif,
     description + effets mécaniques), **apparence** (sprite carte + icône fiche perso, choisis parmi
     les assets characters/heroes/npc avec préviews).
- Seeds = les valeurs ACTUELLES du jeu (town.go/craft.go/classes.go) pour partir du réel ; autosave
  localStorage (`echoterra:designer:doc`), import JSON (complet ou partiel), ♻️ Reset re-seed.

### Fonctionnel (vérifié)
- E2E : arbre bâtiments 9 nœuds/4 arêtes, édition d'un PA reflétée dans le doc ET après reload
  (autosave), arbre classes 6 nœuds + préviews d'apparence, recettes groupées (Workshop/Kitchen),
  « Exporter tout » télécharge `echoterra-design-*.json`. `tsc -b` + `npm run build` OK,
  `test:perf` 13/13.

### À faire
- Quand tu me donnes tes JSON exportés : implémentation serveur (arbre techno dans town.go — les
  prérequis n'existent pas encore en jeu —, recettes/effets dans craft.go, classes/pouvoirs/apparence
  dans classes.go + assets.ts).

---

## 2026-07-14 (6) — Dangerosité des packs : surbrillance jaune→rouge au lieu des ×N

### Fait
- **Les labels « ×2 ×4 » des packs de monstres sont supprimés** (demande UX). À la place, la case du
  pack porte un **losange PLEIN teinté** du jaune (petit pack) au rouge (gros pack) : nouvelle texture
  `hl-fill` (les losanges de déplacement restent des CONTOURS — pas de confusion), interpolation
  `dangerTint` (count 1 = jaune `#ffd23f`, 6+ = rouge `#e03224`, linéaire entre les deux) et alpha
  croissant avec le danger (0.38 → 0.58). Depth : sur la face de la tuile (+1), sous les losanges de
  déplacement (montés à +2) et sous les unités (+90).

### Fonctionnel (vérifié)
- E2E : 4 packs → 4 fills, teintes distinctes selon count ; counts forcés 1/3/5/8 → dégradé
  `ffd23f → f39234 → e65229 → e03224` mesuré sur les sprites + capture. Plus aucun label ×N.
  `tsc -b` + `npm run build` OK, `test:perf` 13/13.

---

## 2026-07-14 (5) — Map : unités plus nettes, autres joueurs translucides, anti-chevauchement

### Fait
- **Résolution des personnages/monstres** (`textureUtils.shrinkTexture` + option `cropSquare`) : les
  PNG 1024² gardaient leurs grosses marges transparentes → affiché dans sa boîte de ~14 px monde, le
  contenu n'en occupait que ~60 %. Le shrink recadre désormais au **carré englobant du contenu opaque**
  (ancré en bas — les sprites sont ancrés aux pieds, origin 0.5/1) : chaque texel est du personnage,
  à taille d'affichage égale le sprite paraît ~1,5× plus grand et nettement plus net. S'applique aux
  héros ET aux monstres (mêmes textures partagées avec CombatScene, qui en profite aussi).
- **Héros des autres joueurs visibles** : rendus avec les MÊMES sprites chibi mais à alpha 0,45
  (plus de petits points violets) ; visibles PAR DÉFAUT (`showOthers: true`), le bouton 👥 les masque.
- **Anti-chevauchement** : les héros qui partagent une case se répartissent sur une **ellipse aplatie
  iso** (rayon 10×5, angle réparti uniformément ; un héros seul reste centré) — plus d'empilement
  quasi-total à l'ancien offset de 6 px.

### Fonctionnel (vérifié)
- E2E 2 joueurs : 2 héros d'Alice sur la même case → positions distinctes ; héros de Bob translucide
  (alpha 0,45) ; texture char-* recadrée carrée (128 en DPR 1, 512 en DPR 3, jamais suréchantillonnée).
  Capture zoomée : sprites plus grands et nets. `tsc -b` + `npm run build` OK, `test:perf` 13/13.

---

## 2026-07-14 (4) — Dropdown des héros sur le smiley + Home limité à MON équipe

### Fait
- **Home** : seuls MES personnages apparaissent sur l'herbe (les héros des autres joueurs ne sont
  plus affichés — `myTeamHeroes` dans `TownMap`, style violet retiré).
- **Nouvelle UI d'actions de la Map** : le smiley 🙂 de la TopBar ouvre un **dropdown**
  (`components/HeroActionsMenu.tsx`) listant chaque héros de mon équipe : bouton nom + ❤️/⚡ →
  **fiche de personnage** (HeroOverlay) ; 🎯 sélectionne le héros sur la carte (bascule sur Map) ;
  actions contextuelles par héros (⚔️ monstre sur la case, 🔥 pack à portée, 🔎/🫥 hors ville,
  🏃 si Tétanisé, « 🏰 en ville » sinon — mêmes règles que le menu radial). Chaque action
  sélectionne le héros puis agit. La **barre du bas de la Map est réduite** (chips héros, ligne
  nom, dpad et bouton ⚡ Actions supprimés) : Forcer vague + 👥 Autres + hint. Le déplacement est
  INCHANGÉ : sélection + losanges jaunes (le menu radial au tap du héros reste).
- **Bug débusqué** : le span « TownName 1 » de la TopBar portait `className="town"` → la règle
  globale `.town {position:absolute; inset:0}` (conteneur du Home) l'étirait PAR-DESSUS l'avatar,
  dont les clics étaient mangés (seul élément DOM placé avant lui). Renommé `town-name` (gotcha §8
  du CLAUDE.md complété).

### Fonctionnel (vérifié)
- E2E : dropdown liste les 3 héros (actions « en ville » au spawn), clic nom → fiche ouverte,
  🎯 → héros 2 sélectionné + onglet Map ; héros sorti de ville → 🔎🫥🔥 apparaissent ; partie à
  2 joueurs → le Home d'Alice ne montre que ses 3 persos. `tsc -b` + `npm run build` OK,
  `test:perf` 13/13.

---

## 2026-07-14 (3) — Les héros en ville quittent la carte et apparaissent dans le Home

### Fait
- **Map** (`MapScene`) : les héros debout sur la case ville (les miens ET ceux des autres) ne sont
  plus rendus — ils sont « à l'intérieur des murs ». La sélection reste possible via les chips et
  le tap sur la case ville (menu « En ville ») ; sortie via dpad/case adjacente (porte ouverte).
- **Home** (`TownMap`) : les héros présents en ville apparaissent SUR L'HERBE de la carte d'éditeur —
  au bake, collecte des cellules dont le bloc du dessus est une herbe (`GRASS_FILES` : jungle,
  darkgrass, fallgrass, grass, mossy) hors anneau de 1 cellule autour des bâtiments ; à chaque rendu,
  affectation déterministe héros→cellule (hachage de l'id + sonde à grand pas 29 pour ne pas se
  coller), sprite chibi `<img>` (84 px, marges transparentes comprises) + étiquette nom (violette
  pour les héros des autres joueurs). Pieds ancrés à la formule de l'éditeur
  (`project(...).sy − cubeDepth + objBottomDrop`).
- Perf : les `char-*.png` ont désormais deux consommateurs légitimes (loader Phaser + `<img>` du
  Home) → ajoutés à l'allowlist des doublons du test.

### Fonctionnel (vérifié)
- E2E : partie fraîche → Home montre Aldric/Brisa/Cael sur l'herbe, Map n'affiche 0 sprite héros ;
  un héros sort → 1 sprite sur la Map et il disparaît du Home. `tsc -b` + `npm run build` OK,
  `test:perf` 13/13.

---

## 2026-07-14 (2) — Journal de la ville (bâtiment Panel)

### Fait
- **Journal serveur** : `town.log` (`TownLogEntry {at, day, text}`, plus récent en premier, plafonné
  à 100 par `logTown`, persisté avec l'état, partagé par tous les joueurs). Instrumenté sur TOUTES
  les actions faites en ville : porte OUVERTE/FERMÉE, ration puisée au puits, dépôt à la Banque
  (une ligne par héros avec le nombre d'objets), chantier lancé/terminé/amélioré, réparation,
  craft en ville (ingrédients de la Banque), action `use`. Attribution au héros payeur (« l'équipe »
  en legacy pool). Tests `townlog_test.go` (contenu + ordre + cap).
- **Page Journal** : `components/TownJournal.tsx` (overlay type TownStatus, `store.townJournalOpen`),
  liste scrollable `J{day} · HH:MM — texte`, état vide expliqué. Le bouton « 📋 Journal » du Panel
  (qui ne faisait qu'un pushLog « bientôt ») ouvre maintenant la page.

### Fonctionnel (vérifié)
- `go test ./...` OK ; e2e navigateur : toggle porte ×2 + puits + dépôt → Panel → Journal affiche les
  4 entrées dans l'ordre attendu. `tsc -b` + `npm run build` OK, `test:perf` 13/13.

### À faire
- Y verser aussi les événements de vague (dégâts ville/bâtiments) ? Pour l'instant le rapport de
  vague vit dans TownStatus (lastWave) — à fusionner un jour si le journal devient LA timeline.

---

## 2026-07-14 — Home : la ville devient une carte d'éditeur (JSON) + zoom/pan

### Fait
- **La ville du Home est maintenant `src/data/town-map.json`** (export de l'éditeur, 54×59, 575
  cellules en terrasses, 7 bâtiments posés) rendue par le **nouveau `components/TownMap.tsx`** avec
  le renderer de l'éditeur (`drawMap` → canvas offscreen 2×, cuit une fois par session et mémoïsé,
  bornes calculées sur les cellules OCCUPÉES — `contentBounds` couvrait la grille entière, 4× trop
  grand). L'ancienne plateforme codée en dur (ISO_TOWN/ISO_TOWN_TILES/ISO_BUILDING_CELL + useIsoScale)
  est supprimée de `HomeTab`/`data/buildings.ts`.
- **Bâtiments cliquables** : les placements du JSON sont mappés vers les ids de bâtiments du jeu
  (`ASSET_TO_BUILDING` : bld-well→well, gate→gate, bld-chapel→townhall, panel, workshop, bank,
  bld-archerytower→tower) → pastille nom + barre de durabilité (chantiers : 🏗️ + « Construire » via
  Structure, comme avant). Wall/kitchen n'ont pas de sprite sur cette carte → gérables via Structure.
- **Zoom/pan dans la ville** (demande) : molette ancrée au curseur, drag pour panner, **pinch en
  mapping absolu** (même math sans dérive que la Map), fit initial automatique + refit au resize tant
  qu'on n'a pas bougé, pastilles contre-échelonnées (`--inv`) pour rester lisibles à tout zoom.
- **Piège trouvé** : le viewport fait `setPointerCapture` (pan) → les `click` DOM des hotspots ne se
  déclenchent jamais ; les taps sont résolus au `pointerup` via `elementFromPoint` (+ tap dans le
  vide = désélection). Budgets perf ajustés : `totalPngMB` 16→24 (le renderer décode ~18 isotiles +
  7 bâtiments sources), `sand.png` ajouté à l'allowlist des doublons (éditeur + MapScene).

### Fonctionnel (vérifié)
- E2E navigateur 1920 + 390 : rendu fidèle à l'éditeur, 7 hotspots présents, molette/drag/pinch
  changent bien la vue, clic Well → modale du puits, clic Workshop → onglet Structure.
  `tsc -b` + `npm run build` OK, `npm run test:perf` **13/13**.

### À noter / à faire
- Les **crops d'assets** de l'éditeur vivent dans le localStorage : sur un autre navigateur le rendu
  peut différer légèrement (exporter/committer les crops un jour ?).
- La carte pèse ~10 Mo de PNG sources au premier chargement du Home (cache navigateur ensuite) —
  si ça gêne sur mobile, pré-rendre un PNG statique au build.

---

## 2026-07-13 (13) — La porte fermée scelle la ville (entrée ET sortie)

### Fait
- **Règle de la porte** (`actions.go`) : `GateClosed()` (porte construite + fermée) bloque `MoveHero`
  dans les DEUX sens sur la case ville (« impossible d'entrer » / « impossible de sortir », refus
  avant dépense de PA) ; le pas de retraite d'`EscapeHero` ne peut pas finir sur la ville porte close
  (repli sur l'autre axe / sur place). Porte non construite = brèche, passage libre.
- **La porte démarre OUVERTE** (`DefaultBuildings`, `Open: true`) : les héros fraîchement spawnés
  doivent pouvoir sortir. La fermer (toggle 1 PA) restaure sa contribution défensive → vrai dilemme
  Hordes (et cohérent avec la réplique de Neko). Défense de départ légèrement plus basse du coup.
- **Bots** (`bots.go`) : avant de sortir récolter, un bot en ville OUVRE la porte si close (toggle
  1 PA) ; un bot qui rentre et trouve porte close se CACHE avant la vague au lieu de buter en boucle
  contre la muraille (`botStepToward` échoue → fallback Hide).
- **Client** (`MapScene`) : les losanges de déplacement excluent toute traversée de porte fermée
  (héros en ville → aucun losange ; héros adjacent → pas de losange sur la ville), miroir de la règle
  serveur.

### Fonctionnel (vérifié)
- `go test ./...` OK (nouveaux `TestClosedGateSealsTown`, `TestEscapeCannotEnterClosedGate`).
  E2E navigateur : porte ouverte au départ → 4 losanges ; toggle → 0 losange et le serveur refuse la
  sortie (héros immobile). `tsc -b` + `npm run build` OK.

### À faire
- Les bots n'ont pas de « referme la porte avant la vague » (un bot en ville pourrait toggle close
  quand la vague approche et que toute l'équipe est rentrée) — à évaluer, risque de guerre de toggle
  avec les humains.
- La retraite de combat perdu téléporte toujours les survivants en ville même porte close (choix :
  ils sont « ramenés » blessés) — à trancher un jour.

---

## 2026-07-13 (12) — Plus de Search/Hide sur la case ville

### Fait
- **Serveur** (`actions.go`) : `SearchTile` et `HideHero` refusent la case ville (« rien à fouiller
  en ville — le stock est à la Banque » / « inutile de se cacher en ville — la ville protège déjà
  ses habitants » ; la vague épargne déjà les héros en ville, la cachette n'y sert à rien). Refus
  AVANT toute dépense de PA. Test `town_tile_test.go` (refus en ville, OK une case à côté, 0 PA
  consommé).
- **Worldgen** : la tuile ville est générée avec `resources: 0` — sinon des ressources infouillables
  faussaient `nearestResourceTile` des bots et l'affichage. (Bots inchangés : ils ne fouillent/se
  cachent déjà que hors ville.)
- **Menu radial** (`MapTab`) : Search et Hide masqués quand le héros sélectionné est sur la ville ;
  à la place une note « 🏰 En ville — fouille et cachette inutiles ici » (style `.am-note`).
- Test e2e serverless adapté (il fouillait depuis la case ville au spawn : déplace d'abord le héros).

### Fonctionnel (vérifié)
- `go test ./...` OK (5 paquets). E2E navigateur : menu en ville = note seule ; une case à côté =
  Search/Hide (+ Fire ball) de retour ; API : les deux routes renvoient bien l'erreur en ville.
  `tsc -b` + `npm run build` OK.

---

## 2026-07-13 (11) — Home : échelle de la ville bornée sur grand écran

### Fait
- **La ville du Home ne se dimensionne plus sur la largeur brute** (`useIsoScale`) : en plein écran
  1920 la plateforme était agrandie ×4,5 (bâtiments géants, plus de ciel — séquelle du passage
  full-bleed). L'échelle est maintenant `min(largeur, hauteur×1.9, 1180) / 430` : bornée par la
  hauteur (garder du ciel autour du plateau) et par la largeur de l'ancien cadre desktop (1180 px,
  le look sur lequel la mise en page avait été réglée). Knobs `ISO_TOWN.maxWidth` / `heightRatio`
  dans `data/buildings.ts`. Téléphone inchangé (sous toutes les bornes).

### Fonctionnel (vérifié)
- Captures 1920×1080 (plateau entier + ciel, proportions d'origine), 1366×768 (≈ look ancien cadre)
  et 390×844 (identique à avant). `tsc -b` + `npm run build` OK.

---

## 2026-07-13 (10) — Ville multi : seuls MES héros comptent (PA, worker, Home, Stock)

### Fait
- **Serveur** : `POST town/action` exige désormais `heroId` dans une partie avec joueurs — le chemin
  legacy « pool partagé » (`heroId:""` → `spendTownPA`) drainait les PA de TOUS les héros en ville,
  y compris ceux des autres joueurs (on pouvait financer un chantier avec les actions d'autrui).
  L'ownership du `heroId` était déjà vérifiée ; la faille était le pool. Test HTTP
  `api/town_test.go` (sans heroId → 400 ; héros d'un autre joueur → rejeté ; le sien → OK).
- **Front** (`townUtils.ts`) : `heroesInTown/townPA/effectiveTownHeroId` prennent `playerId` et ne
  comptent que MON équipe en multijoueur (`myTeamHeroes`, legacy solo = tout le monde). Répercuté
  partout : BottomNav (Home se déverrouille avec MES héros en ville seulement), TownWorker/useWorkerPA
  (le sélecteur « PA payés par » n'offre que mes héros), TownBar, StructureTab, CraftTab (mode ville =
  mes héros), HomeTab (worker du puits), store (`townWorkerId` simplifié — la logique multi dupliquée
  vit dans `effectiveTownHeroId`).
- **Stock** : n'affiche plus que les sacs de MON équipe (l'inventaire des autres joueurs est privé) ;
  la Banque reste partagée (c'est le coffre commun) mais sa section n'apparaît que si l'un de MES
  héros est en ville ; libellé « Déposer le butin de mes héros ».

### Fonctionnel (vérifié)
- `go test ./...` OK (dont le nouveau `TestTownActionRequiresOwnHeroInMultiplayer`) ; `tsc -b` +
  `npm run build` OK. E2E navigateur (partie 2 joueurs Alice+Bob, les 6 héros en ville) : le Stock
  d'Alice liste ses 3 sacs + Banque (pas ceux de Bob), le worker picker n'offre que ses 3 héros,
  l'API rejette pool partagé et héros adverse.

### À faire
- `TownAction` (couche jeu) garde le chemin pool pour le legacy solo — si un jour le solo passe
  aussi au worker obligatoire, supprimer `spendTownPA`.

---

## 2026-07-13 (9) — Fog of war : la mer de nuages devient une brume mystique animée

### Fait
- **Restyle « mist mystique »** (demande UX) : palette froide lavande/indigo (`MIST_TOP/MID/SHADOW/
  LIGHT/GLOW/BOT`), traînées vaporeuses ÉTIRÉES (blobs radiaux écrasés `scale(1, 0.3-0.5)` — flux de
  brume, plus de chou-fleur), **particules lumineuses discrètes** (`MIST_GLOW`, 3/tuile, la touche
  magique), volutes d'arêtes aplaties et **semi-transparentes** (opaques elles faisaient un motif
  matelassé en vue large ; translucides elles fondent entre tuiles et ne ressortent qu'en silhouette
  contre terrain/ciel), base du banc en indigo plus profond.
- **Respiration animée** : `MapScene.update` fait rouler une lente vague d'alpha en diagonale sur les
  tuiles de brume (`MIST_ALPHA_BASE 0.93 ± 0.05`, `sin(time/900 + (x+y)·0.45)`) — la nappe semble
  vivante. Suivi par `tileIsMist[]` (maintenu dans le diff de frames ; `setAlpha(1)` quand une tuile
  est découverte) ; ~400 setAlpha/frame, négligeable, et la scène dort onglet caché.

### Fonctionnel (vérifié)
- Captures 1920 (large + zoom ×2) : tapis de brume lavande calme, voiles superposés au zoom, bord
  festonné contre le terrain. `tsc -b` + `npm run build` OK, `npm run test:perf` 13/13.

### À faire
- Si la respiration gêne (batterie/épilepsie ?), la couper est trivial : early-return dans `update`.

---

## 2026-07-13 (8) — Fog of war : mer de nuages à la place du noir

### Fait
- **Les tuiles non découvertes se rendent en blocs-nuages** (`MapScene.drawCloudInto`) au lieu du
  pilier grass teinté quasi-noir : silhouette de cube iso en blancs pastel (base ton moyen, sombre
  vers le bas), taches douces en **dégradé radial** (ombre puis lumière — l'ondulation du tapis),
  bosses claires à cheval sur les arêtes hautes qui montent dans un niveau de marge (paires `cloud{v}:1`,
  h=1) → bord festonné/moutonneux là où les nuages rencontrent le terrain découvert. 6 variantes cuites
  dans l'**atlas de piliers partagé** (même architecture perf : 1 Image/tuile, 1 texture, diff par draw),
  choisies par **hachage mélangé** de la position + **flip miroir** une tuile sur deux. Tint blanc pour
  les nuages (ils portent leurs couleurs) ; fallback sans atlas en `FOG_FALLBACK` clair.
- Leçons de l'itération (5 essais, captures à l'appui) : les cercles à bord dur créent des artefacts
  (« chevrons »/« virgules ») — n'utiliser QUE des dégradés radiaux pour la texture intérieure ; la base
  de la face sup. doit être un ton MOYEN sinon les touffes claires disparaissent (plaine de neige) ; les
  combos linéaires (7x+11y)%N s'alignent en diagonales — hacher avec XOR/multiplications.

### Fonctionnel (vérifié)
- Captures 1920 (vue large + zoom ×2) et 390×844 : mer de nuages continue, bords moelleux autour du
  terrain, aucun motif répétitif visible. `tsc -b` + `npm run build` OK, `npm run test:perf` 13/13
  (l'atlas absorbe les 6 cellules nuage sans dépasser les budgets).

### À faire
- Optionnel : générer un vrai tile `isotiles/cloud.png` via ComfyUI (DA storybook) et l'utiliser à la
  place du procédural (même mécanique d'atlas — remplacer `drawCloudInto` par le cube normalisé).

---

## 2026-07-13 (7) — Shell full responsive : suppression du cadre téléphone/tablette sur desktop

### Fait
- **Plus de « mode tablette » sur PC** : le jeu vivait dans un cadre d'appareil centré (`.device`
  390×844 avec notch ; ≥1024px : 1180×760 arrondi/ombré). Le shell est maintenant **full-bleed à
  toutes les tailles** : `.app-bg` = 100dvh, `.device` = 100 % du viewport (classe conservée comme
  conteneur), notch/ombres/rayons supprimés, variables `--dev-w/--dev-h` retirées.
- Le breakpoint desktop ≥1024px ne garde que les ajustements de tailles et **plafonne les rangées
  larges** : contenu de `.map-controls` (sélecteur de héros, dpad, actions) centré à max 1100px,
  `.loading-bar`/`.branch` à max 900px — le reste (map Phaser, ville Home, nav) profite de toute la
  fenêtre.
- `App.tsx` : commentaire mis à jour (l'éditeur reste rendu hors shell, inchangé).

### Fonctionnel (vérifié)
- Captures Playwright 1920×1080, 1366×768 et 390×844 : plein écran partout, Home/Map/Title corrects,
  contrôles Map centrés en large, téléphone inchangé. `tsc -b` + `npm run build` OK,
  `npm run test:perf` **PASS 13/13** (viewport téléphone, budgets Map intacts).

### À faire
- Sur très grand écran le Home (ville) est très zoomé — un jour, borner le scale de la ville ou
  montrer plus de terrain autour.

---

## 2026-07-13 (6) — Pinch mobile : fix du drift (getWorldPoint périmé + mapping absolu)

### Fait
- **Cause racine du drift au pinch** : `zoomBy` appelait `cam.getWorldPoint` juste APRÈS `setZoom`,
  or `BaseCamera.getWorldPoint` lit `this.matrix`, rafraîchie seulement au `preRender` → le calcul
  mélange l'ancien zoom (matrice inverse) et le nouveau (terme de scroll ×z'/z). Résultat : la
  compensation d'ancrage devenait `scroll ×= (2 − ratio)` à chaque événement — la caméra dérivait
  vers/depuis l'origine du monde, direction dépendante de la position sur la carte (« ça drift d'un
  côté ou de l'autre »). Simulation chiffrée : **~150 px CSS de dérive par geste** de pinch.
- **Pinch en mapping ABSOLU** (`MapScene`) : baseline au pointerdown du 2e doigt (distance, zoom,
  point-monde sous le milieu des doigts) ; à chaque `pointermove`,
  `zoom = zoomDépart × dist/distDépart` et le scroll est **posé** (pas incrémenté) pour recoller le
  point-monde de départ exactement sous le milieu courant. Zoom + pan deux doigts en une seule
  formule, aucune accumulation d'erreur possible (simulation : 0 px de décollage, pinch symétrique
  comme asymétrique). Champs `pinchStartDist/pinchStartZoom/pinchWorldX/Y` remplacent l'incrémental.
- **`zoomBy` (molette) refait à la main** : math écran↔monde explicite
  (`screen = (world − scroll − c)·zoom + c`, c = centre caméra), plus aucun `getWorldPoint`
  post-`setZoom`. L'ancrage molette sur desktop était touché par le même bug (1 événement/frame,
  dérive plus discrète).

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK. Simulation numérique old vs new (événements tactiles alternés doigt
  par doigt, pinch symétrique et pouce-planté) : ancien code ≈150 px CSS de dérive, nouveau 0 px.
  Reste à confirmer au doigt sur téléphone.

### À faire
- Rien de spécifique sur le geste ; si un à-coup apparaît à la transition pinch→un doigt, vérifier
  `prevPosition` du doigt restant.

---

## 2026-07-13 (5) — Map mobile : pinch amélioré (pan deux doigts) + seuil de tap DPR

### Fait
- **Pan deux doigts pendant le pinch** (`MapScene`) : le geste à deux doigts zoome toujours ancré sur
  le milieu des doigts, et **suit maintenant le déplacement de ce milieu** (`pinchMidX/Y`) — bouger les
  deux doigts ensemble déplace la carte comme dans une appli carto (avant, un drag à deux doigts ne
  faisait rien tant que l'écartement ne changeait pas).
- **Baseline du pinch au `pointerdown` du 2e doigt** : distance + milieu sont posés dès que le second
  doigt touche l'écran (avant, le premier `pointermove` servait de baseline → petit à-coup au démarrage
  du geste), et un pinch ne peut plus se terminer en clic de tuile (`dragged = true` immédiat).
- **Seuil tap-vs-drag à l'échelle DPR** : `TAP_SLOP = 10 × DPR` remplace le seuil fixe de 8 px — les
  coordonnées pointeur sont en pixels physiques depuis le passage au canvas DPR, donc 8 px ≈ 2,7 px CSS
  sur un téléphone DPR 3 et des taps normaux (micro-tremblement du doigt) partaient en drag et
  n'ouvraient jamais le menu radial.

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK. Gestes = logique pointeur pure (pas d'API nouvelle) ; la vérification
  tactile réelle reste à faire sur téléphone.

### À faire
- Si le pinch paraît encore nerveux sur un vrai appareil : lisser le facteur (lerp) ou traiter le geste
  une seule fois par frame (le handler tourne à chaque événement de chaque doigt).

---

## 2026-07-13 (4) — Onglet Map : pips supprimés, unités 3× plus petites, fond ciel

### Fait
- **Pips de ressources supprimés** (`MapScene`) : les points verts/rouges de disponibilité des cases
  n'existent plus — `buildPipTextures`, les deux `Blitter` (`pipOk`/`pipEmpty`) et la boucle de
  repopulation ont été retirés (demande UX : ils chargeaient visuellement la carte).
- **Unités et bâtiment 3× plus petits** : nouvelle constante `UNIT_SCALE = 1/3` appliquée aux sprites
  héros (`TILE_W*0.85*UNIT_SCALE`), monstres (`TILE_W*0.8*UNIT_SCALE`) et au bâtiment de ville
  (`TILE_W*2.1*UNIT_SCALE`). L'anneau de sélection et le label `×count` des packs sont redimensionnés/
  repositionnés en conséquence (un anneau pleine tuile écrasait le petit sprite).
- **Fond ciel identique au Home** : canvas Phaser **transparent** (`transparent: true` dans
  `PhaserGame`, plus de `backgroundColor`), `setBackgroundColor` retiré de `MapScene`, et le
  `background: #0e1626` de `.map-host` supprimé → le `.sky` du `GameScreen` (app-bg.png, le même que
  l'onglet Home) est visible derrière la carte. `CombatScene` garde son fond caméra opaque `#161022`.

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK. E2E navigateur (Playwright + swiftshader) : captures Map vs Home —
  ciel visible autour de la carte, aucun pip, héros/monstres/église nettement plus petits que la tuile.

### À faire
- Rien de spécifique ; si les textures paraissent surdimensionnées en VRAM, `UNIT_TEX_SIZE` /
  `TOWN_TEX_SIZE` (textureUtils) pourraient être réduits d'autant (÷3) — non fait car CombatScene
  partage ces textures à plus grande taille.

---

## 2026-07-13 (3) — Indicateurs sous les personnages + fog of war anti-triche (payload HTTP)

### Fait
- **Indicateurs de mouvement sous les personnages** : les losanges jaunes (cases atteignables),
  l'anneau de sélection et le socle de la ville étaient dessinés sur l'overlay `Graphics`
  (depth 10000) → PAR-DESSUS les sprites. Ce sont maintenant des **Images par tuile insérées dans
  la pile iso** (`MapScene.buildHighlightTextures` : `hl-diamond`/`hl-ring` supersamplées DPR ;
  losange depth `(x+y)*100+h+1` juste au-dessus de la tuile, anneau `depth(héros)-0.5` juste sous le
  sprite) — les personnages passent devant naturellement. Helper `diamond()` de l'overlay supprimé.
- **Fog of war complet, appliqué côté serveur** : `GameState.ClientView()` (`fog.go`) copie l'état en
  vidant les tuiles non découvertes (biome/hauteur/ressources/monsterId), en omettant les **monstres
  sur tuiles cachées** et en masquant la **seed** (seed + générateur Perlin = toute la carte).
  Interception **centrale** dans `api.writeJSON` (`clientView` : GameState direct ou dans un
  `map[string]any`) → aucun handler présent ou futur ne peut fuiter ; `/world` redigé aussi. La
  persistance et la logique (bots, vagues) travaillent toujours sur l'état complet.
- **Client adapté** : les tuiles inconnues n'existant plus dans le payload, elles se rendent comme
  des piliers plats neutres (`FOG_BIOME` grass teinté `FOG_TINT`) — le relief n'est plus divulgué
  par la silhouette. La couche de tuiles n'est plus « construite une fois » : **diff par draw**
  (frame + tint par tuile, `tileFrameAt`), le vrai pilier apparaît à la découverte, l'atlas grandit
  (`ensurePillarAtlas` → `{ready, rebuilt}`, rebake = rebind de toutes les images, colonnes bornées
  à 4096 px). Le cheat « 👁️ Révéler la carte » est supprimé (plus rien à révéler côté client) —
  `debugNoFog`/`revealAll` retirés du store/scène/CheatPanel.

### Fonctionnel (vérifié)
- `go test ./...` OK (dont `TestClientViewRedactsUndiscovered`) ; `tsc -b` + `npm run build` OK ;
  `npm run test:perf` **PASS 13/13 × 3 runs** (budgets d'ouverture assouplis en garde-fous : le GL
  logiciel headless peut geler ~20 s sur le premier frame composité, artefact CI sans GPU).
- HTTP vérifié sur partie fraîche : seed=0, 435/484 tuiles non découvertes **toutes vierges**,
  monstres envoyés uniquement sur tuiles découvertes.
- E2E navigateur : héros marché 6 pas dans le brouillard → 49→70 tuiles découvertes, le vrai terrain
  (sable, eau) se matérialise à l'arrivée des données, les tuiles cachées restent vierges côté
  client ; capture : anneau + losanges bien SOUS le sprite du héros.

### Reste à faire
- La silhouette de la carte (le grand losange sombre) révèle les dimensions du monde — acceptable.
- Variantes 256² des PNG pour le réseau mobile (report de la session précédente).

---

## 2026-07-13 (2) — Tests de chargement + résolution native (carte pixelisée sur téléphone)

### Fait
- **Résolution d'affichage (le « pixelisé » sur téléphone)** : le canvas Phaser était dimensionné en
  pixels CSS (mode `Scale.RESIZE`), le navigateur l'upscalait ×2–3 sur mobile. Désormais le canvas est
  en **pixels physiques** : `game/dpr.ts` (`DPR = devicePixelRatio` plafonné à 3), `PhaserGame` passe en
  `Scale.NONE` + `zoom: 1/DPR` + **ResizeObserver** (possible car l'onglet caché garde sa taille via
  `visibility:hidden`). Compensation caméra : MapScene (MIN/MAX/DEFAULT_ZOOM × DPR + formule de centrage
  correcte à tout zoom `scroll = cible − taille/2`), CombatScene (`setZoom(DPR)` + scroll dans
  `layout()`, dessin en unités CSS). Textes : `resolution: DPR`. Supersample des cubes lié au DPR
  (`SS = 2×DPR`, plafonné 6 ; colonnes de l'atlas bornées à 4096 px).
- **Optimisation mémoire GPU** : les sprites d'unités (héros/monstres) restaient des textures 1024²
  (~4 Mio VRAM chacun, ~45 Mio au total) pour un affichage ≤ ~40 px monde. `game/textureUtils.ts` :
  `shrinkTexture` les réduit à leur taille d'affichage max (puissance de 2 : 128/256/512 selon DPR)
  après chargement, même clé, source libérée. L'église (town-building) est aussi plafonnée.
- **Doublons réseau supprimés** : CombatScene préchargeait les MÊMES PNG que MapScene (10 fichiers,
  ~5 Mo re-téléchargés au boot en dev). CombatScene ne précharge plus rien — MapScene est l'unique
  chargeur des sprites partagés, le fallback jeton couvre un combat ultra-précoce.
- **Test de chargement** (`frontend/tests/perf/map-loading.mjs`, `npm run test:perf`, playwright-core
  en devDep) : 13 assertions budgétées — payload PNG ≤16 Mo, zéro téléchargement en double (allow-list
  grass/stone utilisés aussi par le DOM de Home), sources brutes libérées, unités ≤512 px, ≤4096 px,
  VRAM estimée ≤40 Mio, pré-cuisson ≤20 s, ouverture ≤1,5 s / réouverture ≤750 ms, 0 re-téléchargement
  à la réouverture, instance Phaser conservée, scène endormie cachée, **canvas à la résolution native**
  (simulé à DPR 3, 390×844). Démarre backend+vite s'ils ne tournent pas. ⚠ poll par `page.evaluate`
  (pas `waitForFunction` : en GL logiciel headless, le canvas DPR affame le poller injecté).

### Fonctionnel (vérifié)
- `npm run test:perf` : **PASS 13/13** (ouverture 9 ms, réouverture 12 ms, 15,6 Mio de textures).
- Captures DPR 3 : carte et combat nets (1170×2127 physiques pour 390×709 CSS), ville centrée, taille
  apparente inchangée ; DPR 1 bureau : comportement strictement identique (zoom 1, canvas = CSS).
- Combat traversé de bout en bout (déplacement → startCombat → scène combat active, map endormie).
- `npx tsc -b` + `npm run build` OK.

### Reste à faire
- Variantes 256² des PNG pour le réseau mobile (le payload réseau reste ~13 Mo, la VRAM est réglée).
- Pips de ressources : texture 6px un peu douce en DPR 3 (Blitter sans scale) — cosmétique.

---

## 2026-07-13 (1) — Perf : l'onglet Map ne recharge plus tout à chaque ouverture

### Fait
- **Cause du « Map met longtemps à charger »** : `GameScreen` montait `<MapTab />` conditionnellement →
  chaque sortie de l'onglet détruisait l'instance Phaser (`game.destroy(true)`) et chaque retour
  recréait le contexte WebGL, re-téléchargeait/re-décodait **~17 PNG 1024² (~8,5 Mo)** (isotiles,
  persos, monstres, église), re-normalisait les cubes, recuisait l'atlas de piliers et reconstruisait
  la couche de tuiles.
- **Fix** : l'onglet Map reste **monté toute la partie** — `GameScreen` le rend en permanence avec une
  prop `active`, caché via `.map-host-hidden` (`visibility:hidden` + `pointer-events:none` ; PAS
  `display:none` : en `Scale.RESIZE` un parent 0×0 casse le framebuffer WebGL — vu en test, erreur
  « Framebuffer status: Incomplete Attachment »).
- Caché : `PhaserGame` **endort les deux scènes** et gate `ShowScene` par `activeRef` pour que
  `renderMap` (actions + poll 20 s) ne les réveille pas. Réveil au retour via `syncScene` (MapTab).
- **Pré-chauffage** : `MapScene.create()` émet `EV.MapSceneReady` → MapTab re-pousse l'état même
  caché → textures normalisées + atlas + couche de tuiles construits en arrière-plan pendant qu'on
  est sur Home.

### Fonctionnel (vérifié — Playwright headless sur dev servers)
- Atlas pré-cuit pendant l'onglet Home ; **1re ouverture Map ≈ 19 ms**, réouverture ≈ 10 ms.
- Changement d'onglet : même instance Phaser, scène `map` endormie, `refreshGame()` ne la réveille
  pas, **0 re-téléchargement** de PNG ; capture d'écran de la carte OK (terrain iso, fog, ville, héros).
- `npx tsc -b` + `npm run build` OK.

### Reste à faire
- Le payload initial (~8,5 Mo de PNG 1024² affichés à ≤100 px) mériterait des variantes réduites
  (256²) pour la 1re visite sur réseau mobile.

---

## 2026-07-07 (9) — Google Sign-In (« Continuer avec Google »)

### Fait
- **Backend** (`api/google.go`) : `POST /api/auth/google` — le front envoie le `credential`
  (id_token Google Identity Services), le serveur le vérifie auprès de
  `oauth2.googleapis.com/tokeninfo` (signature + expiration par Google) puis contrôle lui-même
  l'**audience** (= `ECHOTERRA_GOOGLE_CLIENT_ID`) et `email_verified`. Vérificateur injectable
  (`verifyGoogleIDToken` var) pour les tests. 1er login = création du compte (provider `"google"`,
  `PassHash` vide) ; email déjà inscrit (compte email) = connexion sur CE compte (email vérifié par
  Google → même personne). Login mot de passe sur un compte Google-only → 401 avec message dédié.
- **`GET /api/auth/config`** → `{googleClientId}` : le front découvre à l'exécution si Google est
  activé (rien à rebuilder ; vide = bouton masqué, 501 sur /google).
- **Frontend** : `googleAuth.ts` (chargeur du script GIS + typings), `AccountScreen` → carte
  « Autres connexions » avec le VRAI bouton Google officiel (rendu par GIS, `renderButton`,
  locale fr) quand configuré, sinon hint « non configuré » ; `api.authConfig` / `api.loginGoogle` ;
  action store `loginGoogleAccount` (token + user + pseudo + mes parties, comme le login email).
- **Apple** : confirmé écarté — Sign in with Apple exige l'Apple Developer Program (~99 $/an),
  donc pas gratuit. Mentionné dans l'UI et `DEPLOY.md`.
- **Docs** : `DEPLOY.md` (création du client OAuth GCP : origins localhost:5173 + domaine Vercel,
  env sur le service backend), `CLAUDE.md` (section comptes + API + layout).

### Fonctionnel (vérifié)
- `go test ./...` OK — nouveau `api/google_test.go` (1er harnais httptest du package api) :
  non configuré → config vide + 501 ; création de compte + session utilisable sur `/me` ;
  re-login sans doublon ; compte email existant réutilisé tel quel (pseudo conservé, mdp toujours
  valide) ; mauvais aud / email non vérifié / email absent / jeton inconnu → 401 ; credential
  manquant → 400.
- E2E serveur réel : `/auth/config` vide puis rempli selon l'env ; `/auth/google` → 501 sans
  client ID, 401 sur un faux jeton avec un VRAI appel tokeninfo (réseau sortant OK), 400 sans
  credential ; register email intact.
- `tsc -b` + `npm run build` OK.

### À faire / limites connues
- Poser un vrai `ECHOTERRA_GOOGLE_CLIENT_ID` (console GCP, gratuit) pour tester le bouton en vrai —
  le flux complet navigateur (GIS → credential → session) n'a pas pu être cliqué sans client ID.
- tokeninfo = 1 appel réseau par login Google (OK à cette échelle) ; passer à la vérif JWKS locale
  si le volume monte. Toujours pas de reset de mot de passe ni de rate-limiting sur /login.

---

## 2026-07-07 (8) — Connexion utilisateur (email + mot de passe, sessions, reprise multi-appareils)

### Fait
- **Comptes** (`store/users.go`, bi-dialecte SQLite/Postgres) : tables `users` (email unique lowercased,
  `pass_hash` bcrypt, `provider` = "email" — colonne prête pour "google") et `sessions` (token 32 o hex,
  TTL 30 j). Méthodes CreateUser/UserByEmail/UserByID/CreateSession/UserByToken/DeleteSession.
- **API** (`api/auth.go`) : `POST /api/auth/register` (email valide, mdp ≥6, pseudo défaut = partie
  locale de l'email) · `POST /login` · `POST /logout` · `GET /me` · `GET /me/games` (mes parties avec
  `myPlayerId` par partie). Auth par header `Authorization: Bearer <token>` ; helper `userFromReq`
  (anonyme TOUJOURS possible — le compte enrichit, il ne bloque pas le prototype).
- **Lien compte ↔ joueur** : `Player.UserID` ; createLobby/solo/join lient le joueur au compte et
  utilisent le pseudo du compte si aucun nom fourni. **Reconnexion** : rejoindre une partie où mon
  compte a déjà un joueur → renvoie CE joueur (`rejoined:true`), pas de doublon — reprise depuis
  n'importe quel appareil sans localStorage.
- **Frontend** : token en localStorage (`echoterra:authToken`), header Bearer sur TOUS les appels
  (`client.ts req`) ; restauration de session au boot (`api.me`, token invalide purgé) ;
  `AccountScreen` (bouton 👤 en haut à droite du titre) : connexion / inscription / profil /
  déconnexion / **🗺️ Mes parties** (reprise en un clic, salon ou partie active) ; le pseudo du compte
  alimente `playerName`.
- **Google/Apple** : bouton Google désactivé "(bientôt)" — gratuit mais exige un client OAuth GCP à
  configurer ; **Apple écarté car payant** (Apple Developer Program ~99 $/an), mentionné dans l'UI.

### Fonctionnel (vérifié)
- `go test ./...` OK (nouveau `users_test.go` : round-trip user/sessions, email insensible à la casse,
  doublon refusé, token expiré/supprimé/inconnu → nil).
- E2E serveur réel : register (token 64 hex) · doublon refusé · mauvais mdp refusé · login email
  insensible à la casse · `/me` OK · partie solo avec compte → joueur nommé "Guillaume" + `userId` lié ·
  `/me/games` liste la partie avec `myPlayerId` · re-join par id → `rejoined:true` sans doublon ·
  logout → `/me` 401 · flux anonyme intact.
- `tsc -b` + `npm run build` OK.

### À faire / limites connues
- Google OAuth : brancher un provider "google" (vérif id_token côté serveur) quand un client ID GCP
  existera. Pas de reset de mot de passe (pas de serveur mail) ni de rate-limiting sur /login.
- Les parties legacy/anonymes ne sont pas liées à un compte (voulu).

---

## 2026-07-07 (7) — Refonte du menu + affichage multijoueur des personnages

### Fait
- **Menu titre restructuré** (`TitleScreen.tsx`) : menu principal = 🤖 **Solo (4 bots)** ·
  🌍 **Parties publiques** · 🎪 **Parties privées** · ⚙️ Paramètres. Section **🛠 Debug** en dessous
  (pour les tests) : Nouvelle partie test (legacy 3 héros), Continuer, 🎬 Intro (cinématique),
  🗺️ Éditeur, Classement (placeholder).
- **LobbyScreen à deux modes** (`store.lobbyMode`, `openLobby("public"|"private")`) : l'entrée
  "publiques" = liste des salons publics uniquement (poll 5 s) ; l'entrée "privées" = carte "Créer une
  partie privée" (hôte, code, bots) + carte "Rejoindre par code". Plus de mélange des deux flux.
- **Affichage multijoueur des personnages** : sur la carte on ne voit QUE ses héros en sprites ;
  ceux des autres joueurs sont des **points violets** (`OTHER_HERO_COLOR`, pastille + initiale,
  jamais le chibi), **masqués par défaut** et affichables via le bouton **👥 Autres** (`store.showOthers`,
  visible seulement en multijoueur). Non sélectionnables : `heroesAt` (taps carte) ne retourne que MES
  héros, `selectHero` garde aussi côté store. Le sélecteur de héros de la carte, les **HeroChips** et le
  cycle ◀▶ du **HeroOverlay** ne listent plus que MON équipe (`store.myHeroes()`), fallback legacy solo
  = tous.

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK (re-vérifiés après fusion avec l'optimisation MapScene ci-dessous).

### À faire (itération suivante = connexion utilisateur)
- **Auth** : email + mot de passe (gratuit, bcrypt + session token serveur, table `users` SQLite) ;
  structurer pour brancher Google OAuth ensuite (gratuit, nécessite un client ID GCP).
  ⚠️ **Sign in with Apple n'est PAS gratuit** (Apple Developer Program ~99 $/an) — à confirmer avec
  Guillaume avant de l'envisager.
- Lier `Player` ↔ compte utilisateur (reconnexion multi-appareils sans localStorage).

---

## 2026-07-07 (6) — Optimisation de l'affichage de la map (MapScene)

### Fait
- **Atlas de piliers** (`ensurePillarAtlas`, `MapScene.ts`) : chaque combinaison (biome × hauteur de rendu)
  est pré-cuite dans UN canvas partagé (cube empilé h+1 fois) → **1 Image Phaser par tuile** au lieu de
  h+1 cubes empilés (~490 objets au lieu de ~1000-1500), et une seule texture pour tout le terrain = un
  seul batch WebGL (avant : 6 textures qui cassaient le batching).
- **Plus AUCUNE reconstruction de la couche de tuiles en cours de partie** : la clé de cache ne contient
  plus la signature du brouillard (`fog${count}`) — avant, CHAQUE case découverte (donc chaque déplacement)
  détruisait et recréait toutes les images (gros hitch + GC). Le brouillard/ombrage est maintenant appliqué
  par **diff de `setTint` par tuile** (`tileTintAt`), qui gère aussi le toggle 👁️ reveal-all.
- **Pips de ressources → `Blitter`** (2 blitters vert/rouge, textures 6×6) : un `Graphics` Phaser
  re-tesselle ses commandes à CHAQUE frame — ~400 `fillCircle` par frame partaient en tessellation CPU
  permanente. Les bobs de Blitter sont quasi gratuits. Le Graphics overlay ne garde que les surbrillances,
  le plinth de la ville et les fallbacks (≤10 formes).
- **Mémoire GPU** : les PNG bruts 1024² (`iso-raw-*`, `town-raw`) sont libérés après normalisation
  (~28 Mo) ; `opaqueBBox` mesure sur une copie ≤256px (~16× moins de pixels scannés au démarrage, marge
  de sécurité d'1 px source). Mipmaps trilinéaires + `powerPreference: high-performance` (`PhaserGame.tsx`)
  pour les sprites 1024² affichés à ~40px.

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK. Vérifié en vrai (backend Go + Vite + Playwright/Chromium) : partie test,
  onglet Map → atlas construit, 484 images de tuiles, raws libérés, pips bobs OK ; déplacement d'un héros
  (5 pas) → nouvelles tuiles révélées **sans reconstruction** (mêmes instances d'Image, même `tilesKey`,
  seuls les tints changent) ; toggle reveal-all → 0 tuile embrumée, 479 pips ; screenshot du rendu conforme
  (relief, ville, unités, surbrillances).

### À faire / notes
- Les sprites unités/bâtiments restent des PNG 1024² individuels (peu nombreux, mipmappés) — si un jour il
  y a beaucoup d'unités, les baker en petit atlas comme les piliers.
- Ne PAS remettre les pips (ou toute forme répétée ~N tuiles) dans un Graphics : re-tessellation par frame.

---

## 2026-07-07 (5) — Déploiement Vercel gratuit (fonction Go serverless + Postgres/Neon)

### Fait
- **Store bi-dialecte** (`store.go`) : `Open(dsn)` détecte un DSN `postgres://`/`postgresql://`
  (driver `lib/pq`, pur Go) sinon SQLite ; schéma commun (`updated_at BIGINT` passé depuis Go),
  placeholders rebindés `?`→`$n` pour PG. Tests : `dialect_test.go` (rebind), round-trip SQLite inchangé.
- **Mode serverless de l'API** (`api.NewServerless`, flag `Server.stateless`) : pas de goroutines
  (scheduler/janitor) ni de cache inter-requêtes (plusieurs instances de fonction → le store est la
  seule vérité ; `load` relit toujours la base). Rattrapage paresseux : vagues déjà lazy (`tick`), +
  **`BotCatchUp`** (`bots.go`, ~1 round bot/minute écoulée, plafonné à 6, timestamp `GameState.LastBotAt`
  persisté) + **`lazyHousekeeping`** sur `GET /api/games` (purge lobbies >24 h + recréation du salon
  public).
- **Preset Vercel « Services »** (choisi après voir l'assistant d'import le proposer de lui-même) :
  `vercel.json` déclare 2 services — `frontend` (root `frontend/`, Vite, statique) et `backend` (root
  `backend/`, le preset Go détecte `cmd/server/main.go` = le VRAI serveur) + rewrites `/api/*` et
  `/healthz` → backend, catch-all → frontend. `main.go` : écoute `PORT` quand Vercel l'injecte, DSN
  depuis `ECHOTERRA_DB`/`DATABASE_URL`/`POSTGRES_URL`, et bascule sur `api.NewServerless` quand
  `VERCEL` est présent. (Première itération = fonction Go `api/index.go` + `go.mod` racine wrapper ;
  retirée au profit de Services — `backend/serverless` reste comme harnais e2e/entrée FaaS de secours.)
  `.vercelignore` exclut `asset-index/` (141 Mo), `scripts/`, `journal.md`.
- **`DEPLOY.md`** : marche à suivre (merger dans main → import vercel.com/new → Storage → Neon gratuit
  → redeploy), variables, limites connues (cold starts, verrou par instance seulement → lost updates
  théoriques multi-instances).

### Fonctionnel (vérifié)
- `go -C backend test ./...` OK — dont nouveau test e2e `serverless_test.go` (healthz, housekeeping
  crée le salon public, partie solo 4 bots jouable à travers le Handler stateless).
- `go -C backend build ./...` OK ; `tsc -b` + `npm run build` OK ; smoke run local avec `PORT` +
  `VERCEL=1` (serveur stateless qui écoute le bon port, healthz + salon public OK).
- Non vérifié en vrai : le déploiement Vercel lui-même (à faire par Guillaume : merger dans main,
  importer le repo sur vercel.com/new puis brancher Neon — 5 min, voir `DEPLOY.md`).

### À faire / limites connues
- Concurrence multi-instances : verrou seulement par instance → passer à un verrou en base ou à une
  écriture optimiste (colonne version) avant ouverture publique sérieuse.
- Postgres non testé contre un vrai serveur (schéma/requêtes triviaux, rebind testé unitairement).

---

## 2026-07-07 (4) — Parties publiques auto-lancées, vote d'expulsion, mode solo 4 bots

### Fait
- **Visibilité des parties** (`GameState.Visibility`, consts `VisibilityPrivate/Public`, "" = private
  legacy) : les parties PRIVÉES restent le flux existant (créées par un joueur, join par code, lancées
  par l'hôte, kick = pouvoir de l'hôte). Les parties PUBLIQUES sont **créées automatiquement par le
  serveur** ("Expédition publique", min 2 / max 4) et **démarrent seules dès `minPlayers` atteint**
  (`MaybeAutoStart` appelé après chaque join ; `launch()` extrait de `StartGame`). Garde-fous : start
  manuel refusé, bots interdits, pas de pouvoirs d'hôte en public.
- **Toujours un salon public ouvert** : `ensurePublicLobby` au démarrage du serveur, dans le janitor
  (10 min), et immédiatement après chaque auto-start (remplacement). Les résumés (`GET /api/games`)
  exposent `visibility` et **n'exposent plus jamais le joinCode** (une partie privée se rejoint par
  code partagé hors-jeu, pas depuis la liste).
- **Vote d'expulsion en public** (`VoteKick`, `GameState.KickVotes{target→voters}`) : majorité stricte
  des AUTRES joueurs humains (bots ni électeurs ni comptés) ; anti double-vote, anti self-vote,
  lobby uniquement ; votes purgés quand un votant/une cible part ; `launch()` efface le registre.
  La route `/kick` est unifiée : privé → hôte (`{game,kicked:true}`), public → vote
  (`{game,votes,needed,kicked}`).
- **Mode solo 4 bots** : `POST /api/games/solo` `{playerName}` → partie privée min 1/max 5, créateur +
  4 bots, **lancée immédiatement** → `{game,player}` (15 héros, 12 packs). Bouton menu
  "🤖 Solo (avec 4 bots)" sur l'écran titre (`store.startSoloBots`).
- Frontend : liste "🌍 Parties publiques" (join par id, filtre `visibility`), salle d'attente publique
  sans code/lancer/bots avec mention du départ auto, bouton 🗳️ de vote avec compteur
  (`game.kickVotes`), entrée directe en jeu si MON join déclenche l'auto-start.

### Fonctionnel (vérifié)
- `go test ./...` OK — nouveaux : auto-start public à min joueurs (+ refus start manuel/bots),
  vote majoritaire (1/2 puis 2/2 → expulsé, héros retirés), double/self-vote refusés, purge des votes
  au départ du votant.
- E2E serveur réel : salon public présent au boot (sans code exposé) · join 1/2 reste lobby · join 2/2
  → ACTIVE (6 héros, 6 packs) · nouveau salon public recréé aussitôt · solo = 1 humain + 4 bots
  (15 héros, 12 packs) actif en un appel · kick hôte privé inchangé.
- `tsc -b` + `npm run build` OK.

### À faire / limites connues
- Vote d'expulsion limité à la salle d'attente (en partie active, à définir : remplacer le joueur par
  un bot ?).
- Matchmaking public basique : un seul salon ouvert à la fois (pas de file par région/taille).
- Reste : consommation d'objets (craft bots), hordePower ∝ joueurs, reconnexion sans localStorage.

---

## 2026-07-07 (3) — Bots v2 : combat iso auto-résolu + évolution de classe

### Fait
- **Combat isométrique auto-résolu** (`combat.go AutoResolve/heroAutoTurn`) : quand un pack campe sur
  la case d'une équipe de bots, ils ENGAGENT le vrai combat tactique — l'IA des unités héros est
  symétrique à celle des monstres (approche du plus proche ennemi via `stepToward`, frappe avec la
  compétence de classe en mêlée [+3], respect de Root/Stun) et la bataille entière est résolue
  serveur-side dans le même tick (`ActiveCombat` posé et libéré sous le même verrou — les humains ne
  voient jamais un combat bloquant). `FinishCombat` applique le résultat : victoire = pack retiré +
  trophées ; défaite = retraite en ville à 1 PV + Tétanisé (règles inchangées).
- **Décision d'engagement** (`bots.go botShouldEngage`) : combat seulement si TOUS les héros vivants de
  la case appartiennent à des bots (jamais entraîner un humain dans un combat auto-joué) ET si l'équipe
  égale au moins les unités du pack (cap 4 comme `NewCombat`). Sinon : boule de feu pour amincir le
  pack (comportement v1 conservé).
- **Évolution de classe** (`botEvolve`) : dès l'ouverture des paliers (jour 2/4, validés par
  `EvolveHero`), chaque héros bot choisit une classe selon ses stats — précision→Chasseur,
  agilité→Éclaireur, sinon Pionnier ; puis force+endurance→Gardien, dextérité→Récupérateur, sinon
  Herboriste.
- **Fix robustesse** : `StartCombat` initialise `g.Combats` si nil (parties désérialisées de lignes
  SQLite antérieures au champ → panic évitée).

### Fonctionnel (vérifié)
- `go test ./...` OK — nouveaux tests : engagement + auto-résolution (pack retiré, combat "won",
  `ActiveCombat` libéré) ; pas d'engagement en infériorité (4 unités vs 3 héros → boule de feu) ; veto
  si un humain partage la case ; évolution aux paliers jour 2 puis jour 4 (tier 1 → 2, classes stats).

### À faire / limites connues
- **Craft bot non implémenté** : il n'existe pas encore de mécanique de CONSOMMATION d'objets (soins,
  nourriture) côté serveur — un bot qui crafte ne pourrait rien en faire. À faire quand l'usage
  d'objets existera.
- Les bots ne montent pas la Tour/upgrades (voulu : ne pas vider la Banque en silence).
- Reste des itérations précédentes : reconnexion sans localStorage, présence en ligne, hordePower ∝
  joueurs, distinction UI des héros des autres joueurs.

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
