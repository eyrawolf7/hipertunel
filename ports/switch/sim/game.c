/* Port exacto a C99 de app/src/sim/game.js. Cada función lleva el nombre de su método en JS.
   Si cambias game.js, cambia esto igual y pasa ports/switch/tools/parity.sh. */
#ifdef __clang__
#pragma STDC FP_CONTRACT OFF
#endif

#include "game.h"
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PI  3.141592653589793          /* Math.PI */
#define DEG (PI / 180)
#define TAU (PI * 2)

#define V_EPS 0.001
#define V_UP 0.025
#define V_DOWN 0.1
#define BOOST_TOWARD 7.0
#define BOOST_K 0.33
#define INVUL_S 1.5

static void overflow(const char *what) {
  fprintf(stderr, "hipertunel sim: se ha llenado %s\n", what);
  abort();
}

/* a %= TAU en JS es fmod: conserva el signo del dividendo */
static double wrap_angle(double a) { a = fmod(a, TAU); return a < 0 ? a + TAU : a; }
double lane_angle(int l) { return l * CELL_DEG * DEG; }
/* el % de enteros de C99 trunca hacia cero, igual que el de JS */
static int imod(int a, int n) { return ((a % n) + n) % n; }
/* Math.sign: devuelve el propio 0 (o -0) si x es cero */
static double js_sign(double x) { return x > 0 ? 1 : x < 0 ? -1 : x; }
/* Math.round: el .5 va hacia +infinito (el round de C lo aleja del cero) */
#define ARC_COMPRESS 0.4
#define ARC_GAP_ROWS 6
#define ARC_CAMP_ROWS 22
static double js_round(double x) { double r = floor(x); return (x - r >= 0.5) ? r + 1 : r; }

double strip_half_width(double fold) {
  return (22.5 - (1 - (CELL_DEG + fold) / 60) * 7.5) * DEG;
}

static int angle_in(double theta, double lo, double hi) {
  if (hi > lo) return theta > lo && theta < hi;
  return theta > lo || theta < hi;
}

static int is_open(const Game *g) { return g->fold != FOLD_IN && g->fold != FOLD_OUT; }

static void event(Game *g, EventType type, Event **out) {
  Event *e;
  if (g->nEvents >= MAX_EVENTS) overflow("events");
  e = &g->events[g->nEvents++];
  memset(e, 0, sizeof *e);
  e->type = type;
  e->frame = g->frame;
  if (out) *out = e;
}

static void push_row(Game *g, int initial);
static void on_new_row(Game *g, int k);

void game_init(Game *g, GameMode mode, uint32_t seed) {
  memset(g, 0, sizeof *g);
  g->mode = mode;
  g->seed = seed;
  rng_init(&g->rng, g->seed);
  game_reset(g);
}

void game_reset(Game *g) {
  Rng *rng = &g->rng;
  int i, god = g->god;
  GameMode mode = g->mode; uint32_t seed = g->seed; Rng keep = g->rng;
  memset(g, 0, sizeof *g);
  g->mode = mode; g->seed = seed; g->rng = keep; g->god = god;

  g->frame = 0;
  g->time = 0;
  g->nEvents = 0;

  g->fold = FOLD_IN;
  g->folding = 0; g->foldToIn = 0; g->foldRows = 0; g->foldStarted = 0;
  g->world = g->mode == MODE_SURVIVAL ? 2 : 0;
  g->worldRows = -1;
  g->curves = 1;
  g->turn.yawT = 0; g->turn.pitchT = 0; g->turn.dYaw = 0; g->turn.dPitch = 0;
  g->turn.thr = 2; g->turn.need = 1; g->turn.yawOn = 0; g->turn.pitchOn = 0;
  g->nRows = 0;
  g->kFirst = 0;

  g->s = 0; g->theta = 0; g->omega = 0;
  g->v = V_START; g->vTarget = V_START;
  g->level = 0; g->boostOn = 0; g->invul = 0; g->alive = 1;
  g->crashes = 0; g->rowsPassed = 0;
  g->maxBoostTime = 0; g->boostTime = 0;
  g->boostTotal = 0;
  g->timeLeft = 60;
  g->lastCollideRow = -99;

  g->nBoxes = 0;
  g->nextBoxId = 1;
  g->nWaves = build_waves(g->mode, rng, g->waves);
  if (g->nWaves < 0) { fprintf(stderr, "modo desconocido\n"); abort(); }
  g->waveIdx = 0;
  g->wave = &g->waves[0];
  g->waveLeft = g->wave->n;
  g->gap = 0;
  g->hasColl = 0;
  g->intervalCount = 0;
  g->lastLoc = rng_int(rng, 0, 100000) % LANES;
  g->invertedHold = 0;
  g->boostCounter = 0;
  g->nPads = 0;

  rng_init(&g->coinRng, g->seed ^ 0x9e3779b9u);
  g->nCoins = 0;
  g->hasCoinRun = 0;
  g->coinsGot = 0;
  g->nGaps = 0;
  g->coinStreak = 0; g->coinStreakT = 0;

  for (i = 0; i < ROWS; i++) push_row(g, 1);
  /* BoxManager+0x70 empieza desfasado: hay una pasada de cajas en el primer fotograma */
  g->pendingRow = 1;
}

/* ------------------------------------------------------------------ túnel */
static void next_turn(Game *g, const Row *prev) {   /* Tunnel::calculateNextAngle */
  Turn *t = &g->turn; Rng *rng = &g->rng;
  double r, k, step;
  t->yawT = rng_float(rng, -45, 45);
  t->pitchT = rng_float(rng, -45, 45);
  rng_float(rng, 0.5, 2);                           /* tirada que el original descarta */
  r = rng_float(rng, 0.5, 3.5);
  k = 1 - (g->vTarget - 2) / 5.5;
  k = k > 1 ? 1 : k < 0 ? 0 : k;
  step = 0;
  if (g->curves) step = r * k;
  t->thr = 2 + step;
  t->dYaw = t->yawT - prev->yaw > 0 ? -step : step;
  t->dPitch = t->pitchT - prev->pitch > 0 ? step : -step;
  t->yawOn = step != 0; t->pitchOn = step != 0;
  t->need = 0;
}

static void push_row(Game *g, int initial) {
  Row row; int k = 0; double yaw = 0, pitch = 0;
  if (g->nRows > 0) {
    const Row *prev = &g->rows[g->nRows - 1];
    Turn *t = &g->turn;
    k = prev->k + 1;
    if (t->need && !g->folding) next_turn(g, prev);
    yaw = prev->yaw - t->dYaw;
    pitch = prev->pitch + t->dPitch;
    if (fabs(yaw - t->yawT) < t->thr) t->yawOn = 0;
    if (fabs(pitch - t->pitchT) < t->thr) t->pitchOn = 0;
    if (!t->yawOn && !t->pitchOn) t->need = 1;
    if (g->folding) {
      if (g->foldRows == 0) { t->dYaw = t->dPitch = 0; t->yawOn = t->pitchOn = 0; }
      g->foldRows++;
    }
  }
  row.k = k; row.yaw = yaw; row.pitch = pitch; row.taken = 0;
  /* push + shift si pasa de 30 */
  if (g->nRows == ROWS) { memmove(&g->rows[0], &g->rows[1], sizeof(Row) * (ROWS - 1)); g->nRows--; }
  g->rows[g->nRows++] = row;
  g->kFirst = g->rows[0].k;
  if (!initial) on_new_row(g, row.k);
}

const Row *game_row_at(const Game *g, int k) {
  int i = k - g->kFirst;
  return i >= 0 && i < g->nRows ? &g->rows[i] : NULL;
}
int game_klast(const Game *g) { return g->rows[g->nRows - 1].k; }

/* ------------------------------------------------------------------ fila nueva */
static void update_boxes(Game *g, int k);
static void spawn_boosts(Game *g, int k);
static void spawn_coins(Game *g, int k);

static void on_new_row(Game *g, int k) {
  if (g->worldRows > 0 && --g->worldRows == 0) {
    Event *e;
    g->world = g->world + 1 < 6 ? g->world + 1 : 6;
    event(g, EV_WORLD, &e); e->world = g->world;
  }
  /* las cajas de esta fila las pone BoxManager::update en el fotograma siguiente */
  spawn_boosts(g, k);
  g->pendingRow = 1;
}

int game_inverted(const Game *g) { return g->world == 1 || g->world == 3 || g->world == 5; }

static int coin_free(const Game *g, int l, int k) {
  int i;
  for (i = 0; i < g->nBoxes; i++) {
    const Box *b = &g->boxes[i];
    if ((b->lane == l || b->opp == l) && b->k >= k - 2 && b->k <= k + 1) return 0;
  }
  for (i = 0; i < g->nPads; i++) {
    const Pad *p = &g->pads[i];
    if (p->lane == l && abs(p->k - k) < 2) return 0;
  }
  return 1;
}

static void spawn_coins(Game *g, int k) {
  Rng *rng = &g->coinRng;
  CoinRun *run = &g->coinRun;
  if (!g->hasCoinRun) {
    double p = game_inverted(g) ? 0.35 : g->folding ? 0.05 : 0.045;
    if (rng_next(rng) > p) return;
    run->lane = (int)trunc(rng_float(rng, 0, LANES));
    run->left = (int)trunc(rng_float(rng, 5, 11));
    run->curve = rng_next(rng) < 0.35 ? (rng_next(rng) < 0.5 ? 1 : -1) : 0;
    run->step = 0;
    g->hasCoinRun = 1;
  }
  if (run->curve && ++run->step % 2 == 0) run->lane = imod(run->lane + run->curve, LANES);
  if (is_open(g)) run->lane = run->lane < 0 ? 0 : run->lane > LANES - 1 ? LANES - 1 : run->lane;
  if (coin_free(g, run->lane, k)) {
    Coin *c;
    if (g->nCoins >= MAX_COINS) overflow("coins");
    c = &g->coins[g->nCoins++];
    c->k = k; c->lane = run->lane; c->got = 0;
  }
  if (--run->left <= 0) g->hasCoinRun = 0;
}

static void check_coins(Game *g) {
  const double hw = 0.33;
  int i;
  for (i = 0; i < g->nCoins; i++) {
    Coin *c = &g->coins[i];
    double d, a; int ok; Event *e;
    if (c->got) continue;
    d = g->s - (c->k - 0.5);
    if (d < -0.55 || d > 0.45) continue;
    a = lane_angle(c->lane);
    ok = is_open(g) ? fabs(g->theta - a) < hw
                    : angle_in(wrap_angle(g->theta), wrap_angle(a - hw), wrap_angle(a + hw));
    if (!ok) continue;
    c->got = 1;
    g->coinsGot++;
    g->coinStreak = g->coinStreakT > 0 ? g->coinStreak + 1 : 0;
    g->coinStreakT = 0.6;
    event(g, EV_COIN, &e); e->combo = g->coinStreak; e->lane = c->lane; e->k = c->k;
  }
  if (g->coinStreakT > 0) g->coinStreakT -= 1.0 / 60;
}

/* ------------------------------------------------------------------ oleadas y cajas */
static void begin_fold(Game *g);

static void arcade_increment(Game *g);
static void increment_wave(Game *g) {
  Event *e;
  if (g->waveIdx + 1 >= g->nWaves) return;
  g->waveIdx++;
  g->wave = &g->waves[g->waveIdx];
  g->waveLeft = g->wave->n;
  g->hasColl = 0;
  g->gap = 20;
  g->curves = g->wave->curves;
  if (g->wave->world >= 0) { g->world = g->wave->world; event(g, EV_WORLD, &e); e->world = g->world; }
  if (g->wave->fold) begin_fold(g);
  event(g, EV_WAVE, &e); e->wave = g->waveIdx;
  if (g->arcade) arcade_increment(g);
}

static void spawn_new_boxes(Game *g, int k);

static void update_boxes(Game *g, int k) {
  if (g->wave->n >= 0 && g->waveLeft < 1 && !g->hasColl) increment_wave(g);
  if (g->mode == MODE_CLASSIC || g->mode == MODE_TIMETRIAL) {
    if (!game_inverted(g)) { if (!g->invertedHold) spawn_new_boxes(g, k); }
    else if (!g->invertedHold) {
      g->invertedHold = 1;
      if (g->fold > 0 && g->wave->fold) { g->hasColl = 0; g->waveLeft = 0; increment_wave(g); }
    }
    if (!game_inverted(g)) g->invertedHold = 0;
    return;
  }
  spawn_new_boxes(g, k);
}

static void start_collection(Game *g);
static void spawn_box(Game *g, int k, Collection *c);

static void spiral_step(Collection *c) {
  if (!c->spiral) return;
  c->lane += c->spin;
  if (c->lane > LANES - 1) c->lane = 0;
  else if (c->lane < 0) c->lane = LANES - 1;
}

static void spawn_new_boxes(Game *g, int k) {
  const Wave *w = g->wave; Rng *rng = &g->rng;
  Collection *c;
  if (--g->gap >= 1) return;
  g->gap = 0;
  if (!g->hasColl) {
    int go;
    if (w->interval < 0) go = rng_prob(rng, w->a);
    else if (g->intervalCount < w->interval) { g->intervalCount++; go = 0; }
    else { g->intervalCount = 0; go = 1; }
    if (!go) return;
    if (rng_prob(rng, w->e)) start_collection(g);
    else spawn_box(g, k, NULL);
    return;
  }
  c = &g->coll;
  if (c->left < 1) { g->hasColl = 0; return; }
  if (--c->sepCount < 0) {
    c->sepCount = w->sep;
    c->left--;
    spawn_box(g, k, c);
  }
  if (w->period < 0) {
    int i;
    for (i = w->period; i < 1; i++) spiral_step(c);
  } else if (--c->periodCount < 1) {
    c->periodCount = w->period;
    spiral_step(c);
  }
}

static int pick_location(Game *g) {           /* BoxManager::pickRandomLocation */
  Rng *rng = &g->rng;
  int l = rng_int(rng, 0, 100000) % LANES;
  if (l == g->lastLoc) { l = (int)trunc(l + rng_float(rng, 2, 6)); if (l > LANES - 1) l -= LANES; }
  g->lastLoc = l;
  if (g->arcade && g->campRows >= ARC_CAMP_ROWS) {
    /* llevas un rato en el mismo carril: esta caja va a por ti */
    Event *e;
    int me = game_lane(g);
    g->campRows = 0; g->camps++;
    g->lastLoc = me;
    event(g, EV_CAMP, &e); e->lane = me;
    return me;
  }
  return l;
}

static double pick_height(Game *g) { return rng_prob(&g->rng, g->wave->c) ? R_UNITS : SHORT_H; }
static int pick_color(Game *g) { return rng_int(&g->rng, 0, 1000) % 10; }

static void start_collection(Game *g) {
  const Wave *w = g->wave; Rng *rng = &g->rng;
  Collection c;
  if (!(g->waveLeft > 0 || w->n < 0)) return;
  memset(&c, 0, sizeof c);
  c.count = 0; c.sepCount = w->sep; c.periodCount = w->period;
  c.color = pick_color(g);
  c.lane = pick_location(g);
  c.h = pick_height(g);
  c.fixed = rng_prob(rng, w->b);
  c.rollDir = (int)trunc(rng_float(rng, 0, 2)) == 0 ? 1 : -1;
  c.spin = (int)trunc(rng_float(rng, 0, 2)) == 0 ? 1 : -1;
  if (!c.fixed) c.h = SHORT_H;
  c.spiral = rng_prob(rng, w->d);
  if (c.spiral && !c.fixed && !w->spiralRollers) c.spiral = 0;
  c.left = (int)trunc(rng_float(rng, w->nMin, w->nMax));
  if (c.h == R_UNITS && c.spiral && c.left > 5 && w->sep == 0 && w->period == 1) c.left = 5;
  c.id = g->nextBoxId;
  g->coll = c; g->hasColl = 1;
}

static void spawn_box(Game *g, int k, Collection *c) {
  const Wave *w = g->wave; Rng *rng = &g->rng;
  Box b; Event *e;
  memset(&b, 0, sizeof b);
  if (!c) {
    int lane = pick_location(g);
    double h = pick_height(g);
    int fixed = rng_prob(rng, w->b);
    double dir = rng_prob(rng, w->dir) ? 1 : -1;
    if (!fixed) h = SHORT_H;
    b.lane = lane; b.h = h; b.fixed = fixed; b.dir = dir; b.color = pick_color(g);
    b.group = 0; b.joined = 0;
  } else {
    b.lane = c->lane; b.h = c->h; b.fixed = c->fixed; b.dir = c->rollDir; b.color = c->color;
    b.group = c->id; b.joined = 0;
    if (w->variant > 0 && c->count % w->variant == 0) { b.fixed = 1; b.h = R_UNITS; }
    c->count++;
    if (b.fixed && !c->spiral && c->count > 1) b.joined = 1;
  }
  b.id = g->nextBoxId++;
  b.k = k;
  b.tall = b.h > R_UNITS - 1;
  b.roll = 0;
  b.rollSpeed = 1.5 * b.dir;
  b.grow = g->fold == FOLD_OUT && !g->folding ? 0 : 1;
  b.hit = 0;
  b.bornFrame = g->frame;
  if (g->folding && (g->fold > 25 || g->foldToIn)) { b.h = SHORT_H; b.tall = 0; }
  if (!b.fixed && is_open(g) && ((b.lane == LANES - 1 && b.rollSpeed > 0) || (b.lane == 0 && b.rollSpeed < 0))) b.rollSpeed = -b.rollSpeed;
  b.opp = b.tall && g->fold == FOLD_IN ? imod(b.lane + LANES / 2, LANES) : -1;
  /* push + shift si pasa de 32 */
  if (g->nBoxes == MAX_BOXES) { memmove(&g->boxes[0], &g->boxes[1], sizeof(Box) * (MAX_BOXES - 1)); g->nBoxes--; }
  g->boxes[g->nBoxes++] = b;
  if (w->n >= 0 && (g->fold == FOLD_IN || g->fold == FOLD_OUT)) g->waveLeft--;
  event(g, EV_SPAWN, &e); e->id = b.id;
}

/* ------------------------------------------------------------------ placas */
/* filas del anillo padRow-6 ... padRow+6, y con vuelta también las 5 más antiguas */
static int pad_busy(const Game *g, int l, int k) {
  int i, kl = game_klast(g);
  for (i = 0; i < g->nBoxes; i++) {
    const Box *b = &g->boxes[i];
    if (b->fixed && !b->hit && (b->lane == l || b->opp == l) &&
        ((b->k >= k - 6 && b->k <= k + 6) || (b->k >= kl - 29 && b->k <= kl - 25))) return 1;
  }
  return 0;
}

static void spawn_boosts(Game *g, int rowK) {
  Rng *rng = &g->rng;
  double r; int c, k, lane, closed, lanes[4], nl, ok[4], nok = 0, i;
  if (g->mode == MODE_SURVIVAL) return;
  if ((g->mode == MODE_CLASSIC || g->mode == MODE_TIMETRIAL) && !(g->level < 3 && g->wave->boosts)) return;
  r = rng_float(rng, 0, 90);
  c = g->boostCounter++;
  if (!(119 - c < (int)trunc(r) && c + 1 > 20)) return;
  k = rowK - 6;
  lane = rng_int(rng, 0, 100000) % LANES;
  closed = g->fold > 0;
  if (closed) { lanes[0] = lane; lanes[1] = (lane + 6) % LANES; nl = 2; }
  else { lanes[0] = lane; lanes[1] = (lane + 3) % LANES; lanes[2] = (lane + 6) % LANES; lanes[3] = (lane + 9) % LANES; nl = 4; }
  if (closed) {
    for (i = 0; i < nl; i++) if (pad_busy(g, lanes[i], k)) return;
    for (i = 0; i < nl; i++) ok[nok++] = lanes[i];
    g->boostCounter = -(int)trunc(rng_float(rng, 0, 10));
  } else {
    for (i = 0; i < nl; i++) if (!pad_busy(g, lanes[i], k)) ok[nok++] = lanes[i];
    g->boostCounter = (int)trunc(rng_float(rng, 0, 10));
  }
  for (i = 0; i < nok; i++) {
    Pad *p;
    if (g->nPads >= MAX_PADS) overflow("pads");
    p = &g->pads[g->nPads++];
    p->k = k; p->lane = ok[i]; p->taken = 0; p->got = 0;
  }
}

/* ------------------------------------------------------------------ plegado */
static void begin_fold(Game *g) {
  if (g->folding) return;
  g->folding = 1;
  g->foldToIn = g->fold <= 25;
  g->foldRows = 0;
  g->foldStarted = 0;
  event(g, EV_FOLD_ORDER, NULL);
}

static void update_fold(Game *g) {             /* Tunnel::updateFold */
  double rate, target, dir; Event *e;
  if (!g->folding || !g->alive) return;
  if (g->foldRows < 32) return;
  if (!g->foldStarted) { g->foldStarted = 1; event(g, EV_FOLD_START, &e); e->toIn = g->foldToIn; }
  rate = fabs(g->fold) / 150 + 0.05; if (rate > 0.1) rate = 0.1;   /* Math.min(x, 0.1) */
  target = g->foldToIn ? FOLD_IN : FOLD_OUT;
  dir = js_sign(target - g->fold);
  /* primero se encoge hacia 0; al quedar por debajo del paso cambia de signo y luego crece */
  if (g->fold * target <= 0 && fabs(g->fold) < rate) g->fold = -g->fold;
  else g->fold += dir * rate;
  if ((dir > 0 && g->fold >= target) || (dir < 0 && g->fold <= target)) {
    g->fold = target;
    g->folding = 0;
    if (g->foldToIn && (g->mode == MODE_CLASSIC || g->mode == MODE_TIMETRIAL)) {
      g->world = g->world + 1 < 6 ? g->world + 1 : 6;
      g->worldRows = 24;
    }
    if (game_inverted(g)) {
      Gap *gp;
      if (g->nGaps >= MAX_GAPS) overflow("gaps");
      gp = &g->gaps[g->nGaps++];
      gp->from = game_klast(g) + 4; gp->to = game_klast(g) + 19;
    }
    event(g, EV_FOLD_END, &e); e->toIn = g->foldToIn; e->world = g->world;
  }
}

/* ------------------------------------------------------------------ jugador */
static void steer(Game *g, double a) {         /* Player::updateRotation */
  g->omega = fabs(a) < STEER_DEAD ? 0 : a * STEER_GAIN;
  g->theta += g->omega;
  if (!is_open(g)) g->theta = wrap_angle(g->theta);
  else {
    if (g->theta > 5.9) g->theta = 5.9;
    if (g->theta < -0.1) g->theta = -0.1;
  }
}

int game_on_strip(const Game *g, int lane) {
  double hw = strip_half_width(g->fold);
  double lo = lane_angle(lane) - hw, hi = lane_angle(lane) + hw;
  if (is_open(g)) return g->theta > lo && g->theta < hi;
  lo = wrap_angle(lo); hi = wrap_angle(hi);
  return angle_in(wrap_angle(g->theta), lo, hi);
}

int game_lane(const Game *g) { return imod((int)js_round(g->theta / (CELL_DEG * DEG)), LANES); }

static void init_boost(Game *g) {
  double t; Event *e;
  g->level = g->level + 1 < 3 ? g->level + 1 : 3;
  t = g->vTarget + (BOOST_TOWARD - g->vTarget) * BOOST_K;
  if (t >= V_MAX || g->level == 3) t = V_MAX;
  g->vTarget = t;
  g->v = t;
  g->boostOn = 1;
  if (g->mode == MODE_TIMETRIAL) g->timeLeft += g->level * 3.5;
  event(g, EV_BOOST, &e); e->level = g->level;
}

static void disable_boost(Game *g) {
  if (g->boostTime > g->maxBoostTime) g->maxBoostTime = g->boostTime;
  g->boostTime = 0;
  g->vTarget = V_START;
  g->boostOn = 0;
  g->level = 0;
}

static void die(Game *g, const Box *box) {
  Event *e;
  g->alive = 0;
  g->killer = box ? box->id : 0;
  if (g->boostTime > g->maxBoostTime) g->maxBoostTime = g->boostTime;
  event(g, EV_DEATH, &e); e->id = box ? box->id : 0;
}

static void crash(Game *g, Box *box) {         /* Box::collide + GameManager::collide */
  int fatal; Event *e;
  if (g->invul > 0 || box->hit || !g->alive) return;
  box->hit = 1;
  g->v = 1.0;
  fatal = !g->boostOn || g->mode == MODE_SURVIVAL;
  event(g, EV_CRASH, &e); e->id = box->id; e->lane = box->lane; e->k = box->k; e->fatal = fatal;
  if (fatal) { if (!g->god) die(g, box); return; }
  g->invul = INVUL_S;
  disable_boost(g);
  if (g->mode == MODE_TIMETRIAL) { int p = -5 - g->crashes; g->timeLeft += p > -15 ? p : -15; }
  g->crashes++;
}

/* ------------------------------------------------------------------ paso de 1 fotograma */
static void advance(Game *g) {                 /* Player::updatePosition */
  int before = (int)floor(g->s), after, r;
  g->s += g->v / R_UNITS;
  after = (int)floor(g->s);
  for (r = before; r < after; r++) {
    push_row(g, 0);
    if (g->alive) g->rowsPassed++;
  }
}

static void update_speed(Game *g) {            /* Player::updateSpeed */
  double d;
  if (g->mode == MODE_SURVIVAL) {
    g->v += 0.0005; g->vTarget = g->v;
    if (g->v > V_MAX) g->v = V_MAX;
    return;
  }
  d = g->vTarget - g->v;
  if (fabs(d) > V_EPS) g->v += d * (g->v < g->vTarget ? V_UP : V_DOWN);
}

static void check_boost(Game *g) {             /* Player::checkForBoost */
  int cur = (int)floor(g->s), i, j;
  double f = g->s - cur;
  for (i = 0; i < g->nPads; i++) {
    Pad *p = &g->pads[i];
    double a, hw = 0.314159, lo, hi;
    Row *r0, *r1;
    if (p->taken) continue;
    if (!((p->k == cur + 1 && f > 0.5) || p->k == cur)) continue;
    a = lane_angle(p->lane);
    lo = wrap_angle(a - hw); hi = wrap_angle(a + hw);
    if (!angle_in(wrap_angle(g->theta), lo, hi)) continue;
    /* ni la fila actual ni la siguiente pueden estar ya usadas; se marcan las dos */
    r0 = (Row *)game_row_at(g, cur); r1 = (Row *)game_row_at(g, cur + 1);
    if ((r0 && r0->taken) || (r1 && r1->taken)) continue;
    if (r0) r0->taken = 1;
    if (r1) r1->taken = 1;
    for (j = 0; j < g->nPads; j++) if (g->pads[j].k == p->k) g->pads[j].taken = 1;
    p->got = 1;
    init_boost(g);
  }
}

static void update_box_motion(Game *g) {
  double edge = 90 - g->fold;
  int i;
  for (i = 0; i < g->nBoxes; i++) {
    Box *b = &g->boxes[i];
    if (b->grow < 1) { b->grow = b->grow + 0.027; if (b->grow > 1) b->grow = 1; }
    if (b->fixed || b->hit) continue;
    /* Box::update: o gira o llega, no las dos cosas en el mismo fotograma (41 por carril) */
    if (fabs(b->roll) < edge) { b->roll += b->rollSpeed; continue; }
    {
      int next;
      b->roll = 0;
      next = b->lane + (int)js_sign(b->rollSpeed);
      b->lane = imod(next, LANES);
      if (is_open(g) && ((b->lane == LANES - 1 && b->rollSpeed > 0) || (b->lane == 0 && b->rollSpeed < 0))) b->rollSpeed = -b->rollSpeed;
    }
  }
}

double game_box_angle(const Game *g, const Box *b) {
  double edge;
  if (b->fixed) return lane_angle(b->lane);
  edge = 90 - g->fold;
  return lane_angle(b->lane) + (b->roll / edge) * CELL_DEG * DEG;
}

static int inside(const Game *g, double c, double hw, int open) {
  double lo = c - hw, hi = c + hw, th = g->theta;
  if (open) return th > lo && th < hi;
  return angle_in(wrap_angle(th), wrap_angle(lo), wrap_angle(hi));
}

static void check_collisions(Game *g) {        /* Box::collisionCheck */
  int cur = (int)floor(g->s), i;
  double f = g->s - cur;
  double hw = strip_half_width(g->fold);
  int open = is_open(g);
  for (i = 0; i < g->nBoxes; i++) {
    Box *b = &g->boxes[i];
    double a;
    if (b->hit) continue;
    a = game_box_angle(g, b);
    if (b->tall) {
      if (b->k != cur + 1) continue;
      if (inside(g, a, hw, open) || (g->fold > 27 && inside(g, a + PI, hw, open))) crash(g, b);
    } else {
      if (!((b->k == cur + 1 && f > 0.5) || b->k == cur)) continue;
      if (inside(g, a, hw, open)) crash(g, b);
    }
  }
}

static void prune(Game *g) {
  int k0 = (int)floor(g->s) - 2, i, n;
  if (g->nBoxes && g->boxes[0].k < k0) {
    for (i = n = 0; i < g->nBoxes; i++) if (g->boxes[i].k >= k0) g->boxes[n++] = g->boxes[i];
    g->nBoxes = n;
  }
  if (g->nPads && g->pads[0].k < k0) {
    for (i = n = 0; i < g->nPads; i++) if (g->pads[i].k >= k0) g->pads[n++] = g->pads[i];
    g->nPads = n;
  }
  if (g->nCoins && g->coins[0].k < k0) {
    for (i = n = 0; i < g->nCoins; i++) if (g->coins[i].k >= k0) g->coins[n++] = g->coins[i];
    g->nCoins = n;
  }
  if (g->nGaps && g->gaps[0].to < k0 - 4) {
    memmove(&g->gaps[0], &g->gaps[1], sizeof(Gap) * (g->nGaps - 1));
    g->nGaps--;
  }
}

static int game_step_core(Game *g, double steer_in);
int game_step(Game *g, double steer_in) {
  double before = g->s;
  int n = game_step_core(g, steer_in);
  if (g->arcade && g->alive) {
    int lane = game_lane(g);
    if (lane == g->campLane) g->campRows += g->s - before;
    else { g->campLane = lane; g->campRows = 0; }
  }
  return n;
}

static int game_step_core(Game *g, double steer_in) {
  const double dtS = 1.0 / 60;
  g->nEvents = 0;
  g->frame++;
  if (steer_in != steer_in) steer_in = 0;      /* input.steer || 0 */
  if (!g->alive) { g->v += (0 - g->v) * 0.022; advance(g); update_fold(g); return g->nEvents; }
  g->time += dtS;

  if (g->invul > 0) g->invul -= dtS;
  if (g->mode == MODE_TIMETRIAL) {
    g->timeLeft += g->level >= 3 ? dtS : -dtS;
    if (g->timeLeft <= 0) { g->timeLeft = 0; die(g, NULL); return g->nEvents; }
  }
  if (g->level == 3) { g->boostTime += dtS; g->boostTotal += dtS; }

  /* orden de Game::update: plegado, cajas de la fila nueva, movimiento y choques, jugador */
  update_fold(g);
  if (g->pendingRow) { int k = game_klast(g); g->pendingRow = 0; update_boxes(g, k); spawn_coins(g, k); }
  update_box_motion(g);
  check_collisions(g);
  if (!g->alive) return g->nEvents;
  advance(g);
  steer(g, steer_in);
  check_boost(g);
  update_speed(g);
  check_coins(g);
  prune(g);
  return g->nEvents;
}

/* ------------------------------------------------------------------ consultas para dibujar */
double game_jump_at(const Game *g, double s) {
  int i;
  for (i = 0; i < g->nGaps; i++) {
    double a = g->gaps[i].from - 3, b = g->gaps[i].to + 1;
    if (s > a && s < b) { double t = (s - a) / (b - a); return 4 * 5.5 * t * (1 - t); }
  }
  return 0;
}

int game_in_gap(const Game *g, int k) {
  int i;
  for (i = 0; i < g->nGaps; i++) if (k >= g->gaps[i].from && k <= g->gaps[i].to) return 1;
  return 0;
}

double game_distance_m(const Game *g) { return g->rowsPassed * ROW_M; }
double game_speed_ms(const Game *g) { return g->v * 60 * M_PER_UNIT; }

const char *event_name(EventType t) {
  static const char *n[] = { "world", "wave", "spawn", "coin", "foldOrder", "foldStart", "foldEnd",
                             "boost", "crash", "death", "camp" };
  return n[t];
}

/* ------------------------------------------------------------------ Arcade (arcade.js) */
static void arcade_increment(Game *g) {
  Wave *w = &g->waves[g->waveIdx];
  double t;
  if (g->gap > ARC_GAP_ROWS) g->gap = ARC_GAP_ROWS;
  /* cuanto más dura la partida, más cajas por fila (hasta el doble a los 4 min) */
  t = g->time / 240; if (t > 1) t = 1;
  if (w->interval < 0) { double a = g->waveA0[g->waveIdx] * (1 + t); w->a = a < 1 ? a : 1; }
}

void game_init_arcade(Game *g, uint32_t seed) {
  int i;
  game_init(g, MODE_CLASSIC, seed);
  g->arcade = 1;
  for (i = 0; i < g->nWaves; i++) {
    Wave *w = &g->waves[i];
    g->waveA0[i] = w->a;
    if (w->n > 0 && w->n < 1000) { int n = (int)js_round(w->n * ARC_COMPRESS); w->n = n > 6 ? n : 6; }
  }
  g->waveLeft = g->wave->n;
  g->campRows = 0; g->campLane = -1; g->camps = 0;
  init_boost(g);
}

GameMode mode_from_name(const char *name) {
  if (!strcmp(name, "classic")) return MODE_CLASSIC;
  if (!strcmp(name, "timetrial")) return MODE_TIMETRIAL;
  if (!strcmp(name, "survival")) return MODE_SURVIVAL;
  return (GameMode)-1;
}
