# Hipertúnel — contexto para Claude Code

Juego de runner en túnel, en primera persona, inspirado en **Boost 3D** (iPhone, 2009). Es una demo interna de Víctor (SDG) para enseñar lo que se puede hacer con IA. Víctor habla en español de España, en tono informal. Prueba en el móvil, en horizontal, y te pasará capturas y opiniones.

Estado actual: versión 0.32. El juego completo es un único archivo, `index.html` (Three.js r147 cargado por CDN). **`hipertunel-movil.html` ya no se edita a mano: se genera con `npm run build`.**

Publicado en https://eyrawolf7.github.io/hipertunel/ (repo `eyrawolf7/hipertunel`, cuenta personal de Víctor, **no** la del trabajo). Ahí funciona el giroscopio, porque necesita https.

## Reglas de diseño (NO romper; salen del feedback de Víctor)

1. **Primera persona y sensación de velocidad por encima de todo.** Nada de cámara en tercera persona. El piloto en moto existe en el código (`hero`), oculto, reservado para ser el "fantasma" del rival en multijugador.
2. **El color de un carril solo significa "viene un obstáculo".** El túnel y la calzada son neutros. Nada de franjas decorativas, damero entre carriles ni luces de color seguidas en un mismo carril: todo eso confunde.
3. **Los avisos saltan de golpe**, como en el original. El carril se pinta entero y de repente cuando el bloque está a ~1,25 s (`o.lit`, `o.litFrom`), no se ve venir desde lejos.
4. **Azul = impulso, y solo el impulso.** Las placas azules llevan chevrones blancos animados, van planas, sin relieve, pegadas a la carretera, y se ven bien al pisarlas.
5. **Mecánica de impulso:** hasta 3 niveles. Cada placa sube uno y da un gran acelerón. Si chocas con impulso, pierdes un nivel y atraviesas el bloque; si chocas a cero, mueres. Se empieza lento.
6. **Obstáculos como el original:** un flujo continuo de bloques de un carril (a veces 2-3 contiguos) repartidos por todo el contorno (suelo, paredes, techo), cada vez más densos. **Nada de aros con un hueco en fila.** Siempre existe una "ruta segura" invisible (`pathL`) que serpentea.
7. **La dificultad crece de forma progresiva y constante** con la distancia (`diffAt`), no solo con la velocidad. No debe haber mesetas, desiertos largos sin nada ni amontonamientos raros. Las placas aparecen cada ~100-150 m como mucho.
8. **Las mismas reglas en todo el trazado.** Que el túnel haga curvas o montaña rusa no cambia cuántos obstáculos salen.
9. **Cada partida es distinta:** la forma de la pista, las montañas rusas y el orden de los mundos se generan al azar (`rollTrack`, `rollBiomes`).
10. **Por mundo, una fase larga fuera y una fase larga dentro.** Nada de abrir y cerrar cada pocos segundos. La apertura desenrolla el túnel como una lámina; el cierre es una boca que te engulle en ~1,2 s con un destello.
11. **Nada que aparezca de golpe ni dentro del camino.** La decoración se coloca más allá de la niebla y siempre lejos de la pista. Nada inmóvil en el centro de la vista que no se pueda esquivar.
12. **Legibilidad por encima de los efectos.** Quita cualquier efecto que tape la vista: probamos partículas flotantes y un túnel arcoíris en hipervelocidad, y molestaban.
13. **Sonido:** melodía de fondo agradable y una turbina suave que sube con la velocidad. Nada de zumbidos de mosca ni ruido de secador.

## Estructura de `index.html` (buscar por estos nombres)

- **Pista:** `cx(z)`, `cy(z)` (curvas y colinas), `TW(z)` (tirabuzón), `kappa(z)` (curvatura de la lámina: >0 dentro, <0 fuera), `prof(u,k)`, `buildTube()` (malla dinámica de 16 carriles × 72 anillos), `placeAt()` (coloca objetos orientados según la superficie real).
- **Tramos:** `buildSections()`, `sideM(z)`, `updateClosings()`, `coasterAt(z)`, `diveY(z)`.
- **Mundos:** `THEMES` (9 biomas, cada uno con su `key`), `PERM`, `blendWorld(z)`, `biomeAt(z)`, `themeOf(i)`.
- **Generador de obstáculos:** `spawnNext(z)` (flujo con ruta segura), `diffAt(z)`, `addBlock`, `addBoost`, `addRoller`, `addSnowball`, `addJelly`, `addCurrent`, `addStars`.
- **Mecánicas por mundo:** nieve (deslizamiento y bolas que crecen), arrecife (corrientes = carriles rápidos opcionales), caramelo (gominolas que te hacen saltar un muro).
- **Extras:** estrellas y combo, hipervelocidad (`hypMeter`), roce "¡Por los pelos!", puerta de récord, top 5 local (`localStorage 'hipertunel-top'`) y 15 logros (`ACH`).
- **Controles:** toques y teclas (un toque = un carril; mantener = deslizar), inclinación (`onMotion`/`onOrient`, `tilt`) y mando (protegido con `try`, porque algunos visores lo bloquean).
- **Hook de pruebas:** `window.__game` (`warp(z)`, `setStep(fn)`, `motion(x,y)`, `kill()`, `padErr()`, `chordGap()`, `diffAt`, `perm()`…).

## Flujo de trabajo obligatorio

Víctor insiste en que **pruebes tú el juego antes de entregar cualquier versión**:

```
npm install
npm run check        # comprobaciones de calidad (deben salir "Todo OK")
npm run sim          # 2,5 min de juego con bot, sin errores
npm run serve        # en otra terminal
npm run shots -- 150,1500,3000,6000   # capturas reales en tests/shots/
npm run compare -- despues 150,1500,3000,6000   # capturas + fps, para comparar cambios visuales
npm run build        # regenera hipertunel-movil.html desde index.html
```

Para calibrar la imagen sin tocar el código hay parámetros en la URL:
`?expo=0.72&amb=0.30&dif=0.74&bloom=0.42&bthr=1.05&fnear=25&ffar=170&fps`.
`?fps` muestra fps y el 1% peor en pantalla; `window.__game.fps()` lo devuelve para los tests.
Las capturas de partida (v0.31) están en `tests/base-v031/`.

Mira las capturas y compáralas con `referencias/video-original/` (fotogramas del original, 1 por segundo) y `referencias/estilo-visual/` (el estilo al que aspira). Sé autocrítico: juega, graba, compara y corrige en bucle. Cuando cambies algo que ya ha dado guerra (placas, avisos, densidad, giroscopio), añade una comprobación en `tests/checks.js`.

## Siguientes pasos acordados (por prioridad)

1. **Publicarlo en una web https** (GitHub Pages o Netlify) para que funcione el giroscopio en el móvil. En el visor de Claude y en archivos locales del móvil, el navegador bloquea el sensor. La pantalla de inicio ya muestra un diagnóstico del sensor.
2. **Salto visual "efecto wow"**: pasar a un proyecto con Vite y Three.js actual (módulos, `OutputPass`, sombras, sombreadores propios para el túnel, mejores materiales), manteniendo la legibilidad y los 60 fps en móviles normales. Conservar siempre una compilación de un solo archivo para compartir.
3. **Assets de mejor calidad** (Blender por script si está instalado): obstáculos, islas, decoración de cada mundo.
4. **Multijugador**: primero carreras contra fantasmas (grabar la partida de otro jugador y reproducirla con el piloto `hero`), después carrera diaria con clasificación compartida.
5. Pulido: opción de reducir efectos (mareo), formas además de colores en los avisos (daltonismo) y ajuste de la sensibilidad del giroscopio.
