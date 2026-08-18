// ─────────────────────────────────────────────────────────────────────────────
// FRANÇAIS — LA SOURCE.
//
// C'est le seul fichier où l'on ÉCRIT un texte neuf ; les sept autres langues
// le traduisent. Ajouter une clé ici fait aussitôt échouer `tsc` sur les sept
// autres (`Locale = Record<TKey, string>`) : c'est voulu, et c'est ce qui rend
// « chaque nouveau texte est écrit dans toutes les langues » vérifiable plutôt
// que promis.
//
// ⚠ CE QU'ON NE MET PAS ICI : les valeurs qui portent de la LOGIQUE DE JEU —
// `"Ration d'eau"`, `"Plan de la Tour"`, `"Tétanisé"`, les ids de bâtiment. Ce
// sont des identifiants qui se trouvent être français ; les traduire casse les
// recettes, les bots et les modèles voxel. On traduit leur AFFICHAGE
// (`item.*`, `state.*`), jamais la valeur comparée.
//
// ⚠ Les paramètres s'écrivent `{nom}` et doivent se retrouver À L'IDENTIQUE
// dans les huit langues (vérifié par `npm run test:i18n`). L'ordre des mots,
// lui, est libre — c'est tout l'intérêt de ne pas concaténer.
// ─────────────────────────────────────────────────────────────────────────────

export const fr = {
  // ── Générique ─────────────────────────────────────────────────────────────
  "app.back": "Retour",
  "app.close": "Fermer",
  "app.cancel": "Annuler",
  "app.confirm": "Valider",
  "app.resume": "Reprendre",
  "app.loading": "Chargement",
  "app.none": "Aucun",
  "app.yes": "Oui",
  "app.no": "Non",
  "app.error": "Une erreur est survenue",

  // ── Barre de navigation ───────────────────────────────────────────────────
  "nav.aria": "Navigation principale",
  "nav.home": "Ville",
  "nav.stock": "Sac",
  "nav.map": "Carte",
  "nav.structure": "Bâtir",
  "nav.craft": "Atelier",
  "nav.locked": "Aucun de tes héros n'est en ville.",
  "nav.sites.one": "{n} chantier en cours",
  "nav.sites.other": "{n} chantiers en cours",

  // ── Barre du haut ─────────────────────────────────────────────────────────
  "topbar.heroes": "Mes personnages",
  "topbar.status": "État de la ville — PV et PA de ton équipe",
  "topbar.journal": "Journal de la ville",
  "topbar.chat": "Messages de la ville",
  "topbar.settings": "Paramètres",
  "topbar.catchingUp": "Rattrapage…",
  "topbar.nextWave": "Prochaine vague — état de la ville",
  "topbar.hp": "PV",
  "topbar.favor.ready": "Faveur des dieux {favor}/{goal} — un dieu peut être appelé au Temple",
  "topbar.favor.gather": "Faveur des dieux {favor}/{goal} — fabrique des offrandes à l'Atelier",
  "topbar.favor.noTemple": "Faveur des dieux {favor}/{goal} — il reste à bâtir le {temple}",

  // ── Écran de chargement / cinématique ─────────────────────────────────────
  "loading.skip": "Passer le chargement",
  "cinematic.start": "Commencer la partie",
  "cinematic.caption": "Il y a bien longtemps…",
  "cinematic.skip": "Passer",

  // ── Écran titre ───────────────────────────────────────────────────────────
  "title.signIn": "Connexion",
  "title.resume.solo": "REPRENDRE — SOLO",
  "title.resume.mp": "REPRENDRE — PARTIE",
  "title.resume.expedition": "Expédition",
  "title.resume.lobby": "Salon en attente · {players}/{min} joueurs",
  "title.resume.meta": "Jour {day} · 🏰 {hp}% · 🌊 {timer}",
  "title.solo": "Solo",
  "title.solo.hint": "(avec 4 bots)",
  "title.public": "Parties publiques",
  "title.public.locked": "🔒 connexion requise",
  "title.public.needAccount": "🔒 Connecte-toi pour rejoindre une partie publique.",
  "title.private": "Parties privées",
  "title.leaderboard": "Classement",
  "title.settings": "Paramètres",
  "title.debug": "Debug",
  "title.debug.newGame": "Nouvelle partie test",
  "title.debug.continue": "Continuer",
  "title.debug.intro": "Intro",
  "title.debug.editor": "Éditeur",
  "title.debug.designer": "Données",
  "title.debug.voxels": "Voxels",
  "title.debug.chars": "Persos",

  // ── Paramètres ────────────────────────────────────────────────────────────
  "settings.title": "Paramètres",
  "settings.game": "Jeu",
  "settings.language": "Langue",
  "settings.notifications": "Notifications",
  "settings.devTools": "Outils de test",
  "settings.quit": "Quitter la partie",
  "settings.gameTitle": "Réglages du jeu",
  "settings.music": "Volume — Musique ({n}%)",
  "settings.sfx": "SFX ({n}%)",
  "settings.fps": "Fréquence d'affichage",
  "settings.fps.hint":
    "Réduire le taux de rafraîchissement économise la batterie et évite la surchauffe, mais peut affecter la fluidité.",
  "settings.idleAnim": "Animation des personnages",
  "settings.idleAnim.hint":
    "Cadence de l'animation au repos : héros qui respirent, monstres qui remuent sur la carte. « Figée » les immobilise tant que rien ne bouge — la carte ne se redessine plus du tout au repos, c'est le réglage le plus économe en batterie. Les déplacements, attaques et morts restent toujours pleinement animés.",
  "settings.idleAnim.frozen": "Figée",
  "settings.weather": "Effets de météo",
  "settings.weather.hint":
    "Ce que le climat d'une expédition fait bouger : la neige qui tombe sous un ciel couvert en pays nordique, les vire-vents qui roulent au désert. « Aucun » ne les fige pas — il les supprime : plus une image demandée, plus un objet dans la scène. Une expédition tempérée n'a pas de météo et ne coûte rien quel que soit ce réglage.",
  "settings.rate.eco": "Éco",
  "settings.rate.smooth": "Fluide",
  "settings.rate.max": "Max",
  "settings.quality": "Qualité graphique",
  "settings.quality.hint": "Baisser la qualité réduit l'usage de batterie et la surchauffe.",
  "settings.quality.normal": "Normale",
  "settings.quality.medium": "Moyenne",
  "settings.quality.high": "Haute",
  "settings.quality.veryHigh": "Très haute",
  "settings.terrain": "Terrain voxel",
  "settings.terrain.slopes": "Pentes voxel",
  "settings.terrain.blocks": "Blocs",
  "settings.terrain.hint":
    "Pentes voxel = relief en petites marches de voxels (¼ de tuile, style diorama) ; Blocs = piliers pleine tuile. Carte monde uniquement.",
  "settings.beauty": "Rendu beauté (expérimental)",
  "settings.beauty.cinematic": "Cinématique",
  "settings.beauty.standard": "Standard",
  "settings.beauty.hint":
    "Lumière filmique (tone mapping ACES), halo lumineux sur les cristaux/fleurs, ciel dégradé et brume atmosphérique. Plus joli mais plus gourmand — coûte du GPU à chaque redraw.",
  "settings.signac": "Rendu Signac (divisionniste)",
  "settings.signac.painting": "Peinture",
  "settings.signac.normal": "Normal",
  "settings.signac.hint":
    "Chaque facette de voxel devient sa propre touche de couleur pure, à la manière de Paul Signac : ombres violettes plutôt que grises, saturation haute, mélange optique. La touche est ancrée au MONDE — elle tourne et se resserre avec la géométrie, et les arêtes restent nettes.",
  "settings.signac.strength": "Intensité de la touche ({n}%)",
  "settings.signac.strength.hint":
    "Au minimum, seul le parti pris de couleur reste ; au maximum, la trame de touches domine.",
  "settings.language.auto": "Langue du téléphone",
  "settings.language.hint":
    "Change la langue de toute l'application. Les noms de ville, de héros et les messages écrits par les joueurs restent tels qu'ils ont été écrits.",
  "settings.notif.loot": "Butin",
  "settings.notif.loot.desc": "Me notifier de chaque fouille réussie.",
  "settings.notif.wave": "Vague",
  "settings.notif.wave.desc": "Me notifier 10 minutes avant chaque vague.",
  "settings.notif.actionPoint": "Points d'action",
  "settings.notif.actionPoint.desc": "Me notifier quand la barre de PA est pleine.",
  "settings.notif.communication": "Messages",
  "settings.notif.communication.desc": "Me notifier quand un ami envoie un message privé.",

  // ── Bâtiments (noms, descriptions, action principale) ─────────────────────
  // ⚠ l'ID (`townhall`, `wall`…) ne change JAMAIS : c'est lui que le serveur,

  // ── États d'un héros (affichage) ─────────────────────────────────────────
  // ⚠ la VALEUR (`"Tétanisé"`) reste française : c'est ce que le serveur envoie
  // et ce que le code compare. Seul son AFFICHAGE est traduit.
  "state.tetanise": "Tétanisé",
  "state.cache": "Caché",
  "state.blesse": "Blessé",
  "state.fatigue": "Fatigue",
  "state.soif": "Soif",
  "state.gele": "Gelé",

  // ── Pastille de héros ────────────────────────────────────────────────────
  "hero.chip.down": "{name} est à terre",
  "hero.chip.select": "Sélectionner {name}",
  "hero.chip.sheet": "Fiche du personnage",

  // ── Barre des héros sur la carte ─────────────────────────────────────────
  "map.hint.snow": "{name} a la case ensevelie sous la neige — fouiller la dégage et relance la récolte.",
  "map.hint.forage": "{name} fouille sur place — prochaine trouvaille dans {timer} (sans PA ; bouger l'interrompt).",
  "map.hint.inTown": "{name} est en ville — tape une case adjacente pour le faire sortir.",
  "map.hint.stuck": "{name} est {state} — tue le pack ou fuis.",
  "map.hint.cliff.one": "{name} franchit {n} niveau — les cases rouges sont trop escarpées : contourne, ou gagne en athlétisme (Bottes cloutées).",
  "map.hint.cliff.other": "{name} franchit {n} niveaux — les cases rouges sont trop escarpées : contourne, ou gagne en athlétisme (Bottes cloutées).",
  "map.hint.selected": "{name} sélectionné — tape les losanges jaunes pour le déplacer.",


  // ── Menu radial d'un héros sur la carte ──────────────────────────────────
  "map.menu.fight": "Combattre",
  "map.menu.skill.title": "{name} (-{pa} PA) — {desc}",
  "map.menu.drink": "Boire une ration",
  "map.menu.drink.gain": "+{pa} PA · {n}",
  "map.menu.drink.title": "Restaure {pa} PA (consomme une ration d'eau du sac)",
  "map.menu.tower.build": "Bâtir la tour de guet",
  "map.menu.tower.title": "Vue permanente sur {n} cases, pour toute l'expédition. Matériaux : {materials}",
  "map.menu.tower.built": "Tour de guet",
  "map.menu.tower.builtDesc": "Veille permanente sur {n} cases — la vue est acquise.",
  "map.menu.ruin.clear": "Déblayer",
  "map.menu.ruin.explore": "Explorer",
  "map.menu.ruin.empty": "Donjon épuisé",
  "map.menu.orders.title": "Si je ne reviens pas :",
  "map.menu.orders.shelter": "Se cacher",
  "map.menu.orders.return": "Rentrer",
  "map.menu.orders.noPa": "Sans PA, aucune consigne ne peut s'exécuter.",
  "map.menu.orders.tooFar": "{dist} cases jusqu'à la ville pour {pa} PA — trop loin : il se cacherait sur place.",
  "map.menu.inTown": "En ville — fouille et cachette inutiles ici",
  "map.menu.forage.auto": "Fouille auto",
  "map.menu.forage.autoTitle": "La récolte tourne toute seule, sans PA",
  "map.menu.search": "Fouiller",
  "map.menu.search.title": "Fouiller (-{pa} PA) — le héros continue ensuite tout seul",
  "map.menu.hide": "Se cacher",
  "map.menu.hide.title": "Se cacher (-{pa} PA)",
  "map.menu.hide.stuck": "{state} — impossible de se cacher",
  "map.menu.escape": "S'échapper",
  "map.menu.escape.title": "S'échapper (-{pa} PA)",
  "hero.menu.inTown": "en ville",
  "hero.menu.forage.auto": "fouille auto",
  "hero.menu.forage.autoTitle": "Fouille automatique — sans PA",
  "hero.menu.drink.title": "Boire une ration d'eau (+{pa} PA) — {n} en réserve",

  // ── Barre d'outils de la carte ───────────────────────────────────────────
  "map.controls.join": "Rejoindre le combat ({x},{y}) — tes héros y sont !",
  "map.controls.others": "Autres",
  "map.controls.others.title": "Afficher/masquer les héros des autres joueurs (sprites translucides)",

  // ── Fin de combat ────────────────────────────────────────────────────────
  "combat.end.win": "Victoire !",
  "combat.end.flee": "Repli !",
  "combat.end.loss": "Défaite…",
  "combat.end.summary.one": "{n} tour · {alive}/{total} héros debout",
  "combat.end.summary.other": "{n} tours · {alive}/{total} héros debout",
  "combat.end.loot": "Butin",
  "combat.end.fled": "L'équipe s'est repliée — pas de butin, et le pack rôde toujours sur la case…",
  "combat.end.lost": "Les survivants battent en retraite vers la ville…",
  "combat.end.back": "Retour à la carte",
  "combat.hp": "PV",

  // les bots et les modèles voxel connaissent. Seul ce libellé est traduit.
  "building.townhall.name": "Mairie",
  "building.townhall.blurb": "Cœur de la ville. Lit : ressuscite un héros épuisé.",
  "building.townhall.primary": "Ressusciter un héros",
  "building.bank.name": "Banque",
  "building.bank.blurb": "Stocke les ressources & matériaux communs.",
  "building.bank.primary": "Entrer",
  "building.panel.name": "Panneau",
  "building.panel.blurb": "Journal, sondage, membres.",
  "building.panel.primary": "Journal",
  "building.wall.name": "Muraille",
  "building.wall.blurb": "Muraille défensive.",
  "building.wall.primary": "",
  "building.tower.name": "Tour",
  "building.tower.blurb": "Augmente vos dégâts contre la vague.",
  "building.tower.primary": "Évaluer l'attaque",
  "building.gate.name": "Portail",
  "building.gate.blurb": "Grande porte de la ville.",
  "building.gate.primary": "Ouvrir / Fermer",
  "building.well.name": "Puits",
  "building.well.blurb": "Source d'eau de la ville.",
  "building.well.primary": "Puiser de l'eau",
  "building.workshop.name": "Atelier",
  "building.workshop.blurb": "Menuiserie & forge — gère les constructions.",
  "building.workshop.primary": "",
  "building.kitchen.name": "Cuisine",
  "building.kitchen.blurb": "Feu de camp / cuisine.",
  "building.kitchen.primary": "Cuisiner",
  "building.recyclerie.name": "Recyclerie",
  "building.recyclerie.blurb":
    "Recycle les débris ramassés en matériaux de construction (Bois/Pierre).",
  "building.recyclerie.primary": "",
  "building.poste.name": "Poste",
  "building.poste.blurb":
    "Relais de courrier. Tant qu'elle n'est pas debout, on n'écrit à la ville que DEPUIS la ville.",
  "building.poste.primary": "Messagerie",
  "building.infirmerie.name": "Infirmerie",
  "building.infirmerie.blurb":
    "Soigne les héros blessés. Rien d'autre dans le jeu ne rend des PV à un héros.",
  "building.infirmerie.primary": "Soigner un héros",
  "building.cartographe.name": "Cartographe",
  "building.cartographe.blurb":
    "Élargit la vue de tous les héros — on prospecte moins à l'aveugle.",
  "building.cartographe.primary": "",
  "building.armurerie.name": "Armurerie",
  "building.armurerie.blurb":
    "Arme les héros : force accrue en combat. Le seul bâtiment dont l'effet sort des murs.",
  "building.armurerie.primary": "",
  "building.caserne.name": "Caserne",
  "building.caserne.blurb":
    "Loge la garnison : les héros présents défendent davantage, sans ajouter un point de pierre.",
  "building.caserne.primary": "",
  "building.verger.name": "Verger",
  "building.verger.blurb":
    "Regarnit les cases proches à chaque vague — la réponse à une carte qui s'épuise.",
  "building.verger.primary": "",
  "building.temple.name": "Temple",
  "building.temple.blurb":
    "Les offrandes fabriquées à l'Atelier y deviennent la faveur des dieux — et c'est là que la ville vote la bénédiction qu'elle appelle.",
  "building.temple.primary": "Appeler un dieu",
  // ── Pastilles de la ville (VoxelTownView) ─────────────────────────────────
  "town.spot.site": "{building} — chantier à lancer",
  "town.spot.durability": "{building} — durabilité {pct} %",
  "building.unknown.name": "Bâtiment",
} as const;

export default fr;
