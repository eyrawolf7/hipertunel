// Graba una partida de verdad y la monta como hoja de contactos (un fotograma por segundo),
// igual que los fotogramas del original en referencias/. Sirve para juzgar el ritmo de un vistazo.
// Requiere: npm run serve en otra terminal (y ffmpeg para el montaje).
// Uso: node tests/partida.js [segundos] [carpeta] [parámetros de URL]
const puppeteer = require('puppeteer'); const fs = require('fs'); const path = require('path');
const { execFileSync } = require('child_process');
(async () => {
  const segs = parseInt(process.argv[2], 10) || 40;
  const name = process.argv[3] || 'partida';
  const qs = process.argv[4] || '';
  const out = path.join(__dirname, name); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
  const b = await puppeteer.launch({ headless: 'new', args: ['--ignore-gpu-blocklist', '--enable-gpu'] });
  const p = await b.newPage(); await p.setViewport({ width: 640, height: 300 });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/index.html' + (qs ? '?' + qs : ''));
  await new Promise((r) => setTimeout(r, 1500)); await p.click('#bPlay');
  // bot que esquiva y busca las placas de impulso, como en tests/ritmo.js
  await p.evaluate(() => {
    const G = window.__game, L = G.lanes, lm = (l) => ((l % L) + L) % L;
    let cd = 0;
    const bl = (l, a, c) => G.byLane[lm(l)].some((o) => (o.type === 'block' || o.type === 'roller') && o.z < c && o.z + o.len > a);
    const pl = (l, a, c) => G.byLane[lm(l)].some((o) => o.type === 'boost' && o.z < c && o.z + o.len > a);
    G.setStep(() => {
      cd--; if (cd > 0) return 0;
      const s = G.s, c = G.lane;
      if (!bl(c, s - 1, s + 30)) { for (const sg of [1, -1]) if (pl(c + sg, s + 2, s + 30) && !bl(c + sg, s - 1, s + 30)) { cd = 5; return sg; } return 0; }
      for (let k = 1; k < 8; k++) for (const sg of [1, -1]) if (!bl(c + sg * k, s - 1, s + 30)) { cd = 4; return sg; } return 0;
    });
  });
  const reg = [];
  for (let i = 0; i < segs; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await p.evaluate(() => ({ e: window.__game.state, s: Math.round(window.__game.s), n: window.__game.level, v: Math.round(window.__game.speed) }));
    await p.screenshot({ path: path.join(out, 'f' + String(i).padStart(3, '0') + '.png') });
    reg.push(st);
    if (st.e !== 'play') await p.evaluate(() => window.__game.start());
  }
  await b.close();
  const vivos = reg.filter((r) => r.e === 'play');
  console.log('metros:', reg[reg.length - 1].s, '· velocidad media', Math.round(vivos.reduce((a, c) => a + c.v, 0) / vivos.length) + ' m/s',
    '· muertes', reg.filter((r) => r.e !== 'play').length, '· nivel medio', (vivos.reduce((a, c) => a + c.n, 0) / vivos.length).toFixed(1));
  try {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', path.join(out, 'f%03d.png'),
      '-vf', 'scale=320:150,tile=5x' + Math.ceil(segs / 5), path.join(out, 'hoja.png')]);
    console.log('hoja de contactos:', path.relative(process.cwd(), path.join(out, 'hoja.png')));
  } catch (e) { console.log('(sin ffmpeg: solo fotogramas sueltos)'); }
  if (errs.length) console.log('Errores de consola:\n' + errs.join('\n'));
})();
