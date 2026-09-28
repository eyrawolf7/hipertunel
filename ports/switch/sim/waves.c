#include "waves.h"
#include <math.h>
#include <stddef.h>

/* En C el orden de evaluación de los argumentos no está definido, así que cada tirada del rng va
   en su propia sentencia, en el mismo orden en que JS las evalúa (de izquierda a derecha). */

static Wave *W_;
static int   N_;
static Rng  *R_;

static double r(double x, double y) { return rng_float(R_, x, y); }
static int    ri(double x, double y) { return (int)trunc(rng_float(R_, x, y)); }

static Wave *w(int n, double a, double b, double c, double pCol, double pSpi) {
  Wave *o = &W_[N_++];
  o->n = n; o->a = a; o->b = b; o->c = c; o->d = pSpi; o->e = pCol;
  o->interval = -1; o->nMin = 3; o->nMax = 8; o->sep = 0; o->period = 1; o->variant = -1;
  o->dir = 1; o->fold = 0; o->boosts = 1; o->curves = 1; o->spiralRollers = 1;
  o->world = -1;
  return o;
}

static Wave *col(Wave *o, int lo, int hi) { o->nMin = lo; o->nMax = hi; return o; }

int build_waves(GameMode mode, Rng *rng, Wave *W) {
  Wave *o; int n; double x, y;
  W_ = W; N_ = 0; R_ = rng;

  if (mode == MODE_CLASSIC) {
    w(15, 0.1, 1, 0, 0, 0);
    x = r(0.4, 0.6); w(15, 0.1, 1, x, 0, 0);
    n = ri(15, 30); x = r(0, 0.2); w(n, 0.2, 1, 1, x, 0)->fold = 1;
    col(w(50, 0.35, 1, 0.75, 0.2, 0), 2, 3);
    w(50, 0.35, 1, 0.25, 0, 0);
    col(w(50, 0.3, 1, 1, 1, 1), 1, 3);
    x = r(0.75, 1); o = col(w(1000, 0.25, 1, x, 1, 0.45), 3, 6); o->fold = 1;
    w(15, 0.2, 0, 0, 0, 0)->dir = 0.5;
    w(15, 0.2, 0, 0, 0.5, 0)->dir = 0.5;
    n = ri(15, 30); w(n, 0.3, 0, 0, 1, 0)->dir = 0.5;
    n = ri(15, 30); o = col(w(n, 0.25, 0, 0, 1, 0.5), 3, 5); o->dir = 0.5;
    n = ri(45, 90); o = w(n, 0.3, 0.5, 0.5, 0.15, 0); o->interval = 2; o->dir = 0.5;
    n = ri(15, 30); o = col(w(n, 0.25, 0, 0, 1, 1), 2, 5); o->dir = 0.5;
    n = ri(45, 90); w(n, 0.2, 0.5, 1, 0, 0)->dir = 0.5;
    n = ri(45, 90); o = col(w(n, 0.2, 1, 0.25, 1, 1), 3, 3); o->interval = 4; o->dir = 0.5;
    n = ri(45, 90); w(n, 0.2, 0.5, 0.5, 0.5, 0.5)->dir = 0.5;
    n = ri(30, 60); o = col(w(n, 0.45, 0.75, 0.5, 0.75, 0.5), 3, 5); o->dir = 0.5; o->fold = 1;
    n = ri(15, 30); x = r(0.25, 0.5); w(n, 0.3, 1, 0, 1, x)->dir = 0.5;
    n = ri(30, 60); w(n, 0.3, 1, 0, 0, 0);
    n = ri(30, 60); col(w(n, 0.3, 1, 1, 1, 1), 1, 3);
    n = ri(30, 60); col(w(n, 0.3, 0.5, 0.5, 0.5, 0.5), 1, 3);
    w(1000, 0.3, 1, 0.5, 0.5, 0.25)->fold = 1;
    n = ri(45, 90); w(n, 1, 0, 0, 0.8, 0);
    n = ri(15, 30); o = col(w(n, 1, 0, 0, 1, 0), 3, 3); o->dir = 0.5;
    n = ri(15, 30); o = col(w(n, 1, 0, 0, 1, 1), 3, 12); o->dir = 0.5;
    n = ri(15, 30); w(n, 0.8, 0, 0, 1, 0.5)->dir = 0.5;
    n = ri(30, 60); w(n, 0.4, 0.5, 0.3, 0.5, 0.5)->dir = 0.5;
    n = ri(30, 60); w(n, 0.4, 0.5, 0.3, 0.5, 0.5)->dir = 0.5;
    n = ri(30, 60); w(n, 0.9, 0.5, 0.3, 0.5, 1)->dir = 0.5;
    n = ri(30, 60); w(n, 0.4, 0.5, 0.5, 0.5, 1)->dir = 0.5;
    n = ri(15, 30); o = col(w(n, 0.27, 0.5, 0.5, 0.25, 1), 8, 8); o->dir = 0.5;
    n = ri(45, 90); w(n, 0.27, 0, 0, 0, 0)->interval = 3;
    n = ri(45, 90); o = w(n, 0.6, 0.5, 0.5, 0, 0); o->dir = 0.5; o->fold = 1;
    n = ri(45, 90); col(w(n, 1, 0.33, 0.5, 1, 1), 3, 4);
    n = ri(45, 90); w(n, 0.8, 0.5, 0.5, 0, 0)->dir = 0.5;
    n = ri(45, 90); w(n, 1, 0.5, 0.5, 0, 0)->dir = 0.5;
    n = ri(45, 90); w(n, 0.75, 1, 0.5, 0, 0);
    n = ri(45, 90); w(n, 0.85, 1, 0.5, 0, 0);
    n = ri(45, 90); w(n, 0.85, 0.5, 1, 0, 0)->dir = 0.5;
    o = w(1000, 0.85, 0.5, 1, 0, 0); o->dir = 0.5; o->fold = 1;
    n = ri(75, 150); w(n, 0.65, 1, 0, 0, 0)->dir = 0.5;
    n = ri(75, 150); w(n, 0.35, 1, 1, 0, 0)->dir = 0.5;
    o = col(w(-1, 0.65, 0.5, 1, 0.2, 0.75), 3, 12); o->dir = 0.5;
  } else if (mode == MODE_TIMETRIAL) {
    int i;
    w(15, 0.2, 1, 0, 0, 0);
    w(25, 0.085, 1, 1, 0, 0);
    n = ri(30, 60); o = col(w(n, 0.15, 1, 0, 1, 1), 3, 3); o->interval = 2;
    n = ri(20, 30); w(n, 0.1, 1, 0, 1, 1);
    n = ri(30, 50); x = r(0, 1); o = col(w(n, 0.3, 1, x, 1, 1), 3, 3); o->fold = 1; o->interval = 3;
    n = ri(40, 50); w(n, 0.15, 1, 0.25, 0, 0)->interval = 2;
    o = col(w(1000, 0.4, 1, 0, 1, 0.5), 3, 3); o->fold = 1;
    n = ri(25, 75); o = col(w(n, 0.5, 0, 0, 1, 0), 4, 4); o->interval = 1; o->curves = 0;
    n = ri(35, 60); o = w(n, 0.4, 0, 0, 0, 0); o->interval = 2; o->curves = 0;
    n = ri(35, 60); w(n, 0.4, 0.25, 0, 0.25, 0)->dir = 0.5;
    n = ri(35, 60); o = col(w(n, 0.25, 0.5, 0, 0.5, 0.33), 3, 6); o->dir = 0.5;
    n = ri(35, 60); w(n, 0.33, 0.5, 0, 1, 0.2)->dir = 0.5;
    n = ri(40, 50); col(w(n, 0.07, 1, 1, 1, 0.8), 2, 5);
    n = ri(40, 50); o = col(w(n, 1, 1, 0, 1, 1), 7, 10); o->period = 2;
    w(125, 0.5, 1, 0.1, 0.15, 0)->interval = 1;
    o = col(w(100, 1, 1, 0, 1, 1), 7, 7); o->period = 2; o->fold = 1;
    n = ri(100, 200); o = w(n, 0.4, 0.5, 0, 0.1, 0); o->interval = 0; o->boosts = 0;
    n = ri(50, 130); o = col(w(n, 0.3, 0.5, 0.5, 1, 0.5), 3, 3); o->interval = 3;
    o = col(w(1000, 0.25, 1, 1, 0.75, 1), 10, 10); o->interval = 20; o->sep = 1; o->fold = 1;
    n = ri(100, 200); w(n, 0.4, 0.5, 0, 0.1, 0)->interval = 1;
    n = ri(100, 125); o = col(w(n, 0.25, 1, 0.5, 0.5, 0.5), 1, 4); o->interval = 2;
    o = col(w(10, 0.2, 1, 0, 1, 1), 40, 40); o->interval = 15; o->period = -3; o->sep = 0;
    o = w(150, 0.3, 0.5, 0.5, 0.15, 0); o->interval = 1; o->dir = 0.5;
    /* el original sube la densidad de estas siete oleadas: 0,2 + i·0,033 */
    for (i = 0; i < 7; i++) {
      n = ri(25, 75); x = r(0.1, 0.9); y = r(0.1, 0.9);
      o = col(w(n, 0.2 + i * 0.033, x, 0, y, 1), 5, 10); o->spiralRollers = 0; o->dir = 0.5;
    }
    n = ri(50, 100); o = col(w(n, 0.4, 1, 0, 1, 1), 4, 4); o->interval = 5; o->dir = 0.5; o->fold = 1;
    n = ri(100, 125); w(n, 0.55, 0.8, 0, 0, 0)->dir = 0.5;
    o = w(1000, 0.55, 0.8, 1, 1, 0); o->dir = 0.5; o->fold = 1;
    o = w(-1, 0.825, 0.5, 0.5, 0.5, 0.5); o->dir = 0.5; o->boosts = 0;
  } else if (mode == MODE_SURVIVAL) {
    col(w(50, 0.1, 0, 0, 1, 1), 5, 12);
    w(50, 0.25, 0, 0, 0, 0);
    w(80, 0.2, 1, 0, 1, 1)->interval = 2;
    col(w(10, 0.1, 0, 0, 1, 1), 14, 14);
    o = col(w(18, 0.2, 0, 0, 1, 1), 10, 10); o->interval = 6; o->period = -4; o->sep = 3; o->curves = 0;
    w(50, 0.4, 1, 0, 0, 0);
    o = col(w(30, 0.1, 1, 1, 1, 1), 3, 3); o->interval = 6;
    o = col(w(50, 0.2, 1, 0, 1, 1), 3, 3); o->interval = 2;
    o = col(w(50, 0.1, 0, 0, 1, 0), 10, 10); o->interval = 8; o->curves = 0;
    o = col(w(30, 0.2, 1, 0, 1, 1), 10, 10); o->interval = 30;
    col(w(10, 0.15, 1, 1, 1, 0), 25, 25);
    o = w(20, 0.05, 1, 1, 0, 0); o->interval = 6; o->world = 3;
    o = col(w(10, 0.2, 1, 0, 1, 1), 20, 20); o->interval = 15; o->period = -3; o->sep = 0;
    o = col(w(50, 0.15, 1, 1, 1, 0), 4, 4); o->interval = 3;
    o = col(w(10, 0.2, 1, 0, 1, 1), 15, 15); o->interval = 20; o->period = 5; o->sep = 3;
    o = col(w(100, 0.2, 1, 0, 1, 1), 4, 5); o->interval = 10;
    col(w(10, 0.15, 1, 1, 1, 0), 25, 25);
    o = col(w(125, 0.25, 1, 0.5, 0.5, 0.5), 1, 6); o->interval = 6; o->world = 4;
    col(w(75, 0.175, 1, 1, 1, 1), 1, 3);
    col(w(125, 0.5, 1, 0, 1, 0.5), 1, 4);
    o = col(w(20, 0.2, 1, 0, 1, 1), 25, 25); o->interval = 20; o->period = 5; o->sep = 3;
    o = col(w(125, 0.5, 1, 0, 1, 0), 1, 6); o->world = 5;
    col(w(75, 0.5, 1, 0, 1, 0), 1, 3);
    col(w(10, 0.15, 1, 1, 1, 0), 25, 25);
    w(-1, 0.5, 1, 0, 0, 0)->world = 6;
  } else {
    return -1;
  }
  return N_;
}
