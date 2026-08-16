package game

// LE TEXTE QUE LE SERVEUR COMPOSE, ET COMMENT IL SE TRADUIT.
//
// Le serveur écrit des phrases : le journal de la ville, l'ordre du jour, les refus
// d'action, l'épitaphe d'un mémorial. Elles ne peuvent PAS être rendues dans la langue
// de l'appelant au moment de l'écriture, pour une raison qui n'a rien de théorique :
//
//	le journal est PARTAGÉ et PERSISTÉ. « Gui a achevé la Cuisine » est écrit une fois
//	et relu par tous les joueurs de la ville, pendant des jours. La langue de celui qui
//	a posé la planche n'a aucune raison d'être celle de celui qui lit.
//
// Même chose pour l'ordre du jour et la prévision, qui sont recalculés par `Recompute`
// et STOCKÉS dans l'état : ils sont écrits par n'importe quelle requête — y compris le
// battement, qui n'a pas de joueur derrière lui — et lus par tout le monde.
//
// D'où le contrat : le serveur émet un GABARIT + ses ARGUMENTS, et rend le français à
// côté. Le client choisit.
//
//	{ "key": "🏗️ %s a achevé la construction de %s", "args": ["Gui","Cuisine"],
//	  "text": "🏗️ Gui a achevé la construction de Cuisine" }
//
// ⚠ LE GABARIT FRANÇAIS EST LA CLÉ. Pas d'identifiant inventé (`town.log.build.done`) :
// le repli est alors gratuit et lisible, il n'y a pas de second vocabulaire à tenir à
// jour, et les ~120 refus à texte fixe n'ont besoin de RIEN — leur phrase est déjà leur
// identité. Le prix, c'est qu'une reformulation française casse le lien vers l'anglais
// en silence ; `i18n_test.go` extrait tous les gabarits et le test du front vérifie
// qu'aucun n'est orphelin.
//
// ⚠ N'EMPLOYER QUE `%s`, `%d` ET `%%` dans ces gabarits. Le client en réimplémente le
// rendu en une ligne (i18n/index.ts) ; un `%v` sur une structure y produirait du bruit
// et l'argument JSON ne serait de toute façon plus substituable. Test dédié.
//
// ⚠ ET NE JAMAIS PASSER UNE PHRASE DÉJÀ COMPOSÉE EN ARGUMENT. Un `%s` reçoit un NOM
// (« Ana », « Cuisine », « Pierre ») — donc soit un identifiant de jeu que `tName`
// traduira côté client, soit un nom de joueur qu'on ne traduit pas. Y verser une
// sous-phrase française la rendrait intraduisible, puisqu'elle n'aurait plus de clé.

import (
	"encoding/json"
	"fmt"
)

// Langs — les langues que le jeu sert.
//
// ⚠ le serveur NE TRADUIT RIEN : il émet des gabarits français et c'est le client qui
// les rhabille. Cette liste n'est là que pour refuser d'ENREGISTRER une préférence
// qu'aucun client ne saurait honorer — une langue inconnue écrite dans un compte le
// suivrait d'appareil en appareil, et le jeu serait illisible partout à la fois sans
// qu'on sache d'où ça vient. Ajouter une langue = l'ajouter ici ET livrer son
// catalogue dans frontend/src/i18n/.
var Langs = []string{"fr", "en"}

// DefaultLang est la langue de repli du serveur — celle des gabarits eux-mêmes.
const DefaultLang = "fr"

// IsLang dit si ce code de langue est servi.
func IsLang(s string) bool {
	for _, l := range Langs {
		if l == s {
			return true
		}
	}
	return false
}

// Name marque un argument qui est un NOM DE JEU — « Pierre », « Cuisine »,
// « Gobelin », « Plan de la Tour » — par opposition au nom d'une PERSONNE.
//
// ⚠ LA DISTINCTION N'EST PAS COSMÉTIQUE. Les noms de jeu sont des identifiants
// (CLAUDE.md : `craft.go` cherche littéralement « Bois ») : ils voyagent en français et
// le client les rhabille à l'affichage. Les noms de joueurs et de héros, eux, ne se
// traduisent JAMAIS. Sans ce marquage, le client devrait deviner — et il devinerait mal
// le jour où quelqu'un s'appelle Pierre, qui est à la fois un prénom très courant et le
// matériau des remparts : « Pierre n'a plus de point d'action » deviendrait « Stone has
// no action points left ».
//
// Sérialisé en objet (`{"name":"Pierre"}`) plutôt qu'en chaîne, pour que le client
// distingue les deux sans avoir à connaître la phrase.
type Name string

func (n Name) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Name string `json:"name"`
	}{string(n)})
}

// NameList marque une ÉNUMÉRATION de noms de jeu — « Pionnier ou Chasseur ».
//
// Elle existe pour la même raison que Name, poussée d'un cran : joindre la liste côté
// serveur produirait une chaîne (« Pionnier ou Chasseur ») dont aucun morceau n'a plus
// de clé, donc intraduisible en bloc. Le client reçoit les noms SÉPARÉS et pose son
// propre connecteur — « or » en anglais, « ou » en français.
type NameList []string

func (n NameList) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		Names []string `json:"names"`
	}{[]string(n)})
}

// String rend l'énumération EN FRANÇAIS, pour que `Msg.Text` — le repli — reste une
// phrase correcte.
func (n NameList) String() string { return joinOr([]string(n)) }

// ItemList marque une liste de MATÉRIAUX chiffrés — « 6 Pierre, 2 Brique ».
//
// Même raison que NameList : composée côté serveur, la liste perdrait à la fois ses
// noms d'objets et son séparateur. Le client reçoit les couples nom/quantité et met en
// forme lui-même.
type ItemList []Item

func (l ItemList) MarshalJSON() ([]byte, error) {
	type qi struct {
		Name string `json:"name"`
		Qty  int    `json:"qty"`
	}
	out := make([]qi, 0, len(l))
	for _, it := range l {
		out = append(out, qi{it.Name, it.Qty})
	}
	return json.Marshal(struct {
		Items []qi `json:"items"`
	}{out})
}

// String rend la liste en français, pour que le repli `Msg.Text` reste lisible.
func (l ItemList) String() string {
	s := ""
	for _, it := range l {
		if s != "" {
			s += ", "
		}
		s += fmt.Sprintf("%d %s", it.Qty, it.Name)
	}
	return s
}

// Msg est une phrase composée par le serveur, traduisible par le client.
type Msg struct {
	// Key est le gabarit français (verbes fmt). Vide ⇒ rien à traduire, ou archive
	// écrite avant cette version : le client affiche alors Text tel quel.
	Key string `json:"key,omitempty"`
	// Args sont les substitutions, dans l'ordre du gabarit.
	Args []any `json:"args,omitempty"`
	// Text est le français déjà rendu — le repli du client, et la trace qui reste
	// lisible dans la base même si plus personne ne sait interpréter les gabarits.
	Text string `json:"text"`
}

// newMsg compose un Msg : le gabarit sert à la fois de clé et de rendu français.
func newMsg(key string, args ...any) Msg {
	return Msg{Key: key, Args: args, Text: fmt.Sprintf(key, args...)}
}

// String rend le français. Pratique pour les logs serveur et les tests.
func (m Msg) String() string { return m.Text }
