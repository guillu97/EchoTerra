# Rétention — pourquoi un joueur reviendrait demain

> Exploration de design, 2026-08-09. Le pitch : **jeu communautaire, challenge de survie de groupe**,
> joué en petites sessions (2 par jour) sur plusieurs jours réels.
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

### P4 · Les consignes permanentes — *rendre l'absence survivable*

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

### P7 · Chronique de compte et titres

Une page par compte : mes expéditions, la vague atteinte, le rôle le plus joué, des titres gagnés
(« Gardien de la porte », « Celui qui a relevé les remparts quarante fois »). De l'identité qui
traverse les parties — cosmétique, jamais de la puissance (cf. P5).

### P8 · Saisons

Le classement se remet à zéro périodiquement ; les expéditions publiques appartiennent à une saison.
Peu coûteux, et redonne un enjeu à un tableau qui, sinon, se fige.

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
