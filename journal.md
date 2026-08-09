# Journal de développement — Echo Terra

> **But** : journal inter-sessions pour Claude (et Guillaume). Chaque session de travail ajoute une
> entrée en HAUT : date, ce qui a été fait, ce qui est **fonctionnel (vérifié)**, ce qui reste à faire.
> Le `CLAUDE.md` reste la référence des systèmes ; ce journal trace l'historique et l'état d'avancement.

---

## 2026-08-09 (97) — Le clic vise ce qu'on voit, pas le sol derrière

Retour de l'utilisateur : « quand je veux cliquer sur la case pour faire une action, le perso se
déplace au lieu de m'ouvrir la pop up qui liste les actions possibles ».

### La cause : 1,73 case d'écart entre ce qu'on vise et ce qu'on touche

`VoxelMapView.onTap` résolvait le tap par le SEUL point d'impact du rayon sur le **terrain** ; tout ce
qui est posé dessus — héros, monstres, ruines, village de la case ville — était traversé en silence. Or
la caméra est dimétrique à **30°** : un point situé à la hauteur `h` au-dessus du sol se projette là où
le sol se trouve `h/tan(30°) ≈ 1,73` unité plus loin, réparti sur x ET z (azimut 45°). **Cliquer le
torse d'un héros touchait donc le sol une à deux cases DERRIÈRE lui.** Selon le relief et la position du
personnage sur sa case, la case ainsi désignée tombe :

- **orthogonale** → le héros PART (c'est le bug rapporté) ;
- **en diagonale** → le store ignore le clic, **rien ne se passe** (l'autre moitié du symptôme, jamais
  rapportée parce qu'un clic mort passe pour une maladresse).

Mesuré avant correctif, sur une équipe sortie ensemble : clic sur le corps du héros sélectionné →
« déplace-toi en (10,11) », un peu plus haut → rien ; seul un clic sur ses PIEDS ouvrait le menu.

### Le correctif : les objets disent quelle case ils occupent

Une étiquette `userData.pickTag {x, y, heroId?}` est posée sur les modèles (rig, billboard de repli,
étiquette de nom), les monstres, les ruines et le village de la case ville ; `onTap` remonte la
hiérarchie du premier objet touché et **préfère cette case au terrain masqué**. `heroId` n'est posé que
sur MES héros, et il vaut sortie immédiate : taper un personnage, c'est le viser LUI — menu d'actions
s'il est déjà sélectionné, sélection sinon — **jamais marcher**. Ça règle du même coup un conflit plus
ancien : un coéquipier debout sur une case voisine ne pouvait pas être tapé, l'adjacence gagnait
toujours.

Corollaire trouvé en écrivant le test : `engine.pick` fait désormais `scene.updateMatrixWorld(true)`.
Le raycast lit `matrixWorld`, que THREE ne met à jour qu'au rendu — et le moteur est on-demand : un
objet reconstruit par un `draw()` et pas encore rendu serait resté à l'origine, donc invisible au
picking. En jeu ça ne se voyait pas (un tap suit toujours un rendu), mais le picking ne doit pas
dépendre de ça.

La vue de COMBAT n'était pas touchée : elle enregistrait déjà chaque mesh de rig dans `unitOf`.

### Fonctionnel (vérifié)

Nouveau garde-fou `frontend/tests/map-tap.mjs` (`npm run test:map-tap`, dev servers + Chromium), qui
rejoue le geste dans un vrai navigateur, `bus.emit` intercepté pour lire l'INTENTION sans jouer le coup :

- taper le héros piloté, des pieds à la tête → menu d'actions à chaque hauteur (jamais un déplacement) ;
- taper un coéquipier sur la case voisine → sélection (jamais un déplacement) ;
- taper le SOL d'une case voisine → déplacement, comme avant.

3/3 après correctif ; **le même test tombe à 2/3 sur le code d'avant** (`MOVE(12,11)` là où on attend
une sélection). `npx tsc -b` vert.

### À faire

Les **props** (arbres, rochers) ne sont pas étiquetés : ils sont instanciés, donc l'étiquette devrait
être par instance. Un gros arbre planté devant une case avale encore le clic vers le terrain qui le
suit. Rare et sans conséquence (aucun déplacement erroné : la case résolue est diagonale), mais c'est
le même piège.

---

## 2026-08-09 (96) — La fenêtre d'accueil des expéditions publiques

Demande : qu'une partie publique **se lance** dès le minimum de joueurs atteint, mais qu'elle reste
**ouverte 1-2 jours** aux suivants — en visant à terme 2 vagues par jour réel.

### La fenêtre se compte en VAGUES, pas en heures

C'est la seule décision qui comptait vraiment. `WaveInterval` vaut dix minutes en développement et six
heures en cible ; « deux jours » ne veut donc dire la même chose dans les deux cas que compté en vagues.
`PublicJoinGraceWaves = 4` : quatre vagues, soit deux jours de jeu ET deux jours réels à la cadence
visée, sans rien à retoucher le jour où l'intervalle change.

`GameState.JoinOpen()` répond à « peut-on encore embarquer ? » : un salon toujours, une expédition
publique pendant sa fenêtre, une partie privée jamais après son lancement (son hôte choisit qui entre,
et il la lance délibérément — il n'y a personne à attendre).

### Ce que ça a demandé ailleurs

- **Accueillir vraiment.** Les rations du puits sont calculées au lancement sur l'effectif d'alors ;
  sans complément, chaque nouveau venu boirait la réserve des autres et accepter du monde se paierait en
  soif. `AddPlayer` complète le puits et trace l'arrivée au journal de la ville.
- **Une colonne miroir de plus** (`join_open`). « Ce que je peux rejoindre » n'est plus « statut lobby »,
  donc filtrer en Go après le `LIMIT` rendrait invisible exactement l'expédition qu'on veut rejoindre —
  le piège déjà rencontré avec `status` (entrée 2026-08-02). `store.OpenForJoin` répond en SQL, et le
  backfill couvre les lignes écrites avant la colonne, sans quoi un salon existant deviendrait
  injoignable.
- **Un seul point d'accueil à la fois.** Le serveur ouvrait un salon neuf dès l'auto-lancement. Avec la
  fenêtre, ça séparerait les joueurs entre deux parties — exactement ce que la fenêtre veut éviter. Le
  salon suivant naît quand les portes de l'expédition en cours se ferment (ou qu'elle est complète).
- **`?status=open`** à la place de `?status=lobby` côté front : c'est la question que le joueur pose
  vraiment. La liste affiche « ⚔️ En route — jour 2, vague 3 » avec un badge « 2 VAGUES » de compte à
  rebours, et rejoindre une partie déjà lancée entre directement en jeu.

### Un test existant a dû être restagé, et c'est instructif

`TestForceWaveNormalDamagesTown` échouait : depuis que la puissance de la horde compte les créatures
massées aux abords (entrée 95), une ville dont les approches sont vides n'encaisse plus que la pression
de fond. Le test mesurait donc une ville que personne n'attaquait. Il pose maintenant un siège — et
vérifie au passage que les packs qui portent l'assaut s'y brisent.

### Fonctionnel (vérifié)

`go -C backend test ./...` vert (4 tests de fenêtre côté game, 2 côté API, 1 côté store),
`npx tsc -b` et `npm run build` verts.

### Question posée juste après : « est-ce que le niveau s'ajuste avec l'arrivée du joueur ? »

En partie seulement — et la mesure a montré bien pire que ce que la question visait.

`hordeScale` compte les héros, donc une arrivée fait monter la **pression** d'environ un point dès la
vague suivante, et le puits est complété. Mais le semis initial ne tourne qu'au lancement, et le renfort
par vague ne dépendait pas de l'effectif. Surtout, la difficulté suivait la **carte**, or la carte d'un
salon public est taillée pour `maxPlayers` alors que la partie démarre à `minPlayers`. Résultat mesuré :

| | chutes |
|---|---|
| 2 joueurs, carte à leur taille (42²) | 15-17 |
| **2 joueurs, carte de salon public (134²)** | **29-30** |
| 20 joueurs, même carte | 21-23 |

Une expédition sous-remplie était donc **le mode facile du jeu**. Et la cause n'était pas le nombre de
monstres : les packs naissaient jusqu'à soixante-dix cases de la ville et migrent d'une case par vague —
**la horde n'arrivait jamais**.

Deux corrections :

- **Le front a un rayon fixe** (`hordeFrontRadius` 14) : la horde qui assiège cette ville vient de ses
  environs, pas des antipodes. Le délai d'arrivée devient le même à toutes les tailles. Le semis
  INITIAL reste réparti sur toute la carte — c'est du peuplement de monde, pas de la pression.
- **La menace suit l'expédition, pas la surface** (`SeedStartingMonsters` : `4 + 3×joueurs + surface/1200`).

Une troisième piste a été essayée puis **retirée** : faire dépendre aussi le renfort par vague de
l'effectif. L'expédition pesait alors sur la horde à trois endroits et la courbe de survie devenait
plate de 1 à 20 joueurs. Et sur un jeu coopératif, accueillir quelqu'un ne doit pas empirer la situation
de ceux qui sont déjà là : une arrivée apporte trois héros contre un point de pression — elle AIDE, et
c'est le seul réglage acceptable pour une fenêtre d'accueil.

Après : sweep 14 · 14 · 15 · 17 · 18 · 18 (1 → 20 joueurs, croissance monotone), et le salon
sous-rempli passe de 30 à 17 vagues. `TestUnderfilledPublicLobbyIsNotEasyMode` garde le résultat.

### À faire

- La fenêtre est la même pour tout le monde ; si tu veux qu'un hôte la règle par partie, elle est déjà
  isolée dans une constante et un accesseur (`JoinClosesAtWave`).
- Un joueur qui rejoint à la vague 3 arrive dans une ville déjà bâtie mais face à une horde pondérée par
  l'effectif d'après son arrivée : à observer en vrai, la simulation d'équilibrage ne modélise pas
  encore les arrivées échelonnées.

---

## 2026-08-09 (95) — Tuer compte, et vingt joueurs vont plus loin qu'un

Trois demandes liées : que **tuer des monstres compte pour la survie**, monter à **20 joueurs** avec
une **carte qui grandit**, et que la difficulté monte avec l'effectif *mais* qu'une grande expédition
aille **plus loin** qu'un solo.

La troisième était mathématiquement impossible avant : le plafond de défense d'une ville (muraille 20 +
portail 16 + tour 12 = 48) ne dépend pas du nombre de joueurs, alors que la horde, elle, montait avec.
Des joueurs en plus n'apportaient donc que des monstres en plus. Les trois demandes se règlent en fait
avec la même pièce.

### La puissance de la horde a maintenant deux termes

```
puissance = pression(vague) + créatures massées dans le rayon d'assaut
```

La **pression** est un plancher qui monte quoi qu'on fasse (le monde se dégrade, on ne gagne pas). L'**assaut**
est la horde réellement présente aux abords au moment où elle frappe — et ce terme-là, on le fait baisser
en tuant. Les packs qui ont porté l'assaut s'y brisent, le calcul se faisant avant qu'ils ne soient retirés.

Conséquence immédiate mesurée : les vagues 1 à 7 deviennent quasi gratuites tant que l'anneau est tenu
(PV 100/100 à la vague 12 contre une ville morte avant), et les kills passent de 12 à 42 par partie.

### Les bots ont un troisième rôle

Bâtisseur / **défenseur** / récolteur, par rang dans l'équipe. Le défenseur dégage l'anneau — depuis que
la puissance en dépend, c'est de la défense, pas du sport — et porte une **laisse** : sur une carte de
120², les défenseurs partaient au bout du monde et personne ne tenait l'anneau. Premier essai sans
laisse : 21 créatures tuées en huit vagues pendant que le siège montait à 57 points de dégâts.

### Ce qui faisait s'effondrer les grandes parties

Deux causes, toutes deux invisibles sans la simulation :

- **Des packs naissaient DANS l'anneau d'assaut.** `spawnSafeRadius` valait 1, l'anneau en fait 2 : à
  vingt joueurs, neuf packs se matérialisaient au pied des murs au lancement. Un pack qui apparaît là est
  un pack que personne n'a laissé passer — injouable. Le siège doit ARRIVER, pour qu'on puisse
  l'intercepter.
- **Le gisement garanti était un absolu.** Douze tuiles de montagne dans le rayon 8, que la ville abrite
  trois héros ou soixante : vingt équipes se partageaient la carrière d'un solo. Mesuré à vingt joueurs :
  banque à ZÉRO pierre, muraille bloquée au niveau 1, chute vague 8 — quand huit joueurs tenaient vingt
  vagues. Le quota suit désormais la surface (`biomeQuota`), comme la population.

### La carte suit l'expédition

`worldgen.SizeForPlayers` : surface par joueur constante (~900 tuiles, la densité d'une partie à quatre
sur 60×60), bornée à 140² parce que chaque tuile voyage dans le payload JSON. 1 joueur → 40², 4 → 60²,
20 → 134². Comme la horde semée croît avec la surface, c'est aussi ce qui fait monter la difficulté avec
l'effectif, comme demandé.

### Résultat

| joueurs | 1 | 2 | 4 | 8 | 12 | 20 |
|---|---|---|---|---|---|---|
| chute médiane | 16 | 16 | 19 | 23 | 24 | **21** |
| pire graine | 15 | 15 | 16 | 21 | 21 | **19** |

Vingt joueurs vont plus loin qu'un seul, et le plancher de vingt (19) dépasse la médiane du solo (16).
Un test l'encode (`TestBigExpeditionsGoFurther` : 15,7 vagues en solo contre 21,7 à vingt) — ce n'est
pas un acquis, c'est un contrat, parce que l'arithmétique par défaut dit l'inverse.

### Fonctionnel (vérifié)

`go -C backend test ./...` vert, `npx tsc -b` et `npm run build` verts, balayage 1→20 joueurs. Front :
sélecteur « joueurs maximum » jusqu'à 20 à la création d'un salon, salon public ouvert à 20.

### À faire

- Le creux 12 → 20 joueurs (médiane 24 puis 21) tient au plafond de carte à 140² ; à surveiller si tu
  veux aller au-delà de 20.
- Les 60 héros d'une grande partie génèrent un payload de carte lourd (140² tuiles) : le brouillard les
  envoie vierges, mais le tableau reste. À mesurer avant d'ouvrir vraiment des parties à 20.

---

## 2026-08-09 (94) — Tester une partie automatiquement, et la rendre jouable

Demande : « planifier puis implémenter un moyen de tester automatiquement une partie pour voir si le
jeu est jouable et équilibrer + améliorer le comportement des bots. Il ne faut pas que le jeu soit
perdu au bout de 10 vagues. »

### D'abord l'instrument, ensuite les réglages

`backend/internal/balance` joue une partie ENTIÈRE en tête, sans mock : vrai worldgen, vrais
joueurs-IA, vraie horloge de simulation (`game.AdvanceTo` — le chemin exact du battement en
production). Un verdict de la simulation est donc un verdict sur le jeu. Deux consommateurs :
`go -C backend run ./cmd/balance` (tables vague par vague, balayage 1→6 joueurs, `-json`) et
`balance_test.go`, le garde-fou de non-régression.

Le premier verdict est tombé en une commande : **les cinq graines mouraient à la vague 5**, défense 9
contre une horde de 45. Aucun test ne l'avait jamais vu, parce qu'aucun test n'avait jamais JOUÉ.

### Ce que la mesure a trouvé (dans l'ordre où elle l'a trouvé)

Chaque point ci-dessous a été diagnostiqué sur des chiffres, pas sur une intuition — et plusieurs
étaient invisibles à la lecture du code.

- **La porte ne se fermait jamais.** Seul « je veux sortir » y touchait. −12 à −16 de défense à
  chaque vague. Elle a maintenant un RYTHME collectif (`botGateWork`) : ouverte le jour, verrouillée
  au couvre-feu, un bâtisseur reste en ville pour la manœuvrer.
- **Les réparations affamaient la récolte.** Il y a toujours un mur à rafistoler après une vague,
  donc `botBuild` répondait « oui » à tout le monde, tous les tours : personne n'atteignait jamais le
  code qui rouvre la porte. Ville close dès le jour 1, douze héros à trois cases de la ville à la
  vague 8 avec une montagne découverte à quatre cases. D'où la RÉPARTITION DES RÔLES (un héros sur
  trois est bâtisseur et ne sort pas ; les autres récoltent).
- **Le sac se comptait en PILES, pas en objets** (`len(h.Inventory)`) : les récolteurs campaient
  indéfiniment avec deux cents objets et une Banque vide.
- **Le dernier PA d'un héros dehors est son PA de dissimulation.** Sans cette réserve, tous les
  récolteurs étaient morts avant la vague 9 (3 + numéro de vague de dégâts par vague à découvert).
- **Un héros Tétanisé attendait la mort** : il ne peut ni bouger, ni fouiller, ni se cacher — les
  bots n'utilisaient jamais Escape, la seule porte que les règles laissent ouverte.
- **La horde ne s'usait jamais.** 130 packs et 660 créatures à la vague 12, ville encerclée, héros
  incapables de rentrer. Les packs arrivés au pied des murs s'y BRISENT désormais
  (`spendAssaultingPacks`) — c'est ce que l'assaut raconte de toute façon.
- **Zéro pierre en banque, sur toute la partie.** Trois causes empilées : la carte n'avait que 21
  tuiles de montagne sur 3600 et la garantie « au moins UNE dans le rayon 10 » se contentait d'un
  caillou perdu ; `heroSightRadius` valait 0, donc on ne trouve jamais un biome qu'on ne longe pas ;
  et la montagne était le biome le plus PAUVRE alors qu'elle porte la matière dont la ville est
  faite. Corrigés : gisement garanti (12 tuiles dans le rayon 8), vision 1 (Éclaireur 2), carrière
  aussi riche que la prairie.
- **La pierre récoltée était brûlée dans la seconde** en rafistolage de PV. Un niveau de muraille
  vaut +5 de défense sur TOUTES les vagues suivantes ; cinq PV valent une vague. Les bots réservent
  maintenant les matériaux de la défense (`reservedForDefense`) et ne rapiècent la ville qu'avec le
  surplus — ou en urgence sous 50 % de PV.
- **« On a besoin de bois ET de pierre » n'est pas un plan** quand la forêt est à côté et la
  montagne cinq cases plus loin : à score de distance égal on récolte du bois pour toujours. Le
  barème pèse désormais la RARETÉ (`botCriticalList`).

### Deux mécaniques ajoutées, pas seulement des réglages

- **Relever les remparts** (`TownAction("wall","repair")`, 1 PA + 1 Pierre → +5 PV, bouton dans le
  modal du mur). Rien dans le jeu ne rendait de PV à la ville : `Town.HP` ne faisait que descendre,
  donc toute partie était un compte à rebours quoi que fassent les joueurs. C'est cette action qui
  fait de l'ÉPUISEMENT DE LA CARTE — et non de l'arithmétique de la horde — la vraie limite d'une
  longue partie, comme le demandait le brief.
- **Courbe de horde revue.** L'ancienne (`12 + 6×vague`) dépassait dès la vague 6 le total qu'une
  ville PARFAITE peut opposer (20+16+12 = 48) : aucune partie n'était gagnable, jamais. Désormais
  `8 + 3×vague`, pondérée DOUCEMENT par la taille de l'expédition (`hordeScale`). La pondération est
  douce parce que c'est mesuré : des joueurs en plus n'apportent pas de défense en plus (le plafond
  est le même à 3 héros qu'à 18) — une première version en ×1,33 à six joueurs inversait la courbe,
  les grandes tables tombaient AVANT les solos.

### Résultat

| | avant | après |
|---|---|---|
| chute médiane (4 joueurs) | vague **5** | vague **15** |
| pire graine, toutes tailles | vague 5 | vague **12** |
| défense atteinte | 9 (mur seul, porte ouverte) | 20-26 |
| pierre en banque | 0 | flux réel |

`SurvivalFloor = 10` est encodé dans `balance_test.go` et couvre 1, 2, 4 et 6 joueurs ; un
`TestTownActuallyProgresses` vérifie en plus que la ville CONSTRUIT, récolte, tue et évolue — parce
qu'une ville peut survivre en ne faisant rien si la horde est assez faible, et ce n'est pas un jeu.

### Fonctionnel (vérifié)

`go -C backend test ./...` vert (5 tests existants mis à jour pour dire le NOUVEAU comportement
voulu, pas pour repasser au vert), `npx tsc -b` vert, `go run ./cmd/balance -sweep` sur 1→6 joueurs.

### Deuxième passe : le plafond, et la marge

La première passe laissait la défense bloquée vers 24 alors que 48 est atteignable. La cause tenait en
une phrase : **tous les niveaux 2-3 du design réclament un matériau CRAFTÉ** (Planche, Corde, Brique,
Acier) et les bots n'allaient jamais à l'atelier. `botCraft` fabrique désormais ce qui manque, et
**recycle les Débris** en Bois/Pierre quand la Recyclerie est debout — la réponse du design à une carte
qui se vide, donc exactement ce qui doit porter la fin d'une longue partie. Effet immédiat : défense
39, et la ville se SOIGNE (PV 39 → 95 entre les vagues 10 et 12 sur la graine 1).

Trois autres choses trouvées en mesurant :

- **Le rôle de bâtisseur tenait à un hash d'identifiant.** « Environ un sur trois » ne dit rien d'une
  ÉQUIPE donnée : un bot dont les trois héros tombaient tous en récolteurs n'avait personne pour la
  porte, les chantiers ni l'atelier — la ville ne construisait jamais rien. Le rôle vient maintenant du
  RANG dans l'équipe (le 1er héros reste), donc exactement un bâtisseur pour trois.
- **La simulation ne répondait pas deux fois pareil à la même graine** (chute vague 13 ou 19). Deux
  itérations de map fuyaient dans l'état : la fusion des packs en migration et le forçage des tours de
  combat. Triées par POSITION désormais (les id sont des UUID, les trier ne fixe rien). C'est un vrai
  défaut au-delà de l'outil : toute l'architecture repose sur « rejouer le temps écoulé », donc deux
  instances rejouant la même période doivent aboutir au même monde.
- **Les grandes tables étaient punies deux fois.** `SeedStartingMonsters` ajoutait 2 packs par joueur
  ET `hordePower` pondérait déjà par l'effectif : une table de six ouvrait sur 3,5× plus de packs qu'un
  solo pour le même plafond de défense. Pente aplatie.

Enfin la MARGE : sur 20 graines, une tombait pile à la vague 10 — le seuil que le jeu doit garantir.
`hordeBase` passe de 8 à 6 (la base fait le démarrage, la pente fait la fin de partie).

| | avant | 1re passe | après |
|---|---|---|---|
| chute médiane (4 joueurs) | 5 | 15 | **16** |
| pire graine, toutes tailles | 5 | 11 | **12-13** |
| défense atteinte | 9 | 20-26 | **jusqu'à 39** |
| PV de ville | jamais rendus | réparables | réellement regagnés en jeu |

Le garde-fou couvre maintenant 1→6 joueurs × 3 graines, vérifié stable sur quatre exécutions.

### Troisième passe : pourquoi les bots ne se battaient pas — et une trouvaille de design

`botShouldEngage` exigeait « au moins autant de héros que le pack aligne d'unités ». Ça sonne prudent,
c'est en fait un refus de combattre : **`NewCombat` plafonne le pack à QUATRE unités quelle que soit sa
taille**, donc la règle voulait dire « quatre héros sur la même case » — alors que toute la logique de
récolte les écarte délibérément les uns des autres. Le critère est désormais la PUISSANCE, et le lot est
énorme : gagner supprime le pack ENTIER, pas les quatre qui se sont battues. S'y ajoutent le renfort
(`botRallyTile` : un camarade tétanisé à moins de 4 cases passe avant la liste de courses — c'est LA
façon documentée de briser Tétanisé, aucun bot n'y allait) et le fait de tenir bon quand l'aide est à un
pas, plutôt que de tenter une fuite qui échoue une fois sur quatre.

**Mesuré : 11 combats gagnés pour 2 perdus.** Le critère n'était donc pas trop laxiste — les combats
n'avaient simplement jamais lieu (1 à 6 par partie).

Mais la mesure a surtout dit autre chose, et c'est un point de DESIGN à trancher :

> **Tuer des packs ne change rien à la survie de la ville.** `hordePower` est une pure fonction du
> numéro de vague : nettoyer les abords ne réduit pas les dégâts d'un seul point. Le combat ne sert
> qu'au butin, au classement et à libérer un héros cloué.

Une tentative de faire passer le sauvetage AVANT le retour du butin l'a confirmé par l'absurde : la
survie a BAISSÉ (une graine de 19 à 15). Les matériaux font vivre la ville, pas les cadavres. La priorité
a donc été remise dans l'autre sens. Si tu veux que défendre le terrain compte, il faut que la horde
tire sa puissance des packs réellement présents aux abords — c'est une règle à changer ensemble, je ne
l'ai pas décidée seul.

Médiane après cette passe : 15 à 18 vagues selon la taille de l'expédition (plancher 11 à six joueurs,
le cas le plus serré ; 13 et plus partout ailleurs).

### À faire

- **Six joueurs reste le cas le plus tendu** (plancher 11 contre 16-18 en solo) : plus de héros = plus de
  monstres semés et plus d'exposés dehors, pour un plafond de défense identique.
- **Décider si tuer des monstres doit compter** (voir ci-dessus) — aujourd'hui, non.
- **Les récolteurs meurent encore en fin de partie** (une graine perd 5 héros sur 7 avant la
  vague 7) : la horde qui converge les tétanise loin de la ville. Piste : se regrouper pour combattre
  (`botShouldEngage` exige des héros sur LA MÊME case, ce qui n'arrive jamais).
- **Déterminisme incomplet** : les deux fuites trouvées sont bouchées, mais la même graine peut encore
  varier de quelques vagues — il reste des consommations de hasard dépendantes d'un ordre de map à
  débusquer. Le garde-fou est stable, l'outil d'exploration reste à lire avec cette réserve.
- Faire tourner le balayage sur plus de graines et brancher `cmd/balance` en CI.

---

## 2026-08-02 (93) — Le moment de la vague

Retour : « ça va lagguer un peu côté client au moment de la vague, il faudrait faire quelque chose de
stylé ».

### D'abord mesurer, pour savoir ce qu'on masque

Trois mesures, en forçant des vagues jusqu'à 1 200 créatures sur une carte au brouillard levé :

| | coût |
|---|---|
| `POST /advance` (résolution serveur) | ~30 ms, **pic à 1 265 ms** |
| `world.draw()` (reconstruction des overlays) | **1-3 ms**, même à 842 créatures |
| première frame rendue après la vague | **450 → 1 100 ms** (GL logiciel, donc pessimiste) |
| `refreshGame()` complet | 11-43 ms |

Donc le redessin n'est PAS le problème — c'est la résolution serveur (bien pire en déploiement, où la
fonction se réveille et où Neon répond) et la frame GPU qui suit l'apparition des monstres. C'est cette
fenêtre-là, et pas une autre, que la cinématique doit couvrir.

### La décision qui compte : tout en CSS

**L'animation est en CSS pur, sur `transform`/`opacity` uniquement.** Une cinématique pilotée en JS
(rAF, compteurs animés) se figerait précisément à l'instant qu'elle est censée masquer, puisque c'est le
thread principal qui maille et qui rend. Les keyframes composables tournent sur le compositeur.

Vérifié plutôt que supposé, et le premier essai de vérification était faux : lire
`Animation.currentTime` avant/après un blocage ne prouve rien (cette valeur est mise à jour par le
thread principal, elle ne peut pas bouger pendant qu'il est bloqué — elle affichait « 0/6 animations ont
avancé »). La bonne mesure passe par la capture d'écran, qui vient du processus navigateur : **90 % des
pixels changent entre deux captures prises pendant un blocage de 1,2 s du thread principal**.

### Ce que ça donne

Deux temps. **Frappe** (1,6 s) : le ciel vire au rouge et couvre la carte, « VAGUE N » arrive comme un
tampon, secousse d'impact, « −N PV ». **Rapport** : carte parchemin, horde vs défense, PV restants,
bâtiments et héros touchés, renforts. Taper pendant la frappe saute au rapport.

Le voile a été monté d'un cran après une première capture : joli mais si clair au centre qu'il ne
masquait pas la carte — or masquer est sa seule fonction.

### Le cas fréquent qu'on aurait raté

Sur un jeu asynchrone, on revient le plus souvent APRÈS plusieurs vagues. Or l'état chargé les contient
déjà : il n'y a rien à différencier, et le premier jet ne se déclenchait pas du tout dans ce cas — c'est
à dire dans le cas le plus courant. La trace locale `echoterra:waveSeen:<gameId>` (dernière vague vue +
PV de la ville à ce moment) donne le nombre de vagues manquées ET le cumul réel des dégâts, en UNE
cinématique : « 3 vagues pendant ton absence — −78 PV », en-tête « Vagues 2–4 ».

### Deux bugs trouvés en chemin

- **`WaveReport.buildingsHit`/`heroesHit` étaient `nil` côté Go**, donc `null` en JSON alors que le type
  annonce un tableau. Lire `.length` dessus plantait le rendu — et le même motif existait déjà dans
  `refreshGame`, où l'exception était avalée par le `catch` du sondage : la carte ne se redessinait alors
  plus jusqu'au sondage suivant. Slices initialisées côté serveur, `?? []` côté client pour les rapports
  déjà enregistrés.
- **`EscapeHero` ne coupait pas la fouille automatique une fois sur quatre** : il y a 25 % de chance de
  trébucher, et ce chemin sortait de la fonction avant mon `StopForaging`. Trouvé par une flakiness de
  `forage_test.go` — le test avait raison.

### Fonctionnel (vérifié)

- Timeline mesurée dans le navigateur : frappe de 189 à 743 ms, rapport à 1 715 ms.
- Retour après absence : « 3 vagues pendant ton absence », cumul −78 PV, en-tête « Vagues 2–4 ».
- Bâtiments touchés plusieurs fois dans la même vague : cumulés (« Panneau -5 · Panneau -11 » ne veut
  rien dire).
- `go test ./...`, `npx tsc -b`, `npm run build`, `npm run test:perf` (12/12) verts.

### À faire / à savoir

- La cinématique ne se déclenche qu'au SONDAGE (20 s) : une vague peut donc tomber jusqu'à 20 s avant
  d'être annoncée. Déclencher un `refreshGame` quand le compte à rebours atteint zéro serait mieux.
- `serverless/TestHandlerServesAPI` **échoue sous `-count>1`** : `Handler` initialise son store via
  `sync.Once`, donc le second run réutilise le `t.TempDir()` du premier, déjà supprimé. Limite du
  harnais, pas du produit (vert en `-count=1`) — mais ça piège quand on cherche une flakiness.
- Pas de son : le moment gagnerait énormément à un tambour + un impact. Rien n'est câblé côté audio
  aujourd'hui.

---

## 2026-08-02 (92) — La fouille devient un POSTE : premier PA, puis récolte automatique

Deux demandes liées, à partir de l'incohérence relevée au lot précédent.

### 1. Une case épuisée reste fouillable

Le serveur prévoyait déjà le cas (`depletedFindPct` : 25 % d'une vraie ressource, sinon des Débris — et
la Recyclerie existe pour les transformer), mais le client désactivait le bouton dès `resources <= 0`.
Le mode était donc écrit, testé… et inatteignable en jeu. La garde est retirée des deux endroits qui la
portaient (`MapTab`, `HeroActionsMenu`) et un test la fige côté serveur.

### 2. Le PA achète une installation, pas une trouvaille

Nouveau fonctionnement : fouiller coûte toujours 1 PA, mais le héros **reste sur place et continue de
fouiller tout seul, gratuitement**, tant qu'il ne bouge pas. Le bouton devient « 🔄 Fouille auto » avec
le temps restant avant la prochaine trouvaille.

**L'intervalle est une fraction de la vague, pas un nombre de minutes.** `ForageInterval() =
WaveInterval / 6`. Le rythme du jeu est réglé par `ECHOTERRA_WAVE_SECONDS` (10 min en dev, 6 h en
déploiement) : une constante en minutes aurait donné 72 trouvailles entre deux vagues en réel, et la
fouille manuelle n'aurait plus servi à rien. Un sixième donne six récoltes par période — exactement les
six PA d'un héros, donc poster un héros vaut à peu près une journée de fouille à la main.

**C'est une TROISIÈME horloge de la simulation**, et c'est le point qui a décidé de l'architecture. Un
minuteur côté client aurait été inutile : Echo Terra tourne sans personne de connecté. La récolte est
donc entrelacée chronologiquement avec les vagues et les rounds de bots dans `AdvanceTo`, avec son
propre budget (`SimBudget.Forages`) et son propre plafond de retard — sans ça, une partie oubliée trois
jours aurait déversé des milliers d'objets d'un coup dans les sacs.

Elle passe **avant** une vague due au même instant : une récolte antérieure doit avoir eu lieu avant que
la horde ne blesse (donc n'interrompe) le héros.

**Ce qui interrompt** : bouger, s'échapper, se cacher, entrer en combat, être Tétanisé, tomber. Les trois
derniers ne repassent par aucune action du joueur, ils sont donc vérifiés paresseusement (`canForage`,
appelé par `nextForage`) — un héros tétanisé par une vague est désinstallé à la première échéance.

**Pourquoi il n'y a pas de plafond de sac** (le sac n'en a aucun aujourd'hui) : la case s'épuise et ne
rend plus que ~75 % de Débris, un héros posté hors des murs se fait frapper à CHAQUE vague, et
transformer les Débris coûte 1 PA à la Recyclerie. Camper est un pari, pas un revenu.

### Fonctionnel (vérifié)

- `forage_test.go` : le PA n'est payé qu'à la première fouille, la récolte tourne dans la simulation,
  budget respecté ET repris là où il s'est arrêté, plafond de retard, interruptions (déplacement,
  cachette, fuite, Tétanisé, mort), fouille autorisée sur case épuisée, intervalle qui suit
  `WaveInterval`.
- Bout en bout (serveur à `ECHOTERRA_WAVE_SECONDS=120`, donc récolte toutes les 20 s) : après 65 s
  **sans aucune action**, le héros a +3 objets et **exactement les mêmes PA** ; la récolte est toujours
  installée ; un pas l'interrompt ; fouiller une case à 0 ressource renvoie 200 (« Bois ×1 » sur ce
  tirage) et réinstalle la récolte.
- Navigateur : le bouton passe de « 🔎 Fouiller -1 » à « 🔄 Fouille auto 00:16 », le compte à rebours
  descend (00:16 → 00:10), et la barre des héros l'explique en clair.
- `go test ./...`, `npx tsc -b`, `npm run build`, `npm run test:perf` (12/12) verts.

### À faire

- Le compte à rebours peut rester à « 00:00 » quelques secondes : la récolte est jouée par la
  simulation, donc elle n'arrive au client qu'au sondage suivant (20 s). Assumé — afficher zéro est plus
  honnête que de faire semblant d'avoir trouvé. Un rafraîchissement déclenché à l'échéance serait mieux.
- Les bots héritent de la mécanique (ils fouillent par les actions publiques) mais `BotAct` les fait
  bouger souvent, donc ils n'en profitent presque pas. À regarder si on veut qu'ils campent aussi.
- Rien n'indique sur la CARTE quels héros sont en train de récolter (seulement le héros sélectionné) ;
  un liseré sur la pastille des autres serait utile.

---

## 2026-08-02 (91) — La carte redevient on-demand ; vue de dessus, pas instantané, cases épuisées

### 1. La carte rendait 35 fps en permanence

Les deux checks rouges de `test:perf` (« carte on-demand », « rendu stoppé hors de l'onglet Map »)
avaient **une seule cause**, et ce n'était pas les nuages : `UnitAnimator.tick` réarmait son rAF
« tant qu'il reste une unité ». Comme l'idle (respiration, battements d'ailes) ne s'arrête jamais,
la carte demandait une frame par tour de rAF dès qu'un héros existait — c'est-à-dire toujours.
Mesuré : 102 rendus en 3 s au repos. Sur téléphone, c'est la batterie dépensée pour une respiration
qu'on ne regarde pas ; et ça contredisait le contrat posé quand les nuages ont été retirés de la
carte pour exactement la même raison.

Le correctif inverse le rôle de l'animator sur la carte. Il avait deux métiers confondus : **poser**
les rigs et **demander** des frames. On les sépare :

- `pose()` est passif — il ne demande rien. La carte le branche sur le nouveau
  `engine.onBeforeFrame`, donc les rigs sont posés sur les frames que quelqu'un d'AUTRE demande
  (rotation de caméra, redraw, déplacement). C'est ce qui garde la respiration vivante sans qu'elle
  coûte une seule frame à elle seule. Avant le rendu et non après : posés après, les rigs face-caméra
  accusaient une frame de retard, visible quand la caméra tourne.
- la boucle ne tourne plus que tant qu'il se **passe** quelque chose (un pas, un one-shot, une mort),
  via `idleDrivesFrames: false`. Le combat et la ville, eux, gardent l'idle permanent (scènes légères,
  et on veut de la vie devant soi).
- `setActive(false)` coupe tout quand on quitte l'onglet Map. La vue reste MONTÉE toute la partie
  (la démonter rendait l'ouverture de l'onglet interminable) et n'est que masquée en CSS : c'était
  donc à elle de se taire. La prop `active` existait déjà dans la signature… et était jetée par un
  `void active;`. Le cycle solaire est mis en pause avec, et rattrapé d'un coup au retour.

**Le compteur du test était faux aussi.** Après correctif il affichait encore 17 rendus/3 s. En
instrumentant `invalidate()` : **un seul appel** (le tick solaire, toutes les 5 s) produisait ces 17.
`renderer.info.render.frame` compte les appels de rendu, or depuis que le mode beauté est le défaut
(#38) la passe bloom en enchaîne une quinzaine pour UN redraw. Le test mesurait donc le coût d'un
redessin en croyant compter les redessins. `VoxelEngine.frames` compte désormais les redraws, et
c'est ce que la suite regarde. 12/12.

### 2. Vue de dessus sur la carte

Le bouton 🔼/🎥 du combat, tel quel, sur la carte : à 30° les reliefs cachent ce qu'il y a derrière
eux (un pack, une ruine, un héros au pied d'une falaise). `engine.setTopDown` ne change QUE
l'élévation — azimut, zoom et cible sont conservés, on retrouve sa vue en ressortant.

### 3. Le pas ne s'aligne plus sur le serveur

`store.move` n'affichait rien avant la réponse HTTP : un aller-retour entre le doigt et le premier
pixel, alors que l'animation de marche (lerp + petit saut, 320 ms) était déjà là et n'attendait
qu'une position qui bouge plus tôt. On applique donc le pas localement avant d'envoyer.

`predictMove` est un **miroir de `game.MoveHero`** — c'est sa force et sa fragilité : toute règle
ajoutée côté serveur et oubliée ici produirait un héros qui avance puis revient. D'où le parti pris :
**le doute vaut refus de prédire**, et `predictMove` renvoie `null` (on attend le serveur, comme
avant) dès qu'une condition n'est pas certaine. Le cas qui justifie à lui seul ce choix : une case
**sous le brouillard**. Le serveur y renvoie une tuile vierge, donc le client ignore son biome ;
marcher sur de l'eau inconnue coûte 1 PA et laisse le héros sur place — indevinable.

Deux garde-fous : un compteur `moveSeq` (une réponse doublée par un pas plus récent est ignorée,
sinon le héros reculait le temps d'un aller-retour) et, en cas d'échec, un `refreshGame()` plutôt
qu'un rollback bricolé à la main.

### 4. Les cases épuisées se voient

`Tile.resources` à 0 : la fouille n'y rend plus grand-chose, et rien ne le disait — il fallait
marcher dessus et lire un bouton grisé. Un InstancedMesh de quads (un seul mesh : une carte bien
explorée peut compter des milliers de cases épuisées) marque la case au sol.

Deux essais. Un **aplat brun uniforme** d'abord : mesuré à 17/255 d'écart moyen, il se confondait
avec les variations du terrain, et le monter assez pour se voir noircissait la moitié de la carte.
Une **texture de terre retournée** ensuite — des taches couvrant à peine la moitié de la case : 37/255
d'écart, ça se lit comme un marqueur (aucun terrain ne ressemble à ça) sans assombrir quoi que ce soit.

⚠ Le piège : `resources === 0` tout seul ne veut RIEN dire, le fog renvoie une tuile **vierge** pour
tout ce qui n'est pas découvert — donc `resources: 0` ET `biome: 0`. Le test est
`discovered && resources <= 0 && biome !== 0 && pas la case ville`.

### Fonctionnel (vérifié)

- `npm run test:perf` : **12/12** (0 redraw en 3 s au repos, 0 hors de l'onglet Map).
- Navigateur : pas rendu en **0-1 ms** au lieu de 29-93 ms (réponse serveur) ; trois pas enchaînés
  sans attendre donnent une trajectoire strictement croissante (11,11 → 12,11 → 13,11 → 14,11) et
  3 PA restants — le compteur de séquence tient ; bouton de vue de dessus (`aria-pressed`, `.on`,
  caméra à 78°) ; voile des cases épuisées présent, sans fuite de géométrie sur 5 redraws forcés.
- `go test ./...`, `npx tsc -b`, `npm run build` verts.

### À faire

- **Incohérence trouvée en chemin, non corrigée** (décision de game design) : le serveur laisse
  fouiller une case épuisée (`depletedFindPct` = 25 % d'une vraie ressource, sinon des Débris — et
  `craft.go` mentionne le recyclage des Débris), mais le client **désactive** le bouton Fouiller dès
  `resources <= 0` (`MapTab.tsx`, `HeroActionsMenu.tsx`). Ce mode est donc inatteignable en jeu. Soit
  on rouvre le bouton, soit on retire le code serveur.
- `predictMove` duplique la règle de `MoveHero` dans un autre langage. Aucun test ne les compare ;
  un test de conformité (rejouer une table de cas contre les deux) serait le vrai filet.

---

## 2026-08-02 (90) — Durabilité de départ, vraies listes de persos, et la messagerie de la ville

Quatre retours de jeu, du plus petit au plus gros.

### 1. Les bâtiments démarrent à 100 %

`DefaultBuildings()` semait des durabilités arbitraires — muraille **20/100**, portail 40/100, banque
80/100. Rien ne le justifiait côté design, et comme `buildingDefense` est proportionnelle au ratio de
durabilité, la ville ouvrait la vague 1 avec **2 de défense** face à une horde de puissance 18. Tout
bâtiment construit démarre désormais intact ; la défense de départ passe de 2 à 10 (26 portail fermé).
L'usure, c'est le travail des vagues. Test `TestFreshTownStartsAtFullDurability`.

### 2. Une seule pastille de héros, partout

Le jeu avait TROIS listes de héros qui ne se ressemblaient pas. La barre de la Carte montrait portrait,
PV, PA, lieu ; le dropdown de la TopBar était le dernier îlot de **verre bleu nuit** de l'interface (un
panneau `--glass-2` et du `#fff` posés sur une application parchemin) et n'affichait qu'un nom et deux
chiffres ; l'écran Ville, lui, affichait la **classe** du héros et — tant qu'il n'en avait pas, donc
toute la première journée — un tableau de secours codé en dur : « Pionnier », « Récupérateur »,
« Éclaireur ». Trois libellés qui n'étaient le nom de personne, une initiale, une ★ décorative.

`components/HeroChip.tsx` extrait la bonne pastille (celle de la Carte) et les trois listes s'en
servent. L'écran Ville devient une vraie liste de PERSONNAGES — et taper un héros en ville en fait
l'ouvrier qui paie les PA, ce qui est justement la décision qu'on prend sur cet écran. Le dropdown
repasse au parchemin, avec les tokens du design system.

En le faisant, un bug ancien est tombé : le badge « en ville » s'appelait `.mhb-badge.town` et héritait
donc de la règle GLOBALE `.town { position:absolute; inset:0 }` — il s'étalait sur tout le portrait,
qu'il recouvrait d'un rectangle. **Troisième fois** que ce piège frappe (après l'onglet Ville et le nom
de ville de la TopBar). Renommé `intown`, et `turn` pour le marqueur de tour de `CombatHeroBar`.

### 3. La messagerie de la ville, et la Poste

Les deux bulles de l'écran Ville (« Neko : … », le bandeau Shinki 🦊) étaient des répliques codées en
dur reprises de la maquette : la promesse d'une fonctionnalité que rien ne tenait.

Elle existe maintenant, et sa règle est **POSITIONNELLE** : un héros vivant sur la case ville écrit et
lit librement ; en expédition on est hors de portée — sauf si la ville a bâti la **Poste**. Ce n'est
donc pas un salon greffé sur le jeu : c'est une chose qu'on peut perdre (tout le monde dehors, pas de
Poste) et qu'on peut rebâtir, comme le Puits ou le Portail. Le message parti du terrain est marqué 📮.

Deux décisions de fond :

- **Le board ne transite JAMAIS par le payload de partie.** La lecture est gatée PAR JOUEUR et
  `ClientView` ne sait pas qui appelle : il remplace `Town.Chat` par `Town.ChatCount` (juste la pastille
  de non-lus) et le contenu passe par `GET /town/chat`, gatée. Cette route **n'appelle pas `tick()`** —
  la faire passer par la simulation multiplierait rattrapages de vagues et écritures SQL par la cadence
  de sondage (4 s feuille ouverte).
- **La modération masque, elle ne refuse pas.** Un message rejeté punit le faux positif d'une erreur que
  le joueur ne peut pas corriger (« quel mot ? ») ; masqué, la conversation continue. Le matcher
  travaille **jeton par jeton** parce que la normalisation change les longueurs — masquer par indice sur
  une copie normalisée étalerait le masque sur les mauvais caractères. Normalisation : minuscules,
  accents dépliés, leet (`0→o`, `4→a`…), `*` traité comme un **joker positionnel** (« f\*ck »), lettres
  répétées réduites. La liste est **stricte par défaut** (égalité + suffixes FR) ; la correspondance par
  sous-chaîne est réservée aux mots longs et sans ambiguïté. Sont volontairement ABSENTS « retard » (« je
  suis en retard »), « crever » (« je crève de soif » — c'est un état de jeu), « rape » (« fromage
  râpé »), « con »/« conne » (« cône ») : la moitié coûteuse d'un filtre, ce sont les mots qu'il ne doit
  PAS toucher, et un test de non-régression les fige.

La **Poste** est un bâtiment complet, calqué sur la Recyclerie : plan lootable (prairie/sable poids 2-3,
ruines ferme et sanctuaire), matériaux et PA par niveau, prérequis Panneau, parcelle polaire à 70° et
**modèle voxel dédié** `bld-poste` (relais de chaume, auvent à coursiers, boîte aux lettres rouge, cor
de laiton sur la façade). Deux allers-retours sur le modèle : le cor traversait le toit, et la boîte aux
lettres disparaissait sous le débord — le pourtour du toit couvre tout le corps, un objet ne se voit
qu'en AVANT de la façade.

Et un piège de fond : `DefaultBuildings()` ne tourne QU'AU worldgen. Sans rien, la Poste n'aurait jamais
atteint aucune partie déjà enregistrée. `Recompute` → `backfillBuildings()` ajoute à l'état neuf tout
bâtiment du catalogue qui manque, sans toucher aux existants — ce qui règle aussi tous les ajouts futurs.

### Fonctionnel (vérifié)

- `go test ./...` vert, dont `chat_test.go` (les trois chemins d'accès, Poste en ruine, héros mort, cap,
  anti-flood par joueur, backfill idempotent) et `moderation_test.go` (masquage, accents, leet, joker,
  **et la liste des phrases françaises ordinaires à ne pas toucher**).
- Bout en bout sur une vraie partie (curl) : durabilités 100/100 et défense 10 au lancement ; message
  modéré publié (`●●●`) ; tous les héros sortis → GET **et** POST refusés en 400 ; Poste bâtie → lecture
  et écriture rétablies, message `remote:true` ; deuxième message immédiat refusé (anti-flood) ;
  `GET /api/games/{id}` ne contient **aucun** texte de message, seulement `chatCount`.
- Bout en bout dans le navigateur (Playwright) : la liste de l'écran Ville affiche « Aventurier, Brisa,
  Cael » (plus de « Pionnier/Récupérateur/… »), le dropdown est en parchemin, l'envoi d'un message
  ressort masqué et la bulle de la Ville le reprend, la sortie de tous les héros bascule la feuille sur
  le panneau verrouillé (champ de saisie retiré), la Poste apparaît dans Bâtir et se pose proprement sur
  le tertre sans mordre un voisin ni la route.
- `npx tsc -b` et `npm run build` verts. `npm run test:perf` : 10/12, **les 2 échecs sont antérieurs**
  (vérifié en stashant : la branche de base échoue pareil sur « carte on-demand » / « rendu stoppé hors
  onglet », 102 rendus contre 119). Le payload voxel passe de 77 à 81 fichiers, toujours 2,00 MiB.

### À faire

- Les 2 échecs `test:perf` (boucle de rendu continue sur la carte) sont un vrai problème de batterie,
  antérieur à ce lot — à traiter pour lui-même.
- Modération : pas de signalement ni de masquage par joueur (décision : v1 masque et publie). Si le
  multi public prend, `VoteKick` est le modèle existant à reprendre.
- La Poste n'a aucun effet mécanique aux niveaux 2 et 3 (effets textuels) — cap de messages ou historique
  plus long seraient les candidats naturels.

---

## 2026-08-02 (89) — La recherche de partie publique était aveuglée par les parties actives

Retour : *« j'ai l'impression que la recherche de partie publique ne marche plus »*. C'était vrai,
et ce n'était PAS le classement — un bug latent que le battement (#52) a rendu systématique.

### Le diagnostic

`listGames` faisait `store.List(50)` (les 50 parties les plus RÉCEMMENT ÉCRITES) **puis** filtrait
`status == "lobby"` en Go. Or les deux populations n'ont pas du tout le même rythme d'écriture :

- un **salon** est écrit à sa création, puis plus jamais tant que personne ne le rejoint ;
- une partie **active** est réécrite à chaque vague **et par le battement toutes les 15 min**.

Donc dès qu'il existe 50 parties actives, elles occupent toute la fenêtre et le salon public en sort :
`GET /api/games?status=lobby` renvoie `[]` et l'écran reste bloqué sur « Recherche de parties… ».
Reproduit à l'identique : base neuve → 1 salon listé ; on crée 55 parties → 0 salon listé.

Le même motif cassait **quatre autres chemins** avec la même fenêtre : `joinByCode` (rejoindre par
code échouait pour un salon sorti de la fenêtre), `ensurePublicLobby` (ne voyant plus le salon
existant, il en aurait créé des DOUBLONS), `housekeeping` et `lobbyJanitor` (purge aveugle).

### Le correctif

`store.ListByStatus(status, limit)` : le filtre passe **dans le SQL**, sur la colonne miroir `status`
déjà ajoutée par le battement (`migrateGameColumns`) — c'est exactement ce pour quoi elle existe.
Les cinq appelants (`listGames`, `joinByCode`, `ensurePublicLobby`, `housekeeping`, `lobbyJanitor`)
l'utilisent et perdent leur filtre en Go. `List()` reste pour le listing non filtré.

### Fonctionnel (vérifié)

- **Sur la base de la reproduction** (1 salon + 55 parties actives plus fraîches) : avant `[]`,
  après le correctif → « Expédition de Lunegarde » de nouveau listée. Aucun doublon créé.
- Rejoindre par code vérifié sur une base saturée (salon privé + 30 parties écrites après lui) : OK.
- `go test ./...` vert, avec `TestListByStatusIgnoresFresherGames` qui fige la régression
  (60 parties actives ne doivent pas chasser le salon de `ListByStatus(lobby, 50)`).

### À faire

- `List(50)`/`List(200)`/`List(500)` restent des fenêtres arbitraires ; à l'échelle réelle il
  faudra de vrais index (et une pagination) plutôt qu'un `LIMIT` généreux.

---

## 2026-08-02 (88) — Classement des villes, trié par nature de partie

Reprise de la PR #13 (« leaderboard », jamais mergée, base du 13/07 très en retard) : on en
garde **le classement et les noms de ville**, on jette la refonte TopBar/BottomNav de l'époque
(le design system de juillet l'a remplacée), et on ajoute ce qui manquait — **le tri entre
villes solo et villes publiques/privées**.

### Fait

- **`game/townnames.go`** : générateur de noms français (racine + terminaison + épithète
  occasionnelle, ~10k combinaisons). `Town.Name` posé au worldgen (`newWorld`), donc TOUTE
  partie (solo, publique, privée, test) a une ville nommée. Les salons publics du serveur
  s'appellent désormais « Expédition de <Ville> » (deux salons successifs se distinguent ;
  la déduplication de `housekeeping` porte sur la visibilité, pas sur le nom — rien ne casse).
- **`GameState.MonstersKilled`** : incrémenté dans `CastMapSkill` (à hauteur de `rep.Slain`,
  couvre les 7 compétences de carte) et dans `FinishCombat` (le pack entier tombe avec le
  combat, donc `m.Count` — ce qui couvre AUSSI les combats auto-résolus des bots, qui passent
  par là).
- **`GameState.Solo`** + **`LeaderboardMode()`** : `POST /api/games/solo` marque la partie ;
  le classement en tire trois natures qui **ne se comparent pas** — `solo` / `public` /
  `private`. Repli pour les parties d'avant le drapeau : privée + 1 humain + ≥1 bot = solo.
- **Table `leaderboard`** (SQLite ET Postgres) : une ligne par partie LANCÉE (les salons sont
  exclus), remise à jour à chaque `Save` **et à chaque `SaveIfUnchanged`** — sans ce second
  point, une ville qui survit uniquement grâce au battement ne monterait jamais au tableau.
  La ligne **survit à la suppression de la partie**. Colonne `mode` ajoutée par `ALTER TABLE`
  idempotent pour les bases existantes. Seuls les joueurs HUMAINS sont listés.
- **`GET /api/leaderboard[?mode=solo|public|private]`** : top 50, `ORDER BY waves DESC,
  monsters_killed DESC, updated_at DESC` ; un mode inconnu répond 400.
- **`LeaderboardScreen`** (bouton « 🏆 Classement » de l'écran titre, qui affichait
  « bientôt ») : 4 onglets **Toutes · Solo · Publiques · Privées**, chacun refait la requête
  avec son `?mode=`. Ligne = rang (🥇🥈🥉) · nom de VILLE · pastille d'état ⚔️/💀 · badge de
  mode (onglet « Toutes » seulement) · joueurs · vague / jour / monstres tués.
- **TopBar** : affiche le nom de la VILLE (repli sur le nom de partie) — c'est lui qui figure
  au classement, il faut pouvoir la reconnaître en jeu.

### Fonctionnel (vérifié)

- `go test ./...` vert (nouveaux : `achievements_test.go` — compteur de kills sort/combat +
  `LeaderboardMode` ; `store_test.go` — `TestLeaderboardSavesAndRanks` et
  `TestLeaderboardFiltersByMode`).
- `tsc -b` + `npm run build` verts.
- **Bout en bout sur un vrai serveur** : partie solo → `mode:"solo"` ; lobby privé à 2 humains
  lancé → `mode:"private"` ; salon public → « Expédition de Ormecombe-la-Forêt » ; jets de
  pierre répétés sur un pack → `monstersKilled` passe à 1 **et remonte dans
  `/api/leaderboard`** ; `?mode=zzz` → 400.
- **Captures Playwright** en 390px et 1024px, 4 onglets : pas de débordement horizontal.
  Deux passes de correction de mise en page ont été nécessaires (le nom de ville en nœud de
  texte nu ne pouvait pas rétrécir et chevauchait la colonne des scores ; la barre à 4 onglets
  débordait faute de `min-width:0`).

### À faire

- Le classement ne connaît que « vagues survécues » et « monstres tués » — les bâtiments
  construits / ressources récoltées seraient de bons départages supplémentaires.
- Pas de mise en avant de MA ville dans la liste (surlignage du rang du joueur connecté).
- Les parties de test legacy (`POST /api/games`, 0 joueur) atterrissent en « privées ».

---

## 2026-08-01 (87) — Le monde tourne sans personne : horloge de simulation + battement

Retour : *« je suis déployé sur Vercel, il faut m'assurer que les games continuent
(surtout le timer) même s'il n'y a pas de requêtes HTTP, et les bots doivent jouer aussi »*.

### Le diagnostic

Vercel s'endort (scale-to-zero) : aucune goroutine ne survit, donc rien n'avançait sans
requête — mais surtout, **le rattrapage paresseux existant PERDAIT du temps de jeu** :

- `CatchUpWaves` était borné à **3 vagues** puis faisait `NextWaveAt = now + interval` —
  une partie absente 2 h ne jouait que 3 vagues et l'horloge **dérivait** à chaque fois ;
- `BotCatchUp` était plafonné à **6 rounds** ;
- les deux étaient **séquentiels** (toutes les vagues, puis tous les rounds de bots), pas
  entrelacés : les bots ne réagissaient jamais aux vagues qu'ils traversaient.

### Ce qui a été fait

**1. Une horloge de simulation** (`game/sim.go`, `AdvanceTo(now, SimBudget)`). L'avancement
devient une **fonction du temps écoulé**, rejouable par n'importe quelle instance : les
vagues (`NextWaveAt`) et les rounds de joueurs-IA (`LastBotAt`, 1/min) sont déroulés dans
l'**ordre chronologique**, chacun à son heure prévue. Trois propriétés qui remplacent les
caps arbitraires :
- **convergente** — rappelée aussitôt, elle ne rejoue rien ;
- **reprenable** — budget épuisé ⇒ `Done:false` et les horloges ne sont pas avancées
  au-delà du joué ; l'appel suivant continue (une requête de joueur garde un petit budget,
  le battement un gros) ;
- **plafonnée** — au-delà de `CatchUpMaxBacklog` (12 h, `ECHOTERRA_CATCHUP_HOURS`) les
  vagues manquées sont **sautées** et l'oubli est tracé au journal de la ville. Sans ce
  plafond, 3 jours d'absence = des centaines de vagues et des dizaines de milliers de
  monstres. Dans la fenêtre rejouée en revanche tout arrive vraiment : **une ville sans
  défenseur peut tomber pendant l'absence** — c'est la règle du jeu, pas un défaut.
L'horloge ne dérive plus : elle reste alignée sur le calendrier d'origine.

**2. Le battement** (`api/tick.go`, `POST|GET /api/tick`) : un appel fait avancer toutes
les parties actives + l'entretien des salons. Authentifié (`ECHOTERRA_TICK_TOKEN`, ou le
`CRON_SECRET` que les crons Vercel envoient) — **503 sans jeton en déploiement**, plutôt
qu'un endpoint de travail ouvert à tous. Balayage borné (25 parties, 20 s) et amorti
contre le martèlement.

**3. Qui l'appelle** : **GitHub Actions toutes les 15 min** (`.github/workflows/heartbeat.yml`,
gratuit et illimité sur un repo public) + un **cron Vercel quotidien** en filet — le plan
Hobby plafonne son cron natif à **1×/jour**, ce qui interdisait de s'en contenter.
La cadence est **15 min et non 5** (le minimum GitHub) à cause de la BASE, pas de Vercel :
le plan gratuit Neon suspend le compute après **5 min d'inactivité** et n'offre que
**100 CU-h/mois** — un battement toutes les 5 min tombe pile sur ce seuil, la base ne dort
jamais (~182 CU-h, presque le double du quota). À 15 min : ~61 CU-h. Aucune perte de
fidélité : `AdvanceTo` rejoue chaque vague à SON heure, la ville est seulement révélée
plus tard si personne ne joue. Côté Vercel le battement pèse <1 % des quotas Hobby (un
sweep coûte 10–30 ms ; le poll du frontend, 20 s par joueur, pèse 20× plus).

**4. Concurrence** : le battement introduit un écrivain de fond, donc `store.SaveIfUnchanged`
(colonne `rev`) — **il abandonne son rattrapage plutôt que d'écraser l'action d'un joueur**
écrite entre-temps par une autre instance. Colonnes `status`/`next_wave_at` miroir du blob
→ `ActiveGames` cible les parties à avancer (les plus en retard d'abord) sans décoder toute
la base. Et `housekeeping()` **dédoublonne** les salons publics que deux instances froides
créaient en parallèle (`ensurePublicLobby` retiré du démarrage à froid : mauvais moment pour
balayer la base, et c'était précisément la course).

### Fonctionnel (vérifié)
- **Test de bout en bout en conditions réelles** : serveur lancé en mode Vercel (`VERCEL=1`,
  stateless, vagues à 60 s), partie solo créée, puis **≈4 minutes sans la moindre requête
  sur la partie** → état **figé** en base (vague 0, PV 100). Un seul `POST /api/tick`, sans
  aucun joueur connecté → `{"waves":3,"botRounds":3}` et, en base : **vague 0→3, jour 1→2,
  PV de la ville 100→34, monstres 26→42**, les bots ont agi (six « 🔧 … a réparé Wall » au
  journal de la ville), prochaine vague replanifiée à **+3 intervalles exactement** (14:45:25
  → 14:48:25 : aucune dérive). Second battement immédiat : `advanced:0` (no-op). Sans jeton :
  **401**.
- 12 tests neufs : `game/sim_test.go` (rejeu complet, cadence des bots, reprise après
  budget, plafond de retard, salon intouché), `api/tick_test.go` (jeton exigé, avancement
  sans requête de joueur, **non-écrasement d'une écriture concurrente**, amortissement,
  salon public unique), `store/store_test.go` (CAS, tri des parties actives).
- `go build ./...` ✅ · `go vet ./...` ✅ · `go test ./...` ✅ (toutes les suites).

### À faire
- **Poser les deux secrets** pour que le battement démarre : `ECHOTERRA_TICK_TOKEN` sur le
  service backend Vercel, **et le même** en secret GitHub Actions (voir `DEPLOY.md`).
- GitHub désactive les workflows planifiés après 60 j sans activité sur le repo.
- Course joueur↔joueur (deux instances, même partie, même instant) toujours théoriquement
  possible : à durcir (verrou en base) avant une vraie ouverture publique.

---

## 2026-07-29 (86) — Portail qui vole, palissade décousue, bâtiments enterrés

Trois défauts signalés, trois causes distinctes.

### 1. Le portail volait dans les airs
`radial()` applique un lobage de ±23 % au rayon, mais le portail et les pans de palissade étaient
posés sur l'ellipse **géométrique** (k = 1). Un point de cette ellipse a donc un rayon LOBÉ compris
entre 0,77 et 1,24 : là où le lobe pousse vers l'extérieur, la porte tombait au-delà de
`PLAIN_EDGE`, c'est-à-dire **hors du terrain**. `contourPoint(a, target)` les recale par bissection
sur le contour réel `radial === RAMPART`.

### 2. La palissade ne joignait pas le portail
Les 16 segments étaient répartis par **angle paramétrique**, ce qui est faux sur une ellipse : l'arc
parcouru par pas vaut `√(RX²sin²a + RY²cos²a)·Δa`, soit 3,85 cellules près des extrémités du grand
axe mais **4,48 aux pôles** — au-delà de la longueur du segment (4,4). Il s'ouvrait donc des jours,
précisément là où se trouve le portail. La répartition se fait maintenant par **longueur d'arc**
tabulée sur le contour réel, avec l'ouverture du portail réservée : espacement 3,78–3,97 pour des
pans de 4,4 (recouvrement partout), et les deux pans butent à 3,65 du centre du portail.
La tangente est prise par différence finie sur le contour lobé — la tangente analytique de
l'ellipse est fausse dès que le lobe la fait tourner.

### 3. Les bâtiments étaient dans le terrain
Depuis le passage au terrain lissé, la pente varie continûment : le minimum d'une emprise de 3,6
cellules tombe jusqu'à ~1,8 unité sous son centre, donc les bâtiments s'enterraient jusqu'à
mi-hauteur. Chaque emprise reçoit désormais une **terrasse plate au niveau de sa cellule centrale**
(bâtiments de jeu ET maisons), et la pose lit la hauteur au **cœur** de l'objet, pas sur tout son
pourtour — le pourtour déborde de la terrasse et retombe sur celle du voisin, ce qui enfonçait
l'objet d'un palier. Vérifié : enterrement **0 pour les dix bâtiments de jeu**.

> Deux variantes essayées et rejetées, notées dans le code : aplanir au MINIMUM de l'emprise (c'est
> le défaut d'origine), et ADOPTER le niveau d'une terrasse voisine pour que les maisons serrées
> partagent une assise — celle-là **chaîne** : une terrasse du pied, à 0, se propage de voisin en
> voisin jusqu'au sommet et rabote toute la butte.

La **fortification** (palissade, portail, tour) est seule à ne pas avoir de terrasse : ses 17 pads
rabotaient le pied de la butte et un bâtiment proche lisait ensuite ce niveau écrasé (la banque
tombait de deux paliers). Elle suit le relief — et ne peut plus flotter, puisque `contourPoint` la
garde sur le terrain.

### Fonctionnel (vérifié)
- Captures headless : vue d'ensemble + zoom sur le portail (posé au sol, pans jointifs).
- Contrôles numériques : espacement de la palissade, distance portail↔pans, enterrement par bâtiment.
- `npx tsc -b` ✅ · `npm run build` ✅ · `npm run test:perf` 10/12 (les deux échecs antérieurs).

---

## 2026-07-29 (85) — Terrain lissé, et suppression du rendu 2D isométrique

Retour : *« les blocs sont trop gros, il ne faut pas des blocs… il me faut des voxels mais smooth »*
et *« remove complètement la 2D isométrique pour l'instant »*. Les deux demandes sont liées : c'est
la compatibilité avec le rendu 2D qui obligeait la ville à rester une pile de cubes d'une tuile.

### Terrain LISSÉ
Le tertre était rastérisé en blocs de la taille d'une case : ses pentes faisaient un escalier
grossier et toute la ville se lisait comme un empilement de caisses. Il passe maintenant par
**`smoothTerrain.ts`** — le rastériseur en colonnes fines déjà utilisé par la carte du monde
(R = 10 colonnes par tuile, pas vertical 1/10). C'est toujours du voxel, mais le grain devient assez
fin pour que la butte se lise comme un relief.

- `townLayout` expose désormais un **champ** (`field` : sol + hauteur par cellule) au lieu d'une
  liste de blocs empilés. Les sols de ville sont quatre codes de « biome » réservés dans la palette
  de `smoothTerrain` (`SOIL.GRASS/DIRT/PLAIN/PAVED` = 6..9) : un seul chemin de rendu, une table de
  couleurs de plus.
- Options `{heightScale: 1, rollAmp: 0, micro: 0.035}` : le tertre est déjà sculpté par le plan, il
  ne faut ni amplifier les hauteurs ni faire rouler les plaines comme sur la carte du monde.
- ⚠ Les objets ne lisent plus une hauteur pré-calculée mais le **minimum de `smooth.heightAt` sur
  leur emprise** — au centre, un coin en aval flotterait au-dessus du vide.
- **Moins cher, pas plus** : 824 k → **271 k triangles**. Le terrain lissé fusionne les grandes
  surfaces planes en quelques quads, là où les blocs payaient un cube par cellule.

### Suppression du rendu 2D isométrique
Supprimés : `game/PhaserGame.tsx`, `game/MapScene.ts`, `game/CombatScene.ts`,
`game/textureUtils.ts`, `components/TownMap.tsx`, la suite `tests/perf/map-loading.mjs`, le réglage
« Carte voxel : Classique / Voxel 3D », et la dépendance **phaser**. `townDoc()` /
`SPRITE_TO_BUILDING` disparaissent de `townLayout`.

- **Bundle : 2 652 kB → 1 138 kB** (gzip 673 → 320 kB).
- `game/` ne garde que `dpr.ts` (DPR plafonné, utilisé par le moteur voxel) et `render.ts` (palette
  de biomes, utilisée par le Studio de données) — ni l'un ni l'autre n'importait Phaser.
- `npm run test:perf` pointe maintenant sur la suite VOXEL (l'ancienne testait le chargement de la
  carte Phaser, qui n'existe plus). `test:perf:voxel` reste comme alias.
- L'**éditeur de cartes** (`src/editor/`) est conservé : c'est un outil de dev en canvas2d, hors
  périmètre par consigne permanente, et il ne dépend pas de Phaser.

### Fonctionnel (vérifié)
- Captures headless : la ville (terrain fin, butte lisible) ET la carte du monde (pas de régression
  après le retrait de la bascule).
- `npx tsc -b` ✅ · `npm run build` ✅ · `npm run test:perf` 10/12 — les deux échecs (boucle de rendu
  continue de la carte) sont **antérieurs** et documentés depuis l'entrée 79.
- Ville : **271 k triangles**, 183 meshes.

### Reste à faire
- La boucle de rendu continue de la carte (batterie) devient le seul échec de la suite : il n'y a
  plus de rendu de secours derrière, donc il mérite d'être traité.
- Les 9 maisons gardent des silhouettes de bourg européen là où Edoras veut des halles basses.

---

## 2026-07-29 (84) — Edoras, passe de correction sur les références

Retour : *« c'est vraiment sympa, mais regarde les images et vois ce que tu peux améliorer »*. Sept
écarts relevés en comparant la capture aux références, tous corrigés.

1. **La butte était un MESA** — 4 paliers très larges, sommet plat immense. Passée à **6 paliers**
   pour le même rayon : chaque marche ne fait plus que ~1,6 cellule, la pente se lit comme continue
   et le tertre monte à deux fois la hauteur d'une maison, comme sur le plan large. ⚠ au-delà de 6,
   la pente dépasse une marche par cellule au pied et l'adoucissement recreuse le talus.
2. **Le replat sommital** couvrait un dixième de la butte → réduit à l'assise de la salle (0,24 → 0,17).
3. **Les maisons ceinturaient tout le tertre.** Sur le film elles couvrent UN versant et le reste est
   une pente d'herbe nue. Biais de flanc angulaire : ~30 maisons réparties en couronne → ~18
   groupées. Une densité constante tout autour donne un anneau, l'inverse de la lecture cherchée.
4. **La roche affleurait sur toute la pente** (22 % + 34 % proportionnel), soulignant chaque redent
   d'un liseré clair : la butte se lisait comme des **terrasses de rizière**. La roche ne sort plus
   qu'au PIED (rien au-dessus de rad 0,7).
5. **La route faisait 1,15 tour** — elle enroulait le tertre et surlignait chaque courbe de niveau au
   lieu de le gravir. Ramenée à **0,85 tour**. Essayée en grès pâle pour la rendre visible : elle
   ajoutait du sable à une image déjà sable ; sur un tertre vert, la terre battue tranche seule.
6. **Le sol était un vert JAUNE.** Le bloc `grass` tire vers le sable ; `darkgrass` est vert sur ses
   six faces — donc les redents des paliers restent verts eux aussi. Changement le plus rentable de
   la passe (vérifié en isolant le terrain : masquer tous les meshes non instanciés ne laisse que
   lui, et il était déjà vert — la preuve que le sable venait du bâti).
7. **Le bâti délavait tout.** Torchis à 236,216,182 : plus clair que l'herbe. Descendu à 196,176,142,
   chaumes assombris, et surtout l'**émissif du matériau** ramené de `0x46423c` à `0x2a2823` — ce
   gris ajouté par fragment, inoffensif sur des tuiles saturées, faisait virer au sable une palette
   de chaume et de torchis déjà claire et peu saturée.

### Fonctionnel (vérifié)
- Champ de hauteur : 0 marche > 1 · `npx tsc -b` ✅ · `npm run build` ✅ ·
  `npm run test:perf` **13/13** ✅ · ville **824 k triangles** (plafond 2 M).

### Ce qui reste en écart avec les références
- La butte reste visiblement en gradins : une marche vaut un bloc entier, il n'y a pas de terrain
  sub-cellulaire dans le moteur. Seule une passe de biseautage des arêtes y changerait quelque chose.
- L'anneau de plaine sèche (`fallgrass`) est large et accroche l'œil.
- Les 9 maisons gardent des silhouettes de bourg européen (encorbellement, tourelle, terrasse).

---

## 2026-07-29 (83) — La ville devient EDORAS

Demande : *« est-ce que pour la ville tu peux t'inspirer d'Edoras du Seigneur des Anneaux ? »*, avec
le plan large du film et trois dioramas. C'est une réorientation, pas un ajustement : Edoras n'a
rien d'un bourg méditerranéen dense sur un plateau.

### Ce que les références imposent (et qui n'existait pas)
1. une **butte isolée** au milieu de la plaine, aux flancs rocheux — pas un plateau carré ;
2. une **enceinte OVALE** épousant le pied de la butte, en **palissade de bois**, sans un angle droit ;
3. **une seule route**, qui monte en LACET du portail au sommet. Pas de grille de rues ;
4. la grande salle **SEULE au sommet**, tout le tissu bâti agrippé aux pentes. C'est la silhouette
   entière du lieu.

### Fait — une géométrie POLAIRE (`townLayout.ts`, réécrit)
Plus une seule coordonnée n'est choisie sur une grille, et c'est ce qui supprime d'un coup l'aspect
« plan d'urbanisme » :
- **le tertre** : la hauteur ne dépend que du rayon elliptique, donc strictement décroissante du
  sommet au pied — aucune cuvette, aucune plaque isolée n'est *possible*. Profil en puissance < 1
  (flancs raides au pied, pentes douces en haut où sont les maisons), replat sommital aux dimensions
  exactes de la grande salle. **Lobage et gauchissement** de forte amplitude, éteints près du centre :
  sans eux les courbes de niveau étaient des ellipses homothétiques et la butte se lisait comme un
  gâteau à étages. Vérifié : **0 marche > 1** sur toute la grille ;
- **l'enceinte** : 16 segments tangents à l'ellipse, ouverture au sud ;
- **la route** : spirale de 1,15 tour, large à l'entrée charretière, réduite à une sente en haut.
  ⚠ elle s'arrête à t = 0,9 : poussée jusqu'au sommet, son rayon tend vers 0 et des centaines
  d'échantillons tombent sur les mêmes cellules — toute l'esplanade partait en terre battue ;
- **les parcelles** en (rayon, angle) le long de la pente, façades tournées vers l'AVAL ; le sommet
  est interdit au décor comme aux maisons.

⚠ **Seuls les gros bâtiments creusent leur terrasse.** Faire creuser aussi les ~28 maisons érodait la
butte de deux paliers, de proche en proche. Les maisons se posent au MINIMUM de leur emprise : elles
mordent dans le talus côté amont — ce que fait une maison sur une butte — sans jamais flotter.

### Fait — les deux modèles signature
- **Meduseld** (`bld-townhall`, réécrit) : soubassement de pierre + emmarchement monumental, corps en
  bois sombre à poteaux, toiture de **chaume doré très pentue**, et les poutres croisées du pignon.
  ⚠ tracées depuis les avant-toits, ces poutres se plaquaient sur la pente du toit et se lisaient
  comme un treillis : seule la partie qui DÉPASSE le faîte fait la silhouette.
- **Palissade** (`bld-wall`, réécrit) : pieux jointifs taillés en pointe, hauteurs inégales, lisses
  et chemin de ronde sur consoles. Un rempart crénelé de pierre appartient à une autre culture — et
  à l'échelle de la butte, il l'écrasait.

### Fait — palette rohirrique
Terracotta et ardoise bleue juraient avec un tertre de plaine. `ROOF_W`, `ROOF_TILE` et `ROOF_SLATE`
deviennent trois tons de **chaume** (neuf, clair, moussu), `WOOD_W` fonce, les peintures passent en
vert-de-gris et torchis ocré. Les 9 maisons, les 10 bâtiments et le mobilier sont régénérés.

> ⚠ Piège rencontré : remplacer `bldWall` par un `s[index(bldWall):index(bldChantier)]` a emporté
> TOUT ce qui se trouvait entre les deux — les 9 maisons, le mobilier de rue, les clôtures. Restauré
> depuis `git show HEAD:`. Découper par bornes de fonctions n'est sûr que si l'on sait ce qu'il y a
> entre elles.

### Fonctionnel (vérifié)
- Champ de hauteur contrôlé programmatiquement : 0 marche > 1.
- Captures headless voxel (dont une avec tous les bâtiments forcés construits, sans quoi la mairie
  et la palissade ne se voient pas au démarrage) et Classique.
- `npx tsc -b` ✅ · `npm run build` ✅ · `npm run test:perf` **13/13** ✅ (payload 20,43 Mo).
- Ville : **774 k triangles**, 194 meshes (plafond 2 M).

### Reste à faire
- Les 9 maisons gardent des silhouettes « bourg européen » (encorbellements, tourelle, terrasse à
  parapet). Des halles rohirriques basses à grand toit de chaume seraient plus justes.
- La palissade démarre à 20/100 de durabilité, donc c'est sa variante RUINE qu'on voit en début de
  partie ; le beau modèle n'apparaît qu'après réparation.
- Le sommet est un grand replat nu tant que la mairie n'est pas bâtie.

---

## 2026-07-28 (82) — Relief : refait sur une FONCTION, plus sur du bruit

Retour, répété : *« les reliefs ne sont pas smooth ni logiques »*. Fondé, et la cause était dans la
méthode, pas dans un réglage.

### Ce qui n'allait pas
La hauteur était **un bruit ajouté à une pente**, puis rattrapée par deux passes qui se battaient
entre elles. Deux défauts en découlaient mécaniquement :
- **pas lisse** : le bruit décidait seul de part et d'autre du seuil, donc les courbes de niveau se
  déchiquetaient et laissaient des PLAQUES ISOLÉES — un carré de palier haut au milieu du palier
  bas, que rien n'explique ;
- **pas logique** : chaque bâtiment s'aplanissait ensuite SA plate-forme rectangulaire, et la passe
  d'adoucissement ne savait que creuser. Résultat : un damier de mesas et de cuvettes.

### La correction
Le terrain est maintenant une **fonction**, pas un tirage. Deux **courbes de niveau** (somme de deux
sinusoïdes de périodes incommensurables, donc ondulantes et dérivables) traversent la ville d'un
rempart à l'autre ; le palier d'une cellule est simplement « de quel côté de la courbe elle se
trouve ». Trois propriétés en découlent — exactement celles qui manquaient :
1. **monotone en y** : le terrain descend toujours vers le portail. Aucune plaque isolée, aucune
   cuvette n'est possible *par construction* ;
2. **courbes continues** : une limite de palier va d'un bord à l'autre, donc le mur de soutènement
   se lit comme un ouvrage et non comme un accident ;
3. **marches d'un seul niveau** partout — la pente des courbes vaut ~0,4 cellule par cellule, très
   en dessous de 1. Vérifié : 0 marche > 1 sur toute la grille.

**Les bâtiments ne s'aplanissent plus rien.** Leur emprise est CREUSÉE au niveau le plus bas
qu'elle touche : une maison mord dans le talus côté amont — ce que fait une maison sur un coteau —
et ne peut jamais flotter, puisqu'on descend au minimum.

Les deux courbes sont calées dans les corridors LIBRES entre bâtiments (au-dessus de la place, et
entre le tissu sud et l'esplanade du portail) ; les emprises de la cuisine, de la recyclerie et du
panneau ont été déplacées en conséquence. Une emprise à cheval sur une limite se ferait creuser
d'un cran et rouvrirait le problème des plates-formes rectangulaires.

### Fonctionnel (vérifié)
- Champ de hauteur contrôlé programmatiquement : **0 marche > 1**, aucune plaque isolée.
- Captures headless voxel et Classique · `npx tsc -b` ✅ · `npm run build` ✅ ·
  `npm run test:perf` **13/13** ✅.

---

## 2026-07-28 (81) — Ville : la rendre ORGANIQUE (relief, mobilier, vert)

Retour : *« là c'est bien mais ce n'est pas joli, trouve les points d'amélioration pour rendre la
ville organique »*. Diagnostic, puis les trois leviers traités.

### Ce qui rendait la ville « pas jolie »
1. **Le sol était rigoureusement plat.** Tous les toits au même niveau, toutes les ombres
   identiques, aucune ligne d'horizon interne : ça se lit comme un plateau de jeu, et aucune
   quantité de maisons ne rattrape ça. C'était le défaut n°1, loin devant les autres.
2. **Aucune trace des gens.** Ni charrette, ni tonneau, ni étal, ni linge, ni barrière. Les volumes
   étaient justes et le lieu restait mort — une maquette d'architecte.
3. **Trop de pierre pâle au sol.** Entre la place, l'avenue, la ceinture, la traverse et sept
   liserés de parcelle, la quasi-totalité du sol était minérale et claire ; le peu de vert
   restant (14 % des cellules libres) ne compensait pas. L'image tirait au gris.
4. **Cadrage** : la caméra visait le niveau du SOL, donc le bourg occupait le haut du cadre et un
   tiers d'écran de socle sombre traînait en bas.

### Fait
**Relief en terrasses** (`buildTerraces`) — le bourg est bâti à flanc de coteau : le terrain monte
du portail (au sud) vers la mairie (au nord) en trois paliers. La mairie domine réellement, l'avenue
GRIMPE vers la place, et les redents entre paliers sont maçonnés en calcaire — des murs de
soutènement qui découpent le tissu. Deux contraintes tiennent le reste : le rempart et son pied
restent au niveau 0 (un segment de 5 cellules à cheval sur une marche laisserait un jour sous la
muraille), et toute emprise bâtie est aplanie au niveau de son centre (sinon un coin flotte). Le
bruit du profil est à DEUX échelles : en bruit blanc par cellule, l'adoucissement ramène la courbe
de niveau à une droite et on retombe sur des bandes.

**Mobilier de rue et clôtures** — 4 nouveaux props × 3 variantes : charrette / tonneaux / caisses ·
étal bâché rouge, bleu, corde à linge · lanterne, banc et jarres, abreuvoir · barrière de bois,
muret de pierre sèche, haie. Posés le long des voies, ORIENTÉS sur la rue. Les clôtures font
exactement une cellule de long (deux cellules voisines donnent un linéaire continu) et leur matière
est tirée par ÎLOT — alterner bois/pierre/haie d'une cellule à l'autre ferait un patchwork.

**Rééquilibrage du vert** — le liseré pavé des parcelles est SUPPRIMÉ (il minéralisait tout) et la
végétation passe de 14 % à 52 % des cellules libres restantes, arbres agrandis. Le taux de 14 %
datait de l'époque où rien d'autre n'occupait ces cellules ; depuis que les maisons tiennent le
terrain, c'est le vert qui manque.

**Socle et cadrage** — socle ramené de 2 à 1 bloc, caméra visée à mi-hauteur du bâti (2,6) et non au
sol.

> ⚠ `cylAt` ne sait faire que des cylindres d'axe Z (vertical) : les roues de la charrette se
> posaient à plat comme des galettes. Roues en boîtes — à ce gabarit une roue carrée se lit très
> bien.

### Fonctionnel (vérifié)
- Captures headless voxel et Classique. `npx tsc -b` ✅ · `npm run build` ✅ ·
  `npm run test:perf` **13/13** ✅ · `test:perf:voxel` 10/12 (mêmes deux échecs antérieurs).
- Ville : **607 k triangles**, 158 meshes (plafond 2 M).

### Reste à faire pour aller plus loin vers l'organique
- **Le contour du bourg est un carré parfait.** C'est ce qui reste de plus « dessiné à la règle ».
  Un périmètre irrégulier (le rempart qui avance et recule d'une cellule, des angles non droits)
  serait le prochain gain le plus fort — mais il demande de repenser le pavage du rempart.
- **Les voies sont rectilignes.** Une ceinture qui serpente d'une cellule ferait beaucoup.
- Les bâtiments de JEU restent très minéraux à côté des maisons : beaucoup de mur, peu de toit.
- Cycle jour/nuit dans la ville (la carte l'a déjà).

---

## 2026-07-28 (80) — Ville : neuf styles de maisons et un vrai plan de ville

Retour : *« il faut plusieurs styles de maisons et il faut organiser ça comme une ville, pas les
maisons dans le même sens, une place, des sentiers plus ou moins grands »*. Les trois points sont
justes et se répondent : trois modèles répétés vingt fois font un motif, et un damier de voies au
même gabarit fait un lotissement.

### Neuf modèles (`gen-props.mjs` → `house`, `house2`, `house3`, 3 variantes chacun)
Ce qui change n'est pas la couleur mais l'EMPRISE et le registre :
chaumière · maison à étage en encorbellement · maison peinte à auvent ·
**grange** longue et basse (2× plus large que profonde) · **échoppe** à arcade avec étal et enseigne ·
**maison étroite à balcon** (la verticale du tissu) · **remise** en appentis (toit à une pente) ·
**maison à tourelle** (le seul volume courbe) · **maison basse à terrasse** (aucun prisme).
Hauteurs obtenues : de 1,5 à 3,7 cellules — c'est cette irrégularité qui fait un tissu.

> La terrasse a d'abord été rendue en pierre pâle cernée d'un parapet haut : vue de la caméra
> dimétrique, qui plonge, elle se lisait comme une **piscine**. Sol en tomettes + pergola partielle.

### Hiérarchie des voies (`townLayout.ts`)
Quatre rangs, chacun avec SON gabarit et SON matériau — sans quoi le réseau ne se voit pas :
- **place** 5×5 pavée autour du puits (elle faisait 3×3) ;
- **avenue** 3 de large, pavée, du portail à la place — l'axe d'arrivée ;
- **ceinture + traverse** 1 et 2 de large, calcaire clair — la desserte ;
- **ruelles** de terre battue, qui traversent la bande entre ceinture et rempart et la coupent en
  îlots (sans elles, cette bande fait un ruban continu de toits tout autour du bourg).

Les sept parcelles fonctionnelles sont replacées sur les îlots de ce réseau (dégagements deux à deux
et non-recouvrement des voies vérifiés à la main).

### Façades sur la rue
`faceStreet(x,y)` cherche la voie la plus proche dans un rayon de 3 et en déduit l'azimut (les
modèles ont leur porte côté −Z, d'où `atan2(−dx, −dy)`). Avant, l'orientation était un quart de tour
tiré au sort : on voyait des pignons aveugles donner sur la place et des portes s'ouvrir sur un mur.
25 maisons, 25 orientations distinctes.

### Deux bugs de fond

**`hash()` perdait ses bits de poids faible.** `n * 1274126177` dépasse 2^53 : l'arrondi flottant
détruit exactement les bits que `>>> 0` conserve. Conséquence concrète, invisible jusqu'ici : le
tirage du modèle (`% 9`) tombait toujours dans le même tiers du catalogue — **trois modèles sur neuf
n'apparaissaient jamais**. Corrigé avec `Math.imul`.

**Les grands modèles étaient systématiquement recalés.** Le modèle donne l'emprise, donc il se
choisit avant le test de place ; une grange de 3,8 cellules échoue là où une remise de 2,6 passe, et
la parcelle était perdue. La sélection réessaie maintenant les modèles suivants. ⚠ leur ordre dans
`HOUSE_MODELS` est VOLONTAIREMENT entrelacé par gabarit : rangés par taille, le plus petit récupérait
tous les refus (9 exemplaires sur 25 pour la maison étroite).

### Budget
Les six nouveaux sprites du mode « Classique » (1024² chacun) ont fait passer le payload PNG à
24,89 Mo, au-dessus du budget de 24. `scripts/downscale-ui.mjs` est généralisé (chemin sous
`assets/` + taille cible) et réduit les neuf sprites de maison à 512² — ils s'affichent dans ~2 tuiles
iso. 5,25 Mo → 1,84 Mo.

### Fonctionnel (vérifié)
- Captures headless voxel ET Classique : neuf silhouettes distinctes, façades sur rue, place et
  avenue lisibles, ruelles de terre.
- `npx tsc -b` ✅ · `npm run build` ✅ · `npm run test:perf` **13/13** ✅ (payload 21,48 Mo)
- `npm run test:perf:voxel` 10/12 — les deux mêmes échecs antérieurs (boucle de rendu de la carte).
- Ville : **524 k triangles**, 115 meshes (plafond 2 M) — en baisse malgré les maisons, le rempart
  ayant beaucoup moins de segments.

### Reste à faire
- Les bâtiments de JEU paraissent maintenant ternes à côté des maisons : beaucoup de mur, peu de
  toit. C'est la prochaine passe.
- Cycle jour/nuit dans la ville.
- Boucle de rendu continue de la carte (batterie) — antérieure.

---

## 2026-07-28 (79) — Ville : le style « Town to City » (densité, tissu bâti, rempart)

Demande : *« explore le style Town to city mais pour ce jeu »*, puis cinq images de référence.
Ce que les images disent, et que les descriptions écrites ne rendaient pas :

1. **la densité fait la ville** — les bâtiments remarquables ne se détachent que parce qu'ils
   dépassent d'une MASSE de toits serrés. Notre bourg était dix objets espacés sur une pelouse ;
2. **le toit porte la couleur** et occupe la moitié de la hauteur. Nos bâtiments sont surtout de la
   pierre, d'où l'impression de gris quoi qu'on fasse à l'éclairage ;
3. **rien n'est aligné au cordeau** — les faîtes partent de quelques degrés de travers ;
4. **des verticales** (cyprès) rythment la silhouette au-dessus des toits.

### Fait

**Maisons de bourg** (`gen-props.mjs` → `house-v{0,1,2}.vox`, 3 modèles distincts, pas 3 états) :
chaumière au toit de chaume, maison à étage en encorbellement à colombages (toit terre cuite),
petite maison peinte avec auvent de toile (toit d'ardoise). Trois couvertures différentes pour que le
tissu ne fasse pas motif. Aucun rôle de jeu, pas cliquables : un tap dessus vide la sélection comme
un tap sur l'herbe. ~20 par ville.

> ⚠ **La cause de l'échec de la tentative précédente** (« maisons rendues en dalles flottantes ») est
> identifiée : les recettes du fichier renvoient soit une `Grid`, soit `fin(g)`, selon qu'elles sont
> enregistrées seules ou dans le bloc `bld-*` — lequel applique `damagePass` PUIS `fin`. Passer une
> Grid déjà « finie » à `damagePass` indexe le buffer avec les mauvaises dimensions.

**Plan du bourg** (`townLayout.ts`) : 19×19 → **21×21** (à 19, les dix parcelles et leurs dégagements
mangeaient ~250 des 289 cellules intérieures — il n'y avait de place que pour 14 maisons, dont la
moitié collée au rempart donc masquée par lui). Ajout d'une **ceinture de rue** intérieure : c'est
elle qui donne du front de rue, sinon les seules façades constructibles sont les deux axes centraux.
Placement des maisons en trois passes — front de rue, puis GRAPPE (accrochage à une maison déjà
posée → rangées et îlots), puis fonds de jardin — avec dégagement **euclidien** et non Chebyshev
(en Chebyshev une diagonale compte pour 1 alors qu'elle vaut 1,41 : on perdait un anneau entier
autour de chaque bâtiment).

**Implantation organique** : ±7,5° et ±0,22 cellule, déterministe par hachage, sur les parcelles
intérieures seulement. Muraille, portail et tour restent d'équerre — c'est une fortification.

**Cyprès de bord de rue** : le prop `pine` avec un plafond de HAUTEUR explicite (4,2 cellules) pour
qu'il dépasse les maisons (3,1) sans atteindre la mairie (5,6), qui garde le point haut. D'où un
champ `hmax` sur `TownDecor` : le plafond par défaut (`scale × 1.6`) est calculé sur l'emprise au
sol et écrasait le cyprès sous les toits.

**Parcelles** : terre battue resserrée d'un anneau + **liseré pavé** autour. Seule, la terre se
lisait comme un trou dans la pelouse.

### Deux bugs trouvés en chemin

**Le rempart montait à 0,9 cellule.** `bld-wall` est un bandeau (17,5 de long pour 7,2 de haut) et
`fitScale` met à l'échelle sur l'emprise au SOL, donc sur la longueur : à 2,1 cellules de long, la
hauteur tombait mécaniquement à 0,9. Une bordure de jardin autour d'un bourg dont les maisons font
3 cellules. Corrigé par des segments de 5 cellules (≈2,2 de haut) pavant le pourtour avec
recouvrement — 19 segments au lieu de 36, et la tour d'angle ENJAMBE désormais le rempart au lieu
d'y creuser un trou. (Essayé à 8,3 → 3,7 de haut : le pan avant occultait le tiers du bourg.)

**Les gravats de `damagePass` étaient semés sur toute la grille 20×20**, quelle que soit la forme du
modèle. Sur un bâtiment compact ça passait ; sur le rempart — qui n'occupe que 5 unités de
profondeur sur 30 — ils TRIPLAIENT la profondeur de la boîte englobante, donc de l'échelle. Et comme
la muraille démarre à **20/100 de durabilité**, c'est la variante RUINE qu'on voit en début de
partie : le rempart était un pavé massif. Les gravats sont maintenant contenus dans l'emprise du
modèle. Les dix `bld-*` sont régénérés.

**Mode « Classique » cassé par l'implantation organique** (trouvé et corrigé dans la foulée) : le
renderer 2D range les placements dans un seau par cellule (`isoRender.ts:223`, clé `"${cx},${cy}"`)
et les ressort en parcourant les cellules — donc avec des ENTIERS. Une coordonnée fractionnaire ne
retombe jamais sur une clé existante et l'objet n'est jamais dessiné : la ville 2D s'était vidée de
tous ses bâtiments sauf la tour. `townDoc()` arrondit désormais. Le sub-pixel reste un raffinement
de la vue voxel.

### Fonctionnel (vérifié)
- Captures headless de l'onglet Ville en voxel ET en Classique (Playwright, poll par
  `page.evaluate` — jamais `waitForFunction`) : bourg dense, rempart lisible, maisons présentes dans
  les deux rendus.
- `npx tsc -b` ✅ · `npm run build` ✅ · `npm run test:perf` **13/13** ✅
- `npm run test:perf:voxel` 10/12 — les deux échecs (« carte on-demand », « rendu stoppé hors de
  l'onglet ») sont **antérieurs** et déjà constatés à la session précédente sur l'arbre pré-Signac.
- Budget de la ville : **625 k triangles** pour 119 meshes (plafond de la suite : 2 M).

### Reste à faire
- Les bâtiments de JEU gardent des silhouettes basses et pierreuses à côté des maisons ; c'est
  maintenant eux qui paraissent ternes. Prochaine passe : plus de toit, moins de mur.
- Cycle jour/nuit dans la ville (la carte l'a déjà, branché sur `waveProgress`).
- Boucle de rendu continue de la carte (batterie) — antérieure, toujours ouverte.

---

## 2026-07-26 (78) — Bâtiments : couleur DANS les modèles

Retour : « ils ont l'air toujours un peu washed up, est-ce qu'on ne pourrait pas modifier les modèles
pour avoir plus de couleurs de base ». Diagnostic juste — et c'est bien le modèle qu'il fallait
changer, pas l'éclairage.

Constat : sur les dix recettes, la banque, le portail, la tour et la muraille — c'est-à-dire
l'ESSENTIEL de ce qu'on voit en début de partie, puisque ce sont les bâtiments déjà construits —
n'avaient **aucun élément coloré**. Que de la pierre. Seule la mairie avait un toit terracotta, et
elle n'est pas bâtie au départ. Aucun réglage d'éclairage ou de teinte de pierre ne pouvait
rattraper ça.

### Fait — accents colorés par bâtiment (`gen-props.mjs`)
Palette d'accents : `ROOF_SLATE` (ardoise bleue), `ROOF_TILE` (tuile), `TRIM_GOLD`, `PAINT_TEAL`.
- **Banque** : toit d'ardoise BLEUE + bandeau doré de corniche (c'était un toit-terrasse en pierre).
- **Tour** : toiture conique en tuile (ce n'était qu'un fût de pierre nu).
- **Portail** : toits pyramidaux en tuile sur les deux tours, bannière élargie + galon doré.
- **Muraille** : couvertine d'ardoise des deux côtés du chemin de ronde — le rempart fait tout le
  tour de la ville, en pierre nue il traçait un large liseré beige uniforme autour du bourg.

### ⚠ Le piège de l'émissif (à retenir)
Après avoir coloré les modèles, les toits restaient PÂLES en jeu alors qu'ils étaient éclatants sur
le rendu isolé du prop. Cause : l'émissif du matériau des bâtiments était monté à `0x8a8279` pour
compenser le double ombrage. **L'émissif est un gris AJOUTÉ à chaque fragment** : trop fort, il
relève la luminosité mais DILUE la saturation. Redescendu à `0x46423c` — il ne doit que compenser le
double ombrage, pas éclairer. Les couleurs sont revenues.

### Fonctionnel (vérifié)
tsc, build, `test:perf` 13/13.

### À faire
- Les bâtiments sont un peu plus sombres qu'avant : c'est le prix à payer pour garder la saturation
  (émissif bas). Si ça gêne, le bon levier est d'éclaircir les COULEURS des recettes, pas de remonter
  l'émissif — ce serait refaire le délavage.
- Cuisine, recyclerie, atelier, puits et panneau n'ont pas été retouchés (ils avaient déjà chaume,
  toit vert, eau bleue). À harmoniser si la nouvelle gamme se confirme.


## 2026-07-26 (77) — Ville agrandie (+ correctif d'échelle des props)

Demande : « est-ce que tu peux agrandir la ville ». Grille **15×15 → 19×19**, parcelles écartées et
agrandies (mairie 3.6→4.4 cellules, ateliers 3.0→3.6, portail et tour 2.6→3.2), place et allées
recalées, et **cadrage resserré** (`span` de `(size+2)×1.28` à `(size+1)×1.05`) — sans ça, agrandir la
grille ne fait que rapetisser les bâtiments à l'écran, puisque la caméra cadre sur le contenu.

### Bug trouvé au passage : `fitScale` faisait exploser les props étroits
Le facteur d'échelle était calculé sur l'**emprise au SOL** (`max(largeur x, largeur z)`). Un prop
étroit et haut — fougère, touffe d'herbe, fleur — a une toute petite empreinte, donc le facteur
devenait énorme et sa HAUTEUR partait au plafond : la ville était plantée de « colonnes » pâles plus
hautes que les bâtiments. `fitScale` accepte désormais un plafond de hauteur, et le décor est borné à
1.6× son emprise. Le bug existait depuis la refonte de la ville (entrée 75) mais ne se voyait pas :
sur une grille de 15 il y avait peu de cellules libres, donc peu de props.

Densité de décor ramenée de 26 % à 14 % des cellules libres — à 19×19 il y a bien plus de place, et
la ville disparaissait sous la végétation ; arbres rabaissés de 1.5 à 1.15 cellule.

### Suite (même jour) — « pourquoi tous les bâtiments ont l'air washed up ? »
Trois causes cumulées, la première de loin la plus grosse :
1. **Les bâtiments ne recevaient AUCUNE lumière.** `BLD_MAT` était un `MeshBasicMaterial` (self-lit),
   choisi à l'époque parce que le Lambert cumulait son ombrage avec celui déjà CUIT par le mesher et
   les faisait virer au gris. Mais sans lumière du tout : ni modelé, ni ombre portée — posés en aplat
   sur un terrain, lui, éclairé. La bonne parade est l'ÉMISSIF (qui relève le plancher pour compenser
   le double ombrage), pas la suppression de l'éclairage. C'est d'ailleurs déjà ce que fait la case
   ville sur la carte. Repassés en Lambert + émissif.
2. **`STONE_W` était un quasi-blanc** (222,212,196) et sur dix modèles presque toutes les surfaces
   sont cette pierre-là. Passé à une calcaire chaude (212,193,163) ; toit en vraie terre cuite.
3. Le plafond de saturation des quasi-gris dans `divisionize` était très bas (0.19 → 0.28).

⚠️ Piège rencontré : en passant au Lambert j'ai d'abord trop baissé la pierre ET mis un émissif
faible — les bâtiments sont devenus gris-brun sombres, l'excès inverse. L'émissif doit compenser le
double ombrage, pas juste « éclairer un peu ».

### Fonctionnel (vérifié)
- tsc, build, `test:perf` 13/13.
- Mesuré : **282 912 → 430 520 triangles** en ville (+52 %, la grille passe de 225 à 361 cellules).
  Le budget de la suite voxel est de 2 M pour la ville — large marge.
- 10 pastilles, 2 chevauchements (contre 0 à 15×15 : les bâtiments écartés rapprochent certaines
  pastilles de la caméra ; à surveiller si ça gêne).


## 2026-07-26 (76) — Rendu divisionniste « Signac » (opt-in)

### Contexte
Demande : « est-ce que tu penses que tu peux rendre les voxels dans le style peinture de Signac ». Le
médium aide : un voxel EST une touche discrète de couleur pure, et le Signac tardif (touches carrées
en mosaïque) est plus proche de la grille voxel que son pointillisme de jeunesse. Direction retenue
par l'utilisateur : **grading + touches, en post-traitement, derrière un réglage** — pas de
régénération de l'art.

Écarté sciemment : régénérer les palettes des blocs en mélange optique (le plus authentique, et
stable puisque la touche vivrait dans le monde). Le mesher est GREEDY : casser l'uniformité de
couleur voxel par voxel supprime la fusion des quads et fait exploser le nombre de triangles, contre
un budget déjà documenté. À ne tenter qu'après mesure sur un biome témoin.

### Fait
`voxel/signacPass.ts` + `engine.setSignac()`, inséré dans la chaîne existante de la passe beauté
(après le mélange du bloom, avant `OutputPass`) — donc **rien à construire** : le composer existait.
- Parti pris de couleur : ombres vers le violet/bleu (jamais du gris), lumières vers le chaud,
  saturation haute.
- Touche : image reconstruite depuis le centre de chaque cellule, peinte en touche ronde sur une
  toile claire, teinte décalée par touche (mélange optique). Rangées décalées d'une demi-cellule —
  une grille carrée stricte se lit comme une moustiquaire.
- Réglages : bascule Normal/Peinture + curseur d'intensité, affichés seulement si voxel + cinématique
  sont actifs. **Off par défaut.**

### Trois pièges rencontrés (à retenir)
1. **Couverture trop faible** → les zones CLAIRES, c'est-à-dire le sujet, se délavaient jusqu'au blanc
   tandis que seules les ombres restaient lisibles. Les touches se chevauchent maintenant, avec un
   rayon qui croît quand la valeur baisse.
2. **Aplats sans couleur** → la pierre des bâtiments est un quasi-blanc uniforme (matériau self-lit,
   zéro ombrage) : aucune couleur locale à diviser, le village restait une tache blanche. Corrigé en
   tirant la teinte au sort d'autant plus fort que la source est désaturée, et en cassant la valeur.
   C'est exactement ce que Signac fait des voiles et des murs blancs.
3. **`flat` est un mot RÉSERVÉ en GLSL** (qualificateur d'interpolation) : le shader ne compilait pas
   et le canvas rendait NOIR. Et un backtick dans un commentaire GLSL termine le template literal JS.

### Fonctionnel (vérifié)
tsc, build, `test:perf` 13/13, `go test ./...` ; captures avant/après des onglets Ville et Carte.

### Correction le même jour — la passe écran était la mauvaise réponse
Retour utilisateur : « on dirait juste un filtre appliqué, et pas un rendu logique 3D », et c'est
MOINS lisible. Fondé, et c'était un défaut de conception, pas un réglage : la trame était collée à
l'ÉCRAN, donc elle ne suivait pas les surfaces, ne tournait pas avec la géométrie, ne se resserrait
pas avec la distance, et stipplait indistinctement ciel, brouillard et bâtiments — d'où les
silhouettes mangées.

`voxel/signacPass.ts` est SUPPRIMÉ, remplacé par **`voxel/signacMaterial.ts`** : le divisionnisme vit
maintenant dans les MATÉRIAUX (`onBeforeCompile` sur les Lambert/Basic existants, donc l'éclairage et
les ombres continuent de fonctionner). La touche est indexée sur la POSITION MONDE :
- elle est solidaire de la surface — elle tourne, s'incline et rétrécit avec elle ;
- les arêtes restent NETTES, la couleur ne varie jamais au travers d'une silhouette : le rendu
  GAGNE en lisibilité au lieu d'en perdre ;
- le contraste chaud/froid est appliqué APRÈS éclairage, donc les ombres virent au violet parce que
  la lumière le décide, pas parce qu'un filtre l'a plaqué.
- **coût géométrique nul** : pas un triangle ajouté — c'est ce qui évite l'écueil du greedy meshing.

Réglage `uCell` : à 1/16 (la maille du LOD voxel) la touche tombe sous le pixel dès qu'on dézoome et
se lit comme du BRUIT. À ~1/5 de tuile elle devient une vraie mosaïque, comme le Signac tardif ; le
curseur d'intensité élargit encore la touche. Le réglage ne dépend plus du rendu cinématique.
Appliqué à : terrain (blocs + lissé), props, bâtiments, personnages, arène de combat.

### À faire
- Le brouillard (tuiles non découvertes) est très pâle : sous la passe il devient une toile presque
  nue. Joli mais très vide — à retravailler si le rendu devient un défaut.
- Coût GPU non mesuré (le moteur est on-demand, la passe ne tourne qu'aux redraws) : à vérifier sur
  un vrai téléphone avant d'envisager de l'activer par défaut.


## 2026-07-26 (75) — Refonte complète de la ville (onglet Ville + case ville de la carte)

### Contexte
Demande : « il faut changer complétement TOUT le design de la ville. Sur la ville c'est un gros
temple, et ce qui s'affiche sur l'onglet ville n'est pas très cohérent. »

Les deux reproches portaient sur deux endroits différents, tous deux fondés :
- **le « gros temple »** : la case ville de la CARTE rendait un `temple` — un temple grec complet
  (parvis dallé, 14 colonnes cannelées, frise à triglyphes), modèle qui n'existe nulle part ailleurs
  dans le jeu et ne ressemble en rien au village médiéval de l'onglet Ville. Deux architectures pour
  un même lieu. (Dans l'onglet Ville, le `gate` posé à l'échelle 3.0 en pierre quasi blanche faisait
  la même impression de masse de temple.)
- **l'incohérence de l'onglet Ville** : mesurée, pas supposée (voir ci-dessous).

### Ce que l'audit a mesuré
- `town-map.json` (54×59, 575 cellules, 1167 blocs) n'avait d'emplacement que pour **8 des 10
  bâtiments** : `wall` et `kitchen` n'apparaissaient NULLE PART. La muraille est pourtant construite,
  s'abîme (20/100 au départ) et compte dans la défense.
- Le rendu sautait en plus les sites non lancés (« herbe nue ») : mairie, tour, cuisine, recyclerie.
  **Six bâtiments sur dix étaient donc introuvables depuis la Ville** en début de partie — seules 5
  pastilles s'affichaient.
- Terrain : 346 sandstone, 106 sand, 80 redsand, **zéro bloc d'herbe**. Un plateau désertique.
- Bâtiments posés par décalages en PIXELS d'éditeur (un `dx` de 726px ≈ 24 tuiles de dérive), et
  `rot`/`flipX` d'auteur **ignorés** au rendu (tout à `rotation.y = π`).
- **5 chevauchements** entre les 5 pastilles affichées.

### Fait
- **`voxel/townLayout.ts`** (nouveau) : le plan est une FONCTION de l'état de jeu. Village fortifié
  15×15 — muraille sur le pourtour (segments de 2 cellules), portail dans la face avant, tour
  d'angle, place dallée autour du puits, allée depuis le portail, **une parcelle par bâtiment du
  serveur**. Décor déterministe (arbres/buissons/fleurs) sur les cellules libres, emplacements de
  héros triés par proximité de la place (l'équipe se tient ensemble au lieu de se disperser).
- **Sites non lancés** : parcelle en terre battue + pastille conservée. On voit où ira le bâtiment et
  on peut ouvrir le chantier — c'était LE défaut de cohérence principal.
- **Échelle** : `fitScale()` dimensionne chaque modèle d'après sa boîte englobante réelle pour
  occuper une emprise voulue en CELLULES. L'ancien `×2.3` (hérité de l'échelle d'auteur) donnait des
  tailles incohérentes d'un bâtiment à l'autre.
- **Pastilles** : marqueur ICÔNE par défaut, nom déplié uniquement sur la sélection. À dix bâtiments,
  dix pastilles texte se chevauchaient 19 fois et masquaient la ville qu'elles annotent.
- **Case ville de la carte** : le temple grec est remplacé par le MÊME village en réduction (mairie
  + portail + pans de muraille), avec les mêmes modèles `bld-*`. `TEMPLE_MAT` → `TOWN_MAT`.

### Fonctionnel (vérifié)
- `npx tsc -b`, `npm run build`, `go test ./...` verts ; **`npm run test:perf` 13/13**, payload PNG
  inchangé (23,23 Mo) — les modèles `bld-*` étaient déjà chargés côté ville, la carte en précharge
  trois de plus et n'a plus besoin de `temple`.
- Captures Playwright des deux onglets : les **10 bâtiments** ont une pastille (Muraille, Portail,
  Tour, Mairie, Banque, Atelier, Cuisine, Recyclerie, Puits, Panneau), **0 chevauchement** mesuré
  (contre 5 avant, 19 au pire pendant la mise au point).

### Suite (même jour) — le mode « Classique » aussi
`components/TownMap.tsx` (rendu 2D de secours, `settings.voxelMap=false`) lisait encore
`town-map.json` : il affichait donc TOUJOURS l'ancien plateau de grès à 8 bâtiments, une ville
entièrement différente de la vue voxel. Il consomme maintenant `townDoc()` — le MÊME plan, converti
au format `MapDoc` de l'éditeur. Une seule source de vérité pour la ville, deux rendus.
`BUILDING_SPRITE` / `SPRITE_TO_BUILDING` (dans `townLayout.ts`) apparient les ids de bâtiment aux
sprites de l'éditeur ; les sprites `townhall/bank/workshop/kitchen/well/panel/gate/tower/wall`
existaient déjà à l'identique, la recyclerie emprunte `bld-warehouse` faute d'art dédié. Les
segments de muraille ne sont pas replacés en 2D (le sprite iso `wall` ne se raccorde pas
proprement et une cinquantaine de copies écraserait le dessin) : la muraille y est portée par
l'anneau de pierre du sol. Marqueurs icône + nom sur sélection, comme la vue voxel.
Vérifié : 9 pastilles (tout sauf `wall`), captures Playwright, test:perf 13/13.

### À faire
- Les modèles `bld-*` sont en pierre très claire (`STONE_W = [222,212,196]`) : à distance le village
  tire vers le blanc. Une passe de palette sur `gen-props.mjs` (toits plus contrastés) aiderait.
- La muraille à 20 % de durabilité rend la variante « ruine » sur tout le pourtour : correct et
  informatif, mais visuellement proche d'une palissade cassée.


## 2026-07-26 (74) — Revue UI/UX complète : tokens, barre du bas, overlays, français

### Contexte
Demande : « revoir TOUT le design de l'application ». Le design system parchemin
(`design/EchoTerra.dc.html`) avait été appliqué en 4 phases le 2026-07-15, puis ~15 commits de
features avaient empilé de l'UI par-dessus sans y revenir. Audit d'abord (CSS + composants +
historique), puis correction. Direction retenue par l'utilisateur : **garder le parchemin**, auditer
toute l'app, et **refondre la barre de navigation du bas**.

### Ce que l'audit a trouvé
- `:root` n'avait que des couleurs + 2 polices : **rien** pour espacements, rayons, ombres, z-index,
  motion, breakpoints. 133 `var(--)` contre **~219 littéraux de couleur**.
- **0 `:focus-visible`** dans 3225 lignes (navigation clavier à l'aveugle), **0
  `prefers-reduced-motion`** (3 animations infinies, dont celle du CTA principal), **0 `min-height`**
  (cibles tactiles à 27-30px), 4 `aria-*` et **0 `role=`** dans toute l'app.
- Le motif de modale copié-collé dans **7 fichiers**, aucun avec Échap / piège à focus / retour du
  focus / aria-modal.
- `error` était une chaîne unique écrasée à chaque action, et **`pushLog` (~30 appels) n'était rendu
  par AUCUN composant** : le retour utilisateur partait à la poubelle.
- UI **bilingue par accident** : tous les Réglages, toute la fiche héros, le menu d'action de carte,
  les noms de bâtiments et les rôles de repli étaient en anglais.
- ~200 lignes de CSS mort, 3 sélecteurs déclarés deux fois, 4 tokens jamais référencés.

### Fait
1. **Tokens** — échelles d'espacement/rayons/typo/ombres/couches/motion/cibles dérivées des valeurs
   réellement dominantes du fichier (migration préservant le rendu), + socle a11y global.
2. **Barre du bas refondue** — onglets parchemin gravés, **Carte en pastille centrale surélevée**,
   libellés FR (Ville/Sac/Carte/Bâtir/Atelier), cibles 48px, `role="tablist"` + `aria-selected`,
   badge de chantiers, verrou expliqué au tap (le `title=` était invisible au doigt).
   **Les PNG `ui/nav-*` étaient dans le dépôt mais utilisés nulle part** — la barre affichait des
   emoji ; elles sont maintenant rendues.
3. **`ui/Overlay.tsx`** — une seule primitive : Échap, piège à focus, retour du focus au déclencheur,
   `role="dialog"`/`aria-modal`/`aria-labelledby`, variantes modale et feuille. 5 sites migrés.
4. **Toasts** (`ui/Toasts.tsx`) — file empilable auto-effacée en région `aria-live`, branchée sur les
   échecs d'action. Messages réseau devenus humains et français côté `api/client.ts`.
5. **ErrorBoundary** — une exception de rendu laissait un écran BLANC ; écran de secours parchemin.
6. **Accessibilité** — contrastes AA (`--ink-soft`, le token le plus utilisé, était à ~4.3:1 ;
   `--ink-muted` à ~2.7:1), `.iconbtn` 30→44px, écrans « taper pour continuer » passés de
   `<div onClick>` à de vrais boutons, `<header>`/`<main>`, emoji retirés des `alt`.
7. **Français** — Réglages, fiche héros, menu d'action, catégories du Stock, rôles, **noms de
   bâtiments** (via un helper front `buildingName(id)` : les noms serveur ne servent qu'à
   l'affichage, donc aucune migration des parties enregistrées).
8. **Cohérence** — pastilles de héros, barre de héros de la carte et boutons de rotation étaient les
   derniers îlots bleu nuit sur fond crème : repassés sur le système. `.tabs-scroll` manquait
   `min-width:0` (la bande de catégories poussait le chip de PA hors écran).
9. **Ménage** — CSS 3629→3403 lignes, sélecteurs dupliqués fusionnés, tokens morts retirés,
   `TownBar.tsx` (mort) supprimé. `index.html` : titre, favicon SVG, theme-color, description, OG,
   et **`viewport-fit=cover`** (sans lui `env(safe-area-inset-*)` vaut 0, alors que l'app est
   full-bleed en 100dvh et s'appuie dessus).
10. **`scripts/downscale-ui.mjs`** — les icônes de nav sortaient en 1024² pour un carré de 26px et
    avaient fait dépasser le budget de payload PNG. Réduites à 160px : **2,09 Mo → 0,10 Mo**.

### Fonctionnel (vérifié)
- `npx tsc -b` et `npm run build` verts.
- **`npm run test:perf` : 13/13**, payload PNG **23,23 Mo — sous les 23,2 Mo d'avant la refonte**.
- Headless (Playwright, polling par `page.evaluate`) : **aucun débordement horizontal** à 360 / 390 /
  820 / 1280 px sur les 4 onglets ; les 3 overlays testés exposent `role`/`aria-modal`/
  `aria-labelledby`, reçoivent le focus et **se ferment par Échap** ; sous
  `prefers-reduced-motion: reduce` **0 élément animé** ; backend coupé → toast lisible en français.
- Le rendu 3D voxel n'est pas touché (contrainte du projet) — seuls les overlays DOM ont changé.

### À faire
- Les trois chantiers de la Phase 3 restent partiellement ouverts : thème sombre complet de la fiche
  héros, HUD de combat du prototype (barres crème, journal, barre d'actions), et le panneau d'actions
  bas de la carte proposé par le design (le menu radial reste non navigable au clavier).
- Primitives restantes à extraire (`Button`, `Chip`, `Meter`, `SegmentedControl`) : les conventions
  CSS existent, mais chaque fichier écrit encore `<button className="pill red">` à la main. Il y a
  toujours 4 implémentations de barre de progression et 3 de contrôle segmenté.
- Le `log` du store est encore affiché nulle part : sa place est le journal de combat du prototype.
- `.map-controls` / menu radial : reste le dernier bloc au style hérité.


## 2026-07-24 (73) — Studio Personnages voxel (#charstudio)

### Fait (demande : « studio voxel pour visualiser les personnages et les monstres, pour que tu
### puisses les designer et les animer » — doc Claude Design « Refonte Personnages Voxel » INACCESSIBLE
### depuis la session distante [403 / pas d'autorisation design] : implémenté d'après la demande + l'existant ;
### à réaligner si le doc contient des choix précis)
Nouvel outil dev plein écran **`#charstudio`** (bouton titre « 🎭 Persos », `frontend/src/charstudio/`) :
- **Viewport 3D** (VoxelEngine, orbite libre à la souris/doigt, molette/pinch, plateau d'exposition,
  ombres) ; liste Héros (7) / Monstres (9) ; bouton 🔄 turntable.
- **Animations = LE VRAI CODE DU JEU** : le studio charge le modèle, le découpe (`splitRig`), monte le
  squelette (`buildRig`) et joue `applyAnim` — boutons Idle / Marche / Attaque / Compétence / Touché /
  Mort (chorégraphie de `UnitAnimator.playDeath` reproduite : bascule + fondu + enfoncement, puis retour
  idle), curseur de vitesse ×0.25–×2. Ce qu'on voit ici est ce qui joue en partie.
- **Vue 🦴 Parties** : corps gris + membres colorés par rôle/côté (jambes bleues, bras oranges, ailes
  violettes) + billes rouges sur les PIVOTS — pour vérifier la découpe du rig d'un coup d'œil.
- **🧪 Recette live** : `char-recipe.mjs`/`monster-recipe.mjs` **déplacées dans
  `frontend/src/voxel/shared/`** (JS pur, comme recipes.mjs — les scripts Node les importent de là
  désormais) et importées par le studio → régénération DANS le navigateur ; **éditer la recette sous
  Vite HMR met à jour le modèle**. Palettes éditables par rôle (peau/cheveux/tenue/tenue 2/accent —
  corps/accent pour les monstres) avec départ fidèle : `scripts/voxel/gen-palettes.mjs` fige les
  palettes échantillonnées des PNG dans `frontend/src/charstudio/palettes.json` (samplers exportés de
  gen-characters/gen-monsters, `main()` gardé par un garde d'entrée CLI). Export **⬇ .vox** (avec canal
  de partie nPRT pour les héros).
- Panneau Modèle (dims, voxels, kind du rig, arme, membres) + HUD (draw/tris/ms). Hook DEV
  **`window.__cs`** `{select, play, setSource, setParts, setSpeed, setTurntable, state, engine}` —
  pilotable en headless (c'est comme ça que la session l'a vérifié).

### Vérifié (Playwright, captures)
- Gardien idle/marche/attaque (lunge), vue Parties (4 membres + pivots), loup en marche quadrupède,
  archer régénéré par la recette live (arc, capuche verte échantillonnée), mort du slime (fondu +
  enfoncement). `.vox` régénérés par gen-characters/gen-monsters **identiques octet à octet** après le
  déplacement des recettes (git diff vide). `tsc -b` + `npm run build` OK.

### Fix mobile (même jour, retour : « le menu disparaît sur la droite »)
Sur téléphone (≤760px), la liste héros/monstres était une bande horizontale à scroll caché — coupée au
bord droit, monstres invisibles. Remplacée par un **dropdown natif** (`.cs-select`, optgroups
Héros/Monstres) pleine largeur ; les panneaux Palette/Modèle se PARTAGENT la largeur (`flex:1 1 0;
min-width:0` — plus de débordement à 420px sur un écran de 390). Vérifié Playwright 390×844 / 844×390 /
820×1180 : `scrollWidth == largeur` partout, capture OK.

### À faire
- Récupérer le doc « Refonte Personnages Voxel » (Canva/Claude Design) et aligner le studio dessus.
- Édition de la FORME dans le studio (aujourd'hui : couleurs + code de recette sous HMR).

## 2026-07-22 (72) — Reprise EN COMBAT après avoir quitté le site

### Fait (retour : « si je quitte le site en plein combat, je dois pouvoir rejoindre l'arène/le combat engagé »)
Le backend supportait déjà `JoinCombat` (idempotent) et le payload de partie porte `combats`, mais le front
laissait le joueur bloqué : `adoptGame` (reprise) posait toujours `view:"map"` + `combat:undefined`, et le
bouton « Rejoindre » était gaté par `!participants.includes(playerId)` — un participant revenu (déjà inscrit,
jamais retiré côté serveur) ne pouvait donc JAMAIS le voir.
- **`store.ts`** : `adoptGame` détecte `myActiveCombat(game, pid)` → pose `view:"combat"` + `combat` (depuis
  le payload) et, en async, (ré)ouvre l'arène (`api.joinCombat` en multi / `api.getCombat` en solo legacy
  sans playerId) pour récupérer le tour courant. `enterActiveGame` bascule sur l'onglet **Map** si on reprend
  en combat (l'arène y vit) au lieu de forcer Home. `joinCombat` gère aussi le solo legacy (GET au lieu de POST).
- **`MapTab.tsx`** : bouton « Rejoindre le combat » affiché dès qu'un de mes héros est engagé (`canJoin = !!mine`),
  même si je suis DÉJÀ participant (filet de sécurité pour le retour après déconnexion).

### Vérifié (Playwright, bout en bout)
- Engager un combat → recharger la page → « Reprendre » : on revient AUTOMATIQUEMENT dans l'arène, MÊME
  combat (`combatId` identique), `view:"combat"`, `tab:"map"`, `current` rempli, `VoxelCombatView` monté,
  contrôles de tour présents (capture). Reprise HORS combat inchangée (Home). `tsc -b` + `npm run build` OK.

## 2026-07-22 (71) — Fix : la lueur des braseros de combat traversait les blocs

### Fait (retour : « le coin en haut à gauche, la torche se voit à travers les blocs »)
Bloom SÉLECTIF mal occlus (`engine.ts`) : la passe bloom rendait UNIQUEMENT le calque lumineux
(`camera.layers.set(BLOOM_LAYER)`) → aucun occludeur n'écrivait la profondeur → la lueur des flammes
d'angle traversait le décor. Passé à la technique standard « darken non-bloomed » : la passe bloom rend
la scène ENTIÈRE mais tout ce qui n'est pas lumineux est peint en NOIR (meshes → `darkMat`, qui écrit la
profondeur et occlut la lueur ; sprites → masqués), puis restauré avant la passe finale. `bloomLayers`
(THREE.Layers) teste l'appartenance au calque ; `darkenNonBloomed`/`restoreAfterBloom`.

### Vérifié
- Combat (bloom on par défaut) : les 4 braseros rayonnent toujours mais la lueur est OCCLUSE par les
  terrasses (2 angles capturés). Rendu normal (pas de scène noire). `tsc -b` + `npm run build` OK. Le fix
  vaut pour toutes les vues voxel (carte : cristaux/lucioles ne bavent plus non plus).

## 2026-07-22 (70) — Minuteur de tour en combat (anti-blocage multijoueur)

### Fait (retour : « en combat, un temps max de fin de tour pour ne pas bloquer à plusieurs »)
Un tour de combat laissé en souffrance par un joueur AFK est résolu automatiquement — UNIQUEMENT en
combat PARTAGÉ (≥2 joueurs présents ; en solo/legacy aucune limite).
- **`combat.go`** : `TurnLimit` (var, 60 s, surchargée par `ECHOTERRA_TURN_SECONDS`) ; `Combat.TurnDeadline
  *time.Time` (`json:"turnDeadline,omitempty"`). `advanceTurn` purge l'échéance (nouveau tour) ;
  `advanceUntilHeroOrEnd` l'arme à la pause sur un héros d'humain présent via `armTurnTimer` (gaté par
  `sharedHumanCombat` = `len(Participants) >= 2`) ; `JoinCombat` l'arme aussi (le combat peut devenir
  partagé pendant un tour en cours). `EnforceTurnTimer(now)` : si dépassé, `heroAutoAct` (l'IA joue le
  héros) + `Seq++` + `endTurn` (réarme le prochain). `GameState.EnforceCombatTimers(now)`.
- **`api.go`** : enforcement paresseux dans `getCombat` (le poll combat 3 s du client) et le `tick`
  serverless, + proactif dans `waveScheduler` (toutes les 15 s, sous le verrou). `main.go` : env
  `ECHOTERRA_TURN_SECONDS`.
- **Front** : DTO `Combat.turnDeadline` ; hook `useTurnRemaining(combat)` (secondes, null si pas de
  minuteur) ; badge « ⏱ Ns » sur le tour courant dans `CombatControls` (le mien ET celui d'un autre
  joueur), rouge sous 10 s.

### Vérifié
- `game` : minuteur NON armé en solo ; armé après jonction du 2e joueur ; `EnforceTurnTimer` expiré →
  tour avancé + `Seq++` + réarmé. `api` : GET combat après échéance dépassée → tour AFK résolu (`Seq`
  bump). Toute la suite Go verte, `go vet` OK, `tsc -b` + `npm run build` OK.

## 2026-07-22 (69) — Rendu CINÉMATIQUE voxel par défaut

### Fait (retour : « voxel par défaut + rendu maximum en mode cinématique »)
`DEFAULT_SETTINGS` : `voxelBeauty: true` (passe cinématique — tone mapping ACES + bloom + ciel/brume) et
`quality: "Very high"` (voxelMap/voxelSmooth étaient déjà true). **Migration UNIQUE** (`RENDER_PRESET`,
`loadSettings`) : les installs avec réglages déjà sauvegardés basculent une fois en voxel + cinématique max
(persistée → un opt-out ultérieur est respecté, pas ré-écrasé). Les autres réglages sauvegardés (volume…)
sont conservés.

### Vérifié (Playwright)
- Session vierge : voxelMap/voxelSmooth/voxelBeauty=true, quality="Very high", renderPreset=1.
- Ancienne sauvegarde (beauty off, sans marqueur) → migrée en beauty on + Very high (music préservée).
- Opt-out manuel respecté après reload (reste off). Moteur : `engine.beauty` actif sur la carte.
- `tsc -b` OK.

## 2026-07-22 (68) — Animation de MORT/défaite (combat)

### Fait (loop)
Quand une unité tombe à 0 PV en combat, elle **s'effondre** (bascule en arrière ~90°) + **se fond**
(opacité→0) + **s'enfonce**, sur 850 ms, puis est retirée — au lieu de disparaître sèchement.
- `unitAnim.ts` : `UnitAnimator.playDeath(rig,x,y,z,face)` — prend possession d'un rig détaché du registre
  vivant (clone ses matériaux pour le fondu), l'anime dans la boucle rAF (`dying[]`), le retire + libère à la
  fin ; `endFrame`/`tick` gardent la boucle vivante tant qu'une mort est en cours.
- `VoxelCombatView` : groupe `deaths` (survit aux redraws) ; `spawnDeaths(prevUnits)` diffe les unités
  passées de vivantes → 0 PV/fled entre deux `seq` et lance un rig d'effondrement à leur dernière case/cap ;
  appelé dans le handler `CombatRender` après `animateAction`.

### Vérifié (Playwright + logs)
- `playDeath` : durée réelle **863 ms** (p 0.015→1.016) puis retrait auto ; fondu amorcé (opacité 1→0.98).
  Le tab headless throttle le rAF (2 ticks seulement) → la courbe intermédiaire n'est pas échantillonnée mais
  s'anime à 60 fps en vrai navigateur. `tsc -b` OK.

## 2026-07-22 (67) — Attaques SPÉCIFIQUES À L'ARME (héros)

### Fait (loop « pousser plus loin »)
Le geste d'attaque du héros dépend maintenant de son **arme** (`weaponFor(key)` dans `rig.ts` → `RiggedGeom.weapon`
+ `weaponSide`, propagé au `Rig`) : **mêlée** (chevalier/défaut) = arme haute puis fauchage du bras armé ;
**arc** (chasseur) = l'arc reste tendu à l'avant, la MAIN LIBRE arme la corde (recul) puis relâche d'un coup ;
**bâton** (mage à droite, soigneur à gauche) = poussée sèche du bras armé vers l'avant. La compétence lève les
deux bras (le bâton monte plus haut). `applyAnim` branche sur `rig.weapon`/`rig.weaponSide`.

### Vérifié (Playwright, `applyAnim` piloté directement)
- knight melee : bras armé −1.38 (fauchage), contre 0.41 ; archer bow : bras arc −0.50 stable, **main libre +1.08**
  (tir) ; wizard/healer staff : bras armé −1.60 (poussée). Détection d'arme correcte par classe.
- `tsc -b` OK.

## 2026-07-22 (66) — Bras/armes séparés (héros) + animation d'attente en ville

### Fait (retour : « ajoute l'idle en ville, et bras/armes séparés pour les héros »)
- **Bras & armes des héros = vraies parties riggées.** La découpe géométrique depuis le maillage cuit
  était impossible (accessoires étalés sur plein de tranches z). Solution : **canal de PARTIE tagué au
  niveau de la recette** — `Grid.curPart` (0 corps / 1 legL / 2 legR / 3 armL / 4 armR), `setFine` écrit
  `partData`, `generateCharacter` tague jambes/bras + **l'arme tenue** (épée/arc/bâton → bras qui la porte).
  Stocké dans un **chunk maison `nPRT`** du `.vox` (1 octet/voxel, MagicaVoxel l'ignore ; `vox.ts` +
  `vox-format.mjs` le lisent → `VoxModel.parts`). `splitRig` : héros = découpe EXACTE par ce canal (pivots
  aux attaches connues hanche/épaule), monstres = bandes géométriques (inchangé). `applyAnim` : à la marche
  les bras contre-balancent les jambes ; à l'**attaque** le bras ARMÉ (droit) s'arme puis abat vers l'avant
  (l'arme suit), l'autre contre-balance ; à la **compétence** les deux bras se lèvent (invocation). 7 `.vox`
  héros régénérés (`gen-characters.mjs`).
- **Idle en ville** (`VoxelTownView`) : les héros de la place ne sont plus des billboards mais des **rigs
  voxel animés** (respiration à l'arrêt) — `CharLibrary` + `UnitAnimator` (faceCamera), fallback billboard si
  le modèle manque.

### Vérifié (Playwright, sondes sur les transforms)
- Héros = **4 membres** (legL/legR/armL/armR) sur la carte, en combat ET en ville.
- Combat, attaque du héros : **bras droit (épée) balance −1.24 rad**, bras gauche +0.37 (contre), jambes ±0.05.
- Ville : rigs héros à 4 membres, `tilt.y` oscille (idle actif) ; rendu intact (capture Home).
- `tsc -b` OK, `npm run build` OK ; seuls les 7 `.vox` héros changent (monstres/prévisualisations inchangés).

## 2026-07-22 (65) — Personnages & monstres ANIMÉS (rig à membres + anims procédurales)

### Fait (retour : « animer les personnages et les monstres — déplacements, attaques, compétences »)
Système d'animation d'unités voxel, SANS régénérer aucun asset : les `.vox` monolithiques sont
**découpés au chargement** par bandes de voxels (jambes/pattes/ailes proprement séparables ; le reste
= corps), et un petit squelette THREE fait pivoter chaque membre autour de son articulation (même
astuce que les vantaux du portail). Les créatures SANS membres reçoivent une anim « logique » du corps
entier.
- **`rig.ts`** : `SPECS` par clé de modèle (héros=bipède, goblin/orc=bipède, wolf=quadrupède, spider=critter,
  bat=ailé ; slime/mushroom=blob squash&stretch, ghost=flottement, windelemental=rotation) ; `splitRig`
  découpe (corps + membres avec pivots en coords locales du mesh), `buildRig` assemble root→tilt→membres,
  `applyAnim` mute les transforms selon l'état (idle respiration / walk foulée / attack lunge+piqué /
  skill accroupi→jaillit+pulse / hit recul).
- **`unitAnim.ts`** (`UnitAnimator`) : registre par id survivant aux reconstructions de draw, détecte les
  DÉPLACEMENTS (lerp de pose + arc de saut → walk), joue les one-shots (attaque/compétence/touché), une
  seule boucle rAF qui invalide le moteur tant qu'il reste des unités et l'onglet visible.
- **`characters.ts`** : `makeRig(key)` (géométries découpées en cache) + `setRigOpacity` (héros des autres,
  translucides).
- **Carte** (`VoxelMapView`) : héros/monstres = rigs animés (idle + marche au déplacement d'une case),
  face caméra ; **Combat** (`VoxelCombatView`) : rigs orientés selon leur Facing ; l'action du JOUEUR émet
  `EV.CombatAnim {unitId,kind}` (lunge d'attaque / cast précis), le recul des cibles vient de `lastHits`,
  l'acteur ENNEMI est déduit (unité active du camp opposé, sinon la plus proche d'une cible).

### Vérifié (Playwright headless, sondes sur les transforms des rigs)
- Carte : slime **squash** (scale.y 0.92→0.82), ghost **flotte** (tilt.y), élémentaire **tourne**
  (rot.y 48→52°), goblin **jambes qui balancent** en contre-phase ; héros **marche** au déplacement
  (jambes ±0.17, penché −0.08, saut +0.03).
- Combat : **attaque** = lunge (z −0.32) + piqué (rot.x 0.50 vers la cible) ; **compétence** = jaillit
  (y +0.28) + pulse d'échelle (1.14). Rigs rendus sans crash, idle actif.
- `tsc -b` OK, `npm run build` OK.

### À faire / notes
- La VILLE (Home voxel) rend encore les héros en **billboards** (pas de rig) — anim d'attente à ajouter
  si voulu. Les vues Phaser classiques ne sont pas concernées (voxel par défaut).
- Bras/armes des héros restent dans le CORPS (le lunge/piqué les emporte) : segmentation des bras
  bloquée par les accessoires cuits sur de nombreuses tranches z — évolution possible via parties au
  niveau de la recette.

## 2026-07-22 (64) — Portail voxel : vantaux ANIMÉS + état ouvert/fermé visible par tous

### Fait (retour utilisateur : « animer l'ouverture de la porte en voxel, état visible pour tous »)
- **Vantaux séparés du portail** : `bldGate` (scripts/voxel/gen-props.mjs) ne contient plus les deux
  battants — c'est désormais la MAÇONNERIE SEULE (tours + arche + bannière). Deux modèles voxel
  distincts `bld-gate-door-l` / `bld-gate-door-r` (fonction `bldGateDoor(side, seed)`) construits dans
  la MÊME grille pleine 30×30×45 → une fois meshés ils partagent exactement le repère de la maçonnerie
  (posés au même transform, ils tombent pile dans l'ouverture). 3 variantes de dégâts comme le portail
  mais SANS gravats épars (`damagePass(..., noLumps=true)`).
- **Animation d'ouverture** (`VoxelTownView.tsx`) : la vue Home compose le portail construit en
  maçonnerie + 2 groupes-gonds (`GATE_HINGE` = faces externes fine x9/x23 → local X −0.2 / +0.2667,
  profondeur Z=0). Chaque vantail pivote autour de son gond ; `gateAnim.current` (0 fermé → 1 ouvert)
  est lissé image par image dans la boucle rAF des nuages (easing exponentiel ×0.14) vers
  `gateTarget = b.open ? 1 : 0`, angle max `GATE_OPEN_ANGLE = 1.75` rad (~100°). L'angle courant
  PERSISTE entre les reconstructions de `drawBuildings` (pas de flash au poll). Ombres re-cuites en fin
  de course.
- **Visible par tous** : `TownBuilding.open` est déjà server-authoritative et repoussé à tous les
  joueurs (poll 20 s) — le rendu suit simplement `b.open`, donc tous voient la même porte ouverte/fermée.

### Vérifié
- `.vox` déterministes : re-run gen-props ne diffe QUE le portail + les 2 vantaux (extents décodés :
  door-l fine x9..16, door-r x15..22, gond ✓). `tsc -b` OK, `npm run build` OK. Rendu logiciel de la
  porte FERMÉE (frame+vantaux fusionnés) : battants alignés dans l'arche entre les tours.
- Catalogue régénéré (`build-catalog.mjs`, 612 assets).

### Correctif (retour : « je ferme la porte et je ne vois pas d'animation »)
- Diagnostic par Playwright headless (partie solo → Home voxel, toggle porte, échantillonnage de
  `gatePivots.rotation.y`) : l'état S'ANIMAIT bien (rotations lissées dans les deux sens), mais les
  vantaux étaient **BAS et au fond de l'arche → masqués par les tours en vue iso**, donc la fermeture
  était imperceptible au zoom normal (captures ouvert/fermé quasi identiques).
- Fix : vantaux **HAUTS (z 0→9, ~hauteur des tours)** et posés **AU FRONT de l'ouverture (y≈8)**,
  gonds Z au front (`GATE_HINGE.z −0.0667`), swing **vers l'avant** (signes inversés) à `GATE_OPEN_ANGLE`
  1.4 rad (~80°). Rendu Playwright : ouvert = deux battants écartés bien visibles, mi-course = ~45°,
  fermé = battants rabattus au front → animation nette même dézoomé.

### À faire / notes
- La carte de ville CLASSIQUE (Phaser/TownMap billboards PNG) ne montre pas l'état porte — hors périmètre
  (le voxel est le rendu par défaut).

## 2026-07-22 (63) — Horde : scaling INFINI par vague + fusion des packs en migration

### Fait (retour utilisateur)
- **Scaling infini par vague** : `spawnWaveMonsters` perd son plafond de 20 packs (`4+waveNumber`,
  borné en pratique par la saturation des tuiles) ; `spawnWeightedPack` empile la croissance de vague
  (`waveNumber/2`) SANS clamp au PackMax (le PackMax ne borne plus que la taille de départ). Résultat :
  la taille des packs grandit sans borne → intensification réellement infinie.
- **Fusion des packs qui avancent** : `migrateMonstersTowardTown` — quand le pas d'un pack vers la ville
  est bloqué par un AUTRE pack (aucune case libre plus proche), les deux **fusionnent** (`mergePacks` :
  effectifs additionnés, le groupe le plus nombreux impose espèce/apparence/stats/PV ; le mobile
  disparaît dans le pack resté en place). Snapshot des IDs + `acted` : chaque pack ne joue qu'une fois,
  un survivant de fusion ne rebouge pas ; un pack en combat ne migre/fusionne pas.

### Vérifié
- `go test ./...` OK (nouveaux : `TestMigrationMergesBlockedPacks`, `TestMergeBiggerGroupImposesSpecies`,
  `TestPackGrowthUnbounded`).
- Simulation API (safe waves) : créatures 7 → 916 de la vague 0 à 30, packs consolidés ~21, max pack 186
  (≫ PackMax) — scaling + fusion confirmés.

### Notes
- Pas de changement front (le teint de danger clampe au rouge à 6+ ; combat plafonne les unités à 4).

## 2026-07-21 (62) — Plans de chantier à TROUVER + hauteur des biomes + oliviers + cheat vague sûre

### Fait
- **Plan à trouver + matériaux + PA (retour : « je ne loot pas assez de bois/pierre pour bâtir » →
  affiné : « besoin du plan PUIS des resources et des PA ; les plans de bâtiments simples faciles à
  trouver »)** : la construction NEUVE (niveau 1) d'un site exige EN PLUS un **plan (blueprint) trouvé**
  dans la Banque, requis+consommé à la POSE (gate SUPPLÉMENTAIRE, pas un remplacement — matériaux niv.1
  toujours requis à l'investissement). `buildingPlanItem` (Mairie/Tour/Cuisine/Recyclerie), `BuildReq.Plan`,
  `buildingCost` (Materials niv.1 + Plan), pose gatée/consommée dans `TownAction`. Améliorations (niv.2/3)
  sans plan. **Plans des bâtiments SIMPLES (recyclerie, cuisine) COMMUNS** dans les biomes proches de la
  ville (sable/prairie, poids 2-3) ; avancés (tour/mairie) modérés (forêt/montagne, poids 1). Aussi droppés
  par les **ruines** (repurpose des « Plan ancien : X »). Front : `BuildReq.plan`, StructureTab affiche
  « 📐 <plan> 0/1 » + matériaux et gate « Poser le plan » (pose = plan seul ; invest = matériaux), ItemGrid
  emoji 📐. Tests : `build_test.go` (plan+matériaux, recyclerie, plans communs vérifiés), `design_test.go`.
- **Hauteur/taille des biomes augmentée sur la carte** : `smoothTerrain HEIGHT_SCALE 1.9→2.6`
  (montagnes/collines plus hautes, terrasses marquées ; carte seule — combat `heightScale:1`, ville
  intacte), arbres `VoxelMapView 1.3→1.6`.
- **Oliviers du temple agrandis** (0.34–0.44 → 0.7–0.9) : ridicules à côté des arbres boostés sinon.
- **Cheat « passer la vague sans dégâts »** : bouton 🛡️ dans le menu Triche → `ForceWaveSafe`/
  `processWave(safeTown)` (la vague avance mais PV ville + durabilité intacts) ; endpoint `/advance`
  `{safe:true}`. Tests `safewave_test.go`.

### Vérifié
- `go test ./...` OK (dont blueprint/recyclerie/safewave), `tsc` + `build` OK, perf voxel 12/12.
- Rendu Playwright : relief en terrasses + gros arbres, oliviers à l'échelle, StructureTab montre les
  plans requis (0/1 rouge, bouton grisé → vert quand le plan est en Banque), API refuse la pose sans
  plan (« il faut trouver « Plan de la Recyclerie »… »).

### À faire / notes
- Équilibrage du taux de drop des plans à surveiller (poids 1 en fouille + ruines) — ajuster si trop
  rare/fréquent en jeu réel.

## 2026-07-21 (61) — Recyclerie : nouveau bâtiment à construire pour recycler les débris

### Fait (retour utilisateur : « je préfère que le recyclage soit dans une NOUVELLE structure à construire »)
- **Nouveau bâtiment `recyclerie`** (chantier à bâtir, pas construit au départ) :
  `DefaultBuildings` (site), `buildPA` (12), `BuildingDesigns` (requiert Workshop 1 ;
  niveaux Bois/Pierre → Planche/Brique). Se pose/construit via l'onglet **Structure**
  (data-driven).
- **Recettes de recyclage gatées dessus** : `recycle_wood`/`recycle_stone` passent de
  `Building "workshop"` à `"recyclerie"` — tant qu'elle n'est pas construite, le
  recyclage (3 Débris + 1 PA → 1 Bois / 1 Pierre) est refusé.
- **Modèle voxel `bld-recyclerie`** généré (`gen-props.mjs` : `bldRecyclerie`, hangar
  bois + toit vert + bacs de tri) — 3 variantes de durabilité ; **placé dans la ville**
  (town-map.json (36,48), `ASSET_TO_BUILDING`, préchargé) → rendu 3D + hotspot ♻️.
  Métadonnées front (`buildings.ts` : icône ♻️, blurb).

### Fonctionnel (vérifié)
- `go test ./...` vert (`TestRecycleDebrisIntoMaterials` : refus tant que la Recyclerie
  n'est pas bâtie, puis 3 Débris + 1 PA → Bois/Pierre depuis la Banque). `tsc` + build.
  Rendu Home : la Recyclerie apparaît avec son modèle + label ♻️.

## 2026-07-21 (60) — Densité de monstres relevée (carte peuplée dès le départ)

### Fait (retour utilisateur : « le nombre de monstres sur la carte est ridicule vs l'attaque de vague ; plus de monstres dès le début »)
- **Seed initial ∝ surface** : `SeedStartingMonsters` passe de `3 + (players-1)` à
  `6 + aire/280 + 2*(players-1)` → **~18 packs** sur une carte 60×60 (contre 3), et
  ~26 en solo-avec-bots (5 « joueurs »).
- **Monstres VISIBLES dès le départ** : le fog cachait tous les packs (posés hors de
  l'anneau découvert) → 0 visible au lancement. `spawnPackInBand` pose désormais
  `3 + (players-1)` packs dans l'anneau DÉJÀ DÉCOUVERT autour de la ville
  (`[safeRadius+1 .. townSightRadius]`) — **3 à 7 monstres visibles immédiatement**,
  le reste réparti au loin (révélé à l'exploration + migration).
- **Densité de fond** : `spawnChance` = `0.45 + 0.55*dist` (fond peuplé partout,
  plus dense au loin) au lieu du quadratique qui vidait tout sauf les bords ; anneau
  vierge réduit à **1** (seul le pourtour immédiat de la ville).
- **Apparition par vague** relevée : `2 + vague/2` (plafond 8) → `4 + vague`
  (plafond 20) — la horde sur la carte grossit vraiment vague après vague.

### Fonctionnel (vérifié)
- `go test ./...` vert (`TestStartingMonstersScaleWithPlayers` recalé sur la densité,
  `spawn_test.go` : distance/ruines/vague croissantes toujours OK). Serveur réel :
  60×60 → 3 visibles / 18 total (1 joueur), 7 visibles / 26 total (solo-bots) ; rendu
  carte confirmant les packs + badges ☠ autour de la ville.

## 2026-07-21 (59) — Économie d'exploration : biomes accessibles + épuisement des cases

### Fait (retour utilisateur : « facilitons l'accès des biomes + ajoutons l'épuisement des cases pour pousser à explorer »)
- **Accès aux biomes garanti** (`worldgen.ensureNearbyBiomes`) : après le placement de
  la ville, si aucune **forêt** (bois) ou **montagne** (pierre) n'est à portée
  (rayon 10), on grave une petite tache 2×2 du biome manquant sur l'anneau de terre
  le plus proche (biome + richesse ; hauteur inchangée). Le worldgen garantit donc
  Bois et Pierre atteignables au départ. Vérifié sur 30 seeds + serveur réel
  (forêt 69 / montagne 3 dans un rayon 10 autour de la ville).
- **Spécialisation restaurée** (retour arrière du bootstrap herbe→Bois/Pierre du
  commit précédent) : herbe/sable NOURRISSENT, FORÊT = bois (poids 3), MONTAGNE/NEIGE
  = pierre/minerais (richesse 1–3 → **2–4** pour valoir le déplacement).
- **Épuisement des cases** (`SearchTile`) : plus de refus « case épuisée ». Une case
  n'est riche que `Resources` fouilles ; ensuite elle **ne rend plus grand chose** —
  75 % de **Débris**, 25 % encore une vraie ressource (`depletedFindPct`) — ce qui
  pousse à explorer des cases fraîches (boucle façon Hordes).

### Fonctionnel (vérifié)
- `go test ./...` vert : `TestEnsureNearbyBiomes` (30 seeds : forêt+montagne à portée),
  `TestTileDepletionYieldsMostlyDebris`, `TestForestYieldsWoodMountainYieldsStone`,
  `TestEveryBuildingMaterialIsObtainable` (garde-fou : aucun matériau de bâtiment
  inobtenable). `tsc` + build. Smoke serveur réel OK. Studio (front) resynchronisé.

## 2026-07-21 (58) — Arène de combat : sol en pentes voxel lissées (fini les gros cubes) + décor curé

### Fait (retour utilisateur : « les herbes trop nombreuses/moches, et les blocs pas beaux — autre chose que des blocs serait sympa »)
- **Fini les gros cubes** : le sol de l'arène est désormais rendu en **pentes voxel
  LISSÉES** (le même `SmoothTerrain` que la carte du monde), au lieu du `buildTerrain`
  en blocs 32³. `SmoothTerrain.build` prend un `opts {heightScale, rollAmp, micro}` :
  la carte amplifie/roule, le **combat** passe `{1, 0, 0}` → marches fidèles, plateaux
  plats et lisibles, pentes arrondies. Cases d'eau (hazard) → biome 0 creusé (shader
  d'eau `setTime` sur les frames). `heightAt` (logique serveur) inchangé ; nouveau
  `surfaceY()` = sommet lissé où se posent overlays/unités/props/dégâts flottants.
- **Socle-île LISSE** : tronc de pyramide (`CylinderGeometry` 4 faces, `PLINTH_MAT`)
  sous l'arène — plus de blocs empilés, une seule forme propre.
- **Décor curé** : densité **38 % → 12 %**, plus de « touffes d'herbe » (retirées) —
  fleurs/champignons/fougères/galets épars par biome (`DECO_BY_BIOME` nettoyé) ; le
  sol lissé apporte déjà ses pointillés d'herbe. Cristaux sur le calque bloom.
- **Picking réécrit** : plus de `lookup` instance→case (blocs) ; un clic sur le mesh
  lissé unique → case = arrondi du point d'impact (`Math.round(point.x/z)`). Vérifié.
- Braseros d'angle conservés (flamme self-lit sur calque bloom → glow en beauté).

### Fonctionnel (vérifié)
- `tsc` + `npm run build` OK ; perf voxel **12/12** (carte/ville inchangées). Rendus :
  `combat-smooth-beauty`/`combat-smooth-fit` (île lissée + braseros, arène lisible),
  overlays tactiques (cases vertes/anneaux) alignés. **Picking** e2e : projection de
  la case (2,3) → `onTap` → `CombatTileClick {2,3}` ✓.

## 2026-07-21 (57) — Arène de combat : diorama-île, braseros lumineux, ciel crépusculaire

### Fait (retour utilisateur : « améliore la carte des combats pour qu'elle soit bien plus jolie »)
- **Socle-île flottante** : l'arène ne flotte plus dans un vide plat — un **socle en
  pyramide inversée** (terre puis roche, `buildStacks` en niveaux négatifs, liseré
  d'1 case + `inset` croissant) descend sous chaque case → vrai diorama posé.
- **Braseros d'angle** (×4) : vasque `CylinderGeometry` + flamme `IcosahedronGeometry`
  self-lit posée sur le **calque bloom** (`BLOOM_LAYER`) → **rayonnent** en mode
  beauté (halo chaud, façon FFTA2), et restent des braises orange en mode standard.
- **Fond crépusculaire** : dégradé indigo→mauve (`makeSkyGradient`, exporté) au lieu
  du à-plat `0x161022` → profondeur atmosphérique.
- **Décor épars** : herbe/fleurs/champignons/cristaux par biome (`DECO_BY_BIOME`) sur
  les cases plates vides (ni relief, ni obstacle, ni danger), placement haché ~38 % —
  de la vie sans gêner la lecture tactique ; cristaux/glace posés sur le calque bloom.
- **Passe beauté branchée au combat** (`engine.setBeauty(..., {keepBackground:true})`,
  nouveau flag : la vue garde SON fond, on n'ajoute que tone mapping + bloom sélectif) ;
  suit `settings.voxelBeauty` à chaud.
- **Cadrage par défaut** revu : vise plus bas (`y=-0.5`) et zoom adapté à la grille
  (`380/gridW`, boss 9×9 compris) → on voit le socle-île tout en gardant l'arène lisible.

### Fonctionnel (vérifié)
- `tsc` + `npm run build` OK ; perf voxel **12/12**. Rendus e2e : `combat-wide`
  (socle-île + 4 braseros), `combat-wide-beauty` (braseros qui GLOW), `combat-fit`
  /`combat-fit-beauty` (cadrage de jeu — arène lisible + île + braseros).
- Overlays tactiques (cases vertes, anneaux, picking, barres de PV, Facing) intacts ;
  géométries/matériaux des braseros/déco PARTAGÉS (pas de fuite par redraw).

### Reste à faire
- Braseros animés (flamme qui vacille) — nécessiterait un rendu continu (batterie).

## 2026-07-21 (56) — Rendu « beauté » expérimental : tone mapping ACES + ciel chaud + bloom SÉLECTIF

### Fait (retour utilisateur : « ce style [3D lumineux, cristaux brillants] est magnifique, faisable en voxel ? »)
- Nouveau réglage **`settings.voxelBeauty`** (off par défaut) → **Réglages → « Rendu
  beauté : Cinématique / Standard »**, câblé à chaud sur `VoxelMapView` et
  `VoxelTownView` (abonnement au store). `engine.setBeauty(on)`.
- **Passe légère** : tone mapping **ACES filmique** (+ exposition 1.15) + **ciel
  dégradé chaud opaque** (horizon doré, `makeSkyGradient`) + `setClearAlpha(1)` en
  beauté (sinon le ciel CSS clair transparaît et délave) ; brume `THREE.Fog`
  optionnelle (off par défaut — la caméra ortho la rend très sensible).
- **BLOOM SÉLECTIF** (le « glow » de la référence) : un bloom GLOBAL délavait toute
  la scène (décor clair, quasi pas d'émissifs HDR) → technique à deux composers.
  `BLOOM_LAYER = 1` : les props LUMINEUX (`GLOW_PROPS` = luciole/cristal/givre,
  `GLOW_MAT` self-lit) sont posés sur ce calque EN PLUS du calque 0. Au rendu :
  (1) `bloomComposer` rend la scène caméra restreinte au calque bloom (fond/brume
  retirés → seuls les émissifs sur noir) puis `UnrealBloomPass` ; (2) `finalComposer`
  rend la scène normale (ciel+brume) puis un `ShaderPass` ADDITIONNE la texture de
  bloom, puis `OutputPass` (tone mapping). Résultat : cristaux/lucioles rayonnent,
  le reste reste net. Rendu **on-demand préservé** (composers seulement aux redraws).

### Fonctionnel (vérifié)
- `tsc` + `npm run build` OK ; perf voxel **12/12** (chemin par défaut = beauté OFF,
  inchangé — les composers ne sont construits qu'à l'activation). Rendus e2e :
  `beauty-town` (terrasses dorées chaudes, horizon doré), `bloom-map` (cristaux
  injectés rayonnant sur calque bloom, reste de la scène net, zéro délavage).
- Chemin par défaut (transparent + `renderer.render`) intact.

### Reste à faire
- Étendre `GLOW_PROPS` (fleurs magiques ?) si on veut plus de glow en plaine.
- Éventuel Tier « mode beauté desktop » : eau réfléchissante / god-rays / DOF
  (coûteux, rendu continu → réservé desktop, pas mobile).

## 2026-07-20 (55) — Lot d'ajustements : header, danger, échelle, créneaux de reprise, apparition des monstres, tour sur la montagne

### Fait (retours utilisateur groupés)
- **Prochaine vague dans le header** : le compte à rebours 🌊 est désormais un
  *chip* de la `TopBar` (à côté de 🏰%). Le bandeau secondaire `.wave-row` /
  `WaveBanner` (sous la barre) est SUPPRIMÉ. Le bouton « 🌊 Forcer vague » de la
  carte est retiré (déjà présent dans le panneau 🔧 Triche) ; `MapControls` ne
  garde que « Rejoindre le combat » + « 👥 Autres » (et disparaît si rien à
  afficher).
- **Dangerosité des monstres ≠ losanges de déplacement** : plus de teinte de danger
  posée SUR la case (elle entrait en conflit avec le losange jaune des cases
  atteignables). Le losange coloré est désormais RÉSERVÉ aux déplacements du héros
  sélectionné ; la dangerosité passe par un **badge flottant `☠ N` au-dessus du
  monstre**, teinté jaune (petit pack) → rouge (gros pack).
- **Échelle carte** (monstres/persos/arbres/ville) : la **ville** (temple) domine
  (scale 1.6 → 2.1) ; les **arbres** montés d'un cran sur la carte (×1.3) pour
  dépasser les personnages ; les **monstres** ont une taille PAR ESPÈCE
  (`MONSTER_SCALE` : limace/chauve-souris ~0.8× ≪ élémentaire/loup/orc ~1.2× ≪
  boss 1.8×). `HERO_HEIGHT` (partagé avec le combat) inchangé.
- **Menu : deux créneaux de reprise indépendants** (`GameSlot` = `solo` | `mp`) :
  un joueur peut être dans UNE partie solo ET UNE publique/privée en même temps,
  mais pas deux publiques/privées. Le menu masque le bouton d'entrée d'un créneau
  occupé et affiche « ▶ Reprendre — SOLO » / « ▶ Reprendre — PARTIE » à la place
  (`localStorage echoterra:game:{solo,mp}`, `slotForGame`, `resumeSlot`,
  `forgetGameSlots` au départ/expulsion/gameover).
- **Apparition des monstres repensée** (`monsters.go` `spawnChance` +
  `spawnWeightedPack`, `wave.go` `migrateMonstersTowardTown`) : probabilité qui
  **croît avec la distance à la ville** (quadratique ; anneau de sécurité de rayon
  2 = zéro), **autour des ruines** (+0.6 dans un rayon 3), et **à chaque vague**
  (+20 %/vague). Les packs **non tués se rapprochent d'un pas de la ville à chaque
  vague** (jamais sur la case ville, jamais en plein combat). Seeding initial
  RÉDUIT (3 + joueurs) et repoussé au loin → **presque pas de monstres autour de
  la ville au début**.
- **Tour SUR la montagne** (`town-map.json`) : la cellule (44,44) de la tour était
  à plat (h0) au pied de la crête ; un **plateau de pierre h=2** (basalte+pierre,
  3×3) est posé sous son emprise → chantier ET tour construite se posent au sommet
  (`cell.height+1 = 3`, même chemin de code pour les deux états).
- **Débordement des modales** (`.settings .panel-card`) : `box-sizing: border-box`
  (la `width:100%` + `padding:18px` débordait horizontalement du viewport), et
  `max-height` en `dvh`. État de la ville + Journal tiennent maintenant dans
  l'écran (scroll interne).

### Fonctionnel (vérifié)
- Backend : `go test ./...` OK (nouveau `spawn_test.go` : distance/ruines/vague
  croissantes, migration vers la ville, jamais sur la ville, saut si en combat ;
  `lobby_test.go` mis à jour : seeding réduit + anneau de sécurité vide).
- Frontend : `tsc` + `npm run build` OK ; perf voxel **12/12** (tris/draw-calls/
  géométries stables malgré arbres ×1.3 + badges) ; e2e menu `improve-check` :
  reprise cachée sans compte, publiques verrouillées → écran connexion,
  déverrouillées connecté ; ration +6 PA OK.
- Rendus vérifiés : `render-town`/`render-map` (header 🌊, ville dominante,
  arbres > persos), `scale-scene` (héros+monstre+arbres+ville), `tower-final`
  (mesh tour à y=3 sur le plateau vs bâtiments à plat y≈1), `modal-townstatus`
  (panneau `right=vw`, `bottom=vh`, aucun débordement).

### Reste à faire
- Échelle/tailles des monstres AUSSI en combat iso (pour l'instant carte seulement).
- Vérifier le badge de danger sur des packs boss (rendu réel à venir en jeu).

## 2026-07-20 (54) — Combat : les unités s'orientent selon leur Facing (plus de billboard permanent)

### Fait (retour utilisateur : « les persos ne devraient-ils pas avoir un sens au début du combat puis tourner selon le déplacement ? »)
- **VoxelCombatView** : les modèles de perso/monstre ne font PLUS de billboard
  (ils ne fixaient plus la caméra en permanence). Ils sont orientés selon leur
  **Facing MONDE** (`fx/fy`, déjà servi depuis le lot C4) : `rotation.y =
  atan2(fx, fy)` (le modèle regarde +Z au repos). Au DÉBUT du combat les unités se
  font face (héros `fy=-1`, monstres `fy=+1`), puis pivotent au déplacement/à
  l'attaque (`enterCell`/`performAttack` mettent déjà `fx/fy` à jour côté serveur).
  Le cap étant en espace-monde, il reste correct quand la caméra tourne (on peut
  voir un dos — comportement FFTA2). Le callback `engine.onFrame` de billboard et
  le tableau `charMeshes` sont retirés (le cap est statique). La carte du monde
  garde le billboard (les unités n'y ont pas de sens de combat). Fallback sprite
  (sans modèle voxel) : toujours face caméra (un sprite 2D ne tourne pas).

### Fonctionnel (vérifié)
- E2E réel `facing-check.mjs` : héros `fy=-1` → cap π, monstre `fy=+1` → cap 0
  (ils se font face, écart π) ; après un pas vers l'est `fx=+1` → cap π/2 conservé
  malgré une rotation caméra ; captures facing-start/facing-moved. Combat C4 e2e
  non régressé ; tsc + build ; perf voxel 12/12.

## 2026-07-20 (53) — 4 améliorations : combat non bloquant, gating connexion, vue de dessus, ration +6 PA

### Fait (retours utilisateur)
1. **Un combat ne fige PLUS les autres joueurs** — les gardes globales `if
   g.ActiveCombat != ""` (move/hide/escape/search/skill/ruin) deviennent
   `g.heroInCombat(heroID) != nil` : seuls les héros ENGAGÉS sont bloqués.
   `StartCombat` autorise plusieurs combats EN PARALLÈLE (refuse juste d'engager
   un héros déjà au combat) ; `FinishCombat` ne nettoie QUE son combat
   (`delete(g.Combats, c.ID)`, ActiveCombat effacé si c'est lui). Bots : gate par
   héros. Client : `myActiveCombat(game, playerId)` scanne TOUS les combats
   actifs (bouton « Rejoindre » + marqueur ⚔ par case). Tests
   `combat_multi_test.go` (autre joueur libre pendant un combat, 2 combats
   concurrents, refus double-engagement).
2. **Menu gaté sur la connexion** — la carte « Reprendre » n'apparaît QUE si
   connecté (sinon on ignore quel joueur reprendre) ; « Parties publiques »
   verrouillée (🔒 → écran connexion) hors compte, ET refus serveur du join
   public anonyme (`join` : 401 si `IsPublic() && user == nil`). Le join par code
   (privé) reste ouvert aux anonymes.
3. **Vue de DESSUS en combat** — `engine.topDown` (élévation ~78°, azimut
   conservé) + bouton 🔼/🎥 dans VoxelCombatView : bascule un angle plongeant
   pour voir les monstres masqués par les piliers/reliefs. `setTopDown` rafraîchit
   les ombres ; n'affecte ni la carte ni l'éditeur.
4. **Ration d'eau sur la CARTE = +6 PA** — `DrinkRation(heroID)` (`RationPA=6`,
   route `POST /heroes/{h}/drink`) : consomme une Ration d'eau du SAC, restaure
   6 PA (plafonné à MaxPA), purge Fatigue/Soif ; refusé sans ration ou à PA plein ;
   ne coûte pas de PA. Boutons 💧 (menu radial + dropdown 🙂) quand ration en sac
   et PA non pleins. Test `TestDrinkRationRestoresPA`.

### Fonctionnel (vérifié)
- Suite Go verte (nouveaux tests concurrence combat + ration). E2E réel
  `improve-check.mjs` (reprise cachée/publiques verrouillées puis déverrouillées
  connecté, ration puisée au puits → bue → +6 PA & consommée, bouton 💧, bascule
  vue de dessus `engine.topDown`) ; mp-combat-check (Rejoindre) non régressé ;
  captures improve-menu/ration/combat-normal/combat-topdown ; tsc + build ; perf
  voxel 12/12.

## 2026-07-20 (52) — Compétences PAR CLASSE (carte + iso), barre de héros en combat

### Fait (retour utilisateur : « retire le fireball, ajoute les sorts/compétences par classe ; en combat réutilise la barre de sélection et ajoute les compétences iso »)
- **Compétences de CARTE par classe** (`mapskills.go`) — la boule de feu UNIVERSELLE est
  RETIRÉE (`FireballHero`/`PreciseShotHero` + routes `/fireball`/`/snipe` supprimés).
  Catalogue data `MapSkills` servi par `GET /api/mapskills` ; chaque classe a sa/ses
  compétence(s) (blast ou snipe), le héros sans classe garde « Jet de pierre ». Route
  générique `POST /heroes/{h}/skill {skillId}` → `CastMapSkill` (valide classe + PA,
  applique blast [souffle traversant, échelle par stat] ou snipe [achève ≤5 PV], loot
  pour le Récupérateur). Front : boutons dynamiques (menu radial + dropdown 🙂) filtrés
  par classe + portée (`skills.ts mapSkillsForHero`, `store.mapSkills`, `store.castSkill`).
  Les bots lancent leur 1re compétence blast. `newGame` (test rapide) charge désormais
  les catalogues.
- **Compétences ISO multiples par classe** — `heroSkillFor` (1) → `heroIsoSkillsFor`
  (liste) : pionnier/chasseur/gardien ont 2 skills, les autres 1. `combatResponse` sert
  `current.skills[{idx, skill, targets, estimates, selfCast}]` ; l'action combat porte
  `skillIdx` (`PlayerAction` variadic). Front : un bouton ✨ par compétence (CombatControls),
  `store.selectCombatSkill(idx)` (les capacités sur soi partent aussitôt, les autres arment
  le ciblage), surbrillance des bonnes cibles côté voxel.
- **Barre de héros EN COMBAT** (`components/CombatHeroBar.tsx`) — réutilise le langage
  visuel de MapHeroBar : une pastille par unité héros de MON équipe (portrait, nom, PV,
  badge ▶ tour / 🏃 fuyard / 💀). Taper recentre la caméra de combat sur l'unité
  (`EV.CombatFocusUnit`, `engine.target` — utile en arène 9×9 de boss).

### Fonctionnel (vérifié)
- Go : `mapskills_test.go` (catalogue par classe, blast dégât/kill/adjacent, snipe ≤5,
  gating de classe, loot Récupérateur, PA), tests fireball/snipe migrés vers `CastMapSkill` ;
  suite complète verte. E2E réel `skills-check.mjs` (catalogue chargé, fireball retiré,
  bouton de compétence de carte dans le menu, cast qui abîme le pack ; en combat :
  `current.skills` servi, boutons iso rendus, barre de héros de combat, compétence iso
  jouée) ; captures skills-map-menu / skills-combat / skills-multi (chasseur 2 boutons) ;
  tsc + build ; perf voxel 12/12.

## 2026-07-20 (51) — UI : barre de sélection des héros sur la carte (sortir de ville / déplacer)

### Fait (retour utilisateur : « sur la map je dois facilement sélectionner qui sort de la ville et qui je déplace »)
- **`components/MapHeroBar.tsx`** : barre posée en bas de la carte (vue Map), une
  pastille par héros de MON équipe — portrait de classe, nom, barre de PV colorée
  (vert/jaune/rouge), PA, et un **badge de lieu** (🏰 en ville, 🔒 Tétanisé, 💀 mort).
  Taper une pastille **sélectionne le héros actif** (celui que les losanges jaunes
  déplacent) ET **recentre la caméra** dessus ; bouton ⓘ = fiche du personnage.
- **`store.focusHero(id)`** : sélection + `bus.emit(EV.MapFocusHero)` (nouveau) —
  distinct de `selectHero` exprès (un tap MAP sélectionne un héros déjà à l'écran,
  recentrer serait sautillant). Handler `MapFocusHero` dans **VoxelMapView**
  (`engine.target` glisse sur la case) ET **MapScene** Phaser (même math que
  `fitCamera`).
- **Hint contextuel** sous la barre : héros en ville → « tape une case adjacente
  pour le faire sortir » ; Tétanisé → alerte ; sinon → « tape les losanges jaunes ».
  L'ancien hint générique de `MapControls` (« Héros et actions via 🙂 ») est retiré
  (redondant). Le bas de carte est empilé proprement (`.map-bottom` : barre +
  contrôles map-wide).
- Le flux « sortir de la ville » devient trivial : les héros en ville sont masqués
  sur la carte (dans les murs) mais chacun a SA pastille ; sélectionner puis taper
  une case adjacente le fait sortir (règles de porte inchangées). Le dropdown 🙂 du
  TopBar reste pour les fiches/actions détaillées.

### Fonctionnel (vérifié)
- E2E réel `herobar-check.mjs` : 1 pastille/héros, sélection surlignée, badges 🏰,
  hint ville→sortir puis terrain→déplacer, recentrage caméra sur la case du héros ;
  captures herobar-town / herobar-field ; tsc + build ; perf voxel 12/12.

## 2026-07-20 (50) — BOSS révisé : plus d'annonce, il attaque chaque tour (base ou spéciale)

### Fait (retour utilisateur : « les attaques prévues à l'avance, c'est trop simple »)
- **L'annonce des patterns un tour à l'avance est RETIRÉE** (le tour d'annonce était
  un tour GRATUIT pour les joueurs et la zone s'esquivait à l'infini) : `bossTurn`
  attaque désormais À CHAQUE TOUR — ~40 % sa spéciale offensive (immédiate, zone GDD
  appliquée autour de la cible : Piétinement du Croc, Racines Sinistres…), sinon son
  attaque de base. `Combat.Telegraph`/`CombatTelegraph` supprimés (serveur + types +
  rendu des cases annoncées + bannière).
- La LECTURE du danger reste possible via la télégraphie C2 (taper le boss → cases
  menacées en orange) — `ThreatCells` corrigé pour évaluer depuis CHAQUE case de
  l'empreinte 2×2 (l'ancre seule sous-estimait sa portée).
- Harnais c4-check : le héros AVANCE vers l'ennemi (les espèces à portée ne viennent
  plus au contact depuis la C4 — le harnais qui ne bougeait pas n'avait jamais de
  cible en mêlée).

### Fonctionnel (vérifié)
- `TestBossAttacksEveryTurnBaseOrSpecial` (au contact, le boss frappe à CHAQUE tour
  et mélange base/spéciale sur 60 tours) remplace le test d'annonce ; suite Go
  verte ; e2e combat réel vert ; tsc + build.

## 2026-07-20 (49) — COMBAT C5 : boss 2×2, patterns télégraphiés, IA de meute, renforts — COMBAT-PLAN ✅ COMPLET

### Fait (lot C5, dernier du COMBAT-PLAN)
- **Boss 2×2 en 9×9** : espèce `Boss` du design (Roi Gobelin, Arbre Vivant Ancien) →
  arène 9×9, UNE unité `Size=2` (ancre coin haut-gauche, empreinte aplanie au spawn).
  Fondations multi-cases : `span/occupies/footprint/distTo`, `unitAt`/`passable`
  (empreinte complète), `canTarget` évalué entre CHAQUE case attaquant × cible (le
  boss frappe depuis toute son empreinte, on l'atteint par n'importe quelle case),
  zone de dégâts dédupliquée (`hitOnce`), pas de dos ni de poussée sur un boss,
  insensible glace/ronces, lent (Move 2).
- **Patterns télégraphiés** : `Combat.Telegraph {unitId, attack, cells}` — le boss
  ANNONCE sa spéciale de zone (~50 %) centrée sur sa cible, la frappe à son tour
  SUIVANT sur les cases ANNONCÉES (quiconque y reste prend le coup, esquive = zéro
  dégât). Client : cases orange vif + ⚠ + bannière « X prépare Y — évacue ! ».
- **IA de meute** (tous les monstres) : focus-fire (`packTarget` : l'ennemi le plus
  BLESSÉ, le plus proche à égalité), retraite d'un pas sous 25 % PV (`stepAway`),
  le BUFFEUR (Hurlement de Meute) reste en retrait tant qu'un allié est plus avancé.
- **Renforts vague 4+** : `ReinforceAt=3` (pack >1, hors boss) — annoncés au round 2
  (log + bannière), 1-2 créatures surgissent par le bord nord au round 3
  (`roundTick` dans advanceTurn, unités ajoutées à l'ordre du tour).
- **Client** : boss rendu au centre de l'empreinte (modèle/anneaux/barre de PV ×2),
  cases télégraphiées, bannières boss + renforts.

### Fonctionnel (vérifié)
- `combat_c5_test.go` (arène/empreinte, mêlée depuis toute case de l'empreinte +
  poussée refusée, annonce→frappe sur cases marquées ET esquive indemne, focus-fire
  sur le blessé, retraite, renforts annoncés puis arrivés vague 5 / absents tôt) ;
  suite Go verte ; e2e réel de non-régression (combat normal C4) ; capture c5-boss
  (injection synthétique) ; tsc + build ; perf voxel 12/12.

### Le COMBAT-PLAN (C1-C5) est ✅ INTÉGRALEMENT LIVRÉ, plus le combat multijoueur.
Prolongements possibles : boss en vraie partie longue (vague 4+ organique), FX
d'impact (flash/recul), notification quand son tour arrive en multi.

## 2026-07-20 (48) — COMBAT C4 : ligne de vue, couverture, hauteur formalisée, attaque de dos

### Fait (lot C4 du COMBAT-PLAN)
- **Ligne de vue** : `hasLOS` (Bresenham, extrémités exclues) — un obstacle C1 sur le
  trajet coupe les attaques à distance (>1). `canTarget` centralise case verte + LOS
  et est utilisé PARTOUT : ciblage servi (`TargetsFor`), validation des actions
  joueur, IA monstre ET héros auto (qui continuent d'AVANCER tant que le tir est
  bloqué, au lieu de s'arrêter à portée).
- **Hauteur formalisée** : +1 dégât par niveau d'avantage (max +3), −1 en
  contre-plongée — remplace l'ancien « +1 si plus haut », dans `dmgMods` PARTAGÉ par
  `damageWith` et `EstimateDamage` (la fourchette C2 reste exacte).
- **Attaque de dos** : `CombatUnit.FX/FY` (Facing) mis à jour au déplacement
  (`enterCell`) et à l'attaque ; attaquant dans l'arc arrière (produit scalaire < 0)
  = **+25 %** et ignore la couverture. `stepToward` préfère à distance égale la case
  dans le dos de la cible (contournement IA).
- **Couverture** : cible orth-adjacente à un obstacle CÔTÉ attaquant = **−25 %** sur
  les attaques à distance (annulée par le dos). Télégraphie servie dans les
  fourchettes (`rear`/`cover`) → icônes 🗡/🛡 sur les boutons cibles.
- **Client** : flèches d'orientation (triangle au bord de la case, teinte
  héros/monstre) dans l'arène voxel ; icônes + tooltips sur les cibles.

### Fonctionnel (vérifié)
- `combat_c4_test.go` (LOS bloquée/dégagée + refus serveur, mêlée exemptée,
  contre-plongée −1, plafond +3, dos +25 % encadré par la fourchette sur 50 tirages,
  Facing mis à jour move/attaque, couverture −25 % hors trajectoire + ignorée de
  dos + mêlée exempte) ; suite Go verte ; e2e réel (fx/fy servis, fourchette C4
  respectée par le coup réel) ; capture c4-facing ; tsc + build ; perf 12/12.

### Reste : C5 boss & IA (arène 9×9, boss 2×2, patterns télégraphiés, renforts).

## 2026-07-20 (47) — COMBAT MULTIJOUEUR : équipes, IA des absents, « Rejoindre le combat »

### Fait (directive /loop du 2026-07-20)
- **Serveur** : `CombatUnit.OwnerID` (joueur propriétaire, posé par `NewCombat` via
  `OwnerOfHero`) + `Combat.Participants` (joueurs PRÉSENTS ; l'initiateur passé par
  `StartCombat(heroID, starterID)`). `advanceUntilHeroOrEnd` ne s'arrête que sur les
  unités d'un participant : **les héros des joueurs absents (autre joueur pas encore
  entré, bots) sont joués par l'IA** (`heroAutoAct`, refactor de heroAutoTurn sans le
  endTurn — sinon récursion). `JoinCombat(combatID, playerID)` (+ route
  `POST /combat/{c}/join`) : valide joueur + héros vivant dans le combat, idempotent,
  et agir dans le combat (re)inscrit défensivement comme participant. Spawn héros :
  rangée du bas remplie du CENTRE vers les bords (`spawnX`), plafonnée à 7 — plusieurs
  équipes tiennent dans l'arène. Parties legacy sans joueurs : tout reste manuel.
- **Client** : bouton **« ⚔️ Rejoindre le combat (x,y) — tes héros y sont ! »** dans la
  barre Map quand un combat actif contient MES héros et que je n'y suis pas ;
  **marqueur ⚔ rouge sur la case** du combat (carte voxel) ; en combat, **je ne pilote
  que MES unités** (« ⏳ Tour de X (autre joueur)… » sinon) ; **poll 3 s du combat**
  (`refreshCombat`, n'applique que les vrais changements seq/statut/tour, désamorcé en
  solo) pour voir les tours adverses et son propre tour arriver.

### Fonctionnel (vérifié)
- `combat_multi_test.go` (IA des absents — le tour n'est JAMAIS rendu à l'unité de
  l'absent et son héros AGIT au log ; join → ses tours se mettent en pause ;
  validations ; spawns sans doublon ni hors-grille) + suite Go verte ; **e2e à DEUX
  navigateurs** (lobby par code, marche coordonnée vers le même pack, engage par A,
  ownerId/participants vérifiés, IA joue Bob, bouton Rejoindre chez B, B participant,
  tour de Bob rendu à B qui agit) ; captures mp-join-button/mp-bob-turn ; tsc + build ;
  perf voxel 12/12.

### Reste : C4 couverture/visée/dos, C5 boss & IA (COMBAT-PLAN). Multi : pas de
notification push quand son tour arrive (le poll 3 s suffit en séance).

## 2026-07-20 (46) — COMBAT C3 : actions tactiques (Defend, Poussée, objets, fuite)

### Fait (lot C3 du COMBAT-PLAN — /loop « implémente tout »)
- **Serveur** : `defend` (Bouclier -50 % jusqu'au prochain tour, termine le tour) ;
  `push` (0 dégât, déplace d'1 case dans l'axe : collision bord/obstacle/mur ≥2/unité
  = 2 dégâts [aux DEUX si télescopage], poussée dans l'eau = Root « piégé un tour »,
  chute ≥2 niveaux = +2, glace/ronces s'appliquent via enterCell ; portée 1, **2 pour
  le Pionnier — « Poussée du Survivant »** ; `PushTargets` servi) ; `item` (=
  `UseItem(gs,…)` : consomme du SAC — `combatConsumables` : Potion de soin +5, Baume
  de gelée +3, Ration d'eau +2, Baies +2 — soigne l'unité, termine le tour) ; `flee`
  (bord bas uniquement, `CombatUnit.Fled`, plus jamais le tour [`inBattle`], dernier
  vivant → statut **"fled"** : `FinishCombat` SANS butin, héros restent sur la case,
  **pack conservé avec ses pertes** [Count − tués, PV de tête persistés]).
- **Client** : boutons 🛡️ Défendre / 👐 Pousser (mode ciblage, anneaux cyan) /
  🧪 objets servis par `current.items` / 🏃 Fuir (bord bas) ; écran de fin « 🏃 Repli ! ».

### Fonctionnel (vérifié)
- `combat_c3_test.go` (mécaniques de poussée pures + validations, item, fuite,
  fuyard sauté dans l'ordre du tour) ; e2e réel (defend loggé, poussée jouée,
  fuite → fled + écran + pack conservé) ; captures c3-push/c3-flee ; tsc + build ;
  perf 12/12.

## 2026-07-20 (45) — COMBAT C2 : lisibilité & juice (+ fuite GPU des redraws corrigée)

### Fait (lot C2 du COMBAT-PLAN — /loop « implémente tout »)
- **Serveur** : `Combat.Seq` (s'incrémente à chaque action) + `Combat.LastHits
  []CombatHit {unitId, amount, kind: dmg|heal|hazard}` remplis par `performAttack`
  (dégâts + soin Absorbe) et les ronces d'`enterCell` — reset à chaque `PlayerAction`,
  plafonné à 64 (combats auto-résolus des bots). `Combat.Rewards []CombatReward`
  consigné par `FinishCombat` à la victoire (butin par héros). `EstimateDamage`
  (miroir SANS aléa de `damageWith`, Bouclier/hauteur inclus) et `ThreatCells`
  (union grilles de ciblage + zones de dégâts, clippée à l'arène). `combatResponse`
  sert `attackEstimates`/`skillEstimates` ({min,max} par cible) + `threats`
  (cases menacées par ennemi vivant) — le client ne calcule RIEN.
- **Client** : **timeline d'initiative** (`InitiativeBar`, portraits dans l'ordre du
  tour, actif surligné, morts grisés — taper un ennemi bascule sa télégraphie) ;
  **dégâts flottants** (« −7 » monte et s'estompe ~900 ms, décalés si coups
  multiples, groupe `fx` séparé des redraws) ; **fourchette de dégâts** sur les
  boutons cibles (« −4…6 ») ; **télégraphie orange** (quads sur les cases menacées
  de l'ennemi sélectionné + anneau orange) ; **écran de fin** (`CombatEndScreen` :
  victoire/défaite, tours joués, PV par héros, butin par héros en chips).
- **Fuite GPU corrigée (pré-existante)** : chaque redraw de la carte (poll 20 s)
  fuyait ~11 géométries + matériaux (`quad`/`ring` recréés, `.clear()` sans
  dispose) → `clearOwned()` dans engine.ts (libère géométrie/matériau marqués
  `userData.ownGeom/ownMat`, jamais les ressources partagées), géométries
  STATIQUES partagées (QUAD/RING/EDGE), cache de textures héros de la vue ville.
  Drift mesuré : 29→90 sur 72 s AVANT, plat à 50 APRÈS. Le check perf re-baseline
  après les chargements asynchrones et force 5 redraws.

### Fonctionnel (vérifié)
- `combat_juice_test.go` (Seq/LastHits, fourchette encadrant 50 tirages réels ±
  Bouclier, +1 hauteur, ThreatCells, Rewards) + suite Go verte ; e2e réel 12/12
  (fourchette affichée ET respectée par le coup réel, timeline DOM, télégraphie au
  tap, seq/lastHits, écran de fin) ; captures c2-threat/c2-floating/c2-victory ;
  `tsc` + build ; perf voxel 12/12 (dont le nouveau check anti-fuite).

### Reste (COMBAT-PLAN) : C3 actions (Defend, Poussée, objets, fuite), C4
couverture/visée/dos, C5 boss & IA. FX d'impact (flash/recul mesh) non retenus
pour l'instant — les dégâts flottants + tint portent la lisibilité.

## 2026-07-19 (44) — COMBAT C1 : l'arène par biome (obstacles, eau, glace, ronces)

### Fait (lot C1 du COMBAT-PLAN — /loop « implémente tout »)
- **Serveur** : `CombatCell {height, blocked, hazard}` + `Combat.Biome/Cells` (Heights
  reste le miroir des hauteurs pour la CombatScene classique). `buildArena(biome)` :
  prairie douce, forêt vallonnée (+4 arbres), montagne en terrasses diagonales 0..3,
  sable plat + langues d'eau en bord, neige + 4-6 plaques de glace ; ronces ×2 en
  prairie/forêt ; obstacles jamais adjacents entre eux ; rangées de spawn toujours
  dégagées. `passable` refuse bloqué + eau (Reachable suit). **`enterCell` partagé
  joueur/IA** : la glace prolonge le pas dans la direction du déplacement (chaîne
  bornée à 3), les ronces piquent (−1 PV, ne tuent jamais).
- **Assets** : bloc `ice` (32³ + LOD 16³), prop `brambles` ×3.
- **Client** (`VoxelCombatView`) : sol du biome, colonnes d'eau, plaques de glace,
  obstacles en props (arbre/rocher/pic selon biome) + ronces posés sur les cases.

### Fonctionnel (vérifié)
- `combat_arena_test.go` + suite Go verte ; e2e combat réel (reachable sans obstacles,
  clic projeté, rotation) ; captures des 5 arènes ; `tsc` + build + perf 12/12.

### Reste (COMBAT-PLAN) : C2 lisibilité, C3 actions, C4 couverture/visée, C5 boss & IA.

## 2026-07-19 (43) — PLAN d'amélioration du combat isométrique (COMBAT-PLAN.md)

### Fait
- État des lieux : arène 7×7 aléatoire quasi plate SANS lien avec le biome, pas
  d'obstacles ; actions move/attaque/skill/end ; IA simple ; bonus hauteur implicite.
- **`COMBAT-PLAN.md`** : 5 lots — **C1** arène PAR BIOME (sol/hauteurs thématiques,
  obstacles bloquants, eau/glace/ronces, `Combat.Cells`), **C2** lisibilité & juice
  (timeline d'initiative, dégâts flottants, fourchette prévisualisée, télégraphie,
  écran de victoire), **C3** actions tactiques (Defend générique — pending §9.3 —,
  Poussée avec collisions/chutes, objets en combat, fuite), **C4** couverture/ligne de
  vue/hauteur formalisée/attaque de dos, **C5** boss 2×2 en 9×9 à patterns télégraphiés
  + IA de meute + renforts. Chaque lot mergeable seul, tests Go + e2e voxel.

### À faire
- Attendre le GO de Guillaume sur l'ordre (C1+C2 conseillés en premier) puis implémenter.

## 2026-07-19 (42) — BROUILLARD abaissé aux 3/4 : nappe basse sur le niveau 1

### Fait (demande : « réduire la hauteur du brouillard de 3/4, 1/4 de hauteur sur le niveau 1 »)
- Le mur de brume à 2 blocs (sommet y=2) devient une **NAPPE de 0.5 unité posée sur le
  niveau 1** (sommet 1.5) : `TerrainCell` gagne `baseY`/`scaleY` (buildTerrain compose
  échelle + décalage par instance), la carte pose `{block:"mist", levels:1, baseY:1,
  scaleY:0.5}` — `mistbase` n'est plus chargé par la carte. `topOf`/`levelsOf` non
  découvert : 2 → **1.5** (losanges/overlays suivent). Banc aligné.
- La jupe du monde sous la nappe (zones non découvertes) passe en **lavande** au lieu du
  gris falaise — le socle gris jurait au bord du monde maintenant que le mur ne le cache
  plus (`smoothTerrain.wall`, override si `!discovered`).

### Fonctionnel (vérifié)
- Captures : l'île émerge nettement d'une mer de brume basse, socle lavande cohérent ;
  déplacement OK (losanges cliquables sur la nappe) ; suite perf **12/12** — tris vraie
  partie 1,39 M → **1,06 M** (le mur en dôme pesait), payload 1,88 → 1,84 MiB.

## 2026-07-19 (41) — Nuages RETIRÉS de la carte (lag mobile) — ville seulement

### Fait (retour : « pas besoin des nuages sur la map, ça lag trop »)
- La carte (scène LOURDE, ~1,4 M tris) repasse en rendu 100 % ON-DEMAND : nuages,
  boucle rAF continue et `groundAt` retirés de `VoxelMapView`. Les nuages (et leur
  boucle) ne vivent plus que sur la vue VILLE (~430 k tris, fluide).
- Suite `test:perf:voxel` recalée sur le nouveau contrat : « carte on-demand (pas de
  boucle continue) » (1 rendu/3 s au repos ✓), « pas de nuages sur la carte » ✓,
  « nuages de la ville en mouvement » 5/5 ✓ — 12/12.

## 2026-07-19 (40) — FIX : ombre des nuages décalée + lag au pan de la ville

### Fait (retours : « l'ombre est trop décalée », « la carte de la ville lag un peu »)
- Les deux avaient la même racine : les nuages passaient par la VRAIE passe d'ombres —
  (1) l'ombre solaire atterrit à altitude/tan(élévation) du nuage (10-20 unités de
  décalage), (2) la boucle continue re-rendait la shadow map 2048² À CHAQUE FRAME
  (toute la scène re-dessinée deux fois, 60×/s) → lag au pan de la ville.
- **Ombres FACTICES** (`clouds.ts`) : tache radiale douce (CanvasTexture 64², plan
  transparent) posée PILE sous chaque nuage, à la hauteur du sol (`groundAt` fourni par
  la vue : surface lissée sur les tuiles connues, sommet du mur de brume sinon ; niveau
  de la place en ville). `castShadow=false` sur les nuages.
- **Shadow map FIGÉE** (`engine.ts`) : `shadowMap.autoUpdate=false` — re-rendue seulement
  quand la CLÉ change (cible/cycle solaire, détectée au rendu) ou sur `refreshShadows()`
  appelé par les vues à leurs rebuilds (draw() carte ; terrain/bâtiments/héros ville).

### Mesuré (suite test:perf:voxel, 11/11 ✓)
- Draw calls vraie partie **131 → 65** (la passe d'ombres sort des frames au repos) ;
  vue ville **865 k → 430 k tris/frame** ; carte 1,18 M tris ; cadence GL logiciel
  3,3 → 4,0 rendus/s. Taches d'ombre sous les nuages vérifiées en capture (sol + brume).

## 2026-07-19 (39) — SUITE DE PERF VOXEL + fix de la suite Phaser

### Fait (demande : « teste les performances »)
- La suite historique `test:perf` ÉCHOUAIT (timeout « pillar atlas ») : elle attendait la
  MapScene Phaser alors que le voxel est le rendu par défaut → elle force maintenant
  `voxelMap:false` (elle teste le chemin Classique) — **13/13 ✓**.
- **Nouvelle suite `test:perf:voxel`** (tests/perf/voxel-perf.mjs) — bornes STRUCTURELLES
  (device-indépendantes), 11 checks : carte prête, tris vraie partie ≤6M, draw calls ≤160,
  payload /voxels ≤4 MiB, zéro doublon de téléchargement, boucle nuages active + nuages en
  mouvement, géométries stables (pas de fuite), **rendu STOPPÉ hors de l'onglet Map**
  (batterie), vue ville ≤2M tris + bâtiments présents — **11/11 ✓**.

### Mesures (2026-07-19)
- Vraie partie (fog départ) : **1,39 M tris · 131 draw calls · prête en ~1 s** ;
  payload voxel **1,88 MiB / 98 fichiers** (vs ~8,5 Mo de PNG du vieux chemin Phaser) ;
  vue ville **0,87 M tris** ; banc pire-cas plein monde **16,1 M tris** (ombres ×2
  comprises). Boucle continue : 3,3 rendus/s en GL LOGICIEL (CPU) — device-bound,
  ~60 fps attendus sur GPU réel ; 0 rendu hors onglet.

## 2026-07-19 (38) — FIX : scintillements noirs du brouillard de guerre

### Fait (bug signalé : « le fog of war a des soucis de scintillements/noir »)
- Cause principale : le MUR DE BRUME **projetait des ombres** (buildTerrain mettait
  `castShadow=true` sur tous les meshes, brume comprise) → bandes PCF sombres le long de
  la frontière du fog, qui rampaient/scintillaient au pan (shadow map 1024 trop juste,
  pire à DPR 3 mobile). La vapeur ne fait pas d'ombre : `castShadow/receiveShadow=false`
  pour les meshes `mist*`.
- Shadow map **1024 → 2048** (fourmillement PCF réduit sur téléphone) ; quads d'overlay
  (losanges/danger/socle) relevés de +0.02 → +0.045 au-dessus de la face de brume
  (z-fight potentiel à DPR élevé).

### Fonctionnel (vérifié)
- Frontière brume/terrain nette en capture ; e2e move/rotation OK ; `tsc` + build verts.
- Si un scintillement persiste sur appareil réel : demander une capture (les artefacts
  device-specific ne se reproduisent pas en GL logiciel).

## 2026-07-19 (37) — NUAGES dérivants au-dessus de la carte et de la ville

### Fait
- **Prop `cloud`** (3 variantes) : amas de bulles aplaties, ventre PLAT teinté lavande,
  solide self-lit (le diorama assume), **castShadow** — leurs ombres glissent sur le
  terrain sous le soleil.
- **`clouds.ts`** (module partagé carte/ville) : champ de nuages dérivants, **anti-pattern
  par construction** — vitesse/altitude/taille/miroir/cap (vent ±9°) propres à chaque
  nuage, et surtout **re-tirage du couloir, de l'altitude et de la silhouette à CHAQUE
  tour de piste** (hachés par numéro de tour) : un nuage qui boucle ne repasse jamais au
  même endroit avec la même tête. Entrées/sorties aux marges du span.
- **Animation CONTINUE** (rAF) : la carte anime quand l'onglet Map est actif
  (`activeRef`) et la page visible ; la ville quand le Home est monté. Le rendu
  redevient on-demand dès qu'on quitte — c'est la première boucle continue du moteur
  (eau/lucioles en profitent au passage).
- Carte : 9 nuages, alt 7.5-10.5, vitesse 0.25-0.55 u/s, seed par partie ; ville :
  5 nuages plus hauts/gros.

### Fonctionnel (vérifié)
- Simulation node : 8 combos altitude/échelle distincts sur 1200 s (re-tirage par tour ✓),
  vitesses toutes différentes ✓ ; e2e : 9/9 nuages déplacés en 3 s, visibles carte
  dézoomée + ville ; move/rotation OK ; `tsc` + build verts.

## 2026-07-19 (36) — BÂTIMENTS DE LA VILLE EN VOXEL, dégradés par leur durabilité

### Fait (demande : bâtiments voxel qui évoluent avec la durabilité, jusqu'à la destruction)
- **9 recettes** dans `gen-props.mjs` (`bld-well/panel/bank/workshop/gate/tower/townhall/
  kitchen/wall`) + **`bld-chantier`** (échafaudage : poteaux, plateforme, grue à corde et
  crochet doré). Style temple : pierre crème, colombages, chaume/terracotta, accents or.
- **3 ÉTATS PAR DURABILITÉ** = les 3 variantes .vox : v0 intact, v1 abîmé (ratio 0.35),
  v2 en ruine (0.68) — **passe de dégâts procédurale partagée** (`damagePass`) : morsures
  sphériques dont 70 % visent le HAUT (le toit part d'abord), pourtours carbonisés,
  gravats au pied. Le même bâtiment s'effondre progressivement.
- **`VoxelTownView`** : les 7 billboards mappés → **meshes voxel dans un groupe DYNAMIQUE**
  reconstruit à chaque changement d'état : variante par `durability/maxDurability`
  (≥66 % intact, ≥33 % abîmé, sinon ruine), `bld-chantier` si `underConstruction`,
  **site sans plan = herbe nue** (avant, le billboard du site s'affichait toujours).
  Hotspots raycast + pastilles inchangés (mêmes refs, mesh → buildingId).
- ⚠ **Matériau SELF-LIT** (`MeshBasicMaterial`) : l'ombrage des faces est déjà CUIT par
  le mesher — sous le Lambert les façades cumulaient deux ombrages et viraient au gris
  (même leçon que la brume) ; échelle ×2.3 (modèle normalisé sur sa grille de 20 mais le
  bâtiment n'en occupe que ~14) ; rotation π (façades vers la caméra par défaut).

### Fonctionnel (vérifié)
- Rendus logiciels des 10 modèles + états v0/v1/v2 (beffroi troué puis effondré) ;
  e2e Home : 6 pastilles correctes (tour 🏗️ en chantier, townhall masqué = site sans
  plan), banque/puits abîmés visibles après écrasement local de la durabilité, barres
  orange/rouge, **tap sur le mesh → modal Bank** ; `tsc` + build verts.
- Restent : le mur/kitchen n'ont pas d'emplacement sur la carte de ville (comme avant) ;
  animer la transition d'état (poussière) un jour.

## 2026-07-19 (35) — EXPLORATION AU CONTACT : le fog ne se lève qu'en marchant dessus

### Fait (demande : seule l'Éclaireur voit à l'avance)
- **`fog.go`** : `heroSightRadius` 2 → **0** (un héros ne révèle que SA case) ;
  l'**Éclaireur** garde son passif = `eclaireurSightRadius` **1** (une case d'avance).
  L'anneau de la ville (r=3) est inchangé.
- **Sonde d'eau cachée** (`MoveHero`) : marcher vers une case NON DÉCOUVERTE qui s'avère
  être de l'eau → le héros **paie 1 PA, la case est révélée, mais il n'est PAS déplacé**
  (il rebrousse chemin) ; la cachette est brisée, Fatigue à 0 PA. Une fois l'eau CONNUE,
  le refus redevient gratuit (et le client masque le losange). Les BOTS ne sondent jamais
  (ils lisent l'état complet et vérifient `Walkable` avant de bouger).
- **Front** : les losanges de déplacement couvraient déjà les cases de brume (ils
  n'excluent que l'« eau connue ») ; ajout du log « 🌊 X découvre de l'eau — rebrousse
  chemin (-1 PA) » (détection : PA dépensé + position inchangée après un move).

### Fonctionnel (vérifié)
- Go : `TestContactExplorationVision` (héros normal = sa case seule, Éclaireur = rayon 1),
  `TestMoveIntoHiddenWaterRevealsWithoutMoving` (PA, révélation, pas de déplacement,
  cachette brisée, refus gratuit ensuite) + suite complète verte.
- E2E HTTP réel : 5 pas — 0 nouvelle case dans l'anneau de départ, puis exactement +1
  case par pas ; move/rotation OK ; `tsc` + build verts.

## 2026-07-19 (34) — RUINES-DONJONS : déblayer en PA, puis fouiller le butin rare

### Fait (gameplay demandé : ruines par biome → PA pour déblayer → donjon à items rares)
- **Serveur** (`ruins.go`) : `Ruin {type, name, icon, x, y, clearPa, paInvested, cleared,
  charges}` dans `GameState.Ruins` + `Tile.RuinID`. **5 types par biome** : Épave ensablée
  (sable, 8 PA), Ferme abandonnée (prairie, 8), Sanctuaire englouti (forêt, 10), Mine
  effondrée (montagne, 12), Tour gelée (neige, 12). Semées au worldgen (`SeedRuins`,
  déterministe par seed, 1/biome présent, Chebyshev ≥ 3 de la ville, idempotent).
- **Déblayage COLLECTIF** (`ClearRuin`) : comme les chantiers — chaque héros sur la case
  investit ses PA (bornés au restant), cumul partagé entre joueurs ; refusé si Tétanisé/
  combat. **Exploration** (`ExploreRuin`) : donjon déblayé, 2 PA, 4 charges puis « épuisé » ;
  tirage pondéré PAR TYPE : matériaux rares (Acier, **Cœur de chêne ancien** au sanctuaire !),
  items rares (Perle nacrée, Grimoire gelé, Relique…), **plans anciens** (phare/moulin/autel/
  forge/observatoire) ; Récupérateur +1. Routes `POST /heroes/{h}/ruin/clear|explore`
  (ownership multi ✓). **Fog** : ruines caviardées comme les monstres (ClientView).
- **Front** : `Ruin` + `game.ruins` + `tile.ruinId`, actions store `ruinClear` (tous les PA
  du héros) / `ruinExplore` + logs, **menu radial** : « ⛏️ Déblayer <icône> x/y » sur site
  enseveli, « 🏛️ Explorer -2 · n 💎 » sur donjon ouvert (désactivé si épuisé/Tétanisé).
- **Voxel** : 5 recettes `site-*` à DEUX ÉTATS — v0 enseveli (gravats devant l'entrée),
  v1 déblayé (bouche sombre + lueur dorée du trésor) — la carte choisit la variante selon
  `ruin.cleared` (pas au hasard) ; socle doré discret sur la case (plus vif si trésors
  restants).

### Fonctionnel (vérifié)
- Go : `ruins_test.go` (semis déterministe/idempotent, chantier collectif borné, loot/
  charges/épuisement, fog, Tétanisé) + suite complète verte. E2E HTTP réel : marche vers
  une ruine, investissement 2/8 PA, refus corrects (0 PA, non déblayée). UI : harnais
  synthétique — 5 sites rendus avec socles, menus radiaux exacts. `tsc` + build verts.
- ⚠ e2e : un VIEUX backend tenait le port 8080 (le `curl || start` ne le remplace pas) —
  tuer le PID via `fuser 8080/tcp` avant de tester du code serveur neuf.

### Reste (idées)
- Bots : ignorer/participer aux chantiers de déblayage ; MapScene Phaser (classique) ne
  rend pas les sites ; effets gameplay des « plans anciens » (débloquer des recettes ?).

## 2026-07-19 (33b) — Temple v3 : l'esplanade fait le TOUR

### Fait
- Grille 30×30×24 : **dallage damier sur les 4 côtés** (bordure sombre au pourtour,
  allée claire du bord avant aux degrés), **colonnes votives dorées aux 4 coins**,
  temple centré (crépis 5..24 × 7..22). Échelle carte 1.35 → **1.6** (grille plus
  large, temple à taille égale, l'esplanade s'étale autour).

### Fonctionnel (vérifié)
- Harnais monde plat : esplanade carrée complète + 4 votives + couronne d'oliviers ;
  e2e réel move/rotation OK ; `tsc` + build verts.

## 2026-07-19 (33) — Temple v2 : proportions, PARVIS et couronne d'OLIVIERS

### Fait
- **Proportions élancées** : grille 26×26×24, colonnes 8 unités (fûts r 0.95),
  entablement aminci, pente de toit adoucie (0.75).
- **Parvis dallé** côté entrée : damier de dalles chaudes, allée centrale claire vers les
  degrés, bordure sombre, **2 colonnes votives à flamme dorée** — la porte de la cella
  fait face au parvis, et le mesh est tourné (`rotation.y = π`) pour que l'entrée regarde
  la caméra par défaut.
- **Olivier** (`olive`, 3 variantes) : tronc noueux en segments décalés, feuillage
  vert-de-gris en boules aplaties. **Couronne de 6 oliviers** autour de la ville
  (positions/rotations/échelles hachées sur `game.id`, posés sur la surface, jamais sur
  l'eau connue).
- **Enceinte dégagée** : le scatter saute maintenant la case ville ET ses 8 voisines
  (plus d'arbre de prairie collé au temple — le parvis et les oliviers occupent la place).
- Émissive du temple relevée (0x4a453e) : façade à l'ombre lisible.

### Fonctionnel (vérifié)
- Harnais monde plat : parvis + votives face caméra, 6 oliviers en couronne, enceinte
  propre ; e2e partie réelle move/rotation OK ; `tsc` + build verts.
- ⚠ harnais : le comptage juste après `bus.emit(MapRender)` précède le re-draw
  post-chargement de propsLib — compter/capturer APRÈS le wait.

## 2026-07-19 (32) — La VILLE en voxel : temple grec 3D sur la carte

### Fait
- Recette `temple` dans `gen-props.mjs` (grille 26×18×22 ×1.5 fin) : crépis à 3 degrés,
  **colonnade périptère** (6 colonnes en façades avant/arrière + 1 par flanc — fûts RONDS
  évalués par voxel fin via `cyl`), cella à porte sombre, entablement à triglyphes, comble
  en prisme à pentes étagées (arête le long de X) dont les pignons dessinent les
  **frontons**, toit terracotta, **acrotères dorés**. Symétrique dans sa grille → le
  mesher l'ancre au CENTRE : posé pile sur la case ville.
- `VoxelMapView` : le billboard `bld-church` est remplacé par un **Mesh 3D** (scale 1.35,
  ombres) — fallback billboard si la géométrie n'est pas chargée. ⚠ le temple est fait de
  FACES VERTICALES : ombrage cuit du mesher + Lambert = double peine (il rendait gris
  boueux) → matériau dédié `TEMPLE_MAT` avec petite émissive chaude (0x3c3833).

### Fonctionnel (vérifié)
- Harnais déterministe (monde plat injecté par le bus, plein jour) : temple crème/terracotta
  net, centré sur sa case, socle dessous ; preview `asset-index/voxels/props/temple.png` ;
  e2e partie réelle move/rotation OK ; `tsc` + build verts.

## 2026-07-19 (31) — COULEURS ravivées partout (retour « pas assez coloré comme les images iso »)

### Fait
- **Diagnostic en deux moitiés** : (1) les palettes voxel étaient plus laiteuses que les
  isotiles peintes — mesuré en échantillonnant la face du dessus des PNG (herbe RÉELLE
  167,195,80 vs palette 150,200,118) ; (2) surtout, **l'éclairage SUREXPOSAIT** : hemi 1.2 +
  soleil 1.7 → jusqu'à ×2,6 sur les faces du dessus, tout canal d'albedo > 0,39 clampait à
  blanc = délavage général quelles que soient les palettes.
- **Exposition recalée** (`engine.ts`) : hemi 0.75 / soleil 1.05 (mêmes rapports → même
  modelé), rampes du cycle ré-étagées (aube 0.85+0.7, zénith ~1.6 avec léger bloom sur les
  seuls très clairs, crépuscule 0.6+0.58 mauve). Vérifié aux trois moments du cycle.
- **Terrain** (`smoothTerrain.DIORAMA`) recalé sur les teintes MESURÉES des isotiles :
  herbe chartreuse 160,199,82, sol forêt 128,163,66, eau lagon 92,182,214, sable doré
  233,198,130, roche plus profonde, CLIFF plus chaud.
- **Props** : boost `vividProp` (×1.3 d'écart au gris + lift 1.02) appliqué à la palette de
  CHAQUE modèle à l'écriture — les quasi-neutres (neige, pierre) bougent à peine.
- **Blocs** (`gen-blocks.pastelize`) : l'ancien voile blanc 14 % + désaturation 10 %
  DÉLAVAIT les palettes extraites → voile 6 % + saturation ×1.2. 32³ + LOD 16³ régénérés.
- **Persos** : `vivid` k 1.45 → 1.55-1.7 selon la zone ; **monstres** : vivid AJOUTÉ
  (corps ×1.4, accent ×1.5 — ils n'en avaient pas du tout).

### Fonctionnel (vérifié)
- Plein jour : sable doré, herbe chartreuse, monstres qui claquent ; bande aube/zénith/
  crépuscule équilibrée (aube dorée douce, crépuscule mauve lisible) ; planche des blocs
  nettement plus proche des isotiles ; e2e move/rotation OK ; `tsc` + build verts.

## 2026-07-18 (30) — FIX : les couleurs de tuiles étaient décalées d'une demi-case

### Fait
- Bug signalé : « la ville est positionnée au carrefour de plusieurs cases ». Cause dans
  `smoothTerrain.colColor` : le mélange uniforme (1/3 tuile + 1/3 voisin X + 1/3 voisin Y)
  **basculait de trio d'échantillons au CENTRE des tuiles** (le `sign(wx − tx0)` y change) —
  l'arête visible des carrés de couleur passait donc par les centres, les carrés perçus
  étaient décalés d'une demi-tuile et leurs COINS tombaient pile sous l'église. La position
  logique (église, socle, overlays, héros) a toujours été correcte : seule la peinture.
- Fix : **fondu bilinéaire 4 échantillons, poids NUL au cœur de la tuile** (il ne monte que
  sur le dernier tiers vers le bord : cœur net, jointure douce, continu partout).

### Fonctionnel (vérifié)
- Capture zoomée : l'église est centrée dans SON losange, les cases sable/herbe forment
  des losanges entiers alignés sur la grille logique ; e2e move/rotation OK ; build vert.

## 2026-07-18 (29) — RÉSOLUTION ×: terrain, props, persos et monstres plus fins

### Fait (demande : « augmenter le nombre de voxels de tout »)
- **Props ×1.5** (`gen-props.mjs`) : gabarits inchangés en coordonnées grossières 20×20×30,
  STOCKAGE fin 30×30×45 via `Grid.fineScale` (le principe des persos). Les formes COURBES
  sont évaluées PAR VOXEL FIN → vraies surfaces lisses : `ellipsoid` partagé (canopées,
  rochers, dômes, congères…), cônes des sapins, disque du nénuphar. Traits/boîtes en
  remplissage de cellule (proportions intactes). Le mesher normalise par `model.sx` →
  taille à l'écran INCHANGÉE, définition ×1.5.
- **Teinte par nappes 2×2×2 cellules** : le jitter 3 teintes est haché par blocs de 2
  cellules grossières (plus par cellule) → le greedy meshing fusionne mieux : 18,8 M →
  **16,1 M tris** pire-cas banc (était 10,2 M en 20³), meshing 151 → 78 ms. Même look.
- **Monstres ×1.6** (`monster-recipe.mjs`) : stockage 35×29×38, `ellipsoid` local évalué
  fin (slime/fantôme/araignée/loup nettement plus ronds), irrégularité `jitter`
  échantillonnée en coordonnées grossières (mêmes bosses, plus lisses).
- **Persos `CHAR_FINE` 1.5 → 2.5** (50×30×75) : cellules irrégulières 2/3 voxels (lecture
  organique) + **`roundedBox` : chanfrein DIAGONAL en voxels fins** (au lieu de vider la
  cellule de coin entière) → silhouettes chibi plus rondes, accessoires plus fins.
- **Terrain lissé R 8 → 10, VS 1/10** (`smoothTerrain.ts`) : marches et colonnes 25 % plus
  fines (terrasses plus douces), veines de minerai/algues suivent.

### Fonctionnel (vérifié)
- Previews : canopée sphérique lisse, sapin conique propre, slime/fantôme ronds, persos
  chanfreinés (SHEET.png) ; en jeu : arbres ronds + héros voxel OK au zoom.
- Banc **16,1 M tris** pire-cas plein monde (×1.58 vs avant, après optimisation des nappes
  de teinte) ; **vraie partie ~2,24 M** (le fog borne tout) ; e2e move/rotation OK ;
  `tsc` + build verts. Si un téléphone réel peine en fin de partie très explorée :
  descendre `FINE` à 1.25 ou ajouter un LOD props.

## 2026-07-18 (28) — WORLD-DETAILS : les idées « au goût » — le plan est livré EN TOTALITÉ

### Fait
- **Algues affleurantes** (eau) : nappes vert sombre SOUS la surface, en veines de bruit —
  teinte des COLONNES d'eau dans `smoothTerrain.colColor` (rollNoise > 0.63, fondu vers
  [56,122,104], k ≤ 0.7), pas un prop. Le shader de chatoiement passe par-dessus.
- **Muret en ruine** (prairie, « ancienne ferme ») : recette `ruin-wall` (segments à
  hauteur irrégulière, brèches, bloc tombé) posée en LIGNES ALIGNÉES — cellules 6×6
  hachées (8 %), orientation H/V et rangée d'ancrage par cellule, rotation POSÉE (0 ou
  π/2, pas hachée), 75 % de présence par tuile = segments avec trous sur 2-5 tuiles.
- **Ruines éparses** (lore, tous biomes terrestres) : `ruin-column` (colonne brisée en
  diagonale sur socle + tambour tombé), `ruin-slab` (dalle gravée, sillons + glyphes
  accent turquoise), `ruin-arch` (pilier + départ d'arc, moignon, gravats) — 2-3 par
  carte, tirage déterministe par seed (passe `ruins()` dans scatter.ts, même mécanique
  que les landmarks). ⚠ BUG corrigé : `strHash ^ 0x2417` renvoie un int32 SIGNÉ —
  sans `>>> 0`, `seed % 2` valait −1 (n=1 au lieu de 2-3) et `(seed+i) % 3` indexait
  négativement le tableau des types (attrapé par le test node multi-seeds).

### Fonctionnel (vérifié)
- Captures sur partie synthétique injectée par le bus (prairie 20×30 + eau) : nappes
  d'algues visibles, ligne de muret alignée + arche, dalle et colonne posées ; couleurs
  d'algues confirmées DANS la géométrie (scan des vertex `aWater`, ~7 % teintés avant
  renfort) ; banc 10,23 M tris (+0,01 M) ; e2e partie réelle move/rotation OK (l'échec
  intermédiaire = backend mort entre les tours, pas une régression) ; `tsc` + build verts.
- **50 props ×3 variantes** au total ; `WORLD-DETAILS-PLAN.md` ✅ livré en totalité.

## 2026-07-18 (27) — WORLD-DETAILS : la CASCADE (dernier élément du plan)

### Fait
- **`frontend/src/voxel/cascade.ts`** : détection PURE du site (`findCascadeSite` — falaise
  de relief ≥ 2 bordant une tuile d'eau découverte, 1/carte choisie par hachage de
  `game.id` comme les landmarks) + `buildCascade` = rideau vertical en `ShaderMaterial`
  (bandes qui DÉFILENT vers le bas + colonnes, écume brillante au pied, fondu au sommet,
  transparent/depthWrite off) + disque d'écume plat sur l'eau. ⚠ le lissage étale la
  falaise en TERRASSES : le rideau échantillonne la traversée falaise→eau (max côté haut,
  min côté eau) pour couvrir la chute COMPLÈTE, pas la dernière marche (h=0.63 illisible
  → h=2 sur le cas test).
- Câblage VoxelMapView : reconstruite avec le terrain (découverte), disposée proprement,
  `uTime` avancé sur les frames rendues (même politique que le shader d'eau).
- `WORLD-DETAILS-PLAN.md` marqué ✅ implémenté (D1-D4 complets).

### Fonctionnel (vérifié)
- E2E dédié : partie synthétique injectée par le bus (plateau montagne h6 bordant l'eau,
  tout découvert) → `world.cascade` construit, capture zoomée = rideau net à bandes sur
  les terrasses + écume ; e2e partie réelle inchangé (move/rotation OK, cascade absente
  si la géo ne s'y prête pas) ; `tsc` + build verts.

## 2026-07-18 (26) — WORLD-DETAILS lots D3+D4 : vie ambiante jour/nuit + effets

### Fait
- **Lot D3 (vie ambiante)** — 6 recettes : papillons (3 en l'air, ailes blanc/jaune/bleu par
  variante, altitude cuite dans le .vox), mouettes (« V » blancs au-dessus de l'eau),
  lucioles (motes jaune-vert), lapin crème / lièvre blanc (même gabarit `bunny` paramétré),
  crabe. Scatter : papillons PRÈS des fleurs (même tuile), lapins/lièvres JAMAIS sur une
  tuile à pack (`monsterId` dans `ScatterTile`), mouettes 3 % eau, crabes biaisés bord d'eau.
- **Bascule jour/crépuscule** : `PropPlacement.phase` ("day"|"night") → sous-groupes
  `dayProps`/`nightProps` dans VoxelMapView ; `applyPhase(t)` (seuil crépuscule 0.72 du
  cycle solaire) toggle `visible` au tick de 5 s — props déjà instanciés, coût nul. Les
  lucioles rendent en `MeshBasicMaterial` (self-lit, sans ombres) pour luire dans la pénombre.
- **Lot D4 (effets)** — toile d'araignée (voile triangulaire pâle, forêt 2 %, annonce
  l'Araignée Cristalline), souffle de neige (motes blanches figées, neige 6 %),
  **aigle-landmark** (silhouette sombre au-dessus d'un pic, éligible sommet/relief ≥ 3) qui
  **tournoie** : `tickAmbient()` avance sa position sur un cercle à chaque tick solaire ;
  **veines de minerai** dorées/cuivrées directement dans la couleur des MURS de falaise
  (`smoothTerrain.wall` : bruit sinusoïdal serpentant, montagne découverte, k > 0.55).
- Cascade : reportée (analyse de géométrie + shader dédié — seul reste du plan).

### Fonctionnel (vérifié)
- Banc plein monde **10,22 M tris** (D3+D4 = +0,06 M — budget très tenu) ; veines visibles
  sur les parois au banc ; e2e vraie partie : move + rotation OK, bascule jour→crépuscule→
  jour vérifiée sur les groupes (`d3-check.mjs`) ; previews des 9 nouveaux props lisibles ;
  `tsc` + build verts. 46 props ×3 variantes au total.

## 2026-07-18 (25) — WORLD-DETAILS lots D1+D2 : 29 nouveaux props + scatter partagé + repères par seed

### Fait
- **Lot D1 (couverture)** — 23 recettes dans `gen-props.mjs` : eau (nénuphar ± fleur, rocher
  émergé cerclé d'écume, bois flotté), sable (coquillages+étoile de mer, galets, algues
  échouées, herbes de dune = touffe recolorée sèche), prairie (hautes herbes en nappes,
  buisson à baies rouge/violet, marguerite géante, souche à champignon), forêt (champignon
  rouge-à-pois/brun/doré, fougère, tronc tombé moussu, buisson dense), montagne (éboulis,
  cristaux violets/bleus, cairn, arbre mort), neige (congère, pics de glace, arbre givré,
  buisson givré). 37 props ×3 variantes générés + previews (`asset-index/voxels/props/`).
- **Lot D2 (repères)** — 6 recettes landmarks (épouvantail, bonhomme de neige, barque,
  menhir gravé, tortue, ruche) + **tirage par seed** : 3-5 repères par carte hachés sur
  `game.id` (la seed est masquée par le fog), chacun sur SA meilleure tuile éligible ;
  cercle de fées = 8 champignons en anneau, vieil arbre = tree-green ×1.35 (écho au Cœur
  de chêne ancien). Un repère peut apparaître/se déplacer au fil de la découverte (assumé).
- **`frontend/src/voxel/scatter.ts`** — module PARTAGÉ carte/banc (le banc dupliquait la
  table) : pur, sans THREE, sortie = placements {id, v, x, y, rot, scale}. Règles
  **« près de »** par passe voisinage 8-voisins : bord d'eau, eau CALME (nénuphars),
  pied de falaise (éboulis ×8), sommet (cairns ×20), prairie ouverte (épouvantail) —
  ⚠ tout test exige `discovered` (biome caviardé à 0 sinon = faux lac). Nappes de hautes
  herbes par bruit basse fréquence (cellules 3×3) ; roseaux resserrés sur le bord d'eau.

### Fonctionnel (vérifié)
- Contact-sheet des 29 previews ✓ ; banc plein monde **10,16 M tris** (ombres comprises,
  +0,9 M vs 9,3 M — budget ≤ +1,5 M tenu) ; e2e vraie partie : terrain + move serveur +
  rotation OK, 2,18 M tris avec fog ; scatterProps déterministe, landmarks varient par
  seed (test node) ; `tsc` + build verts.

### Reste (plan WORLD-DETAILS)
- Lot D3 : vie ambiante (papillons/mouettes/lucioles/abeilles + bascule jour/nuit sur le
  tick solaire ; lapins/lièvres/crabes). Lot D4 : toiles d'araignée, veines de minerai,
  cascade shader, souffle de neige, aigle.

## 2026-07-17 (24) — VOXEL PAR DÉFAUT + détails par terrain + nouveau brouillard

### Fait
- **Phase 6 (décision utilisateur) : `voxelMap: true` par défaut** — le voxel est le rendu de
  Map/Combat/Home ; « Classique » dans les Réglages rebascule sur Phaser. ⚠ un appareil qui
  a déjà SAUVÉ des réglages garde sa valeur locale.
- **Détails par terrain** (gen-props + scatter carte ET banc) : `pine`/`pine-snow` (sapins à
  4 étages coniques, variante saupoudrée) sur montagne/neige, `grass-tuft` (5-7 brins) +
  `flowers` (têtes rouge/jaune/blanc par variante) en prairie + sous-bois forêt, `reed`
  (roseaux à quenouilles) sur les rives de sable. Densités : herbe 55 %, fleurs 16 %,
  sapins 30-35 %, roseaux 12 %. ~9,3 M tris plein monde au banc (ombres comprises).
- **Brouillard de guerre refondu** : mur à DEUX niveaux (`mistbase` voile profond
  indigo→lavande + `mist` sommet) et nouvelle texture — dôme ample par bloc (houle entre
  voisins), **volutes tourbillonnantes sur le dessus** (v1 plate « papier » corrigée sur
  capture : le dessus est LA face visible), striures de flanc, motes. Overlays/losanges
  posés au sommet du mur (topOf non-découvert = 2).

### Fonctionnel (vérifié, captures banc + vraie partie)
- Sapins sur terrasses, roseaux aux étangs, prairies vivantes ; mur de brume texturé autour
  de l'île ; move serveur + rotation OK ; `tsc` + build verts.

## 2026-07-17 (23) — FIX déploiement Vercel (imports hors racine)

### Fait
- PR #14 mergée → build Vercel en échec. Reproduit en local en cachant `scripts/` :
  `Could not resolve "../../../scripts/voxel/recipes.mjs"` — le service frontend (racine
  `frontend/`) n'inclut pas les fichiers hors racine.
- **Fix** : `recipes.mjs` + `vox-format.mjs` déplacés dans **`frontend/src/voxel/shared/`**
  (le navigateur les bundle) ; les scripts Node (`gen-blocks/characters/monsters/props`)
  importent `../../frontend/src/voxel/shared/…` — le partage CLI↔navigateur est conservé,
  la dépendance va maintenant de scripts vers frontend.
- Vérifié : build AVEC `scripts/` masqué (simulation Vercel) ✓, générateurs Node ✓,
  tsc + build complets ✓. Branche relancée depuis origin/main (PR mergée) + ce commit.

## 2026-07-17 (22) — Personnages encore réduits + blocs de pente 1/8

### Fait
- `HERO_HEIGHT` 0.72 → **0.6** (héros + monstres) — petites figurines dans un grand monde.
- **Grille de terrain 1/8** (R 6→8, VS 1/8) : chaque bloc de pente réduit d'un tiers de plus
  (¼ → 1/6 → 1/8 au fil des retours). Coût quasi inchangé (8,7 M plein monde au banc,
  le terrain reste marginal face aux arbres).

### Fonctionnel (vérifié, capture + e2e)
- Proportions figurines/monde agréables, marches fines ; move + rotation OK ; build vert.

## 2026-07-17 (21) — Personnages réduits (retour utilisateur)

### Fait
- `HERO_HEIGHT` 0.85 → **0.72** (héros ET monstres — constante partagée de CharLibrary),
  suppression du ×1.25 carte ; étiquettes recalées (carte +0.82, ville +1.18) ; ville :
  billboards héros 1.35 → 1.1 ; combat : barres de PV abaissées (+0.8), fallback billboard 0.7.

### Fonctionnel (vérifié, capture + combat e2e)
- Proportions personnages/église/arbres plus justes ; combat OK ; build vert.

## 2026-07-17 (20) — Plus de détails (retour « trop pixelisé »)

### Fait
- **Grille de terrain 1/6** (R 4→6, VS ¼→1/6) : marches deux fois plus fines sur les pentes,
  terrasses de montagnes finement étagées. ⚠ MICRO d'abord gardé à 0.11 → il franchissait le
  nouveau pas partout et couvrait les plaines de bosselures (constaté sur capture) → 0.045 :
  plaines propres, la texture vient de la grille et de l'ondulation, pas du bruit.
- **Fini le « bruit de pixels » couleur** : nuances de biome mélangées par bruit DOUX
  (rollNoise — grandes nappes fondues, plus de damier par tuile), grain par colonne 0.985±3 %
  (au lieu de ±6 %), pointillés plus rares et plus doux.
- **Arbres/rochers 20³** (16³ → 24³ essayé : 13,4 M tris plein monde → 20³ = compromis, avec
  densité forêt réduite [2e arbre 50 %, cerisier 12 %]) : canopées nettement plus rondes.
- **Héros sur-échantillonnés ×1.5** (`Grid` : mode `fineScale` — gabarits inchangés en
  coordonnées grossières, stockage 30×18×45 ; monstres/props gardent fs=1 par défaut).
- Budget : 8,25 M tris au banc PLEIN MONDE (ombres comprises ; ~2-3 M en jeu réel avec fog).

### Fonctionnel (vérifié, captures banc + vraie partie)
- Montagnes étagées fines, plaines lisses aux nappes douces, arbres ronds, héros nets et
  nommés. Move serveur + rotation OK ; `tsc` + build verts.

## 2026-07-17 (19) — Lisibilité des héros sur carte + brume nettoyée

### Fait
- **Héros plus lisibles sur la carte** (mes 3 conseils appliqués) : (1) modèles voxel ×1.25
  sur la Map ; (2) `vivid()` dans gen-characters — saturation +45 % / accent +55 % sur
  cheveux/tenue/accents (PAS la peau), personnages régénérés ; (3) **étiquette de nom**
  au-dessus de MES héros (makeLabel, comme en ville/combat).
- **Brume 16³ nettoyée** (recipes.mjs, LOD < 24) : moitié moins de bosses, deux fois plus
  basses, voile limité à la moitié CLAIRE de la rampe — fini les « débris gris » épars sous
  la lumière diorama. `voxels/16/mist-*` régénérés.

### Fonctionnel (vérifié, capture)
- Brisa/Aldric/Cael nets, nommés et colorés au milieu des tornades ; brume propre ;
  combat re-vérifié (les .vox de personnages ont changé) ; `tsc` + build verts.

## 2026-07-17 (18) — Reliefs rehaussés + sol texturé (retour « trop lisse »)

### Fait
- **`HEIGHT_SCALE = 1.9`** : les hauteurs du monde sont amplifiées à l'affichage — collines
  et montagnes ~2× plus hautes, massifs à falaises multi-terrasses.
- **`rollNoise` + `ROLL_AMP = 1.1`** : ondulation LENTE inter-tuiles (bruit de valeur lisse,
  2 octaves, périodes ~6.5/2.8 tuiles) ajoutée aux terres — les plaines roulent en buttes de
  marches au lieu d'un aplat ; le sable près de l'eau ondule à 35 % (plages basses).
- **`MICRO` 0.06 → 0.13** : bosses voxel isolées éparses dans les plaines (texture de sol).
- Rendu purement CLIENT (smoothTerrain) : les données serveur/gameplay ne bougent pas ;
  unités/props/losanges suivent via `heightAt` quantifiée.

### Fonctionnel (vérifié, capture banc + vraie partie)
- Massifs imposants, plaines texturées ; move serveur + rotation OK ; `tsc` + build verts.

## 2026-07-17 (17) — Couleurs densifiées (retour « moins pâle »)

### Fait
- **Palette diorama saturée** (`smoothTerrain.DIORAMA`) : herbe verte franche (150,200,118),
  eau lagon (110,182,214), sable doré, sol forêt profond, falaises plus chaudes (214,199,168).
- **Canopées d'arbres densifiées** (gen-props : vert feuillu 134,192,108 / profond 104,168,88 /
  rose cerisier 232,164,188 — props régénérés).
- **Lumière calibrée en conséquence** : hemi 1.4→1.2, sun 1.75→1.7 (+ rampes du cycle solaire
  alignées) — la surexposition délavait les teintes.

### Fonctionnel (vérifié, captures midi/crépuscule banc + vraie partie)
- Verts qui existent, eau vraiment bleue, cerisiers qui ressortent ; crépuscule mauve sur
  palette dense très lisible. Move serveur + rotation OK, `tsc` + build verts.

## 2026-07-17 (16) — CYCLE SOLAIRE sur le timer de vague + shader d'eau

### Fait
- **`engine.setDayTime(t)`** (t = progression 0..1 vers la prochaine vague) : le SOLEIL
  parcourt un arc dans le ciel (azimut −1→+0.9 rad, élévation en cloche qui plonge après
  t=0.85) et les couleurs suivent des rampes multi-arrêts — **aube dorée-orangée** après la
  vague → plein jour neutre chaud → heure dorée → **crépuscule MAUVE-INDIGO marqué** quand
  la vague approche (sun 0.8/0.5/0.62 int. 0.95 ; hemi 0.6/0.56/0.88 int. 1.05). Position
  soleil calculée dans applyCamera (suit la cible ET le cycle). 1re passe trop subtile —
  rampes amplifiées sur comparaison de captures banc.
- **`VoxelMapView.waveProgress()`** : t = 1 − restant/période (période = nextWaveAt −
  lastWave.at, fallback 600 s) ; tick 5 s (`sunTick`) → setDayTime + temps du shader —
  compatible rendu on-demand (~12 rendus/min au repos).
- **SHADER d'eau** (`smoothTerrain`) : attribut `aWater` par vertex + injection
  `onBeforeCompile` dans le Lambert (uniform `uTime`, deux ondes sinus croisées ±0.06 de
  luminosité sur les fragments d'eau) — l'eau chatoie sur les frames rendues, immobile au
  repos (pas de boucle continue, batterie). `setTime` avancé par engine.onFrame + le tick.

### Fonctionnel (vérifié, captures aube/midi/crépuscule sur le banc plein monde)
- Aube pêche-dorée / midi neutre / crépuscule mauve nettement différenciés ; move serveur
  + rotation OK en vraie partie ; `tsc` + build verts.

## 2026-07-17 (15) — PENTES VOXEL : le continu rasterisé en marches (choix utilisateur)

### Fait
- Retour utilisateur : le sol continu ne plaît pas — il veut des pentes EN VOXELS.
  **`smoothTerrain.ts` réécrit** : le champ de hauteurs lissé + terrassé est RASTERISÉ en
  colonnes voxel (R=4 par côté de tuile, pas vertical VS=¼ → voxels cubiques) — les pentes
  sont des ESCALIERS de petits cubes, comme la référence diorama. Face du dessus par
  colonne + murs vers les voisins plus bas (bord de monde → mur jusqu'à 0, jupe intégrée).
- Conservé : terrasses organiques, palette diorama fondue, pointillés, eau en creux
  (AO plafonnée sur l'eau pour rester laiteuse), ombrage voxel par face (mêmes valeurs que
  le mesher) + **teinte pierre crème ∝ hauteur de la marche** (rebords de terrasse crème),
  AO par concavité + léger rehaut de rebord. `heightAt` = hauteur QUANTIFIÉE de la marche.
- ⚠ enroulement des quads choisi par produit (normale géométrique · normale voulue) — pas
  de dérivation manuelle par face (la leçon de chiralité du mesher).
- Réglage renommé : « Terrain voxel : Blocs / **Pentes voxel** » (le mode continu lisse
  n'existe plus). ~124 k colonnes au banc 60×60, coût comparable au lisse.

### Fonctionnel (vérifié e2e, captures)
- Banc plein monde : collines en escaliers voxel, étangs étagés, arbres/ombres inchangés ;
  vraie partie : île en plateau à rebords crème étagés, move serveur OK, rotation OK.
  `tsc` + build verts.

## 2026-07-17 (14) — Diorama itération 2 : rives, pointillés, GRAND MONDE au banc

### Fait
- **L'eau se creuse** (`tileH` → −0.45 pour biome 0) : rives en pente douce, étangs laiteux
  aux bords fondus (sable auto par le fondu de biomes). **Pointillés d'herbe** discrets
  (5 % des vertex herbe/forêt à −14 %). Terrasses resserrées (bande 0.34 → 0.26).
- **`SmoothTerrain` accepte une source STRUCTURELLE** (`TerrainSource`) → le **banc 60×60
  a un mode 🌄 Lisse / 🧱 Blocs** (bouton + hook `__vbRebuild`) qui construit le diorama
  TOUT DÉCOUVERT (2 415 arbres/rochers scatter) — l'outil d'évaluation du style et de la
  perf pire-cas. Résultat visuel TRÈS proche de la référence (captures).
- **Jitter des canopées quantifié en 3 teintes** (gen-props) : 7,0 → 5,9 M tris au banc
  plein monde (ombres comprises) — l'arbre voxel bosselé fusionne mal par nature ; en vraie
  partie le fog réduit à ~10-20 % de ça. Blocs re-générés.
- Backend mort pendant une interruption (diagnostic : dernier log 16:12, curl 000) —
  relancé, e2e re-vérifié.

### Fonctionnel (vérifié e2e, captures)
- Banc lisse plein monde : collines terrassées crème, forêts de boules + cerisiers, étangs,
  longues ombres — le style de la référence. Vraie partie : île diorama, move serveur OK,
  rotation OK. `tsc` + build verts.

## 2026-07-17 (13) — Terrain continu : STYLE DIORAMA (référence image utilisateur)

### Fait
- **Terrasses organiques** (`smoothTerrain.ts terrace()`) : le champ lissé est re-quantifié en
  plateaux plats + montée douce centrée sur les demi-niveaux (bande `TERRACE_BAND` 0.34) —
  les courbes de niveau du champ lissé deviennent des rebords arrondis, PAS les frontières
  de tuiles.
- **Falaises pierre crème** : fondu couleur biome → `CLIFF` crème par pente locale (seuil
  HAUT 1.15 — première passe à 0.55 passait la moitié de l'île en crème, corrigé sur
  capture) ; jupe périmétrique assortie.
- **AO cuite** : la concavité locale (moyenne des 4 voisins − h) fonce doucement les creux
  et pieds de falaises (max −32 %).
- **Palette DIORAMA par biome** (dans smoothTerrain, remplace palettes.json pour le mode
  lisse) : herbe menthe, sable crème, eau laiteuse, sol forêt clair (les ARBRES font le
  vert) — 1re passe trop délavée, re-saturée sur capture.
- **`gen-props.mjs` + scatter** : arbres-boules (tronc + canopées ellipsoïdes fondues,
  jitter de teinte) verts ×3 + ROSES cerisier ×3 + rochers ×3 → `voxels/props/` ;
  `VoxelMapView.buildProps()` : forêt = bosquet (2-3 arbres), prairie = arbre occasionnel
  (rose 1/3) + caillou rare, roche = rochers — InstancedMesh, positions/échelles/rotations
  par hachage déterministe, posés sur `smooth.heightAt`, ombres portées.

### Fonctionnel (vérifié e2e, captures)
- Île diorama : plateaux menthe, bosquets + cerisiers, rebords crème, église, move serveur
  OK, rotation OK. `tsc` + build verts.

### À faire (suite diorama)
- Vérifier sur un monde PLUS GRAND (l'île de test 22×22 est petite), rives d'eau claires,
  pointillés d'herbe discrets (la référence en a), densité d'arbres à goûter, terrasses
  plus marquées si besoin.

## 2026-07-17 (12) — Carte : terrain CONTINU (lisse) en alternative aux blocs

### Fait
- **`frontend/src/voxel/smoothTerrain.ts`** : surface lissée construite des MÊMES données
  serveur — hauteur aux COINS = moyenne des tuiles adjacentes (pentes continues au lieu de
  marches), sous-division 3×3/tuile + micro-relief (nul sur l'eau), **couleurs par vertex
  depuis palettes.json** (mêmes teintes pastel que les blocs) FONDUES aux frontières de
  biomes (plages dégradées automatiques) + grain léger, jupe périmétrique, normales lissées
  (le Lambert + ombres de la passe beauté font le modelé), `heightAt(x,y)` bilinéaire.
- **Réglages → « Terrain voxel » : Blocs / Lisse** (`settings.voxelSmooth`, défaut LISSE,
  visible quand la carte voxel est active, bascule à chaud). CARTE MONDE uniquement —
  Combat/Home gardent leurs blocs (grille tactique/carte d'auteur).
- Intégration `VoxelMapView` : en mode lisse le sol découvert vient de la surface (la brume
  reste en blocs voxel par-dessus les tuiles vierges), overlays/unités posés à
  `smooth.heightAt+0.04`, **picking = point d'impact arrondi** (plus simple que les blocs),
  clé de terrain étendue (`:s|:b`) pour reconstruire au changement de mode.

### Fonctionnel (vérifié e2e)
- Île découverte = colline lisse aux biomes fondus, losanges/danger épousent la pente,
  move serveur OK, rotation OK (captures). `tsc` + build verts.

### À faire (si le mode lisse plaît)
- Fondu brume↔surface au bord de la découverte, eau animée, falaises plus marquées
  (accentuer les fortes pentes), étendre aux 16³ l'idée si on veut du lisse au Home.

## 2026-07-17 (11) — Voxel : passe BEAUTÉ (lumière pastel, ombres, textures adoucies)

### Fait
- **`engine.enableLighting({shadowSpan})`** : hémisphérique ciel quasi neutre `#f7f5ff` →
  rebond lavande `#cfc2e8` (1.4) + **soleil directionnel** à peine chaud `#fff2e0` (1.75),
  FIXE DANS LE MONDE (les ombres tournent avec la caméra — lisible), **ombres portées douces**
  (PCFSoft 1024, boîte suivant `target` — le pan ne sort jamais de l'ombre ; span par vue :
  map 45, ville 32, combat 9, éditeur 4). PAS de tone mapping (l'ACES essayé boueusait les
  pastels) ni de fog (à 300 de caméra ortho, tout était dans le voile — retiré).
- **Matériaux Lambert** partout (terrain instancié, personnages ; normales émises par le
  mesher — mapping d'axes voxel→monde [0,2,1]) ; ombrage CUIT réduit (py1/ny.55/px.93/nx.84/
  pz.97/nz.78) pour laisser la lumière modeler. **La brume reste en Basic auto-éclairé**
  (éclairée, elle devenait un papier gris sale). castShadow/receiveShadow sur tout le voxel.
- **Palettes pastelisées** (`pastelize` dans gen-blocks : +14 % vers le blanc, −10 % de
  saturation) — blocs 32³ ET 16³ régénérés ; les 5 vues (Map/Combat/Home/banc/éditeur)
  activent la lumière (éditeur = WYSIWYG).
- ⚠ le comptage renderer double (tris/calls ×2) : c'est la PASSE D'OMBRE — attendu.

### Fonctionnel (vérifié e2e, captures)
- Map : brume lumineuse, verts adoucis, flancs modelés, move serveur OK. Combat : ombres des
  piliers visibles, relief net, move OK. Ville : le rempart projette son ombre, héros nommés.
  Banc 5,36 M tris (2×2,68 M avec ombre), éditeur pose/undo/régénération OK. Build vert.

### À faire (idées beauté suivantes)
- AO par vertex (fusion greedy consciente de l'AO), eau animée (shader onBeforeCompile),
  respiration de la brume, ciel dégradé du combat.

## 2026-07-17 (10) — Voxel Phase 5 (fin) : monstres voxel + catalogue — FIN du chantier autonome

### Fait
- **`monster-recipe.mjs`** : 9 silhouettes paramétrées (blob slime + reflet, fantôme à jupe
  festonnée [harpies], TOURBILLON étagé [élémentaire de vent], champignon à pois [dryade],
  chauve-souris ailes en éventail, araignée 8 pattes + cristal, quadrupède [loup-garou],
  gobelinoïde petit/grand [gobelin/orc + défenses]) — `Grid`/`shade` partagés avec le gabarit
  héros. **`gen-monsters.mjs`** : corps = cluster dominant du PNG, accent = cluster distinct.
- Map ET Combat : `ALL_CHAR_KEYS` (7 héros + 9 monstres) — **tout le monde passe en modèle
  voxel** quand le .vox existe, billboard sinon ; vérifié e2e (combat 100 % voxel : Aldric vs
  3 harpies-fantômes voxel, move serveur OK).
- **`build-catalog.mjs` énumère `voxels/**`** (95 .vox, catégorie `voxels`, tags voxel/lod/…) —
  600 assets au catalogue. `CLAUDE.md` §7a-bis à jour (Phases 0→5 documentées).

### État global du chantier voxel (VOXEL-PLAN.md)
- ✅ Phases 0, 1, 1b, 2, 3, 4, 5 + passe polish/perf. Tout derrière **Settings → « Carte
  voxel (expérimental) »** ; Phaser reste le défaut et le fallback.
- ⏳ **Phase 6 (voxel par défaut + retrait Phaser) = décision de Guillaume après test sur
  téléphone réel** (pinch/pan/rotation à valider au doigt ; le banc 🧊 → « 🌍 Terrain 60×60 »
  donne les budgets live). Restent aussi (petits) : grilles de ciblage GDD par case en combat,
  respiration de la brume, test perf automatisé du chemin voxel, onglet persos de l'éditeur.

## 2026-07-17 (9) — Voxel Phase 5 : personnages voxel (héros, étape 2)

### Fait
- **`scripts/voxel/char-recipe.mjs`** (JS pur, partageable) : gabarit CHIBI voxel paramétré
  20×12×30 — grosse tête, yeux + reflet, joues, tunique/ceinture/bottes, et **accessoire par
  classe** : cape (éclaireur), casque de chantier (bâtisseur), arc + carquois (chasseur),
  heaume + cimier + épée (chevalier), sac à dos (récupérateur), capuche + bâton à gemme
  (soigneur), chapeau pointu + bâton (mage). Le personnage FAIT FACE à +y.
- **`gen-characters.mjs`** : couleurs (peau/cheveux/tenue/accent) **échantillonnées par ZONES**
  dans les PNG chibi existants (bande haute = cheveux, visage = peau [filtre teinte chair],
  torse = tenue, accent = cluster le plus saturé) → 7 `.vox` dans `public/voxels/chars/` +
  previews/SHEET dans `asset-index/voxels/chars/`. Retouche MagicaVoxel possible (re-déposer).
- **`frontend/src/voxel/characters.ts`** (CharLibrary : fetch+mesh, échelle normalisée
  HERO_HEIGHT, fallback silencieux si le .vox manque) ; **Map et Combat utilisent le modèle
  voxel des héros quand il existe** (sinon billboard — bascule progressive) ; le modèle
  **tourne réellement avec la caméra** (rotation.y = azimut, mis à jour chaque frame via
  engine.onFrame + getter `azimuthNow` ; l'animation de rotation l'entraîne aussi).
  Monstres : billboards conservés (gabarits blob/volant = suite).

### Fonctionnel (vérifié e2e)
- Contact sheet des 7 classes inspectée (accessoires reconnaissables) ; combat réel : Aldric
  rendu en VOXEL sur l'arène (capture), clic case verte → move serveur OK, rotation OK.
  `tsc` + build verts.

### À faire
- Monstres voxel (gabarits blob/volant/quadrupède), catalogue `voxels` dans build-catalog,
  onglet personnages de l'éditeur voxel, MAJ CLAUDE.md §7a-bis. **Phase 6 (retrait Phaser +
  flag par défaut) = décision utilisateur après test sur téléphone réel.**

## 2026-07-17 (8) — Voxel : passe polish + perf (Map/Combat/Home)

### Fait
- **LOD 16³ complet** (26 blocs régénérés dans `voxels/16/`) et **la ville passe au 16³** :
  6,1 M tris → **426 k** (14×) — lisible de près, style voxel assumé.
- **`labels.ts`** : étiquettes texte en sprites canvas (cache par contenu, **depthTest OFF** —
  au bord d'un bloc le test de profondeur les avalait ; bonus FFTA2 : le nom reste lisible
  quand l'unité est cachée derrière un pilier).
- **Combat** : cases atteignables en vert franc + liseré sombre (l'ancien vert doux se noyait
  dans l'herbe), **noms (+ états) sous les unités**.
- **Home** : pastilles remontées AU-DESSUS des sprites de bâtiments (elles les recouvraient ;
  recalées sur la hauteur réelle du sprite au chargement de sa texture), héros sur l'herbe
  agrandis (1.35) + **étiquette de nom**.

### Fonctionnel (vérifié e2e)
- Ville 426 k tris / 63 draw calls, 7 pastilles, modal Puits OK ; combat re-vérifié (clic case
  verte → move serveur, labels visibles sur capture). Build vert.

## 2026-07-17 (7) — Voxel Phase 4 : le Home (ville) en voxel

### Fait
- **15 nouveaux blocs voxel** (32³, `gen-blocks.mjs`) : TOUS les matériaux de sol de
  `town-map.json` (sandstone, goldblock, coalblock, cactus, mud, limestone, redsand, jungle,
  ash, fallgrass, dungeon, basalt, darkgrass, copperblock, darkstone) — palettes extraites de
  leurs isotiles → les couleurs de la carte d'auteur sont préservées. 26 blocs au total.
- **`terrain.ts` : `buildStacks()`** — instanciation de blocs à niveaux ARBITRAIRES (le format
  `Cell.blocks[]` de l'éditeur : piles hétérogènes, trous permis).
- **`frontend/src/voxel/VoxelTownView.tsx`** : le Home voxel, MÊMES props que TownMap
  (`selected/onBuildingClick/onClear` — HomeTab bascule sur `settings.voxelMap`) :
  - terrain = town-map.json interprété pile par pile (575 cellules) ;
  - bâtiments/props de l'éditeur en billboards aux positions d'auteur (inversion des offsets
    écran dx/dy → monde : du=dx/tileW+dy/tileH, dv=dy/tileH−dx/tileW ; scale·objW/tileW, flipX) ;
  - **hotspots par raycast** sur les sprites (remplace le hack elementFromPoint) + **pastilles
    DOM projetées chaque frame** (nom + durabilité, CSS .town-spot réutilisé, MAJ impérative
    dans engine.onFrame — pas de re-render React au pan) ;
  - MES héros en ville sur l'herbe (mêmes GRASS_FILES/hachage/stride que TownMap) ;
  - zoom/pan/pinch du moteur + rotation ↺/↻, fit initial sur la zone occupée.

### Fonctionnel (vérifié e2e — backend réel)
- Onglet Home flag ON : ville rendue (60 draw calls), **7 pastilles projetées**, clic pastille
  Puits → **modal réel** (Eau 6/50, durabilité 97/100, « Puiser de l'eau (Aldric) », PA de
  l'équipe), rotation 180° (la Tour et son sprite passent au premier plan, pastilles suivent).
  `tsc` vert. Captures inspectées.

### À faire (peaufinage voxel avant Phase 5)
- Ville : 6,1 M tris (32³ × 575 cellules) — envisager un LOD 16³ ville ou accepter (rendu
  on-demand) ; sprites bâtiments petits sous les pastilles (offset pastille au-dessus du
  sprite) ; héros sur l'herbe peu visibles (taille/label).
- Combat : contraste cases vertes, labels d'unités. Map : test perf dédié.
- Puis Phase 5 (gabarit chibi voxel) et Phase 6 (retrait Phaser).

## 2026-07-17 (6) — Voxel Phase 3 : combat iso sur le moteur voxel

### Fait
- **`frontend/src/voxel/VoxelCombatView.tsx`** : le combat 7×7 sur le MÊME moteur (blocs 32³ vus
  de près — herbe sur terre, piliers = `combat.heights`), contrat bus identique à CombatScene
  (CombatRender entrant ; **clic unité PRIORITAIRE** puis case, via raycast sprites→terrain →
  CombatUnitClick/CombatTileClick). Cases atteignables serveur en quads verts, unité courante
  cerclée jaune, cibles rouge (attaque) / violet (skill), unités en billboards + **barres de PV
  en sprites face caméra**, fond opaque #161022, **rotation FFTA2 ↺/↻** (cadrage centre de grille).
- `MapTab` : `settings.voxelMap` couvre maintenant les DEUX vues (Map hors combat, Combat en
  combat) — Phaser plus monté du tout quand le flag est actif.
- Pas encore porté : étiquettes nom/états sous les unités (l'UI CombatControls les montre),
  grilles d'attaque VERTES/ROUGES du ciblage GDD par case (les cibles restent les anneaux) —
  à faire quand `combatResponse` exposera les grilles par case côté vue.

### Fonctionnel (vérifié e2e — backend réel)
- Héros marché jusqu'à un pack (2 pas), combat lancé : Aldric vs 2 Harpies de Prairie,
  13 cases atteignables rendues, **clic RÉEL sur case verte projetée → move serveur
  (2,6)→(3,6)**, rotation 90° (les harpies masquées par un pilier deviennent visibles —
  la démo parfaite de l'intérêt du 3D). `tsc` vert. Captures inspectées.

### À faire
- Phase 4 : Home voxel (town-map.json → piles de blocs + bâtiments billboards + hotspots raycast).
- Peaufinage combat : contraste des cases vertes, labels, grilles de ciblage par case.

## 2026-07-17 (5) — Voxel Phase 2 : la carte monde en voxel (réglage `voxelMap`)

### Fait
- **`frontend/src/voxel/VoxelMapView.tsx`** : la Map voxel EXPÉRIMENTALE, derrière **Settings →
  Réglages → « Carte voxel (expérimental) »** (`settings.voxelMap`, persisté ; défaut = iso
  classique). Elle parle **le même contrat bus que MapScene** (MapRender entrant ;
  MapTileClick/MapHeroClick/MapHeroMenu sortants ; MapSceneReady au montage) → menu radial,
  TopBar, store inchangés. `MapTab` monte VoxelMapView OU PhaserGame ; **un combat repasse sur
  Phaser** (jusqu'à la Phase 3).
- Contenu : terrain InstancedMesh (blocs 16³, `under` terre/pierre, ombrage d'altitude par tint),
  **fog serveur → blocs de brume** (tuiles vierges), re-instanciation quand `discovered` évolue ;
  losanges de déplacement (mêmes règles : ortho, eau connue, porte scellée), socle + **église
  billboard** sur la ville, monstres = teinte de danger (jaune→rouge par count) + sprite créature,
  héros = billboards chibi (miens pleins / autres α0.45 / en ville masqués, ellipse par case),
  anneau de sélection ; boutons ↺/↻ (rotation 4 orientations) en haut à droite de la vue.
  Textures en `NoColorSpace` + renderer laissé linéaire → les octets PNG/palettes passent tels
  quels (pas de dérive sRGB vs les previews).
- Déplacement **sans animation, case par case** : positions snap sur l'état serveur (consigne).

### Fonctionnel (vérifié e2e — backend Go réel + Chromium headless)
- Partie créée via `newGame`, flag activé, onglet Map : terrain construit (49 découvertes / 484,
  reste en brume), **déplacement serveur OK** ((11,11)→(12,11), PA 6→5) via MapTileClick,
  **rotation 90° OK** (billboards face caméra), 26 draw calls / 409 k tris sur 22×22.
  `tsc` + build verts. Captures inspectées (shell téléphone complet).

### À faire
- Phase 3 : combat iso voxel (grilles GDD en quads, mêmes blocs, rotation FFTA2) puis Phase 4
  (Home voxel depuis town-map.json). Peaufinage Map : pinch réel sur appareil, perf test dédié,
  hint « pas encore de combat voxel ». Vague/brume animée (respiration) à porter si souhaité.

## 2026-07-17 (4) — Voxel Phase 1b : éditeur voxel (🧊 Voxels / #voxeledit)

### Fait
- **`frontend/src/voxeledit/`** (écran `voxeledit`, hors shell, bouton titre « 🧊 Voxels » →
  éditeur ; le banc garde `#voxel-bench` + liens croisés « 🌍 Terrain 60×60 » / « 🧊 Éditeur ») :
  - `voxeditStore.ts` (zustand séparé, hook DEV `window.__vx`) : modèle mutable + `rev`,
    undo/redo par snapshots (≤60), autosave localStorage `echoterra:voxeled:doc` (base64) +
    restore, bibliothèque par `import.meta.glob` sur `public/voxels/**/*.vox` (groupée 32³/16³),
    **palette tronquée aux couleurs utilisées** au décodage.
  - `VoxelEditScreen.tsx` + `voxeledit.css` : bibliothèque (gauche), vue moteur (centre —
    modes **Bloc / 3×3 / Pile** pour vérifier les raccords, GridHelper décalé -0.002 [z-fight]),
    outils (droite) : ✋ nav, 🧱 poser, ⌫ effacer, 💉 pipette (raycast face → voxel ±normale/2),
    ⇄ miroir X, palette cliquable + ajout couleur, **recettes LIVE** (sliders params/seed/16³-32³
    → `regenerate()` via l'IMPORT DIRECT de `scripts/voxel/recipes.mjs` — le module partagé),
    export .vox (download, à redéposer dans public/voxels/) / import .vox.
- **Moteur** : `orbitBy` (orbite libre azimut/élévation, éditeur), `elevation` paramétrable,
  `cameraDir(az, el)` ; `VoxelControls.mode = "pan" | "orbit"`. Une rotation « jeu » (↻/↺)
  reprend l'angle dimétrique.
- **`gen-blocks.mjs` écrit `voxels/palettes.json`** (id → palette extraite + recette + params,
  fusion avec l'existant) : le navigateur ne peut pas faire l'extraction sharp — c'est le pont
  qui permet la régénération 100 % navigateur.

### Fonctionnel (vérifié)
- `tsc` + build OK ; vérifié headless : chargement grass-v0, pose de voxel (history 1) → undo (0),
  panneau recette (sliders + seed), **régénération live OK** (« régénéré grass (seed 777, 32³) »),
  vue 3×3, orbite libre par drag. Captures inspectées.

### À faire
- Phase 2 : Map monde réelle branchée sur GameState (fog serveur → blocs mist, sélection/
  losanges/danger en quads, billboards persos, flag Settings). Éventuel : brosse rectangle,
  crop de plans, thumbnails bibliothèque.

## 2026-07-17 (3) — Voxel Phase 1 : moteur Three.js + banc d'essai

### Fait
- **`frontend/src/voxel/`** (dep `three`) : `vox.ts` (décodeur .vox navigateur), `mesher.ts`
  (greedy meshing → BufferGeometry couleurs par vertex, éclairage CUIT par direction de face —
  ⚠ l'échange d'axes voxel(z-up)→three(y-up) inverse la chiralité : enroulement OPPOSÉ, vérifié
  par test de normales sur cube unité), `engine.ts` (WebGL **on-demand** — 0 frame au repos,
  caméra ORTHO dimétrique élévation 30°, canvas px physiques DPR, frustum en px CSS → zoom = px/unité),
  `rotation.ts` (4 orientations, azimut 45°+k·90°, animée 240 ms), `controls.ts` (pan « attrape le
  sol », molette ancrée, **pinch absolu depuis baseline** — même math que MapScene, TAP_SLOP 10px CSS),
  `terrain.ts` (BlockLibrary par LOD + `buildTerrain` : **InstancedMesh par (bloc,variante)**,
  bloc `under` sous la surface [terre sous herbe — sinon piliers « rayés »], tint par instance,
  lookup instance→cellule pour le picking).
- **Banc `#voxel-bench`** (bouton titre « 🧊 Voxels », écran hors shell `voxelbench`) : monde 60×60
  simulé (biomes par bruit + anneau de brume), HUD draw calls/tris/instances/meshing/frame,
  boutons rotation, tap→sélection (quad jaune posé sur la tuile).
- **LOD 16³** (`gen-blocks --size 16 --out 16` → `voxels/16/`) : à l'échelle carte, 32³ = 21,9 M
  tris (mesuré) → 16³ + flancs unis + scatter atténué = **2,7 M tris, 24 draw calls, meshing
  64 ms, chargement ~200 ms** (mesuré headless). Recettes : tons quantifiés en paliers (aide le
  greedy + style aplats), flancs speckle seulement ≥24³.

### Fonctionnel (vérifié)
- `tsc -b` + `npm run build` OK ; bench vérifié en Chromium headless GL logiciel (Playwright,
  poll par evaluate) : terrain rendu (captures), tap → « (33,34) forest ×3 », rotation 90°/180°
  correcte, zéro erreur console. Budgets HUD ci-dessus.

### À faire
- Phase 1b : éditeur voxel (`#voxeledit`, bibliothèque, vue 3D, édition, recettes live via
  `recipes.mjs` partagé) — absorbera le banc. Puis Phase 2 (Map réelle branchée sur GameState),
  3 (Combat), 4 (Home). Optimisation possible si besoin réel : meshing par chunks avec culling
  des faces entre piliers voisins (~5-10× de tris en moins). Catalogue `voxels` à ajouter.

## 2026-07-17 (2) — Voxel Phase 0 : générateur de blocs (sans ComfyUI)

### Fait
- **`scripts/voxel/`** : `recipes.mjs` (recettes procédurales JS PUR — partageable avec le futur
  éditeur navigateur ; bruit de valeur **périodique** → tuilage sans couture, cube plein + relief
  ADDITIF dans une marge HEADROOM au-dessus → raccords verticaux garantis), `vox-format.mjs`
  (encode/décode `.vox` MagicaVoxel), `render-iso.mjs` (rendu logiciel iso 2:1 sans GPU — l'outil
  de validation en session), `gen-blocks.mjs` (CLI : **palettes extraites des isotiles existants**
  — face du haut / flancs séparés, quantification 5 bits, accents saturés depuis flowers/mushroom ;
  `--size` (D1, 32 défaut) `--variants` `--only`).
- **11 blocs × 3 variantes** dans `frontend/public/voxels/` : water (dégradé de profondeur +
  vaguelettes), sand, grass (brins + fleurs accent), forest, stone (fissures), snow (étincelles),
  **mist** (banc de nuages moutonné, palette MIST_* de MapScene), dirt, cobblestone (Voronoï
  périodique), brick (appareillage 3D), woodfloor (lames + abouts).
- Previews dans `asset-index/voxels/` : bloc seul, **tuilage 2×2 + empilement** (vérif raccords),
  `SHEET.png` (contact sheet).

### Fonctionnel (vérifié)
- Génération complète sans erreur ; contact sheet inspectée visuellement (style storybook OK,
  raccords 2×2 et vertical sans couture) ; décodage `.vox` round-trip OK (données identiques ;
  seuls les octets alpha de palette inutilisés diffèrent).

### À faire
- Phase 1 : moteur Three.js (`frontend/src/voxel/`) — mesher greedy, InstancedMesh, caméra ortho
  dimétrique, rotation 4 orientations, banc `#voxel-bench`. Puis 1b (éditeur), 2 (Map), 3 (Combat),
  4 (Home), 5 (persos voxel). Ajouter la catégorie `voxels` à `build-catalog.mjs`.

## 2026-07-17 — Plan « carte voxel » (VOXEL-PLAN.md)

### Fait
- **`VOXEL-PLAN.md`** (racine) : plan en 7 phases pour passer Home / Map / Combat sur un **moteur
  voxel 3D unique** (Three.js, caméra ortho dimétrique, rotation 4 orientations). Points clés :
  blocs voxel **générés localement sans ComfyUI** (recettes procédurales + palette extraite des
  `isotiles/`, sortie `.vox`, preview par rendu logiciel Node), terrain en `InstancedMesh`
  (transposition de l'atlas de piliers), personnages en **2 étapes** (billboards PNG puis modèles
  voxel), **déplacements sans animation, case par case**, transition sous flag avec Phaser en
  fallback, budgets perf mobiles étendus. Décisions ouvertes : D1 résolution 32³/64³, D2 meshing
  runtime (recommandé), D3 ordre Combat avant Home (recommandé), D4 flag dans Settings.
- Ajout **Phase 1b — Éditeur voxel** (dev tool à part, façon éditeur de carte / Studio de
  données) : bouton 🧊 titre + `#voxeledit`, bibliothèque des `.vox`, vue 3D orbite + 4
  orientations + tuilage 3×3, édition voxel (poser/effacer/pipette/miroir/palette, undo),
  **recettes live** via module `recipes.mjs` partagé script↔navigateur, autosave localStorage,
  export/import `.vox` ; absorbe le banc d'essai `#voxel-bench`.

### Fonctionnel (vérifié)
- Rien de codé — session de planification uniquement.

### À faire
- Trancher D1–D4 puis démarrer Phase 0 (`scripts/voxel/gen-blocks.mjs` + contact sheet).

---

## 2026-07-16 (3) — Design Claude Phase 3 : overlays en parchemin (+ fix crash TownStatus)

### Fait
- **Système `.settings` rethémé** : voile brun chaud, `.panel-card` = carte parchemin 22px
  (`#fbf5e6→#f0e4c9`, ombre profonde), titres `.banner` en Baloo encre (les ✕✕ décoratifs
  supprimés). **Exception : `.hero-card-screen` garde le thème SOMBRE** (la fiche héros du design
  est sombre). Boutons `.seg` crème (actif vert `#7fa85b`), langgrid/toggle-row/hint au thème.
- **Variante `settings.sheet` (bottom sheet du design)** : collée en bas, coins hauts 26px, liseré
  or, poignée de préhension — appliquée à **État de la ville** et **Journal de la ville**.
- **État de la ville** : cartes de stats crème, panneau défense crème, rapport de vague sur fond
  rouge pâle, mini-bars sur piste brune. **Journal** : lignes crème ombrées, dates estompées.
- **Modale bâtiment** (`.bmenu-modal`) : action principale rouge dégradé, secondaires crème.
- **FIX crash** `TownStatus` : `lastWave.buildingsHit`/`heroesHit` peuvent être `null` (Go
  sérialise les slices vides en null) → `?? []`. L'écran devenait tout noir en ouvrant l'état de
  la ville après une vague sans dégâts listés.

### Fonctionnel (vérifié)
- Screenshots : État de la ville (sheet + rapport), Journal (sheet vide), Paramètres (carte crème),
  modale Puits (actions + chips PA). `tsc -b` OK. Vues iso toujours intactes.

### À faire
- Fiche héros : vérifier/peaufiner le thème sombre du design (attributs, compétences, Évoluer).
- HUD combat (CombatScene) : barres HP crème, journal, barre d'actions du design.
- UI Map : panneau d'actions bas du design (remplace le menu radial ?) — mouvements/boutons
  seulement, rendu iso intouchable.

---

## 2026-07-16 (2) — Design Claude Phase 2b : Structure / Stock / Craft en parchemin

### Fait
- **Rethème complet du système `.panel-screen`** (partagé par Structure, Stock et Craft) : fond
  parchemin radial, en-tête bandeau `#fbf3e0→#f0e2c4` + liseré or (titre en Baloo), boutons de
  tri/catégories crème avec actif **rouge dégradé**, cartes `.ps-row` crème 15px ombrées, icônes
  sur pastille dorée, badge « Lv » brun, bouton d'action vert (texte blanc + inset), barre de
  progression chantier sur piste brune, groupes `PLANS À POSER / CONSTRUITS` en petites capitales
  brunes. Tags : `ttown` doré, `miss` rouge brique ; `ing ok/miss` vert forêt / rouge brique.
- **Stock** : sections héros/Banque en cartes crème, cellules d'objets `item-cell` dorées (qty
  rouge brique), bouton « Déposer le butin » vert stylé, note hors-ville sur crème pointillé.
- **TownWorker** (« PA payés par ») : chips crème, sélectionné = doré liseré or. `TownBar`/`tb-chip`
  passés au thème aussi.
- **Bandeau vague : passé d'overlay absolu au FLUX** entre TopBar et corps (comme le design) — en
  overlay il masquait les filtres de catégories du Stock. La map Phaser se redimensionne proprement
  (Scale.NONE + ResizeObserver), rendu iso inchangé.
- AUCUNE logique touchée : plans/chantiers/prérequis d'arbre techno (Structure), catégories,
  recettes et niveaux de bâtiments (Craft) fonctionnent comme avant.

### Fonctionnel (vérifié)
- Screenshots navigateur des 3 onglets + Home + Map : thème appliqué partout, ville et map iso
  INTACTES, tous les contrôles visibles/cliquables. `tsc -b` OK.

### À faire
- Fiche héros (thème sombre du design), HUD combat, overlays (Paramètres / État de la ville /
  Journal / modale bâtiment) encore en thème sombre ancien.

---

## 2026-07-16 — Design Claude Phase 2a : chrome in-game (TopBar / vague / bottom nav)

### Fait
- **TopBar parchemin** (`TopBar.tsx` + CSS) : avatar = portrait du héros sélectionné (carré arrondi,
  liseré or ; garde le dropdown roster), nom de la partie en Baloo, chip 🏰 % (blanche, texte
  brique ; warn/alert conservés), **chip ⚡ PA cumulés de MON équipe** (dorée — remplace le ⭐ 6/18
  factice), bouton **📋 Journal** (visible si un de mes héros est en ville, ouvre `TownJournal`),
  🔧 et ⚙️ en boutons carrés blancs.
- **Bandeau « PROCHAINE VAGUE »** rouge central (design) rendu par `GameScreen` sur TOUS les onglets,
  en **overlay absolu** (ne réduit pas la zone des vues iso) ; clic → État de la ville. L'ancien
  bandeau « Next wave in » du HomeTab est supprimé.
- **Bottom nav parchemin** : fond dégradé + liseré or, onglet actif en pastille rouge dégradée.
- Rebase de la Phase 1 sur les 21 commits distants (Studio de données, journal de ville, porte
  scellée, Home = carte d'éditeur…) — conflits résolus (TitleScreen garde 🧬 Données ; journal
  fusionné), poussé sur main.

### Fonctionnel (vérifié)
- Partie test au navigateur : Home (ville iso INTACTE, chrome neuf, 📋 présent héros en ville) et
  Map (rendu iso + mer de nuages INTACTS, bandeau vague par-dessus, onglet actif rouge). `tsc -b` OK.

### Contraintes actives (utilisateur)
- Ne pas changer l'apparence isométrique de la ville ni de la map (UI/boutons OK).
- Ne pas toucher à l'éditeur ni au Studio de données (arbres technologiques).

### À faire
- Phase 2b : restyle Structure / Stock / Craft (cartes crème du design).
- Puis : UI Map (panneau d'actions bas), fiche héros sombre, combat HUD, overlays Paramètres/État.

---

## 2026-07-15 (2) — Design Claude appliqué, Phase 1 : thème parchemin + Titre/Lobby/Salon

### Fait
- **Source du design** : le redesign UI complet vit dans un projet Claude Design
  (`claude.ai/design`, projet `3cf38013-68fb-45e6-a319-d4801f8f6b4b`, lisible via l'outil
  DesignSync). Copie de référence extraite dans **`design/EchoTerra.dc.html`** (sections TITLE /
  LOBBY / WAITING ROOM / CLASSEMENT / IN-GAME / HERO SHEET / COMBAT + données du proto dans le
  `<script>` final). Tous les assets qu'il référence existent déjà dans `frontend/public/assets/`.
- **Tokens du thème** (`app-shell.css :root`) : palette parchemin complète (`--parch-0/1/2`,
  `--cream`, `--gold`, `--ink/-2/-soft/-muted`, `--red-hi`, `--accent`, `--navy/-hi`, `--line`…)
  + fonts Google **Baloo 2** (titres, `--font-title`) et **Nunito Sans** (texte, `--font-body`)
  chargées dans `index.html`.
- **Écran Titre** : logo Baloo 2 52px « Echo » encre / « Terra » rouge, losanges décoratifs
  (`--accent`, celui du centre décalé), chip compte avec avatar rond dégradé, **carte « Reprendre
  ta partie »** (nouvelle : lit `echoterra:gameId`, fetch le résumé — nom, jour, 🏰 %, 🌊 compte à
  rebours — clic = `continueTestGame`), menu du design (Solo rouge pulsant `.pill.pulse`,
  Publiques/Privées bleu nuit, rangée Classement/Paramètres `.pill.cream`), oiseau 76px. `.pill`
  global redessiné (rectangles arrondis 18px, dégradés + inset du design) — impacte toute l'app.
- **Lobby** : onglets segmentés 🌍/🎪 (`.lobby-tabs`), retour texte en haut (`.back-link`), logo
  compact sans tagline, cartes crème 18px ombrées, **liste publique à badges** (REJOIGNABLE →
  `x/min` neutre, DÉMARRE rouge, COMPLET) avec icône + statut 2 lignes, création privée (select +
  bouton rouge), rejoindre par code (input + bouton côte à côte).
- **Salle d'attente** : titre Baloo, code en pointillés pleine largeur, bannière verte « Démarrage
  automatique » (publique), rangées joueurs (👑/🤖/💤, rangée « toi » teintée rouge), statut vert
  « Prêt à partir ✓ », boutons Ajouter un bot / ⚔️ Lancer.
- Débordement vertical du Titre réglé : `justify-content: safe center` + `overflow-y:auto` sur
  `.parchment`, ornement avec `padding-top` (l'ombre des losanges se faisait rogner), `.bird`
  `line-height:1`.

### Fonctionnel (vérifié)
- Parcours complet au navigateur (1280×720 + 375×812) : Titre (fonts chargées, styles calculés
  conformes, carte Reprendre avec vraie partie), Lobby publiques (liste + badge depuis le backend)
  et privées, salon privé créé (code TSWSW, bot ajouté → statut vert, kick ✕), salon public rejoint
  (bannière verte, slots 💤). `tsc -b` + `npm run build` OK.

### À faire (suite du design — phases suivantes)
**Contraintes utilisateur (2026-07-16)** : NE PAS toucher à l'apparence isométrique de la ville
(Home) ni de la Map (boutons/mouvements/UI autour OK) — donc pas de Home « îles flottantes » ;
NE PAS toucher à l'éditeur ni au Studio de données (arbres technologiques).
- Phase 2 : chrome in-game (TopBar avatar+PA cumulés+📋, bandeau vague central, bottom nav rouge)
  + restyle Structure/Stock/Craft.
- Phase 3 : UI autour de la Map iso (panneau d'actions bas du design, chips héros), fiche héros
  sombre, combat HUD.
- Mécaniques design encore manquantes (backend) : « Prendre » depuis la Banque, capacité de sac +
  Besace, Classement/scores, rejoindre une publique en cours (Jour 1), régén continue de PA.
  (Journal de la ville et porte qui scelle la ville : DÉJÀ faits dans les sessions parallèles.)

---

## 2026-07-15 (1) — Tétanisé durci + bots diversifiés (secteurs, exploration, prudence)

### Fait
- **Tétanisé (audit + durcissement)** : la règle GDD est confirmée et testée (1 héros tient 4
  créatures, la 5e le submerge ; ceil(count/4) ; Gardien = 3 héros → tient 12). **Nouveau : un héros
  tétanisé ne peut plus NI fouiller NI se cacher** (refus serveur + boutons désactivés dans le menu
  héros et le menu radial) — il lui reste boule de feu, Tir précis, Escape et le combat. Libération
  vérifiée : pack aminci sous le seuil, pack tué, **renfort qui arrive sur la case**, morts/voisins
  ignorés. `tetanise_test.go` (6 tests, 7 seuils).
- **Bots plus humains et moins clones** :
  - `heroBias(id)` : personnalité stable par héros (hachage de l'id) → **secteur boussole préféré**
    (N/S/E/O) + **marge de prudence** pour le retour (0 ou 1 PA d'avance) — l'équipe ne rentre plus au
    même tick et ne marche plus en file indienne.
  - `pickResourceTile` remplace « la case la plus proche » : score distance − richesse + pénalité hors
    secteur, **tirage aléatoire parmi le top 3**, et **évitement des cases où un coéquipier travaille
    déjà**.
  - `pickFrontierTile` : quand la carte connue est épuisée, les bots partent **explorer la frontière du
    brouillard** (chacun dans son secteur) au lieu de tourner en rond en ville.
- **Combat auto des bots renforcé** (le système existait : `botShouldEngage` + `AutoResolve`) :
  - engagement par **estimation de puissance** (PV + 3×force des deux camps) en plus des effectifs —
    une équipe fragile décline un combat perdable ;
  - **les boss (Roi Gobelin, Arbre Ancien) ne sont jamais engagés à moins de 3 héros** ;
  - **garde anti-enlisement** : si AutoResolve n'aboutit pas (garde de 400 tours), les héros se
    replient (`lost`) au lieu de laisser un combat orphelin bloquer toutes les actions de la partie.

### Fonctionnel (vérifié)
- `go test ./...` (6 paquets) : tetanise_test 6/6, 5 nouveaux tests bots (évitement des cases
  occupées, exploration du brouillard, dispersion des cibles, respect des boss, refus au-dessus de ses
  forces) + les 10 tests bots existants inchangés.
- `npx tsc -b`, `npm run build`.

### À faire
- Craft par les bots (dépend de la consommation d'objets) ; hordePower ∝ joueurs.

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
