// Elige modo: carrusel claro. Para 667×375, 844×390 y 1280×720 saca captura y mide:
// tarjetas enteras dentro del carrusel, flechas visibles cuando hay desborde, «Recomendado» sin cortar,
// y navegación por teclado (flecha derecha hasta la última) y por toque en la flecha.
// Uso: node tests/modos-carrusel.mjs [--shots=carpeta] [--url=...]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const shots = opt.shots || '.noche/capturas/modos-carrusel/tmp';
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASA  ' : 'FALLA ') + m); if (!c) fails++; };
for (const [w, h] of [[667, 375], [844, 390], [1280, 720]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 1000, hasTouch: w < 1000, isLandscape: true });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  if (opt.mut) { // mutación: reescribe el código servido; la prueba DEBE fallar (ver tests/modos-carrusel-mut.mjs)
    const MUTS = {
      nocar: [/function carUpdate\(\) \{/, 'function carUpdate() { return;'],
      noarrows: [/<button class="car-arrow[^`]*?<\/button>/g, ''],
      noscroll: [/addEventListener\('scroll', carUpdate/, "addEventListener('scroll', () => {}"],
      noshow: [/requestAnimationFrame\(carUpdate\)/, '0'],
      nointoview: [/el\.scrollIntoView\(/, '(()=>{})('],
    };
    const [re, rep] = MUTS[opt.mut];
    await page.setRequestInterception(true);
    page.on('request', async (rq) => {
      if (!['script', 'document'].includes(rq.resourceType())) return rq.continue();
      try {
        const r = await fetch(rq.url());
        let body = await r.text();
        if (/carUpdate/.test(body)) body = body.replace(re, rep);
        await rq.respond({ status: r.status, contentType: r.headers.get('content-type') || 'text/javascript', body });
      } catch (e) { rq.continue(); }
    });
  }
  await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'q=media', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 });
  await sleep(800);
  await page.evaluate(() => window.__hip.ui.show('modes'));
  await sleep(1500);
  await page.screenshot({ path: `${shots}/modos-${w}.png` });
  const med = () => page.evaluate(() => {
    const box = document.querySelector('.scr-modes .cards').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.scr-modes .card')].map((c) => { const r = c.getBoundingClientRect(); const t = c.querySelector('.card-tag').getBoundingClientRect(); return { l: r.left, r: r.right, tl: t.left, tr: t.right }; });
    const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 4 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
    return { box: { l: box.left, r: box.right }, cards, scroll: document.querySelector('.scr-modes .cards').scrollLeft, over: document.querySelector('.scr-modes .cards').scrollWidth > document.querySelector('.scr-modes .cards').clientWidth + 2,
      prev: vis(document.querySelector('.scr-modes .car-prev')), next: vis(document.querySelector('.scr-modes .car-next')), vw: innerWidth };
  });
  const trunc = await page.evaluate(() => [...document.querySelectorAll('.scr-modes .card-tag, .scr-modes .card-name')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
  ok(trunc.length === 0, `${w}: etiquetas y nombres sin cortar (${trunc.join(', ') || 'ok'})`);
  let m = await med();
  const cut = (c) => c.l < m.box.l - 1 || c.r > m.box.r + 1 || c.l < -1 || c.r > m.vw + 1;
  const cutN = m.cards.filter(cut).length;
  console.log(`${w}: ${m.cards.length} tarjetas, ${cutN} cortadas, desborde=${m.over}, flechas prev=${m.prev} next=${m.next}`);
  if (w >= 1000) ok(cutN === 0 && !m.prev && !m.next, `${w}: las ${m.cards.length} tarjetas se ven enteras y sin flechas`);
  else {
    ok(m.over, `${w}: hay desborde`);
    ok(cutN === 0 || m.next, `${w}: ninguna tarjeta cortada sin flecha que lo indique`);
    ok(m.cards.every((c) => c.tl >= 0 && c.tr <= m.vw || cut(c)), `${w}: «Recomendado» no se corta en la pantalla`);
    // toque en la flecha derecha hasta llegar al final
    for (let i = 0; i < 8 && (await med()).next; i++) { await page.click('.scr-modes .car-next'); await sleep(450); }
    m = await med();
    await page.screenshot({ path: `${shots}/modos-${w}-final.png` });
    ok(!m.next && m.prev, `${w}: al llegar al final desaparece la flecha derecha y sale la izquierda`);
    ok(m.cards.at(-1).r <= m.box.r + 1, `${w}: la última tarjeta queda entera al final`);
    // teclado: volver al principio y avanzar con la flecha derecha hasta la última
    await page.evaluate(() => { document.querySelector('.scr-modes .cards').scrollLeft = 0; });
    await sleep(300);
    for (let i = 0; i < 9; i++) { await page.keyboard.press('ArrowRight'); await sleep(120); }
    await sleep(500);
    const foc = await page.evaluate(() => { const f = document.querySelector('.scr-modes .card.is-focus'); const r = f && f.getBoundingClientRect(); const b = document.querySelector('.scr-modes .cards').getBoundingClientRect(); return f ? { name: f.dataset.mode, inside: r.left >= b.left - 2 && r.right <= b.right + 2 } : null; });
    ok(foc && foc.inside, `${w}: con teclado el foco (${foc && foc.name}) queda dentro del carrusel`);
  }
  await page.close();
}
await browser.close();
console.log(fails ? `${fails} FALLOS` : 'TODO BIEN');
process.exit(fails ? 1 : 0);
