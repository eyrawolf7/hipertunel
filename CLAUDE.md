# Hipertúnel — contexto para Claude Code

Juego de runner en túnel, en primera persona, con **la jugabilidad exacta de Boost 2** (Android,
2015) y una presentación actual con toque Nintendo Switch. Es un proyecto personal de Víctor
(SDG). Víctor habla en español de España, en tono informal. Prueba en el móvil, en horizontal, y
te pasará capturas y opiniones. Si queda muy pulido, quiere sacarlo para **Android** y como
homebrew para su **Switch**: la arquitectura tiene que seguir siendo portable.

Estado actual: versión 0.40 (reescritura completa). La v0.32 está en `legacy/`.

Publicado en https://eyrawolf7.github.io/hipertunel/ (repo `eyrawolf7/hipertunel`, cuenta
personal de Víctor, **no** la del trabajo). GitHub Pages sirve el `index.html` de la raíz, que es
**la compilación de un solo archivo**: no se edita a mano, se genera con `npm run build`.

## Arquitectura (ver `docs/CONTRATO.md`, es el contrato entre agentes)

- `app/src/sim/`: **simulación pura** de Boost 2 (`game.js`, `waves.js`, `rng.js`, `bot.js`). Sin
  DOM ni Three.js, pasos fijos de 60 Hz, aleatoriedad con semilla. Es lo que se portaría a C.
- `app/src/render/`: Three.js r186. `track.js` (anillos y sección plegable), `tunnel.js`
  (sombreador de paneles y avisos), `boxes.js`, `pads.js`, `coins.js`, `sky.js`, `decor.js`,
  `fx.js`, `worlds.js` (temas y colores), `index.js` (cámara y posproceso).
- `app/src/ui/` (menús y HUD, DOM+CSS), `app/src/audio/` (WebAudio sintetizado),
  `app/src/input/` (inclinación, táctil, teclado, mando), `app/src/main.js` (bucle y estados).
- `app/src/assets/*.glb`: modelos generados con Blender por script (`tools/blender/`).
- La especificación de Boost 2 sacada del APK está en `referencias/analisis-boost2.md` (no se
  publica). Si hay dudas sobre una regla, esa es la fuente.

## Reglas de diseño (NO romper)

1. **La jugabilidad es la de Boost 2, al detalle.** 12 carriles, velocidad 2 → 3,65 → 4,76 → 5,5
   (u/fotograma) con salto instantáneo al impulsar, choque con impulso = pierdes TODOS y
   atraviesas, choque sin impulso = fin, el guion de oleadas del clásico, placas en parejas o de
   cuatro, curvas y plegados. Cualquier cambio de mecánica se discute antes con Víctor. Lo único
   añadido son las monedas (van con su propio generador para no alterar el original).
2. Primera persona y sensación de velocidad por encima de todo.
3. **El color de un carril solo significa "viene una caja".** Apagado (pastel) si no estás en ese
   carril, encendido (vivo) si estás. El túnel es neutro. Nada de franjas decorativas de color.
4. **Azul = impulso, y solo el impulso.** Por eso las cajas no usan azul.
5. Nada que aparezca de golpe dentro del camino. El decorado va lejos de la pista.
6. **Legibilidad por encima de los efectos.** Nada tapa el centro de la vista.
7. Sonido: melodía agradable y turbina suave. Nada de zumbidos ni ruido de secador.
8. 60 fps en un móvil normal; lo caro va detrás del nivel de calidad (`alta`/`media`/`baja`).

## Flujo de trabajo obligatorio

Víctor insiste en que **pruebes tú el juego antes de entregar cualquier versión**:

```
npm install
npm run dev                  # servidor de desarrollo en http://localhost:5173
npm run bot -- classic 20    # 20 partidas con bot sobre la simulación pura (sin navegador)
node tests/shots.mjs <carpeta> 20 150 400 800 [--seed=3 --mode=classic --title]
node tests/film.mjs <nombre> --event=crash|foldStart|world|boost|tall|roller|row:N
node tests/qa.mjs            # comprobaciones funcionales con Chrome sin cabeza
npm run build                # genera index.html y hipertunel-movil.html (un solo archivo)
```

`?fps` muestra fps en pantalla, `?q=baja` fuerza la calidad. El gancho de pruebas es
`window.__hip` (`start(modo, semilla)`, `skipTo(filas)`, `step(n)`, `game`, `renderer`…) y
`window.__freeze = true` para avanzar la simulación a mano.

Mira las capturas y compáralas con `referencias/video-original/` y `referencias/estilo-visual/`.
Sé autocrítico. Para trabajos grandes, reparte en agentes según `docs/CONTRATO.md` (cada uno
dueño de su carpeta). El equipo está en `.claude/agents/`: `director-arte` (crítico visual con
contexto limpio), `qa-jugador`, `auditor-fidelidad` (contra el descompilado de Boost 2 en
`referencias/boost2-decompilado/`), `sonido`, `interfaz` y `modelador-blender`. Tras cambios
visuales, pasa el director de arte; tras cambios de reglas, el auditor; antes de publicar, el QA.

## Siguientes pasos

1. Que Víctor lo pruebe en el móvil (inclinación: comprobar el sentido y la calibración).
2. Android con Capacitor; mando y giroscopio de los Joy-Con para Switch.
3. Multijugador: fantasmas (la simulación es determinista: basta guardar semilla + entradas).
