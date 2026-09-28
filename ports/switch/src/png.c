/* PNG mínimo sin comprimir (bloques "stored" de deflate) para las capturas de prueba. */
#include "png.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned long crcT[256]; static int crcInit;
static unsigned long crc(const unsigned char *b, size_t n, unsigned long c) {
  size_t i;
  if (!crcInit) {
    unsigned long k; int j;
    for (k = 0; k < 256; k++) { unsigned long v = k; for (j = 0; j < 8; j++) v = v & 1 ? 0xEDB88320UL ^ (v >> 1) : v >> 1; crcT[k] = v; }
    crcInit = 1;
  }
  for (i = 0; i < n; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >> 8);
  return c;
}
static void be32(unsigned char *p, unsigned long v) { p[0] = (unsigned char)(v >> 24); p[1] = (unsigned char)(v >> 16); p[2] = (unsigned char)(v >> 8); p[3] = (unsigned char)v; }
static void chunk(FILE *f, const char *type, const unsigned char *d, size_t n) {
  unsigned char h[8]; unsigned long c;
  be32(h, (unsigned long)n); memcpy(h + 4, type, 4);
  fwrite(h, 1, 8, f); if (n) fwrite(d, 1, n, f);
  c = crc((const unsigned char *)type, 4, 0xFFFFFFFFUL); c = crc(d, n, c) ^ 0xFFFFFFFFUL;
  be32(h, c); fwrite(h, 1, 4, f);
}

int png_write(const char *path, const unsigned char *rgba, int w, int h, int flipY) {
  static const unsigned char sig[8] = { 137, 80, 78, 71, 13, 10, 26, 10 };
  size_t row = (size_t)w * 3 + 1, raw = row * h, nblk = (raw + 65534) / 65535, zn = 2 + raw + nblk * 5 + 4, i, o = 0;
  unsigned char ihdr[13], *z = malloc(zn), *r = malloc(raw);
  unsigned long a = 1, b = 0;
  FILE *f;
  int x, y;
  if (!z || !r) return 1;
  for (y = 0; y < h; y++) {
    const unsigned char *src = rgba + (size_t)(flipY ? h - 1 - y : y) * w * 4;
    unsigned char *dst = r + y * row;
    dst[0] = 0;
    for (x = 0; x < w; x++) { dst[1 + x * 3] = src[x * 4]; dst[2 + x * 3] = src[x * 4 + 1]; dst[3 + x * 3] = src[x * 4 + 2]; }
  }
  z[o++] = 0x78; z[o++] = 0x01;
  for (i = 0; i < raw; i += 65535) {
    size_t n = raw - i < 65535 ? raw - i : 65535;
    z[o++] = i + n >= raw ? 1 : 0;
    z[o++] = (unsigned char)n; z[o++] = (unsigned char)(n >> 8);
    z[o++] = (unsigned char)~n; z[o++] = (unsigned char)(~n >> 8);
    memcpy(z + o, r + i, n); o += n;
  }
  for (i = 0; i < raw; i++) { a = (a + r[i]) % 65521; b = (b + a) % 65521; }
  be32(z + o, (b << 16) | a); o += 4;
  f = fopen(path, "wb");
  if (!f) { free(z); free(r); return 1; }
  fwrite(sig, 1, 8, f);
  be32(ihdr, (unsigned long)w); be32(ihdr + 4, (unsigned long)h);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk(f, "IHDR", ihdr, 13);
  chunk(f, "IDAT", z, o);
  chunk(f, "IEND", NULL, 0);
  fclose(f); free(z); free(r);
  return 0;
}
