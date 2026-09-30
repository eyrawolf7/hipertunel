// Mundo vivo por fuera (render/life.js, clase Wildlife): bandadas en islas y templo, lluvia en la selva, ceniza en el volcán.
// Uso: node tests/mundo-vivo.mjs [--seed=3] [--w=844 --h=390] [--q=media] [--shots=carpeta]
// Para cada mundo rueda el primer plegado de la partida clásica (sim congelada, avanzada a mano) y, en cada
// captura, compara la MISMA escena con y sin partículas (dos render() seguidos, con las mallas de renderer.wild ocultas):
//  - en el 30 % central de la pantalla no puede cambiar ni un píxel (las partículas nunca lo tocan),
//  - fuera de ese rectángulo tiene que haber partículas visibles en el mundo que las lleva (que no pase en vacío),
//  - en mundos sin ellas (noche) no hay nada, y dentro del tubo tampoco,
//  - las aves se espantan al pasar, y con ?q=baja no hay nada.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const seed = +(opt.seed || 3), W = +(opt.w || 844), H = +(opt.h || 390), Q = opt.q || 'media';
const out = opt.shots ? new URL(opt.shots.endsWith('/') ? opt.shots : opt.shots + '/', `file://${process.cwd()}/`).pathname : null;
if (out) mkdirSync(out, { recursive: true });

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASA  ' : 'FALLA ') + msg); if (!ok) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const base = process.env.HIP_URL || 'http://localhost:5173/';
await page.goto(base + (base.includes('?') ? '&' : '?') + 'q=' + Q, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game);

// Un par de capturas del mismo instante. Devuelve píxeles distintos dentro del 30 % central y fuera de él.
const pair = () => page.evaluate(async () => {
  const r = window.__hip.renderer, cv = r.renderer.domElement, wl = r.wild;
  const load = async (url) => { const img = new Image(); img.src = url; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return { d: x.getImageData(0, 0, c.width, c.height), w: c.width, h: c.height }; };
  wl.birds.visible = wl.prec.visible = true; r.render(); const ua = cv.toDataURL("image/png"); const nb = wl.birds.count, np = wl.prec.count;
  const cam = r.camera; const v = new (r.camera.position.constructor)(); let minN = 9;
  for (const mesh of [wl.birds, wl.prec]) for (let i = 0; i < mesh.count; i++) { v.set(mesh.instanceMatrix.array[i * 16 + 12], mesh.instanceMatrix.array[i * 16 + 13], mesh.instanceMatrix.array[i * 16 + 14]); v.applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix); minN = Math.min(minN, Math.max(Math.abs(v.x), Math.abs(v.y))); }
  wl.birds.visible = wl.prec.visible = false; r.render(); const ub = cv.toDataURL('image/png');
  wl.birds.visible = wl.prec.visible = true;
  const a = await load(ua), b = await load(ub);
  const x0 = Math.floor(a.w * 0.35), x1 = Math.ceil(a.w * 0.65), y0 = Math.floor(a.h * 0.35), y1 = Math.ceil(a.h * 0.65);
  let centro = 0, fuera = 0; const mk = document.createElement("canvas"); mk.width = a.w; mk.height = a.h; const mx = mk.getContext("2d"); mx.drawImage(await (async () => { const im = new Image(); im.src = ua; await im.decode(); return im; })(), 0, 0); mx.globalAlpha = 0.55; mx.fillStyle = "#000"; mx.fillRect(0, 0, a.w, a.h); mx.globalAlpha = 1; mx.fillStyle = "#f0f";
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = (y * a.w + x) * 4;
    const dif = Math.max(Math.abs(a.d.data[i] - b.d.data[i]), Math.abs(a.d.data[i + 1] - b.d.data[i + 1]), Math.abs(a.d.data[i + 2] - b.d.data[i + 2]));
    if (dif > 10) { mx.fillRect(x, y, 1, 1); if (x >= x0 && x < x1 && y >= y0 && y < y1) centro++; else fuera++; }
  }
  return { centro, fuera, nb, np, minN, outside: r.tunnel.uniforms.uOutside.value, url: ua, mask: mk.toDataURL("image/png") };
});

// prepara una partida clásica en el mundo w y la lleva al primer plegado (por fuera)
async function preparar(w) {
  return page.evaluate((seed, w) => {
    const h = window.__hip; h.start('classic', seed);
    window.__freeze = true;
    const g = h.game; g.crash = (b) => { g.invul = 1; b.hit = true; };
    const r = h.renderer; r.themeIdx = w; r.themeBlend = 1; r.applyTheme(w, w, 1);
    r.wild.bg = r.wild.pg = 0;
    let n = 0; while (g.fold > -28 && n++ < 60 * 300) h.step(1);   // hasta estar ya del todo por fuera
    return { n, fold: g.fold };
  }, seed, w);
}

const NAMES = ['islas', 'selva', 'noche', 'templo', 'volcán'];
const resumen = {};
for (const w of [0, 1, 2, 3, 4]) {
  const at = await preparar(w);
  check(at.fold <= -28, `${NAMES[w]}: la simulación llega al plegado, ya por fuera (${at.n} pasos)`);
  const rows = [];
  for (let i = 0; i < 14; i++) {
    await page.evaluate(() => { for (let k = 0; k < 24; k++) { if (window.__hip.game.fold < -5) window.__hip.step(1); } });
    await sleep(160);
    const p = await pair();
    if (out && i % 4 === 0) { writeFileSync(`${out}${NAMES[w]}-${i}.png`, Buffer.from(p.url.split(",")[1], "base64")); writeFileSync(`${out}${NAMES[w]}-${i}-marcado.png`, Buffer.from(p.mask.split(",")[1], "base64")); }
    delete p.url; delete p.mask;
    rows.push(p);
  }
  const centro = rows.reduce((a, r) => a + r.centro, 0), fuera = rows.reduce((a, r) => a + r.fuera, 0);
  const conAves = rows.filter((r) => r.nb > 0).length, conPrec = rows.filter((r) => r.np > 0).length;
  resumen[w] = { centro, fuera, conAves, conPrec };
  console.log(`${NAMES[w]}: píxeles distintos en el 30 % central ${centro}, fuera ${fuera}; capturas con aves ${conAves}/14, con lluvia/ceniza ${conPrec}/14`);
  check(centro === 0, `${NAMES[w]}: el 30 % central es idéntico con y sin partículas`);
  const minN = Math.min(...rows.map((r) => r.minN));
  if (conAves + conPrec > 0) check(minN >= 0.33, `${NAMES[w]}: ninguna partícula dibujada está a menos de 0,33 del centro en pantalla (mínimo ${minN.toFixed(2)})`);
  if (Q === 'baja') { check(conAves === 0 && conPrec === 0 && fuera === 0, `${NAMES[w]}: en calidad baja no hay nada`); continue; }
  if (w === 2) check(conAves === 0 && conPrec === 0 && fuera === 0, 'noche: sin aves ni lluvia (ya tiene luciérnagas)');
  if (w === 0 || w === 3) check(conAves >= 6 && fuera > 0, `${NAMES[w]}: se ven aves fuera del centro (${conAves} capturas)`);
  if (w === 1 || w === 4) check(conPrec >= 10 && fuera > 0, `${NAMES[w]}: se ve ${w === 1 ? 'lluvia' : 'ceniza'} fuera del centro (${conPrec} capturas)`);
}

if (Q !== 'baja') {
  // dentro del tubo no hay nada de esto
  const dentro = await page.evaluate(async (seed) => {
    const h = window.__hip; h.start('classic', seed); window.__freeze = true;
    const r = h.renderer; r.themeIdx = 1; r.themeBlend = 1; r.applyTheme(1, 1, 1);
    for (let i = 0; i < 20; i++) h.step(1);
    await new Promise((res) => setTimeout(res, 800));
    return { fold: h.game.fold, nb: r.wild.birds.count, np: r.wild.prec.count };
  }, seed);
  check(dentro.fold >= 29 && dentro.nb === 0 && dentro.np === 0, `dentro del tubo no hay aves ni lluvia (fold ${dentro.fold.toFixed(0)}, ${dentro.nb} aves, ${dentro.np} gotas)`);

  // transición real: con la lluvia ya puesta (presencia > 0,5) se vuelve a entrar en el tubo y en 1 s no queda nada
  const trans = await page.evaluate(async (seed) => {
    const h = window.__hip; h.start('classic', seed); window.__freeze = true;
    const g = h.game; g.crash = (b) => { g.invul = 1; b.hit = true; };
    const r = h.renderer; r.themeIdx = 1; r.themeBlend = 1; r.applyTheme(1, 1, 1); r.wild.bg = r.wild.pg = 0;
    let n = 0; while (g.fold > -28 && n++ < 60 * 300) h.step(1);
    await new Promise((res) => setTimeout(res, 1500));
    const antes = { pg: r.wild.pg, np: r.wild.prec.count };
    n = 0; while (g.fold < 29.5 && n++ < 60 * 300) h.step(1);
    await new Promise((res) => setTimeout(res, 1000));
    return { antes, fold: g.fold, np: r.wild.prec.count, pg: r.wild.pg };
  }, seed);
  check(trans.antes.pg > 0.5 && trans.antes.np > 20, `antes de entrar hay lluvia (presencia ${trans.antes.pg.toFixed(2)}, ${trans.antes.np} gotas)`);
  check(trans.fold >= 29.5 && trans.np === 0, `1 s después de volver al tubo no queda ninguna gota (fold ${trans.fold.toFixed(0)}, ${trans.np} gotas)`);

  // las aves se espantan: la bandada más cercana sale disparada al pasar la cámara
  const susto = await page.evaluate(async (seed) => {
    const h = window.__hip; h.start('classic', seed); window.__freeze = true;
    const g = h.game; g.crash = (b) => { g.invul = 1; b.hit = true; };
    const r = h.renderer; r.themeIdx = 0; r.themeBlend = 1; r.applyTheme(0, 0, 1);
    let n = 0; while (g.fold > -28 && n++ < 60 * 300) h.step(1);
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    let espantadas = 0, vistas = 0, maxSalida = 0;
    for (let i = 0; i < 160; i++) {
      if (g.fold < -5) h.step(3);
      await sleep(50);
      for (const f of r.wild.flocks) {
        if (!f.live) continue;
        vistas++;
        if (f.scared >= 0) { espantadas++; for (const b of f.b) maxSalida = Math.max(maxSalida, b.burst.length()); }
      }
    }
    return { espantadas, vistas, maxSalida };
  }, seed);
  check(susto.espantadas > 0, `las aves se espantan al pasar la pista (${susto.espantadas} de ${susto.vistas} lecturas)`);
  check(susto.maxSalida > 8, `y salen disparadas (hasta ${susto.maxSalida.toFixed(0)} m)`);
}

check(errors.length === 0, 'sin errores de página' + (errors.length ? ': ' + errors[0] : ''));
await browser.close();
console.log(fails ? `\n${fails} FALLOS` : '\nTodo OK');
process.exit(fails ? 1 : 0);
