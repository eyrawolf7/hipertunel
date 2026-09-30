// Bot de pruebas con niveles de habilidad (aparte del de la demo, app/src/sim/bot.js, que usa la
// paridad con C). Planifica: para cada carril destino simula el giro (mismo control y límite de giro
// del nivel) y cuenta los choques por el camino, con las reglas reales: la caja alta choca una fila
// antes y tapa también el carril opuesto, las que ruedan siguen rodando, el muro de cartón (la piedra
// de al lado del cartón no toca si vas por su carril) y la caja por acampar. En el salto entre mundos
// hace piruetas. Los niveles se distinguen por reflejos (retardo), vista (filas), giro máximo,
// conocimiento de las reglas y despistes. Uso:
//   node tests/bot-pro.mjs [modo] [partidas] [nivel]      (nivel: todos por defecto)
import { Game, LANES, CELL_DEG, R_UNITS, stripHalfWidth, laneAngle, FOLD_IN, FOLD_OUT } from '../app/src/sim/game.js';
import { Arcade, TRICK_T, CAMP_ROWS } from '../app/src/sim/arcade.js';

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
const angleIn = (t, lo, hi) => (hi > lo ? t > lo && t < hi : t > lo || t < hi);

export const LEVELS = {
  //           reflejos (fotogramas) · vista (filas) · giro máx · sabe que la alta choca antes · cartón · piruetas · despiste/s
  novato:  { delay: 15, look: 8,  maxSteer: 0.30, knowsTall: false, carton: 0.5, tricks: 0,   lapse: 0.35 },
  medio:   { delay: 12, look: 10, maxSteer: 0.40, knowsTall: true,  carton: 0.7, tricks: 0.5, lapse: 0.25 },
  bueno:   { delay: 4,  look: 16, maxSteer: 0.50, knowsTall: true,  carton: 1,   tricks: 1,   lapse: 0.03 },
  experto: { delay: 1,  look: 22, maxSteer: 0.50, knowsTall: true,  carton: 1,   tricks: 1,   lapse: 0 },
};

function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function createBot(levelName, seed = 1) {
  const L = typeof levelName === 'string' ? LEVELS[levelName] : levelName;
  const rnd = mulberry(seed * 7919 + 13);
  const queue = [];            // órdenes de giro pendientes (los reflejos)
  let target = -1, replanIn = 0, lapseLeft = 0;
  const doesTricks = rnd() < L.tricks;

  function plan(g) {
    const open = g.fold !== FOLD_IN && g.fold !== FOLD_OUT;
    const hw = stripHalfWidth(g.fold);
    const cur = Math.floor(g.s);
    const v = Math.max(g.v, 1.5);
    const rowsPerFrame = v / R_UNITS;
    const H = Math.min(70, Math.ceil((L.look + 1) / rowsPerFrame));
    const edge = 90 - g.fold;
    // cajas que veo
    const seen = [];
    for (const b of g.boxes) {
      if (b.hit || b.k < cur || b.k > cur + L.look + 1) continue;
      if (b.carton) continue;
      const tall = b.tall && L.knowsTall;
      let cLane = -1;
      if (b.wall) { const c = g.boxes.find((x) => x.wall && x.carton && x.k === b.k); cLane = c ? c.lane : -1; }
      seen.push({ b, tall, cLane, opp: tall && g.fold === FOLD_IN });
    }
    const cartons = g.boxes.filter((b) => b.carton && !b.hit && b.k >= cur && b.k <= cur + L.look + 1);
    const campNear = g.campRows !== undefined && g.campRows > CAMP_ROWS - 6;
    const myLane = g.lane;
    let best = 0, bestCost = Infinity;
    const costs = [];
    for (let l = 0; l < LANES; l++) {
      const goal = laneAngle(l);
      let th = g.theta;
      let cost = 0, om = g.omega || 0;
      const hitBoxes = new Set();
      // giro por el camino más corto en tubo; directo en lámina
      let diff = goal - th;
      if (!open) diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const goalUnwrapped = th + diff;
      for (let t = 1; t <= H; t++) {
        if (t <= L.delay) th += om;                     // aún no he reaccionado: sigo como iba
        else {
          const d = goalUnwrapped - th;
          const steer = Math.abs(d * 0.35) < 0.019 ? 0 : Math.max(-L.maxSteer, Math.min(L.maxSteer, d * 0.35));
          const gr = g.gripAt ? g.gripAt(g.s + rowsPerFrame * t) : null;   // agarre de la superficie (solo Arcade)
          om = gr ? om + gr.k * (steer * 0.2 * gr.g - om) : steer * 0.2; th += om;
        }
        if (open) th = Math.max(-0.1, Math.min(5.9, th));
        const s = g.s + rowsPerFrame * t, c = Math.floor(s), f = s - c;
        const tw = wrap(th);
        const inside = (a) => (open ? th > a - hw && th < a + hw : angleIn(tw, wrap(a - hw), wrap(a + hw)));
        const lane = ((Math.round(th / (CELL_DEG * DEG)) % LANES) + LANES) % LANES;
        for (const e of seen) {
          const b = e.b;
          if (hitBoxes.has(b)) continue;
          const hitsNow = e.tall ? b.k === c + 1 : ((b.k === c + 1 && f > 0.5) || b.k === c);
          if (!hitsNow) continue;
          if (e.cLane >= 0 && lane === e.cLane) continue;
          let a;
          if (b.fixed) a = laneAngle(b.lane); else a = laneAngle(b.lane) + ((b.roll + b.rollSpeed * t) / edge) * CELL_DEG * DEG;
          if (inside(a) || (e.opp && inside(a + Math.PI))) { hitBoxes.add(b); cost += 100 / (1 + t / 40); }
        }
        if (cost > 400) break;
      }
      // cartón del muro: hay que pasar por su carril
      for (const cb of cartons) if (cb.lane !== l && L.carton > 0) cost += 25 * L.carton;
      // placas de impulso: prefiero pasar por ellas
      for (const p of g.pads) if (!p.taken && p.k >= cur && p.k <= cur + L.look && p.lane === l) cost -= 3 / (1 + (p.k - cur) / 6);
      // monedas (solo si el nivel las persigue: L.coins > 0)
      if (L.coins) for (const c of g.coins) if (!c.got && c.lane === l && c.k >= cur && c.k <= cur + L.look) cost -= L.coins / (1 + (c.k - cur) / 8);
      if (campNear && l === myLane) cost += 12;
      // ir lejos cuesta un poco; mantener el destino anterior da estabilidad
      cost += Math.abs(diff) * 1.5;
      if (l === target) cost -= 1;
      costs.push(+cost.toFixed(1));
      if (cost < bestCost) { bestCost = cost; best = l; }
    }
    act.costs = costs;
    return best;
  }

  function act(g) {
    if (lapseLeft > 0) lapseLeft--;
    else if (L.lapse && rnd() < L.lapse / 60) lapseLeft = 12 + ((rnd() * 20) | 0);
    if (lapseLeft === 0) {
      if (--replanIn <= 0 || target < 0) { target = plan(g); replanIn = 2; }
    }
    let steer = 0;
    if (target >= 0) {
      const open = g.fold !== FOLD_IN && g.fold !== FOLD_OUT;
      let d = laneAngle(target) - g.theta;
      if (!open) d = Math.atan2(Math.sin(d), Math.cos(d));
      steer = Math.max(-L.maxSteer, Math.min(L.maxSteer, d * 0.35));
    }
    queue.push(steer);
    const out = queue.length > L.delay ? queue.shift() : 0;
    let trick = false;
    if (doesTricks && g.flight && g.trickT < 0) {
      const f = g.flight();
      if (f) {
        const land = g.landIn;
        trick = land >= 0.8 || (land <= 0.7 && land >= TRICK_T + 0.01);
      }
    }
    return { steer: out, trick };
  }
  return act;
}

// crea la partida de un modo; 'arcade' es el de «Jugar» (sin muros fáciles: el peor caso)
export function makeGame(mode, seed) {
  if (mode === 'arcade') return new Arcade({ seed });
  return new Game({ mode, seed });
}

export function playGame(mode, seed, level, { maxSeconds = 600 } = {}) {
  const g = makeGame(mode, seed);
  const bot = createBot(level, seed);
  const st = { crashes: 0, boosts: 0, tricks: 0 };
  const max = maxSeconds * 60;
  while (g.alive && g.frame < max) {
    for (const e of g.step(bot(g))) {
      if (e.type === 'crash') st.crashes++;
      if (e.type === 'boost') st.boosts++;
      if (e.type === 'trickDone') st.tricks++;
    }
  }
  return { seed, t: g.time, dist: g.distanceM, world: g.world, alive: g.alive, walls: g.walls || 0, smashes: g.smashes || 0, ...st };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

export function runLevels(mode, N, names = Object.keys(LEVELS)) {
  const out = {};
  for (const name of names) {
    const rs = [];
    for (let i = 0; i < N; i++) rs.push(playGame(mode, 1000 + i, name));
    const walls = rs.reduce((a, r) => a + r.walls, 0), smashes = rs.reduce((a, r) => a + r.smashes, 0);
    out[name] = {
      mediana: +median(rs.map((r) => r.t)).toFixed(1),
      peor10: +pct(rs.map((r) => r.t), 0.1).toFixed(1),
      mejor10: +pct(rs.map((r) => r.t), 0.9).toFixed(1),
      mundo2: Math.round(100 * rs.filter((r) => r.world >= 2).length / N),
      murosRotos: walls ? Math.round(100 * smashes / walls) : null,
      muros: walls,
      piruetas: +(rs.reduce((a, r) => a + r.tricks, 0) / N).toFixed(1),
      vivos: rs.filter((r) => r.alive).length,
    };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || 'arcade';
  const N = +(process.argv[3] || 40);
  const only = process.argv[4] ? [process.argv[4]] : undefined;
  const t0 = Date.now();
  const res = runLevels(mode, N, only);
  console.table(res);
  const meds = Object.values(res).map((r) => r.mediana);
  const rising = meds.every((m, i) => i === 0 || m > meds[i - 1]);
  if (!only && !rising) process.exitCode = 1;
  console.log(`modo ${mode},${N} semillas: mediana ${meds.join(' → ')} s ${only ? '' : rising ? '(sube estrictamente)' : '(NO sube)'} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
