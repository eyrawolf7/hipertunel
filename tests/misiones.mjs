// Misiones al alcance: el bot-pro juega 3 partidas SEGUIDAS de Arcade con el mismo estado de
// misiones (como un jugador nuevo) y cuenta las cumplidas por partida. También comprueba que
// ninguna misión activa es imposible en el modo en que se juega.
//   node tests/misiones.mjs [semillas=40] [nivel=novato]
// Sale con 1 si el nivel cumple < 1,5 misiones por partida en sus 3 primeras o hay una imposible.
import { createBot, makeGame } from './bot-pro.mjs';
let store = {};
globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
const { createMissions } = await import('../app/src/missions.js');
// qué misiones no pueden cumplirse en cada modo (según la simulación: cartón y piruetas solo en Arcade;
// Supervivencia no tiene placas, plegados ni choques con impulso)
const SOLO_ARCADE = ['smash', 'tricks', 'perfect', 'combo'];
const IMPOSIBLE = { arcade: [], classic: SOLO_ARCADE, timetrial: SOLO_ARCADE, survival: [...SOLO_ARCADE, 'pads', 'max', 'folds', 'saves'] };

const N = +(process.argv[2] || 40), LEVEL = process.argv[3] || 'novato';
const MAX_FRAMES = 600 * 60;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function play(missions, mode, seed) {
  const g = makeGame(mode, seed);
  const bot = createBot(LEVEL, seed);
  missions.start(mode);
  const before = missions.rank().done;
  let visWorld = 1, nearT = 0, prevD = 0;
  while (g.alive && g.frame < MAX_FRAMES) {
    const prevS = g.s;
    for (const e of g.step(bot(g))) {
      if (e.type === 'world' && !g.inverted && g.world / 2 + 1 > visWorld) { visWorld++; e.visWorld = visWorld; }
      missions.event(e, g);
    }
    if (g.alive && g.speedMS > 60 && (nearT -= 1 / 60) <= 0) {
      const hw = Math.PI / 6;
      for (const b of g.boxes) {
        if (b.hit || b.k + 0.5 <= prevS || b.k + 0.5 > g.s) continue;
        let d = g.theta - b.lane * hw; d = Math.atan2(Math.sin(d), Math.cos(d));
        if (Math.abs(d) > hw * 0.8 && Math.abs(d) < hw * 1.6) { nearT = 0.4; missions.event({ type: 'near' }, g); break; }
      }
    }
    missions.tick(g, Math.max(0, g.distanceM - prevD)); prevD = g.distanceM;
  }
  const activeBefore = missions.list().map((m) => m.text);
  missions.finish();
  return { done: missions.rank().done - before, t: g.time, activeBefore };
}

const mode = 'arcade';
const perGame = Array.from({ length: 9 }, () => []);
let bad = 0;
const real = Math.random;
for (let i = 0; i < N; i++) {
  store = {};
  Math.random = mulberry(i * 131 + 5);
  const missions = createMissions();
  missions.reset();
  for (let p = 0; p < 9; p++) {
    const r = play(missions, mode, 2000 + i * 9 + p);
    perGame[p].push(r.done);
    for (const id of missions.activeIds()) if (IMPOSIBLE[mode].includes(id)) { bad++; console.log(`  IMPOSIBLE en ${mode}: ${id} (semilla ${i}, partida ${p + 1})`); }
  }
}
// en los demás modos, al empezar, las misiones sin tocar que no existen allí se cambian.
// Tabla escrita a mano desde la simulación (no sale de missionsFor, para que la prueba no pase en vacío).
let cambios = 0;
for (let i = 0; i < 60; i++) {
  store = {};
  Math.random = mulberry(i * 17 + 3);
  const missions = createMissions();
  missions.reset();
  for (const m of ['classic', 'survival', 'timetrial', 'arcade']) {
    const antes = missions.activeIds().filter((id) => IMPOSIBLE[m].includes(id)).length;
    missions.start(m);
    cambios += antes;
    for (const id of missions.activeIds()) if (IMPOSIBLE[m].includes(id)) { bad++; console.log(`  IMPOSIBLE en ${m}: ${id} (sorteo ${i})`); }
  }
}
if (!cambios) { bad++; console.log('  FALLA: ninguna misión imposible se cambió (la prueba no ejercita nada)'); }
console.log(`misiones imposibles sustituidas al cambiar de modo: ${cambios}`);
Math.random = real;
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const means = perGame.map(avg);
const first3 = means.slice(0, 3);
console.log(`${LEVEL} en ${mode}, ${N} semillas, 9 partidas seguidas`);
console.log('misiones cumplidas por partida (1..9):', means.map((m) => m.toFixed(2)).join(' · '), '| media de las 3 primeras', avg(first3).toFixed(2));
const first = perGame[0].filter((d) => d >= 1).length;
console.log(`partida 1 con ≥ 1 misión: ${Math.round(100 * first / N)} %`);
const okAvg = avg(first3) >= 1.5;
console.log(okAvg ? 'OK  ≥ 1,5 misiones por partida en las 3 primeras' : 'FALLA  < 1,5 misiones por partida en las 3 primeras');
if (bad) console.log(`FALLA  ${bad} misiones imposibles`);
process.exit(okAvg && !bad ? 0 : 1);
