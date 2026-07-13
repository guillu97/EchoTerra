# Déployer Echo Terra sur Vercel (plan gratuit / Hobby)

Le repo utilise le preset **Services** de Vercel : deux services dans UN projet, définis par
`vercel.json` —

- **`frontend`** (root `frontend/`, framework Vite) : build statique servi par le CDN.
- **`backend`** (root `backend/`) : le **vrai serveur Go** (`cmd/server/main.go`, détecté
  automatiquement par le preset Go). Sur Vercel il écoute sur la variable `PORT` injectée et
  passe en mode *stateless* (voir plus bas). Les rewrites publient `/api/*` et `/healthz`
  vers lui, tout le reste vers le frontend.

## Étapes

1. **Merger cette branche dans `main`** — l'assistant d'import Vercel lit la branche de
   production ; sans le `vercel.json` il propose sa propre config générée.
2. **Importer le projet** — sur [vercel.com/new](https://vercel.com/new), choisir le repo
   `guillu97/EchoTerra`. L'assistant détecte le preset *Services* et lit le `vercel.json`
   du repo (bouton **Refresh** si tu avais déjà l'écran ouvert avant le merge). Déployer.
3. **Créer la base de données** — dans le projet Vercel : **Storage → Create Database →
   Neon (Postgres)**, plan gratuit, puis **Connect** au projet : Vercel injecte
   `DATABASE_URL` dans l'environnement du service backend.
4. **Redéployer** (Deployments → ⋯ → Redeploy) pour que le backend voie `DATABASE_URL`.

Vérification : `https://<projet>.vercel.app/healthz` doit répondre `{"ok":true,...}` et
l'écran titre doit lister une expédition publique (« Expédition de <nom de ville> »).

### Variables d'environnement (optionnelles)

| Variable | Effet |
|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | DSN Postgres (posée par l'intégration Neon). |
| `ECHOTERRA_DB` | Prioritaire (URL `postgres://` ou chemin SQLite). |
| `ECHOTERRA_WAVE_SECONDS` | Intervalle entre vagues (défaut 600 ; 60 pour tester). |
| `ECHOTERRA_GOOGLE_CLIENT_ID` | Active « Continuer avec Google » (voir ci-dessous). Vide = bouton masqué. |
| `PORT` / `VERCEL` | Posées par Vercel — ne pas les définir à la main. |

Sans base configurée, le backend retombe sur un SQLite local **éphémère** (le disque des
instances Vercel ne survit pas) : OK pour une démo, mais les parties disparaissent aux
redémarrages — branche Neon pour de la vraie persistance.

### Connexion Google (gratuite, optionnelle)

1. [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services →
   Credentials → **Create OAuth client ID**, type **Web application** (l'écran de
   consentement "External" suffit, pas de vérification pour le simple login).
2. **Authorized JavaScript origins** : `http://localhost:5173` (dev) + l'URL du
   déploiement (ex. `https://echoterra.vercel.app`). Pas de redirect URI (flux GIS).
3. Poser le client ID dans `ECHOTERRA_GOOGLE_CLIENT_ID` **sur le service backend**
   (le front le découvre à l'exécution via `GET /api/auth/config` — aucun rebuild).

Le serveur vérifie chaque `id_token` auprès de Google (`tokeninfo` : signature,
expiration, audience, email vérifié). Apple Sign-In n'est pas proposé : il exige
l'Apple Developer Program (~99 $/an).

## Ce qui change quand `VERCEL` est présent (vs dev local)

Le binaire est le même ; `main.go` choisit `api.NewServerless` au lieu de `api.New` :
les instances Vercel s'endorment (scale-to-zero) et peuvent être plusieurs, donc **pas de
goroutines ni de cache mémoire inter-requêtes** — tout est rattrapé paresseusement :

- **Vagues** : `CatchUpWaves` dans `tick` à chaque accès à la partie (le front poll
  toutes les 20 s). Une partie ignorée rattrape toutes ses vagues au prochain accès.
- **Bots** : `BotCatchUp` (bots.go) rejoue ~1 round de bots par minute écoulée (plafonné
  à 6) à chaque requête sur la partie.
- **Salon public + purge des lobbies morts** : `lazyHousekeeping` sur le poll de la liste
  des parties (écran titre).
- Chaque requête relit la base ; le verrou par partie ne protège que dans une instance —
  deux requêtes simultanées sur deux instances peuvent en théorie se perdre une écriture
  (lost update). Acceptable au stade prototype ; à durcir (verrou en base / version
  optimiste) avant une vraie ouverture publique.

## Limites du plan gratuit à connaître

- **Cold starts** : première requête après idle ≈ 1 s (Go démarre vite).
- **Neon gratuit** : ~0,5 Go, l'instance se suspend après idle (première requête un peu
  plus lente) — sans impact gameplay.
- `asset-index/`, `scripts/` et `journal.md` sont exclus du déploiement (`.vercelignore`) ;
  les ~200 Mo d'assets de `frontend/public/assets/` partent sur le CDN normalement.
