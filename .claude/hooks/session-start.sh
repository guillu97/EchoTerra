#!/bin/bash
# Prépare une session Claude Code sur le web pour qu'elle puisse VÉRIFIER son
# travail dès le premier outil, et non après un préambule manuel.
#
# Sans lui, `frontend/node_modules` est absent au démarrage : `tsc`, `vite` et
# les 13 suites e2e échouent toutes — les suites avec un timeout de 30 s sur
# `window.__eg?.store`, un message qui ne dit PAS « il manque les dépendances ».
#
# Idempotent (on peut le rejouer), non interactif, et borné au distant : en
# local le dépôt est déjà installé.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

echo "· frontend : npm install"
npm --prefix frontend install --no-audit --no-fund

# `sharp` vit à la RACINE et ne sert qu'aux aperçus PNG des générateurs voxel
# (gen-props, gen-characters…). Sans lui ils écrivent les .vox et SAUTENT les
# aperçus en le disant — donc on ne voit pas ce qu'on vient de modeler.
echo "· racine : npm install (sharp, aperçus des modèles)"
npm install --no-audit --no-fund

echo "· scripts d'assets : npm install"
npm --prefix scripts install --no-audit --no-fund

echo "· backend : go mod download (télécharge aussi la chaîne go.mod)"
go -C backend mod download

# Chromium est préinstallé dans l'image (PLAYWRIGHT_BROWSERS_PATH), mais les
# suites lisent PERF_BROWSER : on le leur donne une fois pour toute la session
# plutôt que de le préfixer à chaque commande.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PERF_BROWSER=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
  echo "· PERF_BROWSER=/opt/pw-browsers/chromium"
fi

echo "✅ prêt : go test ./... · npx tsc -b · npm --prefix frontend run test:e2e"
