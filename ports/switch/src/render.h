/* Capa de dibujo nativa: port de app/src/render/ (index.js, tunnel.js, boxes.js, pads.js,
 * coins.js, sky.js, worlds.js) sobre OpenGL 3.3 core / OpenGL ES 3.0. */
#ifndef HT_RENDER_H
#define HT_RENDER_H

#include "../sim/game.h"
#include "track.h"

typedef struct { int reduceFx; int attract; } RenderOpts;

int  rn_init(int gles);                 /* 0 si todo bien */
void rn_resize(int w, int h);
void rn_reset(void);
Track *rn_track(void);
void rn_events(const Game *g);          /* tras cada paso de la simulación */
void rn_update(const Game *g, double s, double theta, double dt, RenderOpts o);
void rn_render(void);                   /* dibuja en el framebuffer activo */
int  rn_consume_landing(void);
/* 2D para el HUD, en píxeles de pantalla (0,0 arriba a la izquierda) */
void hud_begin(int w, int h);
void hud_rect(float x, float y, float w, float h, float rad, unsigned rgb, float a);
void hud_quad(const float *xy /* 4 esquinas */, unsigned rgb, float a);
float hud_text(float x, float y, float px, const char *s, unsigned rgb, float a);   /* devuelve el ancho */
float hud_text_w(float px, const char *s);
float hud_text_ex(float x, float y, float px, const char *s, unsigned rgb, float a, float grow);
void hud_end(void);

#endif
