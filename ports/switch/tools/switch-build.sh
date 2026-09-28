#!/bin/sh
# Compila build/hipertunel.nro. Usa devkitPro si está instalado; si no, la imagen oficial de
# Docker (devkitpro/devkita64), sin instalar nada en el sistema.
# Uso: sh ports/switch/tools/switch-build.sh [clean]
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
if [ -n "$DEVKITPRO" ] && [ -d "$DEVKITPRO/libnx" ]; then
  make -C "$HERE" "$@"
else
  command -v docker >/dev/null || { echo "Falta devkitPro o Docker (brew install colima docker)"; exit 1; }
  docker info >/dev/null 2>&1 || { command -v colima >/dev/null && colima start; }
  docker run --rm -v "$ROOT":/p -w /p/ports/switch devkitpro/devkita64 make "$@"
fi
ls -l "$HERE/build/hipertunel.nro"
