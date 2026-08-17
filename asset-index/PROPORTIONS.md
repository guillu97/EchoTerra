# Proportions des assets — mesuré, pas estimé

> Généré par `npm run test:proportions` (frontend, dev servers lancés). Les tailles sont
> celles de la scène RÉELLEMENT rendue : géométrie maillée × échelle posée (boost des
> arbres, `fitScale` de la ville et échelles par espèce compris).

Repère : un héros mesure **0.6 tuile** de haut (`characters.ts`, `HERO_HEIGHT`).
S'il représente un humain d'environ 1.7 m, alors **1 tuile ≈ 2.83 m**.

| asset | type | largeur (tuiles) | hauteur (tuiles) | hauteur ≈ | × héros | verdict |
|---|---|---|---|---|---|---|
| `house2` | ville | 2.25–2.39 | 3.46–3.67 | 10.40 m | ×6.12 | ok |
| `bank` | ville | 3.60 | 2.77 | 7.85 m | ×4.62 | — |
| `workshop` | ville | 3.60 | 2.59 | 7.34 m | ×4.32 | — |
| `house` | ville | 2.37–2.89 | 2.12–2.37 | 6.72 m | ×3.95 | ok |
| `well` | ville | 2.30 | 2.30 | 6.52 m | ×3.83 | — |
| `tree-green` | prop | 0.48–1.40 | 0.80–2.22 | 6.28 m | ×3.69 | ok |
| `pine` | prop | 0.59–1.10 | 1.09–2.05 | 5.81 m | ×3.42 | ok |
| `wall` | ville | 4.40 | 1.97 | 5.59 m | ×3.29 | — |
| `cloud` | météo | 2.88–6.40 | 0.85–1.83 | 5.18 m | ×3.05 | — |
| `house3` | ville | 2.62 | 1.49 | 4.23 m | ×2.49 | ok |
| `panel` | ville | 2.10 | 1.48 | 4.20 m | ×2.47 | — |
| `pine-snow` | prop | 0.53–0.78 | 1.01–1.48 | 4.19 m | ×2.47 | ok |
| `palm` | prop | 0.61–0.88 | 0.91–1.32 | 3.75 m | ×2.20 | ok |
| `tree-pink` | prop | 0.68–0.78 | 1.10–1.27 | 3.59 m | ×2.11 | ok |
| `cactus` | prop | 0.34–0.45 | 0.81–1.03 | 2.90 m | ×1.71 | ok |
| `frost-tree` | prop | 0.44–0.56 | 0.84–1.02 | 2.89 m | ×1.70 | ok |
| `olive` | prop | 0.54–0.77 | 0.66–0.95 | 2.68 m | ×1.58 | ok |
| `char-scout` | héros (ville) | 0.53 | 0.94 | 2.66 m | ×1.57 | — |
| `dead-tree` | prop | 0.49 | 0.89 | 2.53 m | ×1.49 | ok |
| `ruin-arch` | prop | 0.67 | 0.88 | 2.48 m | ×1.46 | ok |
| `ruin-column` | prop | 0.50 | 0.71 | 2.01 m | ×1.18 | ok |
| `street-stall` | ville | 0.95 | 0.70 | 1.97 m | ×1.16 | ok |
| `mob-windelemental` | monstre | 0.52 | 0.61 | 1.72 m | ×1.01 | — |
| `fence` | ville | 1.02 | 0.42–0.48 | 1.36 m | ×0.80 | ok |
| `bush-dense` | prop | 0.19–0.85 | 0.11–0.47 | 1.34 m | ×0.79 | ok |
| `mob-goblin` | monstre | 0.42 | 0.45 | 1.28 m | ×0.75 | — |
| `mob-ghost` | monstre | 0.43 | 0.43 | 1.22 m | ×0.72 | — |
| `scarecrow` | prop | 0.32 | 0.42 | 1.19 m | ×0.70 | ok |
| `street-cart` | ville | 0.95 | 0.42 | 1.18 m | ×0.69 | ok |
| `reed` | prop | 0.10–0.12 | 0.36–0.40 | 1.14 m | ×0.67 | ok |
| `snowman` | prop | 0.37 | 0.38 | 1.09 m | ×0.64 | ok |
| `ice-spike` | prop | 0.35–0.37 | 0.35–0.37 | 1.06 m | ×0.62 | ok |
| `street-furniture` | ville | 0.95 | 0.30 | 0.86 m | ×0.50 | ok |
| `fern` | prop | 0.16–0.80 | 0.06–0.30 | 0.85 m | ×0.50 | ok |
| `tumbleweed` | météo | 0.18–0.27 | 0.19–0.27 | 0.75 m | ×0.44 | ok |
| `firefly` | prop | 0.24–0.31 | 0.13–0.24 | 0.67 m | ×0.39 | ok |
| `rock` | prop | 0.31–0.35 | 0.18–0.20 | 0.58 m | ×0.34 | ok |
| `flowers` | prop | 0.06–0.16 | 0.08–0.20 | 0.57 m | ×0.33 | ok |
| `grass-tuft` | prop | 0.07–0.23 | 0.08–0.20 | 0.57 m | ×0.33 | ok |
| `tallgrass` | prop | 0.22 | 0.19 | 0.53 m | ×0.31 | ok |
| `ruin-slab` | prop | 0.51 | 0.18 | 0.52 m | ×0.31 | ok |
| `web` | prop | 0.19 | 0.18 | 0.51 m | ×0.30 | ok |
| `daisy` | ville | 0.05 | 0.17 | 0.48 m | ×0.28 | ok |
| `frost-bush` | prop | 0.21 | 0.16 | 0.44 m | ×0.26 | ok |
| `dune-grass` | prop | 0.07–0.13 | 0.08–0.13 | 0.37 m | ×0.22 | ok |
| `butterfly` | prop | 0.19–0.22 | 0.04–0.12 | 0.35 m | ×0.20 | ok |
| `mushroom` | prop | 0.08–0.12 | 0.08–0.12 | 0.34 m | ×0.20 | ok |
| `snowdrift` | prop | 0.21–0.26 | 0.08–0.10 | 0.28 m | ×0.17 | ok |
| `hare` | prop | 0.08 | 0.08 | 0.24 m | ×0.14 | ok |
| `shells` | prop | 0.20 | 0.04 | 0.10 m | ×0.06 | ok |

**0 asset(s) hors fourchette** sur 50 mesurés.
