// ANGLAIS — les chaînes de l'INTERFACE.
//
// La clé est la phrase française (voir i18n/index.ts). Les substitutions `{x}` sont
// NOMMÉES : on peut donc les remettre dans l'ordre anglais sans rien casser, et c'est
// exactement pour ça qu'elles ne sont pas positionnelles.
//
// ⚠ NE PAS TRADUIRE LES NOMS DE JEU ICI : « Bois », « Pierre », « Tétanisé » sont des
// identifiants côté serveur (CLAUDE.md) et vivent dans ./data.ts, servis par `tName`.
// Une phrase d'interface qui NOMME un objet en dur (« Il faut de la Pierre à la
// Banque ») est une exception assumée : le nom y est du texte, pas une clé.
//
// ⚠ ce fichier se vérifie avec `npm run test:i18n`, qui compare les clés réellement
// appelées dans le code aux entrées d'ici, dans les deux sens (manquantes ET orphelines).

export const UI: Record<string, string> = {
  // --- écran titre, menus, navigation ---
  "CHAQUE ACTE COMPTE": "EVERY DEED COUNTS",
  Connexion: "Sign in",
  "REPRENDRE — SOLO": "RESUME — SOLO",
  "REPRENDRE — PARTIE": "RESUME — EXPEDITION",
  Solo: "Solo",
  "(avec 4 bots)": "(with 4 bots)",
  "Parties publiques": "Public games",
  "Parties privées": "Private games",
  "connexion requise": "sign-in required",
  "Connecte-toi pour rejoindre une partie publique.": "Sign in to join a public game.",
  "Connecte-toi pour rejoindre une expédition publique.": "Sign in to join a public expedition.",
  Classement: "Leaderboard",
  Paramètres: "Settings",
  "Nouvelle partie test": "New test game",
  Continuer: "Continue",
  Intro: "Intro",
  Expédition: "Expedition",
  "Salon en attente · {n}/{min} joueurs": "Waiting room · {n}/{min} players",
  "Jour {d} · 🏰 {pct}% · 🌊 {time}": "Day {d} · 🏰 {pct}% · 🌊 {time}",
  "Passer le chargement": "Skip loading",
  Chargement: "Loading",
  "Commencer la partie": "Start the game",
  "Il y a bien longtemps…": "Long ago…",
  Passer: "Skip",
  "Navigation principale": "Main navigation",
  Ville: "Town",
  Sac: "Bag",
  Carte: "Map",
  Bâtir: "Build",
  Atelier: "Workshop",
  "Aucun de tes héros n'est en ville.": "None of your heroes is in town.",
  "1 chantier en cours": "1 construction under way",
  "{n} chantiers en cours": "{n} constructions under way",

  // --- paramètres ---
  Jeu: "Game",
  Langue: "Language",
  "Langue du navigateur": "Browser language",
  "Ta langue est enregistrée dans ton compte : tu la retrouveras sur tous tes appareils.":
    "Your language is saved to your account — you'll find it on every device.",
  "Ta langue est retenue sur cet appareil. Crée un compte pour la retrouver partout.":
    "Your language is remembered on this device. Create an account to carry it everywhere.",
  Notifications: "Notifications",
  "Outils de test": "Debug tools",
  "Quitter la partie": "Leave the game",
  Reprendre: "Resume",
  Retour: "Back",
  "Réglages du jeu": "Game settings",
  "Volume — Musique ({n}%)": "Volume — Music ({n}%)",
  "SFX ({n}%)": "SFX ({n}%)",
  "Fréquence d'affichage": "Frame rate",
  "Réduire le taux de rafraîchissement économise la batterie et évite la surchauffe, mais peut affecter la fluidité.":
    "A lower refresh rate saves battery and avoids overheating, but may feel less smooth.",
  "Animation des personnages": "Character animation",
  Figée: "Frozen",
  Éco: "Eco",
  Fluide: "Smooth",
  Max: "Max",
  Aucun: "None",
  "Cadence de l'animation au repos : héros qui respirent, monstres qui remuent sur la carte. « Figée » les immobilise tant que rien ne bouge — la carte ne se redessine plus du tout au repos, c'est le réglage le plus économe en batterie. Les déplacements, attaques et morts restent toujours pleinement animés.":
    "How fast idle animation runs: heroes breathing, monsters stirring on the map. “Frozen” holds them still until something happens — the map stops redrawing altogether at rest, which is the most battery-friendly setting. Moves, attacks and deaths stay fully animated either way.",
  "Effets de météo": "Weather effects",
  "Ce que le climat d'une expédition fait bouger : la neige qui tombe sous un ciel couvert en pays nordique, les vire-vents qui roulent au désert. « Aucun » ne les fige pas — il les supprime : plus une image demandée, plus un objet dans la scène. Une expédition tempérée n'a pas de météo et ne coûte rien quel que soit ce réglage.":
    "What an expedition's climate sets in motion: snow falling under an overcast sky up north, tumbleweeds rolling through the desert. “None” doesn't freeze them — it removes them: not a frame requested, not an object in the scene. A temperate expedition has no weather and costs nothing whatever you pick here.",
  "Qualité graphique": "Graphics quality",
  "Baisser la qualité réduit l'usage de batterie et la surchauffe.":
    "Lower quality means less battery drain and less heat.",
  "Terrain voxel": "Voxel terrain",
  "Pentes voxel": "Voxel slopes",
  Blocs: "Blocks",
  "Pentes voxel = relief en petites marches de voxels (¼ de tuile, style diorama) ; Blocs = piliers pleine tuile. Carte monde uniquement.":
    "Voxel slopes = relief in small voxel steps (¼ tile, diorama style); Blocks = full-tile pillars. World map only.",
  "Rendu beauté (expérimental)": "Beauty rendering (experimental)",
  Cinématique: "Cinematic",
  Standard: "Standard",
  "Lumière filmique (tone mapping ACES), halo lumineux sur les cristaux/fleurs, ciel dégradé et brume atmosphérique. Plus joli mais plus gourmand — coûte du GPU à chaque redraw.":
    "Filmic light (ACES tone mapping), glow on crystals and flowers, gradient sky and atmospheric haze. Prettier but heavier — it costs GPU on every redraw.",
  "Rendu Signac (divisionniste)": "Signac rendering (divisionist)",
  Peinture: "Painting",
  "Normal|rendu": "Normal",
  "Chaque facette de voxel devient sa propre touche de couleur pure, à la manière de Paul Signac : ombres violettes plutôt que grises, saturation haute, mélange optique. La touche est ancrée au MONDE — elle tourne et se resserre avec la géométrie, et les arêtes restent nettes.":
    "Every voxel face becomes its own dab of pure colour, the way Paul Signac painted: violet shadows instead of grey ones, high saturation, optical mixing. The dab is anchored to the WORLD — it turns and tightens with the geometry, and edges stay crisp.",
  "Intensité de la touche ({n}%)": "Dab intensity ({n}%)",
  "Au minimum, seul le parti pris de couleur reste ; au maximum, la trame de touches domine.":
    "At the low end only the colour bias remains; at the high end the weave of dabs takes over.",
  Butin: "Loot",
  "Me notifier de chaque fouille réussie.": "Notify me of every successful search.",
  Vague: "Wave",
  "Me notifier 10 minutes avant chaque vague.": "Notify me 10 minutes before each wave.",
  "Points d'action": "Action points",
  "Me notifier quand la barre de PA est pleine.": "Notify me when the AP bar is full.",
  Messages: "Messages",
  "Me notifier quand un ami envoie un message privé.": "Notify me when a friend sends a private message.",

  // --- barre du haut, héros ---
  "Mes personnages": "My characters",
  "État de la ville — PV et PA de ton équipe": "Town status — your team's HP and AP",
  "Horde estimée entre {min} et {max} contre {def} de défense · fiable à {pct}%":
    "Horde estimated between {min} and {max} against {def} defense · {pct}% confidence",
  "(sans Tour de guet, on devine)": "(without a Watchtower, it's guesswork)",
  "(Tour niv.{lvl}, {n} observateur(s))": "(Tower lv.{lvl}, {n} scout(s))",
  "{n} créatures aux abords — les abattre fait baisser ce chiffre":
    "{n} creatures at the gates — killing them brings this number down",
  "abords dégagés": "surroundings clear",
  "Prochaine vague — état de la ville": "Next wave — town status",
  "Rattrapage…": "Catching up…",
  "Journal de la ville": "Town journal",
  "Messages de la ville": "Town messages",
  "{name} est à terre": "{name} is down",
  "Sélectionner {name}": "Select {name}",
  "Fiche du personnage": "Character sheet",
  "PA payés par": "AP paid by",
  "{name} — {n} PA": "{name} — {n} AP",
  "paie les PA": "pays the AP",
  "en expédition": "in the field",
  "en ville": "in town",
  "{n} en ville": "{n} in town",
  "{n} PA": "{n} AP",
  PA: "AP",
  PV: "HP",

  // --- barre des héros sur la carte ---
  "{name} a la case ensevelie sous la neige — fouiller la dégage et relance la récolte.":
    "{name}'s tile is buried under snow — searching clears it and restarts the harvest.",
  "{name} fouille sur place — prochaine trouvaille dans {time} (sans PA ; bouger l'interrompt).":
    "{name} is searching in place — next find in {time} (no AP; moving interrupts it).",
  "{name} est en ville — tape une case adjacente pour le faire sortir.":
    "{name} is in town — tap an adjacent tile to send them out.",
  "{name} est Tétanisé — tue le pack ou fuis.": "{name} is Pinned — kill the pack or flee.",
  "{name} sélectionné — tape les losanges jaunes pour le déplacer.":
    "{name} selected — tap the yellow diamonds to move them.",

  // --- ordre du jour ---
  "Replier l'ordre du jour": "Collapse the standing orders",
  "Voir l'ordre du jour": "Show the standing orders",

  // --- état de la ville ---
  "État de la ville": "Town status",
  "PV ville": "Town HP",
  Défense: "Defense",
  "Prochaine vague": "Next wave",
  "Vagues subies": "Waves weathered",
  Jour: "Day",
  "Jour {n}": "Day {n}",
  "Défense — total": "Defense — total",
  "non construit": "not built",
  "0 (ouverte)": "0 (open)",
  "Garnison ({n} aux remparts)": "Garrison ({n} on the walls)",
  personne: "nobody",
  "La défense absorbe la horde ; une durabilité basse ou une porte ouverte la réduit. Un héros présent dans les murs à l'heure de la vague DÉFEND — sans pouvoir récolter ce tour-là. La garnison ne dépasse jamais ce que les bâtiments tiennent : on ne défend que le rempart qu'on a bâti.":
    "Defense absorbs the horde; low durability or an open gate cuts it down. A hero inside the walls when the wave hits DEFENDS — and gathers nothing that turn. The garrison never exceeds what the buildings already hold: you can only man the wall you built.",
  "Tous les bâtiments": "All buildings",
  "Niv. {n}": "Lv {n}",
  chantier: "site",
  "Dernière vague (#{n})": "Last wave (#{n})",
  Horde: "Horde",
  "Dégâts ville": "Town damage",
  "Bâtiments :": "Buildings:",
  "Héros hors ville :": "Heroes outside:",
  "Monstres apparus :": "Monsters spawned:",
  Fermer: "Close",

  // --- journal & registre ---
  "Rien à signaler pour l'instant — les actions faites en ville (porte, puits, Banque, chantiers…) s'inscrivent ici.":
    "Nothing to report yet — actions taken in town (gate, well, Bank, construction…) are recorded here.",
  "J{n}": "D{n}",
  "Ce que la ville te doit": "What the town owes you",
  "Ce que la ville vous doit": "What the town owes you all",
  "Cette expédition n'a pas de joueurs enregistrés — le registre reste vide.":
    "This expedition has no registered players — the ledger stays empty.",
  "Ce que chacun a apporté à {town}, dans l'ordre où vous êtes arrivés. Ce n'est pas un classement.":
    "What each of you brought to {town}, in the order you arrived. This is not a ranking.",
  "la ville": "the town",
  Aventurier: "Adventurer",
  toi: "you",
  "rien encore": "nothing yet",
  "PA de chantier": "construction AP",
  "objets rapportés": "items brought back",
  "créatures abattues": "creatures slain",
  "PV rendus aux remparts": "HP restored to the walls",
  "objets fabriqués": "items crafted",
  "requêtes honorées": "requests fulfilled",

  // --- messagerie ---
  "Messages de {town}": "Messages from {town}",
  "Depuis le terrain, le courrier n'arrive que si la ville a bâti la Poste.":
    "From the field, mail only gets through if the town has built the Post Office.",
  "La Poste est en ruine — répare-la pour rétablir le courrier.":
    "The Post Office is in ruins — repair it to restore the mail.",
  "Ramène un héros en ville, ou trouve le « Plan de la Poste » et lance le chantier.":
    "Bring a hero back to town, or find the “Post Office Plan” and start the build.",
  "Ouvrir Bâtir": "Open Build",
  "Personne n'a encore écrit. Lance la conversation.": "Nobody has written yet. Start the conversation.",
  "Envoyé du terrain, via la Poste": "Sent from the field, through the Post Office",
  "Écrire du terrain (Poste)…": "Write from the field (Post Office)…",
  "Écrire un message…": "Write a message…",
  "Votre message": "Your message",
  Envoyer: "Send",
  "Les messages sont partagés par toute la ville et passent par un filtre de modération.":
    "Messages are shared with the whole town and pass through a moderation filter.",
  "Message envoyé — un mot a été masqué par la modération.":
    "Message sent — one word was masked by moderation.",
  "Ouvrir la messagerie": "Open messages",

  // --- chronique ---
  "Chargement de la chronique…": "Loading your chronicle…",
  "Ma chronique": "My chronicle",
  "Aucune expédition à raconter pour l'instant. Ce que tu apporteras à une ville — chantiers, récoltes, remparts relevés, requêtes honorées — restera ici même quand elle sera tombée.":
    "No expedition to tell of yet. What you bring to a town — construction, harvests, walls raised, requests fulfilled — stays here even after it falls.",
  expéditions: "expeditions",
  "meilleure survie": "best survival",
  "{n} vagues": "{n} waves",
  Titres: "Titles",
  "À venir": "Coming up",
  "Les titres sont une mémoire, pas un avantage : ils ne donnent rien en jeu.":
    "Titles are a memory, not an advantage: they grant nothing in game.",
  "Masquer mon expédition": "Hide my expedition",
  "Voir mon expédition": "Show my expedition",
  "Masquer mes {n} expéditions": "Hide my {n} expeditions",
  "Voir mes {n} expéditions": "Show my {n} expeditions",
  "vague {w} · {pa} PA · {n} objets": "wave {w} · {pa} AP · {n} items",

  // --- fin de partie ---
  "La ville": "The town",
  Toi: "You",
  "{town} est tombée": "{town} has fallen",
  "La horde a submergé la ville à la vague {w} (jour {d}).":
    "The horde overwhelmed the town on wave {w} (day {d}).",
  "vagues tenues": "waves held",
  jours: "days",
  "Ce que tu as apporté": "What you brought",
  "{town} se dressera en ruines sur les cartes des prochaines expéditions — avec la vague où elle est tombée et le nom de ceux qui l'ont défendue. Ceux qui la trouveront y récupéreront ce qu'elle n'a pas eu le temps de dépenser.":
    "{town} will stand in ruins on the maps of future expeditions — with the wave that took it and the names of those who defended it. Whoever finds it will salvage what the town never had time to spend.",
  "{town} se dressera en ruines sur les cartes des prochaines expéditions — avec la vague où elle est tombée. Ceux qui la trouveront y récupéreront ce qu'elle n'a pas eu le temps de dépenser.":
    "{town} will stand in ruins on the maps of future expeditions — with the wave that took it. Whoever finds it will salvage what the town never had time to spend.",
  "Repartir en solo": "Set out solo again",
  "Rejoindre une expédition": "Join an expedition",
  "Menu principal": "Main menu",

  // --- cinématique de vague ---
  "Vague {n}": "Wave {n}",
  "{n} vagues pendant ton absence": "{n} waves while you were away",
  "VAGUE {n}": "WAVE {n}",
  "La horde a percé les défenses": "The horde broke through the defenses",
  "Les murs ont tenu": "The walls held",
  "−{n} PV": "−{n} HP",
  "Rapport de vague": "Wave report",
  "Vagues {from}–{to}": "Waves {from}–{to}",
  vs: "vs",
  intacte: "untouched",
  "PV restants": "HP remaining",
  Bâtiments: "Buildings",
  "Hors les murs": "Outside the walls",
  Renforts: "Reinforcements",
  "+{n} packs": "+{n} packs",
  "La ville est tombée.": "The town has fallen.",
  "Voir le bilan": "See the summary",

  // --- inventaire & fiche d'objet ---
  "— vide —": "— empty —",
  Tout: "All",
  Consommable: "Consumable",
  Plante: "Plant",
  Minerai: "Ore",
  Objet: "Item",
  Animal: "Animal",
  Arme: "Weapon",
  Aliment: "Food",
  Eau: "Water",
  Décoration: "Decoration",
  Équipement: "Gear",
  aliment: "food",
  consommable: "consumable",
  arme: "weapon",
  deco: "decoration",
  objet: "item",
  minerai: "ore",
  "En le consommant": "When consumed",
  "+{n} PA": "+{n} AP",
  "+{n} PV": "+{n} HP",
  "retire TOUS les états": "clears ALL conditions",
  "retire {states}": "clears {states}",
  Porté: "Worn",
  force: "strength",
  dextérité: "dexterity",
  agilité: "agility",
  endurance: "endurance",
  "armure {n} (dégâts subis en moins)": "armour {n} (less damage taken)",
  "portée {n} (l'attaque de base atteint plus loin)": "range {n} (basic attack reaches further)",
  "+{n} contre les créatures maudites": "+{n} against cursed creatures",
  "Ces bonus ne jouent qu'au combat.": "These bonuses only apply in battle.",
  "Plan de construction : dépose-le à la Banque, il sera consommé quand la ville posera ce chantier.":
    "A building plan: drop it at the Bank and it will be consumed when the town lays this construction.",
  "Ni consommable ni portable : c'est une ressource — elle sert aux recettes de l'Atelier et aux chantiers, une fois déposée à la Banque.":
    "Neither consumable nor wearable: it's a resource — used by Workshop recipes and construction once deposited at the Bank.",
  Utiliser: "Use",
  Équiper: "Equip",
  "On ne s'équipe que depuis le sac d'un héros, pas depuis la Banque.":
    "You can only equip from a hero's bag, not from the Bank.",
  "{n} obj.": "{n} items",
  "Banque (ville)": "Bank (town)",
  "Déposer le butin de mes héros en ville": "Deposit my in-town heroes' loot",
  "Reviens en ville pour accéder au stock de la Banque. En expédition, un héros n'utilise que son propre inventaire.":
    "Come back to town to reach the Bank's stock. In the field, a hero only uses their own inventory.",
  Banque: "Bank",
  "Il faut un de tes héros dans la ville pour puiser dans la Banque.":
    "You need one of your heroes in town to draw from the Bank.",
  "{name} est déjà au mieux : cela ne servirait à rien maintenant.":
    "{name} is already at their best: this would do nothing right now.",

  // --- atelier / craft ---
  Potion: "Potion",
  Forge: "Forge",
  "Terrain — {name} · recettes limitées (sac du héros)":
    "Field — {name} · limited recipes (hero's bag)",
  "Ingrédients pris dans la 🏦 Banque ; objets rangés dans la Banque.":
    "Ingredients taken from the 🏦 Bank; output stored in the Bank.",
  "Ingrédients pris dans le sac du héros ; pas d'atelier/forge en expédition.":
    "Ingredients taken from the hero's bag; no workshop or forge in the field.",
  "Aucune recette ici.": "No recipes here.",
  "niv.{n}": "lv.{n}",
  ville: "town",
  "Nécessite un bâtiment de la ville (atelier/forge)": "Requires a town building (workshop/forge)",
  "Nécessite {building} niveau {n}": "Requires {building} level {n}",
  "Ingrédients manquants": "Missing ingredients",
  "PA insuffisants": "Not enough AP",
  Cuisiner: "Cook",
  Fabriquer: "Craft",

  // --- bâtir / structures ---
  Structures: "Structures",
  Statut: "Status",
  "A-Z": "A-Z",
  "Niv.": "Lv",
  "Chantiers en cours": "Under construction",
  "Plans à poser": "Plans to lay",
  Construits: "Built",
  "Reviens en ville pour construire/améliorer. Consultation seule.":
    "Come back to town to build or upgrade. View only.",
  "Niv. max": "Max lv",
  Améliorer: "Upgrade",
  "Poser le plan": "Lay the plan",
  "Être en ville": "Be in town",
  "Niveau maximum atteint": "Maximum level reached",
  "Requiert {needs}": "Requires {needs}",
  "requiert {needs}": "requires {needs}",
  "Trouve « {plan} » et dépose-le à la Banque pour poser ce chantier":
    "Find “{plan}” and deposit it at the Bank to lay this construction",
  "Matériaux manquants en Banque — les PA investis restent acquis":
    "Materials missing at the Bank — the AP already invested is kept",
  "Investir les PA du travailleur ({done}/{total})": "Invest the worker's AP ({done}/{total})",
  "Poser le plan de chantier (1 PA)": "Lay the construction plan (1 AP)",
  "en chantier": "under construction",
  "plan à poser": "plan to lay",
  "amélioration niv. {n}": "upgrade to lv {n}",
  "{done}/{total} PA investis": "{done}/{total} AP invested",
  "matériaux manquants": "materials missing",

  // --- ville (Home) ---
  "Ouvrir (Stock)": "Open (Bag)",
  "Cuisiner (Atelier)": "Cook (Workshop)",
  "Évaluer l'attaque": "Assess the attack",
  "Ressusciter {name}": "Revive {name}",
  "Ressusciter (aucun héros à terre)": "Revive (no hero is down)",
  Journal: "Journal",
  "Soigner {name}": "Heal {name}",
  "Soigner (personne de blessé)": "Heal (nobody is wounded)",
  Durabilité: "Durability",
  "porte ouverte (0)": "gate open (0)",
  "{name} a déjà bu aujourd'hui": "{name} has already drunk today",
  "Puits à sec": "The well is dry",
  "Puiser de l'eau": "Draw water",
  "Puiser de l'eau ({name})": "Draw water ({name})",
  "Le héros": "The hero",
  "1/jour": "1/day",
  "Estimer la vague": "Estimate the wave",
  "Fermer la porte": "Close the gate",
  "Ouvrir la porte": "Open the gate",
  "La ville est intacte": "The town is untouched",
  "Relever les remparts (+{n} PV)": "Raise the walls (+{n} HP)",
  "Il faut de la Pierre à la Banque": "You need Stone at the Bank",
  "-1 PA · -1 Pierre": "-1 AP · -1 Stone",
  "Améliorer (Bâtir)": "Upgrade (Build)",
  "Réparer +5 durabilité": "Repair +5 durability",

  // --- carte : menu d'action, consignes, combat ---
  Combattre: "Fight",
  "Restaure 6 PA (consomme une ration d'eau du sac)":
    "Restores 6 AP (consumes a water ration from the bag)",
  "Boire une ration": "Drink a ration",
  "Boire une ration d'eau (+6 PA) — {n} en réserve": "Drink a water ration (+6 AP) — {n} in reserve",
  Déblayer: "Clear out",
  "Donjon épuisé": "Dungeon exhausted",
  Explorer: "Explore",
  "Si je ne reviens pas :": "If I don't come back:",
  "Se cacher": "Hide",
  Rentrer: "Head home",
  "Sans PA, aucune consigne ne peut s'exécuter.": "With no AP, no standing order can run.",
  "{d} cases jusqu'à la ville pour {pa} PA — trop loin : il se cacherait sur place.":
    "{d} tiles to town on {pa} AP — too far: they would hide where they stand.",
  "En ville — fouille et cachette inutiles ici": "In town — no point searching or hiding here",
  "La récolte tourne toute seule, sans PA": "The harvest runs on its own, no AP",
  "Fouille auto": "Auto-search",
  "fouille auto": "auto-search",
  "Fouille automatique — sans PA": "Automatic search — no AP",
  Fouiller: "Search",
  "Fouiller (-1 PA) — le héros continue ensuite tout seul":
    "Search (-1 AP) — the hero then carries on alone",
  "Se cacher (-1 PA)": "Hide (-1 AP)",
  "Tétanisé — impossible de se cacher": "Pinned — cannot hide",
  "S'échapper": "Break away",
  "S'échapper (-1 PA)": "Break away (-1 AP)",
  "Rejoindre le combat ({x},{y}) — tes héros y sont !":
    "Join the battle at ({x},{y}) — your heroes are there!",
  "Afficher/masquer les héros des autres joueurs (sprites translucides)":
    "Show/hide other players' heroes (translucent sprites)",
  Autres: "Others",
  menaces: "threats",
  "Victoire !": "Victory!",
  "Repli !": "Retreat!",
  "Défaite…": "Defeat…",
  "1 tour": "1 round",
  "{n} tours": "{n} rounds",
  "{up}/{all} héros debout": "{up}/{all} heroes standing",
  "L'équipe s'est repliée — pas de butin, et le pack rôde toujours sur la case…":
    "The team fell back — no loot, and the pack still prowls the tile…",
  "Les survivants battent en retraite vers la ville…":
    "The survivors retreat towards the town…",
  "Retour à la carte": "Back to the map",

  // --- barre de combat ---
  "Round {n}": "Round {n}",
  "portée {n}": "range {n}",
  "armure {n}": "armour {n}",
  "Mains nues — aucune technique d'arme": "Bare hands — no weapon technique",
  "Mains nues": "Bare hands",
  "L'ennemi agit…": "The enemy is acting…",
  "Tour d'un autre joueur…": "Another player's turn…",
  "Des renforts ennemis surgiront au prochain round !":
    "Enemy reinforcements will arrive next round!",
  "Attaque de base": "Basic attack",
  "portée {n} (arme)": "range {n} (weapon)",
  "au contact": "in melee",
  Attaque: "Attack",
  "technique de {weapon}": "{weapon} technique",
  "aucune cible à portée": "no target in range",
  "Pousser un ennemi d'une case : collision 2 dégâts, eau = piégé, chute ≥2 = +2":
    "Push an enemy one tile: collision 2 damage, water = trapped, fall ≥2 = +2",
  Pousser: "Push",
  "-50 % de dégâts subis jusqu'à ton prochain tour (termine le tour)":
    "-50% damage taken until your next turn (ends the turn)",
  Défendre: "Defend",
  "Consommer un objet du sac (termine le tour)": "Consume an item from the bag (ends the turn)",
  Objets: "Items",
  "Dégainer une autre arme du sac (termine le tour)":
    "Draw another weapon from the bag (ends the turn)",
  "Quitter le combat par le bord bas — pas de butin, le pack reste":
    "Leave the battle by the bottom edge — no loot, the pack stays",
  "Rejoins le bord bas de l'arène pour fuir": "Reach the bottom edge of the arena to flee",
  Fuir: "Flee",
  "Fin du tour": "End turn",
  Espace: "Space",
  Fin: "End",
  "Changer d'arme coûte le tour — mais change ta technique.":
    "Switching weapons costs the turn — but changes your technique.",
  "Attaque de dos : +25 %, ignore la couverture": "Backstab: +25%, ignores cover",
  "Cible à couvert : −25 % à distance": "Target in cover: −25% at range",
  "Aucun ennemi aligné à portée de poussée.": "No enemy lined up within push range.",
  "Aucune cible à portée — déplace-toi (cases vertes).":
    "No target in range — move first (green tiles).",
  "Centrer la caméra sur {name}": "Centre the camera on {name}",

  // --- fiche de personnage ---
  Personnage: "Character",
  précédent: "previous",
  suivant: "next",
  "Classe intermédiaire": "Intermediate class",
  "Classe avancée": "Advanced class",
  Évoluer: "Evolve",
  "Choisis une évolution": "Choose an evolution",
  Choisir: "Choose",
  "{slot} — vide": "{slot} — empty",
  Retirer: "Remove",
  "Équiper {item}": "Equip {item}",
  Attributs: "Attributes",
  Force: "Strength",
  Dextérité: "Dexterity",
  Précision: "Precision",
  Agilité: "Agility",
  Endurance: "Endurance",
  Athlétisme: "Athletics",
  "Compétences uniques": "Unique skills",
  Combat: "Battle",
  "Aucune classe — explore, combats et collecte pour débloquer une évolution.":
    "No class yet — explore, fight and gather to unlock an evolution.",

  // --- consignes & notifications ---
  "Consigne posée : se cacher avant la vague": "Standing order set: hide before the wave",
  "Consigne posée : rentrer et déposer": "Standing order set: head home and deposit",
  "Consigne retirée": "Standing order cleared",
  "Il faut un de tes héros en ville pour monter à la Tour":
    "You need one of your heroes in town to climb the Tower",
  "Horde estimée entre {min} et {max} — fiable à {pct}%":
    "Horde estimated between {min} and {max} — {pct}% confidence",
  "({n} observateurs)": "({n} scouts)",
  "{name} utilise « {item} » — {effect}": "{name} uses “{item}” — {effect}",
  "c'est fait": "done",
  "Équipé : {item}.": "Equipped: {item}.",
  "Emplacement libéré.": "Slot cleared.",

  // --- salon multijoueur ---
  Publiques: "Public",
  Privées: "Private",
  "Ton nom d'aventurier": "Your adventurer name",
  "Une partie démarre dès son minimum de joueurs atteint, puis reste ouverte quelques vagues : on peut embarquer dans une expédition déjà en route. Chaque joueur incarne une équipe de 3 héros.":
    "A game starts as soon as it reaches its minimum player count, then stays open for a few waves: you can join an expedition already under way. Each player leads a team of 3 heroes.",
  "Recherche de parties…": "Looking for games…",
  "En route — jour {d}, vague {w} · {n}/{max} joueurs":
    "Under way — day {d}, wave {w} · {n}/{max} players",
  "Minimum atteint": "Minimum reached",
  "En attente de joueurs": "Waiting for players",
  "{n}/{max} joueurs": "{n}/{max} players",
  COMPLET: "FULL",
  "1 VAGUE": "1 WAVE",
  "{n} VAGUES": "{n} WAVES",
  DÉMARRE: "STARTING",
  "Créer une partie": "Create a game",
  "Tu es l'hôte : partage le code, ajoute des bots et lance quand tout le monde est là.":
    "You're the host: share the code, add bots and launch when everyone's here.",
  "Joueurs minimum": "Minimum players",
  "Joueurs maximum": "Maximum players",
  "La carte est taillée pour {n} joueurs — plus l'expédition est grande, plus le monde l'est, et plus la horde l'est aussi.":
    "The map is cut for {n} players — the bigger the expedition, the bigger the world, and the bigger the horde.",
  "Créer le salon": "Create the room",
  "Rejoindre par code": "Join by code",
  Rejoindre: "Join",
  "Quitter le salon": "Leave the room",
  Salon: "Room",
  "Démarrage automatique dès que le salon atteint {n} joueurs — aucun hôte requis.":
    "Automatic start as soon as the room reaches {n} players — no host needed.",
  "Copier le code": "Copy the code",
  "Partage ce code pour inviter d'autres joueurs.": "Share this code to invite other players.",
  "(toi)": "(you)",
  bot: "bot",
  "Expulser {name}": "Kick {name}",
  "Voter pour expulser {name}": "Vote to kick {name}",
  "En attente…": "Waiting…",
  "Prêt à partir ✓ · {n}/{min} minimum atteint": "Ready to go ✓ · {n}/{min} minimum reached",
  "En attente de joueurs : {n}/{min} minimum": "Waiting for players: {n}/{min} minimum",
  "Départ dans {time} avec une escorte si personne d'autre n'arrive — l'expédition restera ouverte, on peut vous rejoindre en route.":
    "Leaving in {time} with an escort if nobody else arrives — the expedition stays open, others can join you on the way.",
  "{n} héros partiront à l'aventure (3 par joueur).":
    "{n} heroes will set out on the adventure (3 per player).",
  "Ajouter un bot": "Add a bot",
  "Lancer la partie": "Launch the game",
  "Départ automatique dès que le salon est assez rempli.":
    "Automatic departure as soon as the room is full enough.",
  "L'hôte lancera la partie quand tout le monde sera là.":
    "The host will launch the game once everyone's here.",

  // --- compte ---
  "Créer un compte": "Create an account",
  "Un compte permet de te reconnaître dans les parties et de les reprendre depuis n'importe quel appareil.":
    "An account lets the game recognise you across expeditions and resume them from any device.",
  Email: "Email",
  "toi@exemple.fr": "you@example.com",
  Pseudo: "Nickname",
  "Mot de passe": "Password",
  "(6 caractères min.)": "(6 characters min.)",
  "Se connecter": "Sign in",
  "Créer le compte": "Create the account",
  "Pas de compte ? Inscris-toi": "No account? Sign up",
  "Déjà un compte ? Connecte-toi": "Already have an account? Sign in",
  "Autres connexions": "Other sign-in methods",
  "Vérification de Google…": "Checking Google…",
  "Google : non configuré sur ce serveur (variable ECHOTERRA_GOOGLE_CLIENT_ID).":
    "Google: not configured on this server (ECHOTERRA_GOOGLE_CLIENT_ID variable).",
  "Google inaccessible pour le moment — utilise l'email.":
    "Google is unreachable right now — use email instead.",
  "Apple : nécessite le programme développeur Apple (payant) — non prévu.":
    "Apple: requires the paid Apple Developer Program — not planned.",
  "Se déconnecter": "Sign out",
  "Mes parties": "My games",
  "Aucune partie liée à ce compte pour l'instant — les prochaines parties que tu crées ou rejoins apparaîtront ici.":
    "No game linked to this account yet — the next games you create or join will show up here.",
  Partie: "Game",
  "{n}/{min} joueurs": "{n}/{min} players",
  "jour {d} · vague {w}": "day {d} · wave {w}",

  // --- classement ---
  "Type de partie": "Game type",
  Toutes: "All",
  "Toutes les villes, tous types de partie confondus.": "Every town, all game types together.",
  "Villes des parties solo (un joueur et ses bots).": "Towns from solo games (one player and their bots).",
  "Villes des expéditions publiques.": "Towns from public expeditions.",
  "Villes des parties privées entre amis.": "Towns from private games among friends.",
  "🤖 solo": "🤖 solo",
  "🌍 publique": "🌍 public",
  "🎪 privée": "🎪 private",
  "❄️ Nordique": "❄️ Northern",
  "🏜️ Désertique": "🏜️ Desert",
  Saison: "Season",
  "(en cours)": "(current)",
  "Tous les temps": "All time",
  "Classement des villes": "Town leaderboard",
  "Survie la plus longue d'abord, monstres tués en départage.":
    "Longest survival first, monsters killed as tiebreaker.",
  "Toutes saisons confondues.": "All seasons combined.",
  "Le classement repart à chaque saison — les précédentes restent consultables.":
    "The leaderboard resets each season — past ones stay viewable.",
  "Chargement…": "Loading…",
  "Aucune ville dans ce classement — lance une première partie !":
    "No town in this leaderboard — start a first game!",
  "Aucune ville dans cette saison — la place est libre.":
    "No town this season — the spot is open.",
  "Ville sans nom": "Unnamed town",
  "Ville tombée": "Town fallen",
  "Ville encore debout": "Town still standing",
  "Vagues survécues": "Waves survived",
  "Jours tenus": "Days held",
  "Monstres tués": "Monsters killed",

  // --- triche / outils ---
  Triche: "Cheats",
  "Jour {d} · Vague {w}": "Day {d} · Wave {w}",
  "Avancer la vague": "Advance the wave",
  "Passer la vague (sans dégâts ville)": "Skip the wave (no town damage)",
  "+1 Jour (×2 vagues)": "+1 Day (×2 waves)",
  "Lever le brouillard": "Lift the fog",
  "Remettre le brouillard": "Restore the fog",
  "Nouvelle partie": "New game",

  // --- divers ---
  Masquer: "Dismiss",
  "Quelque chose a cassé": "Something broke",
  "L'affichage a rencontré une erreur inattendue. Ta partie est enregistrée côté serveur — recharger devrait suffire à reprendre où tu en étais.":
    "The display hit an unexpected error. Your game is saved on the server — reloading should be enough to pick up where you left off.",
  "Recharger le jeu": "Reload the game",
  "et|énumération": "and",
  "ou|énumération": "or",
  "Tombée à la vague {n}. Nul ne se souvient de ses défenseurs.":
    "Fell on wave {n}. No one remembers its defenders.",
  "Tombée à la vague {n}, défendue par {names}.": "Fell on wave {n}, defended by {names}.",
};
