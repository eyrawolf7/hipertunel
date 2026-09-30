// Estima el sobredibujado de las partículas (mallas instanciadas de planos: vida y mundo vivo): suma el
// área en pantalla de cada cuadrado (en "pantallas enteras") por fotograma.
// Uso: HIP_URL=http://localhost:5180/ node tests/overdraw-particulas.mjs [--mode=arcade|phase] [--fase=1] [--secs=60] [--q=alta]
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const SECS = +(opt.secs || 60), Q = opt.q || 'alta';
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=' + Q, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await sleep(800);
const res = await page.evaluate(async (mode, fase, secs) => {
  const h = window.__hip, r = h.renderer;
  if (mode === 'phase') { h.setPhase(fase); h.start('phase'); } else h.start('arcade', 7);
  const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; let n = 0;
  h.input.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  h.input.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
  const THREE_M = r.camera.matrixWorldInverse.constructor, V = r.camera.position.constructor;
  const M = new THREE_M(), P = new THREE_M(), v = new V();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const area = (mesh) => {
    if (!mesh || !mesh.visible) return 0;
    let tot = 0; const cam = r.camera;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, M); P.multiplyMatrices(mesh.matrixWorld, M);
      const pts = []; let behind = false;
      for (const [x, y] of corners) { v.set(x, y, 0).applyMatrix4(P).applyMatrix4(cam.matrixWorldInverse); if (v.z > -0.05) { behind = true; break; } v.applyMatrix4(cam.projectionMatrix); pts.push([Math.max(-1, Math.min(1, v.x)), Math.max(-1, Math.min(1, v.y))]); }
      if (behind) continue;
      let a = 0; for (let k = 0; k < 4; k++) { const [x0, y0] = pts[k], [x1, y1] = pts[(k + 1) % 4]; a += x0 * y1 - x1 * y0; }
      tot += Math.abs(a) / 2 / 4;   // el NDC mide 2×2 = 4
    }
    return tot;
  };
  const S = { life: [], birds: [], prec: [], outside: 0, frames: 0, byWorld: {} };
  const t0 = performance.now();
  await new Promise((done) => (function f() {
    const l = area(r.life && r.life.mesh), b = r.wild ? area(r.wild.birds) : 0, p = r.wild ? area(r.wild.prec) : 0;
    S.life.push(l); S.birds.push(b); S.prec.push(p); S.frames++; if (r.outside) S.outside++;
    const w = r.themeIdx; (S.byWorld[w] ||= { n: 0, sum: 0, max: 0 }); S.byWorld[w].n++; S.byWorld[w].sum += l + b + p; S.byWorld[w].max = Math.max(S.byWorld[w].max, l + b + p);
    if (performance.now() - t0 < secs * 1000) requestAnimationFrame(f); else done();
  })());
  const st = (a) => { const s = [...a].sort((x, y) => x - y); return { avg: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3) }; };
  for (const k in S.byWorld) S.byWorld[k] = { avg: +(S.byWorld[k].sum / S.byWorld[k].n).toFixed(3), max: +S.byWorld[k].max.toFixed(3), frames: S.byWorld[k].n };
  return { life: st(S.life), birds: st(S.birds), prec: st(S.prec), outsidePct: +(100 * S.outside / S.frames).toFixed(1), byWorld: S.byWorld, s: Math.round(g.s) };
}, opt.mode || 'arcade', +(opt.fase || 0), SECS);
console.log(JSON.stringify({ url: BASE, mode: opt.mode || 'arcade', fase: +(opt.fase || 0), ...res }));
await browser.close();
