// Carga el juego y muestra los errores de consola y de página. Uso: node tests/errores.mjs [url]
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://localhost:5173/';
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 960, height: 540 });
const errs = [];
p.on('pageerror', (e) => errs.push('pageerror: ' + (e.stack || e.message || e)));
p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text()); });
await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
const ok = await p.evaluate(() => !!(window.__hip && window.__hip.game));
console.log(ok ? 'arranca' : 'NO arranca'); console.log(errs.join('\n') || 'sin errores');
await b.close();
