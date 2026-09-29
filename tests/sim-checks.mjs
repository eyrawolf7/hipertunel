// Comprobaciones de la simulación contra las reglas de Boost 2 (npm test). Sin navegador.
import { Game, V_START, V_MAX, stripHalfWidth, LANES } from '../app/src/sim/game.js';
import { botSteer } from '../app/src/sim/bot.js';
import { buildWaves } from '../app/src/sim/waves.js';
import { makeRng } from '../app/src/sim/rng.js';

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++; };
const near = (a, b, e = 1e-3) => Math.abs(a - b) < e;

console.log('Velocidad e impulsos');
{
  const g = new Game({ seed: 1 });
  ok(g.v === V_START && g.vTarget === 2, 'empieza a 2,0 u/fotograma');
  g.initBoost(); ok(near(g.v, 3.65) && g.level === 1, 'impulso 1: salta a 3,65 al instante');
  g.initBoost(); ok(near(g.v, 4.7555) && g.level === 2, 'impulso 2: 4,7555');
  g.initBoost(); ok(g.v === V_MAX && g.level === 3, 'impulso 3: 5,5 (tope)');
  g.initBoost(); ok(g.v === V_MAX && g.level === 3, 'no pasa de 3 impulsos ni de 5,5');
  const box = { id: 1, hit: false };
  g.crash(box);
  ok(g.alive && g.level === 0 && g.vTarget === 2 && g.v === 1, 'choque con impulso: pierde TODOS, v = 1 y objetivo 2');
  ok(near(g.invul, 1.5), 'invulnerable 1,5 s');
  g.step({ steer: 0 }); ok(near(g.v, 1.025), 'acelera a 0,025 por fotograma hacia el objetivo');
  const g2 = new Game({ seed: 1 }); g2.v = 3; g2.step({ steer: 0 }); ok(near(g2.v, 2.9), 'frena a 0,1 por fotograma');
  const g3 = new Game({ seed: 1 }); g3.crash({ id: 2, hit: false }); ok(!g3.alive, 'choque sin impulso: fin de partida');
}

console.log('Giro');
{
  const g = new Game({ seed: 1 });
  g.step({ steer: 0.018 }); ok(g.theta === 0, 'zona muerta de 0,019');
  g.step({ steer: 0.5 }); ok(near(g.theta, 0.1, 1e-6), 'ganancia 0,2 rad por fotograma y unidad');
  ok(near(stripHalfWidth(30) * 180 / Math.PI, 22.5) && near(stripHalfWidth(-30) * 180 / Math.PI, 15), 'semiancho de carril: 22,5° en tubo y 15° por fuera');
}

console.log('Guion de oleadas del clásico');
{
  const W = buildWaves('classic', makeRng(1));
  ok(W.length === 43, '43 oleadas (' + W.length + ')');
  ok(W[W.length - 1].n === -1, 'la última es infinita');
  ok(W.filter((w) => w.fold).length === 6, '6 oleadas con plegado');
  ok(W[22].a === 1 && W[22].b === 0, 'oleada 22: una caja rodante por fila');
}

console.log('Determinismo y monedas');
{
  const run = (seed) => { const g = new Game({ seed }); const log = []; while (g.alive && g.frame < 60 * 90) { g.step({ steer: botSteer(g) }); } for (const b of g.boxes) log.push(b.k + ':' + b.lane); return { s: g.s, f: g.frame, log: log.join(','), coins: g.coinsGot }; };
  const a = run(77), b = run(77);
  ok(a.s === b.s && a.log === b.log, 'misma semilla = misma partida');
  // las monedas van con su propio generador: quitarlas no cambia la secuencia de cajas
  const g1 = new Game({ seed: 9 }), g2 = new Game({ seed: 9 });
  g2.spawnCoins = () => {};
  const seq = (g) => { const o = []; for (let i = 0; i < 3000; i++) { const ev = g.step({ steer: 0 }); if (!g.alive) g.alive = true, g.invul = 99; for (const e of ev) if (e.type === 'spawn') o.push(g.boxes[g.boxes.length - 1].lane); } return o.join(','); };
  ok(seq(g1) === seq(g2), 'las monedas no alteran las cajas del original');
}

console.log('Placas');
{
  const g = new Game({ seed: 4 });
  let pads = 0, max3 = true;
  while (g.frame < 60 * 60) { const ev = g.step({ steer: botSteer(g) }); if (!g.alive) break; for (const e of ev) if (e.type === 'boost') pads++; if (g.level === 3 && g.pads.some((p) => p.k > g.kLast - 7 && !p.taken && p.bornLevel3)) max3 = false; }
  ok(pads > 0, 'se cogen placas (' + pads + ' en un minuto)');
}

console.log('Arcade (capa encima del clásico)');
{
  const { Arcade } = await import('../app/src/sim/arcade.js');
  const g = new Arcade({ seed: 5 });
  ok(g.level === 1 && g.mode === 'classic', 'empieza con un impulso y con las reglas del clásico');
  const c = new Game({ seed: 5 });
  ok(c.waves[3].n === 50 && g.waves[3].n === 20, 'comprime el guion (50 → 20 cajas) sin tocar el del clásico');
  let t = 0; for (let n = 0; n < 10; n++) { const q = new Arcade({ seed: 300 + n }); while (q.alive && q.time < 60) q.step({ steer: 0 }); t += q.time; }
  ok(t / 10 < 12, `quieto en un carril no aguantas (mueres a los ${(t / 10).toFixed(1)} s de media)`);
}

console.log('Cámara (fluidez del giro)');
{
  // Deslizándote a ritmo constante, la vista debe girar y avanzar a ritmo constante. Si la cámara
  // siguiera las caras planas del dodecágono, giraría a golpes en las juntas ("saltitos de carril").
  const { section, surfSmooth } = await import('../app/src/render/track.js');
  for (const [fold, closed] of [[30, true], [-22, false], [10, false]]) {
    const sec = section(fold), o = {}; let pa = null; const r = [];
    for (let u = 1; u < 10; u += 0.02) { surfSmooth(sec, u, closed, o); const a = Math.atan2(o.ny, o.nx); if (pa !== null) r.push(Math.abs(Math.atan2(Math.sin(a - pa), Math.cos(a - pa)))); pa = a; }
    const mx = Math.max(...r), mn = Math.min(...r);
    ok(mx - mn < 1e-6 + mx * 0.02, `pliegue ${fold}: giro de la cámara uniforme (${(mn * 180 / Math.PI).toFixed(3)}°–${(mx * 180 / Math.PI).toFixed(3)}° por paso)`);
  }
}

console.log(fails ? `\n${fails} comprobaciones fallan` : '\nTodo OK');
process.exit(fails ? 1 : 0);
