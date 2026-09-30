// Materiales transparentes a doble cara sin forceSinglePass: three.js los dibuja DOS veces por fotograma y
// marca needsUpdate dos veces (recalcula el programa: getParameters + clave de caché = basura y tiempo de CPU).
// Uso: HIP_URL=... node tests/doble-pasada.mjs
import puppeteer from 'puppeteer';
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=media', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));
const out = await page.evaluate(() => new Promise((res) => {
  const h = window.__hip, r = h.renderer; h.start('arcade', 7);
  setTimeout(() => {
    const L = [];
    r.scene.traverse((o) => { if (!o.material) return; let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
      for (const m of [].concat(o.material)) if (m.transparent && m.side === 2 && !m.forceSinglePass) L.push({ obj: (o.isInstancedMesh ? 'Instanced(' + o.count + ') ' : '') + (o.name || o.parent?.name || o.type), mat: m.name || m.type, visible: vis }); });
    const P = window.__hip.renderer; res({ total: L.length, visibles: L.filter((x) => x.visible).length, list: L.filter((x) => x.visible) });
  }, 3000);
}));
console.log(JSON.stringify(out));
await browser.close();
