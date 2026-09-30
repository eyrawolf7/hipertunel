// Extra de vibración (QA): reintento tras morir, reanudar tras pausa, y velocidad máxima.
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const rec = (ok, n, i) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n}  — ${JSON.stringify(i)}`); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
async function abrir() {
  const page = await browser.newPage();
  await page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => { window.__vib = []; navigator.vibrate = (p) => { window.__vib.push({ t: performance.now(), p, st: window.__hip ? window.__hip.state : 'carga' }); return true; }; });
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
  await sleep(500); return page;
}
const log = (p) => p.evaluate(() => window.__vib.slice());
const clr = (p) => p.evaluate(() => { window.__vib.length = 0; });
const maxSeg = (l) => { const on = []; for (const c of l) { const a = Array.isArray(c.p) ? c.p : [c.p]; let t = c.t; a.forEach((x, j) => { if (j % 2 === 0 && x > 0) on.push(t); t += x; }); } let m = 0; for (let i = 0; i < on.length; i++) { let n = 0; for (let j = i; j < on.length && on[j] - on[i] < 1000; j++) n++; m = Math.max(m, n); } return m; };
// 1) morir y reintentar (startGame rápido): vuelve a vibrar
{
  const page = await abrir();
  await page.evaluate(() => { const h = window.__hip; h.start('classic', 3); const g = h.game; h.input.steer = () => { const b = g.boxes.find((x) => !x.hit && x.k > g.s); if (!b) return 0; let d = b.lane * Math.PI / 6 - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.max(-1, Math.min(1, d * 4)); }; });
  await page.waitForFunction(() => window.__hip.state === 'over', { timeout: 60000 });
  await sleep(800); await clr(page);
  await page.evaluate(() => window.__hip.start('classic', 7));
  await page.evaluate(() => { const h = window.__hip, g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; });
  await sleep(4000);
  const l = await log(page);
  rec(l.filter((c) => c.p !== 0).length >= 5, 'tras morir y reintentar vuelve a vibrar', { n: l.filter((c) => c.p !== 0).length });
  await page.close();
}
// 2) pausa y reanudar: nada en la cuenta atrás, luego vuelve
{
  const page = await abrir();
  await page.evaluate(() => { const h = window.__hip; h.start('classic', 7); const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; });
  await sleep(1500); await page.keyboard.press('KeyP'); await sleep(700); await clr(page);
  await page.keyboard.press('KeyP'); await sleep(600);
  const a = await log(page), s1 = await page.evaluate(() => window.__hip.state);
  await sleep(4000);
  const b = await log(page);
  rec(s1 === 'countdown' && a.filter((c) => c.p !== 0).length === 0 && b.filter((c) => c.p !== 0).length >= 5, 'reanudar: cuenta atrás muda y luego vuelve a vibrar', { s1, enCuenta: a.length, total: b.length });
  await page.close();
}
// 3) velocidad máxima, larga: tope
{
  const page = await abrir();
  await page.evaluate(() => { const h = window.__hip; h.start('arcade', 5); const g = h.game; h.input.steer = () => h.bot(g); g.invul = 1e9; });
  await page.waitForFunction(() => window.__hip.game.level >= 3, { timeout: 120000 }).catch(() => {});
  await clr(page); await sleep(10000);
  const lv = await page.evaluate(() => window.__hip.game.level), l = await log(page);
  rec(lv >= 3 && maxSeg(l) <= 12, 'nivel 3: como mucho 12 pulsos/s', { lv, max: maxSeg(l), n: l.length });
  await page.close();
}
await browser.close(); process.exit(fallos ? 1 : 0);
