#!/bin/bash
# Versión de prueba de una rama de sprint: la compila en una copia temporal (sin tocar la del turno)
# y la publica en prueba/<id>.html (solo esa carpeta; la web normal no cambia).
# Uso: sh noche/prueba.sh <id>        (rama noche/<fecha>/<id>)
set -eu
id=$1
REPO=$(cd "$(dirname "$0")/.." && pwd)
rama=$(git -C "$REPO" branch --list "noche/*/$id" | tr -d ' *+' | tail -1)
[ -n "$rama" ] || { echo "no hay rama para $id"; exit 1; }
TMP=$(mktemp -d /tmp/prueba-XXXX)
git -C "$REPO" worktree add -q --detach "$TMP" "$rama"
ln -s "$REPO/node_modules" "$TMP/node_modules"
(cd "$TMP" && npx vite build --config app/vite.config.js > /tmp/prueba-build.txt 2>&1)
html=$(ls "$TMP"/dist/*.html | head -1)
mkdir -p "$REPO/prueba"
cp "$html" "$REPO/prueba/$id.html"
git -C "$REPO" worktree remove --force "$TMP"
cd "$REPO"
env -u HIPERTUNEL_NOCHE git add "prueba/$id.html"
env -u HIPERTUNEL_NOCHE git -c user.name=eyrawolf7 -c user.email=eyrawolf7@users.noreply.github.com commit -q -m "Prueba del sprint $id ($rama, sin fusionar)" -- "prueba/$id.html"
env -u HIPERTUNEL_NOCHE git push -q origin main
echo "publicada https://eyrawolf7.github.io/hipertunel/prueba/$id.html ($(du -h "prueba/$id.html" | cut -f1))"
