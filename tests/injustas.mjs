// Detector de muertes injustas: en cada muerte se vuelve a un estado ~0,5 s antes y se busca, con un
// bot perfecto (sin reflejos), un plan de giros que la evite. Si ninguno la evita, la muerte era
// inevitable. Una muerte cuenta como evitada si con ese plan la partida sigue viva 0,5 s después del
// momento en que murió. El plan: decisiones de carril (12 opciones cada una) girando con el límite
// del bot «bueno» (0,5). Primero una búsqueda rápida (3 decisiones cada 12 fotogramas) y, si falla,
// otra más fina (5 cada 8): solo lo que no escapa con ninguna cuenta como inevitable.
// Uso desde diversion.mjs.
import { laneAngle, FOLD_IN, FOLD_OUT } from '../app/src/sim/game.js';
import { makeRng } from '../app/src/sim/rng.js';

export const SNAP_EVERY = 10;      // cada cuántos fotogramas se guarda un estado
export const BACK = 30;            // fotogramas antes de la muerte a los que se vuelve (0,5 s)
const AFTER = 30;                  // fotogramas de vida exigidos tras el momento de la muerte
const SEARCHES = [{ seg: 12, depth: 3 }, { seg: 8, depth: 5 }];
const MAX_STEER = 0.5;
const LANES = 12;

// copia profunda del estado de una partida (solo tiene objetos simples y dos generadores con semilla)
export function cloneGame(g) {
  const memo = new Map();
  const copy = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (memo.has(v)) return memo.get(v);
    if (Array.isArray(v)) { const a = []; memo.set(v, a); for (const x of v) a.push(copy(x)); return a; }
    if (typeof v.next === 'function' && 'state' in v) { const r = makeRng(0); r.state = v.state; memo.set(v, r); return r; }
    const o = Object.create(Object.getPrototypeOf(v));
    memo.set(v, o);
    for (const k of Object.keys(v)) o[k] = copy(v[k]);
    return o;
  };
  return copy(g);
}

// autocomprobación: un clon con las mismas entradas debe dar exactamente la misma partida
export function verifyClone(makeGame, seed = 1000, frames = 300) {
  const a = makeGame(seed), input = (i) => ({ steer: Math.sin(i / 20) * 0.4 });
  for (let i = 0; i < 200; i++) a.step(input(i));
  const b = cloneGame(a);
  const ea = [], eb = [];
  for (let i = 0; i < frames; i++) { ea.push(a.step(input(i))); eb.push(b.step(input(i))); }
  const ser = (g) => JSON.stringify(g, (k, v) => (typeof v === 'function' ? undefined : v));
  if (ser(a) !== ser(b) || JSON.stringify(ea) !== JSON.stringify(eb)) throw new Error('cloneGame: el clon se desvía del original');
}

// entrada de giro hacia un carril (mismo control que bot-pro, sin retardo)
function steerTo(g, lane) {
  const open = g.fold !== FOLD_IN && g.fold !== FOLD_OUT;
  let d = laneAngle(lane) - g.theta;
  if (!open) d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.max(-MAX_STEER, Math.min(MAX_STEER, d * 0.35));
}

// ¿hay un plan que evite la muerte? g es el estado de partida (se clona, no se toca)
export function escapable(g, deathFrame) {
  const horizon = deathFrame + AFTER;
  const order = (from) => Array.from({ length: LANES }, (_, i) => i).sort((a, b) => {
    const da = Math.min((a - from + LANES) % LANES, (from - a + LANES) % LANES);
    const db = Math.min((b - from + LANES) % LANES, (from - b + LANES) % LANES);
    return da - db;
  });
  const run = (s, lane, n) => { for (let i = 0; i < n && s.alive && s.frame < horizon; i++) s.step({ steer: steerTo(s, lane) }); };
  const dfs = (s, depth, { seg, depth: max }) => {
    for (const lane of order(s.lane)) {
      const c = cloneGame(s);
      run(c, lane, seg);
      if (!c.alive) continue;
      if (depth + 1 < max && c.frame < horizon) { if (dfs(c, depth + 1, { seg, depth: max })) return true; continue; }
      run(c, lane, horizon - c.frame);
      if (c.alive) return true;
    }
    return false;
  };
  return SEARCHES.some((cfg) => dfs(g, 0, cfg));
}

// anillo de estados: se llama antes de cada step; al morir, inevitable() dice si lo era
export function createWatcher() {
  const ring = [];
  return {
    before(g) {
      if (g.frame % SNAP_EVERY === 0) { ring.push(cloneGame(g)); if (ring.length > 6) ring.shift(); }
    },
    // fotograma de muerte deathFrame: true si ningún plan la evita
    inevitable(deathFrame) {
      let snap = ring[0];
      for (const s of ring) if (s.frame <= deathFrame - BACK) snap = s;
      return !escapable(snap, deathFrame);
    },
  };
}
