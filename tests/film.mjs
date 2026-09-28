// Rueda una secuencia del juego real y la monta en una hoja de contactos (ffmpeg).
// Uso: node tests/film.mjs <nombre> --event=crash|foldStart|boost|tall|roller|row:N [--n=16] [--every=6]
//      [--seed=3] [--mode=classic] [--skill=1] [--w=960 --h=540] [--before=40]
// Busca el primer suceso con la simulación (sin navegador), vuelve a jugar la misma partida en el
// navegador y fotografía los pasos de alrededor.
import puppeteer from 'puppeteer';
import { mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { Game } from '../app/src/sim/game.js';
import { botSteer } from '../app/src/sim/bot.js';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const name = args.find((a) => !a.startsWith('--')) || 'film';
const seed = +(opt.seed || 3), mode = opt.mode || 'classic', skill = +(opt.skill || 1);
const N = +(opt.n || 16), every = +(opt.every || 6), before = +(opt.before || 40);
const W = +(opt.w || 960), H = +(opt.h || 540);
const ev = opt.event || 'crash';

// 1) localizar el suceso
const g = new Game({ mode, seed });
if (opt.invul) { const c = g.crash.bind(g); g.crash = (b) => { g.invul = 1; b.hit = true; }; }
let at = -1;
while (g.alive && g.frame < 60 * 60 * 6) {
  const out = g.step({ steer: botSteer(g, 14 * skill) });
  const hit = ev.startsWith('row:') ? g.s >= +ev.slice(4)
    : ev === 'tall' ? g.boxes.some((b) => b.tall && b.k - g.s < 6 && b.k - g.s > 3)
    : ev === 'roller' ? g.boxes.some((b) => !b.fixed && b.roll !== 0 && b.k - g.s < 8 && b.k - g.s > 2)
    : ev === 'foldIn' ? out.some((e) => e.type === 'foldEnd' && e.toIn)
    : out.some((e) => e.type === ev);
  if (hit) { at = g.frame; break; }
}
if (at < 0) { console.log('No se encontró el suceso', ev); process.exit(1); }
const start = Math.max(1, at - before);
console.log(`suceso ${ev} en el fotograma ${at} (s=${g.s.toFixed(1)}); se rueda desde ${start}`);

// 2) rodar en el navegador
const dir = new URL(`./shots/film-${name}/`, import.meta.url).pathname;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(opt.url || 'http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game);
await page.evaluate((m, seed, skill, start, invul) => {
  const h = window.__hip; h.start(m, seed);
  window.__freeze = true;
  const g = h.game;
  if (invul) g.crash = (b) => { g.invul = 1; b.hit = true; };
  while (g.frame < start - 1) { g.step({ steer: h.bot(g, 14 * skill) }); }
  h.renderer.track.sync(g);
}, mode, seed, skill, start, !!opt.invul);
for (let i = 0; i < N; i++) {
  await page.evaluate((every, skill) => { const h = window.__hip; for (let j = 0; j < every; j++) h.step(1, h.bot(h.game, 14 * skill)); }, every, skill);
  await new Promise((r) => setTimeout(r, 60));
  await page.screenshot({ path: `${dir}${String(i).padStart(3, '0')}.png` });
}
await browser.close();
const cols = 4, rowsN = Math.ceil(N / cols);
execSync(`ffmpeg -y -loglevel error -framerate 10 -i ${dir}%03d.png -vf "scale=480:-1,tile=${cols}x${rowsN}" -frames:v 1 ${dir}hoja.jpg`);
console.log('hoja:', dir + 'hoja.jpg', errors.length ? errors : '');
