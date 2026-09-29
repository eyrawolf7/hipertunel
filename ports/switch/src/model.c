/* Lector de GLB con cgltf (ver model.h). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "model.h"
#include "assets.h"
#define CGLTF_IMPLEMENTATION
#include "cgltf.h"

static const Asset *find_asset(const char *name) {
  int i;
  for (i = 0; ASSETS[i].name; i++) if (!strcmp(ASSETS[i].name, name)) return &ASSETS[i];
  return NULL;
}

static int under(const cgltf_node *n, const char *name) {
  for (; n; n = n->parent) if (n->name && !strcmp(n->name, name)) return 1;
  return 0;
}

static void read_attr(const cgltf_accessor *a, int comps, float *out, int stride, int off, int nv, const float *def) {
  int i, k;
  for (i = 0; i < nv; i++) {
    float v[4]; memcpy(v, def, sizeof v);
    if (a) cgltf_accessor_read_float(a, (cgltf_size)i, v, (cgltf_size)comps);
    for (k = 0; k < comps; k++) out[i * stride + off + k] = v[k];
  }
}

int model_load(Model *m, const char *asset, const char *node) {
  const Asset *as = find_asset(asset);
  cgltf_options opt; cgltf_data *d = NULL;
  cgltf_size ni;
  memset(m, 0, sizeof *m);
  snprintf(m->name, sizeof m->name, "%s", node ? node : asset);
  if (!as) { fprintf(stderr, "falta el modelo %s\n", asset); return 1; }
  memset(&opt, 0, sizeof opt);
  if (cgltf_parse(&opt, as->data, as->size, &d) != cgltf_result_success) return 1;
  if (cgltf_load_buffers(&opt, d, NULL) != cgltf_result_success) { cgltf_free(d); return 1; }
  for (ni = 0; ni < d->nodes_count; ni++) {
    const cgltf_node *nd = &d->nodes[ni];
    float W[16], Nm[9];
    cgltf_size pi;
    if (!nd->mesh) continue;
    if (node && !under(nd, node)) continue;
    cgltf_node_transform_world(nd, W);
    /* matriz de normales: inversa traspuesta de la parte 3×3 (sin escalas raras, basta la 3×3 normalizada) */
    { int r, c; for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) Nm[r * 3 + c] = W[c * 4 + r]; }
    for (pi = 0; pi < nd->mesh->primitives_count && m->n < MODEL_MAXP; pi++) {
      const cgltf_primitive *pr = &nd->mesh->primitives[pi];
      const cgltf_accessor *aP = NULL, *aN = NULL, *aU = NULL, *aT = NULL, *aC = NULL;
      cgltf_size ai, nv, nIdx, i;
      float *v; unsigned *idx;
      Prim *P = &m->p[m->n];
      static const float d0[4] = { 0, 0, 0, 0 }, dT[4] = { 1, 0, 0, 1 }, dC[4] = { 1, 1, 1, 1 };
      for (ai = 0; ai < pr->attributes_count; ai++) {
        const cgltf_attribute *at = &pr->attributes[ai];
        if (at->type == cgltf_attribute_type_position) aP = at->data;
        else if (at->type == cgltf_attribute_type_normal) aN = at->data;
        else if (at->type == cgltf_attribute_type_texcoord && at->index == 0) aU = at->data;
        else if (at->type == cgltf_attribute_type_tangent) aT = at->data;
        else if (at->type == cgltf_attribute_type_color && at->index == 0) aC = at->data;
      }
      if (!aP) continue;
      nv = aP->count;
      v = calloc(nv * 16, sizeof(float));
      read_attr(aP, 3, v, 16, 0, (int)nv, d0);
      read_attr(aN, 3, v, 16, 3, (int)nv, d0);
      read_attr(aU, 2, v, 16, 6, (int)nv, d0);
      read_attr(aT, 4, v, 16, 8, (int)nv, dT);
      read_attr(aC, aC && aC->type == cgltf_type_vec3 ? 3 : 4, v, 16, 12, (int)nv, dC);
      for (i = 0; i < nv; i++) {
        float *o = &v[i * 16];
        if (aC && aC->type == cgltf_type_vec3) o[15] = 1;
        /* nodo → mundo del modelo */
        { float x = o[0], y = o[1], z = o[2];
          o[0] = W[0] * x + W[4] * y + W[8] * z + W[12]; o[1] = W[1] * x + W[5] * y + W[9] * z + W[13]; o[2] = W[2] * x + W[6] * y + W[10] * z + W[14]; }
        { int k; for (k = 0; k < 2; k++) { int off = k ? 8 : 3; float x = o[off], y = o[off + 1], z = o[off + 2], l;
            float nx = W[0] * x + W[4] * y + W[8] * z, ny = W[1] * x + W[5] * y + W[9] * z, nz = W[2] * x + W[6] * y + W[10] * z;
            l = sqrtf(nx * nx + ny * ny + nz * nz); if (l > 0) { nx /= l; ny /= l; nz /= l; }
            o[off] = nx; o[off + 1] = ny; o[off + 2] = nz; } }
        { int k; for (k = 0; k < 3; k++) { if (i == 0 || o[k] < P->bmin[k]) P->bmin[k] = o[k]; if (i == 0 || o[k] > P->bmax[k]) P->bmax[k] = o[k]; } }
      }
      (void)Nm;
      nIdx = pr->indices ? pr->indices->count : nv;
      idx = malloc(nIdx * sizeof(unsigned));
      for (i = 0; i < nIdx; i++) idx[i] = pr->indices ? (unsigned)cgltf_accessor_read_index(pr->indices, i) : (unsigned)i;
      glGenVertexArrays(1, &P->vao); glBindVertexArray(P->vao);
      glGenBuffers(1, &P->vbo); glBindBuffer(GL_ARRAY_BUFFER, P->vbo);
      glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(nv * 16 * sizeof(float)), v, GL_STATIC_DRAW);
      { int loc, off = 0; static const int sz[5] = { 3, 3, 2, 4, 4 };
        for (loc = 0; loc < 5; loc++) { glEnableVertexAttribArray((GLuint)loc); glVertexAttribPointer((GLuint)loc, sz[loc], GL_FLOAT, GL_FALSE, 64, (void *)(size_t)(off * 4)); off += sz[loc]; } }
      glGenBuffers(1, &P->ibo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, P->ibo);
      glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(nIdx * sizeof(unsigned)), idx, GL_STATIC_DRAW);
      glBindVertexArray(0);
      P->nIdx = (int)nIdx;
      P->color[0] = P->color[1] = P->color[2] = P->color[3] = 1;
      if (pr->material) {
        const cgltf_material *mt = pr->material;
        snprintf(P->mat, sizeof P->mat, "%s", mt->name ? mt->name : "");
        if (mt->has_pbr_metallic_roughness) memcpy(P->color, mt->pbr_metallic_roughness.base_color_factor, sizeof P->color);
        memcpy(P->emissive, mt->emissive_factor, sizeof P->emissive);
        P->blend = mt->alpha_mode == cgltf_alpha_mode_blend;
      }
      free(v); free(idx);
      m->n++;
    }
  }
  cgltf_free(d);
  return m->n == 0;
}

void model_bind_instances(Model *m, GLuint vbo, int firstLoc, int nAttr, const int *sizes) {
  int i, a, stride = 0, off;
  for (a = 0; a < nAttr; a++) stride += sizes[a];
  for (i = 0; i < m->n; i++) {
    glBindVertexArray(m->p[i].vao);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    for (a = 0, off = 0; a < nAttr; a++) {
      GLuint loc = (GLuint)(firstLoc + a);
      glEnableVertexAttribArray(loc);
      glVertexAttribPointer(loc, sizes[a], GL_FLOAT, GL_FALSE, stride * 4, (void *)(size_t)(off * 4));
      glVertexAttribDivisor(loc, 1);
      off += sizes[a];
    }
  }
  glBindVertexArray(0);
}
