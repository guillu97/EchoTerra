# Rétention — pourquoi un joueur reviendrait demain

> Exploration de design, 2026-08-09, **révisée le 2026-08-11** (§7 le bilan, §8 les expéditions
> thématiques, §9 l'ordre de bataille révisé). Le pitch : **jeu communautaire, challenge de survie de
> groupe**, joué en petites sessions (2 par jour) sur plusieurs jours réels.
> Ce document part de ce que le jeu FAIT aujourd'hui, pas de ce qu'on aimerait qu'il fasse.

## 1. L'arithmétique, d'abord

Tout raisonnement sur la rétention part de ces quatre nombres, mesurés dans le code actuel :

| | |
|---|---|
| **Une session** = une vague | 3 héros × 6 PA = **18 PA** à dépenser |
| **Cadence cible** | 2 vagues / jour réel → `WaveInterval` 12 h |
| **Durée d'une partie** | médiane **14-18 vagues**, soit **7 à 9 jours réels** (`cmd/balance -sweep`) |
| **Ce qui persiste après la chute** | une ligne de classement. Rien d'autre. |

Deux conséquences qu'il faut regarder en face :

- **La boucle courte est déjà bonne.** 18 PA, c'est une vraie session de 5 minutes avec des choix
  réels (sortir ou tenir, récolter ou bâtir). La vague joue le rôle du rendez-vous. Ce n'est pas là
  que ça casse.
- **La boucle longue n'existe pas.** Neuf jours de jeu produisent une ligne de tableau, puis tout
  repart de zéro. Dans un jeu où **perdre est la fin prévue**, ce qui reste après la défaite EST le
  méta-jeu — et il est vide.

## 2. Les cinq trous

### T1 — Rien ne survit à la chute

`User{id, email, name, provider}` : un compte ne possède rien. Une ville tombée laisse un
`ScoreEntry`. Le joueur n'a ni trace, ni titre, ni histoire. Après une semaine d'attachement à
Clairmont, Clairmont disparaît sans laisser de trace dans le monde.

### T2 — La contribution individuelle est invisible

La ville a des PV, une défense, une banque. Le joueur a trois héros. **Personne ne peut dire ce que
chacun a fait.** Or dans un jeu coopératif, être vu par le groupe est la récompense principale. Le
journal de la ville s'en approche (il nomme les héros) mais rien n'agrège, rien ne récapitule.

### T3 — La session n'a pas d'énoncé

On se connecte, on a 18 PA, et le jeu ne dit pas ce dont la ville a besoin. L'information EXISTE
(matériaux manquants, packs dans l'anneau, bâtiments abîmés, plans à trouver) mais le joueur doit la
reconstituer lui-même en ouvrant trois onglets. Pour une session de cinq minutes, **cette
reconstitution est le coût d'entrée** — et c'est le meilleur candidat au « je verrai plus tard ».

### T4 — Manquer une session est puni sans recours

Les PA non dépensés sont **perdus** (`h.PA = h.MaxPA` à chaque vague, jamais cumulés). Un héros
resté dehors prend `3 + numéro de vague` de dégâts. Un joueur qui saute une soirée revient à des
héros blessés et une journée de travail évaporée. Pour un jeu explicitement conçu autour de deux
courtes sessions par jour pendant une semaine, le prix d'une soirée manquée est disproportionné.

### T5 — On ne sait pas ce qui arrive

La vague est une surprise. Or depuis que `hordePower = pression + créatures massées dans l'anneau`,
**la prochaine vague est calculable et honnête**. Ne pas l'annoncer, c'est jeter le meilleur crochet
de rétention que le jeu possède : « il y a 40 créatures à nos portes, si personne ne sort on prend
30 PV ».

## 3. Ce qu'il faut construire, par ordre de rapport valeur / effort

### P1 · L'ordre du jour — ✅ **LIVRÉ** (2026-08-09)

> `game/orders.go` : `BuildOrders()`, reconstruit par `Recompute` en DERNIER (il lit les
> coûts qu'on vient de recalculer) · `components/TownOrders.tsx`, replié à sa ligne la
> plus urgente en haut de l'écran du bourg. Tests : `orders_test.go`.

Le Panneau (déjà bâti dès le départ) affiche 2 à 4 lignes **dérivées de l'état**, pas écrites à la
main :

```
⚠ 3 packs dans l'anneau — la prochaine vague frappera à ~34 contre 26 de défense
🧱 Il manque 6 Pierre pour la muraille niveau 2
🚪 Le portail est OUVERT
📐 La Mairie attend son plan (trouvable en forêt)
```

Fonction pure de `GameState` : aucune donnée nouvelle, aucun stockage. Transforme une session vide en
liste de courses. **C'est la réponse directe à T3, et T3 est le trou qui coûte le plus de sessions.**

### P2 · L'annonce de la vague — ✅ **LIVRÉ** (2026-08-09), puis **AMÉLIORÉ**

> `game/orders.go` : `Forecast()` rend une **FOURCHETTE**, pas un chiffre — et sa
> largeur se MÉRITE. Sans Tour de guet on devine (±50 %) ; chaque niveau de Tour
> resserre ; chaque JOUEUR monté observer (`ScoutWave`, 2 PA, route `/town/scout`)
> resserre encore, une fois par joueur et par vague, **pour toute la ville**.
> La première version donnait le chiffre exact et gratuitement : trop généreux, et la
> Tour n'avait aucun rôle au-delà de ses points de défense.

Un encart permanent : `Prochaine vague dans 4 h 12 · horde ~34 · défense 26 · −8 PV attendus`.
Exact, puisque la puissance dérive maintenant des packs présents. Et surtout **actionnable** : nettoyer
deux packs change le chiffre sous les yeux du joueur. C'est ce qui transforme « je me connecterai un
jour » en « il faut que je sorte avant ce soir ».

Coût : un champ dérivé de plus dans le payload. Effet : le rendez-vous devient un enjeu.

### P3 · Le registre de contribution — ✅ **LIVRÉ** (2026-08-09)

> `game/contribution.go` : `credit()` sur six actions (chantier, remparts, dépôt, craft,
> compétence, combat gagné — crédité à TOUTE équipe engagée) · `Ledger()` rend l'ordre
> d'ARRIVÉE, jamais le mérite.

Compteurs par joueur, incrémentés sur les actions qui portent déjà un `heroID` : PA investis en
chantier, objets déposés, créatures abattues dans l'anneau, remparts relevés, camarades dégagés.

Affiché en ville (« ce que la ville te doit ») et surtout **dans le récit de fin de partie**. Cadrage
important : *ce que tu as apporté*, jamais un classement interne — le jeu est coopératif, un tableau
de scores entre coéquipiers y installerait une compétition qui n'a rien à y faire.

Réponse à T2. Coût moyen : une map sur `GameState` et des incréments à six endroits.

### P4 · Les consignes permanentes — ✅ **LIVRÉ** (2026-08-09)

> `game/orders_standing.go` : `SetHeroOrder` (gratuit — c'est une intention) et
> `runStandingOrders`, exécutées juste avant `attackHeroesOutside`. Route
> `/heroes/{id}/order`, boutons dans le menu radial hors de la ville.
> Les trois bornes du plan sont TENUES et testées : une seule vague, jamais de combat
> ni de fouille, et « rentrer » ne part que s'il peut arriver — sinon il se cache, parce
> que brûler ses PA pour finir à découvert est exactement le piège que les bots ont connu.

La fouille automatique (`forage.go`) prouve déjà que le concept marche : un héros posté récolte tout
seul. Il faut la généraliser en **ordre permanent** choisi avant de fermer l'app :

- *récolter ici* (existe déjà) · *se cacher avant la vague* · *rentrer et déposer* · *tenir l'anneau*.

Le cerveau existe déjà : `bots.go`. Un héros humain sous consigne peut emprunter la même logique.

⚠ **À borner sciemment.** Une consigne doit être strictement moins efficace que jouer, ne durer
qu'une vague, et ne jamais engager de combat. Sinon le jeu se joue tout seul et l'on a résolu la
rétention en supprimant le jeu. Ce n'est pas un pilote automatique : c'est un filet.

Réponse à T4.

### P5 · Les ruines de vos villes — ✅ **LIVRÉ** (2026-08-09)

> `game/ruins.go` : `Memorial`, `SeedMemorialRuins`, `Ruin.Epitaph()` · `store.FallenTowns`
> (aucune table de plus : le classement conservait déjà nom, défenseurs et dernière vague) ·
> `api.seedMemorials` à chaque création de monde · épitaphe affichée dans le menu radial.
> Tests : `memorial_test.go`, `TestAFallenTownReappearsAsARuinInTheNextWorld`.

**La proposition dont je suis le plus convaincu.** Une ville tombée devient une **ruine dans les
cartes des parties suivantes** : son nom, la vague où elle est tombée, les noms de ceux qui l'ont
défendue — et un butin, comme les ruines actuelles (`ruins.go` fait déjà tout le travail mécanique).

```
🏚 Ruines de Clairmont — tombée à la vague 19, défendue par Ana, Bo et Zoé
```

Trois raisons d'y croire :

1. Elle répond à T1 **sans transfert de puissance**. Une progression qui rendrait les vétérans plus
   forts casserait l'égalité qui fait tenir une survie de groupe, et ferait des nouveaux des joueurs
   de seconde classe — dans un jeu *communautaire*, c'est rédhibitoire.
2. Le monde finit **littéralement construit par les échecs de la communauté**. C'est le thème du jeu,
   rendu mécanique.
3. Le coût est faible : les ruines existent, il manque un registre des villes tombées et un crochet
   au worldgen.

### P6 · Les requêtes sur le Panneau — ✅ **LIVRÉ** (2026-08-09)

> `game/requests.go` : `PostRequest` / `FillRequest` / `CancelRequest`, routes
> `/town/request` et `/town/request/fill`. Première SORTIE contrôlée de la Banque —
> et elle exige d'être deux. Tests : `requests_test.go`.

Un joueur affiche un besoin (« il me faut 3 Corde »), n'importe qui le sert depuis la Banque, le
journal note qui l'a fait. La réciprocité est la colle sociale la plus solide qui existe, et
l'infrastructure (journal + messagerie) est déjà là.

### P7 · Chronique de compte et titres — ✅ **LIVRÉ** (2026-08-09)

Une page par compte : mes expéditions, la vague atteinte, ce que j'y ai apporté, et des titres
gagnés. De l'identité qui traverse les parties — **cosmétique, jamais de la puissance** (cf. P5).

- **Table `chronicle`** (`store/chronicle.go`), une ligne par (compte, partie), upsertée en même
  temps que la ligne de classement — donc aussi par le BATTEMENT, sinon une ville qui ne survit que
  par le cron n'entrerait dans la chronique de personne. Elle **survit à la suppression de la
  partie**, et c'est tout l'intérêt : c'est justement quand la ville n'est plus là qu'on veut se
  souvenir d'elle. Les anonymes (pas de `Player.UserID`) et les joueurs-IA n'y figurent pas.
- **Ce qu'on garde par expédition** : la ville, le mode, la vague atteinte, et les six colonnes du
  registre de contribution (P3) — PA de chantier, objets rapportés, créatures abattues, PV rendus
  aux remparts, objets fabriqués, requêtes honorées.
- **Titres DÉRIVÉS à la lecture** (`api/chronicle.go`), rien de plus à stocker : douze paliers sur
  six domaines, deux par domaine (un qu'on atteint en une bonne expédition, un qui demande d'y
  revenir — au-delà on tomberait dans le grind, et le jeu se joue deux fois cinq minutes par jour).
  Changer un seuil corrige rétroactivement tout le monde. `GET /api/auth/me/chronicle`, réservé au
  titulaire : **il n'y a pas de chronique publique**, exposer celle des autres transformerait un
  souvenir en palmarès.
- ⚠ **Un titre n'accorde ni PA, ni défense, ni objet** — test dédié (`TestATitleCarriesNoPower`).
  Un vétéran et un débutant qui rejoignent la même ville y arrivent strictement égaux ; c'est cette
  égalité qui fait tenir une survie de groupe.

### P8 · Saisons — ✅ **LIVRÉ** (2026-08-09)

Le classement se remet à zéro périodiquement ; chaque expédition appartient à une saison. Peu
coûteux, et redonne un enjeu à un tableau qui, sinon, se fige : au bout de quelques mois les dix
premières lignes sont tenues par des villes qu'on ne reverra pas, et qui arrive n'a plus rien à
viser — le tableau lui dit seulement qu'il est arrivé trop tard.

- **Une saison = un MOIS civil** (`game/season.go`, identifiant `2026-08`). Une expédition dure une
  dizaine de jours réels à la cadence visée, donc un mois en contient deux ou trois : assez pour
  qu'une saison raconte quelque chose, assez court pour que le tableau ne se fige pas. Et c'est une
  frontière que tout le monde lit sans explication, contrairement à un compteur de semaines depuis
  une époque arbitraire. Les identifiants se trient chronologiquement en tant que chaînes, ce dont
  dépend l'`ORDER BY season DESC` côté base.
- ⚠ **Une partie appartient à la saison où elle a COMMENCÉ**, pas à celle où elle finit. La faire
  changer de saison en cours de route la ferait disparaître du tableau qu'elle disputait, au moment
  précis où elle y monte. C'est aussi ce qui rend la valeur STABLE : `StartedAt` ne bouge plus une
  fois posé, donc chaque réécriture de la ligne (à chaque vague, à chaque battement) recalcule la
  même saison.
- **Colonne `season` sur `leaderboard`** (pas de table de plus). `GET /api/leaderboard?season=` rend
  la **saison en cours par défaut**, `all` le palmarès de tous les temps, un identifiant une saison
  passée — **les précédentes restent consultables** : une remise à zéro qui effacerait le passé
  serait une punition, pas un renouveau. `GET /api/seasons` liste les saisons RÉELLEMENT jouées plus
  celle en cours (même vierge : c'est celle qu'on dispute).
- Les lignes écrites avant l'existence des saisons portent `''` et ne figurent que dans « tous les
  temps » : on ne sait pas à quelle saison les rattacher, et deviner serait pire.
- ⚠ **Rien ne traverse une saison**, comme rien ne traverse une partie (cf. P5, P7) : une saison
  change ce qu'on VISE, jamais ce qu'on a. Et la **chronique de compte ne se réinitialise jamais** —
  effacer le souvenir serait une punition.

## 4. Ce qu'il ne faut PAS faire

- **Récompenses de connexion quotidienne / séries.** Elles punissent exactement la vie que ce jeu
  prétend accommoder. Un joueur qui saute un jour doit revenir sans dette.
- **Progression de puissance entre parties.** Casse l'égalité d'une survie de groupe (cf. P5) et rend
  les nouveaux venus inutiles — mortel pour un jeu qui se vend comme communautaire.
- **Une seconde monnaie d'énergie.** Les PA cadencent déjà le jeu ; en ajouter une n'ajoute que de la
  friction.
- **Du PvP ou de la compétition entre coéquipiers.** Le pitch est la survie de groupe : faire des
  joueurs des adversaires combat la prémisse. Le classement entre VILLES suffit.
- **Les notifications comme crochet principal.** L'horloge des vagues est déjà un rendez-vous ; les
  notifications doivent le servir, pas le remplacer.

## 5. Ce que je ne peux pas mesurer, et ce qu'il faudra regarder

**Le simulateur d'équilibrage joue des bots, pas des gens.** Il sait dire qu'une ville tient 14 à 18
vagues ; il ne saura jamais dire si un joueur revient le quatrième jour. Tout ce document est du
raisonnement de design, pas de la mesure — et il faut le lire comme tel.

Ce que le simulateur PEUT valider, en revanche, et qu'il faudra lui demander :

- que **l'ordre du jour n'est jamais vide ni trivial** à chaque vague d'une partie type ;
- que **l'annonce de vague est exacte** (comparer la prédiction et le `WaveReport` réel) ;
- que les **consignes permanentes** restent nettement moins efficaces que le jeu manuel — sinon P4 a
  supprimé le jeu.

**Le premier chiffre à instrumenter** (les données existent déjà : comptes, `joinedAt`, activité par
partie) : la part des joueurs qui font au moins une session **au jour 3** puis **au jour 7** d'une
expédition. Le jour 3 mesure si la boucle courte accroche ; le jour 7 mesure si le groupe tient. Tant
que ces deux chiffres ne sont pas suivis, tout le reste est une opinion — la mienne comprise.

## 6. Ordre de bataille proposé

1. **P1 + P2** — l'ordre du jour et l'annonce de vague. Peu de code, réponse directe au trou le plus
   coûteux, et les deux se voient dès la première session.
2. **P3 + P6** — le registre de contribution et les requêtes. C'est là que le jeu devient un jeu *de
   groupe* plutôt qu'un jeu solo à plusieurs.
3. **P4** — les consignes permanentes, pour que la vraie vie ne coûte pas la partie.
4. **P5** — les ruines des villes tombées : ce qui donne un sens à neuf jours qui finissent mal.
5. **P7, P8** — identité et saisons, quand il y aura assez de joueurs pour que ça compte.

---

## 7. Bilan au 2026-08-11 — ce que le plan a fermé, et ce qu'il n'a pas fermé

Les huit propositions sont livrées. Les cinq trous de §2 ont donc tous reçu une réponse **côté
serveur** :

| Trou | Réponse | État réel |
|---|---|---|
| T1 · rien ne survit à la chute | P5 mémoriaux · P7 chronique | ✅ fermé, et visible en jeu |
| T2 · la contribution est invisible | P3 registre | ⚠ **calculé, servi, affiché NULLE PART** (voir R1) |
| T3 · la session n'a pas d'énoncé | P1 ordre du jour | ✅ fermé |
| T4 · manquer une session est puni | P4 consignes permanentes | ✅ fermé |
| T5 · on ne sait pas ce qui arrive | P2 prévision + Tour de guet | ✅ fermé |

Mais les trous de §2 étaient ceux de la **session** et de la **fin de partie**. Un cran plus loin,
cinq autres restent ouverts — tous vérifiés dans le code, pas supposés :

### R1 — Le registre de contribution n'est affiché nulle part

`GameState.Contributions` est calculé (`contribution.go`), sérialisé (`contributions` dans le payload,
typé dans `api/types.ts`) et **aucun composant ne le lit** (`grep -r contributions frontend/src/**.tsx`
→ zéro occurrence). P3 disait « affiché en ville, et **surtout dans le récit de fin de partie** » : la
moitié serveur est faite, la moitié qui produit l'effet ne l'est pas. C'est le meilleur rapport
valeur/effort restant du document — la donnée existe, il manque une liste.

### R2 — La fin de partie est un cul-de-sac

`components/GameOver.tsx` : un emoji, une phrase (« tombée à la vague N »), deux boutons. Rien de ce
que le joueur a fait pendant neuf jours, aucun lien vers sa chronique, aucun mémorial promis (« votre
ville hantera les cartes suivantes » — c'est vrai, et personne ne le lui dit). Pire : **« Nouvelle
partie » appelle `newGame()`**, c'est-à-dire `POST /api/games` — la partie **solo legacy 22×22 à trois
héros sans joueurs**. Au moment exact de la ré-engagement, le jeu éjecte le joueur de sa propre boucle
multijoueur. C'est le trou le plus bête de la liste et le plus coûteux : c'est le seul instant où l'on
sait avec certitude que le joueur est là et qu'il vient de finir quelque chose.

### R3 — Toujours aucune instrumentation

§5 le disait déjà : « tant que ces deux chiffres ne sont pas suivis, tout le reste est une opinion ».
Il n'y a toujours ni table d'événements, ni compteur de sessions, ni la moindre trace de `analytics`
dans `backend/internal`. Les données brutes existent pourtant (comptes, `joinedAt`, `Contributions`
qui bougent à chaque action, `updated_at` du classement). **Rétention J3 / J7 par expédition** reste
le premier chiffre à produire, et il ne demande qu'une table d'activité (compte, partie, jour).

### R4 — Le délai avant la première partie

`ensurePublicLobby` maintient **un seul** point d'accueil public à la fois (règle délibérée : ne pas
séparer les joueurs). Conséquence non délibérée : quand l'expédition publique en cours a fermé sa
fenêtre d'accueil, un nouvel arrivant tombe sur un salon vide et doit attendre `minPlayers`. Avec une
population faible — c'est-à-dire aujourd'hui — le premier contact avec le jeu peut être une salle
d'attente. Le mode solo (4 bots) existe et sauve la mise, mais il n'est pas présenté comme le chemin
par défaut d'un nouveau venu.

### R5 — Rien ne distingue l'expédition n°4 de l'expédition n°1

Toutes les propositions livrées répondent à « pourquoi revenir **ce soir** » (P1-P4) ou à « qu'est-ce
qu'il me reste **après** » (P5, P7, P8). Aucune ne répond à **« pourquoi en relancer une »**. Or les
parties sont générées par le même worldgen, avec les mêmes six biomes, la même ville de chaume, les
mêmes cinq ruines et les mêmes onze espèces. Au bout de trois expéditions, la carte n'a plus rien à
raconter — et une saison (P8) qui ne change que le tableau des scores ne raconte rien non plus.

**C'est le trou que les expéditions thématiques adressent, et c'est le bon moment pour lui.**

## 8. P9 · Les expéditions thématiques — une carte qui a un caractère

Idée de Guillaume (2026-08-11) : une partie tire un **thème** — nordique, désertique, … — qui teinte
tout, de la carte à la ville, aux personnages, aux armes et aux crafts.

### Le principe qui rend la chose tenable

> **Un thème est une PEAU et un BIAIS, jamais un jeu différent.** Les six biomes gardent leurs
> identifiants (0..5) et surtout leur **rôle économique** : le biome 3 est *celui qui donne le bois*,
> le biome 4 *celui qui donne la pierre*. Le thème change ce qu'ils sont **à l'écran et dans le
> texte**, et dans quelles **proportions** ils sortent du bruit de Perlin.

Ce n'est pas une prudence de principe, c'est ce que le code impose. Tout est indexé par biome :
`Terrains` (tables de fouille), `Species.Biomes` (apparitions), `ruinDefs` (une ruine et un plan de
spécialité par biome), `ensureNearbyBiomes` + `biomeQuota` (le gisement garanti autour de la ville),
`botShoppingList` (qui cherche littéralement « Bois » et « Pierre »), et tout l'équilibrage. Un thème
« désert » qui **supprimerait** la forêt ne serait pas un thème : ce serait une partie sans bois,
donc sans chantier, donc une défaite arithmétique. Le journal garde déjà deux mesures de ce piège
exact (`biomeQuota` : quand la forêt s'éloigne, la Banque reste à zéro bois du début à la fin, aucune
tour, aucun site). **La palmeraie du désert EST le biome forêt**, avec des palmiers à la place des
sapins et « Bois flotté » à la place de « Bois » *dans le libellé*.

⚠ **Corollaire dur : le renommage est de la PRÉSENTATION.** L'identité d'un objet en Banque
(`Item.Name`) ne change jamais — `buildMaterials`, les 26 recettes, `botShoppingList` et les tests
lisent ces chaînes. Le thème fournit une table `nom d'objet → libellé + icône` appliquée **côté
client**. Un « Bois » reste un « Bois » dans le blob JSON ; il s'affiche « Bois flotté » sur un thème
désert.

### Ce qu'un thème définit

1. **Identité** : id, nom, emoji, une ligne d'ambiance (affichée au salon et sur l'écran titre de la
   partie).
2. **Le mélange de biomes** : les seuils de `biomeFromLevel` deviennent un paramètre du thème.
   Tempéré = les seuils actuels ; Nordique = neige et forêt dominantes, sable réduit ; Désert = sable
   dominant, forêt réduite **mais jamais absente** (elle reste la source de bois, et
   `ensureNearbyBiomes` garantit déjà le gisement de proximité).
3. **Les noms de biomes** : forêt → « Taïga » / « Palmeraie » ; montagne → « Fjord » / « Falaise de
   grès » ; neige → « Glacier » / « Désert de sel ».
4. **Les ruines** : `ruinDefs` est **déjà** une table biome → ruine. Un thème n'a qu'à fournir la
   sienne : Pyramide (sable), Sphinx enseveli (grès), Nécropole (palmeraie) ; côté nordique
   Drakkar échoué, Hall de jarl, Pierre runique. ⚠ **Chaque thème doit distribuer les mêmes plans**
   (les cinq spécialités + Mairie/Tour/Cuisine/Recyclerie/Poste), sinon des bâtiments deviennent
   inatteignables selon le tirage — test obligatoire : *tout plan reste obtenable sur chaque thème*.
5. **Le bestiaire** : pondération des espèces existantes par thème (givre et loups au nord, harpies
   et araignées au sud) plus, à terme, une espèce propre. ⚠ le pool doit garder **au moins un boss**
   et couvrir toutes les vagues, sinon `spawnWaveMonsters` s'assèche.
6. **La peau voxel** : le mesher lit `model.palette` **par modèle** (`mesher.ts`), donc un thème peut
   être un **remap de palette appliqué au chargement du `.vox`** — zéro nouveau fichier pour un
   premier jet, toiture, bois et pierre changent de teinte partout à la fois. ⚠ piège déjà mesuré
   (CLAUDE.md) : `shade()` est divisionniste, un quasi-neutre vire au **violet** — les palettes de
   thème doivent rester à chroma ≥ ~40.
7. **La ville** : `townLayout.ts` génère déjà tout (tertre, palissade, route en lacet, ~28 maisons).
   Le thème change la palette, **le modèle de la halle sommitale** (Meduseld → temple à colonnes,
   longue maison à proue sculptée) et deux ou trois décors. La géométrie polaire ne bouge pas.
8. **Le décor** : `scatter.ts` porte des tables de props par biome — elles deviennent des tables par
   (thème, biome). Cactus, ossements, palmiers, dunes ; sapins givrés, cairns, drakkars.
9. **Une arme et une recette** : un `EquipDef` et une entrée de `Recipes` par thème (hache de
   guerre = archétype `epee`, khopesh = `epee`, harpon = `lance`). ⚠ **latéral, jamais supérieur** —
   même règle que les techniques d'arme : aucun thème ne doit être le « bon » thème.

### Ce qu'un thème ne change JAMAIS

- La cadence (`WaveInterval`), les PA, la formule de horde, le plafond de garnison.
- Les identités d'objets et de bâtiments (cf. le corollaire ci-dessus).
- **Le plancher de survie.** `balance.Config` gagne un champ `Theme` et `SurvivalFloor = 12` doit
  tenir **sur chaque thème et à 1·4·12·20 joueurs**. C'est le seul garde-fou qui empêche un thème
  d'être injouable, et il existe déjà : `go -C backend run ./cmd/balance -sweep` par thème.
- Le principe d'égalité de P5/P7 : un thème est un **tirage**, jamais une récompense. On ne débloque
  pas un thème, on tombe dessus.

### Pourquoi ça sert la rétention (et ce que ça ne fait pas)

Un thème ne donnera **aucune raison de se connecter ce soir** — c'est P1/P2/P4 qui font ça. Il donne
une raison **d'en relancer une**, ce qui est exactement R5, et il nourrit trois systèmes déjà en
place, sans code neuf :

- **la chronique et les titres** (P7) : « survivant du Grand Erg », « a tenu 19 vagues en Nordique » ;
- **les saisons** (P8) : une saison peut mettre un thème en avant — un tableau qui change de décor
  chaque mois plutôt qu'un tableau qu'on remet à zéro ;
- **les mémoriaux** (P5) : une ruine de ville sous les dunes ne ressemble pas à une ruine sous la
  neige, et l'épitaphe existe déjà.

### Découpage proposé, du moins cher au plus cher

| Lot | Contenu | Coût | Ce qu'on voit |
|---|---|---|---|
| **1 · l'ossature** | `game/theme.go` (`ThemeDef`, `Themes`, `GameState.ThemeID` tiré de la graine), seuils de biome paramétrés, noms de biomes, `ruinDefs` par thème, pondération d'espèces, `balance.Config{Theme}` + sweep par thème | **faible**, backend pur, **aucun asset** | des cartes reconnaissables, des ruines différentes, le thème au salon et dans le classement |
| **2 · la peau** | remap de palette au chargement `.vox`, palette de biomes (`game/render.ts`), libellés d'objets/biomes côté client, halle sommitale par thème | **moyen**, front | la ville et la carte changent de caractère |
| **3 · le contenu** | props par thème (`gen-props.mjs`), modèle de pyramide/sphinx/drakkar, 1 arme + 1 recette par thème, 1 espèce par thème | **élevé et incrémental** — c'est de l'art, il se livre thème par thème | le thème devient un lieu |

Le lot 1 seul suffit à répondre à R5 et il est testable par la simulation. Les lots 2 et 3 peuvent
suivre thème par thème sans jamais bloquer le jeu.

### Le thème change aussi le JEU — pas seulement la peau (précision de Guillaume, 2026-08-11)

Un thème qui ne serait qu'une palette s'userait en deux expéditions. Chaque thème porte donc **une
contrainte de survie** : quelque chose que cette terre exige et qu'aucune autre n'exige.

#### D'abord : « dominant » ne veut pas dire « monochrome »

Le thème décide du biome qui **entoure la ville**, pas du monde entier. Concrètement, le tirage de
biome reçoit un **champ de biais centré sur le bourg et décroissant avec la distance** (portée ~ la
moitié de la carte) : neige partout autour de la ville en Nordique, sable en Désertique — et au loin,
la carte redevient elle-même, avec ses montagnes, ses forêts et ses lacs.

Deux conséquences, l'une voulue et l'autre obligatoire :

- **Voulue** : la variété devient *lointaine*, donc elle se mérite. « Il faut descendre au sud pour
  trouver du sable » — c'est-à-dire pour trouver l'épave, donc le Plan du Cartographe. Le thème
  devient un moteur d'exploration, ce que la prospection des bots peine à produire seule.
- ⚠ **Obligatoire** : **la garantie l'emporte toujours sur le thème.** `ensureNearbyBiomes` continue
  de creuser son gisement de forêt ET de montagne dans le rayon 8 du bourg, thème ou pas. Une carte
  nordique, c'est de la neige à perte de vue **plus** un bosquet et une carrière garantis. Sans ce
  principe on rejoue la famine déjà mesurée deux fois (banque à zéro bois, aucun chantier, défaite
  arithmétique). Et un second garde-fou : **chaque biome doit rester présent au-dessus d'un seuil
  minimal de tuiles**, sinon `SeedRuins` saute ce biome et le plan de spécialité qu'il porte
  disparaît de la partie.

#### Le contrat d'une contrainte de thème

Six règles, qui viennent toutes de mécaniques déjà en place :

1. **Elle branche un système qui EXISTE.** Pas de seconde monnaie d'énergie (§4 l'interdit), pas de
   nouvelle boucle : on allume ce qui est déjà câblé.
2. **Elle est COLLECTIVE et se règle en ville.** Le jeu est une survie de groupe : une contrainte doit
   créer une charge partagée, pas une taxe individuelle.
3. **Elle se paie en PA ou en matériaux déjà récoltés**, donc elle entre en **concurrence directe avec
   la défense**. C'est là qu'est le jeu : le bois qui chauffe est le bois qui bâtit.
4. **Elle est ANNONCÉE** — par l'ordre du jour (P1) et la prévision (P2). Sur un jeu à deux sessions
   par jour, une contrainte surprise est une punition, pas une tension.
5. **Elle ne piège jamais un joueur absent** (T4). Elle ne doit ni bloquer le retour en ville, ni tuer
   un héros posté ; les consignes permanentes (P4) doivent rester une réponse valable.
6. **Elle passe le plancher.** `SurvivalFloor = 12` sur **chaque thème** et à 1·4·12·20 joueurs, via
   `balance.Config{Theme}`. Une contrainte non simulée est une contrainte non livrable.

#### Nordique — le froid

Deux faces d'une même idée : dehors la neige, dedans le feu.

- **La neige recouvre les cases.** Un champ `Tile.Covered` (bool, `omitempty`), posé par une passe de
  chute de neige à chaque vague — à côté de `regrowOrchard`, qui a exactement cette forme. Une case
  couverte **ne peut plus être fouillée** : `canForage` la refuse, donc **la fouille automatique
  s'interrompt**. C'est le point le plus intéressant du thème : la neige est la réponse mécanique au
  reproche qu'on peut faire au campement (poster un héros et ne plus jouer). Elle se déneige pour
  **1 PA**, et ⚠ **déneiger REND une ressource à la case** (même geste que le Verger) — sinon la neige
  n'est qu'un impôt ; là, c'est un arbitrage : je dégage ce filon ou je marche jusqu'à un autre.
  Elle ne bloque **jamais** le déplacement et ne blesse personne (règle 5).
- **Le brasier central.** Un bâtiment `brasier` **debout au départ** (comme le puits), qui **brûle du
  bois ou du charbon à chaque vague**. Tant qu'il brûle, les murs protègent du froid ; **éteint**, les
  héros — y compris ceux qui sont rentrés — prennent `Gelé` : **−2 PA à la vague suivante**. Un héros
  qui passe la vague DEHORS prend `Gelé` de toute façon ; rentrer près du feu le purge. Le dilemme de
  Hordes (sortir ou tenir) gagne ainsi une seconde raison de rentrer, au lieu d'une mécanique de plus.
- ⚠ **Le thème doit financer sa propre contrainte.** Le bois est déjà la matière la plus disputée
  (mesuré : banque à zéro bois sur les grandes cartes). En Nordique la taïga en donne davantage et le
  **Charbon** devient un combustible de plein droit. Sans ce contrepoids, on ne crée pas une tension,
  on crée une défaite programmée — et c'est précisément ce que le sweep par thème doit trancher.

#### Désertique — l'eau

**Le cadeau du désert : la Soif n'existe pas.** `StateSoif` est déclaré, retiré par la boisson, par le
`Jus de fruit`, par l'`Élixir de givre`, consulté par les bots… et **jamais posé par personne** (rien
dans le code de jeu ne fait `AddState(StateSoif)` — seuls trois tests le font). Tout un sous-système
est déjà bâti autour d'un état qui n'arrive jamais : les rations du puits, `DrewWaterDay`, la
capacité par niveau (50/75/112), le +10 par vague, et jusqu'à l'effet de la **Cuisine niveau 2**
(`dailyWaterAllowance`, une seconde ration par jour). Aujourd'hui le puits est un distributeur gratuit
de +6 PA ; il n'est une contrainte pour personne.

Le thème désert ne fait donc **rien construire, il allume**.

- **Un héros qui n'a pas bu de la journée prend `Soif` à la vague.** Effet : **−2 PA au réveil** — la
  soif ralentit, elle ne tue pas (règle 5), et elle se paie dans la monnaie du jeu.
- **Le puits redevient un enjeu** : recharge naturelle réduite, donc il faut **aller chercher l'eau**.
  Symétrique exact de la neige : un champ de tuile `Oasis`, posé par le worldgen, **fouillable en
  Rations d'eau** qu'on rapporte au puits. Une plomberie, deux thèmes, des signes opposés — l'un
  retire, l'autre donne.
- **Monter le puits entre en concurrence avec la muraille** (règle 3), et la Cuisine niveau 2 prend
  enfin un sens. Aucun système neuf : trois valeurs et un producteur d'état.

#### Ce que ça change au découpage

Le **lot 1** gagne la contrainte de chaque thème (elle est backend, sans asset : un champ de tuile,
une passe par vague, un producteur d'état, un bâtiment) et **ne se livre qu'avec son sweep**
`cmd/balance`. Ma recommandation : livrer les thèmes **un par un, contrainte comprise**, plutôt que
trois peaux d'un coup — un thème dont la contrainte n'a pas été simulée est une partie perdue
d'avance pour ceux qui le tirent. Et ⚠ le classement gagne une colonne **`theme`** (même schéma que
`mode`) : comparer une ville nordique et une ville désertique n'a de sens que si l'on sait laquelle
est laquelle.

### Thèmes de départ suggérés

**Tempéré** (l'actuel, qui devient un thème parmi d'autres et sert de référence d'équilibrage),
**Nordique** (neige/forêt, fjords, loups-garous et givre), **Désertique** (sable/grès, pyramides et
sphinx, harpies et araignées), puis — quand les deux premiers auront prouvé le pipeline —
**Volcanique** (basalte, cendre : les blocs `ash`/`basalt` existent déjà dans `public/voxels/`) et
**Marécage**.

## 9. Ordre de bataille révisé (2026-08-11)

1. **R1 + R2 — le récit de fin de partie.** Afficher le registre (P3) en ville et surtout à la chute,
   dire au joueur que sa ville va hanter les cartes suivantes, et remplacer « Nouvelle partie » par
   *rejoindre une expédition* (le flux public/solo, pas la partie legacy 22×22). Petit code, et c'est
   le seul instant où l'on tient le joueur à coup sûr.
2. **P9 lot 1 — l'ossature des thèmes.** Backend pur, sans asset, validé par `cmd/balance`.
3. **R3 — l'instrumentation.** Une table d'activité, puis J3/J7 par expédition. Sans elle, la suite
   de ce document reste une opinion.
4. **P9 lots 2 et 3** — la peau puis le contenu, thème par thème.
5. **R4 — le temps avant la première partie.** À traiter quand on saura, par R3, s'il coûte
   réellement des joueurs.
