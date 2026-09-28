/* Capa de dibujo: port de app/src/render/index.js y compañía (ver render.h).
 * Las posiciones se calculan en double (como Three) y se suben a la GPU relativas a la cámara,
 * así no se pierde precisión a 40 km del origen. */
#include "render.h"
#include "glmini.h"
#include "shaders.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define DEG (M_PI / 180)

/* ---------------------------------------------------------------- colores */
typedef struct { float r, g, b; } C3;
static float srgb2lin(float c) { return c <= 0.04045f ? c / 12.92f : powf((c + 0.055f) / 1.055f, 2.4f); }
static C3 hexc(unsigned h) {   /* THREE.Color.set(hex): de sRGB a lineal */
  C3 c; c.r = srgb2lin(((h >> 16) & 255) / 255.f); c.g = srgb2lin(((h >> 8) & 255) / 255.f); c.b = srgb2lin((h & 255) / 255.f); return c;
}
static C3 clerp(C3 a, C3 b, float t) { C3 c; c.r = a.r + (b.r - a.r) * t; c.g = a.g + (b.g - a.g) * t; c.b = a.b + (b.b - a.b) * t; return c; }
static C3 cscale(C3 a, float s) { a.r *= s; a.g *= s; a.b *= s; return a; }

/* ---------------------------------------------------------------- mundos (worlds.js) */
typedef struct {
  const char *name;
  unsigned base, base2, seam, fog, glow, skyTop, skyMid, skyBot, sun;
  float stars; int dark; unsigned inv;
} Theme;
static const Theme THEMES[] = {
  { "Cielo", 0xfffaf2, 0xd4d0e6, 0x2a2350, 0xffe2c0, 0xffd27a, 0x2f7fff, 0x8fc8ff, 0xfff3e0, 0xfff2c8, 0, 0, 0 },
  { "Atardecer", 0xfbe9e0, 0xe9d3d6, 0x6a4a78, 0xff9c86, 0xffb27a, 0x5b3fb8, 0xff8f8f, 0xffd6a0, 0xffb060, 0.15f, 0, 0 },
  { "Noche de neón", 0xf4f2fb, 0xd9d7e6, 0x3a3170, 0x2b1f63, 0xff6ad5, 0x07051f, 0x2d1670, 0x8a3bb8, 0xff9ae8, 1, 1, 0x1a1236 },
  { "Aurora", 0xf5fbf8, 0xdde6e3, 0x2e5a5f, 0x0f3342, 0x3fe0a0, 0x020d1c, 0x0f4d5a, 0x3fb8a0, 0xc8fff0, 1, 1, 0x0b2a2e },
  { "Caramelo", 0xfdeaf3, 0xeed8e6, 0x7a4a6c, 0xff9fd0, 0xff9ecf, 0x7ec8ff, 0xffd0ea, 0xfff6e0, 0xfff8e0, 0, 0, 0 },
  { "Galaxia", 0xf5f3fb, 0xdcd9e8, 0x3a3270, 0x120c33, 0xc58bff, 0x03010f, 0x1b0f45, 0x4b2b8f, 0xffe6ff, 1, 1, 0x150c2e },
};
#define NTHEMES 6
static const unsigned HUES[6] = { 0xff3d57, 0xffc21a, 0xff5fb4, 0xff8a1a, 0xa05cff, 0x22d08a };
static C3 COLORS[10];

/* ---------------------------------------------------------------- GL: programas y mallas */
static int gles;
static GLuint compile(GLenum type, const char *body) {
  const char *pre = gles ? "#version 300 es\nprecision highp float;\n" : "#version 330 core\n";
  const char *src[2]; GLuint s; GLint ok;
  src[0] = pre; src[1] = body;
  s = glCreateShader(type);
  glShaderSource(s, 2, src, NULL);
  glCompileShader(s);
  glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[4096]; glGetShaderInfoLog(s, sizeof log, NULL, log); fprintf(stderr, "sombreador:\n%s\n", log); }
  return s;
}
/* atributos fijos: 0..4 */
static GLuint program(const char *vs, const char *fs, const char *const *attrs) {
  GLuint p = glCreateProgram(), a = compile(GL_VERTEX_SHADER, vs), b = compile(GL_FRAGMENT_SHADER, fs);
  GLint ok; int i;
  glAttachShader(p, a); glAttachShader(p, b);
  for (i = 0; attrs[i]; i++) glBindAttribLocation(p, (GLuint)i, attrs[i]);
  glLinkProgram(p);
  glGetProgramiv(p, GL_LINK_STATUS, &ok);
  if (!ok) { char log[4096]; glGetProgramInfoLog(p, sizeof log, NULL, log); fprintf(stderr, "enlace:\n%s\n", log); return 0; }
  glDeleteShader(a); glDeleteShader(b);
  return p;
}
/* caché de posiciones de uniforms (clave: programa + puntero del literal) */
static struct { GLuint p; const char *n; GLint loc; } ucache[256]; static int nucache;
static GLint U(GLuint p, const char *n) {
  int i;
  for (i = 0; i < nucache; i++) if (ucache[i].p == p && ucache[i].n == n) return ucache[i].loc;
  if (nucache < 256) { ucache[nucache].p = p; ucache[nucache].n = n; ucache[nucache].loc = glGetUniformLocation(p, n); return ucache[nucache++].loc; }
  return glGetUniformLocation(p, n);
}
static void u1(GLuint p, const char *n, float a) { glUniform1f(U(p, n), a); }
static void u2(GLuint p, const char *n, float a, float b) { glUniform2f(U(p, n), a, b); }
static void u3(GLuint p, const char *n, float a, float b, float c) { glUniform3f(U(p, n), a, b, c); }
static void uc(GLuint p, const char *n, C3 c) { glUniform3f(U(p, n), c.r, c.g, c.b); }
static void uv(GLuint p, const char *n, V3 v) { glUniform3f(U(p, n), (float)v.x, (float)v.y, (float)v.z); }
static void um(GLuint p, const char *n, const M4 *m) { glUniformMatrix4fv(U(p, n), 1, GL_FALSE, m->m); }

typedef struct { GLuint vao, vbo, ibo; int nIdx; } Mesh;

static Mesh mesh_upload(const float *v, int nv, const unsigned short *idx, int ni) {
  Mesh m;
  glGenVertexArrays(1, &m.vao); glBindVertexArray(m.vao);
  glGenBuffers(1, &m.vbo); glBindBuffer(GL_ARRAY_BUFFER, m.vbo);
  glBufferData(GL_ARRAY_BUFFER, (GLsizeiptr)(nv * 6 * sizeof(float)), v, GL_STATIC_DRAW);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 24, (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 24, (void *)12);
  glGenBuffers(1, &m.ibo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m.ibo);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, (GLsizeiptr)(ni * 2), idx, GL_STATIC_DRAW);
  m.nIdx = ni;
  glBindVertexArray(0);
  return m;
}

/* cubo redondeado de lado 1 (RoundedBoxGeometry(1, 1, 1, 3, 0.14)) */
static Mesh make_rounded_box(void) {
  static const float co[11] = { -0.5f, -0.465f, -0.43f, -0.395f, -0.36f, 0.0f, 0.36f, 0.395f, 0.43f, 0.465f, 0.5f };
  static const int F[6][3][3] = {
    { {1,0,0}, {0,1,0}, {0,0,1} }, { {-1,0,0}, {0,0,1}, {0,1,0} },
    { {0,1,0}, {0,0,1}, {1,0,0} }, { {0,-1,0}, {1,0,0}, {0,0,1} },
    { {0,0,1}, {1,0,0}, {0,1,0} }, { {0,0,-1}, {0,1,0}, {1,0,0} } };
  static float v[6 * 121 * 6]; static unsigned short idx[6 * 100 * 6];
  const float r = 0.14f, in = 0.5f - 0.14f;
  int f, i, j, nv = 0, ni = 0;
  for (f = 0; f < 6; f++) {
    int base = nv;
    for (j = 0; j < 11; j++) for (i = 0; i < 11; i++) {
      float p[3], q[3], d[3], l; int a;
      for (a = 0; a < 3; a++) p[a] = F[f][0][a] * 0.5f + F[f][1][a] * co[i] + F[f][2][a] * co[j];
      for (a = 0; a < 3; a++) { q[a] = p[a] < -in ? -in : p[a] > in ? in : p[a]; d[a] = p[a] - q[a]; }
      l = sqrtf(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      for (a = 0; a < 3; a++) { d[a] /= l; v[nv * 6 + a] = q[a] + d[a] * r; v[nv * 6 + 3 + a] = d[a]; }
      nv++;
    }
    for (j = 0; j < 10; j++) for (i = 0; i < 10; i++) {
      unsigned short a = (unsigned short)(base + j * 11 + i), b = (unsigned short)(a + 1), c = (unsigned short)(a + 12), d = (unsigned short)(a + 11);
      idx[ni++] = a; idx[ni++] = b; idx[ni++] = c; idx[ni++] = a; idx[ni++] = c; idx[ni++] = d;
    }
  }
  return mesh_upload(v, nv, idx, ni);
}

/* moneda: cilindro de radio 0,45 y grosor 0,13 con el eje en Z, con un canto biselado */
static Mesh make_coin(void) {
  enum { S = 40 };
  static float v[(S + 1) * 12 * 6]; static unsigned short idx[S * 60];
  int i, nv = 0, ni = 0;
  const float R0 = 0.45f, R1 = 0.40f, H0 = 0.065f, H1 = 0.04f;
  /* perfil: centro delantero, borde interior delantero, bisel, canto, bisel, trasero */
  for (i = 0; i <= S; i++) {
    float a = (float)i / S * 6.2831853f, c = cosf(a), s = sinf(a);
    float prof[6][4] = { { R1, H0, 0, 1 }, { R0, H1, 0.7f, 0.7f }, { R0, -H1, 0.7f, -0.7f }, { R1, -H0, 0, -1 }, { 0, H0, 0, 1 }, { 0, -H0, 0, -1 } };
    int k;
    for (k = 0; k < 6; k++) {
      float *o = &v[nv * 6];
      o[0] = prof[k][0] * c; o[1] = prof[k][0] * s; o[2] = prof[k][1];
      o[3] = prof[k][2] * c; o[4] = prof[k][2] * s; o[5] = prof[k][3];
      nv++;
    }
  }
  for (i = 0; i < S; i++) {
    unsigned short a = (unsigned short)(i * 6), b = (unsigned short)((i + 1) * 6);
    /* cara delantera */
    idx[ni++] = (unsigned short)(a + 4); idx[ni++] = a; idx[ni++] = b;
    /* bisel delantero, canto, bisel trasero */
    idx[ni++] = a; idx[ni++] = (unsigned short)(a + 1); idx[ni++] = (unsigned short)(b + 1); idx[ni++] = a; idx[ni++] = (unsigned short)(b + 1); idx[ni++] = b;
    idx[ni++] = (unsigned short)(a + 1); idx[ni++] = (unsigned short)(a + 2); idx[ni++] = (unsigned short)(b + 2); idx[ni++] = (unsigned short)(a + 1); idx[ni++] = (unsigned short)(b + 2); idx[ni++] = (unsigned short)(b + 1);
    idx[ni++] = (unsigned short)(a + 2); idx[ni++] = (unsigned short)(a + 3); idx[ni++] = (unsigned short)(b + 3); idx[ni++] = (unsigned short)(a + 2); idx[ni++] = (unsigned short)(b + 3); idx[ni++] = (unsigned short)(b + 2);
    /* cara trasera */
    idx[ni++] = (unsigned short)(a + 5); idx[ni++] = (unsigned short)(b + 3); idx[ni++] = (unsigned short)(a + 3);
  }
  return mesh_upload(v, nv, idx, ni);
}

static Mesh make_plane(void) {   /* plano XZ de lado 1 (placas) */
  static const float v[] = { -0.5f,0,-0.5f, 0,1,0,  0.5f,0,-0.5f, 0,1,0,  0.5f,0,0.5f, 0,1,0,  -0.5f,0,0.5f, 0,1,0 };
  static const unsigned short idx[] = { 0, 1, 2, 0, 2, 3 };
  return mesh_upload(v, 4, idx, 6);
}
static Mesh make_fullscreen(void) {
  static const float v[] = { -1,-1,0, 0,0,1,  3,-1,0, 0,0,1,  -1,3,0, 0,0,1 };
  static const unsigned short idx[] = { 0, 1, 2 };
  return mesh_upload(v, 3, idx, 3);
}

/* ---------------------------------------------------------------- túnel: VBO dinámico */
#define NQ ((ROWS + 4) * LANES)
#define TV 14   /* floats por vértice: pos3 n3 uv2 warn4 cell2 */
static float tunV[NQ * 4 * TV];
static GLuint tunVao, tunVbo, tunIbo; static int tunQuads;

static void tunnel_gl_init(void) {
  static unsigned short idx[NQ * 6];
  int q;
  for (q = 0; q < NQ; q++) {
    unsigned short v = (unsigned short)(q * 4);
    idx[q * 6] = v; idx[q * 6 + 1] = (unsigned short)(v + 1); idx[q * 6 + 2] = (unsigned short)(v + 2);
    idx[q * 6 + 3] = v; idx[q * 6 + 4] = (unsigned short)(v + 2); idx[q * 6 + 5] = (unsigned short)(v + 3);
  }
  glGenVertexArrays(1, &tunVao); glBindVertexArray(tunVao);
  glGenBuffers(1, &tunVbo); glBindBuffer(GL_ARRAY_BUFFER, tunVbo);
  glBufferData(GL_ARRAY_BUFFER, sizeof tunV, NULL, GL_DYNAMIC_DRAW);
  glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, TV * 4, (void *)0);
  glEnableVertexAttribArray(1); glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, TV * 4, (void *)12);
  glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, TV * 4, (void *)24);
  glEnableVertexAttribArray(3); glVertexAttribPointer(3, 4, GL_FLOAT, GL_FALSE, TV * 4, (void *)32);
  glEnableVertexAttribArray(4); glVertexAttribPointer(4, 2, GL_FLOAT, GL_FALSE, TV * 4, (void *)48);
  glGenBuffers(1, &tunIbo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, tunIbo);
  glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof idx, idx, GL_STATIC_DRAW);
  glBindVertexArray(0);
}

/* ---------------------------------------------------------------- estado */
typedef struct { M4 m; V3 scale; C3 col; float glow; int flat; } BoxDraw;
typedef struct { M4 m; float alpha; int main; } PadDraw;
typedef struct { V3 p, v; double t; } Flying;

static struct {
  int w, h; double aspect, baseFov, fov;
  GLuint pTun, pBox, pCoin, pPad, pSky, pFlash, pHud;
  Mesh box, coin, plane, full;
  Track tr;
  double time;
  /* cámara */
  V3 look, upS, pos, origin, camX, camY, camZ; int firstFrame;
  double shake, shakeDecay, kick, kickAmp, roll, rollAmp, flash, invert, hit, foldFov, blueVig, lean, deathT, landT;
  C3 flashCol; int flashHex;
  int deathFocusOn; V3 deathFocus;
  int landed, wasFlying;
  /* mundos */
  int themeIdx, themeFrom, pendingTheme; double themeBlend;
  C3 uBase, uBase2, uSeam, uFog, uGlow, uInvBase, uRing, themeFog, themeGlow, skyTop, skyMid, skyBot, sun, seaA, seaB, seaFog;
  float uDark, stars;
  /* uniforms del túnel con memoria */
  double fogFar, fogNear, outside, tunTime;
  double laneGlow[LANES];
  V3 key;
  float hemiI;
  /* cajas */
  BoxDraw boxes[40]; int nBoxDraw;
  struct { int id; double g; } glowBy[128]; int nGlow;
  struct { int id; V3 p; } boxPos[40]; int nBoxPos;
  /* placas */
  PadDraw pads[4 * 7 * 6]; int nPadDraw; double padTime;
  /* monedas */
  M4 coinM[160]; int nCoinDraw; double coinTime;
  Flying flying[16]; int nFlying;
  /* cielo */
  double skyVis, skyTime, seaTime; V3 skyUp; int skyOn, seaOn; float seaAlpha;
  float satAmt;
} R;

static double frand(void) { return rand() / (double)RAND_MAX; }

Track *rn_track(void) { return &R.tr; }

static void apply_theme(int from, int to, double t) {
  const Theme *A = &THEMES[from % NTHEMES], *B = &THEMES[to % NTHEMES];
  float tf = (float)t;
  int night;
#define TL(field) clerp(hexc(A->field), hexc(B->field), tf)
  R.uBase = TL(base); R.uBase2 = TL(base2); R.uSeam = TL(seam); R.uFog = TL(fog); R.uGlow = TL(glow);
  R.uDark = A->dark + (B->dark - A->dark) * tf;
  R.uInvBase = clerp(hexc(A->inv ? A->inv : 0x13112a), hexc(B->inv ? B->inv : 0x13112a), tf);
  R.skyTop = TL(skyTop); R.skyMid = TL(skyMid); R.skyBot = TL(skyBot); R.sun = TL(sun);
#undef TL
  R.stars = A->stars + (B->stars - A->stars) * tf;
  night = R.stars > 0.5f;
  R.seaA = clerp(R.skyBot, hexc(0xffffff), night ? 0.25f : 0.85f);
  R.seaB = cscale(clerp(R.skyMid, R.skyBot, 0.5f), night ? 0.7f : 0.95f);
  R.seaFog = R.skyMid;
  R.themeFog = R.uFog; R.themeGlow = R.uGlow;
}

static double fov_for(double aspect) {
  double h = 112 * DEG, v = 2 * atan(tan(h / 2) / aspect) / DEG;
  return v < 60 ? 60 : v > 90 ? 90 : v;
}

void rn_resize(int w, int h) {
  R.w = w; R.h = h; R.aspect = (double)w / h;
  R.baseFov = fov_for(R.aspect); R.fov = R.baseFov;
}

void rn_reset(void) {
  track_reset(&R.tr);
  R.shake = R.kick = R.roll = R.rollAmp = 0;
  R.deathFocusOn = 0; R.themeIdx = 0; R.pendingTheme = 0; R.themeBlend = 1; R.themeFrom = 0;
  apply_theme(0, 0, 1);
  R.look = v3(0, 0, -1); R.upS = v3(0, 1, 0); R.firstFrame = 1;
  R.nFlying = 0; R.nGlow = 0; R.nBoxPos = 0;
}

int rn_init(int es) {
  static const char *const aTun[] = { "aPos", "aN", "aUv", "aWarn", "aCell", NULL };
  static const char *const aMesh[] = { "aPos", "aNrm", NULL };
  static const char *const aHud[] = { "aPos", "aCol", "aLocal", "aBox", NULL };
  int i;
  gles = es;
  memset(&R, 0, sizeof R);
  for (i = 0; i < 10; i++) COLORS[i] = hexc(HUES[i % 6]);
  R.pTun = program(VS_TUNNEL, FS_TUNNEL, aTun);
  R.pBox = program(VS_BOX, FS_BOX, aMesh);
  R.pCoin = program(VS_BOX, FS_COIN, aMesh);
  R.pPad = program(VS_PAD, FS_PAD, aMesh);
  R.pSky = program(VS_SKY, FS_SKY, aMesh);
  R.pFlash = program(VS_SKY, FS_FLASH, aMesh);
  R.pHud = program(VS_HUD, FS_HUD, aHud);
  if (!R.pTun || !R.pBox || !R.pCoin || !R.pPad || !R.pSky || !R.pFlash || !R.pHud) return 1;
  R.box = make_rounded_box(); R.coin = make_coin(); R.plane = make_plane(); R.full = make_fullscreen();
  tunnel_gl_init();
  R.fogFar = 118; R.fogNear = 40; R.skyUp = v3(0, 1, 0); R.hemiI = 1; R.satAmt = 1.08f;
  R.kickAmp = 1;
  rn_resize(1280, 720);
  rn_reset();
  return 0;
}

int rn_consume_landing(void) { int l = R.landed; R.landed = 0; return l; }

static void flash(unsigned hex, double a) { R.flashHex = (int)hex; if (a > R.flash) R.flash = a; }

/* ---------------------------------------------------------------- sucesos */
static const Box *find_box(const Game *g, int id) { int i; for (i = 0; i < g->nBoxes; i++) if (g->boxes[i].id == id) return &g->boxes[i]; return NULL; }

void rn_events(const Game *g) {
  int i;
  for (i = 0; i < g->nEvents; i++) {
    const Event *e = &g->events[i];
    if (e->type == EV_BOOST) {
      static const double amp[4] = { 0, 0.75, 1, 1.35 };
      R.kick = 1; R.kickAmp = e->level >= 1 && e->level <= 3 ? amp[e->level] : 1;
      R.rollAmp = (frand() * 2 - 1) * 0.127; R.roll = 1;
      if (e->level == 3) R.blueVig = 0.15;
    } else if (e->type == EV_CRASH) {
      const Box *b = find_box(g, e->id);
      int j, have = 0; V3 p = v3(0, 0, 0);
      unsigned hex = HUES[(b ? b->color : 0) % 6];
      for (j = 0; j < R.nBoxPos; j++) if (R.boxPos[j].id == e->id) { p = R.boxPos[j].p; have = 1; }
      R.shake = 0.5; R.shakeDecay = 1.4;
      if (e->fatal) { flash(0xff3040, 0.55); R.deathFocusOn = have; R.deathFocus = p; }
      else flash(hex, 0.3);
      R.hit = 1;
    } else if (e->type == EV_COIN) {
      /* la moneda cogida sale disparada hacia arriba desde donde estaba */
      Section sec; Surf sp; Frame fr; V3 N; Flying *f;
      int closed = g->fold == 30 || g->fold == -30;
      if (R.nFlying >= 16) continue;
      track_section(g->fold, &sec);
      track_frame_at(&R.tr, e->k - 0.5, &fr); track_surf(&sec, e->lane, closed, &sp);
      N = vadd(vscale(fr.X, sp.nx), vscale(fr.U, sp.ny));
      f = &R.flying[R.nFlying++];
      f->p = vmad(track_to_world(&fr, sp.x, sp.y), N, 0.85);
      f->v = vmad(vscale(N, 9), fr.F, game_speed_ms(g) * 1.05);
      f->t = 0;
    } else if (e->type == EV_FOLD_START) {
      if (R.shake < 0.12) R.shake = 0.12;
      R.shakeDecay = 0.15; R.foldFov = 1.2;
    } else if (e->type == EV_FOLD_END) {
      flash(0xffffff, 0.3);
    } else if (e->type == EV_WORLD) {
      if (!game_inverted(g)) R.pendingTheme++;
    }
  }
}

/* ---------------------------------------------------------------- túnel */
static void tunnel_update(const Game *g, double dt) {
  Section sec;
  int on[2], nOn = 0, l, k, c, q = 0;
  int kNear = (int)floor(g->s) - 2, near = (int)floor(g->s), kLast = game_klast(g);
  track_section(g->fold, &sec);
  for (l = 0; l < LANES && nOn < 2; l++) if (game_on_strip(g, l)) on[nOn++] = l;
  for (l = 0; l < LANES; l++) {
    double target = (nOn > 0 && on[0] == l) || (nOn > 1 && on[1] == l) ? 1 : 0;
    double kk = target > R.laneGlow[l] ? 14 : 7;
    R.laneGlow[l] += (target - R.laneGlow[l]) * (kk * dt < 1 ? kk * dt : 1);
  }
  for (k = kNear; k <= kLast && q < NQ; k++) {
    const Frame *ra = track_ring(&R.tr, k), *rb = track_ring(&R.tr, k + 1);
    if (!ra || !rb) continue;
    if (game_in_gap(g, k)) continue;
    for (c = 0; c < LANES && q < NQ; c++, q++) {
      const double *b = sec.b, *d = sec.d;
      double nx = -d[c * 2 + 1], ny = d[c * 2];
      V3 P[4], Nr[4];
      float wr = 0, wg = 0, wb = 0, wa = 0;
      int j, bestId = -1, bestCol = 0, i;
      P[0] = track_to_world(ra, b[c * 2], b[c * 2 + 1]);
      P[1] = track_to_world(ra, b[c * 2 + 2], b[c * 2 + 3]);
      P[2] = track_to_world(rb, b[c * 2 + 2], b[c * 2 + 3]);
      P[3] = track_to_world(rb, b[c * 2], b[c * 2 + 1]);
      Nr[0] = Nr[1] = vadd(vscale(ra->X, nx), vscale(ra->U, ny));
      Nr[2] = Nr[3] = vadd(vscale(rb->X, nx), vscale(rb->U, ny));
      /* aviso de esta celda (game.litStrips): la caja fija de este carril con id mayor */
      for (i = 0; i < g->nBoxes; i++) {
        const Box *bx = &g->boxes[i];
        if (!bx->fixed || bx->hit) continue;
        if (bx->lane != c && !(bx->opp >= 0 && g->fold > 27 && bx->opp == c)) continue;
        if (k >= near && k <= bx->k && bx->id > bestId) { bestId = bx->id; bestCol = bx->color; }
      }
      if (bestId >= 0) { C3 col = COLORS[bestCol]; wr = col.r; wg = col.g; wb = col.b; wa = (float)(0.42 + 0.58 * R.laneGlow[c]); }
      for (j = 0; j < 4; j++) {
        float *o = &tunV[(q * 4 + j) * TV];
        V3 p = vsub(P[j], R.origin);
        o[0] = (float)p.x; o[1] = (float)p.y; o[2] = (float)p.z;
        o[3] = (float)Nr[j].x; o[4] = (float)Nr[j].y; o[5] = (float)Nr[j].z;
        o[6] = (j == 1 || j == 2) ? 1.f : 0.f; o[7] = j >= 2 ? 1.f : 0.f;
        o[8] = wr; o[9] = wg; o[10] = wb; o[11] = wa;
        o[12] = (float)c; o[13] = (float)k;
      }
    }
  }
  tunQuads = q;
  R.tunTime += dt;
}

/* ---------------------------------------------------------------- cajas */
static double ease_out(double t) { return 1 - pow(1 - t, 3); }

static void boxes_update(const Game *g, double dt, int flashId) {
  Section sec;
  int closed = g->fold == 30 || g->fold == -30, i, n = 0, on[2], nOn = 0, l;
  track_section(g->fold, &sec);
  for (l = 0; l < LANES && nOn < 2; l++) if (game_on_strip(g, l)) on[nOn++] = l;
  R.nBoxPos = 0;
  for (i = 0; i < g->nBoxes; i++) {
    const Box *b = &g->boxes[i];
    int tall, j, want, gi;
    double sMid, w, h, len, ox, oy, rot = 0, g0, g1;
    Frame fr; Surf sp; V3 T, N, B, p;
    BoxDraw *bd;
    if (b->hit || n >= 40) continue;
    tall = b->tall && g->fold > 26;
    sMid = tall ? b->k - 0.5 : b->k;
    if (!track_ring(&R.tr, (int)floor(sMid)) || !track_ring(&R.tr, (int)floor(sMid) + 1)) continue;
    track_frame_at(&R.tr, sMid, &fr);
    track_surf(&sec, b->lane, closed, &sp);
    T = vadd(vscale(fr.X, sp.tx), vscale(fr.U, sp.ty));
    N = vadd(vscale(fr.X, -sp.ty), vscale(fr.U, sp.tx));
    B = vscale(fr.F, -1);
    w = TR_CELL_W * (b->fixed ? 1.02 : 1.1);
    h = tall ? 2 * TR_R * cos(M_PI / LANES) - 0.02 : (b->tall ? TR_R : SHORT_H * M_PER_UNIT);
    len = ROW_M * (b->joined ? 1.02 : 0.9);
    if (b->grow < 1) h *= ease_out(b->grow);
    ox = 0; oy = h / 2;
    if (!b->fixed && b->roll != 0) {
      /* volteo del rodante sobre su arista */
      double dir = b->roll > 0 ? 1 : -1;
      double psi = -fabs(b->roll) * DEG * dir;
      double px = dir * w / 2, vx = -dir * w / 2, vy = h / 2, c = cos(psi), s = sin(psi);
      ox = px + vx * c - vy * s; oy = vx * s + vy * c;
      rot = psi;
    }
    p = vmad(vmad(track_to_world(&fr, sp.x, sp.y), T, ox), N, oy);
    if (rot != 0) {   /* makeBasis(T, N, B) · rotZ(rot): gira T y N en su plano */
      double c = cos(rot), s = sin(rot);
      V3 T2 = vadd(vscale(T, c), vscale(N, s)), N2 = vadd(vscale(T, -s), vscale(N, c));
      T = T2; N = N2;
    }
    bd = &R.boxes[n];
    bd->m = m4_basis(vscale(T, w), vscale(N, h), vscale(B, len), vsub(p, R.origin));
    bd->scale = v3(w, h, len);
    want = (nOn > 0 && (on[0] == b->lane || (b->opp >= 0 && on[0] == b->opp))) ||
           (nOn > 1 && (on[1] == b->lane || (b->opp >= 0 && on[1] == b->opp)));
    gi = -1;
    for (j = 0; j < R.nGlow; j++) if (R.glowBy[j].id == b->id) { gi = j; break; }
    if (gi < 0 && R.nGlow < 128) { gi = R.nGlow++; R.glowBy[gi].id = b->id; R.glowBy[gi].g = 0; }
    g0 = gi >= 0 ? R.glowBy[gi].g : 0;
    { double kk = (want > g0 ? 10 : 5) * dt; g1 = g0 + (want - g0) * (kk < 1 ? kk : 1); }
    if (gi >= 0) R.glowBy[gi].g = g1;
    bd->glow = (float)g1; bd->col = COLORS[b->color % 10]; bd->flat = 0;
    if (flashId == b->id) { bd->col.r = bd->col.g = bd->col.b = 1; bd->glow = 2; }
    R.boxPos[R.nBoxPos].id = b->id; R.boxPos[R.nBoxPos].p = p; R.nBoxPos++;
    /* con invulnerabilidad atraviesas las cajas: la que tienes encima no llena la pantalla */
    if (g->invul > 0) { V3 dd = vsub(p, R.pos); if (vdot(dd, dd) < 9) continue; }
    n++;
  }
  R.nBoxDraw = n;
  if (R.nGlow > 100) {   /* olvida las cajas que ya no existen */
    int j, m = 0;
    for (j = 0; j < R.nGlow; j++) if (find_box(g, R.glowBy[j].id)) R.glowBy[m++] = R.glowBy[j];
    R.nGlow = m;
  }
}

/* ---------------------------------------------------------------- placas */
static void pad_put(const Game *g, const Section *sec, int closed, double sMid, int lane, double alpha, int main) {
  Frame fr; Surf sp; V3 T, N, B, p; PadDraw *d;
  if (!track_ring(&R.tr, (int)floor(sMid)) || !track_ring(&R.tr, (int)floor(sMid) + 1) || R.nPadDraw >= 4 * 7 * 6) return;
  track_frame_at(&R.tr, sMid, &fr);
  track_surf(sec, lane, closed, &sp);
  T = vadd(vscale(fr.X, sp.tx), vscale(fr.U, sp.ty));
  N = vadd(vscale(fr.X, -sp.ty), vscale(fr.U, sp.tx));
  B = vscale(fr.F, -1);
  p = vmad(track_to_world(&fr, sp.x, sp.y), N, 0.03 + game_jump_at(g, sMid));
  d = &R.pads[R.nPadDraw++];
  d->m = m4_basis(vscale(T, TR_CELL_W * 0.94), N, vscale(B, ROW_M * 0.94), vsub(p, R.origin));
  d->alpha = (float)alpha; d->main = main;
}
static void pads_update(const Game *g, double dt) {
  Section sec; int closed = g->fold == 30 || g->fold == -30, i, j;
  R.padTime += dt;
  track_section(g->fold, &sec);
  R.nPadDraw = 0;
  for (i = 0; i < g->nPads; i++) {
    const Pad *pd = &g->pads[i];
    if (pd->taken) continue;
    pad_put(g, &sec, closed, pd->k, pd->lane, 1, 1);
    for (j = 1; j <= 6; j++) pad_put(g, &sec, closed, pd->k - j, pd->lane, (7 - j) / 7.0 * 0.8, 0);
  }
}

/* ---------------------------------------------------------------- monedas */
static M4 rot_y_basis(V3 T, V3 N, V3 B, double a, double s, V3 p) {
  /* makeBasis(T, N, B) · rotY(a) · escala s */
  double c = cos(a), si = sin(a);
  V3 X = vadd(vscale(T, c), vscale(B, -si)), Z = vadd(vscale(T, si), vscale(B, c));
  return m4_basis(vscale(X, s), vscale(N, s), vscale(Z, s), p);
}
static void coins_update(const Game *g, double dt) {
  Section sec; int closed = g->fold == 30 || g->fold == -30, i, n = 0;
  R.coinTime += dt;
  track_section(g->fold, &sec);
  for (i = 0; i < g->nCoins && n < 160; i++) {
    const Coin *c = &g->coins[i];
    double sMid = c->k - 0.5, bob, dc, sc = 1;
    Frame fr; Surf sp; V3 T, N, B, p;
    if (c->got) continue;
    if (!track_ring(&R.tr, (int)floor(sMid)) || !track_ring(&R.tr, (int)floor(sMid) + 1)) continue;
    track_frame_at(&R.tr, sMid, &fr); track_surf(&sec, c->lane, closed, &sp);
    T = vadd(vscale(fr.X, sp.tx), vscale(fr.U, sp.ty));
    N = vadd(vscale(fr.X, sp.nx), vscale(fr.U, sp.ny));
    B = vscale(fr.F, -1);
    bob = sin(R.coinTime * 4 + c->k * 0.7) * 0.06;
    p = vmad(track_to_world(&fr, sp.x, sp.y), N, 0.85 + bob + game_jump_at(g, sMid));
    dc = vlen(vsub(p, R.pos));
    if (dc < 4) { sc = (dc - 1.2) / 2.8; if (sc < 0) sc = 0; }
    R.coinM[n++] = rot_y_basis(T, N, B, R.coinTime * 3 + c->k * 0.5, sc, vsub(p, R.origin));
  }
  for (i = R.nFlying - 1; i >= 0; i--) {
    Flying *f = &R.flying[i];
    double k;
    f->t += dt;
    if (f->t > 0.25 || n >= 160) { R.flying[i] = R.flying[--R.nFlying]; continue; }
    f->p = vmad(f->p, f->v, dt);
    k = 1 - f->t / 0.25;
    R.coinM[n++] = rot_y_basis(v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1), R.coinTime * 20, 0.8 * k, vsub(f->p, R.origin));
  }
  R.nCoinDraw = n;
}

/* ---------------------------------------------------------------- actualización (Renderer.update) */
static double clamp01(double x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
static double minf(double a, double b) { return a < b ? a : b; }

void rn_update(const Game *g, double s, double theta, double dt, RenderOpts o) {
  Section sec; Surf sp; Frame fr, fr2;
  int closed, i, gapIdx = -1, landing = -1, inv, gapNear = 0, outside, flashId;
  double camS, u, jump, kLook, sp01, fov, fogFar, bk, rfx = o.reduceFx ? 0.3 : 1;
  V3 N, pos, target, up, zc, xc, yc;
  R.time += dt;
  track_sync(&R.tr, g);
  if (R.themeBlend < 1) { R.themeBlend = minf(1, R.themeBlend + dt / 0.25); apply_theme(R.themeFrom, R.themeIdx, R.themeBlend); }
  /* fase oscura: mientras dura el estado invertido y hasta aterrizar del salto entre mundos */
  for (i = 0; i < g->nGaps; i++) if (g->gaps[i].to + 1 > s) { gapIdx = i; break; }
  if (gapIdx >= 0) landing = g->gaps[gapIdx].to + 1;
  if (R.pendingTheme && (gapIdx < 0 || s >= landing - 0.5)) {
    R.themeFrom = R.themeIdx; R.themeIdx += R.pendingTheme; R.pendingTheme = 0; R.themeBlend = 0;
    if (gapIdx >= 0 || R.wasFlying) { flash(THEMES[R.themeIdx % NTHEMES].glow, 0.3); R.landT = 1.5; R.landed = 1; }
  }
  R.wasFlying = game_jump_at(g, s) > 0.2;
  inv = game_inverted(g) || R.pendingTheme > 0 ? 1 : 0;
  { double d = inv - R.invert, m = minf(fabs(d), dt * 4); R.invert += (d > 0 ? 1 : d < 0 ? -1 : 0) * m; }
  R.hemiI = (float)(1.0 * (1 - R.invert * 0.7));
  R.uFog = clerp(R.themeFog, hexc(0x0b0822), (float)R.invert);

  /* ---- cámara: superficie del jugador + normal, mirando la dirección de la fila +10 */
  closed = g->fold == 30 || g->fold == -30;
  track_section(g->fold, &sec);
  camS = s - 0.12;
  track_frame_at(&R.tr, camS, &fr);
  u = theta / (CELL_DEG * DEG);
  track_surf(&sec, u, closed, &sp);
  N = vadd(vscale(fr.X, sp.nx), vscale(fr.U, sp.ny));
  jump = game_jump_at(g, camS);
  pos = vmad(track_to_world(&fr, sp.x, sp.y), N, 0.62 + jump);
  track_frame_at(&R.tr, minf(s + 10, game_klast(g)), &fr2);
  kLook = R.firstFrame ? 1 : minf(1, dt * 60 * 0.06);
  R.look = vnorm(vlerp(R.look, fr2.F, kLook));
  R.upS = vnorm(vlerp(R.upS, N, R.firstFrame ? 1 : minf(1, dt * 18)));
  R.firstFrame = 0;
  if (R.shake > 0) {
    double a = R.shake * (o.reduceFx ? 0.3 : 1);
    pos.x += (frand() * 2 - 1) * a; pos.y += (frand() * 2 - 1) * a; pos.z += (frand() * 2 - 1) * a;
    R.shake = R.shake - R.shakeDecay * dt; if (R.shake < 0) R.shake = 0;
  }
  target = vadd(pos, R.look);
  if (!g->alive && R.deathFocusOn) { R.deathT += dt; target = vlerp(target, R.deathFocus, minf(1, R.deathT * 2) * 0.6); }
  else R.deathT = 0;
  up = R.upS;
  if (R.roll > 0) { up = vrot(up, R.look, R.rollAmp * R.roll * rfx); R.roll = R.roll - dt * 1.4; if (R.roll < 0) R.roll = 0; }
  R.lean += ((g->alive ? -g->omega * 0.9 : 0) - R.lean) * minf(1, dt * 8);
  { double la = R.lean < -0.07 ? -0.07 : R.lean > 0.07 ? 0.07 : R.lean; la *= rfx; if (la != 0) up = vrot(up, R.look, la); }
  /* Object3D.lookAt de una cámara: z = pos − destino, x = up × z, y = z × x */
  zc = vnorm(vsub(pos, target));
  xc = vcross(up, zc);
  if (vlen(xc) < 1e-9) xc = v3(1, 0, 0);
  xc = vnorm(xc); yc = vcross(zc, xc);
  R.pos = pos; R.origin = pos; R.camX = xc; R.camY = yc; R.camZ = zc;
  sp01 = clamp01((game_speed_ms(g) - 36) / 64);
  fov = R.baseFov + sp01 * 14 + (R.kick <= 0 ? 0 : sin(minf(1, R.kick) * M_PI * 0.5)) * (o.reduceFx ? 4 : 12) * (R.kickAmp ? R.kickAmp : 1)
      + (R.foldFov > 0 ? sin(minf(1, (1.2 - R.foldFov) / 1.2) * M_PI) * 8 : 0);
  if (R.foldFov > 0) R.foldFov -= dt;
  R.kick = R.kick - dt * 1.8; if (R.kick < 0) R.kick = 0;
  R.fov = fov;

  /* ---- mundo */
  /* la luz del túnel va con la cámara (arriba, algo por detrás y a la izquierda) */
  R.key = vnorm(vadd(vadd(vscale(R.upS, 0.85), vscale(R.look, -0.35)), vscale(vnorm(vcross(R.look, R.upS)), -0.4)));
  for (i = 0; i < g->nGaps; i++) if (g->gaps[i].from - s < 34 && g->gaps[i].to - s > -6) gapNear = 1;
  outside = g->fold < 29 || gapNear;
  fogFar = (outside ? 190 : 120) * (1 + 0.3 * (R.landT > 0 ? R.landT / 1.5 : 0));
  if (R.landT > 0) R.landT -= dt;
  R.fogFar += (fogFar - R.fogFar) * minf(1, dt * 2);
  R.fogNear = R.fogFar * 0.3;
  R.hit = R.hit - dt * 3; if (R.hit < 0) R.hit = 0;
  tunnel_update(g, dt);
  flashId = !g->alive && R.deathT > 0 && ((int)floor(R.deathT * 10)) % 2 ? g->killer : 0;
  boxes_update(g, dt, flashId);
  R.outside += ((g->fold < 29 ? 1 : 0) - R.outside) * minf(1, dt * 2);
  pads_update(g, dt);
  coins_update(g, dt);
  /* cielo: su "arriba" es el de la pista, suavizado; solo se ve por fuera */
  R.skyUp = vnorm(vlerp(R.skyUp, fr.U, minf(1, dt * 1.5)));
  R.skyTime += dt; R.seaTime += dt;
  R.skyVis += ((outside ? 1 : 0) - R.skyVis) * minf(1, dt * 3);
  R.skyOn = R.skyVis > 0.01;
  R.seaAlpha = (float)(R.skyVis * (1 - R.invert));
  R.seaOn = R.skyVis > 0.01 && R.invert < 0.99;
  /* impulso: 0,4 s de azul eléctrico en juntas y anillos (nunca en los carriles) */
  bk = (R.kick - 0.28 > 0 ? R.kick - 0.28 : 0) / 0.72;
  {
    C3 blue = cscale(hexc(0x3fb6ff), 2);
    R.uGlow = clerp(R.themeGlow, blue, (float)bk);
    R.uRing = clerp(hexc(0xfff1c9), blue, (float)bk);
  }
  if (R.blueVig > 0) R.blueVig -= dt;
  R.flash = R.flash - dt * 2.5; if (R.flash < 0) R.flash = 0;
  (void)o.attract;
}

/* ---------------------------------------------------------------- dibujo */
static void set_common(GLuint p) { u1(p, "uSatAmt", R.satAmt); }

void rn_render(void) {
  M4 view, proj, vp;
  int i;
  double tanH = tan(R.fov * DEG / 2);
  /* vista: la cámara en el origen (todo va relativo a ella) */
  view = m4_identity();
  view.m[0] = (float)R.camX.x; view.m[4] = (float)R.camX.y; view.m[8] = (float)R.camX.z;
  view.m[1] = (float)R.camY.x; view.m[5] = (float)R.camY.y; view.m[9] = (float)R.camY.z;
  view.m[2] = (float)R.camZ.x; view.m[6] = (float)R.camZ.y; view.m[10] = (float)R.camZ.z;
  proj = m4_perspective(R.fov, R.aspect, 0.05, 900);
  vp = m4_mul(proj, view);

  glViewport(0, 0, R.w, R.h);
  {
    /* fondo = color de la niebla, en pantalla (ya con tono y sRGB, como el resto) */
    C3 f = R.uFog; float l = 0.2126f * f.r + 0.7152f * f.g + 0.0722f * f.b;
    float c[3]; int k;
    float in[3]; in[0] = l + (f.r - l) * R.satAmt; in[1] = l + (f.g - l) * R.satAmt; in[2] = l + (f.b - l) * R.satAmt;
    /* tono neutro en CPU (mismo algoritmo que el sombreador) */
    {
      float x = in[0] < in[1] ? (in[0] < in[2] ? in[0] : in[2]) : (in[1] < in[2] ? in[1] : in[2]);
      float off = x < 0.08f ? x - 6.25f * x * x : 0.04f, peak;
      for (k = 0; k < 3; k++) in[k] -= off;
      peak = in[0] > in[1] ? (in[0] > in[2] ? in[0] : in[2]) : (in[1] > in[2] ? in[1] : in[2]);
      if (peak >= 0.76f) {
        float d = 0.24f, np = 1 - d * d / (peak + d - 0.76f), gg;
        for (k = 0; k < 3; k++) in[k] *= np / peak;
        gg = 1 - 1 / (0.15f * (peak - np) + 1);
        for (k = 0; k < 3; k++) in[k] += (np - in[k]) * gg;
      }
    }
    for (k = 0; k < 3; k++) { float v = in[k] < 0 ? 0 : in[k] > 1 ? 1 : in[k]; c[k] = v <= 0.0031308f ? v * 12.92f : 1.055f * powf(v, 1 / 2.4f) - 0.055f; }
    glClearColor(c[0], c[1], c[2], 1);
  }
  glDepthMask(GL_TRUE);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  glDisable(GL_BLEND); glDisable(GL_CULL_FACE);

  /* cielo (y mar de nubes) a pantalla completa, detrás de todo */
  if (R.skyOn) {
    GLuint p = R.pSky;
    V3 up = R.skyUp, zz = v3(0, 0, 1), axis = vcross(zz, up), e1 = v3(1, 0, 0), e2 = v3(0, 1, 0);
    double ang = acos(vdot(zz, up) < -1 ? -1 : vdot(zz, up) > 1 ? 1 : vdot(zz, up));
    if (vlen(axis) > 1e-6) { axis = vnorm(axis); e1 = vrot(e1, axis, ang); e2 = vrot(e2, axis, ang); }
    glDisable(GL_DEPTH_TEST); glDepthMask(GL_FALSE);
    glUseProgram(p); set_common(p);
    uc(p, "uTop", R.skyTop); uc(p, "uMid", R.skyMid); uc(p, "uBot", R.skyBot); uc(p, "uSun", R.sun);
    uv(p, "uUp", up); uv(p, "uSunDir", vnorm(v3(-0.4, 0.5, -1)));
    u1(p, "uStars", R.stars); u1(p, "uTime", (float)R.skyTime); u1(p, "uInvert", (float)R.invert);
    uv(p, "uCamF", vscale(R.camZ, -1)); uv(p, "uCamR", R.camX); uv(p, "uCamU", R.camY);
    u2(p, "uTan", (float)(tanH * R.aspect), (float)tanH);
    uc(p, "uSeaA", R.seaA); uc(p, "uSeaB", R.seaB); uc(p, "uSeaFog", R.seaFog);
    u1(p, "uSeaAlpha", R.seaOn ? R.seaAlpha : 0);
    u2(p, "uSeaOff", (float)fmod(R.pos.x / 180, 1000.0), (float)fmod(-R.pos.z / 180, 1000.0));
    u1(p, "uSeaTime", (float)R.seaTime); uv(p, "uSeaE1", e1); uv(p, "uSeaE2", e2);
    glBindVertexArray(R.full.vao);
    glDrawElements(GL_TRIANGLES, R.full.nIdx, GL_UNSIGNED_SHORT, 0);
    glDepthMask(GL_TRUE);
  }
  glEnable(GL_DEPTH_TEST); glDepthFunc(GL_LEQUAL);

  /* túnel */
  {
    GLuint p = R.pTun;
    glUseProgram(p); set_common(p);
    um(p, "uVP", &vp);
    uc(p, "uBase", R.uBase); uc(p, "uBase2", R.uBase2); uc(p, "uSeam", R.uSeam); uc(p, "uFog", R.uFog); uc(p, "uGlow", R.uGlow);
    u3(p, "uCam", 0, 0, 0); uv(p, "uKey", R.key);
    u1(p, "uFogNear", (float)R.fogNear); u1(p, "uFogFar", (float)R.fogFar); u1(p, "uTime", (float)fmod(R.tunTime, 1000.0));
    u1(p, "uInvert", (float)R.invert); u2(p, "uCellSize", (float)TR_CELL_W, (float)ROW_M); u1(p, "uHit", (float)R.hit);
    uc(p, "uRing", R.uRing); u1(p, "uOutside", (float)R.outside); uc(p, "uSkyFill", R.skyTop); u1(p, "uDark", R.uDark);
    uc(p, "uInvBase", R.uInvBase);
    glBindVertexArray(tunVao);
    glBindBuffer(GL_ARRAY_BUFFER, tunVbo);
    glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(tunQuads * 4 * TV * sizeof(float)), tunV);
    glDrawElements(GL_TRIANGLES, tunQuads * 6, GL_UNSIGNED_SHORT, 0);
  }

  /* cajas: primero el cuerpo y después el contorno (casco invertido, caras traseras) */
  {
    GLuint p = R.pBox;
    V3 key = vnorm(vadd(vadd(vscale(R.camX, -0.4), R.camY), vscale(R.camZ, 1.6)));
    glUseProgram(p); set_common(p);
    um(p, "uVP", &vp); uv(p, "uKey", key); u3(p, "uCam", 0, 0, 0); u1(p, "uHemiI", R.hemiI);
    glBindVertexArray(R.box.vao);
    glEnable(GL_CULL_FACE); glFrontFace(GL_CCW);
    for (i = 0; i < R.nBoxDraw; i++) {
      BoxDraw *b = &R.boxes[i];
      um(p, "uModel", &b->m); uv(p, "uScale", b->scale); u1(p, "uOutlineW", 0);
      uc(p, "uColor", b->col); u1(p, "uGlow", b->glow); u1(p, "uFlat", 0);
      glCullFace(GL_BACK);
      glDrawElements(GL_TRIANGLES, R.box.nIdx, GL_UNSIGNED_SHORT, 0);
      u1(p, "uOutlineW", 0.06f); uc(p, "uColor", hexc(0x3a1f5c)); u1(p, "uFlat", 1);
      glCullFace(GL_FRONT);
      glDrawElements(GL_TRIANGLES, R.box.nIdx, GL_UNSIGNED_SHORT, 0);
    }
    glDisable(GL_CULL_FACE);
  }

  /* monedas */
  {
    GLuint p = R.pCoin;
    V3 key = vnorm(vadd(vadd(vscale(R.camX, -0.4), R.camY), vscale(R.camZ, 1.6)));
    glUseProgram(p); set_common(p);
    um(p, "uVP", &vp); uv(p, "uKey", key); u3(p, "uCam", 0, 0, 0); u1(p, "uHemiI", R.hemiI);
    u3(p, "uScale", 1, 1, 1); u1(p, "uOutlineW", 0);
    glBindVertexArray(R.coin.vao);
    for (i = 0; i < R.nCoinDraw; i++) {
      um(p, "uModel", &R.coinM[i]);
      glDrawElements(GL_TRIANGLES, R.coin.nIdx, GL_UNSIGNED_SHORT, 0);
    }
  }

  /* placas: transparentes, sin escribir profundidad y adelantadas un pelín (polygonOffset) */
  if (R.nPadDraw) {
    GLuint p = R.pPad;
    glUseProgram(p); set_common(p);
    um(p, "uVP", &vp); u1(p, "uTime", (float)fmod(R.padTime, 1000.0));
    glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glDepthMask(GL_FALSE);
    glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(-2, -2);
    glBindVertexArray(R.plane.vao);
    for (i = 0; i < R.nPadDraw; i++) {
      um(p, "uModel", &R.pads[i].m); u1(p, "uAlpha", R.pads[i].alpha); u1(p, "uMain", (float)R.pads[i].main);
      glDrawElements(GL_TRIANGLES, R.plane.nIdx, GL_UNSIGNED_SHORT, 0);
    }
    glDisable(GL_POLYGON_OFFSET_FILL);
    glDepthMask(GL_TRUE);
    glDisable(GL_BLEND);
  }

  /* destello y viñeta azul del nivel 3 */
  {
    float fa = (float)R.flash, va = R.blueVig > 0 ? 0.45f : 0;
    if (fa > 0.003f || va > 0) {
      GLuint p = R.pFlash;
      unsigned h = (unsigned)R.flashHex;
      glDisable(GL_DEPTH_TEST);
      glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
      glUseProgram(p);
      glUniform4f(U(p, "uFlash"), ((h >> 16) & 255) / 255.f, ((h >> 8) & 255) / 255.f, (h & 255) / 255.f, fa);
      u3(p, "uVigCol", 0.25f, 0.71f, 1.0f); u1(p, "uVig", va);
      glBindVertexArray(R.full.vao);
      glDrawElements(GL_TRIANGLES, R.full.nIdx, GL_UNSIGNED_SHORT, 0);
      glDisable(GL_BLEND);
    }
  }
  glBindVertexArray(0);
}

/* ---------------------------------------------------------------- HUD 2D */
#define HUD_MAXV 60000
static float hudV[HUD_MAXV * 11]; static int hudN, hudW, hudH;
static GLuint hudVao, hudVbo;

void hud_begin(int w, int h) {
  hudN = 0; hudW = w; hudH = h;
  if (!hudVao) {
    glGenVertexArrays(1, &hudVao); glBindVertexArray(hudVao);
    glGenBuffers(1, &hudVbo); glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof hudV, NULL, GL_STREAM_DRAW);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 44, (void *)0);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, 44, (void *)8);
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, 44, (void *)24);
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, 44, (void *)32);
    glBindVertexArray(0);
  }
}
static void hv(float x, float y, unsigned rgb, float a, float lx, float ly, float hw, float hh, float rad) {
  float *o;
  if (hudN >= HUD_MAXV) return;
  o = &hudV[hudN++ * 11];
  o[0] = x; o[1] = y; o[2] = ((rgb >> 16) & 255) / 255.f; o[3] = ((rgb >> 8) & 255) / 255.f; o[4] = (rgb & 255) / 255.f; o[5] = a;
  o[6] = lx; o[7] = ly; o[8] = hw; o[9] = hh; o[10] = rad;
}
void hud_rect(float x, float y, float w, float h, float rad, unsigned rgb, float a) {
  float hw = w / 2, hh = h / 2, e = 1;   /* 1 px de margen para el suavizado */
  float x0 = x - e, y0 = y - e, x1 = x + w + e, y1 = y + h + e;
  float lx0 = -hw - e, lx1 = hw + e, ly0 = -hh - e, ly1 = hh + e;
  if (rad > hw) rad = hw;
  if (rad > hh) rad = hh;
  hv(x0, y0, rgb, a, lx0, ly0, hw, hh, rad); hv(x1, y0, rgb, a, lx1, ly0, hw, hh, rad); hv(x1, y1, rgb, a, lx1, ly1, hw, hh, rad);
  hv(x0, y0, rgb, a, lx0, ly0, hw, hh, rad); hv(x1, y1, rgb, a, lx1, ly1, hw, hh, rad); hv(x0, y1, rgb, a, lx0, ly1, hw, hh, rad);
}
void hud_quad(const float *q, unsigned rgb, float a) {
  hv(q[0], q[1], rgb, a, 0, 0, 1e5f, 1e5f, 0); hv(q[2], q[3], rgb, a, 0, 0, 1e5f, 1e5f, 0); hv(q[4], q[5], rgb, a, 0, 0, 1e5f, 1e5f, 0);
  hv(q[0], q[1], rgb, a, 0, 0, 1e5f, 1e5f, 0); hv(q[4], q[5], rgb, a, 0, 0, 1e5f, 1e5f, 0); hv(q[6], q[7], rgb, a, 0, 0, 1e5f, 1e5f, 0);
}

/* fuente de 5x7 (la clásica glcdfont), por columnas, bit 0 arriba; ASCII 32..90 */
static const unsigned char FONT[59][5] = {
  {0x00,0x00,0x00,0x00,0x00},{0x00,0x00,0x5F,0x00,0x00},{0x00,0x07,0x00,0x07,0x00},{0x14,0x7F,0x14,0x7F,0x14},
  {0x24,0x2A,0x7F,0x2A,0x12},{0x23,0x13,0x08,0x64,0x62},{0x36,0x49,0x55,0x22,0x50},{0x00,0x05,0x03,0x00,0x00},
  {0x00,0x1C,0x22,0x41,0x00},{0x00,0x41,0x22,0x1C,0x00},{0x08,0x2A,0x1C,0x2A,0x08},{0x08,0x08,0x3E,0x08,0x08},
  {0x00,0x50,0x30,0x00,0x00},{0x08,0x08,0x08,0x08,0x08},{0x00,0x60,0x60,0x00,0x00},{0x20,0x10,0x08,0x04,0x02},
  {0x3E,0x51,0x49,0x45,0x3E},{0x00,0x42,0x7F,0x40,0x00},{0x42,0x61,0x51,0x49,0x46},{0x21,0x41,0x45,0x4B,0x31},
  {0x18,0x14,0x12,0x7F,0x10},{0x27,0x45,0x45,0x45,0x39},{0x3C,0x4A,0x49,0x49,0x30},{0x01,0x71,0x09,0x05,0x03},
  {0x36,0x49,0x49,0x49,0x36},{0x06,0x49,0x49,0x29,0x1E},{0x00,0x36,0x36,0x00,0x00},{0x00,0x56,0x36,0x00,0x00},
  {0x00,0x08,0x14,0x22,0x41},{0x14,0x14,0x14,0x14,0x14},{0x41,0x22,0x14,0x08,0x00},{0x02,0x01,0x51,0x09,0x06},
  {0x32,0x49,0x79,0x41,0x3E},{0x7E,0x11,0x11,0x11,0x7E},{0x7F,0x49,0x49,0x49,0x36},{0x3E,0x41,0x41,0x41,0x22},
  {0x7F,0x41,0x41,0x22,0x1C},{0x7F,0x49,0x49,0x49,0x41},{0x7F,0x09,0x09,0x01,0x01},{0x3E,0x41,0x41,0x51,0x32},
  {0x7F,0x08,0x08,0x08,0x7F},{0x00,0x41,0x7F,0x41,0x00},{0x20,0x40,0x41,0x3F,0x01},{0x7F,0x08,0x14,0x22,0x41},
  {0x7F,0x40,0x40,0x40,0x40},{0x7F,0x02,0x04,0x02,0x7F},{0x7F,0x04,0x08,0x10,0x7F},{0x3E,0x41,0x41,0x41,0x3E},
  {0x7F,0x09,0x09,0x09,0x06},{0x3E,0x41,0x51,0x21,0x5E},{0x7F,0x09,0x19,0x29,0x46},{0x46,0x49,0x49,0x49,0x31},
  {0x01,0x01,0x7F,0x01,0x01},{0x3F,0x40,0x40,0x40,0x3F},{0x1F,0x20,0x40,0x20,0x1F},{0x7F,0x20,0x18,0x20,0x7F},
  {0x63,0x14,0x08,0x14,0x63},{0x03,0x04,0x78,0x04,0x03},{0x61,0x51,0x49,0x45,0x43} };
static const unsigned char GLYPH_IEXCL[5] = { 0x00, 0x00, 0x7D, 0x00, 0x00 };   /* ¡ */
static const unsigned char GLYPH_IQUES[5] = { 0x30, 0x48, 0x45, 0x40, 0x20 };   /* ¿ */

/* decodifica un carácter (UTF-8 mínimo: tildes a su vocal, ¡ y ¿) */
static const unsigned char *glyph(const char **ps) {
  const unsigned char *s = (const unsigned char *)*ps;
  int c = *s++;
  if (c == 0xC2 && *s == 0xA1) { s++; *ps = (const char *)s; return GLYPH_IEXCL; }
  if (c == 0xC2 && *s == 0xBF) { s++; *ps = (const char *)s; return GLYPH_IQUES; }
  if (c == 0xC3) {
    int d = *s++;
    switch (d) { case 0x81: case 0xA1: c = 'A'; break; case 0x89: case 0xA9: c = 'E'; break; case 0x8D: case 0xAD: c = 'I'; break;
                 case 0x93: case 0xB3: c = 'O'; break; case 0x9A: case 0xBA: case 0x9C: case 0xBC: c = 'U'; break; case 0x91: case 0xB1: c = 'N'; break; default: c = '?'; }
  }
  *ps = (const char *)s;
  if (c >= 'a' && c <= 'z') c -= 32;
  if (c < 32 || c > 90) c = '?';
  return FONT[c - 32];
}
float hud_text_w(float px, const char *s) { float w = 0; while (*s) { glyph(&s); w += 6 * px; } return w > 0 ? w - px : 0; }
/* cada letra se dibuja como trazos redondeados: tramos seguidos de píxeles en vertical y en
   horizontal. "grow" engorda los trazos (para el contorno oscuro). */
float hud_text_ex(float x, float y, float px, const char *s, unsigned rgb, float a, float grow) {
  float x0 = x, r = px * 0.5f + grow;
  while (*s) {
    const unsigned char *gl = glyph(&s);
    int cx, cy;
    for (cx = 0; cx < 5; cx++) for (cy = 0; cy < 7; cy++) {
      int on = gl[cx] >> cy & 1, up = cy > 0 && (gl[cx] >> (cy - 1) & 1), left = cx > 0 && (gl[cx - 1] >> cy & 1);
      if (!on) continue;
      if (!up) {   /* tramo vertical que empieza aquí */
        int n = 1; while (cy + n < 7 && (gl[cx] >> (cy + n) & 1)) n++;
        hud_rect(x + cx * px - grow, y + cy * px - grow, px + 2 * grow, n * px + 2 * grow, r, rgb, a);
      }
      if (!left) {  /* tramo horizontal que empieza aquí */
        int n = 1; while (cx + n < 5 && (gl[cx + n] >> cy & 1)) n++;
        if (n > 1) hud_rect(x + cx * px - grow, y + cy * px - grow, n * px + 2 * grow, px + 2 * grow, r, rgb, a);
      }
    }
    x += 6 * px;
  }
  return x - x0 - px;
}
float hud_text(float x, float y, float px, const char *s, unsigned rgb, float a) { return hud_text_ex(x, y, px, s, rgb, a, 0); }
void hud_end(void) {
  GLuint p = R.pHud;
  if (!hudN) return;
  glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE);
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glUseProgram(p);
  u2(p, "uScreen", (float)hudW, (float)hudH);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(hudN * 11 * sizeof(float)), hudV);
  glDrawArrays(GL_TRIANGLES, 0, hudN);
  glBindVertexArray(0);
  glDisable(GL_BLEND);
  glEnable(GL_DEPTH_TEST);
}
