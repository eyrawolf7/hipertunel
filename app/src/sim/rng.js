// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma partida,
// que es lo que necesitan las repeticiones, los fantasmas y las pruebas.
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const float = (lo, hi) => lo + (hi - lo) * next();
  return {
    next,
    float,
    int: (lo, hi) => Math.trunc(float(lo, hi)),
    // igual que BoxManager::getProb: 1 y 0 son exactos, el resto se tira contra 100
    prob: (p) => (p >= 1 ? true : p <= 0 ? false : float(0, 100) <= p * 100),
    get state() { return a; },
    set state(v) { a = v >>> 0; },
  };
}
