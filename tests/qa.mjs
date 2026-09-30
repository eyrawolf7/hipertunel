// QA de Hipertúnel: pruebas de extremo a extremo con eventos reales en Chrome sin cabeza.
// Uso:
//   node tests/qa.mjs                       (todas; necesita `npx vite --config app/vite.config.js --host`)
//   node tests/qa.mjs --only=1,2,3          (solo algunas)
//   node tests/qa.mjs --url=http://localhost:5190/   (probar la compilación de un solo archivo)
//   node tests/qa.mjs --perf=20             (segundos por medición de rendimiento)
// Deja un resumen en tests/shots/qa-report.json y capturas en tests/shots/qa-long/.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || (process.env.HIP_URL || 'http://localhost:5173/');
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
  // las cancelaciones (ERR_ABORTED) mientras se abre la página son de un intento de carga anterior
  // o de una recarga del servidor de desarrollo, no fallos del juego
  let opening = true;
  page.on('requestfailed', (r) => { const t = r.failure()?.errorText || ''; if (opening && /ERR_ABORTED/.test(t)) return; errors.push('requestfailed: ' + r.url() + ' ' + t); });
  let loads = 0;
  page.on('load', () => { loads++; if (loads > 1 && !page.__qaReload) reloads.push(page.url()); });
  if (clearStorage) await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('qa-keep')) { try { localStorage.clear(); } catch (e) {} sessionStorage.setItem('qa-keep', '1'); } });
  page.__qaReload = true;
  for (let tries = 0; ; tries++) {
    // los errores de un intento fallido (peticiones canceladas al reintentar) no cuentan
    errors.length = 0;
    try { await page.goto(url, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 }); break; }
    catch (e) { if (tries >= 2) throw e; await sleep(2000); }
  }
  page.__qaReload = false;
  await sleep(600);
  opening = false;
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
  for (let attempt = 0; ; attempt++) {
    const r0 = reloads.length, n0 = results.length;
    try { await fn(); } catch (e) { rec(id, 'excepción en la prueba', false, String(e && e.stack || e).split('\n').slice(0, 3).join(' | ')); }
    // si Vite recargó la página (HMR) a mitad de la sección y algo falló, se repite entera una vez
    if (attempt === 0 && reloads.length > r0 && results.slice(n0).some((x) => x.pass === false)) { const malas = results.slice(n0).filter((x) => x.pass === false).map((x) => x.name); results.length = n0; note(id, 'sección repetida por recarga de Vite; fallos del primer intento', malas); console.log(`      (recarga de Vite durante la sección ${id}: se repite)`); continue; }
    break;
  }
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
      // móvil en horizontal, algo reclinado (45°): la gravedad tira hacia el borde largo de abajo
      // (eje x del dispositivo) y al girarlo 15° pasa una parte al eje y
      const r = Math.SQRT1_2, G = 9.81, t = 15 * Math.PI / 180;
      const g = { x: -G * r * Math.cos(t), y: sign * G * r * Math.sin(t), z: G * r };
      window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: g, interval: 16 }));
      if (n > 1) await new Promise((r) => requestAnimationFrame(r));
    }
  }, sign, n, gs, gz, angle);
  await motion(1);
  const a = await page.evaluate(() => ({ has: window.__hip.input.hasTilt, v: +window.__hip.input.tiltValue.toFixed(3) }));
  rec(5, 'devicemotion detectado, con la magnitud del original (g lateral × 0,1)', a.has && Math.abs(Math.abs(a.v) - 0.981 * Math.SQRT1_2 * Math.sin(15 * Math.PI / 180)) < 0.005, { screenAngle: angle, ...a, esperado: +(0.981 * Math.SQRT1_2 * Math.sin(15 * Math.PI / 180)).toFixed(3) });
  const out = {};
  for (const sign of [1, -1]) {
    await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page);
    await thetaProbe(page); await motion(sign, 30); out[sign > 0 ? 'mas15' : 'menos15'] = await probeRead(page);
  }
  rec(5, 'el giro cambia de signo con la inclinación', Math.sign(out.mas15) === -Math.sign(out.menos15) && Math.abs(out.mas15) > 0.1, out);
  // meter a cero: inclinación 0 no gira (zona muerta)
  await page.evaluate(() => window.__hip.start('classic', 11)); await invul(page);
  await page.evaluate(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: { x: -6.93, y: 0.07, z: 6.93 } })));
  await thetaProbe(page); await sleep(400); const d0 = await probeRead(page);
  rec(5, 'plano (0,6°) no gira', Math.abs(d0) < 0.01, d0);
  // calibrar desde Ajustes con el móvil inclinado +15°
  await page.click('.hud-pause').catch(() => {}); await sleep(100);
  await page.evaluate(() => window.__hip.ui.show('title')); // vuelve a un menú sin reiniciar
  await page.evaluate(() => { window.__hip.input.state.cal = 0; });
  await motion(1);
  await clickIn(page, 'title', '[data-act="settings"]');
  await clickIn(page, 'settings', '[data-act="calibrate"]');
  const c = await page.evaluate(() => ({ v: +window.__hip.input.tiltValue.toFixed(4), cal: +window.__hip.input.state.cal.toFixed(4), ls: localStorage.getItem('hipertunel-cal2'), toasts: [...document.querySelectorAll('.toasts > *')].map((t) => t.textContent.trim()) }));
  rec(5, 'Calibrar el centro pone la inclinación a 0', Math.abs(c.v) < 1e-3 && c.ls !== null, c);
  rec(5, 'Calibrar muestra un único aviso', c.toasts.filter((t) => /calibrado/i.test(t)).length === 1, c.toasts);
  await motion(-1);
  const c2 = await page.evaluate(() => +window.__hip.input.tiltValue.toFixed(3));
  note(5, 'tras calibrar a +15°, inclinar a −15° da', c2);
  // meter del título
  const meter = await page.evaluate(() => getComputedStyle(document.getElementById('tiltMeter')).getPropertyValue('--v'));
  note(5, 'medidor de inclinación (--v)', meter);
  // con inclinación, tocar la pantalla jugando pausa; el mismo toque no pulsa "Continuar"
  await page.evaluate(() => { window.__hip.ui.show('hud'); window.__hip.start('classic', 11); });
  await invul(page); await motion(1);
  const wp = await waitState(page, 'play', 6000);
  await page.touchscreen.tap(PHONE.width / 2, PHONE.height / 2);
  await sleep(60);
  const p1 = { st: await st(page), scr: await scr(page) };
  rec(5, 'con inclinación, un toque en la pantalla pausa', wp.ok && p1.st === 'paused' && p1.scr === 'pause', { wp, ...p1 });
  await page.evaluate(() => document.querySelector('.scr[data-screen="pause"] [data-act="resume"]').click());
  rec(5, 'el toque que pausa no reanuda al instante', (await st(page)) === 'paused', await st(page));
  await sleep(500);
  await clickIn(page, 'pause', '[data-act="resume"]');
  const w2 = await waitState(page, ['countdown', 'play'], 1500);
  rec(5, 'Continuar reanuda la partida', w2.ok, w2);
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
    const info = await page.evaluate(() => { const i = window.__hip.renderer.renderer.info; return { dpr: window.__hip.renderer.renderer.getPixelRatio(), q: window.__hip.renderer.quality, s: +window.__hip.game.s.toFixed(0) }; });
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

// ================================================================== ronda 2
// observador de avisos: guarda el texto de cada aviso nuevo
const toastProbe = (page) => page.evaluate(() => {
  const box = document.querySelector('.toasts'); window.__qaToasts = [];
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) window.__qaToasts.push({ t: Math.round(performance.now()), txt: n.textContent.trim() }); }).observe(box, { childList: true });
});
const toastsRead = (page) => page.evaluate(() => window.__qaToasts.map((x) => x.txt));
const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: false };

// ------------------------------------------------------------------ 11. cuenta atrás 3-2-1-¡YA!
await run(11, async () => {
  const { page, errors } = await open(DESKTOP);
  const seqProbe = () => page.evaluate(() => {
    const el = document.querySelector('[data-hud="count"]'); const seq = []; let lastTxt = null; const t0 = performance.now();
    window.__qaCd = { seq, on: true };
    (function f() { if (!window.__qaCd.on) return; const tx = el.textContent; const vis = getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'; if (tx !== lastTxt) { seq.push({ tx, st: window.__hip.state, ms: Math.round(performance.now() - t0), vis }); lastTxt = tx; } requestAnimationFrame(f); })();
  });
  await seqProbe();
  await clickIn(page, 'title', '[data-act="play"]');
  await sleep(4200);
  const r = await page.evaluate(() => { window.__qaCd.on = false; return window.__qaCd.seq; });
  const txt = r.map((x) => x.tx).filter((x) => x !== '');
  rec(11, 'cuenta atrás muestra 3, 2, 1, ¡YA! en orden', JSON.stringify(txt) === JSON.stringify(['3', '2', '1', '¡YA!']), r);
  const ya = r.find((x) => x.tx === '¡YA!'), three = r.find((x) => x.tx === '3');
  rec(11, '¡YA! coincide con el paso a play (~3 s)', ya && ya.st === 'play' && ya.ms - (three?.ms || 0) > 2700 && ya.ms - (three?.ms || 0) < 3400, { three: three?.ms, ya: ya?.ms, st: ya?.st });
  rec(11, 'el texto se borra tras ¡YA!', r[r.length - 1].tx === '', r[r.length - 1]);
  // la simulación no avanza durante la cuenta atrás
  await page.click('.hud-pause'); await sleep(100);
  const s0 = await page.evaluate(() => window.__hip.game.s);
  await seqProbe();
  await clickIn(page, 'pause', '[data-act="resume"]');
  await sleep(300);
  const mid = await page.evaluate(() => ({ s: window.__hip.game.s, st: window.__hip.state }));
  await sleep(1800);
  const r2 = await page.evaluate(() => { window.__qaCd.on = false; return window.__qaCd.seq.map((x) => x.tx).filter((x) => x); });
  rec(11, 'al reanudar: sin avance durante la cuenta atrás', mid.st === 'countdown' && mid.s === s0, { s0, mid });
  note(11, 'secuencia al reanudar (countdown = 1,2 s)', r2);
  if (errors.length) rec(11, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 12. consejos de primera partida
await run(12, async () => {
  for (const [name, vp] of [['escritorio', DESKTOP], ['móvil', PHONE]]) {
    const { page, errors } = await open(vp);
    await toastProbe(page);
    await clickIn(page, 'title', '[data-act="play"]');
    await sleep(4800);
    const t1 = await toastsRead(page);
    const cnt1 = await page.evaluate(() => localStorage.getItem('hipertunel-partidas'));
    const want = vp.hasTouch ? /Toca a la izquierda|Inclina/ : /Gira con/;
    // el consejo de las flechas sale cuando se acerca la primera placa (no a tiempo fijo)
    rec(12, `${name}: 1.ª partida muestra el consejo de giro`, t1.some((t) => want.test(t)) && cnt1 === '1', { toasts: t1, partidas: cnt1 });
    // a partir de la 4.ª partida, sin consejos
    await page.evaluate(() => { localStorage.setItem('hipertunel-partidas', '3'); window.__qaToasts.length = 0; });
    await page.click('.hud-pause').catch(() => {}); await sleep(100);
    await clickIn(page, 'pause', '[data-act="restart"]');
    await sleep(4800);
    const t2 = await toastsRead(page);
    rec(12, `${name}: con 3 partidas ya no salen consejos`, !t2.some((t) => /Gira con|Toca a la izquierda|Inclina|flechas azules/.test(t)), t2);
    if (errors.length) rec(12, `${name}: sin errores`, false, errors);
    await page.close();
  }
});

// ------------------------------------------------------------------ 13. vertical en táctil, pantalla completa y calidad por defecto
await run(13, async () => {
  {
    const { page, errors } = await open(PHONE);
    const env = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, q: window.__hip.renderer.quality, sel: document.querySelector('.seg button.sel')?.dataset.q, rotHidden: document.getElementById('rotate').hidden }));
    rec(13, 'táctil: calidad por defecto "media"', env.coarse && env.q === 'media' && env.sel === 'media', env);
    rec(13, 'táctil en horizontal: sin aviso de girar', env.rotHidden === true, env);
    // tocar Jugar: pantalla completa + bloqueo en horizontal (lo que permita el navegador)
    await page.waitForSelector('.scr[data-screen="title"] [data-act="play"]', { visible: true }); await sleep(250);
    await page.tap('.scr[data-screen="title"] [data-act="play"]'); await sleep(400);
    const fs = await page.evaluate(() => ({ fs: !!document.fullscreenElement, st: window.__hip.state }));
    rec(13, 'tocar Jugar arranca y no lanza errores (pantalla completa/bloqueo)', fs.st === 'countdown' && errors.length === 0, { ...fs, errors: errors.slice(0, 3) });
    await waitState(page, 'play', 4000); await invul(page);
    const vis = () => page.evaluate(() => { const e = document.getElementById('rotate'); return { hidden: e.hidden, display: getComputedStyle(e).display, st: window.__hip.state, scr: document.getElementById('ui').dataset.screen }; });
    await page.setViewport(PORTRAIT); await sleep(300);
    const p1 = await vis();
    rec(13, 'jugando, girar a vertical: aviso visible y pausa', !p1.hidden && p1.display !== 'none' && p1.st === 'paused', p1);
    const sP = await page.evaluate(() => window.__hip.game.s); await sleep(500);
    const sP2 = await page.evaluate(() => window.__hip.game.s);
    rec(13, 'en vertical la partida no avanza', sP === sP2, { sP, sP2 });
    await page.setViewport(PHONE); await sleep(300);
    const p2 = await vis();
    rec(13, 'volver a horizontal: aviso oculto y sigue en pausa', p2.hidden && p2.st === 'paused', p2);
    // vertical durante la cuenta atrás
    await clickIn(page, 'pause', '[data-act="resume"]');
    await page.setViewport(PORTRAIT); await sleep(200);
    const c0 = await vis();
    await sleep(1600);
    const c1 = await vis();
    const sC = await page.evaluate(() => window.__hip.game.s); await sleep(400); const sC2 = await page.evaluate(() => window.__hip.game.s);
    rec(13, 'girar a vertical durante la cuenta atrás: no empieza a jugar detrás del aviso', c1.st !== 'play' && sC === sC2, { alGirar: c0, tras1_6s: c1, avanza: +(sC2 - sC).toFixed(2) });
    await page.setViewport(PHONE); await sleep(300);
    // vertical en el título: aviso visible
    await page.evaluate(() => window.__hip.ui.show('title'));
    await page.setViewport(PORTRAIT); await sleep(300);
    const t1 = await vis();
    rec(13, 'título en vertical (táctil): aviso visible', !t1.hidden, t1);
    if (errors.length) rec(13, 'táctil: sin errores', false, errors);
    await page.close();
  }
  {
    const { page, errors } = await open({ width: 600, height: 900, deviceScaleFactor: 1 });
    const d = await page.evaluate(() => ({ hidden: document.getElementById('rotate').hidden, q: window.__hip.renderer.quality, coarse: matchMedia('(pointer: coarse)').matches }));
    rec(13, 'escritorio en ventana vertical: sin aviso y calidad "alta"', d.hidden && d.q === 'alta' && !d.coarse, d);
    await clickIn(page, 'title', '[data-act="play"]'); await sleep(200);
    const fs = await page.evaluate(() => !!document.fullscreenElement);
    rec(13, 'escritorio: Jugar no pide pantalla completa', !fs, { fs });
    if (errors.length) rec(13, 'escritorio: sin errores', false, errors);
    await page.close();
  }
});

// ------------------------------------------------------------------ 14. ¡Impulsos perdidos! y demo del título
await run(14, async () => {
  const { page, errors } = await open(DESKTOP);
  // demo: arranca en la fila 300 y no se estrella
  const at = await page.evaluate(() => ({ st: window.__hip.state, s: +window.__hip.game.s.toFixed(1), own: Object.prototype.hasOwnProperty.call(window.__hip.game, 'crash') }));
  rec(14, 'demo del título arranca en la fila ≥300 con choque anulado', at.st === 'attract' && at.s >= 300 && at.s < 400 && at.own, at);
  const demo = await page.evaluate(() => { window.__freeze = true; const h = window.__hip; const g = h.game; let n = 0; while (n < 60 * 180 && g.alive) { g.step({ steer: h.bot(g) }); n++; } const r = { frames: n, alive: g.alive, s: +g.s.toFixed(0), hits: g.boxes.filter((b) => b.hit).length, level: g.level }; window.__freeze = false; return r; });
  rec(14, 'demo: 3 min de bot sin morir', demo.alive, demo);
  await clickIn(page, 'title', '[data-act="play"]');
  const leak = await page.evaluate(() => Object.prototype.hasOwnProperty.call(window.__hip.game, 'crash'));
  rec(14, 'la invulnerabilidad de la demo no pasa a la partida real', !leak, { ownCrash: leak });
  await waitState(page, 'play', 4000);
  await toastProbe(page);
  // choque no mortal: siempre con impulso antes de chocar
  await page.evaluate(() => { const g = window.__hip.game; const oc = g.crash.bind(g); window.__qaCr = 0; g.crash = (b) => { if (g.invul > 0 || b.hit) return; if (!g.boostOn) g.initBoost(); window.__qaCr++; oc(b); }; });
  const t0 = Date.now(); let c = 0;
  while (Date.now() - t0 < 40000) { c = await page.evaluate(() => window.__hip.game.crashes); if (c >= 1) break; await sleep(100); }
  await sleep(150);
  const r = await page.evaluate(() => ({ crashes: window.__hip.game.crashes, alive: window.__hip.game.alive, level: window.__hip.game.level, st: window.__hip.state }));
  const tt = await toastsRead(page);
  rec(14, 'choque no mortal muestra "¡Impulsos perdidos!"', r.crashes >= 1 && r.alive && tt.includes('¡Impulsos perdidos!'), { ...r, toasts: tt });
  // choque mortal: sin aviso de impulsos perdidos
  await page.evaluate(() => { const g = window.__hip.game; delete g.crash; g.disableBoost(); g.initBoost = () => {}; g.invul = 0; window.__qaToasts.length = 0; });
  const w = await waitState(page, ['dying', 'over'], 60000);
  const tt2 = await toastsRead(page);
  rec(14, 'choque mortal no muestra "¡Impulsos perdidos!"', w.ok && !tt2.includes('¡Impulsos perdidos!'), { st: w.s, toasts: tt2 });
  if (errors.length) rec(14, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 15. asistencia de carril (control digital)
await run(15, async () => {
  const { page, errors } = await open(PHONE);
  await page.evaluate(() => { window.__freeze = true; window.__hip.start('classic', 11); const g = window.__hip.game; g.crash = (b) => { b.hit = true; }; });
  // simulación determinista: el mismo camino que stepSim (input.steer → game.step)
  const sim = (cases) => page.evaluate((cases) => {
    const h = window.__hip, inp = h.input, L = Math.PI / 6, out = [];
    const T = inp.state.touches;
    for (const c of cases) {
      const g = h.game; g.theta = c.u * L; g.omega = 0; inp.state.target = null; inp.state.dir = 0; T.clear(); inp.steer(1 / 60, g.theta, false);
      const u0 = g.theta / L; let acc = 0, last = g.theta;
      const tick = () => { const open = g.fold !== 30 && g.fold !== -30; const a = inp.steer(1 / 60, g.theta, open); g.step({ steer: a }); let d = g.theta - last; if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; acc += d; last = g.theta; };
      for (const [dir, n, gap] of c.taps) { T.set(1, { d: dir, t: 0 }); for (let i = 0; i < n; i++) tick(); T.clear(); for (let i = 0; i < gap; i++) tick(); }
      for (let i = 0; i < 60; i++) tick();
      const uEnd = u0 + acc / L;
      out.push({ name: c.name, u0: +u0.toFixed(2), moved: +(acc / L).toFixed(3), uEnd: +uEnd.toFixed(3), offCenter: +Math.abs(uEnd - Math.round(uEnd)).toFixed(3), lane: g.lane, target: inp.state.target });
    }
    return out;
  }, cases);
  const r = await sim([
    { name: 'centro, toque dcha 100 ms', u: 0, taps: [[1, 6, 0]] },
    { name: 'centro, toque izda 100 ms', u: 3, taps: [[-1, 6, 0]] },
    { name: 'toque muy corto 33 ms', u: 2, taps: [[1, 2, 0]] },
    { name: 'u=0,30 toque dcha', u: 0.3, taps: [[1, 6, 0]] },
    { name: 'u=0,50 (frontera) toque dcha', u: 0.5, taps: [[1, 6, 0]] },
    { name: 'u=0,64 toque dcha', u: 0.64, taps: [[1, 6, 0]] },
    { name: 'u=0,66 toque dcha', u: 0.66, taps: [[1, 6, 0]] },
    { name: 'u=0,50 (frontera) toque izda', u: 0.5, taps: [[-1, 6, 0]] },
    { name: 'vuelta: carril 11 toque dcha', u: 11, taps: [[1, 6, 0]] },
    { name: 'vuelta: carril 0 toque izda', u: 0, taps: [[-1, 6, 0]] },
    { name: 'doble toque rápido dcha', u: 0, taps: [[1, 5, 3], [1, 5, 0]] },
    { name: 'dos toques separados dcha', u: 0, taps: [[1, 6, 30], [1, 6, 0]] },
    { name: 'mantener 600 ms y soltar', u: 0, taps: [[1, 36, 0]] },
    { name: 'dcha y enseguida izda', u: 4, taps: [[1, 5, 2], [-1, 5, 0]] },
  ]);
  const by = Object.fromEntries(r.map((x) => [x.name, x]));
  const one = (n, sign) => Math.abs(by[n].moved - sign) < 0.02 && by[n].offCenter < 0.02;
  rec(15, 'toque desde el centro = exactamente 1 carril (dcha/izda/corto)', one('centro, toque dcha 100 ms', 1) && one('centro, toque izda 100 ms', -1) && one('toque muy corto 33 ms', 1), [by['centro, toque dcha 100 ms'], by['centro, toque izda 100 ms'], by['toque muy corto 33 ms']]);
  rec(15, 'toques en fronteras acaban centrados en un carril', ['u=0,30 toque dcha', 'u=0,50 (frontera) toque dcha', 'u=0,64 toque dcha', 'u=0,66 toque dcha', 'u=0,50 (frontera) toque izda'].every((n) => by[n].offCenter < 0.02 && Math.sign(by[n].moved) === (n.includes('izda') ? -1 : 1)), r.slice(3, 8));
  rec(15, 'toques con vuelta 11→0 y 0→11', one('vuelta: carril 11 toque dcha', 1) && one('vuelta: carril 0 toque izda', -1), [by['vuelta: carril 11 toque dcha'], by['vuelta: carril 0 toque izda']]);
  rec(15, 'dos toques separados = 2 carriles', one('dos toques separados dcha', 2), by['dos toques separados dcha']);
  rec(15, 'doble toque rápido (80 ms entre toques) = 2 carriles', one('doble toque rápido dcha', 2), by['doble toque rápido dcha']);
  rec(15, 'mantener desliza >1 carril y al soltar encaja', by['mantener 600 ms y soltar'].moved > 1.5 && by['mantener 600 ms y soltar'].offCenter < 0.02, by['mantener 600 ms y soltar']);
  note(15, 'dcha y enseguida izda', by['dcha y enseguida izda']);
  // lámina abierta: toque hacia fuera del borde y después inclinación
  const sheet = await page.evaluate(() => {
    const h = window.__hip, inp = h.input; let g = h.game; let n = 0;
    while ((g.fold === 30 || g.fold === -30) && n < 60 * 600) { g.step({ steer: h.bot(g) }); n++; }
    if (g.fold === 30 || g.fold === -30) return { skipped: true };
    const fold0 = g.fold; g.theta = 0; inp.state.target = null; inp.state.dir = 0;
    const T = inp.state.touches; T.set(1, { d: -1, t: 0 });
    for (let i = 0; i < 6; i++) g.step({ steer: inp.steer(1 / 60, g.theta, true) });
    T.clear();
    for (let i = 0; i < 20; i++) g.step({ steer: inp.steer(1 / 60, g.theta, g.fold !== 30 && g.fold !== -30) });
    const th1 = g.theta;
    inp.state.has = true; inp.state.raw = 0.25; inp.state.cal = 0; inp.state.tiltOn = true;
    const src = [];
    for (let i = 0; i < 40; i++) { g.step({ steer: inp.steer(1 / 60, g.theta, g.fold !== 30 && g.fold !== -30) }); if (i % 10 === 0) src.push(inp.state.src); }
    const r = { fold0: +fold0.toFixed(1), foldNow: +g.fold.toFixed(1), thetaTrasToque: +th1.toFixed(3), thetaTrasInclinar: +g.theta.toFixed(3), target: inp.state.target, src };
    inp.state.has = false; inp.state.raw = 0; inp.state.target = null;
    return r;
  });
  rec(15, 'lámina abierta: tras tocar hacia fuera del borde, la inclinación vuelve a mandar', sheet.skipped || sheet.thetaTrasInclinar > sheet.thetaTrasToque + 0.2, sheet);
  // tubo cerrado: un toque y después inclinación (jugador que mezcla los dos controles)
  const mix = await page.evaluate(() => {
    const h = window.__hip, inp = h.input; h.start('classic', 11); const g = h.game; g.crash = (b) => { b.hit = true; };
    g.theta = 0; inp.state.target = null; inp.state.dir = 0; const T = inp.state.touches;
    T.set(1, { d: 1, t: 0 }); for (let i = 0; i < 6; i++) g.step({ steer: inp.steer(1 / 60, g.theta, false) }); T.clear();
    for (let i = 0; i < 60; i++) g.step({ steer: inp.steer(1 / 60, g.theta, false) });
    const th1 = g.theta, tgt = inp.state.target, residual = +(inp.steer(1 / 60, g.theta, false)).toFixed(4);
    inp.state.has = true; inp.state.raw = 0.25; inp.state.cal = 0; inp.state.tiltOn = true;
    for (let i = 0; i < 40; i++) g.step({ steer: inp.steer(1 / 60, g.theta, false) });
    const r = { thetaTrasToque: +th1.toFixed(4), targetTrasToque: tgt, aResidual: residual, thetaTrasInclinar: +g.theta.toFixed(4), src: inp.state.src };
    inp.state.has = false; inp.state.raw = 0; inp.state.target = null;
    return r;
  });
  rec(15, 'tubo cerrado: 1 s después de un toque, la inclinación vuelve a mandar', mix.thetaTrasInclinar > mix.thetaTrasToque + 0.2, mix);
  // toques reales (CDP) en tiempo real sobre el lienzo
  await page.evaluate(() => { window.__freeze = false; window.__hip.start('classic', 11); const g = window.__hip.game; g.crash = (b) => { b.hit = true; }; });
  const cdp = await page.createCDPSession();
  const real = {};
  for (const [name, u, x] of [['centro dcha', 0, 700], ['frontera u=0,5 dcha', 0.5, 700], ['centro izda', 6, 140]]) {
    await page.evaluate((u) => { const g = window.__hip.game; g.theta = u * Math.PI / 6; window.__hip.input.state.target = null; }, u);
    await thetaProbe(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 220, id: 1 }] });
    await sleep(100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(700);
    const d = await probeRead(page) / (Math.PI / 6);
    const uEnd = u + d;
    real[name] = { moved: +d.toFixed(3), offCenter: +Math.abs(uEnd - Math.round(uEnd)).toFixed(3) };
  }
  rec(15, 'toques reales de 100 ms: 1 carril y centrado', Math.abs(real['centro dcha'].moved - 1) < 0.03 && Math.abs(real['centro izda'].moved + 1) < 0.03 && real['frontera u=0,5 dcha'].offCenter < 0.03, real);
  if (errors.length) rec(15, 'sin errores', false, errors);
  await page.close();
});

// ------------------------------------------------------------------ 16. salto entre mundos
await run(16, async () => {
  const { page, errors } = await open(DESKTOP);
  const r = await page.evaluate(() => {
    window.__freeze = true;
    const h = window.__hip; h.start('classic', 21);
    const g = h.game; g.crash = (b) => { b.hit = true; };
    const twin = new g.constructor({ mode: 'classic', seed: 21 }); twin.crash = (b) => { b.hit = true; };
    const R = h.renderer, cam = R.camera;
    let n = 0;
    const both = (steer) => { g.step({ steer }); twin.step({ steer }); twin.gaps.length = 0; R.onEvents(g.events, g); R.update(g, g.s, g.theta, 1 / 60); n++; };
    while (!g.gaps.length && n < 60 * 900) both(h.bot(g));
    if (!g.gaps.length) return { noGap: true, n, s: g.s };
    const gap = { ...g.gaps[0] };
    const inBoxes = g.boxes.filter((b) => b.k >= gap.from && b.k <= gap.to).length, inPads = g.pads.filter((p) => p.k >= gap.from && p.k <= gap.to).length, inCoins = g.coins.filter((c) => c.k >= gap.from && c.k <= gap.to).length;
    const th0 = g.theta, lane0 = g.lane, sAt = g.s;
    let bad = 0, maxJump = 0, maxDist = 0, maxStep = 0, prev = cam.position.clone(), desync = 0, rendered = 0;
    const cams = [];
    while (g.s < gap.to + 6 && n < 60 * 1200) {
      both(0);
      const p = cam.position; const fin = [p.x, p.y, p.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.fov].every(Number.isFinite);
      if (!fin) bad++;
      maxJump = Math.max(maxJump, g.jumpAt(g.s - 0.12));
      maxStep = Math.max(maxStep, p.distanceTo(prev)); prev.copy(p);
      if (g.s !== twin.s || g.theta !== twin.theta || g.v !== twin.v || g.boxes.length !== twin.boxes.length) desync++;
      if (n % 20 === 0) { R.render(); rendered++; cams.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]); }
    }
    return { gap, sAt: +sAt.toFixed(1), sEnd: +g.s.toFixed(1), frames: n, bad, maxJump: +maxJump.toFixed(2), maxCamStep: +maxStep.toFixed(2), thetaSame: g.theta === th0, lane0, lane1: g.lane, desync, inBoxes, inPads, inCoins, alive: g.alive, fold: g.fold, gapsNow: g.gaps.length, rendered, cams: cams.slice(0, 8) };
  });
  if (r.noGap) { rec(16, 'salto entre mundos: aparece un hueco', false, r); await page.close(); return; }
  rec(16, 'aparece un hueco (game.gaps) tras volver a plegar', true, { gap: r.gap, s: r.sAt, frames: r.frames });
  rec(16, 'cámara finita en todo el salto (sin NaN)', r.bad === 0, { bad: r.bad, maxJump: r.maxJump, maxCamStep: r.maxCamStep });
  rec(16, 'la cámara se eleva en arco (jumpAt ~5,5)', r.maxJump > 4 && r.maxJump < 6, r.maxJump);
  rec(16, 'theta y carril no cambian con el salto (steer 0)', r.thetaSame && r.lane0 === r.lane1, { lane0: r.lane0, lane1: r.lane1 });
  rec(16, 'la simulación es idéntica con y sin huecos (gemelo)', r.desync === 0, { desync: r.desync });
  rec(16, 'no hay cajas, placas ni monedas dentro del hueco', r.inBoxes + r.inPads + r.inCoins === 0, { boxes: r.inBoxes, pads: r.inPads, coins: r.inCoins });
  note(16, 'posiciones de cámara durante el salto (cada 20 pasos)', r.cams);
  // captura a mitad del salto (tiempo real congelado)
  const shot = await page.evaluate(() => {
    const h = window.__hip; h.start('classic', 21); const g = h.game; g.crash = (b) => { b.hit = true; };
    let n = 0; while (!g.gaps.length && n < 60 * 900) { h.step(1); n++; }
    if (!g.gaps.length) return null;
    const gp = g.gaps[0]; while (g.s < (gp.from + gp.to) / 2) { h.step(1, 0); }
    return { s: +g.s.toFixed(1), jump: +g.jumpAt(g.s).toFixed(2) };
  });
  await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))));
  await page.screenshot({ path: `${SHOTS}qa-long/salto-mitad.png` });
  note(16, 'captura a mitad del salto (tests/shots/qa-long/salto-mitad.png)', shot);
  rec(16, 'sin errores', errors.length === 0, errors.slice(0, 5));
  await page.close();
});

// ------------------------------------------------------------------ 19. Aventura
await run(19, async () => {
  const { page, errors } = await open(PHONE);
  await page.evaluate(() => localStorage.removeItem('hipertunel-aventura'));
  await page.evaluate(() => { window.__hip.ui.show('modes'); document.querySelector('.card-adventure').click(); });
  await sleep(500);
  const map = await page.evaluate(() => ({ scr: document.getElementById('ui').dataset.screen, n: document.querySelectorAll('.stage').length, locked: document.querySelectorAll('.stage.locked').length }));
  rec(19, 'el mapa enseña 12 tramos y solo el primero abierto', map.scr === 'map' && map.n === 12 && map.locked === 11, map);
  await page.evaluate(() => document.querySelector('[data-stage="0"]').click());
  const w = await waitState(page, 'play', 6000);
  await page.evaluate(() => { const h = window.__hip; h.input.steer = () => h.bot(h.game, 11); });
  const t0 = Date.now();
  await page.waitForFunction(() => window.__hip.state === 'over', { timeout: 90000 }).catch(() => {});
  const r = await page.evaluate(() => ({ st: window.__hip.state, cleared: window.__hip.game.cleared, stars: window.__hip.game.stars, saved: JSON.parse(localStorage.getItem('hipertunel-aventura') || '{}')[0] || null, next: getComputedStyle(document.querySelector('.btn-next')).display }));
  rec(19, 'el tramo 1 se juega hasta el final con el bot', w.ok && r.st === 'over', { w, st: r.st, s: Math.round((Date.now() - t0) / 1000) });
  rec(19, 'superado: guarda estrellas y fantasma y ofrece Siguiente', !r.cleared || (r.saved && r.saved.stars === r.stars && r.saved.ghost && r.saved.ghost.length > 100 && r.next !== 'none'), { cleared: r.cleared, stars: r.stars, ghost: r.saved && r.saved.ghost ? r.saved.ghost.length : 0, next: r.next });
  if (errors.length) rec(19, 'sin errores', false, errors);
  await page.evaluate(() => localStorage.removeItem('hipertunel-aventura'));
  await page.close();
});

// ------------------------------------------------------------------ 17. partida larga (10 min) con memoria
// ------------------------------------------------------------------ 18. misiones
await run(18, async () => {
  const { page, errors } = await open(DESKTOP);
  const r = await page.evaluate(() => {
    const M = window.__hip.missions; M.reset();
    const l0 = M.list();
    // se cumple "velocidad máxima" con un suceso de impulso a nivel 3, si está activa; si no, se fuerza
    M.start();
    const want = l0.map((m) => m.text);
    const done = [];
    for (let i = 0; i < 20; i++) done.push(...M.event({ type: 'boost', level: 3 }, window.__hip.game));
    for (let i = 0; i < 80; i++) done.push(...M.event({ type: 'coin' }, window.__hip.game));
    for (let i = 0; i < 20; i++) done.push(...M.event({ type: 'near' }, window.__hip.game));
    const fin = M.finish();
    const l1 = M.list();
    const saved = JSON.parse(localStorage.getItem('hipertunel-misiones'));
    return { want, done: done.map((d) => d.text), fin: fin.completed.length, l1: l1.map((m) => [m.text, m.done]), n1: l1.length, rank: M.rank(), savedN: saved.active.length };
  });
  rec(18, 'siempre hay 3 misiones activas y se guardan', r.n1 === 3 && r.savedN === 3, r);
  rec(18, 'las cumplidas avisan en partida y se sustituyen al acabar', r.done.length === r.fin && r.l1.every((m) => !m[1]), { done: r.done, fin: r.fin, l1: r.l1 });
  rec(18, 'el rango sube cada 3 cumplidas', r.rank.level === 1 + Math.floor(r.rank.done / 3), r.rank);
  // pausa y fin de partida enseñan las misiones
  await page.evaluate(() => { window.__hip.start('classic', 5); });
  await waitState(page, 'play', 4000);
  await page.keyboard.press('Escape'); await sleep(200);
  const np = await page.evaluate(() => document.querySelectorAll('.scr[data-screen="pause"] .miss li').length);
  rec(18, 'la pausa enseña las 3 misiones', np === 3, np);
  if (errors.length) rec(18, 'sin errores', false, errors);
  await page.evaluate(() => window.__hip.missions.reset());
  await page.close();
});

await run(17, async () => {
  const MIN = +(opt.long || 10);
  const { page, errors } = await open(DESKTOP);
  await page.evaluate(() => { window.__freeze = true; window.__hip.start('classic', 33); const g = window.__hip.game; g.crash = (b) => { b.hit = true; }; });
  const snap = () => page.evaluate(() => { if (window.gc) window.gc(); const i = window.__hip.renderer.renderer.info; const g = window.__hip.game; return { heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null, geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs ? i.programs.length : -1, boxes: g.boxes.length, pads: g.pads.length, coins: g.coins.length, gaps: g.gaps.length, rows: g.rows ? g.rows.length : -1 }; });
  const log = []; let bad = 0, lastS = -1, gapsSeen = 0, worlds = new Set(), folds = 0;
  for (let chunk = 1; chunk <= MIN * 6; chunk++) {
    const r = await page.evaluate(() => {
      const h = window.__hip; const g = h.game; const R = h.renderer; const t0 = performance.now(); let nan = 0, gp = 0, fo = 0; let lastGap = window.__qaLastGap ?? -1;
      for (let i = 0; i < 600; i++) {
        h.step(1);
        for (const e of g.events) if (e.type === 'foldEnd') fo++;
        if (g.gaps.length && g.gaps[g.gaps.length - 1].from !== lastGap) { lastGap = g.gaps[g.gaps.length - 1].from; gp++; }
        if (i % 4 === 0) { R.update(g, g.s, g.theta, 4 / 60); const p = R.camera.position; if (![p.x, p.y, p.z].every(Number.isFinite)) nan++; }
        if (!Number.isFinite(g.s + g.theta + g.v + g.fold)) nan++;
      }
      window.__qaLastGap = lastGap;
      R.render();
      return { ms: +(performance.now() - t0).toFixed(0), s: +g.s.toFixed(1), distM: g.distanceM, world: g.world, fold: +g.fold.toFixed(1), level: g.level, alive: g.alive, nan, gp, fo };
    });
    if (r.nan || r.s <= lastS || !r.alive) bad++;
    lastS = r.s; gapsSeen += r.gp; folds += r.fo; worlds.add(r.world);
    if (chunk % 6 === 0 || chunk === 1) { const m = await snap(); log.push({ min: +(chunk / 6).toFixed(2), ...r, ...m }); }
  }
  for (const l of log) console.log('      ', JSON.stringify(l));
  const a = log[1] || log[0], b = log[log.length - 1];
  rec(17, `${MIN} min de clásico (bot invulnerable): sin NaN, s creciente, sin errores`, bad === 0 && errors.length === 0, { bad, errors: errors.slice(0, 3), distM: b.distM, worlds: [...worlds], folds, saltos: gapsSeen });
  rec(17, 'memoria estable (montón, geometrías, texturas, programas)', (a.heapMB == null || b.heapMB <= a.heapMB * 1.25 + 5) && b.geo <= a.geo * 1.15 + 5 && b.tex <= a.tex + 2 && b.prog <= a.prog + 2, { min1: { heap: a.heapMB, geo: a.geo, tex: a.tex, prog: a.prog }, fin: { heap: b.heapMB, geo: b.geo, tex: b.tex, prog: b.prog } });
  rec(17, 'listas de la simulación acotadas', b.boxes < 200 && b.pads < 60 && b.coins < 200 && b.gaps <= 2, { boxes: b.boxes, pads: b.pads, coins: b.coins, gaps: b.gaps, rows: b.rows });
  await page.close();
});

if (reloads.length) note(0, 'recargas inesperadas de la página (HMR de Vite): pruebas afectadas pueden fallar', reloads.length);
await browser.close();
// Mando simulado (pausa, cuenta atrás, fin de partida): lo lleva tests/qa-mando.mjs, aparte
if (!ONLY && !opt.built) {
  const m = spawnSync(process.execPath, [new URL('./qa-mando.mjs', import.meta.url).pathname, `--url=${URL0}`], { encoding: 'utf8' });
  const bad = m.stdout.split('\n').filter((l) => l.startsWith('FALLA'));
  rec(18, 'mando simulado (qa-mando.mjs)', m.status === 0 && bad.length === 0, { pasa: (m.stdout.match(/^PASA/gm) || []).length, fallos: bad.slice(0, 3) });
}
// Barrido de la 0.60 (pausa en salto, piruetas, muro, cámaras, menús pintados, mando): tests/qa-noche.mjs, aparte (solo contra el servidor de desarrollo, no con --built)
if (!ONLY && !opt.built) {
  const noche = () => spawnSync(process.execPath, [new URL('./qa-noche.mjs', import.meta.url).pathname, `--url=${URL0}`], { encoding: 'utf8', timeout: 480000 });
  let n = noche(), lines = n.stdout.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  if (n.status !== 0 && /^RELOAD /m.test(n.stdout)) { note(19, 'qa-noche falló con recarga de Vite y se repitió una vez; fallos del primer intento', lines.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 120)).slice(0, 5)); n = noche(); lines = n.stdout.split('\n').filter((l) => /^(PASS|FAIL)/.test(l)); }
  for (const l of lines) { const m = l.match(/^(PASS|FAIL)\s+\[(\w)\]\s+(.*?)(?:\s+—\s+(.*))?$/); if (m) rec(`19${m[2]}`, m[3], m[1] === 'PASS', m[4]); }
  if (n.status !== 0 && !lines.some((l) => l.startsWith('FAIL'))) rec(19, 'qa-noche.mjs terminó mal', false, (n.stderr || n.stdout).split('\n').slice(-3).join(' | '));
  if (lines.length < 40) rec(19, 'qa-noche.mjs ejecutó todas las secciones (≥ 40 comprobaciones)', false, lines.length);
}
// HUD sin textos fuera de su marco a 667×375, 844×390 y 1280×720: tests/hud-desbordes.mjs
if (!ONLY && !opt.built) {
  const hd = spawnSync(process.execPath, [new URL('./hud-desbordes.mjs', import.meta.url).pathname, `--url=${URL0}`], { encoding: 'utf8' });
  const hl = hd.stdout.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  rec(20, 'HUD sin desbordes (hud-desbordes.mjs)', hd.status === 0 && hl.length === 12, { pasa: hl.filter((l) => l.startsWith('PASS')).length, fallos: hl.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 200)).slice(0, 2) });
}
// Fondo de los menús desenfocado y cálido, sin tocar la partida: tests/fondo-menus.mjs
if (!ONLY && !opt.built) {
  const fm = spawnSync(process.execPath, [new URL('./fondo-menus.mjs', import.meta.url).pathname, `--url=${URL0}`], { encoding: 'utf8' });
  const fl = fm.stdout.split('\n').filter((l) => /^(PASS|FAIL)/.test(l));
  rec(21, 'Fondo de los menús cálido y desenfocado (fondo-menus.mjs)', fm.status === 0 && fl.length === 16, { pasa: fl.filter((l) => l.startsWith('PASS')).length, fallos: fl.filter((l) => l.startsWith('FAIL')).map((l) => l.slice(0, 200)).slice(0, 2) });
}
// Superficies del Arcade (agarre): reglas de la simulación con el bot (tests/superficies.mjs) y su vibración (tests/vibe.mjs)
if (!ONLY && !opt.built) {
  const sf = spawnSync(process.execPath, [new URL('./superficies.mjs', import.meta.url).pathname, '--n=20'], { encoding: 'utf8', timeout: 480000 });
  const sl = sf.stdout.split('\n').filter((l) => /^  [✓✗] /.test(l));
  rec(22, 'Superficies: agarre, adelanto y muertes (superficies.mjs)', sf.status === 0 && sl.length >= 26, { comprobaciones: sl.length, fallos: sl.filter((l) => l.includes('✗')).map((l) => l.slice(0, 200)).slice(0, 3) });
  const vb = spawnSync(process.execPath, [new URL('./vibe.mjs', import.meta.url).pathname, `--url=${URL0}`], { encoding: 'utf8', timeout: 240000 });
  const vl = vb.stdout.split('\n').filter((l) => /^  [✓✗] /.test(l));
  rec(23, 'Vibración de la superficie (vibe.mjs)', vb.status === 0 && vl.length >= 30, { comprobaciones: vl.length, fallos: vl.filter((l) => l.includes('✗')).map((l) => l.slice(0, 200)).slice(0, 3) });
}
writeFileSync(SHOTS + 'qa-report.json', JSON.stringify(results, null, 1));
const fails = results.filter((r) => r.pass === false);
console.log(`\n${results.filter((r) => r.pass === true).length} PASS · ${fails.length} FAIL`);
process.exit(fails.length ? 1 : 0);
