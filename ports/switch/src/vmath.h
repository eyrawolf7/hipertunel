/* Vectores (double, como los Vector3 de Three) y matrices 4x4 (float, por columnas, como GL). */
#ifndef HT_VMATH_H
#define HT_VMATH_H

#include <math.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct { double x, y, z; } V3;

static inline V3 v3(double x, double y, double z) { V3 r; r.x = x; r.y = y; r.z = z; return r; }
static inline V3 vadd(V3 a, V3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline V3 vsub(V3 a, V3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline V3 vscale(V3 a, double s) { return v3(a.x * s, a.y * s, a.z * s); }
static inline V3 vmad(V3 a, V3 b, double s) { return v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s); }
static inline double vdot(V3 a, V3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline V3 vcross(V3 a, V3 b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static inline double vlen(V3 a) { return sqrt(vdot(a, a)); }
static inline V3 vnorm(V3 a) { double l = vlen(a); return l > 0 ? vscale(a, 1 / l) : a; }
static inline V3 vlerp(V3 a, V3 b, double t) { return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }
/* rotación de v alrededor del eje unitario k (Rodrigues), como Vector3.applyAxisAngle */
static inline V3 vrot(V3 v, V3 k, double a) {
  double c = cos(a), s = sin(a);
  return vadd(vadd(vscale(v, c), vscale(vcross(k, v), s)), vscale(k, vdot(k, v) * (1 - c)));
}

typedef struct { float m[16]; } M4;

static inline M4 m4_identity(void) { M4 r = {{1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1}}; return r; }
static inline M4 m4_mul(M4 a, M4 b) {
  M4 r; int i, j, k;
  for (i = 0; i < 4; i++) for (j = 0; j < 4; j++) {
    float s = 0; for (k = 0; k < 4; k++) s += a.m[k * 4 + j] * b.m[i * 4 + k];
    r.m[i * 4 + j] = s;
  }
  return r;
}
static inline M4 m4_perspective(double fovDeg, double aspect, double n, double f) {
  M4 r = {{0}};
  double t = 1 / tan(fovDeg * M_PI / 360);
  r.m[0] = (float)(t / aspect); r.m[5] = (float)t;
  r.m[10] = (float)(-(f + n) / (f - n)); r.m[11] = -1;
  r.m[14] = (float)(-2 * f * n / (f - n));
  return r;
}
/* matriz de modelo con columnas X, Y, Z (ya escaladas) y traslación p */
static inline M4 m4_basis(V3 X, V3 Y, V3 Z, V3 p) {
  M4 r = {{(float)X.x, (float)X.y, (float)X.z, 0, (float)Y.x, (float)Y.y, (float)Y.z, 0,
           (float)Z.x, (float)Z.y, (float)Z.z, 0, (float)p.x, (float)p.y, (float)p.z, 1}};
  return r;
}

#endif
