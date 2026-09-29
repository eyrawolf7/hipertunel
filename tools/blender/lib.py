"""Utilidades comunes para generar los modelos de Hipertúnel con Blender (sin interfaz).

Todo se construye con geometría procedural (listas de vértices y caras) para que sea
reproducible al 100 %: mismas semillas -> mismos GLB.
"""
import bpy
import bmesh
import math
import os
import random
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'app', 'src', 'assets')
PREVIEWS = '/private/tmp/blender-previews'


# ---------------------------------------------------------------- colores
def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    """'#ffc21a' -> tupla RGB lineal (lo que esperan Blender y glTF)."""
    h = h.lstrip('#')
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- escena
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color=(1, 1, 1), rough=0.5, metal=0.0, emit=None, emit_strength=1.0,
             vcol=False, double=False):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit is not None:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_strength
    if vcol:
        n = nt.nodes.new('ShaderNodeVertexColor')
        n.layer_name = 'Col'
        nt.links.new(n.outputs['Color'], b.inputs['Base Color'])
    m.use_backface_culling = not double
    m.diffuse_color = (*color, 1)
    return m


def mesh_obj(name, verts, faces, mat=None, smooth=True, sharp_angle=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    shade(ob, smooth, sharp_angle)
    return ob


def shade(ob, smooth=True, sharp_angle=None):
    select_only(ob)
    if not smooth:
        bpy.ops.object.shade_flat()
    elif sharp_angle is not None:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(sharp_angle))
    else:
        bpy.ops.object.shade_smooth()


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def paint(ob, fn, per='face'):
    """Pinta el atributo de color 'Col'. fn(pos_mundo, normal, poligono) -> RGB lineal."""
    me = ob.data
    attr = me.color_attributes.get('Col') or me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    mw = ob.matrix_world
    nm = mw.to_3x3()
    for p in me.polygons:
        n = (nm @ p.normal).normalized()
        if per == 'face':
            c = fn(mw @ p.center, n, p)
            for li in p.loop_indices:
                attr.data[li].color = (*c, 1)
        else:
            for li in p.loop_indices:
                v = me.vertices[me.loops[li].vertex_index]
                c = fn(mw @ v.co, (nm @ v.normal).normalized(), p)
                attr.data[li].color = (*c, 1)
    me.color_attributes.active_color = attr
    return ob


def solid(ob, rgb):
    return paint(ob, lambda *_: rgb)


def join(objs, name):
    objs = [o for o in objs if o is not None]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


# ---------------------------------------------------------------- primitivas
def ico(radius=1.0, subdiv=2):
    """Icosfera (vértices, caras) de radio dado."""
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
         (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [Vector(p).normalized() for p in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2),
         (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5),
         (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdiv):
        cache = {}

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                cache[k] = len(v)
                v.append(((v[a] + v[b]) / 2).normalized())
            return cache[k]
        nf = []
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    return [p * radius for p in v], f


def uvsphere(radius=1.0, seg=16, rings=10):
    verts = [Vector((0, 0, radius))]
    for i in range(1, rings):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            verts.append(Vector((radius * math.sin(th) * math.cos(ph), radius * math.sin(th) * math.sin(ph),
                                 radius * math.cos(th))))
    verts.append(Vector((0, 0, -radius)))
    faces = []
    for j in range(seg):
        faces.append((0, 1 + j, 1 + (j + 1) % seg))
    for i in range(rings - 2):
        a, b = 1 + i * seg, 1 + (i + 1) * seg
        for j in range(seg):
            j2 = (j + 1) % seg
            faces.append((a + j, b + j, b + j2, a + j2))
    last = len(verts) - 1
    base = 1 + (rings - 2) * seg
    for j in range(seg):
        faces.append((base + (j + 1) % seg, base + j, last))
    return verts, faces


def lathe(profile, seg, radius_fn=None, phase=0.0):
    """Superficie de revolución alrededor de Z. profile = [(r, z), ...] de arriba abajo.
    Si r == 0 en un extremo se cierra en abanico. radius_fn(ang) escala el radio por ángulo."""
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r == 0:
            rings.append([len(verts)])
            verts.append(Vector((0, 0, z)))
            continue
        ring = []
        for j in range(seg):
            a = phase + 2 * math.pi * j / seg
            k = radius_fn(a) if radius_fn else 1.0
            ring.append(len(verts))
            verts.append(Vector((r * k * math.cos(a), r * k * math.sin(a), z)))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        if len(A) == 1:
            for j in range(seg):
                faces.append((A[0], B[j], B[(j + 1) % seg]))
        elif len(B) == 1:
            for j in range(seg):
                faces.append((A[(j + 1) % seg], A[j], B[0]))
        else:
            for j in range(seg):
                j2 = (j + 1) % seg
                faces.append((A[j], B[j], B[j2], A[j2]))
    return verts, faces


def transform(verts, mat):
    return [mat @ Vector(v) for v in verts]


def mesh_vc(name, verts, faces, cols, mat=None, smooth=True, sharp_angle=None):
    """Como mesh_obj, pero con un color RGB lineal por vértice (cols[i])."""
    ob = mesh_obj(name, verts, faces, mat, smooth, sharp_angle)
    me = ob.data
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for p in me.polygons:
        for li in p.loop_indices:
            attr.data[li].color = (*cols[me.loops[li].vertex_index], 1)
    me.color_attributes.active_color = attr
    return ob


class Geo:
    """Acumula primitivas (vértices, caras, color por vértice) para crear un solo objeto."""

    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def add(self, verts, faces, col):
        o = len(self.v)
        for p in verts:
            p = Vector(p)
            self.v.append(p)
            self.c.append(col(p) if callable(col) else col)
        self.f += [tuple(i + o for i in fc) for fc in faces]
        return self

    def build(self, name, mat, **kw):
        return mesh_vc(name, self.v, self.f, self.c, mat, **kw)


def bevel(ob, offset=0.03, segments=2, profile=0.5):
    """Bisela todas las aristas del objeto (bmesh)."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.bevel(bm, geom=list(bm.verts) + list(bm.edges), offset=offset, segments=segments,
                    profile=profile, affect='EDGES', clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def box8(c):
    """Caras de un hexaedro con esquinas c[ix + 2*iy + 4*iz] (normales hacia fuera)."""
    return c, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


def box(center, size, rot=None):
    sx, sy, sz = (s / 2 for s in size)
    c = [Vector(((ix * 2 - 1) * sx, (iy * 2 - 1) * sy, (iz * 2 - 1) * sz))
         for iz in (0, 1) for iy in (0, 1) for ix in (0, 1)]
    if rot is not None:
        c = [rot @ p for p in c]
    return box8([p + Vector(center) for p in c])


def frame(t, up=None):
    """Dos vectores perpendiculares a t."""
    t = Vector(t).normalized()
    up = up or (Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
    n = t.cross(up).normalized()
    return n, t.cross(n)


def sweep(path, radius, sides=6, cap_start=True, tip=0.0, phase=0.0):
    """Tubo a lo largo de path (transporte paralelo). radius(t) o número. tip>0: punta final."""
    path = [Vector(p) for p in path]
    n = len(path)
    T = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    N, _ = frame(T[0])
    verts, faces = [], []
    for i in range(n):
        if i:
            ax = T[i - 1].cross(T[i])
            if ax.length > 1e-6:
                N = Matrix.Rotation(T[i - 1].angle(T[i]), 3, ax.normalized()) @ N
        B = T[i].cross(N)
        r = radius(i / (n - 1)) if callable(radius) else radius
        for j in range(sides):
            a = phase + 2 * math.pi * j / sides
            verts.append(path[i] + (N * math.cos(a) + B * math.sin(a)) * r)
    for i in range(n - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            faces.append((i * sides + j, i * sides + j2, (i + 1) * sides + j2, (i + 1) * sides + j))
    if cap_start:
        faces.append(tuple(reversed(range(sides))))
    last = (n - 1) * sides
    if tip > 0:
        verts.append(path[-1] + T[-1] * tip)
        for j in range(sides):
            faces.append((last + j, last + (j + 1) % sides, len(verts) - 1))
    else:
        faces.append(tuple(range(last, last + sides)))
    return verts, faces


def catmull(pts, per=6):
    """Curva suave (Catmull-Rom) que pasa por pts; per puntos por tramo."""
    pts = [Vector(p) for p in pts]
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for k in range(per):
            t = k / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return out


def leaf(base, direction, normal, length, width, n=6, cup=0.18):
    """Hoja redonda con punta: abanico de n triángulos. Devuelve (verts, faces); el vértice 0 es el centro."""
    d = Vector(direction).normalized()
    nn = Vector(normal)
    nn = (nn - d * nn.dot(d)).normalized()
    s = nn.cross(d)
    c = Vector(base) + d * (length * 0.5)
    verts = [c + nn * (width * cup)]
    for k in range(n):
        th = math.pi + 2 * math.pi * k / n  # empieza en el pecíolo
        x = math.cos(th) * length * 0.5
        y = math.sin(th) * width * 0.5
        if k == n // 2:
            x *= 1.18  # punta
        verts.append(c + d * x + s * y)
    faces = [(0, 1 + k, 1 + (k + 1) % n) for k in range(n)]
    return verts, faces


# ---------------------------------------------------------------- salida
def export(ob, filename):
    os.makedirs(ASSETS, exist_ok=True)
    select_only(ob)
    path = os.path.join(ASSETS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_normals=True, export_materials='EXPORT',
        export_vertex_color='MATERIAL', export_all_vertex_colors=False,
        export_active_vertex_color_when_no_material=False, export_cameras=False, export_lights=False, export_extras=False,
        export_animations=False)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    dims = ob.dimensions
    print(f'EXPORT {filename}: {os.path.getsize(path) / 1024:.1f} KB, {tris} tris, '
          f'dims (Blender XYZ) {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f} m')
    return path


def preview(ob, filename, view=(1.0, -1.25, 0.7), sky='#bfe6ff', lens=50, margin=1.15):
    """Render EEVEE 512x512 en vista 3/4 con fondo claro."""
    os.makedirs(PREVIEWS, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.render.film_transparent = False
    try:
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
    except Exception:
        pass
    world = bpy.data.worlds.new('PreviewWorld')
    sc.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*hexc(sky), 1)
    bg.inputs['Strength'].default_value = 1.0

    corners = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    center = sum(corners, Vector()) / 8
    radius = max((c - center).length for c in corners)

    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 3.5
    sun.angle = math.radians(8)
    so = bpy.data.objects.new('Sun', sun)
    sc.collection.objects.link(so)
    to_light = Matrix.Rotation(math.radians(50), 3, 'Z') @ Vector((view[0], view[1], 0)).normalized()
    to_light = (to_light + Vector((0, 0, 1.3))).normalized()
    so.rotation_euler = (-to_light).to_track_quat('-Z', 'Y').to_euler()

    cam = bpy.data.cameras.new('Cam')
    cam.lens = lens
    cam.clip_end = radius * 20
    co = bpy.data.objects.new('Cam', cam)
    sc.collection.objects.link(co)
    fov = 2 * math.atan(18 / lens)
    d = radius * margin / math.sin(fov / 2)
    direction = Vector(view).normalized()
    co.location = center + direction * d
    co.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.filepath = os.path.join(PREVIEWS, filename)
    bpy.ops.render.render(write_still=True)
    for o in (so, co):
        bpy.data.objects.remove(o)
    print('PREVIEW', sc.render.filepath)
