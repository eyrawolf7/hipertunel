// Vibración con intensidad (app de Android, app/src/input/haptics.js).
//   node tests/haptics.mjs          parte pura (plugin y reloj falsos) + parte de navegador (HIP_URL)
//   node tests/haptics.mjs --pura   solo la parte pura
// El navegador se hace pasar por la app con `window.__hapticsPlugin` (un Haptics falso que lo registra
// todo) y se comprueba la ruta REAL de main.js: qué golpe sale en cada suceso, nada fuera de la
// partida y que la web sin plugin sigue usando navigator.vibrate con el mismo patrón.
import { createHaptics, LIGHT_MAX, MEDIUM_MAX, LONG_MS, SHORT_MS } from '../app/src/input/haptics.js';
import { createVibe, PATTERNS } from '../app/src/input/vibe.js';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
let fallos = 0;
const rec = (ok, name, info) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${name}${info !== undefined ? '  — ' + JSON.stringify(info) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- parte pura
function banco() {
  const calls = [], agenda = []; let id = 0, ahora = 0;
  const plugin = {
    impact: ({ style }) => { calls.push({ t: ahora, impact: style }); return Promise.resolve(); },
    vibrate: ({ duration }) => { calls.push({ t: ahora, vibrate: duration }); return Promise.resolve(); },
  };
  const timers = { set: (f, t) => { agenda.push({ id: ++id, at: ahora + t, f }); return id; }, clear: (i) => { const k = agenda.findIndex((a) => a.id === i); if (k >= 0) agenda.splice(k, 1); } };
  const avanza = (ms) => { const fin = ahora + ms; for (;;) { agenda.sort((a, b) => a.at - b.at); const n = agenda[0]; if (!n || n.at > fin) break; agenda.shift(); ahora = n.at; n.f(); } ahora = fin; };
  return { calls, plugin, timers, avanza, pendientes: () => agenda.length, hap: () => createHaptics({ plugin, timers, web: false }) };
}
const golpes = (calls) => calls.map((c) => c.impact || `v${c.vibrate}`);

{
  const b = banco(), h = b.hap();
  rec(h.native === true, 'con plugin: modo app');
  h.play(8); h.play(LIGHT_MAX); h.play(13); h.play(MEDIUM_MAX); h.play(31);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Light', 'Light', 'Medium', 'Medium', 'Heavy']), 'pulso suelto: Light ≤ 12 ms, Medium ≤ 30, Heavy más', golpes(b.calls));
}
{
  const b = banco(), h = b.hap();
  h.play(LONG_MS - 1); h.play(LONG_MS); h.play(200);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Heavy', `v${LONG_MS}`, 'v200']), 'pulsos largos (≥ 100 ms): vibrate con su duración', golpes(b.calls));
}
{
  // plegado [12,90,12,90,12,90,30]: 3 golpes Light y uno Medium, a 102 ms unos de otros
  const b = banco(), h = b.hap();
  h.play([12, 90, 12, 90, 12, 90, 30]);
  rec(b.calls.length === 1, 'patrón: el primer golpe sale ya', golpes(b.calls));
  b.avanza(1000);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Light', 'Light', 'Light', 'Medium']), 'plegado: Light ×3 y Medium al final', golpes(b.calls));
  rec(JSON.stringify(b.calls.map((c) => c.t)) === JSON.stringify([0, 102, 204, 306]), 'plegado: los golpes caen en el tiempo del patrón', b.calls.map((c) => c.t));
}
{
  // nivel 3 [30,50,45]; choque [40,30,60]; muerte [120,60,200]
  const b = banco(), h = b.hap();
  h.play([30, 50, 45]); b.avanza(500);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Medium', 'Heavy']), 'impulso de nivel 3: Medium y Heavy', golpes(b.calls));
  b.calls.length = 0;
  h.play([40, 30, 60]); b.avanza(500);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Heavy', 'Heavy']), 'choque con impulso: Heavy ×2', golpes(b.calls));
  b.calls.length = 0;
  h.play([120, 60, 200]); b.avanza(500);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify([`v120`, `v200`]) && b.calls[1].t - b.calls[0].t === 180,'muerte: dos vibrate largos', b.calls);
}
{
  // un patrón nuevo corta lo que quedaba del anterior, y stop() no deja nada pendiente
  const b = banco(), h = b.hap();
  h.play([12, 90, 12, 90, 12]); b.avanza(50);
  h.play(28); b.avanza(1000);
  rec(JSON.stringify(golpes(b.calls)) === JSON.stringify(['Light', 'Medium']), 'un patrón nuevo corta el resto del anterior', golpes(b.calls));
  h.play([12, 90, 12]); h.stop();
  rec(b.pendientes() === 0, 'stop() cancela los golpes pendientes', b.pendientes());
}
{
  // las superficies eligen su golpe por nombre: piedra Light, lava Medium, cristal y hielo vibrate corto
  const esperado = { piedra: 'Light', musgo: 'Light', lava: 'Medium', cristal: `v${SHORT_MS}`, hielo: `v${SHORT_MS}` };
  const b = banco(), h = b.hap();
  for (const n of Object.keys(esperado)) { b.calls.length = 0; h.play(PATTERNS.find((p) => p.name === n).ms, n); rec(golpes(b.calls)[0] === esperado[n] && b.calls.length === 1, `superficie ${n}: ${esperado[n]}`, golpes(b.calls)); }
  // y por la ruta de input/vibe.js (el callback recibe el nombre), con cada superficie por un buen rato
  for (let s = 0; s < PATTERNS.length; s++) {
    const bb = banco(), hh = bb.hap();
    const v = createVibe((ms, kind, name) => { hh.play(ms, name); return true; }, () => 0.5);
    for (let t = 0; t < 3000; t += 16) v.update(t, { on: true, surface: s });
    const g = golpes(bb.calls), n = PATTERNS[s].name;
    rec(g.length > 5 && g.every((x) => x === esperado[n]), `vibe.js → haptics: todos los pulsos de ${n} son ${esperado[n]}`, { n: g.length, distintos: [...new Set(g)] });
  }
  // el pulso de cambio de superficie (20 ms) es Medium
  const bb = banco(), hh = bb.hap();
  const v = createVibe((ms, kind, name) => { hh.play(ms, name); return true; }, () => 0.5);
  v.update(0, { on: true, surface: 0 }); v.update(100, { on: true, surface: 3 });
  rec(golpes(bb.calls)[0] === 'Medium', 'cambio de superficie: Medium', golpes(bb.calls));
}
{
  // sin plugin (la web): el patrón llega intacto a navigator.vibrate
  const visto = [];
  const vieja = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (p) => { visto.push(p); return true; } }, configurable: true });
  const h = createHaptics({});
  h.play([12, 90, 12]); h.play(28); h.stop();
  rec(h.native === false && JSON.stringify(visto) === JSON.stringify([[12, 90, 12], 28, 0]), 'web sin plugin: navigator.vibrate con el mismo patrón', visto);
  if (vieja) Object.defineProperty(globalThis, 'navigator', vieja); else delete globalThis.navigator;
}
{
  // si el plugin falla no rompe el juego
  const h = createHaptics({ plugin: { impact: () => { throw new Error('x'); }, vibrate: () => Promise.reject(new Error('y')) }, web: false });
  let ok = true;
  try { h.play(10); h.play(200); } catch (e) { ok = false; }
  await sleep(10);
  rec(ok, 'un plugin que falla no lanza errores');
}

if (opt.pura) { console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo OK'); process.exit(fallos ? 1 : 0); }

// ---------------------------------------------------------------- navegador (ruta real de main.js)
const { default: puppeteer } = await import('puppeteer');
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errores = [];

async function abrir({ nativo = true, ajustes = null } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
  page.on('pageerror', (e) => errores.push(String(e)));
  await page.evaluateOnNewDocument((nat, aj) => {
    window.__hap = []; window.__web = [];
    const st = () => (window.__hip ? window.__hip.state : 'carga');
    if (nat) window.__hapticsPlugin = {
      impact: ({ style }) => { window.__hap.push({ t: performance.now(), impact: style, st: st() }); return Promise.resolve(); },
      vibrate: ({ duration }) => { window.__hap.push({ t: performance.now(), vibrate: duration, st: st() }); return Promise.resolve(); },
    };
    navigator.vibrate = (p) => { window.__web.push({ t: performance.now(), p, st: st() }); return true; };
    localStorage.setItem('hipertunel-ajustes', JSON.stringify(aj || {}));   // las páginas comparten localStorage: siempre ajustes limpios
  }, nativo, ajustes);
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game && window.__haptics, { timeout: 20000 });
  await sleep(500);
  return page;
}
const hap = (page) => page.evaluate(() => window.__hap.slice());
const web = (page) => page.evaluate(() => window.__web.slice());
const limpiar = (page) => page.evaluate(() => { window.__hap.length = 0; window.__web.length = 0; });
const armar = (page, inmortal) => page.evaluate((inm) => { const h = window.__hip, g = h.game; h.input.steer = () => h.bot(g); if (inm) g.invul = 1e9; }, inmortal);
const golpeNombre = (c) => c.impact || `v${c.vibrate}`;

// 1) título, demo y cuenta atrás: ni un golpe, y navigator.vibrate no se toca salvo vibrate(0) al parar
{
  const page = await abrir();
  await sleep(3000);
  rec((await hap(page)).length === 0, 'título y demo: 0 golpes de Haptics');
  await page.evaluate(() => window.__hip.startMenu('arcade'));
  await sleep(2500);
  const st = await page.evaluate(() => window.__hip.state);
  rec(st === 'countdown' && (await hap(page)).length === 0, 'cuenta atrás: 0 golpes', { st });
  await page.close();
}

// 2) partida de tiempo real: golpes de la app con la intensidad de cada suceso, y nada por navigator.vibrate
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, false);
  await limpiar(page);
  await page.waitForFunction(() => window.__hip.game.level >= 1 || window.__hip.state !== 'play', { timeout: 60000 }).catch(() => {});
  const nivel = await page.evaluate(() => ({ lvl: window.__hip.game.level, st: window.__hip.state }));
  const l = await hap(page), w = await web(page);
  rec(nivel.lvl >= 1, 'la partida llegó a coger un impulso', nivel);
  rec(l.length > 5 && l.every((c) => c.st === 'play'), 'todos los golpes salen jugando', { golpes: l.length, malos: l.filter((c) => c.st !== 'play').length });
  rec(l.some((c) => c.impact === 'Light'), 'hay tics Light del motor y del suelo', [...new Set(l.map(golpeNombre))]);
  rec(l.some((c) => c.impact === 'Medium'), 'el impulso da un golpe Medium', [...new Set(l.map(golpeNombre))]);
  rec(w.every((c) => c.p === 0), 'con la app, navigator.vibrate solo recibe vibrate(0) (parar)', w.filter((c) => c.p !== 0).length);
  await page.close();
}

// 3) ritmo: la ruta de la app respeta el tope de 12 golpes por segundo (partida invulnerable por un plegado)
{
  const page = await abrir();
  await page.evaluate(() => { const h = window.__hip; h.start('classic', 7); const g = h.game; let n = 0; while (g.alive && !(g.folding && g.foldRows >= 20) && n++ < 60000) h.step(1); });
  await armar(page, true);
  await limpiar(page);
  await sleep(20000);
  const l = await hap(page);
  let max = 0;
  for (let i = 0; i < l.length; i++) { let n = 0; for (let j = i; j < l.length && l[j].t - l[i].t < 1000; j++) n++; max = Math.max(max, n); }
  rec(l.length > 20 && max <= 12, 'como mucho 12 golpes en cualquier segundo', { golpes: l.length, max });
  rec(l.some((c) => c.impact === 'Medium') && l.some((c) => c.impact === 'Light'), 'plegado: mezcla Light y Medium', [...new Set(l.map(golpeNombre))]);
  await page.close();
}

// 4) sucesos por __hip.buzz (el mismo buzz() de main): choque, muerte y nada tras la muerte, en pausa ni apagado
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await sleep(300);
  await limpiar(page);
  await page.evaluate(() => window.__hip.buzz([40, 30, 60], 1, false, true));
  await sleep(300);
  let l = await hap(page);
  // (un tic del motor puede colarse entre medias: lo que importa es que salgan los dos Heavy y ningún Medium)
  const pesados = l.filter((c) => c.impact === 'Heavy');
  rec(pesados.length === 2 && !l.some((c) => c.impact === 'Medium') && pesados[1].t - pesados[0].t >= 60, 'choque con impulso: Heavy ×2 por la ruta real', l.map(golpeNombre));
  await limpiar(page);
  await page.evaluate(() => window.__hip.buzz([120, 60, 200], 1, true, true));
  await sleep(500);
  l = await hap(page);
  rec(JSON.stringify(l.map(golpeNombre)) === JSON.stringify(['v120', 'v200']), 'muerte: dos vibrate largos', l.map(golpeNombre));
  await limpiar(page);
  await sleep(1500);
  await page.evaluate(() => window.__hip.buzz(28));
  rec((await hap(page)).length === 0, 'tras la muerte: ni un golpe más');
  await page.close();
}
for (const [nombre, aj] of [['vibración desactivada', { vibe: false }], ['efectos reducidos', { reduceFx: true }]]) {
  const page = await abrir({ ajustes: aj });
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await limpiar(page);
  await sleep(4000);
  await page.evaluate(() => window.__hip.buzz([30, 50, 45]));
  rec((await hap(page)).length === 0, `${nombre}: 0 golpes de Haptics`);
  await page.close();
}
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await sleep(1500);
  // un patrón largo (plegado) recién empezado y, al pausar, no debe salir ni un golpe más de los pendientes
  await page.evaluate(() => { window.__hip.buzz([12, 90, 12, 90, 12, 90, 30], 1, false, true); window.__hap.length = 0; });   // el primer golpe sale ya: se descarta y solo cuentan los pendientes
  await page.keyboard.press('KeyP');
  await sleep(500);
  const st = await page.evaluate(() => window.__hip.state);
  const pend = (await hap(page)).length;
  await limpiar(page);
  await page.evaluate(() => window.__hip.buzz(28));
  await sleep(1500);
  rec(st === 'paused' && pend === 0 && (await hap(page)).length === 0, 'en pausa: se cancelan los golpes pendientes y no sale ninguno', { st, pendientesTrasPausar: pend });
  await page.close();
}

// 5) la web (sin plugin) sigue usando navigator.vibrate con los patrones de siempre
{
  const page = await abrir({ nativo: false });
  rec(await page.evaluate(() => window.__haptics.native === false), 'sin app: modo web');
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, false);
  await limpiar(page);
  await page.waitForFunction(() => window.__hip.game.level >= 1 || window.__hip.state !== 'play', { timeout: 60000 }).catch(() => {});
  const w = await web(page);
  const est = await page.evaluate(() => ({ st: window.__hip.state, lvl: window.__hip.game.level }));
  rec(w.some((c) => c.p === 28 || (Array.isArray(c.p) && c.p[0] === 30)), 'web: el impulso sigue siendo 28 ms / [30,50,45]', { est, llamadas: w.filter((c) => c.p !== 0).slice(0, 6).map((c) => c.p) });
  rec(w.filter((c) => typeof c.p === 'number' && c.p >= 8 && c.p <= 12).length > 3, 'web: tics de 8-12 ms', { est, n: w.length });
  await page.close();
}

rec(errores.length === 0, 'sin errores de página', errores.slice(0, 3));
await browser.close();
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo OK');
process.exit(fallos ? 1 : 0);
