// Simulación rápida: un bot juega 2,5 minutos y se comprueba que no hay errores.
const G = require('./harness')(); const L = 16, lm = (l) => ((l % L) + L) % L;
const blocked = (l, a, b) => G.byLane[lm(l)].some((o) => o.type === 'block' && o.z < b && o.z + o.len > a);
let cd = 0;
G.setStep(() => { cd--; if (cd > 0) return 0; const s = G.s, c = G.lane; if (!blocked(c, s - 1, s + 30)) return 0;
  for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!blocked(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0; });
G.start(); let deaths = 0, maxS = 0;
for (let i = 0; i < 60 * 150; i++) { G.update(1 / 60); maxS = Math.max(maxS, G.s); if (G.state === 'over') { deaths++; G.start(); } }
console.log(JSON.stringify({ ok: true, deaths, maxDist: Math.round(maxS) }));
