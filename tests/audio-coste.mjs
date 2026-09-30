// Coste de procesar el audio: 30 s de música (nivel 2, mundo 0) renderizados sin conexión a 48 kHz estéreo;
// se compara el tiempo de render con/sin los bancos de peines (noSpace). Uso: HIP_URL=... node tests/audio-coste.mjs
import puppeteer from 'puppeteer';
const BASE = process.env.HIP_URL || 'http://localhost:5180/';
const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.goto(BASE, { waitUntil: 'networkidle0' });
const out = await page.evaluate(async () => {
  const { createAudio } = await import('/src/audio/index.js');
  const run = async (noSpace) => {
    const sr = 48000, secs = 30, ctx = new OfflineAudioContext(2, sr * secs, sr);
    const a = createAudio({ context: ctx, noSpace });
    a.unlock(); a.setSpeed(60, 2); a.setHover?.(true, 0.6);
    a._scheduleUntil(secs);
    for (let t = 0.5; t < secs; t += 0.4) { /* efectos de paso de caja: ~2,5 por segundo */ }
    const t0 = performance.now(); await ctx.startRendering(); return +(performance.now() - t0).toFixed(0);
  };
  const r = {};
  for (let i = 0; i < 2; i++) { r['con peines ' + i] = await run(false); r['sin peines ' + i] = await run(true); }
  return r;
});
console.log(JSON.stringify({ url: BASE, msPor30s: out }));
await browser.close();
