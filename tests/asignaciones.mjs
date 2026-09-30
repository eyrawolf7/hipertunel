// Quién reserva memoria por fotograma en partida (muestreo del montón de V8, 30 s de Arcade con bot).
// Uso: HIP_URL=... node tests/asignaciones.mjs [--secs=30] [--mode=arcade|phase]
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const BASE = process.env.HIP_URL || 'http://localhost:5180/', SECS = +(opt.secs || 30);
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
await page.goto(BASE + '?q=media', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1000));
await page.evaluate((mode) => {
  const h = window.__hip; try { h.audio.unlock(); } catch (e) {}
  if (mode === 'phase') { h.setPhase(0); h.start('phase'); } else h.start('arcade', 7);
  const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; let n = 0;
  h.input.consumeJump = () => (++n % 90 === 0 && g.charges > 0 && !g.flight());
  h.input.consumeTrick = () => !!g.flight() && g.landIn > 0.35 && g.trickT < 0;
}, opt.mode || 'arcade');
await new Promise((r) => setTimeout(r, 3000));
const cdp = await page.createCDPSession();
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await new Promise((r) => setTimeout(r, SECS * 1000));
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const agg = new Map();
(function walk(n) {
  const cf = n.callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, '').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
  agg.set(key, (agg.get(key) || 0) + n.selfSize);
  for (const c of n.children) walk(c);
})(profile.head);
const tot = [...agg.values()].reduce((a, b) => a + b, 0);
console.log(`total ${(tot / 1048576 / SECS).toFixed(2)} MB/s`);
for (const [k, v] of [...agg].sort((a, b) => b[1] - a[1]).slice(0, 18)) console.log((v / 1048576 / SECS).toFixed(2).padStart(6), 'MB/s ', k);
await browser.close();
