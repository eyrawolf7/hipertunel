// Graba un vídeo resumen del juego real (30 fps) con el bot invulnerable.
// Uso: node tests/video.mjs [semilla] → tests/shots/video/resumen.mp4
import puppeteer from 'puppeteer';
import { mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Game } from '../app/src/sim/game.js';
import { botSteer } from '../app/src/sim/bot.js';
const seed = +(process.argv[2] || 5);
const W = 1280, H = 720;
// localizar momentos con la simulación pura
const g = new Game({ seed }); g.crash = (b) => { g.invul = 1; b.hit = true; };
const marks = {}; 
while (g.frame < 60 * 60 * 5) {
  const ev = g.step({ steer: botSteer(g) });
  for (const e of ev) {
    if (e.type === 'boost' && !marks.boost) marks.boost = g.frame;
    if (e.type === 'foldStart' && !marks.fold) marks.fold = g.frame;
    if (e.type === 'foldEnd' && e.toIn && !marks.foldIn) marks.foldIn = g.frame;
  }
  if (marks.foldIn) break;
}
const segs = [[1, 240], [marks.boost - 60, marks.boost + 120], [marks.fold + 60, marks.fold + 600], [marks.foldIn - 30, marks.foldIn + 330]];
console.log('momentos', marks, 'tramos', segs);
const dir = new URL('./shots/video/', import.meta.url).pathname; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__hip && window.__hip.game);
await p.evaluate(() => localStorage.setItem('hipertunel-partidas', '9'));
await p.evaluate((seed) => { const h = window.__hip; h.start('classic', seed); window.__freeze = true; const g = h.game; g.crash = (b) => { g.invul = 1; b.hit = true; }; }, seed);
let n = 0;
for (const [a, z] of segs) {
  await p.evaluate((a) => { const h = window.__hip, g = h.game; while (g.frame < a) g.step({ steer: h.bot(g) }); h.renderer.track.sync(g); h.renderer.firstFrame = true; }, a);
  for (let f = a; f < z; f += 2) {
    await p.evaluate(() => { const h = window.__hip; h.step(2, h.bot(h.game)); });
    await p.screenshot({ path: `${dir}${String(n++).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 85 });
  }
}
await b.close();
execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${dir}%05d.jpg -c:v libx264 -pix_fmt yuv420p -crf 20 ${dir}resumen.mp4`);
execSync(`rm ${dir}*.jpg`);
console.log(dir + 'resumen.mp4', n, 'fotogramas');
