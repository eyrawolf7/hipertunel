// Hipertúnel: une simulación, render, sonido, interfaz y entrada.
// Bucle: la simulación avanza a pasos fijos de 60 Hz (como el original, que lo mide todo en
// fotogramas) y el dibujo interpola entre los dos últimos pasos.
import { Game } from './sim/game.js';
import { botSteer } from './sim/bot.js';
import { Renderer } from './render/index.js';
import { createAudio } from './audio/index.js';
import { createUI } from './ui/index.js';
import { createInput } from './input/index.js';

const VERSION = '0.40';
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const QS = new URLSearchParams(location.search);

// ---------------------------------------------------------------- ajustes y récords
const COARSE = matchMedia('(pointer: coarse)').matches;
const DEFAULTS = { tilt: true, invert: false, sens: 1, quality: COARSE ? 'media' : 'alta', reduceFx: false, music: true, sound: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}')); } catch (e) {}
if (QS.get('q')) settings.quality = QS.get('q');
const saveSettings = () => { try { localStorage.setItem('hipertunel-ajustes', JSON.stringify(settings)); } catch (e) {} };
const loadTop = (mode) => { try { return JSON.parse(localStorage.getItem('hipertunel-top-' + mode) || '[]'); } catch (e) { return []; } };
const saveTop = (mode, list) => { try { localStorage.setItem('hipertunel-top-' + mode, JSON.stringify(list)); } catch (e) {} };
const bestOf = (mode) => { const t = loadTop(mode); return t.length ? t[0].score : 0; };

// ---------------------------------------------------------------- piezas
const canvas = $('view');
let renderer;
try { renderer = new Renderer(canvas, { quality: settings.quality }); }
catch (e) { document.body.classList.add('sin-webgl'); $('fatal').hidden = false; throw e; }
const audio = createAudio();
const input = createInput(canvas);
input.configure(settings);

let game = null, mode = 'classic', state = 'attract';
let acc = 0, prev = { s: 0, theta: 0 }, countdown = 0, overT = 0, pausedFrom = null;
let coins = 0;
const bestAtStart = {};

const ui = createUI($('ui'), {
  onPlay: (m) => { audio.unlock(); input.requestTilt(); goLandscape(); startGame(m); },
  onResume: () => resume(),
  onRestart: () => { audio.unlock(); startGame(mode); },
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
const pushRecords = () => ui.records?.({ classic: bestOf('classic'), survival: bestOf('survival'), timetrial: bestOf('timetrial') });
pushRecords();
ui.settings(settings);
audio.setMusic(settings.music); audio.setMuted(!settings.sound);

input.onButton = (b) => {
  if (b === 'mute') { settings.sound = !settings.sound; audio.setMuted(!settings.sound); saveSettings(); ui.settings(settings); return; }
  if (state === 'play' && (b === 'pause' || b === 'back')) { pause(); return; }
  if (state === 'over' && b === 'ok' && overT > 0.6) { startGame(mode); return; }
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

function attract() {
  state = 'attract';
  newGame('classic', 7);
  ui.show('title');
  audio.setWorld(0);
}

function startGame(m) {
  mode = m;
  newGame(m);
  coins = 0;
  bestAtStart[m] = bestOf(m);
  state = 'countdown'; countdown = 3;
  ui.show('hud');
  audio.setWorld(0);
  audio.play('countdown');
  let seen = 0; try { seen = +(localStorage.getItem('hipertunel-partidas') || 0); localStorage.setItem('hipertunel-partidas', String(seen + 1)); } catch (e) {}
  if (seen < 3) setTimeout(() => ui.toast(input.hasTilt ? 'Inclina el móvil para girar' : (COARSE ? 'Toca a la izquierda o a la derecha para girar' : 'Gira con ← →'), 'info'), 300);
  if (seen < 3) setTimeout(() => { if (state === 'play') ui.toast('Pisa las flechas azules para acelerar', 'boost'); }, 4200);
  if (seen >= 3 && !input.hasTilt && settings.tilt && COARSE) setTimeout(() => { if (!input.hasTilt) ui.toast('Sin giroscopio: toca a izquierda o derecha', 'info'); }, 1500);
}

function pause() { if (state !== 'play') return; pausedFrom = state; state = 'paused'; ui.show('pause'); audio.pause(true); }
function resume() { if (state !== 'paused') return; state = 'countdown'; countdown = 1.2; ui.show('hud'); audio.pause(false); audio.play('countdown'); }
function toMenu() { audio.pause(false); attract(); }

function finish() {
  state = 'over'; overT = 0;
  const distM = game.distanceM;
  const score = Math.round(distM + coins * 10);
  const list = loadTop(mode);
  const me = { score, distM, coins, time: +game.time.toFixed(1), date: Date.now() };
  list.push(me); list.sort((a, b) => b.score - a.score);
  const top = list.slice(0, 5); saveTop(mode, top);
  const isRecord = top[0] === me && list.length > 1;
  ui.over({ mode, distM, coins, score, best: top[0].score, isRecord, time: game.time, maxBoostTime: game.maxBoostTime, top: top.map((e) => ({ ...e, me: e === me })) });
  ui.show('over');
  if (isRecord) audio.play('record');
  pushRecords();
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
    if (e.type === 'boost') { audio.play('boost', { level: e.level }); ui.toast(e.level === 3 ? '¡Velocidad máxima!' : '¡Impulso ' + e.level + '!', 'boost'); }
    else if (e.type === 'crash') { audio.play(e.fatal ? 'death' : 'crash'); if (!e.fatal) ui.toast('¡Impulsos perdidos!', 'info'); }
    else if (e.type === 'coin') { coins = game.coinsGot; audio.play('coin', { combo: e.combo }); }
    else if (e.type === 'foldStart') audio.play('foldStart');
    else if (e.type === 'foldEnd') audio.play('foldEnd');
    else if (e.type === 'world') { audio.setWorld(game.world); if (!game.inverted) { audio.play('world'); } }
  }
  if (state === 'attract' && !game.alive) newGame('classic', (Math.random() * 1e9) | 0);
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
    if (countdown <= 0) { state = 'play'; audio.play('go'); }
  }
  if (window.__freeze) { acc = 0; }
  else if (state === 'play' || state === 'attract' || state === 'dying') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) { stepSim(); acc -= STEP; n++; }
    if (n === 6) acc = 0;
    if (state === 'play' && !game.alive) { state = 'dying'; overT = 0; }
  }
  if (state === 'dying') { overT += dt; if (overT > 1.3) finish(); }
  if (state === 'over') overT += dt;

  const a = window.__freeze ? 1 : state === 'play' || state === 'attract' || state === 'dying' ? acc / STEP : 1;
  const s = prev.s + (game.s - prev.s) * a;
  let dth = game.theta - prev.theta;
  if (dth > Math.PI) dth -= Math.PI * 2; else if (dth < -Math.PI) dth += Math.PI * 2;
  const theta = prev.theta + dth * a;
  renderer.update(game, s, theta, dt, { reduceFx: settings.reduceFx });
  renderer.render();
  audio.setSpeed(game.speedMS, game.level);
  if (state === 'play' || state === 'countdown' || state === 'dying') {
    ui.hud({ distM: game.distanceM, speedMS: game.speedMS, level: game.level, coins, timeLeft: mode === 'timetrial' ? game.timeLeft : null, mode, invul: game.invul > 0, best: bestAtStart[mode] || 0, countdown: state === 'countdown' ? Math.ceil(countdown) : 0 });
  }
  if (ui.tiltMeter && state !== 'play') ui.tiltMeter(Math.max(-1, Math.min(1, input.tiltValue * 2)), input.hasTilt ? 'Giroscopio activo' : (window.isSecureContext ? 'Buscando giroscopio…' : 'El giroscopio necesita https'));
  if (fps.el && fps.buf.length > 10) { const avg = fps.buf.reduce((p, c) => p + c, 0) / fps.buf.length; const worst = Math.max(...fps.buf); fps.el.textContent = (1 / avg).toFixed(0) + ' fps · peor ' + (1 / worst).toFixed(0); }
}

attract();
requestAnimationFrame(frame);

// Gancho para pruebas automáticas (capturas, bots).
window.__hip = {
  VERSION,
  get game() { return game; }, get state() { return state; }, renderer, ui, audio, input,
  start: (m = 'classic', seed) => { startGame(m); if (seed !== undefined) newGame(m, seed); state = 'play'; },
  skipTo(rows) { while (game.s < rows && game.alive) { game.step({ steer: botSteer(game) }); renderer.track.sync(game); } prev = { s: game.s, theta: game.theta }; },
  step(n = 1, steer = null) { for (let i = 0; i < n; i++) { prev.s = game.s; prev.theta = game.theta; const ev = game.step({ steer: steer ?? botSteer(game) }); renderer.onEvents(ev, game); renderer.track.sync(game); } },
  bot: botSteer,
};
