// Sonido de paso lateral: el paneo de cada «pass» coincide con el lado de la caja y no pasan de 6 por segundo.
// Uso: node tests/paso-lateral.mjs [--url=...] [--secs=25]   (por defecto $HIP_URL)
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const SECS = +(opt.secs || 25);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const rec = (n, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n} — ${JSON.stringify(info)}`); };
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(800);

// registro: cada llamada a audio.play('pass'|'nearMiss') con el lado esperado calculado aparte (por carriles enteros)
await page.evaluate(() => {
  const h = window.__hip, orig = h.audio.play.bind(h.audio);
  window.__log = []; window.__stepN = 0; window.__exp = null;
  h.audio.play = (name, o) => {
    if (name === 'pass' || name === 'nearMiss') window.__log.push({ name, pan: o && o.pan, near: o && o.near, step: window.__stepN, exp: window.__exp });
    return orig(name, o);
  };
  window.__wrap = (g) => {
    if (g.__wrapped) return; g.__wrapped = true;
    const st = g.step.bind(g);
    g.step = (inp) => {
      const s0 = g.s, r = st(inp); window.__stepN++;
      const p = g.theta / (Math.PI / 6); let best = null, bestA = 99, wasOpen = false;
      for (const b of g.boxes) {
        if (b.hit || b.k + 0.5 <= s0 || b.k + 0.5 > g.s) continue;
        const open = g.fold !== 30 && g.fold !== -30;   // lámina abierta: sin dar la vuelta (0 y 11 no son vecinos)
        let diff = b.lane - p;
        if (!open) { diff = (((diff % 12) + 12) % 12); if (diff > 6) diff -= 12; }
        if (Math.abs(diff) >= 0.75 && Math.abs(diff) <= 2.5 && Math.abs(diff) < bestA) { bestA = Math.abs(diff); best = diff; wasOpen = open; }
      }
      if (best !== null && wasOpen) window.__openN = (window.__openN || 0) + 1;
      window.__exp = best === null ? null : { side: Math.sign(best), a: bestA };
      return r;
    };
  };
});

let total = 0, openTotal = 0;
for (const [mode, seed] of [['classic', 3], ['classic', 11], ['arcade', 5]]) {
  await page.evaluate((mode, seed) => {
    const h = window.__hip; h.start(mode, seed); window.__wrap(h.game);
    window.__log = []; window.__stepN = 0;
    h.input.steer = () => h.bot(h.game, 11);
  }, mode, seed);
  await sleep(SECS * 1000);
  const r = await page.evaluate(() => ({ open: window.__openN || 0, log: window.__log, steps: window.__stepN, st: window.__hip.state }));
  const passes = r.log.filter((e) => e.name === 'pass'), all = r.log;
  const bad = all.filter((e) => !e.exp || e.pan !== e.exp.side);
  // tope por segundo: ventanas deslizantes de 60 pasos
  let worst = 0; for (let i = 0; i < all.length; i++) { let n = 0; for (let j = i; j < all.length && all[j].step - all[i].step < 60; j++) n++; worst = Math.max(worst, n); }
  const passesOnly = passes; let worstP = 0; for (let i = 0; i < passesOnly.length; i++) { let n = 0; for (let j = i; j < passesOnly.length && passesOnly[j].step - passesOnly[i].step < 60; j++) n++; worstP = Math.max(worstP, n); }
  total += passes.length; openTotal += r.open;
  rec(`${mode} #${seed}: suena al pasar cajas laterales (mín. 1 «pass»)`, passes.length >= 1, { pass: passes.length, near: all.length - passes.length, steps: r.steps, st: r.st });
  rec(`${mode} #${seed}: el signo del paneo coincide con el lado de la caja`, all.length > 0 && bad.length === 0, { n: all.length, mal: bad.slice(0, 3) });
  rec(`${mode} #${seed}: como mucho 6 sonidos de paso por segundo`, worstP <= 6 && worst <= 8, { paso: worstP, conRoce: worst });
  rec(`${mode} #${seed}: near en 0..1`, passes.every((e) => e.near >= 0 && e.near <= 1), passes.slice(0, 2));
}
rec('en total suenan al menos 15 «pass»', total >= 15, { total });
console.log(`(pasos con la lámina abierta comprobados: ${openTotal})`);
rec('sin errores de página', errors.length === 0, errors.slice(0, 3));
await browser.close();
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
