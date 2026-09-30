// Mando simulado en pausa, fin de partida y cuenta atrás (sin ejecutar aún: escrito para reproducir).
// Uso: node tests/qa-mando.mjs [--url=...]   (por defecto $HIP_URL)
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
const rec = (n, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n} — ${JSON.stringify(info)}`); };
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(800);
await page.evaluate(() => {
  const pad = { id: 'QA', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  window.__pad = pad; window.__polls = 0; navigator.getGamepads = () => { window.__polls++; return [pad, null, null, null]; };
});
const press = async (i) => { await page.evaluate((i) => { __pad.buttons[i] = { pressed: true, value: 1 }; }, i); await sleep(90); await page.evaluate((i) => { __pad.buttons[i] = { pressed: false, value: 0 }; }, i); await sleep(150); };
const S = () => page.evaluate(() => ({ st: __hip.state, scr: document.getElementById('ui').dataset.screen, foc: document.querySelector('.is-focus')?.dataset.act || document.querySelector('.is-focus')?.dataset.mode }));

// 1. pollPad una vez por fotograma (getGamepads ~ frames, no 2x)
await page.evaluate(() => { __polls = 0; window.__fr = 0; (function f() { __fr++; requestAnimationFrame(f); })(); }); await sleep(1000);
const pl = await page.evaluate(() => ({ polls: __polls, frames: __fr }));
rec('getGamepads <= 1 por fotograma en el título', pl.polls <= pl.frames + 2, pl);

// 2. pausa: B reanuda, Start reanuda, A en Continuar reanuda
await page.evaluate(() => __hip.start('classic', 3)); await sleep(300);
await press(9); rec('Start pausa', (await S()).st === 'paused', await S());
await press(1); await sleep(200); rec('B en pausa reanuda', ['countdown', 'play'].includes((await S()).st), await S());
await sleep(1500); await press(9); await press(9); await sleep(200); rec('Start,Start reanuda', ['countdown', 'play'].includes((await S()).st), await S());

// 3. (c) cuenta atrás: Start y B vuelven a pausar (Zorro no tiene vuelo de arranque)
await page.evaluate(() => __hip.startMenu('zorro')); await sleep(300);
rec('empieza en cuenta atrás', (await S()).st === 'countdown', await S());
await press(9); rec('Start pausa en la cuenta atrás', (await S()).st === 'paused', await S());
await press(9); await sleep(150); rec('Start reanuda', ['countdown', 'play'].includes((await S()).st), await S());
await press(1); rec('B pausa en la cuenta atrás', (await S()).st === 'paused', await S());
await press(1); await sleep(150); rec('B reanuda', ['countdown', 'play'].includes((await S()).st), await S());

// 3b. (b) la A pulsada desde el menú no salta al empezar en Zorro
await page.evaluate(() => { __hip.start('zorro', 3); __hip.game.alive = false; }); await sleep(200);
await page.evaluate(() => { __pad.buttons[0] = { pressed: true, value: 1 }; }); await sleep(120);
await page.evaluate(() => __hip.startMenu('zorro'));
const jHeld = await page.evaluate(() => __hip.input.consumeJump());
rec('A aún pulsada al empezar no cuenta como salto', jHeld === false, { jHeld });
await page.evaluate(() => { __pad.buttons[0] = { pressed: false, value: 0 }; }); await sleep(120);
await page.waitForFunction(() => __hip.state === 'play', { timeout: 6000 }); await sleep(100);
await page.evaluate(() => { const i = __hip.input, f = i.consumeJump.bind(i); window.__jumps = 0; i.consumeJump = () => { const j = f(); if (j) __jumps++; return j; }; });
await page.evaluate(() => { __pad.buttons[0] = { pressed: true, value: 1 }; }); await sleep(200);
const jNew = (await page.evaluate(() => __jumps)) > 0;
await page.evaluate(() => { __pad.buttons[0] = { pressed: false, value: 0 }; }); await sleep(120);
rec('una A nueva sí salta', jNew === true, { jNew });

// 3b2. un toque de ratón en la pausa (jumpQ en Zorro) no salta al reanudar
await page.evaluate(() => __hip.startMenu('zorro')); await sleep(300);
await press(9); await sleep(100);
const jq = await page.evaluate(() => (__hip.input.state.jumpQ = true));   // lo que deja un toque de ratón en Zorro
await press(9); await sleep(300);
const jq2 = await page.evaluate(() => __hip.input.state.jumpQ);
await sleep(1600);
rec('toque en la pausa no deja un salto pendiente', jq2 === false, { jqAntes: jq, jqTras: jq2, st: (await S()).st });

// 3c. (d) A del mando en un menú enseña el anillo de foco (nav-kbd) sin haber navegado
await page.evaluate(() => { __hip.start('classic', 3); __hip.game.alive = false; window.__freeze = false; });
for (let i = 0; i < 60 && (await S()).st !== 'over'; i++) await sleep(50);
await sleep(800);
await page.evaluate(() => document.getElementById('ui').classList.remove('nav-kbd'));
await press(13); await page.evaluate(() => document.getElementById('ui').classList.remove('nav-kbd'));
await press(0);
rec('A pone nav-kbd', await page.evaluate(() => document.getElementById('ui').classList.contains('nav-kbd')), await S());

// 4. fin de partida: A con el foco en otro botón
await page.evaluate(() => { __hip.start('classic', 3); const g = __hip.game; g.crash = (b) => { b.hit = false; }; });
await page.evaluate(() => { window.__freeze = false; const g = __hip.game; g.alive = false; });
for (let i = 0; i < 100 && (await S()).st !== 'over'; i++) await sleep(20);
// (a) B recién llegada la pantalla de fin no la cierra (guarda de 600 ms, como A)
await page.evaluate(() => { __pad.buttons[1] = { pressed: true, value: 1 }; }); await sleep(60);
await page.evaluate(() => { __pad.buttons[1] = { pressed: false, value: 0 }; }); await sleep(60);
rec('over: B antes de 600 ms no sale', (await S()).st === 'over', await S());
await sleep(800);
await press(15 - 0 + 0 - 0); // derecha del d-pad: mueve el foco
await press(13);             // abajo
const f = await S();
await press(0); await sleep(300);
const a = await S();
rec('over: A ejecuta el botón enfocado, no siempre "Otra vez"', f.foc === 'restart' || a.st === 'attract', { focoAntes: f, despues: a });
await press(1); await sleep(200);
console.log('errores', errors.slice(0, 3));
await browser.close();
process.exit(fails ? 1 : 0);
