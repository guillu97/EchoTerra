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
l'écran titre doit lister l'« Expédition publique ».

### Variables d'environnement (optionnelles)

| Variable | Effet |
|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | DSN Postgres (posée par l'intégration Neon). |
| `ECHOTERRA_DB` | Prioritaire (URL `postgres://` ou chemin SQLite). |
| `ECHOTERRA_WAVE_SECONDS` | Intervalle entre vagues (défaut 600 ; 60 pour tester). |
| `ECHOTERRA_TICK_TOKEN` | **Jeton du battement** (voir plus bas). Sans lui, `POST /api/tick` répond 503 et le monde n'avance plus qu'aux requêtes des joueurs. |
| `ECHOTERRA_CATCHUP_HOURS` | Retard maximal réellement rejoué pour une partie oubliée (défaut 12 h ; au-delà les vagues manquées sont sautées). |
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

## Le battement : faire tourner les parties sans joueur connecté

Echo Terra est **asynchrone** : la horde frappe et les joueurs-IA agissent que quelqu'un
soit là ou non. Or une instance Vercel **s'endort** (scale-to-zero) et ses goroutines
meurent avec elle — sans requête, plus rien ne tourne.

La réponse tient en deux pièces :

1. **L'avancement est une fonction du TEMPS ÉCOULÉ**, pas d'un processus vivant
   (`game.AdvanceTo`, backend/internal/game/sim.go). N'importe quelle instance peut
   rejouer la période manquée : vagues et rounds de joueurs-IA sont déroulés dans
   l'ordre chronologique, à leur heure prévue. L'opération est convergente — l'appeler
   deux fois de suite ne rejoue rien.
2. **Un battement l'appelle régulièrement** : `POST /api/tick` fait avancer TOUTES les
   parties actives et entretient les salons. C'est le seul appel nécessaire pour que le
   monde tourne à vide.

### Régler le battement (5 minutes, gratuit)

1. **Poser le jeton** : sur Vercel, service `backend` → Settings → Environment
   Variables → `ECHOTERRA_TICK_TOKEN` = une chaîne aléatoire (ex.
   `openssl rand -hex 24`). Redéployer.
2. **Le donner à GitHub Actions** : repo → Settings → Secrets and variables → Actions →
   *New repository secret* → `ECHOTERRA_TICK_TOKEN`, **la même valeur**. (Secret
   facultatif `ECHOTERRA_URL` si l'URL du déploiement diffère de
   `https://echo-terra-kappa.vercel.app`.)
3. C'est tout : `.github/workflows/heartbeat.yml` appelle `/api/tick` **toutes les
   15 minutes**. Vérifier une fois à la main par *Actions → Battement (tick) → Run
   workflow* — la réponse JSON liste les parties avancées.

Le workflow est gratuit (Actions est illimité sur un repo public) et sans jeton il
s'auto-désactive proprement (avertissement, pas d'échec). Deux limites à connaître :
la cadence est « au mieux » (des retards de plusieurs minutes sont courants — sans
conséquence, le serveur rattrape le temps écoulé), et **GitHub désactive les workflows
planifiés après 60 jours sans activité sur le repo** (un commit, ou le bouton *Enable
workflow*, les relance).

**Pourquoi pas le cron natif de Vercel ?** Le plan Hobby le limite à **une exécution
par jour**, très loin d'une vague toutes les 10 minutes. Il reste déclaré dans
`vercel.json` (`0 4 * * *`) comme **filet de sécurité** — si le workflow s'arrête, le
monde repart au moins une fois par jour. Les crons Vercel s'authentifient avec la
variable `CRON_SECRET` (envoyée en `Authorization: Bearer …`) : le serveur l'accepte
aussi, donc poser `CRON_SECRET` = `ECHOTERRA_TICK_TOKEN` suffit.

**Autres pingers** : n'importe quel service qui sait appeler une URL fait l'affaire
(cron-job.org, UptimeRobot…). `GET /api/tick` est accepté au même titre que `POST`,
avec le jeton en `?token=…` pour ceux qui ne savent pas poser d'en-tête.

### Pourquoi 15 minutes, et ce que ça coûte

La cadence du battement n'a pas à suivre l'intervalle des vagues : `AdvanceTo` rejoue
chaque vague **à son heure prévue**, pas à l'heure de l'appel. Un battement toutes les
15 minutes sur des vagues de 10 minutes donne donc une histoire de ville **exacte**,
simplement révélée jusqu'à 15 min plus tard quand personne ne joue — et la première
requête d'un joueur rattrape le reliquat aussitôt.

Le facteur limitant n'est pas Vercel mais **la base**. Ordres de grandeur mensuels :

| Ressource | Quota gratuit | Battement à 15 min | Part |
|---|---|---|---|
| Vercel — invocations | 1 000 000 | ~2 900 | ~0,3 % |
| Vercel — Active CPU | 4 CPU-h | ~0,1 CPU-h | ~2 % |
| Vercel — mémoire provisionnée | 360 GB-h | ~2 GB-h | ~0,5 % |
| **Neon — compute** | **100 CU-h** | **~61 CU-h** | **~61 %** |
| GitHub Actions (repo public) | illimité | — | 0 € |

Un sweep coûte 10–30 ms de CPU : côté Vercel le battement disparaît dans le bruit (le
poll du frontend, toutes les 20 s par joueur, pèse bien plus lourd). Côté Neon en
revanche, le plan gratuit **suspend le compute après 5 minutes d'inactivité** et n'offre
que 100 CU-heures : un battement toutes les 5 min tomberait pile sur ce seuil, la base
ne s'endormirait jamais (~182 CU-h/mois, **presque le double du quota**). À 15 min elle
dort ~10 min sur 15. Si tu passes à une cadence plus courte, prévois le plan Neon payant.

Sur Hobby, un dépassement **met le projet en pause** au lieu de facturer — pas de
surprise sur la carte.

### Parties oubliées

Une partie laissée sans personne rejoue au plus `ECHOTERRA_CATCHUP_HOURS` (12 h par
défaut) : au-delà, les vagues manquées sont **sautées** et l'oubli est tracé dans le
journal de la ville (« N vagues passées sans personne »). Sans ce plafond, trois jours
d'absence représenteraient des centaines de vagues, donc des dizaines de milliers de
monstres — un état ingérable. Dans la fenêtre rejouée, en revanche, tout se produit
vraiment : une ville sans défenseur **peut tomber pendant l'absence**, c'est la règle.

## Ce qui change quand `VERCEL` est présent (vs dev local)

Le binaire est le même ; `main.go` choisit `api.NewServerless` au lieu de `api.New` :
les instances Vercel s'endorment (scale-to-zero) et peuvent être plusieurs, donc **pas
de goroutines ni de cache mémoire inter-requêtes** — la base est la seule vérité.

- **Vagues et bots** : `game.AdvanceTo` rejoue le temps écoulé, appelé par le battement
  (ci-dessus) et, en filet, par toute requête touchant la partie (budget réduit : un
  joueur attend sa réponse, le reste passe au tour suivant).
- **Salon public + purge des lobbies morts** : `housekeeping()` sur le battement et sur
  le poll de la liste des parties (écran titre). Il **dédoublonne** aussi les salons
  publics vides que deux instances froides auraient créés en parallèle.
- **Concurrence** : le battement écrit avec une sauvegarde **conditionnelle**
  (`store.SaveIfUnchanged`, colonne `rev`) — il abandonne son rattrapage plutôt que
  d'écraser l'action d'un joueur écrite entre-temps par une autre instance. La course
  joueur↔joueur reste possible en théorie (deux instances, même partie, même instant) ;
  acceptable au stade prototype, à durcir (verrou en base) avant une vraie ouverture.

## Limites du plan gratuit à connaître

- **Cold starts** : première requête après idle ≈ 1 s (Go démarre vite).
- **Neon gratuit** : ~0,5 Go, l'instance se suspend après idle (première requête un peu
  plus lente) — sans impact gameplay.
- `asset-index/`, `scripts/` et `journal.md` sont exclus du déploiement (`.vercelignore`) ;
  les ~200 Mo d'assets de `frontend/public/assets/` partent sur le CDN normalement.
