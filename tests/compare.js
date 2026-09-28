// Capturas comparables + medida de fps, para juzgar los cambios visuales sin engañarse.
// Requiere: npm run serve en otra terminal.
//   node tests/compare.js <carpeta> [distancias] [parámetros de URL]
// Ej.: node tests/compare.js despues 150,1500,3000,6000 "expo=0.8&bloom=0.5"
// Guarda tests/<carpeta>/zNNN.png y escribe un resumen de fps por distancia.
const puppeteer = require('puppeteer'); const fs = require('fs'); const path = require('path');
const BOT = (z) => {
  const G = window.__game, L = G.lanes, lm = (l) => ((l % L) + L) % L;
  G.warp(z); let cd = 0;
  const bl = (l, a, c) => G.byLane[lm(l)].some((o) => o.type === 'block' && o.z < c && o.z + o.len > a);
  G.setStep(() => { cd--; if (cd > 0) return 0; const s = G.s, c = G.lane; if (!bl(c, s - 1, s + 30)) return 0; for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!bl(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0; });
};
(async () => {
  const name = process.argv[2] || 'despues';
  const zs = (process.argv[3] || '150,1500,3000,6000').split(',').map(Number);
  const qs = process.argv[4] || '';
  const out = path.join(__dirname, name); fs.mkdirSync(out, { recursive: true });
  const b = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage(); await p.setViewport({ width: 960, height: 440 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/index.html' + (qs ? '?' + qs : ''));
  await new Promise((r) => setTimeout(r, 1500)); await p.click('#bPlay');
  const gfx = await p.evaluate(() => window.__game.gfx && window.__game.gfx());
  const rows = [];
  for (const z of zs) {
    // el bot muere con facilidad en las distancias largas: se reintenta hasta pillarlo vivo
    let f = { avg: 0, p5: 0 }, alive = false;
    for (let intento = 0; intento < 4 && !alive; intento++) {
      if (await p.evaluate(() => window.__game.state) !== 'play') { await p.evaluate(() => window.__game.start()); await new Promise((r) => setTimeout(r, 400)); }
      await p.evaluate(BOT, z);
      await new Promise((r) => setTimeout(r, 1200));
      await p.evaluate(() => window.__game.fpsReset && window.__game.fpsReset());
      await new Promise((r) => setTimeout(r, 2200));
      f = await p.evaluate(() => (window.__game.fps ? window.__game.fps() : { avg: 0, p5: 0 }));
      alive = await p.evaluate(() => window.__game.state) === 'play';
    }
    await p.screenshot({ path: path.join(out, 'z' + z + '.png') });
    rows.push({ z, fps: f.avg, p5: f.p5, vivo: alive });
  }
  console.log('carpeta: tests/' + name + (qs ? '  ·  ' + qs : ''), '\ngfx:', JSON.stringify(gfx));
  for (const r of rows) console.log('  z' + String(r.z).padStart(5) + '   ' + String(r.fps).padStart(5) + ' fps   1% peor ' + r.p5 + (r.vivo ? '' : '   [muerto]'));
  console.log(errs.length ? 'Errores de consola:\n' + errs.join('\n') : '(sin errores de consola)');
  await b.close();
})();
