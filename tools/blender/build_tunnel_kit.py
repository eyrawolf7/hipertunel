"""Kit modular del túnel de Hipertúnel: losetas de piedra tallada, cristal y cajas.

Uso:
  blender --background --python tools/blender/build_tunnel_kit.py                 # todo
  blender --background --python tools/blender/build_tunnel_kit.py -- --no-tex      # reusar texturas
  blender --background --python tools/blender/build_tunnel_kit.py -- --no-preview  # sin renders

Salida en app/src/assets/kit/:
  tunnel_kit.glb  tile_stone, tile_arch, tile_crystal, tile_crystal_arch, rib_ring
  boxes_kit.glb   box_block, box_crystal
  stone_albedo.jpg, stone_normal.png, stone_orm.jpg, crystal_normal.png, crystal_albedo.jpg

Ejes de la loseta (glTF, tal y como los lee Three.js):
  X ∈ [-1.035, 1.035] a lo ancho de la celda (costuras con los carriles vecinos en ±1.035)
  Y = altura sobre la celda, +Y hacia DENTRO del túnel (hacia el eje). Superficie en Y=0,
      losa hasta Y=-0.35, costillas de Y=-0.34 a -0.98.
  Z ∈ [0, 4] a lo largo de la vía (Z=0 anillo cercano).
Las caras laterales van a inglete de 15° (X = ±(1.035 + (-Y)·tan15°)) para que 12 losas
cierren el dodecágono sin huecos por fuera.

"Horneado": el alto detalle es una escultura en campo de alturas (1024×896 muestras, con
biseles redondeados, desconchones, grietas, musgo y hiedra) que se hornea analíticamente
al espacio tangente de la loseta (plana, UV planar => equivalente exacto a MikkTSpace).
Todo es periódico, así que las texturas casan en los cuatro bordes.
"""
import bpy
import bmesh
import math
import os
import struct
import sys
import time
import zlib

import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402

KIT = os.path.join(lib.ASSETS, 'kit')
PREV = lib.PREVIEWS
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []

# ------------------------------------------------------------------ medidas de la celda
HW, W, L, T = 1.035, 2.07, 4.0, 0.35
NC = 6
CL = L / NC                       # largo de hilada 0.667
TAN15 = math.tan(math.radians(15))
HWB = HW + T * TAN15              # semiancho en la cara exterior (inglete)
JE = [-HW, -0.345, 0.345, HW]     # juntas hiladas pares
JO = [-HW, -0.69, 0.0, 0.69, HW]  # juntas hiladas impares (aparejo a soga)
# sillería de la textura: losas grandes, una por carril y hilada (el concepto C·3); a ladrillitos
# se leía recargado a toda velocidad. La geometría sigue usando CL (ventanas y cristales).
TNC = 4
TCL = L / TNC                     # 1 m por hilada
TJE = [-HW, 0.0, HW]              # dos sillares por carril, a soga
TJO = [-HW, -0.52, 0.52, HW]
G = 0.024                         # media llaga (referencia)
GI, GS = 0.011, 0.022             # media llaga interior / en la costura de carril

# ventana (media ventana a lo largo de cada costura)
WZ0, WZ1, WR = 0.35, 3.65, 0.34
CH_T, CH_B = 0.035, 0.0         # chaflanes de la jamba arriba / abajo
NARC = 6

# ------------------------------------------------------------------ atlas
RES = 1024
TOPV = 0.875                      # región superior: v ∈ [0, 0.875] = 4 m
NZ = int(RES * TOPV)              # 896 filas
PAD = 4
STRIP_U = 0.86                    # franja de jambas: u ∈ [0, 0.86], v ∈ [0.875, 1]
SV0, SV1 = (NZ + PAD) / RES, (RES - PAD) / RES
LEAF_C0 = 896                     # muestra de hoja: columnas 896..1023, filas 896..1023
PL = CH_T * math.sqrt(2) + (T - CH_T - CH_B) + CH_B * math.sqrt(2)   # perfil de la jamba


def srgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


# ================================================================== texturas
def pnoise(shape, dx, dz, lam, seed):
    """Ruido suave y periódico (filtro gaussiano en frecuencia). lam = tamaño del rasgo (m)."""
    rng = np.random.default_rng(seed)
    F = np.fft.fft2(rng.standard_normal(shape))
    fz = np.fft.fftfreq(shape[0], d=dz)[:, None]
    fx = np.fft.fftfreq(shape[1], d=dx)[None, :]
    s = lam / 3.0
    r = np.real(np.fft.ifft2(F * np.exp(-2 * math.pi ** 2 * s * s * (fx * fx + fz * fz))))
    r -= r.mean()
    return (r / (r.std() + 1e-12)).astype(np.float32)


def rrect(lx, lz, ax, az, r):
    qx = np.abs(lx) - (ax - r)
    qz = np.abs(lz) - (az - r)
    return np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qz, 0) ** 2) + np.minimum(np.maximum(qx, qz), 0) - r


def normals_from_height(H, dx, dz, strength=1.0):
    gx = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / (2 * dx) * strength
    gz = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / (2 * dz) * strength
    n = np.stack([-gx, -gz, np.ones_like(H)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def horizon_ao(H, dx, dz, radius=0.14, ndir=16, nstep=10, k=1.25):
    occ = np.zeros_like(H)
    for a in range(ndir):
        th = 2 * math.pi * (a + 0.5) / ndir
        cx, cz = math.cos(th), math.sin(th)
        best = np.zeros_like(H)
        last = None
        for s in range(1, nstep + 1):
            r = radius * (s / nstep) ** 1.6
            ox, oz = int(round(r * cx / dx)), int(round(r * cz / dz))
            if (ox, oz) == (0, 0) or (ox, oz) == last:
                continue
            last = (ox, oz)
            dist = math.hypot(ox * dx, oz * dz)
            best = np.maximum(best, (np.roll(H, (-oz, -ox), (0, 1)) - H) / dist)
        occ += best / np.sqrt(1 + best * best)
    return np.clip(1 - k * occ / ndir, 0.15, 1.0)


def seg_dist(px, pz, a, b):
    ax, az = a
    bx, bz = b
    vx, vz = bx - ax, bz - az
    ll = vx * vx + vz * vz + 1e-12
    t = np.clip(((px - ax) * vx + (pz - az) * vz) / ll, 0, 1)
    return np.hypot(px - (ax + t * vx), pz - (az + t * vz)), t


def wrapd(d, period):
    return (d + period / 2) % period - period / 2


def catmull2(pts, per=8):
    return [tuple(p)[:2] for p in lib.catmull([(x, z, 0) for x, z in pts], per)]


class Paint:
    """Capas de la escultura: altura H, albedo A (sRGB), rugosidad R."""

    def __init__(self, H, A, R):
        self.H, self.A, self.R = H, A, R


def leaf_shape(a, b, La, Wb):
    s = a / La
    w = Wb * np.clip(np.sin(math.pi * np.clip(s, 0, 1) ** 0.7), 0, 1) ** 0.85 * (1 - 0.3 * np.clip(s, 0, 1))
    inside = (s >= 0) & (s <= 1) & (np.abs(b) < w)
    return inside, s, w


LEAF_DARK, LEAF_MID, LEAF_LIT, LEAF_VEIN = srgb('#3f7a26'), srgb('#5f9e32'), srgb('#8cc24c'), srgb('#b5dc72')
STEM = srgb('#6c6a34')


def draw_ivy(P, XX, ZZ, path, rng, per_m=22, size=(0.05, 0.075), wrapx=W, wrapz=L, stem_w=0.0045,
             lit_dir=(0.6, 0.8)):
    """Pinta una rama de hiedra (tallo + hojas) en la escultura. path en metros."""
    pts = catmull2(path, 10)
    H, A, R = P.H, P.A, P.R
    # tallo
    for a, b in zip(pts, pts[1:]):
        dxa = wrapd(XX - a[0], wrapx)
        dza = wrapd(ZZ - a[1], wrapz)
        d, _ = seg_dist(dxa, dza, (0, 0), (b[0] - a[0], b[1] - a[1]))
        m = d < stem_w
        if not m.any():
            continue
        prof = np.sqrt(np.clip(1 - (d[m] / stem_w) ** 2, 0, 1))
        hs = H[m] + 0.004 * prof
        H[m] = np.maximum(H[m], hs)
        A[m] = lerp(A[m], STEM * (0.8 + 0.3 * prof[:, None]), 0.95)
        R[m] = 0.7
    # hojas alternas
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts, pts[1:]))
    n = max(2, int(length * per_m))
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for i in range(n):
        tpos = (i + 0.5) / n * length
        j = min(range(len(cum) - 1), key=lambda k: abs(cum[k] - tpos))
        a, b = pts[j], pts[j + 1]
        tx, tz = b[0] - a[0], b[1] - a[1]
        tl = math.hypot(tx, tz) + 1e-9
        tx, tz = tx / tl, tz / tl
        side = 1 if i % 2 == 0 else -1
        ang = math.atan2(tz, tx) + side * rng.uniform(0.7, 1.25)
        La = rng.uniform(*size)
        Wb = La * rng.uniform(0.42, 0.52)
        cx, cz = a[0] + tx * 0.0, a[1] + tz * 0.0
        ca, sa = math.cos(ang), math.sin(ang)
        dxa = wrapd(XX - cx, wrapx)
        dza = wrapd(ZZ - cz, wrapz)
        near = (np.abs(dxa) < La * 1.1) & (np.abs(dza) < La * 1.1)
        if not near.any():
            continue
        la = dxa[near] * ca + dza[near] * sa
        lb = -dxa[near] * sa + dza[near] * ca
        ins, s, w = leaf_shape(la, lb, La, Wb)
        if not ins.any():
            continue
        idx = np.flatnonzero(near)[ins]
        bb = lb[ins] / (w[ins] + 1e-9)
        ss = s[ins]
        base_h = np.max(H.flat[idx]) if idx.size else 0
        hl = base_h + 0.003 + 0.0045 * (1 - bb * bb) * np.sin(math.pi * ss) - 0.0012 * np.exp(-(lb[ins] / 0.0018) ** 2)
        vis = hl >= H.flat[idx] - 0.001
        idx, bb, ss, hl = idx[vis], bb[vis], ss[vis], hl[vis]
        H.flat[idx] = np.maximum(H.flat[idx], hl)
        # color: mitad iluminada más clara, borde más oscuro, nervio claro
        lit = 0.5 + 0.5 * np.sign(bb) * (ca * lit_dir[1] - sa * lit_dir[0]) * side
        col = lerp(LEAF_MID, LEAF_LIT, (0.25 + 0.55 * lit * (1 - np.abs(bb)) + 0.2 * ss)[:, None])
        col = lerp(col, LEAF_DARK, (np.clip(np.abs(bb) - 0.72, 0, 1) / 0.28)[:, None] * 0.8)
        vein = np.exp(-(np.abs(bb) * w[ins][vis] / 0.0015) ** 2) * (ss < 0.85)
        col = lerp(col, LEAF_VEIN, vein[:, None] * 0.6)
        A.reshape(-1, 3)[idx] = col
        R.flat[idx] = 0.5


def stone_top(seed=11):
    """Escultura de la cara superior (4 m × 2.07 m). Devuelve albedo, normal, ORM (filas de abajo arriba)."""
    NX, NZr = RES, NZ
    dx, dz = W / NX, L / NZr
    X = -HW + (np.arange(NX) + 0.5) * dx
    Z = (np.arange(NZr) + 0.5) * dz
    XX, ZZ = np.meshgrid(X, Z)
    XX = XX.astype(np.float32)
    ZZ = ZZ.astype(np.float32)
    rng = np.random.default_rng(seed)
    shape = XX.shape

    course = (np.floor(ZZ / TCL).astype(np.int32)) % TNC
    kk = np.zeros(shape, np.int32)
    jl = np.zeros(shape, np.float32)
    jr = np.zeros(shape, np.float32)
    for parity, J in ((0, TJE), (1, TJO)):
        m = (course % 2) == parity
        Ja = np.array(J, np.float32)
        idx = np.clip(np.searchsorted(Ja, XX[m], side='right') - 1, 0, len(J) - 2)
        kk[m] = idx
        jl[m] = Ja[idx]
        jr[m] = Ja[idx + 1]
    bid = course * 5 + kk
    NB = TNC * 5
    cx = (jl + jr) / 2
    hx = (jr - jl) / 2
    cz = (course + 0.5) * TCL
    hz = TCL / 2
    lx = XX - cx
    lz = ZZ - cz

    n_big = pnoise(shape, dx, dz, 0.9, seed + 1)
    n1 = pnoise(shape, dx, dz, 0.30, seed + 2)
    n2 = pnoise(shape, dx, dz, 0.09, seed + 3)
    n3 = pnoise(shape, dx, dz, 0.035, seed + 4)
    nm = pnoise(shape, dx, dz, 0.40, seed + 5)
    nm2 = pnoise(shape, dx, dz, 0.12, seed + 6)
    nmf = pnoise(shape, dx, dz, 0.02, seed + 7)

    # --- bloques: superficie tranquila, bisel firme; llaga ancha solo en la costura de carril
    base = rng.uniform(-0.003, 0.003, NB)
    tlx = rng.uniform(-0.008, 0.008, NB)
    tlz = rng.uniform(-0.006, 0.006, NB)
    dome = rng.uniform(0.002, 0.004, NB)
    gl = np.where(np.abs(jl + HW) < 1e-4, GS, GI)
    gr = np.where(np.abs(jr - HW) < 1e-4, GS, GI)
    bx0, bx1 = jl + gl, jr - gr
    ccx = (bx0 + bx1) / 2
    ax_ = (bx1 - bx0) / 2
    az_ = hz - GI
    llx = XX - ccx
    e = -rrect(llx, lz, ax_, az_, 0.035) + 0.0035 * n1 + 0.0012 * n2   # borde tallado a mano
    bw = 0.032
    t = np.clip(e / bw, 0, 1)
    prof = 0.45 * t + 0.55 * np.sqrt(1 - (1 - t) ** 2)
    top = (0.012 + base[bid] + tlx[bid] * lx + tlz[bid] * lz
           + dome[bid] * (1 - (lx / hx) ** 2) * (1 - (lz / hz) ** 2)
           + 0.0022 * n1 + 0.0006 * n2
           + 0.0009 * pnoise(shape, dx * 6, dz, 0.3, seed + 15))       # veta en relieve
    GR = -0.026 + 0.0015 * n2
    seam = np.clip(1 - (HW - np.abs(XX)) / 0.05, 0, 1)
    GR = GR - 0.008 * seam
    # caras labradas: planos anchos y suaves junto a algunos bordes (se lee a cincel, sin ruido)
    for b in range(NB):
        m = bid == b
        if not m.any():
            continue
        for _ in range(int(rng.random() < 0.5)):
            side = int(rng.integers(4))
            dist = [ax_[m] - llx[m], ax_[m] + llx[m], az_ - lz[m], az_ + lz[m]][side]
            fw, fd = rng.uniform(0.09, 0.2), rng.uniform(0.004, 0.009)
            top[m] = np.minimum(top[m], top[m] - fd + fd * np.clip(dist / fw, 0, 1))
    H = np.where(e > 0, GR + (top - GR) * prof, GR).astype(np.float32)

    # --- desconchones (solo en aristas y esquinas)
    chip = np.zeros(shape, np.float32)
    crack = np.zeros(shape, np.float32)
    for b in range(NB):
        m = bid == b
        if not m.any():
            continue
        axb = float(ax_[m][0])
        ox = float(ccx[m][0] - cx[m][0])
        az = az_
        for _ in range(int(rng.integers(2, 5))):
            if rng.random() < 0.5:
                px, pz = axb * rng.choice([-1, 1]), az * rng.choice([-1, 1])
            else:
                side = int(rng.integers(4))
                u = rng.uniform(-0.75, 0.75)
                px, pz = [(axb, u * az), (-axb, u * az), (u * axb, az), (u * axb, -az)][side]
            px += ox
            R_ = rng.uniform(0.05, 0.11)
            D_ = rng.uniform(0.016, 0.03)
            d = np.hypot(lx[m] - px, lz[m] - pz)
            hc = top[m] - D_ + D_ * np.clip(d / R_, 0, 1) ** 1.15
            nh = np.minimum(H[m], np.maximum(hc, GR[m]))
            chip[m] = np.maximum(chip[m], H[m] - nh)
            H[m] = nh
        # grietas que nacen en un borde (30 % de los bloques)
        for _ in range(int(rng.random() < 0.5)):
            side = int(rng.integers(4))
            u = rng.uniform(-0.6, 0.6)
            p = [(axb, u * az), (-axb, u * az), (u * axb, az), (u * axb, -az)][side]
            p = (p[0] + ox, p[1])
            ang = math.atan2(-p[1], -(p[0] - ox)) + rng.uniform(-0.6, 0.6)
            pts = [p]
            for _ in range(int(rng.integers(3, 6))):
                ang += rng.uniform(-0.7, 0.7)
                s_ = rng.uniform(0.035, 0.07)
                pts.append((pts[-1][0] + math.cos(ang) * s_, pts[-1][1] + math.sin(ang) * s_))
            nseg = len(pts) - 1
            for i, (a, c) in enumerate(zip(pts, pts[1:])):
                d, tt = seg_dist(lx[m], lz[m], a, c)
                taper = 1 - (i + tt) / nseg
                wcr = 0.006 * (0.35 + 0.65 * taper)
                f = np.clip(1 - d / wcr, 0, 1) ** 1.3 * np.clip(taper * 1.6, 0, 1)
                crack[m] = np.maximum(crack[m], f)
    H -= 0.009 * crack

    # --- musgo: a rodales (≈1/3 de las llagas), lamiendo algún borde; alguna mancha suelta
    F = 1.1 * (nm - 0.15) + 0.5 * nm2 - np.maximum(e, 0) / 0.012
    moss = sstep(0.0, 0.25, F)
    patch = sstep(0.1, 0.3, 0.8 * nm2 + 0.6 * nm - 2.0) * (e < 0.1)
    moss = np.maximum(moss, patch * 0.9)
    nmb = pnoise(shape, dx, dz, 0.045, seed + 8)
    Hm = np.maximum(GR + 0.014 + 0.0025 * nmb, H + 0.002 + 0.0012 * nmb)
    H = lerp(H, np.maximum(H, Hm), moss).astype(np.float32)

    # --- albedo (sRGB): arenisca cálida, variada por bloque, sin ruido fino
    pal = np.stack([srgb(c) for c in ('#d6c39c', '#d0bb92', '#dac7a3', '#cfbc96')])
    pidx = rng.integers(0, len(pal), NB)
    vgain = rng.uniform(0.96, 1.04, NB)
    gdx = rng.uniform(-1, 1, NB)
    gdz = rng.uniform(-1, 1, NB)
    # veta de la piedra a lo largo de la vía (ruido estirado en Z) y manchas de intemperie
    grain = pnoise(shape, dx * 6, dz, 0.35, seed + 12)
    grain2 = pnoise(shape, dx * 3, dz, 0.12, seed + 13)
    stain = pnoise(shape, dx, dz, 0.22, seed + 14)
    A = pal[pidx[bid]] * (vgain[bid] * (1 + 0.03 * n_big + 0.025 * n1 + 0.012 * grain + 0.008 * grain2
                                        - 0.03 * sstep(0.8, 2.0, stain)
                                        + 0.035 * (gdx[bid] * lx / hx + gdz[bid] * lz / hz)))[..., None]
    warm = pnoise(shape, dx, dz, 0.5, seed + 9)
    A = A * (1 + np.stack([0.025 * warm, 0.0 * warm, -0.03 * warm], -1))   # moteado cálido/frío suave
    rim = np.clip((e - 0.03) / 0.07, 0, 1)
    A = A * (0.94 + 0.06 * rim)[..., None]                     # cara del sillar un poco más oscura junto al bisel
    wear = np.clip(1 - np.abs(e - 0.012) / 0.014, 0, 1) * (e > 0)
    A = A * (1 + 0.12 * wear)[..., None]                       # arista gastada, más clara
    A = lerp(A, srgb('#dccaa2'), np.clip(chip / 0.01, 0, 1)[..., None] * 0.6)  # piedra fresca
    grout_c = lerp(srgb('#8f7a58'), srgb('#5e4c33'), seam[..., None])
    A = lerp(A, grout_c, sstep(0.003, -0.003, e)[..., None])
    A = lerp(A, srgb('#6a5638'), (crack * 0.8)[..., None])

    R = np.full(shape, 0.84, np.float32) + 0.03 * n1
    R = np.where(e < 0, 0.93, R)

    moss_c = lerp(srgb('#66763a'), srgb('#8c9a55'), np.clip(0.5 + 0.5 * nmb, 0, 1)[..., None])
    moss_c = lerp(moss_c, srgb('#44652a'), sstep(0.004, -0.01, e)[..., None] * 0.5)
    A = lerp(A, moss_c, moss[..., None])
    R = lerp(R, 0.9, moss)

    P = Paint(H, A.astype(np.float32), R.astype(np.float32))
    # (sin hiedra en la cara del carril: de cerca parecía un objeto en la pista y su verde competía
    # con el aviso de caja verde; las enredaderas van por fuera del tubo)
    H, A, R = P.H, P.A, P.R

    # --- horneado: normal (espacio tangente T=+u, B=+v) y AO
    N = normals_from_height(H, dx, dz)
    AO = horizon_ao(H, dx, dz, radius=0.09)
    A = A * (0.8 + 0.2 * AO)[..., None]                        # cavidad pintada, suave
    return A, N, AO, R


def stone_strip(seed=23):
    """Franja de jambas/laterales: s a lo largo de la vía (4 m), p por el perfil de la jamba."""
    NXs = int(round(STRIP_U * RES))
    rows = RES - NZ - 2 * PAD
    ds, dp = L / NXs, PL / rows
    S = (np.arange(NXs) + 0.5) * ds
    Pp = PL - (np.arange(rows) + 0.5) * dp               # fila 0 (abajo) = p máximo (cara exterior)
    SS, PP = np.meshgrid(S, Pp)
    shape = SS.shape
    rng = np.random.default_rng(seed)
    n1 = pnoise(shape, ds, dp, 0.25, seed + 1)
    n2 = pnoise(shape, ds, dp, 0.08, seed + 2)
    nm = pnoise(shape, ds, dp, 0.3, seed + 3)
    nmf = pnoise(shape, ds, dp, 0.02, seed + 4)
    c = np.floor(SS / TCL)
    ls = SS - (c + 0.5) * TCL
    e = (TCL / 2 - GI) - np.abs(ls) + 0.003 * n1
    t = np.clip(e / 0.032, 0, 1)
    top = 0.01 + 0.002 * n1 + 0.004 * (1 - (ls / (TCL / 2)) ** 2)
    GR = -0.028
    H = np.where(e > 0, GR + (top - GR) * (0.45 * t + 0.55 * np.sqrt(1 - (1 - t) ** 2)), GR)
    # desconchones en la arista superior
    chip = np.zeros(shape)
    for _ in range(14):
        s0 = rng.uniform(0, L)
        R_ = rng.uniform(0.04, 0.09)
        D_ = rng.uniform(0.01, 0.02)
        d = np.hypot(wrapd(SS - s0, L), PP * 1.3)
        hc = top - D_ + D_ * np.clip(d / R_, 0, 1) ** 1.3
        nh = np.minimum(H, np.maximum(hc, GR))
        chip = np.maximum(chip, H - nh)
        H = nh
    # musgo que cuelga del borde superior y en las llagas
    drip = 0.012 + 0.06 * np.clip(nm - 0.4, 0, None) + 0.008 * n2
    moss = np.maximum(sstep(0.006, -0.006, PP - drip), sstep(0.0, 0.25, 1.1 * (nm - 0.4) - np.maximum(e, 0) / 0.012))
    H = lerp(H, np.maximum(H, H + 0.002 + 0.0012 * nmf), moss)
    pal = np.stack([srgb(c_) for c_ in ('#c9b089', '#c0a67f', '#cdb892')])
    blk = c.astype(np.int64) % 3
    A = pal[blk] * (1 + 0.03 * n1)[..., None]
    A = A * (1 - 0.1 * np.clip(PP / PL, 0, 1))[..., None]          # un poco más oscura hacia fuera
    A = lerp(A, srgb('#e5d8b8'), np.clip(chip / 0.01, 0, 1)[..., None] * 0.5)
    A = A * (1 + 0.10 * np.clip(1 - np.abs(PP - 0.012) / 0.012, 0, 1))[..., None]   # arista clara
    A = lerp(A, srgb('#8f7a58'), sstep(0.003, -0.003, e)[..., None])
    moss_c = lerp(srgb('#66763a'), srgb('#8c9a55'), np.clip(0.5 + 0.4 * nmf, 0, 1)[..., None])
    A = lerp(A, moss_c, moss[..., None])
    R = np.where(e < 0, 0.93, 0.85 + 0.03 * n1)
    R = lerp(R, 0.9, moss)
    N = normals_from_height(H, ds, dp)
    N[..., 1] *= -1        # p crece hacia abajo (−v): el gradiente en v cambia de signo
    AO = horizon_ao(H, ds, dp, radius=0.08)
    A = A * (0.8 + 0.2 * AO)[..., None]
    return A, N, AO, R, NXs, rows


def leaf_swatch(n=128):
    """Una hoja pintada (128×128) para la hiedra de geometría. a: a lo largo de u, b: a lo largo de v."""
    px = 1.0 / n
    a = (np.arange(n) + 0.5) * px
    b = (np.arange(n) - n / 2 + 0.5) * px
    AA, BB = np.meshgrid(a, b)
    La, Wb = 0.92, 0.46
    ins, s, w = leaf_shape(AA - 0.04, BB, La, Wb)
    bb = np.clip(BB / (w + 1e-6), -1, 1)
    H = np.where(ins, 0.02 + 0.03 * (1 - bb * bb) * np.sin(math.pi * np.clip(s, 0, 1)), 0.0)
    H -= 0.006 * np.exp(-(np.abs(BB) / 0.012) ** 2) * ins
    lit = 0.5 + 0.5 * np.sign(bb)
    col = lerp(LEAF_MID, LEAF_LIT, (0.25 + 0.5 * lit * (1 - np.abs(bb)) + 0.2 * s)[..., None])
    col = lerp(col, LEAF_DARK, (np.clip(np.abs(bb) - 0.7, 0, 1) / 0.3)[..., None] * 0.8)
    col = lerp(col, LEAF_VEIN, (np.exp(-(np.abs(BB) / 0.01) ** 2) * (s < 0.85))[..., None] * 0.6)
    col = np.where(ins[..., None], col, LEAF_DARK)
    N = normals_from_height(H, px, px, strength=0.35)
    return col, N


def build_stone_textures():
    t0 = time.time()
    A = np.zeros((RES, RES, 3), np.float32)
    N = np.zeros((RES, RES, 3), np.float32)
    N[..., 2] = 1
    AO = np.full((RES, RES), 0.6, np.float32)
    R = np.full((RES, RES), 0.92, np.float32)
    A[:] = srgb('#6f6443')
    a, n, ao, r = stone_top()
    A[:NZ], N[:NZ], AO[:NZ], R[:NZ] = a, n, ao, r
    a, n, ao, r, nxs, rows = stone_strip()
    r0 = NZ + PAD
    A[r0:r0 + rows, :nxs], N[r0:r0 + rows, :nxs], AO[r0:r0 + rows, :nxs], R[r0:r0 + rows, :nxs] = a, n, ao, r
    la, ln = leaf_swatch()
    A[NZ:, LEAF_C0:] = la
    N[NZ:, LEAF_C0:] = ln
    AO[NZ:, LEAF_C0:] = 1.0
    R[NZ:, LEAF_C0:] = 0.5
    # piedra neutra: luminancia media de la región de piedra = 0.5 (el juego la retiñe por mundo)
    lum = (0.2126 * A[..., 0] + 0.7152 * A[..., 1] + 0.0722 * A[..., 2])
    gain = 0.5 / lum[:NZ].mean()
    A *= gain
    lum = (0.2126 * A[..., 0] + 0.7152 * A[..., 1] + 0.0722 * A[..., 2])
    print(f'albedo: ganancia {gain:.3f}, luminancia media región superior {lum[:NZ].mean():.3f}')
    for nm_, X_ in (('albedo', A[:NZ]), ('normal', N[:NZ]), ('ao', AO[:NZ, :, None])):
        bu = np.abs(X_[:, 0] - X_[:, -1]).mean()
        iu = np.abs(X_[:, 1] - X_[:, 0]).mean()
        bv = np.abs(X_[0] - X_[-1]).mean()
        iv = np.abs(X_[1] - X_[0]).mean()
        print(f'costura {nm_}: borde u {bu:.4f} (interior {iu:.4f}) | borde v {bv:.4f} (interior {iv:.4f})')
    os.makedirs(KIT, exist_ok=True)
    save_jpg(os.path.join(KIT, 'stone_albedo.jpg'), np.clip(A, 0, 1), 92)
    save_png(os.path.join(KIT, 'stone_normal.png'), N * 0.5 + 0.5)
    orm = np.stack([AO, np.clip(R, 0, 1), np.zeros_like(AO)], -1)
    save_jpg(os.path.join(KIT, 'stone_orm.jpg'), orm, 90)
    print(f'texturas de piedra en {time.time() - t0:.1f}s')


def build_crystal_textures(seed=5):
    """Cristal de aviso: paneles limpios (3 a lo largo, como la geometría) con el centro más
    oscuro, el canto luminoso y un filete interior; abombado suave para que pille los brillos.
    (Antes eran facetas de Voronoi y se leían como plástico roto.)"""
    n = 512
    dx, dz = W / n, L / n
    X = (np.arange(n) + 0.5) * dx - HW
    Z = (np.arange(n) + 0.5) * dz
    XX, ZZ = np.meshgrid(X, Z)
    m = 0.05
    k = np.clip(np.floor(ZZ / (2 * CL)), 0, 2)
    cz = (k + 0.5) * 2 * CL
    hz = CL - m
    hx = HW - m
    # distancia al borde del panel (en metros) y posición normalizada
    ex = hx - np.abs(XX)
    ez = hz - np.abs(ZZ - cz)
    e = np.minimum(ex, ez)
    ux, uz = XX / hx, (ZZ - cz) / hz
    rim = np.exp(-np.clip(e, 0, None) / 0.07)                      # canto luminoso
    inset = np.exp(-((e - 0.16) / 0.012) ** 2)                      # filete interior
    centre = np.clip(1 - np.maximum(np.abs(ux), np.abs(uz)), 0, 1)
    alb = 0.62 + 0.1 * (1 - centre) + 0.3 * rim + 0.14 * inset
    save_jpg(os.path.join(KIT, 'crystal_albedo.jpg'), np.repeat(np.clip(alb, 0, 1)[..., None], 3, -1), 90)
    # abombado: altura suave con máximo en el centro, y una ranura en el filete
    Hh = 0.012 * (1 - ux ** 2) * (1 - uz ** 2) - 0.0015 * inset
    gx = np.gradient(Hh, dx, axis=1)
    gz = np.gradient(Hh, dz, axis=0)
    N = np.stack([-gx, -gz, np.ones_like(gx)], -1)
    N /= np.linalg.norm(N, axis=-1, keepdims=True)
    save_png(os.path.join(KIT, 'crystal_normal.png'), N * 0.5 + 0.5)


# ------------------------------------------------------------------ guardar imágenes
def save_png(path, rgb01):
    """PNG RGB de 8 bits (sin gestión de color). rgb01 con filas de abajo arriba (como Blender)."""
    arr = np.clip(np.round(rgb01 * 255), 0, 255).astype(np.uint8)[::-1]
    h, w, _ = arr.shape
    best = None
    for ftype in (1, 2):
        a = arr.astype(np.int16)
        if ftype == 1:
            f = a.copy()
            f[:, 1:] = (a[:, 1:] - a[:, :-1]) % 256
        else:
            f = a.copy()
            f[1:] = (a[1:] - a[:-1]) % 256
        raw = np.concatenate([np.full((h, 1), ftype, np.uint8), f.astype(np.uint8).reshape(h, w * 3)], 1)
        data = zlib.compress(raw.tobytes(), 9)
        if best is None or len(data) < len(best):
            best = data

    def chunk(tag, d):
        return struct.pack('>I', len(d)) + tag + d + struct.pack('>I', zlib.crc32(tag + d) & 0xffffffff)
    png = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', best) + chunk(b'IEND', b''))
    with open(path, 'wb') as fh:
        fh.write(png)
    print(f'  {os.path.basename(path)} {len(png) / 1024:.0f} KB')


def save_jpg(path, rgb01, quality=90):
    h, w, _ = rgb01.shape
    img = bpy.data.images.new('tmp_save', w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color'
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = rgb01
    img.pixels.foreach_set(px.ravel())
    img.file_format = 'JPEG'
    img.filepath_raw = path
    img.save(filepath=path, quality=quality)
    bpy.data.images.remove(img)
    print(f'  {os.path.basename(path)} {os.path.getsize(path) / 1024:.0f} KB')


# ================================================================== geometría
def tb(p):
    """Coordenadas de loseta (X, Y altura, Z vía) -> Blender (Z arriba). glTF Y-up devuelve (X, Y, Z)."""
    return (p[0], -p[2], p[1])


class MB:
    """Constructor de mallas en coordenadas de loseta con UV y color por esquina."""

    def __init__(self):
        self.v, self.key, self.f = [], {}, []

    def vid(self, p):
        k = (round(p[0], 5), round(p[1], 5), round(p[2], 5))
        if k not in self.key:
            self.key[k] = len(self.v)
            self.v.append(tuple(float(c) for c in p))
        return self.key[k]

    def face(self, pts, uvs, mat=0, hint=None, cols=None):
        cols = cols or [(1, 1, 1)] * len(pts)
        seq = []
        for p, uv, c in zip(pts, uvs, cols):
            i = self.vid(p)
            if seq and seq[-1][0] == i:
                continue
            seq.append((i, tuple(uv), tuple(c)))
        if len(seq) > 1 and seq[0][0] == seq[-1][0]:
            seq.pop()
        if len(seq) < 3 or len({s[0] for s in seq}) < len(seq):
            return
        if hint is not None:
            P = [Vector(self.v[s[0]]) for s in seq]
            n = Vector()
            for a, b in zip(P, P[1:] + P[:1]):
                n.x += (a.y - b.y) * (a.z + b.z)
                n.y += (a.z - b.z) * (a.x + b.x)
                n.z += (a.x - b.x) * (a.y + b.y)
            if n.dot(Vector(hint)) < 0:
                seq.reverse()
        self.f.append((seq, mat))

    def build(self, name, mats, vcol=False):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tb(p) for p in self.v], [], [[s[0] for s in seq] for seq, _ in self.f])
        me.update(calc_edges=True)
        uvl = me.uv_layers.new(name='UVMap')
        col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER') if vcol else None
        for poly, (seq, mat) in zip(me.polygons, self.f):
            poly.material_index = mat
            for li, s in zip(poly.loop_indices, seq):
                uvl.data[li].uv = s[1]
                if col:
                    col.data[li].color = (*s[2], 1)
        if col:
            me.color_attributes.active_color = col
        for m in mats:
            me.materials.append(m)
        me.shade_flat()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def uv_top(x, z):
    return ((x + HW) / W, z / L * TOPV)


def uv_strip(s_along, p):
    """s_along en metros a lo largo (0..4), p en metros por el perfil (0 = arista superior)."""
    return (s_along / L * STRIP_U, SV1 - p / PL * (SV1 - SV0))


def dwin(z):
    if z <= WZ0 or z >= WZ1:
        return 0.0
    if z < WZ0 + WR:
        return math.sqrt(max(0.0, WR * WR - (WZ0 + WR - z) ** 2))
    if z > WZ1 - WR:
        return math.sqrt(max(0.0, WR * WR - (z - (WZ1 - WR)) ** 2))
    return WR


def arch_rows():
    zs = [0.0, WZ0]
    for k in range(1, NARC + 1):
        th = k * (math.pi / 2) / NARC
        zs.append(WZ0 + WR - WR * math.cos(th))
    zs += [2 * CL, 3 * CL, 4 * CL]
    for k in range(NARC, 0, -1):
        th = k * (math.pi / 2) / NARC
        zs.append(WZ1 - WR + WR * math.cos(th))
    zs += [WZ1, L]
    return sorted(set(round(z, 6) for z in zs))


STONE_ROWS = [k * CL for k in range(NC + 1)]


def xb(z, arch):
    return HW - (dwin(z) if arch else 0.0)


def it_(z, arch):
    return min(CH_T, dwin(z)) if arch else 0.0


def ib_(z, arch):
    return min(CH_B, dwin(z)) if arch else 0.0


def xt(z, arch):
    return xb(z, arch) - it_(z, arch)


def slab(mb, arch, top_mat, stone_mat, top_uv=uv_top, top_col=(1, 1, 1), skip_top=False, cols=3):
    """Losa completa: cara superior, inferior, ingletes, jambas de ventana y testeros."""
    rows = arch_rows() if arch else STONE_ROWS

    def in_window(za, zb):
        return arch and za >= WZ0 - 1e-9 and zb <= WZ1 + 1e-9

    for za, zb in zip(rows, rows[1:]):
        win = in_window(za, zb)
        # --- cara superior (Y=0)
        if not skip_top:
            xa = [-xt(za, arch), -0.345, 0.345, xt(za, arch)]
            xbb = [-xt(zb, arch), -0.345, 0.345, xt(zb, arch)]
            if cols == 1:
                xa, xbb = [xa[0], xa[3]], [xbb[0], xbb[3]]
            for c in range(len(xa) - 1):
                pts = [(xa[c], 0, za), (xa[c + 1], 0, za), (xbb[c + 1], 0, zb), (xbb[c], 0, zb)]
                mb.face(pts, [top_uv(p[0], p[2]) for p in pts], top_mat, (0, 1, 0), [top_col] * 4)
        # --- cara inferior (Y=-T), mismo mapeo que la superior (se ve la sillería por fuera)
        if win:
            ea, eb = xb(za, arch) - ib_(za, arch), xb(zb, arch) - ib_(zb, arch)
        else:
            ea = eb = HWB
        xa = [-ea, -0.345, 0.345, ea]
        xbb = [-eb, -0.345, 0.345, eb]
        if cols == 1:
            xa, xbb = [xa[0], xa[3]], [xbb[0], xbb[3]]
        for c in range(len(xa) - 1):
            pts = [(xa[c], -T, za), (xa[c + 1], -T, za), (xbb[c + 1], -T, zb), (xbb[c], -T, zb)]
            mb.face(pts, [uv_top(p[0], p[2]) for p in pts], stone_mat, (0, -1, 0))
        # --- laterales
        for sg in (1, -1):
            if not win:
                pts = [(sg * HW, 0, za), (sg * HWB, -T, za), (sg * HWB, -T, zb), (sg * HW, 0, zb)]
                uvs = [uv_strip(za, 0), uv_strip(za, PL), uv_strip(zb, PL), uv_strip(zb, 0)]
                mb.face(pts, uvs, stone_mat, (sg, 0, 0))
                continue
            prof = []
            for z in (za, zb):
                x0, it, ib = xb(z, arch), it_(z, arch), ib_(z, arch)
                p1 = it * math.sqrt(2)
                p2 = p1 + (T - it - ib)
                p3 = p2 + ib * math.sqrt(2)
                prof.append([((x0 - it) * sg, 0, z, 0.0), (x0 * sg, -it, z, p1),
                             (x0 * sg, -T + ib, z, p2), ((x0 - ib) * sg, -T, z, p3)])
            hints = [(sg, 1, 0), (sg, 0, 0), (sg, -1, 0)]
            for k in range(3):
                A0, A1 = prof[0][k], prof[0][k + 1]
                B0, B1 = prof[1][k], prof[1][k + 1]
                pts = [A0[:3], A1[:3], B1[:3], B0[:3]]
                uvs = [uv_strip(A0[2], A0[3]), uv_strip(A1[2], A1[3]), uv_strip(B1[2], B1[3]), uv_strip(B0[2], B0[3])]
                mb.face(pts, uvs, stone_mat, hints[k])
    # --- tapas triangulares donde empieza/acaba la ventana (el inglete se corta)
    if arch:
        for sg in (1, -1):
            for z, hz in ((WZ0, 1), (WZ1, -1)):
                pts = [(sg * HW, 0, z), (sg * HWB, -T, z), (sg * HW, -T, z)]
                uvs = [uv_strip(z + 0.0, 0), uv_strip(z + (HWB - HW), PL), uv_strip(z, PL)]
                mb.face(pts, uvs, stone_mat, (0, 0, hz))
    # --- testeros Z=0 y Z=L
    for z, hz in ((0.0, -1), (L, 1)):
        xs_t = [-HW, -0.345, 0.345, HW]
        xs_b = [-HWB, -0.345, 0.345, HWB]
        for c in range(3):
            pts = [(xs_t[c], 0, z), (xs_t[c + 1], 0, z), (xs_b[c + 1], -T, z), (xs_b[c], -T, z)]
            uvs = [uv_strip(p[0] + HWB, 0 if p[1] == 0 else PL) for p in pts]
            mb.face(pts, uvs, stone_mat, (0, 0, hz))


def uv_crys(x, z):
    return ((x + HW) / W, z / L)


def crystal_panels(mb, arch, mat, rng):
    """Paneles de cristal facetado sobre la losa (3 a lo largo)."""
    m, bev = 0.05, 0.085
    y0, y1, yc = 0.004, 0.038, 0.058
    rows_all = arch_rows() if arch else STONE_ROWS
    for k in range(3):
        z0p, z1p = 2 * k * CL, 2 * (k + 1) * CL
        za, zb = z0p + m, z1p - m
        zs = sorted(set([za, zb, za + (zb - za) / 3, za + 2 * (zb - za) / 3]
                        + [z for z in rows_all if za < z < zb]))
        zr = [za + bev + (z - za) * ((zb - za - 2 * bev) / (zb - za)) for z in zs]

        def xr(z):
            return xt(z, arch) - m
        outer = [(xr(z), y0, z) for z in zs] + [(-xr(z), y0, z) for z in reversed(zs)]
        ring = [(xr(z) - bev, y1, z) for z in zr] + [(-(xr(z) - bev), y1, z) for z in reversed(zr)]
        cz = (z0p + z1p) / 2
        ridge = [(0, yc, cz - 0.18), (0, yc, cz + 0.18)]
        n = len(outer)
        f_rim = rng.uniform(0.9, 1.0)
        for i in range(n):
            j = (i + 1) % n
            pts = [outer[i], outer[j], ring[j], ring[i]]
            g = f_rim * rng.uniform(0.92, 1.0)
            mb.face(pts, [uv_crys(p[0], p[2]) for p in pts], mat, (0, 1, 0),
                    [(0.55 * g,) * 3, (0.55 * g,) * 3, (1.0 * g,) * 3, (1.0 * g,) * 3])
        # mesa facetada: cada arista del anillo a la cresta más cercana
        for i in range(n):
            j = (i + 1) % n
            a, b = ring[i], ring[j]
            mz = (a[2] + b[2]) / 2
            r = ridge[0] if mz < cz else ridge[1]
            g = rng.uniform(0.6, 0.9)
            pts = [a, b, r]
            mb.face(pts, [uv_crys(p[0], p[2]) for p in pts], mat, (0, 1, 0),
                    [(0.62 * g,) * 3, (0.62 * g,) * 3, (0.34 * g,) * 3])
        # dos facetas que unen la cresta con los lados
        for sg in (1, -1):
            ia = min(range(len(ring)), key=lambda q: (ring[q][0] * sg < 0, abs(ring[q][2] - cz)))
            g = rng.uniform(0.6, 0.9)
            pts = [ridge[0], ridge[1], ring[ia]]
            mb.face(pts, [uv_crys(p[0], p[2]) for p in pts], mat, (0, 1, 0), [(0.34 * g,) * 3, (0.34 * g,) * 3, (0.62 * g,) * 3])


# ------------------------------------------------------------------ materiales
_IMG = {}


def img(name, noncolor):
    if name not in _IMG:
        im = bpy.data.images.load(os.path.join(KIT, name), check_existing=True)
        im.colorspace_settings.name = 'Non-Color' if noncolor else 'sRGB'
        _IMG[name] = im
    return _IMG[name]


def _principled(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    return m, nt, b


def mat_stone(name='stone', tint=(1, 1, 1)):
    m, nt, b = _principled(name)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = img('stone_albedo.jpg', False)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img('stone_normal.png', True)
    to = nt.nodes.new('ShaderNodeTexImage')
    to.image = img('stone_orm.jpg', True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs['Color'])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(ta.outputs['Color'], mul.inputs[6])
    nt.links.new(sep.outputs['Red'], mul.inputs[7])     # AO (solo en la vista previa)
    tintn = nt.nodes.new('ShaderNodeMix')
    tintn.data_type = 'RGBA'
    tintn.blend_type = 'MULTIPLY'
    tintn.inputs[0].default_value = 1.0
    nt.links.new(mul.outputs[2], tintn.inputs[6])
    tintn.inputs[7].default_value = (*tint, 1)
    nt.links.new(tintn.outputs[2], b.inputs['Base Color'])
    nt.links.new(sep.outputs['Green'], b.inputs['Roughness'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = 0.0
    return m


def mat_crystal(name='crystal', tint=(1, 1, 1), glow=0.0):
    m, nt, b = _principled(name)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = img('crystal_albedo.jpg', False)
    tn = nt.nodes.new('ShaderNodeTexImage')
    tn.image = img('crystal_normal.png', True)
    vc = nt.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Col'
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs[0].default_value = 1.0
    nt.links.new(ta.outputs['Color'], mul.inputs[6])
    nt.links.new(vc.outputs['Color'], mul.inputs[7])
    mt = nt.nodes.new('ShaderNodeMix')
    mt.data_type = 'RGBA'
    mt.blend_type = 'MULTIPLY'
    mt.inputs[0].default_value = 1.0
    nt.links.new(mul.outputs[2], mt.inputs[6])
    mt.inputs[7].default_value = (*tint, 1)
    dk = nt.nodes.new('ShaderNodeMix')
    dk.data_type = 'RGBA'
    dk.blend_type = 'MULTIPLY'
    dk.inputs[0].default_value = 1.0
    nt.links.new(mt.outputs[2], dk.inputs[6])
    dk.inputs[7].default_value = (0.35, 0.35, 0.35, 1) if glow > 0 else (1, 1, 1, 1)
    nt.links.new(dk.outputs[2], b.inputs['Base Color'])
    if glow > 0:
        nt.links.new(mt.outputs[2], b.inputs['Emission Color'])
        b.inputs['Emission Strength'].default_value = glow
    b.inputs['Roughness'].default_value = 0.12
    try:
        b.inputs['Coat Weight'].default_value = 0.6
        b.inputs['Coat Roughness'].default_value = 0.05
    except Exception:
        pass
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nm.uv_map = 'UVMap'
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return m


def mat_flat(name, color, emit=None, strength=1.0, rough=0.3):
    m, nt, b = _principled(name)
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    return m


# ------------------------------------------------------------------ losetas
def build_tiles(M):
    out = {}
    for name, arch in (('tile_stone', False), ('tile_arch', True)):
        mb = MB()
        slab(mb, arch, 0, 0)
        if arch:
            ivy_geo(mb, 0)
        out[name] = mb.build(name, [M['stone']])
    for name, arch in (('tile_crystal', False), ('tile_crystal_arch', True)):
        mb = MB()
        rng = np.random.default_rng(3 if arch else 2)
        # suelo del cristal (llagas oscuras entre paneles) + losa de piedra
        slab(mb, arch, 1, 0, top_uv=uv_crys, top_col=(0.12, 0.12, 0.12), cols=1)
        crystal_panels(mb, arch, 1, rng)
        out[name] = mb.build(name, [M['stone'], M['crystal']], vcol=True)
    return out


def ivy_geo(mb, mat):
    """Un racimo de hiedra que cuelga del borde de cada ventana (geometría + muestra de hoja).
    Las hojas nacen en la arista superior de la jamba y caen por ella hacia fuera (Y<0),
    separadas 8 mm de la piedra; nunca entran en la zona de conducción (Y>0.01)."""
    rng = np.random.default_rng(9)
    u0, v0, us = LEAF_C0 / RES, NZ / RES, 128 / RES
    # contorno de hoja en coordenadas (a a lo largo 0..1, b a lo ancho), como la muestra pintada
    outline = [(0.0, 0.0), (0.12, -0.36), (0.38, -0.46), (0.68, -0.34), (1.0, 0.0),
               (0.68, 0.34), (0.38, 0.46), (0.12, 0.36)]

    def leaf_uv(a_, b_):
        return (u0 + (0.04 + a_ * 0.92) * us, v0 + (0.5 + b_) * us)
    for sg in (1, -1):
        zc = 1.25 if sg > 0 else 2.75
        for i in range(8):
            z = zc + rng.uniform(-0.3, 0.3)
            x0 = xb(z, True)
            Lf = rng.uniform(0.10, 0.16)
            ang = math.pi / 2 + rng.uniform(-0.6, 0.6)          # hacia abajo por la jamba, ladeada
            da = (math.cos(ang), math.sin(ang))                   # (dz, -dy) en el plano de la jamba
            off = 0.006 + 0.004 * i / 8
            base_y = -rng.uniform(0.0, 0.06)

            def P(a_, b_):
                # punto de la hoja sobre el plano de la jamba (Z, Y), con un poco de vuelo hacia la ventana
                lz = a_ * Lf * da[0] - b_ * Lf * da[1]
                ly = -(a_ * Lf * da[1] + b_ * Lf * da[0])
                x = (x0 + off + 0.025 * a_ * a_) * sg
                return (x, min(0.0, base_y + ly), z + lz)
            fl = -1 if rng.random() < 0.45 else 1           # algunas hojas enseñan la mitad en sombra
            pts = [P(a_, b_) for a_, b_ in outline]
            uvs = [leaf_uv(a_, b_ * fl) for a_, b_ in outline]
            mid, muv = P(0.45, 0.0), leaf_uv(0.45, 0.0)
            for k in range(len(pts)):
                j = (k + 1) % len(pts)
                mb.face([mid, pts[k], pts[j]], [muv, uvs[k], uvs[j]], mat, (sg, 0, 0))


def build_rib(M):
    """Costilla de arco por fuera de la losa (Y de -0.34 a -0.98), Z de 0 a 0.5, gema en la junta +X."""
    bm = bmesh.new()
    ZR = 0.5

    def wedge(xa, xb_, y_in, y_out, z0, z1, cut_in=0.0):
        """Dovela: entre las rectas radiales X = xa, xb_ (en la cara interior) que se abren a 15°."""
        def xr(x, y):
            if abs(abs(x) - HW) < 1e-6 or abs(x) > HW:
                s = 1 if x > 0 else -1
                return s * (HW + (-y) * TAN15) - s * cut_in
            return x
        corners = []
        for z in (z0, z1):
            for y in (y_in, y_out):
                for x in (xa, xb_):
                    corners.append(Vector(tb((xr(x, y), y, z))))
        vs = [bm.verts.new(c) for c in corners]
        # índices: ix + 2*iy + 4*iz
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        new = []
        for f in faces:
            try:
                new.append(bm.faces.new([vs[i] for i in f]))
            except ValueError:
                pass
        return vs, new

    parts = []
    gap = 0.018
    for xa, xb_ in ((-HW, -gap), (gap, HW)):
        parts.append(wedge(xa, xb_, -0.34, -0.86, 0.0, ZR, cut_in=0.02))
    # moldura exterior (listel) más estrecha, da un escalón a la silueta
    for xa, xb_ in ((-HW, -gap), (gap, HW)):
        parts.append(wedge(xa, xb_, -0.84, -0.98, 0.07, ZR - 0.07, cut_in=0.07))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.03, segments=2, profile=0.6, affect='EDGES', clamp_overlap=True)
    me = bpy.data.meshes.new('rib_ring')
    bm.to_mesh(me)
    bm.free()
    uvl = me.uv_layers.new(name='UVMap')
    # UV: franja de jambas (sillería con llagas cada 0.667 m)
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            X, Yh, Zt = v.x, v.z, -v.y
            if abs(n.z) >= max(abs(n.x), abs(n.y)):          # cara ±Y de la loseta (exterior)
                uvl.data[li].uv = uv_strip(X + 1.4, min(PL, max(0.0, Zt / ZR * PL)))
            elif abs(n.y) >= abs(n.x):                         # caras ±Z
                uvl.data[li].uv = uv_strip(X + 1.4, min(PL, max(0.0, (-Yh - 0.34) / 0.64 * PL)))
            else:
                uvl.data[li].uv = uv_strip(Zt + 2.0, min(PL, max(0.0, (-Yh - 0.34) / 0.64 * PL)))
    me.materials.append(M['stone'])
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for p in me.polygons:
        for li in p.loop_indices:
            y = me.vertices[me.loops[li].vertex_index].co.z
            k = 0.7 + 0.3 * min(1.0, max(0.0, (-y - 0.34) / 0.3))    # AO junto a la losa
            col.data[li].color = (k, k, k, 1)
    me.color_attributes.active_color = col
    # gema turquesa en la junta +X, orientada según la bisectriz exterior
    gem = gem_mesh(M)
    ob = bpy.data.objects.new('rib_ring', me)
    bpy.context.scene.collection.objects.link(ob)
    me.shade_flat()
    return join_into(ob, [gem])


def gem_mesh(M):
    """Racimo de 3 cristales hexagonales en la junta +X, saliendo por la bisectriz exterior."""
    d0 = Vector((math.sin(math.radians(15)), -math.cos(math.radians(15)), 0))
    up = Vector((0, 0, 1))
    side0 = d0.cross(up).normalized()
    verts, faces = [], []
    # (desplazamiento a lo largo de la junta, inclinación, escala, profundidad del centro)
    specs = [(0.25, 0.0, 1.0, 0.64), (0.08, -0.55, 0.55, 0.72), (0.41, 0.5, 0.48, 0.74)]
    for zc, tilt, sc, s0 in specs:
        d = (d0 * math.cos(tilt) + up * math.sin(tilt)).normalized()
        side = d.cross(up if abs(tilt) < 0.01 else side0).normalized()
        if side.length < 1e-6:
            side = side0
        up2 = d.cross(side).normalized()
        c = Vector((HW + s0 * TAN15, -s0, zc))
        base = len(verts)
        for off, r in ((-0.12, 0.2), (0.14, 0.23)):
            for j in range(6):
                a_ = 2 * math.pi * j / 6 + 0.3
                verts.append(c + d * off * sc + (side * math.cos(a_) + up2 * math.sin(a_)) * r * sc)
        verts.append(c + d * 0.42 * sc)
        verts.append(c - d * 0.3 * sc)
        for j in range(6):
            j2 = (j + 1) % 6
            faces.append((base + j, base + j2, base + 6 + j2, base + 6 + j))
            faces.append((base + 6 + j, base + 6 + j2, base + 12))
            faces.append((base + j2, base + j, base + 13))
    me = bpy.data.meshes.new('rib_gem')
    me.from_pydata([tb(v) for v in verts], [], faces)
    me.update()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    uvl = me.uv_layers.new(name='UVMap')
    for l in me.loops:
        uvl.data[l.index].uv = (0.5, 0.5)
    me.materials.append(M['gem'])
    gc = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    rng = np.random.default_rng(12)
    for p in me.polygons:
        g = float(rng.uniform(0.75, 1.0))
        for li in p.loop_indices:
            gc.data[li].color = (g, g, g, 1)
    me.shade_flat()
    ob = bpy.data.objects.new('rib_gem', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def join_into(target, others):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in [target] + others:
        o.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()
    return target


# ------------------------------------------------------------------ cajas
BOX_BLOCKS = [(0, 0), (0, 1), (2, 0), (2, 1), (0, 1), (2, 0)]   # hiladas sin hiedra   # (hilada, bloque) de la textura


def block_rect(course, k):
    J = TJE if course % 2 == 0 else TJO
    x0, x1 = J[k] + GS + 0.012, J[k + 1] - GS - 0.012
    z0, z1 = course * TCL + GS + 0.012, (course + 1) * TCL - GS - 0.012
    u0, v0 = uv_top(x0, z0)
    u1, v1 = uv_top(x1, z1)
    return u0, v0, u1, v1


def x_outline(a=0.34, h=0.068):
    pts = []
    for k in range(4):
        th = math.radians(45 + 90 * k)
        d = (math.cos(th), math.sin(th))
        p = (-math.sin(th), math.cos(th))
        pts.append((a * d[0] - h * p[0], a * d[1] - h * p[1]))
        pts.append((a * d[0] + h * p[0], a * d[1] + h * p[1]))
        tn = th + math.radians(45)
        pts.append((h * math.sqrt(2) * math.cos(tn), h * math.sqrt(2) * math.sin(tn)))
    return pts


def build_box_block(M):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.05, segments=2, profile=0.55, affect='EDGES', clamp_overlap=True)
    me = bpy.data.meshes.new('box_block')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['stone'])
    me.materials.append(M['rune'])
    ob = bpy.data.objects.new('box_block', me)
    bpy.context.scene.collection.objects.link(ob)
    # cortador: X + marco cuadrado en las 6 caras, material 'rune'
    cv, cf = [], []
    depth = 0.022

    def prism(poly2d, axis, sgn, inner=None):
        base = len(cv)
        ax = [0, 1, 2]
        ax.remove(axis)
        a1, a2 = ax

        def P(u, w, h):
            p = [0.0, 0.0, 0.0]
            p[axis] = sgn * h
            p[a1], p[a2] = u, w
            return p
        n = len(poly2d)
        for u, w in poly2d:
            cv.append(P(u, w, 0.5 - depth))
        for u, w in poly2d:
            cv.append(P(u, w, 0.62))
        cf.append(list(range(base, base + n))[::-1])
        cf.append(list(range(base + n, base + 2 * n)))
        for i in range(n):
            j = (i + 1) % n
            cf.append([base + i, base + j, base + n + j, base + n + i])

    def ring(axis, sgn, ro=0.405, ri=0.35):
        # marco como 4 barras solapadas no vale para EXACT: se hace un anillo cerrado
        base = len(cv)
        ax = [0, 1, 2]
        ax.remove(axis)
        a1, a2 = ax

        def P(u, w, h):
            p = [0.0, 0.0, 0.0]
            p[axis] = sgn * h
            p[a1], p[a2] = u, w
            return p
        sq = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
        for h in (0.5 - depth, 0.62):
            for r in (ro, ri):
                for u, w in sq:
                    cv.append(P(u * r, w * r, h))
        # índices: base + 8*ih + 4*ir + k
        def I(ih, ir, k):
            return base + 8 * ih + 4 * ir + k
        for k in range(4):
            k2 = (k + 1) % 4
            cf.append([I(0, 0, k), I(0, 1, k), I(0, 1, k2), I(0, 0, k2)])      # abajo
            cf.append([I(1, 0, k), I(1, 0, k2), I(1, 1, k2), I(1, 1, k)])      # arriba
            cf.append([I(0, 0, k), I(0, 0, k2), I(1, 0, k2), I(1, 0, k)])      # pared exterior
            cf.append([I(0, 1, k), I(1, 1, k), I(1, 1, k2), I(0, 1, k2)])      # pared interior
    xo = x_outline()
    for axis in range(3):
        for sgn in (1, -1):
            prism(xo, axis, sgn)
            ring(axis, sgn)
    cme = bpy.data.meshes.new('cutter')
    cme.from_pydata(cv, [], cf)
    cme.update()
    bmc = bmesh.new()
    bmc.from_mesh(cme)
    bmesh.ops.recalc_face_normals(bmc, faces=bmc.faces[:])
    bmc.to_mesh(cme)
    bmc.free()
    cme.materials.append(M['rune'])
    cut = bpy.data.objects.new('cutter', cme)
    bpy.context.scene.collection.objects.link(cut)
    mod = ob.modifiers.new('rune', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.solver = 'EXACT'
    mod.object = cut
    try:
        mod.material_mode = 'TRANSFER'
    except Exception:
        pass
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = new
    bpy.data.meshes.remove(old)
    new.name = 'box_block'
    bpy.data.objects.remove(cut)
    # triangular y UV por cara dominante hacia bloques de la textura
    bm = bmesh.new()
    bm.from_mesh(new)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(new)
    bm.free()
    uvl = new.uv_layers.get('UVMap') or new.uv_layers.new(name='UVMap')
    for p in new.polygons:
        n = p.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        sgn = 1 if n[axis] > 0 else -1
        bi = BOX_BLOCKS[axis * 2 + (0 if sgn > 0 else 1)]
        u0, v0, u1, v1 = block_rect(*bi)
        ax = [0, 1, 2]
        ax.remove(axis)
        for li in p.loop_indices:
            co = new.vertices[new.loops[li].vertex_index].co
            a, b = co[ax[0]] + 0.5, co[ax[1]] + 0.5
            uvl.data[li].uv = (u0 + a * (u1 - u0), v0 + b * (v1 - v0))
    vertex_ao(ob)
    new.shade_flat()
    return ob


def vertex_ao(ob, groove_dark=0.6):
    """AO barato en COLOR_0: oscurece las ranuras de la runa y las esquinas."""
    me = ob.data
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for p in me.polygons:
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            r = max(abs(co.x), abs(co.y), abs(co.z))
            k = 1.0 if r > 0.495 else groove_dark + (1 - groove_dark) * max(0.0, (r - 0.478) / 0.017)
            corner = sorted([abs(co.x), abs(co.y), abs(co.z)])
            if corner[1] > 0.45:
                k *= 0.9
            col.data[li].color = (k, k, k, 1)
    me.color_attributes.active_color = col


def build_box_crystal(M):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.11, segments=1, affect='EDGES', clamp_overlap=True)
    big = [f for f in bm.faces if max(abs(c) for c in f.normal) > 0.99]
    res = bmesh.ops.inset_individual(bm, faces=big, thickness=0.07, depth=0.012)
    poked = bmesh.ops.poke(bm, faces=big, offset=0.03)
    bm.normal_update()
    me = bpy.data.meshes.new('box_crystal')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['crystal'])
    uvl = me.uv_layers.new(name='UVMap')
    col = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    rng = np.random.default_rng(4)
    for p in me.polygons:
        n = p.normal
        axis = max(range(3), key=lambda i: abs(n[i]))
        ax = [0, 1, 2]
        ax.remove(axis)
        edge = max(abs(n[i]) for i in range(3)) < 0.95
        g = (1.0 if edge else rng.uniform(0.72, 0.92))
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uvl.data[li].uv = (co[ax[0]] + 0.5, co[ax[1]] + 0.5)
            col.data[li].color = (g, g, g, 1)
    me.color_attributes.active_color = col
    ext = max(max(abs(c) for c in v.co) for v in me.vertices)
    for v in me.vertices:
        v.co *= 0.5 / ext
    me.shade_flat()
    ob = bpy.data.objects.new('box_crystal', me)
    bpy.context.scene.collection.objects.link(ob)
    del res, poked
    return ob


# ------------------------------------------------------------------ exportación
def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export_glb(objs, filename):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(KIT, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=True, export_normals=True, export_tangents=True, export_materials='EXPORT',
        export_image_format='NONE', export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_cameras=False, export_lights=False, export_extras=False, export_animations=False)
    print(f'EXPORT {filename}: {os.path.getsize(path) / 1024:.1f} KB')
    for o in objs:
        bb = [Vector(c) for c in o.bound_box]
        lo = Vector((min(c.x for c in bb), min(c.y for c in bb), min(c.z for c in bb)))
        hi = Vector((max(c.x for c in bb), max(c.y for c in bb), max(c.z for c in bb)))
        print(f'  {o.name}: {tris(o)} tris | glTF X {lo.x:.3f}..{hi.x:.3f}  Y {lo.z:.3f}..{hi.z:.3f}  '
              f'Z {-hi.y:.3f}..{-lo.y:.3f}')


# ================================================================== vistas previas
def setup_render(w, h, samples=48):
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
    try:
        sc.view_settings.look = 'None'
    except Exception:
        pass
    ee = sc.eevee
    for k, v in (('taa_render_samples', samples), ('use_shadows', True), ('use_raytracing', True),
                 ('use_gtao', True)):
        try:
            setattr(ee, k, v)
        except Exception:
            pass


def make_world(strength=1.0):
    sc = bpy.context.scene
    world = bpy.data.worlds.new('Sky')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == 'BACKGROUND')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*lib.hexc('#f4efe2'), 1)
    cr.elements[1].position = 0.55
    cr.elements[1].color = (*lib.hexc('#4d97e6'), 1)
    e = cr.elements.new(0.12)
    e.color = (*lib.hexc('#bfe0fb'), 1)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -0.2
    mr.inputs['From Max'].default_value = 1.0
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = strength


def add_sun(direction=(0.5, 0.35, 0.8), energy=4.0, color='#fff0d6'):
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = energy
    sun.color = lib.hexc(color)
    sun.angle = math.radians(2)
    so = bpy.data.objects.new('Sun', sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (-Vector(direction).normalized()).to_track_quat('-Z', 'Y').to_euler()
    return so


def add_cam(loc, target, lens=35):
    cam = bpy.data.cameras.new('Cam')
    cam.lens = lens
    cam.clip_start = 0.05
    cam.clip_end = 500
    co = bpy.data.objects.new('Cam', cam)
    bpy.context.scene.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = co
    return co


def render(filename):
    os.makedirs(PREV, exist_ok=True)
    sc = bpy.context.scene
    sc.render.filepath = os.path.join(PREV, filename)
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'PREVIEW {sc.render.filepath} ({time.time() - t0:.1f}s)')


def clear_preview(keep):
    for o in list(bpy.context.scene.objects):
        if o not in keep:
            bpy.data.objects.remove(o)


def place(src, mw, name, overrides=None, shadows=True):
    ob = bpy.data.objects.new(name, src.data)
    bpy.context.scene.collection.objects.link(ob)
    ob.matrix_world = mw
    if overrides:
        for i, slot in enumerate(ob.material_slots):
            nm = slot.material.name if slot.material else None
            if nm in overrides:
                slot.link = 'OBJECT'
                slot.material = overrides[nm]
    ob.visible_shadow = shadows
    return ob


R_IN = 3.863


def cell_matrix(i, r):
    phi = -math.pi / 2 + i * 2 * math.pi / 12
    o = Vector((math.cos(phi), 0, math.sin(phi)))
    t = Vector((math.sin(phi), 0, -math.cos(phi)))
    yw = Vector((0, 1, 0))
    m = Matrix.Identity(4)
    for k in range(3):
        m[k][0], m[k][1], m[k][2] = t[k], -yw[k], -o[k]
    tr = o * R_IN + yw * (L * r)
    m[0][3], m[1][3], m[2][3] = tr
    return m


def preview_single(kit, boxes):
    keep = set(kit.values()) | set(boxes.values())
    setup_render(1280, 720, 48)
    make_world(1.0)
    add_sun((0.45, -0.55, 0.75), 4.5)
    objs = []
    names = ['tile_stone', 'tile_arch', 'tile_crystal', 'tile_crystal_arch']
    over = {'crystal': mat_crystal('crystal_red_prev', lib.hexc('#ff2a3a'), 2.5)}
    for k, n in enumerate(names):
        m = Matrix.Translation((k * 2.6 - 3.9, 0, 0))
        objs.append(place(kit[n], m, 'p_' + n, over if 'crystal' in n else None))
    objs.append(place(kit['rib_ring'], Matrix.Translation((-3.9, -5.2, 1.2)), 'p_rib'))
    objs.append(place(boxes['box_block'], Matrix.Translation((1.3, -5.6, 0.5)),
                      'p_box', {'rune': mat_flat('rune_red', lib.hexc('#ff2a3a'), lib.hexc('#ff2a3a'), 6)}))
    objs.append(place(boxes['box_crystal'], Matrix.Translation((3.6, -5.6, 0.5)), 'p_boxc',
                      {'crystal': mat_crystal('crystal_pink_prev', lib.hexc('#ff38d0'), 2.0)}))
    for o in keep:
        o.hide_render = True
    add_cam((6.5, 5.5, 7.0), (0.0, -2.4, 0.0), 30)
    render('kit_tiles.png')
    # primer plano de la piedra (3×3 losetas a ras de suelo para ver costuras)
    clear_preview(keep)
    add_sun((0.45, -0.55, 0.75), 4.5)
    for i in range(-1, 2):
        for r in range(0, 3):
            place(kit['tile_stone'], Matrix.Translation((i * W, -r * L, 0)), f'g{i}{r}')
    add_cam((1.4, 1.6, 1.2), (-0.2, -3.0, 0.0), 24)
    render('kit_stone_close.png')
    clear_preview(keep)
    add_sun((0.45, -0.55, 0.75), 4.5)
    place(kit['tile_arch'], Matrix.Identity(4), 'arch1')
    place(kit['tile_arch'], Matrix.Translation((W, 0, 0)), 'arch2')
    add_cam((1.6, 1.0, 1.3), (1.0, -1.6, -0.1), 30)
    render('kit_arch_close.png')
    clear_preview(keep)


def preview_tunnel(kit, rows=12, red=2, pink=9):
    keep = set(kit.values())
    for o in keep:
        o.hide_render = True
    setup_render(1280, 720, 48)
    make_world(1.1)
    add_sun((0.35, -0.45, 0.82), 4.5)
    red_m = mat_crystal('crystal_red', lib.hexc('#ff2a3a'), 2.2)
    pink_m = mat_crystal('crystal_pink', lib.hexc('#ff38d0'), 2.2)
    for r in range(rows):
        arch = r % 2 == 1
        for i in range(12):
            if i in (red, pink) and 1 <= r <= 7:
                src = kit['tile_crystal_arch' if arch else 'tile_crystal']
                ov = {'crystal': red_m if i == red else pink_m}
            else:
                src = kit['tile_arch' if arch else 'tile_stone']
                ov = None
            place(src, cell_matrix(i, r), f't{r}_{i}', ov, shadows=False)
            if r % 8 == 0:
                place(kit['rib_ring'], cell_matrix(i, r), f'r{r}_{i}', shadows=False)
    add_cam((0.35, -0.5, -R_IN + 0.75), (0.0, 30, -R_IN + 1.9), 18)
    render('kit_tunnel_inside.png')
    add_cam((10.5, -7.0, 3.5), (0.0, 14, -0.5), 30)
    render('kit_tunnel_outside.png')
    clear_preview(keep)
    compare()


def compare():
    """Concepto (arriba) y render del kit (abajo) en una sola imagen para compararlos."""
    refs = [('/Users/eyra/.claude/uploads/9f2bfe69-cb33-5cec-b683-749f2a93b908/1bb67ec4-image.png',
             'kit_tunnel_outside.png'),
            (os.path.join(lib.ROOT, 'referencias', 'conceptos', 'C1.png'), 'kit_tunnel_inside.png')]
    w, h = 640, 360
    out = np.ones((h * 2, w * 2, 4), np.float32)
    for col, (ref, mine) in enumerate(refs):
        for row, path in enumerate((ref, os.path.join(PREV, mine))):
            if not os.path.exists(path):
                continue
            im = bpy.data.images.load(path)
            im.scale(w, h)
            px = np.array(im.pixels[:], np.float32).reshape(h, w, 4)
            out[(1 - row) * h:(2 - row) * h, col * w:(col + 1) * w] = px
            bpy.data.images.remove(im)
    im = bpy.data.images.new('cmp', w * 2, h * 2, alpha=False)
    im.pixels.foreach_set(out.ravel())
    path = os.path.join(PREV, 'kit_compare.png')
    im.filepath_raw = path
    im.file_format = 'PNG'
    im.save()
    print('PREVIEW', path)


# ================================================================== main
def main():
    lib.reset()
    os.makedirs(KIT, exist_ok=True)
    if '--no-tex' not in ARGS:
        build_stone_textures()
        build_crystal_textures()
    M = {
        'stone': mat_stone('stone'),
        'crystal': mat_crystal('crystal'),
        'gem': mat_flat('gem', lib.hexc('#3fe8d8'), lib.hexc('#3fe8d8'), 3.0, 0.15),
        'rune': mat_flat('rune', (1, 1, 1), (1, 1, 1), 2.0, 0.4),
    }
    kit = build_tiles(M)
    kit['rib_ring'] = build_rib(M)
    boxes = {'box_block': build_box_block(M), 'box_crystal': build_box_crystal(M)}
    export_glb([kit[n] for n in ('tile_stone', 'tile_arch', 'tile_crystal', 'tile_crystal_arch', 'rib_ring')],
               'tunnel_kit.glb')
    export_glb([boxes['box_block'], boxes['box_crystal']], 'boxes_kit.glb')
    if '--no-preview' not in ARGS:
        preview_single(kit, boxes)
        preview_tunnel(kit)


main()
