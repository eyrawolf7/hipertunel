// Comprobaciones del reto de los mundos 3-4 del Arcade (world >= 4). Uso: node tests/reto-expertos.mjs
import { Arcade } from '../app/src/sim/arcade.js';
import { Game } from '../app/src/sim/game.js';
import { botSteer } from '../app/src/sim/bot.js';

let fails = 0;
const ok = (name, cond, info = '') => { console.log(`${cond ? 'PASA ' : 'FALLA'} ${name} ${info}`); if (!cond) fails++; };

// 1) constantes vivas: fuera de mundos duros nunca se toca b/c/a; en duros se aplican los factores
let leaks = 0, hardSeen = 0, easySeen = 0, bad = 0;
// 2) ventana de aterrizaje: sin cajas dentro, y gap al salir; ¿se corta una colección en marcha?
let windows = 0, collCut = 0, gapZero = 0, boxesInWindow = 0, gapVals = new Set();
for (let seed = 1; seed <= 40; seed++) {
  const g = new Arcade({ seed });
  g.crash = (b) => { b.hit = true; };            // inmortal: alcanza los mundos altos
  const spawn = g.spawnNewBoxes.bind(g);
  g.spawnNewBoxes = (row) => {
    const gapBefore = g.gap, collBefore = !!g.coll;
    const inWin = g.gaps.some((q) => row.k > q.to && row.k <= q.to + 1 + Math.ceil(Math.max(g.v, g.vTarget) * 60 / 13.176254 * 0.75));
    const n0 = g.boxes.length;
    spawn(row);
    const w = g.wave, hard = g.world >= 4;
    if (inWin) {
      windows++; gapVals.add(g.gap);
      if (g.boxes.length > n0) boxesInWindow++;
      if (hard && collBefore) collCut++;
      if (hard && gapBefore === 0) gapZero++;
    } else if (g.gap === 0 || true) {
      if (hard) { hardSeen++; if (Math.abs(w.b - w.b0 * 0.3) > 1e-12 && !g.wallLead) bad++; }
      else { easySeen++; if (w.b !== w.b0 || w.c !== w.c0 || (w.interval < 0 && w.a !== w.a1)) leaks++; }
    }
  };
  for (let i = 0; i < 60 * 330 && g.alive; i++) g.step({ steer: botSteer(g) });
}
ok('mundos < 4 no mutan b/c/a', leaks === 0 && easySeen > 0, `(filas=${easySeen}, fugas=${leaks})`);
ok('mundos >= 4 aplican b*0.3', bad === 0 && hardSeen > 0, `(filas=${hardSeen}, malas=${bad})`);
ok('ventana de 1 s sin cajas', boxesInWindow === 0, `(filas ventana=${windows}, con caja=${boxesInWindow})`);
ok('aterrizaje duro no corta colecciones en marcha', collCut === 0, `(cortes=${collCut})`);
ok('aterrizaje duro no suma respiro si gap ya era 0', gapZero === 0, `(casos=${gapZero}, gap final en ventana=${[...gapVals]})`);

// 3) Clásico y Aventura no usan nada de esto
const c = new Game({ mode: 'classic', seed: 3 });
ok('Clasico sin campos a0/a1/b0/c0', c.waves.every((w) => w.b0 === undefined && w.a1 === undefined));

console.log(fails ? `${fails} FALLA` : 'todo PASA');
process.exit(fails ? 1 : 0);
