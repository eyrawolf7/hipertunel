# Modelos de Hipertúnel (Blender por script)

Todos los GLB de `app/src/assets/` salen de estos scripts; no se editan a mano.

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


Mundo selva y ruinas (`jungle.py`, registrado en `build_props.py`):

| Archivo | Qué es | Origen / ejes (glTF) | Notas |
|---|---|---|---|
| `rib_stone.glb` | sillar de una cara del túnel, 2,1 × 0,35 × 0,6 m | centro de la cara interior | X tangente, +Y normal hacia fuera (0..0,35), Z a lo largo de la vía (±0,3). Extremos a inglete de 15°: 12 cierran un anillo (apotema 3,92 m). ≤400 tris |
| `crystal_cluster.glb` | racimo de cristales turquesa, 0,5 m | base en y=0 | emisivo #3ff5e0 ×2 |
| `vine_hang.glb` | lianas colgantes, 0,8 × 1,6 m | anclaje arriba | cuelgan hacia −Y |
| `vine_edge.glb` | enredadera reptante, 4 m | centro, sobre la superficie | a lo largo de Z; hojas hacia ±X; altura 0..0,11 en +Y |
| `jungle_tree.glb` | árbol de la selva, 12,4 m | pie del tronco | |
| `island_castle.glb` | isla flotante con castillo y cascada, ~40 m | centro, a nivel del césped | puerta y cascada hacia +Z |
| `volcano.glb` | volcán con lava y humo, ~120 m | centro de la base | |
| `ruin_arch.glb` | arco en ruinas con enredaderas, 19 m | suelo, entre los pilares | se atraviesa por Z |

Presupuesto: moneda < 800 triángulos, cada prop < 4000, total < 1,2 MB.
Comprobar con `npx --yes @gltf-transform/cli inspect app/src/assets/<archivo>.glb`
(y `validate`).
