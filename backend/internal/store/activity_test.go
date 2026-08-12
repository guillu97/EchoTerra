package store

import (
	"path/filepath"
	"testing"
	"time"
)

// testStore : une base neuve et jetable (les autres tests du paquet ouvrent la leur à la
// main ; ce raccourci sert les trois tests ci-dessous).
func testStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "activity.db"))
	if err != nil {
		t.Fatalf("ouverture : %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// L'ACTIVITÉ (activity.go) — la donnée d'où sortent tous les chiffres de rétention.

func TestActivityCountsDaysNotRequests(t *testing.T) {
	s := testStore(t)
	at := time.Date(2026, 8, 12, 9, 0, 0, 0, time.UTC)
	for i := 0; i < 5; i++ {
		if err := s.RecordActivity("u1", "g1", at.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatalf("record: %v", err)
		}
	}
	rows, err := s.Activity("2026-01-01")
	if err != nil {
		t.Fatalf("lecture: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("cinq actions le même jour = UNE ligne, %d obtenues", len(rows))
	}
	if rows[0].Actions != 5 || rows[0].Day != "2026-08-12" {
		t.Errorf("ligne %+v — attendu 5 actions le 2026-08-12", rows[0])
	}
}

// ⚠ RIEN SUR LES ANONYMES : la rétention se mesure sur des comptes, et un joueur sans
// compte n'a pas d'identité qui traverse les parties. Le silence est ici la bonne
// réponse — pas une ligne à identifiant vide qui agrégerait tout le monde ensemble.
func TestActivityIgnoresAnonymousPlay(t *testing.T) {
	s := testStore(t)
	if err := s.RecordActivity("", "g1", time.Now()); err != nil {
		t.Fatalf("un anonyme ne doit pas faire échouer l'écriture : %v", err)
	}
	if err := s.RecordActivity("u1", "", time.Now()); err != nil {
		t.Fatalf("une partie inconnue non plus : %v", err)
	}
	rows, _ := s.Activity("2000-01-01")
	if len(rows) != 0 {
		t.Errorf("aucune ligne attendue, %d écrites", len(rows))
	}
}

// La fenêtre de lecture borne l'historique : on ne relit pas trois ans pour afficher un
// tableau de trois mois.
func TestActivityWindowCutsOldRows(t *testing.T) {
	s := testStore(t)
	_ = s.RecordActivity("u1", "g1", time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))
	_ = s.RecordActivity("u1", "g1", time.Date(2026, 8, 12, 0, 0, 0, 0, time.UTC))
	rows, _ := s.Activity("2026-06-01")
	if len(rows) != 1 || rows[0].Day != "2026-08-12" {
		t.Errorf("la fenêtre doit écarter les vieilles lignes, obtenu %+v", rows)
	}
}
