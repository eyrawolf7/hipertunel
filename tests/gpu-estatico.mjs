// Coste de GPU de un fotograma fijo: congela el juego en unas filas dadas y cronometra render()+gl.finish().
// Uso: HIP_URL=... node tests/gpu-estatico.mjs [--q=alta] [--pr=2] [--rows=300,900,1500] [--n=150] [--hide=wild,life]
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const Q = opt.q || 'alta', PR = +(opt.pr || 0), N = +(opt.n || 150), ROWS = (opt.rows || '300,900,1500,2100').split(',').map(Number), HIDE = (opt.hide || '').split(',').filter(Boolean);
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: [process.env.HIP_GL === 'swiftshader' ? '--use-angle=swiftshader' : '--use-angle=metal', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=' + Q, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await sleep(1500);
const out = await page.evaluate(async (rows, n, pr, hide) => {
  const h = window.__hip, r = h.renderer, gl = r.renderer.getContext();
  window.__freeze = true;
  if (pr) { r.renderer.setPixelRatio(pr); r.resize(); }
  h.start('arcade', 7);
  const res = [];
  for (const k of rows) {
    h.skipTo(k);
    for (let i = 0; i < 30; i++) { h.step(1); r.update(h.game, h.game.s, h.game.theta, 1 / 60, { ambient: true }); r.render(); }
    for (const x of hide) { if (x === 'wild') r.wild.birds.visible = r.wild.prec.visible = false; if (x === 'life') r.life.mesh.visible = false; if (x === 'bloom' && r.bloom) r.bloom.enabled = false; if (x === 'grade' && r.grade) r.grade.enabled = false; }
    const px1 = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
    const t = [];
    for (let i = 0; i < n; i++) { const t0 = performance.now(); r.render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    res.push({ row: k, world: h.game.world, outside: !!r.outside, med: +t[t.length >> 1].toFixed(2), p90: +t[Math.floor(t.length * 0.9)].toFixed(2), calls: r.renderer.info.render.calls, px: gl.drawingBufferWidth + 'x' + gl.drawingBufferHeight, surf: h.game.surfNow });
  }
  return res;
}, ROWS, N, PR, HIDE);
console.log(JSON.stringify({ url: BASE, q: Q, pr: PR, hide: HIDE.join(',') || '-', res: out }));
await browser.close();
