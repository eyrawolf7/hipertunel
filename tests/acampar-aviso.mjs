// Aviso de la caja por acampar (Arcade): segundos entre que la caja nace (su carril se enciende, ver
// litStrips: desde tu fila hasta la caja) y llega a tu fila, medidos a velocidad máxima (el peor caso,
// V_MAX 5,5) y a la del momento. Se mide quieto (acampas siempre) y con el bot medio y el bueno (todas
// las velocidades, plegados y mundos). Además, cuánto tarda en matarte un jugador quieto.
// Sale con 1 si algún aviso baja de 0,6 s a velocidad máxima o si quedarse quieto no mata en < 12 s.
// Uso: node tests/acampar-aviso.mjs [semillas=60]
import { Arcade } from '../app/src/sim/arcade.js';
import { R_UNITS, V_MAX } from '../app/src/sim/game.js';
import { createBot } from './bot-pro.mjs';

const N = +(process.argv[2] || 60);
const MIN_LEAD = 0.6, MAX_STILL = 12;
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const f = (x) => (x === undefined ? '-' : x.toFixed(2));

function run(label, playerFor, maxT) {
  const leads = [], leadsMax = [], ends = [];
  let unlit = 0;
  for (let seed = 1; seed <= N; seed++) {
    const g = new Arcade({ seed });
    const act = playerFor(g, seed);
    let campSeen = false;
    for (let fr = 0; fr < 60 * maxT && g.alive; fr++) {
      for (const e of g.step(act(g))) {
        if (e.type === 'camp') campSeen = true;
        else if (e.type === 'spawn' && campSeen) {
          campSeen = false;
          const b = g.boxes.find((x) => x.id === e.id);
          if (!b) continue;
          // las móviles (rodantes) no se encienden nunca: se cuentan aparte, no como avisadas
          const st = b.fixed ? (g.litStrips().get(b.lane) || []).find((x) => x.id === b.id) : null;
          if (!st) { unlit++; continue; }
          leads.push((b.k - st.from) / (g.v * 60 / R_UNITS));
          leadsMax.push((b.k - st.from) / (V_MAX * 60 / R_UNITS));
        }
      }
    }
    ends.push(g.time);
  }
  console.log(`${label}: ${leads.length} cajas fijas por acampar con carril encendido (+ ${unlit} rodantes, sin tramo encendido: así es para todas las rodantes)`);
  console.log(`  aviso a la velocidad del momento (s): mín ${f(q(leads, 0))} · p10 ${f(q(leads, 0.1))} · mediana ${f(q(leads, 0.5))}`);
  console.log(`  aviso a velocidad máxima (s):        mín ${f(q(leadsMax, 0))} · p10 ${f(q(leadsMax, 0.1))} · mediana ${f(q(leadsMax, 0.5))}`);
  return { min: q(leadsMax, 0), n: leads.length, ends };
}

const still = run('quieto', () => () => ({ steer: 0 }), 120);
console.log(`  muerte quieto (s): mín ${f(q(still.ends, 0))} · mediana ${f(q(still.ends, 0.5))} · máx ${f(q(still.ends, 1))}`);
const medio = run('bot medio', (g, s) => createBot('medio', s), 120);
const bueno = run('bot bueno', (g, s) => createBot('bueno', s), 120);

const fails = [];
for (const [n, r] of [['quieto', still], ['medio', medio], ['bueno', bueno]]) {
  if (!r.n) fails.push(`${n}: no salió ninguna caja por acampar`);
  else if (r.min < MIN_LEAD) fails.push(`${n}: aviso mínimo ${f(r.min)} s < ${MIN_LEAD} s`);
}
if (q(still.ends, 1) >= MAX_STILL) fails.push(`quieto sobrevive ${f(q(still.ends, 1))} s (≥ ${MAX_STILL} s)`);
console.log(fails.length ? 'FALLA:\n  ' + fails.join('\n  ') : `OK: aviso ≥ ${MIN_LEAD} s a velocidad máxima y quieto muere en < ${MAX_STILL} s`);
process.exit(fails.length ? 1 : 0);
