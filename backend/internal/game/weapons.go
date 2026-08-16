package game

// LES ARMES FONT LE COMBAT — les archétypes et leurs techniques.
//
// Le trou que ça bouche : depuis equipment.go, une arme portée donnait des CHIFFRES
// (force, dextérité) et, pour deux d'entre elles, une portée. Mais au combat, un héros
// à l'arc et un héros à l'épée jouaient le même tour avec les mêmes boutons : « Attaque »,
// les compétences de sa CLASSE, « Défendre ». L'arme changeait la valeur de l'attaque,
// jamais la façon de la jouer.
//
// Ici chaque arme appartient à un ARCHÉTYPE (épée, dague, lance, arc, bâton) et
// l'archétype apporte une TECHNIQUE : une action de combat de plus, disponible à qui la
// PORTE, quelle que soit sa classe. C'est le second axe du personnage — la classe dit ce
// que le héros sait faire, l'arme dit avec quoi il le fait :
//
//	épée  → Fauchage      : frappe la case visée ET ses quatre voisines (les packs)
//	dague → Coup bas      : 30 % d'étourdissement (neutraliser plutôt que tuer)
//	lance → Estoc         : portée 2 ET repousse la cible (tenir à distance)
//	arc   → Tir en cloche : portée 2-4, ignore la couverture, INUTILISABLE au contact
//	bâton → Balayage      : entrave la cible (Root)
//
// ⚠ L'ARCHÉTYPE EST PORTÉ PAR LE CATALOGUE, pas par un `switch` sur le nom de l'objet :
// une arme ajoutée dans equipment.go hérite de sa technique sans toucher au combat.
//
// ⚠ AUCUNE PÉNALITÉ AUX MAINS NUES. Un héros sans arme garde son attaque de base et ses
// compétences de classe : la technique est un GAIN, pas une taxe. Le contraire punirait
// les parties où rien n'a encore été forgé — c'est-à-dire toutes les premières vagues.

// Archétypes d'arme. Vide = mains nues (pas de technique).
const (
	ArchSword  = "epee"
	ArchDagger = "dague"
	ArchSpear  = "lance"
	ArchBow    = "arc"
	ArchStaff  = "baton"
)

// weaponTechnique rend la technique de combat d'un archétype.
//
// L'ÉCONOMIE : une technique n'est jamais strictement meilleure que l'attaque de base.
// Le Fauchage ne gagne rien sur une cible isolée ; l'Estoc pousse (ce qui peut ÉLOIGNER
// une cible qu'on voulait finir) ; le Tir en cloche ne peut pas viser au contact. Chacune
// répond à une situation, et c'est ce choix-là qui fait le tour de jeu.
func weaponTechnique(arch string) (AttackDef, bool) {
	switch arch {
	case ArchSword:
		return AttackDef{
			Name: "Fauchage", Kind: "special",
			Desc:    "Large moulinet : frappe la case visée et ses quatre voisines.",
			Targets: orthCells(), Damage: orthCells(), DmgStat: "force", Cooldown: 2,
		}, true
	case ArchDagger:
		return AttackDef{
			Name: "Coup bas", Kind: "special",
			Desc:    "Frappe sournoise : 30 % d'étourdir la cible.",
			Targets: orthCells(), DmgStat: "force", Bonus: 1, StunPct: 30, Cooldown: 2,
		}, true
	case ArchSpear:
		return AttackDef{
			Name: "Estoc", Kind: "special",
			Desc:    "Botte longue (portée 2) qui repousse la cible d'une case.",
			Targets: manhattanCells(1, 2), DmgStat: "force", Bonus: 2, Push: true, Cooldown: 2,
		}, true
	case ArchBow:
		return AttackDef{
			Name: "Tir en cloche", Kind: "special",
			Desc:    "Flèche en cloche (portée 2 à 4) : passe par-dessus les abris. Inutilisable au contact.",
			Targets: manhattanCells(2, 4), DmgStat: "dexterite", Bonus: 1, IgnoreCover: true, Cooldown: 2,
		}, true
	case ArchStaff:
		return AttackDef{
			Name: "Balayage", Kind: "special",
			Desc:    "Coup circulaire qui fauche les jambes (Root).",
			Targets: orthCells(), DmgStat: "precision", Bonus: 1, Root: true, Cooldown: 2,
		}, true
	}
	return AttackDef{}, false
}

// WeaponArchetype rend l'archétype de l'arme nommée ("" = mains nues / pas une arme).
func WeaponArchetype(name string) string {
	if d, ok := Equipment[name]; ok && d.Slot == SlotWeapon {
		return d.Weapon
	}
	return ""
}

// WeaponTechniqueOf rend la technique de l'arme nommée — servie au client (fiche de
// personnage : « ce que cette arme change au combat »).
func WeaponTechniqueOf(name string) (AttackDef, bool) { return weaponTechnique(WeaponArchetype(name)) }

// --- Changer d'arme EN PLEIN COMBAT ------------------------------------------------

// SwapWeapon : le héros range son arme et en dégaine une autre de son sac.
//
// POURQUOI C'EST UNE ACTION DE COMBAT et pas un réglage d'avant-match : porter l'arc ET
// l'épée, c'est accepter de perdre un tour à changer de registre quand la mêlée se ferme.
// Sans ce coût, on garderait toujours l'arme optimale et l'archétype ne serait plus un
// choix ; avec lui, l'inventaire du héros devient une petite décision par combat.
//
// Un nom vide range l'arme (mains nues) — utile pour rendre une arme à un coéquipier via
// la Banque après le combat, et parce que refuser le geste inverse serait arbitraire.
func (c *Combat) SwapWeapon(g *GameState, unitID, itemName string) error {
	if c.Status != "active" {
		return ErrInvalidAction{"le combat est terminé"}
	}
	cur := c.CurrentUnit()
	if cur == nil || cur.ID != unitID {
		return ErrInvalidAction{"ce n'est pas le tour de cette unité"}
	}
	if cur.Side != "hero" {
		return ErrInvalidAction{"cette unité n'est pas contrôlable"}
	}
	h := g.HeroByID(cur.RefID)
	if h == nil {
		return ErrInvalidAction{"héros introuvable"}
	}
	if itemName != "" {
		def, ok := Equipment[itemName]
		if !ok || def.Slot != SlotWeapon {
			return ErrInvalidAction{"« " + itemName + " » n'est pas une arme"}
		}
		if heroItemQty(h, itemName) < 1 {
			return ErrInvalidAction{"pas de « " + itemName + " » dans le sac"}
		}
	}
	if h.Weapon == itemName {
		return ErrInvalidAction{h.Name + " tient déjà cette arme"}
	}
	old := Equipment[h.Weapon]
	// L'arme rangée retourne au sac AVANT que la nouvelle en sorte : elle n'est
	// jamais perdue, et les deux ne sont jamais dans le sac en même temps.
	_ = g.unequipSlot(h, SlotWeapon)
	if itemName != "" {
		removeHeroItem(h, itemName, 1)
		h.Weapon = itemName
	}
	c.Seq++
	c.LastHits = nil
	c.refreshWeapon(cur, h, old)
	if itemName == "" {
		c.logf("%s range son arme.", cur.Name)
	} else {
		c.logf("%s dégaine %s.", cur.Name, itemName)
	}
	cur.Acted = true // dégainer EST l'action du tour (combat.go, économie du tour)
	c.spendBudget(cur)
	return nil
}

// refreshWeapon met l'unité à jour après un changement d'arme.
//
// ⚠ EN DELTA, jamais en recalculant depuis le héros : un Hurlement de Meute (+2 force)
// ou toute autre bonification acquise PENDANT le combat serait effacée par un recalcul.
// On retire donc exactement ce que l'ancienne arme apportait et on ajoute la nouvelle.
// Les champs purement dérivés de l'équipement (armure, portée, argent) se relisent, eux,
// intégralement — rien d'autre ne les alimente.
func (c *Combat) refreshWeapon(u *CombatUnit, h *Hero, old EquipDef) {
	now := Equipment[h.Weapon]
	u.Stats.Force += now.Force - old.Force
	u.Stats.Dexterite += now.Dexterite - old.Dexterite
	u.Stats.Agilite += now.Agilite - old.Agilite
	u.Stats.Endurance += now.Endurance - old.Endurance
	u.Stats.Athletisme += now.Athletisme - old.Athletisme
	u.Stats.Precision += now.Precision - old.Precision
	_, armor, reach, vsCursed, rangedStat := equipBonuses(h)
	u.Armor, u.Reach, u.VsCursed, u.RangedStat = armor, reach, vsCursed, rangedStat
	u.WeaponName, u.WeaponKind = h.Weapon, WeaponArchetype(h.Weapon)
	u.Move = 2 + u.Stats.Agilite/3 // une cape d'agilité compte pour le déplacement
}
