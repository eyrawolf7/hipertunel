// Superficies del Arcade (agarre del giro): comprueba las reglas de app/src/sim/arcade.js.
//   node tests/superficies.mjs [--n=30]
// 1. Retraso y pasarse por superficie (con un giro suave, a = 0,15).
// 2. La piedra da exactamente el giro del Clásico.
// 3. Cada cambio de superficie se ve ≥ 1,5 s antes de notarse, también a velocidad máxima.
// 4. Con el bot (bot-pro) morir en musgo no sube más de un 10 % (por minuto) respecto a la piedra.
// 5. Con el bot y hielo forzado (pruebas, el hielo solo existe en fases) sobrevive casi como en piedra.
import { Game, LANES, CELL_DEG } from '../app/src/sim/game.js';
import { Arcade, SURFACES, SURF_LAG, S_STONE, S_MOSS, S_ICE } from '../app/src/sim/arcade.js';
import { createBot } from './bot-pro.mjs';

const N = +((process.argv.find((a) => a.startsWith('--n=')) || '--n=30').slice(4));
const LANE = CELL_DEG * Math.PI / 180;
let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const fmt = (x, d = 2) => x.toFixed(d).replace('.', ',');

console.log('Retraso y pasarse (giro suave a = 0,15 durante 40 fotogramas y suelta)');
for (let i = 0; i < SURFACES.length; i++) {
  const g = new Arcade({ seed: 5, forceSurface: i });
  const th0 = g.theta;
  let t90 = -1;
  for (let f = 0; f < 40; f++) { g.steer(0.15); if (t90 < 0 && Math.abs(g.omega) >= 0.9 * 0.15 * 0.2 * SURFACES[i].g) t90 = f + 1; }
  const steady = g.omega;
  const held = g.theta - th0;
  for (let f = 0; f < 200; f++) g.steer(0);
  const over = (g.theta - th0 - held) / LANE;
  const nm = SURFACES[i].name;
  ok(t90 >= 1 && t90 <= 12, `${nm}: el 90 % del giro en ${t90} fotogramas (≤ 12)`);
  ok(over <= 0.25, `${nm}: se pasa ${fmt(over)} carriles al soltar (≤ 0,25)`);
  if (i === S_STONE) ok(Math.abs(steady - 0.15 * 0.2) < 1e-12 && over < 1e-9, 'piedra: giro de Boost 2 (sin retraso)');
}

console.log('La piedra es el giro del Clásico');
{
  const a = new Arcade({ seed: 7, forceSurface: S_STONE }), b = new Game({ mode: 'classic', seed: 7 });
  let d = 0;
  for (let f = 0; f < 300; f++) { const s = Math.sin(f / 13) * 0.4; a.steer(s); b.steer(s); d = Math.max(d, Math.abs(a.theta - b.theta)); }
  ok(d < 1e-12, `theta idéntica a la del Clásico (máx diferencia ${d.toExponential(1)})`);
}

console.log('Cada superficie se ve ≥ 1,5 s antes de notarse');
{
  const seen = new Map();   // fila -> fotograma en que entró
  let minLead = Infinity, minLeadMax = Infinity, changes = 0, surfaces = new Set();
  for (let seed = 1000; seed < 1000 + N; seed++) {
    const g = new Arcade({ seed });
    const bot = createBot('bueno', seed);
    seen.clear();
    let prev = S_STONE;
    while (g.alive && g.frame < 60 * 400) {
      g.step(bot(g));
      for (const r of g.rows) if (!seen.has(r.k)) seen.set(r.k, g.frame);
      const now = g.surfNow;
      if (now !== prev && now !== S_STONE) {
        // la superficie que se nota empezó en la fila s − LAG: ¿desde cuándo se veía?
        const row = Math.floor(g.s) - SURF_LAG;
        let first = row; while (first > 0 && g.surf.get(first - 1) === now) first--;
        const f0 = seen.get(first) ?? seen.get(row);
        if (f0 !== undefined) {
          const lead = (g.frame - f0) / 60;
          changes++; surfaces.add(now);
          minLead = Math.min(minLead, lead);
          if (g.v >= 5.49) minLeadMax = Math.min(minLeadMax, lead);
        }
      }
      prev = now;
    }
  }
  ok(changes > 20, `${changes} cambios de superficie observados con ${surfaces.size} superficies distintas (> 20)`);
  ok(minLead >= 1.5, `adelanto mínimo ${fmt(minLead)} s (≥ 1,5)`);
  ok(minLeadMax === Infinity || minLeadMax >= 1.5, `a velocidad máxima ${minLeadMax === Infinity ? 'sin casos' : fmt(minLeadMax) + ' s'} (≥ 1,5)`);
}

// muertes por minuto en cada superficie (tiempo con esa superficie notándose, no la pintada)
function rates(level, force = -1, n = N) {
  const t = SURFACES.map(() => 0), d = SURFACES.map(() => 0);
  for (let seed = 1000; seed < 1000 + n; seed++) {
    const g = new Arcade({ seed, forceSurface: force });
    const bot = createBot(level, seed);
    let last = 0;
    while (g.alive && g.frame < 60 * 400) { g.step(bot(g)); last = g.surfNow; if (g.alive) t[g.surfNow] += 1 / 60; }
    if (!g.alive) d[last]++;
  }
  return { t, d, rate: t.map((x, i) => (x > 120 ? d[i] / (x / 60) : NaN)) };
}

// ¿la tasa de muertes de una superficie supera la de la piedra en más de un 10 %? Con pocas muertes
// la tasa es ruido: solo falla si ni restándole 1,64 desviaciones (Poisson, 95 %) baja del límite
const tooHigh = (rate, deaths, min, base) => rate > base * 1.1 + 0.02 && rate - 1.64 * Math.sqrt(Math.max(deaths, 1)) / min > base * 1.1;

console.log('Muertes por minuto por superficie en partidas normales (bot-pro; solo informativo si hay poco tiempo en la superficie)');
for (const level of ['medio', 'bueno']) {
  const r = rates(level);
  const row = SURFACES.map((s, i) => `${s.name} ${fmt(r.t[i] / 60, 1)} min/${r.d[i]} muertes`).join(' · ');
  console.log('  ' + level + ': ' + row);
  const a = r.rate[S_STONE], m = r.rate[S_MOSS];
  if (r.t[S_MOSS] >= 300) ok(!tooHigh(m, r.d[S_MOSS], r.t[S_MOSS] / 60, a), `${level}: musgo ${fmt(m)} muertes/min frente a piedra ${fmt(a)} (≤ +10 %)`);
  else console.log(`  · ${level}: solo ${fmt(r.t[S_MOSS] / 60, 1)} min en musgo: sin datos suficientes (lo cubre la superficie forzada de abajo)`);
}

console.log('Superficie forzada en todo el camino (solo pruebas), bot bueno: muertes/min frente a piedra forzada');
{
  const NF = Math.max(N, 40);
  const st = rates('bueno', S_STONE, NF);
  for (const id of [1, S_MOSS, 3, S_ICE]) {
    const r = rates('bueno', id, NF);
    console.log(`  ${SURFACES[id].name}: ${r.d[id]} muertes en ${fmt(r.t[id] / 60, 1)} min (${fmt(r.rate[id])}/min) · piedra ${st.d[S_STONE]} en ${fmt(st.t[S_STONE] / 60, 1)} min (${fmt(st.rate[S_STONE])}/min)`);
    ok(Number.isFinite(r.rate[id]) && !tooHigh(r.rate[id], r.d[id], r.t[id] / 60, st.rate[S_STONE]), `${SURFACES[id].name}: no más de un 10 % que la piedra (con margen estadístico)`);
  }
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
