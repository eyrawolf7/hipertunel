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
import { createShop, SHOP } from './shop.js';
import { Adventure, STAGES, packGhost, unpackGhost, quantSteer } from './sim/adventure.js';
import { Arcade } from './sim/arcade.js';
import { Zorro } from './sim/zorro.js';

const VERSION = '0.50';
const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const QS = new URLSearchParams(location.search);

// ---------------------------------------------------------------- ajustes y récords
const COARSE = matchMedia('(pointer: coarse)').matches;
const IS_ANDROID_WEB = /Android/i.test(navigator.userAgent) && !window.Capacitor && location.protocol === 'https:';
const DEFAULTS = { tilt: true, invert: false, sens: 1, quality: COARSE ? 'media' : 'alta', reduceFx: false, music: true, sound: true, vibe: true };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('hipertunel-ajustes') || '{}')); } catch (e) {}
if (QS.get('q')) settings.quality = QS.get('q');
const saveSettings = () => { try { localStorage.setItem('hipertunel-ajustes', JSON.stringify(settings)); } catch (e) {} };
const loadTop = (mode) => { try { return JSON.parse(localStorage.getItem('hipertunel-top-' + topKey(mode)) || '[]'); } catch (e) { return []; } };
const saveTop = (mode, list) => { try { localStorage.setItem('hipertunel-top-' + topKey(mode), JSON.stringify(list)); } catch (e) {} };
// los récords van por distancia, como en Boost 2; los puntos (con monedas) son un dato aparte
// modos que juegan con las reglas del clásico (Boost 2 exacto): cambia la semilla o el mundo visual
const simMode = (m) => (m === 'daily' || m === 'voyage' ? 'classic' : m);
const dayKey = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
const daySeed = (k) => { let h = 2166136261; for (const c of 'hipertunel-' + k) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
// el modo del zorro es el Arcade en tercera persona: comparte sus reglas y su racha
const isArcade = (m) => m === 'arcade' || m === 'zorro';
const topKey = (m) => (m === 'daily' ? 'daily-' + dayKey() : m);
const maxWorld = () => { try { return +(localStorage.getItem('hipertunel-mundo-max') || 0) || 0; } catch (e) { return 0; } };
// récord en metros (marca dorada del túnel y marcador); el Arcade ordena por puntos
const bestOf = (mode) => { const t = loadTop(mode); return t.length ? (t[0].distM ?? t[0].score) : 0; };
const bestScore = (mode) => { const t = loadTop(mode); return t.length ? t[0].score : 0; };

// ---------------------------------------------------------------- piezas
const canvas = $('view');
let renderer;
try { renderer = new Renderer(canvas, { quality: settings.quality }); }
catch (e) { document.body.classList.add('sin-webgl'); $('fatal').hidden = false; throw e; }
const audio = createAudio();
const input = createInput(canvas);
const missions = createMissions();
const shop = createShop();
let missDist = 0;
input.configure(settings);

let game = null, mode = 'arcade', state = 'attract';
// Arcade: racha multiplicadora (×1…×5): sube al pasar rozando y cada 500 m sin chocar; un choque la
// reinicia. Los puntos del Arcade son la distancia por la racha (+ monedas)
let mult = 1, multDist = 0, points = 0, maxMult = 1, bestScoreAtStart = 0;
let acc = 0, prev = { s: 0, theta: 0 }, countdown = 0, overT = 0, pausedFrom = null;
let pausedAt = -1e9;                 // cuándo se pausó con un toque (para no reanudar con el mismo)
let coins = 0;
let worldBase = 0;
// Aventura: tramo elegido, progreso guardado (estrellas, mejor avance y fantasma) y la partida del fantasma
let advStage = 0, advRec = [], ghostSteers = null, ghostGame = null, cpFrame = -1, cpPrefix = null;
const loadAdv = () => { try { return JSON.parse(localStorage.getItem('hipertunel-aventura') || '{}'); } catch (e) { return {}; } };
const saveAdv = (d) => { try { localStorage.setItem('hipertunel-aventura', JSON.stringify(d)); } catch (e) {} };
const bitsOf = (e) => (e ? (e.bits ?? (e.stars >= 3 ? 7 : e.stars === 2 ? 3 : e.stars ? 1 : 0)) : 0);
const nBits = (b) => (b & 1) + ((b >> 1) & 1) + ((b >> 2) & 1);
const advInfo = () => { const d = loadAdv(); return STAGES.map((st, i) => ({ name: st.name, boss: !!st.boss, stars: nBits(bitsOf(d[i])), best: d[i]?.best || 0, locked: i > 0 && !(bitsOf(d[i - 1]) & 1) })); };                   // modo Viaje: mundo visual con el que se empieza
let lostAt = -1, killBox = null, recAnnounced = false, visWorld = 1;   // visWorld: mundo que se ve (1, 2…)   // para el resumen del fin de partida
const bestAtStart = {};

const ui = createUI($('ui'), {
  onPlay: (m, stage) => { audio.unlock(); input.requestTilt(); goLandscape(); if (m === 'adventure') advStage = stage | 0; startGame(m); },
  onMap: () => ui.map?.(advInfo()),
  onCheckpoint: () => { audio.unlock(); startGame('adventure', true, true); },
  onNext: () => { audio.unlock(); advStage = Math.min(STAGES.length - 1, advStage + 1); startGame('adventure'); },
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
  onShopOpen: () => paintShop(),
  onShop: (cat, id) => {
    const r = shop.choose(cat, id);
    if (r === 'poor') { audio.play('menuBack'); ui.toast('Te faltan monedas', 'info'); }
    else { audio.play(r === 'buy' ? 'record' : 'menuOk'); if (r === 'buy') ui.toast('¡Comprado!', 'mission'); applyCosmetics(); }
    paintShop();
  },
  keyboard: false,
});
const pushMissions = () => ui.missions?.(missions.list(), missions.rank());
const pushRecords = () => { ui.records?.({ zorro: bestScore('zorro'), arcade: bestScore('arcade'), classic: bestOf('classic'), survival: bestOf('survival'), timetrial: bestOf('timetrial'), daily: bestOf('daily'), voyage: bestOf('voyage') }); ui.locks?.({ voyage: maxWorld() < 1 }); };
pushRecords();
pushMissions();
applyCosmetics();
ui.settings(settings);
audio.setMusic(settings.music); audio.setMuted(!settings.sound);

// tocar la pantalla mientras juegas = pausa (el botón de continuar sale en el centro)
input.onPress = () => { if (state === 'countdown' && renderer.introOn) skipIntro(); };
input.onTap = () => {
  if (state === 'play') { pause(); pausedAt = performance.now(); }
};
// saltar el vuelo del arranque: la cuenta atrás sigue, pero ya en primera persona
function skipIntro() { renderer.skipIntro(); countdown = Math.min(countdown, 0.8); }
input.onButton = (b) => {
  if (b === 'mute') { settings.sound = !settings.sound; audio.setMuted(!settings.sound); saveSettings(); ui.settings(settings); return; }
  if (state === 'play' && (b === 'pause' || b === 'back')) { pause(); return; }
  if (state === 'over' && b === 'ok' && overT > 0.6) { startGame(mode, true); return; }
  if (state === 'countdown' && renderer.introOn && (b === 'ok' || b === 'back')) { skipIntro(); return; }
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
function newGame(m, seed, fromCp = false) {
  if (m === 'daily' && seed === undefined) seed = daySeed(dayKey());
  if (m === 'adventure') {
    game = new Adventure({ stage: advStage });
    const saved = loadAdv()[advStage];
    ghostSteers = saved && saved.ghost ? unpackGhost(saved.ghost) : null;
    ghostGame = ghostSteers ? new Adventure({ stage: advStage }) : null;
    advRec = [];
    // desde el punto de control: se repite la partida guardada hasta ahí (la simulación es
    // determinista, así que llegas exactamente al mismo sitio)
    if (fromCp && cpPrefix) {
      for (let i = 0; i < cpPrefix.length && game.alive; i++) { game.step({ steer: cpPrefix[i] }); if (ghostGame && ghostGame.alive) ghostGame.step({ steer: ghostSteers[ghostGame.frame] ?? 0 }); }
      advRec = Array.from(cpPrefix); game.fromCheckpoint = true; game.events = [];
    } else { cpFrame = -1; cpPrefix = null; }
  } else if (m === 'zorro') { game = new Zorro({ seed: seed ?? ((Math.random() * 1e9) | 0) }); ghostGame = null; ghostSteers = null; }
  else if (m === 'arcade') { game = new Arcade({ seed: seed ?? ((Math.random() * 1e9) | 0), easyWalls: Math.max(0, 3 - wallHints) }); ghostGame = null; ghostSteers = null; }
  else { game = new Game({ mode: simMode(m), seed: seed ?? ((Math.random() * 1e9) | 0) }); ghostGame = null; ghostSteers = null; }
  renderer.ghostGame = ghostGame;
  renderer.third = m === 'zorro';
  input.heroMode = m === 'zorro';
  worldBase = m === 'voyage' ? maxWorld() : m === 'adventure' ? STAGES[advStage].world : 0;
  renderer.themeBase = worldBase;
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

function startGame(m, quick = false, fromCp = false) {
  mode = m;
  newGame(m, undefined, fromCp);
  if (m === 'adventure') { renderer.track.sync(game); prev = { s: game.s, theta: game.theta }; const st = STAGES[advStage]; ui.intro?.({ n: advStage + 1, name: st.name, boss: !!st.boss, tip: fromCp ? 'Sigues desde el punto de control' : st.tip || (st.boss ? 'Jefe: a mitad del tramo hay un punto de control' : ''), goals: ['Supéralo', 'Sin chocar ni caer', 'Coge monedas: ' + Math.round(0.35 * 100) + ' % del tramo'] }); }
  coins = 0;
  bestAtStart[m] = bestOf(m);
  missions.start(); missDist = 0; mult = 1; multDist = 0; points = 0; maxMult = 1; bestScoreAtStart = bestScore(m); lostAt = -1; killBox = null; recAnnounced = false; visWorld = 1;
  renderer.setRecordRow?.(bestAtStart[m] > 0 ? Math.round(bestAtStart[m] / 4) : -1);
  // reintento rápido: sin 3-2-1, solo un instante antes del ¡YA!
  state = 'countdown'; countdown = quick ? 0.6 : 3; pendingChime = false; nearT = 0;
  // desde el menú (no en el reintento rápido): se ve al zorro y la cámara entra en su cabeza
  if (!quick && m !== 'zorro' && !settings.reduceFx) renderer.startIntro();
  ui.show('hud');
  audio.setWorld(worldBase * 2);
  audio.play('countdown');
  let seen = 0; try { seen = +(localStorage.getItem('hipertunel-partidas') || 0); localStorage.setItem('hipertunel-partidas', String(seen + 1)); } catch (e) {}
  if (m === 'zorro') setTimeout(() => ui.toast(input.hasTilt ? 'Toca la pantalla para saltar por encima de las cajas' : COARSE ? 'Desliza hacia arriba para saltar' : 'Salta con Espacio o ↑', 'mission'), 300);
  if (m === 'zorro') setTimeout(() => ui.toast('Los saltos se gastan: 10 monedas o 5 roces dan otro', 'info'), 3200);
  else if (seen < 3) setTimeout(() => ui.toast(input.hasTilt ? 'Inclina el móvil para girar · toca la pantalla para pausar' : (COARSE ? 'Toca a la izquierda o a la derecha para girar' : 'Gira con ← →'), 'info'), 300);
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
  if (game.mode === 'adventure') return finishAdventure();
  const distM = game.distanceM;
  coins = game.coinsGot;
  const score = game.variant === 'arcade' ? Math.round(points + coins * 10) : Math.round(distM + coins * 10);
  const list = loadTop(mode);
  const me = { score, distM, coins, time: +game.time.toFixed(1), date: Date.now() };
  list.push(me);
  if (isArcade(mode)) list.sort((a, b) => b.score - a.score); else list.sort((a, b) => (b.distM ?? b.score) - (a.distM ?? a.score));
  const top = list.slice(0, 5); saveTop(mode, top);
  const isRecord = top[0] === me && list.length > 1;
  if (isRecord) renderer.heroMood = 'record';
  try { const w = worldBase + visWorld - 1; if (w > maxWorld()) localStorage.setItem('hipertunel-mundo-max', String(Math.min(w, 4))); } catch (e) {}
  shop.add(game.coinsGot);
  const mr = missions.finish();
  const facts = isArcade(mode) ? endFacts(score, bestScoreAtStart, isRecord, ' puntos') : endFacts(distM, bestAtStart[mode] || 0, isRecord);
  if (isArcade(mode)) facts.lines.unshift(`Racha máxima ×${maxMult} · ${fmtN(Math.round(distM))} m`); facts.lines = facts.lines.slice(0, 2);
  pushMissions();
  ui.over({ mode, distM, coins, score, best: isArcade(mode) ? top[0].score : (top[0].distM ?? top[0].score), isRecord, time: game.time, maxBoostTime: mode === 'classic' ? game.boostTotal : game.maxBoostTime, top: top.map((e) => ({ ...e, me: e === me })), missionsDone: mr.completed, facts, headline: facts.headline, rankUp: mr.rankUp, rank: missions.rank() });
  if (mr.rankUp) setTimeout(() => { audio.play('record'); ui.toast(`¡Rango ${missions.rank().level}: ${missions.rank().name}!`, 'mission'); }, 700);
  ui.show('over');
  if (isRecord) audio.play('record');
  pushRecords();
}

// Resumen de la partida para la tarjeta final: titular según cómo haya ido y uno o dos datos útiles
// (qué te mató, cuánto te faltó), en vez de un titular al azar.
function endFacts(distM, best, isRecord, unit = ' m') {
  const out = [];
  let headline;
  const first = best <= 0;
  const diff = Math.round(best - distM);
  if (isRecord) headline = '¡Increíble!';
  else if (first) headline = '¡Primera carrera!';
  else if (diff > 0 && diff <= Math.max(150, best * 0.12)) headline = '¡Por muy poco!';
  else if (unit === ' m' && distM < 300) headline = '¡Arranque complicado!';
  else if (distM > best * 0.6) headline = '¡Buena carrera!';
  else headline = '¡Otra más!';
  if (isRecord && best > 0) out.push(`Has superado tu récord en ${fmtN(Math.round(distM - best))}${unit}`);
  else if (!first && diff > 0) out.push(`Te faltaron ${fmtN(diff)}${unit} para tu récord`);
  const since = lostAt >= 0 ? game.time - lostAt : -1;
  if (since >= 0 && since < 8) out.push(`Caíste ${since.toFixed(1).replace('.', ',')} s después de perder los impulsos: busca una placa azul`);
  else if (killBox && !killBox.fixed) out.push('Te pilló una caja rodante: fíjate hacia dónde gira');
  else if (killBox && killBox.tall) out.push('Los pilares cruzan el túnel: esquívalos por un lado');
  else if (game.level === 0 && distM < 400) out.push('Pisa las flechas azules: con impulso, un choque no te elimina');
  if (out.length < 2 && visWorld > 1) out.push(`Llegaste al mundo ${visWorld}`);
  return { headline, lines: out.slice(0, 2) };
}
const fmtN = (n) => n.toLocaleString('es-ES');

// motor: pulsos cortitos y suaves, más seguidos cuanto más rápido vas (la vibración del móvil no
// tiene intensidad, así que la "fuerza" es la frecuencia y el largo del pulso). Al acelerar con
// una placa, un empujón más largo lo da el suceso de impulso.
let rumbleT = 0;
function engineRumble(dt) {
  if (state !== 'play' || !game.alive || settings.vibe === false || settings.reduceFx) return;
  const sp = Math.max(0, Math.min(1, (game.v - 1) / 4.5));
  if ((rumbleT -= dt) > 0) return;
  rumbleT = 0.34 - 0.2 * sp;
  try { navigator.vibrate && navigator.vibrate(Math.round(5 + 6 * sp)); } catch (e) {}
}
function bumpMult(why) {
  if (mult >= 5) return;
  mult++; maxMult = Math.max(maxMult, mult); audio.play('coin', { combo: mult * 2 }); buzz([8, 20, 8]);
  ui.toast(`×${mult} · ${why}`, 'mission');
}

// tienda: pinta los artículos y aplica lo equipado (estela, ambiente, marcador)
function paintShop() {
  ui.shop?.({ wallet: shop.wallet, cats: Object.entries(SHOP).map(([key, c]) => ({ key, name: c.name, desc: c.desc, items: c.items.map((it) => ({ ...it, owned: shop.owns(key, it.id), eq: shop.equipped(key).id === it.id })) })) });
}
function applyCosmetics() {
  const t = shop.equipped('trail'), l = shop.equipped('life'), h = shop.equipped('hud');
  renderer.setCosmetics({ trail: t.price ? t : null, life: l.kind || null });
  const r = document.getElementById('ui');
  for (const it of SHOP.hud.items) r.classList.toggle('hud-' + it.id, it.id === h.id && it.price > 0);
}

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

// fin de un tramo de Aventura: estrellas, mejor avance, fantasma y desbloqueo del siguiente
function finishAdventure() {
  const d = loadAdv(); const cur = d[advStage] || {};
  const bits = game.starBits, prog = game.progress, oldBits = bitsOf(cur);
  const stars = nBits(bits);
  // las estrellas se suman entre intentos (una vez sin chocar, otra con monedas…)
  const merged = oldBits | bits;
  const betterRun = stars > nBits(oldBits) || (!(oldBits & 1) && prog > (cur.best || 0) + 0.001) || ((bits & 1) && (oldBits & 1) && game.time < (cur.time || 1e9));
  d[advStage] = { bits: merged, stars: nBits(merged), best: Math.max(prog, cur.best || 0), time: (bits & 1) ? Math.min(game.time, cur.time || 1e9) : cur.time, ghost: betterRun && !game.fromCheckpoint ? packGhost(advRec) : cur.ghost };
  saveAdv(d);
  shop.add(game.coinsGot);
  const mr = missions.finish(); pushMissions();
  const st = STAGES[advStage];
  const lines = [];
  if (ghostGame) { const dg = Math.round((ghostGame.s - game.s) * 4); lines.push(dg > 4 ? `Tu fantasma iba ${dg} m por delante` : dg < -4 ? `Le sacaste ${-dg} m a tu fantasma` : 'Ibas a la par que tu fantasma'); }
  if (game.cleared) {
    // una vibración por cada estrella conseguida
    if (stars) setTimeout(() => buzz([...Array(stars)].flatMap(() => [40, 120]).slice(0, -1)), 300);
    if (merged === 7) lines.push('¡Tramo perfecto!');
    else if (game.fromCheckpoint) lines.push('Desde el punto de control no vale la estrella sin chocar');
  } else {
    lines.push(`Llegaste al ${Math.round(prog * 100)} % del tramo` + (cur.best ? ` (tu mejor: ${Math.round(Math.max(cur.best, prog) * 100)} %)` : ''));
    if (game.falls > 0) lines.push('Mira dónde aterrizas: solo los carriles enteros aguantan');
  }
  ui.over({ mode: 'adventure', distM: game.distanceM, coins: game.coinsGot, score: Math.round(game.distanceM + game.coinsGot * 10), best: 0, isRecord: false, time: game.time, top: [], missionsDone: mr.completed, facts: { lines: lines.slice(0, 2) }, headline: game.cleared ? (stars === 3 ? '¡Perfecto!' : '¡Tramo superado!') : '¡Casi lo tienes!', adv: { name: st.name, n: advStage + 1, stars, bits, merged, cleared: game.cleared, hasNext: game.cleared && advStage + 1 < STAGES.length, prog, time: game.time, coins: game.coinsGot, goal: game.coinGoal, cp: !game.cleared && cpPrefix && game.frame > cpFrame } });
  ui.show('over');
  if (mr.rankUp) setTimeout(() => { audio.play('record'); ui.toast(`¡Rango ${missions.rank().level}: ${missions.rank().name}!`, 'mission'); }, 700);
}

// vibración (móvil): se apaga con "Reducir efectos"
const buzz = (p) => { if (settings.reduceFx || settings.vibe === false || state === 'attract') return; try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
let nearT = 0, pendingChime = false, padHint = false, hitstop = 0;
let flightT = 0, wasFlight = false, trickHints = 0, wallHints = 0, toastOk = false;
// en pleno salto entre mundos solo se ven los avisos de la pirueta (el resto espera a aterrizar)
{ const raw = ui.toast; ui.toast = (t, k) => { if (!toastOk && state === 'play' && game && game.flight && game.flight() && game.alive) return; raw(t, k); }; }
try { trickHints = +(localStorage.getItem('hipertunel-pistas-pirueta') || 0); wallHints = +(localStorage.getItem('hipertunel-pistas-muro') || 0); } catch (e) {}

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
  if (game.mode === 'adventure' && state !== 'attract') {
    // se juega con el giro cuantizado igual que se guarda: el fantasma repite la partida exacta
    steer = quantSteer(steer); if (state === 'play') advRec.push(steer);
    if (ghostGame && ghostGame.alive) { const gs = ghostSteers[ghostGame.frame]; ghostGame.step({ steer: gs === undefined ? 0 : gs }); }
  }
  else input.steer(STEP, game.theta, false);
  const arc = state === 'play' && game.variant === 'arcade';
  const ev = game.step({ steer, jump: state === 'play' && game.hero ? input.consumeJump() : false, trick: arc ? input.consumeTrick() : false });
  // pirueta: mientras vuelas (y 0,5 s después de caer) tocar la pantalla no pausa
  if (arc) {
    const fl = !!game.flight();
    if (fl) flightT = 0.5; else flightT -= STEP;
    input.trickArm = flightT > 0;
    if (fl && !wasFlight) document.querySelectorAll('.toast').forEach((t) => t.remove());
    if (fl && !wasFlight && trickHints < 3 && !game.tricksTotal) { trickHints++; try { localStorage.setItem('hipertunel-pistas-pirueta', String(trickHints)); } catch (e) {} toastOk = true; ui.toast(COARSE ? '¡Toca para hacer una pirueta!' : '¡Pirueta! Pulsa Espacio o X', 'boost'); toastOk = false; }
    wasFlight = fl;
  } else input.trickArm = false;
  renderer.onEvents(ev, game);
  for (const e of ev) {
    if (state === 'attract') continue;
    if (e.type === 'boost') { audio.play('boost', { level: e.level }); buzz(e.level === 3 ? [15, 40, 30] : [14 + e.level * 4]); if (e.level === 3) ui.toast('¡Velocidad máxima!', 'boost'); }
    else if (e.type === 'crash') {
      if (!e.fatal) lostAt = game.time; else killBox = game.boxes.find((b) => b.id === e.id) || null;
      if (mult > 1 && !e.fatal) ui.toast(`Racha perdida (×${mult})`, 'info');
      mult = 1; multDist = 0;
      audio.play(e.fatal ? 'death' : 'crash'); buzz(e.fatal ? [120, 60, 200] : [40, 30, 60]); if (!e.fatal) { ui.toast('¡Impulsos perdidos!', 'info'); hitstop = settings.reduceFx ? 0 : 0.07; } else if (!settings.reduceFx) hitstop = 0.08; }
    else if (e.type === 'coin') { coins = game.coinsGot; audio.play('coin', { combo: e.combo }); buzz(e.combo >= 3 ? [12, 25, 12] : 10); coinFly(e); }
    else if (e.type === 'fall') { ui.toast(game.boostOn || game.invul > 0 ? '¡Por poco! Caes y pierdes los impulsos' : '¡Al vacío!', 'info'); renderer.flash(0x000000, 0.35); }
    else if (e.type === 'crumble') { audio.play('collapse'); buzz(25); }
    else if (e.type === 'creak') { audio.play('creak', { k: e.k }); buzz(e.k > 0.6 ? 12 : 6); }
    else if (e.type === 'zoneIn') { ui.toast('¡El suelo cruje! No te quedes quieto', 'mission'); audio.play('creak', { k: 0.5 }); }
    else if (e.type === 'checkpoint') { cpFrame = advRec.length; cpPrefix = Float64Array.from(advRec); ui.toast('¡Punto de control!', 'mission'); audio.play('world'); }
    else if (e.type === 'power') { const n = { magnet: 'Imán', x2: 'Monedas ×2', shield: 'Escudo' }[e.kind]; ui.toast(`¡${n}!`, 'mission'); audio.play('world'); buzz([10, 20, 10]); }
    else if (e.type === 'shield') { ui.toast('El escudo te ha salvado', 'mission'); audio.play('crash'); renderer.flash(0xb58cff, 0.35); }
    else if (e.type === 'clear') { audio.play('record'); buzz([30, 40, 30, 40, 60]); }
    else if (e.type === 'jump') { audio.play('jump'); buzz(12); }
    else if (e.type === 'wallSoon') { if (wallHints < 3) { wallHints++; try { localStorage.setItem('hipertunel-pistas-muro', String(wallHints)); } catch (x) {} ui.toast('¡Viene un muro! Busca el bloque de cartón y atraviésalo', 'boost'); } }
    else if (e.type === 'smash') { coins = game.coinsGot; audio.play('smash'); buzz([20, 15, 30]); ui.toast('¡Cartón roto! +5', 'mission'); }
    else if (e.type === 'trick') { audio.play('whiff'); buzz(8); }
    else if (e.type === 'trickDone') { toastOk = true; coins = game.coinsGot; audio.play('coin', { combo: e.perfect ? 8 : 4 }); buzz(e.perfect ? [15, 30, 15, 30, 30] : [12, 25, 12]); const why = e.perfect ? '¡Pirueta perfecta! +10' : e.n > 1 ? `Pirueta ×${e.n} +5` : 'Pirueta +5'; if (mult >= 5) ui.toast(why, 'mission'); else bumpMult(why); toastOk = false; }
    else if (e.type === 'trickFail') { coins = game.coinsGot; ui.toast(e.lost ? `¡Tropiezo! Pierdes ${e.lost} monedas${mult > 1 ? ` y la racha ×${mult}` : ''}` : mult > 1 ? `Tropiezo: racha perdida (×${mult})` : '¡Tropiezo! Acaba la pirueta antes de caer', 'info'); mult = 1; multDist = 0; audio.play('land'); buzz([40, 30, 40]); renderer.stumble?.(); }
    else if (e.type === 'noJump') { audio.play('whiff'); ui.jumpDenied?.(); }
    else if (e.type === 'charge') { audio.play('coin', { combo: 6 }); buzz([8, 20, 8]); ui.toast(e.why === 'near' ? '+1 salto · 5 roces seguidos' : '+1 salto', 'mission'); }
    else if (e.type === 'jumpClose') { audio.play('nearMiss'); buzz(10); bumpMult('¡Al límite!'); }
    else if (e.type === 'land') { audio.play('land'); buzz(18); }
    else if (e.type === 'foldStart') audio.play('foldStart');
    else if (e.type === 'foldOrder' && game.fold < 0) {
      // desde fuera, el plegado hacia dentro lleva a un mundo nuevo: se avisa con la distancia
      // aproximada (32 filas de recta + unos 600 fotogramas de plegado + 24 filas de tránsito)
      const rows = 56 + 600 * game.v / 13.176;
      ui.toast(`Mundo ${visWorld + 1} a unos ${fmtN(Math.round(rows * 4 / 100) * 100)} m`, 'mission');
    }
    else if (e.type === 'foldEnd') { audio.play('foldEnd'); buzz(25); }
    else if (e.type === 'world') {
      if (!game.inverted) { visWorld++; e.visWorld = visWorld; }
      audio.setWorld(game.world + worldBase * 2);
      // la campanilla del mundo nuevo suena al aterrizar del salto, si lo hay
      if (!game.inverted) { if (game.gaps.some((g) => g.to + 1 > game.s)) pendingChime = true; else audio.play('world'); }
    }
  }
  // Arcade: puntos = distancia × racha; cada 500 m sin chocar la racha sube
  if (game.variant === 'arcade' && (state === 'play' || state === 'dying')) {
    const d = game.distanceM - (game._pd || 0); game._pd = game.distanceM;
    if (game.alive) { points += d * mult; multDist += d; if (multDist >= 500 && mult < 5) { multDist = 0; bumpMult('500 m sin chocar'); } }
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
      if (Math.abs(d) > hw * 0.8 && Math.abs(d) < hw * 1.6) { audio.play('nearMiss'); buzz(10); nearT = 0.4; if (game.variant === 'arcade') bumpMult('¡Por los pelos!'); for (const f of missions.event({ type: 'near' }, game)) ui.toast('Misión cumplida: ' + f.text, 'mission'); break; }
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
  engineRumble(dt);
  if (state === 'dying') { overT += dt; if (overT > (game.cleared ? 0.5 : 0.9)) finish(); }
  if (state === 'over') overT += dt;

  const a = window.__freeze ? 1 : state === 'play' || state === 'attract' || state === 'dying' ? acc / STEP : 1;
  const s = prev.s + (game.s - prev.s) * a;
  let dth = game.theta - prev.theta;
  if (dth > Math.PI) dth -= Math.PI * 2; else if (dth < -Math.PI) dth += Math.PI * 2;
  const theta = prev.theta + dth * a;
  renderer.update(game, s, theta, dt, { reduceFx: settings.reduceFx, intro: state === 'countdown' && countdown > 0.6 ? Math.min(1, (countdown - 0.6) / 2.4) : 0, mascot: state === 'attract' && (ui.screen === 'title' || ui.screen === 'shop') });
  renderer.render();
  audio.setSpeed(game.speedMS, game.level);
  audio.setHover?.(!!game.hero && (state === 'play' || state === 'countdown') && game.alive, Math.min(1, game.speedMS / 100));
  if (state === 'play' || state === 'countdown' || state === 'dying') {
    ui.hud({ jumps: game.hero ? { n: game.charges, part: game.charges < 2 ? game.coinAcc / 10 : 0, free: game.boostOn } : null, mult: game.variant === 'arcade' ? mult : 0, points: game.variant === 'arcade' ? Math.round(points + game.coinsGot * 10) : 0, adv: game.mode === 'adventure' ? { p: game.progress, power: game.power, powerT: game.powerT, shield: game.shield, n: advStage + 1 } : null, padDir: state === 'play' ? padDirection() : 0, distM: game.distanceM, speedMS: state === 'countdown' && game.frame === 0 ? 0 : game.speedMS, level: game.level, coins: game.coinsGot, timeLeft: mode === 'timetrial' ? game.timeLeft : null, mode, invul: game.invul > 0, best: bestAtStart[mode] || 0, countdown: state === 'countdown' ? Math.ceil(countdown) : 0 });
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
  get game() { return game; }, get state() { return state; }, renderer, ui, audio, input, missions, shop,
  startMenu: (m = 'arcade') => startGame(m),
  start: (m = 'classic', seed) => { startGame(m); if (seed !== undefined) newGame(m, seed); state = 'play'; },
  skipTo(rows) { while (game.s < rows && game.alive) { game.step({ steer: botSteer(game) }); renderer.track.sync(game); } prev = { s: game.s, theta: game.theta }; },
  step(n = 1, steer = null) { for (let i = 0; i < n; i++) { prev.s = game.s; prev.theta = game.theta; const ev = game.step({ steer: steer ?? botSteer(game) }); renderer.onEvents(ev, game); renderer.track.sync(game); } },
  bot: botSteer, padDirection: () => padDirection(),
};
