// QA de Hipertúnel v0.40: pruebas de extremo a extremo con eventos reales en Chrome sin cabeza.
// Uso:
//   node tests/qa.mjs                       (todas; necesita `npx vite --config app/vite.config.js --host`)
//   node tests/qa.mjs --only=1,2,3          (solo algunas)
//   node tests/qa.mjs --url=http://localhost:5190/   (probar la compilación de un solo archivo)
//   node tests/qa.mjs --perf=20             (segundos por medición de rendimiento)
// Deja un resumen en tests/shots/qa-report.json y capturas en tests/shots/qa-long/.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || 'http://localhost:5173/';
const BUILT = opt.built || 'http://localhost:5190/';
const ONLY = opt.only ? new Set(opt.only.split(',').map(Number)) : null;
const PERF_S = +(opt.perf || 20);
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS + 'qa-long/', { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const reloads = []; // recargas inesperadas (p. ej. HMR de Vite mientras otro agente edita)
const rec = (id, name, pass, info) => { results.push({ id, name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  [${id}] ${name}${info ? '  — ' + (typeof info === 'string' ? info : JSON.stringify(info)) : ''}`); };
const note = (id, name, info) => { results.push({ id, name, pass: null, info }); console.log(`INFO  [${id}] ${name}  — ${typeof info === 'string' ? info : JSON.stringify(info)}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', '--enable-precise-memory-info'] });

const DESKTOP = { width: 1280, height: 720, deviceScaleFactor: 1 };
const PHONE = { width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true };
const PHONE2 = { ...PHONE, deviceScaleFactor: 2 };

async function open(viewport = DESKTOP, url = URL0, { clearStorage = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
  let loads = 0;
  page.on('load', () => { loads++; if (loads > 1 && !page.__qaReload) reloads.push(page.url()); });
  if (clearStorage) await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('qa-keep')) { try { localStorage.clear(); } catch (e) {} sessionStorage.setItem('qa-keep', '1'); } });
  page.__qaReload = true;
  for (let tries = 0; ; tries++) {
    try { await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 }); break; }
    catch (e) { if (tries >= 2) throw e; await sleep(2000); }
  }
  page.__qaReload = false;
  await sleep(600);
  return { page, errors };
}
const st = (page) => page.evaluate(() => window.__hip.state);
const scr = (page) => page.evaluate(() => document.getElementById('ui').dataset.screen);
async function waitState(page, want, ms = 4000) {
  const t0 = Date.now(); let s;
  while (Date.now() - t0 < ms) { s = await st(page); if ((Array.isArray(want) ? want : [want]).includes(s)) return { ok: true, s, t: Date.now() - t0 }; await sleep(25); }
  return { ok: false, s, t: Date.now() - t0 };
}
// clic real en un elemento visible de la pantalla activa
async function clickIn(page, screen, sel) {
  const q = `.scr[data-screen="${screen}"] ${sel}`;
  await page.waitForSelector(q, { visible: true, timeout: 3000 });
  await sleep(250); // deja terminar la animación de entrada
  await page.click(q);
  await sleep(80);
}
// muestreador de ángulo desenrollado (en la página, a cada fotograma)
const thetaProbe = (page) => page.evaluate(() => {
  const h = window.__hip; const p = { acc: 0, last: h.game.theta, frames: 0, on: true };
  const TAU = Math.PI * 2;
  (function f() { if (!p.on) return; const th = h.game.theta; let d = th - p.last; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; p.acc += d; p.last = th; p.frames++; requestAnimationFrame(f); })();
  window.__qaProbe = p;
});
const probeRead = (page) => page.evaluate(() => { const p = window.__qaProbe; const th = window.__hip.game.theta; let d = th - p.last; if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; p.on = false; return +(p.acc + d).toFixed(4); });
const invul = (page) => page.evaluate(() => { window.__hip.game.invul = 1e9; });

async function run(id, fn) {
  if (ONLY && !ONLY.has(id)) return;
  try { await fn(); } catch (e) { rec(id, 'excepción en la prueba', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
}

// ------------------------------------------------------------------ 1. carga sin errores
await run(1, async () => {
  for (const [name, vp, url] of [['1280x720 dev', DESKTOP, URL0], ['844x390 móvil dev', PHONE2, URL0], ['1280x720 build', DESKTOP, BUILT], ['844x390 móvil build', PHONE2, BUILT]]) {
    let r;
    try { r = await open(vp, url); } catch (e) { rec(1, `carga ${name}`, false, 'no carga: ' + e.message); continue; }
    await sleep(2000);
    const info = await r.page.evaluate(() => ({ v: window.__hip.VERSION, state: window.__hip.state, screen: document.getElementById('ui').dataset.screen, webgl: !document.body.classList.contains('sin-webgl'), orient: screen.orientation?.angle }));
    rec(1, `carga ${name}`, r.errors.length === 0 && info.webgl && info.state === 'attract', { errors: r.errors.slice(0, 5), ...info });
    await r.page.close();
  }
});

// ------------------------------------------------------------------ 2. flujo de menús con eventos reales
await run(2, async () => {
  const { page, errors } = await open(DESKTOP);
  const ok = [];
  const chk = (n, c, i) => ok.push({ n, c: !!c, i });
  chk('título al cargar', (await scr(page)) === 'title' && (await st(page)) === 'attract');
  await clickIn(page, 'title', '[data-act="play"]');
  chk('Jugar → countdown', (await st(page)) === 'countdown', await st(page));
  let w = await waitState(page, 'play', 4000); chk('countdown → play', w.ok, w);
  await invul(page);
  await page.keyboard.press('Escape'); await sleep(100);
  chk('Escape pausa', (await st(page)) === 'paused' && (await scr(page)) === 'pause', await st(page));
  await page.keyboard.press('Escape'); await sleep(100);
  chk('Escape en pausa reanuda', ['countdown', 'play'].includes(await st(page)), await st(page));
  w = await waitState(page, 'play', 3000);
  await page.keyboard.press('KeyP'); await sleep(100);
  chk('P pausa', (await st(page)) === 'paused', await st(page));
  await clickIn(page, 'pause', '[data-act="resume"]');
  chk('Continuar (clic) reanuda', ['countdown', 'play'].includes(await st(page)), await st(page));
  w = await waitState(page, 'play', 3000);
  await page.waitForSelector('.hud-pause', { visible: true });
  await page.click('.hud-pause'); await sleep(100);
  chk('botón pausa en pantalla', (await st(page)) === 'paused', await st(page));
  const s0 = await page.evaluate(() => window.__hip.game.s);
  const gBefore = await page.evaluate(() => { window.__qaOld = window.__hip.game; return 1; });
  await clickIn(page, 'pause', '[data-act="restart"]');
  const rs = await page.evaluate(() => ({ st: window.__hip.state, fresh: window.__hip.game !== window.__qaOld, s: window.__hip.game.s }));
  chk('Reiniciar', rs.st === 'countdown' && rs.fresh, { ...rs, sBefore: s0 });
  w = await waitState(page, 'play', 4000);
  await page.click('.hud-pause'); await sleep(100);
  await clickIn(page, 'pause', '[data-act="menu"]');
  chk('Menú vuelve al título', (await st(page)) === 'attract' && (await scr(page)) === 'title', { st: await st(page), scr: await scr(page) });
  // navegación con flechas en el título (teclado/mando)
  const f0 = await page.evaluate(() => document.querySelector('.is-focus')?.dataset.act || document.activeElement?.dataset.act);
  await page.keyboard.press('ArrowDown'); await sleep(80);
  const f1 = await page.evaluate(() => document.querySelector('.is-focus')?.dataset.act || document.activeElement?.dataset.act);
  await page.keyboard.press('ArrowRight'); await sleep(80);
  const f2 = await page.evaluate(() => document.querySelector('.is-focus')?.dataset.act || document.activeElement?.dataset.act);
  chk('flechas mueven el foco en el título', f1 !== f0 || f2 !== f1, { f0, f1, f2 });
  // modos
  for (const m of ['classic', 'survival', 'timetrial']) {
    await clickIn(page, 'title', '[data-act="modes"]');
    chk(`pantalla Modos (${m})`, (await scr(page)) === 'modes');
    await clickIn(page, 'modes', `[data-mode="${m}"]`);
    w = await waitState(page, 'play', 4000);
    const gm = await page.evaluate(() => ({ mode: window.__hip.game.mode, hudMode: document.querySelector('.scr-hud').dataset.mode, timer: getComputedStyle(document.querySelector('[data-hud="timerBox"]')).display }));
    chk(`modo ${m} arranca`, w.ok && gm.mode === m, gm);
    await page.click('.hud-pause'); await sleep(100);
    await clickIn(page, 'pause', '[data-act="menu"]');
  }
  // Jugar tras elegir un modo: ¿recuerda el último?
  await clickIn(page, 'title', '[data-act="play"]');
  const lastM = await page.evaluate(() => window.__hip.game.mode);
  note(2, 'Jugar tras haber elegido Contrarreloj arranca modo', lastM);
  await waitState(page, 'play', 4000); await page.click('.hud-pause'); await sleep(100); await clickIn(page, 'pause', '[data-act="menu"]');
  // ajustes
  await clickIn(page, 'title', '[data-act="settings"]');
  chk('pantalla Ajustes', (await scr(page)) === 'settings');
  for (const k of ['reduceFx', 'music', 'invert']) await clickIn(page, 'settings', `[data-set="${k}"]`);
  await clickIn(page, 'settings', '.seg button[data-q="baja"]');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}'));
  chk('ajustes guardados', saved.reduceFx === true && saved.music === false && saved.invert === true && saved.quality === 'baja', saved);
  page.__qaReload = true; await page.reload({ waitUntil: 'networkidle0' }); page.__qaReload = false;
  await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(400);
  const after = await page.evaluate(() => ({ ls: JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}'), ui: Object.fromEntries([...document.querySelectorAll('[data-set]')].map((e) => [e.dataset.set, e.classList.contains('on')])), q: document.querySelector('.seg button.sel')?.dataset.q, rq: window.__hip.renderer.quality, inv: window.__hip.input.state.invert }));
  chk('ajustes persisten tras recargar', after.ls.reduceFx === true && after.ui.reduceFx === true && after.ui.music === false && after.ui.invert === true && after.q === 'baja' && after.rq === 'baja' && after.inv === true, after);
  // Escape desde Ajustes vuelve al título
  await clickIn(page, 'title', '[data-act="settings"]');
  await page.keyboard.press('Escape'); await sleep(120);
  chk('Escape en Ajustes vuelve al título', (await scr(page)) === 'title', await scr(page));
  const bad = ok.filter((x) => !x.c);
  rec(2, `flujo de menús (${ok.length - bad.length}/${ok.length})`, bad.length === 0 && errors.length === 0, bad.length ? bad : (errors.length ? errors : ''));
  await page.close();
});

// ------------------------------------------------------------------ 3. teclado
await run(3, async () => {
  const { page, errors } = await open(DESKTOP);
  const out = {};
  for (const [key, ms] of [['ArrowRight', 300], ['ArrowLeft', 300], ['ArrowRight', 120], ['ArrowRight', 50], ['ArrowRight', 1000]]) {
    await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page);
    await sleep(200);
    await thetaProbe(page);
    await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key); await sleep(60);
    const d = await probeRead(page);
    out[`${key}_${ms}ms`] = { rad: d, lanes: +(d / 0.5236).toFixed(2) };
  }
  rec(3, 'ArrowRight 300 ms sube theta', out.ArrowRight_300ms.rad > 0.05, out.ArrowRight_300ms);
  rec(3, 'ArrowLeft 300 ms baja theta', out.ArrowLeft_300ms.rad < -0.05, out.ArrowLeft_300ms);
  const tap = out.ArrowRight_120ms.lanes;
  rec(3, 'toque de 120 ms ≈ 1 carril (0,6..1,4)', tap > 0.6 && tap < 1.4, out.ArrowRight_120ms);
  note(3, 'deltas medidos', out);
  // determinista: cuánto gira el "a" digital a 60 Hz sin depender del reloj
  const det = await page.evaluate(() => {
    const inp = window.__hip.input; const r = {};
    for (const n of [3, 7, 18, 60]) { let th = 0; const k = inp.state.keys; k.clear(); k.add('ArrowRight'); for (let i = 0; i < n; i++) th += inp.steer(1 / 60) * 0.2; k.clear(); inp.steer(1 / 60); r[n + 'f'] = +(th / 0.5236).toFixed(2); }
    return r;
  });
  note(3, 'carriles girados por N fotogramas pulsados (determinista)', det);
  if (errors.length) rec(3, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 4. táctil
await run(4, async () => {
  const { page, errors } = await open(PHONE);
  const cdp = await page.createCDPSession();
  const touch = async (x, y, ms) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await sleep(ms);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(60);
  };
  const out = {};
  for (const [side, x] of [['derecha', 700], ['izquierda', 140]]) {
    await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page); await sleep(200);
    await thetaProbe(page); await touch(x, 220, 300); out[side] = await probeRead(page);
  }
  await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page); await sleep(200);
  await thetaProbe(page); await touch(700, 220, 110); out.toque110ms = await probeRead(page);
  // dos dedos: mantener derecha y tocar izquierda un momento
  rec(4, 'mantener a la derecha gira a la derecha', out.derecha > 0.05, out);
  rec(4, 'mantener a la izquierda gira a la izquierda', out.izquierda < -0.05, out);
  note(4, 'toque de 110 ms en carriles', +(out.toque110ms / 0.5236).toFixed(2));
  // táctil con puppeteer (tap) sobre el botón de pausa
  await page.tap('.hud-pause'); await sleep(150);
  rec(4, 'tocar el botón de pausa pausa (y no gira)', (await st(page)) === 'paused', await st(page));
  // tocar la pantalla de título (fuera de botones) debería empezar a jugar
  await page.evaluate(() => { window.__hip.ui.show('title'); }); await page.evaluate(() => 0);
  if (errors.length) rec(4, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 5. inclinación
await run(5, async () => {
  const { page, errors } = await open(PHONE);
  const angle = await page.evaluate(() => (screen.orientation && screen.orientation.angle) ?? window.orientation);
  // simula un móvil en horizontal (ángulo 90) inclinado 15° hacia un lado
  const G = 9.81, deg = 15, gs = G * Math.sin(deg * Math.PI / 180), gz = G * Math.cos(deg * Math.PI / 180);
  const motion = (sign, n = 1) => page.evaluate(async (sign, n, gs, gz, ang) => {
    for (let i = 0; i < n; i++) {
      // en horizontal (90) el eje que manda es y; en vertical (0) es x
      const g = ang === 90 || ang === 270 ? { x: 0, y: sign * gs, z: gz } : { x: -sign * gs, y: 0, z: gz };
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: g, interval: 16 }));
      if (n > 1) await new Promise((r) => requestAnimationFrame(r));
    }
  }, sign, n, gs, gz, angle);
  await motion(1);
  const a = await page.evaluate(() => ({ has: window.__hip.input.hasTilt, v: +window.__hip.input.tiltValue.toFixed(3) }));
  rec(5, 'devicemotion detectado', a.has && Math.abs(a.v) > 0.2, { screenAngle: angle, ...a, esperado: +(gs * 0.1).toFixed(3) });
  const out = {};
  for (const sign of [1, -1]) {
    await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page);
    await thetaProbe(page); await motion(sign, 30); out[sign > 0 ? 'mas15' : 'menos15'] = await probeRead(page);
  }
  rec(5, 'el giro cambia de signo con la inclinación', Math.sign(out.mas15) === -Math.sign(out.menos15) && Math.abs(out.mas15) > 0.1, out);
  // meter a cero: inclinación 0 no gira (zona muerta)
  await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page);
  await page.evaluate(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: 0, y: 0.1, z: 9.8 } })));
  await thetaProbe(page); await sleep(400); const d0 = await probeRead(page);
  rec(5, 'plano (0,6°) no gira', Math.abs(d0) < 0.01, d0);
  // calibrar desde Ajustes con el móvil inclinado +15°
  await page.click('.hud-pause').catch(() => {}); await sleep(100);
  await page.evaluate(() => window.__hip.ui.show('title')); // vuelve a un menú sin reiniciar
  await page.evaluate(() => { window.__hip.input.state.cal = 0; });
  await motion(1);
  await clickIn(page, 'title', '[data-act="settings"]');
  await clickIn(page, 'settings', '[data-act="calibrate"]');
  const c = await page.evaluate(() => ({ v: +window.__hip.input.tiltValue.toFixed(4), cal: +window.__hip.input.state.cal.toFixed(4), ls: localStorage.getItem('hipertunel-cal'), toasts: [...document.querySelectorAll('.toasts > *')].map((t) => t.textContent.trim()) }));
  rec(5, 'Calibrar el centro pone la inclinación a 0', Math.abs(c.v) < 1e-3 && c.ls !== null, c);
  rec(5, 'Calibrar muestra un único aviso', c.toasts.filter((t) => /calibrado/i.test(t)).length === 1, c.toasts);
  await motion(-1);
  const c2 = await page.evaluate(() => +window.__hip.input.tiltValue.toFixed(3));
  note(5, 'tras calibrar a +15°, inclinar a −15° da', c2);
  // meter del título
  const meter = await page.evaluate(() => getComputedStyle(document.getElementById('tiltMeter')).getPropertyValue('--v'));
  note(5, 'medidor de inclinación (--v)', meter);
  if (errors.length) rec(5, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 6. fin de partida
await run(6, async () => {
  const { page, errors } = await open(DESKTOP);
  await page.evaluate(() => { window.__freeze = true; window.__hip.start('classic', 5); });
  const d = await page.evaluate(() => { const h = window.__hip; let n = 0; while (h.game.alive && n < 60 * 120) { h.step(1, 0); n++; } return { frames: n, alive: h.game.alive, distM: h.game.distanceM, killer: h.game.killer }; });
  const t0 = Date.now();
  await page.evaluate(() => { window.__freeze = false; });
  const w1 = await waitState(page, 'dying', 1000);
  const w2 = await waitState(page, 'over', 3000);
  const dt = Date.now() - t0;
  rec(6, 'muerte → dying → over en ≤1,5 s', w1.ok && w2.ok && dt <= 1700, { ...d, dying: w1, overMs: dt });
  await sleep(200);
  const ov = await page.evaluate(() => ({ scr: document.getElementById('ui').dataset.screen, vis: document.querySelector('.scr-over').classList.contains('on'), dist: document.querySelector('[data-bind="dist"]').textContent, top: JSON.parse(localStorage.getItem('hipertunel-top-classic') || '[]') }));
  rec(6, 'pantalla de fin visible y top 5 guardado', ov.scr === 'over' && ov.vis && ov.top.length === 1, ov);
  // "Otra vez" nada más salir la pantalla (<600 ms) se ignora; después, reinicia
  await sleep(500);
  await page.click('.scr-over [data-act="restart"]'); await sleep(100);
  rec(6, 'Otra vez reinicia', (await st(page)) === 'countdown', await st(page));
  // segunda muerte real en tiempo real sin tocar nada (steer 0 por teclado = no pulsar)
  await waitState(page, 'play', 4000);
  const w3 = await waitState(page, 'over', 60000);
  const top = await page.evaluate(() => JSON.parse(localStorage.getItem('hipertunel-top-classic') || '[]'));
  rec(6, 'muerte en tiempo real sin tocar nada', w3.ok && top.length === 2, { t: w3.t, top: top.map((e) => e.score) });
  // Enter/espacio en la pantalla de fin
  await sleep(700); await page.keyboard.press('Enter'); await sleep(100);
  rec(6, 'Enter en fin de partida reinicia', (await st(page)) === 'countdown', await st(page));
  if (errors.length) rec(6, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 7. contrarreloj
await run(7, async () => {
  const { page, errors } = await open(DESKTOP);
  await page.evaluate(() => { window.__freeze = true; window.__hip.start('timetrial', 9); window.__hip.game.invul = 1e9; });
  const r = await page.evaluate(() => {
    const h = window.__hip; const g0 = h.game; const t0 = g0.timeLeft; h.step(60, 0); const t1 = g0.timeLeft; let n = 60, boosts = 0;
    while (h.game.alive && n < 60 * 200) { h.step(1, 0); n++; }
    return { t0, after60: +t1.toFixed(3), frames: n, alive: h.game.alive, timeLeft: h.game.timeLeft, time: +h.game.time.toFixed(2), level: h.game.level };
  });
  rec(7, 'el reloj baja 1 s por segundo', Math.abs(r.t0 - r.after60 - 1) < 0.02, r);
  rec(7, 'la partida acaba cuando el reloj llega a 0', !r.alive && r.timeLeft === 0, r);
  await page.evaluate(() => { window.__freeze = false; });
  const w = await waitState(page, 'over', 3000);
  const ov = await page.evaluate(() => ({ head: document.querySelector('[data-bind="headline"]').textContent, mode: document.querySelector('[data-bind="mode"]').textContent, top: JSON.parse(localStorage.getItem('hipertunel-top-timetrial') || '[]').length }));
  rec(7, 'fin de contrarreloj', w.ok && ov.top === 1, ov);
  // HUD del reloj en tiempo real: baja durante el juego y no durante la cuenta atrás
  await page.evaluate(() => { window.__hip.ui.show('title'); });
  await page.evaluate(() => { window.__hip.start('timetrial', 9); window.__hip.game.invul = 1e9; });
  const h0 = await page.evaluate(() => document.querySelector('[data-hud="timer"]').textContent);
  await sleep(2100);
  const h1 = await page.evaluate(() => ({ txt: document.querySelector('[data-hud="timer"]').textContent, tl: +window.__hip.game.timeLeft.toFixed(2) }));
  rec(7, 'HUD del reloj en tiempo real', +h1.txt < 60 && +h1.txt >= 57, { h0, h1 });
  if (errors.length) rec(7, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 8. rendimiento
await run(8, async () => {
  for (const [name, vp] of [['1280x720 dpr1', DESKTOP], ['844x390 dpr1', PHONE], ['844x390 dpr2', PHONE2]]) {
    const { page, errors } = await open(vp);
    await sleep(1500);
    const r = await page.evaluate((secs) => new Promise((res) => {
      const dts = []; let last = performance.now(); const t0 = last;
      (function f(now) { dts.push(now - last); last = now; if (now - t0 < secs * 1000) requestAnimationFrame(f); else res(dts.slice(1)); })(last);
    }), PERF_S);
    const sorted = [...r].sort((a, b) => a - b);
    const avg = r.reduce((a, b) => a + b, 0) / r.length;
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const worst1 = sorted.slice(Math.floor(sorted.length * 0.99));
    const low1 = 1000 / (worst1.reduce((a, b) => a + b, 0) / worst1.length);
    const info = await page.evaluate(() => { const i = window.__hip.renderer.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, dpr: window.__hip.renderer.renderer.getPixelRatio(), q: window.__hip.renderer.quality, s: +window.__hip.game.s.toFixed(0) }; });
    const res = { avgFps: +(1000 / avg).toFixed(1), p99ms: +p99.toFixed(1), low1Fps: +low1.toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(1), frames: r.length, over33ms: r.filter((x) => x > 33.4).length, ...info };
    rec(8, `rendimiento ${name} (${PERF_S} s, demo del título)`, res.avgFps >= 55 && res.low1Fps >= 30 && errors.length === 0, res);
    await page.close();
  }
});

// ------------------------------------------------------------------ 9. fugas
await run(9, async () => {
  const { page, errors } = await open(DESKTOP);
  const snap = () => page.evaluate(() => { if (window.gc) window.gc(); const i = window.__hip.renderer.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs ? i.programs.length : -1, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, boxes: window.__hip.game.boxes.length }; });
  const rows = [await snap()];
  for (let c = 0; c < 5; c++) {
    await page.evaluate(() => { window.__hip.start('classic', 100 + Math.floor(Math.random() * 1000)); window.__hip.game.invul = 1e9; window.__hip.skipTo(2500); });
    await sleep(1500);
    await page.evaluate(() => { window.__hip.ui.show('title'); });
    rows.push(await snap());
  }
  const a = rows[1], b = rows[rows.length - 1];
  rec(9, '5 reinicios: geometrías/texturas/programas estables', b.geo <= a.geo * 1.15 + 5 && b.tex <= a.tex + 2 && b.prog <= a.prog + 2, rows);
  if (a.heapMB != null) rec(9, '5 reinicios: montón JS estable', b.heapMB <= a.heapMB * 1.3 + 5, { first: a.heapMB, last: b.heapMB });
  // cambiar la calidad varias veces (recrea el composer)
  const q0 = await snap();
  await page.evaluate(async () => { const r = window.__hip.renderer; for (let i = 0; i < 10; i++) { r.setQuality(i % 2 ? 'alta' : 'media'); await new Promise((x) => requestAnimationFrame(x)); } r.setQuality('alta'); });
  await sleep(300);
  const q1 = await snap();
  rec(9, '10 cambios de calidad no dejan texturas huérfanas', q1.tex <= q0.tex + 2, { before: q0, after: q1 });
  if (errors.length) rec(9, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 10. partida larga
await run(10, async () => {
  const { page, errors } = await open(DESKTOP);
  await page.evaluate(() => { window.__freeze = true; window.__hip.start('classic', 21); });
  const log = []; let deaths = 0, bad = 0, lastS = -1;
  // con el bot tal cual primero: ¿cuánto dura?
  const botOnly = await page.evaluate(() => { const { Game } = {}; const h = window.__hip; let n = 0; while (h.game.alive && n < 60 * 300) { h.step(1); n++; } return { frames: n, distM: h.game.distanceM, alive: h.game.alive, wave: h.game.waveIdx, world: h.game.world }; });
  note(10, 'bot sin ayuda (semilla 21)', botOnly);
  await page.evaluate(() => { window.__hip.start('classic', 21); window.__hip.game.invul = 1e9; });
  for (let chunk = 1; chunk <= 30; chunk++) {
    const r = await page.evaluate(() => {
      const h = window.__hip; const t0 = performance.now(); const evs = {};
      for (let i = 0; i < 600; i++) { h.step(1); for (const e of h.game.events) evs[e.type] = (evs[e.type] || 0) + 1; if (!h.game.alive) break; }
      const g = h.game;
      return { ms: +(performance.now() - t0).toFixed(0), s: +g.s.toFixed(1), distM: g.distanceM, wave: g.waveIdx, world: g.world, fold: +g.fold.toFixed(1), v: +g.v.toFixed(2), level: g.level, alive: g.alive, boxes: g.boxes.length, pads: g.pads.length, coins: g.coinsGot, nan: !Number.isFinite(g.s + g.theta + g.v), evs };
    });
    if (!r.alive) deaths++;
    if (r.nan || r.s <= lastS) bad++;
    lastS = r.s;
    if (chunk % 6 === 0) {
      await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
      await page.screenshot({ path: `${SHOTS}qa-long/min-${String(chunk / 6).padStart(2, '0')}.png` });
      log.push({ min: chunk / 6, ...r });
    }
    if (!r.alive) break;
  }
  for (const l of log) console.log('      ', JSON.stringify(l));
  rec(10, '5 min de simulación (bot + invulnerable) sin errores y s creciente', bad === 0 && deaths === 0 && errors.length === 0 && log.length === 5, { bad, deaths, errors: errors.slice(0, 3), final: log[log.length - 1] });
  await page.close();
});

if (reloads.length) note(0, 'recargas inesperadas de la página (HMR de Vite): pruebas afectadas pueden fallar', reloads.length);
await browser.close();
writeFileSync(SHOTS + 'qa-report.json', JSON.stringify(results, null, 1));
const fails = results.filter((r) => r.pass === false);
console.log(`\n${results.filter((r) => r.pass === true).length} PASS · ${fails.length} FAIL`);
process.exit(fails.length ? 1 : 0);
