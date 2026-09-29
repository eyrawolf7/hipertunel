import puppeteer from 'puppeteer';
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 });
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__hip && window.__hip.game);
await p.evaluate(async () => {
  const h = window.__hip; h.start('classic', 3); window.__freeze = true;
  for (let n = 0; n < 4000; n++) { h.step(1); if (h.padDirection() && h.game.pads.some((q) => !q.taken && q.k - h.game.s > 3 && q.k - h.game.s < 9)) break; }
});
await new Promise((r) => setTimeout(r, 500));
await p.screenshot({ path: '/private/tmp/arrow.png' });
await b.close();
