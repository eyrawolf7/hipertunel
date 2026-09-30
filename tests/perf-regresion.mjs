// Comparativa de rendimiento entre versiones (Arcade con bot en tiempo real, CPU frenada).
// Uso: HIP_URL=http://localhost:5180/ node tests/perf-regresion.mjs [--cpu=4] [--secs=60] [--dpr=3] [--q=media] [--off=wild,life,...] [--ghost] [--audio]
// --off: apaga piezas por separado en la v0.70: ambient (ajuste «Efectos de ambiente»), wild, life, eye, weight,
//        surf, adv, sfxpass, roll, space, vibe, hud. --ghost crea un fantasma guardado antes de medir.
// Imprime una línea JSON con los resultados.
import puppeteer from 'puppeteer';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const CPU = +(opt.cpu || 4), SECS = +(opt.secs || 60), W = +(opt.w || 844), H = +(opt.h || 390), DPR = +(opt.dpr || 3), Q = opt.q || 'media';
const OFF = (opt.off || '').split(',').filter(Boolean);
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: DPR, isMobile: true, hasTouch: true, isLandscape: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.evaluateOnNewDocument((off) => {
  try { const s = JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}'); s.ambient = !off.includes('ambient'); if (off.includes('vibe')) s.vibe = false; localStorage.setItem('hipertunel-ajustes', JSON.stringify(s)); } catch (e) {}
  // contadores de trabajo por segundo: vibración, nodos de audio creados, nodos del DOM añadidos, consultas del DOM
  window.__cnt = { vib: 0, vibMs: 0, audio: 0, dom: 0, qs: 0 };
  const C = window.__cnt, on = () => window.__meas;
  navigator.vibrate = (p) => { if (on()) { C.vib++; C.vibMs += Array.isArray(p) ? p.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) : +p; } return true; };
  const AC = (window.BaseAudioContext || window.AudioContext).prototype;
  for (const k of Object.getOwnPropertyNames(AC)) if (/^create/.test(k) && typeof AC[k] === 'function') { const f = AC[k]; AC[k] = function (...a) { if (on()) C.audio++; return f.apply(this, a); }; }
  for (const P of [Document.prototype, Element.prototype]) for (const k of ['querySelector', 'querySelectorAll']) { const f = P[k]; P[k] = function (...a) { if (on()) C.qs++; return f.apply(this, a); }; }
  new MutationObserver((ms) => { if (on()) for (const m of ms) C.dom += m.addedNodes.length; }).observe(document, { childList: true, subtree: true });
  // tiempo de JS del bucle principal (función «frame» de main.js)
  window.__jsT = []; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => { if (cb.name !== 'frame') return cb(ts); const t0 = performance.now(); cb(ts); if (window.__meas) window.__jsT.push(performance.now() - t0); });
}, OFF);
await page.goto(BASE + '?q=' + Q, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await sleep(1000);

if (opt.ghost) {
  // fantasma: una partida del bot grabada con la API de ghost.js, guardada como la mejor
  const ok = await page.evaluate(async () => {
    try {
      const G = await import('/src/ghost.js'); const { Arcade } = await import('/src/sim/arcade.js');
      const h = window.__hip, seed = 7, rec = new G.GhostRecorder({ seed, easy: 3 }), g = new Arcade({ seed, easyWalls: 3 });
      while (g.alive && g.frame < 60 * 400) { const st = G.quantGhost(h.bot(g)); rec.push(st, false); g.step({ steer: st, trick: false }); }
      localStorage.setItem(G.GHOST_KEY, JSON.stringify(rec.pack({ rows: g.rowsPassed, score: 1e9, distM: g.distanceM })));
      return { frames: g.frame };
    } catch (e) { return String(e); }
  });
  console.error('fantasma', JSON.stringify(ok));
}

const client = await page.createCDPSession();
await client.send('Emulation.setCPUThrottlingRate', { rate: CPU });
await page.evaluate((off, mode, fase, fin) => {
  const h = window.__hip, r = h.renderer, noop = () => {};
  try { h.audio.unlock(); } catch (e) {}
  if (mode === 'phase') { h.setPhase?.(fase); h.start('phase'); } else h.start('arcade', 7);
  window.__fin = fin;
  const g = h.game, inp = h.input;
  inp.steer = () => h.bot(g); let n = 0;
  inp.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  inp.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
  g.invul = 1e9;
  if (off.includes('wild')) { r.wild.update = noop; r.wild.birds.visible = r.wild.prec.visible = false; }
  if (off.includes('life')) { r.life.update = noop; if (r.life.mesh) r.life.mesh.visible = false; }
  if (off.includes('adv')) { r.adv.update = noop; }
  if (off.includes('surf')) { g.surfaceAt = () => 0; }
  if (off.includes('eye')) { const u = r.update.bind(r); r.update = (...a) => { u(...a); if (r.grade) { r.grade.uniforms.uExp.value = 1; r.grade.uniforms.uWake.value.set(0, 1.3); } }; }
  if (off.includes('weight')) { const u = r.update.bind(r); r.update = (a, b, c, d, o = {}) => u(a, b, c, d, { ...o, ambient: false }); }
  if (off.includes('sfxpass') || off.includes('roll')) { const p = h.audio.play.bind(h.audio); h.audio.play = (k, o) => (k === 'pass' && off.includes('sfxpass')) ? undefined : p(k, o); }
  if (off.includes('roll')) h.audio.setSurface = noop;
  if (off.includes('space')) h.audio.setSpace = noop;
  if (off.includes('hud')) h.ui.hud = noop;
  // arreglo propuesto a prueba: una sola pasada en los transparentes a doble cara y mallas vacías ocultas
  if (off.includes('single')) { const fix = () => r.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (m.transparent && m.side === 2) m.forceSinglePass = true; }); fix(); setTimeout(fix, 1500);
    if (r.wild) { const wu = r.wild.update.bind(r.wild); r.wild.update = (...a) => { wu(...a); r.wild.birds.visible = r.wild.birds.visible && r.wild.birds.count > 0; r.wild.prec.visible = r.wild.prec.visible && r.wild.prec.count > 0; }; } }
  // tiempos de update/render
  window.__uT = []; window.__rT = [];
  const gl0 = r.renderer.getContext(); { const R1 = r.render.bind(r); r.render = (...a) => { const x = R1(...a); if (window.__fin) gl0.finish(); return x; }; }
  const U = r.update.bind(r), R = r.render.bind(r);
  r.update = (...a) => { const t = performance.now(); const x = U(...a); if (window.__meas) window.__uT.push(performance.now() - t); return x; };
  r.render = (...a) => { const t = performance.now(); const x = R(...a); if (window.__meas) window.__rT.push(performance.now() - t); return x; };
}, OFF, opt.mode || 'arcade', +(opt.fase || 0), !!opt.finish);
await sleep(2000);
const m = await page.evaluate((s) => new Promise((res) => {
  const h = window.__hip, info = h.renderer.renderer.info;
  const dts = [], calls = [], tris = [], inst = []; let last = performance.now(); const t0 = last; let alloc = 0, lastHeap = performance.memory.usedJSHeapSize;
  const prog0 = info.programs.length; info.autoReset = false; info.reset();
  window.__meas = true; window.__jsT.length = 0;
  (function f(now) {
    dts.push(now - last); last = now;
    calls.push(info.render.calls); tris.push(info.render.triangles); info.reset();
    { const r = h.renderer; inst.push((r.wild ? r.wild.birds.count + r.wild.prec.count : 0) + (r.life && r.life.mesh ? r.life.mesh.count : 0)); }
    const hp = performance.memory.usedJSHeapSize; if (hp > lastHeap) alloc += hp - lastHeap; lastHeap = hp;
    if (now - t0 < s * 1000) requestAnimationFrame(f);
    else {
      window.__meas = false;
      const bf = [...document.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return (cs.backdropFilter && cs.backdropFilter !== 'none') && e.checkVisibility && e.checkVisibility(); }).map((e) => e.id || e.className).slice(0, 5);
      res({ cnt: window.__cnt, inst, dts: dts.slice(1), calls, tris, jsT: window.__jsT.slice(), uT: window.__uT.slice(), rT: window.__rT.slice(), alloc, prog0, prog1: info.programs.length, tex: info.memory.textures, geo: info.memory.geometries, heap: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), bf, g: { s: Math.round(h.game.s), world: h.game.world, state: h.state, ghost: !!h.renderer.ghostGame }, audio: !!(h.audio._ctx && h.audio._ctx.state) && h.audio._ctx.state });
    }
  })(last);
}), SECS);
const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sorted = [...m.dts].sort((a, b) => a - b);
const worst = sorted.slice(Math.floor(sorted.length * 0.99));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0; };
const out = {
  url: BASE, mode: opt.mode || 'arcade', fin: !!opt.finish, q: Q, cpu: CPU, dpr: DPR, off: OFF.join(',') || '-', ghost: !!opt.ghost,
  fps: +(1000 / avg(m.dts)).toFixed(1), low1: +(1000 / avg(worst)).toFixed(1), maxMs: +sorted[sorted.length - 1].toFixed(0),
  p20: +(100 * m.dts.filter((x) => x > 20).length / m.dts.length).toFixed(1), p33: +(100 * m.dts.filter((x) => x > 33.4).length / m.dts.length).toFixed(2),
  js: +avg(m.jsT).toFixed(2), js95: +pct(m.jsT, 0.95).toFixed(2), upd: +avg(m.uT).toFixed(2), rnd: +avg(m.rT).toFixed(2),
  part: Math.round(avg(m.inst)), partMax: Math.max(...m.inst), calls: Math.round(avg(m.calls)), callsMax: Math.max(...m.calls), tris: Math.round(avg(m.tris) / 1000) + 'k',
  prog: `${m.prog0}->${m.prog1}`, tex: m.tex, geo: m.geo, heapMB: m.heap, allocMBs: +(m.alloc / 1048576 / SECS).toFixed(2), backdrop: m.bf, perSec: Object.fromEntries(Object.entries(m.cnt).map(([k, v]) => [k, +(v / SECS).toFixed(1)])), ...m.g, audio: m.audio, errors: errors.slice(0, 2),
};
console.log(JSON.stringify(out));
await browser.close();
