// Fondo de los menús: tono cálido y desenfocado. Para cada pantalla de menú y resolución saca
// una captura normal y otra con el contenido de la interfaz oculto (solo escena + velo), y mide
// sobre esta última, sin el 30 % central: tono medio (°) y detalle (varianza del laplaciano).
// Uso: node tests/fondo-menus.mjs [--shots=carpeta] [--base] [--url=...]
//   --base guarda las cifras como «antes» en .noche/fondo-menus-base.json; sin él compara con ellas.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const shots = opt.shots || '.noche/capturas/fondo-menus/tmp';
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCREENS = ['title', 'modes', 'map', 'shop', 'settings', 'pause', 'over'];
const VPS = [[844, 390], [1280, 720]];
const GOLD = 38, MAX_DEG = 15; // tono de la arenisca dorada de portada.png (~38°) y tolerancia
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
const res = {};
for (const [w, h] of VPS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 1000, hasTouch: w < 1000, isLandscape: true });
  await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'fps&q=media', { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 });
  await sleep(800);
  for (const name of SCREENS) {
    await page.evaluate((n) => window.__hip.ui.show(n), name);
    await sleep(900);
    await page.screenshot({ path: `${shots}/${name}-${w}.png` });
    await page.addStyleTag({ content: '.htui .scr > *:not(.vig){visibility:hidden!important} .fps{visibility:hidden!important} .htui .scr *{animation:none!important}' });
    await sleep(200);
    await page.screenshot({ path: `${shots}/${name}-${w}-fondo.png` });
    const b64 = (await page.screenshot({ encoding: 'base64' }));
    const m = await page.evaluate(async (b64, mascot) => {
      const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const W = c.width, H = c.height, d = x.getImageData(0, 0, W, H).data;
      const cx0 = W * (0.5 - 0.5 * Math.sqrt(0.3)), cx1 = W * (0.5 + 0.5 * Math.sqrt(0.3)), cy0 = H * (0.5 - 0.5 * Math.sqrt(0.3)), cy1 = H * (0.5 + 0.5 * Math.sqrt(0.3));
      // el zorro de la portada y la tienda (abajo a la derecha) se deja nítido a propósito: no cuenta como fondo
      const inCenter = (i, j) => (i >= cx0 && i < cx1 && j >= cy0 && j < cy1) || (mascot && i >= W * 0.66 && j >= H * 0.35);
      const g = new Float32Array(W * H); let sx = 0, sy = 0, n = 0;
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 4, r = d[k] / 255, gg = d[k + 1] / 255, b = d[k + 2] / 255;
        g[j * W + i] = 0.299 * r + 0.587 * gg + 0.114 * b;
        if (inCenter(i, j)) continue;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        if (mx - mn < 0.02) continue; // sin color: no aporta tono
        let hh = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4;
        hh *= 60; if (hh < 0) hh += 360;
        sx += Math.cos(hh * Math.PI / 180); sy += Math.sin(hh * Math.PI / 180); n++;
      }
      let hue = Math.atan2(sy, sx) * 180 / Math.PI; if (hue < 0) hue += 360;
      let s = 0, s2 = 0, m = 0;
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
        if (inCenter(i, j)) continue;
        const l = g[j * W + i - 1] + g[j * W + i + 1] + g[(j - 1) * W + i] + g[(j + 1) * W + i] - 4 * g[j * W + i];
        s += l; s2 += l * l; m++;
      }
      const mean = s / m;
      return { hue: +hue.toFixed(1), lap: +((s2 / m - mean * mean) * 1e4).toFixed(2) };
    }, b64, name === 'title' || name === 'shop');
    await page.evaluate(() => document.querySelectorAll('style').forEach((st) => { if (st.textContent.includes('visibility:hidden!important')) st.remove(); }));
    (res[name] ||= {})[w] = m;
  }
  await page.close();
}
// fps en el menú de título, calidad media
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(URL0 + (URL0.includes('?') ? '&' : '?') + 'fps&q=media', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.ui, { timeout: 15000 });
await sleep(4000);
const fps = await page.evaluate(() => parseFloat(document.querySelector('.fps')?.textContent) || 0);
// la partida no lleva velo ni desenfoque; la pausa sobre la partida sí, y al volver se quita
const vigs = () => page.evaluate(() => [...document.querySelectorAll('.htui .scr.on .vig')].filter((v) => getComputedStyle(v).backdropFilter !== 'none').length);
await page.evaluate(() => { window.__hip.start('classic', 1); window.__freeze = true; });
await sleep(4500);
const enPartida = await vigs();
await page.evaluate(() => window.__hip.ui.show('pause')); await sleep(300);
const enPausa = await vigs();
await page.evaluate(() => window.__hip.ui.show('hud')); await sleep(300);
const trasPausa = await vigs();
const partidaOk = enPartida === 0 && enPausa > 0 && trasPausa === 0;
console.log(`${partidaOk ? 'PASS' : 'FAIL'} partida sin desenfoque (partida ${enPartida}, pausa ${enPausa}, al volver ${trasPausa})`);
await browser.close();
const out ={ gold: GOLD, res, fps };
console.log(JSON.stringify(out, null, 1));
const baseF = '.noche/fondo-menus-base.json';
if (opt.base) { writeFileSync(baseF, JSON.stringify(out, null, 1)); console.log('base guardada'); process.exit(0); }
let fails = 0;
const base = existsSync(baseF) ? JSON.parse(readFileSync(baseF)) : null;
const dh = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
for (const n of SCREENS) for (const [w] of VPS) {
  const m = res[n][w], b = base?.res[n]?.[w];
  const okH = dh(m.hue, GOLD) < MAX_DEG, okL = b ? m.lap <= b.lap * 0.4 : m.lap <= 5; // -60 % o más frente a la base; sin base, límite absoluto
  console.log(`${okH && okL ? 'PASS' : 'FAIL'} ${n} ${w}: tono ${m.hue}° (dif ${dh(m.hue, GOLD).toFixed(0)}°), detalle ${m.lap}${b ? ` (antes ${b.lap}, ${(100 * (m.lap / b.lap - 1)).toFixed(0)} %)` : ''}`);
  if (!okH || !okL) fails++;
}
if (!partidaOk) fails++;
console.log(`fps menú (media): ${fps}`); if (fps < 58) fails++;
process.exit(fails ? 1 : 0);
