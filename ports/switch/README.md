# Hipertúnel para Nintendo Switch (homebrew): port a C

Primer paso del port: la simulación pura (`app/src/sim/`) traducida a C99 portable, **idéntica al
bit** a la versión JS. Con la misma semilla y las mismas entradas da la misma partida, fotograma a
fotograma, con los mismos bits en cada `double`.

## Qué hay

| Archivo | Qué es |
|---|---|
| `sim/rng.h/.c` | mulberry32 (`rng.js`), con `uint32_t` en lugar de `Math.imul` y `>>> 0` |
| `sim/waves.h/.c` | guiones de oleadas (`waves.js`) |
| `sim/game.h/.c` | la simulación (`game.js`): mismo estado, mismas funciones, mismo orden de tiradas |
| `sim/bot.h/.c` | el piloto automático (`bot.js`), para la demo del título y las pruebas |
| `sim/jsmath.h/.c` | `Math.sin/cos/atan/atan2` de V8 (su fdlibm), solo lo usa el bot |
| `tools/trace.c` | traza de una partida en C conducida por el bot en C |
| `tools/trace.mjs` | la misma traza desde el JS original |
| `tools/parity.sh` | compila, genera las dos trazas y las compara |

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

### 1. Proyecto de Switch (devkitPro + libnx)

`dkp-pacman -S switch-dev switch-sdl2 switch-mesa switch-glm`. Un `Makefile` basado en la plantilla
`switchbrew/switch-examples/graphics/opengl`, con `-ffp-contract=off` en `CFLAGS`. Bucle a 60 Hz
fijos con acumulador (la simulación ya va a pasos de 1/60 s). `nxlink` para probar por USB.

### 2. Render (SDL2 + OpenGL ES 3)

| JS (`app/src/render/`) | En C |
|---|---|
| `track.js` (anillos por fila: centro, adelante, arriba, derecha; apertura de la lámina) | se porta tal cual a C: es aritmética pura |
| `tunnel.js` (360 baldosas reconstruidas cada fotograma + sombreador de paneles) | un VBO dinámico y el sombreador pasado a GLSL ES 3.00 casi literal |
| `boxes.js`, `pads.js`, `coins.js` | mallas instanciadas (`glDrawElementsInstanced`) |
| `assets.js` (modelos GLB) | `cgltf` para cargar los mismos GLB desde romfs |
| `sky.js` (esfera con degradado, sol, estrellas) | una esfera o un triángulo a pantalla completa con sombreador |
| `decor.js` (islas, nubes, cristales) | mallas GLB instanciadas, siempre más allá de la niebla |
| `streaks.js`, `fx.js` (líneas de velocidad, cascotes) | partículas instanciadas; detrás del nivel de calidad |
| `worlds.js` (temas por mundo) | tabla de constantes (colores, niebla) |
| `index.js` (cámara en primera persona, bloom, gradación, `OutputPass`) | cámara igual; bloom a media resolución con 2-3 pasadas de desenfoque, gradación y tono en una pasada final |

Objetivo: 60 fps en portátil (1280×720) y en base (1920×1080), bajando la resolución del bloom si
hace falta. Mantener la legibilidad por encima de los efectos (reglas del `CONTRATO.md`).

### 3. Controles

- **Giroscopio de los Joy-Con**: `hidGetSixAxisSensorStates` (libnx) o `SDL_GameControllerSetSensorEnabled`
  con `SDL_SENSOR_ACCEL`. De la gravedad sale el seno de la inclinación, que es justo la magnitud
  "a" que espera `game_step` (como `app/src/input/index.js`: `a ≈ 0,981·sen(inclinación)` con el
  cero calibrado restado). Calibrar al empezar la partida.
- **Palanca y cruceta**: el "a" virtual de `input/index.js` (un toque = un carril, mantener =
  deslizar); ese código usa `atan2(sin, cos)` y puede llamar a `js_atan2` de `jsmath.c`.
- **Botones**: A para aceptar, B para volver, + para pausa.

### 4. Sonido

`app/src/audio/` es un sintetizador hecho a mano (osciladores y ruido). Dos opciones:
reescribirlo sobre `SDL_AudioStream`/callback de SDL2 (mismos osciladores, mismo secuenciador), o
exportar la música a OGG y dejar sintetizados solo los efectos y la turbina que sube con la
velocidad. La interfaz a conservar es la del `CONTRATO.md` (`setSpeed`, `setWorld`, `play`).

### 5. Fantasmas y repeticiones

Como la simulación es determinista y ahora idéntica en C, una partida se guarda como semilla +
lista de valores de `steer` por fotograma, y se reproduce igual en web, Android y Switch.
