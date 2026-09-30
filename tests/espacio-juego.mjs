// Acústica en la partida real: setSpace(fuera) solo se activa jugando y coincide con renderer.outside.
// Uso: node tests/espacio-juego.mjs [--url=...] [--secs=40]   (por defecto $HIP_URL)
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const SECS = +(opt.secs || 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const rec = (n, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n} — ${JSON.stringify(info)}`); };
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(800);

await page.evaluate(() => {
  const h = window.__hip, orig = h.audio.setSpace.bind(h.audio);
  window.__sp = { calls: 0, outTrue: 0, menuTrue: 0, mismatch: 0, changes: 0, last: null, playOut: 0 };
  h.audio.setSpace = (v) => {
    const s = window.__sp; s.calls++;
    if (v) { s.outTrue++; if (h.state !== 'play' && h.state !== 'dying') s.menuTrue++; if (!h.renderer.outside) s.mismatch++; }
    if (s.last !== v) { s.changes++; s.last = v; s.log = (s.log || []).concat([[h.game.frame, v, +h.game.fold.toFixed(2)]]).slice(-8); }
    return orig(v);
  };
});
// en los menús (demo) nunca debe sonar «fuera»
await sleep(4000);
const menu = await page.evaluate(() => ({ ...window.__sp, state: window.__hip.state }));
rec('en el título/demo no se activa el exterior', menu.calls > 30 && menu.outTrue === 0, menu);

for (const [mode, seed] of [['classic', 3], ['arcade', 5]]) {
  await page.evaluate((mode, seed) => {
    const h = window.__hip; h.start(mode, seed);
    window.__sp = { calls: 0, outTrue: 0, menuTrue: 0, mismatch: 0, changes: 0, last: null };
    h.input.steer = () => h.bot(h.game, 11);
  }, mode, seed);
  await sleep(SECS * 1000);
  const r = await page.evaluate(() => ({ ...window.__sp, st: window.__hip.state, rows: Math.round(window.__hip.game.s) }));
  rec(`${mode} #${seed}: setSpace se llama cada fotograma`, r.calls > SECS * 20, r);
  rec(`${mode} #${seed}: nunca fuera en menú ni con el renderer dentro`, r.menuTrue === 0 && r.mismatch === 0, r);
  rec(`${mode} #${seed}: hay al menos una salida al exterior`, r.outTrue > 0 && r.changes >= 2, r);
}
// pausa y reanudar fuera: no se repite el «whoomp» (ningún cambio de espacio) ni se llama en pausa
const before = await page.evaluate(() => ({ ...window.__sp, out: window.__hip.renderer.outside, state: window.__hip.state }));
await page.keyboard.press('Escape'); await sleep(600);
const paused = await page.evaluate(() => ({ ...window.__sp, state: window.__hip.state, frame: window.__hip.game.frame }));
rec('en pausa se pasa por play antes (estaba jugando fuera) y no cambia el espacio', before.state === 'play' && before.out && paused.state === 'paused' && paused.changes === before.changes && paused.last === true, { before, paused });
await page.keyboard.press('Escape'); await sleep(4500);
const back = await page.evaluate(() => ({ ...window.__sp, state: window.__hip.state }));
// un cambio en el primer medio segundo tras reanudar sería la salida falsa; más tarde puede ser la
// partida de verdad (p. ej. el plegado que se cierra justo antes del salto entre mundos)
const tras = (back.log || []).filter((x) => x[0] > paused.frame);
rec('al reanudar fuera no hay salida falsa (ningún cambio en el primer medio segundo)', back.state === 'play' && tras.every((x) => x[0] > paused.frame + 30), { paused: { changes: paused.changes, frame: paused.frame }, back: { changes: back.changes, tras } });
rec('sin errores de página', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
