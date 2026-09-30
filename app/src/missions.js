// Misiones cortas: tres activas a la vez, que se cumplen jugando y se sustituyen por otras. Cada 3
// cumplidas se sube de rango, y las nuevas son algo más exigentes. Solo escuchan lo que ya pasa en
// la partida (sucesos de la simulación y lo que mide main.js): no tocan las reglas de Boost 2.
// Sin DOM: la interfaz pinta lo que devuelve list().

const KEY = 'hipertunel-misiones';

// kind: 'run' = en una sola partida; 'total' = sumando partidas. v = valores por dificultad; el
// primero es el de la introducción (rango 1, sin azar: al alcance de quien acaba de empezar).
// arcade: solo existe en Arcade y Zorro (muro de cartón y piruetas del salto entre mundos).
// hard: no sale en el rango 1 (hace falta ya algo de dominio).
// no: modos donde no existe (Supervivencia no tiene placas, plegados ni choques con impulso).
const ARCADE_MODES = ['arcade', 'zorro'];
const SURV = ['survival'];
const TEMPLATES = [
  { id: 'dist', kind: 'run', stat: 'dist', v: [500, 800, 1500, 2500, 4000, 6000, 9000], text: (n) => `Recorre ${fmt(n)} m en una partida` },
  { id: 'clean', kind: 'run', stat: 'cleanBest', v: [300, 500, 900, 1500, 2500, 4000], text: (n) => `Recorre ${fmt(n)} m sin chocar` },
  { id: 'coinsRun', kind: 'run', stat: 'coins', v: [5, 8, 15, 25, 40, 60], text: (n) => `Coge ${n} monedas en una partida` },
  { id: 'coinsTot', kind: 'total', stat: 'coins', v: [25, 40, 100, 200, 400], text: (n) => `Coge ${n} monedas en total` },
  { id: 'near', kind: 'run', stat: 'near', v: [1, 2, 4, 7, 10, 15], text: (n) => n === 1 ? 'Pasa rozando una caja' : `Pasa rozando ${n} cajas en una partida` },
  { id: 'pads', kind: 'run', no: SURV, stat: 'pads', v: [2, 4, 8, 12, 18, 25], text: (n) => `Pisa ${n} placas de impulso en una partida` },
  { id: 'max', kind: 'run', hard: true, no: SURV, stat: 'maxSpeed', v: [1, 1, 2, 3, 5], text: (n) => n === 1 ? 'Llega a velocidad máxima' : `Llega ${n} veces a velocidad máxima en una partida` },
  { id: 'world', kind: 'run', hard: true, stat: 'world', v: [2, 2, 3, 4, 5, 6], text: (n) => `Llega al mundo ${n}` },
  { id: 'folds', kind: 'run', no: SURV, stat: 'folds', v: [1, 1, 2, 4, 6], text: (n) => n === 1 ? 'Sal por fuera del túnel' : `Sal por fuera del túnel ${n} veces en una partida` },
  { id: 'saves', kind: 'run', no: SURV, stat: 'saves', v: [1, 1, 2, 3, 5], text: (n) => n === 1 ? 'Choca con impulso y sigue vivo' : `Sobrevive a ${n} choques en una partida` },
  // Arcade: muro de cartón y piruetas del salto entre mundos
  { id: 'smash', kind: 'run', arcade: true, hard: true, stat: 'smashes', v: [1, 1, 2, 3, 5], text: (n) => n === 1 ? 'Rompe un bloque de cartón' : `Rompe ${n} bloques de cartón en una partida` },
  { id: 'tricks', kind: 'total', arcade: true, hard: true, stat: 'tricks', v: [2, 3, 8, 15, 25], text: (n) => `Haz ${n} piruetas en total` },
  { id: 'perfect', kind: 'run', arcade: true, hard: true, stat: 'perfect', v: [1, 1, 2, 3], text: (n) => n === 1 ? 'Haz una pirueta perfecta' : `Haz ${n} piruetas perfectas en una partida` },
  { id: 'combo', kind: 'run', arcade: true, hard: true, stat: 'combo', v: [2, 2, 3], text: (n) => `Encadena ${n} piruetas en un mismo salto` },
  { id: 'runs', kind: 'total', stat: 'runs', v: [2, 3, 5, 8], text: (n) => `Juega ${n} partidas` },
];

// ids de las misiones que pueden salir (y cumplirse) en un modo
export const missionsFor = (mode) => TEMPLATES.filter((t) => (!t.arcade || ARCADE_MODES.includes(mode)) && !(t.no && t.no.includes(mode))).map((t) => t.id);

const RANKS = ['Novato', 'Aprendiz', 'Piloto', 'Piloto veterano', 'As del túnel', 'Maestro', 'Leyenda', 'Leyenda de oro'];

const fmt = (n) => n.toLocaleString('es-ES');

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.active)) return d; } catch (e) {}
  return { rank: 0, done: 0, active: [], seq: 0 };
}

export function createMissions() {
  let data = load();
  let run = null, mode = 'arcade';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };

  // elige una misión nueva que no esté ya activa, con dificultad según el rango
  // Rango 1: tramo de introducción; rango 2: el siguiente, sin azar; ambos sin las difíciles. Solo
  // salen las que existen en el último modo jugado (Arcade al principio).
  function roll() {
    const used = new Set(data.active.map((m) => m.id));
    const ok = new Set(missionsFor(mode));
    const pool = TEMPLATES.filter((t) => !used.has(t.id) && ok.has(t.id) && !(data.rank < 2 && t.hard));
    const t = pool[(Math.random() * pool.length) | 0];
    let tier = Math.min(t.v.length - 1, data.rank);   // rango 1: introducción; rango 2: escalón intermedio
    if (data.rank > 1) tier = Math.max(1, Math.min(t.v.length - 1, 1 + Math.floor(data.rank / 2) + (Math.random() < 0.35 ? 1 : 0) - (Math.random() < 0.2 ? 1 : 0)));
    return { id: t.id, n: t.v[tier], got: 0, done: false, key: ++data.seq };
  }
  function fill() { while (data.active.length < 3) data.active.push(roll()); }
  fill(); save();

  const tpl = (m) => TEMPLATES.find((t) => t.id === m.id);

  // progreso de una misión con las cifras de la partida en curso
  function value(m) {
    const t = tpl(m);
    if (t.kind === 'total') return m.got + (run ? run[t.stat] || 0 : 0);
    return Math.max(m.got, run ? run[t.stat] || 0 : 0);
  }

  // comprueba si alguna se ha cumplido; devuelve las recién cumplidas (para el aviso en partida)
  function check() {
    const fresh = [];
    for (const m of data.active) {
      if (m.done) continue;
      if (value(m) >= m.n) { m.done = true; fresh.push({ text: tpl(m).text(m.n) }); data.done++; }
    }
    if (fresh.length) save();
    return fresh;
  }

  return {
    // al empezar una partida
    // (las sin empezar que no existen en este modo se cambian por otras que sí)
    start(m = 'arcade') {
      mode = m;
      const ok = new Set(missionsFor(m));
      const gone = data.active.filter((x) => !x.done && x.got === 0 && !ok.has(x.id));
      if (gone.length) { data.active = data.active.filter((x) => !gone.includes(x)); fill(); save(); }
      run = { dist: 0, clean: 0, cleanBest: 0, coins: 0, near: 0, pads: 0, maxSpeed: 0, world: 1, folds: 0, saves: 0, runs: 0, smashes: 0, tricks: 0, perfect: 0, combo: 0 };
    },
    activeIds() { return data.active.filter((m) => !m.done).map((m) => m.id); },
    // sucesos de la simulación y de main.js; devuelve las misiones recién cumplidas
    event(e, game) {
      if (!run) return [];
      if (e.type === 'coin') run.coins++;
      else if (e.type === 'boost') { run.pads++; if (e.level === 3) run.maxSpeed++; }
      else if (e.type === 'crash' && !e.fatal) { run.saves++; run.clean = 0; }
      else if (e.type === 'foldEnd' && game && game.fold < 0) run.folds++;
      else if (e.type === 'world' && e.visWorld) run.world = Math.max(run.world, e.visWorld);
      else if (e.type === 'near') run.near++;
      else if (e.type === 'smash') run.smashes++;
      else if (e.type === 'trickDone') { run.tricks++; if (e.perfect) run.perfect++; run.combo = Math.max(run.combo, e.n || 1); }
      return check();
    },
    // cada paso (para las de distancia)
    tick(game, dM) {
      if (!run) return [];
      run.dist = Math.floor(game.distanceM);
      run.clean += dM; run.cleanBest = Math.max(run.cleanBest, Math.floor(run.clean));
      return check();
    },
    // al terminar: las "de total" guardan lo sumado, las cumplidas se sustituyen y se sube de rango
    finish() {
      if (!run) return { completed: [], rankUp: false };
      run.runs = 1;
      const fresh = check();
      for (const m of data.active) { const t = tpl(m); if (!m.done && t.kind === 'total') m.got += run[t.stat] || 0;
        // las de una partida guardan tu mejor intento (si no, al acabar volvían a 0)
        if (!m.done && t.kind === 'run') m.got = Math.max(m.got, run[t.stat] || 0); }
      const completed = data.active.filter((m) => m.done).map((m) => ({ text: tpl(m).text(m.n) }));
      const before = data.rank;
      data.rank = Math.floor(data.done / 3);
      data.active = data.active.filter((m) => !m.done);
      fill();
      save();
      run = null;
      return { completed, fresh, rankUp: data.rank > before };
    },
    // para pintar: misiones activas con su progreso, y el rango
    list() {
      return data.active.map((m) => {
        const t = tpl(m), v = Math.min(m.n, value(m));
        return { text: t.text(m.n), got: v, n: m.n, done: m.done, total: t.kind === 'total', key: m.key };
      });
    },
    rank() { const r = data.rank; return { level: r + 1, name: RANKS[Math.min(RANKS.length - 1, r)], toNext: 3 - (data.done % 3), done: data.done }; },
    reset() { data = { rank: 0, done: 0, active: [], seq: 0 }; fill(); save(); },
  };
}
