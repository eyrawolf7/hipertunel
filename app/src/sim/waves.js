// Guiones de oleadas de cada modo, tal cual los define el original.
//   n  cajas de la oleada (-1 = infinita). Baja con cada caja, salvo mientras el túnel pliega.
//   a  probabilidad de soltar algo en cada fila (o cada interval+1 filas si hay intervalo)
//   b  probabilidad de caja fija (si no, cubo rodante)
//   c  probabilidad de pilar alto (solo las fijas)
//   d  probabilidad de que una colección sea espiral
//   e  probabilidad de que lo soltado sea una colección
// Los valores r(x, y) se sortean al empezar la partida.

const base = () => ({
  n: 0, a: 0, b: 0, c: 0, d: 0, e: 0,
  interval: -1, nMin: 3, nMax: 8, sep: 0, period: 1, variant: -1,
  dir: 1, fold: false, boosts: true, curves: true, spiralRollers: true,
});

export function buildWaves(mode, rng) {
  const r = (x, y) => rng.float(x, y);
  const ri = (x, y) => Math.trunc(rng.float(x, y));
  const W = [];
  // Orden de initWave del original: (n, a, b, c, colección, espiral). Aquí e = colección y d = espiral.
  const w = (n, a, b, c, pCol, pSpi, extra = {}) => { const o = Object.assign(base(), { n, a, b, c, d: pSpi, e: pCol }, extra); W.push(o); return o; };
  const col = (lo, hi) => ({ nMin: lo, nMax: hi });

  if (mode === 'classic') {
    w(15, 0.1, 1, 0, 0, 0);
    w(15, 0.1, 1, r(0.4, 0.6), 0, 0);
    w(ri(15, 30), 0.2, 1, 1, r(0, 0.2), 0, { fold: true });
    w(50, 0.35, 1, 0.75, 0.2, 0, col(2, 3));
    w(50, 0.35, 1, 0.25, 0, 0);
    w(50, 0.3, 1, 1, 1, 1, col(1, 3));
    w(1000, 0.25, 1, r(0.75, 1), 1, 0.45, { ...col(3, 6), fold: true });
    w(15, 0.2, 0, 0, 0, 0, { dir: 0.5 });
    w(15, 0.2, 0, 0, 0.5, 0, { dir: 0.5 });
    w(ri(15, 30), 0.3, 0, 0, 1, 0, { dir: 0.5 });
    w(ri(15, 30), 0.25, 0, 0, 1, 0.5, { ...col(3, 5), dir: 0.5 });
    w(ri(45, 90), 0.3, 0.5, 0.5, 0.15, 0, { interval: 2, dir: 0.5 });
    w(ri(15, 30), 0.25, 0, 0, 1, 1, { ...col(2, 5), dir: 0.5 });
    w(ri(45, 90), 0.2, 0.5, 1, 0, 0, { dir: 0.5 });
    w(ri(45, 90), 0.2, 1, 0.25, 1, 1, { ...col(3, 3), interval: 4, dir: 0.5 });
    w(ri(45, 90), 0.2, 0.5, 0.5, 0.5, 0.5, { dir: 0.5 });
    w(ri(30, 60), 0.45, 0.75, 0.5, 0.75, 0.5, { ...col(3, 5), dir: 0.5, fold: true });
    w(ri(15, 30), 0.3, 1, 0, 1, r(0.25, 0.5), { dir: 0.5 });
    w(ri(30, 60), 0.3, 1, 0, 0, 0);
    w(ri(30, 60), 0.3, 1, 1, 1, 1, col(1, 3));
    w(ri(30, 60), 0.3, 0.5, 0.5, 0.5, 0.5, col(1, 3));
    w(1000, 0.3, 1, 0.5, 0.5, 0.25, { fold: true });
    w(ri(45, 90), 1, 0, 0, 0.8, 0);
    w(ri(15, 30), 1, 0, 0, 1, 0, { ...col(3, 3), dir: 0.5 });
    w(ri(15, 30), 1, 0, 0, 1, 1, { ...col(3, 12), dir: 0.5 });
    w(ri(15, 30), 0.8, 0, 0, 1, 0.5, { dir: 0.5 });
    w(ri(30, 60), 0.4, 0.5, 0.3, 0.5, 0.5, { dir: 0.5 });
    w(ri(30, 60), 0.4, 0.5, 0.3, 0.5, 0.5, { dir: 0.5 });
    w(ri(30, 60), 0.9, 0.5, 0.3, 0.5, 1, { dir: 0.5 });
    w(ri(30, 60), 0.4, 0.5, 0.5, 0.5, 1, { dir: 0.5 });
    w(ri(15, 30), 0.27, 0.5, 0.5, 0.25, 1, { ...col(8, 8), dir: 0.5 });
    w(ri(45, 90), 0.27, 0, 0, 0, 0, { interval: 3 });
    w(ri(45, 90), 0.6, 0.5, 0.5, 0, 0, { dir: 0.5, fold: true });
    w(ri(45, 90), 1, 0.33, 0.5, 1, 1, col(3, 4));
    w(ri(45, 90), 0.8, 0.5, 0.5, 0, 0, { dir: 0.5 });
    w(ri(45, 90), 1, 0.5, 0.5, 0, 0, { dir: 0.5 });
    w(ri(45, 90), 0.75, 1, 0.5, 0, 0);
    w(ri(45, 90), 0.85, 1, 0.5, 0, 0);
    w(ri(45, 90), 0.85, 0.5, 1, 0, 0, { dir: 0.5 });
    w(1000, 0.85, 0.5, 1, 0, 0, { dir: 0.5, fold: true });
    w(ri(75, 150), 0.65, 1, 0, 0, 0, { dir: 0.5 });
    w(ri(75, 150), 0.35, 1, 1, 0, 0, { dir: 0.5 });
    w(-1, 0.65, 0.5, 1, 0.2, 0.75, { ...col(3, 12), dir: 0.5 });
  } else if (mode === 'timetrial') {
    w(15, 0.2, 1, 0, 0, 0);
    w(25, 0.085, 1, 1, 0, 0);
    w(ri(30, 60), 0.15, 1, 0, 1, 1, { interval: 2, ...col(3, 3) });
    w(ri(20, 30), 0.1, 1, 0, 1, 1);
    w(ri(30, 50), 0.3, 1, r(0, 1), 1, 1, { fold: true, ...col(3, 3), interval: 3 });
    w(ri(40, 50), 0.15, 1, 0.25, 0, 0, { interval: 2 });
    w(1000, 0.4, 1, 0, 1, 0.5, { ...col(3, 3), fold: true });
    w(ri(25, 75), 0.5, 0, 0, 1, 0, { interval: 1, ...col(4, 4), curves: false });
    w(ri(35, 60), 0.4, 0, 0, 0, 0, { interval: 2, curves: false });
    w(ri(35, 60), 0.4, 0.25, 0, 0.25, 0, { dir: 0.5 });
    w(ri(35, 60), 0.25, 0.5, 0, 0.5, 0.33, { ...col(3, 6), dir: 0.5 });
    w(ri(35, 60), 0.33, 0.5, 0, 1, 0.2, { dir: 0.5 });
    w(ri(40, 50), 0.07, 1, 1, 1, 0.8, col(2, 5));
    w(ri(40, 50), 1, 1, 0, 1, 1, { ...col(7, 10), period: 2 });
    w(125, 0.5, 1, 0.1, 0.15, 0, { interval: 1 });
    w(100, 1, 1, 0, 1, 1, { ...col(7, 7), period: 2, fold: true });
    w(ri(100, 200), 0.4, 0.5, 0, 0.1, 0, { interval: 0, boosts: false });
    w(ri(50, 130), 0.3, 0.5, 0.5, 1, 0.5, { ...col(3, 3), interval: 3 });
    w(1000, 0.25, 1, 1, 0.75, 1, { interval: 20, ...col(10, 10), sep: 1, fold: true });
    w(ri(100, 200), 0.4, 0.5, 0, 0.1, 0, { interval: 1 });
    w(ri(100, 125), 0.25, 1, 0.5, 0.5, 0.5, { interval: 2, ...col(1, 4) });
    w(10, 0.2, 1, 0, 1, 1, { interval: 15, ...col(40, 40), period: -3, sep: 0 });
    w(150, 0.3, 0.5, 0.5, 0.15, 0, { interval: 1, dir: 0.5 });
    // el original sube la densidad de estas siete oleadas: 0,2 + i·0,033
    for (let i = 0; i < 7; i++) w(ri(25, 75), 0.2 + i * 0.033, r(0.1, 0.9), 0, r(0.1, 0.9), 1, { spiralRollers: false, ...col(5, 10), dir: 0.5 });
    w(ri(50, 100), 0.4, 1, 0, 1, 1, { ...col(4, 4), interval: 5, dir: 0.5, fold: true });
    w(ri(100, 125), 0.55, 0.8, 0, 0, 0, { dir: 0.5 });
    w(1000, 0.55, 0.8, 1, 1, 0, { dir: 0.5, fold: true });
    w(-1, 0.825, 0.5, 0.5, 0.5, 0.5, { dir: 0.5, boosts: false });
  } else if (mode === 'survival') {
    w(50, 0.1, 0, 0, 1, 1, col(5, 12));
    w(50, 0.25, 0, 0, 0, 0);
    w(80, 0.2, 1, 0, 1, 1, { interval: 2 });
    w(10, 0.1, 0, 0, 1, 1, col(14, 14));
    w(18, 0.2, 0, 0, 1, 1, { interval: 6, ...col(10, 10), period: -4, sep: 3, curves: false });
    w(50, 0.4, 1, 0, 0, 0);
    w(30, 0.1, 1, 1, 1, 1, { ...col(3, 3), interval: 6 });
    w(50, 0.2, 1, 0, 1, 1, { ...col(3, 3), interval: 2 });
    w(50, 0.1, 0, 0, 1, 0, { ...col(10, 10), interval: 8, curves: false });
    w(30, 0.2, 1, 0, 1, 1, { ...col(10, 10), interval: 30 });
    w(10, 0.15, 1, 1, 1, 0, col(25, 25));
    w(20, 0.05, 1, 1, 0, 0, { interval: 6, world: 3 });
    w(10, 0.2, 1, 0, 1, 1, { interval: 15, ...col(20, 20), period: -3, sep: 0 });
    w(50, 0.15, 1, 1, 1, 0, { ...col(4, 4), interval: 3 });
    w(10, 0.2, 1, 0, 1, 1, { interval: 20, ...col(15, 15), period: 5, sep: 3 });
    w(100, 0.2, 1, 0, 1, 1, { interval: 10, ...col(4, 5) });
    w(10, 0.15, 1, 1, 1, 0, col(25, 25));
    w(125, 0.25, 1, 0.5, 0.5, 0.5, { interval: 6, ...col(1, 6), world: 4 });
    w(75, 0.175, 1, 1, 1, 1, col(1, 3));
    w(125, 0.5, 1, 0, 1, 0.5, col(1, 4));
    w(20, 0.2, 1, 0, 1, 1, { interval: 20, ...col(25, 25), period: 5, sep: 3 });
    w(125, 0.5, 1, 0, 1, 0, { ...col(1, 6), world: 5 });
    w(75, 0.5, 1, 0, 1, 0, col(1, 3));
    w(10, 0.15, 1, 1, 1, 0, col(25, 25));
    w(-1, 0.5, 1, 0, 0, 0, { world: 6 });
  } else {
    throw new Error('modo desconocido: ' + mode);
  }
  return W;
}
