package api

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"echoterra/internal/game"
)

// LE TRANSPORT — ce que le réseau porte réellement, et à quel prix.
//
// Tout le jeu tient au contrat « le serveur est autoritatif, le client ne rend que ce
// qu'il reçoit » : chaque action renvoie donc l'état COMPLET de la partie. C'est le bon
// contrat, mais il rend la TAILLE et la RÉPÉTITION du payload critiques — mesuré, 207 ko
// à quatre joueurs, près d'un mégaoctet à vingt. Ces tests-là gardent les deux réponses
// apportées : comprimer ce qui part, et ne pas renvoyer ce que le client a déjà.

// deuxJoueurs monte une expédition RÉELLE (salon, deux joueurs, lancée) et rend son id
// plus les deux joueurs. On ne teste pas le transport sur un état factice : c'est
// justement la taille et la structure d'une vraie carte qui font le sujet.
func deuxJoueurs(t *testing.T, s *Server) (string, game.Player, game.Player) {
	t.Helper()
	rec := postJSON(t, s, "/api/games/lobby", map[string]any{"playerName": "Ana", "minPlayers": 2})
	if rec.Code != http.StatusOK && rec.Code != http.StatusCreated {
		t.Fatalf("salon: %d %s", rec.Code, rec.Body.String())
	}
	var cree struct {
		Game   game.GameState `json:"game"`
		Player game.Player    `json:"player"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &cree); err != nil {
		t.Fatal(err)
	}
	rec = postJSON(t, s, "/api/games/"+cree.Game.ID+"/join", map[string]any{"playerName": "Bo"})
	if rec.Code != http.StatusOK {
		t.Fatalf("rejoindre: %d %s", rec.Code, rec.Body.String())
	}
	var venu struct {
		Player game.Player `json:"player"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &venu); err != nil {
		t.Fatal(err)
	}
	rec = postJSON(t, s, "/api/games/"+cree.Game.ID+"/start", map[string]any{"playerId": cree.Player.ID})
	if rec.Code != http.StatusOK {
		t.Fatalf("lancer: %d %s", rec.Code, rec.Body.String())
	}
	return cree.Game.ID, cree.Player, venu.Player
}

// obtenir joue un GET en annonçant qu'on sait décompresser, et rend la réponse brute.
func obtenir(t *testing.T, s *Server, path, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Accept-Encoding", "gzip")
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	return rec
}

// L'état de partie part COMPRIMÉ. C'est le levier de latence le plus fort du jeu : ce
// JSON est très répétitif (sous brouillard la carte est un océan de tuiles vierges
// identiques), donc il se comprime d'un ordre de grandeur — ce qui transforme plusieurs
// secondes de 4G en quelques dizaines de millisecondes.
func TestLEtatDePartiePartComprime(t *testing.T) {
	s := newTestServer(t)
	id, ana, _ := deuxJoueurs(t, s)

	rec := obtenir(t, s, "/api/games/"+id+"?playerId="+ana.ID, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("état: %d", rec.Code)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("réponse NON comprimée (Content-Encoding=%q) : le middleware de compression ne mord plus", got)
	}

	surLeReseau := rec.Body.Len()
	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("corps illisible en gzip: %v", err)
	}
	clair, err := io.ReadAll(zr)
	if err != nil {
		t.Fatal(err)
	}
	// Le corps décomprimé doit rester du JSON de partie exploitable — comprimer ne doit
	// pas être une façon de casser le contrat silencieusement.
	var gs game.GameState
	if err := json.Unmarshal(clair, &gs); err != nil {
		t.Fatalf("corps décomprimé illisible: %v", err)
	}
	if gs.ID != id {
		t.Fatalf("partie servie = %q, attendu %q", gs.ID, id)
	}

	ratio := float64(len(clair)) / float64(surLeReseau)
	t.Logf("carte %dx%d : %.1f ko en clair -> %.1f ko sur le réseau (%.0f×)",
		gs.Width, gs.Height, float64(len(clair))/1024, float64(surLeReseau)/1024, ratio)
	// Marge large : on garde la PROPRIÉTÉ (un ordre de grandeur), pas un chiffre exact
	// qui bougerait au premier champ ajouté au payload.
	if ratio < 5 {
		t.Fatalf("compression à %.1f× seulement : le payload a cessé d'être compressible, ou le middleware a été déplacé", ratio)
	}
}

// LE SONDAGE À VIDE NE RENVOIE PLUS LA CARTE. `GameScreen` resonde toutes les 20 s,
// alors qu'une vague tombe toutes les 10 minutes en dev et toutes les 6 heures en cible :
// l'écrasante majorité de ces sondages porte un état rigoureusement identique au
// précédent. C'est le poste de consommation dominant d'un téléphone laissé ouvert.
func TestLeSondageAVideNeRenvoiePasLaCarte(t *testing.T) {
	s := newTestServer(t)
	id, ana, _ := deuxJoueurs(t, s)
	url := "/api/games/" + id + "?playerId=" + ana.ID

	premier := obtenir(t, s, url, "")
	etag := premier.Header().Get("ETag")
	if etag == "" {
		t.Fatal("aucun ETag servi : le client n'a aucun moyen de revalider")
	}

	second := obtenir(t, s, url, etag)
	if second.Code != http.StatusNotModified {
		t.Fatalf("second sondage: %d au lieu de 304 (corps de %d octets renvoyé pour rien)",
			second.Code, second.Body.Len())
	}
	if second.Body.Len() != 0 {
		t.Fatalf("304 avec un corps de %d octets : c'est justement ce qu'on voulait ne pas envoyer", second.Body.Len())
	}
	// ⚠ Un 304 ne doit pas porter de Content-Type : `middleware.Compress` décide d'après
	// ce champ, et le poser ferait coller un Content-Encoding sur un corps absent.
	if ct := second.Header().Get("Content-Type"); ct != "" {
		t.Fatalf("304 avec Content-Type=%q", ct)
	}
	if cc := premier.Header().Get("Cache-Control"); cc != "private, no-cache" {
		t.Fatalf("Cache-Control=%q : la réponse dépend du destinataire, aucun cache PARTAGÉ ne doit la resservir", cc)
	}
}

// L'EMPREINTE EST CELLE DE CE QUE CE JOUEUR-LÀ REÇOIT. Le brouillard a une mémoire par
// joueur et, depuis `VisibleNow`, seuls MES héros éclairent MA carte : deux membres d'une
// même ville ne voient pas la même chose dès que l'un des deux sort. Une empreinte prise
// sur l'état COMMUN leur promettrait à tort que rien n'a changé, et l'un des deux verrait
// l'exploration de l'autre — ou perdrait la sienne.
//
// ⚠ Le test fait DIVERGER les deux vues avant de comparer. Au lancement, les six héros
// sont dans les murs et les deux joueurs reçoivent rigoureusement le même octet : une
// empreinte commune y est alors la bonne réponse, pas un défaut.
func TestLEmpreinteEstPropreAChaqueJoueur(t *testing.T) {
	s := newTestServer(t)
	id, ana, bo := deuxJoueurs(t, s)

	// Ana ÉLOIGNE un héros : elle découvre des cases que Bo, resté au bourg, n'a pas.
	//
	// ⚠ Il faut sortir du rayon de vision de la VILLE (townSightRadius, 3), qui éclaire
	// pour tout le monde : un pas d'une case ne révèle rien à personne, et les deux vues
	// resteraient légitimement identiques. On marche donc jusqu'à épuisement des PA, en
	// essayant les quatre directions — un pas peut être refusé par l'eau ou le relief.
	eloigne := 0
	for _, d := range [][2]int{{1, 0}, {1, 0}, {1, 0}, {1, 0}, {0, 1}, {0, 1}, {-1, 0}, {0, -1}} {
		rec := postJSON(t, s, "/api/games/"+id+"/heroes/"+ana.HeroIDs[0]+"/move",
			map[string]any{"DX": d[0], "DY": d[1], "playerId": ana.ID})
		if rec.Code == http.StatusOK {
			eloigne++
		}
		if eloigne >= 5 {
			break
		}
	}
	if eloigne < 5 {
		t.Fatalf("le héros n'a parcouru que %d cases : impossible de faire diverger les deux vues", eloigne)
	}

	etagAna := obtenir(t, s, "/api/games/"+id+"?playerId="+ana.ID, "").Header().Get("ETag")
	etagBo := obtenir(t, s, "/api/games/"+id+"?playerId="+bo.ID, "").Header().Get("ETag")
	if etagAna == "" || etagBo == "" {
		t.Fatal("ETag manquant")
	}
	if etagAna == etagBo {
		t.Fatal("même empreinte pour deux vues différentes : l'empreinte est prise AVANT le caviardage")
	}

	// Et l'empreinte d'Ana ne doit RIEN valider chez Bo.
	if rec := obtenir(t, s, "/api/games/"+id+"?playerId="+bo.ID, etagAna); rec.Code == http.StatusNotModified {
		t.Fatal("l'empreinte d'un joueur a validé la vue d'un autre : Bo recevrait la carte d'Ana")
	}
}

// UNE ACTION N'EST JAMAIS UN 304. Un POST change le monde ; répondre « rien n'a changé »
// à celui qui vient de jouer lui ferait perdre son propre coup.
func TestUneActionNEstJamaisUn304(t *testing.T) {
	s := newTestServer(t)
	id, ana, _ := deuxJoueurs(t, s)

	etag := obtenir(t, s, "/api/games/"+id+"?playerId="+ana.ID, "").Header().Get("ETag")

	req := httptest.NewRequest(http.MethodPost, "/api/games/"+id+"/advance", nil)
	req.Header.Set("If-None-Match", etag)
	rec := httptest.NewRecorder()
	s.Router().ServeHTTP(rec, req)
	if rec.Code == http.StatusNotModified {
		t.Fatal("une action a répondu 304 : le joueur perdrait le résultat de son coup")
	}
}

// UN MONDE QUI A CHANGÉ CASSE L'EMPREINTE. C'est la moitié utile du contrat : sans elle
// le 304 ne serait pas une économie mais un gel de l'écran.
func TestUnMondeQuiChangeCasseLEmpreinte(t *testing.T) {
	s := newTestServer(t)
	id, ana, _ := deuxJoueurs(t, s)
	url := "/api/games/" + id + "?playerId=" + ana.ID

	avant := obtenir(t, s, url, "").Header().Get("ETag")

	// Une vague force un vrai changement d'état (PV de ville, monstres, rapport).
	if rec := postJSON(t, s, "/api/games/"+id+"/advance", map[string]any{"safe": false}); rec.Code != http.StatusOK {
		t.Fatalf("advance: %d %s", rec.Code, rec.Body.String())
	}

	apres := obtenir(t, s, url, avant)
	if apres.Code == http.StatusNotModified {
		t.Fatal("304 alors que la vague est passée : le joueur resterait sur un écran figé")
	}
	if apres.Header().Get("ETag") == avant {
		t.Fatal("même empreinte après une vague")
	}
}
