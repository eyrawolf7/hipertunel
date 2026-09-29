"""Mundo "selva y ruinas": túnel de sillares de arenisca con enredaderas y cristales turquesa,
y decorado exterior (árbol, isla con castillo, volcán, arco en ruinas).

Convenciones (coordenadas de Blender; el GLB sale con Y arriba):
  Blender X -> glTF X, Blender Z -> glTF Y, Blender Y -> glTF -Z.
"""
import math
import random

import lib
from lib import hexc, mix, smoothstep, Geo
from mathutils import Vector, Matrix

TAU = 2 * math.pi
ISLAND = None  # build_props inyecta aquí su generador de islas

SAND = hexc('#d8c7a0')
SAND_TONES = [hexc(h) for h in ('#d8c7a0', '#d6b890', '#e4d2aa', '#cdb088')]
SAND_DARK = hexc('#9a7552')
SAND_DEEP = hexc('#6b5a40')
MOSS = hexc('#8fb04e')
LEAF_A = hexc('#4caf50')
LEAF_B = hexc('#7ed957')
LEAF_DARK = hexc('#2f7d3a')
STEM = hexc('#3f7f36')
CRYSTAL = hexc('#3ff5e0')


def mats():
    return dict(
        stone=lib.material('Stone', (1, 1, 1), rough=0.88, vcol=True),
        leaf=lib.material('Leaf', (1, 1, 1), rough=0.6, vcol=True, double=True),
        crystal=lib.material('Crystal', hexc('#a8fff4'), rough=0.15, emit=CRYSTAL, emit_strength=2.0),
    )


def noise3(p, s=1.0, seed=0.0):
    x, y, z = p.x * s, p.y * s, p.z * s
    return (math.sin(x * 1.7 + seed) * math.sin(y * 2.3 + seed * 1.3) * math.sin(z * 1.9 + 0.7)
            + 0.5 * math.sin(x * 3.1 + y * 2.7 + z * 1.3 + seed * 2.1)) / 1.5


def stone_block(corners, M, seed, tone, offset=0.04, segments=2, moss=0.0, chip=None, jitter=0.01,
                inset=None, name='block'):
    """Sillar biselado. corners: 8 esquinas (box8). Pinta arenisca con grietas oscuras y musgo."""
    rnd = random.Random(seed)
    c = [Vector(p) for p in corners]
    for ch in (chip if isinstance(chip, (list, tuple)) else [chip]):
        if ch is not None:
            c[ch] = c[ch] + (sum(c, Vector()) / 8 - c[ch]) * 0.2
    c = [p + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter for p in c]
    v, f = lib.box8(c)
    ob = lib.mesh_obj(name, v, f, M['stone'], sharp_angle=38)
    lib.bevel(ob, offset, segments)
    if inset:
        import bmesh
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        for axis, thick, depth in inset:
            best = max((fc for fc in bm.faces if fc.normal.dot(Vector(axis)) > 0.97),
                       key=lambda fc: fc.calc_area(), default=None)
            if best is not None:
                bmesh.ops.inset_individual(bm, faces=[best], thickness=thick, depth=-depth)
        bm.to_mesh(me)
        bm.free()
        lib.shade(ob, True, 38)
    cen = sum(c, Vector()) / 8
    ext = max((p - cen).length for p in c)

    def col(p, n, _):
        base = tone
        axis = max(abs(n.x), abs(n.y), abs(n.z))
        k = smoothstep(0.97, 0.80, axis)  # bisel = más oscuro
        base = mix(base, SAND_DARK, 0.75 * k)
        base = mix(base, hexc('#f4e6c8'), 0.2 * max(0.0, n.z) * (1 - k))
        base = mix(base, SAND_DARK, 0.22 * smoothstep(0.1, 0.9, 0.5 + 0.5 * noise3(p, 5.0 / max(ext, 0.3), seed)))
        if moss > 0 and n.z > 0.5:
            m = smoothstep(0.5, 0.8, 0.5 + 0.5 * noise3(p, 2.2 / max(ext, 0.3), seed + 3))
            base = mix(base, MOSS, moss * m)
        return base
    lib.paint(ob, col, per='vertex')
    return ob


def recolor_inset(ob, test, rgb):
    """Oscurece las caras rehundidas (el relieve tallado)."""
    me = ob.data
    attr = me.color_attributes['Col']
    for p in me.polygons:
        if test(ob.matrix_world @ p.center, p.normal):
            for li in p.loop_indices:
                c = attr.data[li].color
                attr.data[li].color = (*mix(c[:3], rgb, 0.4), 1)


# =================================================================== costilla de piedra
RIB_W, RIB_H, RIB_D = 2.1, 0.35, 0.6
RIB_MITRE = math.tan(math.radians(15))  # 12 caras: cada extremo a 15 grados


def build_rib_stone():
    """Sillar curvo que cubre una cara del túnel (12 caras). Blender: X tangente, Z hacia fuera
    (0..0.35), Y a lo largo de la vía (±0.3). Extremos a inglete de 15 grados para cerrar el anillo."""
    M = mats()
    rnd = random.Random(101)

    def hw(z):
        return RIB_W / 2 + z * RIB_MITRE

    cuts = [-1.0, -0.36, 0.31, 1.0]
    gap = 0.012
    parts = []
    for bi in range(3):
        t0, t1 = cuts[bi], cuts[bi + 1]
        h = RIB_H - rnd.uniform(0.0, 0.03)
        d = RIB_D / 2 - rnd.uniform(0.0, 0.025)

        def X(t, z, left):
            if abs(t) == 1.0:
                return t * hw(z)  # inglete
            return t * RIB_W / 2 + (gap if left else -gap)
        corners = []
        for iz, z in ((0, 0.0), (1, h)):
            for iy, y in ((0, -d), (1, d)):
                for ix, t in ((0, t0), (1, t1)):
                    corners.append((X(t, z, ix == 0), y, z))
        inset = None
        if bi == 1:  # panel tallado en la cara exterior y en las dos caras de la vía
            inset = [((0, 0, 1), 0.06, 0.014), ((0, -1, 0), 0.045, 0.012), ((0, 1, 0), 0.045, 0.012)]
        ob = stone_block(corners, M, 200 + bi, SAND_TONES[bi], offset=0.035, segments=2, moss=0.25,
                         chip=[(6, 1), (7,), (5, 2)][bi], jitter=0.009, inset=inset, name=f'rib{bi}')
        if inset:
            recolor_inset(ob, lambda c, n, h=h, d=d: (n.z > 0.9 and c.z < h - 0.012)
                          or (abs(n.y) > 0.9 and abs(c.y) < d - 0.008 and 0.06 < c.z < h - 0.06), SAND_DEEP)
        parts.append(ob)
    # Argamasa oscura detrás, visible por las juntas.
    zb = 0.2
    c = []
    for z in (0.0, zb):
        for y in (-0.25, 0.25):
            for s in (-1, 1):
                c.append((s * (hw(z) - 0.03), y, z))
    v, f = lib.box8([Vector(p) for p in c])
    mortar = lib.mesh_obj('mortar', v, f, M['stone'], smooth=False)
    lib.solid(mortar, SAND_DEEP)
    parts.append(mortar)
    ob = lib.join(parts, 'RibStone')
    return ob, dict(view=(0.7, -1.3, 0.9), margin=1.0, sky='#e8e0d0')


# =================================================================== cristales
def crystal_prism(base, direction, r, L, sides=6, phase=0.0):
    d = Vector(direction).normalized()
    n, b = lib.frame(d)
    verts = []
    for s, t in ((0.8, -0.05), (1.0, 0.72)):
        for j in range(sides):
            a = phase + TAU * j / sides
            verts.append(Vector(base) + d * (L * t) + (n * math.cos(a) + b * math.sin(a)) * r * s)
    verts.append(Vector(base) + d * L)
    faces = [(j, (j + 1) % sides, sides + (j + 1) % sides, sides + j) for j in range(sides)]
    faces += [(sides + j, sides + (j + 1) % sides, 2 * sides) for j in range(sides)]
    faces.append(tuple(reversed(range(sides))))
    return verts, faces


def crystal_group(M, specs, name='crystals'):
    g = Geo()
    for base, direction, r, L, ph in specs:
        g.add(*crystal_prism(base, direction, r, L, phase=ph), (1, 1, 1))
    return g.build(name, M['crystal'], smooth=False)


def build_crystal_cluster():
    """Racimo de cristales turquesa (emisivos) sobre una piedrecita. Origen en la base, sube en +Y."""
    M = mats()
    rnd = random.Random(33)
    v, f = lib.ico(1.0, 1)
    v = [Vector((p.x * 0.19 * rnd.uniform(0.9, 1.1), p.y * 0.16 * rnd.uniform(0.9, 1.1), max(0.0, p.z * 0.11 + 0.02)))
         for p in v]
    rock = lib.mesh_obj('base', v, f, M['stone'], smooth=False)
    lib.paint(rock, lambda p, n, poly: mix(mix(SAND_TONES[poly.index % 4], SAND_DARK, 0.25),
                                           MOSS, 0.55 * smoothstep(0.5, 0.9, n.z) * (poly.index % 3 == 0)))
    specs = [  # base, dirección, radio, largo, fase
        ((0.0, 0.0, 0.05), (0.05, 0.02, 1), 0.075, 0.46, 0.2),
        ((0.08, 0.03, 0.05), (0.55, 0.2, 1), 0.055, 0.32, 0.9),
        ((-0.07, 0.04, 0.05), (-0.6, 0.3, 1), 0.052, 0.29, 0.4),
        ((0.02, -0.08, 0.04), (0.1, -0.7, 1), 0.045, 0.24, 1.3),
        ((-0.05, -0.05, 0.04), (-0.5, -0.5, 0.8), 0.035, 0.17, 0.6),
    ]
    cr = crystal_group(M, specs)
    ob = lib.join([rock, cr], 'CrystalCluster')
    return ob, dict(view=(1.0, -1.3, 0.6), sky='#3a5a4a', margin=1.05)


# =================================================================== enredaderas
def leaf_cols(g, verts, faces, dark, light):
    """Añade una hoja con el centro oscuro y el borde claro."""
    cols = [dark] + [light] * (len(verts) - 1)
    o = len(g.v)
    g.v += [Vector(p) for p in verts]
    g.c += cols
    g.f += [tuple(i + o for i in fc) for fc in faces]


def hanging_vine(g, top, length, rnd, amp=0.12, leaf_size=0.14, step=0.09, radius=0.018, scale=1.0,
                 rings=10, tip_cluster=True):
    """Liana colgando desde top hacia -Z, con hojas redondas alternas."""
    ph = rnd.uniform(0, TAU)
    ph2 = rnd.uniform(0, TAU)
    top = Vector(top)

    def at(t):
        return top + Vector((amp * math.sin(t * math.pi * 1.4 + ph) * t,
                             amp * 0.5 * math.sin(t * math.pi * 2.1 + ph2) * t, -length * t))
    path = [at(i / (rings - 1)) for i in range(rings)]
    v, f = lib.sweep(path, lambda t: radius * (1 - 0.5 * t), sides=4, cap_start=False, tip=radius * 2)
    g.add(v, f, lambda p: mix(STEM, hexc('#5a9a3e'), 0.5 + 0.5 * math.sin(p.z * 9)))
    t = 0.06
    side = 1
    k = 0
    while t < 0.98:
        p = at(t)
        tang = (at(min(1, t + 0.02)) - at(max(0, t - 0.02))).normalized()
        out = Vector((side, rnd.uniform(-0.4, 0.4), 0)).normalized()
        dirv = (out * 0.85 + tang * 0.55).normalized()
        nrm = Vector((rnd.uniform(-0.4, 0.4), -1, 0.3))
        s = leaf_size * scale * rnd.uniform(0.85, 1.15) * (1.0 - 0.25 * t)
        lv, lf = lib.leaf(p, dirv, nrm, s * 1.15, s, n=7)
        a, b = (LEAF_A, LEAF_B) if k % 2 else (LEAF_B, LEAF_A)
        leaf_cols(g, lv, lf, mix(a, LEAF_DARK, 0.35), b)
        side = -side
        k += 1
        t += step * scale / length * rnd.uniform(0.85, 1.15)
    if tip_cluster:
        p = at(1.0)
        for j in range(3):
            a = TAU * j / 3 + ph
            dirv = Vector((math.cos(a) * 0.7, math.sin(a) * 0.7, -0.7))
            s = leaf_size * scale * 0.8
            lv, lf = lib.leaf(p, dirv, Vector((0, 0, -1)) + dirv * 0.1, s * 1.1, s * 0.9, n=6)
            leaf_cols(g, lv, lf, LEAF_DARK, LEAF_B)


def build_vine_hang():
    """Manojo de lianas colgando desde el origen hacia -Y (glTF). Ancho ~0.8 m, largo ~1.5 m."""
    M = mats()
    rnd = random.Random(44)
    g = Geo()
    # Mata de musgo en el anclaje.
    for cx, cz, s in ((-0.16, -0.03, 0.13), (0.02, -0.01, 0.16), (0.2, -0.04, 0.12)):
        v, f = lib.ico(1.0, 1)
        v = [Vector((cx + p.x * s * 1.2, p.y * s * 0.8, cz + p.z * s * 0.7)) for p in v]
        g.add(v, f, lambda p: mix(LEAF_DARK, MOSS, smoothstep(-0.1, 0.05, p.z) * 0.8 + 0.2 * noise3(p, 20)))
    for x, L, amp in ((-0.22, 1.25, 0.10), (0.03, 1.5, 0.13), (0.25, 0.95, 0.09)):
        hanging_vine(g, (x, rnd.uniform(-0.03, 0.03), -0.05), L, rnd, amp=amp, step=0.106)
    # Hojas cubriendo la mata.
    for j in range(6):
        a = TAU * j / 6 + 0.3
        p = Vector((math.cos(a) * 0.16, math.sin(a) * 0.06, -0.06))
        lv, lf = lib.leaf(p, Vector((math.cos(a), 0.2 * math.sin(a), -0.5)), Vector((0, -1, 0.2)), 0.2, 0.16, n=6)
        leaf_cols(g, lv, lf, mix(LEAF_A, LEAF_DARK, 0.3), LEAF_B if j % 2 else LEAF_A)
    ob = g.build('VineHang', M['leaf'], smooth=True)
    return ob, dict(view=(0.35, -1.4, 0.15), margin=1.05)


def build_vine_edge():
    """Enredadera reptante a lo largo de una arista: 4 m en Z (glTF), altura 0..0.15 en +Y (normal
    de la superficie), hojas abiertas hacia ±X."""
    M = mats()
    rnd = random.Random(55)
    g = Geo()
    stems = [(-2.0, 2.0, 0.07, 2.1, 0.0, 18), (-1.7, 1.85, 0.08, 1.6, 2.2, 13)]
    for y0, y1, amp, fr, ph, rings in stems:
        def at(y, amp=amp, fr=fr, ph=ph):
            return Vector((amp * math.sin(y * fr + ph), y, 0.022 + 0.008 * math.sin(y * 3.3 + ph)))
        path = [at(y0 + (y1 - y0) * i / (rings - 1)) for i in range(rings)]
        v, f = lib.sweep(path, 0.017, sides=4, cap_start=True, tip=0.03)
        g.add(v, f, lambda p: mix(STEM, hexc('#5a9a3e'), 0.5 + 0.5 * math.sin(p.y * 7)))
        y = y0 + 0.05
        side = 1 if ph == 0 else -1
        k = 0
        while y < y1 - 0.04:
            p = at(y)
            lift = rnd.uniform(0.1, 0.35)
            along = rnd.uniform(-0.5, 0.5)
            dirv = Vector((side, along, lift))
            nrm = Vector((-side * lift, 0, 1))
            s = rnd.uniform(0.15, 0.2) * (1.1 if ph == 0 else 0.85)
            lv, lf = lib.leaf(p, dirv, nrm, s * 1.2, s, n=6, cup=0.14)
            a, b = (LEAF_A, LEAF_B) if (k + int(ph)) % 2 else (LEAF_B, LEAF_A)
            leaf_cols(g, lv, lf, mix(a, LEAF_DARK, 0.35), b)
            side = -side
            k += 1
            y += rnd.uniform(0.09, 0.12) if ph == 0 else rnd.uniform(0.12, 0.17)
    ob = g.build('VineEdge', M['leaf'], smooth=True)
    return ob, dict(view=(1.0, -0.5, 0.7), margin=0.6)


# =================================================================== árbol de la selva
def jungle_tree(M, seed=7, scale=1.0, lianas=5, offset=Vector(), lod=0):
    """lod=1: versión barata para ponerla en islas (copa con menos polígonos)."""
    rnd = random.Random(seed)
    S = scale
    parts = []
    bark = Geo()
    ctrl = [(0, 0, -0.4), (0.45, 0.1, 2.4), (-0.5, 0.25, 5.0), (0.15, -0.1, 7.4), (0.55, 0.0, 8.9)]
    path = lib.catmull([Vector(p) * S + offset for p in ctrl], 4)

    def rad(t):
        return S * (0.36 + 0.36 * (1 - t) ** 1.4 + 0.45 * max(0.0, 1 - t * 7) ** 2)
    v, f = lib.sweep(path, rad, sides=9 if lod == 0 else 6, cap_start=True)

    def barkc(p):
        return mix(hexc('#7a4e33'), hexc('#b58155'), 0.5 + 0.5 * math.sin(math.atan2(p.y - offset.y, p.x - offset.x) * 5
                                                                    + p.z * 0.4))
    bark.add(v, f, barkc)
    # Raíces que se abren en la base.
    nroots = 6 if lod == 0 else 3
    for j in range(nroots):
        a = TAU * j / nroots + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        rp = [offset + (d * 0.3 + Vector((0, 0, 1.1))) * S, offset + (d * 0.9 + Vector((0, 0, 0.45))) * S,
              offset + (d * 1.7 + Vector((0, 0, -0.25))) * S]
        v, f = lib.sweep(lib.catmull(rp, 3), lambda t: S * (0.38 - 0.28 * t), sides=5, cap_start=False,
                         tip=0.1 * S)
        bark.add(v, f, barkc)
    # Ramas hacia las copas laterales.
    puffs = [((0.6, 0.0, 10.2), 2.4), ((2.7, 0.7, 9.4), 1.8), ((-2.3, -0.5, 9.2), 1.9),
             ((0.1, 2.3, 9.6), 1.6), ((-0.3, -2.1, 9.8), 1.7), ((0.4, 0.2, 11.3), 1.45)]
    top = path[-1]
    for (x, y, z), r in (puffs[1:5] if lod == 0 else puffs[1:3]):
        bp = [top + Vector((0, 0, -1.2 * S)), offset + Vector((x * 0.55, y * 0.55, z - 0.6)) * S,
              offset + Vector((x, y, z - 0.3)) * S]
        v, f = lib.sweep(lib.catmull(bp, 3), lambda t: S * (0.26 - 0.12 * t), sides=5, cap_start=False,
                         tip=0.05)
        bark.add(v, f, barkc)
    parts.append(bark.build('trunk', M['stone'], smooth=True))
    # Copa: pompones grumosos.
    canopy = Geo()
    for i, ((x, y, z), r) in enumerate(puffs if lod == 0 else puffs[:4]):
        c = offset + Vector((x, y, z)) * S
        v, f = lib.ico(1.0, 2 if lod == 0 else 1)
        if lod:
            r *= 1.1
        vv = []
        for p in v:
            k = 1 + 0.09 * math.sin(p.x * 5 + i) * math.sin(p.y * 4.3 + 2 * i) + 0.06 * math.sin(p.z * 7 + i)
            vv.append(c + Vector((p.x, p.y, p.z * 0.74)) * r * S * k)

        def cc(p, c=c, r=r):
            h = (p.z - c.z) / (r * S * 0.74)
            side = ((p - c).normalized().dot(Vector((0.4, -0.6, 0.7)).normalized()))
            t = smoothstep(-0.9, 0.9, h * 0.6 + side * 0.6)
            return mix(hexc('#1a5226'), hexc('#9be86a'), t)
        canopy.add(vv, f, cc)
    parts.append(canopy.build('canopy', M['leaf'], smooth=True))
    # Lianas.
    lg = Geo()
    for j in range(lianas):
        (x, y, z), r = puffs[1 + j % 4]
        c = offset + Vector((x * 0.9, y * 0.9, z - r * 0.55)) * S
        hanging_vine(lg, c, rnd.uniform(3.0, 5.0) * S, rnd, amp=0.4 * S, leaf_size=0.75, step=0.6,
                     radius=0.055 * S, scale=S, rings=9)
    if lianas:
        parts.append(lg.build('lianas', M['leaf'], smooth=True))
    return parts


def build_jungle_tree():
    """Árbol de la selva estilizado, ~12 m. Origen en el pie del tronco."""
    M = mats()
    ob = lib.join(jungle_tree(M), 'JungleTree')
    return ob, dict(view=(1.0, -1.3, 0.35), margin=1.0)


# =================================================================== isla con castillo
CREAM = hexc('#f5ecd9')
CREAM_SH = hexc('#d8c3a3')
ROOF = hexc('#e0573f')
ROOF_SH = hexc('#b53a2c')
WINDOW = hexc('#4a3a55')


def castle(M, z0):
    wall = Geo()
    roof = Geo()
    dark = Geo()

    def wc(p):
        return mix(CREAM_SH, CREAM, smoothstep(z0, z0 + 6, p.z) * 0.7 + 0.3 * (0.5 + 0.5 * math.sin(p.x * 0.7 + p.y)))

    def tower(x, y, r, h0, h1, roof_h, seg=10):
        v, f = lib.lathe([(0.0, h1 + 0.8), (r * 1.18, h1 + 0.8), (r * 1.18, h1), (r, h1 - 0.25), (r, h0),
                          (0.0, h0)], seg)
        wall.add([p + Vector((x, y, 0)) for p in v], f, wc)
        v, f = lib.lathe([(0.0, h1 + 0.8 + roof_h), (r * 0.55, h1 + 0.8 + roof_h * 0.45),
                          (r * 1.38, h1 + 0.6), (r * 1.2, h1 + 0.45), (0.0, h1 + 0.45)], seg)
        roof.add([p + Vector((x, y, 0)) for p in v], f,
                 lambda p: mix(ROOF_SH, ROOF, 0.5 + 0.5 * math.cos(math.atan2(p.y - y, p.x - x) + 0.9)))
        # Ventanas.
        for k in range(2):
            a = -math.pi / 2 + (k - 0.5) * 1.1
            wz = h0 + (h1 - h0) * 0.62
            wv, wf = lib.box((x + math.cos(a) * r * 0.97, y + math.sin(a) * r * 0.97, wz), (0.35, 0.35, 0.8),
                             Matrix.Rotation(a, 3, 'Z'))
            dark.add(wv, wf, WINDOW)
        return h1 + 0.8 + roof_h

    base = z0
    # Cimiento de piedra.
    v, f = lib.lathe([(0.0, base + 0.2), (5.9, base + 0.2), (6.3, base - 0.4), (6.0, base - 1.4), (0.0, base - 1.4)],
                     14, lambda a: 1 + 0.05 * math.sin(3 * a))
    wall.add(v, f, lambda p: mix(SAND_DARK, SAND, 0.6))
    # Murallas entre cuatro torres, con almenas.
    q = 4.2
    corners = [(q, q), (-q, q), (-q, -q), (q, -q)]
    for i in range(4):
        (xa, ya), (xb, yb) = corners[i], corners[(i + 1) % 4]
        mx_, my_ = (xa + xb) / 2, (ya + yb) / 2
        L = math.hypot(xb - xa, yb - ya)
        rot = Matrix.Rotation(math.atan2(yb - ya, xb - xa), 3, 'Z')
        wv, wf = lib.box((mx_, my_, base + 2.3), (L, 0.9, 4.2), rot)
        wall.add(wv, wf, wc)
        for k in range(5):
            t = (k + 0.5) / 5 - 0.5
            p = Vector((mx_, my_, 0)) + rot @ Vector((t * L * 0.8, 0, 0))
            wv, wf = lib.box((p.x, p.y, base + 4.75), (0.7, 0.95, 0.7), rot)
            wall.add(wv, wf, wc)
    # Puerta.
    gv, gf = lib.box((0, -q - 0.42, base + 1.3), (1.6, 0.2, 2.4))
    dark.add(gv, gf, WINDOW)
    top = 0
    for (x, y) in corners:
        top = max(top, tower(x, y, 1.25, base, base + 7.2, 3.2))
    # Torre del homenaje y torre alta.
    kv, kf = lib.box((-0.6, 0.6, base + 4.5), (4.0, 3.6, 9.0))
    wall.add(kv, kf, wc)
    pv = [Vector((-0.6 + sx * 2.35, 0.6 + sy * 2.15, base + 9.0)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    pv.append(Vector((-0.6, 0.6, base + 12.2)))
    roof.add(pv, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], lambda p: ROOF)
    for sx in (-1, 1):
        wv, wf = lib.box((-0.6 + sx * 0.9, 0.6 - 1.82, base + 6.8), (0.45, 0.2, 1.0))
        dark.add(wv, wf, WINDOW)
    spire = tower(1.3, -0.7, 1.05, base + 8.0, base + 13.8, 4.6, seg=10)
    parts = [wall.build('castle_walls', M['stone'], sharp_angle=40),
             roof.build('castle_roofs', M['stone'], sharp_angle=40),
             dark.build('castle_dark', M['stone'], smooth=False)]
    # Cristal turquesa en la aguja.
    parts.append(crystal_group(M, [((1.3, -0.7, spire - 0.2), (0, 0, 1), 0.35, 1.6, 0.0)], 'spire_crystal'))
    return parts


def build_island_castle():
    """Isla flotante con castillo de cuento y cascada, ~40 m. Origen en el centro, a nivel del césped."""
    M = mats()
    R = 14.0
    isl = ISLAND(71, R, trees=0, waterfall=True, depth=1.1, extra_rocks=3)
    # Girar la isla para que la cascada quede de frente (hacia -Y de Blender = +Z de glTF), como la puerta.
    rr = random.Random(71)
    ph = [rr.uniform(0, TAU) for _ in range(4)]
    isl.rotation_euler = (0, 0, -math.pi / 2 - (ph[3] + math.pi * 0.5) + 0.5)
    lib.select_only(isl)
    import bpy
    bpy.ops.object.transform_apply(rotation=True)
    parts = [isl] + castle(M, 0.55 * R / 12)
    for j, a in enumerate((0.5, 3.4)):
        x, y = math.cos(a) * R * 0.66, math.sin(a) * R * 0.66
        parts += jungle_tree(M, seed=90 + j, scale=0.38 + 0.06 * j, lianas=0, lod=1,
                             offset=Vector((x, y, 0.3 * R / 12)))
    ob = lib.join(parts, 'IslandCastle')
    return ob, dict(view=(1.0, -1.35, 0.35), margin=0.9)


# =================================================================== volcán
def build_volcano():
    """Volcán lejano con lava y penacho de humo, ~120 m. Origen en el centro de la base."""
    M = mats()
    lava_m = lib.material('Lava', hexc('#ffb347'), rough=0.4, emit=hexc('#ff5a1a'), emit_strength=2.0,
                          double=True)
    smoke_m = lib.material('Smoke', (1, 1, 1), rough=0.95, vcol=True)
    prof = [(8.5, 49.0), (11.0, 54.5), (13.8, 56.2), (16.5, 53.5), (22.0, 44.0), (29.0, 33.0), (38.0, 21.0),
            (48.0, 10.0), (57.0, 3.0), (62.0, 0.0), (60.0, -2.0), (0.0, -2.0)]
    seg = 48

    def rk(a):
        return 1 + 0.05 * math.sin(3 * a + 1) + 0.035 * math.sin(5 * a + 2)
    v, f = lib.lathe(prof, seg, rk)
    for p in v:  # barrancos
        a = math.atan2(p.y, p.x)
        h = max(0.0, min(1.0, (p.z - 2) / 50))
        g = 0.5 + 0.5 * math.cos(9 * a + p.z * 0.03)
        k = 1 - 0.06 * g * math.sin(h * math.pi) ** 0.7
        p.x *= k
        p.y *= k
    cone = lib.mesh_obj('cone', v, f, M['stone'], sharp_angle=48)

    def vc(p, n, _):
        z = p.z
        green = mix(hexc('#2f7a3a'), hexc('#5da848'), 0.5 + 0.5 * noise3(p, 0.35))
        rock = mix(hexc('#a36f52'), hexc('#8a5a44'), 0.5 + 0.5 * math.sin(math.atan2(p.y, p.x) * 9))
        top = hexc('#4a3034')
        c = mix(green, rock, smoothstep(6, 16, z + 4 * noise3(p, 0.2)))
        c = mix(c, top, smoothstep(30, 50, z))
        if z > 48 and math.hypot(p.x, p.y) < 13.0 and n.z > -0.2:
            c = mix(c, hexc('#d0552a'), 0.6)
        return mix(c, hexc('#ffe7c8'), 0.12 * max(0.0, n.z))
    lib.paint(cone, vc, per='vertex')
    parts = [cone]
    # Lava: charca y tres coladas.
    lava = Geo()
    lv, lf = lib.lathe([(0.0, 50.2), (9.6, 50.2)], 16)
    lava.add(lv, lf, (1, 1, 1))

    def surf(r, a):
        for (r0, z0), (r1, z1) in zip(prof[2:], prof[3:]):
            if r0 <= r <= r1:
                return z0 + (z1 - z0) * (r - r0) / (r1 - r0)
        return prof[-3][1]
    for a0 in (0.6, 1.7, 2.9, 4.0, 5.2):
        verts, faces = [], []
        N = 9
        for i in range(N):
            t = i / (N - 1)
            r = 13.2 + t * 17
            a = a0 + 0.08 * math.sin(t * 5)
            w = (2.6 - 1.9 * t) / r
            for s in (-1, 1):
                aa = a + s * w
                rr = r * rk(aa) * 0.97 + 0.5
                verts.append(Vector((rr * math.cos(aa), rr * math.sin(aa), surf(r, aa) + 0.6)))
        for i in range(N - 1):
            faces.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
        lava.add(verts, faces, (1, 1, 1))
    parts.append(lava.build('lava', lava_m, smooth=True))
    # Penacho de humo.
    smoke = Geo()
    rnd = random.Random(8)
    puffs = []
    for i in range(7):
        c = Vector((i * 2.6 + 0.35 * i ** 1.7, rnd.uniform(-1.5, 1.5), 58 + i * 8.5))
        r = 4.0 + i * 1.3
        puffs.append((c, r, i))
        if i >= 2:  # bultos laterales para que el penacho no parezca una oruga
            for k in (-1, 1):
                off = Vector((k * r * 0.75, rnd.uniform(-1, 1) * r * 0.4, -r * 0.25 + rnd.uniform(-1, 1) * r * 0.2))
                puffs.append((c + off, r * rnd.uniform(0.55, 0.7), i))
    for c, r, i in puffs:
        v, f = lib.ico(1.0, 2 if r > 6 else 1)
        vv = [c + Vector((p.x, p.y, p.z * 0.85)) * r * (1 + 0.07 * math.sin(p.x * 4 + i) * math.sin(p.y * 5))
              for p in v]

        def sc(p, i=i, c=c):
            t = smoothstep(-1, 1, (p.z - c.z) / 5)
            return mix(mix(hexc('#6e6468'), hexc('#b3aab0'), i / 6), hexc('#f4f0f4'), t * (0.45 + i / 10))
        smoke.add(vv, f, sc)
    parts.append(smoke.build('smoke', smoke_m, smooth=True))
    ob = lib.join(parts, 'Volcano')
    return ob, dict(view=(1.0, -1.4, 0.25), margin=0.95)


# =================================================================== arco en ruinas
def build_ruin_arch():
    """Pareja de pilares con un arco roto, cubiertos de enredaderas, ~20 m. Se atraviesa por Z (glTF)."""
    M = mats()
    rnd = random.Random(66)
    parts = []
    X = 5.6
    tone = lambda: SAND_TONES[rnd.randrange(4)]  # noqa: E731

    def block(center, size, rot=0.0, tilt=None, moss=0.5, seg=1, off=0.12):
        R = Matrix.Rotation(rot, 3, 'Z')
        if tilt:
            R = R @ Matrix.Rotation(tilt[1], 3, tilt[0])
        v, _ = lib.box(center, size, R)
        parts.append(stone_block(v, M, rnd.randrange(10 ** 6), tone(), offset=off, segments=seg, moss=moss,
                                 chip=rnd.choice([None, 4, 5, 6, 7]), jitter=0.06))

    tops = {}
    for side, n, broken in ((-1, 4, False), (1, 3, True)):
        z = 0.0
        block((side * X, 0, 0.4), (3.5, 3.5, 0.8), moss=0.3)
        z = 0.8
        for k in range(n):
            h = rnd.uniform(2.5, 3.0)
            block((side * X + rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), z + h / 2), (2.6, 2.6, h - 0.04),
                  rot=rnd.uniform(-0.05, 0.05), moss=0.45)
            z += h
        if broken:
            block((side * X + 0.2, 0.1, z + 0.8), (2.5, 2.4, 1.5), rot=0.15, tilt=('Y', 0.18), moss=0.7)
            z += 1.5
        else:
            block((side * X, 0, z + 0.45), (3.2, 3.2, 0.9), moss=0.6)
            z += 0.9
        tops[side] = z
    # Arco (dovelas) desde el pilar izquierdo; roto antes de llegar al derecho.
    zc = tops[-1]
    r0, r1 = X - 1.0, X + 1.0
    nseg = 9
    for i in range(nseg):
        if i >= 6:
            continue
        a0 = math.pi - math.pi * i / nseg - 0.012
        a1 = math.pi - math.pi * (i + 1) / nseg + 0.012
        if i == 5:
            a1 += 0.06
        c = []
        for iz, rr in ((0, r0), (1, r1)):
            for iy, y in ((0, -1.1), (1, 1.1)):
                for ix, a in ((0, a0), (1, a1)):
                    c.append(Vector((rr * math.cos(a), y, zc + rr * math.sin(a))))
        # box8 espera ix->x creciente; con a decreciente x crece, bien. z "arriba" = radio mayor.
        parts.append(stone_block(c, M, 900 + i, tone(), offset=0.12, segments=1, moss=0.6, jitter=0.05))
    # Bloques caídos.
    block((X + 3.2, -1.6, 0.6), (1.8, 1.5, 1.2), rot=0.5, tilt=('X', 0.2), moss=0.6)
    block((X + 1.4, 2.6, 0.45), (1.2, 1.1, 0.9), rot=-0.4, tilt=('Y', -0.3), moss=0.6)
    # Musgo en las cimas.
    moss = Geo()
    for (x, y, z, s) in ((-X, 0, tops[-1] + 0.05, 1.7), (X + 0.2, 0.1, tops[1] - 0.05, 1.3),
                         (zc * 0 - 2.0, 0, zc + r1 * 0.93, 1.3), (-4.2, 0, zc + r1 * 0.6, 1.2)):
        v, f = lib.ico(1.0, 1)
        vv = [Vector((x + p.x * s * 1.1, y + p.y * s * 1.1, z + p.z * s * 0.35)) for p in v]
        moss.add(vv, f, lambda p: mix(LEAF_DARK, MOSS, 0.5 + 0.5 * noise3(p, 1.5)))
    parts.append(moss.build('moss', M['leaf'], smooth=True))
    # Lianas colgando del arco y enredadera trepando por el pilar izquierdo.
    vg = Geo()
    for a, L in ((2.75, 6.5), (2.35, 4.2), (1.95, 5.2), (1.6, 3.2), (1.2, 2.4)):
        p = Vector((r0 * math.cos(a), rnd.uniform(-0.8, 0.8), zc + r0 * math.sin(a) + 0.2))
        hanging_vine(vg, p, L, rnd, amp=0.6, leaf_size=0.75, step=0.65, radius=0.08, scale=1.0, rings=9)
    for sidey in (-1.33, 1.33):
        path = []
        for i in range(12):
            t = i / 11
            path.append(Vector((-X + 1.0 * math.sin(t * 7 + sidey), sidey, 0.8 + t * (tops[-1] - 1.5))))
        v, f = lib.sweep(path, 0.08, sides=4, cap_start=True, tip=0.1)
        vg.add(v, f, STEM)
        for i, p in enumerate(path[1:-1]):
            for s in (-1, 1):
                d = Vector((s, 0, 0.6))
                lv, lf = lib.leaf(p, d, Vector((0, sidey, 0)), 0.95, 0.75, n=6)
                leaf_cols(vg, lv, lf, mix(LEAF_A, LEAF_DARK, 0.4), LEAF_B if (i + (s > 0)) % 2 else LEAF_A)
    parts.append(vg.build('vines', M['leaf'], smooth=True))
    # Cristales incrustados en el pilar izquierdo (cara delantera, -Y en Blender = +Z glTF).
    parts.append(crystal_group(M, [((-X + 0.3, -1.1, 5.2), (0.2, -1, 0.6), 0.45, 2.0, 0.0),
                                   ((-X - 0.4, -1.1, 5.0), (-0.6, -1, 0.3), 0.33, 1.4, 0.5),
                                   ((-X + 0.1, -1.1, 4.6), (0.2, -1, -0.4), 0.26, 1.0, 1.0),
                                   ((X - 1.1, -1.05, 2.4), (-0.3, -1, 0.5), 0.3, 1.2, 0.3)]))
    ob = lib.join(parts, 'RuinArch')
    return ob, dict(view=(0.9, -1.4, 0.35), margin=0.95)


MODELS = {
    'rib_stone': build_rib_stone, 'crystal_cluster': build_crystal_cluster, 'vine_hang': build_vine_hang,
    'vine_edge': build_vine_edge, 'jungle_tree': build_jungle_tree, 'island_castle': build_island_castle,
    'volcano': build_volcano, 'ruin_arch': build_ruin_arch,
}
