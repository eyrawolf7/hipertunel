/* Guiones de oleadas de cada modo: port exacto de app/src/sim/waves.js. */
#ifndef HT_WAVES_H
#define HT_WAVES_H

#include "rng.h"

typedef enum { MODE_CLASSIC = 0, MODE_TIMETRIAL = 1, MODE_SURVIVAL = 2 } GameMode;

typedef struct {
  int n;                  /* cajas de la oleada (-1 = infinita) */
  double a, b, c, d, e;   /* ver waves.js */
  int interval, nMin, nMax, sep, period, variant;
  double dir;
  int fold, boosts, curves, spiralRollers;
  int world;              /* -1 = sin definir (undefined en JS) */
} Wave;

#define MAX_WAVES 64

/* Rellena W y devuelve cuántas oleadas hay (o -1 si el modo no existe).
   Las tiradas del rng van en el mismo orden que en JS (argumentos de izquierda a derecha). */
int build_waves(GameMode mode, Rng *rng, Wave *W);

#endif
