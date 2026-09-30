// Mide la portada (logo, marco de Jugar, botones) en % del ancho y comprueba que cabe entera,
// sin desbordes y con aire antes de «Pulsa para jugar». Uso: node tests/portada-escala.mjs [--shot=carpeta]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const url = process.env.HIP_URL || 'http://localhost:5173/';
const shot = process.argv.find((a) => a.startsWith('--shot='))?.slice(7);
const out = shot && new URL(`./shots/${shot}/`, import.meta.url).pathname;
if (out) mkdirSync(out, { recursive: true });
// Maqueta: logo ~62 % del ancho, marco de Jugar ~28 % (el marco pintado da 26-27 %); margen ±3 puntos.
// Solo se exige la escala en horizontal; en vertical (390×844) manda el mínimo del logo.
const OBJ = { logo: 62, jugar: 27, tol: 3 };
const TAMANOS = [[667, 375], [844, 390], [932, 430], [1280, 720], [1920, 1080], [390, 844]];
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
let fail = 0;
for (const [w, h] of TAMANOS) {
  const horizontal = w > h;
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 });
  await page.waitForSelector('.scr-title.on', { timeout: 5000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  const m = await page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const root = document.querySelector('.htui');
    return {
      skin: root.classList.contains('has-logo') && root.classList.contains('has-marco-jugar'),
      activa: !!document.querySelector('.scr-title.on'),
      sw: document.documentElement.scrollWidth,
      logo: r('.scr-title .logo'), frame: r('.scr-title .play-frame'), row: r('.scr-title .title-row'), press: r('.scr-title .press'),
    };
  });
  if (!m.activa || !m.skin || !m.logo || !m.frame || !m.row) { console.log(`${w}×${h} FALLA: portada no activa o sin piezas pintadas (${JSON.stringify({ activa: m.activa, skin: m.skin })})`); fail++; await page.close(); continue; }
  const pct = (v) => +(100 * v / w).toFixed(1);
  const okLogo = !horizontal || Math.abs(pct(m.logo.w) - OBJ.logo) <= OBJ.tol;
  const okJugar = !horizontal || Math.abs(pct(m.frame.w) - OBJ.jugar) <= OBJ.tol;
  const dentro = m.logo.x >= 0 && m.logo.r <= w && m.frame.r <= w && m.sw <= w && m.logo.y >= 0 && m.row.b <= h - 4;
  // aire entre la fila Modos/Tienda/Ajustes y «Pulsa para jugar» (si el texto está a la vista)
  const aire = m.press ? m.press.y - m.row.b : 99;
  const okAire = aire >= 6 && (!horizontal || !!m.press);
  console.log(`${w}×${h} logo ${pct(m.logo.w)} % (${okLogo ? 'OK' : 'FALLA'}) · marco ${pct(m.frame.w)} % (${okJugar ? 'OK' : 'FALLA'}) · logo y=${m.logo.y.toFixed(0)} · fila abajo ${m.row.b.toFixed(0)}/${h} · aire ${aire.toFixed(0)} px (${okAire ? 'OK' : 'FALLA'}) · ${dentro ? 'dentro' : 'DESBORDA'} · errores ${errs.length}`);
  if (!okLogo || !okJugar || !dentro || !okAire || errs.length) fail++;
  if (out) await page.screenshot({ path: `${out}titulo-${w}x${h}.png` });
  await page.close();
}
await browser.close();
process.exit(fail ? 1 : 0);
