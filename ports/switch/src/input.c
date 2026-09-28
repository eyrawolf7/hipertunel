/* Port de steer() de app/src/input/index.js (ver input.h). */
#include "input.h"
#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

void input_init(Input *in) {
  memset(in, 0, sizeof *in);
  in->tiltOn = 1; in->sens = 1;
}

void input_calibrate(Input *in) { in->cal = in->tiltRaw; }

/* "a" virtual para control digital: arranca suave (un toque = un carril) y acelera si mantienes */
static double digital(double t) { return 0.3 + 0.12 * (t / 0.3 < 1 ? t / 0.3 : 1); }
#define HOLD 0.18
static double assist(double diff, int open) {
  double dd = open ? diff : atan2(sin(diff), cos(diff)), a = dd * 2.5;
  return a < -0.42 ? -0.42 : a > 0.42 ? 0.42 : a;
}

double input_steer(Input *in, double dt, double theta, int open) {
  double a = 0, L = M_PI / 6, u = theta / L;
  int d = (in->dl ? -1 : 0) + (in->dr ? 1 : 0);
  in->src = 0;
  /* control digital con asistencia de carril: un toque lleva al centro del carril siguiente;
     mantener desliza de forma continua y al soltar encaja en el carril hacia el que ibas */
  if (d != 0) {
    if (d != in->dir) { in->holdT = 0; in->hasTarget = 1; in->target = d > 0 ? (int)floor(u + 0.35) + 1 : (int)ceil(u - 0.35) - 1; }
    if (open) { if (in->target < 0) in->target = 0; if (in->target > 11) in->target = 11; }
    else in->holdT += dt;
    in->dir = d; in->src = 1;
    if (in->holdT < HOLD) a = assist(in->target * L - theta, open);
    else { a = d * digital(in->holdT - HOLD); in->target = d > 0 ? (int)ceil(u - 0.05) : (int)floor(u + 0.05); }
  } else {
    in->dir = 0; in->holdT = 0;
    if (in->hasTarget) {
      double diff = in->target * L - theta;
      double dd = open ? diff : atan2(sin(diff), cos(diff));
      if (open && (in->target < 0 || in->target > 11)) in->target = in->target < 0 ? 0 : 11;
      a = assist(diff, open);
      /* se da por llegado antes de caer por debajo de la zona muerta de la simulación (0,019) */
      if (fabs(dd) < 0.01 || fabs(a) < 0.02) { in->hasTarget = 0; a = 0; } else in->src = 1;
    }
  }
  if (a == 0 && in->stickX != 0) { a = in->stickX * 0.42; in->src = 2; in->hasTarget = 0; }
  if (a == 0 && in->tiltOn && in->hasTilt) { a = (in->tiltRaw - in->cal) * in->sens; if (in->invert) a = -a; in->src = 3; }
  return a;
}
