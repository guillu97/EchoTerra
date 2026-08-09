package api

// LA CHRONIQUE ET LES TITRES (P7 de RETENTION-PLAN.md) — ce qu'un compte garde d'une
// ville tombée.
//
// ⚠ COSMÉTIQUE, JAMAIS DE LA PUISSANCE. Un titre ne donne ni PA, ni défense, ni objet.
// C'est la même règle que les mémoriaux : deux joueurs qui rejoignent la même expédition
// y arrivent strictement égaux, sinon la survie de groupe se transforme en course à
// l'ancienneté et les nouveaux venus deviennent un poids. Ce qui traverse les parties,
// c'est le SOUVENIR — et le souvenir suffit, parce que ce qu'on retient d'une ville,
// c'est ce qu'on y a fait pour les autres.
//
// Les titres sont donc DÉRIVÉS de la chronique à la lecture : rien de plus à stocker,
// rien à maintenir en cohérence, et changer un seuil corrige rétroactivement tout le
// monde.

import (
	"net/http"
	"sort"

	"echoterra/internal/store"
)

// ChronicleTotals agrège toute la carrière d'un compte.
type ChronicleTotals struct {
	Runs      int `json:"runs"`      // expéditions vécues
	BestWave  int `json:"bestWave"`  // la plus longue survie
	Days      int `json:"days"`      // jours cumulés
	BuildPA   int `json:"buildPa"`   // PA versés dans les chantiers
	Deposited int `json:"deposited"` // objets rapportés à la Banque
	Slain     int `json:"slain"`     // créatures abattues
	Repaired  int `json:"repaired"`  // PV rendus aux remparts
	Crafted   int `json:"crafted"`   // objets fabriqués
	Filled    int `json:"filled"`    // requêtes de coéquipiers honorées
}

// Title est une distinction gagnée, avec ce qui reste à faire pour la suivante.
type Title struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Icon  string `json:"icon"`
	Desc  string `json:"desc"`
	Value int    `json:"value"` // où en est le joueur
	Need  int    `json:"need"`  // le seuil franchi (ou à franchir)
	Got   bool   `json:"got"`
}

// titleDef décrit un palier. Deux paliers par domaine : un qu'on atteint en une bonne
// expédition, un qui demande d'y revenir. Au-delà on tomberait dans le grind, et le jeu
// se joue deux fois cinq minutes par jour.
type titleDef struct {
	id, name, icon, desc string
	need                 int
	of                   func(ChronicleTotals) int
}

var titleDefs = []titleDef{
	{"batisseur", "Bâtisseur", "🔨", "PA versés dans les chantiers de la ville", 100,
		func(t ChronicleTotals) int { return t.BuildPA }},
	{"maitre-oeuvre", "Maître d'œuvre", "🏛️", "PA versés dans les chantiers de la ville", 500,
		func(t ChronicleTotals) int { return t.BuildPA }},
	{"portefaix", "Portefaix", "🎒", "objets rapportés à la Banque", 200,
		func(t ChronicleTotals) int { return t.Deposited }},
	{"caravanier", "Caravanier", "🐫", "objets rapportés à la Banque", 1000,
		func(t ChronicleTotals) int { return t.Deposited }},
	{"chasseur", "Chasseur de horde", "⚔️", "créatures abattues", 100,
		func(t ChronicleTotals) int { return t.Slain }},
	{"fleau", "Fléau des hordes", "💀", "créatures abattues", 500,
		func(t ChronicleTotals) int { return t.Slain }},
	{"macon", "Maçon", "🧱", "PV rendus aux remparts", 100,
		func(t ChronicleTotals) int { return t.Repaired }},
	{"artisan", "Artisan", "⚒️", "objets fabriqués à l'atelier", 25,
		func(t ChronicleTotals) int { return t.Crafted }},
	// Celui-ci compte double à mes yeux : il ne mesure pas ce qu'on a pris, mais ce
	// qu'on a donné à quelqu'un d'autre. C'est le seul geste du jeu qui exige d'être deux.
	{"bon-voisin", "Bon voisin", "🤝", "requêtes de coéquipiers honorées", 10,
		func(t ChronicleTotals) int { return t.Filled }},
	{"survivant", "Survivant", "🛡️", "vagues tenues dans une même ville", 20,
		func(t ChronicleTotals) int { return t.BestWave }},
	{"veteran", "Vétéran", "🏅", "vagues tenues dans une même ville", 30,
		func(t ChronicleTotals) int { return t.BestWave }},
	{"fondateur", "Fondateur", "🌍", "expéditions vécues", 5,
		func(t ChronicleTotals) int { return t.Runs }},
}

func chronicleTotals(runs []store.ChronicleEntry) ChronicleTotals {
	t := ChronicleTotals{Runs: len(runs)}
	for _, r := range runs {
		if r.Waves > t.BestWave {
			t.BestWave = r.Waves
		}
		t.Days += r.Days
		t.BuildPA += r.BuildPA
		t.Deposited += r.Deposited
		t.Slain += r.Slain
		t.Repaired += r.Repaired
		t.Crafted += r.Crafted
		t.Filled += r.Filled
	}
	return t
}

// titlesFor rend TOUS les titres — gagnés et à gagner — parce qu'un palier qu'on ne
// voit pas ne donne envie de rien. Les gagnés d'abord, puis les plus proches.
func titlesFor(t ChronicleTotals) []Title {
	out := make([]Title, 0, len(titleDefs))
	for _, d := range titleDefs {
		v := d.of(t)
		out = append(out, Title{ID: d.id, Name: d.name, Icon: d.icon, Desc: d.desc,
			Value: v, Need: d.need, Got: v >= d.need})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Got != out[j].Got {
			return out[i].Got
		}
		// Le plus proche d'être décroché en tête : c'est le prochain but.
		return out[i].Value*out[j].Need > out[j].Value*out[i].Need
	})
	return out
}

// myChronicle sert la chronique du compte connecté : ses expéditions, ses totaux et ses
// titres. Réservé au titulaire — il n'y a pas de chronique publique, et c'est voulu :
// exposer celle des autres transformerait un souvenir en palmarès.
func (s *Server) myChronicle(w http.ResponseWriter, r *http.Request) {
	u := s.userFromReq(r)
	if u == nil {
		writeErr(w, http.StatusUnauthorized, "connexion requise")
		return
	}
	runs, err := s.store.Chronicle(u.ID, 50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	totals := chronicleTotals(runs)
	writeJSON(w, http.StatusOK, map[string]any{
		"runs":   runs,
		"totals": totals,
		"titles": titlesFor(totals),
	})
}
