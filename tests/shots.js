// Capturas del juego renderizado de verdad (usa tu GPU). Requiere: npm run serve en otra terminal.
// Uso: node tests/shots.js [distancias separadas por comas]   -> guarda PNG en tests/shots/
const puppeteer = require('puppeteer'); const fs = require('fs'); const path = require('path');
(async () => {
  const out = path.join(__dirname, 'shots'); fs.mkdirSync(out, { recursive: true });
  const zs = (process.argv[2] || '150,1500,3000,6000').split(',').map(Number);
  const b = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage(); await p.setViewport({ width: 960, height: 440 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/index.html'); await new Promise((r) => setTimeout(r, 1500)); await p.click('#bPlay');
  for (const z of zs) {
    await p.evaluate((z) => { const G = window.__game, L = 16, lm = (l) => ((l % L) + L) % L; G.warp(z); let cd = 0;
      const bl = (l, a, c) => G.byLane[lm(l)].some((o) => o.type === 'block' && o.z < c && o.z + o.len > a);
      G.setStep(() => { cd--; if (cd > 0) return 0; const s = G.s, c = G.lane; if (!bl(c, s - 1, s + 30)) return 0; for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!bl(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0; }); }, z);
    await new Promise((r) => setTimeout(r, 2500));
    await p.screenshot({ path: path.join(out, 'z' + z + '.png') });
    if (await p.evaluate(() => window.__game.state) !== 'play') await p.evaluate(() => window.__game.start());
  }
  console.log('Capturas en tests/shots/', errs.length ? '\nErrores de consola:\n' + errs.join('\n') : '(sin errores de consola)'); await b.close();
})();
