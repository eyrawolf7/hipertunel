/* Traza de una partida con la simulación en C, conducida por el bot en C.
 * Uso: trace <classic|survival|timetrial> <semilla> <fotogramas> [god]
 * Debe dar exactamente la misma salida que trace.mjs (la versión JS). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "../sim/game.h"
#include "../sim/bot.h"

static uint32_t H;
static void hu(uint32_t x) { H ^= x; H *= 16777619u; }
static void hi(int x) { hu((uint32_t)x); }
static void hd(double x) { uint64_t u; memcpy(&u, &x, 8); hu((uint32_t)u); hu((uint32_t)(u >> 32)); }

static uint32_t hash_objects(const Game *g) {
  int i;
  H = 2166136261u;
  hi(g->nBoxes);
  for (i = 0; i < g->nBoxes; i++) {
    const Box *b = &g->boxes[i];
    hi(b->id); hi(b->k); hi(b->lane); hi(b->fixed); hi(b->tall); hi(b->hit); hi(b->opp);
    hi(b->color); hi(b->group); hi(b->joined); hi(b->wall); hi(b->carton);
  }
  hi(g->nPads);
  for (i = 0; i < g->nPads; i++) { hi(g->pads[i].k); hi(g->pads[i].lane); hi(g->pads[i].taken); }
  hi(g->nCoins);
  for (i = 0; i < g->nCoins; i++) { hi(g->coins[i].k); hi(g->coins[i].lane); hi(g->coins[i].got); }
  hi(g->nGaps);
  for (i = 0; i < g->nGaps; i++) { hi(g->gaps[i].from); hi(g->gaps[i].to); }
  return H;
}

/* huella de los bits exactos de todos los doubles del estado */
static uint32_t hash_bits(const Game *g) {
  int i;
  H = 2166136261u;
  hd(g->s); hd(g->theta); hd(g->omega); hd(g->v); hd(g->vTarget); hd(g->fold);
  hd(g->timeLeft); hd(g->time); hd(g->invul); hd(g->boostTime); hd(g->maxBoostTime); hd(g->coinStreakT);
  hd(g->boostTotal); hi(g->pendingRow);
  if (g->arcade) { hd(g->trickT); hi(g->tricks); }
  hd(g->turn.yawT); hd(g->turn.pitchT); hd(g->turn.dYaw); hd(g->turn.dPitch); hd(g->turn.thr);
  for (i = 0; i < g->nRows; i++) { hi(g->rows[i].k); hd(g->rows[i].yaw); hd(g->rows[i].pitch); hi(g->rows[i].taken); }
  for (i = 0; i < g->nBoxes; i++) { const Box *b = &g->boxes[i]; hd(b->h); hd(b->roll); hd(b->rollSpeed); hd(b->grow); }
  return H;
}

int main(int argc, char **argv) {
  static Game g;
  GameMode mode; uint32_t seed; int frames, god, deadAt = -1, i;
  if (argc < 4) { fprintf(stderr, "uso: trace <modo> <semilla> <fotogramas> [god]\n"); return 2; }
  mode = !strcmp(argv[1], "arcade") ? MODE_CLASSIC : mode_from_name(argv[1]);
  if ((int)mode < 0) { fprintf(stderr, "modo desconocido: %s\n", argv[1]); return 2; }
  seed = (uint32_t)strtoul(argv[2], NULL, 10);
  frames = atoi(argv[3]);
  god = argc > 4 && !strcmp(argv[4], "god");

  if (!strcmp(argv[1], "arcade")) game_init_arcade(&g, seed); else game_init(&g, mode, seed);
  g.god = god;
  printf("start mode=%s seed=%u waves=%d rng=%u crng=%u lastLoc=%d\n", argv[1], seed, g.nWaves, g.rng.a, g.coinRng.a, g.lastLoc);
  while (g.frame < frames) {
    double st;
    if (god && g.mode == MODE_TIMETRIAL && g.timeLeft < 10) g.timeLeft += 60;
    st = bot_steer(&g, 14);
    /* Arcade: se pulsa la pirueta cada 11 fotogramas (solo cuenta en el salto entre mundos) */
    game_step_in(&g, st, g.arcade && g.frame % 11 == 0);
    if (g.frame % 60 == 0 || g.nEvents > 0) {
      printf("f=%d s=%.9g th=%.9g v=%.9g vt=%.9g lv=%d wi=%d wl=%d fold=%.9g w=%d al=%d nb=%d np=%d nc=%d cg=%d tl=%.9g st=%.9g h=%08x b=%08x rng=%u crng=%u\n",
             g.frame, g.s, g.theta, g.v, g.vTarget, g.level, g.waveIdx, g.waveLeft, g.fold, g.world, g.alive,
             g.nBoxes, g.nPads, g.nCoins, g.coinsGot, g.timeLeft, st, hash_objects(&g), hash_bits(&g), g.rng.a, g.coinRng.a);
      for (i = 0; i < g.nEvents; i++) {
        const Event *e = &g.events[i];
        printf("  ev %s", event_name(e->type));
        switch (e->type) {
          case EV_WORLD: printf(" world=%d", e->world); break;
          case EV_WAVE: printf(" wave=%d", e->wave); break;
          case EV_SPAWN: printf(" id=%d", e->id); break;
          case EV_COIN: printf(" combo=%d lane=%d k=%d", e->combo, e->lane, e->k); break;
          case EV_FOLD_START: printf(" toIn=%d", e->toIn); break;
          case EV_FOLD_END: printf(" toIn=%d world=%d", e->toIn, e->world); break;
          case EV_BOOST: printf(" level=%d", e->level); break;
          case EV_CRASH: printf(" id=%d lane=%d k=%d fatal=%d", e->id, e->lane, e->k, e->fatal); break;
          case EV_DEATH: printf(" id=%d", e->id); break;
          case EV_CAMP: printf(" lane=%d", e->lane); break;
          case EV_TRICK: printf(" n=%d", e->n); break;
          case EV_WALL: printf(" k=%d lane=%d", e->k, e->lane); break;
          case EV_SMASH: printf(" id=%d lane=%d k=%d", e->id, e->lane, e->k); break;
          case EV_TRICK_DONE: printf(" n=%d perfect=%d", e->n, e->perfect); break;
          default: break;
        }
        printf(" frame=%d\n", e->frame);
      }
    }
    if (!g.alive && deadAt < 0) deadAt = g.frame;
    if (deadAt >= 0 && g.frame >= deadAt + 120) break;
  }
  printf("end frame=%d alive=%d dist=%.9g coins=%d crashes=%d waveIdx=%d\n", g.frame, g.alive, game_distance_m(&g), g.coinsGot, g.crashes, g.waveIdx);
  return 0;
}
