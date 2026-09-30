// Fin de partida: la caja del zorro proyectada tiene que quedar entera en pantalla, a la izquierda
// y sin solaparse con la tarjeta, y la tarjeta entera y sin desbordes. 10 muertes distintas en
// Arcade y 3 en cada uno de los otros modos con vista de fuera, por tamaño.
// Uso: node tests/zorro-fin.mjs [--n=10] [--shot=carpeta] [--v]
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const url = process.env.HIP_URL || 'http://localhost:5173/';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const N = +(opt.n || 10);
const out = opt.shot && new URL(`./shots/${opt.shot}/`, import.meta.url).pathname;
if (out) mkdirSync(out, { recursive: true });
const TAMANOS = [[667, 375], [844, 390], [1280, 720], [1024, 768]];
const MODOS = [['arcade', N], ['classic', 3], ['adventure', 3], ['timetrial', 3], ['survival', 3]];
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'] });
let fail = 0, total = 0;
for (const [w, h] of TAMANOS) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 15000 });
  const filas = [], dists = new Set();
  let cajas = 0;
  for (const [modo, n] of MODOS) for (let i = 0; i < n; i++) {
    const seed = 11 + i * 7;
    await page.evaluate((modo, seed) => {
      const hp = window.__hip;
      hp.start(modo, seed);
      // giros pseudoaleatorios con semilla: muertes en sitios y contra cajas distintas
      let x = seed * 2654435761 % 4294967296, hold = 0, dir = 0;
      hp.input.steer = () => { if (--hold <= 0) { x = (x * 1664525 + 1013904223) % 4294967296; hold = 10 + (x >>> 8) % 40; dir = ((x >>> 4) % 3) - 1; } return dir; };
      hp.input.consumeJump = () => false; hp.input.consumeTrick = () => false;
    }, modo, seed);
    let m;
    try {
      await page.waitForFunction(() => window.__hip.state === 'over', { timeout: 90000 });
      await page.waitForSelector('.scr-over.on .over-card', { timeout: 5000 });
      // la cámara acaba de deslizarse cuando deadT pasa de 1,6 s (avanza con dt, no con el reloj)
      await page.waitForFunction(() => window.__hip.renderer.deadT > 1.6, { timeout: 8000 });
      await new Promise((r) => setTimeout(r, 400));
      m = await page.evaluate(() => {
        const hp = window.__hip, cam = hp.renderer.camera, V = cam.position.constructor;
        cam.updateMatrixWorld(true);
        const g = hp.renderer.hero.group;
        g.updateMatrixWorld(true);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, delante = true, mallas = 0;
        g.traverse((o) => {
          let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = v && p.visible;
          if (!o.isMesh || !o.geometry || !v) return;
          mallas++;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          for (const px of [b.min.x, b.max.x]) for (const py of [b.min.y, b.max.y]) for (const pz of [b.min.z, b.max.z]) {
            const p = o.localToWorld(new V(px, py, pz)).project(cam);
            if (p.z > 1) delante = false;
            x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
          }
        });
        const W = innerWidth, H = innerHeight;
        const card = document.querySelector('.scr-over .over-card');
        const c = card.getBoundingClientRect();
        return {
          visible: g.visible && mallas > 0, delante, W, H, dist: Math.round(hp.game.distanceM), caja: !!hp.renderer.deathFocus,
          fox: { l: (x0 + 1) / 2 * W, r: (x1 + 1) / 2 * W, t: (1 - y1) / 2 * H, b: (1 - y0) / 2 * H },
          card: { l: c.left, r: c.right, t: c.top, b: c.bottom }, desborda: card.scrollWidth > card.clientWidth + 1,
          vigOn: !!document.querySelector('.scr-over.on'),
        };
      });
    } catch (e) { m = null; }
    total++;
    if (!m) { fail++; filas.push(`  ${modo} seed ${seed}: FALLA no llegó al fin de partida con la cámara asentada`); continue; }
    const f = m.fox, c = m.card;
    const entero = m.visible && m.delante && f.l >= 0 && f.r <= m.W && f.t >= 0 && f.b <= m.H;
    const izq = (f.l + f.r) / 2 < m.W / 2;
    const libre = f.r <= c.l;
    const tarjeta = c.l >= 0 && c.r <= m.W - 2 && c.t >= 0 && c.b <= m.H && !m.desborda;
    if (modo === 'arcade') { dists.add(m.dist); if (m.caja) cajas++; }
    const ok = entero && izq && libre && tarjeta;
    if (!ok) fail++;
    filas.push(`  ${modo} seed ${seed} (${m.dist} m): zorro x ${f.l.toFixed(0)}-${f.r.toFixed(0)} y ${f.t.toFixed(0)}-${f.b.toFixed(0)} · tarjeta ${c.l.toFixed(0)}-${c.r.toFixed(0)} · ${entero ? 'entero' : 'FUERA'} ${izq ? 'izq' : 'NO-IZQ'} ${libre ? 'libre' : 'TAPADO'} ${tarjeta ? 'tarjeta-ok' : 'TARJETA-MAL'}`);
    if (out && i < 2 && (modo === 'arcade' || modo === 'adventure')) await page.screenshot({ path: `${out}fin-${modo}-${w}x${h}-${seed}.png` });
  }
  // no vale pasar en vacío: muertes distintas y con caja golpeada
  const variado = dists.size >= Math.min(5, N) && cajas >= 1;
  if (!variado) { fail++; filas.push(`  FALLA: muertes de Arcade poco variadas (${dists.size} distancias, ${cajas} contra caja)`); }
  const malos = filas.filter((l) => /FALLA|FUERA|NO-IZQ|TAPADO|TARJETA-MAL/.test(l));
  console.log(`${w}×${h}: ${filas.length - (variado ? 0 : 1) - malos.filter((l) => !/FALLA: muertes/.test(l)).length}/${filas.length - (variado ? 0 : 1)} bien · ${dists.size} distancias · ${cajas} contra caja · errores ${errs.length}`);
  for (const l of (opt.v ? filas : malos)) console.log(l);
  if (errs.length) { fail++; console.log(errs[0]); }
  await page.close();
}
await browser.close();
console.log(fail ? `FALLAN ${fail} de ${total}` : `Todo OK (${total} muertes)`);
process.exit(fail ? 1 : 0);
