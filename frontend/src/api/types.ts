// TypeScript mirror of the Go API DTOs (kept in sync by hand for the prototype).

export enum Biome {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Forest = 3,
  Mountain = 4,
  Snow = 5,
}

export interface Stats {
  force: number;
  dexterite: number;
  agilite: number;
  endurance: number;
  athletisme: number;
  precision: number;
  // PERCEPTION : jusqu'où on voit — rayon de brouillard sur la CARTE et portée d'œil
  // en COMBAT (backend game.go). Optionnelle : une partie enregistrée avant la
  // statistique ne la porte pas.
  perception?: number;
}

// One line of the town journal (Panel building) — mirrors game.TownLogEntry.
export interface TownLogEntry {
  at: string; // RFC3339 timestamp
  day: number;
  text: string;
}

// One message of the town board — mirrors game.ChatMessage. It NEVER arrives in
// the game payload (ClientView strips it, only town.chatCount survives): reading
// is gated per player, so the content comes from GET /town/chat.
export interface ChatMessage {
  id: string;
  at: string; // RFC3339 timestamp
  day: number;
  playerId: string;
  author: string;
  text: string; // already moderated server-side
  filtered?: boolean; // moderation masked at least one word
  remote?: boolean; // sent from the field, through the Poste
}

export interface Item {
  type: string;
  name: string;
  qty: number;
}

export interface Tile {
  biome: Biome;
  height: number;
  resources: number;
  monsterId?: string;
  ruinId?: string; // ruine-donjon posée sur la case (voir Ruin)
  // BROUILLARD À TROIS ÉTATS (backend fog.go), modèle Warcraft III :
  //   discovered=false            → jamais vue. Noir, tuile vierge.
  //   discovered=true, visible=false → SOUVENIR : le terrain est là, on le dessine
  //                                    sous un voile sombre ; rien de vivant n'est servi.
  //   visible=true                → sous les yeux de quelqu'un : tout est là.
  // ⚠ La mémoire est PAR JOUEUR — `discovered` veut dire « MOI je m'en souviens ».
  // ⚠ `visible` est ABSENT quand il est faux (le serveur l'omet : l'écrire sur chaque
  // tuile coûterait des centaines de ko par rafraîchissement). Tester `!t.visible`,
  // jamais `t.visible === false`.
  discovered?: boolean;
  visible?: boolean;
  towerId?: string; // belvédère (chantier ou bâti) posé sur la case (voir Watchtower)
  // NEIGE FRAÎCHE (thème nordique, backend cold.go) : la case n'est plus récoltée
  // automatiquement tant qu'un héros n'est pas revenu la fouiller.
  covered?: boolean;
}

// Ruine-donjon : bâtiment en ruine par biome — chantier de déblayage collectif
// (PA partagés) puis donjon à charges au butin rare.
export interface Ruin {
  id: string;
  type: string; // ferme | epave | sanctuaire | mine | tour | memorial
  name: string;
  icon: string;
  x: number;
  y: number;
  clearPa: number;
  paInvested: number;
  cleared: boolean;
  charges: number;
  // MÉMORIAL : une ruine qui fut la ville d'une VRAIE expédition précédente. Elle porte
  // son nom, la vague qui l'a emportée et ceux qui l'ont défendue (game/ruins.go).
  fellAtWave?: number;
  defenders?: string[];
}

// L'épitaphe d'un mémorial — « Tombée à la vague 19, défendue par Ana, Bo et Zoé ».
// Vide pour une ruine ordinaire. Miroir de Ruin.Epitaph() côté serveur.
export function ruinEpitaph(r: Ruin): string {
  if (!r.fellAtWave) return "";
  const d = r.defenders ?? [];
  if (d.length === 0) return `Tombée à la vague ${r.fellAtWave}. Nul ne se souvient de ses défenseurs.`;
  const names = d.length === 1 ? d[0] : `${d.slice(0, -1).join(", ")} et ${d[d.length - 1]}`;
  return `Tombée à la vague ${r.fellAtWave}, défendue par ${names}.`;
}

// Une ligne de l'ordre du jour : ce que la ville demande, maintenant.
export interface TownOrder {
  kind: "threat" | "gate" | "repair" | "material" | "plan" | "chantier" | "wear";
  icon: string;
  text: string;
  urgent: boolean; // coûte des PV à la PROCHAINE vague, par opposition aux suivantes
}

// Ce que la prochaine vague fera si personne ne bouge. `besieging` est le levier : ces
// créatures-là entrent dans la puissance de la horde, donc les tuer fait baisser
// `horde` sous les yeux du joueur.
export interface WaveForecast {
  // La horde s'annonce en FOURCHETTE : on l'estime, on ne la lit pas. Sa largeur est
  // ce que la ville a gagné — sa Tour de guet, et les joueurs montés observer.
  min: number;
  max: number;
  defense: number;
  besieging: number;
  damageMin: number;
  damageMax: number;
  fatal: boolean; // même au mieux, la ville n'y survit pas
  atRisk: boolean; // au pire, elle n'y survit pas
  precision: number; // 0-100
  tower: number; // niveau de la Tour (0 = pas de tour)
  scouts: number; // joueurs ayant estimé cette vague
}

// Un besoin affiché au Panneau. La seule sortie de la Banque vers un joueur — et elle
// exige d'être deux : un qui demande, un qui sert.
export interface TownRequest {
  id: string;
  playerId: string;
  author: string;
  item: string;
  qty: number;
  wave: number;
  at: string;
  filledBy?: string; // "" / absent = encore ouverte
}

// Ce qu'un joueur a apporté à cette ville. JAMAIS trié par mérite (voir contribution.go).
export interface Contribution {
  playerId: string;
  name: string;
  buildPa: number;
  deposited: number;
  slain: number;
  repaired: number;
  crafted: number;
  filled: number;
}

export interface Hero {
  id: string;
  name: string;
  x: number;
  y: number;
  pa: number;
  maxPa: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  class: string;
  states: string[];
  inventory: Item[];
  bars: Record<string, number>;
  drewWaterDay: number;
  // FRANCHISSEMENT : l'écart de hauteur que ce héros passe d'un pas sur la carte
  // (backend climb.go). ⚠ SERVI, JAMAIS RECALCULÉ ICI : la valeur dépend de
  // l'athlétisme ET de l'équipement porté, or les bonus d'équipement ne sont pas
  // dans `stats` — un miroir client-side devrait relire le catalogue d'équipement et
  // divergerait au premier objet ajouté. Le serveur décide, on affiche.
  climb?: number;
  // CONSIGNE PERMANENTE : ce que le héros fera tout seul juste avant la prochaine
  // vague si son joueur n'est pas revenu. Ne dure qu'UNE vague, n'engage jamais de
  // combat — un filet, pas un pilote automatique (backend orders_standing.go).
  order?: "" | "shelter" | "return";
  // Échéance de la prochaine FOUILLE AUTOMATIQUE (absent = le héros n'est pas
  // installé à récolter). La première fouille, payée 1 PA, l'installe ; la suite
  // est jouée par la simulation serveur, même sans personne connecté.
  forageAt?: string; // RFC3339
  // ÉQUIPEMENT PORTÉ (backend equipment.go) : l'objet quitte le sac tant qu'il est
  // porté, et y revient quand on le retire.
  weapon?: string;
  gear?: string;
  classId: string;
  classTier: number;
  classBonuses: Stats;
}

// Class-evolution catalog (mirrors backend internal/game/classes.go).
export interface ClassSkill {
  name: string;
  scope: "map" | "iso";
  pa: number; // activation cost (0 = passif)
  desc: string;
  effects?: string;
}

export interface ClassDef {
  id: string;
  name: string;
  tier: number; // 1 = intermediate, 2 = advanced
  day: number; // game.day gate
  requires: string[] | null; // parent class ids (any-of; empty = from Sans classe)
  role: string;
  bonuses: Stats;
  paBonus: number;
  skills: ClassSkill[];
  appearance: { map: string; icon: string }; // character asset files (char-*)
}

export interface Monster {
  id: string;
  species: string;
  appearance?: string; // monsters/ asset file (mob-*)
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  count: number;
}

export interface BuildReq {
  pa: number;
  materials: Item[];
  plan?: string; // blueprint item name required to open a fresh site ("" for upgrades)
}

export interface TownBuilding {
  id: string;
  name: string;
  built: boolean;
  underConstruction: boolean; // an open chantier (plan laid; visible on Home)
  paInvested: number; // labour poured into the open chantier so far (cost.pa = total)
  level: number;
  durability: number;
  maxDurability: number;
  capacity: number;
  maxCapacity: number;
  open: boolean;
  defense: number;
  cost: BuildReq;
  requires?: { building: string; level: number }[]; // tech-tree prerequisites
}

export interface Recipe {
  id: string;
  name: string;
  category: string;
  building: string;
  buildingLevel: number; // minimum level of that building (town crafts)
  outputType: string;
  outputName?: string;
  outputQty?: number;
  field: boolean; // craftable outside town
  paCost: number;
  ingredients: Item[];
  effects?: string;
  // LA FAVEUR DES DIEUX que fabriquer cet objet verse à la ville (backend mythic.go).
  // En pratique la catégorie « deco » : orner le bourg est ce qui attire leur regard.
  favor?: number;
}


export interface WaveHit {
  id: string;
  name: string;
  delta: number;
}

export interface WaveReport {
  wave: number;
  day: number;
  hordePower: number;
  defense: number;
  townDamage: number;
  townHpAfter: number;
  buildingsHit: WaveHit[];
  heroesHit: WaveHit[];
  monstersSpawned: number;
  at: string;
  gameOver: boolean;
}

// A human participant in one game (lobby/multiplayer). Each player owns a team of
// 3 heroes (GDD: 1 joueur = 3 héros).
export interface Player {
  id: string;
  name: string;
  heroIds: string[];
  host: boolean;
  bot: boolean; // computer-controlled player (added by the host in the lobby)
  userId?: string; // linked account (multi-device reconnect)
  joinedAt: string;
}

// A user account ("savoir qui est qui"). Email+password today; provider leaves room
// for Google OAuth (free) — Apple Sign-In is paid and not planned.
export interface User {
  id: string;
  email: string;
  name: string;
  provider: string;
}

// GET /api/auth/me/games: my games with my player id, for any-device resume.
export interface MyGameSummary extends GameSummary {
  myPlayerId: string;
}

// CE QUI SE CONSOMME (GET /api/items, backend game/items.go). La table vient du serveur
// et n'est pas recopiée ici : deux catalogues finiraient par diverger. ⚠ la FAIM n'existe
// pas dans le jeu — un plat rend des POINTS D'ACTION, la vraie monnaie d'une journée.
export interface ItemEffect {
  pa?: number; // PA rendus
  hp?: number; // PV rendus
  clears?: string[]; // états retirés
  clearsAll?: boolean; // retire TOUS les états (Ambroisie)
  desc?: string; // ce que le joueur lit
}

export type ItemEffects = Record<string, ItemEffect>;

// CE QUI SE PORTE (GET /api/equipment, backend game/equipment.go). Deux emplacements
// seulement — une ARME et un ÉQUIPEMENT — pour qu'un choix se pose sans devenir un jeu de
// gestion d'inventaire. ⚠ les bonus sont PRÊTÉS à l'unité de combat, jamais greffés sur
// les statistiques du héros.
export interface EquipDef {
  slot: "arme" | "equipement";
  force?: number;
  dexterite?: number;
  agilite?: number;
  endurance?: number;
  armor?: number; // dégâts subis en moins
  reach?: number; // portée de l'attaque de base (0 = mêlée)
  rangedStat?: string;
  vsCursed?: number;
  desc: string;
}

export type Equipment = Record<string, EquipDef>;

// LES SAISONS (GET /api/seasons, backend game/season.go) — un classement cumulatif se
// FIGE : au bout de quelques mois les premières lignes sont tenues par des expéditions
// qu'on ne reverra pas, et qui arrive n'a plus rien à viser. Une partie appartient à la
// saison où elle a COMMENCÉ (elle dure une dizaine de jours réels : la faire changer de
// saison en route la ferait disparaître du tableau qu'elle dispute). Les saisons passées
// restent consultables, et la chronique de compte ne se réinitialise jamais.
export interface Season {
  id: string; // "2026-08"
  label: string; // "Saison d'août 2026"
  current: boolean;
}

export interface SeasonList {
  current: string;
  seasons: Season[];
}

// LA CHRONIQUE DE COMPTE (GET /api/auth/me/chronicle, backend api/chronicle.go) — ce
// qu'un compte garde des villes qu'il a vues tomber. ⚠ COSMÉTIQUE : un titre n'a jamais
// d'effet en jeu. Deux joueurs qui rejoignent la même expédition y arrivent égaux.
export interface ChronicleRun {
  gameId: string;
  townName: string;
  mode: "solo" | "public" | "private";
  playerName: string;
  days: number;
  waves: number;
  monstersKilled: number; // de la VILLE (score partagé)
  gameOver: boolean;
  // ce que CE joueur y a apporté
  buildPa: number;
  deposited: number;
  slain: number;
  repaired: number;
  crafted: number;
  filled: number;
  updatedAt: string;
}

export interface ChronicleTotals {
  runs: number;
  bestWave: number;
  days: number;
  buildPa: number;
  deposited: number;
  slain: number;
  repaired: number;
  crafted: number;
  filled: number;
}

export interface Title {
  id: string;
  name: string;
  icon: string;
  desc: string;
  value: number; // où en est le joueur
  need: number; // le seuil
  got: boolean;
}

export interface Chronicle {
  runs: ChronicleRun[];
  totals: ChronicleTotals;
  titles: Title[];
}

// Lightweight game listing DTO returned by GET /api/games. Join codes are never
// listed (private lobbies are joined by sharing their code out-of-band).
// Compte rendu d'UN tour de rattrapage (POST /{id}/catchup, backend api/catchup.go).
// Volontairement maigre : la boucle du retour tourne là-dessus, et ne recharge l'état
// complet de la partie qu'une fois, à l'arrivée.
export interface CatchUpResult {
  done: boolean; // plus rien à rattraper
  waves: number; // vagues rejouées par CET appel
  skipped?: number; // vagues sautées (au-delà du plafond de retard, 12 h)
  waveNumber: number;
  townHp: number;
  status: "lobby" | "active" | "gameover";
  nextWaveAt?: string;
}

export interface GameSummary {
  id: string;
  name: string;
  status: "lobby" | "active" | "gameover";
  visibility: "private" | "public";
  players: Player[];
  minPlayers: number;
  maxPlayers: number;
  day: number;
  waveNumber: number;
  createdAt: string;
  // Fenêtre d'accueil : une expédition publique LANCÉE reste rejoignable quelques
  // vagues (game.PublicJoinGraceWaves côté serveur). joinWavesLeft ne vaut que pour
  // une partie déjà en cours — un salon vaut 0 parce qu'il n'a pas encore commencé.
  joinOpen: boolean;
  joinWavesLeft: number;
  // La NATURE de l'expédition (backend theme.go) : c'est ce qui distingue une carte
  // d'une autre. Absent sur une partie d'avant les thèmes.
  themeId?: string;
  theme?: Theme;
}

// Une NATURE d'expédition. Un thème est une PEAU et un BIAIS : il décide du biome qui
// entoure la ville et du nom des terrains, jamais des règles (voir backend theme.go).
export interface Theme {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  dominant: number; // biome dominant autour de la ville
  biomeNames?: Record<string, string>;
  // Le PANTHÉON de cette terre (backend mythic.go) : grec par défaut, nordique au nord,
  // égyptien au sud. Il voyage dans le payload plutôt que d'être recopié ici — une copie
  // client divergerait au premier dieu ajouté.
  pantheon?: Pantheon;
}

// Un dieu du panthéon. `domain` est ce que sa bénédiction FAIT : les trois panthéons
// servent les mêmes trois domaines, donc aucun tirage de carte ne donne de meilleurs
// dieux qu'un autre (règle des thèmes : latéral, jamais supérieur).
export interface God {
  id: string;
  name: string;
  icon: string;
  domain: "rempart" | "moisson" | "lame";
  boon: string; // l'effet en clair — ce qu'on lit avant de voter
  tagline: string; // la légende
}

export interface Pantheon {
  id: string;
  name: string;
  favor: string; // l'icône du compteur (⚡ grec, 🔨 nordique, ☥ égyptien)
  temple: string; // le nom du Temple sous ce panthéon
  gods: God[];
}

// Une bénédiction EN COURS. `untilWave` est le numéro de la dernière vague couverte :
// on compte en vagues et jamais en heures, comme tout ce qui traverse un rattrapage.
export interface ActiveBlessing {
  godId: string;
  name: string;
  icon: string;
  domain: string;
  untilWave: number;
}

// Nature d'une partie au classement : les trois ne se comparent pas (un run solo
// avec 4 bots ne joue pas comme une expédition publique à quatre humains).
export type LeaderboardMode = "solo" | "public" | "private";

// One town's record on the leaderboard (GET /api/leaderboard[?mode=]): survival and
// monsters slain, kept server-side even after the game itself is purged.
export interface ScoreEntry {
  gameId: string;
  townName: string;
  gameName: string;
  mode: LeaderboardMode;
  players: string[];
  days: number;
  waves: number;
  monstersKilled: number;
  gameOver: boolean;
  updatedAt: string;
  season: string; // "" pour les villes d'avant les saisons (hors concours)
  theme: string; // nature de l'expédition ; "" pour les villes d'avant les thèmes
}

export interface GameState {
  id: string;
  name?: string;
  seed: number;
  width: number;
  height: number;
  tiles: Tile[];
  heroes: Hero[];
  monsters: Record<string, Monster>;
  day: number;
  wave: number;
  waveNumber: number;
  nextWaveAt: string;
  // Le serveur n'est PAS à jour : des vagues restent dues qu'il n'a pas eu le
  // budget de rejouer dans cette requête (game.RequestBudget). Le client
  // redemande alors tout de suite au lieu d'attendre son sondage de 20 s — voir
  // `refreshGame` dans store.ts. Absent = le monde est à l'heure.
  catchUp?: boolean;
  // L'heure à laquelle un salon public partira quand même, avec une escorte de
  // joueurs-IA (backend lobby.go MaybeStartWithEscort). Absent hors de ce cas.
  escortAt?: string;
  status: "lobby" | "active" | "gameover";
  joinCode?: string;
  themeId?: string; // nature de l'expédition (theme.go) ; absent = tempéré
  theme?: Theme; // catalogue du thème, posé par ClientView — rien à charger côté client
  visibility?: "private" | "public"; // absent/"private" = player-created; "public" = server-created, auto-starts
  solo?: boolean; // partie solo (1 humain + bots) — classée à part au leaderboard
  minPlayers: number;
  maxPlayers: number;
  players: Player[];
  createdAt: string;
  startedAt?: string;
  kickVotes?: Record<string, string[]>; // public lobbies: target player id -> voter ids
  lastWave?: WaveReport;
  monstersKilled: number; // total creatures slain (leaderboard achievement)
  town: {
    name: string; // generated town name (server-side, townnames.go)
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    defense: number; // bâtiments + garnison
    // LA GARNISON : les héros présents dans les murs défendent (backend wave.go).
    // `garrison` = têtes aux remparts, `garrisonValue` = ce qu'elles ajoutent, plafonné
    // à ce que les bâtiments tiennent déjà — on ne défend que le rempart qu'on a bâti.
    // C'est le seul terme de la défense qu'un joueur change en une action : sortir.
    garrison?: number;
    garrisonValue?: number;
    buildings: TownBuilding[];
    storage: Item[];
    waterDrawnToday: string[];
    // Town journal (Panel building): in-town actions, newest first, capped server-side.
    log?: TownLogEntry[];
    // How many messages the board holds. The messages THEMSELVES never ride this
    // payload (see ChatMessage) — this count only feeds the ✉️ unread pip.
    chatCount?: number;
    // L'ORDRE DU JOUR et la PRÉVISION de vague (backend orders.go) — entièrement
    // dérivés de l'état. C'est ce qui donne un énoncé à une session de cinq minutes.
    orders?: TownOrder[];
    forecast?: WaveForecast;
    requests?: TownRequest[];
    scouts?: string[];
    reviveDay?: number; // Townhall resurrections performed today (allowance = level)
    revivesToday?: number;
    // LA FAVEUR DES DIEUX (backend mythic.go) : le compteur qu'alimentent les offrandes
    // fabriquées, le scrutin en cours au Temple, et les bénédictions actives.
    favor?: number;
    favorGoal?: number; // ce que coûte un dieu (dérivé serveur, pas une constante client)
    blessingSlots?: number; // combien de bénédictions le Temple tient — son niveau
    blessings?: ActiveBlessing[];
    votes?: Record<string, string>; // playerId -> godId
  };
  activeCombat?: string;
  combats?: Record<string, Combat>;
  ruins?: Record<string, Ruin>;
  watchtowers?: Record<string, Watchtower>;
  contributions?: Record<string, Contribution>;
}

// LE BELVÉDÈRE (backend watchtower.go) : un chantier posé sur un SOMMET, qui une fois
// bâti garde sa vue allumée pour toute l'expédition et pour toujours.
export interface Watchtower {
  id: string;
  x: number;
  y: number;
  height: number;
  built: boolean;
  paInvested: number;
  buildPa: number;
  sight: number;
  materials?: Item[];
}

export interface CombatUnit {
  id: string;
  name: string;
  side: "hero" | "monster";
  refId: string;
  kind: string;
  classId?: string; // hero class id
  appearance?: string; // asset file for the sprite
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  stats: Stats;
  states: string[];
  move: number;
  moved?: boolean; // a déjà dépensé son déplacement ce tour
  acted?: boolean; // a déjà dépensé son ACTION ce tour (une seule par tour)
  cooldowns?: Record<string, number>; // capacité -> tours restants avant de la rejouer
  initiative: number;
  fled?: boolean; // a quitté l'arène par le bord bas (lot C3)
  ownerId?: string; // joueur propriétaire du héros ("" / absent = partie legacy)
  fx: number; // Facing (lot C4) : direction regardée — l'arc arrière prend +25 %
  fy: number;
  size?: number; // lot C5 : 2 = boss 2×2 (ancre = coin haut-gauche)
  armor?: number; // équipement prêté : dégâts subis en moins
  reach?: number; // portée de l'attaque de base (0 = mêlée)
  weaponName?: string; // l'arme au poing (weapons.go)
  weaponKind?: string; // son archétype : epee | dague | lance | arc | baton
  // VISION D'ARÈNE (backend combatsight.go) : portée d'œil, dérivée de la Précision.
  // Une unité adverse hors de vue n'est PAS servie du tout — le client n'a donc rien
  // à masquer, et la position ne voyage pas.
  sight?: number;
  spotted?: number; // rounds restants de marquage par « Éclairer »
}

// A combat ability with its GDD grids (mirrors backend AttackDef).
export interface Skill {
  name: string;
  kind: string; // "base" | "special"
  desc?: string;
  targets: { dx: number; dy: number }[] | null;
  damage: { dx: number; dy: number }[] | null;
  dmgStat?: string;
  bonus?: number;
  stunPct?: number;
  root?: boolean;
  absorb?: boolean;
  selfShield?: boolean;
  buffAllies?: boolean;
  reveal?: number; // rayon révélé (Éclairer) — la capacité ne fait aucun dégât
  cooldown?: number; // tours de recharge après usage (0 = disponible chaque tour)
}

// Case d'arène (lot C1) : hauteur + terrain tactique.
export interface CombatCell {
  height: number;
  blocked?: boolean; // rocher/arbre : infranchissable
  hazard?: string; // "water" | "ice" | "brambles"
}

// Un coup structuré du dernier lot d'actions (lot C2 — dégâts flottants).
export interface CombatHit {
  unitId: string;
  amount: number; // toujours > 0
  kind: "dmg" | "heal" | "hazard";
}

// Butin d'un héros à la victoire (écran de victoire C2).
export interface CombatReward {
  heroId: string;
  heroName: string;
  items: Item[];
}

export interface Combat {
  id: string;
  gameId: string;
  tileX: number;
  tileY: number;
  biome: Biome;
  gridW: number;
  gridH: number;
  heights: number[];
  cells?: CombatCell[];
  units: CombatUnit[];
  order: string[];
  turnIdx: number;
  round: number;
  status: "active" | "won" | "lost" | "fled";
  log: string[];
  seq: number; // s'incrémente à chaque action — le client diffe pour animer lastHits
  lastHits?: CombatHit[];
  rewards?: CombatReward[];
  participants?: string[]; // joueurs présents — les héros des absents sont joués par l'IA
  // Lot C5 : fenêtre de renforts (vague 4+). (Le boss n'annonce plus ses
  // patterns — il attaque chaque tour, base ou spéciale.)
  wave?: number;
  reinforceAt?: number;
  reinforceDone?: boolean;
  turnDeadline?: string; // instant limite du tour humain courant (multi ≥2 présents) — anti-blocage
}

// Objet du sac utilisable en combat (lot C3) — servi par combatResponse.
export interface CombatItem {
  name: string;
  qty: number;
  heal: number;
}

// Fourchette de dégâts prévisualisée, calculée par le serveur (lot C2).
export interface DamageEstimate {
  min: number;
  max: number;
  rear?: number; // 1 = attaque de dos (+25 %, ignore la couverture) — lot C4
  cover?: number; // 1 = cible à couvert (−25 % à distance) — lot C4
  // LA PRÉCISION rendue lisible : chance de coup critique et dégâts d'un critique.
  // Servie À CÔTÉ de la fourchette, jamais fondue dedans — une moyenne ne dirait ni
  // ce qu'on va probablement faire, ni ce qu'on peut espérer.
  critPct?: number;
  critMax?: number;
}

// Une compétence iso jouable ce tour (une par bouton) — servie par combatResponse.
export interface CombatSkill {
  idx: number;
  skill: Skill;
  targets: string[];
  estimates?: Record<string, DamageEstimate>;
  selfCast: boolean; // capacité sur soi (ex. Posture défensive) — pas de cible
  weapon?: boolean; // vient de l'ARME portée et non de la classe (weapons.go)
  cooldown?: number; // recharge de la capacité, en tours
  cooldownLeft?: number; // tours restants avant de pouvoir la rejouer (0 = prête)
  cells?: [number, number][]; // cases VISABLES (grille de ciblage, bornes + LOS serveur)
}

// Une arme du sac qu'on peut dégainer à la place de celle qu'on tient (coûte le tour).
export interface CombatSwap {
  name: string;
  kind: string; // archétype
  desc: string;
  technique?: string; // le nom de la technique qu'elle apporte
}

export interface CombatCurrent {
  unitId: string;
  // L'ÉCONOMIE DU TOUR : un déplacement, une action. Le serveur la tenait déjà,
  // mais ne la disait pas — d'où l'impression de pouvoir rejouer indéfiniment.
  moved?: boolean;
  acted?: boolean;
  reachable: [number, number][];
  attackTargets: string[];
  skillTargets: string[];
  skill: Skill;
  skills?: CombatSkill[]; // toutes les compétences iso du héros actif
  attackEstimates?: Record<string, DamageEstimate>;
  skillEstimates?: Record<string, DamageEstimate>;
  attackCells?: [number, number][]; // portée de l'attaque de base — l'ARME la change
  pushTargets?: string[]; // Poussée (C3) : ennemis alignés à portée
  items?: CombatItem[]; // objets consommables du sac du héros actif (C3)
  swaps?: CombatSwap[]; // armes du sac qu'on peut dégainer (coûte l'action du tour)
}

// Compétence de carte par classe (catalogue /api/mapskills), remplace la boule de feu.
export interface MapSkillDef {
  id: string;
  classId: string; // "" = héros sans classe (compétence de base)
  name: string;
  icon: string;
  pa: number;
  desc: string;
  kind: "blast" | "snipe";
  base: number;
  stat: string;
  loot: boolean;
}

export interface MapSkillReport {
  skillId: string;
  name: string;
  monsterId: string;
  species: string;
  damage: number;
  slain: number;
  killed: boolean;
  loot?: string;
  x: number;
  y: number;
}

// Cases menacées par un ennemi depuis sa position (télégraphie orange, lot C2).
export interface CombatThreat {
  unitId: string;
  cells: [number, number][];
}

export interface CombatResponse {
  combat: Combat;
  game: GameState;
  current?: CombatCurrent;
  threats?: CombatThreat[];
}
