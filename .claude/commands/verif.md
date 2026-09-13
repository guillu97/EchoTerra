---
description: Joue toute la batterie de vérification d'Echo Terra (Go, typage, build, 13 suites de navigateur) et rend un verdict
---

La batterie complète, dans l'ordre où elle échoue le plus vite. Joue-la ENTIÈREMENT
(ne t'arrête pas au premier rouge : un rapport partiel fait reprendre le travail deux fois),
puis rends un verdict ligne par ligne.

1. `go -C backend test ./...` — 27 paquets. Contient le **plancher de survie** : `balance_test.go`
   joue des parties entières et exige 12 vagues sur toute graine, de 1 à 20 joueurs.
2. `gofmt -l backend` — doit ne rien rendre.
3. `go -C backend vet ./...`
4. `npm --prefix frontend exec -- tsc -b`
5. `npm --prefix frontend run build`
6. `cd frontend && node tests/run.mjs` — les 13 suites de navigateur. Le lanceur démarre
   lui-même le backend et Vite (base de données jetable) et referme ce qu'il a ouvert.
   Une suite seule : `node tests/run.mjs fog weather` · la liste : `--list`.

Si l'on a touché aux modèles voxel ou aux échelles de pose, ajoute
`node tests/run.mjs proportions` et LIS `asset-index/PROPORTIONS.md` : une taille se
mesure en tuiles contre le repère héros, jamais à l'œil sur une capture.

Si l'on a touché à l'équilibrage, joue aussi `go -C backend run ./cmd/balance -sweep` et
compare les médianes à celles du journal — la courbe doit rester MONOTONE (1 < 4 < 20 joueurs).

Verdict attendu : une ligne par étape avec ✅/❌ et, pour chaque rouge, la sortie qui le prouve.
