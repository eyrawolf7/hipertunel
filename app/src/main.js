// Hipertúnel: une simulación, render, sonido, interfaz y entrada.
// Bucle: la simulación avanza a pasos fijos de 60 Hz (como el original, que lo mide todo en
// fotogramas) y el dibujo interpola entre los dos últimos pasos.
import { Game } from './sim/game.js';
import { botSteer } from './sim/bot.js';
import { Renderer } from './render/index.js';
import { createAudio } from './audio/index.js';
import { createUI } from './ui/index.js';
import { createInput } from './input/index.js';
import { createMissions } from './missions.js';

const VERSION = '0.40';
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const QS = new URLSearchParams(location.search);

// ---------------------------------------------------------------- ajustes y récords
const COARSE = matchMedia('(pointer: coarse)').matches;
const IS_ANDROID_WEB = /Android/i.test(navigator.userAgent) && !window.Capacitor && location.protocol === 'https:';
const DEFAULTS = { tilt: true, invert: false, sens: 1, quality: COARSE ? 'media' : 'alta', reduceFx: false, music: true, sound: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}')); } catch (e) {}
if (QS.get('q')) settings.quality = QS.get('q');
const saveSettings = () => { try { localStorage.setItem('hipertunel-ajustes', JSON.stringify(settings)); } catch (e) {} };
const loadTop = (mode) => { try { return JSON.parse(localStorage.getItem('hipertunel-top-' + mode) || '[]'); } catch (e) { return []; } };
const saveTop = (mode, list) => { try { localStorage.setItem('hipertunel-top-' + mode, JSON.stringify(list)); } catch (e) {} };
// los récords van por distancia, como en Boost 2; los puntos (con monedas) son un dato aparte
const bestOf = (mode) => { const t = loadTop(mode); return t.length ? (t[0].distM ?? t[0].score) : 0; };

// ---------------------------------------------------------------- piezas
const canvas = $('view');
let renderer;
try { renderer = new Renderer(canvas, { quality: settings.quality }); }
catch (e) { document.body.classList.add('sin-webgl'); $('fatal').hidden = false; throw e; }
const audio = createAudio();
const input = createInput(canvas);
const missions = createMissions();
let missDist = 0;
input.configure(settings);

let game = null, mode = 'classic', state = 'attract';
let acc = 0, prev = { s: 0, theta: 0 }, countdown = 0, overT = 0, pausedFrom = null;
let pausedAt = -1e9;                 // cuándo se pausó con un toque (para no reanudar con el mismo)
let coins = 0;
let lostAt = -1, killBox = null, recAnnounced = false;   // para el resumen del fin de partida
const bestAtStart = {};

const ui = createUI($('ui'), {
  onPlay: (m) => { audio.unlock(); input.requestTilt(); goLandscape(); startGame(m); },
  onResume: () => resume(),
  onRestart: () => { audio.unlock(); startGame(mode, true); },
  onMenu: () => toMenu(),
  onSetting: (k, v) => {
    settings[k] = v; saveSettings();
    if (k === 'tilt' || k === 'invert' || k === 'sens') input.configure(settings);
    if (k === 'quality') renderer.setQuality(v);
    if (k === 'music') audio.setMusic(v);
    if (k === 'sound') audio.setMuted(!v);
    if (k === 'tilt' && v) input.requestTilt();
  },
  onCalibrate: () => { input.requestTilt(); input.calibrate(); },
  onSound: (n) => audio.play(n),
  onPause: () => pause(),
  keyboard: false,
});
const pushMissions = () => ui.missions?.(missions.list(), missions.rank());
const pushRecords = () => ui.records?.({ classic: bestOf('classic'), survival: bestOf('survival'), timetrial: bestOf('timetrial') });
pushRecords();
pushMissions();
ui.settings(settings);
audio.setMusic(settings.music); audio.setMuted(!settings.sound);

// tocar la pantalla mientras juegas = pausa (el botón de continuar sale en el centro)
input.onTap = () => { if (state === 'play') { pause(); pausedAt = performance.now(); } };
input.onButton = (b) => {
  if (b === 'mute') { settings.sound = !settings.sound; audio.setMuted(!settings.sound); saveSettings(); ui.settings(settings); return; }
  if (state === 'play' && (b === 'pause' || b === 'back')) { pause(); return; }
  if (state === 'over' && b === 'ok' && overT > 0.6) { startGame(mode, true); return; }
  if (state !== 'play' && state !== 'countdown') {
    if (b === 'up' || b === 'left' || b === 'down' || b === 'right') ui.navigate?.(b);
    else if (b === 'ok') ui.confirm?.();
    else if (b === 'back') ui.back?.();
  }
};
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); audio.pause(document.hidden); });
const checkPortrait = () => { const p = COARSE && innerHeight > innerWidth; $('rotate').hidden = !p; if (p && state === 'play') pause(); };
addEventListener('resize', () => { renderer.resize(); checkPortrait(); });
checkPortrait();
addEventListener('pointerdown', () => audio.unlock(), { once: true });

// En el móvil: pantalla completa y horizontal al empezar (si el navegador lo permite)
function goLandscape() {
  if (!COARSE) return;
  try {
    const lock = () => { try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) {} };
    const el = document.documentElement;
    const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
    if (p && p.then) p.then(lock).catch(lock); else lock();
  } catch (e) {}
}

// ---------------------------------------------------------------- estados
function newGame(m, seed) {
  game = new Game({ mode: m, seed: seed ?? ((Math.random() * 1e9) | 0) });
  renderer.reset();
  prev = { s: game.s, theta: game.theta };
  acc = 0;
}

// Demo del título: el piloto automático no se estrella y arranca ya cerca del primer plegado,
// para que lo primero que se vea sea lo más vistoso.
function attractGame(seed) {
  newGame('classic', seed);
  game.crash = (b) => { b.hit = true; };
  while (game.s < 300) game.step({ steer: botSteer(game) });
  renderer.reset(); renderer.track.sync(game);
  prev = { s: game.s, theta: game.theta };
}
function attract() {
  state = 'attract';
  attractGame(7);
  ui.show('title');
  audio.setWorld(0);
}

function startGame(m, quick = false) {
  mode = m;
  newGame(m);
  coins = 0;
  bestAtStart[m] = bestOf(m);
  missions.start(); missDist = 0; lostAt = -1; killBox = null; recAnnounced = false;
  renderer.setRecordRow?.(bestAtStart[m] > 0 ? Math.round(bestAtStart[m] / 4) : -1);
  // reintento rápido: sin 3-2-1, solo un instante antes del ¡YA!
  state = 'countdown'; countdown = quick ? 0.6 : 3; pendingChime = false; nearT = 0;
  ui.show('hud');
  audio.setWorld(0);
  audio.play('countdown');
  let seen = 0; try { seen = +(localStorage.getItem('hipertunel-partidas') || 0); localStorage.setItem('hipertunel-partidas', String(seen + 1)); } catch (e) {}
  if (seen < 3) setTimeout(() => ui.toast(input.hasTilt ? 'Inclina el móvil para girar · toca la pantalla para pausar' : (COARSE ? 'Toca a la izquierda o a la derecha para girar' : 'Gira con ← →'), 'info'), 300);
  padHint = seen < 3;
  if (seen >= 3 && !input.hasTilt && settings.tilt && COARSE) setTimeout(() => { if (!input.hasTilt) ui.toast('Sin giroscopio: toca a izquierda o derecha', 'info'); }, 1500);
}

function pause() { if (state !== 'play') return; pausedFrom = state; state = 'paused'; pushMissions(); ui.show('pause'); audio.pause(true); }
function resume() {
  // el mismo toque que ha pausado no debe pulsar también "Continuar", que sale debajo del dedo
  if (state !== 'paused' || performance.now() - pausedAt < 450) return;
  pausedAt = -1e9; state = 'countdown'; countdown = 1.0; ui.show('hud'); audio.pause(false); audio.play('countdown'); }
function toMenu() { audio.pause(false); attract(); }

function finish() {
  state = 'over'; overT = 0;
  const distM = game.distanceM;
  coins = game.coinsGot;
  const score = Math.round(distM + coins * 10);
  const list = loadTop(mode);
  const me = { score, distM, coins, time: +game.time.toFixed(1), date: Date.now() };
  list.push(me); list.sort((a, b) => (b.distM ?? b.score) - (a.distM ?? a.score));
  const top = list.slice(0, 5); saveTop(mode, top);
  const isRecord = top[0] === me && list.length > 1;
  const mr = missions.finish();
  const facts = endFacts(distM, bestAtStart[mode] || 0, isRecord);
  pushMissions();
  ui.over({ mode, distM, coins, score, best: top[0].distM ?? top[0].score, isRecord, time: game.time, maxBoostTime: mode === 'classic' ? game.boostTotal : game.maxBoostTime, top: top.map((e) => ({ ...e, me: e === me })), missionsDone: mr.completed, facts, headline: facts.headline, rankUp: mr.rankUp, rank: missions.rank() });
  if (mr.rankUp) setTimeout(() => { audio.play('record'); ui.toast(`¡Rango ${missions.rank().level}: ${missions.rank().name}!`, 'mission'); }, 700);
  ui.show('over');
  if (isRecord) audio.play('record');
  pushRecords();
}

// Resumen de la partida para la tarjeta final: titular según cómo haya ido y uno o dos datos útiles
// (qué te mató, cuánto te faltó), en vez de un titular al azar.
function endFacts(distM, best, isRecord) {
  const out = [];
  let headline;
  const first = best <= 0;
  const diff = Math.round(best - distM);
  if (isRecord) headline = '¡Increíble!';
  else if (first) headline = '¡Primera carrera!';
  else if (diff > 0 && diff <= Math.max(150, best * 0.12)) headline = '¡Por muy poco!';
  else if (distM < 300) headline = '¡Arranque complicado!';
  else if (distM > best * 0.6) headline = '¡Buena carrera!';
  else headline = '¡Otra más!';
  if (isRecord && best > 0) out.push(`Has superado tu récord en ${fmtN(Math.round(distM - best))} m`);
  else if (!first && diff > 0) out.push(`Te faltaron ${fmtN(diff)} m para tu récord`);
  const since = lostAt >= 0 ? game.time - lostAt : -1;
  if (since >= 0 && since < 8) out.push(`Caíste ${since.toFixed(1).replace('.', ',')} s después de perder los impulsos: busca una placa azul`);
  else if (killBox && !killBox.fixed) out.push('Te pilló una caja rodante: fíjate hacia dónde gira');
  else if (killBox && killBox.tall) out.push('Los pilares cruzan el túnel: esquívalos por un lado');
  else if (game.level === 0 && distM < 400) out.push('Pisa las flechas azules: con impulso, un choque no te elimina');
  if (out.length < 2 && game.world > 0) out.push(`Llegaste al mundo ${game.world + 1}`);
  return { headline, lines: out.slice(0, 2) };
}
const fmtN = (n) => n.toLocaleString('es-ES');

// sin impulsos: hacia qué lado queda la placa más cercana por delante (−1, 0, 1). Solo es una
// pista en pantalla; no cambia nada de la partida.
function padDirection() {
  if (!game.alive || game.level > 0 || game.mode === 'survival') return 0;
  let best = null;
  for (const p of game.pads) {
    const d = p.k - game.s;
    if (p.taken || d < 2 || d > 26) continue;
    if (!best || d < best.d) best = { d, lane: p.lane };
  }
  if (!best) return 0;
  const open = game.fold !== 30 && game.fold !== -30;
  let da = best.lane * Math.PI / 6 - game.theta;
  if (!open) da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) < Math.PI / 12) return 0;       // ya vas por su carril
  return da > 0 ? 1 : -1;                          // girar a la derecha sube theta
}

// vibración (móvil): se apaga con "Reducir efectos"
const buzz = (p) => { if (settings.reduceFx || state === 'attract') return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
let nearT = 0, pendingChime = false, padHint = false, hitstop = 0;

// moneda que vuela desde donde la coges hasta el contador (por el borde, nunca por el centro)
function coinFly(e) {
  const chip = document.querySelector('.hud-coins'); if (!chip || settings.reduceFx) return;
  const p = renderer.coinScreen(e); if (!p) return;
  const r = chip.getBoundingClientRect();
  const d = document.createElement('div'); d.className = 'coin-fly';
  d.style.left = p.x + 'px'; d.style.top = p.y + 'px';
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = `translate(${r.left + 18 - p.x}px, ${r.top + r.height / 2 - p.y}px) scale(.6)`; d.style.opacity = '0.2'; });
  setTimeout(() => d.remove(), 420);
}

// ---------------------------------------------------------------- bucle
let last = performance.now();
const fps = { buf: [], el: null };
if (QS.has('fps')) { fps.el = document.createElement('div'); fps.el.className = 'fps'; document.body.appendChild(fps.el); }

function stepSim() {
  prev.s = game.s; prev.theta = game.theta;
  let steer = 0;
  if (state === 'attract') steer = botSteer(game);
  else if (state === 'play') steer = input.steer(STEP, game.theta, game.fold !== 30 && game.fold !== -30);
  else input.steer(STEP, game.theta, false);
  const ev = game.step({ steer });
  renderer.onEvents(ev, game);
  for (const e of ev) {
    if (state === 'attract') continue;
    if (e.type === 'boost') { audio.play('boost', { level: e.level }); buzz(e.level === 3 ? [15, 40, 30] : [14 + e.level * 4]); if (e.level === 3) ui.toast('¡Velocidad máxima!', 'boost'); }
    else if (e.type === 'crash') {
      if (!e.fatal) lostAt = game.time; else killBox = game.boxes.find((b) => b.id === e.id) || null;
      audio.play(e.fatal ? 'death' : 'crash'); buzz(e.fatal ? [120, 60, 200] : [40, 30, 60]); if (!e.fatal) { ui.toast('¡Impulsos perdidos!', 'info'); hitstop = settings.reduceFx ? 0 : 0.07; } }
    else if (e.type === 'coin') { coins = game.coinsGot; audio.play('coin', { combo: e.combo }); if (e.combo >= 3) buzz(8); coinFly(e); }
    else if (e.type === 'foldStart') audio.play('foldStart');
    else if (e.type === 'foldOrder' && game.fold < 0) {
      // desde fuera, el plegado hacia dentro lleva a un mundo nuevo: se avisa con la distancia
      // aproximada (32 filas de recta + unos 600 fotogramas de plegado + 24 filas de tránsito)
      const rows = 56 + 600 * game.v / 13.176;
      ui.toast(`Mundo ${game.world + 2} a unos ${fmtN(Math.round(rows * 4 / 100) * 100)} m`, 'mission');
    }
    else if (e.type === 'foldEnd') { audio.play('foldEnd'); buzz(25); }
    else if (e.type === 'world') {
      audio.setWorld(game.world);
      // la campanilla del mundo nuevo suena al aterrizar del salto, si lo hay
      if (!game.inverted) { if (game.gaps.some((g) => g.to + 1 > game.s)) pendingChime = true; else audio.play('world'); }
    }
  }
  // misiones: escuchan los sucesos de la partida (no cambian nada de ella)
  if (state === 'play' || state === 'dying') {
    const fresh = [];
    for (const e of ev) fresh.push(...missions.event(e, game));
    const d = game.distanceM; fresh.push(...missions.tick(game, Math.max(0, d - missDist))); missDist = d;
    for (const f of fresh) { ui.toast('Misión cumplida: ' + f.text, 'mission'); audio.play('world'); buzz([20, 40, 20]); }
  }
  // ¡Por los pelos!: una caja pasa rozando por el carril de al lado a más de 60 m/s (solo aviso)
  if (state === 'play' && game.alive && game.speedMS > 60 && (nearT -= STEP) <= 0) {
    const hw = Math.PI / 6;
    for (const b of game.boxes) {
      if (b.hit || b.k + 0.5 <= prev.s || b.k + 0.5 > game.s) continue;
      let d = game.theta - (b.lane * hw); d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.abs(d) > hw * 0.8 && Math.abs(d) < hw * 1.6) { audio.play('nearMiss'); buzz(10); nearT = 0.4; for (const f of missions.event({ type: 'near' }, game)) ui.toast('Misión cumplida: ' + f.text, 'mission'); break; }
    }
  }
  // pasar tu récord se celebra en el momento (la marca dorada del túnel está en esa fila)
  if (state === 'play' && !recAnnounced && bestAtStart[mode] > 0 && game.distanceM > bestAtStart[mode]) { recAnnounced = true; ui.toast('¡Récord superado!', 'mission'); audio.play('record'); buzz([20, 30, 20, 30, 40]); }
  if (padHint && state === 'play' && game.pads.some((p) => !p.taken && (p.k - game.s) / Math.max(1e-3, game.v / 13.176 * 60) < 1.6 && p.k > game.s)) { padHint = false; ui.toast('Pisa las flechas azules para acelerar', 'boost'); }
  if (pendingChime && renderer.consumeLanding()) { pendingChime = false; audio.play('world'); buzz(30); }
  if (state === 'attract' && (!game.alive || game.s > 4000)) attractGame((Math.random() * 1e9) | 0);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0; if (dt > 0.1) dt = 0.1;
  if (fps.el) { fps.buf.push(dt); if (fps.buf.length > 120) fps.buf.shift(); }

  if (state === 'countdown') {
    const before = Math.ceil(countdown);
    countdown -= dt;
    if (Math.ceil(countdown) !== before && countdown > 0) audio.play('countdown');
    if (!$('rotate').hidden) countdown = Math.max(countdown, 0.5);   // en vertical no arranca
    if (countdown <= 0) { state = 'play'; audio.play('go'); }
  }
  if (window.__freeze) { acc = 0; }
  else if (hitstop > 0) { hitstop -= dt; }          // micro-pausa del impacto: la simulación solo se retrasa
  else if (state === 'play' || state === 'attract' || state === 'dying') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { stepSim(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    if (state === 'play' && !game.alive) { state = 'dying'; overT = 0; }
  }
  if (state === 'dying') { overT += dt; if (overT > 0.9) finish(); }
  if (state === 'over') overT += dt;

  const a = window.__freeze ? 1 : state === 'play' || state === 'attract' || state === 'dying' ? acc / STEP : 1;
  const s = prev.s + (game.s - prev.s) * a;
  let dth = game.theta - prev.theta;
  if (dth > Math.PI) dth -= Math.PI * 2; else if (dth < -Math.PI) dth += Math.PI * 2;
  const theta = prev.theta + dth * a;
  renderer.update(game, s, theta, dt, { reduceFx: settings.reduceFx, intro: state === 'countdown' && countdown > 0.6 ? Math.min(1, (countdown - 0.6) / 2.4) : 0 });
  renderer.render();
  audio.setSpeed(game.speedMS, game.level);
  if (state === 'play' || state === 'countdown' || state === 'dying') {
    ui.hud({ padDir: state === 'play' ? padDirection() : 0, distM: game.distanceM, speedMS: state === 'countdown' && game.frame === 0 ? 0 : game.speedMS, level: game.level, coins: game.coinsGot, timeLeft: mode === 'timetrial' ? game.timeLeft : null, mode, invul: game.invul > 0, best: bestAtStart[mode] || 0, countdown: state === 'countdown' ? Math.ceil(countdown) : 0 });
  }
  // en la web desde Android se ofrece la app; dentro de la app (Capacitor) no
  const apk = $('apk'); if (apk) apk.hidden = !(IS_ANDROID_WEB && state === 'attract');
  if (ui.tiltMeter && state !== 'play') ui.tiltMeter(Math.max(-1, Math.min(1, input.tiltValue * 2)), input.hasTilt ? 'Giroscopio activo' : (window.isSecureContext ? 'Buscando giroscopio…' : 'El giroscopio necesita https'));
  if (fps.el && fps.buf.length > 10) { const avg = fps.buf.reduce((p, c) => p + c, 0) / fps.buf.length; const worst = Math.max(...fps.buf); fps.el.textContent = (1 / avg).toFixed(0) + ' fps · peor ' + (1 / worst).toFixed(0); }
}

attract();
requestAnimationFrame(frame);

// Gancho para pruebas automáticas (capturas, bots).
window.__hip = {
  VERSION,
  get game() { return game; }, get state() { return state; }, renderer, ui, audio, input, missions,
  start: (m = 'classic', seed) => { startGame(m); if (seed !== undefined) newGame(m, seed); state = 'play'; },
  skipTo(rows) { while (game.s < rows && game.alive) { game.step({ steer: botSteer(game) }); renderer.track.sync(game); } prev = { s: game.s, theta: game.theta }; },
  step(n = 1, steer = null) { for (let i = 0; i < n; i++) { prev.s = game.s; prev.theta = game.theta; const ev = game.step({ steer: steer ?? botSteer(game) }); renderer.onEvents(ev, game); renderer.track.sync(game); } },
  bot: botSteer, padDirection: () => padDirection(),
};
