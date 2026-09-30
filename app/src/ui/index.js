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

import { ICON, DECO } from './icons.js';
import { applySkin } from './skin.js';

const MODES = {
  phase: { name: 'Fases', desc: 'Un mundo por fase: puntos de control, portal al final y hasta 3 estrellas.', tag: 'Recomendado', unit: '★' },
  zorro: { name: 'Zorro', desc: 'Nuevo: el Arcade en tercera persona, con el zorro en su tabla de hoja.', tag: 'Prototipo', unit: 'pts' },
  arcade: { name: 'Sin fin', desc: 'Boost a tope sin final: más cajas, mundos antes y racha ×5 si arriesgas.', tag: 'Infinito', unit: 'pts' },
  adventure: { name: 'Aventura', desc: '10 tramos: el tubo se rompe, el suelo se hunde, poderes y jefes.', tag: 'Nuevo' },
  classic: { name: 'Clásico', desc: 'Boost 2 tal cual: sin límite, llega lo más lejos que puedas.', tag: 'El original' },
  survival: { name: 'Supervivencia', desc: 'Sin impulsos y la velocidad no para de subir.', tag: 'Desafío' },
  timetrial: { name: 'Contrarreloj', desc: '60 s. Cada impulso suma tiempo, cada choque resta.', tag: 'Precisión' },
  daily: { name: 'Reto diario', desc: 'El mismo túnel para todos hoy. ¿Hasta dónde llegas?', tag: 'Diario' },
  voyage: { name: 'Viaje', desc: 'Empieza en el último mundo al que llegaste.', tag: 'Exploración', lockedDesc: 'Llega al mundo 2 para desbloquearlo.' },
};
const MODE_KEYS = Object.keys(MODES);
const MENU_SCREENS = new Set(['title', 'modes', 'settings', 'pause', 'over', 'shop', 'map', 'phases']);
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
  return `<h1 class="logo" aria-label="${LOGO}">${logoStone()}${row('l-ext')}${row('l-ink')}${row('l-fill')}</h1>`;
}

// Marco de piedra tallada detrás del logo: bloques, gemas en sus huecos, grabados, hojas y el filo
// turquesa de abajo. Todo decorativo y estático (no se anima nada caro).
function logoStone() {
  const gems = [9, 30, 50, 70, 91].map((x, i) => `<span class="ls-gem${i === 2 ? ' big' : ''}" style="left:${x}%">${DECO.gemSocket}</span>`).join('');
  return `<span class="logo-stone" aria-hidden="true">
    <span class="ls-slab"></span>
    <span class="ls-glyph ls-gl">${DECO.glyph}</span><span class="ls-glyph ls-gr">${DECO.glyph}</span>
    ${gems}
    <span class="ls-glow"></span>
    <span class="ls-lf ls-lf1">${DECO.leaves}</span><span class="ls-lf ls-lf2">${DECO.leaves}</span>
    <span class="ls-lf ls-lf3">${DECO.leaf}</span><span class="ls-lf ls-lf4">${DECO.leaf}</span><span class="ls-lf ls-lf5">${DECO.leaves}</span>
  </span>`;
}
const stoneLeaves = `<span class="bs-lf bs-lf-tl" aria-hidden="true">${DECO.leaf}</span><span class="bs-lf bs-lf-br" aria-hidden="true">${DECO.leaf}</span>`;
const stoneDeco = `<span class="bs-lf bs-lf-tl" aria-hidden="true">${DECO.leaf}</span><span class="bs-lf bs-lf-br" aria-hidden="true">${DECO.leaf}</span><span class="bs-glow" aria-hidden="true"></span>`;

function titleHTML() {
  return `
<section class="scr scr-title" data-screen="title">
  <div class="vig vig-title"></div>
  <div class="title-main">
    <div class="logo-wrap">${logoHTML()}<div class="sticker">¡Inclina y vuela!</div></div>
    <div class="play-frame">
      <span class="pf-gem pf-gem-l" aria-hidden="true">${DECO.gem}</span><span class="pf-gem pf-gem-r" aria-hidden="true">${DECO.gem}</span>
      <span class="pf-lf pf-lf1" aria-hidden="true">${DECO.leaves}</span><span class="pf-lf pf-lf2" aria-hidden="true">${DECO.leaf}</span>
      <button class="btn btn-play" data-nav data-act="play" data-default>
        <span class="btn-ico">${ICON.play}</span><span>Jugar</span>
      </button>
    </div>
    <div class="title-row">
      <button class="btn btn-stone" data-nav data-act="modes">${stoneDeco}<span class="btn-ico">${ICON.flag}</span><span>Modos</span></button>
      <button class="btn btn-stone" data-nav data-act="shop">${stoneDeco}<span class="btn-ico">${ICON.coin}</span><span>Tienda</span></button>
      <button class="btn btn-stone" data-nav data-act="settings">${stoneDeco}<span class="btn-ico">${ICON.gearTeal}</span><span>Ajustes</span></button>
    </div>
  </div>
  <div class="title-foot">
    <div class="foot-l">
      <div class="chip chip-best">${ICON.trophy}<span>Récord</span><b data-bind="best">—</b></div>
      <div class="chip chip-rank">${ICON.sparkle}<span data-bind="rankName">Novato</span><b data-bind="rankLvl">1</b></div>
    </div>
    <div class="press">Pulsa para jugar</div>
    <div class="chip chip-ver">v0.61</div>
  </div>
</section>`;
}

// Cabecera de los menús: Atrás en placa de piedra, título grande con su marco (o la pieza
// pintada titulo-<clave> si existe) y, a la derecha, «Esc volver» (o el marcador de la pantalla).
function headerHTML(title, key = '') {
  return `<header class="head">
    <button class="btn btn-stone btn-back" data-nav data-act="back" aria-label="Atrás">${stoneDeco}<span class="btn-ico">${ICON.back}</span><span class="back-txt">Atrás</span></button>
    <h2 class="head-title ht-${key}"><span class="ht-plate" aria-hidden="true"><span class="ht-gem ht-gem-l">${DECO.gem}</span><span class="ht-gem ht-gem-r">${DECO.gem}</span><span class="ht-lf ht-lf-l">${DECO.leaves}</span><span class="ht-lf ht-lf-r">${DECO.leaves}</span><span class="ht-glow"></span></span><span class="ht-txt">${title}</span></h2>
    <div class="head-hint stone-chip">${stoneLeaves}<kbd>Esc</kbd> volver</div>
  </header>`;
}

function modesHTML() {
  return `
<section class="scr scr-menu scr-modes" data-screen="modes">
  <div class="vig vig-menu"></div>
  ${headerHTML('Elige modo', 'elige-modo')}
  <div class="cards">
    ${MODE_KEYS.map((k, i) => `
    <button class="card card-${k}" data-nav data-mode="${k}" style="--i:${i}" ${i === 0 ? 'data-default' : ''}>
      <span class="card-gem" aria-hidden="true">${DECO.gem}</span>
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

function mapHTML(name = 'map', title = 'Aventura', key = 'aventura') {
  return `
<section class="scr scr-menu scr-map scr-${name}" data-screen="${name}">
  <div class="vig vig-menu"></div>
  ${headerHTML(title, key)}
  <div class="map-total stone-chip">${stoneLeaves}<span class="mt-star">★</span><span data-bind="${name}Total"></span></div>
  <div class="map-path" data-bind="${name}"></div>
</section>`;
}

function shopHTML() {
  return `
<section class="scr scr-menu scr-shop" data-screen="shop">
  <div class="vig vig-menu"></div>
  ${headerHTML('Tienda', 'tienda')}
  <div class="shop-wallet stone-chip">${stoneLeaves}${ICON.coin}<b data-bind="wallet">0</b><small>monedas</small></div>
  <div class="shop-cats" data-bind="shop"></div>
</section>`;
}

const panelDeco = `<span class="pn-deco" aria-hidden="true"><span class="pn-gem pn-gem-l">${DECO.gem}</span><span class="pn-gem pn-gem-r">${DECO.gem}</span><span class="pn-gem pn-gem-b">${DECO.gem}</span><span class="pn-lf pn-lf-tl">${DECO.leaves}</span><span class="pn-lf pn-lf-tr">${DECO.leaves}</span><span class="pn-lf pn-lf-bl">${DECO.leaves}</span><span class="pn-lf pn-lf-br">${DECO.leaves}</span></span>`;

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
  ${headerHTML('Ajustes', 'ajustes')}
  <div class="panels">
    <div class="panel" style="--i:0">
      ${panelDeco}<h3 class="panel-title plate-title"><span>Control</span></h3>
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
        <button class="btn btn-cal btn-teal" data-nav data-act="calibrate"><span class="btn-ico">${ICON.target}</span><span>Calibrar el centro</span></button>
        <div id="tiltMeter" class="tilt-meter" style="--v:0">
          <div class="tm-track"><i class="tm-mid"></i><b class="tm-dot"></b></div>
          <span class="tm-status">Sin datos del sensor</span>
        </div>
      </div>
    </div>
    <div class="panel" style="--i:1">
      ${panelDeco}<h3 class="panel-title plate-title"><span>Imagen y sonido</span></h3>
      <div class="set-row">
        <span class="set-ico">${ICON.sparkle}</span>
        <span class="set-lbl">Calidad</span>
        <div class="seg" data-nav data-adjust="quality" role="radiogroup" aria-label="Calidad" tabindex="0">
          <button data-q="baja" tabindex="-1">Baja</button><button data-q="media" tabindex="-1">Media</button><button data-q="alta" tabindex="-1">Alta</button>
          <i class="seg-knob"></i>
        </div>
      </div>
      ${toggleRow('reduceFx', 'eye', 'Menos efectos', 'Por si te mareas')}
      ${toggleRow('vibe', 'phone', 'Vibración', 'Motor, monedas y choques')}
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
    ${panelDeco}
    <div class="pc-stripe"></div>
    <h2 class="pc-title"><span class="pc-plate">${ICON.pause}<span>Pausa</span></span></h2>
    <div class="pc-cols">
      <div class="pc-btns">
        <div class="play-frame pf-sm">
          <span class="pf-gem pf-gem-l" aria-hidden="true">${DECO.gem}</span><span class="pf-gem pf-gem-r" aria-hidden="true">${DECO.gem}</span>
          <span class="pf-lf pf-lf1" aria-hidden="true">${DECO.leaves}</span>
          <button class="btn btn-primary" data-nav data-act="resume" data-default><span class="btn-ico">${ICON.play}</span><span>Continuar</span></button>
        </div>
        <button class="btn btn-stone" data-nav data-act="restart">${stoneDeco}<span class="btn-ico">${ICON.retry}</span><span>Reiniciar</span></button>
        <div class="pc-row">
          <button class="btn btn-stone btn-sm" data-nav data-act="settings">${stoneDeco}<span class="btn-ico">${ICON.gear}</span><span>Ajustes</span></button>
          <button class="btn btn-stone btn-sm" data-nav data-act="menu">${stoneDeco}<span class="btn-ico">${ICON.home}</span><span>Menú</span></button>
        </div>
      </div>
      <div class="miss-box">
        <h3 class="miss-title"><span class="mt-band">Misiones<span class="oc-glyph" aria-hidden="true">${DECO.glyph}</span></span><small data-bind="rankLine"></small></h3>
        <ul class="miss" data-bind="missions"></ul>
      </div>
    </div>
  </div>
</section>`;
}

function overHTML() {
  return `
<section class="scr scr-over" data-screen="over">
  <div class="vig vig-dim"></div>
  <div class="pop-card over-card">
    <div class="oc-deco" aria-hidden="true">
      <span class="od od-cr od-cr-tl">${DECO.crystals}</span><span class="od od-cr od-cr-tr">${DECO.crystals}</span>
      <span class="od od-cr od-cr-br">${DECO.crystals}</span>
      <span class="od od-lf od-lf-tl">${DECO.leaves}</span><span class="od od-lf od-lf-tr">${DECO.leaves}</span>
      <span class="od od-lf od-lf-ml">${DECO.leaf}</span><span class="od od-lf od-lf-mr">${DECO.leaf}</span>
    </div>
    <div class="ribbon" data-bind="ribbon"><span>¡Nuevo récord!</span></div>
    <div class="oc-head"><h2 data-bind="headline">¡Buena carrera!</h2><span class="oc-glyph" aria-hidden="true">${DECO.glyph}</span><span class="oc-mode" data-bind="mode">Clásico</span></div>
    <div class="oc-cols">
      <div class="oc-main">
        <div class="oc-adv" data-bind="adv"></div>
        <div class="oc-lbl">Distancia</div>
        <div class="oc-dist"><i class="oc-spark l" aria-hidden="true">${DECO.spark}</i><b data-bind="dist">0</b><span>m</span><i class="oc-spark r" aria-hidden="true">${DECO.spark}</i></div>
        <div class="oc-best">${ICON.trophy}<span>Mejor</span><b data-bind="bestO">—</b></div>
        <ul class="oc-facts" data-bind="facts"></ul>
        <div class="oc-stats">
          <div class="stat">${ICON.coin}<b data-bind="coins">0</b><small>a la cartera</small></div>
          <div class="stat stat-score"><span class="st-ico">${ICON.sparkle}</span><b data-bind="score">0</b><small>puntos</small></div>
          <div class="stat"><span class="st-ico">${ICON.timetrial}</span><b data-bind="time">0:00</b><small>tiempo</small></div>
        </div>
      </div>
      <div class="oc-side">
        <div class="oc-tabs"><button class="oc-tab on" data-tab="miss">Misiones</button><button class="oc-tab" data-tab="top">Tus mejores</button></div>
        <div class="oc-pane" data-pane="miss"><div class="miss-done" data-bind="missDone"></div><ul class="miss" data-bind="missions"></ul><div class="miss-rank" data-bind="rankLine"></div></div>
        <div class="oc-pane" data-pane="top" hidden><ol class="top5" data-bind="top"></ol></div>
        <div class="oc-pane oc-goals" data-pane="goals" hidden></div>
      </div>
    </div>
    <div class="oc-btns">
      <span class="ob-lf ob-lf-l" aria-hidden="true">${DECO.leaves}</span><span class="ob-lf ob-lf-r" aria-hidden="true">${DECO.leaves}</span>
      <span class="ob-cr ob-cr-l" aria-hidden="true">${DECO.crystals}</span><span class="ob-cr ob-cr-r" aria-hidden="true">${DECO.crystals}</span>
      <button class="btn btn-primary" data-nav data-act="restart" data-default><span class="btn-ico">${ICON.retry}</span><span data-bind="restartTxt">Otra vez</span></button>
      <button class="btn btn-sec btn-cp" data-nav data-act="checkpoint"><span class="btn-ico">${ICON.play}</span><span>Desde el control</span></button>
      <button class="btn btn-sec btn-fresh" data-nav data-act="fresh"><span class="btn-ico">${ICON.retry}</span><span>Desde el principio</span></button>
      <button class="btn btn-primary btn-next" data-nav data-act="next"><span class="btn-ico">${ICON.play}</span><span data-bind="nextTxt">Siguiente</span></button>
      <button class="btn btn-sec btn-cream" data-nav data-act="menu"><span class="btn-ico">${ICON.home}</span><span>Menú</span></button>
    </div>
    <div class="oc-hint">Toca en cualquier sitio para reintentar</div>
  </div>
</section>`;
}

const hudLeaves = `<span class="hc-lf hc-lf-tl" aria-hidden="true">${DECO.leaf}</span><span class="hc-lf hc-lf-br" aria-hidden="true">${DECO.leaf}</span><span class="hc-glow" aria-hidden="true"></span>`;
function hudHTML() {
  return `
<section class="scr scr-hud" data-screen="hud">
  <div class="hud-tl">
    <button class="hud-pause hud-chip" data-act="pause" aria-label="Pausa">${hudLeaves}${ICON.pause}</button>
    <div class="hud-coins hud-chip">${hudLeaves}${ICON.coin}<b data-hud="coins">0</b></div>
  </div>
  <div class="hud-timer" data-hud="timerBox"><b data-hud="timer">60</b><small>s</small></div>
  <div class="hud-tr">
    <div class="hud-dist hud-chip">${hudLeaves}<b data-hud="dist">0</b><span>m</span></div>
    <div class="hud-speed hud-chip">${hudLeaves}${ICON.speed}<b data-hud="speed">0</b> km/h</div>
    <div class="hud-mult hud-chip" data-hud="mult">${hudLeaves}<b data-hud="multN">×1</b><small data-hud="pts">0</small></div>
  </div>
  <div class="hud-count" data-hud="count"></div>
  <div class="hud-jumps" data-hud="jumps"><span>salto</span><i data-j="0"><b></b></i><i data-j="1"><b></b></i></div>
  <div class="adv-intro" data-hud="advIntro"></div>
  <div class="adv-bar" data-hud="advBar"><span data-hud="advN">Tramo 1</span><i><b data-hud="advP"></b></i><em data-hud="advPow"></em></div>
  <div class="pad-hint pad-l" data-hud="padL">${ICON.chevron}<span>placa</span></div>
  <div class="pad-hint pad-r" data-hud="padR"><span>placa</span>${ICON.chevron}</div>
  <div class="hud-br" data-hud="chevs">
    ${[0, 1, 2].map((i) => `<span class="chev" data-c="${i}"><i class="chev-fr" aria-hidden="true"></i>${ICON.chevron}${ICON.chevron}</span>`).join('')}
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
  applySkin(root);
  if (cssLink && !cssLink.sheet) {
    root.classList.add('htui-loading');
    cssLink.addEventListener('load', () => root.classList.remove('htui-loading'), { once: true });
    cssLink.addEventListener('error', () => root.classList.remove('htui-loading'), { once: true });
  }
  root.innerHTML = titleHTML() + modesHTML() + settingsHTML() + shopHTML() + mapHTML() + mapHTML('phases', 'Fases', 'fases') + pauseHTML() + overHTML() + hudHTML()
    + '<div class="toasts" aria-live="polite"></div>';

  const $ = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => [...el.querySelectorAll(sel)];
  const screens = {};
  for (const el of $$('.scr')) screens[el.dataset.screen] = el;
  const toasts = $('.toasts');

  let current = 'none';
  let settingsFrom = 'title';
  let lastMode = 'phase';
  let overShownAt = 0;
  let focused = null;
  const records = { classic: 0, survival: 0, timetrial: 0 };
  const vals = { tilt: true, invert: false, sens: 1, quality: 'alta', reduceFx: false, music: true, sound: true, vibe: true };

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
    if (name === 'pause' || name === 'over') toasts.replaceChildren();
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
    root.classList.add('nav-kbd');
    if (!focused) { const it = navItems(); if (it[0]) setFocus(it[0], false); return; }
    press(focused);
  }
  function back() {
    switch (current) {
      case 'modes': snd('menuBack'); show('title'); break;
      case 'shop': snd('menuBack'); show('title'); break;
      case 'map': case 'phases': snd('menuBack'); show('modes'); break;
      case 'settings': snd('menuBack'); show(settingsFrom === 'pause' ? 'pause' : 'title'); break;
      case 'pause': snd('menuBack'); call('onResume'); break;
      case 'over': if (performance.now() - overShownAt < 600) break; snd('menuBack'); call('onMenu'); break;
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
    if (el.dataset.stage !== undefined) {
      if (el.classList.contains('locked')) { snd('menuBack'); toast('Supera el tramo anterior para abrirlo', 'info'); return; }
      lastMode = 'adventure'; snd('menuOk'); call('onPlay', 'adventure', +el.dataset.stage); return;
    }
    if (el.dataset.phase !== undefined) {
      if (el.classList.contains('locked')) { snd('menuBack'); toast('Supera la fase anterior para abrirla', 'info'); return; }
      lastMode = 'phase'; snd('menuOk'); call('onPlay', 'phase', +el.dataset.phase); return;
    }
    if (el.dataset.buy) { const [cat, id] = el.dataset.buy.split(':'); call('onShop', cat, id); return; }
    if (el.dataset.mode) {
      if (el.classList.contains('locked')) { snd('menuBack'); toast(MODES[el.dataset.mode].lockedDesc || 'Bloqueado', 'info'); return; }
      if (el.dataset.mode === 'adventure') { snd('menuOk'); call('onMap'); show('map'); return; }
      if (el.dataset.mode === 'phase') { snd('menuOk'); call('onPhases'); show('phases'); return; }
      lastMode = el.dataset.mode; snd('menuOk'); call('onPlay', lastMode); return;
    }
    const act = el.dataset.act;
    if (!act) return;
    if (act === 'back') { back(); return; }
    if (act === 'pause') { snd('menuOk'); if (H.onPause) call('onPause'); else show('pause'); return; }
    if (act === 'over-guard') return;
    if (current === 'over' && performance.now() - overShownAt < 600) return;
    snd('menuOk');
    switch (act) {
      case 'play': call('onPlay', 'phase'); break;   // «Jugar» va a la siguiente fase
      case 'modes': show('modes'); break;
      case 'shop': call('onShopOpen'); show('shop'); break;
      case 'settings': show('settings'); break;
      case 'resume': call('onResume'); break;
      case 'restart': call('onRestart'); break;
      case 'next': call('onNext'); break;
      case 'checkpoint': call('onCheckpoint'); break;
      case 'fresh': call('onFresh'); break;
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
    if (!el && current === 'title' && e.target.closest('.scr-title')) { snd('menuOk'); call('onPlay', 'phase'); return; }
    if (!el && current === 'over' && performance.now() - overShownAt > 600 && !(screens.over.dataset.mode === 'phase' && screens.over.classList.contains('has-next'))) { snd('menuOk'); call('onRestart'); }
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
    root.classList.toggle('htui-q-baja', vals.quality === 'baja'); // sin desenfoque de fondo (lo caro va tras la calidad)
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
      el.textContent = records[k] > 0 ? `${fmtInt(records[k])} ${MODES[k].unit || 'm'}` : k === 'phase' ? 'Sin estrellas' : 'Sin récord';
      el.parentElement.classList.toggle('none', !(records[k] > 0));
    }
    const lm = MODES[lastMode] ? lastMode : 'phase', b = records[lm] || 0;
    $('[data-bind="best"]').textContent = b > 0 ? `${fmtInt(b)} ${MODES[lm].unit || 'm'}` : '—';
  }
  function setRecords(r = {}) {
    for (const k of MODE_KEYS) if (r[k] != null) records[k] = +r[k] || 0;
    paintRecords();
  }

  // ----- HUD -----
  const hudEl = {
    coins: $('[data-hud="coins"]'), timer: $('[data-hud="timer"]'), timerBox: $('[data-hud="timerBox"]'),
    dist: $('[data-hud="dist"]'), speed: $('[data-hud="speed"]'), chevs: $('[data-hud="chevs"]'),
    chev: $$('.chev'), distBox: $('.hud-dist'), padL: $('[data-hud="padL"]'), padR: $('[data-hud="padR"]'), advBar: $('[data-hud="advBar"]'), advIntro: $('[data-hud="advIntro"]'), mult: $('[data-hud="mult"]'), jumps: $('[data-hud="jumps"]'), jumpPips: $$('.hud-jumps i b'), multN: $('[data-hud="multN"]'), pts: $('[data-hud="pts"]'), advN: $('[data-hud="advN"]'), advP: $('[data-hud="advP"]'), advPow: $('[data-hud="advPow"]'),
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
    // flecha hacia la placa más cercana tras perder los impulsos (en el borde, nunca en el centro)
    // Aventura: avance del tramo y poder activo
    // Arcade: racha y puntos
    const mu = st.mult | 0;
    hudEl.mult.classList.toggle('on', mu > 0);
    if (mu && mu !== last.mu) { last.mu = mu; hudEl.multN.textContent = '×' + mu; hudEl.mult.dataset.m = mu; restart(hudEl.mult, 'bump'); }
    if (mu) { const pt = st.points | 0; if (pt !== last.pt) { last.pt = pt; hudEl.pts.textContent = fmtInt(pt) + ' pts'; } }
    // Zorro: cargas de salto (llenas) y la que se está recargando con monedas (parcial)
    const jp = st.jumps;
    hudEl.jumps.classList.toggle('on', !!jp);
    if (jp) {
      const key = jp.n + ':' + Math.round(jp.part * 10) + ':' + (jp.free ? 1 : 0);
      if (key !== last.jp) {
        const gained = last.jpN != null && jp.n > last.jpN;
        last.jp = key; last.jpN = jp.n;
        hudEl.jumpPips.forEach((b, i) => { b.style.height = (i < jp.n ? 100 : i === jp.n ? jp.part * 100 : 0) + '%'; });
        hudEl.jumps.classList.toggle('free', !!jp.free);
        hudEl.jumps.classList.toggle('empty', jp.n === 0 && !jp.free);
        if (gained) restart(hudEl.jumps, 'bump');
      }
    }
    // la tarjeta del tramo solo durante la cuenta atrás
    const introOn = !!st.adv && st.countdown > 0;
    if (introOn !== last.introOn) { last.introOn = introOn; hudEl.advIntro.classList.toggle('on', introOn); }
    const av = st.adv;
    hudEl.advBar.classList.toggle('on', !!av);
    if (av) {
      const p = Math.round(av.p * 1000);
      if (p !== last.advP) { last.advP = p; hudEl.advP.style.width = (p / 10) + '%'; }
      const lbl = av.label || 'Tramo ' + av.n;
      if (lbl !== last.advN) { last.advN = lbl; hudEl.advN.textContent = lbl; }
      const pw = av.power ? `${{ magnet: 'Imán', x2: '×2' }[av.power]} ${Math.ceil(av.powerT)}` : av.shield ? 'Escudo' : '';
      if (pw !== last.advPow) { last.advPow = pw; hudEl.advPow.textContent = pw; hudEl.advPow.classList.toggle('on', !!pw); }
    }
    const pd = st.padDir | 0;
    if (pd !== last.pd) { last.pd = pd; hudEl.padL.classList.toggle('on', pd < 0); hudEl.padR.classList.toggle('on', pd > 0); }
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
    // cuenta atrás de salida: 3, 2, 1 y ¡YA!
    const cd = st.countdown | 0;
    if (cd !== last.cd) {
      const was = last.cd; last.cd = cd;
      const el = hudEl.count || (hudEl.count = root.querySelector('[data-hud="count"]'));
      if (el) {
        if (cd > 0) { el.textContent = cd; restart(el, 'go'); }
        else if (was > 0) { el.textContent = '¡YA!'; restart(el, 'go'); setTimeout(() => { if (!last.cd) el.textContent = ''; }, 700); }
      }
    }
    const inv = !!st.invul;
    if (inv !== last.inv) { last.inv = inv; hudEl.chevs.classList.toggle('invul', inv); }
  }

  // ----- avisos -----
  const toastSeen = new Map();
  function toast(text, kind = 'info', opts = {}) {
    // ni sobre la pausa ni sobre el fin de partida; el mismo texto no se repite en 1,5 s
    if ((current === 'pause' || current === 'over') && !opts.force) return;
    const now = performance.now();
    if (now - (toastSeen.get(text) ?? -1e9) < 1500) return;
    toastSeen.set(text, now);
    if (toastSeen.size > 24) toastSeen.delete(toastSeen.keys().next().value);
    const ico = kind === 'boost' ? ICON.boost : /^¡Impulsos perdidos|^Racha perdida|^¡Al vacío|^¡Tropiezo/.test(text) ? '<i class="t-alert" aria-hidden="true"></i>' : '';
    const t = h(`<div class="toast toast-${esc(kind)}">${kind === 'boost' ? hudLeaves : ''}${ico}<span>${esc(text)}</span></div>`);
    toasts.appendChild(t);
    while (toasts.children.length > 2) toasts.firstElementChild.remove();
    const life = kind === 'info' ? 2800 : 1600;
    setTimeout(() => t.classList.add('out'), life);
    setTimeout(() => t.remove(), life + 400);
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
    bind('headline').textContent = r.headline ? r.headline : r.isRecord ? '¡Increíble!' : pick(mode === 'timetrial' ? ['¡Se acabó el tiempo!'] : ['¡Buena carrera!', '¡Casi!', '¡Qué viaje!', '¡Uf, por poco!']);
    bind('dist').textContent = fmtInt(r.distM);
    const unit = MODES[mode] && MODES[mode].unit ? ' ' + MODES[mode].unit : ' m';
    bind('bestO').textContent = r.best > 0 ? `${fmtInt(r.best)}${unit}` : '—';
    bind('coins').textContent = fmtInt(r.coins);
    bind('score').textContent = fmtInt(r.score);
    bind('time').textContent = fmtTime(r.time);
    const top = Array.isArray(r.top) ? r.top.slice(0, 5) : [];
    const val = (e) => (typeof e === 'number' ? e : +(e && (MODES[mode] && MODES[mode].unit === 'pts' ? e.score : (e.distM ?? e.dist ?? e.score))) || 0);
    let marked = false;
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const e = top[i];
      if (e == null) { rows.push(`<li class="empty"><i>${i + 1}</i><b>—</b></li>`); continue; }
      const v = val(e);
      const me = !marked && (e.me || e.current || (Math.round(v) === Math.round((MODES[mode] && MODES[mode].unit === 'pts' ? r.score : r.distM) || -1)));
      if (me) marked = true;
      const when = e && e.date ? `<small>${esc(typeof e.date === 'number' ? new Date(e.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : e.date)}</small>` : '';
      rows.push(`<li class="${me ? 'me' : ''} r${i + 1}"><i>${i + 1}</i><b>${fmtInt(v)}${unit}</b>${when}</li>`);
    }
    bind('top').innerHTML = rows.join('');
    const adv = r.adv;
    scr.classList.toggle('is-adv', !!adv);
    scr.classList.toggle('has-next', !!(adv && adv.hasNext));
    scr.classList.toggle('has-cp', !!(adv && adv.cp));
    scr.classList.toggle('has-fresh', !!(adv && adv.fresh));
    bind('restartTxt').textContent = adv && adv.fresh ? 'Desde el control' : 'Otra vez';
    bind('nextTxt').textContent = adv && adv.nextLabel ? adv.nextLabel : 'Siguiente';
    bind('adv').innerHTML = adv ? `<span class="oa-n">${esc(adv.label || 'Tramo ' + adv.n)} · ${esc(adv.name)}</span><span class="oa-stars">${[0, 1, 2].map((i) => `<i class="st ${i < adv.stars ? 'on' : ''}" style="--d:${i}">★</i>`).join('')}</span>` : '';
    bind('facts').innerHTML = (r.facts && r.facts.lines ? r.facts.lines : []).map((t) => `<li>${esc(t)}</li>`).join('');
    // misiones cumplidas en esta partida (ya sustituidas en la lista por las nuevas)
    const done = Array.isArray(r.missionsDone) ? r.missionsDone : [];
    bind('missDone').innerHTML = done.length > 1 ? `<div class="md">✔ ${done.length} misiones cumplidas</div>` : done.map((m) => `<div class="md">✔ ${esc(m.text)}</div>`).join('');
    // con récord se enseña primero la tabla; si no, las misiones
    setTab(adv ? 'goals' : r.isRecord ? 'top' : 'miss');
    if (adv) {
      const g = (ok, was, txt) => `<li class="${ok ? 'ok' : was ? 'was' : ''}"><i class="st ${ok || was ? 'on' : ''}">★</i><span>${txt}</span>${ok ? '<b>¡Hecho!</b>' : was ? '<small>ya la tenías</small>' : ''}</li>`;
      const b = adv.bits | 0, m = adv.merged | 0;
      const ph = !!adv.label;   // fases: portal, sin chocar, monedas sin puntos de control
      $('.oc-goals', scr).innerHTML = `<h3 class="oc-toptitle">Estrellas ${ph ? 'de la fase' : 'del tramo'}</h3><ul class="goals">${g(b & 1, m & 1, adv.cleared ? (ph ? 'Portal alcanzado' : 'Superado') : (ph ? 'Llega al portal' : `Supéralo (llegaste al ${Math.round(adv.prog * 100)} %)`))}${g(b & 2, m & 2, ph ? 'Sin chocar' : 'Sin chocar ni caer')}${g(b & 4, m & 4, (ph && !adv.cleared ? `Monedas: ${adv.coins} · meta: el 35 % del camino, sin controles` : `Monedas: ${adv.coins}/${adv.goal}${ph ? ' · sin controles' : ''}`))}</ul>${ph ? '' : `<div class="miss-rank">Tiempo ${fmtTime(adv.time)}</div>`}`;
    }
    // superada la fase, el botón grande y el foco por defecto son «Siguiente»; «Otra vez» pasa a secundario
    const nx = !!(adv && adv.label && adv.hasNext), rb = $('[data-act="restart"]', scr), nb = $('.btn-next', scr);
    rb.classList.toggle('btn-primary', !nx); rb.classList.toggle('btn-sec', nx); rb.classList.toggle('btn-cream', nx);
    rb.toggleAttribute('data-default', !nx); nb.toggleAttribute('data-default', nx);
    show('over');
    // se reinicia la animación de entrada
    restart($('.over-card', scr), 'enter');
  }

  // ----- mapa de la Aventura -----
  const starsHTML = (n) => [0, 1, 2].map((i) => `<i class="st ${i < n ? 'on' : ''}">★</i>`).join('');
  // kind: 'map' (Aventura, data-stage) o 'phases' (Fases, data-phase)
  function paintMap(list = [], kind = 'map') {
    const tot = list.reduce((a, s) => a + s.stars, 0);
    const attr = kind === 'phases' ? 'data-phase' : 'data-stage';
    $(`[data-bind="${kind}Total"]`).innerHTML = `<b>${tot}</b>/${list.length * 3}`;
    const firstOpen = list.findIndex((s) => !s.locked && s.stars === 0);
    $(`[data-bind="${kind}"]`).innerHTML = list.map((s, i) => `
      <button class="stage ${s.locked ? 'locked' : ''} ${s.boss ? 'boss' : ''} ${s.stars ? 'done' : ''}" data-nav ${attr}="${i}" style="--i:${i}" ${i === (firstOpen < 0 ? 0 : firstOpen) ? 'data-default' : ''}>
        <span class="sg-gem" aria-hidden="true">${DECO.gem}</span>
        <span class="sg-n">${s.locked ? ICON.lock : `<i class="oc-spark l" aria-hidden="true">${DECO.spark}</i>${i + 1}<i class="oc-spark r" aria-hidden="true">${DECO.spark}</i>`}</span>
        <span class="sg-name">${esc(s.name)}</span>
        <span class="sg-stars">${starsHTML(s.stars)}</span>
        ${!s.stars && s.best > 0 ? `<span class="sg-best">${Math.round(s.best * 100)} %</span>` : ''}
      </button>`).join('');
    if (current === kind) { const d = $('[data-default]', screens[kind]); if (d) { focused = null; setFocus(d, false); } }
  }

  // ----- tienda -----
  // data: { wallet, cats: [{ key, name, desc, items: [{ id, name, price, sw, owned, eq }] }] }
  function paintShop(data) {
    $('[data-bind="wallet"]').textContent = fmtInt(data.wallet);
    const f = focused && focused.dataset.buy;
    $('[data-bind="shop"]').innerHTML = data.cats.map((c, ci) => `
      <div class="shop-cat" style="--i:${ci}">
        <span class="pn-lf pn-lf-tr" aria-hidden="true">${DECO.leaves}</span><span class="sc-gem" aria-hidden="true">${DECO.gem}</span>
        <h3 class="panel-title sc-head"><span class="sc-name">${esc(c.name)}</span><small>${esc(c.desc)}</small></h3>
        <div class="shop-items">${c.items.map((it) => {
          const bg = it.sw.length > 2 ? `linear-gradient(135deg, ${it.sw.join(', ')})` : `linear-gradient(135deg, ${it.sw[0]}, ${it.sw[1]})`;
          const st = it.eq ? '<em class="si-eq">Puesto</em>' : it.owned ? '<em class="si-use">Usar</em>' : `<em class="si-price ${data.wallet < it.price ? 'poor' : ''}">${ICON.coin}${fmtInt(it.price)}</em>`;
          return `<button class="shop-item ${it.eq ? 'eq' : ''}" data-nav data-buy="${c.key}:${it.id}"><span class="si-sw" style="background:${bg}"></span><span class="si-name">${esc(it.name)}</span>${st}</button>`;
        }).join('')}</div>
      </div>`).join('');
    if (f && current === 'shop') { const el = $(`[data-buy="${f}"]`); if (el) { focused = null; setFocus(el, false); } }
  }

  // ----- misiones -----
  let missData = { list: [], rank: { level: 1, name: 'Novato', toNext: 3 } };
  const missRow = (m) => {
    const p = Math.round(100 * m.got / m.n);
    const cnt = m.n > 1 ? `<small>${fmtInt(m.got)}/${fmtInt(m.n)}</small>` : '';
    return `<li class="${m.done ? 'done' : ''}"><span class="mi-ico">${m.done ? '✔' : ''}</span><span class="mi-txt">${esc(m.text)}${cnt}</span><span class="mi-bar"><i style="width:${p}%"></i></span></li>`;
  };
  function missions(list = [], rank = missData.rank) {
    missData = { list, rank };
    for (const el of $$('[data-bind="missions"]', root)) el.innerHTML = list.map(missRow).join('');
    const line = `Rango ${rank.level} · ${esc(rank.name)} · ${rank.toNext === 1 ? 'falta 1 misión' : `faltan ${rank.toNext}`} para subir`;
    for (const el of $$('[data-bind="rankLine"]', root)) el.textContent = line;
    for (const el of $$('[data-bind="rankName"]', root)) el.textContent = rank.name;
    for (const el of $$('[data-bind="rankLvl"]', root)) el.textContent = rank.level;
  }
  // pestañas de la tarjeta de fin de partida
  for (const b of $$('.oc-tab', root)) b.addEventListener('click', (ev) => { ev.stopPropagation(); setTab(b.dataset.tab); });
  function setTab(t) {
    for (const b of $$('.oc-tab', root)) b.classList.toggle('on', b.dataset.tab === t);
    for (const p of $$('.oc-pane', root)) p.hidden = p.dataset.pane !== t;
  }

  function settings(values = {}) {
    for (const k in values) if (k in vals) vals[k] = k === 'sens' ? +values[k] : values[k];
    paintSettings();
  }

  paintSettings();
  paintRecords();
  show('none');

  return {
    intro(d) {
      hudEl.advIntro.classList.toggle('ph', !!d.label);
      hudEl.advIntro.innerHTML = `<div class="ai-n">${d.boss && !d.name.startsWith('Jefe') ? 'Jefe · ' : ''}${esc(d.label || 'Tramo ' + d.n)}</div><div class="ai-name">${esc(d.name)}</div>${d.tip ? `<div class="ai-tip">${esc(d.tip)}</div>` : ''}<ul class="ai-goals">${d.goals.map((g) => `<li><i class="st on">★</i>${esc(g)}</li>`).join('')}</ul>`;
    },
    show, hud, toast, over, settings, tiltMeter, records: setRecords, missions, shop: paintShop, map: paintMap, phases: (l) => paintMap(l, 'phases'),
    // modos bloqueados: { voyage: true } → tarjeta en gris con su descripción de desbloqueo
    locks(l = {}) { for (const k of MODE_KEYS) { const c = $(`.card-${k}`); if (!c) continue; c.classList.toggle('locked', !!l[k]); const d = $('.card-desc', c); if (d) d.textContent = l[k] && MODES[k].lockedDesc ? MODES[k].lockedDesc : MODES[k].desc; } },
    navigate, confirm, back,
    jumpDenied() { restart(hudEl.jumps, 'shake'); },
    get screen() { return current; },
    root,
  };
}

export default createUI;
