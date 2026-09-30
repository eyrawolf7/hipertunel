// Cámara con peso (render/index.js, this.weight): bajón elástico al aterrizar, respiración y mirada
// adelantada al giro. Juega Arcade en tiempo real con un bot invulnerable y mide, fotograma a fotograma,
// cuánto se mueve el centro de la vista (fracción del alto), que el bajón aparezca y se recupere tras
// un plegado y tras el salto entre mundos, que la mirada se adelante hacia el lado en que se mueve la
// cámara y los fps. Uso: node tests/camara-peso.mjs [--secs=20] [--q=media]
import puppeteer from 'puppeteer';

const URL0 = process.env.HIP_URL || 'http://localhost:5173/';
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const SECS = +arg('secs', 20), Q = arg('q', 'media'), SEED = 7;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const rec = (ok, name, info) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${name}${info ? '  — ' + JSON.stringify(info) : ''}`); };

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${URL0}?q=${Q}`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
await sleep(800);

// bot de pruebas por la ruta normal de entrada (invulnerable)
const armar = () => page.evaluate((seed) => {
  const h = window.__hip, inp = h.input;
  h.start('arcade', seed);
  const g = h.game;
  inp.steer = () => {
    let st = h.bot(g);
    const hole = g.boxes.find((b) => b.carton && !b.hit && b.k > g.s);
    if (hole && hole.k - g.s < 30) { let d = hole.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); st = Math.max(-1, Math.min(1, d * 3)); }
    return st;
  };
  let n = 0;
  inp.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  inp.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
  g.invul = 1e9;
}, SEED);

// filas del primer plegado terminado y del primer salto entre mundos, con la misma semilla y sin renderizar
await armar();
const filas = await page.evaluate(() => {
  const h = window.__hip, g = h.game, r = { fold: null, world: null };
  for (let i = 0; i < 60 * 240 && (r.fold === null || r.world === null); i++) {
    g.step({ steer: h.bot(g), jump: false, trick: false });
    for (const e of g.events) { if (e.type === 'foldEnd' && r.fold === null) r.fold = Math.round(g.s); if (e.type === 'world' && r.world === null) r.world = Math.round(g.s); }
    if (g.gaps.length && r.world === null) r.world = Math.round(g.s);
  }
  return r;
});
console.log('primer plegado terminado en la fila', filas.fold, '· primer salto entre mundos en', filas.world);
rec(filas.fold !== null && filas.world !== null, 'la semilla tiene plegado y salto entre mundos', filas);

const medir = (desde) => armar().then(() => page.evaluate((desde, secs) => new Promise((res) => {
  const h = window.__hip; h.skipTo(desde);
  const r = h.renderer, cam = r.camera, w = r.weight; if (!window.__camWrap) { window.__camWrap = true; window.__rx = 0; window.__ry = 0; const oX = cam.rotateX.bind(cam), oY = cam.rotateY.bind(cam); cam.rotateX = (a) => { window.__rx += a; return oX(a); }; cam.rotateY = (a) => { window.__ry += a; return oY(a); }; }
  const dts = []; let last = performance.now(); const t0 = last;
  let maxY = 0, maxC = 0, maxDip = 0, minDip = 0, above = false, rec0 = 0, bobMax = 0, frames = 0, prev = null, ok = 0, tot = 0, gazeMax = 0;
  const recov = [];
  (function f(now) {
    dts.push(now - last); last = now;
    if (h.state === 'play' && h.game.alive) {
      frames++;
      const sp = Math.min(1, Math.max(0, (h.game.speedMS - 36) / 64));
      // giros REALES aplicados a la cámara este fotograma, en fracción del alto (ángulo / campo de visión vertical)
      const fovR = cam.fov * Math.PI / 180, P = -window.__rx / fovR, G = window.__ry / fovR;
      window.__rx = 0; window.__ry = 0;
      maxY = Math.max(maxY, Math.abs(P)); maxC = Math.max(maxC, Math.hypot(P, G)); gazeMax = Math.max(gazeMax, Math.abs(G));
      maxDip = Math.max(maxDip, P); minDip = Math.min(minDip, P);
      if (Math.abs(w.gaze) > 0.9) gazeMax = Math.max(gazeMax, Math.abs(G));
      bobMax = Math.max(bobMax, Math.abs(P - w.dip));
      if (w.dip > 0.003 && !above) { above = true; rec0 = now; }
      if (above && Math.abs(w.dip) < 0.0006 && Math.abs(w.v) < 0.03) { above = false; recov.push(now - rec0); }
      // la mirada apunta hacia donde se mueve la cámara: con la vista girada hacia la izquierda, la dirección
      // de avance queda a la derecha del eje de la cámara (dot > 0) y el desplazamiento es hacia la izquierda
      const p = [cam.position.x, cam.position.y, cam.position.z];
      const e = cam.matrixWorld.elements;
      if (prev && Math.abs(w.gaze) > 0.5) {
        const d = (p[0] - prev[0]) * e[0] + (p[1] - prev[1]) * e[1] + (p[2] - prev[2]) * e[2];
        const yaw = r.look.x * e[0] + r.look.y * e[1] + r.look.z * e[2];
        tot++; if (Math.sign(d) === -Math.sign(yaw) && Math.abs(d) > 1e-4) ok++;
      }
      prev = p;
    } else prev = null;
    if (now - t0 < secs * 1000) requestAnimationFrame(f);
    else res({ dts: dts.slice(1), maxY, maxC, maxDip, minDip, recov, frames, bobMax, gazeMax, ok, tot, s: Math.round(h.game.s), pending: above });
  })(last);
}), desde, SECS));

const fps = (dts) => { const s = [...dts].sort((a, b) => b - a), n = Math.max(1, Math.floor(s.length * 0.01)); return { avg: 1000 / (dts.reduce((a, b) => a + b, 0) / dts.length), low1: 1000 / (s.slice(0, n).reduce((a, b) => a + b, 0) / n) }; };
const peakPx = (m) => +(m.maxDip * 390).toFixed(2);
const tramos = [['plegado', Math.max(0, filas.fold - 25)], ['salto entre mundos', Math.max(0, filas.world - 45)]];
const todos = [];
for (const [nombre, desde] of tramos) {
  const m = await medir(desde); todos.push(m);
  const f = fps(m.dts);
  console.log(`— tramo «${nombre}» desde la fila ${desde}: ${m.frames} fotogramas, fps medio ${f.avg.toFixed(1)}, 1 % peor ${f.low1.toFixed(1)}`);
  rec(m.frames > 60 * (SECS - 4), `[${nombre}] partida en tiempo real`, { frames: m.frames });
  rec(m.maxDip >= 0.0070 && m.maxDip <= 0.0125, `[${nombre}] giro real de cabeceo en el aterrizaje de 2,7-4,9 px a 390 px de alto`, { px: peakPx(m) });
  rec(m.minDip > -0.0045, `[${nombre}] el cabeceo real no baja de -0,45 % (rebote + respiración)`, { minDip: +(100 * m.minDip).toFixed(2) + ' %' });
  rec(m.recov.length >= 1 && Math.max(...m.recov) < 1200 && !m.pending, `[${nombre}] el bajón se recupera en < 1,2 s`, { ms: m.recov.map(Math.round) });
  rec(f.avg >= 58, `[${nombre}] fps medio ≥ 58`, { fps: +f.avg.toFixed(1) });
}
const maxC = Math.max(...todos.map((m) => m.maxC)), maxY = Math.max(...todos.map((m) => m.maxY)), bobMax = Math.max(...todos.map((m) => m.bobMax)), gazeMax = Math.max(...todos.map((m) => m.gazeMax));
const ok = todos.reduce((a, m) => a + m.ok, 0), tot = todos.reduce((a, m) => a + m.tot, 0);
rec(maxY <= 0.012, `desplazamiento vertical del centro ≤ 1,2 % del alto`, { maxY: +(100 * maxY).toFixed(2) + ' %' });
rec(maxC <= 0.015, `desplazamiento total del centro ≤ 1,5 % del alto`, { maxC: +(100 * maxC).toFixed(2) + ' %' });
rec(bobMax > 0.001 && bobMax <= 0.0025, `la respiración existe y es diminuta (≤ 0,25 %)`, { bobMax: +(100 * bobMax).toFixed(3) + ' %' });
rec(gazeMax >= 0.003 && gazeMax <= 0.0065, `la mirada se adelanta hasta 0,3-0,6 % del alto`, { gazeMax: +(100 * gazeMax).toFixed(2) + ' %' });
rec(tot > 60 && ok / tot > 0.8, `la mirada se adelanta hacia el lado en que se mueve la cámara`, { ok, tot });
rec(errors.length === 0, 'sin errores de página', errors.slice(0, 2));
await browser.close();
process.exit(fallos ? 1 : 0);
