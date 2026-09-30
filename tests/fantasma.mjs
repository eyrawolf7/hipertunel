// Fantasma del Arcade: la mejor partida se guarda (semilla + entradas) y se repite exacta.
// Uso: node tests/fantasma.mjs [--sim] [--web] [--n=100]   (sin flags: las dos partes; --web necesita el servidor en $HIP_URL)
//  A) sim: 100 partidas con bot (los 4 niveles, con muros fáciles y piruetas) se graban, se guardan como texto,
//     se leen y se repiten: la huella del estado cada segundo y el final tienen que coincidir siempre;
//     una entrada cambiada tiene que desincronizar (que no pase en vacío) y un dato roto se rechaza.
//  B) web: por el bucle real. Guarda y carga el fantasma, avanza en paralelo, el aviso de récord salta en la fila
//     exacta, y el fantasma no toca el 20 % central (proyección y comparación de píxeles con/sin fantasma).
import { createBot, makeGame } from './bot-pro.mjs';
import { GhostRecorder, quantGhost, unpackRun, newGhostGame, stepGhost, ghostMatches, replayRun } from '../app/src/ghost.js';

const opt = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? '1']; }));
const N = +(opt.n || 100);
const doSim = opt.sim || !opt.web, doWeb = opt.web || !opt.sim;
let fallos = 0;
const rec = (ok, name, info) => { if (!ok) fallos++; console.log(`${ok ? 'PASA' : 'FALLA'}  ${name}${info ? '  — ' + JSON.stringify(info) : ''}`); };

const fingerprint = (g) => `${g.s}|${g.theta}|${g.rowsPassed}|${g.coinsGot}|${g.world}|${g.level}|${g.boxes.length}|${g.alive}`;
const LEVELS = ['novato', 'medio', 'bueno', 'experto'];

if (doSim) {
  let desync = 0, died = 0, withTricks = 0, withWorld2 = 0, bytes = 0, maxBytes = 0, frames = 0;
  const runs = [];
  for (let i = 0; i < N; i++) {
    const seed = 5000 + i * 37, easy = i % 4, level = LEVELS[i % 4];
    const g = makeGame('arcade', seed); g.easyWalls = easy;
    const bot = createBot(level, seed), R = new GhostRecorder({ seed, easy });
    const fps = [];
    let tr = 0;
    while (g.alive && g.frame < 240 * 60) {
      const o = bot(g);
      const steer = quantGhost(o.steer || 0), trick = !!o.trick;
      R.push(steer, trick);
      for (const e of g.step({ steer, trick })) if (e.type === 'trickDone') tr++;
      if (g.frame % 60 === 0) fps.push(fingerprint(g));
    }
    const fin = { rows: g.rowsPassed, score: g.rowsPassed * 4, distM: g.distanceM };
    const text = JSON.stringify(R.pack(fin));                  // lo que va a localStorage
    bytes += text.length; maxBytes = Math.max(maxBytes, text.length); frames += R.steers.length;
    if (!g.alive) died++;
    if (tr > 0) withTricks++;
    if (g.world >= 2) withWorld2++;
    // repaso desde el texto, con los mismos pasos que el bucle de main.js
    const run = unpackRun(JSON.parse(text));
    const h = newGhostGame(run);
    let ok = !!run, k = 0;
    while (ok && h.frame < run.n) {
      stepGhost(h, run);
      if (h.frame % 60 === 0) { if (fingerprint(h) !== fps[k++]) ok = false; }
    }
    if (ok && !g.alive && !ghostMatches(h, run)) ok = false;
    if (ok && fingerprint(h) !== fingerprint(g)) ok = false;
    if (!ok) { desync++; console.log('  desincronía en', { seed, level, easy, frame: h.frame }); }
    runs.push({ run, g, seed });
  }
  rec(desync === 0, `${N} repeticiones sin ninguna desincronía`, { desync, muertas: died, conPiruetas: withTricks, conMundo2: withWorld2, pasos: frames });
  rec(withTricks >= 10 && withWorld2 >= 10 && died >= N * 0.7, 'cobertura: piruetas, salto entre mundos y muertes de verdad', { withTricks, withWorld2, died });
  rec(maxBytes < 120000, 'tamaño guardado razonable', { mediaKB: +(bytes / N / 1024).toFixed(1), maxKB: +(maxBytes / 1024).toFixed(1) });

  // la prueba no puede pasar en vacío: cambiar una sola entrada tiene que cambiar el final
  let cambiaron = 0, muestras = 0;
  for (const { run, g } of runs.slice(0, 20)) {
    if (run.n < 200) continue;
    muestras++;
    const m = { ...run, steers: Float64Array.from(run.steers) };
    for (let j = Math.floor(run.n / 2); j < Math.floor(run.n / 2) + 20; j++) m.steers[j] += 0.45;
    const h = replayRun(m);
    if (fingerprint(h) !== fingerprint(g) || !ghostMatches(h, run)) cambiaron++;
  }
  rec(muestras >= 10 && cambiaron >= muestras * 0.7, 'una entrada distinta desincroniza (la prueba no pasa en vacío)', { cambiaron, muestras });
  // y un dato roto o de otra versión se rechaza
  const ok0 = runs[0].run;
  const bien = JSON.parse(JSON.stringify({ v: 1, seed: 1, easy: 0, n: 2, steers: btoa('\0\0\0\0'), tricks: [], rows: 1, score: 4, distM: 4 }));
  rec(unpackRun(bien) !== null && unpackRun({ ...bien, v: 2 }) === null && unpackRun({ ...bien, n: 3 }) === null && unpackRun({ ...bien, steers: '@@@' }) === null && unpackRun(null) === null && unpackRun({}) === null, 'datos rotos o de otra versión se rechazan');
  rec(ok0.n > 0, 'hay al menos una partida grabada');
}

if (doWeb) {
  const puppeteer = (await import('puppeteer')).default;
  const URL0 = (process.env.HIP_URL || 'http://localhost:5173/') + '?q=media';
  const W = +(opt.w || 844), H = +(opt.h || 390);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const browser = await puppeteer.launch({ headless: 'new', args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1, isMobile: true, hasTouch: true, isLandscape: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL0, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__hip && window.__hip.game, { timeout: 20000 });
  await sleep(800);
  await page.evaluate(() => { for (const k of ['hipertunel-top-arcade', 'hipertunel-fantasma-arcade']) localStorage.removeItem(k); window.__freeze = true; });

  // 1) partida grabada por el bucle real. Las entradas salen de un bot de Node que juega de verdad (sin trucos: nada de
  //    invulnerabilidad, que no es una entrada y no se puede repetir) y se dan al bucle de main.js paso a paso.
  //    Se busca una semilla con piruetas, salto entre mundos y muerte, con los muros fáciles de la primera partida.
  let plan = null;
  for (let seed = 4242; seed < 4242 + 60 && !plan; seed++) {
    const g = makeGame('arcade', seed); g.easyWalls = 3;
    const bot = createBot('medio', seed), steers = [], tricks = [];
    while (g.alive && g.frame < 200 * 60) {
      const o = bot(g), steer = quantGhost(o.steer || 0), trick = !!o.trick;
      if (trick) tricks.push(g.frame);
      steers.push(steer); g.step({ steer, trick });
    }
    if (!g.alive && g.tricksTotal > 0 && g.world >= 2) plan = { seed, steers, tricks, rows: g.rowsPassed, frames: steers.length };
  }
  rec(!!plan, 'hay una partida de bot con piruetas, salto entre mundos y muerte para grabar', plan && { seed: plan.seed, pasos: plan.frames, filas: plan.rows });
  const sin = await page.evaluate(() => window.__hip.renderer.ghostGame === null);
  await page.evaluate((p) => {
    const h = window.__hip; h.start('arcade', p.seed);
    const tr = new Set(p.tricks);
    h.input.steer = () => p.steers[h.game.frame] ?? 0;
    h.input.consumeTrick = () => tr.has(h.game.frame);
  }, plan);
  for (let i = 0; i < 100; i++) { const st = await page.evaluate(() => { window.__hip.sim(300); return window.__hip.state; }); if (st !== 'play') break; }
  await page.waitForFunction(() => window.__hip.state === 'over', { timeout: 15000 });
  const one = await page.evaluate(() => ({ raw: localStorage.getItem('hipertunel-fantasma-arcade'), top: JSON.parse(localStorage.getItem('hipertunel-top-arcade') || '[]'), tricks: window.__hip.game.tricksTotal, world: window.__hip.game.world, rows: window.__hip.game.rowsPassed }));
  const saved = one.raw ? JSON.parse(one.raw) : null;
  rec(sin, 'sin partida guardada no hay fantasma');
  rec(!!saved && saved.seed === plan.seed && saved.n === plan.frames && saved.rows === plan.rows && saved.score === one.top[0]?.score && saved.rows * 4 === one.top[0]?.distM && saved.rows === one.rows, 'la mejor partida se guarda con su semilla, puntos y fila final', saved && { seed: saved.seed, n: saved.n, rows: saved.rows, score: saved.score, top: one.top[0]?.score, kb: +(one.raw.length / 1024).toFixed(1) });
  rec(one.tricks > 0 && one.world >= 2, 'la partida grabada tiene piruetas y salto entre mundos', { tricks: one.tricks, world: one.world });
  const run = saved && unpackRun(saved);
  const rp = run && replayRun(run);
  rec(!!rp && ghostMatches(rp, run) && rp.rowsPassed === plan.rows, 'lo grabado por el bucle real se repite exacto fuera del navegador', rp && { rows: rp.rowsPassed, esperado: run.rows, frame: rp.frame, n: run.n });

  // 2) segunda partida con otra semilla: el fantasma corre en paralelo, el aviso salta en la fila exacta y no toca el centro
  await page.evaluate(() => {
    const h = window.__hip; h.start('arcade', 777);
    const inp = h.input; window.__toasts = [];
    const raw = h.ui.toast; h.ui.toast = (t, k, o) => { window.__toasts.push({ t, rows: h.game.rowsPassed, frame: h.game.frame, prev: window.__prevScore, score: h.arcScore() }); return raw(t, k, o); };
    window.__pol = 'bot';
    inp.steer = () => {   // alterna: seguir el carril del fantasma (para taparte el centro) y jugar con el bot
      const g = h.game, gg = h.renderer.ghostGame;
      if ((window.__pol === 'chase' || window.__pol === 'flank') && gg && gg.alive) { let d = gg.theta + (window.__pol === 'flank' ? Math.PI : 0) - g.theta; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.max(-0.5, Math.min(0.5, d * 3)); }
      return window.__pol === "slow" ? 0 : h.bot(g);
    };
    inp.consumeTrick = () => { const g = h.game; return !!g.flight() && g.landIn > 0.35 && g.trickT < 0; };
    h.game.invul = 1e9;
  });
  const setup = await page.evaluate(() => ({ ghost: !!window.__hip.renderer.ghostGame, rec: window.__hip.renderer.kit.recordRow }));
  rec(setup.ghost && setup.rec === saved.rows, 'la partida siguiente carga el fantasma y la marca dorada en la fila del récord', { ...setup, esperado: saved.rows });

  const medir = (chunk) => page.evaluate((n) => new Promise((res) => {
    const h = window.__hip; for (let i = 0; i < n; i++) { window.__prevScore = h.arcScore(); h.sim(1); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = h.renderer, g = h.game, gg = r.ghostGame, gs = r.adv.ghost, cam = r.camera, cv = r.renderer.domElement;
      const out = { frame: g.frame, ghostFrame: gg ? gg.frame : -1, ghostAlive: gg ? gg.alive : null, ghostRows: gg ? gg.rowsPassed : -1, state: h.state, vis: gs.visible, op: gs.material.opacity };
      const info = r.adv.ghostInfo; const chipEl = document.querySelector('.hud-ghost'); out.chip = chipEl && chipEl.classList.contains('on') ? chipEl.textContent : null; out.gapM = gg ? Math.round((gg.s - g.s) * 4) : null;
      if (gg && gg.alive && info) {
        // dónde queda la marca en pantalla (sin margen de brillo): ¿toca el 20 % central (±0,2 en pantalla normalizada)?
        const v = gs.position.clone().project(cam), depth = -gs.position.clone().applyMatrix4(cam.matrixWorldInverse).z;
        const ry = gs.scale.x * 0.5 / (depth * Math.tan(cam.fov * Math.PI / 360)), rx = ry / cam.aspect;
        out.ahead = true; out.pinned = info.pinned; out.gap = gg.s - g.s;
        out.touches = Math.abs(v.x) - rx < 0.2 && Math.abs(v.y) - ry < 0.2 && v.z > -1 && v.z < 1;
        out.dbg = [+(gg.s - g.s).toFixed(1), +v.x.toFixed(2), +v.y.toFixed(2), +rx.toFixed(3), +ry.toFixed(3), info.pinned];
        out.rScreen = ry;
        if (gs.visible) {
          const W = cv.width, H = cv.height, x0 = Math.round(W * 0.4), y0 = Math.round(H * 0.4), w = Math.round(W * 0.2), hh = Math.round(H * 0.2);
          const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d', { willReadFrequently: true });
          const grab = () => { r.render(); cx.clearRect(0, 0, W, H); cx.drawImage(cv, 0, 0); return cx.getImageData(0, 0, W, H).data; };
          const a = grab(), a2 = grab(); gs.visible = false; const b = grab(); gs.visible = true;
          let base = 0, ctr = 0, out2 = 0, faint = 0, mx = 0;
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            if (Math.abs(a[i] - a2[i]) + Math.abs(a[i + 1] - a2[i + 1]) + Math.abs(a[i + 2] - a2[i + 2]) > 3) base++;
            const dd = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (dd > 3) { if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + hh) { faint++; mx = Math.max(mx, dd); if (dd > 12) ctr++; } else out2++; }
          }
          out.pix = { base, ctr, out: out2, faint, mx };
        }
      }
      res(out);
    }));
  }), chunk);

  const S = { n: 0, lock: 0, lockBad: 0, vis: 0, visTouch: 0, hiddenNear: 0, pixN: 0, pixCtr: 0, pixOut: 0, pixBase: 0, ghostEnd: null };
  for (let i = 0; i < Math.ceil(saved.n / 10) + 300; i++) {
    await page.evaluate((i) => { window.__pol = i >= 150 ? 'bot' : Math.floor(i / 12) % 2 ? 'chase' : 'flank'; }, i);
    const m = await medir(10);
    S.n++; if (m.ghostAlive) { S.chipN = (S.chipN || 0) + 1; const mm = m.chip && /(▲|▼) ([\d.,]+) m/.exec(m.chip); const val = mm ? (mm[1] === "▲" ? 1 : -1) * +mm[2].replace(/\./g, "") : null; if (val !== null && Math.abs(val - m.gapM) <= 8) S.chipOk = (S.chipOk || 0) + 1; }
    if (opt.debug && m.dbg && i % 3 === 0) console.log(i, JSON.stringify(m.dbg), m.vis, m.op.toFixed(2));
    if (m.ghostAlive) { S.lock++; if (m.ghostFrame !== m.frame) S.lockBad++; }
    if (m.ahead && m.vis && m.op > 0.05) { S.vis++; if (m.touches) S.visTouch++; }
    if (m.ahead && m.pinned) S.hiddenNear++;
    if (m.pix && m.pix.ctr > 0) console.log("  centro tocado", i, JSON.stringify(m.dbg), m.op.toFixed(2), JSON.stringify(m.pix));
    if (m.pix) { S.faint = (S.faint || 0) + m.pix.faint; S.mx = Math.max(S.mx || 0, m.pix.mx); S.pixN++; S.pixCtr += m.pix.ctr; S.pixOut += m.pix.out; S.pixBase += m.pix.base; }
    if (m.ghostAlive === false && !S.ghostEnd) S.ghostEnd = { rows: m.ghostRows, frame: m.ghostFrame };
    if (opt.shots && m.vis && m.op > 0.3 && (S.shots = S.shots || 0) < 8 && i % 3 === 1) { await page.screenshot({ path: `${opt.shots}/fantasma-${W}x${H}-${String(i).padStart(3, "0")}${m.pinned ? "-empujada" : ""}.png` }); S.shots++; }
    if (m.state !== 'play' || (S.ghostEnd && m.frame > saved.n + 200)) break;
  }
  rec(S.lock > 100 && S.lockBad === 0, 'el fantasma avanza al mismo paso que la partida', { pasosComparados: S.lock, desfases: S.lockBad });
  rec(!!S.ghostEnd && S.ghostEnd.rows === saved.rows && S.ghostEnd.frame === saved.n, 'el fantasma acaba en la fila y el paso de la partida grabada', { ghost: S.ghostEnd, saved: { rows: saved.rows, n: saved.n } });
  rec(S.vis >= 15, 'el fantasma se llega a ver (la prueba de encuadre no pasa en vacío)', { fotogramasVisibles: S.vis });
  rec(S.visTouch === 0, 'ninguna marca visible toca el 20 % central (proyección)', { visibles: S.vis, tocan: S.visTouch });
  rec(S.hiddenNear >= 5, 'cuando el fantasma cae en el centro la marca se empuja fuera de él (la regla se ejerce)', { empujadas: S.hiddenNear });
  rec(S.pixN >= 10 && S.pixOut > 0, 'con el fantasma hay píxeles distintos fuera del centro (se dibuja de verdad)', { muestras: S.pixN, fueraDelCentro: S.pixOut });
  rec(S.pixBase === 0 && S.pixCtr === 0, 'ni un píxel del 20 % central cambia con el fantasma (más de 12/765 de diferencia; el resplandor tenue del bloom se cuenta aparte)', { muestras: S.pixN, ruidoBase: S.pixBase, centro: S.pixCtr, resplandorTenue: S.faint, maxDif: S.mx });
  const t = await page.evaluate(() => window.__toasts.filter((x) => /nuevo récord/i.test(x.t)));
  rec(t.length === 1 && t[0].prev <= saved.score && t[0].score > saved.score, "el aviso de récord salta una sola vez, en el paso exacto en que los puntos superan el récord (el del Arcade es por puntos)", { avisos: t, récord: saved.score });
  rec(S.chipN > 100 && S.chipOk >= S.chipN * 0.95, 'el chip «Fantasma ▲/▼ X m» del HUD sigue la diferencia real de metros', { muestras: S.chipN, coinciden: S.chipOk });
  rec(errors.length === 0, 'sin errores de página', errors.slice(0, 3));
  await browser.close();
}

console.log(fallos ? `\n${fallos} fallos` : '\nTodo OK');
process.exit(fallos ? 1 : 0);
