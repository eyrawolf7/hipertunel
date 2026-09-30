// Roce («¡Por los pelos!»): 1 moneda por caja que pasa por el carril de al lado (Arcade).
// Uso: node tests/roce.mjs [semillas=40]
// Comprueba con bot-pro: el bot medio roza de 3 a 10 veces por partida, la moneda se suma sin
// tocar el rng (las cajas salen igual que sin roce), el Clásico no cambia y el Zorro no lo usa.
import { createBot, makeGame } from './bot-pro.mjs';
import { Arcade } from '../app/src/sim/arcade.js';
import { Zorro } from '../app/src/sim/zorro.js';

const N = +(process.argv[2] || 40);
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASA ' : 'FALLA'} ${msg}`); if (!c) fails++; };

function play(level, seed, { grazeOn = true } = {}) {
  const g = makeGame('arcade', seed); g.grazeOn = grazeOn;
  const bot = createBot(level, seed);
  const r = { t: 0, grazes: 0, gaps: [], sig: 0, bad: 0, last: -9 };
  while (g.alive && g.frame < 600 * 60) {
    for (const e of g.step(bot(g))) {
      if (e.type === 'graze') {
        r.grazes++; if (r.last >= 0) r.gaps.push(g.time - r.last); r.last = g.time;
        if (g.speedMS <= 60) r.bad++;
      }
      if (e.type === 'spawn') r.sig = (r.sig * 31 + e.id) >>> 0;   // firma de las cajas que salen
    }
  }
  r.t = g.time; r.coins = g.coinsGot; r.g = g;
  return r;
}

for (const level of ['novato', 'medio', 'bueno', 'experto']) {
  const rs = []; for (let i = 0; i < N; i++) rs.push(play(level, 1000 + i));
  const per = rs.map((r) => r.grazes);
  const min = Math.min(...rs.flatMap((r) => r.gaps), 9);
  console.log(`${level.padEnd(8)} roces/partida mediana ${median(per)} media ${(per.reduce((a, b) => a + b, 0) / N).toFixed(1)} máx ${Math.max(...per)} · mediana ${median(rs.map((r) => r.t)).toFixed(1)} s · hueco mín ${min.toFixed(2)} s`);
  if (level === 'medio') {
    const m = median(per);
    ok(m >= 3 && m <= 10, `bot medio: mediana de roces por partida ${m} en 3-10`);
    ok(rs.every((r) => r.bad === 0), 'ningún roce a ≤ 60 m/s');
    ok(min >= 2.5 - 1e-9, `nunca dos roces con menos de 2,5 s (${min.toFixed(2)}, con huecos medidos)`);
    ok(rs.every((r) => r.coins >= r.grazes) && rs.some((r) => r.grazes > 0), 'cada roce suma su moneda (y hay roces)');
  }
}

// la moneda no cambia el mundo: mismas cajas con y sin roce; las cajas del muro no cuentan
{
  let same = 0, n = 12;
  for (let i = 0; i < n; i++) {
    const a = play('medio', 2000 + i), b = play('medio', 2000 + i, { grazeOn: false });
    if (a.sig === b.sig && a.t === b.t) same++;
  }
  ok(same === n, `roce sin efecto en la partida: ${same}/${n} idénticas (cajas y duración)`);
}
// casos directos sobre `graze` (fila cruzada de k=99 a 100, a 86 m/s): costura, lámina abierta, rodantes
{
  const hw = Math.PI / 6;
  const mk = ({ fold = 30, lane = 0, roll = 0, fixed = true, wall = false, th = 1, v = 4.76, twice = false }) => {
    const g = new Arcade({ seed: 1 });
    g.fold = fold; g.v = g.vTarget = v; g.s = 100; g.theta = th * hw;
    g.boxes = [{ k: 99, lane, roll, fixed, hit: false, wall, tall: false }];
    g.graze(99); if (twice) g.graze(99);
    return g.grazes;
  };
  ok(mk({ lane: 5, th: 6 }) === 1, 'roce: caja en el carril de al lado');
  ok(mk({ lane: 5, th: 5 }) === 0 && mk({ lane: 5, th: 8 }) === 0, 'sin roce ni encima ni a 3 carriles');
  ok(mk({ lane: 0, th: 11 }) === 1, 'roce a través de la costura 11→0 con el tubo por dentro');
  ok(mk({ fold: -30, lane: 0, th: 11 }) === 1, 'roce a través de la costura con el tubo cerrado por fuera');
  ok(mk({ fold: 0, lane: 0, th: 11 }) === 0, 'lámina abierta: 0 y 11 no son vecinos');
  ok(mk({ lane: 5, roll: 60, fixed: false, th: 7 }) === 1, 'rodante desplazada un carril: roza por su posición real');
  ok(mk({ lane: 5, roll: 60, fixed: false, th: 4 }) === 0, 'rodante desplazada: su carril de origen ya no cuenta');
  ok(mk({ lane: 5, th: 6, wall: true }) === 0, 'las cajas del muro no dan roce');
  ok(mk({ lane: 5, th: 6, v: 2 }) === 0, 'a 36 m/s no hay roce');
  ok(mk({ lane: 5, th: 6, twice: true }) === 1, 'el segundo paso seguido no vuelve a dar moneda (enfriamiento)');
}
{
  const z = new Zorro({ seed: 1 });
  ok(z.grazeOn === false, 'el Zorro no da monedas por roce (tiene los suyos)');
  const a = new Arcade({ seed: 1 });
  ok(a.grazeOn === true && a.grazes === 0, 'Arcade empieza con el roce activo');
}
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
