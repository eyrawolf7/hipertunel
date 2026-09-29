// Juega de verdad en un móvil apaisado (toques reales) y hace capturas en momentos fijos.
// Uso: node tests/flujo.mjs [ms...]   → tests/shots/flujo/<ms>.png y hoja.jpg
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const times = (process.argv.slice(2).length ? process.argv.slice(2) : ['300', '900', '1700', '2600', '5000']).map(Number);
const dir = new URL('./shots/flujo/', import.meta.url).pathname; mkdirSync(dir, { recursive: true });
const b = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal'] });
const p = await b.newPage(); await p.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto((process.env.HIP_URL || 'http://localhost:5173/'), { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 1200));
await p.evaluate(() => localStorage.removeItem('hipertunel-partidas'));
const btn = await p.evaluateHandle(() => [...document.querySelectorAll('button')].find((x) => /Jugar/.test(x.textContent)));
await btn.click();
const t0 = Date.now(); const files = [];
for (const t of times) { const w = t - (Date.now() - t0); if (w > 0) await new Promise((r) => setTimeout(r, w)); const f = `${dir}${t}.png`; await p.screenshot({ path: f }); files.push(f); }
await b.close();
execSync(`ffmpeg -y -loglevel error ${files.map((f) => '-i ' + f).join(' ')} -filter_complex "${files.map((_, i) => `[${i}]scale=560:-1[v${i}]`).join(';')};${files.map((_, i) => `[v${i}]`).join('')}hstack=${files.length}" ${dir}hoja.jpg`);
console.log(dir + 'hoja.jpg');
