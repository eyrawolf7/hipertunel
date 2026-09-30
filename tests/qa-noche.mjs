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
  let n = 0; page.on('load', () => { if (++n > 1 && !page.__qaReload) console.log('RELOAD ' + page.url()); });
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
    const r = await page.evaluate(async (s) => { const ui = window.__hip.ui; try { ui.show(s); } catch (e) { return { s, err: String(e) }; } await new Promise((r) => setTimeout(r, 400)); const el = document.querySelector(`.scr[data-screen="${s}"]`) || document.getElementById('ui'); const W = innerWidth, H = innerHeight;
      // la placa pintada del título asoma por arriba a propósito (≤ 20 px) y las tarjetas de un carrusel con scroll se deslizan
      const scrolls = (b) => { for (let p = b.parentElement; p && p !== document.body; p = p.parentElement) if (p.scrollWidth > p.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(p).overflowX)) return true; return false; };
      const off = []; el.querySelectorAll('button, h1, h2, img, .card, [class*=btn]').forEach((b) => { const r = b.getBoundingClientRect(); if (b.classList.contains('head-title') && r.top >= -20 && r.left >= -1 && r.right <= W + 1 && r.bottom <= H + 1) return; if (scrolls(b) && r.top >= -1 && r.bottom <= H + 1) return; if (r.width && getComputedStyle(b).visibility !== 'hidden' && (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1)) off.push(`${b.tagName}.${b.className}`.slice(0, 40) + ` ${r.left | 0},${r.top | 0},${r.right | 0},${r.bottom | 0}`); }); return { s, off: off.slice(0, 4), n: off.length }; }, s);
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
  await page.evaluate(() => { window.__pad.axes[0] = 1; window.__pad.timestamp++; }); await page.waitForFunction((t0) => Math.abs(window.__hip.game.theta - t0) > 0.3 || !window.__hip.game.alive, { timeout: 2000 }, th0).catch(() => {}); await page.evaluate(() => { window.__pad.axes[0] = 0; });
  const th1 = await page.evaluate(() => window.__hip.game.theta);
  rec('f', 'stick a la derecha gira', Math.abs(th1 - th0) > 0.3, { d: +(th1 - th0).toFixed(2) });
  await press(9); const p = await page.evaluate(() => window.__hip.state);
  rec('f', 'Start pausa', p === 'paused', p);
  await press(9); await sleep(300); const r0 = await page.evaluate(() => window.__hip.state);
  rec('f', 'Start otra vez reanuda', r0 === 'countdown' || r0 === 'play', r0);
  // la cuenta atrás ya terminó: se pausa de nuevo y un solo A sobre «Continuar» tiene que reanudar
  await page.evaluate(() => { window.__hip.game.invul = 1e9; });
  await page.waitForFunction(() => window.__hip.state === 'play', { timeout: 6000 });
  await press(9); const p2 = await page.evaluate(() => ({ st: window.__hip.state, foc: document.querySelector('.is-focus')?.dataset.act }));
  await press(0); await sleep(300); const r = await page.evaluate(() => ({ st: window.__hip.state }));
  rec('f', 'un solo A sobre Continuar reanuda desde la pausa', p2.st === 'paused' && p2.foc === 'resume' && (r.st === 'countdown' || r.st === 'play'), { p2, r });
  rec('f', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// g. piruetas (simulación congelada, entradas directas a game.step): dentro del salto cuentan, fuera no, el tropiezo resta
await run('g', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { window.__hip.start('arcade', 7); window.__freeze = true; });
  const r = await page.evaluate(() => {
    const h = window.__hip, g = h.game, out = {};
    const evs = []; const inv = g.invul;
    const step = (trick) => { const before = g.s; const ev = g.step({ steer: h.bot(g), trick }); for (const e of ev) evs.push(e.type + (e.lost !== undefined ? ':' + e.lost : '')); h.renderer.onEvents(ev, g); h.renderer.track.sync(g); };
    g.crash = (b) => { b.hit = true; };
    // fuera del salto: pedir pirueta no hace nada
    for (let i = 0; i < 30; i++) step(true);
    out.trickFuera = g.trickT; out.totalFuera = g.tricksTotal;
    // hasta el salto
    for (let i = 0; i < 60 * 240 && g.alive && !g.flight(); i++) step(false);
    out.enVuelo = !!g.flight(); out.landIn0 = +g.landIn.toFixed(2);
    // pirueta en el aire: se completa y suma monedas
    const c0 = g.coinsGot; step(true); out.trickT = g.trickT;
    for (let i = 0; i < 60 && g.trickT >= 0; i++) step(false);
    out.total1 = g.tricksTotal; out.coins1 = g.coinsGot - c0; out.done = evs.includes('trickDone');
    // segunda pirueta demasiado tarde: aterriza a medias → tropiezo, pierde las monedas de la racha
    while (g.flight() && g.landIn > 0.2) step(false);
    const c1 = g.coinsGot; out.racha = g.trickCoins; step(true);
    for (let i = 0; i < 60 && g.trickT >= 0; i++) step(false);
    out.fail = evs.find((e) => e.startsWith('trickFail')); out.coinsTrasFallo = g.trickCoins; out.c1 = c1 - c0; out.trickTFin = g.trickT;
    return out;
  });
  rec('g', 'pedir pirueta fuera del salto no hace nada', r.trickFuera === -1 && r.totalFuera === 0, { t: r.trickFuera, total: r.totalFuera });
  rec('g', 'en el salto la pirueta arranca, se completa (trickDone) y da monedas', r.enVuelo && r.trickT >= 0 && r.total1 === 1 && r.done && r.coins1 >= 5, r);
  rec('g', 'aterrizar a mitad de otra pirueta = tropiezo y pierde las monedas de la racha', !!r.fail && r.racha > 0 && r.fail === 'trickFail:' + r.racha && r.coinsTrasFallo === 0 && r.trickTFin === -1, { fail: r.fail, racha: r.racha, tras: r.coinsTrasFallo });   // las monedas sueltas que caigan en el salto no cuentan
  await page.close();
  // tocar la pantalla en el salto hace la pirueta y no pausa (toque real, con la partida en marcha)
  const b = await open();
  await b.page.evaluate(() => { window.__hip.start('arcade', 7); window.__freeze = true; const h = window.__hip, g = h.game; g.crash = (x) => { x.hit = true; }; for (let i = 0; i < 60 * 240 && g.alive && !(g.flight() && g.landIn > 0.7); i++) h.step(1); window.__seen = 0; (function f() { if (g.trickT >= 0) window.__seen++; requestAnimationFrame(f); })(); window.__freeze = false; });
  await b.page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2);
  await sleep(300);
  const t = await b.page.evaluate(() => ({ st: window.__hip.state, seen: window.__seen, alive: window.__hip.game.alive }));
  rec('g', 'tocar en el salto no pausa y arranca la pirueta', t.st === 'play' && t.seen > 0, t);
  await b.page.close();
  // Espacio y X del mando (botón 2) en el aire: la pirueta llega a trickDone por la ruta real de entrada
  for (const via of ['Espacio', 'X del mando']) {
    const c = await open();
    await c.page.evaluate(() => { const pad = { id: 'QA pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null]; window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad })); });
    await c.page.evaluate(() => { window.__hip.start('arcade', 7); window.__freeze = true; const h = window.__hip, g = h.game; g.crash = (x) => { x.hit = true; }; g.coinsGot = 0; for (let i = 0; i < 60 * 240 && g.alive && !g.flight(); i++) h.step(1); window.__ev = 0; const r = h.renderer, o = r.onEvents.bind(r); r.onEvents = (ev, gg) => { for (const e of ev) if (e.type === 'trickDone') window.__ev++; return o(ev, gg); }; window.__freeze = false; });
    if (via === 'Espacio') { await c.page.keyboard.down('Space'); await sleep(60); await c.page.keyboard.up('Space'); }
    else { await c.page.evaluate(() => { window.__pad.buttons[2] = { pressed: true, value: 1 }; window.__pad.timestamp++; }); await sleep(60); await c.page.evaluate(() => { window.__pad.buttons[2] = { pressed: false, value: 0 }; window.__pad.timestamp++; }); }
    await sleep(900);
    const d = await c.page.evaluate(() => ({ st: window.__hip.state, trickDone: window.__ev, total: window.__hip.game.tricksTotal, monedas: window.__hip.game.coinsGot }));
    rec('g', `${via} en el salto da trickDone y +5 monedas`, d.st === 'play' && d.trickDone >= 1 && d.total >= 1, d);
    errors.push(...c.errors); await c.page.close();
  }
  rec('g', 'sin errores', errors.length === 0 && b.errors.length === 0, [...errors, ...b.errors].slice(0, 3));
});

// h. muro: aviso antes del muro, carril del cartón apagado, la piedra sin impulso mata, cartón entero tras reiniciar
await run('h', async () => {
  const { page, errors } = await open();
  await page.evaluate(() => { window.__hip.start('arcade', 11); window.__freeze = true; });
  const r = await page.evaluate(() => {
    const h = window.__hip, g = h.game, out = { seq: [] };
    g.invul = 1e9;
    let wall = null;
    for (let i = 0; i < 60 * 300 && g.alive && !wall; i++) { h.step(1); for (const e of g.events) if (e.type === 'wallSoon' || e.type === 'wall') { out.seq.push(e.type); if (e.type === 'wall') wall = e; } }
    if (!wall) return out;
    out.hole = wall.lane;
    // que el muro esté cerca (últimas filas) y mirar los carriles encendidos
    for (let i = 0; i < 60 * 20 && g.boxes.some((b) => b.wall && b.k - g.s > 6); i++) h.step(1);
    g.theta = ((wall.lane + 6) % 12) * Math.PI / 6;   // el jugador en un carril de piedra (el del cartón no depende de dónde estés)
    const lit = g.litStrips();
    out.litHole = lit.has(wall.lane); out.litStone = [...Array(12).keys()].filter((l) => l !== wall.lane && lit.has(l)).length;
    // piedra sin impulso: al carril opuesto al cartón, sin invulnerabilidad
    g.boxes = g.boxes.filter((b) => b.wall);   // que solo el muro pueda matar
    g.invul = 0; g.disableBoost(); g.vTarget = g.v = Math.min(g.v, 2.5); let killer = null;
    const c = g.crash.bind(g); g.crash = (b) => { if (g.alive) killer = { wall: !!b.wall, carton: !!b.carton, lane: b.lane, k: +b.k.toFixed(1), s: +g.s.toFixed(1), hole: wall.lane }; return c(b); };
    const lane = (wall.lane + 6) % 12;
    for (let i = 0; i < 60 * 8 && g.alive; i++) { let d = lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); h.step(1, Math.max(-1, Math.min(1, d * 3))); g.boxes = g.boxes.filter((b) => b.wall); }
    out.alive = g.alive; out.killer = killer;
    return out;
  });
  rec('h', 'wallSoon llega antes que wall', r.seq[0] === 'wallSoon' && r.seq[1] === 'wall', r.seq);
  rec('h', 'el carril del cartón se queda apagado y los de piedra se encienden', r.litHole === false && r.litStone >= 6, { litHole: r.litHole, litStone: r.litStone });
  rec('h', 'la piedra sin impulso mata', r.alive === false && r.killer && r.killer.wall && !r.killer.carton, { alive: r.alive, killer: r.killer });
  // reiniciar: otra partida empieza con el contador de muros a cero
  await page.evaluate(() => { window.__hip.start('arcade', 12); window.__freeze = true; });
  const s = await page.evaluate(() => { const g = window.__hip.game; return { walls: g.walls, smashes: g.smashes, wallsOnTrack: g.boxes.filter((b) => b.wall).length, hits: g.boxes.filter((b) => b.wall && b.hit).length }; });
  rec('h', 'tras reiniciar no queda ningún muro ni cartón roto', s.walls === 0 && s.smashes === 0 && s.wallsOnTrack === 0, s);
  const r2 = await page.evaluate(() => { const h = window.__hip, g = h.game; g.invul = 1e9; for (let i = 0; i < 60 * 300 && g.alive && !g.boxes.some((b) => b.wall); i++) h.step(1); const c = g.boxes.filter((b) => b.wall && b.carton); return { n: c.length, hit: c.filter((b) => b.hit).length, alive: g.alive }; });
  rec('h', 'el cartón del muro nuevo está entero', r2.n === 1 && r2.hit === 0, r2);
  // romperlo (el trozo de cartón queda en el render) y reiniciar: el render se limpia
  const sm = await page.evaluate(() => { const h = window.__hip, g = h.game, R = h.renderer; g.boxes = g.boxes.filter((b) => b.wall); const hole = g.boxes.find((b) => b.carton); for (let i = 0; i < 60 * 6 && g.alive && !g.smashes; i++) { let d = hole.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); h.step(1, Math.max(-1, Math.min(1, d * 3))); R.update(g, g.s, g.theta, 1 / 60); g.boxes = g.boxes.filter((b) => b.wall); } return { smashes: g.smashes, partes: R.boxes.carton.live.length }; });
  await page.evaluate(() => { window.__hip.start('arcade', 13); window.__freeze = true; window.__hip.renderer.update(window.__hip.game, 0, 0, 1 / 60); });
  const sm2 = await page.evaluate(() => ({ smashes: window.__hip.game.smashes, partes: window.__hip.renderer.boxes.carton.live.length }));
  rec('h', 'romper el cartón deja trozos y reiniciar los limpia del render', sm.smashes >= 1 && sm.partes > 0 && sm2.smashes === 0 && sm2.partes === 0, { sm, sm2 });
  rec('h', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// i. cámaras: la intro se salta con A/Enter o con un toque; al morir el zorro sale en pantalla, junto a la caja, sin NaN
await run('i', async () => {
  const { page, errors } = await open();
  const intro = () => page.evaluate(() => ({ st: window.__hip.state, on: window.__hip.renderer.introOn }));
  await page.evaluate(() => window.__hip.startMenu('arcade')); await sleep(400);
  const i0 = await intro();
  await page.keyboard.press('Enter'); await sleep(200);
  const i1 = await intro();
  rec('i', 'la intro arranca y Enter la salta', i0.st === 'countdown' && i0.on === true && i1.on === false, { i0, i1 });
  await page.evaluate(() => window.__hip.startMenu('arcade')); await sleep(400);
  const j0 = await intro();
  await page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2); await sleep(200);
  const j1 = await intro();
  rec('i', 'un toque salta la intro', j0.on === true && j1.on === false, { j0, j1 });
  await page.evaluate(() => { const pad = { id: 'QA pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null]; window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad })); window.__hip.startMenu('arcade'); });
  await sleep(400);
  const k0 = await intro();
  await page.evaluate(() => { window.__pad.buttons[0] = { pressed: true, value: 1 }; window.__pad.timestamp++; }); await sleep(120);
  await page.evaluate(() => { window.__pad.buttons[0] = { pressed: false, value: 0 }; window.__pad.timestamp++; }); await sleep(150);
  const k1 = await intro();
  rec('i', 'A del mando salta la intro', k0.on === true && k1.on === false, { k0, k1 });
  // muerte: se juega en tiempo real, el zorro tiene que verse entero en los fotogramas siguientes
  await page.evaluate(() => { window.__hip.start('arcade', 5); window.__freeze = true; const h = window.__hip; for (let k = 0; k < 60 * 60 && h.game.alive; k++) { h.step(1, 0); h.renderer.update(h.game, h.game.s, h.game.theta, 1 / 60); } window.__freeze = false; });
  const samples = await page.evaluate(() => new Promise((res) => {
    const h = window.__hip, R = h.renderer, out = []; const t0 = performance.now();
    (function f() {
      const t = (performance.now() - t0) / 1000;
      const p = R.hero.group.position.clone(), cp = R.camera.position;
      const ndc = p.clone().project(R.camera);
      const foc = R.deathFocus;
      out.push({ t: +t.toFixed(2), vis: R.hero.group.visible, finite: [p.x, p.y, p.z, cp.x, cp.y, cp.z].every(Number.isFinite), ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], d: foc ? +p.distanceTo(foc).toFixed(1) : null, st: h.state });
      if (t < 2.6) requestAnimationFrame(f); else res(out);
    })();
  }));
  const late = samples.filter((s) => s.t > 0.4);
  const fin = samples[samples.length - 1];
  await page.screenshot({ path: OUT + 'i-muerte.png' });
  rec('i', 'ni la cámara ni el zorro tienen NaN', samples.every((s) => s.finite), samples.filter((s) => !s.finite).slice(0, 2));
  rec('i', 'el zorro se ve y está en pantalla tras el choque', late.length > 10 && late.every((s) => s.vis && Math.abs(s.ndc[0]) < 1 && Math.abs(s.ndc[1]) < 1), { fin, malas: late.filter((s) => !s.vis || Math.abs(s.ndc[0]) >= 1 || Math.abs(s.ndc[1]) >= 1).slice(0, 3) });
  rec('i', 'el zorro cae cerca del sitio del choque (< 8 u)', late.every((s) => s.d !== null && s.d < 8), { max: Math.max(...late.map((s) => s.d ?? -1)), sinFoco: late.filter((s) => s.d === null).length });
  rec('i', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// j. menús pintados: todas las piezas cargan, foco por defecto en cada pantalla, navegación entera con teclado y mando
await run('j', async () => {
  const { page, errors } = await open();
  const dir = new URL('../app/src/assets/ui/', import.meta.url).pathname;
  const { readdirSync } = await import('node:fs');
  const files = [...new Set(readdirSync(dir).filter((f) => /\.(png|webp)$/.test(f)).map((f) => f.replace(/\.(png|webp)$/, '')))];
  const imgs = await page.evaluate(async (files) => {
    const root = document.getElementById('ui'), bad = [];
    for (const n of files) {
      const v = root.style.getPropertyValue('--img-' + n); const m = v.match(/url\("?(.*?)"?\)/);
      if (!m || !root.classList.contains('has-' + n)) { bad.push(n + ': sin variable'); continue; }
      const ok = await new Promise((res) => { const i = new Image(); i.onload = () => res(i.naturalWidth > 0); i.onerror = () => res(false); i.src = m[1]; });
      if (!ok) bad.push(n + ': no carga');
    }
    return bad;
  }, files);
  rec('j', `las ${files.length} piezas pintadas cargan y están publicadas`, files.length >= 30 && imgs.length === 0, imgs.slice(0, 5));
  const focus = await page.evaluate(async () => {
    const out = [];
    for (const s of ['title', 'modes', 'shop', 'settings', 'map', 'pause', 'over']) {
      window.__hip.ui.show(s); await new Promise((r) => setTimeout(r, 200));
      const f = document.querySelector(`.scr[data-screen="${s}"] .is-focus`), def = document.querySelector(`.scr[data-screen="${s}"] [data-default]`);
      const r = f && f.getBoundingClientRect();
      out.push({ s, ok: !!f && (def ? def === f : ['shop', 'map'].includes(s)) && r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight, foco: f ? (f.dataset.act || f.dataset.mode || f.dataset.set || f.dataset.stage || f.className).toString().slice(0, 24) : null });
    }
    return out;
  });
  rec('j', 'cada pantalla tiene un foco por defecto visible', focus.every((x) => x.ok), focus.filter((x) => !x.ok));
  // navegación con teclado: recorrer con flechas y ver que se llega a todo lo enfocable
  const reach = async (screen, keys) => {
    await page.evaluate((s) => { window.__hip.ui.show(s); }, screen); await sleep(300);
    const total = await page.evaluate((s) => [...document.querySelectorAll(`.scr[data-screen="${s}"] [data-nav]`)].filter((e) => e.offsetParent !== null && !e.disabled).length, screen);
    const seen = new Set(); let seed = 12345;   // paseo aleatorio con semilla (las flechas de un deslizador lo ajustan en vez de moverse)
    for (let i = 0; i < 90 && seen.size < total; i++) {
      seen.add(await page.evaluate(() => { const f = document.querySelector('.is-focus'); return f ? [...f.parentElement.children].indexOf(f) + ':' + (f.dataset.act || f.dataset.mode || f.dataset.set || f.dataset.stage || f.className) : ''; }));
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      await page.keyboard.press(keys[(seed >> 8) % keys.length]); await sleep(25);
    }
    return { screen, total, vistos: seen.size };
  };
  const nav = [];
  const ARROWS = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  for (const s of ['title', 'modes', 'settings', 'pause', 'over']) nav.push(await reach(s, ARROWS));
  rec('j', 'con flechas se llega a todos los botones de cada pantalla', nav.every((n) => n.total >= 2 && n.vistos >= n.total), nav);
  // mando: cruceta (12-15) mueve el foco y A (0) pulsa
  await page.evaluate(() => { const pad = { id: 'QA pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) }; window.__pad = pad; navigator.getGamepads = () => [pad, null, null, null]; window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad })); window.__hip.ui.show('title'); });
  await sleep(300);
  const press = async (i) => { await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: true, value: 1 }; window.__pad.timestamp++; }, i); await sleep(90); await page.evaluate((i) => { window.__pad.buttons[i] = { pressed: false, value: 0 }; window.__pad.timestamp++; }, i); await sleep(150); };
  const foc = () => page.evaluate(() => { const f = document.querySelector('.is-focus'); return f ? (f.dataset.act || f.dataset.mode || f.className) : null; });
  const f0 = await foc(); let moved = false, f1 = f0;
  for (const b of [13, 15, 12, 14]) { await press(b); f1 = await foc(); if (f1 !== f0) { moved = true; break; } }
  rec('j', 'la cruceta del mando mueve el foco en el título', moved, { f0, f1 });
  await press(1); await sleep(200);
  await page.evaluate(() => window.__hip.ui.show('modes')); await sleep(300);
  await press(1); await sleep(300);
  rec('j', 'B en Elige modo vuelve al título', await page.evaluate(() => document.getElementById('ui').dataset.screen) === 'title', null);
  rec('j', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

// k. avisos: sin repeticiones, ≤ 2 a la vez, ninguno sobre la pausa ni el fin de partida
await run('k', async () => {
  const { page, errors } = await open();
  const count = () => page.evaluate(() => document.querySelectorAll('.toast').length);
  await page.evaluate(() => { window.__hip.ui.show('hud'); });
  await sleep(100);
  await page.evaluate(() => { const u = window.__hip.ui; u.toast('Aviso repetido', 'info'); u.toast('Aviso repetido', 'info'); u.toast('Aviso repetido', 'info'); });
  rec('k', 'el mismo texto seguido sale una sola vez', await count() === 1, await count());
  await page.evaluate(() => { const u = window.__hip.ui; for (let i = 1; i <= 5; i++) u.toast('Aviso ' + i, 'mission'); });
  const seq = await count();
  const txt = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));
  rec('k', '5 avisos seguidos dejan ≤ 2 en el DOM (los más recientes)', seq >= 1 && seq <= 2 && txt.includes('Aviso 5'), txt);
  await sleep(1600);
  await page.evaluate(() => { window.__hip.ui.show('pause'); });
  rec('k', 'al abrir la pausa se limpian los avisos', await count() === 0, await count());
  await page.evaluate(() => { const u = window.__hip.ui; u.toast('Sobre la pausa A', 'info'); u.toast('Sobre la pausa B', 'boost'); });
  rec('k', 'con la pausa abierta no entra ningún aviso', await count() === 0, await count());
  await page.evaluate(() => { window.__hip.ui.show('over'); window.__hip.ui.toast('Sobre el fin', 'mission'); });
  rec('k', 'en el fin de partida tampoco', await count() === 0, await count());
  await page.evaluate(() => window.__hip.ui.toast('¡Rango 2: Piloto!', 'mission', { force: true }));
  rec('k', 'el aviso de rango (force) sí sale en el fin de partida', await count() === 1, await count());
  await page.evaluate(() => { window.__hip.ui.show('hud'); window.__hip.ui.toast('Otra vez en juego', 'info'); });
  rec('k', 'al volver al HUD los avisos vuelven', await count() >= 1, await count());
  await sleep(3300);
  const nT = (x) => page.evaluate((x) => [...document.querySelectorAll('.toast')].filter((t) => t.textContent === x).length, x);
  const t0 = await nT('Vuelve a salir');
  await page.evaluate(() => { const u = window.__hip.ui; u.toast('Vuelve a salir', 'mission'); u.toast('Vuelve a salir', 'mission'); });
  const t1 = await nT('Vuelve a salir');
  await sleep(1700);
  await page.evaluate(() => window.__hip.ui.toast('Vuelve a salir', 'mission'));
  const t2 = await nT('Vuelve a salir');
  rec('k', 'el mismo texto se bloquea de inmediato y vuelve a entrar pasado 1,5 s', t0 === 0 && t1 === 1 && t2 >= 1 && t2 !== t1 - 1, { t0, t1, t2 });
  const cnt = await page.evaluate(() => { const before = document.querySelectorAll('.toast').length; return before; });
  await sleep(500);
  await page.evaluate(() => { const u = window.__hip.ui; u.toast('Distinto uno', 'mission'); u.toast('Distinto dos', 'mission'); });
  rec('k', 'dos textos distintos seguidos entran los dos', await nT('Distinto uno') + await nT('Distinto dos') === 2, cnt);
  rec('k', 'sin errores', errors.length === 0, errors.slice(0, 3));
  await page.close();
});

await browser.close();
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
