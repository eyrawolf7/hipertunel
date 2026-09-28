// Mide fps en la demo del título (bot jugando en tiempo real). Uso: node tests/rendimiento.mjs [q] [w] [h] [dpr]
import puppeteer from 'puppeteer';
const [q = 'alta', w = 844, h = 390, dpr = 2] = process.argv.slice(2);
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h, deviceScaleFactor: +dpr });
await p.goto('http://localhost:5173/?q=' + q, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1500));
const r = await p.evaluate(() => new Promise((res) => { const t = []; let last = performance.now(); const f = (n) => { t.push(n - last); last = n; if (t.length < 600) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ avg: 1000 / (t.reduce((a, b) => a + b) / t.length), p99: 1000 / t[Math.floor(t.length * 0.99)] }); } }; requestAnimationFrame(f); }));
const info = await p.evaluate(() => { const i = window.__hip.renderer.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length }; });
console.log(q, w + 'x' + h, 'dpr', dpr, '→', r.avg.toFixed(1), 'fps de media ·', r.p99.toFixed(1), 'en el 1% peor ·', JSON.stringify(info));
await b.close();
