/* Port de app/src/render/track.js (ver track.h). */
#include "track.h"
#include <string.h>

#define DEG (M_PI / 180)
const double TR_R = R_UNITS * M_PER_UNIT;                       /* 4 m */
#define CELLW (2 * (R_UNITS * M_PER_UNIT) * 0.25881904510252074)  /* 2R·sen(π/12) */
const double TR_CELL_W = CELLW;

void track_reset(Track *t) { memset(t, 0, sizeof *t); }

const Frame *track_ring(const Track *t, int k) {
  const Ring *r = &t->rings[((k % RING_SLOTS) + RING_SLOTS) % RING_SLOTS];
  return r->valid && r->k == k ? &r->f : NULL;
}

void track_sync(Track *t, const Game *g) {
  int i;
  for (i = 0; i < g->nRows; i++) {
    const Row *row = &g->rows[i];
    const Frame *prev;
    Ring *slot;
    V3 F, P, U;
    if (track_ring(t, row->k)) continue;
    prev = track_ring(t, row->k - 1);
    F = vnorm(v3(sin(row->yaw * DEG) * cos(row->pitch * DEG), sin(row->pitch * DEG),
                 -cos(row->yaw * DEG) * cos(row->pitch * DEG)));
    if (prev) {
      P = vmad(prev->P, prev->F, ROW_M);
      U = vnorm(vmad(prev->U, F, -vdot(prev->U, F)));
    } else {
      P = v3(0, 0, -row->k * (double)ROW_M);
      U = vnorm(vmad(v3(0, 1, 0), F, -F.y));
    }
    slot = &t->rings[((row->k % RING_SLOTS) + RING_SLOTS) % RING_SLOTS];
    slot->k = row->k; slot->valid = 1;
    slot->f.P = P; slot->f.F = F; slot->f.U = U; slot->f.X = vnorm(vcross(F, U));
    if (!t->any || row->k > t->maxK) { t->maxK = row->k; t->any = 1; }
  }
  /* los anillos viejos (k < kFirst − 4) se olvidan: el hueco de la tabla se reutiliza solo */
  for (i = 0; i < RING_SLOTS; i++)
    if (t->rings[i].valid && t->rings[i].k < g->kFirst - 4) t->rings[i].valid = 0;
}

void track_frame_at(const Track *t, double s, Frame *out) {
  int k = (int)floor(s);
  double tt = s - k;
  const Frame *a = track_ring(t, k), *b;
  if (!a) a = track_ring(t, k + 1);
  if (!a) a = track_ring(t, t->maxK);
  if (!a) { out->P = v3(0, 0, 0); out->F = v3(0, 0, -1); out->U = v3(0, 1, 0); out->X = v3(1, 0, 0); return; }
  b = track_ring(t, k + 1);
  if (!b) b = a;
  out->P = vlerp(a->P, b->P, tt);
  out->F = vnorm(vlerp(a->F, b->F, tt));
  out->U = vlerp(a->U, b->U, tt);
  out->U = vnorm(vmad(out->U, out->F, -vdot(out->U, out->F)));
  out->X = vnorm(vcross(out->F, out->U));
}

void track_section(double fold, Section *sec) {
  double a = fold * DEG;
  int i;
  sec->fold = fold;
  sec->b[0] = -CELLW / 2; sec->b[1] = -TR_R * cos(M_PI / LANES);
  for (i = 0; i < LANES; i++) {
    double c = cos(i * a), s = sin(i * a);
    sec->d[i * 2] = c; sec->d[i * 2 + 1] = s;
    sec->b[(i + 1) * 2] = sec->b[i * 2] + CELLW * c;
    sec->b[(i + 1) * 2 + 1] = sec->b[i * 2 + 1] + CELLW * s;
  }
}

void track_surf(const Section *sec, double u, int closed, Surf *out) {
  const double *b = sec->b, *d = sec->d;
  const double blendW = 0.3;
  int c, edge;
  double t, nx, ny;
  if (closed) u = fmod(fmod(u + 0.5, LANES) + LANES, LANES) - 0.5;
  c = (int)floor(u + 0.5);
  if (c < 0) c = 0;
  if (c > LANES - 1) c = LANES - 1;
  t = u - (c - 0.5);
  out->x = b[c * 2] + d[c * 2] * CELLW * t;
  out->y = b[c * 2 + 1] + d[c * 2 + 1] * CELLW * t;
  nx = -d[c * 2 + 1]; ny = d[c * 2];
  edge = t < blendW ? c - 1 : t > 1 - blendW ? c + 1 : -99;
  if (edge != -99) {
    int e = closed ? (edge + LANES) % LANES : edge;
    if (e >= 0 && e < LANES) {
      double w = 0.5 - 0.5 * (t < blendW ? t / blendW : (1 - t) / blendW), l;
      nx = nx * (1 - w) + -d[e * 2 + 1] * w;
      ny = ny * (1 - w) + d[e * 2] * w;
      l = hypot(nx, ny); nx /= l; ny /= l;
    }
  }
  out->nx = nx; out->ny = ny;
  out->tx = d[c * 2]; out->ty = d[c * 2 + 1];
}
