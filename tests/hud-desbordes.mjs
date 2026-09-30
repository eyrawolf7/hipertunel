// HUD sin textos que se salgan: a 667×375, 844×390 y 1280×720, con 5 cifras de distancia y 6 de puntos.
// Uso: node tests/hud-desbordes.mjs [--url=...] [--shots=carpeta]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
if (opt.shots) mkdirSync(opt.shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [[667, 375], [844, 390], [1280, 720]];
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let fails = 0;
for (const [w, h] of VPS) {
  for (const [mode, timeLeft] of [['arcade', null], ['classic', null], ['time', 60], ['survival', 5]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: w < 1000, hasTouch: w < 1000, isLandscape: true });
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
    await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 }); await sleep(600);
    await page.evaluate((mode, timeLeft) => {
      const ui = window.__hip.ui; ui.show('hud');
      ui.hud({ distM: 99999, best: 1000, speedMS: 100, level: 3, coins: 99999, mult: 5, points: 999999, mode, timeLeft });
    }, mode, timeLeft);
    await sleep(700);
    const r = await page.evaluate((timeLeft) => {
      const root = document.querySelector('.scr-hud'), bad = [];
      if (!document.querySelector('.htui').classList.contains('has-chip-crema')) bad.push({ why: 'sin has-chip-crema: no se prueba el marco pintado' });
      const chips = [...root.querySelectorAll('.hud-chip')].filter((c) => c.getClientRects().length);
      for (const el of root.querySelectorAll('*')) {
        if (!el.getClientRects().length) continue;
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') bad.push({ el: el.className || el.tagName, why: 'scrollWidth', sw: el.scrollWidth, cw: el.clientWidth });
      }
      const timerEl = root.querySelector('.hud-timer');
      if (timeLeft != null) {
        const tr = timerEl.getBoundingClientRect();
        if (!timerEl.getClientRects().length || timerEl.classList.contains('off')) bad.push({ why: 'el temporizador no se ve' });
        else if (tr.left < 0 || tr.right > innerWidth || tr.bottom > innerHeight) bad.push({ why: 'temporizador fuera de la pantalla', tr: [tr.left, tr.right, tr.bottom].map(Math.round) });
      }
      for (const c of chips) {
        const cr = c.getBoundingClientRect();
        const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        for (let n; (n = tw.nextNode());) {
          if (!n.textContent.trim()) continue;
          const rg = document.createRange(); rg.selectNodeContents(n); const t = rg.getBoundingClientRect();
          if (t.left < cr.left - 1 || t.right > cr.right + 1 || t.top < cr.top - 1 || t.bottom > cr.bottom + 1) bad.push({ el: c.className, why: 'texto fuera del marco', text: n.textContent.trim(), t: [t.left, t.right, t.top, t.bottom].map(Math.round), c: [cr.left, cr.right, cr.top, cr.bottom].map(Math.round) });
          if (t.right > innerWidth || t.left < 0) bad.push({ el: c.className, why: 'fuera de la pantalla', text: n.textContent.trim() });
        }
        if (cr.right > innerWidth || cr.left < 0 || cr.bottom > innerHeight) bad.push({ el: c.className, why: 'marco fuera de la pantalla', c: [cr.left, cr.right, cr.top, cr.bottom].map(Math.round) });
      }
      return { chips: chips.length, bad, texts: chips.map((c) => c.textContent.trim()) };
    }, timeLeft);
    const all = r.texts.join(' ');
    if (!all.includes('99.999m') || !all.includes('999.999 pts') || !all.includes('km/h')) r.bad.push({ why: 'falta el chip de distancia, puntos o velocidad', texts: r.texts });
    const ok = r.bad.length === 0 && r.chips >= 4;
    if (!ok) fails++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${w}×${h} ${mode}  chips=${r.chips} ${JSON.stringify(r.texts)}${ok ? '' : ' ' + JSON.stringify(r.bad)}`);
    if (opt.shots) await page.screenshot({ path: `${opt.shots}/hud-${w}x${h}-${mode}.png` });
    await page.close();
  }
}
await browser.close();
process.exit(fails ? 1 : 0);
