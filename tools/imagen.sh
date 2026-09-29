#!/bin/sh
# Genera o edita imágenes con modelos locales (mflux, en el chip Apple). Sin conexión ni cuentas.
#   sh tools/imagen.sh rapido  "prompt" salida.png [semilla]   # Z-Image Turbo: rápido y fiel al prompt
#   sh tools/imagen.sh bonito  "prompt" salida.png [semilla]   # Krea 2 Turbo: el más estético (conceptos)
#   sh tools/imagen.sh editar  "prompt" salida.png entrada.png [semilla]  # FLUX.2 Klein: redibuja una captura
# Las imágenes de referencia van a referencias/conceptos/ (no se publican).
set -e
export PATH="$HOME/.local/bin:$PATH"
modo="$1"; prompt="$2"; out="$3"
W=${W:-1344}; H=${H:-768}
case "$modo" in
  rapido) mflux-generate-z-image-turbo --model mflux-community/z-image-turbo-mflux-q6 --prompt "$prompt" --width $W --height $H --steps ${STEPS:-9} --seed ${4:-1} --output "$out" ;;
  bonito) mflux-generate-krea2 --model mflux-community/krea-2-turbo-mflux-q4 --prompt "$prompt" --width $W --height $H --seed ${4:-1} --output "$out" ;;
  editar) mflux-generate-flux2-edit --model mflux-community/flux2-klein-9b-mflux-q4 --base-model flux2-klein-9b --prompt "$prompt" --image-paths "$4" --width $W --height $H --seed ${5:-1} --output "$out" ;;
  *) echo "modo: rapido | bonito | editar"; exit 1 ;;
esac
