// Cuánto cambian las superficies la duración de las partidas del bot (Arcade): mediana con superficies
// frente a la misma semilla con todo piedra (forceSurface = 0, idéntica al Arcade sin agarre).
//   node tests/superficies-impacto.mjs [--n=100]
import { Arcade } from '../app/src/sim/arcade.js';
import { createBot } from './bot-pro.mjs';

const N = +((process.argv.find((a) => a.startsWith('--n=')) || '--n=100').slice(4));
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const play = (level, seed, force) => {
  const g = new Arcade({ seed, forceSurface: force }), bot = createBot(level, seed);
  while (g.alive && g.frame < 60 * 600) g.step(bot(g));
  return g.time;
};
let worst = 0;
for (const level of ['novato', 'medio', 'bueno', 'experto']) {
  const a = [], b = [];
  for (let i = 0; i < N; i++) { a.push(play(level, 1000 + i, 0)); b.push(play(level, 1000 + i, -1)); }
  const ma = median(a), mb = median(b), d = 100 * (mb - ma) / ma;
  worst = Math.min(worst, d);
  console.log(`${level.padEnd(8)} mediana todo piedra ${ma.toFixed(1)} s · con superficies ${mb.toFixed(1)} s (${d >= 0 ? '+' : ''}${d.toFixed(1)} %) · peor 10 % ${pct(a, 0.1).toFixed(1)} → ${pct(b, 0.1).toFixed(1)} s`);
}
console.log(`${N} semillas por nivel · peor cambio de mediana ${worst.toFixed(1)} %`);
