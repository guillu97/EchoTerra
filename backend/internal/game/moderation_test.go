package game

import "testing"

// The blocklist is compared in NORMALISED space (normalise collapses doubled
// letters, folds accents, undoes leetspeak). If an entry ever failed to survive
// its own normalisation the filter would silently stop matching it — and nothing
// else in the code would complain. This test is the only thing standing between a
// typo in badWords and a filter that quietly does nothing.
func TestBlocklistEntriesAreNormalisationStable(t *testing.T) {
	if len(badWordsNorm) == 0 {
		t.Fatal("badWordsNorm is empty — init() did not run or the list is empty")
	}
	for _, b := range badWordsNorm {
		if got := normalise(b.w); got != b.w {
			t.Errorf("normalised entry %q is not stable: normalise(%q) = %q", b.w, b.w, got)
		}
		if len(b.w) < 2 {
			t.Errorf("entry %q is too short to match anything meaningful", b.w)
		}
	}
}

func TestModerateMasksInsults(t *testing.T) {
	cases := []struct {
		name, in, want string
	}{
		{"mot simple", "espèce de connard", "espèce de ●●●"},
		{"majuscules", "SALOPE", "●●●"},
		{"accents", "enfoiré va", "●●● va"},
		{"leetspeak", "sal0pe", "●●●"},
		{"lettres répétées", "conNNNard !", "●●● !"},
		{"astérisque = joker", "f*ck", "●●●"},
		{"astérisques multiples", "c*nn*rd", "●●●"},
		{"points d'obfuscation", "s.a.l.o.p.e", "●●●"},
		{"composé (loose)", "espècedeconnard", "●●●"},
		{"anglais dans une phrase", "this is bullshit ok", "this is ●●● ok"},
		{"plusieurs mots", "putain de merde", "●●● de ●●●"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, filtered := Moderate(c.in)
			if got != c.want {
				t.Errorf("Moderate(%q) = %q, want %q", c.in, got, c.want)
			}
			if !filtered {
				t.Errorf("Moderate(%q) should report filtered=true", c.in)
			}
		})
	}
}

// The expensive half of a moderation filter is the words it must NOT touch.
// Every line here is a phrase a player of THIS game plausibly types; a regression
// on any of them makes the chat feel broken and arbitrary.
func TestModerateLeavesOrdinaryFrenchAlone(t *testing.T) {
	ok := []string{
		"je suis en retard, la vague arrive",          // "retard" ≠ the English slur
		"je crève de soif, il me faut une ration",     // "crever" is a game state, not an insult
		"ce plan est unique, garde-le",                // contains "nique"
		"la clinique est au nord",                     // contains "nique"
		"j'ai une dispute avec le gardien",            // contains "pute"
		"il est réputé pour sa défense",               // contains "pute"
		"passe-moi le fromage râpé",                   // "rape"
		"le cône de la tour est cassé",                // "cone", ex-"conne"
		"ramasse les ordures près de l'épave",         // "ordure" is scavenging vocabulary
		"concours de construction demain",             // contains "con"
		"on a besoin de bois et de pierre",            //
		"Scunthorpe",                                  // the canonical false positive
		"la porte est ouverte, fermez-la !",           //
	}
	for _, in := range ok {
		got, filtered := Moderate(in)
		if filtered || got != in {
			t.Errorf("Moderate(%q) = %q (filtered=%v), want it untouched", in, got, filtered)
		}
	}
}

func TestModerateCollapsesAndCaps(t *testing.T) {
	// Control characters and newlines: a chat line stays one line.
	got, _ := Moderate("bonjour\n\n\tla   ville\r")
	if got != "bonjour la ville" {
		t.Errorf("collapse = %q, want %q", got, "bonjour la ville")
	}

	// Over-long messages are TRUNCATED, never refused — and truncation counts
	// runes, so an accented tail can't be cut mid-codepoint.
	long := ""
	for i := 0; i < chatMaxLen+50; i++ {
		long += "é"
	}
	got, _ = Moderate(long)
	if n := len([]rune(got)); n != chatMaxLen {
		t.Errorf("truncated length = %d runes, want %d", n, chatMaxLen)
	}
	for _, r := range got {
		if r != 'é' {
			t.Fatalf("truncation corrupted a rune: %q", got)
		}
	}

	// Whitespace-only input has nothing to publish.
	if got, _ := Moderate("   \n\t "); got != "" {
		t.Errorf("blank message = %q, want empty", got)
	}
}
