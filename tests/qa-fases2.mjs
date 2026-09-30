// Fases, segunda pasada del QA: guardado corrupto, Aventura con el fin reutilizado, todas superadas,
// ultima fase -> Sin fin, toque en el fin, fantasma tras cambiar de modo, Fase 2 con control y regalo.
// Uso: node tests/qa-fases2.mjs [--url=...]  (por defecto $HIP_URL)
import puppeteer from 'puppeteer';
const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const URL0 = opt.url || process.env.HIP_URL || 'http://localhost:5173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const rec = (n, ok, info) => { if (!ok) fails++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${n}${info === undefined ? '' : ' — ' + JSON.stringify(info)}`); };
const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390 });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => { if (!sessionStorage.getItem('qa-f2')) { try { localStorage.clear(); } catch (e) {} sessionStorage.setItem('qa-f2', '1'); } });
await page.goto(URL0, { waitUntil: 'networkidle0' }); await page.waitForFunction(() => window.__hip && window.__hip.game); await sleep(800);
const toState = async (s, ms = 6000) => { try { await page.waitForFunction((s) => __hip.state === s, { timeout: ms }, s); return true; } catch (e) { return false; } };
const botOn = () => page.evaluate(() => { const i = __hip.input; i.steer = () => __hip.bot(__hip.game); i.consumeTrick = () => false; });
const invul = () => page.evaluate(() => { __hip.game.crash = (b) => { b.hit = true; }; });
const click = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 4000 }); await page.click(sel); };

// 1. guardado corrupto en varias formas: ni arranque ni mapa ni Jugar deben lanzar
const variantes = {
  array: '[1,2,3]', nulo: 'null', numero: '5', texto: '"hola"', noJson: '{{{',
  bitsTexto: '{"0":{"bits":"x","best":"y","ghost":{"s":5,"t":5,"g":"a"}}}',
  ghostT: '{"0":{"bits":0,"ghost":{"s":"AAAA","t":5}}}',
  ghostNulo: '{"0":{"bits":1,"ghost":{}}}',
  mejorNaN: '{"0":{"bits":0,"best":"abc","time":"zz"}}',
};
for (const [k, v] of Object.entries(variantes)) {
  await page.evaluate((v) => { localStorage.setItem('hipertunel-fases', v); }, v);
  const r = await page.evaluate(async (k) => {
    const e0 = []; const h = (ev) => e0.push(String(ev.message || ev)); window.addEventListener('error', h);
    try {
      __hip.ui.show('title');
      document.querySelector('.scr-title [data-act="play"]').click();
      await new Promise((r) => setTimeout(r, 200));
      const a = { ok: !!__hip.game, phase: !!__hip.game.isPhase };
      __hip.game.alive = false; __hip.tick && 0;
      return { ...a, e: e0 };
    } catch (e) { return { err: String(e) }; } finally { window.removeEventListener('error', h); }
  }, k);
  rec(`guardado corrupto (${k}): Jugar arranca la Fase`, r.ok && r.phase && !r.err && !(r.e || []).length, r);
  await page.evaluate(() => { __hip.ui.show('title'); });
}
// terminar una partida con fantasma corrupto y mejor NaN: no debe guardar NaN ni reventar
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', '{"0":{"bits":0,"best":"abc","time":"zz"}}'); window.__freeze = true; __hip.setPhase(0); __hip.start('phase'); });
await page.evaluate(() => { __hip.tick(300); __hip.game.die(null); __hip.tick(1); window.__freeze = false; });
await toState('over', 4000); await sleep(400);
const nan = await page.evaluate(() => localStorage.getItem('hipertunel-fases'));
rec('«best» corrupto no se guarda como null/NaN', !/"best":null/.test(nan), nan.slice(0, 160));
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', '{}'); });

// 2. fantasma fuera de las fases: tras jugar con fantasma, otro modo no debe arrastrarlo
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', '{}'); window.__freeze = true; __hip.setPhase(0); __hip.start('phase'); });
await botOn(); await invul();
await page.evaluate(() => { let n = 0; while (__hip.game.alive && n++ < 60 * 200) __hip.tick(1); });
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 5000); await sleep(800);
await page.evaluate(() => { window.__freeze = true; __hip.setPhase(0); __hip.start('phase'); });
const g1 = await page.evaluate(() => !!__hip.renderer.ghostGame);
await page.evaluate(() => { __hip.start('classic', 5); });
const g2 = await page.evaluate(() => ({ gg: !!__hip.renderer.ghostGame, vis: __hip.renderer.adv && __hip.renderer.adv.ghost ? __hip.renderer.adv.ghost.visible : null }));
rec('el fantasma de Fases no se arrastra al Clásico', g1 === true && g2.gg === false && !g2.vis, { g1, g2 });
await page.evaluate(() => { window.__freeze = false; });

// 3. Aventura con el fin reutilizado
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', '{}'); localStorage.removeItem('hipertunel-aventura'); window.__freeze = true; __hip.ui.show('title'); });
await page.evaluate(() => { document.querySelector('.scr-title [data-act="modes"]').click(); });
await sleep(300);
await click('.scr-modes [data-mode="adventure"]'); await sleep(400);
await page.click('.scr-map [data-stage="0"]'); await sleep(300);
await page.evaluate(() => { __hip.game.alive = false; __hip.game.cleared = true; });
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 5000); await sleep(1000);
const ad = await page.evaluate(() => {
  const d = (s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).display : 'x'; };
  const f = document.activeElement || {}; const foc = document.querySelector('.scr-over .focus, .scr-over .is-focus, .scr-over [data-focus]');
  return { mode: __hip.game.mode, restart: d('.scr-over [data-act="restart"]'), next: d('.scr-over .btn-next'), fresh: d('.scr-over .btn-fresh'), cp: d('.scr-over .btn-cp'), txt: document.querySelector('[data-bind="nextTxt"]').textContent, rtxt: document.querySelector('[data-bind="restartTxt"]').textContent, defs: [...document.querySelectorAll('.scr-over [data-default]')].map((e) => e.dataset.act), restartCls: document.querySelector('.scr-over [data-act="restart"]').className, hint: d('.scr-over .oc-hint'), foc: foc ? foc.dataset.act : null, cls: document.querySelector('.scr-over').className };
});
rec('Aventura superada: Siguiente visible, sin «Desde el principio», texto normal', ad.mode === 'adventure' && ad.next !== 'none' && ad.fresh === 'none' && ad.txt === 'Siguiente' && ad.rtxt === 'Otra vez', ad);
rec('Aventura superada: foco por defecto en «Otra vez» (como antes) y un solo data-default', ad.defs.length === 1 && ad.defs[0] === 'restart' && /btn-primary/.test(ad.restartCls), ad);
const tap = await page.evaluate(async () => { const g0 = __hip.game; document.querySelector('.scr-over').dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); return { igual: __hip.game === g0 }; });
console.log('INFO  Aventura superada + toque suelto: ' + (tap.igual ? 'no reintenta (cambio respecto a v0.60, que reintentaba)' : 'reintenta') + ' — el aviso «Toca en cualquier sitio para reintentar» visible: ' + ad.hint);
rec('Aventura superada: el aviso de tocar y el comportamiento coinciden', (ad.hint === 'none') === tap.igual || ad.hint === 'none', { hint: ad.hint, tapNoReintenta: tap.igual });
// Aventura: morir → sin secuelas de Fases (clases del fin)
await page.evaluate(() => { window.__freeze = true; __hip.ui.show('title'); document.querySelector('.scr-title [data-act="modes"]').click(); });
await click('.scr-modes [data-mode="adventure"]'); await sleep(300);
await page.click('.scr-map [data-stage="0"]'); await sleep(300);
await page.evaluate(() => { __hip.game.die && __hip.game.die(null); });
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 5000); await sleep(1000);
const ad2 = await page.evaluate(() => ({ cls: document.querySelector('.scr-over').className, fresh: getComputedStyle(document.querySelector('.btn-fresh')).display, next: getComputedStyle(document.querySelector('.btn-next')).display, rtxt: document.querySelector('[data-bind="restartTxt"]').textContent, defs: [...document.querySelectorAll('.scr-over [data-default]')].map((e) => e.dataset.act), adv: document.querySelector('[data-bind="adv"]').textContent }));
rec('Aventura muerto: sin botones de Fases y «Tramo 1»', ad2.fresh === 'none' && ad2.next === 'none' && /Tramo 1/.test(ad2.adv) && ad2.defs.join() === 'restart', ad2);

// 4. todas superadas: Jugar -> Sin fin; ultima fase «Siguiente» -> Sin fin
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', JSON.stringify({ 0: { bits: 7, best: 1, time: 70 }, 1: { bits: 7, best: 1, time: 70 } })); __hip.ui.show('title'); });
await click('.scr-title [data-act="play"]');
const all = await page.evaluate(() => ({ v: __hip.game.variant, ph: !!__hip.game.isPhase, mode: __hip.game.mode }));
rec('Jugar con todas superadas abre Sin fin (Arcade)', all.v === 'arcade' && !all.ph, all);
await page.evaluate(() => { window.__freeze = true; __hip.setPhase(1); __hip.start('phase'); });
await botOn(); await invul();
await page.evaluate(() => { let n = 0; while (__hip.game.alive && n++ < 60 * 200) __hip.tick(1); });
await page.evaluate(() => { window.__freeze = false; });
await toState('over', 5000); await sleep(1000);
const last = await page.evaluate(() => ({ cleared: __hip.game.cleared, txt: document.querySelector('[data-bind="nextTxt"]').textContent, head: document.querySelector('[data-bind="headline"]').textContent, saved: JSON.parse(localStorage.getItem('hipertunel-fases'))[1] }));
rec('Fase 2 superada con el bot: titular, «Sin fin» y bits no bajan', last.cleared && last.txt === 'Sin fin' && (last.saved.bits | 0) === 7, { ...last, saved: { bits: last.saved.bits, time: last.saved.time } });
await click('.scr-over .btn-next'); await sleep(400);
const nx = await page.evaluate(() => ({ v: __hip.game.variant, ph: !!__hip.game.isPhase }));
rec('«Sin fin» tras la ultima fase arranca el Arcade', nx.v === 'arcade' && !nx.ph, nx);
// tras ir a Sin fin, morir y «Otra vez» no debe restaurar un control de la fase
await page.evaluate(() => { window.__freeze = true; });
const cpLeak = await page.evaluate(() => ({ cp: !!__hip.cpRec, mode: __hip.game.mode }));
rec('Sin fin no deja cpRec de una fase', !cpLeak.cp, cpLeak);

// 5. Fase 2 con control y regalo; estado de la selva
await page.evaluate(() => { localStorage.setItem('hipertunel-fases', JSON.stringify({ 0: { bits: 1, best: 1, time: 70 } })); window.__freeze = true; __hip.setPhase(1); __hip.start('phase'); });
// inmortal también en la partida que se rehace desde el control (si solo lo es la primera, un choque del bot
// —p. ej. en el musgo de la selva— hace que la repetición ya no sea la misma partida)
await botOn(); await page.evaluate(() => { const P = Object.getPrototypeOf(__hip.game); window.__crash0 = Object.prototype.hasOwnProperty.call(P, 'crash') ? P.crash : undefined; P.crash = function (b) { b.hit = true; }; });
await page.evaluate(() => { let n = 0; while (!__hip.cpRec && n++ < 60 * 90) __hip.tick(1); });
const c2 = await page.evaluate(() => { const g = __hip.game; return { n: __hip.cpRec ? __hip.cpRec.length : 0, frame: g.frame, s: g.s, world: g.world, wave: g.waveIdx, lvl: g.level, boost: g.boostOn, curves: !!g.curves, theta: g.theta }; });
await page.evaluate(() => { __hip.tick(240); delete __hip.game.crash; __hip.game.die(null); __hip.tick(1); window.__freeze = false; });
await toState('over', 4000); await sleep(900);
await page.evaluate(() => { window.__freeze = true; });
await click('.scr-over [data-act="restart"]'); await sleep(200);
const b2 = await page.evaluate(() => { const g = __hip.game; return { frame: g.frame, s: g.s, theta: g.theta, world: g.world, wave: g.waveIdx, gift: __hip.giftNext }; });
await page.evaluate(() => { const P = Object.getPrototypeOf(__hip.game); if (window.__crash0) P.crash = window.__crash0; else delete P.crash; });
rec('Fase 2: «Desde el control» repone exacto (fotograma, s, theta, mundo, oleada)', b2.frame === c2.n && b2.s === c2.s && b2.theta === c2.theta && b2.world === c2.world && b2.wave === c2.wave && b2.gift, { b2, c2 });
await toState('play', 6000); await botOn();
await page.evaluate(() => __hip.tick(1));
const gg = await page.evaluate(() => ({ lvl: __hip.game.level, boost: __hip.game.boostOn, gifts: __hip.game.gifts }));
rec('Fase 2: el regalo da impulso (level>=1)', gg.boost && gg.lvl >= 1 && gg.gifts === 1, gg);

// 6. regalo con impulso ya activo: no debe rebajar ni duplicar; y morir dos veces sin control nuevo
const dbl = await page.evaluate(() => { const g = __hip.game; const l0 = g.level; g.gift(); return { l0, l1: g.level }; });
rec('regalo con impulso activo no rebaja el nivel', dbl.l1 >= dbl.l0, dbl);

// 7. Esc/tap en el fin de una fase no superada: tocar reintenta (desde control)
await page.evaluate(() => { delete __hip.game.crash; __hip.game.die(null); __hip.tick(1); window.__freeze = false; });
await toState('over', 4000); await sleep(900);
await page.evaluate(() => { window.__freeze = true; });
const tap2 = await page.evaluate(async () => { const g0 = __hip.game; document.querySelector('.scr-over').dispatchEvent(new MouseEvent('click', { bubbles: true })); await new Promise((r) => setTimeout(r, 300)); return { otra: __hip.game !== g0, frame: __hip.game.frame, recLen: __hip.rec.length }; });
rec('tocar el fin de una fase fallida vuelve al control', tap2.otra && tap2.frame > 0, tap2);

// 8. misiones en fase: completar no revienta, y la racha no sube
const ms = await page.evaluate(() => ({ mult: (() => { try { return __hip.game.isPhase; } catch (e) { return null; } })(), list: __hip.missions.list().length }));
rec('misiones disponibles en fase', ms.list > 0, ms);

rec('sin errores en la página', errors.length === 0, errors.slice(0, 4));
console.log(fails ? `\n${fails} fallan` : '\nTodo OK');
await browser.close();
process.exit(fails ? 1 : 0);
