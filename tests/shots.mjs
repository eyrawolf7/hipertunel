// Capturas deterministas del juego real en Chrome sin cabeza: misma semilla, misma fila, mismo
// encuadre. Uso:
//   node tests/shots.mjs [carpeta] [filas...] [--mode=classic] [--seed=3] [--w=1280 --h=720] [--url=...]
// Ejemplo: node tests/shots.mjs antes 20 200 600 1200
// Deja PNG en tests/shots/<carpeta>/ y un resumen con fps, errores y estado.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const pos = args.filter((a) => !a.startsWith('--'));
const dir = pos[0] || 'ultima';
const rows = (pos.slice(1).length ? pos.slice(1) : ['20', '150', '400', '800']).map(Number);
const W = +(opt.w || 1280), H = +(opt.h || 720);
const url = opt.url || 'http://localhost:5173/';
const out = new URL(`./shots/${dir}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url + (url.includes('?') ? '&' : '?') + 'fps', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 });
const report = [];
if (opt.title) { await new Promise((r) => setTimeout(r, 1500)); await page.screenshot({ path: out + 'titulo.png' }); }
await page.evaluate((m, seed) => window.__hip.start(m, seed), opt.mode || 'classic', +(opt.seed || 3));
for (const r of rows) {
  const st = await page.evaluate(async (r) => {
    const h = window.__hip;
    h.skipTo(r);
    h.step(20);
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const g = h.game;
    return { s: +g.s.toFixed(1), wave: g.waveIdx, fold: +g.fold.toFixed(1), world: g.world, level: g.level, alive: g.alive, boxes: g.boxes.length, pads: g.pads.length, v: +g.v.toFixed(2) };
  }, r);
  await new Promise((res) => setTimeout(res, 120));
  const f = `${out}fila-${String(r).padStart(5, '0')}.png`;
  await page.screenshot({ path: f });
  report.push({ fila: r, ...st });
}
const fpsTxt = await page.evaluate(() => document.querySelector('.fps')?.textContent || '');
writeFileSync(out + 'informe.json', JSON.stringify({ report, errors, fps: fpsTxt }, null, 2));
console.table(report);
console.log('fps:', fpsTxt, '· errores:', errors.length ? errors : 'ninguno');
await browser.close();
