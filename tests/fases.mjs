// Fases sin navegador: los bots de bot-pro (novato/medio/bueno/experto) juegan cada fase con puntos
// de control: cuántos intentos necesitan, cuánto dura, estrellas, y que fantasma y puntos de
// control son deterministas. Uso: node tests/fases.mjs [semillas-del-bot] [--fase=N] [--rapido]
//   intento = una salida: la primera desde el principio y las demás desde el último control con su
//   impulso de regalo (lo que hace «Otra vez» al morir)
//   --wave=N --stretch=X --len=N --seed=N   para probar otro trazado de la fase elegida
import { Fase, FASES, Recording, replay, packRec, unpackRec, quantSteer } from '../app/src/sim/fases.js';
import { createBot, LEVELS as BASE } from './bot-pro.mjs';
// los cuatro niveles de bot-pro y dos que además persiguen monedas (para la tercera estrella)
export const LEVELS = { ...BASE, 'medio+monedas': { ...BASE.medio, coins: 2 }, 'bueno+monedas': { ...BASE.bueno, coins: 2 } };

const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };

// una salida: parte de `rec` (grabación hasta el control, vacía si es desde el principio) y juega
// hasta morir o superar. Devuelve la partida, la grabación entera y la del último control pasado.
export function attempt(fase, bot, rec, { maxSeconds = 240 } = {}) {
  const g = new Fase({ fase });
  replay(g, rec);
  const total = rec.slice(rec.length);
  let cpRec = rec.length ? rec.slice(rec.length) : null;
  let gift = rec.length > 0;
  while (g.alive && g.frame < maxSeconds * 60) {
    const a = bot(g), st = quantSteer(a.steer);
    total.push(st, a.trick, gift);
    for (const e of g.step({ steer: st, trick: a.trick, gift })) if (e.type === 'checkpoint') cpRec = total.slice(total.length);
    gift = false;
  }
  return { g, total, cpRec };
}

// una fase completa hasta superarla (o rendirse a los 12 intentos). policy 'control': vuelve al
// último control; 'principio': siempre desde cero
export function playFase(fase, level, botSeed, { policy = 'control', maxTries = 12, bot = createBot(LEVELS[level] || level, botSeed) } = {}) {
  let rec = new Recording(), tries = 0;
  for (;;) {
    tries++;
    const r = attempt(fase, bot, rec);
    if (r.g.cleared) return { cleared: true, tries, g: r.g, total: r.total, time: r.g.time };
    if (tries >= maxTries) return { cleared: false, tries, g: r.g, total: r.total };
    rec = policy === 'control' && r.cpRec ? r.cpRec : new Recording();
  }
}

// resumen de un nivel de bot en una fase
export function resumen(fase, level, N, opts = {}) {
  const rs = [];
  for (let b = 0; b < N; b++) rs.push(playFase(fase, level, b + 1, opts));
  const cl = rs.filter((r) => r.cleared), first = rs.filter((r) => r.cleared && r.tries === 1);
  const stars = [0, 0, 0]; for (const r of cl) { if (r.g.starBits & 2) stars[1]++; if (r.g.starBits & 4) stars[2]++; } stars[0] = cl.length;
  const monedas = cl.map((r) => r.g.picked / Math.max(1, r.g.coinsSpawned));
  return {
    supera: Math.round(100 * cl.length / N), en3: Math.round(100 * rs.filter((r) => r.cleared && r.tries <= 3).length / N),
    intentos: +median(rs.map((r) => r.tries)).toFixed(1),
    segs1: first.length ? +median(first.map((r) => r.time)).toFixed(1) : null,
    segsTodos: cl.length ? +median(cl.map((r) => r.time)).toFixed(1) : null,
    estrellas: stars, monedas: +median(monedas).toFixed(2), rs,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const N = +(args.find((a) => /^\d+$/.test(a)) || 20);
  const only = args.find((a) => a.startsWith('--fase='));
  const fast = args.includes('--rapido');
  for (const a of args) { const m = /^--(wave|stretch|len|seed|ease)=([\d.]+)$/.exec(a); if (m && only) FASES[+only.split('=')[1]][m[1]] = +m[2]; }
  const fases = only ? [+only.split('=')[1]] : [...Array(FASES.length).keys()];
  const levels = fast ? ['novato', 'medio'] : Object.keys(LEVELS);
  const t0 = Date.now();
  for (const f of fases) {
    console.log(`Fase ${f + 1} · ${FASES[f].name} (${N} semillas del bot)`);
    for (const lv of levels) {
      const s = resumen(f, lv, N);
      console.log(`  ${lv.padEnd(8)} supera ${String(s.supera).padStart(3)} % · en ≤3 intentos ${String(s.en3).padStart(3)} % · intentos (mediana) ${s.intentos} · s (limpia) ${s.segs1 ?? '—'} · s (con control) ${s.segsTodos ?? '—'} · con ★ superada·sin chocar·monedas: ${s.estrellas.join('·')} (monedas ~${Math.round(100 * s.monedas)} %)`);
    }
  }
  console.log(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);

  // ---------------------------------------------------------------- criterios y determinismo
  if (!args.includes('--sin-checks')) {
    let fails = 0;
    const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
    const snap = (g) => JSON.stringify([g.frame, g.s, g.theta, g.omega, g.v, g.level, g.coinsGot, g.picked, g.crashes, g.boxes.length, g.rng.state, g.cpIdx, g.gifts, g.alive, g.cleared]);
    console.log('Criterios (bots de bot-pro; margen = distancia al umbral)');
    for (const f of fases) {
      const nov = resumen(f, 'novato', N), med = resumen(f, 'medio', N);
      const dur = med.segs1 ?? med.segsTodos;
      if (f === 0) ok(nov.en3 >= 70, `Fase 1: el novato la supera en ≤ 3 intentos en ${nov.en3} % de las semillas (≥ 70 %, margen ${nov.en3 - 70})`);
      ok(dur >= 60 && dur <= 90, `Fase ${f + 1}: dura ${dur} s con el bot medio (60-90 s, margen ${Math.min(dur - 60, 90 - dur).toFixed(1)})`);
      ok(med.supera === 100 && nov.supera >= 90, `Fase ${f + 1}: con puntos de control la superan el medio (${med.supera} %) y el novato (${nov.supera} %)`);
    }
    // determinismo
    console.log('Determinismo');
    for (const f of fases) {
      const a = new Fase({ fase: f }), b = new Fase({ fase: f });
      ok(JSON.stringify(a.gaps) === JSON.stringify(b.gaps) && a.cps.join() === b.cps.join() && a.rng.state === b.rng.state, `Fase ${f + 1}: el mismo recorrido en cada intento`);
      // dos jugadores iguales → la misma partida; y a mitad el punto de control repetido da el mismo estado
      let bad = 0, cpBad = 0, cpN = 0, ghostBad = 0, giftBad = 0;
      for (let s = 1; s <= 6; s++) {
        const bot = createBot('medio', s);
        const run = attempt(f, bot, new Recording());
        // fantasma: empaquetar/desempaquetar y repetir en una partida nueva = mismo final
        const ghost = replay(new Fase({ fase: f }), unpackRec(packRec(run.total)));
        if (snap(ghost) !== snap(run.g) || run.g.frame < 1000) ghostBad++;
        // control: repetir hasta el control da el estado que había al pasarlo
        if (run.cpRec) {
          cpN++;
          const g1 = replay(new Fase({ fase: f }), run.cpRec), g2 = replay(new Fase({ fase: f }), run.cpRec);
          const probe = new Fase({ fase: f }); let at = null;
          for (let i = 0; i < run.cpRec.length; i++) { probe.step(run.cpRec.input(i)); }
          at = snap(probe);
          if (snap(g1) !== at || snap(g2) !== at || g1.cpIdx < 1) cpBad++;
          // regalo: desde el control, una salida entera (con el regalo grabado) se repite exacta
          const again = attempt(f, createBot('medio', s + 50), run.cpRec);
          const rep = replay(new Fase({ fase: f }), unpackRec(packRec(again.total)));
          if (snap(rep) !== snap(again.g) || again.g.gifts !== 1) giftBad++;
        }
      }
      ok(ghostBad === 0, `Fase ${f + 1}: el fantasma (giros, piruetas y regalos guardados) repite la partida exacta en 6 semillas`);
      ok(cpN >= 4 && cpBad === 0, `Fase ${f + 1}: volver al control repite el mismo estado (${cpN} controles comprobados, ${cpBad} distintos)`);
      ok(giftBad === 0, `Fase ${f + 1}: una salida desde el control (con impulso de regalo) se repite exacta`);
    }
    // portal, mundo siguiente y estrellas
    console.log('Reglas');
    for (const f of fases) {
      const r = playFase(f, 'medio', 3);
      ok(r.cleared && r.g.portal && r.g.s > r.g.portal.to + 1 && r.g.themeN === FASES[f].theme + 1, `Fase ${f + 1}: se gana al aterrizar del salto entre mundos (tema ${FASES[f].theme} → ${r.g.themeN})`);
      const g = r.g;
      if (f === 0) ok(g.walls >= 1 && g.easyWalls === 0 && g.gaps.length >= 1, `Fase 1 lleva dentro el tutorial: muro de cartón fácil (${g.walls}) y salto con piruetas`);
      const fake = (o) => Object.assign(Object.create(Object.getPrototypeOf(g)), g, o);
      ok(fake({ crashes: 0, gifts: 0, picked: 1e6 }).starBits === 7, 'estrellas: superada, sin chocar y monedas sin controles = 3');
      ok(fake({ crashes: 0, gifts: 1, picked: 1e6 }).starBits === 3, 'estrellas: con un punto de control usado no vale la de monedas');
      ok(fake({ crashes: 1, gifts: 0, picked: 1e6 }).starBits === 5, 'estrellas: chocar quita la de sin chocar');
      ok(fake({ cleared: false }).starBits === 0, 'estrellas: sin superar no hay ninguna');
      const goal = g.coinGoal, sp = g.coinsSpawned;
      ok(goal === Math.ceil(0.35 * sp) && sp > 100, `monedas: la meta es el 35 % de las ${sp} del camino (${goal})`);
    }
    // el regalo solo pone impulso si no lo hay
    { const g = new Fase({ fase: 0 }); g.disableBoost(); const l0 = g.level; g.step({ steer: 0, gift: true }); ok(l0 === 0 && g.boostOn && g.level >= 1 && g.gifts === 1, 'regalo: sin impulso da uno'); const h = new Fase({ fase: 0 }); const lv = h.level; h.step({ steer: 0, gift: true }); ok(h.gifts === 1 && h.level === lv, 'regalo: con impulso no sube de nivel'); }
    console.log(fails ? `\n${fails} fallan` : '\nTodo OK');
    process.exit(fails ? 1 : 0);
  }
}
