# Modelos de Hipertúnel (Blender por script)

Todos los GLB de `app/public/assets/` salen de estos scripts; no se editan a mano.

```
blender --background --python tools/blender/build_props.py                 # todos + vistas previas
blender --background --python tools/blender/build_props.py -- coin arch    # solo algunos
blender --background --python tools/blender/build_props.py -- --no-preview # sin renders
```

- `lib.py`: utilidades (colores hex -> lineal, materiales Principled, primitivas, pintado de
  colores de vértice `Col`, exportación GLB y render de vista previa EEVEE 512x512).
- `build_props.py`: un `build_<nombre>()` por modelo. Semillas fijas: salida reproducible.
- Vistas previas en `/private/tmp/blender-previews/<nombre>.png`.

Exportación: GLB, Y arriba, transformaciones aplicadas, sin UV, sin texturas, sin Draco.
Los colores van en `COLOR_0` (GLTFLoader activa `vertexColors` solo). Escala real en metros.

| Archivo | Qué es | Origen | Notas |
|---|---|---|---|
| `coin.glb` | moneda estilo Mario, Ø0,9 m | centro | caras hacia ±Z; girar en Y |
| `island_a/b/c.glb` | islas flotantes 20-40 m | centro, a nivel del césped | `a` con cascada, `b` alargada con meseta, `c` pequeña y afilada |
| `cloud.glb` | nube de esferas, 15,6 m | centro de la caja | base plana |
| `crystal.glb` | grupo de cristales emisivos, ~6 m | base en y=0 aprox. | magenta/cian |
| `planet.glb` | planeta con anillo, ~59 m | centro | anillo de doble cara, inclinado |
| `arch.glb` | aro decorativo con bombillas, 24,6 m | centro | se atraviesa por Z; sin azul (reservado al impulso) |

Presupuesto: moneda < 800 triángulos, cada prop < 4000, total < 1,2 MB.
Comprobar con `npx --yes @gltf-transform/cli inspect app/public/assets/<archivo>.glb`
(y `validate`).
