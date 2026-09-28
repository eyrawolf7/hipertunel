/* Generador pseudoaleatorio con semilla (mulberry32), port exacto de app/src/sim/rng.js. */
#ifndef HT_RNG_H
#define HT_RNG_H

#include <stdint.h>

typedef struct { uint32_t a; } Rng;

void   rng_init(Rng *r, uint32_t seed);
double rng_next(Rng *r);                       /* [0, 1) */
double rng_float(Rng *r, double lo, double hi);
int    rng_int(Rng *r, double lo, double hi);  /* Math.trunc(float(lo, hi)) */
int    rng_prob(Rng *r, double p);             /* BoxManager::getProb */

#endif
