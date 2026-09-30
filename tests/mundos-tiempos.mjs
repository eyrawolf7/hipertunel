// Cuándo entra cada mundo en Arcade y cuánto dura la partida (bot-pro). Uso: node tests/mundos-tiempos.mjs [nivel] [N]
import { createBot, makeGame } from './bot-pro.mjs';

const nivel = process.argv[2] || 'experto', N = +process.argv[3] || 10;
for (let i = 0; i < N; i++) {
  const seed = 1000 + i, g = makeGame('arcade', seed), bot = createBot(nivel, seed);
  const mundos = [], plegados = [];
  let rodantes = 0, fijas = 0;
  const vistas = new Set();
  while (g.alive && g.frame < 600 * 60) {
    for (const e of g.step(bot(g))) {
      if (e.type === 'world') mundos.push(`${e.world}@${g.time.toFixed(0)}`);
      if (e.type === 'foldStart') plegados.push(g.time.toFixed(0));
    }
    for (const b of g.boxes) if (!vistas.has(b.id)) { vistas.add(b.id); if (g.world >= 4) { if (b.fixed) fijas++; else rodantes++; } }
  }
  console.log(`${seed} muere ${g.time.toFixed(0)} s · mundos ${mundos.join(' ')} · plegados ${plegados.length} (${plegados.join(',')}) · mundo≥4: rodantes ${rodantes} fijas ${fijas}`);
}
