// Materiales que obligan a three.js a recalcular el programa cada fotograma (getParameters): versión que sube
// o material compartido entre mallas instanciadas y normales / con y sin instanceColor.
// Uso: HIP_URL=... node tests/materiales-cambian.mjs
import puppeteer from 'puppeteer';
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=media', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));
const out = await page.evaluate(() => new Promise((res) => {
  const h = window.__hip, r = h.renderer; h.start('arcade', 7);
  const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9;
  const ver = new Map(), bump = new Map(), users = new Map();
  let n = 0;
  (function f() {
    r.scene.traverse((o) => { if (!o.material) return; for (const m of [].concat(o.material)) {
      const v = ver.get(m); if (v !== undefined && v !== m.version) bump.set(m, (bump.get(m) || 0) + 1); ver.set(m, m.version);
      const u = users.get(m) || new Set(); u.add((o.isInstancedMesh ? 'I' : o.isSkinnedMesh ? 'S' : o.isPoints ? 'P' : o.isLine ? 'L' : 'M') + (o.instanceColor ? 'c' : '') + (o.geometry && o.geometry.attributes.color ? 'v' : '')); users.set(m, u);
    } });
    // 3 s dentro de la partida
    if (++n < 180) requestAnimationFrame(f);
    else {
      const name = (m) => { let s = ''; r.scene.traverse((o) => { if (!s && o.material && [].concat(o.material).includes(m)) s = (o.name || o.parent?.name || o.type); }); return `${s}:${m.name || m.type}`; };
      res({
        bumps: [...bump].map(([m, c]) => ({ mat: name(m), perFrame: +(c / 179).toFixed(2) })).sort((a, b) => b.perFrame - a.perFrame).slice(0, 10),
        mixed: [...users].filter(([, u]) => u.size > 1).map(([m, u]) => ({ mat: name(m), users: [...u].join(',') })).slice(0, 10),
      });
    }
  })();
}));
console.log(JSON.stringify(out, null, 1));
await browser.close();
