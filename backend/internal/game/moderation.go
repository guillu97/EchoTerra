package game

import "strings"

// Text moderation for the town messaging board (chat.go).
//
// The rule chosen with the designer: MASK AND PUBLISH. A message is never
// rejected because of its words — the offending token comes out as "●●●" and the
// conversation goes on. Rejecting would punish false positives with an error the
// player can't act on ("which word?"), and a chat that silently eats messages is
// worse than one that bleeps them.
//
// The matcher works TOKEN BY TOKEN rather than on the whole string. That is the
// one design decision everything else follows from: normalisation (lowercasing,
// stripping accents, undoing leetspeak, collapsing repeats) changes the length of
// the text, so masking by index on a normalised copy would smear the mask across
// the wrong characters of the original. Normalising a single token and replacing
// that WHOLE token in the original keeps the two representations independent.

// badWord is one blocklist entry.
//
// Loose entries match as a SUBSTRING of the token, which catches padding and
// compounds ("espècedeconnard", "bullshit"). Strict entries must match the whole
// token, give or take a French plural/feminine ending.
//
// Strict is the DEFAULT, and the list below is mostly strict, because loose
// matching on a short word is how filters earn their reputation: "unique" and
// "clinique" contain "nique", "dispute" and "réputé" contain "pute",
// "Scunthorpe" contains "cunt". Only long, unambiguous words get `loose: true`.
type badWord struct {
	w     string
	loose bool
}

// badWords is the blocklist. Entries are written naturally — normalise() is
// applied to them at init, so accents and doubled letters here are fine.
//
// Deliberately ABSENT, and each for a reason worth keeping:
//   - "retard": the French word for "late". "Je suis en retard" is not an insult.
//   - "crever": "je crève de soif" is literally a game state (Soif).
//   - "rape": "fromage râpé" normalises to the same thing.
//   - "con", "conne": normalise to "con"/"cone" and collide with "cône".
//   - "ordure": ordinary vocabulary in a survival game about scavenging.
var badWords = []badWord{
	// FR — insultes et injures
	{w: "connard", loose: true}, {w: "connasse", loose: true}, {w: "conard", loose: true},
	{w: "salope", loose: true}, {w: "salopard", loose: true}, {w: "salaud"},
	{w: "pute"}, {w: "putain"}, {w: "pouffiasse", loose: true},
	{w: "enculé"}, {w: "enculer"}, {w: "enculette"}, {w: "enfoiré"},
	{w: "bâtard"}, {w: "merde"}, {w: "merdique"}, {w: "chier"},
	{w: "couille"}, {w: "bite"}, {w: "nique"}, {w: "niquer"},
	{w: "abruti"}, {w: "crétin"}, {w: "débile"}, {w: "raclure"},
	// FR — slurs (toujours masqués, jamais du vocabulaire ordinaire)
	{w: "pd"}, {w: "tapette"}, {w: "pédale"}, {w: "gouine"}, {w: "tafiole"},
	{w: "nègre"}, {w: "bougnoule", loose: true}, {w: "youpin"}, {w: "bamboula", loose: true},
	{w: "attardé"}, {w: "mongol"}, {w: "trisomique", loose: true}, {w: "violeur"},
	// EN
	{w: "fuck", loose: true}, {w: "shit", loose: true}, {w: "bitch", loose: true},
	{w: "asshole", loose: true}, {w: "bastard", loose: true}, {w: "cunt"},
	{w: "dick"}, {w: "whore"}, {w: "slut"}, {w: "faggot", loose: true},
	{w: "nigger", loose: true}, {w: "nigga", loose: true}, {w: "retarded", loose: true},
	{w: "rapist", loose: true}, {w: "kys"},
}

// badWordsNorm is badWords run through normalise() once at startup. The list
// MUST be compared in normalised space: normalise() collapses doubled letters,
// so a raw "connard" would never match the incoming token's "conard".
var badWordsNorm []badWord

func init() {
	seen := make(map[string]bool, len(badWords))
	for _, b := range badWords {
		n := normalise(b.w)
		if n == "" || seen[n] {
			continue
		}
		seen[n] = true
		badWordsNorm = append(badWordsNorm, badWord{w: n, loose: b.loose})
	}
}

// mask replaces a blocked token. Three bullets whatever the length: telling the
// reader HOW LONG the word was is half of telling them what it was.
const mask = "●●●"

// chatMaxLen bounds a single message. Anything longer is truncated, not refused.
const chatMaxLen = 240

// Moderate cleans a player message: control characters out, whitespace collapsed,
// length capped, blocked words masked. It returns the publishable text and
// whether anything was masked.
func Moderate(s string) (string, bool) {
	s = collapse(s)
	if s == "" {
		return "", false
	}
	// Cap on RUNES, not bytes: cutting a UTF-8 string mid-rune produces the
	// replacement character in every client that renders it.
	if r := []rune(s); len(r) > chatMaxLen {
		s = strings.TrimRight(string(r[:chatMaxLen]), " ")
	}

	var out strings.Builder
	out.Grow(len(s))
	filtered := false
	// Walk the string splitting on token boundaries: a token is a run of letters,
	// digits and the usual obfuscation glue; everything else is a separator copied
	// through untouched.
	emit := func(tok string) {
		if tokenIsBad(tok) {
			out.WriteString(mask)
			filtered = true
			return
		}
		out.WriteString(tok)
	}
	start := -1
	for i, r := range s {
		if isTokenRune(r) {
			if start < 0 {
				start = i
			}
			continue
		}
		if start >= 0 {
			emit(s[start:i])
			start = -1
		}
		out.WriteRune(r)
	}
	if start >= 0 {
		emit(s[start:])
	}
	return out.String(), filtered
}

func isTokenRune(r rune) bool {
	switch {
	case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		return true
	case r == '\'', r == '’', r == '-', r == '_', r == '*', r == '@', r == '$', r == '.':
		// Kept INSIDE the token on purpose: these are the usual obfuscation
		// characters ("f*ck", "c-o-n-n-a-r-d", "b@tard", "s.a.l.o.p.e").
		return true
	case r > 127:
		// Accented letters and the like; normalise() decides what they become.
		return true
	}
	return false
}

// tokenIsBad normalises one token and matches it against the blocklist.
func tokenIsBad(tok string) bool {
	n := normalise(tok)
	if n == "" {
		return false
	}
	for _, b := range badWordsNorm {
		if b.loose {
			if containsWild(n, b.w) {
				return true
			}
			continue
		}
		if eqWild(n, b.w) {
			return true
		}
		// French plural / feminine endings, so the strict entries don't need a
		// row per inflection.
		for _, suf := range []string{"s", "e", "es", "x"} {
			if eqWild(n, b.w+suf) {
				return true
			}
		}
	}
	return false
}

// wildcard is what a MASKING character becomes in normalised space: a hole that
// stands for exactly one letter. "*" is the one obfuscation that destroys
// information instead of merely padding it — "s.a.l.o.p.e" still carries every
// letter, "f*ck" does not — so it can only be matched positionally.
const wildcard = '?'

// eqWild compares a normalised token against a blocklist entry, letting the
// token's wildcards stand for any single letter. Both sides are plain ASCII
// after normalise(), so indexing by byte is safe.
func eqWild(tok, w string) bool {
	if len(tok) != len(w) {
		return false
	}
	for i := 0; i < len(tok); i++ {
		if tok[i] != w[i] && tok[i] != wildcard {
			return false
		}
	}
	return true
}

// containsWild is eqWild's substring form, for loose entries.
func containsWild(tok, w string) bool {
	for i := 0; i+len(w) <= len(tok); i++ {
		if eqWild(tok[i:i+len(w)], w) {
			return true
		}
	}
	return false
}

// leet maps the usual digit/symbol substitutions back to letters.
var leet = map[rune]rune{
	'0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't',
	'@': 'a', '$': 's', '!': 'i', '|': 'i',
}

// accents folds the accented runes this game's languages actually use. A full
// Unicode NFD fold would mean pulling golang.org/x/text in for a blocklist of a
// few dozen words — not worth a dependency.
var accents = map[rune]rune{
	'à': 'a', 'á': 'a', 'â': 'a', 'ä': 'a', 'ã': 'a', 'å': 'a',
	'ç': 'c',
	'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e',
	'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i',
	'ñ': 'n',
	'ò': 'o', 'ó': 'o', 'ô': 'o', 'ö': 'o', 'õ': 'o', 'ø': 'o',
	'ù': 'u', 'ú': 'u', 'û': 'u', 'ü': 'u',
	'ý': 'y', 'ÿ': 'y',
	'œ': 'e', 'æ': 'a',
}

// normalise reduces a token to its comparable form: lowercase, unaccented,
// un-leeted, glue dropped, and runs of the same letter collapsed to one
// ("cooonnnard" -> "conard"). The blocklist goes through the same function at
// init, so both sides always speak the same alphabet.
func normalise(tok string) string {
	var b strings.Builder
	b.Grow(len(tok))
	var last rune = -1
	for _, r := range strings.ToLower(tok) {
		if a, ok := accents[r]; ok {
			r = a
		}
		if l, ok := leet[r]; ok {
			r = l
		}
		if r == '*' {
			r = wildcard // a masked-out letter: keep its SLOT (see eqWild)
		} else if r < 'a' || r > 'z' {
			continue // separators, leftover digits and symbols carry no meaning here
		}
		// Doubled letters collapse ("cooonnnard" -> "conard"), but wildcards never
		// do: "f**k" must keep both holes or it no longer lines up with "fuck".
		if r == last && r != wildcard {
			continue
		}
		b.WriteRune(r)
		last = r
	}
	return b.String()
}

// collapse strips control characters (a chat line must stay ONE line) and
// squeezes runs of whitespace, which is also the cheapest anti-flood there is:
// a wall of newlines becomes a single space.
func collapse(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if r == '\n' || r == '\r' || r == '\t' || r == ' ' {
			space = true
			continue
		}
		if r < 0x20 || r == 0x7f {
			continue // other control characters: dropped outright
		}
		if space && b.Len() > 0 {
			b.WriteByte(' ')
		}
		space = false
		b.WriteRune(r)
	}
	return b.String()
}
