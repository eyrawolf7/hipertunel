#!/bin/bash
# Turno de noche de Hipertúnel: un bucle de rondas de Claude, cada una con el contexto limpio, que
# trabaja en una copia aparte del repositorio (git worktree) y NUNCA en main ni publica nada.
#
#   sh noche/turno.sh [hasta HH:MM] [máximo de rondas]      p. ej.  sh noche/turno.sh 07:30 60
#
# - Copia de trabajo: ../hipertunel-noche (rama de integración noche/AAAA-MM-DD, creada desde main).
# - Cada tarea va en su propia rama noche/AAAA-MM-DD/<id> (desde main). Si pasa la puerta, se fusiona
#   también en la de integración, para poder probarlo todo junto. Víctor elige por la mañana.
# - Estado (tareas, progreso, informe, capturas): ../hipertunel-noche/.noche/ (fuera de git).
# - Seguridad: ajustes propios (noche/ajustes.json: sin push, sin publicar, sin tocar el núcleo de
#   Boost 2), un gancho pre-push que rechaza cualquier push con HIPERTUNEL_NOCHE=1 y la puerta de
#   verificación (noche/puerta.sh) antes de cada commit.
set -u
REPO=$(cd "$(dirname "$0")/.." && pwd)
HASTA=${1:-07:30}
MAX=${2:-60}
FECHA=$(date +%F)
WT="$REPO/../hipertunel-noche"
EST="$WT/.noche"
export HIPERTUNEL_NOCHE=1 HIP_PORT=5174 HIP_URL=http://localhost:5174/
export GIT_AUTHOR_NAME=eyrawolf7 GIT_AUTHOR_EMAIL=eyrawolf7@users.noreply.github.com
export GIT_COMMITTER_NAME=eyrawolf7 GIT_COMMITTER_EMAIL=eyrawolf7@users.noreply.github.com

# gancho pre-push: con HIPERTUNEL_NOCHE=1 no sale nada hacia GitHub (vale para todas las copias)
HOOK="$(git -C "$REPO" rev-parse --git-common-dir)/hooks/pre-push"
if ! grep -q HIPERTUNEL_NOCHE "$HOOK" 2>/dev/null; then
  printf '#!/bin/sh\n# turno de noche: prohibido publicar\n[ "$HIPERTUNEL_NOCHE" = 1 ] && { echo "pre-push: el turno de noche no puede publicar" >&2; exit 1; }\nexit 0\n' > "$HOOK"
  chmod +x "$HOOK"
fi

# copia de trabajo y estado
if [ ! -d "$WT" ]; then
  git -C "$REPO" worktree add -B "noche/$FECHA" "$WT" main || exit 1
  ln -s "$REPO/node_modules" "$WT/node_modules"
fi
mkdir -p "$EST/logs" "$EST/capturas" "$EST/builds"
[ -f "$EST/tareas.json" ] || cp "$REPO/noche/tareas.json" "$EST/tareas.json"
[ -f "$EST/progreso.md" ] || printf '# Turno de noche %s\n\n' "$FECHA" > "$EST/progreso.md"
cp "$REPO/noche/ajustes.json" "$EST/ajustes.json"
cd "$WT" || exit 1

# servidor de desarrollo de la copia, en su puerto
if ! curl -s -o /dev/null "$HIP_URL"; then
  (npx vite --config app/vite.config.js --host > "$EST/logs/vite.txt" 2>&1 &)
  sleep 5
fi

echo "Turno de noche $FECHA hasta las $HASTA (máx. $MAX rondas). Copia: $WT" | tee -a "$EST/logs/turno.txt"
for i in $(seq 1 "$MAX"); do
  [ "$(date +%H:%M)" \> "$HASTA" ] && [ "$(date +%H)" -lt 20 ] && { echo "Hora de parar ($HASTA)" | tee -a "$EST/logs/turno.txt"; break; }
  grep -q '"estado": *"pendiente"' "$EST/tareas.json" || { echo "No quedan tareas pendientes" | tee -a "$EST/logs/turno.txt"; break; }
  echo "--- ronda $i · $(date +%H:%M)" | tee -a "$EST/logs/turno.txt"
  claude -p "$(cat "$REPO/noche/RONDA.md")" \
    --settings "$EST/ajustes.json" --permission-mode acceptEdits --permission-prompts none \
    --add-dir "$EST" "$HOME/Documents/Proyectos/apks-referencia" --output-format stream-json --verbose \
    > "$EST/logs/ronda-$(printf %02d "$i").jsonl" 2>> "$EST/logs/turno.txt"
  echo "    fin de ronda $i · $(date +%H:%M) · rama: $(git branch --show-current)" | tee -a "$EST/logs/turno.txt"
  # si ha llegado al límite de uso, espera y reintenta (el plan se recarga por tramos de horas)
  if tail -c 4000 "$EST/logs/ronda-$(printf %02d "$i").jsonl" | grep -qi "usage limit\|rate limit\|limit reached"; then
    echo "    límite de uso: espero 30 min" | tee -a "$EST/logs/turno.txt"; sleep 1800
  fi
done
echo "Turno terminado $(date +%H:%M). Informe: $EST/INFORME.md" | tee -a "$EST/logs/turno.txt"
