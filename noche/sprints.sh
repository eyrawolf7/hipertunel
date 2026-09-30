#!/bin/bash
# Sprints de día encadenados: uno detrás de otro, sin esperar a Víctor. Cada sprint = una tarea de
# .noche/tareas.json (se pone 'pendiente' y el turno la hace en ≤ 4 rondas). Al acabar, su versión
# de prueba se publica en prueba/<id>.html (solo esa carpeta; la web normal no cambia) y empieza el
# siguiente. Uso: sh noche/sprints.sh id1 id2 id3 …
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
CARRIL=${CARRIL:-noche}
WT="$REPO/../hipertunel-$CARRIL"
EST="$WT/.noche"
LOG="$EST/logs/sprints.txt"
# si ya hay un turno en marcha, espera a que acabe
while [ -f "$WT/.noche/turno.pid" ] && kill -0 "$(cat "$WT/.noche/turno.pid")" 2>/dev/null; do sleep 30; done
for id in "$@"; do
  python3 - "$EST/tareas.json" "$id" <<'EOF'
import json, sys
p, i = sys.argv[1], sys.argv[2]
d = json.load(open(p))
for t in d['tareas']:
    if t['id'] == i and t['estado'] in ('espera', 'pendiente'): t['estado'] = 'pendiente'
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1)
EOF
  echo "=== sprint $id · $(date +%H:%M)" | tee -a "$LOG"
  sh "$REPO/noche/turno.sh" 23:59 2 >> "$LOG" 2>&1
  # si la ronda dejó trabajo sin commitear, se guarda como WIP en su rama (si no, bloquea las siguientes)
  if [ -n "$(git -C "$WT" status --porcelain --untracked-files=no)" ]; then
    git -C "$WT" add -u && env GIT_AUTHOR_NAME=eyrawolf7 GIT_AUTHOR_EMAIL=eyrawolf7@users.noreply.github.com GIT_COMMITTER_NAME=eyrawolf7 GIT_COMMITTER_EMAIL=eyrawolf7@users.noreply.github.com git -C "$WT" commit -q -m "WIP $id (fin de sprint)" && echo "    WIP guardado en $(git -C "$WT" branch --show-current)" | tee -a "$LOG"
  fi
  estado=$(python3 -c "import json,sys;print([t['estado'] for t in json.load(open('$EST/tareas.json'))['tareas'] if t['id']=='$id'][0])")
  echo "=== fin sprint $id · $(date +%H:%M) · $estado" | tee -a "$LOG"
  # versión de prueba en la web (solo prueba/), fuera del entorno del turno (que no puede publicar)
  if [ -f "$WT/builds-noche/$id.html" ]; then
    mkdir -p "$REPO/prueba"
    cp "$WT/builds-noche/$id.html" "$REPO/prueba/$id.html"
    (cd "$REPO" && env -u HIPERTUNEL_NOCHE git add prueba/$id.html \
      && env -u HIPERTUNEL_NOCHE git -c user.name=eyrawolf7 -c user.email=eyrawolf7@users.noreply.github.com commit -q -m "Prueba del sprint $id (rama noche/…/$id, sin fusionar)" -- prueba/$id.html \
      && env -u HIPERTUNEL_NOCHE git push -q origin main) >> "$LOG" 2>&1 && echo "    publicada prueba/$id.html" | tee -a "$LOG"
  fi
  # el sprint no puede quedarse 'pendiente': si no acabó, pasa a 'espera' con su nota
  python3 - "$EST/tareas.json" "$id" <<'EOF'
import json, sys
p, i = sys.argv[1], sys.argv[2]
d = json.load(open(p))
for t in d['tareas']:
    if t['id'] == i and t['estado'] in ('pendiente', 'en_curso'): t['estado'] = 'espera'; t['nota'] = (t.get('nota') or '') + ' [sprint sin terminar en 4 rondas]'
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1)
EOF
done
echo "=== sprints terminados · $(date +%H:%M)" | tee -a "$LOG"
