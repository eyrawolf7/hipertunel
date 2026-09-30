// Luz de ojo al salir y entrar del tubo (render/index.js, «luz de ojo»).
// Uso: node tests/luz-ojo.mjs [--seed=3] [--w=844 --h=390] [--shots=carpeta]
// Rueda un plegado de la partida clásica con tiempo real (sim congelada, el render sigue), anota la curva de
// exposición y de alcance de la niebla, y compara cada captura con la misma escena sin el efecto (uExp = 1):
// la luminancia media tiene que subir al salir y bajar al entrar, volver a lo normal en < 1 s, y el
// contraste del centro (20 % de la vista) no puede caer por debajo del 90 % del de la escena sin efecto (el resto lo cubre luz-ojo-vivo.mjs, en tiempo real).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const seed = +(opt.seed || 3), W = +(opt.w || 844), H = +(opt.h || 390);
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

await page.evaluate((seed) => {
  const h = window.__hip; h.start('classic', seed);
  window.__freeze = true;
  const r = h.renderer, orig = r.render.bind(r);
  r.render = () => { if (window.__eyeBase && r.grade) { r.grade.uniforms.uExp.value = 1; r.grade.uniforms.uWake.value.set(0, 0); } orig(); };
  // curva por fotograma de pantalla
  window.__curve = [];
  const tick = () => { window.__curve.push([performance.now(), r.eyeExp, r.eyeDip > 0 ? r.eyeWake : 9, r.eyeOut ? 1 : 0]); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  // partida invulnerable: solo queremos el plegado
  const g = h.game; g.crash = (b) => { g.invul = 1; b.hit = true; };
}, seed);

// avanza la simulación hasta que se cumpla la condición
const stepUntil = (cond) => page.evaluate((cond) => {
  const h = window.__hip; const f = new Function('g', 'return ' + cond);
  let n = 0;
  while (!f(h.game) && n++ < 60 * 300) h.step(1);
  return { n, fold: h.game.fold, s: h.game.s };
}, cond);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Un par de capturas del MISMO instante: con el efecto y sin él (dos render() seguidos, canvas leído en
// la misma tarea). Devuelve luminancia media y contraste (desviación típica) del 20 % central.
const pair = () => page.evaluate(async () => {
  const r = window.__hip.renderer, cv = r.renderer.domElement;
  const grab = async (url) => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const all = x.getImageData(0, 0, c.width, c.height).data;
    let m = 0; for (let i = 0; i < all.length; i += 4) m += lum(all, i);
    m /= all.length / 4;
    const cw = Math.round(c.width * 0.2), ch = Math.round(c.height * 0.2);
    const cd = x.getImageData(Math.round((c.width - cw) / 2), Math.round((c.height - ch) / 2), cw, ch).data;
    const k = cd.length / 4; let cm = 0;
    for (let i = 0; i < cd.length; i += 4) cm += lum(cd, i);
    cm /= k;
    let v = 0; for (let i = 0; i < cd.length; i += 4) v += (lum(cd, i) - cm) ** 2;
    return { mean: m, std: Math.sqrt(v / k), url: img.src };
  };
  const exp = r.eyeExp, reach = r.eyeDip > 0 ? r.eyeWake : 9;
  // las dos lecturas del canvas van seguidas y sin esperas (síncronas): ni un fotograma real entre medias
  window.__eyeBase = false; r.render(); const ua = cv.toDataURL('image/png');
  window.__eyeBase = true; r.render(); const ub = cv.toDataURL('image/png');
  window.__eyeBase = false;
  const a = await grab(ua), b = await grab(ub);
  return { exp, reach, mean: a.mean, base: b.mean, std: a.std, stdBase: b.std, url: a.url };
});

async function phase(name, cond) {
  await page.evaluate(() => { window.__curve.length = 0; });
  const at = await stepUntil(cond);
  check(at.n < 60 * 300, `${name}: la simulación llega al plegado (${at.n} pasos)`);
  console.log(`\n== ${name}: fotograma de sim ${at.n}, fold ${at.fold.toFixed(1)}, s ${at.s.toFixed(0)}`);
  const t0 = Date.now();
  const rows = [];
  for (let i = 0; i < 12; i++) {
    const p = await pair();
    if (out && (i === 0 || i === 2 || i === 5)) writeFileSync(`${out}${name}-${i}.png`, Buffer.from(p.url.split(',')[1], 'base64'));
    delete p.url;
    rows.push({ t: Date.now() - t0, ...p });
    await sleep(70);
  }
  for (const r of rows) console.log(`t=${String(r.t).padStart(4)} ms  exp ${r.exp.toFixed(3)} encendido ${r.reach.toFixed(2)}  lum ${r.mean.toFixed(1)} (sin efecto ${r.base.toFixed(1)})  contraste centro ${r.std.toFixed(1)} / ${r.stdBase.toFixed(1)}`);
  await sleep(600);
  const curve = await page.evaluate(() => window.__curve.slice());
  return { rows, curve };
}

const outR = await phase('salir', 'g.fold < 29');
const first = outR.curve.find((c) => c[3] === 1);
check(!!first, 'al salir, el estado pasa a «fuera»');
const peakOut = Math.max(...outR.curve.map((c) => c[1]));
check(peakOut >= 1.15 && peakOut <= 1.32, `al salir la exposición sube al principio (pico ${peakOut.toFixed(3)}, entre 1,15 y 1,32)`);
const tOut = outR.curve.filter((c) => c[3] === 1 && c[1] > 1.01);
const durOut = tOut.length ? tOut[tOut.length - 1][0] - tOut[0][0] : 0;
check(durOut > 100 && durOut < 550, `y se adapta en ${durOut.toFixed(0)} ms (entre 100 y 550)`);
const brighter = Math.max(...outR.rows.slice(0, 3).map((r) => r.mean / r.base));
check(brighter > 1.02, `en las primeras capturas al salir hay más luz que sin efecto (hasta ×${brighter.toFixed(3)})`);
check(outR.rows[outR.rows.length - 1].exp === 1, 'al final del rodaje la exposición ha vuelto a 1');

const inR = await phase('entrar', 'g.fold >= 29.5');
// columnas de la curva: [ms, exposición, progreso del encendido (9 = sin efecto), fuera]
const wake = inR.curve.filter((c) => c[3] === 0 && c[2] < 9);
check(wake.length >= 20, `al entrar hay encendido de paneles (${wake.length} fotogramas de pantalla)`);
check(wake.every((c, i, a) => i === 0 || c[2] >= a[i - 1][2] - 1e-6), 'el encendido avanza sin volver atrás (de los bordes al centro)');
const durIn = wake.length ? wake[wake.length - 1][0] - wake[0][0] : 0;
check(durIn > 450 && durIn < 900, `y dura ${durIn.toFixed(0)} ms (entre 450 y 900)`);
check(inR.curve.every((c) => c[1] === 1 || c[3] === 1), 'dentro del tubo la exposición global queda en 1 (solo cambia por fuera)');
const darker = Math.min(...inR.rows.slice(0, 4).map((r) => r.mean / r.base));
check(darker < 0.97, `en las primeras capturas al entrar hay menos luz que sin efecto (hasta ×${darker.toFixed(3)})`);

// Solo cuentan los fotogramas legibles sin el efecto (contraste del centro ≥ 8): los primeros ~300 ms tras
// plegar salen ya quemados a blanco (HDR) con o sin luz de ojo y no hay nada que leer.
const all = [...outR.rows, ...inR.rows];
const legibles = all.filter((r) => r.stdBase >= 8);
const worst = Math.min(...legibles.map((r) => r.std / r.stdBase));
check(legibles.length >= 15, `hay ${legibles.length} pares legibles de ${all.length} para comparar el contraste del centro`);
check(worst >= 0.9, `el contraste del centro nunca baja del 90 % del de la escena sin efecto (peor ${(worst * 100).toFixed(0)} %)`);
check(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors[0] : ''));

await browser.close();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
