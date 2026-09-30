// Rendimiento de una partida real de Arcade (muro, salto entre mundos, piruetas) con la CPU frenada ×4,
// más 50 reintentos y una tirada larga midiendo memoria.
// Uso: node tests/rendimiento-arcade.mjs [--cpu=4] [--secs=150] [--retries=50] [--soak=300] [--w=844 --h=390 --dpr=2] [--q=alta]
// Salvedades: la CPU se frena, la GPU no; el jugador es un bot invulnerable con la entrada sustituida (no se mide el camino de la muerte).
// Sale con 1 si no se cumple: 1 % peor ≥ 50 fps, ≤ 1 % de fotogramas > 33 ms, geometrías/texturas ±5, montón +10 MB.
import puppeteer from 'puppeteer';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const CPU = +(opt.cpu || 4), SECS = +(opt.secs || 150), RETRIES = +(opt.retries || 50), SOAK = +(opt.soak || 300);
const W = +(opt.w || 844), H = +(opt.h || 390), DPR = +(opt.dpr || 2), Q = opt.q || '';
const URL0 = (process.env.HIP_URL || 'http://localhost:5173/') + (Q ? '?q=' + Q : '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const rec = (ok, name, info) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${name}${info ? '  — ' + JSON.stringify(info) : ''}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, isLandscape: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL0, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
await sleep(800);

// jugador automático en tiempo real por la ruta normal de entrada: gira con el bot, salta con la carga y hace piruetas
const armar = () => page.evaluate(() => {
  const h = window.__hip, g = h.game, inp = h.input;
  window.__ev = { wall: 0, world: 0, trick: 0, jump: 0, fold: 0 };
  inp.steer = () => {
    let st = h.bot(g);
    const hole = g.boxes.find((b) => b.carton && !b.hit && b.k > g.s);
    if (hole && hole.k - g.s < 30) { let d = hole.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); st = Math.max(-1, Math.min(1, d * 3)); }
    return st;
  };
  let n = 0;
  inp.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  inp.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
  g.invul = 1e9;
  const r = h.renderer;
  if (r.__qaWrap) return;
  const o = r.onEvents.bind(r); r.__qaWrap = true;
  r.onEvents = (ev, gg) => { for (const e of ev) { if (e.type === 'wall') window.__ev.wall++; else if (e.type === 'world') window.__ev.world++; else if (e.type === 'trickDone') window.__ev.trick++; else if (e.type === 'boost') window.__ev.jump++; else if (e.type === 'foldEnd') window.__ev.fold++; } return o(ev, gg); };
});
const empezar = async (seed) => { await page.evaluate((s) => window.__hip.start('arcade', s), seed); await armar(); };
const snap = () => page.evaluate(() => { if (window.gc) window.gc(); const i = window.__hip.renderer.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs ? i.programs.length : -1, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }; });

// 1) fps con la CPU frenada, partida en tiempo real
const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await empezar(7);
await sleep(1500);
const medir = (secs) => page.evaluate((s) => new Promise((res) => {
  const dts = []; let last = performance.now(); const t0 = last;
  (function f(now) { dts.push(now - last); last = now; if (now - t0 < s * 1000) requestAnimationFrame(f); else res({ dts: dts.slice(1), g: { s: Math.round(window.__hip.game.s), world: window.__hip.game.world, time: +window.__hip.game.time.toFixed(1), walls: window.__hip.game.walls, tricks: window.__hip.game.tricksTotal, state: window.__hip.state }, ev: window.__ev }); })(last);
}), secs);
const m = await medir(SECS);
const sorted = [...m.dts].sort((a, b) => a - b);
const worst1 = sorted.slice(Math.floor(sorted.length * 0.99));
const avg = m.dts.reduce((a, b) => a + b, 0) / m.dts.length;
const low1 = 1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length);
const over33 = m.dts.filter((x) => x > 33.4).length;
const res = { cpu: CPU, avgFps: +(1000 / avg).toFixed(1), low1Fps: +low1.toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(1), frames: m.dts.length, over33ms: over33, pctOver33: +(100 * over33 / m.dts.length).toFixed(2), q: await page.evaluate(() => window.__hip.renderer.quality), ...m.g, eventos: m.ev };
rec(m.g.state === 'play', 'la partida sigue en marcha', m.g);
rec(m.ev.wall > 0 && m.ev.world > 0 && m.ev.trick > 0, 'se han visto muro, cambio de mundo y piruetas', m.ev);
rec(res.low1Fps >= 50 && res.pctOver33 <= 1, `Arcade con CPU ×${CPU}: 1 % peor ≥ 50 fps y ≤ 1 % de fotogramas > 33 ms`, res);
await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

// 2) reintentos: geometrías, texturas y montón
await page.evaluate(() => window.__hip.ui.show('title'));
await sleep(300);
const a = await snap();
const vistoReintentos = { wall: 0, world: 0, trick: 0 };
for (let i = 0; i < RETRIES; i++) {
  await empezar(100 + i);
  // se avanza hasta pasar el primer muro, cambio de mundo y pirueta (simulación a mano) y se enseña un rato en tiempo real
  const ev = await page.evaluate(() => { const h = window.__hip, g = h.game; const e = { wall: 0, world: 0, trick: 0 }; for (let k = 0; k < 60 * 120 && !(e.wall && e.world && e.trick); k++) { g.step({ steer: h.bot(g), jump: k % 90 === 0 && g.charges > 0 && !g.flight(), trick: !!g.flight() && g.landIn > 0.35 && g.trickT < 0 }); h.renderer.track.sync(g); for (const x of g.events) { if (x.type === 'wall') e.wall++; else if (x.type === 'world') e.world++; else if (x.type === 'trickDone') e.trick++; } } return e; });
  vistoReintentos.wall += ev.wall > 0; vistoReintentos.world += ev.world > 0; vistoReintentos.trick += ev.trick > 0;
  await sleep(250);
  await page.evaluate(() => window.__hip.ui.show('title'));
}
rec(vistoReintentos.wall === RETRIES && vistoReintentos.world === RETRIES && vistoReintentos.trick === RETRIES, `cada reintento pasó por muro, cambio de mundo y pirueta`, vistoReintentos);
await sleep(300);
const b = await snap();
rec(Math.abs(b.geo - a.geo) <= 5 && Math.abs(b.tex - a.tex) <= 5 && b.prog <= a.prog + 2, `${RETRIES} reintentos: geometrías y texturas ±5`, { antes: a, despues: b });
if (a.heapMB != null) rec(b.heapMB - a.heapMB <= 10, `${RETRIES} reintentos: montón +10 MB como mucho`, { antes: a.heapMB, despues: b.heapMB });

// 3) tirada larga en tiempo real
if (SOAK > 0) {
  await empezar(33);
  await sleep(3000);
  const c0 = await snap();
  const log = [];
  for (let t = 30; t <= SOAK; t += 30) { await sleep(30000); const c = await snap(); log.push({ s: t, ...c }); }
  const c1 = log[log.length - 1] || c0;
  const gs = await page.evaluate(() => ({ state: window.__hip.state, s: Math.round(window.__hip.game.s), alive: window.__hip.game.alive, ev: window.__ev }));
  rec(gs.state === 'play' && gs.alive && gs.ev.wall > 0 && gs.ev.world > 0 && gs.ev.trick > 0, `${SOAK} s de Arcade seguidos (con muro, mundos y piruetas; invulnerable, así que «vivo» es trivial)`, gs);
  rec(Math.abs(c1.geo - c0.geo) <= 5 && Math.abs(c1.tex - c0.tex) <= 5, 'tirada larga: geometrías y texturas ±5', { inicio: c0, fin: c1 });
  if (c0.heapMB != null) rec(c1.heapMB - c0.heapMB <= 10, 'tirada larga: montón +10 MB como mucho', { inicio: c0.heapMB, fin: c1.heapMB, log: log.map((l) => l.heapMB) });
}
rec(errors.length === 0, 'sin errores en consola', errors.slice(0, 3));
await browser.close();
process.exit(fallos ? 1 : 0);
