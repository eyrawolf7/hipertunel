/* Simulación de Hipertúnel: port exacto a C99 de app/src/sim/game.js.
 *
 * Mismo estado, mismas funciones, mismo orden de tiradas del rng y mismas constantes. Todos los
 * números que en JS son Number van en double; los que en JS solo toman valores enteros (índices,
 * contadores, carriles, filas) van en int, que da los mismos resultados.
 *
 * Compilar SIEMPRE con -ffp-contract=off (o el pragma de game.c): si el compilador fusiona
 * a + b*c en una sola instrucción FMA, el redondeo cambia y la partida deja de ser idéntica a JS.
 */
#ifndef HT_GAME_H
#define HT_GAME_H

#include "rng.h"
#include "waves.h"

#define LANES       12
#define CELL_DEG    30.0
#define R_UNITS     13.176254
#define ROWS        30
#define M_PER_UNIT  (4 / R_UNITS)
#define ROW_M       4
#define SHORT_H     6.5881267
#define FOLD_IN     30.0
#define FOLD_OUT    (-30.0)
#define V_START     2.0
#define V_MAX       5.5
#define STEER_GAIN  0.2
#define STEER_DEAD  0.019

/* Capacidades fijas. JS limita las cajas a 32 (shift) y las filas a 30; el resto se poda cada
   fotograma y nunca pasa de unas decenas. Si alguna se desborda, game.c aborta con un mensaje. */
#define MAX_BOXES   32
#define MAX_PADS    128
#define MAX_COINS   256
#define MAX_GAPS    32
#define MAX_EVENTS  64

typedef enum {
  EV_WORLD, EV_WAVE, EV_SPAWN, EV_COIN, EV_FOLD_ORDER, EV_FOLD_START, EV_FOLD_END,
  EV_BOOST, EV_CRASH, EV_DEATH,
  EV_CAMP,                      /* Arcade: una caja va a por ti por quedarte en un carril */
  EV_TRICK, EV_TRICK_DONE, EV_TRICK_FAIL,  /* Arcade: piruetas en el salto entre mundos */
  EV_WALL, EV_SMASH,                       /* Arcade: muro de cartón y cartón roto */
  EV_WALL_SOON                             /* Arcade: el muro viene (5 filas vacías antes) */
} EventType;

typedef struct {
  EventType type;
  int frame;
  int id, lane, k, level, world, wave, combo;
  int toIn, fatal;
  int n, perfect, lost;         /* piruetas: número en el salto, si ha sido perfecta, monedas perdidas */
} Event;

typedef struct { int k; double yaw, pitch; int taken; } Row;

typedef struct {
  double yawT, pitchT, dYaw, dPitch, thr;
  int need, yawOn, pitchOn;
} Turn;

typedef struct {
  int id, k, lane, fixed, tall, joined, group, color, hit, bornFrame, opp;
  int wall, carton;             /* Arcade: fila de piedra con un bloque de cartón */
  double h, dir, roll, rollSpeed, grow;
} Box;

typedef struct { int k, lane, taken, got; } Pad;
typedef struct { int k, lane, got; } Coin;
typedef struct { int from, to; } Gap;

typedef struct {
  int count, sepCount, periodCount, color, lane, fixed, rollDir, spin, spiral, left, id;
  double h;
} Collection;

typedef struct { int lane, left, curve, step; } CoinRun;

typedef struct {
  GameMode mode;
  uint32_t seed;
  Rng rng, coinRng;
  int frame;
  double time;
  Event events[MAX_EVENTS]; int nEvents;

  /* túnel */
  double fold;
  int folding, foldToIn, foldRows, foldStarted;
  int world, worldRows, curves;
  Turn turn;
  Row rows[ROWS]; int nRows;   /* rows[0] es la más antigua, como el array de JS */
  int kFirst;
  int pendingRow;                  /* fila nueva a la espera de cajas y monedas */

  /* jugador */
  double s, theta, omega, v, vTarget;
  int level, boostOn;
  double invul;
  int alive, crashes, rowsPassed;
  double maxBoostTime, boostTime, timeLeft;
  double boostTotal;               /* tiempo total a tope (Player+0x128) */
  int lastCollideRow, killer;

  /* cajas y placas */
  Box boxes[MAX_BOXES]; int nBoxes;
  int nextBoxId;
  Wave waves[MAX_WAVES]; int nWaves;
  int waveIdx;
  const Wave *wave;
  int waveLeft, gap;
  Collection coll; int hasColl;
  int intervalCount, lastLoc, invertedHold, boostCounter;
  Pad pads[MAX_PADS]; int nPads;

  /* monedas */
  Coin coins[MAX_COINS]; int nCoins;
  CoinRun coinRun; int hasCoinRun;
  int coinsGot;
  Gap gaps[MAX_GAPS]; int nGaps;
  int coinStreak; double coinStreakT;

  /* solo para pruebas: choque sin consecuencias (marca la caja y avisa, no frena ni mata) */
  int god;

  /* modo Arcade (app/src/sim/arcade.js): capa encima del clásico */
  int arcade;
  double waveA0[MAX_WAVES];
  double campRows; int campLane, camps;
  double trickT; int tricks, tricksTotal, trickCoins, easyWalls;
  int wallWorld, wallLead, wallAfter, walls, smashes, seenWorld; double worldT;
  /* superficies (arcade.js): una por fila en un anillo de 128 (0 piedra, 1 cristal, 2 musgo, 3 lava, 4 hielo) */
  unsigned char surf[128]; double padT; int surfNow; int themeN;
} Game;

/* superficie pintada en la fila k (se nota ARC_SURF_LAG filas después) */
int    game_surface_at(const Game *g, int k);

void   game_init(Game *g, GameMode mode, uint32_t seed);
void   game_reset(Game *g);
/* Arcade: reglas del clásico con el guion comprimido, un impulso de salida y sin acampar */
void   game_init_arcade(Game *g, uint32_t seed);
/* los primeros `n` muros ponen el cartón a 2 carriles o menos (primeras partidas del jugador) */
void   game_init_arcade_easy(Game *g, uint32_t seed, int easyWalls);
/* Avanza un fotograma de 60 Hz. Los sucesos quedan en g->events[0..g->nEvents). */
int    game_step(Game *g, double steer);
/* igual, con el botón de pirueta (X en Switch); solo cuenta en el Arcade y durante el salto */
int    game_step_in(Game *g, double steer, int trick);
/* Arcade: segundos que faltan para aterrizar del salto entre mundos (INFINITY si no vuelas) */
double game_land_in(const Game *g);

double lane_angle(int l);
double strip_half_width(double fold);
int    game_inverted(const Game *g);
int    game_klast(const Game *g);
const Row *game_row_at(const Game *g, int k);
int    game_lane(const Game *g);
int    game_on_strip(const Game *g, int lane);
double game_box_angle(const Game *g, const Box *b);
double game_jump_at(const Game *g, double s);
int    game_in_gap(const Game *g, int k);
double game_distance_m(const Game *g);
double game_speed_ms(const Game *g);
const char *event_name(EventType t);
GameMode mode_from_name(const char *name);  /* -1 si no existe */

#endif
