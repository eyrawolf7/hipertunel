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
static const char *MODE_NAME[2] = { "ARCADE", "CLÁSICO" };
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

/* ---------------------------------------------------------------- HUD */
#define INK 0x2a1f4f
static float S = 1;   /* escala del HUD (alto / 720) */
static void text_shadow(float x, float y, float px, const char *s, unsigned col) {
  hud_text_ex(x, y + px * 0.45f, px, s, INK, 0.9f, px * 0.42f);   /* contorno y sombra */
  hud_text(x, y, px, s, col, 1);
}
static void text_center(float cx, float y, float px, const char *s, unsigned col) { text_shadow(cx - hud_text_w(px, s) / 2, y, px, s, col); }
static void text_right(float rx, float y, float px, const char *s, unsigned col) { text_shadow(rx - hud_text_w(px, s), y, px, s, col); }

static void chevron(float cx, float cy, float sz, float th, unsigned col, float a) {
  /* dos trazos gruesos en forma de ">" */
  float x0 = cx - sz * 0.35f, x1 = cx + sz * 0.35f, yt = cy - sz * 0.5f, yb = cy + sz * 0.5f;
  float q1[8] = { x0, yt, x0 + th, yt, x1 + th, cy, x1, cy };
  float q2[8] = { x1, cy, x1 + th, cy, x0 + th, yb, x0, yb };
  hud_quad(q1, col, a); hud_quad(q2, col, a);
}

static void draw_hud(void) {
  char buf[64];
  float cx = W / 2.0f;
  S = H / 720.0f;
  hud_begin(W, H);
  if (state == ST_ATTRACT) {
    float blink = 0.55f + 0.45f * (float)sin(titleT * 4);
    hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.28f);
    text_center(cx, 150 * S, 13 * S, "HIPERTÚNEL", 0xffffff);
    text_center(cx, 290 * S, 3 * S, "VERSIÓN NATIVA " VERSION, 0xfff1c9);
#ifdef __SWITCH__
    const char *prompt = "PULSA A PARA JUGAR";
#else
    const char *prompt = "PULSA ENTER PARA JUGAR";
#endif
    {
      float pw = hud_text_w(4.4f * S, prompt) + 70 * S, sc = 1 + 0.04f * (float)sin(titleT * 4);
      float bw = pw * sc, bh = 76 * S * sc;
      hud_rect(cx - bw / 2 + 6 * S, 400 * S - bh / 2 + 7 * S, bw, bh, bh / 2, INK, 0.9f);
      hud_rect(cx - bw / 2, 400 * S - bh / 2, bw, bh, bh / 2, 0x22d08a, 1);
      hud_text(cx - hud_text_w(4.4f * S, prompt) / 2, 400 * S - 15.4f * S, 4.4f * S, prompt, 0xffffff, 1);
      (void)blink;
    }
#ifdef __SWITCH__
    text_center(cx, 615 * S, 2.6f * S, "INCLINA EL MANDO, PALANCA O CRUCETA PARA GIRAR", 0xffffff);
    text_center(cx, 648 * S, 2.4f * S, "R: CENTRAR   -: GIROSCOPIO SÍ/NO   X: INVERTIR GIRO   Y: VIBRACIÓN   +: SALIR", 0xffffff);
#else
    text_center(cx, 630 * S, 2.6f * S, "FLECHAS O A/D PARA GIRAR   P/ESC: PAUSA   V: VIBRACIÓN   Q: SALIR", 0xffffff);
#endif
    /* modo: ◀ ARCADE ▶ (cruceta o palanca para cambiar) */
    {
      int m;
      for (m = 0; m < 2; m++) {
        float bx = cx + (m == 0 ? -170 : 170) * S, on = m == modeSel;
        float tw = hud_text_w(3.4f * S, MODE_NAME[m]), bw = tw + 50 * S;
        hud_rect(bx - bw / 2, 482 * S, bw, 50 * S, 25 * S, on ? 0xffd24a : 0x3b2a6b, on ? 1 : 0.7f);
        hud_text(bx - tw / 2, 495 * S, 3.4f * S, MODE_NAME[m], on ? INK : 0xffffff, 1);
      }
      text_center(cx, 497 * S, 3.4f * S, "< >", 0xffffff);
      if (best2[modeSel] > 0) { snprintf(buf, sizeof buf, modeSel == 0 ? "RÉCORD %d PUNTOS" : "RÉCORD %d", best2[modeSel]); text_center(cx, 548 * S, 2.8f * S, buf, 0xffd24a); }
      else text_center(cx, 548 * S, 2.6f * S, modeSel == 0 ? "MÁS RÁPIDO, SIN ACAMPAR Y RACHA X5" : "BOOST 2 TAL CUAL", 0xfff1c9);
    }
    /* inclinación: barra con el punto donde está ahora (para ver el sentido del giroscopio) */
    if (input.hasTilt && input.tiltOn) {
      double v = (input.tiltRaw - input.cal) * (input.invert ? -1 : 1) * 2.5;
      float bw = 300 * S, bx = cx - bw / 2, y = 585 * S;
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      hud_rect(bx, y, bw, 10 * S, 5 * S, 0x3b2a6b, 0.8f);
      hud_rect(cx - 2 * S, y - 4 * S, 4 * S, 18 * S, 0, 0xffffff, 0.8f);
      hud_rect(cx + (float)v * bw / 2 - 9 * S, y - 4 * S, 18 * S, 18 * S, 9 * S, 0x22d08a, 1);
    }
  } else {
    /* monedas (arriba a la izquierda) */
    snprintf(buf, sizeof buf, "%d", coins);
    hud_rect(90 * S, 23 * S, (60 + hud_text_w(3.4f * S, buf) / S) * S, 43 * S, 21 * S, 0x3b2a6b, 0.78f);
    hud_rect(98 * S, 30 * S, 29 * S, 29 * S, 14.5f * S, 0xb86a00, 1);
    hud_rect(100 * S, 32 * S, 25 * S, 25 * S, 12.5f * S, 0xffc21a, 1);
    hud_text(136 * S, 33 * S, 3.4f * S, buf, 0xffffff, 1);
    /* distancia y velocidad (arriba a la derecha) */
    snprintf(buf, sizeof buf, "%d", (int)game_distance_m(&game));
    {
      float mw = hud_text_w(4 * S, "M");
      text_right(W - 22 * S - mw - 6 * S, 16 * S, 6.2f * S, buf, 0xffffff);
      text_shadow(W - 22 * S - mw, 31 * S, 4 * S, "M", 0xffffff);
    }
    snprintf(buf, sizeof buf, "%d KM/H", (int)floor(game_speed_ms(&game) * 3.6 + 0.5));
    {
      float tw = hud_text_w(2.6f * S, buf);
      hud_rect(W - 22 * S - tw - 20 * S, 69 * S, tw + 20 * S, 26 * S, 13 * S, 0x3b2a6b, 0.78f);
      hud_text(W - 22 * S - tw - 10 * S, 73 * S, 2.6f * S, buf, 0xffffff, 1);
    }
    if (playMode == 0) {
      static const unsigned mc[6] = { 0, 0x3b2a6b, 0xe0600f, 0xd6307f, 0x8a3fe0, 0xff3d57 };
      snprintf(buf, sizeof buf, "X%d", mult);
      { float tw = hud_text_w(4.6f * S, buf); hud_rect(W - 22 * S - tw - 24 * S, 104 * S, tw + 24 * S, 46 * S, 14 * S, mc[mult], 0.92f); hud_text(W - 22 * S - tw - 12 * S, 113 * S, 4.6f * S, buf, 0xffffff, 1); }
      snprintf(buf, sizeof buf, "%d PTS", (int)(points + coins * 10));
      text_right(W - 22 * S, 158 * S, 2.6f * S, buf, 0xffffff);
    }
    /* impulsos: 3 chevrones (abajo a la derecha) */
    {
      int i;
      static const unsigned full[3] = { 0x7ee06a, 0x4fe0a0, 0x49d6ff };
      for (i = 0; i < 3; i++) {
        float x = W - (180 - i * 50) * S, y = H - 52 * S;
        int on = i < game.level;
        chevron(x + 3 * S, y + 4 * S, 46 * S, 16 * S, INK, on ? 0.9f : 0.35f);
        chevron(x, y, 46 * S, 16 * S, on ? full[game.level - 1] : 0xc9c6d8, on ? 1 : 0.75f);
      }
    }
    if (state == ST_COUNTDOWN) {
      int n = (int)ceil(countdown);
      snprintf(buf, sizeof buf, "%d", n);
      text_center(cx, 260 * S, 22 * S, buf, 0xffffff);
    }
    if (state == ST_PAUSED) {
      hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.45f);
      text_center(cx, 250 * S, 10 * S, "PAUSA", 0xffffff);
#ifdef __SWITCH__
      text_center(cx, 400 * S, 3.5f * S, "+: SEGUIR    B: MENÚ", 0xffffff);
#else
      text_center(cx, 400 * S, 3.5f * S, "P/ESC: SEGUIR    Q: MENÚ", 0xffffff);
#endif
    }
    if (state == ST_OVER) {
      float pw = 660 * S, ph = 380 * S, px = cx - pw / 2, py = 150 * S;
      hud_rect(0, 0, (float)W, (float)H, 0, 0x1b1440, 0.35f * (float)(overT * 3 < 1 ? overT * 3 : 1));
      hud_rect(px + 8 * S, py + 8 * S, pw, ph, 36 * S, INK, 0.9f);
      hud_rect(px, py, pw, ph, 36 * S, 0xfffaf2, 1);
      hud_text(cx - hud_text_w(7 * S, "¡CATAPUM!") / 2, py + 34 * S, 7 * S, "¡CATAPUM!", 0xff3d57, 1);
      snprintf(buf, sizeof buf, "%d M", lastDist);
      hud_text(cx - hud_text_w(8 * S, buf) / 2, py + 110 * S, 8 * S, buf, INK, 1);
      if (playMode == 0) snprintf(buf, sizeof buf, "ARCADE   PUNTOS %d   RACHA MÁX X%d", lastScore, maxMult);
      else snprintf(buf, sizeof buf, "CLÁSICO   MONEDAS %d   PUNTOS %d", coins, lastScore);
      hud_text(cx - hud_text_w(3.2f * S, buf) / 2, py + 196 * S, 3.2f * S, buf, 0x6a4a78, 1);
      if (isRecord) snprintf(buf, sizeof buf, "¡NUEVO RÉCORD!");
      else snprintf(buf, sizeof buf, playMode == 0 ? "RÉCORD %d PUNTOS" : "RÉCORD %d", best);
      hud_text(cx - hud_text_w(3.6f * S, buf) / 2, py + 240 * S, 3.6f * S, buf, isRecord ? 0xff8a1a : 0x6a4a78, 1);
#ifdef __SWITCH__
      snprintf(buf, sizeof buf, "A: OTRA VEZ    B: MENÚ");
#else
      snprintf(buf, sizeof buf, "ENTER: OTRA VEZ    ESC: MENÚ");
#endif
      if (overT > 0.6) {
        float tw = hud_text_w(3.2f * S, buf), bw = tw + 60 * S;
        hud_rect(cx - bw / 2, py + 296 * S, bw, 56 * S, 28 * S, 0x22d08a, 1);
        hud_text(cx - tw / 2, py + 313 * S, 3.2f * S, buf, 0xffffff, 1);
      }
    }
  }
  if (toastT > 0 && state != ST_ATTRACT) {
    float px = 3.2f * S, tw = hud_text_w(px, toastText), a = (float)(toastT < 0.3 ? toastT / 0.3 : 1);
    hud_rect(cx - tw / 2 - 20 * S + 4 * S, 110 * S + 4 * S, tw + 40 * S, 44 * S, 22 * S, INK, 0.8f * a);
    hud_rect(cx - tw / 2 - 20 * S, 110 * S, tw + 40 * S, 44 * S, 22 * S, 0xfffaf2, 0.95f * a);
    hud_text(cx - tw / 2, 122 * S, px, toastText, toastCol == 0xffffff ? INK : 0x2f5fff, a);
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
