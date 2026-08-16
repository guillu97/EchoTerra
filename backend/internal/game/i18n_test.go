package game

// LE CONTRAT DES PHRASES SERVEUR, vérifié côté Go.
//
// Le catalogue anglais, lui, est vérifié par `npm run test:i18n` (frontend/tests) :
// c'est là qu'on s'assure qu'aucune clé ne manque et qu'aucun verbe fmt n'a bougé.
// Ici on garde ce qui ne se voit QUE d'ici : la structure du message.

import (
	"encoding/json"
	"strings"
	"testing"
)

// Un Msg porte le gabarit, ses arguments ET le français rendu. Les trois, parce que le
// client a besoin des deux premiers pour traduire et du troisième comme repli — un
// message sans `text` disparaîtrait purement et simplement chez un client qui ne
// connaît pas la clé (une archive écrite par une version plus récente, par exemple).
func TestMsgCarriesTemplateArgsAndFrench(t *testing.T) {
	m := newMsg("🏗️ %s a achevé la construction de %s", "Gui", Name("Cuisine"))
	if m.Key != "🏗️ %s a achevé la construction de %s" {
		t.Fatalf("gabarit perdu : %q", m.Key)
	}
	if len(m.Args) != 2 {
		t.Fatalf("arguments perdus : %v", m.Args)
	}
	if m.Text != "🏗️ Gui a achevé la construction de Cuisine" {
		t.Fatalf("français mal rendu : %q", m.Text)
	}
}

// ⚠ LA DISTINCTION QUI ÉVITE « Pierre » → « Stone » SUR UN JOUEUR NOMMÉ PIERRE.
// Un nom de JEU part en objet (`{"name":…}`), un nom de PERSONNE en chaîne nue. C'est
// ce marquage, et lui seul, qui dit au client ce qu'il a le droit de traduire.
func TestGameNamesAreMarkedAndPeopleNamesAreNot(t *testing.T) {
	m := newMsg("%s n'a pas « %s » dans son sac", "Pierre", Name("Pierre"))
	raw, err := json.Marshal(m.Args)
	if err != nil {
		t.Fatal(err)
	}
	got := string(raw)
	if got != `["Pierre",{"name":"Pierre"}]` {
		t.Fatalf("le marquage des noms de jeu ne tient pas : %s", got)
	}
	// Et le français reste correct dans les deux cas.
	if m.Text != "Pierre n'a pas « Pierre » dans son sac" {
		t.Fatalf("français mal rendu : %q", m.Text)
	}
}

// Une énumération et une liste de matériaux voyagent DÉCOMPOSÉES : sinon le client
// recevrait « Pionnier ou Chasseur » en un bloc, dont ni les noms ni le connecteur
// n'ont plus de clé.
func TestListsTravelDecomposed(t *testing.T) {
	raw, _ := json.Marshal(NameList{"Pionnier", "Chasseur"})
	if string(raw) != `{"names":["Pionnier","Chasseur"]}` {
		t.Fatalf("NameList sérialisée en bloc : %s", raw)
	}
	nl := NameList{"Pionnier", "Chasseur"}
	if got := nl.String(); got != "Pionnier ou Chasseur" {
		t.Fatalf("repli français cassé : %q", got)
	}
	raw, _ = json.Marshal(ItemList{{Type: "minerai", Name: "Pierre", Qty: 6}})
	if string(raw) != `{"items":[{"name":"Pierre","qty":6}]}` {
		t.Fatalf("ItemList sérialisée en bloc : %s", raw)
	}
}

// Un refus à texte fixe est sa propre clé : c'est ce qui évite d'inventer et de tenir
// à jour ~120 identifiants pour des phrases qui n'ont pas de substitution.
func TestFixedRefusalIsItsOwnKey(t *testing.T) {
	e := actionErr("héros introuvable")
	if e.Key != e.Msg || e.Key != "héros introuvable" || len(e.Args) != 0 {
		t.Fatalf("refus à texte fixe mal formé : %+v", e)
	}
}

// Le journal de la ville est PERSISTÉ et PARTAGÉ : chaque ligne doit emporter son
// gabarit, sinon elle reste figée dans la langue de celui qui l'a écrite.
func TestTownLogEntriesCarryTheirTemplate(t *testing.T) {
	g := &GameState{Day: 3}
	g.logTown("🚪 %s a OUVERT la porte de la ville", "Ana")
	if len(g.Town.Log) != 1 {
		t.Fatalf("rien écrit au journal")
	}
	e := g.Town.Log[0]
	if e.Key == "" || len(e.Args) != 1 || e.Text == "" {
		t.Fatalf("ligne de journal non traduisible : %+v", e)
	}
	if !strings.Contains(e.Text, "Ana") {
		t.Fatalf("le français ne porte pas son argument : %q", e.Text)
	}
}

// Les langues servies : le serveur ne traduit rien, mais il refuse d'ENREGISTRER une
// préférence qu'aucun client ne saurait honorer — une valeur inconnue suivrait le
// compte d'appareil en appareil et rendrait le jeu illisible partout à la fois.
func TestOnlyServedLanguagesAreAccepted(t *testing.T) {
	for _, l := range Langs {
		if !IsLang(l) {
			t.Fatalf("%q est servie mais refusée", l)
		}
	}
	for _, bad := range []string{"", "kl", "fr-FR", "Français", "en_US"} {
		if IsLang(bad) {
			t.Fatalf("%q ne devrait pas être acceptée", bad)
		}
	}
	if !IsLang(DefaultLang) {
		t.Fatalf("la langue de repli n'est pas servie")
	}
}
