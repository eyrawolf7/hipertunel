#ifdef __clang__
#pragma STDC FP_CONTRACT OFF
#endif

#include "bot.h"
#include <math.h>
#include "jsmath.h"

/* Las sumas de peligro se hacen en el mismo orden que en JS: con doubles, cambiar el orden de
   las sumas cambia el último bit y, a la larga, la partida. */
double bot_steer(const Game *g, int look) {
  int cur = (int)floor(g->s), i, j, l, best = 0, open;
  double danger[LANES] = {0}, bonus[LANES] = {0}, th, bestScore = -1e9, da, s;
  for (i = 0; i < g->nBoxes; i++) {
    const Box *b = &g->boxes[i];
    int d, lanes[3], nl = 0;
    double w;
    if (b->hit) continue;
    d = b->k - cur;
    if (d < -1 || d > look) continue;
    w = 1.0 / (1 + (d > 0 ? d : 0));
    lanes[nl++] = b->lane;
    if (!b->fixed) lanes[nl++] = (b->lane + (b->rollSpeed > 0 ? 1 : b->rollSpeed < 0 ? -1 : 0) + LANES) % LANES;
    if (b->opp >= 0) lanes[nl++] = b->opp;
    for (j = 0; j < nl; j++) {
      l = lanes[j];
      danger[l] += 10 * w;
      danger[(l + 1) % LANES] += 0.8 * w;
      danger[(l + LANES - 1) % LANES] += 0.8 * w;
    }
  }
  for (i = 0; i < g->nPads; i++) {
    const Pad *p = &g->pads[i];
    int d = p->k - cur;
    if (!p->taken && d >= 0 && d < look) bonus[p->lane] += 3.0 / (1 + d);
  }
  th = g->theta;
  open = g->fold != 30 && g->fold != -30;
  for (l = 0; l < LANES; l++) {
    double score;
    da = lane_angle(l) - th;
    if (!open) da = js_atan2(js_sin(da), js_cos(da));
    score = -danger[l] + bonus[l] - fabs(da) * 0.4;
    if (score > bestScore) { bestScore = score; best = l; }
  }
  da = lane_angle(best) - th;
  if (!open) da = js_atan2(js_sin(da), js_cos(da));
  s = da * 0.35;
  return s < -0.5 ? -0.5 : s > 0.5 ? 0.5 : s;
}
