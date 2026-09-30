// Fases en el navegador real: «Jugar» abre la siguiente fase, mapa y bloqueos, punto de control con
// impulso de regalo, superar la fase (portal), estrellas y fantasma guardados, monedas sin cobrar
// dos veces. Uso: node tests/qa-fases.mjs [--url=...] [--shots=carpeta]  (por defecto $HIP_URL)
// --shots guarda capturas (844×390) del flujo en tests/shots/<carpeta>/
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = opt.shots ? new URL(`./shots/${opt.shots}/`, import.meta.url).pathname : null;
if (out) mkdirSync(out, { recursive: true });
let fails = 0;
const rec = (n, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n}${info === undefined ? '' : ' — ' + JSON.stringify(info)}`); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('qa-fases')) { try { localStorage.clear(); } catch (e) {} sessionStorage.setItem('qa-fases', '1'); } });
await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(800);
const S = () => page.evaluate(() => ({ st: __hip.state, scr: document.getElementById('ui').dataset.screen }));
const shot = async (n) => { if (out) { await sleep(1300); await page.screenshot({ path: out + n + '.png' }); } };
const click = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 4000 }); await page.click(sel); };
const toState = async (s, ms = 6000) => { try { await page.waitForFunction((s) => __hip.state === s, { timeout: ms }, s); return true; } catch (e) { return false; } };
// el jugador del bot de la demo (sin choques) mueve la partida; se sustituye la entrada real
const botOn = () => page.evaluate(() => { const i = __hip.input; i.steer = () => __hip.bot(__hip.game); i.consumeTrick = () => false; });
const invul = () => page.evaluate(() => { __hip.game.crash = (b) => { b.hit = true; }; });

// 1. «Jugar» abre la Fase 1 (partida nueva) y el HUD dice Fase 1
await click('.scr-title [data-act="play"]');
let g = await page.evaluate(() => ({ phase: __hip.game.isPhase, idx: __hip.game.faseIdx, theme: __hip.game.themeN, w: __hip.game.world, st: __hip.state, idx2: __hip.phaseIdx }));
rec('Jugar abre la Fase 1', g.phase && g.idx === 0 && g.theme === 0 && g.idx2 === 0, g);
await sleep(600);
rec('la tarjeta de la fase enseña «Fase 1»', await page.evaluate(() => /Fase 1/.test(document.querySelector('[data-hud="advIntro"]').textContent) && /portal/i.test(document.querySelector('[data-hud="advIntro"]').textContent)));
await shot('01-intro');
await toState('play');
rec('la barra de progreso dice «Fase 1»', await page.evaluate(() => document.querySelector('[data-hud="advN"]').textContent === 'Fase 1'));
await sleep(600); await shot('02-jugando');

// 2. mapa: Modos → Fases; la 2 está bloqueada hasta superar la 1
await page.evaluate(() => { window.__freeze = true; });
await click('.hud-pause'); await sleep(200); await click('.scr-pause [data-act="menu"]'); await sleep(300);
rec('Menú vuelve al título', (await S()).scr === 'title', await S());
await click('.scr-title [data-act="modes"]');
await sleep(500); await shot('03-modos');
rec('la tarjeta Fases es la primera de Modos', await page.evaluate(() => document.querySelector('.scr-modes .card').dataset.mode === 'phase'));
await click('.scr-modes [data-mode="phase"]'); await sleep(500);
let m = await page.evaluate(() => ({ scr: document.getElementById('ui').dataset.screen, n: document.querySelectorAll('.scr-phases .stage').length, locked: [...document.querySelectorAll('.scr-phases .stage')].map((e) => e.classList.contains('locked')), tot: document.querySelector('[data-bind="phasesTotal"]').textContent }));
rec('el mapa muestra las 2 fases, la 2 bloqueada', m.scr === 'phases' && m.n === 2 && !m.locked[0] && m.locked[1], m);
await shot('04-mapa');
await page.click('.scr-phases .stage.locked'); await sleep(300);
rec('pulsar la fase bloqueada no arranca', (await S()).scr === 'phases' && await page.evaluate(() => /Supera la fase/.test(document.querySelector('.toasts').textContent)));
await page.keyboard.press('Escape'); await sleep(200);
rec('Esc del mapa vuelve a Modos', (await S()).scr === 'modes');

// 3. punto de control: pasar el primero sin morir, morir y «Otra vez» vuelve exacto con regalo
await page.evaluate(() => { __hip.ui.show('title'); __hip.setPhase(0); __hip.start('phase'); window.__freeze = true; });
await botOn(); await invul();
await page.evaluate(() => { let n = 0; while (!__hip.cpRec && n++ < 60 * 90) __hip.tick(1); });
const cp = await page.evaluate(() => { const g = __hip.game; return { n: __hip.cpRec ? __hip.cpRec.length : 0, frame: g.frame, s: g.s, theta: g.theta, coins: g.coinsGot, idx: g.cpIdx, rec: __hip.rec.length, toast: /control/i.test(document.querySelector('.toasts').textContent) }; });
rec('el primer punto de control se graba (fotograma, monedas, aviso)', cp.n > 60 * 5 && cp.n === cp.frame && cp.idx === 1 && cp.toast, cp);
await page.evaluate(() => { __hip.tick(200); });
// ahora sí se puede morir
const pre = await page.evaluate(() => { const g = __hip.game; delete g.crash; g.die(null); __hip.tick(1); return { alive: g.alive, st: __hip.state, frames: g.frame, gifts: g.gifts }; });
rec('sin la trampa, morir lleva a «dying»', !pre.alive && pre.st === 'dying', pre);
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 4000);
await sleep(900);
const ov = await page.evaluate(() => ({ scr: document.getElementById('ui').dataset.screen, fresh: getComputedStyle(document.querySelector('.btn-fresh')).display, restart: document.querySelector('[data-bind="restartTxt"]').textContent, head: document.querySelector('[data-bind="headline"]').textContent, adv: document.querySelector('[data-bind="adv"]').textContent }));
rec('el fin de fase ofrece «Desde el control» y «Desde el principio»', ov.scr === 'over' && ov.fresh !== 'none' && ov.restart === 'Desde el control' && /Fase 1/.test(ov.adv), ov);
await shot('05-fin-control');
// 4. «Otra vez» = control
const w1 = await page.evaluate(() => ({ wallet: __hip.shop.wallet, coins: __hip.game.coinsGot }));
await page.evaluate(() => { window.__freeze = true; });
await click('.scr-over [data-act="restart"]');
await sleep(200);
const back = await page.evaluate(() => { const g = __hip.game; return { st: __hip.state, frame: g.frame, s: g.s, coins: g.coinsGot, gift: __hip.giftNext, recLen: __hip.rec.length, idx: g.cpIdx }; });
rec('«Otra vez» vuelve exactamente al control (mismo fotograma y posición)', back.frame === cp.n && back.s === cp.s && back.recLen === cp.n && back.gift === true && back.idx === 1, { back, cp: { n: cp.n, s: cp.s } });
await page.evaluate(() => { __hip.state === 'countdown' && (window.__x = 1); });
await page.evaluate(() => { window.__freeze = true; });
await toState('play', 6000);
await botOn();
await page.evaluate(() => __hip.tick(1));
const gi = await page.evaluate(() => ({ gifts: __hip.game.gifts, boost: __hip.game.boostOn, level: __hip.game.level, gift: __hip.giftNext, gflag: __hip.rec.gift[__hip.rec.length - 1] }));
rec('la primera acción lleva el impulso de regalo y queda grabada', gi.gifts === 1 && gi.boost && gi.level >= 1 && gi.gift === false && gi.gflag === 1, gi);
// las monedas de antes del control no se cobran dos veces: la cartera sube solo lo ganado desde el control
await page.evaluate(() => { const g = __hip.game; delete g.crash; __hip.tick(120); g.coinsGot += 7; g.die(null); __hip.tick(1); window.__freeze = false; });
await toState('over', 4000); await sleep(300);
const w2 = await page.evaluate(() => ({ wallet: __hip.shop.wallet, coins: __hip.game.coinsGot }));
// la primera salida ya cobró hasta w1.coins: la segunda solo cobra lo que pase de ahí (cada moneda una sola vez)
rec('las monedas ya cobradas no se cobran dos veces', w2.coins > w1.coins && w2.wallet - w1.wallet === w2.coins - w1.coins, { w1, w2, cpCoins: cp.coins });
// datos guardados rotos no impiden arrancar
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', JSON.stringify({ 0: null, 1: { bits: 1, ghost: '%%%no-es-base64' } })); });
const rot = await page.evaluate(() => { try { __hip.setPhase(1); __hip.start('phase'); return { ok: __hip.game.isPhase, ghost: !!__hip.renderer.ghostGame }; } catch (e) { return { err: String(e) }; } });
rec('un fantasma guardado roto no impide jugar la fase', rot.ok === true && rot.ghost === false, rot);
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', '{}'); __hip.setPhase(0); });
// 5. desde el principio (pausa → Reiniciar) es una partida nueva
await page.evaluate(() => { window.__freeze = true; __hip.start('phase'); });
await sleep(100);
await page.evaluate(() => { __hip.ui.show('pause'); });
await click('.scr-pause [data-act="restart"]'); await sleep(200);
const fresh = await page.evaluate(() => ({ st: __hip.state, frame: __hip.game.frame, s: __hip.game.s, gift: __hip.giftNext, rec: __hip.rec.length }));
rec('Reiniciar desde la pausa empieza la fase de cero', fresh.frame === 0 && fresh.s === 0 && !fresh.gift && fresh.rec === 0, fresh);

// 6. superar la fase (portal): se guardan estrellas y fantasma, sale «Siguiente fase» y Jugar abre la Fase 2
await page.evaluate(() => { window.__freeze = true; __hip.start('phase'); });
await botOn(); await invul();
const run = await page.evaluate(() => { let n = 0; while (__hip.game.alive && n++ < 60 * 200) __hip.tick(1); const g = __hip.game; return { cleared: g.cleared, s: g.s, time: +g.time.toFixed(1), stars: g.stars, bits: g.starBits, portal: !!g.portal, prog: g.progress }; });
rec('el bot llega al portal y supera la fase', run.cleared && run.portal && run.prog === 1 && run.time > 45 && run.time < 100, run);
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 5000); await sleep(1200);
const cl = await page.evaluate(() => ({ head: document.querySelector('[data-bind="headline"]').textContent, next: getComputedStyle(document.querySelector('.btn-next')).display, nextTxt: document.querySelector('[data-bind="nextTxt"]').textContent, goals: document.querySelector('.oc-goals').textContent, saved: JSON.parse(localStorage.getItem('hipertunel-fases') || '{}'), mundoMax: localStorage.getItem('hipertunel-mundo-max') }));
rec('fin de fase superada: titular, «Siguiente fase» y estrellas guardadas', /superada|Perfecto/.test(cl.head) && cl.next !== 'none' && cl.nextTxt === 'Siguiente fase' && (cl.saved[0]?.bits & 1) === 1 && !!cl.saved[0]?.ghost, cl);
rec('superar la Fase 1 desbloquea el mundo 2 de Viaje', cl.mundoMax === '1', cl.mundoMax);
await shot('06-fase-superada');
// un toque suelto sobre la tarjeta (fuera de los botones) no reintenta cuando hay «Siguiente»
const tap = await page.evaluate(async () => { const g0 = __hip.game; const el = document.querySelector('.scr-over'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); return { igual: __hip.game === g0, st: __hip.state }; });
rec('tocar en cualquier sitio tras superar la fase no la repite', tap.igual && tap.st === 'over', tap);
// fantasma: la siguiente vez de la Fase 1 hay fantasma que avanza en sincronía
await page.evaluate(() => { window.__freeze = true; __hip.setPhase(0); __hip.start('phase'); });
await botOn(); await invul();
const gh = await page.evaluate(() => { __hip.tick(400); const r = __hip.renderer; return { has: !!r.ghostGame, gf: r.ghostGame && r.ghostGame.frame, f: __hip.game.frame, gs: r.ghostGame && +r.ghostGame.s.toFixed(1), s: +__hip.game.s.toFixed(1) }; });
rec('la Fase 1 repetida trae el fantasma de tu mejor salida, en sincronía', gh.has && gh.gf === gh.f, gh);
// 7. «Siguiente fase» y «Jugar» llevan a la Fase 2 (mundo 2: selva)
await page.evaluate(() => { window.__freeze = false; __hip.game.alive = false; });
await toState('over', 4000); await sleep(1200);
await page.evaluate(() => { __hip.ui.show('title'); });
await click('.scr-title [data-act="play"]');
g = await page.evaluate(() => ({ idx: __hip.game.faseIdx, theme: __hip.game.themeN, world: __hip.game.world, base: __hip.renderer.themeBase, ti: __hip.renderer.themeIdx }));
rec('«Jugar» tras superar la Fase 1 abre la Fase 2 (Selva, tema 1)', g.idx === 1 && g.theme === 1 && g.world === 2 && g.base === 1, g);
await sleep(600); await shot('07-fase2-intro');
await toState('play'); await sleep(1200); await shot('08-fase2-jugando');
await page.evaluate(() => { __hip.ui.show('title'); __hip.ui.show('modes'); });
await click('.scr-modes [data-mode="phase"]'); await sleep(500);
m = await page.evaluate(() => ({ locked: [...document.querySelectorAll('.scr-phases .stage')].map((e) => e.classList.contains('locked')), stars: [...document.querySelectorAll('.scr-phases .stage')].map((e) => e.querySelectorAll('.st.on').length) }));
rec('el mapa desbloquea la Fase 2 y enseña las estrellas de la 1', !m.locked[0] && !m.locked[1] && m.stars[0] >= 1, m);
await shot('09-mapa-2');
// 8. Sin fin sigue accesible (Arcade) y el mapa no lo estorba
await page.evaluate(() => { __hip.ui.show('modes'); });
await click('.scr-modes [data-mode="arcade"]'); await sleep(300);
g = await page.evaluate(() => ({ variant: __hip.game.variant, phase: !!__hip.game.isPhase, name: document.querySelector('.card-arcade .card-name').textContent }));
rec('«Sin fin» arranca el Arcade infinito', g.variant === 'arcade' && !g.phase && g.name === 'Sin fin', g);
// 9. sin errores
rec('sin errores en la página', errors.length === 0, errors.slice(0, 4));
console.log(fails ? `\n${fails} fallan` : '\nTodo OK');
await browser.close();
process.exit(fails ? 1 : 0);
