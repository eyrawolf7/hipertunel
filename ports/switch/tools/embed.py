#!/usr/bin/env python3
"""Mete las texturas de la web dentro del ejecutable: genera src/assets_data.c con cada archivo
como un array de bytes (así el .nro no necesita romfs ni archivos sueltos en la SD).
Uso: python3 ports/switch/tools/embed.py   (volver a lanzarlo si cambian las texturas de la web)"""
import os
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
FILES = [
    ('stone_albedo', 'app/src/assets/kit/stone_albedo.jpg'),
    ('stone_normal', 'app/src/assets/kit/stone_normal.png'),
    ('stone_orm', 'app/src/assets/kit/stone_orm.jpg'),
    ('crystal_albedo', 'app/src/assets/kit/crystal_albedo.jpg'),
    ('crystal_normal', 'app/src/assets/kit/crystal_normal.png'),
    ('sky_islas', 'app/src/assets/sky/islas.jpg'),
    ('sky_selva', 'app/src/assets/sky/selva.jpg'),
    ('sky_noche', 'app/src/assets/sky/noche.jpg'),
    ('sky_templo', 'app/src/assets/sky/templo.jpg'),
    ('sky_volcan', 'app/src/assets/sky/volcan.jpg'),
]
out = ['/* Generado por tools/embed.py: no editar a mano. */', '#include "assets.h"', '']
for name, rel in FILES:
    data = open(os.path.join(ROOT, rel), 'rb').read()
    out.append(f'static const unsigned char A_{name}[{len(data)}] = {{')
    for i in range(0, len(data), 40):
        out.append(','.join(str(b) for b in data[i:i + 40]) + ',')
    out.append('};')
out.append('const Asset ASSETS[] = {')
for name, rel in FILES:
    out.append(f'  {{ "{name}", A_{name}, sizeof A_{name} }},')
out.append('  { 0, 0, 0 }\n};')
open(os.path.join(HERE, '..', 'src', 'assets_data.c'), 'w').write('\n'.join(out) + '\n')
print('assets_data.c:', sum(os.path.getsize(os.path.join(ROOT, r)) for _, r in FILES) // 1024, 'KB')
