// Prueba del módulo de audio en Chrome sin cabeza.
// Uso: node app/src/audio/test-audio.mjs
// 1) llama a toda la API en tiempo real y comprueba que no hay errores en consola;
// 2) renderiza con OfflineAudioContext y mide pico y RMS (no mudo, sin saturar).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'); // app/
const PORT = 5199;
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (url === '/__test.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><meta charset="utf-8"><body>test</body>');
  }
  const f = path.join(root, url);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  const type = f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://localhost:${PORT}/__test.html`);

let fail = 0;
const ok = (c, msg) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + msg); if (!c) fail++; };

// ---- 1) API en tiempo real
const names = ['boost', 'crash', 'death', 'foldStart', 'foldEnd', 'world', 'coin', 'menuMove', 'menuOk', 'menuBack', 'countdown', 'go', 'record', 'nearMiss'];
const rt = await page.evaluate(async (names) => {
  const { createAudio } = await import('/src/audio/index.js');
  const a = createAudio({ debug: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  a.setSpeed(18, 0); a.play('coin'); // antes de unlock: no debe romper
  a.unlock();
  a.setMusic(true);
  for (let w = 0; w <= 6; w++) {
    a.setWorld(w);
    for (let i = 0; i < 20; i++) { a.setSpeed(18 + i * 4, w % 4); await wait(16); }
  }
  for (const n of names) { a.play(n, { level: 3, combo: 12 }); await wait(30); }
  for (let l = 1; l <= 3; l++) a.play('boost', { level: l });
  a.play('nosuchsound');
  a.pause(true); a.play('menuMove'); await wait(100); a.pause(false);
  a.setMuted(true); const m1 = a.muted; a.setMuted(false); const m2 = a.muted;
  a.setMusic(false); await wait(100); a.setMusic(true);
  a.setWorld(99); a.setWorld(-3); a.setSpeed(NaN, 7);
  await wait(400);
  return { state: a._ctx && a._ctx.state, m1, m2, available: a.available };
}, names);
ok(rt.available, 'AudioContext disponible en Chrome');
ok(rt.m1 === true && rt.m2 === false, 'muted refleja setMuted');
ok(errors.length === 0, 'sin errores ni avisos en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));

// ---- 1b) sin AudioContext → no-op
const noop = await page.evaluate(async () => {
  const saveA = window.AudioContext, saveW = window.webkitAudioContext;
  window.AudioContext = undefined; window.webkitAudioContext = undefined;
  const { createAudio } = await import('/src/audio/index.js?noop');
  const a = createAudio();
  a.unlock(); a.setMusic(true); a.setWorld(3); a.setSpeed(50, 2); a.play('boost', { level: 2 }); a.pause(true); a.setMuted(true);
  window.AudioContext = saveA; window.webkitAudioContext = saveW;
  return { available: a.available, muted: a.muted };
});
ok(noop.available === false && noop.muted === true, 'sin AudioContext: no-op sin excepciones');

// ---- 2) renders offline
const renders = await page.evaluate(async (names) => {
  const { createAudio } = await import('/src/audio/index.js');
  const SR = 44100;
  async function render(secs, setup) {
    const ctx = new OfflineAudioContext(2, SR * secs, SR);
    const a = createAudio({ context: ctx });
    a.unlock();
    setup(a);
    const buf = await ctx.startRendering();
    let peak = 0, sum = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += d[i] * d[i]; n++; }
    }
    return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4) };
  }
  const out = {};
  for (let w = 0; w <= 6; w += 2) {
    for (const lvl of [0, 3]) {
      out[`musica mundo ${w} nivel ${lvl}`] = await render(8, (a) => { a.setWorld(w); a.setSpeed(60, lvl); a._scheduleUntil(7.5); });
    }
  }
  out['transicion (mundo 3)'] = await render(4, (a) => { a.setWorld(2); a.setWorld(3); a.setSpeed(80, 2); a._scheduleUntil(3.5); });
  out['turbina sola 100 m/s'] = await render(2, (a) => { a.setMusic(false); a.setSpeed(100, 3); });
  out['turbina sola 18 m/s'] = await render(2, (a) => { a.setMusic(false); a.setSpeed(18, 0); });
  for (const n of names) out['sfx ' + n] = await render(2.5, (a) => { a.setMusic(false); a.play(n, { level: 3, combo: 5 }); });
  out['peor caso: musica n3 + todos los sfx'] = await render(8, (a) => {
    a.setSpeed(100, 3); a._scheduleUntil(7.5);
    names.forEach((n, i) => a.play(n, { level: 3, combo: 7, delay: 0.3 + i * 0.12 }));
    names.forEach((n) => a.play(n, { level: 2, delay: 4 }));
  });
  return out;
}, names);

for (const [k, r] of Object.entries(renders)) {
  const minRms = k.startsWith('sfx') ? 0.002 : 0.005;
  ok(r.peak < 1.0 && r.rms > minRms, `${k.padEnd(40)} pico ${r.peak}  rms ${r.rms}`);
}
ok(errors.length === 0, 'sin errores tras renders' + (errors.length ? ': ' + errors.join(' | ') : ''));

await browser.close();
server.close();
console.log(fail ? `\n${fail} fallos` : '\nTodo OK');
process.exit(fail ? 1 : 0);
