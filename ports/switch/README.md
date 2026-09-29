# Hipertúnel para Nintendo Switch (homebrew): port nativo en C

Juego completo en C (SDL2 + OpenGL), jugable en el Mac y en una Switch con homebrew:

- **Simulación** (`sim/`): `app/src/sim/` traducida a C99, **idéntica al bit** a la versión JS del
  último commit (misma semilla y mismas entradas → misma partida, con los mismos bits en cada `double`).
- **Dibujo y juego** (`src/`): el túnel, la cámara, las cajas, las placas, las monedas, el cielo y los
  mundos de `app/src/render/`, pasados a OpenGL 3.3 core (escritorio) / OpenGL ES 3.0 (Switch) con
  los mismos sombreadores, más un HUD sencillo, título, pausa y fin de partida.

## Compilar y jugar en el Mac

```
brew install sdl2
cd ports/switch
make -f Makefile.desktop run
```

Teclado: **← →** (o A/D) giran (un toque = un carril, mantener = deslizar, como en la web),
**Enter/Espacio** empieza y reintenta, **P/Esc** pausa, **Esc** en pausa o al morir vuelve al
título, **Q** sale. Un mando por Bluetooth (Pro, DualSense…) también vale: palanca, cruceta, A, B,
Start, R para centrar el giroscopio y Select para encenderlo/apagarlo.

### Capturas y pruebas sin pantalla

```
make -f Makefile.desktop shots                    # build/shots/: título, filas 40/150/400 y fin
ROWS=40,150,400,800 SEED=3 make -f Makefile.desktop shots
HIP_GOD=1 HIP_CONT=1 HIP_SCREENSHOT=build/shots HIP_ROWS=1250,1700,4200 ./build/hipertunel
HIP_BOTPLAY=1 HIP_NOVSYNC=1 HIP_FRAMES=60000 ./build/hipertunel   # el bot juega varias partidas seguidas
```

Las capturas siguen el mismo guion que `tests/shots.mjs` (partida clásica con semilla, el bot
conduce hasta la fila, 20 pasos más y la imagen congelada), así se pueden poner al lado de las de
la web: `node tests/shots.mjs cmp 40 150 400 --seed=3` (con `npx vite --config app/vite.config.js`
arrancado) deja las suyas en `tests/shots/cmp/`. `HIP_GOD=1` hace que los choques no maten (para
llegar a mundos lejanos) y `HIP_CONT=1` dibuja cada paso en vez de saltar hasta la fila.

## Compilar para la Switch

Hace falta devkitPro. Hay dos caminos:

**Con Docker (sin instalar nada, es lo que se ha usado aquí):**

```
brew install colima docker && colima start      # una vez
sh ports/switch/tools/switch-build.sh           # -> ports/switch/build/hipertunel.nro
```

El script usa la imagen oficial `devkitpro/devkita64` (trae libnx, switch-sdl2, switch-mesa y
switch-glad). Si devkitPro está instalado en el sistema (`DEVKITPRO` definido), lo usa directamente.

**Con devkitPro instalado en el Mac** (pide la contraseña de administrador):

```
# instalador de https://github.com/devkitPro/pacman/releases (devkitpro-pacman-installer.pkg)
sudo installer -pkg devkitpro-pacman-installer.pkg -target /
sudo dkp-pacman -Sy switch-dev switch-sdl2 switch-mesa switch-glad
export DEVKITPRO=/opt/devkitpro
make -C ports/switch                             # -> ports/switch/build/hipertunel.nro
```

El `Makefile` es la plantilla estándar de libnx (icono `icon.jpg` de 256×256 sacado de
`assets/icon-only.png`, título "Hipertúnel", autor eyrawolf) con `-ffp-contract=off` para la
simulación. No usa romfs: todo el juego va dentro del `.nro` (unos 6 MB, casi todo es mesa).

## Instalarlo en la Switch

Hace falta una Switch con CFW/homebrew y el Homebrew Menu (hbmenu).

- **Copiándolo a la SD** (lo más sencillo): copia `ports/switch/build/hipertunel.nro` a la carpeta
  `/switch/` de la microSD (por ejemplo `/switch/hipertunel/hipertunel.nro`), vuelve a meterla y
  ábrelo desde el Homebrew Menu. Mejor lanzar el hbmenu manteniendo **R** al abrir un juego
  (modo título) que desde el Álbum: así el juego tiene toda la memoria.
- **Por la red con nxlink** (para probar cambios sin sacar la SD): Mac y Switch en la misma wifi;
  en el Homebrew Menu pulsa **Y** (netloader) y en el Mac:
  ```
  sh ports/switch/tools/enviar.sh                 # o: sh ports/switch/tools/enviar.sh -a <IP de la Switch>
  ```
  Si no tienes `nxlink`, el script lo compila la primera vez desde el código de switchbrew. Con
  `-s` se queda escuchando y enseña en el Mac los `printf` del juego (versión de OpenGL, etc.).
  Ojo: nxlink va por wifi, no por USB. Para mandar por cable USB hace falta otra herramienta
  (NS-USBloader o similar en el Mac + su servidor en la consola).

### Controles en la Switch

| Botón | Qué hace |
|---|---|
| Inclinar la consola / el mando (como un volante) | girar (giroscopio: la magnitud "a" = 0,981·sen(inclinación) de la web) |
| Palanca izquierda, cruceta ← → | girar (la cruceta con la misma asistencia de carril que la web) |
| Cruceta o palanca ← → en el título | elegir modo: **Arcade** (el de «Jugar» en la web) o **Clásico** (Boost 2 tal cual) |
| **A** | empezar / otra vez |
| **+** | pausa y seguir; en el título, salir al Homebrew Menu |
| **B** | en pausa o al morir, volver al título |
| **R**, **ZR** o clic de la palanca derecha | centrar el giroscopio (también se centra solo al empezar cada partida) |
| **−** | giroscopio sí/no |
| **X** | invertir el giro del giroscopio |
| **Y** | vibración sí/no |

Vibración HD (`nx_rumble` en `src/nx.c`): un zumbido grave muy suave que sube con la velocidad y
pulsos en monedas, impulsos, roces, choques y plegados.

En el título hay una barra con un punto verde que se mueve al inclinar: sirve para comprobar el
sentido del giroscopio antes de jugar.

Funciona en portátil, con los Joy-Con en el soporte y con el mando Pro (se lee el sensor del
mando que se esté usando). **Sin probar en consola**: el signo del eje del acelerómetro está
puesto por lógica (`gyroSign` en `src/main.c`); si al inclinar a la derecha giras a la izquierda,
pulsa **X** y cuéntalo para cambiar el valor por defecto.

## Qué hay

| Archivo | Qué es |
|---|---|
| `src/main.c` | bucle a 60 Hz fijos con interpolación (como `app/src/main.js`), estados (título con demo, cuenta atrás, juego, pausa, fin), HUD, capturas de prueba |
| `src/render.c/.h` | la capa de dibujo: cámara (`render/index.js`), túnel (`tunnel.js`), cajas con contorno y volteo de las rodantes (`boxes.js`), placas (`pads.js`), monedas (`coins.js`), cielo y mar de nubes (`sky.js`), mundos (`worlds.js`), destello, y el HUD 2D con una fuente de 5×7 |
| `src/shaders.h` | los sombreadores, casi literales de la web. Cada uno acaba con `finish()`: la saturación del pase de gradación, el tono neutro de Three y la conversión a sRGB |
| `src/track.c/.h` | anillos por fila con transporte paralelo y la sección de 12 celdas plegable (`track.js`) |
| `src/input.c/.h` | la asistencia de carril y la mezcla de fuentes de `input/index.js` |
| `src/nx.c/.h` | mandos y giroscopio con libnx (aparte porque `<switch.h>` también define `Event`) |
| `src/gl.c`, `src/glmini.h` | cargador propio de OpenGL (vale para GL 3.3 core y ES 3.0 sin glad) |
| `src/png.c/.h` | PNG mínimo para las capturas |
| `Makefile` / `Makefile.desktop` | Switch (libnx) / escritorio (SDL2 de Homebrew) |
| `tools/switch-build.sh`, `tools/enviar.sh` | compilar el `.nro` (con Docker si hace falta) y mandarlo con nxlink |
| `sim/rng.h/.c` | mulberry32 (`rng.js`), con `uint32_t` en lugar de `Math.imul` y `>>> 0` |
| `sim/waves.h/.c` | guiones de oleadas (`waves.js`) |
| `sim/game.h/.c` | la simulación (`game.js`): mismo estado, mismas funciones, mismo orden de tiradas |
| `sim/bot.h/.c` | el piloto automático (`bot.js`), para la demo del título y las pruebas |
| `sim/jsmath.h/.c` | `Math.sin/cos/atan/atan2` de V8 (su fdlibm), solo lo usa el bot |
| `tools/trace.c`, `tools/trace.mjs`, `tools/parity.sh` | prueba de paridad C/JS |

Las posiciones se calculan en `double` como en Three y se suben a la GPU relativas a la cámara,
así no se pierde precisión a decenas de kilómetros del origen.

## Qué falta frente a la web

El aspecto es el mismo que la web: los mismos modelos GLB de Blender (losas, arcos, faldones,
cajas con runa, costillas, cristales, enredaderas, islas, nubes, volcanes, monedas), las mismas
texturas y paisajes de 360° (todo dentro del `.nro`, generado por `tools/embed.py`), la luz
estilizada de `stylize.js`, el bloom HDR y la gradación del posproceso, hojas y líneas de
velocidad, y el HUD y los menús con la letra Fredoka y los colores de `ui.css`.

Falta:
- **Modos**: Arcade y Clásico (sin Aventura, Reto diario, Viaje, Supervivencia ni Contrarreloj en el menú).
- **Misiones, tienda, top 5 y ajustes** (solo se guarda el mejor de cada modo en `sdmc:/switch/hipertunel-record.txt`).
- **Sonido**: sintetizador propio (`src/audio.c`), más sencillo que el de la web.

## Paridad de la simulación

Con la misma semilla y las mismas entradas, la simulación en C da la misma partida que la de JS.

Los arrays dinámicos de JS son arrays de capacidad fija con la misma semántica: filas (30, `shift`
al pasar), cajas (32, `shift` al pasar), placas, monedas y huecos (`filter`/`shift` en `prune`).
Los sucesos de cada paso quedan en `g->events[0..g->nEvents)`. Si algo se desborda, aborta con un
mensaje (en las pruebas nunca pasa de unas decenas).

## Prueba de paridad

Desde la raíz del proyecto:

```
sh ports/switch/tools/parity.sh                 # 18000 fotogramas (5 min), 8 semillas
sh ports/switch/tools/parity.sh 3600 1 2 3      # fotogramas y semillas a mano
```

Juega clásico, supervivencia y contrarreloj con cada semilla, en dos variantes: **normal** (hasta
morir, más 2 s de inercia) y **god** (los choques mortales solo marcan la caja; en contrarreloj se
repone el tiempo), para recorrer partidas largas con plegados, cambios de mundo, saltos y todas
las oleadas. Cada línea lleva posición, ángulo, velocidad, impulso, oleada, plegado, mundo, una
huella de todas las cajas/placas/monedas/huecos y otra de los bits exactos de todos los `double`
del estado, más el estado de los dos generadores. Tiene que acabar en `Paridad OK`. Las trazas
quedan en `ports/switch/build/traces/`.

Estado actual: 48 partidas, 102 558 líneas, **0 diferencias**. También pasa limpio con
`-fsanitize=address,undefined`.

**Ojo (29-09-2026):** `app/src/sim/game.js` tiene cambios sin confirmar (orden de `Game::update`,
cambio de signo del plegado, placas, rodantes…) y con esa copia de trabajo la paridad da
diferencias desde el fotograma 50. `sim/` sigue siendo el port del último commit; cuando esos
cambios se asienten hay que pasarlos a `sim/game.c` y volver a lanzar `parity.sh`. El port nativo
no depende de ellos: con el sim anterior es jugable igual.

## Trampas de JS a C (ya resueltas; ojo al tocar el código)

- **FMA**: la simulación hay que compilarla con `-ffp-contract=off`. Si el compilador fusiona
  `a + b*c` en una FMA, el redondeo cambia y la partida diverge. clang de Apple la activa por
  defecto, y el GCC de devkitA64 también en modo `-std=gnu*`. `game.c` y `bot.c` llevan además
  el pragma (GCC lo ignora, así que ahí manda el flag).
- **Orden de evaluación**: JS evalúa los argumentos de izquierda a derecha; C no lo garantiza.
  En `waves.c` cada tirada del rng va en su propia sentencia.
- **`Math.round`** redondea el ,5 hacia +∞ (el `round` de C lo aleja del cero): `js_round`.
- **`Math.sign(0)`** devuelve el propio cero: `js_sign`.
- **`%`**: el de enteros de C99 y `fmod` conservan el signo del dividendo, como JS. Sirven tal cual.
- **`undefined`**: `wave.world` sin definir es `-1`; `turn.yawOn` sin definir empieza a 0.
- **Trigonometría del bot**: la libm del Mac difiere de V8 en el último bit en ~4 % de los casos,
  y eso basta para que el bot gire distinto al cabo de unos segundos. `jsmath.c` es el fdlibm de
  V8 (`src/base/ieee754.cc`) pasado a C sin tocar operaciones. Detalle curioso: el Node de
  Homebrew para Mac ARM está compilado **con** FMA en ese código, así que `jsmath.c` activa la
  contracción por defecto; para comparar con un Node de x86-64 compila con `-DJSMATH_NO_FMA`. La
  simulación en sí no usa ninguna función trascendente (solo `floor`, `trunc`, `fmod`, `fabs`,
  que son exactas en cualquier plataforma), así que es idéntica en la Switch sin depender de esto.

## Siguientes pasos

1. **Probarlo en la consola** y ajustar el signo y la sensibilidad del giroscopio.
2. **Sonido**: `app/src/audio/` es un sintetizador hecho a mano (osciladores y ruido). O se reescribe
   sobre el callback de audio de SDL2 (mismos osciladores, mismo secuenciador) o se exporta la música
   a OGG y se sintetizan solo los efectos y la turbina. La interfaz a conservar es la del
   `CONTRATO.md` (`setSpeed`, `setWorld`, `play`).
3. **Bloom** a media resolución (2-3 pasadas) detrás de un nivel de calidad, y las líneas de velocidad.
4. **Decorado y modelos**: cargar los GLB de `app/public/assets/` con `cgltf` desde romfs.
5. **Menús**: modos, ajustes (sensibilidad del giroscopio, reducir efectos), top 5, vibración.
6. **Fantasmas**: como la simulación es determinista e idéntica en C, una partida se guarda como
   semilla + lista de valores de `steer` por fotograma y se reproduce igual en web, Android y Switch.
