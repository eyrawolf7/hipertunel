# Contrato de Hipertúnel v0.40 (léelo antes de tocar código)

Este documento es el único mecanismo de coordinación entre los agentes que trabajan en el
juego. Si algo no está aquí, pregunta al director (el agente principal) en tu informe final.

## Qué es el juego

Runner en primera persona dentro de un túnel de 12 carriles, **con la jugabilidad exacta de
Boost 2** (Android, 2015): inclinas el móvil para girar alrededor del túnel, esquivas cajas de
colores, pisas placas de impulso (hasta 3 niveles) y con impulso atraviesas cajas. El túnel se
curva, y a veces se despliega como una lámina y te deja corriendo por fuera.
El objetivo visual es un juego actual con **toque Nintendo Switch**: colorido, limpio,
desenfadado, con mucho mimo en el detalle, pero **siempre legible a 100 m/s**.

Plataformas: web (GitHub Pages), después Android (Capacitor) y Switch homebrew (port a C).
Por eso la simulación es pura y el render es una capa aparte.

## Mapa de propiedad (cada agente edita SOLO lo suyo)

| Carpeta / archivo            | Dueño              | Qué contiene |
|------------------------------|--------------------|--------------|
| `app/src/sim/`               | director           | Simulación pura de Boost 2. Sin DOM ni Three. No tocar. |
| `app/src/render/`            | director / render  | Three.js: túnel, cajas, placas, cámara, mundos, posproceso. |
| `app/src/audio/`             | sonido             | Música y efectos sintetizados con WebAudio. |
| `app/src/ui/`                | interfaz           | Menús, HUD, pantallas (DOM + CSS). |
| `app/src/input/`             | director           | Inclinación, táctil, teclado, mando. |
| `app/src/main.js`            | director           | Une todo: bucle, estados, guardado. |
| `app/public/assets/`, `tools/blender/` | modelado | Modelos GLB generados con Blender por script. |
| `tests/`                     | QA                 | Pruebas y capturas. |

## Reglas de diseño (no negociables; vienen del feedback de Víctor)

1. Primera persona y sensación de velocidad por encima de todo.
2. **El color de un carril solo significa "viene una caja".** El túnel es neutro (blanco o
   del tono del mundo, muy poco saturado). Nada de franjas decorativas de colores en los carriles.
3. Azul eléctrico con flechas = placa de impulso, y solo eso.
4. Legibilidad por encima de los efectos: nada que tape la vista (partículas delante de la
   cámara, destellos largos, niebla que esconda cajas cercanas).
5. Nada aparece de golpe dentro del camino ni se mueve delante de la cámara sin ser esquivable.
6. Sonido agradable: melodía con ritmo y una turbina suave que sube con la velocidad. Nada de
   zumbidos ni ruido de secador.
7. 60 fps en un móvil normal. Todo efecto caro va detrás del nivel de calidad.
8. Textos en español de España, tono cercano ("¡Impulso!", "Otra vez").

## Interfaces entre módulos

### Audio (`app/src/audio/index.js`)
```js
export function createAudio(): Audio
Audio.unlock()                 // llamar en el primer gesto del usuario (iOS/Android)
Audio.setMuted(bool) ; Audio.muted
Audio.setMusic(bool)           // encender/apagar la música
Audio.setWorld(i)              // 0..6: cambia de tema musical/tonalidad (pares = mundos, impares = transición)
Audio.setSpeed(ms, level)      // metros/segundo (18..100) e impulsos (0..3), cada fotograma
Audio.play(name, opts?)        // efectos: 'boost'(opts.level 1..3), 'crash', 'death', 'foldStart',
                               // 'foldEnd', 'world', 'coin'(opts.combo), 'menuMove', 'menuOk',
                               // 'menuBack', 'countdown', 'go', 'record', 'nearMiss'
Audio.pause(bool)
```

### Interfaz (`app/src/ui/index.js`)
```js
export function createUI(root: HTMLElement, handlers): UI
// handlers: { onPlay(mode), onResume(), onRestart(), onMenu(), onSetting(key, value), onCalibrate() }
UI.show(screen)                // 'title' | 'modes' | 'settings' | 'hud' | 'pause' | 'over' | 'none'
UI.hud(state)                  // cada fotograma: { distM, speedMS, level, coins, timeLeft|null, mode, invul, best }
UI.toast(text, kind?)          // aviso corto arriba ('boost', 'record', 'info')
UI.over(result)                // { mode, distM, coins, score, best, isRecord, time, maxBoostTime, top: [...] }
UI.settings(values)            // pinta los valores actuales
```
Ajustes: `tilt` (bool), `invert` (bool), `sens` (0.5..2), `quality` ('alta'|'media'|'baja'),
`reduceFx` (bool), `music` (bool), `sound` (bool).

### Estado de la simulación (lo que ve el render)
`Game` en `app/src/sim/game.js`: `s` (posición en filas), `theta` (rad), `fold` (30 dentro,
−30 fuera), `rows[]` (`k`, `yaw`, `pitch` en grados), `boxes[]` (`k`, `lane`, `fixed`, `tall`,
`h`, `roll`, `color` 0..9, `joined`, `group`, `hit`), `pads[]`, `level`, `v`, `world`,
`events[]` del último paso (`boost`, `crash`, `death`, `foldStart`, `foldEnd`, `world`,
`wave`, `spawn`).

## Estilo visual (dirección de arte)

- Paleta viva y limpia, tipo Nintendo: blancos cálidos, sombras de color (nunca grises
  sucios), colores de caja muy saturados y brillantes con barniz.
- Formas redondeadas (biseles), contornos suaves, sombreado toon/suave con luz de borde.
- Tipografía redonda y gruesa (Fredoka / Baloo), botones gorditos con sombra desplazada,
  animaciones con rebote (cubic-bezier con overshoot), todo con transiciones cortas.
- Cada mundo tiene su identidad (cielo, color de túnel, niebla, música), pero la regla 2 manda.
