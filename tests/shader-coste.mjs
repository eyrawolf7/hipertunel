// Tamaño de los sombreadores de fragmento ya compilados (proxy del coste ALU por píxel) y coste del audio sin conexión.
// Uso: HIP_URL=... node tests/shader-coste.mjs
import puppeteer from 'puppeteer';
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=alta', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));
const out = await page.evaluate(async () => {
  const h = window.__hip, r = h.renderer, gl = r.renderer.getContext();
  h.start('arcade', 7); window.__freeze = true;
  for (const k of [300, 900, 1500]) { h.skipTo(k); h.step(30); r.update(h.game, h.game.s, h.game.theta, 1 / 60); r.render(); }
  // qué material usa cada programa: se recorre la escena
  const byProg = new Map();
  r.scene.traverse((o) => { if (!o.isMesh || !o.material) return; for (const m of [].concat(o.material)) { const p = r.renderer.properties.get(m).currentProgram; if (p) { const e = byProg.get(p) || { names: new Set() }; e.names.add((o.name || o.type) + ':' + (m.name || m.type)); byProg.set(p, e); } } });
  const list = [];
  for (const p of r.renderer.info.programs) {
    const sh = gl.getAttachedShaders(p.program).find((s) => gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER);
    const src = gl.getShaderSource(sh) || '';
    const body = src.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');
    const ops = (body.match(/\b(pow|sin|cos|exp|smoothstep|mix|texture2D|texture|normalize|length|fract|dot|step|clamp)\s*\(/g) || []).length;
    list.push({ name: p.name, ops, chars: body.length, used: [...(byProg.get(p)?.names || [])].slice(0, 3).join(' | ') });
  }
  list.sort((a, b) => b.ops - a.ops);
  return list.slice(0, 12);
});
for (const x of out) console.log(JSON.stringify(x));
await browser.close();
