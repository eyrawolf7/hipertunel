# Hipertúnel

Runner de túnel en primera persona con la jugabilidad de Boost 2 (Android, 2015) y una
presentación colorida y actual.

## 👉 Jugar: [eyrawolf7.github.io/hipertunel](https://eyrawolf7.github.io/hipertunel/)

- **Móvil**: ponlo en horizontal e inclínalo para girar (o toca a izquierda o derecha).
- **Android**: [hipertunel.apk](https://eyrawolf7.github.io/hipertunel/hipertunel.apk)
  (hay que permitir instalar apps de origen desconocido).
- **Switch (homebrew)**: [hipertunel.nro](https://eyrawolf7.github.io/hipertunel/hipertunel.nro)
  → cópialo a `/switch/` en la SD y ábrelo desde el Homebrew Menu. Ver `ports/switch/README.md`.
- **Sin conexión**: `hipertunel-movil.html` es el juego entero en un solo archivo.

## Cómo se juega

Gira alrededor del túnel para esquivar las cajas. Cuando un carril se colorea, viene una caja
por él (se enciende al entrar en ese carril). Pisa las placas azules: cada una es un impulso
(hasta 3) y con impulso atraviesas las cajas, pero pierdes todos los impulsos. Sin impulso, un
choque es el final. A veces el túnel se despliega y corres por fuera; al volver a entrar, salta
al vacío y aterriza en un mundo nuevo. Recoge monedas por el camino.

Modos: **Clásico** (lo más lejos posible), **Supervivencia** (sin impulsos, la velocidad no
para de subir) y **Contrarreloj** (60 s; los impulsos suman tiempo y los choques lo restan).

Controles: inclinación, toques, ← → o A D, mando (palanca o cruceta), Esc o P para pausar.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # reglas de Boost 2 en la simulación
npm run bot          # partidas con bot, sin navegador
node tests/qa.mjs    # batería funcional en Chrome sin cabeza
npm run build        # index.html y hipertunel-movil.html (un solo archivo)
npm run android      # hipertunel.apk
npm run paridad      # la simulación en C (Switch) da lo mismo que la web
```

Arquitectura y reglas en `CLAUDE.md` y `docs/CONTRATO.md`.
