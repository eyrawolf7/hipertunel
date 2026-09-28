// Comprobaciones de calidad que ya nos han dado guerra. Ejecuta: npm run check
const G = require('./harness')(); const fail = []; const L = 16, lm = (l) => ((l % L) + L) % L;
const blocked = (l, a, b) => G.byLane[lm(l)].some((o) => o.type === 'block' && o.z < b && o.z + o.len > a);
let cd = 0; G.setStep(() => { cd--; if (cd > 0) return 0; const s = G.s, c = G.lane; if (!blocked(c, s - 1, s + 30)) return 0; for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!blocked(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0; });
// 1) cada partida genera una pista y un orden de mundos distintos
const sig = new Set(); for (let r = 0; r < 3; r++) { G.start(); sig.add(G.cxAt(1000).toFixed(2) + '|' + G.perm().join('')); }
if (sig.size < 3) fail.push('La pista no varía entre partidas');
// 2) las placas de impulso nunca quedan por debajo de las baldosas ni separadas de la carretera
let chord = 1e9, gap = 0;
for (const z0 of [200, 1000, 2500]) { G.start(); G.warp(z0); for (let i = 0; i < 60 * 12; i++) { G.update(1 / 60); if (G.state !== 'play') { G.start(); G.warp(z0); } if (i % 6 === 0) { const c = G.chordGap(); if (c < 1e8) chord = Math.min(chord, c); gap = Math.max(gap, G.padErr()); } } }
if (chord < 0.02) fail.push('Placas por debajo de la baldosa: ' + chord.toFixed(3) + ' m');
if (gap > 0.15) fail.push('Placas separadas de la carretera: ' + gap.toFixed(3) + ' m');
// 3) la dificultad crece de forma constante
const D = [0, 1000, 3000, 6000, 10000].map((z) => G.diffAt(z)); for (let i = 1; i < D.length; i++) if (D[i] <= D[i - 1]) fail.push('La dificultad no crece entre ' + i);
// 4) el giroscopio: una inclinación normal mueve un carril y solo uno, por brusco que sea el sensor
G.setStep(() => 0); G.start(); const feed = (deg, sec) => { for (let i = 0; i < sec * 60; i++) { const r = deg * Math.PI / 180; G.motion(9.8 * Math.cos(Math.PI / 2 + r), 9.8 * Math.sin(Math.PI / 2 + r)); G.update(1 / 60); } };
const dl = (a, b) => ((a - b + 8 + 16) % 16) - 8;   // diferencia de carriles teniendo en cuenta la vuelta al túnel
// moverse mucho hace chocar contra un bloque, y al morir ya no se cambia de carril: se reintenta
// con otra pista hasta conseguir una medida con el jugador vivo.
const mover = (deg, sec) => {
  for (let intento = 0; intento < 12; intento++) {
    G.start(); feed(0, 0.5); const a = G.lane;
    feed(deg, sec);
    if (G.state === 'play') return Math.abs(dl(G.lane, a));
  }
  return null;
};
const uno = mover(14, 0.8);
if (uno === null) fail.push('No se pudo medir la inclinación: el jugador muere siempre');
else if (uno === 0) fail.push('La inclinación no cambia de carril');
else if (uno !== 1) fail.push('Una inclinación normal salta ' + uno + ' carriles en vez de 1');
const mantenido = mover(14, 2.5);   // mantener una inclinación normal NO debe encadenar carriles
if (mantenido !== null && mantenido !== 1) fail.push('Mantener el móvil inclinado encadena carriles solo: ' + mantenido);
const girado = mover(38, 1.2);      // con el móvil muy girado sí se encadenan
if (girado !== null && girado < 2) fail.push('Con el móvil muy girado no se encadenan carriles: ' + girado);
console.log(fail.length ? 'FALLOS:\n- ' + fail.join('\n- ') : 'Todo OK', JSON.stringify({ chordMin: +chord.toFixed(3), padGapMax: +gap.toFixed(3), diff: D.map((d) => +d.toFixed(2)) }));
process.exit(fail.length ? 1 : 0);
