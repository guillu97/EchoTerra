package game

import "math/rand"

// Map skills (2026-07-20) — remplacent la boule de feu UNIVERSELLE par des
// compétences PAR CLASSE utilisables sur la carte. Chaque classe a une (ou
// deux) capacité(s) offensive(s) de carte ; le héros sans classe garde un
// "Jet de pierre" de base pour ne jamais être démuni. Le catalogue est data,
// servi au client (GET /api/mapskills) qui en rend des boutons.
//
// Kind :
//   - "blast" : souffle de zone sur un pack de la case du héros ou d'une case
//     orthogonalement adjacente (l'ancienne mécanique boule de feu) — traverse
//     le pack (réduit Count / le détruit), aide à briser Tétanisé.
//   - "snipe" : achève UNE créature d'un pack sur la case si ses PV ≤ SnipeMaxHP.
type MapSkillDef struct {
	ID      string `json:"id"`
	ClassID string `json:"classId"` // "" = héros sans classe (tier 0)
	Name    string `json:"name"`
	Icon    string `json:"icon"`
	PA      int    `json:"pa"`
	Desc    string `json:"desc"`
	Kind    string `json:"kind"` // "blast" | "snipe"
	Base    int    `json:"base"` // dégâts de base (blast)
	Stat    string `json:"stat"` // "force" | "dexterite" | "precision"
	Loot    bool   `json:"loot"` // Récupérateur : +1 trophée en prime
}

// SnipeMaxHP : seuil de PV pour un tir d'achèvement (Chasseur "Tir précis").
const SnipeMaxHP = 5

// MapSkills est le catalogue des compétences de carte actives.
var MapSkills = []MapSkillDef{
	{ID: "stone-throw", ClassID: "", Name: "Jet de pierre", Icon: "🪨", PA: 1, Kind: "blast", Base: 4, Stat: "precision",
		Desc: "Projette une pierre sur un pack proche."},
	{ID: "heroic-charge", ClassID: "pionnier", Name: "Charge héroïque", Icon: "🐗", PA: 2, Kind: "blast", Base: 7, Stat: "force",
		Desc: "Enfonce un pack proche avec une force brute."},
	{ID: "precise-shot", ClassID: "chasseur", Name: "Tir précis", Icon: "🎯", PA: 1, Kind: "snipe",
		Desc: "Achève une créature affaiblie (PV ≤ 5) sur sa case."},
	{ID: "arrow-volley", ClassID: "chasseur", Name: "Volée de flèches", Icon: "🏹", PA: 2, Kind: "blast", Base: 5, Stat: "dexterite",
		Desc: "Crible un pack proche d'une pluie de flèches."},
	{ID: "flat-shot", ClassID: "eclaireur", Name: "Tir tendu", Icon: "🎯", PA: 1, Kind: "blast", Base: 4, Stat: "dexterite",
		Desc: "Un tir rapide et économe sur un pack proche."},
	{ID: "war-cry", ClassID: "gardien", Name: "Cri de ralliement", Icon: "📢", PA: 1, Kind: "blast", Base: 5, Stat: "force",
		Desc: "Un rugissement qui bouscule un pack proche."},
	{ID: "looting-shot", ClassID: "recuperateur", Name: "Tir chapardeur", Icon: "💰", PA: 2, Kind: "blast", Base: 5, Stat: "dexterite", Loot: true,
		Desc: "Frappe un pack et rafle un trophée au passage."},
	{ID: "spore-burst", ClassID: "herboriste", Name: "Projection de spores", Icon: "🍄", PA: 2, Kind: "blast", Base: 6, Stat: "precision",
		Desc: "Une nuée corrosive s'abat sur un pack proche."},
}

// MapSkillByID returns a map skill by id, or nil.
func MapSkillByID(id string) *MapSkillDef {
	for i := range MapSkills {
		if MapSkills[i].ID == id {
			return &MapSkills[i]
		}
	}
	return nil
}

// MapSkillsForClass returns the active map skills a hero of this class can cast:
// the classless base skill for a tier-0 hero, otherwise the class's own skills.
func MapSkillsForClass(classID string) []MapSkillDef {
	var out []MapSkillDef
	for _, s := range MapSkills {
		if s.ClassID == classID {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		// pas de classe (ou classe sans skill actif) : la compétence de base
		for _, s := range MapSkills {
			if s.ClassID == "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// MapSkillReport summarises a map-skill cast for the client log/animation.
type MapSkillReport struct {
	SkillID   string `json:"skillId"`
	Name      string `json:"name"`
	MonsterID string `json:"monsterId"`
	Species   string `json:"species"`
	Damage    int    `json:"damage"`
	Slain     int    `json:"slain"`  // créatures retirées du pack par ce sort
	Killed    bool   `json:"killed"` // le pack entier a été détruit
	Loot      string `json:"loot,omitempty"`
	X         int    `json:"x"`
	Y         int    `json:"y"`
}

// CastMapSkill runs a class map skill for the hero: validates ownership of the
// skill + PA, finds a target pack, applies the effect (blast or snipe) and
// spends the PA. A Tétanisé hero may still cast (thinning the pack can free it).
func (g *GameState) CastMapSkill(heroID, skillID string) (*MapSkillReport, error) {
	if g.heroInCombat(heroID) != nil {
		return nil, ActionError{"ce héros est en plein combat"}
	}
	h := g.HeroByID(heroID)
	if h == nil {
		return nil, ActionError{"héros introuvable"}
	}
	sk := MapSkillByID(skillID)
	if sk == nil {
		return nil, ActionError{"compétence inconnue"}
	}
	// Le héros doit posséder cette compétence (sa classe, ou la base sans classe).
	owns := false
	for _, s := range MapSkillsForClass(h.ClassID) {
		if s.ID == skillID {
			owns = true
			break
		}
	}
	if !owns {
		return nil, ActionError{h.Name + " ne maîtrise pas « " + sk.Name + " »"}
	}
	if h.PA < sk.PA {
		return nil, ActionError{h.Name + " n'a pas assez de PA pour « " + sk.Name + " »"}
	}

	rep := &MapSkillReport{SkillID: sk.ID, Name: sk.Name}
	switch sk.Kind {
	case "snipe":
		if err := g.castSnipe(h, sk, rep); err != nil {
			return nil, err
		}
	default: // "blast"
		if err := g.castBlast(h, sk, rep); err != nil {
			return nil, err
		}
	}

	g.MonstersKilled += rep.Slain // tableau des scores : les créatures tombées au sort
	g.credit(heroID, func(c *Contribution) { c.Slain += rep.Slain })
	h.PA -= sk.PA
	h.Bars["combat"]++
	h.RemoveState(StateCache) // lancer un sort révèle le héros
	if h.PA == 0 {
		h.AddState(StateFatigue)
	}
	return rep, nil
}

// castBlast applies an area blast (old fireball) scaled by the skill's stat.
func (g *GameState) castBlast(h *Hero, sk *MapSkillDef, rep *MapSkillReport) error {
	m := g.packTargetNear(h.X, h.Y)
	if m == nil {
		return ActionError{"aucune cible à portée pour « " + sk.Name + " »"}
	}
	var stat int
	switch sk.Stat {
	case "force":
		stat = h.Stats.Force
	case "dexterite":
		stat = h.Stats.Dexterite
	default:
		stat = h.Stats.Precision
	}
	dmg := sk.Base + stat + h.Stats.Dexterite/2 + rand.Intn(4)
	rep.MonsterID, rep.Species, rep.Damage, rep.X, rep.Y = m.ID, m.Species, dmg, m.X, m.Y

	m.HP -= dmg
	for m.HP <= 0 && m.Count > 1 { // le souffle traverse le pack
		m.Count--
		rep.Slain++
		m.HP += m.MaxHP
	}
	if m.HP <= 0 && m.Count <= 1 {
		rep.Slain++
		rep.Killed = true
		delete(g.Monsters, m.ID)
		if t := g.TileAt(m.X, m.Y); t != nil && t.MonsterID == m.ID {
			t.MonsterID = ""
		}
	}
	// Récupérateur : le tir chapardeur rafle un trophée.
	if sk.Loot && rep.Slain > 0 {
		it := Item{Type: "animal", Name: "Trophée de monstre", Qty: 1}
		h.AddLoot(it)
		rep.Loot = it.Name
	}
	return nil
}

// castSnipe finishes off one creature of the pack on the hero's tile (≤ SnipeMaxHP).
func (g *GameState) castSnipe(h *Hero, sk *MapSkillDef, rep *MapSkillReport) error {
	t := g.TileAt(h.X, h.Y)
	if t == nil || t.MonsterID == "" {
		return ActionError{"aucun monstre sur cette case"}
	}
	m := g.Monsters[t.MonsterID]
	if m == nil {
		return ActionError{"ennemi introuvable"}
	}
	if m.HP > SnipeMaxHP {
		return ActionError{"la cible est trop vigoureuse (PV > 5) pour un Tir précis"}
	}
	rep.MonsterID, rep.Species, rep.Damage, rep.Slain, rep.X, rep.Y = m.ID, m.Species, m.HP, 1, m.X, m.Y
	if m.Count > 1 {
		m.Count--
		m.HP = m.MaxHP
	} else {
		rep.Killed = true
		delete(g.Monsters, m.ID)
		if t.MonsterID == m.ID {
			t.MonsterID = ""
		}
	}
	return nil
}

// packTargetNear finds the pack a map blast will hit: the monster on (x,y) if
// any, otherwise the first on an orthogonally adjacent tile.
func (g *GameState) packTargetNear(x, y int) *Monster {
	for _, c := range [][2]int{{x, y}, {x, y - 1}, {x, y + 1}, {x - 1, y}, {x + 1, y}} {
		t := g.TileAt(c[0], c[1])
		if t == nil || t.MonsterID == "" {
			continue
		}
		if m := g.Monsters[t.MonsterID]; m != nil {
			return m
		}
	}
	return nil
}
