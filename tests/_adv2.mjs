import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__hip && window.__hip.game);
const stage = +(process.argv[2] || 0), rows = (process.argv[3] || '').split(',').map(Number);
await p.evaluate((st) => { window.__hip.ui.show('modes'); document.querySelector('.card-adventure').click(); localStorage.setItem('hipertunel-aventura', JSON.stringify(Object.fromEntries([...Array(10)].map((_, i) => [i, { stars: 1, best: 1 }])))); window.__hip.ui.map && 0; }, stage);
await p.evaluate((st) => { document.querySelector(`[data-stage="${st}"]`).classList.remove('locked'); document.querySelector(`[data-stage="${st}"]`).click(); }, stage);
await new Promise((r) => setTimeout(r, 300));
const info = await p.evaluate(() => { const g = window.__hip.game; return { gaps: g.gaps.map((x) => [x.from, x.to]), zones: g.zones.map((z) => [z.from, z.to]) }; });
console.log(JSON.stringify(info));
await p.evaluate(() => { window.__freeze = true; });
for (const r of rows) {
  await p.evaluate(async (r) => { const h = window.__hip; while (h.game.s < r && h.game.alive) { h.step(1, 0); if (!h.game.alive) { h.game.alive = true; } } await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))); }, r);
  await new Promise((res) => setTimeout(res, 250));
  await p.screenshot({ path: `/private/tmp/adv-s${stage}-${r}.png` });
}
console.log('errores', errs);
await b.close();
