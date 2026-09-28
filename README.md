# Hipertúnel

Runner de túnel en primera persona inspirado en Boost 3D (iPhone, 2009).

## 👉 Jugar: [eyrawolf7.github.io/hipertunel](https://eyrawolf7.github.io/hipertunel/)

En el móvil, ponlo **en horizontal**. Al pulsar *Jugar* te pedirá permiso para el
giroscopio: acéptalo y podrás pilotar inclinando el móvil. La pantalla de inicio
muestra un diagnóstico del sensor para saber si está funcionando.

También puedes abrir `index.html` en el ordenador (necesita conexión) o
`hipertunel-movil.html`, que lleva las librerías dentro y funciona sin conexión
—pero al abrirlo como archivo local el navegador bloquea el giroscopio.

## Cómo se juega
Cambia de carril, esquiva los cubos y pisa las placas azules para acelerar.
Tienes hasta 3 niveles de impulso: cada placa sube uno, y si chocas pierdes uno
y atraviesas el bloque. Si chocas sin impulso, se acabó.

- **Teclado**: ← → o A D para cambiar de carril (mantener para encadenar), espacio para empezar.
- **Móvil**: toca la mitad izquierda o derecha, o inclina el móvil.
- **Mando**: stick o cruceta.

## Desarrollo
```bash
npm install
npm run check    # comprobaciones de calidad (deben salir "Todo OK")
npm run sim      # 2,5 min de juego con un bot, sin errores
npm run serve    # servidor local en el puerto 5173
npm run shots -- 150,1500,3000,6000   # capturas en tests/shots/
```

Todo el contexto (reglas de diseño, estructura del código y siguientes pasos)
está en `CLAUDE.md`.

## Carpetas
- `index.html`: el juego entero, en un único archivo (Three.js r147 por CDN).
- `hipertunel-movil.html`: el mismo juego con las librerías incrustadas.
- `tests/`: simulación con bot, comprobaciones de calidad y capturas automáticas.
- `referencias/`: material de referencia (no se publica).
