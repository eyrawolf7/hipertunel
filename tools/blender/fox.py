"""Protagonista del modo en tercera persona: zorro aventurero sobre una tabla flotante con forma de hoja.

    blender --background --python tools/blender/fox.py                 # modelo + animaciones + vistas previas
    blender --background --python tools/blender/fox.py -- --no-preview # sin renders
    blender --background --python tools/blender/fox.py -- --static     # solo el modelo (vistas fijas, sin exportar)

Genera app/src/assets/fox.glb: una malla con piel (4 materiales), esqueleto de 34 huesos y 8 animaciones
(ride, leanL, leanR, jump, land, boost, hit, smash) a 30 fps.

Ejes (Blender): Z arriba, el zorro mira hacia +Y, su derecha es +X. En el GLB (Y arriba) mira hacia −Z,
su derecha sigue siendo +X. Origen en el centro de la tabla; la base de la tabla en y=0.

Todo es geometría procedural con semillas fijas: mismo script -> mismo GLB. Los pesos de la piel se calculan
aquí (por proximidad a los huesos o por parámetro a lo largo de cada pieza), sin pesos automáticos de Blender.
Las piernas se animan con IK (pies clavados a la tabla) y se hornean a FK antes de exportar.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from bisect import bisect_right

from mathutils import Vector, Matrix, Euler
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import hexc, mix, smoothstep, catmull  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--no-preview' not in ARGS
STATIC = '--static' in ARGS
PREV_DIR = os.path.join(lib.PREVIEWS, 'fox')
OUT = os.path.join(lib.ASSETS, 'fox.glb')

V = Vector
TAU = 2 * math.pi
FPS = 30
Z0 = 0.13  # altura de la cara superior de la hoja (donde pisan las botas)


def P(x, y, z):
    return V((x, y, Z0 + z))


SIDES = (('L', -1), ('R', 1))  # izquierda del zorro = −X

COL = {k: hexc(v) for k, v in dict(
    orange='#ee7424', orange_l='#f89237', orange_d='#c95417', cream='#fcebcb', cream_d='#ecd0a6',
    ear_in='#d9ab86', ear_deep='#b27a57', ear_tip='#3b1e14', brow='#46231a', dark='#1d120e', white='#ffffff',
    sclera='#fffdf8', iris='#8a4516', iris_d='#3d1b0b', iris_l='#c8772c', lash='#28160f',
    shirt='#f2e5c7', shirt_d='#dccaa5', vest='#80502e', vest_d='#5b3520', vest_l='#9a6a3e',
    leather='#4a2b1a', glove='#5d3421', olive='#717038', olive_l='#8b8a4a', olive_d='#57562b',
    boot='#6e4024', boot_l='#8f5932', sole='#35200f', sock='#fff2dc',
    scarf='#5aa133', scarf_d='#437c26', scarf_p='#d3d65e',
    leaf='#5fae38', leaf_d='#3b7d2a', leaf_l='#98d35a', leaf_vein='#b6e27a', leaf_edge='#b9c843',
    stone='#dcc89c', stone_d='#a88d64', stone_l='#ecdcb8', vine='#46822b', vine_l='#79b843',
    nose='#221411', leafdeco='#6fb13d', fur_c='#f7dfb8').items()}

MAT_ORDER = ['fox', 'gloss', 'gold', 'crystal']
MATS = {}


def make_materials():
    MATS['fox'] = lib.material('fox', (1, 1, 1), rough=0.8, vcol=True)
    MATS['gloss'] = lib.material('gloss', (1, 1, 1), rough=0.2, vcol=True)
    MATS['gold'] = lib.material('gold', hexc('#e8b04a'), rough=0.33, metal=0.6)
    MATS['crystal'] = lib.material('crystal', hexc('#8ffcf0'), rough=0.15, emit=hexc('#3ff5e0'), emit_strength=2.2)


# =================================================================== esqueleto (posiciones de reposo)
BONES = {}  # nombre -> [cabeza, cola, padre, deforma]


def bone(n, h, t, parent, deform=True):
    BONES[n] = [V(h), V(t), parent, deform]


HC = P(0, 0.012, 0.80)          # centro de la cabeza
HR = 0.17                       # radio de la cabeza
HS = V((1.07, 0.96, 0.93))      # escala de la cabeza
EAR_L = 0.28


def ear_frame(s):
    d = V((s * 0.50, -0.12, 0.86)).normalized()
    base = HC + V((d.x * HS.x, d.y * HS.y, d.z * HS.z)) * HR * 0.80
    A = V((s * 0.36, -0.14, 1.0)).normalized()
    F = (V((0, 1, 0)) - A * A.y).normalized()
    S = F.cross(A)
    return base, A, F, S


def ear_point(s, t):
    base, A, F, S = ear_frame(s)
    return base + A * EAR_L * t - F * 0.035 * t * t


def arm_dir(s):
    return V((s * 0.72, 0.06, -0.69)).normalized()


def SH(s):
    return P(s * 0.105, 0.0, 0.575)


def HIP(s):
    return P(s * 0.065, 0.0, 0.37)


def KNEE(s):
    return P(s * 0.07, 0.016, 0.215)


def ANK(s):
    return P(s * 0.072, 0.0, 0.07)


def TOE(s):
    return P(s * 0.072, 0.09, 0.02)


TP = [P(0, -0.085, 0.37), P(0, -0.18, 0.335), P(0, -0.295, 0.325), P(0, -0.405, 0.35), P(0, -0.50, 0.40),
      P(0, -0.575, 0.47)]


def SO(s):
    return P(s * 0.045, -0.075, 0.605)


def SD(s):
    return V((s * 0.5, -0.8, -0.3)).normalized()


SCARF_LEN = 0.33


def build_bones():
    bone('root', (0, 0, 0), (0, 0.2, 0), None)
    bone('board', (0, 0, 0.07), (0, 0.25, 0.07), 'root')
    bone('hips', P(0, 0, 0.37), P(0, 0, 0.45), 'root')
    bone('spine1', P(0, 0, 0.45), P(0, 0, 0.52), 'hips')
    bone('spine2', P(0, 0, 0.52), P(0, 0, 0.60), 'spine1')
    bone('neck', P(0, 0, 0.60), P(0, 0.006, 0.645), 'spine2')
    bone('head', P(0, 0.006, 0.645), P(0, 0.006, 0.98), 'neck')
    for sn, s in SIDES:
        bone(f'ear_1_{sn}', ear_point(s, 0.08), ear_point(s, 0.5), 'head')
        bone(f'ear_2_{sn}', ear_point(s, 0.5), ear_point(s, 1.0), f'ear_1_{sn}')
    for sn, s in SIDES:
        d = arm_dir(s)
        el = SH(s) + d * 0.12
        wr = el + d * 0.11
        bone(f'shoulder_{sn}', P(s * 0.03, 0, 0.575), SH(s), 'spine2')
        bone(f'upperarm_{sn}', SH(s), el, f'shoulder_{sn}')
        bone(f'forearm_{sn}', el, wr, f'upperarm_{sn}')
        bone(f'hand_{sn}', wr, wr + d * 0.065, f'forearm_{sn}')
    for sn, s in SIDES:
        bone(f'thigh_{sn}', HIP(s), KNEE(s), 'hips')
        bone(f'shin_{sn}', KNEE(s), ANK(s), f'thigh_{sn}')
        bone(f'foot_{sn}', ANK(s), TOE(s), f'shin_{sn}')
    for i in range(5):
        bone(f'tail_{i + 1}', TP[i], TP[i + 1], 'hips' if i == 0 else f'tail_{i}')
    for sn, s in SIDES:
        o, d = SO(s), SD(s)
        bone(f'scarf_1_{sn}', o, o + d * SCARF_LEN * 0.5, 'spine2')
        bone(f'scarf_2_{sn}', o + d * SCARF_LEN * 0.5, o + d * SCARF_LEN, f'scarf_1_{sn}')
    # auxiliares de IK (no se exportan)
    for sn, s in SIDES:
        bone(f'ik_foot_{sn}', ANK(s), TOE(s), 'board', False)
        bone(f'pole_{sn}', P(s * 0.10, 0.5, 0.22), P(s * 0.10, 0.5, 0.27), 'root', False)


# =================================================================== acumulador de geometría
class Rig:
    def __init__(self):
        self.V, self.F, self.FM, self.FS, self.C, self.W = [], [], [], [], [], []

    def add(self, verts, faces, col, w, mat='fox', smooth=True):
        o = len(self.V)
        for i, p in enumerate(verts):
            p = V(p)
            self.V.append(p)
            c = col(p, i) if callable(col) else (col[i] if isinstance(col, list) else col)
            self.C.append(tuple(c))
            ww = w(p, i) if callable(w) else (w[i] if isinstance(w, list) else {w: 1.0})
            self.W.append(ww)
        for f in faces:
            self.F.append(tuple(k + o for k in f))
            self.FM.append(mat)
            self.FS.append(smooth)

    def add_flat(self, verts, faces, fcol, w, mat='fox'):
        """Caras planas: duplica vértices por cara. fcol(centro, normal, índice) -> RGB (o RGB fijo)."""
        nv, nf, nc = [], [], []
        for fi, f in enumerate(faces):
            pts = [V(verts[k]) for k in f]
            cen = sum(pts, V()) / len(pts)
            nor = (pts[1] - pts[0]).cross(pts[2] - pts[0])
            nor = nor.normalized() if nor.length > 1e-12 else V((0, 0, 1))
            c = fcol(cen, nor, fi) if callable(fcol) else fcol
            base = len(nv)
            nv += pts
            nc += [c] * len(pts)
            nf.append(tuple(range(base, base + len(pts))))
        self.add(nv, nf, nc, w, mat, smooth=False)

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


# =================================================================== pesos
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def nrm(ws, k=4):
    it = sorted(ws.items(), key=lambda kv: -kv[1])[:k]
    tot = sum(w for _, w in it) or 1.0
    out = {n: w / tot for n, w in it if w / tot > 0.02}
    tot = sum(out.values())
    return {n: w / tot for n, w in out.items()}


def prox(names, power=4.0):
    segs = [(n, BONES[n][0], BONES[n][1]) for n in names]

    def f(p, *_):
        return nrm({n: (1.0 / (seg_dist(p, h, t) + 0.006)) ** power for n, h, t in segs})
    return f


def blend(t, keys):
    if t <= keys[0][0]:
        return {keys[0][1]: 1.0}
    for (t0, b0), (t1, b1) in zip(keys, keys[1:]):
        if t <= t1:
            k = smoothstep(t0, t1, t)
            d = {}
            d[b0] = d.get(b0, 0) + 1 - k
            d[b1] = d.get(b1, 0) + k
            return nrm(d)
    return {keys[-1][1]: 1.0}


# =================================================================== primitivas
def tube(path, rfun, sides=8, cap0=True, cap1=True, tip=0.0, n0=None, frames=None):
    """Tubo con transporte paralelo. rfun(t, a) -> radio o (radio_N, radio_B). Devuelve verts, faces, params.
    params[i] = (t, a) (los polos llevan a=None)."""
    path = [V(p) for p in path]
    n = len(path)
    T = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + (path[i] - path[i - 1]).length)
    tot = L[-1] or 1.0
    if frames is None:
        if n0 is None:
            N, _ = lib.frame(T[0])
        else:
            N = (V(n0) - T[0] * V(n0).dot(T[0])).normalized()
        frames = []
        for i in range(n):
            if i:
                ax = T[i - 1].cross(T[i])
                if ax.length > 1e-7:
                    N = Matrix.Rotation(T[i - 1].angle(T[i]), 3, ax.normalized()) @ N
            N = (N - T[i] * N.dot(T[i])).normalized()
            frames.append((N.copy(), T[i].cross(N)))
    verts, faces, params = [], [], []
    for i in range(n):
        N, B = frames[i]
        t = L[i] / tot
        for j in range(sides):
            a = TAU * j / sides
            r = rfun(t, a)
            rn, rb = (r, r) if not isinstance(r, tuple) else r
            verts.append(path[i] + N * (math.cos(a) * rn) + B * (math.sin(a) * rb))
            params.append((t, a))
    for i in range(n - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            faces.append((i * sides + j, i * sides + j2, (i + 1) * sides + j2, (i + 1) * sides + j))
    if cap0:
        r0 = rfun(0.0, 0.0)
        r0 = r0[0] if isinstance(r0, tuple) else r0
        c = len(verts)
        verts.append(path[0] - T[0] * r0 * 0.45)
        params.append((0.0, None))
        for j in range(sides):
            faces.append((c, (j + 1) % sides, j))
    last = (n - 1) * sides
    if cap1 or tip > 0:
        r1 = rfun(1.0, 0.0)
        r1 = r1[0] if isinstance(r1, tuple) else r1
        c = len(verts)
        verts.append(path[-1] + T[-1] * (tip if tip > 0 else r1 * 0.45))
        params.append((1.0, None))
        for j in range(sides):
            faces.append((last + j, last + (j + 1) % sides, c))
    return verts, faces, params


def ell(center, radii, seg=16, rings=10, R=None, deform=None):
    """Elipsoide: polo en el eje local Z. deform(n) -> n' (en la esfera unidad). Devuelve verts, faces, normales unidad."""
    sv, sf = lib.uvsphere(1.0, seg, rings)
    R = R or Matrix.Identity(3)
    verts, ns = [], []
    for p in sv:
        n = V(p).normalized()
        q = deform(n) if deform else n
        verts.append(V(center) + R @ V((q.x * radii[0], q.y * radii[1], q.z * radii[2])))
        ns.append(n)
    if R.determinant() < 0:
        sf = [tuple(reversed(f)) for f in sf]
    return verts, sf, ns


def basis(z, x_hint):
    """Matriz 3x3 con columna Z = z y X lo más parecido a x_hint."""
    z = V(z).normalized()
    x = (V(x_hint) - z * V(x_hint).dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed()


def disc(center, X, Y, N, rx, ry, n=16, dome=0.0, rings=1):
    """Disco abombado (abanico). Devuelve verts, faces, radio normalizado por vértice."""
    verts, rr = [V(center) + N * dome], [0.0]
    for k in range(1, rings + 1):
        f = k / rings
        for j in range(n):
            a = TAU * j / n
            verts.append(V(center) + X * (math.cos(a) * rx * f) + Y * (math.sin(a) * ry * f)
                         + N * (dome * (1 - f * f)))
            rr.append(f)
    faces = [(0, 1 + j, 1 + (j + 1) % n) for j in range(n)]
    for k in range(1, rings):
        a0, b0 = 1 + (k - 1) * n, 1 + k * n
        for j in range(n):
            j2 = (j + 1) % n
            faces.append((a0 + j, b0 + j, b0 + j2, a0 + j2))
    return verts, faces, rr


def torus(center, R, r, useg=20, vseg=8, ky=1.0, rfn=None, zfn=None):
    verts, faces, params = [], [], []
    for i in range(useg):
        u = TAU * i / useg
        rr = r * (rfn(u) if rfn else 1.0)
        for j in range(vseg):
            v = TAU * j / vseg
            rad = R + rr * math.cos(v)
            z = rr * math.sin(v) * 1.1 + (zfn(u) if zfn else 0.0)
            verts.append(V(center) + V((rad * math.cos(u), rad * math.sin(u) * ky, z)))
            params.append((u, v, j))
    for i in range(useg):
        i2 = (i + 1) % useg
        for j in range(vseg):
            j2 = (j + 1) % vseg
            faces.append((i * vseg + j, i2 * vseg + j, i2 * vseg + j2, i * vseg + j2))
    return verts, faces, params


def lock(base, d1, d2, length, width, flat=0.55, sides=6, n0=None, seg=5, curl=0.0):
    """Mechón de pelo: cono curvado que sale en dirección d1 y acaba en d2."""
    d1, d2 = V(d1).normalized(), V(d2).normalized()
    pts = []
    for k in range(seg + 1):
        t = k / seg
        pts.append(V(base) + (d1 * t + (d2 - d1) * (t * t * 0.5)) * length)
    n0 = n0 or lib.frame(d1)[0]

    def rf(t, a):
        r = width * (1 - t) ** 0.85 + 0.0015
        return (r, r * flat)
    return tube(pts, rf, sides=sides, cap0=False, cap1=False, tip=length * 0.18, n0=n0)


def bm_box(center, size, R=None, bev=0.0, insets=()):
    """Caja (bmesh) con bisel y hendiduras. insets: [(eje_local, grosor, profundidad)]. Devuelve verts, faces, info
    por cara: (centro_local, normal_local)."""
    R = R or Matrix.Identity(3)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = V((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    if bev > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bev, segments=1, affect='EDGES', clamp_overlap=True)
    for axis, thick, depth in insets:
        axis = V(axis)
        f = max(bm.faces, key=lambda f: f.normal.dot(axis) * 10 + f.calc_area())
        bmesh.ops.inset_region(bm, faces=[f], thickness=thick, depth=depth)
    bm.verts.index_update()
    bm.normal_update()
    verts = [R @ v.co + V(center) for v in bm.verts]
    faces = [tuple(v.index for v in f.verts) for f in bm.faces]
    info = [(f.calc_center_median().copy(), f.normal.copy()) for f in bm.faces]
    bm.free()
    return verts, faces, info


def crystal(base, d, L, r, sides=6, back=0.3, twist=0.0):
    d = V(d).normalized()
    N, B = lib.frame(d)
    ring = [V(base) + (N * math.cos(twist + TAU * j / sides) + B * math.sin(twist + TAU * j / sides)) * r
            for j in range(sides)]
    verts = ring + [V(base) + d * L, V(base) - d * L * back]
    faces = []
    for j in range(sides):
        j2 = (j + 1) % sides
        faces.append((j, j2, sides))
        faces.append((j2, j, sides + 1))
    return verts, faces


def curve_sampler(pts, per=12):
    dense = catmull(pts, per)
    L = [0.0]
    for a, b in zip(dense, dense[1:]):
        L.append(L[-1] + (b - a).length)
    tot = L[-1]

    def at(t):
        s = max(0.0, min(1.0, t)) * tot
        i = max(0, min(len(dense) - 2, bisect_right(L, s) - 1))
        k = (s - L[i]) / ((L[i + 1] - L[i]) or 1)
        return dense[i].lerp(dense[i + 1], k)
    return at, tot


def project(bvh, p, d, lift=0.002):
    hit = bvh.ray_cast(V(p) - V(d) * 0.2, V(d), 0.6)
    if hit[0] is None:
        return V(p)
    return hit[0] + hit[1] * lift


# =================================================================== cabeza
def head_col(n):
    az = math.atan2(n.x, n.y)
    el = math.asin(max(-1.0, min(1.0, n.z)))
    # la crema de los mofletes va en piezas aparte (borde nítido); aquí solo barbilla y garganta
    lim = -0.42 - 0.3 * smoothstep(1.0, 2.0, abs(az))
    cream = smoothstep(lim + 0.05, lim - 0.05, el)
    c = mix(COL['orange'], COL['cream'], cream)
    top = smoothstep(0.3, 0.95, n.z) * 0.25 + smoothstep(0.0, -0.8, n.y) * 0.25
    return mix(c, COL['orange_d'], top * (1 - cream))


def head_deform(n):
    x, y, z = n.x, n.y, n.z
    low = smoothstep(0.35, -0.45, z)
    x *= 1 + 0.12 * low * smoothstep(0.1, 0.8, abs(n.x))
    y *= 1 - 0.05 * smoothstep(0.4, 0.9, y)            # cara algo plana
    z *= 1 + 0.04 * smoothstep(0.5, 1.0, z)            # coronilla
    return V((x * HS.x, y * HS.y, z * HS.z))


def build_head(G):
    sv, sf = lib.uvsphere(1.0, 20, 13)
    verts, cols = [], []
    for p in sv:
        n = V(p).normalized()
        verts.append(HC + head_deform(n) * HR)
        cols.append(head_col(n))
    G.add(verts, sf, cols, 'head')
    head_bvh = BVHTree.FromPolygons(verts, sf)
    # mofletes color crema: parches abombados bajo los ojos
    for sn, s in SIDES:
        d = V((s * 0.60, 0.66, -0.43)).normalized()
        hit = head_bvh.ray_cast(HC, d, 1.0)
        n = (hit[1] * 0.5 + d * 0.5).normalized()
        R = basis(n, V((s, 0, 0.5)))
        v, f, _ = ell(hit[0] - n * 0.012, (0.078, 0.05, 0.026), 10, 6, R=R,
                      deform=lambda q: V((q.x * (1 + 0.25 * max(0, -q.y * s)), q.y, q.z)))
        G.add(v, f, COL['cream'], 'head')

    # hocico
    MC = HC + V((0, 0.128, -0.07))
    MR = V((0.066, 0.078, 0.054))

    def mdef(n):
        f = max(0.0, n.y)
        return V((n.x * (1 - 0.28 * f), n.y, n.z * (1 - 0.12 * f) + 0.1 * f * f))

    mv, mf, mn = ell(MC, MR, 12, 8, deform=mdef)
    mcols = []
    for n in mn:
        a = smoothstep(0.35, 0.65, n.z) * smoothstep(0.5, 0.25, abs(n.x)) * smoothstep(-0.2, 0.3, n.y)
        mcols.append(mix(COL['cream'], COL['orange'], a * 0.9))
    G.add(mv, mf, mcols, 'head')
    muzzle_bvh = BVHTree.FromPolygons(mv, mf)

    # nariz
    nc = MC + V((0, 0.071, 0.028))
    nv, nf, nn = ell(nc, (0.026, 0.018, 0.019), 8, 6,
                     deform=lambda n: V((n.x * (1 + 0.25 * n.z), n.y, n.z)))
    G.add(nv, nf, COL['nose'], 'head', mat='gloss')

    # boca: sonrisa en "w" y filtrum
    mouth = []
    for x, dz in ((-0.036, -0.013), (-0.024, -0.026), (-0.011, -0.03), (0.0, -0.024), (0.011, -0.03),
                  (0.024, -0.026), (0.036, -0.013)):
        mouth.append(project(muzzle_bvh, V((x, MC.y + 0.3, MC.z + dz)), V((0, -1, 0)), 0.001))
    path = catmull(mouth, 2)
    v, f, _ = tube(path, lambda t, a: 0.0036 * (0.55 + 0.45 * math.sin(math.pi * t)), 4, n0=(0, 0, 1))
    G.add(v, f, COL['lash'], 'head')
    phil = [project(muzzle_bvh, V((0, MC.y + 0.3, MC.z + dz)), V((0, -1, 0)), 0.001) for dz in (0.012, -0.004, -0.022)]
    v, f, _ = tube(catmull(phil, 3), 0.0028 if False else (lambda t, a: 0.0028), 4, n0=(1, 0, 0))
    G.add(v, f, COL['lash'], 'head')

    for sn, s in SIDES:
        build_eye(G, s, head_bvh)
    build_ears(G)
    build_head_fur(G, head_bvh)
    return head_bvh


def build_eye(G, s, bvh):
    d = V((s * 0.405, 0.87, 0.075)).normalized()
    hit = bvh.ray_cast(HC, d, 1.0)
    Pe, Ne = hit[0], hit[1].normalized()
    Ne = (Ne * 0.6 + d * 0.4).normalized()
    X = Ne.cross(V((0, 0, 1))).normalized()
    if X.x < 0:
        X = -X
    Y = X.cross(Ne)
    # inclinación: rabillo exterior un poco alto
    rot = Matrix.Rotation(math.radians(-s * 7), 3, Ne)
    X, Y = rot @ X, rot @ Y
    rx, ry, rz = 0.044, 0.054, 0.024
    cen = Pe - Ne * 0.011
    R = Matrix((X, Y, Ne)).transposed()
    v, f, _ = ell(cen, (rx, ry, rz), 12, 6, R=R)
    G.add(v, f, COL['sclera'], 'head', mat='gloss')

    def on(u, w, lift):
        zz = math.sqrt(max(0.0, 1 - u * u - w * w))
        return cen + X * (u * rx) + Y * (w * ry) + Ne * (zz * rz + lift)

    def layer(u0, w0, ru, rw, lift, cols, n=16, rings=1):
        verts, faces = [on(u0, w0, lift + 0.0012)], []
        rr = [0.0]
        for k in range(1, rings + 1):
            fk = k / rings
            for j in range(n):
                a = TAU * j / n
                verts.append(on(u0 + math.cos(a) * ru * fk, w0 + math.sin(a) * rw * fk, lift))
                rr.append(fk)
        faces = [(0, 1 + j, 1 + (j + 1) % n) for j in range(n)]
        for k in range(1, rings):
            a0, b0 = 1 + (k - 1) * n, 1 + k * n
            for j in range(n):
                j2 = (j + 1) % n
                faces.append((a0 + j, b0 + j, b0 + j2, a0 + j2))
        if X.cross(Y).dot(Ne) < 0:
            faces = [tuple(reversed(f)) for f in faces]
        G.add(verts, faces, [cols(r) for r in rr], 'head', mat='gloss')

    u0, w0 = -s * 0.04, -0.06
    # iris: degradado (oscuro arriba, claro abajo)
    iv = []
    layer(u0, w0, 0.80, 0.80, 0.0012,
          lambda r: mix(COL['iris_l'], COL['iris_d'], smoothstep(0.55, 1.0, r)), n=18, rings=2)
    layer(u0, w0 + 0.04, 0.44, 0.48, 0.0026, lambda r: COL['dark'], n=14)
    layer(u0 + 0.30, w0 + 0.34, 0.22, 0.22, 0.0042, lambda r: COL['white'], n=10)
    layer(u0 - 0.24, w0 - 0.36, 0.10, 0.10, 0.0042, lambda r: COL['white'], n=8)
    del iv

    # línea de pestañas (arriba), con rabillo exterior
    pts = []
    for k in range(9):
        th = math.radians(172 - k * 19)
        u = s * math.cos(th) * 1.02
        w = math.sin(th) * 1.02 - 0.02
        p = cen + X * (u * rx) + Y * (w * ry) + Ne * 0.06
        pts.append(project(bvh, p, -Ne, 0.0015))
    pts.append(project(bvh, cen + X * (s * 1.18 * rx) + Y * (0.38 * ry) + Ne * 0.06, -Ne, 0.0015))
    path = pts
    v, f, _ = tube(path, lambda t, a: 0.0028 + 0.0045 * math.sin(math.pi * min(1, t * 1.15)) ** 0.7, 3, n0=Ne)
    G.add(v, f, COL['lash'], 'head')
    # ceja
    bp = []
    for u, w in ((-0.62, 1.45), (-0.15, 1.72), (0.35, 1.72), (0.78, 1.5)):
        p = cen + X * (s * u * rx) + Y * (w * ry) + Ne * 0.06
        bp.append(project(bvh, p, -Ne, 0.003))
    v, f, _ = tube(catmull(bp, 2), lambda t, a: 0.0035 + 0.0065 * math.sin(math.pi * (0.15 + 0.7 * t)), 4, n0=Ne)
    G.add(v, f, COL['brow'], 'head')


def build_ears(G):
    ts = [0.0, 0.14, 0.28, 0.42, 0.52, 0.6, 0.66, 0.76, 0.88]
    sides = 12
    for sn, s in SIDES:
        base, A, F, S = ear_frame(s)
        W, D = 0.086, 0.038
        verts, params = [], []
        for t in ts:
            c = ear_point(s, t)
            w = W * (1 - t) * (1 + 0.45 * t) + 0.003
            dd = D * (1 - t) ** 0.7 + 0.004
            for j in range(sides):
                a = TAU * j / sides
                u = w * math.cos(a)
                sa = math.sin(a)
                if sa >= 0:   # cara delantera cóncava
                    v = dd * (0.35 * sa) - dd * 0.8 * sa * sa * (1 - t * 0.5)
                else:
                    v = dd * sa
                verts.append(c + S * u + F * v)
                params.append((t, a))
        tipv = len(verts)
        verts.append(ear_point(s, 1.0))
        params.append((1.0, None))
        faces = []
        n = len(ts)
        for i in range(n - 1):
            for j in range(sides):
                j2 = (j + 1) % sides
                faces.append((i * sides + j, i * sides + j2, (i + 1) * sides + j2, (i + 1) * sides + j))
        last = (n - 1) * sides
        for j in range(sides):
            faces.append((last + j, last + (j + 1) % sides, tipv))

        def ecol(p, i, params=params):
            t, a = params[i]
            tipk = smoothstep(0.54, 0.64, t + (0.0 if a is None else 0.03 * math.cos(3 * a)))
            c = COL['orange']
            if a is not None:
                sa, ca = math.sin(a), abs(math.cos(a))
                inner = smoothstep(0.25, 0.6, sa) * smoothstep(0.95, 0.7, ca)
                deep = inner * smoothstep(0.6, 0.2, ca) * smoothstep(0.55, 0.1, t)
                c = mix(c, COL['ear_in'], inner)
                c = mix(c, COL['ear_deep'], deep * 0.8)
            return mix(c, COL['ear_tip'], tipk)

        def ew(p, i, params=params, sn=sn):
            return blend(params[i][0], [(0.06, 'head'), (0.22, f'ear_1_{sn}'), (0.42, f'ear_1_{sn}'),
                                        (0.62, f'ear_2_{sn}')])
        G.add(verts, faces, ecol, ew)
        # mechones de pelo crema dentro de la oreja
        for k, (du, h, L) in enumerate(((0.0, 0.03, 0.10),)):
            b = ear_point(s, h) + S * (du * W) - F * 0.004
            v, f, _ = lock(b, A + F * 0.1, A + F * 0.45, L, 0.032, flat=0.4, sides=5, n0=S, seg=4)
            G.add(v, f, COL['fur_c'], f'ear_1_{sn}')


def build_head_fur(G, bvh):
    def base_at(d, sink=0.012):
        d = V(d).normalized()
        hit = bvh.ray_cast(HC, d, 1.0)
        return hit[0] - hit[1] * sink, hit[1]

    # tupé
    # tupé: mechones anchos que salen de la coronilla, se echan hacia delante y rematan hacia arriba
    spec = [((0.0, 0.30, 0.95), (0.0, 0.85, 0.5), (0.0, 0.3, 1.0), 0.085, 0.046),
            ((-0.2, 0.22, 0.96), (-0.35, 0.8, 0.5), (-0.8, 0.3, 0.55), 0.07, 0.04),
            ((0.21, 0.2, 0.96), (0.4, 0.8, 0.45), (0.85, 0.35, 0.45), 0.072, 0.04),
            ((0.02, 0.05, 1.0), (0.05, 0.45, 0.9), (-0.2, 0.2, 1.0), 0.08, 0.042)]
    for d, d1, d2, L, w in spec:
        b, nor = base_at(d, 0.02)
        v, f, pr = lock(b, d1, d2, L, w, flat=0.42, sides=6, n0=(1, 0, 0), seg=4)
        G.add(v, f, lambda p, i, pr=pr: mix(COL['orange'], COL['orange_l'], pr[i][0]), 'head')
    # nuca: mechones hacia abajo para romper la bola vista desde atrás
    for d, d1, d2, L, w in (((-0.22, -0.85, -0.3), (-0.3, -0.5, -1), (-0.1, -0.2, -1), 0.075, 0.045),
                            ((0.22, -0.85, -0.28), (0.3, -0.5, -1), (0.1, -0.2, -1), 0.075, 0.045)):
        b, nor = base_at(d)
        v, f, pr = lock(b, d1, d2, L, w, flat=0.4, sides=5, n0=(1, 0, 0), seg=4)
        G.add(v, f, COL['orange_d'], 'head')
    # mofletes: mechones hacia fuera y abajo
    for sn, s in SIDES:
        spec = [((s * 0.95, 0.10, -0.02), (s * 1, -0.25, -0.1), (s * 0.8, -0.4, 0.25), 0.06, 0.036, 'orange'),
                ((s * 0.9, 0.28, -0.3), (s * 1, -0.1, -0.3), (s * 0.75, -0.2, -0.6), 0.07, 0.04, 'fur_c'),
                ((s * 0.66, 0.46, -0.58), (s * 0.75, 0.1, -0.7), (s * 0.35, 0.0, -1), 0.055, 0.036, 'fur_c')]
        for d, d1, d2, L, w, c in spec:
            b, nor = base_at(d)
            v, f, pr = lock(b, d1, d2, L, w, flat=0.45, sides=4, n0=(0, 0, 1), seg=4)
            G.add(v, f, COL[c], 'head')


# =================================================================== cuerpo
def ellipse_k(ry):
    return lambda a: 1.0 / math.sqrt(math.cos(a) ** 2 + (math.sin(a) / ry) ** 2)


TORSO_PROF = [(0, 0.648), (0.055, 0.642), (0.092, 0.618), (0.112, 0.585), (0.12, 0.54), (0.118, 0.495),
              (0.113, 0.462), (0.118, 0.43), (0.126, 0.395), (0.122, 0.355), (0.098, 0.322), (0.05, 0.305),
              (0, 0.30)]
TORSO_KY = 0.84


def torso_r(z):
    """Radio del perfil del torso a la altura z (relativa a Z0)."""
    pr = TORSO_PROF
    for (r0, z0), (r1, z1) in zip(pr, pr[1:]):
        if z1 <= z <= z0:
            k = (z - z1) / ((z0 - z1) or 1)
            return r1 + (r0 - r1) * k
    return 0.0


def build_torso(G):
    prof = [(r, Z0 + z) for r, z in TORSO_PROF]
    v, f = lib.lathe(prof, 18, ellipse_k(TORSO_KY), phase=math.pi / 2)

    def tcol(p, i):
        zl = p.z - Z0
        if zl < 0.452:
            return COL['olive']
        c = COL['vest']
        # abertura del chaleco (delante) y costuras
        if p.y > 0 and abs(p.x) < 0.012:
            c = COL['vest_d']
        c = mix(c, COL['vest_l'], 0.35 * smoothstep(0.5, 0.6, zl) * max(0.0, p.y) / 0.1)
        return c
    G.add(v, f, tcol, prox(['hips', 'spine1', 'spine2', 'neck'], 3.0))
    torso_bvh = BVHTree.FromPolygons(v, f)

    # cinturón
    ring = [(0.121, Z0 + 0.466), (0.1265, Z0 + 0.459), (0.1265, Z0 + 0.437), (0.1215, Z0 + 0.43)]
    v, f = lib.lathe(ring, 18, ellipse_k(TORSO_KY + 0.01), phase=math.pi / 2)
    G.add(v, f, COL['leather'], prox(['hips', 'spine1'], 3.0))
    fy = 0.1265 * (TORSO_KY + 0.01)
    v, f, info = bm_box(P(0, fy + 0.004, 0.448), (0.046, 0.012, 0.036), bev=0.004, insets=[((0, 1, 0), 0.008, -0.003)])
    G.add_flat(v, f, COL['white'], 'hips', mat='gold')
    # bolsas a los lados
    for s, a in ((-1, math.pi / 2 + 1.1), (1, math.pi / 2 - 1.15)):
        k = ellipse_k(TORSO_KY)(a)
        r = 0.127 * k
        pos = V((r * math.cos(a), r * math.sin(a), Z0 + 0.418))
        out = V((math.cos(a), math.sin(a) / TORSO_KY ** 2, 0)).normalized()
        R = basis(V((0, 0, 1)), out.cross(V((0, 0, 1))))
        R = Matrix((out.cross(V((0, 0, 1))) * -1, out, V((0, 0, 1)))).transposed()
        v, f, info = bm_box(pos + out * 0.018, (0.056, 0.036, 0.058), R, bev=0.007)
        G.add_flat(v, f, lambda c, n, i: COL['boot'] if (c - pos - out * 0.018).z < 0.012 else COL['boot_l'], 'hips')
        v, f, info = bm_box(pos + out * 0.037 + V((0, 0, 0.004)), (0.014, 0.006, 0.014), R)
        G.add_flat(v, f, COL['white'], 'hips', mat='gold')
    # medallón colgante y hojita
    front = V((-0.052, 0.113, Z0 + 0.39))
    v, f, _ = tube([front + V((0, -0.003, 0)), front + V((0, 0.005, 0))], lambda t, a: 0.02, 8, n0=(1, 0, 0))
    G.add(v, f, COL['white'], 'hips', mat='gold')
    lv, lf = lib.leaf(front + V((0.018, 0.006, 0.01)), V((0.35, 0.15, -1)), V((0, 1, 0)), 0.05, 0.026, n=6)
    G.add_flat(lv, lf + [tuple(reversed(x)) for x in lf], COL['leafdeco'], 'hips')

    # medallón del pecho: aro dorado + gema
    mc = P(0, torso_r(0.53) * TORSO_KY + 0.004, 0.53)
    v, f, _ = torus(V((0, 0, 0)), 0.026, 0.0075, 10, 4)
    R = Matrix(((1, 0, 0), (0, 0, 1), (0, 1, 0)))  # plano XZ, mira hacia +Y
    v = [mc + R @ p for p in v]
    # corrige orientación (la matriz invierte): invierte caras
    f = [tuple(reversed(x)) for x in f]
    G.add(v, f, COL['white'], 'spine1', mat='gold')
    gv, gf, _ = disc(mc + V((0, 0.004, 0)), V((1, 0, 0)), V((0, 0, 1)), V((0, 1, 0)), 0.021, 0.021, n=8, dome=0.009)
    G.add_flat(gv, gf, COL['white'], 'spine1', mat='crystal')
    # correas del chaleco: del medallón a los hombros y a la espalda
    for s in (-1, 1):
        pts = []
        for x, side, z in ((0.02, 1, 0.535), (0.055, 1, 0.575), (0.07, 1, 0.61), (0.07, 0, 0.64),
                           (0.065, -1, 0.605), (0.045, -1, 0.53), (0.03, -1, 0.47)):
            zz = Z0 + z
            if side == 0:
                p = V((s * x, 0.0, zz + 0.3))
                pts.append(project(torso_bvh, p, V((0, 0, -1)), 0.004))
            else:
                p = V((s * x, side * 0.4, zz))
                pts.append(project(torso_bvh, p, V((0, -side, 0)), 0.004))
        v, f, _ = tube(pts, lambda t, a: (0.006, 0.013), 4, cap0=False, cap1=False, n0=(0, 0, 1))
        G.add(v, f, COL['leather'], prox(['spine1', 'spine2', 'neck'], 3.0))
    return torso_bvh


def build_legs(G):
    for sn, s in SIDES:
        td = (KNEE(s) - HIP(s)).normalized()
        h = HIP(s)
        path = [h + V((0, 0, 0.05)), h, h + td * 0.07, h + td * 0.095]
        v, f, pr = tube(path, lambda t, a: 0.068 + 0.007 * t, 12, cap0=False, cap1=True, n0=(1, 0, 0))
        G.add(v, f, COL['olive'], lambda p, i, pr=pr, sn=sn: blend(pr[i][0], [(0.35, 'hips'), (0.7, f'thigh_{sn}')]))
        v, f, pr = tube([h + td * 0.082, h + td * 0.104], lambda t, a: 0.079, 12, cap0=False, cap1=False, n0=(1, 0, 0))
        G.add(v, f, COL['olive_l'], f'thigh_{sn}')
        # bolsillo lateral
        out = V((s, 0, 0))
        R = Matrix((V((0, 1, 0)), out * s, V((0, 0, 1)))).transposed() if False else basis(td, out)
        cen = h + td * 0.045 + out * 0.07 + V((0, 0.005, 0))
        v, f, info = bm_box(cen, (0.012, 0.05, 0.048))
        G.add_flat(v, f, COL['olive_d'], lambda p, i, sn=sn: {f'thigh_{sn}': 0.8, 'hips': 0.2})
        # pierna (pelaje)
        path = [h + td * 0.06, KNEE(s), (KNEE(s) + ANK(s)) / 2, ANK(s) + V((0, 0, 0.02))]
        v, f, pr = tube(catmull(path, 2), lambda t, a: 0.036 - 0.006 * t, 7, cap0=False, cap1=False, n0=(1, 0, 0))
        G.add(v, f, COL['orange'], prox([f'thigh_{sn}', f'shin_{sn}'], 4.0))
        # pelusa del calcetín
        c0 = ANK(s) + V((0, -0.002, 0.07))
        v, f, pr = tube([c0, c0 + V((0, 0, 0.02))], lambda t, a: 0.05 * (1 + 0.12 * math.cos(4 * a)), 8,
                        cap0=False, cap1=False, n0=(1, 0, 0))
        G.add(v, f, COL['sock'], f'shin_{sn}')
        build_boot(G, s, sn)


def build_boot(G, s, sn):
    wb = prox([f'shin_{sn}', f'foot_{sn}'], 4.0)
    a = ANK(s)
    shaft = [V((a.x, -0.004, Z0 + 0.04)), V((a.x, -0.004, Z0 + 0.137))]
    v, f, _ = tube(shaft, lambda t, a_: 0.046 + 0.004 * t, 12, cap0=False, cap1=True, n0=(1, 0, 0))
    G.add(v, f, COL['boot'], wb)
    v, f, _ = tube([V((a.x, -0.004, Z0 + 0.118)), V((a.x, -0.004, Z0 + 0.142))], lambda t, a_: 0.055, 12,
                   cap0=False, cap1=False, n0=(1, 0, 0))
    G.add(v, f, COL['boot_l'], wb)
    fc = V((a.x, 0.03, Z0 + 0.042))

    def fdef(n):
        z = max(n.z, -0.9)
        return V((n.x * (1 + 0.08 * max(0, n.y)), n.y, z + 0.12 * max(0.0, n.y) ** 3))
    v, f, ns = ell(fc, (0.053, 0.09, 0.047), 10, 7, deform=fdef)
    v = [V((p.x, p.y, max(p.z, Z0 + 0.001))) for p in v]
    cols = [COL['sole'] if p.z < Z0 + 0.016 else (COL['boot_l'] if n.y > 0.75 and n.z > -0.3 else COL['boot'])
            for p, n in zip(v, ns)]
    G.add(v, f, cols, wb)
    # correa + hebilla + cristal
    v, f, _ = tube([V((a.x, -0.004, Z0 + 0.076)), V((a.x, -0.004, Z0 + 0.094))], lambda t, a_: 0.0505, 12,
                   cap0=False, cap1=False, n0=(1, 0, 0))
    G.add(v, f, COL['leather'], wb)
    v, f, _ = bm_box(V((a.x + s * 0.052, -0.004, Z0 + 0.085)), (0.008, 0.026, 0.024), bev=0.003)
    G.add_flat(v, f, COL['white'], wb, mat='gold')
    g = V((a.x + s * 0.056, 0.012, Z0 + 0.128))
    gv, gf, _ = disc(g, V((0, 1, 0)), V((0, 0, 1)), V((s, 0, 0)), 0.013, 0.015, n=6, dome=0.008)
    if s < 0:
        gf = [tuple(reversed(x)) for x in gf]
    G.add_flat(gv, gf, COL['white'], wb, mat='crystal')


def build_arms(G):
    for sn, s in SIDES:
        d = arm_dir(s)
        J = SH(s)
        EL = J + d * 0.12
        WR = EL + d * 0.11
        out = V((s * 0.69, 0, 0.72)).normalized()   # dorso del brazo
        up = out

        def wsleeve(p, i, J=J, d=d, sn=sn):
            k = smoothstep(-0.02, 0.05, (p - J).dot(d))
            return nrm({f'shoulder_{sn}': 1 - k, f'upperarm_{sn}': k})
        v, f, _ = tube([J - d * 0.035, J + d * 0.03, J + d * 0.085],
                       lambda t, a: 0.056 + 0.004 * math.sin(math.pi * t), 12, cap0=False, cap1=True, n0=up)
        G.add(v, f, COL['shirt'], wsleeve)
        v, f, _ = tube([J + d * 0.074, J + d * 0.094], lambda t, a: 0.06, 12, cap0=False, cap1=False, n0=up)
        G.add(v, f, COL['shirt_d'], f'upperarm_{sn}')
        v, f, _ = tube([J + d * 0.06, EL, WR], lambda t, a: 0.03 - 0.004 * t, 8, cap0=False, cap1=False, n0=up)
        G.add(v, f, COL['orange'], prox([f'upperarm_{sn}', f'forearm_{sn}'], 4.0))
        # guante (puño) y brazalete
        v, f, _ = tube([EL + d * 0.035, WR + d * 0.012], lambda t, a: 0.032 + 0.005 * t, 10, cap0=False, cap1=False,
                       n0=up)
        G.add(v, f, COL['glove'], prox([f'forearm_{sn}', f'hand_{sn}'], 5.0))
        v, f, _ = tube([EL + d * 0.045, EL + d * 0.088], lambda t, a: 0.04, 10, cap0=False, cap1=False, n0=up)
        G.add(v, f, COL['leather'], f'forearm_{sn}')
        for k in (0.088,):
            v, f, _ = tube([EL + d * (k - 0.004), EL + d * (k + 0.004)], lambda t, a: 0.0425, 10, cap0=False,
                           cap1=False, n0=up)
            G.add(v, f, COL['white'], f'forearm_{sn}', mat='gold')
        g = EL + d * 0.066 + up * 0.04
        Xg = d
        Yg = up.cross(d).normalized()
        gv, gf, _ = disc(g, Xg, Yg, up, 0.014, 0.012, n=6, dome=0.008)
        if Xg.cross(Yg).dot(up) < 0:
            gf = [tuple(reversed(x)) for x in gf]
        G.add_flat(gv, gf, COL['white'], f'forearm_{sn}', mat='crystal')
        # mano: palma de guante + dedos de pelo
        thick = d.cross(V((0, 1, 0))).normalized()
        if thick.dot(out) < 0:
            thick = -thick
        across = thick.cross(d).normalized()
        hc = WR + d * 0.03
        R = Matrix((across, d, thick)).transposed()
        v, f, _ = ell(hc, (0.036, 0.04, 0.024), 10, 6, R=R)
        G.add(v, f, COL['glove'], f'hand_{sn}')
        for k in (-1, 0, 1):
            b = hc + d * 0.026 + across * (k * 0.016)
            v, f, pr = tube([b, b + d * 0.018 - thick * 0.004, b + d * 0.032 - thick * 0.012],
                            lambda t, a: 0.0115 - 0.003 * t, 6, cap0=False, cap1=True, n0=across)
            G.add(v, f, lambda p, i, pr=pr: COL['dark'] if pr[i][0] > 0.9 else COL['orange'], f'hand_{sn}')
        fw = across if across.y > 0 else -across
        b = hc + fw * 0.028 - d * 0.004
        v, f, pr = tube([b, b + fw * 0.014 + d * 0.012, b + fw * 0.018 + d * 0.028], lambda t, a: 0.012 - 0.003 * t, 6,
                        cap0=False, cap1=True, n0=thick)
        G.add(v, f, lambda p, i, pr=pr: COL['dark'] if pr[i][0] > 0.9 else COL['orange'], f'hand_{sn}')


def tail_radius(t):
    return 0.03 + 0.092 * smoothstep(0.0, 0.48, t) ** 0.8 - 0.058 * smoothstep(0.68, 1.0, t) ** 1.2


def build_tail(G):
    at, tot = curve_sampler(TP)
    ts = [i / 21 for i in range(22)]
    pts = [at(t) for t in ts]
    # marcos comunes para que el pelo naranja y la punta crema casen
    T = [(pts[min(i + 1, 21)] - pts[max(i - 1, 0)]).normalized() for i in range(22)]
    N = (V((1, 0, 0)) - T[0] * T[0].x).normalized()
    frames = []
    for i in range(22):
        if i:
            ax = T[i - 1].cross(T[i])
            if ax.length > 1e-7:
                N = Matrix.Rotation(T[i - 1].angle(T[i]), 3, ax.normalized()) @ N
        N = (N - T[i] * N.dot(T[i])).normalized()
        frames.append((N.copy(), T[i].cross(N)))

    def rf(t, a):
        return tail_radius(t) * (1 + 0.085 * math.cos(4 * a + 6 * t))

    wt = prox(['hips', 'tail_1', 'tail_2', 'tail_3', 'tail_4', 'tail_5'], 3.5)
    i1 = 17  # t = 0.81
    sub = pts[:i1 + 1]
    v, f, pr = tube(sub, lambda t, a: rf(t * ts[i1], a), 12, cap0=True, cap1=True, frames=frames[:i1 + 1])
    G.add(v, f, lambda p, i, pr=pr: mix(COL['orange'], COL['orange_d'], 0.25 * (1 - pr[i][0])), wt)
    i0 = 13  # t = 0.62
    sub = pts[i0:]
    t0 = ts[i0]
    v, f, pr = tube(sub, lambda t, a: rf(t0 + t * (1 - t0), a) * 1.07, 16, cap0=False, cap1=False, tip=0.13,
                    frames=frames[i0:])
    # borde en zigzag (llamas de crema hacia la base)
    for j in range(16):
        if j % 2:
            v[j] = v[j] + T[i0] * 0.075 + (v[j] - pts[i0]) * 0.02
    G.add(v, f, lambda p, i, pr=pr: mix(COL['fur_c'], COL['cream'], pr[i][0]), wt)


def build_scarf(G):
    c = P(0, -0.004, 0.613)

    def rfn(u):
        return 1 + 0.12 * math.sin(3 * u + 1) + 0.06 * math.sin(7 * u)

    def zfn(u):
        return -0.014 * max(0.0, math.sin(u)) ** 2

    v, f, pr = torus(c, 0.087, 0.029, 16, 8, ky=0.88, rfn=rfn, zfn=zfn)
    G.add(v, f, lambda p, i, pr=pr: COL['scarf_p'] if pr[i][2] in (1, 7) else
          (COL['scarf_d'] if pr[i][2] in (3, 4, 5) else COL['scarf']),
          lambda p, i: {'spine2': 0.5, 'neck': 0.5})
    # nudo delante a la izquierda
    v, f, ns = ell(P(-0.05, 0.078, 0.60), (0.034, 0.028, 0.032), 8, 6,
                   deform=lambda n: n * (1 + 0.1 * math.sin(4 * n.x + 3 * n.z)))
    G.add(v, f, [COL['scarf_p'] if abs(n.z) > 0.55 and abs(n.z) < 0.75 else COL['scarf'] for n in ns],
          lambda p, i: {'spine2': 0.6, 'neck': 0.4})
    # dos puntas al viento, hacia atrás
    across = [-0.5, -0.38, -0.3, 0.0, 0.3, 0.38, 0.5]
    for sn, s in SIDES:
        o, D = SO(s), SD(s)
        nt = 7
        top, bot, prm = [], [], []
        for i in range(nt):
            t = i / (nt - 1)
            Wd = (V((0, 0, 1)) - D * D.z).normalized()
            Nn0 = D.cross(Wd)
            cpt = o + D * SCARF_LEN * t + V((0, 0, -0.03 * t * t)) + Nn0 * (0.025 * math.sin(TAU * t * 0.9))
            Wd = Matrix.Rotation(math.radians(s * 35 * t), 3, D) @ Wd
            Nn = D.cross(Wd)
            w = 0.05 + 0.065 * t
            for k, a in enumerate(across):
                ext = 0.0
                if i == nt - 1:
                    ext = 0.04 if k in (0, 3, 6) else -0.005
                p = cpt + Wd * (a * w) + D * ext
                top.append(p + Nn * 0.0045)
                bot.append(p - Nn * 0.0045)
                prm.append((t, a))
        na = len(across)
        faces = []
        for i in range(nt - 1):
            for k in range(na - 1):
                a0, a1 = i * na + k, i * na + k + 1
                b0, b1 = (i + 1) * na + k, (i + 1) * na + k + 1
                faces.append((a0, b0, b1, a1))
        nb = len(top)
        verts = top + bot
        faces += [tuple(x + nb for x in reversed(fc)) for fc in faces]
        prm = prm + prm

        def scol(p, i, prm=prm):
            t, a = prm[i]
            if abs(a) >= 0.38:
                return COL['scarf_p']
            return COL['scarf_d'] if (abs(a) < 0.05 and 0.2 < t < 0.9) else COL['scarf']

        def sw(p, i, prm=prm, sn=sn):
            return blend(prm[i][0], [(0.0, 'spine2'), (0.14, f'scarf_1_{sn}'), (0.4, f'scarf_1_{sn}'),
                                     (0.62, f'scarf_2_{sn}')])
        G.add(verts, faces, scol, sw)


# =================================================================== tabla-hoja
BL_B, BL_F = -0.60, 0.74


def hw(u):
    return 0.29 * max(0.0, math.sin(math.pi * (0.13 + 0.87 * u) ** 0.95)) ** 0.7


def leaf_y(u):
    return BL_B + (BL_F - BL_B) * u


def leaf_th(u):
    return 0.016 * (1 - u ** 3) + 0.004


def leaf_curl(u):
    return 0.10 * smoothstep(0.78, 1.0, u) ** 1.6


def leaf_top(u, xn):
    return Z0 - leaf_th(u) + leaf_curl(u) + leaf_th(u) * math.sqrt(max(0.0, 1 - xn * xn)) + 0.03 * xn * xn


def build_board(G):
    rnd = random.Random(7)
    W = 'board'
    # hoja: sección de lente, con los bordes levantados y la punta curvada hacia arriba
    nu = 20
    us = [i / nu for i in range(nu)] + [0.985]
    path = [V((0, leaf_y(u), Z0 - leaf_th(u) + leaf_curl(u))) for u in us]
    sides = 10
    v, f, pr = tube(path, lambda t, a: (hw(t * 0.985) + 0.002, leaf_th(t * 0.985)), sides, cap0=True, cap1=True,
                    n0=(1, 0, 0))
    for i, (t, a) in enumerate(pr):
        if a is not None:
            v[i] = v[i] + V((0, 0, 0.03 * math.cos(a) ** 2))

    def lcol(p, i, pr=pr):
        t, a = pr[i]
        if a is None:
            return COL['leaf']
        top = -math.sin(a)
        xn = abs(math.cos(a))
        c = mix(COL['leaf_l'], COL['leaf'], smoothstep(0.1, 0.7, xn))
        c = mix(c, COL['leaf_edge'], smoothstep(0.85, 1.0, xn) * 0.8)
        c = mix(c, COL['leaf_edge'], smoothstep(0.8, 0.98, t) * 0.6)
        return c if top > -0.2 else mix(COL['leaf_d'], COL['leaf'], 0.3)
    G.add(v, f, lcol, W)
    # nervio central luminoso
    mid = [V((0, leaf_y(u), leaf_top(u, 0) + 0.0025)) for u in [0.03 + 0.94 * k / 10 for k in range(11)]]
    v, f, _ = tube(mid, lambda t, a: (0.009 * (1 - 0.6 * t), 0.004), 4, cap0=True, cap1=True, n0=(1, 0, 0))
    G.add(v, f, COL['white'], W, mat='crystal')
    # nervios laterales
    for s in (-1, 1):
        for k in range(7):
            u0 = 0.1 + k * 0.115
            pts = []
            for j in range(5):
                q = j / 4
                u = u0 + 0.12 * q ** 1.2
                xn = 0.9 * q
                pts.append(V((s * xn * hw(u), leaf_y(u), leaf_top(u, xn) + 0.0018)))
            verts, faces = [], []
            for j, p in enumerate(pts):
                tg = (pts[min(j + 1, 4)] - pts[max(j - 1, 0)]).normalized()
                sd = tg.cross(V((0, 0, 1))).normalized() * (0.005 * (1 - 0.7 * j / 4))
                verts += [p - sd, p + sd]
            for j in range(4):
                a, b = 2 * j, 2 * j + 2
                fc = (a, b, b + 1, a + 1)
                faces.append(fc if s > 0 else tuple(reversed(fc)))
            G.add_flat(verts, faces, COL['leaf_vein'], W)

    # marco de piedra tallada a los lados
    hgt = Z0 + 0.034
    for s in (-1, 1):
        nb = 6
        for b in range(nb):
            ua = 0.02 + b * 0.105
            ub = ua + 0.1
            um = (ua + ub) / 2
            pa = V((s * hw(ua), leaf_y(ua), 0))
            pb = V((s * hw(ub), leaf_y(ub), 0))
            tg = (pb - pa).normalized()
            outv = V((0, 0, 1)).cross(tg).normalized() * s
            if outv.x * s < 0:
                outv = -outv
            ln = (pb - pa).length * 0.96
            dep = 0.075
            hh = hgt + rnd.uniform(-0.006, 0.006)
            cen = V((s * hw(um), leaf_y(um), 0)) - outv * (dep / 2 - 0.012)
            cen.z = hh / 2
            R = Matrix((outv, tg, V((0, 0, 1)))).transposed()
            if R.determinant() < 0:
                R = Matrix((outv, -tg, V((0, 0, 1)))).transposed()
            gem = b in (1, 4)
            ins = [((1, 0, 0), 0.016, -0.007), ((1, 0, 0), 0.011, 0.004)] if not gem else [((1, 0, 0), 0.02, -0.01)]
            v, f, info = bm_box(cen, (dep, ln, hh), R, bev=0.009, insets=ins)
            tone = mix(COL['stone'], COL['stone_l'], rnd.uniform(0, 0.6))

            def scol(c, n, i, info=info, tone=tone, dep=dep, hh=hh):
                lc, ln_ = info[i]
                if ln_.x > 0.9 and lc.x < dep / 2 - 0.004:
                    return mix(tone, COL['stone_d'], 0.55)
                if abs(ln_.x) < 0.5 and lc.x > dep / 2 - 0.012 and abs(lc.z) < hh / 2 - 0.012:
                    return mix(tone, COL['stone_d'], 0.8)
                if ln_.z > 0.9:
                    return mix(tone, COL['stone_l'], 0.4)
                return tone
            G.add_flat(v, f, scol, W)
            if gem:
                gc = cen + outv * (dep / 2 - 0.004)
                v, f, _ = bm_box(gc, (0.02, ln * 0.42, hh * 0.46), R)
                G.add_flat(v, f, COL['white'], W, mat='crystal')
        # moldura dorada sobre la piedra
        pts = [V((s * (hw(u) + 0.002), leaf_y(u), hgt + 0.002)) for u in [0.02 + 0.62 * k / 11 for k in range(12)]]
        v, f, _ = tube(pts, lambda t, a: (0.008, 0.012), 4, n0=(0, 0, 1))
        G.add(v, f, COL['white'], W, mat='gold')
        # enredadera
        vp = []
        for k in range(22):
            u = 0.03 + 0.62 * k / 21
            o = V((s * (hw(u) + 0.014), leaf_y(u), 0))
            o.z = 0.06 + 0.042 * math.sin(u * 28 + (1.3 if s > 0 else 0))
            vp.append(o)
        v, f, _ = tube(vp, lambda t, a: 0.008, 3, n0=(0, 0, 1))
        G.add(v, f, COL['vine'], W)
        for k in range(1, 21, 4):
            p = vp[k]
            dirv = V((s * 0.6, rnd.uniform(-0.6, 0.6), rnd.uniform(0.2, 0.9)))
            lv, lf = lib.leaf(p, dirv, V((s, 0, 0.3)), 0.05, 0.03, n=5)
            G.add_flat(lv, lf + [tuple(reversed(x)) for x in lf], mix(COL['vine_l'], COL['vine'], rnd.uniform(0, 0.5)), W)
        # propulsor lateral
        u = 0.1
        base = V((s * (hw(u) + 0.02), leaf_y(u), 0.05))
        v, f = crystal(base, V((s * 0.55, -0.83, -0.1)), 0.15, 0.03, 6, 0.25)
        G.add_flat(v, f, COL['white'], W, mat='crystal')
        base = V((s * (hw(0.42) + 0.012), leaf_y(0.42), 0.03))
        v, f = crystal(base, V((s * 0.35, -0.9, -0.4)), 0.09, 0.022, 5, 0.3)
        G.add_flat(v, f, COL['white'], W, mat='crystal')

    # fondo de piedra (casco)
    ring = []
    for k in range(15):
        u = 0.66 * k / 14
        ring.append((u, hw(u) - 0.02))
    loop = [V((r, leaf_y(u), 0)) for u, r in ring] + [V((-r, leaf_y(u), 0)) for u, r in reversed(ring)]
    cy = sum((p.y for p in loop), 0) / len(loop)
    z0, z1 = 0.012, Z0 - 0.03
    verts = [V((p.x, p.y, z0)) for p in loop] + [V((p.x, p.y, z1)) for p in loop] + [V((0, cy, z0)), V((0, cy, z1))]
    n = len(loop)
    faces = []
    for i in range(n):
        i2 = (i + 1) % n
        faces.append((i, i2, n + i2, n + i))
        faces.append((2 * n + 1, n + i, n + i2))
    # orientación: comprueba la primera pared
    a, b, c = verts[faces[0][0]], verts[faces[0][1]], verts[faces[0][2]]
    if (b - a).cross(c - a).dot(V(((a.x + b.x) / 2, (a.y + b.y) / 2 - cy, 0))) < 0:
        faces = [tuple(reversed(x)) for x in faces]
    G.add_flat(verts, faces, mix(COL['stone_d'], COL['stone'], 0.3), W)

    # remate trasero con propulsores
    yb = BL_B + 0.03
    v, f, info = bm_box(V((0, yb, (Z0 + 0.045) / 2)), (0.36, 0.1, Z0 + 0.045), bev=0.012,
                        insets=[((0, -1, 0), 0.02, -0.008)])
    G.add_flat(v, f, lambda c, n, i: mix(COL['stone'], COL['stone_d'], 0.5) if n.y < -0.9 and abs(c.x) < 0.15
               else COL['stone'], W)
    v, f, _ = bm_box(V((0, yb + 0.03, Z0 + 0.05)), (0.2, 0.1, 0.02), bev=0.006, insets=[((0, 0, 1), 0.015, -0.006)])
    G.add_flat(v, f, COL['white'], W, mat='gold')
    v, f, _ = bm_box(V((0, yb + 0.03, Z0 + 0.056)), (0.07, 0.05, 0.022), bev=0.008)
    G.add_flat(v, f, COL['white'], W, mat='crystal')
    v, f = crystal(V((0, BL_B - 0.01, 0.07)), V((0, -1, 0.05)), 0.22, 0.05, 6, 0.3, twist=0.5)
    G.add_flat(v, f, COL['white'], W, mat='crystal')
    for s in (-1, 1):
        v, f = crystal(V((s * 0.12, BL_B + 0.0, 0.06)), V((s * 0.4, -1, 0.02)), 0.15, 0.036, 6, 0.3, twist=0.2)
        G.add_flat(v, f, COL['white'], W, mat='crystal')


# =================================================================== malla final
def fib(n):
    out, g = [], math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        r = math.sqrt(1 - z * z)
        out.append(V((r * math.cos(g * i), r * math.sin(g * i), z)))
    return out


def build_mesh(G):
    me = bpy.data.meshes.new('fox')
    me.from_pydata([tuple(p) for p in G.V], [], G.F)
    for m in MAT_ORDER:
        me.materials.append(MATS[m])
    for poly, m, s in zip(me.polygons, G.FM, G.FS):
        poly.material_index = MAT_ORDER.index(m)
        poly.use_smooth = s
    me.update()
    ob = bpy.data.objects.new('fox', me)
    bpy.context.scene.collection.objects.link(ob)
    # oclusión ambiental horneada al color de vértice (rayos con BVH)
    bvh = BVHTree.FromPolygons([tuple(p) for p in G.V], G.F)
    dirs = fib(48)
    ao = []
    for v in me.vertices:
        n = v.normal
        p = v.co + n * 0.003
        occ = tot = 0.0
        for d in dirs:
            c = d.dot(n)
            if c <= 0.08:
                continue
            tot += c
            hit = bvh.ray_cast(p, d, 0.14)
            if hit[0] is not None:
                occ += c * (1 - hit[3] / 0.14) ** 0.6
        ao.append(1 - occ / tot if tot else 1.0)
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            k = 0.52 + 0.48 * ao[vi] ** 0.9
            c = G.C[vi]
            attr.data[li].color = (c[0] * k, c[1] * k, c[2] * k, 1)
    me.color_attributes.active_color = attr
    # grupos de vértices
    groups = {}
    for vi, ws in enumerate(G.W):
        for bn, w in ws.items():
            if bn not in groups:
                groups[bn] = ob.vertex_groups.new(name=bn)
            groups[bn].add([vi], w, 'REPLACE')
    return ob


# =================================================================== armadura e IK
def build_armature():
    arm = bpy.data.armatures.new('fox_rig')
    ob = bpy.data.objects.new('fox_rig', arm)
    bpy.context.scene.collection.objects.link(ob)
    lib.select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    for n, (h, t, par, deform) in BONES.items():
        eb = arm.edit_bones.new(n)
        eb.head, eb.tail, eb.roll = h, t, 0.0
        eb.use_deform = deform
        if par:
            eb.parent = arm.edit_bones[par]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def setup_ik(rig):
    for sn, s in SIDES:
        c = rig.pose.bones[f'shin_{sn}'].constraints.new('IK')
        c.target, c.subtarget = rig, f'ik_foot_{sn}'
        c.pole_target, c.pole_subtarget = rig, f'pole_{sn}'
        c.chain_count = 2
        cr = rig.pose.bones[f'foot_{sn}'].constraints.new('COPY_ROTATION')
        cr.target, cr.subtarget = rig, f'ik_foot_{sn}'
        best = None
        for ang in (-90, 0, 90, 180):
            c.pole_angle = math.radians(ang)
            bpy.context.view_layer.update()
            err = 0.0
            for bn in (f'thigh_{sn}', f'shin_{sn}'):
                pb = rig.pose.bones[bn]
                err += (pb.matrix.to_3x3() - pb.bone.matrix_local.to_3x3()).to_euler().to_quaternion().angle \
                    if False else sum(abs(x) for row in (pb.matrix.to_3x3() - pb.bone.matrix_local.to_3x3()) for x in row)
            if best is None or err < best[0]:
                best = (err, ang)
        c.pole_angle = math.radians(best[1])
        print(f'IK {sn}: pole_angle {best[1]} (err {best[0]:.4f})')
    bpy.context.view_layer.update()


# =================================================================== poses
class Pose(dict):
    def g(self, n):
        if n not in self:
            self[n] = [V((0, 0, 0)), V((0, 0, 0))]
        return self[n]

    def r(self, n, x=0.0, y=0.0, z=0.0):
        self.g(n)[0] += V((x, y, z))
        return self

    def l(self, n, x=0.0, y=0.0, z=0.0):
        self.g(n)[1] += V((x, y, z))
        return self

    def set(self, n, x=0.0, y=0.0, z=0.0):
        self.g(n)[0] = V((x, y, z))
        return self

    def rm(self, n, x=0.0, y=0.0, z=0.0):
        """Simétrico: el lado izquierdo recibe (x, y, z) y el derecho (x, −y, −z)."""
        self.r(n + '_L', x, y, z)
        self.r(n + '_R', x, -y, -z)
        return self

    def add(self, other, k=1.0):
        for n, (r, l) in other.items():
            g = self.g(n)
            g[0] += r * k
            g[1] += l * k
        return self


def spline(t, keys):
    """Interpolación de Hermite (tangentes de Catmull-Rom) entre poses clave [(t, Pose)]."""
    ts = [k[0] for k in keys]
    names = set()
    for _, p in keys:
        names |= set(p.keys())
    i = max(0, min(len(ts) - 2, bisect_right(ts, t) - 1))
    t0, t1 = ts[i], ts[i + 1]
    h = t1 - t0
    u = max(0.0, min(1.0, (t - t0) / h))

    def val(k, n, w):
        p = keys[k][1]
        return p[n][w] if n in p else V((0, 0, 0))

    def tan(k, n, w):
        if k == 0 or k == len(ts) - 1:
            return V((0, 0, 0))
        return (val(k + 1, n, w) - val(k - 1, n, w)) / (ts[k + 1] - ts[k - 1])
    h00, h10 = 2 * u ** 3 - 3 * u ** 2 + 1, u ** 3 - 2 * u ** 2 + u
    h01, h11 = -2 * u ** 3 + 3 * u ** 2, u ** 3 - u ** 2
    out = Pose()
    for n in names:
        for w in (0, 1):
            out.g(n)[w] += val(i, n, w) * h00 + tan(i, n, w) * (h * h10) + val(i + 1, n, w) * h01 \
                + tan(i + 1, n, w) * (h * h11)
    return out


def ride(ph):
    p = Pose()
    s1, s2 = math.sin(ph), math.sin(2 * ph)
    p.l('board', z=0.010 * s1).r('board', 1.5 * math.sin(ph + 0.8), 2.0 * s1, 0)
    p.l('hips', 0, -0.012, -0.072 + 0.009 * s2).r('hips', -10 + 1.0 * s2, 2.0 * s1, -18)
    p.r('spine1', -4 + 1.5 * s2, -1.5 * s1, 9)
    p.r('spine2', -2 - 2.0 * s2, -1.0 * s1, 7)
    p.r('neck', 6, 0, 1).r('head', 7 + 2 * math.sin(2 * ph + 0.6), 3 * math.sin(ph + 0.4), 0)
    p.rm('shoulder', 0, 4 + 2 * s2, 0)
    p.r('upperarm_L', 0, 38 + 4 * s1, -22).r('forearm_L', 0, 10, -25).r('hand_L', 0, -15, 0)
    p.r('upperarm_R', 0, -(30 - 4 * s1), -12).r('forearm_R', 0, -10, 18).r('hand_R', 0, 15, 0)
    p.r('tail_1', -4 + 3 * s1, 0, 40 + 8 * math.sin(ph))
    for k in range(2, 6):
        p.r(f'tail_{k}', -4 + 5 * math.sin(ph - 0.8 * k), 0, 5 + 8 * math.sin(ph - 0.8 * (k - 1)))
    p.rm('ear_1', 16 + 2 * s2, -6, 0).rm('ear_2', 10 + 5 * math.sin(2 * ph + 1), 0, 0)
    p.r('scarf_1_L', -8 + 9 * math.sin(2 * ph), 0, 12 * math.sin(2 * ph + 0.3))
    p.r('scarf_1_R', -8 + 9 * math.sin(2 * ph + 1.3), 0, -12 * math.sin(2 * ph + 1.6))
    p.r('scarf_2_L', 14 * math.sin(2 * ph - 1.0), 0, 18 * math.sin(2 * ph - 1.2))
    p.r('scarf_2_R', 14 * math.sin(2 * ph + 0.3), 0, -18 * math.sin(2 * ph + 0.1))
    p.l('ik_foot_L', -0.012, 0.10, 0).r('ik_foot_L', 0, 0, 22)
    p.l('ik_foot_R', 0.012, -0.10, 0).r('ik_foot_R', 0, 0, -28)
    return p


def lean(sign):
    """sign = −1: inclinación a la izquierda (−X); +1: a la derecha."""
    p = Pose()
    p.r('board', 0, 20 * sign, 0)
    p.l('hips', 0.035 * sign, 0, 0.004).r('hips', 0, 10 * sign, 0)
    p.r('spine1', 0, 5 * sign, 0).r('spine2', 0, 4 * sign, 0)
    p.r('neck', 0, -7 * sign, 0).r('head', 0, -9 * sign, 0)
    inner, outer = ('L', 'R') if sign < 0 else ('R', 'L')
    so = 1 if outer == 'L' else -1  # "arriba" para el brazo exterior
    p.r(f'upperarm_{outer}', 0, 42 * so, 12 * so).r(f'forearm_{outer}', 0, 15 * so, 0)
    p.r(f'upperarm_{inner}', 0, 22 * so, 0)
    p.r('tail_1', 0, 0, 18 if sign < 0 else -62).r('tail_2', 0, 0, 6 if sign < 0 else -14)
    p.rm('ear_1', 0, 0, 0).r(f'ear_1_{inner}', 0, -8 * sign, 0)
    return p


def anim_ride(f, n):
    return ride(TAU * f / n)


def anim_lean(sign):
    def fn(f, n):
        return ride(TAU * f / n).add(lean(sign))
    return fn


def anim_jump(f, n):
    t = f / n
    crouch = Pose().l('hips', 0, 0, -0.06).r('hips', -10).r('spine1', -8).r('head', 10).rm('upperarm', 0, -20, 20) \
        .r('tail_1', 12).rm('ear_1', 10)
    tuck = Pose().l('board', 0, 0, 0.17).r('board', 8).l('hips', 0, 0, 0.07).r('hips', -16).r('spine1', -10) \
        .r('spine2', -6).r('head', 14).rm('upperarm', 0, 5, -45).rm('forearm', 0, 10, -30) \
        .r('tail_1', -25).r('tail_2', -8).rm('ear_1', 25).rm('ear_2', 12).rm('scarf_1', -20)
    tuck2 = Pose().add(tuck).r('board', 4).rm('upperarm', 0, 10, -5)
    ext = Pose().l('board', 0, 0, 0.02).l('hips', 0, 0, 0.075).r('hips', 6).r('spine1', 4).r('head', -4) \
        .rm('upperarm', 0, 30, 0).rm('forearm', 0, 10, 0).r('tail_1', -10).rm('ear_1', -4)
    off = spline(t, [(0, Pose()), (0.17, crouch), (0.38, tuck), (0.56, tuck2), (0.8, ext), (1.0, Pose())])
    return ride(TAU * f / 36).add(off)


def anim_land(f, n):
    t = f / n
    start = Pose().l('hips', 0, 0, 0.06).rm('upperarm', 0, 26, 0).r('tail_1', -8).rm('ear_1', -4)
    comp = Pose().l('hips', 0, 0, -0.085).r('hips', -12).r('spine1', -8).r('spine2', -4).r('head', 12) \
        .rm('upperarm', 0, -14, -8).rm('forearm', 0, 0, -10).l('board', 0, 0, -0.022).r('board', -3) \
        .r('tail_1', 20).r('tail_2', 8).rm('ear_1', -14).rm('ear_2', -16).rm('scarf_1', 15)
    reb = Pose().l('hips', 0, 0, 0.016).r('tail_1', -8).rm('ear_1', 10).rm('ear_2', 8)
    off = spline(t, [(0, start), (0.33, comp), (0.68, reb), (1.0, Pose())])
    return ride(TAU * f / 36).add(off)


def anim_boost(f, n):
    ph = TAU * f / n
    p = ride(ph)
    q = Pose().l('hips', 0, -0.03, -0.05).r('hips', -14).r('spine1', -12).r('spine2', -8) \
        .r('neck', 18).r('head', 20) \
        .rm('ear_1', 42).rm('ear_2', 18 + 5 * math.sin(2 * ph)) \
        .r('tail_1', 10, 0, -14).r('board', 3).l('board', 0, 0, 0.004 * math.sin(2 * ph))
    for sn in ('L', 'R'):
        k = 1 if sn == 'L' else -1
        p.set(f'upperarm_{sn}', -32 + 3 * math.sin(2 * ph), -22 * k, 0).set(f'forearm_{sn}', -10, 0, 0) \
            .set(f'hand_{sn}', -15, 0, 0)
    for k in range(2, 6):
        q.r(f'tail_{k}', 2, 0, 3 * math.sin(2 * ph - k))
    for sn in ('L', 'R'):
        q.r(f'scarf_1_{sn}', -12, 0, 8 * math.sin(2 * ph + (0 if sn == 'L' else 1.5)))
        q.r(f'scarf_2_{sn}', 0, 0, 14 * math.sin(2 * ph - 1 + (0 if sn == 'L' else 1.5)))
    return p.add(q)


def anim_hit(f, n):
    t = f / n
    jolt = Pose().l('hips', 0, -0.01, 0.035).r('hips', 10).r('spine1', 10).r('spine2', 4).r('neck', 0).r('head', 2) \
        .rm('upperarm', 0, 95, 12).rm('forearm', 0, 25, 0).rm('hand', 0, 20, 0) \
        .rm('ear_1', -16, 8, 0).rm('ear_2', -8).r('tail_1', -22).r('tail_2', -8).r('tail_3', -6) \
        .r('board', -8, 14, 0).l('board', 0, 0, 0.02)
    sway = Pose().add(jolt, 0.85).r('board', 14, -26, 4).r('hips', 0, 8, 0).rm('upperarm', 0, -10, 0)
    rec = Pose().add(jolt, 0.35).r('board', -4, 7, 0).r('hips', 0, -5, 0)
    rec2 = Pose().r('board', 0, -3, 0).rm('upperarm', 0, 10, 0)
    off = spline(t, [(0, Pose()), (0.14, jolt), (0.36, sway), (0.58, rec), (0.8, rec2), (1.0, Pose())])
    return ride(TAU * f / 36).add(off)


def anim_smash(f, n):
    t = f / n
    wind = Pose().r('spine1', 0, 0, -12).r('spine2', 0, 0, -6).r('upperarm_R', -25, -10, -25) \
        .r('forearm_R', 0, -30, 0).l('hips', 0, 0, -0.02).r('tail_1', 0, 0, 15).rm('ear_1', 6)
    hit = Pose().r('spine1', -6, 0, 12).r('spine2', -4, 0, 8).r('hips', 0, 0, 4) \
        .r('upperarm_R', 80, 30, 38).r('forearm_R', 0, 10, -18).r('hand_R', 0, -15, 0) \
        .r('upperarm_L', -20, -10, 20).r('tail_1', 0, 0, -30).r('tail_2', 0, 0, -10).rm('ear_1', 10) \
        .l('hips', 0, 0.02, 0.0)
    hold = Pose().add(hit, 0.8)
    off = spline(t, [(0, Pose()), (0.25, wind), (0.5, hit), (0.7, hold), (1.0, Pose())])
    return ride(TAU * f / 36).add(off)


ANIMS = [  # nombre, fotogramas (a 30 fps), función, bucle
    ('ride', 36, anim_ride, True),
    ('leanL', 36, anim_lean(-1), True),
    ('leanR', 36, anim_lean(1), True),
    ('jump', 21, anim_jump, False),
    ('land', 9, anim_land, False),
    ('boost', 15, anim_boost, True),
    ('hit', 15, anim_hit, False),
    ('smash', 11, anim_smash, False),
]

LEG = [f'{b}_{s}' for s in ('L', 'R') for b in ('thigh', 'shin', 'foot')]
LOC_BONES = ('root', 'board', 'hips')


def apply_pose(rig, pose):
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    for n, (r, l) in pose.items():
        pb = rig.pose.bones[n]
        Rq = pb.bone.matrix_local.to_quaternion()
        qw = Euler([math.radians(a) for a in r], 'XYZ').to_quaternion()
        pb.rotation_quaternion = Rq.inverted() @ qw @ Rq
        pb.location = Rq.inverted() @ l
    bpy.context.view_layer.update()


def capture(rig):
    """Pose actual -> {hueso: (cuaternión, posición)} en espacio local, con las piernas ya resueltas por IK."""
    out = {}
    for pb in rig.pose.bones:
        if not pb.bone.use_deform and pb.name != 'root':
            continue
        if pb.name in LEG:
            par = pb.parent
            rel = par.bone.matrix_local.inverted() @ pb.bone.matrix_local
            basis_m = (par.matrix @ rel).inverted() @ pb.matrix
            out[pb.name] = (basis_m.to_quaternion(), V((0, 0, 0)))
        else:
            out[pb.name] = (pb.rotation_quaternion.copy(), pb.location.copy())
    return out


# =================================================================== vistas previas
def setup_render():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 24
    except Exception:
        pass
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    world = bpy.data.worlds.new('W')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*hexc('#9cb4d6'), 1)
    bg.inputs['Strength'].default_value = 0.9
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.4
    sun.color = hexc('#fff0d6')
    sun.angle = math.radians(6)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    to_light = V((-0.45, 0.35, 0.82)).normalized()
    so.rotation_euler = (-to_light).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.cameras.new('Cam')
    cam.lens = 50
    co = bpy.data.objects.new('Cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.fps = FPS
    # suelo: sombra de contacto
    gv = [(-3, -3, -0.35), (3, -3, -0.35), (3, 3, -0.35), (-3, 3, -0.35)]
    g = lib.mesh_obj('ground', gv, [(0, 1, 2, 3)], lib.material('ground', hexc('#b7c9a8'), rough=1.0))
    return co


def render(path, cam_dir, target=None, dist=2.4, res=420):
    sc = bpy.context.scene
    co = sc.camera
    target = target or P(0, 0, 0.42)
    d = V(cam_dir).normalized()
    co.location = target + d * dist
    co.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def sheet(files, cols, out):
    import numpy as np
    imgs = [bpy.data.images.load(f, check_existing=False) for f in files]
    w, h = imgs[0].size
    rows = (len(imgs) + cols - 1) // cols
    canvas = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for k, im in enumerate(imgs):
        px = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        r, c = divmod(k, cols)
        r = rows - 1 - r
        canvas[r * h:(r + 1) * h, c * w:(c + 1) * w] = px
    oi = bpy.data.images.new('sheet', cols * w, rows * h, alpha=True)
    oi.pixels.foreach_set(canvas.ravel())
    oi.filepath_raw = out
    oi.file_format = 'PNG'
    oi.save()
    for im in imgs:
        bpy.data.images.remove(im)
    bpy.data.images.remove(oi)
    for f in files:
        os.remove(f)
    print('SHEET', out)


VIEWS = {
    'front': (0, 1, 0.12),
    'game': (0, -1, 0.55),
    'q34': (0.85, 0.9, 0.35),
    'side': (1, 0, 0.08),
    'backq': (-0.7, -0.8, 0.45),
    'top': (0.0, -0.35, 1.0),
}


def static_previews(rig, tag, pose):
    apply_pose(rig, pose)
    files = []
    for k in ('front', 'q34', 'side', 'game', 'backq', 'top'):
        files.append(render(os.path.join(PREV_DIR, f'_{tag}_{k}.png'), VIEWS[k]))
    sheet(files, 3, os.path.join(PREV_DIR, f'{tag}.png'))


def face_preview(rig, pose):
    apply_pose(rig, pose)
    files = [render(os.path.join(PREV_DIR, '_face_a.png'), (0, 1, 0.08), HC + V((0, 0.05, 0)), 0.9, 420),
             render(os.path.join(PREV_DIR, '_face_b.png'), (0.6, 0.8, 0.15), HC + V((0, 0.05, 0)), 0.9, 420)]
    sheet(files, 2, os.path.join(PREV_DIR, 'face.png'))


# =================================================================== principal
def main():
    lib.reset()
    os.makedirs(PREV_DIR, exist_ok=True)
    bpy.context.scene.render.fps = FPS
    make_materials()
    build_bones()
    G = Rig()
    build_head(G)
    t_head = G.tris()
    parts = []
    for fn in (build_torso, build_legs, build_arms, build_tail, build_scarf):
        t = G.tris()
        fn(G)
        parts.append(f'{fn.__name__[6:]} {G.tris() - t}')
    print('TRIS por pieza:', ', '.join(parts))
    t_fox = G.tris()
    build_board(G)
    t_all = G.tris()
    print(f'TRIS cabeza {t_head}, zorro {t_fox}, tabla {t_all - t_fox}, total {t_all}')
    body = build_mesh(G)
    rig = build_armature()
    mod = body.modifiers.new('Armature', 'ARMATURE')  # sin emparentar: la malla queda en la raíz del glTF
    mod.object = rig
    setup_ik(rig)

    if PREVIEW:
        setup_render()
        static_previews(rig, 'rest', Pose())
        static_previews(rig, 'ride', ride(0.0))
        face_preview(rig, ride(0.0))
    if STATIC:
        return

    # pasada 1: poses + IK -> valores locales (y fotogramas de muestra)
    data = {}
    for name, n, fn, loop in ANIMS:
        frames = []
        for f in range(n + 1):
            apply_pose(rig, fn(f, n))
            frames.append(capture(rig))
        data[name] = frames
        if PREVIEW:
            picks = sorted(set(int(round(n * k)) for k in ((0, 0.25, 0.5, 0.75) if loop else (0, 0.2, 0.4, 0.6, 0.8, 1.0))))
            files = []
            for view in ('game', 'q34', 'side'):
                for f in picks:
                    apply_pose(rig, fn(f, n))
                    files.append(render(os.path.join(PREV_DIR, f'_{name}_{view}_{f}.png'), VIEWS[view], dist=2.6, res=300))
            sheet(files, len(picks), os.path.join(PREV_DIR, f'anim_{name}.png'))

    # pasada 2: fuera IK y auxiliares; claves FK
    for pb in rig.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
    lib.select_only(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for n in [b for b in BONES if not BONES[b][3] and b != 'root']:
        rig.data.edit_bones.remove(rig.data.edit_bones[n])
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'

    ad = rig.animation_data_create()
    for name, n, fn, loop in ANIMS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        prev = {}
        for f, pose in enumerate(data[name]):
            for bn, (q, l) in pose.items():
                pb = rig.pose.bones[bn]
                q = q.copy()
                if bn in prev and prev[bn].dot(q) < 0:
                    q.negate()
                prev[bn] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert('rotation_quaternion', frame=f, group=bn)
                if bn in LOC_BONES:
                    pb.location = l
                    pb.keyframe_insert('location', frame=f, group=bn)
        act.use_frame_range = True
        act.frame_start, act.frame_end = 0, n
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, act)
        ad.action = None
    for pb in rig.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)

    # exportación
    for o in bpy.context.scene.objects:
        o.select_set(o in (rig, body))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT',
        export_vertex_color='MATERIAL', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_cameras=False, export_lights=False,
        export_extras=False, export_skins=True, export_animations=True, export_animation_mode='ACTIONS',
        export_frame_range=False, export_force_sampling=True, export_optimize_animation_size=True,
        export_reset_pose_bones=True, export_rest_position_armature=True, export_def_bones=False,
        export_morph=False)
    print(f'EXPORT fox.glb {os.path.getsize(OUT) / 1024:.1f} KB, {t_all} tris')


main()
