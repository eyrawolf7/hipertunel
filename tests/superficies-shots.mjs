// Capturas de las superficies del Arcade (sin ?fps): cada superficie forzada con el tema de su mundo,
// más la piedra de referencia, y una de transición con dos superficies a la vista.
//   node tests/superficies-shots.mjs [carpeta] [--w=844 --h=390]
// Deja PNG en tests/shots/<carpeta>/ (por defecto "superficies").
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const dir = args.find((a) => !a.startsWith('--')) || 'superficies';
const W = +(opt.w || 844), H = +(opt.h || 390);
const url = process.env.HIP_URL || 'http://localhost:5173/';
const out = new URL(`./shots/${dir}/`, import.meta.url).pathname;
mkdirSync(out, { recursive: true });

// [nombre, superficie, tema del mundo]
const CASES = [['piedra', 0, 0], ['cristal', 1, 0], ['musgo', 2, 0], ['lava', 3, 0], ['hielo', 4, 0], ['cristal-noche', 1, 2], ['musgo-selva', 2, 1], ['lava-fuego', 3, 4]];
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 });
for (const [name, id, theme] of CASES) {
  await page.evaluate((id, theme) => {
    const h = window.__hip;
    h.start('arcade', 3); window.__freeze = true;
    h.game.forceSurface = id;
    h.skipTo(60); h.step(20);
    h.renderer.themeIdx = theme; h.renderer.pendingTheme = 0; h.renderer.applyTheme(theme, theme, 1);
  }, id, theme);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  await page.screenshot({ path: `${out}${name}.png` });
}
// transición: moss a partir de la fila 60 + 40 (se ve piedra delante y musgo detrás)
await page.evaluate(() => {
  const h = window.__hip;
  h.start('arcade', 3); window.__freeze = true;
  h.skipTo(40); h.step(5);
  const g = h.game, k0 = Math.floor(g.s) + 14;
  g.surfaceAt = (k) => (k >= k0 ? 2 : 0);
  h.renderer.themeIdx = 1; h.renderer.pendingTheme = 0; h.renderer.applyTheme(1, 1, 1);
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
await page.screenshot({ path: `${out}transicion-musgo.png` });
console.log('errores:', errors.length ? errors : 'ninguno', '· capturas en', out);
await browser.close();
