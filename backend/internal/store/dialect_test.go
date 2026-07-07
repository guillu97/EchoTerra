package store

import "testing"

func TestRebindPostgres(t *testing.T) {
	pg := &Store{postgres: true}
	got := pg.rebind(`INSERT INTO games (id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state`)
	want := `INSERT INTO games (id, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT(id) DO UPDATE SET state=excluded.state`
	if got != want {
		t.Fatalf("rebind:\n got %s\nwant %s", got, want)
	}

	lite := &Store{postgres: false}
	q := `SELECT state FROM games WHERE id = ?`
	if lite.rebind(q) != q {
		t.Fatalf("sqlite rebind must be a no-op, got %s", lite.rebind(q))
	}
}
