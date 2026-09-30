// Programas de sombreado que se compilan EN PLENA PARTIDA (tirón en el móvil): cuándo, cuál y el fotograma que costó.
// Uso: HIP_URL=... node tests/compilaciones.mjs [--mode=arcade|phase] [--fase=0] [--secs=120] [--q=media] [--cpu=4]
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = process.env.HIP_URL || 'http://localhost:5180/', SECS = +(opt.secs || 120), Q = opt.q || 'media';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=' + Q, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
const cdp = await page.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: +(opt.cpu || 4) });
const out = await page.evaluate((mode, fase, secs) => new Promise((res) => {
  const h = window.__hip, r = h.renderer, info = r.renderer.info;
  if (mode === 'phase') { h.setPhase(fase); h.start('phase'); } else h.start('arcade', 7);
  const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; let n = 0;
  h.input.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  h.input.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
  const seen = new Set(info.programs.map((p) => p.id)); const ev = []; let last = performance.now(); const t0 = last; let pend = null;
  (function f(now) {
    const dt = now - last; last = now;
    if (pend) { pend.frameMs = +dt.toFixed(0); ev.push(pend); pend = null; }
    for (const p of info.programs) if (!seen.has(p.id)) {
      seen.add(p.id);
      let who = [];
      r.scene.traverse((o) => { if (o.material) for (const m of [].concat(o.material)) if (r.renderer.properties.get(m).currentProgram === p) who.push((o.isInstancedMesh ? 'Instanced ' : '') + (o.name || o.type) + ':' + (m.name || m.type) + (o.instanceColor ? ' +instanceColor' : '') + (m.map && m.map.isCanvasTexture ? ' canvas' : '')); });
      pend = { t: +((now - t0) / 1000).toFixed(1), s: Math.round(g.s), world: g.world, outside: !!r.outside, who: who.slice(0, 3), frameMsBefore: +dt.toFixed(0) };
    }
    if (now - t0 < secs * 1000) requestAnimationFrame(f); else res({ ev, total: info.programs.length });
  })(last);
}), opt.mode || 'arcade', +(opt.fase || 0), SECS);
console.log(JSON.stringify({ url: BASE, mode: opt.mode || 'arcade', ...out }));
await browser.close();
