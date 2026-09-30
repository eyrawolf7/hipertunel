// Retoques de menús y HUD: mapa de Aventura, Pausa, flechas de impulso, cuenta atrás y «Esc volver».
// Saca capturas y mide cada punto en 667×375, 844×390 y 1280×720.
// Uso: node tests/retoques.mjs [--shots=carpeta] [--url=...]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const shots = opt.shots || '.noche/capturas/retoques/tmp';
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VPS = [[667, 375], [844, 390], [1280, 720]];
const STAGES = Array.from({ length: 12 }, (_, i) => ({ name: ['Islas', 'Selva', 'Noche', 'Templo', 'Fuego', 'Cielo'][i % 6] + ' ' + (i + 1), stars: i < 3 ? 3 - (i % 3) : 0, locked: i >= 4, boss: i === 2 || i === 4, best: i === 3 ? 0.4 : 0 }));
const MISS = [
  { text: 'Recoge 30 monedas', got: 12, n: 30, done: false },
  { text: 'Pasa por 5 piruetas', got: 0, n: 5, done: false },
  { text: 'Llega a 2.000 m', got: 2000, n: 2000, done: true },
];
let fails = 0;
const check = (ok, txt) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${txt}`); if (!ok) fails++; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
for (const [w, h] of VPS) {
  const touch = w < 1000;
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, isLandscape: true });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'q=media', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 });
  await sleep(800);
  const tag = `${w}`;

  // ---- 1. Mapa: luminancia de las losetas bloqueadas frente a las abiertas ----
  await page.evaluate((list) => { window.__hip.ui.map(list); window.__hip.ui.show('map'); }, STAGES);
  await page.waitForFunction(() => document.querySelectorAll('.scr-map .stage.locked').length >= 8 && [...document.querySelectorAll('.scr-map .stage')].every((e) => e.getBoundingClientRect().width > 0), { timeout: 10000 });
  await sleep(2200);
  await page.screenshot({ path: `${shots}/mapa-${tag}.png` });
  const lum = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const mean = (el) => {
      const r = el.getBoundingClientRect();
      const x0 = Math.round((r.left + r.width * 0.15) * k), y0 = Math.round((r.top + r.height * 0.15) * k), ww = Math.round(r.width * 0.7 * k), hh = Math.round(r.height * 0.7 * k);
      const d = x.getImageData(x0, y0, ww, hh).data; let s = 0, w = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; w += d[i] - d[i + 2]; }
      return [s / n, w / n]; // luminancia y calidez (rojo − azul)
    };
    const avg = (sel) => { const l = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.left >= -2 && r.right <= innerWidth + 2 && r.top >= -2 && r.bottom <= innerHeight + 2; }); const m = l.map(mean); return { n: l.length, v: l.length ? m.reduce((a, e) => a + e[0], 0) / l.length : 0, warm: l.length ? m.reduce((a, e) => a + e[1], 0) / l.length : 0 }; };
    return { lock: avg('.scr-map .stage.locked'), open: avg('.scr-map .stage:not(.locked)') };
  }, await page.screenshot({ encoding: 'base64' }));
  const ratio = lum.open.v ? lum.lock.v / lum.open.v : 0;
  check(lum.lock.n > 0 && lum.open.n > 0 && ratio >= 0.55, `mapa ${w}: luminancia bloqueadas/abiertas ${(100 * ratio).toFixed(0)} % (≥ 55 %; ${lum.lock.n} bloqueadas y ${lum.open.n} abiertas a la vista)`);
  check(lum.lock.n > 0 && lum.lock.warm >= 18, `mapa ${w}: las bloqueadas son de piedra cálida (rojo − azul = ${lum.lock.warm.toFixed(0)}, ≥ 18; antes gris frío ~0)`);

  // ---- 2. Pausa: título, cajas y barras de misión ----
  await page.evaluate((m) => { window.__hip.ui.missions(m, { level: 1, name: 'Novato', toNext: 3 }); window.__hip.ui.show('pause'); }, MISS);
  await sleep(1600);
  await page.screenshot({ path: `${shots}/pausa-${tag}.png` });
  const pa = await page.evaluate(() => {
    const R = (s) => { const e = document.querySelector('.scr-pause ' + s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const hit = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const lis = [...document.querySelectorAll('.scr-pause .miss li')];
    const bars = lis.map((li) => { const b = li.querySelector('.mi-bar'); const r = b && b.getBoundingClientRect(); const cs = b && getComputedStyle(b); return r ? { w: r.width, h: r.height, vis: cs.display !== 'none' && cs.visibility !== 'hidden' } : null; });
    return { plate: R('.pc-plate'), card: R('.pause-card'), btns: R('.pc-btns'), miss: R('.miss-box'), missTitle: R('.miss-title'), lis: lis.length, bars, vw: innerWidth, vh: innerHeight };
  });
  check(pa.plate && pa.plate.t >= 0 && pa.plate.l >= 0 && pa.plate.r <= pa.vw, `pausa ${w}: el título está dentro de la pantalla (arriba ${pa.plate?.t.toFixed(0)} px)`);
  const gap = pa.plate && pa.btns && pa.miss ? Math.min(pa.btns.t, pa.miss.t) - pa.plate.b : -99;
  check(gap >= 4, `pausa ${w}: hueco entre el título y lo de debajo ${gap.toFixed(0)} px (≥ 4; título abajo ${pa.plate?.b.toFixed(0)}, botones arriba ${pa.btns?.t.toFixed(0)}, misiones arriba ${pa.miss?.t.toFixed(0)}, tarjeta abajo ${pa.card?.b.toFixed(0)} de ${pa.vh})`);
  check(pa.lis >= 3 && pa.bars.every((b) => b && b.vis && b.w > 20 && b.h >= 3), `pausa ${w}: cada misión tiene barra visible (${pa.lis} misiones, ${pa.bars.filter((b) => b && b.vis && b.w > 20).length} con barra)`);

  // ---- 3. HUD: flechas de impulso vacía y llena ----
  await page.evaluate(() => { window.__hip.start('arcade', 5); window.__freeze = true; });
  await sleep(1500);
  await page.evaluate(() => { window.__hip.ui.hud({ jumps: { n: 1, part: 0.4, free: false }, mult: 1, points: 120, distM: 240, speedMS: 50, level: 1, coins: 3, mode: 'arcade', countdown: 0 }); });
  await sleep(400);
  await page.screenshot({ path: `${shots}/hud-impulso-${tag}.png` });
  const ch = await page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const k = img.width / innerWidth;
    const col = (el) => {
      const r = el.getBoundingClientRect();
      const d = x.getImageData(Math.round((r.left + r.width * 0.3) * k), Math.round((r.top + r.height * 0.3) * k), Math.round(r.width * 0.4 * k), Math.round(r.height * 0.4 * k)).data;
      let R = 0, G = 0, B = 0, S = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); S += mx ? (mx - mn) / mx : 0; }
      return { r: R / n, g: G / n, b: B / n, sat: S / n };
    };
    const full = [...document.querySelectorAll('.hud-br .chev.full')], empty = [...document.querySelectorAll('.hud-br .chev:not(.full)')];
    const mean = (l) => { const m = l.map(col); const a = (f) => m.reduce((s, e) => s + e[f], 0) / (m.length || 1); return { n: l.length, r: a('r'), g: a('g'), b: a('b'), sat: a('sat') }; };
    return { full: mean(full), empty: mean(empty) };
  }, await page.screenshot({ encoding: 'base64' }));
  check(ch.full.n > 0 && ch.empty.n > 0 && ch.empty.b - ch.empty.r >= 12 && ch.empty.sat < ch.full.sat, `flechas ${w}: vacía azulada (azul − rojo = ${(ch.empty.b - ch.empty.r).toFixed(0)}, ≥ 12) y menos saturada que la llena (${ch.empty.sat.toFixed(2)} < ${ch.full.sat.toFixed(2)})`);
  // ---- 4. Cuenta atrás al reanudar en pleno salto: el número no tapa el 20 % central ----
  await page.addStyleTag({ content: '.htui .hud-count.go { animation: none !important; opacity: 1 !important; }' });
  const cnt = await page.evaluate(() => {
    window.__hip.ui.hud({ jumps: { n: 1, part: 0, free: false }, mult: 1, points: 120, distM: 240, speedMS: 50, level: 2, coins: 3, mode: 'arcade', countdown: 1 });
    const e = document.querySelector('[data-hud="count"]'); if (!e) return null;
    const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight, txt: e.textContent };
  });
  await sleep(450);
  await page.screenshot({ path: `${shots}/cuenta-${tag}.png` });
  if (cnt) {
    // centro = 20 % del área, es decir un rectángulo de lado √0,2 del ancho y del alto
    const f = Math.sqrt(0.2) / 2, cx0 = cnt.vw * (0.5 - f), cx1 = cnt.vw * (0.5 + f), cy0 = cnt.vh * (0.5 - f), cy1 = cnt.vh * (0.5 + f);
    const ov = Math.max(0, Math.min(cnt.r, cx1) - Math.max(cnt.l, cx0)) * Math.max(0, Math.min(cnt.b, cy1) - Math.max(cnt.t, cy0));
    check(ov === 0, `cuenta atrás ${w}: la caja del número se solapa ${(100 * ov / (cnt.vw * cnt.vh)).toFixed(1)} % de la pantalla con el 20 % central (debe ser 0)`);
  } else check(false, `cuenta atrás ${w}: no hay elemento [data-hud=count]`);

  // ---- 5. «Esc volver» oculto en pantallas táctiles ----
  const matches = await page.evaluate(() => matchMedia('(hover: none)').matches);
  for (const scr of ['modes', 'settings']) {
    await page.evaluate((s) => window.__hip.ui.show(s), scr);
    await sleep(600);
    const hint = await page.evaluate(() => [...document.querySelectorAll('.scr.on .head-hint')].map((e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0; }));
    check(hint.length > 0 && hint.every((v) => v === !matches), `pista «Esc volver» en ${scr} ${w}: hover:none=${matches}, visibles ${hint.filter(Boolean).length}/${hint.length} (táctil → 0, con ratón → todas)`);
  }
  check(errs.length === 0, `sin errores de página ${w} (${errs.length})`);
  await page.close();
}
await browser.close();
console.log(fails ? `${fails} FALLOS` : 'Todo OK');
process.exit(fails ? 1 : 0);
