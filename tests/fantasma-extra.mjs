// Huecos de fantasma.mjs: datos corruptos, fantasma de otras reglas, y aviso de récord por distancia frente a puntos.
// Uso: HIP_URL=http://localhost:5173/ node tests/fantasma-extra.mjs
import puppeteer from 'puppeteer';
const URL0 = (process.env.HIP_URL || 'http://localhost:5173/') + '?q=media';
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let fallos = 0;
const rec = (ok, n, d) => { if (!ok) fallos++; console.log(`${ok ? 'PASA ' : 'FALLA'}  ${n}${d !== undefined ? '  — ' + JSON.stringify(d) : ''}`); };
for (let t = 0; t < 3; t++) { try { await page.goto(URL0, { waitUntil: 'networkidle0' }); break; } catch (e) { if (t === 2) throw e; } }
await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1000));
const K = 'hipertunel-fantasma-arcade', T = 'hipertunel-top-arcade';
await page.evaluate((K, T) => { localStorage.removeItem(K); localStorage.removeItem(T); window.__freeze = true; }, K, T);

// 1) corrupto: ninguna partida se rompe
for (const bad of ['{', 'null', '[]', '{"v":1,"seed":1,"n":3,"steers":"AAAA","tricks":5}', '{"v":1,"seed":1,"n":2,"steers":"%%%%"}']) {
  const r = await page.evaluate((K, T, bad) => {
    localStorage.setItem(T, JSON.stringify([{ score: 500, distM: 100, coins: 0, time: 1, date: 1 }])); localStorage.setItem(K, bad);
    try { window.__hip.start('arcade', 5); window.__hip.sim(120); return { ok: true, g: window.__hip.renderer.ghostGame === null }; } catch (e) { return { ok: false, e: String(e) }; }
  }, K, T, bad);
  rec(r.ok && r.g, 'dato corrupto no rompe ni crea fantasma', { bad: bad.slice(0, 30), ...r });
}

// 2) fantasma de otras reglas (filas finales alteradas): se descarta al morir y se borra
const frames = (n = 2) => page.evaluate((n) => new Promise((res) => { let i = 0; const f = () => (++i >= n ? res() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const go = async (steps) => { for (let d = 0; d < steps; d += 60) { await page.evaluate(() => window.__hip.sim(60)); await frames(1); } };
await page.evaluate((K, T) => { localStorage.removeItem(K); localStorage.removeItem(T); const h = window.__hip; h.start('arcade', 4249); h.game.easyWalls = 3; }, K, T);
await frames(3);
for (let i = 0; i < 300; i++) { const s = await page.evaluate(() => { window.__hip.sim(60); return window.__hip.state; }); await frames(1); if (s !== 'play') break; }
const g1 = await page.evaluate(() => ({ st: window.__hip.state }));
rec(g1.st === 'dying' || g1.st === 'over', 'partida con bot muere', { st: g1.st });
await page.waitForFunction(() => window.__hip.state === 'over', { timeout: 15000 }).catch(() => {});
const raw = await page.evaluate((K) => localStorage.getItem(K), K);
rec(!!raw, 'se guarda el fantasma tras la primera partida', { kb: raw && +(raw.length / 1024).toFixed(1) });
if (raw) {
  const n0 = JSON.parse(raw).n;
  const had = await page.evaluate((K, raw) => {
    const o = JSON.parse(raw); o.rows += 7; localStorage.setItem(K, JSON.stringify(o));
    const h = window.__hip; h.start('arcade', 1); h.game.invul = 1e9; return h.renderer.ghostGame !== null;
  }, K, raw);
  await frames(3); await go(n0 + 60);
  const r = await page.evaluate((K, had) => ({ had, after: window.__hip.renderer.ghostGame === null, key: localStorage.getItem(K) === null }), K, had);
  rec(r.had && r.after && !r.key, "fantasma con filas distintas se descarta en la partida y el dato se conserva hasta el próximo récord", r);
  // sin desechar: el fantasma sigue vivo pasado n (reglas más blandas) no se detecta
  // simulado: reglas "más blandas" = el fantasma no muere en su paso n (se fuerza con invul del fantasma)
  await page.evaluate((K, raw) => {
    localStorage.setItem(K, raw);
    const h = window.__hip; h.start('arcade', 1); h.game.invul = 1e9; h.renderer.ghostGame.invul = 1e9;
  }, K, raw);
  await frames(3); await go(n0 + 240);
  const r2 = await page.evaluate((n) => { const gg = window.__hip.renderer.ghostGame; return { ghostAlivePastN: !!(gg && gg.alive), frame: window.__hip.game.frame, n }; }, n0);
  rec(!r2.ghostAlivePastN, 'un fantasma que sigue vivo pasado su último paso (otras reglas) también se descarta', r2);
}

// 3) el aviso "¡Nuevo récord!" usa distancia; el récord del Arcade es por puntos
await page.evaluate((T) => {
  localStorage.removeItem('hipertunel-fantasma-arcade');
  localStorage.setItem(T, JSON.stringify([{ score: 9999999, distM: 400, coins: 0, time: 1, date: 1 }]));
  const h = window.__hip; window.__t = [];
  const raw = h.ui.toast; h.ui.toast = (t, k, o) => { window.__t.push(t); return raw(t, k, o); };
  h.start('arcade', 9); h.game.invul = 1e9;
}, T);
await frames(3);
for (let i = 0; i < 60; i++) { const d = await page.evaluate(() => { window.__hip.sim(60); return window.__hip.game.distanceM; }); await frames(1); if (d > 480) break; }
const r3 = await page.evaluate(() => ({ distM: window.__hip.game.distanceM, toasts: window.__t.filter((x) => /récord/i.test(x)) }));
rec(r3.toasts.length === 0, 'no avisa de récord si la distancia supera el mejor pero los puntos no (récord = puntos)', r3);

rec(errors.length === 0, 'sin errores de página', errors.slice(0, 3));
await browser.close();
console.log(fallos ? `\n${fallos} fallos` : '\nTodo OK');
process.exit(fallos ? 1 : 0);
