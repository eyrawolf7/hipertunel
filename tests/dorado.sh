#!/bin/sh
# Trazas doradas de los modos de Boost 2 (Clásico, Supervivencia, Contrarreloj): la simulación en
# JS y la de C tienen que dar EXACTAMENTE lo guardado en tests/dorado/. Solo Víctor puede
# regenerarlas (si una mejora cambia el Clásico a propósito). Uso: sh tests/dorado.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../ports/switch/build"
mkdir -p "$OUT"
cc -O2 -std=c99 -ffp-contract=off "$HERE/../ports/switch/sim/rng.c" "$HERE/../ports/switch/sim/waves.c" "$HERE/../ports/switch/sim/game.c" \
  "$HERE/../ports/switch/sim/bot.c" "$HERE/../ports/switch/sim/jsmath.c" "$HERE/../ports/switch/tools/trace.c" -o "$OUT/trace-dorado" -lm
bad=0
for f in "$HERE"/dorado/*.txt; do
  n=$(basename "$f" .txt); m=${n%%-*}; r=${n#*-}; s=${r%%-*}; v=${r#*-}; a=""; [ "$v" = god ] && a=god
  node "$HERE/../ports/switch/tools/trace.mjs" "$m" "$s" 18000 $a | cmp -s - "$f" || { echo "CAMBIA en JS: $n"; bad=1; }
  "$OUT/trace-dorado" "$m" "$s" 18000 $a | cmp -s - "$f" || { echo "CAMBIA en C:  $n"; bad=1; }
done
[ $bad = 0 ] && echo "Dorado OK: Boost 2 intacto" || { echo "Dorado ROTO"; exit 1; }
