#!/bin/sh
# Prueba de paridad: la simulación en C debe dar exactamente la misma traza que la de JS.
# Uso: sh ports/switch/tools/parity.sh [fotogramas] [semillas...]
#   por defecto 18000 fotogramas (5 min) y semillas 1 2 3 7 42 1234 99999 3141592653
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
OUT="$HERE/../build"
mkdir -p "$OUT/traces"
FRAMES=${1:-18000}
[ $# -gt 0 ] && shift
SEEDS=${*:-"1 2 3 7 42 1234 99999 3141592653"}

# -ffp-contract=off: sin FMA, para redondear igual que JS
cc -O2 -std=c99 -Wall -Wextra -pedantic -ffp-contract=off \
  "$HERE/../sim/rng.c" "$HERE/../sim/waves.c" "$HERE/../sim/game.c" "$HERE/../sim/bot.c" "$HERE/../sim/jsmath.c" \
  "$HERE/trace.c" -o "$OUT/trace" -lm

total=0; bad=0; lines=0; difflines=0
for variant in normal god; do
  for mode in classic survival timetrial; do
    for seed in $SEEDS; do
      arg=""; [ "$variant" = god ] && arg=god
      c="$OUT/traces/$mode-$seed-$variant.c.txt"
      j="$OUT/traces/$mode-$seed-$variant.js.txt"
      "$OUT/trace" "$mode" "$seed" "$FRAMES" $arg > "$c"
      node "$HERE/trace.mjs" "$mode" "$seed" "$FRAMES" $arg > "$j"
      n=$(wc -l < "$c" | tr -d ' ')
      d=$(diff "$c" "$j" | grep -c '^[<>]' || true)
      last=$(tail -n 1 "$c")
      total=$((total + 1)); lines=$((lines + n)); difflines=$((difflines + d))
      if [ "$d" -ne 0 ]; then
        bad=$((bad + 1))
        echo "DIFERENTE  $mode seed=$seed $variant: $d líneas distintas; primera:"
        diff "$c" "$j" | head -n 4
      else
        echo "igual      $mode seed=$seed $variant ($n líneas) $last"
      fi
    done
  done
done
echo "----"
echo "$total partidas, $lines líneas de traza, $difflines líneas distintas, $bad partidas con diferencias"
[ "$bad" -eq 0 ] && echo "Paridad OK" || { echo "Paridad ROTA"; exit 1; }
