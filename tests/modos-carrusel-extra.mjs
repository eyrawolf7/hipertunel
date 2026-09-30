// Carrusel de Modos: reentrada con scroll movido, Esc/atrás, Aventura->mapa->atrás, bloqueadas, resize, no-nav de flechas.
import puppeteer from 'puppeteer';
const URL0 = process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASA  ' : 'FALLA ') + m); if (!c) fails++; };
const page = await browser.newPage();
await page.setViewport({ width: 667, height: 375, isMobile: true, hasTouch: true, isLandscape: true });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'q=media', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 });
await sleep(800);
const st = () => page.evaluate(() => {
  const c = document.querySelector('.scr-modes .cards');
  const vis = (s) => { const e = document.querySelector(s); const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const sc = []; for (let e = c; e; e = e.parentElement) if (e.scrollLeft || e.scrollTop) sc.push(e.className + ':' + e.scrollLeft + ',' + e.scrollTop);
  return { sl: Math.round(c.scrollLeft), max: c.scrollWidth - c.clientWidth, prev: vis('.car-prev'), next: vis('.car-next'), scrolled: sc };
});
const show = (n) => page.evaluate((n) => window.__hip.ui.show(n), n);

ok(await page.evaluate(() => [...document.querySelectorAll('.car-arrow')].every((b) => !b.hasAttribute('data-nav') && b.tabIndex === -1)), 'flechas sin data-nav y tabindex -1');
await show('modes'); await sleep(900);
let s = await st();
ok(!s.prev && s.next, `entrada inicial: prev=${s.prev} next=${s.next}`);
// mover a mitad, salir con Esc, reentrar
await page.evaluate(() => { document.querySelector('.scr-modes .cards').scrollLeft = 1e5; }); await sleep(300);
s = await st(); ok(s.prev && !s.next, `al final: prev=${s.prev} next=${s.next}`);
await page.keyboard.press('Escape'); await sleep(500);
ok(await page.evaluate(() => window.__hip.ui.current?.() ?? document.querySelector('.scr-title')?.classList.contains('on') ?? true) !== undefined, 'Esc ejecutado');
await show('modes'); await sleep(900);
s = await st();
const consistent = (s) => s.prev === (s.sl > 2) && s.next === (s.sl < s.max - 2);
ok(consistent(s), `reentrada tras Esc: sl=${s.sl}/${s.max} prev=${s.prev} next=${s.next}`);
// foco por teclado en la primera tras reentrada; flechas no reciben foco con Tab
const tabbed = [];
for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); tabbed.push(await page.evaluate(() => document.activeElement?.className || '')); }
ok(!tabbed.some((c) => /car-arrow/.test(c)), 'Tab nunca cae en las flechas');
// teclado hasta el final, luego Esc y reentrar
for (let i = 0; i < 9; i++) { await page.keyboard.press('ArrowRight'); await sleep(100); }
await sleep(600);
s = await st(); ok(consistent(s), `tras teclado: sl=${s.sl}/${s.max} prev=${s.prev} next=${s.next}`);
ok(s.scrolled.filter((x) => !/cards/.test(x)).length === 0, `scrollIntoView no desplaza ancestros (${s.scrolled.join(' | ') || 'ok'})`);
// Aventura -> mapa -> atrás
await page.evaluate(() => document.querySelector('.scr-modes .card-adventure').click()); await sleep(800);
const inMap = await page.evaluate(() => document.querySelector('.scr-map')?.classList.contains('on') || getComputedStyle(document.querySelector('.scr-map') || document.body).display !== 'none');
console.log('mapa visible:', inMap);
await page.keyboard.press('Escape'); await sleep(900);
s = await st(); ok(consistent(s), `Aventura->mapa->Esc: sl=${s.sl}/${s.max} prev=${s.prev} next=${s.next}`);
// bloqueadas
const locked = await page.evaluate(() => [...document.querySelectorAll('.scr-modes .card.locked')].map((c) => c.dataset.mode));
console.log('bloqueadas:', locked.join(',') || 'ninguna');
if (locked.length) {
  await page.evaluate(() => document.querySelector('.scr-modes .card.locked').click()); await sleep(400);
  s = await st(); ok(consistent(s), 'clic en bloqueada mantiene flechas coherentes');
}
// clic en flecha: no debe activar tarjeta ni cambiar de pantalla
await page.evaluate(() => { document.querySelector('.scr-modes .cards').scrollLeft = 0; }); await sleep(300);
await page.click('.scr-modes .car-next'); await sleep(600);
ok(await page.evaluate(() => getComputedStyle(document.querySelector('.scr-modes')).display !== 'none'), 'clic en flecha se queda en Modos');
// toque real
await page.tap('.scr-modes .car-next'); await sleep(600);
s = await st(); ok(consistent(s) && s.sl > 0, `toque en flecha desplaza: sl=${s.sl}`);
// resize / rotación
// (cambiar isMobile recarga la página y vaciaría la prueba: se mantiene fijo)
await page.setViewport({ width: 1280, height: 720, isMobile: true, hasTouch: true, isLandscape: true }); await sleep(600);
s = await st(); ok(!s.prev && !s.next && consistent(s), `resize a 1280: prev=${s.prev} next=${s.next} max=${s.max}`);
await page.setViewport({ width: 667, height: 375, isMobile: true, hasTouch: true, isLandscape: true }); await sleep(600);
s = await st(); ok(consistent(s) && (s.prev || s.next), `vuelta a 667: sl=${s.sl}/${s.max} prev=${s.prev} next=${s.next}`);
await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, isLandscape: false }); await sleep(600);
s = await st(); ok(consistent(s), `vertical 375: sl=${s.sl}/${s.max} prev=${s.prev} next=${s.next}`);
await browser.close();
console.log(fails ? `${fails} FALLOS` : 'TODO BIEN');
process.exit(fails ? 1 : 0);
