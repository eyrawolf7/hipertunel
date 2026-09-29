/* Sonido del port nativo: un sintetizador pequeño sobre el callback de audio de SDL2, en la línea
 * de app/src/audio/ (regla 7: melodía agradable y turbina suave; nada de zumbidos ni secador).
 * - Música: progresión I–vi–IV–V con arpegio de triángulo, bajo y un colchón suave.
 * - Turbina: dos senos graves ligeramente desafinados que suben con la velocidad, más un soplido
 *   filtrado muy bajo a toda velocidad.
 * - Efectos: voces cortas (seno, triángulo o ruido filtrado) con barrido de frecuencia y envolvente.
 * Todo se genera en el hilo de audio; los disparos se protegen con SDL_LockAudioDevice. */
#include <SDL.h>
#include <math.h>
#include <string.h>
#include "audio.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define RATE 48000
#define NV 24

typedef struct { int on, wave, bus; double t, dur, f0, f1, amp, ph, a, lp; } Voice;   /* wave: 0 seno, 1 triángulo, 2 ruido; bus: 0 efectos, 1 música */

static SDL_AudioDeviceID dev;
static Voice vo[NV];
static double speed01, engineOn, musicOn = 1, sfxOn = 1, duck = 1, duckT;
static double engPh1, engPh2, engPh3, whLp, musT;
static int musStep = -1;
static unsigned rngS = 12345;

static double frand(void) { rngS = rngS * 1664525u + 1013904223u; return (rngS >> 8) / 8388608.0 - 1.0; }
static double mtof(double m) { return 440.0 * pow(2.0, (m - 69) / 12.0); }

static int curBus;
static void voice(int wave, double f0, double f1, double dur, double amp, double a, double delay) {
  int i;
  for (i = 0; i < NV; i++) if (!vo[i].on) break;
  if (i == NV) i = 0;
  vo[i].on = 1; vo[i].wave = wave; vo[i].t = -delay; vo[i].dur = dur; vo[i].f0 = f0; vo[i].f1 = f1;
  vo[i].amp = amp; vo[i].ph = 0; vo[i].a = a; vo[i].lp = 0; vo[i].bus = curBus;
}

/* ---- música: 4 compases de 4 tiempos a 104 ppm, arpegio en corcheas */
static const int CHORDS[4][3] = { { 60, 64, 67 }, { 57, 60, 64 }, { 53, 57, 60 }, { 55, 59, 62 } };
static const int ARP[8] = { 0, 1, 2, 1, 0, 2, 1, 2 };
static void music_tick(void) {
  int bar = (musStep / 8) % 4, st = musStep % 8;
  const int *c = CHORDS[bar];
  curBus = 1;
  voice(1, mtof(c[ARP[st]] + 12), mtof(c[ARP[st]] + 12), 0.26, 0.05, 0.004, 0);
  if (st == 0) { voice(1, mtof(c[0] - 12), mtof(c[0] - 12), 1.1, 0.07, 0.01, 0); voice(0, mtof(c[1]), mtof(c[1]), 2.2, 0.025, 0.25, 0); voice(0, mtof(c[2]), mtof(c[2]), 2.2, 0.02, 0.25, 0); }
  if (st == 4) voice(1, mtof(c[0] - 12), mtof(c[0] - 12), 0.5, 0.05, 0.01, 0);
  curBus = 0;
}

static void callback(void *ud, Uint8 *stream, int len) {
  float *out = (float *)stream;
  int n = len / (int)(sizeof(float) * 2), i, j;
  const double dt = 1.0 / RATE, stepS = 60.0 / 104 / 2;
  (void)ud;
  for (i = 0; i < n; i++) {
    double s = 0, mus = 0, f, e;
    /* música */
    if (musicOn) {
      musT += dt;
      if (musT >= stepS || musStep < 0) { musT = musStep < 0 ? 0 : musT - stepS; musStep++; music_tick(); }
    }
    /* voces */
    for (j = 0; j < NV; j++) {
      Voice *v = &vo[j];
      double x, k, env;
      if (!v->on) continue;
      v->t += dt;
      if (v->t < 0) continue;
      if (v->t >= v->dur) { v->on = 0; continue; }
      k = v->t / v->dur;
      f = v->f0 * pow(v->f1 / v->f0, k);
      v->ph += f * dt;
      if (v->wave == 0) x = sin(2 * M_PI * v->ph);
      else if (v->wave == 1) { double p = v->ph - floor(v->ph); x = 4 * fabs(p - 0.5) - 1; }
      else { double w = frand(); double c = 1 - exp(-2 * M_PI * f / RATE); v->lp += c * (w - v->lp); x = v->lp * 2.2; }
      env = v->t < v->a ? v->t / v->a : pow(1 - (v->t - v->a) / (v->dur - v->a + 1e-9), 2);
      /* las voces de música van por su propio bus (se atenúan con los efectos) */
      if (v->bus) mus += x * env * v->amp; else s += x * env * v->amp * sfxOn;
    }
    /* turbina */
    if (engineOn > 0.001) {
      double base = 52 + 60 * speed01, a = engineOn * (0.05 + 0.035 * speed01);
      engPh1 += base * dt; engPh2 += base * 1.007 * dt; engPh3 += base * 2.0 * dt;
      e = (sin(2 * M_PI * engPh1) + sin(2 * M_PI * engPh2)) * 0.5 + 0.25 * sin(2 * M_PI * engPh3);
      whLp += 0.02 * (frand() - whLp);
      s += (e * a + whLp * 0.35 * speed01 * speed01 * engineOn) * sfxOn;
    }
    if (duckT > 0) duckT -= dt; else duck += (1 - duck) * 0.0005;
    s += mus * duck * musicOn;
    s = tanh(s * 1.4) * 0.8;
    out[i * 2] = out[i * 2 + 1] = (float)s;
  }
}

void au_init(void) {
  SDL_AudioSpec want, have;
  if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0) return;
  memset(&want, 0, sizeof want);
  want.freq = RATE; want.format = AUDIO_F32SYS; want.channels = 2; want.samples = 1024; want.callback = callback;
  dev = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
  if (dev) SDL_PauseAudioDevice(dev, 0);
}
void au_quit(void) { if (dev) SDL_CloseAudioDevice(dev); dev = 0; }

void au_set(double sp01, int engine, int music) {
  if (!dev) return;
  SDL_LockAudioDevice(dev);
  speed01 = sp01 < 0 ? 0 : sp01 > 1 ? 1 : sp01;
  engineOn += ((engine ? 1 : 0) - engineOn) * 0.1;
  musicOn = music;
  SDL_UnlockAudioDevice(dev);
}
void au_pause(int p) { if (dev) SDL_PauseAudioDevice(dev, p); }

void au_play(AuSound snd, int arg) {
  if (!dev) return;
  SDL_LockAudioDevice(dev);
  switch (snd) {
    case AU_COIN: { double b = 1320 * pow(2, (arg > 6 ? 6 : arg) / 12.0); voice(0, b, b, 0.06, 0.16, 0.003, 0); voice(0, b * 1.5, b * 1.5, 0.12, 0.14, 0.003, 0.05); } break;
    case AU_BOOST: voice(1, 280 + arg * 60, 900 + arg * 150, 0.35, 0.22, 0.01, 0); voice(2, 1200, 4000, 0.4, 0.12, 0.02, 0); duck = 0.6; duckT = 0.4; break;
    case AU_CRASH: voice(2, 900, 150, 0.35, 0.5, 0.002, 0); voice(0, 120, 45, 0.3, 0.35, 0.003, 0); duck = 0.4; duckT = 0.5; break;
    case AU_DEATH: voice(2, 700, 90, 0.7, 0.55, 0.002, 0); voice(1, 330, 80, 0.9, 0.2, 0.01, 0.05); duck = 0.2; duckT = 1.2; break;
    case AU_NEAR: voice(2, 3200, 900, 0.2, 0.18, 0.01, 0); break;
    case AU_COUNT: voice(1, 660, 660, 0.12, 0.2, 0.004, 0); break;
    case AU_GO: voice(1, 990, 990, 0.3, 0.22, 0.004, 0); voice(1, 1320, 1320, 0.3, 0.12, 0.004, 0.02); break;
    case AU_WORLD: { int k; static const int iv[4] = { 0, 4, 7, 12 }; for (k = 0; k < 4; k++) voice(0, mtof(79 + iv[k]), mtof(79 + iv[k]), 0.5, 0.1, 0.005, k * 0.08); } break;
    case AU_RECORD: { int k; static const int iv[6] = { 0, 4, 7, 12, 7, 12 }; for (k = 0; k < 6; k++) voice(1, mtof(72 + iv[k]), mtof(72 + iv[k]), 0.2, 0.12, 0.005, k * 0.1); } break;
    case AU_MENU: voice(1, 880, 880, 0.05, 0.12, 0.003, 0); break;
    case AU_MULT: voice(0, mtof(76 + arg * 2), mtof(83 + arg * 2), 0.14, 0.14, 0.004, 0); break;
    case AU_FOLD: voice(0, 90, 60, 1.2, 0.18, 0.2, 0); break;
  }
  SDL_UnlockAudioDevice(dev);
}
