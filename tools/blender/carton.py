"""Bloque de cartón rompible del modo Zorro (y sus trozos para la rotura).

Uso:
  blender --background --python tools/blender/carton.py                  # GLB + vistas previas
  blender --background --python tools/blender/carton.py -- --no-preview   # solo el GLB

Salida: app/src/assets/kit/carton.glb
  box_carton          cubo unidad centrado en el origen (-0,5..0,5, como box_block del kit)
  carton_shards       vacío en el origen con 13 hijos carton_shard_00..12: trozos planos de
                      cartón (con canto ondulado), cada uno con su origen en su centro y colocado
                      donde estaba en el cubo; el juego los lanza desde su posición.
Textura: atlas 512x512 horneado aquí (numpy) e incrustado en el GLB como JPEG.
  celda A (0,0) cara lateral con lengüeta de cinta, B (1,0) cara lateral sin cinta (y la de
  abajo), C (0,1) tapa con la cruz de cinta, D (1,1) canto ondulado (arriba) y cartón interior.
Ejes glTF: +Y arriba; la cara +Z (la "frontal") y la +X llevan la lengüeta de cinta; el puño de
la tapa se lee derecho mirando desde +Z.
"""
import bpy
import bmesh
import math
import os
import sys

import numpy as np
from mathutils import Vector, noise as mnoise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

KIT = os.path.join(lib.ASSETS, 'kit')
PREV = os.path.join(lib.PREVIEWS, 'carton')
TMP = '/private/tmp/carton-build'
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

R = 0.07                 # radio del canto redondeado
HIN = 0.5 - R
TEX, CELL = 512, 256
PAD = 1.5 / CELL         # margen de la celda en UV (contra el sangrado)
BW = 0.046               # ancho de la franja ondulada en el borde de cada cara
TH = 0.03                # grosor de los trozos
STRIP_ROWS = (6, 58)     # filas (dentro de la celda D) de la tira del canto ondulado
STRIP_LEN = 0.5          # metros de canto que caben en los 256 px de la tira
INNER_ROWS = (70, 250)   # filas de la celda D con el cartón interior


def srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


KRAFT = srgb('#c98d52')
KRAFT_D = srgb('#9a622f')
KRAFT_IN = srgb('#c89a64')
GAP = srgb('#3e2512')
WAVE = srgb('#c98c50')
PAINT = srgb('#f4f0e6')
TAPE = srgb('#8f5a28')
TAPE_HI = srgb('#efcf9c')


# ================================================================== ruido
def vnoise(S, T, freq, seed):
    """Ruido de valor suave en el plano (S, T en metros)."""
    rng = np.random.default_rng(seed)
    n = int(freq * 6) + 8
    g = rng.random((n, n))
    x = (S + 3.0) * freq
    y = (T + 3.0) * freq
    ix, iy = np.floor(x).astype(int) % (n - 1), np.floor(y).astype(int) % (n - 1)
    fx, fy = x - np.floor(x), y - np.floor(y)
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = g[iy, ix] * (1 - fx) + g[iy, ix + 1] * fx
    b = g[iy + 1, ix] * (1 - fx) + g[iy + 1, ix + 1] * fx
    return a * (1 - fy) + b * fy


def fbm(S, T, freq, seed, oct=4):
    v, amp, tot = 0.0, 1.0, 0.0
    for o in range(oct):
        v = v + amp * vnoise(S, T, freq * 2 ** o, seed + 17 * o)
        tot += amp
        amp *= 0.5
    return v / tot


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mixc(base, col, a):
    a = np.asarray(a, float)
    if a.ndim:
        a = a[..., None]
    return base * (1 - a) + col * a


# ================================================================== puño (SDF)
def sd_rrect(X, Y, cx, cy, hw, hh, r):
    qx = np.abs(X - cx) - (hw - r)
    qy = np.abs(Y - cy) - (hh - r)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r


def sd_convex(X, Y, pts):
    """SDF (aprox.) de un polígono convexo CCW: máximo de las distancias a las rectas."""
    d = np.full(X.shape, -1e9)
    for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
        ex, ey = bx - ax, by - ay
        L = math.hypot(ex, ey)
        nx, ny = ey / L, -ex / L
        d = np.maximum(d, (X - ax) * nx + (Y - ay) * ny)
    return d


FINGERS = [(-0.36, 0.25), (-0.12, 0.33), (0.12, 0.31), (0.36, 0.23)]
# (ángulo, radio interior, radio exterior deseado, semiancho exterior) en coordenadas del puño
RAYS = [(90, 0.80, 1.25, 0.1), (133, 0.86, 1.45, 0.105), (176, 0.72, 1.20, 0.095),
        (-138, 0.86, 1.40, 0.1), (-42, 0.86, 1.40, 0.1), (0, 0.72, 1.20, 0.095), (47, 0.86, 1.45, 0.105),
        (-90, 0.80, 1.18, 0.075)]
FIST_Y = -0.3   # centra el cuerpo del puño (muñeca incluida) en el centro de los rayos


def fist_alpha(S, T, cx=0.0, cy=0.0, sc=0.43, rot=-18.0, seed=1, lim=0.42):
    """Cobertura (0..1) de la plantilla del puño con rayos en coordenadas de cara."""
    c, s = math.cos(math.radians(-rot)), math.sin(math.radians(-rot))
    dx, dy = (S - cx) / sc, (T - cy) / sc
    X, Y = c * dx - s * dy, s * dx + c * dy
    Yf = Y + FIST_Y
    gap = 0.05
    layers = [sd_rrect(X, Yf, 0.15, -0.70, 0.27, 0.17, 0.05),      # muñeca
              sd_rrect(X, Yf, 0.03, -0.30, 0.47, 0.27, 0.19)]      # palma / dorso
    for fx, top in FINGERS:                                        # dedos doblados
        bot = -0.12
        layers.append(sd_rrect(X, Yf, fx, (top + bot) / 2, 0.105, (top - bot) / 2, 0.1))
    layers.append(sd_rrect(X, Yf, -0.15, -0.20, 0.36, 0.125, 0.12))  # pulgar cruzado
    wob = (vnoise(S, T, 60, seed) - 0.5) * 0.035
    m = np.zeros(X.shape)
    for d in layers:
        d = d + wob
        m = m * sstep(gap - 0.012, gap + 0.012, d)                   # la capa de encima abre hueco
        m = np.maximum(m, sstep(0.012, -0.012, d))
    # rayos: cuñas que apuntan al puño, recortadas para no salirse de la cara
    for ang, r0, r1, hw in RAYS:
        a = math.radians(ang)
        ux, uy = math.cos(a), math.sin(a)
        fxd = c * ux + s * uy      # dirección en la cara (rotación inversa)
        fyd = -s * ux + c * uy
        rmax = lim / (sc * max(abs(fxd), abs(fyd)))
        r1 = min(r1, rmax)
        px, py = -uy, ux
        pts = [(ux * r0 - px * 0.02, uy * r0 - py * 0.02), (ux * r1 - px * hw, uy * r1 - py * hw),
               (ux * r1 + px * hw, uy * r1 + py * hw), (ux * r0 + px * 0.02, uy * r0 + py * 0.02)]
        area = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1]))
        if area < 0:
            pts = pts[::-1]
        d = sd_convex(X, Y, pts) + wob
        m = np.maximum(m, sstep(0.012, -0.012, d))
    # pintura de plantilla algo gastada
    wear = fbm(S, T, 9, seed + 5)
    m = m * (1 - 0.3 * sstep(0.66, 0.8, wear))
    m = m * (0.9 + 0.1 * vnoise(S, T, 90, seed + 9))
    return np.clip(m, 0, 1)


# ================================================================== atlas
def cell_st():
    i = (np.arange(CELL) + 0.5) / CELL
    u = (i - PAD) / (1 - 2 * PAD) - 0.5
    S, T = np.meshgrid(u, u)          # S por columnas, T por filas (fila 0 = abajo)
    return S, T


def kraft_base(S, T, seed, ribs_vertical=True):
    n1 = fbm(S, T, 5, seed)
    n2 = vnoise(S, T, 70, seed + 3)
    col = KRAFT[None, None] * (0.92 + 0.16 * n1[..., None]) * (0.96 + 0.06 * n2[..., None])
    rib = np.sin(2 * math.pi * (S if ribs_vertical else T) / 0.034)
    col = col * (1 + 0.02 * rib[..., None])
    sc = sstep(0.68, 0.82, fbm(S + 3.1, T - 1.7, 4, seed + 11))
    col = mixc(col, KRAFT_D, 0.3 * sc)
    return col


def edges_and_corners(col, S, T, seed, flute=('r', 't', 'b')):
    """Oscurece bordes y esquinas (abolladas) y pinta el canto ondulado en los bordes `flute`
    (r/l/t/b). Cada arista del cubo lleva la franja en una sola de sus dos caras."""
    dist = 0.5 - np.maximum(np.abs(S), np.abs(T))
    col = col * (0.8 + 0.2 * sstep(0.0, 0.10, dist))[..., None]
    cd = np.hypot(0.5 - np.abs(S), 0.5 - np.abs(T))
    wc = 1 - sstep(0.05, 0.22, cd)
    crease = np.abs(np.sin((np.arctan2(0.5 - np.abs(T), 0.5 - np.abs(S)) * 7
                            + vnoise(S, T, 30, seed) * 5)))
    col = col * (1 - 0.14 * wc * sstep(0.75, 1.0, crease))[..., None]
    borders = {'r': (0.5 - S, T), 'l': (0.5 + S, T), 't': (0.5 - T, S), 'b': (0.5 + T, S)}
    for k in flute:
        y, x = borders[k]
        y01 = y / BW
        wave = 0.5 + 0.25 * np.sin(2 * math.pi * x / 0.042)
        band = np.zeros(S.shape + (3,)) + GAP
        band = mixc(band, WAVE, sstep(0.17, 0.10, np.abs(y01 - wave)))
        band = mixc(band, KRAFT * 0.78, sstep(0.16, 0.1, y01))         # cara interior del cartón
        band = mixc(band, KRAFT * 0.9, sstep(0.8, 0.88, y01))          # cara exterior
        col = mixc(col, band, sstep(1.04, 0.96, y01))
    return col


def tape(col, S, T, mask, seed, along_s=True):
    """Cinta de embalar marrón, casi opaca, con brillos a lo largo."""
    perp = T if along_s else S
    along = S if along_s else T
    n = vnoise(S, T, 30, seed)
    tcol = col * 0.22 + TAPE * 0.78
    tcol = tcol * (0.95 + 0.08 * n[..., None])
    hi = sstep(0.85, 1.0, np.sin(2 * math.pi * (perp * 9 + vnoise(S, T, 3, seed + 2) * 0.5)))
    hi = hi * sstep(0.35, 0.65, vnoise(S, T, 7, seed + 3))
    hi = np.maximum(hi, 0.6 * sstep(0.75, 0.95, vnoise(along * 3, perp * 60, 6, seed + 6)))
    tcol = mixc(tcol, TAPE_HI, 0.28 * hi)
    return mixc(col, tcol, mask)


def band_mask(D, hw, S, T, seed):
    """Máscara de una tira de cinta: D = distancia al eje de la tira."""
    rag = (vnoise(S, T, 55, seed) - 0.5) * 0.006
    return sstep(hw + 0.002, hw - 0.002, np.abs(D) + rag)


FIST = dict(cx=0.0, cy=0.0, sc=0.40, rot=-18)


def side_cell(seed, tab):
    S, T = cell_st()
    col = kraft_base(S, T, seed, True)
    a = fist_alpha(S, T, seed=seed, **FIST)
    col = mixc(col, PAINT, a * 0.96)
    if tab:
        # lengüeta de cinta que baja de la tapa, con el extremo rasgado en dientes
        end = 0.5 - 0.24 + (np.abs(((S * 45) % 2) - 1) - 0.5) * 0.016
        bm = band_mask(S, 0.105, S, T, seed + 1)
        m = bm * sstep(end - 0.003, end + 0.003, T)
        col = tape(col, S, T, m * 0.95, seed + 4, along_s=False)
        col = mixc(col, col * 0.72, sstep(0.005, 0.0, np.abs(T - end)) * bm * 0.7)
        col = mixc(col, col * 0.8, sstep(0.004, 0.0, np.abs(np.abs(S) - 0.105)) * (T > end) * 0.6)
    col = edges_and_corners(col, S, T, seed + 7)
    return col


def top_cell(seed):
    S, T = cell_st()
    col = kraft_base(S, T, seed, False)
    a = fist_alpha(S, T, seed=seed, **FIST)
    col = mixc(col, PAINT, a * 0.96)
    m1 = band_mask(T, 0.105, S, T, seed + 1)
    m2 = band_mask(S, 0.105, S, T, seed + 2)
    col = tape(col, S, T, m1 * 0.95, seed + 4, along_s=True)
    col = mixc(col, col * 0.78, sstep(0.004, 0.0, np.abs(np.abs(T) - 0.105)) * 0.6)
    col = tape(col, S, T, m2 * 0.95, seed + 5, along_s=False)
    col = mixc(col, col * 0.72, sstep(0.005, 0.0, np.abs(np.abs(S) - 0.105)) * 0.6)
    col = edges_and_corners(col, S, T, seed + 7, flute=())
    return col


def d_cell(seed):
    S, T = cell_st()
    col = np.zeros(S.shape + (3,))
    iy = np.arange(CELL)[:, None] * np.ones((1, CELL))
    # cartón interior (dorso de los trozos)
    n = fbm(S, T, 6, seed)
    inner = KRAFT_IN[None, None] * (0.9 + 0.15 * n[..., None])
    inner = inner * (1 + 0.03 * np.sin(2 * math.pi * S / 0.034))[..., None]
    col[:] = inner
    # tira del canto ondulado: filas STRIP_ROWS, frente arriba
    r0, r1 = STRIP_ROWS
    y01 = (iy + 0.5 - r0) / (r1 - r0)             # 0 = dorso, 1 = frente
    x = (np.arange(CELL)[None, :] + 0.5) / CELL * STRIP_LEN
    wave = 0.5 + 0.3 * np.sin(2 * math.pi * x / 0.022)
    st = np.zeros(S.shape + (3,)) + GAP
    st = mixc(st, WAVE, sstep(0.12, 0.06, np.abs(y01 - wave)))
    st = mixc(st, KRAFT_IN * 0.95, sstep(0.17, 0.12, y01))
    st = mixc(st, KRAFT * 0.95, sstep(0.83, 0.88, y01))
    st = st * (0.9 + 0.12 * vnoise(S, T, 50, seed + 1))[..., None]
    inside = (iy >= r0 - 3) & (iy < r1 + 3)
    col[inside] = st[inside]
    return col


def build_atlas():
    img = np.zeros((TEX, TEX, 3))
    img[0:CELL, 0:CELL] = side_cell(3, True)
    img[0:CELL, CELL:] = side_cell(8, False)
    img[CELL:, 0:CELL] = top_cell(13)
    img[CELL:, CELL:] = d_cell(21)
    img = np.clip(img, 0, 1)
    os.makedirs(TMP, exist_ok=True)
    path = os.path.join(TMP, 'carton_atlas.jpg')
    im = bpy.data.images.new('carton_atlas_tmp', TEX, TEX, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'Non-Color'
    px = np.ones((TEX, TEX, 4), np.float32)
    px[..., :3] = img
    im.pixels.foreach_set(px.ravel())
    im.file_format = 'JPEG'
    im.filepath_raw = path
    im.save(filepath=path, quality=86)
    bpy.data.images.remove(im)
    print(f'ATLAS {path}: {os.path.getsize(path) / 1024:.0f} KB')
    return path


def cell_uv(cell, s, t):
    col, row = {'A': (0, 0), 'B': (1, 0), 'C': (0, 1), 'D': (1, 1)}[cell]
    return ((col + PAD + (1 - 2 * PAD) * (s + 0.5)) * 0.5, (row + PAD + (1 - 2 * PAD) * (t + 0.5)) * 0.5)


def inner_uv(s, t):
    r0, r1 = INNER_ROWS
    return (0.5 + (0.04 + 0.92 * (s + 0.5)) * 0.5, 0.5 + (r0 + (r1 - r0) * (t + 0.5)) / TEX)


def strip_uv(a, front):
    r0, r1 = STRIP_ROWS
    return (0.5 + (a / STRIP_LEN) * (1 - 2 * PAD) * 0.5 + PAD * 0.5, 0.5 + ((r1 if front else r0) + 0.5) / TEX)


# ================================================================== material
def make_material(path):
    m = bpy.data.materials.new('carton')
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.image.colorspace_settings.name = 'sRGB'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.86
    m.use_backface_culling = True
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs:
            b.inputs[k].default_value = 0.3
            break
    return m


# ================================================================== caras del cubo
# (normal, derecha, arriba, celda): q = n*0,5 + e1*s + e2*t   (Blender, Z arriba)
FACES = [((0, -1, 0), (1, 0, 0), (0, 0, 1), 'A'),     # glTF +Z (frontal), con cinta
         ((1, 0, 0), (0, 1, 0), (0, 0, 1), 'A'),      # glTF +X, con cinta
         ((0, 1, 0), (-1, 0, 0), (0, 0, 1), 'B'),
         ((-1, 0, 0), (0, -1, 0), (0, 0, 1), 'B'),
         ((0, 0, 1), (1, 0, 0), (0, 1, 0), 'C'),      # tapa
         ((0, 0, -1), (1, 0, 0), (0, -1, 0), 'B')]    # base
GRID = [-0.5, -0.465, -0.43, -0.34, -0.23, -0.11, 0.0, 0.11, 0.23, 0.34, 0.43, 0.465, 0.5]


def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def box_point(q):
    q = Vector(q)
    inner = Vector([max(-HIN, min(HIN, c)) for c in q])
    d = q - inner
    nrm = d.normalized()
    p = inner + nrm * R
    m = sorted([max(0.0, abs(c) - HIN) / R for c in q], reverse=True)
    groove = smooth01(0.45, 1.0, m[1])
    ax = sorted(range(3), key=lambda i: -abs(q[i]))
    a, b = q[ax[1]], q[ax[2]]
    sag = (1 - (2 * a) ** 2) * (1 - (2 * b) ** 2)
    cd = min((q - Vector((sx * .5, sy * .5, sz * .5))).length
             for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1))
    corner = max(0.0, 1 - cd / 0.34) ** 1.5
    n1 = mnoise.noise(q * 6.0 + Vector((1.3, 2.1, 0.4)))
    n2 = mnoise.noise(q * 15.0 + Vector((4.2, 0.3, 7.7)))
    e = 0.5 - abs(a)                                   # distancia a la arista más cercana
    rim = math.exp(-((e - 0.07) / 0.045) ** 2)          # reborde abombado junto a la arista
    off = (-0.013 * groove - 0.008 * sag + 0.011 * rim + 0.0025 * n1
           + corner * (0.010 + 0.03 * n2))
    tang = mnoise.noise_vector(q * 11.0 + Vector((2.0, 5.0, 1.0))) * (0.016 * corner)
    return p + nrm * off + tang


def build_box(mat):
    verts, faces, uvs = [], [], []
    for n, e1, e2, cell in FACES:
        n, e1, e2 = Vector(n), Vector(e1), Vector(e2)
        base = len(verts)
        N = len(GRID)
        for t in GRID:
            for s in GRID:
                verts.append(box_point(n * 0.5 + e1 * s + e2 * t))
        for j in range(N - 1):
            for i in range(N - 1):
                ids = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                faces.append([base + jj * N + ii for ii, jj in ids])
                uvs.append([cell_uv(cell, GRID[ii], GRID[jj]) for ii, jj in ids])
    me = bpy.data.meshes.new('box_carton')
    me.from_pydata([tuple(v) for v in verts], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for poly, fu in zip(me.polygons, uvs):
        for li, uv in zip(poly.loop_indices, fu):
            uvl.data[li].uv = uv
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY')
    # las esquinas abolladas sobresalen un pelín: reescalar para que quepa justo en -0,5..0,5
    for i in range(3):
        k = 0.5 / max(abs(v.co[i]) for v in bm.verts)
        for v in bm.verts:
            v.co[i] *= k
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new('box_carton', me)
    bpy.context.scene.collection.objects.link(ob)
    lib.shade(ob, True)
    return ob


# ================================================================== trozos
def jag(p0, p1, rng, step=0.075, amp=0.03):
    p0, p1 = np.array(p0, float), np.array(p1, float)
    L = np.linalg.norm(p1 - p0)
    n = max(2, int(round(L / step)))
    d = (p1 - p0) / L
    perp = np.array([-d[1], d[0]])
    pts = [tuple(p0)]
    sgn = 1
    for k in range(1, n):
        o = sgn * amp * rng.uniform(0.35, 1.0)
        sgn = -sgn if rng.random() < 0.8 else sgn
        pts.append(tuple(p0 + (p1 - p0) * (k / n) + perp * o))
    pts.append(tuple(p1))
    return pts


def insert_at_v(line, v):
    """Inserta en la polilínea (v creciente) el punto de altura v. Devuelve (línea, índice)."""
    for i in range(len(line) - 1):
        (ua, va), (ub, vb) = line[i], line[i + 1]
        if va <= v <= vb:
            t = (v - va) / (vb - va) if vb != va else 0
            p = (ua + (ub - ua) * t, v)
            return line[:i + 1] + [p] + line[i + 1:], i + 1
    raise ValueError('altura fuera de la línea')


def column_pieces(A, B, h, rng):
    """Polígonos (CCW) de la columna entre las líneas A y B; h = altura del corte o None."""
    if h is None:
        return [[A[0]] + B + A[:0:-1]]
    A2, ka = insert_at_v(A, h + rng.uniform(-0.03, 0.03))
    B2, kb = insert_at_v(B, h + rng.uniform(-0.03, 0.03))
    H = jag(A2[ka], B2[kb], rng, 0.07, 0.035)
    H[0], H[-1] = A2[ka], B2[kb]
    low = [A2[0]] + B2[:kb + 1] + H[-2:0:-1] + A2[ka:0:-1]
    up = H[:] + B2[kb + 1:] + A2[:ka:-1]
    return [low, up]


def resample(poly, maxlen=0.09, wrap=True):
    out = []
    n = len(poly)
    for i in range(n):
        a, b = np.array(poly[i]), np.array(poly[(i + 1) % n])
        cuts = [0.0]
        if wrap:   # cruces con las aristas verticales (u entero)
            lo, hi = sorted((a[0], b[0]))
            for k in range(math.floor(lo) + 1, math.ceil(hi)):
                if lo < k < hi:
                    cuts.append((k - a[0]) / (b[0] - a[0]))
        L = np.linalg.norm(b - a)
        m = max(1, int(math.ceil(L / maxlen)))
        cuts += [j / m for j in range(1, m)]
        cuts = sorted(set(round(c, 9) for c in cuts))
        for c in cuts:
            p = a + (b - a) * c
            if wrap and abs(p[0] - round(p[0])) < 1e-7:
                p[0] = round(p[0])
            out.append((float(p[0]), float(p[1])))
    ded = []
    for p in out:
        if not ded or math.dist(ded[-1], p) > 1e-7:
            ded.append(p)
    if math.dist(ded[0], ded[-1]) < 1e-7:
        ded.pop()
    return ded


def clip_strip(poly, k):
    """Sutherland-Hodgman contra k <= u <= k+1."""
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev):
                    out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev):
                out.append(inter(prev, cur))
        return out

    def ix(x):
        def f(a, b):
            t = (x - a[0]) / (b[0] - a[0])
            return (float(x), a[1] + (b[1] - a[1]) * t)
        return f
    p = clip(poly, lambda q: q[0] >= k - 1e-9, ix(k))
    if p:
        p = clip(p, lambda q: q[0] <= k + 1 + 1e-9, ix(k + 1))
    ded = []
    for q in p:
        if not ded or math.dist(ded[-1], q) > 1e-7:
            ded.append(q)
    if len(ded) > 1 and math.dist(ded[0], ded[-1]) < 1e-7:
        ded.pop()
    return ded if len(ded) >= 3 else None


def shard_mesh(name, poly, domain, mat):
    """domain: 'side' (u da la vuelta a las 4 caras laterales) o índice de FACES (tapa/base)."""
    poly = resample(poly, wrap=(domain == 'side'))
    vid, V, faces, fuv = {}, [], [], []

    def faces_of(u):
        if domain != 'side':
            return [domain]
        if abs(u - round(u)) < 1e-7:
            k = int(round(u))
            return [(k - 1) % 4, k % 4]
        return [math.floor(u) % 4]

    def pos(u, v):
        if domain == 'side':
            k = math.floor(u)
            n, e1, e2, _ = FACES[k % 4]
            s = u - k - 0.5
        else:
            n, e1, e2, _ = FACES[domain]
            s = u
        return Vector(n) * 0.5 + Vector(e1) * s + Vector(e2) * v

    def vert(p, back):
        key = (round(p[0], 6), round(p[1], 6), back)
        if key not in vid:
            q = pos(*p)
            if back:
                nsum = sum((Vector(FACES[f][0]) for f in faces_of(p[0])), Vector())
                q = q - nsum * TH
            vid[key] = len(V)
            V.append(q)
        return vid[key]

    subs = []
    if domain == 'side':
        lo = math.floor(min(p[0] for p in poly))
        hi = math.ceil(max(p[0] for p in poly))
        for k in range(lo, hi):
            sp = clip_strip(poly, k)
            if sp:
                subs.append((k, sp))
    else:
        subs.append((0, poly))
    for k, sp in subs:
        cell = FACES[k % 4][3] if domain == 'side' else FACES[domain][3]
        loc = [((p[0] - k - 0.5) if domain == 'side' else p[0], p[1]) for p in sp]
        faces.append([vert(p, False) for p in sp])
        fuv.append([cell_uv(cell, s, t) for s, t in loc])
        faces.append([vert(p, True) for p in sp][::-1])
        fuv.append([inner_uv(s, t) for s, t in loc][::-1])
    # cantos
    rng = np.random.default_rng(len(poly) * 7 + len(name))
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        L = math.dist(a, b)
        a0 = rng.uniform(0, STRIP_LEN - L)
        faces.append([vert(a, False), vert(a, True), vert(b, True), vert(b, False)])
        fuv.append([strip_uv(a0, True), strip_uv(a0, False), strip_uv(a0 + L, False), strip_uv(a0 + L, True)])
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in V], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for poly_, fu in zip(me.polygons, fuv):
        for li, uv in zip(poly_.loop_indices, fu):
            uvl.data[li].uv = uv
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method='BEAUTY', ngon_method='EAR_CLIP')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # origen en el centro del trozo
    c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    me.transform(__import__('mathutils').Matrix.Translation(-c))
    ob.location = c
    lib.shade(ob, False)
    return ob


def build_shards(mat):
    rng = np.random.default_rng(7)
    polys = []
    # 4 caras laterales desplegadas en u ∈ [0, 4): 4 columnas que doblan una arista vertical
    cu = [0.36, 1.32, 2.42, 3.30]
    cuts = [jag((u + rng.uniform(-0.04, 0.04), -0.5), (u + rng.uniform(-0.04, 0.04), 0.5), rng) for u in cu]
    cuts.append([(u + 4, v) for u, v in cuts[0]])
    hs = [0.06, -0.14, 0.12, -0.06]
    for i in range(4):
        for p in column_pieces(cuts[i], cuts[i + 1], hs[i], rng):
            polys.append((p, 'side'))
    # tapa (índice 4): corte casi vertical + corte horizontal en la mitad derecha
    L = [(-0.5, -0.5), (-0.5, 0.5)]
    Rr = [(0.5, -0.5), (0.5, 0.5)]
    V = jag((0.05, -0.5), (0.13, 0.5), rng)
    polys.append((column_pieces(L, V, None, rng)[0], 4))
    for p in column_pieces(V, Rr, -0.1, rng):
        polys.append((p, 4))
    # base (índice 5): dos trozos
    Vb = jag((-0.08, -0.5), (0.02, 0.5), rng)
    polys.append((column_pieces(L, Vb, None, rng)[0], 5))
    polys.append((column_pieces(Vb, Rr, None, rng)[0], 5))

    root = bpy.data.objects.new('carton_shards', None)
    bpy.context.scene.collection.objects.link(root)
    shards = []
    for i, (p, dom) in enumerate(polys):
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(p, p[1:] + p[:1]))
        if area < 0:
            p = p[::-1]
        ob = shard_mesh(f'carton_shard_{i:02d}', p, dom, mat)
        ob.parent = root
        shards.append(ob)
    return root, shards


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ================================================================== exportar
def export(objs, filename):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    path = os.path.join(KIT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
        export_image_format='AUTO', export_cameras=False, export_lights=False, export_extras=False,
        export_animations=False)
    print(f'EXPORT {filename}: {os.path.getsize(path) / 1024:.1f} KB')
    return path


# ================================================================== vistas previas
def setup_render(w, h):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    for vt in ('Khronos PBR Neutral', 'AgX', 'Standard'):
        try:
            sc.view_settings.view_transform = vt
            break
        except Exception:
            continue
    for k, v in (('taa_render_samples', 48), ('use_shadows', True), ('use_raytracing', True)):
        try:
            setattr(sc.eevee, k, v)
        except Exception:
            pass
    world = bpy.data.worlds.get('W') or bpy.data.worlds.new('W')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*lib.hexc('#f2efe9'), 1)
    bg.inputs['Strength'].default_value = 0.9


TEMP = []


def temp(o):
    TEMP.append(o)
    return o


def clear_temp():
    for o in TEMP:
        try:
            bpy.data.objects.remove(o)
        except ReferenceError:
            pass
    TEMP.clear()


def add_ground(z=-0.5):
    me = bpy.data.meshes.new('ground')
    s = 30
    me.from_pydata([(-s, -s, z), (s, -s, z), (s, s, z), (-s, s, z)], [], [(0, 1, 2, 3)])
    m = bpy.data.materials.get('groundm') or lib.material('groundm', lib.hexc('#f4f1ec'), rough=0.9)
    me.materials.append(m)
    ob = bpy.data.objects.new('ground', me)
    bpy.context.scene.collection.objects.link(ob)
    return temp(ob)


def add_sun(direction, energy=4.0):
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = energy
    sun.angle = math.radians(6)
    ob = bpy.data.objects.new('Sun', sun)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_euler = (-Vector(direction).normalized()).to_track_quat('-Z', 'Y').to_euler()
    return temp(ob)


def add_cam(loc, target, lens=50):
    cam = bpy.data.cameras.new('Cam')
    cam.lens = lens
    ob = bpy.data.objects.new('Cam', cam)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = ob
    return temp(ob)


def render(name):
    os.makedirs(PREV, exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(PREV, name)
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', sc.render.filepath)


def load_kit_block():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT, 'boxes_kit.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    alb = bpy.data.images.load(os.path.join(KIT, 'stone_albedo.jpg'), check_existing=True)
    stone = lib.material('kit_stone_prev', rough=0.8)
    nt = stone.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = alb
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    rune = lib.material('kit_rune_prev', lib.hexc('#ff3a2a'), emit=lib.hexc('#ff3a2a'), emit_strength=3)
    block = None
    for o in new:
        if o.type == 'MESH':
            for i, ms in enumerate(o.data.materials):
                o.data.materials[i] = rune if (ms and 'rune' in ms.name.lower()) else stone
        if o.name.startswith('box_block') and o.type == 'MESH':
            block = o
    for o in new:
        o.hide_render = True
    return block


def dup(src, loc, rot=(0, 0, 0)):
    o = src.copy()
    bpy.context.scene.collection.objects.link(o)
    o.parent = None
    o.hide_render = False
    o.location = loc
    o.rotation_euler = rot
    return temp(o)


def previews(box, shards, tag=''):
    setup_render(768, 768)
    box.hide_render = True
    for s in shards:
        s.hide_render = True
    # 1) 3/4 del cubo
    add_ground()
    add_sun((0.55, -0.8, 1.2), 4.0)
    dup(box, (0, 0, 0))
    add_cam((2.3, -3.0, 1.9), (0, 0, -0.02), 50)
    render(f'carton_34{tag}.png')
    add_cam((0.0, -3.3, 2.6), (0, 0, 0), 50)
    render(f'carton_frente_arriba{tag}.png')
    clear_temp()
    # 2) junto a los bloques de piedra del kit
    setup_render(1280, 640)
    block = load_kit_block()
    add_ground()
    add_sun((0.55, -0.8, 1.2), 4.0)
    for x in (-2.3, -1.15, 1.15, 2.3):
        if block is not None:
            dup(block, (x, 0, 0))
    dup(box, (0, 0, 0))
    add_cam((2.2, -6.2, 2.6), (0, 0, 0), 50)
    render(f'carton_fila{tag}.png')
    clear_temp()
    # 3) trozos "explotados"
    setup_render(1024, 768)
    add_ground(-1.2)
    add_sun((0.55, -0.8, 1.2), 4.0)
    rng = np.random.default_rng(3)
    for s in shards:
        c = s.matrix_world.translation.copy()
        d = c.normalized() if c.length > 1e-6 else Vector((0, 0, 1))
        loc = c + d * (0.55 + 0.25 * rng.random()) + Vector((0, 0, 0.15))
        dup(s, loc, tuple(rng.uniform(-0.6, 0.6, 3)))
    add_cam((2.4, -3.6, 1.8), (0, 0, 0.05), 42)
    render(f'carton_trozos{tag}.png')
    clear_temp()
    # 4) trozos en su sitio (debe verse el cubo entero)
    setup_render(768, 768)
    add_ground()
    add_sun((0.55, -0.8, 1.2), 4.0)
    for s in shards:
        dup(s, s.matrix_world.translation.copy())
    add_cam((2.3, -3.0, 1.9), (0, 0, -0.02), 50)
    render(f'carton_trozos_montados{tag}.png')
    clear_temp()


def main():
    lib.reset()
    os.makedirs(KIT, exist_ok=True)
    path = build_atlas()
    mat = make_material(path)
    box = build_box(mat)
    root, shards = build_shards(mat)
    print(f'box_carton: {tris(box)} tris')
    tot = 0
    for s in shards:
        tot += tris(s)
        print(f'  {s.name}: {tris(s)} tris  centro {tuple(round(c, 3) for c in s.location)}')
    print(f'carton_shards: {len(shards)} trozos, {tot} tris')
    export([box, root] + shards, 'carton.glb')
    if '--no-preview' not in ARGS:
        previews(box, shards, '')


main()
