"""Genera los props de Hipertúnel (GLB) y sus vistas previas.

Uso:
  blender --background --python tools/blender/build_props.py            # todos
  blender --background --python tools/blender/build_props.py -- coin arch   # solo algunos
  ... -- --no-preview                                                     # sin renders
"""
import bpy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import hexc, mix, smoothstep  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

TAU = 2 * math.pi


# =================================================================== moneda
def build_coin():
    gold = lib.material('CoinGold', hexc('#ffc21a'), rough=0.25, metal=0.9)
    # Perfil de la moneda (radio, z) de la cara delantera a la trasera: campo hundido,
    # canto elevado con bisel redondeado y lateral.
    top = [(0.0, 0.034), (0.29, 0.034), (0.318, 0.068), (0.372, 0.075), (0.428, 0.064),
           (0.450, 0.034)]
    prof = top + [(r, -z) for r, z in reversed(top)]
    v, f = lib.lathe(prof, 28)
    disc = lib.mesh_obj('coin_disc', v, f, gold, sharp_angle=40)

    # Ranura vertical en relieve (el clásico óvalo alargado de la moneda de Mario).
    def stadium(w, h, n=6):
        pts = []
        for i in range(n + 1):
            a = math.pi * i / n
            pts.append((w * math.cos(a), (h - w) + w * math.sin(a)))
        for i in range(n + 1):
            a = math.pi + math.pi * i / n
            pts.append((w * math.cos(a), -(h - w) + w * math.sin(a)))
        return pts

    parts = [disc]
    for side in (1, -1):
        rings = [(1.0, 0.030), (0.95, 0.060), (0.78, 0.071)]
        base = stadium(0.068, 0.225)
        n = len(base)
        verts, faces = [], []
        for s, z in rings:
            for x, y in base:
                verts.append((x * s, y * (1 - (1 - s) * 0.35), z * side))
        for r in range(len(rings) - 1):
            for j in range(n):
                a, b = r * n + j, r * n + (j + 1) % n
                c, d = b + n, a + n
                faces.append((a, b, c, d) if side > 0 else (d, c, b, a))
        cap = list(range((len(rings) - 1) * n, len(rings) * n))
        faces.append(tuple(cap) if side > 0 else tuple(reversed(cap)))
        parts.append(lib.mesh_obj('coin_slot', verts, faces, gold, sharp_angle=50))

    ob = lib.join(parts, 'Coin')
    # Caras hacia ±Z en glTF = ±Y en Blender (glTF Z = -Blender Y).
    ob.rotation_euler = (math.radians(90), 0, 0)
    lib.select_only(ob)
    bpy.ops.object.transform_apply(rotation=True)
    return ob, dict(view=(1.0, -1.6, 0.45), sky='#fff4dc')


# =================================================================== islas
GRASS = hexc('#7ed957')
GRASS_LIGHT = hexc('#c2f27e')
GRASS_DARK = hexc('#5cc24a')
ROCKS = [hexc(h) for h in ('#e8c79a', '#d9a878', '#e0b184', '#c98a63', '#d49a6a', '#bf7a55')]
ROCK_DEEP = hexc('#a8634a')
STRATA = [hexc(h) for h in ('#f0d2a0', '#e3ad7a', '#d48f62', '#e0a577', '#c07352', '#a85f48')]


def island(seed, R, stretch=1.0, lobes=(), depth=1.0, trees=4, waterfall=False, extra_rocks=3,
           second_tier=False):
    rnd = random.Random(seed)
    ph = [rnd.uniform(0, TAU) for _ in range(4)]
    amp = [0.07, 0.05, 0.035]

    def rk(a):
        k = 1 + amp[0] * math.sin(2 * a + ph[0]) + amp[1] * math.sin(3 * a + ph[1]) + amp[2] * math.sin(5 * a + ph[2])
        for la, ls in lobes:  # bultos extra de silueta
            d = math.atan2(math.sin(a - la), math.cos(a - la))
            k += ls * math.exp(-(d / 0.55) ** 2)
        return k

    grass_m = lib.material('IslandGrass', GRASS, rough=0.55, vcol=True)
    rock_m = lib.material('IslandRock', ROCKS[0], rough=0.85, vcol=True)
    parts = []

    # --- Césped: losa con cúpula suave, borde redondeado y "goterones" sobre la roca.
    seg = 44
    drips = rnd.choice([7, 8, 9])
    gp = [(0.0, 0.55), (0.35, 0.50), (0.65, 0.38), (0.86, 0.20), (0.965, -0.05), (1.0, -0.45),
          (0.985, -0.85), (0.95, -1.05)]
    gp = [(r * R, z * (R / 12)) for r, z in gp]
    v, f = lib.lathe(gp, seg, rk)
    # Estirar en X y ondular el faldón de hierba.
    for i, p in enumerate(v):
        p.x *= stretch
    ring_last = v[-seg:]
    ring_prev = v[-2 * seg:-seg]
    for j in range(seg):
        a = TAU * j / seg
        w = 0.5 + 0.5 * math.sin(drips * a + ph[3])
        ring_last[j].z -= w * 0.9 * (R / 12)
        ring_prev[j].z -= w * 0.35 * (R / 12)
    g = lib.mesh_obj('grass', v, f, grass_m, smooth=True)
    Rmax = R * max(stretch, 1)

    def grass_col(p, n, _):
        rho = math.hypot(p.x / stretch, p.y) / R
        c = mix(GRASS, GRASS_DARK, 0.5 + 0.5 * math.sin(p.x * 0.35 + ph[0]) * math.sin(p.y * 0.3 + ph[1]))
        c = mix(GRASS, c, 0.5)
        return mix(c, GRASS_LIGHT, smoothstep(0.80, 0.97, rho) if n.z > -0.2 else 0.85)
    lib.paint(g, grass_col, per='vertex')
    parts.append(g)

    def top_z(x, y):
        rho = math.hypot(x / stretch, y) / (R * rk(math.atan2(y, x / stretch)))
        pts = gp
        for (r0, z0), (r1, z1) in zip(pts, pts[1:]):
            if r0 / R <= rho <= r1 / R:
                t = (rho - r0 / R) / max(1e-6, (r1 - r0) / R)
                return z0 + (z1 - z0) * t
        return pts[0][1]

    # --- Roca: cono(s) facetados que terminan en punta.
    def rock_cone(cx, cy, rr, dd, sd):
        rr2 = random.Random(sd)
        n = rr2.choice([9, 10, 11])
        rings = [(0.97, -0.7), (0.93, -0.2), (0.74, -0.45), (0.46, -0.7), (0.2, -0.9), (0.0, -1.0)]
        verts, faces, idx = [], [], []
        for k, (fr, fz) in enumerate(rings):
            if fr == 0:
                idx.append([len(verts)])
                verts.append(Vector((cx + rr2.uniform(-0.6, 0.6), cy + rr2.uniform(-0.6, 0.6), fz * dd if k else fz)))
                continue
            ring = []
            off = rr2.uniform(0, TAU)
            for j in range(n):
                a = off + TAU * j / n + rr2.uniform(-0.12, 0.12)
                rad = rr * fr * rk(a) * rr2.uniform(0.9, 1.08)
                z = (fz * (R / 12) if k == 0 else fz * dd) + rr2.uniform(-0.08, 0.08) * dd * (k > 0)
                ring.append(len(verts))
                verts.append(Vector((cx + rad * math.cos(a) * stretch ** 0.3, cy + rad * math.sin(a), z)))
            idx.append(ring)
        for A, B in zip(idx, idx[1:]):
            if len(B) == 1:
                for j in range(n):
                    faces.append((A[(j + 1) % n], A[j], B[0]))
            else:
                for j in range(n):
                    faces.append((A[j], B[j], B[(j + 1) % n], A[(j + 1) % n]))
        faces.append(tuple(reversed(idx[0])))
        ob = lib.mesh_obj('rock', verts, faces, rock_m, smooth=False)

        def rc(p, nrm, poly):
            d = -p.z / dd
            # Estratos horizontales (tipo tarta) con leve variación por cara.
            band = int(d * 4.5)
            c = STRATA[min(band, len(STRATA) - 1)]
            c = mix(c, ROCKS[(poly.index * 7 + sd) % len(ROCKS)], 0.25)
            return mix(c, hexc('#ffe2b8'), max(0.0, nrm.z) * 0.3)
        lib.paint(ob, rc)
        return ob

    cones = [(0, 0, R * (1 if not lobes else 0.8), R * depth)]
    for la, ls in lobes:
        cones.append((math.cos(la) * R * 0.6 * stretch, math.sin(la) * R * 0.6, R * 0.68, R * depth * 0.8))
    for i, (cx, cy, rr, dd) in enumerate(cones):
        parts.append(rock_cone(cx, cy, rr, dd, seed * 10 + i))

    # Pedruscos facetados pegados al lateral y alguno flotando debajo.
    for i in range(extra_rocks):
        v, f = lib.ico(1.0, 1)
        s = rnd.uniform(0.12, 0.2) * R
        a = rnd.uniform(0, TAU)
        floating = i >= extra_rocks - 1 and extra_rocks > 2
        if floating:
            pos = Vector((math.cos(a) * R * 0.7 * stretch, math.sin(a) * R * 0.7, -R * depth * rnd.uniform(0.75, 0.95)))
            s *= 0.55
        else:
            h = rnd.uniform(0.25, 0.5)
            pos = Vector((math.cos(a) * R * (0.8 - h * 0.7) * stretch, math.sin(a) * R * (0.8 - h * 0.7), -R * depth * h))
        m = Matrix.Translation(pos) @ Matrix.Rotation(rnd.uniform(0, 3), 4, Vector((rnd.random(), rnd.random(), 1)).normalized())
        v = [Vector((p.x * rnd.uniform(0.8, 1.2), p.y * rnd.uniform(0.8, 1.2), p.z * rnd.uniform(0.7, 1.0))) * s for p in v]
        ob = lib.mesh_obj('pebble', lib.transform(v, m), f, rock_m, smooth=False)
        lib.paint(ob, lambda p, n, poly: mix(ROCKS[poly.index % len(ROCKS)], hexc('#ffe2b8'), max(0.0, n.z) * 0.3))
        parts.append(ob)

    # --- Árboles "chupachups": tronco cónico + copa redonda (a veces doble).
    canopy_cols = [('#4cc34a', '#9be86a'), ('#3fb86b', '#8ff0a0'), ('#62cc3c', '#c8f56e')]
    placed = []
    tries = 0
    while len(placed) < trees and tries < 400:
        tries += 1
        rho = math.sqrt(rnd.random()) * 0.62
        a = rnd.uniform(0, TAU)
        x, y = math.cos(a) * rho * R * stretch, math.sin(a) * rho * R
        big = len(placed) == 0
        size = (rnd.uniform(0.95, 1.15) if big else rnd.uniform(0.6, 0.9)) * R / 12 * 2.3
        if any((Vector((x, y)) - Vector((px, py))).length < (size + ps) * 1.25 for px, py, ps in placed):
            continue
        placed.append((x, y, size))
    for ti, (x, y, size) in enumerate(placed):
        z0 = top_z(x, y) - 0.2
        size *= 1.2
        trunk_h = size * 1.25
        tv, tf = lib.lathe([(0.0, trunk_h), (0.2 * size, trunk_h), (0.26 * size, 0.3), (0.38 * size, 0.0), (0.0, -0.3)], 7)
        tr = lib.mesh_obj('trunk', lib.transform(tv, Matrix.Translation((x, y, z0))), tf, rock_m, sharp_angle=40)
        lib.paint(tr, lambda p, n, _: mix(hexc('#a8683f'), hexc('#c98a55'), max(0.0, n.x * 0.5 + 0.5)))
        parts.append(tr)
        dark, light = [hexc(c) for c in canopy_cols[ti % len(canopy_cols)]]
        blobs = [(Vector((0, 0, trunk_h + size * 0.75)), size)]
        if size > 1.9 * R / 12 * 2.3 * 0.5 and ti % 2 == 0:
            blobs.append((Vector((size * 0.55, size * 0.25, trunk_h + size * 0.35)), size * 0.62))
        for c, s in blobs:
            v, f = lib.ico(s, 2)
            v = [Vector((p.x, p.y, p.z * 0.9)) + c + Vector((x, y, z0)) for p in v]
            cp = lib.mesh_obj('canopy', v, f, grass_m, smooth=True)
            zc = c.z + z0

            def cc(p, n, _, zc=zc, s=s, dark=dark, light=light):
                return mix(dark, light, smoothstep(-0.6, 1.0, n.z * 0.8 + n.x * 0.2 - n.y * 0.2))
            lib.paint(cp, cc, per='vertex')
            parts.append(cp)

    # Arbustos bajos en el borde.
    for i in range(trees + 1):
        a = rnd.uniform(0, TAU)
        rho = rnd.uniform(0.62, 0.78)
        x, y = math.cos(a) * rho * R * stretch, math.sin(a) * rho * R
        if any((Vector((x, y)) - Vector((px, py))).length < ps * 1.2 + 1 for px, py, ps in placed):
            continue
        s = rnd.uniform(0.7, 1.1) * R / 12
        v, f = lib.ico(s, 1)
        v = [Vector((p.x * 1.3, p.y * 1.3, p.z * 0.75)) + Vector((x, y, top_z(x, y) + s * 0.25)) for p in v]
        b = lib.mesh_obj('bush', v, f, grass_m, smooth=True)
        lib.paint(b, lambda p, n, _: mix(hexc('#4fbf45'), hexc('#a9ec6f'), n.z * 0.5 + 0.5), per='vertex')
        parts.append(b)

    # Segundo piso de césped (meseta pequeña).
    if second_tier:
        a = rnd.uniform(0, TAU)
        cx, cy = math.cos(a) * R * 0.35 * stretch, math.sin(a) * R * 0.35
        rr = R * 0.32
        hz = R * 0.22
        pp = [(0.0, hz + 0.3), (0.6 * rr, hz + 0.2), (0.95 * rr, hz - 0.15), (1.0 * rr, hz - 0.6),
              (0.98 * rr, hz - 1.0), (0.9 * rr, top_z(cx, cy) - 0.4), (0.0, top_z(cx, cy) - 0.6)]
        v, f = lib.lathe(pp, 22, lambda a: 1 + 0.06 * math.sin(3 * a))
        v = [p + Vector((cx, cy, 0)) for p in v]
        t2 = lib.mesh_obj('tier', v, f, grass_m, sharp_angle=55)

        def tcol(p, n, poly):
            if p.z < hz - 1.0 * 1.0 and n.z < 0.5:
                return ROCKS[poly.index % len(ROCKS)]
            return mix(GRASS, GRASS_LIGHT, smoothstep(0.8, 1.0, math.hypot(p.x - cx, p.y - cy) / rr))
        lib.paint(t2, tcol, per='face')
        parts.append(t2)
        placed.append((cx, cy, rr))

    # --- Cascada: cinta que sale del borde y cae por el lateral.
    if waterfall:
        water_m = lib.material('Water', hexc('#7fdcff'), rough=0.15, emit=hexc('#1f8fc4'), emit_strength=0.6)
        a = ph[3] + math.pi * 0.5
        dirv = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-dirv.y, dirv.x, 0))
        r_edge = R * rk(a)
        w = R * 0.14
        path = []
        for i in range(12):
            t = i / 11
            if t < 0.15:
                rr_ = r_edge * (0.84 + t / 0.15 * 0.2)
                z = gp[3][1] + 0.08 - t / 0.15 * 0.25
            else:
                u = (t - 0.15) / 0.85
                rr_ = r_edge * (1.04 + 0.08 * math.sin(u * math.pi * 0.5) + 0.05 * u)
                z = gp[3][1] - 0.2 - u * R * depth * 1.15
            path.append((rr_, z, t))
        verts, faces = [], []
        for rr_, z, t in path:
            ww = w * (1 + 0.4 * t)
            c = Vector((dirv.x * rr_ * stretch, dirv.y * rr_, z))
            for k in (-1, 0, 1):
                bulge = 0.25 * (R / 12) if k == 0 else 0
                verts.append(c + side * (k * ww) + dirv * bulge)
        for i in range(len(path) - 1):
            for k in range(2):
                a0 = i * 3 + k
                faces.append((a0, a0 + 1, a0 + 4, a0 + 3))
        wf = lib.mesh_obj('waterfall', verts, faces, water_m, smooth=True)
        water_m.use_backface_culling = False
        lib.solid(wf, (1, 1, 1))
        parts.append(wf)
        # Espuma arriba y nube de agua abajo.
        for t, s in ((0.12, 0.9), (0.99, 1.8)):
            rr_, z, _ = path[int(t * 11)]
            for k in (-1, 0, 1):
                v, f = lib.ico(s * (R / 12) * (1.1 if k == 0 else 0.8), 1)
                c = Vector((dirv.x * rr_ * stretch, dirv.y * rr_, z)) + side * (k * w * 1.1 * (1 + t * 0.5))
                fo = lib.mesh_obj('foam', [p + c for p in v], f, grass_m, smooth=True)
                lib.paint(fo, lambda p, n, _: mix(hexc('#d9f4ff'), hexc('#ffffff'), n.z * 0.5 + 0.5), per='vertex')
                parts.append(fo)

    ob = lib.join(parts, f'Island')
    return ob


ISLAND_VIEW = dict(view=(1.0, -1.35, 0.32), margin=0.95)


def build_island_a():
    return island(11, 13.5, trees=4, waterfall=True, depth=1.05, extra_rocks=4), ISLAND_VIEW


def build_island_b():
    return island(23, 12.5, stretch=1.42, lobes=((0.3, 0.12), (math.pi + 0.2, 0.1)), depth=1.0,
                  trees=5, extra_rocks=3, second_tier=True), ISLAND_VIEW


def build_island_c():
    return island(37, 10.5, depth=1.45, trees=2, extra_rocks=4), ISLAND_VIEW


# =================================================================== nube
def build_cloud():
    m = lib.material('Cloud', (1, 1, 1), rough=0.9, emit=hexc('#e8f1ff'), emit_strength=0.18, vcol=True)
    rnd = random.Random(5)
    blobs = [(-5.2, 0, 1.4, 2.3), (-2.6, 0.4, 2.3, 3.2), (0.6, -0.2, 3.0, 3.9), (3.8, 0.3, 2.2, 3.1),
             (6.0, -0.1, 1.3, 2.1), (-1.0, -1.2, 1.2, 2.4), (2.2, 1.3, 1.4, 2.5), (-0.8, 0.6, 4.0, 2.6)]
    parts = []
    zb = 0.3
    for x, y, z, r in blobs:
        v, f = lib.ico(r, 2)
        v = [p + Vector((x, y, z)) for p in v]
        for p in v:  # base plana, como nube de dibujo animado
            if p.z < zb:
                p.z = zb + (p.z - zb) * 0.22
        ob = lib.mesh_obj('puff', v, f, m, smooth=True)
        lib.paint(ob, lambda p, n, _: mix(hexc('#d3e2ff'), hexc('#ffffff'), smoothstep(-0.1, 3.2, p.z) * 0.85 + max(0, n.z) * 0.3),
                  per='vertex')
        parts.append(ob)
    ob = lib.join(parts, 'Cloud')
    center_origin(ob)
    return ob, dict(view=(0.5, -1.4, 0.35))


# =================================================================== cristales
def build_crystal():
    mag = lib.material('CrystalMagenta', hexc('#ff5cf0'), rough=0.18, emit=hexc('#e51fd4'), emit_strength=1.0)
    cya = lib.material('CrystalCyan', hexc('#5cf6ff'), rough=0.18, emit=hexc('#12c8e8'), emit_strength=1.0)
    rock = lib.material('CrystalRock', hexc('#4a3478'), rough=0.8, vcol=True)
    rnd = random.Random(9)
    parts = []
    v, f = lib.ico(1.0, 1)
    v = [Vector((p.x * 2.6 * rnd.uniform(0.9, 1.1), p.y * 2.3 * rnd.uniform(0.9, 1.1), p.z * 0.9)) for p in v]
    for p in v:
        p.z = max(p.z, -0.35)
    base = lib.mesh_obj('base', v, f, rock, smooth=False)
    lib.paint(base, lambda p, n, poly: mix(hexc(['#4a3478', '#5b3f8f', '#3d2b66'][poly.index % 3]), hexc('#8a6cd1'), max(0, n.z) * 0.4))
    parts.append(base)

    specs = [  # (x, y, inclinación, rumbo, radio, largo, material)
        (0.0, 0.0, 4, 0, 0.72, 4.6, mag),
        (0.9, 0.4, 24, 20, 0.5, 3.4, cya),
        (-0.9, 0.3, 28, 160, 0.52, 3.2, cya),
        (0.3, -0.9, 30, 280, 0.45, 2.7, mag),
        (-0.4, 1.0, 34, 110, 0.4, 2.3, mag),
        (1.4, -0.5, 48, 330, 0.34, 1.7, mag),
        (-1.5, -0.6, 50, 215, 0.36, 1.9, cya),
        (0.2, 1.5, 55, 80, 0.3, 1.4, cya),
    ]
    for x, y, tilt, head, r, L, mm in specs:
        n = 6
        verts = []
        for z, s in ((-0.6, 1.0), (L, 0.92)):
            for j in range(n):
                a = TAU * j / n + head
                verts.append(Vector((r * s * math.cos(a), r * s * math.sin(a), z)))
        verts.append(Vector((0, 0, L + r * 1.5)))
        faces = [(j, (j + 1) % n, n + (j + 1) % n, n + j) for j in range(n)]
        faces += [(n + j, n + (j + 1) % n, 2 * n) for j in range(n)]
        faces.append(tuple(reversed(range(n))))
        M = (Matrix.Translation((x, y, 0.3)) @ Matrix.Rotation(math.radians(head), 4, 'Z')
             @ Matrix.Rotation(math.radians(tilt), 4, 'Y'))
        ob = lib.mesh_obj('crystal', lib.transform(verts, M), faces, mm, smooth=False)
        lib.solid(ob, (1, 1, 1))
        parts.append(ob)
    ob = lib.join(parts, 'Crystal')
    return ob, dict(sky='#2b2350')


# =================================================================== planeta
def build_planet():
    pm = lib.material('Planet', (1, 1, 1), rough=0.55, vcol=True)
    rm = lib.material('PlanetRing', (1, 1, 1), rough=0.6, vcol=True, double=True)
    R = 20.0
    v, f = lib.uvsphere(R, 40, 22)
    pl = lib.mesh_obj('planet', v, f, pm, smooth=True)
    bands = [hexc(h) for h in ('#ffe7b8', '#ffb896', '#ffe7b8', '#f79ab8', '#c8a8ff', '#fff4d6',
                               '#9fe6d0', '#c8a8ff', '#ffb896', '#ffe7b8', '#f79ab8')]

    def pc(p, n, poly):
        lat = math.asin(max(-1, min(1, p.z / R)))
        t = (lat / math.pi + 0.5) * len(bands)
        return bands[min(len(bands) - 1, int(t))]
    lib.paint(pl, pc)
    parts = [pl]
    ring_cols = [('#fff1c9', 25.0, 26.8), ('#c8a8ff', 27.2, 28.2), ('#ffc2d9', 28.5, 30.0)]
    for col, r0, r1 in ring_cols:
        v, f = lib.lathe([(r0, 0), (r1, 0)], 64)
        # lathe de arriba abajo en el mismo z: la normal sale hacia +Z o -Z; material de doble cara.
        ob = lib.mesh_obj('ring', v, f, rm, smooth=True)
        lib.solid(ob, hexc(col))
        parts.append(ob)
    ob = lib.join(parts, 'Planet')
    ob.rotation_euler = (math.radians(22), math.radians(-12), 0)
    lib.select_only(ob)
    bpy.ops.object.transform_apply(rotation=True)
    return ob, dict(view=(1.0, -1.3, 0.55), sky='#23305e')


# =================================================================== arco
def torus(R, r, NS, NR, y=0.0):
    """Toro vertical en el plano XZ (se atraviesa por el eje Y)."""
    verts, faces = [], []
    for i in range(NS):
        u = TAU * i / NS
        for j in range(NR):
            w = TAU * j / NR
            rr = R + r * math.cos(w)
            verts.append(Vector((rr * math.cos(u), y + r * math.sin(w), rr * math.sin(u))))
    for i in range(NS):
        for j in range(NR):
            a = i * NR + j
            b = ((i + 1) % NS) * NR + j
            c = ((i + 1) % NS) * NR + (j + 1) % NR
            d = i * NR + (j + 1) % NR
            faces.append((a, d, c, b))
    return verts, faces


def build_arch():
    am = lib.material('ArchPaint', (1, 1, 1), rough=0.28, vcol=True)
    gm = lib.material('ArchGold', hexc('#ffc21a'), rough=0.3, metal=0.85)
    bm = lib.material('ArchBulb', hexc('#ffe066'), rough=0.3, emit=hexc('#ffb300'), emit_strength=1.0)
    R, r = 11.0, 1.3
    NS, NR = 48, 12
    v, f = torus(R, r, NS, NR)
    tor = lib.mesh_obj('torus', v, f, am, smooth=True)
    # Blanco con franjas anchas de colores (rojo, amarillo, verde, rosa); sin azul,
    # que en el juego queda reservado a las placas de impulso.
    stripe_cols = [hexc(h) for h in ('#ff4a5c', '#ffb02e', '#3fd06a', '#ff6fb5')]
    white = hexc('#fffaf2')

    def tc(p, n, poly):
        i = poly.index // NR
        return stripe_cols[(i // 3) // 2 % 4] if (i // 3) % 2 else white
    lib.paint(tor, tc)
    parts = [tor]
    # Ribetes dorados en las caras delantera y trasera, que llevan las bombillas.
    for side in (1, -1):
        v, f = torus(R, 0.4, NS, 6, y=side * r * 0.86)
        rim = lib.mesh_obj('rim', v, f, gm, smooth=True)
        lib.solid(rim, (1, 1, 1))
        parts.append(rim)
    NB = 16
    for k in range(NB):
        u = TAU * (k + 0.5) / NB
        for side in (1, -1):
            v, f = lib.uvsphere(0.55, 8, 4)
            c = Vector((R * math.cos(u), side * (r * 0.86 + 0.42), R * math.sin(u)))
            bo = lib.mesh_obj('bulb', [p + c for p in v], f, bm, smooth=True)
            lib.solid(bo, (1, 1, 1))
            parts.append(bo)
    ob = lib.join(parts, 'Arch')
    return ob, dict(view=(0.8, -1.4, 0.4))


def center_origin(ob):
    lib.select_only(ob)
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    ob.location = (0, 0, 0)


MODELS = {
    'coin': build_coin, 'island_a': build_island_a, 'island_b': build_island_b,
    'island_c': build_island_c, 'cloud': build_cloud, 'crystal': build_crystal,
    'planet': build_planet, 'arch': build_arch,
}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    do_preview = '--no-preview' not in argv
    names = [a for a in argv if not a.startswith('--')] or list(MODELS)
    for name in names:
        lib.reset()
        ob, pv = MODELS[name]()
        lib.export(ob, f'{name}.glb')
        if do_preview:
            lib.preview(ob, f'{name}.png', **pv)


main()
