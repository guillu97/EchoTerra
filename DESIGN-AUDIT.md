# Audit de game design — Echo Terra

> 2026-09-13. Audit demandé par Guillaume, mené sur le code de `main` à `ec95b31`.
> **Ce document ne parle pas de rendu, d'assets ni de performance** — ces trois-là sont en bon
> état et abondamment documentés ailleurs. Il parle de ce que le joueur FAIT et de ce que
> l'arithmétique lui répond.

## 0. Méthode, et ce qu'elle ne peut pas dire

Tous les chiffres viennent de `go -C backend run ./cmd/balance` — le simulateur joue de VRAIES
parties (vrai worldgen, vraie horloge `AdvanceTo`, vraies actions publiques), pas des maquettes.
Runs : 6 graines × {1, 2, 4, 8, 12, 20} joueurs sur 20 vagues, plus 4 graines × 4 joueurs sur 22
vagues en détail, plus 2 graines × 20 joueurs sur 34 vagues.

⚠ **Le simulateur joue des BOTS.** `RETENTION-PLAN.md` §5 le dit déjà et il faut le répéter : un
bot ne ferme pas la porte au bon moment, n'arbitre pas un chantier, ne va pas chercher une ruine à
douze cases. **Tout ce qui suit sur la compétence est donc à charge du bot, pas du jeu.** J'ai
séparé les deux : chaque constat est marqué **[STRUCTURE]** (vrai quel que soit le joueur, parce
que c'est de l'arithmétique ou du code) ou **[BOT]** (peut-être seulement une faiblesse de l'IA).
Les six problèmes de §2 sont tous **[STRUCTURE]** — c'est pour ça qu'ils sont là.

⚠ **Un constat de mon premier jet s'est révélé FAUX à la vérification, et il mérite d'être écrit
ici** parce que le piège resservira : le simulateur rapporte « portail ouvert 14 vagues sur 17 », ce
qui donnait un splendide problème de défense. C'est un artefact d'échantillonnage — `Snapshot.GateOpen`
est lu APRÈS la vague et après plusieurs rounds de bots, qui rouvrent la porte au matin. En croisant
la défense réellement opposée à chaque vague avec le catalogue (`design.go`), on trouve **31 à 44
alors que le plafond porte-OUVERTE vaut 20 puis 30** : la porte était donc fermée à chacune des
17 vagues. Le couvre-feu des bots (`curfewPhase`) fonctionne. Morale : sur ce simulateur, ne jamais
conclure d'un drapeau d'état sans le recouper avec une valeur calculée au moment de la vague.

---

## 1. Ce qui est solide, et qu'il ne faut pas casser en réparant le reste

Il faut le dire avant les critiques, parce que plusieurs corrections évidentes détruiraient ces
acquis.

- **La boucle courte tient.** 18 PA (3 héros × 6), un rendez-vous imposé par le serveur, un dilemme
  binaire et lisible (sortir = récolter, rentrer = défendre). C'est du Hordes propre, et la garnison
  (`wave.go`) est la bonne façon de rendre ce dilemme numérique.
- **`hordePower = pression + assiégeants` est une excellente décision.** Elle donne au joueur un
  levier RÉEL sur le chiffre qu'il redoute, et elle rend la prévision (`Forecast`) honnête et
  actionnable. C'est le meilleur morceau de design du projet.
- **Le refus du méta-pouvoir** (mémoriaux, chronique, titres, saisons : cosmétique, jamais de la
  puissance) est le bon choix pour une survie de groupe, tenu par des tests. Ne pas céder là-dessus.
- **La discipline de mesure** est au-dessus de la moyenne du métier : le simulateur, les garde-fous
  Playwright, l'audit des proportions. Le projet sait se corriger — ce document ne fait que lui
  poser des questions qu'il ne s'était pas encore posées.
- **Le thème comme peau + biais + UNE contrainte** est un cadre juste, et le contrat des six règles
  (§8 de RETENTION-PLAN) est le genre de garde-fou qui empêche le contenu de devenir du déséquilibre.

---

## 2. Les six problèmes, par gravité

### A · La courbe de tension est plate, puis verticale — **[STRUCTURE]**

Mesuré (4 joueurs, la taille par défaut, 4 graines) :

| graine | 1er point de dégât | chute | vagues à 100 PV |
|---|---|---|---|
| 1 | vague **11** | 17 | 10/17 (58 %) |
| 2 | vague **15** | 18 | 14/18 (77 %) |
| 3 | vague **12** | 18 | 11/18 (61 %) |
| 4 | vague **12** | 18 | 11/18 (61 %) |

**La ville ne perd pas un seul point de vie pendant 58 à 77 % de la partie, puis meurt en 3 à 6
vagues.** À la cadence cible, ça fait **cinq à sept jours réels sans enjeu**, suivis d'un week-end
où tout s'effondre. C'est l'inverse de ce qu'on veut d'un jeu de rendez-vous : la période où le
joueur prend l'habitude de revenir est celle où il ne se passe rien, et la période où le jeu devient
intéressant est celle où il est déjà trop tard pour agir.

La cause est arithmétique, pas comportementale : la défense de départ (mur 1 + portail 2 + garnison)
vaut **31 à 44** alors que `hordePower` à la vague 1 vaut `int((6+2)×scale) + assiégeants + rand(4)`,
soit **11 à 16**. La ville démarre avec **deux à trois fois** la défense nécessaire. Le croisement
n'a lieu qu'à la vague 10-15, et il a lieu d'un coup parce que la pression est linéaire pendant que
la défense, elle, plafonne (cf. B).

⚠ Et ce n'est pas un problème de bots : un bon joueur allongerait la phase plate, il ne la
raccourcirait pas.

### B · Le plafond de défense est atteint à mi-partie, et plus rien ne le déplace — **[STRUCTURE]**

20 joueurs, graine 1, colonne « déf » vague par vague :

```
v11..v25 :  80 80 80 80 80 80 80 80 80 80 80 80 80 80 80
horde    :  62 63 67 75 76 85 86 102 130 147 125 178 114 167 209
bâtiments:   7  7  7  7  7  7  7   7   7   7   7   7   7   7   7   (13 niveaux, figés v11)
```

**Quinze vagues consécutives — plus de la moitié de la partie — où la ville ne peut strictement
plus rien améliorer.** Elle regarde la horde tripler. Graine 2 : même chose, gelée à 56-58 de
défense et 15 niveaux à partir de la vague 10.

Le plafond théorique est connu et bas : mur 20 + portail 16 + tour 12 = **48** de pierre, doublé par
la garnison (plafonnée par la pierre, délibérément), plus 4/niveau de Caserne. Soit **~108** au
grand maximum, contre une horde sans borne. La défaite est donc voulue et c'est très bien — mais
**le joueur atteint son plafond bien avant de mourir**, et le tiers final de chaque partie est du
temps mort où l'unique action utile est de rapiécer les PV.

⚠ Nuance mesurée, et elle compte pour choisir le correctif : **à 4 joueurs la garnison n'atteint
jamais son plafond** (défense de bâtiments 22 puis 27, garnison réelle 9 à 17) — il y a de la place
pour plus de monde aux créneaux. **À 20 joueurs elle est saturée** (défense rigoureusement constante
à 80 pendant quinze vagues = plafond de pierre atteint des deux côtés). Autrement dit : une petite
expédition est limitée par ses **bras**, une grande par sa **pierre**. Un seul levier ne peut pas
corriger les deux.

Deuxième moitié du constat, plus révélatrice encore : **la ville tient exactement aussi longtemps
que sa pierre.** Graine 2 à 20 joueurs, la pierre en Banque fait 32 → 30 → 26 → 29 → 24 → 17 → 4 →
0, et la ville tombe la vague d'après. Le vrai compteur de fin de partie n'est ni la horde ni les
bâtiments : c'est le stock de Pierre qui alimente `TownAction("wall","repair")`. Ça, personne ne le
dit au joueur, et ce n'est nulle part dans l'ordre du jour comme la ressource critique qu'elle est.

### C · La construction — le système-vitrine — ne tourne quasiment pas — **[STRUCTURE + BOT]**

Le catalogue offre **16 bâtiments × 3 niveaux = 48 niveaux**. La ville en démarre avec 7. Mesuré en
fin de partie :

| expédition | bâtiments debout | niveaux cumulés | niveaux GAGNÉS sur 41 possibles |
|---|---|---|---|
| 4 joueurs (×4 graines) | **6, 6, 6, 6** | 8, 10, 8, 9 | **1 à 3** |
| 20 joueurs, graine 1 | 7 | 13 | 6 |
| 20 joueurs, graine 2 | 11 | 15 | 8 |

**Une expédition de quatre joueurs — la taille par défaut — ne construit aucun bâtiment neuf de
toute la partie et gagne un à trois niveaux.** Douze héros × 6 PA × 17 vagues = **1 224 PA de
travail** pour 15 à 45 PA de chantier : **2 à 4 %** de la main-d'œuvre de l'expédition atteint le
système qui est censé être le cœur de la ville.

Trois causes distinctes, et il faut les séparer :

1. **[STRUCTURE] Dix bâtiments sur seize sont derrière un plan qui ne tombe que d'une ruine ou
   d'une fouille à poids 1-3.** C'est délibéré (« aucune ville ne peut tout avoir »), mais le
   réglage produit « aucune ville n'a rien » : la Mairie (donc la résurrection), la Tour (donc la
   prévision resserrée), l'Infirmerie (donc le seul soin, cf. D) sont absentes de la quasi-totalité
   des parties. Un arbitrage entre cinq spécialités qu'on n'obtient jamais n'est pas un arbitrage.
2. **[STRUCTURE] Le bois n'arrive pas.** La forêt tire « Bois » à poids 3 sur 9 → **0,33 bois par
   fouille**, contre 0,92 pierre par fouille en montagne (poids 6 sur 13, qty 2). Le bois est
   pourtant le matériau de base de presque tous les niveaux 1. Mesuré en fin de partie, la Banque
   tient **0 à 5 bois** dans cinq runs sur six, sur 91 à 146 objets stockés. La Banque se remplit de
   Fleurs, de Viande et de Débris.
3. **[STRUCTURE] Le travail part ailleurs, et personne ne sait où.** Le jeu n'instrumente aucune
   dépense de PA : ni le serveur ni le simulateur ne disent quelle part du budget va au
   déplacement, à la fouille, au chantier ou à la réparation. C'est le trou de mesure le plus
   coûteux du projet — on règle des coûts de construction sans savoir combien de PA les atteignent.
   Un compteur par verbe dans `Contribution` (qui existe déjà et porte six colonnes) rendrait la
   question décidable en une heure.

### D · Il n'y a aucun soin — les héros sont une ressource qui ne se renouvelle pas — **[STRUCTURE]**

`processWave` rend les PA (`h.PA = h.MaxPA - pénalités`) et **ne rend jamais un point de vie**. Les
seules sources de PV du jeu sont :

| source | ce qu'elle exige |
|---|---|
| Potion / Ambroisie | Atelier niv. 2-3 + ingrédients — jamais atteint dans les runs mesurés |
| Infirmerie (`heal`) | un plan qui ne tombe que d'une ruine |
| Mairie (`revive`) | un plan qui ne tombe que d'une ruine |
| Évolution de classe | +2 PV par point d'endurance, **deux fois par partie**, aux jours 2 et 4 |

Autrement dit : dans la partie type, **un héros blessé le reste jusqu'à sa mort, et un héros mort
l'est définitivement**. Mesuré : 12 → 8 héros vivants à 4 joueurs ; 60 → 38 à 20 joueurs. L'attrition
est un aller simple.

Ce n'est pas une punition intéressante, c'est une punition muette : le joueur ne perd pas parce
qu'il a mal joué une vague, il perd des héros par sédimentation, sans jamais avoir eu de décision à
prendre à ce sujet. Et ça aggrave A et B — la garnison, qui est la moitié de la défense, se vide
mécaniquement pendant que la horde monte.

### E · Le combat iso est le levier le plus puissant du jeu, et il est mal tarifé — **[STRUCTURE]**

Deux lignes de code, prises ensemble, créent le plus gros trou d'équilibrage du projet :

- `combat.go` : `n := monster.Count; if n > 4 { n = 4 }` — **une arène ne contient jamais plus de
  4 créatures**, quelle que soit la taille du pack.
- `actions.go` `FinishCombat` : sur une victoire, `delete(g.Monsters, t.MonsterID)` — **le pack
  ENTIER disparaît**.

Or les packs fusionnent en migrant (`mergePacks`) et le journal a mesuré des packs de ~186 créatures
à la vague 30. Donc : **un combat 4 contre 4, de difficulté strictement identique du début à la fin
de la partie, peut retirer 186 créatures de l'anneau d'assaut** — c'est-à-dire ~186 points de
`hordePower`, soit plus du double du plafond de défense de la ville, pour une bataille qui ne coûte
pas un seul PA à engager.

Trois conséquences :

1. La difficulté du jeu ne dépend pas de la horde mais du **nombre de combats que le joueur accepte
   de jouer à la main**. Deux groupes également compétents, l'un qui aime le tactique et l'autre
   non, ne jouent pas au même jeu — et l'écart se compte en dizaines de vagues.
2. Le simulateur ne le voit pas (les bots n'engagent que ce qu'ils jugent gagnable et n'abattent que
   5 à 8 % de la horde : 69 tués sur 1 196 unités à 4 joueurs, 456 sur 2 678 à 20). **L'équilibrage
   est donc calibré sur un joueur qui n'utilise presque pas l'action la plus forte du jeu.**
3. Le butin ne suit pas non plus : un pack de 3 et un pack de 186 rendent **le même objet par
   héros**. La récompense matérielle est décorrélée de l'enjeu.

À l'inverse, l'énorme travail du mode tactique (2 181 lignes, armes-archétypes, techniques, vision,
recharges, hauteurs) sert un mode que rien n'oblige jamais à ouvrir. C'est le système le plus cher
du jeu et le plus facultatif.

### F · La progression de personnage est une horloge, pas un accomplissement — **[STRUCTURE]**

`EvolveHero` ne vérifie qu'une chose : `g.Day >= cls.Day`. Pas d'XP, pas de condition, pas de coût.
Le jour 2 tombe à la vague 4, le jour 4 à la vague 8. Dans une partie qui dure 17 vagues :

- **toute la progression de héros du jeu est terminée à 47 % de la partie** ;
- elle est **identique pour un joueur qui a tout fait et pour un joueur qui s'est connecté deux
  fois** — les deux évolutions arrivent à la même vague, avec les mêmes bonus ;
- après la vague 8, un héros ne peut plus progresser que par l'équipement, qui exige un Atelier
  niveau 2 que les runs mesurés n'atteignent pas.

Le corollaire est visible dans le code : **`Hero.Bars` est écrit à 7 endroits et lu nulle part.**

```
forage.go:113   h.Bars["collecte"]++      actions.go:247  h.Bars["collecte"]++
actions.go:81   h.Bars["athletisme"]++    actions.go:437  h.Bars["combat"]++
actions.go:111  h.Bars["athletisme"]++    mapskills.go:139 h.Bars["combat"]++
actions.go:144  h.Bars["athletisme"]++
```

Son commentaire dit *« montent selon les actions, influencent les classes »*. Elles n'influencent
rien, ni côté serveur ni côté client (zéro lecture dans `frontend/src`). C'est exactement le motif
que le projet a déjà corrigé trois fois — `StateSoif` posé par personne, le « moral de la ville »
qui n'existait pas, l'Athlétisme lu par aucune ligne. **Le champ existant est la bonne réponse à un
problème qu'on n'a pas branché** : la barre qui monte quand on récolte devrait être ce qui ouvre le
Récupérateur, et le fait qu'elle soit déjà écrite au bon endroit rend le chantier petit.

---

## 3. Incohérences plus petites, mais qui se corrigent en une heure

- **La cadence du jeu est contradictoire entre deux documents.** `CLAUDE.md` : « 1 in-game day =
  12 h real, 2 monster waves/day » → vague toutes les **6 h**, soit **4 vagues par jour réel**.
  `RETENTION-PLAN.md` §1 : « 2 vagues / jour réel → `WaveInterval` **12 h** ». Le code ne tranche
  pas (défaut 10 min, `ECHOTERRA_WAVE_SECONDS`). Conséquence : une partie de 17 vagues dure **4,25
  jours** ou **8,5 jours** selon la lecture — et tout le raisonnement de rétention (§1 de
  RETENTION-PLAN : « 7 à 9 jours », « deux sessions par jour ») est bâti sur la seconde. Il faut en
  choisir une et l'écrire dans le code.
- **Les compétences de carte sont sept fois la même.** `mapskills.go` : 8 entrées, dont **7 de
  `Kind: "blast"`** et une `snipe`. La différenciation de classe sur la carte est un icône, un
  chiffre de base et une statistique. Ce n'est pas rien, mais ce n'est pas six identités.
- **« L'épuisement de la carte est la vraie limite d'une longue partie » est faux, tel que mesuré.**
  (Affirmé dans `CLAUDE.md`, § Réparer la VILLE.) À 20 joueurs, graine 1, la colonne des ressources
  connues restantes vaut **1 483 de la vague 14 à la vague 25** — elle ne bouge pas d'une unité
  pendant que la ville meurt. La limite n'est pas le stock, c'est le **débit** : le nombre de PA
  disponibles pour aller chercher et rapporter. Le Verger, qui répond au stock, répond donc à un
  problème qui n'existe pas.
- **`Tétanisé` et `Caché` ne se déclenchent quasiment jamais** : maximum **1** héros tétanisé et
  **0** héros caché, sur tous les runs, à toutes les tailles. Deux états entièrement implémentés
  (dont un avec son propre fichier de tests exhaustif) pour un phénomène qui n'arrive pas. À
  vérifier côté joueur humain avant d'en conclure quoi que ce soit — mais si le comportement humain
  ressemble à celui du bot, `heroesPerPack = 4` est réglé trop haut.

---

## 4. Le diagnostic en une phrase

**Echo Terra a beaucoup plus de systèmes que sa boucle n'a de PA pour les toucher.**

L'inventaire des mécaniques est celui d'un jeu de plusieurs centaines d'heures : 16 bâtiments à
3 niveaux, 29 recettes, 6 classes, 7 statistiques, 5 archétypes d'arme avec techniques, 11 espèces
avec grilles d'attaque, ruines-donjons, mémoriaux, faveur des dieux à trois panthéons, 3 thèmes avec
contraintes propres, brouillard à trois états, belvédères, escarpements, météo.

Le budget d'un joueur est de **18 PA par vague**, et une partie dure **17 vagues**. Soit **306 PA
pour la vie entière d'un joueur** — le prix de trois bâtiments menés au niveau 3 (Mairie 120 +
Tour 90 + Cuisine 72 = 282 PA), déplacements, fouilles et réparations non comptés.

La conséquence se lit dans toutes les mesures : la majorité des systèmes livrés ne s'allume jamais
dans une partie réelle. Ce n'est pas un problème de qualité — chaque système pris isolément est bien
conçu, bien testé et bien documenté. C'est un problème de **budget** : le jeu produit du contenu
plus vite qu'il ne produit d'occasions de le rencontrer.

⚠ Et l'erreur à ne pas faire serait d'augmenter les PA. Les PA sont ce qui fait tenir la promesse
« deux petites sessions par jour ». **Ce n'est pas le budget qu'il faut monter, c'est le prix qu'il
faut baisser et le nombre de systèmes qu'il faut réduire.**

---

## 5. Ce que je changerais, par ordre de valeur / effort

### 5.1 · Trois corrections d'une demi-journée chacune

1. **Rapprocher le croisement défense / horde de la vague 3-4.** Aujourd'hui la ville démarre avec
   22 de défense de bâtiments (mur 1 = 10, portail 2 = 12) doublables par la garnison, contre une
   horde de 11 à 16. Deux leviers, et il faut prendre celui du haut : monter `hordeBase` (6, avec
   `hordeGrowth` 2) plutôt que **faire démarrer le portail au niveau 1** comme le reste du
   catalogue — ⚠ ne PAS toucher aux durabilités de départ, le journal du 2026-08-02 documente que
   les livrer usées était précisément un bug. Objectif mesurable et vérifiable au sweep :
   **premier point de dégât avant la vague 4 sur toute graine**, `SurvivalFloor = 12` toujours
   tenu, et la courbe d'échelle (1 < 4 < 20) préservée.
2. **Tarifer le combat sur la taille du pack.** `n > 4 → 4` doit rester (une arène de 186 est
   injouable), mais alors la victoire ne doit pas supprimer le pack entier : elle doit en retirer
   `unités abattues × k`. C'est une ligne dans `FinishCombat`, et ça rend l'équilibrage
   *interprétable* — aujourd'hui il n'a pas de sens de calibrer une horde qu'un seul combat peut
   effacer. Faire suivre le butin (un pack plus gros rend plus).
3. **Écrire la cadence dans le code** (`WaveInterval` par défaut à la valeur cible, pas 10 min) et
   aligner les deux documents. Tout le raisonnement de rétention en dépend.

### 5.2 · Deux chantiers d'une semaine

4. **Brancher `Hero.Bars` sur l'évolution.** Le champ existe, il est écrit aux bons endroits, il
   n'est lu nulle part : faire d'`EvolveHero` un « jour ≥ N **et** barre ≥ seuil », et faire des
   barres le critère qui oriente vers une classe plutôt qu'une autre (`botEvolve` choisit déjà sur
   les statistiques, il choisirait sur les barres). Coût faible, effet direct sur F, et ça donne
   enfin un sens au fait de récolter beaucoup plutôt que peu.
5. **Donner un soin de base.** Le moins cher, et cohérent avec le dilemme existant : **un héros qui
   passe la vague DANS les murs récupère quelques PV**. Ça n'ajoute aucun système (c'est une ligne
   dans la boucle de `processWave` qui rend déjà les PA), ça renforce le dilemme central au lieu de
   le diluer, et ça retire la punition muette de D sans supprimer l'attrition (un héros dehors, lui,
   ne guérit toujours pas).

### 5.3 · La décision de fond, qui n'est pas technique

6. **Arrêter d'ajouter des systèmes, et rendre atteignables ceux qui existent.** Concrètement, le
   prochain lot devrait être un lot de **suppression et de dégagement**, pas d'ajout :
   - abaisser le coût des plans de bâtiments de BASE (Mairie, Tour, Cuisine) pour que la partie
     type en construise trois ou quatre au lieu de zéro — ⚠ **en baissant le coût, pas la
     condition** : voir §7, une rareté qu'on lève à l'aveugle rend un solo capable de bâtir la
     ville entière, ce que le pilier collaboratif interdit ;
   - remonter le poids du **Bois** en forêt au niveau de la Pierre en montagne, et faire de la
     Pierre une ressource dont l'ordre du jour parle explicitement comme du carburant de survie
     qu'elle est ;
   - laisser tomber, ou fusionner, ce qui ne s'allume pas : le Verger répond à un problème mesuré
     comme inexistant ; les sept `blast` de `mapskills.go` gagneraient à devenir trois verbes
     vraiment différents plutôt que sept variantes.

> **Le fil rouge des six recommandations est le même** : le jeu n'a pas besoin de plus de contenu,
> il a besoin que son joueur rencontre celui qu'il a déjà. Aujourd'hui une partie de quatre joueurs
> traverse dix-sept vagues sans construire un bâtiment, sans soigner un héros, sans que la ville
> perde un point de vie avant la onzième — dans un jeu qui contient seize bâtiments, quatre
> mécaniques de soin et une horde qui fusionne en packs de cent quatre-vingts.

---

## 6. Ce que cet audit n'a pas pu trancher

Trois questions demandent un joueur humain, pas un simulateur, et méritent d'être posées avant
d'agir sur les recommandations qui en dépendent :

- **Combien de combats iso un vrai joueur engage-t-il par vague ?** Toute la recommandation 2 en
  dépend. `GET /api/metrics` existe désormais ; il manque un compteur de combats par partie.
- **Un joueur humain se fait-il Tétaniser ?** Si oui, le constat de §3 tombe et `heroesPerPack` est
  bien réglé.
- **La phase plate de A est-elle vécue comme vide, ou comme une installation tranquille ?** Cinq
  jours sans menace peuvent être un tutoriel généreux plutôt qu'un temps mort — mais il faudrait
  alors que le jeu le DISE, et l'ordre du jour ne parle aujourd'hui que d'urgences.

---

## 7. Addendum — le pilier collaboratif (précision de Guillaume, 2026-09-13)

> « L'idée est collaborative, il ne faut pas qu'un joueur puisse tout faire tout seul. »

Cet énoncé est un **critère d'acceptation**, et l'audit de §2 ne l'avait pas appliqué. Je l'ai donc
passé sur le code. Le résultat est net, et il est plus grave que les six problèmes précédents parce
qu'il touche la prémisse.

### 7.1 · Ce qui, dans tout le paquet `game`, exige un second joueur

**Une ligne.**

```
requests.go:124   if req.PlayerID == g.OwnerOfHero(heroID) {
                      return nil, ActionError{"se servir soi-même n'est pas rendre service"}
```

C'est tout. Aucune autre action du jeu — construire, améliorer, réparer, fouiller, craft, combattre,
déblayer une ruine, bâtir un belvédère, voter une bénédiction, ouvrir ou fermer la porte — ne
regarde jamais de QUI viennent les mains. Le scrutin du Temple lui-même n'a **aucun quorum**
(`resolveBlessingVote` élit dès `Votes > 0`) et les joueurs-IA ne votent pas : dans une expédition
d'un humain et de robots, **un joueur seul élit le dieu de la ville**.

### 7.2 · Pourquoi : l'équipe de trois est une expédition complète en miniature

La cause n'est pas un oubli, elle est dans la structure — et le jeu la documente lui-même, dans
`bots.go` :

> *« Un joueur aligne trois héros (`HeroesPerPlayer`), et le jeu demande exactement trois choses en
> parallèle : `roleBuilder` — reste en ville ; `roleDefender` — dégage l'anneau ; `roleGatherer` —
> rapporte le bois et la pierre. »*

Et `heroRole` distribue ces trois rôles par **rang dans l'équipe** (`i % 3`), précisément pour
garantir « un de chaque » à **chaque joueur pris isolément**. Autrement dit : le jeu a identifié
trois fonctions nécessaires, puis a donné à chaque joueur exactement une de chacune. **Un joueur
n'est pas un membre de l'expédition, c'est une expédition miniature.**

Le combat dit la même chose : l'arène offre **7 places de héros** (`spawnX`) contre **4 créatures
au maximum** (`n > 4 → 4`, §2.E). Les trois héros d'un seul joueur suffisent donc à remporter
n'importe quel combat du jeu, boss compris. Aucune bataille ne demande d'être deux.

### 7.3 · Le diagnostic : un multijoueur ADDITIF, jamais COMPLÉMENTAIRE

Tout dans le jeu **scale** avec le nombre de joueurs — la garnison, les PA de chantier, la
prospection, les combats menés — et **rien ne se GATE** dessus. Quatre joueurs, c'est un joueur
quatre fois, jamais quatre quarts de quelque chose.

La conséquence est exactement celle que Guillaume redoute, et elle est mesurable : **il n'existe
aucune action du jeu qu'un solo ne puisse accomplir ; il n'existe que des actions qu'il accomplit
plus lentement.** La coopération est un accélérateur de débit, pas une condition de capacité. Or
« survie de groupe » promet le second.

⚠ Et c'est ce qui rend ma recommandation 6 (« abaisser massivement la rareté des plans ») fausse
telle que je l'avais écrite : elle réglait §2.C — la ville ne construit rien — au prix du pilier.
Un plan commun, c'est une ville qu'un joueur seul finit par bâtir entière.

### 7.4 · Le bon patron existe déjà dans le code, et il ne sert qu'une fois

`ScoutWave` (`orders.go`) est la mécanique qui fait exactement ce qu'il faut :

- observer coûte 2 PA à un héros ;
- mais **le registre `Town.Scouts` retient le JOUEUR, pas le héros** — une équipe ne peut observer
  qu'une fois par vague, « laisse la place aux autres » ;
- et **l'effet est collectif** : la fourchette de prévision se resserre pour toute la ville.

C'est la forme complète : un **coût individuel**, un **plafond par joueur distinct**, un **bénéfice
partagé**. Trois joueurs y voient plus clair qu'un joueur qui aurait trois fois plus de PA. C'est
le seul endroit du jeu où l'effectif produit une chose qu'un solo ne peut pas produire — et il n'y
en a qu'un.

### 7.5 · La contradiction qu'il faut trancher AVANT de coder quoi que ce soit

Le projet a investi lourdement dans le chemin inverse, et ce n'est pas un accident :

- `POST /api/games/solo` — un bouton « 🤖 Solo » sur l'écran titre, privée + 4 bots, lancée
  immédiatement ;
- `MaybeStartWithEscort` (R4) — au bout de 90 s, une expédition publique part avec une **escorte de
  joueurs-IA** plutôt que de faire attendre ;
- `LeaderboardMode` — le mode **solo** est une catégorie de classement à part entière, et une
  expédition d'un humain entouré de robots y est rangée ;
- `SurvivalFloor = 12` est vérifié **à 1 joueur** : le contrat d'équilibrage exige aujourd'hui
  qu'une ville tenue par un seul joueur tienne douze vagues.

**On ne peut pas maximiser les deux.** Toute mécanique qui exige un second joueur rend le mode solo
strictement moins capable, et fera tomber le plancher à 1 joueur. Il faut choisir, explicitement :

| | Ce que ça implique |
|---|---|
| **A · Le solo est un mode d'entraînement** | Les bots comptent comme des joueurs distincts pour les portes collaboratives. Le pilier tient entre humains, le solo reste jouable. **Le moins coûteux, et je le recommande.** |
| **B · Le solo est déclassé** | Les portes exigent des joueurs HUMAINS distincts. Le pilier est pur, mais `SurvivalFloor` à 1 joueur doit être abaissé ou retiré, et le bouton Solo requalifié en démo. |
| **C · Statu quo** | Le pilier reste une intention, pas une règle. À écrire noir sur blanc plutôt qu'à laisser croire. |

⚠ L'option A a un piège à documenter : si un bot compte comme un joueur distinct, l'escorte IA
ouvre toutes les portes, et un humain accompagné de quatre robots retrouve exactement l'autonomie
qu'on voulait lui retirer. La version tenable est **« un bot compte, mais jamais pour plus de la
moitié des voix requises »**.

### 7.6 · Quatre portes collaboratives, du moins au plus risqué

Toutes reprennent le patron 7.4 (coût individuel, plafond par joueur distinct, bénéfice partagé) et
n'ajoutent aucun système : elles posent une condition sur des données que le serveur tient déjà
(`OwnerOfHero`, `Contributions`, `Town.Scouts`).

1. **Quorum au Temple** — une bénédiction exige **deux voix distinctes**. Une ligne dans
   `resolveBlessingVote`, et le pilier mythique devient une décision de groupe au lieu d'un bouton.
   Aucun risque d'équilibrage : ne pas invoquer est déjà l'état par défaut.
2. **L'arène demande du monde** — borner à **2 les héros d'un même joueur** dans un combat (7 places
   disponibles). D'une pierre deux coups : ça rend collaboratif le système le plus cher du jeu
   (2 181 lignes que rien n'oblige à ouvrir) et ça atténue §2.E, où un joueur seul efface un pack de
   186 créatures. ⚠ à combiner avec un repli quand personne d'autre n'est en ligne, sinon un joueur
   isolé face à un pack sur sa case est bloqué — le pilier ne doit jamais devenir un mur.
3. **Le chantier veut plusieurs mains** — l'achèvement d'un niveau exige des PA d'au moins **deux
   joueurs distincts**. `Contributions` compte déjà les PA de chantier par joueur : la donnée est là.
   C'est le levier le plus fort — il touche le système-vitrine — et le plus dangereux : il faut le
   passer au sweep avant de le croire, parce que §2.C dit qu'aujourd'hui la ville ne construit
   presque rien, et qu'une porte de plus pourrait la faire tomber à zéro.
4. **Les rôles ne tiennent plus dans une équipe** — la porte de fond, et celle que je ne
   recommande pas encore : tant que trois héros couvrent bâtisseur + défenseur + récolteur, le
   joueur est autonome **par construction** (7.2), et toutes les portes ci-dessus resteront des
   verrous posés par-dessus une structure qui les contredit. Y toucher (limiter les branches de
   classe qu'une même équipe peut tenir, par exemple) est un chantier de fond qui demande son
   propre document et son propre sweep. À poser maintenant comme une question, à ne pas coder
   dans la foulée.

### 7.7 · Le critère d'acceptation, pour qu'on puisse trancher par la mesure

Le pilier ne sera pas tenu tant qu'on ne pourra pas produire cette phrase à partir du simulateur :

> *« Voici N choses qu'une expédition de quatre accomplit et qu'une expédition d'un seul
> n'accomplit JAMAIS, quel que soit le temps qu'on lui laisse. »*

Aujourd'hui **N = 1** (honorer une requête du Panneau). C'est le chiffre à faire monter, et c'est
lui qu'il faut instrumenter — pas la survie, qui ne dit que le débit.

