"""Islas flotantes de Hipertúnel (calidad "Switch"): acantilado con estratos y grietas, cono
irregular con raíces colgando, tapa de césped que desborda, grupos de árboles de copa redonda,
cascadas con alfa de color de vértice y, en una variante, un castillo de piedra clara con
tejados turquesa. AO horneado con Cycles en el color de vértice.

Uso:
  blender --background --python tools/blender/islands.py                      # las 4 + vistas
  blender --background --python tools/blender/islands.py -- island_a island_c # solo algunas
  ... -- --no-preview

Salida: app/src/assets/island_{a,b,c,castle}.glb (Y arriba, origen en el centro a nivel del
césped). Vistas previas en /private/tmp/blender-previews/<nombre>-34.png y <nombre>-bajo.png.
"""
import bpy
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib  # noqa: E402
from lib import hexc, mix, smoothstep  # noqa: E402
from mathutils import Vector, Matrix, noise  # noqa: E402

TAU = 2 * math.pi

# ---------------------------------------------------------------- paleta
ROCK_TOP = hexc('#d4bb98')      # arenisca cálida bajo el césped
ROCK_MID = hexc('#ad9480')
ROCK_LOW = hexc('#6f6470')      # abajo más fría, algo azulada
ROCK_TIP = hexc('#4d5070')
ROCK_LIGHT = hexc('#e6d3b4')
ROCK_DARK = hexc('#8a6450')
CRACK = hexc('#5c4a4a')
MOSS = hexc('#7fae3c')
GRASS = hexc('#5cbf3a')
GRASS_2 = hexc('#3f9e30')
GRASS_3 = hexc('#86d64e')
GRASS_LIP = hexc('#a8e466')
GRASS_UNDER = hexc('#3f8a34')
ROOT = hexc('#6e4b36')
ROOT_TIP = hexc('#8b6a50')
TRUNK = hexc('#7a5238')
CANOPIES = [(hexc('#1f6a30'), hexc('#3f9e3a'), hexc('#8fd058')),
            (hexc('#2a7a2a'), hexc('#52ad34'), hexc('#a8dc5c')),
            (hexc('#185e3a'), hexc('#338f4c'), hexc('#7cc870'))]
STONE = hexc('#e9e0cf')
STONE_LOW = hexc('#cfc4b2')
ROOF = hexc('#1fb5a8')
ROOF_LIGHT = hexc('#7af0dc')
WINDOW = hexc('#3a3450')
WATER_TOP = hexc('#bfeef0')
WATER = hexc('#45bccd')


# ---------------------------------------------------------------- utilidades
def n3(p, s=1.0, off=0.0):
    return noise.noise(Vector((p[0] * s + off, p[1] * s - off * 0.7, p[2] * s + off * 1.3)))


class Mesh:
    """Acumula vértices soldados con color RGBA por vértice (dominio POINT)."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def add(self, verts, faces, col):
        o = len(self.v)
        for i, p in enumerate(verts):
            p = Vector(p)
            self.v.append(p)
            c = col(p, i) if callable(col) else col
            self.c.append(tuple(c) if len(c) == 4 else (*c, 1.0))
        self.f += [tuple(k + o for k in fc) for fc in faces]
        return o

    def build(self, name, mat, sharp_angle=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        me.validate()
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(mat)
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(self.c):
            attr.data[i].color = c
        me.color_attributes.active_color = attr
        lib.shade(ob, True, sharp_angle)
        return ob


def recolor(ob, fn):
    """fn(co, normal, rgba) -> rgba, por vértice (usa las normales suavizadas)."""
    me = ob.data
    attr = me.color_attributes['Col']
    for v in me.vertices:
        attr.data[v.index].color = fn(v.co, v.normal, tuple(attr.data[v.index].color))


def mats():
    body = lib.material('IslandBody', (1, 1, 1), rough=0.88, vcol=True)
    # sin emisión: el decorado debe quedar por debajo del umbral del bloom
    water = lib.material('Waterfall', (1, 1, 1), rough=0.35, vcol=True, double=True)
    nt = water.node_tree
    vc = next(n for n in nt.nodes if n.type == 'VERTEX_COLOR')
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    nt.links.new(vc.outputs['Alpha'], bsdf.inputs['Alpha'])
    try:
        water.surface_render_method = 'BLENDED'
    except Exception:
        water.blend_method = 'BLEND'
    return dict(body=body, water=water)


# ---------------------------------------------------------------- isla base
class Island:
    def __init__(self, seed, R, stretch=1.0, lobes=(), depth=1.25, cliff=0.55, N=56, rings=(8, 12),
                 crack_k=14):
        self.rnd = random.Random(seed)
        self.seed = seed
        self.R, self.stretch, self.lobes = R, stretch, lobes
        self.D = R * depth
        self.H1 = R * cliff
        self.N = N
        self.rings = rings
        self.crack_k = crack_k
        rnd = self.rnd
        self.ph = [rnd.uniform(0, TAU) for _ in range(8)]
        self.tip = Vector((rnd.uniform(-0.12, 0.12) * R * stretch, rnd.uniform(-0.12, 0.12) * R, 0))
        self.M = mats()
        self.body = Mesh()
        self.water = Mesh()
        self.solids = []           # objetos extra (castillo) que se unen al final
        self.flat = Mesh()          # piezas facetadas (pedruscos)
        self.occupied = []          # (x, y, radio) en la meseta

    # contorno de la meseta
    def rk(self, a):
        ph = self.ph
        k = 1 + 0.07 * math.sin(2 * a + ph[0]) + 0.045 * math.sin(3 * a + ph[1]) + 0.03 * math.sin(5 * a + ph[2]) + 0.02 * math.sin(8 * a + ph[3])
        for la, ls in self.lobes:
            d = math.atan2(math.sin(a - la), math.cos(a - la))
            k += ls * math.exp(-(d / 0.6) ** 2)
        return k

    def rim(self, a, f=1.0):
        r = self.R * self.rk(a) * f
        return Vector((r * math.cos(a) * self.stretch, r * math.sin(a), 0))

    def inside(self, x, y):
        """rho normalizado (0 centro, 1 borde) de un punto de la meseta."""
        a = math.atan2(y, x / self.stretch)
        return math.hypot(x / self.stretch, y) / (self.R * self.rk(a))

    def top_z(self, x, y):
        rho = self.inside(x, y)
        return self.R * 0.03 * (1 - min(rho, 1) ** 2) + 0.35 * n3((x, y, 0), 0.12, self.seed)

    def crack(self, a, z):
        s = abs(math.sin(self.crack_k * a / 2 + 0.35 * math.sin(z * 0.23 + self.ph[3]) + self.ph[4]))
        s2 = abs(math.sin((self.crack_k + 5) * a / 2 + self.ph[5] + 0.2 * math.sin(z * 0.4)))
        return max((1 - s) ** 3, 0.7 * (1 - s2) ** 5)

    # ------------------------------------------------ roca
    def build_rock(self):
        R, N, H1, D = self.R, self.N, self.H1, self.D
        n_cliff, n_cone = self.rings
        band = (H1 - 0.15) / (n_cliff - 1) * 3.0
        prof = []  # (s_cliff, t_total, z_base, rfac)
        for i in range(n_cliff):
            u = i / (n_cliff - 1)
            z = -0.15 - u * (H1 - 0.15)
            prof.append(('c', u, z))
        for i in range(1, n_cone + 1):
            s = i / (n_cone + 0.7)
            z = -H1 - (D - H1) * 0.8 * (s ** 1.1)
            prof.append(('k', s, z))
        verts, meta = [], []
        ph = self.ph
        rnd = random.Random(self.seed * 7 + 1)
        # grietas verticales: columnas de vértices concretas que serpentean al bajar
        cols, j = {}, rnd.randrange(3)
        while j < N - 1:
            cols[j] = 1.0 if rnd.random() < 0.65 else 0.55
            j += rnd.choice((3, 3, 4, 4, 5))
        shift = [0]
        for r in range(1, len(prof)):
            shift.append(shift[-1] + (rnd.choice((-1, 1)) if rnd.random() < 0.3 else 0))
        for ri, (kind, u, z) in enumerate(prof):
            for j in range(N):
                a = TAU * j / N
                base = self.rim(a)
                cr = cols.get((j - shift[ri]) % N, 0.0)
                ledge = 0.0
                # lóbulos del cono inferior: se descuelgan en varias puntas
                lob = (0.55 * math.sin(3 * a + ph[6]) + 0.35 * math.sin(5 * a + ph[7]) + 0.25 * math.sin(7 * a + ph[1]))
                spike = max(0.0, lob) ** 1.4
                if kind == 'c':
                    # acantilado casi vertical con repisas de estratos (dientes de sierra)
                    ledge = ((-z) / band + 0.15 * math.sin(3 * a + ph[2])) % 1.0
                    f = 1.0 - 0.035 * u - 0.05 * ledge
                    f *= 1 - 0.06 * cr
                    s = 0.0
                    dz = 0.0
                else:
                    s = u
                    f = 0.93 * (1 - s ** 1.15) ** 0.85 * (1 - 0.25 * s) * (1 + 0.3 * s * lob)
                    f *= 1 - 0.06 * cr * (1 - s)
                    dz = -(s ** 1.6) * spike * 0.28 * D
                p = base * f
                if kind == 'k':
                    p += self.tip * (s ** 1.5)
                # irregularidad 3D
                d = n3((p.x, p.y, z), 0.11, self.seed * 0.37)
                radial = Vector((math.cos(a), math.sin(a), 0))
                amp = R * (0.03 + 0.05 * s)
                p += radial * (d * amp)
                zz = z + dz + (0.0 if kind == 'c' and u == 0 else n3((p.x, p.y, z), 0.2, 5 + self.seed) * R * 0.025 * (1 + s))
                verts.append(Vector((p.x, p.y, zz)))
                meta.append((kind, u, cr, a, ledge))
        rows = len(prof)
        faces = []
        for r in range(rows - 1):
            for j in range(N):
                j2 = (j + 1) % N
                faces.append((r * N + j, (r + 1) * N + j, (r + 1) * N + j2, r * N + j2))
        tipv = len(verts)
        verts.append(Vector((self.tip.x, self.tip.y, -D * 1.02)))
        meta.append(('k', 1.0, 0.0, 0.0, 0.0))
        last = (rows - 1) * N
        for j in range(N):
            faces.append((last + (j + 1) % N, last + j, tipv))
        self._rock_meta = meta
        self._rock_verts = verts
        o = self.body.add(verts, faces, lambda p, i: self.rock_color(p, meta[i]))
        self._rock_range = (o, o + len(verts))
        self._rock_rows = rows

    def rock_color(self, p, m):
        kind, u, cr, a, ledge = m
        D = self.D
        t = min(1.0, -p.z / D)
        c = mix(ROCK_TOP, ROCK_MID, smoothstep(0.0, 0.45, t))
        c = mix(c, ROCK_LOW, smoothstep(0.3, 0.75, t))
        c = mix(c, ROCK_TIP, smoothstep(0.8, 1.0, t))
        # estratos: bandas finas claras/oscuras con ondulación
        sb = math.sin((-p.z) * 1.35 + 0.8 * n3(p, 0.08, 3))
        c = mix(c, ROCK_LIGHT if sb > 0 else ROCK_DARK, 0.22 * abs(sb) ** 0.6 * (1 - 0.5 * t))
        c = mix(c, mix(c, ROCK_LIGHT, 0.5), 0.25 * max(0.0, n3(p, 0.3, 9)))
        # repisas: canto claro arriba, sombra debajo
        if kind == 'c':
            c = mix(c, ROCK_LIGHT, 0.35 * (1 - ledge) ** 3)
            c = mix(c, ROCK_DARK, 0.3 * ledge ** 4)
        # grietas oscuras
        c = mix(c, CRACK, 0.85 * cr * (1 - 0.3 * t))
        return c

    # ------------------------------------------------ césped
    def build_grass(self, rings_in=(0.0, 0.3, 0.55, 0.75, 0.9)):
        R, N = self.R, self.N
        prof = [(r, None) for r in rings_in] + [(0.975, 0.10), (1.03, -0.12), (1.05, -0.5), (1.04, 'drip')]
        verts, meta = [], []
        rows = []
        for rho, z in prof:
            if rho == 0:
                rows.append([len(verts)])
                verts.append(Vector((0, 0, self.top_z(0, 0))))
                meta.append((0.0, 0))
                continue
            row = []
            for j in range(N):
                a = TAU * j / N
                p = self.rim(a, rho)
                if z is None:
                    zz = self.top_z(p.x, p.y)
                elif z == 'drip':
                    w = 0.5 + 0.5 * math.sin(7 * a + self.ph[2]) * math.sin(3 * a + self.ph[5])
                    zz = -0.55 - (0.3 + 1.6 * w ** 2) * (R / 12)
                else:
                    zz = z * (R / 12) + (self.top_z(p.x, p.y) * 0.5 if z > 0 else 0)
                row.append(len(verts))
                verts.append(Vector((p.x, p.y, zz)))
                meta.append((rho, 1 if z is not None and not isinstance(z, str) and z < 0 else (2 if z == 'drip' else 0)))
            rows.append(row)
        faces = []
        for A, B in zip(rows, rows[1:]):
            if len(A) == 1:
                for j in range(N):
                    faces.append((A[0], B[j], B[(j + 1) % N]))
            else:
                for j in range(N):
                    j2 = (j + 1) % N
                    faces.append((A[j], B[j], B[j2], A[j2]))

        def gc(p, i):
            rho, kind = meta[i]
            v = n3(p, 0.14, 21 + self.seed)
            c = mix(GRASS, GRASS_2 if v < 0 else GRASS_3, min(1, abs(v) * 2.4))
            if kind == 0 and rho > 0.95:
                c = mix(c, GRASS_LIP, 0.55)
            if kind == 1:
                c = mix(GRASS_LIP, GRASS, 0.3)
            if kind == 2:
                c = GRASS_UNDER
            return c
        self.body.add(verts, faces, gc)

    # ------------------------------------------------ árboles
    def free_spot(self, rmin, rmax, clear, tries=300):
        for _ in range(tries):
            rho = math.sqrt(self.rnd.uniform(rmin ** 2, rmax ** 2))
            a = self.rnd.uniform(0, TAU)
            p = self.rim(a, rho)
            if all((Vector((p.x, p.y)) - Vector((x, y))).length > clear + r for x, y, r in self.occupied):
                return p
        return None

    def tree(self, x, y, size, pal=None, blobs=3):
        rnd = self.rnd
        z0 = self.top_z(x, y) - 0.3
        pal = pal or CANOPIES[rnd.randrange(len(CANOPIES))]
        h = size * rnd.uniform(1.25, 1.6)
        lean = Vector((rnd.uniform(-0.15, 0.15), rnd.uniform(-0.15, 0.15), 1)).normalized()
        top = Vector((x, y, z0)) + lean * h
        tv, tf = lib.lathe([(0.0, h * 1.02), (0.13 * size, h), (0.17 * size, 0.35), (0.3 * size, 0.0),
                            (0.0, -0.4)], 5, phase=rnd.uniform(0, 1))
        rot = Vector((0, 0, 1)).rotation_difference(lean).to_matrix().to_4x4()
        tv = lib.transform(tv, Matrix.Translation((x, y, z0)) @ rot)
        self.body.add(tv, tf, lambda p, i: mix(TRUNK, ROOT_TIP, 0.3 * (i % 2)))
        dark, mid, light = pal
        centers = [(top + Vector((0, 0, size * 0.45)), size)]
        for k in range(blobs - 1):
            a = rnd.uniform(0, TAU) + k * 2.3
            off = Vector((math.cos(a), math.sin(a), 0)) * size * rnd.uniform(0.55, 0.75)
            centers.append((top + off + Vector((0, 0, rnd.uniform(-0.1, 0.35) * size)), size * rnd.uniform(0.6, 0.78)))
        for c, s in centers:
            v, f = lib.ico(1.0, 1)
            vv = []
            for p in v:
                q = p * (1 + 0.16 * n3(p * 2 + c * 0.1, 1.0, 7))
                vv.append(c + Vector((q.x, q.y, q.z * 0.82)) * s)

            def cc(p, i, c=c, s=s):
                d = (p - c) / s
                t = smoothstep(-0.9, 0.9, d.z * 0.85 + 0.25 * d.x - 0.25 * d.y)
                col = mix(dark, mid, smoothstep(0.0, 0.5, t))
                return mix(col, light, smoothstep(0.55, 1.0, t))
            self.body.add(vv, f, cc)
        self.occupied.append((x, y, size * 1.1))

    def grove(self, count, size, rmax=0.72, clear=0.5, blobs=3):
        n = 0
        while n < count:
            p = self.free_spot(0.05, rmax, size * clear)
            if p is None:
                break
            group = self.rnd.choice((1, 2, 2, 3))
            for g in range(min(group, count - n)):
                s = size * self.rnd.uniform(0.75, 1.1)
                if g == 0:
                    x, y = p.x, p.y
                else:
                    a = self.rnd.uniform(0, TAU)
                    x, y = p.x + math.cos(a) * size * 1.5, p.y + math.sin(a) * size * 1.5
                    if self.inside(x, y) > 0.82 or any(
                            (Vector((x, y)) - Vector((ox, oy))).length < s + r * 0.7 for ox, oy, r in self.occupied):
                        continue
                self.tree(x, y, s, blobs=blobs if s > size * 0.9 else 2)
                n += 1

    def bushes(self, count, size):
        for _ in range(count):
            p = self.free_spot(0.55, 0.9, size * 0.3)
            if p is None:
                return
            v, f = lib.ico(1.0, 1)
            z = self.top_z(p.x, p.y)
            vv = [Vector((q.x * 1.25, q.y * 1.25, q.z * 0.7)) * size * (1 + 0.15 * n3(q * 3, 1, 2)) + Vector((p.x, p.y, z + size * 0.15))
                  for q in v]
            pal = CANOPIES[self.rnd.randrange(3)]
            self.body.add(vv, f, lambda q, i, z=z: mix(pal[0], pal[2], smoothstep(z - 0.2, z + size * 0.8, q.z)))
            self.occupied.append((p.x, p.y, size))

    def boulder(self, x, y, s, sink=0.35):
        v, f = lib.ico(1.0, 1)
        z = self.top_z(x, y)
        rot = Matrix.Rotation(self.rnd.uniform(0, 3), 3, Vector((self.rnd.random(), self.rnd.random(), 1)).normalized())
        vv = [Vector((x, y, z + s * (0.6 - sink))) + rot @ Vector((q.x * 1.1, q.y, q.z * 0.75)) * s * (1 + 0.2 * n3(q * 2, 1, 4))
              for q in v]
        self.flat.add(vv, f, lambda q, i: (*mix(mix(ROCK_MID, ROCK_DARK, 0.5), ROCK_TOP, 0.6 * smoothstep(z, z + s * 1.2, q.z)), 0.7))
        self.occupied.append((x, y, s))

    # ------------------------------------------------ raíces y estalactitas
    def roots(self, count, length=1.0):
        """Raíces que asoman por la roca y cuelgan, retorciéndose un poco."""
        rnd = self.rnd
        N = self.N
        cand = [i for i, m in enumerate(self._rock_meta[:-1])
                if (m[0] == 'k' and 0.08 < m[1] < 0.6) or (m[0] == 'c' and m[1] > 0.85)]
        for _ in range(count):
            i = rnd.choice(cand)
            p0 = self._rock_verts[i]
            a = self._rock_meta[i][3]
            out = Vector((math.cos(a), math.sin(a), 0))
            L = self.R * rnd.uniform(0.18, 0.4) * length
            r0 = self.R * rnd.uniform(0.018, 0.03)
            pts = [p0 - out * r0 * 2 + Vector((0, 0, 0.3))]
            sw = rnd.uniform(0, TAU)
            for k in range(1, 6):
                t = k / 5
                pts.append(pts[0] + out * (r0 * 3 + 0.5 * math.sin(t * 2.5) * self.R / 12) + Vector((0, 0, -L * t ** 0.9)) +
                           Vector((math.cos(sw + t * 4), math.sin(sw + t * 4), 0)) * 0.45 * t * self.R / 12)
            v, f = lib.sweep(pts, lambda t: r0 * (1 - 0.75 * t), sides=4, cap_start=False, tip=r0 * 2.5,
                             phase=rnd.uniform(0, 1))
            self.body.add(v, f, lambda p, i: mix(ROOT, ROOT_TIP, min(1.0, i / 20)))
            if rnd.random() < 0.55:
                q0 = pts[2]
                d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), 0)).normalized() * 0.6 * self.R / 12
                q = [q0, q0 + d + out * 0.2 + Vector((0, 0, -L * 0.25)), q0 + d * 1.4 + out * 0.3 + Vector((0, 0, -L * 0.5))]
                v, f = lib.sweep(q, lambda t: r0 * 0.55 * (1 - 0.7 * t), sides=3, cap_start=False, tip=r0 * 1.5)
                self.body.add(v, f, ROOT)

    def spires(self, count):
        rnd = self.rnd
        for _ in range(count):
            a = rnd.uniform(0, TAU)
            s = rnd.uniform(0.35, 0.6)
            rr = (1 - s) ** 1.05 * (1 + 0.18 * math.sin(math.pi * s)) * 0.8
            c = self.rim(a) * rr + self.tip * s
            z = -self.H1 - (self.D - self.H1) * s
            w = self.R * rnd.uniform(0.1, 0.16)
            L = self.R * rnd.uniform(0.35, 0.6) * (1.2 - s)
            prof = [(w, 1.0), (w * 0.95, 0.0), (w * 0.6, -L * 0.45), (w * 0.28, -L * 0.8), (0.0, -L)]
            v, f = lib.lathe(prof, 7, lambda b: 1 + 0.18 * math.sin(3 * b + a), phase=a)
            v = [p + Vector((c.x, c.y, z)) + Vector((1, 0, 0)) * 0.0 for p in v]
            for p in v:
                p += Vector((n3(p, 0.3, 1), n3(p, 0.3, 2), 0)) * w * 0.25
            self.body.add(v, f, lambda p, i: mix(self.rock_color(p, ('k', 1, 0.0, 0, 0.0)), ROCK_MID, 0.35))

    # ------------------------------------------------ agua
    def waterfall(self, a, width=None, river=True, length=1.15):
        R = self.R
        w = width or R * 0.16
        edge = self.rim(a)
        out = Vector((math.cos(a) * self.stretch, math.sin(a), 0)).normalized()
        side = Vector((-out.y, out.x, 0))
        # río sobre la meseta
        if river:
            pts = []
            start = self.rim(a + 0.35, 0.3)
            for k in range(7):
                t = k / 6
                p = start.lerp(edge * 0.95, t) + side * math.sin(t * 3.3) * w * 0.8
                pts.append(Vector((p.x, p.y, self.top_z(p.x, p.y) + 0.12 - 0.0 * t)))
            pts[-1].z = max(pts[-1].z, 0.14)
            verts, faces = [], []
            for k, p in enumerate(pts):
                t = k / 6
                nxt = pts[min(k + 1, 6)] - pts[max(k - 1, 0)]
                sd = Vector((-nxt.y, nxt.x, 0)).normalized()
                ww = w * (0.35 + 0.55 * t)
                verts += [p + sd * ww, p - sd * ww]
            for k in range(6):
                faces.append((2 * k, 2 * k + 1, 2 * k + 3, 2 * k + 2))
            self.water.add(verts, faces, lambda p, i: (*mix(WATER, WATER_TOP, 0.25), 0.95 if i > 1 else 0.0))
            self.occupied.append(((start.x + edge.x) / 2, (start.y + edge.y) / 2, R * 0.12))
            for k in range(0, 7, 2):
                self.occupied.append((pts[k].x, pts[k].y, w * 1.2))
        # lámina que cae
        rows = 14
        cols = 5
        drop = self.D * length
        verts, faces, cdat = [], [], []
        top = Vector((edge.x, edge.y, 0.14))
        for i in range(rows):
            t = i / (rows - 1)
            if i == 0:
                c = top - out * 0.4
                z = 0.14
            else:
                u = t
                c = top + out * (0.9 + 1.4 * math.sqrt(u) * (R / 12))
                z = 0.1 - (0.25 + drop) * u ** 1.1
            ww = w * (1 + 0.6 * t)
            for k in range(cols):
                x = (k / (cols - 1)) * 2 - 1
                bulge = (1 - x * x) * 0.35 * (R / 12)
                p = Vector((c.x, c.y, z)) + side * (x * ww) + out * bulge
                verts.append(p)
                streak = 0.5 + 0.5 * math.sin(k * 2.1 + a * 3 + t * 1.5)
                col = mix(WATER, WATER_TOP, 0.45 + 0.55 * streak * (1 - 0.3 * t) if i else 1.0)
                alpha = (1 - smoothstep(0.55, 1.0, t)) * (0.85 + 0.15 * (1 - abs(x))) if i < rows - 1 else 0.0
                if abs(x) == 1:
                    alpha *= 0.6
                cdat.append((*col, alpha))
        for i in range(rows - 1):
            for k in range(cols - 1):
                a0 = i * cols + k
                faces.append((a0, a0 + 1, a0 + cols + 1, a0 + cols))
        self.water.add(verts, faces, lambda p, i: cdat[i])

    # ------------------------------------------------ salida
    def finish(self, name, ao=True):
        ob = self.body.build(name + '_body', self.M['body'])
        if self.flat.v:
            self.solids.append(self.flat.build(name + '_flat', self.M['body'], sharp_angle=12))
        if self.solids:
            ob = lib.join([ob] + self.solids, name + '_body')
        if ao:
            bake_ao(ob)
        ob.name = name
        if self.water.v:
            # objeto aparte (hijo): glTF solo admite un COLOR_0 por malla y el agua lo necesita con alfa
            w = self.water.build(name + '_water', self.M['water'])
            w.parent = ob
        return ob


def bake_ao(ob, strength=0.85, dist=None):
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('BakeWorld')
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    dims = ob.dimensions
    sc.world.light_settings.distance = dist or max(dims) * 0.12
    me = ob.data
    col = me.color_attributes['Col']
    aoa = me.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = aoa
    lib.select_only(ob)
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    vals = [aoa.data[i].color[0] for i in range(len(me.vertices))]
    print(f'AO {ob.name}: min {min(vals):.2f} media {sum(vals) / len(vals):.2f}')
    for i in range(len(me.vertices)):
        o = aoa.data[i].color[0]
        c = col.data[i].color
        k = 1 - strength * c[3] * (1 - o) ** 1.2   # alfa < 1 = AO más suave
        col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.remove(me.color_attributes['AO'])
    me.color_attributes.active_color = me.color_attributes['Col']
    me.color_attributes.render_color_index = 0


# ---------------------------------------------------------------- castillo
def castle_obj(I, M, cx=0.0, cy=0.0, s=1.0):
    """Castillo de piedra clara con torres y tejados cónicos turquesa. Puerta hacia -Y."""
    g = Mesh()
    base_z = I.top_z(cx, cy) - 0.6
    O = Vector((cx, cy, base_z))

    def stone(p, i, z0=base_z, h=8.0):
        t = smoothstep(z0, z0 + h * s, p.z)
        return mix(STONE_LOW, STONE, 0.4 + 0.6 * t)

    def roof(p, i, z0=0.0, h=1.0):
        return mix(ROOF, ROOF_LIGHT, smoothstep(z0, z0 + h, p.z) * 0.8)

    def tower(x, y, r, h, rh, seg=10, merlons=False):
        zc = base_z
        prof = [(r * 1.08, -0.2), (r, 0.6 * s), (r, h * s), (r * 1.18, h * s + 0.25 * s), (r * 1.18, h * s + 0.7 * s)]
        v, f = lib.lathe(prof, seg)
        g.add([p + Vector((x, y, zc)) for p in v], f, lambda p, i, h=h: stone(p, i, zc, h))
        z1 = zc + h * s + 0.7 * s
        v, f = lib.lathe([(r * 1.3, 0.0), (r * 0.55, rh * s * 0.55), (0.0, rh * s)], seg)
        g.add([p + Vector((x, y, z1)) for p in v], f, lambda p, i, z1=z1: roof(p, i, z1, rh * s))
        # ventanas
        for k in range(2):
            a = -math.pi / 2 + (k - 0.5) * 1.3
            wz = zc + h * s * (0.55 + 0.2 * k)
            n = Vector((math.cos(a), math.sin(a), 0))
            t = Vector((-n.y, n.x, 0))
            c = Vector((x, y, wz)) + n * (r + 0.03)
            ww, wh = 0.22 * s, 0.5 * s
            g.add([c - t * ww, c + t * ww, c + t * ww + Vector((0, 0, wh)), c + Vector((0, 0, wh * 1.35)),
                   c - t * ww + Vector((0, 0, wh))], [(0, 1, 2, 3, 4)], WINDOW)
        return z1 + rh * s

    # muralla octogonal con almenas
    Rw = 5.2 * s
    hw = 2.6 * s
    seg = 8
    v, f = lib.lathe([(Rw, -0.3), (Rw, hw), (Rw - 0.55 * s, hw), (Rw - 0.55 * s, 0.0)], seg, phase=math.pi / 8)
    g.add([p + O for p in v], f, lambda p, i: stone(p, i, base_z, hw / s))
    for j in range(seg):
        a0 = math.pi / 8 + TAU * j / seg
        a1 = a0 + TAU / seg
        p0 = Vector((math.cos(a0), math.sin(a0), 0)) * Rw
        p1 = Vector((math.cos(a1), math.sin(a1), 0)) * Rw
        for k in range(3):
            t = (k + 0.5) / 3
            c = p0.lerp(p1, t) * 0.95 + O + Vector((0, 0, hw + 0.25 * s))
            ang = math.atan2((p1 - p0).y, (p1 - p0).x)
            bv, bf = lib.box((0, 0, 0), (0.55 * s, 0.5 * s, 0.5 * s), Matrix.Rotation(ang, 3, 'Z'))
            g.add([c + p for p in bv], bf, STONE)
    # puerta hacia -Y
    dz = base_z + 0.3
    dc = O + Vector((0, -Rw * math.cos(math.pi / 8) - 0.03, 0))
    dw, dh = 0.75 * s, 1.7 * s
    g.add([dc + Vector((-dw, 0, dz - base_z)), dc + Vector((dw, 0, dz - base_z)), dc + Vector((dw, 0, dz - base_z + dh)),
           dc + Vector((0, 0, dz - base_z + dh + dw * 0.8)), dc + Vector((-dw, 0, dz - base_z + dh))],
          [(0, 1, 2, 3, 4)], WINDOW)
    # torres de esquina
    for j in (0, 2, 4, 6):
        a = math.pi / 8 + TAU * j / seg
        tower(cx + math.cos(a) * Rw, cy + math.sin(a) * Rw, 1.0 * s, 4.4, 3.0)
    # torreón central: cuerpo con tejado a cuatro aguas
    kx, ky = cx + 0.3 * s, cy + 0.8 * s
    kw, kd, kh = 3.4 * s, 2.8 * s, 6.5 * s
    bv, bf = lib.box((kx, ky, base_z + kh / 2), (kw, kd, kh))
    g.add(bv, bf, lambda p, i: stone(p, i, base_z, kh / s))
    rz = base_z + kh
    rv = [Vector((kx - kw / 2 - 0.25 * s, ky - kd / 2 - 0.25 * s, rz)), Vector((kx + kw / 2 + 0.25 * s, ky - kd / 2 - 0.25 * s, rz)),
          Vector((kx + kw / 2 + 0.25 * s, ky + kd / 2 + 0.25 * s, rz)), Vector((kx - kw / 2 - 0.25 * s, ky + kd / 2 + 0.25 * s, rz)),
          Vector((kx - kw * 0.2, ky, rz + 2.8 * s)), Vector((kx + kw * 0.2, ky, rz + 2.8 * s))]
    g.add(rv, [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (3, 2, 1, 0)], lambda p, i: roof(p, i, rz, 2.8 * s))
    for k in range(3):
        c = Vector((kx - kw * 0.3 + k * kw * 0.3, ky - kd / 2 - 0.03, base_z + kh * 0.62))
        ww, wh = 0.22 * s, 0.7 * s
        g.add([c + Vector((-ww, 0, 0)), c + Vector((ww, 0, 0)), c + Vector((ww, 0, wh)), c + Vector((0, 0, wh * 1.3)),
               c + Vector((-ww, 0, wh))], [(0, 1, 2, 3, 4)], WINDOW)
    # torre del homenaje alta con aguja
    tower(kx - 1.6 * s, ky + 0.9 * s, 1.25 * s, 10.5, 4.6, seg=12)
    tower(kx + 1.7 * s, ky + 1.1 * s, 0.85 * s, 8.0, 3.2)
    g.c = [(c[0], c[1], c[2], 0.35) for c in g.c]  # marca: AO suave en el castillo
    ob = g.build('castle', M['body'], sharp_angle=35)
    I.occupied.append((cx, cy, Rw + 0.8))
    return ob


# ---------------------------------------------------------------- modelos
def build_island_a():
    """Mediana (~27 m) con arboleda y una cascada con río."""
    I = Island(101, 12.5, depth=1.28, N=56, rings=(10, 10), crack_k=15)
    I.build_rock()
    I.build_grass()
    I.waterfall(-1.9, river=True)
    I.grove(8, 1.9)
    I.bushes(2, 1.1)
    I.boulder(*I.rim(0.8, 0.8).xy, 1.2)
    I.roots(7)
    I.spires(3)
    return I.finish('IslandA')


def build_island_b():
    """Pequeña (~18 m): rocas y un par de árboles."""
    I = Island(202, 8.5, depth=1.35, N=44, rings=(7, 10), crack_k=11)
    I.build_rock()
    I.build_grass(rings_in=(0.0, 0.5, 0.85))
    I.tree(*I.rim(2.2, 0.35).xy, 1.9)
    I.tree(*I.rim(3.4, 0.55).xy, 1.35)
    I.boulder(*I.rim(0.3, 0.45).xy, 1.3)
    I.boulder(*I.rim(0.9, 0.62).xy, 0.8)
    I.boulder(*I.rim(5.3, 0.6).xy, 0.95)
    I.bushes(2, 0.9)
    I.roots(6, 1.2)
    I.spires(2)
    return I.finish('IslandB')


def build_island_c():
    """Grande alargada (~40 m) con varias cascadas."""
    I = Island(303, 12.5, stretch=1.6, lobes=((0.2, 0.08), (math.pi + 0.3, 0.1)), depth=1.4, N=60,
               rings=(9, 10), crack_k=22)
    I.build_rock()
    I.build_grass()
    I.waterfall(-1.45, river=True, width=2.2)
    I.waterfall(-2.6, river=False, width=1.7, length=1.0)
    I.waterfall(1.35, river=True, width=1.9)
    I.grove(8, 2.0, rmax=0.75, blobs=3)
    I.bushes(1, 1.2)
    I.roots(7)
    I.spires(4)
    return I.finish('IslandC')


def build_island_castle():
    """Isla (~30 m) con castillo; puerta y cascada hacia -Y de Blender (+Z en glTF)."""
    I = Island(404, 13.5, depth=1.3, N=56, rings=(9, 10), crack_k=15)
    I.build_rock()
    I.build_grass(rings_in=(0.0, 0.45, 0.75, 0.9))
    I.solids.append(castle_obj(I, I.M, 0.0, 1.2, 1.3))
    I.waterfall(-math.pi / 2 - 0.35, river=False, width=2.4)
    I.grove(5, 1.7, rmax=0.8, clear=0.3, blobs=2)
    I.bushes(3, 1.0)
    I.roots(8)
    I.spires(3)
    return I.finish('IslandCastle')


MODELS = {'island_a': build_island_a, 'island_b': build_island_b, 'island_c': build_island_c,
          'island_castle': build_island_castle}

VIEWS = {'34': dict(view=(1.0, -1.25, 0.55), margin=0.9), 'bajo': dict(view=(1.0, -1.5, -0.35), margin=0.9)}


def export(ob, filename):
    objs = [ob] + list(ob.children)
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(lib.ASSETS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_normals=True, export_materials='EXPORT',
        export_vertex_color='MATERIAL', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_cameras=False, export_lights=False,
        export_extras=False, export_animations=False)
    tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
    d = ob.dimensions
    print(f'EXPORT {filename}: {os.path.getsize(path) / 1024:.1f} KB, {tris} tris, '
          f'dims (Blender XYZ) {d.x:.2f} x {d.y:.2f} x {d.z:.2f} m')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    do_preview = '--no-preview' not in argv
    names = [a for a in argv if not a.startswith('--')] or list(MODELS)
    for name in names:
        lib.reset()
        ob = MODELS[name]()
        export(ob, f'{name}.glb')
        if do_preview:
            for k, pv in VIEWS.items():
                lib.preview(ob, f'{name}-{k}.png', **pv)


main()
