// Juega partidas enteras con un bot sobre la simulación pura (sin navegador) y resume qué pasa:
// oleadas alcanzadas, densidad, placas, choques, plegados. Uso:
//   node tests/sim-bot.mjs [modo] [partidas] [skill]
import { Game } from '../app/src/sim/game.js';
import { Arcade } from '../app/src/sim/arcade.js';
import { botSteer } from '../app/src/sim/bot.js';

const mode = process.argv[2] || 'classic';
const N = +(process.argv[3] || 20);
const SKILL = +(process.argv[4] || 1);        // 1 = bueno; <1 reacciona más tarde

if (import.meta.url === `file://${process.argv[1]}`) {
  const res = [];
  for (let i = 0; i < N; i++) {
    const g = mode === 'arcade' ? new Arcade({ seed: 1000 + i }) : new Game({ mode, seed: 1000 + i });
    let boosts = 0, crashes = 0, folds = 0, maxLevel = 0, spawns = 0;
    const maxFrames = 60 * 60 * 8;
    while (g.alive && g.frame < maxFrames) {
      const ev = g.step({ steer: botSteer(g, 14 * SKILL) });
      for (const e of ev) {
        if (e.type === 'boost') boosts++;
        if (e.type === 'crash') crashes++;
        if (e.type === 'foldStart') folds++;
        if (e.type === 'spawn') spawns++;
      }
      maxLevel = Math.max(maxLevel, g.level);
    }
    res.push({ seed: 1000 + i, t: +g.time.toFixed(1), dist: g.distanceM, wave: g.waveIdx, boosts, crashes, folds, spawns, maxLevel, world: g.world, alive: g.alive });
  }
  console.table(res);
  const avg = (k) => (res.reduce((a, r) => a + r[k], 0) / res.length).toFixed(1);
  console.log(`modo ${mode}: tiempo medio ${avg('t')} s · distancia ${avg('dist')} m · oleada ${avg('wave')} · placas ${avg('boosts')} · choques ${avg('crashes')}`);
}
