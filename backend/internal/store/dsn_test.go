package store

import (
	"strings"
	"testing"
)

// UN DSN NE SE JOURNALISE JAMAIS TEL QUEL. `main.go` imprimait `db=%s` à chaque
// démarrage à froid, mot de passe compris, dans des journaux d'hébergeur qui se
// relisent et se partagent. Ce test tient la règle ET la seconde promesse de
// `DescribeDSN` : dire si l'on parle au point d'entrée « pooled » de Neon — invérifiable
// autrement, la variable s'appelant `DATABASE_URL` dans les deux cas et sa valeur étant
// masquée dans le tableau de bord.
func TestDescribeDSNNeLaisseJamaisFuirLeSecret(t *testing.T) {
	const motDePasse = "npg_SuperSecret123"
	cas := []struct {
		nom    string
		dsn    string
		attend string // fragment qui DOIT figurer
	}{
		{
			"neon pooled",
			"postgres://neondb_owner:" + motDePasse + "@ep-coffee-saddle-abc123-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require",
			"pooled",
		},
		{
			"neon direct",
			"postgres://neondb_owner:" + motDePasse + "@ep-coffee-saddle-abc123.eu-west-2.aws.neon.tech/neondb?sslmode=require",
			"DIRECT",
		},
		{
			"schéma postgresql://",
			"postgresql://u:" + motDePasse + "@ep-x-pooler.eu-west-2.aws.neon.tech/db",
			"pooled",
		},
	}
	for _, c := range cas {
		t.Run(c.nom, func(t *testing.T) {
			got := DescribeDSN(c.dsn)
			if strings.Contains(got, motDePasse) {
				t.Fatalf("le mot de passe FUIT dans le journal: %q", got)
			}
			// Le nom d'utilisateur non plus : c'est la moitié d'un identifiant.
			if strings.Contains(got, "neondb_owner") {
				t.Fatalf("l'identifiant fuit: %q", got)
			}
			if !strings.Contains(got, c.attend) {
				t.Fatalf("DescribeDSN(%s) = %q, attendu contenant %q", c.nom, got, c.attend)
			}
			// L'hôte, lui, DOIT rester : sans lui le journal ne sert à rien pour
			// diagnostiquer une base branchée au mauvais endroit.
			if !strings.Contains(got, "neon.tech") {
				t.Fatalf("l'hôte a disparu du journal: %q", got)
			}
		})
	}
}

// Un chemin SQLite ne porte pas de secret : on le garde tel quel, c'est ce qu'on lit
// en développement.
func TestDescribeDSNGardeLeCheminSQLite(t *testing.T) {
	got := DescribeDSN("echoterra.db")
	if !strings.Contains(got, "echoterra.db") {
		t.Fatalf("chemin SQLite perdu: %q", got)
	}
}

// Un DSN illisible ne doit ni paniquer ni recracher son contenu.
func TestDescribeDSNSurvitAUnDSNCasse(t *testing.T) {
	got := DescribeDSN("postgres://not a url\x7f:" + "secret" + "@x")
	if strings.Contains(got, "secret") {
		t.Fatalf("fuite sur un DSN cassé: %q", got)
	}
}
