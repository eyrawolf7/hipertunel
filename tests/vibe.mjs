// Vibración de la superficie (app/src/input/vibe.js).
//   node tests/vibe.mjs            parte pura (reloj simulado) + parte de navegador (HIP_URL)
//   node tests/vibe.mjs --pura     solo la parte pura
// Pura: ritmo por superficie, pulso de cambio de 20 ms, nunca menos de 50 ms de silencio, nada con
// on = false y el motor cede el hueco. Navegador: ningún pulso en el título (demo), pulsos en partida,
// ninguno en pausa ni tras la muerte ni con el ajuste de vibración apagado.
import { createVibe, PATTERNS, MIN_GAP, CHANGE_MS } from '../app/src/input/vibe.js';

let fails = 0;
const ok = (c, msg) => { console.log((c ? '  ✓ ' : '  ✗ ') + msg); if (!c) fails++; };
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// 1 s = 1000 ms de reloj a 60 fps; devuelve el registro
function run(surface, secs, { engine = false } = {}) {
  const calls = [];
  const v = createVibe((ms) => calls.push(ms), mulberry(7));
  for (let f = 0; f < secs * 60; f++) {
    const now = f * 1000 / 60;
    v.update(now, { on: true, surface });
    if (engine && f % 12 === 0) v.tryPulse(now, 8);
  }
  return v;
}
const gaps = (log) => log.slice(1).map((p, i) => p.t - log[i].t);

console.log('Ritmo por superficie (parte pura)');
for (let s = 0; s < PATTERNS.length; s++) {
  const p = PATTERNS[s], v = run(s, 30), g = gaps(v.log);
  const lo = Math.min(...g), hi = Math.max(...g);
  // el reloj va a fotogramas de 16,7 ms: se admite un fotograma de más
  ok(v.log.length > 10 && v.log.every((x) => x.ms === p.ms), `${p.name}: ${v.log.length} pulsos de ${p.ms} ms`);
  const mean = g.reduce((x, y) => x + y, 0) / g.length;
  ok(lo >= p.min - 1000 / 60 && hi <= p.max + 2 * 1000 / 60 && Math.abs(mean - (p.min + p.max) / 2) < 12, `${p.name}: intervalos entre ${lo.toFixed(0)} y ${hi.toFixed(0)} ms, media ${mean.toFixed(0)} (esperado ${p.min}-${p.max})`);
  ok(g.every((x) => x >= MIN_GAP - 1e-9), `${p.name}: nunca menos de ${MIN_GAP} ms entre pulsos`);
  if (p.min !== p.max) ok(new Set(g.map((x) => Math.round(x / 10))).size > 2, `${p.name}: el ritmo varía`);
}

console.log('Cambio de superficie, apagado y motor');
{
  const calls = [];
  const v = createVibe((ms) => calls.push(ms), mulberry(3));
  let t = 0;
  for (let f = 0; f < 60; f++, t += 1000 / 60) v.update(t, { on: true, surface: 0 });
  const before = v.log.length;
  const tChange = t;
  for (let f = 0; f < 6; f++, t += 1000 / 60) v.update(t, { on: true, surface: 2 });
  const changes = v.log.slice(before).filter((x) => x.ms === CHANGE_MS);
  ok(changes.length === 1 && changes[0].t - tChange <= 100, `al cambiar a musgo hay un solo pulso de ${CHANGE_MS} ms, a ${changes.length ? (changes[0].t - tChange).toFixed(0) : '–'} ms del cambio`);
  for (let f = 0; f < 120; f++, t += 1000 / 60) v.update(t, { on: false, surface: 2 });
  const off = v.log.length;
  for (let f = 0; f < 120; f++, t += 1000 / 60) v.update(t, { on: false, surface: 0 });
  ok(v.log.length === off, 'con on = false (menú, demo, pausa, muerte, ajuste apagado) no hay pulsos');
  const n0 = v.log.length;
  v.update(t, { on: true, surface: 3 }); v.update(t + 16.7, { on: true, surface: 3 });
  ok(v.log.length === n0, 'al volver a jugar no hay pulso de cambio en el primer fotograma');
  const e = run(0, 10, { engine: true }), g = gaps(e.log);
  ok(g.every((x) => x >= MIN_GAP - 1e-9), 'con el motor pidiendo hueco sigue sin haber menos de 50 ms entre pulsos');
  const solo = run(0, 10);
  ok(e.log.length >= solo.log.length, `el motor añade pulsos solo donde caben (${e.log.length} frente a ${solo.log.length} sin motor)`);
}

if (!process.argv.includes('--pura')) {
  console.log('Navegador');
  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => { window.__pulses = []; navigator.vibrate = (p) => { window.__pulses.push({ t: performance.now(), p }); return true; }; });
  await page.goto(process.argv.find((a) => a.startsWith('--url='))?.slice(6) || process.env.HIP_URL || 'http://localhost:5173/', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game && window.__vibe, { timeout: 15000 });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const count = () => page.evaluate(() => window.__vibe.log.length);
  await wait(2500);
  ok((await count()) === 0, 'título con la demo de fondo: ningún pulso de superficie');
  await page.evaluate(() => { window.__hip.start('arcade', 5); });
  await wait(3000);
  const play = await count();
  ok(play > 15, `en partida hay pulsos de superficie (${play} en 3 s)`);
  const ms = await page.evaluate(() => window.__vibe.log.map((x) => x.t));
  const minGap = Math.min(...ms.slice(1).map((t, i) => t - ms[i]));
  ok(minGap >= 50, `en el navegador: separación mínima entre arranques ${minGap.toFixed(0)} ms (≥ 50)`);
  await page.evaluate(() => { window.__hip.game.alive = false; });   // muerte: el estado pasa a «dying» y luego al final
  await wait(400);
  const a = await count(); await wait(1200); const b = await count();
  ok(a === b, 'tras la muerte no hay más pulsos de superficie');
  await page.evaluate(() => { window.__hip.start('arcade', 6); });
  await wait(600);
  await page.mouse.click(422, 195);
  await wait(300);
  ok(await page.evaluate(() => window.__hip.state) === 'paused', 'la partida está en pausa');
  const c = await count(); await wait(1200); const d = await count();
  ok(c === d, 'en pausa no hay pulsos de superficie');
  const cl0 = await count();
  await page.evaluate(() => { window.__hip.start('classic', 7); });
  await wait(2500);
  { const cl = (await count()) - cl0; ok(cl > 10, `el Clásico también vibra con las juntas de la piedra (${cl} pulsos en 2,5 s; la simulación no cambia)`); }
  ok(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
}

console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
