# Plan — Amélioration de la carte et du système de combat isométrique

> Rédigé le 2026-07-19. Objectif : faire du combat FFTA2-like le SECOND pilier du jeu
> (aujourd'hui : arène 7×7 quasi plate tirée au hasard, sans lien avec le biome, actions
> move/attaque/skill/end, IA monstre simple). Tout respecte l'architecture actuelle :
> serveur autoritaire (combat.go, grilles GDD `AttackDef`), même contrat bus côté client
> (`VoxelCombatView` voxel par défaut, CombatScene Phaser en Classique).
>
> Difficulté : **S** ≤ ½ session, **M** = recette/mécanique articulée, **L** = système.

## État des lieux (2026-07-19)

- `NewCombat` : 7×7, hauteurs aléatoires (70 % plat, 20 % +1, 10 % +2), héros ligne du
  bas, monstres ligne du haut. AUCUN lien avec le biome de la case, aucun obstacle.
- Actions : `move` (une fois/tour) puis `attack | skill | end`. Pas de Defend (pending
  §9.3 du CLAUDE.md), pas d'objets, pas de fuite, pas de poussée.
- Grilles GDD : ciblage VERT relatif à l'attaquant + zone ROUGE autour de l'impact —
  déjà data-driven (`AttackDef`/`SkillDef`), c'est LA fondation à exploiter.
- IA : s'approche jusqu'à portée, ~35 % spéciale ; pas de focus, pas de retraite.
- Voxel : arène en blocs 32³, quads verts atteignables, anneaux de cible, barres de PV
  + étiquettes, rotation 4 orientations. Pas de FX d'impact, pas de timeline de tour.
- Bonus hauteur : « small bonus » de dégâts si attaquant plus haut (implicite, peu lisible).

## Principes

- **Le terrain EST la tactique** : biome, obstacles, hauteurs et dangers doivent changer
  la façon de jouer un combat — pas juste le décor.
- **Serveur autoritaire, client lisible** : toute règle nouvelle vit dans combat.go avec
  ses tests ; le client la MONTRE (prévisualisation, télégraphie) sans jamais la calculer.
- **Data-driven d'abord** : étendre les structures du design (`AttackDef`, arènes par
  biome) plutôt que coder des cas particuliers — le Studio de données (§7c) doit pouvoir
  les éditer un jour.
- **Chaque lot est jouable et mergeable seul**, vérifié par tests Go + e2e Playwright
  (clics projetés réels sur l'arène voxel, comme `combat-check.mjs`).

---

## Lot C1 — L'ARÈNE PAR BIOME : terrain, obstacles, dangers (M)

L'arène est GÉNÉRÉE depuis la case du monde où le combat éclate (seed = combat id).

| Élément | Règle serveur | Rendu voxel |
|---|---|---|
| **Sol par biome** | palette/hauteurs par biome : prairie douce (bosses +1), forêt vallonnée, montagne en terrasses marquées (+0..3), sable plat + langues d'eau en coin, neige + plaques de glace | blocs du biome (grass/forest/stone/sand/snow), mêmes teintes que la carte |
| **Obstacles bloquants** (`Cell.Blocked`) | 2-4 par arène : infranchissables ET bloquent la ligne de vue (C4) | rocher/arbre/pilier voxel PLEIN sur la case (props existants réutilisés à l'échelle bloc) |
| **Cases d'eau** (sable/rives) | infranchissables (contour), pas de spawn dessus | colonne d'eau + shader existant |
| **Glace** (neige) | glisser : un move qui ENTRE sur la glace prolonge le pas d'une case dans la même direction si libre | bloc `ice` brillant |
| **Ronces** (forêt/prairie) | traversables, −1 PV en entrant | touffe d'épines sombre |
| **Spawn** | héros/monstres sur les 2 rangées opposées, jamais sur bloqué/eau | inchangé |

- Serveur : `Combat.Cells []CombatCell {Height, Blocked, Hazard("" | "water" | "ice" | "brambles")}`
  remplace `Heights` (alias JSON conservé pour compat) ; `NewCombat(biome, seed)` ;
  pathfinding/portées ignorent les cases bloquées (BFS déjà là pour `reachable`).
- Tests : génération par biome déterministe, obstacles infranchissables, glissade, ronces.
- E2E : arène montagne à terrasses en capture ; move refusé sur un rocher.

## Lot C2 — LISIBILITÉ & JUICE : le combat se comprend d'un coup d'œil (S→M)

| Élément | Détail |
|---|---|
| **Timeline d'initiative** | bandeau haut : portraits dans l'ordre du tour (`order`), actif surligné, morts grisés — donnée déjà servie, pur client | 
| **Dégâts flottants** | étiquette canvas « −7 » qui monte et s'efface au-dessus de la cible (labels.ts réutilisé) ; soins en vert, esquive « raté » |
| **Prévisualisation d'attaque** | au survol/sélection d'une cible : zone ROUGE de la grille GDD + **fourchette de dégâts estimée** servie par `combatResponse` (le serveur calcule, le client affiche) |
| **FX d'impact** | flash blanc bref du mesh touché + micro-recul (tween 80 ms) + tremblement caméra 1-2 px sur les gros coups |
| **Télégraphie ennemie** | l'IA CHOISIT sa cible/attaque au début de son tour → cases menacées teintées ORANGE pendant l'animation (déjà calculé serveur, il suffit de l'exposer) |
| **Écran de victoire** | recap : loot par héros (tirages pondérés déjà faits), PV restants, tours joués — au lieu du retour sec à la carte |

- Quasi tout est client ; seule la fourchette de dégâts et la télégraphie touchent
  `combatResponse` (champs additionnels, pas de logique nouvelle).

## Lot C3 — ACTIONS TACTIQUES : Defend, Poussée, objets, fuite (M)

| Action | Règle |
|---|---|
| **🛡️ Defend** (tous) | termine le tour : −50 % dégâts subis jusqu'au prochain tour (réutilise le Bouclier de la Posture défensive du Gardien) — le pending §9.3 |
| **👐 Poussée** | attaque de mêlée alternative (0 dégât) : pousse la cible d'1 case dans l'axe ; collision (mur/obstacle/unité) = 2 dégâts aux deux ; poussée dans l'eau = la cible y reste (piégée 1 tour) ; chute ≥2 de hauteur = +2 dégâts. Devient AUSSI le skill « Poussée du Survivant » du Pionnier (portée 2) |
| **🧪 Objets** | consommer en combat un objet du SAC du héros (1 action) : potions/nourriture — s'appuie sur le chantier « consommation d'objets » du design ; premier pas : Potion de soin +5 PV, Ration +2 PV |
| **🏃 Fuite** | action d'équipe : chaque héros encore vivant atteint le bord bas → combat « fled », retour carte SANS loot, pack conservé (PV restants persistés — déjà supporté par `Monster.HP`) |

- Serveur : nouveaux `action` dans `PlayerAction` + validation ; tests par action
  (collisions de poussée, bords, quota objet/tour, fuite partielle).
- Client : boutons contextuels dans la barre de combat + previews de poussée (flèche).

## Lot C4 — COUVERTURE, VISÉE & DOS : la profondeur FFTA2 (M→L)

| Règle | Détail |
|---|---|
| **Ligne de vue** | attaques à distance (portée >1 des grilles GDD) : tracé de Bresenham sur la grille ; un obstacle C1 sur le trajet = tir IMPOSSIBLE (cases masquées retirées du ciblage servi) |
| **Couverture** | cible ADJACENTE à un obstacle, côté attaquant : −25 % dégâts à distance (télégraphié par une icône bouclier sur la case) |
| **Hauteur formalisée** | +1 dégât par niveau d'avantage (max +3), −1 en contre-plongée — REMPLACE le « small bonus » implicite, affiché dans la fourchette C2 |
| **Attaque de dos** | chaque unité a un `Facing` (mis à jour au move/attaque) : attaque depuis l'arc arrière = +25 % et ignore la couverture — l'IA essaie de contourner |

- Le ciblage étant DÉJÀ servi par `combatResponse` (`attackTargets`/`skillTargets`),
  la ligne de vue est un filtre serveur de plus — le client n'a rien à calculer.
- Tests : LOS bloquée/dégagée, couverture, bonus hauteur exacts, arcs de dos.

## Lot C5 — BOSS & IA : des combats mémorables (L)

| Élément | Détail |
|---|---|
| **Arène de boss 9×9** | Roi Gobelin / Arbre Vivant Ancien : grille 9×9, boss **2×2 cases** (4 cellules occupées, une seule unité), PV majorés du design |
| **Patterns télégraphiés** | le boss ANNONCE son attaque de zone un tour à l'avance (cases oranges) et frappe au tour suivant — le jeu du placement/esquive |
| **IA de meute** | focus-fire (cible la plus blessée atteignable), retraite à <25 % PV vers l'arrière, le buffeur (Hurlement de Meute) reste derrière |
| **Renforts** | vague 4+ : à mi-combat, 1-2 créatures rejoignent par le bord monstre (annoncé un tour avant) |

- Gros lot serveur (multi-cases = pathfinding/portées adaptés) ; à ne prendre qu'après
  C1-C4 stabilisés.

---

## Ordre conseillé & fil rouge

| Lot | Dépend de | Coût est. | Valeur |
|---|---|---|---|
| **C1 Arène par biome** | — | 1-2 sessions | le combat cesse d'être générique |
| **C2 Lisibilité** | — (parallèle à C1) | 1 session | le combat se COMPREND (mobile !) |
| **C3 Actions** | C1 (poussée→obstacles/eau) | 1-2 sessions | la tactique s'ouvre |
| **C4 Couverture/visée** | C1 | 1-2 sessions | la profondeur FFTA2 |
| **C5 Boss & IA** | C1-C4 | 2 sessions | les moments mémorables |

Chaque lot se termine par : tests Go du domaine, e2e Playwright sur l'arène voxel
(clics projetés réels contre le vrai backend), captures avant/après, `tsc` + build,
suite `test:perf:voxel` (l'arène reste ≤ 1 M tris), entrée journal, push.

## Hors périmètre (assumé)

- Pas de temps réel, pas d'animations squelettiques (les FX C2 sont des tweens/flashs).
- CombatScene Phaser (mode Classique) reçoit les RÈGLES (servies) mais pas les FX — le
  voxel est le rendu de référence.
- Le moral/faim/équipement du GDD restent dans le chantier « consommation d'objets »
  global (C3 n'en prend que les potions).
