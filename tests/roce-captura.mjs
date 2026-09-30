// Captura de la chispa de roce a 844×390. Uso: node tests/roce-captura.mjs <carpeta> [semilla]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] || 'tests/shots/roce'; mkdirSync(out, { recursive: true });
const seed = +(process.argv[3] || 7);
const url = process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(url, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 }); await sleep(800);
await page.evaluate((seed, side) => {
  window.__hip.start('arcade', seed); window.__freeze = true;
  const h = window.__hip, g = h.game, hw = Math.PI / 6;
  for (let i = 0; i < 60 * 40 && g.alive && !g.boxes.some((b) => !b.wall && b.k - g.s > 8 && b.k - g.s < 30); i++) h.step(1);
  const b = g.boxes.find((x) => !x.wall && x.k - g.s > 8 && x.k - g.s < 30);
  g.invul = 30; g.v = g.vTarget = 4.76; g.theta = (b.lane + side) * hw;
  window.__hit = false;
  const step0 = g.step.bind(g);
  g.step = (inp) => { const ev = step0(inp); if (ev.some((e) => e.type === 'graze')) window.__hit = true; return ev; };
  window.__freeze = false;
}, seed, process.argv[4] === 'otro' ? -1 : 1);
await page.waitForFunction(() => document.querySelector('.roce-chispa'), { timeout: 8000 });
// tres fotogramas seguidos de la chispa (la animación dura 0,34 s)
for (let i = 0; i < 3; i++) {
  await page.screenshot({ path: `${out}/roce-844x390-${i + 1}.png` });
  await sleep(20);
}
await page.screenshot({ path: `${out}/roce-844x390.png` });
console.log('captura en ' + out);
await browser.close();
