// Aventura sin navegador: cada tramo con bot, cuántas veces se supera, caídas, estrellas y que el
// fantasma (giros guardados) repite la partida exactamente. Uso: node tests/aventura.mjs [intentos]
import { Adventure, STAGES, packGhost, unpackGhost, quantSteer } from '../app/src/sim/adventure.js';
import { botSteer } from '../app/src/sim/bot.js';
const N = +(process.argv[2] || 6);
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };
// jugadores de tres niveles: reaccionan con retraso (ven la partida de hace unos fotogramas)
function play(stage, look, noise, rec, delay = 0) {
  const g = new Adventure({ stage });
  const steers = [];
  const hist = [];
  while (g.alive && g.frame < 60 * 60 * 5) {
    let a = botSteer(g, look) + (Math.sin(g.frame * 0.05 + noise) * 0.08);
    hist.push(a); if (delay) a = hist.length > delay ? hist[hist.length - 1 - delay] : 0;
    a = quantSteer(a); steers.push(a);
    g.step({ steer: a });
  }
  return { g, steers };
}
const LEVELS = [['novato', 7, 14], ['medio', 9, 7], ['bueno', 12, 2]];
console.log('Tramos (superado: novato / medio / bueno · estrellas del medio)');
const curve = [];
for (let i = 0; i < STAGES.length; i++) {
  const row = [];
  let stars = 0, secs = 0;
  for (const [, look, delay] of LEVELS) {
    let clr = 0;
    for (let n = 0; n < N; n++) { const { g } = play(i, look, n * 1.7, false, delay); if (g.cleared) clr++; if (delay === 7) { stars += g.stars; secs += g.time; } }
    row.push(Math.round(100 * clr / N));
  }
  curve.push(row[1]);
  console.log(`  ${String(i + 1).padStart(2)} ${STAGES[i].name.padEnd(20)} ${row.map((x) => String(x).padStart(3) + ' %').join(' / ')} · ★ ${(stars / N).toFixed(1)} · ${(secs / N).toFixed(0)} s`);
}
console.log('Fantasma');
{
  const { g, steers } = play(2, 11, 1);
  const ghost = unpackGhost(packGhost(steers));
  const h = new Adventure({ stage: 2 });
  for (let i = 0; i < ghost.length && h.alive; i++) h.step({ steer: ghost[i] });
  ok(h.s === g.s && h.theta === g.theta && h.coinsGot === g.coinsGot && h.cleared === g.cleared, `el fantasma repite la partida (s ${g.s.toFixed(2)} / ${h.s.toFixed(2)}, ${packGhost(steers).length} bytes)`);
}
console.log('Mismo tramo, mismo recorrido');
{
  const a = new Adventure({ stage: 4 }), b = new Adventure({ stage: 4 });
  ok(JSON.stringify(a.gaps) === JSON.stringify(b.gaps) && JSON.stringify(a.zones.map((z) => [z.from, z.to])) === JSON.stringify(b.zones.map((z) => [z.from, z.to])), 'roturas y zonas idénticas en cada intento');
}
console.log(fails ? `\n${fails} fallan` : '\nTodo OK');
process.exit(fails ? 1 : 0);
