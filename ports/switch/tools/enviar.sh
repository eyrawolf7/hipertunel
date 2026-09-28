#!/bin/sh
# Manda el juego a la Switch por la red local con nxlink (la consola y el Mac en la misma wifi).
# En la Switch: abre el Homebrew Menu y pulsa Y (modo netloader). Después:
#   sh ports/switch/tools/enviar.sh              (busca la consola sola)
#   sh ports/switch/tools/enviar.sh -a 192.168.1.50   (si no la encuentra, con su IP)
# Si no hay nxlink instalado, lo compila una vez desde el código de switchbrew (solo necesita cc y zlib).
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
NRO="$HERE/build/hipertunel.nro"
[ -f "$NRO" ] || sh "$HERE/tools/switch-build.sh"
NXLINK=$(command -v nxlink || true)
[ -z "$NXLINK" ] && [ -n "$DEVKITPRO" ] && [ -x "$DEVKITPRO/tools/bin/nxlink" ] && NXLINK="$DEVKITPRO/tools/bin/nxlink"
if [ -z "$NXLINK" ]; then
  NXLINK="$HERE/build/nxlink"
  if [ ! -x "$NXLINK" ]; then
    echo "Compilando nxlink..."
    T=$(mktemp -d)
    curl -sL https://github.com/switchbrew/switch-tools/archive/refs/heads/master.tar.gz | tar xz -C "$T"
    cc -O2 -DPACKAGE_STRING='"nxlink"' "$T"/switch-tools-master/src/nxlink.c -o "$NXLINK" -lz
    rm -rf "$T"
  fi
fi
# -s: se queda escuchando y enseña aquí los printf del juego (Ctrl+C para salir)
exec "$NXLINK" -s "$@" "$NRO"
