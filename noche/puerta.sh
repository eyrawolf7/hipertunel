#!/bin/bash
# Puerta de verificación del turno de noche: TODO cambio tiene que pasarla antes de su commit.
# Uso: sh noche/puerta.sh [rapida]   (rapida = sin qa.mjs, para iterar; el commit exige la completa)
# Sale con 0 si todo está en verde. Escribe un resumen de una línea por prueba.
set -u
cd "$(dirname "$0")/.."
PORT=${HIP_PORT:-5174}
export HIP_URL="http://localhost:$PORT/"
fallo=0
paso() { printf '%-28s %s\n' "$1" "$2"; }

# 1) simulación: comprobaciones y paridad con el port en C (el Clásico = Boost 2 exacto)
if node tests/sim-checks.mjs > /tmp/noche-sim.txt 2>&1 && grep -q "Todo OK" /tmp/noche-sim.txt; then paso "sim-checks" "OK"; else paso "sim-checks" "FALLA (ver /tmp/noche-sim.txt)"; fallo=1; fi
if sh ports/switch/tools/parity.sh > /tmp/noche-paridad.txt 2>&1 && grep -q "Paridad OK" /tmp/noche-paridad.txt; then paso "paridad C" "OK"; else paso "paridad C" "FALLA (ver /tmp/noche-paridad.txt)"; fallo=1; fi
# Boost 2 intacto: trazas doradas (JS y C) y archivos base sin tocar respecto a main
if sh tests/dorado.sh > /tmp/noche-dorado.txt 2>&1; then paso "Boost 2 (dorado)" "OK"; else paso "Boost 2 (dorado)" "FALLA: $(grep CAMBIA /tmp/noche-dorado.txt | head -2 | tr '\n' ' ')"; fallo=1; fi
if [ -z "$(git diff main -- app/src/sim/game.js app/src/sim/waves.js app/src/sim/rng.js tests/dorado ports/switch/tools/trace.c ports/switch/tools/trace.mjs)" ]; then paso "núcleo sin tocar" "OK"; else paso "núcleo sin tocar" "FALLA: cambios en game.js/waves.js/rng.js/dorado/trazas"; fallo=1; fi
# que el Clásico con bot siga dando lo mismo (resumen de 20 partidas)
node tests/sim-bot.mjs classic 20 2>/dev/null | tail -1 > /tmp/noche-bot.txt
if [ -f noche/bot-clasico.txt ] && ! cmp -s /tmp/noche-bot.txt noche/bot-clasico.txt; then paso "bot Clásico" "FALLA: resumen distinto al de main"; fallo=1; else paso "bot Clásico" "OK"; fi

# 2) navegador: servidor de este árbol en su propio puerto
if [ "${1:-}" != "rapida" ]; then
  if ! curl -s -o /dev/null "$HIP_URL"; then
    (HIP_PORT=$PORT npx vite --config app/vite.config.js --host > /tmp/noche-vite.txt 2>&1 &)
    for i in $(seq 1 30); do curl -s -o /dev/null "$HIP_URL" && break; sleep 1; done
  fi
  node tests/qa.mjs > /tmp/noche-qa.txt 2>&1
  if grep -q " 0 FAIL" /tmp/noche-qa.txt; then paso "qa.mjs" "$(grep -o '[0-9]* PASS · [0-9]* FAIL' /tmp/noche-qa.txt | tail -1)"; else paso "qa.mjs" "FALLA: $(grep -o '[0-9]* PASS · [0-9]* FAIL' /tmp/noche-qa.txt | tail -1) (ver /tmp/noche-qa.txt)"; fallo=1; fi
fi
exit $fallo
