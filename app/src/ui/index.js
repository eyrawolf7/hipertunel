// Interfaz de Hipertúnel: menús, HUD y pantallas (DOM + CSS, sin frameworks).
//
// API (ver docs/CONTRATO.md):
//   const ui = createUI(root, handlers)
//   handlers: { onPlay(mode), onResume(), onRestart(), onMenu(), onSetting(key, value),
//               onCalibrate(), onPause?(), onSound?(name), keyboard?: bool }
//   ui.show(screen) · ui.hud(state) · ui.toast(text, kind) · ui.over(result) · ui.settings(values)
//   Extras: ui.tiltMeter(v, text) · ui.records({classic, survival, timetrial})
//           ui.navigate('up'|'down'|'left'|'right') · ui.confirm() · ui.back() · ui.screen
//
// El CSS se enlaza con new URL('./ui.css', import.meta.url): funciona igual en Vite (lo emite
// como recurso) que en un servidor estático cualquiera.

import { ICON } from './icons.js';

const MODES = {
  classic: { name: 'Clásico', desc: 'Sin límite. Llega lo más lejos que puedas.', tag: 'Lo de siempre' },
  survival: { name: 'Supervivencia', desc: 'Sin impulsos y la velocidad no para de subir.', tag: 'Para valientes' },
  timetrial: { name: 'Contrarreloj', desc: '60 s. Cada impulso suma tiempo, cada choque resta.', tag: 'A toda prisa' },
};
const MODE_KEYS = Object.keys(MODES);
const MENU_SCREENS = new Set(['title', 'modes', 'settings', 'pause', 'over']);
const LOGO = 'Hipertúnel';
const LOGO_TINTS = ['r', 'y', 'b', 'm'];

// ---------- utilidades ----------
const fmtInt = (n) => String(Math.max(0, Math.round(n || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmtDec = (n, d = 1) => (Math.max(0, n || 0)).toFixed(d).replace('.', ',');
const fmtTime = (t) => {
  t = Math.max(0, t || 0);
  const m = Math.floor(t / 60), sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

function injectAssets() {
  const head = document.head;
  if (!document.getElementById('htui-font')) {
    for (const href of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
      const l = document.createElement('link'); l.rel = 'preconnect'; l.href = href;
      if (href.includes('gstatic')) l.crossOrigin = '';
      head.appendChild(l);
    }
    const f = document.createElement('link');
    f.id = 'htui-font'; f.rel = 'stylesheet';
    f.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';
    head.appendChild(f);
  }
  if (!document.getElementById('htui-css')) {
    const l = document.createElement('link');
    l.id = 'htui-css'; l.rel = 'stylesheet';
    l.href = new URL('./ui.css', import.meta.url).href;
    head.appendChild(l);
    return l;
  }
  return null;
}

// ---------- plantillas ----------
function logoHTML() {
  // Tres capas idénticas (extrusión de color, contorno de tinta y relleno blanco) para que el
  // contorno de una letra nunca pise el relleno de la vecina.
  const row = (cls) => `<span class="lg-row ${cls}" aria-hidden="true">${[...LOGO].map((ch, i) =>
    `<span class="lg t-${LOGO_TINTS[i % 4]}" style="--i:${i}">${ch}</span>`).join('')}</span>`;
  return `<h1 class="logo" aria-label="${LOGO}">${row('l-ext')}${row('l-ink')}${row('l-fill')}</h1>`;
}

function titleHTML() {
  return `
<section class="scr scr-title" data-screen="title">
  <div class="vig vig-title"></div>
  <div class="title-main">
    <div class="logo-wrap">${logoHTML()}<div class="sticker">¡Inclina y vuela!</div></div>
    <button class="btn btn-play" data-nav data-act="play" data-default>
      <span class="btn-ico">${ICON.play}</span><span>Jugar</span>
    </button>
    <div class="title-row">
      <button class="btn btn-sec" data-nav data-act="modes"><span class="btn-ico">${ICON.grid}</span><span>Modos</span></button>
      <button class="btn btn-sec" data-nav data-act="settings"><span class="btn-ico">${ICON.gear}</span><span>Ajustes</span></button>
    </div>
  </div>
  <div class="title-foot">
    <div class="chip chip-best">${ICON.trophy}<span>Récord</span><b data-bind="best">—</b></div>
    <div class="press">Pulsa para jugar</div>
    <div class="chip chip-ver">v0.40</div>
  </div>
</section>`;
}

function headerHTML(title) {
  return `<header class="head">
    <button class="btn btn-back" data-nav data-act="back" aria-label="Atrás"><span class="btn-ico">${ICON.back}</span><span class="back-txt">Atrás</span></button>
    <h2 class="head-title">${title}</h2>
    <div class="head-hint"><kbd>Esc</kbd> volver</div>
  </header>`;
}

function modesHTML() {
  return `
<section class="scr scr-menu scr-modes" data-screen="modes">
  <div class="vig vig-menu"></div>
  ${headerHTML('Elige modo')}
  <div class="cards">
    ${MODE_KEYS.map((k, i) => `
    <button class="card card-${k}" data-nav data-mode="${k}" style="--i:${i}" ${i === 0 ? 'data-default' : ''}>
      <span class="card-head">
        <span class="card-tag">${MODES[k].tag}</span>
        <span class="card-ico">${ICON[k]}</span>
      </span>
      <span class="card-body">
        <span class="card-name">${MODES[k].name}</span>
        <span class="card-desc">${MODES[k].desc}</span>
        <span class="card-rec">${ICON.trophy}<b data-rec="${k}">—</b></span>
      </span>
    </button>`).join('')}
  </div>
</section>`;
}

function toggleRow(key, icon, label, sub) {
  return `<div class="set-row">
    <span class="set-ico">${ICON[icon]}</span>
    <span class="set-lbl">${label}${sub ? `<small>${sub}</small>` : ''}</span>
    <button class="tog" role="switch" aria-checked="false" data-nav data-set="${key}" aria-label="${label}"${key === 'tilt' ? ' data-default' : ''}><i></i></button>
  </div>`;
}

function settingsHTML() {
  return `
<section class="scr scr-menu scr-settings" data-screen="settings">
  <div class="vig vig-menu"></div>
  ${headerHTML('Ajustes')}
  <div class="panels">
    <div class="panel" style="--i:0">
      <h3 class="panel-title"><span class="dot dot-b"></span>Control</h3>
      ${toggleRow('tilt', 'phone', 'Inclinación', 'Gira inclinando el móvil')}
      ${toggleRow('invert', 'swap', 'Invertir giro')}
      <div class="set-row">
        <span class="set-ico">${ICON.speed}</span>
        <span class="set-lbl">Sensibilidad</span>
        <div class="slider" data-nav data-adjust="sens" role="slider" aria-label="Sensibilidad" aria-valuemin="0.5" aria-valuemax="2" tabindex="0">
          <div class="sl-track"><div class="sl-fill"></div><div class="sl-thumb"></div></div>
          <b class="sl-val">1,0×</b>
        </div>
      </div>
      <div class="set-row set-cal">
        <button class="btn btn-cal" data-nav data-act="calibrate"><span class="btn-ico">${ICON.target}</span><span>Calibrar el centro</span></button>
        <div id="tiltMeter" class="tilt-meter" style="--v:0">
          <div class="tm-track"><i class="tm-mid"></i><b class="tm-dot"></b></div>
          <span class="tm-status">Sin datos del sensor</span>
        </div>
      </div>
    </div>
    <div class="panel" style="--i:1">
      <h3 class="panel-title"><span class="dot dot-m"></span>Imagen y sonido</h3>
      <div class="set-row">
        <span class="set-ico">${ICON.sparkle}</span>
        <span class="set-lbl">Calidad</span>
        <div class="seg" data-nav data-adjust="quality" role="radiogroup" aria-label="Calidad" tabindex="0">
          <button data-q="baja" tabindex="-1">Baja</button><button data-q="media" tabindex="-1">Media</button><button data-q="alta" tabindex="-1">Alta</button>
          <i class="seg-knob"></i>
        </div>
      </div>
      ${toggleRow('reduceFx', 'eye', 'Menos efectos', 'Por si te mareas')}
      ${toggleRow('music', 'music', 'Música')}
      ${toggleRow('sound', 'sound', 'Efectos de sonido')}
    </div>
  </div>
</section>`;
}

function pauseHTML() {
  return `
<section class="scr scr-pause" data-screen="pause">
  <div class="vig vig-dim"></div>
  <div class="pop-card pause-card">
    <div class="pc-stripe"></div>
    <h2 class="pc-title">${ICON.pause}Pausa</h2>
    <button class="btn btn-primary" data-nav data-act="resume" data-default><span class="btn-ico">${ICON.play}</span><span>Continuar</span></button>
    <button class="btn btn-sec" data-nav data-act="restart"><span class="btn-ico">${ICON.retry}</span><span>Reiniciar</span></button>
    <div class="pc-row">
      <button class="btn btn-sec btn-sm" data-nav data-act="settings"><span class="btn-ico">${ICON.gear}</span><span>Ajustes</span></button>
      <button class="btn btn-sec btn-sm" data-nav data-act="menu"><span class="btn-ico">${ICON.home}</span><span>Menú</span></button>
    </div>
  </div>
</section>`;
}

function overHTML() {
  return `
<section class="scr scr-over" data-screen="over">
  <div class="vig vig-dim"></div>
  <div class="pop-card over-card">
    <div class="ribbon" data-bind="ribbon"><span>¡Nuevo récord!</span></div>
    <div class="oc-head"><h2 data-bind="headline">¡Buena carrera!</h2><span class="oc-mode" data-bind="mode">Clásico</span></div>
    <div class="oc-cols">
      <div class="oc-main">
        <div class="oc-lbl">Distancia</div>
        <div class="oc-dist"><b data-bind="dist">0</b><span>m</span></div>
        <div class="oc-best">${ICON.trophy}<span>Mejor</span><b data-bind="bestO">—</b></div>
        <div class="oc-stats">
          <div class="stat">${ICON.coin}<b data-bind="coins">0</b><small>monedas</small></div>
          <div class="stat stat-score"><span class="st-ico">${ICON.sparkle}</span><b data-bind="score">0</b><small>puntos</small></div>
          <div class="stat"><span class="st-ico">${ICON.timetrial}</span><b data-bind="time">0:00</b><small>tiempo</small></div>
        </div>
      </div>
      <div class="oc-side">
        <h3 class="oc-toptitle">Tus mejores</h3>
        <ol class="top5" data-bind="top"></ol>
      </div>
    </div>
    <div class="oc-btns">
      <button class="btn btn-primary" data-nav data-act="restart" data-default><span class="btn-ico">${ICON.retry}</span><span>Otra vez</span></button>
      <button class="btn btn-sec" data-nav data-act="menu"><span class="btn-ico">${ICON.home}</span><span>Menú</span></button>
    </div>
    <div class="oc-hint">Toca en cualquier sitio para reintentar</div>
  </div>
</section>`;
}

function hudHTML() {
  return `
<section class="scr scr-hud" data-screen="hud">
  <div class="hud-tl">
    <button class="hud-pause" data-act="pause" aria-label="Pausa">${ICON.pause}</button>
    <div class="hud-coins">${ICON.coin}<b data-hud="coins">0</b></div>
  </div>
  <div class="hud-timer" data-hud="timerBox"><b data-hud="timer">60</b><small>s</small></div>
  <div class="hud-tr">
    <div class="hud-dist"><b data-hud="dist">0</b><span>m</span></div>
    <div class="hud-speed"><b data-hud="speed">0</b> km/h</div>
  </div>
  <div class="hud-br" data-hud="chevs">
    <span class="chev" data-c="0">${ICON.chevron}</span><span class="chev" data-c="1">${ICON.chevron}</span><span class="chev" data-c="2">${ICON.chevron}</span>
  </div>
</section>`;
}

// ---------- createUI ----------
export function createUI(root, handlers = {}) {
  const H = handlers;
  const snd = (n) => { try { H.onSound && H.onSound(n); } catch (e) { /* nada */ } };
  const call = (name, ...a) => { if (typeof H[name] === 'function') H[name](...a); };

  const cssLink = injectAssets();
  root.classList.add('htui');
  if (cssLink && !cssLink.sheet) {
    root.classList.add('htui-loading');
    cssLink.addEventListener('load', () => root.classList.remove('htui-loading'), { once: true });
    cssLink.addEventListener('error', () => root.classList.remove('htui-loading'), { once: true });
  }
  root.innerHTML = titleHTML() + modesHTML() + settingsHTML() + pauseHTML() + overHTML() + hudHTML()
    + '<div class="toasts" aria-live="polite"></div>';

  const $ = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => [...el.querySelectorAll(sel)];
  const screens = {};
  for (const el of $$('.scr')) screens[el.dataset.screen] = el;
  const toasts = $('.toasts');

  let current = 'none';
  let settingsFrom = 'title';
  let lastMode = 'classic';
  let overShownAt = 0;
  let focused = null;
  const records = { classic: 0, survival: 0, timetrial: 0 };
  const vals = { tilt: true, invert: false, sens: 1, quality: 'alta', reduceFx: false, music: true, sound: true };

  // ----- pantallas -----
  function show(name) {
    const prev = current;
    if (!screens[name] && name !== 'none') return;
    if (name === 'settings' && (prev === 'title' || prev === 'pause')) settingsFrom = prev;
    for (const k in screens) screens[k].classList.toggle('on', k === name);
    // la pausa se dibuja sobre el HUD
    if (name === 'pause' || (name === 'settings' && settingsFrom === 'pause')) screens.hud.classList.add('on', 'under');
    else screens.hud.classList.remove('under');
    current = name;
    root.dataset.screen = name;
    root.classList.toggle('htui-menu', MENU_SCREENS.has(name));
    if (name === 'hud' && prev !== 'pause' && prev !== 'settings') hudReset();
    if (name === 'over') overShownAt = performance.now();
    if (name === 'title' || name === 'modes') paintRecords();
    focused = null;
    for (const el of $$('.is-focus')) el.classList.remove('is-focus');
    if (MENU_SCREENS.has(name)) {
      const def = $('[data-default]', screens[name]) || navItems()[0];
      if (def) setFocus(def, false);
    }
  }

  // ----- navegación (teclado/mando) -----
  function navItems() {
    const scr = screens[current];
    if (!scr) return [];
    return $$('[data-nav]', scr).filter((el) => el.offsetParent !== null && !el.disabled);
  }
  function setFocus(el, sound = true) {
    if (!el || el === focused) return;
    if (focused) focused.classList.remove('is-focus');
    focused = el;
    el.classList.add('is-focus');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (sound) snd('menuMove');
  }
  function navigate(dir) {
    if (!MENU_SCREENS.has(current)) return;
    root.classList.add('nav-kbd');
    const items = navItems();
    if (!items.length) return;
    if (!focused || !items.includes(focused)) { setFocus(items[0]); return; }
    if ((dir === 'left' || dir === 'right') && focused.dataset.adjust) { adjust(focused.dataset.adjust, dir === 'left' ? -1 : 1); return; }
    const a = focused.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    const v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    if (!v) return;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === focused) continue;
      const b = el.getBoundingClientRect();
      // distancia al borde más cercano en el eje principal, centro en el secundario
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const main = dx * v[0] + dy * v[1];
      if (main <= 4) continue;
      const overlap = v[0] ? (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) : (Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const ortho = Math.abs(v[0] ? dy : dx);
      const score = main + (overlap > 0 ? 0 : ortho * 2.2);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) setFocus(best);
  }
  function confirm() {
    if (!MENU_SCREENS.has(current)) return;
    if (!focused) { const it = navItems(); if (it[0]) setFocus(it[0], false); return; }
    press(focused);
  }
  function back() {
    switch (current) {
      case 'modes': snd('menuBack'); show('title'); break;
      case 'settings': snd('menuBack'); show(settingsFrom === 'pause' ? 'pause' : 'title'); break;
      case 'pause': snd('menuBack'); call('onResume'); break;
      case 'over': snd('menuBack'); call('onMenu'); break;
      default: break;
    }
  }

  // Ejecuta la acción de un elemento (clic, toque, Enter o botón A del mando)
  function press(el) {
    if (!el) return;
    el.classList.remove('is-pressed'); void el.offsetWidth; el.classList.add('is-pressed');
    setTimeout(() => el.classList.remove('is-pressed'), 160);
    if (el.dataset.set) { setVal(el.dataset.set, !vals[el.dataset.set]); snd('menuOk'); return; }
    if (el.dataset.adjust === 'quality') { adjust('quality', 1, true); return; }
    if (el.dataset.adjust) return;
    if (el.dataset.mode) { lastMode = el.dataset.mode; snd('menuOk'); call('onPlay', lastMode); return; }
    const act = el.dataset.act;
    if (!act) return;
    if (act === 'back') { back(); return; }
    if (act === 'pause') { snd('menuOk'); if (H.onPause) call('onPause'); else show('pause'); return; }
    if (act === 'over-guard') return;
    if (current === 'over' && performance.now() - overShownAt < 600) return;
    snd('menuOk');
    switch (act) {
      case 'play': call('onPlay', lastMode); break;
      case 'modes': show('modes'); break;
      case 'settings': show('settings'); break;
      case 'resume': call('onResume'); break;
      case 'restart': call('onRestart'); break;
      case 'menu': call('onMenu'); break;
      case 'calibrate': call('onCalibrate'); toast('Centro calibrado', 'info'); break;
      default: break;
    }
  }

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-nav], [data-act]');
    const segBtn = e.target.closest('.seg button');
    if (segBtn) { setVal('quality', segBtn.dataset.q); snd('menuOk'); setFocus(segBtn.parentElement, false); return; }
    if (el && root.contains(el) && !el.closest('.slider')) { press(el); return; }
    if (!el && current === 'title' && e.target.closest('.scr-title')) { snd('menuOk'); call('onPlay', lastMode); return; }
    if (!el && current === 'over' && performance.now() - overShownAt > 600) { snd('menuOk'); call('onRestart'); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' || e.button === 0) root.classList.remove('nav-kbd'); });
  root.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest('[data-nav]');
    if (el && MENU_SCREENS.has(current) && screens[current].contains(el) && el !== focused) setFocus(el, false);
  });

  if (H.keyboard !== false) {
    window.addEventListener('keydown', (e) => {
      if (!MENU_SCREENS.has(current)) return;
      const k = e.key;
      const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
      if (map[k]) { e.preventDefault(); navigate(map[k]); return; }
      if (k === 'Enter' || k === ' ') { e.preventDefault(); if (!e.repeat) { root.classList.add('nav-kbd'); confirm(); } return; }
      if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); if (!e.repeat) back(); }
    }, true);
  }

  // ----- ajustes -----
  const slider = $('.slider');
  const seg = $('.seg');
  const QUAL = ['baja', 'media', 'alta'];
  function paintSettings() {
    for (const el of $$('[data-set]')) {
      const on = !!vals[el.dataset.set];
      el.classList.toggle('on', on);
      el.setAttribute('aria-checked', String(on));
    }
    const s = Math.min(2, Math.max(0.5, +vals.sens || 1));
    slider.style.setProperty('--p', ((s - 0.5) / 1.5).toFixed(4));
    $('.sl-val', slider).textContent = `${fmtDec(s, 1)}×`;
    slider.setAttribute('aria-valuenow', String(s));
    const qi = Math.max(0, QUAL.indexOf(vals.quality));
    seg.style.setProperty('--q', qi);
    $$('button', seg).forEach((b, i) => b.classList.toggle('sel', i === qi));
    root.classList.toggle('htui-reduce', !!vals.reduceFx);
  }
  function setVal(key, value, silent = false) {
    if (vals[key] === value) return;
    vals[key] = value;
    paintSettings();
    if (!silent) call('onSetting', key, value);
  }
  function adjust(key, d, wrap = false) {
    if (key === 'sens') {
      const nv = Math.round(Math.min(2, Math.max(0.5, vals.sens + d * 0.1)) * 100) / 100;
      if (nv !== vals.sens) { setVal('sens', nv); snd('menuMove'); }
    } else if (key === 'quality') {
      let i = QUAL.indexOf(vals.quality) + d;
      if (wrap) i = (i + 3) % 3;
      i = Math.min(2, Math.max(0, i));
      if (QUAL[i] !== vals.quality) { setVal('quality', QUAL[i]); snd('menuMove'); }
    }
  }
  // arrastrar el deslizador
  {
    const track = $('.sl-track', slider);
    let drag = false;
    const at = (e) => {
      const r = track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      setVal('sens', Math.round((0.5 + p * 1.5) * 20) / 20);
    };
    slider.addEventListener('pointerdown', (e) => { drag = true; slider.setPointerCapture(e.pointerId); setFocus(slider, false); at(e); });
    slider.addEventListener('pointermove', (e) => { if (drag) at(e); });
    const end = () => { if (drag) { drag = false; snd('menuMove'); } };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
  }

  const meter = $('#tiltMeter');
  const meterStatus = $('.tm-status', meter);
  let meterV = null, meterT = null;
  function tiltMeter(v, text) {
    v = Math.max(-1, Math.min(1, +v || 0));
    const r = Math.round(v * 200) / 200;
    if (r !== meterV) { meterV = r; meter.style.setProperty('--v', r); }
    if (text != null && text !== meterT) { meterT = text; meterStatus.textContent = text; }
  }

  // ----- récords -----
  function paintRecords() {
    for (const k of MODE_KEYS) {
      const el = $(`[data-rec="${k}"]`);
      el.textContent = records[k] > 0 ? `${fmtInt(records[k])} m` : 'Sin récord';
      el.parentElement.classList.toggle('none', !(records[k] > 0));
    }
    const b = records[lastMode] || records.classic;
    $('[data-bind="best"]').textContent = b > 0 ? `${fmtInt(b)} m` : '—';
  }
  function setRecords(r = {}) {
    for (const k of MODE_KEYS) if (r[k] != null) records[k] = +r[k] || 0;
    paintRecords();
  }

  // ----- HUD -----
  const hudEl = {
    coins: $('[data-hud="coins"]'), timer: $('[data-hud="timer"]'), timerBox: $('[data-hud="timerBox"]'),
    dist: $('[data-hud="dist"]'), speed: $('[data-hud="speed"]'), chevs: $('[data-hud="chevs"]'),
    chev: $$('.chev'), distBox: $('.hud-dist'),
  };
  const last = {};
  function hudReset() {
    for (const k in last) delete last[k];
    hudEl.chevs.classList.remove('lose', 'invul');
    hudEl.chev.forEach((c) => c.classList.remove('full', 'pop'));
  }
  function hud(st) {
    if (!st) return;
    const dist = Math.floor(st.distM || 0);
    if (dist !== last.dist) {
      last.dist = dist;
      hudEl.dist.textContent = fmtInt(dist);
      const beyond = st.best > 0 && dist > st.best;
      if (beyond !== last.beyond) { last.beyond = beyond; hudEl.distBox.classList.toggle('gold', beyond); }
    }
    const spd = Math.round((st.speedMS || 0) * 3.6);
    if (spd !== last.spd) { last.spd = spd; hudEl.speed.textContent = spd; }
    const coins = st.coins | 0;
    if (coins !== last.coins) {
      const bump = last.coins != null && coins > last.coins;
      last.coins = coins; hudEl.coins.textContent = fmtInt(coins);
      if (bump) restart(hudEl.coins.parentElement, 'bump');
    }
    if (st.mode !== last.mode) {
      last.mode = st.mode;
      screens.hud.dataset.mode = st.mode || 'classic';
    }
    const tl = st.timeLeft;
    if (tl == null) {
      if (last.tl !== null) { last.tl = null; hudEl.timerBox.classList.add('off'); }
    } else {
      const low = tl < 10;
      const txt = low ? fmtDec(Math.max(0, Math.floor(tl * 10) / 10), 1) : String(Math.ceil(tl));
      if (last.tl === null || last.tl === undefined) hudEl.timerBox.classList.remove('off');
      if (txt !== last.tl) {
        const prevNum = last.tlNum;
        last.tl = txt; last.tlNum = tl; hudEl.timer.textContent = txt;
        if (prevNum != null && tl > prevNum + 0.5) restart(hudEl.timerBox, 'gain');
        else if (prevNum != null && tl < prevNum - 0.9) restart(hudEl.timerBox, 'loss');
      }
      if (low !== last.low) { last.low = low; hudEl.timerBox.classList.toggle('low', low); }
    }
    const lv = Math.max(0, Math.min(3, st.level | 0));
    if (lv !== last.lv) {
      const prev = last.lv;
      last.lv = lv;
      hudEl.chev.forEach((c, i) => c.classList.toggle('full', i < lv));
      if (prev != null && lv > prev) restart(hudEl.chev[lv - 1], 'pop');
      if (prev != null && lv < prev) restart(hudEl.chevs, 'lose');
      hudEl.chevs.dataset.level = lv;
    }
    const inv = !!st.invul;
    if (inv !== last.inv) { last.inv = inv; hudEl.chevs.classList.toggle('invul', inv); }
  }

  // ----- avisos -----
  function toast(text, kind = 'info') {
    const t = h(`<div class="toast toast-${esc(kind)}"><span>${esc(text)}</span></div>`);
    toasts.appendChild(t);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    setTimeout(() => t.classList.add('out'), 1600);
    setTimeout(() => t.remove(), 1600 + 400);
  }

  // ----- fin de partida -----
  function over(r = {}) {
    const scr = screens.over;
    const mode = MODES[r.mode] ? r.mode : 'classic';
    lastMode = mode;
    if (r.best != null) records[mode] = Math.max(records[mode] || 0, +r.best || 0);
    const bind = (k) => $(`[data-bind="${k}"]`, scr);
    scr.dataset.mode = mode;
    scr.classList.toggle('record', !!r.isRecord);
    bind('mode').textContent = MODES[mode].name;
    bind('headline').textContent = r.isRecord ? '¡Increíble!' : pick(mode === 'timetrial' ? ['¡Se acabó el tiempo!'] : ['¡Buena carrera!', '¡Casi!', '¡Qué viaje!', '¡Uf, por poco!']);
    bind('dist').textContent = fmtInt(r.distM);
    bind('bestO').textContent = r.best > 0 ? `${fmtInt(r.best)} m` : '—';
    bind('coins').textContent = fmtInt(r.coins);
    bind('score').textContent = fmtInt(r.score);
    bind('time').textContent = fmtTime(r.time);
    const top = Array.isArray(r.top) ? r.top.slice(0, 5) : [];
    const val = (e) => (typeof e === 'number' ? e : +(e && (e.distM ?? e.dist ?? e.score)) || 0);
    let marked = false;
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const e = top[i];
      if (e == null) { rows.push(`<li class="empty"><i>${i + 1}</i><b>—</b></li>`); continue; }
      const v = val(e);
      const me = !marked && (e.current || (Math.round(v) === Math.round(r.distM || -1)));
      if (me) marked = true;
      const when = e && e.date ? `<small>${esc(typeof e.date === 'number' ? new Date(e.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : e.date)}</small>` : '';
      rows.push(`<li class="${me ? 'me' : ''} r${i + 1}"><i>${i + 1}</i><b>${fmtInt(v)} m</b>${when}</li>`);
    }
    bind('top').innerHTML = rows.join('');
    show('over');
    // se reinicia la animación de entrada
    restart($('.over-card', scr), 'enter');
  }

  function settings(values = {}) {
    for (const k in values) if (k in vals) vals[k] = k === 'sens' ? +values[k] : values[k];
    paintSettings();
  }

  paintSettings();
  paintRecords();
  show('none');

  return {
    show, hud, toast, over, settings, tiltMeter, records: setRecords,
    navigate, confirm, back,
    get screen() { return current; },
    root,
  };
}

export default createUI;
