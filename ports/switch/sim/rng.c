#include "rng.h"
#include <math.h>

/* En JS los operadores de bits trabajan sobre enteros de 32 bits y Math.imul da los 32 bits bajos
   del producto: con uint32_t y aritmética modular sale exactamente lo mismo. */
void rng_init(Rng *r, uint32_t seed) { r->a = seed; }

double rng_next(Rng *r) {
  uint32_t t;
  r->a = r->a + 0x6d2b79f5u;
  t = (r->a ^ (r->a >> 15)) * (1u | r->a);
  t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
  return (double)(t ^ (t >> 14)) / 4294967296.0;
}

double rng_float(Rng *r, double lo, double hi) { return lo + (hi - lo) * rng_next(r); }

int rng_int(Rng *r, double lo, double hi) { return (int)trunc(rng_float(r, lo, hi)); }

int rng_prob(Rng *r, double p) {
  if (p >= 1) return 1;
  if (p <= 0) return 0;
  return rng_float(r, 0, 100) <= p * 100;
}
