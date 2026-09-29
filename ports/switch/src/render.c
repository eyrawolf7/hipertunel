/* Capa de dibujo: port de app/src/render/index.js y compañía (ver render.h).
 * Las posiciones se calculan en double (como Three) y se suben a la GPU relativas a la cámara,
 * así no se pierde precisión a 40 km del origen. */
#include "render.h"
#include "glmini.h"
#include "shaders.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "assets.h"
#include "model.h"
#include "kitshaders.h"
#define STB_IMAGE_IMPLEMENTATION
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#define STBI_NO_STDIO
#include "stb_image.h"
#define STB_TRUETYPE_IMPLEMENTATION
#include "stb_truetype.h"

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
  unsigned shadow; float sunK[3]; unsigned inlay, seamGlow; int pano; unsigned rim; unsigned air; int decor;
} Theme;
/* los mismos 5 mundos que la web (islas, selva, noche, templo, volcán) */
static const Theme THEMES[] = {
  { "Islas del cielo", 0xe8d5ad, 0xbfa57a, 0x6b5a3e, 0xbfe0ff, 0x5ff5e0, 0x3f8fff, 0xbfe0ff, 0xf4f8ff, 0xfff2c8, 0, 0, 0, 0xa6c6f2, { 1.26f, 1.03f, 0.72f }, 0xffc861, 0, 0, 0xcfeeff, 0xf2d6c0, 0 },
  { "Selva perdida", 0xe2d8b8, 0xb9ad86, 0x4d5a36, 0xbfe6d0, 0x9dffb0, 0x4aa3d8, 0xbfe6d0, 0xe8f6e4, 0xfff6d0, 0, 0, 0, 0x9ec6ea, { 1.18f, 1.08f, 0.76f }, 0xffd970, 0, 1, 0xd8ffe0, 0xb8e0c0, 0 },
  { "Noche de luciérnagas", 0xd8d4e8, 0xa9a4c4, 0x2a2a50, 0x1c2a5e, 0x3ff5e0, 0x060a26, 0x1c2a5e, 0x2f5a7a, 0xbff8ff, 1, 1, 0x151b36, 0x5868a8, { 0.8f, 0.95f, 1.15f }, 0x8dffd0, 0x1f8f7a, 2, 0x5ff5e0, 0x3a5a8a, 1 },
  { "Templo del ocaso", 0xf6dcb0, 0xd6a978, 0x7a4a2e, 0xff9f7a, 0xffd27a, 0x6a4bc4, 0xff9f7a, 0xffd8a0, 0xffb060, 0.1f, 0, 0, 0xa8b4d8, { 1.3f, 0.96f, 0.7f }, 0xffb45a, 0, 3, 0xffd8a0, 0xe8a890, 0 },
  { "Islas de fuego", 0xe8d0c0, 0xb89080, 0x4a2020, 0x8a3040, 0xff8a3d, 0x2a1030, 0x8a3040, 0xff8a50, 0xffb070, 0.3f, 1, 0x2a1418, 0x7a4868, { 1.25f, 0.86f, 0.72f }, 0xff8a3d, 0x8a2a0a, 4, 0xff9a60, 0x9a4858, 2 },
};
#define NTHEMES 5
/* colores de caja: sin azul (solo del impulso) ni amarillo (se confundía con la arenisca) */
static const unsigned HUES[6] = { 0xff3d57, 0x7cc41a, 0xff5fb4, 0xff6a0a, 0xa05cff, 0x22d08a };
static C3 COLORS[10];

/* ---------------------------------------------------------------- texturas (las de la web, dentro del ejecutable) */
static GLuint tex_load(const char *name, int srgb, int repeatT) {
  int i, w, h, n;
  unsigned char *px;
  GLuint t = 0;
  for (i = 0; ASSETS[i].name; i++) if (!strcmp(ASSETS[i].name, name)) break;
  if (!ASSETS[i].name) { fprintf(stderr, "falta la textura %s\n", name); return 0; }
  px = stbi_load_from_memory(ASSETS[i].data, (int)ASSETS[i].size, &w, &h, &n, 4);
  if (!px) { fprintf(stderr, "no se pudo leer %s\n", name); return 0; }
  glGenTextures(1, &t); glBindTexture(GL_TEXTURE_2D, t);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, srgb ? GL_SRGB8_ALPHA8 : GL_RGBA8, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, px);
  glGenerateMipmap(GL_TEXTURE_2D);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, repeatT ? GL_REPEAT : GL_CLAMP_TO_EDGE);
  stbi_image_free(px);
  return t;
}

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
static void bind_tex(GLuint p, const char *u, int unit, GLuint t) { glActiveTexture(GL_TEXTURE0 + unit); glBindTexture(GL_TEXTURE_2D, t); glUniform1i(U(p, u), unit); }
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

/* ---------------------------------------------------------------- túnel del kit (tunnelkit.js) */
#define KI 22                        /* floats por instancia: C0 C1 C2 C3 N0 N1 (vec3) + warn (vec4) */
#define KMAX ((ROWS + 4) * (LANES + 2))
static float kitI[4][KMAX * KI];
enum { T_STONE, T_ARCH, T_CRYSTAL, T_CRYSTAL_ARCH };

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
  GLuint tAlb, tNrm, tOrm, tCAlb, tCNrm, tPano[5];
  GLuint pCell, pModel; int kitOk;
  Model tile[4], boxBlock, boxCrystal;
  /* adornos del túnel (tunnelprops.js) y decorado lejano (decor.js) */
  Model mRib, mCry, mVine, mHang, mDecor[9];
  struct { int m; M4 x; } props[400]; int nProps;
  struct { int kind, placed; V3 pos, up; double yaw, spin, scale, k, checkT; } dec[24]; int nDec, decTheme;
  V3 camUp, decUp; C3 airCol;
  Model mCoin; float coinFix[4];
  GLuint pFx, fxVao, fxVbo;
  struct { V3 pos; double rot, spin, flut; unsigned col; int live; } life[70];
  struct { double a, r, z, v; } stk[44]; int stkInit; int lifeKind;
  GLuint tileVbo[4]; int tileN[4];
  C3 rimCol;
  C3 shadowCol, sunCol, inlay, seamGlow, tint; int panoA, panoB; float panoT; V3 sunDir, fwd; double keyFollow, inside;
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
  float satAmt; double sp01;
} R;

#define NLV 5
#ifdef __SWITCH__
#define MSAA_N 2   /* la consola va más justa: suavizado 2× */
#else
#define MSAA_N 4
#endif
static struct { int ok, w, h; GLuint msFbo, msCol, msDep, resFbo, resTex, lvFbo[NLV], lvTex[NLV]; int lw[NLV], lh[NLV]; GLuint pBright, pDown, pUp, pPost; } PP;
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
  R.shadowCol = clerp(hexc(A->shadow), hexc(B->shadow), tf);
  R.rimCol = clerp(hexc(A->rim), hexc(B->rim), tf);
  R.airCol = clerp(hexc(A->air), hexc(B->air), tf);
  R.decTheme = tf < 0.5f ? A->decor : B->decor;
  R.sunCol.r = A->sunK[0] + (B->sunK[0] - A->sunK[0]) * tf; R.sunCol.g = A->sunK[1] + (B->sunK[1] - A->sunK[1]) * tf; R.sunCol.b = A->sunK[2] + (B->sunK[2] - A->sunK[2]) * tf;
  R.inlay = clerp(hexc(A->inlay), hexc(B->inlay), tf);
  R.seamGlow = clerp(A->seamGlow ? hexc(A->seamGlow) : hexc(0), B->seamGlow ? hexc(B->seamGlow) : hexc(0), tf);
  /* mundos oscuros: la piedra más fría y oscura, pero sin bajar a negro */
  R.tint = clerp(hexc(0xffffff), cscale(hexc(0xffffff), 1), 0);
  { float dk = R.uDark; R.tint.r = 1 + (0.46f - 1) * dk; R.tint.g = 1 + (0.48f - 1) * dk; R.tint.b = 1 + (0.64f - 1) * dk; }
  R.panoA = A->pano; R.panoB = B->pano; R.panoT = tf;
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
  static const char *const aHud[] = { "aPos", "aCol", "aLocal", "aBox", "aTex", NULL };
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
  PP.pBright = program(VS_SKY, FS_BRIGHT, aMesh); PP.pDown = program(VS_SKY, FS_DOWN, aMesh); PP.pUp = program(VS_SKY, FS_UP, aMesh); PP.pPost = program(VS_SKY, FS_POST, aMesh);
  if (!R.pTun || !R.pBox || !R.pCoin || !R.pPad || !R.pSky || !R.pFlash || !R.pHud) return 1;
  {
    static const char *P[5] = { "sky_islas", "sky_selva", "sky_noche", "sky_templo", "sky_volcan" };
    R.tAlb = tex_load("stone_albedo", 1, 1); R.tNrm = tex_load("stone_normal", 0, 1); R.tOrm = tex_load("stone_orm", 0, 1);
    R.tCAlb = tex_load("crystal_albedo", 1, 1); R.tCNrm = tex_load("crystal_normal", 0, 1);
    for (i = 0; i < 5; i++) R.tPano[i] = tex_load(P[i], 1, 0);
  }
  {
    static const char *const aKit[] = { "aPos", "aNrm", "aUv", "aTan", "aCol", "aC0", "aC1", "aC2", "aC3", "aN0", "aN1", "aWarn", NULL };
    static const char *TN[4] = { "tile_stone", "tile_arch", "tile_crystal", "tile_crystal_arch" };
    static const int sizes[7] = { 3, 3, 3, 3, 3, 3, 4 };
    int ok = 1;
    R.pCell = program(VS_CELL, FS_KIT, aKit);
    R.pModel = program(VS_MODEL, FS_KIT, aKit);
    for (i = 0; i < 4; i++) {
      ok &= !model_load(&R.tile[i], "glb_tunnel_kit", TN[i]);
      glGenBuffers(1, &R.tileVbo[i]); glBindBuffer(GL_ARRAY_BUFFER, R.tileVbo[i]);
      glBufferData(GL_ARRAY_BUFFER, sizeof kitI[0], NULL, GL_DYNAMIC_DRAW);
      model_bind_instances(&R.tile[i], R.tileVbo[i], 5, 7, sizes);
    }
    model_load(&R.mRib, "glb_rib_stone", NULL); model_load(&R.mCry, "glb_crystal_cluster", NULL);
    model_load(&R.mVine, "glb_vine_edge", NULL); model_load(&R.mHang, "glb_vine_hang", NULL);
    {
      static const char *DN[9] = { "glb_island_a", "glb_island_b", "glb_island_c", "glb_island_castle", "glb_cloud", "glb_crystal", "glb_ruin_arch", "glb_volcano", "glb_coin" };
      for (i = 0; i < 9; i++) model_load(&R.mDecor[i], DN[i], NULL);
      if (!model_load(&R.mCoin, "glb_coin", NULL)) {
        /* como coins.js: centrada y con 0,9 de lado mayor en su plano */
        float mn[3] = { 1e9f, 1e9f, 1e9f }, mx[3] = { -1e9f, -1e9f, -1e9f }; int j, k;
        for (j = 0; j < R.mCoin.n; j++) for (k = 0; k < 3; k++) { if (R.mCoin.p[j].bmin[k] < mn[k]) mn[k] = R.mCoin.p[j].bmin[k]; if (R.mCoin.p[j].bmax[k] > mx[k]) mx[k] = R.mCoin.p[j].bmax[k]; }
        R.coinFix[0] = 0.9f / ((mx[0] - mn[0]) > (mx[1] - mn[1]) ? (mx[0] - mn[0]) : (mx[1] - mn[1]));
        R.coinFix[1] = (mn[0] + mx[0]) / 2; R.coinFix[2] = (mn[1] + mx[1]) / 2; R.coinFix[3] = (mn[2] + mx[2]) / 2;
      }
    }
    R.pFx = program(VS_FX, FS_FX, aKit);
    glGenVertexArrays(1, &R.fxVao); glBindVertexArray(R.fxVao);
    glGenBuffers(1, &R.fxVbo); glBindBuffer(GL_ARRAY_BUFFER, R.fxVbo);
    glBufferData(GL_ARRAY_BUFFER, 70 * 6 * 16 * 4, NULL, GL_DYNAMIC_DRAW);
    { int loc, off = 0; static const int sz[5] = { 3, 3, 2, 4, 4 };
      for (loc = 0; loc < 5; loc++) { glEnableVertexAttribArray((GLuint)loc); glVertexAttribPointer((GLuint)loc, sz[loc], GL_FLOAT, GL_FALSE, 64, (void *)(size_t)(off * 4)); off += sz[loc]; } }
    glBindVertexArray(0);
    ok &= !model_load(&R.boxBlock, "glb_boxes_kit", "box_block");
    ok &= !model_load(&R.boxCrystal, "glb_boxes_kit", "box_crystal");
    R.kitOk = ok && R.pCell && R.pModel;
    if (!R.kitOk) fprintf(stderr, "kit de Blender no disponible: túnel plano\n");
  }
  R.box = make_rounded_box(); R.coin = make_coin(); R.plane = make_plane(); R.full = make_fullscreen();
  tunnel_gl_init();
  R.fogFar = 118; R.fogNear = 40; R.skyUp = v3(0, 1, 0); R.hemiI = 1; R.satAmt = 1.14f; R.keyFollow = 0.5;
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
static void kit_put(int var, V3 c0, V3 c1, V3 c2, V3 c3, V3 n0, V3 n1, float w0, float w1, float w2, float w3) {
  float *o;
  if (R.tileN[var] >= KMAX) return;
  o = &kitI[var][R.tileN[var]++ * KI];
#define PUT(v) do { V3 q_ = (v); *o++ = (float)q_.x; *o++ = (float)q_.y; *o++ = (float)q_.z; } while (0)
  PUT(vsub(c0, R.origin)); PUT(vsub(c1, R.origin)); PUT(vsub(c2, R.origin)); PUT(vsub(c3, R.origin)); PUT(n0); PUT(n1);
#undef PUT
  *o++ = w0; *o++ = w1; *o++ = w2; *o++ = w3;
}

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
  R.tileN[0] = R.tileN[1] = R.tileN[2] = R.tileN[3] = 0;
  for (k = kNear; k <= kLast && q < NQ; k++) {
    const Frame *ra = track_ring(&R.tr, k), *rb = track_ring(&R.tr, k + 1);
    if (!ra || !rb) continue;
    if (game_in_gap(g, k)) continue;
    /* lámina abierta: faldón de sillería de 1,5 m bajo cada borde (tunnelkit.js) */
    if (R.kitOk && !(g->fold == 30 || g->fold == -30)) {
      int side;
      for (side = 0; side < 2; side++) {
        int c0 = side ? LANES - 1 : 0;
        double vx = sec.b[side ? LANES * 2 : 0], vy = sec.b[side ? LANES * 2 + 1 : 1];
        double tx = sec.d[c0 * 2], ty = sec.d[c0 * 2 + 1], nx = -ty, ny = tx;
        double lx = vx - nx * 1.5, ly = vy - ny * 1.5;
        double ax = side ? vx : lx, ay = side ? vy : ly, bx = side ? lx : vx, by = side ? ly : vy;
        double ox = side ? tx : -tx, oy = side ? ty : -ty;
        V3 n0 = vadd(vscale(ra->X, ox), vscale(ra->U, oy)), n1 = vadd(vscale(rb->X, ox), vscale(rb->U, oy));
        kit_put(T_STONE, track_to_world(ra, ax, ay), track_to_world(ra, bx, by), track_to_world(rb, bx, by), track_to_world(rb, ax, ay), n0, n1, 0, 0, 0, 0);
      }
    }
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
      if (R.kitOk) {
        int arch = (k & 3) == 0, lit = wa > 0;
        int var = lit ? (arch ? T_CRYSTAL_ARCH : T_CRYSTAL) : (arch ? T_ARCH : T_STONE);
        if (lit) kit_put(var, P[0], P[1], P[2], P[3], Nr[0], Nr[2], wr, wg, wb, wa);
        else kit_put(var, P[0], P[1], P[2], P[3], Nr[0], Nr[2], (k & 7) == 0 ? 1.f : 0.f, 0, 0, 0);
      }
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

/* ---------------------------------------------------------------- adornos del túnel (tunnelprops.js) */
static double minf(double a, double b) { return a < b ? a : b; }
static double hh(double a, double b) { double x = sin(a * 127.1 + b * 311.7) * 43758.5453; return x - floor(x); }
static void prop_add(int m, V3 X, V3 Y, V3 Z, V3 p) {
  if (R.nProps >= 400) return;
  R.props[R.nProps].m = m; R.props[R.nProps].x = m4_basis(X, Y, Z, vsub(p, R.origin)); R.nProps++;
}
static void props_update(const Game *g) {
  Section sec;
  int k, c, closed = g->fold == 30 || g->fold == -30, kNear = (int)floor(g->s) - 2;
  R.nProps = 0;
  if (!R.kitOk) return;
  track_section(g->fold, &sec);
  for (k = kNear; k <= game_klast(g); k++) {
    const Frame *r = track_ring(&R.tr, k), *r2 = track_ring(&R.tr, k + 1);
    int rib = k % 8 == 0, side;
    if (!r || game_in_gap(g, k)) continue;
    for (c = 0; c < LANES; c++) {
      const double *b = sec.b, *d = sec.d;
      double tx = d[c * 2], ty = d[c * 2 + 1];
      V3 T = vadd(vscale(r->X, tx), vscale(r->U, ty));
      V3 N = vadd(vscale(r->X, -ty), vscale(r->U, tx)), O = vscale(N, -1);
      V3 p = track_to_world(r, (b[c * 2] + b[c * 2 + 2]) / 2, (b[c * 2 + 1] + b[c * 2 + 3]) / 2);
      if (rib && R.mRib.n) prop_add(0, T, O, r->F, vmad(p, O, 0.3));
      if (rib && R.mCry.n && (c & 1) == 0) prop_add(1, vscale(T, 1.6), vscale(O, 1.6), vscale(r->F, 1.6), vmad(track_to_world(r, b[c * 2], b[c * 2 + 1]), O, 0.6));
      if (R.mVine.n && r2 && hh(k, c) < 0.22) {
        V3 q = vlerp(track_to_world(r, b[c * 2], b[c * 2 + 1]), track_to_world(r2, b[c * 2], b[c * 2 + 1]), 0.5);
        prop_add(2, T, O, r->F, vmad(q, O, 0.36));
      }
    }
    /* lámina abierta: enredaderas que cuelgan por el faldón y cristales en el canto */
    if (!closed) for (side = 0; side < 2; side++) {
      int c0 = side ? LANES - 1 : 0;
      double tx = sec.d[c0 * 2], ty = sec.d[c0 * 2 + 1], sg = side ? 1 : -1;
      V3 N = vadd(vscale(r->X, -ty), vscale(r->U, tx));
      V3 T = vadd(vscale(r->X, tx * sg), vscale(r->U, ty * sg));
      V3 p = track_to_world(r, sec.b[side ? LANES * 2 : 0], sec.b[side ? LANES * 2 + 1 : 1]);
      if (R.mHang.n && hh(k, 20 + side) < 0.6) {
        V3 O = vnorm(vcross(r->F, N));
        double sy = 1.0 + 0.9 * hh(k, 30 + side);
        prop_add(3, vscale(r->F, 2.2), vscale(N, sy), vscale(O, 2.2), vmad(vmad(p, T, 0.06), N, 0.02));
      }
      if (R.mCry.n && k % 6 == side * 3) {
        V3 O = vnorm(vcross(T, r->F));
        prop_add(1, vscale(O, 1.8), vscale(T, 1.8), vscale(r->F, 1.8), vmad(vmad(p, N, -0.5), T, 0.1));
      }
    }
  }
}

/* ---------------------------------------------------------------- decorado lejano (decor.js) */
enum { D_ISLA_A, D_ISLA_B, D_ISLA_C, D_CASTILLO, D_NUBE, D_CRISTAL, D_ARCO, D_VOLCAN };
static const int KINDS[3][7] = {
  { D_CASTILLO, D_ISLA_A, D_ISLA_B, D_NUBE, D_ISLA_C, D_ARCO, D_NUBE },
  { D_ISLA_B, D_CRISTAL, D_CASTILLO, D_NUBE, D_CRISTAL, D_ARCO, -1 },
  { D_VOLCAN, D_ISLA_C, D_CRISTAL, D_ARCO, D_ISLA_A, -1, -1 },
};
static void dec_place(int i, const Game *g, int far) {
  int kk = game_klast(g) - (far ? 0 : (int)(frand() * 20)), kind = R.dec[i].kind;
  const Frame *r = track_ring(&R.tr, kk);
  double side = frand() < 0.5 ? -1 : 1, lateral, vertical, ahead;
  int isl = kind <= D_CASTILLO || kind == D_VOLCAN, low;
  V3 up = R.camUp, s3;
  if (!r) return;
  lateral = side * (kind == D_VOLCAN ? 260 + frand() * 120 : 120 + frand() * 110);
  low = frand() < (isl ? 0.92 : 0.7);
  vertical = kind == D_NUBE ? (low ? -55 + frand() * 30 : 45 + frand() * 40) : (low ? -75 + frand() * 45 : 45 + frand() * 30);
  ahead = 120 + frand() * 520;
  s3 = vcross(r->F, up); if (vlen(s3) < 1e-2) s3 = r->X; s3 = vnorm(s3);
  R.dec[i].pos = vadd(vadd(vadd(r->P, vscale(r->F, ahead)), vscale(s3, lateral)), vscale(up, vertical));
  R.dec[i].up = up; R.dec[i].yaw = frand() * 6.283;
  R.dec[i].k = kk + ahead / 4; R.dec[i].placed = 1;
}
static void decor_update(const Game *g, double dt) {
  int i, j, want = R.decTheme;
  static int built = -1;
  R.camUp = R.camY;
  if (built != want) {
    int n = 0;
    for (i = 0; i < 24; i++) {
      int kind = KINDS[want][i % 7];
      if (kind < 0) kind = KINDS[want][i % 5];
      R.dec[n].kind = kind; R.dec[n].placed = 0; R.dec[n].spin = (frand() - 0.5) * 0.2;
      R.dec[n].scale = (kind == D_VOLCAN ? 1.2 : kind <= D_CASTILLO || kind == D_ARCO ? 1.6 : 1) * (0.75 + frand() * 0.5);
      R.dec[n].checkT = 0; n++;
    }
    R.nDec = n; built = want;
  }
  R.decUp = vnorm(vlerp(vlen(R.decUp) > 0.5 ? R.decUp : R.camUp, R.camUp, minf(1, dt * 0.8)));
  for (i = 0; i < R.nDec; i++) {
    if (!R.dec[i].placed) dec_place(i, g, 0);
    else if (R.dec[i].k < g->s - 30) dec_place(i, g, 1);
    R.dec[i].yaw += R.dec[i].spin * dt;
    R.dec[i].up = vnorm(vlerp(R.dec[i].up, R.decUp, minf(1, dt * 0.6)));
    if ((R.dec[i].checkT -= dt) <= 0) {
      R.dec[i].checkT = 0.25;
      for (j = (int)floor(g->s); j <= game_klast(g); j += 3) { const Frame *r = track_ring(&R.tr, j); if (r && vlen(vsub(r->P, R.dec[i].pos)) < 90) { dec_place(i, g, 1); break; } }
    }
  }
}

/* ---------------------------------------------------------------- vida (life.js) y líneas (streaks.js) */
typedef struct { int dot; unsigned cols[5]; int n; double size; } LifeKind;
static const LifeKind LK[5] = {
  { 0, { 0x7fc24a, 0xa8d45a, 0xe6c35a }, 3, 0.32 }, { 0, { 0x4fae4a, 0x8fd060, 0x3f8f3a }, 3, 0.36 },
  { 1, { 0x9dfff0, 0xd8ff8a }, 2, 0.22 }, { 0, { 0xffb0c8, 0xffd6a0, 0xff9ab8 }, 3, 0.3 }, { 1, { 0xffa050, 0xff6a30 }, 2, 0.18 },
};
static float fxV[70 * 6 * 16]; static int fxN;
static void fx_vert(V3 p, float u, float v, C3 c, float a) {
  float *o = &fxV[fxN++ * 16]; V3 q = vsub(p, R.origin);
  memset(o, 0, 64); o[0] = (float)q.x; o[1] = (float)q.y; o[2] = (float)q.z; o[6] = u; o[7] = v; o[12] = c.r; o[13] = c.g; o[14] = c.b; o[15] = a;
}
static void life_spawn(int i, V3 look, V3 up, V3 right, int outside, int near) {
  double a = frand() * 6.283, r = outside ? 3.5 + frand() * 5 : 2.7 + frand() * 0.8, ca = cos(a), sa = sin(a), d;
  if (outside && sa < -0.2) sa = -sa;
  d = near ? 4 + frand() * 20 : 18 + frand() * 8;
  R.life[i].pos = vadd(vadd(vadd(R.pos, vscale(look, d)), vscale(right, ca * r)), vscale(up, sa * r + (outside ? 0.5 : 3.2)));
  R.life[i].live = 1;
}
static void life_update(double dt, int outside) {
  const LifeKind *K; int i, kind = R.themeIdx % 5;
  V3 look = vscale(R.camZ, -1), up = R.camY, right = R.camX;
  if (kind != R.lifeKind || !R.life[0].spin) {
    R.lifeKind = kind;
    for (i = 0; i < 70; i++) { R.life[i].col = LK[kind].cols[(int)(frand() * LK[kind].n) % LK[kind].n]; R.life[i].rot = frand() * 6.28; R.life[i].spin = (frand() - 0.5) * 6 + 0.001; R.life[i].flut = frand() * 6.28; }
  }
  K = &LK[kind];
  fxN = 0;
  if (R.invert > 0.5) { for (i = 0; i < 70; i++) R.life[i].live = 0; return; }
  for (i = 0; i < 70; i++) {
    V3 rel; double ahead, lat, s, sy, c, sn; C3 col; V3 ax, ay;
    if (outside && (i & 1)) continue;
    if (!R.life[i].live) life_spawn(i, look, up, right, outside, 1);
    rel = vsub(R.life[i].pos, R.pos); ahead = vdot(rel, look);
    if (ahead < -1 || vdot(rel, rel) > 8100) life_spawn(i, look, up, right, outside, 0);
    rel = vsub(R.life[i].pos, R.pos); ahead = vdot(rel, look);
    lat = sqrt(pow(vdot(rel, right), 2) + pow(vdot(rel, up), 2));
    if (ahead > 0 && lat < ahead * 0.12 + 0.7) life_spawn(i, look, up, right, outside, 0);
    R.life[i].flut += dt * 3; R.life[i].rot += R.life[i].spin * dt;
    R.life[i].pos = vadd(vadd(R.life[i].pos, vscale(up, (K->dot ? 0.15 * sin(R.life[i].flut) : -0.35) * dt)), vscale(right, 0.3 * sin(R.life[i].flut * 0.7) * dt));
    s = K->size * (outside ? 0.6 : 1) * (0.7 + 0.6 * ((R.life[i].col & 7) / 7.0)) * (K->dot ? 1 : 0.9 + 0.3 * fabs(sin(R.life[i].flut)));
    sy = K->dot ? s : s * 1.4;
    col = cscale(hexc(R.life[i].col), K->dot ? 1.8f : 1.0f);
    c = cos(R.life[i].rot); sn = sin(R.life[i].rot);
    ax = vadd(vscale(right, c * s * 0.5), vscale(up, sn * s * 0.5));
    ay = vadd(vscale(right, -sn * sy * 0.5), vscale(up, c * sy * 0.5));
    {
      V3 p = R.life[i].pos, p00 = vsub(vsub(p, ax), ay), p10 = vsub(vadd(p, ax), ay), p11 = vadd(vadd(p, ax), ay), p01 = vadd(vsub(p, ax), ay);
      fx_vert(p00, 0, 0, col, 1); fx_vert(p10, 1, 0, col, 1); fx_vert(p11, 1, 1, col, 1);
      fx_vert(p00, 0, 0, col, 1); fx_vert(p11, 1, 1, col, 1); fx_vert(p01, 0, 1, col, 1);
    }
  }
}
static float stV[44 * 2 * 16]; static int stN; static float stOpacity; static int stAdd;
static void streaks_update(double dt, int outside, double sp01) {
  double tanV = tan(R.fov * DEG / 2), speed = 60 + sp01 * 120 + R.kick * 120, len = 2 + sp01 * 9 + R.kick * 10, D = 9;
  C3 fog = R.uFog, c; float bright = (fog.r + fog.g + fog.b) / 3; int light = bright > 0.6f && !outside, i;
  if (!R.stkInit) { for (i = 0; i < 44; i++) { R.stk[i].a = frand() * 6.283; R.stk[i].r = 0.55 + frand() * 0.5; { double z0 = -D * R.stk[i].r / 0.42; R.stk[i].z = z0 + frand() * (-z0 - 2); } R.stk[i].v = 0.8 + frand() * 0.5; } R.stkInit = 1; }
  c = hexc(light ? 0x3a3170 : bright > 0.5f ? 0xffffff : 0xfff1c9);
  if (outside) c = clerp(c, fog, 0.5f);
  stAdd = !light; stN = 0;
  for (i = 0; i < 44; i++) {
    double z0, z1, X, Y, f;
    R.stk[i].z += speed * R.stk[i].v * dt;
    if (R.stk[i].z > -2) { R.stk[i].a = frand() * 6.283; R.stk[i].r = 0.55 + frand() * 0.5; R.stk[i].z = -D * R.stk[i].r / 0.42 - frand() * 6; R.stk[i].v = 0.8 + frand() * 0.5; }
    z0 = R.stk[i].z; z1 = z0 + len < -1 ? z0 + len : -1;
    X = cos(R.stk[i].a) * R.stk[i].r * R.aspect * D * tanV; Y = sin(R.stk[i].a) * R.stk[i].r * D * tanV;
    f = (z0 + D * R.stk[i].r / 0.42) / 6; f = f > 1 ? 1 : f;
    {
      V3 a = vadd(vadd(vadd(R.pos, vscale(R.camX, X)), vscale(R.camY, Y)), vscale(R.camZ, -z0));
      V3 b = vadd(vadd(vadd(R.pos, vscale(R.camX, X)), vscale(R.camY, Y)), vscale(R.camZ, -z1));
      int k; float *o;
      for (k = 0; k < 2; k++) {
        V3 q = vsub(k ? b : a, R.origin);
        o = &stV[stN++ * 16]; memset(o, 0, 64);
        o[0] = (float)q.x; o[1] = (float)q.y; o[2] = (float)q.z; o[12] = (float)(c.r * f); o[13] = (float)(c.g * f); o[14] = (float)(c.b * f); o[15] = 1;
      }
    }
  }
  stOpacity = (float)(minf(0.55, (sp01 - 0.25 > 0 ? sp01 - 0.25 : 0) * 0.5 + R.kick * 0.4) * (1 - R.invert * 0.3) * (outside ? 0.5 : 1) * (light ? 0.6 : 1));
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
    bd->glow = (float)g1; bd->col = COLORS[b->color % 10]; bd->flat = b->fixed ? 0 : 1;   /* flat: rodante de cristal */
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
  sp01 = clamp01((game_speed_ms(g) - 36) / 64); R.sp01 = sp01;
  fov = R.baseFov + sp01 * 14 + (R.kick <= 0 ? 0 : sin(minf(1, R.kick) * M_PI * 0.5)) * (o.reduceFx ? 4 : 12) * (R.kickAmp ? R.kickAmp : 1)
      + (R.foldFov > 0 ? sin(minf(1, (1.2 - R.foldFov) / 1.2) * M_PI) * 8 : 0);
  if (R.foldFov > 0) R.foldFov -= dt;
  R.kick = R.kick - dt * 1.8; if (R.kick < 0) R.kick = 0;
  R.fov = fov;

  /* ---- mundo */
  /* la luz del túnel va con la cámara (arriba, algo por detrás y a la izquierda) */
  R.key = vnorm(vadd(vadd(vscale(R.upS, 0.85), vscale(R.look, -0.35)), vscale(vnorm(vcross(R.look, R.upS)), -0.4)));
  /* sol fijo en la pista (un lado del tubo al sol, el otro en sombra de color) y una parte que
     sigue a la cámara para que tu cara nunca quede a oscuras (index.js) */
  {
    V3 trackKey = vnorm(vadd(vadd(vscale(fr.U, 0.8), vscale(fr.X, -0.5)), vscale(fr.F, -0.3)));
    double want = g->fold < 29 ? 0.8 : 0.5;
    R.keyFollow += (want - R.keyFollow) * minf(1, dt * 1.5);
    R.sunDir = vnorm(vlerp(trackKey, R.key, R.keyFollow));
    R.fwd = fr.F;
  }
  for (i = 0; i < g->nGaps; i++) if (g->gaps[i].from - s < 34 && g->gaps[i].to - s > -6) gapNear = 1;
  R.inside = gapNear ? 0 : clamp01((g->fold - 20) / 10);
  outside = g->fold < 29 || gapNear;
  fogFar = (outside ? 190 : 120) * (1 + 0.3 * (R.landT > 0 ? R.landT / 1.5 : 0));
  if (R.landT > 0) R.landT -= dt;
  R.fogFar += (fogFar - R.fogFar) * minf(1, dt * 2);
  R.fogNear = R.fogFar * 0.3;
  R.hit = R.hit - dt * 3; if (R.hit < 0) R.hit = 0;
  tunnel_update(g, dt);
  props_update(g);
  decor_update(g, dt);
  life_update(dt, outside);
  streaks_update(dt, outside, sp01);
  flashId = !g->alive && R.deathT > 0 && ((int)floor(R.deathT * 10)) % 2 ? g->killer : 0;
  boxes_update(g, dt, flashId);
  R.outside += ((g->fold < 29 ? 1 : 0) - R.outside) * minf(1, dt * 2);
  pads_update(g, dt);
  coins_update(g, dt);
  /* cielo: su "arriba" es el de la pista, suavizado; solo se ve por fuera */
  /* el horizonte del paisaje sigue sobre todo a la cámara: queda casi a nivel en la vista */
  R.skyUp = vnorm(vlerp(R.skyUp, vnorm(vlerp(fr.U, R.upS, 0.7)), minf(1, dt * 1.5)));
  R.skyTime += dt; R.seaTime += dt;
  R.skyVis += ((outside ? 1 : 0) - R.skyVis) * minf(1, dt * 3);
  R.skyOn = 1;   /* por los arcos del túnel el cielo se ve siempre */
  R.seaAlpha = (float)(R.skyVis * (1 - R.invert));
  R.seaOn = 0;   /* con paisaje de 360° el mar de nubes sobra */
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
static float linearOut;
static void kit_uniforms(GLuint p, const M4 *vp) {
  glUseProgram(p); u1(p, "uSatAmt", R.satAmt); u1(p, "uLinear", linearOut);
  um(p, "uVP", vp); u3(p, "uCam", 0, 0, 0);
  uc(p, "uFog", R.uFog); u1(p, "uFogNear", (float)R.fogNear); u1(p, "uFogFar", (float)R.fogFar); u1(p, "uUseFog", 1);
  uv(p, "uSunDir", R.sunDir); uc(p, "uSunCol", R.sunCol); uc(p, "uShadowCol", R.shadowCol); uc(p, "uRimCol", R.rimCol);
  uc(p, "uInlay", R.inlay); uc(p, "uSeamGlow", R.seamGlow); uc(p, "uTint", R.tint); u1(p, "uGlowK", R.uDark > 0.5f ? 1.4f : 1.0f);
  u1(p, "uInvert", (float)R.invert); uc(p, "uInvBase", R.uInvBase); u1(p, "uHit", (float)R.hit);
  bind_tex(p, "tAlb", 0, R.tAlb); bind_tex(p, "tNrm", 1, R.tNrm); bind_tex(p, "tOrm", 2, R.tOrm); bind_tex(p, "tCAlb", 3, R.tCAlb); bind_tex(p, "tCNrm", 4, R.tCNrm);
  u3(p, "uBlocks", 1, 1, 1); u3(p, "uEmis", 0, 0, 0); u1(p, "uAlphaK", 1);
}
static int is_mat(const Prim *pr, const char *m) { return strstr(pr->mat, m) != NULL; }

/* ---------------------------------------------------------------- posproceso: HDR + bloom + gradación */
static GLuint hdr_tex(int w, int h) {
  GLuint t; glGenTextures(1, &t); glBindTexture(GL_TEXTURE_2D, t);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA16F, w, h, 0, GL_RGBA, GL_HALF_FLOAT, NULL);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  return t;
}
static void post_setup(int w, int h) {
  int i, ok = 1; GLint prev = 0;
  if (!PP.pPost || getenv("HIP_NOPOST")) { PP.ok = 0; return; }
  if (PP.w == w && PP.h == h && PP.ok) return;
  glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &prev);
  PP.w = w; PP.h = h;
  if (!PP.msFbo) { glGenFramebuffers(1, &PP.msFbo); glGenRenderbuffers(1, &PP.msCol); glGenRenderbuffers(1, &PP.msDep); glGenFramebuffers(1, &PP.resFbo); for (i = 0; i < NLV; i++) glGenFramebuffers(1, &PP.lvFbo[i]); }
  glBindFramebuffer(GL_FRAMEBUFFER, PP.msFbo);
  glBindRenderbuffer(GL_RENDERBUFFER, PP.msCol); glRenderbufferStorageMultisample(GL_RENDERBUFFER, MSAA_N, GL_RGBA16F, w, h);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, PP.msCol);
  glBindRenderbuffer(GL_RENDERBUFFER, PP.msDep); glRenderbufferStorageMultisample(GL_RENDERBUFFER, MSAA_N, GL_DEPTH_COMPONENT24, w, h);
  glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, PP.msDep);
  ok &= glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
  PP.resTex = hdr_tex(w, h);
  glBindFramebuffer(GL_FRAMEBUFFER, PP.resFbo); glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, PP.resTex, 0);
  ok &= glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
  for (i = 0; i < NLV; i++) {
    PP.lw[i] = (w >> (i + 1)) > 1 ? (w >> (i + 1)) : 1; PP.lh[i] = (h >> (i + 1)) > 1 ? (h >> (i + 1)) : 1;
    PP.lvTex[i] = hdr_tex(PP.lw[i], PP.lh[i]);
    glBindFramebuffer(GL_FRAMEBUFFER, PP.lvFbo[i]); glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, PP.lvTex[i], 0);
    ok &= glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)prev);
  PP.ok = ok;
  if (!ok) fprintf(stderr, "sin posproceso HDR (FBO incompleto)\n");
}
static void fs_draw(GLuint p, GLuint tex, int w, int h, const char *su) {
  glViewport(0, 0, w, h);
  glUseProgram(p); bind_tex(p, su, 0, tex);
  glBindVertexArray(R.full.vao);
  glDrawElements(GL_TRIANGLES, R.full.nIdx, GL_UNSIGNED_SHORT, 0);
}
static void post_finish(GLint outFbo) {
  int i;
  glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE); glDisable(GL_BLEND); glDepthMask(GL_FALSE);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, PP.msFbo); glBindFramebuffer(GL_DRAW_FRAMEBUFFER, PP.resFbo);
  glBlitFramebuffer(0, 0, PP.w, PP.h, 0, 0, PP.w, PP.h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  /* brillo a media resolución y cadena de bajadas */
  glBindFramebuffer(GL_FRAMEBUFFER, PP.lvFbo[0]);
  glUseProgram(PP.pBright); u2(PP.pBright, "uTexel", 0.5f / PP.lw[0], 0.5f / PP.lh[0]); u1(PP.pBright, "uThr", 1.22f);
  fs_draw(PP.pBright, PP.resTex, PP.lw[0], PP.lh[0], "tSrc");
  for (i = 1; i < NLV; i++) {
    glBindFramebuffer(GL_FRAMEBUFFER, PP.lvFbo[i]);
    glUseProgram(PP.pDown); u2(PP.pDown, "uTexel", 1.0f / PP.lw[i - 1], 1.0f / PP.lh[i - 1]);
    fs_draw(PP.pDown, PP.lvTex[i - 1], PP.lw[i], PP.lh[i], "tSrc");
  }
  /* subidas sumando cada nivel al de arriba */
  glEnable(GL_BLEND); glBlendFunc(GL_ONE, GL_ONE);
  for (i = NLV - 1; i > 0; i--) {
    glBindFramebuffer(GL_FRAMEBUFFER, PP.lvFbo[i - 1]);
    glUseProgram(PP.pUp); u2(PP.pUp, "uTexel", 1.0f / PP.lw[i], 1.0f / PP.lh[i]); u1(PP.pUp, "uK", 0.8f);
    fs_draw(PP.pUp, PP.lvTex[i], PP.lw[i - 1], PP.lh[i - 1], "tSrc");
  }
  glDisable(GL_BLEND);
  /* composición */
  glBindFramebuffer(GL_FRAMEBUFFER, (GLuint)outFbo);
  glUseProgram(PP.pPost); u1(PP.pPost, "uSatAmt", R.satAmt); u1(PP.pPost, "uLinear", 0);
  bind_tex(PP.pPost, "tBloom", 1, PP.lvTex[0]);
  u1(PP.pPost, "uBloomK", 0.5f); u1(PP.pPost, "uVig", 0.1f); uc(PP.pPost, "uVigCol", hexc(0x2b2257));
  u1(PP.pPost, "uBlur", (float)(R.sp01 * 0.016 + (R.kick > 0 ? R.kick : 0) * 0.05));
  fs_draw(PP.pPost, PP.resTex, R.w, R.h, "tScene");
  glDepthMask(GL_TRUE);
}
static void set_common(GLuint p) { u1(p, "uSatAmt", R.satAmt); u1(p, "uLinear", linearOut); }

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

  GLint outFbo = 0;
  glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &outFbo);
  post_setup(R.w, R.h);
  linearOut = PP.ok ? 1.f : 0.f;
  if (PP.ok) glBindFramebuffer(GL_FRAMEBUFFER, PP.msFbo);
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
    if (PP.ok) glClearColor(f.r, f.g, f.b, 1); else glClearColor(c[0], c[1], c[2], 1);
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
    bind_tex(p, "tPanoA", 0, R.tPano[R.panoA]); bind_tex(p, "tPanoB", 1, R.tPano[R.panoB]); u1(p, "uPanoT", R.panoT);
    uv(p, "uFwd", R.fwd); u1(p, "uIn", (float)R.inside);
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

  /* decorado lejano (islas, nubes, cristales, ruinas, volcanes): mate, sin niebla, con perspectiva aérea */
  if (R.kitOk) {
    GLuint p = R.pModel;
    int pass;
    kit_uniforms(p, &vp); u1(p, "uUseFog", 0); uc(p, "uAirCol", R.airCol);
    for (pass = 0; pass < 2; pass++) {       /* 0: opaco, 1: cascadas transparentes */
      if (pass) { glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA); glDepthMask(GL_FALSE); }
      for (i = 0; i < R.nDec; i++) {
        const Model *md = &R.mDecor[R.dec[i].kind];
        V3 u = R.dec[i].up, ref = fabs(u.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1), a = vnorm(vcross(ref, u));
        V3 X = vadd(vscale(a, cos(R.dec[i].yaw)), vscale(vcross(u, a), sin(R.dec[i].yaw))), Z = vcross(X, u);
        double sc = R.dec[i].scale;
        M4 mm = m4_basis(vscale(X, sc), vscale(u, sc), vscale(Z, sc), vsub(R.dec[i].pos, R.origin));
        int j;
        if (!R.dec[i].placed) continue;
        um(p, "uModel", &mm);
        for (j = 0; j < md->n; j++) {
          const Prim *pr = &md->p[j];
          if (pr->blend != pass) continue;
          glUniform1i(U(p, "uMode"), pr->blend ? 7 : 6);
          u3(p, "uColor", pr->color[0] * 0.9f, pr->color[1] * 0.9f, pr->color[2] * 0.9f);
          u3(p, "uEmis", pr->emissive[0] * 0.6f, pr->emissive[1] * 0.6f, pr->emissive[2] * 0.6f);
          glBindVertexArray(pr->vao);
          glDrawElements(GL_TRIANGLES, pr->nIdx, GL_UNSIGNED_INT, 0);
        }
      }
      if (pass) { glDisable(GL_BLEND); glDepthMask(GL_TRUE); }
    }
  }

  /* túnel: losas del kit de Blender, instanciadas */
  if (R.kitOk) {
    GLuint p = R.pCell;
    int v, j;
    kit_uniforms(p, &vp);
    glEnable(GL_CULL_FACE); glCullFace(GL_BACK); glFrontFace(GL_CCW);
    for (v = 0; v < 4; v++) {
      if (!R.tileN[v]) continue;
      glBindBuffer(GL_ARRAY_BUFFER, R.tileVbo[v]);
      glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(R.tileN[v] * KI * sizeof(float)), kitI[v]);
      for (j = 0; j < R.tile[v].n; j++) {
        const Prim *pr = &R.tile[v].p[j];
        glUniform1i(U(p, "uMode"), is_mat(pr, "crystal") ? 1 : 0);
        glBindVertexArray(pr->vao);
        glDrawElementsInstanced(GL_TRIANGLES, pr->nIdx, GL_UNSIGNED_INT, 0, R.tileN[v]);
      }
    }
    glDisable(GL_CULL_FACE);
  } else
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
    bind_tex(p, "tAlb", 0, R.tAlb); bind_tex(p, "tNrm", 1, R.tNrm); bind_tex(p, "tOrm", 2, R.tOrm); bind_tex(p, "tCAlb", 3, R.tCAlb); bind_tex(p, "tCNrm", 4, R.tCNrm);
    uv(p, "uSunDir", R.sunDir); uc(p, "uSunCol", R.sunCol); uc(p, "uShadowCol", R.shadowCol); uc(p, "uInlay", R.inlay);
    uc(p, "uSeamGlow", R.seamGlow); uc(p, "uTint", R.tint); u1(p, "uGlowK", R.uDark > 0.5f ? 1.4f : 1.0f);
    glBindVertexArray(tunVao);
    glBindBuffer(GL_ARRAY_BUFFER, tunVbo);
    glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(tunQuads * 4 * TV * sizeof(float)), tunV);
    glDrawElements(GL_TRIANGLES, tunQuads * 6, GL_UNSIGNED_SHORT, 0);
  }

  /* adornos del túnel: costillas, cristales y enredaderas (por fuera del tubo) */
  if (R.kitOk && R.nProps) {
    GLuint p = R.pModel;
    const Model *PM[4] = { &R.mRib, &R.mCry, &R.mVine, &R.mHang };
    kit_uniforms(p, &vp);
    for (i = 0; i < R.nProps; i++) {
      const Model *md = PM[R.props[i].m];
      int j;
      um(p, "uModel", &R.props[i].x);
      for (j = 0; j < md->n; j++) {
        const Prim *pr = &md->p[j];
        glUniform1i(U(p, "uMode"), 5);
        u3(p, "uColor", pr->color[0], pr->color[1], pr->color[2]);
        u3(p, "uEmis", pr->emissive[0], pr->emissive[1], pr->emissive[2]);
        glBindVertexArray(pr->vao);
        glDrawElements(GL_TRIANGLES, pr->nIdx, GL_UNSIGNED_INT, 0);
      }
    }
  }

  /* cajas del kit: piedra con runa (fijas) y cristal (rodantes); las largas en bloques cúbicos */
  if (R.kitOk) {
    GLuint p = R.pModel;
    kit_uniforms(p, &vp);
    glEnable(GL_CULL_FACE); glCullFace(GL_BACK);
    for (i = 0; i < R.nBoxDraw; i++) {
      BoxDraw *b = &R.boxes[i];
      const Model *md = b->flat ? &R.boxCrystal : &R.boxBlock;
      double w = b->scale.x;
      int nH = (int)floor(b->scale.y / w + 0.5), nL = (int)floor(b->scale.z / w + 0.5), a, c, j;
      nH = nH < 1 ? 1 : nH > 4 ? 4 : nH; nL = nL < 1 ? 1 : nL > 3 ? 3 : nL;
      uc(p, "uColor", b->col); u1(p, "uGlow", b->glow);
      for (a = 0; a < nH; a++) for (c = 0; c < nL; c++) {
        M4 sub = m4_basis(v3(1, 0, 0), v3(0, 1.0 / nH, 0), v3(0, 0, 1.0 / nL), v3(0, (a + 0.5) / nH - 0.5, (c + 0.5) / nL - 0.5));
        M4 mm = m4_mul(b->m, sub);
        um(p, "uModel", &mm);
        for (j = 0; j < md->n; j++) {
          const Prim *pr = &md->p[j];
          glUniform1i(U(p, "uMode"), b->flat ? 4 : is_mat(pr, "rune") ? 3 : 2);
          glBindVertexArray(pr->vao);
          glDrawElements(GL_TRIANGLES, pr->nIdx, GL_UNSIGNED_INT, 0);
        }
      }
    }
    glDisable(GL_CULL_FACE);
  } else
  /* cajas: primero el cuerpo y después el contorno (casco invertido, caras traseras) */
  {
    GLuint p = R.pBox;
    V3 key = vnorm(vadd(vadd(vscale(R.camX, -0.4), R.camY), vscale(R.camZ, 1.6)));
    glUseProgram(p); set_common(p);
    um(p, "uVP", &vp); uv(p, "uKey", key); u3(p, "uCam", 0, 0, 0); u1(p, "uHemiI", R.hemiI);
    bind_tex(p, "tAlb", 0, R.tAlb); uv(p, "uSunDir", R.sunDir); uc(p, "uSunCol", R.sunCol); uc(p, "uShadowCol", R.shadowCol);
    glBindVertexArray(R.box.vao);
    glEnable(GL_CULL_FACE); glFrontFace(GL_CCW); glCullFace(GL_BACK);
    for (i = 0; i < R.nBoxDraw; i++) {
      BoxDraw *b = &R.boxes[i];
      double w = b->scale.x;
      int nH = (int)floor(b->scale.y / w + 0.5), nL = (int)floor(b->scale.z / w + 0.5);
      nH = nH < 1 ? 1 : nH > 4 ? 4 : nH; nL = nL < 1 ? 1 : nL > 3 ? 3 : nL;
      um(p, "uModel", &b->m); uv(p, "uScale", b->scale); u1(p, "uOutlineW", 0);
      uc(p, "uColor", b->col); u1(p, "uGlow", b->glow); u1(p, "uFlat", 0); u1(p, "uCrystal", (float)b->flat);
      u3(p, "uBlocks", 1, (float)nH, (float)nL);
      glDrawElements(GL_TRIANGLES, R.box.nIdx, GL_UNSIGNED_SHORT, 0);
    }
    glDisable(GL_CULL_FACE);
  }

  /* monedas: el modelo de la web */
  if (R.kitOk && R.mCoin.n) {
    GLuint p = R.pModel;
    M4 fix = m4_basis(v3(R.coinFix[0], 0, 0), v3(0, R.coinFix[0], 0), v3(0, 0, R.coinFix[0]), v3(-R.coinFix[1] * R.coinFix[0], -R.coinFix[2] * R.coinFix[0], -R.coinFix[3] * R.coinFix[0]));
    kit_uniforms(p, &vp);
    glUniform1i(U(p, "uMode"), 8); uc(p, "uColor", hexc(0xffd23a)); uc(p, "uEmis", cscale(hexc(0xff9a00), 0.06f));
    for (i = 0; i < R.nCoinDraw; i++) {
      M4 mm = m4_mul(R.coinM[i], fix); int j;
      um(p, "uModel", &mm);
      for (j = 0; j < R.mCoin.n; j++) { glBindVertexArray(R.mCoin.p[j].vao); glDrawElements(GL_TRIANGLES, R.mCoin.p[j].nIdx, GL_UNSIGNED_INT, 0); }
    }
  } else
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

  /* hojas / pétalos / luciérnagas / brasas y líneas de velocidad */
  if (R.pFx && (fxN || stN)) {
    GLuint p = R.pFx;
    glUseProgram(p); set_common(p); um(p, "uVP", &vp);
    glBindVertexArray(R.fxVao); glBindBuffer(GL_ARRAY_BUFFER, R.fxVbo);
    glEnable(GL_BLEND); glDepthMask(GL_FALSE);
    if (fxN) {
      int dot = LK[R.lifeKind].dot;
      glBlendFunc(GL_SRC_ALPHA, dot ? GL_ONE : GL_ONE_MINUS_SRC_ALPHA);
      glUniform1i(U(p, "uKind"), dot ? 1 : 0);
      glBufferSubData(GL_ARRAY_BUFFER, 0, fxN * 64, fxV);
      glDrawArrays(GL_TRIANGLES, 0, fxN);
    }
    if (stN && stOpacity > 0.01f) {
      int k;
      for (k = 0; k < stN; k++) stV[k * 16 + 15] = stOpacity;
      glDisable(GL_DEPTH_TEST);
      glBlendFunc(GL_SRC_ALPHA, stAdd ? GL_ONE : GL_ONE_MINUS_SRC_ALPHA);
      glUniform1i(U(p, "uKind"), 2);
      glBufferSubData(GL_ARRAY_BUFFER, 0, stN * 64, stV);
      glDrawArrays(GL_LINES, 0, stN);
      glEnable(GL_DEPTH_TEST);
    }
    glDisable(GL_BLEND); glDepthMask(GL_TRUE);
  }
  if (PP.ok) post_finish(outFbo);
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
#define HV 14   /* pos2 col4 local2 box3 tex3 */
static float hudV[HUD_MAXV * HV]; static int hudN, hudW, hudH;
static GLuint hudVao, hudVbo;

/* ---- Fredoka (la letra de la web) en un atlas de campos de distancia */
#define FONT_PX 48.0f          /* tamaño al que se hornea */
#define FONT_PAD 8
typedef struct { int ok; float u0, v0, u1, v1, xoff, yoff, w, h, adv; } FGlyph;
static FGlyph FG[256]; static GLuint fontTex; static float fontAscent;
static void font_init(void) {
  int i, cp, W = 1024, H = 512, x = 0, y = 0, rowH = 0;
  unsigned char *atlas;
  stbtt_fontinfo f;
  float sc;
  int asc, desc, gap;
  for (i = 0; ASSETS[i].name && strcmp(ASSETS[i].name, "font_fredoka"); i++) {}
  if (!ASSETS[i].name || !stbtt_InitFont(&f, ASSETS[i].data, 0)) { fprintf(stderr, "sin fuente Fredoka\n"); return; }
  atlas = calloc((size_t)W * H, 1);
  sc = stbtt_ScaleForPixelHeight(&f, FONT_PX);
  stbtt_GetFontVMetrics(&f, &asc, &desc, &gap); fontAscent = asc * sc;
  for (cp = 32; cp < 256; cp++) {
    int gw, gh, xo, yo, adv, lsb, r;
    unsigned char *sd;
    if (cp >= 127 && cp < 161) continue;
    sd = stbtt_GetCodepointSDF(&f, sc, cp, FONT_PAD, 128, 128.0f / FONT_PAD, &gw, &gh, &xo, &yo);
    stbtt_GetCodepointHMetrics(&f, cp, &adv, &lsb);
    FG[cp].adv = adv * sc; FG[cp].ok = 1;
    if (!sd) continue;
    if (x + gw + 1 > W) { x = 0; y += rowH + 1; rowH = 0; }
    if (y + gh > H) { stbtt_FreeSDF(sd, NULL); break; }
    for (r = 0; r < gh; r++) memcpy(atlas + (size_t)(y + r) * W + x, sd + (size_t)r * gw, (size_t)gw);
    FG[cp].u0 = (float)x / W; FG[cp].v0 = (float)y / H; FG[cp].u1 = (float)(x + gw) / W; FG[cp].v1 = (float)(y + gh) / H;
    FG[cp].xoff = (float)xo; FG[cp].yoff = (float)yo; FG[cp].w = (float)gw; FG[cp].h = (float)gh;
    x += gw + 1; if (gh > rowH) rowH = gh;
    stbtt_FreeSDF(sd, NULL);
  }
  glGenTextures(1, &fontTex); glBindTexture(GL_TEXTURE_2D, fontTex);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_R8, W, H, 0, GL_RED, GL_UNSIGNED_BYTE, atlas);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE); glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  free(atlas);
}

void hud_begin(int w, int h) {
  hudN = 0; hudW = w; hudH = h;
  if (!hudVao) {
    glGenVertexArrays(1, &hudVao); glBindVertexArray(hudVao);
    glGenBuffers(1, &hudVbo); glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof hudV, NULL, GL_STREAM_DRAW);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, HV * 4, (void *)0);
    glEnableVertexAttribArray(1); glVertexAttribPointer(1, 4, GL_FLOAT, GL_FALSE, HV * 4, (void *)8);
    glEnableVertexAttribArray(2); glVertexAttribPointer(2, 2, GL_FLOAT, GL_FALSE, HV * 4, (void *)24);
    glEnableVertexAttribArray(3); glVertexAttribPointer(3, 3, GL_FLOAT, GL_FALSE, HV * 4, (void *)32);
    glEnableVertexAttribArray(4); glVertexAttribPointer(4, 3, GL_FLOAT, GL_FALSE, HV * 4, (void *)44);
    glBindVertexArray(0);
    font_init();
  }
}
static void hvt(float x, float y, unsigned rgb, float a, float lx, float ly, float hw, float hh, float rad, float tu, float tv, float th) {
  float *o;
  if (hudN >= HUD_MAXV) return;
  o = &hudV[hudN++ * HV];
  o[0] = x; o[1] = y; o[2] = ((rgb >> 16) & 255) / 255.f; o[3] = ((rgb >> 8) & 255) / 255.f; o[4] = (rgb & 255) / 255.f; o[5] = a;
  o[6] = lx; o[7] = ly; o[8] = hw; o[9] = hh; o[10] = rad; o[11] = tu; o[12] = tv; o[13] = th;
}
static void hv(float x, float y, unsigned rgb, float a, float lx, float ly, float hw, float hh, float rad) { hvt(x, y, rgb, a, lx, ly, hw, hh, rad, 0, 0, 0); }
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
/* UTF-8 → código (hasta 2 bytes: el latín de "¡Récord!") */
static int utf8(const char **ps) {
  const unsigned char *s = (const unsigned char *)*ps; int c = *s++;
  if (c >= 0xC0 && c < 0xE0 && *s) { c = ((c & 31) << 6) | (*s++ & 63); }
  else if (c >= 0xE0) { while (*s >= 0x80 && *s < 0xC0) s++; c = '?'; }
  *ps = (const char *)s;
  return c < 256 && FG[c].ok ? c : '?';
}
/* "px" es la unidad de siempre del HUD (la letra de 5×7 medía 7 px): 10 px de cuerpo por unidad */
#define EM(px) ((px) * 10.0f)
float hud_text_w(float px, const char *s) { float w = 0, k = EM(px) / FONT_PX; while (*s) w += FG[utf8(&s)].adv * k; return w; }
float hud_text_ex(float x, float y, float px, const char *s, unsigned rgb, float a, float grow) {
  float k = EM(px) / FONT_PX, x0 = x, base = y + fontAscent * k * 0.86f;
  /* umbral del campo de distancia: 0,5 es el borde; grow (en px de pantalla) lo engorda */
  float th = 0.5f - grow / k * (128.0f / FONT_PAD) / 255.0f;
  if (th < 0.08f) th = 0.08f;
  while (*s) {
    int c = utf8(&s);
    const FGlyph *g = &FG[c];
    if (g->w > 0) {
      float gx0 = x + g->xoff * k, gy0 = base + g->yoff * k, gx1 = gx0 + g->w * k, gy1 = gy0 + g->h * k;
      hvt(gx0, gy0, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u0, g->v0, th); hvt(gx1, gy0, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u1, g->v0, th); hvt(gx1, gy1, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u1, g->v1, th);
      hvt(gx0, gy0, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u0, g->v0, th); hvt(gx1, gy1, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u1, g->v1, th); hvt(gx0, gy1, rgb, a, 0, 0, 1e5f, 1e5f, 0, g->u0, g->v1, th);
    }
    x += g->adv * k;
  }
  return x - x0;
}
float hud_text(float x, float y, float px, const char *s, unsigned rgb, float a) { return hud_text_ex(x, y, px, s, rgb, a, 0); }
void hud_end(void) {
  GLuint p = R.pHud;
  if (!hudN) return;
  glDisable(GL_DEPTH_TEST); glDisable(GL_CULL_FACE);
  glEnable(GL_BLEND); glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
  glUseProgram(p);
  u2(p, "uScreen", (float)hudW, (float)hudH);
  bind_tex(p, "tFont", 0, fontTex);
  glBindVertexArray(hudVao);
  glBindBuffer(GL_ARRAY_BUFFER, hudVbo);
  glBufferSubData(GL_ARRAY_BUFFER, 0, (GLsizeiptr)(hudN * HV * sizeof(float)), hudV);
  glDrawArrays(GL_TRIANGLES, 0, hudN);
  glBindVertexArray(0);
  glDisable(GL_BLEND);
  glEnable(GL_DEPTH_TEST);
}
