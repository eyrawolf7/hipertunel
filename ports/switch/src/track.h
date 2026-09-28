/* Geometría del túnel: port de app/src/render/track.js.
 * Un anillo por fila (centro P, adelante F, arriba U, derecha X) con transporte paralelo, y la
 * sección de 12 caras de ancho fijo que se abre anclada en la celda 0. */
#ifndef HT_TRACK_H
#define HT_TRACK_H

#include "vmath.h"
#include "../sim/game.h"

#define RING_SLOTS 128

typedef struct { V3 P, F, U, X; } Frame;
typedef struct { int k, valid; Frame f; } Ring;

typedef struct {
  Ring rings[RING_SLOTS];
  int maxK;          /* fila más adelantada creada (para last()) */
  int any;
} Track;

typedef struct { double b[26], d[24]; double fold; } Section;
typedef struct { double x, y, nx, ny, tx, ty; } Surf;

extern const double TR_R, TR_CELL_W;

void track_reset(Track *t);
void track_sync(Track *t, const Game *g);
const Frame *track_ring(const Track *t, int k);     /* NULL si no existe */
void track_frame_at(const Track *t, double s, Frame *out);
void track_section(double fold, Section *sec);
void track_surf(const Section *sec, double u, int closed, Surf *out);
static inline V3 track_to_world(const Frame *f, double x, double y) { return vmad(vmad(f->P, f->X, x), f->U, y); }

#endif
