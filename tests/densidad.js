// Cuántos carriles se ven pintados de aviso a la vez. Si son demasiados, el color deja de
// significar "viene un obstáculo" y la pantalla se vuelve ilegible: en el original nunca pasan de 4.
// Uso: node tests/densidad.js [warns] [warnmin] [warnmax]
const G = require('./harness')({ warns: process.argv[2], warnmin: process.argv[3], warnmax: process.argv[4] });
const L = G.lanes;
G.setStep(() => 0);
const VISTA = 110;   // metros por delante que entran en pantalla
const filas = [];
for (const z of [300, 1000, 2000, 3000, 4500, 6000, 8000, 10000]) {
  let pico = 0, suma = 0, n = 0, limpios = 0; const todos = [];
  for (let rep = 0; rep < 3; rep++) {
    G.start(); G.warp(z);
    for (let i = 0; i < 60 * 8; i++) {
      G.update(1 / 60);
      if (G.state !== 'play') { G.start(); G.warp(z); continue; }
      if (i % 10) continue;
      const s = G.s;
      let avisos = 0;
      for (let l = 0; l < L; l++) {
        for (const o of G.byLane[l]) {
          if (o.type !== 'block' || !o.lit) continue;
          // tramo de carril realmente pintado: de litFrom al final del bloque
          if (o.z + o.len < s || o.litFrom > s + VISTA) continue;
          avisos++; break;
        }
      }
      pico = Math.max(pico, avisos); suma += avisos; n++; todos.push(avisos); if (avisos === 0) limpios++;
    }
  }
  todos.sort((a, b) => a - b);
  filas.push({ z, media: +(suma / n).toFixed(1), p90: todos[Math.floor(n * 0.9)], p99: todos[Math.floor(n * 0.99)], pico, limpio: Math.round(limpios / n * 100), diff: +G.diffAt(z).toFixed(2) });
}
console.log('carriles de 16 pintados de aviso a la vez (referencia del original: 2-4 como mucho)');
for (const f of filas) console.log('  z' + String(f.z).padStart(6), 'dific', String(f.diff).padStart(5), '| media', String(f.media).padStart(5), ' p90', String(f.p90).padStart(3), ' p99', String(f.p99).padStart(3), ' pico', String(f.pico).padStart(3), ' sin ningún aviso', String(f.limpio).padStart(3) + '%');
