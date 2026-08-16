// ANGLAIS — les phrases COMPOSÉES PAR LE SERVEUR.
//
// La clé est le gabarit français, verbes fmt de Go compris (`%s`, `%d`, `%%`).
// Voir backend/internal/game/i18n.go pour le contrat, et i18n/index.ts pour le rendu.
//
// ⚠ L'ORDRE DES VERBES EST FIGÉ. La substitution est POSITIONNELLE (c'est ce que Go
// produit) : le premier `%s` de l'anglais reçoit le premier argument du français. On
// peut donc réécrire la phrase, mais pas permuter ses trous. Quand l'anglais voudrait
// vraiment un autre ordre, il faut tourner la phrase autrement — pas déplacer un `%s`.
//
// ⚠ ET LE COMPTE DOIT ÊTRE LE MÊME : trois `%d` en français, trois `%d` en anglais.
// `npm run test:i18n` le vérifie, verbe par verbe, parce qu'un décalage ne se voit pas
// à la lecture et se traduit en jeu par un nombre affiché à la mauvaise place.
//
// Beaucoup de ces phrases sont des REFUS d'action, affichés en toast : elles restent
// courtes et disent ce qui bloque, pas ce qu'il faudrait faire — le joueur est déjà
// devant l'écran qui le lui montre.

export const SERVER: Record<string, string> = {
  // --- ordre du jour et prévision de vague ---
  "%d créatures aux portes — la prochaine vague (%d à %d contre %d de défense) emporterait la ville":
    "%d creatures at the gates — the next wave (%d to %d against %d defense) would take the town",
  "%d créatures aux portes — la vague est estimée entre %d et %d : au pire, la ville tombe":
    "%d creatures at the gates — the wave is estimated between %d and %d: at worst, the town falls",
  "%d créatures dans l'anneau — vague estimée entre %d et %d contre %d de défense (−%d à −%d PV)":
    "%d creatures in the ring — wave estimated between %d and %d against %d defense (−%d to −%d HP)",
  "Abords dégagés — la vague coûterait entre %d et %d PV":
    "Surroundings clear — the wave would cost between %d and %d HP",
  "Abords dégagés — la ville encaissera la prochaine vague sans une égratignure":
    "Surroundings clear — the town will take the next wave without a scratch",
  "Sans Tour de guet, la horde ne s'estime qu'à vue de nez — la bâtir affinerait chaque prévision":
    "Without a Watchtower the horde is guesswork — building one would sharpen every forecast",
  "Tour niveau %d · %d observateur(s) · prévision fiable à %d%% — chaque joueur qui monte resserre la fourchette":
    "Tower level %d · %d scout(s) · forecast %d%% reliable — each player who climbs narrows the range",
  "%d héros ont soif (−%d PA par jour) — le puits tient encore %d rations":
    "%d heroes are thirsty (−%d AP per day) — the well still holds %d rations",
  "%d héros ont soif (−%d PA par jour) et le puits est à sec — il faut rapporter de l'eau":
    "%d heroes are thirsty (−%d AP per day) and the well is dry — water must be brought back",
  "Plus rien à brûler : la ville gèlera cette nuit (−%d PA pour tout le monde) — il faut rapporter du bois":
    "Nothing left to burn: the town will freeze tonight (−%d AP for everyone) — wood must be brought back",
  "Les foyers n'ont plus que %d nuits de bois — le gel coûte %d PA par héros":
    "The hearths have only %d nights of wood left — the cold costs %d AP per hero",
  "%d héros ont pris le gel dehors (−%d PA) — les murs et la cachette abritent, le reste non":
    "%d heroes were caught by the frost outside (−%d AP) — walls and hiding shelter, nothing else does",
  "Le portail est OUVERT — le fermer rend %d de défense":
    "The gate is OPEN — closing it gives back %d defense",
  "La ville est à %d/%d PV — %d %s en Banque, soit %d PV à relever":
    "The town is at %d/%d HP — %d %s at the Bank, enough to raise %d HP",
  "La ville est à %d/%d PV et il n'y a plus de %s pour relever les remparts":
    "The town is at %d/%d HP and there is no %s left to raise the walls",
  "Chantier de %s en pause — il manque %s": "%s construction paused — missing %s",
  "Chantier de %s : %d/%d PA investis": "%s construction: %d/%d AP invested",
  "%s niveau %d : il manque %s": "%s level %d: missing %s",
  "« %s » est en Banque — le chantier de %s peut s'ouvrir":
    "“%s” is at the Bank — the %s construction can start",
  "%s à %d%% — chaque PA de réparation rend de la défense":
    "%s at %d%% — every AP of repair gives defense back",

  // --- journal de la ville ---
  "1 vague passée sans personne — la horde a rôdé sans attaquer.":
    "1 wave passed with nobody here — the horde prowled without attacking.",
  "%d vagues passées sans personne — la horde a rôdé sans attaquer.":
    "%d waves passed with nobody here — the horde prowled without attacking.",
  "Plus rien à brûler : les foyers se sont éteints, la ville a gelé (−%d PA)":
    "Nothing left to burn: the hearths went out and the town froze (−%d AP)",
  "⚒️ %s a fabriqué %s (ingrédients de la Banque)": "⚒️ %s crafted %s (ingredients from the Bank)",
  "⚠️ %s est tétanisé — sa consigne n'a pas pu s'appliquer":
    "⚠️ %s is pinned — their standing order could not run",
  "✨ %s a utilisé %s": "✨ %s used %s",
  "🍽️ %s a consommé « %s » sur la réserve commune": "🍽️ %s consumed “%s” from the common stores",
  "🏗️ %s a achevé l'amélioration de %s (niveau %d, matériaux prélevés à la Banque)":
    "🏗️ %s completed the upgrade of %s (level %d, materials taken from the Bank)",
  "🏗️ %s a achevé la construction de %s": "🏗️ %s completed the construction of %s",
  "🏗️ %s a travaillé sur %s (+%d PA — %d/%d)": "🏗️ %s worked on %s (+%d AP — %d/%d)",
  "🏥 %s a soigné %s à l'Infirmerie (+%d PV)": "🏥 %s healed %s at the Infirmary (+%d HP)",
  "💧 %s a puisé une ration d'eau au puits": "💧 %s drew a water ration from the well",
  "📌 %s demande %d %s au Panneau": "📌 %s is requesting %d %s on the Board",
  "📐 %s a posé %s (%d PA à investir)": "📐 %s laid %s (%d AP to invest)",
  "📐 %s a posé le plan d'amélioration de %s (niveau %d — %d PA à investir)":
    "📐 %s laid the upgrade plan for %s (level %d — %d AP to invest)",
  "📐 %s a posé le plan de chantier de %s (%d PA à investir)":
    "📐 %s laid the construction plan for %s (%d AP to invest)",
  "📦 %s a déposé %d objet(s) à la Banque": "📦 %s deposited %d item(s) at the Bank",
  "🔧 %s a réparé %s (+%d durabilité)": "🔧 %s repaired %s (+%d durability)",
  "🔭 %s a observé la horde depuis la Tour (%d observateur(s), précision %d%%)":
    "🔭 %s watched the horde from the Tower (%d scout(s), %d%% accuracy)",
  "🚪 %s a FERMÉ la porte de la ville": "🚪 %s CLOSED the town gate",
  "🚪 %s a OUVERT la porte de la ville": "🚪 %s OPENED the town gate",
  "🛏️ %s a ressuscité %s au Townhall": "🛏️ %s revived %s at the Town Hall",
  "🤝 %s a servi la demande de %s (%d %s)": "🤝 %s fulfilled %s's request (%d %s)",
  "🤝 %s rejoint l'expédition avec %d héros": "🤝 %s joins the expedition with %d heroes",
  "🧱 %s a relevé les remparts (+%d PV, %d %s)": "🧱 %s raised the walls (+%d HP, %d %s)",

  // --- refus : héros, déplacement, terrain ---
  "%s a déjà atteint sa classe avancée": "%s has already reached their advanced class",
  "%s a déjà puisé sa part d'eau aujourd'hui": "%s has already drawn their share of water today",
  "%s a déjà tous ses points d'action": "%s already has all their action points",
  "%s doit être en ville pour monter à la tour": "%s must be in town to climb the tower",
  "%s doit être en ville pour servir une demande": "%s must be in town to fulfil a request",
  "%s est bien trop massif pour être poussé": "%s is far too massive to be pushed",
  "%s est déjà au maximum de durabilité": "%s is already at maximum durability",
  "%s est déjà au niveau maximum": "%s is already at maximum level",
  "%s est déjà déblayée": "%s has already been cleared out",
  "%s est encore ensevelie — il faut d'abord la déblayer":
    "%s is still buried — it must be cleared out first",
  "%s est entravé (Root)": "%s is rooted (Root)",
  "%s est tétanisé et ne peut pas bouger": "%s is pinned and cannot move",
  "%s est tétanisé — impossible de fouiller sous les griffes de la horde":
    "%s is pinned — no searching under the horde's claws",
  "%s est tétanisé — impossible de se cacher sous les griffes de la horde":
    "%s is pinned — no hiding under the horde's claws",
  "%s est tétanisé — impossible de travailler sous les griffes de la horde":
    "%s is pinned — no working under the horde's claws",
  "%s est épuisée — plus rien à y trouver": "%s is exhausted — nothing left to find there",
  "%s exige d'être %s": "%s requires being %s first",
  "%s n'a pas assez de PA pour « %s »": "%s does not have enough AP for “%s”",
  "%s n'a pas de ration d'eau dans son sac": "%s has no water ration in their bag",
  "%s n'a pas « %s » dans son sac": "%s does not have “%s” in their bag",
  "%s n'a plus de point d'action": "%s has no action points left",
  "%s n'est pas encore construit": "%s is not built yet",
  "%s n'est pas encore construite": "%s is not built yet",
  "%s ne maîtrise pas « %s »": "%s has not mastered “%s”",
  "%s ne peut évoluer qu'à partir du jour %d (actuellement jour %d)":
    "%s cannot evolve before day %d (currently day %d)",
  "%s ne se consomme pas": "%s cannot be consumed",
  "%s ne se porte pas": "%s cannot be worn",
  "%s nécessite %s niveau %d": "%s requires %s level %d",
  "%s nécessite le bâtiment %s": "%s requires the %s building",
  "%s nécessite un bâtiment de la ville (atelier/forge)":
    "%s requires a town building (workshop/forge)",
  "%s requiert %s niveau %d": "%s requires %s level %d",
  "%s s'est déjà déplacé ce tour": "%s has already moved this turn",
  "%s tient déjà cette arme": "%s is already holding that weapon",
  "cela ne servirait à rien maintenant — %s est déjà au mieux":
    "this would do nothing right now — %s is already at their best",
  "PA insuffisants": "Not enough AP",
  "PA insuffisants pour %s": "Not enough AP for %s",
  "explorer coûte %d PA": "exploring costs %d AP",
  "observer coûte %d PA": "scouting costs %d AP",
  "déplacement invalide (une case orthogonale)": "invalid move (one orthogonal tile)",
  "case inaccessible": "tile unreachable",
  "case invalide": "invalid tile",
  "case hors de portée": "tile out of range",
  "ce terrain n'a rien à fouiller": "this terrain has nothing to search",
  "rien trouvé": "nothing found",
  "rien à fouiller en ville — le stock est à la Banque":
    "nothing to search in town — the stock is at the Bank",
  "inutile de se cacher en ville — la ville protège déjà ses habitants":
    "no need to hide in town — the town already protects its people",
  "la porte de la ville est fermée — impossible d'entrer":
    "the town gate is closed — you cannot get in",
  "la porte de la ville est fermée — impossible de sortir":
    "the town gate is closed — you cannot get out",
  "héros introuvable": "hero not found",
  "héros invalide": "invalid hero",
  "ce héros appartient à un autre joueur": "this hero belongs to another player",

  // --- refus : combat ---
  "ce héros est en plein combat": "this hero is in the middle of a battle",
  "ce héros est déjà en plein combat": "this hero is already in the middle of a battle",
  "aucun ennemi sur cette case": "no enemy on this tile",
  "aucun monstre sur cette case": "no monster on this tile",
  "ennemi introuvable": "enemy not found",
  "combat introuvable": "battle not found",
  "le combat est terminé": "the battle is over",
  "ce n'est pas le tour de cette unité": "it is not this unit's turn",
  "cette unité n'est pas contrôlable": "this unit cannot be controlled",
  "aucun de tes héros ne participe à ce combat": "none of your heroes is in this battle",
  "compétence inconnue": "unknown skill",
  "cible invalide": "invalid target",
  "cible hors de portée ou hors de vue": "target out of range or out of sight",
  "cible hors de portée de poussée": "target out of push range",
  "rejoins le bord bas de l'arène pour fuir": "reach the bottom edge of the arena to flee",
  "cet objet ne s'utilise pas en combat": "this item cannot be used in battle",
  "pas de « %s » dans le sac": "no “%s” in the bag",
  "« %s » n'est pas une arme": "“%s” is not a weapon",
  "aucune cible à portée pour « %s »": "no target in range for “%s”",
  "la cible est trop vigoureuse (PV > 5) pour un Tir précis":
    "the target is too healthy (HP > 5) for a Precise Shot",
  "action inconnue": "unknown action",

  // --- refus : ville, chantiers, craft ---
  "action de ville inconnue": "unknown town action",
  "action réservée au Townhall": "action reserved for the Town Hall",
  "action réservée au puits": "action reserved for the well",
  "action réservée aux remparts": "action reserved for the walls",
  "action réservée à l'Infirmerie": "action reserved for the Infirmary",
  "action réservée à la porte": "action reserved for the gate",
  "bâtiment introuvable": "building not found",
  "aucun de tes héros n'est dans la ville": "none of your heroes is in the town",
  "aucun héros dans la ville": "no hero in the town",
  "sélectionne lequel de tes héros paie l'action (heroId)":
    "select which of your heroes pays for the action (heroId)",
  "sélectionnez un héros présent dans la ville pour puiser":
    "select a hero present in town to draw water",
  "le puits est à sec": "the well is dry",
  "la ville est intacte": "the town is untouched",
  "il faut de la %s à la Banque pour relever les remparts":
    "you need %s at the Bank to raise the walls",
  "il faut trouver « %s » et le déposer à la Banque pour poser ce chantier":
    "you must find “%s” and deposit it at the Bank to lay this construction",
  "matériau manquant dans la banque : %s (les PA déjà investis restent acquis)":
    "material missing at the bank: %s (the AP already invested is kept)",
  "aucun héros à ressusciter": "no hero to revive",
  "le lit du Townhall a déjà servi aujourd'hui": "the Town Hall bed has already been used today",
  "personne à soigner en ville": "nobody to heal in town",
  "l'Infirmerie a déjà fait son service aujourd'hui": "the Infirmary has already done its rounds today",
  "l'Infirmerie est en ruine": "the Infirmary is in ruins",
  "il faut une Tour de guet pour observer la horde": "you need a Watchtower to scout the horde",
  "ton équipe a déjà observé cette vague — laisse la place aux autres":
    "your team has already scouted this wave — leave room for the others",
  "recette inconnue": "unknown recipe",
  "ingrédient manquant dans le sac : %s": "ingredient missing from the bag: %s",
  "ingrédient manquant à la Banque : %s": "ingredient missing from the Bank: %s",
  "emplacement inconnu": "unknown slot",
  "classe invalide pour cette évolution": "invalid class for this evolution",
  "consigne inconnue": "unknown standing order",

  // --- refus : ruines ---
  "aucune ruine sur cette case": "no ruin on this tile",
  "ruine introuvable": "ruin not found",
  "donjon corrompu": "corrupted dungeon",

  // --- refus : panneau, requêtes, messagerie ---
  "demande introuvable": "request not found",
  "cette demande n'est pas la tienne": "this request is not yours",
  "cette demande a déjà été honorée par %s": "this request has already been fulfilled by %s",
  "la Banque n'a que %d %s sur les %d demandés": "the Bank only has %d %s out of the %d requested",
  "se servir soi-même n'est pas rendre service": "serving yourself is not doing anyone a service",
  "le demandeur n'a plus de héros en vie": "the requester has no living hero left",
  "tu as déjà une demande au Panneau — retire-la d'abord":
    "you already have a request on the Board — remove it first",
  "que te faut-il ?": "what do you need?",
  "message vide": "empty message",
  "doucement — attends quelques secondes avant de renvoyer un message":
    "easy there — wait a few seconds before sending another message",
  "aucun de tes héros n'est en ville — construis la Poste pour écrire depuis le terrain":
    "none of your heroes is in town — build the Post Office to write from the field",

  // --- refus : salon, joueurs, comptes ---
  "joueur inconnu": "unknown player",
  "joueur inconnu — reconnecte-toi à la partie": "unknown player — reconnect to the game",
  "partie introuvable": "game not found",
  "partie complète (%d/%d joueurs)": "game full (%d/%d players)",
  "en attente de joueurs (%d/%d minimum)": "waiting for players (%d/%d minimum)",
  "la partie a déjà commencé": "the game has already started",
  "impossible de quitter une partie déjà lancée": "you cannot leave a game already under way",
  "les portes de cette expédition sont fermées (accueil terminé)":
    "this expedition's doors are closed (boarding is over)",
  "aucune partie ouverte avec ce code": "no open game with that code",
  "code de partie requis": "game code required",
  "seul l'hôte peut lancer la partie": "only the host can launch the game",
  "seul l'hôte peut ajouter un bot": "only the host can add a bot",
  "seul l'hôte peut expulser un joueur": "only the host can kick a player",
  "pas de bots dans une partie publique": "no bots in a public game",
  "partie publique — elle démarre automatiquement quand assez de joueurs ont rejoint":
    "public game — it starts automatically once enough players have joined",
  "partie publique — l'expulsion se décide par un vote": "public game — kicking is decided by a vote",
  "partie privée — seul l'hôte peut expulser": "private game — only the host can kick",
  "le vote d'expulsion n'existe qu'en salle d'attente": "kick votes only exist in the waiting room",
  "les bots ne votent pas": "bots do not vote",
  "tu as déjà voté contre ce joueur": "you have already voted against this player",
  "impossible de voter contre soi-même (quitter le salon)":
    "you cannot vote against yourself (leave the room instead)",
  "l'hôte ne peut pas s'expulser lui-même (quitter le salon)":
    "the host cannot kick themselves (leave the room instead)",
  "connecte-toi pour rejoindre une partie publique": "sign in to join a public game",
  "mode inconnu : %s": "unknown mode: %s",

  // --- refus : authentification et administration ---
  "connexion requise": "sign-in required",
  "non connecté": "not signed in",
  "jeton invalide": "invalid token",
  "corps invalide": "invalid body",
  "langue inconnue": "unknown language",
  "adresse email invalide": "invalid email address",
  "mot de passe trop court (6 caractères minimum)": "password too short (6 characters minimum)",
  "email ou mot de passe incorrect": "incorrect email or password",
  "un compte existe déjà avec cet email": "an account already exists with this email",
  "impossible de créer le compte (email déjà pris ?)":
    "could not create the account (email already taken?)",
  "ce compte utilise « Continuer avec Google »": "this account uses “Continue with Google”",
  "connexion Google non configurée sur ce serveur": "Google sign-in is not configured on this server",
  "credential Google manquant": "missing Google credential",
  "jeton Google invalide": "invalid Google token",
  "jeton Google émis pour une autre application": "Google token issued for another application",
  "email Google non vérifié": "unverified Google email",
  "battement non configuré (ECHOTERRA_TICK_TOKEN)": "heartbeat not configured (ECHOTERRA_TICK_TOKEN)",
  "jeton de battement invalide": "invalid heartbeat token",
  "mesures non configurées (ECHOTERRA_TICK_TOKEN)": "metrics not configured (ECHOTERRA_TICK_TOKEN)",

  // --- réseau (composé côté client, même contrat) ---
  "Le serveur a répondu %d.": "The server replied %d.",
  "Connexion au serveur perdue — vérifie ta connexion.":
    "Lost connection to the server — check your network.",
};
