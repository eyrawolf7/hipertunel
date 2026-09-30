// Prueba perf-losas: errores de sombreador, superficies visibles y fps por superficie.
// Uso: node tests/perf-losas.mjs [url]
import puppeteer from 'puppeteer';
const URL0 = process.argv[2] || 'http://localhost:5291/';
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 });
const errs = [];
p.on('pageerror', (e) => errs.push(String(e)));
p.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && /shader|GLSL|WebGL|THREE/i.test(m.text())) errs.push(m.text().slice(0, 300)); });
await p.goto(URL0, { waitUntil: 'networkidle0' });
await p.waitForFunction(() => window.__hip && window.__hip.game);
const fps = (s) => p.evaluate((s) => new Promise((r) => {
  const d = []; let l = performance.now(); const e = l + s * 1000;
  (function f(t) { d.push(t - l); l = t; if (t < e) requestAnimationFrame(f); else { d.shift(); d.sort((a, b) => a - b); r({ fps: +(1000 / (d.reduce((a, b) => a + b) / d.length)).toFixed(1), p99ms: +d[Math.floor(d.length * 0.99)].toFixed(1) }); } })(l);
}), s);
for (const [mode, fs] of [['arcade', -1], ['arcade', 0], ['arcade', 1], ['arcade', 2], ['arcade', 3], ['arcade', 4], ['classic', -1]]) {
  await p.evaluate((m) => window.__hip.start(m, 5), mode);
  await p.evaluate((fs) => { if (fs >= 0) window.__hip.game.forceSurface = fs; }, fs);
  await new Promise((r) => setTimeout(r, 2500));
  const f = await fps(5);
  await p.screenshot({ path: new URL(`./shots/losas-${mode}-${fs}.png`, import.meta.url).pathname });
  console.log(mode, 'force', fs, JSON.stringify(f));
}
console.log('errores:', errs.length, errs);
await b.close();
