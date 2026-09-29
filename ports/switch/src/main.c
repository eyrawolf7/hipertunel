/* Hipertúnel nativo (SDL2 + OpenGL): une simulación, dibujo, entrada y HUD.
 * Bucle como app/src/main.js: la simulación avanza a pasos fijos de 60 Hz y el dibujo interpola
 * entre los dos últimos pasos.
 *
 * Variables de entorno (solo escritorio, para pruebas):
 *   HIP_SCREENSHOT=carpeta   hace capturas deterministas como tests/shots.mjs y sale
 *   HIP_ROWS=40,150,400      filas de las capturas        HIP_SEED=3  semilla
 *   HIP_W=1280 HIP_H=720     tamaño                        HIP_TITLE=1 captura también el título
 *   HIP_GOD=1                los choques no matan (para capturar mundos lejanos)
 *   HIP_FRAMES=n             sale tras n fotogramas y dice los fps   HIP_NOVSYNC=1 sin vsync
 *   HIP_CONT=1               dibuja cada paso hasta la fila (partida continua, no salto) */
#include <SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "glmini.h"
#include "render.h"
#include "input.h"
#include "png.h"
#include "audio.h"
#include "../sim/game.h"
#include "../sim/bot.h"

#ifdef __SWITCH__
#include "nx.h"
#endif

#define STEP (1.0 / 60)
#define VERSION "0.50"

typedef enum { ST_ATTRACT, ST_COUNTDOWN, ST_PLAY, ST_DYING, ST_OVER, ST_PAUSED } State;

static Game game;
static State state = ST_ATTRACT;
static Input input;
static double acc, prevS, prevTheta, countdown, overT, titleT;
static int coins, lastScore, isRecord, lastDist, W = 1280, H = 720;
/* modos del menú: 0 = Arcade (el de la web por defecto), 1 = Clásico (Boost 2 tal cual) */
static int modeSel, playMode, best2[2];
#define best best2[playMode]
/* Arcade: racha ×1…×5 (sube al pasar rozando y cada 500 m sin chocar) y puntos = metros × racha */
static int mult = 1, maxMult = 1; static double multDist, points, prevDistM, nearT;
/* vibración: pulsos que se apagan solos, encima del zumbido del motor */
static double rbLo, rbHi, rbT;
#ifdef __SWITCH__
static int gyroSign = -1;
#endif          /* signo del eje x del acelerómetro de la Switch (ver README) */
static int noSave;                /* pruebas: no tocar el récord guardado */
static int botPlay;               /* HIP_BOTPLAY: el bot juega (prueba de humo del bucle) */
static char toastText[64]; static double toastT; static unsigned toastCol;

/* ---------------------------------------------------------------- récord */
static const char *record_path(void) {
#ifdef __SWITCH__
  return "sdmc:/switch/hipertunel-record.txt";
#else
  static char p[1024];
  char *base = SDL_GetPrefPath("eyrawolf", "hipertunel");
  snprintf(p, sizeof p, "%shipertunel-record.txt", base ? base : "");
  if (base) SDL_free(base);
  return p;
#endif
}
static void load_record(void) { FILE *f = fopen(record_path(), "r"); if (f) { if (fscanf(f, "%d %d", &best2[1], &best2[0]) < 1) best2[1] = 0; fclose(f); } }
/* formato: récord del Clásico (metros+monedas) y del Arcade (puntos) */
static void save_record(void) { FILE *f = fopen(record_path(), "w"); if (f) { fprintf(f, "%d %d\n", best2[1], best2[0]); fclose(f); } }
static void pulse(double lo, double hi) { if (lo > rbLo) rbLo = lo; if (hi > rbHi) rbHi = hi; }

static void toast(const char *t, unsigned col) { snprintf(toastText, sizeof toastText, "%s", t); toastT = 1.6; toastCol = col; }

/* ---------------------------------------------------------------- estados */
static void new_game(GameMode m, uint32_t seed) {
  if (m == MODE_CLASSIC && playMode == 0 && state != ST_ATTRACT) game_init_arcade(&game, seed); else game_init(&game, m, seed);
  rn_reset();
  track_sync(rn_track(), &game);
  prevS = game.s; prevTheta = game.theta; acc = 0;
}
/* demo del título: el piloto automático no se estrella y arranca cerca del primer plegado */
static void attract_game(uint32_t seed) {
  new_game(MODE_CLASSIC, seed);
  game.god = 1;
  while (game.s < 300) { game_step(&game, bot_steer(&game, 14)); track_sync(rn_track(), &game); }
  rn_reset(); track_sync(rn_track(), &game);
  prevS = game.s; prevTheta = game.theta;
}
static void attract(void) { state = ST_ATTRACT; titleT = 0; attract_game(7); }
static void start_game(int quick) {
  playMode = modeSel;
  state = ST_COUNTDOWN;
  new_game(MODE_CLASSIC, (uint32_t)rand() ^ (uint32_t)time(NULL));
  coins = 0; mult = 1; maxMult = 1; multDist = 0; points = 0; prevDistM = 0;
  au_play(AU_COUNT, 0);
  state = ST_COUNTDOWN; countdown = quick ? 0.6 : 3;
  input_calibrate(&input);       /* el cero de la inclinación es como tengas el mando al empezar */
  input.hasTarget = 0;
#ifdef __SWITCH__
  toast("Inclina el mando o usa la palanca", 0xffffff);
#else
  toast("Gira con las flechas", 0xffffff);
#endif
}
static void finish(void) {
  lastDist = (int)game_distance_m(&game);
  lastScore = playMode == 0 ? (int)floor(points + coins * 10 + 0.5) : (int)floor(game_distance_m(&game) + coins * 10 + 0.5);
  isRecord = lastScore > best && best > 0;
  if (lastScore > best) { best = lastScore; if (!noSave) save_record(); }
  state = ST_OVER; overT = 0;
  if (isRecord) au_play(AU_RECORD, 0);
}
static void pause_game(void) { if (state == ST_PLAY) state = ST_PAUSED; }
static void bump_mult(const char *why) {
  char b[64];
  if (mult >= 5) return;
  mult++; if (mult > maxMult) maxMult = mult;
  snprintf(b, sizeof b, "×%d · %s", mult, why); toast(b, 0xffd24a);
  au_play(AU_MULT, mult); pulse(0.15, 0.45);
}
static void resume_game(void) { if (state == ST_PAUSED) { state = ST_COUNTDOWN; countdown = 1.0; } }

static void step_sim(void) {
  double steer = 0;
  int i;
  prevS = game.s; prevTheta = game.theta;
  if (state == ST_ATTRACT) steer = bot_steer(&game, 14);
  else if (state == ST_PLAY && botPlay) steer = bot_steer(&game, 14);
  else if (state == ST_PLAY) steer = input_steer(&input, STEP, game.theta, game.fold != 30 && game.fold != -30);
  else input_steer(&input, STEP, game.theta, 0);
  game_step(&game, steer);
  track_sync(rn_track(), &game);
  rn_events(&game);
  if (state != ST_ATTRACT) for (i = 0; i < game.nEvents; i++) {
    const Event *e = &game.events[i];
    if (e->type == EV_BOOST) { if (e->level == 3) toast("¡Velocidad máxima!", 0x6fd8ff); au_play(AU_BOOST, e->level); pulse(0.55 + 0.1 * e->level, 0.35); }
    else if (e->type == EV_CRASH) {
      if (!e->fatal) { toast(mult > 1 && playMode == 0 ? "¡Impulsos perdidos! Racha a ×1" : "¡Impulsos perdidos!", 0xffd0d0); au_play(AU_CRASH, 0); pulse(0.85, 0.6); }
      else { au_play(AU_DEATH, 0); pulse(1, 0.8); }
      mult = 1; multDist = 0;
    }
    else if (e->type == EV_COIN) { coins = game.coinsGot; au_play(AU_COIN, e->combo); pulse(0.05, 0.28); }
    else if (e->type == EV_FOLD_START) { au_play(AU_FOLD, 0); pulse(0.4, 0.1); }
    else if (e->type == EV_WORLD && !game_inverted(&game)) au_play(AU_WORLD, 0);
    else if (e->type == EV_CAMP) toast("¡No te quedes quieto!", 0xffd0d0);
  }
  /* Arcade: puntos y racha */
  if (state == ST_PLAY && playMode == 0 && game.alive) {
    double d = game_distance_m(&game) - prevDistM;
    points += d * mult; multDist += d;
    if (multDist >= 500 && mult < 5) { multDist = 0; bump_mult("500 M SIN CHOCAR"); }
  }
  prevDistM = game_distance_m(&game);
  /* ¡Por los pelos!: una caja pasa rozando por el carril de al lado a más de 60 m/s */
  if (state == ST_PLAY && game.alive && game_speed_ms(&game) > 60 && (nearT -= STEP) <= 0) {
    const double hw = M_PI / 6;
    int j;
    for (j = 0; j < game.nBoxes; j++) {
      const Box *b = &game.boxes[j];
      double d;
      if (b->hit || b->k + 0.5 <= prevS || b->k + 0.5 > game.s) continue;
      d = game.theta - b->lane * hw; d = atan2(sin(d), cos(d));
      if (fabs(d) > hw * 0.8 && fabs(d) < hw * 1.6) {
        au_play(AU_NEAR, 0); pulse(0.1, 0.35); nearT = 0.4;
        if (playMode == 0) bump_mult("¡POR LOS PELOS!"); else toast("¡Por los pelos!", 0xffd24a);
        break;
      }
    }
  }
  rn_consume_landing();
  if (state == ST_ATTRACT && (!game.alive || game.s > 4000)) attract_game((uint32_t)rand());
}

/* ---------------------------------------------------------------- HUD (el diseño de app/src/ui/ui.css) */
#define INK 0x2b2257
#define PAPER 0xfffaf2
#define PAPER2 0xf3ead9
#define RED 0xff4b4b
#define YEL 0xffd23f
#define BLUE 0x19a8ff
#define MINT 0x3fe0a0
#define GREEN 0x5cf06a
#define PURPLE 0x32228c
static float S = 1;   /* escala del HUD: 1 = 720 px de alto */
/* texto con contorno de tinta (text-stroke) y sombra hacia abajo */
static float txt(float x, float y, float px, const char *s, unsigned col, float outline, float a) {
  if (outline > 0) { hud_text_ex(x, y + outline * 0.6f, px, s, INK, a * 0.9f, outline); hud_text_ex(x, y, px, s, INK, a, outline); }
  return hud_text_ex(x, y, px, s, col, a, 0);
}
static void txt_c(float cx, float y, float px, const char *s, unsigned col, float outline, float a) { txt(cx - hud_text_w(px, s) / 2, y, px, s, col, outline, a); }
static void txt_r(float rx, float y, float px, const char *s, unsigned col, float outline, float a) { txt(rx - hud_text_w(px, s), y, px, s, col, outline, a); }
/* píldora translúcida del HUD (--hudbg) */
static void pill(float x, float y, float w, float h, float a) { hud_rect(x, y, w, h, h / 2, PURPLE, 0.62f * a); }
/* botón de la web: borde de tinta, sombra sólida debajo y brillo arriba */
static void button(float cx, float cy, float w, float h, const char *label, unsigned bg, unsigned fg, int focus, float a, int icon) {
  float x = cx - w / 2, y = cy - h / 2, r = h * 0.43f, b = 3.2f * S, px = h / 34.0f * 1.62f;
  float tw = hud_text_w(px, label), ix = icon ? h * 0.42f : 0, tx = cx - (tw + ix) / 2 + ix;
  if (focus) hud_rect(x - 9 * S, y - 9 * S, w + 18 * S, h + 18 * S, r + 9 * S, INK, a), hud_rect(x - 7 * S, y - 7 * S, w + 14 * S, h + 14 * S, r + 7 * S, YEL, a);
  hud_rect(x, y + 6 * S, w, h, r, INK, a);                                 /* sombra sólida */
  hud_rect(x, y, w, h, r, INK, a);
  hud_rect(x + b, y + b, w - 2 * b, h - 2 * b, r - b, bg, a);
  hud_rect(x + h * 0.25f, y + b + 2 * S, w - h * 0.5f, (h - 2 * b) * 0.36f, (h - 2 * b) * 0.18f, 0xffffff, 0.28f * a);   /* brillo */
  if (icon == 1) { float s = h * 0.2f, ix0 = tx - ix + 2 * S, iy = cy; float q[8] = { ix0, iy - s, ix0 + s * 1.5f, iy, ix0 + s * 1.5f, iy, ix0, iy + s }; hud_quad(q, fg, a); }
  if (fg == 0xffffff) hud_text_ex(tx, cy - px * 6.1f + 2.5f * S, px, label, 0x781420, 0.45f * a, 0);
  hud_text_ex(tx, cy - px * 6.1f, px, label, fg, a, 0);
}
static void coin_icon(float cx, float cy, float r) {
  hud_rect(cx - r, cy - r, 2 * r, 2 * r, r, INK, 1);
  hud_rect(cx - r * 0.82f, cy - r * 0.82f, 1.64f * r, 1.64f * r, r * 0.82f, 0xe3a008, 1);
  hud_rect(cx - r * 0.55f, cy - r * 0.55f, 1.1f * r, 1.1f * r, r * 0.55f, 0xffd23f, 1);
}
/* chevrón de la web (M7 5h11.5L33 22 18.5 39H7l14.5-17z, caja 40×44) */
static void chevron(float x, float y, float sz, unsigned fill, float fa, unsigned stroke, float sa, float grow) {
  float k = sz / 44, g = grow;
#define CX(v) (x + (v) * k)
#define CY(v) (y + (v) * k)
  float q1[8] = { CX(7) - g, CY(5) - g, CX(18.5) + g * 0.3f, CY(5) - g, CX(33) + g, CY(22), CX(21.5) - g, CY(22) };
  float q2[8] = { CX(21.5) - g, CY(22), CX(33) + g, CY(22), CX(18.5) + g * 0.3f, CY(39) + g, CX(7) - g, CY(39) + g };
  if (sa > 0) { float o1[8], o2[8]; int i; float gg = 2.4f * S; for (i = 0; i < 8; i++) { o1[i] = q1[i]; o2[i] = q2[i]; }
    o1[0] -= gg; o1[1] -= gg; o1[3] -= gg; o1[4] += gg; o1[6] -= gg; o2[0] -= gg; o2[2] += gg; o2[5] += gg; o2[6] -= gg; o2[7] += gg;
    hud_quad(o1, stroke, sa); hud_quad(o2, stroke, sa); }
  hud_quad(q1, fill, fa); hud_quad(q2, fill, fa);
#undef CX
#undef CY
}
/* tarjeta de papel con cabecera morada a rayas (pop-card) */
static void card(float x, float y, float w, float h, float headH, unsigned head, float a) {
  float r = 30 * S, b = 4 * S;
  int i;
  hud_rect(x, y + 10 * S, w, h, r, INK, 0.9f * a);
  hud_rect(x, y, w, h, r, INK, a);
  hud_rect(x + b, y + b, w - 2 * b, h - 2 * b, r - b, PAPER, a);
  if (headH > 0) {
    hud_rect(x + b, y + b, w - 2 * b, headH, r - b, head, a);
    hud_rect(x + b, y + b + headH - r, w - 2 * b, r, 0, head, a);
    for (i = 0; i < 30; i++) {   /* rayas diagonales claras */
      float sx = x + b + i * 34 * S - headH;
      float q[8] = { sx, y + b + headH, sx + 14 * S, y + b + headH, sx + 14 * S + headH, y + b, sx + headH, y + b };
      if (sx + headH < x + b + r * 0.6f || sx > x + w - b - r * 0.6f) continue;
      hud_quad(q, 0xffffff, 0.12f * a);
    }
    hud_rect(x + b, y + b + headH, w - 2 * b, 3.5f * S, 0, INK, a);
  }
}

static void draw_hud(void) {
  char buf[96];
  float cx = W / 2.0f;
  S = H / 720.0f;
  hud_begin(W, H);
  if (state == ST_ATTRACT) {
    /* logo: relieve de colores, contorno de tinta y relleno blanco, letra a letra */
    static const char *LOGO[] = { "H", "i", "p", "e", "r", "t", "ú", "n", "e", "l" };
    static const unsigned TINT[4] = { RED, YEL, BLUE, MINT };
    float px = 13.5f * S, lw = 0, lx, ly = 150 * S, st = px * 0.85f;
    int i;
    hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.22f);
    for (i = 0; i < 10; i++) lw += hud_text_w(px, LOGO[i]);
    lx = cx - lw / 2;
    for (i = 0; i < 10; i++) {
      float bob = (float)sin(titleT * 2.2 - i * 0.45) * 3 * S, x = lx;
      hud_text_ex(x, ly + bob + px * 1.75f, px, LOGO[i], INK, 0.85f, st);            /* sombra del relieve */
      hud_text_ex(x, ly + bob + px * 1.0f, px, LOGO[i], TINT[i % 4], 1, st);       /* relieve de color */
      hud_text_ex(x, ly + bob, px, LOGO[i], INK, 1, st);                            /* tinta */
      hud_text_ex(x, ly + bob, px, LOGO[i], 0xffffff, 1, 0);                         /* relleno */
      lx += hud_text_w(px, LOGO[i]);
    }
    /* pegatina "¡Inclina y vuela!" */
    {
      const char *sk = "¡Inclina y vuela!";
      float spx = 2.5f * S, sw = hud_text_w(spx, sk) + 40 * S, sh = 46 * S, sx = cx + lw / 2 - sw + 30 * S, sy = ly + 118 * S + (float)sin(titleT * 2.8) * 3 * S;
      hud_rect(sx, sy + 5 * S, sw, sh, sh * 0.45f, INK, 1); hud_rect(sx, sy, sw, sh, sh * 0.45f, INK, 1);
      hud_rect(sx + 3.5f * S, sy + 3.5f * S, sw - 7 * S, sh - 7 * S, sh * 0.4f, YEL, 1);
      hud_text(sx + 20 * S, sy + 8 * S, spx, sk, INK, 1);
    }
    /* botón Jugar y modos */
    {
      float pulse = 1 + 0.035f * (float)sin(titleT * 4);
      button(cx, 400 * S, 270 * S * pulse, 76 * S * pulse, "Jugar", RED, 0xffffff, 1, 1, 1);
      button(cx - 130 * S, 505 * S, 230 * S, 60 * S, "Arcade", modeSel == 0 ? YEL : PAPER, INK, 0, 1, 0);
      button(cx + 130 * S, 505 * S, 230 * S, 60 * S, "Clásico", modeSel == 1 ? YEL : PAPER, INK, 0, 1, 0);
      txt_c(cx, 548 * S, 2.1f * S, modeSel == 0 ? "Más rápido, sin acampar y racha ×5" : "Boost 2 tal cual", 0xffffff, 3 * S, 1);
    }
    /* medidor de inclinación (para ver el sentido del giroscopio) */
    if (input.hasTilt && input.tiltOn) {
      double v = (input.tiltRaw - input.cal) * (input.invert ? -1 : 1) * 2.5;
      float bw = 260 * S, bx = cx - bw / 2, y = 592 * S;
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      hud_rect(bx, y, bw, 10 * S, 5 * S, PURPLE, 0.7f);
      hud_rect(cx - 2 * S, y - 4 * S, 4 * S, 18 * S, 0, 0xffffff, 0.8f);
      hud_rect(cx + (float)v * bw / 2 - 9 * S, y - 4 * S, 18 * S, 18 * S, 9 * S, GREEN, 1);
    }
    /* pie: récord, "pulsa para jugar" y versión */
    {
      float fy = H - 58 * S, blink = 0.6f + 0.4f * (float)sin(titleT * 3);
      if (best2[modeSel] > 0) snprintf(buf, sizeof buf, "Récord  %d%s", best2[modeSel], modeSel == 0 ? " pts" : " m"); else snprintf(buf, sizeof buf, "Récord  -");
      pill(28 * S, fy, hud_text_w(2.3f * S, buf) + 44 * S, 40 * S, 1);
      hud_text(50 * S, fy + 7 * S, 2.3f * S, buf, 0xffffff, 1);
#ifdef __SWITCH__
      txt_c(cx, fy + 6 * S, 2.4f * S, "Pulsa A para jugar", 0xffffff, 3 * S, blink);
      txt_c(cx, fy - 40 * S, 1.8f * S, "Palanca, cruceta o inclina el mando · R centrar · − giroscopio · X invertir · Y vibración · + salir", 0xffffff, 2.5f * S, 0.9f);
#else
      txt_c(cx, fy + 6 * S, 2.4f * S, "Pulsa Enter para jugar", 0xffffff, 3 * S, blink);
      txt_c(cx, fy - 40 * S, 1.8f * S, "Flechas: girar o cambiar de modo · P pausa · V vibración · Q salir", 0xffffff, 2.5f * S, 0.9f);
#endif
      pill(W - 110 * S, fy, 82 * S, 40 * S, 0.7f);
      hud_text(W - 94 * S, fy + 7 * S, 2.3f * S, "v" VERSION, 0xffffff, 0.9f);
    }
  } else {
    /* arriba a la izquierda: pausa y monedas */
    pill(26 * S, 24 * S, 58 * S, 58 * S, 1);
    hud_rect(26 * S, 24 * S, 58 * S, 58 * S, 16 * S, PURPLE, 0.1f);
    hud_rect(44 * S, 40 * S, 8 * S, 26 * S, 3 * S, 0xffffff, 1); hud_rect(58 * S, 40 * S, 8 * S, 26 * S, 3 * S, 0xffffff, 1);
    snprintf(buf, sizeof buf, "%d", coins);
    pill(96 * S, 28 * S, hud_text_w(3.2f * S, buf) + 86 * S, 50 * S, 1);
    coin_icon(124 * S, 53 * S, 17 * S);
    txt(152 * S, 32 * S, 3.2f * S, buf, 0xffffff, 3 * S, 1);
    /* arriba a la derecha: distancia, velocidad (y racha del Arcade) */
    snprintf(buf, sizeof buf, "%d", (int)game_distance_m(&game));
    {
      float mw = hud_text_w(3.2f * S, "m");
      int beyond = best > 0 && playMode == 1 && (int)game_distance_m(&game) > best;
      txt_r(W - 28 * S - mw - 4 * S, 12 * S, 6.2f * S, buf, beyond ? YEL : 0xffffff, 4.5f * S, 1);
      txt(W - 28 * S - mw, 40 * S, 3.2f * S, "m", 0xffffff, 3.5f * S, 1);
    }
    snprintf(buf, sizeof buf, "%d km/h", (int)floor(game_speed_ms(&game) * 3.6 + 0.5));
    { float tw = hud_text_w(2.3f * S, buf); pill(W - 28 * S - tw - 28 * S, 86 * S, tw + 28 * S, 34 * S, 1); hud_text(W - 28 * S - tw - 14 * S, 90 * S, 2.3f * S, buf, 0xffffff, 1); }
    if (playMode == 0) {
      static const unsigned mc[6] = { 0, PURPLE, 0xe0600f, 0xd6307f, 0x8a3fe0, 0xff3d57 };
      float tw;
      snprintf(buf, sizeof buf, "×%d", mult);
      tw = hud_text_w(4.2f * S, buf);
      hud_rect(W - 28 * S - tw - 24 * S, 132 * S, tw + 24 * S, 50 * S, 14 * S, mc[mult], mult > 1 ? 1 : 0.62f);
      txt(W - 28 * S - tw - 12 * S, 132 * S, 4.2f * S, buf, 0xffffff, 3 * S, 1);
      snprintf(buf, sizeof buf, "%d pts", (int)(points + coins * 10));
      txt_r(W - 28 * S, 188 * S, 2.3f * S, buf, 0xffffff, 3 * S, 1);
    }
    /* abajo a la derecha: los tres chevrones de impulso */
    {
      int i;
      for (i = 0; i < 3; i++) {
        float x = W - (206 - i * 58) * S, y = H - 90 * S;
        int on = i < game.level;
        if (on) chevron(x, y, 66 * S, GREEN, 1, INK, 1, 0);
        else chevron(x, y, 66 * S, 0x1c1540, 0.35f, 0xffffff, 0.6f, 0);
      }
    }
    if (state == ST_COUNTDOWN) {
      int n = (int)ceil(countdown);
      float k = (float)(countdown - floor(countdown)), sc = 1 + 0.25f * k * k;
      snprintf(buf, sizeof buf, "%d", n);
      txt_c(cx, H * 0.38f - 70 * S * sc, 15 * S * sc, buf, 0xffffff, 7 * S, 1);
    }
    if (state == ST_PAUSED) {
      float w = 520 * S, h = 330 * S, x = cx - w / 2, y = H / 2 - h / 2;
      hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.5f);
      card(x, y, w, h, 76 * S, 0x6a5ae0, 1);
      txt_c(cx, y + 16 * S, 4.2f * S, "Pausa", 0xffffff, 3 * S, 1);
#ifdef __SWITCH__
      button(cx, y + 150 * S, 360 * S, 64 * S, "A  Continuar", RED, 0xffffff, 1, 1, 0);
      button(cx, y + 250 * S, 360 * S, 56 * S, "B  Menú", PAPER, INK, 0, 1, 0);
#else
      button(cx, y + 150 * S, 360 * S, 64 * S, "Enter  Continuar", RED, 0xffffff, 1, 1, 0);
      button(cx, y + 250 * S, 360 * S, 56 * S, "Esc  Menú", PAPER, INK, 0, 1, 0);
#endif
    }
    if (state == ST_OVER) {
      float a = (float)(overT * 4 < 1 ? overT * 4 : 1), w = 700 * S, h = 440 * S, x = cx - w / 2, y = 130 * S;
      const char *head = isRecord ? "¡Increíble!" : lastDist < 300 ? "¡Arranque complicado!" : "¡Buena carrera!";
      hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.45f * a);
      card(x, y, w, h, 82 * S, isRecord ? 0xff6a5e : 0x6a5ae0, a);
      txt(x + 40 * S, y + 18 * S, 4.4f * S, head, 0xffffff, 3 * S, a);
      { const char *mn = playMode == 0 ? "ARCADE" : "CLÁSICO"; float tw = hud_text_w(2.2f * S, mn);
        hud_rect(x + w - tw - 80 * S, y + 22 * S, tw + 40 * S, 40 * S, 20 * S, INK, a); hud_rect(x + w - tw - 78 * S, y + 24 * S, tw + 36 * S, 36 * S, 18 * S, 0x0b6fc0, a);
        hud_text(x + w - tw - 60 * S, y + 28 * S, 2.2f * S, mn, 0xffffff, a); }
      if (isRecord) {
        float rw = 300 * S, rx = cx - rw / 2, ry = y - 26 * S;
        hud_rect(rx, ry + 5 * S, rw, 50 * S, 12 * S, INK, a); hud_rect(rx, ry, rw, 50 * S, 12 * S, INK, a);
        hud_rect(rx + 3.5f * S, ry + 3.5f * S, rw - 7 * S, 43 * S, 10 * S, YEL, a);
        txt_c(cx, ry + 6 * S, 3.0f * S, "¡Nuevo récord!", INK, 0, a);
      }
      hud_text(x + 48 * S, y + 110 * S, 2.4f * S, "Distancia", 0x6b6394, a);
      snprintf(buf, sizeof buf, "%d", lastDist);
      { float nw = hud_text_w(9 * S, buf);
        hud_text_ex(x + 48 * S, y + 150 * S + 6 * S, 9 * S, buf, playMode == 0 ? RED : YEL, a, 0);
        hud_text_ex(x + 48 * S, y + 150 * S, 9 * S, buf, INK, a, 0);
        hud_text(x + 56 * S + nw, y + 196 * S, 4 * S, "m", 0x6b6394, a); }
      if (playMode == 0) snprintf(buf, sizeof buf, "%d puntos  ·  racha máx ×%d  ·  %d monedas", lastScore, maxMult, coins);
      else snprintf(buf, sizeof buf, "%d monedas  ·  %d puntos", coins, lastScore);
      hud_rect(x + 40 * S, y + 262 * S, w - 80 * S, 58 * S, 18 * S, PAPER2, a);
      txt_c(cx, y + 276 * S, 2.6f * S, buf, INK, 0, a);
      snprintf(buf, sizeof buf, playMode == 0 ? "Mejor  %d pts" : "Mejor  %d", best);
      hud_text(x + w - 48 * S - hud_text_w(2.4f * S, buf), y + 118 * S, 2.4f * S, buf, INK, a);
      if (overT > 0.6) {
#ifdef __SWITCH__
        button(cx - 120 * S, y + h - 64 * S, 230 * S, 64 * S, "A  Otra vez", RED, 0xffffff, 1, a, 0);
        button(cx + 140 * S, y + h - 64 * S, 190 * S, 56 * S, "B  Menú", PAPER, INK, 0, a, 0);
#else
        button(cx - 120 * S, y + h - 64 * S, 230 * S, 64 * S, "Enter  Otra vez", RED, 0xffffff, 1, a, 0);
        button(cx + 140 * S, y + h - 64 * S, 190 * S, 56 * S, "Esc  Menú", PAPER, INK, 0, a, 0);
#endif
      }
    }
  }
  /* avisos: abajo a la izquierda, como en la web */
  if (toastT > 0 && state != ST_ATTRACT) {
    float px = 2.6f * S, tw = hud_text_w(px, toastText), a = (float)(toastT < 0.3 ? toastT / 0.3 : 1), th = 50 * S;
    float x = 28 * S, y = H - 40 * S - th;
    unsigned bg = toastCol == 0x6fd8ff ? BLUE : toastCol == 0xffd24a ? YEL : PAPER, fg = toastCol == 0x6fd8ff ? 0xffffff : INK;
    hud_rect(x, y + 5 * S, tw + 44 * S, th, th / 2, INK, a); hud_rect(x, y, tw + 44 * S, th, th / 2, INK, a);
    hud_rect(x + 3.2f * S, y + 3.2f * S, tw + 44 * S - 6.4f * S, th - 6.4f * S, th / 2 - 3.2f * S, bg, a);
    hud_text(x + 22 * S, y + 10 * S, px, toastText, fg, a);
  }
  hud_end();
}

/* ---------------------------------------------------------------- vibración */
static int vibeOn = 1;
static void platform_rumble(float lo, float hi, float fl, float fh);
/* motor: un zumbido grave muy suave que sube con la velocidad (sp = 0..1; −1 = parado) + pulsos */
static void rumble_frame(double dt, double sp) {
  float lo = 0, hi = 0;
  rbLo *= exp(-dt * 7); rbHi *= exp(-dt * 12);
  if (!vibeOn) { platform_rumble(0, 0, 160, 320); return; }
  if (sp >= 0) { rbT += dt; lo = (float)(0.05 + 0.1 * sp + 0.02 * sin(rbT * (18 + 30 * sp))); hi = (float)(0.02 + 0.05 * sp); }
  lo += (float)rbLo; hi += (float)rbHi;
  platform_rumble(lo, hi, (float)(90 + 80 * (sp > 0 ? sp : 0)), 320);
}

/* ---------------------------------------------------------------- fotograma */
static void frame(double dt, RenderOpts ro) {
  double a, s, dth, theta;
  titleT += dt;
  if (toastT > 0) toastT -= dt;
  if (state == ST_COUNTDOWN) { int b0 = (int)ceil(countdown); countdown -= dt; if ((int)ceil(countdown) != b0 && countdown > 0) au_play(AU_COUNT, 0); if (countdown <= 0) { state = ST_PLAY; au_play(AU_GO, 0); } }
  if (state == ST_PLAY || state == ST_ATTRACT || state == ST_DYING) {
    int n = 0;
    acc += dt;
    while (acc >= STEP && n < 6) { step_sim(); acc -= STEP; n++; }
    if (n == 6) acc = 0;
    if (state == ST_PLAY && !game.alive) { state = ST_DYING; overT = 0; }
  } else {
    /* fuera de juego la asistencia digital sigue su curso (como input.steer en main.js) */
  }
  if (state == ST_DYING) { overT += dt; if (overT > 0.9) finish(); }
  if (state == ST_OVER) overT += dt;
  a = (state == ST_PLAY || state == ST_ATTRACT || state == ST_DYING) ? acc / STEP : 1;
  s = prevS + (game.s - prevS) * a;
  dth = game.theta - prevTheta;
  if (dth > M_PI) dth -= M_PI * 2; else if (dth < -M_PI) dth += M_PI * 2;
  theta = prevTheta + dth * a;
  ro.attract = state == ST_ATTRACT;
  rn_update(&game, s, theta, dt, ro);
  rn_render();
  draw_hud();
  {
    double sp = (game.v - 1) / 4.5;
    int playing = state == ST_PLAY || state == ST_COUNTDOWN || state == ST_DYING;
    au_set(sp, playing && game.alive, state != ST_PAUSED);
    rumble_frame(dt, state == ST_PLAY && game.alive ? (sp < 0 ? 0 : sp > 1 ? 1 : sp) : -1);
  }
}

typedef enum { B_OK, B_BACK, B_PAUSE, B_QUIT, B_CALIB, B_TILT, B_INVERT, B_LEFT, B_RIGHT, B_VIBE } Button;
static int quitReq;
static void on_button(Button b) {
  if (b == B_QUIT) { if (state == ST_PLAY || state == ST_COUNTDOWN) pause_game(); else if (state == ST_PAUSED) attract(); else quitReq = 1; return; }
  if (b == B_CALIB) { input_calibrate(&input); toast("Giroscopio centrado", 0xffffff); return; }
  if (b == B_TILT) { input.tiltOn = !input.tiltOn; toast(input.tiltOn ? "Giroscopio: sí" : "Giroscopio: no", 0xffffff); return; }
  if (b == B_VIBE) { vibeOn = !vibeOn; toast(vibeOn ? "Vibración: sí" : "Vibración: no", 0xffffff); if (vibeOn) pulse(0.6, 0.4); return; }
  if ((b == B_LEFT || b == B_RIGHT) && state == ST_ATTRACT) { modeSel = !modeSel; au_play(AU_MENU, 0); pulse(0.1, 0.2); return; }
  if (b == B_LEFT || b == B_RIGHT) return;
  if (b == B_INVERT) { input.invert = !input.invert; toast(input.invert ? "Giro invertido" : "Giro normal", 0xffffff); return; }
  switch (state) {
    case ST_ATTRACT: if (b == B_OK) start_game(0); else if (b == B_PAUSE || b == B_BACK) quitReq = b == B_PAUSE ? 1 : quitReq; break;
    case ST_PLAY: case ST_COUNTDOWN: if (b == B_PAUSE || b == B_BACK) pause_game(); break;
    case ST_PAUSED: if (b == B_PAUSE || b == B_OK) resume_game(); else if (b == B_BACK) attract(); break;
    case ST_OVER: if (b == B_OK && overT > 0.6) start_game(1); else if (b == B_BACK) attract(); break;
    default: break;
  }
}

/* ---------------------------------------------------------------- capturas deterministas */
static int screenshot_mode(const char *dir) {
  const char *rowsEnv = getenv("HIP_ROWS"), *seedEnv = getenv("HIP_SEED");
  char rows[256], *tok, path[1024];
  GLuint fbo, rbC, rbD, fbo2, rb2;
  unsigned char *px = malloc((size_t)W * H * 4);
  RenderOpts ro = { 0, 0 };
  int i, cont = getenv("HIP_CONT") != NULL;
  snprintf(rows, sizeof rows, "%s", rowsEnv ? rowsEnv : "40,150,400");
  glGenFramebuffers(1, &fbo); glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glGenRenderbuffers(1, &rbC); glBindRenderbuffer(GL_RENDERBUFFER, rbC); glRenderbufferStorageMultisample(GL_RENDERBUFFER, 4, GL_RGBA8, W, H);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, rbC);
  glGenRenderbuffers(1, &rbD); glBindRenderbuffer(GL_RENDERBUFFER, rbD); glRenderbufferStorageMultisample(GL_RENDERBUFFER, 4, GL_DEPTH_COMPONENT24, W, H);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, rbD);
  if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) { fprintf(stderr, "FBO incompleto\n"); return 1; }
  glGenFramebuffers(1, &fbo2); glBindFramebuffer(GL_FRAMEBUFFER, fbo2);
  glGenRenderbuffers(1, &rb2); glBindRenderbuffer(GL_RENDERBUFFER, rb2); glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, W, H);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, rb2);
  rn_resize(W, H);
#define SNAP(name) do { \
    glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo); glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fbo2); \
    glBlitFramebuffer(0, 0, W, H, 0, 0, W, H, GL_COLOR_BUFFER_BIT, GL_NEAREST); \
    glBindFramebuffer(GL_FRAMEBUFFER, fbo2); glPixelStorei(GL_PACK_ALIGNMENT, 1); \
    glReadPixels(0, 0, W, H, GL_RGBA, GL_UNSIGNED_BYTE, px); \
    snprintf(path, sizeof path, "%s/%s", dir, name); png_write(path, px, W, H, 1); printf("%s\n", path); } while (0)
  if (getenv("HIP_TITLE")) {
    attract();
    for (i = 0; i < 90; i++) { glBindFramebuffer(GL_FRAMEBUFFER, fbo); frame(STEP, ro); }
    SNAP("titulo.png");
  }
  /* como tests/shots.mjs: partida clásica con semilla, el bot conduce hasta la fila y 20 pasos más */
  start_game(0);
  new_game(MODE_CLASSIC, (uint32_t)strtoul(seedEnv ? seedEnv : "3", NULL, 10));
  state = ST_PLAY; toastT = 0;
  if (getenv("HIP_GOD")) game.god = 1;   /* choques sin consecuencias, para llegar lejos */
  for (tok = strtok(rows, ","); tok; tok = strtok(NULL, ",")) {
    int r = atoi(tok);
    char name[64];
    while (game.s < r && game.alive) {
      prevS = game.s; prevTheta = game.theta;
      game_step(&game, bot_steer(&game, 14)); track_sync(rn_track(), &game);
      if (cont) {   /* partida de verdad: sucesos y un fotograma por paso */
        rn_events(&game);
        glBindFramebuffer(GL_FRAMEBUFFER, fbo);
        rn_update(&game, game.s, game.theta, STEP, ro);
        if (game.s > r - 3) { rn_render(); draw_hud(); }
      }
    }
    prevS = game.s; prevTheta = game.theta;
    for (i = 0; i < 20; i++) {
      prevS = game.s; prevTheta = game.theta;
      game_step(&game, bot_steer(&game, 14)); track_sync(rn_track(), &game); rn_events(&game);
    }
    /* congelado (window.__freeze): se dibujan unos fotogramas sin avanzar la simulación */
    prevS = game.s; prevTheta = game.theta;
    for (i = 0; i < 9; i++) {
      glBindFramebuffer(GL_FRAMEBUFFER, fbo);
      rn_update(&game, game.s, game.theta, STEP, ro);
      rn_render();
      draw_hud();
    }
    printf("fila %d: s=%.1f fold=%.1f world=%d level=%d alive=%d boxes=%d pads=%d v=%.2f\n", r, game.s, game.fold, game.world, game.level, game.alive, game.nBoxes, game.nPads, game.v);
    snprintf(name, sizeof name, "fila-%05d.png", r);
    SNAP(name);
  }
  /* pantalla de fin de partida */
  coins = game.coinsGot; finish();
  for (i = 0; i < 60; i++) { glBindFramebuffer(GL_FRAMEBUFFER, fbo); frame(STEP, ro); }
  SNAP("fin.png");
  free(px);
  return 0;
}

/* ---------------------------------------------------------------- plataforma */
#ifdef __SWITCH__
static void platform_input_init(void) { nx_input_init(); }
static void platform_input(void) {
  NxPad p;
  nx_poll(&p);
  if (p.down & NX_A) on_button(B_OK);
  if (p.down & NX_B) on_button(B_BACK);
  if (p.down & NX_PLUS) { if (state == ST_ATTRACT) quitReq = 1; else on_button(B_PAUSE); }
  if (p.down & NX_CALIB) on_button(B_CALIB);
  if (p.down & NX_MINUS) on_button(B_TILT);
  if (p.down & NX_X) on_button(B_INVERT);
  if (p.down & NX_Y) on_button(B_VIBE);
  if (p.down & NX_LEFT) on_button(B_LEFT);
  if (p.down & NX_RIGHT) on_button(B_RIGHT);
  {  /* palanca: un golpe a un lado cambia de modo en el título */
    static int flick;
    int f = p.stickX > 0.6 ? 1 : p.stickX < -0.6 ? -1 : 0;
    if (f && !flick) on_button(f < 0 ? B_LEFT : B_RIGHT);
    flick = f;
  }
  input.dl = (p.held & NX_LEFT) != 0;
  input.dr = (p.held & NX_RIGHT) != 0;
  input.stickX = p.stickX;
  /* giroscopio: de la gravedad sale el seno de la inclinación (girar el mando como un volante) */
  if (p.hasAccel) {
    double g = sqrt(p.ax * p.ax + p.ay * p.ay + p.az * p.az);
    if (g > 0.3) { input.tiltRaw = gyroSign * 0.981 * p.ax / g; input.hasTilt = 1; }
  }
}
static void platform_rumble(float lo, float hi, float fl, float fh) { nx_rumble(lo, hi, fl, fh); }
#else
static SDL_GameController *ctl;
static void platform_rumble(float lo, float hi, float fl, float fh) {
  (void)fl; (void)fh;
#if SDL_VERSION_ATLEAST(2, 0, 9)
  if (ctl) SDL_GameControllerRumble(ctl, (Uint16)(lo > 1 ? 65535 : lo * 65535), (Uint16)(hi > 1 ? 65535 : hi * 65535), 60);
#else
  (void)lo; (void)hi;
#endif
}
static void platform_input_init(void) {
  int i;
  for (i = 0; i < SDL_NumJoysticks(); i++) if (SDL_IsGameController(i)) { ctl = SDL_GameControllerOpen(i); break; }
#if SDL_VERSION_ATLEAST(2, 0, 14)
  if (ctl && SDL_GameControllerHasSensor(ctl, SDL_SENSOR_ACCEL)) SDL_GameControllerSetSensorEnabled(ctl, SDL_SENSOR_ACCEL, SDL_TRUE);
#endif
}
static void platform_input(void) {
  const Uint8 *k = SDL_GetKeyboardState(NULL);
  int pl = 0, pr = 0;
  double sx = 0;
  if (ctl) {
    int ax = SDL_GameControllerGetAxis(ctl, SDL_CONTROLLER_AXIS_LEFTX);
    double x = ax / 32767.0;
    sx = fabs(x) > 0.12 ? (x > 1 ? 1 : x) : 0;
    pl = SDL_GameControllerGetButton(ctl, SDL_CONTROLLER_BUTTON_DPAD_LEFT);
    pr = SDL_GameControllerGetButton(ctl, SDL_CONTROLLER_BUTTON_DPAD_RIGHT);
#if SDL_VERSION_ATLEAST(2, 0, 14)
    if (SDL_GameControllerIsSensorEnabled(ctl, SDL_SENSOR_ACCEL)) {
      float a[3];
      if (SDL_GameControllerGetSensorData(ctl, SDL_SENSOR_ACCEL, a, 3) == 0) {
        double g = sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        if (g > 3) { input.tiltRaw = -0.981 * a[0] / g; input.hasTilt = 1; }
      }
    }
#endif
  }
  input.dl = k[SDL_SCANCODE_LEFT] || k[SDL_SCANCODE_A] || pl;
  input.dr = k[SDL_SCANCODE_RIGHT] || k[SDL_SCANCODE_D] || pr;
  input.stickX = sx;
}
#endif

static int try_context(SDL_Window **win, SDL_GLContext *ctx, int es, int msaa, int hidden) {
  Uint32 flags = SDL_WINDOW_OPENGL | (hidden ? SDL_WINDOW_HIDDEN : SDL_WINDOW_SHOWN);
#ifndef __SWITCH__
  if (!hidden) flags |= SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI;
#endif
  SDL_GL_ResetAttributes();
  if (es) {
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
  } else {
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3); SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);
  }
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  if (msaa) { SDL_GL_SetAttribute(SDL_GL_MULTISAMPLEBUFFERS, 1); SDL_GL_SetAttribute(SDL_GL_MULTISAMPLESAMPLES, 4); }
  *win = SDL_CreateWindow("Hipertúnel", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, W, H, flags);
  if (!*win) return 0;
  *ctx = SDL_GL_CreateContext(*win);
  if (!*ctx) { SDL_DestroyWindow(*win); *win = NULL; return 0; }
  return 1;
}

int main(int argc, char **argv) {
  SDL_Window *win = NULL; SDL_GLContext ctx = NULL;
  const char *shot = getenv("HIP_SCREENSHOT");
  int es = -1, i, msaa, maxFrames = 0, nFrames = 0;
  Uint64 t0 = 0;
  Uint64 last, freq;
  (void)argc; (void)argv;
#ifdef __SWITCH__
  nx_init();              /* printf por la red si se lanza con nxlink -s */
  shot = NULL;
#endif
  if (getenv("HIP_W")) W = atoi(getenv("HIP_W"));
  if (getenv("HIP_H")) H = atoi(getenv("HIP_H"));
  srand((unsigned)time(NULL));
  if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_TIMER
#ifndef __SWITCH__
               | SDL_INIT_GAMECONTROLLER
#endif
               ) != 0) { fprintf(stderr, "SDL_Init: %s\n", SDL_GetError()); return 1; }
  /* orden de preferencia: Switch → ES 3.0 y luego GL 3.3; escritorio → GL 3.3 y luego ES 3.0 */
  for (msaa = 1; msaa >= 0 && es < 0; msaa--) for (i = 0; i < 2 && es < 0; i++) {
#ifdef __SWITCH__
    int wantEs = i == 0;
#else
    int wantEs = i == 1;
#endif
    if (try_context(&win, &ctx, wantEs, msaa && !shot, shot != NULL)) es = wantEs;
  }
  if (es < 0) { fprintf(stderr, "No hay contexto OpenGL: %s\n", SDL_GetError()); return 1; }
  if (gl_load((void *(*)(const char *))SDL_GL_GetProcAddress)) { fprintf(stderr, "Faltan funciones de OpenGL\n"); return 1; }
  printf("OpenGL %s · %s · %s\n", (const char *)glGetString(GL_VERSION), (const char *)glGetString(GL_RENDERER), es ? "ES" : "core");
  SDL_GL_SetSwapInterval(getenv("HIP_NOVSYNC") ? 0 : 1);
  au_init();
  if (rn_init(es)) { fprintf(stderr, "Fallo al compilar los sombreadores\n"); return 1; }
  input_init(&input);
  platform_input_init();
  load_record();
  noSave = shot != NULL || getenv("HIP_BOTPLAY") != NULL;
  if (shot) { int r = screenshot_mode(shot); SDL_Quit(); return r; }

  attract();
  maxFrames = getenv("HIP_FRAMES") ? atoi(getenv("HIP_FRAMES")) : 0;
  botPlay = getenv("HIP_BOTPLAY") != NULL;
  freq = SDL_GetPerformanceFrequency(); last = t0 = SDL_GetPerformanceCounter();
  while (!quitReq) {
    SDL_Event ev;
    Uint64 now;
    double dt;
    int dw, dh;
#ifdef __SWITCH__
    if (!nx_mainloop()) break;
#endif
    while (SDL_PollEvent(&ev)) {
      if (ev.type == SDL_QUIT) quitReq = 1;
#ifndef __SWITCH__
      else if (ev.type == SDL_KEYDOWN && !ev.key.repeat) {
        SDL_Keycode kc = ev.key.keysym.sym;
        if (kc == SDLK_RETURN || kc == SDLK_SPACE || kc == SDLK_KP_ENTER) on_button(B_OK);
        else if (kc == SDLK_ESCAPE || kc == SDLK_BACKSPACE) on_button(state == ST_OVER || state == ST_PAUSED ? B_BACK : state == ST_ATTRACT ? B_QUIT : B_PAUSE);
        else if (kc == SDLK_p) on_button(B_PAUSE);
        else if (kc == SDLK_q) on_button(B_QUIT);
        else if (kc == SDLK_c) on_button(B_CALIB);
        else if (kc == SDLK_g) on_button(B_TILT);
        else if (kc == SDLK_v) on_button(B_VIBE);
        else if (kc == SDLK_LEFT || kc == SDLK_RIGHT) on_button(kc == SDLK_LEFT ? B_LEFT : B_RIGHT);
      } else if (ev.type == SDL_CONTROLLERDEVICEADDED && !ctl) platform_input_init();
      else if (ev.type == SDL_CONTROLLERBUTTONDOWN) {
        int b = ev.cbutton.button;
        if (b == SDL_CONTROLLER_BUTTON_A) on_button(B_OK);
        else if (b == SDL_CONTROLLER_BUTTON_B) on_button(B_BACK);
        else if (b == SDL_CONTROLLER_BUTTON_START) on_button(B_PAUSE);
        else if (b == SDL_CONTROLLER_BUTTON_RIGHTSHOULDER || b == SDL_CONTROLLER_BUTTON_RIGHTSTICK) on_button(B_CALIB);
        else if (b == SDL_CONTROLLER_BUTTON_BACK) on_button(B_TILT);
        else if (b == SDL_CONTROLLER_BUTTON_Y) on_button(B_VIBE);
        else if (b == SDL_CONTROLLER_BUTTON_DPAD_LEFT || b == SDL_CONTROLLER_BUTTON_DPAD_RIGHT) on_button(b == SDL_CONTROLLER_BUTTON_DPAD_LEFT ? B_LEFT : B_RIGHT);
      }
#endif
    }
    platform_input();
    if (botPlay) {   /* pulsa A solo: empezar y reintentar */
      static State last = ST_ATTRACT;
      if (state != last) { printf("estado %d -> %d (s=%.0f)\n", last, state, game.s); last = state; }
      if ((state == ST_ATTRACT && nFrames == 30) || (state == ST_OVER && overT > 1)) on_button(B_OK);
    }
    now = SDL_GetPerformanceCounter();
    dt = (double)(now - last) / freq; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    if (botPlay) dt = STEP;   /* prueba de humo: tiempo de juego fijo, tan rápido como se pueda */
    SDL_GL_GetDrawableSize(win, &dw, &dh);
    if (dw != W || dh != H) { W = dw; H = dh; rn_resize(W, H); }
    {
      RenderOpts ro = { 0, 0 };
      frame(dt, ro);
    }
    SDL_GL_SwapWindow(win);
    if (maxFrames && ++nFrames >= maxFrames) {
      printf("%d fotogramas en %.2f s (%.1f fps)\n", nFrames, (double)(SDL_GetPerformanceCounter() - t0) / freq, nFrames / ((double)(SDL_GetPerformanceCounter() - t0) / freq));
      break;
    }
  }
  platform_rumble(0, 0, 160, 320);
  au_quit();
  SDL_GL_DeleteContext(ctx);
  SDL_DestroyWindow(win);
  SDL_Quit();
#ifdef __SWITCH__
  nx_exit();
#endif
  return 0;
}
