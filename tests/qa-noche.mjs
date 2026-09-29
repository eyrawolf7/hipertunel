// Barrido rápido de la 0.60: pausa en pleno salto, piruetas, muro, reintentos, rotación y pantallas
// a 844×390. Uso: node tests/qa-noche.mjs [--url=http://localhost:5173/] [--only=a,b]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const ONLY = opt.only ? new Set(opt.only.split(',')) : null;
const OUT = new URL('./shots/qa-noche/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });
let fails = 0;
const rec = (id, name, pass, info) => { if (pass === false) fails++; console.log(`${pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL'}  [${id}] ${name}  — ${JSON.stringify(info)}`); };
async function open(vp = PHONE) {
  const page = await browser.newPage(); await page.setViewport(vp);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 }); await sleep(800);
  return { page, errors };
}
const run = async (id, fn) => { if (ONLY && !ONLY.has(id)) return; try { await fn(); } catch (e) { rec(id, 'excepción', false, String(e.stack || e).split('\n').slice(0, 2).join(' | ')); } };

// a. pausa en pleno salto entre mundos con una pirueta a medias
await run('a', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { window.__hip.start('arcade', 7); window.__freeze = true; });
  await sleep(300);
  const found = await page.evaluate(() => { const h = window.__hip, g = h.game; const c0 = g.crash; g.crash = (b) => { b.hit = true; }; window.__c0 = c0; for (let i = 0; i < 60 * 240 && g.alive; i++) { h.step(1); if (g.flight && g.flight()) break; } return { fl: !!(g.flight && g.flight()), t: +g.time.toFixed(1), alive: g.alive, st: h.state }; });
  rec('a', 'se llega al salto entre mundos', found.fl, found);
  if (!found.fl) return page.close();
  await page.evaluate(() => { const g = window.__hip.game; delete g.crash; window.__hip.step(20); window.__freeze = false; });
  await sleep(50);
  await page.keyboard.down('Space'); await sleep(60); await page.keyboard.up('Space');
  await sleep(120);
  const b = await page.evaluate(() => ({ trickT: window.__hip.game.trickT, s: window.__hip.game.s, st: window.__hip.state }));
  await page.keyboard.press('KeyP'); await sleep(40);
  const p0 = await page.evaluate(() => ({ st: window.__hip.state, s: window.__hip.game.s, trickT: window.__hip.game.trickT }));
  await sleep(1500);
  const p1 = await page.evaluate(() => ({ st: window.__hip.state, s: window.__hip.game.s, trickT: window.__hip.game.trickT, screen: document.getElementById('ui').dataset.screen }));
  rec('a', 'pirueta arrancada con Espacio en el salto', b.trickT >= 0, b);
  rec('a', 'P pausa y congela sim y pirueta', p1.st === 'paused' && p1.s === p0.s && p1.trickT === p0.trickT, { p0, p1 });
  await page.screenshot({ path: OUT + 'a-pausa-salto.png' });
  await page.keyboard.press('Enter'); await sleep(500);
  const r0 = await page.evaluate(() => ({ st: window.__hip.state, intro: window.__hip.renderer.introT, screen: document.getElementById('ui').dataset.screen }));
  await page.screenshot({ path: OUT + 'a-reanuda.png' });
  const evs = await page.evaluate(() => new Promise((res) => { const g = window.__hip.game; const out = []; const t0 = performance.now(); (function f() { out.push({ st: window.__hip.state, tr: g.trickT, fl: !!g.flight(), tricks: g.tricksTotal, alive: g.alive }); if (performance.now() - t0 < 2500) requestAnimationFrame(f); else res(out); })(); }));
  const last = evs[evs.length - 1];
  rec('a', 'Enter reanuda (cuenta atrás, sin volver a la intro)', r0.st === 'countdown' || r0.st === 'play', r0);
  rec('a', 'tras reanudar, la pirueta se completa o se cuenta', last.tricks >= 1, { last, states: [...new Set(evs.map((e) => e.st))] });
  rec('a', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// b. muro de cartón: se ve, se rompe yendo al cartón, se muere contra la piedra sin impulso
await run('b', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { window.__hip.start('arcade', 11); window.__freeze = true; });
  await sleep(300);
  const w = await page.evaluate(() => { const h = window.__hip, g = h.game; g.crash = (b) => { if (!g.wallCrash(b)) b.hit = true; }; for (let i = 0; i < 60 * 300 && g.alive; i++) { h.step(1); if (g.boxes.some((b) => b.wall && b.k - g.s / 1 < 1e9)) { const wb = g.boxes.filter((b) => b.wall); return { walls: g.walls, n: wb.length, carton: wb.filter((b) => b.carton).length, t: +g.time.toFixed(1), alive: g.alive }; } } return { walls: g.walls, alive: g.alive, t: +g.time.toFixed(1) }; });
  rec('b', 'aparece un muro (12 piezas, 1 cartón)', w.n === 12 && w.carton === 1, w);
  await sleep(200);
  await page.screenshot({ path: OUT + 'b-muro.png' });
  const r = await page.evaluate(() => { const h = window.__hip, g = h.game; delete g.crash; for (let i = 0; i < 60 * 8 && g.alive && g.boxes.some((b) => b.wall); i++) { const hole = g.boxes.find((b) => b.carton && !b.hit && b.k > g.s); let st = h.bot(g); if (hole && hole.k - g.s < 30) { let d = hole.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); st = Math.max(-1, Math.min(1, d * 3)); } h.step(1, st); if (i === 20) window.__shotNow = true; } return { smashes: g.smashes, alive: g.alive, crashes: g.crashes }; });
  rec('b', 'el bot rompe el cartón y sigue vivo', r.smashes >= 1 && r.alive, r);
  rec('b', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// c. 20 reintentos rápidos (morir + Enter) sin fugas y con el cartón/zorro reiniciados
await run('c', async () => {
  const { page, errors } = await open();
  const snap = () => page.evaluate(() => { if (window.gc) window.gc(); const i = window.__hip.renderer.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs ? i.programs.length : -1, heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), scene: window.__hip.renderer.scene.children.length }; });
  await page.evaluate(() => window.__hip.start('arcade', 3)); await sleep(500);
  const s0 = await snap(); const bad = [];
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => { window.__freeze = true; const h = window.__hip; h.skipTo(h.game.s + 200 + Math.random() * 400); for (let k = 0; k < 60 * 30 && h.game.alive; k++) h.step(1, 0); window.__freeze = false; });
    const t0 = Date.now(); let st;
    while (Date.now() - t0 < 4000) { st = await page.evaluate(() => window.__hip.state); if (st === 'over') break; await sleep(100); }
    if (st !== 'over') { bad.push({ i, st }); break; }
    await sleep(700); await page.keyboard.press('Enter'); await sleep(900);
    const st2 = await page.evaluate(() => ({ st: window.__hip.state, s: window.__hip.game.s, alive: window.__hip.game.alive, crashes: window.__hip.game.crashes, trick: window.__hip.game.tricksTotal }));
    if (!(st2.st === 'countdown' || st2.st === 'play') || !st2.alive || st2.s > 200) bad.push({ i, ...st2 });
  }
  const s1 = await snap();
  rec('c', '20 reintentos con Enter vuelven a una partida limpia', bad.length === 0, bad.slice(0, 3));
  rec('c', 'memoria estable tras 20 reintentos (geo/tex ±5, heap +15 MB)', Math.abs(s1.geo - s0.geo) <= 5 && Math.abs(s1.tex - s0.tex) <= 5 && s1.heap - s0.heap < 15 && s1.scene - s0.scene <= 2, { s0, s1 });
  rec('c', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// d. rotación en pleno juego y vuelta
await run('d', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => window.__hip.start('arcade', 5)); await sleep(600);
  await page.setViewport({ ...PHONE, width: 390, height: 844, isLandscape: false }); await sleep(500);
  const v = await page.evaluate(() => ({ st: window.__hip.state, rot: !document.getElementById('rotate').hidden, s: window.__hip.game.s }));
  await page.screenshot({ path: OUT + 'd-vertical.png' });
  rec('d', 'girar a vertical pausa y muestra el aviso', v.st === 'paused' && v.rot, v);
  await page.setViewport(PHONE); await sleep(500);
  const h = await page.evaluate(() => ({ st: window.__hip.state, rot: !document.getElementById('rotate').hidden, screen: document.getElementById('ui').dataset.screen }));
  await page.screenshot({ path: OUT + 'd-horizontal.png' });
  rec('d', 'volver a horizontal quita el aviso y deja la pausa', !h.rot && h.st === 'paused', h);
  rec('d', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// e. pantallas a 844×390: nada se sale ni se solapa con el borde
await run('e', async () => {
  const { page, errors } = await open();
  const out = [];
  for (const s of ['title', 'modes', 'shop', 'settings', 'map', 'pause', 'over', 'hud']) {
    const r = await page.evaluate((s) => { const ui = window.__hip.ui; try { ui.show(s); } catch (e) { return { s, err: String(e) }; } const el = document.querySelector(`[data-screen="${s}"]`) || document.getElementById('ui'); const W = innerWidth, H = innerHeight; const off = []; el.querySelectorAll('button, h1, h2, img, .card, [class*=btn]').forEach((b) => { const r = b.getBoundingClientRect(); if (r.width && getComputedStyle(b).visibility !== 'hidden' && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) off.push(`${b.tagName}.${b.className}`.slice(0, 40) + ` ${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}`); }); return { s, off: off.slice(0, 4), n: off.length }; }, s);
    await sleep(350); await page.screenshot({ path: OUT + `e-${s}.png` });
    out.push(r);
  }
  const bad = out.filter((r) => r.err || r.n);
  rec('e', 'ningún botón/título fuera de 844×390', bad.length === 0, bad);
  rec('e', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// f. mando: navegar menús y jugar con un Gamepad simulado
await run('f', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { const pad = { id: 'QA pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null]; window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad })); });
  const press = async (i, ms = 90) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; window.__pad.timestamp++; }, i); await sleep(ms); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; window.__pad.timestamp++; }, i); await sleep(150); };
  const s0 = await page.evaluate(() => document.getElementById('ui').dataset.screen);
  await press(0); await sleep(3500);
  const st = await page.evaluate(() => ({ st: window.__hip.state, screen: document.getElementById('ui').dataset.screen, mode: window.__hip.game.variant || window.__hip.game.mode }));
  rec('f', 'A en el título empieza a jugar', st.st === 'play' || st.st === 'countdown', { s0, ...st });
  const th0 = await page.evaluate(() => window.__hip.game.theta);
  await page.evaluate(() => { window.__pad.axes[0] = 1; window.__pad.timestamp++; }); await sleep(300); await page.evaluate(() => { window.__pad.axes[0] = 0; });
  const th1 = await page.evaluate(() => window.__hip.game.theta);
  rec('f', 'stick a la derecha gira', Math.abs(th1 - th0) > 0.3, { d: +(th1 - th0).toFixed(2) });
  await press(9); const p = await page.evaluate(() => window.__hip.state);
  rec('f', 'Start pausa', p === 'paused', p);
  await press(9); await sleep(300); const r0 = await page.evaluate(() => window.__hip.state);
  rec('f', 'Start otra vez reanuda', r0 === 'countdown' || r0 === 'play', r0);
  await press(0); await sleep(300); const r = await page.evaluate(() => ({ st: window.__hip.state, foc: document.querySelector('.is-focus')?.textContent?.trim().slice(0, 20) }));
  rec('f', 'un solo A reanuda desde la pausa', r.st === 'countdown' || r.st === 'play', r);
  if (r.st === 'paused') { await press(0); await sleep(300); rec('f', 'segundo A', null, await page.evaluate(() => window.__hip.state)); }
  rec('f', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

await browser.close();
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
