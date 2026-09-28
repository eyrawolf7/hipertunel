# Llevar Hipertúnel a Android y a Switch

## Android (Capacitor): la vía corta

El juego ya es una web de un solo archivo, así que basta con envolverlo:

```
brew install --cask android-commandlinetools   # o Android Studio
npm i -D @capacitor/cli @capacitor/core @capacitor/android
npx cap init Hipertunel es.eyrawolf.hipertunel --web-dir dist
npm run build && npx cap add android && npx cap sync
npx cap open android      # o: cd android && ./gradlew assembleDebug
```

- Orientación: `android:screenOrientation="sensorLandscape"` en `AndroidManifest.xml`.
- El giroscopio funciona sin permisos (dentro de la app no hace falta https).
- Pantalla siempre encendida: plugin `@capacitor-community/keep-awake`.

## Switch (homebrew): la vía larga

El navegador oculto de la Switch no sirve para WebGL, así que hay que ir a nativo:

1. **Simulación**: `app/src/sim/` es JavaScript sin dependencias, a pasos fijos de 60 Hz y con
   semilla. Se traduce casi línea a línea a C (unas 700 líneas). Las pruebas de
   `tests/sim-checks.mjs` sirven para comprobar que el port da lo mismo con la misma semilla.
2. **Render**: devkitPro + libnx con SDL2 y OpenGL ES (paquetes `switch-sdl2`, `switch-mesa`).
   El túnel son 360 baldosas y un sombreador: el de `app/src/render/tunnel.js` pasa a GLSL ES
   casi tal cual. Cajas, placas y monedas son mallas instanciadas; los modelos están en GLB
   (cgltf los carga en C).
3. **Controles**: el giroscopio de los Joy-Con da la misma magnitud que el móvil (seno de la
   inclinación): encaja directo en `steer(a)`. Cruceta y palanca como en `app/src/input/`.
4. **Sonido**: el sintetizador de `app/src/audio/` está hecho a mano sobre osciladores y
   ruido; se reescribe sobre SDL_audio o se exporta la música a OGG.
5. Instalación: `nxlink` por USB o copiar el `.nro` a la SD (`/switch/`).
