# Déployer Echo Terra sur Vercel (plan gratuit / Hobby)

Le repo est prêt pour Vercel tel quel :

- **Frontend** : build Vite statique (`vercel.json` → `npm --prefix frontend run build`,
  sortie `frontend/dist`), servi par le CDN Vercel.
- **Backend** : le routeur Go complet tourne dans **une seule fonction serverless**
  (`api/index.go` → `backend/serverless`). Les rewrites envoient `/api/*` et `/healthz`
  vers cette fonction ; le client appelle déjà l'API en relatif, donc rien à configurer.
- **Persistance** : le store parle **SQLite** (dev local) **et Postgres** (prod). Sur
  Vercel le disque est éphémère → il faut une base Postgres (Neon, gratuit).

## Étapes (une fois, ~5 minutes)

1. **Importer le projet** — sur [vercel.com/new](https://vercel.com/new), choisir le repo
   GitHub `guillu97/EchoTerra` (compte déjà relié). Ne rien changer aux réglages de build :
   `vercel.json` pilote tout (Framework preset : *Other*). Déployer une première fois.
2. **Créer la base de données** — dans le projet Vercel : onglet **Storage → Create
   Database → Neon (Postgres)**, plan gratuit, puis **Connect** au projet. Vercel injecte
   automatiquement `DATABASE_URL` dans l'environnement de la fonction.
3. **Redéployer** (Deployments → ⋯ → Redeploy) pour que la fonction voie `DATABASE_URL`.

C'est tout. L'URL du projet sert le jeu ; `https://<projet>.vercel.app/healthz` doit
répondre `{"ok":true,...}`.

### Variables d'environnement (optionnelles)

| Variable | Effet |
|---|---|
| `DATABASE_URL` / `POSTGRES_URL` | DSN Postgres (posée par l'intégration Neon). |
| `ECHOTERRA_DB` | Prioritaire sur les deux ci-dessus (URL postgres:// ou chemin SQLite). |
| `ECHOTERRA_WAVE_SECONDS` | Intervalle entre vagues (défaut 600 ; 60 pour tester). |

Sans aucune base configurée, la fonction retombe sur un SQLite **éphémère** dans `/tmp` :
le site marche pour une démo rapide mais les parties disparaissent aux cold starts.

## Ce qui change en mode serverless (vs `go run ./cmd/server`)

Pas de process résident → pas de goroutines. Tout est rattrapé **paresseusement**
(`api.NewServerless`) :

- **Vagues** : déjà lazy (`CatchUpWaves` dans `tick`) — le front poll toutes les 20 s,
  donc les vagues tombent dès que quelqu'un regarde la partie. Une partie que personne
  ne consulte rattrape toutes ses vagues au prochain accès.
- **Bots** : `BotCatchUp` (bots.go) rejoue ~1 round de bots par minute écoulée (plafonné
  à 6 rounds) à chaque requête sur la partie — remplace le tick scheduler.
- **Salon public + purge des lobbies morts** : `lazyHousekeeping` s'exécute sur le poll
  de la liste des parties (écran titre).
- **Pas de cache mémoire inter-requêtes** : chaque requête relit la base (plusieurs
  instances de fonction peuvent coexister). Le verrou par partie ne protège que dans une
  instance — deux requêtes simultanées sur deux instances peuvent en théorie se marcher
  dessus (lost update). Acceptable au stade prototype ; à durcir (verrou en base /
  version optimiste) avant une vraie ouverture publique.

## Limites du plan gratuit à connaître

- **Cold starts** : première requête après idle ≈ 1 s de latence (Go reste léger).
- **Timeout fonction** : 10 s par requête (largement assez, tout est du CRUD JSON).
- **Neon gratuit** : ~0,5 Go de stockage, l'instance se suspend après idle (première
  requête un peu plus lente) — sans impact gameplay, tout est resynchronisé au réveil.
- `asset-index/`, `scripts/` et `journal.md` sont exclus du déploiement (`.vercelignore`) ;
  les ~200 Mo d'assets de `frontend/public/assets/` partent sur le CDN normalement.
