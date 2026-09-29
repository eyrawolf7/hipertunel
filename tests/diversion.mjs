// Informe de diversión automático: juega con el bot-pro (cuatro niveles) sobre la simulación pura y
// saca, por modo y nivel, lo que decide si el juego engancha: cuánto dura una partida, cuándo llega
// el primer choque, quién llega al mundo 2, cuánto tiempo va con impulso, de qué caja se muere frente
// a cuánto sale, hasta dónde llega cada momento especial, muros y cartón, misiones cumplidas.
// Escribe .noche/diversion.json (determinista: mismas semillas, mismas cifras) y lo compara con
// .noche/metricas-base.json (lo crea la primera vez; --base lo rehace). En rojo lo que empeora.
//   node tests/diversion.mjs [--base] [--n=20] [--nc=8]
// Los niveles «bueno» y «experto» son techos teóricos, no jugadores humanos: léelos como «bot con
// reflejos de X ms».
import fs from 'node:fs';
import { createBot, LEVELS, makeGame } from './bot-pro.mjs';
// las misiones guardan en localStorage: uno en memoria (Node no lo tiene y avisa al tocarlo)
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { createMissions } = await import('../app/src/missions.js');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? +a.split('=')[1] : d; };
const N = { arcade: arg('n', 20), classic: arg('nc', 8) };
const MODES = ['arcade', 'classic'];
const BASE = new URL('../.noche/metricas-base.json', import.meta.url);
const OUT = new URL('../.noche/diversion.json', import.meta.url);
const MAX_S = 600;

const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r1 = (x) => (x === null ? null : +x.toFixed(1));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const KINDS = ['fija', 'rodante', 'alta', 'muro', 'acampar'];
const SPECIAL = ['impulso', 'mundo', 'plegado', 'muro', 'pirueta'];

// una partida completa con todas las medidas
function play(mode, seed, level) {
  const g = makeGame(mode, seed);
  const bot = createBot(level, seed);
  const realRandom = Math.random;
  Math.random = mulberry(seed * 31 + 7);          // misiones deterministas
  const missions = createMissions();
  missions.reset();
  missions.start();
  let visWorld = 1, nearT = 0, campNext = false;
  const r = { seed, firstCrash: null, boostFrames: 0, near: 0, spawned: Object.fromEntries(KINDS.map((k) => [k, 0])), deaths: null, first: {}, last: { t: 0, kind: null } };
  // las placas salen todo el rato: no cuentan para «el momento especial más lejano»
  const mark = (kind) => { if (r.first[kind] === undefined) r.first[kind] = g.time; if (kind !== 'impulso' && g.time >= r.last.t) r.last = { t: g.time, kind }; };
  const kindOf = (b, camp) => (b.wall ? 'muro' : camp ? 'acampar' : b.tall ? 'alta' : b.fixed ? 'fija' : 'rodante');
  const camps = new Set();
  const max = MAX_S * 60;
  while (g.alive && g.frame < max) {
    const prevS = g.s;
    const ev = g.step(bot(g));
    if (g.level > 0) r.boostFrames++;
    for (const e of ev) {
      if (e.type === 'camp') campNext = true;
      else if (e.type === 'spawn') {
        const b = g.boxes.find((x) => x.id === e.id);
        if (b) { if (campNext) camps.add(b.id); r.spawned[kindOf(b, campNext)]++; }
        campNext = false;
      } else if (e.type === 'wall') r.spawned.muro += 11;
      else if (e.type === 'crash') { if (r.firstCrash === null) r.firstCrash = g.time; }
      else if (e.type === 'boost') mark('impulso');
      else if (e.type === 'world') { if (!g.inverted && g.world / 2 + 1 > visWorld) { visWorld++; e.visWorld = visWorld; mark('mundo'); } }
      else if (e.type === 'foldStart') mark('plegado');
      else if (e.type === 'trickDone') mark('pirueta');
      missions.event(e, g);
      if (e.type === 'wall') mark('muro');
      if (e.type === 'death') {
        const b = g.boxes.find((x) => x.id === e.id);
        r.deaths = b ? kindOf(b, camps.has(b.id)) : 'fija';
      }
    }
    // «por los pelos» (mismo cálculo que main.js): una caja pasa rozando el carril de al lado
    if (g.alive && g.speedMS > 60 && (nearT -= 1 / 60) <= 0) {
      const hw = Math.PI / 6;
      for (const b of g.boxes) {
        if (b.hit || b.k + 0.5 <= prevS || b.k + 0.5 > g.s) continue;
        let d = g.theta - b.lane * hw; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > hw * 0.8 && Math.abs(d) < hw * 1.6) { nearT = 0.4; r.near++; missions.event({ type: 'near' }, g); break; }
      }
    }
    missions.tick(g, Math.max(0, g.distanceM - (r.dPrev || 0))); r.dPrev = g.distanceM;
  }
  missions.finish();
  const done = missions.rank().done;
  Math.random = realRandom;
  return { ...r, t: g.time, alive: g.alive, world: g.world, visWorld, walls: g.walls || 0, smashes: g.smashes || 0, tricks: g.tricksTotal || 0, missions: done };
}

function summarize(rs) {
  const n = rs.length;
  const dead = rs.filter((r) => r.deaths);
  const killed = Object.fromEntries(KINDS.map((k) => [k, dead.filter((r) => r.deaths === k).length]));
  const spawned = Object.fromEntries(KINDS.map((k) => [k, rs.reduce((a, r) => a + r.spawned[k], 0)]));
  const totSp = KINDS.reduce((a, k) => a + spawned[k], 0) || 1;
  const walls = rs.reduce((a, r) => a + r.walls, 0), smashes = rs.reduce((a, r) => a + r.smashes, 0);
  const t = rs.map((r) => r.t);
  const lastKinds = {};
  for (const r of rs) if (r.last.kind) lastKinds[r.last.kind] = (lastKinds[r.last.kind] || 0) + 1;
  return {
    partidas: n,
    mediana_s: r1(median(t)),
    peor10_s: r1(pct(t, 0.1)),
    primerChoque_s: r1(median(rs.filter((r) => r.firstCrash !== null).map((r) => r.firstCrash))),
    sinChocar_pct: Math.round(100 * rs.filter((r) => r.firstCrash === null).length / n),
    mundo2_pct: Math.round(100 * rs.filter((r) => r.visWorld >= 2).length / n),
    impulso_pct: Math.round(100 * rs.reduce((a, r) => a + r.boostFrames, 0) / Math.max(1, t.reduce((a, b) => a + b, 0) * 60)),
    roces_min: r1(rs.reduce((a, r) => a + r.near, 0) / Math.max(1, t.reduce((a, b) => a + b, 0) / 60)),
    muertesPorCaja_pct: Object.fromEntries(KINDS.map((k) => [k, dead.length ? Math.round(100 * killed[k] / dead.length) : 0])),
    cajasQueSalen_pct: Object.fromEntries(KINDS.map((k) => [k, Math.round(100 * spawned[k] / totSp)])),
    momentos: Object.fromEntries(SPECIAL.map((k) => {
      const ts = rs.filter((r) => r.first[k] !== undefined).map((r) => r.first[k]);
      return [k, { llegan_pct: Math.round(100 * ts.length / n), primera_mediana_s: r1(median(ts)) }];
    })),
    masLejano: { mediana_s: r1(median(rs.map((r) => r.last.t))), tipos: lastKinds },
    muros: walls, cartonRoto_pct: walls ? Math.round(100 * smashes / walls) : null,
    misionesPorPartida: r1(rs.reduce((a, r) => a + r.missions, 0) / n),
  };
}

const t0 = Date.now();
const out = {};
for (const mode of MODES) {
  out[mode] = {};
  for (const level of Object.keys(LEVELS)) {
    const rs = [];
    for (let i = 0; i < N[mode]; i++) rs.push(play(mode, 1000 + i, level));
    out[mode][level] = summarize(rs);
  }
}
fs.mkdirSync(new URL('../.noche/', import.meta.url), { recursive: true });
const cfg = { n: N.arcade, nc: N.classic };
fs.writeFileSync(OUT, JSON.stringify({ cfg, ...out }, null, 1) + '\n');

// comparación con la base: [ruta, +1 si más es mejor / -1 si menos es mejor, tolerancia relativa]
const WATCH = [
  ['mediana_s', +1, 0.15], ['peor10_s', +1, 0.2], ['primerChoque_s', +1, 0.2], ['mundo2_pct', +1, 0.1],
  ['impulso_pct', +1, 0.2], ['cartonRoto_pct', +1, 0.1], ['misionesPorPartida', +1, 0.25],
];
const RED = (s) => `\x1b[31m${s}\x1b[0m`, GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
let worse = 0;
const haveBase = fs.existsSync(BASE) && !process.argv.includes('--base');
let base = haveBase ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : null;
if (base && (base.cfg?.n !== cfg.n || base.cfg?.nc !== cfg.nc)) { console.log(`(la base es de otras semillas ${JSON.stringify(base.cfg)}: no se compara; usa --base para rehacerla)`); base = null; }
for (const mode of MODES) {
  console.log(`\n== ${mode} (${N[mode]} semillas por nivel) ==`);
  const rows = {};
  for (const level of Object.keys(LEVELS)) {
    const m = out[mode][level];
    rows[level] = { mediana: m.mediana_s, peor10: m.peor10_s, 'choque 1º': m.primerChoque_s, mundo2: m.mundo2_pct + '%', impulso: m.impulso_pct + '%', 'roces/min': m.roces_min, 'cartón': m.cartonRoto_pct === null ? '-' : m.cartonRoto_pct + '%', misiones: m.misionesPorPartida };
  }
  console.table(rows);
  for (const level of Object.keys(LEVELS)) {
    const m = out[mode][level];
    const muertes = KINDS.map((k) => `${k} ${m.muertesPorCaja_pct[k]}% (salen ${m.cajasQueSalen_pct[k]}%)`).join(' · ');
    console.log(`  ${level}: muertes por caja → ${muertes}`);
    console.log(`  ${level}: momentos → ${SPECIAL.map((k) => `${k} ${m.momentos[k].llegan_pct}%@${m.momentos[k].primera_mediana_s ?? '-'}s`).join(' · ')} · más lejano ${m.masLejano.mediana_s}s`);
    if (!base || !base[mode]?.[level]) continue;
    for (const [key, sign, tol] of WATCH) {
      const a = base[mode][level][key], b = m[key];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      const rel = (b - a) / Math.max(Math.abs(a), 1e-9) * sign;
      if (rel < -tol) { worse++; console.log(RED(`  ⚠ ${mode}/${level}: ${key} empeora ${a} → ${b}`)); }
      else if (rel > tol) console.log(GREEN(`  ✓ ${mode}/${level}: ${key} mejora ${a} → ${b}`));
    }
  }
}
if (!haveBase) { fs.writeFileSync(BASE, JSON.stringify({ cfg, ...out }, null, 1) + '\n'); console.log('\nBase creada en .noche/metricas-base.json'); }
else if (!base) console.log('\nSin comparar (base de otras semillas)');
else console.log(worse ?RED(`\n${worse} métricas empeoran respecto a la base`) : '\nSin empeoramientos respecto a la base');
console.log(`JSON en .noche/diversion.json · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
