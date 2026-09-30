// Luz de ojo EN VIVO: juega el clásico en tiempo real (bot invulnerable por la ruta normal de entrada) y, en
// cada fotograma de pantalla dentro del primer segundo tras salir o entrar del tubo, mide la escena con el
// efecto y sin él (mismo fotograma: render, lectura, render sin efecto, lectura, render final).
// Uso: node tests/luz-ojo-vivo.mjs [--seed=3] [--w=844 --h=390] [--secs=60] [--shots=carpeta]
// Comprueba: hay al menos 2 salidas y 2 entradas reales; el contraste del 20 % central con efecto es ≥ 90 % del
// de sin efecto en los fotogramas legibles; y ningún fotograma de entrada queda quemado (contraste central < 3)
// si sin efecto no lo estaba.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const seed = +(opt.seed || 3), W = +(opt.w || 844), H = +(opt.h || 390), SECS = +(opt.secs || 60);
const out = opt.shots ? new URL(opt.shots.endsWith('/') ? opt.shots : opt.shots + '/', `file://${process.cwd()}/`).pathname : null;
if (out) mkdirSync(out, { recursive: true });
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASA  ' : 'FALLA ') + msg); if (!ok) fails++; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(process.env.HIP_URL || 'http://localhost:5173/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game);

await page.evaluate((seed, shots) => {
  const h = window.__hip; h.start('classic', seed);
  const g = h.game, r = h.renderer, cv = r.renderer.domElement;
  h.input.steer = () => h.bot(g);
  h.input.consumeJump = () => false;
  g.invul = 1e9;
  const small = document.createElement('canvas'); small.width = 211; small.height = 98;   // 1/4 de 844×390
  const sx = small.getContext('2d', { willReadFrequently: true });
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  const meas = () => {
    sx.drawImage(cv, 0, 0, small.width, small.height);
    const all = sx.getImageData(0, 0, small.width, small.height).data;
    let m = 0; for (let i = 0; i < all.length; i += 4) m += lum(all, i);
    m /= all.length / 4;
    const cw = Math.round(small.width * 0.2), ch = Math.round(small.height * 0.2);
    const cd = sx.getImageData(Math.round((small.width - cw) / 2), Math.round((small.height - ch) / 2), cw, ch).data;
    const k = cd.length / 4; let cm = 0;
    for (let i = 0; i < cd.length; i += 4) cm += lum(cd, i);
    cm /= k;
    let v = 0; for (let i = 0; i < cd.length; i += 4) v += (lum(cd, i) - cm) ** 2;
    return { mean: m, std: Math.sqrt(v / k) };
  };
  window.__rows = []; window.__trans = { out: 0, in: 0 }; window.__png = {};
  let last = null;
  const orig = r.render.bind(r);
  r.render = () => {
    orig();
    if (r.eyeOut !== last) { if (last !== null && r.eyeT < 0.05) window.__trans[r.eyeOut ? 'out' : 'in']++; last = r.eyeOut; }
    if (!r.grade || r.eyeT > 1.0 || !window.__sample) return;
    const withFx = meas(), url = shots && r.eyeT < 0.4 ? cv.toDataURL('image/png') : null;
    const e = r.grade.uniforms.uExp.value, w = r.grade.uniforms.uWake.value.x;
    r.grade.uniforms.uExp.value = 1; r.grade.uniforms.uWake.value.x = 0;
    orig(); const base = meas();
    r.grade.uniforms.uExp.value = e; r.grade.uniforms.uWake.value.x = w;
    orig();
    const key = (r.eyeOut ? 'out' : 'in') + window.__trans[r.eyeOut ? 'out' : 'in'];
    if (url && !window.__png[key]) window.__png[key] = url;
    window.__rows.push({ out: r.eyeOut, t: r.eyeT, exp: r.eyeExp, dip: r.eyeDip, mean: withFx.mean, std: withFx.std, bMean: base.mean, bStd: base.std, s: g.s });
  };
  window.__sample = true;
}, seed, !!out);

await new Promise((r) => setTimeout(r, SECS * 1000));
const res = await page.evaluate(() => ({ rows: window.__rows, trans: window.__trans, png: window.__png, fold: window.__hip.game.s }));
if (out) for (const [k, u] of Object.entries(res.png)) writeFileSync(`${out}vivo-${k}.png`, Buffer.from(u.split(',')[1], 'base64'));

const rowsOut = res.rows.filter((r) => r.out), rowsIn = res.rows.filter((r) => !r.out);
console.log(`transiciones reales: ${res.trans.out} salidas, ${res.trans.in} entradas; ${rowsOut.length} y ${rowsIn.length} fotogramas medidos (partida hasta s=${res.fold.toFixed(0)})`);
const peak = Math.max(1, ...rowsOut.map((r) => r.exp));
const dark = Math.min(1, ...rowsIn.map((r) => r.mean / r.bMean));
console.log(`salida: exposición pico ${peak.toFixed(3)}; entrada: luminancia mínima ×${dark.toFixed(3)} de la de sin efecto`);
const legibles = res.rows.filter((r) => r.bStd >= 8);
const worst = Math.min(...legibles.map((r) => r.std / r.bStd));
const quemados = rowsIn.filter((r) => r.std < 3 && r.bStd >= 3);
const quemadosBase = rowsIn.filter((r) => r.bStd < 3);
console.log(`entrada: ${quemadosBase.length} de ${rowsIn.length} fotogramas ya salen sin contraste (< 3) SIN el efecto`);
check(res.trans.out >= 2 && res.trans.in >= 2, 'hubo al menos 2 salidas y 2 entradas reales del tubo');
check(peak > 1.15, `la salida sobreexpone (pico ${peak.toFixed(3)})`);
check(dark < 0.98, `la entrada oscurece (×${dark.toFixed(3)})`);
check(legibles.length >= 20, `${legibles.length} fotogramas legibles para comparar (de ${res.rows.length})`);
check(worst >= 0.9, `contraste del centro con efecto ≥ 90 % del de sin efecto (peor ${(worst * 100).toFixed(0)} %)`);
check(quemados.length === 0, `el efecto no quema ningún fotograma que estuviera legible (${quemados.length})`);
check(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors[0] : ''));
await browser.close();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
