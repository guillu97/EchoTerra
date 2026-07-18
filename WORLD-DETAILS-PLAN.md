# Plan — Détails du monde par biome (remplir le monde voxel)

> **✅ IMPLÉMENTÉ (2026-07-18)** — lots D1 à D4 livrés (voir `journal.md` entrées 25-27) :
> 46 props ×3 variantes, scatter partagé `frontend/src/voxel/scatter.ts` (règles « près
> de » + repères par seed), vie ambiante jour/crépuscule, veines de minerai murales,
> cascade shader (`cascade.ts`). Restent au goût : muret en ruine, ruines éparses, algues
> affleurantes (teinte de bloc).
>
> Rédigé le 2026-07-18. Objectif : donner de la VIE et de la matière à chaque biome de la
> carte voxel. Tout suit le pipeline existant : recette procédurale dans `gen-props.mjs`
> (3 variantes par prop, palettes pastel), scatter déterministe par hachage dans
> `VoxelMapView.buildProps` (+ miroir banc), InstancedMesh avec ombres. Déjà en place :
> arbres-boules verts/roses, sapins (+ enneigés), rochers, touffes d'herbe, fleurs, roseaux.
>
> Difficulté : **S** = petite recette + scatter (≤ 1 h), **M** = recette articulée ou
> placement conditionnel, **L** = effet/animation ou logique dédiée.

## Principes

- **Trois étages de détail** par biome : la COUVERTURE (props S très denses qui texturent),
  les ACCENTS (props M plus rares qui caractérisent), les REPÈRES (landmarks L uniques par
  seed — 1 à 3 par carte, ils servent aussi la navigation sans minimap).
- **Les placements racontent** : champignons EN CERCLE, éboulis AU PIED des falaises,
  roseaux AU BORD de l'eau — la règle de placement fait 50 % du charme.
- **Budget** : chaque lot doit rester ≤ +1,5 M tris pire-cas plein monde (mesure au banc
  🌄). Les props S restent ≤ ~150 tris ; toute canopée/masse suit la règle « jitter
  quantifié 3 teintes » (leçon des arbres).
- **Vie ambiante ≠ gameplay** : les petits animaux/insectes sont décoratifs, tailles et
  couleurs éloignées des monstres (pas de confusion avec un pack).

## 🌊 Eau (biome 0)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Nénuphars | disque plat 5×5 vert d'eau, fleur rose 1 voxel sur 1/3 | eau CALME (loin du bord) 8 % | S |
| Rochers émergés | petit dôme pierre + anneau d'écume claire | eau, 4 % | S |
| Algues affleurantes | taches vert sombre translucides sous la surface (teinte du bloc, pas un prop) | veines de bruit | S |
| Bois flotté | branche claire couchée 8×2 | eau proche du sable, 3 % | S |
| Barque échouée | coque 10×5 bois + bord clair, inclinée | REPÈRE : 1/carte, sur une rive | L |
| Mouettes | 2-3 « V » blancs voxel flottant à y+1.5 au-dessus de l'eau | 2 %, par groupes | M |

## 🏖️ Sable (biome 1)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Coquillages / étoiles de mer | 2-4 voxels rose pâle/corail/crème | 10 %, surtout ligne d'eau | S |
| Galets | 3-5 petits dômes gris doux | 6 % | S |
| Algues échouées | cordon vert sombre 6×1 couché | bord d'eau, 5 % | S |
| Herbes de dune | touffe existante recolorée vert-jaune sec | crêtes de sable, 12 % | S |
| Crabe | corps 3×2 rouge doux + pinces 1 voxel | 2 % | M |
| Tortue | carapace dôme 5×5 écaillée + tête | REPÈRE : 1/carte | M |

## 🌿 Prairie (biome 2)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Hautes herbes | patch DENSE de brins (2× touffe actuelle, plus haut) | plaques par bruit (nappes), 20 % dans les plaques | S |
| Buisson à baies | boule verte 6×6 + 5-8 points rouges/violets | 6 % | S |
| Marguerites géantes | tige haute + tête blanche 3×3 cœur jaune | 2 % — ponctue les nappes | S |
| Souche | cylindre 4×4 bois, cœur clair, 1-2 champignons | 2 % | S |
| Papillons | 2 voxels ailes blanc/jaune/bleu, à y+0.8 EN L'AIR | 4 % près des fleurs | M |
| Muret en ruine | segments de pierre bas 1×3, alignés sur 2-4 tuiles | veines rares (ancienne ferme) | M |
| Lapins | corps 3×2 crème + oreilles | 1,5 %, JAMAIS sur tuile à monstres | M |
| Épouvantail | croix bois + tête sac + chapeau paille | REPÈRE : 1/carte, en prairie ouverte | L |
| Ruche sauvage | dôme rayé ocre sur souche + 2-3 abeilles voxel | REPÈRE : 1/carte | L |

## 🌲 Forêt (biome 3)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Champignons | pied crème + chapeau rouge à pois / brun / doré | 12 % (lié au lore Dryade) | S |
| Fougères | 4-5 arcs de voxels retombants vert profond | 15 % | S |
| Tronc tombé | cylindre couché 10×3 moussu (dessus vert) | 4 % | S |
| Buisson dense | 2 boules fondues vert profond | 8 % | S |
| Cercle de fées | 8-10 champignons EN ANNEAU sur une tuile dégagée | REPÈRE : 1-2/carte | M |
| Vieil arbre ancien | arbre-boule ×2.2, tronc noueux 4×4, canopée triple | REPÈRE : 1/carte (écho au « Cœur de chêne ancien » du craft !) | M |
| Toiles d'araignée | voile triangulaire blanc translucide entre 2 arbres | 2 %, annonce l'Araignée Cristalline | M |
| Lucioles | 4-6 motes jaune-vert à y+0.5, **visibles seulement au crépuscule** (t > 0.75 du cycle solaire) | 8 % la nuit | L |

## ⛰️ Montagne (biome 4)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Éboulis | 4-6 cailloux groupés en pente | PIED des marches de falaise (détection de pente voisine), 8 % | S |
| Cristaux | prismes violets/bleus 2×2×5 inclinés, teinte claire (lore Araignée Cristalline) | 4 %, par paires | S |
| Cairn | pile de 4-5 pierres décroissantes | 2 % — balise les cols | S |
| Arbres morts | tronc + 2-3 branches nues gris-brun | 5 % | S |
| Menhir gravé | monolithe 4×4×12 + entaille accent | REPÈRE : 1-2/carte, au sommet | M |
| Veines de minerai | filon doré/cuivré serpentant sur les MURS de falaise (couleur des murs, pas un prop) | rare, par bruit | M |
| Aigle | silhouette qui tournoie au-dessus du pic (2-3 positions alternées au tick solaire) | REPÈRE : 1/carte | L |
| Cascade | rideau d'eau animé (shader bandes verticales) sur une falaise bord d'eau | REPÈRE : 1/carte si la géo s'y prête | L |

## ❄️ Neige (biome 5)

| Prop | Recette voxel | Placement / densité | Diff. |
|---|---|---|---|
| Congères | buttes blanches douces 6×4 | 10 % | S |
| Pics de glace | prismes bleutés translucides 2×2×6, groupés | 5 % | S |
| Arbres givrés | arbre mort + couverture blanche sur branches | 6 % | S |
| Buissons givrés | boule blanche à cœur vert pâle | 6 % | S |
| Bonhomme de neige | 2 boules + yeux charbon + nez carotte + bras branches | REPÈRE : 1/carte 🎁 | M |
| Lièvre blanc | comme lapin, blanc, discret | 1 % | M |
| Souffle de neige | motes blanches dérivantes (shader léger au vent) | ambiance | L |

## ✨ Transversal (tous biomes)

- **Vie liée au CYCLE SOLAIRE** (déjà piloté par le timer de vague) : papillons/mouettes/
  abeilles le JOUR, lucioles et motes de brume luisantes au CRÉPUSCULE — même mécanique :
  le scatter garde deux listes et le tick de 5 s bascule leur visibilité. C'est LE détail
  qui fait vivre le monde sans rien coûter (props déjà instanciés, on toggle `visible`).
- **Repères par seed** : un tirage déterministe (hash du seed de partie) place 3-5 landmarks
  par carte parmi le pool (menhir, vieil arbre, épouvantail, bonhomme de neige, barque,
  cercle de fées…) — jamais deux fois le même monde, et des points de navigation naturels.
- **Placements « près de »** : généraliser la règle roseaux→eau : une passe calcule pour
  chaque tuile ses biomes voisins (eau adjacente, falaise adjacente…) et les tables de
  scatter peuvent cibler `sableBordEau`, `piedDeFalaise`, `prairieOuverte` (aucun voisin
  forêt), `sommet` (tuile plus haute que ses 8 voisines).
- **Ruines éparses** (lore Echo Terra) : colonne brisée, dalle gravée, arche à moitié
  effondrée — 2-3 par carte tous biomes, en pierre crème patinée.

## Lots de mise en œuvre (ordre conseillé)

| Lot | Contenu | Coût est. |
|---|---|---|
| **D1 — Couverture** | tous les props S des 6 biomes (≈ 18 recettes simples) + règle « près de » (eau adjacente / pied de falaise / sommet) | 1-2 sessions |
| **D2 — Repères** | pool de landmarks + tirage par seed (menhir, vieil arbre, épouvantail, bonhomme de neige, barque, cercle de fées, tortue, ruche) | 1 session |
| **D3 — Vie ambiante** | papillons/mouettes/lucioles/abeilles + bascule jour/nuit sur le cycle solaire ; lapins/lièvres/crabes | 1 session |
| **D4 — Effets** | toiles d'araignée translucides, veines de minerai murales, cascade shader, souffle de neige, aigle | 1-2 sessions (au goût) |

Chaque lot se termine par : mesure au banc 🌄 (budget ≤ +1,5 M tris/lot), captures
comparatives, e2e move/rotation, push.
