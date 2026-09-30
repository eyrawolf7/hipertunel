// Vibración: registra las llamadas REALES a navigator.vibrate (se sustituye antes de cargar la página) en
// partidas en tiempo real y comprueba: ≤ 12 pulsos en cualquier segundo, nada en menús/demo/cuenta atrás/pausa/
// ajustes apagados/tras la muerte, tics del motor, patrón ondulante del plegado y casi nada por fuera del tubo.
// Uso: node tests/vibracion.mjs [--secs=30]      Sale con 1 si algo falla.
import puppeteer from 'puppeteer';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const SECS = +(opt.secs || 30);
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const rec = (ok, name, info) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${name}${info !== undefined ? '  — ' + JSON.stringify(info) : ''}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];

// página nueva con el registro de vibraciones y los ajustes que se pidan
async function abrir(ajustes) {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument((aj) => {
    window.__vib = [];
    navigator.vibrate = (p) => { window.__vib.push({ t: performance.now(), p, st: window.__hip ? window.__hip.state : 'carga' }); return true; };
    if (aj) localStorage.setItem('hipertunel-ajustes', JSON.stringify(aj));
  }, ajustes || null);
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
  await sleep(500);
  return page;
}
const log = (page) => page.evaluate(() => window.__vib.slice());
const limpiar = (page) => page.evaluate(() => { window.__vib.length = 0; });
// jugador por la ruta normal: el giro lo da el bot; no se toca nada más
const armar = (page, inmortal) => page.evaluate((inm) => { const h = window.__hip, g = h.game; h.input.steer = () => h.bot(g); if (inm) g.invul = 1e9; }, inmortal);

// pulsos que suenan de verdad: una llamada nueva (o vibrate(0)) corta lo que quedaba de la anterior
function pulsos(calls) {
  const out = [];
  for (let i = 0; i < calls.length; i++) {
    const c = calls[i], corte = i + 1 < calls.length ? calls[i + 1].t : Infinity;
    const a = Array.isArray(c.p) ? c.p : [c.p];
    let t = c.t;
    for (let j = 0; j < a.length; j++) { if (j % 2 === 0 && a[j] > 0 && t < corte) out.push({ t, ms: a[j], i }); t += a[j]; }
  }
  return out;
}
const maxPorSegundo = (ps) => { let m = 0; for (let i = 0; i < ps.length; i++) { let n = 0; for (let j = i; j < ps.length && ps[j].t - ps[i].t < 1000; j++) n++; m = Math.max(m, n); } return m; };

// 1) título, demo y cuenta atrás: ni un pulso
{
  const page = await abrir();
  await sleep(3000);
  let l = await log(page);
  rec(l.length === 0, 'título y demo: 0 llamadas en 3 s', l.length);
  await page.evaluate(() => window.__hip.startMenu('arcade'));
  await sleep(2500);
  l = await log(page);
  const st = await page.evaluate(() => window.__hip.state);
  rec(st === 'countdown' && l.every((c) => c.p === 0), 'cuenta atrás: ningún pulso (solo vibrate(0) al empezar)', { st, l });
  await page.close();
}

// 2) partida larga invulnerable que pasa por un plegado: ritmo, tics, patrón ondulante y exterior
{
  const page = await abrir();
  const pre = await page.evaluate(() => {
    const h = window.__hip; h.start('classic', 7); const g = h.game;
    let n = 0; while (g.alive && !(g.folding && g.foldRows >= 20) && n++ < 60000) h.step(1);
    return { s: Math.round(g.s), folding: g.folding, alive: g.alive };
  });
  await armar(page, true);
  await limpiar(page);
  const seguimiento = await page.evaluate((secs) => new Promise((res) => {
    const g = window.__hip.game; const t0 = performance.now(); const vistoFuera = []; let vistoOpen = 0, pasos = 0;
    const f = () => { pasos++; if (g.fold < 29) vistoOpen++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else res({ fuera: vistoOpen, frames: pasos, state: window.__hip.state, s: Math.round(g.s) }); };
    requestAnimationFrame(f);
  }), SECS);
  const l = await log(page);
  const ps = pulsos(l);
  rec(pre.folding && seguimiento.fuera > 120, `partida de ${SECS} s por un plegado: hubo tramo por fuera del tubo`, { pre, ...seguimiento });
  rec(l.length > 10 && l.every((c) => c.p === 0 || c.st === 'play'), 'todas las llamadas salen jugando', { llamadas: l.length, malas: l.filter((c) => c.p !== 0 && c.st !== 'play').length });
  const max = maxPorSegundo(ps);
  rec(ps.length > 20 && max <= 12, 'como mucho 12 pulsos en cualquier segundo', { pulsos: ps.length, max });
  const fuera = l.filter((c) => c.p === 3);
  const gaps = (xs) => xs.slice(1).map((c, i) => c.t - xs[i].t);
  rec(l.some((c) => Array.isArray(c.p) && c.p.length === 7), 'el plegado da un patrón ondulante (4 pulsos)', l.filter((c) => Array.isArray(c.p)).map((c) => c.p.length));
  rec(fuera.length >= 3 && Math.min(...gaps(fuera)) >= 500, 'por fuera del tubo: solo tics de 3 ms cada ≥ 0,55 s', { tics: fuera.length, sep: Math.round(Math.min(...gaps(fuera))) });
  const dentroFuera = ps.filter((p) => p.ms === 3).length;
  rec(dentroFuera <= fuera.length && ps.filter((p) => p.ms === 3).length > 0, 'los pulsos de 3 ms son los del exterior', dentroFuera);
  await page.close();
}

// 3) un impulso de placa suena seco (un solo pulso corto; el nivel 3, doble)
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, false);
  await limpiar(page);
  await page.waitForFunction(() => window.__hip.game.level >= 1 || window.__hip.state !== 'play', { timeout: 60000 }).catch(() => {});
  const l = await log(page);
  const boosts = l.filter((c) => c.p === 28 || (Array.isArray(c.p) && c.p[0] === 30 && c.p.length === 3));
  const st = await page.evaluate(() => ({ s: window.__hip.state, lvl: window.__hip.game.level }));
  rec(st.lvl >= 1 && boosts.length >= 1, 'impulso: patrón seco (28 ms)', { boosts: boosts.length, st });
  // antes del primer impulso la partida va por dentro del tubo: tics al cruzar anillos, ni demasiado juntos ni muy espaciados
  const tics = l.filter((c) => typeof c.p === 'number' && c.p >= 8 && c.p <= 12 && (!boosts[0] || c.t < boosts[0].t));
  const sep = tics.slice(1).map((c, i) => c.t - tics[i].t).sort((a, b) => a - b);
  rec(tics.length >= 8 && sep[0] >= 195 && sep[Math.floor(sep.length / 2)] <= 400, 'tics del motor por dentro: ≥ 0,2 s entre ellos y ritmo de 2,5-5 por segundo', { tics: tics.length, minMs: Math.round(sep[0]), medianaMs: Math.round(sep[Math.floor(sep.length / 2)]) });
  await page.close();
}

// 7) puertas y tope, forzados con el gancho __hip.buzz: ráfaga, pausa, y nada tras la muerte
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await sleep(300);
  await limpiar(page);
  const aceptadas = await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__hip.buzz([10, 20, 10]); return window.__vib.length; });
  const max = maxPorSegundo(pulsos(await log(page)));
  rec(aceptadas >= 3 && aceptadas <= 12 && max <= 12, 'ráfaga de 60 sucesos a la vez: el tope los frena (≤ 12 llamadas y pulsos/s)', { aceptadas, max });
  const choque = await page.evaluate(() => { for (let i = 0; i < 30; i++) window.__hip.buzz(10); const n = window.__vib.length; window.__hip.buzz(10); window.__hip.buzz([40, 30, 60], 1, false, true); const l = window.__vib; return { suelta: l.length - n, ultima: l[l.length - 1].p }; });
  rec(choque.suelta === 1 && Array.isArray(choque.ultima) && choque.ultima[0] === 40, 'con el tope saturado, el choque con impulso (force) sí suena y una vibración suelta no', choque);
  await page.keyboard.press('KeyP');
  await sleep(300);
  await limpiar(page);
  await page.evaluate(() => { window.__hip.buzz(10); window.__hip.buzz([20, 10, 20], 1, true); });
  rec((await log(page)).length === 0, 'en pausa buzz() no saca nada', await log(page));
  await page.close();
  const p2 = await abrir();
  await p2.evaluate(() => window.__hip.start('classic', 7));
  await armar(p2, true);
  await sleep(300);
  await limpiar(p2);
  await p2.evaluate(() => { window.__hip.buzz([120, 60, 200], 1, true); });
  await sleep(150);
  await p2.evaluate(() => { window.__hip.buzz(10); window.__hip.buzz([30, 40, 30]); });
  const l = await log(p2);
  rec(l.length === 1 && Array.isArray(l[0].p) && l[0].p[0] === 120, 'tras el patrón final no sale ningún pulso más', l.map((c) => c.p));
  await p2.close();
}

// 4) muerte: el patrón de muerte es el último; después no suena nada (ni en «dying» ni en el fin)
{
  const page = await abrir();
  await page.evaluate(() => {
    const h = window.__hip; h.start('classic', 3); const g = h.game;
    h.input.steer = () => { const b = g.boxes.find((x) => !x.hit && x.k > g.s); if (!b) return 0; let d = b.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.max(-1, Math.min(1, d * 4)); };
  });
  await limpiar(page);
  await page.waitForFunction(() => window.__hip.state === 'over' || window.__hip.state === 'dying', { timeout: 60000 });
  const tMuerte = await page.evaluate(() => performance.now());
  await sleep(2500);
  const l = await log(page), st = await page.evaluate(() => window.__hip.state);
  const fatal = l.filter((c) => Array.isArray(c.p) && c.p.length === 3 && c.p[0] === 120);
  const i = l.indexOf(fatal[0]);
  rec(st === 'over' && fatal.length === 1, 'la muerte suena una vez', { st, fatal: fatal.length });
  rec(i === l.length - 1, 'el patrón de muerte es la última llamada (nada después, ni en el fin)', { i, n: l.length, despues: l.slice(i + 1) });
  rec(l.every((c) => c.p === 0 || c.st === 'play'), 'todas las llamadas salen jugando (la muerte se manda aún en juego)');
  await page.close();
}

// 5) pausa: corta el patrón y no suena nada mientras está en pausa
{
  const page = await abrir();
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await sleep(2500);
  await limpiar(page);
  await page.keyboard.press('KeyP');
  await sleep(300);
  const st = await page.evaluate(() => window.__hip.state);
  await sleep(2500);
  const l = await log(page);
  rec(st === 'paused', 'P pausa la partida', st);
  rec(l.length >= 1 && l[0].p === 0 && l.every((c) => c.p === 0), 'pausa: vibrate(0) y ningún pulso durante 2,8 s', l);
  await page.close();
}

// 6) ajustes: sin vibración o con efectos reducidos, nada de nada
for (const [nombre, aj] of [['vibración desactivada', { vibe: false }], ['efectos reducidos', { reduceFx: true }]]) {
  const page = await abrir(aj);
  await page.evaluate(() => window.__hip.start('classic', 7));
  await armar(page, true);
  await sleep(5000);
  const l = await log(page), st = await page.evaluate(() => window.__hip.state);
  rec(st === 'play' && l.every((c) => c.p === 0), `${nombre}: 0 pulsos en 5 s de partida`, { st, pulsos: l.filter((c) => c.p !== 0).length });
  await page.close();
}

rec(errors.length === 0, 'sin errores en consola', errors.slice(0, 3));
await browser.close();
process.exit(fallos ? 1 : 0);
